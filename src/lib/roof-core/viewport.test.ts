import { describe, it, expect } from "vitest";
import { computeViewport, imageToViewport, viewportToImage, inImage } from "./viewport";

describe("computeViewport — contain fit, no distortion", () => {
  it("fits a portrait image into a landscape viewport (pillarbox, no crop)", () => {
    const vp = computeViewport(1000, 2000, 800, 600);
    // scale = min(800/1000, 600/2000) = min(0.8, 0.3) = 0.3
    expect(vp.scale).toBeCloseTo(0.3, 9);
    expect(vp.imageRect.w).toBeCloseTo(300, 6);
    expect(vp.imageRect.h).toBeCloseTo(600, 6);
    expect(vp.offsetX).toBeCloseTo(250, 6); // (800-300)/2
    expect(vp.offsetY).toBeCloseTo(0, 6);
  });

  it("fits a landscape image into a portrait viewport (letterbox, no crop)", () => {
    const vp = computeViewport(2000, 1000, 600, 800);
    expect(vp.scale).toBeCloseTo(0.3, 9);
    expect(vp.offsetX).toBeCloseTo(0, 6);
    expect(vp.offsetY).toBeCloseTo((800 - 300) / 2, 6);
  });

  it("uses a single uniform scale (scaleX === scaleY)", () => {
    const vp = computeViewport(1234, 567, 900, 500);
    const a = imageToViewport({ x: 0, y: 0 }, vp);
    const b = imageToViewport({ x: 100, y: 0 }, vp);
    const c = imageToViewport({ x: 0, y: 100 }, vp);
    expect((b.x - a.x) / 100).toBeCloseTo(vp.scale, 9);
    expect((c.y - a.y) / 100).toBeCloseTo(vp.scale, 9);
  });
});

describe("imageToViewport / viewportToImage round-trip", () => {
  const vp = computeViewport(1000, 2000, 800, 600);

  it("maps image corners to the image rect corners", () => {
    expect(imageToViewport({ x: 0, y: 0 }, vp)).toEqual({ x: 250, y: 0 });
    expect(imageToViewport({ x: 1000, y: 2000 }, vp)).toEqual({ x: 550, y: 600 });
  });

  it("maps the image center to the viewport center", () => {
    const c = imageToViewport({ x: 500, y: 1000 }, vp);
    expect(c.x).toBeCloseTo(400, 6);
    expect(c.y).toBeCloseTo(300, 6);
  });

  it("round-trips exactly", () => {
    const p = { x: 731, y: 1492 };
    const back = viewportToImage(imageToViewport(p, vp), vp);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("inImage flags out-of-bounds points", () => {
    expect(inImage({ x: 10, y: 10 }, vp)).toBe(true);
    expect(inImage({ x: -1, y: 10 }, vp)).toBe(false);
    expect(inImage({ x: 10, y: 2001 }, vp)).toBe(false);
  });
});
