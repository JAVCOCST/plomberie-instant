import React, { useEffect, useState } from 'react';
import { Check, CloudOff, Loader2, AlertTriangle, Cloud } from 'lucide-react';
import type { AutosaveStatus } from '@/hooks/useQuoteAutosave';

interface Props {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  online: boolean;
  pendingCount: number;
  compact?: boolean;
}

function formatRelative(ts: number | null): string {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "à l'instant";
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `il y a ${hr} h`;
  return `il y a ${Math.floor(hr / 24)} j`;
}

/**
 * Tiny status pill rendered at the top of the AdminQuoteGenerator when
 * `VITE_QUOTE_MOBILE_V2` is ON. Reflects the autosave state with a
 * non-intrusive icon + label. Updates the "il y a N s" every 15 s so the
 * timestamp stays fresh without re-rendering the parent.
 */
const SaveStatusIndicator: React.FC<Props> = ({
  status, lastSavedAt, online, pendingCount, compact,
}) => {
  const [, force] = useState(0);
  useEffect(() => {
    if (!lastSavedAt) return;
    const t = setInterval(() => force(n => n + 1), 15_000);
    return () => clearInterval(t);
  }, [lastSavedAt]);

  let icon: React.ReactNode;
  let label: string;
  let color: string;
  let bg: string;
  let border: string;

  if (!online) {
    icon = <CloudOff size={compact ? 12 : 14} />;
    label = pendingCount > 0
      ? `Hors ligne — ${pendingCount} en attente`
      : 'Hors ligne — sera synchronisé';
    color = '#fbbf24';
    bg = 'rgba(245, 158, 11, 0.10)';
    border = 'rgba(245, 158, 11, 0.30)';
  } else if (status === 'saving' || status === 'pending') {
    icon = <Loader2 size={compact ? 12 : 14} style={{ animation: 'spin 1s linear infinite' }} />;
    label = status === 'pending' ? 'Modifications non sauvegardées…' : 'Sauvegarde…';
    color = '#a5b4fc';
    bg = 'rgba(99, 102, 241, 0.10)';
    border = 'rgba(99, 102, 241, 0.30)';
  } else if (status === 'error') {
    icon = <AlertTriangle size={compact ? 12 : 14} />;
    label = pendingCount > 0
      ? `Échec de sauvegarde — ${pendingCount} en attente`
      : 'Échec de la sauvegarde';
    color = '#f87171';
    bg = 'rgba(248, 113, 113, 0.10)';
    border = 'rgba(248, 113, 113, 0.30)';
  } else if (status === 'offline') {
    icon = <CloudOff size={compact ? 12 : 14} />;
    label = pendingCount > 0
      ? `En attente — ${pendingCount} brouillon${pendingCount > 1 ? 's' : ''}`
      : 'En attente de synchronisation';
    color = '#fbbf24';
    bg = 'rgba(245, 158, 11, 0.10)';
    border = 'rgba(245, 158, 11, 0.30)';
  } else if (status === 'saved' && lastSavedAt) {
    icon = <Check size={compact ? 12 : 14} />;
    label = `Sauvegardé ${formatRelative(lastSavedAt)}`;
    color = '#34d399';
    bg = 'rgba(34, 197, 94, 0.10)';
    border = 'rgba(34, 197, 94, 0.30)';
  } else {
    icon = <Cloud size={compact ? 12 : 14} />;
    label = 'En attente';
    color = '#9ca3af';
    bg = 'rgba(148, 163, 184, 0.10)';
    border = 'rgba(148, 163, 184, 0.20)';
  }

  return (
    <span
      role="status"
      aria-live="polite"
      data-quote-save-status={status}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: compact ? '3px 8px' : '4px 10px',
        borderRadius: 999,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        background: bg,
        border: `1px solid ${border}`,
        color,
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
      }}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
};

export default SaveStatusIndicator;
