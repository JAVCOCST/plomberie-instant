// factory.ts — construct a RoofTakeoff from a RoofModel (A → B init) or empty.
import type { RoofModel } from "@/lib/roof-core/types";
import { ROOF_MODEL_VERSION } from "@/lib/roof-core/types";
import { ENGINE_VERSION, ANNOTATION_VERSION } from "@/lib/roof-core/annotation";
import type {
  RoofTakeoff, RoofBusiness, SourceImagery, Calibration, RevisionState,
} from "./types";
import { ROOF_TAKEOFF_SCHEMA_VERSION } from "./types";
import { deriveRoofTakeoff, metersPerPxOf } from "./derive";
import { buildPricingInputs } from "./pricing-inputs";
import { validateRoofTakeoff } from "./validate";

const M_TO_FT = 3.28084;

function rid(): string {
  return "rt_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function emptyBusiness(): RoofBusiness {
  return { workScope: "refection", sectionRoleOverrides: {}, penetrations: [], accessories: [], overrides: [] };
}

function calibrationFromModel(model: RoofModel): Calibration {
  const mPerPx = metersPerPxOf(model);
  if (mPerPx > 0) {
    const s = model.scale!;
    return {
      status: s.source === "manual" ? "manual" : "auto_georef",
      metersPerPixel: mPerPx,
      pixelsPerMeter: 1 / mPerPx,
      scale: s.georef ? s.georef.scale_param : undefined,
      confidence: s.confidence,
      notes: s.provider ? "provider:" + s.provider : undefined,
    };
  }
  return { status: "uncalibrated", confidence: 0 };
}

function newRevision(): RevisionState {
  const now = new Date().toISOString();
  return { revision: 0, status: "draft", createdAt: now, updatedAt: now };
}

/** Build a fresh takeoff from a validated RoofModel. Strate B is derived; C empty. */
export function fromRoofModel(model: RoofModel, imagery?: SourceImagery | null, calibration?: Calibration): RoofTakeoff {
  const snapshotAt = new Date().toISOString();
  const business = emptyBusiness();
  const derived = deriveRoofTakeoff(model, snapshotAt);
  const base: RoofTakeoff = {
    id: rid(),
    metadata: { schemaVersion: ROOF_TAKEOFF_SCHEMA_VERSION, origin: "studio" },
    geometry: {
      snapshot: { roofModel: model, engineVersion: ENGINE_VERSION, annotationVersion: ANNOTATION_VERSION, snapshotAt },
      imagery: imagery || null,
      calibration: calibration || calibrationFromModel(model),
    },
    derived,
    business,
    pricing: {} as any,
    revision: newRevision(),
    validation: { level: "ok", issues: [], validatedByHuman: false },
  };
  base.pricing = buildPricingInputs(base);
  base.validation = validateRoofTakeoff(base);
  return base;
}

/** An empty takeoff (no geometry) — useful as a draft seed. */
export function emptyRoofTakeoff(): RoofTakeoff {
  const model: RoofModel = {
    version: ROOF_MODEL_VERSION,
    sections: [],
    metadata: { source: "human_corrected", status: "needs_review" },
  };
  return fromRoofModel(model, null, { status: "uncalibrated", confidence: 0 });
}
