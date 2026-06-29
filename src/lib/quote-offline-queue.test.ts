import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock idb-keyval with an in-memory store so the queue is testable in jsdom.
let mem: Map<string, unknown>;
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => mem.get(k)),
  set: vi.fn(async (k: string, v: unknown) => { mem.set(k, v); }),
  del: vi.fn(async (k: string) => { mem.delete(k); }),
}));

import { enqueue, flush, getPending, clearAll, type FlushResult, type QueuedSave } from './quote-offline-queue';

beforeEach(() => {
  mem = new Map();
});

describe('quote-offline-queue', () => {
  it('enqueue + getPending stores items in order', async () => {
    await enqueue('insert', null, { a: 1 });
    await enqueue('update', 'soum-1', { b: 2 });
    const q = await getPending();
    expect(q).toHaveLength(2);
    expect(q[0].kind).toBe('insert');
    expect(q[1].soumissionId).toBe('soum-1');
    expect(q[0].id).not.toBe(q[1].id);
  });

  it('flush returns 0 attempts when offline', async () => {
    await enqueue('update', 'a', { foo: 1 });
    const exec = vi.fn(async (): Promise<FlushResult> => ({ ok: true }));
    const s = await flush(false, exec);
    expect(s.attempted).toBe(0);
    expect(s.remaining).toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });

  it('flush succeeds and drops successful items', async () => {
    await enqueue('update', 'a', { foo: 1 });
    await enqueue('update', 'b', { foo: 2 });
    const exec = vi.fn(async (): Promise<FlushResult> => ({ ok: true }));
    const s = await flush(true, exec);
    expect(s.attempted).toBe(2);
    expect(s.succeeded).toBe(2);
    expect(s.remaining).toBe(0);
    const q = await getPending();
    expect(q).toHaveLength(0);
  });

  it('flush stops on first soft failure and bumps attempts', async () => {
    await enqueue('update', 'a', { foo: 1 });
    await enqueue('update', 'b', { foo: 2 });
    const exec = vi.fn(async (item: QueuedSave): Promise<FlushResult> => {
      if (item.soumissionId === 'a') return { ok: false };
      return { ok: true };
    });
    const s = await flush(true, exec);
    expect(s.attempted).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.remaining).toBe(2); // both kept (one with bumped attempts)
    const q = await getPending();
    expect(q[0].attempts).toBe(1);
    expect(q[1].attempts).toBe(0);
  });

  it('flush drops fatal failures', async () => {
    await enqueue('update', 'a', { foo: 1 });
    const exec = vi.fn(async (): Promise<FlushResult> => ({ ok: false, fatal: true }));
    const s = await flush(true, exec);
    expect(s.attempted).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.remaining).toBe(0);
  });

  it('flush captures newIdByItem when insert succeeds with a newId', async () => {
    await enqueue('insert', null, { foo: 1 });
    const exec = vi.fn(async (): Promise<FlushResult> => ({ ok: true, newId: 'new-123' }));
    const s = await flush(true, exec);
    expect(Object.values(s.newIdByItem)[0]).toBe('new-123');
  });

  it('clearAll empties the queue', async () => {
    await enqueue('update', 'a', { foo: 1 });
    await clearAll();
    const q = await getPending();
    expect(q).toHaveLength(0);
  });

  it('flush keeps order: items not yet attempted remain after the one that failed', async () => {
    await enqueue('update', 'a', { i: 1 });
    await enqueue('update', 'b', { i: 2 });
    await enqueue('update', 'c', { i: 3 });
    let calls = 0;
    const exec = vi.fn(async (): Promise<FlushResult> => {
      calls += 1;
      return calls === 1 ? { ok: false } : { ok: true };
    });
    const s = await flush(true, exec);
    expect(s.attempted).toBe(1);
    expect(s.remaining).toBe(3);
    const q = await getPending();
    expect((q[0].payload as any).i).toBe(1);
    expect((q[1].payload as any).i).toBe(2);
    expect((q[2].payload as any).i).toBe(3);
  });
});
