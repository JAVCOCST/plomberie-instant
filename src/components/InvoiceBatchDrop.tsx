/**
 * InvoiceBatchDrop — dépose des factures fournisseur (PDF/images) par lot.
 * Chaque fichier est OCR'é (edge function invoice-ocr · Mistral/Gemini), les
 * lignes extraites sont catégorisées (matériel vs non) et le coûtant matériaux
 * total est remonté au parent (clôture) via onChange.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Loader2, Trash2, FileText, ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { processInvoiceFile, loadProjectInvoices, deleteProjectInvoice, type ProjectInvoice } from '@/lib/invoices';

const fmt = (n: number | null | undefined) =>
  (n == null || isNaN(Number(n))) ? '—' : Number(n).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

const sInput: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, fontSize: 13 };

export const InvoiceBatchDrop: React.FC<{ soumissionId: string; onChange?: (materialTotal: number, invoices: ProjectInvoice[]) => void }> = ({ soumissionId, onChange }) => {
  const [invoices, setInvoices] = useState<ProjectInvoice[]>([]);
  const [queue, setQueue] = useState<{ name: string; status: 'ocr' | 'error'; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const list = await loadProjectInvoices(soumissionId).catch(() => [] as ProjectInvoice[]);
    setInvoices(list);
    onChange?.(list.reduce((s, i) => s + (Number(i.material_total) || 0), 0), list);
  }, [soumissionId, onChange]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = [...files].filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'));
    if (arr.length === 0) { toast.error('Dépose des PDF ou des images de factures.'); return; }
    setBusy(true);
    for (const f of arr) {
      setQueue(q => [...q.filter(x => x.name !== f.name), { name: f.name, status: 'ocr' }]);
      try {
        await processInvoiceFile(soumissionId, f);
        setQueue(q => q.filter(x => x.name !== f.name));
        await refresh();
      } catch (e) {
        setQueue(q => q.map(x => x.name === f.name ? { name: f.name, status: 'error', error: (e as Error).message } : x));
      }
    }
    setBusy(false);
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); };
  const remove = async (id: string) => { try { await deleteProjectInvoice(id); await refresh(); } catch (e) { toast.error((e as Error).message); } };

  const total = invoices.reduce((s, i) => s + (Number(i.material_total) || 0), 0);

  return (
    <div>
      {/* Zone de dépôt */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `1.5px dashed ${drag ? '#818cf8' : 'rgba(255,255,255,0.18)'}`,
          background: drag ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
          borderRadius: 10, padding: '18px 14px', textAlign: 'center', cursor: 'pointer', transition: 'all .15s',
        }}>
        <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple hidden
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.currentTarget.value = ''; }} />
        <Upload size={20} style={{ color: drag ? '#a5b4fc' : '#6b7280' }} />
        <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 6, fontWeight: 600 }}>Déposez vos factures fournisseur (PDF / images) — lot accepté</div>
        <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 2 }}>OCR ligne par ligne → coûtant matériaux réel</div>
      </div>

      {/* File d'attente */}
      {queue.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {queue.map(q => (
            <div key={q.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: q.status === 'error' ? '#fca5a5' : '#9ca3af' }}>
              {q.status === 'ocr' ? <Loader2 size={13} className="spin" /> : <AlertCircle size={13} />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.name}</span>
              <span>{q.status === 'ocr' ? 'OCR…' : (q.error || 'échec')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Liste des factures */}
      {invoices.length > 0 && (
        <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
          {invoices.map(inv => {
            const open = openId === inv.id;
            return (
              <div key={inv.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                  <button onClick={() => setOpenId(open ? null : inv.id)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'inline-flex' }}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <FileText size={14} style={{ color: '#818cf8', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: '#e5e7eb', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inv.supplier || 'Fournisseur ?'} {inv.invoice_number ? <span style={{ color: '#6b7280', fontWeight: 400 }}>· #{inv.invoice_number}</span> : null}
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{inv.invoice_date || '—'} · {inv.lines?.length || 0} ligne(s) · {inv.engine}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#fbbf24', fontWeight: 700 }}>{fmt(inv.material_total)}</div>
                  <button onClick={() => remove(inv.id)} title="Supprimer" style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'inline-flex', padding: 2 }}><Trash2 size={14} /></button>
                </div>
                {open && (
                  <div style={{ padding: '0 10px 8px 32px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead><tr style={{ color: '#6b7280' }}>
                        <th style={{ textAlign: 'left', padding: '3px 4px', fontWeight: 600 }}>Description</th>
                        <th style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 600 }}>Qté</th>
                        <th style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 600 }}>Total</th>
                        <th style={{ textAlign: 'center', padding: '3px 4px', fontWeight: 600 }}>Mat.</th>
                      </tr></thead>
                      <tbody>
                        {(inv.lines || []).map((l, i) => (
                          <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.03)', color: l.is_material ? '#d1d5db' : '#6b7280' }}>
                            <td style={{ padding: '3px 4px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</td>
                            <td style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'monospace' }}>{l.quantity || '—'} {l.unit}</td>
                            <td style={{ padding: '3px 4px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(l.total)}</td>
                            <td style={{ padding: '3px 4px', textAlign: 'center' }}>{l.is_material ? '✓' : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>Coûtant matériaux facturé ({invoices.length})</span>
            <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: '#fbbf24' }}>{fmt(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceBatchDrop;
