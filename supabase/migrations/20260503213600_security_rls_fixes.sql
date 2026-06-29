-- Fix: owner_lookup_results — restrict to service_role only
DROP POLICY IF EXISTS "Service role full access" ON public.owner_lookup_results;

CREATE POLICY "Service role full access"
  ON public.owner_lookup_results
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Fix: batiment_avec_lot — enable RLS. Contains property owner names, addresses,
-- and evaluation values. Restrict reads to authenticated users only.
ALTER TABLE public.batiment_avec_lot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read batiment_avec_lot"
  ON public.batiment_avec_lot
  FOR SELECT
  TO authenticated
  USING (true);
