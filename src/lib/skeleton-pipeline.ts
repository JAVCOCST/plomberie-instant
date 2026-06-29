/**
 * Skeleton pipeline (geometry-first, no ML).
 *
 * Pipeline:
 *   1. validateBuildingPolygon  → garantit qu'on a un polygone exploitable
 *   2. buildEdgeFeatures        → enrichit chaque arête avec features géométriques
 *   3. simplifySkeletonGraph    → fusionne colinéaires, élague micro-branches
 *   4. classifySkeletonEdges    → ridge / valley / hip / unknown (règles)
 *   5. matchSkeletonToHuman     → matching robuste sur sections
 *
 * Tout fonctionne en mètres locaux (equirectangular autour du centroïde).
 */

export type Pt = [number, number]; // [x_m, y_m]

export interface RawEdge {
  id: string;
  a: Pt;
  b: Pt;
  interior: boolean;
  /** Indices des sommets dans la structure de skeleton brute (utile pour topologie). */
  ia?: number;
  ib?: number;
}

export interface EnrichedEdge extends RawEdge {
  length_m: number;
  length_normalized: number;          // length / perimeter
  orientation_deg: number;            // [-180, 180]
  angle_to_principal_axis_deg: number;// [0, 90]
  distance_to_boundary_m: number;
  is_terminal: boolean;
  is_from_concave_vertex: boolean;
  n_connected_edges: number;
  collinearity_group_id: number;
  // Phase 4 — heuristic classifier
  predicted_type: 'ridge' | 'valley' | 'hip' | 'unknown';
  predicted_confidence: number;
  classification_reasons: string[];
  // Phase 5 — matching (rempli après matchSkeletonToHuman)
  matched_human_id: string | null;
  match_chamfer_m: number | null;
  match_angle_delta_deg: number | null;
  match_overlap_ratio: number | null;
  match_status: 'matched' | 'partial_match' | 'unmatched';
}

export interface PolygonValidation {
  valid: boolean;
  n_vertices: number;
  closed: boolean;
  self_intersecting: boolean;
  area_m2: number;
  perimeter_m: number;
  ring_ccw_m: Pt[] | null;
  concave_vertex_indices: number[];
  principal_axis_deg: number; // [-90, 90]
  reasons: string[];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 1 — validation polygon                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

function isSelfIntersecting(ring: Pt[]): boolean {
  const n = ring.length - 1;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      // skip adjacent edges (including wrap-around)
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

/** Détecte les sommets concaves (cross product de sens opposé à l'orientation
 *  globale du ring). Le ring fourni doit être CCW et fermé. */
function concaveVertexIndices(ring: Pt[]): number[] {
  const n = ring.length - 1;
  const out: number[] = [];
  if (n < 4) return out;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    if (cross < -1e-6) out.push(i);
  }
  return out;
}

/** Axe principal du footprint par PCA simple. Retourne l'angle en deg
 *  dans [-90, 90] de la direction du grand axe. */
function principalAxisDeg(ring: Pt[]): number {
  if (ring.length < 3) return 0;
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of ring) {
    const dx = x - cx, dy = y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  // angle of largest eigenvector of [[sxx, sxy],[sxy, syy]]
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let deg = (ang * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

/** Valide un ring de polygon (déjà projeté en mètres). */
export function validateBuildingPolygon(ringM: Pt[] | null | undefined): PolygonValidation {
  const reasons: string[] = [];
  if (!ringM || ringM.length === 0) {
    return {
      valid: false, n_vertices: 0, closed: false, self_intersecting: false,
      area_m2: 0, perimeter_m: 0, ring_ccw_m: null,
      concave_vertex_indices: [], principal_axis_deg: 0,
      reasons: ['empty_ring'],
    };
  }
  let ring = ringM.slice();
  const first = ring[0], last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  if (!closed) ring.push([first[0], first[1]]);
  const n = ring.length - 1;
  if (n < 3) reasons.push('lt_3_vertices');
  // ensure CCW
  if (signedArea(ring) < 0) ring = ring.slice().reverse();
  const area = Math.abs(signedArea(ring));
  let perim = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    perim += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]);
  }
  const selfX = isSelfIntersecting(ring);
  if (selfX) reasons.push('self_intersection');
  if (area < 1) reasons.push('area_too_small');
  const concaves = concaveVertexIndices(ring);
  const axis = principalAxisDeg(ring);
  return {
    valid: reasons.length === 0 && n >= 3,
    n_vertices: n,
    closed: true,
    self_intersecting: selfX,
    area_m2: area,
    perimeter_m: perim,
    ring_ccw_m: ring,
    concave_vertex_indices: concaves,
    principal_axis_deg: axis,
    reasons,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 2 — features géométriques                                            */
/* ────────────────────────────────────────────────────────────────────────── */

function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distPointToRing(px: number, py: number, ring: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) {
    const d = distPointToSegment(px, py, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

function edgeOrientation(a: Pt, b: Pt): number {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

function angleDelta(a: number, b: number): number {
  let d = Math.abs(((a - b + 540) % 360) - 180);
  if (d > 90) d = 180 - d; // colinear regardless of direction
  return d;
}

/** Distance entre 2 endpoints (le plus proche). */
function endpointGap(e1: EnrichedEdge, e2: EnrichedEdge): number {
  const cands = [
    Math.hypot(e1.a[0] - e2.a[0], e1.a[1] - e2.a[1]),
    Math.hypot(e1.a[0] - e2.b[0], e1.a[1] - e2.b[1]),
    Math.hypot(e1.b[0] - e2.a[0], e1.b[1] - e2.a[1]),
    Math.hypot(e1.b[0] - e2.b[0], e1.b[1] - e2.b[1]),
  ];
  return Math.min(...cands);
}

export function buildEdgeFeatures(
  rawEdges: RawEdge[],
  validation: PolygonValidation,
): EnrichedEdge[] {
  const ring = validation.ring_ccw_m || [];
  const perim = Math.max(0.01, validation.perimeter_m);
  const concaves = new Set(
    validation.concave_vertex_indices.map((i) => `${ring[i]?.[0].toFixed(3)}_${ring[i]?.[1].toFixed(3)}`),
  );
  // n_connected_edges: vertex index map (par position arrondie)
  const vertexKey = (p: Pt) => `${p[0].toFixed(3)}_${p[1].toFixed(3)}`;
  const degree = new Map<string, number>();
  for (const e of rawEdges) {
    degree.set(vertexKey(e.a), (degree.get(vertexKey(e.a)) || 0) + 1);
    degree.set(vertexKey(e.b), (degree.get(vertexKey(e.b)) || 0) + 1);
  }
  const enriched: EnrichedEdge[] = rawEdges.map((e) => {
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    const orient = edgeOrientation(e.a, e.b);
    const da = distPointToRing(e.a[0], e.a[1], ring);
    const db = distPointToRing(e.b[0], e.b[1], ring);
    const dist = Math.min(da, db);
    const dA = degree.get(vertexKey(e.a)) || 0;
    const dB = degree.get(vertexKey(e.b)) || 0;
    const is_terminal = dA === 1 || dB === 1;
    const isFromConcave = concaves.has(vertexKey(e.a)) || concaves.has(vertexKey(e.b));
    return {
      ...e,
      length_m: len,
      length_normalized: len / perim,
      orientation_deg: orient,
      angle_to_principal_axis_deg: angleDelta(orient, validation.principal_axis_deg),
      distance_to_boundary_m: dist,
      is_terminal,
      is_from_concave_vertex: isFromConcave,
      n_connected_edges: dA + dB,
      collinearity_group_id: -1,
      predicted_type: 'unknown',
      predicted_confidence: 0,
      classification_reasons: [],
      matched_human_id: null,
      match_chamfer_m: null,
      match_angle_delta_deg: null,
      match_overlap_ratio: null,
      match_status: 'unmatched',
    };
  });

  // groupes de colinéarité (delta_angle < 10°, endpoint gap < 0.5m)
  const ANG_TOL = 10;
  const GAP_TOL = 0.5;
  let gid = 0;
  for (let i = 0; i < enriched.length; i++) {
    if (enriched[i].collinearity_group_id !== -1) continue;
    enriched[i].collinearity_group_id = gid;
    // BFS naive
    const queue = [i];
    while (queue.length) {
      const k = queue.shift()!;
      for (let j = 0; j < enriched.length; j++) {
        if (enriched[j].collinearity_group_id !== -1) continue;
        if (angleDelta(enriched[k].orientation_deg, enriched[j].orientation_deg) < ANG_TOL
          && endpointGap(enriched[k], enriched[j]) < GAP_TOL) {
          enriched[j].collinearity_group_id = gid;
          queue.push(j);
        }
      }
    }
    gid++;
  }
  return enriched;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 3 — graph simplification                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SimplifiedEdge {
  group_id: number;
  a: Pt;
  b: Pt;
  length_m: number;
  orientation_deg: number;
  source_ids: string[];
}

export interface SimplificationResult {
  simplified_edges: SimplifiedEdge[];
  major_axes: SimplifiedEdge[];        // top 1-3 par longueur, ≥ 25% du max
  ridge_candidates: SimplifiedEdge[];
  valley_candidates: SimplifiedEdge[];
  hip_candidates: SimplifiedEdge[];
  pruned_count: number;
  merged_groups_count: number;
}

/** Fusionne un groupe d'arêtes colinéaires en une seule arête en projetant
 *  tous les endpoints sur la direction du groupe. */
function mergeCollinearGroup(edges: EnrichedEdge[]): SimplifiedEdge {
  // direction = orientation pondérée par longueur
  let sumX = 0, sumY = 0, totLen = 0;
  for (const e of edges) {
    const rad = (e.orientation_deg * Math.PI) / 180;
    sumX += Math.cos(2 * rad) * e.length_m;
    sumY += Math.sin(2 * rad) * e.length_m;
    totLen += e.length_m;
  }
  const dirDeg = 0.5 * (Math.atan2(sumY, sumX) * 180 / Math.PI);
  const dirRad = (dirDeg * Math.PI) / 180;
  const ux = Math.cos(dirRad), uy = Math.sin(dirRad);
  // origine = barycentre pondéré
  let cx = 0, cy = 0;
  for (const e of edges) {
    cx += (e.a[0] + e.b[0]) / 2 * e.length_m;
    cy += (e.a[1] + e.b[1]) / 2 * e.length_m;
  }
  cx /= Math.max(1e-6, totLen); cy /= Math.max(1e-6, totLen);
  let tMin = Infinity, tMax = -Infinity;
  let aPt: Pt = edges[0].a, bPt: Pt = edges[0].b;
  for (const e of edges) {
    for (const p of [e.a, e.b]) {
      const t = (p[0] - cx) * ux + (p[1] - cy) * uy;
      if (t < tMin) { tMin = t; aPt = [cx + t * ux, cy + t * uy]; }
      if (t > tMax) { tMax = t; bPt = [cx + t * ux, cy + t * uy]; }
    }
  }
  const len = Math.hypot(bPt[0] - aPt[0], bPt[1] - aPt[1]);
  return {
    group_id: edges[0].collinearity_group_id,
    a: aPt, b: bPt,
    length_m: len,
    orientation_deg: dirDeg,
    source_ids: edges.map((e) => e.id),
  };
}

export function simplifySkeletonGraph(
  enriched: EnrichedEdge[],
  validation: PolygonValidation,
): SimplificationResult {
  const interior = enriched.filter((e) => e.interior);
  // groupes
  const byGroup = new Map<number, EnrichedEdge[]>();
  for (const e of interior) {
    const arr = byGroup.get(e.collinearity_group_id) || [];
    arr.push(e);
    byGroup.set(e.collinearity_group_id, arr);
  }
  const merged: SimplifiedEdge[] = [];
  for (const arr of byGroup.values()) merged.push(mergeCollinearGroup(arr));

  // prune: micro-terminal & noise
  const perim = Math.max(1, validation.perimeter_m);
  const MIN_LEN_M = 1.0;
  const MIN_NORM = 0.03; // <3% du périmètre = bruit
  const pruned: SimplifiedEdge[] = [];
  let prunedCount = 0;
  for (const m of merged) {
    const isTerminalGroup = byGroup.get(m.group_id)!.some((e) => e.is_terminal);
    const tooShort = m.length_m < MIN_LEN_M;
    const lowNorm = m.length_m / perim < MIN_NORM;
    if (isTerminalGroup && (tooShort || lowNorm)) { prunedCount++; continue; }
    pruned.push(m);
  }

  // major axes (top par longueur, ≥ 25% du max)
  const sorted = [...pruned].sort((a, b) => b.length_m - a.length_m);
  const maxLen = sorted[0]?.length_m || 0;
  const majorAxes = sorted.filter((e) => e.length_m >= 0.25 * maxLen).slice(0, 3);

  // candidats par règles légères (le classifier final passera ensuite)
  const ridgeCands: SimplifiedEdge[] = [];
  const valleyCands: SimplifiedEdge[] = [];
  const hipCands: SimplifiedEdge[] = [];
  for (const m of pruned) {
    // re-cherche dist boundary depuis milieu
    const mx = (m.a[0] + m.b[0]) / 2, my = (m.a[1] + m.b[1]) / 2;
    const distB = distPointToRing(mx, my, validation.ring_ccw_m || []);
    const angAxis = angleDelta(m.orientation_deg, validation.principal_axis_deg);
    const fromConcave = byGroup.get(m.group_id)!.some((e) => e.is_from_concave_vertex);
    if (fromConcave) valleyCands.push(m);
    else if (m.length_m / perim > 0.15 && angAxis < 20 && distB > 2) ridgeCands.push(m);
    else if (distB < 2) hipCands.push(m);
  }

  return {
    simplified_edges: pruned,
    major_axes: majorAxes,
    ridge_candidates: ridgeCands,
    valley_candidates: valleyCands,
    hip_candidates: hipCands,
    pruned_count: prunedCount,
    merged_groups_count: merged.length,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 4 — classifier heuristique V0                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export function classifySkeletonEdges(
  enriched: EnrichedEdge[],
  validation: PolygonValidation,
): void {
  const perim = Math.max(1, validation.perimeter_m);
  for (const e of enriched) {
    if (!e.interior) {
      e.predicted_type = 'unknown';
      e.predicted_confidence = 0;
      e.classification_reasons = ['exterior'];
      continue;
    }
    const reasons: string[] = [];
    let type: EnrichedEdge['predicted_type'] = 'unknown';
    let conf = 0;
    if (e.is_from_concave_vertex) {
      type = 'valley';
      conf = 0.7;
      reasons.push('from_concave_vertex');
    } else if (
      e.length_m / perim > 0.15
      && e.angle_to_principal_axis_deg < 20
      && e.distance_to_boundary_m > 2
    ) {
      type = 'ridge';
      conf = 0.75;
      reasons.push('long', 'aligned_principal_axis', 'far_from_boundary');
    } else if (e.distance_to_boundary_m < 2) {
      type = 'hip';
      conf = 0.6;
      reasons.push('near_boundary');
    } else {
      type = 'unknown';
      conf = 0.3;
      reasons.push('fallback');
    }
    e.predicted_type = type;
    e.predicted_confidence = conf;
    e.classification_reasons = reasons;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Phase 5 — matching skeleton ↔ humain                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export interface HumanAnnotation {
  id: string;
  /** Type humain attendu pour matching ciblé (ridge/valley/hip), null = inconnu. */
  type: 'ridge' | 'valley' | 'hip' | null;
  /** Échantillons denses en mètres locaux le long de la polyligne humaine. */
  samples_m: Pt[];
  /** Orientation globale (premier → dernier point), en deg. */
  orientation_deg: number | null;
  length_m: number;
}

export interface MatchingResult {
  matched_count: number;
  partial_count: number;
  unmatched_count: number;
  matching_valid: boolean;
}

/** Matching robuste. Pour chaque edge skeleton interior, cherche l'annotation
 *  humaine de même type compatible la plus proche (chamfer + angle + overlap). */
export function matchSkeletonToHumanAnnotations(
  enriched: EnrichedEdge[],
  humans: HumanAnnotation[],
  opts: { chamferMaxM?: number; angleMaxDeg?: number; overlapMinRatio?: number } = {},
): MatchingResult {
  const chamferMax = opts.chamferMaxM ?? 2.5;
  const angleMax = opts.angleMaxDeg ?? 25;
  const overlapMin = opts.overlapMinRatio ?? 0.35;

  for (const e of enriched) {
    if (!e.interior) continue;
    // échantillonne arête
    const lenGeom = e.length_m;
    const n = Math.max(2, Math.min(30, Math.round(lenGeom / 0.3)));
    const samples: Pt[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      samples.push([e.a[0] + t * (e.b[0] - e.a[0]), e.a[1] + t * (e.b[1] - e.a[1])]);
    }
    // matching prioritaire sur même type, fallback sur tout
    const candidates = humans.filter((h) => !h.type || h.type === e.predicted_type);
    const pool = candidates.length ? candidates : humans;
    let bestChamfer = Infinity;
    let bestAng: number | null = null;
    let bestOverlap = 0;
    let bestId: string | null = null;
    for (const h of pool) {
      if (!h.samples_m.length) continue;
      let sum = 0;
      let inBand = 0;
      for (const [sx, sy] of samples) {
        let dmin = Infinity;
        for (const [hx, hy] of h.samples_m) {
          const d = Math.hypot(sx - hx, sy - hy);
          if (d < dmin) dmin = d;
        }
        sum += dmin;
        if (dmin < 1.0) inBand++;
      }
      const avg = sum / samples.length;
      if (avg < bestChamfer) {
        bestChamfer = avg;
        bestId = h.id;
        bestOverlap = inBand / samples.length;
        bestAng = h.orientation_deg != null ? angleDelta(e.orientation_deg, h.orientation_deg) : null;
      }
    }
    e.matched_human_id = bestId;
    e.match_chamfer_m = Number.isFinite(bestChamfer) ? bestChamfer : null;
    e.match_angle_delta_deg = bestAng;
    e.match_overlap_ratio = bestOverlap;
    const angOk = bestAng == null || bestAng < angleMax;
    if (bestChamfer < chamferMax * 0.5 && angOk && bestOverlap > 0.6) e.match_status = 'matched';
    else if (bestChamfer < chamferMax && angOk && bestOverlap > overlapMin) e.match_status = 'partial_match';
    else e.match_status = 'unmatched';
  }

  let matched = 0, partial = 0, unmatched = 0;
  for (const e of enriched) {
    if (!e.interior) continue;
    if (e.match_status === 'matched') matched++;
    else if (e.match_status === 'partial_match') partial++;
    else unmatched++;
  }
  const total = matched + partial + unmatched;
  return {
    matched_count: matched,
    partial_count: partial,
    unmatched_count: unmatched,
    matching_valid: total > 0 && (matched + partial) / total >= 0.3,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers d'orchestration                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface PipelineSummary {
  geometry_valid: boolean;
  geometry_reasons: string[];
  raw_edges_count: number;
  interior_edges_count: number;
  merged_groups_count: number;
  simplified_edges_count: number;
  pruned_count: number;
  ridge_candidates_count: number;
  valley_candidates_count: number;
  hip_candidates_count: number;
  matched_edges_count: number;
  partial_edges_count: number;
  unmatched_edges_count: number;
  matching_valid: boolean;
  simplification_ratio: number; // simplified / raw
}

export function summarizePipeline(
  validation: PolygonValidation,
  rawEdges: RawEdge[],
  enriched: EnrichedEdge[],
  simp: SimplificationResult,
  match: MatchingResult,
): PipelineSummary {
  const interior = enriched.filter((e) => e.interior).length;
  return {
    geometry_valid: validation.valid,
    geometry_reasons: validation.reasons,
    raw_edges_count: rawEdges.length,
    interior_edges_count: interior,
    merged_groups_count: simp.merged_groups_count,
    simplified_edges_count: simp.simplified_edges.length,
    pruned_count: simp.pruned_count,
    ridge_candidates_count: simp.ridge_candidates.length,
    valley_candidates_count: simp.valley_candidates.length,
    hip_candidates_count: simp.hip_candidates.length,
    matched_edges_count: match.matched_count,
    partial_edges_count: match.partial_count,
    unmatched_edges_count: match.unmatched_count,
    matching_valid: match.matching_valid,
    simplification_ratio: rawEdges.length ? simp.simplified_edges.length / rawEdges.length : 0,
  };
}
