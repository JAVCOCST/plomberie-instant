import jsPDF from 'jspdf';
import type { DynastyQuote } from './dynasty-calculator';
import vbLogoWhite from '@/assets/vb-logo-white.png';

const fmt = (n: number) =>
  n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

const fmtDec = (n: number) =>
  n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 });

export interface BuildingData {
  geojson: string | null;
  lotGeojson: string | null;
  superficie: number | null;    // m²
  perimetre: number | null;     // m
  largeur: number | null;       // m
  profondeur: number | null;    // m
  noLot: string | null;
  slopeCategory: string;
  roofType: string;
  confidence: number;
  productName: string;
  productBrand: string;
  colorName: string;
  coverageType: string;
  satImageDataUrl: string | null;   // base64 data URL of satellite image
}

export interface PdfContext {
  clientName: string;
  address: string;
  product: string;
  color: string;
  date?: string;
  quote: DynastyQuote;
  building?: BuildingData;
  pdfFilenameBase?: string;
  referenceId?: string;
  quoteNotes?: string;
  paymentTerms?: string;
  // Extra fields for matching the HTML template
  seqNumber?: number;
  gamme?: string;
  marque?: string;
  effectiveAreaSqft?: number;
  workType?: string;
}

/* ── Load logo as base64 (cached) ── */
let _logoBase64: string | null = null;
async function loadLogoBase64(): Promise<string | null> {
  if (_logoBase64) return _logoBase64;
  try {
    const resp = await fetch(vbLogoWhite);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        _logoBase64 = reader.result as string;
        resolve(_logoBase64);
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const PDF_DEFAULT_NOTES = `EXCLUSIONS :
- Installation de CP au toit
- Conteneur fournis par le clients

-
Travaux supplémentaires à Temps et Matériel :
- Charpentier-menuisier/Couvreur (Compagnon) : 90$/h
- Charpentier-menuisier/Couvreur (Apprentie) : 85$/h
- Gestion & administration : 10%`;

const PDF_DEFAULT_TERMS = `VOIR GARANTIE IKO EN PJ

- TOITURES VB s'engage à exécuter les travaux précités en conformité avec ses obligations légales et selon les recommandations du fournisseur (IKO)

- 50% du total du contrat payable 5 jours avant le début des travaux.
- 50% du total du contrat payable une fois les travaux complétés.

- Si le Client omet de verser, à échéance, quelque somme due en vertu du présent contrat, le solde impayé porte intérêt au taux annuel de douze pour cent (12%) l'an.`;

/** Render multi-line notes/terms text block in jsPDF, returns new Y */
function addTextBlock(doc: jsPDF, y: number, title: string, text: string, maxWidth: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(50, 50, 50);
  doc.text(title, 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  // Strip markdown bold markers
  const clean = text.replace(/\*\*/g, '');
  const lines = doc.splitTextToSize(clean, maxWidth);
  for (const line of lines) {
    if (y > pageH - 20) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, 14, y);
    y += 4;
  }
  return y + 4;
}


function addHeader(doc: jsPDF, title: string, ctx: PdfContext, logoBase64?: string | null) {
  const w = doc.internal.pageSize.getWidth();

  // Brand bar (logo only)
  doc.setFillColor(30, 30, 50);
  doc.rect(0, 0, w, 30, 'F');

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', 12, 5, 48, 20);
    } catch { /* silent */ }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleDateString('fr-CA'), w - 14, 20, { align: 'right' });

  // Title below header bar
  let y = 40;
  doc.setTextColor(30, 30, 50);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, y);

  // Reference ID (right-aligned)
  if (ctx.referenceId) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 120);
    doc.text(`Réf. ${ctx.referenceId}`, w - 14, y, { align: 'right' });
  }

  // Client info
  y += 10;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Client : ${ctx.clientName}`, 14, y);
  doc.text(`Adresse : ${ctx.address}`, 14, y + 6);
  doc.text(`Produit : ${ctx.product} — ${ctx.color}`, 14, y + 12);
  if (ctx.date) doc.text(`Date souhaitée : ${ctx.date}`, 14, y + 18);

  // Building info
  y += ctx.date ? 28 : 22;
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Superficie : ${ctx.quote.surface_displayed.toFixed(0)} pi2 (corrigee)  |  Perimetre : ${ctx.quote.perimeter_ft.toFixed(0)} pi  |  Pente : ${ctx.quote.slope_category} (x${ctx.quote.slope_factor})  |  Type : ${ctx.quote.roof_type}`, 14, y);

  return y + 10;
}

/* ── Table helper ── */
function drawTable(
  doc: jsPDF,
  startY: number,
  headers: string[],
  rows: string[][],
  colWidths: number[],
  opts?: { boldLastRows?: number }
) {
  const x0 = 14;
  const rowH = 7;
  let y = startY;
  const w = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(235, 235, 245);
  doc.rect(x0 - 2, y - 5, w - 24, rowH + 1, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(40, 40, 40);
  let cx = x0;
  headers.forEach((h, i) => {
    const align = i === 0 ? 'left' : 'right';
    const px = i === 0 ? cx : cx + colWidths[i];
    doc.text(h, px, y, { align } as any);
    cx += colWidths[i];
  });

  y += rowH;

  // Rows
  doc.setFont('helvetica', 'normal');
  const boldStart = opts?.boldLastRows ? rows.length - (opts.boldLastRows) : rows.length;
  rows.forEach((row, ri) => {
    if (ri >= boldStart) {
      doc.setFont('helvetica', 'bold');
      if (ri === rows.length - 1) {
        doc.setFillColor(240, 238, 255);
        doc.rect(x0 - 2, y - 5, w - 24, rowH + 1, 'F');
      }
    }
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(8);
    cx = x0;
    row.forEach((cell, i) => {
      const align = i === 0 ? 'left' : 'right';
      const px = i === 0 ? cx : cx + colWidths[i];
      doc.text(cell, px, y, { align } as any);
      cx += colWidths[i];
    });
    // Line
    doc.setDrawColor(220, 220, 220);
    doc.line(x0 - 2, y + 2, w - 12, y + 2);
    y += rowH;
  });

  return y;
}

/* ── Translate slope/roof type ── */
const SLOPE_FR: Record<string, string> = {
  aucune: '4/12 – (aucune)', legere: '4/12 – 7/12 (légère)', moderee: '8/12 – 12/12 (modérée)', abrupte: '12/12+ (élevée)',
};
const COVERAGE_PDF_FR: Record<string, string> = {
  shingle_2pans: 'Bardeaux – 2 versants', shingle_4pans: 'Bardeaux – 4 versants',
  shingle_4pans_plus: 'Bardeaux – 4 versants complexe',
  membrane_elastomere: 'Membrane élastomère', membrane_gravier: 'Membrane gravier',
  tole_2pans: 'Tôle – 2 versants', tole_4pans: 'Tôle – 4 versants',
  tole_4pans_plus: 'Tôle – 4 versants complexe',
  shingle: 'Bardeaux', sbs: 'Membrane / SBS',
};
const ROOF_FR: Record<string, string> = {
  '2pans': '2 versants', '4pans': '4 versants', '4pans_plus': '4 versants complexe',
};

/* ── Draw building polygon on PDF canvas ── */
function drawPolygonOnPdf(
  doc: jsPDF,
  geojsonStr: string,
  centerLat: number,
  centerLng: number,
  zoom: number,
  imgX: number,
  imgY: number,
  imgW: number,
  imgH: number,
  color: [number, number, number],
  fillOpacity: number,
) {
  try {
    const parsed = JSON.parse(geojsonStr);
    let rings: number[][][] = [];
    if (parsed.type === 'Polygon') rings = parsed.coordinates;
    else if (parsed.type === 'MultiPolygon') parsed.coordinates.forEach((p: number[][][]) => rings.push(...p));

    const tileSize = 256;
    const scale = 2;
    const totalPx = tileSize * Math.pow(2, zoom) * scale;
    const lngToX = (l: number) => ((l + 180) / 360) * totalPx;
    const latToY = (l: number) => {
      const s = Math.sin((l * Math.PI) / 180);
      return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * totalPx;
    };
    const cX = lngToX(centerLng);
    const cY = latToY(centerLat);
    const imgPx = 640; // static map img size

    rings.forEach(ring => {
      const pts = ring.map(([lng, lat]) => {
        const px = imgPx / 2 + (lngToX(lng) - cX) / scale;
        const py = imgPx / 2 + (latToY(lat) - cY) / scale;
        return { x: imgX + (px / imgPx) * imgW, y: imgY + (py / imgPx) * imgH };
      });
      if (pts.length < 3) return;

      // Draw filled polygon with transparency effect using lighter fill
      doc.setFillColor(color[0], color[1], color[2]);
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.setLineWidth(0.5);

      // Build path string for polygon - use lines for outline
      for (let i = 0; i < pts.length; i++) {
        const next = pts[(i + 1) % pts.length];
        doc.line(pts[i].x, pts[i].y, next.x, next.y);
      }
    });
  } catch {
    // silent
  }
}

/* ── Compute map params from geojson ── */
function computeMapParams(geojsonStr: string): { zoom: number; centerLat: number; centerLng: number } {
  try {
    const parsed = JSON.parse(geojsonStr);
    let coords: number[][] = [];
    if (parsed.type === 'Polygon') coords = parsed.coordinates[0];
    else if (parsed.type === 'MultiPolygon') parsed.coordinates.forEach((p: number[][][]) => coords.push(...p[0]));
    if (coords.length === 0) return { zoom: 19, centerLat: 0, centerLng: 0 };

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lng, lat] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const tileSize = 256;
    const availablePx = 640 * 2;
    const zoomLng = lngSpan > 0 ? Math.log2(availablePx * 360 / (lngSpan * tileSize * 2)) : 21;
    const latRad = centerLat * Math.PI / 180;
    const zoomLat = latSpan > 0 ? Math.log2(availablePx * 360 / (latSpan * tileSize * 2 * (1 / Math.cos(latRad)))) : 21;
    const zoom = Math.min(Math.floor(Math.min(zoomLng, zoomLat)), 20);
    return { zoom: Math.max(zoom - 1, 16), centerLat, centerLng };
  } catch {
    return { zoom: 19, centerLat: 0, centerLng: 0 };
  }
}

/* ── Aerial page helper ── */
function getImageFormat(dataUrl: string): 'JPEG' | 'PNG' {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

/** Rounded rect helper (jsPDF has roundedRect but this is more flexible) */
function pillRect(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, style: 'F' | 'S' | 'FD' = 'F') {
  doc.roundedRect(x, y, w, h, r, r, style);
}

/** Draw a polished badge on the PDF */
function drawBadge(
  doc: jsPDF,
  x: number, y: number,
  text: string,
  bg: [number, number, number], fg: [number, number, number],
  align: 'left' | 'right' = 'left',
  fontSize = 7,
) {
  doc.setFontSize(fontSize);
  doc.setFont('helvetica', 'bold');
  const textW = doc.getTextWidth(text);
  const padH = 5, padV = 3;
  const bw = textW + padH * 2;
  const bh = fontSize * 0.5 + padV * 2;
  const bx = align === 'right' ? x - bw : x;

  // Fill
  doc.setFillColor(bg[0], bg[1], bg[2]);
  pillRect(doc, bx, y, bw, bh, 2, 'F');

  // Text
  doc.setTextColor(fg[0], fg[1], fg[2]);
  doc.text(text, bx + padH, y + bh - padV + 0.3);

  return { w: bw, h: bh };
}

function addAerialPage(doc: jsPDF, ctx: PdfContext, logoBase64?: string | null) {
  const b = ctx.building;
  if (!b || !b.satImageDataUrl) return;

  doc.addPage();
  const pw = doc.internal.pageSize.getWidth();  // 210
  const ph = doc.internal.pageSize.getHeight(); // 297

  // ── Dark header bar ──
  const headerH = 26;
  doc.setFillColor(26, 26, 50);
  doc.rect(0, 0, pw, headerH, 'F');
  // Accent stripe
  doc.setFillColor(245, 158, 11);
  doc.rect(0, headerH, pw, 1.2, 'F');

  if (logoBase64) {
    try { doc.addImage(logoBase64, 'PNG', 10, 4, 42, 18); } catch { /* */ }
  }
  doc.setTextColor(180, 180, 200);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('APERÇU AÉRIEN DE LA COUVERTURE', pw - 14, 12, { align: 'right' });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(ctx.address.toUpperCase(), pw - 14, 19, { align: 'right' });

  // ── Satellite image ──
  const margin = 12;
  const imgTopY = headerH + 1.2 + 6;
  const imgMaxW = pw - margin * 2;
  // Leave ~95mm for the specs below
  const imgMaxH = ph - imgTopY - 108;
  const imgSize = Math.min(imgMaxW, imgMaxH);
  const imgX = (pw - imgSize) / 2;
  const imgY = imgTopY;

  // Image background (dark, in case image has transparent areas)
  doc.setFillColor(20, 20, 30);
  doc.rect(imgX - 1, imgY - 1, imgSize + 2, imgSize + 2, 'F');

  try {
    doc.addImage(b.satImageDataUrl, getImageFormat(b.satImageDataUrl), imgX, imgY, imgSize, imgSize);
  } catch {
    doc.setFillColor(60, 60, 80);
    doc.rect(imgX, imgY, imgSize, imgSize, 'F');
    doc.setTextColor(180, 180, 180);
    doc.setFontSize(10);
    doc.text('Image satellite non disponible', imgX + imgSize / 2, imgY + imgSize / 2, { align: 'center' });
  }

  // Thin frame
  doc.setDrawColor(26, 26, 50);
  doc.setLineWidth(0.6);
  doc.rect(imgX, imgY, imgSize, imgSize, 'S');

  // ── Badges on image ──
  const badgePad = 4;

  // Top-left: dimensions
  let topLeftY = imgY + badgePad;
  if (b.largeur && b.profondeur) {
    const dimTxt = `${(b.largeur * 3.28084).toFixed(0)}' x ${(b.profondeur * 3.28084).toFixed(0)}'`;
    const badge = drawBadge(doc, imgX + badgePad, topLeftY, dimTxt, [26, 26, 50], [255, 255, 255]);
    topLeftY += badge.h + 3;
  }

  // Top-left: lot number
  if (b.noLot) {
    drawBadge(doc, imgX + badgePad, topLeftY, `Lot ${b.noLot}`, [59, 130, 246], [255, 255, 255]);
  }

  // Top-right: superficie
  if (b.superficie) {
    const areaTxt = `${(b.superficie * 10.7639).toFixed(0)} pi2`;
    drawBadge(doc, imgX + imgSize - badgePad, imgY + badgePad, areaTxt, [245, 158, 11], [26, 26, 50], 'right');
  }

  // Top-right below: slope
  const slopeLabel = SLOPE_FR[b.slopeCategory] || b.slopeCategory;
  drawBadge(doc, imgX + imgSize - badgePad, imgY + badgePad + 12, slopeLabel, [26, 26, 50], [255, 255, 255], 'right');

  // Bottom bar: address
  const addrBarH = 10;
  const addrBarY = imgY + imgSize - addrBarH;
  doc.setFillColor(26, 26, 50);
  doc.rect(imgX, addrBarY, imgSize, addrBarH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text(ctx.address.toUpperCase(), imgX + imgSize / 2, addrBarY + 6.5, { align: 'center' });

  // ── Legend strip under image ──
  let ly = imgY + imgSize + 5;
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');

  // Legend items
  const legendX = imgX + 2;
  // Orange square = Bâtiment
  doc.setFillColor(245, 158, 11);
  doc.rect(legendX, ly, 3, 3, 'F');
  doc.setTextColor(80, 80, 100);
  doc.text('Bâtiment détecté', legendX + 5, ly + 2.5);

  // Blue square = Lot
  doc.setFillColor(59, 130, 246);
  doc.rect(legendX + 38, ly, 3, 3, 'F');
  doc.text('Terrain cadastral', legendX + 43, ly + 2.5);

  ly += 7;

  // ── Characteristics card ──
  const cardX = margin;
  const cardW = pw - margin * 2;
  const cardY = ly;

  // Card header
  doc.setFillColor(26, 26, 50);
  pillRect(doc, cardX, cardY, cardW, 9, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('CARACTÉRISTIQUES DE LA COUVERTURE', cardX + 6, cardY + 6.2);

  // Card body
  const bodyY = cardY + 9;
  doc.setFillColor(248, 248, 254);
  doc.rect(cardX, bodyY, cardW, 0.1, 'F'); // thin separator

  const specs: [string, string][] = [
    ['Adresse', ctx.address],
    ['Client', ctx.clientName],
    ['Produit', `${b.productBrand} ${b.productName}`],
    ['Couleur', b.colorName],
    ['Type de couverture', COVERAGE_PDF_FR[b.coverageType] || b.coverageType],
    ['Type de toiture', ROOF_FR[b.roofType] || b.roofType],
    ['Pente estimée', SLOPE_FR[b.slopeCategory] || b.slopeCategory],
    ['Facteur de pente', `×${ctx.quote.slope_factor}`],
  ];

  if (b.noLot) specs.push(['No. de lot', b.noLot]);
  if (b.superficie) specs.push(['Superficie au sol', `${(b.superficie * 10.7639).toFixed(0)} pi2`]);
  specs.push(['Superficie corrigee', `${ctx.quote.surface_displayed.toFixed(0)} pi2`]);
  if (b.perimetre) specs.push(['Perimetre', `${(b.perimetre * 3.28084).toFixed(0)} pi`]);
  if (b.largeur && b.profondeur) specs.push(['Dimensions du batiment', `${(b.largeur * 3.28084).toFixed(0)}' x ${(b.profondeur * 3.28084).toFixed(0)}'`]);
  if (ctx.date) specs.push(['Date souhaitée', ctx.date]);
  specs.push(['Confiance IA', `${(b.confidence * 100).toFixed(0)} %`]);

  // Draw specs in 2 columns
  const leftSpecs = specs.filter((_, i) => i % 2 === 0);
  const rightSpecs = specs.filter((_, i) => i % 2 !== 0);
  const colW = (cardW - 4) / 2;
  const rowH = 7;

  const drawSpecColumn = (specList: [string, string][], xBase: number, startY: number) => {
    let sy = startY;
    specList.forEach(([label, value], i) => {
      // Zebra striping
      if (i % 2 === 0) {
        doc.setFillColor(245, 245, 252);
        doc.rect(xBase, sy - 3.5, colW, rowH, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(110, 110, 130);
      doc.setFontSize(7);
      doc.text(label, xBase + 3, sy);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 50);
      doc.setFontSize(7.5);
      const maxW = colW - 8;
      const lines = doc.splitTextToSize(value, maxW);
      doc.text(lines[0] || value, xBase + colW - 3, sy, { align: 'right' });
      sy += rowH;
    });
    return sy;
  };

  let specY = bodyY + 5;
  const y1 = drawSpecColumn(leftSpecs, cardX + 2, specY);
  const y2 = drawSpecColumn(rightSpecs, cardX + 2 + colW, specY);
  let fy = Math.max(y1, y2) + 2;

  // Card border
  const cardH = fy - cardY;
  doc.setDrawColor(220, 220, 235);
  doc.setLineWidth(0.3);
  doc.rect(cardX, cardY, cardW, cardH, 'S');

  // ── Lengths row ──
  fy += 4;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 80);
  doc.text('Longueurs estimées :', margin + 2, fy);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90, 90, 110);
  doc.text(
    `Faîtière ${ctx.quote.length_faitiere.toFixed(0)} pi   ·   Hanches ${ctx.quote.length_hanches.toFixed(0)} pi   ·   Noues ${ctx.quote.length_noues.toFixed(0)} pi`,
    margin + 40, fy,
  );

  // ── Low confidence warning ──
  if (ctx.quote.low_confidence) {
    fy += 6;
    doc.setFillColor(255, 251, 235);
    pillRect(doc, margin, fy - 3, cardW, 8, 2, 'F');
    doc.setDrawColor(251, 191, 36);
    doc.setLineWidth(0.3);
    pillRect(doc, margin, fy - 3, cardW, 8, 2, 'S');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 120, 0);
    doc.text('/!\\ Confiance faible - Validation sur place recommandee avant les travaux.', margin + 4, fy + 1.5);
  }

  // ── Footer ──
  doc.setFontSize(6.5);
  doc.setTextColor(160, 160, 175);
  doc.setFont('helvetica', 'normal');
  doc.text('Données issues de l\'analyse par intelligence artificielle — Toitures VB — toituresvb.ca', margin, ph - 10);
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-CA')}`, pw - margin, ph - 10, { align: 'right' });
}

/* ═══════════════════════════════════════════
   PDF 1 — Liste de matériaux
   ═══════════════════════════════════════════ */

export async function generateMaterialsPdf(ctx: PdfContext) {
  const logoBase64 = await loadLogoBase64();
  const doc = new jsPDF();
  let y = addHeader(doc, 'Liste de matériaux', ctx, logoBase64);

  const q = ctx.quote;

  // Material lines only (exclude labor)
  const materialLines = q.lines.filter(l =>
    !['Arrachage', 'Pose'].includes(l.description)
  );

  const headers = ['Matériau', 'Quantité', 'Unité'];
  const rows = materialLines.map(l => [
    l.description,
    String(l.quantity),
    l.unit,
  ]);

  const colWidths = [90, 40, 40];
  y = drawTable(doc, y, headers, rows, colWidths);

  // Lengths summary
  y += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text('Longueurs estimées', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Faîtière : ${q.length_faitiere.toFixed(0)} pi  |  Hanches : ${q.length_hanches.toFixed(0)} pi  |  Noues : ${q.length_noues.toFixed(0)} pi`, 14, y);

  // Footer
  y += 14;
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Document généré automatiquement — les quantités incluent les marges de sécurité.', 14, y);

  const base = ctx.pdfFilenameBase || `soumission-${ctx.clientName.replace(/\s/g, '-')}`;
  doc.save(`${base}_MATERIAUX.pdf`);
}

/* ═══════════════════════════════════════════
   PDF 2 — Soumission complète
   ═══════════════════════════════════════════ */

export async function generateQuotePdf(ctx: PdfContext, opts: { returnBlob?: boolean } = {}) {
  const logoBase64 = await loadLogoBase64();
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const mL = 19; const mR = 19; const mT = 16.5;
  const contentW = W - mL - mR;
  const q = ctx.quote;
  const marque = ctx.marque || 'IKO';
  const gamme = ctx.gamme || 'Dynasty';
  const refId = ctx.seqNumber ? `${ctx.seqNumber}_REV0` : (ctx.referenceId || '—');
  const today = new Date();
  const dateStr = today.toLocaleDateString('fr-CA');
  const expiry = new Date(today); expiry.setDate(expiry.getDate() + 16);
  const expiryStr = expiry.toLocaleDateString('fr-CA');
  const projectNo = today.toLocaleDateString('fr-CA', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/-/g, '');
  const addrParts = ctx.address.split(',');
  const addrLine1 = addrParts[0]?.trim() || '';
  const addrLine2 = addrParts.slice(1).join(',').trim();
  const effectiveArea = ctx.effectiveAreaSqft || q.area_sqft;
  const correctedArea = Math.round(effectiveArea * (q.slope_factor || 1));
  const slopeLabel = q.slope_category === 'aucune' ? '0-4/12' : q.slope_category === 'legere' ? '4-7/12' : q.slope_category === 'moderee' ? '8-12/12' : '12/12+';
  const prixPi2 = correctedArea > 0 ? (q.subtotal_displayed / correctedArea).toFixed(2) : '—';
  const prixPaquet = q.lines.find(l => l.description.toLowerCase().includes('bardeau'))?.rate.toFixed(0) || '—';
  const f2 = (n: number) => n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let y = mT;

  // ── HEADER ──
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 26);
  doc.text('TOITURES VB INC.', mL, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text('297 rue Principale', mL, y + 4.5);
  doc.text('Granby QC  J2G 2W1', mL, y + 9);
  doc.text('+14505213227', mL, y + 13.5);
  doc.text('info@toituresvb.ca', mL, y + 18);
  if (logoBase64) { try { doc.addImage(logoBase64, 'PNG', W - mR - 50, y - 3, 50, 20); } catch {} }
  y += 26;

  // ── ADDRESS + BADGES ──
  const badgeW = 58; const badgeX = W - mR - badgeW;
  doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 26);
  doc.text('ADRESSE', mL, y);
  doc.setFont('helvetica', 'normal');
  doc.text(ctx.clientName, mL, y + 4.5);
  doc.text(addrLine1, mL, y + 9);
  if (addrLine2) doc.text(addrLine2, mL, y + 13.5);
  const barY = y + (addrLine2 ? 16.5 : 12.5);
  doc.setFillColor(99, 99, 99); doc.rect(mL, barY, badgeX - mL - 5, 1, 'F');

  doc.setFillColor(99, 99, 99); doc.rect(badgeX, y - 2, badgeW, 9, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text(`SOUMISSION ${refId}`, badgeX + 3, y + 4.5);
  doc.setFillColor(99, 99, 99); doc.rect(badgeX, y + 9, badgeW, 6.5, 'F');
  doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
  doc.text('DATE', badgeX + 3, y + 13.5);
  doc.setFont('helvetica', 'normal'); doc.text(dateStr, badgeX + 16, y + 13.5);
  doc.setFillColor(99, 99, 99); doc.rect(badgeX, y + 17, badgeW, 6.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.text("DATE D'EXPIRATION", badgeX + 3, y + 21.5);
  doc.setFont('helvetica', 'normal'); doc.text(expiryStr, badgeX + 40, y + 21.5);
  y = barY + 6;

  // ── PROJECT ROW ──
  doc.setTextColor(26, 26, 26); const c3 = contentW / 3;
  doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
  doc.text('NO.PROJET', mL, y); doc.text('PROJET', mL + c3, y); doc.text('TYPE DE CONTRAT', mL + c3 * 2, y);
  doc.setFont('helvetica', 'normal');
  doc.text(projectNo, mL, y + 4); doc.text(addrLine1, mL + c3, y + 4); doc.text('FORFAITAIRE', mL + c3 * 2, y + 4);
  y += 12;

  // ── TABLE HEADER ──
  const cDesc = contentW * 0.63; const cQte = contentW * 0.08; const cTaux = contentW * 0.12; const cMont = contentW * 0.12;
  const cGap = (contentW - cDesc - cQte - cTaux - cMont) / 3;
  const xQte = mL + cDesc + cGap; const xTaux = xQte + cQte + cGap; const xMont = xTaux + cTaux + cGap;
  doc.setFillColor(99, 99, 99); doc.rect(mL, y - 3.5, contentW, 7, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('DESCRIPTION', mL + 2, y); doc.text('QTE', xQte, y); doc.text('TAUX', xTaux, y); doc.text('MONTANT', xMont, y);
  y += 6;

  // ── Description block ──
  doc.setTextColor(26, 26, 26); doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
  const descTextLines: { t: string; b?: boolean }[] = [
    { t: `BARDEAUX D'ASPHALTE ${marque} - COULEUR A VALIDER AVEC LE CLIENT` },
    { t: `GARANTIE 40 - VOIR LA GARANTIE ${marque} EN PJ`, b: true },
    { t: `MAIN D'OEUVRE GARANTIE 5 ANS - VOIR LE CERTIFICAT TOITURES VB EN PJ`, b: true },
    { t: '' },
    { t: `SUPERFICIE AU SOL : ${effectiveArea > 0 ? Math.round(effectiveArea).toLocaleString('fr-CA') : '—'} PI2` },
    { t: `- PENTE ${slopeLabel}` },
    { t: `- SUPERFICIE CORRIGE + CONTINGENCE 5% : ${correctedArea > 0 ? correctedArea.toLocaleString('fr-CA') : '—'} PI2` },
    { t: '' }, { t: `PRIX PI2 : ${prixPi2}$` }, { t: `PRIX/PAQUET : ${prixPaquet}$` },
  ];
  for (const dl of descTextLines) {
    if (dl.t) { doc.setFont('helvetica', dl.b ? 'bold' : 'normal'); doc.text(dl.t, mL + 4, y); }
    y += 4;
  }
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(204, 204, 204); doc.setLineWidth(0.15); doc.line(mL + 2, y, mL + contentW - 2, y); y += 4;

  // ── Work description ──
  doc.setFont('helvetica', 'bold'); doc.text("MAIN D'OEUVRE AU CHANTIER", mL + 4, y); y += 4;
  doc.setFont('helvetica', 'normal');
  const workDescLines = [
    "- Installation de baches au sol et preparation de l'espace de travail",
    "- Installation d'echelle de facon securitaire",
    `- Installation de membranes d'avant-toit ${marque} StormShield (36")`,
    `- Installation Sous-Couche de toiture ${marque}`,
    `- Installation de bardeaux de departs ${marque}`,
    `- Installation de bardeaux ${marque} ${gamme} (Application de 6 clous / bardeau)`,
    `- Installation de bardeaux d'arretiers et de faites ${marque} ${gamme}`,
    "- Installation de nouveaux solins d'aerateurs de plomberie",
    "- Nettoyage des gouttieres et nettoyage des lieux et disposition des dechets et rebuts",
  ];
  for (const wl of workDescLines) {
    if (y > H - 25) { doc.addPage(); y = mT; }
    const wrapped = doc.splitTextToSize(wl, contentW - 8);
    for (const line of wrapped) { doc.text(line, mL + 4, y); y += 3.8; }
  }
  y += 1; doc.setDrawColor(204, 204, 204); doc.setLineWidth(0.15); doc.line(mL + 2, y, mL + contentW - 2, y); y += 4;

  // ── Line items ──
  for (const line of q.lines) {
    if (y > H - 25) { doc.addPage(); y = mT; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(26, 26, 26);
    doc.text(line.description.toUpperCase(), mL + 8, y);
    if (line.unit) { doc.setFont('helvetica', 'normal'); doc.setTextColor(85, 85, 85); doc.setFontSize(8); doc.text(line.unit, mL + 8, y + 3.5); }
    doc.setFont('helvetica', 'normal'); doc.setTextColor(26, 26, 26); doc.setFontSize(8.5);
    doc.text(String(line.quantity), xQte, y);
    doc.text(f2(line.rate), xTaux, y);
    doc.text(f2(line.total_displayed), xMont, y);
    const rH = line.unit ? 8 : 5.5;
    doc.setDrawColor(208, 208, 208); doc.setLineWidth(0.2); doc.line(mL, y + rH - 3.5, mL + contentW, y + rH - 3.5);
    y += rH;
  }

  // Page 1 footer
  doc.setDrawColor(224, 224, 224); doc.setLineWidth(0.15); doc.line(mL, H - 14, W - mR, H - 14);
  doc.setFontSize(7); doc.setTextColor(153, 153, 153); doc.setFont('helvetica', 'normal');
  doc.text(`SOUMISSION ${refId} — Page 1`, W / 2, H - 10, { align: 'center' });

  /* ══════════ PAGE 2 ══════════ */
  doc.addPage(); y = mT;
  doc.setFontSize(8); doc.setTextColor(153, 153, 153); doc.text(`SOUMISSION ${refId} — suite`, mL, y);
  doc.setDrawColor(224, 224, 224); doc.setLineWidth(0.15); doc.line(mL, y + 2, W - mR, y + 2); y += 8;

  // Notes left + Totals right
  const nW = contentW * 0.58; const tW2 = contentW * 0.38; const tX2 = W - mR - tW2;
  const rNotes = (ctx.quoteNotes || PDF_DEFAULT_NOTES).replace(/\*\*/g, '');
  doc.setFontSize(8.5); doc.setTextColor(26, 26, 26); doc.setFont('helvetica', 'normal');
  const noteWrapped = doc.splitTextToSize(rNotes, nW);
  let nY = y; for (const nl of noteWrapped) { doc.text(nl, mL, nY); nY += 4; }

  let tY2 = y;
  for (const tr of [
    { l: 'TOTAL PARTIEL', v: f2(q.subtotal_displayed), b: true },
    { l: 'TPS @ 5%', v: f2(q.tps), b: false },
    { l: 'TVQ @ 9,975%', v: f2(q.tvq), b: false },
  ]) {
    doc.setFont('helvetica', tr.b ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.setTextColor(26, 26, 26);
    doc.text(tr.l, tX2, tY2); doc.text(tr.v, W - mR, tY2, { align: 'right' });
    doc.setDrawColor(224, 224, 224); doc.setLineWidth(0.15); doc.line(tX2, tY2 + 2, W - mR, tY2 + 2);
    tY2 += 7;
  }
  y = Math.max(nY, tY2) + 4;

  // Total box
  const tbW = contentW * 0.50; const tbX = W - mR - tbW;
  doc.setFillColor(99, 99, 99); doc.rect(tbX, y, tbW, 10, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
  doc.setFontSize(10); doc.text('TOTAL', tbX + 4, y + 7);
  doc.setFontSize(16); doc.text(`${f2(q.total_final)} $`, W - mR - 4, y + 7.5, { align: 'right' });
  y += 18;
  doc.setDrawColor(99, 99, 99); doc.setLineWidth(0.3); doc.line(mL, y, W - mR, y); y += 8;

  // Payment terms
  const rTerms = (ctx.paymentTerms || PDF_DEFAULT_TERMS).replace(/\{MARQUE\}/g, marque).replace(/\*\*/g, '');
  doc.setFontSize(8.5); doc.setTextColor(26, 26, 26); doc.setFont('helvetica', 'normal');
  const termWrapped = doc.splitTextToSize(rTerms, contentW);
  for (const tl of termWrapped) { if (y > H - 50) { doc.addPage(); y = mT; } doc.text(tl, mL, y); y += 4; }
  y += 12;

  // Signature
  if (y > H - 45) { doc.addPage(); y = mT + 10; }
  const sW = (contentW - 20) / 2;
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(99, 99, 99);
  doc.text('ACCEPTE PAR', mL, y);
  doc.setDrawColor(26, 26, 26); doc.setLineWidth(0.3); doc.line(mL, y + 12, mL + sW, y + 12);
  doc.setFontSize(7.5); doc.setTextColor(153, 153, 153); doc.setFont('helvetica', 'normal');
  doc.text('Nom et signature du client', mL, y + 16);
  const sRx = mL + sW + 20;
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(99, 99, 99);
  doc.text("DATE D'ACCEPTATION", sRx, y);
  doc.setDrawColor(26, 26, 26); doc.setLineWidth(0.3); doc.line(sRx, y + 12, sRx + sW, y + 12);

  // Page 2 footer
  doc.setDrawColor(224, 224, 224); doc.setLineWidth(0.15); doc.line(mL, H - 14, W - mR, H - 14);
  doc.setFontSize(7); doc.setTextColor(153, 153, 153); doc.setFont('helvetica', 'normal');
  doc.text(`SOUMISSION ${refId} — Page 2`, W / 2, H - 10, { align: 'center' });

  addAerialPage(doc, ctx, logoBase64);
  const base = ctx.pdfFilenameBase || `soumission-${ctx.clientName.replace(/\s/g, '-')}`;
  if (opts.returnBlob) {
    return { blob: doc.output('blob') as Blob, filenameBase: base };
  }
  doc.save(`${base}.pdf`);
  return { filenameBase: base };
}

/** Same as generateQuotePdf but returns base64 string instead of saving */
export async function generateQuotePdfBase64(ctx: PdfContext): Promise<string> {
  const logoBase64 = await loadLogoBase64();
  const doc = new jsPDF();
  let y = addHeader(doc, 'Soumission', ctx, logoBase64);

  const q = ctx.quote;
  const headers = ['Description', 'Qté', 'Taux', 'Total'];
  const rows: string[][] = q.lines.map(l => [
    l.description,
    `${l.quantity} ${l.unit}`,
    fmtDec(l.rate),
    fmt(l.total_displayed),
  ]);
  rows.push(['Sous-total', '', '', fmt(q.subtotal_displayed)]);
  rows.push(['TPS (5%)', '', '', fmt(q.tps)]);
  rows.push(['TVQ (9.975%)', '', '', fmt(q.tvq)]);
  rows.push(['TOTAL', '', '', fmt(q.total_final)]);

  const colWidths = [70, 35, 35, 42];
  y = drawTable(doc, y, headers, rows, colWidths, { boldLastRows: 4 });

  if (q.low_confidence) {
    y += 8;
    doc.setFontSize(8);
    doc.setTextColor(200, 120, 0);
    doc.text('/!\\ Estimation basee sur analyse d\'imagerie. Validation sur place recommandee.', 14, y);
  }
  const maxW2 = doc.internal.pageSize.getWidth() - 28;
  y += 10;
  y = addTextBlock(doc, y, 'NOTES', ctx.quoteNotes || PDF_DEFAULT_NOTES, maxW2);
  y = addTextBlock(doc, y, 'MODALITÉS DE PAIEMENT', ctx.paymentTerms || PDF_DEFAULT_TERMS, maxW2);
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Les prix sont sujets à changement. Soumission valide 30 jours.', 14, y);
  doc.text('Toitures VB — toituresvb.com', 14, y + 5);
  addAerialPage(doc, ctx, logoBase64);

  return doc.output('datauristring').split(',')[1];
}

/** Generate merged PDF (soumission + matériaux + aerial) as base64 for internal email */
export async function generateMergedPdfBase64(ctx: PdfContext): Promise<string> {
  const logoBase64 = await loadLogoBase64();
  const doc = new jsPDF();

  // ── Page 1: Soumission ──
  let y = addHeader(doc, 'Soumission', ctx, logoBase64);
  const q = ctx.quote;
  const headers = ['Description', 'Qté', 'Taux', 'Total'];
  const rows: string[][] = q.lines.map(l => [
    l.description, `${l.quantity} ${l.unit}`, fmtDec(l.rate), fmt(l.total_displayed),
  ]);
  rows.push(['Sous-total', '', '', fmt(q.subtotal_displayed)]);
  rows.push(['TPS (5%)', '', '', fmt(q.tps)]);
  rows.push(['TVQ (9.975%)', '', '', fmt(q.tvq)]);
  rows.push(['TOTAL', '', '', fmt(q.total_final)]);
  const colWidths = [70, 35, 35, 42];
  y = drawTable(doc, y, headers, rows, colWidths, { boldLastRows: 4 });
  if (q.low_confidence) {
    y += 8;
    doc.setFontSize(8);
    doc.setTextColor(200, 120, 0);
    doc.text('/!\\ Estimation basee sur analyse d\'imagerie. Validation sur place recommandee.', 14, y);
  }
  const maxW3 = doc.internal.pageSize.getWidth() - 28;
  y += 10;
  y = addTextBlock(doc, y, 'NOTES', ctx.quoteNotes || PDF_DEFAULT_NOTES, maxW3);
  y = addTextBlock(doc, y, 'MODALITÉS DE PAIEMENT', ctx.paymentTerms || PDF_DEFAULT_TERMS, maxW3);
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Les prix sont sujets à changement. Soumission valide 30 jours.', 14, y);
  doc.text('Toitures VB — toituresvb.com', 14, y + 5);

  // ── Page 2: Liste de matériaux ──
  doc.addPage();
  y = addHeader(doc, 'Liste de matériaux', ctx, logoBase64);
  const materialLines = q.lines.filter(l => !['Arrachage', 'Pose'].includes(l.description));
  const matHeaders = ['Matériau', 'Quantité', 'Unité'];
  const matRows = materialLines.map(l => [l.description, String(l.quantity), l.unit]);
  const matColWidths = [90, 40, 40];
  y = drawTable(doc, y, matHeaders, matRows, matColWidths);
  y += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text('Longueurs estimées', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Faîtière : ${q.length_faitiere.toFixed(0)} pi  |  Hanches : ${q.length_hanches.toFixed(0)} pi  |  Noues : ${q.length_noues.toFixed(0)} pi`, 14, y);
  y += 14;
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Document généré automatiquement — les quantités incluent les marges de sécurité.', 14, y);

  // ── Page 3: Aerial overview ──
  addAerialPage(doc, ctx, logoBase64);

  return doc.output('datauristring').split(',')[1];
}

/* ── Helper: fetch satellite image as base64 data URL ── */
export async function fetchSatelliteDataUrl(
  lat: number,
  lng: number,
  zoom: number,
  apiKey: string,
): Promise<string | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=640x640&scale=2&maptype=satellite&key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ── Helper: composite satellite image with polygon overlays on canvas ── */

interface PolygonAdjustments {
  offsetEastM: number;
  offsetNorthM: number;
  rotationDeg: number;
}

function latLngToPixel(
  lat: number, lng: number,
  centerLat: number, centerLng: number,
  zoom: number, imgSize: number,
): { x: number; y: number } {
  const siny = Math.sin(lat * Math.PI / 180);
  const clampedSiny = Math.max(-0.9999, Math.min(0.9999, siny));

  const worldX = 128 + (lng / 360) * 256;
  const worldY = 128 + 0.5 * Math.log((1 + clampedSiny) / (1 - clampedSiny)) * -(256 / (2 * Math.PI));

  const sinyCtr = Math.sin(centerLat * Math.PI / 180);
  const clampedSinyCtr = Math.max(-0.9999, Math.min(0.9999, sinyCtr));
  const ctrWorldX = 128 + (centerLng / 360) * 256;
  const ctrWorldY = 128 + 0.5 * Math.log((1 + clampedSinyCtr) / (1 - clampedSinyCtr)) * -(256 / (2 * Math.PI));

  // Google Static Maps: size=640&scale=2 → image is 1280px but covers 640 "CSS pixels" of map.
  // World-pixel offset at zoom Z = (worldDelta) * 2^zoom → gives CSS pixels.
  // Multiply by 2 (the scale factor) to get physical pixels on the 1280px canvas.
  const pixelScale = Math.pow(2, zoom) * 2;
  const x = (worldX - ctrWorldX) * pixelScale + imgSize / 2;
  const y = (worldY - ctrWorldY) * pixelScale + imgSize / 2;

  return { x, y };
}

function parseGeoJsonCoordsForCanvas(geojsonStr: string): number[][][] {
  try {
    const parsed = JSON.parse(geojsonStr);
    // rings is number[][][] where each ring is number[][] (array of [lng, lat] pairs)
    let rings: number[][][] = [];
    if (parsed.type === 'Polygon') rings = parsed.coordinates as number[][][];
    else if (parsed.type === 'MultiPolygon') {
      for (const poly of (parsed.coordinates as number[][][][])) {
        for (const ring of poly) rings.push(ring);
      }
    }
    return rings;
  } catch {
    return [];
  }
}

function offsetPointCanvas(lat: number, lng: number, northM: number, eastM: number): [number, number] {
  const latDelta = northM / 111320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngDelta = eastM / (111320 * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat));
  return [lat + latDelta, lng + lngDelta];
}

function rotatePointCanvas(lat: number, lng: number, pivotLat: number, pivotLng: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const cosLat = Math.cos((pivotLat * Math.PI) / 180);
  const dx = (lng - pivotLng) * cosLat;
  const dy = lat - pivotLat;
  const rx = dx * cosA - dy * sinA;
  const ry = dx * sinA + dy * cosA;
  return [pivotLat + ry, pivotLng + rx / (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat)];
}

export function compositeMapWithPolygons(
  satDataUrl: string,
  centerLat: number,
  centerLng: number,
  zoom: number,
  buildingGeojson: string | null,
  lotGeojson: string | null,
  adjustments?: PolygonAdjustments | null,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = img.width; // 1280 (scale=2 of 640)
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx2d = canvas.getContext('2d')!;

      // Draw satellite image
      ctx2d.drawImage(img, 0, 0, size, size);

      // Draw lot polygon (blue)
      if (lotGeojson) {
        const rings = parseGeoJsonCoordsForCanvas(lotGeojson);
        ctx2d.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx2d.strokeStyle = 'rgba(96, 165, 250, 0.7)';
        ctx2d.lineWidth = 2;
        for (const ring of rings) {
          ctx2d.beginPath();
          for (let i = 0; i < ring.length; i++) {
            const [lng, lat] = ring[i];
            const px = latLngToPixel(lat, lng, centerLat, centerLng, zoom, size);
            if (i === 0) ctx2d.moveTo(px.x, px.y);
            else ctx2d.lineTo(px.x, px.y);
          }
          ctx2d.closePath();
          ctx2d.fill();
          ctx2d.stroke();
        }
      }

      // Draw building polygon (orange) with adjustments
      if (buildingGeojson) {
        const rings = parseGeoJsonCoordsForCanvas(buildingGeojson);
        const adj = adjustments || { offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0 };

        // Compute centroid for rotation pivot
        let sumLat = 0, sumLng = 0, count = 0;
        for (const ring of rings) {
          for (const [lng, lat] of ring) { sumLat += lat; sumLng += lng; count++; }
        }
        const pivotLat = count > 0 ? sumLat / count : centerLat;
        const pivotLng = count > 0 ? sumLng / count : centerLng;

        ctx2d.fillStyle = 'rgba(245, 158, 11, 0.3)';
        ctx2d.strokeStyle = 'rgba(245, 158, 11, 0.9)';
        ctx2d.lineWidth = 3;

        for (const ring of rings) {
          ctx2d.beginPath();
          for (let i = 0; i < ring.length; i++) {
            let [lng, lat] = ring[i];
            // Apply rotation
            if (adj.rotationDeg !== 0) {
              [lat, lng] = rotatePointCanvas(lat, lng, pivotLat, pivotLng, adj.rotationDeg);
            }
            // Apply offset
            if (adj.offsetNorthM !== 0 || adj.offsetEastM !== 0) {
              [lat, lng] = offsetPointCanvas(lat, lng, adj.offsetNorthM, adj.offsetEastM);
            }
            const px = latLngToPixel(lat, lng, centerLat, centerLng, zoom, size);
            if (i === 0) ctx2d.moveTo(px.x, px.y);
            else ctx2d.lineTo(px.x, px.y);
          }
          ctx2d.closePath();
          ctx2d.fill();
          ctx2d.stroke();
        }
      }

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(satDataUrl); // fallback to plain satellite
    img.src = satDataUrl;
  });
}
