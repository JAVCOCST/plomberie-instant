/**
 * GanttTimeline — right-side timeline with header, today line, weekend shading, and task bars.
 * Now supports visual dependency creation via link anchor clicks and temporary link line.
 */
import React, { memo, useMemo, useRef, useState, useCallback } from 'react';
import { format, isWeekend, isToday, differenceInDays, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { GanttBar } from './GanttBar';
import { GanttDependencyLayer } from './GanttDependencyLayer';
import type { GanttTask, GanttDependency, GanttDragState, ViewMode, DependencyType } from './types';
import type { FlatRow } from './engine/schedulingEngine';

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 44;

export interface LinkAnchor {
  taskId: string;
  anchor: 'start' | 'end';
  x: number;
  y: number;
}

interface GanttTimelineProps {
  rows: FlatRow[];
  dependencies: GanttDependency[];
  visibleDays: Date[];
  dayWidth: number;
  viewMode: ViewMode;
  viewStart: Date;
  selectedIds: Set<string>;
  criticalTaskIds: Set<string>;
  dragState: GanttDragState | null;
  showBaseline: boolean;
  externalScrollRef?: React.RefObject<HTMLDivElement>;
  onVerticalScroll?: (scrollTop: number) => void;
  onDragStart: (e: React.MouseEvent, task: GanttTask, mode: GanttDragState['mode']) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string) => void;
  onDependencyCreate: (sourceTaskId: string, targetTaskId: string, depType: DependencyType) => string | null;
  onDependencyDelete: (depId: string) => void;
  onZoom?: (direction: 'in' | 'out') => void;
}

export const GanttTimeline = memo(function GanttTimeline({
  rows,
  dependencies,
  visibleDays,
  dayWidth,
  viewMode,
  viewStart,
  selectedIds,
  criticalTaskIds,
  dragState,
  showBaseline,
  externalScrollRef,
  onVerticalScroll,
  onDragStart,
  onContextMenu,
  onDependencyCreate,
  onDependencyDelete,
  onZoom,
}: GanttTimelineProps) {
  const totalWidth = visibleDays.length * dayWidth;
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef || internalScrollRef;
  const bodyRef = useRef<HTMLDivElement>(null);

  // ── Link creation state ──
  const [linkingFrom, setLinkingFrom] = useState<LinkAnchor | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const handleLinkAnchorClick = useCallback((taskId: string, anchor: 'start' | 'end', screenX: number, screenY: number) => {
    if (!linkingFrom) {
      // Start linking
      setLinkingFrom({ taskId, anchor, x: screenX, y: screenY });
    } else {
      // Complete the link
      if (linkingFrom.taskId === taskId) {
        setLinkingFrom(null);
        setMousePos(null);
        return;
      }

      // Determine dep type from anchors
      let depType: DependencyType = 'FS';
      if (linkingFrom.anchor === 'end' && anchor === 'start') depType = 'FS';
      else if (linkingFrom.anchor === 'start' && anchor === 'start') depType = 'SS';
      else if (linkingFrom.anchor === 'end' && anchor === 'end') depType = 'FF';
      else if (linkingFrom.anchor === 'start' && anchor === 'end') depType = 'SF';

      const err = onDependencyCreate(linkingFrom.taskId, taskId, depType);
      setLinkingFrom(null);
      setMousePos(null);
    }
  }, [linkingFrom, onDependencyCreate]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (linkingFrom && bodyRef.current) {
      const rect = bodyRef.current.getBoundingClientRect();
      setMousePos({ x: e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0), y: e.clientY - rect.top + (scrollRef.current?.scrollTop || 0) });
    }
  }, [linkingFrom]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onZoom?.(e.deltaY < 0 ? 'in' : 'out');
    }
  }, [onZoom]);

  const handleBackgroundClick = useCallback(() => {
    if (linkingFrom) {
      setLinkingFrom(null);
      setMousePos(null);
    }
  }, [linkingFrom]);

  // Compute source dot position in SVG coords for the temp link line
  const linkSourcePos = useMemo(() => {
    if (!linkingFrom) return null;
    const rowIdx = rows.findIndex(r => r.task.id === linkingFrom.taskId);
    if (rowIdx < 0) return null;
    const task = rows[rowIdx].task;
    const startDay = differenceInDays(parseISO(task.start_date), viewStart);
    const endDay = differenceInDays(parseISO(task.end_date), viewStart) + 1;
    const x = linkingFrom.anchor === 'start' ? startDay * dayWidth : endDay * dayWidth;
    const y = rowIdx * ROW_HEIGHT + 18;
    return { x, y };
  }, [linkingFrom, rows, viewStart, dayWidth]);

  // ── Header ticks ──
  const headerGroups = useMemo(() => {
    if (viewMode === 'day' || viewMode === 'week') {
      const months: Array<{ label: string; span: number }> = [];
      let current = '';
      for (const d of visibleDays) {
        const label = format(d, 'MMMM yyyy', { locale: fr });
        if (label !== current) {
          months.push({ label, span: 1 });
          current = label;
        } else {
          months[months.length - 1].span++;
        }
      }
      return months;
    }
    const quarters: Array<{ label: string; span: number }> = [];
    let current = '';
    for (const d of visibleDays) {
      const q = `T${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
      if (q !== current) {
        quarters.push({ label: q, span: 1 });
        current = q;
      } else {
        quarters[quarters.length - 1].span++;
      }
    }
    return quarters;
  }, [visibleDays, viewMode]);

  const todayIndex = useMemo(
    () => visibleDays.findIndex(d => isToday(d)),
    [visibleDays],
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden" onWheel={handleWheel}>
      {/* Sticky header */}
      <div className="shrink-0 border-b bg-muted/50 overflow-hidden" style={{ height: HEADER_HEIGHT }}>
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          <div className="flex h-5">
            {headerGroups.map((g, i) => (
              <div
                key={i}
                className="text-[10px] font-medium text-muted-foreground border-r border-border/60 px-1 capitalize truncate"
                style={{ width: g.span * dayWidth }}
              >
                {g.label}
              </div>
            ))}
          </div>
          <div className="flex" style={{ height: HEADER_HEIGHT - 20 }}>
            {visibleDays.map((d, i) => {
              const weekend = isWeekend(d);
              const today = isToday(d);
              let label = '';
              if (viewMode === 'day') label = format(d, 'dd EEE', { locale: fr });
              else if (viewMode === 'week') label = format(d, 'dd', { locale: fr });
              else if (d.getDate() === 1) label = format(d, 'MMM', { locale: fr });
              return (
                <div
                  key={i}
                  className={cn(
                    'text-[9px] text-center border-r border-border/40 flex items-center justify-center',
                    weekend && 'text-muted-foreground/50',
                    today && 'font-bold text-primary',
                  )}
                  style={{ width: dayWidth }}
                >
                  {label}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Linking indicator banner */}
      {linkingFrom && (
        <div className="shrink-0 bg-primary/10 border-b border-primary/30 px-3 py-1 flex items-center gap-2 text-xs text-primary">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span>Cliquez sur le point d'une autre tâche pour créer la dépendance</span>
          <button
            className="ml-auto text-primary/60 hover:text-primary underline"
            onClick={() => { setLinkingFrom(null); setMousePos(null); }}
          >
            Annuler
          </button>
        </div>
      )}

      {/* Scrollable body */}
      <div
        ref={scrollRef}
        className={cn('flex-1 overflow-scroll relative scrollbar-none', linkingFrom && 'cursor-crosshair')}
        style={{ scrollbarWidth: 'none' }}
        onMouseMove={handleMouseMove}
        onClick={handleBackgroundClick}
        onScroll={onVerticalScroll ? (e) => onVerticalScroll((e.target as HTMLDivElement).scrollTop) : undefined}
      >
        <div
          ref={bodyRef}
          className="relative"
          style={{ width: totalWidth, height: rows.length * ROW_HEIGHT + 200, minWidth: '100%' }}
        >
          {/* Weekend shading */}
          {visibleDays.map((d, i) => {
            if (!isWeekend(d)) return null;
            return (
              <div
                key={`w-${i}`}
                className="absolute top-0 bottom-0 bg-muted/60"
                style={{ left: i * dayWidth, width: dayWidth }}
              />
            );
          })}

          {/* Today line */}
          {todayIndex >= 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-destructive/60 z-20"
              style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
            />
          )}

          {/* Row backgrounds */}
          {rows.map((_, i) => (
            <div
              key={`row-${i}`}
              className="absolute left-0 right-0 border-b border-border/40"
              style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
            />
          ))}

          {/* Dependency arrows SVG */}
          <GanttDependencyLayer
            rows={rows}
            dependencies={dependencies}
            viewStart={viewStart}
            dayWidth={dayWidth}
            rowHeight={ROW_HEIGHT}
            onDependencyDelete={onDependencyDelete}
          />

          {/* Temporary link line while creating dependency */}
          {linkSourcePos && mousePos && (
            <svg className="absolute inset-0 pointer-events-none z-30" style={{ width: '100%', height: rows.length * ROW_HEIGHT }}>
              <line
                x1={linkSourcePos.x}
                y1={linkSourcePos.y}
                x2={mousePos.x}
                y2={mousePos.y}
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                strokeDasharray="6 3"
                opacity={0.7}
              />
              <circle cx={linkSourcePos.x} cy={linkSourcePos.y} r={4} fill="hsl(var(--primary))" />
              <circle cx={mousePos.x} cy={mousePos.y} r={3} fill="hsl(var(--primary))" opacity={0.5} />
            </svg>
          )}

          {/* Task bars */}
          {rows.map(({ task }, i) => (
            <div
              key={task.id}
              className="absolute left-0 right-0"
              style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
              onContextMenu={(e) => onContextMenu(e, task.id)}
            >
              <GanttBar
                task={task}
                viewStart={viewStart}
                dayWidth={dayWidth}
                isCritical={criticalTaskIds.has(task.id)}
                isSelected={selectedIds.has(task.id)}
                dragState={dragState}
                showBaseline={showBaseline}
                linkingFrom={linkingFrom}
                onDragStart={onDragStart}
                onLinkAnchorClick={handleLinkAnchorClick}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
