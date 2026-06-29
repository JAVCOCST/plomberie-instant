import simplify from 'simplify-js';

export function shoelaceArea(vertices: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % vertices.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function perimeter(vertices: [number, number][], closed = true): number {
  let p = 0;
  const n = vertices.length;
  const limit = closed ? n : n - 1;
  for (let i = 0; i < limit; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % n];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

export function pixelsToMeters(px: number, ppm: number): number {
  return px / ppm;
}

export function pxArea2ToM2(pxArea: number, ppm: number): number {
  return pxArea / (ppm * ppm);
}

export function simplifyPolygon(vertices: [number, number][], tolerance = 1.5): [number, number][] {
  const pts = vertices.map(([x, y]) => ({ x, y }));
  const simplified = simplify(pts, tolerance, true);
  return simplified.map((p) => [p.x, p.y] as [number, number]);
}

export function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Marching squares-ish: convert binary mask (Uint8 array) -> simple polygon
// Simplified: compute bounding contour via boundary tracing.
export function maskToPolygon(
  mask: Uint8Array,
  width: number,
  height: number,
  tolerance = 1.5,
): [number, number][] {
  // Find first foreground pixel
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) { start = i; break; }
  }
  if (start === -1) return [];
  const sx = start % width;
  const sy = Math.floor(start / width);

  const dirs: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const isFg = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] > 0;

  const contour: [number, number][] = [[sx, sy]];
  let cx = sx, cy = sy;
  let dir = 0;
  const maxSteps = width * height;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const nd = (dir + 6 + i) % 8;
      const [dx, dy] = dirs[nd];
      const nx = cx + dx, ny = cy + dy;
      if (isFg(nx, ny)) {
        cx = nx; cy = ny; dir = nd;
        contour.push([cx, cy]);
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cy === sy && contour.length > 2) break;
  }
  return simplifyPolygon(contour, tolerance);
}