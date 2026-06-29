// Fenêtre flottante (draggable + resizable) qui estime le paiement mensuel
// pour le montant de la soumission courante. Ouverture depuis l'aperçu de la
// soumission, à droite du bouton « Télécharger la soumission ».
import React, { useMemo, useState } from 'react';
import { Rnd } from 'react-rnd';
import { GripVertical, X } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CREDIT_OPTIONS, CreditQuality, MAX_AMOUNT, TERMS_MONTHS, TermMonths,
  calculerPaiement, formatCAD, formatPct, minAmountForTerm, rateFor,
} from './financing';

const POS_KEY = 'javco_estimate_payment_window_pos_v1';
const APPLY_URL = 'https://apply.ifinancecanada.com/20500?lang=fr';
const DRAG_HANDLE = 'estimate-payment-drag-handle';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Montant à pré-remplir (typiquement quote.total_final). */
  initialAmount?: number | null;
}

const EstimatePaymentWindow: React.FC<Props> = ({ open, onClose, initialAmount }) => {
  const seedAmount = useMemo(() => {
    const v = initialAmount;
    if (v != null && v >= 500 && v <= MAX_AMOUNT) return Math.round(v);
    return 10000;
  }, [initialAmount]);

  const [montant, setMontant] = useState<number>(seedAmount);
  const [nbMois, setNbMois] = useState<TermMonths>(60);
  const [credit, setCredit] = useState<CreditQuality>('good');

  // Position/taille persistées entre les ouvertures.
  const initialBox = useMemo(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.x === 'number' && typeof p.y === 'number' && typeof p.width === 'number' && typeof p.height === 'number') {
          return p;
        }
      }
    } catch { /* ignore */ }
    const W = typeof window !== 'undefined' ? window.innerWidth : 1280;
    return { x: Math.max(20, W - 420), y: 80, width: 380, height: 460 };
  }, []);

  const minMontant = minAmountForTerm(nbMois);
  const adjustedAmount = Math.max(minMontant, Math.min(MAX_AMOUNT, montant || 0));
  const amountAdjusted = adjustedAmount !== montant;
  const outOfRange = montant < minMontant || montant > MAX_AMOUNT;
  const result = calculerPaiement({ montant: adjustedAmount, nbMois, tauxAnnuel: rateFor(credit) });
  const errId = 'estimate-amount-error';

  if (!open) return null;

  return (
    <Rnd
      default={initialBox}
      bounds="window"
      minWidth={320}
      minHeight={380}
      dragHandleClassName={DRAG_HANDLE}
      onDragStop={(_, d) => {
        try { localStorage.setItem(POS_KEY, JSON.stringify({ ...initialBox, x: d.x, y: d.y })); } catch { /* ignore */ }
      }}
      onResizeStop={(_, __, ref, ___, position) => {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({
            x: position.x, y: position.y,
            width: parseInt(ref.style.width, 10),
            height: parseInt(ref.style.height, 10),
          }));
        } catch { /* ignore */ }
      }}
      style={{ zIndex: 9991 }}
    >
      <div className="flex flex-col h-full rounded-xl border border-[hsl(230,20%,15%)] bg-[hsl(230,22%,10%)] text-[hsl(230,10%,90%)] shadow-2xl overflow-hidden">
        {/* Handle de drag */}
        <div className={`${DRAG_HANDLE} flex items-center justify-between px-3 py-2 bg-[hsl(230,22%,8%)] border-b border-[hsl(230,20%,15%)] cursor-move select-none`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GripVertical size={14} className="opacity-50" />
            Estimation paiement
          </div>
          <button onClick={onClose} aria-label="Fermer" className="p-1 hover:bg-white/10 rounded">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="estimate-montant" className="text-[hsl(230,10%,60%)] text-xs">Montant souhaité</Label>
            <Input
              id="estimate-montant"
              type="number"
              inputMode="numeric"
              min={minMontant}
              max={MAX_AMOUNT}
              step={100}
              value={montant}
              onChange={(e) => setMontant(Number(e.target.value) || 0)}
              aria-describedby={outOfRange || amountAdjusted ? errId : undefined}
              className="h-9 text-sm"
            />
            {outOfRange && (
              <Alert id={errId} variant="destructive" className="py-2">
                <AlertDescription className="text-xs">
                  Entrer un montant entre {minMontant.toLocaleString('fr-CA')} $ et {MAX_AMOUNT.toLocaleString('fr-CA')} $.
                </AlertDescription>
              </Alert>
            )}
            {!outOfRange && amountAdjusted && (
              <Alert id={errId} className="py-2">
                <AlertDescription className="text-xs">
                  Montant ajusté au minimum requis ({minMontant.toLocaleString('fr-CA')} $) pour cette durée.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="estimate-duree" className="text-[hsl(230,10%,60%)] text-xs">Durée</Label>
              <Select value={String(nbMois)} onValueChange={(v) => setNbMois(Number(v) as TermMonths)}>
                <SelectTrigger id="estimate-duree" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TERMS_MONTHS.map(m => <SelectItem key={m} value={String(m)}>{m} mois</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estimate-credit" className="text-[hsl(230,10%,60%)] text-xs">Crédit</Label>
              <Select value={credit} onValueChange={(v) => setCredit(v as CreditQuality)}>
                <SelectTrigger id="estimate-credit" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREDIT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-xs space-y-1 pt-1">
            <Row label="Taux"               value={formatPct(result.tauxAnnuel)} />
            <Row label="Frais admin (6 %)"  value={formatCAD(result.fraisAdmin)} />
            <Row label="Capital financé"    value={formatCAD(result.capitalFinance)} />
            <div className="flex items-baseline justify-between border-t border-[hsl(230,20%,15%)] pt-2 mt-1">
              <span className="text-[hsl(230,10%,60%)]">Paiement mensuel</span>
              <span className="text-xl font-bold text-[hsl(250,80%,75%)] tabular-nums">
                {formatCAD(result.paiementMensuel)}<span className="text-[10px] text-[hsl(230,10%,45%)] font-normal">/mois</span>
              </span>
            </div>
            <Row label="Total des paiements" value={formatCAD(result.totalPaiements)} />
            <Row label="Coût du crédit"      value={formatCAD(result.coutDuCredit)} />
          </div>

          <Button
            size="sm" className="w-full text-xs"
            onClick={() => window.open(APPLY_URL, '_blank', 'noopener,noreferrer')}
          >
            Obtenir le financement
          </Button>
        </div>
      </div>
    </Rnd>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between">
    <span className="text-[hsl(230,10%,60%)]">{label}</span>
    <span className="text-[hsl(230,10%,85%)] font-medium tabular-nums">{value}</span>
  </div>
);

export default EstimatePaymentWindow;
