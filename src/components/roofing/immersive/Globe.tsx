import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

/* ── Quebec places data ── */
const QUEBEC_PLACES = [
  { key: 'usa', country: 'USA', lat: 39.8283, lng: -98.5795 },
  { key: 'canada', country: 'Canada', lat: 56.1304, lng: -106.3468 },
  { key: 'montreal', country: 'Montréal', lat: 45.5017, lng: -73.5673 },
  { key: 'granby', country: 'Granby', lat: 45.4000, lng: -72.7330 },
  { key: 'sherbrooke', country: 'Sherbrooke', lat: 45.4042, lng: -71.8929 },
  { key: 'cowansville', country: 'Cowansville', lat: 45.2010, lng: -72.7432 },
  { key: 'magog', country: 'Magog', lat: 45.2668, lng: -72.1510 },
];

const MAP_W = 1024;
const MAP_H = 512;
const GLOBE_RADIUS = 200;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* globe-points.json uses full 2048×1024 image coords, not the halved mapSize */
const latLngToMapXY = (lat: number, lng: number) => ({
  x: ((lng + 180) / 360) * (MAP_W * 2),
  y: ((90 - lat) / 180) * (MAP_H * 2),
});

/* Original CodePen formula — maps pixel coords to 3D sphere */
const returnSphericalCoordinates = (mapX: number, mapY: number) => {
  const latitude = ((mapX - MAP_W) / MAP_W) * -180;
  const longitude = ((mapY - MAP_H) / MAP_H) * -90;
  const radius = Math.cos((longitude / 180) * Math.PI) * GLOBE_RADIUS;
  return {
    x: Math.cos((latitude / 180) * Math.PI) * radius,
    y: Math.sin((longitude / 180) * Math.PI) * GLOBE_RADIUS,
    z: Math.sin((latitude / 180) * Math.PI) * radius,
  };
};

/* Original CodePen formula — maps pixel coords to camera angles */
const returnCameraAngles = (mapX: number, mapY: number) => ({
  azimuthal: ((mapX - MAP_W) / MAP_W) * Math.PI + Math.PI / 2 + 0.1,
  polar: (mapY / (MAP_H * 2)) * Math.PI,
});

const normalizeStr = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').trim();

const scoreMatch = (query: string, label: string) => {
  const q = normalizeStr(query);
  const sl = normalizeStr(label);
  if (!q) return 0;
  if (sl === q) return 100;
  if (sl.startsWith(q)) return 80;
  if (sl.includes(q)) return 55;
  const tokens = q.split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const t of tokens) if (sl.includes(t)) hits++;
  if (hits) return 30 + hits * 10;
  return 0;
};

const pickBestKey = (query: string) => {
  const q = (query || '').trim();
  if (!q) return 'canada';
  let bestKey = 'canada';
  let bestScore = 0;
  for (const p of QUEBEC_PLACES) {
    const sc = scoreMatch(q, p.country);
    if (sc > bestScore) { bestScore = sc; bestKey = p.key; }
  }
  return bestKey;
};

const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
const easeOutCubic = (t: number) => { t--; return t * t * t + 1; };
const easeInOutQuad = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/* ── Set camera position from spherical ── */
const setCameraFromAngles = (cam: THREE.PerspectiveCamera, azimuthal: number, polar: number, dist: number) => {
  const phi = Math.PI / 2 - polar; // convert to Three.js convention
  cam.position.x = dist * Math.sin(phi) * Math.sin(azimuthal);
  cam.position.y = dist * Math.cos(phi);
  cam.position.z = dist * Math.sin(phi) * Math.cos(azimuthal);
  cam.lookAt(0, 0, 0);
};

interface GlobeProps {
  active: boolean;
  searchQuery?: string;
  targetLatLng?: { lat: number; lng: number } | null;
}

interface GlobeState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  globeGroup: THREE.Group | null;
  globeMesh: THREE.Mesh | null;
  dotsMesh: THREE.Points | null;
  dotsTargets: THREE.Vector3[];
  animFrame: number;
  running: boolean;
  idleSpin: boolean;
  zoomStrength: number;
  introProgress: number;
  currentAzimuthal: number;
  currentPolar: number;
  targetAzimuthal: number;
  targetPolar: number;
  startAzimuthal: number;
  startPolar: number;
  countryAnimating: boolean;
  countryProgress: number;
  countryTotal: number;
  labelsEl: HTMLUListElement | null;
  elements: Record<string, { position: THREE.Vector3; element: HTMLElement }>;
  initialized: boolean;
  spinAngle: number;
}

const Globe: React.FC<GlobeProps> = ({ active, searchQuery, targetLatLng }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef<GlobeState>({
    renderer: null, scene: null, camera: null,
    globeGroup: null, globeMesh: null, dotsMesh: null, dotsTargets: [],
    animFrame: 0, running: false, idleSpin: true, zoomStrength: 0,
    introProgress: 0,
    // Start camera at wild angle (like original), animate to Montreal
    currentAzimuthal: -Math.PI, currentPolar: 0,
    targetAzimuthal: -Math.PI, targetPolar: 0,
    startAzimuthal: -Math.PI, startPolar: 0,
    countryAnimating: false, countryProgress: 0, countryTotal: 90,
    labelsEl: null, elements: {}, initialized: false, spinAngle: 0,
  });

  const init = useCallback(async () => {
    const s = st.current;
    if (s.initialized || !canvasRef.current || !containerRef.current) return;
    s.initialized = true;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    // Fetch globe points
    let pointsData: { x: number; y: number }[] = [];
    try {
      const res = await fetch('https://s3-us-west-2.amazonaws.com/s.cdpn.io/617753/globe-points.json');
      const json = await res.json();
      pointsData = json.points || [];
    } catch { /* empty fallback */ }

    const countries: Record<string, { x: number; y: number; country: string }> = {};
    for (const p of QUEBEC_PLACES) {
      const { x, y } = latLngToMapXY(p.lat, p.lng);
      countries[p.key] = { x, y, country: p.country };
    }

    s.scene = new THREE.Scene();
    s.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    s.renderer.setSize(container.clientWidth, container.clientHeight);
    s.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    s.renderer.setClearColor(0x000000, 0);

    s.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 1, 10000);
    s.camera.position.z = GLOBE_RADIUS * 2.2;

    // Globe group
    s.globeGroup = new THREE.Group();
    s.scene.add(s.globeGroup);

    // Sphere — ultra-clean radial fade from deep purple center to transparent edges
    const texSize = 512;
    const texCanvas = document.createElement('canvas');
    texCanvas.width = texSize; texCanvas.height = texSize;
    const ctx = texCanvas.getContext('2d')!;
    // Radial gradient: uses theme violet (260,70%,62%) fading to transparent
    const grad = ctx.createRadialGradient(texSize / 2, texSize / 2, 0, texSize / 2, texSize / 2, texSize / 2);
    grad.addColorStop(0, 'hsla(260, 70%, 40%, 0.35)');
    grad.addColorStop(0.3, 'hsla(260, 70%, 30%, 0.25)');
    grad.addColorStop(0.6, 'hsla(230, 25%, 15%, 0.15)');
    grad.addColorStop(0.85, 'hsla(230, 25%, 10%, 0.06)');
    grad.addColorStop(1, 'hsla(230, 25%, 7%, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, texSize, texSize);
    const texture = new THREE.CanvasTexture(texCanvas);
    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 0.98, 64, 64);
    const sphereMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0 });
    s.globeMesh = new THREE.Mesh(sphereGeo, sphereMat);
    s.globeGroup.add(s.globeMesh);

    // Dots
    const allPoints = [...pointsData];
    for (const k in countries) allPoints.push(countries[k]);

    const positions = new Float32Array(allPoints.length * 3);
    s.dotsTargets = [];
    for (let i = 0; i < allPoints.length; i++) {
      const p = returnSphericalCoordinates(allPoints[i].x, allPoints[i].y);
      s.dotsTargets.push(new THREE.Vector3(p.x, p.y, p.z));
    }

    const dotsGeo = new THREE.BufferGeometry();
    dotsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const dotCanvas = document.createElement('canvas');
    dotCanvas.width = 16; dotCanvas.height = 16;
    const dotCtx = dotCanvas.getContext('2d')!;
    dotCtx.beginPath();
    dotCtx.arc(8, 8, 8, 0, Math.PI * 2);
    dotCtx.fillStyle = 'hsl(185, 70%, 50%)'; // --imm-accent2 cyan
    dotCtx.fill();
    const dotTex = new THREE.CanvasTexture(dotCanvas);

    s.dotsMesh = new THREE.Points(dotsGeo, new THREE.PointsMaterial({
      map: dotTex, size: GLOBE_RADIUS / 120, transparent: true,
    }));
    s.globeGroup.add(s.dotsMesh);

    // Labels container
    const list = document.createElement('ul');
    list.style.cssText = 'z-index:10;opacity:0;position:absolute;left:0;top:0;list-style:none;transition:opacity 1.2s ease;pointer-events:none;margin:0;padding:0;';
    container.appendChild(list);
    s.labelsEl = list;

    for (const key in countries) {
      const el = document.createElement('li');
      el.innerHTML = `<span style="position:absolute;right:21px;top:50%;transform:translateY(-50%);opacity:1;font-size:12px;font-weight:700;color:hsl(0,0%,100%);white-space:nowrap;text-shadow:0 1px 6px hsl(230,25%,7%),0 0 12px hsl(230,25%,7%),0 0 20px hsla(260,70%,40%,0.4);">${countries[key].country}</span>`;
      el.style.cssText = 'opacity:.7;position:absolute;width:14px;height:14px;margin-left:-7px;margin-top:-7px;border-radius:50%;background:hsl(185,70%,55%);transition:opacity .25s ease;box-shadow:0 0 8px hsla(185,70%,55%,0.5),0 0 16px hsla(185,70%,55%,0.2);';
      list.appendChild(el);
      const p = returnSphericalCoordinates(countries[key].x, countries[key].y);
      s.elements[key] = { position: new THREE.Vector3(p.x, p.y, p.z), element: el };
    }

    // Initial camera target: Montreal via latLngToMapXY → returnCameraAngles
    const mtlXY = latLngToMapXY(45.5, -73.57);
    const mtlAngles = returnCameraAngles(mtlXY.x, mtlXY.y);
    s.targetAzimuthal = mtlAngles.azimuthal;
    s.targetPolar = mtlAngles.polar;
    s.startAzimuthal = s.currentAzimuthal;
    s.startPolar = s.currentPolar;
  }, []);

  const animate = useCallback(() => {
    const s = st.current;
    if (!s.running || !s.renderer || !s.scene || !s.camera || !s.dotsMesh || !s.globeMesh) return;

    // Intro: expand dots (fast — 50 frames ≈ 0.8s)
    if (s.introProgress < 50) {
      s.introProgress++;
      const posArr = s.dotsMesh.geometry.attributes.position.array as Float32Array;
      const total = s.dotsTargets.length;
      for (let i = 0; i < total; i++) {
        let dotP = easeOutCubic(s.introProgress / 50);
        dotP = Math.min(1, dotP + dotP * (i / total));
        posArr[i * 3] = s.dotsTargets[i].x * dotP;
        posArr[i * 3 + 1] = s.dotsTargets[i].y * dotP;
        posArr[i * 3 + 2] = s.dotsTargets[i].z * dotP;

        // Camera intro
        if (i === 0) {
          const progress = easeOutCubic(s.introProgress / 50);
          const az = s.startAzimuthal + (s.targetAzimuthal - s.startAzimuthal) * progress;
          const po = s.startPolar + (s.targetPolar - s.startPolar) * progress;
          setCameraFromAngles(s.camera!, az, po, s.camera!.position.length());
        }
      }
      s.dotsMesh.geometry.attributes.position.needsUpdate = true;
    }

    // Globe fade in — starts at frame 15, fast ramp
    if (s.introProgress >= 15) {
      const mat = s.globeMesh.material as THREE.MeshBasicMaterial;
      if (mat.opacity < 0.85) {
        mat.opacity = Math.min(0.85, mat.opacity + 0.04);
      }
    }

    // Labels — show at frame 20
    if (s.introProgress >= 20 && s.labelsEl) {
      s.labelsEl.style.opacity = '1';
    }

    // Country aim animation
    if (s.countryAnimating) {
      if (s.countryProgress < s.countryTotal) {
        const progress = easeInOutQuad(s.countryProgress / s.countryTotal);
        const az = s.startAzimuthal + (s.targetAzimuthal - s.startAzimuthal) * progress;
        const po = s.startPolar + (s.targetPolar - s.startPolar) * progress;
        s.currentAzimuthal = az;
        s.currentPolar = po;
        setCameraFromAngles(s.camera!, az, po, s.camera!.position.length());
        s.countryProgress++;
      } else {
        s.countryAnimating = false;
        s.countryProgress = 0;
        s.currentAzimuthal = s.targetAzimuthal;
        s.currentPolar = s.targetPolar;
      }
    }

    // Idle spin: rotate globe group
    if (s.idleSpin && s.globeGroup) {
      s.globeGroup.rotation.y += 0.0016;
    }

    // Zoom
    const baseZ = GLOBE_RADIUS * 2.2;
    const zoomZ = baseZ - s.zoomStrength * 160;
    s.camera.position.setLength(lerp(s.camera.position.length(), zoomZ, 0.06));
    s.camera.lookAt(0, 0, 0);

    // Project labels
    if (canvasRef.current) {
      const wH = canvasRef.current.clientWidth / 2;
      const hH = canvasRef.current.clientHeight / 2;
      for (const key in s.elements) {
        const { position, element } = s.elements[key];
        // Apply globe rotation to position
        const rotPos = position.clone().applyMatrix4(s.globeGroup!.matrixWorld);
        const proj = rotPos.project(s.camera!);
        const x = proj.x * wH + wH;
        const y = -(proj.y * hH) + hH;
        element.style.transform = `translate3D(${x}px, ${y}px, 0)`;

        // Hide labels on back side
        const camDir = s.camera!.position.clone().normalize();
        const dotDir = rotPos.clone().normalize();
        const dot = camDir.dot(dotDir);
        element.style.display = dot > 0.1 ? '' : 'none';
      }
    }

    s.renderer.render(s.scene, s.camera);
    s.animFrame = requestAnimationFrame(animate);
  }, []);

  // Handle search query
  useEffect(() => {
    const s = st.current;
    if (!s.initialized || !active) return;

    const q = (searchQuery || '').trim();
    s.idleSpin = !q;
    const bestKey = pickBestKey(q);

    for (const key in s.elements) {
      const el = s.elements[key].element;
      if (key === bestKey) {
        el.style.opacity = '1'; el.style.background = 'hsl(260,70%,62%)';
        el.style.boxShadow = '0 0 10px hsla(260,70%,62%,0.5)';
        el.style.width = '20px'; el.style.height = '20px';
        el.style.marginLeft = '-10px'; el.style.marginTop = '-10px';
      } else {
        el.style.opacity = q ? '0.15' : '0.7';
        el.style.background = 'hsl(185,70%,50%)';
        el.style.boxShadow = '0 0 6px hsla(185,70%,50%,0.4)';
        el.style.width = '12px'; el.style.height = '12px';
        el.style.marginLeft = '-6px'; el.style.marginTop = '-6px';
      }
    }

    // Aim camera using correct lat/lng
    const place = QUEBEC_PLACES.find(p => p.key === bestKey) || QUEBEC_PLACES[0];
    const aimXY = latLngToMapXY(place.lat, place.lng);
    s.startAzimuthal = s.currentAzimuthal;
    s.startPolar = s.currentPolar;
    const angles = returnCameraAngles(aimXY.x, aimXY.y);
    s.targetAzimuthal = angles.azimuthal;
    s.targetPolar = angles.polar;
    s.countryAnimating = true;
    s.countryProgress = 0;
    s.zoomStrength = clamp01(q.length / 12);
  }, [searchQuery, active]);

  // Handle go-to lat/lng
  useEffect(() => {
    const s = st.current;
    if (!s.initialized || !active || !targetLatLng) return;

    s.idleSpin = false;
    s.zoomStrength = 1;

    s.startAzimuthal = s.currentAzimuthal;
    s.startPolar = s.currentPolar;
    const tXY = latLngToMapXY(targetLatLng.lat, targetLatLng.lng);
    const angles = returnCameraAngles(tXY.x, tXY.y);
    s.targetAzimuthal = angles.azimuthal;
    s.targetPolar = angles.polar;
    s.countryAnimating = true;
    s.countryProgress = 0;

    let nearestKey = 'canada';
    let bestD = Infinity;
    for (const p of QUEBEC_PLACES) {
      const dx = p.lat - targetLatLng.lat;
      const dy = p.lng - targetLatLng.lng;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; nearestKey = p.key; }
    }
    for (const key in s.elements) {
      const el = s.elements[key].element;
      if (key === nearestKey) {
        el.style.opacity = '1'; el.style.background = 'hsl(260,70%,62%)';
        el.style.boxShadow = '0 0 10px hsla(260,70%,62%,0.5)';
      } else {
        el.style.opacity = '0.1'; el.style.background = 'hsl(185,70%,50%)';
        el.style.boxShadow = '0 0 6px hsla(185,70%,50%,0.4)';
      }
    }
  }, [targetLatLng, active]);

  // Start / stop rendering
  useEffect(() => {
    const s = st.current;
    if (active) {
      if (!s.initialized) {
        init().then(() => { s.running = true; s.animFrame = requestAnimationFrame(animate); });
      } else {
        s.running = true;
        s.animFrame = requestAnimationFrame(animate);
      }
    } else {
      s.running = false;
      if (s.animFrame) cancelAnimationFrame(s.animFrame);
    }
    return () => { s.running = false; if (s.animFrame) cancelAnimationFrame(s.animFrame); };
  }, [active, init, animate]);

  // Resize
  useEffect(() => {
    const handleResize = () => {
      const s = st.current;
      if (!containerRef.current || !s.renderer || !s.camera) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      s.renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div ref={containerRef} style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      overflow: 'hidden', borderRadius: '50%', pointerEvents: 'none',
    }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default Globe;
