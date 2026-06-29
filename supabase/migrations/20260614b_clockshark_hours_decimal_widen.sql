-- The first ClockShark migration shipped hours_decimal as numeric(6,3), capped
-- at 999.999. A yearly-total row in a real export overflowed it and aborted the
-- whole import batch. Widen to numeric(8,3) (max 99999.999). Idempotent-ish:
-- re-running on an already-widened column is a no-op.
--
-- Applied to prod on 2026-06-14 (migration clockshark_hours_decimal_widen).
alter table public.clockshark_time_entries
  alter column hours_decimal type numeric(8,3);
