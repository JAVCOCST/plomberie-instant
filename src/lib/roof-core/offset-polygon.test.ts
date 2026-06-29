import { describe, it, expect } from 'vitest';
import { offsetPolygonInward, signedArea, inchesToPx } from './offset-polygon';

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const roundPts = (pts: { x: number; y: number }[]) => pts.map(p => ({ x: round(p.x), y: round(p.y) }));

describe('offsetPolygonInward — cas simples', () => {
  it('carré 10×10 offsetté de 1 → carré 8×8 centré', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const out = offsetPolygonInward(sq, 1);
    expect(out).not.toBeNull();
    expect(roundPts(out!)).toEqual([
      { x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 },
    ]);
  });

  it('rectangle 20×10 offsetté de 2 → 16×6 centré', () => {
    const r = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    const out = offsetPolygonInward(r, 2);
    expect(out).not.toBeNull();
    expect(roundPts(out!)).toEqual([
      { x: 2, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 8 }, { x: 2, y: 8 },
    ]);
  });

  it('triangle offsetté préserve l\'orientation', () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }];
    const out = offsetPolygonInward(tri, 0.5);
    expect(out).not.toBeNull();
    expect(Math.sign(signedArea(out!))).toBe(Math.sign(signedArea(tri)));
  });

  it('marche aussi avec orientation horaire (CW)', () => {
    const sqCW = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
    const out = offsetPolygonInward(sqCW, 1);
    expect(out).not.toBeNull();
    // Les sommets sont les mêmes que pour le carré CCW, juste dans l'autre ordre.
    expect(roundPts(out!).sort((a, b) => a.x - b.x || a.y - b.y)).toEqual(
      [{ x: 1, y: 1 }, { x: 1, y: 9 }, { x: 9, y: 1 }, { x: 9, y: 9 }],
    );
  });
});

describe('offsetPolygonInward — garde-fous', () => {
  it('renvoie null si <3 sommets', () => {
    expect(offsetPolygonInward([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1)).toBeNull();
  });

  it('renvoie null si offset > rayon inscrit (orientation inversée)', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(offsetPolygonInward(sq, 6)).toBeNull();   // 6 > 5 (rayon inscrit)
  });

  it('offset 0 = identité', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(offsetPolygonInward(sq, 0)).toEqual(sq);
  });

  it('offset négatif refusé', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(offsetPolygonInward(sq, -1)).toBeNull();
  });
});

describe('inchesToPx', () => {
  it('1 po @ gsd=0.0254 m/px → 1 px', () => {
    expect(inchesToPx(1, 0.0254)).toBeCloseTo(1, 9);
  });
  it('12 po @ gsd=0.1 m/px ≈ 3.048 px', () => {
    expect(inchesToPx(12, 0.1)).toBeCloseTo(12 * 0.0254 / 0.1, 9);
  });
  it('gsd invalide → null', () => {
    expect(inchesToPx(12, null)).toBeNull();
    expect(inchesToPx(12, 0)).toBeNull();
    expect(inchesToPx(12, -0.05)).toBeNull();
  });
});
