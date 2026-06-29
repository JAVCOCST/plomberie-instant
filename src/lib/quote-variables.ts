import type { SmartVariable, SmartVariableValues } from '@/components/SmartTextEditor';

/** Catalogue partagé des variables disponibles dans les éditeurs (email, notes, terms, lignes, contrats). */
export const QUOTE_VARIABLE_DEFS: SmartVariable[] = [
  // Client
  { key: 'client_name',    label: 'Nom complet',  category: 'Client', sample: 'Jean Tremblay' },
  { key: 'client_first',   label: 'Prénom',       category: 'Client', sample: 'Jean' },
  { key: 'client_last',    label: 'Nom',          category: 'Client', sample: 'Tremblay' },
  { key: 'client_company', label: 'Compagnie',    category: 'Client', sample: 'Construction ABC' },
  { key: 'client_email',   label: 'Courriel',     category: 'Client', sample: 'client@exemple.com' },
  { key: 'client_phone',   label: 'Téléphone',    category: 'Client', sample: '514-555-0000' },
  { key: 'address',        label: 'Adresse',      category: 'Client', sample: '123 rue Principale, Montréal' },

  // Produit
  { key: 'marque',          label: 'Marque',          category: 'Produit', sample: 'IKO' },
  { key: 'gamme',           label: 'Gamme',           category: 'Produit', sample: 'Cambridge' },
  { key: 'couleur',         label: 'Couleur',         category: 'Produit', sample: 'Driftwood' },
  { key: 'type_couverture', label: 'Type couverture', category: 'Produit', sample: 'Bardeau d\u2019asphalte' },
  { key: 'pente',           label: 'Pente',           category: 'Produit', sample: 'Moyenne' },

  // Mesures
  { key: 'area_sqft',  label: 'Superficie (pi²)',  category: 'Mesures', numeric: true, sample: '1850' },
  { key: 'superficie', label: 'Superficie format', category: 'Mesures', sample: '1 850 pi²' },
  { key: 'perimetre',  label: 'Périmètre (pi)',    category: 'Mesures', numeric: true, sample: '180' },

  // Financier
  { key: 'subtotal',   label: 'Sous-total ($)',    category: 'Financier', numeric: true, sample: '12500' },
  { key: 'total',      label: 'Total ($)',         category: 'Financier', numeric: true, sample: '14375.94' },
  { key: 'depot',      label: 'Dépôt 30%',         category: 'Financier', numeric: true, sample: '4312.78' },
  { key: 'reference',  label: '# Référence',       category: 'Financier', sample: 'VB-1043' },
];

/** Construit l'objet de valeurs à partir de l'état du générateur. */
export interface BuildValuesInput {
  clientFirst?: string;
  clientLast?: string;
  clientCompany?: string;
  clientEmail?: string;
  clientPhone?: string;
  addressText?: string;
  selectedMarque?: string;
  selectedGamme?: string;
  color?: string;
  coverageType?: string;
  slopeCategory?: string;
  effectiveAreaSqft?: number;
  perimeterFt?: number;
  subtotal?: number;
  total?: number;
  loadedSeqNumber?: number | null;
}

export const buildQuoteValues = (i: BuildValuesInput): SmartVariableValues => {
  const fmtMoney = (n?: number) => (typeof n === 'number'
    ? n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $'
    : '—');
  const fmtInt = (n?: number) => (typeof n === 'number' ? Math.round(n).toLocaleString('fr-CA') : '—');
  const total = i.total || 0;
  return {
    client_name: `${i.clientFirst || ''} ${i.clientLast || ''}`.trim() || i.clientCompany || '—',
    client_first: i.clientFirst || '',
    client_last: i.clientLast || '',
    client_company: i.clientCompany || '',
    client_email: i.clientEmail || '',
    client_phone: i.clientPhone || '',
    address: i.addressText || '—',
    marque: i.selectedMarque || '—',
    gamme: i.selectedGamme || '—',
    couleur: i.color || '—',
    type_couverture: i.coverageType || '—',
    pente: i.slopeCategory || '—',
    area_sqft: i.effectiveAreaSqft || 0,
    superficie: i.effectiveAreaSqft ? `${fmtInt(i.effectiveAreaSqft)} pi²` : '—',
    perimetre: i.perimeterFt || 0,
    subtotal: i.subtotal || 0,
    total,
    depot: total * 0.3,
    reference: i.loadedSeqNumber ? `VB-${i.loadedSeqNumber}` : '—',
  };
};