/**
 * Feature flags for AdminQuoteGenerator Vague A (mobile prod readiness).
 *
 * Master flag: VITE_QUOTE_MOBILE_V2
 *   - When false/unset → the page behaves EXACTLY like before (bit-identical).
 *   - When true → enables: Supabase autosave hook + offline queue + scoped draft +
 *     reset before load + destructive confirmations + image compression +
 *     save status indicator.
 *
 * Sub-flags (default to the master flag value) allow finer rollback per concern.
 */

const FALSY = new Set(['', '0', 'false', 'off', 'no', undefined]);

function readEnv(name: string): string | undefined {
  try {
    // import.meta.env is statically replaced by Vite at build time.
    const v = (import.meta as any)?.env?.[name];
    return typeof v === 'string' ? v : v == null ? undefined : String(v);
  } catch {
    return undefined;
  }
}

function flag(name: string, fallback?: boolean): boolean {
  const raw = readEnv(name);
  if (raw === undefined) return !!fallback;
  return !FALSY.has(String(raw).trim().toLowerCase());
}

/** Master flag — when OFF, every Vague A feature is off and the page is unchanged. */
export const QUOTE_MOBILE_V2 = flag('VITE_QUOTE_MOBILE_V2', false);

/** Supabase autosave + offline queue + scoped draft + reset-before-load + indicator. */
export const FEATURE_AUTOSAVE = flag('VITE_QUOTE_FEATURE_AUTOSAVE', QUOTE_MOBILE_V2);

/** Destructive action confirmation dialogs (Nouveau / Tout effacer). */
export const FEATURE_CONFIRM_DESTRUCTIVE = flag(
  'VITE_QUOTE_FEATURE_CONFIRM_DESTRUCTIVE',
  QUOTE_MOBILE_V2,
);

/** Web-Worker image compression + HEIC conversion before upload. */
export const FEATURE_IMAGE_COMPRESSION = flag(
  'VITE_QUOTE_FEATURE_IMAGE_COMPRESSION',
  QUOTE_MOBILE_V2,
);
