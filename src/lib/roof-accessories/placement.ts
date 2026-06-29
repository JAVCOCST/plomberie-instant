// Accessory placement math (pure) — Phase 2.
//
// Truth-independent of world position: an accessory is placed by
//   edge_t (0..1 along the ridge) + slope_offset (down the pan) + pan_side.
// Everything below is image-pixel space (the tracer is px-native; until a
// px↔mm calibration exists, slope_offset_mm carries the px-equivalent value).

import { AccessoryAnchor } from "./types";

export interface Pt { x: number; y: number }
export interface Ridge { a: Pt; b: Pt }

/** Footprint half-size in image px (placeholder until calibration sizes it from A_col). */
export const ACC_FOOTPRINT_HALF_PX = 22;

/** Longest `isRidge` edge of a skeleton (already apOv-applied), or null. */
export function sectionRidge(sk: any): Ridge | null {
  if (!sk || !sk.edges) return null;
  let best: Ridge | null = null, bl = -1;
  sk.edges.forEach(function (e: any) {
    if (!e.isRidge) return;
    const L = Math.hypot(e.bx - e.ax, e.by - e.ay);
    if (L > bl) { bl = L; best = { a: { x: e.ax, y: e.ay }, b: { x: e.bx, y: e.by } }; }
  });
  return best;
}

export interface Placed {
  pos: Pt;
  ridgeAxis: [number, number];
  slopeAxis: [number, number];
  footprint: [number, number][];
}

/** Resolve the px placement (position + axes + footprint) from anchor + ridge. */
export function resolvePlaced(anchor: AccessoryAnchor, ridge: Ridge, halfPx: number = ACC_FOOTPRINT_HALF_PX): Placed {
  const ax = ridge.b.x - ridge.a.x, ay = ridge.b.y - ridge.a.y, L = Math.hypot(ax, ay) || 1;
  const ux = ax / L, uy = ay / L;
  let nx = -uy, ny = ux;
  if (anchor.pan_side === "secondary") { nx = -nx; ny = -ny; }
  const t = Math.max(0, Math.min(1, anchor.edge_t));
  const bx = ridge.a.x + ax * t, by = ridge.a.y + ay * t;
  const off = Math.max(0, anchor.slope_offset_mm || 0);
  const pos = { x: bx + nx * off, y: by + ny * off };
  const h = halfPx;
  const footprint: [number, number][] = [
    [pos.x - ux * h - nx * h, pos.y - uy * h - ny * h],
    [pos.x + ux * h - nx * h, pos.y + uy * h - ny * h],
    [pos.x + ux * h + nx * h, pos.y + uy * h + ny * h],
    [pos.x - ux * h + nx * h, pos.y - uy * h + ny * h],
  ];
  return { pos, ridgeAxis: [ux, uy], slopeAxis: [nx, ny], footprint };
}

/** Project a world (px) point onto the ridge frame → { edge_t, slope_offset }. */
export function projectToFrame(p: Pt, ridge: Ridge, panSide: string): { edge_t: number; slope_offset_mm: number } {
  const ax = ridge.b.x - ridge.a.x, ay = ridge.b.y - ridge.a.y, L2 = ax * ax + ay * ay || 1;
  const t = ((p.x - ridge.a.x) * ax + (p.y - ridge.a.y) * ay) / L2;
  const L = Math.sqrt(L2), ux = ax / L, uy = ay / L;
  let nx = -uy, ny = ux;
  if (panSide === "secondary") { nx = -nx; ny = -ny; }
  const tc = Math.max(0, Math.min(1, t));
  const bx = ridge.a.x + ax * tc, by = ridge.a.y + ay * tc;
  const off = (p.x - bx) * nx + (p.y - by) * ny;
  return { edge_t: tc, slope_offset_mm: Math.max(0, off) };
}

/** Distance from a point to a segment (px) — for ridge picking. */
export function distToRidge(p: Pt, ridge: Ridge): number {
  const ax = ridge.b.x - ridge.a.x, ay = ridge.b.y - ridge.a.y, L2 = ax * ax + ay * ay;
  let t = L2 < 1e-9 ? 0 : ((p.x - ridge.a.x) * ax + (p.y - ridge.a.y) * ay) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (ridge.a.x + t * ax), p.y - (ridge.a.y + t * ay));
}
