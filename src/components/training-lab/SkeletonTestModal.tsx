import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, FlaskConical, Download, Image as ImageIcon, Save } from 'lucide-react';
import { SkeletonBuilder } from 'straight-skeleton';
import { parseGeojsonValue, type TrainingTakeoff } from '@/lib/training-lab';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  validateBuildingPolygon,
  buildEdgeFeatures,
  simplifySkeletonGraph,
  classifySkeletonEdges,
  matchSkeletonToHumanAnnotations,
  summarizePipeline,
  type EnrichedEdge,
  type SimplifiedEdge,
  type HumanAnnotation,
  type PipelineSummary,
  type PolygonValidation,
  type RawEdge,
} from '@/lib/skeleton-pipeline';

/**
 * Bouton de test temporaire (Training Lab) :
 * Calcule le straight skeleton brut du `corrected_building_geojson`
 * puis le superpose à l'image raw + annotations humaines (faîtière)
 * pour valider visuellement si on peut baser un pipeline ML dessus.
 *
 * Pas un Hypothesis V0. Pas de SAM. Pas de modèle. Juste un test brut.
 */

interface Props {
  takeoff: TrainingTakeoff;
  onClose: () => void;
}

/* ── Helpers géométrie ── */

function extractOuterRing(geo: any): [number, number][] | null {
  if (!geo) return null;
  const g = geo.type === 'Feature' ? geo.geometry : geo;
  if (!g) return null;
  if (g.type === 'Polygon') return (g.coordinates?.[0] || null) as any;
  if (g.type === 'MultiPolygon') {
    // prend l'anneau extérieur du plus grand polygone
    const polys = g.coordinates || [];
    let best: any = null; let bestN = -1;
    for (const p of polys) {
      const r = p?.[0];
      if (r && r.length > bestN) { best = r; bestN = r.length; }
    }
    return best;
  }
  return null;
}

/** Local equirectangular: lng/lat → mètres relatifs au centroïde. */
function makeLocalProjection(lat0: number) {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toM: (lng: number, lat: number, lng0: number) => [
      (lng - lng0) * mPerDegLng,
      (lat - lat0) * mPerDegLat,
    ] as [number, number],
    fromM: (x: number, y: number, lng0: number) => [
      lng0 + x / mPerDegLng,
      lat0 + y / mPerDegLat,
    ] as [number, number],
  };
}

function ringSignedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

async function hashPayload(obj: unknown): Promise<string> {
  const str = JSON.stringify(obj);
  try {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return `fallback_${(h >>> 0).toString(16)}_${str.length}`;
  }
}

/** Projette lat/lng vers pixels image (Google Static Maps 640x640 scale=2). */
function latLngToImagePx(
  lat: number, lng: number,
  centerLat: number, centerLng: number,
  zoom: number, imgSize = 1280, scale = 2,
): { x: number; y: number } {
  const TILE = 256;
  // Google Static Maps : `scale` augmente la densité de pixels du PNG
  // (2× pour retina), mais NE change PAS l'étendue géographique couverte
  // par l'image. Les coordonnées doivent donc être exprimées dans le
  // référentiel logique `imgSize × imgSize` — sans facteur scale.
  const worldScale = TILE * Math.pow(2, zoom);
  void scale;
  const project = (la: number, ln: number) => {
    const x = ((ln + 180) / 360) * worldScale;
    const siny = Math.min(Math.max(Math.sin((la * Math.PI) / 180), -0.9999), 0.9999);
    const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * worldScale;
    return { x, y };
  };
  const p = project(lat, lng);
  const c = project(centerLat, centerLng);
  return {
    x: (p.x - c.x) + imgSize / 2,
    y: (p.y - c.y) + imgSize / 2,
  };
}

function distPointToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function segLenM(seg: Array<{ lat: number; lng: number }>, proj: ReturnType<typeof makeLocalProjection>, lng0: number): number {
  let s = 0;
  for (let i = 0; i + 1 < seg.length; i++) {
    const [ax, ay] = proj.toM(seg[i].lng, seg[i].lat, lng0);
    const [bx, by] = proj.toM(seg[i + 1].lng, seg[i + 1].lat, lng0);
    s += Math.hypot(bx - ax, by - ay);
  }
  return s;
}

/** Point-in-polygon (ray casting). ring doit être fermé. */
function pointInRingM(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Nettoie un anneau (en mètres, fermé) avant polyskel :
 *  - merge sommets quasi-identiques (< minDist m)
 *  - supprime les sommets quasi-colinéaires (cross < tolCross m²)
 * Évite les instabilités numériques de polyskel sur footprints bruts qui
 * produisaient des sommets "intérieurs" projetés très loin à l'extérieur.
 */
function cleanRingM(
  ring: [number, number][],
  minDist = 0.15,
  tolCross = 0.02,
): [number, number][] {
  if (ring.length < 4) return ring;
  const open = ring.slice(0, ring.length - 1); // sans doublon final
  // dédup proches
  const dedup: [number, number][] = [];
  for (const p of open) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > minDist) dedup.push(p);
  }
  if (dedup.length < 3) return ring;
  // dédup boucle (premier vs dernier)
  while (
    dedup.length > 3 &&
    Math.hypot(dedup[0][0] - dedup[dedup.length - 1][0], dedup[0][1] - dedup[dedup.length - 1][1]) < minDist
  ) dedup.pop();
  // supprime colinéaires
  const out: [number, number][] = [];
  for (let i = 0; i < dedup.length; i++) {
    const a = dedup[(i - 1 + dedup.length) % dedup.length];
    const b = dedup[i];
    const c = dedup[(i + 1) % dedup.length];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > tolCross) out.push(b);
  }
  if (out.length < 3) return ring;
  out.push([out[0][0], out[0][1]]);
  return out;
}

type Verdict =
  | 'good_match'
  | 'partial_match'
  | 'bad_match'
  | 'skeleton_fail'
  | 'runtime_error'
  | 'scale_projection_issue'
  | 'infrastructure_invalid'
  | 'geometry_invalid';

type LikelyError =
  | 'map_params'
  | 'scale_factor'
  | 'projection_conversion'
  | 'geometry_units'
  | 'human_annotation_length'
  | 'skeleton_algorithm'
  | 'none';

interface ScaleDiagnostic {
  map_params: {
    centerLat: number | null;
    centerLng: number | null;
    zoom: number;
    image_size_px: number;
    scale: number;
  };
  meters_per_pixel_at_lat_zoom: number | null;
  feet_per_pixel: number | null;
  expected_image_width_m: number | null;

  building_bbox_width_px: number | null;
  building_bbox_height_px: number | null;
  building_bbox_width_m: number | null;
  building_bbox_height_m: number | null;
  polygon_area_m2: number | null;
  polygon_perimeter_m: number | null;

  human_ridge_length_px: number | null;
  human_ridge_length_m_from_latlng: number | null;
  human_ridge_length_m_from_px_scale: number | null;
  human_ridge_length_delta_m: number | null;

  skeleton_length_px: number | null;
  skeleton_length_m_from_geometry: number | null;
  skeleton_length_m_from_px_scale: number | null;
  skeleton_length_delta_m: number | null;

  scale_consistent: boolean;
  projection_consistent: boolean;
  likely_error_source: LikelyError;

  // ── Audit infrastructure (B1/B2/B3) ──
  map_zoom_used: number | null;
  debug_zoom_used: number | null;
  zoom_consistent: boolean;
  raw_annotations_count: number;
  deduped_annotations_count: number;
  duplicates_removed_count: number;
  extraction_annotations_valid: boolean;

  // ── Audit polygone bâtiment ──
  polygon_source_used: 'corrected_building_geojson' | 'original_building_geojson' | 'none';
  polygon_is_valid: boolean;
  polygon_vertices_count: number;
  polygon_bbox_m: { width: number; height: number } | null;
  geometry_invalid: boolean;
}

interface Report {
  skeleton_status: 'ok' | 'failed' | 'runtime_error';
  skeleton_fail: boolean;
  geometry_test_executed: boolean;
  error_type?: 'runtime_csp_wasm' | 'runtime_error' | 'geometry_error';
  edges_count: number;
  interior_edges_count: number;
  skeleton_length_m: number;
  human_ridge_length_m: number;
  length_ratio: number | null;
  chamfer_distance_m: number | null;
  main_edge_match: boolean;
  visual_verdict: Verdict;
  error?: string;
  diag?: ScaleDiagnostic;
}

interface PxEdge { ax: number; ay: number; bx: number; by: number; interior: boolean }
interface PxPoly { pts: Array<{ x: number; y: number }> }

/* ── Debug graph (infrastructure d'inspection — aucune logique algorithmique) ── */
interface DebugNode {
  node_id: number;
  x_m: number;
  y_m: number;
  x_px: number;
  y_px: number;
  time: number;
  degree: number;
  is_terminal: boolean;
  is_junction: boolean;
  is_original_polygon_vertex: boolean;
  is_inside_polygon: boolean;
}
interface DebugEdge {
  edge_id: string;
  a_node: number;
  b_node: number;
  length_m: number;
  orientation_deg: number;
  is_interior: boolean;
  is_terminal: boolean;
  is_inside_polygon: boolean;
  is_clipped: boolean;
  node_degree_start: number;
  node_degree_end: number;
  origin_stage: 'raw_polyskel' | 'clipped' | 'filtered' | 'classified' | 'architectural_ranked' | 'rendered';
  color_class: 'interior' | 'terminal' | 'external' | 'degenerate';
  ax_px: number; ay_px: number; bx_px: number; by_px: number;
  // ── Architectural ranking (purement additif, non utilisé par le pipeline géométrique) ──
  arch_score: number | null;
  length_score: number | null;
  time_score: number | null;
  cluster_score: number | null;
  angle_stability_score: number | null;
  collapse_penalty: number | null;
  phase_class: 'EARLY' | 'MID' | 'LATE_COLLAPSE' | null;
  collapse_cluster_id: number | null;
  is_architectural_candidate: boolean;
  is_collapse_artifact: boolean;
}
interface DebugGraph {
  nodes: DebugNode[];
  edges: DebugEdge[];
  adjacency: Record<number, number[]>;
  stats: {
    total_nodes: number;
    total_edges: number;
    terminal_nodes: number;
    junction_nodes: number;
    interior_edges: number;
    terminal_edges: number;
    external_edges: number;
    degenerate_edges: number;
  };
  raw_polyskel: {
    vertices_count: number;
    polygons_count: number;
    raw_edges_count: number;
  };
  architectural_summary?: {
    candidate_count: number;
    collapse_artifact_count: number;
    mean_arch_score: number | null;
    strongest_candidate: { edge_id: string; arch_score: number } | null;
    weakest_candidate: { edge_id: string; arch_score: number } | null;
    phase_distribution: { EARLY: number; MID: number; LATE_COLLAPSE: number };
    cluster_count: number;
  };
}

interface ExportEdge {
  edge_id: string;
  is_interior: boolean;
  type: 'unknown';
  segments_px: Array<{ x: number; y: number }>;
  segments_latlng: Array<{ lat: number; lng: number }>;
  length_px: number;
  length_m_from_geometry: number;
  length_m_from_px_scale: number | null;
  length_ft: number;
  orientation_deg: number;
  distance_to_boundary_m: number | null;
  confidence: number;
  nearest_human_annotation_id: string | null;
  chamfer_to_nearest_human_m: number | null;
  angle_delta_deg: number | null;
  overlap_ratio: number | null;
  match_status: 'matched' | 'partial_match' | 'unmatched';
}

interface ExportHumanAnnotation {
  annotation_id: string;
  tool_id: string | null;
  tool_name: string | null;
  tool_type: string | null;
  segments_px: Array<Array<{ x: number; y: number }>>;
  segments_latlng: Array<Array<{ lat: number; lng: number }>>;
  length_px: number;
  length_m_from_latlng: number;
  length_m_from_px_scale: number | null;
  length_ft: number;
  orientation_deg: number | null;
}

interface ExportPayload {
  reference: string | null;
  takeoff_id: string;
  generated_at: string;
  map_params: ScaleDiagnostic['map_params'];
  projection_diagnostics: {
    meters_per_pixel_at_lat_zoom: number | null;
    feet_per_pixel: number | null;
    expected_image_width_m: number | null;
    expected_image_height_m: number | null;
    projection_consistent: boolean;
    scale_consistent: boolean;
    likely_error_source: LikelyError;
    map_zoom_used: number | null;
    debug_zoom_used: number | null;
    zoom_consistent: boolean;
    raw_annotations_count: number;
    deduped_annotations_count: number;
    duplicates_removed_count: number;
    extraction_annotations_valid: boolean;
  };
  building_polygon: {
    source: 'corrected_building_geojson' | 'original_building_geojson' | 'none';
    is_valid: boolean;
    vertices_count: number;
    area_m2: number | null;
    perimeter_m: number | null;
    bbox_width_px: number | null;
    bbox_height_px: number | null;
    bbox_width_m: number | null;
    bbox_height_m: number | null;
    coords_latlng: Array<[number, number]>;
    coords_px: Array<{ x: number; y: number }>;
  };
  polygon_summary: {
    polygon_source_used: 'corrected_building_geojson' | 'original_building_geojson' | 'none';
    polygon_is_valid: boolean;
    polygon_vertices_count: number;
    polygon_area_m2: number | null;
    polygon_perimeter_m: number | null;
    polygon_bbox_m: { width: number | null; height: number | null };
    geometry_invalid: boolean;
  };
  skeleton_summary: {
    raw_edges_count: number;
    interior_edges_count: number;
    skeleton_total_length_m: number;
    longest_edge_m: number | null;
    longest_edge_orientation_deg: number | null;
  };
  match_summary: {
    chamfer_distance_m: number | null;
    mean_angle_delta_deg: number | null;
    overlap_ratio: number | null;
    matched_edges_count: number;
    unmatched_edges_count: number;
  };
  human_annotations: ExportHumanAnnotation[];
  skeleton: {
    status: Report['skeleton_status'];
    geometry_test_executed: boolean;
    edges_count: number;
    interior_edges_count: number;
    skeleton_length_m_from_geometry: number;
    skeleton_length_m_from_px_scale: number | null;
    main_edge_match: boolean;
    visual_verdict: Verdict;
    length_ratio: number | null;
    chamfer_distance_m: number | null;
    skeleton_quality_score: number | null;
  };
  skeleton_edges: ExportEdge[];
  debug_graph?: DebugGraph;
}

export default function SkeletonTestModal({ takeoff, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [pxEdges, setPxEdges] = useState<PxEdge[]>([]);
  const [pxBuilding, setPxBuilding] = useState<Array<{ x: number; y: number }>>([]);
  const [pxHumanLines, setPxHumanLines] = useState<PxPoly[]>([]);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [payload, setPayload] = useState<ExportPayload | null>(null);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const autoSaveAttempted = useRef<string | null>(null);
  const [runKey, setRunKey] = useState(0);

  // ── Pipeline géométrique (Phases 1-5) ──
  interface PxSimpEdge { ax: number; ay: number; bx: number; by: number; type: 'ridge' | 'valley' | 'hip' | 'unknown'; matched: boolean; partial: boolean; }
  const [pxSimpEdges, setPxSimpEdges] = useState<PxSimpEdge[]>([]);
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary | null>(null);
  const [showLayers, setShowLayers] = useState({
    raw: true, simplified: true, ridge: true, valley: true, hip: true, human: true, matchLinks: false,
  });
  // ── Debug infrastructure (toggleable layers, opacity, stage view) ──
  const [debugGraph, setDebugGraph] = useState<DebugGraph | null>(null);
  const [debugLayers, setDebugLayers] = useState({
    building_polygon: true,
    polygon_vertices: false,
    polygon_indices: false,
    raw_skeleton_edges: false,
    interior_edges_only: false,
    terminal_nodes: false,
    junction_nodes: false,
    edge_directions: false,
    edge_lengths: false,
    edge_ids: false,
    edge_types: false,
    node_degrees: false,
    medial_axis_debug: false,
    architectural_candidates: false,
    collapse_artifacts: false,
    phase_clusters: false,
    edge_arch_scores: false,
  });
  const [debugOpacity, setDebugOpacity] = useState(0.9);
  const [stageView, setStageView] = useState<'raw' | 'filtered' | 'classified' | 'rendered'>('rendered');
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  const aj = (takeoff.annotations_json && typeof takeoff.annotations_json === 'object' ? takeoff.annotations_json : {}) as any;

  // image + projection params
  const imgParams = useMemo(() => {
    const mp = aj.map_params || {};
    // BUG B1 — On utilise STRICTEMENT le zoom du takeoff (map_params.zoom).
    // Aucun "+1" nulle part. Le projection lat/lng→pixel, le mpp, et tous
    // les overlays (debug, skeleton, annotations) doivent partager ce zoom.
    const z = typeof mp.zoom === 'number' ? mp.zoom : 20;
    return {
      centerLat: typeof mp.centerLat === 'number' ? mp.centerLat : null,
      centerLng: typeof mp.centerLng === 'number' ? mp.centerLng : null,
      zoom: z,
      mapZoom: typeof mp.zoom === 'number' ? mp.zoom : null,
      imgSize: 1280,
      scale: 2,
    };
  }, [aj]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      // reset des états précédents pour bien voir la régénération
      setReport(null);
      setPayload(null);
      setPxEdges([]);
      setPxSimpEdges([]);
      setPipelineSummary(null);
      setQualityScore(null);
      setAutoSaved(false);
      autoSaveAttempted.current = null;
      setDebugGraph(null);
      // ── PRIORITÉ POLYGONE BÂTIMENT ──
      // 1) corrected_building_geojson si présent ET valide (≥3 sommets après nettoyage, aire>0)
      // 2) sinon original_building_geojson si valide
      // 3) sinon geometry_invalid = true → on ne lance PAS le skeleton
      const tryPolygon = (raw: unknown, source: 'corrected_building_geojson' | 'original_building_geojson') => {
        const geo = parseGeojsonValue(raw);
        const ring = extractOuterRing(geo);
        if (!ring || ring.length < 4) return null;
        return { source, ring };
      };
      const picked =
        tryPolygon(takeoff.corrected_building_geojson, 'corrected_building_geojson')
        || tryPolygon(takeoff.original_building_geojson, 'original_building_geojson');
      const polygonSourceUsed: ScaleDiagnostic['polygon_source_used'] =
        picked?.source ?? 'none';
      const ring = picked?.ring ?? null;
      if (!ring) {
        if (!cancel) {
          setReport({
            skeleton_status: 'failed', skeleton_fail: true, geometry_test_executed: false,
            error_type: 'geometry_error',
            edges_count: 0, interior_edges_count: 0,
            skeleton_length_m: 0, human_ridge_length_m: 0, length_ratio: null, chamfer_distance_m: null,
            main_edge_match: false, visual_verdict: 'geometry_invalid',
            error: 'Aucun polygone bâtiment exploitable (corrected/original null ou <3 sommets)',
          });
          setLoading(false);
        }
        return;
      }

      // centre projection
      const lat0 = imgParams.centerLat ?? ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const lng0 = imgParams.centerLng ?? ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const proj = makeLocalProjection(lat0);

      // ring en mètres, fermé, CCW
      let ringM: [number, number][] = ring.map((p) => proj.toM(p[0], p[1], lng0));
      // close if needed
      const first = ringM[0], last = ringM[ringM.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ringM.push([first[0], first[1]]);
      if (ringSignedArea(ringM) < 0) {
        ringM = ringM.slice().reverse();
      }
      // ── Nettoyage robuste avant polyskel ──
      // Les footprints bruts contiennent souvent des doublons ou des
      // micro-segments colinéaires qui font diverger polyskel (sommets
      // intérieurs projetés à l'extérieur). On dé-doublonne (<0.15m) et on
      // supprime les colinéaires, puis on borne pour le clipping plus bas.
      const ringMRaw = ringM;
      ringM = cleanRingM(ringM);
      const xsRing = ringM.map((p) => p[0]);
      const ysRing = ringM.map((p) => p[1]);
      const ringMinX = Math.min(...xsRing), ringMaxX = Math.max(...xsRing);
      const ringMinY = Math.min(...ysRing), ringMaxY = Math.max(...ysRing);
      const ringDiagM = Math.hypot(ringMaxX - ringMinX, ringMaxY - ringMinY);

      // ── Audit polygone (geometry guard) ──
      const polygonVerticesCount = Math.max(0, ringM.length - 1); // ring fermé
      const polygonAreaPre = ringM.length > 2 ? Math.abs(ringSignedArea(ringM)) : 0;
      const polygonBboxM = ringM.length > 2
        ? { width: ringMaxX - ringMinX, height: ringMaxY - ringMinY }
        : null;
      const polygonIsValid = polygonVerticesCount >= 3 && polygonAreaPre > 0;
      const polyDiag = {
        polygon_source_used: polygonSourceUsed,
        polygon_is_valid: polygonIsValid,
        polygon_vertices_count: polygonVerticesCount,
        polygon_bbox_m: polygonBboxM,
        geometry_invalid: !polygonIsValid,
      } as const;

      if (!polygonIsValid) {
        if (!cancel) {
          setReport({
            skeleton_status: 'failed', skeleton_fail: true, geometry_test_executed: false,
            error_type: 'geometry_error',
            edges_count: 0, interior_edges_count: 0,
            skeleton_length_m: 0, human_ridge_length_m: 0, length_ratio: null, chamfer_distance_m: null,
            main_edge_match: false, visual_verdict: 'geometry_invalid',
            error: `Polygone invalide après nettoyage (vertices=${polygonVerticesCount}, area=${polygonAreaPre.toFixed(2)} m²)`,
          });
          setLoading(false);
        }
        return;
      }

      let skeleton: any = null;
      let err: string | undefined;
      let errType: Report['error_type'] | undefined;
      try {
        await SkeletonBuilder.init();
        skeleton = SkeletonBuilder.buildFromPolygon([ringM as any]);
      } catch (e: any) {
        err = e?.message || String(e);
        if (/wasm|WebAssembly|unsafe-eval/i.test(err || '')) {
          errType = 'runtime_csp_wasm';
        } else {
          errType = 'runtime_error';
        }
      }

      // image url
      const url = takeoff.raw_image_url || null;

      // human ridge (faîtière)
      const tools: any[] = Array.isArray(aj.tools) ? aj.tools : [];
      const ridgeTool =
        tools.find((t: any) => /faiti|ridge/i.test(t?.name || '') || /faiti|ridge/i.test(t?.id || ''))
        || tools.find((t: any) => /MULTI_SEGMENT/i.test(t?.type || ''))
        || null;
      const annotationsAll: any[] = Array.isArray(aj.annotations) ? aj.annotations : [];

      // BUG B2 — Extracteur: on lit annotations[].segments (lat/lng) et on
      // génère segments_px avec la MÊME projection Web Mercator que l'image
      // (latLngToImagePx + imgParams.zoom). Si aucun tool ridge trouvé, on
      // accepte toutes les annotations avec segments non-vides.
      const rawRidgeAnns = ridgeTool
        ? annotationsAll.filter((a) => a.target === ridgeTool.id)
        : annotationsAll;
      const rawAnnotationsCount = rawRidgeAnns.length;

      // BUG B3 — Déduplication par hash des segments (lat/lng arrondis ~1e-7°).
      const hashSegments = (a: any): string => {
        const segs: any[] = Array.isArray(a?.segments) ? a.segments : [];
        return segs
          .map((seg: any[]) =>
            (Array.isArray(seg) ? seg : [])
              .map((pt: any) => `${(+pt?.lat).toFixed(7)},${(+pt?.lng).toFixed(7)}`)
              .join('|')
          )
          .join(';');
      };
      const dedupMap = new Map<string, any>();
      for (const a of rawRidgeAnns) {
        const h = hashSegments(a);
        if (h && !dedupMap.has(h)) dedupMap.set(h, a);
      }
      const ridgeAnns = Array.from(dedupMap.values());
      const dedupedAnnotationsCount = ridgeAnns.length;
      const duplicatesRemovedCount = rawAnnotationsCount - dedupedAnnotationsCount;

      // extraction_annotations_valid: au moins 1 annotation avec ≥1 segment
      // composé de points {lat,lng} numériques valides.
      const extractionAnnotationsValid = ridgeAnns.some((a) => {
        const segs: any[] = Array.isArray(a?.segments) ? a.segments : [];
        return segs.some((seg: any[]) =>
          Array.isArray(seg) && seg.length >= 2 &&
          seg.every((pt: any) => Number.isFinite(+pt?.lat) && Number.isFinite(+pt?.lng))
        );
      });

      const humanSegs: Array<Array<{ lat: number; lng: number }>> = ridgeAnns
        .flatMap((a) => Array.isArray(a.segments) ? a.segments : []);
      const humanLenM = humanSegs.reduce((s, seg) => s + segLenM(seg, proj, lng0), 0);

      const canProject = imgParams.centerLat != null && imgParams.centerLng != null;

      // IMPORTANT — Le polygone DOIT être projeté par le MÊME pipeline que le
      // skeleton (mètres → fromM → Mercator px), sinon Mercator (direct) et
      // équirectangulaire (round-trip) divergent et le skeleton apparaît
      // décalé en X/Y vs le polygone. On part de ringM (mètres locaux) pour
      // garantir un alignement 1:1 polygone ↔ skeleton dans le SVG overlay.
      const pxB = canProject
        ? ringM.map(([mx, my]) => {
            const [lngP, latP] = proj.fromM(mx, my, lng0);
            return latLngToImagePx(latP, lngP, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale);
          })
        : [];

      const pxH: PxPoly[] = canProject
        ? humanSegs.map((seg) => ({
            pts: seg.map((pt) => latLngToImagePx(pt.lat, pt.lng, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale)),
          }))
        : [];

      // ─── Diagnostic SCALE / PROJECTION (calculé même si skeleton fail) ───
      // BUG B1 — Formule mètres/pixel correcte (référentiel logique du
      // projecteur, le même que latLngToImagePx, qui n'applique PAS `scale`).
      //   mpp = 156543.03392 * cos(lat) / 2^zoom
      // Ne PAS diviser par `scale` (sinon mpp moitié → "comme si zoom+1").
      const mpp =
        imgParams.centerLat != null
          ? (156543.03392 * Math.cos((imgParams.centerLat * Math.PI) / 180)) /
            Math.pow(2, imgParams.zoom)
          : null;
      const feetPerPx = mpp != null ? mpp * 3.28084 : null;
      const expectedImgWidthM = mpp != null ? mpp * imgParams.imgSize : null;

      // BUG B1 — zoom audit (map_zoom_used vs debug_zoom_used).
      // On n'utilise QUE imgParams.zoom partout (mpp + projection + overlays).
      // Donc tant que imgParams.zoom === map_params.zoom, zoom_consistent=true.
      const mapZoomUsed = imgParams.mapZoom;
      const debugZoomUsed = imgParams.zoom;
      const zoomConsistent = mapZoomUsed != null && mapZoomUsed === debugZoomUsed;

      // bbox bâtiment
      let bboxWpx: number | null = null, bboxHpx: number | null = null;
      let bboxWm: number | null = null, bboxHm: number | null = null;
      let polyAreaM2: number | null = null, polyPerimM: number | null = null;
      if (pxB.length > 2) {
        const xs = pxB.map((p) => p.x); const ys = pxB.map((p) => p.y);
        bboxWpx = Math.max(...xs) - Math.min(...xs);
        bboxHpx = Math.max(...ys) - Math.min(...ys);
        if (mpp != null) { bboxWm = bboxWpx * mpp; bboxHm = bboxHpx * mpp; }
      }
      // poly aire + périmètre en mètres (depuis ringM)
      if (ringM.length > 2) {
        polyAreaM2 = Math.abs(ringSignedArea(ringM));
        let per = 0;
        for (let i = 0; i + 1 < ringM.length; i++) {
          per += Math.hypot(ringM[i + 1][0] - ringM[i][0], ringM[i + 1][1] - ringM[i][1]);
        }
        polyPerimM = per;
      }

      // longueurs humaines
      let humanLenPx = 0;
      for (const poly of pxH) {
        for (let i = 0; i + 1 < poly.pts.length; i++) {
          humanLenPx += Math.hypot(poly.pts[i + 1].x - poly.pts[i].x, poly.pts[i + 1].y - poly.pts[i].y);
        }
      }
      const humanLenMFromPx = mpp != null ? humanLenPx * mpp : null;
      const humanLenDelta =
        humanLenMFromPx != null ? Math.abs(humanLenM - humanLenMFromPx) : null;

      if (!skeleton) {
        if (!cancel) {
          setImgUrl(url);
          setPxBuilding(pxB);
          setPxHumanLines(pxH);
          setReport({
            skeleton_status: errType ? 'runtime_error' : 'failed',
            skeleton_fail: !errType,
            geometry_test_executed: false,
            error_type: errType,
            edges_count: 0, interior_edges_count: 0,
            skeleton_length_m: 0, human_ridge_length_m: humanLenM,
            length_ratio: null, chamfer_distance_m: null,
            main_edge_match: false,
            visual_verdict: errType ? 'runtime_error' : 'skeleton_fail',
            error: err || 'SkeletonBuilder a renvoyé null',
            diag: {
              map_params: {
                centerLat: imgParams.centerLat, centerLng: imgParams.centerLng,
                zoom: imgParams.zoom, image_size_px: imgParams.imgSize, scale: imgParams.scale,
              },
              meters_per_pixel_at_lat_zoom: mpp,
              feet_per_pixel: feetPerPx,
              expected_image_width_m: expectedImgWidthM,
              building_bbox_width_px: bboxWpx, building_bbox_height_px: bboxHpx,
              building_bbox_width_m: bboxWm, building_bbox_height_m: bboxHm,
              polygon_area_m2: polyAreaM2, polygon_perimeter_m: polyPerimM,
              human_ridge_length_px: humanLenPx || null,
              human_ridge_length_m_from_latlng: humanLenM || null,
              human_ridge_length_m_from_px_scale: humanLenMFromPx,
              human_ridge_length_delta_m: humanLenDelta,
              skeleton_length_px: null,
              skeleton_length_m_from_geometry: null,
              skeleton_length_m_from_px_scale: null,
              skeleton_length_delta_m: null,
              scale_consistent: false,
              projection_consistent: false,
              likely_error_source: errType ? 'skeleton_algorithm' : 'map_params',
              map_zoom_used: mapZoomUsed,
              debug_zoom_used: debugZoomUsed,
              zoom_consistent: zoomConsistent,
              raw_annotations_count: rawAnnotationsCount,
              deduped_annotations_count: dedupedAnnotationsCount,
              duplicates_removed_count: duplicatesRemovedCount,
              extraction_annotations_valid: extractionAnnotationsValid,
              ...polyDiag,
            },
          });
          setLoading(false);
        }
        return;
      }

      // arêtes uniques du skeleton
      const verts: Array<[number, number, number]> = skeleton.vertices;
      const edgeMap = new Map<string, { a: number; b: number }>();
      for (const poly of skeleton.polygons) {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          const k = a < b ? `${a}_${b}` : `${b}_${a}`;
          if (!edgeMap.has(k)) edgeMap.set(k, { a, b });
        }
      }
      const edges = Array.from(edgeMap.values());
      // un sommet original a time≈0
      const isInterior = (idx: number) => (verts[idx]?.[2] ?? 0) > 1e-6;

      let skelLenM = 0;
      const interiorEdges: Array<{ a: number; b: number }> = [];
      for (const e of edges) {
        const va = verts[e.a], vb = verts[e.b];
        if (!va || !vb) continue;
        const d = Math.hypot(va[0] - vb[0], va[1] - vb[1]);
        if (!isInterior(e.a) || !isInterior(e.b)) continue;
        // ── Clipping de sûreté ──
        // Rejette les arêtes "fantômes" (instabilité polyskel) :
        //  - plus longues que la diagonale du bâtiment
        //  - dont le milieu tombe à l'extérieur du polygone (>1m)
        //  - dont un sommet sort largement de la bbox du polygone
        if (d > ringDiagM) continue;
        const margin = 1.0;
        if (
          va[0] < ringMinX - margin || va[0] > ringMaxX + margin ||
          va[1] < ringMinY - margin || va[1] > ringMaxY + margin ||
          vb[0] < ringMinX - margin || vb[0] > ringMaxX + margin ||
          vb[1] < ringMinY - margin || vb[1] > ringMaxY + margin
        ) continue;
        const mx = (va[0] + vb[0]) / 2;
        const my = (va[1] + vb[1]) / 2;
        if (!pointInRingM(mx, my, ringM)) continue;
        skelLenM += d;
        interiorEdges.push(e);
      }

      // projection des arêtes skeleton vers lat/lng puis pixels
      const pxEdgesAll: PxEdge[] = [];
      const interiorKeySet = new Set(interiorEdges.map((e) => (e.a < e.b ? `${e.a}_${e.b}` : `${e.b}_${e.a}`)));
      if (canProject) {
        for (const e of edges) {
          const va = verts[e.a], vb = verts[e.b]; if (!va || !vb) continue;
          const [lngA, latA] = proj.fromM(va[0], va[1], lng0);
          const [lngB, latB] = proj.fromM(vb[0], vb[1], lng0);
          const pa = latLngToImagePx(latA, lngA, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale);
          const pb = latLngToImagePx(latB, lngB, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale);
          const k = e.a < e.b ? `${e.a}_${e.b}` : `${e.b}_${e.a}`;
          pxEdgesAll.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, interior: interiorKeySet.has(k) });
        }
      }

      // ── DEBUG GRAPH (infra d'inspection, dérivé pur — aucune logique algorithmique) ──
      const dbgAdj: Record<number, number[]> = {};
      for (const e of edges) {
        (dbgAdj[e.a] ||= []).push(e.b);
        (dbgAdj[e.b] ||= []).push(e.a);
      }
      const dbgUsedNodes = new Set<number>();
      for (const e of edges) { dbgUsedNodes.add(e.a); dbgUsedNodes.add(e.b); }
      const dbgNodes: DebugNode[] = [];
      for (const idx of Array.from(dbgUsedNodes).sort((a, b) => a - b)) {
        const v = verts[idx]; if (!v) continue;
        const deg = (dbgAdj[idx] || []).length;
        const time = v[2] ?? 0;
        const isOriginal = time < 1e-6;
        let xpx = -1, ypx = -1;
        if (canProject) {
          const [lngN, latN] = proj.fromM(v[0], v[1], lng0);
          const pn = latLngToImagePx(latN, lngN, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale);
          xpx = pn.x; ypx = pn.y;
        }
        dbgNodes.push({
          node_id: idx,
          x_m: v[0], y_m: v[1],
          x_px: xpx, y_px: ypx,
          time,
          degree: deg,
          is_terminal: deg === 1,
          is_junction: deg >= 3,
          is_original_polygon_vertex: isOriginal,
          is_inside_polygon: !isOriginal && pointInRingM(v[0], v[1], ringM),
        });
      }
      const dbgNodeById = new Map(dbgNodes.map((n) => [n.node_id, n]));
      const dbgEdges: DebugEdge[] = [];
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const va = verts[e.a], vb = verts[e.b]; if (!va || !vb) continue;
        const len = Math.hypot(va[0] - vb[0], va[1] - vb[1]);
        const orient = ((Math.atan2(vb[1] - va[1], vb[0] - va[0]) * 180) / Math.PI + 360) % 180;
        const k = e.a < e.b ? `${e.a}_${e.b}` : `${e.b}_${e.a}`;
        const interior = interiorKeySet.has(k);
        const nA = dbgNodeById.get(e.a); const nB = dbgNodeById.get(e.b);
        const degStart = nA?.degree ?? 0; const degEnd = nB?.degree ?? 0;
        const midInside = pointInRingM((va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, ringM);
        const isTerminal = degStart === 1 || degEnd === 1;
        const intA = (verts[e.a]?.[2] ?? 0) > 1e-6;
        const intB = (verts[e.b]?.[2] ?? 0) > 1e-6;
        const isClipped = (intA && intB) && !interior;
        let colorClass: DebugEdge['color_class'] = 'external';
        if (len < 1e-3) colorClass = 'degenerate';
        else if (interior) colorClass = 'interior';
        else if (isTerminal) colorClass = 'terminal';
        let originStage: DebugEdge['origin_stage'] = 'raw_polyskel';
        if (isClipped) originStage = 'clipped';
        else if (interior) originStage = 'filtered';
        let axp = -1, ayp = -1, bxp = -1, byp = -1;
        if (canProject) {
          const [lngA2, latA2] = proj.fromM(va[0], va[1], lng0);
          const [lngB2, latB2] = proj.fromM(vb[0], vb[1], lng0);
          const pa2 = latLngToImagePx(latA2, lngA2, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale);
          const pb2 = latLngToImagePx(latB2, lngB2, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale);
          axp = pa2.x; ayp = pa2.y; bxp = pb2.x; byp = pb2.y;
        }
        dbgEdges.push({
          edge_id: `e${i}`,
          a_node: e.a, b_node: e.b,
          length_m: len,
          orientation_deg: orient,
          is_interior: interior,
          is_terminal: isTerminal,
          is_inside_polygon: midInside,
          is_clipped: isClipped,
          node_degree_start: degStart,
          node_degree_end: degEnd,
          origin_stage: originStage,
          color_class: colorClass,
          ax_px: axp, ay_px: ayp, bx_px: bxp, by_px: byp,
          arch_score: null,
          length_score: null,
          time_score: null,
          cluster_score: null,
          angle_stability_score: null,
          collapse_penalty: null,
          phase_class: null,
          collapse_cluster_id: null,
          is_architectural_candidate: false,
          is_collapse_artifact: false,
        });
      }
      const debugGraphLocal: DebugGraph = {
        nodes: dbgNodes,
        edges: dbgEdges,
        adjacency: dbgAdj,
        stats: {
          total_nodes: dbgNodes.length,
          total_edges: dbgEdges.length,
          terminal_nodes: dbgNodes.filter((n) => n.is_terminal).length,
          junction_nodes: dbgNodes.filter((n) => n.is_junction).length,
          interior_edges: dbgEdges.filter((e) => e.is_interior).length,
          terminal_edges: dbgEdges.filter((e) => e.is_terminal && !e.is_interior).length,
          external_edges: dbgEdges.filter((e) => e.color_class === 'external').length,
          degenerate_edges: dbgEdges.filter((e) => e.color_class === 'degenerate').length,
        },
        raw_polyskel: {
          vertices_count: verts.length,
          polygons_count: skeleton.polygons.length,
          raw_edges_count: edges.length,
        },
      };
      // ─────────────────────────────────────────────────────────────────────
      // ARCHITECTURAL EDGE RANKING (couche additive — NE TOUCHE NI polyskel,
      // NI geometry, NI rendering existant). Objectif: séparer les vraies
      // ridges plausibles des artefacts médiaux de collapse polyskel.
      // ─────────────────────────────────────────────────────────────────────
      {
        const interiorDbg = dbgEdges.filter((e) => e.is_interior);
        // 1) Collapse-time bornes (loop évite stack overflow vs Math.max(...arr))
        let tMax = -Infinity, tMin = Infinity;
        for (const e of interiorDbg) {
          const ta = verts[e.a_node]?.[2] ?? 0;
          const tb = verts[e.b_node]?.[2] ?? 0;
          const tt = Math.max(ta, tb);
          if (tt > tMax) tMax = tt;
          if (tt < tMin) tMin = tt;
        }
        if (!isFinite(tMax)) tMax = 0;
        if (!isFinite(tMin)) tMin = 0;
        const tSpan = Math.max(1e-6, tMax - tMin);
        // 2) Clusters de collapse via GRILLE SPATIALE (O(N) au lieu de O(N²)).
        //    distance spatiale < 2m  ET  delta_time normalisé < 0.5
        const interiorNodeIds = new Set<number>();
        for (const e of interiorDbg) { interiorNodeIds.add(e.a_node); interiorNodeIds.add(e.b_node); }
        const nodeArr = Array.from(interiorNodeIds).map((id) => {
          const v = verts[id];
          return { id, x: v?.[0] ?? 0, y: v?.[1] ?? 0, t: v?.[2] ?? 0 };
        });
        const clusterOf = new Map<number, number>();
        const parent = new Map<number, number>();
        const find = (x: number): number => {
          let r = x; while (parent.get(r) !== r) r = parent.get(r)!;
          let c = x; while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
          return r;
        };
        const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
        for (const n of nodeArr) parent.set(n.id, n.id);
        const CELL = 2.0; // = seuil distance, voisinage = 9 cellules
        const grid = new Map<string, number[]>();
        const keyOf = (cx: number, cy: number) => `${cx}|${cy}`;
        for (let i = 0; i < nodeArr.length; i++) {
          const n = nodeArr[i];
          const cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL);
          const k = keyOf(cx, cy);
          let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); }
          arr.push(i);
        }
        for (let i = 0; i < nodeArr.length; i++) {
          const a = nodeArr[i];
          const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const bucket = grid.get(keyOf(cx + dx, cy + dy)); if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              const b = nodeArr[j];
              const ddx = a.x - b.x, ddy = a.y - b.y;
              if (ddx * ddx + ddy * ddy > CELL * CELL) continue;
              const dt = Math.abs(a.t - b.t) / tSpan;
              if (dt < 0.5) union(a.id, b.id);
            }
          }
        }
        const rootCounts = new Map<number, number>();
        for (const n of nodeArr) {
          const r = find(n.id);
          rootCounts.set(r, (rootCounts.get(r) ?? 0) + 1);
        }
        // cluster_id stable: index séquentiel parmi roots de taille >= 3
        const clusterRoots = Array.from(rootCounts.entries()).filter(([, c]) => c >= 3).map(([r]) => r);
        const clusterIdByRoot = new Map<number, number>();
        clusterRoots.forEach((r, idx) => clusterIdByRoot.set(r, idx));
        for (const n of nodeArr) {
          const r = find(n.id);
          const cid = clusterIdByRoot.get(r);
          if (cid != null) clusterOf.set(n.id, cid);
        }
        // 3) Score par edge intérieure
        //    Index d'adjacence node_id → indices d'edges intérieures, O(E).
        const nodeToInteriorEdges = new Map<number, number[]>();
        for (let i = 0; i < interiorDbg.length; i++) {
          const e = interiorDbg[i];
          let la = nodeToInteriorEdges.get(e.a_node); if (!la) { la = []; nodeToInteriorEdges.set(e.a_node, la); }
          la.push(i);
          let lb = nodeToInteriorEdges.get(e.b_node); if (!lb) { lb = []; nodeToInteriorEdges.set(e.b_node, lb); }
          lb.push(i);
        }
        const orientByEdge = interiorDbg.map((e) => e.orientation_deg);
        const neighborAngles = (idx: number): number[] => {
          const e = interiorDbg[idx];
          const seen = new Set<number>();
          const out: number[] = [];
          const addFrom = (nid: number) => {
            const list = nodeToInteriorEdges.get(nid); if (!list) return;
            for (const j of list) { if (j === idx || seen.has(j)) continue; seen.add(j); out.push(orientByEdge[j]); }
          };
          addFrom(e.a_node); addFrom(e.b_node);
          return out;
        };
        let strongest: { edge_id: string; arch_score: number } | null = null;
        let weakest: { edge_id: string; arch_score: number } | null = null;
        let sumScore = 0, scored = 0;
        let candCount = 0, artCount = 0;
        const phaseDist = { EARLY: 0, MID: 0, LATE_COLLAPSE: 0 };
        for (let i = 0; i < interiorDbg.length; i++) {
          const e = interiorDbg[i];
          // (1) Length score: 1.0 si >=4m, linéaire entre 1.5m..4m, pénalité <1.5m
          let lenS: number;
          if (e.length_m >= 4) lenS = 1;
          else if (e.length_m >= 1.5) lenS = (e.length_m - 1.5) / 2.5;
          else lenS = -((1.5 - e.length_m) / 1.5); // jusqu'à -1
          // (2) Terminal distance score: edges connectées à degrés élevés (volume)
          //     bonus si min(deg) >= 3, pénalité si terminal
          const minDeg = Math.min(e.node_degree_start, e.node_degree_end);
          const termS = e.is_terminal ? -0.5 : Math.min(1, (minDeg - 1) / 3);
          // (3) Collapse time score: tNorm in [0,1]. early/mid bons, late mauvais.
          const tEdge = Math.max(verts[e.a_node]?.[2] ?? 0, verts[e.b_node]?.[2] ?? 0);
          const tNorm = tSpan > 0 ? (tEdge - tMin) / tSpan : 0;
          let timeS: number;
          if (tNorm < 0.33) timeS = 1;
          else if (tNorm < 0.66) timeS = 0.6;
          else timeS = -1 + (1 - tNorm) * 2; // descend jusqu'à -1 vers tNorm=1
          // (4) Angle stability: variance des orientations voisines (mod 180)
          const ang = neighborAngles(i);
          let angS = 0.5; // neutre si pas de voisin
          if (ang.length) {
            // distance angulaire circulaire mod 180
            const deltas = ang.map((a) => {
              let d = Math.abs(a - e.orientation_deg) % 180;
              if (d > 90) d = 180 - d;
              return d;
            });
            const meanDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
            // 0deg -> 1, 45deg -> 0, 90deg -> -1
            angS = Math.max(-1, Math.min(1, 1 - meanDelta / 45));
          }
          // (5) Medial cluster penalty: -1 si les 2 nœuds dans un cluster
          const cidA = clusterOf.get(e.a_node);
          const cidB = clusterOf.get(e.b_node);
          const inCluster = cidA != null && cidB != null && cidA === cidB;
          const clusterId = inCluster ? cidA! : null;
          const collapsePenalty = inCluster ? -1 : 0;
          const clusterS = inCluster ? -1 : 0;
          // Pondération
          const arch =
            lenS * 0.30 +
            termS * 0.15 +
            timeS * 0.25 +
            angS * 0.15 +
            collapsePenalty * 0.15;
          const phase: 'EARLY' | 'MID' | 'LATE_COLLAPSE' =
            tNorm < 0.33 ? 'EARLY' : tNorm < 0.66 ? 'MID' : 'LATE_COLLAPSE';
          phaseDist[phase] += 1;
          const isCandidate = arch >= 0.35 && !inCluster && e.length_m >= 1.5;
          const isArtifact = arch <= -0.2 || (inCluster && phase === 'LATE_COLLAPSE');
          if (isCandidate) candCount++;
          if (isArtifact) artCount++;
          // Mutation directe (référence partagée avec debugGraphLocal.edges)
          e.length_score = lenS;
          e.time_score = timeS;
          e.cluster_score = clusterS;
          e.angle_stability_score = angS;
          e.collapse_penalty = collapsePenalty;
          e.arch_score = arch;
          e.phase_class = phase;
          e.collapse_cluster_id = clusterId;
          e.is_architectural_candidate = isCandidate;
          e.is_collapse_artifact = isArtifact;
          e.origin_stage = 'architectural_ranked';
          sumScore += arch; scored++;
          if (!strongest || arch > strongest.arch_score) strongest = { edge_id: e.edge_id, arch_score: arch };
          if (!weakest || arch < weakest.arch_score) weakest = { edge_id: e.edge_id, arch_score: arch };
        }
        debugGraphLocal.architectural_summary = {
          candidate_count: candCount,
          collapse_artifact_count: artCount,
          mean_arch_score: scored ? sumScore / scored : null,
          strongest_candidate: strongest,
          weakest_candidate: weakest,
          phase_distribution: phaseDist,
          cluster_count: clusterRoots.length,
        };
      }
      if (!cancel) setDebugGraph(debugGraphLocal);

      // chamfer distance (humain → skeleton intérieur), en mètres
      let chamfer: number | null = null;
      if (humanSegs.length && interiorEdges.length) {
        // échantillonne ~50 points par segment
        const samplesM: Array<[number, number]> = [];
        for (const seg of humanSegs) {
          for (let i = 0; i + 1 < seg.length; i++) {
            const [ax, ay] = proj.toM(seg[i].lng, seg[i].lat, lng0);
            const [bx, by] = proj.toM(seg[i + 1].lng, seg[i + 1].lat, lng0);
            const segLen = Math.hypot(bx - ax, by - ay);
            const n = Math.max(2, Math.min(50, Math.round(segLen / 0.2)));
            for (let k = 0; k <= n; k++) {
              const t = k / n;
              samplesM.push([ax + t * (bx - ax), ay + t * (by - ay)]);
            }
          }
        }
        let sum = 0;
        for (const [px, py] of samplesM) {
          let best = Infinity;
          for (const e of interiorEdges) {
            const va = verts[e.a], vb = verts[e.b];
            const d = distPointToSeg(px, py, va[0], va[1], vb[0], vb[1]);
            if (d < best) best = d;
          }
          sum += best;
        }
        chamfer = sum / samplesM.length;
      }

      const lengthRatio = humanLenM > 0 ? skelLenM / humanLenM : null;
      const mainEdgeMatch = chamfer != null && chamfer < 1.0; // <1m du tracé humain

      // ── longueur skeleton en pixels (à partir de pxEdgesAll interior) ──
      let skelLenPx = 0;
      for (const e of pxEdgesAll) {
        if (!e.interior) continue;
        skelLenPx += Math.hypot(e.bx - e.ax, e.by - e.ay);
      }
      const skelLenMFromPx = mpp != null ? skelLenPx * mpp : null;
      const skelLenDelta = skelLenMFromPx != null ? Math.abs(skelLenM - skelLenMFromPx) : null;

      // ── cohérence ──
      // scale_consistent: longueurs (px → m) ≈ longueurs (lat/lng → m), tolérance 10% ou 0.3 m
      const within = (a: number, b: number, relTol = 0.1, absTol = 0.3) =>
        Math.abs(a - b) <= Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
      const scaleHumanOk = humanLenMFromPx == null || humanLenM === 0 ? true : within(humanLenM, humanLenMFromPx);
      const scaleSkelOk = skelLenMFromPx == null ? true : within(skelLenM, skelLenMFromPx);
      const scaleConsistent = scaleHumanOk && scaleSkelOk;

      // projection_consistent: bbox bâtiment en m (depuis ring) vs bbox px * mpp
      let bboxFromRingW: number | null = null, bboxFromRingH: number | null = null;
      if (ringM.length > 2) {
        const xs = ringM.map((p) => p[0]); const ys = ringM.map((p) => p[1]);
        bboxFromRingW = Math.max(...xs) - Math.min(...xs);
        bboxFromRingH = Math.max(...ys) - Math.min(...ys);
      }
      const projW = bboxWm != null && bboxFromRingW != null ? within(bboxFromRingW, bboxWm, 0.05, 0.5) : true;
      const projH = bboxHm != null && bboxFromRingH != null ? within(bboxFromRingH, bboxHm, 0.05, 0.5) : true;
      const projectionConsistent = projW && projH;

      // diagnostic source d'erreur la plus probable
      let likely: LikelyError = 'none';
      if (!projectionConsistent) {
        likely = imgParams.centerLat == null ? 'map_params' : 'projection_conversion';
      } else if (!scaleHumanOk && scaleSkelOk) likely = 'human_annotation_length';
      else if (!scaleSkelOk && scaleHumanOk) likely = 'skeleton_algorithm';
      else if (!scaleConsistent) likely = 'scale_factor';
      else if (lengthRatio != null && (lengthRatio < 0.5 || lengthRatio > 2.0)) likely = 'geometry_units';

      let verdict: Verdict;
      // Garde infrastructure (B1/B2/B3) : si zoom inconsistent OU extracteur
      // annotations invalide → on N'AFFICHE PAS bad_match / partial_match.
      if (!zoomConsistent || !extractionAnnotationsValid) verdict = 'infrastructure_invalid';
      else if (!scaleConsistent || !projectionConsistent) verdict = 'scale_projection_issue';
      else if (interiorEdges.length === 0) verdict = 'skeleton_fail';
      else if (chamfer == null) verdict = 'partial_match';
      else if (chamfer < 0.7 && lengthRatio != null && lengthRatio > 0.6 && lengthRatio < 1.8) verdict = 'good_match';
      else if (chamfer < 1.5) verdict = 'partial_match';
      else verdict = 'bad_match';

      // ── Per-annotation export structures ──
      const exportAnnotations: ExportHumanAnnotation[] = [];
      for (const a of ridgeAnns) {
        const segs: Array<Array<{ lat: number; lng: number }>> = Array.isArray(a.segments) ? a.segments : [];
        const segsPx = segs.map((seg) =>
          seg.map((pt) => canProject
            ? latLngToImagePx(pt.lat, pt.lng, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale)
            : { x: 0, y: 0 })
        );
        let lenPx = 0;
        for (const seg of segsPx) {
          for (let i = 0; i + 1 < seg.length; i++) lenPx += Math.hypot(seg[i + 1].x - seg[i].x, seg[i + 1].y - seg[i].y);
        }
        const lenM = segs.reduce((s, seg) => s + segLenM(seg, proj, lng0), 0);
        const lenMpx = mpp != null ? lenPx * mpp : null;
        // orientation depuis premier → dernier
        let orient: number | null = null;
        const first = segs[0]?.[0];
        const lastSeg = segs[segs.length - 1];
        const last = lastSeg?.[lastSeg.length - 1];
        if (first && last) {
          const [ax, ay] = proj.toM(first.lng, first.lat, lng0);
          const [bx, by] = proj.toM(last.lng, last.lat, lng0);
          orient = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
        }
        exportAnnotations.push({
          annotation_id: String(a.id || ''),
          tool_id: ridgeTool?.id ?? null,
          tool_name: ridgeTool?.name ?? null,
          tool_type: ridgeTool?.type ?? 'MULTI_SEGMENT',
          segments_px: segsPx,
          segments_latlng: segs,
          length_px: lenPx,
          length_m_from_latlng: lenM,
          length_m_from_px_scale: lenMpx,
          length_ft: lenM * 3.28084,
          orientation_deg: orient,
        });
      }

      // ── Per-edge export + matching (humain ↔ skeleton) ──
      const exportEdges: ExportEdge[] = [];
      const humanSamplesByAnn: Array<{ id: string; pts: Array<[number, number]>; orient: number | null }> = [];
      for (const ann of exportAnnotations) {
        const pts: Array<[number, number]> = [];
        for (const seg of ann.segments_latlng) {
          for (let i = 0; i + 1 < seg.length; i++) {
            const [ax, ay] = proj.toM(seg[i].lng, seg[i].lat, lng0);
            const [bx, by] = proj.toM(seg[i + 1].lng, seg[i + 1].lat, lng0);
            const segLen = Math.hypot(bx - ax, by - ay);
            const n = Math.max(2, Math.min(50, Math.round(segLen / 0.2)));
            for (let k = 0; k <= n; k++) {
              const t = k / n;
              pts.push([ax + t * (bx - ax), ay + t * (by - ay)]);
            }
          }
        }
        humanSamplesByAnn.push({ id: ann.annotation_id, pts, orient: ann.orientation_deg });
      }

      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        const va = verts[e.a], vb = verts[e.b];
        if (!va || !vb) continue;
        const interior = isInterior(e.a) && isInterior(e.b);
        const lenGeom = Math.hypot(va[0] - vb[0], va[1] - vb[1]);
        const [lngA, latA] = proj.fromM(va[0], va[1], lng0);
        const [lngB, latB] = proj.fromM(vb[0], vb[1], lng0);
        const pa = canProject ? latLngToImagePx(latA, lngA, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale) : { x: 0, y: 0 };
        const pb = canProject ? latLngToImagePx(latB, lngB, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale) : { x: 0, y: 0 };
        const lenPx = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        const lenMpx = mpp != null ? lenPx * mpp : null;
        const orient = (Math.atan2(vb[1] - va[1], vb[0] - va[0]) * 180) / Math.PI;

        // matching: échantillonne arête skeleton, distance moyenne au plus proche échantillon humain
        let nearestId: string | null = null;
        let bestChamfer: number | null = null;
        let angleDelta: number | null = null;
        let overlap: number | null = null;
        if (interior && humanSamplesByAnn.length) {
          const nSamples = Math.max(2, Math.min(30, Math.round(lenGeom / 0.3)));
          const skSamples: Array<[number, number]> = [];
          for (let k = 0; k <= nSamples; k++) {
            const t = k / nSamples;
            skSamples.push([va[0] + t * (vb[0] - va[0]), va[1] + t * (vb[1] - va[1])]);
          }
          let bestAvg = Infinity;
          let bestAnn = humanSamplesByAnn[0];
          for (const ann of humanSamplesByAnn) {
            if (!ann.pts.length) continue;
            let sum = 0;
            for (const [sx, sy] of skSamples) {
              let dmin = Infinity;
              for (const [hx, hy] of ann.pts) {
                const d = Math.hypot(sx - hx, sy - hy);
                if (d < dmin) dmin = d;
              }
              sum += dmin;
            }
            const avg = sum / skSamples.length;
            if (avg < bestAvg) { bestAvg = avg; bestAnn = ann; }
          }
          nearestId = bestAnn.id || null;
          bestChamfer = bestAvg;
          if (bestAnn.orient != null) {
            let d = Math.abs(((orient - bestAnn.orient + 540) % 360) - 180);
            if (d > 90) d = 180 - d;
            angleDelta = d;
          }
          // overlap: % de skSamples dont distance < 1.0 m
          let inBand = 0;
          for (const [sx, sy] of skSamples) {
            let dmin = Infinity;
            for (const [hx, hy] of bestAnn.pts) {
              const d = Math.hypot(sx - hx, sy - hy);
              if (d < dmin) dmin = d;
            }
            if (dmin < 1.0) inBand++;
          }
          overlap = inBand / skSamples.length;
        }
        let match_status: ExportEdge['match_status'] = 'unmatched';
        if (interior && bestChamfer != null) {
          const angOk = angleDelta == null || angleDelta < 20;
          if (bestChamfer < 0.7 && angOk && (overlap ?? 0) > 0.5) match_status = 'matched';
          else if (bestChamfer < 1.5 && (overlap ?? 0) > 0.2) match_status = 'partial_match';
        }

        exportEdges.push({
          edge_id: `e${ei}`,
          is_interior: interior,
          type: 'unknown',
          segments_px: [pa, pb],
          segments_latlng: [{ lat: latA, lng: lngA }, { lat: latB, lng: lngB }],
          length_px: lenPx,
          length_m_from_geometry: lenGeom,
          length_m_from_px_scale: lenMpx,
          length_ft: lenGeom * 3.28084,
          orientation_deg: orient,
          distance_to_boundary_m: null,
          confidence: interior ? 0.8 : 0.4,
          nearest_human_annotation_id: nearestId,
          chamfer_to_nearest_human_m: bestChamfer,
          angle_delta_deg: angleDelta,
          overlap_ratio: overlap,
          match_status,
        });
      }

      // ── Quality score (0-100) ──
      const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
      let qScore: number | null = null;
      if (interiorEdges.length > 0) {
        const sScale = scaleConsistent ? 1 : 0.3;
        const sProj = projectionConsistent ? 1 : 0.3;
        const sCham = chamfer == null ? 0.5 : clamp(1 - chamfer / 2.0);
        const sRatio = lengthRatio == null ? 0.5 : clamp(1 - Math.abs(Math.log(Math.max(1e-3, lengthRatio))) / Math.log(3));
        const matched = exportEdges.filter((e) => e.is_interior && e.match_status === 'matched').length;
        const partial = exportEdges.filter((e) => e.is_interior && e.match_status === 'partial_match').length;
        const interiorN = Math.max(1, exportEdges.filter((e) => e.is_interior).length);
        const sMatch = clamp((matched + 0.5 * partial) / interiorN);
        const avgOverlap = (() => {
          const arr = exportEdges.filter((e) => e.is_interior && e.overlap_ratio != null).map((e) => e.overlap_ratio as number);
          return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0.5;
        })();
        qScore = Math.round(100 * (
          0.20 * sScale + 0.20 * sProj + 0.20 * sCham +
          0.15 * sRatio + 0.15 * sMatch + 0.10 * avgOverlap
        ));
      }

      if (!cancel) {
        setImgUrl(url);
        setPxBuilding(pxB);
        setPxHumanLines(pxH);
        setPxEdges(pxEdgesAll);
        setQualityScore(qScore);

        // ─── PIPELINE GEOMETRY-FIRST (validation + features + simplification + classifier + matching) ───
        try {
          const validation = validateBuildingPolygon(ringM as any);
          const rawEdgesPipe: RawEdge[] = edges.map((e, idx) => {
            const va = verts[e.a], vb = verts[e.b];
            return va && vb ? {
              id: `e${idx}`,
              a: [va[0], va[1]] as [number, number],
              b: [vb[0], vb[1]] as [number, number],
              interior: isInterior(e.a) && isInterior(e.b),
              ia: e.a, ib: e.b,
            } : null;
          }).filter(Boolean) as RawEdge[];
          const enriched = buildEdgeFeatures(rawEdgesPipe, validation);
          classifySkeletonEdges(enriched, validation);
          const humans: HumanAnnotation[] = humanSamplesByAnn.map((h) => ({
            id: h.id,
            type: 'ridge', // dans ce modal on n'a que des faîtières humaines
            samples_m: h.pts as any,
            orientation_deg: h.orient,
            length_m: 0,
          }));
          const matching = matchSkeletonToHumanAnnotations(enriched, humans);
          const simp = simplifySkeletonGraph(enriched, validation);
          const summary = summarizePipeline(validation, rawEdgesPipe, enriched, simp, matching);

          // Index match status par group_id pour colorer les simplifiées
          const matchByGroup = new Map<number, { matched: boolean; partial: boolean }>();
          for (const e of enriched) {
            const cur = matchByGroup.get(e.collinearity_group_id) || { matched: false, partial: false };
            if (e.match_status === 'matched') cur.matched = true;
            else if (e.match_status === 'partial_match') cur.partial = true;
            matchByGroup.set(e.collinearity_group_id, cur);
          }
          const typeByGroup = new Map<number, EnrichedEdge['predicted_type']>();
          for (const e of enriched) {
            const cur = typeByGroup.get(e.collinearity_group_id);
            // priorité ridge > valley > hip > unknown
            const rank = (t: EnrichedEdge['predicted_type']) => t === 'ridge' ? 3 : t === 'valley' ? 2 : t === 'hip' ? 1 : 0;
            if (!cur || rank(e.predicted_type) > rank(cur)) typeByGroup.set(e.collinearity_group_id, e.predicted_type);
          }
          const pxSimp: PxSimpEdge[] = canProject ? simp.simplified_edges.map((se: SimplifiedEdge) => {
            const [lngA, latA] = proj.fromM(se.a[0], se.a[1], lng0);
            const [lngB, latB] = proj.fromM(se.b[0], se.b[1], lng0);
            const pa = latLngToImagePx(latA, lngA, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale);
            const pb = latLngToImagePx(latB, lngB, imgParams.centerLat!, imgParams.centerLng!, imgParams.zoom, imgParams.imgSize, imgParams.scale);
            const m = matchByGroup.get(se.group_id) || { matched: false, partial: false };
            return {
              ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y,
              type: typeByGroup.get(se.group_id) || 'unknown',
              matched: m.matched, partial: m.partial,
            };
          }) : [];

          setPxSimpEdges(pxSimp);
          setPipelineSummary(summary);

          // Override verdict pour ne JAMAIS afficher bad_match / partial_match
          // si l'infrastructure est invalide (B1/B2/B3) ou si scale/proj invalides.
          if (!zoomConsistent || !extractionAnnotationsValid) {
            verdict = 'infrastructure_invalid';
          } else if (!scaleConsistent || !projectionConsistent) {
            verdict = 'scale_projection_issue';
          }
        } catch (err) {
          console.error('[SkeletonPipeline] failed', err);
        }

        setReport({
          skeleton_status: 'ok',
          skeleton_fail: interiorEdges.length === 0,
          geometry_test_executed: true,
          edges_count: edges.length,
          interior_edges_count: interiorEdges.length,
          skeleton_length_m: skelLenM,
          human_ridge_length_m: humanLenM,
          length_ratio: lengthRatio,
          chamfer_distance_m: chamfer,
          main_edge_match: mainEdgeMatch,
          visual_verdict: verdict,
          diag: {
            map_params: {
              centerLat: imgParams.centerLat, centerLng: imgParams.centerLng,
              zoom: imgParams.zoom, image_size_px: imgParams.imgSize, scale: imgParams.scale,
            },
            meters_per_pixel_at_lat_zoom: mpp,
            feet_per_pixel: feetPerPx,
            expected_image_width_m: expectedImgWidthM,
            building_bbox_width_px: bboxWpx, building_bbox_height_px: bboxHpx,
            building_bbox_width_m: bboxWm, building_bbox_height_m: bboxHm,
            polygon_area_m2: polyAreaM2, polygon_perimeter_m: polyPerimM,
            human_ridge_length_px: humanLenPx || null,
            human_ridge_length_m_from_latlng: humanLenM || null,
            human_ridge_length_m_from_px_scale: humanLenMFromPx,
            human_ridge_length_delta_m: humanLenDelta,
            skeleton_length_px: skelLenPx || null,
            skeleton_length_m_from_geometry: skelLenM,
            skeleton_length_m_from_px_scale: skelLenMFromPx,
            skeleton_length_delta_m: skelLenDelta,
            scale_consistent: scaleConsistent,
            projection_consistent: projectionConsistent,
            likely_error_source: likely,
            map_zoom_used: mapZoomUsed,
            debug_zoom_used: debugZoomUsed,
            zoom_consistent: zoomConsistent,
            raw_annotations_count: rawAnnotationsCount,
            deduped_annotations_count: dedupedAnnotationsCount,
            duplicates_removed_count: duplicatesRemovedCount,
            extraction_annotations_valid: extractionAnnotationsValid,
            ...polyDiag,
          },
        });
        // ── Summaries explicites (POLYGON / SKELETON / MATCH) ──
        const interiorExport = exportEdges.filter((e) => e.is_interior);
        let longestEdgeM = 0;
        let longestEdgeOrient: number | null = null;
        for (const e of interiorExport) {
          if (e.length_m_from_geometry > longestEdgeM) {
            longestEdgeM = e.length_m_from_geometry;
            longestEdgeOrient = e.orientation_deg;
          }
        }
        const angleDeltas = interiorExport.map((e) => e.angle_delta_deg).filter((x): x is number => x != null);
        const meanAngleDelta = angleDeltas.length ? angleDeltas.reduce((s, x) => s + x, 0) / angleDeltas.length : null;
        const overlaps = interiorExport.map((e) => e.overlap_ratio).filter((x): x is number => x != null);
        const meanOverlap = overlaps.length ? overlaps.reduce((s, x) => s + x, 0) / overlaps.length : null;
        const matchedCount = interiorExport.filter((e) => e.match_status === 'matched').length;
        const unmatchedCount = interiorExport.filter((e) => e.match_status === 'unmatched').length;
        const polygonSummary = {
          polygon_source_used: polygonSourceUsed,
          polygon_is_valid: polygonIsValid,
          polygon_vertices_count: polygonVerticesCount,
          polygon_area_m2: polyAreaM2,
          polygon_perimeter_m: polyPerimM,
          polygon_bbox_m: { width: bboxWm ?? null, height: bboxHm ?? null },
          geometry_invalid: false,
        };
        const skeletonSummary = {
          raw_edges_count: edges.length,
          interior_edges_count: interiorEdges.length,
          skeleton_total_length_m: skelLenM,
          longest_edge_m: longestEdgeM || null,
          longest_edge_orientation_deg: longestEdgeOrient,
        };
        const matchSummary = {
          chamfer_distance_m: chamfer,
          mean_angle_delta_deg: meanAngleDelta,
          overlap_ratio: meanOverlap,
          matched_edges_count: matchedCount,
          unmatched_edges_count: unmatchedCount,
        };
        setPayload({
          reference: takeoff.reference,
          takeoff_id: takeoff.id,
          generated_at: new Date().toISOString(),
          polygon_summary: polygonSummary,
          skeleton_summary: skeletonSummary,
          match_summary: matchSummary,
          map_params: {
            centerLat: imgParams.centerLat, centerLng: imgParams.centerLng,
            zoom: imgParams.zoom, image_size_px: imgParams.imgSize, scale: imgParams.scale,
          },
          projection_diagnostics: {
            meters_per_pixel_at_lat_zoom: mpp,
            feet_per_pixel: feetPerPx,
            expected_image_width_m: expectedImgWidthM,
            expected_image_height_m: expectedImgWidthM,
            projection_consistent: projectionConsistent,
            scale_consistent: scaleConsistent,
            likely_error_source: likely,
            map_zoom_used: mapZoomUsed,
            debug_zoom_used: debugZoomUsed,
            zoom_consistent: zoomConsistent,
            raw_annotations_count: rawAnnotationsCount,
            deduped_annotations_count: dedupedAnnotationsCount,
            duplicates_removed_count: duplicatesRemovedCount,
            extraction_annotations_valid: extractionAnnotationsValid,
          },
          building_polygon: {
            source: polygonSourceUsed,
            is_valid: polygonIsValid,
            vertices_count: polygonVerticesCount,
            area_m2: polyAreaM2,
            perimeter_m: polyPerimM,
            bbox_width_px: bboxWpx,
            bbox_height_px: bboxHpx,
            bbox_width_m: bboxWm,
            bbox_height_m: bboxHm,
            coords_latlng: ring as any,
            coords_px: pxB,
          },
          human_annotations: exportAnnotations,
          skeleton: {
            status: 'ok',
            geometry_test_executed: true,
            edges_count: edges.length,
            interior_edges_count: interiorEdges.length,
            skeleton_length_m_from_geometry: skelLenM,
            skeleton_length_m_from_px_scale: skelLenMFromPx,
            main_edge_match: mainEdgeMatch,
            visual_verdict: verdict,
            length_ratio: lengthRatio,
            chamfer_distance_m: chamfer,
            skeleton_quality_score: qScore,
          },
          skeleton_edges: exportEdges,
          debug_graph: debugGraphLocal as any,
        });
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeoff.id, runKey]);

  const verdictColor: Record<Verdict, string> = {
    good_match: 'hsl(140,65%,55%)',
    partial_match: 'hsl(48,90%,60%)',
    bad_match: 'hsl(0,75%,60%)',
    skeleton_fail: 'hsl(0,50%,40%)',
    runtime_error: 'hsl(280,70%,60%)',
    scale_projection_issue: 'hsl(28,95%,60%)',
    infrastructure_invalid: 'hsl(0,80%,55%)',
    geometry_invalid: 'hsl(0,80%,45%)',
  };

  const refLabel = takeoff.reference || takeoff.id.slice(0, 8);

  const handleExportJSON = () => {
    if (!payload) { toast.error('Aucun payload à exporter'); return; }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `skeleton_test_${refLabel}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPNG = async () => {
    if (!report) { toast.error('Rien à exporter'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    if (!ctx) { toast.error('Canvas indisponible'); return; }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1280, 1280);
    if (imgUrl) {
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.onload = () => resolve(im);
          im.onerror = reject;
          im.src = imgUrl;
        });
        ctx.drawImage(img, 0, 0, 1280, 1280);
      } catch { /* ignore CORS, draw without bg */ }
    }
    // ── Snapshot du SVG live : inclut TOUS les calques debug actifs
    // (building, vertices, indices, raw/interior edges, terminals, junctions,
    // directions, lengths, edge_ids, types, degrees, medial_axis, stage view,
    // opacity, simplifié, annotations humaines). Garantit la parité 1:1 avec
    // ce que l'utilisateur voit à l'écran.
    try {
      const svgEl = document.querySelector<SVGSVGElement>('[data-skeleton-overlay-svg="1"]');
      if (svgEl) {
        const clone = svgEl.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', '1280');
        clone.setAttribute('height', '1280');
        clone.setAttribute('viewBox', '0 0 1280 1280');
        const xml = new XMLSerializer().serializeToString(clone);
        const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        try {
          const svgImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = reject;
            im.src = svgUrl;
          });
          ctx.drawImage(svgImg, 0, 0, 1280, 1280);
        } finally {
          URL.revokeObjectURL(svgUrl);
        }
      }
    } catch (err) {
      console.warn('[skeleton] SVG snapshot failed, exporting bg only', err);
    }
    // overlay diagnostics
    const d = report.diag;
    const lines: string[] = [
      `ref: ${refLabel}`,
      `verdict: ${report.visual_verdict}`,
      `quality_score: ${qualityScore == null ? '—' : qualityScore}`,
      `chamfer_m: ${report.chamfer_distance_m == null ? '—' : report.chamfer_distance_m.toFixed(3)}`,
      `length_ratio: ${report.length_ratio == null ? '—' : report.length_ratio.toFixed(3)}`,
    ];
    if (d) {
      lines.push(`mpp: ${d.meters_per_pixel_at_lat_zoom?.toFixed(5) ?? '—'}`);
      lines.push(`scale_consistent: ${d.scale_consistent}`);
      lines.push(`projection_consistent: ${d.projection_consistent}`);
      lines.push(`likely_error: ${d.likely_error_source}`);
      lines.push(`stage_view: ${stageView}`);
      lines.push(`opacity: ${Math.round(debugOpacity * 100)}%`);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(16, 16, 520, 24 * lines.length + 16);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, 28, 40 + i * 24));
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png')!);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `skeleton_debug_${refLabel}.png`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!payload || !report) { toast.error('Rien à sauvegarder'); return; }
    setSaving(true);
    try {
      const hash = await hashPayload(payload);
      const { error } = await supabase.from('training_skeleton_tests' as any).upsert({
        takeoff_id: takeoff.id,
        skeleton_json: payload as any,
        quality_score: qualityScore,
        visual_verdict: report.visual_verdict,
        chamfer_distance_m: report.chamfer_distance_m,
        length_ratio: report.length_ratio,
        scale_consistent: report.diag?.scale_consistent ?? null,
        projection_consistent: report.diag?.projection_consistent ?? null,
        likely_error_source: report.diag?.likely_error_source ?? null,
        diagnostics: (report.diag ?? {}) as any,
        payload_hash: hash,
        auto_saved: false,
      } as any, { onConflict: 'takeoff_id,payload_hash' });
      if (error) throw error;
      setAutoSaved(true);
      toast.success('Test sauvegardé');
    } catch (e: any) {
      toast.error(`Sauvegarde impossible: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-save dès qu'un rapport est prêt (idempotent via payload_hash) ──
  useEffect(() => {
    if (!payload || !report) return;
    let cancelled = false;
    (async () => {
      try {
        const hash = await hashPayload(payload);
        if (autoSaveAttempted.current === hash) return;
        autoSaveAttempted.current = hash;
        const { error } = await supabase.from('training_skeleton_tests' as any).upsert({
          takeoff_id: takeoff.id,
          skeleton_json: payload as any,
          quality_score: qualityScore,
          visual_verdict: report.visual_verdict,
          chamfer_distance_m: report.chamfer_distance_m,
          length_ratio: report.length_ratio,
          scale_consistent: report.diag?.scale_consistent ?? null,
          projection_consistent: report.diag?.projection_consistent ?? null,
          likely_error_source: report.diag?.likely_error_source ?? null,
          diagnostics: (report.diag ?? {}) as any,
          payload_hash: hash,
          auto_saved: true,
        } as any, { onConflict: 'takeoff_id,payload_hash', ignoreDuplicates: false });
        if (cancelled) return;
        if (error) {
          console.warn('[SkeletonTest] auto-save failed', error);
        } else {
          setAutoSaved(true);
        }
      } catch (e) {
        console.warn('[SkeletonTest] auto-save exception', e);
      }
    })();
    return () => { cancelled = true; };
  }, [payload, report, qualityScore, takeoff.id]);

  const scoreColor = qualityScore == null
    ? '#9ca3af'
    : qualityScore >= 75 ? 'hsl(140,65%,55%)'
    : qualityScore >= 50 ? 'hsl(48,90%,60%)'
    : 'hsl(0,75%,60%)';

  return (
    <FullscreenModal onClose={onClose} title={`Test Skeleton — ${takeoff.reference || takeoff.id.slice(0, 8)}`}>
      <div
        className="skeleton-test-body"
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 380px',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* ── COLONNE GAUCHE : actions + toggles + viewport (image) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.08)' }}>
          {/* actions */}
          <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              style={{ ...btn, background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.45)' }}
              onClick={() => setRunKey((k) => k + 1)}
              disabled={loading}
              title="Relancer la pipeline skeleton sur ce takeoff"
            >
              {loading ? 'Run…' : 'Relancer'}
            </button>
            <button style={btn} onClick={handleExportJSON} disabled={!payload}>
              <Download size={12} /> Export JSON
            </button>
            <button
              style={{ ...btn, background: 'rgba(56,189,248,0.14)', border: '1px solid rgba(56,189,248,0.45)' }}
              onClick={() => {
                if (!debugGraph) { toast.error('Aucun debug graph disponible'); return; }
                const full = {
                  reference: takeoff.reference,
                  takeoff_id: takeoff.id,
                  generated_at: new Date().toISOString(),
                  polygon: payload?.building_polygon ?? null,
                  polygon_summary: payload?.polygon_summary ?? null,
                  projection_diagnostics: payload?.projection_diagnostics ?? null,
                  map_params: payload?.map_params ?? null,
                  debug_graph: debugGraph,
                  raw_polyskel: debugGraph.raw_polyskel,
                };
                const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `skeleton_debug_full_${refLabel}.json`; a.click();
                URL.revokeObjectURL(url);
              }}
              disabled={!debugGraph}
              title="Export debug graph complet (nodes, edges, adjacency, raw polyskel)"
            >
              <Download size={12} /> Debug Full
            </button>
            <button style={btn} onClick={handleExportPNG} disabled={!report}>
              <ImageIcon size={12} /> Export PNG
            </button>
            <button style={btn} onClick={handleSave} disabled={!payload || saving}>
              <Save size={12} /> {saving ? 'Save…' : autoSaved ? 'Sauvegardé ✓' : 'Sauvegarder'}
            </button>
            <button
              style={{
                ...btn,
                background: showDebugPanel ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(34,211,238,0.45)',
              }}
              onClick={() => setShowDebugPanel((v) => !v)}
              title="Panneau debug (couches d'inspection)"
            >
              Debug {showDebugPanel ? '▾' : '▸'}
            </button>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#9ca3af', fontSize: 11 }}>Quality</span>
              <span style={{
                background: scoreColor, color: '#0b0b14', fontWeight: 800, fontSize: 12,
                padding: '3px 10px', borderRadius: 999, minWidth: 36, textAlign: 'center',
              }}>{qualityScore == null ? '—' : qualityScore}</span>
            </div>
          </div>
          {/* Layer toggles */}
          <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', alignItems: 'center', flexWrap: 'wrap', fontSize: 10 }}>
            {([
              ['raw', 'gris', 'hsl(0,0%,75%)'],
              ['simplified', 'bleu', 'hsl(220,90%,65%)'],
              ['ridge', 'rouge', 'hsl(0,80%,55%)'],
              ['valley', 'cyan', 'hsl(190,85%,55%)'],
              ['hip', 'orange', 'hsl(28,90%,55%)'],
              ['human', 'humain', 'hsl(0,85%,60%)'],
            ] as const).map(([k, label, c]) => (
              <button key={k} onClick={() => setShowLayers(s => ({ ...s, [k]: !s[k as keyof typeof s] }))}
                style={{
                  background: showLayers[k as keyof typeof showLayers] ? c : 'rgba(255,255,255,0.05)',
                  color: showLayers[k as keyof typeof showLayers] ? '#0b0b14' : c,
                  border: `1px solid ${c}`, borderRadius: 999, padding: '2px 8px',
                  fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}>
                {label}
              </button>
            ))}
          </div>
          {/* Debug panel — couches d'inspection algorithmique pure */}
          {showDebugPanel && (
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid rgba(34,211,238,0.25)',
              background: 'rgba(34,211,238,0.06)', display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: '#67e8f9', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, letterSpacing: 0.5 }}>STAGE VIEW</span>
                {(['raw', 'filtered', 'classified', 'rendered'] as const).map((s) => (
                  <button key={s} onClick={() => setStageView(s)}
                    style={{
                      background: stageView === s ? '#22d3ee' : 'rgba(255,255,255,0.05)',
                      color: stageView === s ? '#0b0b14' : '#67e8f9',
                      border: '1px solid #22d3ee', borderRadius: 999, padding: '2px 8px',
                      fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    }}>{s}</button>
                ))}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>opacity {(debugOpacity * 100).toFixed(0)}%</span>
                  <input type="range" min={0.1} max={1} step={0.05} value={debugOpacity}
                    onChange={(e) => setDebugOpacity(parseFloat(e.target.value))}
                    style={{ width: 100 }} />
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([
                  ['building_polygon', 'building'],
                  ['polygon_vertices', 'verts'],
                  ['polygon_indices', 'vert idx'],
                  ['raw_skeleton_edges', 'raw edges'],
                  ['interior_edges_only', 'interior only'],
                  ['terminal_nodes', 'terminals'],
                  ['junction_nodes', 'junctions'],
                  ['edge_directions', 'directions'],
                  ['edge_lengths', 'lengths'],
                  ['edge_ids', 'edge ids'],
                  ['edge_types', 'types'],
                  ['node_degrees', 'degrees'],
                  ['medial_axis_debug', 'medial axis'],
                  ['architectural_candidates', 'arch candidates'],
                  ['collapse_artifacts', 'collapse artifacts'],
                  ['phase_clusters', 'phase clusters'],
                  ['edge_arch_scores', 'arch scores'],
                ] as const).map(([k, label]) => {
                  const on = debugLayers[k];
                  return (
                    <button key={k} onClick={() => setDebugLayers((d) => ({ ...d, [k]: !d[k] }))}
                      style={{
                        background: on ? '#22d3ee' : 'rgba(255,255,255,0.05)',
                        color: on ? '#0b0b14' : '#67e8f9',
                        border: '1px solid rgba(34,211,238,0.45)', borderRadius: 6,
                        padding: '2px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      }}>{label}</button>
                  );
                })}
              </div>
              {debugGraph && (
                <div style={{ fontSize: 10, color: '#94a3b8', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>nodes: <b style={{ color: '#e2e8f0' }}>{debugGraph.stats.total_nodes}</b></span>
                  <span>edges: <b style={{ color: '#e2e8f0' }}>{debugGraph.stats.total_edges}</b></span>
                  <span>interior: <b style={{ color: 'hsl(0,0%,90%)' }}>{debugGraph.stats.interior_edges}</b></span>
                  <span>terminal: <b style={{ color: 'hsl(28,90%,60%)' }}>{debugGraph.stats.terminal_edges}</b></span>
                  <span>external: <b style={{ color: 'hsl(0,80%,55%)' }}>{debugGraph.stats.external_edges}</b></span>
                  <span>degenerate: <b style={{ color: 'hsl(300,75%,60%)' }}>{debugGraph.stats.degenerate_edges}</b></span>
                  <span>terminals(n): <b style={{ color: 'hsl(28,90%,60%)' }}>{debugGraph.stats.terminal_nodes}</b></span>
                  <span>junctions(n): <b style={{ color: 'hsl(190,85%,60%)' }}>{debugGraph.stats.junction_nodes}</b></span>
                  <span>raw polyskel: <b style={{ color: '#e2e8f0' }}>{debugGraph.raw_polyskel.vertices_count} v / {debugGraph.raw_polyskel.polygons_count} p / {debugGraph.raw_polyskel.raw_edges_count} e</b></span>
                </div>
              )}
              {debugGraph?.architectural_summary && (
                <div style={{ fontSize: 10, color: '#94a3b8', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ color: 'hsl(190,85%,70%)', fontWeight: 800 }}>ARCH:</span>
                  <span>candidates: <b style={{ color: 'hsl(140,80%,60%)' }}>{debugGraph.architectural_summary.candidate_count}</b></span>
                  <span>artifacts: <b style={{ color: 'hsl(300,90%,65%)' }}>{debugGraph.architectural_summary.collapse_artifact_count}</b></span>
                  <span>mean score: <b style={{ color: '#e2e8f0' }}>{debugGraph.architectural_summary.mean_arch_score?.toFixed(2) ?? '—'}</b></span>
                  <span>clusters: <b style={{ color: 'hsl(300,80%,65%)' }}>{debugGraph.architectural_summary.cluster_count}</b></span>
                  <span>phase E/M/L: <b style={{ color: '#e2e8f0' }}>{debugGraph.architectural_summary.phase_distribution.EARLY}/{debugGraph.architectural_summary.phase_distribution.MID}/{debugGraph.architectural_summary.phase_distribution.LATE_COLLAPSE}</b></span>
                  <span>strongest: <b style={{ color: 'hsl(140,80%,60%)' }}>{debugGraph.architectural_summary.strongest_candidate?.edge_id ?? '—'} ({debugGraph.architectural_summary.strongest_candidate?.arch_score.toFixed(2) ?? '—'})</b></span>
                  <span>weakest: <b style={{ color: 'hsl(0,75%,60%)' }}>{debugGraph.architectural_summary.weakest_candidate?.edge_id ?? '—'} ({debugGraph.architectural_summary.weakest_candidate?.arch_score.toFixed(2) ?? '—'})</b></span>
                </div>
              )}
            </div>
          )}
          {/* viewport */}
          <div style={{ position: 'relative', background: '#000', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', gap: 8 }}>
                <Loader2 size={16} className="animate-spin" /> Calcul skeleton…
              </div>
            ) : (
              <ResponsiveViewport>
                {imgUrl && <img src={imgUrl} alt="raw" style={{ position: 'absolute', inset: 0, width: 1280, height: 1280, objectFit: 'cover' }} />}
                <svg width={1280} height={1280} viewBox="0 0 1280 1280" data-skeleton-overlay-svg="1" style={{ position: 'absolute', inset: 0 }}>
                  {/* bâtiment */}
                  {(debugLayers.building_polygon || !showDebugPanel) && pxBuilding.length > 1 && (
                    <polygon
                      points={pxBuilding.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={2}
                    />
                  )}
                  {/* ── DEBUG LAYERS (infra d'inspection — couleurs structurelles) ── */}
                  {showDebugPanel && debugGraph && (() => {
                    const stageFilter = (e: DebugEdge): boolean => {
                      if (stageView === 'raw') return true;
                      if (stageView === 'filtered') return e.is_interior;
                      if (stageView === 'classified') return e.is_interior;
                      return e.is_interior; // rendered
                    };
                    const colorOf = (e: DebugEdge) => {
                      if (e.color_class === 'degenerate') return 'hsl(300,80%,60%)'; // magenta
                      if (e.color_class === 'terminal') return 'hsl(28,95%,60%)'; // orange
                      if (e.color_class === 'external') return 'hsl(0,80%,55%)'; // rouge
                      return 'hsl(0,0%,92%)'; // interior blanc
                    };
                    const widthOf = (e: DebugEdge) => e.is_interior ? 4 : 2;
                    const visibleEdges = debugGraph.edges.filter((e) => {
                      if (!stageFilter(e)) return false;
                      if (debugLayers.interior_edges_only && !e.is_interior) return false;
                      if (!debugLayers.raw_skeleton_edges && !debugLayers.interior_edges_only) return false;
                      return true;
                    });
                    return (
                      <g opacity={debugOpacity}>
                        {/* raw skeleton edges colored by structural class */}
                        {visibleEdges.map((e) => (
                          <line key={`dbg-${e.edge_id}`}
                            x1={e.ax_px} y1={e.ay_px} x2={e.bx_px} y2={e.by_px}
                            stroke={colorOf(e)} strokeWidth={widthOf(e)} strokeLinecap="round"
                          />
                        ))}
                        {/* edge directions (arrowheads at midpoint) */}
                        {debugLayers.edge_directions && visibleEdges.map((e) => {
                          const mx = (e.ax_px + e.bx_px) / 2;
                          const my = (e.ay_px + e.by_px) / 2;
                          const ang = Math.atan2(e.by_px - e.ay_px, e.bx_px - e.ax_px);
                          const len = 14;
                          const x2 = mx + Math.cos(ang) * len;
                          const y2 = my + Math.sin(ang) * len;
                          const w = 5;
                          const lx = mx + Math.cos(ang + Math.PI * 0.85) * w;
                          const ly = my + Math.sin(ang + Math.PI * 0.85) * w;
                          const rx = mx + Math.cos(ang - Math.PI * 0.85) * w;
                          const ry = my + Math.sin(ang - Math.PI * 0.85) * w;
                          return (
                            <g key={`dir-${e.edge_id}`}>
                              <line x1={mx} y1={my} x2={x2} y2={y2} stroke="hsl(48,95%,60%)" strokeWidth={1.5} />
                              <polygon points={`${x2},${y2} ${lx},${ly} ${rx},${ry}`} fill="hsl(48,95%,60%)" />
                            </g>
                          );
                        })}
                        {/* edge metadata labels */}
                        {visibleEdges.map((e) => {
                          const mx = (e.ax_px + e.bx_px) / 2;
                          const my = (e.ay_px + e.by_px) / 2;
                          const labels: string[] = [];
                          if (debugLayers.edge_ids) labels.push(e.edge_id);
                          if (debugLayers.edge_lengths) labels.push(`${e.length_m.toFixed(2)}m`);
                          if (debugLayers.edge_types) labels.push(`${e.color_class}/${e.origin_stage}`);
                          if (!labels.length) return null;
                          return (
                            <g key={`lab-${e.edge_id}`}>
                              <rect x={mx + 6} y={my - 9 - (labels.length - 1) * 11} width={labels.reduce((m, l) => Math.max(m, l.length), 0) * 6.2 + 6} height={labels.length * 12 + 4} fill="rgba(0,0,0,0.7)" rx={3} />
                              {labels.map((l, i) => (
                                <text key={i} x={mx + 9} y={my + i * 12 - (labels.length - 1) * 11 + 1} fill="#fff" fontSize={10} fontFamily="monospace">{l}</text>
                              ))}
                            </g>
                          );
                        })}
                        {/* polygon vertices */}
                        {debugLayers.polygon_vertices && pxBuilding.map((p, i) => (
                          <circle key={`pv-${i}`} cx={p.x} cy={p.y} r={4} fill="hsl(48,95%,60%)" stroke="#000" strokeWidth={1} />
                        ))}
                        {/* polygon indices */}
                        {debugLayers.polygon_indices && pxBuilding.map((p, i) => (
                          <text key={`pi-${i}`} x={p.x + 6} y={p.y - 6} fill="hsl(48,95%,80%)" fontSize={10} fontFamily="monospace" stroke="#000" strokeWidth={2} paintOrder="stroke">{i}</text>
                        ))}
                        {/* nodes: terminals + junctions + degrees */}
                        {(debugLayers.terminal_nodes || debugLayers.junction_nodes || debugLayers.node_degrees) && debugGraph.nodes.map((n) => {
                          const showT = debugLayers.terminal_nodes && n.is_terminal;
                          const showJ = debugLayers.junction_nodes && n.is_junction;
                          const showD = debugLayers.node_degrees;
                          if (!showT && !showJ && !showD) return null;
                          const color = n.is_junction ? 'hsl(190,85%,60%)' : n.is_terminal ? 'hsl(28,95%,60%)' : 'hsl(0,0%,85%)';
                          return (
                            <g key={`n-${n.node_id}`}>
                              {(showT || showJ) && (
                                <circle cx={n.x_px} cy={n.y_px} r={n.is_junction ? 5 : 4}
                                  fill={color} stroke="#000" strokeWidth={1} />
                              )}
                              {showD && (
                                <text x={n.x_px + 7} y={n.y_px + 3} fill={color} fontSize={9} fontFamily="monospace"
                                  stroke="#000" strokeWidth={2} paintOrder="stroke">d{n.degree}</text>
                              )}
                            </g>
                          );
                        })}
                        {/* medial axis debug — fait juste briller les arêtes interior qui ont 2 junctions */}
                        {debugLayers.medial_axis_debug && debugGraph.edges.filter((e) => e.is_interior && e.node_degree_start >= 3 && e.node_degree_end >= 3).map((e) => (
                          <line key={`ma-${e.edge_id}`} x1={e.ax_px} y1={e.ay_px} x2={e.bx_px} y2={e.by_px}
                            stroke="hsl(180,100%,60%)" strokeWidth={6} strokeLinecap="round" opacity={0.6} />
                        ))}
                        {/* ── ARCHITECTURAL RANKING — overlay couleurs phase/candidat ── */}
                        {(debugLayers.architectural_candidates || debugLayers.collapse_artifacts || debugLayers.phase_clusters) &&
                          debugGraph.edges.filter((e) => e.is_interior && e.arch_score != null).map((e) => {
                            const showCand = debugLayers.architectural_candidates && e.is_architectural_candidate;
                            const showArt = debugLayers.collapse_artifacts && e.is_collapse_artifact;
                            const showPhase = debugLayers.phase_clusters;
                            if (!showCand && !showArt && !showPhase) return null;
                            let color = 'hsl(0,0%,60%)';
                            // priorité: artifact (magenta) > late_collapse (rouge foncé) > good (vert) > mid (bleu)
                            if (showArt && e.is_collapse_artifact) color = 'hsl(300,90%,60%)';
                            else if (showPhase && e.phase_class === 'LATE_COLLAPSE') color = 'hsl(0,75%,40%)';
                            else if (showCand && e.is_architectural_candidate && (e.arch_score ?? 0) >= 0.55) color = 'hsl(140,80%,50%)';
                            else if (showCand && e.is_architectural_candidate) color = 'hsl(210,90%,60%)';
                            else if (showPhase && e.phase_class === 'EARLY') color = 'hsl(140,40%,55%)';
                            else if (showPhase && e.phase_class === 'MID') color = 'hsl(210,50%,60%)';
                            else return null;
                            return (
                              <line key={`arch-${e.edge_id}`} x1={e.ax_px} y1={e.ay_px} x2={e.bx_px} y2={e.by_px}
                                stroke={color} strokeWidth={6} strokeLinecap="round" opacity={0.85} />
                            );
                          })}
                        {/* scores numériques sur edge */}
                        {debugLayers.edge_arch_scores && debugGraph.edges.filter((e) => e.is_interior && e.arch_score != null).map((e) => {
                          const mx = (e.ax_px + e.bx_px) / 2;
                          const my = (e.ay_px + e.by_px) / 2;
                          const s = (e.arch_score ?? 0).toFixed(2);
                          const ph = e.phase_class ?? '';
                          return (
                            <g key={`ascore-${e.edge_id}`}>
                              <rect x={mx - 22} y={my + 6} width={44} height={26} fill="rgba(0,0,0,0.78)" rx={3} stroke="rgba(255,255,255,0.2)" />
                              <text x={mx} y={my + 18} fill="#fff" fontSize={10} fontFamily="monospace" textAnchor="middle">{s}</text>
                              <text x={mx} y={my + 29} fill="hsl(190,80%,70%)" fontSize={8} fontFamily="monospace" textAnchor="middle">{ph}</text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })()}
                  {/* skeleton — toutes les arêtes en gris pointillé, arêtes intérieures plus marquées */}
                  {!showDebugPanel && showLayers.raw && pxEdges.map((e, i) => (
                    <line key={`s${i}`} x1={e.ax} y1={e.ay} x2={e.bx} y2={e.by}
                      stroke={e.interior ? 'hsl(0,0%,75%)' : 'hsl(0,0%,45%)'}
                      strokeWidth={e.interior ? 3 : 1.5}
                      strokeDasharray={e.interior ? '8 6' : '4 6'}
                      opacity={e.interior ? 0.95 : 0.55}
                    />
                  ))}
                  {/* simplifié — couleur par type / matching */}
                  {(!showDebugPanel || stageView === 'classified' || stageView === 'rendered') && pxSimpEdges.map((e, i) => {
                    const visibleByType =
                      (e.type === 'ridge' && showLayers.ridge) ||
                      (e.type === 'valley' && showLayers.valley) ||
                      (e.type === 'hip' && showLayers.hip) ||
                      (e.type === 'unknown' && showLayers.simplified);
                    if (!visibleByType) return null;
                    // matched > unmatched dominate, then type color
                    let color = 'hsl(220,90%,65%)'; // bleu = merged/unknown
                    if (e.type === 'ridge') color = 'hsl(0,80%,55%)';
                    else if (e.type === 'valley') color = 'hsl(190,85%,55%)';
                    else if (e.type === 'hip') color = 'hsl(28,90%,55%)';
                    if (e.matched) color = 'hsl(140,70%,50%)';
                    else if (!e.matched && !e.partial && (e.type === 'ridge' || e.type === 'valley')) color = 'hsl(320,80%,65%)';
                    return (
                      <line key={`m${i}`} x1={e.ax} y1={e.ay} x2={e.bx} y2={e.by}
                        stroke={color} strokeWidth={5} strokeLinecap="round" opacity={0.95}
                      />
                    );
                  })}
                  {/* annotations humaines (faîtière) */}
                  {showLayers.human && pxHumanLines.map((poly, i) => (
                    <polyline key={`h${i}`}
                      points={poly.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none" stroke="hsl(0,85%,60%)" strokeWidth={4} opacity={0.9}
                    />
                  ))}
                </svg>
              </ResponsiveViewport>
            )}
          </div>
        </div>

        {/* ── COLONNE DROITE : rapport ── */}
        <div style={{ padding: 14, overflowY: 'auto', color: '#e2e8f0', fontSize: 12, background: 'rgba(15,15,35,0.5)', minHeight: 0 }}>
            <div style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10, color: '#9ca3af', marginBottom: 10 }}>Rapport</div>
            {!report ? <div style={{ color: '#9ca3af' }}>—</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Row k="skeleton_status" v={report.skeleton_status} color={report.skeleton_status === 'ok' ? 'hsl(140,65%,55%)' : 'hsl(0,75%,60%)'} />
                <Row k="geometry_test_executed" v={String(report.geometry_test_executed)} color={report.geometry_test_executed ? 'hsl(140,65%,55%)' : 'hsl(280,70%,60%)'} />
                {report.error_type && <Row k="error_type" v={report.error_type} color="hsl(280,70%,60%)" bold />}
                <Row k="skeleton_fail" v={String(report.skeleton_fail)} color={report.skeleton_fail ? 'hsl(0,75%,60%)' : 'hsl(140,65%,55%)'} />
                <Row k="main_edge_match" v={String(report.main_edge_match)} color={report.main_edge_match ? 'hsl(140,65%,55%)' : 'hsl(48,90%,60%)'} />
                <Row k="visual_verdict" v={report.visual_verdict} color={verdictColor[report.visual_verdict]} bold />
                <Row k="quality_score" v={qualityScore == null ? '—' : `${qualityScore} / 100`} color={scoreColor} bold />
                {payload && (
                  <>
                    <hr style={{ border: 0, borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '6px 0' }} />
                    <div style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10, color: '#7dd3fc', margin: '2px 0 4px' }}>
                      POLYGON SUMMARY
                    </div>
                    <Row k="polygon_source_used" v={payload.polygon_summary.polygon_source_used}
                      color={payload.polygon_summary.polygon_source_used === 'none' ? 'hsl(0,80%,55%)' : 'hsl(140,65%,55%)'} bold />
                    <Row k="polygon_is_valid" v={String(payload.polygon_summary.polygon_is_valid)}
                      color={payload.polygon_summary.polygon_is_valid ? 'hsl(140,65%,55%)' : 'hsl(0,80%,55%)'} bold />
                    <Row k="polygon_vertices_count" v={String(payload.polygon_summary.polygon_vertices_count)} />
                    <Row k="polygon_area_m2" v={payload.polygon_summary.polygon_area_m2 == null ? '—' : payload.polygon_summary.polygon_area_m2.toFixed(2)} />
                    <Row k="polygon_perimeter_m" v={payload.polygon_summary.polygon_perimeter_m == null ? '—' : payload.polygon_summary.polygon_perimeter_m.toFixed(2)} />
                    <Row k="polygon_bbox_m.width" v={payload.polygon_summary.polygon_bbox_m.width == null ? '—' : payload.polygon_summary.polygon_bbox_m.width.toFixed(2)} />
                    <Row k="polygon_bbox_m.height" v={payload.polygon_summary.polygon_bbox_m.height == null ? '—' : payload.polygon_summary.polygon_bbox_m.height.toFixed(2)} />
                    <hr style={{ border: 0, borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '6px 0' }} />
                    <div style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10, color: '#86efac', margin: '2px 0 4px' }}>
                      SKELETON SUMMARY
                    </div>
                    <Row k="raw_edges_count" v={String(payload.skeleton_summary.raw_edges_count)} />
                    <Row k="interior_edges_count" v={String(payload.skeleton_summary.interior_edges_count)} />
                    <Row k="skeleton_total_length_m" v={payload.skeleton_summary.skeleton_total_length_m.toFixed(2)} />
                    <Row k="longest_edge_m" v={payload.skeleton_summary.longest_edge_m == null ? '—' : payload.skeleton_summary.longest_edge_m.toFixed(2)} />
                    <Row k="longest_edge_orientation_deg" v={payload.skeleton_summary.longest_edge_orientation_deg == null ? '—' : payload.skeleton_summary.longest_edge_orientation_deg.toFixed(1)} />
                    <hr style={{ border: 0, borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '6px 0' }} />
                    <div style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10, color: '#fcd34d', margin: '2px 0 4px' }}>
                      MATCH SUMMARY
                    </div>
                    <Row k="chamfer_distance_m" v={payload.match_summary.chamfer_distance_m == null ? '—' : payload.match_summary.chamfer_distance_m.toFixed(3)} />
                    <Row k="mean_angle_delta_deg" v={payload.match_summary.mean_angle_delta_deg == null ? '—' : payload.match_summary.mean_angle_delta_deg.toFixed(2)} />
                    <Row k="overlap_ratio" v={payload.match_summary.overlap_ratio == null ? '—' : payload.match_summary.overlap_ratio.toFixed(3)} />
                    <Row k="matched_edges_count" v={String(payload.match_summary.matched_edges_count)} color="hsl(140,70%,50%)" />
                    <Row k="unmatched_edges_count" v={String(payload.match_summary.unmatched_edges_count)} color="hsl(320,80%,65%)" />
                  </>
                )}
                <hr style={{ border: 0, borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '6px 0' }} />
                <Row k="edges_count" v={String(report.edges_count)} />
                <Row k="interior_edges_count" v={String(report.interior_edges_count)} />
                <Row k="skeleton_length_m" v={report.skeleton_length_m.toFixed(2)} />
                <Row k="human_ridge_length_m" v={report.human_ridge_length_m.toFixed(2)} />
                <Row k="length_ratio" v={report.length_ratio == null ? '—' : report.length_ratio.toFixed(3)} />
                <Row k="chamfer_distance_m" v={report.chamfer_distance_m == null ? '—' : report.chamfer_distance_m.toFixed(3)} />
                {report.diag && (
                  <>
                    <hr style={{ border: 0, borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '6px 0' }} />
                    <div style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10, color: '#f87171', margin: '2px 0 4px' }}>
                      Audit Infrastructure (B1/B2/B3)
                    </div>
                    <Row k="zoom_consistent" v={String(report.diag.zoom_consistent)}
                      color={report.diag.zoom_consistent ? 'hsl(140,65%,55%)' : 'hsl(0,80%,55%)'} bold />
                    <Row k="map_zoom_used" v={report.diag.map_zoom_used == null ? '—' : String(report.diag.map_zoom_used)} />
                    <Row k="debug_zoom_used" v={report.diag.debug_zoom_used == null ? '—' : String(report.diag.debug_zoom_used)} />
                    <Row k="extraction_annotations_valid" v={String(report.diag.extraction_annotations_valid)}
                      color={report.diag.extraction_annotations_valid ? 'hsl(140,65%,55%)' : 'hsl(0,80%,55%)'} bold />
                    <Row k="raw_annotations_count" v={String(report.diag.raw_annotations_count)} />
                    <Row k="deduped_annotations_count" v={String(report.diag.deduped_annotations_count)} />
                    <Row k="duplicates_removed_count" v={String(report.diag.duplicates_removed_count)}
                      color={report.diag.duplicates_removed_count > 0 ? 'hsl(28,95%,60%)' : '#e2e8f0'} />
                    <div style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10, color: '#fbbf24', margin: '2px 0 4px' }}>
                      Diagnostic Scale / Projection
                    </div>
                    <Row k="scale_consistent" v={String(report.diag.scale_consistent)}
                      color={report.diag.scale_consistent ? 'hsl(140,65%,55%)' : 'hsl(28,95%,60%)'} bold />
                    <Row k="projection_consistent" v={String(report.diag.projection_consistent)}
                      color={report.diag.projection_consistent ? 'hsl(140,65%,55%)' : 'hsl(28,95%,60%)'} bold />
                    <Row k="likely_error_source" v={report.diag.likely_error_source}
                      color={report.diag.likely_error_source === 'none' ? 'hsl(140,65%,55%)' : 'hsl(28,95%,60%)'} bold />
                    <div style={{ marginTop: 6, color: '#9ca3af', fontSize: 10 }}>map_params</div>
                    <Row k="centerLat" v={report.diag.map_params.centerLat == null ? '—' : report.diag.map_params.centerLat.toFixed(6)} />
                    <Row k="centerLng" v={report.diag.map_params.centerLng == null ? '—' : report.diag.map_params.centerLng.toFixed(6)} />
                    <Row k="zoom" v={String(report.diag.map_params.zoom)} />
                    <Row k="image_size_px" v={String(report.diag.map_params.image_size_px)} />
                    <Row k="scale" v={String(report.diag.map_params.scale)} />
                    <div style={{ marginTop: 6, color: '#9ca3af', fontSize: 10 }}>échelle théorique</div>
                    <Row k="meters_per_pixel" v={report.diag.meters_per_pixel_at_lat_zoom == null ? '—' : report.diag.meters_per_pixel_at_lat_zoom.toFixed(5)} />
                    <Row k="feet_per_pixel" v={report.diag.feet_per_pixel == null ? '—' : report.diag.feet_per_pixel.toFixed(5)} />
                    <Row k="expected_image_width_m" v={report.diag.expected_image_width_m == null ? '—' : report.diag.expected_image_width_m.toFixed(2)} />
                    <div style={{ marginTop: 6, color: '#9ca3af', fontSize: 10 }}>polygon</div>
                    <Row k="bbox_width_px" v={report.diag.building_bbox_width_px == null ? '—' : report.diag.building_bbox_width_px.toFixed(1)} />
                    <Row k="bbox_height_px" v={report.diag.building_bbox_height_px == null ? '—' : report.diag.building_bbox_height_px.toFixed(1)} />
                    <Row k="bbox_width_m" v={report.diag.building_bbox_width_m == null ? '—' : report.diag.building_bbox_width_m.toFixed(2)} />
                    <Row k="bbox_height_m" v={report.diag.building_bbox_height_m == null ? '—' : report.diag.building_bbox_height_m.toFixed(2)} />
                    <Row k="polygon_area_m2" v={report.diag.polygon_area_m2 == null ? '—' : report.diag.polygon_area_m2.toFixed(2)} />
                    <Row k="polygon_perimeter_m" v={report.diag.polygon_perimeter_m == null ? '—' : report.diag.polygon_perimeter_m.toFixed(2)} />
                    <div style={{ marginTop: 6, color: '#9ca3af', fontSize: 10 }}>annotations humaines</div>
                    <Row k="human_ridge_length_px" v={report.diag.human_ridge_length_px == null ? '—' : report.diag.human_ridge_length_px.toFixed(1)} />
                    <Row k="human_m_from_latlng" v={report.diag.human_ridge_length_m_from_latlng == null ? '—' : report.diag.human_ridge_length_m_from_latlng.toFixed(2)} />
                    <Row k="human_m_from_px_scale" v={report.diag.human_ridge_length_m_from_px_scale == null ? '—' : report.diag.human_ridge_length_m_from_px_scale.toFixed(2)} />
                    <Row k="human_delta_m" v={report.diag.human_ridge_length_delta_m == null ? '—' : report.diag.human_ridge_length_delta_m.toFixed(3)} />
                    <div style={{ marginTop: 6, color: '#9ca3af', fontSize: 10 }}>skeleton</div>
                    <Row k="skeleton_length_px" v={report.diag.skeleton_length_px == null ? '—' : report.diag.skeleton_length_px.toFixed(1)} />
                    <Row k="skel_m_from_geometry" v={report.diag.skeleton_length_m_from_geometry == null ? '—' : report.diag.skeleton_length_m_from_geometry.toFixed(2)} />
                    <Row k="skel_m_from_px_scale" v={report.diag.skeleton_length_m_from_px_scale == null ? '—' : report.diag.skeleton_length_m_from_px_scale.toFixed(2)} />
                    <Row k="skel_delta_m" v={report.diag.skeleton_length_delta_m == null ? '—' : report.diag.skeleton_length_delta_m.toFixed(3)} />
                  </>
                )}
                {report.error && (
                  <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', borderRadius: 6, color: '#fca5a5', fontSize: 11 }}>
                    {report.error}
                  </div>
                )}
                {pipelineSummary && (
                  <>
                    <hr style={{ border: 0, borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '6px 0' }} />
                    <div style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 10, color: '#a78bfa', margin: '2px 0 4px' }}>
                      Pipeline géométrique
                    </div>
                    <Row k="geometry_valid" v={String(pipelineSummary.geometry_valid)}
                      color={pipelineSummary.geometry_valid ? 'hsl(140,65%,55%)' : 'hsl(0,75%,60%)'} bold />
                    {pipelineSummary.geometry_reasons.length > 0 && (
                      <Row k="geometry_reasons" v={pipelineSummary.geometry_reasons.join(', ')} color="hsl(0,75%,60%)" />
                    )}
                    <Row k="raw_edges_count" v={String(pipelineSummary.raw_edges_count)} />
                    <Row k="interior_edges_count" v={String(pipelineSummary.interior_edges_count)} />
                    <Row k="merged_groups_count" v={String(pipelineSummary.merged_groups_count)} />
                    <Row k="simplified_edges_count" v={String(pipelineSummary.simplified_edges_count)} />
                    <Row k="pruned_count" v={String(pipelineSummary.pruned_count)} />
                    <Row k="simplification_ratio" v={pipelineSummary.simplification_ratio.toFixed(2)} />
                    <Row k="ridge_candidates_count" v={String(pipelineSummary.ridge_candidates_count)} color="hsl(0,80%,55%)" />
                    <Row k="valley_candidates_count" v={String(pipelineSummary.valley_candidates_count)} color="hsl(190,85%,55%)" />
                    <Row k="hip_candidates_count" v={String(pipelineSummary.hip_candidates_count)} color="hsl(28,90%,55%)" />
                    <Row k="matched_edges_count" v={String(pipelineSummary.matched_edges_count)} color="hsl(140,70%,50%)" />
                    <Row k="partial_edges_count" v={String(pipelineSummary.partial_edges_count)} color="hsl(48,90%,60%)" />
                    <Row k="unmatched_edges_count" v={String(pipelineSummary.unmatched_edges_count)} color="hsl(320,80%,65%)" />
                    <Row k="matching_valid" v={String(pipelineSummary.matching_valid)}
                      color={pipelineSummary.matching_valid ? 'hsl(140,65%,55%)' : 'hsl(28,95%,60%)'} bold />
                  </>
                )}
                <div style={{ marginTop: 10, color: '#6b7280', fontSize: 10, lineHeight: 1.5 }}>
                  Légende — <span style={{ color: 'hsl(0,0%,75%)' }}>gris</span> raw skeleton,
                  <span style={{ color: 'hsl(220,90%,65%)' }}> bleu</span> simplifié,
                  <span style={{ color: 'hsl(0,80%,55%)' }}> rouge</span> ridge,
                  <span style={{ color: 'hsl(190,85%,55%)' }}> cyan</span> valley,
                  <span style={{ color: 'hsl(28,90%,55%)' }}> orange</span> hip,
                  <span style={{ color: 'hsl(140,70%,50%)' }}> vert</span> matché,
                  <span style={{ color: 'hsl(320,80%,65%)' }}> rose</span> unmatched,
                  <span style={{ color: 'hsl(0,85%,60%)' }}> rouge fluo</span> faîtière humaine.
                </div>
              </div>
            )}
          </div>
      </div>
    </FullscreenModal>
  );
}

const btn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4,
};

function Row({ k, v, color, bold }: { k: string; v: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: 11 }}>{k}</span>
      <span style={{ color: color || '#e2e8f0', fontFamily: 'monospace', fontWeight: bold ? 700 : 500 }}>{v}</span>
    </div>
  );
}

function ResponsiveViewport({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const compute = () => {
      const parent = el.parentElement; if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const s = Math.min(w / 1280, h / 1280);
      setScale(Math.max(0.05, s));
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrapRef} style={{ width: 1280 * scale, height: 1280 * scale, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 1280, height: 1280, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Plein-écran centré, layout propre. Pas de drag, pas de snap.
 * Header simple (titre + close), body grid 2 colonnes (image | rapport).
 * Esc + clic backdrop pour fermer.
 */
function FullscreenModal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        paddingTop: 'max(16px, env(safe-area-inset-top, 16px))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
        paddingLeft: 'max(16px, env(safe-area-inset-left, 16px))',
        paddingRight: 'max(16px, env(safe-area-inset-right, 16px))',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: '100%', height: '100%', maxWidth: 1600, maxHeight: '100%',
          background: 'hsl(230,22%,10%)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 10,
          flex: '0 0 auto',
        }}>
          <FlaskConical size={16} color="hsl(280,70%,65%)" />
          <div style={{ flex: 1, color: '#fff', fontWeight: 700, fontSize: 13 }}>{title}</div>
          <button onClick={onClose} style={btn} aria-label="Fermer">
            <X size={14} />
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}