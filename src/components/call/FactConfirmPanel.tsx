import React, { useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import type { PrefillFact } from './CallScript';
import { MATERIAL_LABEL, FORM_LABEL, PITCH_LABEL } from '@/lib/call/estimate';

export interface FactDraft {
  roof_age: number | null;
  material: string | null;
  roof_form: string | null;
  pitch: string | null;
  intent: string | null;
  email: string | null;
}
export interface ConfirmedState {
  roof_age: boolean;
  material: boolean;
  roof_form: boolean;
  pitch: boolean;
  intent: boolean;
}
export const EMPTY_DRAFT: FactDraft = { roof_age: null, material: null, roof_form: null, pitch: null, intent: null, email: null };
export const EMPTY_CONFIRMED: ConfirmedState = { roof_age: false, material: false, roof_form: false, pitch: false, intent: false };

const MATERIAL_OPTS: [string, string][] = [['bardeau_asphalte', "Bardeau d'asphalte"], ['tole', 'Tôle'], ['membrane', 'Membrane']];
const FORM_OPTS: [string, string][] = [['2pans', '2 versants'], ['4pans', '4 versants'], ['4pans_plus', '4 versants +'], ['plat', 'Toit plat'], ['complexe', 'Complexe']];
const PITCH_OPTS: [string, string][] = [['aucune', 'Aucune (plat)'], ['faible', 'Faible'], ['moderee', 'Moyenne'], ['forte', 'Forte']];
const AGE_OPTS: [string, string][] = [['3', 'Neuve (< 5 ans)'], ['8', '5–10 ans'], ['13', '10–15 ans'], ['18', '15–20 ans'], ['22', '20–25 ans'], ['27', '25–30 ans'], ['35', '30 ans +']];
const INTENT_OPTS: [string, string][] = [['cette_annee', 'Cette année'], ['1-2_ans', 'Dans 1-2 ans'], ['aucune', "Pas pour l'instant"]];

export function draftFromPrefill(facts: PrefillFact[]): FactDraft {
  const m: Record<string, string | null> = {};
  for (const f of facts) m[f.attribute] = f.value;
  const ageNum = m.roof_age != null && m.roof_age !== '' ? Number(m.roof_age) : NaN;
  return {
    roof_age: Number.isFinite(ageNum) ? ageNum : null,
    material: m.material ?? null,
    roof_form: m.roof_form ?? null,
    pitch: m.pitch ?? null,
    intent: m.intent ?? null,
    email: null,
  };
}

const selectCls =
  'bg-[hsl(230,22%,8%)] border border-[hsl(230,20%,16%)] text-white rounded-md px-2 py-1.5 text-sm w-full focus:outline-none focus:border-[hsl(250,60%,50%)]';

function labelOf(field: string, v: string | null): string {
  if (v == null || v === '') return '— à confirmer —';
  if (field === 'material') return MATERIAL_LABEL[v] || v;
  if (field === 'roof_form') return FORM_LABEL[v] || v;
  if (field === 'pitch') return PITCH_LABEL[v] || v;
  if (field === 'roof_age') return `~${v} ans`;
  return v;
}

const SelectRow: React.FC<{
  field: string;
  label: string;
  value: string | null;
  options: [string, string][];
  confirmed: boolean;
  onPick: (v: string | null) => void;
  onConfirm: () => void;
}> = ({ field, label, value, options, confirmed, onPick, onConfirm }) => {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-20 shrink-0 text-sm text-[hsl(230,10%,70%)]">{label}</div>
      {editing ? (
        <select
          autoFocus
          className={selectCls}
          value={value ?? ''}
          onChange={(e) => {
            onPick(e.target.value || null);
            setEditing(false);
          }}
          onBlur={() => setEditing(false)}
        >
          <option value="">— à confirmer —</option>
          {options.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      ) : (
        <div className={`flex-1 text-sm ${confirmed ? 'text-emerald-300' : 'text-white'}`}>{labelOf(field, value)}</div>
      )}
      {!editing && (
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={onConfirm}
            title="Confirmer"
            className={`px-2 py-1 rounded-md text-xs inline-flex items-center gap-1 border ${
              confirmed
                ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-300'
                : 'bg-[hsl(230,22%,8%)] border-[hsl(230,20%,16%)] text-[hsl(230,10%,70%)] hover:bg-[hsl(230,20%,14%)]'
            }`}
          >
            <Check className="h-3.5 w-3.5" /> {confirmed ? 'Confirmé' : 'Confirmer'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Corriger"
            className="px-2 py-1 rounded-md text-xs inline-flex items-center gap-1 border bg-[hsl(230,22%,8%)] border-[hsl(230,20%,16%)] text-[hsl(230,10%,70%)] hover:bg-[hsl(230,20%,14%)]"
          >
            <Pencil className="h-3.5 w-3.5" /> Corriger
          </button>
        </div>
      )}
    </div>
  );
};

export const FactConfirmPanel: React.FC<{
  facts: PrefillFact[];
  draft: FactDraft;
  confirmed: ConfirmedState;
  onDraft: (next: FactDraft) => void;
  onConfirmed: (next: ConfirmedState) => void;
}> = ({ draft, confirmed, onDraft, onConfirmed }) => {
  const setD = (patch: Partial<FactDraft>) => onDraft({ ...draft, ...patch });
  const setC = (patch: Partial<ConfirmedState>) => onConfirmed({ ...confirmed, ...patch });

  return (
    <div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] p-4">
      <div className="text-[10px] uppercase tracking-wide text-[hsl(230,10%,45%)] mb-2">À confirmer avec le client</div>

      <SelectRow field="material" label="Matériau" value={draft.material} options={MATERIAL_OPTS} confirmed={confirmed.material}
        onPick={(v) => { setD({ material: v }); setC({ material: v != null }); }} onConfirm={() => setC({ material: true })} />
      <SelectRow field="roof_form" label="Forme" value={draft.roof_form} options={FORM_OPTS} confirmed={confirmed.roof_form}
        onPick={(v) => {
          if (v === 'plat') { setD({ roof_form: v, pitch: 'aucune' }); setC({ roof_form: true, pitch: true }); }
          else { setD({ roof_form: v }); setC({ roof_form: v != null }); }
        }}
        onConfirm={() => setC({ roof_form: true })} />
      <SelectRow field="pitch" label="Pente" value={draft.pitch} options={PITCH_OPTS} confirmed={confirmed.pitch}
        onPick={(v) => { setD({ pitch: v }); setC({ pitch: v != null }); }} onConfirm={() => setC({ pitch: true })} />
      <SelectRow field="roof_age" label="Âge" value={draft.roof_age != null ? String(draft.roof_age) : null} options={AGE_OPTS} confirmed={confirmed.roof_age}
        onPick={(v) => { setD({ roof_age: v ? Number(v) : null }); setC({ roof_age: v != null }); }} onConfirm={() => setC({ roof_age: draft.roof_age != null })} />

      <div className="flex items-center gap-2 py-1.5">
        <div className="w-20 shrink-0 text-sm text-[hsl(230,10%,70%)]">Intention</div>
        <div className="flex flex-wrap gap-1.5">
          {INTENT_OPTS.map(([v, l]) => {
            const active = draft.intent === v;
            return (
              <button key={v} type="button"
                onClick={() => { const next = active ? null : v; setD({ intent: next }); setC({ intent: next != null }); }}
                className={`px-2.5 py-1 rounded-md text-sm border ${
                  active ? 'bg-[hsl(250,60%,22%)] border-[hsl(250,60%,45%)] text-[hsl(250,80%,82%)]'
                    : 'bg-[hsl(230,22%,8%)] border-[hsl(230,20%,16%)] text-[hsl(230,10%,70%)]'}`}>
                {l}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 py-1.5">
        <div className="w-20 shrink-0 text-sm text-[hsl(230,10%,70%)]">Courriel</div>
        <input type="email" inputMode="email" placeholder="optionnel" value={draft.email ?? ''}
          onChange={(e) => setD({ email: e.target.value || null })} className={selectCls} />
      </div>
    </div>
  );
};
