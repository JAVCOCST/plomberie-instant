-- Default PDF attachments per quote email template.
ALTER TABLE public.quote_email_templates
  ADD COLUMN IF NOT EXISTS default_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
