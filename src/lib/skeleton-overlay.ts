import { SkeletonBuilder } from 'straight-skeleton';

/** Equirectangular local proj autour de lat0. */
function makeLocalProjection(lat0: number) {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toM: (lng: number, lat: number, lng0: number) => [
      (lng - lng0) * mPerDegLng,
      (lat - lat0) * mPerDegLat,
    ] as [number, number],
    fromM: (x: number, y: number, lng0: number) => [
      lng0 + x / mPerDegLng,
      lat0 + y / mPerDegLat,
    ] as [number, number],
  };
}

function ringSignedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

function pointInRingM(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function cleanRingM(ring: [number, number][], minDist = 0.15, tolCross = 0.02): [number, number][] {
  if (ring.length < 4) return ring;
  const open = ring.slice(0, ring.length - 1);
  const dedup: [number, number][] = [];
  for (const p of open) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > minDist) dedup.push(p);
  }
  if (dedup.length < 3) return ring;
  while (
    dedup.length > 3 &&
    Math.hypot(dedup[0][0] - dedup[dedup.length - 1][0], dedup[0][1] - dedup[dedup.length - 1][1]) < minDist
  ) dedup.pop();
  const out: [number, number][] = [];
  for (let i = 0; i < dedup.length; i++) {
    const a = dedup[(i - 1 + dedup.length) % dedup.length];
    const b = dedup[i];
    const c = dedup[(i + 1) % dedup.length];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > tolCross) out.push(b);
  }
  if (out.length < 3) return ring;
  out.push([out[0][0], out[0][1]]);
  return out;
}

function extractOuterRing(geo: any): [number, number][] | null {
  if (!geo) return null;
  const g = geo.type === 'Feature' ? geo.geometry : geo;
  if (!g) return null;
  if (g.type === 'Polygon') return (g.coordinates?.[0] || null) as any;
  if (g.type === 'MultiPolygon') {
    const polys = g.coordinates || [];
    let best: any = null; let bestN = -1;
    for (const p of polys) {
      const r = p?.[0];
      if (r && r.length > bestN) { best = r; bestN = r.length; }
    }
    return best;
  }
  return null;
}

export interface SkeletonPolyline {
  paths: Array<Array<{ lat: number; lng: number }>>;
  edgeCount: number;
}

/** Calcule le straight-skeleton d'un polygone bâtiment GeoJSON et renvoie
 *  les arêtes intérieures sous forme de polylignes lat/lng prêtes à dessiner
 *  sur Google Maps. */
export async function computeSkeletonLatLng(buildingGeojson: any): Promise<SkeletonPolyline | null> {
  const ring = extractOuterRing(buildingGeojson);
  if (!ring || ring.length < 4) return null;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const lng0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const proj = makeLocalProjection(lat0);
  let ringM: [number, number][] = ring.map((p) => proj.toM(p[0], p[1], lng0));
  const first = ringM[0]; const last = ringM[ringM.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ringM.push([first[0], first[1]]);
  if (ringSignedArea(ringM) < 0) ringM = ringM.slice().reverse();
  ringM = cleanRingM(ringM);
  const xs = ringM.map((p) => p[0]); const ys = ringM.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const diag = Math.hypot(maxX - minX, maxY - minY);

  await SkeletonBuilder.init();
  const skeleton: any = SkeletonBuilder.buildFromPolygon([ringM as any]);
  if (!skeleton) return null;

  const verts: Array<[number, number, number]> = skeleton.vertices;
  const isInterior = (idx: number) => (verts[idx]?.[2] ?? 0) > 1e-6;
  const edgeMap = new Map<string, { a: number; b: number }>();
  for (const poly of skeleton.polygons) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!edgeMap.has(k)) edgeMap.set(k, { a, b });
    }
  }
  const paths: Array<Array<{ lat: number; lng: number }>> = [];
  let count = 0;
  for (const e of edgeMap.values()) {
    if (!isInterior(e.a) || !isInterior(e.b)) continue;
    const va = verts[e.a], vb = verts[e.b];
    if (!va || !vb) continue;
    // clipping de sûreté contre les fantômes polyskel
    if (Math.hypot(va[0] - vb[0], va[1] - vb[1]) > diag) continue;
    const m = 1.0;
    if (
      va[0] < minX - m || va[0] > maxX + m || va[1] < minY - m || va[1] > maxY + m ||
      vb[0] < minX - m || vb[0] > maxX + m || vb[1] < minY - m || vb[1] > maxY + m
    ) continue;
    if (!pointInRingM((va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, ringM)) continue;
    const [lngA, latA] = proj.fromM(va[0], va[1], lng0);
    const [lngB, latB] = proj.fromM(vb[0], vb[1], lng0);
    paths.push([{ lat: latA, lng: lngA }, { lat: latB, lng: lngB }]);
    count++;
  }
  return { paths, edgeCount: count };
}