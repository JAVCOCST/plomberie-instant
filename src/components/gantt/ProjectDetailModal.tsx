/**
 * ProjectDetailModal — Modal terrain (Suivi Projets / Calendrier).
 *
 * Sert d'enveloppe (overlay + en-tête date/durée + bouton X) autour de
 * <LeadDetailBody>, qui contient TOUTES les informations de la soumission —
 * exactement comme dans le Tableau de bord admin.
 *
 * La résolution `task → soumission_id` se fait via le QBO customer
 * (estimator = qb_id), pour rester compatible avec les anciennes tâches
 * créées avant que `schedule_tasks.soumission_id` n'existe.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { X, Calendar } from 'lucide-react';
import type { GanttTask } from './types';
import LeadDetailBody from '@/components/lead-detail/LeadDetailBody';

const db = supabase as any;

const formatDate = (s?: string | null) => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('fr-CA', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s; }
};

interface Props {
  task: GanttTask;
  assignedNames: string[];
  onClose: () => void;
}

export const ProjectDetailModal: React.FC<Props> = ({ task, assignedNames, onClose }) => {
  const [resolving, setResolving] = useState(true);
  const [soumissionId, setSoumissionId] = useState<string | null>(null);

  const qbId = (task as any).estimator as string | null;
  const directSoumissionId = (task as any).soumission_id as string | null | undefined;

  // Lock body scroll while modal is open (prevents the page underneath from
  // scrolling and "stealing" the touch when the user swipes up inside the body).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // Résout `soumission_id` : direct depuis la tâche si dispo, sinon via QBO.
  useEffect(() => {
    let cancel = false;
    const resolve = async () => {
      setResolving(true);
      if (directSoumissionId) {
        if (!cancel) { setSoumissionId(directSoumissionId); setResolving(false); }
        return;
      }
      if (!qbId) { if (!cancel) { setSoumissionId(null); setResolving(false); } return; }
      const { data: cust } = await db.from('qb_customers').select('email,display_name').eq('qb_id', qbId).maybeSingle();
      let soumId: string | null = null;
      if (cust) {
        const email = (cust.email || '').toLowerCase().trim();
        const dn = (cust.display_name || '').trim();
        if (email) {
          const { data } = await db.from('soumissions').select('id').ilike('email', email).order('created_at', { ascending: false }).limit(1);
          if (data && data[0]) soumId = data[0].id;
        }
        if (!soumId && dn) {
          const parts = dn.split(/\s+/);
          if (parts.length >= 2) {
            const { data } = await db.from('soumissions').select('id')
              .ilike('first_name', parts[0]).ilike('last_name', parts.slice(1).join(' '))
              .order('created_at', { ascending: false }).limit(1);
            if (data && data[0]) soumId = data[0].id;
          }
        }
      }
      if (!cancel) { setSoumissionId(soumId); setResolving(false); }
    };
    resolve();
    return () => { cancel = true; };
  }, [qbId, directSoumissionId]);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9000,
        backdropFilter: 'blur(4px)',
      }} />
      <div style={{
        position: 'fixed',
        top: isMobile ? 0 : '50%',
        left: isMobile ? 0 : '50%',
        transform: isMobile ? 'none' : 'translate(-50%,-50%)',
        width: isMobile ? '100vw' : 'min(720px, 95vw)',
        height: isMobile ? '100dvh' : 'auto',
        maxHeight: isMobile ? '100dvh' : '90vh',
        overflow: 'hidden',
        background: 'hsl(230,22%,9%)', borderRadius: 14, zIndex: 9001,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: isMobile
            ? 'calc(env(safe-area-inset-top) + 14px) 18px 14px'
            : '14px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(99,102,241,0.05))',
        }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.2,
              wordBreak: 'break-word' }}>
              {task.title}
            </h2>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={11} /> {formatDate(task.start_date)} → {formatDate(task.end_date)}
              <span style={{ opacity: 0.5 }}>•</span>
              <span>{task.duration_days} j</span>
              {task.progress > 0 && <><span style={{ opacity: 0.5 }}>•</span><span>{task.progress}%</span></>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 999,
            color: '#fff', cursor: 'pointer', flexShrink: 0,
            width: isMobile ? 44 : 32, height: isMobile ? 44 : 32,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'manipulation',
          }}><X size={isMobile ? 20 : 16} /></button>
        </div>

        {/* Body */}
        <div style={{
          overflowY: 'auto', padding: 18, flex: '1 1 auto', minHeight: 0,
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
          paddingBottom: isMobile ? 'calc(80px + env(safe-area-inset-bottom))' : 18,
        }}>
          {resolving ? (
            <div style={{ padding: 40, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>Chargement…</div>
          ) : !soumissionId ? (
            <div style={{ padding: 30, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
              Aucune soumission liée à ce projet QuickBooks ({task.title}).
            </div>
          ) : (
            <LeadDetailBody
              leadId={soumissionId}
              mode="field"
              assignedNames={assignedNames}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectDetailModal;