import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock idb-keyval with in-memory storage so the offline queue is testable.
let mem: Map<string, unknown>;
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => mem.get(k)),
  set: vi.fn(async (k: string, v: unknown) => { mem.set(k, v); }),
  del: vi.fn(async (k: string) => { mem.delete(k); }),
}));

import { useQuoteAutosave } from './useQuoteAutosave';
import { getPending } from '@/lib/quote-offline-queue';

beforeEach(() => {
  mem = new Map();
});

describe('useQuoteAutosave', () => {
  it('is a no-op when enabled=false (no save, no queue)', async () => {
    const exec = vi.fn(async () => ({ ok: true as const }));
    const build = () => ({ foo: 1 });
    const { result } = renderHook(() => useQuoteAutosave({
      enabled: false,
      soumissionId: null,
      online: true,
      buildPayload: build,
      executeSave: exec,
      trigger: build,
      hasContent: true,
    }));
    await new Promise(r => setTimeout(r, 50));
    expect(exec).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('debounces saves and calls executeSave with insert when no soumissionId', async () => {
    const exec = vi.fn(async () => ({ ok: true as const, newId: 'new-1' }));
    const onAdopt = vi.fn();
    const build = () => ({ first_name: 'A' });
    const { result } = renderHook(() => useQuoteAutosave({
      enabled: true,
      soumissionId: null,
      online: true,
      buildPayload: build,
      executeSave: exec,
      onAdoptNewId: onAdopt,
      trigger: build,
      hasContent: true,
      debounceMs: 30,
    }));
    await waitFor(() => expect(exec).toHaveBeenCalled(), { timeout: 500 });
    expect(exec).toHaveBeenCalledWith('insert', null, expect.objectContaining({ first_name: 'A' }));
    expect(onAdopt).toHaveBeenCalledWith('new-1');
    expect(result.current.status).toBe('saved');
    expect(result.current.lastSavedAt).toBeGreaterThan(0);
  });

  it('enqueues to IndexedDB when offline', async () => {
    const exec = vi.fn(async () => ({ ok: true as const }));
    const build = () => ({ foo: 1 });
    renderHook(() => useQuoteAutosave({
      enabled: true,
      soumissionId: 'soum-1',
      online: false,
      buildPayload: build,
      executeSave: exec,
      trigger: build,
      hasContent: true,
      debounceMs: 30,
    }));
    await waitFor(async () => {
      const q = await getPending();
      expect(q.length).toBeGreaterThan(0);
    }, { timeout: 500 });
    // executeSave was never called because we're offline.
    expect(exec).not.toHaveBeenCalled();
  });

  it('drains the queue when going back online', async () => {
    // Pre-seed the queue with one item.
    const exec = vi.fn(async () => ({ ok: true as const }));
    const build = () => ({ foo: 1 });
    const { rerender } = renderHook(({ online }: { online: boolean }) => useQuoteAutosave({
      enabled: true,
      soumissionId: 'soum-1',
      online,
      buildPayload: build,
      executeSave: exec,
      trigger: build,
      hasContent: true,
      debounceMs: 30,
    }), { initialProps: { online: false } });
    // Enqueue happens via the debounced save fail path.
    await waitFor(async () => {
      const q = await getPending();
      expect(q.length).toBeGreaterThan(0);
    }, { timeout: 500 });
    // Now flip online to true.
    rerender({ online: true });
    await waitFor(async () => {
      const q = await getPending();
      expect(q.length).toBe(0);
    }, { timeout: 500 });
    expect(exec).toHaveBeenCalled();
  });

  it('skips saves while isManualSaving is true (race protection)', async () => {
    const exec = vi.fn(async () => ({ ok: true as const }));
    const build = () => ({ foo: 1 });
    const { rerender } = renderHook(({ saving }: { saving: boolean }) => useQuoteAutosave({
      enabled: true,
      soumissionId: 'soum-1',
      online: true,
      isManualSaving: saving,
      buildPayload: build,
      executeSave: exec,
      trigger: build,
      hasContent: true,
      debounceMs: 30,
    }), { initialProps: { saving: true } });
    await new Promise(r => setTimeout(r, 80));
    expect(exec).not.toHaveBeenCalled();
    // Release the manual save lock — debounce should fire.
    rerender({ saving: false });
    await waitFor(() => expect(exec).toHaveBeenCalled(), { timeout: 500 });
  });

  it('skips when hasContent is false (does not write a sentinel-only row)', async () => {
    const exec = vi.fn(async () => ({ ok: true as const }));
    const build = () => ({ foo: 1 });
    renderHook(() => useQuoteAutosave({
      enabled: true,
      soumissionId: null,
      online: true,
      buildPayload: build,
      executeSave: exec,
      trigger: build,
      hasContent: false,
      debounceMs: 30,
    }));
    await new Promise(r => setTimeout(r, 80));
    expect(exec).not.toHaveBeenCalled();
  });
});
