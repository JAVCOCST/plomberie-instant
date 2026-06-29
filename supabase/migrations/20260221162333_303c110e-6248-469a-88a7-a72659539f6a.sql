-- Enable RLS on batiment_poly_temp (RPC-only access via find_building_polygon)
ALTER TABLE public.batiment_poly_temp ENABLE ROW LEVEL SECURITY;

-- Enable RLS on Batiment_poly (same strategy)
ALTER TABLE public."Batiment_poly" ENABLE ROW LEVEL SECURITY;