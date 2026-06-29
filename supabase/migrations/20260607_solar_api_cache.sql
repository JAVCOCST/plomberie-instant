-- ────────────────────────────────────────────────────────────────────────────
-- Migration : solar_api_cache + solar_api_calls
-- Date : 2026-06-07
-- Vague : quote-autofill A1
-- ────────────────────────────────────────────────────────────────────────────
-- Tables d'infrastructure pour l'edge function `solar-api` (prod) :
--
-- solar_api_cache : cache à clé geohash. Évite de re-payer Google Solar API
--   pour des adresses déjà consultées (ré-ouvertures de devis, dev/test
--   interne, retours arrière utilisateur).
--
-- solar_api_calls : journal de chaque appel (hit cache ou fetch Google).
--   Permet de tracker le quota Google, mesurer la latence, identifier les
--   callers, alerter à 80 % du quota mensuel.
--
-- Spec exacte : docs/architecture-review-roofing-pipeline.md §9.1
--
-- RLS activée + policies service_role only. Le cache n'est jamais lu/écrit
-- directement par le front — uniquement par l'edge function (qui utilise
-- la service_role key).
--
-- Idempotente : CREATE TABLE IF NOT EXISTS partout.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Table solar_api_cache ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solar_api_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  -- Geohash à précision ~50m (longueur 7). Deux lat/lng dans le même
  -- bloc de 50m partagent la même réponse Solar (le bâtiment est le même).
  geohash     text NOT NULL,
  -- Réponse complète de l'edge function solar-api (summary + segments + raw).
  -- jsonb pour pouvoir requêter des champs précis sans deserializer.
  response    jsonb NOT NULL,
  -- Quality enregistré séparément pour pouvoir filtrer (ex. invalider les
  -- entrées BASE quand on veut un nouveau pull HIGH).
  quality     text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (geohash)
);

CREATE INDEX IF NOT EXISTS idx_solar_cache_geohash
  ON public.solar_api_cache(geohash);

CREATE INDEX IF NOT EXISTS idx_solar_cache_fetched_at
  ON public.solar_api_cache(fetched_at DESC);

ALTER TABLE public.solar_api_cache ENABLE ROW LEVEL SECURITY;

-- service_role only : le front ne touche jamais le cache directement.
CREATE POLICY "service_role read solar_api_cache"
  ON public.solar_api_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "service_role insert solar_api_cache"
  ON public.solar_api_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "service_role update solar_api_cache"
  ON public.solar_api_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role delete solar_api_cache"
  ON public.solar_api_cache FOR DELETE TO service_role USING (true);

COMMENT ON TABLE public.solar_api_cache IS
  'Cache des réponses Google Solar API par geohash (~50m). '
  'Écrit/lu uniquement par l''edge function solar-api (service_role). '
  'Élimine ~80 % des appels payants. Voir architecture-review-roofing-pipeline.md §9.1.';

-- ── 2. Table solar_api_calls (journal) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solar_api_calls (
  id          bigserial PRIMARY KEY,
  called_at   timestamptz NOT NULL DEFAULT now(),
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  -- HTTP status renvoyé par Google (200, 404, 429…). null pour erreur réseau.
  http_status integer,
  quality     text,
  n_segments  integer,
  latency_ms  integer,
  cache_hit   boolean NOT NULL DEFAULT false,
  -- Identifiant fonctionnel de l'appelant. Valeurs prévues :
  --   'admin_quote'    : flux étapes 1-2-3 (Vague A2)
  --   'training_lab'   : vue diff Solar QA (futur)
  --   'solar_viewer'   : POC viewer 3D
  --   'edge_test'      : appels manuels via solar-api-test
  caller      text
);

CREATE INDEX IF NOT EXISTS idx_solar_calls_called_at
  ON public.solar_api_calls(called_at DESC);

CREATE INDEX IF NOT EXISTS idx_solar_calls_caller
  ON public.solar_api_calls(caller);

CREATE INDEX IF NOT EXISTS idx_solar_calls_cache_hit
  ON public.solar_api_calls(cache_hit);

ALTER TABLE public.solar_api_calls ENABLE ROW LEVEL SECURITY;

-- service_role only en écriture. Lecture autorisée pour authenticated
-- pour permettre un dashboard interne de monitoring du quota (Vague B).
CREATE POLICY "service_role insert solar_api_calls"
  ON public.solar_api_calls FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "authenticated read solar_api_calls"
  ON public.solar_api_calls FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.solar_api_calls IS
  'Journal de chaque appel à l''edge function solar-api (hit cache ou fetch Google). '
  'Sert au monitoring de quota et à l''observabilité. '
  'Voir architecture-review-roofing-pipeline.md §9.1.';
