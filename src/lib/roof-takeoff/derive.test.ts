import { describe, it, expect } from "vitest";
import type { RoofModel } from "@/lib/roof-core/types";
import { deriveRoofTakeoff, slopeLevelFromX12, x12ToDeg, metersPerPxOf, isDerivedStale } from "./derive";
import { fromRoofModel } from "./factory";

// A calibrated single hip rectangle (1px = 0.1 ft).
const calibratedModel: RoofModel = {
  version: 1,
  sections: [
    { pts: [{ x: 66, y: 94.05 }, { x: 374, y: 94.05 }, { x: 374, y: 532.95 }, { x: 66, y: 532.95 }], closed: true, pitch: 7, elev: 0, hf: 0, roof_type: "hip" },
  ],
  scale: { ft_per_px: 0.1, px_per_ft: 10, source: "georef", confidence: 0.9 },
  metadata: { source: "human_corrected", status: "validated" },
};

describe("slopeLevelFromX12", () => {
  it("maps X/12 to the QC slope categories", () => {
    expect(slopeLevelFromX12(2)).toBe("flat");
    expect(slopeLevelFromX12(5)).toBe("4-7");
    expect(slopeLevelFromX12(7)).toBe("7-9");
    expect(slopeLevelFromX12(10)).toBe("9-12");
    expect(slopeLevelFromX12(12)).toBe("12+");
  });
  it("x12ToDeg is monotonic and ~30° at 7/12", () => {
    expect(x12ToDeg(7)).toBeCloseTo(30.26, 1);
    expect(x12ToDeg(12)).toBeCloseTo(45, 1);
  });
});

describe("deriveRoofTakeoff (calibrated)", () => {
  const d = deriveRoofTakeoff(calibratedModel, "2026-05-26T00:00:00.000Z");

  it("produces metric measurements with sloped area > footprint", () => {
    expect(d.measurements.footprintAreaM2).toBeGreaterThan(0);
    expect(d.measurements.roof3dAreaM2).toBeGreaterThan(d.measurements.footprintAreaM2);
    // hip at 7/12 → ratio ≈ 1/cos(30.26°) ≈ 1.16
    expect(d.measurements.roof3dAreaM2 / d.measurements.footprintAreaM2).toBeCloseTo(1.157, 1);
  });
  it("derives dominant pitch/slope and section metrics", () => {
    expect(d.measurements.dominantPitchX12).toBe(7);
    expect(d.measurements.dominantSlopeLevel).toBe("7-9");
    expect(d.measurements.sectionCount).toBe(1);
    expect(d.sections[0].pitchX12).toBe(7);
    expect(d.sections[0].area3dM2).toBeGreaterThan(d.sections[0].areaFootprintM2);
    expect(d.sections[0].quality).toBe("ESTIMATED");
  });
  it("eaves perimeter is positive and stamps the snapshot time", () => {
    expect(d.measurements.totalPerimeterM).toBeGreaterThan(0);
    expect(d.measurements.linealByKind.EAVE).toBeGreaterThan(0);
    expect(d.derivedFromSnapshotAt).toBe("2026-05-26T00:00:00.000Z");
    expect(d.measurements.diagnostics.warnings).toHaveLength(0);
  });
});

describe("deriveRoofTakeoff (uncalibrated)", () => {
  it("yields zero real-world measures + a warning", () => {
    const model: RoofModel = { ...calibratedModel, scale: undefined };
    expect(metersPerPxOf(model)).toBe(0);
    const d = deriveRoofTakeoff(model, "t");
    expect(d.measurements.footprintAreaM2).toBe(0);
    expect(d.measurements.roof3dAreaM2).toBe(0);
    expect(d.measurements.diagnostics.warnings.join(" ")).toMatch(/uncalibrated/);
    expect(d.sections[0].quality).toBe("UNCERTAIN");
  });
});

describe("isDerivedStale", () => {
  it("is false right after fromRoofModel, true if the snapshot changes", () => {
    const t = fromRoofModel(calibratedModel);
    expect(isDerivedStale(t)).toBe(false);
    t.geometry.snapshot.snapshotAt = "different";
    expect(isDerivedStale(t)).toBe(true);
  });
});
