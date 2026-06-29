/**
 * Image compression utility for Vague A.
 *
 * Goal: shrink iPhone photos (often 10-15 MB HEIC/JPEG) below ~1.5 MB before
 * upload so the photo upload pipeline never times out and never lifts the UI.
 *
 * Implementation choices:
 *   - `createImageBitmap()` + `OffscreenCanvas` when available → runs the
 *     decode/encode off the React render thread.
 *   - Plain `<canvas>` fallback when OffscreenCanvas is unavailable (older
 *     Safari) — still keeps the main thread minimally busy since the heavy
 *     decode is browser-internal.
 *   - HEIC/HEIF inputs are converted to JPEG via the `heic2any` package,
 *     loaded lazily ONLY if the file actually needs it (no bundle cost for
 *     the 99% of users on JPEG/PNG).
 *
 * If anything fails (private mode, decoder error, missing encoder, etc.) we
 * surface the original file unchanged: the upload may be larger but it will
 * NEVER be dropped, which is the contract Vague A promises.
 */

export interface CompressOptions {
  /** Bytes — files at or below this are returned unchanged. Default 1.5 MB. */
  maxBytes?: number;
  /** Pixel cap on the longest side. Default 2048. */
  maxSide?: number;
  /** JPEG quality 0..1. Default 0.82 (matches the handoff spec). */
  quality?: number;
  /** Force JPEG output, even for transparent PNGs (default true). */
  forceJpeg?: boolean;
}

const DEFAULTS: Required<CompressOptions> = {
  maxBytes: 1.5 * 1024 * 1024,
  maxSide: 2048,
  quality: 0.82,
  forceJpeg: true,
};

function isHeicLike(file: File | Blob): boolean {
  const t = (file as File).type || '';
  const n = ((file as File).name || '').toLowerCase();
  if (t === 'image/heic' || t === 'image/heif') return true;
  if (n.endsWith('.heic') || n.endsWith('.heif')) return true;
  return false;
}

async function decodeBitmap(blob: Blob): Promise<{ width: number; height: number; src: ImageBitmap | HTMLImageElement }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(blob);
      return { width: bm.width, height: bm.height, src: bm };
    } catch {
      /* fall through */
    }
  }
  // Fallback: Image element
  const url = URL.createObjectURL(blob);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = (e) => reject(e);
    i.src = url;
  });
  // Release the object URL right after the bitmap is decoded into the
  // browser cache; the HTMLImageElement keeps its own internal reference.
  try { URL.revokeObjectURL(url); } catch { /* noop */ }
  return { width: img.naturalWidth, height: img.naturalHeight, src: img };
}

function targetDims(w: number, h: number, maxSide: number): { w: number; h: number } {
  if (w <= maxSide && h <= maxSide) return { w, h };
  const scale = maxSide / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

async function encodeJpeg(
  source: ImageBitmap | HTMLImageElement,
  w: number,
  h: number,
  quality: number,
): Promise<Blob> {
  const OC = (typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : null) as
    | typeof OffscreenCanvas
    | null;
  if (OC) {
    const c = new OC(w, h);
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No 2D context (offscreen)');
    // OffscreenCanvas accepts ImageBitmap; HTMLImageElement also works via drawImage.
    (ctx as any).drawImage(source as any, 0, 0, w, h);
    return (c as any).convertToBlob({ type: 'image/jpeg', quality });
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No 2D context (canvas)');
  ctx.drawImage(source as any, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    c.toBlob(b => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', quality);
  });
}

async function compressOnce(blob: Blob, opts: Required<CompressOptions>): Promise<Blob> {
  const decoded = await decodeBitmap(blob);
  const { w, h } = targetDims(decoded.width, decoded.height, opts.maxSide);
  try {
    return await encodeJpeg(decoded.src, w, h, opts.quality);
  } finally {
    if (typeof (decoded.src as any).close === 'function') (decoded.src as any).close();
  }
}

/** Convert a HEIC/HEIF file to JPEG via lazy-loaded `heic2any`. */
async function convertHeicToJpeg(file: File, quality: number): Promise<Blob> {
  // Lazy import — we only pay the bundle cost when an admin actually uploads a HEIC.
  try {
    const mod: any = await import(/* @vite-ignore */ 'heic2any');
    const converter = (mod && (mod.default || mod)) as any;
    const out = await converter({ blob: file, toType: 'image/jpeg', quality });
    return Array.isArray(out) ? out[0] : (out as Blob);
  } catch (e) {
    console.warn('[image-compress] heic2any unavailable, returning original:', e);
    return file;
  }
}

/**
 * Compress a single image. Returns the original blob if the file is already
 * small enough, if it's not an image, or if compression fails.
 *
 * Always returns a Blob — the caller can upload it as-is. The result preserves
 * `.name` via the returned `name` property (since Blob has no name field).
 */
export async function compressImageFile(
  file: File,
  options: CompressOptions = {},
): Promise<{ blob: Blob; name: string; originalSize: number; finalSize: number; converted: boolean }> {
  const opts: Required<CompressOptions> = { ...DEFAULTS, ...options };
  const originalSize = file.size;
  // Non-image → no-op
  if (!file.type.startsWith('image/') && !isHeicLike(file)) {
    return { blob: file, name: file.name, originalSize, finalSize: originalSize, converted: false };
  }
  let working: Blob = file;
  let convertedHeic = false;
  if (isHeicLike(file)) {
    try {
      working = await convertHeicToJpeg(file, opts.quality);
      convertedHeic = true;
    } catch (e) {
      console.warn('[image-compress] HEIC conversion failed:', e);
      return { blob: file, name: file.name, originalSize, finalSize: originalSize, converted: false };
    }
  } else if (working.size <= opts.maxBytes && !opts.forceJpeg) {
    // Already small enough and we don't need to force JPEG
    return { blob: file, name: file.name, originalSize, finalSize: originalSize, converted: false };
  }
  try {
    let out = await compressOnce(working, opts);
    // If still too big, take ONE more pass with a halved maxSide and slightly lower quality.
    if (out.size > opts.maxBytes) {
      const opts2: Required<CompressOptions> = {
        ...opts,
        maxSide: Math.max(1024, Math.round(opts.maxSide / Math.SQRT2)),
        quality: Math.max(0.6, opts.quality - 0.1),
      };
      const out2 = await compressOnce(working, opts2);
      if (out2.size < out.size) out = out2;
    }
    // If we made it WORSE (very small inputs sometimes round up), keep the original.
    if (out.size >= originalSize && !convertedHeic) {
      return { blob: file, name: file.name, originalSize, finalSize: originalSize, converted: false };
    }
    const newName = jpegName(file.name, convertedHeic);
    return { blob: out, name: newName, originalSize, finalSize: out.size, converted: true };
  } catch (e) {
    console.warn('[image-compress] encode failed, returning original:', e);
    return { blob: file, name: file.name, originalSize, finalSize: originalSize, converted: false };
  }
}

function jpegName(orig: string, fromHeic: boolean): string {
  const base = orig.replace(/\.[^.]+$/, '');
  return `${base}${fromHeic ? '_jpg' : ''}.jpg`;
}
