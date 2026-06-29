/**
 * Offline queue for failed Supabase writes (Vague A · L2/L12).
 *
 * Uses `idb-keyval` for tiny footprint. Each queued item is either:
 *   - `{ kind: 'update', soumissionId, payload }`
 *   - `{ kind: 'insert', payload }`
 *
 * The queue is a single array under the key `quote_autosave_queue_v1`. It is
 * read by `useQuoteAutosave` to drain when the network comes back, and
 * `enqueue()` is called from the autosave hook whenever a write fails.
 *
 * Vague A note: this module is feature-flagged at its call site. When the
 * `VITE_QUOTE_MOBILE_V2` flag is OFF, nothing in this file is ever invoked.
 */

import { get, set, del } from 'idb-keyval';

export type QueuedKind = 'update' | 'insert';

export interface QueuedSave {
  id: string;                 // local UUID for dedup
  ts: number;                 // enqueue timestamp
  kind: QueuedKind;
  soumissionId: string | null; // null for inserts
  payload: Record<string, unknown>;
  attempts: number;
}

const KEY = 'quote_autosave_queue_v1';

function safeUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* noop */ }
  return `q_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function readQueue(): Promise<QueuedSave[]> {
  try {
    const raw = await get(KEY);
    if (!Array.isArray(raw)) return [];
    return raw as QueuedSave[];
  } catch (e) {
    // Private mode / no IDB → graceful fallback to empty queue.
    console.warn('[quote-offline-queue] readQueue failed:', e);
    return [];
  }
}

async function writeQueue(items: QueuedSave[]): Promise<void> {
  try {
    if (items.length === 0) {
      await del(KEY);
    } else {
      await set(KEY, items);
    }
  } catch (e) {
    console.warn('[quote-offline-queue] writeQueue failed:', e);
  }
}

/** Add a new write to the queue; returns the id. */
export async function enqueue(
  kind: QueuedKind,
  soumissionId: string | null,
  payload: Record<string, unknown>,
): Promise<string> {
  const item: QueuedSave = {
    id: safeUuid(),
    ts: Date.now(),
    kind,
    soumissionId,
    payload,
    attempts: 0,
  };
  const queue = await readQueue();
  queue.push(item);
  await writeQueue(queue);
  return item.id;
}

/** Returns the current queue snapshot (does not mutate). */
export async function getPending(): Promise<QueuedSave[]> {
  return readQueue();
}

/** Clear the queue entirely (used by manual recovery flows). */
export async function clearAll(): Promise<void> {
  await writeQueue([]);
}

/**
 * Drain the queue against the provided executor.
 *
 * The executor returns:
 *   - `{ ok: true, newId? }` → item is removed from the queue. If the
 *     executor needed to insert a new row, `newId` is the new soumissions.id
 *     so the caller can `adoptSoumissionId()` to keep editing this row.
 *   - `{ ok: false, fatal?: boolean }` → fatal means we drop the item
 *     (e.g. payload corrupted). Otherwise the attempt counter is bumped.
 *
 * The drain runs sequentially to preserve order. It stops on the first
 * non-fatal failure (we'll retry the whole queue on the next `online`).
 */
export type FlushResult = { ok: true; newId?: string | null } | { ok: false; fatal?: boolean };

export interface FlushSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
  newIdByItem: Record<string, string>;
}

export async function flush(
  online: boolean,
  exec: (item: QueuedSave) => Promise<FlushResult>,
): Promise<FlushSummary> {
  const summary: FlushSummary = {
    attempted: 0, succeeded: 0, failed: 0, remaining: 0, newIdByItem: {},
  };
  if (!online) {
    const q = await readQueue();
    summary.remaining = q.length;
    return summary;
  }
  let queue = await readQueue();
  if (queue.length === 0) return summary;

  const next: QueuedSave[] = [];
  let stop = false;
  for (const item of queue) {
    if (stop) {
      next.push(item);
      continue;
    }
    summary.attempted += 1;
    try {
      const res = await exec(item);
      if (res.ok === true) {
        summary.succeeded += 1;
        if (res.newId) summary.newIdByItem[item.id] = res.newId;
        // drop from queue (do not push)
      } else if (res.fatal === true) {
        summary.failed += 1;
        // drop fatal — caller already logged it via the executor
      } else {
        summary.failed += 1;
        next.push({ ...item, attempts: item.attempts + 1 });
        stop = true; // stop draining to avoid hammering
      }
    } catch (e) {
      summary.failed += 1;
      next.push({ ...item, attempts: item.attempts + 1 });
      stop = true;
      console.warn('[quote-offline-queue] exec threw:', e);
    }
  }
  await writeQueue(next);
  summary.remaining = next.length;
  return summary;
}
