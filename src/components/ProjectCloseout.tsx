/**
 * ProjectCloseout — clôture / coût de revient d'un projet.
 *
 * Tableau détaillé à 2 colonnes **Vendant** (gauche) vs **Coût** (droite),
 * séparé par catégorie (Matériaux · Main d'œuvre · Sous-traitance · Autres),
 * avec la marge $/% par ligne et au total.
 *
 *   • Vendant / coût estimé par catégorie  ← lignes du devis de référence
 *       (dynasty_breakdown : lines + line_categories + line_cost_overrides).
 *   • Coût RÉEL de main d'œuvre            ← heures pointées (clockshark) × taux,
 *       réparties également entre les projets d'une même journée.
 *   • Devis de référence sélectionnable    ← recherche identique au style du
 *       module (« Soumissions sauvegardées »).
 *
 * Styles alignés sur AdminQuoteGenerator (inputStyle / thSt / tdSt) pour rester
 * cohérent avec les autres étapes du module.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, CheckCircle2, Search, X, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { loadSettings, saveSettings } from '@/lib/quote-settings';
import { loadProjectInvoices } from '@/lib/invoices';
import { InvoiceBatchDrop } from '@/components/InvoiceBatchDrop';

const db = supabase as any;

const fmt = (n: number | null | undefined) =>
  (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

/* ── Styles repris du module (AdminQuoteGenerator) pour la cohérence visuelle ── */
const sInput: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, fontSize: 13, outline: 'none' };
const sTh: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, color: '#9ca3af', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left' };
const sTd: React.CSSProperties = { padding: '5px 8px' };
const sLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 };

/* ── Catégories agrégées (alignées sur LINE_CATEGORIES de AdminQuoteGenerator) ── */
type CatKey = 'materiau' | 'main_oeuvre' | 'sous_traitance' | 'autres';
const CAT_META: { key: CatKey; label: string; color: string }[] = [
  { key: 'materiau', label: 'Matériaux', color: '#fbbf24' },
  { key: 'main_oeuvre', label: "Main d'œuvre", color: '#60a5fa' },
  { key: 'sous_traitance', label: 'Sous-traitance', color: '#a78bfa' },
  { key: 'autres', label: 'Autres', color: '#9ca3af' },
];

type CatTotals = Record<CatKey, { cost: number; sell: number }>;
const emptyTotals = (): CatTotals => ({
  materiau: { cost: 0, sell: 0 }, main_oeuvre: { cost: 0, sell: 0 },
  sous_traitance: { cost: 0, sell: 0 }, autres: { cost: 0, sell: 0 },
});

/** Catégorie d'une ligne : explicite (line_categories) sinon heuristique
 *  (mêmes règles que les métriques du générateur). */
function resolveCat(rawCat: string | undefined, desc: string, hasLaborTags: boolean): CatKey {
  if (rawCat === 'materiau' || rawCat === 'main_oeuvre' || rawCat === 'sous_traitance') return rawCat;
  if (rawCat === 'equipement' || rawCat === 'transport' || rawCat === 'divers') return 'autres';
  const d = (desc || '').toLowerCase();
  if (hasLaborTags || d.includes('arrachage') || d.includes('pose') || d.includes("main d'") || d.includes('main d')) return 'main_oeuvre';
  return 'materiau';
}

/** Agrège coût (line_cost_overrides × qté) et vendant (total_displayed) par catégorie. */
function breakdownFromDevis(brk: any): { totals: CatTotals; hasLines: boolean } {
  const totals = emptyTotals();
  const lines: any[] = Array.isArray(brk?.lines) ? brk.lines : [];
  const cats = brk?.line_categories || {};
  const costOv = brk?.line_cost_overrides || {};
  const laborTypes = brk?.line_labor_types || {};
  lines.forEach((line, i) => {
    const qty = Number(line?.quantity) || 0;
    const sell = Number(line?.total_displayed) || qty * (Number(line?.rate) || 0);
    const unitCost = costOv[i] != null ? Number(costOv[i]) || 0 : 0;
    const cost = unitCost * qty;
    const cat = resolveCat(cats[i], line?.description || '', Array.isArray(laborTypes[i]) && laborTypes[i].length > 0);
    totals[cat].cost += cost;
    totals[cat].sell += sell;
  });
  return { totals, hasLines: lines.length > 0 };
}

interface RefRow { id: string; seq_number: number | null; first_name: string | null; last_name: string | null; formatted_address: string | null; subtotal: number | null; }

export const ProjectCloseout: React.FC<{
  soumissionId?: string | null;
  revenue: number;
  status?: string | null;
  onMarkDone?: () => void;
}> = ({ soumissionId, revenue, status, onMarkDone }) => {
  const [rate, setRate] = useState<number>(() => Number(loadSettings().hourlyRate) || 0);

  // Devis de référence (défaut = le projet lui-même).
  const [refId, setRefId] = useState<string | null>(soumissionId || null);
  const [refLabel, setRefLabel] = useState<string | null>(null);
  useEffect(() => { setRefId(soumissionId || null); setRefLabel(null); }, [soumissionId]);

  // Données chargées
  const [brk, setBrk] = useState<any>(null);
  const [hours, setHours] = useState<number>(0);
  const [entryCount, setEntryCount] = useState<number>(0);
  const [byEmployee, setByEmployee] = useState<{ name: string; hours: number }[]>([]);
  const [laborOpen, setLaborOpen] = useState(false);
  // Coûtant matériaux facturé (OCR) — null si aucune facture (→ on garde l'estimé).
  const [invoicedMaterial, setInvoicedMaterial] = useState<number | null>(null);
  const [showInvoices, setShowInvoices] = useState(false);
  const [loading, setLoading] = useState(false);

  // Recherche d'un devis de référence
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<RefRow[]>([]);

  // Heures réelles = toujours rattachées au PROJET (pas au devis de référence).
  // Quand une journée est partagée entre N projets, ses heures sont réparties
  // également (hours_decimal / N). `legacy` = entrées assignées avant la colonne
  // soumission_ids (un seul projet).
  useEffect(() => {
    if (!soumissionId) { setHours(0); setEntryCount(0); setByEmployee([]); return; }
    let cancelled = false;
    Promise.all([
      db.from('clockshark_time_entries').select('hours_decimal, employee, soumission_ids').contains('soumission_ids', [soumissionId]),
      db.from('clockshark_time_entries').select('hours_decimal, employee').is('soumission_ids', null).eq('soumission_id', soumissionId),
    ]).then(([arr, legacy]: any[]) => {
      if (cancelled) return;
      let hrs = 0, cnt = 0;
      const perEmp = new Map<string, number>();
      const add = (name: string, h: number) => perEmp.set(name || '—', (perEmp.get(name || '—') || 0) + h);
      (arr.data || []).forEach((r: any) => { const n = (r.soumission_ids?.length) || 1; const h = (Number(r.hours_decimal) || 0) / n; hrs += h; cnt++; add(r.employee, h); });
      (legacy.data || []).forEach((r: any) => { const h = Number(r.hours_decimal) || 0; hrs += h; cnt++; add(r.employee, h); });
      setHours(hrs); setEntryCount(cnt);
      setByEmployee([...perEmp.entries()].map(([name, h]) => ({ name, hours: h })).sort((a, b) => b.hours - a.hours));
    });
    return () => { cancelled = true; };
  }, [soumissionId]);

  // Breakdown (vendant + coût estimé) = devis de référence sélectionné.
  useEffect(() => {
    if (!refId) { setBrk(null); return; }
    let cancelled = false;
    setLoading(true);
    db.from('soumissions').select('dynasty_breakdown, subtotal').eq('id', refId).single()
      .then(({ data }: any) => { if (!cancelled) setBrk(data?.dynasty_breakdown || null); })
      .catch(() => { if (!cancelled) setBrk(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refId]);

  // Coûtant matériaux facturé (somme des factures OCR du projet).
  useEffect(() => {
    if (!soumissionId) { setInvoicedMaterial(null); return; }
    let cancelled = false;
    loadProjectInvoices(soumissionId)
      .then(list => { if (!cancelled) setInvoicedMaterial(list.length ? list.reduce((s, i) => s + (Number(i.material_total) || 0), 0) : null); })
      .catch(() => { if (!cancelled) setInvoicedMaterial(null); });
    return () => { cancelled = true; };
  }, [soumissionId]);

  // Recherche debouncée de devis
  useEffect(() => {
    if (!showSearch) return;
    const q = search.trim();
    const t = setTimeout(() => {
      let query = db.from('soumissions').select('id, seq_number, first_name, last_name, formatted_address, subtotal').order('created_at', { ascending: false }).limit(20);
      if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,formatted_address.ilike.%${q}%`);
      query.then(({ data }: any) => setResults(data || []));
    }, 250);
    return () => clearTimeout(t);
  }, [search, showSearch]);

  const { totals, hasLines } = useMemo(() => breakdownFromDevis(brk), [brk]);

  // Coût RÉEL de main d'œuvre = heures × taux ; remplace l'estimé du devis.
  const laborCostEst = totals.main_oeuvre.cost;
  const laborCostReal = hours > 0 ? hours * rate : laborCostEst;
  // Matériaux : coûtant facturé (OCR) s'il existe, sinon estimé du devis.
  const matInvoiced = invoicedMaterial != null && invoicedMaterial > 0;
  const rows = CAT_META.map(m => {
    const sell = totals[m.key].sell;
    const cost = m.key === 'main_oeuvre' ? laborCostReal
      : m.key === 'materiau' && matInvoiced ? (invoicedMaterial as number)
      : totals[m.key].cost;
    return { ...m, sell, cost, margin: sell - cost };
  });
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalSell = rows.reduce((s, r) => s + r.sell, 0) || (Number(revenue) || 0);
  const totalMargin = totalSell - totalCost;
  const marginPct = totalSell > 0 ? (totalMargin / totalSell) * 100 : null;
  const closed = status === 'done' || status === 'invoiced';

  const persistRate = (v: number) => { setRate(v); try { saveSettings({ ...loadSettings(), hourlyRate: v }); } catch { /* quota */ } };
  const colMargin = (v: number) => v >= 0 ? '#34d399' : '#f87171';
  // Colonnes : Poste · Vendant (gauche) · Coût (droite) · Marge
  const grid = '1.4fr 1fr 1fr 1fr';

  return (
    <div>
      {/* ── Devis de référence (style « Soumissions sauvegardées ») ── */}
      <div style={{ background: 'rgba(20,20,40,0.6)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <FileText size={14} style={{ color: '#818cf8' }} />
            <span style={sLabel}>Devis de référence</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc' }}>{refLabel || (refId === soumissionId ? 'ce projet' : refId ? '—' : 'aucun')}</span>
            {refId !== soumissionId && (
              <button onClick={() => { setRefId(soumissionId || null); setRefLabel(null); }} title="Revenir au devis du projet"
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><X size={13} /></button>
            )}
          </div>
          <button onClick={() => setShowSearch(s => !s)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: showSearch ? '#a5b4fc' : '#9ca3af', background: showSearch ? 'rgba(99,102,241,0.15)' : 'transparent', border: '1px solid ' + (showSearch ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'), borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            <Search size={12} /> Changer
          </button>
        </div>

        {showSearch && (
          <div style={{ marginTop: 10 }}>
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#4b5563' }} />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par nom, adresse ou numéro…"
                style={{ ...sInput, fontFamily: 'monospace', padding: '8px 10px 8px 32px', width: '100%' }} />
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'rgba(25,25,50,0.8)', position: 'sticky', top: 0 }}>
                    <th style={sTh}>#</th><th style={sTh}>Client</th><th style={sTh}>Adresse</th><th style={{ ...sTh, textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => {
                    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Sans nom';
                    return (
                      <tr key={r.id} onClick={() => { setRefId(r.id); setRefLabel(`#${r.seq_number ?? '—'} · ${name}`); setShowSearch(false); }}
                        style={{ borderTop: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer', background: r.id === refId ? 'rgba(99,102,241,0.1)' : 'transparent' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
                        onMouseLeave={e => (e.currentTarget.style.background = r.id === refId ? 'rgba(99,102,241,0.1)' : 'transparent')}>
                        <td style={{ ...sTd, color: '#a5b4fc', fontWeight: 600 }}>{r.seq_number ?? '—'}</td>
                        <td style={{ ...sTd, color: '#d1d5db', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</td>
                        <td style={{ ...sTd, color: '#9ca3af', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.formatted_address?.split(',').slice(0, 2).join(',') || '—'}</td>
                        <td style={{ ...sTd, textAlign: 'right', color: '#34d399', fontWeight: 600, fontFamily: 'monospace' }}>{r.subtotal ? fmt(r.subtotal) : '—'}</td>
                      </tr>
                    );
                  })}
                  {results.length === 0 && <tr><td colSpan={4} style={{ ...sTd, textAlign: 'center', color: '#9ca3af', padding: 16 }}>Aucun devis trouvé</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Marge globale ── */}
      <div style={{ background: totalMargin >= 0 ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, border: `1px solid ${totalMargin >= 0 ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.25)'}`, textAlign: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: colMargin(totalMargin), fontFamily: 'monospace' }}>{fmt(totalMargin)}</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          <Calculator size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          Marge {marginPct != null ? `· ${marginPct.toFixed(1)} %` : ''} · vendant {fmt(totalSell)} − coût {fmt(totalCost)}
        </div>
      </div>

      {/* ── Tableau Vendant | Coût par catégorie ── */}
      <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: '8px 12px', background: 'rgba(25,25,50,0.8)' }}>
          <span style={sTh}>Poste</span>
          <span style={{ ...sTh, textAlign: 'right', color: '#fbbf24' }}>Vendant</span>
          <span style={{ ...sTh, textAlign: 'right', color: '#f87171' }}>Coût</span>
          <span style={{ ...sTh, textAlign: 'right' }}>Marge</span>
        </div>
        {rows.map(r => {
          const isLabor = r.key === 'main_oeuvre';
          const expandable = isLabor && byEmployee.length > 0;
          return (
            <React.Fragment key={r.key}>
              <div onClick={expandable ? () => setLaborOpen(o => !o) : undefined}
                style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.04)', alignItems: 'center', cursor: expandable ? 'pointer' : 'default' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#d1d5db' }}>
                  {expandable
                    ? (laborOpen ? <ChevronDown size={13} style={{ color: '#9ca3af', flexShrink: 0 }} /> : <ChevronRight size={13} style={{ color: '#9ca3af', flexShrink: 0 }} />)
                    : <span style={{ width: 13, flexShrink: 0 }} />}
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: r.color, flexShrink: 0 }} />{r.label}
                  {isLabor && hours > 0 && <span style={{ fontSize: 10, color: '#6b7280' }}>({hours.toFixed(1)} h · réel{expandable ? ` · ${byEmployee.length} empl.` : ''})</span>}
                  {r.key === 'materiau' && matInvoiced && <span style={{ fontSize: 10, color: '#fbbf24' }}>(facturé)</span>}
                </span>
                <span style={{ textAlign: 'right', color: '#fcd34d', fontSize: 12.5, fontFamily: 'monospace' }}>{fmt(r.sell)}</span>
                <span style={{ textAlign: 'right', color: '#fca5a5', fontSize: 12.5, fontFamily: 'monospace' }}>{fmt(r.cost)}</span>
                <span style={{ textAlign: 'right', color: colMargin(r.margin), fontSize: 12.5, fontFamily: 'monospace' }}>{fmt(r.margin)}</span>
              </div>
              {/* Détail dépliable : total d'heures par employé */}
              {isLabor && laborOpen && byEmployee.map(e => (
                <div key={e.name} style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: '5px 12px 5px 32px', borderTop: '1px solid rgba(255,255,255,0.02)', background: 'rgba(255,255,255,0.015)', alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, color: '#9ca3af' }}>↳ {e.name}</span>
                  <span style={{ textAlign: 'right', fontSize: 11.5, color: '#cbd5e1', fontFamily: 'monospace' }}>{e.hours.toFixed(1)} h</span>
                  <span style={{ textAlign: 'right', fontSize: 11.5, color: '#fca5a5', fontFamily: 'monospace' }}>{fmt(e.hours * rate)}</span>
                  <span />
                </div>
              ))}
            </React.Fragment>
          );
        })}
        <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>TOTAL</span>
          <span style={{ textAlign: 'right', color: '#fbbf24', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(totalSell)}</span>
          <span style={{ textAlign: 'right', color: '#f87171', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(totalCost)}</span>
          <span style={{ textAlign: 'right', color: colMargin(totalMargin), fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(totalMargin)}</span>
        </div>
      </div>

      {/* ── Taux horaire (sert au coût réel de main d'œuvre) ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 2px 0', gap: 10 }}>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>Taux horaire main d'œuvre ($/h)</span>
        <input type="number" min={0} step={1} value={rate || ''} onChange={e => persistRate(Number(e.target.value) || 0)}
          style={{ ...sInput, padding: '6px 10px', width: 100, textAlign: 'right', fontFamily: 'monospace', colorScheme: 'dark' }} />
      </div>

      {/* ── Factures matériaux (OCR par lot) ── */}
      {soumissionId && (
        <div style={{ marginTop: 12, background: 'rgba(20,20,40,0.6)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', padding: 12 }}>
          <div onClick={() => setShowInvoices(s => !s)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            {showInvoices ? <ChevronDown size={14} style={{ color: '#9ca3af' }} /> : <ChevronRight size={14} style={{ color: '#9ca3af' }} />}
            <FileText size={14} style={{ color: '#818cf8' }} />
            <span style={sLabel}>Factures matériaux (OCR)</span>
            {invoicedMaterial != null && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#fbbf24', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(invoicedMaterial)}</span>}
          </div>
          {showInvoices && (
            <div style={{ marginTop: 10 }}>
              <InvoiceBatchDrop soumissionId={soumissionId} onChange={(t, inv) => setInvoicedMaterial(inv.length > 0 ? t : null)} />
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>Chargement du devis…</div>}
      {!loading && !hasLines && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
          Ce devis n'a pas de lignes catégorisées. Choisis un autre <b style={{ color: '#a5b4fc' }}>devis de référence</b>, ou catégorise les postes (Matériaux / Main d'œuvre) dans la section « Soumission complète ».
        </div>
      )}
      {hours === 0 && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
          Coût main d'œuvre = <b>estimé du devis</b> (aucune heure pointée). Assigne les heures dans <b style={{ color: '#a5b4fc' }}>Timesheets</b> pour le coût réel.
        </div>
      )}
      <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 8 }}>
        Vendant &amp; coût estimé par catégorie = lignes du devis de référence. Coût main d'œuvre = heures réelles × taux dès qu'elles sont pointées{entryCount > 0 ? ` (${entryCount} pointage${entryCount > 1 ? 's' : ''})` : ''}.
      </div>

      {!closed && onMarkDone && (
        <button onClick={onMarkDone}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)', cursor: 'pointer' }}>
          <CheckCircle2 size={14} /> Marquer le projet terminé
        </button>
      )}
    </div>
  );
};

export default ProjectCloseout;
