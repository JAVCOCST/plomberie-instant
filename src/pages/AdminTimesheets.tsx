import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, ChevronLeft, ChevronRight, Plus, CalendarDays, Check, X, Loader2, StickyNote, Search, Briefcase } from 'lucide-react';
import { parseClockShark, TOITURE_VB_JOB_NAME, type TimeEntry } from '@/lib/clockshark/parser';
import {
  syncEntriesToSupabase, listAvailableWeekStarts, loadEntriesByWeek,
  sha256Hex, addDays, weekStartOf,
  assignSoumissionToEntries, assignSoumissionsToEntries, searchSoumissions, loadSoumissionsByIds, loadScheduleProposals,
  type StoredTimeEntry, type SoumissionLite, type ScheduleSpan,
} from '@/lib/clockshark/sync';

/* ClockShark-style timesheet view (TOITURE VB), wired to Supabase. Hours are
   read back from clockshark_time_entries, and each cell can be assigned to a
   project (soumission): proposed from the Suivi projet schedule, confirmed or
   searched by hand. The assignment is saved as soumission_id on the entries. */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const COLORS = ['#f2c200', '#f59e0b', '#fb923c', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#0ea5e9', '#84cc16', '#a855f7'];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
function initials(name: string): string {
  const parts = name.split(',').map((s) => s.trim());
  const last = parts[0] || '', first = parts[1] || '';
  return ((first[0] || '') + (last[0] || '')).toUpperCase() || (name[0] || '?').toUpperCase();
}

const minToHm = (m: number): string => {
  const sign = m < 0 ? '-' : '';
  m = Math.abs(Math.round(m));
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const decToMin = (dec: number): number => Math.round(dec * 60);

/** Projects assigned to an entry: the array when present, else the single id. */
const projectsOf = (e: { soumission_ids?: string[] | null; soumission_id?: string | null }): string[] =>
  (e.soumission_ids && e.soumission_ids.length) ? e.soumission_ids : (e.soumission_id ? [e.soumission_id] : []);
const dateStrToObj = (s: string): Date => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateKeyOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fmtRange(startStr: string): string {
  const s = dateStrToObj(startStr); const e = new Date(s); e.setDate(e.getDate() + 6);
  return `${s.getDate()} – ${e.getDate()} ${MON[e.getMonth()]} ${e.getFullYear()}`;
}
const soumText = (s?: SoumissionLite | null): string =>
  s ? `${[s.firstName, s.lastName].filter(Boolean).join(' ') || '(sans nom)'}${s.address ? ' — ' + s.address : ''}` : '';
const soumShort = (s?: SoumissionLite | null): string =>
  s ? (s.lastName || s.firstName || s.reference || 'projet') : '';

/* Reusable project picker: optional schedule proposal + soumission search. */
const ProjectPicker: React.FC<{ proposal?: SoumissionLite | null; busy?: boolean; onAssign: (id: string | null) => void }> = ({ proposal, busy, onAssign }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SoumissionLite[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => { searchSoumissions(query).then((r) => active && setResults(r)).catch(() => {}); }, 220);
    return () => { active = false; clearTimeout(t); };
  }, [query]);
  return (
    <div className="picker">
      {proposal && (
        <div className="proposal">
          <Briefcase size={15} />
          <div className="prop-text"><span className="prop-tag">Proposé · Suivi projet</span><span className="prop-name">{soumText(proposal)}</span></div>
          <button className="btn-confirm" disabled={busy} onMouseDown={(e) => { e.preventDefault(); onAssign(proposal.id); }}>Confirmer</button>
        </div>
      )}
      <div className="picker-input">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Chercher un projet (nom, adresse, #réf)…" />
      </div>
      {open && (
        <div className="picker-results">
          {results.length === 0 ? <div className="picker-empty">Aucun projet</div> : results.map((s) => (
            <button key={s.id} className="picker-item" disabled={busy} onMouseDown={(e) => { e.preventDefault(); onAssign(s.id); }}>
              <span className="pi-name">{[s.firstName, s.lastName].filter(Boolean).join(' ') || '(sans nom)'}</span>
              <span className="pi-addr">{s.address || '—'}</span>
              <span className="pi-meta">{[s.reference, s.status].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const AdminTimesheets: React.FC = () => {
  const [weekStarts, setWeekStarts] = useState<string[]>([]); // ascending
  const [weekIndex, setWeekIndex] = useState(0);
  const [entries, setEntries] = useState<StoredTimeEntry[]>([]);
  const [proposals, setProposals] = useState<ScheduleSpan[]>([]);
  const [soumLabels, setSoumLabels] = useState<Map<string, SoumissionLite>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<'Employees' | 'Tasks'>('Employees');
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState<{ title: string; dateKey: string; rows: StoredTimeEntry[] } | null>(null);
  // Projects edited in the cell modal (built locally, written on "Enregistrer").
  const [modalProjects, setModalProjects] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentWeek = weekStarts[weekIndex] ?? null;
  const dates = useMemo(() => {
    if (!currentWeek) return [];
    const base = dateStrToObj(currentWeek);
    return Array.from({ length: 7 }, (_, d) => { const x = new Date(base); x.setDate(x.getDate() + d); return x; });
  }, [currentWeek]);

  const cacheLabels = useCallback(async (rows: StoredTimeEntry[], spans: ScheduleSpan[]) => {
    const ids = new Set<string>();
    rows.forEach((r) => { projectsOf(r).forEach((id) => ids.add(id)); });
    spans.forEach((s) => ids.add(s.soumissionId));
    if (ids.size === 0) return;
    const labels = await loadSoumissionsByIds([...ids]);
    setSoumLabels((prev) => { const m = new Map(prev); labels.forEach((l) => m.set(l.id, l)); return m; });
  }, []);

  const loadWeek = useCallback(async (weekStart: string) => {
    const weekEnd = addDays(weekStart, 6);
    const [rows, spans] = await Promise.all([
      loadEntriesByWeek(weekStart, TOITURE_VB_JOB_NAME),
      loadScheduleProposals(weekStart, weekEnd),
    ]);
    setEntries(rows);
    setProposals(spans);
    await cacheLabels(rows, spans);
  }, [cacheLabels]);

  const refreshWeeks = useCallback(async (preferWeek?: string) => {
    const desc = await listAvailableWeekStarts(TOITURE_VB_JOB_NAME);
    const asc = [...desc].sort((a, b) => a.localeCompare(b));
    setWeekStarts(asc);
    if (asc.length === 0) { setWeekIndex(0); setEntries([]); return; }
    setWeekIndex(preferWeek && asc.includes(preferWeek) ? asc.indexOf(preferWeek) : asc.length - 1);
  }, []);

  useEffect(() => {
    (async () => {
      try { await refreshWeeks(); }
      catch (e) { toast.error(`Chargement impossible : ${(e as Error).message}`); }
      finally { setLoading(false); }
    })();
  }, [refreshWeeks]);

  useEffect(() => {
    if (!currentWeek) { setEntries([]); setProposals([]); return; }
    let cancelled = false;
    setLoading(true);
    setSelected(new Set());
    loadWeek(currentWeek)
      .catch((e) => { if (!cancelled) toast.error(`Chargement de la semaine impossible : ${(e as Error).message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentWeek, loadWeek]);

  const handleFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const { entries: parsed, warnings } = parseClockShark(text);
      if (parsed.length === 0) { toast.error('Aucune entrée détectée dans ce CSV ClockShark.'); return; }
      const vbCount = parsed.filter((e) => e.customerJob.trim().toLowerCase() === TOITURE_VB_JOB_NAME.toLowerCase()).length;
      const fileHash = await sha256Hex(text);
      const result = await syncEntriesToSupabase({
        entries: parsed as TimeEntry[], filename: file.name, fileSizeBytes: file.size, fileHash, warnings,
      });
      toast.success(`Import réussi : ${vbCount} entrées TOITURE VB sur ${result.inserted} · ${result.periodStart} → ${result.periodEnd}`);
      await refreshWeeks(weekStartOf(result.periodEnd));
    } catch (e) {
      toast.error(`Import échoué : ${(e as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const q = filter.trim().toLowerCase();
  const rowKeyOf = useCallback((e: StoredTimeEntry) => (view === 'Employees' ? e.employee : (e.task || '(sans tâche)')), [view]);

  type GridRow = { name: string; perDay: number[]; perDayNote: boolean[]; perDaySoum: (string[] | null)[]; total: number };
  const buildRows = (): GridRow[] => {
    const map = new Map<string, GridRow>();
    for (const e of entries) {
      const key = rowKeyOf(e);
      let row = map.get(key);
      if (!row) {
        row = { name: key, perDay: Array(7).fill(0), perDayNote: Array(7).fill(false), perDaySoum: Array(7).fill(null), total: 0 };
        map.set(key, row);
      }
      const di = dates.findIndex((d) => dateKeyOf(d) === e.entry_date);
      if (di >= 0) {
        row.perDay[di] += decToMin(e.hours_decimal);
        if (e.note && e.note.trim()) row.perDayNote[di] = true;
        const list = projectsOf(e);
        if (list.length) {
          const cur = row.perDaySoum[di];
          row.perDaySoum[di] = cur ? [...new Set([...cur, ...list])] : [...new Set(list)];
        }
      }
      row.total += decToMin(e.hours_decimal);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const allRows = useMemo(buildRows, [entries, dates, rowKeyOf]);
  const rows = allRows.filter((r) => !q || r.name.toLowerCase().includes(q));
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const visibleNames = useMemo(() => new Set(rows.map((r) => r.name)), [rows]);

  /* ── selection helpers (entry ids) ── */
  const idsForCell = (name: string, dayIdx: number) =>
    entries.filter((e) => rowKeyOf(e) === name && e.entry_date === dateKeyOf(dates[dayIdx])).map((e) => e.id);
  const idsForRow = (name: string) => entries.filter((e) => rowKeyOf(e) === name).map((e) => e.id);
  const idsForDay = (dayIdx: number) =>
    entries.filter((e) => visibleNames.has(rowKeyOf(e)) && e.entry_date === dateKeyOf(dates[dayIdx])).map((e) => e.id);
  const idsAll = entries.filter((e) => visibleNames.has(rowKeyOf(e))).map((e) => e.id);
  const allSelected = (ids: string[]) => ids.length > 0 && ids.every((id) => selected.has(id));
  const toggleIds = (ids: string[]) => setSelected((prev) => {
    const next = new Set(prev);
    const turnOff = allSelected(ids);
    ids.forEach((id) => (turnOff ? next.delete(id) : next.add(id)));
    return next;
  });

  const proposalIdForDate = useCallback(
    (dateKey: string) => proposals.find((p) => p.start <= dateKey && dateKey <= p.end)?.soumissionId || null,
    [proposals],
  );
  const selectedEntries = entries.filter((e) => selected.has(e.id));
  const selectedMinutes = selectedEntries.reduce((s, e) => s + decToMin(e.hours_decimal), 0);
  const selectionProposal = useMemo(() => {
    const set = new Set(selectedEntries.map((e) => proposalIdForDate(e.entry_date)).filter(Boolean) as string[]);
    return set.size === 1 ? soumLabels.get([...set][0]) || null : null;
  }, [selectedEntries, proposalIdForDate, soumLabels]);

  /** Write one or more projects to a batch of entries (hours split equally). */
  const assignProjects = async (ids: string[], projectIds: string[]) => {
    if (ids.length === 0) return;
    setAssigning(true);
    try {
      await assignSoumissionsToEntries(ids, projectIds);
      const missing = projectIds.filter((p) => !soumLabels.has(p));
      if (missing.length) {
        const ls = await loadSoumissionsByIds(missing);
        if (ls.length) setSoumLabels((m) => { const n = new Map(m); ls.forEach((l) => n.set(l.id, l)); return n; });
      }
      if (currentWeek) await loadWeek(currentWeek);
      setSelected(new Set());
      setModal(null);
      toast.success(projectIds.length === 0 ? 'Assignation retirée.'
        : projectIds.length > 1 ? `${projectIds.length} projets assignés — heures réparties également.`
        : 'Projet assigné aux heures.');
    } catch (e) {
      toast.error(`Échec de l'assignation : ${(e as Error).message}`);
    } finally {
      setAssigning(false);
    }
  };
  const assignEntries = (ids: string[], soumId: string | null) => assignProjects(ids, soumId ? [soumId] : []);

  /** Add a project to the modal's local list (label fetched if missing). */
  const addModalProject = async (id: string | null) => {
    if (!id) return;
    setModalProjects((p) => (p.includes(id) ? p : [...p, id]));
    if (!soumLabels.has(id)) {
      const [l] = await loadSoumissionsByIds([id]);
      if (l) setSoumLabels((m) => new Map(m).set(l.id, l));
    }
  };

  const openDetail = (rowName: string, dateKey: string) => {
    const cellRows = entries.filter((e) => rowKeyOf(e) === rowName && e.entry_date === dateKey);
    if (cellRows.length === 0) return;
    setModalProjects([...new Set(cellRows.flatMap(projectsOf))]);
    const d = dateStrToObj(dateKey);
    setModal({ title: `${rowName} — ${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`, dateKey, rows: cellRows });
  };

  const chipFor = (ids: string[] | null) => {
    if (!ids || ids.length === 0) return null;
    return (
      <span className="soum-chips">
        {ids.slice(0, 2).map((id) => {
          const s = soumLabels.get(id);
          return <span key={id} className="soum-chip" style={{ borderLeftColor: colorFor(id) }} title={soumText(s) || 'Projet assigné'}>{soumShort(s) || '✓'}</span>;
        })}
        {ids.length > 2 && <span className="soum-chip more" title={`${ids.length} projets`}>+{ids.length - 2}</span>}
      </span>
    );
  };

  const modalProposal = modal ? soumLabels.get(proposalIdForDate(modal.dateKey) || '') || null : null;

  return (
    <div className="cs-ts">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="page-head">
          <div>
            <h1>Timesheets</h1>
            <div className="subtitle">TOITURE VB — TEMPS REFACT</div>
          </div>
          <div className="head-right">
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <button className="btn btn-import" disabled={importing} onClick={() => fileRef.current?.click()}>
              {importing ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
              {importing ? 'Import…' : 'Importer CSV'}
            </button>
          </div>
        </div>

        <div className="toolbar">
          <button className="nav-arrow" disabled={weekIndex <= 0} title="Semaine précédente"
            onClick={() => setWeekIndex((i) => Math.max(0, i - 1))}><ChevronLeft size={22} /></button>
          <button className="nav-arrow" disabled={weekIndex >= weekStarts.length - 1} title="Semaine suivante"
            onClick={() => setWeekIndex((i) => Math.min(weekStarts.length - 1, i + 1))}><ChevronRight size={22} /></button>
          <button className="week-btn">
            <span className="label">{currentWeek ? 'Semaine' : '—'}</span>
            <span className="range">{currentWeek ? fmtRange(currentWeek) : ''}</span>
          </button>
          <div className="tool-spacer" />
          <input type="text" className="search" placeholder={view === 'Employees' ? 'Filtrer les employés…' : 'Filtrer les tâches…'}
            value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="seg">
            <button className={view === 'Employees' ? 'active' : ''} onClick={() => setView('Employees')}>Employés</button>
            <button className={view === 'Tasks' ? 'active' : ''} onClick={() => setView('Tasks')}>Tâches</button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="actionbar">
            <div className="ab-info">
              <strong>{selected.size}</strong> pointage(s) · <strong>{minToHm(selectedMinutes)}</strong> h
            </div>
            <ProjectPicker proposal={selectionProposal} busy={assigning} onAssign={(id) => assignEntries([...selected], id)} />
            <div className="ab-actions">
              <button className="btn-ghost" disabled={assigning} onClick={() => assignEntries([...selected], null)}>Désassigner</button>
              <button className="btn-ghost" onClick={() => setSelected(new Set())}>Annuler</button>
            </div>
          </div>
        )}

        <div id="gridArea">
          {loading ? (
            <div className="hint"><Loader2 size={26} className="spin" /> Chargement…</div>
          ) : weekStarts.length === 0 ? (
            <div className="hint">Importez un fichier CSV ClockShark (Job Detail ou Employee Timesheet) pour afficher les données.</div>
          ) : (
            <table className="ts">
              <thead>
                <tr>
                  <th className="emp-col">
                    <label className="cbx-wrap">
                      <input type="checkbox" className="cbx" checked={allSelected(idsAll)} onChange={() => toggleIds(idsAll)} title="Tout sélectionner" />
                      <span>{view === 'Employees' ? 'Employé' : 'Tâche'}</span>
                    </label>
                  </th>
                  {dates.map((d, i) => (
                    <th key={i}>
                      <input type="checkbox" className="cbx" checked={allSelected(idsForDay(i))} onChange={() => toggleIds(idsForDay(i))} title="Sélectionner la journée" />
                      <div><span className="dow">{DOW[i]}</span><span className="dnum">{d.getDate()}/{d.getMonth() + 1}</span></div>
                    </th>
                  ))}
                  <th className="total-col total-head">Total<span className="range">{currentWeek ? fmtRange(currentWeek) : ''}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="hint">Aucune ligne ne correspond au filtre.</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.name}>
                    <td className="emp-col">
                      <label className="emp">
                        <input type="checkbox" className="cbx" checked={allSelected(idsForRow(row.name))} onChange={() => toggleIds(idsForRow(row.name))} title="Sélectionner cette ligne" />
                        <div className="avatar" style={{ background: colorFor(row.name) }}>{initials(row.name)}</div>
                        <span>{row.name}</span>
                      </label>
                    </td>
                    {row.perDay.map((min, i) => {
                      const empty = min === 0;
                      if (empty) return <td key={i} className="day-cell empty"><span className="add"><Plus size={16} /></span></td>;
                      const ids = idsForCell(row.name, i);
                      const sel = allSelected(ids);
                      const soum = row.perDaySoum[i];
                      const assigned = !!soum && soum.length > 0;
                      return (
                        <td key={i} className={`day-cell${sel ? ' sel' : ''}`}>
                          <div className="cell-inner">
                            <input type="checkbox" className="cbx cell-cbx" checked={sel} onChange={() => toggleIds(ids)} title="Sélectionner" />
                            <span className="cell-val" role="button" onClick={() => openDetail(row.name, dateKeyOf(dates[i]))}>
                              {minToHm(min)}
                              {assigned && <Check size={14} className="assigned-check" />}
                              {row.perDayNote[i] && <span className="note-dot" title="Contient des notes" />}
                            </span>
                            {chipFor(soum)}
                          </div>
                        </td>
                      );
                    })}
                    <td className="total-col">{row.total ? minToHm(row.total) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="foot">
                  <td className="emp-col">Total</td>
                  <td colSpan={7} />
                  <td className="total-col">{grandTotal ? minToHm(grandTotal) : '0:00'}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {modal && (
        <div className="overlay open" onClick={(e) => { if ((e.target as HTMLElement).classList.contains('overlay')) setModal(null); }}>
          <div className="modal">
            <div className="modal-head">
              <h2><CalendarDays size={20} color="#818cf8" /><span>{modal.title}</span></h2>
              <button className="close" onClick={() => setModal(null)} aria-label="Fermer"><X size={22} /></button>
            </div>
            <div className="modal-body">
              <table className="tl">
                <thead><tr><th style={{ width: '50%' }}>Employé</th><th style={{ width: '35%' }}>Tâche</th><th style={{ width: '15%', textAlign: 'right' }}>Heures</th></tr></thead>
                <tbody>
                  {modal.rows.map((r) => (
                    <tr className="job-row" key={r.id}>
                      <td>
                        <div className="job-name">{r.employee}</div>
                        {r.soumission_id && <div className="job-soum"><Briefcase size={12} />{soumText(soumLabels.get(r.soumission_id)) || 'Projet assigné'}</div>}
                        {r.note && r.note.trim() && <div className="job-note"><StickyNote size={13} />{r.note}</div>}
                      </td>
                      <td><div className="job-task">{r.task || '—'}</div></td>
                      <td className="job-hours">{r.hours_hm}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={2}><Check size={16} className="check" />Total</td>
                    <td style={{ textAlign: 'right' }}>{minToHm(modal.rows.reduce((s, r) => s + decToMin(r.hours_decimal), 0))}</td>
                  </tr>
                </tbody>
              </table>

              <div className="assign-section">
                <div className="assign-title"><Briefcase size={15} /> Projets de cette journée{modalProjects.length > 1 ? ' · heures réparties également' : ''}</div>
                {modalProjects.length > 0 && (
                  <div className="assigned-chips">
                    {modalProjects.map((id) => (
                      <span key={id} className="assigned-chip" style={{ borderColor: colorFor(id) }}>
                        <span className="dot" style={{ background: colorFor(id) }} />
                        {soumText(soumLabels.get(id)) || 'Projet'}
                        <button className="rm" disabled={assigning} onClick={() => setModalProjects((p) => p.filter((x) => x !== id))} aria-label="Retirer ce projet"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
                {modalProjects.length < 2
                  ? <ProjectPicker proposal={modalProjects.includes(proposalIdForDate(modal.dateKey) || '') ? null : modalProposal} busy={assigning} onAssign={addModalProject} />
                  : <div className="assign-hint">2 projets max par journée — retire-en un pour en ajouter un autre.</div>}
                <div className="assign-actions">
                  <button className="btn-save" disabled={assigning} onClick={() => assignProjects(modal.rows.map((r) => r.id), modalProjects)}>
                    {assigning ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                  {modal.rows.some((r) => projectsOf(r).length > 0) && (
                    <button className="btn-ghost" disabled={assigning} onClick={() => assignProjects(modal.rows.map((r) => r.id), [])}>Retirer l'assignation</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Dark theme aligned with the admin portal (#0a0a14 shell, indigo accents).
const CSS = `
.cs-ts *{box-sizing:border-box;margin:0;padding:0}
.cs-ts{font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#e5e7eb;background:transparent;min-height:100%}
.cs-ts .spin{animation:cs-spin 1s linear infinite}
@keyframes cs-spin{to{transform:rotate(360deg)}}
.cs-ts .wrap{max-width:1280px;margin:0 auto;padding:16px}
.cs-ts .page-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:10px}
.cs-ts .page-head h1{font-size:34px;font-weight:300;color:#e5e7eb}
.cs-ts .subtitle{color:#818cf8;font-size:13px;font-weight:600;letter-spacing:.03em;margin-top:-2px}
.cs-ts .head-right{display:flex;gap:10px;align-items:center}
.cs-ts .btn{padding:11px 20px;border-radius:8px;border:none;cursor:pointer;font-size:15px;display:inline-flex;align-items:center;gap:7px}
.cs-ts .btn:disabled{opacity:.6;cursor:default}
.cs-ts .btn-import{background:#6366f1;color:#fff}.cs-ts .btn-import:hover:not(:disabled){background:#4f46e5}
.cs-ts .toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid #23233a;padding:6px 0 12px}
.cs-ts .nav-arrow{background:none;border:none;cursor:pointer;color:#a5b4fc;display:flex;padding:4px;border-radius:8px}
.cs-ts .nav-arrow:hover:not([disabled]){background:#1b1b2e}
.cs-ts .nav-arrow[disabled]{color:#3a3a52;cursor:default}
.cs-ts .week-btn{background:none;border:none;cursor:default;text-align:left;padding:4px 8px;border-radius:8px}
.cs-ts .week-btn .label{color:#a5b4fc;font-weight:600;font-size:16px;margin-right:6px}
.cs-ts .week-btn .range{color:#8b8fa3;font-size:16px}
.cs-ts .tool-spacer{flex:1}
.cs-ts .seg{display:inline-flex;border:1px solid #3730a3;border-radius:8px;overflow:hidden}
.cs-ts .seg button{background:transparent;color:#a5b4fc;border:none;padding:7px 16px;cursor:pointer;font-size:14px}
.cs-ts .seg button.active{background:#6366f1;color:#fff}
.cs-ts .search{padding:8px 10px;border:1px solid #2a2a44;border-radius:8px;font-size:14px;min-width:200px;background:#12121f;color:#e5e7eb}
.cs-ts .search::placeholder{color:#6b6f85}
.cs-ts .cbx{accent-color:#6366f1;width:15px;height:15px;cursor:pointer;flex-shrink:0}
.cs-ts .cbx-wrap{display:inline-flex;align-items:center;gap:8px;cursor:pointer}
/* Action bar */
.cs-ts .actionbar{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-top:14px;padding:12px 14px;background:#12121f;border:1px solid #2a2a44;border-radius:12px}
.cs-ts .ab-info{font-size:13px;color:#cdd0dc;padding-top:8px;white-space:nowrap}
.cs-ts .ab-info strong{color:#a5b4fc}
.cs-ts .ab-actions{display:flex;gap:8px;align-items:center;padding-top:3px}
.cs-ts .btn-ghost{background:transparent;border:1px solid #2a2a44;color:#c9ccda;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
.cs-ts .btn-ghost:hover:not(:disabled){background:#1b1b2e}
.cs-ts .btn-ghost:disabled{opacity:.5;cursor:default}
/* Picker */
.cs-ts .picker{position:relative;flex:1;min-width:260px}
.cs-ts .proposal{display:flex;align-items:center;gap:10px;background:#0e1a14;border:1px solid #1f5c43;border-radius:8px;padding:7px 10px;margin-bottom:7px;color:#a7f3d0}
.cs-ts .proposal svg{color:#34d399;flex-shrink:0}
.cs-ts .prop-text{display:flex;flex-direction:column;min-width:0;flex:1}
.cs-ts .prop-tag{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#34d399;font-weight:700}
.cs-ts .prop-name{font-size:13px;color:#dfe7e2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-ts .btn-confirm{background:#16a34a;color:#fff;border:none;border-radius:7px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0}
.cs-ts .btn-confirm:disabled{opacity:.6;cursor:default}
.cs-ts .picker-input{display:flex;align-items:center;gap:8px;background:#0e0e1a;border:1px solid #2a2a44;border-radius:8px;padding:0 10px}
.cs-ts .picker-input svg{color:#6b6f85}
.cs-ts .picker-input input{flex:1;background:transparent;border:none;outline:none;color:#e5e7eb;padding:9px 0;font-size:13px}
.cs-ts .picker-results{position:absolute;top:100%;left:0;right:0;margin-top:4px;background:#12121f;border:1px solid #2a2a44;border-radius:8px;max-height:280px;overflow:auto;z-index:50;box-shadow:0 12px 30px rgba(0,0,0,.5)}
.cs-ts .picker-item{display:flex;flex-direction:column;gap:1px;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid #1c1c2e;padding:8px 12px;cursor:pointer}
.cs-ts .picker-item:hover{background:#1b1b2e}
.cs-ts .pi-name{font-size:13px;font-weight:600;color:#e5e7eb}
.cs-ts .pi-addr{font-size:12px;color:#9a9eb3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cs-ts .pi-meta{font-size:11px;color:#6b6f85}
.cs-ts .picker-empty{padding:14px;text-align:center;color:#6b6f85;font-size:13px}
/* Grid */
.cs-ts table.ts{width:100%;border-collapse:collapse;margin-top:14px}
.cs-ts table.ts th,.cs-ts table.ts td{border:1px solid #1f1f33;text-align:center;vertical-align:middle;color:#e5e7eb}
.cs-ts table.ts thead th{background:#12121f;font-size:12px;color:#9a9eb3;padding:8px 4px;font-weight:600}
.cs-ts table.ts thead th .dow{display:block;text-transform:uppercase}
.cs-ts table.ts thead th .dnum{display:block;color:#6b6f85;font-weight:400}
.cs-ts th.emp-col,.cs-ts td.emp-col{text-align:left;padding:10px 12px;min-width:210px}
.cs-ts td.day-cell{height:62px;font-weight:600;color:#a5b4fc;padding:0}
.cs-ts td.day-cell.sel{background:#1a1f3a;outline:1px solid #6366f1;outline-offset:-1px}
.cs-ts td.day-cell:hover:not(.empty){background:#1b1b2e}
.cs-ts td.day-cell.empty{color:#3a3a52;font-weight:400}
.cs-ts .cell-inner{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:2px;padding:4px}
.cs-ts .cell-cbx{position:absolute;top:4px;left:4px;width:14px;height:14px}
.cs-ts .cell-val{position:relative;cursor:pointer;display:inline-flex;align-items:center}
.cs-ts .assigned-check{color:#34d399;margin-left:4px;vertical-align:middle;flex-shrink:0}
.cs-ts .note-dot{position:absolute;top:-6px;right:-9px;width:6px;height:6px;border-radius:50%;background:#34d399}
.cs-ts .soum-chips{display:inline-flex;gap:3px;flex-wrap:wrap;max-width:100%}
.cs-ts .soum-chip{display:inline-block;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:700;color:#dfe2ee;background:#23233a;border-radius:4px;padding:1px 6px;border-left:3px solid #6366f1;text-transform:uppercase;letter-spacing:.02em}
.cs-ts .soum-chip.multi{color:#9a9eb3;border-left-color:#8b8fa3;letter-spacing:1px}
.cs-ts .soum-chip.more{border-left-color:#8b8fa3;color:#9a9eb3;max-width:none}
.cs-ts td.day-cell .add{opacity:0;display:inline-flex;color:#818cf8}
.cs-ts td.day-cell.empty:hover .add{opacity:1}
.cs-ts .total-col{background:#12121f;font-weight:600;color:#cdd0dc}
.cs-ts .total-head .range{display:block;font-weight:400;color:#6b6f85;font-size:11px}
.cs-ts .emp{display:flex;align-items:center;gap:10px;cursor:pointer}
.cs-ts .avatar{width:30px;height:30px;border-radius:50%;color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.cs-ts tr.foot td{background:#161626;font-weight:600;color:#e5e7eb}
.cs-ts .hint{color:#8b8fa3;padding:40px;text-align:center;font-size:15px;display:flex;align-items:center;justify-content:center;gap:10px}
/* Modal */
.cs-ts .overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:flex-start;justify-content:center;z-index:100;padding:30px 12px;overflow:auto}
.cs-ts .overlay.open{display:flex}
.cs-ts .modal{background:#12121f;border:1px solid #2a2a44;border-radius:14px;max-width:760px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.cs-ts .modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #23233a}
.cs-ts .modal-head h2{font-size:20px;font-weight:400;display:flex;align-items:center;gap:10px;color:#e5e7eb}
.cs-ts .modal-head .close{cursor:pointer;color:#8b8fa3;background:none;border:none;display:flex}
.cs-ts .modal-body{padding:18px 20px}
.cs-ts table.tl{width:100%;border-collapse:collapse}
.cs-ts table.tl th{background:#0e0e1a;font-size:11px;letter-spacing:.04em;color:#8b8fa3;text-transform:uppercase;text-align:left;padding:9px 12px;border-bottom:1px solid #23233a}
.cs-ts .job-row td{padding:12px;border-left:4px solid #6366f1;background:#0e0e1a;color:#e5e7eb;vertical-align:top}
.cs-ts .job-name{font-weight:700;font-size:15px;color:#e5e7eb}
.cs-ts .job-soum{display:flex;gap:6px;align-items:center;font-size:12px;color:#a5b4fc;margin-top:4px}
.cs-ts .job-task{font-size:13px;color:#8b8fa3}
.cs-ts .job-note{display:flex;gap:6px;align-items:flex-start;font-size:12.5px;color:#cdd0dc;margin-top:6px;line-height:1.45;white-space:pre-wrap;background:#161626;border-left:2px solid #34d399;border-radius:4px;padding:6px 9px}
.cs-ts .job-note svg{flex-shrink:0;margin-top:1px;color:#34d399}
.cs-ts .job-hours{font-weight:700;color:#cdd0dc;text-align:right}
.cs-ts .total-row td{background:#161626;padding:12px;font-weight:700;border-top:1px solid #23233a;color:#e5e7eb}
.cs-ts .check{color:#34d399;vertical-align:middle;margin-right:6px;display:inline-block}
.cs-ts .tl-empty{padding:24px;text-align:center;color:#6b6f85}
.cs-ts .assign-section{margin-top:18px;padding-top:16px;border-top:1px solid #23233a}
.cs-ts .assign-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#cdd0dc;margin-bottom:10px}
.cs-ts .assign-title svg{color:#818cf8}
.cs-ts .assign-section .btn-ghost{margin-top:0}
.cs-ts .assigned-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.cs-ts .assigned-chip{display:inline-flex;align-items:center;gap:7px;background:#1b1b2e;border:1px solid #3a3a55;border-radius:8px;padding:5px 8px 5px 10px;font-size:12px;font-weight:600;color:#dfe2ee}
.cs-ts .assigned-chip .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.cs-ts .assigned-chip .rm{background:none;border:none;color:#9a9eb3;cursor:pointer;display:inline-flex;padding:0;margin-left:2px}
.cs-ts .assigned-chip .rm:hover{color:#f87171}
.cs-ts .assign-hint{font-size:11px;color:#9a9eb3;margin:4px 0}
.cs-ts .assign-actions{display:flex;gap:10px;align-items:center;margin-top:12px}
.cs-ts .btn-save{background:#6366f1;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer}
.cs-ts .btn-save:disabled{opacity:.6;cursor:default}
`;

export default AdminTimesheets;
