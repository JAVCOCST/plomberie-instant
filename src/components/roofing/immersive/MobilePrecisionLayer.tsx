/// <reference types="google.maps" />
import React, { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  /** Map instance — read via ref to always get latest. */
  getMap: () => google.maps.Map | null;
  /** Container the map is rendered in. The layer covers this element. */
  getContainer: () => HTMLElement | null;
  /** Active measure tool color (for cursor tint). */
  color?: string;
  /** Called when the user releases a precise tap. We forward to map 'click'. */
  onPrecisePlace: (latLng: google.maps.LatLngLiteral) => void;
  /** Called when the user double-taps (precision). Used for "new segment" / undo. */
  onPreciseDouble?: (latLng: google.maps.LatLngLiteral) => void;
}

/**
 * Mobile-only precision placer:
 *  - Catches touch on top of the map (only when a measure tool is active).
 *  - Freezes pan/zoom while the finger is down.
 *  - Displays an offset magnifier loupe ~110 px above the finger so the
 *    finger never covers the target point. The loupe shows a real
 *    zoomed-in satellite preview centered on the cursor's lat/lng.
 *  - On release, computes the lat/lng under the reticle from the current
 *    map bounds and reports it to the parent (which dispatches a synthetic
 *    'click' on the map so the existing measure handlers run unchanged).
 */
const CURSOR_Y_OFFSET = 110;     // px above finger
const LOUPE_SIZE = 140;          // diameter of the magnifier circle
const LOUPE_ZOOM_BOOST = 2;      // levels above current map zoom
const LOUPE_REFRESH_MS = 160;    // throttle static-map fetches; the loupe content lags by this much during a drag

/** "Press harder" detection: modern iPhones no longer expose Touch.force,
 *  but PointerEvent.width × height still varies with how hard the user
 *  presses (fingertip flattens as pressure increases). We track recent
 *  contact areas, compute a moving baseline, and treat a spike of
 *  +PRESS_RATIO over baseline as a deliberate "commit" gesture. */
const PRESS_BASELINE_SAMPLES = 8;      // sliding window for baseline (median)
const PRESS_MIN_SAMPLES = 4;           // need this many before detection arms
const PRESS_RATIO_TRIGGER = 1.35;      // area must exceed baseline by this factor
const PRESS_COOLDOWN_MS = 280;         // min gap between consecutive press-commits
const AIM_MODE_DRAG_PX = 14;           // moving >= this distance switches to aim mode
const AIM_MODE_HOLD_MS = 280;          // holding >= this long also switches to aim mode
const GOOGLE_MAPS_API_KEY =
  (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ||
  (import.meta as any).env?.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY ||
  '';

function pixelToLatLng(
  map: google.maps.Map,
  container: HTMLElement,
  x: number,
  y: number,
): google.maps.LatLngLiteral | null {
  const b = map.getBounds();
  if (!b) return null;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return null;
  const ne = b.getNorthEast();
  const sw = b.getSouthWest();
  const cx = Math.max(0, Math.min(w, x));
  const cy = Math.max(0, Math.min(h, y));
  const lng = sw.lng() + (cx / w) * (ne.lng() - sw.lng());
  const latToY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  const yToLat = (yy: number) => (2 * Math.atan(Math.exp(yy)) - Math.PI / 2) * (180 / Math.PI);
  const yNorth = latToY(ne.lat());
  const ySouth = latToY(sw.lat());
  const yMerc = yNorth - (cy / h) * (yNorth - ySouth);
  return { lat: yToLat(yMerc), lng };
}

export const MobilePrecisionLayer: React.FC<Props> = ({ getMap, getContainer, color = '#22c55e', onPrecisePlace, onPreciseDouble }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [loupeUrl, setLoupeUrl] = useState<string | null>(null);
  const loupeTimerRef = useRef<number | null>(null);
  const lastLoupeAtRef = useRef<number>(0);
  const lastLoupeUrlRef = useRef<string | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const savedRef = useRef<{ gestureHandling?: any; draggable?: any; scrollwheel?: any } | null>(null);
  const startedRef = useRef(false);
  const lastTapRef = useRef<{ t: number; x: number; y: number; ll: google.maps.LatLngLiteral } | null>(null);
  const pendingTapRef = useRef<number | null>(null);
  /** Press-harder detection state. */
  const touchStartAtRef = useRef<number>(0);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const aimModeRef = useRef(false);                  // true once the user crosses the drag/hold threshold
  const pressAreasRef = useRef<number[]>([]);        // recent contact areas for baseline
  const lastPressCommitAtRef = useRef<number>(0);    // timestamp of last press-harder commit
  const pressInProgressRef = useRef(false);          // true while the finger is currently in the "pressed" phase
  const anyPressCommitRef = useRef(false);           // true if any press-harder commit fired during this touch
  const [pressFlashKey, setPressFlashKey] = useState(0); // bumped to retrigger the loupe flash animation

  const freezeMap = useCallback(() => {
    const map = getMap();
    if (!map) return;
    if (!savedRef.current) {
      savedRef.current = {
        gestureHandling: (map.get('gestureHandling') as any) ?? 'greedy',
        draggable: (map.get('draggable') as any) ?? true,
        scrollwheel: (map.get('scrollwheel') as any) ?? true,
      };
    }
    map.setOptions({ gestureHandling: 'none', draggable: false, scrollwheel: false, disableDoubleClickZoom: true });
  }, [getMap]);

  const unfreezeMap = useCallback(() => {
    const map = getMap();
    if (!map) return;
    const saved = savedRef.current;
    map.setOptions({
      gestureHandling: saved?.gestureHandling ?? 'greedy',
      draggable: saved?.draggable ?? true,
      scrollwheel: saved?.scrollwheel ?? true,
      disableDoubleClickZoom: false,
    });
    savedRef.current = null;
  }, [getMap]);

  const updateLoupeNow = useCallback((x: number, y: number) => {
    const map = getMap();
    const container = getContainer();
    if (!map || !container || !GOOGLE_MAPS_API_KEY) return;
    const ll = pixelToLatLng(map, container, x, y - CURSOR_Y_OFFSET);
    if (!ll) return;
    const baseZoom = map.getZoom() ?? 20;
    const z = Math.min(21, Math.round(baseZoom) + LOUPE_ZOOM_BOOST);
    const url =
      `https://maps.googleapis.com/maps/api/staticmap` +
      `?center=${ll.lat},${ll.lng}` +
      `&zoom=${z}&size=160x160&scale=2&maptype=satellite` +
      `&key=${GOOGLE_MAPS_API_KEY}`;
    if (lastLoupeUrlRef.current !== url) {
      lastLoupeUrlRef.current = url;
      setLoupeUrl(url);
    }
    lastLoupeAtRef.current = Date.now();
  }, [getMap, getContainer]);

  /** Computes lat/lng under the reticle at the current finger position and
   *  reports a single point placement. Used by both press-harder commits
   *  (mid-touch) and the legacy single-tap-on-release path. */
  const commitAtPos = useCallback((x: number, y: number) => {
    const map = getMap();
    const container = getContainer();
    if (!map || !container) return;
    const cursorY = y - CURSOR_Y_OFFSET;
    const ll = pixelToLatLng(map, container, x, cursorY);
    if (!ll) return;
    onPrecisePlace(ll);
    if ('vibrate' in navigator) try { navigator.vibrate([12, 18, 22]); } catch { /* ignore */ }
  }, [getMap, getContainer, onPrecisePlace]);

  /** Detect a "press harder" event from PointerEvent contact area. Returns
   *  true when the current area spikes above the rolling median baseline,
   *  with hysteresis + cooldown to avoid double-firing. */
  const detectPressHarder = useCallback((area: number): boolean => {
    if (!Number.isFinite(area) || area <= 0) return false;
    const samples = pressAreasRef.current;
    samples.push(area);
    if (samples.length > PRESS_BASELINE_SAMPLES) samples.shift();
    if (samples.length < PRESS_MIN_SAMPLES) return false;

    const sorted = [...samples].sort((a, b) => a - b);
    const baseline = sorted[Math.floor(sorted.length / 2)];
    const ratio = area / Math.max(baseline, 0.0001);

    // Re-arm: once pressure drops back near baseline, allow next press
    if (pressInProgressRef.current && ratio < 1.1) {
      pressInProgressRef.current = false;
      return false;
    }
    if (pressInProgressRef.current) return false;

    const now = Date.now();
    if (now - lastPressCommitAtRef.current < PRESS_COOLDOWN_MS) return false;

    if (ratio >= PRESS_RATIO_TRIGGER) {
      pressInProgressRef.current = true;
      lastPressCommitAtRef.current = now;
      // Reset baseline samples so the next press is measured against the new resting pressure
      pressAreasRef.current = [area];
      return true;
    }
    return false;
  }, []);

  const scheduleLoupeUpdate = useCallback((x: number, y: number) => {
    lastPosRef.current = { x, y };
    const now = Date.now();
    const elapsed = now - lastLoupeAtRef.current;
    if (elapsed >= LOUPE_REFRESH_MS) {
      if (loupeTimerRef.current) { clearTimeout(loupeTimerRef.current); loupeTimerRef.current = null; }
      updateLoupeNow(x, y);
    } else if (!loupeTimerRef.current) {
      loupeTimerRef.current = window.setTimeout(() => {
        loupeTimerRef.current = null;
        const p = lastPosRef.current;
        if (p) updateLoupeNow(p.x, p.y);
      }, LOUPE_REFRESH_MS - elapsed);
    }
  }, [updateLoupeNow]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return; // desktop uses native cursor
    const layer = layerRef.current;
    if (!layer) return;
    layer.setPointerCapture(e.pointerId);
    const rect = layer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    startedRef.current = true;
    setActive(true);
    setPos({ x, y });
    lastPosRef.current = { x, y };
    touchStartAtRef.current = Date.now();
    touchStartPosRef.current = { x, y };
    aimModeRef.current = false;
    pressAreasRef.current = [];
    lastPressCommitAtRef.current = 0;
    pressInProgressRef.current = false;
    anyPressCommitRef.current = false;
    freezeMap();
    updateLoupeNow(x, y);
    if ('vibrate' in navigator) try { navigator.vibrate(8); } catch { /* ignore */ }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startedRef.current) return;
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPos({ x, y });
    scheduleLoupeUpdate(x, y);

    // Aim-mode switch: once the user drags far enough OR holds long enough,
    // releasing the finger no longer commits — only press-harder does.
    if (!aimModeRef.current) {
      const start = touchStartPosRef.current;
      const dragPx = start ? Math.hypot(x - start.x, y - start.y) : 0;
      const heldMs = Date.now() - touchStartAtRef.current;
      if (dragPx >= AIM_MODE_DRAG_PX || heldMs >= AIM_MODE_HOLD_MS) {
        aimModeRef.current = true;
      }
    }

    // Press-harder detection from contact area
    const w = (e as any).width ?? 0;
    const h = (e as any).height ?? 0;
    const area = w * h;
    if (detectPressHarder(area)) {
      anyPressCommitRef.current = true;
      // Cancel any pending tap-commit so we don't double-fire on release
      if (pendingTapRef.current) { clearTimeout(pendingTapRef.current); pendingTapRef.current = null; }
      commitAtPos(x, y);
      setPressFlashKey((k) => k + 1);
    }
  };

  const finalize = (commit: boolean) => {
    const map = getMap();
    const container = getContainer();
    const p = pos;
    // If the device doesn't actually vary contact area with pressure (e.g.
    // some Androids and very old iOS), all samples will be near-identical.
    // In that case we can never detect "press harder", so we fall back to
    // the legacy release-commit even after entering aim mode — otherwise
    // the user would be stuck unable to place any point.
    const samples = pressAreasRef.current;
    let pressureSensingWorks = false;
    if (samples.length >= 4) {
      const min = Math.min(...samples);
      const max = Math.max(...samples);
      pressureSensingWorks = min > 0 && max / min > 1.08;
    }
    // Skip release-commit when the user already pressed-harder one or more
    // points OR when they're in aim mode on a device that DOES support
    // pressure sensing (so a deliberate press is the only commit gesture).
    const skipReleaseCommit =
      anyPressCommitRef.current ||
      (aimModeRef.current && pressureSensingWorks);
    if (commit && !skipReleaseCommit && map && container && p) {
      // Cursor is rendered Y_OFFSET above the finger → that's where the point goes.
      const cursorY = p.y - CURSOR_Y_OFFSET;
      const ll = pixelToLatLng(map, container, p.x, cursorY);
      if (ll) {
        const now = Date.now();
        const prev = lastTapRef.current;
        const isDouble = prev && (now - prev.t) < 320 && Math.hypot(p.x - prev.x, p.y - prev.y) < 40;
        if (isDouble && onPreciseDouble) {
          if (pendingTapRef.current) { clearTimeout(pendingTapRef.current); pendingTapRef.current = null; }
          lastTapRef.current = null;
          onPreciseDouble(prev!.ll);
          if ('vibrate' in navigator) try { navigator.vibrate([10, 30, 10]); } catch { /* ignore */ }
        } else {
          lastTapRef.current = { t: now, x: p.x, y: p.y, ll };
          if (pendingTapRef.current) clearTimeout(pendingTapRef.current);
          pendingTapRef.current = window.setTimeout(() => {
            onPrecisePlace(ll);
            if ('vibrate' in navigator) try { navigator.vibrate(15); } catch { /* ignore */ }
            pendingTapRef.current = null;
          }, 260);
        }
      }
    }
    startedRef.current = false;
    setActive(false);
    setPos(null);
    setLoupeUrl(null);
    lastLoupeUrlRef.current = null;
    lastPosRef.current = null;
    touchStartPosRef.current = null;
    aimModeRef.current = false;
    pressAreasRef.current = [];
    pressInProgressRef.current = false;
    anyPressCommitRef.current = false;
    if (loupeTimerRef.current) { clearTimeout(loupeTimerRef.current); loupeTimerRef.current = null; }
    unfreezeMap();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startedRef.current) return;
    try { layerRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    finalize(true);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startedRef.current) return;
    try { layerRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    finalize(false);
  };

  useEffect(() => () => {
    // Ensure we never leave the map frozen on unmount.
    if (loupeTimerRef.current) clearTimeout(loupeTimerRef.current);
    if (pendingTapRef.current) clearTimeout(pendingTapRef.current);
    if (savedRef.current) unfreezeMap();
  }, [unfreezeMap]);

  const cursorY = pos ? pos.y - CURSOR_Y_OFFSET : 0;
  const loupeRadius = LOUPE_SIZE / 2;

  return (
    <>
      <div
        ref={layerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{
          position: 'absolute', inset: 0, zIndex: 9,
          touchAction: 'none',
          background: 'transparent',
        }}
      />
      {active && pos && (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11,
          }}
        >
          {/* Finger ring */}
          <div style={{
            position: 'absolute',
            left: pos.x - 22, top: pos.y - 22,
            width: 44, height: 44, borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.45)',
            background: 'rgba(0,0,0,0.18)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
          }} />
          {/* Connector line from finger to loupe */}
          <svg
            style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' }}
          >
            <line
              x1={pos.x} y1={pos.y}
              x2={pos.x} y2={cursorY + loupeRadius}
              stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} strokeDasharray="3,3"
            />
          </svg>
          {/* Magnifier loupe with live zoomed satellite preview */}
          <div
            style={{
              position: 'absolute',
              left: pos.x - loupeRadius,
              top: cursorY - loupeRadius,
              width: LOUPE_SIZE,
              height: LOUPE_SIZE,
              borderRadius: '50%',
              overflow: 'hidden',
              background: 'rgba(0,0,0,0.4)',
              border: `3px solid ${color}`,
              boxShadow:
                '0 8px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.6), 0 0 0 5px rgba(255,255,255,0.18)',
              pointerEvents: 'none',
            }}
          >
            {loupeUrl && (
              <img
                src={loupeUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  objectFit: 'cover', userSelect: 'none', pointerEvents: 'none',
                }}
              />
            )}
            <svg
              width={LOUPE_SIZE}
              height={LOUPE_SIZE}
              viewBox={`0 0 ${LOUPE_SIZE} ${LOUPE_SIZE}`}
              style={{ position: 'absolute', inset: 0 }}
            >
              <line x1={loupeRadius} y1={8}                x2={loupeRadius} y2={loupeRadius - 10} stroke="white" strokeWidth="3" />
              <line x1={loupeRadius} y1={8}                x2={loupeRadius} y2={loupeRadius - 10} stroke={color} strokeWidth="1.5" />
              <line x1={loupeRadius} y1={loupeRadius + 10} x2={loupeRadius} y2={LOUPE_SIZE - 8}   stroke="white" strokeWidth="3" />
              <line x1={loupeRadius} y1={loupeRadius + 10} x2={loupeRadius} y2={LOUPE_SIZE - 8}   stroke={color} strokeWidth="1.5" />
              <line x1={8}                y1={loupeRadius} x2={loupeRadius - 10} y2={loupeRadius} stroke="white" strokeWidth="3" />
              <line x1={8}                y1={loupeRadius} x2={loupeRadius - 10} y2={loupeRadius} stroke={color} strokeWidth="1.5" />
              <line x1={loupeRadius + 10} y1={loupeRadius} x2={LOUPE_SIZE - 8}   y2={loupeRadius} stroke="white" strokeWidth="3" />
              <line x1={loupeRadius + 10} y1={loupeRadius} x2={LOUPE_SIZE - 8}   y2={loupeRadius} stroke={color} strokeWidth="1.5" />
              <circle cx={loupeRadius} cy={loupeRadius} r="3.5" fill={color} stroke="white" strokeWidth="1.5" />
              {/* Press-harder commit flash: expanding ring at the reticle, keyed by pressFlashKey to retrigger on each press */}
              {pressFlashKey > 0 && (
                <circle
                  key={pressFlashKey}
                  cx={loupeRadius}
                  cy={loupeRadius}
                  r="6"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  style={{ animation: 'mpl-press-ping 380ms ease-out forwards' }}
                />
              )}
            </svg>
          </div>
        </div>
      )}
      <style>{`
        @keyframes mpl-press-ping {
          0%   { r: 6;  opacity: 1;   stroke-width: 3; }
          100% { r: 42; opacity: 0;   stroke-width: 1; }
        }
      `}</style>
    </>
  );
};

export default MobilePrecisionLayer;