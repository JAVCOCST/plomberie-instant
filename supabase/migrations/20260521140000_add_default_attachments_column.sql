ALTER TABLE public.quote_email_templates
  ADD COLUMN IF NOT EXISTS default_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
