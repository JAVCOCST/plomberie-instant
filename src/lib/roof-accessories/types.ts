// Roof accessories — data layer aligned on the Maximum builder Phase 0 contracts
// (max-301.product-spec.json + accessory-anchor.schema). Pure, no DOM.
//
// An AccessoryInstance is attached TO the roof but is NEVER a roof section. It
// lives in RoofModel.accessories[] and survives save / reload / round-trip.
//
// ANCHOR = the only persisted truth (geometry-derived at runtime; world position
// is never the primary truth). IDs are STABLE STRINGS, never numeric indices.
// Dimensions are NOT snapshotted on the instance — runtime reads the ProductSpec
// by product_id + variant_id (single source of truth).

export const ACCESSORIES_SCHEMA_VERSION = 1;
export const ANCHOR_VERSION = "1.0.0";
export const MAX_301_PRODUCT_ID = "ventilation-maximum.max-301";

export type VariantId =
  | "301-12" | "301-14" | "301-16" | "301-18" | "301-20" | "301-22" | "301-24";

export type AnchorEdgeType = "ridge" | "hip" | "valley" | "eave";
export type PanSide = "primary" | "secondary";

export interface Vec3 { x: number; y: number; z: number }

/* ── ANCHOR (accessory-anchor.schema) — persisted truth ────────────────────── */

export type FallbackStrategy =
  | "nearest_ridge_in_section" | "nearest_ridge_global"
  | "preserve_world_position" | "none";

export interface FallbackAnchor {
  strategy: FallbackStrategy;
  last_resolved_world_pos?: (Vec3 & { resolved_at?: string }) | null;
  max_search_radius_mm?: number;
}

export type OrphanReason =
  | "edge_not_found" | "section_not_found" | "edge_not_adjacent_to_section"
  | "slope_out_of_supported_range" | "fallback_failed" | "schema_migration_failed";

export interface OrphanState {
  reason: OrphanReason;
  orphaned_at: string;
  last_known_world_pos?: Vec3;
}

export interface AccessoryAnchor {
  anchor_version: string;       // "1.0.0"
  section_id: string;           // stable string id, never numeric index
  edge_id: string;              // stable string id, never numeric index
  edge_t: number;               // 0..1 along the edge (endpoint_a→endpoint_b)
  slope_offset_mm: number;      // ≥ 0, downslope from the edge, in the pan plane
  pan_side: PanSide;            // which adjacent pan ("primary"/"secondary")
  fallback_anchor?: FallbackAnchor | null;
  /** Recovery position in source-image pixels (Phase 2 placement). */
  fallback_anchor_px?: { x: number; y: number } | null;
  orphan_state?: OrphanState | null;
}

/* ── INSTANCE (RoofModel.accessories[]) ────────────────────────────────────── */

export interface AccessoryInstance {
  id: string;
  type: "roof_accessory";
  product_id: string;           // → ProductSpec.product_id
  variant_id: VariantId | string;
  anchor: AccessoryAnchor;
  parameters?: { color_id?: string;[k: string]: any };
  overrides?: { accepted_warnings: any[] };
  metadata?: { created_at: string; created_by?: string; modified_at?: string };
  /** Runtime/persisted flag: true when the target section/edge can't be resolved. */
  accessory_orphaned?: boolean;
}

/* ── PRODUCT SPEC (max-301.product-spec.json) ──────────────────────────────── */

export interface VariantDimensionsOfficial {
  A_col_mm: number; A_col_in: number;
  B_deflector_mm: number; B_deflector_in: number;
  C_total_height_mm: number; C_total_height_in: number;
  D_flashing_downslope_mm: number; D_flashing_downslope_in: number;
  confidence: string; source?: string;
}
export interface VariantVentilationOfficial {
  nfa_sqin: number; nfa_m2: number; nfa_sqft: number; confidence: string;
}
export interface VariantSpec {
  label: string;
  size_in: number;
  is_default?: boolean;
  is_standard_stock: boolean;
  dimensions_official: VariantDimensionsOfficial;
  ventilation_official: VariantVentilationOfficial;
  construction_official: { deflector_count: number; steel_gauge: string; confidence: string };
  special_order: boolean;
}
/** The whole spec doc is loosely typed (read-only contract); variants are typed. */
export interface ProductSpecDoc {
  product_id: string;
  product_family: string;
  variants: Record<string, VariantSpec>;
  placement_rules: any;
  ventilation_rules: any;
  geometry_rules: any;
  ui_hints: any;
  [k: string]: any;
}

/* ── SOFFIT (roof-level) ───────────────────────────────────────────────────── */

export interface SoffitVentilation {
  ventilation_area_sq_in: number | null;
  ventilated_length_ft: number | null;
  ventilated_width_in: number | null;
  open_ratio: number | null;
  source: "manual" | "estimated" | "imported";
  confidence: "low" | "medium" | "high";
  notes: string;
}

/* ── Ventilation validation I/O ────────────────────────────────────────────── */

export type VentRule = "1/300" | "1/150";

export interface VentilationInput {
  rule: VentRule;
  atticAreaSqft: number | null;
  intakeRatio?: number;
  calibrationPresent: boolean;
  installed: { variant_id: string; nfa_sq_in: number | null }[];
  soffit?: SoffitVentilation | null;
}

export interface VentilationSummary {
  rule: VentRule;
  status: "ok" | "warn" | "insufficient" | "calibration_required" | "unknown";
  attic_area_sqft: number | null;
  required_total_nfa_sq_in: number | null;
  required_exhaust_nfa_sq_in: number | null;
  required_intake_nfa_sq_in: number | null;
  provided_exhaust_nfa_sq_in: number | null;
  provided_intake_nfa_sq_in: number | null;
  count_installed: number;
  count_required: number | null;
  ventilation_balance_status: "ok" | "warn" | "insufficient" | "unknown";
  warnings: { code: string; message: string }[];
}
