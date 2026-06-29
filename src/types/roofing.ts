export interface ClientInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface AddressInfo {
  formatted_address: string;
  place_id: string;
  lat: number;
  lng: number;
}

export type CoverageType =
  | 'membrane_elastomere'
  | 'membrane_gravier'
  | 'shingle_4pans'
  | 'shingle_2pans'
  | 'shingle_4pans_plus'
  | 'tole_4pans'
  | 'tole_2pans'
  | 'tole_4pans_plus';

/** Map coverage type to product category for product filtering */
export function coverageToCategory(ct: CoverageType): 'sbs' | 'shingle' {
  if (ct === 'membrane_elastomere' || ct === 'membrane_gravier') return 'sbs';
  return 'shingle';
}

export type ComplexityLevel = 'simple' | 'moyenne' | 'complexe' | 'tres_complexe';

export const COMPLEXITY_FACTORS: Record<ComplexityLevel, number> = {
  simple: 1.0,
  moyenne: 1.12,
  complexe: 1.25,
  tres_complexe: 1.4,
};

export type SlopeLevel = 'flat' | '4-7' | '7-9' | '9-12' | '12+';

export const SLOPE_FACTORS: Record<SlopeLevel, number> = {
  'flat': 1.0,
  '4-7': 1.0,
  '7-9': 1.1,
  '9-12': 1.2,
  '12+': 1.35,
};

export type AreaUnit = 'sqft' | 'sqm';

export interface Product {
  id: string;
  category: 'shingle' | 'sbs';
  name: string;
  brand: string;
  price_per_sqft: number;
  colors: string[];
}

export type ContactPreference = 'email' | 'sms';

export type WorkType = 'remplacement' | 'reparations' | 'inspection' | 'nouvelle_construction' | 'autre';

export interface RepairMessage {
  role: 'user' | 'assistant';
  content: string;
  photos?: string[]; // data URLs
}

export interface FormData {
  client: ClientInfo;
  address: AddressInfo | null;
  coverageType: CoverageType | null;
  complexity: ComplexityLevel | null;
  slope: SlopeLevel | null;
  area: number;
  areaUnit: AreaUnit;
  product: Product | null;
  color: string;
  contactPreference: ContactPreference;
  workType: WorkType | null;
  repairMessages: RepairMessage[];
  repairPhotos: string[]; // data URLs of uploaded photos
  constructionPlans: string[]; // data URLs of uploaded plan files (PDF/PNG)
  projectDetails: string; // free-text project description (nouvelle construction)
  // Optional, non-destructive roof-takeoff carriers (Phase 1A). Type-only,
  // populated by the takeoff projection (toFormDataPatch); absent everywhere
  // today so existing behaviour is unchanged.
  roofTakeoff?: import('@/lib/roof-takeoff/types').RoofTakeoff;
  roofModel?: import('@/lib/roof-core/types').RoofModel;
  // Vague A2 — autofill MAMH. Tous nullable + optionnels = backward-compat
  // total avec les soumissions existantes. Persistés dans la table
  // `soumissions` via les colonnes ajoutées par la migration
  // 20260607_soumissions_mamh_columns.sql.
  year_built?: number | null;
  dwelling_count?: number | null;
  floor_count?: number | null;
  mamh_data_source?: string | null;
}

export interface Estimation {
  base: number;
  subtotal: number;
  mobilisation: number;
  low_estimate: number;
  high_estimate: number;
  factors: {
    complexity: number;
    slope: number;
  };
}

export const MOBILISATION = 350;

export function computeEstimation(
  areaSqft: number,
  pricePerSqft: number,
  complexityFactor: number,
  slopeFactor: number
): Estimation {
  const base = areaSqft * pricePerSqft;
  const subtotal = base * complexityFactor * slopeFactor;
  const mobilisation = MOBILISATION;
  const low_estimate = subtotal * 0.93 + mobilisation;
  const high_estimate = subtotal * 1.1 + mobilisation;
  return {
    base,
    subtotal,
    mobilisation,
    low_estimate,
    high_estimate,
    factors: { complexity: complexityFactor, slope: slopeFactor },
  };
}

export function sqmToSqft(sqm: number): number {
  return sqm * 10.7639;
}

export const initialFormData: FormData = {
  client: { firstName: '', lastName: '', email: '', phone: '' },
  address: null,
  coverageType: null,
  complexity: 'moyenne',
  slope: null,
  area: 0,
  areaUnit: 'sqft',
  product: null,
  color: '',
  contactPreference: 'email',
  workType: null,
  repairMessages: [],
  repairPhotos: [],
  constructionPlans: [],
  projectDetails: '',
};
