import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  PenLine, Type as TypeIcon, Calendar as CalIcon, CheckSquare, User as UserIcon,
  Send, Trash2, Plus, Loader2, ExternalLink, RefreshCw, Ban, Mail, Copy, Move, Check,
  Download, Archive, ArchiveRestore,
} from 'lucide-react';
import SmartTextEditor from '@/components/SmartTextEditor';
import { QUOTE_VARIABLE_DEFS } from '@/lib/quote-variables';
import type { SmartVariable, SmartVariableValues } from '@/components/SmartTextEditor';

// ============================================================
// Types
// ============================================================
type FieldType = 'signature' | 'initials' | 'date' | 'text' | 'checkbox' | 'name';

interface PlacedField {
  id: string;
  signerIndex: number;
  type: FieldType;
  page: number;       // page index (1-based)
  x_pct: number;      // % of page width
  y_pct: number;      // % of page height
  width_pct: number;
  height_pct: number;
  required: boolean;
  label?: string;
}

interface SignerDraft {
  name: string;
  email: string;
  phone?: string;
  role: 'client' | 'contractor' | 'witness';
  color: string;
}

interface SignatureRequest {
  id: string;
  status: string;
  subject: string;
  message: string | null;
  access_token: string;
  progress_percent: number;
  sent_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  signed_pdf_url: string | null;
  archived_at?: string | null;
  contract_html?: string | null;
}

interface SignerRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  color: string;
  status: string;
  viewed_at: string | null;
  signed_at: string | null;
  signer_token: string;
}

const FIELD_TYPES: { key: FieldType; label: string; icon: React.ReactNode; w: number; h: number }[] = [
  // Rectangles plus fins (style DocuSign) — hauteur réduite pour ne pas écraser le texte
  { key: 'signature', label: 'Signature', icon: <PenLine size={14} />, w: 22, h: 3.2 },
  { key: 'initials',  label: 'Initiales', icon: <UserIcon size={14} />, w: 9,  h: 2.8 },
  { key: 'date',      label: 'Date',      icon: <CalIcon size={14} />,  w: 13, h: 2.4 },
  { key: 'name',      label: 'Nom',       icon: <UserIcon size={14} />, w: 22, h: 2.4 },
  { key: 'text',      label: 'Texte',     icon: <TypeIcon size={14} />, w: 22, h: 2.4 },
  { key: 'checkbox',  label: 'Case',      icon: <CheckSquare size={14} />, w: 3,  h: 2.4 },
];

const SIGNER_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7'];

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1`;

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function escapeHtml(v: string): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));
}

// ============================================================
// Component
// ============================================================
export interface ContractSignatureStepProps {
  soumissionId: string | null;
  contractHtml: string;
  defaultClient?: { name?: string; email?: string; phone?: string };
  defaultContractor?: { name?: string; email?: string };
  // wrapper styles
  sectionStyle: React.CSSProperties;
  isMobile: boolean;
}

const ContractSignatureStep: React.FC<ContractSignatureStepProps> = ({
  soumissionId, contractHtml, defaultClient, defaultContractor, sectionStyle, isMobile,
}) => {
  // ── Sub-tabs ──
  const [tab, setTab] = useState<'editor' | 'tracking'>('editor');

  // ── Signers draft (admin editor) ──
  const [signers, setSigners] = useState<SignerDraft[]>(() => [
    {
      name: defaultClient?.name || 'Client',
      email: defaultClient?.email || '',
      phone: defaultClient?.phone || '',
      role: 'client',
      color: SIGNER_COLORS[0],
    },
    {
      name: defaultContractor?.name || 'Entrepreneur',
      email: defaultContractor?.email || '',
      role: 'contractor',
      color: SIGNER_COLORS[1],
    },
  ]);
  const [activeSignerIdx, setActiveSignerIdx] = useState(0);

  // ── Fields placed on the contract ──
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [activeTool, setActiveTool] = useState<FieldType | null>(null);

  // ── Subject / message ──
  const [subject, setSubject] = useState('Contrat à signer — Toitures VB Inc.');
  const [message, setMessage] = useState('Bonjour,\n\nVeuillez signer le contrat ci-dessous. Vous pourrez tout réviser avant la signature finale.\n\nMerci.');
  const [expiresInDays, setExpiresInDays] = useState(30);

  // ── Sending / requests ──
  const [sending, setSending] = useState(false);
  const [requests, setRequests] = useState<(SignatureRequest & { signers: SignerRow[] })[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  // Sync defaults when client info changes
  useEffect(() => {
    if (!defaultClient) return;
    setSigners(prev => prev.map((s, i) => i === 0 ? {
      ...s,
      name: defaultClient.name || s.name,
      email: defaultClient.email || s.email,
      phone: defaultClient.phone || s.phone,
    } : s));
  }, [defaultClient?.name, defaultClient?.email, defaultClient?.phone]);

  // ── Load requests ──
  const loadRequests = async () => {
    if (!soumissionId) { setRequests([]); return; }
    setLoadingRequests(true);
    try {
      const { data: reqs } = await (supabase as any)
        .from('contract_signature_requests')
        .select('*')
        .eq('soumission_id', soumissionId)
        .order('created_at', { ascending: false });
      const reqList = reqs || [];
      if (reqList.length === 0) { setRequests([]); return; }
      const ids = reqList.map((r: any) => r.id);
      const { data: ss } = await (supabase as any)
        .from('contract_signers').select('*').in('request_id', ids).order('signer_order');
      const grouped = reqList.map((r: any) => ({
        ...r,
        signers: (ss || []).filter((s: any) => s.request_id === r.id),
      }));
      setRequests(grouped);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => { loadRequests(); /* eslint-disable-next-line */ }, [soumissionId]);

  // ── Realtime updates ──
  useEffect(() => {
    if (!soumissionId) return;
    const ch = (supabase as any).channel(`csr-${soumissionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contract_signature_requests', filter: `soumission_id=eq.${soumissionId}` }, () => loadRequests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contract_signers' }, () => loadRequests())
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [soumissionId]);

  // ── Contract preview rendering ──
  // We render the contract HTML inside an iframe sized to "letter" page aspect ratio.
  // Fields are positioned by % over the SAME container.
  const previewRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(1100);

  // Inject contract HTML into iframe
  useEffect(() => {
    const f = iframeRef.current;
    if (!f) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><base target="_blank"/>
<style>body{margin:0;font-family:Helvetica,Arial,sans-serif;background:#fff;color:#111;padding:32px;}
img{max-width:100%;height:auto;} table{max-width:100%;}</style>
</head><body>${contractHtml || `<p style="color:#888;padding:40px;text-align:center;">Aucun contenu de contrat. Allez à l'étape 7 pour préparer le contrat.</p>`}</body></html>`;
    f.srcdoc = html;
    const onLoad = () => {
      try {
        const doc = f.contentDocument;
        if (doc) {
          const h = Math.max(800, doc.body.scrollHeight + 60);
          setIframeHeight(h);
        }
      } catch {}
    };
    f.addEventListener('load', onLoad);
    return () => f.removeEventListener('load', onLoad);
  }, [contractHtml]);

  // Click-to-place
  // Position du curseur (en %) pour afficher un fantôme attaché à la souris
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const onPreviewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeTool) { if (ghost) setGhost(null); return; }
    const wrap = previewRef.current; if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setGhost({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };
  const onPreviewPointerLeave = () => setGhost(null);
  useEffect(() => { if (!activeTool) setGhost(null); }, [activeTool]);

  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeTool) return;
    const wrap = previewRef.current; if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const def = FIELD_TYPES.find(t => t.key === activeTool)!;
    const nf: PlacedField = {
      id: uid(),
      signerIndex: activeSignerIdx,
      type: activeTool,
      page: 1,
      x_pct: Math.max(0, Math.min(100 - def.w, x - def.w / 2)),
      y_pct: Math.max(0, Math.min(100 - def.h, y - def.h / 2)),
      width_pct: def.w,
      height_pct: def.h,
      required: true,
    };
    setFields(prev => [...prev, nf]);
    // Auto-désactive l'outil sur mobile pour éviter les placements accidentels
    if (isMobile) setActiveTool(null);
  };

  // Drag + resize via Pointer Events (souris + tactile)
  const gestureRef = useRef<
    | { kind: 'move'; id: string; offX: number; offY: number; pointerId: number }
    | { kind: 'resize'; id: string; startX: number; startY: number; startW: number; startH: number; rectW: number; rectH: number; pointerId: number }
    | null
  >(null);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  const onFieldPointerDown = (e: React.PointerEvent, f: PlacedField) => {
    e.stopPropagation();
    e.preventDefault();
    const wrap = previewRef.current; if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setActiveFieldId(f.id);
    gestureRef.current = {
      kind: 'move', id: f.id, pointerId: e.pointerId,
      offX: ((e.clientX - rect.left) / rect.width) * 100 - f.x_pct,
      offY: ((e.clientY - rect.top) / rect.height) * 100 - f.y_pct,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onResizePointerDown = (e: React.PointerEvent, f: PlacedField) => {
    e.stopPropagation();
    e.preventDefault();
    const wrap = previewRef.current; if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setActiveFieldId(f.id);
    gestureRef.current = {
      kind: 'resize', id: f.id, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      startW: f.width_pct, startH: f.height_pct,
      rectW: rect.width, rectH: rect.height,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      if (g.kind === 'move') {
        const x = ((e.clientX - rect.left) / rect.width) * 100 - g.offX;
        const y = ((e.clientY - rect.top) / rect.height) * 100 - g.offY;
        setFields(prev => prev.map(f => f.id === g.id
          ? { ...f, x_pct: Math.max(0, Math.min(100 - f.width_pct, x)), y_pct: Math.max(0, Math.min(100 - f.height_pct, y)) }
          : f));
      } else {
        const dxPct = ((e.clientX - g.startX) / g.rectW) * 100;
        const dyPct = ((e.clientY - g.startY) / g.rectH) * 100;
        setFields(prev => prev.map(f => f.id === g.id
          ? {
              ...f,
              width_pct: Math.max(3, Math.min(100 - f.x_pct, g.startW + dxPct)),
              height_pct: Math.max(2, Math.min(100 - f.y_pct, g.startH + dyPct)),
            }
          : f));
      }
    };
    const onUp = () => { gestureRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // ── Signers helpers ──
  const addSigner = () => {
    setSigners(prev => [...prev, {
      name: `Signataire ${prev.length + 1}`, email: '', role: 'witness',
      color: SIGNER_COLORS[prev.length % SIGNER_COLORS.length],
    }]);
    setActiveSignerIdx(signers.length);
  };
  const removeSigner = (i: number) => {
    if (signers.length <= 1) return;
    setSigners(prev => prev.filter((_, idx) => idx !== i));
    setFields(prev => prev.filter(f => f.signerIndex !== i).map(f => ({
      ...f, signerIndex: f.signerIndex > i ? f.signerIndex - 1 : f.signerIndex,
    })));
    if (activeSignerIdx >= signers.length - 1) setActiveSignerIdx(Math.max(0, signers.length - 2));
  };

  // ── Send ──
  const handleSend = async () => {
    if (!contractHtml || contractHtml.length < 50) {
      toast.error('Le contrat est vide. Préparez le contrat à l\'étape 7 d\'abord.');
      return;
    }
    const validSigners = signers.filter(s => s.email && s.email.includes('@'));
    if (validSigners.length === 0) {
      toast.error('Au moins un signataire avec courriel est requis.');
      return;
    }
    if (fields.length === 0) {
      const ok = confirm('Aucun champ de signature placé. Envoyer quand même?');
      if (!ok) return;
    }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${FUNCTIONS_BASE}/contract-signature-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          soumissionId, contractHtml, subject, message, expiresInDays,
          signers: signers.map((s, i) => ({ ...s, order: i + 1 })),
          fields: fields.map(f => ({
            signerIndex: f.signerIndex, type: f.type, page: f.page,
            x_pct: f.x_pct, y_pct: f.y_pct, width_pct: f.width_pct, height_pct: f.height_pct,
            required: f.required, label: f.label,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Erreur d\'envoi');
      toast.success(`Contrat envoyé à ${json.signers?.length || 0} signataire(s).`);
      setTab('tracking');
      loadRequests();
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setSending(false);
    }
  };

  const handleRemind = async (requestId: string, signerId?: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${FUNCTIONS_BASE}/contract-signature-remind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ requestId, signerIds: signerId ? [signerId] : undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Rappel envoyé.');
    } catch (e) { toast.error(String((e as Error).message)); }
  };

  const handleVoid = async (requestId: string) => {
    if (!confirm('Annuler cette demande de signature?')) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${FUNCTIONS_BASE}/contract-signature-void`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ requestId }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Demande annulée.');
      loadRequests();
    } catch (e) { toast.error(String((e as Error).message)); }
  };

  const copyLink = (token: string) => {
    const link = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(link).then(
      () => toast.success('Lien copié.'),
      () => toast.error('Impossible de copier.')
    );
  };

  // ── Archive / unarchive ──
  const [showArchived, setShowArchived] = useState(false);
  const setArchived = async (requestId: string, archived: boolean) => {
    try {
      const { error } = await (supabase as any)
        .from('contract_signature_requests')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', requestId);
      if (error) throw error;
      toast.success(archived ? 'Demande archivée.' : 'Demande désarchivée.');
      loadRequests();
    } catch (e) { toast.error(String((e as Error).message)); }
  };

  // ── Download finalized contract as PDF (print to PDF via browser) ──
  const downloadContract = async (r: SignatureRequest & { signers: SignerRow[] }) => {
    try {
      // Fetch all field values for this request
      const { data: flds, error } = await (supabase as any)
        .from('contract_signature_fields').select('*').eq('request_id', r.id);
      if (error) throw error;

      const signersById: Record<string, SignerRow> = {};
      r.signers.forEach(s => { signersById[s.id] = s; });

      const overlays = (flds || []).map((f: any) => {
        const s = signersById[f.signer_id];
        const name = s?.name || '';
        let inner = '';
        if (f.field_type === 'signature' && f.value) {
          inner = `<img src="${f.value}" style="max-width:100%;max-height:100%;object-fit:contain"/>`;
        } else if (f.field_type === 'initials' && f.value) {
          inner = f.value.startsWith('data:')
            ? `<img src="${f.value}" style="max-width:100%;max-height:100%;object-fit:contain"/>`
            : `<span style="font-family:'Dancing Script',cursive;font-weight:700;font-size:18px;color:#0a1d40">${escapeHtml(f.value)}</span>`;
        } else if (f.field_type === 'checkbox') {
          inner = f.value === 'true'
            ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;background:#10b981;color:#fff;font-weight:900;border-radius:3px">✓</span>`
            : '';
        } else if (f.value) {
          inner = `<span style="font-size:11px;color:#0a1d40;font-weight:600">${escapeHtml(f.value)}</span>`;
        }
        return `<div style="position:absolute;left:${f.x_pct}%;top:${f.y_pct}%;width:${f.width_pct}%;height:${f.height_pct}%;display:flex;align-items:center;justify-content:center;">${inner}</div>`;
      }).join('');

      const signedTable = r.signers.map(s => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(s.name)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(s.email || '—')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(s.role)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${s.status === 'signed' ? 'Signé' : s.status}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:10px">${s.signed_at ? new Date(s.signed_at).toLocaleString('fr-CA') : '—'}</td>
        </tr>`).join('');

      const docHtml = `<!doctype html><html><head><meta charset="utf-8"/>
<title>${escapeHtml(r.subject || 'Contrat')} — ${r.id.slice(0,8).toUpperCase()}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&display=swap"/>
<style>
  @page{size:letter;margin:0}
  *{box-sizing:border-box}
  body{margin:0;font-family:Helvetica,Arial,sans-serif;background:#fff;color:#111}
  .contract-wrap{position:relative}
  .cert{padding:30px;page-break-before:always}
  .cert h2{margin:0 0 14px;color:#0a1d40;font-size:18px;border-bottom:2px solid #0a1d40;padding-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{padding:6px 8px;text-align:left;background:#f3f4f6;color:#374151;font-size:10px;text-transform:uppercase;letter-spacing:.4px}
  .meta{font-size:11px;color:#374151;margin-bottom:14px;line-height:1.7}
  .meta b{color:#0a1d40}
  @media print{.no-print{display:none}}
</style></head><body>
<div class="no-print" style="padding:10px;background:#0a1d40;color:#fff;display:flex;justify-content:space-between;align-items:center">
  <span style="font-size:13px;font-weight:700">${escapeHtml(r.subject || 'Contrat')} — ${r.id.slice(0,8).toUpperCase()}</span>
  <button onclick="window.print()" style="padding:8px 16px;background:#fff;color:#0a1d40;border:none;border-radius:6px;font-weight:700;cursor:pointer">Imprimer / Enregistrer en PDF</button>
</div>
<div class="contract-wrap">
  ${r.contract_html || '<p style="padding:40px;text-align:center;color:#888">Contrat indisponible</p>'}
  ${overlays}
</div>
<div class="cert">
  <h2>Certificat d'authenticité</h2>
  <div class="meta">
    <div><b>Sujet :</b> ${escapeHtml(r.subject || '—')}</div>
    <div><b>Identifiant :</b> <span style="font-family:monospace">${r.id}</span></div>
    <div><b>Statut :</b> ${escapeHtml(r.status)}</div>
    <div><b>Envoyé :</b> ${r.sent_at ? new Date(r.sent_at).toLocaleString('fr-CA') : '—'}</div>
    <div><b>Complété :</b> ${r.completed_at ? new Date(r.completed_at).toLocaleString('fr-CA') : '—'}</div>
  </div>
  <table>
    <thead><tr><th>Signataire</th><th>Courriel</th><th>Rôle</th><th>Statut</th><th>Signé le</th></tr></thead>
    <tbody>${signedTable}</tbody>
  </table>
  <p style="margin-top:18px;font-size:10px;color:#6b7280;line-height:1.6">
    Document signé électroniquement conformément à la Loi concernant le cadre juridique des technologies de l'information (RLRQ c C-1.1).
    Toitures VB Inc. — R.B.Q : 5854-9353-01
  </p>
</div>
<script>setTimeout(()=>{try{window.focus();window.print();}catch(e){}},800)</script>
</body></html>`;

      const blob = new Blob([docHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) {
        toast.error('Veuillez autoriser les fenêtres pop-up.');
      }
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      toast.error('Erreur téléchargement : ' + String((e as Error).message));
    }
  };

  // ── Styles ──
  const btn: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
  };
  const primaryBtn: React.CSSProperties = {
    ...btn,
    background: 'linear-gradient(135deg,#6366f1,#4f46e5)', borderColor: 'transparent', color: '#fff',
  };
  const inp: React.CSSProperties = {
    width: '100%', padding: isMobile ? '12px 12px' : '7px 10px', borderRadius: 8,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#e2e8f0', fontSize: isMobile ? 16 : 11, outline: 'none',
    minHeight: isMobile ? 44 : undefined,
  };
  const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: '#9ca3af', marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' };

  // Variables disponibles (mêmes qu'aux courriels). Valeurs dérivées des défauts client.
  const smartVars: SmartVariable[] = QUOTE_VARIABLE_DEFS;
  const smartValues: SmartVariableValues = useMemo(() => {
    const [first = '', ...rest] = (defaultClient?.name || '').split(' ');
    const last = rest.join(' ');
    return {
      client_name: defaultClient?.name || '—',
      client_first: first,
      client_last: last,
      client_company: '',
      client_email: defaultClient?.email || '',
      client_phone: defaultClient?.phone || '',
      address: '',
    };
  }, [defaultClient?.name, defaultClient?.email, defaultClient?.phone]);

  // ============================================================
  // Render
  // ============================================================
  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[
          { k: 'editor', label: 'Annoter & envoyer' },
          { k: 'tracking', label: `Suivi (${requests.length})` },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)} style={{
            ...btn,
            background: tab === t.k ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
            borderColor: tab === t.k ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)',
            color: tab === t.k ? '#a5b4fc' : '#9ca3af',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'editor' && (
        <>
          {/* Signers */}
          <div style={sectionStyle}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserIcon size={13} /> Signataires
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {signers.map((s, i) => (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? 'auto 1fr auto' : '24px 1fr 1.4fr 1fr 100px 32px',
                  gridTemplateAreas: isMobile ? `"color name trash" "email email email" "phone phone phone" "role role role"` : undefined,
                  gap: isMobile ? 8 : 6, alignItems: 'center',
                  padding: isMobile ? 12 : 8, borderRadius: 8,
                  background: activeSignerIdx === i ? 'rgba(99,102,241,0.08)' : 'rgba(0,0,0,0.2)',
                  border: '1px solid ' + (activeSignerIdx === i ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'),
                  cursor: 'pointer',
                }} onClick={() => setActiveSignerIdx(i)}>
                  <div style={{ gridArea: isMobile ? 'color' : undefined, width: isMobile ? 18 : 14, height: isMobile ? 18 : 14, borderRadius: 4, background: s.color }} />
                  <input style={{ ...inp, gridArea: isMobile ? 'name' : undefined }} placeholder="Nom" value={s.name} onChange={e => setSigners(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input style={{ ...inp, gridArea: isMobile ? 'email' : undefined }} type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" placeholder="courriel@exemple.ca" value={s.email} onChange={e => setSigners(p => p.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} />
                  <input style={{ ...inp, gridArea: isMobile ? 'phone' : undefined }} type="tel" inputMode="tel" placeholder="Téléphone" value={s.phone || ''} onChange={e => setSigners(p => p.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
                  <select style={{ ...inp, gridArea: isMobile ? 'role' : undefined }} value={s.role} onChange={e => setSigners(p => p.map((x, j) => j === i ? { ...x, role: e.target.value as any } : x))}>
                    <option value="client">Client</option>
                    <option value="contractor">Entrepreneur</option>
                    <option value="witness">Témoin</option>
                  </select>
                  <button onClick={(e) => { e.stopPropagation(); removeSigner(i); }} aria-label="Supprimer le signataire" style={{ ...btn, gridArea: isMobile ? 'trash' : undefined, padding: isMobile ? 10 : 4, minHeight: isMobile ? 44 : undefined, minWidth: isMobile ? 44 : undefined, color: '#f87171', justifyContent: 'center' }}><Trash2 size={isMobile ? 16 : 12} /></button>
                </div>
              ))}
              <button onClick={addSigner} style={{ ...btn, justifyContent: 'center', minHeight: isMobile ? 48 : undefined, fontSize: isMobile ? 13 : 11, padding: isMobile ? '12px' : '6px 10px' }}><Plus size={isMobile ? 14 : 12} /> Ajouter un signataire</button>
            </div>
          </div>

          {/* Toolbar + Preview */}
          <div style={sectionStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 8 : 6, marginBottom: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Champs pour</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: signers[activeSignerIdx]?.color }}>{signers[activeSignerIdx]?.name || '—'}</span>
              <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
              {FIELD_TYPES.map(t => (
                <button key={t.key} onClick={() => setActiveTool(activeTool === t.key ? null : t.key)} style={{
                  ...btn,
                  minHeight: isMobile ? 40 : undefined,
                  padding: isMobile ? '10px 12px' : '6px 10px',
                  fontSize: isMobile ? 12 : 11,
                  background: activeTool === t.key ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                  borderColor: activeTool === t.key ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)',
                  color: activeTool === t.key ? '#a5b4fc' : '#cbd5e1',
                }}>{t.icon} {t.label}</button>
              ))}
              <span style={{ flex: 1 }} />
              {fields.length > 0 && (
                <button onClick={() => { if (confirm('Effacer tous les champs?')) setFields([]); }} style={{ ...btn, color: '#f87171' }}>
                  <Trash2 size={12} /> Tout effacer ({fields.length})
                </button>
              )}
            </div>
            <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 8px' }}>
              {activeTool ? 'Cliquez sur le contrat pour placer le champ. Glissez ensuite pour déplacer.' : 'Sélectionnez un outil, puis cliquez sur le contrat pour placer un champ.'}
            </p>

            {/* Preview with overlay */}
            <div ref={previewRef} onClick={onPreviewClick}
              onPointerMove={onPreviewPointerMove}
              onPointerLeave={onPreviewPointerLeave}
              style={{
                position: 'relative', width: '100%', background: '#fff',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'hidden',
                cursor: activeTool ? 'none' : 'default',
                touchAction: 'pan-y',
              }}>
              <iframe ref={iframeRef} title="contract-preview" style={{
                width: '100%', height: iframeHeight, border: 'none', display: 'block', pointerEvents: 'none',
              }} />
              {/* Ghost field attaché au curseur */}
              {activeTool && ghost && (() => {
                const def = FIELD_TYPES.find(t => t.key === activeTool)!;
                const s = signers[activeSignerIdx] || signers[0];
                return (
                  <div style={{
                    position: 'absolute', pointerEvents: 'none', zIndex: 20,
                    left: `${Math.max(0, Math.min(100 - def.w, ghost.x - def.w / 2))}%`,
                    top:  `${Math.max(0, Math.min(100 - def.h, ghost.y - def.h / 2))}%`,
                    width: `${def.w}%`, height: `${def.h}%`,
                    minHeight: isMobile ? 28 : 18,
                    background: hexToRgba(s.color, 0.22),
                    border: `2px dashed ${s.color}`,
                    borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: isMobile ? 11 : 10, fontWeight: 700, color: s.color,
                    boxShadow: `0 4px 14px ${hexToRgba(s.color, 0.35)}`,
                  }}>{def.label}</div>
                );
              })()}
              {fields.map(f => {
                const s = signers[f.signerIndex] || signers[0];
                const isActive = activeFieldId === f.id;
                const handleSize = isMobile ? 22 : 14;
                // Aperçu fictif "comme rempli" pour donner une idée de la taille
                const sampleName = s.name || 'Jean Tremblay';
                const sampleInitials = (sampleName.split(/\s+/).map(w => w[0] || '').join('').slice(0, 3) || 'JT').toUpperCase();
                const sampleDate = new Date().toLocaleDateString('fr-CA');
                const previewByType: Record<FieldType, React.ReactNode> = {
                  signature: (
                    <span style={{
                      fontFamily: '"Dancing Script", "Brush Script MT", cursive',
                      fontSize: 'clamp(14px, 3.4vw, 28px)', color: s.color,
                      lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden',
                    }}>{sampleName}</span>
                  ),
                  initials: (
                    <span style={{
                      fontFamily: '"Dancing Script", "Brush Script MT", cursive',
                      fontSize: 'clamp(12px, 2.4vw, 20px)', color: s.color,
                      lineHeight: 1,
                    }}>{sampleInitials}</span>
                  ),
                  date: (
                    <span style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 'clamp(9px, 1.4vw, 12px)', color: '#111' }}>{sampleDate}</span>
                  ),
                  name: (
                    <span style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 'clamp(9px, 1.4vw, 12px)', color: '#111' }}>{sampleName}</span>
                  ),
                  text: (
                    <span style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 'clamp(9px, 1.4vw, 12px)', color: '#111', fontStyle: 'italic', opacity: 0.7 }}>Texte saisi…</span>
                  ),
                  checkbox: (
                    <Check size={12} color={s.color} strokeWidth={3} />
                  ),
                };
                return (
                  <div key={f.id}
                    onPointerDown={e => onFieldPointerDown(e, f)}
                    onClick={e => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: `${f.x_pct}%`, top: `${f.y_pct}%`,
                      width: `${f.width_pct}%`, height: `${f.height_pct}%`,
                      minHeight: f.type === 'checkbox' ? (isMobile ? 18 : 14) : (isMobile ? 28 : 18),
                      background: hexToRgba(s.color, 0.15),
                      border: `${isActive ? 2 : 1.5}px ${isActive ? 'solid' : 'dashed'} ${s.color}`,
                      borderRadius: 4,
                      cursor: 'move', touchAction: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: isMobile ? 12 : 10, fontWeight: 700, color: s.color,
                      padding: f.type === 'checkbox' ? 0 : '0 4px',
                      userSelect: 'none',
                      boxShadow: isActive ? `0 0 0 3px ${hexToRgba(s.color, 0.2)}` : 'none',
                    }}>
                    <span style={{ pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                      {previewByType[f.type]}
                    </span>
                    {/* Étiquette flottante (type de champ) */}
                    {isActive && (
                      <span style={{
                        position: 'absolute', top: -16, left: 0,
                        fontSize: 9, fontWeight: 700, color: '#fff',
                        background: s.color, padding: '1px 6px', borderRadius: 3,
                        whiteSpace: 'nowrap', pointerEvents: 'none',
                      }}>{labelFor(f.type)} · {s.name}</span>
                    )}
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); setFields(p => p.filter(x => x.id !== f.id)); }}
                      aria-label="Supprimer le champ"
                      style={{
                        position: 'absolute', top: -handleSize/2, right: -handleSize/2,
                        width: handleSize + 4, height: handleSize + 4, borderRadius: 999,
                        background: '#ef4444', border: '2px solid #fff', color: '#fff',
                        fontSize: isMobile ? 14 : 11, lineHeight: 1, cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                        touchAction: 'none',
                      }}>×</button>
                    {/* Copier le champ (même style) */}
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => {
                        e.stopPropagation();
                        setFields(p => {
                          const copy: PlacedField = {
                            ...f, id: uid(),
                            x_pct: Math.min(100 - f.width_pct, f.x_pct + 2),
                            y_pct: Math.min(100 - f.height_pct, f.y_pct + f.height_pct + 1),
                          };
                          return [...p, copy];
                        });
                      }}
                      title="Dupliquer ce champ"
                      aria-label="Dupliquer ce champ"
                      style={{
                        position: 'absolute', top: -handleSize/2, right: handleSize + 4,
                        width: handleSize + 4, height: handleSize + 4, borderRadius: 999,
                        background: s.color, border: '2px solid #fff', color: '#fff',
                        cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        touchAction: 'none',
                      }}><Copy size={isMobile ? 11 : 9} /></button>
                    {/* Resize handle (bottom-right) */}
                    <div
                      onPointerDown={e => onResizePointerDown(e, f)}
                      aria-label="Redimensionner"
                      style={{
                        position: 'absolute', right: -handleSize/2, bottom: -handleSize/2,
                        width: handleSize, height: handleSize, borderRadius: 4,
                        background: '#fff', border: `2px solid ${s.color}`,
                        cursor: 'nwse-resize', touchAction: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                      }}>
                      <Move size={isMobile ? 12 : 8} color={s.color} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Message + send */}
          <div style={sectionStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <SmartTextEditor
                  label="Sujet du courriel"
                  value={subject} onChange={setSubject}
                  variables={smartVars} values={smartValues}
                  multiline={false} showPalette paletteCompact showPreview={false}
                />
              </div>
              <div>
                <label style={lbl}>Expire dans (jours)</label>
                <input style={inp} type="number" value={expiresInDays} onChange={e => setExpiresInDays(Math.max(1, Number(e.target.value) || 30))} />
              </div>
            </div>
            <SmartTextEditor
              label="Message"
              value={message} onChange={setMessage}
              variables={smartVars} values={smartValues}
              multiline rows={5} showPalette showPreview
            />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={handleSend} disabled={sending}
                style={{
                  ...primaryBtn,
                  padding: isMobile ? '14px 18px' : '10px 18px',
                  fontSize: isMobile ? 14 : 12,
                  width: isMobile ? '100%' : 'auto',
                  justifyContent: 'center',
                  minHeight: isMobile ? 48 : undefined,
                  opacity: sending ? 0.6 : 1, cursor: sending ? 'not-allowed' : 'pointer',
                }}>
                {sending ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Envoi…</> : <><Send size={14} /> Envoyer pour signature</>}
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'tracking' && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>Demandes de signature</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setShowArchived(v => !v)} style={{
                ...btn,
                background: showArchived ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                borderColor: showArchived ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)',
                color: showArchived ? '#a5b4fc' : '#cbd5e1',
              }}>
                <Archive size={11} /> {showArchived ? 'Voir actifs' : 'Voir archivés'}
              </button>
              <button onClick={loadRequests} style={btn}><RefreshCw size={11} /> Actualiser</button>
            </div>
          </div>
          {loadingRequests ? (
            <div style={{ color: '#9ca3af', fontSize: 11, padding: 12 }}>Chargement…</div>
          ) : (() => {
            const filtered = requests.filter(r => showArchived ? !!r.archived_at : !r.archived_at);
            if (filtered.length === 0) {
              return <div style={{ color: '#6b7280', fontSize: 11, padding: 12, textAlign: 'center' }}>
                {showArchived ? 'Aucune demande archivée.' : 'Aucune demande active.'}
              </div>;
            }
            return filtered.map(r => (
            <div key={r.id} style={{
              padding: 12, marginBottom: 10, borderRadius: 8,
              background: r.archived_at ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.25)',
              border: '1px solid ' + (r.archived_at ? 'rgba(156,163,175,0.2)' : 'rgba(255,255,255,0.06)'),
              opacity: r.archived_at ? 0.85 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{r.subject}</span>
                {r.archived_at && <span style={{ fontSize: 9, color: '#9ca3af', background: 'rgba(156,163,175,0.15)', padding: '2px 6px', borderRadius: 999, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Archivé</span>}
                <StatusPill status={r.status} />
                <span style={{ fontSize: 10, color: '#6b7280' }}>{r.sent_at ? new Date(r.sent_at).toLocaleString('fr-CA') : ''}</span>
              </div>
              {/* Progress */}
              <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  height: '100%', width: `${r.progress_percent || 0}%`,
                  background: r.status === 'completed' ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#6366f1,#a5b4fc)',
                  transition: 'width 0.3s',
                }} />
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 8 }}>{r.progress_percent || 0}% — {r.signers.filter(s => s.status === 'signed').length} / {r.signers.length} signataires</div>
              {/* Signers */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {r.signers.map(s => (
                  <div key={s.id} style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '10px 1fr auto' : '14px 1.6fr 1.6fr 110px 100px 1fr',
                    gridTemplateAreas: isMobile ? `"dot name status" "email email email" "date date actions"` : undefined,
                    gap: 8, alignItems: 'center', rowGap: isMobile ? 6 : 8,
                    padding: isMobile ? 10 : '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.02)',
                  }}>
                    <div style={{ gridArea: isMobile ? 'dot' : undefined, width: 10, height: 10, borderRadius: 5, background: s.color }} />
                    <span style={{ gridArea: isMobile ? 'name' : undefined, fontSize: isMobile ? 13 : 11, color: '#e2e8f0', fontWeight: 600 }}>{s.name}</span>
                    <span style={{ gridArea: isMobile ? 'email' : undefined, fontSize: isMobile ? 12 : 10, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email || '—'}</span>
                    <div style={{ gridArea: isMobile ? 'status' : undefined, display: 'flex', justifyContent: isMobile ? 'flex-end' : 'flex-start' }}>
                      <StatusPill status={s.status} mini />
                    </div>
                    <span style={{ gridArea: isMobile ? 'date' : undefined, fontSize: isMobile ? 11 : 10, color: '#6b7280' }}>{s.signed_at ? new Date(s.signed_at).toLocaleDateString('fr-CA') : s.viewed_at ? 'Vu' : '—'}</span>
                    <div style={{ gridArea: isMobile ? 'actions' : undefined, display: 'flex', gap: isMobile ? 8 : 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button onClick={() => copyLink(s.signer_token)} title="Copier le lien" aria-label="Copier le lien" style={{ ...btn, padding: isMobile ? 10 : 4, minHeight: isMobile ? 44 : undefined, minWidth: isMobile ? 44 : undefined, justifyContent: 'center' }}><Copy size={isMobile ? 14 : 10} /></button>
                      <a href={`/sign/${s.signer_token}`} target="_blank" rel="noopener noreferrer" title="Ouvrir" aria-label="Ouvrir le lien" style={{ ...btn, padding: isMobile ? 10 : 4, minHeight: isMobile ? 44 : undefined, minWidth: isMobile ? 44 : undefined, textDecoration: 'none', justifyContent: 'center' }}><ExternalLink size={isMobile ? 14 : 10} /></a>
                      {s.status !== 'signed' && r.status !== 'voided' && (
                        <button onClick={() => handleRemind(r.id, s.id)} title="Renvoyer" aria-label="Renvoyer" style={{ ...btn, padding: isMobile ? 10 : 4, minHeight: isMobile ? 44 : undefined, minWidth: isMobile ? 44 : undefined, justifyContent: 'center' }}><Mail size={isMobile ? 14 : 10} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {r.status !== 'completed' && r.status !== 'voided' && (
                  <>
                    <button onClick={() => handleRemind(r.id)} style={btn}><Mail size={11} /> Rappel à tous</button>
                    <button onClick={() => handleVoid(r.id)} style={{ ...btn, color: '#f87171' }}><Ban size={11} /> Annuler</button>
                  </>
                )}
                <button onClick={() => downloadContract(r)} style={{ ...btn, color: '#a5b4fc' }} title="Télécharger le contrat (PDF via impression)">
                  <Download size={11} /> Télécharger PDF
                </button>
                {r.signed_pdf_url && (
                  <a href={r.signed_pdf_url} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none' }}>
                    <ExternalLink size={11} /> PDF signé
                  </a>
                )}
                {!r.archived_at ? (
                  <button onClick={() => setArchived(r.id, true)} style={{ ...btn, marginLeft: 'auto' }} title="Archiver">
                    <Archive size={11} /> Archiver
                  </button>
                ) : (
                  <button onClick={() => setArchived(r.id, false)} style={{ ...btn, marginLeft: 'auto' }} title="Désarchiver">
                    <ArchiveRestore size={11} /> Désarchiver
                  </button>
                )}
              </div>
            </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
};

function labelFor(t: FieldType): string {
  switch (t) {
    case 'signature': return 'Signature';
    case 'initials':  return 'Init.';
    case 'date':      return 'Date';
    case 'name':      return 'Nom';
    case 'text':      return 'Texte';
    case 'checkbox':  return '☐';
  }
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  draft:            { label: 'Brouillon',  color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' },
  sent:             { label: 'Envoyé',     color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  viewed:           { label: 'Vu',         color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  pending:          { label: 'En attente', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  partially_signed: { label: 'Partiel',    color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  signed:           { label: 'Signé',      color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  completed:        { label: 'Complété',   color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  declined:         { label: 'Refusé',     color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  expired:          { label: 'Expiré',     color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  voided:           { label: 'Annulé',     color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
};

const StatusPill: React.FC<{ status: string; mini?: boolean }> = ({ status, mini }) => {
  const s = STATUS_LABELS[status] || { label: status, color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' };
  return (
    <span style={{
      display: 'inline-block', padding: mini ? '2px 6px' : '3px 8px',
      borderRadius: 999, background: s.bg, color: s.color,
      fontSize: mini ? 9 : 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3,
    }}>{s.label}</span>
  );
};

export default ContractSignatureStep;