
DROP FUNCTION IF EXISTS public.find_building_polygon(double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.find_building_polygon(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision DEFAULT 100
)
RETURNS TABLE(
  id bigint,
  geojson text,
  lot_geojson text,
  no_lot text,
  superficie double precision,
  perimetre double precision,
  distance_meters double precision,
  largeur double precision,
  profondeur double precision
)
LANGUAGE plpgsql
STABLE
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
      b.id::bigint AS bid,
      ST_AsGeoJSON(b.geom_batiment)::text AS bat_geojson,
      ST_AsGeoJSON(b.geom_lot)::text AS lt_geojson,
      b.no_lot AS lot_no,
      b.superficie AS sup,
      b.perimetre AS peri,
      ST_Distance(b.geom_lot::geography, v_point::geography) AS dist,
      b.geom_batiment
    FROM batiment_avec_lot b
    WHERE ST_DWithin(b.geom_lot::geography, v_point::geography, p_radius_meters)
    ORDER BY ST_Distance(b.geom_lot::geography, v_point::geography)
    LIMIT 1
  ),
  dims AS (
    SELECT
      n.*,
      ST_OrientedEnvelope(n.geom_batiment) AS obb
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
    s.bid,
    s.bat_geojson,
    s.lt_geojson,
    s.lot_no,
    s.sup,
    s.peri,
    s.dist,
    ROUND(LEAST(s.side_a, s.side_b)::numeric, 2)::double precision,
    ROUND(GREATEST(s.side_a, s.side_b)::numeric, 2)::double precision
  FROM sides s;
END;
$$;
