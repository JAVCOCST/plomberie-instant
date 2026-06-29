-- Add updated_at column + auto-update trigger on soumissions
-- Ensures Realtime signature (id:status:updated_at) catches every change.

ALTER TABLE public.soumissions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill existing rows
UPDATE public.soumissions SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

-- Generic trigger function (reused if it exists)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_soumissions_set_updated_at ON public.soumissions;
CREATE TRIGGER trg_soumissions_set_updated_at
BEFORE UPDATE ON public.soumissions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
