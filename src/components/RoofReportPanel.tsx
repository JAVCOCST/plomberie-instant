/**
 * RoofReportPanel — génère le rapport de toiture (pro) depuis le 3D VALIDÉ
 * d'une soumission : aperçu in-app (iframe), impression/PDF (print navigateur),
 * téléchargement HTML. Les sorties « joindre / envoyer / QBO » réutiliseront le
 * même HTML (étape suivante).
 */
import React, { useState } from 'react';
import { FileBarChart2, Printer, Download, Loader2, AlertCircle, FileDown, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { buildToitureModel } from '@/lib/roof-report/adapter';
import { buildReportHtml, type ReportMeta } from '@/lib/roof-report/buildReport';
import { renderReportPdf } from '@/lib/roof-report/pdf';

export const RoofReportPanel: React.FC<{
  roofModel: any | null; meta: ReportMeta;
  soumissionId?: string | null;
  onAttached?: (path: string) => void;
}> = ({ roofModel, meta, soumissionId, onAttached }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'download' | 'attach' | null>(null);

  const generate = () => {
    setBusy(true); setErr(null);
    try {
      const data = buildToitureModel(roofModel);
      if (!data.planes.length) { setErr("Aucune facette détectée — valide d'abord le take-off 3D (section Take-off)."); setHtml(null); return; }
      setHtml(buildReportHtml(data, meta));
    } catch (e) { setErr(`Échec de génération : ${(e as Error).message}`); setHtml(null); }
    finally { setBusy(false); }
  };

  const printReport = () => {
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) { setErr('Pop-up bloqué — autorise les fenêtres pour imprimer.'); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 350);
  };
  const downloadHtml = () => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rapport-toiture-${meta.devisNo || ''}.html`.replace(/--+/g, '-'); a.click();
    URL.revokeObjectURL(url);
  };

  const filename = `rapport-toiture-${meta.devisNo || 'toiture'}.pdf`.replace(/--+/g, '-');
  // PDF via service (html-to-pdf). 'tmp' pour un simple téléchargement.
  const downloadPdf = async () => {
    if (!html) return;
    setPdfBusy('download'); setErr(null);
    try {
      const { signedUrl } = await renderReportPdf(html, soumissionId || 'tmp', filename);
      if (signedUrl) window.open(signedUrl, '_blank');
      else throw new Error('PDF généré mais URL indisponible.');
    } catch (e) { setErr(`PDF : ${(e as Error).message}`); toast.error(`PDF : ${(e as Error).message}`); }
    finally { setPdfBusy(null); }
  };
  const attachPdf = async () => {
    if (!html || !soumissionId) return;
    setPdfBusy('attach'); setErr(null);
    try {
      const { path } = await renderReportPdf(html, soumissionId, filename);
      onAttached?.(path);
      toast.success('Rapport PDF joint à la soumission.');
    } catch (e) { setErr(`Joindre : ${(e as Error).message}`); toast.error(`Joindre : ${(e as Error).message}`); }
    finally { setPdfBusy(null); }
  };

  const btn = (extra: React.CSSProperties): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
    fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid', ...extra,
  });

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button onClick={generate} disabled={busy || !roofModel}
          style={btn({ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: '#fff', borderColor: 'rgba(37,99,235,0.5)', opacity: roofModel ? 1 : 0.5 })}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileBarChart2 size={14} />}
          {html ? 'Régénérer le rapport' : 'Générer le rapport de toiture'}
        </button>
        {html && (
          <>
            <button onClick={downloadPdf} disabled={!!pdfBusy} style={btn({ background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#fff', borderColor: 'rgba(245,158,11,0.5)' })}>
              {pdfBusy === 'download' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileDown size={14} />} Télécharger PDF
            </button>
            {soumissionId && (
              <button onClick={attachPdf} disabled={!!pdfBusy} style={btn({ background: 'rgba(52,211,153,0.15)', color: '#34d399', borderColor: 'rgba(52,211,153,0.3)' })}>
                {pdfBusy === 'attach' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Paperclip size={14} />} Joindre à la soumission
              </button>
            )}
            <button onClick={printReport} style={btn({ background: 'rgba(255,255,255,0.05)', color: '#d1d5db', borderColor: 'rgba(255,255,255,0.15)' })}><Printer size={14} /> Imprimer</button>
            <button onClick={downloadHtml} style={btn({ background: 'rgba(255,255,255,0.05)', color: '#d1d5db', borderColor: 'rgba(255,255,255,0.15)' })}><Download size={14} /> HTML</button>
          </>
        )}
      </div>

      {!roofModel && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>Le rapport se base sur le <b style={{ color: '#a5b4fc' }}>take-off 3D validé</b>. Valide-le pour activer la génération.</div>}
      {err && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#fca5a5', marginTop: 8 }}><AlertCircle size={13} /> {err}</div>}

      {html && (
        <div style={{ marginTop: 12, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#fff' }}>
          <iframe title="Rapport de toiture" srcDoc={html} style={{ width: '100%', height: 600, border: 'none', display: 'block' }} />
        </div>
      )}
    </div>
  );
};

export default RoofReportPanel;
