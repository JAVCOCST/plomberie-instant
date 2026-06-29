-- Fix : eval_municipalite est NULL sur 100% des bâtiments (l'import des
-- données d'évaluation municipale n'a jamais été fait). On bascule le RPC
-- sample_buildings_random sur un filtre SPATIAL avec un catalogue de villes
-- connues (centroid + rayon).
--
-- Nouveau comportement de p_city :
--   - NULL ou ''     → pas de filtre (tout le QC)
--   - ville connue  → filtre spatial ST_DWithin 8 km du centre
--   - ville inconnue → renvoie 0 lignes (signal au caller)

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
DECLARE
  v_center geography := NULL;
  v_radius double precision := 8000;
  v_city_lower text := lower(trim(coalesce(p_city, '')));
BEGIN
  v_center := CASE v_city_lower
    WHEN ''             THEN NULL
    WHEN 'granby'       THEN ST_SetSRID(ST_MakePoint(-72.7333, 45.4000), 4326)::geography
    WHEN 'cowansville'  THEN ST_SetSRID(ST_MakePoint(-72.7440, 45.2090), 4326)::geography
    WHEN 'bromont'      THEN ST_SetSRID(ST_MakePoint(-72.6519, 45.3170), 4326)::geography
    WHEN 'waterloo'     THEN ST_SetSRID(ST_MakePoint(-72.5160, 45.3440), 4326)::geography
    WHEN 'sutton'       THEN ST_SetSRID(ST_MakePoint(-72.6110, 45.1030), 4326)::geography
    WHEN 'st-hyacinthe' THEN ST_SetSRID(ST_MakePoint(-72.9560, 45.6300), 4326)::geography
    WHEN 'saint-hyacinthe' THEN ST_SetSRID(ST_MakePoint(-72.9560, 45.6300), 4326)::geography
    WHEN 'magog'        THEN ST_SetSRID(ST_MakePoint(-72.1430, 45.2680), 4326)::geography
    WHEN 'sherbrooke'   THEN ST_SetSRID(ST_MakePoint(-71.8830, 45.4040), 4326)::geography
    ELSE NULL
  END;

  IF v_city_lower <> '' AND v_center IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH centroids AS (
    SELECT b.id,
           ST_AsGeoJSON(ST_Transform(b.geom_batiment, 4326))::text AS geojson_text,
           ST_Centroid(ST_Transform(b.geom_batiment, 4326)) AS pt,
           b.no_lot
    FROM batiment_avec_lot b
    WHERE b.geom_batiment IS NOT NULL
      AND (v_center IS NULL
           OR ST_DWithin(b.geom_batiment::geography, v_center, v_radius))
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
