import React, { useState, useMemo, useEffect, useCallback, DragEvent } from 'react';
import { ChevronLeft, ChevronRight, Users, Wrench, PanelLeftOpen, PanelLeftClose, Loader2, Search, CalendarDays, FolderKanban, UserCircle, X, Send, StickyNote, Info, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isToday, startOfMonth, endOfMonth, endOfWeek, isSameMonth, addMonths, subMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { EmployeeManagerDialog } from '@/components/dispatch/EmployeeManagerDialog';
import { EquipmentManagerDialog } from '@/components/dispatch/EquipmentManagerDialog';
import { WeatherStrip } from '@/components/dispatch/WeatherStrip';
import { getStatusOption, normalizeStatus } from '@/lib/project-statuses';

interface DispatchProject {
  id: string;
  name: string;
  address: string;
  /** Start date of the linked Gantt task (YYYY-MM-DD). */
  startDate?: string;
  /** End date of the linked Gantt task (YYYY-MM-DD). */
  endDate?: string;
  /** Status of the linked Gantt task — drives the bar color. */
  status?: string;
  /** Optional explicit color override from the Gantt task. */
  color?: string | null;
}

interface DispatchEmployee {
  id: string;
  displayName: string;
  alias: string | null;
  phone: string | null;
}

interface DispatchEquipment {
  id: string;
  displayName: string;
  alias: string | null;
  category: string | null;
  color: string | null;
}

interface Assignment {
  id?: string;
  /** Either employeeId or equipmentId is set (xor). */
  employeeId?: string;
  equipmentId?: string;
  projectId: string;
  date: string; // YYYY-MM-DD
  period: 'AM' | 'PM';
}

interface DispatchNote {
  id: string; // project or employee id
  type: 'project' | 'employee';
  note: string;
}

type ViewMode = 'projects' | 'employees';

// ─── Drag data helpers ───
interface DragData {
  type: 'employee' | 'project' | 'equipment';
  id: string;
  name: string;
  color?: string | null;
}

// ─── Assignment key ───
function assignmentKey(a: Assignment) {
  const r = a.employeeId ? `e:${a.employeeId}` : `q:${a.equipmentId}`;
  return `${r}|${a.projectId}|${a.date}|${a.period}`;
}
/** Stable id of the resource carried by an assignment (employee or equipment). */
function resourceId(a: Assignment): string {
  return a.employeeId || a.equipmentId || '';
}
function cellKey(rowId: string, date: string, period: string) {
  return `${rowId}|${date}|${period}`;
}

const Dispatch = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('projects');
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
  const [projects, setProjects] = useState<DispatchProject[]>([]);
  const [employees, setEmployees] = useState<DispatchEmployee[]>([]);
  const [equipment, setEquipment] = useState<DispatchEquipment[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<{ id: string; name: string; type: 'project' | 'employee' } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [employeeManagerOpen, setEmployeeManagerOpen] = useState(false);
  const [equipmentManagerOpen, setEquipmentManagerOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Map qb_customers.id (uuid used as project_id) → schedule_tasks.id (uuid).
  // Built by joining qb_customers.qb_id ↔ schedule_tasks.estimator. Used so
  // every dispatch_assignment we persist carries the matching Gantt task id,
  // which makes the assignment visible in the "Assigné" column of the Gantt.
  const [projectToScheduleTask, setProjectToScheduleTask] = useState<Map<string, string>>(new Map());

  // Auto-select default company if none selected
  const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000000';
  const companyId = localStorage.getItem('selectedCompanyId') || DEFAULT_COMPANY_ID;

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    const fetchData = async () => {
      setLoading(true);
      try {
        const [{ data: customers }, { data: emps }, { data: mappings }, { data: ganttTasks }, equipRes] = await Promise.all([
          supabase.from('qb_customers').select('id, qb_id, display_name, bill_address')
            .order('display_name'),
          supabase.from('qbo_employee').select('id, display_name, given_name, family_name, active')
            .order('display_name'),
          supabase.from('employee_mappings' as any).select('qbo_employee_id, notes'),
          // Only QBO projects that have been linked to a task in the Gantt
          // ('schedule_tasks.estimator' stores the qb_id) appear in Dispatch.
          // We also fetch status + dates so we can show ONLY tasks with status
          // "Travaux cédulé" overlapping the upcoming 7 days.
          supabase.from('schedule_tasks').select('id, estimator, status, start_date, end_date, is_hidden, type, color'),
          supabase.from('equipment' as any).select('id, display_name, alias, category, color, active').order('display_name'),
        ]);

        // ── Equipment list ─────────────────────────────────────────────
        const equipError = (equipRes as any)?.error;
        if (equipError) {
          const msg = String(equipError.message || '');
          const missing = /could not find the table|relation .* does not exist|schema cache/i.test(msg);
          if (missing) {
            console.error('[Dispatch] Table public.equipment introuvable:', msg);
            toast.error("Table 'public.equipment' manquante", {
              description: "Exécute la migration SQL pour créer la table dans Supabase.",
              duration: 10000,
            });
          } else {
            console.error('[Dispatch] Erreur chargement équipement:', equipError);
            toast.error('Erreur de chargement des équipements', { description: msg });
          }
          setEquipment([]);
        } else if ((equipRes as any)?.data) {
          setEquipment(((equipRes as any).data as any[])
            .filter((e: any) => e.active !== false)
            .map((e: any) => ({
              id: e.id,
              displayName: e.display_name || 'Sans nom',
              alias: e.alias || null,
              category: e.category || null,
              color: e.color || null,
            })));
        }

        // ── Keep only Gantt tasks whose status is "Travaux cédulés" (scheduled).
        // We do NOT filter by date here: filtering happens reactively below
        // based on the currently-visible week (so navigating to a future
        // week reveals jobs scheduled for that week).
        // Statuts legacy (`travaux_cedule`, `to_schedule`…) sont normalisés
        // avant comparaison pour rester cohérent avec PROJECT_STATUSES.
        const isScheduledStatus = (s: string | null | undefined) =>
          normalizeStatus(s) === 'scheduled' ||
          s === 'travaux_cedule' || s === 'travaux cédulé';

        // qb_id → { taskId, start, end } so we can both attach the Gantt task
        // to every dispatch_assignment AND filter by the visible week.
        const qbIdToTaskMeta = new Map<string, { taskId: string; start: string; end: string; status: string; color: string | null }>();
        const qbIdToTaskId = new Map<string, string>();
        (ganttTasks || []).forEach((t: any) => {
          if (!t?.estimator) return;
          if (t.is_hidden) return;
          if (t.type === 'group') return;
          if (!isScheduledStatus(t.status)) return;
          if (!t.start_date || !t.end_date) return;
          if (!qbIdToTaskId.has(String(t.estimator))) {
            qbIdToTaskId.set(String(t.estimator), String(t.id));
            qbIdToTaskMeta.set(String(t.estimator), {
              taskId: String(t.id),
              start: String(t.start_date),
              end: String(t.end_date),
              status: String(t.status),
              color: t.color ?? null,
            });
          }
        });
        const linkedQbIds = new Set<string>(qbIdToTaskId.keys());
        // qb_customers.id (uuid project_id) → schedule_tasks.id
        const projToTask = new Map<string, string>();
        if (customers) {
          (customers as any[]).forEach((c: any) => {
            if (c.qb_id && c.id && qbIdToTaskId.has(String(c.qb_id))) {
              projToTask.set(c.id, qbIdToTaskId.get(String(c.qb_id))!);
            }
          });
          setProjectToScheduleTask(projToTask);
          setProjects(
            customers
              .filter((c: any) => c.qb_id && linkedQbIds.has(String(c.qb_id)))
              .map((c: any) => {
                const meta = qbIdToTaskMeta.get(String(c.qb_id));
                return {
                  id: c.id,
                  name: c.display_name || 'Sans nom',
                  address: extractAddress(c.bill_address),
                  startDate: meta?.start,
                  endDate: meta?.end,
                  status: meta?.status,
                  color: meta?.color ?? null,
                };
              })
          );
        }
        // `employee_mappings.notes` may contain either a plain alias (legacy)
        // or a JSON blob written by the EmployeeManager dialog. Extract alias + phone.
        const mappingMap = new Map<string, { alias: string | null; phone: string | null }>();
        if (mappings) (mappings as any[]).forEach((m: any) => {
          if (!m?.qbo_employee_id || !m?.notes) return;
          let alias: string | null = null;
          let phone: string | null = null;
          try {
            const parsed = JSON.parse(m.notes);
            if (parsed && typeof parsed === 'object') {
              if (typeof parsed.alias === 'string') alias = parsed.alias;
              if (typeof parsed.phone === 'string') phone = parsed.phone;
            }
          } catch { alias = m.notes; }
          mappingMap.set(m.qbo_employee_id, { alias, phone });
        });
        if (emps) {
          setEmployees(emps.map(e => {
            const meta = mappingMap.get(e.id) || { alias: null, phone: null };
            return {
              id: e.id,
              displayName: e.display_name || `${e.given_name || ''} ${e.family_name || ''}`.trim() || 'Sans nom',
              alias: meta.alias,
              phone: meta.phone,
            };
          }));
        }

        // Load assignments from dispatch_assignments table
        try {
          const { data: assignData } = await supabase
            .from('dispatch_assignments' as any)
            .select('id, employee_id, equipment_id, project_id, assignment_date, period')
            ;
          if (assignData) {
            setAssignments((assignData as any[]).map((a: any) => ({
              id: a.id,
              employeeId: a.employee_id || undefined,
              equipmentId: a.equipment_id || undefined,
              projectId: a.project_id,
              date: a.assignment_date,
              period: a.period,
            })));
          }
        } catch {
          // Table might not exist yet, use empty assignments
          console.log('dispatch_assignments table not available, using local state');
        }

        // Load persisted dispatch notes. Before the dispatch_notes table
        // existed this state was a local-only Map<id,string> and every
        // saveNote() showed "Note sauvegardée" while throwing the content
        // away on the next refresh.
        try {
          const { data: notesData } = await (supabase.from('dispatch_notes' as any) as any).select('target_id, content');
          if (notesData) {
            const m = new Map<string, string>();
            for (const n of notesData as Array<{ target_id: string; content: string }>) {
              m.set(n.target_id, n.content);
            }
            setNotes(m);
          }
        } catch {
          // Table missing — fall back to in-memory only, same as before.
        }
      } catch (err) {
        console.error('Error loading dispatch data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const handleCompanyChange = () => {
      if (localStorage.getItem('selectedCompanyId') !== companyId) window.location.reload();
    };
    window.addEventListener('companyChanged', handleCompanyChange);
    return () => window.removeEventListener('companyChanged', handleCompanyChange);
  }, [companyId, reloadKey]);

  // ── Realtime sync with the Gantt (SuiviProjets) ──
  // Whenever an assignment is added/removed/updated from another tab/user
  // (e.g. via the "Assigné" dropdown in the Gantt), refresh local state so
  // the Dispatch grid reflects the change without a manual reload.
  useEffect(() => {
    const channel = supabase
      .channel('dispatch_assignments_sync_dispatch')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_assignments' },
        () => setReloadKey(k => k + 1),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ─── Assignment CRUD ───
  const addAssignment = useCallback(async (a: Assignment) => {
    // Check if already assigned (matching the same resource — employee or equipment)
    const rid = resourceId(a);
    const exists = assignments.some(
      x => resourceId(x) === rid && x.projectId === a.projectId && x.date === a.date && x.period === a.period
    );
    if (exists) {
      toast.warning('Cette ressource est déjà affectée à ce créneau');
      return;
    }

    const newAssignment = { ...a, id: crypto.randomUUID() };
    setAssignments(prev => [...prev, newAssignment]);

    // Persist — include schedule_task_id so the Gantt's "Assigné" column
    // immediately reflects the affectation made from the Dispatch board.
    if (companyId) {
      const scheduleTaskId = projectToScheduleTask.get(a.projectId) || null;
      const { error } = await supabase.from('dispatch_assignments' as any).insert({
        company_id: companyId,
        employee_id: a.employeeId || null,
        equipment_id: a.equipmentId || null,
        project_id: a.projectId,
        assignment_date: a.date,
        period: a.period,
        schedule_task_id: scheduleTaskId,
      } as any);
      if (error) {
        // Rollback optimistic update — the DB rejected the insert.
        console.error('Insert dispatch_assignment failed', error);
        setAssignments(prev => prev.filter(x => x.id !== newAssignment.id));
        toast.error(`Échec de l'enregistrement : ${error.message}`);
        return;
      }
    } else {
      toast.warning("Affectation locale uniquement (aucune compagnie sélectionnée)");
    }

    const proj = projects.find(p => p.id === a.projectId);
    let label = '';
    if (a.employeeId) {
      const emp = employees.find(e => e.id === a.employeeId);
      label = emp?.alias || emp?.displayName || 'Employé';
    } else if (a.equipmentId) {
      const eq = equipment.find(e => e.id === a.equipmentId);
      label = eq?.alias || eq?.displayName || 'Équipement';
    }
    toast.success(`${label} → ${proj?.name} (${a.period})`);
  }, [assignments, companyId, employees, equipment, projects, projectToScheduleTask]);

  const removeAssignment = useCallback(async (a: Assignment) => {
    const snapshot = assignments;
    setAssignments(prev => prev.filter(
      x => !(resourceId(x) === resourceId(a) && x.projectId === a.projectId && x.date === a.date && x.period === a.period)
    ));

    if (companyId) {
      let q = (supabase.from('dispatch_assignments' as any) as any)
        .delete()
        .eq('project_id', a.projectId)
        .eq('assignment_date', a.date)
        .eq('period', a.period);
      if (a.employeeId) q = q.eq('employee_id', a.employeeId);
      if (a.equipmentId) q = q.eq('equipment_id', a.equipmentId);
      const { error } = await q;
      if (error) {
        console.error('Delete dispatch_assignment failed', error);
        setAssignments(snapshot); // rollback
        toast.error(`Échec de la suppression : ${error.message}`);
      }
    }
  }, [companyId, assignments]);

  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // ── Projects visible in the Dispatch UI ──
  // Only show projects whose linked Gantt task period overlaps the
  // currently-displayed week. This keeps the board ultra-clean: each
  // project appears only on the week(s) where work is scheduled.
  const visibleProjects = useMemo(() => {
    const weekEnd = addDays(weekStart, 6);
    return projects.filter(p => {
      if (!p.startDate || !p.endDate) return false;
      const s = new Date(p.startDate);
      const e = new Date(p.endDate);
      return e >= weekStart && s <= weekEnd;
    });
  }, [projects, weekStart]);

  // ─── Note handlers ───
  const openNoteDialog = useCallback((id: string, name: string, type: 'project' | 'employee') => {
    setNoteTarget({ id, name, type });
    setNoteText(notes.get(id) || '');
    setNoteDialogOpen(true);
  }, [notes]);

  const saveNote = useCallback(async () => {
    if (!noteTarget) return;
    const trimmed = noteText.trim();
    const previous = notes.get(noteTarget.id);
    // Optimistic UI: update the Map immediately, then close the dialog so the
    // user gets instant feedback. We rollback below if Supabase rejects.
    setNotes(prev => {
      const next = new Map(prev);
      if (trimmed) next.set(noteTarget.id, trimmed);
      else next.delete(noteTarget.id);
      return next;
    });
    setNoteDialogOpen(false);

    const db = supabase as any;
    if (trimmed) {
      const { error } = await db.from('dispatch_notes').upsert({
        target_type: noteTarget.type,
        target_id: noteTarget.id,
        content: trimmed,
      }, { onConflict: 'target_type,target_id' });
      if (error) {
        toast.error(`Note non sauvegardée: ${error.message}`);
        setNotes(prev => {
          const next = new Map(prev);
          if (previous !== undefined) next.set(noteTarget.id, previous);
          else next.delete(noteTarget.id);
          return next;
        });
        return;
      }
      toast.success(`Note sauvegardée pour ${noteTarget.name}`);
    } else {
      const { error } = await db.from('dispatch_notes')
        .delete()
        .eq('target_type', noteTarget.type)
        .eq('target_id', noteTarget.id);
      if (error) {
        toast.error(`Note non supprimée: ${error.message}`);
        setNotes(prev => {
          const next = new Map(prev);
          if (previous !== undefined) next.set(noteTarget.id, previous);
          return next;
        });
        return;
      }
      toast.success(`Note supprimée pour ${noteTarget.name}`);
    }
  }, [noteTarget, noteText, notes]);

  // ─── Send dispatch ───
  const handleSendDispatch = useCallback(async () => {
    if (assignments.length === 0) {
      toast.warning('Aucune affectation à envoyer');
      return;
    }
    // Build summary — parse the date as LOCAL midnight so the week filter
    // doesn't drop Monday in negative-UTC timezones (e.g. America/Montreal).
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd');
    const weekAssignments = assignments.filter(a => {
      return a.date >= weekStartStr && a.date <= weekEndStr;
    });
    if (weekAssignments.length === 0) {
      toast.warning('Aucune affectation pour cette semaine');
      return;
    }
    // Group by employee with their project/date list
    type Entry = { emp: DispatchEmployee; rows: Array<{ date: string; period: string; project: string; address: string }> };
    const byEmp = new Map<string, Entry>();
    weekAssignments.forEach(a => {
      const emp = employees.find(e => e.id === a.employeeId);
      const proj = projects.find(p => p.id === a.projectId);
      if (!emp || !proj) return;
      if (!byEmp.has(emp.id)) byEmp.set(emp.id, { emp, rows: [] });
      byEmp.get(emp.id)!.rows.push({
        date: a.date,
        period: a.period,
        project: proj.name,
        address: proj.address || '',
      });
    });

    if (byEmp.size === 0) {
      toast.warning('Aucun employé valide à notifier');
      return;
    }

    // Build SMS payload — only employees with a valid phone get an SMS
    const weekLbl = `${format(weekStart, 'd MMM', { locale: fr })} – ${format(addDays(weekStart, 6), 'd MMM yyyy', { locale: fr })}`;
    const messages: Array<{ to: string; name: string; body: string }> = [];
    const skipped: string[] = [];

    for (const { emp, rows } of byEmp.values()) {
      if (!emp.phone) { skipped.push(emp.displayName); continue; }
      // Group rows by project so we don't repeat the name/address each day.
      type Slot = { date: string; period: string };
      const byProject = new Map<string, { project: string; address: string; slots: Slot[] }>();
      rows.forEach(r => {
        const key = `${r.project}|${r.address}`;
        if (!byProject.has(key)) byProject.set(key, { project: r.project, address: r.address, slots: [] });
        byProject.get(key)!.slots.push({ date: r.date, period: r.period });
      });

      const blocks: string[] = [];
      for (const { project, address, slots } of byProject.values()) {
        slots.sort((a, b) => (a.date + a.period).localeCompare(b.date + b.period));
        // Group consecutive AM+PM of the same day into "journée".
        const byDay = new Map<string, string[]>();
        slots.forEach(s => {
          if (!byDay.has(s.date)) byDay.set(s.date, []);
          byDay.get(s.date)!.push(s.period);
        });
        const dayLines = Array.from(byDay.entries()).map(([date, periods]) => {
          const d = format(new Date(date + 'T00:00:00'), 'EEE d MMM', { locale: fr });
          const hasAM = periods.includes('AM');
          const hasPM = periods.includes('PM');
          const when = hasAM && hasPM ? 'journée' : periods.join('+');
          return `  - ${d} (${when})`;
        });
        const addrLine = address ? `\n  ${address}` : '';
        blocks.push(`▸ ${project}${addrLine}\n${dayLines.join('\n')}`);
      }

      const body = `Bonjour ${emp.alias || emp.displayName},\nDispatch ${weekLbl}:\n\n${blocks.join('\n\n')}\n\n— Toitures VB`;
      messages.push({ to: emp.phone, name: emp.displayName, body });
    }

    if (messages.length === 0) {
      toast.error('Aucun employé affecté n\'a de numéro de téléphone. Ajoutez-les dans « Gérer les employés ».');
      return;
    }

    const loadingId = toast.loading(`Envoi à ${messages.length} employé(s)...`);
    try {
      const { data, error } = await supabase.functions.invoke('dispatch-send-sms', {
        body: { messages },
      });
      toast.dismiss(loadingId);
      if (error) throw error;
      const sent = (data as any)?.sent ?? 0;
      const failed = (data as any)?.failed ?? 0;
      const failedList = ((data as any)?.results || [])
        .filter((r: any) => !r.success)
        .map((r: any) => `${r.name || r.to}: ${r.error}`);
      if (failed === 0) {
        toast.success(`Dispatch envoyé à ${sent} employé(s)`, {
          description: skipped.length > 0 ? `Sans téléphone: ${skipped.join(', ')}` : undefined,
        });
      } else {
        toast.warning(`${sent} envoyé(s), ${failed} échec(s)`, {
          description: failedList.slice(0, 3).join(' · '),
          duration: 8000,
        });
      }
    } catch (err: any) {
      toast.dismiss(loadingId);
      console.error('Send dispatch failed', err);
      toast.error(`Erreur d'envoi: ${err?.message || 'inconnue'}`);
    }
  }, [assignments, employees, projects, weekStart]);

  const goToToday = () => setCurrentDate(new Date());
  const goToPrev = () => setCurrentDate(subWeeks(currentDate, 1));
  const goToNext = () => setCurrentDate(addWeeks(currentDate, 1));
  const weekLabel = useMemo(() => {
    const s = weekDays[0]; const e = weekDays[6];
    return `Semaine du ${format(s, 'd MMMM', { locale: fr })} au ${format(e, 'd MMMM yyyy', { locale: fr })}`;
  }, [weekDays]);
  const monthDays = useMemo(() => {
    const ms = startOfMonth(currentDate); const me = endOfMonth(ms);
    const s = startOfWeek(ms, { weekStartsOn: 1 }); const e = endOfWeek(me, { weekStartsOn: 1 });
    const days: Date[] = []; let day = s;
    while (day <= e) { days.push(day); day = addDays(day, 1); }
    return days;
  }, [currentDate]);
  const dayNames = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

  const viewTabs: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
    { key: 'projects', label: 'Projets', icon: <FolderKanban className="h-4 w-4" /> },
    { key: 'employees', label: 'Employés', icon: <Users className="h-4 w-4" /> },
  ];

  // ── dnd-kit setup: PointerSensor for desktop, TouchSensor with delay for mobile (so taps still work) ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);

  const handleDndStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragData | undefined;
    if (data) setActiveDrag(data);
  };

  const handleDndEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const overData = e.over?.data.current as { kind?: string; mode?: ViewMode; rowId?: string; dateStr?: string; period?: 'AM' | 'PM' } | undefined;
    const dragData = e.active.data.current as DragData | undefined;
    if (!overData || overData.kind !== 'cell' || !dragData) return;
    const { mode: dropMode, rowId, dateStr, period } = overData;
    if (!rowId || !dateStr || !period) return;

    if (dropMode === 'projects') {
      if (dragData.type === 'employee') {
        addAssignment({ employeeId: dragData.id, projectId: rowId, date: dateStr, period });
      } else if (dragData.type === 'equipment') {
        addAssignment({ equipmentId: dragData.id, projectId: rowId, date: dateStr, period });
      }
    } else {
      if (dragData.type === 'project') {
        addAssignment({ employeeId: rowId, projectId: dragData.id, date: dateStr, period });
      }
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDndStart} onDragEnd={handleDndEnd}>
    <>
      
      <div className="h-full flex-1 justify-center overflow-y-auto bg-background relative z-10">
        <div className="h-full w-full px-3 pb-10 pt-3 sm:px-8 sm:pt-5">
          <div className="mb-3 flex flex-col gap-3 sm:mb-4 sm:gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Dispatch</h1>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Glissez-déposez les employés sur les projets pour les affecter
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 sm:flex-wrap">
              <div className="flex w-full sm:w-auto flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Gestion
                </span>
                <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEmployeeManagerOpen(true)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs sm:text-sm font-medium text-foreground transition-colors hover:bg-muted min-h-[40px]"
                title="Gérer les employés"
                aria-label="Gérer les employés"
              >
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Gérer les employés</span>
                <span className="sm:hidden">Employés</span>
              </button>
              <button
                type="button"
                onClick={() => setEquipmentManagerOpen(true)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs sm:text-sm font-medium text-foreground transition-colors hover:bg-muted min-h-[40px]"
                title="Gérer les équipements"
                aria-label="Gérer les équipements"
              >
                <Wrench className="h-4 w-4" />
                <span className="hidden sm:inline">Gérer les équipements</span>
                <span className="sm:hidden">Équip.</span>
              </button>
              <button
                type="button"
                onClick={handleSendDispatch}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs sm:text-sm font-medium text-primary transition-colors hover:bg-primary/20 min-h-[40px]"
                title="Envoyer le dispatch par SMS aux employés"
                aria-label="Envoyer le dispatch par SMS"
              >
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Envoyer le dispatch</span>
                <span className="sm:hidden">Envoyer</span>
              </button>
                </div>
              </div>
              <div className="flex w-full sm:w-auto flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Vue
                </span>
                <div className="flex w-full sm:w-auto items-center gap-1 rounded-lg border border-border bg-card p-0.5">
                {viewTabs.map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setViewMode(tab.key)}
                    className={`flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-md px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
                      viewMode === tab.key
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
                </div>
              </div>
            </div>
          </div>

          {/* Info banner — explains the Gantt → Dispatch sync */}
          <div className="mb-3 hidden sm:flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              Seuls les projets <strong>« Travaux cédulés »</strong> dont la période chevauche la
              <strong> semaine affichée</strong> apparaissent ici. Naviguez vers une autre semaine
              avec les flèches pour voir d'autres projets. Pour en ajouter, ouvrez le Gantt, faites
              un clic droit sur une tâche, choisissez « Lier un projet QBO » et passez son statut à
              « Travaux cédulés ».
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !companyId ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              Veuillez sélectionner une compagnie
            </div>
          ) : (
            <GridView
              mode={viewMode}
              weekDays={weekDays}
              weekLabel={weekLabel}
              dayNames={dayNames}
              projects={visibleProjects}
              employees={employees}
              equipment={equipment}
              assignments={assignments}
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              goToToday={goToToday}
              goToPrev={goToPrev}
              goToNext={goToNext}
              isWeekend={isWeekend}
              addAssignment={addAssignment}
              removeAssignment={removeAssignment}
              onNameClick={openNoteDialog}
              notes={notes}
            />
          )}

          {/* Weather strip — moved to bottom: 7-day forecast aligned with current week */}
          <div className="mt-3">
            <WeatherStrip weekDays={weekDays} />
          </div>
        </div>
      </div>

      {/* Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent className="dark sm:max-w-md bg-background text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="h-5 w-5 text-primary" />
              Note — {noteTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Laissez une note pour {noteTarget?.type === 'project' ? 'ce projet' : 'cet employé'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="Écrire une note..."
            className="min-h-[120px]"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>Annuler</Button>
            <Button onClick={saveNote}>Sauvegarder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Employee management dialog */}
      <EmployeeManagerDialog
        open={employeeManagerOpen}
        onOpenChange={setEmployeeManagerOpen}
        onChanged={() => setReloadKey(k => k + 1)}
      />

      {/* Equipment management dialog */}
      <EquipmentManagerDialog
        open={equipmentManagerOpen}
        onOpenChange={setEquipmentManagerOpen}
        onChanged={() => setReloadKey(k => k + 1)}
      />
    </>
    <DragOverlay dropAnimation={null}>
      {activeDrag ? (
        <div className="rounded-md border border-primary bg-card px-2 py-1.5 text-xs font-medium text-foreground shadow-lg pointer-events-none">
          {activeDrag.name}
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
};

function extractAddress(billAddr: any): string {
  if (!billAddr) return '';
  if (typeof billAddr === 'string') return billAddr;
  const parts = [billAddr.Line1, billAddr.City, billAddr.CountrySubDivisionCode].filter(Boolean);
  return parts.join(', ') || '';
}

/* ─── Resource Sidebar ─── */
interface ResourceSidebarProps {
  mode: 'projects' | 'employees';
  employees: DispatchEmployee[];
  equipment: DispatchEquipment[];
  projects: DispatchProject[];
  onClose: () => void;
}

const ResourceSidebar: React.FC<ResourceSidebarProps> = ({ mode, employees, equipment, projects, onClose }) => {
  const [activeTab, setActiveTab] = useState<'main' | 'equipment'>('main');
  const [search, setSearch] = useState('');

  const isEmployeeSidebar = mode === 'projects';

  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(e => (e.alias || e.displayName).toLowerCase().includes(q));
  }, [employees, search]);

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(p => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
  }, [projects, search]);

  const filteredEquipment = useMemo(() => {
    if (!search.trim()) return equipment;
    const q = search.toLowerCase();
    return equipment.filter(e =>
      [e.displayName, e.alias, e.category].some(v => (v || '').toLowerCase().includes(q))
    );
  }, [equipment, search]);

  return (
    <div className="flex w-full sm:w-56 shrink-0 flex-col rounded-none sm:rounded-l-xl border border-border sm:border-r-0 bg-card max-h-full">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-foreground">Ressources</span>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {isEmployeeSidebar ? (
        <div className="flex border-b border-border">
          <button type="button" onClick={() => setActiveTab('main')}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${activeTab === 'main' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            <Users className="mr-1 inline h-3.5 w-3.5" /> Employés ({employees.length})
          </button>
          <button type="button" onClick={() => setActiveTab('equipment')}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${activeTab === 'equipment' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            <Wrench className="mr-1 inline h-3.5 w-3.5" /> Équip. ({equipment.length})
          </button>
        </div>
      ) : (
        <div className="flex border-b border-border">
          <button type="button" className="flex-1 px-2 py-1.5 text-xs font-medium border-b-2 border-primary text-primary">
            <FolderKanban className="mr-1 inline h-3.5 w-3.5" /> Projets ({projects.length})
          </button>
        </div>
      )}

      <div className="relative border-b border-border px-2 py-1.5">
        <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md border border-border bg-muted py-1 pl-8 pr-2 text-xs text-foreground placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isEmployeeSidebar && activeTab === 'main' ? (
          <div className="flex flex-col gap-1">
            {filteredEmployees.map(emp => (
              <DraggableResource key={emp.id}
                id={`employee:${emp.id}`}
                data={{ type: 'employee', id: emp.id, name: emp.alias || emp.displayName }}
                className="flex items-center rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50"
                title={emp.displayName}>
                <UserCircle className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{emp.alias || emp.displayName}</span>
              </DraggableResource>
            ))}
            {filteredEmployees.length === 0 && <div className="py-3 text-center text-xs text-muted-foreground">Aucun employé</div>}
          </div>
        ) : isEmployeeSidebar && activeTab === 'equipment' ? (
          <div className="flex flex-col gap-1">
            {filteredEquipment.map(eq => (
              <DraggableResource key={eq.id}
                id={`equipment:${eq.id}`}
                data={{ type: 'equipment', id: eq.id, name: eq.alias || eq.displayName, color: eq.color }}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50"
                title={eq.displayName}>
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] text-primary-foreground ring-1 ring-border"
                  style={{ background: eq.color || 'hsl(var(--primary))' }}
                >
                  <Wrench className="h-2.5 w-2.5" />
                </span>
                <span className="truncate">{eq.alias || eq.displayName}</span>
              </DraggableResource>
            ))}
            {filteredEquipment.length === 0 && <div className="py-3 text-center text-xs text-muted-foreground">Aucun équipement</div>}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredProjects.map(proj => (
              <DraggableResource key={proj.id}
                id={`project:${proj.id}`}
                data={{ type: 'project', id: proj.id, name: proj.name }}
                className="flex flex-col rounded-md border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/50"
                title={proj.name}>
                <span className="truncate">{proj.name}</span>
                {proj.address && <span className="truncate text-[10px] font-normal text-muted-foreground">{proj.address}</span>}
              </DraggableResource>
            ))}
            {filteredProjects.length === 0 && <div className="py-3 text-center text-xs text-muted-foreground">Aucun projet</div>}
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── dnd-kit draggable wrapper ─── */
interface DraggableResourceProps {
  id: string;
  data: DragData;
  className?: string;
  title?: string;
  children: React.ReactNode;
}
const DraggableResource: React.FC<DraggableResourceProps> = ({ id, data, className, title, children }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={title}
      className={`${className || ''} ${isDragging ? 'opacity-40' : ''} cursor-grab active:cursor-grabbing select-none`}
      style={{ touchAction: 'none' }}
    >
      {children}
    </div>
  );
};

/* ─── Grid View ─── */
interface GridViewProps {
  mode: 'projects' | 'employees';
  weekDays: Date[];
  weekLabel: string;
  dayNames: string[];
  projects: DispatchProject[];
  employees: DispatchEmployee[];
  equipment: DispatchEquipment[];
  assignments: Assignment[];
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  goToToday: () => void;
  goToPrev: () => void;
  goToNext: () => void;
  isWeekend: (d: Date) => boolean;
  addAssignment: (a: Assignment) => void;
  removeAssignment: (a: Assignment) => void;
  onNameClick: (id: string, name: string, type: 'project' | 'employee') => void;
  notes: Map<string, string>;
}

const GridView: React.FC<GridViewProps> = ({
  mode, weekDays, weekLabel, dayNames, projects, employees, equipment, assignments,
  sidebarOpen, setSidebarOpen, goToToday, goToPrev, goToNext, isWeekend,
  addAssignment, removeAssignment, onNameClick, notes,
}) => {
  const rows = mode === 'projects' ? projects : employees;
  const sidebarIcon = mode === 'projects'
    ? <Users className="h-4 w-4 text-primary" />
    : <FolderKanban className="h-4 w-4 text-primary" />;
  const sidebarCount = mode === 'projects' ? employees.length : projects.length;

  // Build lookup: for projects mode, look up employees assigned to a project/day/period
  // For employees mode, look up projects assigned to an employee/day/period
  const assignmentsByCell = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    assignments.forEach(a => {
      if (mode === 'projects') {
        const key = cellKey(a.projectId, a.date, a.period);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(a);
      } else {
        // In employees mode, only employee assignments matter (equipment doesn't have its own row).
        if (a.employeeId) {
          const key = cellKey(a.employeeId, a.date, a.period);
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(a);
        }
      }
    });
    return map;
  }, [assignments, mode]);

  return (
    <div className="relative flex" style={{ maxHeight: 'calc(100dvh - 10rem)' }}>
      {/* Collapsed rail — desktop only */}
      {!sidebarOpen && (
        <div className="hidden sm:flex w-10 shrink-0 flex-col items-center gap-3 rounded-l-xl border border-r-0 border-border bg-card py-3 cursor-pointer"
          onClick={() => setSidebarOpen(true)}>
          <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
          {sidebarIcon}
          <span className="text-[9px] font-semibold text-primary">{sidebarCount}</span>
        </div>
      )}

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — slide-in on mobile, inline on desktop.
          Safe-area padding (mobile only) so the sidebar content is not
          obscured by the iOS notch / Android camera punch-out at the top
          or the home indicator at the bottom. */}
      {sidebarOpen && (
        <div
          className="fixed left-0 top-0 z-50 h-full w-[85vw] max-w-xs sm:static sm:h-auto sm:w-auto sm:max-w-none animate-in slide-in-from-left sm:animate-none"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
          }}
        >
          <ResourceSidebar mode={mode} employees={employees} equipment={equipment} projects={projects} onClose={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* On mobile, no floating sidebar button: tap directly on a day cell
          (or the "+" badge in a slot) to assign a resource — the sidebar is
          desktop-only for drag & drop. */}

      <div className="flex-1 overflow-auto rounded-xl sm:rounded-l-none sm:rounded-r-xl border border-border bg-card shadow-sm">
        <table className="w-full table-fixed border-collapse min-w-[760px] sm:min-w-[900px]">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 border-b border-r border-border bg-muted px-2 py-1.5 text-left w-36 sm:w-52">
                <div className="flex items-center justify-between">
                  <button type="button" onClick={goToPrev} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-semibold leading-tight text-foreground">{weekLabel}</span>
                    <button type="button" onClick={goToToday} className="mt-0.5 rounded border border-border px-1.5 py-0 text-[9px] text-muted-foreground hover:bg-accent">
                      Aujourd'hui
                    </button>
                  </div>
                  <button type="button" onClick={goToNext} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </th>
              {weekDays.map((day, i) => {
                const today = isToday(day);
                const weekend = isWeekend(day);
                return (
                  <th key={i}
                    className={`border-b border-border px-1 py-2 text-center text-xs font-semibold uppercase tracking-wider ${i < 6 ? 'border-r' : ''} ${today ? 'bg-primary/10 text-primary' : weekend ? 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground'}`}>
                    <div>{dayNames[i]}</div>
                    <div className={`mt-0.5 text-[11px] font-bold normal-case ${today ? 'text-primary' : 'text-foreground'}`}>
                      {format(day, 'd MMM', { locale: fr }).replace('.', '')}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="border-b border-border px-3 py-8 text-center text-muted-foreground">
                  {mode === 'projects' ? 'Aucun projet actif trouvé' : 'Aucun employé trouvé'}
                </td>
              </tr>
            ) : mode === 'projects' ? (
              projects.map(project => (
                <tr key={project.id} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2 group-hover:bg-muted">
                    <div className="flex items-center gap-1">
                      <div
                        className="cursor-pointer truncate text-sm font-medium text-foreground hover:text-primary"
                        title={`Cliquer pour ajouter une note à ${project.name}`}
                        onClick={() => onNameClick(project.id, project.name, 'project')}
                      >
                        {project.name}
                      </div>
                      {notes.has(project.id) && (
                        <StickyNote className="h-3 w-3 shrink-0 text-amber-500" />
                      )}
                    </div>
                    {project.address && <div className="truncate text-[11px] text-muted-foreground">{project.address}</div>}
                  </td>
                  {weekDays.map((day, i) => (
                    <DayCell
                      key={i}
                      day={day}
                      index={i}
                      isWeekend={isWeekend}
                      mode={mode}
                      rowId={project.id}
                      assignments={assignmentsByCell}
                      employees={employees}
                      equipment={equipment}
                      projects={projects}
                      addAssignment={addAssignment}
                      removeAssignment={removeAssignment}
                      projectStartDate={project.startDate}
                      projectEndDate={project.endDate}
                      projectStatus={project.status}
                      projectColor={project.color || undefined}
                    />
                  ))}
                </tr>
              ))
            ) : (
              employees.map(emp => (
                <tr key={emp.id} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2 group-hover:bg-muted">
                    <div className="flex items-center gap-2">
                      <UserCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <div
                            className="cursor-pointer truncate text-sm font-medium text-foreground hover:text-primary"
                            title={`Cliquer pour ajouter une note à ${emp.alias || emp.displayName}`}
                            onClick={() => onNameClick(emp.id, emp.alias || emp.displayName, 'employee')}
                          >
                            {emp.alias || emp.displayName}
                          </div>
                          {notes.has(emp.id) && (
                            <StickyNote className="h-3 w-3 shrink-0 text-amber-500" />
                          )}
                        </div>
                        {emp.alias && <div className="truncate text-[10px] text-muted-foreground">{emp.displayName}</div>}
                      </div>
                    </div>
                  </td>
                  {weekDays.map((day, i) => (
                    <DayCell
                      key={i}
                      day={day}
                      index={i}
                      isWeekend={isWeekend}
                      mode={mode}
                      rowId={emp.id}
                      assignments={assignmentsByCell}
                      employees={employees}
                      equipment={equipment}
                      projects={projects}
                      addAssignment={addAssignment}
                      removeAssignment={removeAssignment}
                    />
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ─── Day Cell with drag & drop ─── */
interface DayCellProps {
  day: Date;
  index: number;
  isWeekend: (d: Date) => boolean;
  mode: 'projects' | 'employees';
  rowId: string;
  assignments: Map<string, Assignment[]>;
  employees: DispatchEmployee[];
  equipment: DispatchEquipment[];
  projects: DispatchProject[];
  addAssignment: (a: Assignment) => void;
  removeAssignment: (a: Assignment) => void;
  /** When set (projects mode), draws a colored bar across days in the
   *  [projectStartDate, projectEndDate] range to visualize the work span. */
  projectStartDate?: string;
  projectEndDate?: string;
  projectStatus?: string;
  projectColor?: string;
}

const DayCell: React.FC<DayCellProps> = ({
  day, index, isWeekend, mode, rowId, assignments, employees, equipment, projects,
  addAssignment, removeAssignment,
  projectStartDate, projectEndDate, projectStatus, projectColor,
}) => {
  const today = isToday(day);
  const weekend = isWeekend(day);
  const dateStr = format(day, 'yyyy-MM-dd');

  // ── Compute the project-span bar segment for this cell ──
  let inSpan = false;
  let isSpanStart = false;
  let isSpanEnd = false;
  if (projectStartDate && projectEndDate) {
    const d = new Date(dateStr);
    const s = new Date(projectStartDate);
    const e = new Date(projectEndDate);
    inSpan = d >= s && d <= e;
    isSpanStart = dateStr === projectStartDate;
    isSpanEnd = dateStr === projectEndDate;
  }
  const opt = projectStatus ? getStatusOption(projectStatus) : null;
  const barAccent = projectColor || opt?.accent || '#a78bfa';
  const barBg = opt?.bg || 'rgba(167,139,250,0.18)';

  return (
    <td className={`border-b border-border p-0 align-top ${index < 6 ? 'border-r' : ''} ${today ? 'bg-primary/5' : weekend ? 'bg-muted/50' : 'bg-card'}`}>
      {inSpan && (
        <div
          className="relative h-2 w-full"
          title={projectStartDate && projectEndDate
            ? `Projet planifié du ${format(new Date(projectStartDate), 'd MMM', { locale: fr })} au ${format(new Date(projectEndDate), 'd MMM yyyy', { locale: fr })}`
            : undefined}
        >
          <div
            className="absolute inset-y-0"
            style={{
              left: isSpanStart ? 4 : 0,
              right: isSpanEnd ? 4 : 0,
              background: barBg,
              borderTop: `2px solid ${barAccent}`,
              borderBottom: `2px solid ${barAccent}`,
              borderLeft: isSpanStart ? `3px solid ${barAccent}` : undefined,
              borderRight: isSpanEnd ? `3px solid ${barAccent}` : undefined,
              borderTopLeftRadius: isSpanStart ? 4 : 0,
              borderBottomLeftRadius: isSpanStart ? 4 : 0,
              borderTopRightRadius: isSpanEnd ? 4 : 0,
              borderBottomRightRadius: isSpanEnd ? 4 : 0,
            }}
          />
        </div>
      )}
      <div className="flex flex-col divide-y divide-dashed divide-border">
        {(['AM', 'PM'] as const).map(period => {
          const key = cellKey(rowId, dateStr, period);
          const cellAssignments = assignments.get(key) || [];

          return (
            <PeriodDropZone
              key={period}
              period={period}
              dateStr={dateStr}
              mode={mode}
              rowId={rowId}
              cellAssignments={cellAssignments}
              employees={employees}
              equipment={equipment}
              projects={projects}
              addAssignment={addAssignment}
              removeAssignment={removeAssignment}
            />
          );
        })}
      </div>
    </td>
  );
};

/* ─── Period Drop Zone ─── */
interface PeriodDropZoneProps {
  period: 'AM' | 'PM';
  dateStr: string;
  mode: 'projects' | 'employees';
  rowId: string;
  cellAssignments: Assignment[];
  employees: DispatchEmployee[];
  equipment: DispatchEquipment[];
  projects: DispatchProject[];
  addAssignment: (a: Assignment) => void;
  removeAssignment: (a: Assignment) => void;
}

const PeriodDropZone: React.FC<PeriodDropZoneProps> = ({
  period, dateStr, mode, rowId, cellAssignments, employees, equipment, projects, addAssignment, removeAssignment,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  // dnd-kit droppable. The id encodes mode + rowId + date + period so the
  // top-level DndContext handler knows where the drop landed.
  const droppableId = `cell:${mode}:${rowId}:${dateStr}:${period}`;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { kind: 'cell', mode, rowId, dateStr, period },
  });
  const dragOver = isOver;

  // Items available to assign in this slot (excludes ones already there).
  const pickerItems = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (mode === 'projects') {
      // Row is a project → pick employees AND equipment to add.
      const usedEmp = new Set(cellAssignments.map(a => a.employeeId).filter(Boolean) as string[]);
      const usedEq = new Set(cellAssignments.map(a => a.equipmentId).filter(Boolean) as string[]);
      const empItems = employees
        .filter(e => !usedEmp.has(e.id))
        .filter(e => !q || (e.alias || e.displayName).toLowerCase().includes(q))
        .map(e => ({ kind: 'employee' as const, id: e.id, label: e.alias || e.displayName, sub: e.alias ? e.displayName : null, color: null as string | null }));
      const eqItems = equipment
        .filter(e => !usedEq.has(e.id))
        .filter(e => !q || (e.alias || e.displayName).toLowerCase().includes(q) || (e.category || '').toLowerCase().includes(q))
        .map(e => ({ kind: 'equipment' as const, id: e.id, label: e.alias || e.displayName, sub: e.category || (e.alias ? e.displayName : null), color: e.color }));
      return [...empItems, ...eqItems];
    }
    const usedIds = new Set(cellAssignments.map(a => a.projectId));
    return projects
      .filter(p => !usedIds.has(p.id))
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q))
      .map(p => ({ kind: 'project' as const, id: p.id, label: p.name, sub: p.address || null, color: null as string | null }));
  }, [mode, cellAssignments, employees, equipment, projects, pickerSearch]);

  const handlePick = (item: { kind: 'employee' | 'equipment' | 'project'; id: string }) => {
    if (mode === 'projects') {
      if (item.kind === 'equipment') {
        addAssignment({ equipmentId: item.id, projectId: rowId, date: dateStr, period });
      } else {
        addAssignment({ employeeId: item.id, projectId: rowId, date: dateStr, period });
      }
    } else {
      addAssignment({ employeeId: rowId, projectId: item.id, date: dateStr, period });
    }
    setPickerSearch('');
    setPickerOpen(false);
  };

  return (
    <div ref={setNodeRef} className="relative">
      <span className="pointer-events-none absolute left-0.5 top-0 text-[9px] font-semibold uppercase text-muted-foreground">
        {period}
      </span>
      {/* Quick-add badge — bigger tap target on mobile, discreet on desktop */}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="absolute right-0.5 top-0.5 z-10 flex h-7 w-7 sm:h-5 sm:w-5 items-center justify-center rounded-full bg-primary/10 text-primary opacity-80 sm:opacity-60 transition-opacity hover:bg-primary/20 hover:opacity-100"
        aria-label={mode === 'projects' ? 'Affecter un employé' : 'Affecter un projet'}
      >
        <Plus className="h-4 w-4 sm:h-3 sm:w-3" />
      </button>
      {/* Tap-anywhere on the empty area opens the picker too */}
      <div
        onClick={() => { if (cellAssignments.length === 0) setPickerOpen(true); }}
        className={`min-h-[72px] space-y-0.5 rounded p-0.5 pt-3 transition-colors ${
          cellAssignments.length === 0 ? 'cursor-pointer' : ''
        } ${dragOver ? 'bg-primary/15 ring-2 ring-inset ring-primary/40' : ''}`}
      >
        {cellAssignments.map(a => {
          // In projects mode, show employee chips; in employees mode, show project chips
          if (mode === 'projects') {
            if (a.equipmentId) {
              const eq = equipment.find(x => x.id === a.equipmentId);
              if (!eq) return null;
              const accent = eq.color || '#f59e0b';
              return (
                <AssignmentChip
                  key={assignmentKey(a)}
                  label={eq.alias || eq.displayName}
                  icon={<Wrench className="h-2.5 w-2.5" />}
                  customStyle={{
                    background: `${accent}22`,
                    color: accent,
                    borderColor: `${accent}66`,
                  }}
                  onRemove={() => removeAssignment(a)}
                />
              );
            }
            const emp = employees.find(e => e.id === a.employeeId);
            if (!emp) return null;
            return (
              <AssignmentChip
                key={assignmentKey(a)}
                label={emp.alias || emp.displayName}
                color="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700"
                onRemove={() => removeAssignment(a)}
              />
            );
          } else {
            const proj = projects.find(p => p.id === a.projectId);
            if (!proj) return null;
            return (
              <AssignmentChip
                key={assignmentKey(a)}
                label={proj.name}
                color="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700"
                onRemove={() => removeAssignment(a)}
              />
            );
          }
        })}
      </div>

      {/* ── Quick-add picker dialog ── */}
      <Dialog open={pickerOpen} onOpenChange={(o) => { setPickerOpen(o); if (!o) setPickerSearch(''); }}>
        <DialogContent className="dark max-w-sm p-0 bg-background text-foreground">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-base">
              {mode === 'projects' ? 'Affecter un employé' : 'Affecter un projet'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {format(new Date(dateStr), 'EEEE d MMMM', { locale: fr })} · {period}
            </DialogDescription>
          </DialogHeader>
          <div className="border-y border-border bg-muted/40 px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                autoFocus
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-2 text-sm text-foreground placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-2">
            {pickerItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">Aucune option disponible</div>
            ) : (
              <div className="flex flex-col gap-1">
                {pickerItems.map(it => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => handlePick(it)}
                    className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5"
                  >
                    {it.kind === 'equipment' ? (
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] text-primary-foreground ring-1 ring-border"
                        style={{ background: it.color || 'hsl(var(--primary))' }}
                      >
                        <Wrench className="h-2.5 w-2.5" />
                      </span>
                    ) : it.kind === 'project' ? (
                      <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <UserCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{it.label}</div>
                      {it.sub && <div className="truncate text-[11px] font-normal text-muted-foreground">{it.sub}</div>}
                    </div>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ─── Assignment Chip ─── */
const AssignmentChip: React.FC<{
  label: string;
  color?: string;
  customStyle?: React.CSSProperties;
  icon?: React.ReactNode;
  onRemove: () => void;
}> = ({ label, color, customStyle, icon, onRemove }) => (
  <div
    className={`group/chip flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] sm:text-[10px] font-medium leading-tight ${color || ''}`}
    style={customStyle}
  >
    {icon}
    <span className="truncate max-w-[120px] sm:max-w-[80px]">{label}</span>
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRemove(); }}
      className="ml-auto shrink-0 rounded-full p-0.5 opacity-100 sm:opacity-0 transition-opacity group-hover/chip:opacity-100 hover:bg-black/10 min-w-[20px] min-h-[20px] flex items-center justify-center"
      aria-label="Retirer"
    >
      <X className="h-3 w-3" />
    </button>
  </div>
);

/* ─── Calendar View ─── */
interface CalendarViewProps {
  currentDate: Date;
  monthDays: Date[];
  goToToday: () => void;
  goToPrev: () => void;
  goToNext: () => void;
}

const CalendarView: React.FC<CalendarViewProps> = ({ currentDate, monthDays, goToToday, goToPrev, goToNext }) => {
  const weekDayHeaders = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];

  return (
    <div className="relative flex flex-col">
      <div className="sticky top-0 z-10 bg-background pt-4">
        <div className="flex flex-row items-center gap-4 pb-2">
          <Button variant="outline" onClick={goToToday} className="rounded-xl">Aujourd'hui</Button>
          <div className="flex flex-row gap-4 items-center">
            <div className="flex flex-row">
              <ChevronLeft className="h-6 w-6 cursor-pointer text-primary hover:text-primary/80" onClick={goToPrev} />
              <ChevronRight className="h-6 w-6 cursor-pointer text-primary hover:text-primary/80" onClick={goToNext} />
            </div>
            <h3 className="capitalize text-base font-medium">{format(currentDate, 'MMMM yyyy', { locale: fr })}</h3>
          </div>
        </div>
        <div className="h-8 w-full bg-card border rounded-t-lg">
          <div className="grid h-full w-full grid-cols-7">
            {weekDayHeaders.map(d => (
              <div key={d} className="col-span-1 flex h-full items-center text-sm p-1 text-muted-foreground">{d}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-7">
        {monthDays.map((day, index) => {
          const isCurrentMonth2 = isSameMonth(day, currentDate);
          const isTodayDate = isToday(day);
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div key={index}
              className={`relative col-span-1 border p-1 min-h-40 hover:bg-muted/50 pb-10 text-sm ${!isCurrentMonth2 || weekend ? 'bg-muted/30' : 'bg-card'}`}>
              <span className={isTodayDate ? 'rounded-2xl py-0.5 px-2 font-semibold text-primary-foreground bg-primary' : !isCurrentMonth2 ? 'text-muted-foreground' : ''}>
                {format(day, 'dd', { locale: fr })} {format(day, 'MMM', { locale: fr }).replace('.', '')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Dispatch;
export { Dispatch };
