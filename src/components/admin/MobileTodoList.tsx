import React, { useEffect, useState, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SwipeableCard } from './SwipeableCard';
import { Check, Plus, Trash2, ListTodo, User, Users, ChevronDown } from 'lucide-react';

interface Todo {
  id: string;
  content: string;
  is_done: boolean;
  done_at: string | null;
  sort_order: number;
  created_at: string;
  user_id: string;
  assignee_id: string | null;
  created_by: string | null;
}

interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
}

const labelOf = (p?: Profile | null) => {
  if (!p) return 'Inconnu';
  return p.full_name || p.email?.split('@')[0] || 'Utilisateur';
};

const colorFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 55%)`;
};

const initials = (p?: Profile | null) => {
  const n = labelOf(p);
  return n.split(/[ ._-]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';
};

export const MobileTodoList: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [filter, setFilter] = useState<'mine' | 'all'>('mine');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        setAssigneeId(data.user.id);
        load();
        loadProfiles();
      }
    });
  }, []);

  const loadProfiles = async () => {
    const { data } = await supabase.from('profiles' as any).select('id, email, full_name');
    if (data) setProfiles(data as any);
  };

  const load = async () => {
    const { data } = await supabase.from('admin_todos' as any)
      .select('*')
      .order('is_done', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (data) setTodos(data as any);
  };

  const profileMap = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach(p => m.set(p.id, p));
    return m;
  }, [profiles]);

  const addTodo = async () => {
    const content = input.trim();
    if (!content) return;
    // Resolve the user id on the fly if the initial auth fetch hadn't completed.
    let uid = userId;
    if (!uid) {
      const { data: u } = await supabase.auth.getUser();
      uid = u.user?.id || null;
      if (uid) setUserId(uid);
    }
    if (!uid) { toast.error('Session non détectée — reconnecte-toi pour ajouter une tâche.'); return; }
    const target = assigneeId || uid;
    const { data, error } = await supabase.from('admin_todos' as any)
      .insert({ user_id: target, assignee_id: target, created_by: uid, content, sort_order: 0 } as any)
      .select().single();
    if (error) { toast.error('Ajout impossible', { description: error.message }); return; }
    setInput('');
    if (data) setTodos(prev => [data as any, ...prev]);
  };

  const toggleDone = async (t: Todo) => {
    const next = !t.is_done;
    setTodos(prev => prev.map(x => x.id === t.id ? { ...x, is_done: next, done_at: next ? new Date().toISOString() : null } : x)
      .sort((a, b) => Number(a.is_done) - Number(b.is_done)));
    await supabase.from('admin_todos' as any).update({ is_done: next, done_at: next ? new Date().toISOString() : null } as any).eq('id', t.id);
  };

  const deleteTodo = async (id: string) => {
    setTodos(prev => prev.filter(x => x.id !== id));
    await supabase.from('admin_todos' as any).delete().eq('id', id);
  };

  const reassign = async (t: Todo, newAssignee: string) => {
    setTodos(prev => prev.map(x => x.id === t.id ? { ...x, assignee_id: newAssignee, user_id: newAssignee } : x));
    await supabase.from('admin_todos' as any).update({ assignee_id: newAssignee, user_id: newAssignee } as any).eq('id', t.id);
  };

  const visible = todos.filter(t => filter === 'all' ? true : (t.assignee_id === userId || t.user_id === userId));
  const pending = visible.filter(t => !t.is_done);
  const done = visible.filter(t => t.is_done);

  const assigneeProfile = assigneeId ? profileMap.get(assigneeId) : null;

  return (
    <div style={{ padding: '12px 12px calc(80px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#a5b4fc', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 2px' }}>
        <ListTodo size={14} /> Tâches
        <span style={{ marginLeft: 'auto', color: '#6b7280', fontWeight: 600 }}>{pending.length}</span>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'hsl(230,20%,10%)', border: '1px solid hsl(230,20%,16%)', borderRadius: 10, padding: 3 }}>
        {(['mine', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            flex: 1, padding: '10px 8px', minHeight: 40, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: filter === f ? '#6366f1' : 'transparent',
            color: filter === f ? '#fff' : '#9ca3af', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            {f === 'mine' ? <><User size={12} /> Mes tâches</> : <><Users size={12} /> Toute l'équipe</>}
          </button>
        ))}
      </div>

      {/* Add bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'hsl(230,20%,12%)', border: '1px solid hsl(230,20%,18%)', borderRadius: 10, padding: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTodo(); }}
            placeholder="Ajouter une tâche…"
            aria-label="Nouvelle tâche"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e5e7eb', fontSize: 16, padding: '10px 8px', minHeight: 44 }}
          />
          <button onClick={addTodo} disabled={!input.trim()} aria-label="Ajouter la tâche" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 8, border: 'none', background: input.trim() ? '#6366f1' : 'hsl(230,20%,18%)', color: '#fff', cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
            <Plus size={18} />
          </button>
        </div>
        {/* Assignee selector */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setPickerOpen(o => !o)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'hsl(230,20%,9%)', border: '1px solid hsl(230,20%,18%)', borderRadius: 8, padding: '10px 12px', minHeight: 44, color: '#d1d5db', fontSize: 13, cursor: 'pointer' }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: colorFor(assigneeId || ''), color: '#fff', fontSize: 10, fontWeight: 700,
            }}>{initials(assigneeProfile)}</span>
            <span style={{ flex: 1, textAlign: 'left' }}>Assigner à : {labelOf(assigneeProfile)}</span>
            <ChevronDown size={14} />
          </button>
          {pickerOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'hsl(230,22%,10%)', border: '1px solid hsl(230,20%,20%)', borderRadius: 8, padding: 4, zIndex: 50, maxHeight: 240, overflowY: 'auto' }}>
              {profiles.map(p => (
                <button key={p.id} onClick={() => { setAssigneeId(p.id); setPickerOpen(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'transparent', border: 'none', color: '#e5e7eb', fontSize: 13, cursor: 'pointer', borderRadius: 6, textAlign: 'left' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colorFor(p.id), color: '#fff', fontSize: 10, fontWeight: 700 }}>{initials(p)}</span>
                  <span style={{ flex: 1 }}>{labelOf(p)}</span>
                  {assigneeId === p.id && <Check size={14} color="#6366f1" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pending */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pending.map(t => {
          const owner = profileMap.get(t.assignee_id || t.user_id);
          return (
            <SwipeableCard
              key={t.id}
              rightAction={{ icon: Trash2, label: 'Supprimer', color: '#ef4444', textColor: '#fff', onTrigger: () => deleteTodo(t.id) }}
              leftAction={{ icon: Check, label: 'Terminer', color: '#10b981', textColor: '#fff', onTrigger: () => toggleDone(t) }}
            >
              <div style={{ background: 'hsl(230,22%,10%)', border: '1px solid hsl(230,20%,16%)', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, minHeight: 48 }}>
                <button onClick={() => toggleDone(t)} aria-label="Marquer terminé" style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid hsl(230,15%,40%)', background: 'transparent', cursor: 'pointer', flexShrink: 0, padding: 0 }} />
                <span style={{ flex: 1, color: '#e5e7eb', fontSize: 14, lineHeight: 1.3 }}>{t.content}</span>
                <select
                  value={t.assignee_id || t.user_id}
                  onChange={e => reassign(t, e.target.value)}
                  title={`Assigné à ${labelOf(owner)}`}
                  style={{
                    appearance: 'none', WebkitAppearance: 'none', background: colorFor(t.assignee_id || t.user_id),
                    color: '#fff', fontSize: 10, fontWeight: 700, border: 'none', borderRadius: '50%',
                    width: 24, height: 24, textAlign: 'center', cursor: 'pointer', padding: 0,
                    textAlignLast: 'center',
                  }}
                >
                  {profiles.map(p => (
                    <option key={p.id} value={p.id} style={{ background: '#1f2937', color: '#fff' }}>{initials(p)} — {labelOf(p)}</option>
                  ))}
                </select>
              </div>
            </SwipeableCard>
          );
        })}
        {pending.length === 0 && (
          <div style={{ padding: '20px 8px', textAlign: 'center', color: '#4b5563', fontSize: 12 }}>Aucune tâche en cours</div>
        )}
      </div>

      {/* Done */}
      {done.length > 0 && (
        <>
          <div style={{ marginTop: 8, fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, padding: '4px 2px' }}>Terminées ({done.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {done.map(t => {
              const owner = profileMap.get(t.assignee_id || t.user_id);
              return (
                <SwipeableCard
                  key={t.id}
                  rightAction={{ icon: Trash2, label: 'Supprimer', color: '#ef4444', textColor: '#fff', onTrigger: () => deleteTodo(t.id) }}
                  leftAction={{ icon: Check, label: 'Rouvrir', color: '#6366f1', textColor: '#fff', onTrigger: () => toggleDone(t) }}
                >
                  <div style={{ background: 'hsl(230,22%,8%)', border: '1px solid hsl(230,20%,14%)', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, opacity: 0.6 }}>
                    <button onClick={() => toggleDone(t)} aria-label="Rouvrir" style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #10b981', background: '#10b981', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                      <Check size={12} color="#fff" />
                    </button>
                    <span style={{ flex: 1, color: '#9ca3af', fontSize: 14, lineHeight: 1.3, textDecoration: 'line-through' }}>{t.content}</span>
                    <span title={labelOf(owner)} style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colorFor(t.assignee_id || t.user_id), color: '#fff', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{initials(owner)}</span>
                  </div>
                </SwipeableCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default MobileTodoList;
