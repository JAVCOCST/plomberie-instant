-- Ensure default_attachments column exists on quote_email_templates and refresh PostgREST schema cache.
ALTER TABLE public.quote_email_templates
  ADD COLUMN IF NOT EXISTS default_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
