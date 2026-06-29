/**
 * Adaptateur MVP roof_sections v1.6 → RoofModel.
 *
 * Contrat d'intégration (schema_version "sections-1.6.x") :
 *   - selection_status === "kept"        → section ACTIVE (vérité géométrique)
 *   - selection_status === "alternative" → suggestion (fantôme, HORS géométrie)
 *   - selection_status === "rejected"    → debug only (jamais dans le modèle)
 *
 * Règles critiques (cf. contrat §10) :
 *   - selection_status est la SEULE vérité d'import.
 *   - relationship_type / parent_id / pair_relations / n_rejected_as_gutter
 *     ne décident JAMAIS de l'activation (metadata seulement).
 *   - S1 (sections[0]) est toujours le main, toujours actif.
 *   - on n'auto-promeut PAS les alternatives.
 *
 * Coordonnées : `points` sont déjà en PIXELS image (origine haut-gauche, Y vers
 * le bas) → AUCUNE projection. `pitch` est déjà en X/12 (défaut 7). La capture
 * (optionnelle) ne sert qu'à la calibration px→pi (scale) et aux dimensions
 * image. Aucune dépendance moteur/DOM : ce fichier ne peut pas régresser le traceur.
 */

import {
  RoofModel,
  RoofSectionInput,
  RoofSectionMeta,
  RoofAlternative,
  RoofPoint,
  RoofType,
  ROOF_MODEL_VERSION,
  ftPerPxFromGeoref,
} from '../types';

/* ── Entrée MVP v1.6 (schéma réel, permissif sur les champs optionnels) ──── */

export type V16SelectionStatus = 'kept' | 'alternative' | 'rejected';
export type V16RoofType = '2_pans' | '4_pans' | 'mixed';
type Pt = [number, number];

export interface MvpSection {
  id: string;
  role: 'main' | 'ridge_candidate';
  experimental?: boolean;
  points: Pt[];
  ridge_axis_px?: Pt[];
  source_ridge?: Pt[];

  selection_status: V16SelectionStatus;
  selection_reason?: string | null;
  rejection_reason?: string | null;

  relationship_type?: string | null;
  parent_id?: string | null;
  group_id?: string | null;
  top_k_alternatives?: string[];
  related_ids?: string[];
  pruned_by?: [string | null, string][];

  structural_score?: number;
  ridge_visible_score?: number;
  plane_symmetry_score?: number;
  ridge_internality_score?: number;

  axis?: 'primary' | 'secondary';
  ridge_type?: 'internal' | 'peripheral';
  n_sides_with_peak?: number;
  semantic_order_valid?: boolean;
  rejected_as_gutter?: boolean;

  roof_type?: V16RoofType;
  pitch?: number;

  kept_by_nms?: boolean;
  would_have_been_selected?: boolean;
}

export interface MvpRoofSectionsOutput {
  schema_version: string;
  primary_axis_deg?: number;
  secondary_axis_deg?: number;
  sections: MvpSection[];
  detected_typology?: string;
  selection_mode?: string;
  [k: string]: unknown;
}

/** Sous-ensemble de CaptureParams nécessaire à la calibration px→pi. */
export interface CaptureLike {
  centerLat: number;
  centerLng?: number;
  zoom: number;
  width: number;
  height: number;
  /** 1 ou 2. Défaut 1 (Google force scale=1). */
  scale_param?: number;
  /** "google" | "ortho" … */
  provider?: string;
}

export interface MapResult {
  model: RoofModel;
  /** Sections rejetées par le MVP — debug only, hors modèle. */
  rejected: MvpSection[];
}

/* ── Conversions ─────────────────────────────────────────────────────────── */

function toPts(points: Pt[]): RoofPoint[] {
  return (points || []).map((p) => ({ x: p[0], y: p[1] }));
}

/** 2_pans → gable (pignons aux extrémités) ; 4_pans / mixed → hip. */
function toRoofType(rt?: V16RoofType): RoofType {
  return rt === '2_pans' ? 'gable' : 'hip';
}

function metaOf(s: MvpSection, isMain: boolean): RoofSectionMeta {
  const scores: Record<string, number> = {};
  if (s.structural_score != null) scores.structural = s.structural_score;
  if (s.ridge_visible_score != null) scores.ridge_visible = s.ridge_visible_score;
  if (s.plane_symmetry_score != null) scores.plane_symmetry = s.plane_symmetry_score;
  if (s.ridge_internality_score != null) scores.ridge_internality = s.ridge_internality_score;
  return {
    source_id: s.id,
    role: s.role,
    // S1 = 1.0 par convention ; sinon structural_score (défaut 0.5).
    confidence: isMain ? 1.0 : s.structural_score ?? 0.5,
    relationship_type: s.relationship_type ?? null,
    parent_id: s.parent_id ?? null,
    group_id: s.group_id ?? null,
    top_k_alternatives: s.top_k_alternatives ?? [],
    related_ids: s.related_ids ?? [],
    selection_reason: s.selection_reason ?? null,
    rejection_reason: s.rejection_reason ?? null,
    ridge_axis_px: s.ridge_axis_px,
    scores,
  };
}

function toSection(s: MvpSection, isMain: boolean): RoofSectionInput {
  return {
    pts: toPts(s.points),
    closed: true,
    pitch: s.pitch ?? 7,
    elev: 0,
    hf: 0,
    roof_type: toRoofType(s.roof_type),
    meta: metaOf(s, isMain),
  };
}

/* ── Validation (cf. contrat §7 invariants 1–6) ────────────────────────────── */

function validate(data: MvpRoofSectionsOutput): void {
  if (!data || typeof data.schema_version !== 'string' || !data.schema_version.startsWith('sections-1.6')) {
    throw new Error('Unsupported MVP schema (expected sections-1.6.x)');
  }
  if (!Array.isArray(data.sections) || data.sections.length < 1) {
    throw new Error('Missing sections');
  }
  const main = data.sections[0];
  if (main.id !== 'S1' || main.role !== 'main' || main.selection_status !== 'kept') {
    throw new Error('Invalid MVP main section (sections[0] must be S1/main/kept)');
  }
}

/**
 * Convertit une sortie MVP v1.6 en RoofModel canonique.
 *
 * - S1 + kept → `sections` (actives)
 * - alternative → `alternatives` (fantômes, hors moteur)
 * - rejected → `rejected` (debug, hors modèle)
 *
 * Si `capture` est fourni, calcule `scale` (georef) + `image` pour la
 * calibration px → pieds en aval. Lève une erreur si le schéma est invalide.
 */
export function fromRoofSectionsV16(data: MvpRoofSectionsOutput, capture?: CaptureLike): MapResult {
  validate(data);

  const sections: RoofSectionInput[] = [];
  const alternatives: RoofAlternative[] = [];
  const rejected: MvpSection[] = [];

  data.sections.forEach((s, idx) => {
    const isMain = idx === 0;
    switch (s.selection_status) {
      case 'kept':
        sections.push(toSection(s, isMain));
        break;
      case 'alternative': {
        const base = toSection(s, false);
        alternatives.push(Object.assign(base, { _alt: base.meta as RoofSectionMeta }));
        break;
      }
      case 'rejected':
        rejected.push(s);
        break;
      default:
        // statut inconnu → traité comme rejeté (debug), jamais actif.
        rejected.push(s);
    }
  });

  const model: RoofModel = {
    version: ROOF_MODEL_VERSION,
    sections,
    metadata: {
      source: 'mvp_auto',
      status: 'auto_candidate',
      mvp_version: data.schema_version,
      selection_mode: data.selection_mode ?? 'conservative',
      typology: data.detected_typology,
      primary_axis_deg: data.primary_axis_deg,
      secondary_axis_deg: data.secondary_axis_deg,
    },
  };

  if (alternatives.length) model.alternatives = alternatives;

  if (capture) {
    const scale_param = capture.scale_param ?? 1;
    const ft_per_px = ftPerPxFromGeoref({ zoom: capture.zoom, center_lat: capture.centerLat, scale_param });
    model.image = { width: capture.width, height: capture.height, scale_factor: scale_param };
    model.scale = {
      ft_per_px,
      px_per_ft: ft_per_px ? 1 / ft_per_px : 0,
      source: 'georef',
      confidence: 0.9,
      provider: capture.provider,
      georef: {
        zoom: capture.zoom,
        center_lat: capture.centerLat,
        center_lng: capture.centerLng,
        scale_param,
        image_w: capture.width,
        image_h: capture.height,
        provider: capture.provider,
      },
    };
  } else {
    model.scale = { ft_per_px: 0, px_per_ft: 0, source: 'none', confidence: 0 };
  }

  return { model, rejected };
}
