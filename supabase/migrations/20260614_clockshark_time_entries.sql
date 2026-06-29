-- ClockShark time tracking: import audit trail + flattened time entries.
--
-- NOTE: already applied to the TOITURES VB prod database (migration version
-- 20260614163832). This file mirrors that schema for fresh environments and is
-- written to be idempotent, so re-running it is a no-op.

create table if not exists public.clockshark_imports (
  id              uuid primary key default gen_random_uuid(),
  imported_at     timestamptz not null default now(),
  imported_by     uuid references auth.users (id),
  filename        text,
  file_size_bytes integer,
  file_hash       text,
  period_start    date,
  period_end      date,
  entries_count    integer not null default 0,
  entries_deleted  integer not null default 0,
  entries_inserted integer not null default 0,
  warnings        text[],
  notes           text
);

create table if not exists public.clockshark_time_entries (
  id               uuid primary key default gen_random_uuid(),
  employee         text not null,
  entry_date       date not null,
  customer_job     text not null,
  task             text not null default '',
  hours_decimal    numeric(8,3) not null check (hours_decimal >= 0),
  hours_hm         text,
  note             text,
  soumission_id    uuid references public.soumissions (id) on delete set null,
  source_import_id uuid references public.clockshark_imports (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One row per (employee, day, job, task); re-imports replace a period.
  constraint clockshark_time_entries_unique unique (employee, entry_date, customer_job, task)
);

create index if not exists clockshark_time_entries_date_idx     on public.clockshark_time_entries (entry_date);
create index if not exists clockshark_time_entries_job_idx      on public.clockshark_time_entries (customer_job);
create index if not exists clockshark_time_entries_employee_idx on public.clockshark_time_entries (employee);

alter table public.clockshark_imports      enable row level security;
alter table public.clockshark_time_entries enable row level security;

-- The admin portal is auth-gated, so authenticated users get full access.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clockshark_imports'
      and policyname = 'clockshark_imports_authenticated'
  ) then
    create policy clockshark_imports_authenticated on public.clockshark_imports
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clockshark_time_entries'
      and policyname = 'clockshark_time_entries_authenticated'
  ) then
    create policy clockshark_time_entries_authenticated on public.clockshark_time_entries
      for all to authenticated using (true) with check (true);
  end if;
end $$;
