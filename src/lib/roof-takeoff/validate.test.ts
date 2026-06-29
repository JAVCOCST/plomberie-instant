import { describe, it, expect } from "vitest";
import type { RoofModel } from "@/lib/roof-core/types";
import { fromRoofModel, emptyRoofTakeoff } from "./factory";
import { validateRoofTakeoff } from "./validate";
import { migrateRoofTakeoff, cmpSchemaVersion } from "./migrate";
import { ROOF_TAKEOFF_SCHEMA_VERSION } from "./types";

const model: RoofModel = {
  version: 1,
  sections: [
    { pts: [{ x: 66, y: 94.05 }, { x: 374, y: 94.05 }, { x: 374, y: 532.95 }, { x: 66, y: 532.95 }], closed: true, pitch: 7, elev: 0, hf: 0, roof_type: "hip" },
  ],
  scale: { ft_per_px: 0.1, px_per_ft: 10, source: "georef", confidence: 0.9 },
  metadata: { source: "human_corrected", status: "validated" },
};

describe("validateRoofTakeoff", () => {
  it("a calibrated, non-empty takeoff has no errors", () => {
    const v = validateRoofTakeoff(fromRoofModel(model));
    expect(v.level).not.toBe("error");
    expect(v.issues.some((i) => i.code === "NO_SECTIONS")).toBe(false);
  });
  it("an empty takeoff reports NO_SECTIONS (error) + UNCALIBRATED (warning)", () => {
    const v = validateRoofTakeoff(emptyRoofTakeoff());
    expect(v.level).toBe("error");
    expect(v.issues.map((i) => i.code)).toContain("NO_SECTIONS");
    expect(v.issues.map((i) => i.code)).toContain("UNCALIBRATED");
  });
  it("flags stale derived data", () => {
    const t = fromRoofModel(model);
    t.geometry.snapshot.snapshotAt = "moved";
    const v = validateRoofTakeoff(t);
    expect(v.issues.map((i) => i.code)).toContain("DERIVED_STALE");
  });
});

describe("migrateRoofTakeoff", () => {
  it("compares schema versions", () => {
    expect(cmpSchemaVersion("1.0.0", "1.0.0")).toBe(0);
    expect(cmpSchemaVersion("0.9.0", "1.0.0")).toBe(-1);
    expect(cmpSchemaVersion("1.1.0", "1.0.0")).toBe(1);
  });
  it("stamps the current schema version and fills missing blocks", () => {
    const t = fromRoofModel(model);
    const raw: any = JSON.parse(JSON.stringify(t));
    raw.metadata.schemaVersion = "0.0.1";
    delete raw.business;
    delete raw.validation;
    const migrated = migrateRoofTakeoff(raw);
    expect(migrated.metadata.schemaVersion).toBe(ROOF_TAKEOFF_SCHEMA_VERSION);
    expect(migrated.business.penetrations).toEqual([]);
    expect(migrated.validation.level).toBe("ok");
  });
  it("throws on a non-object payload", () => {
    expect(() => migrateRoofTakeoff(null)).toThrow();
  });
});
