import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, Loader2, Check, Sparkles, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import ReactMarkdown from 'react-markdown';

interface QuoteEdit {
  action: 'add' | 'update' | 'remove';
  lineIndex?: number;
  description?: string;
  quantity?: number;
  unit?: string;
  rate?: number;
  reason: string;
}

interface SoumissionCreated {
  soumission_id: string;
  reference_id?: string;
  seq_number?: number;
  client: string;
  address: string;
  coverage?: string | null;
  product?: string | null;
  area?: string | null;
}

interface MsgData {
  role: 'user' | 'assistant';
  content: string;
  quote_edits?: QuoteEdit[] | null;
  soumission_created?: SoumissionCreated | null;
}

interface CopilotChatProps {
  context?: Record<string, any>;
  onApplyEdits?: (edits: QuoteEdit[]) => void;
}

const COPILOT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-copilot`;

const CopilotChat: React.FC<CopilotChatProps> = ({ context, onApplyEdits }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<MsgData[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [appliedEdits, setAppliedEdits] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Persisted draggable position for the mobile pastille
  const [fabPos, setFabPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem('copilot_fab_pos');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { x: 0, y: 0 };
  });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: MsgData = { role: 'user', content: input.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput('');
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Session expirée. Reconnectez-vous.' }]);
        setLoading(false);
        return;
      }

      const resp = await fetch(COPILOT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          messages: allMessages.map(m => ({ role: m.role, content: m.content })),
          context: context || null,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Erreur réseau' }));
        const errorMsg = err.error?.includes('ANTHROPIC_API_KEY')
          ? '⚠️ Clé API manquante — configurez ANTHROPIC_API_KEY dans les secrets Supabase Edge Functions.'
          : `❌ ${err.error || 'Erreur'}`;
        setMessages(prev => [...prev, { role: 'assistant', content: errorMsg }]);
        setLoading(false);
        return;
      }

      const data = await resp.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.content || 'Pas de réponse.',
        quote_edits: data.quote_edits,
        soumission_created: data.soumission_created,
      }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ Erreur de connexion.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyEdits = (edits: QuoteEdit[], msgIndex: number) => {
    if (onApplyEdits) {
      onApplyEdits(edits);
      setAppliedEdits(prev => new Set([...prev, msgIndex]));
    }
  };

  if (!open) {
    if (isMobile) {
      const SIZE = 52;
      const margin = 12;
      const maxX = (typeof window !== 'undefined' ? window.innerWidth : 400) - SIZE - margin;
      const maxY = (typeof window !== 'undefined' ? window.innerHeight : 800) - SIZE - margin - 80;
      const clamped = {
        x: Math.max(margin, Math.min(fabPos.x || maxX, maxX)),
        y: Math.max(80, Math.min(fabPos.y || maxY, maxY)),
      };
      return (
        <motion.button
          drag
          dragMomentum={false}
          dragElastic={0}
          dragConstraints={{ left: margin, right: maxX, top: 80, bottom: maxY }}
          onPointerDown={(e) => { dragStartRef.current = { x: e.clientX, y: e.clientY }; }}
          onClick={(e) => {
            // Suppress click if user actually dragged
            const s = dragStartRef.current;
            if (s) {
              const dx = (e as any).clientX - s.x;
              const dy = (e as any).clientY - s.y;
              if (Math.hypot(dx, dy) > 6) { e.preventDefault(); return; }
            }
            setOpen(true);
          }}
          onDragEnd={(_, info) => {
            const next = {
              x: Math.max(margin, Math.min(clamped.x + info.offset.x, maxX)),
              y: Math.max(80, Math.min(clamped.y + info.offset.y, maxY)),
            };
            setFabPos(next);
            try { localStorage.setItem('copilot_fab_pos', JSON.stringify(next)); } catch {}
          }}
          initial={false}
          animate={{ x: clamped.x, y: clamped.y }}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          style={{
            position: 'fixed', top: 0, left: 0, zIndex: 9999,
            width: SIZE, height: SIZE, borderRadius: SIZE / 2,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#fff', cursor: 'grab', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 10px 30px rgba(99,102,241,0.45), 0 0 0 1px rgba(255,255,255,0.05) inset',
            touchAction: 'none',
          }}
          whileTap={{ scale: 0.92, cursor: 'grabbing' as any }}
          aria-label="Ouvrir le copilote IA"
        >
          <Sparkles size={22} />
        </motion.button>
      );
    }
    return (
      <motion.button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          border: 'none', borderRadius: 16, padding: '14px 18px',
          color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 14, fontWeight: 600, boxShadow: '0 8px 32px rgba(99,102,241,0.4)',
        }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <Sparkles size={18} /> Copilote IA
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      style={{
        position: 'fixed',
        bottom: isMobile ? 0 : 24,
        right: isMobile ? 0 : 24,
        left: isMobile ? 0 : undefined,
        top: isMobile ? 'env(safe-area-inset-top)' : undefined,
        zIndex: 9999,
        width: isMobile ? '100vw' : 420,
        height: isMobile ? 'auto' : 560,
        display: 'flex', flexDirection: 'column',
        background: 'rgba(15,15,30,0.97)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(99,102,241,0.3)', borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bot size={18} color="#fff" />
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>Copilote IA</div>
            <div style={{ color: '#9ca3af', fontSize: 10 }}>
              {context ? 'Devis · Produits · Clients' : 'Soumissions · Produits · Clients'}
            </div>
          </div>
        </div>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 4 }}>
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#6b7280' }}>
            <Bot size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <p style={{ fontSize: 13, margin: 0 }}>
              {context
                ? 'Posez vos questions sur les produits, clients ou soumissions.'
                : 'Créez des soumissions, cherchez des produits ou des clients.'}
            </p>
            <p style={{ fontSize: 11, marginTop: 8, color: '#4b5563' }}>
              {context ? (
                <>Ex : "Quels bardeaux Dynasty sont disponibles ?"<br />"Ajoute une ligne pour 5 rouleaux de membrane"</>
              ) : (
                <>Ex : "Crée une soumission pour Guillaume Mercier, 1452 rue des Pins, Laval. IKO Dynasty, 2 versants."<br />"Cherche les soumissions de cette semaine"</>
              )}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '8px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.5,
              ...(msg.role === 'user'
                ? { background: 'rgba(99,102,241,0.25)', color: '#e0e7ff', borderBottomRightRadius: 4 }
                : { background: 'rgba(255,255,255,0.06)', color: '#d1d5db', borderBottomLeftRadius: 4 }
              ),
            }}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm prose-invert" style={{ fontSize: 13 }}>
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : msg.content}
            </div>

            {/* Soumission created card */}
            {msg.soumission_created && (
              <div style={{
                marginTop: 6, padding: '10px 12px', borderRadius: 8, maxWidth: '85%',
                background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
              }}>
                <div style={{ fontSize: 11, color: '#34d399', fontWeight: 600, marginBottom: 6 }}>
                  ✓ Soumission créée
                </div>
                <div style={{ fontSize: 12, color: '#d1d5db', lineHeight: 1.6 }}>
                  <strong>{msg.soumission_created.client}</strong><br />
                  {msg.soumission_created.address}<br />
                  {msg.soumission_created.coverage && <>{msg.soumission_created.coverage}<br /></>}
                  {msg.soumission_created.product && <>{msg.soumission_created.product}<br /></>}
                  {msg.soumission_created.area && <>Surface : {msg.soumission_created.area}</>}
                </div>
                <a
                  href={`/admin/quote?id=${msg.soumission_created.soumission_id}`}
                  style={{
                    marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    width: '100%', padding: '6px 12px', borderRadius: 6,
                    border: 'none', fontSize: 12, fontWeight: 600,
                    background: 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: '#fff', textDecoration: 'none',
                  }}
                >
                  <ExternalLink size={14} /> Ouvrir la soumission
                </a>
              </div>
            )}

            {/* Quote edit actions */}
            {msg.quote_edits && msg.quote_edits.length > 0 && (
              <div style={{
                marginTop: 6, padding: '8px 10px', borderRadius: 8, maxWidth: '85%',
                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
              }}>
                <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 600, marginBottom: 6 }}>
                  📝 Modifications suggérées :
                </div>
                {msg.quote_edits.map((edit, ei) => (
                  <div key={ei} style={{ fontSize: 11, color: '#d1d5db', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid rgba(99,102,241,0.3)' }}>
                    <span style={{ fontWeight: 600, color: edit.action === 'add' ? '#34d399' : edit.action === 'remove' ? '#f87171' : '#fbbf24' }}>
                      {edit.action === 'add' ? '+ Ajouter' : edit.action === 'remove' ? '− Supprimer' : '✎ Modifier'}
                    </span>
                    {edit.description && ` — ${edit.description}`}
                    {edit.quantity != null && ` (${edit.quantity} ${edit.unit || ''})`}
                    {edit.rate != null && ` @ ${edit.rate}$`}
                    <br />
                    <span style={{ fontSize: 10, color: '#9ca3af' }}>{edit.reason}</span>
                  </div>
                ))}
                <button
                  onClick={() => handleApplyEdits(msg.quote_edits!, i)}
                  disabled={appliedEdits.has(i) || !onApplyEdits}
                  style={{
                    marginTop: 8, width: '100%', padding: '6px 12px', borderRadius: 6,
                    border: 'none', fontSize: 12, fontWeight: 600,
                    cursor: appliedEdits.has(i) || !onApplyEdits ? 'default' : 'pointer',
                    background: appliedEdits.has(i) ? 'rgba(34,197,94,0.2)' : !onApplyEdits ? 'rgba(99,102,241,0.2)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: appliedEdits.has(i) ? '#34d399' : !onApplyEdits ? '#9ca3af' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {appliedEdits.has(i) ? <><Check size={14} /> Appliqué</> : !onApplyEdits ? 'Ouvrez un devis pour appliquer' : <><Sparkles size={14} /> Appliquer les modifications</>}
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 12, padding: 8 }}>
            <Loader2 size={14} className="animate-spin" /> Réflexion en cours…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', gap: 8,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={context ? "Ex: Cherche les bardeaux Dynasty..." : "Ex: Crée une soumission pour..."}
          style={{
            flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: isMobile ? 16 : 13, outline: 'none',
          }}
          autoFocus
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          style={{
            background: !input.trim() || loading ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            border: 'none', borderRadius: 8, padding: '8px 12px',
            color: '#fff', cursor: !input.trim() || loading ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center',
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </motion.div>
  );
};

export default CopilotChat;
