// Inward offset polygon — utilisé par la feature « Bâtiment 2D » du traceur.
// Le polygone du toit (avec débord) est offsetté vers l'intérieur de N pouces
// pour obtenir le contour des MURS portants du bâtiment.
//
// Algo : pour chaque arête, on calcule sa normale intérieure (vers le centroïde)
// et on translate la droite de l'arête de `offset` unités le long de la normale.
// Le nouveau sommet i est l'intersection de la droite translatée i-1 avec i.
// Aucune lib externe. Garde-fous : retour `null` si polygone dégénéré, si une
// paire de droites est parallèle, ou si l'offset inverse l'orientation
// (typiquement quand le polygone est trop étroit pour l'offset demandé).

export interface Pt { x: number; y: number }

/** Aire signée du polygone (>0 ou <0 selon orientation). */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += (b.x - a.x) * (b.y + a.y);
  }
  return s / 2;
}

/** Offset INWARD du polygone fermé `pts` de `offset` pixels. Renvoie `null`
 *  si l'opération échoue (offset trop grand, polygone dégénéré, parallèles…). */
export function offsetPolygonInward(pts: Pt[], offset: number): Pt[] | null {
  const n = pts.length;
  if (n < 3 || !isFinite(offset)) return null;
  if (offset === 0) return pts.map(p => ({ x: p.x, y: p.y }));
  if (offset < 0) return null;

  // Centroïde pour déterminer le sens « intérieur » de chaque normale.
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  // Pour chaque arête : droite translatée parallèle de `offset` vers l'intérieur,
  // en forme implicite a·x + b·y + c = 0.
  type Line = { a: number; b: number; c: number };
  const lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;                       // arête dégénérée
    // Normale perpendiculaire choisie de sorte qu'elle pointe vers le centroïde.
    let nx = -dy / len, ny = dx / len;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; }
    const tx = p1.x + nx * offset, ty = p1.y + ny * offset;
    // Droite passant par (tx,ty) avec direction (dx,dy) : -dy(x-tx) + dx(y-ty) = 0.
    lines.push({ a: -dy, b: dx, c: dy * tx - dx * ty });
  }

  // Sommet i = intersection des droites (i-1) et i.
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i + n - 1) % n], L2 = lines[i];
    const det = L1.a * L2.b - L2.a * L1.b;
    if (Math.abs(det) < 1e-9) return null;             // arêtes parallèles
    const x = (L1.b * L2.c - L2.b * L1.c) / det;
    const y = (L2.a * L1.c - L1.a * L2.c) / det;
    if (!isFinite(x) || !isFinite(y)) return null;
    out.push({ x, y });
  }

  // Validation robuste : chaque arête du résultat doit pointer dans le MÊME
  // sens que l'arête source. Si l'offset dépasse le rayon inscrit du polygone,
  // les droites translatées s'inversent et l'arête correspondante part en
  // sens opposé — produit scalaire négatif, on rejette.
  for (let i = 0; i < n; i++) {
    const sA = pts[i], sB = pts[(i + 1) % n];
    const oA = out[i], oB = out[(i + 1) % n];
    const sdx = sB.x - sA.x, sdy = sB.y - sA.y;
    const odx = oB.x - oA.x, ody = oB.y - oA.y;
    if (sdx * odx + sdy * ody <= 0) return null;
  }
  return out;
}

/** Convertit des pouces en pixels image en utilisant la résolution sol (gsd = m/px).
 *  Si `gsd` invalide, retourne `null` — l'appelant peut alors refuser l'opération
 *  ou utiliser un fallback en pixels bruts. */
export function inchesToPx(inches: number, gsd: number | null | undefined): number | null {
  if (!gsd || !isFinite(gsd) || gsd <= 0) return null;
  const M_PER_IN = 0.0254;
  return (inches * M_PER_IN) / gsd;
}
