/**
 * GanttBar — individual task bar rendered in the timeline panel.
 * Supports drag-move, resize handles, progress fill, milestone diamond, baseline ghost.
 * Now includes link connector dots for visual dependency creation.
 */
import React, { memo } from 'react';
import { differenceInDays, parseISO, format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { GanttTask, GanttDragState, TaskStatus } from './types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PROJECT_STATUSES } from '@/lib/project-statuses';

interface GanttBarProps {
  task: GanttTask;
  viewStart: Date;
  dayWidth: number;
  isCritical: boolean;
  isSelected: boolean;
  dragState: GanttDragState | null;
  showBaseline: boolean;
  linkingFrom: { taskId: string; anchor: 'start' | 'end' } | null;
  onDragStart: (e: React.MouseEvent, task: GanttTask, mode: GanttDragState['mode']) => void;
  onLinkAnchorClick: (taskId: string, anchor: 'start' | 'end', x: number, y: number) => void;
}

const STATUS_BAR_COLORS: Record<TaskStatus, string> = PROJECT_STATUSES.reduce(
  (acc, s) => { acc[s.value] = s.barClass; return acc; },
  {} as Record<TaskStatus, string>,
);

export const GanttBar = memo(function GanttBar({
  task,
  viewStart,
  dayWidth,
  isCritical,
  isSelected,
  dragState,
  showBaseline,
  linkingFrom,
  onDragStart,
  onLinkAnchorClick,
}: GanttBarProps) {
  const isDragging = dragState?.taskId === task.id;
  const startDate = isDragging ? dragState!.currentStart : task.start_date;
  const endDate = isDragging ? dragState!.currentEnd : task.end_date;

  const startOffset = differenceInDays(parseISO(startDate), viewStart);
  const duration = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
  const left = startOffset * dayWidth;
  const width = Math.max(duration * dayWidth - 2, 8);

  if (left + width < 0) return null;

  const isMilestone = task.type === 'milestone';
  const isLinkSource = linkingFrom?.taskId === task.id;
  const isLinkTarget = linkingFrom && linkingFrom.taskId !== task.id;

  // ── Baseline bar ──
  let baselineBar = null;
  if (showBaseline && task.baseline_start_date && task.baseline_end_date) {
    const bStart = differenceInDays(parseISO(task.baseline_start_date), viewStart);
    const bDur = differenceInDays(parseISO(task.baseline_end_date), parseISO(task.baseline_start_date)) + 1;
    baselineBar = (
      <div
        className="absolute h-2 bg-muted-foreground/25 rounded-sm"
        style={{ left: bStart * dayWidth, width: Math.max(bDur * dayWidth - 2, 4), top: 28 }}
      />
    );
  }

  const handleAnchorClick = (e: React.MouseEvent, anchor: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    onLinkAnchorClick(task.id, anchor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  // Link connector dot component
  const ConnectorDot = ({ side }: { side: 'start' | 'end' }) => (
    <div
      className={cn(
        'absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 z-30 transition-all cursor-crosshair',
        'opacity-0 group-hover:opacity-100',
        isLinkSource && side === linkingFrom?.anchor && 'opacity-100 bg-primary border-primary scale-125',
        isLinkTarget && 'opacity-100 bg-primary/60 border-primary animate-pulse',
        !isLinkSource && !isLinkTarget && 'bg-background border-muted-foreground/60 hover:bg-primary hover:border-primary hover:scale-125',
      )}
      style={side === 'start' ? { left: -6 } : { right: -6 }}
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        handleAnchorClick(e, side);
      }}
    />
  );

  if (isMilestone) {
    return (
      <div className="absolute group" style={{ left: left + dayWidth / 2 - 8, top: 8 }}>
        {baselineBar}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'w-4 h-4 rotate-45 border-2 cursor-pointer transition-shadow relative',
                isCritical ? 'bg-destructive border-destructive' : 'bg-amber-500 border-amber-600',
                isSelected && 'ring-2 ring-primary ring-offset-1',
                isLinkTarget && 'ring-2 ring-primary animate-pulse',
              )}
              onMouseDown={(e) => {
                if (linkingFrom) {
                  e.stopPropagation();
                  handleAnchorClick(e, 'start');
                }
              }}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="font-medium">{task.title}</div>
            <div>{format(parseISO(startDate), 'dd MMM yyyy')}</div>
          </TooltipContent>
        </Tooltip>
        {/* Connector dot for milestones */}
        <div
          className={cn(
            'absolute -right-2 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 z-30 transition-all cursor-crosshair',
            'opacity-0 group-hover:opacity-100',
            isLinkTarget && 'opacity-100 bg-primary/60 border-primary animate-pulse',
            !isLinkTarget && 'bg-background border-muted-foreground/60 hover:bg-primary hover:border-primary',
          )}
          onMouseDown={(e) => {
            e.stopPropagation();
            handleAnchorClick(e, 'end');
          }}
        />
      </div>
    );
  }

  const barColor = task.color
    ? undefined
    : STATUS_BAR_COLORS[task.status as TaskStatus] || 'bg-blue-500';

  return (
    <div className="absolute" style={{ left, top: 4, width }}>
      {baselineBar}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'relative h-7 rounded-md cursor-grab group transition-shadow',
              barColor,
              task.status === 'new' && 'opacity-40',
              isCritical && 'ring-2 ring-destructive/60',
              isSelected && 'ring-2 ring-primary ring-offset-1',
              isDragging && 'opacity-80 shadow-lg cursor-grabbing',
              isLinkTarget && 'ring-2 ring-primary/60',
            )}
            style={task.color ? { backgroundColor: task.color } : undefined}
            onMouseDown={(e) => {
              if (linkingFrom) {
                // Clicking on a bar while linking → connect to start
                e.stopPropagation();
                handleAnchorClick(e, 'start');
                return;
              }
              onDragStart(e, task, 'move');
            }}
          >
            {/* Progress fill */}
            {task.progress > 0 && (
              <div
                className="absolute inset-y-0 left-0 rounded-l-md bg-white/25"
                style={{ width: `${Math.min(task.progress, 100)}%` }}
              />
            )}

            {/* Title */}
            <span className="absolute inset-0 flex items-center px-2 text-[11px] text-white font-medium truncate select-none pointer-events-none">
              {task.title}
            </span>

            {/* Resize handle LEFT */}
            <div
              className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize opacity-0 group-hover:opacity-100 hover:bg-white/30 rounded-l-md"
              onMouseDown={(e) => {
                if (linkingFrom) return;
                onDragStart(e, task, 'resize-left');
              }}
            />

            {/* Resize handle RIGHT */}
            <div
              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize opacity-0 group-hover:opacity-100 hover:bg-white/30 rounded-r-md"
              onMouseDown={(e) => {
                if (linkingFrom) return;
                onDragStart(e, task, 'resize-right');
              }}
            />

            {/* Link connector dots */}
            <ConnectorDot side="start" />
            <ConnectorDot side="end" />
          </div>
        </TooltipTrigger>
        {/* Always-visible project name label to the right of the bar */}
        <span
          className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-[11px] font-medium text-foreground/80 whitespace-nowrap pointer-events-none select-none"
        >
          {task.title}
        </span>
        <TooltipContent side="top" className="text-xs space-y-0.5">
          <div className="font-medium">{task.title}</div>
          <div>{format(parseISO(startDate), 'dd MMM yyyy')} → {format(parseISO(endDate), 'dd MMM yyyy')}</div>
          <div>Dur: {task.duration_days}j · Prog: {task.progress}%</div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
});
