
CREATE OR REPLACE FUNCTION public.find_building_polygon(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision DEFAULT 50
)
RETURNS TABLE (
  id integer,
  superficie double precision,
  perimetre double precision,
  distance_meters double precision,
  geojson text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.superficie,
    t.perimetre,
    ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_meters,
    ST_AsGeoJSON(t.geom) AS geojson
  FROM batiment_poly_temp t
  WHERE ST_DWithin(
    t.geom::geography,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    p_radius_meters
  )
  ORDER BY distance_meters
  LIMIT 1;
$$;
