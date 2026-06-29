// Ventilation balance — parametric engine (Phase 1, pure).
//
// No legal rule is hard-coded: the rule (1/300 | 1/150), the intake/exhaust
// split and the areas are all inputs. If px↔ft/mm calibration is absent, the
// required NFA cannot be trusted → status "calibration_required".

import { VentilationInput, VentilationSummary } from "./types";

function denom(rule: VentilationInput["rule"]): number {
  return rule === "1/150" ? 150 : 300;
}

export function validateVentilationBalance(input: VentilationInput): VentilationSummary {
  const warnings: { code: string; message: string }[] = [];
  const intakeRatio = input.intakeRatio == null ? 0.5 : Math.max(0, Math.min(1, input.intakeRatio));
  const count = input.installed.length;

  // Provided exhaust = sum of installed Maximum NFA (unconfirmed NFA → warning).
  let providedExhaust: number | null = 0;
  let anyNfaKnown = false;
  for (const u of input.installed) {
    if (u.nfa_sq_in == null) {
      warnings.push({ code: "nfa_unconfirmed", message: `NFA non confirmé pour ${u.variant_id}` });
    } else { providedExhaust = (providedExhaust || 0) + u.nfa_sq_in; anyNfaKnown = true; }
  }
  if (count > 0 && !anyNfaKnown) providedExhaust = null;

  const providedIntake = input.soffit && input.soffit.ventilation_area_sq_in != null
    ? input.soffit.ventilation_area_sq_in : null;
  if (providedIntake == null) warnings.push({ code: "soffit_unknown", message: "Surface de soffite inconnue" });

  // Calibration gate: without it, attic area in real units is unreliable.
  if (!input.calibrationPresent) {
    warnings.push({ code: "calibration_required", message: "Calibration px↔pi/mm requise pour valider la ventilation" });
    return {
      rule: input.rule, status: "calibration_required",
      attic_area_sqft: input.atticAreaSqft,
      required_total_nfa_sq_in: null, required_exhaust_nfa_sq_in: null, required_intake_nfa_sq_in: null,
      provided_exhaust_nfa_sq_in: providedExhaust, provided_intake_nfa_sq_in: providedIntake,
      count_installed: count, count_required: null,
      ventilation_balance_status: "unknown", warnings,
    };
  }

  if (input.atticAreaSqft == null || input.atticAreaSqft <= 0) {
    warnings.push({ code: "attic_area_unknown", message: "Surface de grenier/toiture applicable inconnue" });
    return {
      rule: input.rule, status: "unknown",
      attic_area_sqft: input.atticAreaSqft,
      required_total_nfa_sq_in: null, required_exhaust_nfa_sq_in: null, required_intake_nfa_sq_in: null,
      provided_exhaust_nfa_sq_in: providedExhaust, provided_intake_nfa_sq_in: providedIntake,
      count_installed: count, count_required: null,
      ventilation_balance_status: "unknown", warnings,
    };
  }

  const requiredTotal = (input.atticAreaSqft / denom(input.rule)) * 144;  // sq in
  const requiredIntake = requiredTotal * intakeRatio;
  const requiredExhaust = requiredTotal * (1 - intakeRatio);

  // Required count from the smallest confirmed model NFA actually installed.
  const knownNfas = input.installed.map((u) => u.nfa_sq_in).filter((n): n is number => n != null && n > 0);
  const unitNfa = knownNfas.length ? Math.min.apply(null, knownNfas) : null;
  const countRequired = unitNfa ? Math.ceil(requiredExhaust / unitNfa) : null;

  let balance: VentilationSummary["ventilation_balance_status"] = "ok";
  if (providedExhaust == null) balance = "unknown";
  else if (providedExhaust < requiredExhaust) balance = "insufficient";
  if (providedIntake != null && providedIntake < requiredIntake && balance === "ok") balance = "warn";

  let status: VentilationSummary["status"] = "ok";
  if (balance === "insufficient") status = "insufficient";
  else if (balance === "unknown") status = "unknown";
  else if (balance === "warn" || providedIntake == null || warnings.some((w) => w.code === "nfa_unconfirmed")) status = "warn";

  return {
    rule: input.rule, status,
    attic_area_sqft: input.atticAreaSqft,
    required_total_nfa_sq_in: Math.round(requiredTotal),
    required_exhaust_nfa_sq_in: Math.round(requiredExhaust),
    required_intake_nfa_sq_in: Math.round(requiredIntake),
    provided_exhaust_nfa_sq_in: providedExhaust == null ? null : Math.round(providedExhaust),
    provided_intake_nfa_sq_in: providedIntake == null ? null : Math.round(providedIntake),
    count_installed: count, count_required: countRequired,
    ventilation_balance_status: balance, warnings,
  };
}
