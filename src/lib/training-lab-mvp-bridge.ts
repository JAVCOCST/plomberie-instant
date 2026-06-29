/**
 * Bridge entre le Training Lab et la Hugging Face Space
 * `JAVCOCST/roof-sections-v16` qui héberge le pipeline Python v1.6.
 *
 * Flow :
 *   1. Récupère l'image satellite (raw_image_url) → blob → base64.
 *   2. Projette le polygone bâtiment (lat/lng, GeoJSON) → coords image-px
 *      en utilisant la même formule Mercator que Google Static Maps.
 *   3. POST à l'endpoint /roof-sections/v1.6 du HF Space.
 *   4. Valide schema_version === "sections-1.6.0".
 *
 *  Pas de fallback SAM. Pas de simulation. Si la Space répond pas, on lève.
 */

const DEFAULT_HF_SPACE_URL = 'https://javcocst-roof-sections-v16.hf.space';

/** URL de la Space — override via VITE_HF_SPACE_URL si besoin (dev/test). */
function hfSpaceUrl(): string {
  const env = (import.meta as { env?: Record<string, string> }).env;
  return env?.VITE_HF_SPACE_URL || DEFAULT_HF_SPACE_URL;
}

/** En-tête bearer optionnel — set VITE_HF_SHARED_SECRET si tu as activé
 *  SHARED_SECRET côté Space (Settings → Repository secrets). Sinon vide. */
function hfSharedSecret(): string | null {
  const env = (import.meta as { env?: Record<string, string> }).env;
  return env?.VITE_HF_SHARED_SECRET || null;
}

/* ── Projection Mercator (= Google Static Maps) ───────────────────────── */

const TILE_SIZE = 256;

/** Convertit (lat, lng) → coords image-px d'une Google Static Map
 *  centrée sur (centerLat, centerLng) à un certain zoom et scale.
 *  imgSize = taille image en pixels (1280 = 640 × scale=2 par défaut HF). */
export function latLngToImagePx(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  zoom: number,
  imgSize = 1280,
  scale = 2,
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

/* ── Extraction du polygone bâtiment depuis un GeoJSON ─────────────────── */

type LngLat = [number, number];

/** Récupère le premier anneau extérieur d'un GeoJSON Polygon ou
 *  MultiPolygon. GeoJSON utilise l'ordre [longitude, latitude].
 *  Accepte aussi une string JSON-encodée (Supabase peut renvoyer jsonb
 *  comme string selon le path d'écriture/lecture). */
export function extractOuterRing(geo: unknown): LngLat[] | null {
  if (geo == null) return null;
  // Supabase peut renvoyer le jsonb comme string brut — on parse à la volée.
  if (typeof geo === 'string') {
    try { return extractOuterRing(JSON.parse(geo)); }
    catch { return null; }
  }
  if (typeof geo !== 'object') return null;
  const g = (geo as { type?: string; geometry?: unknown; coordinates?: unknown; features?: unknown });
  if (g.type === 'Feature') return extractOuterRing(g.geometry);
  if (g.type === 'FeatureCollection') {
    const features = Array.isArray(g.features) ? g.features : [];
    for (const f of features) {
      const ring = extractOuterRing(f);
      if (ring) return ring;
    }
    return null;
  }
  if (g.type === 'Polygon') {
    const coords = g.coordinates as unknown[];
    return Array.isArray(coords) && Array.isArray(coords[0])
      ? (coords[0] as LngLat[])
      : null;
  }
  if (g.type === 'MultiPolygon') {
    const coords = g.coordinates as unknown[];
    const first = Array.isArray(coords) ? coords[0] : null;
    return Array.isArray(first) && Array.isArray((first as unknown[])[0])
      ? ((first as unknown[])[0] as LngLat[])
      : null;
  }
  return null;
}

/** Convertit le building geojson + map_params en polygone image-px attendu
 *  par le pipeline Python. Retourne null si l'une des entrées est invalide. */
export function buildPriorPolygonPx(
  buildingGeojson: unknown,
  mapParams: { centerLat?: number; centerLng?: number; zoom?: number } | null | undefined,
): Array<[number, number]> | null {
  const ring = extractOuterRing(buildingGeojson);
  if (!ring || ring.length < 3) return null;
  const cLat = mapParams?.centerLat;
  const cLng = mapParams?.centerLng;
  const zoom = mapParams?.zoom;
  if (typeof cLat !== 'number' || typeof cLng !== 'number' || typeof zoom !== 'number') {
    return null;
  }
  return ring.map(([lng, lat]) => latLngToImagePx(lat, lng, cLat, cLng, zoom));
}

/* ── Image → base64 data URL ──────────────────────────────────────────── */

async function fetchImageAsBase64(imageUrl: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(imageUrl, { signal });
  if (!res.ok) throw new Error(`Image fetch failed [${res.status}]: ${imageUrl}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const r = fr.result;
      typeof r === 'string' ? resolve(r) : reject(new Error('FileReader: unexpected result'));
    };
    fr.onerror = () => reject(new Error('FileReader: failed to read blob'));
    fr.readAsDataURL(blob);
  });
}

/* ── Appel HF Space ───────────────────────────────────────────────────── */

export interface RunMvpV16Args {
  imageUrl: string;
  buildingGeojson: unknown;
  mapParams: { centerLat?: number; centerLng?: number; zoom?: number } | null | undefined;
  roofType?: string;
  selectionMode?: 'conservative' | 'normal' | 'complex' | 'cross' | 'adaptive';
  /** v1.6.1 Patch B — opt-in vision-based prior refinement (default true en
   *  training lab pour valider sur les bundles existants). Côté API HF, le
   *  flag déclenche detect_building_footprint avant fit_roof_rectangle.
   *  Si la détection vision échoue (area_ratio hors plage), fallback safe
   *  sur le prior cadastral original — comportement identique à v1.6. */
  useVisionPrior?: boolean;
  signal?: AbortSignal;
}

/** Lance la pré-annotation IA v1.6 sur la HF Space. Lève une Error explicite
 *  sur n'importe quel échec (image, polygone, réseau, schema invalide).
 *
 *  Default selectionMode = 'adaptive' depuis 2026-06-05 (était 'conservative').
 *  Justification audit failure-mode sur 14 datasets : sections_added=3.3/dataset
 *  (sous-détection systématique sur les L/T-shape/multi-wing). En conservative
 *  le cap était fixé à 1 quelle que soit la typologie réelle. En adaptive, la
 *  pipeline détermine le cap (1-5) selon le graphe de relations (siblings
 *  perpendiculaires, child_of, parallel...) → simple reste à 1, complex monte
 *  à 4. Plus de raison d'imposer le choix à l'opérateur. */
export async function runMvpV16Prediction(args: RunMvpV16Args): Promise<unknown> {
  const {
    imageUrl, buildingGeojson, mapParams,
    roofType = 'mixed', selectionMode = 'adaptive', signal,
  } = args;

  if (!imageUrl) throw new Error('image satellite manquante (raw_image_url null).');

  const priorPx = buildPriorPolygonPx(buildingGeojson, mapParams);
  if (!priorPx) {
    throw new Error('polygone bâtiment ou map_params manquants — impossible de projeter en pixels.');
  }
  if (priorPx.length < 3) {
    throw new Error(`polygone bâtiment trop court (${priorPx.length} points).`);
  }

  const imageB64 = await fetchImageAsBase64(imageUrl, signal);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = hfSharedSecret();
  if (secret) headers['Authorization'] = `Bearer ${secret}`;

  const res = await fetch(`${hfSpaceUrl()}/roof-sections/v1.6`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      image_b64: imageB64,
      prior_polygon_px: priorPx,
      roof_type: roofType,
      selection_mode: selectionMode,
      // v1.6.1 Patch B : opt-in côté API HF. Activé par défaut en training lab.
      use_vision_prior: args.useVisionPrior ?? true,
      // v1.6.2 — étape 3 Manhattan-world regularization. Snap chaque section
      // sur la grille dérivée de l'axe principal du bâtiment (détection Hough
      // dans l'image). Toutes les arêtes finissent à exactement 0°/45°/90°/135°
      // par rapport à cet axe. Fallback safe côté HF Space si la détection
      // d'axe échoue (l'output reste exploitable). Activé par défaut.
      regularize: true,
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail += `: ${body?.detail || JSON.stringify(body).slice(0, 200)}`;
    } catch { /* response wasn't JSON */ }
    throw new Error(`HF Space a refusé : ${detail}`);
  }

  const json = await res.json();
  if (!json || typeof json !== 'object' || json.schema_version !== 'sections-1.6.0') {
    throw new Error(`HF Space a renvoyé un format inattendu (schema_version=${json?.schema_version ?? '?'}).`);
  }
  if (!Array.isArray(json.sections) || json.sections.length === 0) {
    throw new Error("HF Space a renvoyé sections[] vide.");
  }
  return json;
}

/** Lance la pré-annotation via Claude Vision (claude-sonnet-4-6). Alternative
 *  premium aux backends algo (v1.6) et ml_v1 (YOLOv8-OBB) — comprend
 *  sémantiquement le toit comme un humain, pas besoin de training data.
 *  Coût : ~$0.01 par toit. Format de sortie identique aux autres backends
 *  (schema "sections-1.6.0"). */
export async function runClaudeVisionPrediction(args: {
  imageUrl: string;
  buildingGeojson: any;
  mapParams: any;
  roofTypeHint?: 'hip' | 'gable' | 'flat' | 'complex';
  // Mode 'refine' : passe la pré-annotation existante (de YOLO ou v1.6)
  // que Claude doit corriger plutôt que de prédire de zéro. Beaucoup plus
  // efficace en tokens + résultats plus précis.
  mode?: 'predict' | 'refine';
  currentSections?: Array<any>;
  currentBackend?: string;
}): Promise<unknown> {
  const { imageUrl, buildingGeojson, mapParams, roofTypeHint, mode, currentSections, currentBackend } = args;
  if (!imageUrl) throw new Error('image satellite manquante.');

  const priorPx = buildPriorPolygonPx(buildingGeojson, mapParams);
  if (!priorPx || priorPx.length < 3) {
    throw new Error('polygone bâtiment manquant ou incomplet.');
  }

  const { supabase } = await import('@/integrations/supabase/client');
  const { data, error } = await (supabase as any).functions.invoke('roof-vision-claude', {
    body: {
      image_url: imageUrl,
      building_polygon_px: priorPx,
      image_size: 1280,
      roof_type_hint: roofTypeHint,
      mode: mode || 'predict',
      current_sections: currentSections,
      current_backend: currentBackend,
    },
  });
  if (error) {
    let serverMsg = error.message || 'erreur inconnue';
    try {
      const ctx: any = (error as any).context;
      if (ctx?.body?.error) serverMsg = String(ctx.body.error);
      else if (typeof ctx?.json === 'function') {
        const j = await ctx.json();
        if (j?.error) serverMsg = String(j.error);
      }
    } catch { /* fallback */ }
    throw new Error(serverMsg);
  }
  if (data && (data as any).error) throw new Error(String((data as any).error));
  return data;
}
