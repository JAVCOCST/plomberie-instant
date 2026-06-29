// ─────────────────────────────────────────────────────────────
// RoofTakeoff — business quantification domain model (Phase 1A).
//
// Depends on roof-core (geometry types) ONLY. Never imports the quote module
// (components/roofing, FormContext, pricing-*). Dependency direction is strict:
//     quote → roof-takeoff → roof-core
//
// Four explicit strata (see docs/quoteroofmodelphase05architecture.md):
//   A. RoofGeometry  — frozen RoofModel snapshot + imagery + calibration
//   B. RoofDerived   — pure, recomputable quantities (from A, via roof-core)
//   C. RoofBusiness  — human decisions (NOT recomputable — protect on persist)
//   D. PricingInputs — consumable inputs for the quote pricing (from B + C)
// ─────────────────────────────────────────────────────────────
import type { RoofModel } from "@/lib/roof-core/types";
import type { SlopeLevel, ComplexityLevel } from "@/types/roofing";

export const ROOF_TAKEOFF_SCHEMA_VERSION = "1.0.0";

export type Unit = "m" | "ft";
export type { SlopeLevel, ComplexityLevel };

// ===== STRATE A — RAW GEOMETRY =====
export interface SourceImagery {
  provider: "google_satellite" | "orthoqc_wmts" | "upload";
  capturedAt: string;            // ISO
  centerLat: number; centerLng: number; zoom: number;
  bounds?: { north: number; south: number; east: number; west: number };
  imageUrl?: string;             // storage path (never a persisted data-URL)
  widthPx?: number; heightPx?: number;
}

export interface Calibration {
  status: "auto_georef" | "manual" | "uncalibrated";
  pixelsPerMeter?: number;
  metersPerPixel?: number;
  scale?: number;
  confidence?: number;           // 0..1
  notes?: string;
}

export interface RoofModelSnapshot {
  roofModel: RoofModel;          // frozen pure geometry
  engineVersion: string;         // roof-core ENGINE_VERSION
  annotationVersion: number;     // roof-core ANNOTATION_VERSION
  snapshotAt: string;            // ISO
}

export interface RoofGeometry {
  snapshot: RoofModelSnapshot;
  imagery: SourceImagery | null;
  calibration: Calibration;
}

// ===== STRATE B — DERIVED (pure, recomputable) =====
export type SectionType = "MAIN" | "SECONDARY" | "GARAGE" | "DORMER" | "FLAT" | "UNKNOWN";
export type EdgeKind = "RIDGE" | "VALLEY" | "HIP" | "EAVE" | "RAKE";
export type QualityFlag = "VERIFIED" | "ESTIMATED" | "UNCERTAIN";

export interface DerivedSection {
  id: string;
  type: SectionType;
  areaFootprintM2: number;       // plan (ground) projection
  area3dM2: number;              // true sloped area
  pitchDeg: number;
  pitchX12: number;              // QC roofing slope X/12
  aspectDeg: number;             // dominant orientation (0 when unknown)
  perimeterM: number;
  quality: QualityFlag;
}

export interface DerivedSlope {
  sectionId: string;
  pitchDeg: number; pitchX12: number;
  level: SlopeLevel;
}

export interface DerivedEdge {
  id: string; kind: EdgeKind;
  lengthM: number;
  sectionA?: string; sectionB?: string;
}

export interface DerivedMeasurements {
  footprintAreaM2: number;
  roof3dAreaM2: number;
  totalPerimeterM: number;
  linealByKind: Record<EdgeKind, number>;   // metres per edge kind
  dominantPitchX12: number;
  dominantSlopeLevel: SlopeLevel;
  sectionCount: number;
  // Sloped roof area split by pitch (X/12 key → m²). Surfaces the per-pitch
  // breakdown the soumission needs ("Surface toiture - 3D : 1/12, 2/12…").
  areaByPitchM2?: Record<string, number>;
  // Ice & water membrane run (metres) = eave + valley, from computeMeasures.
  membraneM?: number;
  diagnostics: {
    coveragePct: number;
    overlapPct: number;
    warnings: string[];
  };
}

export interface RoofDerived {
  sections: DerivedSection[];
  slopes: DerivedSlope[];
  ridges: DerivedEdge[];
  hips: DerivedEdge[];
  valleys: DerivedEdge[];
  eaves: DerivedEdge[];
  rakes: DerivedEdge[];
  measurements: DerivedMeasurements;
  computedAt: string;            // ISO
  derivedFromSnapshotAt: string; // must equal geometry.snapshot.snapshotAt
}

// ===== STRATE C — BUSINESS (human decisions) =====
export type WorkScope = "refection" | "nouvelle_couverture" | "reparation" | "inspection";

export interface Penetration {
  id: string;
  kind: "cheminee" | "puits_lumiere" | "event" | "tuyau" | "trappe" | "autre";
  sectionId?: string;
  anchor?: unknown;              // AccessoryAnchor (roof-accessories) — not hard-coupled
  countAsUnit: boolean;
  note?: string;
}

export interface AccessoryItem {
  id: string;
  catalogId?: string;
  kind: string;                  // roof vent, max-301, flashing, …
  quantity: number;
  unit: "unite" | "ml" | "m2";
  anchor?: unknown;
}

export interface ManualOverride {
  field: string;                 // e.g. "measurements.roof3dAreaM2"
  value: number | string;
  reason?: string;
  by?: string; at: string;
}

export interface RoofBusiness {
  workScope: WorkScope;
  sectionRoleOverrides: Record<string, SectionType>;
  complexityOverride?: ComplexityLevel;
  slopeOverride?: SlopeLevel;
  penetrations: Penetration[];
  accessories: AccessoryItem[];
  overrides: ManualOverride[];
  notes?: string;
}

// ===== STRATE D — PRICING INPUTS (derived + adjustable) =====
export interface PricingInputs {
  footprintAreaSqft: number;
  roof3dAreaSqft: number;
  perimeterFt: number;
  slopeLevel: SlopeLevel;
  complexityLevel: ComplexityLevel;
  linealFt: { ridge: number; hip: number; valley: number; eave: number; rake: number };
  accessoryCounts: Record<string, number>;
  wasteFactorPct: number;        // default 10
  source: "derived" | "derived_with_overrides" | "manual";
}

// ===== CROSS-CUTTING =====
export interface RevisionState {
  revision: number;
  parentRevision?: number;
  status: "draft" | "autosaved" | "validated" | "superseded";
  createdAt: string; updatedAt: string;
  createdBy?: string;
}

export type ValidationLevel = "ok" | "warning" | "error";
export interface ValidationIssue { code: string; level: ValidationLevel; message: string; path?: string; }
export interface ValidationState {
  level: ValidationLevel;
  issues: ValidationIssue[];
  validatedByHuman: boolean;
  validatedAt?: string;
}

export interface TakeoffMetadata {
  schemaVersion: string;         // ROOF_TAKEOFF_SCHEMA_VERSION
  soumissionId?: string;
  trainingTakeoffId?: string;
  origin: "studio" | "import" | "manual";
  label?: string; address?: string;
}

// Dirty/derived-invalidation foundations (no runtime/event-bus yet — Phase 2):
// a derived block is stale when derivedFromSnapshotAt !== geometry.snapshot.snapshotAt.
// See isDerivedStale() in derive.ts.

// ===== ROOT AGGREGATE =====
export interface RoofTakeoff {
  id: string;
  metadata: TakeoffMetadata;
  geometry: RoofGeometry;        // A
  derived: RoofDerived;          // B (recomputable)
  business: RoofBusiness;        // C
  pricing: PricingInputs;        // D
  revision: RevisionState;
  validation: ValidationState;
}
