/**
 * Roof Sections — primitive géométrique first-class pour le Training Lab.
 *
 * Architecture "Roof Sections First" :
 *  - les `RoofSection` sont la nouvelle source de vérité géométrique
 *  - les `RoofEdge` (ridge / valley / hip / eave / gable) sont DÉRIVÉES
 *  - les anciens outils (faîtière, noue, surface, périmètre…) restent intacts
 *    et compatibles : ils vivent à côté dans `annotations_json`.
 *
 * Aucune dépendance Google Maps / DOM ici — utilitaires purs.
 */

export type SectionType =
  | 'MAIN'
  | 'SECONDARY'
  | 'GARAGE'
  | 'DORMER'
  | 'FLAT'
  | 'UNKNOWN';

export type QualityFlag = 'VERIFIED' | 'ESTIMATED' | 'UNCERTAIN';

export type EdgeType = 'RIDGE' | 'VALLEY' | 'HIP' | 'EAVE' | 'GABLE';

/**
 * Rôle architectural d'une section dans l'ensemble du toit.
 * Permet de distinguer les vrais "roof planes" des artefacts géométriques
 * (fragments de hip, connecteurs de noue, micro-résidus < 15 m²).
 * Seuls les rôles `MAIN_PLANE` participent au skeleton principal et aux
 * statistiques de surface principale.
 */
export type SectionRole =
  | 'MAIN_PLANE'
  | 'HIP_FRAGMENT'
  | 'VALLEY_CONNECTOR'
  | 'RESIDUAL_FRAGMENT';

export type MigrationStatus =
  | 'LEGACY_ONLY'
  | 'HYBRID'
  | 'SECTION_FIRST'
  | 'MIGRATED';

export interface LatLng { lat: number; lng: number }

export interface RoofSection {
  section_id: string;
  /** Pixels Web-Mercator @ zoom 22 (entiers). Toujours auto-calculé depuis
   *  polygon_latlng dans `buildSectionsBundle`. Sert de référence pixel pour
   *  les modèles vision et l'export training. */
  polygon_px: [number, number][];
  polygon_latlng: [number, number][]; // [lat, lng][]
  section_type: SectionType;
  /** Rôle architectural — dérivé automatiquement, peut être surchargé par
   *  l'utilisateur. Voir `assignSectionRoles`. */
  section_role?: SectionRole;
  pitch_deg: number | null;
  aspect_deg: number | null;
  quality_flag: QualityFlag;
  /** Libellé court éditable affiché dans le panneau. */
  label?: string;
}

export interface RoofEdge {
  edge_id: string;
  edge_type: EdgeType;
  section_a: string | null;
  section_b: string | null;
  points_px: [number, number][];
  points_latlng: [number, number][];
  length_m: number;
  derived: true;
}

export interface RoofSectionsBundle {
  roof_sections: RoofSection[];
  roof_edges: RoofEdge[];
  migration_status: MigrationStatus;
  diagnostics: SectionsDiagnostics;
}

export interface SectionsDiagnostics {
  section_count: number;
  total_section_area_m2: number;
  footprint_area_m2: number | null;
  footprint_coverage_pct: number | null;
  uncovered_area_pct: number | null;
  overlap_between_sections_pct: number;
  convexity_scores: Record<string, number>; // section_id -> [0..1]
  area_scores_m2: Record<string, number>;    // section_id -> aire m²
  role_counts: Record<SectionRole, number>;  // synthèse rôles
  warnings: SectionsWarning[];
}

export interface SectionsWarning {
  code:
    | 'SECTIONS_OVERLAP'
    | 'UNCOVERED_ROOF_AREA'
    | 'NON_CONVEX_SECTION'
    | 'DISCONNECTED_SECTION'
    | 'TOO_FEW_VERTICES'
    | 'MICRO_SECTION'
    | 'TOO_MANY_SECTIONS';
  section_id?: string;
  message: string;
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Géodésie locale                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

const R_EARTH = 6378137;

/* ──────────────────────────────────────────────────────────────────────── */
/*  Seuils architecturaux (cible : 5-7 sections, conv ≥ 0.90, cov ≥ 95%)    */
/* ──────────────────────────────────────────────────────────────────────── */

export const SECTION_THRESHOLDS = {
  /** Sous ce seuil, une section est candidate au merge avec un voisin
   *  partageant la plus longue arête commune. */
  MICRO_AREA_M2: 15,
  /** Score convexité minimal pour qu'une section soit considérée comme un
   *  vrai plan de toit (sinon → split candidate). */
  CONVEXITY_MIN: 0.90,
  /** Couverture footprint cible après consolidation. */
  COVERAGE_TARGET: 0.95,
  /** Nombre cible de sections après consolidation. */
  SECTION_COUNT_MAX: 7,
  /** Nombre minimum acceptable. */
  SECTION_COUNT_MIN: 5,
} as const;

/* ──────────────────────────────────────────────────────────────────────── */
/*  Projection pixel (Web Mercator) — utilisée pour `polygon_px`            */
/* ──────────────────────────────────────────────────────────────────────── */

/** Web Mercator → pixels entiers à un `zoom` donné (par défaut 22, hi-res
 *  suffisant pour pixel-precision sur images satellites). */
export function latLngToWebMercatorPx(lat: number, lng: number, zoom = 22): [number, number] {
  const scale = 256 * Math.pow(2, zoom);
  const x = (lng + 180) / 360 * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return [Math.round(x), Math.round(y)];
}

/** Calcule polygon_px d'une section depuis polygon_latlng. */
export function computePolygonPx(latlng: [number, number][], zoom = 22): [number, number][] {
  return latlng.map(([la, lo]) => latLngToWebMercatorPx(la, lo, zoom));
}

/** Projection equirectangulaire locale centrée sur `origin` → mètres (x: est, y: nord). */
export function latLngToLocalM(p: LatLng, origin: LatLng): [number, number] {
  const lat0 = (origin.lat * Math.PI) / 180;
  const x = ((p.lng - origin.lng) * Math.PI) / 180 * R_EARTH * Math.cos(lat0);
  const y = ((p.lat - origin.lat) * Math.PI) / 180 * R_EARTH;
  return [x, y];
}

export function haversineM(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dφ = ((b.lat - a.lat) * Math.PI) / 180;
  const dλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(Math.min(1, s)));
}

function centroidLatLng(points: [number, number][]): LatLng | null {
  if (!points.length) return null;
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return { lat, lng };
}

function polygonAreaM2(latlng: [number, number][]): number {
  if (latlng.length < 3) return 0;
  const origin = centroidLatLng(latlng)!;
  const pts = latlng.map(([la, lo]) => latLngToLocalM({ lat: la, lng: lo }, origin));
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function convexityScore(latlng: [number, number][]): number {
  if (latlng.length < 3) return 0;
  const origin = centroidLatLng(latlng)!;
  const pts = latlng.map(([la, lo]) => latLngToLocalM({ lat: la, lng: lo }, origin));
  // Aire convex hull / aire polygone
  const hull = convexHull(pts);
  if (hull.length < 3) return 0;
  const area = shoelace(pts);
  const hullArea = shoelace(hull);
  if (hullArea <= 0) return 0;
  return Math.max(0, Math.min(1, area / hullArea));
}

function shoelace(pts: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Edges dérivées                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

function edgeKey(a: [number, number], b: [number, number], precision = 6): string {
  const k1 = `${a[0].toFixed(precision)},${a[1].toFixed(precision)}`;
  const k2 = `${b[0].toFixed(precision)},${b[1].toFixed(precision)}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

/**
 * Détecte les edges de chaque section et les classe :
 *  - frontière partagée entre 2 sections → RIDGE (par défaut), VALLEY si concave
 *  - périmètre externe → EAVE
 *  - edges terminales d'une section partiellement adjacente → HIP
 *
 * Heuristique pragmatique : sans normales / pentes, on ne distingue pas
 * parfaitement RIDGE / VALLEY / HIP. C'est intentionnellement conservateur
 * (le but du sprint est de poser la structure, pas de classifier parfaitement).
 */
export function deriveRoofEdges(sections: RoofSection[]): RoofEdge[] {
  if (!sections.length) return [];
  const edgeMap = new Map<string, {
    sections: Set<string>;
    a: [number, number];
    b: [number, number];
  }>();

  for (const sec of sections) {
    const ring = sec.polygon_latlng;
    if (ring.length < 3) continue;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const key = edgeKey(a, b);
      const entry = edgeMap.get(key);
      if (entry) {
        entry.sections.add(sec.section_id);
      } else {
        edgeMap.set(key, { sections: new Set([sec.section_id]), a, b });
      }
    }
  }

  const edges: RoofEdge[] = [];
  let i = 0;
  for (const [, info] of edgeMap) {
    const secs = Array.from(info.sections);
    const length = haversineM({ lat: info.a[0], lng: info.a[1] }, { lat: info.b[0], lng: info.b[1] });
    let edge_type: EdgeType;
    let section_a: string | null = secs[0] ?? null;
    let section_b: string | null = null;
    if (secs.length >= 2) {
      // Frontière commune entre 2+ sections → RIDGE par défaut.
      section_b = secs[1];
      edge_type = 'RIDGE';
    } else {
      // Edge interne d'une seule section → périmètre.
      // On marque EAVE par défaut (rebord), HIP réservé aux cas terminaux non gérés ici.
      edge_type = 'EAVE';
    }
    edges.push({
      edge_id: `edge_${i++}`,
      edge_type,
      section_a,
      section_b,
      points_px: [],
      points_latlng: [info.a, info.b],
      length_m: length,
      derived: true,
    });
  }
  return edges;
}

export function edgesOfType(edges: RoofEdge[], type: EdgeType): RoofEdge[] {
  return edges.filter((e) => e.edge_type === type);
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Diagnostics                                                             */
/* ──────────────────────────────────────────────────────────────────────── */

export function buildSectionsBundle(
  sections: RoofSection[],
  footprintRingLatLng?: [number, number][] | null,
  legacyAnnotationsCount = 0,
): RoofSectionsBundle {
  // 1) Auto-fill polygon_px (Web Mercator) si manquant.
  // 2) Auto-assign section_role basé sur aire + convexité.
  const enriched = sections.map((s) => {
    const polygon_px = s.polygon_px && s.polygon_px.length === s.polygon_latlng.length
      ? s.polygon_px
      : computePolygonPx(s.polygon_latlng);
    return { ...s, polygon_px };
  });
  const withRoles = assignSectionRoles(enriched);
  const edges = deriveRoofEdges(withRoles);
  const diagnostics = computeDiagnostics(withRoles, footprintRingLatLng || null);

  let migration_status: MigrationStatus = 'LEGACY_ONLY';
  if (withRoles.length > 0 && legacyAnnotationsCount > 0) migration_status = 'HYBRID';
  else if (withRoles.length > 0 && legacyAnnotationsCount === 0) migration_status = 'SECTION_FIRST';

  return { roof_sections: withRoles, roof_edges: edges, migration_status, diagnostics };
}

/**
 * Détermine automatiquement le `section_role` de chaque section.
 *
 *  - RESIDUAL_FRAGMENT : aire < MICRO_AREA_M2 (≈ 15 m²).
 *  - HIP_FRAGMENT      : aire < 25 m² ET convexité ≥ 0.9 ET ≥ 1 voisin
 *                        adjacent significativement plus grand (×3).
 *  - VALLEY_CONNECTOR  : aire petite/moyenne (15–30 m²) ET ratio périmètre /
 *                        racine(aire) très élevé (forme allongée),
 *                        adjacente à ≥ 2 voisins MAIN_PLANE.
 *  - MAIN_PLANE        : tout le reste (vrai pan de toit).
 *
 * Si l'utilisateur a fixé manuellement `section_role` (non null), on respecte
 * son choix.
 */
export function assignSectionRoles(sections: RoofSection[]): RoofSection[] {
  if (!sections.length) return sections;
  const areas = new Map<string, number>();
  const perims = new Map<string, number>();
  const conv = new Map<string, number>();
  for (const s of sections) {
    areas.set(s.section_id, polygonAreaM2(s.polygon_latlng));
    perims.set(s.section_id, polygonPerimeterM(s.polygon_latlng));
    conv.set(s.section_id, convexityScore(s.polygon_latlng));
  }
  // Map d'adjacence (sections partageant au moins une arête).
  const adj = buildAdjacencyMap(sections);

  return sections.map((s) => {
    if (s.section_role) return s; // override utilisateur
    const a = areas.get(s.section_id) ?? 0;
    const p = perims.get(s.section_id) ?? 0;
    const c = conv.get(s.section_id) ?? 1;
    const neighbors = Array.from(adj.get(s.section_id) || []);
    const bigNeighbors = neighbors.filter((nid) => (areas.get(nid) ?? 0) >= a * 3);
    const mainNeighbors = neighbors.filter((nid) => (areas.get(nid) ?? 0) >= SECTION_THRESHOLDS.MICRO_AREA_M2);
    let role: SectionRole = 'MAIN_PLANE';
    if (a < SECTION_THRESHOLDS.MICRO_AREA_M2) {
      role = 'RESIDUAL_FRAGMENT';
    } else if (a < 25 && c >= 0.9 && bigNeighbors.length >= 1) {
      role = 'HIP_FRAGMENT';
    } else if (a < 30 && p > 0 && (p / Math.sqrt(Math.max(a, 1))) > 6 && mainNeighbors.length >= 2) {
      role = 'VALLEY_CONNECTOR';
    }
    return { ...s, section_role: role };
  });
}

function polygonPerimeterM(latlng: [number, number][]): number {
  if (latlng.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < latlng.length; i++) {
    const a = latlng[i];
    const b = latlng[(i + 1) % latlng.length];
    p += haversineM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
  }
  return p;
}

/** Construit la map d'adjacence section_id → set(section_id voisins) sur la
 *  base des arêtes exactement partagées (cf. `edgeKey`). */
export function buildAdjacencyMap(sections: RoofSection[]): Map<string, Set<string>> {
  const edgeOwners = new Map<string, string[]>();
  for (const s of sections) {
    const ring = s.polygon_latlng;
    if (ring.length < 3) continue;
    for (let i = 0; i < ring.length; i++) {
      const key = edgeKey(ring[i], ring[(i + 1) % ring.length]);
      const arr = edgeOwners.get(key) || [];
      arr.push(s.section_id);
      edgeOwners.set(key, arr);
    }
  }
  const adj = new Map<string, Set<string>>();
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (const a of owners) {
      for (const b of owners) {
        if (a === b) continue;
        if (!adj.has(a)) adj.set(a, new Set());
        adj.get(a)!.add(b);
      }
    }
  }
  return adj;
}

export function computeDiagnostics(
  sections: RoofSection[],
  footprintRingLatLng: [number, number][] | null,
): SectionsDiagnostics {
  const warnings: SectionsWarning[] = [];
  const convexity_scores: Record<string, number> = {};
  const area_scores_m2: Record<string, number> = {};
  const role_counts: Record<SectionRole, number> = {
    MAIN_PLANE: 0, HIP_FRAGMENT: 0, VALLEY_CONNECTOR: 0, RESIDUAL_FRAGMENT: 0,
  };
  let total = 0;

  for (const s of sections) {
    if (s.polygon_latlng.length < 3) {
      warnings.push({ code: 'TOO_FEW_VERTICES', section_id: s.section_id, message: `Section ${s.label || s.section_id} : moins de 3 sommets` });
      convexity_scores[s.section_id] = 0;
      area_scores_m2[s.section_id] = 0;
      continue;
    }
    const area = polygonAreaM2(s.polygon_latlng);
    total += area;
    area_scores_m2[s.section_id] = Number(area.toFixed(2));
    const cscore = convexityScore(s.polygon_latlng);
    convexity_scores[s.section_id] = Number(cscore.toFixed(3));
    if (cscore < SECTION_THRESHOLDS.CONVEXITY_MIN) {
      warnings.push({ code: 'NON_CONVEX_SECTION', section_id: s.section_id, message: `Section ${s.label || s.section_id} non convexe (score ${cscore.toFixed(2)})` });
    }
    if (area < SECTION_THRESHOLDS.MICRO_AREA_M2) {
      warnings.push({ code: 'MICRO_SECTION', section_id: s.section_id, message: `Section ${s.label || s.section_id} micro (${area.toFixed(1)} m² < ${SECTION_THRESHOLDS.MICRO_AREA_M2})` });
    }
    const r = (s.section_role || 'MAIN_PLANE') as SectionRole;
    role_counts[r] = (role_counts[r] || 0) + 1;
  }

  if (sections.length > SECTION_THRESHOLDS.SECTION_COUNT_MAX) {
    warnings.push({
      code: 'TOO_MANY_SECTIONS',
      message: `${sections.length} sections — cible ≤ ${SECTION_THRESHOLDS.SECTION_COUNT_MAX} (lancer la consolidation).`,
    });
  }

  // Overlap pairwise (mètres carrés via approximation centroïdes — pas d'algèbre booléenne polygonale ici).
  // Approximation conservatrice : on additionne les aires des paires dont les bounding boxes se chevauchent.
  let overlapM2 = 0;
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const A = sections[i].polygon_latlng;
      const B = sections[j].polygon_latlng;
      if (A.length < 3 || B.length < 3) continue;
      if (bboxOverlaps(A, B)) {
        const overlap = approxOverlapM2(A, B);
        if (overlap > 0.5) {
          overlapM2 += overlap;
          warnings.push({
            code: 'SECTIONS_OVERLAP',
            section_id: sections[i].section_id,
            message: `Recouvrement ≈ ${overlap.toFixed(1)} m² avec ${sections[j].label || sections[j].section_id}`,
          });
        }
      }
    }
  }

  let footprint_area_m2: number | null = null;
  let coverage: number | null = null;
  let uncovered: number | null = null;
  if (footprintRingLatLng && footprintRingLatLng.length >= 3) {
    footprint_area_m2 = polygonAreaM2(footprintRingLatLng);
    if (footprint_area_m2 > 0) {
      coverage = Math.min(1, total / footprint_area_m2);
      uncovered = Math.max(0, 1 - coverage);
      if (sections.length > 0 && uncovered > 0.15) {
        warnings.push({ code: 'UNCOVERED_ROOF_AREA', message: `Zone non couverte ≈ ${(uncovered * 100).toFixed(0)} %` });
      }
    }
  }

  const overlapPct = total > 0 ? Math.min(100, (overlapM2 / total) * 100) : 0;

  return {
    section_count: sections.length,
    total_section_area_m2: Number(total.toFixed(2)),
    footprint_area_m2: footprint_area_m2 != null ? Number(footprint_area_m2.toFixed(2)) : null,
    footprint_coverage_pct: coverage != null ? Number((coverage * 100).toFixed(1)) : null,
    uncovered_area_pct: uncovered != null ? Number((uncovered * 100).toFixed(1)) : null,
    overlap_between_sections_pct: Number(overlapPct.toFixed(1)),
    convexity_scores,
    area_scores_m2,
    role_counts,
    warnings,
  };
}

function bboxOverlaps(A: [number, number][], B: [number, number][]): boolean {
  let minLatA = Infinity, maxLatA = -Infinity, minLngA = Infinity, maxLngA = -Infinity;
  for (const [la, lo] of A) { if (la < minLatA) minLatA = la; if (la > maxLatA) maxLatA = la; if (lo < minLngA) minLngA = lo; if (lo > maxLngA) maxLngA = lo; }
  let minLatB = Infinity, maxLatB = -Infinity, minLngB = Infinity, maxLngB = -Infinity;
  for (const [la, lo] of B) { if (la < minLatB) minLatB = la; if (la > maxLatB) maxLatB = la; if (lo < minLngB) minLngB = lo; if (lo > maxLngB) maxLngB = lo; }
  return !(maxLatA < minLatB || maxLatB < minLatA || maxLngA < minLngB || maxLngB < minLngA);
}

/** Approximation par grille de Monte-Carlo léger (200 points) — assez précis pour un warning. */
function approxOverlapM2(A: [number, number][], B: [number, number][]): number {
  const all = [...A, ...B];
  const origin = centroidLatLng(all)!;
  const Apx = A.map(([la, lo]) => latLngToLocalM({ lat: la, lng: lo }, origin));
  const Bpx = B.map(([la, lo]) => latLngToLocalM({ lat: la, lng: lo }, origin));
  const allPx = [...Apx, ...Bpx];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of allPx) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const w = maxX - minX, h = maxY - minY;
  if (w <= 0 || h <= 0) return 0;
  const N = 400;
  let inBoth = 0;
  for (let i = 0; i < N; i++) {
    const px: [number, number] = [minX + Math.random() * w, minY + Math.random() * h];
    if (pointInPolygon(px, Apx) && pointInPolygon(px, Bpx)) inBoth++;
  }
  return (inBoth / N) * (w * h);
}

function pointInPolygon(p: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Helpers UI                                                              */
/* ──────────────────────────────────────────────────────────────────────── */

export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  MAIN: 'Principal',
  SECONDARY: 'Secondaire',
  GARAGE: 'Garage',
  DORMER: 'Lucarne',
  FLAT: 'Plat',
  UNKNOWN: 'Inconnu',
};

export const SECTION_TYPE_COLORS: Record<SectionType, string> = {
  MAIN: '#8b5cf6',
  SECONDARY: '#3b82f6',
  GARAGE: '#f59e0b',
  DORMER: '#ec4899',
  FLAT: '#10b981',
  UNKNOWN: '#64748b',
};

export const EDGE_TYPE_COLORS: Record<EdgeType, string> = {
  RIDGE: '#ef4444',
  VALLEY: '#0ea5e9',
  HIP: '#f97316',
  EAVE: '#94a3b8',
  GABLE: '#a855f7',
};

export function newSectionId(): string {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function emptySection(idx = 0): RoofSection {
  return {
    section_id: newSectionId(),
    polygon_px: [],
    polygon_latlng: [],
    section_type: 'MAIN',
    pitch_deg: null,
    aspect_deg: null,
    quality_flag: 'ESTIMATED',
    label: `Section ${idx + 1}`,
  };
}

/** Convertit roof_sections en `extraPolylines` (BuildingReadOnlyMap), périmètre fermé. */
export function sectionsToExtraPolylines(sections: RoofSection[]): Array<{
  id: string;
  label: string;
  color: string;
  paths: Array<Array<{ lat: number; lng: number }>>;
  visible: boolean;
  weight?: number;
}> {
  if (!sections.length) return [];
  const paths: Array<Array<{ lat: number; lng: number }>> = [];
  for (const s of sections) {
    if (s.polygon_latlng.length < 2) continue;
    const closed = [...s.polygon_latlng, s.polygon_latlng[0]].map(([la, lo]) => ({ lat: la, lng: lo }));
    paths.push(closed);
  }
  return [{ id: 'roof_sections', label: 'Sections toiture', color: '#a855f7', paths, visible: true, weight: 3 }];
}

/** Convertit roof_edges en `extraPolylines` (BuildingReadOnlyMap), groupé par type. */
export function edgesToExtraPolylines(edges: RoofEdge[]): Array<{
  id: string;
  label: string;
  color: string;
  paths: Array<Array<{ lat: number; lng: number }>>;
  visible: boolean;
  weight?: number;
}> {
  const byType = new Map<EdgeType, RoofEdge[]>();
  for (const e of edges) {
    const arr = byType.get(e.edge_type) || [];
    arr.push(e);
    byType.set(e.edge_type, arr);
  }
  const layers: ReturnType<typeof edgesToExtraPolylines> = [];
  for (const [type, es] of byType) {
    layers.push({
      id: `derived_${type.toLowerCase()}`,
      label: `Edges ${type}`,
      color: EDGE_TYPE_COLORS[type],
      paths: es.map((e) => e.points_latlng.map(([la, lo]) => ({ lat: la, lng: lo }))),
      visible: true,
      weight: type === 'RIDGE' ? 4 : 2,
    });
  }
  return layers;
}

/** Extrait l'anneau principal (lat,lng) d'un GeoJSON Polygon/MultiPolygon. */
export function extractMainRingLatLng(geo: any): [number, number][] | null {
  if (!geo) return null;
  const g = geo.type === 'Feature' ? geo.geometry : geo;
  if (!g) return null;
  let rings: number[][][] = [];
  if (g.type === 'Polygon') rings = g.coordinates || [];
  else if (g.type === 'MultiPolygon') rings = (g.coordinates || [])[0] || [];
  const outer = rings[0];
  if (!outer || outer.length < 3) return null;
  return outer.map(([lng, lat]) => [lat, lng] as [number, number]);
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Application des PolygonAdjustments (offset E/N + rotation + scale)      */
/*  pour aligner l'anneau bâtiment sur ce que l'utilisateur voit dans la    */
/*  carte principale (BuildingReadOnlyMap applique ces mêmes transfos en    */
/*  live sans modifier le geojson stocké).                                  */
/* ──────────────────────────────────────────────────────────────────────── */

export interface RingAdjustments {
  offsetEastM?: number;
  offsetNorthM?: number;
  rotationDeg?: number;
  scaleFactor?: number;
}

function offsetLatLng(lat: number, lng: number, northM: number, eastM: number): [number, number] {
  const dLat = northM / 111320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = eastM / (111320 * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat));
  return [lat + dLat, lng + dLng];
}

/**
 * Applique les ajustements (offset, rotation, scale) à un anneau lat/lng.
 * - Rotation et scale sont effectués autour du centroïde de l'anneau, en projection
 *   locale (mètres), puis reprojetés en lat/lng.
 * - L'offset E/N est ensuite appliqué à chaque sommet.
 * Aucune modification si `adj` est vide ou tous les champs sont neutres.
 */
export function applyRingAdjustments(
  ring: [number, number][] | null,
  adj?: RingAdjustments | null,
): [number, number][] | null {
  if (!ring || ring.length < 3) return ring;
  const offE = adj?.offsetEastM ?? 0;
  const offN = adj?.offsetNorthM ?? 0;
  const rot = adj?.rotationDeg ?? 0;
  const scale = adj?.scaleFactor ?? 1;
  if (offE === 0 && offN === 0 && rot === 0 && (scale === 1 || !scale)) return ring;

  // Centroïde lat/lng simple
  const cLat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cLng = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const origin = { lat: cLat, lng: cLng };
  const cosA = Math.cos((rot * Math.PI) / 180);
  const sinA = Math.sin((rot * Math.PI) / 180);
  const s = scale || 1;

  return ring.map(([lat, lng]) => {
    // Projection locale en mètres autour du centroïde
    const [x, y] = latLngToLocalM({ lat, lng }, origin);
    // Rotation (CCW positive) + scale autour du centroïde
    const xr = (x * cosA - y * sinA) * s;
    const yr = (x * sinA + y * cosA) * s;
    // Reprojection → lat/lng
    const lat0 = (origin.lat * Math.PI) / 180;
    const lat2 = origin.lat + (yr / 111320);
    const lng2 = origin.lng + (xr / (111320 * Math.cos(lat0)));
    // Offset E/N global
    return offsetLatLng(lat2, lng2, offN, offE);
  });
}
