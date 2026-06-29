import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { Tag, Eye } from 'lucide-react';

/**
 * SmartTextEditor — textarea / input avec :
 *   • Palette de variables draggable (drag-and-drop dans le champ)
 *   • Clic pour insérer la variable au curseur
 *   • Auto-complétion en tapant `{{` (menu de suggestions)
 *   • Support de formules : `{{= total * 0.3}}`, `{{= subtotal + 100}}`, etc.
 *
 * Les variables et formules sont remplacées au rendu final via `resolveTemplate`.
 */

export interface SmartVariable {
  key: string;            // ex: 'client_name'
  label: string;          // ex: 'Nom du client'
  category: string;       // ex: 'Client', 'Produit', 'Mesures', 'Financier'
  sample?: string;        // valeur d'exemple à afficher
  numeric?: boolean;      // true si utilisable dans formules
}

export type SmartVariableValues = Record<string, string | number>;

interface SmartTextEditorProps {
  value: string;
  onChange: (v: string) => void;
  variables: SmartVariable[];
  values?: SmartVariableValues;          // pour l'aperçu/résolution
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
  showPalette?: boolean;
  showPreview?: boolean;                 // affiche l'aperçu résolu sous le champ
  paletteCompact?: boolean;
  fieldStyle?: React.CSSProperties;
  label?: string;
}

/* ─── Helpers ─── */

/** Évalue une formule `{{= ... }}` de manière sûre (whitelist d'opérateurs/chiffres/identifiants). */
const evalFormula = (expr: string, vals: SmartVariableValues): string => {
  // Remplacer les variables connues par leur valeur numérique
  let safe = expr;
  Object.entries(vals).forEach(([k, v]) => {
    const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    safe = safe.replace(new RegExp(`\\b${k}\\b`, 'g'), Number.isFinite(num) ? String(num) : '0');
  });
  // Whitelist : chiffres, opérateurs, parenthèses, espaces, point
  if (!/^[\d+\-*/().\s]*$/.test(safe)) return `[formule invalide]`;
  try {
    // eslint-disable-next-line no-new-func
    const r = Function(`"use strict"; return (${safe || 0});`)();
    if (typeof r !== 'number' || !Number.isFinite(r)) return `[?]`;
    // Format CAD avec 2 décimales si non entier
    return r % 1 === 0 ? r.toLocaleString('fr-CA') : r.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `[erreur formule]`;
  }
};

/** Résout un template en remplaçant {{var}} et {{= formule}} par les valeurs. */
export const resolveTemplate = (tpl: string, vals: SmartVariableValues): string => {
  if (!tpl) return '';
  return tpl.replace(/\{\{\s*(=?)\s*([^{}]+?)\s*\}\}/g, (_m, eq, body) => {
    if (eq === '=') return evalFormula(body, vals);
    const k = body.trim();
    const v = vals[k];
    return v === undefined || v === null ? `{{${k}}}` : String(v);
  });
};

/* ─── Composant ─── */

const SmartTextEditor: React.FC<SmartTextEditorProps> = ({
  value, onChange, variables, values = {}, multiline = true, rows = 5,
  placeholder, readOnly, showPalette = true, showPreview = true,
  paletteCompact = false, fieldStyle, label,
}) => {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestPos, setSuggestPos] = useState<{ start: number; end: number; query: string }>({ start: 0, end: 0, query: '' });
  const [filterCat, setFilterCat] = useState<string>('Toutes');
  const [search, setSearch] = useState('');

  const categories = useMemo(() => ['Toutes', ...Array.from(new Set(variables.map(v => v.category))), 'Formule'], [variables]);

  const filtered = useMemo(() => {
    let arr = variables;
    if (filterCat !== 'Toutes' && filterCat !== 'Formule') arr = arr.filter(v => v.category === filterCat);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(v => v.label.toLowerCase().includes(q) || v.key.toLowerCase().includes(q));
    }
    return arr;
  }, [variables, filterCat, search]);

  const insertAtCursor = useCallback((token: string) => {
    const el = inputRef.current;
    if (!el) { onChange(value + token); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      try { el.setSelectionRange(pos, pos); } catch { /* noop */ }
    });
  }, [value, onChange]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    // Détecter si on est en train de taper {{...
    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const m = before.match(/\{\{([a-zA-Z0-9_]*)$/);
    if (m) {
      setSuggestOpen(true);
      setSuggestPos({ start: caret - m[0].length, end: caret, query: m[1] });
    } else {
      setSuggestOpen(false);
    }
  };

  const applySuggestion = (key: string) => {
    const el = inputRef.current; if (!el) return;
    const next = value.slice(0, suggestPos.start) + `{{${key}}}` + value.slice(suggestPos.end);
    onChange(next);
    setSuggestOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = suggestPos.start + key.length + 4;
      try { el.setSelectionRange(pos, pos); } catch { /* noop */ }
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const tok = e.dataTransfer.getData('text/x-smart-var');
    if (!tok) return;
    e.preventDefault();
    const el = inputRef.current; if (!el) return;
    // Place caret au point de drop si possible
    try {
      // @ts-ignore
      const range = (document as any).caretRangeFromPoint?.(e.clientX, e.clientY);
      if (range && el.contains(range.startContainer)) {
        const offset = range.startOffset;
        el.focus();
        try { (el as HTMLTextAreaElement).setSelectionRange(offset, offset); } catch { /* noop */ }
      }
    } catch { /* noop */ }
    insertAtCursor(tok);
  };

  const baseFieldStyle: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
    color: '#e2e8f0', fontSize: 12, padding: '8px 10px',
    fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.55,
    ...fieldStyle,
  };

  const suggestions = filtered.filter(v =>
    !suggestPos.query || v.key.toLowerCase().includes(suggestPos.query.toLowerCase())
  ).slice(0, 8);

  const preview = useMemo(() => resolveTemplate(value, values), [value, values]);

  const catColors: Record<string, string> = {
    Client: 'rgba(59,130,246,0.18)', Produit: 'rgba(168,85,247,0.18)',
    Mesures: 'rgba(34,197,94,0.18)', Financier: 'rgba(251,191,36,0.18)',
    Formule: 'rgba(236,72,153,0.18)',
  };
  const catBorders: Record<string, string> = {
    Client: 'rgba(59,130,246,0.5)', Produit: 'rgba(168,85,247,0.5)',
    Mesures: 'rgba(34,197,94,0.5)', Financier: 'rgba(251,191,36,0.5)',
    Formule: 'rgba(236,72,153,0.5)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      )}
      {showPalette && !readOnly && (
        <div style={{
          background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: paletteCompact ? '6px 8px' : '8px 10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Tag size={11} strokeWidth={2.2} /> Variables
            </span>
            <span style={{ fontSize: 10, color: '#64748b' }}>· glisser-déposer ou cliquer</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..."
              style={{
                marginLeft: 'auto', padding: '3px 8px', borderRadius: 6, fontSize: 11,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#e2e8f0', width: 140,
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
            {categories.map(c => (
              <button key={c} type="button" onClick={() => setFilterCat(c)}
                style={{
                  padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                  background: filterCat === c ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                  border: '1px solid ' + (filterCat === c ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.08)'),
                  color: filterCat === c ? '#a5b4fc' : '#94a3b8', cursor: 'pointer',
                }}>{c}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: paletteCompact ? 80 : 120, overflowY: 'auto' }}>
            {filterCat === 'Formule' ? (
              <>
                {[
                  { lbl: 'Dépôt 30%', tok: '{{= total * 0.3}}' },
                  { lbl: 'Solde 70%', tok: '{{= total * 0.7}}' },
                  { lbl: 'Total + taxes', tok: '{{= total * 1.14975}}' },
                  { lbl: 'Prix / pi²', tok: '{{= subtotal / area_sqft}}' },
                  { lbl: 'Demi-total', tok: '{{= total / 2}}' },
                  { lbl: 'Personnalisée…', tok: '{{= total * 0.5}}' },
                ].map(f => (
                  <button key={f.lbl} type="button"
                    draggable
                    onDragStart={e => e.dataTransfer.setData('text/x-smart-var', f.tok)}
                    onClick={() => insertAtCursor(f.tok)}
                    title={f.tok}
                    style={{
                      padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                      background: catColors.Formule, border: '1px solid ' + catBorders.Formule,
                      color: '#f9a8d4', cursor: 'grab', whiteSpace: 'nowrap',
                    }}>ƒ {f.lbl}</button>
                ))}
              </>
            ) : (
              filtered.map(v => (
                <button key={v.key} type="button"
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/x-smart-var', `{{${v.key}}}`)}
                  onClick={() => insertAtCursor(`{{${v.key}}}`)}
                  title={`{{${v.key}}}` + (v.sample ? ` → ${v.sample}` : '')}
                  style={{
                    padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                    background: catColors[v.category] || 'rgba(255,255,255,0.05)',
                    border: '1px solid ' + (catBorders[v.category] || 'rgba(255,255,255,0.1)'),
                    color: '#e2e8f0', cursor: 'grab', whiteSpace: 'nowrap',
                  }}>{v.label}</button>
              ))
            )}
            {filtered.length === 0 && filterCat !== 'Formule' && (
              <span style={{ fontSize: 10, color: '#64748b' }}>Aucune variable</span>
            )}
          </div>
        </div>
      )}

      <div style={{ position: 'relative' }}>
        {multiline ? (
          <textarea
            ref={inputRef as any}
            value={value}
            readOnly={readOnly}
            onChange={handleChange}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            placeholder={placeholder}
            rows={rows}
            style={baseFieldStyle}
          />
        ) : (
          <input
            ref={inputRef as any}
            value={value}
            readOnly={readOnly}
            onChange={handleChange}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            placeholder={placeholder}
            style={baseFieldStyle}
          />
        )}
        {suggestOpen && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 50,
            background: '#1e293b', border: '1px solid rgba(99,102,241,0.5)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', minWidth: 220, maxHeight: 220, overflowY: 'auto',
          }}>
            {suggestions.map(s => (
              <button key={s.key} type="button" onClick={() => applySuggestion(s.key)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '6px 10px', background: 'transparent', border: 'none',
                  color: '#e2e8f0', fontSize: 11, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontWeight: 700, color: '#a5b4fc' }}>{`{{${s.key}}}`}</span>
                <span style={{ marginLeft: 8, color: '#94a3b8' }}>{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {showPreview && value && /\{\{/.test(value) && (
        <details style={{ fontSize: 10 }}>
          <summary style={{ cursor: 'pointer', color: '#94a3b8', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Eye size={11} strokeWidth={2.2} /> Aperçu résolu
          </summary>
          <div style={{
            marginTop: 4, padding: '6px 10px', background: 'rgba(34,197,94,0.06)',
            border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, color: '#bbf7d0',
            fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap',
          }}>{preview}</div>
        </details>
      )}
    </div>
  );
};

export default SmartTextEditor;