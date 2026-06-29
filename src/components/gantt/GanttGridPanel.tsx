/**
 * GanttGridPanel — left-side task list with configurable columns and inline editing.
 */
import React, { memo, useState, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, ChevronDown, Diamond, LinkIcon, ArrowUp, ArrowDown, Filter, ExternalLink, Package, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { GanttTask, GanttColumnDef, GanttColumnKey, FlattenedRow, TaskStatus, TaskPriority } from './types';
import type { FlatRow } from './engine/schedulingEngine';
import type { SortConfig, SortDirection } from './hooks/useGanttState';
import { EmployeePickerCell, type EmployeeOption } from './EmployeePickerCell';
import { PROJECT_STATUSES, STATUS_LABELS as PROJECT_STATUS_LABELS, normalizeStatus } from '@/lib/project-statuses';

const ROW_HEIGHT = 44;

const STATUS_LABELS: Record<TaskStatus, string> = PROJECT_STATUS_LABELS;

const STATUS_COLORS: Record<TaskStatus, string> = PROJECT_STATUSES.reduce(
  (acc, s) => { acc[s.value] = s.badgeClass; return acc; },
  {} as Record<TaskStatus, string>,
);

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: '-',
  low: 'Basse',
  medium: 'Moyenne',
  high: 'Haute',
  critical: 'Critique',
};

interface GanttGridPanelProps {
  rows: FlatRow[];
  columns: GanttColumnDef[];
  totalWidth: number;
  selectedIds: Set<string>;
  collapsedIds: Set<string>;
  criticalTaskIds: Set<string>;
  linkingFrom: string | null;
  allTasks: GanttTask[];
  scrollRef?: React.RefObject<HTMLDivElement>;
  statusFilter: TaskStatus | 'all';
  sortConfig: SortConfig | null;
  onVerticalScroll?: (scrollTop: number) => void;
  onSelect: (taskId: string, multi: boolean) => void;
  onToggleCollapse: (taskId: string) => void;
  onFieldUpdate: (taskId: string, field: keyof GanttTask, value: any) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string) => void;
  onStartLinking: (taskId: string) => void;
  onStatusFilterChange: (status: TaskStatus | 'all') => void;
  onToggleSort: (key: GanttColumnKey) => void;
  onReorderTask?: (draggedId: string, beforeTaskId: string | null) => void;
  /** Single click on a row (no modifier keys) — opens the rich detail modal. */
  onTaskOpen?: (taskId: string) => void;
  /** Click on the reference_id chip — typically navigates to the quote editor. */
  onSoumissionOpen?: (soumissionId: string) => void;
  /** All employees that can be assigned via the team-column dropdown. */
  employeeOptions?: EmployeeOption[];
  /** Resolve currently-assigned employee IDs for a given task. */
  getAssignedEmployeeIds?: (task: GanttTask) => string[];
  /** Called when the user changes the assignment list from the dropdown. */
  onAssignEmployees?: (task: GanttTask, employeeIds: string[]) => void;
  /** Optional reason to disable the picker for a task (e.g. no QBO link). */
  getAssignDisabledReason?: (task: GanttTask) => string | null;
}

function formatCurrency(v: number) {
  if (!v) return '-';
  return v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 });
}

export const GanttGridPanel = memo(function GanttGridPanel({
  rows,
  columns,
  totalWidth,
  selectedIds,
  collapsedIds,
  criticalTaskIds,
  linkingFrom,
  allTasks,
  scrollRef,
  statusFilter,
  sortConfig,
  onVerticalScroll,
  onSelect,
  onToggleCollapse,
  onFieldUpdate,
  onContextMenu,
  onStartLinking,
  onStatusFilterChange,
  onToggleSort,
  onReorderTask,
  onTaskOpen,
  onSoumissionOpen,
  employeeOptions,
  getAssignedEmployeeIds,
  onAssignEmployees,
  getAssignDisabledReason,
}: GanttGridPanelProps) {
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: GanttColumnKey } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Disable DnD while a column sort is active (visual order ≠ stored order)
  const dndEnabled = !!onReorderTask && !sortConfig?.direction;

  // Auto-size the title column based on content
  const autoTitleWidth = useMemo(() => {
    const titleCol = columns.find(c => c.key === 'title');
    if (!titleCol) return 0;
    let maxWidth = titleCol.minWidth;
    for (const { task, level } of rows) {
      // Approximate: 7px per char for 12px font, plus indent + icon + padding
      const textWidth = task.title.length * 6.5 + level * 16 + 28;
      if (textWidth > maxWidth) maxWidth = textWidth;
    }
    return Math.min(Math.max(maxWidth, titleCol.minWidth), 500);
  }, [rows, columns]);

  // Compute adjusted columns with auto-sized title
  const adjustedColumns = useMemo(() => {
    return columns.map(c => c.key === 'title' ? { ...c, width: Math.max(c.width, autoTitleWidth) } : c);
  }, [columns, autoTitleWidth]);

  const hasChildren = useCallback(
    (taskId: string) => allTasks.some(t => t.parent_id === taskId),
    [allTasks],
  );

  const startEdit = (taskId: string, field: GanttColumnKey) => {
    const col = columns.find(c => c.key === field);
    if (!col?.editable) return;
    setEditingCell({ taskId, field });
  };

  const commitEdit = (taskId: string, field: GanttColumnKey, value: any) => {
    onFieldUpdate(taskId, field as keyof GanttTask, value);
    setEditingCell(null);
  };

  const renderCell = (task: GanttTask, col: GanttColumnDef, level: number) => {
    const isEditing = editingCell?.taskId === task.id && editingCell?.field === col.key;
    const isCritical = criticalTaskIds.has(task.id);

    switch (col.key) {
      case 'link':
        return (
          <button
            className={cn(
              'p-0.5 rounded hover:bg-muted',
              linkingFrom === task.id && 'bg-primary text-primary-foreground',
            )}
            onClick={(e) => { e.stopPropagation(); onStartLinking(task.id); }}
          >
            <LinkIcon className="h-3 w-3" />
          </button>
        );

      case 'title':
        return (
          <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: level * 16 }}>
            {hasChildren(task.id) || task.type === 'group' ? (
              <button
                className="p-0.5 shrink-0"
                onClick={(e) => { e.stopPropagation(); onToggleCollapse(task.id); }}
              >
                {collapsedIds.has(task.id)
                  ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            ) : task.type === 'milestone' ? (
              <Diamond className="h-3 w-3 text-amber-500 shrink-0" />
            ) : (
              <div className="w-4 shrink-0" />
            )}
            {isEditing ? (
              <Input
                autoFocus
                defaultValue={task.title}
                className="h-6 text-xs px-1 py-0"
                onBlur={(e) => commitEdit(task.id, 'title', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(task.id, 'title', (e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') setEditingCell(null);
                }}
              />
            ) : (
              <div className="flex flex-col min-w-0 leading-tight" onDoubleClick={() => startEdit(task.id, 'title')}>
                <span
                  className={cn(
                    'truncate text-xs',
                    task.type === 'group' && 'font-semibold',
                    isCritical && 'text-destructive font-medium',
                  )}
                >
                  {task.title}
                </span>
                {task.description && task.description.trim() !== '' &&
                  task.description.trim().toLowerCase() !== task.title.trim().toLowerCase() && (
                  <span className="truncate text-[10px] text-muted-foreground">
                    {task.description}
                  </span>
                )}
              </div>
            )}
          </div>
        );

      case 'status': {
        // Les `schedule_tasks` issues du sync QBO contiennent encore des
        // statuts legacy (`to_contact`, `to_schedule`…). On normalise pour
        // toujours afficher un badge cohérent et un Select valide.
        const normalizedStatus = normalizeStatus(task.status as string) as TaskStatus;
        if (isEditing) {
          return (
            <Select
              defaultValue={normalizedStatus}
              onValueChange={(v) => commitEdit(task.id, 'status', v)}
            >
              <SelectTrigger className="h-6 text-[10px] px-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }
        return (
          <Badge
            variant="secondary"
            className={cn('text-[10px] cursor-pointer px-1.5 py-0', STATUS_COLORS[normalizedStatus])}
            onClick={() => startEdit(task.id, 'status')}
          >
            {STATUS_LABELS[normalizedStatus]}
          </Badge>
        );
      }

      case 'start_date':
      case 'end_date':
        if (isEditing) {
          return (
            <Input
              type="date"
              autoFocus
              defaultValue={task[col.key] as string}
              className="h-6 text-[10px] px-1 py-0"
              onBlur={(e) => commitEdit(task.id, col.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit(task.id, col.key, (e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setEditingCell(null);
              }}
            />
          );
        }
        return (
          <span className="text-[10px] text-muted-foreground cursor-pointer" onDoubleClick={() => startEdit(task.id, col.key)}>
            {(task[col.key] as string)?.slice(5) || '-'}
          </span>
        );

      case 'duration_days':
        if (isEditing) {
          return (
            <Input
              type="number"
              autoFocus
              defaultValue={task.duration_days}
              className="h-6 text-[10px] px-1 py-0 w-12"
              onBlur={(e) => commitEdit(task.id, 'duration_days', parseInt(e.target.value) || 1)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit(task.id, 'duration_days', parseInt((e.target as HTMLInputElement).value) || 1);
                if (e.key === 'Escape') setEditingCell(null);
              }}
            />
          );
        }
        return (
          <span className="text-[10px] cursor-pointer" onDoubleClick={() => startEdit(task.id, 'duration_days')}>
            {task.duration_days}j
          </span>
        );

      case 'quoted_duration': {
        const qd = (task as any)._quotedDuration as number | undefined;
        if (qd == null || !isFinite(qd) || qd <= 0) {
          return <span className="text-[10px] text-muted-foreground">—</span>;
        }
        return (
          <span
            className="text-[10px] font-semibold"
            style={{ color: '#a78bfa' }}
            title="Durée calculée dans la soumission (jours ouvrables)"
          >
            {qd.toFixed(1)} j
          </span>
        );
      }

      case 'progress':
        if (isEditing) {
          return (
            <Input
              type="number"
              autoFocus
              min={0}
              max={100}
              defaultValue={task.progress}
              className="h-6 text-[10px] px-1 py-0 w-12"
              onBlur={(e) => commitEdit(task.id, 'progress', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit(task.id, 'progress', Math.min(100, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0)));
                if (e.key === 'Escape') setEditingCell(null);
              }}
            />
          );
        }
        return (
          <div className="flex items-center gap-1">
            <div className="w-8 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${task.progress}%` }} />
            </div>
            <span className="text-[10px] cursor-pointer" onDoubleClick={() => startEdit(task.id, 'progress')}>
              {task.progress}
            </span>
          </div>
        );

      case 'labor_cost':
        return <span className="text-[10px]">{formatCurrency(task.labor_cost)}</span>;
      case 'material_cost':
        return <span className="text-[10px]">{formatCurrency(task.material_cost)}</span>;
      case 'subcontract_cost':
        return <span className="text-[10px]">{formatCurrency(task.subcontract_cost)}</span>;

      case 'quote_amount': {
        const amount = (task as any)._quoteAmount as number | undefined;
        if (amount && amount > 0) {
          return <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(amount)}</span>;
        }
        return <span className="text-[10px] text-muted-foreground">-</span>;
      }

      case 'work_type': {
        const wt = (task as any)._workType as string | undefined;
        if (wt && wt.trim()) {
          return <span className="text-[10px] truncate" title={wt}>{wt}</span>;
        }
        return <span className="text-[10px] text-muted-foreground">-</span>;
      }

      case 'priority':
        if (isEditing) {
          return (
            <Select defaultValue={task.priority} onValueChange={(v) => commitEdit(task.id, 'priority', v)}>
              <SelectTrigger className="h-6 text-[10px] px-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }
        return (
          <span className="text-[10px] cursor-pointer" onDoubleClick={() => startEdit(task.id, 'priority')}>
            {PRIORITY_LABELS[task.priority]}
          </span>
        );

      case 'team':
        if (employeeOptions && onAssignEmployees && getAssignedEmployeeIds) {
          const ids = getAssignedEmployeeIds(task);
          const disabledReason = getAssignDisabledReason?.(task) || null;
          return (
            <EmployeePickerCell
              employees={employeeOptions}
              selectedIds={ids}
              fallbackText={task.assigned_team_summary}
              disabled={!!disabledReason}
              disabledReason={disabledReason || undefined}
              onChange={(next) => onAssignEmployees(task, next)}
            />
          );
        }
        if (isEditing) {
          return (
            <Input
              autoFocus
              defaultValue={task.assigned_team_summary || ''}
              className="h-6 text-[10px] px-1 py-0"
              onBlur={(e) => onFieldUpdate(task.id, 'assigned_team_summary', e.target.value || null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onFieldUpdate(task.id, 'assigned_team_summary', (e.target as HTMLInputElement).value || null); setEditingCell(null); }
                if (e.key === 'Escape') setEditingCell(null);
              }}
            />
          );
        }
        return (
          <span className="text-[10px] truncate cursor-pointer" onDoubleClick={() => startEdit(task.id, 'team')}>
            {task.assigned_team_summary || '-'}
          </span>
        );

      case 'baseline_variance':
        if (task._baselineVarianceDays != null) {
          const v = task._baselineVarianceDays;
          return (
            <span className={cn('text-[10px] font-medium', v > 0 ? 'text-destructive' : v < 0 ? 'text-green-600' : '')}>
              {v > 0 ? `+${v}j` : v < 0 ? `${v}j` : '0'}
            </span>
          );
        }
        return <span className="text-[10px] text-muted-foreground">-</span>;

      case 'critical_path':
        return isCritical
          ? <Badge variant="destructive" className="text-[9px] px-1 py-0">Oui</Badge>
          : <span className="text-[10px] text-muted-foreground">-</span>;

      case 'type':
        return <span className="text-[10px] capitalize">{task.type}</span>;

      case 'address': {
        const addr = (task as any)._address || task.description || '';
        return addr
          ? <span className="text-[10px] truncate" title={addr}>{addr}</span>
          : <span className="text-[10px] text-muted-foreground">-</span>;
      }

      case 'reference_id': {
        const ref = (task as any)._referenceId as string | undefined;
        const sid = (task as any)._soumissionId as string | undefined;
        if (!ref) return <span className="text-[10px] text-muted-foreground">-</span>;
        return (
          <button
            type="button"
            className="text-[10px] font-medium text-primary hover:underline inline-flex items-center gap-1"
            onClick={(e) => {
              e.stopPropagation();
              if (sid && onSoumissionOpen) onSoumissionOpen(sid);
            }}
            title="Voir la soumission"
          >
            {ref} <ExternalLink className="h-2.5 w-2.5" />
          </button>
        );
      }

      case 'area_sqft': {
        const v = (task as any)._areaSqft as number | undefined;
        return v ? <span className="text-[10px]">{Math.round(v).toLocaleString('fr-CA')} pi²</span>
                 : <span className="text-[10px] text-muted-foreground">-</span>;
      }

      case 'materials_total': {
        const lines = (task as any)._materialsLines as Array<{description: string; quantity: number; unit: string}> | undefined;
        const total = (task as any)._materialsTotal as number | undefined;
        if (!lines || lines.length === 0) return <span className="text-[10px] text-muted-foreground">-</span>;
        const csv = () => {
          const header = 'Description;Quantité;Unité\n';
          const rows = lines.map(l => `"${(l.description||'').replace(/"/g,'""')}";${l.quantity};${l.unit||''}`).join('\n');
          const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `materiaux-${task.title.replace(/\s+/g,'_')}.csv`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        return (
          <Popover>
            <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20">
                <Package className="h-3 w-3" /> {Math.round(total || 0)}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end" onClick={(e) => e.stopPropagation()}>
              <div className="px-3 py-2 border-b flex items-center justify-between">
                <span className="text-xs font-semibold">Matériaux</span>
                <button onClick={csv} className="text-[10px] inline-flex items-center gap-1 text-primary hover:underline">
                  <Download className="h-3 w-3" /> CSV
                </button>
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0">
                        <td className="px-3 py-1.5">{l.description}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                          <span className="font-semibold">{l.quantity}</span>{' '}
                          <span className="text-[10px] text-muted-foreground">{l.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PopoverContent>
          </Popover>
        );
      }

      case 'product': {
        const brand = (task as any)._productBrand as string | undefined;
        const name = (task as any)._productName as string | undefined;
        const v = [brand, name].filter(Boolean).join(' · ');
        return v ? <span className="text-[10px] truncate" title={v}>{v}</span>
                 : <span className="text-[10px] text-muted-foreground">-</span>;
      }
      case 'color': {
        const v = (task as any)._color as string | undefined;
        return v ? <span className="text-[10px] truncate" title={v}>{v}</span>
                 : <span className="text-[10px] text-muted-foreground">-</span>;
      }
      case 'slope': {
        const v = (task as any)._slope as string | undefined;
        return v ? <span className="text-[10px]">{v}</span>
                 : <span className="text-[10px] text-muted-foreground">-</span>;
      }
      case 'phone': {
        const v = (task as any)._phone as string | undefined;
        return v ? <a href={`tel:${v}`} className="text-[10px] text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{v}</a>
                 : <span className="text-[10px] text-muted-foreground">-</span>;
      }
      case 'email': {
        const v = (task as any)._email as string | undefined;
        return v ? <a href={`mailto:${v}`} className="text-[10px] text-primary hover:underline truncate inline-block max-w-full" title={v} onClick={(e) => e.stopPropagation()}>{v}</a>
                 : <span className="text-[10px] text-muted-foreground">-</span>;
      }
      case 'install_date': {
        const v = (task as any)._installDate as string | undefined;
        return v ? <span className="text-[10px]">{v.slice(5)}</span>
                 : <span className="text-[10px] text-muted-foreground">-</span>;
      }

      default:
        return null;
    }
  };

  const adjustedTotalWidth = adjustedColumns.reduce((s, c) => s + c.width, 0);

  return (
    <div className="flex flex-col h-full bg-background" style={{ width: Math.max(totalWidth, adjustedTotalWidth) }}>
      {/* Header */}
      <div className="flex items-center h-9 border-b border-border bg-muted/50 shrink-0">
        {adjustedColumns.map(col => {
          const isSorted = sortConfig?.key === col.key;
          const isStatusCol = col.key === 'status';

          return (
            <div
              key={col.key}
              className={cn(
                'text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 shrink-0 border-r border-border/60 flex items-center gap-0.5',
                col.sortable && 'cursor-pointer hover:text-foreground select-none',
              )}
              style={{ width: col.width, justifyContent: col.align === 'left' ? 'flex-start' : col.align === 'right' ? 'flex-end' : 'center' }}
              onClick={() => col.sortable && onToggleSort(col.key)}
            >
              <span className="truncate">{col.label}</span>
              {isSorted && sortConfig?.direction === 'asc' && <ArrowUp className="h-3 w-3 shrink-0 text-primary" />}
              {isSorted && sortConfig?.direction === 'desc' && <ArrowDown className="h-3 w-3 shrink-0 text-primary" />}
              {isStatusCol && (
                <Popover>
                  <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className={cn('ml-auto shrink-0 p-0.5 rounded hover:bg-accent', statusFilter !== 'all' && 'text-primary')}>
                      <Filter className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-40 p-1" align="start">
                    <button
                      className={cn('w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent', statusFilter === 'all' && 'bg-accent font-medium')}
                      onClick={() => onStatusFilterChange('all')}
                    >
                      Tous
                    </button>
                    {(Object.entries(STATUS_LABELS) as [TaskStatus, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        className={cn('w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent', statusFilter === key && 'bg-accent font-medium')}
                        onClick={() => onStatusFilterChange(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          );
        })}
      </div>

      {/* Rows */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-scroll overflow-x-hidden scrollbar-none"
        style={{ scrollbarWidth: 'none' }}
        onScroll={onVerticalScroll ? (e) => onVerticalScroll((e.target as HTMLDivElement).scrollTop) : undefined}
      >
        {rows.map(({ task, level }) => (
          <div
            key={task.id}
            draggable={dndEnabled}
            onDragStart={(e) => {
              if (!dndEnabled) return;
              setDraggingId(task.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', task.id);
            }}
            onDragOver={(e) => {
              if (!dndEnabled || !draggingId || draggingId === task.id) return;
              const dragged = allTasks.find(t => t.id === draggingId);
              // Only allow drop on a sibling of the dragged task
              if (!dragged || dragged.parent_id !== task.parent_id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dropTargetId !== task.id) setDropTargetId(task.id);
            }}
            onDragLeave={(e) => {
              // Only clear if leaving the row (not a child element)
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              if (dropTargetId === task.id) setDropTargetId(null);
            }}
            onDrop={(e) => {
              if (!dndEnabled || !draggingId || draggingId === task.id) return;
              e.preventDefault();
              onReorderTask?.(draggingId, task.id);
              setDraggingId(null);
              setDropTargetId(null);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTargetId(null);
            }}
            className={cn(
              'flex items-center border-b border-border hover:bg-muted/30 transition-colors bg-background',
              selectedIds.has(task.id) && 'bg-primary/5',
              linkingFrom === task.id && 'bg-primary/10',
              dndEnabled && 'cursor-grab active:cursor-grabbing',
              draggingId === task.id && 'opacity-40',
              dropTargetId === task.id && 'border-t-2 border-t-primary',
            )}
            style={{ height: ROW_HEIGHT }}
            onClick={(e) => {
              const multi = e.shiftKey || e.ctrlKey || e.metaKey;
              if (multi) {
                onSelect(task.id, true);
              } else if (onTaskOpen) {
                onTaskOpen(task.id);
              } else {
                onSelect(task.id, false);
              }
            }}
            onContextMenu={(e) => onContextMenu(e, task.id)}
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (!t) return;
              const startX = t.clientX, startY = t.clientY;
              const target = e.currentTarget as HTMLElement;
              const timer = window.setTimeout(() => {
                // Synthesize a context menu event at the touch point
                onContextMenu({
                  preventDefault: () => {},
                  stopPropagation: () => {},
                  clientX: startX,
                  clientY: startY,
                } as unknown as React.MouseEvent, task.id);
                if (navigator.vibrate) navigator.vibrate(10);
              }, 500);
              const cancel = (ev: TouchEvent) => {
                const tt = ev.touches[0];
                if (tt && (Math.abs(tt.clientX - startX) > 8 || Math.abs(tt.clientY - startY) > 8)) {
                  window.clearTimeout(timer);
                  cleanup();
                }
              };
              const end = () => { window.clearTimeout(timer); cleanup(); };
              const cleanup = () => {
                target.removeEventListener('touchmove', cancel);
                target.removeEventListener('touchend', end);
                target.removeEventListener('touchcancel', end);
              };
              target.addEventListener('touchmove', cancel, { passive: true });
              target.addEventListener('touchend', end);
              target.addEventListener('touchcancel', end);
            }}
          >
            {adjustedColumns.map(col => (
              <div
                key={col.key}
                className="flex items-center justify-center px-1 shrink-0 min-w-0 border-r border-border/40"
                style={{ width: col.width, justifyContent: col.align === 'left' ? 'flex-start' : col.align === 'right' ? 'flex-end' : 'center' }}
              >
                {renderCell(task, col, level)}
              </div>
            ))}
          </div>
        ))}
        {/* Bottom padding so context menu on last row is visible */}
        <div style={{ height: 200 }} />
      </div>
    </div>
  );
});
