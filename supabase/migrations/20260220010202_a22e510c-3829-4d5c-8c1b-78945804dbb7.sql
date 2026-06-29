
-- Add geometry column to Batiment_poly
ALTER TABLE public."Batiment_poly" 
ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);

-- Create spatial index for fast lookups
CREATE INDEX IF NOT EXISTS idx_batiment_poly_geom 
ON public."Batiment_poly" USING GIST (geom);

-- Function to find building(s) at a given lat/lng point
CREATE OR REPLACE FUNCTION public.find_buildings_near_point(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision DEFAULT 50
)
RETURNS TABLE (
  fid bigint,
  id bigint,
  "Superficie" double precision,
  "Perimetre" double precision,
  distance_meters double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.fid,
    b.id,
    b."Superficie",
    b."Perimetre",
    ST_Distance(
      b.geom::geography,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) as distance_meters
  FROM public."Batiment_poly" b
  WHERE b.geom IS NOT NULL
    AND ST_DWithin(
      b.geom::geography,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_meters
    )
  ORDER BY distance_meters ASC
  LIMIT 5;
END;
$$;
