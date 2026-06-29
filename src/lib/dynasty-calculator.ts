/**
 * Dynasty Shingle Pricing Engine
 * 
 * Complete calculation for IKO Dynasty (and compatible shingle products).
 * Based on building footprint data (superficie + périmètre) and AI vision analysis.
 */

/* ── Types ── */

export type RoofType = '2pans' | '4pans' | '4pans_plus' | 'plat';
export type SlopeCategory = 'aucune' | 'legere' | 'moderee' | 'abrupte';

export interface VisionResult {
  slope_category: SlopeCategory;
  roof_type: RoofType;
  confidence: number;
  reasoning_short: string;
}

export interface QuoteLine {
  _uid?: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  total_base: number;
  ratio: number;       // computed after subtotal
  total_displayed: number; // with hidden contingency
}

export interface DynastyQuote {
  // Inputs
  area_sqft: number;
  perimeter_ft: number;
  slope_category: SlopeCategory;
  roof_type: RoofType;
  confidence: number;

  // Derived
  slope_factor: number;
  surface_corrected: number;
  surface_displayed: number;
  length_faitiere: number;
  length_hanches: number;
  length_noues: number;

  // Line items
  lines: QuoteLine[];

  // Totals
  subtotal_base: number;
  contingency: number;         // hidden 10%
  subtotal_displayed: number;
  tps: number;
  tvq: number;
  total_final: number;

  // Warning
  low_confidence: boolean;
}

/* ── Constants ── */

const SLOPE_FACTORS: Record<SlopeCategory, number> = {
  aucune: 1.00,   // toit plat
  legere: 1.06,   // ~4-5/12
  moderee: 1.12,  // ~6-8/12
  abrupte: 1.25,  // ~9-12/12
};

const CONT_RATE_AREA = 0.05;
const CONTINGENCY_RATE = 0.10;
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const HOURLY_RATE = 80;

/* ── Geometry estimation from perimeter ── */

function estimateLengths(P: number, roofType: RoofType) {
  let faitiere: number;
  let hanches: number;
  let noues: number;

  switch (roofType) {
    case '2pans':
      faitiere = 0.35 * P;
      hanches = 0;
      noues = 0;
      break;
    case '4pans':
      faitiere = 0.20 * P;
      hanches = 0.50 * P;
      noues = 0;
      break;
    case '4pans_plus':
      faitiere = 0.18 * P;
      hanches = 0.55 * P;
      noues = 0.10 * P;
      break;
  }

  // Safety limits
  const failiereMax = 0.60 * P;
  const nouesMax = 0.25 * P;
  faitiere = Math.min(faitiere, failiereMax);
  noues = Math.min(noues, nouesMax);

  return { faitiere, hanches, noues };
}

/* ── Main calculator ── */

export function computeDynastyQuote(
  areaSqft: number,
  perimeterFt: number,
  vision: VisionResult,
): DynastyQuote {
  const { slope_category, roof_type, confidence } = vision;
  const slopeFactor = SLOPE_FACTORS[slope_category];

  // Surface
  const surfaceCorrected = areaSqft * slopeFactor;
  const surfaceDisplayed = surfaceCorrected * (1 + CONT_RATE_AREA);

  // Lengths
  const { faitiere, hanches, noues } = estimateLengths(perimeterFt, roof_type);

  // ── Material quantities ──

  // 4.1 Bardeaux Dynasty
  const bardPackages = Math.round(surfaceDisplayed / 33.3);
  const bardRate = 0; // price TBD per product
  // We'll use a generic approach: rate will be filled from product price

  // 4.2 Hip & Ridge
  const hipPackages = Math.ceil((faitiere / 26.5) * 1.20);

  // 4.3 Bardeaux de départ (Starter)
  const starterPackages = Math.ceil((perimeterFt / 123) * 1.20);

  // 4.4 Membrane glace & eau
  const membraneRolls = Math.ceil((perimeterFt / 65) * 1.25);

  // 4.5 Sous-couche Stormtite
  const underlayRolls = Math.ceil(surfaceDisplayed / 1000);

  // 4.6 Noues métal (si 4pans_plus)
  const nouesPieces = roof_type === '4pans_plus' ? Math.ceil(noues / 8) : 0;

  // 4.7 Clous
  const nailQty = Math.ceil(surfaceDisplayed / 1500);
  const nailRate = 38;
  const nailTotal = nailRate * nailQty;

  // 4.8 Déchets
  const wasteTons = Math.ceil((surfaceDisplayed * 2.58) / 2240);
  const wasteContainers = Math.ceil((wasteTons / 3) * 1.20);
  const wasteTotal = wasteContainers * 250;

  // ── Labor ──

  // 5.1 Arrachage
  const tearoffTotal = surfaceDisplayed * 0.65;
  const tearoffHours = tearoffTotal / HOURLY_RATE;

  // 5.2 Pose
  const installTotal = 1.55 * surfaceDisplayed;
  const installHours = installTotal / HOURLY_RATE;

  // ── Build line items ──
  // Rates are per-unit costs. For materials we use market prices.
  const lines: QuoteLine[] = [
    { description: 'Arrachage', quantity: parseFloat(tearoffHours.toFixed(1)), unit: 'heures', rate: HOURLY_RATE, total_base: tearoffTotal, ratio: 0, total_displayed: 0 },
    { description: 'Pose', quantity: parseFloat(installHours.toFixed(1)), unit: 'heures', rate: HOURLY_RATE, total_base: installTotal, ratio: 0, total_displayed: 0 },
    { description: 'Bardeaux Dynasty', quantity: bardPackages, unit: 'paquets', rate: parseFloat((surfaceDisplayed > 0 ? tearoffTotal / bardPackages : 0).toFixed(2)), total_base: 0, ratio: 0, total_displayed: 0 },
    { description: 'Hip & Ridge', quantity: hipPackages, unit: 'paquets', rate: 65, total_base: hipPackages * 65, ratio: 0, total_displayed: 0 },
    { description: 'Bardeaux de départ', quantity: starterPackages, unit: 'paquets', rate: 55, total_base: starterPackages * 55, ratio: 0, total_displayed: 0 },
    { description: 'Membrane glace & eau', quantity: membraneRolls, unit: 'rouleaux', rate: 135, total_base: membraneRolls * 135, ratio: 0, total_displayed: 0 },
    { description: 'Sous-couche Stormtite', quantity: underlayRolls, unit: 'rouleaux', rate: 95, total_base: underlayRolls * 95, ratio: 0, total_displayed: 0 },
    { description: 'Clous', quantity: nailQty, unit: 'boîtes', rate: nailRate, total_base: nailTotal, ratio: 0, total_displayed: 0 },
    { description: 'Conteneurs déchets', quantity: wasteContainers, unit: '20V', rate: 250, total_base: wasteTotal, ratio: 0, total_displayed: 0 },
    { description: 'Livraison', quantity: 1, unit: 'forfait', rate: 350, total_base: 350, ratio: 0, total_displayed: 0 },
  ];

  // Bardeaux Dynasty: price from product (we use price_per_sqft × surface / packages as rate)
  // For now use a standard rate of ~$90/paquet (will be overridden by caller)
  lines[2].rate = 90;
  lines[2].total_base = bardPackages * 90;

  // Add noues métal if applicable
  if (nouesPieces > 0) {
    lines.splice(7, 0, {
      description: 'Noues métal 8\'',
      quantity: nouesPieces,
      unit: 'pièces',
      rate: 45,
      total_base: nouesPieces * 45,
      ratio: 0,
      total_displayed: 0,
    });
  }

  // ── Subtotal base ──
  const subtotalBase = lines.reduce((sum, l) => sum + l.total_base, 0);

  // ── Hidden contingency (10%) ──
  const contingency = subtotalBase * CONTINGENCY_RATE;

  // ── Distribute contingency proportionally ──
  for (const line of lines) {
    line.ratio = subtotalBase > 0 ? line.total_base / subtotalBase : 0;
    line.total_displayed = line.total_base + (line.ratio * contingency);
  }

  const subtotalDisplayed = lines.reduce((sum, l) => sum + l.total_displayed, 0);

  // ── Taxes ──
  const tps = TPS_RATE * subtotalDisplayed;
  const tvq = TVQ_RATE * subtotalDisplayed;
  const totalFinal = subtotalDisplayed + tps + tvq;

  return {
    area_sqft: areaSqft,
    perimeter_ft: perimeterFt,
    slope_category,
    roof_type,
    confidence,
    slope_factor: slopeFactor,
    surface_corrected: surfaceCorrected,
    surface_displayed: surfaceDisplayed,
    length_faitiere: faitiere,
    length_hanches: hanches,
    length_noues: noues,
    lines,
    subtotal_base: subtotalBase,
    contingency,
    subtotal_displayed: subtotalDisplayed,
    tps,
    tvq,
    total_final: totalFinal,
    low_confidence: confidence < 0.55,
  };
}

/* ── Fallback vision result (when AI fails) ── */
export const FALLBACK_VISION: VisionResult = {
  slope_category: 'moderee',
  roof_type: '4pans',
  confidence: 0.30,
  reasoning_short: 'Fallback par défaut — analyse non disponible.',
};

/* ── Map old slope labels to new categories ── */
export function mapSlopeToCategory(slope: string): SlopeCategory {
  const s = slope.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s === 'flat' || s.includes('plat') || s.includes('aucune') || s === '4-7') return 'aucune';
  if (s.includes('legere') || s === '7-9') return 'legere';
  if (s.includes('moderee') || s.includes('modere') || s === '9-12') return 'moderee';
  if (s.includes('abrupte') || s === '12+') return 'abrupte';
  return 'moderee';
}

/* ── Map AI roof type string to enum ── */
export function mapRoofType(raw: string): RoofType {
  if (/\bplat\b|flat|membrane/i.test(raw)) return 'plat';
  if (/4\s*pans?\s*et\s*\+|4pans_plus/i.test(raw)) return '4pans_plus';
  if (/4\s*pans|4pans/i.test(raw)) return '4pans';
  if (/2\s*pans|2pans/i.test(raw)) return '2pans';
  return '4pans'; // default
}
