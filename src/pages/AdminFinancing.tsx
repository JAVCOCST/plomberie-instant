import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { amortization, formatCAD, formatPct, rateFor } from '@/features/financing-calculator/financing';
import { useFinancingCalculator } from '@/features/financing-calculator/useFinancingCalculator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  CREDIT_OPTIONS, CreditQuality, MAX_AMOUNT, TERMS_MONTHS, TermMonths,
} from '@/features/financing-calculator/financing';

const APPLY_URL = 'https://apply.ifinancecanada.com/20500?lang=fr';
const SOURCE_URL = 'https://ifinancecanada.com/fr/calculatrice/';

const AdminFinancing: React.FC = () => {
  const {
    state, minMontant, result, adjustedAmount, amountAdjusted,
    setMontant, setNbMois, setCredit,
  } = useFinancingCalculator();

  const rows = useMemo(
    () => amortization({ montant: adjustedAmount, nbMois: state.nbMois, tauxAnnuel: rateFor(state.credit) }),
    [adjustedAmount, state.nbMois, state.credit],
  );

  const montantErrId = 'finance-montant-error';
  const montantOutOfRange = state.montant < minMontant || state.montant > MAX_AMOUNT;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-[hsl(230,10%,90%)]">Calculateur Ifinance</h1>
          <p className="text-xs text-[hsl(230,10%,45%)]">Estimation mensuelle iFinance Canada · logique PMT sur capital majoré de 6 % de frais d'administration.</p>
        </div>
        <a
          href={SOURCE_URL}
          target="_blank" rel="noopener noreferrer"
          className="text-xs text-[hsl(250,80%,75%)] hover:underline"
        >
          Source : ifinancecanada.com/fr/calculatrice ↗
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Inputs */}
        <Card className="border-[hsl(230,20%,15%)] bg-[hsl(230,22%,10%)]">
          <CardHeader>
            <CardTitle className="text-sm text-[hsl(230,10%,80%)]">Vos paramètres</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="finance-montant" className="text-[hsl(230,10%,60%)] text-xs">Montant souhaité</Label>
              <Input
                id="finance-montant"
                type="number"
                inputMode="numeric"
                min={minMontant}
                max={MAX_AMOUNT}
                step={100}
                value={state.montant}
                onChange={(e) => setMontant(Number(e.target.value) || 0)}
                aria-describedby={montantOutOfRange || amountAdjusted ? montantErrId : undefined}
              />
              {montantOutOfRange && (
                <Alert id={montantErrId} variant="destructive" className="py-2">
                  <AlertDescription className="text-xs">
                    Entrer un montant entre {minMontant.toLocaleString('fr-CA')} $ et {MAX_AMOUNT.toLocaleString('fr-CA')} $.
                  </AlertDescription>
                </Alert>
              )}
              {!montantOutOfRange && amountAdjusted && (
                <Alert id={montantErrId} className="py-2">
                  <AlertDescription className="text-xs">
                    Montant ajusté au minimum requis ({minMontant.toLocaleString('fr-CA')} $) pour cette durée.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="finance-duree" className="text-[hsl(230,10%,60%)] text-xs">Durée du prêt</Label>
              <Select value={String(state.nbMois)} onValueChange={(v) => setNbMois(Number(v) as TermMonths)}>
                <SelectTrigger id="finance-duree"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TERMS_MONTHS.map(m => <SelectItem key={m} value={String(m)}>{m} mois</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="finance-credit" className="text-[hsl(230,10%,60%)] text-xs">Qualité du crédit</Label>
              <Select value={state.credit} onValueChange={(v) => setCredit(v as CreditQuality)}>
                <SelectTrigger id="finance-credit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREDIT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Résultats */}
        <Card className="border-[hsl(230,20%,15%)] bg-[hsl(230,22%,10%)]">
          <CardHeader>
            <CardTitle className="text-sm text-[hsl(230,10%,80%)]">Résultats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Taux d'intérêt appliqué"        value={formatPct(result.tauxAnnuel)} />
            <Row label="Frais d'administration (6 %)"   value={formatCAD(result.fraisAdmin)} />
            <Row label="Capital financé"                value={formatCAD(result.capitalFinance)} />
            <div className="flex items-baseline justify-between border-t border-[hsl(230,20%,15%)] pt-3 mt-2">
              <span className="text-[hsl(230,10%,60%)]">Paiement mensuel estimé</span>
              <span className="text-2xl font-bold text-[hsl(250,80%,75%)]">
                {formatCAD(result.paiementMensuel)}<span className="text-xs text-[hsl(230,10%,45%)] font-normal">/mois</span>
              </span>
            </div>
            <Row label="Total des paiements"   value={formatCAD(result.totalPaiements)} />
            <Row label="Coût total du crédit"  value={formatCAD(result.coutDuCredit)} />

            <p className="text-[11px] leading-snug text-[hsl(230,10%,45%)] pt-3">
              Estimation seulement. iFinance Canada ajoute 6 % de frais d'administration au montant emprunté avant
              calcul. Tous les prêts sont ouverts (remboursement anticipé sans pénalité). Le montant final, la durée,
              le taux et les frais sont sujets à l'approbation finale par iFinance.
            </p>

            <Button
              className="w-full mt-2"
              onClick={() => window.open(APPLY_URL, '_blank', 'noopener,noreferrer')}
            >
              Obtenir le financement
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Tableau d'amortissement complet */}
      <Card className="border-[hsl(230,20%,15%)] bg-[hsl(230,22%,10%)]">
        <CardHeader>
          <CardTitle className="text-sm text-[hsl(230,10%,80%)]">
            Tableau d'amortissement — {rows.length} paiements
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[hsl(230,22%,10%)] z-10">
                <tr className="border-b border-[hsl(230,20%,15%)] text-[hsl(230,10%,55%)]">
                  <th className="px-3 py-2 text-right font-medium">#</th>
                  <th className="px-3 py-2 text-right font-medium">Paiement</th>
                  <th className="px-3 py-2 text-right font-medium">Intérêts</th>
                  <th className="px-3 py-2 text-right font-medium">Capital</th>
                  <th className="px-3 py-2 text-right font-medium">Solde restant</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.i} className="border-b border-[hsl(230,20%,12%)] text-[hsl(230,10%,80%)] hover:bg-[hsl(230,20%,12%)]">
                    <td className="px-3 py-1.5 text-right text-[hsl(230,10%,55%)]">{r.i}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCAD(r.paiement)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCAD(r.interets)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCAD(r.capital)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCAD(Math.max(0, r.soldeRestant))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between">
    <span className="text-[hsl(230,10%,60%)]">{label}</span>
    <span className="text-[hsl(230,10%,90%)] font-medium tabular-nums">{value}</span>
  </div>
);

export default AdminFinancing;
