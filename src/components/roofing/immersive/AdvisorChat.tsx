import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import advisorAvatar from '../../../assets/advisor-avatar.png';
import s from './AdvisorChat.module.css';

type Msg = { role: 'user' | 'assistant'; content: string };

interface AdvisorChatProps {
  open: boolean;
  onClose: () => void;
  context: Record<string, any>;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/advisor-chat`;

const AdvisorChat: React.FC<AdvisorChatProps> = ({ open, onClose, context }) => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Msg = { role: 'user', content: input.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput('');
    setLoading(true);

    let assistantSoFar = '';

    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: allMessages, context }),
      });

      if (!resp.ok || !resp.body) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Désolée, une erreur est survenue. Réessayez.' }]);
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
                }
                return [...prev, { role: 'assistant', content: assistantSoFar }];
              });
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Désolée, une erreur est survenue.' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className={s.overlay}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className={s.panel}
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.95 }}
          transition={{ duration: 0.3 }}
          onClick={e => e.stopPropagation()}
        >
          <div className={s.header}>
            <div className={s.headerLeft}>
              <img src={advisorAvatar} alt="Marie-Ève" className={s.headerAvatar} />
              <div>
                <div className={s.headerName}>Marie-Ève</div>
                <div className={s.headerStatus}>En ligne</div>
              </div>
            </div>
            <button className={s.closeBtn} onClick={onClose} aria-label="Fermer le clavardage">✕</button>
          </div>

          <div className={s.messages}>
            {messages.length === 0 && (
              <div className={s.emptyState}>
                <img src={advisorAvatar} alt="Marie-Ève" className={s.emptyAvatar} />
                <p className={s.emptyText}>Bonjour ! Posez-moi vos questions sur votre soumission toiture. 🏠</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`${s.msgRow} ${msg.role === 'user' ? s.msgUser : s.msgAssistant}`}>
                {msg.role === 'assistant' && (
                  <img src={advisorAvatar} alt="Marie-Ève" className={s.msgAvatar} />
                )}
                <div className={`${s.msgBubble} ${msg.role === 'user' ? s.msgBubbleUser : s.msgBubbleAssistant}`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className={`${s.msgRow} ${s.msgAssistant}`}>
                <img src={advisorAvatar} alt="Marie-Ève" className={s.msgAvatar} />
                <div className={`${s.msgBubble} ${s.msgBubbleAssistant}`}>
                  <span className={s.typing}>
                    <span>.</span><span>.</span><span>.</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className={s.inputBar}>
            <input
              className={s.chatInput}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              placeholder="Posez votre question…"
              autoFocus
            />
            <button className={s.sendBtn} onClick={send} disabled={!input.trim() || loading}>
              ➤
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AdvisorChat;
