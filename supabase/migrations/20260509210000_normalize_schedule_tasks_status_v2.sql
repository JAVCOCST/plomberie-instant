-- Re-run idempotent normalisation des statuts legacy de schedule_tasks.
UPDATE public.schedule_tasks SET status = 'waiting_contact' WHERE status IN ('to_contact','contacted');
UPDATE public.schedule_tasks SET status = 'accepted'        WHERE status IN ('to_schedule','to_plan','travaux_cedule','travaux cédulé');
UPDATE public.schedule_tasks SET status = 'done'            WHERE status = 'completed';
UPDATE public.schedule_tasks SET status = 'new'             WHERE status IN ('n','','not_started') OR status IS NULL;
