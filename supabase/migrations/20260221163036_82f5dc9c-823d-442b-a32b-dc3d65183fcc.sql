
-- 1) Validation constraints (NOT VALID then VALIDATE — preflight confirmed 0 invalid rows)
ALTER TABLE public.soumissions
  ADD CONSTRAINT chk_email_format 
    CHECK (email IS NOT NULL AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') NOT VALID,
  ADD CONSTRAINT chk_phone_not_empty 
    CHECK (phone IS NOT NULL AND length(trim(phone)) >= 7) NOT VALID,
  ADD CONSTRAINT chk_names_not_empty 
    CHECK (
      first_name IS NOT NULL AND length(trim(first_name)) >= 1 AND
      last_name  IS NOT NULL AND length(trim(last_name))  >= 1
    ) NOT VALID;

ALTER TABLE public.soumissions VALIDATE CONSTRAINT chk_email_format;
ALTER TABLE public.soumissions VALIDATE CONSTRAINT chk_phone_not_empty;
ALTER TABLE public.soumissions VALIDATE CONSTRAINT chk_names_not_empty;

-- 2) Anti-spam trigger (normalize email, block >3/hour)
CREATE OR REPLACE FUNCTION public.check_soumission_spam()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  NEW.email := lower(trim(NEW.email));

  IF NEW.email IS NULL OR NEW.email = '' THEN
    RAISE EXCEPTION 'Email requis'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO recent_count
  FROM public.soumissions
  WHERE lower(trim(email)) = NEW.email
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'Trop de soumissions récentes pour cet email'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_soumission_spam ON public.soumissions;

CREATE TRIGGER trg_check_soumission_spam
  BEFORE INSERT ON public.soumissions
  FOR EACH ROW
  EXECUTE FUNCTION public.check_soumission_spam();

-- 3) Reference ID (12 chars, unique index)
ALTER TABLE public.soumissions
  ADD COLUMN reference_id text
  GENERATED ALWAYS AS ('VB-' || upper(substring(id::text from 1 for 12))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_soumissions_reference_id
  ON public.soumissions(reference_id);
