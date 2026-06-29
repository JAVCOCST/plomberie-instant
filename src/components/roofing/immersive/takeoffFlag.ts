// Leaf module (no domain/engine imports) so importing the flag never pulls the
// roof-takeoff domain or roof-core engine into the eager wizard bundle.
// Off by default; on only when VITE_FEATURE_ROOF_TAKEOFF is "true"/"1".
export const ROOF_TAKEOFF_ENABLED: boolean = (() => {
  const v = (import.meta as any)?.env?.VITE_FEATURE_ROOF_TAKEOFF;
  return v === "true" || v === "1" || v === true;
})();
