import { describe, it, expect } from "vitest";
import { buildAnnotation, parseAnnotation, reviewStateFor, ANNOTATION_VERSION, ENGINE_VERSION } from "./annotation";

const FIXED = "2026-05-25T12:00:00.000Z";

const sampleInput = {
  name: "Toiture 123 rue X",
  address: "123 rue X",
  status: "validated",
  createdAt: "2026-05-01T00:00:00.000Z",
  now: FIXED,
  image: { name: "capture.png", width: 2000, height: 1500 },
  mvpSnapshot: { schema_version: "1.6", roof_sections: [] },
  calibration: { gsd: 0.05 },
  baseMetadata: { typology: "gable", mvp_run: "abc" },
  sections: [
    { pts: [{ x: 10.04, y: 20.06 }, { x: 100, y: 20 }, { x: 100, y: 80 }], pitch: 7, elev: 0, hf: 0, roof_type: "hip", source: "mvp" },
    { pts: [{ x: 5, y: 5 }, { x: 50, y: 5 }, { x: 50, y: 40 }], pitch: 9, elev: 1, hf: 60, roof_type: "gable", source: "human" },
  ],
  suggestions: [
    { pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], roof_type: "hip", source: "mvp", _alt: { source_id: "A1", confidence: 0.4 } },
  ],
  rejectedSuggestions: [
    { pts: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], roof_type: "hip", source: "mvp", _alt: { source_id: "R1" } },
  ],
  rejectedDebug: [{ source_id: "D1", reason: "low_conf" }],
  accessories: [
    { id: "acc_1", type: "roof_accessory", product_id: "ventilation-maximum.max-301", variant_id: "301-16",
      anchor: { anchor_version: "1.0.0", section_id: "S1", edge_id: "S1:ridge:0", edge_t: 0.5, slope_offset_mm: 305, pan_side: "primary", fallback_anchor: { strategy: "nearest_ridge_in_section", last_resolved_world_pos: null, max_search_radius_mm: 2000 }, orphan_state: null },
      parameters: { color_id: "galv" }, overrides: { accepted_warnings: [] }, metadata: { created_at: "2026-05-01T00:00:00.000Z" }, accessory_orphaned: false },
  ],
  georef: { provider: "google", center_lat: 45.4, center_lng: -73.1, zoom: 20, image_w: 1280, image_h: 1280, scale: 2, north_up: true, bearing_deg: 0, building_bearing_deg: 88.5 },
};

describe("reviewStateFor", () => {
  it("is fully_validated with no unresolved suggestions", () => {
    expect(reviewStateFor(0)).toBe("fully_validated");
  });
  it("is validated_with_unresolved_suggestions when some remain", () => {
    expect(reviewStateFor(2)).toBe("validated_with_unresolved_suggestions");
  });
});

describe("buildAnnotation", () => {
  it("stamps version, engine, human_corrected source and timestamps", () => {
    const a = buildAnnotation(sampleInput);
    expect(a.version).toBe(ANNOTATION_VERSION);
    expect(a.engine_version).toBe(ENGINE_VERSION);
    expect(a.metadata.source).toBe("human_corrected");
    expect(a.metadata.status).toBe("validated");
    expect(a.metadata.typology).toBe("gable"); // baseMetadata preserved
    expect(a.created_at).toBe("2026-05-01T00:00:00.000Z");
    expect(a.updated_at).toBe(FIXED);
    expect(a.name).toBe("Toiture 123 rue X");
  });
  it("derives review_state from unresolved suggestions", () => {
    expect(buildAnnotation(sampleInput).review_state).toBe("validated_with_unresolved_suggestions");
    expect(buildAnnotation(Object.assign({}, sampleInput, { suggestions: [] })).review_state).toBe("fully_validated");
  });
  it("keeps section.source and preserves suggestion _alt provenance", () => {
    const a = buildAnnotation(sampleInput);
    expect(a.sections.map(s => s.source)).toEqual(["mvp", "human"]);
    expect(a.suggestions[0]._alt.source_id).toBe("A1");
    expect(a.rejectedSuggestions[0]._alt.source_id).toBe("R1");
    expect(a.rejectedDebug[0].source_id).toBe("D1");
  });
  it("rounds coordinates to 0.1px", () => {
    expect(buildAnnotation(sampleInput).sections[0].pts[0]).toEqual({ x: 10, y: 20.1 });
  });
  it("falls back to 'Sans titre' for an empty name", () => {
    expect(buildAnnotation(Object.assign({}, sampleInput, { name: "  " })).name).toBe("Sans titre");
  });
});

describe("build → parse → build round-trip is stable", () => {
  it("reconstructs an identical annotation", () => {
    const a1 = buildAnnotation(sampleInput);
    const wire = JSON.parse(JSON.stringify(a1));
    const parsed = parseAnnotation(wire);
    const a2 = buildAnnotation({
      name: parsed.name, address: parsed.address, status: a1.metadata.status,
      createdAt: parsed.created_at || undefined, now: FIXED,
      image: parsed.image, mvpSnapshot: parsed.mvp_source_snapshot, calibration: parsed.calibration,
      baseMetadata: parsed.metadata,
      sections: parsed.sections, suggestions: parsed.suggestions,
      rejectedSuggestions: parsed.rejectedSuggestions, rejectedDebug: parsed.rejectedDebug,
      accessories: parsed.accessories, georef: parsed.georef,
    });
    expect(a2).toEqual(a1);
    expect(a2.georef.north_up).toBe(true);
    expect(a2.georef.building_bearing_deg).toBe(88.5);
    // accessories survive round-trip, keep a STRING section id, never become sections.
    expect(a2.accessories).toHaveLength(1);
    expect(a2.accessories[0].type).toBe("roof_accessory");
    expect(a2.accessories[0].variant_id).toBe("301-16");
    expect(a2.accessories[0].anchor.section_id).toBe("S1");
    expect(a2.accessories[0].anchor.edge_id).toBe("S1:ridge:0");
    expect(a2.accessories[0].anchor.anchor_version).toBe("1.0.0");
    expect(a2.accessories[0].accessory_orphaned).toBe(false);
    expect(a2.sections.every((s: any) => (s as any).type !== "roof_accessory")).toBe(true);
  });
});

describe("parseAnnotation tolerance", () => {
  it("accepts the legacy 'alternatives' field as suggestions", () => {
    const legacy = { sections: [], alternatives: [{ pts: [{ x: 0, y: 0 }], roof_type: "hip" }] };
    const p = parseAnnotation(legacy);
    expect(p.suggestions).toHaveLength(1);
    expect(p.review_state).toBe("validated_with_unresolved_suggestions");
  });
  it("throws on non-object input", () => {
    expect(() => parseAnnotation(null)).toThrow();
  });
});
