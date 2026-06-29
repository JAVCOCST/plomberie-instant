import React from 'react';
import { CalendarClock, ThumbsDown, PhoneOff, Ban, PhoneMissed, CalendarCheck } from 'lucide-react';

export type DispositionType =
  | 'interested'
  | 'callback'
  | 'not_interested'
  | 'bad_number'
  | 'dnc'
  | 'no_answer';

const DispoBtn: React.FC<{
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  busy?: boolean;
  danger?: boolean;
  subtle?: boolean;
}> = ({ onClick, label, icon, busy, danger, subtle }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className={`px-3 py-2 rounded-md text-sm border inline-flex items-center gap-1.5 disabled:opacity-50 ${
      danger
        ? 'bg-red-950/40 border-red-900/60 text-red-300 hover:bg-red-900/40'
        : subtle
        ? 'bg-transparent border-[hsl(230,20%,16%)] text-[hsl(230,10%,55%)] hover:bg-[hsl(230,20%,14%)]'
        : 'bg-[hsl(230,22%,8%)] border-[hsl(230,20%,16%)] text-[hsl(230,10%,80%)] hover:bg-[hsl(230,20%,14%)]'
    }`}
  >
    {icon} {label}
  </button>
);

export const DispositionBar: React.FC<{ onDispose: (t: DispositionType) => void; busy?: boolean }> = ({
  onDispose,
  busy,
}) => (
  <div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] p-3">
    <div className="text-[10px] uppercase tracking-wide text-[hsl(230,10%,45%)] mb-2">Disposition</div>
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled
        title="Prise de rendez-vous à l'étape 3"
        className="px-3 py-2 rounded-md text-sm border border-[hsl(230,20%,16%)] text-[hsl(230,10%,40%)] cursor-not-allowed inline-flex items-center gap-1.5"
      >
        <CalendarCheck className="h-4 w-4" /> Intéressé — RDV (étape 3)
      </button>
      <DispoBtn onClick={() => onDispose('callback')} busy={busy} icon={<CalendarClock className="h-4 w-4" />} label="Rappel" />
      <DispoBtn onClick={() => onDispose('not_interested')} busy={busy} icon={<ThumbsDown className="h-4 w-4" />} label="Pas intéressé" />
      <DispoBtn onClick={() => onDispose('bad_number')} busy={busy} icon={<PhoneOff className="h-4 w-4" />} label="Mauvais numéro" />
      <DispoBtn onClick={() => onDispose('dnc')} busy={busy} danger icon={<Ban className="h-4 w-4" />} label="NPC" />
      <DispoBtn onClick={() => onDispose('no_answer')} busy={busy} subtle icon={<PhoneMissed className="h-4 w-4" />} label="Pas de réponse → Suivant" />
    </div>
  </div>
);
