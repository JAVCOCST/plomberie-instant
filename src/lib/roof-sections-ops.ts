/**
 * Opérations architecturales sur les RoofSections.
 *
 * Deux passes principales :
 *  1. `consolidateSections`   — fusionne les micro-sections (< 15 m²) avec
 *     leur voisin partageant l'arête commune la plus longue.
 *  2. `splitNonConvexSections` — décompose les sections non-convexes
 *     (convexité < 0.90) en sous-pans convexes via cut sur reflex vertex.
 *
 * Toutes les opérations conservent :
 *  - le `section_type` du plus grand contributeur,
 *  - la `pitch_deg` / `aspect_deg` du plus grand contributeur,
 *  - réassignent `section_role` (assignSectionRoles) en post-traitement.
 *
 * Géométrie : projection locale équirectangulaire en mètres pour tous les
 * tests (snap, intersection, decomposition). Reprojection lat/lng à la fin.
 */

import {
  RoofSection,
  SectionRole,
  SECTION_THRESHOLDS,
  assignSectionRoles,
  buildAdjacencyMap,
  computePolygonPx,
  emptySection,
  haversineM,
  latLngToLocalM,
  newSectionId,
  type LatLng,
} from './roof-sections';

/* ──────────────────────────────────────────────────────────────────────── */
/*  Helpers géométriques internes (mètres locaux)                           */
/* ──────────────────────────────────────────────────────────────────────── */

type Pt = [number, number]; // [x_east_m, y_north_m] OU [lat, lng] selon contexte

const SNAP_M = 0.6; // tolérance d'identification de sommets identiques (mètres)

function centroidLL(ring: [number, number][]): LatLng {
  const lat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lng = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return { lat, lng };
}

function ringToLocal(ring: [number, number][], origin: LatLng): Pt[] {
  return ring.map(([la, lo]) => latLngToLocalM({ lat: la, lng: lo }, origin));
}

function localToLL(pts: Pt[], origin: LatLng): [number, number][] {
  const lat0 = (origin.lat * Math.PI) / 180;
  return pts.map(([x, y]) => {
    const lat = origin.lat + y / 111320;
    const lng = origin.lng + x / (111320 * Math.cos(lat0));
    return [lat, lng] as [number, number];
  });
}

function shoelaceSigned(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function ensureCCW(pts: Pt[]): Pt[] {
  return shoelaceSigned(pts) >= 0 ? pts : pts.slice().reverse();
}

function distSq(a: Pt, b: Pt): number {
  const dx = a[0] - b[0]; const dy = a[1] - b[1]; return dx * dx + dy * dy;
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonAreaLocal(pts: Pt[]): number {
  return Math.abs(shoelaceSigned(pts));
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  PASSE 1 — Consolidation (merge micro-sections)                          */
/* ──────────────────────────────────────────────────────────────────────── */

export interface ConsolidationReport {
  merges: Array<{ kept: string; absorbed: string; sharedEdgeM: number }>;
  dropped: string[];        // sections supprimées sans merge (orphelines)
  beforeCount: number;
  afterCount: number;
}

export interface ConsolidationResult {
  sections: RoofSection[];
  report: ConsolidationReport;
}

/**
 * Fusionne itérativement les sections d'aire < MICRO_AREA_M2 avec leur
 * voisin ayant la plus longue arête partagée. Recalcule l'adjacence à chaque
 * itération. S'arrête quand :
 *  - plus aucune micro section,
 *  - ou nombre cible atteint (SECTION_COUNT_MAX),
 *  - ou nombre max d'itérations (sécurité).
 */
export function consolidateSections(sections: RoofSection[]): ConsolidationResult {
  const report: ConsolidationReport = {
    merges: [], dropped: [], beforeCount: sections.length, afterCount: sections.length,
  };
  let current = sections.map((s) => ({ ...s }));
  const MAX_ITER = 40;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const areas = new Map<string, number>();
    const originRef = centroidLL(current.flatMap((s) => s.polygon_latlng));
    for (const s of current) {
      const local = ringToLocal(s.polygon_latlng, originRef);
      areas.set(s.section_id, polygonAreaLocal(local));
    }
    // Sélectionne la plus petite micro section.
    const micros = current
      .filter((s) => (areas.get(s.section_id) ?? 0) < SECTION_THRESHOLDS.MICRO_AREA_M2)
      .sort((a, b) => (areas.get(a.section_id) ?? 0) - (areas.get(b.section_id) ?? 0));
    if (!micros.length) break;
    const victim = micros[0];

    // Trouve le voisin avec arête commune la plus longue.
    const best = findBestNeighborForMerge(victim, current);
    if (!best) {
      report.dropped.push(victim.section_id);
      current = current.filter((s) => s.section_id !== victim.section_id);
      continue;
    }
    const neighbor = current.find((s) => s.section_id === best.neighborId)!;
    const merged = mergeAlongSharedEdges(neighbor, victim);
    report.merges.push({ kept: neighbor.section_id, absorbed: victim.section_id, sharedEdgeM: best.sharedM });
    current = current
      .filter((s) => s.section_id !== victim.section_id && s.section_id !== neighbor.section_id)
      .concat({ ...merged });
  }

  // Reassign roles + polygon_px en sortie.
  const enriched = assignSectionRoles(current).map((s) => ({
    ...s,
    polygon_px: computePolygonPx(s.polygon_latlng),
  }));

  report.afterCount = enriched.length;
  return { sections: enriched, report };
}

function findBestNeighborForMerge(
  victim: RoofSection, all: RoofSection[],
): { neighborId: string; sharedM: number } | null {
  const vRing = victim.polygon_latlng;
  if (vRing.length < 3) return null;
  const candidates = new Map<string, number>(); // neighborId -> total shared edge (m)
  for (const other of all) {
    if (other.section_id === victim.section_id) continue;
    const shared = sharedEdgeLengthM(vRing, other.polygon_latlng);
    if (shared > 0) candidates.set(other.section_id, shared);
  }
  let bestId: string | null = null; let bestM = 0;
  for (const [id, m] of candidates) {
    if (m > bestM) { bestM = m; bestId = id; }
  }
  return bestId ? { neighborId: bestId, sharedM: bestM } : null;
}

/** Longueur totale des arêtes communes entre deux anneaux. On considère une
 *  arête commune si les deux sommets coïncident (à SNAP_M près). */
function sharedEdgeLengthM(A: [number, number][], B: [number, number][]): number {
  if (A.length < 3 || B.length < 3) return 0;
  const origin = centroidLL([...A, ...B]);
  const Al = ringToLocal(A, origin);
  const Bl = ringToLocal(B, origin);
  const tol = SNAP_M * SNAP_M;
  let total = 0;
  for (let i = 0; i < Al.length; i++) {
    const a1 = Al[i], a2 = Al[(i + 1) % Al.length];
    for (let j = 0; j < Bl.length; j++) {
      const b1 = Bl[j], b2 = Bl[(j + 1) % Bl.length];
      // Match a1-a2 vs b1-b2 ou b2-b1.
      const match = (distSq(a1, b1) < tol && distSq(a2, b2) < tol)
                 || (distSq(a1, b2) < tol && distSq(a2, b1) < tol);
      if (match) {
        total += Math.sqrt(distSq(a1, a2));
      }
    }
  }
  return total;
}

/**
 * Fusionne deux polygones partageant une ou plusieurs arêtes consécutives.
 * Stratégie "edge-walk" :
 *  1. Trouve l'arête partagée (premier sommet commun à supprimer).
 *  2. Marche le long de A jusqu'au point d'entrée commun, bascule sur B,
 *     marche jusqu'à la sortie commune, revient sur A.
 *  3. Si pas d'arête exactement partagée (cas dégénéré), fallback :
 *     convex-hull union (perd de la précision mais robuste).
 *
 * Renvoie une `RoofSection` au type/pitch du plus grand contributeur.
 */
export function mergeAlongSharedEdges(a: RoofSection, b: RoofSection): RoofSection {
  const origin = centroidLL([...a.polygon_latlng, ...b.polygon_latlng]);
  const Al = ensureCCW(ringToLocal(a.polygon_latlng, origin));
  const Bl = ensureCCW(ringToLocal(b.polygon_latlng, origin));

  const merged = stitchRings(Al, Bl);
  let outLocal: Pt[];
  if (merged && merged.length >= 3) {
    outLocal = simplifyConsecutiveDuplicates(merged);
  } else {
    // Fallback : convex hull (perte de fidélité acceptable car cas rare).
    outLocal = convexHullLocal([...Al, ...Bl]);
  }

  // Le "kept" est le plus grand contributeur (a ou b) pour type/pitch/role.
  const areaA = polygonAreaLocal(Al);
  const areaB = polygonAreaLocal(Bl);
  const dominant = areaA >= areaB ? a : b;
  const ringLL = localToLL(outLocal, origin);

  return {
    section_id: dominant.section_id, // garde l'ID dominant (stabilité UI)
    polygon_latlng: ringLL,
    polygon_px: computePolygonPx(ringLL),
    section_type: dominant.section_type,
    pitch_deg: dominant.pitch_deg,
    aspect_deg: dominant.aspect_deg,
    quality_flag: dominant.quality_flag,
    label: dominant.label,
    section_role: undefined, // sera réassigné
  };
}

function simplifyConsecutiveDuplicates(pts: Pt[]): Pt[] {
  const tol = SNAP_M * SNAP_M;
  const out: Pt[] = [];
  for (const p of pts) {
    if (!out.length || distSq(out[out.length - 1], p) > tol) out.push(p);
  }
  if (out.length >= 2 && distSq(out[0], out[out.length - 1]) < tol) out.pop();
  return out;
}

/**
 * Stitch deux rings ayant ≥ 1 arête partagée :
 *  - trouve les paires de sommets communs (à SNAP_M),
 *  - identifie l'arête partagée (suite consécutive de sommets communs),
 *  - assemble : A[0..enter] + B[exit_in_B..enter_in_B] (côté non partagé) + A[exit..end].
 * Renvoie null si aucune arête partagée détectée.
 */
function stitchRings(A: Pt[], B: Pt[]): Pt[] | null {
  const tol = SNAP_M * SNAP_M;
  // Pour chaque arête de A, regarde si elle existe (inverse) dans B.
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      // Pour une fusion topologique correcte, on attend arête partagée en
      // sens opposé (CCW ↔ CCW). Match a1=b2 et a2=b1.
      if (distSq(a1, b2) < tol && distSq(a2, b1) < tol) {
        // Assemblage : A[0..i] puis B[j-1..j+2..] (en évitant a1=b2 et a2=b1).
        const out: Pt[] = [];
        for (let k = 0; k <= i; k++) out.push(A[k]);
        // On marche sur B depuis b1=A[i+1] vers l'avant, mais en sautant b1.
        // L'index dans B équivalent à A[i+1]=b1 est j. On continue depuis (j-1) mod B.length
        // jusqu'à retomber sur b2 (=A[i]), qu'on saute aussi.
        let k = (j - 1 + B.length) % B.length;
        const stop = (j + 1) % B.length; // = b2 → on s'arrête juste avant.
        let guard = 0;
        while (k !== stop && guard++ < B.length + 1) {
          out.push(B[k]);
          k = (k - 1 + B.length) % B.length;
        }
        // Reprise sur A depuis (i+2) jusqu'à la fin.
        for (let m = (i + 2) % A.length; m !== 0; m = (m + 1) % A.length) {
          out.push(A[m]);
          if (m === A.length - 1) break;
        }
        return out;
      }
    }
  }
  return null;
}

function convexHullLocal(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  PASSE 2 — Convex decomposition                                          */
/* ──────────────────────────────────────────────────────────────────────── */

export interface SplitReport {
  splits: Array<{ original: string; producedIds: string[]; pieces: number }>;
  beforeCount: number;
  afterCount: number;
}

export interface SplitResult {
  sections: RoofSection[];
  report: SplitReport;
}

/**
 * Décompose en pans convexes toutes les sections dont le score de convexité
 * est < CONVEXITY_MIN (0.90). Stratégie récursive :
 *  1. Trouve le sommet réflex le plus "profond" (angle intérieur le + grand).
 *  2. Cherche un sommet visible "candidat de cut" qui minimise les triangles
 *     résiduels (heuristique : préfère le sommet diamétralement opposé qui
 *     produit deux sous-polygones d'aire ≥ 5 m²).
 *  3. Cut le ring en deux, recurse sur chaque moitié si toujours non-convexe.
 * Sécurité : profondeur max = 6 (évite explosion combinatoire).
 */
export function splitNonConvexSections(sections: RoofSection[]): SplitResult {
  const report: SplitReport = { splits: [], beforeCount: sections.length, afterCount: 0 };
  const out: RoofSection[] = [];

  for (const s of sections) {
    if (s.polygon_latlng.length < 4) { out.push(s); continue; }
    const origin = centroidLL(s.polygon_latlng);
    const local = ensureCCW(ringToLocal(s.polygon_latlng, origin));
    const cscore = convexityLocal(local);
    if (cscore >= SECTION_THRESHOLDS.CONVEXITY_MIN) { out.push(s); continue; }

    const pieces = decomposeRecursive(local, 0);
    if (pieces.length <= 1) { out.push(s); continue; }

    const producedIds: string[] = [];
    pieces.forEach((piece, idx) => {
      const ringLL = localToLL(piece, origin);
      const id = idx === 0 ? s.section_id : newSectionId();
      producedIds.push(id);
      out.push({
        ...emptySection(0),
        section_id: id,
        polygon_latlng: ringLL,
        polygon_px: computePolygonPx(ringLL),
        section_type: s.section_type,
        pitch_deg: s.pitch_deg,
        aspect_deg: s.aspect_deg,
        quality_flag: s.quality_flag,
        label: idx === 0 ? s.label : `${s.label || s.section_id} ${idx + 1}`,
      });
    });
    report.splits.push({ original: s.section_id, producedIds, pieces: pieces.length });
  }

  const finalSections = assignSectionRoles(out);
  report.afterCount = finalSections.length;
  return { sections: finalSections, report };
}

function convexityLocal(ring: Pt[]): number {
  if (ring.length < 3) return 0;
  const hull = convexHullLocal(ring);
  const ringA = polygonAreaLocal(ring);
  const hullA = polygonAreaLocal(hull);
  if (hullA <= 0) return 0;
  return Math.max(0, Math.min(1, ringA / hullA));
}

const MIN_PIECE_AREA_M2 = 5; // évite les triangles résiduels < 5 m²
const MAX_SPLIT_DEPTH = 6;

function decomposeRecursive(ring: Pt[], depth: number): Pt[][] {
  if (depth >= MAX_SPLIT_DEPTH) return [ring];
  if (ring.length < 4) return [ring];
  const cscore = convexityLocal(ring);
  if (cscore >= SECTION_THRESHOLDS.CONVEXITY_MIN) return [ring];

  // 1. Identifie tous les reflex vertices (angle intérieur > 180°).
  const reflexIdx: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    if (isReflex(ring, i)) reflexIdx.push(i);
  }
  if (!reflexIdx.length) return [ring];

  // 2. Cherche un cut (i, j) où i ∈ reflex, j ∈ ring, j != i, j != i±1,
  //    segment ij est entièrement intérieur, et les deux moitiés ont aire ≥ MIN_PIECE.
  let best: { i: number; j: number; score: number } | null = null;
  for (const i of reflexIdx) {
    for (let j = 0; j < ring.length; j++) {
      if (j === i) continue;
      if (j === (i + 1) % ring.length || j === (i - 1 + ring.length) % ring.length) continue;
      if (!isDiagonalInside(ring, i, j)) continue;
      const [pA, pB] = splitRing(ring, i, j);
      const aA = polygonAreaLocal(pA);
      const aB = polygonAreaLocal(pB);
      if (aA < MIN_PIECE_AREA_M2 || aB < MIN_PIECE_AREA_M2) continue;
      // Score : maximise la convexité combinée des deux moitiés,
      // bonus si l'une des deux est déjà convexe.
      const cA = convexityLocal(pA);
      const cB = convexityLocal(pB);
      const score = (cA + cB) + 0.1 * Math.min(aA, aB) / Math.max(aA, aB);
      if (!best || score > best.score) best = { i, j, score };
    }
  }
  if (!best) return [ring];

  const [pA, pB] = splitRing(ring, best.i, best.j);
  return [...decomposeRecursive(pA, depth + 1), ...decomposeRecursive(pB, depth + 1)];
}

function isReflex(ring: Pt[], i: number): boolean {
  const prev = ring[(i - 1 + ring.length) % ring.length];
  const cur = ring[i];
  const next = ring[(i + 1) % ring.length];
  const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
  return cross < 0; // CCW → reflex si cross négatif
}

function isDiagonalInside(ring: Pt[], i: number, j: number): boolean {
  const a = ring[i], b = ring[j];
  // Midpoint doit être à l'intérieur.
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (!pointInPolygon(mid, ring)) return false;
  // Pas d'intersection avec une autre arête.
  for (let k = 0; k < ring.length; k++) {
    const k2 = (k + 1) % ring.length;
    if (k === i || k === j || k2 === i || k2 === j) continue;
    if (segmentsIntersect(a, b, ring[k], ring[k2])) return false;
  }
  return true;
}

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

function splitRing(ring: Pt[], i: number, j: number): [Pt[], Pt[]] {
  const a: Pt[] = []; const b: Pt[] = [];
  // Premier morceau : i → j (sens horaire dans l'index)
  let k = i;
  while (true) {
    a.push(ring[k]);
    if (k === j) break;
    k = (k + 1) % ring.length;
  }
  // Second morceau : j → i
  k = j;
  while (true) {
    b.push(ring[k]);
    if (k === i) break;
    k = (k + 1) % ring.length;
  }
  return [a, b];
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Pipeline complet : consolidation + split + role refresh                 */
/* ──────────────────────────────────────────────────────────────────────── */

export interface OptimizePassReport {
  consolidation: ConsolidationReport;
  split: SplitReport;
  finalCount: number;
  finalRoles: Record<SectionRole, number>;
}

/**
 * Pipeline complet :
 *   1. Consolidation (fusion des micro-sections)
 *   2. Split (décomposition convexe)
 *   3. Réassignation des rôles
 * On exécute consolidation AVANT split : merger d'abord supprime du bruit
 * et évite de splitter des fragments qui auraient dû disparaître.
 */
export function optimizeSections(sections: RoofSection[]): {
  sections: RoofSection[]; report: OptimizePassReport;
} {
  const c = consolidateSections(sections);
  const s = splitNonConvexSections(c.sections);
  const final = assignSectionRoles(s.sections);
  const roles: Record<SectionRole, number> = {
    MAIN_PLANE: 0, HIP_FRAGMENT: 0, VALLEY_CONNECTOR: 0, RESIDUAL_FRAGMENT: 0,
  };
  for (const sec of final) {
    const r = (sec.section_role || 'MAIN_PLANE') as SectionRole;
    roles[r] = (roles[r] || 0) + 1;
  }
  return {
    sections: final,
    report: {
      consolidation: c.report,
      split: s.report,
      finalCount: final.length,
      finalRoles: roles,
    },
  };
}