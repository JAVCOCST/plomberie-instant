-- Factures fournisseur OCR'ées par projet, pour calculer le COÛTANT MATÉRIAUX
-- réel (vs estimé du devis) dans l'étape de clôture. Les lignes extraites sont
-- stockées en JSON ; material_total = somme des lignes "matériel".
create table if not exists public.project_invoices (
  id             uuid primary key default gen_random_uuid(),
  soumission_id  uuid references public.soumissions (id) on delete cascade,
  file_path      text,
  supplier       text,
  invoice_number text,
  invoice_date   date,
  currency       text default 'CAD',
  material_total numeric default 0,
  grand_total    numeric default 0,
  lines          jsonb default '[]'::jsonb,
  raw            jsonb,
  engine         text,
  created_at     timestamptz default now()
);

create index if not exists project_invoices_soumission_idx
  on public.project_invoices (soumission_id);

alter table public.project_invoices enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'project_invoices'
      and policyname = 'project_invoices_authenticated'
  ) then
    create policy project_invoices_authenticated on public.project_invoices
      for all to authenticated using (true) with check (true);
  end if;
end $$;
