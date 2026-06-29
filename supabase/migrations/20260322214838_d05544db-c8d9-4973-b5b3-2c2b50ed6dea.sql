
-- Add unique constraint on session_id for upsert
ALTER TABLE public.form_sessions ADD CONSTRAINT form_sessions_session_id_unique UNIQUE (session_id);
