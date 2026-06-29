import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CREDIT_OPTIONS, CreditQuality, MAX_AMOUNT, TERMS_MONTHS, TermMonths,
  calculerPaiement, minAmountForTerm, rateFor,
} from './financing';
import { useQuoteAmountStore } from './quote-amount-store';

const LS_KEY = 'javco_finance_calc_v1';

interface PersistedState { montant: number; nbMois: TermMonths; credit: CreditQuality }

function readPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.montant !== 'number' || !TERMS_MONTHS.includes(p.nbMois) || !CREDIT_OPTIONS.some(o => o.value === p.credit)) return null;
    return p as PersistedState;
  } catch { return null; }
}

export function useFinancingCalculator() {
  const quoteAmount = useQuoteAmountStore(s => s.amount);

  // Au premier chargement : (1) lit le localStorage si présent ; (2) sinon
  // pré-remplit avec le total du devis courant s'il est dans la plage ;
  // (3) sinon défaut 10 000 $.
  const [state, setState] = useState<PersistedState>(() => {
    const persisted = readPersisted();
    if (persisted) return persisted;
    const fromQuote = quoteAmount != null && quoteAmount >= 500 && quoteAmount <= MAX_AMOUNT
      ? Math.round(quoteAmount) : null;
    return { montant: fromQuote ?? 10000, nbMois: 60, credit: 'good' };
  });

  // Si l'utilisateur ouvre la sidebar AVANT que la page ait publié son total,
  // on rattrape ce premier total reçu si le user n'a encore rien modifié.
  const userTouchedRef = useRef(false);
  useEffect(() => {
    if (userTouchedRef.current) return;
    if (readPersisted()) return;                  // on respecte la persistance
    if (quoteAmount == null) return;
    if (quoteAmount < 500 || quoteAmount > MAX_AMOUNT) return;
    setState(s => ({ ...s, montant: Math.round(quoteAmount) }));
  }, [quoteAmount]);

  // Persistance.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  const minMontant = minAmountForTerm(state.nbMois);
  const adjustedAmount = useMemo(() => {
    // Auto-correction du montant en dessous du minimum requis par la durée.
    return Math.max(minMontant, Math.min(MAX_AMOUNT, state.montant || 0));
  }, [state.montant, minMontant]);
  const amountAdjusted = adjustedAmount !== state.montant;

  const taux = rateFor(state.credit);
  const result = useMemo(
    () => calculerPaiement({ montant: adjustedAmount, nbMois: state.nbMois, tauxAnnuel: taux }),
    [adjustedAmount, state.nbMois, taux],
  );

  return {
    state,
    minMontant,
    adjustedAmount,
    amountAdjusted,
    result,
    setMontant: (n: number) => { userTouchedRef.current = true; setState(s => ({ ...s, montant: n })); },
    setNbMois: (m: TermMonths) => { userTouchedRef.current = true; setState(s => ({ ...s, nbMois: m })); },
    setCredit: (c: CreditQuality) => { userTouchedRef.current = true; setState(s => ({ ...s, credit: c })); },
  };
}
