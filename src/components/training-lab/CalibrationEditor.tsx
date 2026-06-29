import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, RotateCcw, Image as ImageIcon } from 'lucide-react';
import type { TrainingTakeoff } from '@/lib/training-lab';
import {
  Ring,
  transformGeo,
  extractRings,
  centroidOf,
  transformRingAround,
  translateRing,
} from './calibration-geo';

interface Props {
  takeoff: TrainingTakeoff;
  onClose: () => void;
  onSaved: (patch: Partial<TrainingTakeoff>) => void | Promise<void>;
}

function bboxOfRings(rings: Ring[]): [number, number, number, number] | null {
  if (!rings.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

export default function CalibrationEditor({ takeoff, onClose, onSaved }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Calibration transforms (relative to original geojson). Stored as previously corrected if available.
  const init = useMemo(() => ({
    bdx: 0, bdy: 0, brot: takeoff.calibration_rotation_deg || 0, bscale: takeoff.calibration_scale || 1,
    ldx: 0, ldy: 0,
    confidence: takeoff.calibration_confidence ?? 0.7,
    notes: takeoff.calibration_notes || '',
  }), [takeoff.id]);
  const [t, setT] = useState(init);
  useEffect(() => setT(init), [init]);

  useEffect(() => {
    const u = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    u();
    window.addEventListener('resize', u);
    return () => window.removeEventListener('resize', u);
  }, []);

  const bldgRings = useMemo(() => extractRings(takeoff.corrected_building_geojson || takeoff.original_building_geojson), [takeoff]);
  const lotRings = useMemo(() => extractRings(takeoff.corrected_lot_geojson || takeoff.original_lot_geojson), [takeoff]);
  const annPoints: [number, number][] = useMemo(() => {
    const a: any = takeoff.annotations_json;
    if (!a) return [];
    if (Array.isArray(a?.points)) return a.points.map((p: any) => [p[0] ?? p.x, p[1] ?? p.y]);
    return [];
  }, [takeoff]);

  // Compute viewport bbox from union of lot + building
  const bbox = useMemo(() => bboxOfRings([...lotRings, ...bldgRings]) || [0, 0, 1, 1], [lotRings, bldgRings]);
  const [minX, minY, maxX, maxY] = bbox;
  const pad = 0.1;
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const vx = minX - w * pad, vy = minY - h * pad, vw = w * (1 + 2 * pad), vh = h * (1 + 2 * pad);

  const scale = Math.min(size.w / vw, size.h / vh);
  const project = (x: number, y: number): [number, number] => [
    (x - vx) * scale,
    (vh - (y - vy)) * scale, // flip Y for screen (geo Y is up)
  ];

  // Fix P1 : centroïde UNIQUE pour tout le bâtiment (toutes ses rings), pas
  // un centroïde par-ring. Empêche le drift inter-ring lors d'une rotation
  // d'un bâtiment à plusieurs anneaux (typique : cour intérieure).
  const bldgGlobalCentroid = useMemo<[number, number]>(
    () => centroidOf(bldgRings) || [0, 0],
    [bldgRings],
  );
  const transformBldg = (r: Ring): Ring =>
    transformRingAround(r, bldgGlobalCentroid, t.brot, t.bscale, t.bdx, t.bdy);
  const transformLot = (r: Ring): Ring => translateRing(r, t.ldx, t.ldy);

  const bldgTransformed = useMemo(() => bldgRings.map(transformBldg), [bldgRings, t, bldgGlobalCentroid]);
  const lotTransformed = useMemo(() => lotRings.map(transformLot), [lotRings, t]);

  const bldgCentroid = centroidOf(bldgTransformed);
  const annCentroid = annPoints.length ? [
    annPoints.reduce((s, p) => s + p[0], 0) / annPoints.length,
    annPoints.reduce((s, p) => s + p[1], 0) / annPoints.length,
  ] as [number, number] : null;

  const offsetPx = bldgCentroid && annCentroid
    ? { dx: +(annCentroid[0] - bldgCentroid[0]).toFixed(3), dy: +(annCentroid[1] - bldgCentroid[1]).toFixed(3) }
    : { dx: t.bdx, dy: t.bdy };

  // % annotations inside footprint
  const pctInside = useMemo(() => {
    if (!annPoints.length || !bldgTransformed.length) return null;
    const ring = bldgTransformed[0];
    const inside = (p: [number, number]) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const hit = ((yi > p[1]) !== (yj > p[1])) && (p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi);
        if (hit) c = !c;
      }
      return c;
    };
    const n = annPoints.filter(inside).length;
    return Math.round((n / annPoints.length) * 100);
  }, [annPoints, bldgTransformed]);

  const pointsToD = (rings: Ring[]) =>
    rings.map((r) => 'M ' + r.map(([x, y]) => project(x, y).join(',')).join(' L ') + ' Z').join(' ');

  // Drag handlers — Pointer Events for unified mouse / touch / stylus support
  const dragRef = useRef<{
    kind: 'bldg' | 'lot' | null;
    pointerId: number;
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
  } | null>(null);

  const onPointerDown = (kind: 'bldg' | 'lot') => (e: React.PointerEvent<SVGPathElement>) => {
    e.stopPropagation();
    // Capture so we keep receiving move/up even if pointer leaves the path
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = {
      kind,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseDx: kind === 'bldg' ? t.bdx : t.ldx,
      baseDy: kind === 'bldg' ? t.bdy : t.ldy,
    };
  };

  const onPointerMove = (e: React.PointerEvent<SVGPathElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // Prevent scroll/zoom while dragging on touch
    if (e.cancelable) e.preventDefault();
    const dx = (e.clientX - d.startX) / scale;
    const dy = -(e.clientY - d.startY) / scale; // flipped: geo Y is up
    setT((prev) => d.kind === 'bldg'
      ? { ...prev, bdx: d.baseDx + dx, bdy: d.baseDy + dy }
      : { ...prev, ldx: d.baseDx + dx, ldy: d.baseDy + dy });
  };

  const onPointerUp = (e: React.PointerEvent<SVGPathElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = null;
  };

  const reset = () => setT({ bdx: 0, bdy: 0, brot: 0, bscale: 1, ldx: 0, ldy: 0, confidence: t.confidence, notes: t.notes });

  const handleSave = async () => {
    // Fix P0 : `transformGeo` préserve le TYPE GeoJSON d'origine
    // (Polygon stays Polygon, MultiPolygon stays MultiPolygon, Feature
    // stays Feature). L'ancienne version réémettait toujours `type: 'Polygon'`
    // et corrompait silencieusement les MultiPolygon sources.
    const correctedBuilding = transformGeo(takeoff.original_building_geojson, transformBldg);
    const correctedLot = transformGeo(takeoff.original_lot_geojson, transformLot);
    await onSaved({
      corrected_building_geojson: correctedBuilding,
      corrected_lot_geojson: correctedLot,
      calibration_offset_px: offsetPx,
      calibration_rotation_deg: t.brot,
      calibration_scale: t.bscale,
      calibration_confidence: t.confidence,
      calibration_notes: t.notes,
      calibration_status: pctInside != null && pctInside < 50 ? 'issue' : 'ok',
      dataset_status: 'corrected',
    });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100,
      display: 'flex', flexDirection: 'column', color: '#e5e7eb',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      <style>{`
        @media (max-width: 768px) {
          .calib-body { flex-direction: column !important; }
          .calib-canvas { flex: 1 1 auto !important; min-height: 50vh !important; }
          .calib-side { width: 100% !important; border-left: none !important; border-top: 1px solid hsl(230,20%,15%); max-height: 45vh; }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid hsl(230,20%,18%)', background: 'hsl(230,22%,8%)' }}>
        <strong>Recalage — {takeoff.reference || takeoff.id.slice(0, 6)}</strong>
        <span style={{ color: 'hsl(230,10%,55%)', fontSize: 12 }}>{takeoff.address || ''}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={reset} className="vb-btn"><RotateCcw size={13} /> Reset</button>
          <button onClick={handleSave} className="vb-btn vb-btn-primary"><Save size={13} /> Sauvegarder</button>
          <button onClick={onClose} className="vb-btn"><X size={13} /> Fermer</button>
        </div>
      </div>

      <div className="calib-body" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div ref={wrapRef} className="calib-canvas" style={{ flex: 1, position: 'relative', background: '#0a0a0a', overflow: 'hidden', minHeight: 0, touchAction: 'none' }}>
          {takeoff.raw_image_url ? (
            <img
              src={takeoff.raw_image_url}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.5 }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(230,10%,40%)', flexDirection: 'column', gap: 8 }}>
              <ImageIcon size={40} /> Aucune image brute
            </div>
          )}
          <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0 }}>
            {/* Lot */}
            {lotTransformed.length > 0 && (
              <path
                d={pointsToD(lotTransformed)}
                fill="rgba(120, 220, 255, 0.10)"
                stroke="hsl(200, 80%, 60%)"
                strokeWidth={2}
                strokeDasharray="6 4"
                onPointerDown={onPointerDown('lot')}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ cursor: 'move', touchAction: 'none' }}
              />
            )}
            {/* Building */}
            {bldgTransformed.length > 0 && (
              <path
                d={pointsToD(bldgTransformed)}
                fill="rgba(255, 180, 80, 0.18)"
                stroke="hsl(35, 95%, 60%)"
                strokeWidth={2.5}
                onPointerDown={onPointerDown('bldg')}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ cursor: 'move', touchAction: 'none' }}
              />
            )}
            {/* Annotations */}
            {annPoints.map(([x, y], i) => {
              const [px, py] = project(x, y);
              return <circle key={i} cx={px} cy={py} r={3} fill="hsl(140,80%,55%)" />;
            })}
            {/* Centroids */}
            {bldgCentroid && (() => { const [px, py] = project(bldgCentroid[0], bldgCentroid[1]); return <circle cx={px} cy={py} r={5} fill="hsl(35,95%,60%)" stroke="#fff" strokeWidth={1.5} />; })()}
            {annCentroid && (() => { const [px, py] = project(annCentroid[0], annCentroid[1]); return <circle cx={px} cy={py} r={5} fill="hsl(140,80%,55%)" stroke="#fff" strokeWidth={1.5} />; })()}
          </svg>
        </div>

        <aside className="calib-side" style={{ width: 300, background: 'hsl(230,22%,9%)', borderLeft: '1px solid hsl(230,20%,15%)', padding: 14, overflowY: 'auto', fontSize: 12 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ color: 'hsl(230,10%,50%)', textTransform: 'uppercase', fontSize: 10, marginBottom: 6 }}>Bâtiment — translation</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1 }}>ΔX <input type="number" step={0.000001} value={t.bdx} onChange={(e) => setT({ ...t, bdx: +e.target.value })} style={inp} /></label>
              <label style={{ flex: 1 }}>ΔY <input type="number" step={0.000001} value={t.bdy} onChange={(e) => setT({ ...t, bdy: +e.target.value })} style={inp} /></label>
            </div>
            <label>Rotation° <input type="range" min={-45} max={45} step={0.5} value={t.brot} onChange={(e) => setT({ ...t, brot: +e.target.value })} style={{ width: '100%' }} /> {t.brot.toFixed(1)}°</label>
            <label>Scale <input type="range" min={0.5} max={1.5} step={0.01} value={t.bscale} onChange={(e) => setT({ ...t, bscale: +e.target.value })} style={{ width: '100%' }} /> {t.bscale.toFixed(2)}×</label>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ color: 'hsl(230,10%,50%)', textTransform: 'uppercase', fontSize: 10, marginBottom: 6 }}>Lot — translation</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1 }}>ΔX <input type="number" step={0.000001} value={t.ldx} onChange={(e) => setT({ ...t, ldx: +e.target.value })} style={inp} /></label>
              <label style={{ flex: 1 }}>ΔY <input type="number" step={0.000001} value={t.ldy} onChange={(e) => setT({ ...t, ldy: +e.target.value })} style={inp} /></label>
            </div>
          </div>

          <div style={{ padding: 10, borderRadius: 8, background: 'hsl(230,22%,12%)', marginBottom: 14 }}>
            <div style={{ color: 'hsl(230,10%,55%)', marginBottom: 4 }}>Offset centroid</div>
            <div>ΔX: <strong>{offsetPx.dx}</strong></div>
            <div>ΔY: <strong>{offsetPx.dy}</strong></div>
            <div style={{ marginTop: 6 }}>Annotations dans footprint:
              <strong style={{ marginLeft: 6, color: pctInside != null ? (pctInside >= 80 ? 'hsl(140,65%,55%)' : pctInside >= 50 ? 'hsl(38,90%,55%)' : 'hsl(0,70%,60%)') : 'hsl(230,10%,50%)' }}>
                {pctInside != null ? `${pctInside}%` : '—'}
              </strong>
            </div>
          </div>

          <label style={{ display: 'block', marginBottom: 10 }}>
            <div style={{ color: 'hsl(230,10%,55%)', marginBottom: 4 }}>Confidence ({t.confidence.toFixed(2)})</div>
            <input type="range" min={0} max={1} step={0.05} value={t.confidence} onChange={(e) => setT({ ...t, confidence: +e.target.value })} style={{ width: '100%' }} />
          </label>

          <label style={{ display: 'block' }}>
            <div style={{ color: 'hsl(230,10%,55%)', marginBottom: 4 }}>Notes</div>
            <textarea
              value={t.notes}
              onChange={(e) => setT({ ...t, notes: e.target.value })}
              rows={4}
              style={{ width: '100%', background: 'hsl(230,22%,12%)', color: '#e5e7eb', border: '1px solid hsl(230,20%,18%)', borderRadius: 6, padding: 6, fontSize: 12, resize: 'vertical' }}
            />
          </label>

          <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: 'hsl(230,22%,12%)', fontSize: 11, color: 'hsl(230,10%,60%)' }}>
            Glisse les polygons directement à la souris. Les <strong style={{ color: 'hsl(35,95%,60%)' }}>contours orange</strong> = bâtiment,
            <strong style={{ color: 'hsl(200,80%,60%)' }}> bleu pointillé</strong> = lot,
            <strong style={{ color: 'hsl(140,80%,55%)' }}> points verts</strong> = annotations.
            Les originaux ne sont jamais écrasés.
          </div>
        </aside>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: '100%', background: 'hsl(230,22%,12%)', color: '#e5e7eb',
  border: '1px solid hsl(230,20%,18%)', borderRadius: 4, padding: '3px 6px', fontSize: 11,
};