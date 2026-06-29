// ─── Gantt Module Types ─────────────────────────────────────────────────────
import type { ProjectStatus } from '@/lib/project-statuses';

export type TaskType = 'group' | 'phase' | 'item' | 'milestone';
/**
 * Statut de tâche Gantt = statut unifié de l'application.
 * Voir src/lib/project-statuses.ts pour la liste de référence.
 */
export type TaskStatus = ProjectStatus;
export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type ViewMode = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface GanttTask {
  id: string;
  schedule_id: string;
  parent_id: string | null;
  type: TaskType;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  duration_days: number;
  progress: number;
  labor_cost: number;
  material_cost: number;
  subcontract_cost: number;
  assigned_team_summary: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  color: string | null;
  sort_order: number;
  is_collapsed: boolean;
  is_hidden: boolean;
  baseline_start_date: string | null;
  baseline_end_date: string | null;
  created_at: string;
  updated_at: string;
  children?: GanttTask[];
  dependencies?: GanttDependency[];
  assignments?: GanttAssignment[];
  _level?: number;
  _isCritical?: boolean;
  _baselineVarianceDays?: number;
}

export interface GanttDependency {
  id: string;
  schedule_id: string;
  source_task_id: string;
  target_task_id: string;
  dependency_type: DependencyType;
  lag_days: number;
  created_at: string;
}

export interface GanttAssignment {
  id: string;
  task_id: string;
  employee_id: string;
  employee_name?: string;
  hourly_rate: number;
  planned_hours: number;
  created_at: string;
  updated_at: string;
}

export interface GanttBaseline {
  id: string;
  schedule_id: string;
  version_name: string;
  created_by: string;
  created_at: string;
}

export interface GanttBaselineTask {
  id: string;
  baseline_id: string;
  task_id: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  progress: number;
  snapshot_title: string;
}

export type GanttColumnKey =
  | 'link' | 'title' | 'status' | 'start_date' | 'end_date'
  | 'duration_days' | 'progress' | 'labor_cost' | 'material_cost'
  | 'subcontract_cost' | 'quote_amount' | 'work_type' | 'team' | 'priority' | 'baseline_variance'
  | 'critical_path' | 'type'
  | 'address' | 'area_sqft' | 'reference_id' | 'materials_total' | 'quoted_duration'
  | 'product' | 'color' | 'slope' | 'phone' | 'email' | 'install_date';

export interface GanttColumnDef {
  key: GanttColumnKey;
  label: string;
  width: number;
  minWidth: number;
  visible: boolean;
  editable: boolean;
  sortable: boolean;
  align: 'left' | 'center' | 'right';
}

export const DEFAULT_COLUMNS: GanttColumnDef[] = [
  { key: 'link',              label: '',              width: 32,  minWidth: 32,  visible: true,  editable: false, sortable: false, align: 'center' },
  { key: 'title',             label: 'Tâche',         width: 220, minWidth: 120, visible: true,  editable: true,  sortable: true,  align: 'left' },
  { key: 'address',           label: 'Adresse',       width: 220, minWidth: 140, visible: true,  editable: false, sortable: true,  align: 'left' },
  { key: 'reference_id',      label: 'N° Soum.',      width: 110, minWidth: 90,  visible: true,  editable: false, sortable: true,  align: 'center' },
  { key: 'status',            label: 'Statut',        width: 100, minWidth: 80,  visible: true,  editable: true,  sortable: true,  align: 'center' },
  { key: 'start_date',        label: 'Début',         width: 100, minWidth: 90,  visible: true,  editable: true,  sortable: true,  align: 'center' },
  { key: 'end_date',          label: 'Fin',           width: 100, minWidth: 90,  visible: true,  editable: true,  sortable: true,  align: 'center' },
  { key: 'duration_days',     label: 'Durée',         width: 65,  minWidth: 50,  visible: true,  editable: true,  sortable: true,  align: 'center' },
  { key: 'quoted_duration',   label: 'Durée soum.',   width: 90,  minWidth: 70,  visible: true,  editable: false, sortable: true,  align: 'center' },
  { key: 'progress',          label: '%',             width: 55,  minWidth: 45,  visible: true,  editable: true,  sortable: true,  align: 'center' },
  { key: 'labor_cost',        label: 'M-O',           width: 90,  minWidth: 70,  visible: false, editable: true,  sortable: true,  align: 'right' },
  { key: 'material_cost',     label: 'Matériaux',     width: 90,  minWidth: 70,  visible: false, editable: true,  sortable: true,  align: 'right' },
  { key: 'subcontract_cost',  label: 'S-T',           width: 90,  minWidth: 70,  visible: false, editable: true,  sortable: true,  align: 'right' },
  { key: 'quote_amount',      label: 'Montant',       width: 110, minWidth: 90,  visible: true,  editable: false, sortable: true,  align: 'right' },
  { key: 'work_type',         label: 'Type travaux',  width: 130, minWidth: 90,  visible: true,  editable: false, sortable: true,  align: 'left' },
  { key: 'area_sqft',         label: 'Superficie',    width: 100, minWidth: 80,  visible: false, editable: false, sortable: true,  align: 'right' },
  { key: 'materials_total',   label: 'Matériaux ▾',   width: 110, minWidth: 90,  visible: false, editable: false, sortable: true,  align: 'center' },
  { key: 'product',           label: 'Produit',       width: 140, minWidth: 100, visible: false, editable: false, sortable: true,  align: 'left' },
  { key: 'color',             label: 'Couleur',       width: 110, minWidth: 80,  visible: false, editable: false, sortable: true,  align: 'left' },
  { key: 'slope',             label: 'Pente',         width: 90,  minWidth: 70,  visible: false, editable: false, sortable: true,  align: 'left' },
  { key: 'phone',             label: 'Téléphone',     width: 130, minWidth: 100, visible: false, editable: false, sortable: false, align: 'left' },
  { key: 'email',             label: 'Courriel',      width: 180, minWidth: 130, visible: false, editable: false, sortable: false, align: 'left' },
  { key: 'install_date',      label: 'Installation',  width: 110, minWidth: 90,  visible: false, editable: false, sortable: true,  align: 'center' },
  { key: 'team',              label: 'Assigné',       width: 100, minWidth: 60,  visible: true,  editable: true,  sortable: true,  align: 'left' },
  { key: 'priority',          label: 'Priorité',      width: 85,  minWidth: 70,  visible: true,  editable: true,  sortable: true,  align: 'center' },
  { key: 'baseline_variance', label: 'Δ Baseline',    width: 90,  minWidth: 70,  visible: false, editable: false, sortable: true,  align: 'center' },
  { key: 'critical_path',     label: 'Critique',      width: 70,  minWidth: 60,  visible: false, editable: false, sortable: true,  align: 'center' },
  { key: 'type',              label: 'Type',          width: 75,  minWidth: 60,  visible: false, editable: false, sortable: true,  align: 'center' },
];

export interface GanttUserPrefs { columns: GanttColumnDef[]; viewMode: ViewMode; showWeekends: boolean; showBaseline: boolean; showCriticalPath: boolean; }
export interface GanttDragState { taskId: string; mode: 'move' | 'resize-left' | 'resize-right'; startX: number; originalStart: string; originalEnd: string; currentStart: string; currentEnd: string; }
export interface FlattenedRow { task: GanttTask; level: number; isVisible: boolean; }

export type ContextMenuAction =
  | 'add-task' | 'add-subtask' | 'add-phase' | 'add-milestone' | 'add-qbo-project'
  | 'duplicate' | 'delete' | 'convert-phase' | 'convert-group' | 'create-dependency'
  | 'create-baseline' | 'toggle-hidden' | 'open-details' | 'move-up' | 'move-down';

export interface ContextMenuState { x: number; y: number; taskId: string; }

export interface LegacyTaskBlob {
  id: string; name: string; description?: string; type: 'group' | 'phase' | 'item';
  parent_name?: string; parent_id?: string; progress: number; start_date: string; end_date: string;
  status: string; sort_order?: number; assigned_employees?: string[];
  items?: Array<{ id?: string; name: string; mainOeuvre?: number; materiaux?: number; sousTraitant?: number; }>;
}

export function legacyToGanttTask(legacy: LegacyTaskBlob, scheduleId: string): GanttTask {
  const startDate = legacy.start_date || new Date().toISOString().slice(0, 10);
  const endDate = legacy.end_date || startDate;
  const diffMs = new Date(endDate).getTime() - new Date(startDate).getTime();
  const durationDays = Math.max(1, Math.ceil(diffMs / 86_400_000) + 1);
  return {
    id: legacy.id, schedule_id: scheduleId, parent_id: legacy.parent_id || null,
    type: legacy.type === 'group' ? 'group' : legacy.type === 'phase' ? 'phase' : 'item',
    title: legacy.name, description: legacy.description || null,
    start_date: startDate, end_date: endDate, duration_days: durationDays,
    progress: legacy.progress ?? 0,
    labor_cost: legacy.items?.reduce((s, i) => s + (i.mainOeuvre || 0), 0) ?? 0,
    material_cost: legacy.items?.reduce((s, i) => s + (i.materiaux || 0), 0) ?? 0,
    subcontract_cost: legacy.items?.reduce((s, i) => s + (i.sousTraitant || 0), 0) ?? 0,
    assigned_team_summary: legacy.assigned_employees?.join(', ') || null,
    status: (legacy.status as GanttTask['status']) || 'new',
    priority: 'none', color: null, sort_order: legacy.sort_order ?? 0,
    is_collapsed: false, is_hidden: false, baseline_start_date: null, baseline_end_date: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}
