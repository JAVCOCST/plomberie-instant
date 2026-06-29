/**
 * training-lab-diff — RoofModel diff between MVP v1.6 input and human truth.
 *
 * Pure, dependency-free comparator. Persisted alongside `roof_model` in
 * `public.training_roof_takeoffs.roof_model_diff` and emitted into the export
 * bundle as `diff.json` per dataset. Drives:
 *   - the auto `quality_score` fallback (see `correction_weight`);
 *   - hard-negative mining for the next retraining pass (high
 *     correction_weight = top priority for the validation set);
 *   - the DiffViewer (Vague B) and IoU-based regression bench (Vague C).
 *
 * Section pairing strategy:
 *   - v1.6 sections expose `selection_status` ("kept" | "alternative" |
 *     "rejected") and a stable string `id` ("S1", "R2", …).
 *   - `RoofModel.sections[i].meta.source_id` carries the v1.6 id when the
 *     adapter built the seed; the human can keep or override it.
 *   - We pair by `meta.source_id` when present. Unpaired v1.6 sections that
 *     were "kept" -> removed. Unpaired human sections -> added. v1.6
 *     "rejected" sections that re-appear by source_id in `roof_model` ->
 *     counted as added + flagged "promoted" via `sections_promoted`.
 *
 * IoU is computed in image-pixel space (same coords as both inputs).
 *
 * NO dependency on roof-core/engine or DOM. Tested in
 * `training-lab-diff.test.ts`.
 */

import type { RoofModel, RoofSectionInput } from './roof-core/types';

/* ── Output shape ──────────────────────────────────────────────────────── */

export interface RoofModelDiff {
  /** Count of v1.6 sections (any selection_status). */
  section_count_v16: number;
  /** Count of human-corrected `roof_model.sections[]`. */
  section_count_human: number;
  /** Sections present in `roof_model` but with no v1.6 counterpart. */
  sections_added: number;
  /** v1.6 sections (kept or alternative) absent from `roof_model`. */
  sections_removed: number;
  /** Paired sections whose polygon or pitch changed. */
  sections_modified: number;
  /** v1.6 "rejected" sections that the human re-promoted into roof_model. */
  sections_promoted: number;
  /** Overall IoU between unioned v1.6 polygons and human polygons (0..1). */
  iou_overall: number;
  /** IoU per pair (keyed by v1.6 section id when known, else "human:<idx>"). */
  iou_per_section: Record<string, number>;
  /** Mean |pitch_human - pitch_v16| over paired sections, in X/12 units. */
  pitch_delta_mean_x12: number;
  /** Same as `pitch_delta_mean_x12` but converted to degrees, for humans. */
  pitch_delta_mean_deg: number;
  /** Coverage = active area / bbox area for v1.6 (kept only). */
  coverage_pct_v16: number;
  /** Coverage = active area / bbox area for human. */
  coverage_pct_human: number;
  /**
   * Heuristic 0..1 score of "how much human intervention this dataset
   * required". Used as `quality_score` fallback when none is set manually.
   * 0  = perfect MVP match (no correction needed)
   * 1  = total rewrite (no overlap, all sections redrawn)
   */
  correction_weight: number;
}

/* ── Geometry helpers (pure, pixel-space) ──────────────────────────────── */

type Pt = { x: number; y: number };

function polygonArea(pts: Pt[]): number {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function bbox(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!pts || !pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function bboxUnion(
  a: { minX: number; minY: number; maxX: number; maxY: number } | null,
  b: { minX: number; minY: number; maxX: number; maxY: number } | null,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function bboxArea(b: { minX: number; minY: number; maxX: number; maxY: number } | null): number {
  if (!b) return 0;
  const w = Math.max(0, b.maxX - b.minX);
  const h = Math.max(0, b.maxY - b.minY);
  return w * h;
}

/** Standard ray-cast point-in-polygon (works in image pixel space). */
function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      ((yi > pt.y) !== (yj > pt.y)) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * IoU between two polygons via Monte Carlo sampling on their union bbox.
 * Pure, deterministic (seeded LCG), no external deps. ~2k samples by default
 * gives ±0.02 IoU on typical roof shapes — enough for ranking & tests.
 */
export function iouMonteCarlo(a: Pt[], b: Pt[], samples = 2000, seed = 1): number {
  if (!a?.length || !b?.length) return 0;
  if (a.length < 3 || b.length < 3) return 0;
  const ba = bbox(a);
  const bb = bbox(b);
  const box = bboxUnion(ba, bb);
  if (!box || bboxArea(box) === 0) return 0;

  // Deterministic LCG (Numerical Recipes constants).
  let s = (seed >>> 0) || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  let inter = 0;
  let union = 0;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  for (let i = 0; i < samples; i++) {
    const pt = { x: box.minX + rand() * w, y: box.minY + rand() * h };
    const inA = pointInPolygon(pt, a);
    const inB = pointInPolygon(pt, b);
    if (inA || inB) union++;
    if (inA && inB) inter++;
  }
  return union === 0 ? 0 : inter / union;
}

/** Multi-polygon coverage = sum(area) / bbox(union). 0 = empty, 1 = packed. */
function coverage(polys: Pt[][]): number {
  if (!polys.length) return 0;
  let sumA = 0;
  let union: ReturnType<typeof bbox> = null;
  for (const p of polys) {
    sumA += polygonArea(p);
    union = bboxUnion(union, bbox(p));
  }
  const bArea = bboxArea(union);
  if (bArea <= 0) return 0;
  return Math.min(1, sumA / bArea);
}

/** Multi-polygon IoU = sum of pairwise overlap divided by union, MC-sampled. */
function iouMulti(a: Pt[][], b: Pt[][], samples = 3000, seed = 2): number {
  const aF = a.filter((p) => p.length >= 3);
  const bF = b.filter((p) => p.length >= 3);
  if (!aF.length && !bF.length) return 1; // empty == empty
  if (!aF.length || !bF.length) return 0;
  let union: ReturnType<typeof bbox> = null;
  for (const p of [...aF, ...bF]) union = bboxUnion(union, bbox(p));
  if (!union || bboxArea(union) === 0) return 0;

  let s = (seed >>> 0) || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };

  let inter = 0;
  let unionPts = 0;
  const w = union.maxX - union.minX;
  const h = union.maxY - union.minY;
  for (let i = 0; i < samples; i++) {
    const pt = { x: union.minX + rand() * w, y: union.minY + rand() * h };
    let inA = false;
    for (const p of aF) { if (pointInPolygon(pt, p)) { inA = true; break; } }
    let inB = false;
    for (const p of bF) { if (pointInPolygon(pt, p)) { inB = true; break; } }
    if (inA || inB) unionPts++;
    if (inA && inB) inter++;
  }
  return unionPts === 0 ? 0 : inter / unionPts;
}

/* ── v1.6 input shape (loose — accept anything the adapter accepted) ───── */

interface V16SectionLike {
  id?: string;
  points?: Array<[number, number]>;
  pitch?: number;
  roof_type?: string;
  selection_status?: 'kept' | 'alternative' | 'rejected' | string;
}

interface V16OutputLike {
  schema_version?: string;
  sections?: V16SectionLike[];
}

function v16PtsToObj(pts: Array<[number, number]> | undefined): Pt[] {
  return (pts || []).map(([x, y]) => ({ x, y }));
}

function pitchX12ToDeg(x12: number): number {
  return (Math.atan2(x12, 12) * 180) / Math.PI;
}

/* ── Main diff ─────────────────────────────────────────────────────────── */

/**
 * Diff v1.6 raw input vs human-corrected `RoofModel`.
 *
 * Inputs may be null/empty; the function never throws.
 * Outputs are clamped to safe ranges (no NaN, no Infinity).
 */
export function diffV16VsRoofModel(
  v16: V16OutputLike | null | undefined,
  model: RoofModel | null | undefined,
): RoofModelDiff {
  const v16Sections: V16SectionLike[] = Array.isArray(v16?.sections) ? v16!.sections! : [];
  const humanSections: RoofSectionInput[] = Array.isArray(model?.sections) ? model!.sections : [];

  const v16Kept = v16Sections.filter((s) => s.selection_status === 'kept');
  // "active" v1.6 sections for pairing: kept + alternative (alternative was on
  // the table as a suggestion, so the human "picking" one is a real edit).
  const v16Active = v16Sections.filter(
    (s) => s.selection_status === 'kept' || s.selection_status === 'alternative',
  );
  const v16Rejected = v16Sections.filter((s) => s.selection_status === 'rejected');

  const v16ById = new Map<string, V16SectionLike>();
  for (const s of v16Sections) if (s.id) v16ById.set(s.id, s);
  const v16RejectedIds = new Set(v16Rejected.map((s) => s.id).filter(Boolean) as string[]);

  // Pair human -> v1.6 by meta.source_id.
  const paired: Array<{ key: string; v16: V16SectionLike; human: RoofSectionInput }> = [];
  const matchedV16Ids = new Set<string>();
  const unmatchedHuman: Array<{ idx: number; section: RoofSectionInput }> = [];
  let sectionsPromoted = 0;

  humanSections.forEach((hs, idx) => {
    const srcId = hs.meta?.source_id;
    if (srcId && v16ById.has(srcId)) {
      const v = v16ById.get(srcId)!;
      paired.push({ key: srcId, v16: v, human: hs });
      matchedV16Ids.add(srcId);
      if (v16RejectedIds.has(srcId)) sectionsPromoted++;
    } else {
      unmatchedHuman.push({ idx, section: hs });
    }
  });

  const unmatchedV16Active = v16Active.filter((s) => !s.id || !matchedV16Ids.has(s.id));

  // Per-section IoU + modification flag.
  const iou_per_section: Record<string, number> = {};
  let sectionsModified = 0;
  let pitchDeltaSum = 0;
  let pitchDeltaCount = 0;

  for (const p of paired) {
    const vPts = v16PtsToObj(p.v16.points);
    const hPts = p.human.pts || [];
    const iou = iouMonteCarlo(vPts, hPts, 1500, hash32(p.key));
    iou_per_section[p.key] = round4(iou);
    const vPitch = typeof p.v16.pitch === 'number' ? p.v16.pitch : 7;
    const hPitch = typeof p.human.pitch === 'number' ? p.human.pitch : 7;
    const pitchDelta = Math.abs(hPitch - vPitch);
    pitchDeltaSum += pitchDelta;
    pitchDeltaCount++;
    const sameRoofType =
      mapRoofType(p.v16.roof_type) === p.human.roof_type;
    // Modified if IoU < 0.98, pitch differs by > 0.5 x/12, or roof_type changed.
    if (iou < 0.98 || pitchDelta > 0.5 || !sameRoofType) sectionsModified++;
  }

  // Unmatched human sections still get a per-section IoU vs nothing (0).
  for (const u of unmatchedHuman) {
    iou_per_section[`human:${u.idx}`] = 0;
  }

  const pitch_delta_mean_x12 = pitchDeltaCount > 0
    ? round4(pitchDeltaSum / pitchDeltaCount)
    : 0;
  const pitch_delta_mean_deg = pitchDeltaCount > 0
    ? round4(pitchX12ToDeg(pitch_delta_mean_x12))
    : 0;

  // Overall IoU on multi-polygons: v1.6 kept vs human active sections.
  const v16KeptPolys = v16Kept.map((s) => v16PtsToObj(s.points)).filter((p) => p.length >= 3);
  const humanPolys = humanSections.map((s) => s.pts || []).filter((p) => p.length >= 3);
  const iou_overall = round4(iouMulti(v16KeptPolys, humanPolys));

  const coverage_pct_v16 = round4(coverage(v16KeptPolys));
  const coverage_pct_human = round4(coverage(humanPolys));

  const section_count_v16 = v16Sections.length;
  const section_count_human = humanSections.length;
  const sections_added = unmatchedHuman.length;
  const sections_removed = unmatchedV16Active.length;

  // Correction weight: blends IoU loss and structural change ratio.
  // - 0.6 weight on (1 - iou_overall) -> shape mismatch dominates.
  // - 0.4 weight on structural churn (added + removed + modified + promoted)
  //   normalized by the *envelope* of work (max of v1.6 active or human counts).
  const denom = Math.max(1, v16Active.length, humanSections.length);
  const churn = (sections_added + sections_removed + sectionsModified + sectionsPromoted) / denom;
  let correction_weight = 0.6 * (1 - iou_overall) + 0.4 * Math.min(1, churn);
  // Edge case: both inputs empty -> nothing to learn from, weight = 0.
  if (v16Sections.length === 0 && humanSections.length === 0) correction_weight = 0;
  correction_weight = clamp01(correction_weight);

  return {
    section_count_v16,
    section_count_human,
    sections_added,
    sections_removed,
    sections_modified: sectionsModified,
    sections_promoted: sectionsPromoted,
    iou_overall,
    iou_per_section,
    pitch_delta_mean_x12,
    pitch_delta_mean_deg,
    coverage_pct_v16,
    coverage_pct_human,
    correction_weight: round4(correction_weight),
  };
}

/* ── Small utilities ────────────────────────────────────────────────────── */

function clamp01(x: number): number {
  if (!isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round4(x: number): number {
  if (!isFinite(x)) return 0;
  return Math.round(x * 10000) / 10000;
}

function mapRoofType(rt: string | undefined): 'hip' | 'gable' {
  return rt === '2_pans' || rt === 'gable' ? 'gable' : 'hip';
}

/** Tiny deterministic string hash (FNV-1a 32-bit), used for IoU MC seeds. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h || 1) >>> 0;
}
