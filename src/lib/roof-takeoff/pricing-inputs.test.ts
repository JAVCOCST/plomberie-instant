import { describe, it, expect } from "vitest";
import type { RoofModel } from "@/lib/roof-core/types";
import { fromRoofModel } from "./factory";
import { buildPricingInputs, deriveComplexity } from "./pricing-inputs";

const model: RoofModel = {
  version: 1,
  sections: [
    { pts: [{ x: 66, y: 94.05 }, { x: 374, y: 94.05 }, { x: 374, y: 532.95 }, { x: 66, y: 532.95 }], closed: true, pitch: 7, elev: 0, hf: 0, roof_type: "hip" },
  ],
  scale: { ft_per_px: 0.1, px_per_ft: 10, source: "georef", confidence: 0.9 },
  metadata: { source: "human_corrected", status: "validated" },
};

describe("deriveComplexity", () => {
  it("scales with sections and valleys", () => {
    expect(deriveComplexity(1, 0)).toBe("simple");
    expect(deriveComplexity(2, 0)).toBe("moyenne");
    expect(deriveComplexity(2, 1)).toBe("complexe");
    expect(deriveComplexity(5, 3)).toBe("tres_complexe");
  });
});

describe("buildPricingInputs", () => {
  const t = fromRoofModel(model);
  const p = buildPricingInputs(t);

  it("converts metric derived measures to imperial pricing inputs", () => {
    expect(p.roof3dAreaSqft).toBeCloseTo(t.derived.measurements.roof3dAreaM2 * 10.76391, 3);
    expect(p.footprintAreaSqft).toBeCloseTo(t.derived.measurements.footprintAreaM2 * 10.76391, 3);
    expect(p.perimeterFt).toBeCloseTo(t.derived.measurements.totalPerimeterM * 3.28084, 3);
    expect(p.linealFt.eave).toBeGreaterThan(0);
  });
  it("defaults: slope from geometry, waste 10%, source 'derived'", () => {
    expect(p.slopeLevel).toBe("7-9");
    expect(p.complexityLevel).toBe("simple");
    expect(p.wasteFactorPct).toBe(10);
    expect(p.source).toBe("derived");
  });
  it("honours human overrides and flips the source", () => {
    const t2 = fromRoofModel(model);
    t2.business.slopeOverride = "12+";
    t2.business.complexityOverride = "complexe";
    const p2 = buildPricingInputs(t2);
    expect(p2.slopeLevel).toBe("12+");
    expect(p2.complexityLevel).toBe("complexe");
    expect(p2.source).toBe("derived_with_overrides");
  });
  it("counts accessories and unit penetrations", () => {
    const t3 = fromRoofModel(model);
    t3.business.accessories = [
      { id: "a1", kind: "max-301", quantity: 2, unit: "unite" },
      { id: "a2", kind: "max-301", quantity: 1, unit: "unite" },
    ];
    t3.business.penetrations = [{ id: "p1", kind: "cheminee", countAsUnit: true }];
    const p3 = buildPricingInputs(t3);
    expect(p3.accessoryCounts["max-301"]).toBe(3);
    expect(p3.accessoryCounts["cheminee"]).toBe(1);
  });
});
