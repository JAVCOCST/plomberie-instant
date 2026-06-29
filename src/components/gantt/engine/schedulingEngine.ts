import { addDays, differenceInDays, format, parseISO } from 'date-fns';
import type { GanttTask } from '../types';

export function recalcEndDate(startDate: string, durationDays: number): string {
  return format(addDays(parseISO(startDate), Math.max(durationDays - 1, 0)), 'yyyy-MM-dd');
}
export function recalcDuration(startDate: string, endDate: string): number {
  return Math.max(1, differenceInDays(parseISO(endDate), parseISO(startDate)) + 1);
}
export function moveTask(task: GanttTask, deltaDays: number): Partial<GanttTask> {
  return { start_date: format(addDays(parseISO(task.start_date), deltaDays), 'yyyy-MM-dd'), end_date: format(addDays(parseISO(task.end_date), deltaDays), 'yyyy-MM-dd') };
}
export function resizeTaskLeft(task: GanttTask, deltaDays: number): Partial<GanttTask> {
  const newStart = format(addDays(parseISO(task.start_date), deltaDays), 'yyyy-MM-dd');
  const newDuration = recalcDuration(newStart, task.end_date);
  if (newDuration < 1) return {};
  return { start_date: newStart, duration_days: newDuration };
}
export function resizeTaskRight(task: GanttTask, deltaDays: number): Partial<GanttTask> {
  const newEnd = format(addDays(parseISO(task.end_date), deltaDays), 'yyyy-MM-dd');
  const newDuration = recalcDuration(task.start_date, newEnd);
  if (newDuration < 1) return {};
  return { end_date: newEnd, duration_days: newDuration };
}
export function snapDeltaToDays(deltaX: number, dayWidth: number): number {
  return Math.round(deltaX / dayWidth);
}
export function rollUpGroupDates(_group: GanttTask, children: GanttTask[]): Partial<GanttTask> {
  if (children.length === 0) return {};
  const starts = children.map(c => parseISO(c.start_date));
  const ends = children.map(c => parseISO(c.end_date));
  const earliest = new Date(Math.min(...starts.map(d => d.getTime())));
  const latest = new Date(Math.max(...ends.map(d => d.getTime())));
  const totalProgress = children.reduce((s, c) => s + c.progress * c.duration_days, 0) / Math.max(children.reduce((s, c) => s + c.duration_days, 0), 1);
  return { start_date: format(earliest, 'yyyy-MM-dd'), end_date: format(latest, 'yyyy-MM-dd'), duration_days: recalcDuration(format(earliest, 'yyyy-MM-dd'), format(latest, 'yyyy-MM-dd')), progress: Math.round(totalProgress) };
}

export interface FlatRow { task: GanttTask; level: number; }
export function flattenTasks(tasks: GanttTask[], collapsedIds: Set<string>): FlatRow[] {
  const childrenMap = new Map<string | null, GanttTask[]>();
  for (const t of tasks) {
    if (t.is_hidden) continue;
    const pid = t.parent_id ?? null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid)!.push(t);
  }
  for (const arr of childrenMap.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
  const result: FlatRow[] = [];
  const walk = (parentId: string | null, level: number) => {
    for (const child of childrenMap.get(parentId) || []) {
      result.push({ task: child, level });
      if (!collapsedIds.has(child.id)) walk(child.id, level + 1);
    }
  };
  walk(null, 0);
  return result;
}
