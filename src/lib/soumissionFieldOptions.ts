/**
 * Source de vérité unique pour les options des champs d'une soumission.
 *
 * Partagé par le tableau de bord (LeadDetailBody / AdminDashboard), le suivi
 * de projet (Gantt) et l'éditeur de soumission privé (AdminQuoteGenerator),
 * afin que les MÊMES champs et les MÊMES valeurs apparaissent partout et
 * restent synchronisés (les colonnes Supabase stockent ces `value`).
 */

export type Option = { value: string; label: string };

export const ROOF_CATEGORY_OPTIONS: Option[] = [
  { value: 'residential', label: 'Résidentiel' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industriel' },
  { value: 'institutional', label: 'Institutionnel' },
];

export const BUILDING_TYPE_OPTIONS: Option[] = [
  { value: 'unifamiliale', label: 'Unifamiliale' },
  { value: 'duplex', label: 'Duplex' },
  { value: 'triplex', label: 'Triplex' },
  { value: 'multiplex', label: 'Multiplex' },
  { value: 'condo', label: 'Condo' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'other', label: 'Autre' },
];

export const WORK_TYPE_OPTIONS: Option[] = [
  { value: 'remplacement', label: 'Remplacement' },
  { value: 'reparations', label: 'Réparations' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'nouvelle_construction', label: 'Construction' },
  { value: 'autre', label: 'Autre' },
];

export const COMPLEXITY_OPTIONS: Option[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'moderate', label: 'Modérée' },
  { value: 'complex', label: 'Complexe' },
  { value: 'tres_complexe', label: 'Très complexe' },
];

export const BRAND_OPTIONS: Option[] = [
  { value: 'IKO', label: 'IKO' },
  { value: 'BP', label: 'BP' },
];

export const CONTACT_PREFERENCE_OPTIONS: Option[] = [
  { value: 'email', label: 'Courriel' },
  { value: 'sms', label: 'SMS' },
  { value: 'phone', label: 'Téléphone' },
];

export const COVERAGE_FR: Record<string, string> = {
  shingle_2pans: 'Bardeaux – 2 versants', shingle_4pans: 'Bardeaux – 4 versants',
  shingle_4pans_plus: 'Bardeaux – 4+ versants', membrane_elastomere: 'Membrane élastomère',
  membrane_gravier: 'Membrane gravier', tole_2pans: 'Tôle – 2 versants',
  tole_4pans: 'Tôle – 4 versants', tole_4pans_plus: 'Tôle – 4+ versants',
  shingle: 'Bardeaux', sbs: 'Membrane / SBS',
};

export const SLOPE_FR: Record<string, string> = {
  '4-7': 'FAIBLE 4/12-5/12', '7-9': 'MOY 6/12-7/12',
  '9-12': 'ELEVEE 8/12-9/12', '12+': 'TRES ELEVEE 10/12-12/12',
};

export const PRODUCTS_BY_BRAND: Record<string, string[]> = {
  IKO: ['Cambridge', 'Dynasty', 'Nordic', 'Royal Estate'],
  BP: ['Mystique', 'Signature', 'Vangard', 'Dakota'],
};

export const COLORS_BY_PRODUCT: Record<string, string[]> = {
  Cambridge: ['Dual Black', 'Weatherwood', 'Charcoal Grey', 'Driftwood', 'Dual Grey', 'Dual Brown', 'Earthtone Cedar', 'Harvard Slate'],
  Dynasty: ['Granite Black', 'Graphite Black', 'Matte Black', 'Shadow Brown', 'Summit Grey', 'Atlantic Blue', 'Glacier', 'Cornerstone Weatherwood', 'Biscayne', 'Monaco Red', 'Frostone Grey', 'Emerald Green', 'Driftshake', 'Brownstone', 'Sentinel Slate', 'Olde Style Weatherwood'],
  Nordic: ['Granite Black', 'Shadow Brown', 'Summit Grey', 'Glacier', 'Driftshake', 'Olde Style Weatherwood', 'Brownstone', 'Cornerstone Weatherwood', 'Frostone Grey'],
  'Royal Estate': ['Harvest Slate', 'Mountain Slate', 'Shadow Slate', 'Taupe Slate'],
  Mystique: ['Gris Ardoise', 'Cèdre Rustique', 'Brun Classique', 'Bois Champêtre', 'Ardoise Antique', 'Brun 2 tons', 'Noir 2 tons', 'Brume Matinale', 'Sangria'],
  Signature: ['Arabica', 'Mesquite', 'Cumin', 'Fjord', 'Criollo', 'Dublin', 'Cortina', 'Muskoka', 'Newport', 'Quinoa', 'Soho', 'Toscana'],
  Vangard: ['Noir céleste', 'Gris argenté', 'Gris lunaire', 'Galet', 'Brun automnal'],
  Dakota: ['Gris ardoise', 'Brun 2 tons', 'Noir 2 tons'],
};
