-- Training Lab: roof_model + roof_sections_v16 + roof_model_diff columns
--
-- Adds the three JSONB columns the application already reads/writes today
-- (declared in `src/lib/training-lab.ts` but absent from any prior migration
-- and from the generated types). Without this migration any fresh environment
-- or `supabase db reset` silently loses the human-corrected truth that the
-- Training Lab depends on for AI fine-tuning.
--
-- Vague A of the Training Lab handoff (briefing §4.1).
--
-- Safety notes:
--   * All three columns are nullable -> no existing row breaks.
--   * `ADD COLUMN IF NOT EXISTS` -> idempotent on environments where the
--     columns were already added by hand in Supabase Studio.
--   * Existing RLS policies on `public.training_roof_takeoffs`
--     (auth_all_trt + service_all_trt, declared in 20260524000000 /
--     20260525000000) are `for all` and therefore already cover any new
--     column on the table -- no further policy work required.
--   * Rollback = `ALTER TABLE ... DROP COLUMN IF EXISTS ...` for each column
--     plus `DROP INDEX IF EXISTS idx_trt_roof_model_status`.

alter table public.training_roof_takeoffs
  add column if not exists roof_model jsonb,
  add column if not exists roof_sections_v16 jsonb,
  add column if not exists roof_model_diff jsonb;

-- Partial index to speed up "datasets with a human-corrected RoofModel"
-- queries by status (Training Lab dashboard + bundle pre-flight filters).
create index if not exists idx_trt_roof_model_status
  on public.training_roof_takeoffs(dataset_status)
  where roof_model is not null;
