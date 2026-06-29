/**
 * useScheduleData — Supabase data layer for schedule tasks/dependencies.
 * Provides CRUD callbacks that the pure Gantt UI components need.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { GanttTask, GanttDependency } from '../types';

const db = supabase as any;

export function useScheduleData(scheduleId: string) {
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [dependencies, setDependencies] = useState<GanttDependency[]>([]);
  const [loading, setLoading] = useState(true);

  // Load
  useEffect(() => {
    if (!scheduleId) return;
    const load = async () => {
      setLoading(true);
      const [tasksRes, depsRes] = await Promise.all([
        db.from('schedule_tasks').select('*').eq('schedule_id', scheduleId).order('sort_order'),
        db.from('schedule_dependencies').select('*').eq('schedule_id', scheduleId),
      ]);
      setTasks((tasksRes.data || []).map((t: any) => ({
        ...t,
        labor_cost: Number(t.labor_cost) || 0,
        material_cost: Number(t.material_cost) || 0,
        subcontract_cost: Number(t.subcontract_cost) || 0,
      })));
      setDependencies((depsRes.data || []) as GanttDependency[]);
      setLoading(false);
    };
    load();
  }, [scheduleId]);

  const onTaskUpdate = useCallback((taskId: string, updates: Partial<GanttTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    db.from('schedule_tasks').update(updates).eq('id', taskId).then(() => {});
    // Sync dispatch if date changed
    if (updates.start_date) {
      db.from('dispatch_assignments').update({ assignment_date: updates.start_date }).eq('schedule_task_id', taskId).then(() => {});
    }
  }, []);

  const onTaskBatchUpdate = useCallback((updates: Map<string, Partial<GanttTask>>) => {
    setTasks(prev => prev.map(t => {
      const u = updates.get(t.id);
      return u ? { ...t, ...u } : t;
    }));
    for (const [id, u] of updates) {
      db.from('schedule_tasks').update(u).eq('id', id).then(() => {});
    }
  }, []);

  const onTaskCreate = useCallback(async (task: Partial<GanttTask>) => {
    const { data, error } = await db.from('schedule_tasks').insert({
      schedule_id: scheduleId,
      ...task,
    }).select().single();
    if (data && !error) {
      setTasks(prev => [...prev, data as GanttTask]);
    }
  }, [scheduleId]);

  const onTaskDelete = useCallback(async (taskIds: string[]) => {
    for (const id of taskIds) {
      await db.from('schedule_tasks').delete().eq('id', id);
    }
    setTasks(prev => prev.filter(t => !taskIds.includes(t.id)));
    setDependencies(prev => prev.filter(d => !taskIds.includes(d.source_task_id) && !taskIds.includes(d.target_task_id)));
  }, []);

  const onDependencyCreate = useCallback(async (dep: Omit<GanttDependency, 'id' | 'created_at'>) => {
    const { data } = await db.from('schedule_dependencies').insert(dep).select().single();
    if (data) {
      setDependencies(prev => [...prev, data as GanttDependency]);
    }
  }, []);

  const onDependencyDelete = useCallback(async (depId: string) => {
    await db.from('schedule_dependencies').delete().eq('id', depId);
    setDependencies(prev => prev.filter(d => d.id !== depId));
  }, []);

  return {
    tasks, dependencies, loading,
    onTaskUpdate, onTaskBatchUpdate, onTaskCreate, onTaskDelete,
    onDependencyCreate, onDependencyDelete,
  };
}
