// Micro-store pour propager le total du devis courant (AdminQuoteGenerator)
// vers la calculatrice de la sidebar. Volontairement minuscule : un seul nombre.
// La page qui calcule un total appelle setQuoteAmount(n) ; la sidebar lit
// `amount` via le hook et l'utilise comme valeur de pré-remplissage si elle
// est dans la plage [500 ; 40000].
import { create } from 'zustand';

interface QuoteAmountState {
  amount: number | null;
  setQuoteAmount: (n: number | null) => void;
}

export const useQuoteAmountStore = create<QuoteAmountState>((set) => ({
  amount: null,
  setQuoteAmount: (n) => set({ amount: n }),
}));
