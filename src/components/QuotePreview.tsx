import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FileDown, Loader2, StickyNote, FileText, ListChecks, Plus, X, Move, ChevronLeft, ChevronRight, Calculator } from 'lucide-react';
import type { DynastyQuote, QuoteLine } from '@/lib/dynasty-calculator';
import SmartTextEditor, { resolveTemplate } from '@/components/SmartTextEditor';
import { useIsMobile } from '@/hooks/use-mobile';
import EstimatePaymentWindow from '@/features/financing-calculator/EstimatePaymentWindow';

interface QuotePreviewProps {
  clientFirst: string;
  clientLast: string;
  addressText: string;
  seqNumber: number | null;
  quote: DynastyQuote | null;
  workType: string;
  effectiveAreaSqft: number;
  slopeCategory: string;
  roofType: string;
  selectedGamme: string;
  selectedMarque: string;
  quoteNotes: string;
  onQuoteNotesChange: (v: string) => void;
  paymentTerms: string;
  onPaymentTermsChange: (v: string) => void;
  lineCategories?: Record<number, string>;
  /** Liste complète des exclusions disponibles */
  exclusionsList?: string[];
  /** Map item -> coché. Les éléments cochés sont injectés dans la section EXCLUSIONS de l'aperçu */
  exclusionsChecked?: Record<string, boolean>;
  /** Setters pour gérer la liste d'exclusions depuis la sidebar */
  onExclusionsListChange?: (next: string[]) => void;
  onExclusionsCheckedChange?: (next: Record<string, boolean>) => void;
  /** Liste d'exclusions par défaut (non supprimables) */
  defaultExclusions?: string[];
  /** Variables disponibles pour les éditeurs (drag-and-drop, suggestions, formules) */
  smartVariables?: any[];
  smartValues?: Record<string, string | number>;
  /** Confirmation map for each section (validation checkboxes inline with headers) */
  confirmed?: { header: boolean; notes: boolean; terms: boolean; exclusions: boolean };
  onConfirmChange?: (key: 'header' | 'notes' | 'terms' | 'exclusions', value: boolean) => void;
  /** Champs éditables affichés dans l'en-tête (poussés vers QBO) */
  headerFields?: QuoteHeaderFields;
  onHeaderFieldsChange?: (next: QuoteHeaderFields) => void;
}

export type ContractType = 'FORFAITAIRE' | 'BUDGÉTAIRE' | 'COST PLUS';
export interface QuoteHeaderFields {
  quoteDate: string;          // YYYY-MM-DD
  validityDays: number;       // Date d'expiration = quoteDate + validityDays
  devisNo: string;            // Nº du devis (DocNumber QBO, max 21)
  contractType: ContractType;
  projectAddress: string;     // PROJET (custom field QBO, max 31)
  projectNo: string;          // NO. PROJET (custom field QBO, max 31)
}

export const QBO_CUSTOM_FIELD_MAX = 31;
export const QBO_DOC_NUMBER_MAX = 21;

export const defaultHeaderFields = (opts: {
  seqNumber: number | null;
  addressText: string;
}): QuoteHeaderFields => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    quoteDate: today,
    validityDays: 16,
    devisNo: opts.seqNumber ? `VB-${opts.seqNumber}` : '',
    contractType: 'FORFAITAIRE',
    projectAddress: (opts.addressText || '').toUpperCase().slice(0, QBO_CUSTOM_FIELD_MAX),
    projectNo: '',
  };
};


const fmt2 = (n: number) => n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => Math.round(n).toLocaleString('fr-CA');

const DEFAULT_PAYMENT_TERMS = `**VOIR GARANTIE {MARQUE} EN PJ**

- TOITURES VB s'engage à exécuter les travaux précités en conformité avec ses obligations légales et selon les recommandations du fournisseur ({MARQUE})

- 50% du total du contrat payable 5 jours avant le début des travaux.
- 50% du total du contrat payable une fois les travaux complétés.

- Si le Client omet de verser, à échéance, quelque somme due en vertu du présent contrat, le solde impayé porte intérêt au taux annuel de douze pour cent (12%) l'an.`;

const DEFAULT_NOTES = `EXCLUSIONS :
- Installation de CP au toit
- Conteneur fournis par le clients

-
Travaux supplémentaires à Temps et Matériel :
- Charpentier-menuisier/Couvreur (Compagnon) : 90$/h
- Charpentier-menuisier/Couvreur (Apprentie) : 85$/h
- Gestion & administration : 10%`;

/* ── A4 page dimensions (modèle officiel Toitures VB) ── */
const PAGE_W = '210mm';
const PAGE_H = '297mm';
const PAGE_PAD = '15mm';
const BANNER = '#7a7a7a';
const LABEL_RED = '#c00';

const pageStyle: React.CSSProperties = {
  width: PAGE_W,
  minHeight: PAGE_H,
  background: '#fff',
  padding: PAGE_PAD,
  boxSizing: 'border-box',
  color: '#000',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: '10pt',
  position: 'relative',
  boxShadow: '0 2px 18px rgba(0,0,0,0.18)',
  pageBreakAfter: 'always' as any,
};

/* ── Editable notes/terms block, isolated so the heavy PDF preview re-render
   below does not steal focus from the textareas while typing. ── */
interface NotesTermsEditorProps {
  quoteNotes: string;
  onQuoteNotesChange: (v: string) => void;
  paymentTerms: string;
  onPaymentTermsChange: (v: string) => void;
  variables?: any[];
  values?: Record<string, string | number>;
}
const NotesTermsEditor: React.FC<NotesTermsEditorProps> = React.memo(({
  quoteNotes, onQuoteNotesChange, paymentTerms, onPaymentTermsChange,
  variables, values,
}) => {
  // Initialize textarea values with defaults if empty, so the user can
  // click on any line to position their cursor and edit (instead of just
  // seeing a non-editable placeholder).
  const notesValue = quoteNotes && quoteNotes.length > 0 ? quoteNotes : DEFAULT_NOTES;
  const termsValue = paymentTerms && paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;
  React.useEffect(() => {
    if (!quoteNotes) onQuoteNotesChange(DEFAULT_NOTES);
    if (!paymentTerms) onPaymentTermsChange(DEFAULT_PAYMENT_TERMS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (variables && variables.length > 0) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <SmartTextEditor
          label="Notes du devis (Customer Memo)"
          value={notesValue}
          onChange={onQuoteNotesChange}
          variables={variables as any}
          values={values || {}}
          rows={8}
          paletteCompact
        />
        <SmartTextEditor
          label="Modalités de paiement (Terms)"
          value={termsValue}
          onChange={onPaymentTermsChange}
          variables={variables as any}
          values={values || {}}
          rows={8}
          paletteCompact
        />
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Notes du devis (Customer Memo)
        </label>
        <textarea
          value={notesValue}
          onChange={e => onQuoteNotesChange(e.target.value)}
          rows={6}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, color: '#e2e8f0', fontSize: 11, padding: '8px 10px',
            fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
          }}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Modalités de paiement (Terms)
        </label>
        <textarea
          value={termsValue}
          onChange={e => onPaymentTermsChange(e.target.value)}
          rows={6}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, color: '#e2e8f0', fontSize: 11, padding: '8px 10px',
            fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
          }}
        />
      </div>
    </div>
  );
});
NotesTermsEditor.displayName = 'NotesTermsEditor';

const QuotePreview: React.FC<QuotePreviewProps> = ({
  clientFirst, clientLast, addressText, seqNumber, quote,
  workType, effectiveAreaSqft, slopeCategory, roofType,
  selectedGamme, selectedMarque,
  quoteNotes, onQuoteNotesChange,
  paymentTerms, onPaymentTermsChange,
  lineCategories,
  exclusionsList = [],
  exclusionsChecked = {},
  onExclusionsListChange,
  onExclusionsCheckedChange,
  defaultExclusions = [],
  smartVariables,
  smartValues,
  confirmed,
  onConfirmChange,
  headerFields,
  onHeaderFieldsChange,
}) => {
  const [downloading, setDownloading] = useState(false);
  const [estimateOpen, setEstimateOpen] = useState(false);
  // Petite case "Confirmer" affichée à droite de chaque en-tête de section
  const renderConfirmBox = (key: 'header' | 'notes' | 'terms' | 'exclusions') => {
    if (!confirmed || !onConfirmChange) return null;
    const checked = !!confirmed[key];
    return (
      <label
        onClick={(e) => e.stopPropagation()}
        title={checked ? 'Section confirmée' : 'Cocher pour confirmer cette section'}
        style={{
          marginLeft: 'auto',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
          fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
          background: checked ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
          border: '1px solid ' + (checked ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.1)'),
          color: checked ? '#86efac' : '#cbd5e1',
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onConfirmChange(key, e.target.checked)}
          style={{ width: 12, height: 12, cursor: 'pointer', accentColor: '#22c55e', margin: 0 }}
        />
        {checked ? 'CONFIRMÉ' : 'CONFIRMER'}
      </label>
    );
  };
  const sectionWrapperStyle = (
    key: 'header' | 'notes' | 'terms' | 'exclusions',
    activeMatch: boolean,
  ): React.CSSProperties => {
    const isConfirmed = !!confirmed?.[key];
    const border = isConfirmed
      ? '1px solid rgba(34,197,94,0.55)'
      : '1px solid ' + (activeMatch ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.06)');
    return {
      padding: 8, borderRadius: 8, border,
      background: isConfirmed ? 'rgba(34,197,94,0.04)' : 'transparent',
      transition: 'border-color 0.2s, background 0.2s',
    };
  };
  const lockedContentStyle = (
    key: 'header' | 'notes' | 'terms' | 'exclusions',
  ): React.CSSProperties =>
    confirmed?.[key]
      ? { opacity: 0.55, pointerEvents: 'none', userSelect: 'none' }
      : {};
  // Section actuellement focusée dans la sidebar — déclenche un surlignage
  // visuel sur la zone correspondante du PDF (notes, terms, exclusions).
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [newExclusionText, setNewExclusionText] = useState('');
  // Page courante affichée dans la fenêtre d'aperçu (1-based)
  const [activePage, setActivePage] = useState(1);
  // En-tête éditable (Soumission/Marque/Garantie/Superficie/Prix). Supporte les
  // variables {{...}} via SmartTextEditor + resolveTemplate.
  const DEFAULT_PROJECT_HEADER = `Soumission - {{client_name}} - {{address}}
**BARDEAUX D'ASPHALTE {{marque}} {{gamme}} - COULEUR À VALIDER AVEC LE CLIENT**
**GARANTIE 40 - VOIR LA GARANTIE {{marque}} EN PJ**
**MAIN D'OEUVRE GARANTIE 5 ANS - VOIR LE CERTIFICAT TOITURES VB EN PJ**
SUPERFICIE AU SOL : {{superficie}} — PENTE {{pente}}
SUPERFICIE CORRIGÉE + CONTINGENCE 5% : {{superficie}}
PRIX/PAQUET : {{prix_paquet}}$
PRIX/PI² : {{prix_pi2}}$/PI²`;
  const [projectHeader, setProjectHeader] = useState<string>(DEFAULT_PROJECT_HEADER);
  const isMobile = useIsMobile();
  // Largeur ajustable de la sidebar "Édition de la soumission" (drag du bord gauche).
  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const sidebarResizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const onSidebarResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    sidebarResizeRef.current = { startX: e.clientX, startW: sidebarWidth };
  }, [sidebarWidth]);
  const onSidebarResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = sidebarResizeRef.current; if (!d) return;
    // Glisser vers la GAUCHE élargit (sidebar à droite du PDF).
    const next = Math.min(720, Math.max(260, d.startW + (d.startX - e.clientX)));
    setSidebarWidth(next);
  }, []);
  const onSidebarResizeUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try { (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); } catch {}
    sidebarResizeRef.current = null;
  }, []);
  // Zoom + pan ("freeze" / drag) controls for the PDF preview viewport
  const [previewZoom, setPreviewZoom] = useState(0.72);
  const [panMode, setPanMode] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const onViewportPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panMode) return;
    const el = viewportRef.current; if (!el) return;
    el.setPointerCapture(e.pointerId);
    panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
  }, [panMode]);
  const onViewportPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current; const d = panRef.current;
    if (!el || !d) return;
    el.scrollLeft = d.sl - (e.clientX - d.x);
    el.scrollTop = d.st - (e.clientY - d.y);
  }, []);
  const onViewportPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current; if (el) { try { el.releasePointerCapture(e.pointerId); } catch {} }
    panRef.current = null;
  }, []);
  // En mode déplacement, la molette ajuste le zoom (déplacement + zoom combinés).
  // On attache un listener natif non-passif pour pouvoir appeler preventDefault()
  // — l'onWheel React est passif et ne peut pas bloquer le scroll de la page.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!panMode) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setPreviewZoom(z => Math.max(0.3, Math.min(3, +(z + delta).toFixed(2))));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler as any);
  }, [panMode]);
  const previewRef = useRef<HTMLDivElement>(null);
  // Fallback si le parent ne fournit pas headerFields
  const _today = new Date().toISOString().slice(0, 10);
  const hf: QuoteHeaderFields = headerFields || {
    quoteDate: _today,
    validityDays: 16,
    devisNo: seqNumber ? `VB-${seqNumber}` : '',
    contractType: 'FORFAITAIRE',
    projectAddress: (addressText || '').toUpperCase().slice(0, QBO_CUSTOM_FIELD_MAX),
    projectNo: '',
  };
  const updateHF = (patch: Partial<QuoteHeaderFields>) => {
    if (!onHeaderFieldsChange) return;
    onHeaderFieldsChange({ ...hf, ...patch });
  };
  // Édition inline directement dans l'aperçu : champs surlignés en jaune.
  // data-export-text → remplacé par du texte propre au téléchargement (voir handleDownloadHtml).
  const editable = !!onHeaderFieldsChange;
  const hfBox: React.CSSProperties = {
    font: 'inherit', color: '#111', background: '#fde047',
    border: '1px solid #ca8a04', borderRadius: 3, padding: '0 4px',
    outline: 'none', verticalAlign: 'baseline', maxWidth: '100%',
  };
  const dateStr = hf.quoteDate;
  const expiryStr = (() => {
    if (!hf.quoteDate) return '';
    const d = new Date(hf.quoteDate + 'T00:00:00');
    d.setDate(d.getDate() + (Number(hf.validityDays) || 0));
    return d.toISOString().slice(0, 10);
  })();
  const refId = hf.devisNo || (seqNumber ? `${seqNumber}_REV0` : '—');
  const projectNo = hf.projectNo || '';
  const contractTypeLabel = hf.contractType;
  const projectAddrLabel = hf.projectAddress;
  const clientName = `${clientFirst} ${clientLast}`.trim() || '—';
  const addr = addressText || '—';
  const addrParts = addr.split(',');
  const addrLine1 = addrParts[0]?.trim() || '';
  const addrLine2 = addrParts.slice(1).join(',').trim();

  const gamme = selectedGamme || 'Dynasty';
  const marque = selectedMarque || 'IKO';

  const allLines = quote?.lines || [];
  const slopeLabel = slopeCategory === 'aucune' ? '0-4/12' : slopeCategory === 'legere' ? '4-7/12' : slopeCategory === 'moderee' ? '8-12/12' : '12/12+';

  // Group lines into MAIN D'OEUVRE / MATÉRIAUX / AUTRES sections (mirrors QBO push logic)
  const sectionOf = (idx: number): 'labor' | 'material' | 'other' => {
    const cat = lineCategories?.[idx];
    if (cat === 'main_oeuvre' || cat === 'sous_traitance') return 'labor';
    if (cat === 'materiau' || cat === 'equipement' || cat === 'transport' || cat === 'divers') return 'material';
    return 'other';
  };
  const indexedLines = allLines.map((line, i) => ({ line, idx: i, section: sectionOf(i) }));
  const laborLines = indexedLines.filter(x => x.section === 'labor');
  const materialLines = indexedLines.filter(x => x.section === 'material');
  const otherLines = indexedLines.filter(x => x.section === 'other');
  const sumOf = (arr: typeof indexedLines) => arr.reduce((s, x) => s + (x.line.total_displayed || 0), 0);
  const laborSubtotal = sumOf(laborLines);
  const materialSubtotal = sumOf(materialLines);

  const correctedArea = effectiveAreaSqft > 0 ? Math.round(effectiveAreaSqft * (quote?.slope_factor || 1)) : 0;
  const prixPi2 = correctedArea > 0 && quote ? (quote.subtotal_displayed / correctedArea).toFixed(2) : '—';
  // PRIX/PAQUET = price for one bundle (paquet) of shingles. A bundle
  // typically covers ~33.33 sq.ft. We derive it from the bardeau line's
  // unit cost when available, otherwise show "—".
  const bardeauLine = quote?.lines.find(l => l.description.toLowerCase().includes('bardeau'));
  let prixPaquet: string = '—';
  if (bardeauLine && bardeauLine.rate > 0) {
    const unit = (bardeauLine.unit || '').toLowerCase();
    if (unit.includes('paquet') || unit.includes('bundle')) {
      prixPaquet = bardeauLine.rate.toFixed(2);
    } else if (unit.includes('pi2') || unit.includes('sq')) {
      prixPaquet = (bardeauLine.rate * 33.33).toFixed(2);
    } else {
      prixPaquet = (bardeauLine.rate * 33.33).toFixed(2);
    }
  }

  // Résolution des variables {{...}} et formules {{= ...}} via SmartTextEditor.resolveTemplate
  // (utilisé par le rendu PDF). On garde aussi le legacy {MARQUE}.
  // On enrichit les valeurs avec quelques champs spécifiques à l'en-tête (prix/paquet, prix/pi², superficie corrigée).
  const mergedSmartValues: Record<string, string | number> = {
    ...(smartValues || {}),
    prix_paquet: prixPaquet,
    prix_pi2: prixPi2,
    superficie_corrigee: correctedArea > 0 ? `${fmtInt(correctedArea)} pi²` : '—',
    pente_ratio: slopeLabel,
  };
  const resolveAll = (s: string) => {
    let out = (s || '').replace(/\{MARQUE\}/g, marque);
    out = resolveTemplate(out, mergedSmartValues);
    return out;
  };
  const resolvedTerms = resolveAll(paymentTerms || DEFAULT_PAYMENT_TERMS);
  const baseNotes = resolveAll(quoteNotes || DEFAULT_NOTES);
  // Inject les exclusions cochées : remplace le bloc EXCLUSIONS existant si présent,
  // sinon préfixe le contenu avec une nouvelle section EXCLUSIONS.
  const checkedExclusions = exclusionsList.filter(x => exclusionsChecked[x]);
  let resolvedNotes = baseNotes;
  if (checkedExclusions.length > 0) {
    const exclusionsBlock = 'EXCLUSIONS :\n' + checkedExclusions.map(x => `- ${x}`).join('\n');
    if (/EXCLUSIONS\s*:/i.test(resolvedNotes)) {
      // Remplace le bloc EXCLUSIONS existant (jusqu'à la prochaine ligne vide)
      resolvedNotes = resolvedNotes.replace(/EXCLUSIONS\s*:[\s\S]*?(?=\n\s*\n|$)/i, exclusionsBlock);
    } else {
      resolvedNotes = exclusionsBlock + '\n\n' + resolvedNotes;
    }
  }

  // L'aperçu PDF n'est plus éditable inline : on rend les champs comme du
  // texte brut. Les modifications passent par la sidebar (notes, termes,
  // exclusions) qui mettent à jour l'état parent.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const Editable: React.FC<{
    field: string; value: string; multiline?: boolean; align?: 'left' | 'right';
    width?: number | string; bold?: boolean;
  }> = ({ value }) => <>{value}</>;

  /* ── SVG logo (reused on each page header) ── */
  const logoSvg = (
    <svg style={{ width: 160, height: 'auto' }} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 510">
      <polygon points="869.24 319.47 484.51 319.47 575.29 248.54 717.99 248.54 663.9 179.32 606.56 105.93 333.25 319.47 210.76 319.47 290.2 257.41 560.12 46.52 606.62 10.18 619.66 0 668.69 62.76 869.24 319.47"/>
      <path d="M102.13,416.51v14.77h-42.68v70.46h-16.91v-70.46H0v-14.77h102.13Z"/>
      <path d="M163.65,504.69c-31.17,0-55.25-14.27-55.25-45.82v-.13c0-30.36,22.75-45.63,55.25-45.63s55.18,15.27,55.18,45.63v.13c0,31.55-24.07,45.82-55.18,45.82ZM163.65,428.58c-22.25,0-38.65,8.55-38.65,30.29s16.34,30.36,38.65,30.36,38.59-8.55,38.59-30.36-16.4-30.29-38.59-30.29Z"/>
      <path d="M231.39,501.74v-85.23h16.59v85.23h-16.59Z"/>
      <path d="M362.68,416.51v14.77h-42.68v70.46h-16.91v-70.46h-42.55v-14.77h102.13Z"/>
      <path d="M423.26,504.56h-.25c-25.33,0-47.77-8.36-47.77-31.8v-56.25h16.59v56.88c0,8.17,9.8,15.34,31.17,15.34h.25c21.24,0,31.11-7.17,31.11-15.34v-56.88h16.59v56.25c0,23.63-22.44,31.8-47.7,31.8Z"/>
      <path d="M591.24,440.46v6.54c0,7.35-2.07,12.76-6.28,16.66,4.27,3.96,6.35,9.43,6.35,16.78v21.31h-16.91v-21.31c0-9.24-10.62-9.3-18.04-9.3h-55.87v30.61h-16.84l-.13-85.23,72.4-.13c24.89,0,35.32,6.6,35.32,24.07ZM574.34,446.99v-6.54c0-9.24-10.62-9.3-18.04-9.3h-55.81v25.14h55.81c7.42,0,18.04-.06,18.04-9.3Z"/>
      <path d="M603.87,501.61v-84.98l88.12-.13v14.77h-71.21v20.49l60.52.13v14.64h-60.52v20.43h71.21v14.77l-88.12-.13Z"/>
      <path d="M704.73,471.07h16.72c1.19,14.39,14.33,18.54,38.46,18.54,27.28,0,39.34-3.83,39.34-11.56s-17.98-9.81-43.93-12.19c-29.92-2.7-50.78-8.17-50.78-26.27s18.98-26.65,56.25-26.65,54.74,11.57,55.12,33.63h-16.66c-1.19-14.39-14.39-18.54-38.46-18.54-27.28,0-39.34,3.77-39.34,11.57,0,6.98,15.46,9.37,37.77,11.5,32.31,2.51,56.94,7.86,56.94,26.96s-18.98,26.65-56.25,26.65-54.74-11.44-55.18-33.62Z"/>
      <path d="M921,501.61h-20.18l-44.18-85.29h19.73l34.69,67.06,34.76-67.06h19.67l-44.5,85.29Z"/>
      <path d="M1073.72,459.12c4.21,3.9,6.28,9.43,6.28,16.66v1.89c0,17.47-10.43,24.07-35.32,24.07l-72.4-.13v-84.98l72.4-.13c24.89,0,35.32,6.6,35.32,24.07v1.89c0,7.23-2.07,12.76-6.28,16.66ZM1063.09,442.47v-1.89c0-9.24-10.62-9.3-18.04-9.3h-55.87v20.43h55.87c7.42,0,18.04-.06,18.04-9.24ZM1063.09,477.66v-1.89c0-9.18-10.62-9.24-18.04-9.24h-55.87v20.43h55.87c7.42,0,18.04-.06,18.04-9.3Z"/>
    </svg>
  );

  /* ── Mini header for continuation pages ── */
  const continuationHeader = (pageNum: number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 8, borderBottom: '2px solid #636363' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {logoSvg}
      </div>
      <div style={{ textAlign: 'right', fontSize: '8pt', color: '#636363' }}>
        <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>SOUMISSION {refId}</div>
        <div>Page {pageNum}</div>
      </div>
    </div>
  );

  const handleDownloadHtml = useCallback(() => {
    if (!previewRef.current) return;
    setDownloading(true);
    try {
      // Remplace les champs éditables inline par leur valeur texte → export propre
      // (pas d'<input>/<select> ni de surbrillance jaune dans le fichier téléchargé).
      const clone = previewRef.current.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-export-text]').forEach((el) => {
        const span = clone.ownerDocument.createElement('span');
        span.textContent = el.getAttribute('data-export-text') || '';
        el.replaceWith(span);
      });
      const innerHtml = clone.innerHTML;
      const fullHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Soumission ${refId} – Toitures VB</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Helvetica Neue, Helvetica, Arial, sans-serif; font-size: 9pt; color: #1a1a1a; background: #d0d0d0; }
.quote-pages { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 20px; }
.quote-page { width: 210mm; min-height: 297mm; background: #fff; padding: 15mm; box-shadow: 0 2px 18px rgba(0,0,0,0.18); page-break-after: always; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; }
@page { size: A4; margin: 15mm; }
@media print {
  body { background: #fff; }
  .quote-pages { gap: 0; padding: 0; }
  .quote-page { box-shadow: none; margin: 0; }
}
</style>
</head>
<body>
${innerHtml}
</body>
</html>`;
      const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Devis_${refId.replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }, [refId]);

  return (
    <div data-active-section={activeSection || ''} style={{
      background: 'rgba(20,20,40,0.6)', borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.06)',
      marginBottom: 12, overflow: 'hidden',
    }}>
      {/* Highlight CSS pour les zones du PDF liées à la sidebar */}
      <style>{`
        [data-active-section="notes"] [data-quote-zone="notes"],
        [data-active-section="terms"] [data-quote-zone="terms"],
        [data-active-section="exclusions"] [data-quote-zone="notes"],
        [data-active-section="project-header"] [data-quote-zone="project-header"] {
          background: #fff8d6 !important;
          box-shadow: 0 0 0 3px #f59e0b, 0 4px 18px rgba(245,158,11,0.35);
          border-radius: 4px;
          transition: all .25s ease;
        }
        /* Affiche uniquement la page courante dans l'aperçu (le download
           récupère innerHTML sans ce wrapper et exporte donc toutes les pages). */
        [data-active-page="1"] .quote-page:nth-of-type(2) { display: none !important; }
        [data-active-page="2"] .quote-page:nth-of-type(1) { display: none !important; }
      `}</style>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `minmax(0, 1fr) ${sidebarWidth}px 200px`, gap: 14, padding: isMobile ? '10px' : '12px 14px 14px', alignItems: 'stretch' }}>
        {/* ═══════════ COLONNE PDF ═══════════ */}
        <div style={{ minWidth: 0, overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
          {editable && (
            <div style={{ marginBottom: 8, fontSize: 11, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Champs surlignés en jaune = modifiables directement dans l'aperçu.</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', marginBottom: 10, gap: 10 }}>
            <div style={{ justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {/* Navigation page 1 ↔ 2 (flèches uniquement) */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 2 }}>
                <button type="button" onClick={() => setActivePage(p => Math.max(1, p - 1))} disabled={activePage <= 1} title="Page précédente" style={{ ...zoomCtrlBtn(), opacity: activePage <= 1 ? 0.4 : 1, cursor: activePage <= 1 ? 'not-allowed' : 'pointer' }}><ChevronLeft size={14} /></button>
                <div style={{ minWidth: 60, textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#e2e8f0', padding: '0 6px' }}>Page {activePage} / 2</div>
                <button type="button" onClick={() => setActivePage(p => Math.min(2, p + 1))} disabled={activePage >= 2} title="Page suivante" style={{ ...zoomCtrlBtn(), opacity: activePage >= 2 ? 0.4 : 1, cursor: activePage >= 2 ? 'not-allowed' : 'pointer' }}><ChevronRight size={14} /></button>
              </div>
              <button
                type="button"
                onClick={() => setPanMode(v => !v)}
                title={panMode ? 'Terminer le déplacement' : 'Déplacer + zoomer (glisser pour déplacer, molette pour zoomer)'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  border: '1px solid ' + (panMode ? 'rgba(245,158,11,0.55)' : 'rgba(255,255,255,0.12)'),
                  background: panMode ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.04)',
                  color: panMode ? '#0a0a14' : '#c7d2fe', cursor: 'pointer',
                }}
              >
                <Move size={12} /> {panMode ? `Fin (${Math.round(previewZoom * 100)}%)` : 'Déplacer / Zoomer'}
              </button>
            </div>
            <button onClick={handleDownloadHtml} disabled={downloading}
              style={{
                justifySelf: 'center',
                display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10,
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                border: '1px solid rgba(245,158,11,0.4)', color: '#fff',
                fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
                cursor: downloading ? 'wait' : 'pointer',
                opacity: downloading ? 0.7 : 1,
                boxShadow: '0 4px 12px rgba(245,158,11,0.25)',
              }}>
              {downloading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileDown size={14} />}
              Télécharger la soumission
            </button>
            <button onClick={() => setEstimateOpen(true)}
              title="Ouvre une fenêtre flottante pour estimer le paiement mensuel iFinance"
              style={{
                justifySelf: 'end',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 10,
                background: 'rgba(120,90,255,0.18)',
                border: '1px solid rgba(120,90,255,0.45)', color: '#c7d2fe',
                fontSize: 11, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer',
              }}>
              <Calculator size={14} />
              Estimer le montant de paiement
            </button>
          </div>
          <EstimatePaymentWindow
            open={estimateOpen}
            onClose={() => setEstimateOpen(false)}
            initialAmount={quote?.total_final ?? null}
          />
          <div
            ref={viewportRef}
            data-active-page={String(activePage)}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={onViewportPointerUp}
            onPointerCancel={onViewportPointerUp}
            style={{
              height: 'calc(297mm * 0.72 + 20px)',
              maxHeight: 'calc(100vh - 120px)',
              overflow: 'auto',
              background: 'rgba(0,0,0,0.25)', borderRadius: 8,
              display: 'flex', justifyContent: 'center',
              cursor: panMode ? (panRef.current ? 'grabbing' : 'grab') : 'auto',
              userSelect: panMode ? 'none' : 'auto',
              touchAction: panMode ? 'none' : 'auto',
            }}>
            <div ref={previewRef} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
              transform: `scale(${previewZoom})`, transformOrigin: 'top center',
              width: '210mm',
              pointerEvents: panMode ? 'none' : 'auto',
            }} className="quote-pages">

            {/* ═══════════ PAGE 1 ═══════════ */}
            <div className="quote-page" style={pageStyle}>
              {/* HEADER : Coordonnées entreprise + Logo */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div style={{ width: '50%', fontSize: '9.5pt', lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 4 }}>TOITURES VB INC.</div>
                  <div>297 rue Principale</div>
                  <div>Granby QC&nbsp;&nbsp;J2G 2W1</div>
                  <div>+14505213227</div>
                  <div>info@toituresvb.ca</div>
                </div>
                <div style={{ width: '45%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: '100%', maxWidth: '100%' }}>
                    <svg style={{ width: '100%', height: 'auto', display: 'block' }} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 510" preserveAspectRatio="xMidYMid meet">
                      <polygon points="869.24 319.47 484.51 319.47 575.29 248.54 717.99 248.54 663.9 179.32 606.56 105.93 333.25 319.47 210.76 319.47 290.2 257.41 560.12 46.52 606.62 10.18 619.66 0 668.69 62.76 869.24 319.47"/>
                      <path d="M102.13,416.51v14.77h-42.68v70.46h-16.91v-70.46H0v-14.77h102.13Z"/>
                      <path d="M163.65,504.69c-31.17,0-55.25-14.27-55.25-45.82v-.13c0-30.36,22.75-45.63,55.25-45.63s55.18,15.27,55.18,45.63v.13c0,31.55-24.07,45.82-55.18,45.82ZM163.65,428.58c-22.25,0-38.65,8.55-38.65,30.29s16.34,30.36,38.65,30.36,38.59-8.55,38.59-30.36-16.4-30.29-38.59-30.29Z"/>
                      <path d="M231.39,501.74v-85.23h16.59v85.23h-16.59Z"/>
                      <path d="M362.68,416.51v14.77h-42.68v70.46h-16.91v-70.46h-42.55v-14.77h102.13Z"/>
                      <path d="M423.26,504.56h-.25c-25.33,0-47.77-8.36-47.77-31.8v-56.25h16.59v56.88c0,8.17,9.8,15.34,31.17,15.34h.25c21.24,0,31.11-7.17,31.11-15.34v-56.88h16.59v56.25c0,23.63-22.44,31.8-47.7,31.8Z"/>
                      <path d="M591.24,440.46v6.54c0,7.35-2.07,12.76-6.28,16.66,4.27,3.96,6.35,9.43,6.35,16.78v21.31h-16.91v-21.31c0-9.24-10.62-9.3-18.04-9.3h-55.87v30.61h-16.84l-.13-85.23,72.4-.13c24.89,0,35.32,6.6,35.32,24.07ZM574.34,446.99v-6.54c0-9.24-10.62-9.3-18.04-9.3h-55.81v25.14h55.81c7.42,0,18.04-.06,18.04-9.3Z"/>
                      <path d="M603.87,501.61v-84.98l88.12-.13v14.77h-71.21v20.49l60.52.13v14.64h-60.52v20.43h71.21v14.77l-88.12-.13Z"/>
                      <path d="M704.73,471.07h16.72c1.19,14.39,14.33,18.54,38.46,18.54,27.28,0,39.34-3.83,39.34-11.56s-17.98-9.81-43.93-12.19c-29.92-2.7-50.78-8.17-50.78-26.27s18.98-26.65,56.25-26.65,54.74,11.57,55.12,33.63h-16.66c-1.19-14.39-14.39-18.54-38.46-18.54-27.28,0-39.34,3.77-39.34,11.57,0,6.98,15.46,9.37,37.77,11.5,32.31,2.51,56.94,7.86,56.94,26.96s-18.98,26.65-56.25,26.65-54.74-11.44-55.18-33.62Z"/>
                      <path d="M921,501.61h-20.18l-44.18-85.29h19.73l34.69,67.06,34.76-67.06h19.67l-44.5,85.29Z"/>
                      <path d="M1073.72,459.12c4.21,3.9,6.28,9.43,6.28,16.66v1.89c0,17.47-10.43,24.07-35.32,24.07l-72.4-.13v-84.98l72.4-.13c24.89,0,35.32,6.6,35.32,24.07v1.89c0,7.23-2.07,12.76-6.28,16.66ZM1063.09,442.47v-1.89c0-9.24-10.62-9.3-18.04-9.3h-55.87v20.43h55.87c7.42,0,18.04-.06,18.04-9.24ZM1063.09,477.66v-1.89c0-9.18-10.62-9.24-18.04-9.24h-55.87v20.43h55.87c7.42,0,18.04-.06,18.04-9.3Z"/>
                    </svg>
                  </div>
                </div>
              </div>

              {/* CLIENT + BANNIÈRES */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                <div style={{ width: '50%', fontSize: '9.5pt', lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 'bold', color: '#000', marginBottom: 4 }}>ADRESSE</div>
                  <div style={{ textTransform: 'uppercase' }}>{clientName}</div>
                  <div>{addrLine1}{addrLine1 && addrLine2 ? ',' : ''}</div>
                  {addrLine2 && <div>{addrLine2}</div>}
                </div>
                <div style={{ width: '45%' }}>
                  <div style={{ background: BANNER, color: '#fff', padding: '8px 12px', marginBottom: 8, fontSize: '10pt', fontWeight: 'bold' }}>
                    SOUMISSION {editable ? (
                      <input value={hf.devisNo} maxLength={QBO_DOC_NUMBER_MAX}
                        placeholder={seqNumber ? `${seqNumber}_REV0` : ''}
                        onChange={e => updateHF({ devisNo: e.target.value })}
                        data-export-text={refId}
                        style={{ ...hfBox, width: `${Math.max(refId.length, 5) + 1}ch` }} />
                    ) : refId}
                  </div>
                  <div style={{ background: BANNER, color: '#fff', padding: '8px 12px', marginBottom: 8, fontSize: '10pt' }}>
                    <b>DATE</b> {editable ? (
                      <input type="date" value={hf.quoteDate}
                        onChange={e => updateHF({ quoteDate: e.target.value })}
                        data-export-text={dateStr}
                        style={hfBox} />
                    ) : dateStr}
                  </div>
                  <div style={{ background: BANNER, color: '#fff', padding: '8px 12px', marginBottom: 8, fontSize: '10pt' }}>
                    <b>DATE D'EXPIRATION</b> {expiryStr}
                    {editable && (
                      <span style={{ fontSize: '8pt', marginLeft: 8 }}>· validité&nbsp;
                        <input type="number" min={0} max={365} value={hf.validityDays}
                          onChange={e => updateHF({ validityDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
                          data-export-text={`${hf.validityDays} j`}
                          style={{ ...hfBox, width: '4ch' }} />&nbsp;j
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* DIVIDER plein largeur */}
              <div style={{ borderTop: `4px solid ${BANNER}`, width: '100%', margin: '18px 0 10px 0' }} />

              {/* TYPE DE CONTRAT + PROJET + NO. PROJET */}
              <div style={{ fontSize: '9.5pt', margin: '10px 0 20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>TYPE DE CONTRAT</div>
                  <div>{editable ? (
                    <select value={hf.contractType}
                      onChange={e => updateHF({ contractType: e.target.value as ContractType })}
                      data-export-text={contractTypeLabel}
                      style={hfBox}>
                      <option value="FORFAITAIRE">FORFAITAIRE</option>
                      <option value="BUDGÉTAIRE">BUDGÉTAIRE</option>
                      <option value="COST PLUS">COST PLUS</option>
                    </select>
                  ) : contractTypeLabel}</div>
                </div>
                {(editable || projectAddrLabel) && (
                  <div>
                    <div style={{ fontWeight: 'bold' }}>PROJET</div>
                    <div>{editable ? (
                      <input value={hf.projectAddress} maxLength={QBO_CUSTOM_FIELD_MAX}
                        placeholder={(addressText || '').toUpperCase().slice(0, QBO_CUSTOM_FIELD_MAX)}
                        onChange={e => updateHF({ projectAddress: e.target.value.toUpperCase().slice(0, QBO_CUSTOM_FIELD_MAX) })}
                        data-export-text={projectAddrLabel || ''}
                        style={{ ...hfBox, textTransform: 'uppercase', width: '100%' }} />
                    ) : projectAddrLabel}</div>
                  </div>
                )}
                {(editable || projectNo) && (
                  <div>
                    <div style={{ fontWeight: 'bold' }}>NO. PROJET</div>
                    <div>{editable ? (
                      <input value={hf.projectNo} maxLength={QBO_CUSTOM_FIELD_MAX}
                        onChange={e => updateHF({ projectNo: e.target.value.slice(0, QBO_CUSTOM_FIELD_MAX) })}
                        data-export-text={projectNo}
                        style={{ ...hfBox, width: '100%' }} />
                    ) : projectNo}</div>
                  </div>
                )}
              </div>

              {/* TABLE PRINCIPALE */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                <thead>
                  <tr>
                    <th style={{ background: BANNER, color: '#fff', textAlign: 'left', padding: '7px 8px', fontWeight: 'bold', width: '48%' }}>DESCRIPTION</th>
                    <th style={{ background: BANNER, color: '#fff', textAlign: 'right', padding: '7px 8px', fontWeight: 'bold', width: '12%' }}>UNITÉ</th>
                    <th style={{ background: BANNER, color: '#fff', textAlign: 'right', padding: '7px 8px', fontWeight: 'bold', width: '8%' }}>QTÉ</th>
                    <th style={{ background: BANNER, color: '#fff', textAlign: 'right', padding: '7px 8px', fontWeight: 'bold', width: '14%' }}>TAUX</th>
                    <th style={{ background: BANNER, color: '#fff', textAlign: 'right', padding: '7px 8px', fontWeight: 'bold', width: '18%' }}>MONTANT</th>
                  </tr>
                </thead>
                <tbody>
                  {resolveAll(projectHeader).split('\n').map((rawLine, i) => {
                    const isBold = /^\s*\*\*.*\*\*\s*$/.test(rawLine);
                    const text = rawLine.replace(/^\s*\*\*|\*\*\s*$/g, '');
                    return (
                      <tr key={`hdr-${i}`} data-quote-zone={i === 0 ? 'project-header' : undefined}>
                        <td colSpan={5} style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc' }}>
                          {isBold ? <b>{text}</b> : text}
                        </td>
                      </tr>
                    );
                  })}

                  {/* MAIN D'OEUVRE */}
                  {laborLines.length > 0 && (
                    <>
                      <tr><td colSpan={5} style={{ padding: '8px 8px 6px', borderBottom: '1px solid #d0d8dc' }}>
                        <b>**MAIN D'OEUVRE**</b>
                      </td></tr>
                      {laborLines.map(({ line, idx }) => (
                        <tr key={`l-${idx}`}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', verticalAlign: 'top' }}>
                            <div style={{ fontWeight: 'bold' }}>{line.description.toUpperCase()}</div>
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{line.unit || ''}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{line.quantity}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt2(line.rate)}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt2(line.total_displayed)}</td>
                        </tr>
                      ))}
                      <tr><td colSpan={5} style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #d0d8dc' }}>
                        Total partiel : {fmt2(laborSubtotal)}
                      </td></tr>
                    </>
                  )}

                  {/* MATÉRIAUX */}
                  {materialLines.length > 0 && (
                    <>
                      <tr><td colSpan={5} style={{ padding: '8px 8px 6px', borderBottom: '1px solid #d0d8dc' }}>
                        <b>**MATÉRIAUX**</b>
                      </td></tr>
                      {materialLines.map(({ line, idx }) => (
                        <tr key={`m-${idx}`}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', verticalAlign: 'top' }}>
                            <div style={{ fontWeight: 'bold' }}>{line.description.toUpperCase()}</div>
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{line.unit || ''}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{line.quantity}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt2(line.rate)}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt2(line.total_displayed)}</td>
                        </tr>
                      ))}
                      <tr><td colSpan={5} style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #d0d8dc' }}>
                        Total partiel : {fmt2(materialSubtotal)}
                      </td></tr>
                    </>
                  )}

                  {/* AUTRES */}
                  {otherLines.map(({ line, idx }) => (
                    <tr key={`o-${idx}`}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 'bold' }}>{line.description.toUpperCase()}</div>
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{line.unit || ''}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{line.quantity}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt2(line.rate)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt2(line.total_displayed)}</td>
                    </tr>
                  ))}

                  {allLines.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '12px 8px', textAlign: 'center', color: '#999' }}>
                      Aucun poste — ajoutez des lignes dans « Postes du devis »
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ═══════════ PAGE 2 — Exclusions + Modalités + Totaux + Signature ═══════════ */}
            <div className="quote-page" style={pageStyle}>
              {continuationHeader(2)}

              {/* EXCLUSIONS dans la même grille tableau */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', marginBottom: 20 }}>
                <tbody>
                  <tr><td colSpan={5} data-quote-zone="notes" style={{ padding: '6px 8px', borderBottom: '1px solid #d0d8dc', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                    {resolvedNotes}
                  </td></tr>
                </tbody>
              </table>

              {/* BOTTOM : MODALITÉS (gauche) + TOTAUX (droite) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 25, gap: 20 }}>
                <div data-quote-zone="terms" style={{ width: '60%', fontSize: '9pt', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
                  {resolvedTerms}
                </div>
                {quote && (
                  <div style={{ width: '38%', fontSize: '10pt' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 4px' }}>
                      <span>TOTAL PARTIEL</span><span>{fmt2(quote.subtotal_displayed)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 4px' }}>
                      <span>TPS @ 5%</span><span>{fmt2(quote.tps)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 4px' }}>
                      <span>TVQ @ 9,975%</span><span>{fmt2(quote.tvq)}</span>
                    </div>
                    <div style={{ background: BANNER, color: '#fff', padding: 12, marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: '13pt', fontWeight: 'bold' }}>
                      <span>TOTAL</span><span>{fmt2(quote.total_final)} $</span>
                    </div>
                  </div>
                )}
              </div>

              {/* SIGNATURES */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 60, fontSize: '9.5pt' }}>
                <div style={{ width: '45%', borderTop: '1px solid #000', paddingTop: 4 }}>Accepté par</div>
                <div style={{ width: '45%', borderTop: '1px solid #000', paddingTop: 4 }}>Date d'acceptation</div>
              </div>
            </div>

            </div>
          </div>
        </div>
        {/* ═══════════ COLONNE SIDEBAR ─ éditeurs ═══════════ */}
        <aside style={{
          position: 'relative',
          alignSelf: 'stretch',
          background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 14,
          maxHeight: 'calc(297mm * 0.72 + 70px)', overflowY: 'auto',
        }}>
          {/* Poignée de redimensionnement (bord gauche) */}
          <div
            onPointerDown={onSidebarResizeDown}
            onPointerMove={onSidebarResizeMove}
            onPointerUp={onSidebarResizeUp}
            onPointerCancel={onSidebarResizeUp}
            title="Glisser pour élargir / rétrécir"
            style={{
              position: 'absolute', top: 0, left: -7, width: 12, height: '100%',
              cursor: 'ew-resize', zIndex: 5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{ width: 3, height: 48, borderRadius: 3, background: 'rgba(148,163,184,0.45)' }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Édition de la soumission
          </div>

          {/* En-tête du projet (lignes en haut du tableau du PDF) */}
          <div onFocusCapture={() => setActiveSection('project-header')} onClick={() => setActiveSection('project-header')}
            style={sectionWrapperStyle('header', activeSection === 'project-header')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>
              <FileText size={12} /> EN-TÊTE DU PROJET
              {renderConfirmBox('header')}
            </div>
            <div style={lockedContentStyle('header')}>
            <SmartTextEditor
              value={projectHeader}
              onChange={setProjectHeader}
              variables={smartVariables as any || []}
              values={mergedSmartValues}
              rows={9}
              paletteCompact
              showPalette={false}
              showPreview={false}
              readOnly={!!confirmed?.header}
            />
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
              Encadrez une ligne avec <code>**…**</code> pour la mettre en gras.
            </div>
            </div>
          </div>

          {/* Notes */}
          <div onFocusCapture={() => setActiveSection('notes')} onClick={() => setActiveSection('notes')}
            style={sectionWrapperStyle('notes', activeSection === 'notes')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>
              <StickyNote size={12} /> NOTES DU DEVIS
              {renderConfirmBox('notes')}
            </div>
            <div style={lockedContentStyle('notes')}>
            <SmartTextEditor
              value={quoteNotes && quoteNotes.length > 0 ? quoteNotes : DEFAULT_NOTES}
              onChange={onQuoteNotesChange}
              variables={smartVariables as any || []}
              values={smartValues || {}}
              rows={8}
              paletteCompact
              showPalette={false}
              showPreview={false}
              readOnly={!!confirmed?.notes}
            />
            </div>
          </div>

          {/* Termes */}
          <div onFocusCapture={() => setActiveSection('terms')} onClick={() => setActiveSection('terms')}
            style={sectionWrapperStyle('terms', activeSection === 'terms')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>
              <FileText size={12} /> MODALITÉS DE PAIEMENT
              {renderConfirmBox('terms')}
            </div>
            <div style={lockedContentStyle('terms')}>
            <SmartTextEditor
              value={paymentTerms && paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS}
              onChange={onPaymentTermsChange}
              variables={smartVariables as any || []}
              values={smartValues || {}}
              rows={8}
              paletteCompact
              showPalette={false}
              showPreview={false}
              readOnly={!!confirmed?.terms}
            />
            </div>
          </div>

          {/* Exclusions / Inclusions */}
          {onExclusionsCheckedChange && (
            <div onClick={() => setActiveSection('exclusions')}
              style={sectionWrapperStyle('exclusions', activeSection === 'exclusions')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>
                <ListChecks size={12} /> INCLUSIONS / EXCLUSIONS
                {renderConfirmBox('exclusions')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', ...lockedContentStyle('exclusions') }}>
                {(exclusionsList || []).map(item => (
                  <label key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.03)', fontSize: 11, color: '#d1d5db', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!exclusionsChecked?.[item]}
                      onChange={e => onExclusionsCheckedChange({ ...(exclusionsChecked || {}), [item]: e.target.checked })}
                      style={{ accentColor: '#6366f1', width: 13, height: 13 }}
                    />
                    <span style={{ flex: 1 }}>{item}</span>
                    {!(defaultExclusions || []).includes(item) && onExclusionsListChange && (
                      <button type="button" onClick={(e) => {
                          e.preventDefault();
                          onExclusionsListChange((exclusionsList || []).filter(x => x !== item));
                          const nc = { ...(exclusionsChecked || {}) }; delete nc[item];
                          onExclusionsCheckedChange(nc);
                        }}
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}
                        title="Supprimer"><X size={12} /></button>
                    )}
                  </label>
                ))}
              </div>
              {onExclusionsListChange && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, ...lockedContentStyle('exclusions') }}>
                  <input
                    value={newExclusionText}
                    onChange={e => setNewExclusionText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newExclusionText.trim()) {
                        const t = newExclusionText.trim();
                        if (!(exclusionsList || []).includes(t)) onExclusionsListChange([...(exclusionsList || []), t]);
                        onExclusionsCheckedChange({ ...(exclusionsChecked || {}), [t]: true });
                        setNewExclusionText('');
                      }
                    }}
                    placeholder="Ajouter une exclusion…"
                    style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#e2e8f0', fontSize: 11, padding: '6px 8px' }}
                  />
                  <button type="button" onClick={() => {
                      const t = newExclusionText.trim(); if (!t) return;
                      if (!(exclusionsList || []).includes(t)) onExclusionsListChange([...(exclusionsList || []), t]);
                      onExclusionsCheckedChange({ ...(exclusionsChecked || {}), [t]: true });
                      setNewExclusionText('');
                    }}
                    style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Plus size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ═══════════ COLONNE PALETTE DE VARIABLES (drag-and-drop) ═══════════ */}
        <aside style={{
          alignSelf: 'stretch',
          background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 10,
          maxHeight: 'calc(297mm * 0.72 + 70px)', overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Variables
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: -4 }}>
            Glissez-déposez dans n'importe quel champ à gauche.
          </div>
          {(() => {
            const allVars = (smartVariables as any[]) || [];
            const order = ['Client', 'Produit', 'Mesures', 'Financier'];
            const byCat: Record<string, any[]> = {};
            allVars.forEach(v => { (byCat[v.category] ||= []).push(v); });
            const cats = [...order.filter(c => byCat[c]), ...Object.keys(byCat).filter(c => !order.includes(c))];
            const catColors: Record<string, { bg: string; bd: string; fg: string }> = {
              Client:    { bg: 'rgba(59,130,246,0.18)', bd: 'rgba(59,130,246,0.5)',  fg: '#bfdbfe' },
              Produit:   { bg: 'rgba(168,85,247,0.18)', bd: 'rgba(168,85,247,0.5)',  fg: '#e9d5ff' },
              Mesures:   { bg: 'rgba(34,197,94,0.18)',  bd: 'rgba(34,197,94,0.5)',   fg: '#bbf7d0' },
              Financier: { bg: 'rgba(251,191,36,0.18)', bd: 'rgba(251,191,36,0.5)',  fg: '#fde68a' },
              Formule:   { bg: 'rgba(236,72,153,0.18)', bd: 'rgba(236,72,153,0.5)',  fg: '#fbcfe8' },
            };
            const formulas = [
              { lbl: 'Dépôt 30%',     tok: '{{= total * 0.3}}' },
              { lbl: 'Solde 70%',     tok: '{{= total * 0.7}}' },
              { lbl: 'Total + taxes', tok: '{{= total * 1.14975}}' },
              { lbl: 'Prix / pi²',    tok: '{{= subtotal / area_sqft}}' },
              { lbl: 'Demi-total',    tok: '{{= total / 2}}' },
            ];
            return (
              <>
                {cats.map(cat => {
                  const c = catColors[cat] || { bg: 'rgba(255,255,255,0.05)', bd: 'rgba(255,255,255,0.1)', fg: '#e2e8f0' };
                  return (
                    <div key={cat}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: c.fg, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{cat}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {byCat[cat].map(v => (
                          <button key={v.key} type="button"
                            draggable
                            onDragStart={e => e.dataTransfer.setData('text/x-smart-var', `{{${v.key}}}`)}
                            title={`{{${v.key}}}` + (v.sample ? ` → ${v.sample}` : '')}
                            style={{
                              padding: '4px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                              background: c.bg, border: '1px solid ' + c.bd, color: '#e2e8f0',
                              cursor: 'grab', textAlign: 'left',
                            }}>
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: catColors.Formule.fg, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Formule</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {formulas.map(f => (
                      <button key={f.lbl} type="button"
                        draggable
                        onDragStart={e => e.dataTransfer.setData('text/x-smart-var', f.tok)}
                        title={f.tok}
                        style={{
                          padding: '4px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                          background: catColors.Formule.bg, border: '1px solid ' + catColors.Formule.bd,
                          color: '#f9a8d4', cursor: 'grab', textAlign: 'left',
                        }}>ƒ {f.lbl}</button>
                    ))}
                  </div>
                </div>
              </>
            );
          })()}
        </aside>
      </div>
    </div>
  );
};

export default QuotePreview;

const zoomCtrlBtn = (): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 6, border: '1px solid transparent',
  background: 'transparent', color: '#c7d2fe', cursor: 'pointer', padding: 0,
});
