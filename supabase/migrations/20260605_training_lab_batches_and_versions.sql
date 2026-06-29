-- ────────────────────────────────────────────────────────────────────────────
-- Migration : Training Lab — Batches + Model Versions
-- Date : 2026-06-05
-- Auteur : refonte training-lab en machine d'amélioration continue
-- ────────────────────────────────────────────────────────────────────────────
-- Transforme le training lab d'un outil d'annotation 1-by-1 en machine
-- d'amélioration continue avec versions de modèles et logique de batches.
--
-- IMPORTANT — rétrocompatibilité préservée :
--   - roof_sections_v16, roof_model, roof_model_diff : colonnes INCHANGÉES
--     (le code existant continue de marcher)
--   - dataset_status : INCHANGÉ (state machine principal)
--   - Les nouvelles colonnes (batch_id, model_version_used, etc.) sont AJOUTÉES
--     et NULLable jusqu'au backfill batch 0
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Table training_batches ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_batches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code           text NOT NULL UNIQUE,
  name                 text NOT NULL,
  description          text,
  source_type          text NOT NULL,
  city                 text,
  zone_geojson         jsonb,
  limit_requested      integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES auth.users(id),
  status               text NOT NULL DEFAULT 'draft',
  model_version_used   text,
  dataset_count        integer NOT NULL DEFAULT 0,
  validated_count      integer NOT NULL DEFAULT 0,
  auto_validated_count integer NOT NULL DEFAULT 0,
  rejected_count       integer NOT NULL DEFAULT 0,
  avg_quality_score    numeric,
  avg_correction_weight numeric,
  avg_correction_time_sec numeric,
  notes                text
);

CREATE INDEX IF NOT EXISTS idx_training_batches_status ON public.training_batches(status);
CREATE INDEX IF NOT EXISTS idx_training_batches_created_at ON public.training_batches(created_at DESC);

ALTER TABLE public.training_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read training_batches"
  ON public.training_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write training_batches"
  ON public.training_batches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update training_batches"
  ON public.training_batches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── 2. Table model_versions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.model_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_code               text NOT NULL UNIQUE,
  name                     text NOT NULL,
  version                  text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  trained_from_batch_ids   uuid[] DEFAULT '{}',
  dataset_count            integer,
  train_count              integer,
  val_count                integer,
  test_count               integer,
  training_config_json     jsonb,
  metrics_json             jsonb,
  onnx_url                 text,
  weights_url              text,
  hf_space_url             text,
  status                   text NOT NULL DEFAULT 'draft',
  is_active                boolean NOT NULL DEFAULT false,
  notes                    text
);

-- Au plus UN modèle actif à la fois
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_versions_is_active
  ON public.model_versions(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_model_versions_status ON public.model_versions(status);
CREATE INDEX IF NOT EXISTS idx_model_versions_created_at ON public.model_versions(created_at DESC);

ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read model_versions"
  ON public.model_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert model_versions"
  ON public.model_versions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update model_versions"
  ON public.model_versions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── 3. Nouvelles colonnes sur training_roof_takeoffs ───────────────────────
ALTER TABLE public.training_roof_takeoffs
  ADD COLUMN IF NOT EXISTS batch_id              uuid REFERENCES public.training_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS building_id           text,
  ADD COLUMN IF NOT EXISTS lot_id                text,
  ADD COLUMN IF NOT EXISTS source_type           text,
  ADD COLUMN IF NOT EXISTS centroid_lat          double precision,
  ADD COLUMN IF NOT EXISTS centroid_lng          double precision,
  ADD COLUMN IF NOT EXISTS zoom                  integer,
  ADD COLUMN IF NOT EXISTS building_polygon_px   jsonb,
  ADD COLUMN IF NOT EXISTS prediction_json       jsonb,
  ADD COLUMN IF NOT EXISTS postprocessed_json    jsonb,
  ADD COLUMN IF NOT EXISTS correction_time_sec   numeric,
  ADD COLUMN IF NOT EXISTS model_version_used    text,
  ADD COLUMN IF NOT EXISTS review_priority       numeric,
  ADD COLUMN IF NOT EXISTS qc_status             text;

CREATE INDEX IF NOT EXISTS idx_takeoffs_batch_id           ON public.training_roof_takeoffs(batch_id);
CREATE INDEX IF NOT EXISTS idx_takeoffs_model_version      ON public.training_roof_takeoffs(model_version_used);
CREATE INDEX IF NOT EXISTS idx_takeoffs_review_priority    ON public.training_roof_takeoffs(review_priority DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_takeoffs_qc_status          ON public.training_roof_takeoffs(qc_status);

-- ── 4. SEED : batch_000_initial + algo_v1_6 (active) ───────────────────────
INSERT INTO public.training_batches (
  batch_code, name, description, source_type, status, model_version_used, notes
) VALUES (
  'batch_000_initial',
  'Batch 0 — Initial',
  'Premiers datasets corrigés manuellement avant la mise en place du système ' ||
  'de batchs. Sert de baseline pour entraîner le premier modèle ML ' ||
  '(roof_obb_v0_1). Source mixte : importés depuis soumissions client + ' ||
  'ajoutés via mode Explorer.',
  'manual_existing_bundle',
  'training_ready',
  'algo_v1_6',
  'Migration initiale — préservé tel quel, ne pas mélanger avec les nouveaux batchs.'
) ON CONFLICT (batch_code) DO NOTHING;

INSERT INTO public.model_versions (
  model_code, name, version, status, is_active,
  notes, training_config_json
) VALUES (
  'algo_v1_6',
  'Algo v1.6 — Pipeline algorithmique classique',
  '1.6.2',
  'deployed',
  true,
  'Pipeline 100% algorithmique (numpy + opencv + shapely). ' ||
  'Modules : fit_roof_rectangle → global_axes → ridge_hypotheses → ' ||
  'rectangle_from_ridge → structural_scoring → relational_graph → ' ||
  'semantic_order → scoring_extra → structural_selection → roof_sections. ' ||
  'Étape 3 Manhattan-world regularization ajoutée 2026-06-05. ' ||
  'Sera remplacé par roof_obb_v0_1 une fois entraîné.',
  jsonb_build_object(
    'pipeline_type', 'algorithmic',
    'selection_mode_default', 'adaptive',
    'min_total_score', 0.50,
    'min_size_frac_of_main', 0.15,
    'alternative_score_min', 0.55,
    'use_vision_prior', true,
    'regularize', true
  )
) ON CONFLICT (model_code) DO UPDATE SET
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active,
  notes = EXCLUDED.notes,
  training_config_json = EXCLUDED.training_config_json;

-- ── 5. BACKFILL : datasets existants → batch_000_initial + algo_v1_6 ──────
WITH initial_batch AS (
  SELECT id FROM public.training_batches WHERE batch_code = 'batch_000_initial'
)
UPDATE public.training_roof_takeoffs t
SET batch_id = (SELECT id FROM initial_batch),
    model_version_used = COALESCE(t.model_version_used, 'algo_v1_6'),
    source_type = COALESCE(
      t.source_type,
      CASE
        WHEN t.source_takeoff_id IS NOT NULL THEN 'soumission'
        ELSE 'manual'
      END
    ),
    prediction_json = COALESCE(t.prediction_json, t.roof_sections_v16),
    building_polygon_px = COALESCE(
      t.building_polygon_px,
      t.annotations_json -> 'building_polygon_px'
    ),
    centroid_lat = COALESCE(
      t.centroid_lat,
      (t.annotations_json -> 'map_params' ->> 'centerLat')::double precision
    ),
    centroid_lng = COALESCE(
      t.centroid_lng,
      (t.annotations_json -> 'map_params' ->> 'centerLng')::double precision
    ),
    zoom = COALESCE(
      t.zoom,
      (t.annotations_json -> 'map_params' ->> 'zoom')::integer
    )
WHERE t.batch_id IS NULL;

-- Stats agrégées sur batch 0
UPDATE public.training_batches b
SET dataset_count        = stats.total,
    validated_count      = stats.validated,
    rejected_count       = stats.rejected,
    avg_quality_score    = stats.avg_q,
    avg_correction_weight = stats.avg_cw
FROM (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE dataset_status IN ('validated','ready_for_training','exported')) AS validated,
    COUNT(*) FILTER (WHERE dataset_status = 'rejected') AS rejected,
    AVG(quality_score)::numeric(6,4) AS avg_q,
    AVG((roof_model_diff->>'correction_weight')::numeric)::numeric(6,4) AS avg_cw
  FROM public.training_roof_takeoffs
  WHERE batch_id = (SELECT id FROM public.training_batches WHERE batch_code = 'batch_000_initial')
) stats
WHERE b.batch_code = 'batch_000_initial';
