import { describe, it, expect } from "vitest";
import { validateVentilationBalance } from "./ventilationValidation";
import { VARIANT_IDS, getVariant, nfaSqInOf, defaultSlopeOffsetMm } from "./catalog";
import { VentilationInput } from "./types";

const base: VentilationInput = {
  rule: "1/300",
  atticAreaSqft: 1500,
  calibrationPresent: true,
  installed: [{ variant_id: "301-22", nfa_sq_in: 484 }, { variant_id: "301-22", nfa_sq_in: 484 }],
  soffit: { ventilation_area_sq_in: 420, ventilated_length_ft: null, ventilated_width_in: null, open_ratio: null, source: "manual", confidence: "low", notes: "" },
};

describe("catalog (max-301.product-spec)", () => {
  it("exposes the 7 variants with official confirmed dimensions / NFA", () => {
    expect(VARIANT_IDS).toHaveLength(7);
    expect(getVariant("301-16")?.dimensions_official.A_col_mm).toBe(406);
    expect(getVariant("301-16")?.ventilation_official.nfa_sqin).toBe(256);
    expect(nfaSqInOf("301-22")).toBe(484);
    expect(getVariant("nope")).toBeNull();
  });
  it("computes the min slope offset from the spec auto-compute rule", () => {
    expect(defaultSlopeOffsetMm("301-16")).toBe(305);  // max(305, (406+90)/2+30=278)
    expect(defaultSlopeOffsetMm("301-24")).toBe(380);  // max(305, (610+90)/2+30=380)
  });
});

describe("validateVentilationBalance", () => {
  it("required NFA = area/rule*144 (1/300)", () => {
    const r = validateVentilationBalance(base);
    expect(r.required_total_nfa_sq_in).toBe(720);
    expect(r.required_exhaust_nfa_sq_in).toBe(360);
    expect(r.provided_exhaust_nfa_sq_in).toBe(968);
  });
  it("ok when exhaust and intake meet the requirement", () => {
    const r = validateVentilationBalance({ ...base, soffit: { ...base.soffit!, ventilation_area_sq_in: 400 } });
    expect(r.ventilation_balance_status).toBe("ok");
    expect(r.status).toBe("ok");
  });
  it("warns when intake (soffit) is below required", () => {
    const r = validateVentilationBalance({ ...base, soffit: { ...base.soffit!, ventilation_area_sq_in: 200 } });
    expect(r.ventilation_balance_status).toBe("warn");
  });
  it("insufficient when exhaust below required", () => {
    const r = validateVentilationBalance({ ...base, installed: [{ variant_id: "301-12", nfa_sq_in: 144 }] });
    expect(r.ventilation_balance_status).toBe("insufficient");
  });
  it("calibration_required when no calibration", () => {
    const r = validateVentilationBalance({ ...base, calibrationPresent: false });
    expect(r.status).toBe("calibration_required");
    expect(r.required_total_nfa_sq_in).toBeNull();
  });
  it("unknown when attic area missing", () => {
    expect(validateVentilationBalance({ ...base, atticAreaSqft: null }).status).toBe("unknown");
  });
  it("count_required from smallest installed NFA", () => {
    expect(validateVentilationBalance(base).count_required).toBe(1);  // 360 / 484 → 1
    expect(validateVentilationBalance(base).count_installed).toBe(2);
  });
});
