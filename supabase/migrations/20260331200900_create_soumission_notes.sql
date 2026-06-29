CREATE TABLE IF NOT EXISTS public.soumission_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  soumission_id uuid NOT NULL REFERENCES public.soumissions(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.soumission_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_soumission_notes" ON public.soumission_notes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_insert_soumission_notes" ON public.soumission_notes
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_delete_soumission_notes" ON public.soumission_notes
  FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_soumission_notes_soumission_id ON public.soumission_notes(soumission_id);
