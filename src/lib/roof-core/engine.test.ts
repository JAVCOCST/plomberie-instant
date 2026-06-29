import { describe, it, expect } from "vitest";
// Headless regression test: the geometry-core must run in Node (no DOM) and
// produce stable, deterministic measures from a RoofModel input. This guards
// the extraction from AdminRoofStudio.tsx and any future engine change.
import { computeMeasures, skelFn, collectFaces, apOv, facesFn, facePlaneFromFace, isPignon, slopeDir, face3DArea, membraneStrips } from "./engine";

// A known RoofModel: one rectangular hip section, pitch 7 (the "m4" case).
const model = {
  sections: [
    {
      pts: [
        { x: 66, y: 94.05 },
        { x: 374, y: 94.05 },
        { x: 374, y: 532.95 },
        { x: 66, y: 532.95 },
      ],
      closed: true,
      pitch: 7,
      elev: 0,
      hf: 0,
      hidden: false,
      _no: {},
    },
  ],
};

describe("roof-core engine (headless)", () => {
  it("runs in Node and builds a skeleton", () => {
    const sk = skelFn(model.sections[0].pts);
    expect(sk.edges.length).toBeGreaterThan(0);
    expect(sk.poly.length).toBe(4);
  });

  it("computeMeasures is deterministic", () => {
    const a = computeMeasures(model.sections, []);
    const b = computeMeasures(model.sections, []);
    expect(a).toEqual(b);
  });

  it("computeMeasures returns a coherent hip-roof takeoff", () => {
    const m: any = computeMeasures(model.sections, []);
    // 4-pan hip → roof area grouped under pitch 7, no pignon, a ridge+hips total.
    expect(m.face).toBeGreaterThan(0);
    expect(Object.keys(m.byPitch)).toContain("7");
    expect(m.pignon).toBe(0);
    expect(m.ridge).toBeGreaterThan(0); // faîtière = central ridge + hips
    // Pinned value (regression guard); tolerant to float noise.
    expect(m.face).toBeGreaterThan(150000);
    expect(m.face).toBeLessThan(165000);
  });

  it("collectFaces yields 4 roof faces for a rectangle hip", () => {
    const faces = collectFaces(model.sections);
    expect(faces.length).toBe(4);
    expect(faces.every((f: any) => !f.pignon)).toBe(true);
  });

  it("membraneStrips: one inward eave band per real eave, none without width", () => {
    expect(membraneStrips(model.sections, [], 0)).toEqual([]);   // no calibration → no band
    const segs: any[] = membraneStrips(model.sections, [], 10);   // 10px-wide band
    // A 4-edge hip rectangle → 4 eave bands (no gable bases, nothing buried).
    expect(segs.length).toBe(4);
    // Each band sits inside the footprint and is lifted onto the roof (az > 0).
    segs.forEach((s) => { expect(s.az).toBeGreaterThan(0); expect(s.bz).toBeGreaterThan(0); });
    // The inward-offset band is shorter than the eave it parallels (mitred corners).
    const eaveLen = 374 - 66, bandLen = Math.hypot(segs[0].bx - segs[0].ax, segs[0].by - segs[0].ay);
    expect(bandLen).toBeLessThan(eaveLen);
  });

  // Mirrors exactly what the 3D tracer's exportJSON() builds, to guarantee the
  // export path still works after the engine extraction.
  it("exportJSON plane-building works headless", () => {
    const planes: any[] = []; let pn = 0;
    model.sections.forEach((s: any, si: number) => {
      const sk = apOv(s._skel || skelFn(s.pts), s._no || {});
      facesFn(sk.poly, sk).forEach((f: any) => {
        pn++;
        const pl = facePlaneFromFace(s, f.pts);
        planes.push({
          id: "P" + pn, section: si, kind: isPignon(s, f.pts) ? "pignon" : "toiture",
          pitch: s.pitch || 7, dir: pl ? slopeDir(pl) : "vertical",
          plane: pl ? { a: +pl.a.toFixed(4), b: +pl.b.toFixed(4), c: +pl.c.toFixed(2) } : null,
          area3d: +face3DArea(s, f.pts).toFixed(0),
          footprint: f.pts.map((q: any) => ({ x: +q.x.toFixed(1), y: +q.y.toFixed(1), t: +(q.t || 0).toFixed(1) })),
        });
      });
    });
    const out = { version: 1, sections: model.sections, valleys: [], planes };
    expect(planes.length).toBe(4);
    expect(planes.every((p) => p.id && p.kind && typeof p.area3d === "number")).toBe(true);
    // Must serialize to valid JSON (what the download blob does).
    const str = JSON.stringify(out);
    expect(JSON.parse(str).planes.length).toBe(4);
  });
});
