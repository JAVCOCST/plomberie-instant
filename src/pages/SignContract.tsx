import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, PenLine, CheckCircle2, ShieldCheck, FileSignature, Lock, ArrowRight, Eraser, Download, Maximize2, X, ChevronDown } from 'lucide-react';

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface Field {
  id: string; signerId: string;
  type: 'signature' | 'initials' | 'date' | 'text' | 'checkbox' | 'name';
  page: number; x: number; y: number; w: number; h: number;
  required: boolean; label?: string; value?: string; signedAt?: string; mine: boolean;
}

type Step = 'terms' | 'sign' | 'review' | 'done';

// ── DocuSign-like script font for initials/typed signature ──
const SCRIPT_FONT = '"Dancing Script","Brush Script MT","Lucida Handwriting",cursive';

function shortId(uuid: string): string {
  return uuid ? uuid.replace(/-/g, '').slice(0, 8).toUpperCase() : '';
}

const SignContract: React.FC = () => {
  const { token = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [step, setStep] = useState<Step>('terms');

  // Inputs
  const [consent, setConsent] = useState(false);
  const [signatureData, setSignatureData] = useState<string>('');
  const [initialsText, setInitialsText] = useState<string>('');
  const [initialsImage, setInitialsImage] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Iframe layout
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [iframeHeight, setIframeHeight] = useState(1100);

  // Signature canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fsCanvasRef = useRef<HTMLCanvasElement>(null);
  const [fullscreenPad, setFullscreenPad] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth < 720 : false);

  useEffect(() => {
    const onR = () => setIsMobile(window.innerWidth < 720);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  // ── Load ──
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${FUNCTIONS_BASE}/contract-signature-public?action=get&token=${encodeURIComponent(token)}`, {
          headers: { 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || 'Erreur');
        setData(j);
        // Default initials = initiales du nom
        const auto = (j.signer.name || '')
          .split(/\s+/).filter(Boolean).map((w: string) => w[0]).join('').slice(0, 4).toUpperCase();
        setInitialsText(auto);
        const initial: Record<string, string> = {};
        (j.fields as Field[]).forEach(f => {
          if (f.type === 'date' && f.mine) initial[f.id] = new Date().toLocaleDateString('fr-CA');
          if (f.type === 'name' && f.mine) initial[f.id] = j.signer.name;
        });
        setValues(initial);
        if (j.signer.status === 'signed') setStep('done');
      } catch (e) { setError(String((e as Error).message)); }
      finally { setLoading(false); }
    })();
  }, [token]);

  // ── Inject contract HTML in iframe (used in step "review" and "done") ──
  useEffect(() => {
    if (!data?.request?.contractHtml || !iframeRef.current) return;
    if (step !== 'review' && step !== 'done') return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<base target="_blank"/>
<style>
  html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Helvetica,Arial,sans-serif;overflow-x:hidden;}
  img{max-width:100%;height:auto;}
  .page,[class*="page"]{width:100% !important;max-width:100% !important;min-height:auto !important;margin:0 auto !important;box-shadow:none !important;}
  body > *{max-width:100% !important;} table{max-width:100% !important;}
  @media (max-width: 720px){
    .parties,.meta{display:block !important;}
    .party,.mc{border-left:none !important;border-top:1px solid #ccc !important;}
    .party:first-child,.mc:first-child{border-top:none !important;}
  }
</style></head><body>${data.request.contractHtml}</body></html>`;
    const f = iframeRef.current;
    f.srcdoc = html;
    const onLoad = () => {
      try {
        const doc = f.contentDocument;
        if (doc) setIframeHeight(Math.max(800, doc.body.scrollHeight + 60));
      } catch {}
    };
    f.addEventListener('load', onLoad);
    return () => f.removeEventListener('load', onLoad);
  }, [data?.request?.contractHtml, step]);

  // ── Signature drawing (reusable attach helper) ──
  const attachSigPad = (c: HTMLCanvasElement | null) => {
    if (!c) return () => {};
    const ctx = c.getContext('2d'); if (!ctx) return () => {};
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.max(1, rect.width * dpr);
    c.height = Math.max(1, rect.height * dpr);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#0a1d40';
    ctx.lineWidth = isMobile ? 3.2 : 2.4;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Replay existing signature if present
    if (signatureData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = signatureData;
    }
    let drawing = false, last: { x: number; y: number } | null = null;
    const pos = (e: MouseEvent | TouchEvent) => {
      const r = c.getBoundingClientRect();
      const p = 'touches' in e ? e.touches[0] : (e as MouseEvent);
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    };
    const down = (e: any) => { drawing = true; last = pos(e); e.preventDefault(); };
    const move = (e: any) => {
      if (!drawing || !last) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; e.preventDefault();
      setSignatureData(c.toDataURL('image/png'));
    };
    const up = () => { drawing = false; last = null; };
    c.addEventListener('mousedown', down); c.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    c.addEventListener('touchstart', down, { passive: false });
    c.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    return () => {
      c.removeEventListener('mousedown', down); c.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      c.removeEventListener('touchstart', down); c.removeEventListener('touchmove', move); window.removeEventListener('touchend', up);
    };
  };

  useEffect(() => {
    if (step !== 'sign' || fullscreenPad) return;
    return attachSigPad(canvasRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, fullscreenPad]);

  useEffect(() => {
    if (!fullscreenPad) return;
    // Lock body scroll while pad is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const cleanup = attachSigPad(fsCanvasRef.current);
    return () => { document.body.style.overflow = prev; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenPad]);

  // ── Render initials text → PNG (DocuSign-like script) ──
  useEffect(() => {
    if (!initialsText.trim()) { setInitialsImage(''); return; }
    const c = document.createElement('canvas');
    c.width = 360; c.height = 180;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0a1d40';
    ctx.font = `bold 110px ${SCRIPT_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initialsText.toUpperCase().slice(0, 4), c.width / 2, c.height / 2);
    setInitialsImage(c.toDataURL('image/png'));
  }, [initialsText]);

  const clearSig = () => {
    [canvasRef.current, fsCanvasRef.current].forEach(c => {
      if (!c) return;
      c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    });
    setSignatureData('');
  };

  // ── Submit signing ──
  const submit = async () => {
    const myFields = (data.fields as Field[]).filter(f => f.mine);
    const hasSig = myFields.some(f => f.type === 'signature');
    if (hasSig && !signatureData) { alert('Veuillez dessiner votre signature.'); return; }
    setSubmitting(true);
    try {
      // Fill initials fields with initialsImage if any
      const vals = { ...values };
      myFields.forEach(f => {
        if (f.type === 'initials' && !vals[f.id]) vals[f.id] = initialsImage || initialsText;
      });
      const r = await fetch(`${FUNCTIONS_BASE}/contract-signature-public?action=submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
        body: JSON.stringify({ token, fieldValues: vals, signatureDataUrl: signatureData, consent: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Erreur');
      // Re-fetch to get authoritative state + signature image URL + events
      const r2 = await fetch(`${FUNCTIONS_BASE}/contract-signature-public?action=get&token=${encodeURIComponent(token)}`, {
        headers: { 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
      });
      const j2 = await r2.json();
      if (r2.ok) setData(j2);
      setStep('done');
      window.scrollTo({ top: 0, behavior: 'instant' as any });
    } catch (e) { alert(String((e as Error).message)); }
    finally { setSubmitting(false); }
  };

  // ─────────── Loading / error ───────────
  if (loading) return <Center><Loader2 className="animate-spin" /> Chargement…</Center>;
  if (error) return <Center color="#b91c1c">{error}</Center>;
  if (!data) return null;

  const myFields = (data.fields as Field[]).filter(f => f.mine);
  const requestShortId = shortId(data.request.id);
  const signerShortId = shortId(data.signer.id);

  // ═══════════ STEP: DONE (full-page signed view) ═══════════
  if (step === 'done') {
    return (
      <div style={{ background: '#525659', minHeight: '100vh' }}>
        <FullDocView
          iframeRef={iframeRef}
          wrapRef={wrapRef}
          iframeHeight={iframeHeight}
          fields={data.fields}
          signers={data.signers}
          requestId={data.request.id}
        />
        <CertificateOfCompletion data={data} />
      </div>
    );
  }

  // ═══════════ Header (steps 1-3) ═══════════
  const Header = (
    <div style={{ background: '#0a1d40', color: '#fff', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={20} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{data.request.subject}</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>Réf. {requestShortId} · {data.signer.name}</div>
          </div>
        </div>
        <Stepper step={step} />
      </div>
    </div>
  );

  // ═══════════ STEP: TERMS ═══════════
  if (step === 'terms') {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f5f7' }}>
        {Header}
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
          <div style={card}>
            <h1 style={{ margin: 0, fontSize: 22, color: '#0a1d40', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Lock size={20} /> Termes et conditions de signature électronique
            </h1>
            <p style={{ color: '#374151', fontSize: 14, lineHeight: 1.6, marginTop: 14 }}>
              Avant d'apposer votre signature, veuillez prendre connaissance des conditions suivantes :
            </p>
            <ul style={{ color: '#374151', fontSize: 13, lineHeight: 1.7, paddingLeft: 18 }}>
              <li>Votre signature électronique a la <b>même valeur juridique</b> qu'une signature manuscrite (Loi concernant le cadre juridique des technologies de l'information, RLRQ c C-1.1).</li>
              <li>Votre adresse IP, votre navigateur et l'horodatage seront enregistrés à des fins de preuve.</li>
              <li>Un <b>certificat d'authenticité</b> sera attaché au document final.</li>
              <li>Vous recevrez une copie du document signé par courriel à <b>{data.signer.email}</b>.</li>
              <li>Le lien est <b>personnel et confidentiel</b>; ne le partagez pas.</li>
            </ul>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#0a1d40', marginTop: 18, padding: 14, background: '#eef2ff', borderRadius: 8, border: '1px solid #c7d2fe', cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, accentColor: '#4f46e5' }} />
              <span><b>J'accepte</b> d'utiliser une signature électronique et reconnais avoir lu les conditions ci-dessus.</span>
            </label>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setStep('sign')} disabled={!consent} style={{ ...primaryBtn, opacity: consent ? 1 : 0.5, cursor: consent ? 'pointer' : 'not-allowed' }}>
                Continuer <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════ STEP: SIGN ═══════════
  if (step === 'sign') {
    const needsSig = myFields.some(f => f.type === 'signature');
    const needsInit = myFields.some(f => f.type === 'initials');
    const requiredText = myFields.filter(f => f.required && f.type === 'text');
    const requiredCheckbox = myFields.filter(f => f.required && f.type === 'checkbox');
    const missingText = requiredText.filter(f => !(values[f.id] || '').trim());
    const missingCheckbox = requiredCheckbox.filter(f => values[f.id] !== 'true');
    const canContinue =
      (!needsSig || signatureData) &&
      (!needsInit || initialsText.trim().length >= 1) &&
      missingText.length === 0 &&
      missingCheckbox.length === 0;
    return (
      <div style={{ minHeight: '100vh', background: '#f4f5f7' }}>
        {Header}
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
          <div style={card}>
            <h1 style={{ margin: 0, fontSize: 20, color: '#0a1d40', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileSignature size={18} /> Créez votre signature
            </h1>
            <p style={{ color: '#6b7280', fontSize: 12, marginTop: 6 }}>Elle sera apposée sur tous les champs de signature qui vous sont assignés.</p>

            {needsSig && (
              <div style={{ marginTop: 18 }}>
                <div style={fieldLabel}><PenLine size={13} /> Signature manuscrite</div>
                <canvas ref={canvasRef}
                  style={{ width: '100%', height: isMobile ? 220 : 180, background: '#fafafa', border: '1.5px dashed #cbd5e1', borderRadius: 8, touchAction: 'none', cursor: 'crosshair', display: 'block' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>Signez avec la souris ou le doigt</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setFullscreenPad(true)} style={{ ...ghostBtn, minHeight: 44, padding: '10px 14px' }}>
                      <Maximize2 size={14} /> Signer en grand
                    </button>
                    <button onClick={clearSig} style={{ ...ghostBtn, minHeight: 44, padding: '10px 14px' }}><Eraser size={14} /> Effacer</button>
                  </div>
                </div>
              </div>
            )}

            {needsInit && (
              <div style={{ marginTop: 22 }}>
                <div style={fieldLabel}>Vos initiales</div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 180px', gap: 12, alignItems: 'stretch' }}>
                  <input
                    value={initialsText} maxLength={4}
                    onChange={e => setInitialsText(e.target.value.toUpperCase().replace(/[^A-ZÀ-Ý]/g, ''))}
                    placeholder="JV"
                    style={{ padding: 16, fontSize: 16, fontWeight: 700, textAlign: 'center', letterSpacing: 4, minHeight: 52,
                      border: '1.5px solid #cbd5e1', borderRadius: 8, outline: 'none', textTransform: 'uppercase' }} />
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80,
                    background: '#fafafa', border: '1.5px dashed #cbd5e1', borderRadius: 8,
                    fontFamily: SCRIPT_FONT, fontSize: 44, color: '#0a1d40', fontWeight: 700,
                  }}>{initialsText || '—'}</div>
                </div>
                <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>Aperçu manuscrit généré automatiquement.</p>
              </div>
            )}

            {/* Other fields the signer must fill (text/checkbox) */}
            {myFields.filter(f => f.type === 'text' || f.type === 'checkbox').length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={fieldLabel}>Informations supplémentaires</div>
                <p style={{ fontSize: 11, color: '#6b7280', marginTop: -4, marginBottom: 10 }}>
                  Vous pouvez aussi cocher les cases directement sur le contrat à l'étape suivante.
                </p>
                {myFields.filter(f => f.type === 'text' || f.type === 'checkbox').map(f => (
                  <div key={f.id} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                      {f.label || f.type}{f.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
                    </div>
                    {f.type === 'checkbox' ? (
                      <button type="button"
                        onClick={() => setValues(v => ({ ...v, [f.id]: v[f.id] === 'true' ? '' : 'true' }))}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: '#0a1d40',
                          minHeight: 48, padding: '10px 14px', width: '100%', textAlign: 'left',
                          background: values[f.id] === 'true' ? '#ecfdf5' : '#fffbeb',
                          border: '1.5px solid ' + (values[f.id] === 'true' ? '#10b981' : '#f59e0b'),
                          borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                        }}>
                        <span style={{
                          width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                          background: values[f.id] === 'true' ? '#10b981' : 'transparent',
                          border: '2px solid ' + (values[f.id] === 'true' ? '#059669' : '#f59e0b'),
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 900,
                        }}>{values[f.id] === 'true' ? '✓' : ''}</span>
                        {f.label || 'Confirmer'}
                      </button>
                    ) : (
                      <input value={values[f.id] || ''} onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))}
                        style={{ width: '100%', padding: 14, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 16, minHeight: 48 }} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {!canContinue && (missingText.length + missingCheckbox.length > 0) && (
              <div style={{ marginTop: 14, padding: 10, background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 8, fontSize: 12 }}>
                Champs requis manquants : {[...missingText, ...missingCheckbox].map(f => f.label || f.type).join(', ')}
              </div>
            )}
            <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => setStep('terms')} style={{ ...ghostBtn, minHeight: 48, padding: '12px 18px', fontSize: 14 }}>← Retour</button>
              <button onClick={() => setStep('review')} disabled={!canContinue}
                style={{ ...primaryBtn, minHeight: 48, padding: '12px 22px', fontSize: 15, opacity: canContinue ? 1 : 0.5, cursor: canContinue ? 'pointer' : 'not-allowed' }}>
                Aperçu du contrat <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {fullscreenPad && (
          <FullscreenSignaturePad
            canvasRef={fsCanvasRef}
            onClear={clearSig}
            onClose={() => setFullscreenPad(false)}
            hasSignature={!!signatureData}
          />
        )}
      </div>
    );
  }

  // ═══════════ STEP: REVIEW (preview with signatures applied) ═══════════
  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7' }}>
      {Header}
      <div style={{ maxWidth: 980, margin: '0 auto', padding: 16 }}>
        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#3730a3', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          Vérifiez le placement de votre signature ci-dessous. Cliquez sur <b>Terminer et signer</b> pour finaliser.
        </div>
        <DocWithFields
          iframeRef={iframeRef}
          wrapRef={wrapRef}
          iframeHeight={iframeHeight}
          fields={data.fields}
          signers={data.signers}
          requestId={data.request.id}
          previewSignatureUrl={signatureData}
          previewInitialsUrl={initialsImage}
          previewSignerId={data.signer.id}
          previewSignerName={data.signer.name}
          values={values}
          onToggleCheckbox={(fid) => setValues(v => ({ ...v, [fid]: v[fid] === 'true' ? '' : 'true' }))}
          onChangeText={(fid, val) => setValues(v => ({ ...v, [fid]: val }))}
        />
        <div style={{
          position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e5e7eb',
          padding: '12px 14px calc(12px + env(safe-area-inset-bottom))', marginTop: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          borderRadius: '0 0 10px 10px', boxShadow: '0 -4px 12px rgba(0,0,0,0.06)',
        }}>
          <button onClick={() => setStep('sign')} style={{ ...ghostBtn, minHeight: 48, padding: '12px 16px', fontSize: 13 }} disabled={submitting}>← Modifier</button>
          <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, minHeight: 52, padding: '14px 22px', fontSize: 15, flex: isMobile ? 1 : 'initial', justifyContent: 'center' }}>
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Finalisation…</> : <><CheckCircle2 size={16} /> Terminer et signer</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// Fullscreen signature pad — mobile-first immersive drawing surface
const FullscreenSignaturePad: React.FC<{
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onClear: () => void;
  onClose: () => void;
  hasSignature: boolean;
}> = ({ canvasRef, onClear, onClose, hasSignature }) => {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: '#0a1d40',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px calc(14px + env(safe-area-inset-top)) 18px',
        color: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PenLine size={18} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Signez ici</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Utilisez tout l'écran pour une signature précise</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Fermer" style={{
          width: 44, height: 44, borderRadius: 999, border: '1px solid rgba(255,255,255,0.25)',
          background: 'rgba(255,255,255,0.08)', color: '#fff', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}><X size={20} /></button>
      </div>

      <div style={{ flex: 1, padding: '0 14px', display: 'flex' }}>
        <div style={{ flex: 1, background: '#fff', borderRadius: 12, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 16, right: 16, bottom: 16, height: 1,
            background: 'repeating-linear-gradient(to right,#cbd5e1 0 6px,transparent 6px 12px)',
          }} />
          <div style={{
            position: 'absolute', left: 18, bottom: 22, fontSize: 11, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase',
          }}>×  Signature</div>
          <canvas ref={canvasRef} style={{
            width: '100%', height: '100%', display: 'block',
            touchAction: 'none', cursor: 'crosshair',
          }} />
        </div>
      </div>

      <div style={{
        display: 'flex', gap: 10, padding: '14px 14px calc(14px + env(safe-area-inset-bottom))',
      }}>
        <button onClick={onClear} style={{
          flex: 1, minHeight: 52, borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)',
          background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 700, fontSize: 14,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
        }}><Eraser size={16} /> Effacer</button>
        <button onClick={onClose} disabled={!hasSignature} style={{
          flex: 2, minHeight: 52, borderRadius: 10, border: 'none',
          background: hasSignature ? '#10b981' : 'rgba(255,255,255,0.15)',
          color: '#fff', fontWeight: 800, fontSize: 15, cursor: hasSignature ? 'pointer' : 'not-allowed',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}><CheckCircle2 size={18} /> Confirmer ma signature</button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
//  Sub-components
// ═══════════════════════════════════════════════════════════════════

const Stepper: React.FC<{ step: Step }> = ({ step }) => {
  const items: { k: Step; label: string }[] = [
    { k: 'terms', label: '1. Termes' },
    { k: 'sign', label: '2. Signature' },
    { k: 'review', label: '3. Aperçu' },
  ];
  const idx = items.findIndex(i => i.k === step);
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
      {items.map((it, i) => (
        <div key={it.k} style={{
          padding: '6px 10px', borderRadius: 999,
          background: i <= idx ? 'rgba(255,255,255,0.18)' : 'transparent',
          color: i <= idx ? '#fff' : 'rgba(255,255,255,0.5)',
          border: '1px solid rgba(255,255,255,0.2)', fontWeight: 600,
        }}>{it.label}</div>
      ))}
    </div>
  );
};

const DocWithFields: React.FC<{
  iframeRef: React.RefObject<HTMLIFrameElement>;
  wrapRef: React.RefObject<HTMLDivElement>;
  iframeHeight: number;
  fields: Field[];
  signers: any[];
  requestId: string;
  previewSignatureUrl?: string;
  previewInitialsUrl?: string;
  previewSignerId?: string;
  previewSignerName?: string;
  values?: Record<string, string>;
  onToggleCheckbox?: (fieldId: string) => void;
  onChangeText?: (fieldId: string, value: string) => void;
}> = ({ iframeRef, wrapRef, iframeHeight, fields, signers, requestId, previewSignatureUrl, previewInitialsUrl, previewSignerId, previewSignerName, values, onToggleCheckbox, onChangeText }) => {
  const signerMap = useMemo(() => {
    const m: Record<string, any> = {};
    (signers || []).forEach(s => { m[s.id] = s; });
    return m;
  }, [signers]);
  return (
    <div ref={wrapRef} style={{ position: 'relative', background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
      <iframe ref={iframeRef} title="contract" style={{ width: '100%', height: iframeHeight, border: 'none', display: 'block', pointerEvents: 'none' }} />
      {fields.map((f: Field) => {
        const isPreviewMine = previewSignerId && f.signerId === previewSignerId;
        const signer = signerMap[f.signerId];
        const signerName = signer?.name || previewSignerName || '';
        // Determine displayed value
        let imgSrc: string | null = null;
        let textVal: string | null = null;
        if (f.type === 'signature') {
          if (f.value) imgSrc = f.value;
          else if (isPreviewMine && previewSignatureUrl) imgSrc = previewSignatureUrl;
        } else if (f.type === 'initials') {
          if (f.value && f.value.startsWith('data:')) imgSrc = f.value;
          else if (f.value) textVal = f.value;
          else if (isPreviewMine && previewInitialsUrl) imgSrc = previewInitialsUrl;
        } else if (f.type === 'date') {
          textVal = f.value || new Date().toLocaleDateString('fr-CA');
        } else if (f.type === 'name') {
          textVal = f.value || signerName;
        } else if (f.type === 'text') {
          textVal = f.value || '';
        } else if (f.type === 'checkbox') {
          const liveVal = values?.[f.id] ?? f.value;
          textVal = liveVal === 'true' ? '✓' : '';
        }
        const filled = !!imgSrc || !!textVal;
        const signedFinal = !!f.value || !!f.signedAt;

        // Interactive checkbox for the current signer (live editing on the contract)
        if (f.type === 'checkbox' && isPreviewMine && !signedFinal && onToggleCheckbox) {
          const checked = (values?.[f.id] ?? '') === 'true';
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onToggleCheckbox(f.id)}
              title={f.label || 'Cocher'}
              style={{
                position: 'absolute', left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%`,
                minWidth: 26, minHeight: 26,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: checked ? '#10b981' : 'rgba(245, 158, 11, 0.35)',
                border: '2px solid ' + (checked ? '#059669' : '#f59e0b'),
                color: '#fff', borderRadius: 4, padding: 0, cursor: 'pointer',
                fontWeight: 900, fontSize: 16, lineHeight: 1,
                boxShadow: checked ? '0 0 0 2px rgba(16,185,129,0.25)' : '0 0 0 2px rgba(245,158,11,0.15)',
                transition: 'all .15s ease',
              }}
            >
              {checked ? '✓' : ''}
            </button>
          );
        }
        return (
          <div key={f.id} style={{
            position: 'absolute', left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%`,
            minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: signedFinal ? 'transparent' : (filled ? 'rgba(16,185,129,0.10)' : 'rgba(254,243,199,0.6)'),
            border: signedFinal ? 'none' : '1.5px ' + (filled ? 'solid #10b981' : 'dashed #f59e0b'),
            borderRadius: 4, overflow: 'visible', padding: 2,
          }}>
            {imgSrc ? (
              <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={imgSrc} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                {/* Unique ID badge under signature */}
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: -14,
                  fontSize: 8, color: '#475569', textAlign: 'center',
                  fontFamily: 'monospace', letterSpacing: 0.3, lineHeight: 1.1, pointerEvents: 'none',
                }}>
                  ID {shortId(f.id)} · {signerName.split(' ')[0] || ''}
                </div>
              </div>
            ) : textVal !== null ? (
              <span style={{
                fontSize: f.type === 'date' ? 11 : 12,
                fontFamily: f.type === 'initials' ? SCRIPT_FONT : 'inherit',
                fontWeight: f.type === 'initials' ? 700 : 600,
                color: '#0a1d40',
              }}>{textVal}</span>
            ) : (
              <span style={{ fontSize: 10, color: '#92400e', fontWeight: 600 }}>{f.type === 'signature' ? 'Signature' : f.label || f.type}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Full screen view after signing (no chrome above or below)
const FullDocView: React.FC<{
  iframeRef: React.RefObject<HTMLIFrameElement>;
  wrapRef: React.RefObject<HTMLDivElement>;
  iframeHeight: number;
  fields: Field[];
  signers: any[];
  requestId: string;
}> = ({ iframeRef, wrapRef, iframeHeight, fields, signers, requestId }) => {
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '20px 12px' }}>
      <div style={{ background: '#10b981', color: '#fff', padding: '10px 16px', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
        <CheckCircle2 size={16} /> Document signé avec succès · Réf. {shortId(requestId)}
      </div>
      <DocWithFields
        iframeRef={iframeRef} wrapRef={wrapRef} iframeHeight={iframeHeight}
        fields={fields} signers={signers} requestId={requestId}
      />
    </div>
  );
};

// Certificate of completion (DocuSign-style audit trail)
const CertificateOfCompletion: React.FC<{ data: any }> = ({ data }) => {
  const req = data.request;
  const signers = data.signers || [];
  const events = data.events || [];
  const certCard: React.CSSProperties = {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24,
    color: '#111', fontFamily: 'Helvetica,Arial,sans-serif',
  };
  const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, padding: '4px 0', fontSize: 12 };
  const evLabel: Record<string, string> = {
    sent: 'Envoyé', viewed: 'Consulté', signed: 'Signé', email_sent: 'Courriel envoyé',
    email_failed: 'Courriel échoué', reminder_sent: 'Rappel envoyé', voided: 'Annulé',
  };
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '0 12px 40px' }}>
      <div style={certCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #0a1d40', paddingBottom: 14, marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#0a1d40' }}>Certificat d'authenticité</h2>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Toitures VB Inc. · Signature électronique</div>
          </div>
          <ShieldCheck size={42} color="#0a1d40" />
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Document</div>
          <div style={row}><span style={{ color: '#6b7280' }}>Sujet</span><span style={{ fontWeight: 600 }}>{req.subject}</span></div>
          <div style={row}><span style={{ color: '#6b7280' }}>Identifiant</span><span style={{ fontFamily: 'monospace' }}>{req.id}</span></div>
          <div style={row}><span style={{ color: '#6b7280' }}>Référence courte</span><span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{shortId(req.id)}</span></div>
          <div style={row}><span style={{ color: '#6b7280' }}>Statut</span><span>{req.status}</span></div>
          <div style={row}><span style={{ color: '#6b7280' }}>Envoyé</span><span>{req.sentAt ? new Date(req.sentAt).toLocaleString('fr-CA') : '—'}</span></div>
          <div style={row}><span style={{ color: '#6b7280' }}>Complété</span><span>{req.completedAt ? new Date(req.completedAt).toLocaleString('fr-CA') : '—'}</span></div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Signataires</div>
          {signers.map((s: any) => (
            <div key={s.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 700, color: '#0a1d40' }}>{s.name} <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 400 }}>· ID {shortId(s.id)}</span></div>
                <div style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: s.status === 'signed' ? '#dcfce7' : '#fef3c7',
                  color: s.status === 'signed' ? '#166534' : '#92400e',
                }}>{s.status}</div>
              </div>
              <div style={row}><span style={{ color: '#6b7280' }}>Courriel</span><span>{s.email || '—'}</span></div>
              <div style={row}><span style={{ color: '#6b7280' }}>Rôle</span><span>{s.role}</span></div>
              {s.viewed_at && <div style={row}><span style={{ color: '#6b7280' }}>Consulté le</span><span>{new Date(s.viewed_at).toLocaleString('fr-CA')}</span></div>}
              {s.signed_at && <div style={row}><span style={{ color: '#6b7280' }}>Signé le</span><span>{new Date(s.signed_at).toLocaleString('fr-CA')}</span></div>}
              {s.ip_address && <div style={row}><span style={{ color: '#6b7280' }}>Adresse IP</span><span style={{ fontFamily: 'monospace' }}>{s.ip_address}</span></div>}
              {s.user_agent && <div style={row}><span style={{ color: '#6b7280' }}>Navigateur</span><span style={{ fontSize: 10, wordBreak: 'break-all' }}>{s.user_agent}</span></div>}
              {s.signature_image_url && (
                <div style={{ marginTop: 8, padding: 8, background: '#fafafa', borderRadius: 6, textAlign: 'center' }}>
                  <img src={s.signature_image_url} alt="signature" style={{ maxHeight: 80, maxWidth: '100%' }} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Journal d'événements</div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ background: '#f9fafb' }}>
                <tr>
                  <th style={{ padding: 8, textAlign: 'left', color: '#6b7280', fontWeight: 700 }}>Horodatage</th>
                  <th style={{ padding: 8, textAlign: 'left', color: '#6b7280', fontWeight: 700 }}>Événement</th>
                  <th style={{ padding: 8, textAlign: 'left', color: '#6b7280', fontWeight: 700 }}>IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 8 }}>{new Date(ev.created_at).toLocaleString('fr-CA')}</td>
                    <td style={{ padding: 8 }}>{evLabel[ev.event_type] || ev.event_type}</td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>{ev.ip_address || '—'}</td>
                  </tr>
                ))}
                {events.length === 0 && <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>Aucun événement</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 18, padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: 10, color: '#6b7280', lineHeight: 1.6 }}>
          Ce certificat constitue la preuve de l'authenticité et de l'intégrité du document signé électroniquement.
          Conformément à la <i>Loi concernant le cadre juridique des technologies de l'information</i> (RLRQ c C-1.1),
          la signature électronique a la même valeur juridique qu'une signature manuscrite.
          Toute altération du document après signature invalide la signature.
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
//  Styles & helpers
// ═══════════════════════════════════════════════════════════════════
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb',
  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
};
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 8, border: 'none',
  background: 'linear-gradient(135deg,#0a1d40,#1e3a8a)', color: '#fff',
  fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6,
};
const ghostBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6, border: '1px solid #cbd5e1',
  background: '#fff', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 4,
};
const fieldLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#0a1d40', marginBottom: 8,
  display: 'flex', alignItems: 'center', gap: 6,
};

const Center: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <div style={{ padding: 60, textAlign: 'center', color: color || '#374151', fontSize: 14 }}>{children}</div>
);

export default SignContract;