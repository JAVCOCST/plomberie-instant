import { describe, it, expect } from 'vitest';
import { diffV16VsRoofModel, iouMonteCarlo } from './training-lab-diff';
import type { RoofModel, RoofSectionInput } from './roof-core/types';

/* ── Builders ────────────────────────────────────────────────────────────── */

interface V16TestSection {
  id: string;
  role: string;
  points: Array<[number, number]>;
  selection_status: 'kept' | 'alternative' | 'rejected';
  pitch: number;
  roof_type: string;
}

function square(id: string, x: number, y: number, size = 100): V16TestSection {
  return {
    id,
    role: 'main',
    points: [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ],
    selection_status: 'kept',
    pitch: 7,
    roof_type: '4_pans',
  };
}

function humanSquare(
  sourceId: string | undefined,
  x: number,
  y: number,
  size = 100,
  pitch = 7,
): RoofSectionInput {
  return {
    pts: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
    closed: true as const,
    pitch,
    elev: 0,
    hf: 0,
    roof_type: 'hip',
    meta: sourceId ? { source_id: sourceId } : undefined,
  };
}

function buildV16(sections: V16TestSection[]): { schema_version: string; sections: V16TestSection[] } {
  return { schema_version: 'sections-1.6.0', sections };
}

function buildModel(sections: RoofSectionInput[]): RoofModel {
  return {
    version: 1,
    sections,
    metadata: { source: 'human_corrected', status: 'validated' },
  };
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe('diffV16VsRoofModel', () => {
  it('returns near-zero diff when human kept v1.6 polygons identically', () => {
    const v16 = buildV16([square('S1', 100, 100)]);
    const model = buildModel([humanSquare('S1', 100, 100)]);

    const d = diffV16VsRoofModel(v16, model);

    expect(d.section_count_v16).toBe(1);
    expect(d.section_count_human).toBe(1);
    expect(d.sections_added).toBe(0);
    expect(d.sections_removed).toBe(0);
    expect(d.sections_modified).toBe(0);
    expect(d.sections_promoted).toBe(0);
    // IoU on identical polygons should be very close to 1 (MC noise).
    expect(d.iou_overall).toBeGreaterThan(0.95);
    expect(d.pitch_delta_mean_x12).toBe(0);
    expect(d.pitch_delta_mean_deg).toBe(0);
    // Correction weight should be near 0 (almost nothing for the model to learn).
    expect(d.correction_weight).toBeLessThan(0.05);
  });

  it('counts a fresh human section (no source_id) as added', () => {
    const v16 = buildV16([square('S1', 100, 100)]);
    const model = buildModel([
      humanSquare('S1', 100, 100),
      humanSquare(undefined, 400, 400), // brand new
    ]);

    const d = diffV16VsRoofModel(v16, model);

    expect(d.section_count_human).toBe(2);
    expect(d.sections_added).toBe(1);
    expect(d.sections_removed).toBe(0);
    // Per-section IoU for the unpaired human section is reported as 0.
    expect(d.iou_per_section['human:1']).toBe(0);
    // Some non-trivial correction weight because of the structural churn.
    expect(d.correction_weight).toBeGreaterThan(0);
  });

  it('flags a paired section with a pitch change as modified', () => {
    const v16 = buildV16([square('S1', 100, 100)]); // pitch=7
    const model = buildModel([humanSquare('S1', 100, 100, 100, 10)]); // pitch=10

    const d = diffV16VsRoofModel(v16, model);

    expect(d.sections_modified).toBe(1);
    expect(d.pitch_delta_mean_x12).toBeCloseTo(3, 4);
    expect(d.pitch_delta_mean_deg).toBeGreaterThan(0);
    // Shape didn't change so IoU still close to 1.
    expect(d.iou_overall).toBeGreaterThan(0.9);
  });

  it('detects a fully redrawn polygon (no overlap)', () => {
    const v16 = buildV16([square('S1', 0, 0, 100)]);
    // Human redraws S1 elsewhere with the same source_id.
    const model = buildModel([humanSquare('S1', 500, 500, 100)]);

    const d = diffV16VsRoofModel(v16, model);

    expect(d.sections_modified).toBe(1);
    // Polygons don't overlap at all -> per-section IoU near 0.
    expect(d.iou_per_section['S1']).toBeLessThan(0.05);
    expect(d.iou_overall).toBeLessThan(0.05);
    // Heavy correction -> weight close to the IoU-loss term (0.6 * 1 = 0.6).
    expect(d.correction_weight).toBeGreaterThan(0.5);
  });

  it('counts v1.6 "rejected" sections re-promoted by the human', () => {
    const v16 = buildV16([
      square('S1', 100, 100),
      { ...square('R2', 300, 300), selection_status: 'rejected' },
    ]);
    const model = buildModel([
      humanSquare('S1', 100, 100),
      humanSquare('R2', 300, 300), // human promoted the rejected section
    ]);

    const d = diffV16VsRoofModel(v16, model);

    expect(d.section_count_v16).toBe(2);
    expect(d.section_count_human).toBe(2);
    expect(d.sections_promoted).toBe(1);
    // R2 was paired (by source_id) and the polygon matches -> not "added".
    expect(d.sections_added).toBe(0);
    // No active v1.6 section was dropped.
    expect(d.sections_removed).toBe(0);
    // The promoted section still contributes to correction_weight via churn.
    expect(d.correction_weight).toBeGreaterThan(0);
  });

  it('counts a removed v1.6 "kept" section as removed', () => {
    const v16 = buildV16([square('S1', 0, 0), square('S2', 300, 300)]);
    const model = buildModel([humanSquare('S1', 0, 0)]);

    const d = diffV16VsRoofModel(v16, model);

    expect(d.sections_removed).toBe(1);
    expect(d.sections_added).toBe(0);
    expect(d.section_count_v16).toBe(2);
    expect(d.section_count_human).toBe(1);
  });

  it('handles empty inputs without throwing or producing NaN', () => {
    const d = diffV16VsRoofModel(null, null);
    expect(Number.isFinite(d.iou_overall)).toBe(true);
    expect(Number.isFinite(d.correction_weight)).toBe(true);
    expect(d.correction_weight).toBe(0);
    expect(d.section_count_v16).toBe(0);
    expect(d.section_count_human).toBe(0);
  });
});

describe('iouMonteCarlo', () => {
  it('is deterministic for the same inputs and seed', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const b = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 50, y: 150 },
    ];
    const x = iouMonteCarlo(a, b, 5000, 42);
    const y = iouMonteCarlo(a, b, 5000, 42);
    expect(x).toBe(y);
    // Geometric IoU of two unit squares overlapping by 1/4 area each =
    // (50*50) / (100*100 + 100*100 - 50*50) = 2500 / 17500 ≈ 0.143
    expect(x).toBeGreaterThan(0.11);
    expect(x).toBeLessThan(0.17);
  });

  it('returns 0 for disjoint polygons', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const b = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 },
    ];
    expect(iouMonteCarlo(a, b)).toBe(0);
  });
});
