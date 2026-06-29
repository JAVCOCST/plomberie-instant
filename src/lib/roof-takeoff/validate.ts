// validate.ts — minimal, pure validation of a RoofTakeoff.
import type { RoofTakeoff, ValidationState, ValidationIssue, ValidationLevel } from "./types";
import { isDerivedStale } from "./derive";

function worst(a: ValidationLevel, b: ValidationLevel): ValidationLevel {
  const rank = { ok: 0, warning: 1, error: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/** Validate a takeoff. Pure: derives the level from collected issues. */
export function validateRoofTakeoff(t: RoofTakeoff): ValidationState {
  const issues: ValidationIssue[] = [];
  const mm = t.derived && t.derived.measurements;

  if (!t.geometry.snapshot.roofModel.sections || t.geometry.snapshot.roofModel.sections.length === 0) {
    issues.push({ code: "NO_SECTIONS", level: "error", message: "Aucune section de toiture.", path: "geometry.snapshot.roofModel.sections" });
  }
  if (t.geometry.calibration.status === "uncalibrated") {
    issues.push({ code: "UNCALIBRATED", level: "warning", message: "Échelle absente — surfaces réelles indisponibles.", path: "geometry.calibration" });
  }
  if (mm && mm.roof3dAreaM2 <= 0) {
    issues.push({ code: "ZERO_AREA", level: "error", message: "Surface de toiture nulle.", path: "derived.measurements.roof3dAreaM2" });
  }
  if (isDerivedStale(t)) {
    issues.push({ code: "DERIVED_STALE", level: "warning", message: "Données dérivées désynchronisées du snapshot — recalcul requis.", path: "derived" });
  }
  (mm ? mm.diagnostics.warnings : []).forEach((w, i) =>
    issues.push({ code: "DIAGNOSTIC", level: "warning", message: w, path: "derived.measurements.diagnostics.warnings[" + i + "]" }));

  const level = issues.reduce<ValidationLevel>((acc, it) => worst(acc, it.level), "ok");
  return {
    level,
    issues,
    validatedByHuman: t.validation ? t.validation.validatedByHuman : false,
    validatedAt: t.validation ? t.validation.validatedAt : undefined,
  };
}
