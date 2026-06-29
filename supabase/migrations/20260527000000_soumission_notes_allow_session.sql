-- Allow soumission_notes to attach to either a real soumission or an abandoned form session id.
-- The FK to soumissions(id) was rejecting inserts for abandoned leads (notes panel on mobile silently failed).
ALTER TABLE public.soumission_notes
  DROP CONSTRAINT IF EXISTS soumission_notes_soumission_id_fkey;

CREATE INDEX IF NOT EXISTS soumission_notes_soumission_id_idx
  ON public.soumission_notes (soumission_id);
