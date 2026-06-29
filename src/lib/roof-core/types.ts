/**
 * RoofModel — la VÉRITÉ-ENTRÉE canonique du moteur roof-core.
 *
 * Tout le reste (faces, plans, noues, faîtières, pignons, membrane, flashing,
 * surfaces, rendu 3D) est DÉRIVÉ par le moteur à partir de `sections`. On ne
 * stocke jamais les dérivés comme vérité.
 *
 * Représentation : sommets en PIXELS de l'image source (même espace que le
 * MVP v1.6 et que le background du traceur — origine haut-gauche, Y vers le
 * bas), pente en X/12. Le bloc `image` + `scale` porte la géoréférence /
 * calibration qui permet de convertir px → pieds en aval (take-off), sans
 * calibration manuelle quand l'image vient d'une capture Web-Mercator.
 *
 * Ce fichier est volontairement SANS dépendance (pas d'import moteur, pas de
 * DOM) : il peut être importé partout, et n'introduit aucune régression.
 */

export const ROOF_MODEL_VERSION = 1 as const;

/** Sommet en pixels de l'image source. */
export interface RoofPoint {
  x: number;
  y: number;
}

/** Type de toit d'une section. `_no` (overrides de nœuds) est DÉRIVÉ de ce
 *  champ par le moteur (gable → gableEndsOverrides), jamais stocké en dur. */
export type RoofType = 'hip' | 'gable';

/** Provenance / metadata d'une section, conservée pour l'UI, les tooltips et
 *  la traçabilité. JAMAIS utilisée par le moteur (purement informative). */
export interface RoofSectionMeta {
  /** id MVP d'origine (ex "S1", "R2"). */
  source_id?: string;
  /** "main" | "ridge_candidate" côté MVP. */
  role?: string;
  /** 0..1 — S1 = 1.0 par convention, sinon structural_score. */
  confidence?: number;
  relationship_type?: string | null;
  parent_id?: string | null;
  group_id?: string | null;
  top_k_alternatives?: string[];
  related_ids?: string[];
  selection_reason?: string | null;
  rejection_reason?: string | null;
  /** Axe de faîtière suggéré par le MVP (aide d'orientation). */
  ridge_axis_px?: [number, number][];
  /** Scores bruts du MVP (structural / ridge_visible / symmetry…). */
  scores?: Record<string, number>;
}

/** Une section active = un pan de toit de la vérité-entrée. */
export interface RoofSectionInput {
  pts: RoofPoint[];
  closed: true;
  /** Pente en X/12. */
  pitch: number;
  /** Élévation de base (unités image). Défaut 0. */
  elev: number;
  /** Hauteur de faîte forcée (0 = auto via skeleton). Défaut 0. */
  hf: number;
  roof_type: RoofType;
  /** Provenance MVP (ignorée par le moteur). */
  meta?: RoofSectionMeta;
}

/** Provenance d'une calibration d'échelle. */
export type ScaleSource = 'georef' | 'manual' | 'none';

/** Bloc géoréférence d'une capture Web-Mercator. */
export interface RoofGeoref {
  zoom: number;
  center_lat: number;
  center_lng?: number;
  /** Facteur d'échelle de la capture (1 ou 2). 2 = image ré-échantillonnée. */
  scale_param: number;
  image_w: number;
  image_h: number;
  /** Fournisseur d'imagerie ("google" | "ortho" | …). */
  provider?: string;
}

/** Échelle px → pieds attachée au modèle. */
export interface RoofModelScale {
  /** 1 unité-image (px) = X pieds. */
  ft_per_px: number;
  /** 1 pied = X px (= 1 / ft_per_px). */
  px_per_ft: number;
  source: ScaleSource;
  /** 0..1 (georef ≈ 0.9, manual ≈ calibration_confidence, none = 0). */
  confidence: number;
  provider?: string;
  georef?: RoofGeoref;
}

export type RoofModelSource = 'mvp_auto' | 'human_corrected' | 'ground_truth' | 'solar';
export type RoofModelStatus =
  | 'auto_candidate'
  | 'needs_review'
  | 'validated'
  | 'rejected';

export interface RoofModelMetadata {
  source: RoofModelSource;
  status: RoofModelStatus;
  /** Version du moteur roof-core ayant produit/consommé le modèle. */
  engine_version?: string;
  /** Version du schéma MVP d'origine (ex "sections-1.6.0"). */
  mvp_version?: string;
  /** Mode de sélection du MVP (conservative par défaut). */
  selection_mode?: string;
  /** Typologie estimée par le MVP (ex "with_dormer", "single_addon"). */
  typology?: string;
  /** Axes principaux estimés par le MVP (degrés). */
  primary_axis_deg?: number;
  secondary_axis_deg?: number;
  /** Lignée : id du modèle parent (correction humaine = nouveau modèle). */
  parent_model_id?: string;
  /** Quality Google Solar API quand source = 'solar' (HIGH | MEDIUM | LOW | BASE). */
  solar_imagery_quality?: 'HIGH' | 'MEDIUM' | 'LOW' | 'BASE';
  /** Date de l'imagerie Solar (YYYY-MM-DD), purement informative. */
  solar_imagery_date?: string;
}

/** Section proposée mais NON active : dessinée en fantôme (pointillé/or),
 *  jamais envoyée au moteur (donc pas dans la 3D ni les mesures ni le take-off). */
export type RoofAlternative = RoofSectionInput & { _alt: RoofSectionMeta };

export interface RoofModel {
  version: typeof ROOF_MODEL_VERSION;
  image?: { width: number; height: number; scale_factor?: number };
  scale?: RoofModelScale;
  /** Les seules sections ENVOYÉES au moteur 3D (vérité géométrique active). */
  sections: RoofSectionInput[];
  /** Suggestions visibles dans le lab uniquement. Hors géométrie/métriques. */
  alternatives?: RoofAlternative[];
  metadata: RoofModelMetadata;
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Helpers calibration (purs, testables sans DOM)                          */
/* ──────────────────────────────────────────────────────────────────────── */

/** Mètres par pixel (Web-Mercator) à scale=1 pour un zoom/latitude donnés. */
export function metersPerPxAtScale1(centerLat: number, zoom: number): number {
  return (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / Math.pow(2, zoom);
}

const M_TO_FT = 3.28084;

/** Pieds par pixel à partir de la géoréférence (scale_param divise le m/px). */
export function ftPerPxFromGeoref(geo: Pick<RoofGeoref, 'zoom' | 'center_lat' | 'scale_param'>): number {
  const mPerPx = metersPerPxAtScale1(geo.center_lat, geo.zoom) / (geo.scale_param || 1);
  return mPerPx * M_TO_FT;
}

/** Conversion pente degrés → X/12, bornée [1,12]. Utilitaire pour les sources
 *  qui exposent une pente en degrés (le MVP v1.6, lui, donne déjà du X/12). */
export function degToX12(pitchDeg: number): number {
  const x = Math.round(Math.tan((pitchDeg * Math.PI) / 180) * 12);
  return Math.max(1, Math.min(12, x));
}
