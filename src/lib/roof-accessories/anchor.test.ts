import { describe, it, expect } from "vitest";
import { validateAnchor, makeAnchor } from "./anchor";

const good = makeAnchor({ section_id: "S1", edge_index: 0 });

describe("validateAnchor (accessory-anchor.schema v1.0.0)", () => {
  it("accepts a well-formed anchor", () => {
    expect(validateAnchor(good).ok).toBe(true);
    expect(good.edge_id).toBe("S1:ridge:0");
    expect(good.anchor_version).toBe("1.0.0");
    expect(good.pan_side).toBe("primary");
    expect(good.fallback_anchor?.strategy).toBe("nearest_ridge_in_section");
  });

  it("rejects numeric-index ids (must be stable strings)", () => {
    const r = validateAnchor({ ...good, section_id: "0", edge_id: "12" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((m) => m.includes("section_id"))).toBe(true);
    expect(r.errors.some((m) => m.includes("edge_id"))).toBe(true);
  });

  it("rejects edge_t out of [0,1], bad pan_side, negative slope offset", () => {
    expect(validateAnchor({ ...good, edge_t: 1.5 }).ok).toBe(false);
    expect(validateAnchor({ ...good, pan_side: "left" }).ok).toBe(false);
    expect(validateAnchor({ ...good, slope_offset_mm: -10 }).ok).toBe(false);
  });

  it("requires anchor_version string", () => {
    const { anchor_version, ...noVer } = good as any;
    expect(validateAnchor(noVer).ok).toBe(false);
    expect(validateAnchor({ ...good, anchor_version: 1 }).ok).toBe(false);
  });

  it("accepts null fallback but rejects a bad strategy", () => {
    expect(validateAnchor({ ...good, fallback_anchor: null }).ok).toBe(true);
    expect(validateAnchor({ ...good, fallback_anchor: { strategy: "teleport" } }).ok).toBe(false);
  });
});
