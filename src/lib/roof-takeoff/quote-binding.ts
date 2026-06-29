// quote-binding.ts — the ONE projection point from the takeoff into the quote.
//
// Returns a Partial<FormData> patch. Type-only import of FormData keeps this
// decoupled from the quote runtime (no FormContext, no pricing). The wizard glue
// merges this via updateData(); roof-takeoff never reaches into the quote.
import type { FormData } from "@/types/roofing";
import type { RoofTakeoff } from "./types";

/**
 * Project a takeoff onto the quote form fields.
 * Billing surface (Q1): the REAL sloped roof area (roof3dAreaSqft), not the
 * footprint — that is the area actually covered with material. Rounded to the
 * nearest sqft. slope/complexity come from the pricing inputs.
 */
export function toFormDataPatch(t: RoofTakeoff): Partial<FormData> {
  const p = t.pricing;
  return {
    area: Math.round(p.roof3dAreaSqft),
    areaUnit: "sqft",
    slope: p.slopeLevel,
    complexity: p.complexityLevel,
    // Optional, non-destructive carriers (see FormData extension).
    roofTakeoff: t,
    roofModel: t.geometry.snapshot.roofModel,
  };
}
