// Garde-fou contre toute dérive future : les 5 cas du brief, vérifiés au cent.
import { describe, it, expect } from 'vitest';
import { amortization, calculerPaiement, rateFor, minAmountForTerm } from './financing';

const round2 = (n: number) => Math.round(n * 100) / 100;
const TOL = 0.01;

describe('calculerPaiement — cas de validation iFinance', () => {
  it.each([
    { montant: 10000, nbMois: 36, credit: 'exceptional' as const, paiement: 341.98,  total: 12311.37, cout: 2311.37 },
    { montant: 33000, nbMois: 36, credit: 'exceptional' as const, paiement: 1128.54, total: 40627.51, cout: 7627.51 },
    { montant: 20000, nbMois: 60, credit: 'good'        as const, paiement: 504.24,  total: 30254.11, cout: 10254.11 },
    { montant: 5000,  nbMois: 24, credit: 'limited'     as const, paiement: 269.72,  total: 6473.32,  cout: 1473.32 },
    { montant: 40000, nbMois: 84, credit: 'verygood'    as const, paiement: 771.11,  total: 64773.14, cout: 24773.14 },
  ])('$montant $ / $nbMois mois / $credit', ({ montant, nbMois, credit, paiement, total, cout }) => {
    const r = calculerPaiement({ montant, nbMois, tauxAnnuel: rateFor(credit) });
    expect(Math.abs(round2(r.paiementMensuel) - paiement)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(round2(r.totalPaiements) - total)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(round2(r.coutDuCredit) - cout)).toBeLessThanOrEqual(TOL);
  });
});

describe('amortization — vérifié contre iFinance_v2.xlsx (33 000 / 36 / exceptional)', () => {
  const rows = amortization({ montant: 33000, nbMois: 36, tauxAnnuel: 9.99 });
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Valeurs prises directement dans le fichier Excel fourni par l'utilisateur.
  it('paiement #1 : intérêts 291,21 $ · capital 837,33 $ · solde 34 142,67 $', () => {
    expect(round2(rows[0].interets)).toBe(291.21);
    expect(round2(rows[0].capital)).toBe(837.33);
    expect(round2(rows[0].soldeRestant)).toBe(34142.67);
  });
  it('paiement #12 : solde restant 24 458,92 $', () => {
    expect(round2(rows[11].soldeRestant)).toBe(24458.92);
  });
  it('paiement final (#36) : solde restant ≈ 0', () => {
    expect(Math.abs(rows[35].soldeRestant)).toBeLessThan(0.02);
  });
  it('somme des paiements ≈ total des paiements PMT', () => {
    const sum = rows.reduce((s, r) => s + r.paiement, 0);
    expect(round2(sum)).toBe(40627.51);
  });
});

describe('minAmountForTerm', () => {
  it('500 $ pour 12-60 mois', () => {
    expect(minAmountForTerm(12)).toBe(500);
    expect(minAmountForTerm(60)).toBe(500);
  });
  it('3 000 $ pour 72 mois', () => { expect(minAmountForTerm(72)).toBe(3000); });
  it('10 000 $ pour 84 mois', () => { expect(minAmountForTerm(84)).toBe(10000); });
});
