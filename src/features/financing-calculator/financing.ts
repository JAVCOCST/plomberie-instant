// Logique de calcul iFinance Canada — copiée telle quelle du JS officiel du
// site (vérifié 2026-05-28) et confirmée par le fichier Excel iFinance_v2.xlsx
// fourni par l'utilisateur. Pure, testable, AUCUN arrondi intermédiaire.

export const MIN_AMOUNT = 500;
export const MAX_AMOUNT = 40000;
export const ADMIN_FEE_RATE = 0.06;            // 6 % de frais d'administration

export const TERMS_MONTHS = [12, 24, 36, 48, 60, 72, 84] as const;
export type TermMonths = typeof TERMS_MONTHS[number];

export type CreditQuality = 'exceptional' | 'verygood' | 'good' | 'fair' | 'limited';

export const CREDIT_OPTIONS: { value: CreditQuality; label: string; rate: number }[] = [
  { value: 'exceptional', label: 'Exceptionnel — 750+',        rate: 9.99 },
  { value: 'verygood',    label: 'Très bon — 700 à 750',       rate: 12.99 },
  { value: 'good',        label: 'Bon — 650 à 700',            rate: 14.99 },
  { value: 'fair',        label: 'Moyen — 600 à 650',          rate: 16.99 },
  { value: 'limited',     label: 'Limité — 525 à 600',         rate: 19.99 },
];

/** Minimum requis selon la durée : 72 mois → 3 000 $, 84 mois → 10 000 $. */
export function minAmountForTerm(months: TermMonths): number {
  if (months === 84) return 10000;
  if (months === 72) return 3000;
  return MIN_AMOUNT;
}

export function rateFor(credit: CreditQuality): number {
  return CREDIT_OPTIONS.find(o => o.value === credit)!.rate;
}

export interface FinancingResult {
  fraisAdmin: number;
  capitalFinance: number;
  paiementMensuel: number;
  totalPaiements: number;
  coutDuCredit: number;
  tauxAnnuel: number;
}

/** PMT sur capital majoré de 6 % de frais admin — formule iFinance officielle. */
export function calculerPaiement(input: {
  montant: number; nbMois: number; tauxAnnuel: number;
}): FinancingResult {
  const { montant, nbMois, tauxAnnuel } = input;
  const fraisAdmin = montant * ADMIN_FEE_RATE;
  const capitalFinance = montant + fraisAdmin;          // = montant * 1.06
  const tauxMensuel = tauxAnnuel / 100 / 12;
  const facteur = Math.pow(1 + tauxMensuel, nbMois);
  const paiementMensuel = (capitalFinance * tauxMensuel * facteur) / (facteur - 1);
  const totalPaiements = paiementMensuel * nbMois;
  const coutDuCredit = totalPaiements - montant;
  return { fraisAdmin, capitalFinance, paiementMensuel, totalPaiements, coutDuCredit, tauxAnnuel };
}

/** Affichage `1 234,56 $` (locale fr-CA, virgule décimale, suffixe $). */
export function formatCAD(n: number, fractionDigits = 2): string {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('fr-CA', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }) + ' $';
}

export function formatPct(n: number): string {
  return n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
}

export interface AmortizationRow {
  i: number;
  paiement: number;
  interets: number;
  capital: number;
  soldeRestant: number;
}

/** Tableau d'amortissement détaillé sur la durée du prêt. Construit comme
 *  dans iFinance_v2.xlsx : Intérêts(i) = soldeRestant(i-1) × tauxMensuel,
 *  Capital(i) = Paiement − Intérêts(i), Solde(i) = Solde(i-1) − Capital(i).
 *  Aucun arrondi intermédiaire (arrondi au cent uniquement à l'affichage). */
export function amortization(input: {
  montant: number; nbMois: number; tauxAnnuel: number;
}): AmortizationRow[] {
  const { paiementMensuel, capitalFinance } = calculerPaiement(input);
  const tauxMensuel = input.tauxAnnuel / 100 / 12;
  const rows: AmortizationRow[] = [];
  let solde = capitalFinance;
  for (let i = 1; i <= input.nbMois; i++) {
    const interets = solde * tauxMensuel;
    const capital = paiementMensuel - interets;
    solde = solde - capital;
    rows.push({ i, paiement: paiementMensuel, interets, capital, soldeRestant: solde });
  }
  return rows;
}
