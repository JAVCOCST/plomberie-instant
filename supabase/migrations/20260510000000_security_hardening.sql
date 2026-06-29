-- ════════════════════════════════════════════════════════════════════
-- Security hardening migration
-- 1. Privatize quote-pdfs bucket + restrict storage policies
-- 2. Set search_path on all app SECURITY DEFINER functions (already done) +
--    remaining trigger functions
-- 3. REVOKE EXECUTE on internal trigger SECURITY DEFINER functions
-- 4. Keep find_building_polygon / find_buildings_near_point callable by anon
--    (legitimate public form use case) but document via security_invoker note.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Storage: quote-pdfs becomes private ─────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'quote-pdfs';

DROP POLICY IF EXISTS "Anyone can read quote PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload quote PDFs" ON storage.objects;

-- Anonymous users can still UPLOAD PDFs (immersive public form path:
-- quotes/<session>/...). Filename collision is acceptable since paths
-- include UUIDs; there is no SELECT permission so they cannot list.
CREATE POLICY "anon_insert_quote_pdfs"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'quote-pdfs');

-- Authenticated users (admin portal) can manage everything in this bucket.
CREATE POLICY "auth_select_quote_pdfs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'quote-pdfs');

CREATE POLICY "auth_insert_quote_pdfs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quote-pdfs');

CREATE POLICY "auth_update_quote_pdfs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'quote-pdfs')
  WITH CHECK (bucket_id = 'quote-pdfs');

CREATE POLICY "auth_delete_quote_pdfs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'quote-pdfs');

-- ─── 2. Function search_path on remaining trigger fns ───────────────
ALTER FUNCTION public.touch_quote_templates_updated_at()
  SET search_path = public;

ALTER FUNCTION public.update_schedule_task_updated_at()
  SET search_path = public;

-- ─── 3. REVOKE EXECUTE on internal trigger SECURITY DEFINER fns ─────
-- These are TRIGGER functions; nothing should call them via RPC.
REVOKE EXECUTE ON FUNCTION public.autolink_task_to_soumission()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_soumission_spam()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_status_soumission_to_tasks()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_status_task_to_soumission()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_quote_templates_updated_at()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_schedule_task_updated_at()      FROM PUBLIC, anon, authenticated;

-- find_building_polygon / find_buildings_near_point are intentionally
-- callable by anon (the immersive public quote form needs them to detect
-- the roof footprint at an address). Internal validation: the RPCs only
-- return non-PII geometry data (Batiment_poly + lots_cadastre).
-- We keep EXECUTE for anon + authenticated; documented in security memory.
