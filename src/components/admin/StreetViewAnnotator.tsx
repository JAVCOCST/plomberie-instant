import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Pencil, Camera, Eraser, Satellite, Eye, Loader2, Save, ArrowLeft } from 'lucide-react';

type Mode = 'street' | 'aerial';

export interface StreetViewState {
  mode: Mode;
  panoLat?: number;
  panoLng?: number;
  heading?: number;
  pitch?: number;
  panoZoom?: number;
  mapLat?: number;
  mapLng?: number;
  mapZoom?: number;
}

export interface StreetViewAnnotatorProps {
  lat: number;
  lng: number;
  apiKey: string;
  /** Called when the user clicks "Capturer". The blob is a PNG that mixes the current view + drawn annotations. */
  onCapture: (blob: Blob, suggestedName: string) => Promise<void> | void;
  ready?: boolean;
  /** Vue à restaurer (mode + position pano + POV + carte). Persistée par le parent. */
  initialView?: StreetViewState | null;
  /** Notifie le parent à chaque changement de vue (mode, pano, POV, carte). */
  onViewChange?: (view: StreetViewState) => void;
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '10px 14px', minHeight: 40, borderRadius: 6,
  border: '1px solid ' + (active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'),
  background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
  color: active ? '#c7d2fe' : '#9ca3af',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
});

// Calcule l'angle (en degrés depuis le Nord, sens horaire) entre deux points
// lat/lng. Utilisé pour orienter la caméra Street View depuis la position du
// panorama VERS le centroïde du bâtiment. Implémenté en interne pour éviter
// d'avoir à charger `libraries=geometry` (seule `places` est chargée par le
// projet — toucher l'URL casserait toutes les autres pages qui consomment
// Google Maps via le même tag <script>).
function computeHeadingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const phi1 = (fromLat * Math.PI) / 180;
  const phi2 = (toLat * Math.PI) / 180;
  const dLambda = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const StreetViewAnnotator: React.FC<StreetViewAnnotatorProps> = ({ lat, lng, apiKey, onCapture, ready, initialView, onViewChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>(initialView?.mode || 'street');
  const [color, setColor] = useState('#ef4444');
  const [stroke, setStroke] = useState(4);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<{ url: string; info: string } | null>(null);
  // pencil is implicitly enabled when a snapshot exists
  const drawing = !!snapshot;
  const initialViewRef = useRef(initialView);
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => { onViewChangeRef.current = onViewChange; }, [onViewChange]);

  // Initialize google map + panorama once
  useEffect(() => {
    if (!containerRef.current) return;
    if (!(window as any).google?.maps) return;
    if (mapRef.current) return;

    const iv = initialViewRef.current;
    const initMapLat = iv?.mapLat ?? lat;
    const initMapLng = iv?.mapLng ?? lng;
    const initMapZoom = iv?.mapZoom ?? 20;
    const initPanoLat = iv?.panoLat ?? lat;
    const initPanoLng = iv?.panoLng ?? lng;
    const initHeading = iv?.heading ?? 0;
    const initPitch = iv?.pitch ?? 0;
    const initPanoZoom = iv?.panoZoom ?? 1;

    const map = new google.maps.Map(containerRef.current, {
      center: { lat: initMapLat, lng: initMapLng },
      zoom: initMapZoom,
      mapTypeId: 'satellite',
      tilt: 0,
      scaleControl: true,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
      rotateControl: false,
      gestureHandling: 'greedy',
    });
    mapRef.current = map;

    const pano = new google.maps.StreetViewPanorama(containerRef.current, {
      position: { lat: initPanoLat, lng: initPanoLng },
      pov: { heading: initHeading, pitch: initPitch },
      zoom: initPanoZoom,
      visible: false,
      addressControl: true,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
    });
    panoRef.current = pano;
    map.setStreetView(pano);
    // start in the persisted mode (defaults to street)
    pano.setVisible((iv?.mode || 'street') === 'street');

    // ── Auto-cadrage caméra (Vague A2.1) ───────────────────────────────
    // Quand on n'a PAS de vue persistée (`iv` null = première ouverture
    // sur cette adresse), la caméra par défaut pointe plein Nord
    // (heading=0). Résultat : l'utilisateur tombe rarement sur l'immeuble.
    //
    // On corrige avec un 2-étapes :
    //   1. StreetViewService.getPanorama() trouve le pano le plus proche
    //      du centroïde du bâtiment (max 100m, OUTDOOR uniquement).
    //   2. On calcule l'angle entre la position du pano (sur la rue) et
    //      le centroïde du bâtiment → on oriente la caméra dessus.
    //   3. pitch=10° pour voir le haut du bâtiment (≠ trottoir), zoom=0.5
    //      pour cadrer large.
    if (!iv) {
      try {
        const svc = new google.maps.StreetViewService();
        svc.getPanorama(
          {
            location: { lat, lng },
            radius: 100,
            source: google.maps.StreetViewSource.OUTDOOR,
            preference: google.maps.StreetViewPreference.NEAREST,
          },
          (data, status) => {
            if (status !== google.maps.StreetViewStatus.OK || !data?.location?.latLng) return;
            const panoLatLng = data.location.latLng;
            const panoLat = panoLatLng.lat();
            const panoLng = panoLatLng.lng();
            const heading = computeHeadingDeg(panoLat, panoLng, lat, lng);
            try {
              pano.setPosition(panoLatLng);
              pano.setPov({ heading, pitch: 10 });
              pano.setZoom(0.5);
            } catch (e) {
              console.warn('[StreetViewAnnotator] auto-cadrage setPov failed:', e);
            }
          },
        );
      } catch (e) {
        console.warn('[StreetViewAnnotator] auto-cadrage init failed:', e);
      }
    }

    // ── Persistance de la vue : notifier le parent ───────────────────
    const emit = () => {
      const m = mapRef.current;
      const p = panoRef.current;
      if (!m || !p) return;
      const c = m.getCenter();
      const pos = p.getPosition();
      const pov = p.getPov();
      onViewChangeRef.current?.({
        mode,
        mapLat: c?.lat(),
        mapLng: c?.lng(),
        mapZoom: m.getZoom() ?? undefined,
        panoLat: pos?.lat(),
        panoLng: pos?.lng(),
        heading: pov?.heading,
        pitch: pov?.pitch,
        panoZoom: p.getZoom(),
      });
    };
    map.addListener('idle', emit);
    pano.addListener('position_changed', emit);
    pano.addListener('pov_changed', emit);
    pano.addListener('zoom_changed', emit);
  }, [lat, lng, ready]);

  // Re-center when lat/lng changes — sauf si une vue persistée est déjà en cours d'utilisation.
  useEffect(() => {
    if (!mapRef.current || !panoRef.current) return;
    // Si l'utilisateur a déjà bougé la vue (via initialView ou pan), ne pas la réinitialiser.
    if (initialViewRef.current) return;
    mapRef.current.setCenter({ lat, lng });
    panoRef.current.setPosition({ lat, lng });
    // Vague A2.1 — re-trigger auto-cadrage caméra sur changement d'adresse
    // (même logique que dans le useEffect d'init ci-dessus).
    const panoLocal = panoRef.current;
    try {
      const svc = new google.maps.StreetViewService();
      svc.getPanorama(
        {
          location: { lat, lng },
          radius: 100,
          source: google.maps.StreetViewSource.OUTDOOR,
          preference: google.maps.StreetViewPreference.NEAREST,
        },
        (data, status) => {
          if (status !== google.maps.StreetViewStatus.OK || !data?.location?.latLng) return;
          const panoLatLng = data.location.latLng;
          const heading = computeHeadingDeg(panoLatLng.lat(), panoLatLng.lng(), lat, lng);
          try {
            panoLocal.setPosition(panoLatLng);
            panoLocal.setPov({ heading, pitch: 10 });
            panoLocal.setZoom(0.5);
          } catch (e) {
            console.warn('[StreetViewAnnotator] re-cadrage setPov failed:', e);
          }
        },
      );
    } catch (e) {
      console.warn('[StreetViewAnnotator] re-cadrage init failed:', e);
    }
  }, [lat, lng]);

  // Toggle pano visibility on mode change
  useEffect(() => {
    if (!panoRef.current) return;
    panoRef.current.setVisible(mode === 'street');
    // Notifier le parent que le mode a changé (le emit utilise mode courant).
    const m = mapRef.current;
    const p = panoRef.current;
    if (!m || !p) return;
    const c = m.getCenter();
    const pos = p.getPosition();
    const pov = p.getPov();
    onViewChangeRef.current?.({
      mode,
      mapLat: c?.lat(), mapLng: c?.lng(), mapZoom: m.getZoom() ?? undefined,
      panoLat: pos?.lat(), panoLng: pos?.lng(),
      heading: pov?.heading, pitch: pov?.pitch, panoZoom: p.getZoom(),
    });
  }, [mode]);

  // Sync canvas size with container
  useEffect(() => {
    const resize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = canvasRef.current;
      // Preserve current strokes
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, c.width);
      tmp.height = Math.max(1, c.height);
      try { if (c.width > 0 && c.height > 0) tmp.getContext('2d')?.drawImage(c, 0, 0); } catch {}
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.style.width = r.width + 'px';
      c.style.height = r.height + 'px';
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        try { ctx.drawImage(tmp, 0, 0, c.width, c.height); } catch {}
        ctx.scale(dpr, dpr);
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [snapshot]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    e.preventDefault();
    drawingRef.current = true;
    const r = canvasRef.current!.getBoundingClientRect();
    lastPosRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !drawingRef.current || !canvasRef.current || !lastPosRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = color; ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastPosRef.current = { x, y };
  };
  const endStroke = () => { drawingRef.current = false; lastPosRef.current = null; };

  const clearCanvas = () => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore();
  };

  const buildBgUrl = (wPx: number, hPx: number): string => {
    const max = 640;
    const ratio = wPx / hPx;
    let sw = wPx, sh = hPx;
    if (sw > max || sh > max) {
      if (ratio > 1) { sw = max; sh = Math.round(max / ratio); }
      else { sh = max; sw = Math.round(max * ratio); }
    }
    if (mode === 'street' && panoRef.current) {
      const pos = panoRef.current.getPosition();
      const pov = panoRef.current.getPov();
      const z = panoRef.current.getZoom() ?? 1;
      const fov = Math.max(20, Math.min(120, 180 / Math.pow(2, z)));
      const la = pos?.lat() ?? lat;
      const ln = pos?.lng() ?? lng;
      return `https://maps.googleapis.com/maps/api/streetview?size=${sw}x${sh}&location=${la},${ln}&heading=${pov.heading}&pitch=${pov.pitch}&fov=${fov}&scale=2&key=${apiKey}`;
    }
    const m = mapRef.current;
    const c = m?.getCenter();
    const z = m?.getZoom() ?? 20;
    const la = c?.lat() ?? lat;
    const ln = c?.lng() ?? lng;
    return `https://maps.googleapis.com/maps/api/staticmap?size=${sw}x${sh}&zoom=${z}&center=${la},${ln}&maptype=satellite&scale=2&key=${apiKey}`;
  };

  // Step 1: take a snapshot of the current live view (no annotations yet)
  const takeSnapshot = useCallback(async () => {
    if (!containerRef.current) return;
    setBusy(true);
    try {
      const r = containerRef.current.getBoundingClientRect();
      const url = buildBgUrl(Math.round(r.width), Math.round(r.height));
      // Validate the response: Google sometimes returns 200 with an error tile
      // (or 403) when the Static API isn't enabled / domain not allowed.
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ct = resp.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) {
        const text = await resp.text().catch(() => '');
        throw new Error('réponse non-image: ' + text.slice(0, 200));
      }
      const blob = await resp.blob();
      if (blob.size < 1500) throw new Error('image vide / erreur Google');
      const objectUrl = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('decode failed'));
        img.src = objectUrl;
      });
      const info = mode === 'street' && panoRef.current
        ? `Street View · cap ${Math.round(panoRef.current.getPov().heading)}° · incl. ${Math.round(panoRef.current.getPov().pitch)}°`
        : `Vue aérienne · zoom ${mapRef.current?.getZoom() ?? '—'}`;
      setSnapshot({ url: objectUrl, info });
      // clear any previous strokes
      setTimeout(() => clearCanvas(), 0);
    } catch (err) {
      console.error('Snapshot failed:', err);
      const which = mode === 'street' ? 'Street View Static API' : 'Maps Static API';
      alert(
        `La capture a échoué.\n\n` +
        `Vérifiez dans Google Cloud :\n` +
        `  1. Service « ${which} » ACTIVÉ\n` +
        `  2. Clé API autorise le domaine ${location.hostname}\n` +
        `  3. Facturation activée sur le projet\n\n` +
        `Détails: ${(err as Error).message}`
      );
    } finally {
      setBusy(false);
    }
  }, [mode, apiKey, lat, lng]);

  // Step 2: save snapshot + annotations as PNG to document storage
  const saveAnnotated = useCallback(async () => {
    if (!snapshot || !canvasRef.current) return;
    setBusy(true);
    try {
      const bg: HTMLImageElement = await new Promise((resolve, reject) => {
        const img = new Image();
        // snapshot.url is a blob: URL (same-origin), no CORS needed.
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = snapshot.url;
      });
      const out = document.createElement('canvas');
      out.width = bg.naturalWidth;
      out.height = bg.naturalHeight;
      const octx = out.getContext('2d');
      if (!octx) throw new Error('no ctx');
      octx.drawImage(bg, 0, 0);
      octx.drawImage(canvasRef.current, 0, 0, out.width, out.height);
      octx.fillStyle = 'rgba(0,0,0,0.55)';
      octx.fillRect(0, out.height - 30, out.width, 30);
      octx.fillStyle = '#fff';
      octx.font = 'bold 14px system-ui, sans-serif';
      octx.fillText(snapshot.info, 12, out.height - 10);

      const blob: Blob = await new Promise((res, rej) => out.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await onCapture(blob, `${mode === 'street' ? 'streetview' : 'aerienne'}_annotation_${stamp}.png`);
      try { URL.revokeObjectURL(snapshot.url); } catch {}
      clearCanvas();
      setSnapshot(null);
    } catch (err) {
      console.error('Save annotation failed:', err);
      alert("L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }, [snapshot, mode, onCapture]);

  return (
    <div style={{ marginTop: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden', background: '#000' }}>
      <div style={{ display: 'flex', gap: 6, padding: 8, background: 'rgba(20,20,40,0.9)', flexWrap: 'wrap', alignItems: 'center' }}>
        {!snapshot ? (
          <>
            <button type="button" onClick={() => setMode('street')} style={tabBtn(mode === 'street')}><Eye size={12} /> Street View</button>
            <button type="button" onClick={() => setMode('aerial')} style={tabBtn(mode === 'aerial')}><Satellite size={12} /> Aérienne</button>
            <button type="button" onClick={takeSnapshot} disabled={busy} style={{ ...tabBtn(true), background: 'linear-gradient(135deg,#6366f1,#4f46e5)', borderColor: 'rgba(99,102,241,0.6)', color: '#fff' }}>
              {busy ? <><Loader2 size={12} className="animate-spin" /> Capture…</> : <><Camera size={12} /> Capturer la vue</>}
            </button>
            <span style={{ fontSize: 10, color: '#94a3b8', flexBasis: '100%' }}>Cadrez la vue puis capturez pour annoter</span>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { clearCanvas(); setSnapshot(null); }} style={tabBtn(false)}><ArrowLeft size={12} /> Retour vue live</button>
            <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#c7d2fe', fontWeight: 600 }}><Pencil size={12} /> Crayon</span>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="Couleur du crayon" style={{ width: 44, height: 40, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }} title="Couleur" />
            <input type="range" min={1} max={20} value={stroke} onChange={e => setStroke(Number(e.target.value))} style={{ width: 80 }} title="Épaisseur" />
            <button type="button" onClick={clearCanvas} style={tabBtn(false)}><Eraser size={12} /> Effacer</button>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={saveAnnotated} disabled={busy} style={{ ...tabBtn(true), background: 'linear-gradient(135deg,#10b981,#059669)', borderColor: 'rgba(16,185,129,0.5)', color: '#fff' }}>
              {busy ? <><Loader2 size={12} className="animate-spin" /> Enregistrement…</> : <><Save size={12} /> Enregistrer dans documents</>}
            </button>
          </>
        )}
      </div>
      <div style={{ position: 'relative', width: '100%', height: 380 }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0, visibility: snapshot ? 'hidden' : 'visible' }} />
        {snapshot && (
          <img
            src={snapshot.url}
            alt="Capture"
            onError={() => { alert("Impossible d'afficher la capture (image invalide)."); setSnapshot(null); }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', userSelect: 'none', pointerEvents: 'none' }}
            draggable={false}
          />
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          style={{
            position: 'absolute', inset: 0,
            pointerEvents: drawing ? 'auto' : 'none',
            touchAction: drawing ? 'none' : 'auto',
            cursor: drawing ? 'crosshair' : 'default',
          }}
        />
      </div>
    </div>
  );
};

export default StreetViewAnnotator;