/**
 * ScheduleGanttViewV2 — main orchestrator for the modular Gantt chart.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GanttToolbar } from './GanttToolbar';
import { GanttGridPanel } from './GanttGridPanel';
import { GanttTimeline } from './GanttTimeline';
import { GanttContextMenu } from './GanttContextMenu';
import { useGanttState } from './hooks/useGanttState';
import { useColumnConfig } from './hooks/useColumnConfig';
import { useBarDrag } from './hooks/useBarDrag';
import type { GanttTask, GanttDependency, ContextMenuAction, DependencyType, ViewMode } from './types';
import type { ExtraMenuItem } from './GanttContextMenu';
import type { EmployeeOption } from './EmployeePickerCell';
import { format, addDays } from 'date-fns';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { Table2, GanttChartSquare, ZoomIn, ZoomOut } from 'lucide-react';

interface ScheduleGanttViewV2Props {
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  scheduleId: string;
  onTaskUpdate: (taskId: string, updates: Partial<GanttTask>) => void;
  onTaskBatchUpdate: (updates: Map<string, Partial<GanttTask>>) => void;
  onTaskCreate: (task: Partial<GanttTask>) => void;
  onTaskDelete: (taskIds: string[]) => void;
  onDependencyCreate: (dep: Omit<GanttDependency, 'id' | 'created_at'>) => void;
  onDependencyDelete: (depId: string) => void;
  onContextAction?: (action: ContextMenuAction, taskId: string) => void;
  extraContextMenuItems?: ExtraMenuItem[];
  /** Optional employee dropdown integration for the "Assigné" column. */
  employeeOptions?: EmployeeOption[];
  getAssignedEmployeeIds?: (task: GanttTask) => string[];
  onAssignEmployees?: (task: GanttTask, employeeIds: string[]) => void;
  getAssignDisabledReason?: (task: GanttTask) => string | null;
  /** Single-click on a row in the grid — opens the rich detail modal. */
  onTaskOpen?: (taskId: string) => void;
  /** Click on the reference_id chip — opens the linked soumission. */
  onSoumissionOpen?: (soumissionId: string) => void;
  /** Toolbar "+" button. When provided, shows an Add button (mobile-friendly). */
  onAddTask?: () => void;
}

const MIN_GRID_WIDTH = 200;
const MAX_GRID_WIDTH = 900;
const MIN_HEIGHT = 300;
const MAX_HEIGHT = 4000;

export function ScheduleGanttViewV2({
  tasks,
  dependencies,
  scheduleId,
  onTaskUpdate,
  onTaskBatchUpdate,
  onTaskCreate,
  onTaskDelete,
  onDependencyCreate,
  onDependencyDelete,
  onContextAction,
  extraContextMenuItems,
  employeeOptions,
  getAssignedEmployeeIds,
  onAssignEmployees,
  getAssignDisabledReason,
  onTaskOpen,
  onSoumissionOpen,
  onAddTask,
}: ScheduleGanttViewV2Props) {
  const gantt = useGanttState({
    initialTasks: tasks,
    initialDependencies: dependencies,
    onTaskUpdate,
    onTaskBatchUpdate,
    onDependencyCreate,
    onDependencyDelete,
    onTaskCreate,
    onTaskDelete,
  });

  const columnConfig = useColumnConfig();
  const { dragState, startDrag } = useBarDrag({
    dayWidth: gantt.dayWidth,
    onDragEnd: gantt.handleDragEnd,
  });

  // ── Mobile tab toggle (Tableau / Échéancier) ──
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'grid' | 'timeline'>('timeline');

  // Mobile-only zoom for the timeline (cycles through view modes without zooming the page).
  const ZOOM_MODES: ViewMode[] = ['year', 'quarter', 'month', 'week', 'day'];
  const zoomIn = useCallback(() => {
    const i = ZOOM_MODES.indexOf(gantt.viewMode);
    if (i >= 0 && i < ZOOM_MODES.length - 1) gantt.setViewMode(ZOOM_MODES[i + 1]);
  }, [gantt]);
  const zoomOut = useCallback(() => {
    const i = ZOOM_MODES.indexOf(gantt.viewMode);
    if (i > 0) gantt.setViewMode(ZOOM_MODES[i - 1]);
  }, [gantt]);

  // ── Resizable grid width ──
  const [gridWidth, setGridWidth] = useState(() => columnConfig.totalWidth);
  const [manualHeight, setManualHeight] = useState<number | null>(null);
  // Default: fill parent (100%). Manual resize overrides with explicit pixels.
  const containerHeight: number | string = manualHeight ?? '100%';
  const [isResizing, setIsResizing] = useState(false);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  const handleGridScroll = useCallback((scrollTop: number) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (timelineScrollRef.current) timelineScrollRef.current.scrollTop = scrollTop;
    requestAnimationFrame(() => { isSyncing.current = false; });
  }, []);

  const handleTimelineScroll = useCallback((scrollTop: number) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (gridScrollRef.current) gridScrollRef.current.scrollTop = scrollTop;
    requestAnimationFrame(() => { isSyncing.current = false; });
  }, []);

  const VIEW_MODES: ViewMode[] = ['month', 'week', 'day'];
  const handleZoom = useCallback((direction: 'in' | 'out') => {
    const currentIdx = VIEW_MODES.indexOf(gantt.viewMode);
    const nextIdx = direction === 'in'
      ? Math.min(currentIdx + 1, VIEW_MODES.length - 1)
      : Math.max(currentIdx - 1, 0);
    if (nextIdx !== currentIdx) gantt.setViewMode(VIEW_MODES[nextIdx]);
  }, [gantt.viewMode, gantt.setViewMode]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = gridWidth;

    const onMouseMove = (me: MouseEvent) => {
      const delta = me.clientX - startX;
      const newWidth = Math.max(MIN_GRID_WIDTH, Math.min(MAX_GRID_WIDTH, startWidth + delta));
      setGridWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [gridWidth]);

  const handleHeightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = typeof containerHeight === 'number'
      ? containerHeight
      : (e.currentTarget.parentElement?.getBoundingClientRect().height ?? 600);

    const onMouseMove = (me: MouseEvent) => {
      const delta = me.clientY - startY;
      setManualHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + delta)));
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [containerHeight]);

  // ── Dependency creation from timeline ──
  const handleTimelineDependencyCreate = useCallback(
    (sourceTaskId: string, targetTaskId: string, depType: DependencyType): string | null => {
      // Use the gantt hook's validation
      const validation = gantt.validateAndCreateDependency(sourceTaskId, targetTaskId, depType);
      if (validation) {
        toast.error(validation);
      } else {
        toast.success('Dépendance créée');
      }
      return validation;
    },
    [gantt],
  );

  // ── Context menu handler ──
  const handleContextAction = useCallback(
    (action: ContextMenuAction) => {
      const taskId = gantt.contextMenu?.taskId;
      if (!taskId) return;
      const task = tasks.find(t => t.id === taskId);

      switch (action) {
        case 'add-task':
          onTaskCreate({
            schedule_id: scheduleId,
            parent_id: task?.parent_id || null,
            type: 'phase',
            title: 'Nouvelle tâche',
            start_date: format(new Date(), 'yyyy-MM-dd'),
            end_date: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
            duration_days: 7,
            sort_order: tasks.length,
          });
          break;
        case 'add-subtask':
          onTaskCreate({
            schedule_id: scheduleId,
            parent_id: taskId,
            type: 'item',
            title: 'Nouvelle sous-tâche',
            start_date: task?.start_date || format(new Date(), 'yyyy-MM-dd'),
            end_date: task?.end_date || format(addDays(new Date(), 3), 'yyyy-MM-dd'),
            duration_days: 3,
            sort_order: tasks.filter(t => t.parent_id === taskId).length,
          });
          break;
        case 'add-phase':
          onTaskCreate({
            schedule_id: scheduleId,
            parent_id: task?.parent_id || null,
            type: 'phase',
            title: 'Nouvelle phase',
            start_date: format(new Date(), 'yyyy-MM-dd'),
            end_date: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
            duration_days: 14,
            sort_order: tasks.length,
          });
          break;
        case 'add-milestone':
          onTaskCreate({
            schedule_id: scheduleId,
            parent_id: task?.parent_id || null,
            type: 'milestone',
            title: 'Nouveau jalon',
            start_date: task?.end_date || format(new Date(), 'yyyy-MM-dd'),
            end_date: task?.end_date || format(new Date(), 'yyyy-MM-dd'),
            duration_days: 0,
            sort_order: tasks.length,
          });
          break;
        case 'duplicate':
          if (task) {
            onTaskCreate({
              ...task,
              id: undefined,
              title: `${task.title} (copie)`,
              sort_order: tasks.length,
            } as any);
          }
          break;
        case 'delete':
          onTaskDelete([taskId]);
          break;
        case 'convert-phase':
          onTaskUpdate(taskId, { type: 'phase' });
          break;
        case 'convert-group':
          onTaskUpdate(taskId, { type: 'group' });
          break;
        case 'create-dependency':
          gantt.setLinkingFrom(taskId);
          toast.info('Cliquez sur la tâche cible pour créer la dépendance');
          break;
        case 'toggle-hidden':
          onTaskUpdate(taskId, { is_hidden: !task?.is_hidden });
          break;
        default:
          // Delegate to parent handler for custom actions (e.g. add-qbo-project)
          if (onContextAction) onContextAction(action, taskId);
          break;
      }
      gantt.closeContextMenu();
    },
    [gantt, tasks, scheduleId, onTaskCreate, onTaskDelete, onTaskUpdate],
  );

  const viewEnd = gantt.visibleDays[gantt.visibleDays.length - 1] || new Date();
  const contextTask = gantt.contextMenu
    ? tasks.find(t => t.id === gantt.contextMenu!.taskId)
    : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex flex-col border rounded-lg overflow-hidden bg-background"
        style={{ height: containerHeight, touchAction: isMobile ? 'pan-x pan-y' : undefined }}
      >
        {/* Toolbar */}
        <GanttToolbar
          viewMode={gantt.viewMode}
          viewStart={gantt.viewStart}
          viewEnd={viewEnd}
          showBaseline={gantt.showBaseline}
          showCriticalPath={gantt.showCriticalPath}
          linkingFrom={gantt.linkingFrom}
          selectedCount={gantt.selectedIds.size}
          columns={columnConfig.columns}
          onSetViewMode={gantt.setViewMode}
          onNavigate={gantt.navigate}
          onToggleBaseline={gantt.setShowBaseline}
          onToggleCriticalPath={gantt.setShowCriticalPath}
          onCancelLinking={() => gantt.setLinkingFrom(null)}
          onToggleColumn={columnConfig.toggleColumn}
          onResetColumns={columnConfig.resetColumns}
          onAddTask={onAddTask}
        />

        {/* Main content: Grid + Resizer + Timeline */}
        {isMobile && (
          <div className="flex shrink-0 border-b bg-background/80 backdrop-blur sticky top-0 z-20">
            <button
              type="button"
              onClick={() => setMobileTab('grid')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                mobileTab === 'grid'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <Table2 className="h-4 w-4" /> Tableau
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('timeline')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                mobileTab === 'timeline'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <GanttChartSquare className="h-4 w-4" /> Échéancier
            </button>
            {mobileTab === 'timeline' && (
              <div className="flex items-center gap-1 px-2 border-l">
                <button
                  type="button"
                  aria-label="Dézoomer"
                  onClick={zoomOut}
                  className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 active:bg-primary/20 transition-colors"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Zoomer"
                  onClick={zoomIn}
                  className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 active:bg-primary/20 transition-colors"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Left grid panel */}
          <div
            className={`${isMobile ? (mobileTab === 'grid' ? 'flex-1' : 'hidden') : 'shrink-0'} border-r overflow-x-auto overflow-y-hidden`}
            style={isMobile ? undefined : { width: gridWidth }}
          >
            <GanttGridPanel
              rows={gantt.rows}
              columns={columnConfig.visibleColumns}
              totalWidth={isMobile ? Math.max(columnConfig.totalWidth, 600) : gridWidth}
              selectedIds={gantt.selectedIds}
              collapsedIds={gantt.collapsedIds}
              criticalTaskIds={gantt.criticalTaskIds}
              linkingFrom={gantt.linkingFrom}
              allTasks={tasks}
              scrollRef={gridScrollRef}
              statusFilter={gantt.statusFilter}
              sortConfig={gantt.sortConfig}
              onVerticalScroll={handleGridScroll}
              onSelect={gantt.selectTask}
              onToggleCollapse={gantt.toggleCollapse}
              onFieldUpdate={gantt.handleTaskFieldUpdate}
              onContextMenu={gantt.openContextMenu}
              onStatusFilterChange={gantt.setStatusFilter}
              onToggleSort={gantt.toggleSort}
              onReorderTask={gantt.reorderTask}
              employeeOptions={employeeOptions}
              getAssignedEmployeeIds={getAssignedEmployeeIds}
              onAssignEmployees={onAssignEmployees}
              getAssignDisabledReason={getAssignDisabledReason}
              onTaskOpen={onTaskOpen}
              onSoumissionOpen={onSoumissionOpen}
              onStartLinking={(id) => {
                if (gantt.linkingFrom) {
                  const err = gantt.handleCreateDependency(id);
                  if (err) toast.error(err);
                } else {
                  gantt.setLinkingFrom(id);
                }
              }}
            />
          </div>

          {/* Resize handle — aligned to top (desktop only) */}
          {!isMobile && (
            <div
              className="shrink-0 w-1.5 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors relative group flex items-start justify-center pt-2"
              onMouseDown={handleResizeStart}
            >
              <div className="w-0.5 h-8 bg-border group-hover:bg-primary/50 rounded-full transition-colors" />
            </div>
          )}

          {/* Right timeline */}
          <div className={isMobile ? (mobileTab === 'timeline' ? 'flex-1 min-w-0 flex flex-col' : 'hidden') : 'flex-1 min-w-0 flex flex-col'}>
          <GanttTimeline
            rows={gantt.rows}
            dependencies={dependencies}
            visibleDays={gantt.visibleDays}
            dayWidth={gantt.dayWidth}
            viewMode={gantt.viewMode}
            viewStart={gantt.viewStart}
            selectedIds={gantt.selectedIds}
            criticalTaskIds={gantt.criticalTaskIds}
            dragState={dragState}
            showBaseline={gantt.showBaseline}
            externalScrollRef={timelineScrollRef}
            onVerticalScroll={handleTimelineScroll}
            onDragStart={startDrag}
            onContextMenu={gantt.openContextMenu}
            onDependencyCreate={handleTimelineDependencyCreate}
            onDependencyDelete={(depId) => {
              onDependencyDelete(depId);
              toast.success('Dépendance supprimée');
            }}
            onZoom={handleZoom}
          />
          </div>
        </div>

        {/* Context menu */}
        {gantt.contextMenu && contextTask && (
          <GanttContextMenu
            state={gantt.contextMenu}
            task={contextTask}
            onAction={handleContextAction}
            onClose={gantt.closeContextMenu}
            extraItems={extraContextMenuItems}
          />
        )}
      </div>

    </TooltipProvider>
  );
}
