// ClockShark "Employee Timesheets" CSV parser.
//
// ClockShark exports the weekly *matrix* report as a CSV where each employee
// owns a section, and inside a section there is one block per ISO week. A block
// starts with a header row whose first cell is exactly "Customer: Job":
//
//   "Customer: Job","Task","Sun 15/06/2025",...,"Sat 21/06/2025","Total"
//   "TOITURE VB - TEMPS REFACT","Réfection","8:00","8:00",...,"0:00","32:00"
//   "JAVCO Construction - Duplex","Démolition","0:00",...,"6:00","6:00"
//   "Regular","","8:00",...                 ← summary rows, ignored
//
// We flatten the matrix into one entry per (employee, day, job, task) cell that
// carries a non-zero number of hours. That granularity matches the UNIQUE
// (employee, entry_date, customer_job, task) constraint on the Supabase table.

export const TOITURE_VB_JOB_NAME = 'TOITURE VB - TEMPS REFACT';

export interface TimeEntry {
  employee: string;
  /** ISO date `YYYY-MM-DD`. */
  date: string;
  customerJob: string;
  task: string;
  hoursDecimal: number;
  /** Original `H:MM` cell as exported by ClockShark. */
  hoursHM: string;
  /** Free-text note from a "Job Detail" export (empty for the matrix export). */
  note?: string;
}

export interface ParseResult {
  entries: TimeEntry[];
  warnings: string[];
}

export interface TaskAggregate {
  task: string;
  hoursDecimal: number;
  count: number;
}

export interface EmployeeAggregate {
  employee: string;
  hoursDecimal: number;
  count: number;
}

// Rows whose first cell is one of these are ClockShark roll-ups, never data.
const SUMMARY_KEYWORDS = new Set([
  'regular', 'overtime', 'doubletime', 'double time', 'double-time',
  'pto', 'holiday', 'vacation', 'sick', 'bereavement', 'unpaid break',
  'paid break', 'break', 'total', 'totals', 'grand total', 'salary',
  'reimbursement', 'reimbursements', 'mileage',
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// No single (employee, day, job, task) cell can legitimately exceed 24h. Any
// larger value is a roll-up/total row that slipped past SUMMARY_KEYWORDS, so we
// drop it — this also keeps values inside the hours_decimal numeric range.
const MAX_DAY_HOURS = 24;

/** `"4:15"` → `4.25`, `"40:30"` → `40.5`, `"8"` → `8`, `""`/`null` → `0`. */
export function parseHoursToDecimal(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return round2(value);
  const s = value.trim();
  if (!s) return 0;
  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;
  if (body.includes(':')) {
    const [h, m] = body.split(':');
    const hours = parseInt(h, 10) || 0;
    const mins = parseInt(m, 10) || 0;
    const val = hours + mins / 60;
    return round2(negative ? -val : val);
  }
  const n = parseFloat(body);
  if (Number.isNaN(n)) return 0;
  return round2(negative ? -n : n);
}

/**
 * `"Sun 15/06/2025"` → `"2025-06-15"`. Accepts the optional weekday prefix,
 * the Québec `DD/MM/YYYY` order, and ISO passthrough. Returns `""` when the
 * input cannot be parsed.
 */
export function parseClockSharkDate(value: string): string {
  if (!value) return '';
  // Drop a leading weekday token ("Sun", "Mon.", "Sunday", …).
  const cleaned = value.trim().replace(/^[A-Za-zÀ-ÿ]{2,}\.?\s+/, '');
  const dmy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, mo, y] = dmy;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return cleaned;
  return '';
}

/** Minimal RFC-4180 CSV reader (quoted fields, `""` escapes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const isBlankRow = (cells: string[]) => cells.every((c) => !c || !c.trim());

export function parseClockSharkTimesheets(csv: string): ParseResult {
  const rows = parseCsv(csv);
  const entries: TimeEntry[] = [];
  const warnings: string[] = [];

  let currentEmployee = '';
  let pendingEmployee = '';
  let currentDays: string[] = [];

  for (const cells of rows) {
    if (isBlankRow(cells)) continue;
    const c0 = (cells[0] || '').trim();
    const c0l = c0.toLowerCase();

    // ── Week header: capture the 7 day columns (until "Total"). ──
    if (c0l === 'customer: job' || c0l === 'customer:job') {
      currentDays = [];
      for (let i = 2; i < cells.length; i++) {
        const v = (cells[i] || '').trim();
        if (v.toLowerCase() === 'total') break;
        const iso = parseClockSharkDate(v);
        if (iso) currentDays.push(iso);
        else if (v) warnings.push(`Unparseable day column: "${v}"`);
      }
      if (currentDays.length === 0) {
        warnings.push(`Week header without parseable dates: ${cells.join(',')}`);
      }
      if (pendingEmployee) { currentEmployee = pendingEmployee; pendingEmployee = ''; }
      continue;
    }

    // ── Explicit employee marker: "Employee: Marc Tremblay". ──
    const empMatch = c0.match(/^Employee\s*:\s*(.+)$/i);
    if (empMatch) {
      pendingEmployee = empMatch[1].trim();
      currentEmployee = pendingEmployee;
      continue;
    }

    // ── ClockShark roll-up rows (Regular / Overtime / Total / …). ──
    if (SUMMARY_KEYWORDS.has(c0l)) continue;

    const restEmpty = cells.slice(1).every((c) => !c || !c.trim());

    // ── Data row: a job with hour cells under an active week header. ──
    if (currentDays.length > 0 && !restEmpty) {
      const customerJob = c0;
      const task = (cells[1] || '').trim();
      for (let i = 0; i < currentDays.length; i++) {
        const cell = (cells[2 + i] || '').trim();
        if (!cell) continue;
        const dec = parseHoursToDecimal(cell);
        if (dec <= 0) continue;
        if (dec > MAX_DAY_HOURS) {
          warnings.push(`Cellule ignorée (> ${MAX_DAY_HOURS}h, probablement un total) : ${customerJob} ${currentDays[i]} = ${cell}`);
          continue;
        }
        entries.push({
          employee: currentEmployee || 'Inconnu',
          date: currentDays[i],
          customerJob,
          task,
          hoursDecimal: dec,
          hoursHM: cell,
        });
      }
      continue;
    }

    // ── Lone label right before a header → employee section name. ──
    if (restEmpty) {
      pendingEmployee = c0;
      continue;
    }
  }

  return { entries, warnings };
}

// "Job Detail" exports prefix employee names with a leading space and an
// "-<id>" suffix: " Cote, Dave-8" → "Cote, Dave". Keep the "Last, First" order
// so avatar initials stay consistent with the matrix export.
function normalizeEmployee(raw: string): string {
  return (raw || '').trim().replace(/-\d+$/, '').trim();
}

/**
 * Parses the ClockShark "Job Detail Report" export. Structure:
 *
 *   "Job Detail Report"
 *   "Sun 15/06/2025 - Sun 14/6/2026"
 *   "TOITURE VB - TEMPS REFACT"                          ← job section header
 *   "Date","Employee","Task","In",…,"Out","Total"        ← column header
 *   "Wed 18/06/2025"," Cote, Dave-8","TOITURE",…,"2:00"   ← punch row
 *   "Notes:","Trepanier",…                                ← note for the punch above
 *   "","","","","","","Daily Total","","8:00"             ← roll-up, ignored
 *
 * One entry per punch; multiple punches for the same (employee, day, job, task)
 * are kept separate here and summed/merged downstream by the sync layer.
 */
export function parseClockSharkJobDetail(csv: string): ParseResult {
  const rows = parseCsv(csv);
  const entries: TimeEntry[] = [];
  const warnings: string[] = [];

  let currentJob = '';
  let inSection = false;
  let lastEntry: TimeEntry | null = null;

  for (const cells of rows) {
    if (isBlankRow(cells)) continue;
    const c0 = (cells[0] || '').trim();
    const c0l = c0.toLowerCase();

    // Column header → punches follow until the next section.
    if (c0l === 'date' && (cells[1] || '').trim().toLowerCase() === 'employee') {
      inSection = true;
      lastEntry = null;
      continue;
    }

    // Note row → attach to the punch directly above.
    if (c0l === 'notes:') {
      const note = (cells[1] || '').trim();
      if (lastEntry && note) {
        lastEntry.note = lastEntry.note ? `${lastEntry.note}\n${note}` : note;
      }
      continue;
    }

    // Daily Total roll-up → ignore.
    if ((cells[6] || '').trim().toLowerCase() === 'daily total') {
      lastEntry = null;
      continue;
    }

    // Punch row: first cell is a date, with employee/task/total columns.
    const iso = parseClockSharkDate(c0);
    if (iso) {
      if (!inSection || !currentJob) continue;
      const dec = parseHoursToDecimal((cells[8] || '').trim());
      if (!(dec > 0)) { lastEntry = null; continue; }
      if (dec > MAX_DAY_HOURS) {
        warnings.push(`Punch ignoré (> ${MAX_DAY_HOURS}h) : ${currentJob} ${iso}`);
        lastEntry = null;
        continue;
      }
      const entry: TimeEntry = {
        employee: normalizeEmployee(cells[1] || '') || 'Inconnu',
        date: iso,
        customerJob: currentJob,
        task: (cells[2] || '').trim(),
        hoursDecimal: dec,
        hoursHM: (cells[8] || '').trim(),
        note: '',
      };
      entries.push(entry);
      lastEntry = entry;
      continue;
    }

    // Otherwise: a lone-cell job section header (skip the report title and the
    // date-range line, which both also stand alone).
    const restEmpty = cells.slice(1).every((c) => !c || !c.trim());
    if (restEmpty) {
      if (c0l === 'job detail report' || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c0)) continue;
      currentJob = c0;
      inSection = false;
      lastEntry = null;
    }
  }

  return { entries, warnings };
}

/**
 * Auto-detects the ClockShark export flavour and routes to the right parser:
 * "Job Detail Report" (with notes) vs the weekly "Employee Timesheets" matrix.
 */
export function parseClockShark(csv: string): ParseResult {
  const clean = csv.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0].toLowerCase();
  return firstLine.includes('job detail report')
    ? parseClockSharkJobDetail(clean)
    : parseClockSharkTimesheets(clean);
}

/** Only `TOITURE VB - TEMPS REFACT` counts for Toitures VB (case-insensitive). */
export function filterToitureVB(entries: TimeEntry[]): TimeEntry[] {
  const target = TOITURE_VB_JOB_NAME.trim().toLowerCase();
  return entries.filter((e) => e.customerJob.trim().toLowerCase() === target);
}

/** Inclusive on both bounds. `start`/`end` are ISO `YYYY-MM-DD` strings. */
export function filterByDateRange(entries: TimeEntry[], start: string, end: string): TimeEntry[] {
  return entries.filter((e) => e.date >= start && e.date <= end);
}

export function aggregateByTask(entries: TimeEntry[]): TaskAggregate[] {
  const map = new Map<string, TaskAggregate>();
  for (const e of entries) {
    const key = e.task || '(Sans tâche)';
    const agg = map.get(key) || { task: key, hoursDecimal: 0, count: 0 };
    agg.hoursDecimal = round2(agg.hoursDecimal + e.hoursDecimal);
    agg.count += 1;
    map.set(key, agg);
  }
  return [...map.values()].sort((a, b) => b.hoursDecimal - a.hoursDecimal);
}

export function aggregateByEmployee(entries: TimeEntry[]): EmployeeAggregate[] {
  const map = new Map<string, EmployeeAggregate>();
  for (const e of entries) {
    const key = e.employee || 'Inconnu';
    const agg = map.get(key) || { employee: key, hoursDecimal: 0, count: 0 };
    agg.hoursDecimal = round2(agg.hoursDecimal + e.hoursDecimal);
    agg.count += 1;
    map.set(key, agg);
  }
  return [...map.values()].sort((a, b) => b.hoursDecimal - a.hoursDecimal);
}

/** Total decimal hours across a set of entries (rounded to 2 decimals). */
export function totalHours(entries: TimeEntry[]): number {
  return round2(entries.reduce((sum, e) => sum + e.hoursDecimal, 0));
}
