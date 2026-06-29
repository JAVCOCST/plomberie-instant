import type { QueryClient } from '@tanstack/react-query';
import { PROJECTS_QUERY_KEY, type Project } from '@/hooks/useProjects';

/** Optimistic patch on a single project row in the RQ cache. */
export function patchProjectCache(
  qc: QueryClient,
  id: string,
  patch: Partial<Project>,
) {
  qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (old = []) =>
    (old || []).map((p) => (p.id === id ? ({ ...p, ...patch } as Project) : p)),
  );
}

/** Optimistic patch on many project rows. */
export function patchManyProjectCache(
  qc: QueryClient,
  ids: Iterable<string>,
  patch: Partial<Project>,
) {
  const set = new Set(ids);
  qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (old = []) =>
    (old || []).map((p) => (set.has(p.id) ? ({ ...p, ...patch } as Project) : p)),
  );
}

/** Optimistic removal (delete). */
export function removeProjectsFromCache(qc: QueryClient, ids: Iterable<string>) {
  const set = new Set(ids);
  qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (old = []) =>
    (old || []).filter((p) => !set.has(p.id)),
  );
}

/** Snapshot the current cache for rollback. */
export function snapshotProjects(qc: QueryClient): Project[] | undefined {
  return qc.getQueryData<Project[]>(PROJECTS_QUERY_KEY);
}

export function restoreProjects(qc: QueryClient, snap: Project[] | undefined) {
  if (snap) qc.setQueryData(PROJECTS_QUERY_KEY, snap);
}

export function invalidateProjects(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
}

/** Wrap an async mutation with structured logging + timing. */
export async function withMutationLog<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    const out = await fn();
    if (typeof console !== 'undefined') {
      console.debug(`[mutation:${name}] ok in ${(performance.now() - t0).toFixed(0)}ms`);
    }
    return out;
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.error(`[mutation:${name}] failed in ${(performance.now() - t0).toFixed(0)}ms`, err);
    }
    throw err;
  }
}

/** Detect Postgres "column missing from schema cache" error (used by archive fallback). */
export function isMissingColumnError(error: unknown, columnHint?: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string; details?: string };
  const text = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  if (columnHint && text.includes(columnHint.toLowerCase()) && (text.includes('does not exist') || text.includes('schema cache'))) {
    return true;
  }
  return false;
}