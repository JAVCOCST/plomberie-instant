-- ────────────────────────────────────────────────────────────────────────────
-- Migration : Vague A2 — colonnes MAMH + helper RPC idbati_from_no_lot
-- Date : 2026-06-07
-- Vague : quote-autofill A2
-- ────────────────────────────────────────────────────────────────────────────
-- Deux changements liés à l'autofill du wizard de soumission :
--
-- 1) Colonnes optionnelles ajoutées à `soumissions` pour persister les
--    champs auto-remplis depuis le rôle d'évaluation MAMH (via brikk FDW) :
--      - year_built          : année de construction
--      - dwelling_count      : nombre de logements
--      - floor_count         : nombre d'étages hors sol
--      - mamh_data_source    : audit trail ('brikk_mamh_2026' quand auto)
--
--    Toutes nullable + IF NOT EXISTS → totalement backward-compat avec les
--    67 soumissions existantes (snapshot pré-migration sha256 :
--    654859d7ab1ede164130660fa26cccc8e3699f96475eed1550b17f66405d7c95).
--
-- 2) RPC `public.idbati_from_no_lot(p_no_lot text) RETURNS text` qui
--    fait le lookup `idbati FROM batiment_avec_lot WHERE no_lot match`.
--    Indispensable parce que la table stocke no_lot avec espaces
--    (ex: "5 558 683") tandis que l'utilisateur peut taper sans espaces.
--    Le hook `useAutofillFromAddress` (livré en Vague A1) prend un idbati
--    en input — cette RPC produit cet idbati depuis le no_lot connu de
--    l'AdminQuoteGenerator.
--
-- Idempotente : IF NOT EXISTS + CREATE OR REPLACE partout.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonnes MAMH sur soumissions ───────────────────────────────────────
ALTER TABLE public.soumissions
  ADD COLUMN IF NOT EXISTS year_built       integer,
  ADD COLUMN IF NOT EXISTS dwelling_count   integer,
  ADD COLUMN IF NOT EXISTS floor_count      integer,
  ADD COLUMN IF NOT EXISTS mamh_data_source text;

COMMENT ON COLUMN public.soumissions.year_built IS
  'Année de construction MAMH auto-remplie via Brikk FDW (Vague A2). NULL si saisi manuellement ou non disponible.';
COMMENT ON COLUMN public.soumissions.dwelling_count IS
  'Nombre de logements MAMH. Sert à l''heuristique évents plomberie (cf. architecture-review-roofing-pipeline.md §8).';
COMMENT ON COLUMN public.soumissions.floor_count IS
  'Nombre d''étages hors sol MAMH. Sert à l''heuristique évents plomberie + composante complexité (cf. §7).';
COMMENT ON COLUMN public.soumissions.mamh_data_source IS
  'Audit trail : ''brikk_mamh_2026'' quand auto-rempli, NULL quand saisi manuellement. Permet de mesurer le taux d''autofill ex-post.';

-- ── 2. RPC idbati_from_no_lot ──────────────────────────────────────────────
-- Lookup de l'idbati depuis no_lot (matricule cadastre rénové) avec gestion
-- des deux formats : "5 558 683" (avec espaces) et "5558683" (sans).
DROP FUNCTION IF EXISTS public.idbati_from_no_lot(text);

CREATE FUNCTION public.idbati_from_no_lot(p_no_lot text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT idbati
  FROM public.batiment_avec_lot
  WHERE REPLACE(no_lot, ' ', '') = REPLACE(p_no_lot, ' ', '')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.idbati_from_no_lot(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.idbati_from_no_lot(text) FROM anon;

COMMENT ON FUNCTION public.idbati_from_no_lot(text) IS
  'Retourne idbati de batiment_avec_lot pour un no_lot donné (matching robuste avec/sans espaces). Utilisé par AdminQuoteGenerator (Vague A2) pour résoudre l''idbati à passer à useAutofillFromAddress.';
