// derive.ts — the SINGLE entry point from roof-takeoff into roof-core.
//
// Strate B (derived) is always reproducible from strate A (the RoofModel
// snapshot). No other roof-takeoff module imports the geometry engine.
import type { RoofModel, RoofSectionInput } from "@/lib/roof-core/types";
import {
  computeMeasures, computeValleys, collectFaces, face3DArea,
  polyAreaAbs, gableEndsOverrides,
} from "@/lib/roof-core/engine";
import type {
  RoofDerived, DerivedSection, DerivedSlope, DerivedEdge, DerivedMeasurements,
  EdgeKind, SlopeLevel, RoofTakeoff,
} from "./types";

const M_TO_FT = 3.28084;

/** X/12 → slope category aligned with types/roofing.ts SlopeLevel. */
export function slopeLevelFromX12(x12: number): SlopeLevel {
  if (x12 < 4) return "flat";
  if (x12 < 7) return "4-7";
  if (x12 < 9) return "7-9";
  if (x12 < 12) return "9-12";
  return "12+";
}

/** X/12 → degrees. */
export function x12ToDeg(x12: number): number {
  return (Math.atan2(x12, 12) * 180) / Math.PI;
}

/** Metres-per-pixel from a RoofModel's attached scale, or 0 if uncalibrated. */
export function metersPerPxOf(model: RoofModel): number {
  const s = model && model.scale;
  if (!s || s.source === "none" || !(s.ft_per_px > 0)) return 0;
  return s.ft_per_px / M_TO_FT;
}

// RoofSectionInput → the engine's internal section shape (gable node overrides
// are DERIVED from roof_type, exactly like the studio's adapter).
function toEngineSection(s: RoofSectionInput): any {
  const pts = (s.pts || []).map((p) => ({ x: p.x, y: p.y }));
  return {
    pts, closed: true, _skel: null,
    pitch: s.pitch || 7, elev: s.elev || 0, hf: s.hf || 0,
    _no: s.roof_type === "gable" ? gableEndsOverrides(pts) : {},
    hidden: false, roof_type: s.roof_type,
  };
}

function perimeterPx(pts: { x: number; y: number }[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; p += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y); }
  return p;
}

/** Derive strate B from a RoofModel (pure; safe on an empty model). */
export function deriveRoofTakeoff(model: RoofModel, snapshotAt: string): RoofDerived {
  const now = new Date().toISOString();
  const inputSecs = (model && model.sections) || [];
  const eng = inputSecs.map(toEngineSection);
  const mPerPx = metersPerPxOf(model);
  const calibrated = mPerPx > 0;
  const A2 = mPerPx * mPerPx;        // px² → m²
  const warnings: string[] = [];
  if (!calibrated) warnings.push("uncalibrated: real-world areas/lengths unavailable (no scale on RoofModel)");

  const valleysGeo = eng.length ? computeValleys(eng) : [];
  const m: any = eng.length ? computeMeasures(eng, valleysGeo) : { face: 0, ridge: 0, hip: 0, eave: 0, valley: 0, rake: 0, byPitch: {} };
  const faces = eng.length ? collectFaces(eng) : [];

  // Per-section derived metrics.
  const sections: DerivedSection[] = inputSecs.map((s, i) => {
    const pts = (s.pts || []).map((p) => ({ x: p.x, y: p.y }));
    let area3dPx = 0;
    faces.forEach((f: any) => { if (f.si === i && !f.pignon) area3dPx += face3DArea(f.s, f.fpts); });
    const footprintPx = polyAreaAbs(pts);
    const pitchX12 = s.pitch || 7;
    return {
      id: "S" + (i + 1),
      type: "UNKNOWN",
      areaFootprintM2: footprintPx * A2,
      area3dM2: area3dPx * A2,
      pitchDeg: +x12ToDeg(pitchX12).toFixed(2),
      pitchX12,
      aspectDeg: 0,
      perimeterM: perimeterPx(pts) * mPerPx,
      quality: calibrated ? "ESTIMATED" : "UNCERTAIN",
    };
  });

  const slopes: DerivedSlope[] = sections.map((d) => ({
    sectionId: d.id, pitchDeg: d.pitchDeg, pitchX12: d.pitchX12, level: slopeLevelFromX12(d.pitchX12),
  }));

  // Lineal totals (metres). computeMeasures.ridge bundles ridge + hips.
  const ridgeM = Math.max(0, (m.ridge || 0) - (m.hip || 0)) * mPerPx;
  const hipM = (m.hip || 0) * mPerPx;
  const valleyM = (m.valley || 0) * mPerPx;
  const eaveM = (m.eave || 0) * mPerPx;
  const rakeM = (m.rake || 0) * mPerPx;
  const linealByKind: Record<EdgeKind, number> = { RIDGE: ridgeM, VALLEY: valleyM, HIP: hipM, EAVE: eaveM, RAKE: rakeM };

  // Dominant pitch by sloped area (byPitch is keyed by X/12 → px² area).
  let domX12 = 0, domArea = -1;
  Object.keys(m.byPitch || {}).forEach((k) => { const a = m.byPitch[k]; if (a > domArea) { domArea = a; domX12 = +k; } });
  if (!domX12 && sections.length) domX12 = sections[0].pitchX12;

  const footprintAreaM2 = inputSecs.reduce((acc, s) => acc + polyAreaAbs((s.pts || []).map((p) => ({ x: p.x, y: p.y }))) * A2, 0);
  const totalPerimeterM = inputSecs.reduce((acc, s) => acc + perimeterPx((s.pts || []).map((p) => ({ x: p.x, y: p.y }))) * mPerPx, 0);

  // Sloped area per pitch (X/12 key → m²) and ice & water membrane run (m).
  const areaByPitchM2: Record<string, number> = {};
  Object.keys(m.byPitch || {}).forEach((k) => { areaByPitchM2[k] = (m.byPitch[k] || 0) * A2; });
  const membraneM = (m.membrane != null ? m.membrane : (m.eave || 0) + (m.valley || 0)) * mPerPx;

  const measurements: DerivedMeasurements = {
    footprintAreaM2,
    roof3dAreaM2: (m.face || 0) * A2,
    totalPerimeterM,
    linealByKind,
    dominantPitchX12: domX12,
    dominantSlopeLevel: slopeLevelFromX12(domX12),
    sectionCount: sections.length,
    areaByPitchM2,
    membraneM,
    diagnostics: { coveragePct: sections.length ? 100 : 0, overlapPct: 0, warnings },
  };

  // Per-edge breakdown beyond the kind totals is deferred (Phase 2); valleys are
  // already discrete objects so we surface them individually.
  const valleys: DerivedEdge[] = valleysGeo.map((v: any, i: number) => ({
    id: "V" + (i + 1), kind: "VALLEY",
    lengthM: Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y) * mPerPx,
    sectionA: v.sec1 != null ? "S" + (v.sec1 + 1) : undefined,
    sectionB: v.sec2 != null ? "S" + (v.sec2 + 1) : undefined,
  }));

  return {
    sections, slopes,
    ridges: [], hips: [], valleys, eaves: [], rakes: [],
    measurements,
    computedAt: now,
    derivedFromSnapshotAt: snapshotAt,
  };
}

/** Derived block is stale when it was computed from a different snapshot. */
export function isDerivedStale(t: RoofTakeoff): boolean {
  return !t.derived || t.derived.derivedFromSnapshotAt !== t.geometry.snapshot.snapshotAt;
}
