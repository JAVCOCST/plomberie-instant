-- Re-application sync bidirectionnelle status soumissions <-> schedule_tasks
-- (la migration 20260427130356 ne s'est pas executee : colonne et triggers absents).

ALTER TABLE public.schedule_tasks
  ADD COLUMN IF NOT EXISTS soumission_id uuid REFERENCES public.soumissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_tasks_soumission_id
  ON public.schedule_tasks(soumission_id);

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

CREATE OR REPLACE FUNCTION public.sync_status_soumission_to_tasks()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.schedule_tasks
    SET status = NEW.status, updated_at = now()
    WHERE soumission_id = NEW.id
      AND status IS DISTINCT FROM NEW.status;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_sync_status_soumission_to_tasks ON public.soumissions;
CREATE TRIGGER trg_sync_status_soumission_to_tasks
  AFTER UPDATE OF status ON public.soumissions
  FOR EACH ROW EXECUTE FUNCTION public.sync_status_soumission_to_tasks();

CREATE OR REPLACE FUNCTION public.sync_status_task_to_soumission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
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
$func$;

DROP TRIGGER IF EXISTS trg_sync_status_task_to_soumission ON public.schedule_tasks;
CREATE TRIGGER trg_sync_status_task_to_soumission
  AFTER UPDATE OF status ON public.schedule_tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_status_task_to_soumission();

CREATE OR REPLACE FUNCTION public.autolink_task_to_soumission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_soum_id uuid;
  v_soum_status text;
BEGIN
  IF NEW.soumission_id IS NULL AND NEW.estimator IS NOT NULL THEN
    SELECT s.id, s.status INTO v_soum_id, v_soum_status
    FROM public.qb_customers c
    JOIN public.soumissions s ON
      (NULLIF(lower(trim(c.email)), '') IS NOT NULL
       AND lower(trim(c.email)) = lower(trim(s.email)))
      OR lower(trim(c.display_name)) = lower(trim(s.first_name || ' ' || s.last_name))
    WHERE c.qb_id = NEW.estimator
    ORDER BY s.created_at DESC
    LIMIT 1;

    IF v_soum_id IS NOT NULL THEN
      NEW.soumission_id := v_soum_id;
      IF v_soum_status IS NOT NULL THEN
        NEW.status := v_soum_status;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_autolink_task_to_soumission ON public.schedule_tasks;
CREATE TRIGGER trg_autolink_task_to_soumission
  BEFORE INSERT ON public.schedule_tasks
  FOR EACH ROW EXECUTE FUNCTION public.autolink_task_to_soumission();

UPDATE public.schedule_tasks st
SET status = s.status, updated_at = now()
FROM public.soumissions s
WHERE st.soumission_id = s.id
  AND st.status IS DISTINCT FROM s.status;
