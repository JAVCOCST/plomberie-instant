import { useState, useCallback, useRef, useEffect } from 'react';
import type { GanttDragState, GanttTask } from '../types';
import { snapDeltaToDays, moveTask, resizeTaskLeft, resizeTaskRight } from '../engine/schedulingEngine';

interface UseBarDragOptions { dayWidth: number; onDragEnd: (taskId: string, updates: Partial<GanttTask>) => void; }

export function useBarDrag({ dayWidth, onDragEnd }: UseBarDragOptions) {
  const [dragState, setDragState] = useState<GanttDragState | null>(null);
  const dragRef = useRef<GanttDragState | null>(null);

  const startDrag = useCallback((e: React.MouseEvent, task: GanttTask, mode: GanttDragState['mode']) => {
    e.preventDefault(); e.stopPropagation();
    const state: GanttDragState = { taskId: task.id, mode, startX: e.clientX, originalStart: task.start_date, originalEnd: task.end_date, currentStart: task.start_date, currentEnd: task.end_date };
    dragRef.current = state; setDragState(state);
  }, []);

  useEffect(() => {
    if (!dragState) return;
    const handleMouseMove = (e: MouseEvent) => {
      const ref = dragRef.current; if (!ref) return;
      const deltaX = e.clientX - ref.startX;
      const deltaDays = snapDeltaToDays(deltaX, dayWidth);
      if (deltaDays === 0 && ref.currentStart === ref.originalStart) return;
      const fakeTask = { id: ref.taskId, start_date: ref.originalStart, end_date: ref.originalEnd, duration_days: 0 } as GanttTask;
      let patch: Partial<GanttTask> = {};
      switch (ref.mode) { case 'move': patch = moveTask(fakeTask, deltaDays); break; case 'resize-left': patch = resizeTaskLeft(fakeTask, deltaDays); break; case 'resize-right': patch = resizeTaskRight(fakeTask, deltaDays); break; }
      const updated: GanttDragState = { ...ref, currentStart: patch.start_date || ref.originalStart, currentEnd: patch.end_date || ref.originalEnd };
      dragRef.current = updated; setDragState(updated);
    };
    const handleMouseUp = () => {
      const ref = dragRef.current; if (!ref) return;
      if (ref.currentStart !== ref.originalStart || ref.currentEnd !== ref.originalEnd) {
        const updates: Partial<GanttTask> = {};
        if (ref.currentStart !== ref.originalStart) updates.start_date = ref.currentStart;
        if (ref.currentEnd !== ref.originalEnd) updates.end_date = ref.currentEnd;
        onDragEnd(ref.taskId, updates);
      }
      dragRef.current = null; setDragState(null);
    };
    document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, [dragState, dayWidth, onDragEnd]);

  return { dragState, startDrag, isDragging: !!dragState };
}
