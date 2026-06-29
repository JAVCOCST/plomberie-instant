-- ClockShark "Job Detail" exports carry a "Notes:" line per punch (what was
-- actually done on site). Store it so the timesheet view shows notes, not just
-- hours. Applied to prod on 2026-06-14 (migration clockshark_time_entries_add_note).
alter table public.clockshark_time_entries
  add column if not exists note text;
