/**
 * useQuoteAutosave — Vague A autosave hook for AdminQuoteGenerator.
 *
 * Responsibilities:
 *   - Debounce 3 s on payload changes (configurable).
 *   - Immediate flush on `visibilitychange='hidden'` and `pagehide` (iOS kill).
 *   - When offline: enqueue the write into IndexedDB (`quote-offline-queue`).
 *   - When online: try to send directly; on failure, enqueue + report.
 *   - On `online` event: drain the queue.
 *   - Expose a `status` and `lastSavedAt` for the UI indicator.
 *
 * The hook is intentionally generic. The caller provides:
 *   - `buildPayload()` → returns the row to persist (or `null` to skip).
 *   - `soumissionId` (nullable; null = brand-new).
 *   - `executeSave(kind, soumissionId, payload)` → returns `{ ok, newId? }` on
 *     success, `{ ok: false, fatal? }` on failure. The caller decides
 *     `insert` vs `update` via `kind`.
 *   - `enabled` — when false, the hook is a no-op (used as the master flag
 *     gate at the call site).
 *
 * This hook does NOT touch React state of the parent except via the
 * `onAdoptNewId` callback (used when an insert succeeds and the parent
 * must claim the new row id).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { enqueue, flush, getPending, type FlushResult, type QueuedSave } from '@/lib/quote-offline-queue';

export type AutosaveStatus =
  | 'idle'
  | 'pending'      // debounce is running
  | 'saving'      // network call in flight
  | 'saved'
  | 'offline'    // queued, will retry when back online
  | 'error';     // last attempt failed (will retry next change/online)

export interface UseQuoteAutosaveOptions {
  /** Master gate. When false the hook does NOTHING. */
  enabled: boolean;
  /** Current soumission id (null for a brand-new in-progress quote). */
  soumissionId: string | null;
  /** Online status from `useOnlineStatus`. */
  online: boolean;
  /** Build the row from React state. Return `null` to skip this tick. */
  buildPayload: () => Record<string, unknown> | null;
  /**
   * Perform an `insert` or `update` against Supabase. Must NOT throw on
   * recoverable failures — return `{ ok: false }`. Throwing or returning
   * `{ ok: false, fatal: true }` will drop the queued item.
   */
  executeSave: (
    kind: 'insert' | 'update',
    soumissionId: string | null,
    payload: Record<string, unknown>,
  ) => Promise<FlushResult>;
  /**
   * Called when an insert succeeded and the parent must adopt the new
   * row id so subsequent autosaves become `update`s.
   */
  onAdoptNewId?: (newId: string) => void;
  /** Debounce in ms (default 3000). */
  debounceMs?: number;
  /** Optional: tells the hook to ignore writes when the user is manually saving. */
  isManualSaving?: boolean;
  /** Trigger value: any deps the caller wants to use to wake the debouncer up. */
  trigger: unknown;
  /** Coarse heuristic: should we autosave at all? (used to skip empty drafts). */
  hasContent?: boolean;
}

export interface UseQuoteAutosaveReturn {
  status: AutosaveStatus;
  lastSavedAt: number | null;
  pendingCount: number;
  /** Force an immediate save (debounce-bypassing). Resolves with the result. */
  saveNow: () => Promise<FlushResult | null>;
  /** Drain the IndexedDB queue. Idempotent + safe to call any time. */
  drainQueue: () => Promise<void>;
}

const DEFAULT_DEBOUNCE = 3000;

export function useQuoteAutosave(opts: UseQuoteAutosaveOptions): UseQuoteAutosaveReturn {
  const {
    enabled, online, buildPayload, executeSave,
    soumissionId, onAdoptNewId, debounceMs = DEFAULT_DEBOUNCE,
    isManualSaving, trigger, hasContent,
  } = opts;

  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const inflightRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayloadSigRef = useRef<string>('');

  // Keep stable refs of the callbacks so the effects don't re-run on every render.
  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;
  const executeSaveRef = useRef(executeSave);
  executeSaveRef.current = executeSave;
  const adoptRef = useRef(onAdoptNewId);
  adoptRef.current = onAdoptNewId;

  // Track current `soumissionId` and `online` in refs so flush callers see the
  // latest values without restarting the listener effect.
  const soumissionIdRef = useRef(soumissionId);
  soumissionIdRef.current = soumissionId;
  const onlineRef = useRef(online);
  onlineRef.current = online;

  /** Compute a cheap signature to avoid saving the same payload twice. */
  const sigOf = (p: Record<string, unknown> | null): string => {
    if (!p) return '';
    try { return JSON.stringify(p); } catch { return String(Date.now()); }
  };

  const runOneSave = useCallback(async (force: boolean): Promise<FlushResult | null> => {
    if (!enabled) return null;
    if (inflightRef.current) return null;
    const payload = buildPayloadRef.current();
    if (!payload) return null;
    const sig = sigOf(payload);
    if (!force && sig === lastPayloadSigRef.current) return null;
    inflightRef.current = true;
    setStatus('saving');
    try {
      if (!onlineRef.current) {
        // Offline → enqueue directly
        await enqueue(
          soumissionIdRef.current ? 'update' : 'insert',
          soumissionIdRef.current,
          payload,
        );
        lastPayloadSigRef.current = sig;
        setStatus('offline');
        const pending = await getPending();
        setPendingCount(pending.length);
        return { ok: false };
      }
      const kind = soumissionIdRef.current ? 'update' : 'insert';
      const res = await executeSaveRef.current(kind, soumissionIdRef.current, payload);
      if (res.ok === true) {
        lastPayloadSigRef.current = sig;
        if (res.newId && adoptRef.current) adoptRef.current(res.newId);
        setLastSavedAt(Date.now());
        setStatus('saved');
        return res;
      }
      // res.ok is false here — explicit cast helps TS narrow the union.
      const failure = res as Extract<FlushResult, { ok: false }>;
      if (failure.fatal === true) {
        // Drop — caller already logged. Mark error so UI shows ⚠.
        setStatus('error');
        return failure;
      }
      // Soft failure (network / 5xx): enqueue and try again later.
      await enqueue(kind, soumissionIdRef.current, payload);
      setStatus('offline');
      const pending = await getPending();
      setPendingCount(pending.length);
      return failure;
    } finally {
      inflightRef.current = false;
    }
  }, [enabled]);

  const drainQueue = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    if (!onlineRef.current) return;
    const exec = async (item: QueuedSave): Promise<FlushResult> => {
      // If we already adopted an id for this brand-new row, retroactively
      // upgrade insert → update so we don't create a duplicate.
      const effectiveKind: 'insert' | 'update' =
        item.kind === 'insert' && soumissionIdRef.current ? 'update' : item.kind;
      const effectiveId = effectiveKind === 'update' ? soumissionIdRef.current ?? item.soumissionId : null;
      return executeSaveRef.current(effectiveKind, effectiveId, item.payload);
    };
    const summary = await flush(true, exec);
    // Adopt the first new id we discover so subsequent items skip the insert
    // path and become updates against the same row.
    if (summary.newIdByItem) {
      const first = Object.values(summary.newIdByItem)[0];
      if (first && adoptRef.current && !soumissionIdRef.current) {
        adoptRef.current(first);
      }
    }
    const pending = await getPending();
    setPendingCount(pending.length);
    if (summary.remaining === 0 && summary.succeeded > 0) {
      setLastSavedAt(Date.now());
      setStatus('saved');
    } else if (summary.remaining > 0) {
      setStatus(onlineRef.current ? 'error' : 'offline');
    }
  }, [enabled]);

  // ── Debounced autosave on trigger change ──
  useEffect(() => {
    if (!enabled) return;
    if (isManualSaving) return;
    if (hasContent === false) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setStatus(prev => prev === 'saved' || prev === 'idle' ? 'pending' : prev);
    debounceTimerRef.current = setTimeout(() => {
      void runOneSave(false);
    }, debounceMs);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // We intentionally depend on `trigger` so the caller picks the watched values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, trigger, isManualSaving, hasContent, debounceMs]);

  // ── Flush on visibility change (iOS suspension) ──
  useEffect(() => {
    if (!enabled) return;
    const flushNow = () => { void runOneSave(true); };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushNow();
      }
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', flushNow);
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', flushNow);
    };
  }, [enabled, runOneSave]);

  // ── Drain the queue on `online` ──
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    const onOnline = () => { void drainQueue(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [enabled, drainQueue]);

  // ── React to the online flag flipping back to true (covers cases where the
  // event was missed because the hook mounted while offline). ──
  useEffect(() => {
    if (!enabled) return;
    if (online) void drainQueue();
  }, [enabled, online, drainQueue]);

  // ── Initial queue count on mount ──
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      const pending = await getPending();
      setPendingCount(pending.length);
      if (pending.length > 0) setStatus(onlineRef.current ? 'error' : 'offline');
    })();
  }, [enabled]);

  const saveNow = useCallback(() => runOneSave(true), [runOneSave]);

  return { status, lastSavedAt, pendingCount, saveNow, drainQueue };
}
