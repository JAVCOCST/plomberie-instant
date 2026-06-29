-- Status taxonomy v2: hybrid migration, non-destructive.
-- Renames legacy values to new canonical codes, enables Realtime publication.

UPDATE public.soumissions SET status = 'waiting_contact' WHERE status IN ('to_contact','contacted');
UPDATE public.soumissions SET status = 'visit_booked'    WHERE status = 'visit_scheduled';
UPDATE public.soumissions SET status = 'estimating'      WHERE status IN ('visit_done','to_quote');
UPDATE public.soumissions SET status = 'quote_sent'      WHERE status = 'pending_approval';
UPDATE public.soumissions SET status = 'accepted'        WHERE status IN ('completed','to_schedule');
UPDATE public.soumissions SET status = 'cancelled'       WHERE status = 'archived';

COMMENT ON COLUMN public.soumissions.status IS
  'Allowed: new, waiting_contact, visit_booked, estimating, quote_sent, revision, accepted, scheduled, in_progress, done, invoiced, cancelled';

ALTER TABLE public.soumissions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'soumissions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.soumissions';
  END IF;
END$$;
