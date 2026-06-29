import { addDays, parseISO, format } from 'date-fns';
import type { GanttTask, GanttDependency, DependencyType } from '../types';

export function detectCycle(dependencies: GanttDependency[], newDep?: { source_task_id: string; target_task_id: string }): boolean {
  const adj = new Map<string, string[]>();
  for (const d of dependencies) { if (!adj.has(d.source_task_id)) adj.set(d.source_task_id, []); adj.get(d.source_task_id)!.push(d.target_task_id); }
  if (newDep) { if (!adj.has(newDep.source_task_id)) adj.set(newDep.source_task_id, []); adj.get(newDep.source_task_id)!.push(newDep.target_task_id); }
  const visited = new Set<string>(), stack = new Set<string>();
  const dfs = (node: string): boolean => { if (stack.has(node)) return true; if (visited.has(node)) return false; visited.add(node); stack.add(node); for (const n of adj.get(node) || []) { if (dfs(n)) return true; } stack.delete(node); return false; };
  for (const node of new Set([...adj.keys(), ...[...adj.values()].flat()])) { if (dfs(node)) return true; }
  return false;
}

function computeConstrainedDate(source: GanttTask, depType: DependencyType, lagDays: number): Date {
  const srcStart = parseISO(source.start_date), srcEnd = parseISO(source.end_date);
  switch (depType) { case 'FS': return addDays(srcEnd, 1 + lagDays); case 'SS': return addDays(srcStart, lagDays); case 'FF': return addDays(srcEnd, lagDays); case 'SF': return addDays(srcStart, 1 + lagDays); default: return addDays(srcEnd, 1 + lagDays); }
}

export function cascadeRecalc(tasks: GanttTask[], dependencies: GanttDependency[], changedTaskId: string): Map<string, Partial<GanttTask>> {
  const updates = new Map<string, Partial<GanttTask>>();
  const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));
  const adj = new Map<string, Array<{ targetId: string; type: DependencyType; lag: number }>>();
  for (const d of dependencies) { if (!adj.has(d.source_task_id)) adj.set(d.source_task_id, []); adj.get(d.source_task_id)!.push({ targetId: d.target_task_id, type: d.dependency_type, lag: d.lag_days }); }
  const queue = [changedTaskId]; const visited = new Set<string>();
  while (queue.length > 0) { const current = queue.shift()!; if (visited.has(current)) continue; visited.add(current);
    for (const { targetId, type, lag } of adj.get(current) || []) { const source = taskMap.get(current), target = taskMap.get(targetId); if (!source || !target) continue;
      const cd = computeConstrainedDate(source, type, lag); const cs = format(cd, 'yyyy-MM-dd');
      if (cs !== target.start_date) { const patch: Partial<GanttTask> = { start_date: cs, end_date: format(addDays(cd, Math.max(target.duration_days - 1, 0)), 'yyyy-MM-dd') }; updates.set(targetId, patch); taskMap.set(targetId, { ...target, ...patch }); queue.push(targetId); }
    }
  }
  return updates;
}

export function validateDependency(sourcId: string, targetId: string, dependencies: GanttDependency[]): { valid: boolean; reason?: string } {
  if (sourcId === targetId) return { valid: false, reason: "Une tâche ne peut pas dépendre d'elle-même." };
  if (dependencies.some(d => d.source_task_id === sourcId && d.target_task_id === targetId)) return { valid: false, reason: 'Cette dépendance existe déjà.' };
  if (detectCycle(dependencies, { source_task_id: sourcId, target_task_id: targetId })) return { valid: false, reason: 'Cela créerait un cycle de dépendances.' };
  return { valid: true };
}
