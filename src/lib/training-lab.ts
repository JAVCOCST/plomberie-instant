import { supabase } from '@/integrations/supabase/client';
import JSZip from 'jszip';
import { diffV16VsRoofModel, type RoofModelDiff } from './training-lab-diff';

export { diffV16VsRoofModel };
export type { RoofModelDiff };

/** Schema version of the export bundle (root manifest.json). Bumped any time
 *  the bundle layout or per-dataset payload changes shape so downstream
 *  trainers can refuse old/new bundles cleanly. */
export const TRAINING_LAB_BUNDLE_SCHEMA_VERSION = 'training_lab/1.0.0';

/** Deterministic train/val/test split keyed on the takeoff id.
 *  ~70/15/15. Stable across exports so a given takeoff always lands in the
 *  same split. Vague A §4.2 of the briefing. */
export function splitFor(t: { id: string }): 'train' | 'val' | 'test' {
  const h = hashStringToBucket(String(t?.id ?? ''));
  if (h < 70) return 'train';
  if (h < 85) return 'val';
  return 'test';
}

/** FNV-1a 32-bit hash modulo 100. Pure, no deps. */
function hashStringToBucket(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h % 100;
}

export type DatasetStatus =
  | 'draft'
  | 'needs_review'
  | 'calibration_issue'
  | 'corrected'
  | 'validated'
  | 'ready_for_training'
  | 'exported'
  | 'rejected';

export interface TrainingTakeoff {
  id: string;
  source_takeoff_id: string | null;
  reference: string | null;
  address: string | null;
  raw_image_url: string | null;
  annotated_image_url: string | null;
  debug_overlay_url: string | null;
  json_url: string | null;
  original_building_geojson: any;
  corrected_building_geojson: any;
  original_lot_geojson: any;
  corrected_lot_geojson: any;
  annotations_json: any;
  /** MVP roof_sections v1.6 pre-annotation input (optional). */
  roof_sections_v16: any;
  /** Human-corrected RoofModel annotation (truth) returned by AdminRoofStudio. */
  roof_model: any;
  /** Persisted RoofModelDiff (v1.6 vs roof_model). Written at save time by
   *  AdminTrainingLab; emitted into the bundle as `diff.json`. */
  roof_model_diff: RoofModelDiff | any;
  /** Per-device display tweaks (brightness/contrast pour l'image de fond du
   *  studio). Pur UI : n'affecte pas la truth roof_model. */
  display_settings: { brightness?: number; contrast?: number } | null;
  calibration_status: string | null;
  calibration_offset_px: any;
  calibration_offset_m: any;
  calibration_rotation_deg: number | null;
  calibration_scale: number | null;
  calibration_confidence: number | null;
  calibration_notes: string | null;
  dataset_status: DatasetStatus;
  quality_score: number | null;
  tags: string[];
  human_notes: string | null;
  export_batch_id: string | null;
  created_at: string;
  updated_at: string;
  // Phase 1 refonte (2026-06-05) — colonnes ajoutées par migration
  // 20260605_training_lab_batches_and_versions.sql. NULLable jusqu'à backfill
  // du batch 0 + intégration progressive dans le code.
  batch_id?: string | null;
  building_id?: string | null;
  lot_id?: string | null;
  source_type?: string | null;
  centroid_lat?: number | null;
  centroid_lng?: number | null;
  zoom?: number | null;
  building_polygon_px?: any;
  prediction_json?: any;          // output IA brut (PRE-régul)
  postprocessed_json?: any;       // output IA après régul (POST-géom v1.6)
  correction_time_sec?: number | null;
  model_version_used?: string | null;
  review_priority?: number | null;
  qc_status?: 'auto_validated' | 'needs_review' | 'rejected' | null;
}

// ── Phase 1 refonte — types pour batches et model_versions ─────────────────
export type BatchStatus =
  | 'draft'
  | 'generating'
  | 'preannotating'
  | 'ready_for_review'
  | 'training_ready'
  | 'training'
  | 'trained'
  | 'archived';

export interface TrainingBatch {
  id: string;
  batch_code: string;
  name: string;
  description: string | null;
  source_type: string;
  city: string | null;
  zone_geojson: any;
  limit_requested: number | null;
  created_at: string;
  created_by: string | null;
  status: BatchStatus;
  model_version_used: string | null;
  dataset_count: number;
  validated_count: number;
  auto_validated_count: number;
  rejected_count: number;
  avg_quality_score: number | null;
  avg_correction_weight: number | null;
  avg_correction_time_sec: number | null;
  notes: string | null;
}

export type ModelVersionStatus =
  | 'draft'
  | 'training'
  | 'trained'
  | 'deployed'
  | 'archived';

export interface ModelVersion {
  id: string;
  model_code: string;
  name: string;
  version: string;
  created_at: string;
  trained_from_batch_ids: string[] | null;
  dataset_count: number | null;
  train_count: number | null;
  val_count: number | null;
  test_count: number | null;
  training_config_json: any;
  metrics_json: any;
  onnx_url: string | null;
  weights_url: string | null;
  hf_space_url: string | null;
  status: ModelVersionStatus;
  is_active: boolean;
  notes: string | null;
}

export const STATUS_LABELS: Record<DatasetStatus, string> = {
  draft: 'Brouillon',
  needs_review: 'À réviser',
  calibration_issue: 'Problème calibration',
  corrected: 'Corrigé',
  validated: 'Validé',
  ready_for_training: 'Prêt pour entraînement',
  exported: 'Exporté',
  rejected: 'Rejeté',
};

export const STATUS_COLORS: Record<DatasetStatus, string> = {
  draft: 'hsl(230,10%,50%)',
  needs_review: 'hsl(38,90%,55%)',
  calibration_issue: 'hsl(0,75%,55%)',
  corrected: 'hsl(200,75%,55%)',
  validated: 'hsl(160,70%,48%)',
  ready_for_training: 'hsl(140,65%,50%)',
  exported: 'hsl(265,70%,65%)',
  rejected: 'hsl(0,30%,40%)',
};

const clone = <T,>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

// `buildRichAnnotations` removed: annotations_json (legacy per-section outline
// drawn before the tracer existed) is no longer the training target. The
// `roof_model` produced by AdminRoofStudio (2D + 3D tracer) is now the SOLE
// truth shipped in the export bundle (`roof_model.json`). `annotations_json`
// stays in the DB for traceability but is not exported and not validated.

// ─────────────────────────────────────────────────────────────────────────────
// Helpers pour batches & model_versions (Phase 1 refonte training-lab)
// ─────────────────────────────────────────────────────────────────────────────

/** Charge tous les batches (les plus récents en haut). Sans deps lourd. */
export async function loadBatches(): Promise<TrainingBatch[]> {
  const { data, error } = await (supabase as any)
    .from('training_batches')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`loadBatches : ${error.message}`);
  return (data || []) as TrainingBatch[];
}

/** Charge tous les modèles (les plus récents en haut). */
export async function loadModelVersions(): Promise<ModelVersion[]> {
  const { data, error } = await (supabase as any)
    .from('model_versions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`loadModelVersions : ${error.message}`);
  return (data || []) as ModelVersion[];
}

/** Retourne le modèle actif (is_active=true) ou null si aucun. */
export async function getActiveModelVersion(): Promise<ModelVersion | null> {
  const { data, error } = await (supabase as any)
    .from('model_versions')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();
  if (error) {
    console.warn('[training-lab] getActiveModelVersion failed:', error);
    return null;
  }
  return (data as ModelVersion | null) ?? null;
}

/** Marque un modèle comme actif. Le UNIQUE INDEX côté DB garantit qu'au plus
 *  un modèle est actif → on passe par un RPC ou on désactive les autres en
 *  amont via 2 UPDATE. Ici on fait la version 2-UPDATE pour pas avoir à
 *  créer un RPC. */
export async function setActiveModelVersion(modelCode: string): Promise<void> {
  const sb = supabase as any;
  // Désactive les autres D'ABORD pour éviter conflict avec uq_model_versions_is_active.
  const { error: e1 } = await sb
    .from('model_versions')
    .update({ is_active: false })
    .neq('model_code', modelCode);
  if (e1) throw new Error(`setActiveModelVersion (deactivate): ${e1.message}`);
  const { error: e2 } = await sb
    .from('model_versions')
    .update({ is_active: true })
    .eq('model_code', modelCode);
  if (e2) throw new Error(`setActiveModelVersion (activate): ${e2.message}`);
}

// ── Phase Bonus — Lancement training depuis le portail ────────────────────

export type TrainingRunStatus =
  | 'dispatched'
  | 'queued'
  | 'in_progress'
  | 'success'
  | 'failure'
  | 'cancelled';

export interface TrainingRun {
  id: string;
  batch_id: string | null;
  github_run_id: number | null;
  github_run_url: string | null;
  status: TrainingRunStatus;
  workflow_inputs: any;
  model_version_code: string | null;
  started_at: string;
  finished_at: string | null;
  last_polled_at: string | null;
}

/** Déclenche un workflow_dispatch GitHub Actions via l'edge function
 *  training-launch. Crée une row training_runs en BD pour suivi. */
export async function launchTrainingFromPortal(args: {
  batchId?: string;
  epochs?: number;
  imgsz?: number;
  model?: string;
}): Promise<{ training_run_id: string; github_run_url: string | null; message: string }> {
  const { data, error } = await (supabase as any).functions.invoke('training-launch', {
    body: {
      batch_id: args.batchId,
      epochs: args.epochs,
      imgsz: args.imgsz,
      model: args.model,
    },
  });
  if (error) {
    // L'erreur Supabase masque le body JSON de la réponse de l'edge function.
    // On va le chercher dans error.context.body (FunctionsHttpError) pour
    // afficher le vrai message (ex: "GITHUB_TOKEN secret manquant") au lieu
    // de "non-2xx status code".
    let serverMsg = error.message || 'erreur inconnue';
    try {
      const ctx: any = (error as any).context;
      if (ctx && typeof ctx === 'object') {
        if (ctx.body && typeof ctx.body === 'object' && ctx.body.error) {
          serverMsg = String(ctx.body.error);
        } else if (typeof ctx.json === 'function') {
          const j = await ctx.json();
          if (j && j.error) serverMsg = String(j.error);
        } else if (typeof ctx.text === 'function') {
          const t = await ctx.text();
          try {
            const j = JSON.parse(t);
            if (j && j.error) serverMsg = String(j.error);
          } catch { if (t) serverMsg = t.slice(0, 300); }
        }
      }
    } catch { /* fallback to error.message */ }
    throw new Error(serverMsg);
  }
  if (data && (data as any).error) throw new Error(String((data as any).error));
  return data;
}

/** Poll l'état d'un run via l'edge function training-status.
 *  À appeler en boucle (toutes les 30s) côté UI tant que status ∈ {dispatched,queued,in_progress}. */
export async function pollTrainingStatus(trainingRunId: string): Promise<{
  status: TrainingRunStatus;
  github_run_url: string | null;
  duration_sec: number | null;
  conclusion: string | null;
}> {
  const { data, error } = await (supabase as any).functions.invoke('training-status', {
    body: { training_run_id: trainingRunId },
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Charge tous les runs récents (les plus récents en haut). */
export async function loadTrainingRuns(limit = 20): Promise<TrainingRun[]> {
  const { data, error } = await (supabase as any)
    .from('training_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`loadTrainingRuns : ${error.message}`);
  return (data || []) as TrainingRun[];
}

/** Recompute les stats agrégées d'un batch depuis training_roof_takeoffs.
 *  À appeler après création / modification d'un takeoff du batch. */
export async function recomputeBatchStats(batchId: string): Promise<void> {
  const sb = supabase as any;
  const { data: rows } = await sb
    .from('training_roof_takeoffs')
    .select('dataset_status,qc_status,quality_score,roof_model_diff,correction_time_sec')
    .eq('batch_id', batchId);
  if (!rows || !Array.isArray(rows)) return;
  const total = rows.length;
  const validated = rows.filter((r: any) =>
    ['validated', 'ready_for_training', 'exported'].includes(r.dataset_status),
  ).length;
  const autoValidated = rows.filter((r: any) => r.qc_status === 'auto_validated').length;
  const rejected = rows.filter((r: any) =>
    r.dataset_status === 'rejected' || r.qc_status === 'rejected',
  ).length;
  const qScores = rows.map((r: any) => Number(r.quality_score)).filter((n: number) => !isNaN(n));
  const cw = rows
    .map((r: any) => Number(r.roof_model_diff?.correction_weight))
    .filter((n: number) => !isNaN(n));
  const times = rows.map((r: any) => Number(r.correction_time_sec)).filter((n: number) => !isNaN(n) && n > 0);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  await sb.from('training_batches').update({
    dataset_count: total,
    validated_count: validated,
    auto_validated_count: autoValidated,
    rejected_count: rejected,
    avg_quality_score: avg(qScores),
    avg_correction_weight: avg(cw),
    avg_correction_time_sec: avg(times),
  }).eq('id', batchId);
}

export const parseGeojsonValue = (v: any) => {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return clone(v);
};

function buildTrainingAnnotationsFromSoumissionBreakdown(db: any, seed: any) {
  if (!db || typeof db !== 'object') return null;
  const hasState = db.measure_tools || db.map_annotations || db.polygon_adj || db.lot_adj || db.map_params;
  if (!hasState) return null;
  const tools = Array.isArray(db.measure_tools)
    ? db.measure_tools.map((t: any) => ({
        id: String(t.id || `tool_${Math.random().toString(36).slice(2)}`),
        name: t.name || 'Outil',
        toolType: t.toolType || 'Ligne',
        unit: t.unit || 'pi',
        color: t.color || '#9ca3af',
        visible: t.visible !== false,
        manualValue: t.correctedValue || t.rawValue || '',
        rawValue: t.rawValue || '',
        correctedValue: t.correctedValue || '',
        linkedTo: t.linkedTo || '',
        markerShape: t.markerShape || 'circle',
        qbProductId: t.qbProductId || undefined,
        slopeType: t.slopeType || undefined,
        slopeFactor: t.slopeFactor ?? undefined,
        majoration: t.majoration ?? undefined,
      }))
    : null;
  const annotations = Array.isArray(db.map_annotations)
    ? db.map_annotations.map((a: any) => clone({
        target: a.target,
        feet: a.feet,
        visible: a.visible !== false,
        index: a.index,
        segments: a.segments || [],
        markerPositions: a.markerPositions || [],
      }))
    : [];
  return {
    tools: tools || undefined,
    annotations,
    polygon_adj: clone(db.polygon_adj),
    lot_adj: clone(db.lot_adj),
    map_params: clone(db.map_params),
    seed,
    meta: { imported_from_soumission_at: new Date().toISOString() },
  };
}

export type FilterPreset =
  | 'all'
  | 'valid'
  | 'to_fix'
  | 'calibration_issue'
  | 'footprint_suspect'
  | 'image_missing'
  | 'json_incomplete'
  | 'ready';

export function applyPresetFilter(rows: TrainingTakeoff[], preset: FilterPreset): TrainingTakeoff[] {
  switch (preset) {
    case 'valid':
      return rows.filter((r) => r.dataset_status === 'corrected' || r.dataset_status === 'validated' || r.dataset_status === 'ready_for_training');
    case 'to_fix':
      return rows.filter((r) => r.dataset_status === 'draft' || r.dataset_status === 'needs_review');
    case 'calibration_issue':
      return rows.filter((r) => r.dataset_status === 'calibration_issue' || r.calibration_status === 'issue');
    case 'footprint_suspect':
      return rows.filter((r) => (r.quality_score ?? 0) < 0.5);
    case 'image_missing':
      return rows.filter((r) => !r.raw_image_url || !r.annotated_image_url);
    case 'json_incomplete':
      return rows.filter((r) => !r.annotations_json || !r.original_building_geojson);
    case 'ready':
      // Inclut les deux statuts qui passent validateTakeoffForExport (le
      // gate est aligné dessus). Le filtre est utilisé pour le bulk export
      // — on veut "tout ce qui est exportable", pas juste 'ready_for_training'.
      return rows.filter(
        (r) => r.dataset_status === 'ready_for_training'
            || r.dataset_status === 'validated',
      );
    default:
      return rows;
  }
}

export interface BundleValidation {
  ok: boolean;
  errors: string[];
}

/** A RoofModel is "present" when it carries at least one section with a
 *  closed polygon (>= 3 pts). Looser checks would let an empty placeholder
 *  through and quietly train the model on no truth at all. */
function hasUsableRoofModel(t: TrainingTakeoff): boolean {
  const m = t.roof_model;
  if (!m || typeof m !== 'object') return false;
  const sections = Array.isArray(m.sections) ? m.sections : [];
  return sections.some((s: any) => Array.isArray(s?.pts) && s.pts.length >= 3);
}

export function validateTakeoffForExport(t: TrainingTakeoff): BundleValidation {
  // Validation simplifiée (Phase 2 de la refonte UX) : un dataset est
  // exportable dès qu'il a un roof_model human + le bon status. Les
  // anciennes contraintes (annotated_image_url, calibration_*) viennent du
  // flow soumission et n'ont pas de sens pour les datasets créés depuis le
  // Mode Explorer (Google Maps direct, pas de recalibrage requis).
  const errors: string[] = [];
  if (!t.raw_image_url) errors.push('Image brute manquante');
  if (!t.original_building_geojson && !t.corrected_building_geojson) errors.push('Polygon bâtiment manquant');
  if (!hasUsableRoofModel(t)) {
    errors.push('roof_model absent ou vide (vérité humaine corrigée requise pour l\'entraînement)');
  }
  if (t.dataset_status !== 'validated' && t.dataset_status !== 'ready_for_training') {
    errors.push(`dataset_status doit être "validated" ou "ready_for_training" (actuel: "${t.dataset_status}")`);
  }
  return { ok: errors.length === 0, errors };
}

export async function recoverTakeoffGeometryFromSoumission(t: TrainingTakeoff): Promise<Partial<TrainingTakeoff> | null> {
  if (!t.source_takeoff_id) return null;
  const { data: s, error } = await supabase
    .from('soumissions')
    .select('lat, lng, area_sqft, slope, coverage_type, product_name, color, dynasty_breakdown')
    .eq('id', t.source_takeoff_id)
    .maybeSingle();
  if (error || !s) return null;
  const db = (s as any).dynasty_breakdown || null;
  let bldg = parseGeojsonValue(db?.building_geojson);
  let lot = parseGeojsonValue(db?.lot_geojson);
  if ((!bldg || !lot) && typeof (s as any).lat === 'number' && typeof (s as any).lng === 'number') {
    try {
      const { data } = await supabase.rpc('find_building_polygon', {
        p_lat: (s as any).lat,
        p_lng: (s as any).lng,
        p_radius_meters: 100,
      } as any);
      const row: any = Array.isArray(data) ? data[0] : null;
      bldg = bldg || parseGeojsonValue(row?.geojson);
      lot = lot || parseGeojsonValue(row?.lot_geojson);
    } catch {/* ignore */}
  }
  const seed = {
    area_sqft: (s as any).area_sqft ?? null,
    slope: (s as any).slope ?? null,
    coverage_type: (s as any).coverage_type ?? null,
    product_name: (s as any).product_name ?? null,
    color: (s as any).color ?? null,
  };
  const fromDB = buildTrainingAnnotationsFromSoumissionBreakdown(db, seed);
  const currentAnnotations = Array.isArray((t.annotations_json as any)?.annotations) ? (t.annotations_json as any).annotations : [];
  const recoveredAnnotations = Array.isArray((fromDB as any)?.annotations) ? (fromDB as any).annotations : [];
  const patch: Partial<TrainingTakeoff> = {};
  if (bldg && !parseGeojsonValue(t.original_building_geojson)) patch.original_building_geojson = bldg;
  if (lot && !parseGeojsonValue(t.original_lot_geojson)) patch.original_lot_geojson = lot;
  if (fromDB && !currentAnnotations.length && recoveredAnnotations.length) patch.annotations_json = fromDB;
  return Object.keys(patch).length ? patch : null;
}

async function fetchAsBlob(url: string | null): Promise<Blob | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/* ── Mercator projection (Google Static Maps) ─────────────────────────────
 *  Identique à src/lib/training-lab-mvp-bridge.ts — copie locale pour éviter
 *  un import circulaire (training-lab-mvp-bridge utilise déjà du DOM via
 *  FileReader, et on doit garder training-lab.ts utilisable sans DOM).
 *  Si on touche l'une, mettre à jour l'autre.
 * ─────────────────────────────────────────────────────────────────────── */

const TILE_SIZE_PX = 256;
const IMAGE_SIZE_PX = 1280;     // 640 × scale=2 — défaut de buildSatelliteUrl
const IMAGE_SCALE = 2;

function latLngToImagePx(
  lat: number, lng: number,
  centerLat: number, centerLng: number,
  zoom: number,
  imgSize = IMAGE_SIZE_PX, scale = IMAGE_SCALE,
): [number, number] {
  const worldScale = TILE_SIZE_PX * Math.pow(2, zoom);
  const project = (la: number, ln: number) => {
    const x = ((ln + 180) / 360) * worldScale;
    const siny = Math.min(Math.max(Math.sin((la * Math.PI) / 180), -0.9999), 0.9999);
    const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * worldScale;
    return { x, y };
  };
  const p = project(lat, lng);
  const c = project(centerLat, centerLng);
  return [
    Math.round((p.x - c.x) * scale + imgSize / 2),
    Math.round((p.y - c.y) * scale + imgSize / 2),
  ];
}

type LngLat = [number, number];

/** Récupère le ring extérieur d'un Polygon/MultiPolygon/Feature (premier
 *  polygone, ring extérieur). Accepte aussi les strings JSON-encoded. */
function extractRing(geo: unknown): LngLat[] | null {
  if (geo == null) return null;
  if (typeof geo === 'string') {
    try { return extractRing(JSON.parse(geo)); } catch { return null; }
  }
  if (typeof geo !== 'object') return null;
  const g = geo as { type?: string; geometry?: unknown; coordinates?: unknown; features?: unknown };
  if (g.type === 'Feature') return extractRing(g.geometry);
  if (g.type === 'FeatureCollection') {
    const features = Array.isArray(g.features) ? g.features : [];
    for (const f of features) { const r = extractRing(f); if (r) return r; }
    return null;
  }
  if (g.type === 'Polygon') {
    const coords = g.coordinates as unknown[];
    return Array.isArray(coords) && Array.isArray(coords[0]) ? (coords[0] as LngLat[]) : null;
  }
  if (g.type === 'MultiPolygon') {
    const coords = g.coordinates as unknown[];
    const first = Array.isArray(coords) ? coords[0] : null;
    return Array.isArray(first) && Array.isArray((first as unknown[])[0])
      ? ((first as unknown[])[0] as LngLat[]) : null;
  }
  return null;
}

/** Projette le ring extérieur d'un GeoJSON en coords image-pixels en
 *  utilisant les map_params (centerLat/centerLng/zoom). Retourne null si
 *  les inputs sont manquants ou invalides. */
function projectGeojsonToImagePx(
  geo: unknown,
  mapParams: { centerLat?: number; centerLng?: number; zoom?: number } | null | undefined,
): Array<[number, number]> | null {
  const ring = extractRing(geo);
  if (!ring || ring.length < 3) return null;
  const cLat = mapParams?.centerLat;
  const cLng = mapParams?.centerLng;
  const zoom = mapParams?.zoom;
  if (typeof cLat !== 'number' || typeof cLng !== 'number' || typeof zoom !== 'number') return null;
  return ring.map(([lng, lat]) => latLngToImagePx(lat, lng, cLat, cLng, zoom));
}

/** Per-dataset manifest entry written to root `manifest.json`. */
export interface BundleManifestDataset {
  reference: string;
  id: string;
  split: 'train' | 'val' | 'test';
  quality_score: number | null;
  has_roof_model: boolean;
  has_diff: boolean;
  correction_weight: number | null;
  status: string;
  // Phase 1 refonte (2026-06-05) — lineage batch + modèle utilisé pour la
  // pré-annotation. Permet au trainer de filtrer / pondérer par batch ou
  // par version de modèle (ex: ignore batch 0 si on retraine sur batch 1+).
  batch_id: string | null;
  batch_code: string | null;
  model_version_used: string | null;
  qc_status: string | null;
  review_priority: number | null;
}

export async function buildBundleZip(takeoffs: TrainingTakeoff[], description?: string): Promise<Blob> {
  // Pré-charge batches + modèles pour enrichir le manifest sans N+1 queries
  const [batches, models] = await Promise.all([
    loadBatches().catch(() => [] as TrainingBatch[]),
    loadModelVersions().catch(() => [] as ModelVersion[]),
  ]);
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const modelByCode = new Map(models.map((m) => [m.model_code, m]));
  // batch_codes uniques présents dans cet export (pour le manifest racine)
  const exportBatchCodes = new Set<string>();
  const exportModelVersions = new Set<string>();
  const zip = new JSZip();
  const root = zip.folder('takeoffs')!;
  const references: string[] = [];
  const quality: Array<{ reference: string; quality_score: number | null; status: string }> = [];
  const datasets: BundleManifestDataset[] = [];
  const splitCounts: { train: number; val: number; test: number } = { train: 0, val: 0, test: 0 };
  // Track des fetch images qui ont échoué — exposé au user via manifest.json
  // ET via le retour de la fonction (à venir si on veut l'afficher en toast).
  const imageFetchFailures: Array<{ reference: string; kind: string; url: string }> = [];

  for (const t of takeoffs) {
    const ref = (t.reference || t.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    references.push(ref);
    quality.push({ reference: ref, quality_score: t.quality_score, status: t.dataset_status });
    const dir = root.folder(ref)!;

    // Fetch des images. On track les échecs (fetch null = URL stale ou
    // quota Google) pour que l'utilisateur sache quels datasets sont à
    // re-générer. Sinon silencieusement écrasé → bundle cassé invisible.
    const raw = await fetchAsBlob(t.raw_image_url);
    if (raw) dir.file('raw_image.jpg', raw);
    else if (t.raw_image_url) imageFetchFailures.push({ reference: ref, kind: 'raw_image', url: t.raw_image_url });
    const ann = await fetchAsBlob(t.annotated_image_url);
    if (ann) dir.file('annotated_image.jpg', ann);
    const dbg = await fetchAsBlob(t.debug_overlay_url);
    if (dbg) dir.file('debug_overlay.jpg', dbg);

    // takeoff.json carries ONLY the tracer-derived truth + footprint geometry
    // + file pointers. The legacy `annotations` / `tools_index` / `map_params`
    // / `raw_state` fields (from the old per-section `annotations_json`) are
    // intentionally dropped — only the 2D/3D tracer output trains the model.
    const hasRoofModel = !!(t.roof_model && Array.isArray(t.roof_model.sections) && t.roof_model.sections.length);
    const hasV16 = !!t.roof_sections_v16;
    const hasDiff = !!t.roof_model_diff;

    // Métadonnées image — explicites pour que l'ML script n'ait rien à deviner.
    // Google Static Maps avec size=640&scale=2 → image 1280×1280. Tous les
    // points roof_model.sections[].pts et roof_sections_v16.sections[].points
    // sont déjà en pixels image (origine top-left, Y vers le bas).
    const mp = (t.annotations_json && typeof t.annotations_json === 'object')
      ? (t.annotations_json as { map_params?: { centerLat?: number; centerLng?: number; zoom?: number } }).map_params
      : null;
    const imageMeta = {
      width: IMAGE_SIZE_PX,
      height: IMAGE_SIZE_PX,
      format: 'jpg',
      coordinate_system: 'image_pixels_top_left_y_down',
      image_filename: 'raw_image.jpg',
      source: 'google_static_maps_satellite',
      scale: IMAGE_SCALE,
      map_params: mp ? {
        center_lat: mp.centerLat ?? null,
        center_lng: mp.centerLng ?? null,
        zoom: mp.zoom ?? null,
      } : null,
    };

    // Projection du polygone bâtiment lat/lng → image-px pour donner au
    // script ML une bounding box / focal area sans qu'il refasse la math.
    // Préfère le corrigé si dispo, sinon l'original.
    const bldgPx = projectGeojsonToImagePx(
      t.corrected_building_geojson || t.original_building_geojson,
      mp || null,
    );

    // Normalisation des polygones roof_model au format consistent [[x,y], …]
    // (= même shape que roof_sections_v16.sections[].points). Évite au script
    // ML de gérer 2 formats : roof_model emet {x,y} objets et v16 emet [x,y]
    // arrays. On exporte les deux : le brut roof_model.json (pour qui veut
    // la version full) + cette normalisation directement dans takeoff.json
    // pour qu'un script Python simple ait UN SEUL format à consommer.
    const roofModelPolygonsPx: number[][][] | null = hasRoofModel
      ? (t.roof_model.sections || []).map((s: any) => (
          Array.isArray(s?.pts)
            ? s.pts.map((p: any) => [Number(p?.x ?? 0), Number(p?.y ?? 0)])
            : []
        )).filter((poly: number[][]) => poly.length >= 3)
      : null;

    dir.file('takeoff.json', JSON.stringify({
      reference: ref,
      address: t.address,
      image_meta: imageMeta,
      building_polygon_px: bldgPx,
      roof_model_polygons_px: roofModelPolygonsPx,
      original_building_geojson: t.original_building_geojson,
      corrected_building_geojson: t.corrected_building_geojson,
      original_lot_geojson: t.original_lot_geojson,
      corrected_lot_geojson: t.corrected_lot_geojson,
      tags: t.tags || [],
      human_notes: t.human_notes || null,
      // Per-dataset file pointers (Vague A §4.2).
      roof_model_file: hasRoofModel ? 'roof_model.json' : null,
      roof_sections_v16_file: hasV16 ? 'roof_sections_v16.json' : null,
      diff_file: hasDiff ? 'diff.json' : null,
    }, null, 2));

    // RoofModel truth (human-corrected) — the actual target of training.
    if (hasRoofModel) {
      dir.file('roof_model.json', JSON.stringify(t.roof_model, null, 2));
    }
    // v1.6 raw input — the pre-annotation the human started from.
    if (hasV16) {
      dir.file('roof_sections_v16.json', JSON.stringify(t.roof_sections_v16, null, 2));
    }
    // Pre-computed diff (signals for hard-negative mining + score auto).
    if (hasDiff) {
      dir.file('diff.json', JSON.stringify(t.roof_model_diff, null, 2));
    }

    dir.file('calibration_report.json', JSON.stringify({
      status: t.calibration_status,
      offset_px: t.calibration_offset_px,
      offset_m: t.calibration_offset_m,
      rotation_deg: t.calibration_rotation_deg,
      scale: t.calibration_scale,
      confidence: t.calibration_confidence,
      notes: t.calibration_notes,
    }, null, 2));

    dir.file('notes.md', `# ${ref}\n\n**Adresse:** ${t.address || '—'}\n**Statut:** ${t.dataset_status}\n**Score qualité:** ${t.quality_score ?? '—'}\n**Tags:** ${(t.tags || []).join(', ') || '—'}\n\n${t.human_notes || ''}\n`);

    const v = validateTakeoffForExport(t);
    dir.file('validation_report.json', JSON.stringify({
      reference: ref,
      ok: v.ok,
      errors: v.errors,
      checks: {
        raw_image: !!t.raw_image_url,
        annotated_image: !!t.annotated_image_url,
        debug_overlay: !!t.debug_overlay_url,
        building_geojson: !!(t.original_building_geojson || t.corrected_building_geojson),
        lot_geojson: !!(t.original_lot_geojson || t.corrected_lot_geojson),
        calibration_offset_m: !!t.calibration_offset_m,
        calibration_confidence: t.calibration_confidence != null,
        quality_score: t.quality_score != null,
        dataset_status_ready: t.dataset_status === 'ready_for_training',
        roof_model_present: hasRoofModel,
      },
    }, null, 2));

    const split = splitFor(t);
    splitCounts[split]++;
    const cw: number | null =
      t.roof_model_diff && typeof t.roof_model_diff.correction_weight === 'number'
        ? t.roof_model_diff.correction_weight
        : null;
    const batch = t.batch_id ? batchById.get(t.batch_id) : null;
    if (batch) exportBatchCodes.add(batch.batch_code);
    if (t.model_version_used) exportModelVersions.add(t.model_version_used);
    datasets.push({
      reference: ref,
      id: t.id,
      split,
      quality_score: t.quality_score,
      has_roof_model: hasRoofModel,
      has_diff: hasDiff,
      correction_weight: cw,
      status: t.dataset_status,
      batch_id: t.batch_id ?? null,
      batch_code: batch?.batch_code ?? null,
      model_version_used: t.model_version_used ?? null,
      qc_status: t.qc_status ?? null,
      review_priority: t.review_priority ?? null,
    });
  }

  // Root manifest (Vague A §4.2): the trainer's single source of truth about
  // the bundle layout, schema version, dataset split + correction weights.
  // Le champ image_fetch_failures déclare explicitement les datasets dont
  // l'image n'a pas pu être fetchée (URL stale, quota Google). Si non vide,
  // le script ML DOIT skipper ces datasets ou les retraiter.
  // Lineage summary : permet au trainer de savoir d'où viennent les datasets
  // (batches + versions de modèles utilisées pour les pré-annotations).
  // Utile pour : (a) reproductibilité, (b) éviter de retraîner un modèle avec
  // ses propres prédictions, (c) pondérer par fraîcheur du batch.
  const batchSummary = Array.from(exportBatchCodes).map((code) => {
    const b = batches.find((x) => x.batch_code === code);
    return b ? {
      batch_code: b.batch_code,
      name: b.name,
      source_type: b.source_type,
      model_version_used: b.model_version_used,
      dataset_count_in_batch_total: b.dataset_count,
    } : { batch_code: code };
  });
  const modelSummary = Array.from(exportModelVersions).map((code) => {
    const m = modelByCode.get(code);
    return m ? {
      model_code: m.model_code,
      version: m.version,
      name: m.name,
      status: m.status,
    } : { model_code: code };
  });

  zip.file('manifest.json', JSON.stringify({
    version: '1.0.0',
    schema_version: TRAINING_LAB_BUNDLE_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    count: takeoffs.length,
    datasets,
    splits: splitCounts,
    image_fetch_failures: imageFetchFailures.map((f) => ({ reference: f.reference, kind: f.kind })),
    description: description || 'Training bundle Toiture VB',
    // Phase 1 refonte : lineage explicite des batches + modèles
    batches: batchSummary,
    model_versions: modelSummary,
  }, null, 2));

  // Backwards-compatible legacy metadata.json kept alongside `manifest.json`
  // so older consumers (if any) still parse. Additive, not load-bearing.
  zip.file('metadata.json', JSON.stringify({
    exported_at: new Date().toISOString(),
    schema_version: '1.0.0',
    count: takeoffs.length,
    references,
    quality_summary: quality,
    description: description || 'Training bundle Toiture VB',
  }, null, 2));

  // README.md à la racine — documentation complète du bundle pour qu'un
  // script ML (Python) ou un nouveau dev puisse consommer ça sans
  // archéologie.
  zip.file('README.md', buildBundleReadme(takeoffs.length, splitCounts));

  return zip.generateAsync({ type: 'blob' });
}

/** Documentation auto-générée à la racine de chaque bundle ZIP. */
function buildBundleReadme(count: number, splits: { train: number; val: number; test: number }): string {
  return `# Training bundle — Toitures VB roof_sections v1.6

Snapshot exporté le ${new Date().toISOString()}.

- **${count} datasets** au total
- Splits : ${splits.train} train · ${splits.val} val · ${splits.test} test (70/15/15 ± hash deterministic)
- Schema version : ${TRAINING_LAB_BUNDLE_SCHEMA_VERSION}

## Structure

\`\`\`
takeoffs.zip
├── README.md                       ← ce fichier
├── manifest.json                   ← liste des datasets + splits + correction_weights
├── metadata.json                   ← back-compat legacy (ignorer si tu es nouveau)
└── takeoffs/
    └── <reference>/                ← un dossier par dataset
        ├── raw_image.jpg           ← image satellite 1280×1280 (Google Static Maps satellite)
        ├── annotated_image.jpg     ← optionnel (présent pour les datasets venus de soumissions)
        ├── debug_overlay.jpg       ← image satellite hybrid (avec labels) — optionnel
        ├── takeoff.json            ← metadata du dataset (voir ci-dessous)
        ├── roof_model.json         ← VÉRITÉ HUMAINE — TARGET D'ENTRAÎNEMENT
        ├── roof_sections_v16.json  ← prédiction IA brute (input baseline)
        ├── diff.json               ← signal de correction (hard-negative mining)
        ├── calibration_report.json ← métadonnées calibration (mostly null pour Map Mode)
        ├── notes.md                ← notes humaines libres
        └── validation_report.json  ← état des gates de validation
\`\`\`

## Système de coordonnées

**Toutes les coordonnées pixels** dans les JSON (\`roof_model.sections[].pts\`,
\`roof_sections_v16.sections[].points\`, \`building_polygon_px\`) sont en :

- **Origine** : top-left de l'image
- **X** : vers la droite (0 → width)
- **Y** : vers le bas (0 → height)
- **Image standard** : 1280 × 1280 pixels (vérifie \`image_meta.width/height\` dans \`takeoff.json\`)

C'est le système Google Static Maps standard (= cv2 / PIL standard).

## Loader Python minimal (RECOMMANDÉ — utilise takeoff.json comme source unique)

\`\`\`python
import json, os
from pathlib import Path
from PIL import Image

def load_dataset(folder: Path):
    with open(folder / 'takeoff.json') as f:
        meta = json.load(f)
    # IMPORTANT : utilise takeoff.json['roof_model_polygons_px'] comme source
    # canonique des polygones target. C'est une normalisation [[x,y], ...] des
    # polygones humains, alignée sur le même format que roof_sections_v16.
    target_polygons = meta['roof_model_polygons_px']  # list of list of [x, y]
    # Image satellite — taille connue via image_meta (typiquement 1280x1280)
    image = Image.open(folder / meta['image_meta']['image_filename'])
    # Optionnel : baseline IA brute (sections du pipeline v1.6 conservative)
    v16_path = folder / 'roof_sections_v16.json'
    baseline_polygons = None
    if v16_path.exists():
        v16 = json.load(open(v16_path))
        # Filtre uniquement les sections 'kept' (selection_status est la SEULE
        # vérité d'activation dans v1.6, cf. fromRoofSectionsV16.ts).
        baseline_polygons = [
            s['points'] for s in v16.get('sections', [])
            if s.get('selection_status') == 'kept'
        ]
    # Optionnel : pondération loss pour hard-negative mining
    diff_path = folder / 'diff.json'
    loss_weight = 0.0
    if diff_path.exists():
        diff = json.load(open(diff_path))
        loss_weight = float(diff.get('correction_weight', 0))  # 0 = facile, 1 = redraw total
    # Optionnel : focal area = bounding box du bâtiment en image-px (déjà projeté)
    building_px = meta.get('building_polygon_px')  # list of [x, y] ou None
    return image, target_polygons, baseline_polygons, loss_weight, building_px

# Itération sur le split train
with open('manifest.json') as f:
    manifest = json.load(f)
assert manifest['schema_version'] == 'training_lab/1.0.0', 'schema bump — verifier le code'
# Skip les datasets dont l'image n'a pas pu être fetchée (URL Google stale)
failed_refs = {f['reference'] for f in manifest.get('image_fetch_failures', [])}
train_refs = [d['reference'] for d in manifest['datasets']
              if d['split'] == 'train' and d['reference'] not in failed_refs]
for ref in train_refs:
    img, polys, base, w, bldg = load_dataset(Path('takeoffs') / ref)
    # ... ton training loop ici ...
\`\`\`

## ⚠️ Format des polygones — IMPORTANT

Trois sources de polygones cohabitent dans le bundle, avec **trois formats légèrement différents** :

| Source | Champ | Format | Recommandation |
|---|---|---|---|
| **takeoff.json** (NEW) | \`roof_model_polygons_px\` | \`[[x,y], …]\` | **À UTILISER comme target d'entraînement** |
| **takeoff.json** (NEW) | \`building_polygon_px\` | \`[[x,y], …]\` | focal area / bounding box |
| roof_model.json | \`sections[i].pts\` | \`[{x:number, y:number}, …]\` (objets) | brut — préférer la version normalisée ci-dessus |
| roof_sections_v16.json | \`sections[i].points\` | \`[[x,y], …]\` | OK pour baseline (filtrer selection_status='kept') |

**Tous en pixels image, origine top-left, Y vers le bas.** Image typique 1280×1280 (vérifie \`takeoff.json['image_meta']['width/height']\`).

## Champs roof_model.json à IGNORER pour le training 2D

Le fichier \`roof_model.json\` est un dump complet du tracer. Pour de l'entraînement 2D polygone, **seul \`sections\` compte**. Tu peux ignorer en safe :

- \`valleys\` : noues 3D calculées par le moteur (entre sections adjacentes)
- \`planes\` : équations des plans 3D \`a·x + b·y + c\`
- \`accessories\` : objets posés sur le toit (Maximum 301, etc.)
- \`georef\`, \`mvp_source_snapshot\`, \`calibration\`, \`review_state\` : métadonnées

→ La normalisation \`takeoff.json['roof_model_polygons_px']\` extrait DÉJÀ seulement \`sections.pts\` pour toi.

## Sémantique du \`correction_weight\` (hard-negative mining)

- \`0.0\` : l'humain n'a quasi rien corrigé — l'IA était déjà bonne sur ce cas. **Loss weight x1**.
- \`0.5\` : correction moyenne. **Loss weight x1.5 ou x2** typique.
- \`1.0\` : l'humain a tout redessiné — l'IA a complètement merdé. **Loss weight x3 ou plus**.

Cible : faire baisser le \`correction_weight\` moyen sur le split val/test à chaque
itération du pipeline.

## Schema des \`sections\` (roof_model / roof_sections_v16)

- \`roof_model.sections[i]\` :
  - \`pts\` : array de \`{x, y}\` (≥3 points fermés) en pixels image
  - \`pitch\` : pente en X/12 (7 = 7/12 ratio standard)
  - \`roof_type\` : "hip" | "gable" | "shed" | …
  - \`source\` : "human" | "mvp" | "merged"

- \`roof_sections_v16.sections[i]\` : voir le contrat \`sections-1.6.0\` dans
  \`src/lib/roof-core/adapters/fromRoofSectionsV16.ts\`. Champs clés :
  - \`points\` : array \`[x, y]\` (≥3 pts) en pixels image
  - \`selection_status\` : "kept" | "alternative" | "rejected" (**SEULE vérité d'activation**)
  - \`role\` : "main" | "ridge_candidate"
  - \`structural_score\`, \`ridge_visible_score\`, \`plane_symmetry_score\` : scores 0..1

## Splits déterministes

Le \`split\` (train/val/test) est calculé par hash FNV-1a 32-bit du \`dataset.id\` modulo 100 :
- 0-69 → train (70%)
- 70-84 → val (15%)
- 85-99 → test (15%)

→ **Un dataset reste TOUJOURS dans le même split à travers les exports.** Pas de leak entre re-exports.

## Versioning

- \`manifest.schema_version\` change à chaque modification breaking du layout.
- Si tu construis un loader, **assert sur le schema_version exact** pour éviter
  les surprises silencieuses.

---

Documentation auto-générée par buildBundleReadme dans src/lib/training-lab.ts.
`;
}

export async function importFromSoumissions(limit = 200): Promise<number> {
  const sb = supabase as any;
  const { data: soums, error } = await supabase
    .from('soumissions')
    .select('id, reference_id, formatted_address, lat, lng, area_sqft, slope, coverage_type, product_name, color, dynasty_breakdown')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!soums?.length) return 0;

  const { data: existing } = await sb
    .from('training_roof_takeoffs')
    .select('id, source_takeoff_id, raw_image_url, debug_overlay_url, original_building_geojson, original_lot_geojson, annotations_json');
  const existingMap = new Map<string, any>(
    (existing || []).filter((r: any) => r.source_takeoff_id).map((r: any) => [r.source_takeoff_id, r]),
  );

  const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';

  const buildSatelliteUrl = (lat: number, lng: number, zoom = 20) =>
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${Math.round(zoom)}&size=640x640&scale=2&maptype=satellite&key=${apiKey}`;
  // Vague A §4.2: ingest-time auto-fill of `debug_overlay_url` so the
  // validation gate doesn't reject the whole batch. The proper debug overlay
  // pipeline (MapboxDebugOverlay, labelled by skeleton) is gap §10 of the
  // audit and out of scope for Vague A — falling back to the hybrid view
  // (satellite + labels) here is a strict superset of "no overlay at all"
  // and stays additive: any later real overlay just replaces it.
  const buildDebugOverlayUrl = (lat: number, lng: number, zoom = 20) =>
    `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${Math.round(zoom)}&size=640x640&scale=2&maptype=hybrid&key=${apiKey}`;

  const enrichOne = async (s: any) => {
    const db = s.dynasty_breakdown || null;
    // Priorité absolue au take-off sauvegardé dans la soumission: c'est ce que
    // l'utilisateur voit déjà dans /admin/quote (incluant le bâtiment/lot choisi).
    let bldg: any = parseGeojsonValue(db?.building_geojson);
    let lot: any = parseGeojsonValue(db?.lot_geojson);
    // Toujours tenter le RPC pour combler les trous (le breakdown peut être null).
    if ((!bldg || !lot) && typeof s.lat === 'number' && typeof s.lng === 'number') {
      try {
        const { data, error: rpcErr } = await supabase.rpc('find_building_polygon', {
          p_lat: s.lat,
          p_lng: s.lng,
          p_radius_meters: 150,
        } as any);
        if (rpcErr) console.warn('[training-lab] RPC find_building_polygon error:', rpcErr, { id: s.id });
        const row: any = Array.isArray(data) && data.length ? data[0] : null;
        if (row) {
          bldg = bldg || parseGeojsonValue(row.geojson);
          lot = lot || parseGeojsonValue(row.lot_geojson);
        } else {
          console.warn('[training-lab] no building polygon found for', s.id, s.formatted_address, { lat: s.lat, lng: s.lng });
        }
      } catch (e) { console.warn('[training-lab] RPC threw:', e); }
    }
    const lat = typeof db?.map_params?.centerLat === 'number' ? db.map_params.centerLat : s.lat;
    const lng = typeof db?.map_params?.centerLng === 'number' ? db.map_params.centerLng : s.lng;
    const zoom = typeof db?.map_params?.zoom === 'number' ? db.map_params.zoom : 20;
    const raw_image_url = apiKey && typeof lat === 'number' && typeof lng === 'number'
      ? buildSatelliteUrl(lat, lng, zoom)
      : null;
    const debug_overlay_url = apiKey && typeof lat === 'number' && typeof lng === 'number'
      ? buildDebugOverlayUrl(lat, lng, zoom)
      : null;

    const seed = {
      area_sqft: s.area_sqft ?? null,
      slope: s.slope ?? null,
      coverage_type: s.coverage_type ?? null,
      product_name: s.product_name ?? null,
      color: s.color ?? null,
    };
    const fromDB = buildTrainingAnnotationsFromSoumissionBreakdown(db, seed);
    const annotations_json = fromDB || { tools: undefined, annotations: [], seed, meta: { imported_from_soumission_at: new Date().toISOString() } };

    // Corrected geometry — duplicated from soumission's adjustments if present.
    // We keep the original geometry from Batiment_poly and let the editor
    // re-apply polygon_adj/lot_adj on top (same logic as the quote view).
    return {
      source_takeoff_id: s.id,
      reference: s.reference_id || s.id.slice(0, 8),
      address: s.formatted_address,
      raw_image_url,
      debug_overlay_url,
      original_building_geojson: bldg,
      original_lot_geojson: lot,
      annotations_json,
      dataset_status: 'draft' as DatasetStatus,
    };
  };

  let touched = 0;

  // Run enrichment in parallel batches (RPC is the bottleneck).
  const runInBatches = async <T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += size) {
      const slice = items.slice(i, i + size);
      // eslint-disable-next-line no-await-in-loop
      const res = await Promise.all(slice.map(fn));
      out.push(...res);
    }
    return out;
  };

  // Insert missing
  const toInsert = soums.filter((s) => !existingMap.has(s.id));
  console.log('[training-lab] importFromSoumissions:', { soums: soums.length, existing: existingMap.size, toInsert: toInsert.length });
  if (toInsert.length) {
    const enriched = await runInBatches(toInsert, 8, enrichOne);
    // Insert in chunks to keep payload manageable
    for (let i = 0; i < enriched.length; i += 25) {
      const chunk = enriched.slice(i, i + 25);
      // eslint-disable-next-line no-await-in-loop
      const { error: insErr } = await sb.from('training_roof_takeoffs').insert(chunk);
      if (insErr) {
        console.error('[training-lab] insert error:', insErr, { chunkSize: chunk.length });
        throw insErr;
      }
      touched += chunk.length;
    }
  }

    // Backfill existing rows: refresh image, building geom AND missing annotations
    // from soumission's take-off state. We preserve training-side edits only when
    // actual annotations already exist in the lab row. A tools-only row is not an
    // edited take-off and must be hydrated from the source soumission.
  const toUpdate = soums.filter((s) => existingMap.has(s.id));
  const enrichedUpdates = await runInBatches(toUpdate, 8, async (s) => ({ s, e: await enrichOne(s) }));
  const isBadGeom = (g: any) => !g || typeof g === 'string';
  for (const { s, e: enriched } of enrichedUpdates) {
    const ex = existingMap.get(s.id);
    const patch: any = {};
    // Always refresh image URL (Google key may have rotated).
    if (enriched.raw_image_url) patch.raw_image_url = enriched.raw_image_url;
    // Backfill debug_overlay_url when missing so validateTakeoffForExport stops
    // rejecting rows on an unrelated gap (audit §10 — proper Mapbox overlay
    // generation is still to-do, this is a sane fallback).
    if (!ex.debug_overlay_url && enriched.debug_overlay_url) {
      patch.debug_overlay_url = enriched.debug_overlay_url;
    }
    // Always refresh building/lot if missing or stored as legacy string.
    if (enriched.original_building_geojson && isBadGeom(ex.original_building_geojson)) {
      patch.original_building_geojson = enriched.original_building_geojson;
    }
    if (enriched.original_lot_geojson && isBadGeom(ex.original_lot_geojson)) {
      patch.original_lot_geojson = enriched.original_lot_geojson;
    }
    patch.address = enriched.address;
    const trainingHasAnnotations = ex.annotations_json
      && typeof ex.annotations_json === 'object'
      && Array.isArray((ex.annotations_json as any).annotations)
      && (ex.annotations_json as any).annotations.length > 0;
    if (!trainingHasAnnotations) {
      patch.annotations_json = enriched.annotations_json;
    }
    if (Object.keys(patch).length) {
      // eslint-disable-next-line no-await-in-loop
      const { error: upErr } = await sb.from('training_roof_takeoffs').update(patch).eq('id', ex.id);
      if (upErr) { console.error('[training-lab] update error:', upErr, { id: ex.id }); continue; }
      touched++;
    }
  }

  console.log('[training-lab] import done, touched:', touched);
  return touched;
}