import { describe, it, expect } from "vitest";
import type { RoofModel } from "@/lib/roof-core/types";
import { fromRoofModel } from "./factory";
import { toFormDataPatch } from "./quote-binding";

const model: RoofModel = {
  version: 1,
  sections: [
    { pts: [{ x: 66, y: 94.05 }, { x: 374, y: 94.05 }, { x: 374, y: 532.95 }, { x: 66, y: 532.95 }], closed: true, pitch: 7, elev: 0, hf: 0, roof_type: "hip" },
  ],
  scale: { ft_per_px: 0.1, px_per_ft: 10, source: "georef", confidence: 0.9 },
  metadata: { source: "human_corrected", status: "validated" },
};

describe("toFormDataPatch", () => {
  const t = fromRoofModel(model);
  const patch = toFormDataPatch(t);

  it("projects the real sloped area in sqft + slope + complexity", () => {
    expect(patch.areaUnit).toBe("sqft");
    expect(patch.area).toBe(Math.round(t.pricing.roof3dAreaSqft));
    expect(patch.area).toBeGreaterThan(0);
    expect(patch.slope).toBe("7-9");
    expect(patch.complexity).toBe("simple");
  });
  it("carries the takeoff + the source RoofModel (non-destructive)", () => {
    expect(patch.roofTakeoff).toBe(t);
    expect(patch.roofModel).toBe(t.geometry.snapshot.roofModel);
  });
  it("is a partial patch (no unrelated quote fields)", () => {
    expect(patch).not.toHaveProperty("client");
    expect(patch).not.toHaveProperty("product");
    expect(Object.keys(patch).sort()).toEqual(["area", "areaUnit", "complexity", "roofModel", "roofTakeoff", "slope"]);
  });
});
