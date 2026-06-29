// takeoffBridge.ts — GLUE (quote side): adapt the studio's emitted model into a
// roof-core RoofModel, then drive the roof-takeoff domain. Pure + testable.
//
// Direction respected: this file lives in the quote layer and imports
// roof-takeoff + roof-core (quote → roof-takeoff → roof-core). roof-takeoff
// itself stays unaware of the studio/annotation format — the adaptation lives
// here, at the boundary.
import type { RoofModel } from "@/lib/roof-core/types";
import type { FormData } from "@/types/roofing";
import type { RoofTakeoff, SourceImagery, ValidationState } from "@/lib/roof-takeoff/types";
import { fromRoofModel, toFormDataPatch, validateRoofTakeoff } from "@/lib/roof-takeoff";

const M_TO_FT = 3.28084;

// The feature flag lives in the leaf module ./takeoffFlag (re-exported here for
// convenience) so importing it never drags the domain into the eager bundle.
export { ROOF_TAKEOFF_ENABLED } from "./takeoffFlag";

/**
 * Adapt whatever AdminRoofStudio emits via onValidate (the v2 annotation object:
 * sections + calibration.gsd + georef + image) into a roof-core RoofModel (v1).
 * Pure; tolerant of missing blocks.
 */
export function studioModelToRoofModel(m: any): RoofModel {
  const sections = ((m && m.sections) || []).map((s: any) => ({
    pts: (s.pts || []).map((p: any) => ({ x: p.x, y: p.y })),
    closed: true as const,
    pitch: s.pitch || 7,
    elev: s.elev || 0,
    hf: s.hf || 0,
    roof_type: s.roof_type === "gable" ? ("gable" as const) : ("hip" as const),
    // Préserve les overrides de nœuds manuels (déplacement de faîtiers) à travers
    // le pont, sinon le brouillon (Fermer) les perdrait.
    _no: s._no || {},
  }));

  const gsd: number | undefined = m && m.calibration && m.calibration.gsd; // metres/pixel
  const geo = m && m.georef;
  let scale: RoofModel["scale"];
  if (gsd && gsd > 0) {
    const ftPerPx = gsd * M_TO_FT;
    scale = {
      ft_per_px: ftPerPx,
      px_per_ft: 1 / ftPerPx,
      source: "georef",
      confidence: 0.9,
      provider: geo ? geo.provider : undefined,
      georef: geo
        ? { zoom: geo.zoom, center_lat: geo.center_lat, center_lng: geo.center_lng, scale_param: geo.scale || 1, image_w: geo.image_w, image_h: geo.image_h, provider: geo.provider }
        : undefined,
    };
  }

  return {
    version: 1,
    image: m && m.image ? { width: m.image.width, height: m.image.height } : undefined,
    scale,
    sections,
    metadata: { source: "human_corrected", status: "validated" },
  };
}

/** Imagery descriptor (strate A) from the emitted model's georef, if any. */
export function imageryFromModel(m: any): SourceImagery | null {
  const g = m && m.georef;
  if (!g) return null;
  const provider = g.provider === "ortho" ? "orthoqc_wmts" : g.provider === "google" ? "google_satellite" : "upload";
  return {
    provider, capturedAt: new Date().toISOString(),
    centerLat: g.center_lat, centerLng: g.center_lng, zoom: g.zoom,
    widthPx: g.image_w, heightPx: g.image_h,
  };
}

/**
 * Pure validate-handler: emitted studio model → { takeoff, validation, patch }.
 * The caller (TakeoffFullscreen) persists the draft, applies the patch, and
 * closes only when validation is non-blocking.
 */
export function buildTakeoffFromStudio(emitted: any): {
  takeoff: RoofTakeoff; validation: ValidationState; patch: Partial<FormData>;
} {
  const model = studioModelToRoofModel(emitted);
  const takeoff = fromRoofModel(model, imageryFromModel(emitted));
  const validation = validateRoofTakeoff(takeoff);
  const patch = toFormDataPatch(takeoff) as any;
  // Accessoires (Maximum 301) ne font PAS partie du RoofModel — on les compte ici,
  // à la frontière, pour les transmettre à la soumission (mesure « Maximum - 3D »).
  const acc = (emitted && emitted.accessories) || [];
  patch.roof3dMaximumCount = acc.filter((a: any) => String(a && a.variant_id || "301").startsWith("301")).length;
  return { takeoff, validation, patch };
}

/** Validation blocks closing the overlay only on an error level. */
export function isBlocking(v: ValidationState): boolean {
  return v.level === "error";
}
