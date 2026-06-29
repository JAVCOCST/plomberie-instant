
DROP FUNCTION IF EXISTS public.find_building_polygon(double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.find_building_polygon(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision DEFAULT 50
)
RETURNS TABLE(
  id bigint,
  geojson text,
  superficie double precision,
  perimetre double precision,
  distance_meters double precision,
  largeur double precision,
  profondeur double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point geometry;
BEGIN
  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  RETURN QUERY
  WITH nearest AS (
    SELECT
      b.id::bigint,
      ST_AsGeoJSON(b.geom)::text AS geojson,
      b.superficie,
      b.perimetre,
      ST_Distance(b.geom::geography, v_point::geography) AS distance_meters,
      b.geom
    FROM batiment_poly_temp b
    WHERE ST_DWithin(b.geom::geography, v_point::geography, p_radius_meters)
    ORDER BY ST_Distance(b.geom::geography, v_point::geography)
    LIMIT 1
  ),
  dims AS (
    SELECT
      n.*,
      ST_OrientedEnvelope(n.geom) AS obb
    FROM nearest n
  ),
  sides AS (
    SELECT
      d.*,
      ST_Distance(
        ST_Transform(ST_PointN(ST_ExteriorRing(d.obb), 1), 32198),
        ST_Transform(ST_PointN(ST_ExteriorRing(d.obb), 2), 32198)
      ) AS side_a,
      ST_Distance(
        ST_Transform(ST_PointN(ST_ExteriorRing(d.obb), 2), 32198),
        ST_Transform(ST_PointN(ST_ExteriorRing(d.obb), 3), 32198)
      ) AS side_b
    FROM dims d
  )
  SELECT
    s.id,
    s.geojson,
    s.superficie,
    s.perimetre,
    s.distance_meters,
    ROUND(LEAST(s.side_a, s.side_b)::numeric, 2)::double precision AS largeur,
    ROUND(GREATEST(s.side_a, s.side_b)::numeric, 2)::double precision AS profondeur
  FROM sides s;
END;
$$;
