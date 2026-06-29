/**
 * AdminProjects — Single unified Gantt chart.
 * Uses one default schedule. Users add tasks/phases freely.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScheduleGanttViewV2 } from '@/components/gantt';
import type { GanttTask, GanttDependency } from '@/components/gantt/types';
import { FolderKanban, Loader2 } from 'lucide-react';
import { GANTT_STATUSES } from '@/lib/project-statuses';
import { format, addDays } from 'date-fns';
import { toast } from 'sonner';

const db = supabase as any;

const DEFAULT_PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const C = {
  cardBorder: 'hsl(230,20%,16%)',
  text: '#e5e7eb',
  textMuted: 'hsl(230,10%,45%)',
  accent: 'hsl(250,80%,75%)',
  headerBg: 'hsl(230,22%,7%)',
} as const;

const AdminProjects: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [dependencies, setDependencies] = useState<GanttDependency[]>([]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);

      // Get or create the single default schedule
      let { data: schedules } = await db.from('schedules').select('id').eq('project_id', DEFAULT_PROJECT_ID).limit(1);

      let sid: string;
      if (schedules && schedules.length > 0) {
        sid = schedules[0].id;
      } else {
        const { data: created } = await db.from('schedules').insert({
          project_id: DEFAULT_PROJECT_ID,
          name: 'Cédule principale',
        }).select('id').single();
        sid = created?.id;
      }

      if (!sid) { setLoading(false); return; }
      setScheduleId(sid);

      const [tasksRes, depsRes] = await Promise.all([
        db.from('schedule_tasks').select('*').eq('schedule_id', sid).order('sort_order'),
        db.from('schedule_dependencies').select('*').eq('schedule_id', sid),
      ]);

      let allTasks: any[] = tasksRes.data || [];

      // ── Auto-sync: soumissions in GANTT_STATUSES without a schedule_task ──
      const { data: gantSoums } = await db
        .from('soumissions')
        .select('id, first_name, last_name, formatted_address, status, desired_install_date, created_at')
        .in('status', GANTT_STATUSES);

      const linkedSoumIds = new Set(
        allTasks.filter((t) => t.soumission_id).map((t) => t.soumission_id),
      );
      const missing = (gantSoums || []).filter((s: any) => !linkedSoumIds.has(s.id));

      if (missing.length > 0) {
        const today = new Date();
        const rows = missing.map((s: any, idx: number) => {
          const start = s.desired_install_date
            ? s.desired_install_date
            : format(today, 'yyyy-MM-dd');
          const end = s.desired_install_date
            ? s.desired_install_date
            : format(addDays(today, 2), 'yyyy-MM-dd');
          const fullName = [s.first_name, s.last_name].filter(Boolean).join(' ').trim();
          return {
            schedule_id: sid,
            soumission_id: s.id,
            type: 'item',
            title: fullName || s.formatted_address || 'Projet sans nom',
            description: s.formatted_address || null,
            start_date: start,
            end_date: end,
            duration_days: Math.max(1, Math.ceil((+new Date(end) - +new Date(start)) / 86400000) || 1),
            status: s.status,
            sort_order: (allTasks.length + idx) * 10,
          };
        });
        const { data: created } = await db.from('schedule_tasks').insert(rows).select();
        if (created) allTasks = [...allTasks, ...created];
      }

      setTasks(allTasks.map((t: any) => ({
        ...t,
        labor_cost: Number(t.labor_cost) || 0,
        material_cost: Number(t.material_cost) || 0,
        subcontract_cost: Number(t.subcontract_cost) || 0,
      })));
      setDependencies(depsRes.data || []);
      setLoading(false);
    };
    init();
  }, []);

  const onTaskUpdate = useCallback(async (taskId: string, updates: Partial<GanttTask>) => {
    // Snapshot previous state for rollback if the write fails. Without this the
    // UI shows the new value but the DB never persisted it — exactly the kind of
    // silent divergence the user was hitting between Gantt, soumissions list and
    // Dispatch ("le statut change pas partout").
    let previous: GanttTask | undefined;
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      previous = t;
      return { ...t, ...updates };
    }));
    const { error } = await db.from('schedule_tasks').update(updates).eq('id', taskId);
    if (error) {
      toast.error(`Mise à jour échouée: ${error.message}`);
      if (previous) setTasks(prev => prev.map(t => t.id === taskId ? previous! : t));
      return;
    }
    if (updates.start_date) {
      const { error: assignErr } = await db.from('dispatch_assignments').update({ assignment_date: updates.start_date }).eq('schedule_task_id', taskId);
      if (assignErr) toast.error(`Affectations non synchronisées: ${assignErr.message}`);
    }
  }, []);

  const onTaskBatchUpdate = useCallback(async (updates: Map<string, Partial<GanttTask>>) => {
    const snapshot = new Map<string, GanttTask>();
    setTasks(prev => prev.map(t => {
      const u = updates.get(t.id);
      if (!u) return t;
      snapshot.set(t.id, t);
      return { ...t, ...u };
    }));
    const results = await Promise.all(
      Array.from(updates.entries()).map(([id, u]) =>
        db.from('schedule_tasks').update(u).eq('id', id).then((r: any) => ({ id, error: r.error }))
      )
    );
    const failed = results.filter(r => r.error);
    if (failed.length) {
      toast.error(`${failed.length} mise${failed.length > 1 ? 's' : ''} à jour échouée${failed.length > 1 ? 's' : ''}`);
      const failedIds = new Set(failed.map(r => r.id));
      setTasks(prev => prev.map(t => failedIds.has(t.id) && snapshot.has(t.id) ? snapshot.get(t.id)! : t));
    }
  }, []);

  const onTaskCreate = useCallback(async (task: Partial<GanttTask>) => {
    if (!scheduleId) return;
    const { data, error } = await db.from('schedule_tasks').insert({
      ...task,
      schedule_id: scheduleId,
    }).select().single();
    if (data && !error) {
      setTasks(prev => [...prev, {
        ...data,
        labor_cost: Number(data.labor_cost) || 0,
        material_cost: Number(data.material_cost) || 0,
        subcontract_cost: Number(data.subcontract_cost) || 0,
      } as GanttTask]);
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
    if (!scheduleId) return;
    const { data } = await db.from('schedule_dependencies').insert({
      ...dep,
      schedule_id: scheduleId,
    }).select().single();
    if (data) setDependencies(prev => [...prev, data as GanttDependency]);
  }, [scheduleId]);

  const onDependencyDelete = useCallback(async (depId: string) => {
    await db.from('schedule_dependencies').delete().eq('id', depId);
    setDependencies(prev => prev.filter(d => d.id !== depId));
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 overscroll-contain">
      <div
        className="flex items-center gap-2 px-3 py-2.5 shrink-0"
        style={{ borderBottom: `1px solid ${C.cardBorder}`, background: C.headerBg }}
      >
        <FolderKanban className="h-4 w-4 shrink-0" style={{ color: C.accent }} />
        <h2 className="text-sm font-semibold" style={{ color: C.text }}>Projets — Vue Gantt</h2>
      </div>

      <div className="flex-1 overflow-hidden p-1 sm:p-2">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: C.textMuted }} />
          </div>
        ) : scheduleId ? (
          <ScheduleGanttViewV2
            scheduleId={scheduleId}
            tasks={tasks}
            dependencies={dependencies}
            onTaskUpdate={onTaskUpdate}
            onTaskBatchUpdate={onTaskBatchUpdate}
            onTaskCreate={onTaskCreate}
            onTaskDelete={onTaskDelete}
            onDependencyCreate={onDependencyCreate}
            onDependencyDelete={onDependencyDelete}
          />
        ) : (
          <div className="text-center py-16">
            <p style={{ color: C.textMuted }}>Impossible de créer la cédule.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminProjects;
