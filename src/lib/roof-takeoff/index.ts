// roof-takeoff — business quantification domain (barrel).
// Dependency direction: quote → roof-takeoff → roof-core. Never the inverse.
export * from "./types";
export { deriveRoofTakeoff, isDerivedStale, slopeLevelFromX12, x12ToDeg, metersPerPxOf } from "./derive";
export { buildPricingInputs, deriveComplexity } from "./pricing-inputs";
export { toFormDataPatch } from "./quote-binding";
export { validateRoofTakeoff } from "./validate";
export { fromRoofModel, emptyRoofTakeoff } from "./factory";
export { migrateRoofTakeoff, cmpSchemaVersion } from "./migrate";
