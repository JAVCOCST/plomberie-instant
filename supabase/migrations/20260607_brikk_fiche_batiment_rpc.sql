-- ────────────────────────────────────────────────────────────────────────────
-- Migration : RPC fiche_batiment_complete (consommatrice du FDW Brikk)
-- Date : 2026-06-07
-- Vague : quote-autofill A1
-- ────────────────────────────────────────────────────────────────────────────
-- Crée la seule porte d'entrée publique vers les données MAMH (rôle
-- d'évaluation foncière) importées via le FDW Brikk Finance.
--
-- Spec exacte : docs/architecture-review-roofing-pipeline.md §6.1
-- Doc FDW    : docs/external-schemas.md
--
-- Pattern : SECURITY DEFINER + search_path explicite (public, brikk) qui
-- permet à la RPC de lire `brikk.*` sans exposer le schéma via PostgREST.
--
-- Comportement gracieux : si le FDW Brikk n'est pas attaché côté DB (cas
-- `db reset` ou nouvel environnement avant la procédure manuelle de §5
-- de external-schemas.md), la RPC retourne quand même un objet
--   { batiment: {...}, immeuble: null, municipalite: null }
-- au lieu de crasher. Le front (étapes 1-2-3 du devis) doit gérer ce cas.
--
-- Idempotente : CREATE OR REPLACE — peut être appliquée plusieurs fois.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. La RPC ──────────────────────────────────────────────────────────────
-- Nettoyage défensif : on drop d'abord pour permettre une signature
-- légèrement différente lors d'une future itération sans devoir gérer
-- manuellement les CASCADE. La RPC est consommée uniquement par le hook
-- useAutofillFromAddress (à créer Vague A1) — pas de dépendance côté DB.
DROP FUNCTION IF EXISTS public.fiche_batiment_complete(text);

CREATE FUNCTION public.fiche_batiment_complete(p_idbati text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, brikk
AS $$
DECLARE
  v_result jsonb;
  v_has_brikk boolean;
BEGIN
  -- Garde-fou : si le schéma brikk n'est pas attaché (FDW absent), on
  -- retourne quand même les infos batiment local + null pour le reste.
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.foreign_tables
    WHERE foreign_table_schema = 'brikk'
      AND foreign_table_name = 'immeubles_unified'
  ) INTO v_has_brikk;

  IF v_has_brikk THEN
    SELECT jsonb_build_object(
      'batiment',     to_jsonb(bal.*),
      'immeuble',     CASE WHEN iu.matricule IS NOT NULL THEN to_jsonb(iu.*) ELSE NULL END,
      'municipalite', CASE WHEN m.code_geographique IS NOT NULL THEN to_jsonb(m.*) ELSE NULL END
    )
    INTO v_result
    FROM public.batiment_avec_lot bal
    LEFT JOIN brikk.immeubles_unified iu
           ON iu.matricule = REPLACE(bal.no_lot, ' ', '')
    LEFT JOIN brikk.municipalites_qc m
           ON m.code_geographique = iu.code_geo_municipalite
    WHERE bal.idbati = p_idbati
    LIMIT 1;
  ELSE
    -- FDW absent : on prend juste le batiment local, immeuble/municipalite NULL.
    SELECT jsonb_build_object(
      'batiment',     to_jsonb(bal.*),
      'immeuble',     NULL,
      'municipalite', NULL
    )
    INTO v_result
    FROM public.batiment_avec_lot bal
    WHERE bal.idbati = p_idbati
    LIMIT 1;
  END IF;

  RETURN v_result;
END;
$$;

-- ── 2. Grants ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.fiche_batiment_complete(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fiche_batiment_complete(text) FROM anon;

-- ── 3. Documentation interne ───────────────────────────────────────────────
COMMENT ON FUNCTION public.fiche_batiment_complete(text) IS
  'Retourne batiment + immeuble MAMH + municipalité pour un idbati. '
  'Source de vérité immeuble : brikk.immeubles_unified via FDW Brikk Finance. '
  'Si FDW absent : retourne juste batiment local (immeuble/municipalite null). '
  'Spec : docs/architecture-review-roofing-pipeline.md §6.1';
