-- Training Lab Toiture: dataset preparation tables

create table if not exists public.training_roof_takeoffs (
  id uuid primary key default gen_random_uuid(),
  source_takeoff_id uuid,
  reference text,
  address text,
  raw_image_url text,
  annotated_image_url text,
  debug_overlay_url text,
  json_url text,
  original_building_geojson jsonb,
  corrected_building_geojson jsonb,
  original_lot_geojson jsonb,
  corrected_lot_geojson jsonb,
  annotations_json jsonb,
  calibration_status text default 'pending',
  calibration_offset_px jsonb,
  calibration_offset_m jsonb,
  calibration_rotation_deg numeric default 0,
  calibration_scale numeric default 1,
  calibration_confidence numeric,
  calibration_notes text,
  dataset_status text not null default 'draft',
  quality_score numeric,
  tags text[] not null default '{}',
  human_notes text,
  export_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_trt_status on public.training_roof_takeoffs(dataset_status);
create index if not exists idx_trt_source on public.training_roof_takeoffs(source_takeoff_id);

alter table public.training_roof_takeoffs enable row level security;

drop policy if exists auth_all_trt on public.training_roof_takeoffs;
create policy auth_all_trt on public.training_roof_takeoffs
  for all to authenticated using (true) with check (true);

drop policy if exists service_all_trt on public.training_roof_takeoffs;
create policy service_all_trt on public.training_roof_takeoffs
  for all to service_role using (true) with check (true);

create table if not exists public.training_export_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  takeoff_ids uuid[] not null default '{}',
  bundle_url text,
  status text not null default 'pending',
  schema_version text not null default '1.0.0',
  description text,
  metadata jsonb
);

alter table public.training_export_batches enable row level security;

drop policy if exists auth_all_teb on public.training_export_batches;
create policy auth_all_teb on public.training_export_batches
  for all to authenticated using (true) with check (true);

create or replace function public.touch_training_takeoff_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_trt_touch on public.training_roof_takeoffs;
create trigger trg_trt_touch before update on public.training_roof_takeoffs
  for each row execute function public.touch_training_takeoff_updated_at();

-- Storage bucket (private)
insert into storage.buckets (id, name, public)
values ('training-assets', 'training-assets', false)
on conflict (id) do nothing;

drop policy if exists "training_assets_auth_select" on storage.objects;
create policy "training_assets_auth_select" on storage.objects
  for select to authenticated using (bucket_id = 'training-assets');

drop policy if exists "training_assets_auth_insert" on storage.objects;
create policy "training_assets_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'training-assets');

drop policy if exists "training_assets_auth_update" on storage.objects;
create policy "training_assets_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'training-assets') with check (bucket_id = 'training-assets');

drop policy if exists "training_assets_auth_delete" on storage.objects;
create policy "training_assets_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'training-assets');
