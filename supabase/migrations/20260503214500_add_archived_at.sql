-- Add archived_at to soumissions and form_sessions for soft-archive
ALTER TABLE public.soumissions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.form_sessions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS soumissions_archived_at_idx ON public.soumissions (archived_at);
CREATE INDEX IF NOT EXISTS form_sessions_archived_at_idx ON public.form_sessions (archived_at);
