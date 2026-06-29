// Accessory anchor schema validation (accessory-anchor.schema v1.0.0).
//
// The anchor is the persisted truth. Runtime world position is DERIVED from the
// edge geometry + roof frame + anchor — never stored as the primary truth.
// section_id / edge_id MUST be stable strings, never numeric indices.

import { AccessoryAnchor, AnchorEdgeType, PanSide, FallbackStrategy, ANCHOR_VERSION } from "./types";

const PAN_SIDES: PanSide[] = ["primary", "secondary"];
const FALLBACK_STRATEGIES: FallbackStrategy[] = ["nearest_ridge_in_section", "nearest_ridge_global", "preserve_world_position", "none"];
const isNumericIndex = (v: any) => /^\d+$/.test(String(v));

export interface AnchorValidation { ok: boolean; errors: string[] }

export function validateAnchor(a: any): AnchorValidation {
  const e: string[] = [];
  if (!a || typeof a !== "object") return { ok: false, errors: ["anchor manquant"] };

  if (typeof a.anchor_version !== "string" || !a.anchor_version) e.push("anchor_version doit être une string (ex. '1.0.0')");

  if (typeof a.section_id !== "string" || !a.section_id) e.push("section_id doit être une string stable");
  else if (isNumericIndex(a.section_id)) e.push("section_id ne doit pas être un index numérique");

  if (typeof a.edge_id !== "string" || !a.edge_id) e.push("edge_id doit être une string stable");
  else if (isNumericIndex(a.edge_id)) e.push("edge_id ne doit pas être un index numérique");

  if (typeof a.edge_t !== "number" || a.edge_t < 0 || a.edge_t > 1) e.push("edge_t doit être dans [0,1]");
  if (typeof a.slope_offset_mm !== "number" || !isFinite(a.slope_offset_mm) || a.slope_offset_mm < 0) e.push("slope_offset_mm doit être un nombre ≥ 0 (mm)");
  if (PAN_SIDES.indexOf(a.pan_side) < 0) e.push("pan_side doit être 'primary' ou 'secondary'");

  if (a.fallback_anchor != null) {
    if (typeof a.fallback_anchor !== "object") e.push("fallback_anchor invalide");
    else if (a.fallback_anchor.strategy != null && FALLBACK_STRATEGIES.indexOf(a.fallback_anchor.strategy) < 0) e.push("fallback_anchor.strategy invalide");
  }

  return { ok: e.length === 0, errors: e };
}

/** Build a fresh anchor (edge_id derived as a stable string id). */
export function makeAnchor(opts: {
  section_id: string;
  edge_type?: AnchorEdgeType;
  edge_index?: number;
  edge_t?: number;
  slope_offset_mm?: number;
  pan_side?: PanSide;
  fallback_strategy?: FallbackStrategy;
}): AccessoryAnchor {
  const edge_type = opts.edge_type || "ridge";
  return {
    anchor_version: ANCHOR_VERSION,
    section_id: opts.section_id,
    edge_id: `${opts.section_id}:${edge_type}:${opts.edge_index ?? 0}`,
    edge_t: opts.edge_t ?? 0.5,
    slope_offset_mm: opts.slope_offset_mm ?? 305,
    pan_side: opts.pan_side || "primary",
    fallback_anchor: { strategy: opts.fallback_strategy || "nearest_ridge_in_section", last_resolved_world_pos: null, max_search_radius_mm: 2000 },
    orphan_state: null,
  };
}
