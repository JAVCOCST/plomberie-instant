/**
 * Pricing Matrix Calculator — Hardcoded pricing data
 * 
 * Computes low/high estimates based on coverage type, slope,
 * work type, and building footprint area.
 * Formula: price_footprint × superficie_au_sol (pi²)
 */

import type { CoverageType, SlopeLevel } from '@/types/roofing';

/* ── Types ── */

export type MatrixWorkType = 'refection' | 'nouvelle_couverture';

export interface PricingRow {
  work_type: string;
  material: string;
  roof_subtype: string;
  slope_label: string;
  slope_coeff: number | null;
  price_roof_low: number | null;
  price_roof_high: number | null;
  price_footprint_low: number | null;
  price_footprint_high: number | null;
}

export interface MatrixEstimate {
  price_per_sqft_low: number;
  price_per_sqft_high: number;
  slope_coeff: number;
  low_estimate: number;
  high_estimate: number;
  footprint_sqft: number;
  work_type: MatrixWorkType;
  roof_subtype: string;
  slope_label: string;
}

/* ── Mappings ── */

const COVERAGE_TO_SUBTYPE: Record<CoverageType, string> = {
  shingle_2pans: 'bardeaux_2v',
  shingle_4pans: 'bardeaux_4v',
  shingle_4pans_plus: 'bardeaux_4v_plus',
  tole_2pans: 'tole_2v',
  tole_4pans: 'tole_2v',
  tole_4pans_plus: 'tole_4v_plus',
  membrane_elastomere: 'membrane_sbs',
  membrane_gravier: 'membrane_gravier',
};

const SLOPE_TO_LABEL: Record<SlopeLevel, string> = {
  'flat': 'PLAT 0/12-2/12',
  '4-7': 'FAIBLE 4/12-5/12',
  '7-9': 'MOY 6/12-7/12',
  '9-12': 'ELEVEE 8/12-9/12',
  '12+': 'TRES ELEVEE 10/12-12/12',
};

/* ── Slope coefficients ── */
const SLOPE_COEFFS: Record<string, number> = {
  'FAIBLE 4/12-5/12': 1.00,
  'MOY 6/12-7/12': 1.12,
  'ELEVEE 8/12-9/12': 1.32,
  'TRES ELEVEE 10/12-12/12': 1.58,
  'Aucune': 1.05,
};

/* ── Hardcoded pricing matrix ── */
// key: `${work_type}|${roof_subtype}|${slope_label}`
// value: [price_footprint_low, price_footprint_high]

const PRICE_MAP: Record<string, [number, number]> = {
  // ═══════════════════════════════════════════
  // REFECTION — BARDEAUX
  // ═══════════════════════════════════════════
  'refection|bardeaux_2v|FAIBLE 4/12-5/12':        [8.50, 10.50],
  'refection|bardeaux_2v|MOY 6/12-7/12':           [9.52, 11.76],
  'refection|bardeaux_2v|ELEVEE 8/12-9/12':        [11.22, 13.86],
  'refection|bardeaux_2v|TRES ELEVEE 10/12-12/12': [13.43, 16.59],

  'refection|bardeaux_4v|FAIBLE 4/12-5/12':        [10.00, 12.00],
  'refection|bardeaux_4v|MOY 6/12-7/12':           [11.20, 13.44],
  'refection|bardeaux_4v|ELEVEE 8/12-9/12':        [13.20, 15.84],
  'refection|bardeaux_4v|TRES ELEVEE 10/12-12/12': [15.80, 18.96],

  'refection|bardeaux_2v_plus|FAIBLE 4/12-5/12':        [10.50, 12.50],
  'refection|bardeaux_2v_plus|MOY 6/12-7/12':           [11.76, 14.00],
  'refection|bardeaux_2v_plus|ELEVEE 8/12-9/12':        [13.86, 16.50],
  'refection|bardeaux_2v_plus|TRES ELEVEE 10/12-12/12': [16.59, 19.75],

  'refection|bardeaux_4v_plus|FAIBLE 4/12-5/12':        [14.04, 17.00],
  'refection|bardeaux_4v_plus|MOY 6/12-7/12':           [15.72, 19.04],
  'refection|bardeaux_4v_plus|ELEVEE 8/12-9/12':        [18.53, 22.44],
  'refection|bardeaux_4v_plus|TRES ELEVEE 10/12-12/12': [22.18, 26.86],

  // ═══════════════════════════════════════════
  // REFECTION — TOLE
  // ═══════════════════════════════════════════
  'refection|tole_2v|FAIBLE 4/12-5/12':        [20.00, 25.00],
  'refection|tole_2v|MOY 6/12-7/12':           [22.40, 28.00],
  'refection|tole_2v|ELEVEE 8/12-9/12':        [26.40, 33.00],
  'refection|tole_2v|TRES ELEVEE 10/12-12/12': [31.60, 39.50],

  'refection|tole_4v_plus|FAIBLE 4/12-5/12':        [27.92, 33.00],
  'refection|tole_4v_plus|MOY 6/12-7/12':           [31.27, 36.96],
  'refection|tole_4v_plus|ELEVEE 8/12-9/12':        [36.85, 43.56],
  'refection|tole_4v_plus|TRES ELEVEE 10/12-12/12': [44.11, 52.14],

  // ═══════════════════════════════════════════
  // REFECTION — MEMBRANES (pas de pente)
  // ═══════════════════════════════════════════
  'refection|membrane_sbs|Aucune':     [18.18, 23.10],
  'refection|membrane_gravier|Aucune': [15.75, 21.00],

  // ═══════════════════════════════════════════
  // NOUVELLE COUVERTURE — BARDEAUX
  // ═══════════════════════════════════════════
  'nouvelle_couverture|bardeaux_2v|FAIBLE 4/12-5/12':        [6.50, 8.50],
  'nouvelle_couverture|bardeaux_2v|MOY 6/12-7/12':           [7.28, 9.52],
  'nouvelle_couverture|bardeaux_2v|ELEVEE 8/12-9/12':        [8.58, 11.22],
  'nouvelle_couverture|bardeaux_2v|TRES ELEVEE 10/12-12/12': [10.27, 13.43],

  'nouvelle_couverture|bardeaux_4v|FAIBLE 4/12-5/12':        [8.00, 10.00],
  'nouvelle_couverture|bardeaux_4v|MOY 6/12-7/12':           [8.96, 11.20],
  'nouvelle_couverture|bardeaux_4v|ELEVEE 8/12-9/12':        [10.56, 13.20],
  'nouvelle_couverture|bardeaux_4v|TRES ELEVEE 10/12-12/12': [12.64, 15.80],

  'nouvelle_couverture|bardeaux_2v_plus|FAIBLE 4/12-5/12':        [8.50, 10.50],
  'nouvelle_couverture|bardeaux_2v_plus|MOY 6/12-7/12':           [9.52, 11.76],
  'nouvelle_couverture|bardeaux_2v_plus|ELEVEE 8/12-9/12':        [11.22, 13.86],
  'nouvelle_couverture|bardeaux_2v_plus|TRES ELEVEE 10/12-12/12': [13.43, 16.59],

  'nouvelle_couverture|bardeaux_4v_plus|FAIBLE 4/12-5/12':        [12.00, 15.00],
  'nouvelle_couverture|bardeaux_4v_plus|MOY 6/12-7/12':           [13.44, 16.80],
  'nouvelle_couverture|bardeaux_4v_plus|ELEVEE 8/12-9/12':        [15.84, 19.80],
  'nouvelle_couverture|bardeaux_4v_plus|TRES ELEVEE 10/12-12/12': [18.96, 23.70],

  // ═══════════════════════════════════════════
  // NOUVELLE COUVERTURE — TOLE
  // ═══════════════════════════════════════════
  'nouvelle_couverture|tole_2v|FAIBLE 4/12-5/12':        [18.00, 23.00],
  'nouvelle_couverture|tole_2v|MOY 6/12-7/12':           [20.16, 25.76],
  'nouvelle_couverture|tole_2v|ELEVEE 8/12-9/12':        [23.76, 30.36],
  'nouvelle_couverture|tole_2v|TRES ELEVEE 10/12-12/12': [28.44, 36.34],

  'nouvelle_couverture|tole_4v_plus|FAIBLE 4/12-5/12':        [25.00, 30.00],
  'nouvelle_couverture|tole_4v_plus|MOY 6/12-7/12':           [28.00, 33.60],
  'nouvelle_couverture|tole_4v_plus|ELEVEE 8/12-9/12':        [33.00, 39.60],
  'nouvelle_couverture|tole_4v_plus|TRES ELEVEE 10/12-12/12': [39.50, 47.40],

  // ═══════════════════════════════════════════
  // NOUVELLE COUVERTURE — MEMBRANES (pas de pente)
  // ═══════════════════════════════════════════
  'nouvelle_couverture|membrane_sbs|Aucune':     [14.70, 18.90],
  'nouvelle_couverture|membrane_gravier|Aucune': [12.60, 16.80],
};

/* ── Fetch (kept for backward compat but returns hardcoded data) ── */

export async function fetchPricingMatrix(): Promise<PricingRow[]> {
  return getHardcodedMatrix();
}

export function clearPricingCache() {
  // No-op — data is hardcoded
}

function getHardcodedMatrix(): PricingRow[] {
  const rows: PricingRow[] = [];
  for (const [key, [low, high]] of Object.entries(PRICE_MAP)) {
    const [wt, subtype, slopeLabel] = key.split('|');
    const material = subtype.startsWith('bardeaux') ? 'bardeaux'
      : subtype.startsWith('tole') ? 'tole'
      : subtype;
    rows.push({
      work_type: wt,
      material,
      roof_subtype: subtype,
      slope_label: slopeLabel,
      slope_coeff: SLOPE_COEFFS[slopeLabel] ?? 1,
      price_roof_low: null,
      price_roof_high: null,
      price_footprint_low: low,
      price_footprint_high: high,
    });
  }
  return rows;
}

/* ── Main calculator (async) ── */

export async function computeMatrixEstimate(
  coverageType: CoverageType,
  slope: SlopeLevel,
  footprintSqft: number,
  workType: MatrixWorkType = 'refection',
): Promise<MatrixEstimate | null> {
  return computeMatrixEstimateSync(getHardcodedMatrix(), coverageType, slope, footprintSqft, workType);
}

/* ── Sync calculator ── */

export function computeMatrixEstimateSync(
  _matrix: PricingRow[],
  coverageType: CoverageType,
  slope: SlopeLevel,
  footprintSqft: number,
  workType: MatrixWorkType = 'refection',
): MatrixEstimate | null {
  const roofSubtype = COVERAGE_TO_SUBTYPE[coverageType];
  const slopeLabel = SLOPE_TO_LABEL[slope];

  // Membranes always use "Aucune" slope
  const effectiveSlopeLabel = (coverageType === 'membrane_elastomere' || coverageType === 'membrane_gravier')
    ? 'Aucune'
    : slopeLabel;

  const key = `${workType}|${roofSubtype}|${effectiveSlopeLabel}`;
  const prices = PRICE_MAP[key];

  if (!prices) return null;

  const [priceLow, priceHigh] = prices;
  const slopeCoeff = SLOPE_COEFFS[effectiveSlopeLabel] ?? 1;

  return {
    price_per_sqft_low: priceLow,
    price_per_sqft_high: priceHigh,
    slope_coeff: slopeCoeff,
    low_estimate: priceLow * footprintSqft,
    high_estimate: priceHigh * footprintSqft,
    footprint_sqft: footprintSqft,
    work_type: workType,
    roof_subtype: roofSubtype,
    slope_label: effectiveSlopeLabel,
  };
}
