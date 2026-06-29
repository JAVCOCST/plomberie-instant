/**
 * ProjectCalendarView — Monthly calendar grid styled like /admin/calendar.
 * Shows schedule_tasks across the days they span (start_date → end_date).
 */
import React, { useMemo, useState } from 'react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, isToday,
  addMonths, subMonths, parseISO, isWithinInterval, startOfDay,
  addWeeks, subWeeks, addDays,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import type { GanttTask } from './types';
import { getStatusOption } from '@/lib/project-statuses';

interface Props {
  tasks: GanttTask[];
  onTaskClick?: (task: GanttTask) => void;
  onRangeChange?: (days: Date[]) => void;
}

const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export const ProjectCalendarView: React.FC<Props> = ({ tasks, onTaskClick, onRangeChange }) => {
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  // Default: the week FOLLOWING today (i.e. next Monday).
  const [anchorDate, setAnchorDate] = useState<Date>(() => addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7));

  // Touch swipe (mobile): drag left/right inside the day grid to change week.
  const touchRef = React.useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    if (dt > 600) return;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) goNext(); else goPrev();
  };

  const calendarDays = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
      const end = endOfWeek(anchorDate, { weekStartsOn: 1 });
      return eachDayOfInterval({ start, end });
    }
    const monthStart = startOfMonth(anchorDate);
    const monthEnd = endOfMonth(anchorDate);
    const start = startOfWeek(monthStart, { weekStartsOn: 1 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [anchorDate, viewMode]);

  // Notify parent so the WeatherStrip can stay in sync with current week.
  React.useEffect(() => {
    if (!onRangeChange) return;
    const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const week = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    onRangeChange(week);
  }, [anchorDate, onRangeChange]);

  const goPrev = () => setAnchorDate(prev => viewMode === 'week' ? subWeeks(prev, 1) : subMonths(prev, 1));
  const goNext = () => setAnchorDate(prev => viewMode === 'week' ? addWeeks(prev, 1) : addMonths(prev, 1));
  const goToday = () => setAnchorDate(viewMode === 'week' ? addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7) : new Date());

  const headerLabel = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
      const end = endOfWeek(anchorDate, { weekStartsOn: 1 });
      const sameMonth = isSameMonth(start, end);
      return sameMonth
        ? `${format(start, 'd', { locale: fr })} – ${format(end, 'd MMMM yyyy', { locale: fr })}`
        : `${format(start, 'd MMM', { locale: fr })} – ${format(end, 'd MMM yyyy', { locale: fr })}`;
    }
    return format(anchorDate, 'MMMM yyyy', { locale: fr });
  }, [anchorDate, viewMode]);

  // Show every non-hidden task that has an estimator link (linked QBO project)
  // OR is an item-level task. Pure groups remain hidden to avoid clutter.
  const visibleTasks = useMemo(
    () =>
      tasks.filter(t => {
        if (t.is_hidden) return false;
        if (t.type === 'group') return false;
        return true;
      }),
    [tasks]
  );

  const getTasksForDay = (day: Date): GanttTask[] => {
    const d = startOfDay(day);
    return visibleTasks.filter(t => {
      try {
        const s = startOfDay(parseISO(t.start_date));
        const e = startOfDay(parseISO(t.end_date));
        return isWithinInterval(d, { start: s, end: e });
      } catch {
        return false;
      }
    });
  };

  // Split a day's tasks into AM / PM buckets based on their start_date hour.
  // - If the task has no time component (date only) OR spans multiple days,
  //   it shows in BOTH buckets (full-day work).
  // - Otherwise: hour < 12 → AM, hour >= 12 → PM.
  const splitAmPm = (dayTasks: GanttTask[]): { am: GanttTask[]; pm: GanttTask[] } => {
    const am: GanttTask[] = [];
    const pm: GanttTask[] = [];
    dayTasks.forEach(t => {
      let slot: 'am' | 'pm' | 'both' = 'both';
      try {
        const s = parseISO(t.start_date);
        const e = parseISO(t.end_date);
        const sameDay = isSameDay(s, e);
        const hasTime = /T\d/.test(t.start_date);
        if (sameDay && hasTime) slot = s.getHours() < 12 ? 'am' : 'pm';
      } catch { /* fallback: both */ }
      if (slot === 'am' || slot === 'both') am.push(t);
      if (slot === 'pm' || slot === 'both') pm.push(t);
    });
    return { am, pm };
  };

  return (
    <div style={{
      background: 'rgba(20,20,40,0.6)', borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.06)', padding: 20,
      height: '100%', overflow: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <button onClick={goPrev}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#9ca3af', padding: '6px 10px', cursor: 'pointer' }}>
          <ChevronLeft size={16} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', textTransform: 'capitalize', margin: 0 }}>
            {headerLabel}
          </h2>
          <button
            onClick={goToday}
            style={{
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
              color: '#a5b4fc', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {viewMode === 'week' ? 'Semaine prochaine' : 'Aujourd\u2019hui'}
          </button>
          {/* Toggle week/month */}
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 2 }}>
            {(['week', 'month'] as const).map(mode => (
              <button key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  background: viewMode === mode ? 'rgba(99,102,241,0.25)' : 'transparent',
                  color: viewMode === mode ? '#c7d2fe' : '#9ca3af',
                  border: 'none', borderRadius: 6, padding: '4px 12px',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>
                {mode === 'week' ? 'Semaine' : 'Mois'}
              </button>
            ))}
          </div>
        </div>
        <button onClick={goNext}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#9ca3af', padding: '6px 10px', cursor: 'pointer' }}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {dayNames.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, touchAction: 'pan-y' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {calendarDays.map((day) => {
          const dayTasks = getTasksForDay(day);
          const { am, pm } = splitAmPm(dayTasks);
          const inMonth = viewMode === 'week' ? true : isSameMonth(day, anchorDate);
          const today = isToday(day);
          const maxPerSlot = viewMode === 'week' ? 6 : 2;
          const renderPill = (t: GanttTask) => {
            const opt = getStatusOption(t.status);
            const accent = t.color || opt.accent;
            return (
              <div key={t.id}
                onClick={() => onTaskClick?.(t)}
                title={`${t.title} — ${opt.label}`}
                style={{
                  background: opt.bg, borderRadius: 4, padding: '2px 6px', marginBottom: 2,
                  fontSize: viewMode === 'week' ? 11 : 9, color: opt.accent, fontWeight: 600, cursor: 'pointer',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  borderLeft: `2px solid ${accent}`,
                }}>
                {t.title}
              </div>
            );
          };
          const slotLabelStyle: React.CSSProperties = {
            fontSize: viewMode === 'week' ? 9 : 8,
            fontWeight: 800,
            color: '#6b7280',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            marginBottom: 2,
            marginTop: 2,
          };
          return (
            <div key={day.toISOString()}
              style={{
                minHeight: viewMode === 'week' ? 220 : 120, padding: 6, borderRadius: 8,
                background: today ? 'rgba(52,211,153,0.06)' : 'rgba(255,255,255,0.02)',
                border: today ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(255,255,255,0.04)',
                opacity: inMonth ? 1 : 0.3, transition: 'all 0.15s ease',
                display: 'flex', flexDirection: 'column',
              }}>
              <div style={{ fontSize: viewMode === 'week' ? 13 : 11, fontWeight: today ? 800 : 500, color: today ? '#34d399' : '#9ca3af', marginBottom: 4 }}>
                {viewMode === 'week' ? format(day, 'd MMM', { locale: fr }) : format(day, 'd')}
              </div>
              {/* AM */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <div style={slotLabelStyle}>☀ AM</div>
                {am.length === 0
                  ? <div style={{ fontSize: 9, color: '#374151', fontStyle: 'italic' }}>—</div>
                  : am.slice(0, maxPerSlot).map(renderPill)}
                {am.length > maxPerSlot && (
                  <div style={{ fontSize: 8, color: '#6b7280', textAlign: 'center' }}>+{am.length - maxPerSlot}</div>
                )}
              </div>
              {/* divider */}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
              {/* PM */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <div style={slotLabelStyle}>☾ PM</div>
                {pm.length === 0
                  ? <div style={{ fontSize: 9, color: '#374151', fontStyle: 'italic' }}>—</div>
                  : pm.slice(0, maxPerSlot).map(renderPill)}
                {pm.length > maxPerSlot && (
                  <div style={{ fontSize: 8, color: '#6b7280', textAlign: 'center' }}>+{pm.length - maxPerSlot}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {visibleTasks.length === 0 && (
        <div style={{ textAlign: 'center', color: '#4b5563', fontSize: 12, padding: 24 }}>
          <Clock size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Aucune tâche planifiée pour le moment.
        </div>
      )}
    </div>
  );
};

export default ProjectCalendarView;