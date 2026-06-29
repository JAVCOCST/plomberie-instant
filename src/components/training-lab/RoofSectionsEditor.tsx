import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Check, Square, Pencil, Save, AlertTriangle } from 'lucide-react';
import {
  emptySection,
  SECTION_TYPE_COLORS,
  SECTION_TYPE_LABELS,
  buildSectionsBundle,
  type RoofSection,
  type RoofSectionsBundle,
  type SectionType,
  type QualityFlag,
  type SectionRole,
} from '@/lib/roof-sections';
import { optimizeSections } from '@/lib/roof-sections-ops';
import { toast } from 'sonner';

const ROLE_LABELS: Record<SectionRole, string> = {
  MAIN_PLANE: 'Plan principal',
  HIP_FRAGMENT: 'Frag. arête',
  VALLEY_CONNECTOR: 'Connect. noue',
  RESIDUAL_FRAGMENT: 'Résidu',
};
const ROLE_COLORS: Record<SectionRole, string> = {
  MAIN_PLANE: '#22c55e',
  HIP_FRAGMENT: '#f97316',
  VALLEY_CONNECTOR: '#0ea5e9',
  RESIDUAL_FRAGMENT: '#ef4444',
};

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
let gmsPromise: Promise<void> | null = null;
function ensureGMS(): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (gmsPromise) return gmsPromise;
  gmsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      existing.addEventListener('load', () => (window.google?.maps ? resolve() : reject(new Error('Google Maps non disponible'))), { once: true });
      existing.addEventListener('error', () => reject(new Error('Chargement Google Maps échoué')), { once: true });
      return;
    }
    if (!GOOGLE_MAPS_API_KEY) { reject(new Error('Clé Google Maps manquante')); return; }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    s.async = true;
    s.onload = () => (window.google?.maps ? resolve() : reject(new Error('Google Maps non disponible')));
    s.onerror = () => reject(new Error('Chargement Google Maps échoué'));
    document.head.appendChild(s);
  });
  return gmsPromise;
}

interface Props {
  centerLat: number;
  centerLng: number;
  zoom?: number;
  buildingRingLatLng?: [number, number][] | null; // [[lat,lng], ...]
  initialSections: RoofSection[];
  onClose: () => void;
  onSave: (bundle: RoofSectionsBundle) => void;
}

type Mode = 'idle' | 'drawing';

export default function RoofSectionsEditor({
  centerLat, centerLng, zoom = 20,
  buildingRingLatLng, initialSections, onClose, onSave,
}: Props) {
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const buildingPolyRef = useRef<google.maps.Polygon | null>(null);
  const sectionPolysRef = useRef<Map<string, google.maps.Polygon>>(new Map());
  const draftPolyRef = useRef<google.maps.Polyline | null>(null);
  const draftVerticesRef = useRef<google.maps.LatLngLiteral[]>([]);
  const draftMarkersRef = useRef<google.maps.Marker[]>([]);

  const [sections, setSections] = useState<RoofSection[]>(initialSections);
  const [activeId, setActiveId] = useState<string | null>(initialSections[0]?.section_id ?? null);
  const [mode, setMode] = useState<Mode>('idle');
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Init map ── */
  useEffect(() => {
    let cancelled = false;
    ensureGMS().then(() => {
      if (cancelled || !mapHostRef.current) return;
      const map = new google.maps.Map(mapHostRef.current, {
        center: { lat: centerLat, lng: centerLng },
        zoom,
        mapTypeId: 'satellite',
        tilt: 0,
        disableDefaultUI: false,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });
      mapRef.current = map;
      if (buildingRingLatLng && buildingRingLatLng.length >= 3) {
        buildingPolyRef.current = new google.maps.Polygon({
          paths: buildingRingLatLng.map(([la, lo]) => ({ lat: la, lng: lo })),
          map,
          strokeColor: '#22d3ee',
          strokeWeight: 2,
          strokeOpacity: 0.9,
          fillColor: '#22d3ee',
          fillOpacity: 0.04,
          clickable: false,
          zIndex: 100,
        });
      }
      setMapReady(true);
    }).catch((e) => setError(e?.message || String(e)));
    return () => {
      cancelled = true;
      buildingPolyRef.current?.setMap(null);
      sectionPolysRef.current.forEach((p) => p.setMap(null));
      sectionPolysRef.current.clear();
      draftPolyRef.current?.setMap(null);
      draftMarkersRef.current.forEach((m) => m.setMap(null));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Render section polygons (editable when active, read-only otherwise) ── */
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const existing = sectionPolysRef.current;
    const liveIds = new Set(sections.map((s) => s.section_id));
    // Remove stale
    for (const [id, poly] of existing) {
      if (!liveIds.has(id)) { poly.setMap(null); existing.delete(id); }
    }
    for (const sec of sections) {
      const color = SECTION_TYPE_COLORS[sec.section_type];
      const path = sec.polygon_latlng.map(([la, lo]) => ({ lat: la, lng: lo }));
      let poly = existing.get(sec.section_id);
      const editable = sec.section_id === activeId && mode === 'idle';
      // During drawing, sections must not intercept clicks nor change the cursor to a hand.
      const clickable = mode !== 'drawing';
      if (!poly) {
        poly = new google.maps.Polygon({
          map,
          paths: path,
          strokeColor: color,
          strokeWeight: editable ? 3 : 2,
          strokeOpacity: 0.95,
          fillColor: color,
          fillOpacity: editable ? 0.22 : 0.12,
          editable,
          draggable: false,
          clickable,
          zIndex: editable ? 1000 : 500,
        });
        // Listen to vertex edits → persist back to state
        const updateFromPath = () => {
          const p = poly!.getPath();
          const ring: [number, number][] = [];
          for (let i = 0; i < p.getLength(); i++) {
            const ll = p.getAt(i);
            ring.push([ll.lat(), ll.lng()]);
          }
          setSections((prev) => prev.map((s) => (s.section_id === sec.section_id ? { ...s, polygon_latlng: ring } : s)));
        };
        google.maps.event.addListener(poly.getPath(), 'set_at', updateFromPath);
        google.maps.event.addListener(poly.getPath(), 'insert_at', updateFromPath);
        google.maps.event.addListener(poly.getPath(), 'remove_at', updateFromPath);
        poly.addListener('click', () => setActiveId(sec.section_id));
        existing.set(sec.section_id, poly);
      } else {
        poly.setPath(path);
        poly.setOptions({
          strokeColor: color, fillColor: color,
          editable,
          strokeWeight: editable ? 3 : 2,
          fillOpacity: editable ? 0.22 : 0.12,
          clickable,
          zIndex: editable ? 1000 : 500,
        });
      }
    }
  }, [sections, activeId, mode, mapReady]);

  /* ── Drawing mode: click to add vertex, dbl-click to finish ── */
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    if (mode !== 'drawing') {
      // Cleanup draft
      draftPolyRef.current?.setMap(null); draftPolyRef.current = null;
      draftMarkersRef.current.forEach((m) => m.setMap(null));
      draftMarkersRef.current = [];
      draftVerticesRef.current = [];
      map.setOptions({ draggableCursor: undefined, draggingCursor: undefined });
      return;
    }
    // Force the same "round target" cursor as the measurement tools, over the
    // entire map AND while dragging, so it never reverts to a hand when
    // hovering existing sections / vertices.
    const targetCursor = buildTargetCursor('#f59e0b');
    map.setOptions({ draggableCursor: targetCursor, draggingCursor: targetCursor });
    draftVerticesRef.current = [];
    draftPolyRef.current = new google.maps.Polyline({
      map, path: [], strokeColor: '#f59e0b', strokeWeight: 3, strokeOpacity: 1, zIndex: 2000,
    });
    const clickListener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const pt = snapToExistingVertices(e.latLng.toJSON(), sections, 0.6);
      draftVerticesRef.current.push(pt);
      draftPolyRef.current!.setPath(draftVerticesRef.current);
      const m = new google.maps.Marker({
        map, position: pt,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: '#f59e0b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
        zIndex: 2100,
        clickable: false,
        cursor: 'crosshair',
      });
      draftMarkersRef.current.push(m);
    });
    const dblListener = map.addListener('dblclick', () => finishDraft());
    return () => {
      google.maps.event.removeListener(clickListener);
      google.maps.event.removeListener(dblListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mapReady, sections.length]);

  const finishDraft = () => {
    const verts = draftVerticesRef.current;
    if (verts.length < 3) { setError('Au moins 3 sommets requis'); setMode('idle'); return; }
    const ring: [number, number][] = verts.map((v) => [v.lat, v.lng]);
    // Default pitch = 4/12 (18.4°)
    const sec: RoofSection = { ...emptySection(sections.length), polygon_latlng: ring, pitch_deg: 18.4 };
    setSections((prev) => [...prev, sec]);
    setActiveId(sec.section_id);
    setMode('idle');
    setError(null);
  };

  const cancelDraft = () => { setMode('idle'); };

  const handleOptimize = () => {
    if (sections.length < 2) { toast.info('Au moins 2 sections requises'); return; }
    const { sections: next, report } = optimizeSections(sections);
    setSections(next);
    const merged = report.consolidation.merges.length;
    const split = report.split.splits.length;
    toast.success(`Optimisation : ${merged} fusion(s), ${split} décomposition(s) → ${report.finalCount} sections`);
  };

  const updateSection = (id: string, patch: Partial<RoofSection>) => {
    setSections((prev) => prev.map((s) => (s.section_id === id ? { ...s, ...patch } : s)));
  };
  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.section_id !== id));
    if (activeId === id) setActiveId(null);
  };

  const bundle = useMemo(() => buildSectionsBundle(sections, buildingRingLatLng || null, 0), [sections, buildingRingLatLng]);

  /* ── Auto-rename sections: "Section <n> @ <pitch>" ── */
  useEffect(() => {
    let changed = false;
    const next = sections.map((s, i) => {
      const auto = `Section ${i + 1} @ ${pitchLabel(s.pitch_deg)}`;
      if (s.label !== auto) { changed = true; return { ...s, label: auto }; }
      return s;
    });
    if (changed) setSections(next);
  }, [sections]);

  const handleSave = () => {
    onSave(bundle);
    onClose();
  };

  return createPortal(
    <div style={overlay}>
      <div className="rs-editor-root" style={modal}>
        <div style={header}>
          <Square size={16} color="#a855f7" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, color: '#fff', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Sections de toiture — éditeur</div>
          {mode === 'drawing' ? (
            <>
              <button onClick={finishDraft} className="rs-btn rs-primary"><Check size={13} /> Terminer ({draftVerticesRef.current.length})</button>
              <button onClick={cancelDraft} className="rs-btn">Annuler dessin</button>
            </>
          ) : (
            <>
              <button onClick={() => { setError(null); setMode('drawing'); }} className="rs-btn rs-primary"><Plus size={13} /> Nouvelle section</button>
              <button onClick={handleOptimize} className="rs-btn" title="Fusionner micro-sections + décomposer non-convexes">Optimiser</button>
            </>
          )}
          <button onClick={handleSave} className="rs-btn rs-primary"><Save size={13} /> Enregistrer</button>
          <button onClick={onClose} className="rs-btn"><X size={14} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Map */}
          <div style={{ flex: 1, minWidth: 0, position: 'relative', background: '#000' }}>
            <div ref={mapHostRef} style={{ position: 'absolute', inset: 0 }} />
            {error && (
              <div style={errorBanner}><AlertTriangle size={14} /> {error}</div>
            )}
            {mode === 'drawing' && (
              <div style={hintBanner}>
                <Pencil size={12} /> Cliquez sur la carte pour poser les sommets · double-clic ou « Terminer » pour fermer
              </div>
            )}
          </div>

          {/* Side panel */}
          <div style={panel}>
            <div style={panelHeader}>Sections ({sections.length})</div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {sections.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: '#9ca3af' }}>
                  Aucune section. Cliquez sur « Nouvelle section » puis dessinez sur la carte.
                </div>
              )}
              {sections.map((s) => {
                const isActive = s.section_id === activeId;
                const cs = bundle.diagnostics.convexity_scores[s.section_id] ?? 1;
                return (
                  <div key={s.section_id}
                    onClick={() => setActiveId(s.section_id)}
                    style={{
                      padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)',
                      background: isActive ? `${SECTION_TYPE_COLORS[s.section_type]}15` : 'transparent',
                      borderLeft: `3px solid ${isActive ? SECTION_TYPE_COLORS[s.section_type] : 'transparent'}`,
                      cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: SECTION_TYPE_COLORS[s.section_type] }} />
                      <div style={{ flex: 1, fontWeight: 700, fontSize: 12, color: '#e5e7eb' }}>{s.label}</div>
                      {s.section_role && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                          background: `${ROLE_COLORS[s.section_role]}22`,
                          color: ROLE_COLORS[s.section_role],
                          border: `1px solid ${ROLE_COLORS[s.section_role]}55`,
                        }} title={`Rôle architectural : ${ROLE_LABELS[s.section_role]}`}>
                          {ROLE_LABELS[s.section_role]}
                        </span>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); removeSection(s.section_id); }} className="rs-icon"><Trash2 size={12} color="#f87171" /></button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <label style={lblStyle}>
                        <span>Type</span>
                        <select value={s.section_type} onChange={(e) => updateSection(s.section_id, { section_type: e.target.value as SectionType })} onClick={(e) => e.stopPropagation()} style={input}>
                          {(Object.keys(SECTION_TYPE_LABELS) as SectionType[]).map((t) => (
                            <option key={t} value={t}>{SECTION_TYPE_LABELS[t]}</option>
                          ))}
                        </select>
                      </label>
                      <label style={lblStyle}>
                        <span>Qualité</span>
                        <select value={s.quality_flag} onChange={(e) => updateSection(s.section_id, { quality_flag: e.target.value as QualityFlag })} onClick={(e) => e.stopPropagation()} style={input}>
                          <option value="VERIFIED">Vérifié</option>
                          <option value="ESTIMATED">Estimé</option>
                          <option value="UNCERTAIN">Incertain</option>
                        </select>
                      </label>
                      <label style={lblStyle}>
                        <span>Pente</span>
                        <select
                          value={s.pitch_deg ?? ''}
                          onChange={(e) => updateSection(s.section_id, { pitch_deg: e.target.value === '' ? null : Number(e.target.value) })}
                          onClick={(e) => e.stopPropagation()}
                          style={input}
                        >
                          {PITCH_OPTIONS.map((o) => (
                            <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                      <label style={lblStyle}>
                        <span>Aspect</span>
                        <select
                          value={s.aspect_deg ?? ''}
                          onChange={(e) => updateSection(s.section_id, { aspect_deg: e.target.value === '' ? null : Number(e.target.value) })}
                          onClick={(e) => e.stopPropagation()}
                          style={input}
                        >
                          {ASPECT_OPTIONS.map((o) => (
                            <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 10, color: cs < 0.85 ? '#fbbf24' : '#9ca3af' }}>
                      {s.polygon_latlng.length} sommets · convexité {cs.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Diagnostics */}
            <div style={diagBox}>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Diagnostics</div>
              <Row k="Aire totale" v={`${bundle.diagnostics.total_section_area_m2.toFixed(1)} m²`} />
              {bundle.diagnostics.footprint_area_m2 != null && (
                <Row k="Empreinte" v={`${bundle.diagnostics.footprint_area_m2.toFixed(1)} m²`} />
              )}
              {bundle.diagnostics.footprint_coverage_pct != null && (
                <Row k="Couverture" v={`${bundle.diagnostics.footprint_coverage_pct}%`} />
              )}
              <Row k="Recouvrement" v={`${bundle.diagnostics.overlap_between_sections_pct}%`} />
              <Row k="Edges dérivées" v={String(bundle.roof_edges.length)} />
              <Row k="Migration" v={bundle.migration_status} />
              {bundle.diagnostics.warnings.slice(0, 4).map((w, i) => (
                <div key={i} style={{ marginTop: 4, fontSize: 10, color: '#fbbf24', display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                  <AlertTriangle size={10} style={{ marginTop: 2, flexShrink: 0 }} /> <span>{w.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <style>{css}</style>
      </div>
    </div>,
    document.body,
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1', padding: '2px 0' }}>
      <span style={{ color: '#94a3b8' }}>{k}</span>
      <span style={{ fontFamily: 'monospace' }}>{v}</span>
    </div>
  );
}

/** Standard roofing pitches (Quebec convention: rise/12) → degrees. */
const PITCH_OPTIONS: { label: string; value: number | null }[] = [
  { label: '— Non défini —', value: null },
  { label: 'Plat (0°)', value: 0 },
  { label: '1/12 (4.8°)', value: 4.8 },
  { label: '2/12 (9.5°)', value: 9.5 },
  { label: '3/12 (14°)', value: 14 },
  { label: '4/12 (18.4°)', value: 18.4 },
  { label: '5/12 (22.6°)', value: 22.6 },
  { label: '6/12 (26.6°)', value: 26.6 },
  { label: '7/12 (30.3°)', value: 30.3 },
  { label: '8/12 (33.7°)', value: 33.7 },
  { label: '9/12 (36.9°)', value: 36.9 },
  { label: '10/12 (39.8°)', value: 39.8 },
  { label: '12/12 (45°)', value: 45 },
  { label: '14/12 (49.4°)', value: 49.4 },
  { label: '16/12 (53.1°)', value: 53.1 },
  { label: '18/12 (56.3°)', value: 56.3 },
];

/** Cardinal/intercardinal aspects in degrees (0° = N, clockwise). */
const ASPECT_OPTIONS: { label: string; value: number | null }[] = [
  { label: '— Non défini —', value: null },
  { label: 'N (0°)', value: 0 },
  { label: 'NE (45°)', value: 45 },
  { label: 'E (90°)', value: 90 },
  { label: 'SE (135°)', value: 135 },
  { label: 'S (180°)', value: 180 },
  { label: 'SO (225°)', value: 225 },
  { label: 'O (270°)', value: 270 },
  { label: 'NO (315°)', value: 315 },
];

/** Snap a candidate vertex to the nearest existing section vertex if within `thresholdM` meters. */
function pitchLabel(deg: number | null | undefined): string {
  if (deg == null) return 'pente ?';
  if (deg < 1) return 'plat';
  const rise = Math.round(deg * 12 / 45); // rough inverse — refined below
  // Use known table for exact mapping
  const table: Array<[number, string]> = [
    [0, 'plat'], [4.8, '1/12'], [9.5, '2/12'], [14, '3/12'], [18.4, '4/12'],
    [22.6, '5/12'], [26.6, '6/12'], [30.3, '7/12'], [33.7, '8/12'], [36.9, '9/12'],
    [39.8, '10/12'], [45, '12/12'], [49.4, '14/12'], [53.1, '16/12'], [56.3, '18/12'],
  ];
  let best = table[0]; let bestD = Infinity;
  for (const row of table) {
    const d = Math.abs(row[0] - deg);
    if (d < bestD) { bestD = d; best = row; }
  }
  return best[1];
}

/** Build the same "round target" cursor as the measurement tools in
 *  BuildingReadOnlyMap, so the sections drawing cursor is consistent. */
function buildTargetCursor(hex: string): string {
  const c = hex.replace('#', '');
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'>` +
    `<circle cx='20' cy='20' r='13' fill='none' stroke='white' stroke-width='2.5'/>` +
    `<circle cx='20' cy='20' r='13' fill='none' stroke='%23${c}' stroke-width='1.5'/>` +
    `<line x1='20' y1='2' x2='20' y2='14' stroke='white' stroke-width='2.5'/>` +
    `<line x1='20' y1='2' x2='20' y2='14' stroke='%23${c}' stroke-width='1.5'/>` +
    `<line x1='20' y1='26' x2='20' y2='38' stroke='white' stroke-width='2.5'/>` +
    `<line x1='20' y1='26' x2='20' y2='38' stroke='%23${c}' stroke-width='1.5'/>` +
    `<line x1='2' y1='20' x2='14' y2='20' stroke='white' stroke-width='2.5'/>` +
    `<line x1='2' y1='20' x2='14' y2='20' stroke='%23${c}' stroke-width='1.5'/>` +
    `<line x1='26' y1='20' x2='38' y2='20' stroke='white' stroke-width='2.5'/>` +
    `<line x1='26' y1='20' x2='38' y2='20' stroke='%23${c}' stroke-width='1.5'/>` +
    `<circle cx='20' cy='20' r='1.5' fill='%23${c}'/>` +
    `</svg>`;
  return `url("data:image/svg+xml;utf8,${svg}") 20 20, crosshair`;
}

function snapToExistingVertices(pt: google.maps.LatLngLiteral, sections: RoofSection[], thresholdM: number): google.maps.LatLngLiteral {
  const R = 6378137;
  const toM = (a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) => {
    const φ1 = (a.lat * Math.PI) / 180;
    const dφ = ((b.lat - a.lat) * Math.PI) / 180;
    const dλ = ((b.lng - a.lng) * Math.PI) / 180;
    const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dλ / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
  };
  let best: google.maps.LatLngLiteral | null = null;
  let bestD = Infinity;
  for (const s of sections) {
    for (const [la, lo] of s.polygon_latlng) {
      const cand = { lat: la, lng: lo };
      const d = toM(pt, cand);
      if (d < bestD) { bestD = d; best = cand; }
    }
  }
  return best && bestD <= thresholdM ? best : pt;
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10500,
  display: 'flex', alignItems: 'stretch', justifyContent: 'stretch',
};
const modal: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', background: 'hsl(230,22%,8%)', color: '#e5e7eb', overflow: 'hidden',
  paddingTop: 'env(safe-area-inset-top)',
  paddingBottom: 'env(safe-area-inset-bottom)',
};
// flexWrap: header can break onto a second row on phones so the title is not
// crushed into a single column by the action buttons. minWidth: 0 on flex
// children lets the title actually shrink instead of forcing word-wrap.
const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)',
  flexWrap: 'wrap',
};
// Panel: keeps its 340px on tablet+, but on phones it falls back to ~60% of
// the viewport so the satellite map is still usable next to the section list.
const panel: React.CSSProperties = {
  width: 'min(340px, 60vw)', flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.08)', background: 'rgba(15,15,35,0.6)',
  display: 'flex', flexDirection: 'column', minHeight: 0,
};
const panelHeader: React.CSSProperties = {
  padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
  color: '#e2e8f0', background: 'rgba(25,25,50,0.6)', borderBottom: '1px solid rgba(255,255,255,0.06)',
};
const diagBox: React.CSSProperties = {
  borderTop: '1px solid rgba(255,255,255,0.08)', padding: 10, background: 'rgba(0,0,0,0.25)',
};
const input: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4, color: '#e2e8f0', fontSize: 11, padding: '3px 6px', minWidth: 0,
};
const lblStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: '#9ca3af' };
const errorBanner: React.CSSProperties = {
  position: 'absolute', top: 10, left: 10, right: 10, padding: '8px 12px',
  background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fecaca',
  borderRadius: 8, display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, zIndex: 10,
};
const hintBanner: React.CSSProperties = {
  position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
  padding: '8px 14px', background: 'rgba(245,158,11,0.92)', color: '#1f2937', borderRadius: 999,
  fontSize: 12, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center', zIndex: 10,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};
const css = `
.rs-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#e2e8f0;font-size:11px;cursor:pointer;}
.rs-btn:hover{background:rgba(255,255,255,0.1);}
.rs-primary{background:hsl(265,70%,55%);border-color:hsl(265,70%,55%);color:#fff;}
.rs-primary:hover{background:hsl(265,70%,60%);}
.rs-icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;border:none;background:transparent;color:#9ca3af;cursor:pointer;}
.rs-icon:hover{background:rgba(255,255,255,0.08);}
.rs-editor-root, .rs-editor-root *{
  -webkit-user-select:none; user-select:none;
  -webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;
}
.rs-editor-root input, .rs-editor-root textarea, .rs-editor-root [contenteditable]{
  -webkit-user-select:auto; user-select:auto;
  -webkit-touch-callout:default;
}
`;
