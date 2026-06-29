-- Unify project status taxonomy across the application.
-- The Gantt previously used a separate status taxonomy (not_started, in_progress,
-- to_create, in_submission, submission_sent, submission_accepted, to_plan, on_hold).
-- We migrate all existing schedule_tasks values to the unified Dashboard taxonomy.

-- 1. Map legacy Gantt statuses → unified statuses on schedule_tasks
UPDATE public.schedule_tasks
SET status = CASE status
  WHEN 'not_started'         THEN 'new'
  WHEN 'in_progress'         THEN 'scheduled'
  WHEN 'on_hold'             THEN 'pending_approval'
  WHEN 'to_create'           THEN 'new'
  WHEN 'in_submission'       THEN 'to_quote'
  WHEN 'submission_sent'     THEN 'pending_approval'
  WHEN 'submission_accepted' THEN 'completed'
  WHEN 'to_plan'             THEN 'to_schedule'
  ELSE status
END
WHERE status IN (
  'not_started','in_progress','on_hold','to_create',
  'in_submission','submission_sent','submission_accepted','to_plan'
);

-- 2. Update default for new tasks
ALTER TABLE public.schedule_tasks
  ALTER COLUMN status SET DEFAULT 'new';
