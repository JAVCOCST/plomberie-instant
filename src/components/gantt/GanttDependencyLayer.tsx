/**
 * GanttDependencyLayer — SVG overlay rendering dependency arrows between task bars.
 * Uses orthogonal (right-angle) routing with arrowheads and lag day labels.
 */
import React, { memo, useMemo } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import type { GanttDependency, GanttTask } from './types';
import type { FlatRow } from './engine/schedulingEngine';

const BAR_MID_Y_OFFSET = 18;

interface Props {
  rows: FlatRow[];
  dependencies: GanttDependency[];
  viewStart: Date;
  dayWidth: number;
  rowHeight: number;
  onDependencyDelete?: (depId: string) => void;
}

export const GanttDependencyLayer = memo(function GanttDependencyLayer({
  rows,
  dependencies,
  viewStart,
  dayWidth,
  rowHeight,
  onDependencyDelete,
}: Props) {
  const items = useMemo(() => {
    const rowIndex = new Map<string, number>();
    rows.forEach((r, i) => rowIndex.set(r.task.id, i));

    const taskMap = new Map<string, GanttTask>();
    rows.forEach(r => taskMap.set(r.task.id, r.task));

    return dependencies
      .map(dep => {
        const srcIdx = rowIndex.get(dep.source_task_id);
        const tgtIdx = rowIndex.get(dep.target_task_id);
        if (srcIdx == null || tgtIdx == null) return null;

        const src = taskMap.get(dep.source_task_id)!;
        const tgt = taskMap.get(dep.target_task_id)!;

        const srcEndDay = differenceInDays(parseISO(src.end_date), viewStart) + 1;
        const srcStartDay = differenceInDays(parseISO(src.start_date), viewStart);
        const tgtStartDay = differenceInDays(parseISO(tgt.start_date), viewStart);
        const tgtEndDay = differenceInDays(parseISO(tgt.end_date), viewStart) + 1;

        let x1: number, x2: number;
        switch (dep.dependency_type) {
          case 'FS': x1 = srcEndDay * dayWidth; x2 = tgtStartDay * dayWidth; break;
          case 'SS': x1 = srcStartDay * dayWidth; x2 = tgtStartDay * dayWidth; break;
          case 'FF': x1 = srcEndDay * dayWidth; x2 = tgtEndDay * dayWidth; break;
          case 'SF': x1 = srcStartDay * dayWidth; x2 = tgtEndDay * dayWidth; break;
          default:   x1 = srcEndDay * dayWidth; x2 = tgtStartDay * dayWidth;
        }

        const y1 = srcIdx * rowHeight + BAR_MID_Y_OFFSET;
        const y2 = tgtIdx * rowHeight + BAR_MID_Y_OFFSET;

        // Orthogonal path with 4 corners (5 segments):
        // Horizontal out from source → down/up to midY → horizontal to target X → down/up to target Y → horizontal into target
        const exitGap = 10;
        const entryGap = 10;
        const outX = x1 + exitGap;
        const inX = x2 - entryGap;
        const midY = y1 + (y2 - y1) / 2;

        const d = [
          `M ${x1} ${y1}`,       // start at source
          `L ${outX} ${y1}`,     // horizontal out
          `L ${outX} ${midY}`,   // vertical to midpoint Y
          `L ${inX} ${midY}`,    // horizontal across
          `L ${inX} ${y2}`,      // vertical to target Y
          `L ${x2} ${y2}`,       // horizontal into target
        ].join(' ');

        const labelX = (outX + inX) / 2;
        const labelY = midY;

        return { d, id: dep.id, lagDays: dep.lag_days, depType: dep.dependency_type, x1, y1, x2, y2, labelX, labelY };
      })
      .filter(Boolean) as Array<{
        d: string; id: string; lagDays: number; depType: string;
        x1: number; y1: number; x2: number; y2: number;
        labelX: number; labelY: number;
      }>;
  }, [rows, dependencies, viewStart, dayWidth, rowHeight]);

  if (items.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 z-10 pointer-events-none"
      style={{ width: '100%', height: rows.length * rowHeight }}
    >
      <defs>
        {/* Forward arrowhead (at target end) */}
        <marker id="gantt-arrow-end" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
          <path d="M 0 0 L 6 2.5 L 0 5 Z" fill="#9ca3af" />
        </marker>
        {/* Backward arrowhead (at source end) */}
        <marker id="gantt-arrow-start" markerWidth="6" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse">
          <path d="M 6 0 L 0 2.5 L 6 5 Z" fill="#9ca3af" />
        </marker>
      </defs>
      {items.map(p => (
        <g key={p.id} className="group/dep" style={{ pointerEvents: 'auto' }}>
          {/* Invisible wider hit area for easier clicking */}
          <path
            d={p.d}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onDependencyDelete?.(p.id); }}
          />
          {/* Main orthogonal arrow — gray with arrowheads on both ends */}
          <path
            d={p.d}
            fill="none"
            stroke="#9ca3af"
            strokeWidth={1.5}
            markerStart="url(#gantt-arrow-start)"
            markerEnd="url(#gantt-arrow-end)"
            className="hover:stroke-destructive transition-colors"
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onDependencyDelete?.(p.id); }}
          />
          {/* Lag days label */}
          {p.lagDays !== 0 && (
            <>
              <rect
                x={p.labelX - 12} y={p.labelY - 8}
                width={24} height={16} rx={4}
                fill="hsl(var(--background))" stroke="#d1d5db" strokeWidth={1}
              />
              <text x={p.labelX} y={p.labelY + 4} textAnchor="middle" fill="#6b7280" fontSize={9} fontWeight={500}>
                {p.lagDays > 0 ? `+${p.lagDays}j` : `${p.lagDays}j`}
              </text>
            </>
          )}
          {/* Type badge */}
          <rect
            x={p.labelX - 8 + (p.lagDays !== 0 ? 18 : 0)}
            y={p.labelY - 7} width={16} height={14} rx={3}
            fill="hsl(var(--muted))" stroke="#d1d5db" strokeWidth={0.5}
          />
          <text
            x={p.labelX + (p.lagDays !== 0 ? 18 : 0)}
            y={p.labelY + 3} textAnchor="middle" fill="#9ca3af" fontSize={7} fontWeight={700}
          >
            {p.depType}
          </text>
        </g>
      ))}
    </svg>
  );
});
