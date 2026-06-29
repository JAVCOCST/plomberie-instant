-- Equipment registry (cranes, trucks, lifts, etc.) used in Dispatch
CREATE TABLE IF NOT EXISTS public.equipment (
  id text PRIMARY KEY,
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  display_name text NOT NULL,
  alias text,
  category text,
  identifier text,
  notes text,
  color text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_all_equipment ON public.equipment;
CREATE POLICY auth_all_equipment ON public.equipment
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Allow dispatch_assignments to reference equipment instead of an employee.
ALTER TABLE public.dispatch_assignments
  ADD COLUMN IF NOT EXISTS equipment_id text;

ALTER TABLE public.dispatch_assignments
  ALTER COLUMN employee_id DROP NOT NULL;

ALTER TABLE public.dispatch_assignments
  DROP CONSTRAINT IF EXISTS dispatch_assignments_resource_required;
ALTER TABLE public.dispatch_assignments
  ADD CONSTRAINT dispatch_assignments_resource_required
  CHECK (employee_id IS NOT NULL OR equipment_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_dispatch_assignments_equipment
  ON public.dispatch_assignments(equipment_id)
  WHERE equipment_id IS NOT NULL;
