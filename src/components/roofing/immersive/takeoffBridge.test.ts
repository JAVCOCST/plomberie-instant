import { describe, it, expect } from "vitest";
import { studioModelToRoofModel, imageryFromModel, buildTakeoffFromStudio, isBlocking } from "./takeoffBridge";

// What AdminRoofStudio emits via onValidate (v2 annotation object).
const emitted = {
  version: 2,
  name: "546 Rue Trépanier",
  sections: [
    { pts: [{ x: 66, y: 94.05 }, { x: 374, y: 94.05 }, { x: 374, y: 532.95 }, { x: 66, y: 532.95 }], pitch: 7, elev: 0, hf: 0, roof_type: "hip", source: "human" },
  ],
  calibration: { gsd: 0.05242263642306041, unit: "m", source: "georef:google" },
  georef: { provider: "google", center_lat: 45.389, center_lng: -72.692, zoom: 20, image_w: 1280, image_h: 1280, scale: 2, north_up: true, bearing_deg: 0 },
  image: { name: "google.png", width: 1280, height: 1280 },
  metadata: { source: "human_corrected", status: "validated" },
};

describe("studioModelToRoofModel", () => {
  it("adapts the v2 annotation into a roof-core RoofModel (v1)", () => {
    const m = studioModelToRoofModel(emitted);
    expect(m.version).toBe(1);
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0].closed).toBe(true);
    expect(m.sections[0].roof_type).toBe("hip");
    expect(m.image).toEqual({ width: 1280, height: 1280 });
    // gsd (m/px) → ft_per_px
    expect(m.scale!.ft_per_px).toBeCloseTo(0.05242263642306041 * 3.28084, 6);
    expect(m.scale!.source).toBe("georef");
    expect(m.scale!.georef!.zoom).toBe(20);
  });
  it("yields no scale when uncalibrated", () => {
    const m = studioModelToRoofModel({ ...emitted, calibration: undefined, georef: undefined });
    expect(m.scale).toBeUndefined();
  });
});

describe("imageryFromModel", () => {
  it("maps the provider and center", () => {
    const img = imageryFromModel(emitted)!;
    expect(img.provider).toBe("google_satellite");
    expect(img.centerLat).toBe(45.389);
    expect(img.zoom).toBe(20);
  });
  it("is null without georef", () => {
    expect(imageryFromModel({ ...emitted, georef: undefined })).toBeNull();
  });
});

describe("buildTakeoffFromStudio", () => {
  it("produces a non-blocking takeoff + a FormData patch (calibrated)", () => {
    const { takeoff, validation, patch } = buildTakeoffFromStudio(emitted);
    expect(takeoff.derived.measurements.roof3dAreaM2).toBeGreaterThan(0);
    expect(isBlocking(validation)).toBe(false);
    expect(patch.areaUnit).toBe("sqft");
    expect(patch.area).toBe(Math.round(takeoff.pricing.roof3dAreaSqft));
    expect(patch.slope).toBe("7-9");
    expect(patch.roofTakeoff).toBe(takeoff);
    expect(patch.roofModel).toBe(takeoff.geometry.snapshot.roofModel);
  });
  it("blocks (error) when the model is uncalibrated → no real area", () => {
    const { validation } = buildTakeoffFromStudio({ ...emitted, calibration: undefined, georef: undefined });
    expect(isBlocking(validation)).toBe(true);
    expect(validation.issues.map((i) => i.code)).toContain("ZERO_AREA");
  });
});
