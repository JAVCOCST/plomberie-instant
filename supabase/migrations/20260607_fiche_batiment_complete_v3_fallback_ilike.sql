-- ────────────────────────────────────────────────────────────────────────────
-- Migration : Vague A2.1 — fiche_batiment_complete v3 (fallback ILIKE)
-- Date : 2026-06-07
-- Vague : quote-autofill A2.1
-- ────────────────────────────────────────────────────────────────────────────
-- CONTEXTE (v3, après brief de l'autre Claude Brikk) :
--
-- Stats sur les 253 928 rows de `brikk.immeubles_unified` :
--   - civique         remplie  9.96%
--   - civique_min     remplie 75.6%   ← sauvera la v2 pour la majorité
--   - civique_max     remplie 75.6%
--   - ville           remplie  0.015% (!) → inutilisable pour matching
--   - rue             remplie 99.99%
--   - adresse_complete remplie 99.99%
--
-- La v2 marchait pour ~76% des bâtiments (via civique_min). Pour les 24%
-- restants (qui n'ont ni civique ni civique_min), on ajoute un 3e chemin :
-- ILIKE pur sur `adresse_complete` avec un pattern construit (civique + nom
-- de rue + ville). Le format de adresse_complete est globalement standard
-- Google ("546 Rue Trépanier, Granby, QC, Canada") donc l'ILIKE matche.
--
-- 4 chemins de matching par ordre de précision décroissante :
--   (A) civique exact + rue + ville-in-adresse        ~10% rows
--   (B) civique_min exact + rue + ville-in-adresse    ~75% rows
--   (C) Fallback ILIKE pur sur adresse_complete       ~24% restants
--   (D) Legacy matricule = no_lot sans espaces        ~0% (conservé)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fiche_batiment_complete(
  p_idbati text,
  p_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, brikk
AS $$
DECLARE
  v_result jsonb;
  v_has_brikk boolean;
  v_civique text;
  v_nom_rue text;
  v_ville text;
  v_accent_from text := 'éèêëàâäîïôöûüçÉÈÊËÀÂÄÎÏÔÖÛÜÇ';
  v_accent_to   text := 'eeeeaaaiioouucEEEEAAAIIOOUUC';
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.foreign_tables
    WHERE foreign_table_schema = 'brikk'
      AND foreign_table_name = 'immeubles_unified'
  ) INTO v_has_brikk;

  IF NOT v_has_brikk THEN
    SELECT jsonb_build_object(
      'batiment',     to_jsonb(bal.*),
      'immeuble',     NULL,
      'municipalite', NULL
    )
    INTO v_result
    FROM public.batiment_avec_lot bal
    WHERE bal.idbati = p_idbati
    LIMIT 1;
    RETURN v_result;
  END IF;

  -- Parsing adresse Google Autocomplete
  IF p_address IS NOT NULL THEN
    v_civique := substring(p_address from '^\s*(\d+)');
    v_nom_rue := substring(
      p_address
      from '^\s*\d+\s+(?:Rue|RUE|Avenue|Av\.?|Boulevard|Boul\.?|Chemin|Ch\.?|Place|Pl\.?|Terrasse|Te\.?|Route|Rte\.?|Allée|All\.?)\s+([^,]+?)\s*,'
    );
    v_ville := trim(both ' ' from split_part(p_address, ',', 2));
  END IF;

  SELECT jsonb_build_object(
    'batiment',     to_jsonb(bal.*),
    'immeuble',     CASE WHEN iu.matricule IS NOT NULL THEN to_jsonb(iu.*) ELSE NULL END,
    'municipalite', CASE WHEN m.code_geographique IS NOT NULL THEN to_jsonb(m.*) ELSE NULL END
  )
  INTO v_result
  FROM public.batiment_avec_lot bal
  LEFT JOIN LATERAL (
    SELECT *
    FROM brikk.immeubles_unified iu_sub
    WHERE
      -- (A) + (B) : structured match civique/civique_min + rue + ville-in-adresse
      (
        p_address IS NOT NULL
        AND v_civique IS NOT NULL
        AND v_nom_rue IS NOT NULL
        AND v_ville IS NOT NULL
        AND translate(lower(coalesce(iu_sub.rue, '')), v_accent_from, v_accent_to)
            ILIKE '%' || translate(lower(v_nom_rue), v_accent_from, v_accent_to) || '%'
        AND translate(lower(coalesce(iu_sub.adresse_complete, '')), v_accent_from, v_accent_to)
            ILIKE '%' || lower(v_ville) || '%'
        AND (
          iu_sub.civique = v_civique
          OR iu_sub.civique_min = v_civique
          OR (
            iu_sub.civique_min ~ '^\d+$' AND iu_sub.civique_max ~ '^\d+$'
            AND v_civique ~ '^\d+$'
            AND iu_sub.civique_min::int <= v_civique::int
            AND iu_sub.civique_max::int >= v_civique::int
          )
        )
      )
      -- (C) Fallback ILIKE pur sur adresse_complete — pour les 24% sans civique
      OR (
        p_address IS NOT NULL
        AND v_civique IS NOT NULL
        AND v_nom_rue IS NOT NULL
        AND v_ville IS NOT NULL
        AND translate(lower(coalesce(iu_sub.adresse_complete, '')), v_accent_from, v_accent_to)
            ILIKE v_civique || ' %' || translate(lower(v_nom_rue), v_accent_from, v_accent_to) || '%, ' || lower(v_ville) || '%'
      )
      -- (D) Legacy matricule (~0% mais on garde au cas)
      OR iu_sub.matricule = REPLACE(bal.no_lot, ' ', '')
    ORDER BY
      CASE
        WHEN iu_sub.civique = v_civique THEN 1
        WHEN iu_sub.civique_min = v_civique THEN 2
        WHEN translate(lower(coalesce(iu_sub.adresse_complete, '')), v_accent_from, v_accent_to)
             ILIKE v_civique || ' %' || translate(lower(v_nom_rue), v_accent_from, v_accent_to) || '%, ' || lower(v_ville) || '%' THEN 3
        WHEN iu_sub.matricule = REPLACE(bal.no_lot, ' ', '') THEN 5
        ELSE 4
      END,
      iu_sub.matricule
    LIMIT 1
  ) iu ON true
  LEFT JOIN brikk.municipalites_qc m
         ON m.code_geographique = iu.code_geo_municipalite
  WHERE bal.idbati = p_idbati
  LIMIT 1;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.fiche_batiment_complete(text, text) IS
  'Vague A2.1 v3 : matching 4-paths (civique exact, civique_min, ILIKE adresse_complete, matricule legacy). Couverture estimée ~99% des bâtiments Brikk vs ~0% avec le matching v1 par matricule.';
