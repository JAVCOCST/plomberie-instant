ALTER TABLE public.soumission_notes
  DROP CONSTRAINT IF EXISTS soumission_notes_soumission_id_fkey;

CREATE INDEX IF NOT EXISTS soumission_notes_soumission_id_idx
  ON public.soumission_notes (soumission_id);
