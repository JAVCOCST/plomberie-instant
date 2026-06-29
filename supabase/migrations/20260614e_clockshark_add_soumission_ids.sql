-- Allow assigning MORE THAN ONE project (soumission) to the same worked day.
-- When several projects share a day, the worked hours are split EQUALLY between
-- them in the closeout: hours_decimal / array_length(soumission_ids, 1).
--
-- soumission_id is kept as the "primary" project (first element of the array)
-- for back-compat with existing queries and the timesheet chips.
alter table public.clockshark_time_entries
  add column if not exists soumission_ids uuid[];

-- Backfill: existing single-project assignments become a 1-element array.
update public.clockshark_time_entries
  set soumission_ids = array[soumission_id]
  where soumission_id is not null and soumission_ids is null;

create index if not exists clockshark_time_entries_soumission_ids_idx
  on public.clockshark_time_entries using gin (soumission_ids);
