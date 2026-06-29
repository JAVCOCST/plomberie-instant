-- Table équipement (camions, remorques, machinerie)
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

CREATE POLICY "auth_all_equipment"
  ON public.equipment
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Optionnel : colonne equipment_id sur les assignations de dispatch
ALTER TABLE public.dispatch_assignments
  ADD COLUMN IF NOT EXISTS equipment_id text REFERENCES public.equipment(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_company ON public.equipment(company_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_assignments_equipment ON public.dispatch_assignments(equipment_id);
