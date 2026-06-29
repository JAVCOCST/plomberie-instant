// Moteur d'estimation transparent pour le module d'appel (UX + calculs affichés).
// Aucune écriture, aucun modèle de données — pure fonction.

export const SQFT_PER_M2 = 10.7639;
// Calibration Dynasty validée sur chantiers réels : ~82 $/m² d'empreinte, taxes incl.
export const CALIB_PER_M2 = 82;
// Équivalent en pi² d'empreinte (affichage 100 % pi²).
export const CALIB_PER_SQFT = CALIB_PER_M2 / SQFT_PER_M2;
// Toit plat (membrane) : tarif au pi² de toiture (≈ empreinte), pas la calibration générique.
export const FLAT_LOW = 11;
export const FLAT_MID = 12;
export const FLAT_HIGH = 13;

// Facteur "forme" (complexité / pertes de coupe).
export const SHAPE_FACTOR: Record<string, number> = {
  plat: 1.0,
  '2pans': 1.03,
  '4pans': 1.05,
  '4pans_plus': 1.08,
  complexe: 1.12,
};
// Facteur "pente" (développé du versant).
export const SLOPE_FACTOR: Record<string, number> = {
  aucune: 1.0,
  faible: 1.06,
  moderee: 1.12,
  forte: 1.25,
};

export const FORM_LABEL: Record<string, string> = {
  '2pans': '2 versants',
  '4pans': '4 versants',
  '4pans_plus': '4 versants et plus',
  plat: 'Toit plat',
  complexe: 'Complexe',
};
export const MATERIAL_LABEL: Record<string, string> = {
  bardeau_asphalte: "Bardeau d'asphalte",
  bardeau: 'Bardeau',
  tole: 'Tôle',
  membrane: 'Membrane',
};
export const PITCH_LABEL: Record<string, string> = {
  aucune: 'Aucune (plat)',
  faible: 'Faible',
  moderee: 'Moyenne',
  forte: 'Forte',
};

export interface EstimateInput {
  footprint_m2: number | null;
  roof_form: string | null;
  pitch: string | null;
  price_estimated?: number | null;
}
export interface EstimateResult {
  footprint_m2: number;
  footprint_sqft: number;
  forme_factor: number;
  pente_factor: number;
  roof_sqft: number;
  price_total: number;
  price_per_sqft: number;
  budget_low: number;
  budget_high: number;
  is_flat: boolean;
}

export function computeEstimate(i: EstimateInput): EstimateResult {
  const fm2 = i.footprint_m2 ?? 0;
  const fsqft = fm2 * SQFT_PER_M2;
  const ff = SHAPE_FACTOR[i.roof_form ?? ''] ?? 1.05;
  let pf = SLOPE_FACTOR[i.pitch ?? ''] ?? 1.12;
  // Toit plat : aucune développée de pente, quelle que soit la pente saisie.
  const isFlat = i.roof_form === 'plat';
  if (isFlat) pf = 1.0;
  const roof = fsqft * ff * pf;

  let price_total: number;
  let price_per_sqft: number;
  let budget_low: number;
  let budget_high: number;
  if (isFlat) {
    // Membrane : 11–13 $/pi² de toiture.
    price_per_sqft = FLAT_MID;
    price_total = roof * FLAT_MID;
    budget_low = roof * FLAT_LOW;
    budget_high = roof * FLAT_HIGH;
  } else {
    price_total = i.price_estimated != null && i.price_estimated > 0 ? i.price_estimated : fm2 * CALIB_PER_M2;
    price_per_sqft = roof > 0 ? price_total / roof : 0;
    budget_low = price_total * 0.75;
    budget_high = price_total * 1.3;
  }

  return {
    footprint_m2: fm2,
    footprint_sqft: fsqft,
    forme_factor: ff,
    pente_factor: pf,
    roof_sqft: roof,
    price_total,
    price_per_sqft,
    budget_low,
    budget_high,
    is_flat: isFlat,
  };
}

export type ConfLevel = 'élevée' | 'moyenne' | 'faible';
export function confLevel(pct: number): ConfLevel {
  if (pct >= 75) return 'élevée';
  if (pct >= 40) return 'moyenne';
  return 'faible';
}
export function confColor(level: ConfLevel): string {
  return level === 'élevée'
    ? 'text-emerald-400'
    : level === 'moyenne'
    ? 'text-amber-400'
    : 'text-red-400';
}
