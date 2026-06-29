/**
 * project-statuses — Source unique de vérité pour les statuts de projet.
 * Consommée par le Dashboard (Kanban + Tableau), le Gantt, le Calendrier
 * et toute future automatisation. Toute modification doit se faire ICI.
 *
 * Taxonomie v2 (hybride) — 12 statuts répartis en 7 phases métier.
 */

export type ProjectStatus =
  | 'new'
  | 'waiting_contact'
  | 'visit_booked'
  | 'estimating'
  | 'quote_sent'
  | 'revision'
  | 'accepted'
  | 'scheduled'
  | 'in_progress'
  | 'done'
  | 'invoiced'
  | 'cancelled';

export type ProjectPhase =
  | 'lead'
  | 'estimation'
  | 'sale'
  | 'planning'
  | 'production'
  | 'closure'
  | 'archive';

export interface ProjectStatusOption {
  value: ProjectStatus;
  label: string;
  phase: ProjectPhase;
  /** Couleur d'accent (hex) — utilisée pour bordures, points, barres Gantt. */
  accent: string;
  /** Couleur de fond translucide pour badges/pastilles. */
  bg: string;
  /** Couleur de bordure translucide pour badges. */
  border: string;
  /** Tailwind utility (texte foncé sur clair) — utilisé dans le Gantt. */
  badgeClass: string;
  /** Tailwind utility solide pour la barre Gantt. */
  barClass: string;
}

// Palette sobre et désaturée (Linear / Notion / Monday).
export const PROJECT_STATUSES: ProjectStatusOption[] = [
  // ── Lead ─────────────────────────────────────────────────────────
  { value: 'new',             label: 'Nouveau',           phase: 'lead',
    accent: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.28)',
    badgeClass: 'bg-blue-500/10 text-blue-300 border border-blue-500/20',
    barClass: 'bg-blue-500/80' },
  { value: 'waiting_contact', label: 'En attente de contact', phase: 'lead',
    accent: '#818cf8', bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.28)',
    badgeClass: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20',
    barClass: 'bg-indigo-500/80' },
  { value: 'visit_booked',    label: 'Visite planifiée',  phase: 'lead',
    accent: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.28)',
    badgeClass: 'bg-amber-500/10 text-amber-300 border border-amber-500/20',
    barClass: 'bg-amber-500/80' },

  // ── Estimation ───────────────────────────────────────────────────
  { value: 'estimating',      label: 'En estimation',     phase: 'estimation',
    accent: '#38bdf8', bg: 'rgba(56,189,248,0.12)',  border: 'rgba(56,189,248,0.28)',
    badgeClass: 'bg-sky-500/10 text-sky-300 border border-sky-500/20',
    barClass: 'bg-sky-500/80' },
  { value: 'quote_sent',      label: 'Soumission envoyée', phase: 'estimation',
    accent: '#fb923c', bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.28)',
    badgeClass: 'bg-orange-500/10 text-orange-300 border border-orange-500/20',
    barClass: 'bg-orange-500/80' },
  { value: 'revision',        label: 'Révision demandée', phase: 'estimation',
    accent: '#facc15', bg: 'rgba(250,204,21,0.12)',  border: 'rgba(250,204,21,0.28)',
    badgeClass: 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20',
    barClass: 'bg-yellow-500/80' },

  // ── Vente ────────────────────────────────────────────────────────
  { value: 'accepted',        label: 'Accepté',           phase: 'sale',
    accent: '#4ade80', bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.28)',
    badgeClass: 'bg-green-500/10 text-green-300 border border-green-500/20',
    barClass: 'bg-green-500/80' },

  // ── Planification ────────────────────────────────────────────────
  { value: 'scheduled',       label: 'Cédulé',            phase: 'planning',
    accent: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.28)',
    badgeClass: 'bg-violet-500/10 text-violet-300 border border-violet-500/20',
    barClass: 'bg-violet-500/80' },

  // ── Production ───────────────────────────────────────────────────
  { value: 'in_progress',     label: 'En cours',          phase: 'production',
    accent: '#22d3ee', bg: 'rgba(34,211,238,0.12)',  border: 'rgba(34,211,238,0.28)',
    badgeClass: 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20',
    barClass: 'bg-cyan-500/80' },

  // ── Fermeture ────────────────────────────────────────────────────
  { value: 'done',            label: 'Terminé',           phase: 'closure',
    accent: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.28)',
    badgeClass: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20',
    barClass: 'bg-emerald-500/80' },
  { value: 'invoiced',        label: 'Facturé',           phase: 'closure',
    accent: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.28)',
    badgeClass: 'bg-teal-500/10 text-teal-300 border border-teal-500/20',
    barClass: 'bg-teal-500/80' },

  // ── Archivés ─────────────────────────────────────────────────────
  { value: 'cancelled',       label: 'Annulé',            phase: 'archive',
    accent: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.28)',
    badgeClass: 'bg-red-500/10 text-red-300 border border-red-500/20 line-through',
    barClass: 'bg-red-500/70' },
];

export interface ProjectPhaseDef {
  key: ProjectPhase;
  label: string;
  statuses: ProjectStatus[];
}

/** Regroupement des statuts en phases métier — utilisé par le Kanban. */
export const PROJECT_PHASES: ProjectPhaseDef[] = [
  { key: 'lead',       label: 'Lead',          statuses: ['new', 'waiting_contact', 'visit_booked'] },
  { key: 'estimation', label: 'Estimation',    statuses: ['estimating', 'quote_sent', 'revision'] },
  { key: 'sale',       label: 'Vente',         statuses: ['accepted'] },
  { key: 'planning',   label: 'Planification', statuses: ['scheduled'] },
  { key: 'production', label: 'Production',    statuses: ['in_progress'] },
  { key: 'closure',    label: 'Fermeture',     statuses: ['done', 'invoiced'] },
  { key: 'archive',    label: 'Archivés',      statuses: ['cancelled'] },
];

/** Statuts visibles dans le Gantt (vue opérationnelle). */
export const GANTT_STATUSES: ProjectStatus[] =
  ['accepted', 'scheduled', 'in_progress', 'done', 'invoiced'];

export interface GanttSection {
  key: string;
  label: string;
  status: ProjectStatus;
}

export const GANTT_SECTIONS: GanttSection[] = [
  { key: 'to_plan',     label: 'À planifier', status: 'accepted' },
  { key: 'scheduled',   label: 'Cédulé',      status: 'scheduled' },
  { key: 'in_progress', label: 'En cours',    status: 'in_progress' },
  { key: 'done',        label: 'Terminé',     status: 'done' },
  { key: 'invoiced',    label: 'Facturé',     status: 'invoiced' },
];

/** Ordre logique pour les tris (du début du pipeline au statut terminal). */
export const PROJECT_STATUS_ORDER: Record<ProjectStatus, number> = PROJECT_STATUSES
  .reduce((acc, s, i) => { acc[s.value] = i + 1; return acc; }, {} as Record<ProjectStatus, number>);

export const getStatusOption = (value: string | null | undefined): ProjectStatusOption => {
  // Always normalize d'abord : un statut legacy comme `to_schedule` ne doit
  // jamais retomber silencieusement sur "Nouveau" — il est mappé vers son
  // équivalent canonique (`accepted`) avant lookup.
  const v = normalizeStatus(value);
  return PROJECT_STATUSES.find(s => s.value === v) ?? PROJECT_STATUSES[0];
};

export const STATUS_LABELS: Record<ProjectStatus, string> = PROJECT_STATUSES
  .reduce((acc, s) => { acc[s.value] = s.label; return acc; }, {} as Record<ProjectStatus, string>);

export const getPhaseForStatus = (status: string | null | undefined): ProjectPhase => {
  const opt = PROJECT_STATUSES.find(s => s.value === normalizeStatus(status));
  return opt?.phase ?? 'lead';
};

/**
 * Mapping des valeurs legacy (avant taxonomie v2) vers les statuts canoniques.
 * Présent surtout dans `schedule_tasks.status` (créées via QBO sync) qui n'a
 * jamais été migrée. À utiliser AVANT tout affichage/édition de statut afin
 * que les badges Gantt/Kanban ne montrent jamais "to_schedule" en brut.
 */
export const LEGACY_STATUS_ALIASES: Record<string, ProjectStatus> = {
  to_contact: 'waiting_contact',
  contacted: 'waiting_contact',
  to_schedule: 'accepted',
  to_plan: 'accepted',
  completed: 'done',
  n: 'new',
  '': 'new',
};

export const normalizeStatus = (raw: string | null | undefined): ProjectStatus => {
  const v = (raw ?? '').trim();
  if (PROJECT_STATUSES.some(s => s.value === v)) return v as ProjectStatus;
  return LEGACY_STATUS_ALIASES[v] ?? 'new';
};
