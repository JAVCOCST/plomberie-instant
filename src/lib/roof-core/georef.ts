// Georeferencing helpers (pure) for the "freeze map view → annotate" workflow.
//
// Google satellite/orthophoto static maps are ALWAYS north-up (no bearing), so
// the frozen image's orientation is fixed: N = up (image -y), E = +x, S = +y,
// W = -x. We store this georef so the report can reason about N/S/E/W and a
// compass rose can show how the building sits relative to north.

export interface Georef {
  provider: string;            // "google" | "ortho" | …
  center_lat: number;
  center_lng: number;
  zoom: number;
  image_w: number;             // frozen image width (px)
  image_h: number;
  scale: 1 | 2;                // Google static scale
  north_up: boolean;           // true for static satellite (no rotation)
  bearing_deg: number;         // image rotation vs north (0 = north-up)
  building_bearing_deg?: number; // dominant building axis vs north
}

/** Build a Google Static Maps satellite URL (north-up). */
export function buildStaticMapUrl(o: { lat: number; lng: number; zoom: number; w?: number; h?: number; scale?: 1 | 2; key: string }): string {
  const w = o.w || 640, h = o.h || 640, scale = o.scale || 2;
  return "https://maps.googleapis.com/maps/api/staticmap"
    + "?center=" + o.lat + "," + o.lng
    + "&zoom=" + Math.round(o.zoom)
    + "&size=" + w + "x" + h
    + "&scale=" + scale
    + "&maptype=satellite&key=" + o.key;
}

/** Ground resolution (metres/pixel) at a latitude & zoom for a given scale. */
export function metersPerPx(lat: number, zoom: number, scale: 1 | 2 = 1): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, zoom)) / scale;
}

/** Web-Mercator world pixel of a lng/lat at a zoom (square tiles, default 256). */
export function webMercatorPx(lng: number, lat: number, zoom: number, tileSize = 256): { x: number; y: number } {
  const scale = tileSize * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x: x, y: y };
}

/** Bearing from north (up = image -y) of a vector, in [0,360). */
export function bearingFromNorth(dx: number, dy: number): number {
  // image y points DOWN, north is UP → north vector = (0,-1).
  const ang = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return ang;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
export function cardinal8(deg: number): string {
  return CARDINALS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/** Dominant axis bearing of a footprint (its longest edge), folded to [0,180). */
export function principalBearingDeg(pts: { x: number; y: number }[]): number | null {
  if (!pts || pts.length < 2) return null;
  let bl = -1, bx = 1, by = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length, dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, L = Math.hypot(dx, dy);
    if (L > bl) { bl = L; bx = dx; by = dy; }
  }
  let b = bearingFromNorth(bx, by);
  if (b >= 180) b -= 180;   // an axis is symmetric (a wall and its opposite share a bearing)
  return +b.toFixed(1);
}
