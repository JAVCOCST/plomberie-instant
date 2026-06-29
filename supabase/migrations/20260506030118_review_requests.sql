-- Module Demandes d'avis Google
create table if not exists public.review_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template_body text not null,
  google_review_url text,
  status text not null default 'draft', -- draft|sending|sent|failed
  total_recipients int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.review_sms_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.review_campaigns(id) on delete cascade,
  soumission_id uuid,
  client_first_name text,
  client_last_name text,
  client_phone text not null,
  message_body text not null,
  twilio_sid text,
  status text not null default 'queued', -- queued|sent|delivered|failed|undelivered
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.review_optouts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_review_sms_log_campaign on public.review_sms_log(campaign_id);
create index if not exists idx_review_sms_log_phone on public.review_sms_log(client_phone);
create index if not exists idx_review_sms_log_sid on public.review_sms_log(twilio_sid);

alter table public.review_campaigns enable row level security;
alter table public.review_sms_log enable row level security;
alter table public.review_optouts enable row level security;

create policy "auth_all_review_campaigns" on public.review_campaigns
  for all to authenticated using (true) with check (true);

create policy "auth_all_review_sms_log" on public.review_sms_log
  for all to authenticated using (true) with check (true);
create policy "service_all_review_sms_log" on public.review_sms_log
  for all to service_role using (true) with check (true);

create policy "auth_all_review_optouts" on public.review_optouts
  for all to authenticated using (true) with check (true);
create policy "service_all_review_optouts" on public.review_optouts
  for all to service_role using (true) with check (true);
