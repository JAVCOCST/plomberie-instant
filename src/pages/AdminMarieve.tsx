import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { MessageSquare, BookOpen, Plus, Trash2, Check, X, Sparkles } from 'lucide-react';

type Kind = 'fact' | 'allow' | 'forbid' | 'qa';
type Scope = 'all' | 'advisor' | 'repair';

interface Directive {
  id: string;
  kind: Kind;
  title: string | null;
  content: string;
  scope: Scope;
  enabled: boolean;
  priority: number;
}

interface Exchange {
  id: string;
  source: 'advisor' | 'repair';
  user_message: string | null;
  assistant_message: string | null;
  context: any;
  reviewed: boolean;
  created_at: string;
}

const KIND_META: Record<Kind, { label: string; color: string; hint: string }> = {
  fact: { label: 'Info', color: '#4499ff', hint: 'Une information que Marie-Ève peut donner' },
  allow: { label: 'Peut dire', color: '#44ddaa', hint: 'Un comportement autorisé' },
  forbid: { label: 'Interdit', color: '#ff5566', hint: 'Quelque chose qu’elle ne doit JAMAIS faire/dire' },
  qa: { label: 'Réponse validée', color: '#ffcc44', hint: 'Une question type + la réponse exacte à donner' },
};
const SCOPE_LABEL: Record<Scope, string> = { all: 'Les deux chats', advisor: 'Conseiller (soumission)', repair: 'Réparation' };

const db = supabase as any;
const blank = (): Omit<Directive, 'id'> => ({ kind: 'fact', title: '', content: '', scope: 'all', enabled: true, priority: 0 });

export default function AdminMarieve() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'directives' | 'conversations'>('directives');
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(Omit<Directive, 'id'> & { id?: string }) | null>(null);
  const [convoView, setConvoView] = useState<'recent' | 'frequent'>('frequent');

  const loadDirectives = useCallback(async () => {
    const { data, error } = await db.from('marieve_knowledge')
      .select('id,kind,title,content,scope,enabled,priority')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) { toast.error('Chargement directives: ' + error.message); return; }
    setDirectives(data || []);
  }, []);

  const loadExchanges = useCallback(async () => {
    const { data, error } = await db.from('marieve_exchanges')
      .select('id,source,user_message,assistant_message,context,reviewed,created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) { toast.error('Chargement conversations: ' + error.message); return; }
    setExchanges(data || []);
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await Promise.all([loadDirectives(), loadExchanges()]); setLoading(false); })();
  }, [loadDirectives, loadExchanges]);

  const saveDirective = useCallback(async () => {
    if (!editing) return;
    if (!editing.content.trim()) { toast.error('Le contenu est requis'); return; }
    if (editing.kind === 'qa' && !editing.title?.trim()) { toast.error('Pour une réponse validée, indique la question type'); return; }
    const payload = {
      kind: editing.kind,
      title: editing.title?.trim() || null,
      content: editing.content.trim(),
      scope: editing.scope,
      enabled: editing.enabled,
      priority: editing.priority || 0,
    };
    const res = editing.id
      ? await db.from('marieve_knowledge').update(payload).eq('id', editing.id)
      : await db.from('marieve_knowledge').insert(payload);
    if (res.error) { toast.error('Sauvegarde: ' + res.error.message); return; }
    toast.success(editing.id ? 'Directive mise à jour' : 'Directive ajoutée');
    setEditing(null);
    loadDirectives();
  }, [editing, loadDirectives]);

  const toggleEnabled = useCallback(async (d: Directive) => {
    setDirectives(prev => prev.map(x => x.id === d.id ? { ...x, enabled: !x.enabled } : x));
    const { error } = await db.from('marieve_knowledge').update({ enabled: !d.enabled }).eq('id', d.id);
    if (error) { toast.error('Maj: ' + error.message); loadDirectives(); }
  }, [loadDirectives]);

  const deleteDirective = useCallback(async (id: string) => {
    if (!confirm('Supprimer cette directive ?')) return;
    setDirectives(prev => prev.filter(x => x.id !== id));
    const { error } = await db.from('marieve_knowledge').delete().eq('id', id);
    if (error) { toast.error('Suppression: ' + error.message); loadDirectives(); }
    else toast.success('Directive supprimée');
  }, [loadDirectives]);

  const promoteToQA = useCallback((ex: Exchange) => {
    setEditing({
      kind: 'qa',
      title: ex.user_message || '',
      content: ex.assistant_message || '',
      scope: ex.source,
      enabled: true,
      priority: 0,
    });
    setTab('directives');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const markReviewed = useCallback(async (ex: Exchange) => {
    setExchanges(prev => prev.map(x => x.id === ex.id ? { ...x, reviewed: !x.reviewed } : x));
    await db.from('marieve_exchanges').update({ reviewed: !ex.reviewed }).eq('id', ex.id);
  }, []);

  // Group recent exchanges by normalized user question for the "frequent" view.
  const frequent = useMemo(() => {
    const m = new Map<string, { q: string; count: number; samples: Exchange[] }>();
    for (const ex of exchanges) {
      const q = (ex.user_message || '').trim();
      if (!q) continue;
      const key = q.toLowerCase();
      const cur = m.get(key) || { q, count: 0, samples: [] };
      cur.count++;
      if (cur.samples.length < 3) cur.samples.push(ex);
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [exchanges]);

  const wrap: React.CSSProperties = { padding: isMobile ? 12 : 20, color: '#e5e7eb', maxWidth: 1100, margin: '0 auto' };
  const card: React.CSSProperties = { background: 'hsl(230,22%,11%)', border: '1px solid hsl(230,20%,16%)', borderRadius: 10, padding: 14 };
  const input: React.CSSProperties = { width: '100%', background: 'hsl(230,22%,8%)', border: '1px solid hsl(230,20%,20%)', borderRadius: 6, color: '#e5e7eb', padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' };
  const tabBtn = (active: boolean): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid ' + (active ? 'hsl(250,80%,60%)' : 'hsl(230,20%,18%)'), background: active ? 'hsl(250,60%,20%)' : 'transparent', color: active ? '#c4b5fd' : '#8a93a8', fontSize: 14, fontWeight: active ? 600 : 400 });

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Sparkles size={22} color="#c4b5fd" />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Marie-Ève</h1>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Directives et suivi des conversations clients</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={tabBtn(tab === 'directives')} onClick={() => setTab('directives')}><BookOpen size={15} /> Directives</button>
        <button style={tabBtn(tab === 'conversations')} onClick={() => setTab('conversations')}><MessageSquare size={15} /> Conversations</button>
      </div>

      {loading && <div style={{ color: '#6b7280', fontSize: 14 }}>Chargement…</div>}

      {!loading && tab === 'directives' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: '#8a93a8', lineHeight: 1.5 }}>
            Tout ce que tu ajoutes ici est injecté dans les consignes de Marie-Ève à chaque conversation.
            Modifie une directive → elle change de comportement immédiatement, sans toucher au code.
          </div>

          {editing ? (
            <div style={card}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={{ fontSize: 11, color: '#6b7280' }}>Type</label>
                  <select style={input} value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value as Kind })}>
                    {(Object.keys(KIND_META) as Kind[]).map(k => <option key={k} value={k}>{KIND_META[k].label}</option>)}
                  </select>
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={{ fontSize: 11, color: '#6b7280' }}>S’applique à</label>
                  <select style={input} value={editing.scope} onChange={e => setEditing({ ...editing, scope: e.target.value as Scope })}>
                    {(Object.keys(SCOPE_LABEL) as Scope[]).map(s => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                  </select>
                </div>
                <div style={{ flex: '0 0 90px' }}>
                  <label style={{ fontSize: 11, color: '#6b7280' }}>Priorité</label>
                  <input type="number" style={input} value={editing.priority} onChange={e => setEditing({ ...editing, priority: +e.target.value })} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>{KIND_META[editing.kind].hint}</div>
              {editing.kind === 'qa' && (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: '#6b7280' }}>Question type du client</label>
                  <input style={input} value={editing.title || ''} placeholder="Ex: Est-ce que vous faites du financement ?" onChange={e => setEditing({ ...editing, title: e.target.value })} />
                </div>
              )}
              <label style={{ fontSize: 11, color: '#6b7280' }}>{editing.kind === 'qa' ? 'Réponse à donner' : 'Directive'}</label>
              <textarea style={{ ...input, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }} value={editing.content} placeholder={editing.kind === 'forbid' ? 'Ex: Ne jamais donner de prix au pied carré' : 'Texte de la directive…'} onChange={e => setEditing({ ...editing, content: e.target.value })} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={saveDirective} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: 'hsl(250,70%,55%)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}><Check size={15} /> Enregistrer</button>
                <button onClick={() => setEditing(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid hsl(230,20%,20%)', background: 'transparent', color: '#9aa3b8', cursor: 'pointer' }}><X size={15} /> Annuler</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditing(blank())} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px dashed hsl(250,40%,40%)', background: 'transparent', color: '#c4b5fd', cursor: 'pointer', fontWeight: 600 }}><Plus size={16} /> Ajouter une directive</button>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {directives.length === 0 && <div style={{ color: '#6b7280', fontSize: 14 }}>Aucune directive pour l’instant.</div>}
            {directives.map(d => {
              const meta = KIND_META[d.kind];
              return (
                <div key={d.id} style={{ ...card, opacity: d.enabled ? 1 : 0.5, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, border: '1px solid ' + meta.color + '55', borderRadius: 5, padding: '1px 7px' }}>{meta.label}</span>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{SCOPE_LABEL[d.scope]}</span>
                      {d.priority !== 0 && <span style={{ fontSize: 11, color: '#6b7280' }}>prio {d.priority}</span>}
                    </div>
                    {d.kind === 'qa' && d.title && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Q: {d.title}</div>}
                    <div style={{ fontSize: 14, color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{d.kind === 'qa' ? 'R: ' : ''}{d.content}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button title={d.enabled ? 'Désactiver' : 'Activer'} onClick={() => toggleEnabled(d)} style={{ padding: 6, borderRadius: 6, border: '1px solid hsl(230,20%,20%)', background: 'transparent', color: d.enabled ? '#44ddaa' : '#6b7280', cursor: 'pointer' }}><Check size={15} /></button>
                    <button title="Modifier" onClick={() => setEditing({ ...d })} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid hsl(230,20%,20%)', background: 'transparent', color: '#9aa3b8', cursor: 'pointer', fontSize: 13 }}>Éditer</button>
                    <button title="Supprimer" onClick={() => deleteDirective(d.id)} style={{ padding: 6, borderRadius: 6, border: '1px solid hsl(0,40%,30%)', background: 'transparent', color: '#ff6b81', cursor: 'pointer' }}><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && tab === 'conversations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={tabBtn(convoView === 'frequent')} onClick={() => setConvoView('frequent')}>Questions fréquentes</button>
            <button style={tabBtn(convoView === 'recent')} onClick={() => setConvoView('recent')}>Récentes</button>
          </div>

          {exchanges.length === 0 && <div style={{ color: '#6b7280', fontSize: 14 }}>Aucune conversation enregistrée pour l’instant. Les échanges apparaîtront ici dès que des clients discuteront avec Marie-Ève.</div>}

          {convoView === 'frequent' && frequent.map((g, i) => (
            <div key={i} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>{g.q}</div>
                  <div style={{ fontSize: 12, color: '#8a93a8', marginTop: 6, whiteSpace: 'pre-wrap' }}>Réponse de Marie-Ève: {g.samples[0]?.assistant_message || '—'}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, color: '#ffcc44', fontWeight: 700 }}>{g.count}×</span>
                  <button onClick={() => promoteToQA(g.samples[0])} style={{ fontSize: 12, padding: '5px 9px', borderRadius: 6, border: '1px solid hsl(45,60%,40%)', background: 'transparent', color: '#ffcc44', cursor: 'pointer', whiteSpace: 'nowrap' }}>Définir la réponse</button>
                </div>
              </div>
            </div>
          ))}

          {convoView === 'recent' && exchanges.map(ex => (
            <div key={ex.id} style={{ ...card, opacity: ex.reviewed ? 0.55 : 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: ex.source === 'repair' ? '#ff9944' : '#4499ff', border: '1px solid currentColor', borderRadius: 5, padding: '1px 6px' }}>{ex.source === 'repair' ? 'Réparation' : 'Conseiller'}</span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{new Date(ex.created_at).toLocaleString('fr-CA')}</span>
              </div>
              <div style={{ fontSize: 14, color: '#e5e7eb' }}><strong style={{ color: '#9aa3b8' }}>Client:</strong> {ex.user_message || '—'}</div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4, whiteSpace: 'pre-wrap' }}><strong style={{ color: '#c4b5fd' }}>Marie-Ève:</strong> {ex.assistant_message || '—'}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => promoteToQA(ex)} style={{ fontSize: 12, padding: '5px 9px', borderRadius: 6, border: '1px solid hsl(45,60%,40%)', background: 'transparent', color: '#ffcc44', cursor: 'pointer' }}>Créer une réponse validée</button>
                <button onClick={() => markReviewed(ex)} style={{ fontSize: 12, padding: '5px 9px', borderRadius: 6, border: '1px solid hsl(230,20%,20%)', background: 'transparent', color: '#9aa3b8', cursor: 'pointer' }}>{ex.reviewed ? 'Rouvrir' : 'Marquer traité'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
