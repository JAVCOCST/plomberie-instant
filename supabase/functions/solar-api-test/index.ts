/**
 * solar-api-test
 * ==============
 *
 * Endpoint de test rapide pour Google Solar API. Prend une lat/lng et
 * retourne le format BRUT de buildingInsights, plus une version
 * pré-digérée pour comparaison rapide avec la truth humaine.
 *
 * Pas un endpoint de production — c'est un OUTIL DE TEST pour décider
 * si Google Solar est suffisamment bon pour devenir le backend principal.
 *
 * Input :
 *   { latitude: number, longitude: number, api_key?: string }
 *   Si api_key omis, fallback sur env var GOOGLE_MAPS_API_KEY.
 *
 * Output :
 *   {
 *     ok: true,
 *     summary: {
 *       n_segments: number,
 *       total_area_m2: number,
 *       imagery_quality: 'HIGH' | 'MEDIUM' | 'LOW' | 'BASE',
 *       imagery_date: string,
 *     },
 *     segments: Array<{
 *       pitch_deg: number,
 *       azimuth_deg: number,
 *       area_m2: number,
 *       center: { lat, lng },
 *       bbox: { sw: {lat,lng}, ne: {lat,lng} },
 *     }>,
 *     raw: <whole google response>,
 *   }
 */
import { cors, runAdminGuards } from "../_shared/hardening.ts";

interface TestPayload {
  latitude: number;
  longitude: number;
  api_key?: string;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, requestedHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  let body: TestPayload;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return new Response(JSON.stringify({ error: "latitude/longitude invalides" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = (body.api_key || Deno.env.get("GOOGLE_MAPS_API_KEY") || "").trim();
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: "GOOGLE_MAPS_API_KEY missing. Pass api_key in body or set the env var.",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest`
    + `?location.latitude=${lat}&location.longitude=${lng}`
    + `&requiredQuality=HIGH`
    + `&key=${apiKey}`;

  let resp: Response;
  try {
    // Important : on envoie le Referer du domaine prod pour bypass la
    // restriction "HTTP referrers" de la clé Google Maps (qui est probablement
    // limitée à *.toituresvb.ca/*). Sans ça, Google répond "Requests from
    // referer <empty> are blocked" parce que les edge functions n'ont pas de
    // referer par défaut.
    resp = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Referer": "https://soumission.toituresvb.ca/",
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: `fetch Solar API: ${e.message}` }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawText = await resp.text();
  let data: any;
  try { data = JSON.parse(rawText); } catch {
    return new Response(JSON.stringify({
      error: `Solar API a renvoyé du non-JSON (${resp.status})`,
      raw: rawText.slice(0, 500),
    }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!resp.ok) {
    // Solar API renvoie souvent { error: { code, message, status } } sur erreur
    return new Response(JSON.stringify({
      ok: false,
      http_status: resp.status,
      error: data?.error?.message || data?.error || `HTTP ${resp.status}`,
      status_code: data?.error?.status || null,
      details: data,
    }), { status: resp.status === 404 ? 404 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Pré-digestion pour affichage rapide côté UI
  const segments = Array.isArray(data?.solarPotential?.roofSegmentStats)
    ? data.solarPotential.roofSegmentStats
    : [];
  const total_area_m2 = segments.reduce((sum: number, s: any) => sum + (s.stats?.areaMeters2 || 0), 0);
  const summary = {
    n_segments: segments.length,
    total_area_m2: Math.round(total_area_m2 * 100) / 100,
    imagery_quality: data?.imageryQuality || null,
    imagery_date: data?.imageryDate
      ? `${data.imageryDate.year}-${String(data.imageryDate.month || 1).padStart(2, "0")}-${String(data.imageryDate.day || 1).padStart(2, "0")}`
      : null,
    imagery_processed_date: data?.imageryProcessedDate
      ? `${data.imageryProcessedDate.year}-${String(data.imageryProcessedDate.month || 1).padStart(2, "0")}`
      : null,
    name: data?.name || null,
    region_code: data?.regionCode || null,
  };

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

  return new Response(JSON.stringify({
    ok: true,
    summary,
    segments: segmentsLite,
    raw: data,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
