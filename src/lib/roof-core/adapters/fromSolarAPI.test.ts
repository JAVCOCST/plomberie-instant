import { describe, it, expect } from "vitest";
import {
  fromSolarAPI,
  snapPitchDegToStandard,
  type SolarAPIDigested,
  type SolarMapParams,
  type SolarSegment,
} from "./fromSolarAPI";

/* ── Fixtures ─────────────────────────────────────────────────────────── */

/** Map params réalistes (Granby centre, zoom 20, scale=2 → 1280×1280). */
const map: SolarMapParams = {
  centerLat: 45.4042,
  centerLng: -72.7274,
  zoom: 20,
  imageWidth: 1280,
  imageHeight: 1280,
  scaleParam: 2,
  provider: "google",
};

/**
 * Cas anonymisé inspiré du POC 383 Provence (Granby, MEDIUM 2015-09-04).
 * 4 segments hip orientés N/E/S/W avec pentes 30-32° (snap → 8/12).
 */
function fixtureHipFourPans(): SolarAPIDigested {
  const cx = map.centerLat;
  const cy = map.centerLng;
  // bbox ~7 m de demi-côté (≈ 1.3e-4 deg en lat à 45°)
  const D = 7 / 111_320; // m → deg lat
  const Dlng = D / Math.cos((cx * Math.PI) / 180);
  const seg = (pitchDeg: number, azDeg: number, bboxOffset: [number, number]): SolarSegment => {
    const [latOff, lngOff] = bboxOffset;
    return {
      pitch_deg: pitchDeg,
      azimuth_deg: azDeg,
      area_m2: 50,
      center: { lat: cx + latOff, lng: cy + lngOff },
      bbox: {
        sw: { lat: cx + latOff - D, lng: cy + lngOff - Dlng },
        ne: { lat: cx + latOff + D, lng: cy + lngOff + Dlng },
      },
    };
  };
  return {
    ok: true,
    summary: {
      n_segments: 4,
      total_area_m2: 200,
      imagery_quality: "MEDIUM",
      imagery_date: "2015-09-04",
    },
    segments: [
      seg(30, 0,    [+0.0001, 0]),       // Nord
      seg(31, 90,   [0,       +0.0001]), // Est
      seg(30, 180,  [-0.0001, 0]),       // Sud
      seg(32, 270,  [0,       -0.0001]), // Ouest
    ],
  };
}

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("snapPitchDegToStandard", () => {
  it("snape 30° → 6/12 (tan(30) × 12 ≈ 6.93, plus proche de 6 que de 8)", () => {
    expect(snapPitchDegToStandard(30)).toBe(6);
  });
  it("snape 20° → 4/12 (tan(20) × 12 ≈ 4.37)", () => {
    expect(snapPitchDegToStandard(20)).toBe(4);
  });
  it("snape 26.6° (= 6/12 exact) → 6", () => {
    expect(snapPitchDegToStandard(26.57)).toBe(6);
  });
  it("snape 33.7° (= 8/12 exact) → 8", () => {
    expect(snapPitchDegToStandard(33.69)).toBe(8);
  });
  it("snape 45° → 12/12 (tan(45) × 12 = 12 exact)", () => {
    expect(snapPitchDegToStandard(45)).toBe(12);
  });
  it("snape 0° → 4 (plus petit standard, pas de 0/12 dans la liste)", () => {
    expect(snapPitchDegToStandard(0)).toBe(4);
  });
});

describe("fromSolarAPI", () => {
  it("retourne model: null quand imagery_quality = BASE", () => {
    const data: SolarAPIDigested = {
      ok: true,
      summary: { n_segments: 0, total_area_m2: 0, imagery_quality: "BASE", imagery_date: null },
      segments: [],
    };
    const result = fromSolarAPI(data, map);
    expect(result.model).toBeNull();
    expect(result.sourceQuality).toBe("BASE");
    expect(result.stats.n_kept).toBe(0);
  });

  it("retourne model: null quand 0 segments (imagery_quality = MEDIUM mais aucun toit)", () => {
    const data: SolarAPIDigested = {
      ok: true,
      summary: { n_segments: 0, total_area_m2: 0, imagery_quality: "MEDIUM", imagery_date: "2024-01-01" },
      segments: [],
    };
    const result = fromSolarAPI(data, map);
    expect(result.model).toBeNull();
  });

  it("4 segments hip → 4 sections RoofModel, pitch snappé à 8/12, source solar", () => {
    const data = fixtureHipFourPans();
    const result = fromSolarAPI(data, map);

    expect(result.model).not.toBeNull();
    expect(result.sourceQuality).toBe("MEDIUM");
    expect(result.stats.n_kept).toBe(4);
    expect(result.stats.n_skipped_missing_bbox).toBe(0);
    expect(result.stats.n_skipped_too_small).toBe(0);

    const model = result.model!;
    expect(model.sections).toHaveLength(4);
    // Snaps précis : 30° → 6, 31° → 8, 32° → 8.
    // Ordre du fixture : Nord(30), Est(31), Sud(30), Ouest(32)
    expect(model.sections.map((s) => s.pitch)).toEqual([6, 8, 6, 8]);
    for (const s of model.sections) {
      expect(s.roof_type).toBe("hip");
      expect(s.closed).toBe(true);
      expect(s.pts).toHaveLength(4);
    }
    // Métadonnées source = solar
    expect(model.metadata.source).toBe("solar");
    expect(model.metadata.status).toBe("auto_candidate");
    expect(model.metadata.solar_imagery_quality).toBe("MEDIUM");
    expect(model.metadata.solar_imagery_date).toBe("2015-09-04");
    expect(model.metadata.mvp_version).toBe("solar-1.0.0");
  });

  it("Projection lat/lng → image px : segment centré sur le centre map donne ~640px,640px", () => {
    const data = fixtureHipFourPans();
    const result = fromSolarAPI(data, map);
    expect(result.model).not.toBeNull();

    // Segment Nord : centre légèrement au nord du centre map (+0.0001 lat).
    // Son bbox SW est à (centerLat + 0.0001 - D, centerLng - Dlng) où D ≈ 6.3e-5 deg.
    // En projection, ce coin devrait être au-dessus du centre image (640) en y,
    // et à gauche du centre (640) en x.
    const northSection = result.model!.sections[0];
    // Tous les 4 points du bbox projeté sont dans la plage [0, 1280] (pas de débordement)
    for (const p of northSection.pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1280);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1280);
    }
    // Le centroïde des 4 points doit être proche de 640 (centre image)
    // avec un petit offset vers le haut (Nord = y plus petit qu'au centre).
    const meanY = northSection.pts.reduce((s, p) => s + p.y, 0) / 4;
    expect(meanY).toBeLessThan(640); // Nord → au-dessus du centre image
    expect(meanY).toBeGreaterThan(300); // ...mais dans un rayon raisonnable (zoom 20, ~11m de décalage = ~155px)
  });

  it("Segment avec bbox manquant → skip, comptabilisé dans n_skipped_missing_bbox", () => {
    const data: SolarAPIDigested = {
      ok: true,
      summary: { n_segments: 2, total_area_m2: 100, imagery_quality: "HIGH", imagery_date: "2024-01-01" },
      segments: [
        {
          pitch_deg: 30,
          azimuth_deg: 0,
          area_m2: 50,
          center: { lat: map.centerLat, lng: map.centerLng },
          bbox: null, // ← manque
        },
        {
          pitch_deg: 30,
          azimuth_deg: 180,
          area_m2: 50,
          center: { lat: map.centerLat, lng: map.centerLng },
          bbox: {
            sw: { lat: map.centerLat - 0.0001, lng: map.centerLng - 0.0001 },
            ne: { lat: map.centerLat + 0.0001, lng: map.centerLng + 0.0001 },
          },
        },
      ],
    };
    const result = fromSolarAPI(data, map);
    expect(result.stats.n_total).toBe(2);
    expect(result.stats.n_kept).toBe(1);
    expect(result.stats.n_skipped_missing_bbox).toBe(1);
    expect(result.model!.sections).toHaveLength(1);
  });

  it("Segment avec aire < 1 m² → skip (bruit Solar)", () => {
    const data: SolarAPIDigested = {
      ok: true,
      summary: { n_segments: 2, total_area_m2: 50.5, imagery_quality: "HIGH", imagery_date: "2024-01-01" },
      segments: [
        {
          pitch_deg: 30, azimuth_deg: 0,
          area_m2: 0.5, // ← bruit
          center: { lat: map.centerLat, lng: map.centerLng },
          bbox: {
            sw: { lat: map.centerLat - 1e-5, lng: map.centerLng - 1e-5 },
            ne: { lat: map.centerLat + 1e-5, lng: map.centerLng + 1e-5 },
          },
        },
        {
          pitch_deg: 30, azimuth_deg: 0,
          area_m2: 50,
          center: { lat: map.centerLat + 0.0001, lng: map.centerLng + 0.0001 },
          bbox: {
            sw: { lat: map.centerLat - 0.0001, lng: map.centerLng - 0.0001 },
            ne: { lat: map.centerLat + 0.0001, lng: map.centerLng + 0.0001 },
          },
        },
      ],
    };
    const result = fromSolarAPI(data, map);
    expect(result.stats.n_skipped_too_small).toBe(1);
    expect(result.stats.n_kept).toBe(1);
    expect(result.model!.sections).toHaveLength(1);
  });

  it("Confiance dérivée de la qualité : HIGH → 0.95, MEDIUM → 0.75, LOW → 0.55", () => {
    const baseSeg = (): SolarSegment => ({
      pitch_deg: 30,
      azimuth_deg: 0,
      area_m2: 50,
      center: { lat: map.centerLat, lng: map.centerLng },
      bbox: {
        sw: { lat: map.centerLat - 0.0001, lng: map.centerLng - 0.0001 },
        ne: { lat: map.centerLat + 0.0001, lng: map.centerLng + 0.0001 },
      },
    });
    const mkData = (q: "HIGH" | "MEDIUM" | "LOW"): SolarAPIDigested => ({
      ok: true,
      summary: { n_segments: 1, total_area_m2: 50, imagery_quality: q, imagery_date: "2024-01-01" },
      segments: [baseSeg()],
    });
    expect(fromSolarAPI(mkData("HIGH"), map).model!.sections[0].meta!.confidence).toBe(0.95);
    expect(fromSolarAPI(mkData("MEDIUM"), map).model!.sections[0].meta!.confidence).toBe(0.75);
    expect(fromSolarAPI(mkData("LOW"), map).model!.sections[0].meta!.confidence).toBe(0.55);
  });

  it("RoofModel.scale.ft_per_px et image dérivés des mapParams", () => {
    const data = fixtureHipFourPans();
    const result = fromSolarAPI(data, map);
    const model = result.model!;
    expect(model.image).toBeDefined();
    expect(model.image!.width).toBe(1280);
    expect(model.image!.height).toBe(1280);
    expect(model.image!.scale_factor).toBe(2);
    expect(model.scale).toBeDefined();
    expect(model.scale!.source).toBe("georef");
    expect(model.scale!.ft_per_px).toBeGreaterThan(0);
    expect(model.scale!.ft_per_px).toBeLessThan(1); // zoom 20 + scale 2 → ~0.2 ft/px
    expect(model.scale!.provider).toBe("google");
  });

  it("source_id de chaque section = 'solar:<index>'", () => {
    const data = fixtureHipFourPans();
    const result = fromSolarAPI(data, map);
    const ids = result.model!.sections.map((s) => s.meta?.source_id);
    expect(ids).toEqual(["solar:0", "solar:1", "solar:2", "solar:3"]);
  });
});
