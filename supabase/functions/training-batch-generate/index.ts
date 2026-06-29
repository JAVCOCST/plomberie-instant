/**
 * training-batch-generate
 * =======================
 *
 * Génère un nouveau batch de training datasets en sélectionnant des bâtiments
 * existants dans la BD cadastrale et en créant les rows training_roof_takeoffs
 * pré-câblées (centroid, polygon en pixels, URL Static Maps, batch_id).
 *
 * Pas de pré-annotation IA dans cette fonction — c'est trop long pour un
 * appel sync (HF Space cold start + N requests). Le frontend triggère
 * "Annoter" sur chaque row après création (boucle batch, ou un par un).
 *
 * Input JSON :
 *   {
 *     batch_code: string         // ex: 'batch_001_random_granby'
 *     name: string               // ex: 'Random Granby — 30 toits'
 *     description?: string
 *     source_type: string        // 'random' | 'active_learning' | 'curated'
 *     city?: string              // filtre eval_municipalite (case-insensitive)
 *     zone_geojson?: any         // bbox/polygone pour filtre spatial
 *     limit: number              // nb de bâtiments à sélectionner (max 200)
 *     model_version: string      // ex: 'algo_v1_6' (qui sera utilisé pour
 *                                   la pré-annotation downstream)
 *     random_seed?: number       // pour reproductibilité
 *     exclude_existing?: boolean // default true — skip les bâtiments déjà
 *                                   utilisés dans n'importe quel batch
 *     zoom?: number              // Google Maps zoom (default 20)
 *   }
 *
 * Output JSON :
 *   {
 *     batch_id: string,
 *     batch_code: string,
 *     dataset_count: number,
 *     candidate_count: number,    // nb bâtiments examinés avant filtres
 *     skipped_existing: number,
 *     status: 'ready_for_review',
 *   }
 */
import { cors, runAdminGuards } from "../_shared/hardening.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const IMAGE_SIZE = 640;        // px - Static Maps native size
const IMAGE_SCALE = 2;         // ×2 → output 1280×1280 (match training-lab.ts)
const IMAGE_DIM_FULL = IMAGE_SIZE * IMAGE_SCALE;
const TILE_SIZE = 256;
const DEFAULT_ZOOM = 20;

interface GenerateBatchPayload {
  batch_code: string;
  name: string;
  description?: string;
  source_type: string;
  city?: string;
  zone_geojson?: unknown;
  limit: number;
  model_version: string;
  random_seed?: number;
  exclude_existing?: boolean;
  zoom?: number;
  // La clé Google Maps peut être passée depuis le client (qui l'a déjà via
  // VITE_GOOGLE_MAPS_API_KEY) — évite d'obliger l'opérateur à la dupliquer
  // dans les secrets Supabase. Fallback : env var GOOGLE_MAPS_API_KEY.
  google_maps_api_key?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Mercator projection identique à src/lib/training-lab.ts:latLngToImagePx
// ────────────────────────────────────────────────────────────────────────────
function latLngToImagePx(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  zoom: number,
  imgSize = IMAGE_DIM_FULL,
  scale = IMAGE_SCALE,
): [number, number] {
  const worldScale = TILE_SIZE * Math.pow(2, zoom);
  const project = (la: number, ln: number) => {
    const x = ((ln + 180) / 360) * worldScale;
    const siny = Math.min(Math.max(Math.sin((la * Math.PI) / 180), -0.9999), 0.9999);
    const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * worldScale;
    return { x, y };
  };
  const p = project(lat, lng);
  const c = project(centerLat, centerLng);
  return [
    Math.round((p.x - c.x) * scale + imgSize / 2),
    Math.round((p.y - c.y) * scale + imgSize / 2),
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// Pull bâtiments candidats depuis batiment_avec_lot (PostGIS)
// ────────────────────────────────────────────────────────────────────────────
async function fetchCandidates(
  sb: SupabaseClient,
  args: { city?: string; limit: number; excludeBuildingIds: Set<string> },
): Promise<Array<{ id: string; lat: number; lng: number; geojson: any; no_lot: string | null }>> {
  // Strategy : on prend N×3 candidates pour avoir de la marge après filtres
  // (exclude_existing, geometry invalide, etc.) puis on tronque à `limit`.
  const fetchN = Math.min(args.limit * 3, 600);
  // PostgreSQL RPC is the cleanest path : on appelle une fonction stored
  // qui retourne lat, lng, geojson dans la projection EPSG:4326.
  // Le RPC `sample_buildings_random` est créé par cette migration.
  const { data, error } = await sb.rpc("sample_buildings_random", {
    p_limit: fetchN,
    p_city: args.city || null,
  });
  if (error) throw new Error(`sample_buildings_random: ${error.message}`);

  const filtered: Array<{ id: string; lat: number; lng: number; geojson: any; no_lot: string | null }> = [];
  for (const row of (data || []) as any[]) {
    if (filtered.length >= args.limit) break;
    const bId = String(row.id);
    if (args.excludeBuildingIds.has(bId)) continue;
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    let geojson = row.geojson;
    if (typeof geojson === "string") {
      try { geojson = JSON.parse(geojson); } catch { continue; }
    }
    if (!geojson || typeof geojson !== "object") continue;
    filtered.push({
      id: bId,
      lat,
      lng,
      geojson,
      no_lot: row.no_lot ?? null,
    });
  }
  return filtered;
}

// ────────────────────────────────────────────────────────────────────────────
// Static Maps URL builder (key = env GOOGLE_MAPS_API_KEY côté Supabase)
// ────────────────────────────────────────────────────────────────────────────
function buildSatelliteUrl(lat: number, lng: number, zoom: number, apiKey: string): string {
  const center = `${lat},${lng}`;
  const params = new URLSearchParams({
    center,
    zoom: String(zoom),
    size: `${IMAGE_SIZE}x${IMAGE_SIZE}`,
    scale: String(IMAGE_SCALE),
    maptype: "satellite",
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Extract building polygon outer ring from GeoJSON, project to pixels
// ────────────────────────────────────────────────────────────────────────────
function extractRing(geo: any): Array<[number, number]> | null {
  if (!geo || typeof geo !== "object") return null;
  if (geo.type === "Polygon") {
    const coords = geo.coordinates;
    if (Array.isArray(coords) && Array.isArray(coords[0])) return coords[0];
  }
  if (geo.type === "MultiPolygon") {
    const coords = geo.coordinates;
    if (Array.isArray(coords) && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
      return coords[0][0];
    }
  }
  return null;
}

function projectRingToPx(
  ring: Array<[number, number]>,
  centerLat: number,
  centerLng: number,
  zoom: number,
): Array<[number, number]> {
  return ring.map(([lng, lat]) => latLngToImagePx(lat, lng, centerLat, centerLng, zoom));
}

// ────────────────────────────────────────────────────────────────────────────
// Reference generator (similaire au format VB-MAP-XXXX du portail)
// ────────────────────────────────────────────────────────────────────────────
function makeReference(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `VB-MAP-${s}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, requestedHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  let payload: GenerateBatchPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validation
  const lim = Number(payload.limit);
  if (!payload.batch_code || !payload.name || !payload.source_type || !payload.model_version) {
    return new Response(JSON.stringify({ error: "batch_code, name, source_type, model_version required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!isFinite(lim) || lim < 1 || lim > 200) {
    return new Response(JSON.stringify({ error: "limit must be 1..200" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Clé Google Maps : priorité au body (vient du frontend qui l'a déjà),
  // fallback sur env var côté Supabase si jamais on veut tout cacher serveur.
  const apiKey = (payload.google_maps_api_key || Deno.env.get("GOOGLE_MAPS_API_KEY") || "").trim();
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: "Google Maps API key missing — pass it in body.google_maps_api_key or set GOOGLE_MAPS_API_KEY secret",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Service role client (bypass RLS) — nécessaire pour écrire dans toutes les tables
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false } },
  );

  const zoom = Number(payload.zoom || DEFAULT_ZOOM);

  // 1. Créer la row training_batches (status='generating')
  const { data: batchRow, error: batchErr } = await sb
    .from("training_batches")
    .insert({
      batch_code: payload.batch_code,
      name: payload.name,
      description: payload.description ?? null,
      source_type: payload.source_type,
      city: payload.city ?? null,
      zone_geojson: payload.zone_geojson ?? null,
      limit_requested: lim,
      model_version_used: payload.model_version,
      status: "generating",
      dataset_count: 0,
    })
    .select("id")
    .single();
  if (batchErr || !batchRow) {
    return new Response(JSON.stringify({ error: `create batch: ${batchErr?.message || "unknown"}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const batchId = batchRow.id as string;

  // 2. (Optionnel) Liste des building_ids déjà utilisés
  let excludeIds = new Set<string>();
  if (payload.exclude_existing !== false) {
    const { data: existing } = await sb
      .from("training_roof_takeoffs")
      .select("building_id")
      .not("building_id", "is", null);
    if (existing) {
      for (const r of (existing as any[])) {
        if (r.building_id) excludeIds.add(String(r.building_id));
      }
    }
  }

  // 3. Pull les candidats
  let candidates: Array<{ id: string; lat: number; lng: number; geojson: any; no_lot: string | null }>;
  try {
    candidates = await fetchCandidates(sb, {
      city: payload.city,
      limit: lim,
      excludeBuildingIds: excludeIds,
    });
  } catch (e: any) {
    await sb.from("training_batches").update({ status: "draft", notes: `Pull candidates failed: ${e.message}` }).eq("id", batchId);
    return new Response(JSON.stringify({ error: `pull candidates: ${e.message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4. Créer les rows training_roof_takeoffs
  const rowsToInsert: any[] = [];
  for (const c of candidates) {
    const imgUrl = buildSatelliteUrl(c.lat, c.lng, zoom, apiKey);
    const ring = extractRing(c.geojson);
    const ringPx = ring ? projectRingToPx(ring, c.lat, c.lng, zoom) : null;
    rowsToInsert.push({
      batch_id: batchId,
      building_id: c.id,
      lot_id: c.no_lot,
      source_type: payload.source_type,
      reference: makeReference(),
      raw_image_url: imgUrl,
      original_building_geojson: c.geojson,
      building_polygon_px: ringPx,
      centroid_lat: c.lat,
      centroid_lng: c.lng,
      zoom,
      annotations_json: {
        map_params: { centerLat: c.lat, centerLng: c.lng, zoom },
      },
      dataset_status: "draft",
      qc_status: null,
      model_version_used: payload.model_version,
      tags: [],
    });
  }

  if (rowsToInsert.length === 0) {
    await sb.from("training_batches").update({
      status: "draft",
      notes: "No candidates returned by sampler (city filter too restrictive?)",
    }).eq("id", batchId);
    return new Response(JSON.stringify({
      batch_id: batchId,
      batch_code: payload.batch_code,
      dataset_count: 0,
      candidate_count: 0,
      status: "draft",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { error: insErr } = await sb.from("training_roof_takeoffs").insert(rowsToInsert);
  if (insErr) {
    await sb.from("training_batches").update({
      status: "draft",
      notes: `Insert takeoffs failed: ${insErr.message}`,
    }).eq("id", batchId);
    return new Response(JSON.stringify({ error: `insert takeoffs: ${insErr.message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 5. Update batch status='ready_for_review' + stats
  await sb.from("training_batches").update({
    status: "ready_for_review",
    dataset_count: rowsToInsert.length,
  }).eq("id", batchId);

  return new Response(JSON.stringify({
    batch_id: batchId,
    batch_code: payload.batch_code,
    dataset_count: rowsToInsert.length,
    candidate_count: candidates.length,
    skipped_existing: excludeIds.size,
    status: "ready_for_review",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
