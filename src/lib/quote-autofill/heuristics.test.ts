import { describe, it, expect } from "vitest";
import {
  estimateEventsPlomberie,
  computeComplexityScore,
  complexityScoreToCategory,
} from "./heuristics";

describe("estimateEventsPlomberie", () => {
  it("1 étage, 1 logement → 1 vent (cas standard)", () => {
    expect(estimateEventsPlomberie(1, 1)).toBe(1);
  });

  it("1 étage, 4 logements → 4 vents (plomberie distincte au sol)", () => {
    expect(estimateEventsPlomberie(4, 1)).toBe(4);
  });

  it("2 étages, 4 logements → 2 vents (partage cheminée)", () => {
    expect(estimateEventsPlomberie(4, 2)).toBe(2);
  });

  it("2 étages, 5 logements → 3 vents (ceil 5/2)", () => {
    expect(estimateEventsPlomberie(5, 2)).toBe(3);
  });

  it("3 étages, 6 logements → 2 vents (max(2, ceil(6/3)))", () => {
    expect(estimateEventsPlomberie(6, 3)).toBe(2);
  });

  it("3 étages, 9 logements → 3 vents (ceil 9/3)", () => {
    expect(estimateEventsPlomberie(9, 3)).toBe(3);
  });

  it("nb_logements null → traité comme 1 → résultat ≥ 1", () => {
    expect(estimateEventsPlomberie(null, 1)).toBe(1);
    expect(estimateEventsPlomberie(undefined, 2)).toBe(2);
  });

  it("nb_etages null → traité comme 1 (cas le plus simple)", () => {
    expect(estimateEventsPlomberie(3, null)).toBe(3);
    expect(estimateEventsPlomberie(3, undefined)).toBe(3);
  });

  it("nb_etages = 0 → traité comme 1", () => {
    expect(estimateEventsPlomberie(2, 0)).toBe(2);
  });

  it("Floor de sécurité : 2 étages, 1 logement → max(2, ceil(0.5)) = 2", () => {
    expect(estimateEventsPlomberie(1, 2)).toBe(2);
  });
});

describe("computeComplexityScore", () => {
  it("Cas le plus simple : 2 segments, pitch 4, 0 pignon, 1 étage, 0 variance, 1 logement → score bas", () => {
    const s = computeComplexityScore({
      solar_n_segments: 2,
      solar_max_pitch_x12: 4,
      solar_n_pignons: 0,
      brikk_nb_etages: 1,
      solar_azimut_variance_norm: 0,
      brikk_nb_logements: 1,
    });
    expect(s).toBeLessThan(0.30); // → "simple"
  });

  it("Cas hip 4-pans modéré (4 segments, 7/12, 0 pignon, 1 étage) → score moyen", () => {
    const s = computeComplexityScore({
      solar_n_segments: 4,
      solar_max_pitch_x12: 7,
      solar_n_pignons: 0,
      brikk_nb_etages: 1,
      solar_azimut_variance_norm: 0.5,
      brikk_nb_logements: 1,
    });
    expect(s).toBeGreaterThanOrEqual(0.30);
    expect(s).toBeLessThan(0.55); // → "moyenne"
  });

  it("Cas complexe (8 segments, 12/12, 3 pignons, 3 étages, 6 logements) → score élevé", () => {
    const s = computeComplexityScore({
      solar_n_segments: 8,
      solar_max_pitch_x12: 12,
      solar_n_pignons: 3,
      brikk_nb_etages: 3,
      solar_azimut_variance_norm: 0.8,
      brikk_nb_logements: 6,
    });
    expect(s).toBeGreaterThanOrEqual(0.75); // → "tres_complexe"
  });

  it("Clamp01 : valeurs hors limites n'explosent pas le score", () => {
    const s = computeComplexityScore({
      solar_n_segments: 100, // hors normal, clamp à 1.0
      solar_max_pitch_x12: 24,
      solar_n_pignons: 10,
      brikk_nb_etages: 10,
      solar_azimut_variance_norm: 5,
      brikk_nb_logements: 100,
    });
    expect(s).toBeLessThanOrEqual(1.0);
    expect(s).toBeGreaterThan(0.9); // tout clamp à 1, score doit être max
  });

  it("Brikk nb_etages null → composante c4 neutre (0.5)", () => {
    const sWithEtages = computeComplexityScore({
      solar_n_segments: 4,
      solar_max_pitch_x12: 6,
      solar_n_pignons: 0,
      brikk_nb_etages: 1.5, // = 0.5 quand normalisé (1.5/3)
      solar_azimut_variance_norm: 0,
      brikk_nb_logements: 1,
    });
    const sNoEtages = computeComplexityScore({
      solar_n_segments: 4,
      solar_max_pitch_x12: 6,
      solar_n_pignons: 0,
      brikk_nb_etages: null,
      solar_azimut_variance_norm: 0,
      brikk_nb_logements: 1,
    });
    // Les deux doivent être très proches puisque c4 vaut 0.5 dans les 2 cas
    expect(Math.abs(sWithEtages - sNoEtages)).toBeLessThan(0.001);
  });

  it("Multi-logements (≥ 4) → ajoute exactement +0.05", () => {
    const base = {
      solar_n_segments: 4,
      solar_max_pitch_x12: 6,
      solar_n_pignons: 0,
      brikk_nb_etages: 1,
      solar_azimut_variance_norm: 0,
    };
    const sSingle = computeComplexityScore({ ...base, brikk_nb_logements: 1 });
    const sMulti = computeComplexityScore({ ...base, brikk_nb_logements: 4 });
    expect(sMulti - sSingle).toBeCloseTo(0.05, 5);
  });
});

describe("complexityScoreToCategory", () => {
  it("0.00 → simple", () => {
    expect(complexityScoreToCategory(0)).toBe("simple");
  });
  it("0.29 → simple (limite inférieure)", () => {
    expect(complexityScoreToCategory(0.29)).toBe("simple");
  });
  it("0.30 → moyenne (premier seuil)", () => {
    expect(complexityScoreToCategory(0.30)).toBe("moyenne");
  });
  it("0.54 → moyenne (limite inférieure)", () => {
    expect(complexityScoreToCategory(0.54)).toBe("moyenne");
  });
  it("0.55 → complexe (seuil)", () => {
    expect(complexityScoreToCategory(0.55)).toBe("complexe");
  });
  it("0.74 → complexe (limite inférieure)", () => {
    expect(complexityScoreToCategory(0.74)).toBe("complexe");
  });
  it("0.75 → tres_complexe (seuil)", () => {
    expect(complexityScoreToCategory(0.75)).toBe("tres_complexe");
  });
  it("1.00 → tres_complexe", () => {
    expect(complexityScoreToCategory(1.0)).toBe("tres_complexe");
  });
  it("NaN → moyenne (défaut sûr)", () => {
    expect(complexityScoreToCategory(Number.NaN)).toBe("moyenne");
  });
});
