import React, { useState } from 'react';
import { Calculator, AlertTriangle, ThumbsDown, CheckCircle2 } from 'lucide-react';
import type { PrefillFact } from './CallScript';
import type { FactDraft, ConfirmedState } from './FactConfirmPanel';
import {
  computeEstimate, confLevel, confColor, FORM_LABEL, MATERIAL_LABEL, PITCH_LABEL, CALIB_PER_SQFT,
  FLAT_LOW, FLAT_HIGH,
} from '@/lib/call/estimate';
import type { CallProspect } from './ProspectHeader';

const fmtMoney = (n: number) => Math.round(n).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 });
const fmtInt = (n: number) => Math.round(n).toLocaleString('fr-CA');

const DOUBT_REASONS: [string, string][] = [
  ['pente_erronee', 'Pente erronée'],
  ['forme_erronee', 'Forme erronée'],
  ['materiau_errone', 'Matériau erroné'],
  ['batiment_complexe', 'Bâtiment complexe'],
  ['annexe_non_detectee', 'Annexe non détectée'],
  ['autre', 'Autre'],
];

function prefillConf(facts: PrefillFact[], attr: string): number {
  const f = facts.find((x) => x.attribute === attr);
  if (!f || f.confidence == null) return 0;
  return Math.round(Number(f.confidence) * 100);
}

const ConfBadge: React.FC<{ pct: number }> = ({ pct }) => {
  const lvl = confLevel(pct);
  return <span className={`text-xs font-semibold ${confColor(lvl)}`}>{pct}% · {lvl}</span>;
};

const HypoRow: React.FC<{ label: string; value: string; pct: number }> = ({ label, value, pct }) => {
  const low = pct < 40;
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${
      low ? 'border-amber-700/50 bg-amber-950/20' : 'border-[hsl(230,20%,14%)] bg-[hsl(230,22%,8%)]'}`}>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[hsl(230,10%,45%)]">{label}</div>
        <div className="text-sm text-white">{value}{low && <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-amber-400" />}</div>
      </div>
      <ConfBadge pct={pct} />
    </div>
  );
};

export const CalcSummary: React.FC<{
  prospect: CallProspect;
  facts: PrefillFact[];
  draft: FactDraft;
  confirmed: ConfirmedState;
  onDoubt: (reason: string) => void;
  doubtDone?: boolean;
}> = ({ prospect, facts, draft, confirmed, onDoubt, doubtDone }) => {
  const [doubtOpen, setDoubtOpen] = useState(false);
  const est = computeEstimate({
    footprint_m2: prospect.footprint_m2,
    roof_form: draft.roof_form,
    pitch: draft.pitch,
    price_estimated: prospect.price_estimated,
  });

  // Confiances (déclaré par client = élevée).
  const cMaterial = confirmed.material ? 92 : prefillConf(facts, 'material');
  const cForm = confirmed.roof_form ? 95 : prefillConf(facts, 'roof_form');
  const cPitch = confirmed.pitch ? 90 : prefillConf(facts, 'pitch');
  const cAge = confirmed.roof_age && draft.roof_age != null ? 85 : draft.roof_age != null ? 60 : 0;
  const cFootprint = 90; // cadastre / public
  const overall = Math.min(cFootprint, cForm, cPitch);
  const overallLvl = confLevel(overall);

  const formVal = draft.roof_form ? FORM_LABEL[draft.roof_form] || draft.roof_form : 'Inconnue';
  const pitchVal = draft.pitch ? PITCH_LABEL[draft.pitch] || draft.pitch : 'Inconnue';
  const matVal = draft.material ? MATERIAL_LABEL[draft.material] || draft.material : 'Inconnu';
  const ageVal = draft.roof_age != null ? `~${draft.roof_age} ans` : 'Inconnu';

  return (
    <div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white inline-flex items-center gap-2">
          <Calculator className="h-4 w-4" /> Résumé de calcul
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-md bg-[hsl(230,22%,8%)] ${confColor(overallLvl)}`}>
          Confiance : {overallLvl}
        </span>
      </div>

      {/* ZONE 3 — calcul de la surface */}
      <div className="rounded-lg bg-[hsl(230,22%,8%)] border border-[hsl(230,20%,14%)] p-3">
        <div className="text-[10px] uppercase tracking-wide text-[hsl(230,10%,45%)] mb-2">Surface toiture</div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <div className="text-center">
            <div className="text-white font-semibold">{fmtInt(est.footprint_sqft)} pi²</div>
            <div className="text-[10px] text-[hsl(230,10%,45%)]">Empreinte</div>
          </div>
          <span className="text-[hsl(230,10%,45%)]">×</span>
          <div className="text-center">
            <div className="text-white font-semibold">{est.forme_factor.toFixed(2)}</div>
            <div className="text-[10px] text-[hsl(230,10%,45%)]">Forme ({formVal})</div>
          </div>
          <span className="text-[hsl(230,10%,45%)]">×</span>
          <div className="text-center">
            <div className="text-white font-semibold">{est.pente_factor.toFixed(2)}</div>
            <div className="text-[10px] text-[hsl(230,10%,45%)]">Pente ({pitchVal})</div>
          </div>
          <span className="text-[hsl(230,10%,45%)]">=</span>
          <div className="text-center">
            <div className="text-emerald-300 font-bold">{fmtInt(est.roof_sqft)} pi²</div>
            <div className="text-[10px] text-[hsl(230,10%,45%)]">Surface toiture</div>
          </div>
        </div>
      </div>

      {/* ZONE 3/5 — prix */}
      <div className="rounded-lg bg-[hsl(230,22%,8%)] border border-[hsl(230,20%,14%)] p-3">
        <div className="text-[10px] uppercase tracking-wide text-[hsl(230,10%,45%)] mb-2">Prix estimé</div>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <div className="text-center">
            <div className="text-white font-semibold">{fmtInt(est.roof_sqft)} pi²</div>
            <div className="text-[10px] text-[hsl(230,10%,45%)]">Surface</div>
          </div>
          <span className="text-[hsl(230,10%,45%)]">×</span>
          <div className="text-center">
            <div className="text-white font-semibold">{est.price_per_sqft.toFixed(2)} $/pi²</div>
            <div className="text-[10px] text-[hsl(230,10%,45%)]">{est.is_flat ? 'Membrane (toit plat)' : 'Calibration Dynasty'}</div>
          </div>
          <span className="text-[hsl(230,10%,45%)]">=</span>
          <div className="text-center">
            <div className="text-emerald-300 font-bold">{fmtMoney(est.price_total)}</div>
            <div className="text-[10px] text-[hsl(230,10%,45%)]">Budget estimé</div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-[hsl(230,10%,45%)]">
          Plage : <span className="text-[hsl(230,10%,70%)]">{fmtMoney(est.budget_low)} – {fmtMoney(est.budget_high)}</span>
          {'  ·  '}{est.is_flat
            ? `Toit plat — membrane ${FLAT_LOW}–${FLAT_HIGH} $/pi²`
            : `Base : ${CALIB_PER_SQFT.toFixed(2)} $/pi² d'empreinte (marché Granby, taxes incl.)`}
        </div>
      </div>

      {/* ZONE 4 — hypothèses + confiance */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[hsl(230,10%,45%)] mb-2">Hypothèses du système</div>
        <div className="grid grid-cols-2 gap-2">
          <HypoRow label="Matériau" value={matVal} pct={cMaterial} />
          <HypoRow label="Forme" value={formVal} pct={cForm} />
          <HypoRow label="Pente" value={pitchVal} pct={cPitch} />
          <HypoRow label="Âge" value={ageVal} pct={cAge} />
        </div>
      </div>

      {/* ZONE 6 — pourquoi ce prix */}
      <div className="rounded-lg border border-[hsl(250,40%,30%)] bg-[hsl(250,40%,12%)] p-3">
        <div className="text-[10px] uppercase tracking-wide text-[hsl(250,40%,65%)] mb-1">Pourquoi ce prix ?</div>
        <div className="text-sm text-[hsl(230,10%,82%)] leading-relaxed">
          Bâtiment de <b className="text-white">{fmtInt(est.footprint_sqft)} pi²</b> au sol, forme{' '}
          <b className="text-white">{formVal.toLowerCase()}</b>, pente <b className="text-white">{pitchVal.toLowerCase()}</b> →
          surface de toiture <b className="text-white">~{fmtInt(est.roof_sqft)} pi²</b>, à{' '}
          <b className="text-white">{est.price_per_sqft.toFixed(2)} $/pi²</b> ={' '}
          <b className="text-emerald-300">{fmtMoney(est.price_total)}</b>.
        </div>
      </div>

      {/* ZONE 7 — apprentissage */}
      <div>
        {doubtDone ? (
          <div className="text-xs text-emerald-400 inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Merci — signalé au moteur.
          </div>
        ) : !doubtOpen ? (
          <button type="button" onClick={() => setDoubtOpen(true)}
            className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[hsl(230,20%,16%)] text-[hsl(230,10%,60%)] hover:bg-[hsl(230,20%,14%)]">
            <ThumbsDown className="h-3.5 w-3.5" /> Je ne crois pas l'estimation
          </button>
        ) : (
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
            <div className="text-xs text-amber-300 mb-2">Pourquoi ? (améliore le moteur)</div>
            <div className="flex flex-wrap gap-1.5">
              {DOUBT_REASONS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => { onDoubt(v); setDoubtOpen(false); }}
                  className="px-2.5 py-1 rounded-md text-xs border bg-[hsl(230,22%,8%)] border-[hsl(230,20%,16%)] text-[hsl(230,10%,75%)] hover:bg-[hsl(230,20%,14%)]">
                  {l}
                </button>
              ))}
              <button type="button" onClick={() => setDoubtOpen(false)} className="px-2.5 py-1 text-xs text-[hsl(230,10%,50%)]">Annuler</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
