import { describe, it, expect } from 'vitest';
import { buildToitureModel } from './adapter';
import { buildReportable } from './reportableGeometry';

// RoofModel minimal : une section carrée 200×200 (hip) → le skeleton produit
// 4 versants. On vérifie que l'adaptateur sort des plans exploitables et que
// le cœur géométrie les consomme sans planter.
const model = {
  version: 1,
  sections: [
    { pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], closed: true, pitch: 7, elev: 0, hf: 40, roof_type: 'hip' },
  ],
};

describe('buildToitureModel', () => {
  it('produit des plans avec aire 3D + footprint élévé + direction valide', () => {
    const data = buildToitureModel(model);
    expect(data.planes.length).toBeGreaterThan(0);
    for (const p of data.planes) {
      expect(typeof p.area3d).toBe('number');
      expect(p.footprint.length).toBeGreaterThanOrEqual(3);
      expect(['N', 'E', 'S', 'O', 'vertical']).toContain(p.dir);
      expect(['toiture', 'pignon']).toContain(p.kind);
    }
    // le footprint d'un versant doit avoir un point surélevé (t > 0)
    const maxT = Math.max(...data.planes.flatMap((p) => p.footprint.map((q) => q.t || 0)));
    expect(maxT).toBeGreaterThan(0);
  });

  it("s'enchaîne avec buildReportable sans erreur", () => {
    const data = buildToitureModel(model);
    const geom = buildReportable(data);
    expect(geom.metrics.total_area_cm2).toBeGreaterThan(0);
    expect(geom.planes.length).toBeGreaterThan(0);
  });
});
