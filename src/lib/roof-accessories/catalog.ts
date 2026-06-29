// Maximum 301 catalog — single source of truth = max-301.product-spec.json.
// Runtime reads dimensions / NFA here; nothing is hardcoded elsewhere.

import specJson from "./max-301.product-spec.json";
import { ProductSpecDoc, VariantSpec, VariantId } from "./types";

export const MAX_301_SPEC = specJson as unknown as ProductSpecDoc;

export const VARIANT_IDS: VariantId[] = Object.keys(MAX_301_SPEC.variants) as VariantId[];

export function getVariant(id: string): VariantSpec | null {
  return MAX_301_SPEC.variants[id] || null;
}

export function nfaSqInOf(id: string): number | null {
  const v = getVariant(id);
  return v ? v.ventilation_official.nfa_sqin : null;
}

export function nfaSqFtOf(id: string): number | null {
  const v = getVariant(id);
  return v ? v.ventilation_official.nfa_sqft : null;
}

/** Minimum downslope offset from the ridge (mm), per the spec auto-compute rule:
 *  max(min_distance_from_ridge_mm, (A + flange_margin_mm) / 2 + 30). */
export function defaultSlopeOffsetMm(variantId: string): number {
  const v = getVariant(variantId);
  const rules = MAX_301_SPEC.placement_rules && MAX_301_SPEC.placement_rules.ridge;
  const minRidge = (rules && rules.min_distance_from_ridge_mm) || 305;
  const flangeMargin = (MAX_301_SPEC.geometry_rules && MAX_301_SPEC.geometry_rules.derived_parameters && MAX_301_SPEC.geometry_rules.derived_parameters.flange_margin_mm) || 90;
  const A = v ? v.dimensions_official.A_col_mm : 0;
  return Math.max(minRidge, (A + flangeMargin) / 2 + 30);
}
