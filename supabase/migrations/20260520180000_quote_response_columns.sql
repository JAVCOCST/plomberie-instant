-- Track client email responses
ALTER TABLE public.soumissions
  ADD COLUMN IF NOT EXISTS email_status text,
  ADD COLUMN IF NOT EXISTS email_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS decline_details text,
  ADD COLUMN IF NOT EXISTS revision_requested boolean DEFAULT false;
