-- Skeleton tests storage for the Training Lab.
-- Idempotent + self-contained: creates the table if missing, then ensures
-- diagnostic columns / indexes / RLS policies are in place. Safe to re-run.

create table if not exists public.training_skeleton_tests (
  id uuid primary key default gen_random_uuid(),
  takeoff_id uuid not null,
  skeleton_json jsonb not null,
  quality_score numeric,
  visual_verdict text,
  chamfer_distance_m numeric,
  length_ratio numeric,
  scale_consistent boolean,
  projection_consistent boolean,
  likely_error_source text,
  created_at timestamptz not null default now()
);

-- Diagnostic columns added after the initial table was created.
alter table public.training_skeleton_tests
  add column if not exists diagnostics jsonb,
  add column if not exists auto_saved boolean not null default false,
  add column if not exists payload_hash text;

create index if not exists idx_training_skeleton_tests_takeoff
  on public.training_skeleton_tests (takeoff_id, created_at desc);

-- Upserts in SkeletonTestModal rely on this composite unique target.
create unique index if not exists uq_training_skeleton_tests_takeoff_hash
  on public.training_skeleton_tests (takeoff_id, payload_hash)
  where payload_hash is not null;

alter table public.training_skeleton_tests enable row level security;

drop policy if exists auth_all_tst on public.training_skeleton_tests;
create policy auth_all_tst on public.training_skeleton_tests
  for all to authenticated using (true) with check (true);

drop policy if exists service_all_tst on public.training_skeleton_tests;
create policy service_all_tst on public.training_skeleton_tests
  for all to service_role using (true) with check (true);
