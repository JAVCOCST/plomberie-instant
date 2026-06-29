-- Link worked hours to a project (soumission) so the closeout step can compare
-- cost vs revenue. Assigned from the Timesheets view (proposed from the Suivi
-- projet schedule, confirmed by hand). Applied to prod on 2026-06-14.
alter table public.clockshark_time_entries
  add column if not exists soumission_id uuid references public.soumissions (id) on delete set null;

create index if not exists clockshark_time_entries_soumission_idx
  on public.clockshark_time_entries (soumission_id);
