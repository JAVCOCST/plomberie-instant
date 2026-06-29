import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  buildBundleZip,
  splitFor,
  validateTakeoffForExport,
  TRAINING_LAB_BUNDLE_SCHEMA_VERSION,
  type TrainingTakeoff,
} from './training-lab';

/* ── Fixture builders ────────────────────────────────────────────────────── */

function baseTakeoff(over: Partial<TrainingTakeoff> = {}): TrainingTakeoff {
  return {
    id: over.id ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    source_takeoff_id: null,
    reference: 'REF-001',
    address: '123 rue Test',
    raw_image_url: null,
    annotated_image_url: null,
    debug_overlay_url: null,
    json_url: null,
    original_building_geojson: null,
    corrected_building_geojson: null,
    original_lot_geojson: null,
    corrected_lot_geojson: null,
    annotations_json: null,
    roof_sections_v16: null,
    roof_model: null,
    roof_model_diff: null,
    calibration_status: null,
    calibration_offset_px: null,
    calibration_offset_m: null,
    calibration_rotation_deg: null,
    calibration_scale: null,
    calibration_confidence: null,
    calibration_notes: null,
    dataset_status: 'draft',
    quality_score: null,
    tags: [],
    human_notes: null,
    export_batch_id: null,
    created_at: '2026-05-30T00:00:00Z',
    updated_at: '2026-05-30T00:00:00Z',
    ...over,
  };
}

function squareRoofModel(): Record<string, unknown> {
  return {
    version: 1,
    sections: [
      {
        pts: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 200 },
          { x: 100, y: 200 },
        ],
        closed: true,
        pitch: 7,
        elev: 0,
        hf: 0,
        roof_type: 'hip',
      },
    ],
    metadata: { source: 'human_corrected', status: 'validated' },
  };
}

/* ── splitFor ────────────────────────────────────────────────────────────── */

describe('splitFor', () => {
  it('is deterministic — same id always lands in the same bucket', () => {
    const id = 'deadbeef-1234-1234-1234-deadbeefcafe';
    const a = splitFor({ id });
    const b = splitFor({ id });
    expect(a).toBe(b);
  });

  it('produces only the three allowed buckets', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `id-${i}`);
    const buckets = new Set(ids.map((id) => splitFor({ id })));
    for (const b of buckets) {
      expect(['train', 'val', 'test']).toContain(b);
    }
  });

  it('roughly respects the 70/15/15 distribution on a large sample', () => {
    const N = 2000;
    const counts = { train: 0, val: 0, test: 0 };
    for (let i = 0; i < N; i++) counts[splitFor({ id: `id-${i}` })]++;
    // Wide tolerance: ±5pp over 2k samples.
    expect(counts.train / N).toBeGreaterThan(0.65);
    expect(counts.train / N).toBeLessThan(0.75);
    expect(counts.val / N).toBeGreaterThan(0.10);
    expect(counts.val / N).toBeLessThan(0.20);
    expect(counts.test / N).toBeGreaterThan(0.10);
    expect(counts.test / N).toBeLessThan(0.20);
  });
});

/* ── validateTakeoffForExport ────────────────────────────────────────────── */

describe('validateTakeoffForExport', () => {
  it('refuses a takeoff without roof_model, even when dataset_status=validated', () => {
    const t = baseTakeoff({
      raw_image_url: 'x',
      annotated_image_url: 'x',
      debug_overlay_url: 'x',
      original_building_geojson: { type: 'Polygon', coordinates: [[[0, 0]]] },
      original_lot_geojson: { type: 'Polygon', coordinates: [[[0, 0]]] },
      annotations_json: {
        tools: [{ id: 't1', toolType: 'Ligne' }],
        annotations: [{ target: 't1', segments: [[{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]] }],
      },
      calibration_status: 'ok',
      calibration_offset_m: { x: 0, y: 0 },
      calibration_confidence: 0.9,
      quality_score: 0.8,
      dataset_status: 'validated',
      // roof_model intentionally absent.
    });

    const v = validateTakeoffForExport(t);

    expect(v.ok).toBe(false);
    // Both the ready_for_training check AND the roof_model check should fire.
    expect(v.errors.join(' | ')).toMatch(/roof_model absent/);
  });

  it('still refuses if dataset_status is ready_for_training but roof_model is empty', () => {
    const t = baseTakeoff({
      raw_image_url: 'x',
      annotated_image_url: 'x',
      debug_overlay_url: 'x',
      original_building_geojson: { type: 'Polygon', coordinates: [[[0, 0]]] },
      original_lot_geojson: { type: 'Polygon', coordinates: [[[0, 0]]] },
      annotations_json: {
        tools: [{ id: 't1', toolType: 'Ligne' }],
        annotations: [{ target: 't1', segments: [[{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]] }],
      },
      calibration_status: 'ok',
      calibration_offset_m: { x: 0, y: 0 },
      calibration_confidence: 0.9,
      quality_score: 0.8,
      dataset_status: 'ready_for_training',
      roof_model: { version: 1, sections: [], metadata: { source: 'human_corrected', status: 'validated' } },
    });
    const v = validateTakeoffForExport(t);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' | ')).toMatch(/roof_model absent/);
  });

  it('accepts a takeoff with a populated roof_model and all other gates', () => {
    const t = baseTakeoff({
      raw_image_url: 'x',
      annotated_image_url: 'x',
      debug_overlay_url: 'x',
      original_building_geojson: { type: 'Polygon', coordinates: [[[0, 0]]] },
      original_lot_geojson: { type: 'Polygon', coordinates: [[[0, 0]]] },
      annotations_json: {
        tools: [{ id: 't1', toolType: 'Ligne' }],
        annotations: [{ target: 't1', segments: [[{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]] }],
      },
      calibration_status: 'ok',
      calibration_offset_m: { x: 0, y: 0 },
      calibration_confidence: 0.9,
      quality_score: 0.8,
      dataset_status: 'ready_for_training',
      roof_model: squareRoofModel(),
    });
    const v = validateTakeoffForExport(t);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });
});

/* ── buildBundleZip ──────────────────────────────────────────────────────── */

describe('buildBundleZip', () => {
  it('writes roof_model.json, roof_sections_v16.json and diff.json per dataset', async () => {
    const t = baseTakeoff({
      id: '11111111-1111-1111-1111-111111111111',
      reference: 'DATA_001',
      roof_model: squareRoofModel(),
      roof_sections_v16: { schema_version: 'sections-1.6.0', sections: [{ id: 'S1', points: [[0, 0]] }] },
      roof_model_diff: { sections_added: 0, sections_removed: 0, sections_modified: 0, correction_weight: 0.12 },
    });

    const blob = await buildBundleZip([t], 'unit test');
    const zip = await JSZip.loadAsync(blob);

    // Per-dataset files.
    const refPrefix = 'takeoffs/DATA_001';
    expect(zip.file(`${refPrefix}/roof_model.json`)).not.toBeNull();
    expect(zip.file(`${refPrefix}/roof_sections_v16.json`)).not.toBeNull();
    expect(zip.file(`${refPrefix}/diff.json`)).not.toBeNull();
    expect(zip.file(`${refPrefix}/takeoff.json`)).not.toBeNull();
    expect(zip.file(`${refPrefix}/notes.md`)).not.toBeNull();
    expect(zip.file(`${refPrefix}/validation_report.json`)).not.toBeNull();
  });

  it('writes an enriched root manifest.json with schema_version, datasets[], splits', async () => {
    const takeoffs = [
      baseTakeoff({
        id: '11111111-1111-1111-1111-111111111111',
        reference: 'A',
        roof_model: squareRoofModel(),
        roof_model_diff: { correction_weight: 0.42 },
        quality_score: 0.84,
      }),
      baseTakeoff({
        id: '22222222-2222-2222-2222-222222222222',
        reference: 'B',
        roof_model: squareRoofModel(),
        roof_model_diff: { correction_weight: 0.1 },
      }),
    ];

    const blob = await buildBundleZip(takeoffs);
    const zip = await JSZip.loadAsync(blob);
    const manifestFile = zip.file('manifest.json');
    expect(manifestFile).not.toBeNull();
    const manifest = JSON.parse(await manifestFile!.async('string'));

    expect(manifest.schema_version).toBe(TRAINING_LAB_BUNDLE_SCHEMA_VERSION);
    expect(manifest.count).toBe(2);
    expect(Array.isArray(manifest.datasets)).toBe(true);
    expect(manifest.datasets).toHaveLength(2);

    for (const d of manifest.datasets) {
      expect(['train', 'val', 'test']).toContain(d.split);
      expect(typeof d.has_roof_model).toBe('boolean');
      expect(typeof d.has_diff).toBe('boolean');
    }

    // The per-dataset correction_weight is propagated to the manifest.
    const a = manifest.datasets.find((d: { reference: string }) => d.reference === 'A');
    expect(a.correction_weight).toBe(0.42);
    expect(a.quality_score).toBe(0.84);
    expect(a.has_roof_model).toBe(true);
    expect(a.has_diff).toBe(true);

    // Splits summary equals the sum of dataset splits.
    const totalFromSplits = manifest.splits.train + manifest.splits.val + manifest.splits.test;
    expect(totalFromSplits).toBe(manifest.count);
  });

  it('does NOT write roof_model.json when roof_model is missing (additive contract preserved)', async () => {
    const t = baseTakeoff({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', reference: 'EMPTY' });
    const blob = await buildBundleZip([t]);
    const zip = await JSZip.loadAsync(blob);
    expect(zip.file('takeoffs/EMPTY/roof_model.json')).toBeNull();
    // The legacy `metadata.json` is still present for back-compat.
    expect(zip.file('metadata.json')).not.toBeNull();
  });
});
