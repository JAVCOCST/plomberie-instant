// Persistence layer for ClockShark time entries.
//
// Import strategy is "delta par période": each import owns the date range it
// covers (min..max entry date). Re-importing an overlapping period first
// deletes the existing rows in that range, then re-inserts the fresh batch, so
// a corrected export cleanly supersedes a previous one without leaving stale
// rows or duplicating against the UNIQUE(employee, entry_date, customer_job,
// task) constraint.

import { supabase } from '@/integrations/supabase/client';
import type { TimeEntry } from './parser';

// The generated Supabase types are stale (the clockshark_* tables were added
// after the last `types.ts` regen), so we cast at the `.from()` boundary — the
// same pattern the rest of the admin app uses for recent tables.
const db = supabase as unknown as {
  from: (table: string) => any;
  auth: typeof supabase.auth;
};

const INSERT_BATCH_SIZE = 500;

export interface StoredTimeEntry {
  id: string;
  employee: string;
  entry_date: string;
  customer_job: string;
  task: string;
  hours_decimal: number;
  hours_hm: string;
  note: string | null;
  soumission_id: string | null;
  soumission_ids: string[] | null;
  source_import_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncParams {
  entries: TimeEntry[];
  filename: string;
  fileSizeBytes: number;
  fileHash: string;
  warnings?: string[];
  /** Override the auto-detected period (defaults to min/max entry date). */
  periodStart?: string;
  periodEnd?: string;
}

export interface SyncResult {
  importId: string;
  periodStart: string;
  periodEnd: string;
  deleted: number;
  inserted: number;
}

/** Hex SHA-256 of a string, via Web Crypto (used to dedupe identical uploads). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function periodOf(entries: TimeEntry[]): { start: string; end: string } {
  const dates = entries.map((e) => e.date).filter(Boolean).sort();
  return { start: dates[0] ?? '', end: dates[dates.length - 1] ?? '' };
}

const MAX_DAY_HOURS = 24;

/** Decimal hours → `H:MM`. */
function decToHm(dec: number): string {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Union of two note blobs, de-duplicated line by line. */
function mergeNotes(a?: string, b?: string): string {
  const lines = [...(a ? a.split('\n') : []), ...(b ? b.split('\n') : [])]
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(lines)].join('\n');
}

// Collapse to one row per (employee, day, job, task) — the table's UNIQUE key.
// Without this, an export that lists the same job/task twice for an employee on
// one day would blow the unique constraint (or the upsert's ON CONFLICT) the
// moment two such rows land in the same statement. Split shifts are summed and
// capped at 24h so nothing can overflow hours_decimal.
function dedupeEntries(entries: TimeEntry[]): TimeEntry[] {
  const map = new Map<string, TimeEntry>();
  for (const e of entries) {
    if (!(e.hoursDecimal > 0) || e.hoursDecimal > MAX_DAY_HOURS) continue;
    const key = JSON.stringify([e.employee, e.date, e.customerJob, e.task]);
    const existing = map.get(key);
    if (existing) {
      const sum = Math.min(Math.round((existing.hoursDecimal + e.hoursDecimal) * 100) / 100, MAX_DAY_HOURS);
      existing.hoursDecimal = sum;
      existing.hoursHM = decToHm(sum);
      existing.note = mergeNotes(existing.note, e.note);
    } else {
      map.set(key, { ...e });
    }
  }
  return [...map.values()];
}

/** ISO date of the Sunday that opens the week containing `iso`. */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

/** ISO date `days` after `iso`. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function syncEntriesToSupabase(params: SyncParams): Promise<SyncResult> {
  const { filename, fileSizeBytes, fileHash, warnings = [] } = params;
  const entries = dedupeEntries(params.entries);
  const detected = periodOf(entries);
  const periodStart = params.periodStart ?? detected.start;
  const periodEnd = params.periodEnd ?? detected.end;

  if (!periodStart || !periodEnd) {
    throw new Error('Aucune entrée datée à importer.');
  }

  const { data: userData } = await supabase.auth.getUser();
  const importedBy = userData?.user?.id ?? null;

  // 1. Audit row.
  const { data: importRow, error: importErr } = await db
    .from('clockshark_imports')
    .insert({
      imported_by: importedBy,
      filename,
      file_size_bytes: fileSizeBytes,
      file_hash: fileHash,
      period_start: periodStart,
      period_end: periodEnd,
      entries_count: params.entries.length,
      warnings: warnings.length ? warnings : null,
    })
    .select('id')
    .single();
  if (importErr || !importRow) {
    throw new Error(`Échec de l'enregistrement de l'import : ${importErr?.message ?? 'inconnu'}`);
  }
  const importId: string = importRow.id;

  // 2. Delete the existing rows in this period.
  const { count: deleted, error: delErr } = await db
    .from('clockshark_time_entries')
    .delete({ count: 'exact' })
    .gte('entry_date', periodStart)
    .lte('entry_date', periodEnd);
  if (delErr) {
    throw new Error(`Échec de la purge de la période : ${delErr.message}`);
  }

  // 3. Insert the fresh batch (chunked).
  const rows = entries.map((e) => ({
    employee: e.employee,
    entry_date: e.date,
    customer_job: e.customerJob,
    task: e.task,
    hours_decimal: e.hoursDecimal,
    hours_hm: e.hoursHM,
    note: e.note || null,
    source_import_id: importId,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + INSERT_BATCH_SIZE);
    // Upsert (not plain insert) so an overlapping re-import can't trip the
    // UNIQUE(employee, entry_date, customer_job, task) constraint — the latest
    // value wins. The period purge above still handles removed entries.
    const { error: insErr } = await db
      .from('clockshark_time_entries')
      .upsert(chunk, { onConflict: 'employee,entry_date,customer_job,task' });
    if (insErr) {
      throw new Error(`Échec de l'écriture (lot ${i / INSERT_BATCH_SIZE + 1}) : ${insErr.message}`);
    }
    inserted += chunk.length;
  }

  // 4. Close the audit row with the real counters.
  await db
    .from('clockshark_imports')
    .update({ entries_deleted: deleted ?? 0, entries_inserted: inserted })
    .eq('id', importId);

  return { importId, periodStart, periodEnd, deleted: deleted ?? 0, inserted };
}

export async function loadEntriesByDateRange(start: string, end: string, job?: string): Promise<StoredTimeEntry[]> {
  let query = db
    .from('clockshark_time_entries')
    .select('*')
    .gte('entry_date', start)
    .lte('entry_date', end);
  if (job) query = query.ilike('customer_job', job); // case-insensitive exact
  const { data, error } = await query
    .order('entry_date', { ascending: true })
    .order('employee', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredTimeEntry[];
}

/** Load a single ClockShark week (Sunday → Saturday) starting at `weekStart`. */
export async function loadEntriesByWeek(weekStart: string, job?: string): Promise<StoredTimeEntry[]> {
  return loadEntriesByDateRange(weekStart, addDays(weekStart, 6), job);
}

/** Distinct week-start (Sunday) dates that have data, most recent first. */
export async function listAvailableWeekStarts(job?: string): Promise<string[]> {
  let query = db.from('clockshark_time_entries').select('entry_date');
  if (job) query = query.ilike('customer_job', job);
  const { data, error } = await query.order('entry_date', { ascending: false });
  if (error) throw new Error(error.message);
  const weeks = new Set<string>();
  for (const row of (data ?? []) as { entry_date: string }[]) {
    if (row.entry_date) weeks.add(weekStartOf(row.entry_date));
  }
  return [...weeks].sort((a, b) => b.localeCompare(a));
}

/* ───────────── Project assignment (link hours → soumission) ───────────── */

export interface SoumissionLite {
  id: string;
  firstName: string;
  lastName: string;
  address: string;
  reference: string;
  status: string;
}

/** A scheduled project span from Suivi projet, used to propose an assignment. */
export interface ScheduleSpan {
  soumissionId: string;
  start: string;
  end: string;
}

const SOUM_COLS = 'id, first_name, last_name, formatted_address, reference_id, status';
function toSoumLite(r: any): SoumissionLite {
  return {
    id: r.id,
    firstName: r.first_name || '',
    lastName: r.last_name || '',
    address: r.formatted_address || '',
    reference: r.reference_id || '',
    status: r.status || '',
  };
}

/** Set (or clear, with null) the soumission on a batch of time entries. */
export async function assignSoumissionToEntries(entryIds: string[], soumissionId: string | null): Promise<number> {
  return assignSoumissionsToEntries(entryIds, soumissionId ? [soumissionId] : []);
}

/**
 * Assign one OR MORE projects to a batch of time entries. When several projects
 * share the day, the worked hours are split equally between them (handled at
 * read time in the closeout). `soumission_id` keeps the first project for
 * back-compat; `soumission_ids` holds the full list (null when empty).
 */
export async function assignSoumissionsToEntries(entryIds: string[], soumissionIds: string[]): Promise<number> {
  const ids = [...new Set(soumissionIds.filter(Boolean))];
  let updated = 0;
  for (let i = 0; i < entryIds.length; i += 200) {
    const chunk = entryIds.slice(i, i + 200);
    const { error, count } = await db
      .from('clockshark_time_entries')
      .update({ soumission_id: ids[0] ?? null, soumission_ids: ids.length ? ids : null }, { count: 'exact' })
      .in('id', chunk);
    if (error) throw new Error(error.message);
    updated += count ?? chunk.length;
  }
  return updated;
}

/** Search soumissions by client name, address or reference (for the picker). */
export async function searchSoumissions(query: string, limit = 25): Promise<SoumissionLite[]> {
  let q = db.from('soumissions').select(SOUM_COLS);
  const term = query.trim().replace(/[,()]/g, ' ').trim(); // keep PostgREST or-filter safe
  if (term) {
    const like = `%${term}%`;
    q = q.or(`first_name.ilike.${like},last_name.ilike.${like},formatted_address.ilike.${like},reference_id.ilike.${like}`);
  }
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSoumLite);
}

/** Resolve a set of soumission ids to their labels (for assigned chips). */
export async function loadSoumissionsByIds(ids: string[]): Promise<SoumissionLite[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from('soumissions').select(SOUM_COLS).in('id', ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toSoumLite);
}

/**
 * Project spans scheduled (Suivi projet) overlapping a week — used to propose
 * which soumission a day's hours belong to.
 */
export async function loadScheduleProposals(weekStart: string, weekEnd: string): Promise<ScheduleSpan[]> {
  const { data, error } = await db
    .from('schedule_tasks')
    .select('soumission_id, start_date, end_date')
    .not('soumission_id', 'is', null)
    .lte('start_date', weekEnd)
    .gte('end_date', weekStart);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r: any) => r.soumission_id && r.start_date && r.end_date)
    .map((r: any) => ({ soumissionId: r.soumission_id, start: r.start_date, end: r.end_date }));
}
