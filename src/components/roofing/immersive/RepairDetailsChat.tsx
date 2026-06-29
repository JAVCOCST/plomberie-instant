import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Send, X, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useFormContext } from '../../../context/FormContext';
import { RepairMessage } from '../../../types/roofing';
import advisorAvatar from '../../../assets/advisor-avatar.png';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://eeradaaxmqzyvxvmahlf.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

interface AiAnalysis {
  roofType: string;
  slopeCategory: string;
  confidence: number;
  buildingType?: string;
}

interface QuickQuestion {
  q: string;
  opts: string[];
}

interface RepairDetailsChatProps {
  firstName: string;
  address: string;
  aiAnalysis: AiAnalysis;
  onReady: () => void;
  onBack: () => void;
  mode?: 'repair' | 'inspection' | 'construction';
  onSmsGlow?: () => void;
}

const triggerHaptic = () => {
  try { if (navigator.vibrate) navigator.vibrate([6, 20, 6]); } catch {}
};

/** Parse $$CHOICES$$[...] from AI response text */
function parseChoices(text: string): { cleanText: string; questions: QuickQuestion[] } {
  const marker = '$$CHOICES$$';
  const idx = text.indexOf(marker);
  if (idx === -1) return { cleanText: text, questions: [] };

  const cleanText = text.slice(0, idx).trim();
  const after = text.slice(idx + marker.length);

  // Extract the first balanced [...] array, tolerating whitespace, code
  // fences, or trailing prose around it. Different models format the block
  // slightly differently (Claude may add a newline or note that a naive
  // JSON.parse of the whole tail would choke on), so we bracket-match and
  // skip anything inside string literals.
  const start = after.indexOf('[');
  if (start === -1) return { cleanText, questions: [] };

  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < after.length; i++) {
    const ch = after[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { cleanText, questions: [] };

  try {
    const questions = JSON.parse(after.slice(start, end + 1)) as QuickQuestion[];
    return { cleanText, questions };
  } catch {
    return { cleanText, questions: [] };
  }
}

function buildInitialMessage(firstName: string, address: string, ai: AiAnalysis, mode?: string): RepairMessage {
  const name = firstName || 'là';

  if (mode === 'construction') {
    return {
      role: 'assistant',
      content: `Bonjour ${name} ! Je suis Marie-Ève de Toitures VB. Vous avez un projet de nouvelle construction — parlez-moi de votre projet et je vais qualifier votre demande ! 🏗️`,
    };
  }

  const roofLabels: Record<string, string> = {
    '2pans': 'à 2 pans', '4pans': 'à 4 pans', '4pans_plus': 'complexe',
  };
  const slopeLabels: Record<string, string> = {
    aucune: 'plate', legere: 'à faible pente', moderee: 'à pente moyenne', abrupte: 'à forte pente',
  };
  const buildingLabels: Record<string, string> = {
    unifamiliale: 'unifamiliale', duplex: 'duplex', triplex: 'triplex',
    multiplex: 'multiplex', commercial: 'commercial', condo: 'condo',
  };
  const roofDesc = roofLabels[ai.roofType] || '';
  const slopeDesc = slopeLabels[ai.slopeCategory] || '';
  const buildingDesc = buildingLabels[ai.buildingType || ''] || '';

  let intro = `Bonjour ${name} !`;
  if (address) intro += ` Je vois votre ${buildingDesc || 'propriété'} au ${address}`;
  if (roofDesc || slopeDesc) {
    intro += ` — toiture ${[roofDesc, slopeDesc].filter(Boolean).join(', ')}`;
  }
  intro += `. Décrivez-moi le problème et je vais qualifier votre demande ! 📸`;

  return { role: 'assistant', content: intro };
}

async function streamRepairChat({
  messages, context, onDelta, onDone, onError,
}: {
  messages: { role: string; content: string }[];
  context: { firstName: string; address: string };
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
}) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/repair-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ messages, context }),
    });

    if (!resp.ok || !resp.body) {
      if (resp.status === 429) { onError('Trop de demandes, réessayez dans un moment.'); return; }
      if (resp.status === 402) { onError('Service temporairement indisponible.'); return; }
      onError('Erreur de connexion au service IA'); return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.startsWith(':') || line.trim() === '') continue;
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') { onDone(); return; }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        } catch {
          buffer = line + '\n' + buffer;
          break;
        }
      }
    }

    if (buffer.trim()) {
      for (let raw of buffer.split('\n')) {
        if (!raw || !raw.startsWith('data: ')) continue;
        const jsonStr = raw.replace(/\r$/, '').slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        } catch { /* ignore */ }
      }
    }
    onDone();
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Erreur inconnue');
  }
}

const RepairDetailsChat: React.FC<RepairDetailsChatProps> = ({ firstName, address, aiAnalysis, onReady, onBack, mode, onSmsGlow }) => {
  const { data, updateData } = useFormContext();
  const repairMsgs = data.repairMessages || [];
  const initialMsg = buildInitialMessage(firstName, address, aiAnalysis, mode);
  const [messages, setMessages] = useState<RepairMessage[]>(
    repairMsgs.length > 0 ? repairMsgs : [initialMsg]
  );
  const [smsGlowTriggered, setSmsGlowTriggered] = useState(false);
  const [input, setInput] = useState('');
  const [photos, setPhotos] = useState<string[]>(data.repairPhotos || []);
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [quickQuestions, setQuickQuestions] = useState<QuickQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userMsgCount = messages.filter(m => m.role === 'user').length;
  const canContinue = userMsgCount >= 2;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming, pendingPhotos, quickQuestions]);

  useEffect(() => {
    updateData({ repairMessages: messages, repairPhotos: photos });
  }, [messages, photos]); // eslint-disable-line

  // When streaming completes, parse choices from last assistant message
  useEffect(() => {
    if (streaming) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== 'assistant') return;
    const { cleanText, questions } = parseChoices(lastMsg.content);

    // Detect $$SMS_GLOW$$ marker from AI
    if (cleanText.includes('$$SMS_GLOW$$') && !smsGlowTriggered) {
      setSmsGlowTriggered(true);
      onSmsGlow?.();
      const cleaned = cleanText.replace('$$SMS_GLOW$$', '').trim();
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: cleaned } : m
      ));
    }

    if (questions.length > 0) {
      // Update the message to remove the $$CHOICES$$ block
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, content: cleanText.replace('$$SMS_GLOW$$', '').trim() } : m
      ));
      setQuickQuestions(questions);
      setAnswers({});
    }
  }, [streaming]); // eslint-disable-line

  const handlePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        setPendingPhotos(prev => [...prev, reader.result as string]);
        triggerHaptic();
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removePendingPhoto = useCallback((index: number) => {
    setPendingPhotos(prev => prev.filter((_, i) => i !== index));
  }, []);

  const selectAnswer = useCallback((question: string, answer: string) => {
    triggerHaptic();
    setAnswers(prev => ({ ...prev, [question]: answer }));
  }, []);

  const sendQuickAnswers = useCallback(() => {
    if (Object.keys(answers).length === 0) return;
    const text = Object.entries(answers).map(([q, a]) => `${q} ${a}`).join('\n');
    setInput('');
    setQuickQuestions([]);
    setAnswers({});
    // Trigger send with this text
    sendMessage(text);
  }, [answers]); // eslint-disable-line

  const sendMessage = useCallback((overrideText?: string) => {
    const text = overrideText || input.trim();
    if ((!text && pendingPhotos.length === 0) || streaming) return;

    const userMsg: RepairMessage = {
      role: 'user',
      content: text || `📸 ${pendingPhotos.length} photo(s)`,
      photos: pendingPhotos.length > 0 ? [...pendingPhotos] : undefined,
    };

    if (pendingPhotos.length > 0) setPhotos(prev => [...prev, ...pendingPhotos]);

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setPendingPhotos([]);
    setQuickQuestions([]);
    triggerHaptic();
    setStreaming(true);

    const aiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
    let assistantText = '';

    streamRepairChat({
      messages: aiMessages,
      context: { firstName: firstName || 'Client', address: data.address?.formatted_address || 'Adresse connue' },
      onDelta: (chunk) => {
        assistantText += chunk;
        const currentText = assistantText;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && prev.length > newMessages.length) {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: currentText } : m);
          }
          return [...prev, { role: 'assistant', content: currentText }];
        });
      },
      onDone: () => { setStreaming(false); triggerHaptic(); },
      onError: (err) => {
        console.error('Repair chat error:', err);
        setMessages(prev => [...prev, { role: 'assistant', content: 'Désolée, petit souci technique. Réessayez ! 🙏' }]);
        setStreaming(false);
      },
    });
  }, [input, pendingPhotos, streaming, messages, firstName, data.address]);

  const send = useCallback(() => sendMessage(), [sendMessage]);

  return (
    <motion.div
      className="repair-chat-container"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Back link */}
      <button
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', color: 'hsla(260, 80%, 75%, 1)',
          fontSize: 13, cursor: 'pointer', padding: '4px 0 8px',
          fontFamily: 'var(--imm-font)',
        }}
      >
        <ArrowLeft size={14} />
        Changer le type de travaux
      </button>

      {/* Messages */}
      <div className="repair-chat-messages">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              className={`repair-msg-row ${msg.role === 'user' ? 'user' : 'assistant'}`}
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.25, delay: i === messages.length - 1 ? 0.05 : 0 }}
            >
              {msg.role === 'assistant' && (
                <img src={advisorAvatar} alt="Marie-Ève" className="repair-msg-avatar" />
              )}
              <div className={`repair-msg-bubble ${msg.role}`}>
                <span>{msg.content}</span>
                {msg.photos && msg.photos.length > 0 && (
                  <div className="repair-msg-photos">
                    {msg.photos.map((p, pi) => (
                      <img key={pi} src={p} alt={`Photo ${pi + 1}`} className="repair-msg-photo" />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {streaming && messages[messages.length - 1]?.role === 'user' && (
          <motion.div className="repair-msg-row assistant" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <img src={advisorAvatar} alt="Marie-Ève" className="repair-msg-avatar" />
            <div className="repair-msg-bubble assistant">
              <span className="repair-typing"><span>.</span><span>.</span><span>.</span></span>
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick reply chips */}
      {quickQuestions.length > 0 && !streaming && (
        <motion.div
          className="repair-quick-section"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          {quickQuestions.map((qq, qi) => (
            <div key={qi} className="repair-quick-group">
              <span className="repair-quick-label">{qq.q}</span>
              <div className="repair-quick-chips">
                {qq.opts.map((opt, oi) => (
                  <button
                    key={oi}
                    className={`repair-chip ${answers[qq.q] === opt ? 'selected' : ''}`}
                    onClick={() => selectAnswer(qq.q, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            className="repair-chip-send"
            onClick={sendQuickAnswers}
            disabled={Object.keys(answers).length === 0}
          >
            <Send size={14} />
            Envoyer {Object.keys(answers).length > 0 ? `(${Object.keys(answers).length})` : ''}
          </button>
        </motion.div>
      )}

      {/* Pending photos preview */}
      {pendingPhotos.length > 0 && (
        <div className="repair-pending-photos">
          {pendingPhotos.map((p, i) => (
            <div key={i} className="repair-pending-photo-wrap">
              <img src={p} alt={`Photo ${i + 1}`} className="repair-pending-photo" />
              <button className="repair-pending-remove" onClick={() => removePendingPhoto(i)}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Input bar — always visible so user can type a custom answer or upload photos even when quick-reply chips are shown */}
      <div className="repair-input-bar">
        <button className="repair-photo-btn" onClick={() => fileInputRef.current?.click()} aria-label="Ajouter une photo">
          <Camera size={20} />
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple capture="environment" onChange={handlePhotoUpload} style={{ display: 'none' }} />
        <input
          className="repair-text-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ou tapez votre réponse…"
          disabled={streaming}
        />
        <button className="repair-send-btn" onClick={send} disabled={(!input.trim() && pendingPhotos.length === 0) || streaming} aria-label="Envoyer">
          <Send size={18} />
        </button>
      </div>

      {/* Continue button */}
      {canContinue && !streaming && (
        <motion.button
          onClick={onReady}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          style={{
            marginTop: 12, width: '100%', padding: '14px 24px', borderRadius: 14,
            border: 'none', background: 'linear-gradient(135deg, hsl(260, 70%, 62%), hsl(185, 70%, 50%))',
            color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'var(--imm-font)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <CheckCircle2 size={18} />
          Continuer
        </motion.button>
      )}
    </motion.div>
  );
};

export default RepairDetailsChat;
