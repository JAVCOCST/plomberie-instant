import React from 'react';
import { Phone, MapPin } from 'lucide-react';

/** Une ligne de prospects_v1, restreinte aux champs affichés par l'en-tête. */
export interface CallProspect {
  id: string;
  property_id: string | null;
  owner_name: string | null;
  telephone: string | null;
  address: string | null;
  ville_slug: string | null;
  footprint_m2: number | null;
  price_estimated: number | null;
  score_v1: number | null;
}

const fmtMoney = (n: number) =>
  n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 });
const cap = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg bg-[hsl(230,22%,8%)] border border-[hsl(230,20%,14%)] px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-[hsl(230,10%,45%)]">{label}</div>
    <div className="text-sm font-semibold text-white">{value}</div>
  </div>
);

export const ProspectHeader: React.FC<{
  prospect: CallProspect;
  /** Estimation live (forme/pente confirmées) — sinon repli sur le défaut système. */
  estimate?: { roofSqft: number; budgetLow: number; budgetHigh: number };
}> = ({ prospect, estimate }) => {
  // Si l'estimation live est fournie, on l'affiche ; sinon défaut empreinte ×1.18.
  const roofSqft = estimate
    ? Math.round(estimate.roofSqft)
    : prospect.footprint_m2 ? Math.round(prospect.footprint_m2 * 10.7639 * 1.18) : null;
  const low = estimate
    ? Math.round(estimate.budgetLow)
    : prospect.price_estimated ? Math.round(prospect.price_estimated * 0.75) : null;
  const high = estimate
    ? Math.round(estimate.budgetHigh)
    : prospect.price_estimated ? Math.round(prospect.price_estimated * 1.3) : null;

  return (
    <div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-lg font-semibold text-white">
          {prospect.owner_name || 'Propriétaire inconnu'}
        </div>
        <div className="flex items-center gap-3">
          {prospect.score_v1 != null && (
            <span className="rounded-md bg-[hsl(250,60%,20%)] text-[hsl(250,80%,80%)] text-xs font-semibold px-2 py-1">
              Score {prospect.score_v1}
            </span>
          )}
          {prospect.ville_slug && (
            <span className="text-xs text-[hsl(230,10%,55%)]">● {cap(prospect.ville_slug)}</span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-4 flex-wrap text-sm text-[hsl(230,10%,70%)]">
        {prospect.telephone && (
          <a
            href={`tel:${prospect.telephone}`}
            className="inline-flex items-center gap-1.5 text-[hsl(250,80%,78%)] hover:underline"
          >
            <Phone className="h-4 w-4" /> {prospect.telephone}
          </a>
        )}
        {prospect.address && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4" /> {prospect.address}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Toiture estimée" value={roofSqft ? `${roofSqft.toLocaleString('fr-CA')} pi²` : '—'} />
        <Stat
          label="Budget estimé"
          value={low && high ? `${fmtMoney(low)} – ${fmtMoney(high)}` : '—'}
        />
        <Stat
          label="Empreinte"
          value={prospect.footprint_m2 ? `${Math.round(prospect.footprint_m2 * 10.7639).toLocaleString('fr-CA')} pi²` : '—'}
        />
      </div>
    </div>
  );
};
