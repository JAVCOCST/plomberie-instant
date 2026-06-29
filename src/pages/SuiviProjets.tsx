/**
 * SuiviProjets — Unified Gantt chart for project tracking.
 * Uses the existing `schedules` table with a single default schedule.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScheduleGanttViewV2 } from '@/components/gantt/ScheduleGanttViewV2';
import { ProjectCalendarView } from '@/components/gantt/ProjectCalendarView';
import { ProjectDetailModal } from '@/components/gantt/ProjectDetailModal';
import WeatherStrip from '@/components/dispatch/WeatherStrip';
import { ClipboardList, Loader2, Search, CalendarDays, BarChart3, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays } from 'date-fns';
import { startOfWeek } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { GanttTask, GanttDependency, ContextMenuAction } from '@/components/gantt/types';
import type { EmployeeOption } from '@/components/gantt/EmployeePickerCell';

const DEFAULT_PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const db = supabase as any;

/** Normalize legacy work_type codes to the same labels shown in the dashboard. */
const WORK_TYPE_LABELS: Record<string, string> = {
  remplacement: 'Remplacement',
  reparations: 'Réparations',
  inspection: 'Inspection',
  nouvelle_construction: 'Construction',
  autre: 'Autre',
};
const formatWorkType = (raw?: string | null): string => {
  if (!raw) return '';
  const t = String(raw).trim();
  return WORK_TYPE_LABELS[t.toLowerCase()] || t;
};

interface QBCustomer {
  id: string;
  qb_id: string;
  display_name: string;
  bill_address: string | null;
}

const SuiviProjets = () => {
  const navigate = useNavigate();
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [dependencies, setDependencies] = useState<GanttDependency[]>([]);

  // View mode — default is the calendar (same visual style as /admin/calendar).
  // User can switch to the Gantt at any time; preference is persisted.
  const [viewMode, setViewMode] = useState<'calendar' | 'gantt'>(() => {
    if (typeof window === 'undefined') return 'calendar';
    const saved = window.localStorage.getItem('suiviProjetsViewMode');
    return saved === 'gantt' ? 'gantt' : 'calendar';
  });
  useEffect(() => {
    try { window.localStorage.setItem('suiviProjetsViewMode', viewMode); } catch {}
  }, [viewMode]);

  // Map of qb_customer_id (uuid) → assigned employee display names (deduped).
  // Built from dispatch_assignments + qbo_employee tables, then injected into
  // tasks via `assigned_team_summary` so the Gantt's "Assigné" column reflects
  // who is dispatched on the linked QBO project.
  const [assignedByQbCustomerId, setAssignedByQbCustomerId] = useState<Map<string, string[]>>(new Map());
  // qb_id (string from QuickBooks) → qb_customers.id (uuid) — used to bridge
  // schedule_tasks.estimator (qb_id) with dispatch_assignments.project_id (uuid).
  const [qbIdToCustomerId, setQbIdToCustomerId] = useState<Map<string, string>>(new Map());
  // qb_id (string) → soumission amount (high_estimate || subtotal). Matched by
  // email between qb_customers and soumissions, then by display_name as fallback.
  const [quoteAmountByQbId, setQuoteAmountByQbId] = useState<Map<string, number>>(new Map());
  // qb_id (string) → work_type from soumissions, matched by email/name like quote amounts.
  const [workTypeByQbId, setWorkTypeByQbId] = useState<Map<string, string>>(new Map());
  // qb_id → full soumission object for enriching the Gantt rows
  const [soumissionByQbId, setSoumissionByQbId] = useState<Map<string, any>>(new Map());
  // All employees (QBO + custom) shown in the dropdown of the "Assigné" column.
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  // qb_customer_id (uuid) → ordered employee_ids currently assigned via dispatch.
  const [assignedIdsByCustomerId, setAssignedIdsByCustomerId] = useState<Map<string, string[]>>(new Map());

  // QBO linking
  const [qboDialogOpen, setQboDialogOpen] = useState(false);
  const [qboTargetTaskId, setQboTargetTaskId] = useState<string | null>(null);
  const [qboCustomers, setQboCustomers] = useState<QBCustomer[]>([]);
  const [qboSearch, setQboSearch] = useState('');
  const [qboLoading, setQboLoading] = useState(false);

  // Calendar: clicked task to show full project details
  const [calendarTaskId, setCalendarTaskId] = useState<string | null>(null);
  const [weatherWeek, setWeatherWeek] = useState<Date[]>(() => {
    const start = startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  });

  useEffect(() => {
    const init = async () => {
      setLoading(true);

      let { data: schedules } = await db.from('schedules').select('id').eq('project_id', DEFAULT_PROJECT_ID).limit(1);

      let sid: string;
      if (schedules && schedules.length > 0) {
        sid = schedules[0].id;
      } else {
        const { data: created, error } = await db.from('schedules').insert({
          project_id: DEFAULT_PROJECT_ID,
          name: 'Cédule principale',
        }).select('id').single();
        if (error) {
          toast.error('Erreur création échéancier: ' + error.message);
          setLoading(false);
          return;
        }
        sid = created?.id;
      }

      if (!sid) { setLoading(false); return; }
      setScheduleId(sid);

      const [tasksRes, depsRes] = await Promise.all([
        db.from('schedule_tasks').select('*').eq('schedule_id', sid).order('sort_order'),
        db.from('schedule_dependencies').select('*').eq('schedule_id', sid),
      ]);

      setTasks((tasksRes.data || []).map((t: any) => ({
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

  // Load dispatch assignments + employee names + qb customer mapping so we can
  // populate the "Assigné" column on tasks linked to a QBO project.
  const reloadAssignments = useCallback(async () => {
    const [custRes, empRes, asgRes, mapRes] = await Promise.all([
      db.from('qb_customers').select('id, qb_id, display_name, email'),
      db.from('qbo_employee').select('id, display_name, given_name, family_name'),
      // Only employee-based assignments — equipment-only rows must not appear
      // in the "Assigné" column (which lists employees).
      db.from('dispatch_assignments').select('project_id, employee_id').not('employee_id', 'is', null),
      db.from('employee_mappings').select('qbo_employee_id, notes'),
    ]);
    const idMap = new Map<string, string>();
    (custRes.data || []).forEach((c: any) => { if (c.qb_id && c.id) idMap.set(c.qb_id, c.id); });
    setQbIdToCustomerId(idMap);

    const empNames = new Map<string, string>();
    const empMeta = new Map<string, { alias?: string; color?: string }>();
    (mapRes.data || []).forEach((m: any) => {
      if (!m?.qbo_employee_id || !m.notes) return;
      try {
        const parsed = JSON.parse(m.notes);
        if (parsed && typeof parsed === 'object') {
          empMeta.set(m.qbo_employee_id, { alias: parsed.alias, color: parsed.color });
        }
      } catch { /* legacy plain-text alias */
        empMeta.set(m.qbo_employee_id, { alias: m.notes });
      }
    });
    const opts: EmployeeOption[] = [];
    (empRes.data || []).forEach((e: any) => {
      const name = e.display_name || `${e.given_name || ''} ${e.family_name || ''}`.trim() || 'Sans nom';
      empNames.set(e.id, name);
      const meta = empMeta.get(e.id) || {};
      opts.push({ id: e.id, name, alias: meta.alias, color: meta.color });
    });
    opts.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    setEmployeeOptions(opts);

    const byProject = new Map<string, Set<string>>();
    const byProjectIds = new Map<string, string[]>();
    (asgRes.data || []).forEach((a: any) => {
      if (!a.project_id || !a.employee_id) return;
      const name = empNames.get(a.employee_id);
      if (!name) return;
      if (!byProject.has(a.project_id)) byProject.set(a.project_id, new Set());
      byProject.get(a.project_id)!.add(name);
      if (!byProjectIds.has(a.project_id)) byProjectIds.set(a.project_id, []);
      const arr = byProjectIds.get(a.project_id)!;
      if (!arr.includes(a.employee_id)) arr.push(a.employee_id);
    });
    const result = new Map<string, string[]>();
    for (const [pid, set] of byProject) result.set(pid, Array.from(set).sort());
    setAssignedByQbCustomerId(result);
    setAssignedIdsByCustomerId(byProjectIds);

    // ── Quote amount lookup ──────────────────────────────────────────────
    const { data: soums } = await db
      .from('soumissions')
      .select('id, reference_id, seq_number, email, first_name, last_name, high_estimate, subtotal, work_type, created_at, formatted_address, area_sqft, dynasty_breakdown, product_brand, product_name, color, slope, phone, desired_install_date')
      .order('created_at', { ascending: false });
    // Sum (total) of estimations per customer key — a single client can have
    // several soumissions and the global Gantt view must show the TOTAL,
    // not just the most recent one (which would behave like an average / pick).
    const byEmail = new Map<string, number>();
    const byName = new Map<string, number>();
    const wtByEmail = new Map<string, string>();
    const wtByName = new Map<string, string>();
    const soumByEmail = new Map<string, any>();
    const soumByName = new Map<string, any>();
    (soums || []).forEach((s: any) => {
      const amt = Number(s.high_estimate) || Number(s.subtotal) || 0;
      const wt = formatWorkType(s.work_type);
      const emailKey = s.email ? s.email.toLowerCase().trim() : '';
      const fullName = `${s.first_name || ''} ${s.last_name || ''}`.trim().toLowerCase();
      if (amt) {
        if (emailKey) byEmail.set(emailKey, (byEmail.get(emailKey) || 0) + amt);
        if (fullName) byName.set(fullName, (byName.get(fullName) || 0) + amt);
      }
      if (wt) {
        if (emailKey && !wtByEmail.has(emailKey)) wtByEmail.set(emailKey, wt);
        if (fullName && !wtByName.has(fullName)) wtByName.set(fullName, wt);
      }
      if (emailKey && !soumByEmail.has(emailKey)) soumByEmail.set(emailKey, s);
      if (fullName && !soumByName.has(fullName)) soumByName.set(fullName, s);
    });
    const amounts = new Map<string, number>();
    const wtMap = new Map<string, string>();
    const soumMap = new Map<string, any>();
    (custRes.data || []).forEach((c: any) => {
      if (!c.qb_id) return;
      const email = (c.email || '').toLowerCase().trim();
      const dn = (c.display_name || '').toLowerCase().trim();
      const amt = (email && byEmail.get(email)) || byName.get(dn);
      if (amt) amounts.set(c.qb_id, amt);
      const wt = (email && wtByEmail.get(email)) || wtByName.get(dn);
      if (wt) wtMap.set(c.qb_id, wt);
      const s = (email && soumByEmail.get(email)) || soumByName.get(dn);
      if (s) soumMap.set(c.qb_id, s);
    });
    setQuoteAmountByQbId(amounts);
    setWorkTypeByQbId(wtMap);
    setSoumissionByQbId(soumMap);
  }, []);

  useEffect(() => { reloadAssignments(); }, [reloadAssignments]);

  // Refresh when window regains focus (e.g. user comes back from /admin/dispatch)
  useEffect(() => {
    const onFocus = () => reloadAssignments();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reloadAssignments]);

  // ── Realtime sync with the Dispatch board ──
  // When an employee is dropped on a project in /admin/dispatch the row is
  // inserted server-side; subscribe so the Gantt's "Assigné" column updates
  // live without requiring a focus/blur.
  useEffect(() => {
    const channel = supabase
      .channel('dispatch_assignments_sync_gantt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_assignments' },
        () => reloadAssignments(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reloadAssignments]);

  // Inject computed `assigned_team_summary` into tasks whose `estimator` (qb_id)
  // matches a QBO customer that has dispatch assignments. Manual values entered
  // directly in the Gantt cell are preserved when no dispatch data exists.
  const tasksWithDispatch = useMemo(() => {
    return tasks.map(t => {
      const qbId = (t as any).estimator as string | null;
      const next: any = { ...t };
      if (qbId) {
        const customerId = qbIdToCustomerId.get(qbId);
        if (customerId) {
          const names = assignedByQbCustomerId.get(customerId);
          if (names && names.length > 0) next.assigned_team_summary = names.join(', ');
        }
        const amt = quoteAmountByQbId.get(qbId);
        if (amt) next._quoteAmount = amt;
        const wt = workTypeByQbId.get(qbId);
        if (wt) next._workType = wt;
        const soum = soumissionByQbId.get(qbId);
        if (soum) {
          next._soumissionId = soum.id;
          // Match QBO DocNumber format used by quickbooks-push-invoice (VB-{seq_number})
          next._referenceId = soum.seq_number
            ? `VB-${soum.seq_number}`
            : (soum.reference_id || `#${soum.id?.slice(0, 6) || ''}`);
          next._address = soum.formatted_address || (t.description || '');
          next._areaSqft = Number(soum.area_sqft) || 0;
          next._productBrand = soum.product_brand || '';
          next._productName = soum.product_name || '';
          next._color = soum.color || '';
          next._slope = soum.slope || '';
          next._phone = soum.phone || '';
          next._email = soum.email || '';
          next._installDate = soum.desired_install_date || '';
          // Materials breakdown from dynasty_breakdown.lines
          const dyn = soum.dynasty_breakdown as any;
          // Durée calculée par le moteur de soumission (jours ouvrables)
          if (dyn?.total_days_estimated != null) {
            next._quotedDuration = Number(dyn.total_days_estimated) || 0;
          }
          if (dyn?.lines && Array.isArray(dyn.lines)) {
            const lines = dyn.lines
              .filter((l: any) => l && (l.description || l.name))
              .map((l: any) => ({
                description: String(l.description || l.name || ''),
                quantity: Number(l.quantity) || 0,
                unit: String(l.unit || ''),
              }));
            next._materialsLines = lines;
            next._materialsTotal = lines.reduce((s: number, l: any) => s + (Number(l.quantity) || 0), 0);
          }
        }
      }
      // If no soumission match, fall back to the task's own description as the address
      if (!next._address) next._address = t.description || '';
      return next;
    });
  }, [tasks, assignedByQbCustomerId, qbIdToCustomerId, quoteAmountByQbId, workTypeByQbId, soumissionByQbId]);

  // Load QBO customers when dialog opens
  useEffect(() => {
    if (!qboDialogOpen) return;
    const loadCustomers = async () => {
      setQboLoading(true);
      const { data } = await db.from('qb_customers').select('id, qb_id, display_name, bill_address').order('display_name');
      setQboCustomers(data || []);
      setQboLoading(false);
    };
    loadCustomers();
  }, [qboDialogOpen]);

  const handleTaskUpdate = useCallback(async (taskId: string, updates: Partial<GanttTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates, updated_at: new Date().toISOString() } : t));
    const { error } = await db.from('schedule_tasks').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', taskId);
    if (error) toast.error('Erreur: ' + error.message);
    if (updates.start_date) {
      await db.from('dispatch_assignments').update({ assignment_date: updates.start_date }).eq('schedule_task_id', taskId);
    }
  }, []);

  const handleTaskBatchUpdate = useCallback(async (updates: Map<string, Partial<GanttTask>>) => {
    setTasks(prev => prev.map(t => {
      const patch = updates.get(t.id);
      return patch ? { ...t, ...patch, updated_at: new Date().toISOString() } : t;
    }));
    for (const [taskId, patch] of updates) {
      await db.from('schedule_tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', taskId);
    }
  }, []);

  const handleTaskCreate = useCallback(async (partial: Partial<GanttTask>) => {
    if (!scheduleId) return;
    const newTask: any = {
      schedule_id: scheduleId,
      parent_id: partial.parent_id || null,
      type: partial.type || 'phase',
      title: partial.title || 'Nouvelle tâche',
      description: partial.description || null,
      start_date: partial.start_date || format(new Date(), 'yyyy-MM-dd'),
      end_date: partial.end_date || format(addDays(new Date(), 7), 'yyyy-MM-dd'),
      duration_days: partial.duration_days || 7,
      progress: partial.progress ?? 0,
      labor_cost: partial.labor_cost ?? 0,
      material_cost: partial.material_cost ?? 0,
      subcontract_cost: partial.subcontract_cost ?? 0,
      status: partial.status || 'new',
      priority: partial.priority || 'none',
      color: partial.color || null,
      sort_order: partial.sort_order ?? tasks.length,
      is_collapsed: false,
      is_hidden: false,
    };
    const { data, error } = await db.from('schedule_tasks').insert(newTask).select('*').single();
    if (error) { toast.error('Erreur: ' + error.message); return; }
    if (data) {
      setTasks(prev => [...prev, { ...data, labor_cost: Number(data.labor_cost) || 0, material_cost: Number(data.material_cost) || 0, subcontract_cost: Number(data.subcontract_cost) || 0 } as GanttTask]);
      toast.success('Tâche créée');
    }
  }, [scheduleId, tasks.length]);

  const handleTaskDelete = useCallback(async (taskIds: string[]) => {
    setTasks(prev => prev.filter(t => !taskIds.includes(t.id)));
    setDependencies(prev => prev.filter(d => !taskIds.includes(d.source_task_id) && !taskIds.includes(d.target_task_id)));
    for (const id of taskIds) {
      await db.from('schedule_tasks').delete().eq('id', id);
    }
    toast.success(`${taskIds.length} tâche(s) supprimée(s)`);
  }, []);

  const handleDependencyCreate = useCallback(async (dep: Omit<GanttDependency, 'id' | 'created_at'>) => {
    const { data, error } = await db.from('schedule_dependencies').insert(dep).select('*').single();
    if (error) { toast.error('Erreur: ' + error.message); return; }
    if (data) {
      setDependencies(prev => [...prev, data as GanttDependency]);
      toast.success('Dépendance créée');
    }
  }, []);

  const handleDependencyDelete = useCallback(async (depId: string) => {
    setDependencies(prev => prev.filter(d => d.id !== depId));
    await db.from('schedule_dependencies').delete().eq('id', depId);
  }, []);

  // Handle context menu actions like QBO linking
  const handleContextAction = useCallback((action: ContextMenuAction, taskId: string) => {
    if (action === 'add-qbo-project') {
      setQboTargetTaskId(taskId);
      setQboSearch('');
      setQboDialogOpen(true);
    }
  }, []);

  const handleSelectQboCustomer = useCallback(async (customer: QBCustomer) => {
    // Update the task title to include QBO project name
    const task = qboTargetTaskId ? tasks.find(t => t.id === qboTargetTaskId) : null;
    const newTitle = customer.display_name;
    // Prefer the soumission's formatted_address (cleaner than QBO's bill_address
    // which often duplicates the customer name on the first line).
    const soum = soumissionByQbId.get(customer.qb_id);
    let address = (soum?.formatted_address as string) || (customer.bill_address || '').toString();
    // Strip the customer name if it appears at the very start of the address
    if (address && newTitle && address.toLowerCase().startsWith(newTitle.toLowerCase())) {
      address = address.slice(newTitle.length).replace(/^[\s,;:|–-]+/, '');
    }
    address = address.trim() || null as any;
    if (qboTargetTaskId && task) {
      // Link existing task to the QBO customer
      await handleTaskUpdate(qboTargetTaskId, {
        title: task.title === 'Nouvelle tâche' || task.title === 'Nouvelle phase' ? newTitle : task.title || newTitle,
        estimator: customer.qb_id,
        description: address,
      } as any);
      toast.success(`Projet QBO "${customer.display_name}" lié`);
    } else {
      // Create a new task pre-linked to this QBO customer (mobile-friendly add path)
      await handleTaskCreate({
        type: 'phase',
        title: newTitle,
        description: address,
        estimator: customer.qb_id,
      } as any);
    }
    setQboDialogOpen(false);
    setQboTargetTaskId(null);
  }, [qboTargetTaskId, tasks, handleTaskUpdate, handleTaskCreate, soumissionByQbId]);

  const openQboPickerForNewTask = useCallback(() => {
    setQboTargetTaskId(null);
    setQboSearch('');
    setQboDialogOpen(true);
  }, []);

  const filteredCustomers = qboCustomers.filter(c =>
    c.display_name.toLowerCase().includes(qboSearch.toLowerCase())
  );

  // ── Resolve assignment IDs for a Gantt task via its linked QBO project ──
  const getAssignedEmployeeIds = useCallback((task: GanttTask): string[] => {
    const qbId = (task as any).estimator as string | null;
    if (!qbId) return [];
    const customerId = qbIdToCustomerId.get(qbId);
    if (!customerId) return [];
    return assignedIdsByCustomerId.get(customerId) || [];
  }, [qbIdToCustomerId, assignedIdsByCustomerId]);

  const getAssignDisabledReason = useCallback((task: GanttTask): string | null => {
    const qbId = (task as any).estimator as string | null;
    if (!qbId) return 'Liez d\'abord ce projet à un client QuickBooks (clic droit → Lier un projet QBO) pour assigner des employés.';
    if (!qbIdToCustomerId.get(qbId)) return 'Client QBO introuvable. Vérifiez la liaison du projet.';
    return null;
  }, [qbIdToCustomerId]);

  // ── Persist employee assignment changes into dispatch_assignments ──
  // Strategy: replace the full set for that (project_id) — we delete all rows
  // for the project then re-insert one row per employee for today's date (AM).
  // This keeps the Dispatch board in sync; users can refine the date/period
  // directly in the Dispatch view afterwards.
  const handleAssignEmployees = useCallback(async (task: GanttTask, employeeIds: string[]) => {
    const qbId = (task as any).estimator as string | null;
    if (!qbId) { toast.error('Liez ce projet à QBO avant d\'assigner des employés'); return; }
    const customerId = qbIdToCustomerId.get(qbId);
    if (!customerId) { toast.error('Client QBO introuvable'); return; }

    // Optimistic local update so the dropdown reflects immediately
    setAssignedIdsByCustomerId(prev => {
      const next = new Map(prev);
      if (employeeIds.length === 0) next.delete(customerId);
      else next.set(customerId, employeeIds);
      return next;
    });
    setAssignedByQbCustomerId(prev => {
      const next = new Map(prev);
      const names = employeeIds
        .map(id => employeeOptions.find(e => e.id === id)?.name)
        .filter((n): n is string => !!n)
        .sort();
      if (names.length === 0) next.delete(customerId);
      else next.set(customerId, names);
      return next;
    });

    try {
      // Wipe only the employee-based assignments for this project then re-insert.
      // Equipment assignments (employee_id IS NULL, equipment_id IS NOT NULL)
      // must be preserved.
      const { error: delErr } = await db
        .from('dispatch_assignments')
        .delete()
        .eq('project_id', customerId)
        .not('employee_id', 'is', null);
      if (delErr) throw delErr;

      if (employeeIds.length > 0) {
        const today = format(new Date(), 'yyyy-MM-dd');
        const startDate = task.start_date || today;
        const rows = employeeIds.map(empId => ({
          project_id: customerId,
          employee_id: empId,
          assignment_date: startDate,
          period: 'AM',
          schedule_task_id: task.id,
        }));
        const { error: insErr } = await db.from('dispatch_assignments').insert(rows);
        if (insErr) throw insErr;
      }
      toast.success('Affectations mises à jour');
    } catch (err: any) {
      console.error('assign error', err);
      toast.error('Erreur: ' + (err?.message || 'inconnue'));
      // Resync from server on failure
      reloadAssignments();
    }
  }, [qbIdToCustomerId, employeeOptions, reloadAssignments]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'hsl(230,10%,45%)' }} />
      </div>
    );
  }

  if (!scheduleId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <ClipboardList className="h-10 w-10" style={{ color: 'hsl(230,10%,45%)' }} />
        <p style={{ color: 'hsl(230,10%,45%)' }}>Impossible de créer l'échéancier.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overscroll-contain relative">
      <div
        className="flex items-center gap-2 px-3 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid hsl(230,20%,16%)', background: 'hsl(230,22%,7%)' }}
      >
        <ClipboardList className="h-4 w-4 shrink-0" style={{ color: 'hsl(250,80%,75%)' }} />
        <h2 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>
          Suivi projet — {viewMode === 'calendar' ? 'Calendrier' : 'Vue Gantt'}
        </h2>
        <div
          role="group"
          aria-label="Mode d'affichage"
          className="ml-auto inline-flex"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: 2, gap: 2,
          }}
        >
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: viewMode === 'calendar' ? 'rgba(99,102,241,0.25)' : 'transparent',
              color: viewMode === 'calendar' ? '#c7d2fe' : '#9ca3af',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Calendrier
          </button>
          <button
            type="button"
            onClick={() => setViewMode('gantt')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              border: 'none', borderRadius: 6, cursor: 'pointer',
              background: viewMode === 'gantt' ? 'rgba(99,102,241,0.25)' : 'transparent',
              color: viewMode === 'gantt' ? '#c7d2fe' : '#9ca3af',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <BarChart3 className="h-3.5 w-3.5" /> Gantt
          </button>
        </div>
      </div>

      {(() => {
        return <div className="px-3 pt-2"><WeatherStrip weekDays={weatherWeek} /></div>;
      })()}

      <div className="flex-1 overflow-hidden p-1 sm:p-2">
        {viewMode === 'calendar' ? (
          <ProjectCalendarView
            tasks={tasksWithDispatch}
            onTaskClick={(t) => setCalendarTaskId(t.id)}
            onRangeChange={setWeatherWeek}
          />
        ) : (
          <ScheduleGanttViewV2
            scheduleId={scheduleId}
            tasks={tasksWithDispatch}
            dependencies={dependencies}
            onTaskUpdate={handleTaskUpdate}
            onTaskBatchUpdate={handleTaskBatchUpdate}
            onTaskCreate={handleTaskCreate}
            onTaskDelete={handleTaskDelete}
            onDependencyCreate={handleDependencyCreate}
            onDependencyDelete={handleDependencyDelete}
            onContextAction={handleContextAction}
            onAddTask={openQboPickerForNewTask}
            employeeOptions={employeeOptions}
            getAssignedEmployeeIds={getAssignedEmployeeIds}
            onAssignEmployees={handleAssignEmployees}
            getAssignDisabledReason={getAssignDisabledReason}
            onTaskOpen={(id) => setCalendarTaskId(id)}
            onSoumissionOpen={(sid) => navigate(`/admin/quote?id=${sid}`)}
          />
        )}
      </div>

      {/* QBO Customer Picker Dialog */}
      <Dialog open={qboDialogOpen} onOpenChange={setQboDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lier un projet QuickBooks</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un client QBO..."
              value={qboSearch}
              onChange={e => setQboSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <ScrollArea className="max-h-[300px]">
            {qboLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Aucun client trouvé</p>
            ) : (
              <div className="space-y-0.5">
                {filteredCustomers.map(c => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-sm transition-colors"
                    onClick={() => handleSelectQboCustomer(c)}
                  >
                    <div className="font-medium">{c.display_name}</div>
                    {c.bill_address && (
                      <div className="text-xs text-muted-foreground">{c.bill_address}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Calendar: rich project detail modal */}
      {calendarTaskId && (() => {
        const task = tasksWithDispatch.find(t => t.id === calendarTaskId);
        if (!task) return null;
        const qbId = (task as any).estimator as string | null;
        const customerId = qbId ? qbIdToCustomerId.get(qbId) : null;
        const names = customerId ? (assignedByQbCustomerId.get(customerId) || []) : [];
        return (
          <ProjectDetailModal
            task={task}
            assignedNames={names}
            onClose={() => setCalendarTaskId(null)}
          />
        );
      })()}

      {/* Mobile FAB — primary entry point to add a project on touch devices.
          Long-press is also available on existing rows to open the context menu. */}
      <button
        type="button"
        onClick={openQboPickerForNewTask}
        aria-label="Ajouter un projet"
        className="md:hidden fixed z-40 flex items-center justify-center rounded-full shadow-2xl active:scale-95 transition-transform"
        style={{
          right: 'max(16px, env(safe-area-inset-right))',
          bottom: 'max(20px, calc(env(safe-area-inset-bottom) + 20px))',
          width: 56,
          height: 56,
          background: 'linear-gradient(135deg, hsl(250,80%,68%), hsl(250,80%,55%))',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: '0 8px 24px rgba(99,102,241,0.45), 0 2px 6px rgba(0,0,0,0.4)',
        }}
      >
        <Plus className="h-6 w-6" strokeWidth={2.5} />
      </button>
    </div>
  );
};

export default SuiviProjets;
