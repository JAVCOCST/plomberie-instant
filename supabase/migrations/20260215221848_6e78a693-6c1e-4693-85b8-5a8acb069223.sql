
CREATE TABLE public.soumissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Client
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  
  -- Adresse
  formatted_address TEXT,
  place_id TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  
  -- Toiture
  coverage_type TEXT,
  complexity TEXT,
  slope TEXT,
  area_sqft DOUBLE PRECISION,
  area_input DOUBLE PRECISION,
  area_unit TEXT,
  
  -- Produit
  product_id TEXT,
  product_name TEXT,
  product_brand TEXT,
  color TEXT,
  price_per_sqft DOUBLE PRECISION,
  
  -- Date souhaitée
  desired_install_date DATE,
  
  -- Estimation
  subtotal DOUBLE PRECISION,
  mobilisation DOUBLE PRECISION,
  low_estimate DOUBLE PRECISION,
  high_estimate DOUBLE PRECISION,
  complexity_factor DOUBLE PRECISION,
  slope_factor DOUBLE PRECISION,
  
  -- Metadata
  user_agent TEXT,
  page_url TEXT,
  utm JSONB DEFAULT '{}'::jsonb
);

-- RLS: allow anonymous inserts, restrict reads
ALTER TABLE public.soumissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous inserts" ON public.soumissions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "No public reads" ON public.soumissions
  FOR SELECT USING (false);
