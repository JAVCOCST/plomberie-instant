/**
 * solar-api
 * =========
 *
 * Endpoint de production pour Google Solar API (buildingInsights:findClosest).
 *
 * Différences vs `solar-api-test` (qui reste comme outil de dev) :
 *   1. Cache disque par geohash (~50m) → `solar_api_cache` table
 *      Élimine les ré-appels Google sur la même adresse (ré-ouvertures
 *      de devis, dev/test interne, retour arrière utilisateur).
 *   2. Journal de chaque appel → `solar_api_calls` table
 *      Pour monitoring du quota Google + observabilité.
 *   3. Output STRICTEMENT identique à `solar-api-test` (même shape) →
 *      backward-compat avec le viewer Solar 3D et le frontend.
 *
 * Conservé tel quel :
 *   - runAdminGuards (admin uniquement)
 *   - Hack referer pour bypass restriction *.toituresvb.ca/* sur la clé Maps
 *   - Pré-digestion des segments
 *
 * Spec : docs/architecture-review-roofing-pipeline.md §1.4, §9.1
 * Tables : 20260607_solar_api_cache.sql
 *
 * Input :
 *   {
 *     latitude: number,
 *     longitude: number,
 *     api_key?: string,
 *     caller?: 'admin_quote' | 'training_lab' | 'solar_viewer' | 'edge_test',
 *     force_refresh?: boolean   // skip le cache, force un fetch Google
 *   }
 *
 * Output : identique à solar-api-test (cf. fichier voisin).
 *   { ok: true, summary, segments, raw, cache_hit?: boolean }
 *
 * Caller default : 'admin_quote' (le consommateur principal en Vague A2).
 */
import { cors, runAdminGuards } from "../_shared/hardening.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

interface ApiPayload {
  latitude: number;
  longitude: number;
  api_key?: string;
  caller?: string;
  force_refresh?: boolean;
}

const VALID_CALLERS = new Set([
  "admin_quote",
  "training_lab",
  "solar_viewer",
  "edge_test",
]);

/**
 * Geohash encoder — précision ~50m avec longueur 7.
 *
 * Implémentation minimale (algorithme classique de Niemeyer 2008). On ne
 * dépend pas d'une lib externe : on garde l'edge function fully self-contained
 * et déterministe.
 *
 * Précision approximative par longueur :
 *   length=5 → ~5 km
 *   length=6 → ~600 m
 *   length=7 → ~76 m   ← utilisé ici
 *   length=8 → ~19 m
 *
 * 50m est le bon compromis : un bâtiment fait typiquement 10-30m. Deux
 * lat/lng à moins de 50m ciblent le même bâtiment.
 */
const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
function geohashEncode(lat: number, lng: number, precision = 7): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let bit = 0;
  let ch = 0;
  let isEven = true;
  let result = "";
  while (result.length < precision) {
    if (isEven) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngMin = mid; }
      else            { ch = (ch << 1);     lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; }
      else            { ch = (ch << 1);     latMax = mid; }
    }
    isEven = !isEven;
    bit++;
    if (bit === 5) {
      result += GEOHASH_BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return result;
}

function svcClient() {
  // service_role uniquement (cache + journal sont protégés en RLS).
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

interface SolarDigested {
  ok: true;
  summary: {
    n_segments: number;
    total_area_m2: number;
    imagery_quality: string | null;
    imagery_date: string | null;
    imagery_processed_date: string | null;
    name: string | null;
    region_code: string | null;
  };
  segments: Array<{
    pitch_deg: number | null;
    azimuth_deg: number | null;
    area_m2: number | null;
    center: { lat: number; lng: number } | null;
    bbox: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null;
  }>;
  raw: unknown;
}

function digestSolarResponse(data: unknown): SolarDigested {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  const segments = Array.isArray(d?.solarPotential?.roofSegmentStats)
    ? d.solarPotential.roofSegmentStats
    : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const total_area_m2 = segments.reduce((sum: number, s: any) => sum + (s.stats?.areaMeters2 || 0), 0);
  const summary = {
    n_segments: segments.length,
    total_area_m2: Math.round(total_area_m2 * 100) / 100,
    imagery_quality: d?.imageryQuality || null,
    imagery_date: d?.imageryDate
      ? `${d.imageryDate.year}-${String(d.imageryDate.month || 1).padStart(2, "0")}-${String(d.imageryDate.day || 1).padStart(2, "0")}`
      : null,
    imagery_processed_date: d?.imageryProcessedDate
      ? `${d.imageryProcessedDate.year}-${String(d.imageryProcessedDate.month || 1).padStart(2, "0")}`
      : null,
    name: d?.name || null,
    region_code: d?.regionCode || null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segmentsLite = segments.map((s: any) => ({
    pitch_deg: s.pitchDegrees ?? null,
    azimuth_deg: s.azimuthDegrees ?? null,
    area_m2: s.stats?.areaMeters2 ? Math.round(s.stats.areaMeters2 * 100) / 100 : null,
    center: s.center ? { lat: s.center.latitude, lng: s.center.longitude } : null,
    bbox: s.boundingBox ? {
      sw: { lat: s.boundingBox.sw.latitude, lng: s.boundingBox.sw.longitude },
      ne: { lat: s.boundingBox.ne.latitude, lng: s.boundingBox.ne.longitude },
    } : null,
  }));
  return { ok: true, summary, segments: segmentsLite, raw: data };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers fail-safe pour les écritures Supabase (Vague A2.1)
//
// Le journal `solar_api_calls` et le cache `solar_api_cache` sont du
// "best-effort" : si l'écriture échoue, on log mais on ne fait JAMAIS
// échouer la réponse Solar côté client. Cache miss > fonction qui crashe.
// ────────────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function safeJournal(sb: any, row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await sb.from("solar_api_calls").insert(row);
    if (error) console.error("[solar-api] journal insert error:", error.message, "row=", JSON.stringify(row));
  } catch (e) {
    console.error("[solar-api] journal insert threw:", e instanceof Error ? e.message : String(e));
  }
}

// deno-lint-ignore no-explicit-any
async function safeCacheUpsert(sb: any, row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await sb.from("solar_api_cache").upsert(row, { onConflict: "geohash" });
    if (error) console.error("[solar-api] cache upsert error:", error.message);
  } catch (e) {
    console.error("[solar-api] cache upsert threw:", e instanceof Error ? e.message : String(e));
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, requestedHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ──────────────────────────────────────────────────────────────────────
  // Vague A2.1 — Wrapper try/catch global pour TOUTE exception non-gérée.
  // Avant ce wrap, n'importe quel `throw` (cache, fetch, parse, json) pouvait
  // remonter au runtime Deno et générer un 500 silencieux sans body utile.
  // Maintenant on log + on retourne une réponse structurée.
  // ──────────────────────────────────────────────────────────────────────
  try {
    const guardResp = await runAdminGuards(req, corsHeaders);
    if (guardResp) return guardResp;

    let body: ApiPayload;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return new Response(JSON.stringify({ error: "latitude/longitude invalides", got: { latitude: body.latitude, longitude: body.longitude } }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = (body.api_key || Deno.env.get("GOOGLE_MAPS_API_KEY") || "").trim();
    if (!apiKey) {
      console.error("[solar-api] GOOGLE_MAPS_API_KEY missing in env and no api_key in body.");
      return new Response(JSON.stringify({
        ok: false,
        error: "GOOGLE_MAPS_API_KEY missing on server. Configure the secret in Supabase edge functions or pass api_key in the request body.",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const caller = VALID_CALLERS.has(body.caller ?? "")
      ? body.caller!
      : "admin_quote";
    const forceRefresh = body.force_refresh === true;

    const geohash = geohashEncode(lat, lng, 7);
    const startedAt = Date.now();
    console.log(`[solar-api] req lat=${lat} lng=${lng} geohash=${geohash} caller=${caller} force=${forceRefresh}`);
    const sb = svcClient();

    // ── 1. Check cache (sauf si force_refresh) ───────────────────────────
    if (!forceRefresh) {
      try {
        const { data: cached, error: cacheErr } = await sb
          .from("solar_api_cache")
          .select("response, quality")
          .eq("geohash", geohash)
          .maybeSingle();

        if (cacheErr) {
          console.warn("[solar-api] cache read error:", cacheErr.message);
        }

        if (cached?.response) {
          const latency = Date.now() - startedAt;
          const cachedResp = cached.response as SolarDigested;
          // Journal cache hit (fail-safe — on log mais on continue)
          await safeJournal(sb, {
            lat, lng,
            http_status: 200,
            quality: cached.quality,
            n_segments: cachedResp.summary?.n_segments ?? null,
            latency_ms: latency,
            cache_hit: true,
            caller,
          });
          return new Response(JSON.stringify({ ...cachedResp, cache_hit: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        // Pas de cache lookup possible (table absente, RLS bloque, etc.) → on continue avec Google direct.
        console.warn("[solar-api] cache lookup threw:", e instanceof Error ? e.message : String(e));
      }
    }

    // ── 2. Fetch Google Solar API ────────────────────────────────────────
    // Vague A2.1 fix : `requiredQuality=LOW` au lieu de HIGH.
    // HIGH forçait Google à 404 NOT_FOUND si l'imagery HIGH n'était pas
    // disponible pour cette zone (cas Granby + nombreuses petites villes
    // du Québec). LOW = "donne-moi la meilleure qualité disponible" et
    // Google retourne HIGH ou MEDIUM ou LOW selon ce qu'il a. La shape de
    // la réponse est identique, le frontend lit `summary.imagery_quality`
    // pour savoir ce qu'il a obtenu.
    const googleUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest`
      + `?location.latitude=${lat}&location.longitude=${lng}`
      + `&requiredQuality=LOW`
      + `&key=${apiKey}`;

    let resp: Response;
    try {
      // Hack referer pour bypass la restriction "HTTP referrers" de la clé
      // Google Maps (limitée à *.toituresvb.ca/*). Sans ça, Google répond
      // "Requests from referer <empty> are blocked".
      resp = await fetch(googleUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: { "Referer": "https://soumission.toituresvb.ca/" },
      });
    } catch (e) {
      const latency = Date.now() - startedAt;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[solar-api] Google fetch threw:", msg);
      await safeJournal(sb, {
        lat, lng,
        http_status: null,
        latency_ms: latency,
        cache_hit: false,
        caller,
      });
      return new Response(JSON.stringify({ ok: false, error: `fetch Solar API: ${msg}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawText = await resp.text();
    let parsed: unknown;
    try { parsed = JSON.parse(rawText); } catch {
      const latency = Date.now() - startedAt;
      console.error(`[solar-api] non-JSON from Google (status=${resp.status}):`, rawText.slice(0, 200));
      await safeJournal(sb, {
        lat, lng,
        http_status: resp.status,
        latency_ms: latency,
        cache_hit: false,
        caller,
      });
      return new Response(JSON.stringify({
        ok: false,
        error: `Solar API a renvoyé du non-JSON (${resp.status})`,
        raw: rawText.slice(0, 500),
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!resp.ok) {
      // deno-lint-ignore no-explicit-any
      const d = parsed as any;
      const latency = Date.now() - startedAt;
      const googleErr = d?.error?.message || d?.error || `HTTP ${resp.status}`;
      console.error(`[solar-api] Google returned ${resp.status}:`, googleErr);
      await safeJournal(sb, {
        lat, lng,
        http_status: resp.status,
        latency_ms: latency,
        cache_hit: false,
        caller,
      });
      return new Response(JSON.stringify({
        ok: false,
        http_status: resp.status,
        error: googleErr,
        status_code: d?.error?.status || null,
        details: d,
      }), { status: resp.status === 404 ? 404 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── 3. Digérer + persister en cache + journaliser ────────────────────
    const digested = digestSolarResponse(parsed);
    const latency = Date.now() - startedAt;
    console.log(`[solar-api] OK n_segments=${digested.summary.n_segments} quality=${digested.summary.imagery_quality} latency=${latency}ms`);

    // Upsert cache (fail-safe — un cache miss vaut mieux qu'une fn qui crashe)
    await safeCacheUpsert(sb, {
      lat,
      lng,
      geohash,
      response: digested,
      quality: digested.summary.imagery_quality,
      fetched_at: new Date().toISOString(),
    });

    // Journal fetch (fail-safe)
    await safeJournal(sb, {
      lat, lng,
      http_status: resp.status,
      quality: digested.summary.imagery_quality,
      n_segments: digested.summary.n_segments,
      latency_ms: latency,
      cache_hit: false,
      caller,
    });

    return new Response(JSON.stringify({ ...digested, cache_hit: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Catch-all : toute exception non-gérée arrive ici. On log puis on
    // retourne un 500 avec un body utile au lieu d'un 500 silencieux.
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[solar-api] UNHANDLED EXCEPTION:", msg, stack);
    return new Response(JSON.stringify({
      ok: false,
      error: `Solar API internal error: ${msg}`,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
