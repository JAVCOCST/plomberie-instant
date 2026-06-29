// takeoffMetrics — DEV-ONLY lightweight UX instrumentation for the takeoff flow.
//
// No external analytics, no backend, no user tracking. Everything short-circuits
// to a no-op when import.meta.env.DEV is false, so production carries zero cost.
// Output goes to console.debug only, for field/UX observation during dev builds.
const DEV: boolean = !!((import.meta as any)?.env?.DEV);
const NOW = (): number => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
const counters: Record<string, number> = {};

export const ux = {
  /** One-off event with optional payload. */
  event(name: string, data?: unknown): void {
    if (DEV) console.debug("[takeoff] " + name, data !== undefined ? data : "");
  },
  /** Incrementing counter (e.g. autosave, draft_restore). */
  count(name: string): number {
    if (!DEV) return 0;
    counters[name] = (counters[name] || 0) + 1;
    console.debug("[takeoff] " + name + " ×" + counters[name]);
    return counters[name];
  },
  /** Start a timer; call the returned fn to log elapsed ms. Returns ms. */
  time(name: string): () => number {
    if (!DEV) return () => 0;
    const t0 = NOW();
    return () => { const ms = NOW() - t0; console.debug("[takeoff] " + name + ": " + ms.toFixed(1) + "ms"); return ms; };
  },
  get enabled() { return DEV; },
};
