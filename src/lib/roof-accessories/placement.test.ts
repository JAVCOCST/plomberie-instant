import { describe, it, expect } from "vitest";
import { sectionRidge, resolvePlaced, projectToFrame, distToRidge } from "./placement";
import { makeAnchor } from "./anchor";

// Horizontal ridge from (0,100) to (200,100); pan "primary" side = +perp = (0,+1)? perp of (1,0) is (0,1).
const ridge = { a: { x: 0, y: 100 }, b: { x: 200, y: 100 } };

describe("placement math", () => {
  it("sectionRidge picks the longest isRidge edge", () => {
    const sk = { edges: [
      { ax: 0, ay: 0, bx: 10, by: 0, isRidge: false },
      { ax: 0, ay: 100, bx: 60, by: 100, isRidge: true },
      { ax: 0, ay: 100, bx: 200, by: 100, isRidge: true },
    ] };
    const r = sectionRidge(sk)!;
    expect(r.b.x).toBe(200);
  });

  it("resolvePlaced: edge_t=0.5, offset 40 → centred, pushed down the perpendicular", () => {
    const a = makeAnchor({ section_id: "S1", edge_t: 0.5, slope_offset_mm: 40 });
    const p = resolvePlaced(a, ridge);
    expect(p.pos.x).toBeCloseTo(100, 5);
    expect(p.pos.y).toBeCloseTo(140, 5);   // primary perp = (0,1)
    expect(p.footprint).toHaveLength(4);
  });

  it("secondary pan_side flips the perpendicular", () => {
    const a = makeAnchor({ section_id: "S1", edge_t: 0.5, slope_offset_mm: 40, pan_side: "secondary" });
    expect(resolvePlaced(a, ridge).pos.y).toBeCloseTo(60, 5);
  });

  it("projectToFrame is the inverse of resolvePlaced", () => {
    const a = makeAnchor({ section_id: "S1", edge_t: 0.3, slope_offset_mm: 55 });
    const p = resolvePlaced(a, ridge);
    const f = projectToFrame(p.pos, ridge, "primary");
    expect(f.edge_t).toBeCloseTo(0.3, 4);
    expect(f.slope_offset_mm).toBeCloseTo(55, 4);
  });

  it("projectToFrame clamps edge_t to [0,1] and slope_offset to ≥0", () => {
    const f = projectToFrame({ x: 300, y: 40 }, ridge, "primary"); // beyond b, above ridge
    expect(f.edge_t).toBe(1);
    expect(f.slope_offset_mm).toBe(0);
  });

  it("distToRidge measures perpendicular distance", () => {
    expect(distToRidge({ x: 100, y: 130 }, ridge)).toBeCloseTo(30, 5);
  });
});
