CREATE TABLE IF NOT EXISTS public.owner_lookup_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_number text NOT NULL,
  owner_name text DEFAULT '',
  address text DEFAULT '',
  city text DEFAULT '',
  postal_code text DEFAULT '',
  acquisition_date text DEFAULT '',
  price text DEFAULT '',
  is_complete boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_owner_lookup_lot ON public.owner_lookup_results(lot_number, created_at DESC);

ALTER TABLE public.owner_lookup_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.owner_lookup_results
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-cleanup old results (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_owner_lookups() RETURNS trigger AS $$
BEGIN
  DELETE FROM public.owner_lookup_results WHERE created_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cleanup_owner_lookups
  AFTER INSERT ON public.owner_lookup_results
  EXECUTE FUNCTION cleanup_old_owner_lookups();
