-- RPC consommé par l'edge function training-batch-generate.
-- Retourne un échantillon random de bâtiments avec leur centroid lat/lng
-- et leur géométrie en GeoJSON projection 4326.
--
-- SECURITY DEFINER : pour que la fonction puisse être appelée depuis
-- l'edge function sans nécessiter de policy custom sur batiment_avec_lot.

CREATE OR REPLACE FUNCTION public.sample_buildings_random(
  p_limit integer DEFAULT 100,
  p_city  text    DEFAULT NULL
)
RETURNS TABLE (
  id        integer,
  lat       double precision,
  lng       double precision,
  geojson   text,
  no_lot    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH centroids AS (
    SELECT b.id,
           ST_AsGeoJSON(ST_Transform(b.geom_batiment, 4326))::text AS geojson_text,
           ST_Centroid(ST_Transform(b.geom_batiment, 4326)) AS pt,
           b.no_lot
    FROM batiment_avec_lot b
    WHERE b.geom_batiment IS NOT NULL
      AND (p_city IS NULL OR b.eval_municipalite ILIKE '%' || p_city || '%')
  )
  SELECT c.id::integer,
         ST_Y(c.pt)::double precision AS lat,
         ST_X(c.pt)::double precision AS lng,
         c.geojson_text AS geojson,
         c.no_lot::text
  FROM centroids c
  ORDER BY random()
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sample_buildings_random(integer, text)
  TO service_role, authenticated;
