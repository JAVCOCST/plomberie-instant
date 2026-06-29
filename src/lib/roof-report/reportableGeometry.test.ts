import { describe, it, expect } from 'vitest';
import { buildReportable, type RPlane, type ReportData } from './reportableGeometry';

// Pignon « gable » simple : 2 versants partageant un faîte à x=50, t=30.
const slopeS: RPlane = {
  id: 'A', section: 's1', kind: 'toiture', dir: 'S', pitch: 7,
  footprint: [{ x: 0, y: 0, t: 0 }, { x: 0, y: 100, t: 0 }, { x: 50, y: 100, t: 30 }, { x: 50, y: 0, t: 30 }],
  area3d: 5000, plane: { a: 0.6, b: 0, c: 0 },
};
const slopeN: RPlane = {
  id: 'B', section: 's1', kind: 'toiture', dir: 'N', pitch: 7,
  footprint: [{ x: 50, y: 0, t: 30 }, { x: 50, y: 100, t: 30 }, { x: 100, y: 100, t: 0 }, { x: 100, y: 0, t: 0 }],
  area3d: 5000, plane: { a: -0.6, b: 0, c: 60 },
};
// Facette à plat (t=0) entièrement sous le versant S → doit être occultée.
const buried: RPlane = {
  id: 'C', section: 's2', kind: 'toiture', dir: 'S', pitch: 0,
  footprint: [{ x: 10, y: 10, t: 0 }, { x: 10, y: 40, t: 0 }, { x: 40, y: 40, t: 0 }, { x: 40, y: 10, t: 0 }],
  area3d: 900, plane: { a: 0, b: 0, c: 0 },
};

describe('buildReportable', () => {
  it('garde les 2 versants visibles et classe faîte/avant-toit/rampante', () => {
    const geom = buildReportable({ planes: [slopeS, slopeN] } as ReportData);
    expect(geom.planes.map((p) => p.id).sort()).toEqual(['A', 'B']);
    const types = new Set(geom.edges.map((e) => e.type));
    expect(types.has('ridge')).toBe(true);   // faîte partagé en hauteur
    expect(types.has('eave')).toBe(true);    // avant-toits à t=0
    expect(types.has('rake')).toBe(true);    // rampantes (un bout haut, un bas)
    expect(geom.metrics.total_roof_cm2).toBe(10000);
    expect(geom.metrics.n_toitures).toBe(2);
  });

  it('exclut une facette occultée des métriques (invariant caché⇒absent)', () => {
    const geom = buildReportable({ planes: [slopeS, slopeN, buried] } as ReportData);
    expect(geom.planes_hidden.map((p) => p.id)).toContain('C');
    expect(geom.planes.map((p) => p.id)).not.toContain('C');
    expect(geom.metrics.total_area_cm2).toBe(10000); // C (900) exclu
    // Aucune arête ne référence un plan caché (T2)
    const visibleIds = new Set(geom.planes.map((p) => p.id));
    for (const e of geom.edges) for (const id of e.shared_by) expect(visibleIds.has(id)).toBe(true);
  });
});
