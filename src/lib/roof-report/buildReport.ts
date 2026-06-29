/**
 * buildReport.ts — port TS de build_report.py.
 *
 * Consomme la géométrie reportable (buildReportable) et produit un document
 * HTML imprimable complet : couverture (KPIs + iso 3D), vues en plan
 * (longueurs / pentes / surfaces / notes), 4 élévations, et tableaux
 * (facettes, murs par orientation, gaspillage/paquets).
 *
 * Aucune dépendance DOM : pures chaînes → testable + utilisable côté client ou
 * dans une edge function. Le seul « moteur » est buildReportable.
 */
import { buildReportable, type ReportData, type ReportGeom, type RPlane, type REdge, type EdgeType } from './reportableGeometry';

const CM_PER_FT = 30.48;
const SQCM_PER_SQFT = CM_PER_FT * CM_PER_FT;
const cm2ft = (cm: number) => cm / CM_PER_FT;
const sqcm2sqft = (a: number) => a / SQCM_PER_SQFT;
const fmtSqft = (a: number) => Math.round(sqcm2sqft(a)).toLocaleString('fr-CA').replace(/ /g, ' ').replace(/,/g, ' ');
const fmtDec = (a: number, d = 1) => a.toFixed(d).replace('.', ',');

const COL: Record<string, string> = {
  ridge: '#d62728', hip: '#9467bd', valley: '#1f77b4', rake: '#2ca02c', eave: '#222222',
  step_flashing: '#ff7f0e', parapet: '#7f7f7f', fill: '#e8edf4', fillalt: '#dde4ee', outline: '#7a8aa0', text: '#1e1e32',
};
const DIR_COL: Record<string, string> = { N: '#5b85b6', E: '#7ba37b', S: '#c9a961', O: '#b67676', vertical: '#a8a8b8' };
const DIR_ORDER: Array<'N' | 'E' | 'S' | 'O'> = ['N', 'E', 'S', 'O'];
const DIR_FR: Record<string, string> = { N: 'Nord', E: 'Est', S: 'Sud', O: 'Ouest' };
const TYPE_COL: Record<string, string> = { ridge: COL.ridge, hip: COL.hip, valley: COL.valley, rake: COL.rake, eave: COL.eave, step_flashing: COL.step_flashing, parapet: COL.parapet };
const TYPE_WIDTH: Record<string, number> = { ridge: 3.5, hip: 2.5, valley: 2.5, rake: 3, eave: 3, step_flashing: 2, parapet: 2 };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface Pt { x: number; y: number; t?: number }

export interface ReportMeta {
  client?: string; address?: string; devisNo?: string; date?: string; pitch?: string;
}

/* ── Helpers SVG ───────────────────────────────────────────────────────── */
function svgHead(vb: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block">`;
}
function rose(x: number, y: number, s = 30) {
  return `<g transform="translate(${x},${y})" font-family="Helvetica" font-size="11" fill="${COL.text}">
    <line x1="0" y1="${-s}" x2="0" y2="${s}" stroke="${COL.outline}" stroke-width="1"/>
    <line x1="${-s}" y1="0" x2="${s}" y2="0" stroke="${COL.outline}" stroke-width="1"/>
    <polygon points="0,${-s - 4} -4,${-s + 6} 4,${-s + 6}" fill="${COL.text}"/>
    <text x="0" y="${-s - 8}" text-anchor="middle" font-weight="700">N</text>
    <text x="0" y="${s + 14}" text-anchor="middle">S</text>
    <text x="${s + 8}" y="4">E</text><text x="${-s - 8}" y="4" text-anchor="end">O</text></g>`;
}
function path2d(pts: Pt[]) {
  if (!pts.length) return '';
  return 'M ' + pts.map((p, i) => `${i ? 'L' : ''} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
}
const centroid = (pts: Pt[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

/* ── Contexte de rendu (bornes, labels) ────────────────────────────────── */
interface Ctx {
  geom: ReportGeom; planes: RPlane[]; labels: Record<string, string>;
  vboxPlan: string; roseX: number; roseY: number; XMAX: number; YMAX: number;
}
function makeCtx(geom: ReportGeom): Ctx {
  const planes = geom.planes;
  const xs = planes.flatMap((p) => p.footprint.map((q) => q.x));
  const ys = planes.flatMap((p) => p.footprint.map((q) => q.y));
  const XMIN = Math.min(...xs), XMAX = Math.max(...xs), YMIN = Math.min(...ys), YMAX = Math.max(...ys);
  const PAD = 40;
  const sorted = [...planes].sort((a, b) => a.area3d - b.area3d);
  const labels: Record<string, string> = {};
  sorted.forEach((p, i) => { labels[p.id] = i < 26 ? LETTERS[i] : `A${LETTERS[i - 26]}`; });
  return {
    geom, planes, labels, XMAX, YMAX,
    vboxPlan: `${(XMIN - PAD).toFixed(1)} ${(YMIN - PAD).toFixed(1)} ${(XMAX - XMIN + 2 * PAD).toFixed(1)} ${(YMAX - YMIN + 2 * PAD).toFixed(1)}`,
    roseX: XMAX + 25, roseY: YMAX - 20,
  };
}

/* ── Iso 3D (painter's algorithm, opaque) ──────────────────────────────── */
const iso = (x: number, y: number, z: number): [number, number] => [x + y * 0.45, y * 0.55 - z * 0.85];
function svgIso3d(ctx: Ctx, withLabels = true) {
  const { planes, labels } = ctx;
  if (!planes.length) return svgHead('0 0 100 100') + '</svg>';
  const proj = planes.flatMap((p) => p.footprint.map((q) => iso(q.x, q.y, q.t || 0)));
  const pxs = proj.map((p) => p[0]), pys = proj.map((p) => p[1]); const pad = 40;
  const vb = `${(Math.min(...pxs) - pad).toFixed(0)} ${(Math.min(...pys) - pad).toFixed(0)} ${(Math.max(...pxs) - Math.min(...pxs) + 2 * pad).toFixed(0)} ${(Math.max(...pys) - Math.min(...pys) + 2 * pad).toFixed(0)}`;
  const out = [svgHead(vb)];
  const depth = (p: RPlane) => { const fp = p.footprint; return fp.reduce((s, q) => s + q.y, 0) / fp.length + (fp.reduce((s, q) => s + (q.t || 0), 0) / fp.length) * 0.4; };
  for (const plane of [...planes].sort((a, b) => depth(a) - depth(b))) {
    const pts = plane.footprint.map((q) => iso(q.x, q.y, q.t || 0));
    const d = 'M ' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') + ' Z';
    out.push(`<path d="${d}" fill="${DIR_COL[plane.dir] || '#bbb'}" fill-opacity="1" stroke="${COL.text}" stroke-width="0.8" stroke-linejoin="round"/>`);
    if (withLabels) {
      const lbl = labels[plane.id];
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="rgba(30,30,50,0.92)"/><text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica" font-size="11" font-weight="700" fill="white">${lbl}</text>`);
    }
  }
  out.push('</svg>'); return out.join('\n');
}

/* ── Vues en plan ──────────────────────────────────────────────────────── */
function svgLength(ctx: Ctx) {
  const { geom } = ctx; const out = [svgHead(ctx.vboxPlan)];
  for (const p of ctx.planes) if (p.kind === 'toiture') out.push(`<path d="${path2d(p.footprint)}" fill="${COL.fill}" stroke="none"/>`);
  for (const e of geom.edges) {
    const c = TYPE_COL[e.type] || '#888', w = TYPE_WIDTH[e.type] || 2;
    out.push(`<line x1="${e.a.x.toFixed(1)}" y1="${e.a.y.toFixed(1)}" x2="${e.b.x.toFixed(1)}" y2="${e.b.y.toFixed(1)}" stroke="${c}" stroke-width="${w}" stroke-linecap="square"/>`);
  }
  for (const e of geom.edges) {
    const L2 = Math.hypot(e.a.x - e.b.x, e.a.y - e.b.y), L3 = Math.sqrt(L2 * L2 + (e.ta - e.tb) ** 2), ft = cm2ft(L3);
    if (ft < 5) continue;
    const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2, dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, n = Math.hypot(dx, dy) || 1;
    const px = -dy / n * 16, py = dx / n * 16, c = TYPE_COL[e.type] || '#888';
    out.push(`<text x="${(mx + px).toFixed(1)}" y="${(my + py).toFixed(1)}" fill="${c}" font-family="Helvetica" font-size="13" font-weight="700" text-anchor="middle" dominant-baseline="middle">${ft.toFixed(0)}</text>`);
  }
  out.push(rose(ctx.roseX, ctx.roseY), '</svg>'); return out.join('\n');
}
function svgPitch(ctx: Ctx) {
  const out = [svgHead(ctx.vboxPlan)];
  for (const p of ctx.planes) {
    if (p.kind !== 'toiture') continue;
    out.push(`<path d="${path2d(p.footprint)}" fill="${DIR_COL[p.dir] || '#ccc'}" fill-opacity="0.55" stroke="${COL.outline}" stroke-width="0.8"/>`);
    const c = centroid(p.footprint);
    out.push(`<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica" font-size="13" font-weight="700" fill="${COL.text}">${p.pitch || 7}/12</text>`);
  }
  for (const p of ctx.planes) if (p.kind === 'pignon') out.push(`<path d="${path2d(p.footprint)}" fill="${DIR_COL.vertical}" fill-opacity="0.45" stroke="${COL.outline}" stroke-width="0.8" stroke-dasharray="3 2"/>`);
  out.push(rose(ctx.roseX, ctx.roseY), '</svg>'); return out.join('\n');
}
function svgArea(ctx: Ctx) {
  const out = [svgHead(ctx.vboxPlan)];
  ctx.planes.forEach((p, i) => out.push(`<path d="${path2d(p.footprint)}" fill="${i % 2 ? COL.fillalt : COL.fill}" stroke="${COL.outline}" stroke-width="0.8"/>`));
  for (const p of ctx.planes) { const c = centroid(p.footprint); out.push(`<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica" font-size="14" font-weight="700" fill="${COL.text}">${sqcm2sqft(p.area3d).toFixed(0)}</text>`); }
  out.push(rose(ctx.roseX, ctx.roseY), '</svg>'); return out.join('\n');
}
function svgNotes(ctx: Ctx) {
  const out = [svgHead(ctx.vboxPlan)];
  ctx.planes.forEach((p, i) => out.push(`<path d="${path2d(p.footprint)}" fill="${i % 2 ? COL.fillalt : COL.fill}" stroke="${COL.outline}" stroke-width="0.8"/>`));
  for (const p of ctx.planes) { const c = centroid(p.footprint); out.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="14" fill="${COL.text}"/><text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica" font-size="14" font-weight="700" fill="white">${ctx.labels[p.id]}</text>`); }
  out.push(rose(ctx.roseX, ctx.roseY), '</svg>'); return out.join('\n');
}

/* ── Élévations ────────────────────────────────────────────────────────── */
function svgElev(ctx: Ctx, dir: 'N' | 'E' | 'S' | 'O') {
  const relevant = ctx.planes.filter((p) => p.dir === dir);
  if (!relevant.length) return svgHead('0 0 100 100') + '</svg>';
  const proj = (x: number, y: number, z: number): [number, number] => {
    let h: number;
    if (dir === 'N') h = x; else if (dir === 'S') h = ctx.XMAX - x; else if (dir === 'E') h = y; else h = ctx.YMAX - y;
    return [h, -z];
  };
  const polys = relevant.map((p) => ({ p, pts: p.footprint.map((q) => proj(q.x, q.y, q.t || 0)) }));
  const all = polys.flatMap((pp) => pp.pts), pxs = all.map((p) => p[0]), pys = all.map((p) => p[1]); const pad = 40;
  const vb = `${(Math.min(...pxs) - pad).toFixed(0)} ${(Math.min(...pys) - pad).toFixed(0)} ${(Math.max(...pxs) - Math.min(...pxs) + 2 * pad).toFixed(0)} ${(Math.max(...pys) - Math.min(...pys) + 2 * pad).toFixed(0)}`;
  const out = [svgHead(vb)];
  out.push(`<line x1="${(Math.min(...pxs) - 30).toFixed(0)}" y1="0" x2="${(Math.max(...pxs) + 30).toFixed(0)}" y2="0" stroke="${COL.outline}" stroke-width="1" stroke-dasharray="4 3"/>`);
  for (const { p, pts } of polys) {
    const d = 'M ' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') + ' Z';
    const fill = p.kind === 'toiture' ? (DIR_COL[p.dir] || '#bbb') : '#e8d9a8', opa = p.kind === 'toiture' ? 0.65 : 0.85;
    out.push(`<path d="${d}" fill="${fill}" fill-opacity="${opa}" stroke="${COL.text}" stroke-width="0.8" stroke-linejoin="round"/>`);
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    out.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica" font-size="12" font-weight="700" fill="${COL.text}">${ctx.labels[p.id]}</text>`);
  }
  out.push('</svg>'); return out.join('\n');
}

/* ── Tableaux ──────────────────────────────────────────────────────────── */
function facetTable(ctx: Ctx) {
  const sorted = [...ctx.planes].sort((a, b) => a.area3d - b.area3d);
  const rows = sorted.map((p) => {
    const pl = p.kind === 'toiture' ? `${p.pitch || 7}/12` : 'vertical';
    const dr = DIR_FR[p.dir] || (p.dir.charAt(0).toUpperCase() + p.dir.slice(1));
    return `<tr><td>${ctx.labels[p.id]}</td><td>${fmtDec(sqcm2sqft(p.area3d))}</td><td>${pl}</td><td>${dr}</td></tr>`;
  });
  rows.push(`<tr class="total"><td>Total — ${ctx.geom.metrics.n_planes} facettes</td><td>${fmtSqft(ctx.geom.metrics.total_area_cm2)}</td><td>—</td><td>—</td></tr>`);
  return rows.join('\n');
}
function wallCol(ctx: Ctx, d: 'N' | 'E' | 'S' | 'O') {
  const items = ctx.planes.filter((p) => p.dir === d).map((p) => ({ lbl: ctx.labels[p.id], a: sqcm2sqft(p.area3d), tag: p.kind === 'toiture' ? ' (T)' : ' (P)' })).sort((x, y) => x.lbl.localeCompare(y.lbl));
  const total = items.reduce((s, it) => s + it.a, 0);
  const lis = items.map((it) => `<li><span>${it.lbl}${it.tag}</span><span>${fmtDec(it.a)}&nbsp;pi²</span></li>`).join('') || '<li><span>—</span><span>—</span></li>';
  return `<div class="col"><header>${DIR_FR[d]}</header><ul>${lis}</ul><div class="tot">${fmtDec(total)} pi²</div></div>`;
}
function elevTable(ctx: Ctx, d: 'N' | 'E' | 'S' | 'O') {
  const list = ctx.planes.filter((p) => p.dir === d);
  let total = 0;
  const rows = list.map((p) => {
    const a = sqcm2sqft(p.area3d), ts = p.footprint.map((q) => q.t || 0);
    const hFt = ts.length ? cm2ft(Math.max(...ts) - Math.min(...ts)) : 0;
    const ws = d === 'N' || d === 'S' ? p.footprint.map((q) => q.x) : p.footprint.map((q) => q.y);
    const wFt = ws.length ? cm2ft(Math.max(...ws) - Math.min(...ws)) : 0;
    total += a;
    return `<tr><td>${ctx.labels[p.id]}</td><td>${fmtDec(a)}</td><td>${hFt.toFixed(0)}&nbsp;pi</td><td>${wFt.toFixed(0)}&nbsp;pi</td><td>${p.kind === 'toiture' ? '—' : 'Pignon'}</td></tr>`;
  });
  rows.push(`<tr class="total"><td>Total</td><td>${fmtDec(total)}</td><td>—</td><td>—</td><td>—</td></tr>`);
  return { html: rows.join('\n'), total, n: list.length };
}
function wasteRows(roofCm2: number) {
  const W = [0, 10, 12, 15, 17, 20, 22];
  const surf = `<tr><td>Surface (pi²)</td>` + W.map((w) => `<td${w === 15 ? ' class="rec-cell"' : ''}>${fmtSqft(roofCm2 * (1 + w / 100))}</td>`).join('') + '</tr>';
  const paq = `<tr><td>Paquets (40&nbsp;pi²)</td>` + W.map((w) => { const p = sqcm2sqft(roofCm2 * (1 + w / 100)) / 40; return `<td${w === 15 ? ' class="rec-cell"' : ''}>${fmtDec(p)}${w === 15 ? '&nbsp;★' : ''}</td>`; }).join('') + '</tr>';
  return surf + '\n' + paq;
}

/* ── Assemblage du document ────────────────────────────────────────────── */
export function buildReportHtml(data: ReportData, meta: ReportMeta = {}): string {
  const geom = buildReportable(data);
  const ctx = makeCtx(geom);
  const m = geom.metrics;
  const Lft = (t: EdgeType) => cm2ft(m.length_by_type[t] || 0);
  const countByType: Partial<Record<EdgeType, number>> = {};
  for (const e of geom.edges) countByType[e.type] = (countByType[e.type] || 0) + 1;
  countByType.valley = geom.valleys.length || countByType.valley || 0;
  const drip = Lft('eave') + Lft('rake');

  const eN = elevTable(ctx, 'N'), eS = elevTable(ctx, 'S'), eE = elevTable(ctx, 'E'), eO = elevTable(ctx, 'O');
  const legend = ([['ridge', 'Faîtière'], ['hip', 'Arêtier'], ['valley', 'Noue'], ['rake', 'Rampante'], ['eave', 'Avant-toit'], ['step_flashing', 'Solin escalier']] as Array<[EdgeType, string]>)
    .filter(([k]) => Lft(k) >= 0.5 || (countByType[k] || 0) > 0)
    .map(([k, lbl]) => `<div class="li"><span class="sw" style="background:${TYPE_COL[k]}"></span><b>${lbl}</b> = ${Lft(k).toFixed(0)} pi (${countByType[k] || 0})</div>`).join('\n');

  const card = (lbl: string, val: string) => `<div class="kpi"><div class="k-lbl">${lbl}</div><div class="k-val">${val}</div></div>`;
  const diagram = (title: string, sub: string, svg: string) => `<section class="page"><h2>${title}</h2><p class="sub">${sub}</p><div class="canvas">${svg}</div></section>`;
  const esc = (s?: string) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport de toiture</title>
<style>
  :root{ --brand:#1d4ed8; --gold:#c9a961; --hl:#fff7e0; }
  *{ box-sizing:border-box; } body{ font-family:Helvetica,Arial,sans-serif; color:#1e1e32; margin:0; background:#fff; font-size:11pt; }
  .page{ padding:14mm; page-break-after:always; }
  h1{ font-size:22pt; margin:0 0 2mm; } h2{ font-size:15pt; color:var(--brand); margin:0 0 1mm; } .sub{ color:#555; margin:0 0 4mm; font-size:9.5pt; }
  .kpis{ display:flex; gap:6mm; margin:6mm 0; } .kpi{ flex:1; border:.3mm solid var(--gold); border-radius:2mm; padding:4mm; text-align:center; }
  .k-lbl{ font-size:8.5pt; color:#666; text-transform:uppercase; letter-spacing:.5px; } .k-val{ font-size:18pt; font-weight:800; color:var(--brand); } .k-val small{ font-size:9pt; color:#888; }
  .canvas{ width:100%; height:150mm; border:.3mm solid #e3e7ef; border-radius:2mm; padding:4mm; } .canvas svg{ width:100%; height:100%; }
  table.t{ width:100%; border-collapse:collapse; font-size:9.5pt; margin:3mm 0; } table.t th,table.t td{ border:.2mm solid #d7dce6; padding:1.6mm 2.4mm; text-align:left; }
  table.t th{ background:#eef2fb; } tr.total td{ font-weight:800; background:#f6f8fd; } td.rec-cell{ background:var(--hl)!important; font-weight:700; color:var(--brand); }
  .legend{ display:flex; flex-wrap:wrap; gap:3mm 7mm; margin:3mm 0; } .legend .li{ font-size:9.5pt; } .legend .sw{ display:inline-block; width:4mm; height:2mm; border-radius:.5mm; vertical-align:middle; margin-right:1.5mm; }
  .wallcols{ display:flex; gap:4mm; } .wallcols .col{ flex:1; border:.3mm solid #e3e7ef; border-radius:2mm; padding:3mm; } .wallcols header{ font-weight:800; color:var(--brand); border-bottom:.3mm solid var(--gold); margin-bottom:2mm; }
  .wallcols ul{ list-style:none; margin:0; padding:0; font-size:9pt; } .wallcols li{ display:flex; justify-content:space-between; padding:.6mm 0; } .wallcols .tot{ margin-top:2mm; font-weight:800; text-align:right; }
  .summary .line{ display:flex; justify-content:space-between; padding:1mm 0; border-bottom:.2mm solid #eef0f5; font-size:10pt; } .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:8mm; }
  @page{ size:Letter; margin:0; } @media print{ .page{ page-break-after:always; } }
</style></head><body>

<section class="page">
  <h1>Rapport de toiture</h1>
  <p class="sub">${esc(meta.client) || ''}${meta.address ? ' — ' + esc(meta.address) : ''}${meta.devisNo ? ' · ' + esc(meta.devisNo) : ''}${meta.date ? ' · ' + esc(meta.date) : ''}</p>
  <div class="kpis">
    ${card('Surface totale toiture', `${fmtSqft(m.total_area_cm2)}<small>&nbsp;pi²</small>`)}
    ${card('Nb facettes', String(m.n_planes))}
    ${card('Pente prédominante', esc(meta.pitch) || '7/12')}
  </div>
  <div class="canvas">${svgIso3d(ctx, true)}</div>
</section>

${diagram('Vue en plan — longueurs', `Faîtière ${Lft('ridge').toFixed(0)} pi · Arêtier ${Lft('hip').toFixed(0)} pi · Noue ${Lft('valley').toFixed(0)} pi · Goutte d'eau ${drip.toFixed(0)} pi`, svgLength(ctx))}
<div class="page"><div class="legend">${legend}<div class="li" style="color:var(--brand);font-weight:700">Goutte d'eau (avant-toit + rampante) = ${drip.toFixed(0)} pi</div></div></div>

${diagram('Vue en plan — pentes', 'Pente par facette (X/12). Pignons en pointillé.', svgPitch(ctx))}
${diagram('Vue en plan — surfaces', `Surface 3D par facette (pi²). Total = ${fmtSqft(m.total_area_cm2)} pi².`, svgArea(ctx))}
${diagram('Vue en plan — repères', `${m.n_planes} facettes repérées (voir tableau).`, svgNotes(ctx))}

<section class="page">
  <h2>Facettes</h2>
  <table class="t"><thead><tr><th>Facette</th><th>Surface (pi²)</th><th>Pente</th><th>Orientation</th></tr></thead><tbody>${facetTable(ctx)}</tbody></table>
  <h2 style="margin-top:6mm">Surfaces par orientation</h2>
  <div class="wallcols">${DIR_ORDER.map((d) => wallCol(ctx, d)).join('')}</div>
</section>

${diagram('Élévation Nord', `Surface visible = ${fmtDec(eN.total)} pi² sur ${eN.n} facette(s).`, svgElev(ctx, 'N'))}
<div class="page"><table class="t"><thead><tr><th>Facette</th><th>Surface (pi²)</th><th>Hauteur</th><th>Largeur</th><th>Type</th></tr></thead><tbody>${eN.html}</tbody></table></div>
${diagram('Élévation Sud', `Surface visible = ${fmtDec(eS.total)} pi² sur ${eS.n} facette(s).`, svgElev(ctx, 'S'))}
<div class="page"><table class="t"><thead><tr><th>Facette</th><th>Surface (pi²)</th><th>Hauteur</th><th>Largeur</th><th>Type</th></tr></thead><tbody>${eS.html}</tbody></table></div>
${diagram('Élévation Est', `Surface visible = ${fmtDec(eE.total)} pi² sur ${eE.n} facette(s).`, svgElev(ctx, 'E'))}
<div class="page"><table class="t"><thead><tr><th>Facette</th><th>Surface (pi²)</th><th>Hauteur</th><th>Largeur</th><th>Type</th></tr></thead><tbody>${eE.html}</tbody></table></div>
${diagram('Élévation Ouest', `Surface visible = ${fmtDec(eO.total)} pi² sur ${eO.n} facette(s).`, svgElev(ctx, 'O'))}
<div class="page"><table class="t"><thead><tr><th>Facette</th><th>Surface (pi²)</th><th>Hauteur</th><th>Largeur</th><th>Type</th></tr></thead><tbody>${eO.html}</tbody></table></div>

<section class="page">
  <div class="grid2">
    <div class="summary">
      <h2>Longueurs, surfaces et pentes</h2>
      <div class="line"><span>Faîtière</span><b>${Lft('ridge').toFixed(0)} pi</b></div>
      <div class="line"><span>Arêtier</span><b>${Lft('hip').toFixed(0)} pi</b></div>
      <div class="line"><span>Noues</span><b>${Lft('valley').toFixed(0)} pi</b></div>
      <div class="line"><span>Rampantes</span><b>${Lft('rake').toFixed(0)} pi</b></div>
      <div class="line"><span>Avant-toits</span><b>${Lft('eave').toFixed(0)} pi</b></div>
      <div class="line"><span>Solins escalier</span><b>${Lft('step_flashing').toFixed(0)} pi</b></div>
      <div class="line"><span>Goutte d'eau</span><b>${drip.toFixed(0)} pi</b></div>
      <div class="line"><span>Pignons (surface)</span><b>${fmtSqft(m.total_wall_cm2)} pi²</b></div>
      <div class="line" style="border-top:.3mm solid var(--gold);margin-top:2mm;padding-top:2mm"><span>Surface toiture</span><b>${fmtSqft(m.total_roof_cm2)} pi²</b></div>
      <div class="line"><span>Surface totale</span><b>${fmtSqft(m.total_area_cm2)} pi²</b></div>
      <div class="line"><span>Facettes visibles</span><b>${m.n_planes}</b> (${m.n_toitures} toit + ${m.n_pignons} pignons)</div>
    </div>
    <div>
      <h2>Estimation des paquets (gaspillage)</h2>
      <table class="t waste"><thead><tr><th></th><th>0%</th><th>10%</th><th>12%</th><th>15%★</th><th>17%</th><th>20%</th><th>22%</th></tr></thead><tbody>${wasteRows(m.total_roof_cm2)}</tbody></table>
      <p class="sub">★ 15% = recommandé. Paquet = 40 pi².</p>
    </div>
  </div>
</section>

</body></html>`;
}
