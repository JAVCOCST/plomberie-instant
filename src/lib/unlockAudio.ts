// Centralized, idempotent audio unlock for iOS / Safari / Chrome.
// MUST be called synchronously inside a real user gesture handler
// (pointerdown / touchstart / click). No awaits before the first
// AudioContext.resume() and silent-buffer playback.

type WindowWithWebkitAudio = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let audioUnlocked = false;

export const getSharedAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  if (audioContext) return audioContext;
  try {
    const Ctx = window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
    return audioContext;
  } catch {
    return null;
  }
};

export const isAudioUnlocked = () => audioUnlocked;

/**
 * Unlock audio on the current device.
 * Safe to call multiple times — only runs once.
 * Returns true if unlocked (or already unlocked), false on failure.
 */
export const unlockAudio = (): boolean => {
  if (audioUnlocked) return true;
  const ctx = getSharedAudioContext();
  if (!ctx) return false;

  try {
    // Resume synchronously inside the gesture (no await — iOS needs the
    // resume call to be issued in the same tick as the user gesture).
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    // Play a 1-sample silent buffer to fully wake iOS' audio gate.
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);

    audioUnlocked = true;
    return true;
  } catch {
    return false;
  }
};

/**
 * Attach one-shot global gesture listeners that unlock audio on the very
 * first user interaction anywhere in the app. Returns a cleanup function.
 */
export const installGlobalAudioUnlock = (): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  if (audioUnlocked) return () => {};

  const handler = () => {
    unlockAudio();
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('touchstart', handler);
    window.removeEventListener('click', handler);
    window.removeEventListener('keydown', handler);
  };
  window.addEventListener('pointerdown', handler, { passive: true });
  window.addEventListener('touchstart', handler, { passive: true });
  window.addEventListener('click', handler, { passive: true });
  window.addEventListener('keydown', handler);
  return cleanup;
};