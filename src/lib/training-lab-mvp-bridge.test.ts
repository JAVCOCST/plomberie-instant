import { describe, it, expect } from 'vitest';
import {
  latLngToImagePx,
  extractOuterRing,
  buildPriorPolygonPx,
} from './training-lab-mvp-bridge';

describe('latLngToImagePx', () => {
  it('le point central projette au centre de l\'image (1280/2 = 640)', () => {
    const [x, y] = latLngToImagePx(45.4, -73.5, 45.4, -73.5, 20);
    expect(x).toBe(640);
    expect(y).toBe(640);
  });

  it('zoom plus grand → distance pixel plus grande pour le même delta lat/lng', () => {
    const a = latLngToImagePx(45.401, -73.5, 45.4, -73.5, 18);
    const b = latLngToImagePx(45.401, -73.5, 45.4, -73.5, 22);
    const dyA = Math.abs(a[1] - 640);
    const dyB = Math.abs(b[1] - 640);
    expect(dyB).toBeGreaterThan(dyA);
  });

  it('lng plus à l\'est → x plus grand', () => {
    const [xCenter] = latLngToImagePx(45.4, -73.5, 45.4, -73.5, 20);
    const [xEast] = latLngToImagePx(45.4, -73.499, 45.4, -73.5, 20);
    expect(xEast).toBeGreaterThan(xCenter);
  });

  it('lat plus au nord → y plus PETIT (origine top-left en image)', () => {
    const [, yCenter] = latLngToImagePx(45.4, -73.5, 45.4, -73.5, 20);
    const [, yNorth] = latLngToImagePx(45.401, -73.5, 45.4, -73.5, 20);
    expect(yNorth).toBeLessThan(yCenter);
  });
});

describe('extractOuterRing — accepte les formats GeoJSON courants', () => {
  it('Polygon → ring extérieur', () => {
    const geo = { type: 'Polygon', coordinates: [[[-73.5, 45.4], [-73.49, 45.4], [-73.49, 45.41], [-73.5, 45.41]]] };
    const ring = extractOuterRing(geo);
    expect(ring).toEqual([[-73.5, 45.4], [-73.49, 45.4], [-73.49, 45.41], [-73.5, 45.41]]);
  });

  it('MultiPolygon → 1er polygone, ring extérieur', () => {
    const geo = {
      type: 'MultiPolygon',
      coordinates: [
        [[[-73.5, 45.4], [-73.49, 45.4], [-73.49, 45.41], [-73.5, 45.41]]],
        [[[-73.48, 45.42], [-73.47, 45.42]]],
      ],
    };
    const ring = extractOuterRing(geo);
    expect(ring).toEqual([[-73.5, 45.4], [-73.49, 45.4], [-73.49, 45.41], [-73.5, 45.41]]);
  });

  it('Feature avec Polygon dedans', () => {
    const geo = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] },
    };
    expect(extractOuterRing(geo)).toEqual([[0, 0], [1, 0], [1, 1]]);
  });

  it('null / objet invalide → null', () => {
    expect(extractOuterRing(null)).toBeNull();
    expect(extractOuterRing({ type: 'Point' })).toBeNull();
    expect(extractOuterRing('not a geo')).toBeNull();
  });

  it('JSON-encoded string (cas Supabase jsonb → string)', () => {
    // Reproduction du bug réel : Supabase renvoie parfois jsonb sérialisé
    // comme string. extractOuterRing doit parser à la volée.
    const geo = JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] });
    expect(extractOuterRing(geo)).toEqual([[0, 0], [1, 0], [1, 1]]);
  });

  it('JSON-encoded string avec MultiPolygon', () => {
    const geo = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [[[[-72.7, 45.4], [-72.69, 45.4], [-72.69, 45.41]]]],
    });
    expect(extractOuterRing(geo)).toEqual([[-72.7, 45.4], [-72.69, 45.4], [-72.69, 45.41]]);
  });

  it('FeatureCollection → 1er ring trouvé', () => {
    const geo = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2]]] } },
      ],
    };
    expect(extractOuterRing(geo)).toEqual([[1, 1], [2, 1], [2, 2]]);
  });
});

describe('buildPriorPolygonPx', () => {
  const mp = { centerLat: 45.4, centerLng: -73.5, zoom: 20 };

  it('Polygon réel → liste de [x, y] image-px', () => {
    const geo = { type: 'Polygon', coordinates: [[[-73.501, 45.401], [-73.499, 45.401], [-73.499, 45.399], [-73.501, 45.399]]] };
    const px = buildPriorPolygonPx(geo, mp);
    expect(px).not.toBeNull();
    expect(px!.length).toBe(4);
    // Chaque entrée est une paire d'entiers.
    px!.forEach(([x, y]) => {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    });
  });

  it('map_params incomplet → null', () => {
    const geo = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] };
    expect(buildPriorPolygonPx(geo, { centerLat: 45 } as any)).toBeNull();
    expect(buildPriorPolygonPx(geo, null)).toBeNull();
  });

  it('polygone à moins de 3 points → null', () => {
    const geo = { type: 'Polygon', coordinates: [[[0, 0], [1, 0]]] };
    expect(buildPriorPolygonPx(geo, mp)).toBeNull();
  });

  it('geojson absent → null', () => {
    expect(buildPriorPolygonPx(null, mp)).toBeNull();
  });
});
