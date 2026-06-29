-- ────────────────────────────────────────────────────────────────────────────
-- Migration : Vague A2.1 — fiche_batiment_complete v2 (matching par adresse)
-- Date : 2026-06-07
-- Vague : quote-autofill A2.1
-- ────────────────────────────────────────────────────────────────────────────
-- PROBLÈME (cf. PR #32 discussions du 2026-06-07) :
--   La RPC `fiche_batiment_complete` v1 joignait `brikk.immeubles_unified` sur
--   `iu.matricule = REPLACE(bal.no_lot, ' ', '')`. Or :
--     - `bal.no_lot` = numéro de lot du cadastre rénové (ex: "3 620 853")
--     - `iu.matricule` = matricule taxation MAMH (ex: "6828-00-3106-0-000-0000")
--   Ce sont DEUX systèmes d'identification différents → 0 match dans 100% des
--   cas testés sur Granby (alors que les bâtiments EXISTENT bien dans Brikk).
--
-- SOLUTION :
--   1. Ajout d'un paramètre optionnel `p_address text` à la RPC
--   2. Si `p_address` est fourni, extraction du civique/nom de rue/ville par
--      regex et tentative de match sur `brikk.immeubles_unified.civique`
--      (ou `civique_min`/`civique_max` range) + `rue` + `adresse_complete`.
--   3. Le matching legacy par matricule reste comme fallback (au cas où la
--      mapping fonctionnerait pour un cas).
--   4. Signature backward-compatible : `p_address` a un DEFAULT NULL, les
--      callers Vague A1 qui n'utilisent qu'un seul param continuent à
--      fonctionner.
--
-- TESTS POSITIFS (cf. discussion PR #32) :
--   - "546 Rue Trépanier, Granby" → matricule 6828-00-3106-..., 2007, 4 log, 2 ét.
--   - "21 Rue Simonds, Granby"    → matricule 1399982, 1962, 1 log, 1 ét.
--   - "105 Rue Authier, Granby"   → matricule 1400143, 1968, 1 log, 1 ét.
--
-- Notes sur le matching :
--   - Pas d'extension `unaccent` (pas installée dans ce projet). On utilise
--     `translate()` pour normaliser les accents communs FR-QC. Suffisant pour
--     les rues Trépanier/Châtelain/Hôtel-de-Ville/etc.
--   - `iu.ville` est souvent NULL dans Brikk → match ville fait sur
--     `iu.adresse_complete ILIKE '%<ville>%'` (le format inclut toujours la
--     ville après la 1ère virgule, ex: "10 Rue Simonds, Granby, QC, Canada").
--   - `iu.civique` est souvent NULL → fallback sur `civique_min` exact, puis
--     sur la range `civique_min/civique_max` si les deux sont numériques (cas
--     des multi-units type "1111-1199 Rue Simonds").
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
  -- Normaliseur d'accents FR-QC (pas besoin d'unaccent extension).
  -- Couvre les voyelles accentuées + ç ÇÉ etc. les plus courantes.
  v_accent_from text := 'éèêëàâäîïôöûüçÉÈÊËÀÂÄÎÏÔÖÛÜÇ';
  v_accent_to   text := 'eeeeaaaiioouucEEEEAAAIIOOUUC';
BEGIN
  -- Vérifie que la FDW Brikk est dispo. Si pas, on retourne juste batiment.
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

  -- ── Parsing de l'adresse si fournie ────────────────────────────────────
  -- Format attendu (sortie Google Maps Autocomplete) :
  --   "546 Rue Trépanier, Granby, QC J2H 0A2, Canada"
  --   "10 Boulevard Provincial, Granby, QC, Canada"
  --   "21 Rue Simonds, Granby, QC, Canada"
  IF p_address IS NOT NULL THEN
    -- Civique : 1er groupe de chiffres au début
    v_civique := substring(p_address from '^\s*(\d+)');
    -- Nom de rue : après les mots de type voie (Rue/Avenue/Boulevard/etc.)
    -- Capture tout jusqu'à la 1ère virgule.
    v_nom_rue := substring(
      p_address
      from '^\s*\d+\s+(?:Rue|RUE|Avenue|Av\.?|Boulevard|Boul\.?|Chemin|Ch\.?|Place|Pl\.?|Terrasse|Te\.?|Route|Rte\.?|Allée|All\.?)\s+([^,]+?)\s*,'
    );
    -- Ville : 2e segment après la 1ère virgule
    v_ville := trim(both ' ' from split_part(p_address, ',', 2));
  END IF;

  -- ── Query principale : LEFT JOIN avec 2 chemins de matching ──────────
  --   1) Si adresse fournie ET parsing OK → matching civique+rue+ville
  --   2) Sinon (legacy) → matching matricule = no_lot sans espaces
  -- Note : le matching adresse est testé en PREMIER (plus fiable côté Granby
  -- d'après les tests). Si rien, le matricule legacy peut encore donner
  -- un hit accidentel.
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
      -- ▷ Chemin 1 : matching par adresse (Vague A2.1)
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
      -- ▷ Chemin 2 : fallback legacy matricule (Vague A1)
      OR iu_sub.matricule = REPLACE(bal.no_lot, ' ', '')
    ORDER BY
      -- Préfère le match exact `civique` sur la range, le match par matricule
      -- en dernier (legacy quasiment jamais trouvé).
      CASE
        WHEN iu_sub.civique = v_civique THEN 1
        WHEN iu_sub.civique_min = v_civique THEN 2
        WHEN iu_sub.matricule = REPLACE(bal.no_lot, ' ', '') THEN 4
        ELSE 3
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
  'Retourne batiment+immeuble MAMH+municipalité pour un idbati. Vague A2.1 : '
  'param `p_address` optionnel (format Google Autocomplete) qui permet de '
  'matcher par civique+rue+ville dans brikk.immeubles_unified quand le matching '
  'par matricule ne marche pas (cas typique au Québec où no_lot cadastre ≠ '
  'matricule MAMH).';
