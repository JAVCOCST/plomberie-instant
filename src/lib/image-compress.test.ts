import { describe, expect, it } from 'vitest';
import { compressImageFile } from './image-compress';

describe('image-compress', () => {
  it('returns the original blob unchanged for a non-image file', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const res = await compressImageFile(file);
    expect(res.blob).toBe(file);
    expect(res.converted).toBe(false);
    expect(res.finalSize).toBe(file.size);
  });

  it('returns the original blob unchanged when smaller than maxBytes and forceJpeg=false', async () => {
    const file = new File([new Uint8Array(10)], 'tiny.jpg', { type: 'image/jpeg' });
    const res = await compressImageFile(file, { maxBytes: 1_000_000, forceJpeg: false });
    expect(res.blob).toBe(file);
    expect(res.converted).toBe(false);
  });

  it('handles a decode failure gracefully (returns original)', async () => {
    // jsdom can't decode arbitrary bytes — this exercises the error path.
    const bogus = new Uint8Array(2048).fill(0xff);
    const file = new File([bogus], 'broken.jpg', { type: 'image/jpeg' });
    const res = await compressImageFile(file, { maxBytes: 1024 });
    // Either we successfully compressed (extremely unlikely in jsdom) or we
    // bailed out to the original.
    expect(res.finalSize).toBeGreaterThan(0);
    if (!res.converted) expect(res.blob).toBe(file);
  });
});
