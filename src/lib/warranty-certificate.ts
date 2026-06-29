import jsPDF from 'jspdf';
import vbLogoWhite from '@/assets/vb-logo-white.png';
import stampImg from '@/assets/stamp-garantie.png';
import headerBgImg from '@/assets/warranty-header-bg.jpg';
import signatureImg from '@/assets/signature-jv.png';

/* ── Types ── */
export interface WarrantyData {
  clientName: string;
  projectAddress: string;
  city: string;
  roofType: string;
  surfaceArea: string;
  completionDate: string;
  invoiceNumber: string;
  warrantyYears: number;
  contractAmount: string;
  referenceId: string;
}

/* ── Asset loader (cached) ── */
let _logoB64: string | null = null;
let _stampB64: string | null = null;

async function loadAssetB64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise(resolve => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function loadLogo(): Promise<string | null> {
  if (!_logoB64) _logoB64 = await loadAssetB64(vbLogoWhite);
  return _logoB64;
}

async function loadStamp(): Promise<string | null> {
  if (!_stampB64) _stampB64 = await loadAssetB64(stampImg);
  return _stampB64;
}

let _headerBgB64: string | null = null;
async function loadHeaderBg(): Promise<string | null> {
  if (!_headerBgB64) _headerBgB64 = await loadAssetB64(headerBgImg);
  return _headerBgB64;
}

let _signatureB64: string | null = null;
async function loadSignature(): Promise<string | null> {
  if (!_signatureB64) _signatureB64 = await loadAssetB64(signatureImg);
  return _signatureB64;
}

/* ── Stamp number generator ── */
function generateStampNumber(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = Math.floor(100000 + Math.random() * 900000);
  const suffix = chars[Math.floor(Math.random() * chars.length)];
  return `N°CA-${digits}${suffix}`;
}

/* ── Colors — dark charcoal + gold palette ── */
const DARK = '#1a1a1a';
const ACCENT = '#c9a84c';
const MUTED = '#8a8a8a';
const LIGHT_BG = '#f5f3ee';
const BORDER = '#d4c9a8';
const GOLD = '#c9a84c';
const GOLD_DARK = '#8a7434';

/* ── Helpers ── */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;

function drawLine(doc: jsPDF, y: number, color = BORDER) {
  doc.setDrawColor(color);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
}

/* ── Draw text along an arc ── */
function drawArcText(doc: jsPDF, text: string, cx: number, cy: number, radius: number, startAngle: number, fontSize: number) {
  doc.setFontSize(fontSize);
  const chars = text.split('');
  // Estimate char width in mm
  const charW = fontSize * 0.35;
  const totalArc = chars.length * charW;
  const arcPerChar = totalArc / radius;
  const half = arcPerChar / 2;

  chars.forEach((ch, i) => {
    const frac = (i + 0.5) / chars.length;
    const angle = startAngle - half + frac * arcPerChar;
    const x = cx + radius * Math.cos(angle);
    const y = cy - radius * Math.sin(angle);
    // Save state, rotate, draw, restore
    doc.saveGraphicsState();
    const rotDeg = -(90 - angle * 180 / Math.PI);
    // jsPDF doesn't support per-char rotation natively, use text with angle
    doc.text(ch, x, y, { align: 'center', angle: rotDeg });
    doc.restoreGraphicsState();
  });
}

function drawStamp(doc: jsPDF, years: number, stamp: string | null, stampNumber: string) {
  const cx = PAGE_W - MARGIN - 18;
  const cy = 54;
  const size = 32;

  if (stamp) {
    try {
      doc.addImage(stamp, 'PNG', cx - size / 2, cy - size / 2, size, size);
    } catch {}
  }

  // Years number — straight centered in the dark area
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor('#ffffff');
  doc.text(`${years}`, cx, cy - 3, { align: 'center' });

  // "ANS" straight below the number
  doc.setFontSize(7);
  doc.text('ANS', cx, cy + 1.5, { align: 'center' });

  // Serial number — in arc following the bottom curve of the stamp
  doc.setFont('helvetica', 'bold');
  doc.setTextColor('#b8963e');
  drawArcText(doc, stampNumber, cx, cy, size / 2 - 3, -Math.PI / 2, 4);
}

function addField(doc: jsPDF, label: string, value: string, x: number, y: number, w: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(ACCENT);
  doc.text(label.toUpperCase(), x, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(DARK);
  const lines = doc.splitTextToSize(value || '—', w - 2);
  doc.text(lines, x, y + 5);
  return y + 5 + lines.length * 4.5;
}

/* ── Page 1: Certificate ── */
function renderPage1(doc: jsPDF, data: WarrantyData, logo: string | null, stamp: string | null, stampNumber: string, headerBg: string | null, signature: string | null) {
  let y = MARGIN;

  // Header bar with background image
  doc.setFillColor(DARK);
  doc.rect(0, 0, PAGE_W, 36, 'F');
  if (headerBg) {
    try { doc.addImage(headerBg, 'JPEG', 0, 0, PAGE_W, 36); } catch {}
  }

  // Logo — centered
  if (logo) {
    const logoW = 50;
    try { doc.addImage(logo, 'PNG', (PAGE_W - logoW) / 2, 8, logoW, 20); } catch {}
  }

  // Title
  y = 50;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(DARK);
  doc.text('CERTIFICAT DE', MARGIN, y);
  doc.text('GARANTIE', MARGIN, y + 11);

  drawStamp(doc, data.warrantyYears, stamp, stampNumber);

  y = 72;
  drawLine(doc, y, ACCENT);

  // Intro paragraph
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(MUTED);
  const intro = `Toitures VB, ayant terminé l'installation d'une couverture, tel que mentionné à la soumission, sur l'immeuble décrit comme suit :`;
  const introLines = doc.splitTextToSize(intro, CONTENT_W);
  doc.text(introLines, MARGIN, y);
  y += introLines.length * 4.5 + 8;

  // Project info grid
  const col1X = MARGIN;
  const col2X = MARGIN + CONTENT_W / 2 + 5;
  const colW = CONTENT_W / 2 - 5;

  let y1 = y;
  y1 = addField(doc, 'Propriétaire', data.clientName, col1X, y1, colW);
  y1 += 4;
  y1 = addField(doc, 'Immeuble / Adresse', data.projectAddress, col1X, y1, colW);
  y1 += 4;
  y1 = addField(doc, 'Ville', data.city, col1X, y1, colW);

  let y2 = y;
  y2 = addField(doc, 'Type de toiture', data.roofType, col2X, y2, colW);
  y2 += 4;
  y2 = addField(doc, 'Superficie', data.surfaceArea, col2X, y2, colW);
  y2 += 4;
  y2 = addField(doc, 'Date de fin des travaux', data.completionDate, col2X, y2, colW);
  y2 += 4;
  y2 = addField(doc, 'N° de dossier / facture', data.invoiceNumber, col2X, y2, colW);

  y = Math.max(y1, y2) + 8;
  drawLine(doc, y);

  // Warranty statement
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(DARK);
  const statement = `Nous soussignés garantissons de prendre à notre charge, en cas d'infiltration manifeste, la réparation de la membrane de la couverture, des solins multicouches et ouvrages de tôlerie qui s'y rapportent, et ce pendant une période de ${data.warrantyYears === 1 ? 'un (1) an' : data.warrantyYears + ' (' + data.warrantyYears + ') ans'} à compter des trente (30) jours qui suivent la date d'achèvement des travaux ci-dessus indiquée.`;
  const stLines = doc.splitTextToSize(statement, CONTENT_W);
  doc.text(stLines, MARGIN, y);
  y += stLines.length * 4.5 + 6;

  // Limitation box
  doc.setFillColor(LIGHT_BG);
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN, y, CONTENT_W, 26, 3, 3, 'FD');

  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(ACCENT);
  doc.text('GARANTIE LIMITÉE', MARGIN + 6, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text('• Main-d\'œuvre uniquement   • Réparation seulement   • Infiltrations d\'eau directement causées par un défaut d\'installation', MARGIN + 6, y);
  y += 5;
  doc.text(`• Responsabilité maximale limitée au montant des travaux : ${data.contractAmount}`, MARGIN + 6, y);

  // Tagline
  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(DARK);
  doc.text('NOS RESSOURCES HUMAINES ET TECHNIQUES, UNE FORCE QUI TRAVAILLE POUR TOUS.', PAGE_W / 2, y, { align: 'center' });
  y += 4.5;
  doc.text('NOS TOITURES DE HAUTE QUALITÉ, UNE PROTECTION INDISPENSABLE POUR VOS BÂTIMENTS.', PAGE_W / 2, y, { align: 'center' });

  y += 14;
  // Signature lines
  const sigW = 60;
  const sig1X = MARGIN + 10;

  // Signature image above the line
  if (signature) {
    try { doc.addImage(signature, 'PNG', sig1X + 5, y - 14, 40, 12); } catch {}
  }

  // Signature line
  doc.setDrawColor(MUTED);
  doc.setLineWidth(0.3);
  doc.line(sig1X, y, sig1X + sigW, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(DARK);
  doc.text('TOITURES VB', sig1X, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(MUTED);
  doc.text('Par : Jasmin Valcourt, Président', sig1X, y + 9.5);
  doc.setFontSize(8);
  doc.setTextColor(DARK);
  doc.text(`Date : ${data.completionDate}`, sig1X, y + 14);

  y += 20;

  y += 8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor('#c0392b');
  doc.text('Document invalide si non signé', PAGE_W / 2, y, { align: 'center' });

  // Footer
  drawLine(doc, PAGE_H - 24, GOLD_DARK);
  y = PAGE_H - 19;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text('R.B.Q : 5854-9353-01', MARGIN, y);
  doc.text(`Réf: ${stampNumber}`, PAGE_W - MARGIN, y, { align: 'right' });
  y += 4;
  doc.text('CP264, 297 Rue Principale, Granby, Qc, J2G 8E5', MARGIN, y);
  doc.text('TÉL : 450-521-3227  •  info@toituresvb.ca', PAGE_W - MARGIN, y, { align: 'right' });
}

/* ── Helper: draw footer on any page ── */
function drawPageFooter(doc: jsPDF, stampNumber: string, pageNum: number) {
  drawLine(doc, PAGE_H - 24, DARK);
  let fy = PAGE_H - 19;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text('R.B.Q : 5854-9353-01', MARGIN, fy);
  doc.text(`Réf: ${stampNumber}  •  Page ${pageNum}`, PAGE_W - MARGIN, fy, { align: 'right' });
  fy += 4;
  doc.text('CP264, 297 Rue Principale, Granby, Qc, J2G 8E5', MARGIN, fy);
  doc.text('TÉL : 450-521-3227  •  info@toituresvb.ca', PAGE_W - MARGIN, fy, { align: 'right' });
}

/* ── Helper: new page with header ── */
function addPageWithHeader(doc: jsPDF, logo: string | null, headerBg: string | null): number {
  doc.addPage();
  doc.setFillColor(DARK);
  doc.rect(0, 0, PAGE_W, 36, 'F');
  if (headerBg) {
    try { doc.addImage(headerBg, 'JPEG', 0, 0, PAGE_W, 36); } catch {}
  }
  if (logo) {
    const logoW = 50;
    try { doc.addImage(logo, 'PNG', (PAGE_W - logoW) / 2, 8, logoW, 20); } catch {}
  }
  return 48;
}

/* ── Helper: ensure enough space or add page ── */
function ensureSpace(doc: jsPDF, y: number, needed: number, logo: string | null, headerBg: string | null): number {
  if (y > PAGE_H - needed) {
    return addPageWithHeader(doc, logo, headerBg);
  }
  return y;
}

/* ── Page 2+: Conditions ── */
function renderPage2(doc: jsPDF, data: WarrantyData, logo: string | null, headerBg: string | null, stampNumber: string) {
  const condFS = 7.5;
  const letterW = 12;
  const FOOTER_ZONE = 30; // reserved for footer

  type Section = {
    letter: string;
    title: string;
    paragraphs?: string[];
    bullets?: string[];
  };

  /* ── Ensure space, add page with header if needed ── */
  function needPage(y: number, needed: number): number {
    if (y > PAGE_H - FOOTER_ZONE - needed) {
      return addPageWithHeader(doc, logo, headerBg);
    }
    return y;
  }

  /* ── Render a single lettered section ── */
  function renderSection(s: Section, y: number): number {
    y = needPage(y, 30);

    // Gold letter badge
    doc.setFillColor(ACCENT);
    doc.roundedRect(MARGIN, y - 4.5, 8.5, 8.5, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor('#ffffff');
    doc.text(s.letter, MARGIN + 4.25, y + 1, { align: 'center' });

    // Section title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(condFS + 1);
    doc.setTextColor(DARK);
    doc.text(s.title.toUpperCase(), MARGIN + letterW, y);
    y += 5;

    // Paragraphs
    if (s.paragraphs) {
      for (const p of s.paragraphs) {
        y = needPage(y, 14);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(condFS);
        doc.setTextColor(MUTED);
        const lines = doc.splitTextToSize(p, CONTENT_W - letterW);
        doc.text(lines, MARGIN + letterW, y);
        y += lines.length * 3.5 + 2;
      }
    }

    // Bullet points
    if (s.bullets) {
      for (const b of s.bullets) {
        y = needPage(y, 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(condFS);
        doc.setTextColor(ACCENT);
        doc.text('•', MARGIN + letterW + 2, y);
        doc.setTextColor(MUTED);
        const bLines = doc.splitTextToSize(b, CONTENT_W - letterW - 8);
        doc.text(bLines, MARGIN + letterW + 7, y);
        y += bLines.length * 3.5 + 1.5;
      }
    }

    return y + 4;
  }

  // ── Page 2 header ──
  doc.setFillColor(DARK);
  doc.rect(0, 0, PAGE_W, 36, 'F');
  if (headerBg) { try { doc.addImage(headerBg, 'JPEG', 0, 0, PAGE_W, 36); } catch {} }
  if (logo) { try { doc.addImage(logo, 'PNG', (PAGE_W - 50) / 2, 8, 50, 20); } catch {} }

  let y = 48;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(DARK);
  doc.text('CONDITIONS DE GARANTIE', MARGIN, y);
  y += 4;
  drawLine(doc, y, ACCENT);
  y += 8;

  // ── All sections A–G ──
  const allSections: Section[] = [
    {
      letter: 'A', title: 'Bénéficiaire et portée',
      paragraphs: [
        `La présente garantie n'est offerte qu'à l'acheteur-consommateur initial et ne s'applique qu'à l'immeuble visé par les travaux effectués par Toitures VB.`,
        `La présente garantie n'est pas transférable aux acquéreurs subséquents de l'immeuble.`,
      ],
    },
    {
      letter: 'B', title: 'Couverture de garantie',
      paragraphs: [
        `Toitures VB garantit la toiture ci-bas spécifiée contre toute infiltration d'eau directement attribuable à un défaut d'installation pour une période de ${data.warrantyYears === 1 ? 'un (1) an' : data.warrantyYears + ' (' + data.warrantyYears + ') ans'} à compter de la date d'installation du revêtement de toiture.`,
        `La garantie couvre exclusivement les infiltrations d'eau causées par un défaut d'installation des travaux exécutés par Toitures VB.`,
      ],
    },
    {
      letter: 'C', title: 'Limitation de responsabilité',
      paragraphs: [
        `La responsabilité totale de Toitures VB est strictement limitée au montant de main-d'œuvre payé pour les travaux de toiture visés par la présente garantie.`,
        `Toitures VB se réserve le droit, à sa seule discrétion, de réparer ou de remplacer les parties défectueuses.`,
        `Aucun montant ne sera versé pour dommages accessoires, indirects, consécutifs ou pertes d'exploitation.`,
      ],
    },
    {
      letter: 'D', title: "Conditions d'application",
      paragraphs: [`La présente garantie est valide uniquement si :`],
      bullets: [
        `Le paiement complet des travaux a été effectué`,
        `Aucune modification, transformation, réparation ou ajout n'a été effectué sans l'autorisation écrite préalable de Toitures VB`,
        `Le bénéficiaire permet l'accès complet à la toiture ainsi qu'à l'intérieur du bâtiment pour inspection`,
        `La toiture est utilisée dans des conditions normales et conformes à sa destination`,
      ],
    },
    {
      letter: 'E', title: 'Obligations du bénéficiaire',
      paragraphs: [`Le bénéficiaire doit :`],
      bullets: [
        `Assurer l'entretien normal de la toiture`,
        `Maintenir les drains, gouttières et descentes pluviales libres de toute obstruction`,
        `Réparer les joints de calfeutrage au besoin`,
        `Éviter toute surcharge, circulation excessive ou entreposage sur la toiture`,
      ],
    },
    {
      letter: 'F', title: 'Avis de réclamation',
      paragraphs: [
        `Le bénéficiaire de la présente garantie devra informer Toitures VB, par avis écrit, dans les SEPT (7) jours suivant la découverte d'un sinistre pouvant mettre en œuvre la présente garantie.`,
        `Le bénéficiaire ne pourra procéder à aucune réparation avant que Toitures VB ait procédé à l'inspection et déterminé les correctifs nécessaires.`,
      ],
    },
    {
      letter: 'G', title: 'Délai légal',
      paragraphs: [
        `Toute réclamation doit être présentée durant la période de garantie.`,
        `Toute poursuite judiciaire devra être intentée dans un délai maximal de un (1) an suivant la découverte du défaut.`,
      ],
    },
  ];

  for (const s of allSections) {
    y = renderSection(s, y);
  }

  // ── EXCLUSIONS (standalone section with ✕ markers) ──
  y = needPage(y, 40);
  y += 2;
  drawLine(doc, y, ACCENT);
  y += 8;

  // Exclusion header badge
  doc.setFillColor('#c0392b');
  doc.roundedRect(MARGIN, y - 4.5, 8.5, 8.5, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor('#ffffff');
  doc.text('!', MARGIN + 4.25, y + 1, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(condFS + 1);
  doc.setTextColor(DARK);
  doc.text('EXCLUSIONS', MARGIN + letterW, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(condFS);
  doc.setTextColor(MUTED);
  doc.text('La présente garantie ne couvre pas :', MARGIN + letterW, y);
  y += 5;

  const exclusions = [
    'Les barrages de glace (ice dam)',
    'Les catastrophes naturelles (vents violents, ouragans, tornades, verglas, incendies, etc.)',
    'Les dommages causés par des agents mécaniques ou chimiques',
    'Les impacts ou chutes d\'objets',
    'Les défauts de matériaux (responsabilité du manufacturier)',
    'Les défauts de construction ou problèmes structuraux du bâtiment',
    'L\'insuffisance de ventilation de l\'entretoit',
    'L\'insuffisance d\'isolation',
    'Les modifications ou réparations non autorisées',
    'Le mauvais entretien de la toiture',
    'Les dommages causés par le déneigement ou le déglaçage',
    'L\'usure normale (variation de couleur, vieillissement)',
    'Les mouvements ou déformations de la structure',
    'Le déplacement ou détérioration d\'éléments adjacents',
    'L\'utilisation abusive ou anormale de la toiture',
  ];

  for (const ex of exclusions) {
    y = needPage(y, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(condFS);
    doc.setTextColor('#c0392b');
    doc.text('✕', MARGIN + letterW + 2, y);
    doc.setTextColor(MUTED);
    const exLines = doc.splitTextToSize(ex, CONTENT_W - letterW - 8);
    doc.text(exLines, MARGIN + letterW + 7, y);
    y += exLines.length * 3.5 + 1.5;
  }

  y += 4;

  // ── Remaining sections H–L ──
  const finalSections: Section[] = [
    {
      letter: 'H', title: 'Non-responsabilité',
      paragraphs: [`Toitures VB ne sera en aucun cas responsable :`],
      bullets: [
        `Des dommages au bâtiment ou à son contenu`,
        `Des pertes d'usage ou interruption d'activités`,
        `Des frais de main-d'œuvre liés à des matériaux défectueux`,
        `De tout dommage indirect ou consécutif`,
      ],
    },
    {
      letter: 'I', title: 'Modifications et usage',
      paragraphs: [
        `Tout changement d'usage du bâtiment ou modification de la toiture doit être approuvé par écrit par Toitures VB, sans quoi la garantie devient nulle.`,
      ],
    },
    {
      letter: 'J', title: "Droit d'accès et inspection",
      paragraphs: [
        `Le refus de permettre à Toitures VB d'examiner la toiture et l'intérieur du bâtiment rend la garantie nulle et sans effet.`,
      ],
    },
    {
      letter: 'K', title: 'Loi applicable et priorité',
      paragraphs: [
        `La présente garantie est régie et interprétée selon les lois en vigueur dans la province de Québec.`,
        `En cas de contradiction entre la présente garantie et tout autre document, la présente garantie prévaut.`,
      ],
    },
    {
      letter: 'L', title: "Engagement d'intervention",
      paragraphs: [
        `Toitures VB s'engage à intervenir dans un délai raisonnable suivant la réception d'un avis conforme.`,
      ],
    },
  ];

  for (const s of finalSections) {
    y = renderSection(s, y);
  }

  // ── Draw footer on every conditions page ──
  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    drawPageFooter(doc, stampNumber, p);
  }
}

/* ── Watermark helper ── */
function drawSpecimenWatermark(doc: jsPDF) {
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.saveGraphicsState();
    // @ts-ignore – jsPDF GState
    doc.setGState(new (doc as any).GState({ opacity: 0.08 }));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(72);
    doc.setTextColor('#c0392b');
    doc.text('SPÉCIMEN', PAGE_W / 2, PAGE_H / 2, {
      align: 'center',
      angle: 45,
    });
    doc.restoreGraphicsState();
  }
}

/* ── Public API ── */
export async function generateWarrantyCertificatePdf(
  data: WarrantyData,
  includeConditions: boolean = true,
  existingStampNumber?: string,
): Promise<string> {
  const [logo, stamp, headerBg, signature] = await Promise.all([loadLogo(), loadStamp(), loadHeaderBg(), loadSignature()]);
  const stampNumber = existingStampNumber || generateStampNumber();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  renderPage1(doc, data, logo, stamp, stampNumber, headerBg, signature);

  if (includeConditions) {
    doc.addPage();
    renderPage2(doc, data, logo, headerBg, stampNumber);
  }

  const filename = `VB_GARANTIE_${data.clientName.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
  return stampNumber;
}

/* ── Specimen PDF ── */
export async function generateSpecimenCertificatePdf(): Promise<void> {
  const [logo, stamp, headerBg] = await Promise.all([loadLogo(), loadStamp(), loadHeaderBg()]);
  const stampNumber = 'N°CA-XXXXXXX';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const specimenData: WarrantyData = {
    clientName: 'Nom du client',
    projectAddress: '123 Rue Exemple',
    city: 'Ville, Qc',
    roofType: 'Bardeaux d\'asphalte',
    surfaceArea: 'X XXX pi²',
    completionDate: 'AAAA-MM-JJ',
    invoiceNumber: 'F-XXXX-XXX',
    warrantyYears: 10,
    contractAmount: 'XX XXX $',
    referenceId: 'VB_SPECIMEN',
  };

  // Render page 1 WITHOUT signature (pass null for signature)
  renderPage1(doc, specimenData, logo, stamp, stampNumber, headerBg, null);

  // Render conditions pages
  doc.addPage();
  renderPage2(doc, specimenData, logo, headerBg, stampNumber);

  // Apply SPÉCIMEN watermark on all pages
  drawSpecimenWatermark(doc);

  doc.save('VB_GARANTIE_SPECIMEN.pdf');
}
