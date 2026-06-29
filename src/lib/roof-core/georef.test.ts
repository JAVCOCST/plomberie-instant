import { describe, it, expect } from "vitest";
import { buildStaticMapUrl, metersPerPx, bearingFromNorth, cardinal8, principalBearingDeg, webMercatorPx } from "./georef";

describe("georef", () => {
  it("builds a north-up static satellite URL", () => {
    const u = buildStaticMapUrl({ lat: 45.4, lng: -73.1, zoom: 20, w: 640, h: 640, scale: 2, key: "K" });
    expect(u).toContain("center=45.4,-73.1");
    expect(u).toContain("zoom=20");
    expect(u).toContain("size=640x640");
    expect(u).toContain("scale=2");
    expect(u).toContain("maptype=satellite");
    expect(u).toContain("key=K");
  });

  it("metersPerPx shrinks with zoom and scale", () => {
    const z20 = metersPerPx(45, 20, 1), z21 = metersPerPx(45, 21, 1);
    expect(z21).toBeCloseTo(z20 / 2, 6);
    expect(metersPerPx(45, 20, 2)).toBeCloseTo(z20 / 2, 6);
  });

  it("bearingFromNorth: up=N(0), right=E(90), down=S(180), left=O(270)", () => {
    expect(bearingFromNorth(0, -1)).toBeCloseTo(0, 3);
    expect(bearingFromNorth(1, 0)).toBeCloseTo(90, 3);
    expect(bearingFromNorth(0, 1)).toBeCloseTo(180, 3);
    expect(bearingFromNorth(-1, 0)).toBeCloseTo(270, 3);
  });

  it("cardinal8 maps degrees to 8-point compass (FR)", () => {
    expect(cardinal8(0)).toBe("N");
    expect(cardinal8(90)).toBe("E");
    expect(cardinal8(180)).toBe("S");
    expect(cardinal8(270)).toBe("O");
    expect(cardinal8(45)).toBe("NE");
  });

  it("principalBearingDeg returns the longest-edge axis, folded to [0,180)", () => {
    // wide rectangle: longest edges horizontal → bearing 90 (E/W axis)
    const b = principalBearingDeg([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 50 }, { x: 0, y: 50 }]);
    expect(b).toBeCloseTo(90, 1);
  });

  it("webMercatorPx maps lng/lat to 256-tile world pixels (north-up)", () => {
    expect(webMercatorPx(0, 0, 0)).toEqual({ x: 128, y: 128 });   // world center
    expect(webMercatorPx(-180, 0, 0).x).toBeCloseTo(0, 6);
    expect(webMercatorPx(180, 0, 0).x).toBeCloseTo(256, 6);
    // doubling zoom doubles the pixel scale
    expect(webMercatorPx(45, 45, 1).x).toBeCloseTo(webMercatorPx(45, 45, 0).x * 2, 6);
  });
});
