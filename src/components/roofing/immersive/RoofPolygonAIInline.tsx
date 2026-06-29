/// <reference types="google.maps" />
import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Wand2, Crosshair, Loader2, Check, RefreshCcw, Camera, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

/* ──────────────── Types & helpers ──────────────── */

export interface CaptureParams {
  centerLat: number;
  centerLng: number;
  zoom: number;
  width: number;
  height: number;
  bounds: { north: number; south: number; east: number; west: number };
  topLayer: 'ortho' | 'google';
  showGoogleSatellite: boolean;
  showOrthoQC: boolean;
}

export interface AiOverlay {
  id: string;
  url: string;
  bounds: { north: number; south: number; east: number; west: number };
  visible: boolean;
  opacity?: number;
  /** Métadonnées pour l'UI (legend) */
  kind: 'capture' | 'enhanced' | 'polygon';
  label: string;
}

const TILE_SIZE = 256;

function lngLatToWorld(lng: number, lat: number, zoom: number) {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = (lng + 180) / 360 * scale;
  const sin = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}
function worldToLngLat(x: number, y: number, zoom: number): google.maps.LatLngLiteral {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}
function pxToLatLng(px: number, py: number, cap: CaptureParams): google.maps.LatLngLiteral {
  const center = lngLatToWorld(cap.centerLng, cap.centerLat, cap.zoom);
  const wx = center.x + (px - cap.width / 2);
  const wy = center.y + (py - cap.height / 2);
  return worldToLngLat(wx, wy, cap.zoom);
}
function computeAreaM2(path: google.maps.LatLngLiteral[]): number {
  if (!(window as any).google?.maps?.geometry?.spherical) return 0;
  return Math.abs(google.maps.geometry.spherical.computeArea(path));
}
function computePerimeterM(path: google.maps.LatLngLiteral[]): number {
  if (!(window as any).google?.maps?.geometry?.spherical) return 0;
  const sph = google.maps.geometry.spherical;
  let s = 0;
  for (let i = 0; i < path.length; i++) {
    s += sph.computeDistanceBetween(
      new google.maps.LatLng(path[i]),
      new google.maps.LatLng(path[(i + 1) % path.length]),
    );
  }
  return s;
}

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

function googleStaticChunkUrl(center: google.maps.LatLngLiteral, width: number, height: number, zoom: number): string {
  const params = new URLSearchParams({
    center: `${center.lat},${center.lng}`,
    zoom: String(Math.round(zoom)),
    size: `${width}x${height}`,
    scale: '1',
    maptype: 'satellite',
    key: GOOGLE_API_KEY,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

async function composeGoogleSatellite(cap: CaptureParams): Promise<string> {
  const z = Math.round(cap.zoom);
  const center = lngLatToWorld(cap.centerLng, cap.centerLat, z);
  const canvas = document.createElement('canvas');
  canvas.width = cap.width;
  canvas.height = cap.height;
  const ctx = canvas.getContext('2d')!;
  const chunks: Promise<void>[] = [];
  for (let y = 0; y < cap.height; y += 640) {
    for (let x = 0; x < cap.width; x += 640) {
      const w = Math.min(640, cap.width - x);
      const h = Math.min(640, cap.height - y);
      const chunkCenter = worldToLngLat(
        center.x + x + w / 2 - cap.width / 2,
        center.y + y + h / 2 - cap.height / 2,
        z,
      );
      chunks.push(new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { ctx.drawImage(img, x, y, w, h); resolve(); };
        img.onerror = reject;
        img.src = googleStaticChunkUrl(chunkCenter, w, h, z);
      }));
    }
  }
  await Promise.all(chunks);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function composeOrthoQc(cap: CaptureParams): Promise<string> {
  const z = Math.round(cap.zoom);
  const center = lngLatToWorld(cap.centerLng, cap.centerLat, z);
  const x0 = center.x - cap.width / 2;
  const y0 = center.y - cap.height / 2;
  const tx0 = Math.floor(x0 / TILE_SIZE);
  const ty0 = Math.floor(y0 / TILE_SIZE);
  const tx1 = Math.floor((x0 + cap.width) / TILE_SIZE);
  const ty1 = Math.floor((y0 + cap.height) / TILE_SIZE);
  const canvas = document.createElement('canvas');
  canvas.width = cap.width;
  canvas.height = cap.height;
  const ctx = canvas.getContext('2d')!;
  const loads: Promise<void>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const url = `https://geoegl.msp.gouv.qc.ca/carto/wmts/1.0.0/orthos/default/EPSG_3857/${z}/${ty}/${tx}.jpeg`;
      loads.push(new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, tx * TILE_SIZE - x0, ty * TILE_SIZE - y0);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      }));
    }
  }
  await Promise.all(loads);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function urlToDataUrl(url: string, targetW?: number, targetH?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = targetW || img.naturalWidth;
      const h = targetH || img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      try { resolve(c.toDataURL('image/jpeg', 0.92)); }
      catch (e) { reject(e); }
    };
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

function buildBinaryMask(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  let fg = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const white = data[i + 3] > 32 && (data[i] + data[i + 1] + data[i + 2]) / 3 > 96;
    if (white) { mask[p] = 1; fg++; }
  }
  if (fg > mask.length * 0.86) {
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] ? 0 : 1;
  }
  return mask;
}

function morph(mask: Uint8Array, w: number, h: number, mode: 'erode' | 'dilate', radius: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = mode === 'erode' ? 1 : 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nx = x + dx, ny = y + dy;
          const v = nx >= 0 && ny >= 0 && nx < w && ny < h ? mask[ny * w + nx] : 0;
          if (mode === 'dilate' && v) { hit = 1; dx = dy = radius + 1; }
          if (mode === 'erode' && !v) { hit = 0; dx = dy = radius + 1; }
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

function keepBestComponent(mask: Uint8Array, w: number, h: number, seed?: { x: number; y: number }): Uint8Array {
  const seen = new Uint8Array(mask.length);
  const q = new Int32Array(mask.length);
  const dirs = [1, -1, w, -w, w + 1, w - 1, -w + 1, -w - 1];
  const sx = seed ? Math.max(0, Math.min(w - 1, Math.round(seed.x))) : -1;
  const sy = seed ? Math.max(0, Math.min(h - 1, Math.round(seed.y))) : -1;
  const seedIdx = seed ? sy * w + sx : -1;
  // 1) Si le seed tombe directement sur un pixel mask, on prend SA composante (priorité absolue).
  if (seed && seedIdx >= 0 && mask[seedIdx]) {
    let head = 0, tail = 0;
    q[tail++] = seedIdx; seen[seedIdx] = 1;
    const pixels: number[] = [];
    while (head < tail) {
      const idx = q[head++]; pixels.push(idx);
      for (const d of dirs) {
        const ni = idx + d;
        if (ni < 0 || ni >= mask.length || seen[ni] || !mask[ni]) continue;
        const x = idx % w, nx = ni % w;
        if (Math.abs(nx - x) > 1) continue;
        seen[ni] = 1; q[tail++] = ni;
      }
    }
    const out = new Uint8Array(mask.length);
    pixels.forEach((idx) => { out[idx] = 1; });
    return out;
  }
  // 2) Sinon: composante la plus proche du seed, pondérée par taille.
  let best: { pixels: number[]; score: number } | null = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 0, minD = Number.POSITIVE_INFINITY;
    const pixels: number[] = [];
    q[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const idx = q[head++];
      pixels.push(idx);
      if (seed) {
        const x = idx % w, y = Math.floor(idx / w);
        minD = Math.min(minD, (x - sx) * (x - sx) + (y - sy) * (y - sy));
      }
      for (const d of dirs) {
        const ni = idx + d;
        if (ni < 0 || ni >= mask.length || seen[ni] || !mask[ni]) continue;
        const x = idx % w, nx = ni % w;
        if (Math.abs(nx - x) > 1) continue;
        seen[ni] = 1; q[tail++] = ni;
      }
    }
    if (pixels.length < 48) continue;
    const score = seed ? pixels.length / Math.max(1, 1 + Math.sqrt(minD)) : pixels.length;
    if (!best || score > best.score) best = { pixels, score };
  }
  const out = new Uint8Array(mask.length);
  best?.pixels.forEach((idx) => { out[idx] = 1; });
  return out;
}

function fillInteriorHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const q = new Int32Array(mask.length);
  let head = 0, tail = 0;
  const push = (idx: number) => { if (!mask[idx] && !outside[idx]) { outside[idx] = 1; q[tail++] = idx; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  const dirs = [1, -1, w, -w];
  while (head < tail) {
    const idx = q[head++];
    for (const d of dirs) {
      const ni = idx + d;
      if (ni < 0 || ni >= mask.length) continue;
      const x = idx % w, nx = ni % w;
      if (Math.abs(nx - x) > 1 && Math.abs(d) === 1) continue;
      if (!mask[ni] && !outside[ni]) { outside[ni] = 1; q[tail++] = ni; }
    }
  }
  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i++) if (!out[i] && !outside[i]) out[i] = 1;
  return out;
}

function traceOuterContour(mask: Uint8Array, w: number, h: number): number[][] {
  const edges: Array<[number, number, number, number]> = [];
  const isOn = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isOn(x, y)) continue;
      if (!isOn(x, y - 1)) edges.push([x, y, x + 1, y]);
      if (!isOn(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
      if (!isOn(x, y + 1)) edges.push([x + 1, y + 1, x, y + 1]);
      if (!isOn(x - 1, y)) edges.push([x, y + 1, x, y]);
    }
  }
  const byStart = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = `${e[0]},${e[1]}`;
    byStart.set(k, [...(byStart.get(k) || []), i]);
  });
  const used = new Uint8Array(edges.length);
  let best: number[][] = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const loop: number[][] = [];
    let currentIdx = i;
    let e = edges[currentIdx];
    const startKey = `${e[0]},${e[1]}`;
    for (let guard = 0; guard < edges.length + 4; guard++) {
      used[currentIdx] = 1;
      loop.push([e[0], e[1]]);
      const nextKey = `${e[2]},${e[3]}`;
      if (nextKey === startKey) break;
      const nextIdx = (byStart.get(nextKey) || []).find((n) => !used[n]);
      if (nextIdx == null) break;
      currentIdx = nextIdx;
      e = edges[nextIdx];
    }
    if (loop.length > best.length) best = loop;
  }
  return best;
}

/** Convertit le masque retourné par SAM en polygone robuste autour du point cliqué. */
async function maskToPolygon(maskDataUrl: string, w: number, h: number, seed?: { x: number; y: number }): Promise<number[][]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i); i.onerror = reject; i.src = maskDataUrl;
  });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let mask = buildBinaryMask(data, w, h);
  // Closing fort: bouche les trous + fusionne les fragments séparés par un fin gap.
  const closingR = Math.max(2, Math.min(5, Math.round(Math.min(w, h) / 300)));
  mask = morph(morph(mask, w, h, 'dilate', closingR), w, h, 'erode', closingR);
  // Garde la composante du seed (priorité absolue si seed dans mask).
  mask = keepBestComponent(mask, w, h, seed);
  if (!mask.some(Boolean)) return [];
  // Bouche les trous internes (ventilations, ombres, cheminées).
  mask = fillInteriorHoles(mask, w, h);
  // Opening léger: enlève les pointes/spurs le long du bord.
  const openingR = Math.max(1, Math.round(Math.min(w, h) / 700));
  mask = morph(morph(mask, w, h, 'erode', openingR), w, h, 'dilate', openingR);
  // Trace + lisse + simplifie + (optionnel) orthogonalise.
  let contour = traceOuterContour(mask, w, h);
  if (contour.length < 4) return [];
  contour = smoothContour(contour, 7);
  const tol = Math.max(3, Math.min(12, Math.round(Math.min(w, h) * 0.006)));
  let simp = simplify(contour, tol);
  // Filtre les sommets trop proches.
  simp = simp.filter((_, i, arr) => i === 0 || Math.hypot(arr[i][0] - arr[i - 1][0], arr[i][1] - arr[i - 1][1]) > tol * 0.5);
  // Si le toit est manifestement orthogonal (>70% d'arêtes droites), snap aux axes.
  simp = orthogonalize(simp, 14);
  return simp;
}
function simplify(points: number[][], tol: number): number[][] {
  if (points.length < 3) return points;
  const sqTol = tol * tol;
  const sqSegDist = (p: number[], a: number[], b: number[]) => {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const dp = (pts: number[][], first: number, last: number, simp: number[][]) => {
    let maxSq = sqTol, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(pts[i], pts[first], pts[last]);
      if (sq > maxSq) { idx = i; maxSq = sq; }
    }
    if (idx !== -1) {
      if (idx - first > 1) dp(pts, first, idx, simp);
      simp.push(pts[idx]);
      if (last - idx > 1) dp(pts, idx, last, simp);
    }
  };
  const simp = [points[0]];
  dp(points, 0, points.length - 1, simp);
  simp.push(points[points.length - 1]);
  return simp;
}

/** Lisse un contour fermé par moyenne glissante (réduit l'effet escalier). */
function smoothContour(points: number[][], window = 5): number[][] {
  if (points.length < window * 2) return points;
  const n = points.length;
  const half = Math.floor(window / 2);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0;
    for (let k = -half; k <= half; k++) {
      const p = points[(i + k + n) % n];
      sx += p[0]; sy += p[1];
    }
    out.push([sx / window, sy / window]);
  }
  return out;
}

/** Si la majorité des arêtes sont quasi-horizontales/verticales, force l'orthogonalité. */
function orthogonalize(points: number[][], tolDeg = 12): number[][] {
  if (points.length < 4) return points;
  let ortho = 0, total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI);
    const mod = Math.min(ang % 90, 90 - (ang % 90));
    if (mod < tolDeg) ortho++;
    total++;
  }
  if (ortho / total < 0.7) return points; // pas un toit rectiligne, on laisse tel quel
  // Snap chaque arête à l'axe le plus proche.
  const out = points.map((p) => [...p]);
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dx) > Math.abs(dy)) b[1] = a[1];
    else b[0] = a[0];
  }
  return out;
}

/** Convertit un polygone (px) + capture en data URL PNG transparent + bounds géo. */
function rasterizePolygon(
  poly: number[][], w: number, h: number,
  fill = 'rgba(34,197,94,0.35)', stroke = '#22c55e', strokeWidth = 4,
): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  poly.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = strokeWidth; ctx.strokeStyle = stroke; ctx.stroke();
  return c.toDataURL('image/png');
}

/* ──────────────── Composant ──────────────── */

interface Props {
  /** Récupère les paramètres de la vue carte courante au moment du clic. */
  getCaptureParams: () => CaptureParams | null;
  /** Expose un re-run de la détection (re-capture la vue carte courante). */
  onReadyApi?: (api: { recapture: () => void }) => void;
  /** Pousse/retire des overlays géoréférencés sur la carte parente. */
  setOverlays: (updater: (prev: AiOverlay[]) => AiOverlay[]) => void;
  /** Confirme la création d'un outil "Surface bâtiment" à partir du polygone. */
  onConfirmPolygon: (poly: { path: google.maps.LatLngLiteral[]; areaM2: number; perimeterM: number }) => void;
}

type LogLevel = 'info' | 'ok' | 'warn' | 'err';

const RoofPolygonAIInline: React.FC<Props> = ({ getCaptureParams, setOverlays, onConfirmPolygon, onReadyApi }) => {
  const [capture, setCapture] = useState<CaptureParams | null>(null);
  const [captureDataUrl, setCaptureDataUrl] = useState<string>(''); // capture originale (toujours conservée pour SAM)
  const [imgDataUrl, setImgDataUrl] = useState<string>('');     // image courante affichée (capture ou enhance)
  const [enhancedDataUrl, setEnhancedDataUrl] = useState<string>(''); // image enhance (si présente)
  const [polygonPx, setPolygonPx] = useState<number[][] | null>(null);
  const [clickPt, setClickPt] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState<'capture' | 'enhance' | 'detect' | null>(null);
  const [logs, setLogs] = useState<{ t: number; level: LogLevel; msg: string }[]>([]);
  const [error, setError] = useState('');
  const imgRef = useRef<HTMLImageElement | null>(null);

  const log = (level: LogLevel, msg: string) => {
    // eslint-disable-next-line no-console
    console.log(`[RoofPolygonAI][${level}] ${msg}`);
    setLogs(prev => [...prev.slice(-49), { t: Date.now(), level, msg }]);
  };

  // ── Étape 1 : Capturer la vue carte ────────────────────────────────
  const doCapture = async () => {
    setError('');
    setPolygonPx(null);
    setClickPt(null);
    setEnhancedDataUrl('');
    const cap = getCaptureParams();
    if (!cap) { setError('Carte non prête'); log('err', 'Capture: getCaptureParams() = null'); return; }
    setCapture(cap);
    setBusy('capture');
    log('info', `Capture · source=${cap.topLayer} · ${cap.width}×${cap.height} · zoom=${cap.zoom.toFixed(2)} · centre=${cap.centerLat.toFixed(6)},${cap.centerLng.toFixed(6)}`);
    try {
      // IMPORTANT: la capture DOIT avoir exactement cap.width × cap.height pixels,
      // sinon le polygone détecté par SAM sera projeté hors des bounds géographiques
      // (ex: Google Static renvoie 1280×1280 même si on demande 892×668 à scale=2).
      const dataUrl = cap.topLayer === 'ortho'
        ? await composeOrthoQc(cap)
        : await composeGoogleSatellite(cap);
      setCaptureDataUrl(dataUrl);
      setImgDataUrl(dataUrl);
      log('ok', `Capture OK · ${Math.round(dataUrl.length / 1024)} kB`);
      // Réinitialise toute la pile IA (capture en bas, rien d'autre)
      setOverlays(prev => [
        ...prev.filter(o => o.id !== 'ai-capture' && o.id !== 'ai-enhanced' && o.id !== 'ai-polygon'),
        {
          id: 'ai-capture', url: dataUrl, bounds: cap.bounds, visible: true, opacity: 1,
          kind: 'capture', label: cap.topLayer === 'ortho' ? 'IA · capture Ortho QC' : 'IA · capture Google Sat',
        },
      ]);
    } catch (e: any) {
      const m = e?.message || String(e);
      setError(`Capture: ${m}`); log('err', `Capture: ${m}`);
    } finally {
      setBusy(null);
    }
  };

  // Expose un re-run (re-capture) au host → bouton « Relancer la détection IA ».
  const doCaptureRef = useRef(doCapture);
  doCaptureRef.current = doCapture;
  useEffect(() => { if (onReadyApi) onReadyApi({ recapture: () => doCaptureRef.current() }); }, [onReadyApi]);

  // ── Étape 2 : Améliorer (Real-ESRGAN) ──────────────────────────────
  const doEnhance = async () => {
    if (!imgDataUrl || !capture) { log('warn', 'Améliorer ignoré (pas de capture)'); return; }
    setError('');
    setBusy('enhance');
    log('info', `Enhance · envoi ${Math.round(imgDataUrl.length / 1024)} kB → roof-polygon-enhance`);
    try {
      const { data, error } = await supabase.functions.invoke('roof-polygon-enhance', {
        body: { image_b64: imgDataUrl },
      });
      if (error) { log('err', `Enhance HTTP: ${error.message || error}`); throw error; }
      log('info', `Enhance · réponse keys=${Object.keys(data || {}).join(',')}`);
      // Le serveur renvoie maintenant `image_b64` (data URL) en priorité
      let enhancedUrl: string | null = data?.image_b64 || null;
      if (!enhancedUrl && typeof data?.upscaledUrl === 'string') {
        log('info', 'Enhance · pas d\'image_b64, conversion upscaledUrl…');
        enhancedUrl = await urlToDataUrl(data.upscaledUrl);
      }
      if (!enhancedUrl) throw new Error('Réponse Enhance vide');
      setEnhancedDataUrl(enhancedUrl);
      setImgDataUrl(enhancedUrl);
      log('ok', `Enhance OK · ${Math.round(enhancedUrl.length / 1024)} kB · scale=${data?.scaleFactor || '?'}`);
      // Empile : capture (bas) → enhanced (milieu) → polygon (haut, ré-ajouté plus tard)
      setOverlays(prev => {
        const others = prev.filter(o => !['ai-capture','ai-enhanced','ai-polygon'].includes(o.id));
        const cap = prev.find(o => o.id === 'ai-capture');
        const poly = prev.find(o => o.id === 'ai-polygon');
        const enhanced: AiOverlay = {
          id: 'ai-enhanced', url: enhancedUrl!, bounds: capture.bounds, visible: true, opacity: 1,
          kind: 'enhanced', label: 'IA · Image améliorée (×4)',
        };
        return [...others, ...(cap ? [cap] : []), enhanced, ...(poly ? [poly] : [])];
      });
    } catch (e: any) {
      const m = e?.message || String(e);
      setError(`Enhance: ${m}`); log('err', `Enhance: ${m}`);
    } finally {
      setBusy(null);
    }
  };

  // ── Pose un point (sans lancer la détection) ───────────────────────
  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (busy) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * img.naturalWidth;
    const py = ((e.clientY - rect.top) / rect.height) * img.naturalHeight;
    setClickPt({ x: px, y: py });
    log('info', `Point posé: (${Math.round(px)}, ${Math.round(py)})`);
  };

  // ── Étape 3 : Détecter (SAM) ───────────────────────────────────────
  const doDetect = async () => {
    if (!captureDataUrl || !capture) { log('warn', 'Détection ignorée (pas d\'image)'); return; }
    if (!clickPt) { log('warn', 'Détection ignorée (pas de point)'); return; }
    setError('');
    setBusy('detect');
    // Le SAM tourne sur l'image originale (légère) pour éviter le dépassement mémoire
    // de l'edge function. Le point cliqué est en coordonnées de l'image affichée
    // (potentiellement enhanced ×4) → on le ramène au repère capture.
    const displayed = imgRef.current;
    const dispW = displayed?.naturalWidth || capture.width;
    const dispH = displayed?.naturalHeight || capture.height;
    const captureImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = captureDataUrl;
    });
    const capW = captureImg.naturalWidth;
    const capH = captureImg.naturalHeight;
    const ptX = (clickPt.x / dispW) * capW;
    const ptY = (clickPt.y / dispH) * capH;
    log('info', `Détection · point image=(${Math.round(clickPt.x)}, ${Math.round(clickPt.y)}) → capture=(${Math.round(ptX)}, ${Math.round(ptY)}) · taille SAM=${capW}×${capH} (${Math.round(captureDataUrl.length/1024)} kB)`);
    try {
      const { data, error } = await supabase.functions.invoke('roof-polygon-segment', {
        body: {
          image_b64: captureDataUrl, mode: 'click',
          points: [{ point: [Math.round(ptX), Math.round(ptY)], positive: true }],
        },
      });
      if (error) { log('err', `Segment HTTP: ${error.message || error}`); throw error; }
      let poly: number[][] = data?.polygon || [];
      log('info', `Segment · keys=${Object.keys(data || {}).join(',')} · polygon.length=${poly?.length || 0}`);
      if ((!poly || poly.length < 3) && data?.maskBase64) {
        log('info', `Segment · décodage masque (${capW}×${capH})`);
        poly = await maskToPolygon(data.maskBase64, capW, capH, { x: ptX, y: ptY });
        log('info', `Masque → ${poly.length} sommets`);
      }
      if (!poly || poly.length < 3) throw new Error('Aucun polygone détecté — re-cliquez au centre du toit.');
      // poly est en coordonnées capture (capW × capH) — on le remet à l'échelle affichage
      const polyDisplay = poly.map(([x, y]) => [x * dispW / capW, y * dispH / capH]);
      setPolygonPx(polyDisplay);
      // Calque polygone géoréférencé (rasterisé dans le repère capture)
      const polyRaster = rasterizePolygon(poly, capW, capH);
      setOverlays(prev => {
        const others = prev.filter(o => !['ai-capture','ai-enhanced','ai-polygon'].includes(o.id));
        const cap = prev.find(o => o.id === 'ai-capture');
        const enhanced = prev.find(o => o.id === 'ai-enhanced');
        const polygon: AiOverlay = {
          id: 'ai-polygon', url: polyRaster, bounds: capture.bounds, visible: true, opacity: 0.85,
          kind: 'polygon', label: `IA · Polygone détecté (${poly.length} pts)`,
        };
        return [...others, ...(cap ? [cap] : []), ...(enhanced ? [enhanced] : []), polygon];
      });
      log('ok', `Détection OK · ${poly.length} sommets`);
    } catch (e: any) {
      const m = e?.message || String(e);
      setError(`Détection: ${m}`); log('err', `Détection: ${m}`);
    } finally {
      setBusy(null);
    }
  };

  // ── Étape 4 : Confirmer (créer outil "Surface bâtiment") ──────────
  const doConfirm = () => {
    if (!polygonPx || !capture || !imgRef.current) return;
    const img = imgRef.current;
    const sx = capture.width / img.naturalWidth;
    const sy = capture.height / img.naturalHeight;
    const path = polygonPx.map(([x, y]) => pxToLatLng(x * sx, y * sy, capture));
    const areaM2 = computeAreaM2(path);
    const perimeterM = computePerimeterM(path);
    log('ok', `Confirmation · aire=${areaM2.toFixed(2)} m² · périmètre=${perimeterM.toFixed(2)} m`);
    onConfirmPolygon({ path, areaM2, perimeterM });
  };

  // ── Réinitialiser ──────────────────────────────────────────────────
  const doReset = () => {
    setCapture(null); setCaptureDataUrl(''); setImgDataUrl(''); setEnhancedDataUrl('');
    setPolygonPx(null); setClickPt(null); setError(''); setBusy(null);
    setOverlays(prev => prev.filter(o => o.id !== 'ai-capture' && o.id !== 'ai-enhanced' && o.id !== 'ai-polygon'));
    log('info', 'Réinitialisé');
  };

  /* ──────────────── Render ──────────────── */
  return (
    <div style={{
      background: 'rgba(15,23,42,0.6)',
      border: '1px solid rgba(168,85,247,0.35)',
      borderRadius: 8, padding: 10, color: '#e5e7eb', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#e9d5ff' }}>
        <Sparkles size={12} /> Détection IA · pipeline étape par étape
      </div>

      {/* Étape 1 — Capturer */}
      <Step
        n={1} label="Capturer la vue carte"
        running={busy === 'capture'} done={!!imgDataUrl}
        primary
        onAction={doCapture}
        actionIcon={<Camera size={11} />}
        actionLabel={imgDataUrl ? 'Recapturer' : 'Capturer'}
      />

      {/* Étape 2 — Améliorer (optionnel) */}
      <Step
        n={2} label="Améliorer la netteté (Real-ESRGAN ×4) — optionnel"
        running={busy === 'enhance'} done={!!enhancedDataUrl}
        disabled={!imgDataUrl || !!busy}
        onAction={doEnhance}
        actionIcon={<Wand2 size={11} />}
        actionLabel={enhancedDataUrl ? 'Re-améliorer' : 'Améliorer'}
      />

      {/* Aperçu image (clic = poser point) */}
      {imgDataUrl && (
        <div style={{
          position: 'relative',
          width: '100%',
          // Aspect ratio basé sur la CAPTURE originale → ne saute pas quand
          // l'image enhanced (×4) la remplace puisqu'elle a le même ratio.
          aspectRatio: capture ? `${capture.width} / ${capture.height}` : '4 / 3',
          maxHeight: 280,
          borderRadius: 6,
          border: '1px solid rgba(168,85,247,0.3)',
          overflow: 'hidden',
          background: '#000',
        }}>
          <img
            ref={imgRef}
            src={imgDataUrl}
            alt="Vue capturée"
            onClick={handleImageClick}
            style={{
              display: 'block',
              width: '100%', height: '100%',
              objectFit: 'contain',
              cursor: busy ? 'wait' : 'crosshair',
            }}
          />
          {clickPt && imgRef.current && (
            <div style={{
              position: 'absolute',
              left: `${(clickPt.x / imgRef.current.naturalWidth) * 100}%`,
              top: `${(clickPt.y / imgRef.current.naturalHeight) * 100}%`,
              transform: 'translate(-50%,-50%)',
              width: 12, height: 12, borderRadius: '50%',
              background: '#a78bfa', border: '2px solid white',
              boxShadow: '0 0 0 2px #a78bfa', pointerEvents: 'none',
            }} />
          )}
          {polygonPx && imgRef.current && (
            <svg
              viewBox={`0 0 ${imgRef.current.naturalWidth} ${imgRef.current.naturalHeight}`}
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            >
              <polygon
                points={polygonPx.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="rgba(34,197,94,0.25)" stroke="#22c55e" strokeWidth={3}
              />
            </svg>
          )}
        </div>
      )}

      {/* Étapes 3 (Détecter) et 4 (Créer outil) retirées — détection IA désactivée. */}

      {/* Reset */}
      {(imgDataUrl || polygonPx) && (
        <button
          type="button" onClick={doReset} disabled={!!busy}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '4px 8px', fontSize: 10, color: '#9ca3af',
            background: 'transparent', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer',
          }}
        >
          <Trash2 size={10} /> Tout réinitialiser
        </button>
      )}

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
          color: '#fca5a5', borderRadius: 6, padding: '6px 8px', fontSize: 10,
        }}>{error}</div>
      )}

      {/* Console logs */}
      <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 6, padding: '6px 8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <strong style={{ fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 0.5 }}>Journal</strong>
          <button type="button" onClick={() => setLogs([])}
            style={{ background: 'transparent', border: 'none', color: '#6b7280', fontSize: 9, cursor: 'pointer' }}>
            Effacer
          </button>
        </div>
        <div style={{ maxHeight: 100, overflowY: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 9, lineHeight: 1.4 }}>
          {logs.length === 0
            ? <div style={{ color: '#6b7280' }}>— en attente —</div>
            : logs.map((l, i) => (
              <div key={i} style={{ color: l.level === 'err' ? '#fca5a5' : l.level === 'warn' ? '#fcd34d' : l.level === 'ok' ? '#86efac' : '#cbd5e1' }}>
                <span style={{ opacity: 0.5 }}>{new Date(l.t).toLocaleTimeString()} </span>
                <span style={{ opacity: 0.7 }}>[{l.level}]</span> {l.msg}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

/* ──────────────── Sub-component ──────────────── */
const Step: React.FC<{
  n: number; label: string; running: boolean; done: boolean;
  disabled?: boolean; primary?: boolean;
  onAction: () => void; actionIcon: React.ReactNode; actionLabel: string;
}> = ({ n, label, running, done, disabled, primary, onAction, actionIcon, actionLabel }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px', borderRadius: 6,
    background: done ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${done ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
  }}>
    <div style={{
      width: 18, height: 18, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: done ? '#22c55e' : 'rgba(168,85,247,0.3)',
      color: 'white', fontSize: 9, fontWeight: 700, flexShrink: 0,
    }}>{done ? '✓' : n}</div>
    <div style={{ flex: 1, fontSize: 10, color: done ? '#86efac' : '#e5e7eb', fontWeight: 600 }}>
      {label}
    </div>
    <button
      type="button" onClick={onAction} disabled={disabled || running}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '5px 10px', borderRadius: 5, cursor: disabled || running ? 'not-allowed' : 'pointer',
        fontSize: 10, fontWeight: 700,
        opacity: disabled || running ? 0.5 : 1,
        background: primary
          ? 'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(99,102,241,0.4))'
          : 'rgba(255,255,255,0.08)',
        border: `1px solid ${primary ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.15)'}`,
        color: primary ? '#e9d5ff' : '#cbd5e1',
      }}
    >
      {running ? <Loader2 size={11} className="animate-spin" /> : actionIcon}
      {running ? '…' : actionLabel}
    </button>
  </div>
);

export default RoofPolygonAIInline;