import React from 'react';

/** Une ligne renvoyée par la RPC prefill_call(p_property_id). */
export interface PrefillFact {
  attribute: string;
  value: string | null;
  source: string | null;
  confidence: number | null;
  observed_at: string | null;
}

const FORM_LABEL: Record<string, string> = {
  '2pans': '2 versants',
  '4pans': '4 versants',
  '4pans_plus': '4 versants et plus',
  plat: 'toit plat',
};
const MAT_LABEL: Record<string, string> = {
  bardeau_asphalte: "bardeau d'asphalte",
  bardeau: 'bardeau',
  tole: 'tôle',
  membrane: 'membrane',
};

function factMap(facts: PrefillFact[]): Record<string, string | null> {
  const m: Record<string, string | null> = {};
  for (const f of facts) m[f.attribute] = f.value;
  return m;
}

/** Script personnalisé "présume → fais confirmer". Affichage seul (étape 1). */
export const CallScript: React.FC<{ ownerName: string | null; facts: PrefillFact[]; rep?: string }> = ({
  ownerName,
  facts,
  rep,
}) => {
  const m = factMap(facts);
  const civ = ownerName || 'Monsieur/Madame';
  const forme = m.roof_form ? FORM_LABEL[m.roof_form] || m.roof_form : null;
  const materiau = m.material ? MAT_LABEL[m.material] || m.material : null;
  const age = m.roof_age ? `environ ${m.roof_age} ans` : null;

  const dataParts = [forme, materiau, age].filter(Boolean);
  const dataPhrase =
    dataParts.length > 0
      ? `Nos données : ${dataParts.join(', ')} — c'est exact ?`
      : "J'aimerais juste valider quelques détails sur votre toiture.";

  return (
    <div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] p-4 leading-relaxed text-[hsl(230,10%,82%)]">
      <div className="text-[10px] uppercase tracking-wide text-[hsl(230,10%,45%)] mb-2">
        Script — présume, fais confirmer
      </div>
      <p>
        « Bonjour {civ}, {rep || '[vous]'} de{' '}
        <span className="text-white font-semibold">Toitures VB</span>, à Granby.
      </p>
      <p className="mt-1">{dataPhrase}</p>
      <p className="mt-1">
        Vous prévoyez des travaux{' '}
        <span className="text-white">cette année, dans 1-2 ans, ou pas pour l'instant</span> ?
      </p>
      <p className="mt-1">
        Je vous envoie une <span className="text-white">évaluation gratuite</span> par courriel —
        c'est quoi votre adresse courriel ? »
      </p>
    </div>
  );
};
