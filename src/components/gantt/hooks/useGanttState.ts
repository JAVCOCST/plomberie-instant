/**
 * useGanttState — main orchestrator hook for the Gantt module.
 */
import { useState, useCallback, useMemo, useRef } from 'react';
import type {
  GanttTask,
  GanttDependency,
  ViewMode,
  FlattenedRow,
  ContextMenuState,
  TaskStatus,
  GanttColumnKey,
} from '../types';
import { flattenTasks, recalcDuration, recalcEndDate } from '../engine/schedulingEngine';
import { cascadeRecalc, validateDependency } from '../engine/dependencyEngine';
import { computeCriticalPath } from '../engine/criticalPath';
import { startOfWeek, addDays, eachDayOfInterval, addMonths, format } from 'date-fns';
import { fr } from 'date-fns/locale';

export type SortDirection = 'asc' | 'desc' | null;
export interface SortConfig {
  key: GanttColumnKey;
  direction: SortDirection;
}

// Logical pipeline order — synchronisé avec la liste partagée de l'application.
import { PROJECT_STATUS_ORDER } from '@/lib/project-statuses';
const STATUS_ORDER: Record<TaskStatus, number> = PROJECT_STATUS_ORDER;

function getSortValue(task: GanttTask, key: GanttColumnKey): string | number {
  switch (key) {
    case 'title': return task.title?.toLowerCase() || '';
    case 'status': return STATUS_ORDER[task.status as TaskStatus] ?? 999;
    case 'start_date': return task.start_date || '';
    case 'end_date': return task.end_date || '';
    case 'duration_days': return task.duration_days || 0;
    case 'progress': return task.progress || 0;
    case 'labor_cost': return Number(task.labor_cost) || 0;
    case 'material_cost': return Number(task.material_cost) || 0;
    case 'subcontract_cost': return Number(task.subcontract_cost) || 0;
    case 'quote_amount': return Number((task as any)._quoteAmount) || 0;
    case 'work_type': return String((task as any)._workType || '');
    case 'priority': return task.priority || '';
    case 'team': return (task as any).team || '';
    case 'type': return task.type || '';
    case 'address': return String((task as any)._address || task.description || '').toLowerCase();
    case 'reference_id': return String((task as any)._referenceId || '');
    case 'area_sqft': return Number((task as any)._areaSqft) || 0;
    case 'materials_total': return Number((task as any)._materialsTotal) || 0;
    case 'product': return String((task as any)._productName || '').toLowerCase();
    case 'color': return String((task as any)._color || '').toLowerCase();
    case 'slope': return String((task as any)._slope || '').toLowerCase();
    case 'install_date': return String((task as any)._installDate || '');
    default: return '';
  }
}

interface UseGanttStateProps {
  initialTasks: GanttTask[];
  initialDependencies: GanttDependency[];
  onTaskUpdate: (taskId: string, updates: Partial<GanttTask>) => void;
  onTaskBatchUpdate: (updates: Map<string, Partial<GanttTask>>) => void;
  onDependencyCreate: (dep: Omit<GanttDependency, 'id' | 'created_at'>) => void;
  onDependencyDelete: (depId: string) => void;
  onTaskCreate: (task: Partial<GanttTask>) => void;
  onTaskDelete: (taskIds: string[]) => void;
}

export function useGanttState({
  initialTasks,
  initialDependencies,
  onTaskUpdate,
  onTaskBatchUpdate,
  onDependencyCreate,
  onDependencyDelete,
  onTaskCreate,
  onTaskDelete,
}: UseGanttStateProps) {
  // ── Persistence keys ──
  const STORAGE_KEY = 'gantt_view_prefs_v1';
  const loadPrefs = (): { viewMode?: ViewMode; statusFilter?: TaskStatus | 'all'; sortConfig?: SortConfig | null } => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  };
  const initialPrefs = loadPrefs();

  // ── View state ──
  const [viewMode, setViewMode] = useState<ViewMode>(initialPrefs.viewMode || 'week');
  const [viewStart, setViewStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>(initialPrefs.statusFilter || 'all');
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(initialPrefs.sortConfig || null);

  // ── Persist prefs ──
  // Save on each change so user prefs survive refresh / app close.
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ viewMode, statusFilter, sortConfig }));
    } catch {}
  }

  // ── Derived: visible days ──
  const visibleDays = useMemo(() => {
    let end: Date;
    switch (viewMode) {
      case 'day':     end = addDays(viewStart, 30); break;
      case 'week':    end = addDays(viewStart, 42); break;
      case 'month':   end = addMonths(viewStart, 3); break;
      case 'quarter': end = addMonths(viewStart, 9); break;
      case 'year':    end = addMonths(viewStart, 12); break;
      default:        end = addDays(viewStart, 42);
    }
    return eachDayOfInterval({ start: viewStart, end });
  }, [viewStart, viewMode]);

  const dayWidth = useMemo(() => {
    switch (viewMode) {
      case 'day':     return 60;
      case 'week':    return 28;
      case 'month':   return 10;
      case 'quarter': return 4;
      case 'year':    return 2;
      default:        return 28;
    }
  }, [viewMode]);

  // ── Derived: flattened rows (with filter + sort) ──
  const rows = useMemo(() => {
    let flat = flattenTasks(initialTasks, collapsedIds);

    // Status filter — STRICT: only show tasks whose own status matches.
    // (Previous behaviour pulled in ancestors/descendants which made the visible
    // rows look like "wrong status" in the column.)
    if (statusFilter !== 'all') {
      flat = flat.filter(r => r.task.status === statusFilter);
    }

    // Sort — only sort within same parent group to maintain hierarchy
    if (sortConfig?.direction) {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      // Group by parent_id, sort within each group, then reassemble
      const byParent = new Map<string | null, typeof flat>();
      for (const r of flat) {
        const pid = r.task.parent_id ?? null;
        if (!byParent.has(pid)) byParent.set(pid, []);
        byParent.get(pid)!.push(r);
      }
      for (const [, group] of byParent) {
        group.sort((a, b) => {
          const valA = getSortValue(a.task, sortConfig.key);
          const valB = getSortValue(b.task, sortConfig.key);
          if (valA < valB) return -1 * dir;
          if (valA > valB) return 1 * dir;
          return 0;
        });
      }
      // Rebuild flat array preserving parent-child nesting
      const result: typeof flat = [];
      const walk = (parentId: string | null) => {
        const children = byParent.get(parentId) || [];
        for (const child of children) {
          result.push(child);
          walk(child.task.id);
        }
      };
      walk(null);
      flat = result;
    }

    return flat;
  }, [initialTasks, collapsedIds, statusFilter, sortConfig]);

  // ── Derived: critical path ──
  const criticalTaskIds = useMemo(() => {
    if (!showCriticalPath) return new Set<string>();
    return computeCriticalPath(initialTasks, initialDependencies);
  }, [initialTasks, initialDependencies, showCriticalPath]);

  // ── Actions ──

  const toggleCollapse = useCallback((taskId: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  }, []);

  const selectTask = useCallback((taskId: string, multi: boolean) => {
    setSelectedIds(prev => {
      if (multi) {
        const next = new Set(prev);
        next.has(taskId) ? next.delete(taskId) : next.add(taskId);
        return next;
      }
      return new Set([taskId]);
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const navigate = useCallback((direction: 'prev' | 'next' | 'today') => {
    if (direction === 'today') {
      setViewStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
      return;
    }
    const days = viewMode === 'month' ? 30 : viewMode === 'week' ? 7 : 3;
    setViewStart(prev =>
      addDays(prev, direction === 'next' ? days : -days),
    );
  }, [viewMode]);

  // Helper: roll up parent dates from children
  const autoRollUpParent = useCallback((taskId: string) => {
    const task = initialTasks.find(t => t.id === taskId);
    if (!task?.parent_id) return;
    const siblings = initialTasks.filter(t => t.parent_id === task.parent_id);
    if (siblings.length === 0) return;
    const starts = siblings.map(c => c.start_date).sort();
    const ends = siblings.map(c => c.end_date).sort();
    const earliest = starts[0];
    const latest = ends[ends.length - 1];
    const duration = recalcDuration(earliest, latest);
    onTaskUpdate(task.parent_id, { start_date: earliest, end_date: latest, duration_days: duration });
  }, [initialTasks, onTaskUpdate]);

  const handleTaskFieldUpdate = useCallback(
    (taskId: string, field: keyof GanttTask, value: any) => {
      const updates: Partial<GanttTask> = { [field]: value };
      // Auto-recalc related fields
      if (field === 'start_date') {
        const task = initialTasks.find(t => t.id === taskId);
        if (task) updates.duration_days = recalcDuration(value, task.end_date);
      }
      if (field === 'end_date') {
        const task = initialTasks.find(t => t.id === taskId);
        if (task) updates.duration_days = recalcDuration(task.start_date, value);
      }
      if (field === 'duration_days') {
        const task = initialTasks.find(t => t.id === taskId);
        if (task) updates.end_date = recalcEndDate(task.start_date, value as number);
      }

      onTaskUpdate(taskId, updates);

      // Cascade dependencies
      const cascadeUpdates = cascadeRecalc(initialTasks, initialDependencies, taskId);
      if (cascadeUpdates.size > 0) {
        onTaskBatchUpdate(cascadeUpdates);
      }

      // Auto roll-up parent duration
      if (['start_date', 'end_date', 'duration_days'].includes(field)) {
        // Use setTimeout to let the task update propagate first
        setTimeout(() => autoRollUpParent(taskId), 50);
      }
    },
    [initialTasks, initialDependencies, onTaskUpdate, onTaskBatchUpdate, autoRollUpParent],
  );

  const handleDragEnd = useCallback(
    (taskId: string, updates: Partial<GanttTask>) => {
      if (updates.start_date && updates.end_date) {
        updates.duration_days = recalcDuration(updates.start_date, updates.end_date);
      } else if (updates.start_date) {
        const task = initialTasks.find(t => t.id === taskId);
        if (task) updates.duration_days = recalcDuration(updates.start_date, task.end_date);
      } else if (updates.end_date) {
        const task = initialTasks.find(t => t.id === taskId);
        if (task) updates.duration_days = recalcDuration(task.start_date, updates.end_date);
      }
      onTaskUpdate(taskId, updates);

      const cascadeUpdates = cascadeRecalc(initialTasks, initialDependencies, taskId);
      if (cascadeUpdates.size > 0) {
        onTaskBatchUpdate(cascadeUpdates);
      }
    },
    [initialTasks, initialDependencies, onTaskUpdate, onTaskBatchUpdate],
  );

  const handleCreateDependency = useCallback(
    (targetId: string, type: GanttDependency['dependency_type'] = 'FS') => {
      if (!linkingFrom) return;
      const validation = validateDependency(linkingFrom, targetId, initialDependencies);
      if (!validation.valid) {
        setLinkingFrom(null);
        return validation.reason;
      }
      onDependencyCreate({
        schedule_id: initialTasks[0]?.schedule_id || '',
        source_task_id: linkingFrom,
        target_task_id: targetId,
        dependency_type: type,
        lag_days: 0,
      });
      setLinkingFrom(null);
      return null;
    },
    [linkingFrom, initialDependencies, initialTasks, onDependencyCreate],
  );

  /** Direct dependency creation (used by timeline visual linking) */
  const validateAndCreateDependency = useCallback(
    (sourceId: string, targetId: string, type: GanttDependency['dependency_type'] = 'FS'): string | null => {
      const validation = validateDependency(sourceId, targetId, initialDependencies);
      if (!validation.valid) return validation.reason || 'Lien invalide';
      onDependencyCreate({
        schedule_id: initialTasks[0]?.schedule_id || '',
        source_task_id: sourceId,
        target_task_id: targetId,
        dependency_type: type,
        lag_days: 0,
      });
      return null;
    },
    [initialDependencies, initialTasks, onDependencyCreate],
  );

  const openContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ── Bulk actions ──
  const bulkUpdateStatus = useCallback(
    (status: GanttTask['status']) => {
      const updates = new Map<string, Partial<GanttTask>>();
      for (const id of selectedIds) updates.set(id, { status });
      onTaskBatchUpdate(updates);
    },
    [selectedIds, onTaskBatchUpdate],
  );

  const bulkDelete = useCallback(() => {
    onTaskDelete([...selectedIds]);
    clearSelection();
  }, [selectedIds, onTaskDelete, clearSelection]);

  const toggleSort = useCallback((key: GanttColumnKey) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        if (prev.direction === 'asc') return { key, direction: 'desc' };
        if (prev.direction === 'desc') return null;
      }
      return { key, direction: 'asc' };
    });
  }, []);

  return {
    // State
    viewMode,
    viewStart,
    visibleDays,
    dayWidth,
    rows,
    selectedIds,
    collapsedIds,
    contextMenu,
    linkingFrom,
    showBaseline,
    showCriticalPath,
    criticalTaskIds,
    statusFilter,
    sortConfig,
    // Setters
    setViewMode,
    setShowBaseline,
    setShowCriticalPath,
    setLinkingFrom,
    setStatusFilter,
    // Actions
    toggleCollapse,
    selectTask,
    clearSelection,
    navigate,
    handleTaskFieldUpdate,
    handleDragEnd,
    handleCreateDependency,
    validateAndCreateDependency,
    openContextMenu,
    closeContextMenu,
    bulkUpdateStatus,
    bulkDelete,
    toggleSort,
    onTaskCreate,
    onTaskDelete,
    // New: swap subtask positions
    swapTaskOrder: useCallback((taskIdA: string, taskIdB: string) => {
      const taskA = initialTasks.find(t => t.id === taskIdA);
      const taskB = initialTasks.find(t => t.id === taskIdB);
      if (!taskA || !taskB) return;
      // Only swap if they share the same parent
      if (taskA.parent_id !== taskB.parent_id) return;
      const updates = new Map<string, Partial<GanttTask>>();
      updates.set(taskIdA, { sort_order: taskB.sort_order });
      updates.set(taskIdB, { sort_order: taskA.sort_order });
      onTaskBatchUpdate(updates);
    }, [initialTasks, onTaskBatchUpdate]),
    /**
     * Reorder a task by inserting it before another sibling (drag & drop).
     * If `beforeTaskId` is null, the task is moved to the end of its sibling group.
     * Only reorders within the same parent group; cross-parent moves are ignored.
     */
    reorderTask: useCallback((draggedId: string, beforeTaskId: string | null) => {
      const dragged = initialTasks.find(t => t.id === draggedId);
      if (!dragged) return;
      const target = beforeTaskId ? initialTasks.find(t => t.id === beforeTaskId) : null;
      // Must share the same parent (no cross-group moves yet)
      if (target && target.parent_id !== dragged.parent_id) return;
      const siblings = initialTasks
        .filter(t => t.parent_id === dragged.parent_id && t.id !== draggedId)
        .sort((a, b) => a.sort_order - b.sort_order);
      const insertIdx = beforeTaskId
        ? siblings.findIndex(s => s.id === beforeTaskId)
        : siblings.length;
      if (insertIdx < 0) return;
      const reordered = [...siblings];
      reordered.splice(insertIdx, 0, dragged);
      const updates = new Map<string, Partial<GanttTask>>();
      reordered.forEach((t, i) => {
        const newOrder = (i + 1) * 10;
        if (t.sort_order !== newOrder) updates.set(t.id, { sort_order: newOrder });
      });
      if (updates.size > 0) onTaskBatchUpdate(updates);
    }, [initialTasks, onTaskBatchUpdate]),
    // New: recalculate parent duration from subtasks
    rollUpParentDates: useCallback((parentId: string) => {
      const children = initialTasks.filter(t => t.parent_id === parentId);
      if (children.length === 0) return;
      const starts = children.map(c => c.start_date).sort();
      const ends = children.map(c => c.end_date).sort();
      const earliest = starts[0];
      const latest = ends[ends.length - 1];
      const duration = recalcDuration(earliest, latest);
      onTaskUpdate(parentId, { start_date: earliest, end_date: latest, duration_days: duration });
    }, [initialTasks, onTaskUpdate]),
  };
}
