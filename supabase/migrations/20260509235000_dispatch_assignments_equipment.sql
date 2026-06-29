-- Add equipment_id column to dispatch_assignments to support equipment dispatch
ALTER TABLE public.dispatch_assignments
  ADD COLUMN IF NOT EXISTS equipment_id text;

CREATE INDEX IF NOT EXISTS idx_dispatch_assignments_equipment_id
  ON public.dispatch_assignments(equipment_id);
