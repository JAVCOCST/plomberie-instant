
-- 1. Create form_sessions table for tracking partial/abandoned submissions
CREATE TABLE public.form_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  first_name text,
  last_name text,
  email text,
  phone text,
  formatted_address text,
  lat double precision,
  lng double precision,
  coverage_type text,
  slope text,
  product_name text,
  product_brand text,
  color text,
  desired_install_date text,
  last_step int NOT NULL DEFAULT 0,
  total_steps int NOT NULL DEFAULT 8,
  step_labels jsonb DEFAULT '["Adresse","Bâtiment","Couverture","Pente","Produit","Couleur","Date","Client"]',
  step_timings jsonb DEFAULT '{}',
  is_complete boolean NOT NULL DEFAULT false,
  soumission_id uuid REFERENCES public.soumissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  page_url text
);

-- Enable RLS
ALTER TABLE public.form_sessions ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts and updates (form tracking)
CREATE POLICY "Allow anonymous insert form_sessions"
ON public.form_sessions FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Allow anonymous update form_sessions"
ON public.form_sessions FOR UPDATE TO public USING (true) WITH CHECK (true);

-- Allow authenticated reads
CREATE POLICY "Authenticated read form_sessions"
ON public.form_sessions FOR SELECT TO authenticated USING (true);

-- Allow authenticated deletes
CREATE POLICY "Authenticated delete form_sessions"
ON public.form_sessions FOR DELETE TO authenticated USING (true);

-- 2. Add dynasty_breakdown to soumissions
ALTER TABLE public.soumissions ADD COLUMN IF NOT EXISTS dynasty_breakdown jsonb;

-- 3. Add form_session_id to soumissions for linking
ALTER TABLE public.soumissions ADD COLUMN IF NOT EXISTS form_session_id uuid;
