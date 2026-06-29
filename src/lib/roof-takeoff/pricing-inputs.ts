// pricing-inputs.ts — strate D from B (+ C overrides).
//
// Produces inputs in the exact units the quote pricing consumes (sqft, ft,
// counts) WITHOUT importing pricing-matrix / dynasty-calculator. roof-takeoff
// supplies inputs; it never computes a price.
import type { ComplexityLevel } from "@/types/roofing";
import type { RoofTakeoff, PricingInputs } from "./types";

const M2_TO_SQFT = 10.76391;
const M_TO_FT = 3.28084;
const DEFAULT_WASTE_PCT = 10;   // aligned with dynasty contingency default

/** Heuristic complexity from geometry (overridable by the human). */
export function deriveComplexity(sectionCount: number, valleyCount: number): ComplexityLevel {
  const score = sectionCount + valleyCount * 1.5;
  if (sectionCount <= 1 && valleyCount === 0) return "simple";
  if (score <= 3) return "moyenne";
  if (score <= 6) return "complexe";
  return "tres_complexe";
}

/** Build the consumable pricing inputs from a takeoff (D ← B + C). */
export function buildPricingInputs(t: RoofTakeoff): PricingInputs {
  const mm = t.derived.measurements;
  const biz = t.business;

  const slopeLevel = biz.slopeOverride || mm.dominantSlopeLevel;
  const complexityLevel = biz.complexityOverride || deriveComplexity(mm.sectionCount, t.derived.valleys.length);

  const accessoryCounts: Record<string, number> = {};
  (biz.accessories || []).forEach((a) => { const k = a.kind || a.catalogId || "autre"; accessoryCounts[k] = (accessoryCounts[k] || 0) + (a.quantity || 0); });
  (biz.penetrations || []).forEach((p) => { if (p.countAsUnit) { const k = p.kind || "penetration"; accessoryCounts[k] = (accessoryCounts[k] || 0) + 1; } });

  const hasOverrides = !!(biz.slopeOverride || biz.complexityOverride || (biz.overrides && biz.overrides.length));

  return {
    footprintAreaSqft: mm.footprintAreaM2 * M2_TO_SQFT,
    roof3dAreaSqft: mm.roof3dAreaM2 * M2_TO_SQFT,
    perimeterFt: mm.totalPerimeterM * M_TO_FT,
    slopeLevel,
    complexityLevel,
    linealFt: {
      ridge: mm.linealByKind.RIDGE * M_TO_FT,
      hip: mm.linealByKind.HIP * M_TO_FT,
      valley: mm.linealByKind.VALLEY * M_TO_FT,
      eave: mm.linealByKind.EAVE * M_TO_FT,
      rake: mm.linealByKind.RAKE * M_TO_FT,
    },
    accessoryCounts,
    wasteFactorPct: DEFAULT_WASTE_PCT,
    source: hasOverrides ? "derived_with_overrides" : "derived",
  };
}
