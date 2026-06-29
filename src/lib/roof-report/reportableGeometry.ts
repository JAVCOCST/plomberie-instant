/**
 * reportableGeometry.ts — port TS fidèle de reportable_geometry.py.
 *
 * SOURCE DE VÉRITÉ unique de ce que le rapport (et la vue 3D) doivent montrer.
 * Réduit la géométrie brute du moteur 3D (planes/valleys/sections) au sous-
 * ensemble « reportable » :
 *   - planes  : uniquement les facettes avec au moins un échantillon non occulté
 *   - edges   : arêtes de ces facettes, classées par topologie
 *   - valleys : uniquement les noues entre deux sections visibles
 *   - metrics : surfaces/longueurs calculées sur l'ensemble filtré
 *
 * INVARIANT : une facette/arête/noue cachée en 3D ⇒ absente de toute métrique,
 * table ou diagramme du rapport. (Vérifié par runReportTests.)
 */

export interface RPoint { x: number; y: number; t?: number }
export interface RPlaneEq { a: number; b: number; c: number }
export interface RPlane {
  id: string;
  section: string | number;
  kind: 'toiture' | 'pignon';
  dir: 'N' | 'E' | 'S' | 'O' | 'vertical';
  footprint: RPoint[];
  area3d: number;          // cm²
  pitch?: number;          // X/12 (toitures)
  plane?: RPlaneEq | null; // équation t = a·x + b·y + c (null pour pignons)
}
export interface RValley { id: string; sec1: string | number; sec2: string | number; a: RPoint; b: RPoint }
export interface ReportData { planes: RPlane[]; valleys?: RValley[]; sections?: any[] }

export type EdgeType = 'ridge' | 'hip' | 'valley' | 'rake' | 'eave' | 'step_flashing' | 'parapet';
export interface REdge {
  type: EdgeType; a: RPoint; b: RPoint; ta: number; tb: number;
  shared_by: string[]; n_shared: number;
}
export interface RMetrics {
  total_area_cm2: number; total_roof_cm2: number; total_wall_cm2: number;
  n_planes: number; n_toitures: number; n_pignons: number;
  n_sections: number; n_valleys: number;
  length_by_type: Partial<Record<EdgeType, number>>;
}
export interface ReportGeom {
  planes: RPlane[]; planes_hidden: RPlane[];
  edges: REdge[]; valleys: RValley[]; valleys_hidden: RValley[];
  metrics: RMetrics;
}

/* ── Primitives géométriques ───────────────────────────────────────────── */

export function pointInPolygon(x: number, y: number, pts: RPoint[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Élévation t au point (x,y) sur un plan incliné. null si pas d'équation. */
function planeTAt(plane: RPlane, x: number, y: number): number | null {
  const eq = plane.plane;
  if (!eq) return null;
  return (eq.a || 0) * x + (eq.b || 0) * y + (eq.c || 0);
}

const round = (v: number, p: number) => { const f = Math.pow(10, p); return Math.round(v * f) / f; };

/** Clé d'arête invariante à l'ordre (déduplication). */
export function canonicalEdgeKey(a: RPoint, b: RPoint, precision = 1): string {
  const p1 = [round(a.x, precision), round(a.y, precision), round(a.t || 0, precision)];
  const p2 = [round(b.x, precision), round(b.y, precision), round(b.t || 0, precision)];
  const arr = [p1, p2].sort((u, v) => (u[0] - v[0]) || (u[1] - v[1]) || (u[2] - v[2]));
  return JSON.stringify(arr);
}

/* ── Test d'occlusion ──────────────────────────────────────────────────── */

function samplePoints(plane: RPlane): Array<[number, number, number]> {
  const fp = plane.footprint, out: Array<[number, number, number]> = [];
  for (const p of fp) out.push([p.x, p.y, p.t || 0]);
  const n = fp.length;
  for (let i = 0; i < n; i++) {
    const a = fp[i], b = fp[(i + 1) % n];
    for (const r of [0.25, 0.5, 0.75]) out.push([a.x + (b.x - a.x) * r, a.y + (b.y - a.y) * r, (a.t || 0) + ((b.t || 0) - (a.t || 0)) * r]);
  }
  const cx = fp.reduce((s, p) => s + p.x, 0) / n, cy = fp.reduce((s, p) => s + p.y, 0) / n, ct = fp.reduce((s, p) => s + (p.t || 0), 0) / n;
  out.push([cx, cy, ct]);
  for (const p of fp) for (const r of [0.3, 0.6]) out.push([cx + (p.x - cx) * r, cy + (p.y - cy) * r, ct + ((p.t || 0) - ct) * r]);
  return out;
}

/** Une facette est occultée si CHAQUE échantillon est couvert (par-dessus) par
 *  une autre facette plus haute à cet endroit. Pignons (sans équation) ne
 *  cachent rien mais peuvent être cachés. */
export function isPlaneOccluded(plane: RPlane, all: RPlane[], eps = 2.0): boolean {
  const fp = plane.footprint;
  if (fp.length < 3) return true;
  for (const [sx, sy, st] of samplePoints(plane)) {
    let occludedHere = false;
    for (const other of all) {
      if (other.id === plane.id) continue;
      const ot = planeTAt(other, sx, sy);
      if (ot == null) continue;
      if (!pointInPolygon(sx, sy, other.footprint)) continue;
      if (ot > st + eps) { occludedHere = true; break; }
    }
    if (!occludedHere) return false; // au moins un échantillon visible
  }
  return true;
}

/* ── Classification d'arête ────────────────────────────────────────────── */

export function classifyEdge(ta: number, tb: number, nShared: number, eps = 0.5): EdgeType {
  if (nShared === 1) {
    if (ta < eps && tb < eps) return 'eave';
    if ((ta < eps) !== (tb < eps)) return 'rake';
    return 'ridge'; // peut devenir step_flashing plus bas
  }
  if (ta > eps && tb > eps) return Math.abs(ta - tb) < eps ? 'ridge' : 'hip';
  if (ta < eps && tb < eps) return 'eave';
  return 'valley';
}

/* ── Point d'entrée ────────────────────────────────────────────────────── */

export function buildReportable(data: ReportData): ReportGeom {
  const rawPlanes = data.planes || [];
  const rawValleys = data.valleys || [];

  // 1. Visibilité des facettes
  const visible: RPlane[] = [], hidden: RPlane[] = [];
  for (const plane of rawPlanes) (isPlaneOccluded(plane, rawPlanes) ? hidden : visible).push(plane);
  const visibleSections = new Set(visible.map((p) => p.section));

  // 2. Extraction des arêtes (facettes visibles uniquement)
  const edgeMap = new Map<string, Array<{ plane_id: string; a: RPoint; b: RPoint }>>();
  for (const plane of visible) {
    const fp = plane.footprint;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      const key = canonicalEdgeKey(a, b);
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key)!.push({ plane_id: plane.id, a, b });
    }
  }
  const edges: REdge[] = [];
  for (const occs of edgeMap.values()) {
    const { a, b } = occs[0];
    const ta = a.t || 0, tb = b.t || 0;
    edges.push({ type: classifyEdge(ta, tb, occs.length), a, b, ta, tb, shared_by: occs.map((o) => o.plane_id), n_shared: occs.length });
  }

  // 2b. Reclassement : « ridge » 1-partagé posé sur une autre facette = step_flashing
  for (const e of edges) {
    if (e.type !== 'ridge' || e.n_shared !== 1) continue;
    const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2, mt = (e.ta + e.tb) / 2;
    for (const other of visible) {
      if (e.shared_by.includes(other.id)) continue;
      const ot = planeTAt(other, mx, my);
      if (ot == null || !pointInPolygon(mx, my, other.footprint)) continue;
      if (Math.abs(mt - ot) < 5) { e.type = 'step_flashing'; break; }
    }
  }

  // 3. Noues — uniquement entre sections visibles
  const visibleValleys: RValley[] = [], hiddenValleys: RValley[] = [];
  for (const v of rawValleys) (visibleSections.has(v.sec1) && visibleSections.has(v.sec2) ? visibleValleys : hiddenValleys).push(v);

  // 4. Métriques (visibles uniquement)
  const sum = (arr: RPlane[]) => arr.reduce((s, p) => s + (p.area3d || 0), 0);
  const lengthByType: Partial<Record<EdgeType, number>> = {};
  for (const e of edges) {
    const L2 = Math.hypot(e.a.x - e.b.x, e.a.y - e.b.y);
    const L3 = Math.sqrt(L2 * L2 + (e.ta - e.tb) * (e.ta - e.tb));
    lengthByType[e.type] = (lengthByType[e.type] || 0) + L3;
  }
  const valleysExplicit = visibleValleys.reduce((s, v) => s + Math.hypot(v.a.x - v.b.x, v.a.y - v.b.y), 0);
  if (valleysExplicit > 0) lengthByType.valley = valleysExplicit;

  const metrics: RMetrics = {
    total_area_cm2: sum(visible),
    total_roof_cm2: sum(visible.filter((p) => p.kind === 'toiture')),
    total_wall_cm2: sum(visible.filter((p) => p.kind === 'pignon')),
    n_planes: visible.length,
    n_toitures: visible.filter((p) => p.kind === 'toiture').length,
    n_pignons: visible.filter((p) => p.kind === 'pignon').length,
    n_sections: visibleSections.size,
    n_valleys: visibleValleys.length,
    length_by_type: lengthByType,
  };

  return { planes: visible, planes_hidden: hidden, edges, valleys: visibleValleys, valleys_hidden: hiddenValleys, metrics };
}
