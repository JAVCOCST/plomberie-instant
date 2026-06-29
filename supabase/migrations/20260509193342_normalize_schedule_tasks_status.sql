-- Normalise les statuts legacy de `schedule_tasks` (créés via QBO sync
-- avant la migration v2) vers la taxonomie canonique de PROJECT_STATUSES.
-- Évite que le Gantt affiche des badges bruts comme "to_schedule" / "to_contact".

UPDATE public.schedule_tasks SET status = 'waiting_contact' WHERE status IN ('to_contact','contacted');
UPDATE public.schedule_tasks SET status = 'accepted'        WHERE status IN ('to_schedule','to_plan');
UPDATE public.schedule_tasks SET status = 'done'            WHERE status = 'completed';
UPDATE public.schedule_tasks SET status = 'new'             WHERE status IN ('n','') OR status IS NULL;
