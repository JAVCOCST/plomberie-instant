-- ─────────────────────────────────────────────────────────────────────────
-- Synchronisation bidirectionnelle du statut entre `soumissions` et
-- `schedule_tasks`. Lien explicite via `schedule_tasks.soumission_id`.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Lien direct vers la soumission
ALTER TABLE public.schedule_tasks
  ADD COLUMN IF NOT EXISTS soumission_id uuid REFERENCES public.soumissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_tasks_soumission_id
  ON public.schedule_tasks(soumission_id);

-- 2. Backfill : relier les tâches existantes via estimator → qb_customers → soumissions
UPDATE public.schedule_tasks st
SET soumission_id = sub.soum_id
FROM (
  SELECT DISTINCT ON (st2.id) st2.id AS task_id, s.id AS soum_id
  FROM public.schedule_tasks st2
  JOIN public.qb_customers c ON c.qb_id = st2.estimator
  JOIN public.soumissions s ON
    (NULLIF(lower(trim(c.email)), '') IS NOT NULL
     AND lower(trim(c.email)) = lower(trim(s.email)))
    OR lower(trim(c.display_name)) = lower(trim(s.first_name || ' ' || s.last_name))
  WHERE st2.soumission_id IS NULL
  ORDER BY st2.id, s.created_at DESC
) sub
WHERE st.id = sub.task_id;

-- 3. Trigger : soumissions.status → schedule_tasks.status
CREATE OR REPLACE FUNCTION public.sync_status_soumission_to_tasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.schedule_tasks
    SET status = NEW.status, updated_at = now()
    WHERE soumission_id = NEW.id
      AND status IS DISTINCT FROM NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_status_soumission_to_tasks ON public.soumissions;
CREATE TRIGGER trg_sync_status_soumission_to_tasks
  AFTER UPDATE OF status ON public.soumissions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_status_soumission_to_tasks();

-- 4. Trigger : schedule_tasks.status → soumissions.status
CREATE OR REPLACE FUNCTION public.sync_status_task_to_soumission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.soumission_id IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.soumissions
    SET status = NEW.status
    WHERE id = NEW.soumission_id
      AND status IS DISTINCT FROM NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_status_task_to_soumission ON public.schedule_tasks;
CREATE TRIGGER trg_sync_status_task_to_soumission
  AFTER UPDATE OF status ON public.schedule_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_status_task_to_soumission();

-- 5. Backfill : aligner le statut des tâches liées sur celui de la soumission
UPDATE public.schedule_tasks st
SET status = s.status, updated_at = now()
FROM public.soumissions s
WHERE st.soumission_id = s.id
  AND st.status IS DISTINCT FROM s.status;
