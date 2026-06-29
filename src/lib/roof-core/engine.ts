import * as StraightSkeleton from "straight-skeleton";

// Robust straight skeleton via CGAL/WASM (handles concave L/T/U footprints that
// the local fallback below cannot). The WASM module needs an async init; until
// ready (or if it fails) we fall back to the pure-JS skelFnLocal — so the tool
// never breaks, it just can't do concave shapes until CGAL is up.
export const SkeletonBuilder: any =
  (StraightSkeleton as any).SkeletonBuilder ||
  ((StraightSkeleton as any).default && (StraightSkeleton as any).default.SkeletonBuilder) ||
  (StraightSkeleton as any).default;
export let skReady = false;
export let skInitPromise: Promise<void> | null = null;
export function initSkeleton(): Promise<void> {
  if (!skInitPromise) {
    skInitPromise = (async () => {
      try { await SkeletonBuilder.init(); skReady = true; } catch { skReady = false; }
    })();
  }
  return skInitPromise;
}

// -- MATH 2D --------------------------------------------
export const sub = (a: any, b: any) => ({ x: a.x - b.x, y: a.y - b.y });
export const len = (v: any) => Math.sqrt(v.x * v.x + v.y * v.y);
export const nrm = (v: any) => { const l = len(v); return l < 1e-12 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }; };
export const dot = (a: any, b: any) => a.x * b.x + a.y * b.y;
export const area2 = (p: any) => { let s = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; s += p[i].x * p[j].y - p[j].x * p[i].y; } return s / 2; };
export const cw = (p: any) => area2(p) > 0 ? [...p] : [...p].reverse();
export const vv = (a: any, b: any, c: any) => { const d1 = nrm(sub(b, a)), d2 = nrm(sub(c, b)), n1 = { x: -d1.y, y: d1.x }, n2 = { x: -d2.y, y: d2.x }, det = n1.x * n2.y - n1.y * n2.x; return Math.abs(det) < 1e-10 ? n1 : { x: (n2.y - n1.y) / det, y: (n1.x - n2.x) / det }; };
export const ect = (vi: any, vj: any) => { const ex = vj.x - vi.x, ey = vj.y - vi.y, L = Math.sqrt(ex * ex + ey * ey); if (L < 1e-10) return 0; const r = (vj.vel.x - vi.vel.x) * (ex / L) + (vj.vel.y - vi.vel.y) * (ey / L); return r >= -1e-10 ? Infinity : -L / r; };

// -- MATH 3D --------------------------------------------
export const s3 = (a: any, b: any) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const d3 = (a: any, b: any) => a.x * b.x + a.y * b.y + a.z * b.z;
export const x3 = (a: any, b: any) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const n3 = (v: any) => { const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); return l < 1e-10 ? { x: 0, y: 1, z: 0 } : { x: v.x / l, y: v.y / l, z: v.z / l }; };
export const LIGHT = n3({ x: 6, y: 14, z: 8 });

export function buildView(phi: number, theta: number, r: number) {
  const ex = r * Math.sin(phi) * Math.cos(theta), ey = r * Math.cos(phi), ez = r * Math.sin(phi) * Math.sin(theta);
  const eye = { x: ex, y: ey, z: ez }, cz = n3(eye), cx = n3(x3({ x: 0, y: 1, z: 0 }, cz)), cy = x3(cz, cx);
  return { eye, cx, cy, cz };
}
export function proj3(px: number, py: number, pz: number, view: any, fov: number, W: number, H: number) {
  const d = { x: px - view.eye.x, y: py - view.eye.y, z: pz - view.eye.z };
  const vx = d3(d, view.cx), vy = d3(d, view.cy), vz = -d3(d, view.cz);
  if (vz < 0.05) return null;
  const f = 1 / Math.tan(fov / 2), a = W / H;
  return { sx: (vx / vz * f / a + 1) * W / 2, sy: (-vy / vz * f + 1) * H / 2, d: vz };
}

// -- SKELETON -------------------------------------------
// CGAL adapter: build a robust straight skeleton and adapt it to the same
// { poly, faces, edges, maxT } shape the rest of the tool consumes. Returns null
// if CGAL isn't ready or fails, so callers fall back to skelFnLocal.
export function skelFromCGAL(pts: any): any {
  if (!skReady || !pts || pts.length < 3) return null;
  try {
    // CGAL wants a CCW outer ring (standard math orientation). Our y is screen-
    // down, so we feed y-up (negate y), ensure CCW, close the ring, then flip back.
    let ring = pts.map((p: any) => [p.x, -p.y]);
    let A = 0; for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; A += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]; }
    if (A < 0) ring = ring.slice().reverse();
    ring = ring.concat([ring[0]]);
    const res = SkeletonBuilder.buildFromPolygon([ring]);
    if (!res || !res.vertices || !res.polygons || !res.polygons.length) return null;
    const V = res.vertices.map((v: any) => ({ x: v[0], y: -v[1], t: Math.max(0, v[2]) }));
    const faces = res.polygons.map((poly: any, fi: number) => ({
      pts: poly.map((idx: number) => ({ x: V[idx].x, y: V[idx].y, t: V[idx].t })), f: fi,
    })).filter((f: any) => f.pts.length >= 3);
    // Skeleton edges (interior — at least one endpoint above the eave), deduped.
    const seen = new Set<string>(); const edges: any[] = []; let maxT = 0;
    res.polygons.forEach((poly: any) => {
      for (let k = 0; k < poly.length; k++) {
        const ia = poly[k], ib = poly[(k + 1) % poly.length], a = V[ia], b = V[ib];
        if (a.t > maxT) maxT = a.t;
        if (a.t < 0.01 && b.t < 0.01) continue; // eave edge → drawn as section outline
        const key = Math.min(ia, ib) + "_" + Math.max(ia, ib);
        if (seen.has(key)) continue; seen.add(key);
        const mn = Math.min(a.t, b.t);
        edges.push({ ax: a.x, ay: a.y, ta: a.t, bx: b.x, by: b.y, tb: b.t, lf: 0, rf: 0, isHip: mn < 0.01, isRidge: mn >= 0.01 });
      }
    });
    return { poly: pts.map((p: any) => ({ x: p.x, y: p.y })), faces, edges, maxT, cgal: true };
  } catch {
    return null;
  }
}

export function skelFn(inpRaw: any) {
  // Local hand-rolled skeleton (works great for the rectangle workflow). CGAL is
  // kept below but disabled — the local engine + the solid z-buffer is what the
  // user prefers; flip this back to skelFromCGAL() to re-enable concave support.
  return skelFnLocal(inpRaw);
}

export function skelFnLocal(inpRaw: any) {
  if (inpRaw.length < 3) return { edges: [], poly: [], maxT: 0 };
  // Normalize the footprint into a ~10-unit box before running the skeleton.
  // The collapse/merge tolerances below (0.08, 0.15, 0.1) are absolute, so on
  // raw pixel coordinates (hundreds of px) edges never collapse and vertices
  // run off to infinity — that was the cause of the broken 3D spikes. We scale
  // to a fixed box here and scale every output (positions + skeleton time t)
  // back to the original coordinate space at the end.
  const rxs = inpRaw.map((p: any) => p.x), rys = inpRaw.map((p: any) => p.y);
  const minX = Math.min.apply(null, rxs), minY = Math.min.apply(null, rys);
  const span = Math.max(Math.max.apply(null, rxs) - minX, Math.max.apply(null, rys) - minY, 1);
  const K = 10 / span;
  const inp = inpRaw.map((p: any) => ({ x: (p.x - minX) * K, y: (p.y - minY) * K }));
  const poly = cw([...inp]), n = poly.length, edges: any[] = [];
  let act = poly.map(function (p: any, i: number) { return { x: p.x, y: p.y, vel: vv(poly[(i - 1 + n) % n], p, poly[(i + 1) % n]), bx: p.x, by: p.y, bt: 0, lf: (i - 1 + n) % n, rf: i }; }), t = 0;
  for (let it = 0; it < 500 && act.length > 2; it++) {
    const dt = Math.min.apply(null, act.map(function (v: any, i: number) { return ect(v, act[(i + 1) % act.length]); }).filter(isFinite));
    if (!isFinite(dt) || dt > 1e6) break;
    t += dt; act.forEach(function (v: any) { v.x += v.vel.x * dt; v.y += v.vel.y * dt; });
    let chg = true;
    while (chg && act.length > 2) {
      chg = false;
      for (let i = 0; i < act.length; i++) {
        const j = (i + 1) % act.length, vi = act[i], vj = act[j];
        if (len(sub(vj, vi)) > 0.08) continue;
        const mx = (vi.x + vj.x) / 2, my = (vi.y + vj.y) / 2;
        edges.push({ ax: vi.bx, ay: vi.by, ta: vi.bt, bx: mx, by: my, tb: t, lf: vi.lf, rf: vi.rf, isHip: vi.bt < 0.01 });
        edges.push({ ax: vj.bx, ay: vj.by, ta: vj.bt, bx: mx, by: my, tb: t, lf: vj.lf, rf: vj.rf, isHip: vj.bt < 0.01 });
        const nv: any = { x: mx, y: my, vel: { x: 0, y: 0 }, bx: mx, by: my, bt: t, lf: vi.lf, rf: vj.rf };
        const na: any[] = []; for (let k = 0; k < act.length; k++) if (k !== j) na.push(k === i ? nv : act[k]);
        if (na.length >= 3) { const ni = na.indexOf(nv); nv.vel = vv(na[(ni - 1 + na.length) % na.length], nv, na[(ni + 1) % na.length]); }
        act = na; chg = true; break;
      }
    }
  }
  if (act.length === 2) { const aa = act[0], bb = act[1]; if (Math.abs(aa.bx - bb.bx) > 0.1 || Math.abs(aa.by - bb.by) > 0.1) edges.push({ ax: aa.bx, ay: aa.by, ta: aa.bt, bx: bb.bx, by: bb.by, tb: bb.bt, lf: aa.rf, rf: bb.lf, isRidge: true }); }
  else if (act.length >= 3) { const cx = act.reduce(function (s: number, v: any) { return s + v.x; }, 0) / act.length, cy = act.reduce(function (s: number, v: any) { return s + v.y; }, 0) / act.length; act.forEach(function (v: any) { edges.push({ ax: v.bx, ay: v.by, ta: v.bt, bx: cx, by: cy, tb: t, lf: v.lf, rf: v.rf }); }); }
  // Scale skeleton back into the original coordinate space (positions /K + min,
  // and skeleton time t is a distance so it scales by /K too).
  const bx = (v: number) => v / K + minX, by = (v: number) => v / K + minY;
  edges.forEach(function (e: any) { e.ax = bx(e.ax); e.ay = by(e.ay); e.bx = bx(e.bx); e.by = by(e.by); e.ta = e.ta / K; e.tb = e.tb / K; });
  const polyBack = poly.map((p: any) => ({ x: bx(p.x), y: by(p.y) }));
  return { edges, poly: polyBack, maxT: t / K };
}

export function facesFn(poly: any, sk: any) {
  if (sk && sk.faces) return sk.faces;   // CGAL provides faces directly
  return Array.from({ length: poly.length }, function (_, f) {
    const pts: any[] = [{ x: poly[f].x, y: poly[f].y, t: 0 }, { x: poly[(f + 1) % poly.length].x, y: poly[(f + 1) % poly.length].y, t: 0 }];
    function add(x: number, y: number, t: number) { if (!pts.some(function (p) { return Math.abs(p.x - x) < 0.15 && Math.abs(p.y - y) < 0.15; })) pts.push({ x, y, t }); }
    sk.edges.filter(function (e: any) { return e.lf === f || e.rf === f; }).forEach(function (e: any) { if (e.ta > 0.01) add(e.ax, e.ay, e.ta); add(e.bx, e.by, e.tb); });
    if (pts.length < 3) return null;
    const cx = pts.reduce(function (s, p) { return s + p.x; }, 0) / pts.length, cy = pts.reduce(function (s, p) { return s + p.y; }, 0) / pts.length;
    return { pts: pts.sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); }), f };
  }).filter(Boolean) as any[];
}

// -- NODE OVERRIDES -------------------------------------
export const nk = (x: number, y: number) => Math.round(x * 10) + "_" + Math.round(y * 10);
export function apOv(sk: any, ov: any) {
  if (!ov || !Object.keys(ov).length) return sk;
  return Object.assign({}, sk, { edges: sk.edges.map(function (e: any) {
    const ka = nk(e.ax, e.ay), kb = nk(e.bx, e.by);
    const ax = e.ta > 0.01 && ov[ka] ? ov[ka].x : e.ax, ay = e.ta > 0.01 && ov[ka] ? ov[ka].y : e.ay;
    const bx = ov[kb] ? ov[kb].x : e.bx, by = ov[kb] ? ov[kb].y : e.by;
    return Object.assign({}, e, { ax, ay, bx, by });
  }) });
}
export function skelNodes(sk: any, ov: any) {
  const m = new Map();
  sk.edges.forEach(function (e: any) {
    const kb = nk(e.bx, e.by);
    if (!m.has(kb)) { const o = ov[kb]; m.set(kb, { key: kb, ox: e.bx, oy: e.by, x: o ? o.x : e.bx, y: o ? o.y : e.by }); }
    if (e.ta > 0.01) { const ka = nk(e.ax, e.ay); if (!m.has(ka)) { const o = ov[ka]; m.set(ka, { key: ka, ox: e.ax, oy: e.ay, x: o ? o.x : e.ax, y: o ? o.y : e.ay }); } }
  });
  return Array.from(m.values());
}

// -- PER-FACE PITCH (X/12) ------------------------------
export function distPtEdge(p: any, a: any, b: any) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.sqrt(dx * dx + dy * dy);
  return L < 1e-6 ? 0 : Math.abs((a.y - p.y) * dx - (a.x - p.x) * dy) / L;
}
export function faceRun(f: number, poly: any, sk: any, ov: any) {
  const n = poly.length, a = poly[f], b = poly[(f + 1) % n];
  let mx = 0;
  sk.edges.filter(function (e: any) { return e.lf === f || e.rf === f; }).forEach(function (e: any) {
    const k = nk(e.bx, e.by), nx = ov[k] ? ov[k].x : e.bx, ny = ov[k] ? ov[k].y : e.by;
    const d = distPtEdge({ x: nx, y: ny }, a, b);
    if (d > mx) mx = d;
  });
  return mx;
}
export function getFacePitches(sk: any, pts: any, ov: any, hf: number) {
  return pts.map(function (_: any, f: number) {
    const run = faceRun(f, pts, sk, ov);
    if (run < 1) return null;
    const x = Math.round((hf / run) * 12);
    return Math.max(0, Math.min(12, x));
  });
}

// -- VALLEY DETECTION ----------------------------------
export function findValleys(secs: any) {
  const vs: any[] = [], T = 12;
  for (let si = 0; si < secs.length; si++) {
    for (let sj = si + 1; sj < secs.length; sj++) {
      const pi = secs[si].pts, pj = secs[sj].pts;
      if (!pi || !pj) continue;
      for (let i = 0; i < pi.length; i++) {
        const ni = (i + 1) % pi.length;
        for (let j = 0; j < pj.length; j++) {
          const nj = (j + 1) % pj.length;
          const fwd = Math.hypot(pi[i].x - pj[j].x, pi[i].y - pj[j].y) < T && Math.hypot(pi[ni].x - pj[nj].x, pi[ni].y - pj[nj].y) < T;
          const rev = Math.hypot(pi[i].x - pj[nj].x, pi[i].y - pj[nj].y) < T && Math.hypot(pi[ni].x - pj[j].x, pi[ni].y - pj[j].y) < T;
          if (fwd || rev) vs.push([pi[i], pi[ni]]);
        }
      }
    }
  }
  return vs;
}

// -- VALLEYS (first-class, editable) -------------------
// A valley/noue is stored explicitly (the JSON is the truth). Detection only
// proposes candidates; the user edits endpoints, locks, deletes or retypes.
export const VTYPES = ["valley", "ridge", "hip"];
export const VCOLOR: any = { valley: "#4ad6ff", ridge: "#ff5566", hip: "#9be8ff" };
export let _vid = 0;
export function vid() { _vid++; return "v" + Date.now().toString(36) + "_" + _vid; }

export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 < 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
export function boundaryDist(pts: any, x: number, y: number) {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; const d = segDist(x, y, pts[i].x, pts[i].y, pts[j].x, pts[j].y); if (d < m) m = d; }
  return m;
}
// Foot of the perpendicular from (px,py) onto segment a-b, plus the distance.
export function projPtSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 < 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return { x, y, d: Math.hypot(px - x, py - y) };
}
// Roof surface rise above the eave for a uniform-pitch straight-skeleton roof:
// height = distance to the nearest footprint edge × pitch ratio (X/12).
export function roofRise(sec: any, x: number, y: number) {
  if (!sec || !sec.pts || sec.pts.length < 3) return 0;
  return boundaryDist(sec.pts, x, y) * ((sec.pitch || 7) / 12);
}
export function pointInPoly(pts: any, x: number, y: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// Pre-scale roof height of a section at (x,y), or -Infinity if outside its footprint.
export function roofHeightAt(sec: any, x: number, y: number) {
  if (!sec || !sec.pts || sec.pts.length < 3 || !pointInPoly(sec.pts, x, y)) return -Infinity;
  return (sec.elev || 0) * 0.5 + roofRise(sec, x, y);
}

// Détecte si la section A est ENTIÈREMENT subsumée par B :
//   - tous les vertices de A sont à l'intérieur du footprint de B
//   - le toit de B est PLUS HAUT que celui de A en plusieurs points
// Utile pour skip les sections qui sont entièrement sous une autre (fix
// occlusion 3D) et pour filtrer les noues spurious entre sections
// contenues. tol = tolérance en world units (skip si différence < tol).
export function isSectionSubsumed(A: any, B: any, tol: number) {
  if (!A || !B || !A.closed || !B.closed) return false;
  if (A.pts.length < 3 || B.pts.length < 3) return false;
  // (1) tous les vertices de A à l'intérieur de B
  for (let i = 0; i < A.pts.length; i++) {
    if (!pointInPoly(B.pts, A.pts[i].x, A.pts[i].y)) return false;
  }
  // (2) au centroïde ET sur les vertices de A : B doit être STRICTEMENT plus
  // haut. Si c'est juste tangent (même plan), c'est pas subsumé — on garde
  // les 2 visibles.
  const probes: { x: number; y: number }[] = [];
  let cx = 0, cy = 0;
  for (let i = 0; i < A.pts.length; i++) { cx += A.pts[i].x; cy += A.pts[i].y; }
  probes.push({ x: cx / A.pts.length, y: cy / A.pts.length });
  for (let i = 0; i < A.pts.length; i++) probes.push({ x: A.pts[i].x, y: A.pts[i].y });
  let strictlyBelow = 0;
  for (const p of probes) {
    const zA = sectionRoofHeightAt(A, p.x, p.y);
    const zB = sectionRoofHeightAt(B, p.x, p.y);
    if (zA === -Infinity || zB === -Infinity) continue;
    if (zB > zA + tol) strictlyBelow++;
  }
  // Au moins la moitié des probes confirment l'occlusion → subsumé
  return strictlyBelow >= Math.ceil(probes.length / 2);
}
// True rendered roof height of a section at (x,y): max over its faces (with node
// overrides applied) whose footprint contains the point, via each face's plane.
export function sectionRoofHeightAt(sec: any, x: number, y: number) {
  if (!sec || !sec.closed || sec.pts.length < 3 || !pointInPoly(sec.pts, x, y)) return -Infinity;
  const sk = apOv(sec._skel || skelFn(sec.pts), sec._no || {});
  const fs = facesFn(sk.poly, sk);
  let h = -Infinity;
  for (let i = 0; i < fs.length; i++) {
    if (pointInPoly(fs[i].pts, x, y)) { const pl = facePlaneFromFace(sec, fs[i].pts); if (pl) { const z = pl.a * x + pl.b * y + pl.c; if (z > h) h = z; } }
  }
  return h;
}
// Pre-scale 3D height (matches render3D's eY + t*ratio convention, before ×sc).
export function valleyHeight(secs: any, v: any, p: any) {
  const s1 = secs[v.sec1], s2 = secs[v.sec2];
  const hs: number[] = [];
  if (s1) hs.push((s1.elev || 0) * 0.5 + roofRise(s1, p.x, p.y));
  if (s2) hs.push((s2.elev || 0) * 0.5 + roofRise(s2, p.x, p.y));
  if (!hs.length) return 0;
  return hs.reduce((a, b) => a + b, 0) / hs.length;
}
// Scene scale/offset used by render3D (footprint → centered 3D box). Recomputed
// here so the 3D pointer handlers can map screen drags back to footprint coords.
export function sceneScale(secs: any) {
  const allPts = secs.reduce(function (acc: any[], s: any) { return acc.concat(s.pts || []); }, []);
  if (!allPts.length) return null;
  const xs = allPts.map(function (p: any) { return p.x; }), ys = allPts.map(function (p: any) { return p.y; });
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  return { sc: 9 / Math.max(maxX - minX, maxY - minY, 1), ox: (minX + maxX) / 2, oy: (minY + maxY) / 2 };
}
// Cast a ray from a screen point onto the ground plane (y=0); returns {x,z} in
// 3D world units, or null. Inverse of proj3 for the y=0 intersection.
export function unprojectGround(sx: number, sy: number, view: any, fov: number, W: number, H: number) {
  const f = 1 / Math.tan(fov / 2), a = W / H;
  const ndcx = (2 * sx / W - 1) * a / f, ndcy = (1 - 2 * sy / H) / f;
  const dir = {
    x: ndcx * view.cx.x + ndcy * view.cy.x - view.cz.x,
    y: ndcx * view.cx.y + ndcy * view.cy.y - view.cz.y,
    z: ndcx * view.cx.z + ndcy * view.cy.z - view.cz.z,
  };
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = -view.eye.y / dir.y;
  if (t <= 0) return null;
  return { x: view.eye.x + t * dir.x, z: view.eye.z + t * dir.z };
}
// Sutherland-Hodgman: clip `subject` polygon by convex polygon `clip` (CCW).
export function polyClipConvex(subject: any[], clip: any[]) {
  let out = subject.map(function (p: any) { return { x: p.x, y: p.y }; });
  for (let i = 0; i < clip.length; i++) {
    if (!out.length) break;
    const A = clip[i], B = clip[(i + 1) % clip.length];
    const ex = B.x - A.x, ey = B.y - A.y;
    const side = function (p: any) { return ex * (p.y - A.y) - ey * (p.x - A.x); };
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j], Q = inp[(j + 1) % inp.length], sP = side(P), sQ = side(Q);
      if (sP >= 0) out.push(P);
      if ((sP >= 0) !== (sQ >= 0)) { const t = sP / (sP - sQ); out.push({ x: P.x + t * (Q.x - P.x), y: P.y + t * (Q.y - P.y) }); }
    }
  }
  return out;
}
// Height plane z = a*x + b*y + c fitted through a face's own 3D points
// (z = elev/2 + t*pitch/12). Works for both CGAL and local faces (both carry t).
export function facePlaneFromFace(sec: any, facePts: any) {
  const r = (sec.pitch || 7) / 12, eb = (sec.elev || 0) * 0.5;
  const P = facePts.map((q: any) => ({ x: q.x, y: q.y, z: eb + (q.t || 0) * r }));
  if (P.length < 3) return null;
  // pick a non-degenerate triple
  for (let i = 1; i < P.length - 1; i++) {
    const v1 = { x: P[i].x - P[0].x, y: P[i].y - P[0].y, z: P[i].z - P[0].z };
    const v2 = { x: P[i + 1].x - P[0].x, y: P[i + 1].y - P[0].y, z: P[i + 1].z - P[0].z };
    const Nx = v1.y * v2.z - v1.z * v2.y, Ny = v1.z * v2.x - v1.x * v2.z, Nz = v1.x * v2.y - v1.y * v2.x;
    if (Math.abs(Nz) > 1e-6) {
      const d = Nx * P[0].x + Ny * P[0].y + Nz * P[0].z;
      return { a: -Nx / Nz, b: -Ny / Nz, c: d / Nz };
    }
  }
  return null;
}
// A face whose plane is much steeper than any real roof slope is a gable end
// (pignon) — a vertical wall, not a roofing surface.
export const PIGNON_GRAD = 1.3;
// null plane = vertical face → infinite gradient → gable wall.
export function faceGradient(sec: any, facePts: any) { const pl = facePlaneFromFace(sec, facePts); return pl ? Math.hypot(pl.a, pl.b) : Infinity; }
export function isPignon(sec: any, facePts: any) { return faceGradient(sec, facePts) > PIGNON_GRAD; }
// True 3D area of a face polygon (Newell) — correct even for vertical gable walls
// where the plan-projected area is ~0.
export function face3DArea(sec: any, facePts: any) {
  const r = (sec.pitch || 7) / 12, eb = (sec.elev || 0) * 0.5;
  const P = facePts.map(function (q: any) { return { x: q.x, y: q.y, z: eb + (q.t || 0) * r }; });
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y); }
  return Math.hypot(nx, ny, nz) / 2;
}
// -- SHELL TRIM (BIM upper-envelope) -------------------
// Keep each roof pan only where it is the highest surface in Z. We subtract from
// a face the regions buried under a taller face of ANOTHER section, exactly,
// using convex-difference (no boolean-with-holes): the result is a set of convex
// residual polygons = the visible outer shell. Faces fully under another volume
// trim to zero (internal triangles vanish); partial overlaps cut along the
// plane-intersection line (noue / arête / trim).
export function polyAreaSigned(p: any[]) { let s = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; s += p[i].x * p[j].y - p[j].x * p[i].y; } return s / 2; }
export function polyAreaAbs(p: any[]) { return Math.abs(polyAreaSigned(p)); }
export function toCCW(p: any[]) { return polyAreaSigned(p) >= 0 ? p : p.slice().reverse(); }
// Clip polygon to one side of directed edge A→B (keep left when left=true).
export function clipSide(poly: any[], A: any, B: any, left: boolean) {
  const out: any[] = [], ex = B.x - A.x, ey = B.y - A.y;
  const sd = function (p: any) { return ex * (p.y - A.y) - ey * (p.x - A.x); };
  const keep = function (v: number) { return left ? v >= -1e-7 : v <= 1e-7; };
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], sP = sd(P), sQ = sd(Q);
    if (keep(sP)) out.push(P);
    if (keep(sP) !== keep(sQ)) { const t = sP / (sP - sQ); out.push({ x: P.x + t * (Q.x - P.x), y: P.y + t * (Q.y - P.y) }); }
  }
  return out;
}
// Clip polygon to the half-plane a*x + b*y + c >= 0.
export function clipHalfPlane(poly: any[], a: number, b: number, c: number) {
  const out: any[] = [], f = function (p: any) { return a * p.x + b * p.y + c; };
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], fP = f(P), fQ = f(Q);
    if (fP >= -1e-7) out.push(P);
    if ((fP >= -1e-7) !== (fQ >= -1e-7)) { const t = fP / (fP - fQ); out.push({ x: P.x + t * (Q.x - P.x), y: P.y + t * (Q.y - P.y) }); }
  }
  return out;
}
// P \ C with P, C convex → list of convex pieces (C's interior removed).
export function convexDiff(P: any[], C: any[]) {
  C = toCCW(C); if (polyAreaAbs(C) < 1e-6) return [P];
  let rem = toCCW(P); const pieces: any[] = [];
  for (let i = 0; i < C.length; i++) {
    const A = C[i], B = C[(i + 1) % C.length];
    const right = clipSide(rem, A, B, false); if (polyAreaAbs(right) > 1e-6) pieces.push(right);
    rem = clipSide(rem, A, B, true); if (polyAreaAbs(rem) < 1e-6) { rem = []; break; }
  }
  return pieces;   // `rem` (inside C) is discarded
}
// All roof faces across sections (overrides applied) with plane + pitch + meta.
export function collectFaces(secs: any) {
  const out: any[] = [];
  (secs || []).forEach(function (s: any, si: number) {
    if (!s.closed || s.pts.length < 3 || s.hidden) return;
    // Toit plat : pas de skeleton, juste UNE face = le polygone du périmètre.
    // Pas d'arêtes internes (ridges/hips/valleys) qui n'ont aucun sens sur un
    // toit plat. Plan strictement horizontal à z = elev * 0.5.
    if (s.roof_type === "flat") {
      const fpts = s.pts.map(function (p: any) { return { x: p.x, y: p.y, t: 0 }; });
      const z = (s.elev || 0) * 0.5;
      const pl = { a: 0, b: 0, c: z };
      out.push({ si: si, s: s, f: 0, fpts: fpts, pl: pl, grad: 0, pignon: false, pitch: 0 });
      return;
    }
    const sk = apOv(s._skel || skelFn(s.pts), s._no || {});
    const fp = s.hf > 0 ? getFacePitches(sk, sk.poly, s._no || {}, s.hf) : null;
    facesFn(sk.poly, sk).forEach(function (f: any) {
      const pl = facePlaneFromFace(s, f.pts), grad = pl ? Math.hypot(pl.a, pl.b) : Infinity;
      out.push({ si: si, s: s, f: f.f, fpts: f.pts, pl: pl, grad: grad, pignon: grad > PIGNON_GRAD, pitch: (fp && fp[f.f] != null) ? fp[f.f] : (s.pitch || 7) });
    });
  });
  return out;
}
// Visible residual pieces (2D) of roof face A after removing parts buried under a
// taller face of another section. epsz = "strictly above" tolerance in Z.
export function faceShell(A: any, all: any[], epsz: number) {
  if (A.pignon || !A.pl) return [A.fpts.map(function (q: any) { return { x: q.x, y: q.y }; })];
  let residual: any[] = [A.fpts.map(function (q: any) { return { x: q.x, y: q.y }; })];
  for (let k = 0; k < all.length; k++) {
    const B = all[k];
    if (B === A || B.si === A.si || B.pignon || !B.pl) continue;
    const da = B.pl.a - A.pl.a, db = B.pl.b - A.pl.b, dc = B.pl.c - A.pl.c;   // zB − zA
    const C = clipHalfPlane(B.fpts.map(function (q: any) { return { x: q.x, y: q.y }; }), da, db, dc - epsz);
    if (polyAreaAbs(C) < 1e-6) continue;
    const next: any[] = [];
    residual.forEach(function (piece: any) { convexDiff(piece, C).forEach(function (pc: any) { if (polyAreaAbs(pc) > 1e-6) next.push(pc); }); });
    residual = next; if (!residual.length) break;
  }
  return residual;
}
// Outer boundary of a set of (convex) shell pieces: every edge that isn't shared
// with another piece. Drops the internal seams between pieces AND the buried
// part (which isn't in any piece), so a highlight follows the VISIBLE face only.
export function shellOutlineEdges(pieces: any[], tol = 0.1) {
  const edges: any[] = [];
  pieces.forEach(function (pc: any) { for (let i = 0; i < pc.length; i++) edges.push([pc[i], pc[(i + 1) % pc.length]]); });
  const near = function (p: any, q: any) { return Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol; };
  const out: any[] = [];
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i][0], b = edges[i][1]; let shared = false;
    for (let j = 0; j < edges.length; j++) {
      if (i === j) continue; const c = edges[j][0], d = edges[j][1];
      if ((near(a, c) && near(b, d)) || (near(a, d) && near(b, c))) { shared = true; break; }
    }
    if (!shared) out.push([a, b]);
  }
  return out;
}
// A gable wall is "interior" (buried) when its apex — the highest point of the
// wall — sits under another section's roof. Such pignons aren't counted/drawn.
export function pignonBuried(A: any, all: any[], epsz: number) {
  let apex = A.fpts[0]; for (let i = 1; i < A.fpts.length; i++) if ((A.fpts[i].t || 0) > (apex.t || 0)) apex = A.fpts[i];
  const r = (A.s.pitch || 7) / 12, z = (A.s.elev || 0) * 0.5 + (apex.t || 0) * r;
  for (let k = 0; k < all.length; k++) { const B = all[k]; if (B.si === A.si || !B.pl || B.pignon) continue; if (pointInPoly(B.fpts, apex.x, apex.y) && (B.pl.a * apex.x + B.pl.b * apex.y + B.pl.c) > z + epsz) return true; }
  return false;
}
export function sceneSpan(secs: any) {
  const a = (secs || []).reduce(function (acc: any[], s: any) { return acc.concat(s.pts || []); }, []);
  if (!a.length) return 1;
  const xs = a.map(function (p: any) { return p.x; }), ys = a.map(function (p: any) { return p.y; });
  return Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), Math.max.apply(null, ys) - Math.min.apply(null, ys), 1);
}
export function facePlane(sec: any, facePts: any, faceIdx: number) {
  const p = sec.pts, e0 = p[faceIdx], e1 = p[(faceIdx + 1) % p.length];
  let nx = -(e1.y - e0.y), ny = (e1.x - e0.x); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
  let cx = 0, cy = 0; facePts.forEach(function (q: any) { cx += q.x; cy += q.y; }); cx /= facePts.length; cy /= facePts.length;
  if ((cx - e0.x) * nx + (cy - e0.y) * ny < 0) { nx = -nx; ny = -ny; }
  const r = (sec.pitch || 7) / 12, eb = (sec.elev || 0) * 0.5;
  return { a: r * nx, b: r * ny, c: eb - r * (nx * e0.x + ny * e0.y) };
}
// Which roof face is under a screen point in 3D? Returns {si, fi, num} (section,
// face index, and a global plane number P#), front-most by depth. Mirrors render3D.
export function hitFaceDetailed(x: number, y: number, secs: any, view: any, fov: number, W: number, H: number) {
  const ss = sceneScale(secs); if (!ss) return null;
  const sc = ss.sc, ox = ss.ox, oy = ss.oy;
  const all = collectFaces(secs);   // same order as the JSON export → num = n+1
  let best: any = null, bestD = Infinity;
  for (let n = 0; n < all.length; n++) {
    const A = all[n];
    if (A.pignon || !A.pl) continue;   // gable walls / verticals aren't selectable
    const sp = A.fpts.map(function (q: any) { return proj3((q.x - ox) * sc, (A.pl.a * q.x + A.pl.b * q.y + A.pl.c) * sc, (q.y - oy) * sc, view, fov, W, H); });
    if (sp.some(function (p: any) { return !p; })) continue;
    let inside = false;
    for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
      if (((sp[i].sy > y) !== (sp[j].sy > y)) && (x < (sp[j].sx - sp[i].sx) * (y - sp[i].sy) / (sp[j].sy - sp[i].sy) + sp[i].sx)) inside = !inside;
    }
    if (inside) {
      // Depth AT the cursor (centroid-fan barycentric), not the face average, so
      // the frontmost surface under the finger wins → every visible face selectable.
      const cxp = sp.reduce(function (s: number, p: any) { return s + p.sx; }, 0) / sp.length, cyp = sp.reduce(function (s: number, p: any) { return s + p.sy; }, 0) / sp.length, cd = sp.reduce(function (s: number, p: any) { return s + p.d; }, 0) / sp.length;
      let depth = cd;
      for (let i = 0; i < sp.length; i++) {
        const a = sp[i], b = sp[(i + 1) % sp.length], v0x = a.sx - cxp, v0y = a.sy - cyp, v1x = b.sx - cxp, v1y = b.sy - cyp, den = v0x * v1y - v1x * v0y;
        if (Math.abs(den) < 1e-9) continue;
        const v2x = x - cxp, v2y = y - cyp, wa = (v2x * v1y - v1x * v2y) / den, wb = (v0x * v2y - v2x * v0y) / den, wC = 1 - wa - wb;
        if (wa >= -1e-4 && wb >= -1e-4 && wC >= -1e-4) { depth = wC * cd + wa * a.d + wb * b.d; break; }
      }
      if (depth < bestD) { bestD = depth; best = { si: A.si, fi: A.f, num: n + 1 }; }
    }
  }
  return best;
}
// 8-point compass direction a face slopes toward (downhill), image-north = up.
export function slopeDir(plane: any) {
  const dx = -plane.a, dy = -plane.b;
  const ang = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(ang / 45) % 8];
}
// While dragging corner `idx`, snap it so its two adjacent edges become
// perpendicular to the NEIGHBOURING edges (so a quad squares up even when the
// building is rotated). Returns the snapped point + which edge indices locked
// to 90° (drawn red), or null if neither is within `thr`.
export function perpCornerSnap(pts: any, idx: number, tx: number, ty: number, thr: number) {
  const n = pts.length; if (n < 3) return null;
  const A = pts[(idx - 1 + n) % n], pA = pts[(idx - 2 + n) % n];   // edge pA->A  (segment A-P should be ⊥ it)
  const C = pts[(idx + 1) % n], nC = pts[(idx + 2) % n];           // edge C->nC  (segment P-C should be ⊥ it)
  const mk = function (Q: any, ex: number, ey: number) {
    const L = Math.hypot(ex, ey); if (L < 1e-6) return null;
    const dx = -ey / L, dy = ex / L;                               // direction perpendicular to the reference edge
    const al = (tx - Q.x) * dx + (ty - Q.y) * dy;
    return { Qx: Q.x, Qy: Q.y, dx: dx, dy: dy, fx: Q.x + al * dx, fy: Q.y + al * dy, d: Math.hypot(tx - (Q.x + al * dx), ty - (Q.y + al * dy)) };
  };
  const l1 = mk(A, A.x - pA.x, A.y - pA.y), l2 = mk(C, nC.x - C.x, nC.y - C.y);
  const on1 = !!(l1 && l1.d < thr), on2 = !!(l2 && l2.d < thr);
  if (!on1 && !on2) return null;
  let x: number, y: number; const segs: number[] = [];
  if (on1 && on2) {
    const cr = (l1 as any).dx * (l2 as any).dy - (l1 as any).dy * (l2 as any).dx;
    if (Math.abs(cr) > 1e-6) { const s = (((l2 as any).Qx - (l1 as any).Qx) * (l2 as any).dy - ((l2 as any).Qy - (l1 as any).Qy) * (l2 as any).dx) / cr; x = (l1 as any).Qx + s * (l1 as any).dx; y = (l1 as any).Qy + s * (l1 as any).dy; }
    else { x = (l1 as any).fx; y = (l1 as any).fy; }
    segs.push((idx - 1 + n) % n, idx);
  } else if (on1) { x = (l1 as any).fx; y = (l1 as any).fy; segs.push((idx - 1 + n) % n); }
  else { x = (l2 as any).fx; y = (l2 as any).fy; segs.push(idx); }
  return { x: x, y: y, segs: segs };
}
// Snap a point onto the nearest footprint vertex or edge of any section
// (within thr). Used when dragging a skeleton node so it locks onto a wall.
export function snapToFootprint(secs: any, px: number, py: number, thr: number) {
  let bd = thr, bx = px, by = py, hit = false;
  (secs || []).forEach(function (s: any) {
    if (!s.closed || s.pts.length < 3) return;
    const p = s.pts;
    for (let i = 0; i < p.length; i++) {
      const dv = Math.hypot(px - p[i].x, py - p[i].y); if (dv < bd) { bd = dv; bx = p[i].x; by = p[i].y; hit = true; }
      const pr = projPtSeg(px, py, p[i].x, p[i].y, p[(i + 1) % p.length].x, p[(i + 1) % p.length].y); if (pr.d < bd) { bd = pr.d; bx = pr.x; by = pr.y; hit = true; }
    }
  });
  return { x: bx, y: by, hit };
}
// Snap a footprint point to the nearest existing geometry (footprint vertices
// & edges, skeleton nodes & edges) within `thr` — used when dragging a valley
// endpoint in 3D so noues connect cleanly to ridges/hips/corners.
export function snap3D(secs: any, fx: number, fy: number, thr: number) {
  let bd = thr, bx = fx, by = fy;
  (secs || []).forEach(function (s: any) {
    if (!s.closed || s.pts.length < 3) return;
    const p = s.pts;
    for (let i = 0; i < p.length; i++) {
      const dv = Math.hypot(fx - p[i].x, fy - p[i].y); if (dv < bd) { bd = dv; bx = p[i].x; by = p[i].y; }
      const pr = projPtSeg(fx, fy, p[i].x, p[i].y, p[(i + 1) % p.length].x, p[(i + 1) % p.length].y); if (pr.d < bd) { bd = pr.d; bx = pr.x; by = pr.y; }
    }
    const sk = s._skel || skelFn(s.pts);
    sk.edges.forEach(function (e: any) {
      const db = Math.hypot(fx - e.bx, fy - e.by); if (db < bd) { bd = db; bx = e.bx; by = e.by; }
      if (e.ta > 0.01) { const da = Math.hypot(fx - e.ax, fy - e.ay); if (da < bd) { bd = da; bx = e.ax; by = e.ay; } }
      const pr = projPtSeg(fx, fy, e.ax, e.ay, e.bx, e.by); if (pr.d < bd) { bd = pr.d; bx = pr.x; by = pr.y; }
    });
  });
  return { x: bx, y: by };
}
// Propose valley candidates: (1) where two sections share a near-coincident
// edge (abutting L/T wings), and (2) where roof faces of two overlapping
// sections cross in 3D — the line where their two planes meet, clipped to the
// overlap. This is the real plane-intersection valley.
export function valleyCandidates(secs: any) {
  const out: any[] = [], T = 14;
  for (let si = 0; si < secs.length; si++) for (let sj = si + 1; sj < secs.length; sj++) {
    const A = secs[si], B = secs[sj]; if (!A.closed || !B.closed || A.pts.length < 3 || B.pts.length < 3) continue;
    // (1) shared-edge abutment
    const pi = A.pts, pj = B.pts;
    for (let i = 0; i < pi.length; i++) { const ni = (i + 1) % pi.length;
      for (let j = 0; j < pj.length; j++) { const nj = (j + 1) % pj.length;
        const fwd = Math.hypot(pi[i].x - pj[j].x, pi[i].y - pj[j].y) < T && Math.hypot(pi[ni].x - pj[nj].x, pi[ni].y - pj[nj].y) < T;
        const rev = Math.hypot(pi[i].x - pj[nj].x, pi[i].y - pj[nj].y) < T && Math.hypot(pi[ni].x - pj[j].x, pi[ni].y - pj[j].y) < T;
        if (fwd || rev) out.push({ a: { x: pi[i].x, y: pi[i].y }, b: { x: pi[ni].x, y: pi[ni].y }, sec1: si, sec2: sj });
      }
    }
    // (2) face-plane intersections over overlapping regions. Apply node
    // overrides (apOv) so detection matches the rendered roof geometry.
    const skA = apOv(A._skel || skelFn(A.pts), A._no || {}), skB = apOv(B._skel || skelFn(B.pts), B._no || {});
    const fA = facesFn(skA.poly, skA), fB = facesFn(skB.poly, skB);
    fA.forEach(function (f1: any) {
      fB.forEach(function (f2: any) {
        const ov = polyClipConvex(f1.pts, f2.pts);
        if (ov.length < 3) return;
        const p1 = facePlaneFromFace(A, f1.pts), p2 = facePlaneFromFace(B, f2.pts);
        if (!p1 || !p2) return;
        const La = p1.a - p2.a, Lb = p1.b - p2.b, Lc = p1.c - p2.c;
        if (Math.hypot(La, Lb) < 1e-9) return; // parallel planes
        const cross: any[] = [];
        for (let k = 0; k < ov.length; k++) {
          const P = ov[k], Q = ov[(k + 1) % ov.length];
          const fP = La * P.x + Lb * P.y + Lc, fQ = La * Q.x + Lb * Q.y + Lc;
          if ((fP <= 0) !== (fQ <= 0)) { const t = fP / (fP - fQ); cross.push({ x: P.x + t * (Q.x - P.x), y: P.y + t * (Q.y - P.y) }); }
        }
        if (cross.length >= 2 && Math.hypot(cross[1].x - cross[0].x, cross[1].y - cross[0].y) > 3) {
          // ÉTAPE 5 — classify noue vs arêtier from the planes' upper envelope:
          // step perpendicular to the line on both sides; if the envelope rises
          // (slopes converge into a trough) it's a NOUE, if it drops (slopes
          // diverge over a peak) it's an ARÊTIER (hip).
          const mx = (cross[0].x + cross[1].x) / 2, my = (cross[0].y + cross[1].y) / 2;
          const dx = cross[1].x - cross[0].x, dy = cross[1].y - cross[0].y, Lc2 = Math.hypot(dx, dy) || 1;
          const ex = -dy / Lc2, ey = dx / Lc2, eps = Math.max(1, Lc2 * 0.15);
          const zAt = function (p: any, x: number, y: number) { return p.a * x + p.b * y + p.c; };
          const zM = zAt(p1, mx, my);
          const up1 = Math.max(zAt(p1, mx + ex * eps, my + ey * eps), zAt(p2, mx + ex * eps, my + ey * eps));
          const up2 = Math.max(zAt(p1, mx - ex * eps, my - ey * eps), zAt(p2, mx - ex * eps, my - ey * eps));
          const kind = (up1 > zM && up2 > zM) ? "valley" : (up1 < zM && up2 < zM) ? "hip" : "valley";
          out.push({ a: cross[0], b: cross[1], sec1: si, sec2: sj, kind: kind, h: zM });
        }
      });
    });
  }
  return out;
}

// -- LEGEND / MEASURES ---------------------------------
// Which line/face categories light up for each legend entry. Membrane (ice &
// water) ~ eaves + valleys. Débord de toit (drip-edge flashing) follows the
// same eaves as the membrane but drops the valleys and adds the gable rakes.
// Faîtière = every edge where two roof faces meet: the central ridge AND the
// hips/arêtiers (P1∪P2, P2∪P3, …) — all get a ridge cap.
export const HLSET: any = { face: ["face"], ridge: ["ridge", "hip"], valley: ["valley"], membrane: ["eave", "valley"], flashing: ["eave", "rake"], pignon: ["pignon"] };
export const LEGEND = [
  { key: "face", label: "Surface toiture", color: "#e0a060", area: true },
  { key: "ridge", label: "Faîtière", color: "#ff5566" },
  { key: "valley", label: "Noue", color: "#4ad6ff" },
  { key: "membrane", label: "Membrane autocoll.", color: "#b07cd6" },
  { key: "flashing", label: "Débord de toit (flashing)", color: "#39ff14" },
  { key: "pignon", label: "Pignon (mur)", color: "#d8ff00", area: true },
];
// Color ramp by pitch (X/12): low = blue, steep = red. Used to colour roof
// faces by slope when the "Surface toiture" legend entry is active.
export function pitchColor(p: number) {
  const t = Math.max(0, Math.min(12, p)) / 12;
  return "hsl(" + Math.round(210 - t * 190) + ",75%,55%)";
}
// Noues/arêtiers between sections, derived automatically from the plane
// crossings (endpoints snapped to existing geometry, buried crossings dropped).
export function computeValleys(secs: any) {
  const cands = valleyCandidates(secs);
  const ssc = sceneScale(secs), span = ssc ? 9 / ssc.sc : 100, thr = span * 0.025;
  cands.forEach(function (c: any) { c.a = snap3D(secs, c.a.x, c.a.y, thr); c.b = snap3D(secs, c.b.x, c.b.y, thr); });
  const subsumeTol = span * 0.05;
  return cands.filter(function (c: any) {
    if (Math.hypot(c.a.x - c.b.x, c.a.y - c.b.y) < thr * 0.4) return false;   // collapsed after snapping
    // Skip si l'une des 2 sections de la noue est entièrement subsumée par
    // l'autre — la noue serait à l'intérieur du volume de la section
    // englobante, donc non-physique.
    const sA = secs[c.sec1], sB = secs[c.sec2];
    if (isSectionSubsumed(sA, sB, subsumeTol) || isSectionSubsumed(sB, sA, subsumeTol)) return false;
    const mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2;
    const h = (c.h != null) ? c.h : valleyHeight(secs, { sec1: c.sec1, sec2: c.sec2 }, { x: mx, y: my });
    for (let si = 0; si < secs.length; si++) {
      if (si === c.sec1 || si === c.sec2 || secs[si].hidden) continue;
      if (sectionRoofHeightAt(secs[si], mx, my) > h + span * 0.03) return false;   // buried crossing
    }
    return true;
  }).map(function (c: any) { return { id: vid(), a: { x: c.a.x, y: c.a.y }, b: { x: c.b.x, y: c.b.y }, sec1: c.sec1, sec2: c.sec2, type: c.kind || "valley" }; });
}
// Totals per category in footprint units (lengths) / footprint units² (area).
// 3D length includes the rise of hips/valleys; ridges/eaves are horizontal.
export function computeMeasures(secs: any, valleys: any) {
  let ridge = 0, hip = 0, eave = 0, face = 0, valley = 0, pignon = 0, rake = 0;
  const byPitch: any = {};   // sloped area grouped by pitch (X/12)
  const list = secs || [];
  const all = collectFaces(list);          // every roof/gable face, planes + meta
  const epsz = sceneSpan(list) * 0.003;    // "strictly above" tolerance in Z
  // Is height z at (x,y) buried under a taller face of another section?
  const buriedUnder = function (si: number, x: number, y: number, z: number) {
    for (let k = 0; k < all.length; k++) { const B = all[k]; if (B.si === si || !B.pl || B.pignon) continue; if (pointInPoly(B.fpts, x, y) && (B.pl.a * x + B.pl.b * y + B.pl.c) > z + epsz) return true; }
    return false;
  };
  // Line tallies (ridge / hip / gable rake) + eave perimeter, per section.
  list.forEach(function (s: any, si: number) {
    if (!s.closed || s.pts.length < 3 || s.hidden) return;
    const sk = apOv(s._skel || skelFn(s.pts), s._no || {});
    const ratio = (s.pitch || 7) / 12;
    const pigSet = new Set(all.filter(function (fc: any) { return fc.si === si && fc.pignon; }).map(function (fc: any) { return fc.f; }));
    sk.edges.forEach(function (e: any) {
      const dz = (e.tb - e.ta) * ratio;
      const L = Math.sqrt((e.bx - e.ax) * (e.bx - e.ax) + (e.by - e.ay) * (e.by - e.ay) + dz * dz);
      if (e.isRidge) ridge += L;
      else if (pigSet.has(e.lf) || pigSet.has(e.rf)) rake += L;   // gable rake (débord de toit)
      else hip += L;
    });
    // Eave perimeter — skip the base edge of a gable wall (no drip edge there;
    // the gable's débord is its rake) and segments buried under a taller volume.
    const p = s.pts, eaveZ = (s.elev || 0) * 0.5;
    for (let i = 0; i < p.length; i++) {
      if (pigSet.has(i)) continue;   // base of a pignon wall, not a roof eave
      const j = (i + 1) % p.length, mx = (p[i].x + p[j].x) / 2, my = (p[i].y + p[j].y) / 2;
      if (!buriedUnder(si, mx, my, eaveZ)) eave += Math.hypot(p[j].x - p[i].x, p[j].y - p[i].y);
    }
  });
  // Surface = the visible outer shell: subtract each face's buried part exactly,
  // then scale its TRUE 3D area (Newell) by the visible fraction so untrimmed
  // faces stay identical to the per-face value and fully buried faces drop to 0.
  all.forEach(function (A: any) {
    const fullA = face3DArea(A.s, A.fpts);
    if (A.pignon) { if (!pignonBuried(A, all, epsz)) pignon += fullA; return; }   // skip walls buried inside another volume
    const fullPlan = polyAreaAbs(A.fpts.map(function (q: any) { return { x: q.x, y: q.y }; }));
    const pieces = faceShell(A, all, epsz);
    let visPlan = 0; pieces.forEach(function (pc: any) { visPlan += polyAreaAbs(pc); });
    const visA = fullPlan > 1e-6 ? fullA * Math.min(1, visPlan / fullPlan) : fullA;
    face += visA; byPitch[A.pitch] = (byPitch[A.pitch] || 0) + visA;
  });
  (valleys || []).forEach(function (v: any) {
    const ha = valleyHeight(secs, v, v.a), hb = valleyHeight(secs, v, v.b);
    valley += Math.sqrt((v.b.x - v.a.x) * (v.b.x - v.a.x) + (v.b.y - v.a.y) * (v.b.y - v.a.y) + (hb - ha) * (hb - ha));
  });
  return { face, ridge: ridge + hip, hip, eave, valley, pignon, rake, membrane: eave + valley, flashing: eave + rake, byPitch };
}

// Self-adhesive membrane (ice & water) coverage strips at REAL width Wpx (world
// px). EAVES: a band Wpx inward from every real eave (gable bases skipped,
// buried portions clipped) with mitred corners. VALLEYS: chained into polylines
// and offset ±Wpx/2 on BOTH sides (the strip is centred on the noue), mitred at
// the crossings. Returns 3D world segments {ax,ay,az,bx,by,bz} lifted onto the
// roof surface — for a dashed width overlay.
export function membraneStrips(secs: any, valleys: any, Wpx: number) {
  const segs: any[] = [];
  if (!(Wpx > 0) || !secs) return segs;
  const all = collectFaces(secs);
  const epsz = sceneSpan(secs) * 0.003;
  const heightAt = function (x: number, y: number) {
    let z = -Infinity;
    for (let i = 0; i < secs.length; i++) { const s = secs[i]; if (!s.closed || s.hidden || s.pts.length < 3) continue; const h = sectionRoofHeightAt(s, x, y); if (h > z) z = h; }
    // Per-face lookup fails on a knife-edge (a point exactly on a hip diagonal);
    // fall back to the uniform-pitch height, which only needs the section polygon.
    if (z === -Infinity) { for (let i = 0; i < secs.length; i++) { const s = secs[i]; if (!s.closed || s.hidden || s.pts.length < 3) continue; const h = roofHeightAt(s, x, y); if (h > z) z = h; } }
    return z;
  };
  const buried = function (si: number, x: number, y: number, z: number) {
    for (let k = 0; k < all.length; k++) { const B = all[k]; if (B.si === si || !B.pl || B.pignon) continue; if (pointInPoly(B.fpts, x, y) && (B.pl.a * x + B.pl.b * y + B.pl.c) > z + epsz) return true; }
    return false;
  };
  // Push an offset segment; lift each end onto the roof, falling back to the
  // reference (centre-line) point when the offset point sits just off a footprint.
  const pushZ = function (oa: any, ob: any, ca: any, cb: any) {
    let az = heightAt(oa.x, oa.y); if (az === -Infinity) az = heightAt(ca.x, ca.y);
    let bz = heightAt(ob.x, ob.y); if (bz === -Infinity) bz = heightAt(cb.x, cb.y);
    if (az === -Infinity || bz === -Infinity) return;
    segs.push({ ax: oa.x, ay: oa.y, az: az, bx: ob.x, by: ob.y, bz: bz });
  };
  const lerp = function (a: any, b: any, t: number) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; };
  // EAVES — mitred inward offset, clipped to the exposed (non-buried) portions.
  secs.forEach(function (s: any, si: number) {
    if (!s.closed || s.hidden || s.pts.length < 3) return;
    const sk = apOv(s._skel || skelFn(s.pts), s._no || {});
    const poly = sk.poly, n = poly.length, ez = (s.elev || 0) * 0.5;
    const pigSet = new Set<number>(); facesFn(poly, sk).forEach(function (f: any) { if (isPignon(s, f.pts)) pigSet.add(f.f); });
    const edgeN: any[] = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n]; let nx = -(b.y - a.y), ny = (b.x - a.x); const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; if (!pointInPoly(poly, mx + nx * 0.5, my + ny * 0.5)) { nx = -nx; ny = -ny; }
      edgeN.push({ x: nx, y: ny });
    }
    const offV = function (i: number) {   // mitred inward offset of vertex i
      const np = edgeN[(i - 1 + n) % n], nc = edgeN[i], v = poly[i];
      let bx = np.x + nc.x, by = np.y + nc.y; const bl = Math.hypot(bx, by);
      if (bl < 1e-6) return { x: v.x + nc.x * Wpx, y: v.y + nc.y * Wpx };
      bx /= bl; by /= bl; const d = bx * nc.x + by * nc.y;
      if (Math.abs(d) < 0.2) return { x: v.x + nc.x * Wpx, y: v.y + nc.y * Wpx };
      const t = Wpx / d; return { x: v.x + bx * t, y: v.y + by * t };
    };
    for (let i = 0; i < n; i++) {
      if (pigSet.has(i)) continue;
      const a = poly[i], b = poly[(i + 1) % n], oa = offV(i), ob = offV((i + 1) % n);
      // Skip internal merge edges (a dormer/section seam, handled by the valley
      // band): if the edge's OUTWARD side lands inside another section, it's not
      // a building eave.
      const mxo = (a.x + b.x) / 2 - edgeN[i].x * 3, myo = (a.y + b.y) / 2 - edgeN[i].y * 3;
      let shared = false;
      for (let q = 0; q < secs.length; q++) { const os = secs[q]; if (q === si || !os.closed || os.hidden || os.pts.length < 3) continue; if (pointInPoly(os.pts, mxo, myo)) { shared = true; break; } }
      if (shared) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const N = Math.min(80, Math.max(1, Math.ceil(len / Math.max(4, Wpx * 0.5))));
      const exposed: boolean[] = [];
      for (let k = 0; k < N; k++) { const m = lerp(a, b, (k + 0.5) / N); exposed.push(!buried(si, m.x, m.y, ez)); }
      let k = 0;
      while (k < N) {
        if (!exposed[k]) { k++; continue; }
        let j = k; while (j < N && exposed[j]) j++;
        const t0 = k / N, t1 = j / N;
        pushZ(lerp(oa, ob, t0), lerp(oa, ob, t1), lerp(a, b, t0), lerp(a, b, t1));
        k = j;
      }
    }
  });
  // VALLEYS — chain the segments into polylines, then offset ±Wpx/2 on BOTH
  // sides with mitred joints so the band is centred and trims at the crossings.
  const vsegs = (valleys || []).map(function (v: any) { return { a: { x: v.a.x, y: v.a.y }, b: { x: v.b.x, y: v.b.y } }; })
    .filter(function (v: any) { return Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y) > 1e-6; });
  const tol = 1.0, near = function (p: any, q: any) { return Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol; };
  const used = new Array(vsegs.length).fill(false), chains: any[] = [];
  for (let i = 0; i < vsegs.length; i++) {
    if (used[i]) continue; used[i] = true;
    const chain = [vsegs[i].a, vsegs[i].b]; let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < vsegs.length; j++) {
        if (used[j]) continue; const sg = vsegs[j], head = chain[0], tail = chain[chain.length - 1];
        if (near(tail, sg.a)) { chain.push(sg.b); used[j] = true; grew = true; }
        else if (near(tail, sg.b)) { chain.push(sg.a); used[j] = true; grew = true; }
        else if (near(head, sg.a)) { chain.unshift(sg.b); used[j] = true; grew = true; }
        else if (near(head, sg.b)) { chain.unshift(sg.a); used[j] = true; grew = true; }
      }
    }
    chains.push(chain);
  }
  const h = Wpx / 2;
  chains.forEach(function (pts: any[]) {
    const m = pts.length; if (m < 2) return;
    const sN: any[] = [];
    for (let i = 0; i < m - 1; i++) { const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y, L = Math.hypot(dx, dy) || 1; sN.push({ x: -dy / L, y: dx / L }); }
    [h, -h].forEach(function (off: number) {
      const o: any[] = [];
      for (let i = 0; i < m; i++) {
        if (i === 0) o.push({ x: pts[0].x + sN[0].x * off, y: pts[0].y + sN[0].y * off });
        else if (i === m - 1) o.push({ x: pts[m - 1].x + sN[m - 2].x * off, y: pts[m - 1].y + sN[m - 2].y * off });
        else {
          const np = sN[i - 1], nc = sN[i]; let bx = np.x + nc.x, by = np.y + nc.y; const bl = Math.hypot(bx, by);
          if (bl < 1e-6) { o.push({ x: pts[i].x + nc.x * off, y: pts[i].y + nc.y * off }); continue; }
          bx /= bl; by /= bl; const d = bx * nc.x + by * nc.y; const t = Math.abs(d) < 0.2 ? off : off / d;
          o.push({ x: pts[i].x + bx * t, y: pts[i].y + by * t });
        }
      }
      for (let i = 0; i < m - 1; i++) pushZ(o[i], o[i + 1], pts[i], pts[i + 1]);
    });
  });
  return segs;
}

// -- COLORS --------------------------------------------
export const SC = ["#4499ff", "#ff9944", "#44ddaa", "#ff4488", "#ffcc44", "#aa44ff", "#ff6644", "#44ffcc"];
export const PAL = [["#e74c3c", "#e67e22", "#f39c12", "#d35400"], ["#27ae60", "#16a085", "#2980b9", "#1abc9c"], ["#8e44ad", "#9b59b6", "#2c3e50", "#7f8c8d"], ["#fd79a8", "#e84393", "#6c5ce7", "#0984e3"], ["#f9ca24", "#f0932b", "#eb4d4b", "#6ab04c"]];
export function shadeColor(hex: string, normal: any) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const s = Math.max(0, d3(normal, LIGHT)) * 0.65 + 0.35;
  return "rgb(" + Math.round(r * s) + "," + Math.round(g * s) + "," + Math.round(b * s) + ")";
}

// -- SOFTWARE Z-BUFFER (solid mode) --------------------
// Per-pixel hidden-surface removal so overlapping roof volumes show only the
// nearest surface (the upper envelope) instead of bleeding through each other,
// which the painter's algorithm can't do. Buffers are cached and reused.
export let _zW = 0, _zH = 0, _zDepth: Float32Array | null = null, _zImg: ImageData | null = null;
export function parseRGB(c: string): [number, number, number] {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c);
  return m ? [+m[1], +m[2], +m[3]] : [150, 150, 150];
}
export function rasterTri(A: any, B: any, C: any, r: number, g: number, b: number, data: any, depth: Float32Array, W: number, H: number) {
  const minX = Math.max(0, Math.floor(Math.min(A.sx, B.sx, C.sx))), maxX = Math.min(W - 1, Math.ceil(Math.max(A.sx, B.sx, C.sx)));
  const minY = Math.max(0, Math.floor(Math.min(A.sy, B.sy, C.sy))), maxY = Math.min(H - 1, Math.ceil(Math.max(A.sy, B.sy, C.sy)));
  const area = (B.sx - A.sx) * (C.sy - A.sy) - (B.sy - A.sy) * (C.sx - A.sx);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = (C.sx - B.sx) * (py - B.sy) - (C.sy - B.sy) * (px - B.sx);
      const w1 = (A.sx - C.sx) * (py - C.sy) - (A.sy - C.sy) * (px - C.sx);
      const w2 = (B.sx - A.sx) * (py - A.sy) - (B.sy - A.sy) * (px - A.sx);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
        const d = (w0 * A.d + w1 * B.d + w2 * C.d) / area;
        const idx = y * W + x;
        if (d < depth[idx]) { depth[idx] = d; const o = idx * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255; }
      }
    }
  }
}
export function zbufferFaces(ctx: any, W: number, H: number, faces: any[], pp: any, secs: any) {
  if (_zW !== W || _zH !== H || !_zDepth || !_zImg) { _zW = W; _zH = H; _zDepth = new Float32Array(W * H); _zImg = ctx.createImageData(W, H); }
  const depth = _zDepth, img = _zImg, data = img.data;
  depth.fill(Infinity);
  for (let i = 0; i < data.length; i += 4) { data[i] = 6; data[i + 1] = 6; data[i + 2] = 16; data[i + 3] = 255; }
  faces.forEach(function (f: any) {
    const hiddenSec = f.si != null && secs[f.si] && secs[f.si].hidden;
    if (hiddenSec) return;
    const sp = f.pts3.map(function (q: any) { return pp(q.x, q.y, q.z); });
    if (sp.some(function (p: any) { return !p; })) return;
    const rgb = parseRGB(f.color);
    for (let k = 1; k < sp.length - 1; k++) rasterTri(sp[0], sp[k], sp[k + 1], rgb[0], rgb[1], rgb[2], data, depth, W, H);
  });
  ctx.putImageData(img, 0, 0);
}
// Draw a 3D line in solid mode with hidden-line removal: walk it in screen space
// and only stroke the parts whose depth is in front of the z-buffer (faces).
export function drawLineZ(ctx: any, A: any, B: any, color: string, width: number, alpha: number, dash: any) {
  if (!A || !B || !_zDepth) { return; }
  const depth = _zDepth, W = _zW, H = _zH, BIAS = 0.18;
  const steps = Math.max(2, Math.ceil(Math.hypot(B.sx - A.sx, B.sy - A.sy) / 4));
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha; if (dash) ctx.setLineDash(dash);
  let pen = false;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = A.sx + (B.sx - A.sx) * t, y = A.sy + (B.sy - A.sy) * t, d = A.d + (B.d - A.d) * t;
    const xi = x | 0, yi = y | 0;
    let vis = true;
    if (xi >= 0 && xi < W && yi >= 0 && yi < H) { if (d > depth[yi * W + xi] + BIAS) vis = false; }
    if (vis) { if (!pen) { ctx.beginPath(); ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y); }
    else if (pen) { ctx.stroke(); pen = false; }
  }
  if (pen) ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

// -- 3D RENDERER ----------------------------------------
export function render3D(ctx: any, W: number, H: number, secs: any, sel3D: any, orb: any, hCacheRef: any, solid: boolean, valleys: any, selV: number, hl: string | null, selFace: any, areaFmt?: (px2: number) => string, membraneSegs?: any[]) {
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#060610"; ctx.fillRect(0, 0, W, H);
  const view = buildView(orb.phi, orb.theta, orb.r), fov = 50 * Math.PI / 180;
  function pp(x: number, y: number, z: number) { return proj3(x, y, z, view, fov, W, H); }
  const hlCatsTop: any = hl ? (HLSET[hl] || []) : null;
  // Solid + no legend filter → use the software z-buffer (correct occlusion).
  const useZ = solid && !hlCatsTop;
  if (!useZ) {
    ctx.strokeStyle = "rgba(30,50,100,0.35)"; ctx.lineWidth = 0.5;
    for (let i = -10; i <= 10; i++) {
      const a = pp(i, 0, -10), b = pp(i, 0, 10); if (a && b) { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
      const c = pp(-10, 0, i), dd = pp(10, 0, i); if (c && dd) { ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(dd.sx, dd.sy); ctx.stroke(); }
    }
  }
  const allPts = secs.reduce(function (acc: any[], s: any) { return acc.concat(s.pts || []); }, []);
  if (!allPts.length) return;
  const xs = allPts.map(function (p: any) { return p.x; }), ys = allPts.map(function (p: any) { return p.y; });
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const sc = 9 / Math.max(maxX - minX, maxY - minY, 1), ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  const hasSel = sel3D.sec >= 0;
  const faces: any[] = [], lines: any[] = [];
  const allF = collectFaces(secs);          // cross-section faces for shell trim
  const epsz = sceneSpan(secs) * 0.003;
  // Tolérance utilisée pour décider qu'une section est entièrement subsumée
  // sous une autre — on précompute span une fois pour éviter la N×N de
  // sceneSpan dans chaque check.
  const subsumeTol = sceneSpan(secs) * 0.05;
  secs.forEach(function (sec: any, si: number) {
    if (!sec.closed || sec.pts.length < 3) return;
    // Skip les sections entièrement subsumées sous une autre — elles produisent
    // un volume non-visible qui pollue le 3D (eaves, faîtières, faces qui
    // traversent la section englobante). Le check est moitié-vote : si une
    // autre section est strictement au-dessus sur ≥50% des probes (centroïde
    // + tous les vertices), on cache.
    let subsumed = false;
    for (let k = 0; k < secs.length; k++) {
      if (k === si) continue;
      if (isSectionSubsumed(sec, secs[k], subsumeTol)) { subsumed = true; break; }
    }
    if (subsumed) return;
    const isA = !hasSel || si === sel3D.sec, fOp = hasSel ? (isA ? 1 : 0.35) : 1;
    const eY = (sec.elev || 0) * sc * 0.5;
    const sk0 = skelFn(sec.pts), sk = apOv(sk0, sec._no || {});
    const fp = sec.hf > 0 ? getFacePitches(sk0, sk0.poly, sec._no || {}, sec.hf) : null;
    const pal = PAL[si % PAL.length];
    let fs = facesFn(sk.poly, sk);
    // Toit plat : on remplace les faces/edges par une seule face = le polygone
    // horizontal (t=0 → tous les points à z=eY). Pas de skeleton edges, pas
    // d'arêtes internes — cohérent avec le fix 2D (collectFaces / draw2D).
    // Les murs verticaux et le périmètre d'eave restent affichés normalement.
    if (sec.roof_type === "flat") {
      fs = [{ f: 0, pts: sec.pts.map(function (p: any) { return { x: p.x, y: p.y, t: 0 }; }) }];
      // Override les edges du skeleton pour le loop de rendu plus bas.
      (sk as any).edges = [];
    }
    const pigSet = new Set<number>();
    fs.forEach(function (face: any) { if (isPignon(sec, face.pts)) pigSet.add(face.f); });
    fs.forEach(function (face: any) {
      const pv = fp && fp[face.f] != null ? fp[face.f] : (sec.pitch || 7);
      const ratio = pv / 12;
      const pl = facePlaneFromFace(sec, face.pts), grad = pl ? Math.hypot(pl.a, pl.b) : Infinity;
      if (grad > PIGNON_GRAD) {   // vertical gable wall — drawn whole, lifted by t
        if (pignonBuried({ si: si, s: sec, fpts: face.pts }, allF, epsz)) return;   // interior wall → hidden
        const pts3 = face.pts.map(function (q: any) { return { x: (q.x - ox) * sc, y: eY + q.t * ratio * sc, z: (q.y - oy) * sc }; });
        if (pts3.length < 3) return;
        const nm = n3(x3(s3(pts3[1], pts3[0]), s3(pts3[2], pts3[0])));
        const depth = pts3.reduce(function (s: number, q: any) { return s - d3(s3(q, view.eye), view.cz); }, 0) / pts3.length;
        faces.push({ pts3, depth, color: shadeColor("#8a93a8", nm), opacity: fOp, cat: "pignon", si, pitch: pv, nm });
        return;
      }
      // Roof pan: keep only the visible outer-shell pieces (buried parts removed),
      // each lifted onto this face's plane. Fully buried faces produce 0 pieces.
      const A = { si: si, s: sec, f: face.f, fpts: face.pts, pl: pl, grad: grad, pignon: false, pitch: pv };
      faceShell(A, allF, epsz).forEach(function (piece: any) {
        const pts3 = piece.map(function (q: any) { return { x: (q.x - ox) * sc, y: (pl.a * q.x + pl.b * q.y + pl.c) * sc, z: (q.y - oy) * sc }; });
        if (pts3.length < 3) return;
        const nm = n3(x3(s3(pts3[1], pts3[0]), s3(pts3[2], pts3[0])));
        const depth = pts3.reduce(function (s: number, q: any) { return s - d3(s3(q, view.eye), view.cz); }, 0) / pts3.length;
        faces.push({ pts3, depth, color: shadeColor(pal[face.f % pal.length], nm), opacity: fOp, cat: "face", si, pitch: pv, nm });
      });
    });
    const ratio0 = fp && fp[0] != null ? (fp[0] / 12) : ((sec.pitch || 7) / 12);
    const ez = (sec.elev || 0) * 0.5;
    // Is height z at (x,y) buried under a taller face of another section?
    const buriedAt = function (x: number, y: number, z: number) {
      for (let k = 0; k < allF.length; k++) { const B = allF[k]; if (B.si === si || !B.pl || B.pignon) continue; if (pointInPoly(B.fpts, x, y) && (B.pl.a * x + B.pl.b * y + B.pl.c) > z + epsz) return true; }
      return false;
    };
    // Push only the portions of a footprint segment (with end heights za,zb)
    // that are NOT buried, so lines crossing an intersection get cut at the
    // boundary instead of drawing through (or vanishing) as a whole.
    const pushSeg = function (ax: number, ay: number, za: number, bx: number, by: number, zb: number, line: any) {
      const N = 40, segLen = Math.hypot(bx - ax, by - ay), minRun = epsz * 4; let s0 = -1, prevVis = false;
      for (let i = 0; i <= N; i++) {
        const u = i / N, x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = za + (zb - za) * u;
        const vis = !buriedAt(x, y, z);
        if (vis && !prevVis) s0 = u;
        if ((!vis || i === N) && prevVis) {
          const u1 = vis ? u : (i - 1) / N;
          const ix = function (uu: number) { return ax + (bx - ax) * uu; }, iy = function (uu: number) { return ay + (by - ay) * uu; }, iz = function (uu: number) { return za + (zb - za) * uu; };
          if ((u1 - s0) * segLen > minRun) lines.push(Object.assign({ a: { x: (ix(s0) - ox) * sc, y: iz(s0) * sc, z: (iy(s0) - oy) * sc }, b: { x: (ix(u1) - ox) * sc, y: iz(u1) * sc, z: (iy(u1) - oy) * sc } }, line));
        }
        prevVis = vis;
      }
    };
    sk.edges.forEach(function (e: any) {
      const ra = fp && fp[e.rf] != null ? (fp[e.rf] / 12) : ratio0, rb = fp && fp[e.lf] != null ? (fp[e.lf] / 12) : ratio0;
      const isRake = pigSet.has(e.lf) || pigSet.has(e.rf);   // skeleton edge bordering a gable wall = rake
      const cat = e.isRidge ? "ridge" : (isRake ? "rake" : "hip");
      pushSeg(e.ax, e.ay, ez + e.ta * ra, e.bx, e.by, ez + e.tb * ((ra + rb) / 2), { color: e.isRidge ? "#ff5555" : "#88ddff", op: isA ? 1 : 0.2, w: e.isRidge ? 2 : 1.5, cat: cat, si });
    });
    sk.poly.forEach(function (q: any, i: number) {
      if (pigSet.has(i)) return;   // base of a pignon wall — not a roof eave
      const nq = sk.poly[(i + 1) % sk.poly.length];
      pushSeg(q.x, q.y, ez, nq.x, nq.y, ez, { color: SC[si % SC.length], op: isA ? 1 : 0.25, w: 2, cat: "eave", si });
    });
    // Building 3D : N quads verticaux (un par arête du footprint des murs) du
    // sol au niveau d'eave. `_height_px` est précalculé par AdminRoofStudio
    // (height_ft × 0.3048 / gsd) pour rester en image-pixels et matcher
    // l'échelle des secs.pts. Aucun mur si pas de footprint ou pas de hauteur.
    if (sec.building && sec.building.pts && sec.building.pts.length >= 3 && sec.building._height_px > 0) {
      const bp = sec.building.pts;
      const wallTopY = ez;
      const wallBotY = ez - sec.building._height_px;
      for (let bi = 0; bi < bp.length; bi++) {
        const p1 = bp[bi], p2 = bp[(bi + 1) % bp.length];
        const a = { x: (p1.x - ox) * sc, y: wallBotY * sc, z: (p1.y - oy) * sc };
        const b = { x: (p2.x - ox) * sc, y: wallBotY * sc, z: (p2.y - oy) * sc };
        const c = { x: (p2.x - ox) * sc, y: wallTopY * sc, z: (p2.y - oy) * sc };
        const d = { x: (p1.x - ox) * sc, y: wallTopY * sc, z: (p1.y - oy) * sc };
        const pts3 = [a, b, c, d];
        const nm = n3(x3(s3(pts3[1], pts3[0]), s3(pts3[2], pts3[0])));
        const depth = (pts3.reduce(function (acc: number, q: any) { return acc - d3(s3(q, view.eye), view.cz); }, 0)) / 4;
        faces.push({ pts3, depth, color: shadeColor("#6a7080", nm), opacity: fOp, cat: "wall", si, nm });
        // Plinthe + arêtes verticales — fines, gris-bleu — pour la lecture du volume.
        lines.push({ a, b, color: "#7a8499", op: isA ? 0.8 : 0.3, w: 1.3, cat: "wall-base", si });
        lines.push({ a: a, b: d, color: "#7a8499", op: isA ? 0.8 : 0.3, w: 1.3, cat: "wall-corner", si });
      }
    }
  });
  // Draw faces and lines together, sorted far-to-near (painter's algorithm),
  // so that in solid mode opaque faces hide the lines that fall behind them
  // (interior ridges / the far footprint). In transparent mode faces are
  // semi-opaque and the structure shows through.
  const dpt = (q: any) => -d3(s3(q, view.eye), view.cz);
  lines.forEach(function (ln: any) { ln.depth = (dpt(ln.a) + dpt(ln.b)) / 2; ln._line = true; });
  const items = (faces as any[]).concat(lines as any[]);
  items.sort(function (a, b) { return b.depth - a.depth; });
  const faceMul = solid ? 1 : 0.4;
  const hlCats: any = hl ? (HLSET[hl] || []) : null;     // active highlight categories
  // Highlight glow uses the active legend entry's own colour (faîtière=red,
  // noue=blue, membrane=mauve, débord=fluo green) instead of one flat yellow.
  const HLC = hl ? (((LEGEND.find(function (l: any) { return l.key === hl; }) || {}) as any).color || "#d8ff00") : "#d8ff00";
  // Solid mode (no legend filter): rasterize the faces with the z-buffer so only
  // the nearest surface shows; lines are then drawn on top by the loop below.
  if (useZ) zbufferFaces(ctx, W, H, faces, pp, secs);
  items.forEach(function (it: any) {
    const hiddenSec = it.si != null && secs[it.si] && secs[it.si].hidden;
    if (it._line) {
      const a = pp(it.a.x, it.a.y, it.a.z), b = pp(it.b.x, it.b.y, it.b.z); if (!a || !b) return;
      const on = !hiddenSec && (!hlCats || hlCats.indexOf(it.cat) >= 0);
      // En mode highlight (légende active), on SKIP complètement les lignes hors
      // catégorie au lieu de les dessiner en alpha 0.1. Ça enlève le bruit
      // visuel des arêtes internes qui contaminaient chaque vue.
      if (hlCats && !on) return;
      const col = (hlCats && on) ? HLC : it.color;
      const lw = (it.w || 1.5) + (hlCats && on ? 2.5 : 0);
      const al = (!hlCats ? it.op : 1) * (hiddenSec ? 0.3 : 1);
      if (useZ) { drawLineZ(ctx, a, b, col, lw, al, it.dash ? [4, 3] : null); return; }
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.globalAlpha = al;
      if (hlCats && on) { ctx.shadowColor = col; ctx.shadowBlur = 14; }
      if (it.dash) ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    } else {
      if (useZ) return;               // faces already drawn by the z-buffer pass
      if (hiddenSec && solid) return; // construction faces don't render in solid mode
      const pts = it.pts3.map(function (q: any) { return pp(q.x, q.y, q.z); });
      if (pts.some(function (q: any) { return !q; })) return;
      const fon = !hiddenSec && (!hlCats || hlCats.indexOf(it.cat) >= 0);
      // En mode highlight, on saute aussi les faces hors catégorie (au lieu de
      // les fondre à 18% — ça créait du bruit visuel "lignes noir intérieur").
      if (hlCats && !fon) return;
      ctx.beginPath(); pts.forEach(function (q: any, i: number) { if (i === 0) ctx.moveTo(q.sx, q.sy); else ctx.lineTo(q.sx, q.sy); });
      const byPitchFill = hl === "face" && it.cat === "face" && !hiddenSec;
      const pignonFill = hl === "pignon" && it.cat === "pignon" && !hiddenSec;
      ctx.closePath(); ctx.globalAlpha = it.opacity * faceMul * (hiddenSec ? 0.35 : 1); ctx.fillStyle = byPitchFill ? pitchColor(it.pitch) : pignonFill ? "#d8ff00" : it.color; ctx.fill();
      // Outline noir CONSERVÉ uniquement hors mode highlight — sinon ça pollue.
      if (!hlCats) {
        ctx.globalAlpha = it.opacity * faceMul * 0.4 * (hiddenSec ? 0.35 : 1); ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  });
  // Editable valley lines, lifted onto the roof surface (real 3D height).
  (valleys || []).forEach(function (v: any, vi: number) {
    const a3 = pp((v.a.x - ox) * sc, valleyHeight(secs, v, v.a) * sc, (v.a.y - oy) * sc);
    const b3 = pp((v.b.x - ox) * sc, valleyHeight(secs, v, v.b) * sc, (v.b.y - oy) * sc);
    if (!a3 || !b3) return;
    const isSelV = vi === selV;
    const vOn = !hlCats || hlCats.indexOf("valley") >= 0;
    const vcol = (hlCats && vOn) ? HLC : (VCOLOR[v.type] || "#4ad6ff");
    const vlw = (isSelV ? 4 : 2.5) + (hlCats && vOn ? 2 : 0);
    const val = !hlCats ? (v.locked ? 1 : 0.9) : (vOn ? 1 : 0.1);
    const vdash = (!v.locked && !(hlCats && vOn)) ? [6, 3] : null;
    if (useZ) { drawLineZ(ctx, a3, b3, vcol, vlw, val, vdash); }
    else {
      ctx.beginPath(); ctx.moveTo(a3.sx, a3.sy); ctx.lineTo(b3.sx, b3.sy);
      ctx.strokeStyle = vcol; ctx.lineWidth = vlw; ctx.globalAlpha = val;
      if (hlCats && vOn) { ctx.shadowColor = vcol; ctx.shadowBlur = 14; }
      if (vdash) ctx.setLineDash(vdash); ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (isSelV) { [a3, b3].forEach(function (e: any) { ctx.beginPath(); ctx.arc(e.sx, e.sy, 6, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.strokeStyle = VCOLOR[v.type]; ctx.lineWidth = 2; ctx.fill(); ctx.stroke(); }); }
  });

  // Self-adhesive membrane real-width band (36" eaves inward + ±18" around the
  // noues): dashed magenta on top of the mauve centre lines, when "membrane" is
  // the active legend entry. Segments are pre-computed (calibrated) by the host.
  if (hl === "membrane" && membraneSegs && membraneSegs.length) {
    ctx.save(); ctx.setLineDash([7, 5]); ctx.lineWidth = 1.8; ctx.strokeStyle = "#ff3ea8"; ctx.globalAlpha = 0.95; ctx.shadowColor = "#ff3ea8"; ctx.shadowBlur = 6;
    membraneSegs.forEach(function (sg: any) {
      const a = pp((sg.ax - ox) * sc, sg.az * sc, (sg.ay - oy) * sc), b = pp((sg.bx - ox) * sc, sg.bz * sc, (sg.by - oy) * sc);
      if (!a || !b) return;
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    });
    ctx.setLineDash([]); ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.restore();
  }

  // Edge-edit handles removed: the 3D view no longer edits segments.
  if (hCacheRef) hCacheRef.current = [];

  // Inspected face: outline its visible SHELL (buried parts removed, no internal
  // seams) and label its plane (P#, pitch X/12, slope dir, VISIBLE area).
  if (selFace && secs[selFace.si] && secs[selFace.si].closed) {
    const sec = secs[selFace.si];
    const A = allF.find(function (F: any) { return F.si === selFace.si && F.f === selFace.fi; });
    if (A && A.pl) {
      const proj = function (q: any) { return pp((q.x - ox) * sc, (A.pl.a * q.x + A.pl.b * q.y + A.pl.c) * sc, (q.y - oy) * sc); };
      const pieces = faceShell(A, allF, epsz);
      let labelPts: any = null, visPlan = 0;
      // Fill the visible shell pieces (no per-piece stroke → no internal seams).
      pieces.forEach(function (piece: any) {
        visPlan += polyAreaAbs(piece);
        const sp = piece.map(proj);
        if (sp.some(function (p: any) { return !p; })) return;
        ctx.beginPath(); sp.forEach(function (p: any, i: number) { if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy); });
        ctx.closePath(); ctx.fillStyle = "rgba(216,255,0,0.18)"; ctx.fill();
        if (!labelPts || sp.length > labelPts.length) labelPts = sp;
      });
      // Outline the visible boundary only (never the part behind a noue/volume).
      shellOutlineEdges(pieces).forEach(function (e: any) {
        const a = proj(e[0]), b = proj(e[1]); if (!a || !b) return;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
        ctx.strokeStyle = "#d8ff00"; ctx.lineWidth = 2.5; ctx.stroke();
      });
      if (labelPts) {
        const cx = labelPts.reduce(function (s: number, p: any) { return s + p.sx; }, 0) / labelPts.length;
        const cy = labelPts.reduce(function (s: number, p: any) { return s + p.sy; }, 0) / labelPts.length;
        // Visible 3D area = full face area × visible plan fraction (matches totals).
        const fullPlan = polyAreaAbs(A.fpts.map(function (q: any) { return { x: q.x, y: q.y }; }));
        const fullA = face3DArea(sec, A.fpts);
        const visA = fullPlan > 1e-6 ? fullA * Math.min(1, visPlan / fullPlan) : fullA;
        const label = "P" + selFace.num + " · " + (sec.pitch || 7) + "/12 · " + slopeDir(A.pl) + " · " + (areaFmt ? areaFmt(visA) : Math.round(visA) + " u²");
        ctx.font = "bold 13px monospace"; const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(9,10,25,0.9)"; ctx.fillRect(cx - tw / 2 - 7, cy - 12, tw + 14, 24);
        ctx.strokeStyle = "#d8ff00"; ctx.lineWidth = 1; ctx.strokeRect(cx - tw / 2 - 7, cy - 12, tw + 14, 24);
        ctx.fillStyle = "#e8ff66"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, cx, cy);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      }
    }
  }

  ctx.font = "11px monospace"; ctx.fillStyle = "rgba(60,90,150,.8)";
  if (selFace) ctx.fillText("Plan P" + selFace.num + " — tape une autre face", 10, H - 12);
  else if (!hasSel) ctx.fillText("Tap section / face", 10, H - 12);
  else ctx.fillText("S" + (sel3D.sec + 1) + (sel3D.edge >= 0 ? " arete " + sel3D.edge : " - tap arete"), 10, H - 12);
}

export function hitFace3D(sx: number, sy: number, secs: any, view: any, fov: number, W: number, H: number) {
  const allPts = secs.reduce(function (acc: any[], s: any) { return acc.concat(s.pts || []); }, []);
  if (!allPts.length) return -1;
  const xs = allPts.map(function (p: any) { return p.x; }), ys = allPts.map(function (p: any) { return p.y; });
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const sc = 9 / Math.max(maxX - minX, maxY - minY, 1), ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  function pp(x: number, y: number, z: number) { return proj3(x, y, z, view, fov, W, H); }
  for (let si = secs.length - 1; si >= 0; si--) {
    const sec = secs[si]; if (!sec.closed || sec.pts.length < 3) continue;
    const eY = (sec.elev || 0) * sc * 0.5;
    const pts = sec.pts.map(function (q: any) { return pp((q.x - ox) * sc, eY, (q.y - oy) * sc); });
    if (pts.some(function (q: any) { return !q; })) continue;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].sx, yi = pts[i].sy, xj = pts[j].sx, yj = pts[j].sy;
      if (((yi > sy) !== (yj > sy)) && (sx < (xj - xi) * (sy - yi) / (yj - yi) + xi)) inside = !inside;
    }
    if (inside) return si;
  }
  return -1;
}

// -- 2D DRAW -------------------------------------------
export const TOFF = 85, HITR = 22;
export function w2s(wx: number, wy: number, xf: any) { return { sx: wx * xf.scale + xf.tx, sy: wy * xf.scale + xf.ty }; }

export function draw2D(ctx: any, W: number, H: number, secs: any, ai: number, sel: number, prev: any, bgImg: any, bgOp: number, xf: any, selNode: any, valleys: any, selV: number, solid: boolean, guide?: any, perp?: any, imgFilter?: string) {
  const scale = xf.scale, tx = xf.tx, ty = xf.ty;
  const sec = secs[ai] || { pts: [], closed: false }, col = SC[ai % SC.length];
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#060610"; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(tx, ty); ctx.scale(scale, scale);
  if (guide) {   // soft parallel guide for the node being dragged
    const BIG = 9000;
    ctx.beginPath(); ctx.moveTo(guide.ox - guide.dx * BIG, guide.oy - guide.dy * BIG); ctx.lineTo(guide.ox + guide.dx * BIG, guide.oy + guide.dy * BIG);
    ctx.strokeStyle = guide.on ? (guide.ridge ? "rgba(33,230,255,0.95)" : guide.center ? "rgba(80,230,255,0.95)" : "rgba(190,200,220,0.7)") : "rgba(150,160,185,0.35)"; ctx.lineWidth = (guide.on ? (guide.center || guide.ridge ? 2 : 1.5) : 1) / scale; ctx.setLineDash([7 / scale, 6 / scale]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (bgImg && bgImg.naturalWidth > 0) {
    // Image-native: draw at natural resolution in world space (1 world unit =
    // 1 image pixel). The xf transform supplies the contain-fit, so the image
    // is never cropped nor stretched and MVP image-pixel points land exactly.
    // imgFilter (e.g. "brightness(1.2) contrast(0.9)") s'applique UNIQUEMENT
    // sur l'image de fond — pas sur les annotations dessinées après — pour ne
    // pas dénaturer les couleurs des polygones.
    if (imgFilter && imgFilter !== "none") ctx.filter = imgFilter;
    ctx.globalAlpha = bgOp; ctx.drawImage(bgImg, 0, 0); ctx.globalAlpha = 1;
    if (imgFilter && imgFilter !== "none") ctx.filter = "none";
  } else {
    ctx.strokeStyle = "rgba(30,50,110,.2)"; ctx.lineWidth = 1 / scale;
    for (let gx = 0; gx < W; gx += 50) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy < H; gy += 50) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
  }
  (valleys || []).forEach(function (v: any, vi: number) {
    ctx.beginPath(); ctx.moveTo(v.a.x, v.a.y); ctx.lineTo(v.b.x, v.b.y);
    ctx.strokeStyle = VCOLOR[v.type] || "#4ad6ff"; ctx.lineWidth = (vi === selV ? 3.5 : 2.5) / scale;
    if (!v.locked) ctx.setLineDash([5 / scale, 4 / scale]); ctx.stroke(); ctx.setLineDash([]);
  });
  for (let si2 = 0; si2 < secs.length; si2++) {
    const s = secs[si2];
    if (s.pts.length < 2) continue;
    // Per-section visibility toggle (bouton Eye dans le pill SECTIONS du
    // tracer) — on skip complètement le rendu. La section reste dans le
    // model + reste cliquable via son bouton dans le pill, mais elle
    // disparaît visuellement du canvas.
    if (s.hidden) continue;
    const isA = si2 === ai, c2 = SC[si2 % SC.length], alpha = isA ? 1 : 0.4;
    if (s.closed && s._skel) {
      // Toit plat : on court-circuite le skeleton. UNE seule face = le polygone
      // périmétral, AUCUNE arête interne (ni ridge ni hip — non-sens sur du plat).
      // fp2/fs2 restent définis (null/empty) pour ne pas casser le bloc de
      // pitch labels plus bas.
      const isFlat = s.roof_type === "flat";
      const sk2 = isFlat ? null : apOv(s._skel, s._no || {});
      const fp2 = (!isFlat && s.hf > 0) ? getFacePitches(s._skel, s._skel.poly, s._no || {}, s.hf) : null;
      const fs2 = sk2 ? facesFn(sk2.poly, sk2) : [];
      if (isFlat) {
        const pc = PAL[si2 % PAL.length][0];
        const rr = parseInt(pc.slice(1, 3), 16), gg = parseInt(pc.slice(3, 5), 16), bb2 = parseInt(pc.slice(5, 7), 16);
        ctx.beginPath();
        for (let pi = 0; pi < s.pts.length; pi++) { if (pi === 0) ctx.moveTo(s.pts[pi].x, s.pts[pi].y); else ctx.lineTo(s.pts[pi].x, s.pts[pi].y); }
        ctx.closePath(); ctx.fillStyle = "rgba(" + rr + "," + gg + "," + bb2 + "," + (solid ? (isA ? 0.55 : 0.28) : (isA ? 0.15 : 0.06)) + ")"; ctx.fill();
        ctx.globalAlpha = alpha;
      } else {
        for (let fi = 0; fi < fs2.length; fi++) {
          const face = fs2[fi];
          const pc = PAL[si2 % PAL.length][face.f % PAL[0].length];
          const rr = parseInt(pc.slice(1, 3), 16), gg = parseInt(pc.slice(3, 5), 16), bb2 = parseInt(pc.slice(5, 7), 16);
          ctx.beginPath();
          for (let pi = 0; pi < face.pts.length; pi++) { if (pi === 0) ctx.moveTo(face.pts[pi].x, face.pts[pi].y); else ctx.lineTo(face.pts[pi].x, face.pts[pi].y); }
          ctx.closePath(); ctx.fillStyle = "rgba(" + rr + "," + gg + "," + bb2 + "," + (solid ? (isA ? 0.55 : 0.28) : (isA ? 0.15 : 0.06)) + ")"; ctx.fill();
        }
        ctx.globalAlpha = alpha;
        for (let ei2 = 0; ei2 < sk2!.edges.length; ei2++) {
          const e = sk2!.edges[ei2];
          ctx.beginPath(); ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by);
          ctx.strokeStyle = e.isRidge ? "#ff4444" : "#44ddaa"; ctx.lineWidth = (e.isRidge ? 3 : 2) / scale; ctx.stroke();
        }
      }
      if (isA) {
        const nodes = skelNodes(s._skel, s._no || {});
        for (let ni2 = 0; ni2 < nodes.length; ni2++) {
          const nd = nodes[ni2];
          const isSN = selNode && selNode.si === si2 && selNode.key === nd.key;
          ctx.beginPath(); ctx.arc(nd.x, nd.y, (isSN ? 10 : 7) / scale, 0, Math.PI * 2);
          ctx.fillStyle = isSN ? "#ffffff" : "#ffcc44"; ctx.strokeStyle = isSN ? "#ffcc44" : "rgba(0,0,0,0.5)";
          ctx.lineWidth = (isSN ? 2.5 : 1.5) / scale; ctx.fill(); ctx.stroke();
        }
      }
      if (isA && s.hf > 0 && fp2) {
        for (let fi2 = 0; fi2 < fs2.length; fi2++) {
          const face2 = fs2[fi2]; const p12 = fp2[face2.f]; if (p12 == null) continue;
          const cx2 = face2.pts.reduce(function (ss: number, pp: any) { return ss + pp.x; }, 0) / face2.pts.length;
          const cy2 = face2.pts.reduce(function (ss: number, pp: any) { return ss + pp.y; }, 0) / face2.pts.length;
          ctx.font = "bold " + (11 / scale) + "px monospace";
          ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 3 / scale;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.strokeText(p12 + "/12", cx2, cy2); ctx.fillText(p12 + "/12", cx2, cy2);
          ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    for (let pi2 = 0; pi2 < s.pts.length; pi2++) { if (pi2 === 0) ctx.moveTo(s.pts[pi2].x, s.pts[pi2].y); else ctx.lineTo(s.pts[pi2].x, s.pts[pi2].y); }
    if (s.closed) ctx.closePath();
    ctx.globalAlpha = alpha; ctx.strokeStyle = c2; ctx.lineWidth = 2.5 / scale; ctx.setLineDash([]); ctx.stroke(); ctx.globalAlpha = 1;
    // Building 2D : footprint des murs offsetté vers l'intérieur, tracé en
    // pointillé bleu-gris. Aucune surface remplie, juste le contour — l'utilisateur
    // doit voir tout de suite la différence entre toit (plein) et bâtiment (pointillé).
    if (s.building && s.building.pts && s.building.pts.length >= 3) {
      ctx.save();
      ctx.beginPath();
      for (let bi = 0; bi < s.building.pts.length; bi++) {
        const bp = s.building.pts[bi];
        if (bi === 0) ctx.moveTo(bp.x, bp.y); else ctx.lineTo(bp.x, bp.y);
      }
      ctx.closePath();
      ctx.strokeStyle = isA ? "#8aa6d8" : "#5a6890";
      ctx.lineWidth = 1.8 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    // 90°-locked edges (perpendicular snap while dragging a corner) → red
    if (perp && perp.si === si2 && s.pts.length >= 2) {
      perp.segs.forEach(function (ei: number) {
        const a = s.pts[ei], b = s.pts[(ei + 1) % s.pts.length]; if (!a || !b) return;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = "#ff3344"; ctx.lineWidth = 3.5 / scale; ctx.stroke();
      });
    }
    if (!isA && s.pts.length > 0) {
      const scx = s.pts.reduce(function (ss: number, p: any) { return ss + p.x; }, 0) / s.pts.length;
      const scy = s.pts.reduce(function (ss: number, p: any) { return ss + p.y; }, 0) / s.pts.length;
      ctx.globalAlpha = 0.55; ctx.font = "bold " + (11 / scale) + "px monospace"; ctx.fillStyle = c2;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("S" + (si2 + 1), scx, scy);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 1;
    }
  }
  if (prev && !sec.closed && sec.pts.length > 0) {
    ctx.beginPath(); ctx.moveTo(sec.pts[sec.pts.length - 1].x, sec.pts[sec.pts.length - 1].y); ctx.lineTo(prev.px, prev.py);
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.5 / scale; ctx.setLineDash([5 / scale, 4 / scale]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
  for (let vi = 0; vi < sec.pts.length; vi++) {
    const pp2 = sec.pts[vi], scr = w2s(pp2.x, pp2.y, xf), isSel = vi === sel, isF = vi === 0 && !sec.closed;
    ctx.beginPath(); ctx.arc(scr.sx, scr.sy, 12, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? "#ff4444" : isF ? "#44ff88" : col; ctx.strokeStyle = isSel ? "#ff6666" : isF ? "#22dd66" : "rgba(255,255,255,.4)";
    ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    ctx.font = "bold 9px monospace"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(vi), scr.sx, scr.sy);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
  // Ghost midpoints : pour la section active fermée, on affiche un petit rond
  // creux semi-transparent entre chaque pair de corners. Tap dessus = insertion
  // d'un nouveau vertex à cet endroit (géré côté hit detection dans cbD).
  // Permet de suivre précisément un contour de bâtiment irrégulier sans
  // devoir redessiner toute la section.
  if (sec.closed && sec.pts.length >= 2) {
    for (let vi = 0; vi < sec.pts.length; vi++) {
      const a = sec.pts[vi], b = sec.pts[(vi + 1) % sec.pts.length];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const scr = w2s(mx, my, xf);
      ctx.beginPath(); ctx.arc(scr.sx, scr.sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    }
  }
  if (selV >= 0 && valleys && valleys[selV]) {
    const v = valleys[selV];
    [v.a, v.b].forEach(function (pt: any) {
      const scr = w2s(pt.x, pt.y, xf);
      ctx.beginPath(); ctx.arc(scr.sx, scr.sy, 11, 0, Math.PI * 2);
      ctx.fillStyle = VCOLOR[v.type] || "#4ad6ff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    });
  }
  if (prev) {
    const psx = prev.sx, psy = prev.sy, prX = prev.rawX, prY = prev.rawY;
    if (prev.isT) { ctx.beginPath(); ctx.moveTo(prX, prY); ctx.lineTo(psx, psy); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(prX, prY, 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,.15)"; ctx.fill(); }
    const R = 14, cc = prev.snapped ? "#44ff88" : "#fff"; ctx.strokeStyle = cc; ctx.lineWidth = prev.snapped ? 2.5 : 2;
    ctx.beginPath(); ctx.arc(psx, psy, R, 0, Math.PI * 2); ctx.stroke();
    [[psx - R - 4, psy, psx - R + 9, psy], [psx + R - 9, psy, psx + R + 4, psy], [psx, psy - R - 4, psx, psy - R + 9], [psx, psy + R - 9, psx, psy + R + 4]].forEach(function (seg) { ctx.beginPath(); ctx.moveTo(seg[0], seg[1]); ctx.lineTo(seg[2], seg[3]); ctx.stroke(); });
    ctx.beginPath(); ctx.arc(psx, psy, 2, 0, Math.PI * 2); ctx.fillStyle = cc; ctx.fill();
    if (prev.snapped) { ctx.font = "bold 10px monospace"; ctx.fillStyle = "#44ff88"; ctx.textAlign = "center"; ctx.fillText(prev.snapAngle ? "90°" : prev.snapAlign ? "aligné" : prev.snapEdge ? "ligne" : "snap", psx, psy - R - 8); ctx.textAlign = "left"; }
    if (!sec.closed && sec.pts.length >= 3) {
      const v0s = w2s(sec.pts[0].x, sec.pts[0].y, xf);
      if (Math.hypot(psx - v0s.sx, psy - v0s.sy) < 32) { ctx.beginPath(); ctx.arc(v0s.sx, v0s.sy, R + 5, 0, Math.PI * 2); ctx.strokeStyle = "#44ff88"; ctx.lineWidth = 2.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.font = "10px monospace"; ctx.fillStyle = "#44ff88"; ctx.textAlign = "center"; ctx.fillText("fermer", v0s.sx, v0s.sy - R - 14); ctx.textAlign = "left"; }
    }
  }
  if (scale > 1.05) { ctx.font = "11px monospace"; ctx.fillStyle = "rgba(100,150,255,.7)"; ctx.fillText(scale.toFixed(1) + "x", W - 42, H - 10); }
}

// -- PRESETS -------------------------------------------
export function mkPts(W: number, H: number, rel: any) { return rel.map(function (p: any) { return { x: p[0] * W, y: p[1] * H }; }); }
export function mkS(W: number, H: number, rel: any, pitch?: number, elev?: number) { return { pts: mkPts(W, H, rel), closed: true, _skel: null as any, pitch: pitch || 7, elev: elev || 0, _no: {} as any, hf: 0, hidden: false }; }
export function withS(ss: any) { return ss.map(function (s: any) { return Object.assign({}, s, { _skel: s.closed && s.pts.length >= 3 ? skelFn(s.pts) : null }); }); }
// Turn every triangular hip end of a section into a vertical gable (pignon)
// WITHOUT distorting pitch. A hip end is a face with a single apex node above
// the eave; we move that apex to the foot of its perpendicular on its OWN eave
// edge. Because the move is along that edge's normal (and the apex sits on the
// face's centreline), the perpendicular run to the two adjacent eaves — hence
// their slope — is unchanged, while this face collapses to a vertical wall.
// Returns a node-override (_no) map keyed exactly like apOv expects.
export function gableEndsOverrides(pts: any) {
  const sk = skelFn(pts), poly = sk.poly, no: any = {};
  facesFn(poly, sk).forEach(function (f: any) {
    const apex = f.pts.filter(function (p: any) { return (p.t || 0) > 0.01; });
    if (apex.length !== 1) return;   // only single-apex (triangular) hip ends become gables
    const nd = apex[0], a = poly[f.f], b = poly[(f.f + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy; if (L2 < 1e-9) return;
    let t = ((nd.x - a.x) * dx + (nd.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t));
    no[nk(nd.x, nd.y)] = { x: a.x + t * dx, y: a.y + t * dy, gable: true };
  });
  return no;
}
export function mkGable(W: number, H: number, rel: any, pitch?: number, elev?: number) {
  const pts = mkPts(W, H, rel);
  return { pts: pts, closed: true, _skel: null as any, pitch: pitch || 7, elev: elev || 0, _no: gableEndsOverrides(pts), hf: 0, hidden: false };
}
export const PRESETS: any = {
  "2 Pans": function (W: number, H: number) { return [mkGable(W, H, [[.14, .32], [.86, .32], [.86, .68], [.14, .68]])]; }
};
export function newSec(pitch?: number, elev?: number) { return { pts: [] as any[], closed: false, _skel: null as any, pitch: pitch || 7, elev: elev || 0, _no: {} as any, hf: 0, hidden: false }; }

