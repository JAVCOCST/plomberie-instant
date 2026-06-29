import type { GanttTask, GanttDependency } from '../types';

export function computeCriticalPath(tasks: GanttTask[], dependencies: GanttDependency[]): Set<string> {
  if (tasks.length === 0) return new Set();
  const nodes = new Map<string, { id: string; duration: number; es: number; ef: number; ls: number; lf: number; slack: number; isCritical: boolean }>();
  for (const t of tasks) { if (t.type === 'group') continue; nodes.set(t.id, { id: t.id, duration: t.duration_days, es: 0, ef: 0, ls: Infinity, lf: Infinity, slack: Infinity, isCritical: false }); }
  const successors = new Map<string, Array<{ id: string; lag: number }>>(), predecessors = new Map<string, Array<{ id: string; lag: number }>>();
  for (const d of dependencies) { if (!nodes.has(d.source_task_id) || !nodes.has(d.target_task_id) || d.dependency_type !== 'FS') continue;
    if (!successors.has(d.source_task_id)) successors.set(d.source_task_id, []); successors.get(d.source_task_id)!.push({ id: d.target_task_id, lag: d.lag_days });
    if (!predecessors.has(d.target_task_id)) predecessors.set(d.target_task_id, []); predecessors.get(d.target_task_id)!.push({ id: d.source_task_id, lag: d.lag_days });
  }
  const inDegree = new Map<string, number>(); for (const id of nodes.keys()) inDegree.set(id, 0);
  for (const [, succs] of successors) { for (const s of succs) inDegree.set(s.id, (inDegree.get(s.id) || 0) + 1); }
  const queue: string[] = []; for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }
  const topoOrder: string[] = [];
  while (queue.length > 0) { const id = queue.shift()!; topoOrder.push(id); for (const s of successors.get(id) || []) { const nd = (inDegree.get(s.id) || 1) - 1; inDegree.set(s.id, nd); if (nd === 0) queue.push(s.id); } }
  for (const id of topoOrder) { const node = nodes.get(id)!; const preds = predecessors.get(id) || []; if (preds.length > 0) node.es = Math.max(...preds.map(p => nodes.get(p.id)!.ef + p.lag)); node.ef = node.es + node.duration; }
  const projectEnd = Math.max(...[...nodes.values()].map(n => n.ef));
  for (let i = topoOrder.length - 1; i >= 0; i--) { const id = topoOrder[i]; const node = nodes.get(id)!; const succs = successors.get(id) || [];
    if (succs.length === 0) node.lf = projectEnd; else node.lf = Math.min(...succs.map(s => nodes.get(s.id)!.ls - s.lag));
    node.ls = node.lf - node.duration; node.slack = node.ls - node.es; node.isCritical = node.slack === 0;
  }
  const criticalIds = new Set<string>(); for (const [id, node] of nodes) { if (node.isCritical) criticalIds.add(id); }
  return criticalIds;
}
