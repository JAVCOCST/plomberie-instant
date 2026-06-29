ALTER TABLE public.soumissions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.form_sessions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_soumissions_archived_at ON public.soumissions(archived_at);
CREATE INDEX IF NOT EXISTS idx_form_sessions_archived_at ON public.form_sessions(archived_at);
