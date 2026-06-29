/**
 * Adaptateur Google Solar API → RoofModel.
 *
 * Contrat d'intégration :
 *   - Source : output de l'edge function `solar-api` (= forme strictement
 *     identique à `solar-api-test`, cf. supabase/functions/solar-api/index.ts).
 *   - Cible  : `RoofModel` canonique (cf. src/lib/roof-core/types.ts) qui
 *     alimente le moteur straight-skeleton (engine.ts) en aval.
 *
 * Une **section RoofModel par segment Solar**. Le polygone est dérivé du
 * `bbox` (SW + NE) projeté en pixels image — c'est volontairement
 * conservateur. Le polygone exact d'un segment Solar nécessiterait de
 * pomper les `boundary.path[]` du raw Google (latérale, masquée dans le
 * digest actuel), tâche réservée à une Vague C si le besoin remonte.
 *
 * Le `pitch_deg` Solar est snappé sur les pentes résidentielles québécoises
 * standard (4/12, 6/12, 8/12, 10/12, 12/12) pour matcher les pratiques de
 * soumission de Toitures VB. Snap "le plus proche" — pas de seuil de confiance.
 *
 * **Source = 'solar'** sur le modèle pour traçabilité (cf. RoofModelSource).
 *
 * **Pur** : aucune dépendance DOM, aucun appel réseau. Tout est calculé
 * à partir des inputs.
 *
 * Pattern à respecter : `fromRoofSectionsV16.ts` (qui est sur la liste
 * interdite — on imite, on ne le modifie pas).
 */

import {
  RoofModel,
  RoofSectionInput,
  RoofSectionMeta,
  RoofPoint,
  ROOF_MODEL_VERSION,
  ftPerPxFromGeoref,
} from '../types';

/* ── Entrée Solar API digérée (= output de l'edge function solar-api) ──── */

export type SolarImageryQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'BASE';

export interface SolarLatLng {
  lat: number;
  lng: number;
}

export interface SolarBBox {
  sw: SolarLatLng;
  ne: SolarLatLng;
}

export interface SolarSegment {
  pitch_deg: number | null;
  azimuth_deg: number | null;
  area_m2: number | null;
  center: SolarLatLng | null;
  bbox: SolarBBox | null;
}

export interface SolarAPIDigested {
  ok: true;
  summary: {
    n_segments: number;
    total_area_m2: number;
    imagery_quality: SolarImageryQuality | null;
    imagery_date: string | null;
    imagery_processed_date?: string | null;
    name?: string | null;
    region_code?: string | null;
  };
  segments: SolarSegment[];
  /** Réponse brute Google (non utilisée par cet adaptateur). */
  raw?: unknown;
  cache_hit?: boolean;
}

/** Paramètres de la carte Static Maps qui a produit l'image satellite. */
export interface SolarMapParams {
  /** Centre de l'image — typiquement le centroïde du bâtiment (lat/lng). */
  centerLat: number;
  centerLng: number;
  /** Zoom Static Maps (typiquement 20 pour Toitures VB). */
  zoom: number;
  /** Largeur image en pixels (typiquement 1280 = 640 × scale=2). */
  imageWidth?: number;
  /** Hauteur image en pixels (typiquement 1280). */
  imageHeight?: number;
  /** Scale factor (1 ou 2). 2 = image ré-échantillonnée. Défaut 2. */
  scaleParam?: number;
  /** Fournisseur d'imagerie (ex "google"). Défaut "google". */
  provider?: string;
}

export interface FromSolarAPIResult {
  /**
   * `null` si la qualité d'imagerie est insuffisante (BASE) ou si zéro
   * segment exploitable. Le consommateur (Vague A2) doit gérer ce cas en
   * proposant le tracé manuel via le Tracer 3D.
   */
  model: RoofModel | null;
  /** Quality reportée par Solar API. */
  sourceQuality: SolarImageryQuality;
  /**
   * Compteurs de skip pour observabilité / debug. Un segment peut être skippé
   * si bbox manquante (centre seulement, sans coin) ou si aire < 1 m² (bruit).
   */
  stats: {
    n_total: number;
    n_kept: number;
    n_skipped_missing_bbox: number;
    n_skipped_too_small: number;
  };
}

/* ── Projection lat/lng → image pixel (Web-Mercator) ─────────────────────── */

const TILE_SIZE_PX = 256;
const DEFAULT_IMAGE_SIZE = 1280;
const DEFAULT_SCALE = 2;
const MIN_SEGMENT_AREA_M2 = 1; // Σ aires Solar < 1 m² = bruit, on skippe.

/**
 * Projection Web-Mercator d'une coordonnée lat/lng vers pixel image,
 * relative au centre Static Maps. **Strictement identique** à la fonction
 * `latLngToImagePx` de `src/lib/training-lab.ts:559` — extraite pour rester
 * pure (aucun import de training-lab pour ne pas créer de cycle DOM).
 *
 * Si on modifie l'une, **mettre à jour l'autre**.
 */
function latLngToImagePx(
  lat: number, lng: number,
  centerLat: number, centerLng: number,
  zoom: number,
  imgSize = DEFAULT_IMAGE_SIZE, scale = DEFAULT_SCALE,
): [number, number] {
  const worldScale = TILE_SIZE_PX * Math.pow(2, zoom);
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

/* ── Snap pitch ──────────────────────────────────────────────────────────── */

/**
 * Pentes résidentielles standard utilisées par Toitures VB en soumission.
 * Doit rester en miroir avec ce qui est offert dans l'UI step 1 (Vague A2).
 */
const STANDARD_PITCHES_X12 = [4, 6, 8, 10, 12] as const;

/**
 * Convertit un pitch en degrés vers X/12, puis snappe sur le standard le
 * plus proche. Pas de seuil — toujours snap. Le brief : "pitch_deg → X/12
 * avec snap aux pentes standard (4/12, 6/12, 8/12, 10/12, 12/12)".
 *
 * Tan(angle) × 12 = X/12. Pour 30° → tan(30°) ≈ 0.577 → 6.93/12 → snap à 8.
 */
export function snapPitchDegToStandard(pitchDeg: number): number {
  const x12 = Math.tan((pitchDeg * Math.PI) / 180) * 12;
  let best = STANDARD_PITCHES_X12[0] as number;
  let bestDist = Math.abs(x12 - best);
  for (const candidate of STANDARD_PITCHES_X12) {
    const dist = Math.abs(x12 - candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/* ── Conversions internes ────────────────────────────────────────────────── */

/**
 * Construit le rectangle 2D (4 sommets) qui représente l'aire couverte par
 * un segment Solar dans l'image. On utilise les 4 coins du bbox lat/lng,
 * projetés en pixels — l'ordre est SW → SE → NE → NW (sens horaire dans le
 * repère image où Y croît vers le bas).
 */
function bboxToImageQuad(
  bbox: SolarBBox,
  map: Required<Pick<SolarMapParams, 'centerLat' | 'centerLng' | 'zoom'>> & {
    imageWidth: number;
    imageHeight: number;
    scaleParam: number;
  },
): RoofPoint[] {
  const { sw, ne } = bbox;
  // 4 coins en lat/lng (ordre horaire dans le repère image)
  const corners: SolarLatLng[] = [
    { lat: sw.lat, lng: sw.lng }, // SW
    { lat: sw.lat, lng: ne.lng }, // SE
    { lat: ne.lat, lng: ne.lng }, // NE
    { lat: ne.lat, lng: sw.lng }, // NW
  ];
  return corners.map((c) => {
    const [x, y] = latLngToImagePx(
      c.lat, c.lng,
      map.centerLat, map.centerLng,
      map.zoom,
      map.imageWidth, map.scaleParam,
    );
    return { x, y };
  });
}

function metaForSolarSegment(
  segment: SolarSegment,
  index: number,
  sourceQuality: SolarImageryQuality,
): RoofSectionMeta {
  // Confiance dérivée de la qualité d'imagerie + présence du bbox.
  const qualityWeight: Record<SolarImageryQuality, number> = {
    HIGH: 0.95,
    MEDIUM: 0.75,
    LOW: 0.55,
    BASE: 0.30,
  };
  const confidence = qualityWeight[sourceQuality] ?? 0.5;
  return {
    source_id: `solar:${index}`,
    role: 'main',
    confidence,
    scores: {
      solar_pitch_deg: segment.pitch_deg ?? 0,
      solar_azimuth_deg: segment.azimuth_deg ?? 0,
      solar_area_m2: segment.area_m2 ?? 0,
    },
  };
}

function isUsableSegment(segment: SolarSegment): boolean {
  if (!segment.bbox) return false;
  if (segment.pitch_deg == null) return false;
  if (typeof segment.area_m2 === 'number' && segment.area_m2 < MIN_SEGMENT_AREA_M2) return false;
  return true;
}

/* ── API publique ─────────────────────────────────────────────────────────── */

/**
 * Convertit l'output de l'edge function `solar-api` en `RoofModel`.
 *
 * Garanties :
 *   - Si `data.summary.imagery_quality === 'BASE'` ou aucun segment exploitable :
 *     `model = null`. Le caller doit fallback sur tracé manuel.
 *   - Si au moins un segment exploitable : `model.sections.length >= 1`.
 *   - `metadata.source === 'solar'`, `metadata.status === 'auto_candidate'`.
 *   - `metadata.solar_imagery_quality` et `metadata.solar_imagery_date`
 *     reflètent ce que Solar a retourné.
 *
 * Le `RoofModel.scale` est calculé depuis les `mapParams` (Web-Mercator).
 * Le `RoofModel.image` reflète la taille demandée (`mapParams.imageWidth/Height`).
 */
export function fromSolarAPI(
  data: SolarAPIDigested,
  mapParams: SolarMapParams,
): FromSolarAPIResult {
  const sourceQuality: SolarImageryQuality =
    (data.summary.imagery_quality ?? 'BASE') as SolarImageryQuality;

  const stats = {
    n_total: data.segments?.length ?? 0,
    n_kept: 0,
    n_skipped_missing_bbox: 0,
    n_skipped_too_small: 0,
  };

  // Garde-fou qualité : BASE = imagery 100% générée, on n'essaie pas.
  if (sourceQuality === 'BASE') {
    return { model: null, sourceQuality, stats };
  }

  // Garde-fou structure : aucun segment OU n_segments déclaré à 0.
  if (!data.segments || data.segments.length === 0) {
    return { model: null, sourceQuality, stats };
  }

  const imageWidth = mapParams.imageWidth ?? DEFAULT_IMAGE_SIZE;
  const imageHeight = mapParams.imageHeight ?? DEFAULT_IMAGE_SIZE;
  const scaleParam = mapParams.scaleParam ?? DEFAULT_SCALE;
  const provider = mapParams.provider ?? 'google';

  const mapResolved = {
    centerLat: mapParams.centerLat,
    centerLng: mapParams.centerLng,
    zoom: mapParams.zoom,
    imageWidth,
    imageHeight,
    scaleParam,
  };

  const sections: RoofSectionInput[] = [];

  for (let i = 0; i < data.segments.length; i++) {
    const segment = data.segments[i];

    if (!segment.bbox) {
      stats.n_skipped_missing_bbox++;
      continue;
    }
    if (segment.pitch_deg == null) {
      // Pas exploitable (pitch est requis pour le straight-skeleton)
      stats.n_skipped_missing_bbox++; // approximation — bbox OK mais pitch manquant
      continue;
    }
    if (
      typeof segment.area_m2 === 'number' &&
      segment.area_m2 < MIN_SEGMENT_AREA_M2
    ) {
      stats.n_skipped_too_small++;
      continue;
    }
    if (!isUsableSegment(segment)) {
      stats.n_skipped_missing_bbox++;
      continue;
    }

    const pts = bboxToImageQuad(segment.bbox, mapResolved);
    const pitch = snapPitchDegToStandard(segment.pitch_deg);

    sections.push({
      pts,
      closed: true,
      pitch,
      elev: 0,
      hf: 0,
      // Solar segments représentent des plans individuels (pas des
      // assemblages gable) — on les annote comme 'hip' (pan unique).
      // Le mapping vers gable se fera plus tard si nécessaire, côté Vague A2,
      // depuis la disposition des azimuts.
      roof_type: 'hip',
      meta: metaForSolarSegment(segment, i, sourceQuality),
    });
    stats.n_kept++;
  }

  if (sections.length === 0) {
    return { model: null, sourceQuality, stats };
  }

  // Calibration px → pi (sera consommée par le take-off en aval)
  const ft_per_px = ftPerPxFromGeoref({
    zoom: mapParams.zoom,
    center_lat: mapParams.centerLat,
    scale_param: scaleParam,
  });

  const model: RoofModel = {
    version: ROOF_MODEL_VERSION,
    image: {
      width: imageWidth,
      height: imageHeight,
      scale_factor: scaleParam,
    },
    scale: {
      ft_per_px,
      px_per_ft: ft_per_px ? 1 / ft_per_px : 0,
      source: 'georef',
      confidence: 0.9,
      provider,
      georef: {
        zoom: mapParams.zoom,
        center_lat: mapParams.centerLat,
        center_lng: mapParams.centerLng,
        scale_param: scaleParam,
        image_w: imageWidth,
        image_h: imageHeight,
        provider,
      },
    },
    sections,
    metadata: {
      source: 'solar',
      status: 'auto_candidate',
      mvp_version: 'solar-1.0.0',
      solar_imagery_quality: sourceQuality,
      solar_imagery_date: data.summary.imagery_date ?? undefined,
    },
  };

  return { model, sourceQuality, stats };
}
