-- Contract e-signature system

insert into storage.buckets (id, name, public)
values ('contract-signatures', 'contract-signatures', true)
on conflict (id) do nothing;

drop policy if exists "contract_sig_public_read" on storage.objects;
create policy "contract_sig_public_read" on storage.objects
  for select using (bucket_id = 'contract-signatures');

drop policy if exists "contract_sig_auth_write" on storage.objects;
create policy "contract_sig_auth_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'contract-signatures');

drop policy if exists "contract_sig_auth_update" on storage.objects;
create policy "contract_sig_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'contract-signatures');

drop policy if exists "contract_sig_auth_delete" on storage.objects;
create policy "contract_sig_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'contract-signatures');

create table if not exists public.contract_signature_requests (
  id              uuid primary key default gen_random_uuid(),
  soumission_id   uuid references public.soumissions(id) on delete cascade,
  created_by      uuid,
  contract_html   text,
  contract_pdf_url text,
  signed_pdf_url  text,
  subject         text not null default 'Contrat à signer',
  message         text,
  status          text not null default 'draft',
  access_token    text not null unique,
  progress_percent integer not null default 0,
  sent_at         timestamptz,
  completed_at    timestamptz,
  expires_at      timestamptz default (now() + interval '30 days'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_csr_soumission on public.contract_signature_requests(soumission_id);
create index if not exists idx_csr_status     on public.contract_signature_requests(status);
create index if not exists idx_csr_token      on public.contract_signature_requests(access_token);

create table if not exists public.contract_signers (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.contract_signature_requests(id) on delete cascade,
  signer_order  integer not null default 1,
  name          text not null,
  email         text,
  phone         text,
  role          text not null default 'client',
  color         text not null default '#6366f1',
  status        text not null default 'pending',
  viewed_at     timestamptz,
  signed_at     timestamptz,
  declined_at   timestamptz,
  ip_address    text,
  user_agent    text,
  signature_image_url text,
  signer_token  text not null unique,
  created_at    timestamptz not null default now()
);
create index if not exists idx_signers_request on public.contract_signers(request_id);
create index if not exists idx_signers_token   on public.contract_signers(signer_token);

create table if not exists public.contract_signature_fields (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.contract_signature_requests(id) on delete cascade,
  signer_id   uuid not null references public.contract_signers(id) on delete cascade,
  field_type  text not null,
  page        integer not null default 1,
  x_pct       numeric not null,
  y_pct       numeric not null,
  width_pct   numeric not null default 18,
  height_pct  numeric not null default 5,
  required    boolean not null default true,
  label       text,
  value       text,
  signed_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_csf_request on public.contract_signature_fields(request_id);
create index if not exists idx_csf_signer  on public.contract_signature_fields(signer_id);

create table if not exists public.contract_signature_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.contract_signature_requests(id) on delete cascade,
  signer_id   uuid references public.contract_signers(id) on delete set null,
  event_type  text not null,
  metadata    jsonb default '{}'::jsonb,
  ip_address  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cse_request on public.contract_signature_events(request_id);

create or replace function public.touch_updated_at_csig()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists trg_csr_touch on public.contract_signature_requests;
create trigger trg_csr_touch before update on public.contract_signature_requests
  for each row execute function public.touch_updated_at_csig();

alter table public.contract_signature_requests enable row level security;
alter table public.contract_signers             enable row level security;
alter table public.contract_signature_fields    enable row level security;
alter table public.contract_signature_events    enable row level security;

drop policy if exists auth_all_csr     on public.contract_signature_requests;
drop policy if exists auth_all_signers on public.contract_signers;
drop policy if exists auth_all_csf     on public.contract_signature_fields;
drop policy if exists auth_all_cse     on public.contract_signature_events;
create policy auth_all_csr     on public.contract_signature_requests for all to authenticated using (true) with check (true);
create policy auth_all_signers on public.contract_signers             for all to authenticated using (true) with check (true);
create policy auth_all_csf     on public.contract_signature_fields    for all to authenticated using (true) with check (true);
create policy auth_all_cse     on public.contract_signature_events    for all to authenticated using (true) with check (true);

drop policy if exists service_all_csr     on public.contract_signature_requests;
drop policy if exists service_all_signers on public.contract_signers;
drop policy if exists service_all_csf     on public.contract_signature_fields;
drop policy if exists service_all_cse     on public.contract_signature_events;
create policy service_all_csr     on public.contract_signature_requests for all to service_role using (true) with check (true);
create policy service_all_signers on public.contract_signers             for all to service_role using (true) with check (true);
create policy service_all_csf     on public.contract_signature_fields    for all to service_role using (true) with check (true);
create policy service_all_cse     on public.contract_signature_events    for all to service_role using (true) with check (true);
