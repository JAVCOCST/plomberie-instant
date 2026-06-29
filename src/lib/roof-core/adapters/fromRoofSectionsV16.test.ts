import { describe, it, expect } from "vitest";
import {
  fromRoofSectionsV16,
  type MvpRoofSectionsOutput,
  type CaptureLike,
} from "./fromRoofSectionsV16";
import { ftPerPxFromGeoref } from "../types";

const cap: CaptureLike = {
  centerLat: 46.8,
  centerLng: -71.2,
  zoom: 20,
  width: 800,
  height: 600,
  scale_param: 1,
  provider: "google",
};

// Realistic v1.6 output (trimmed from the integration contract): S1 main kept,
// R2 kept ridge candidate, R1 alternative, R4 rejected.
function bundle(): MvpRoofSectionsOutput {
  return {
    schema_version: "sections-1.6.0",
    primary_axis_deg: 0.0,
    secondary_axis_deg: -90.0,
    detected_typology: "single_addon",
    sections: [
      {
        id: "S1", role: "main", experimental: false,
        points: [[80, 100], [660, 100], [660, 460], [80, 460]],
        ridge_axis_px: [[80, 280], [660, 280]],
        selection_status: "kept", selection_reason: "main envelope — always kept", rejection_reason: null,
        relationship_type: "main", parent_id: null, group_id: null,
        top_k_alternatives: [], related_ids: ["R2"],
        roof_type: "2_pans", pitch: 7.0,
      },
      {
        id: "R2", role: "ridge_candidate", experimental: true,
        points: [[643, 179], [643, 461], [488, 461], [488, 179]],
        ridge_axis_px: [[566, 179], [566, 461]],
        selection_status: "kept", selection_reason: "passed gates", rejection_reason: null,
        relationship_type: null, parent_id: null, group_id: null,
        top_k_alternatives: ["R3"], related_ids: ["R3", "R6"],
        structural_score: 0.517, ridge_visible_score: 0.689, plane_symmetry_score: 0.762,
        roof_type: "4_pans", pitch: 8.0,
      },
      {
        id: "R1", role: "ridge_candidate", experimental: true,
        points: [[79, 133], [469, 133], [469, 348], [79, 348]],
        ridge_axis_px: [[79, 240], [469, 240]],
        selection_status: "alternative", selection_reason: "redundant with main", rejection_reason: "redundant with main",
        relationship_type: "alternative", parent_id: null, group_id: null,
        top_k_alternatives: [], related_ids: ["R3"],
        structural_score: 0.522, ridge_visible_score: 0.773,
        roof_type: "2_pans", pitch: 7.0,
      },
      {
        id: "R4", role: "ridge_candidate", experimental: true,
        points: [[469, 239], [469, 457], [429, 457], [429, 239]],
        selection_status: "rejected", selection_reason: "structural_score below threshold", rejection_reason: "structural_score below threshold",
        structural_score: 0.445,
        roof_type: "2_pans", pitch: 7.0,
      },
    ],
    n_sections: 4,
  };
}

describe("fromRoofSectionsV16 — selection routing", () => {
  it("routes kept→sections, alternative→alternatives, rejected→rejected", () => {
    const { model, rejected } = fromRoofSectionsV16(bundle(), cap);
    expect(model.sections.length).toBe(2);          // S1 + R2
    expect(model.alternatives?.length).toBe(1);     // R1
    expect(rejected.length).toBe(1);                // R4
    expect(rejected[0].id).toBe("R4");
  });

  it("keeps points in image pixels (no projection)", () => {
    const { model } = fromRoofSectionsV16(bundle(), cap);
    expect(model.sections[0].pts[0]).toEqual({ x: 80, y: 100 });
    expect(model.sections[0].pts[2]).toEqual({ x: 660, y: 460 });
  });

  it("uses pitch directly (X/12) and maps roof_type", () => {
    const { model } = fromRoofSectionsV16(bundle(), cap);
    expect(model.sections[0].pitch).toBe(7);
    expect(model.sections[0].roof_type).toBe("gable"); // 2_pans
    expect(model.sections[1].pitch).toBe(8);
    expect(model.sections[1].roof_type).toBe("hip");   // 4_pans
  });

  it("sets S1 confidence to 1.0, others to structural_score", () => {
    const { model } = fromRoofSectionsV16(bundle(), cap);
    expect(model.sections[0].meta?.confidence).toBe(1.0);
    expect(model.sections[1].meta?.confidence).toBeCloseTo(0.517, 6);
  });

  it("preserves provenance without using it for activation", () => {
    const { model } = fromRoofSectionsV16(bundle(), cap);
    // R2 is kept despite relationship_type === null / parent_id === null.
    expect(model.sections[1].meta?.source_id).toBe("R2");
    expect(model.sections[1].meta?.relationship_type).toBe(null);
    expect(model.sections[1].meta?.top_k_alternatives).toEqual(["R3"]);
    const alt = model.alternatives![0];
    expect(alt._alt.source_id).toBe("R1");
    expect(alt._alt.rejection_reason).toBe("redundant with main");
  });

  it("defaults pitch to 7 and roof_type to hip when missing", () => {
    const b = bundle();
    delete b.sections[1].pitch;
    delete b.sections[1].roof_type;
    const { model } = fromRoofSectionsV16(b, cap);
    expect(model.sections[1].pitch).toBe(7);
    expect(model.sections[1].roof_type).toBe("hip");
  });
});

describe("fromRoofSectionsV16 — validation", () => {
  it("rejects a non-1.6 schema", () => {
    const b = bundle(); b.schema_version = "sections-1.5.0";
    expect(() => fromRoofSectionsV16(b, cap)).toThrow(/schema/i);
  });
  it("rejects when sections[0] is not S1/main/kept", () => {
    const b = bundle(); b.sections[0].selection_status = "alternative";
    expect(() => fromRoofSectionsV16(b, cap)).toThrow(/main section/i);
  });
  it("rejects empty sections", () => {
    expect(() => fromRoofSectionsV16({ schema_version: "sections-1.6.0", sections: [] } as any, cap)).toThrow(/Missing sections/);
  });
});

describe("fromRoofSectionsV16 — calibration / scale", () => {
  it("derives georef scale from capture", () => {
    const { model } = fromRoofSectionsV16(bundle(), cap);
    expect(model.scale?.source).toBe("georef");
    expect(model.scale?.confidence).toBe(0.9);
    expect(model.scale?.provider).toBe("google");
    const expected = ftPerPxFromGeoref({ zoom: cap.zoom, center_lat: cap.centerLat, scale_param: 1 });
    expect(model.scale?.ft_per_px).toBeCloseTo(expected, 9);
    expect(model.scale?.px_per_ft).toBeCloseTo(1 / expected, 9);
    expect(model.image?.width).toBe(800);
  });

  it("scale_param=2 halves ft_per_px", () => {
    const a = fromRoofSectionsV16(bundle(), cap).model.scale!.ft_per_px;
    const b = fromRoofSectionsV16(bundle(), { ...cap, scale_param: 2 }).model.scale!.ft_per_px;
    expect(b).toBeCloseTo(a / 2, 9);
  });

  it("source='none' when no capture provided", () => {
    const { model } = fromRoofSectionsV16(bundle());
    expect(model.scale?.source).toBe("none");
    expect(model.scale?.ft_per_px).toBe(0);
    expect(model.image).toBeUndefined();
  });

  it("carries typology + axes into metadata", () => {
    const { model } = fromRoofSectionsV16(bundle(), cap);
    expect(model.metadata.typology).toBe("single_addon");
    expect(model.metadata.primary_axis_deg).toBe(0);
    expect(model.metadata.mvp_version).toBe("sections-1.6.0");
    expect(model.metadata.source).toBe("mvp_auto");
  });

  it("is deterministic", () => {
    const a = fromRoofSectionsV16(bundle(), cap);
    const b = fromRoofSectionsV16(bundle(), cap);
    expect(a).toEqual(b);
  });
});
