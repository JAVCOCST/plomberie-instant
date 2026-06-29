-- Add archived_at to contract_signature_requests for archiving signed/expired contracts
alter table public.contract_signature_requests
  add column if not exists archived_at timestamptz null;

create index if not exists idx_contract_signature_requests_archived
  on public.contract_signature_requests(archived_at);
