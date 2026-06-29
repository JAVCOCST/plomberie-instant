// Géométrie pure pour CalibrationEditor — extraite pour pouvoir la tester
// indépendamment de React. Aucune dépendance DOM ni externe : 100 % testable.
//
// Pourquoi cette extraction ?
//  - Le composant CalibrationEditor avait deux bugs silencieux :
//    (P0) handleSave réémettait toujours `type: 'Polygon'`, corrompant les
//         MultiPolygon d'origine au save (les downstream consumers cassent).
//    (P1) La rotation appliquait un centroïde par-ring → dans un bâtiment
//         avec cour intérieure, l'anneau extérieur et l'anneau intérieur
//         pivotaient chacun autour d'un centre différent, dérivant l'un par
//         rapport à l'autre.
//  - Les deux sont fixés ici dans des fonctions pures.

export type Ring = [number, number][];

/** Détecte et préserve la structure GeoJSON (Polygon, MultiPolygon, Feature,
 *  FeatureCollection) en appliquant `transformRing` à CHAQUE anneau au
 *  passage. La forme retournée est identique à l'entrée : un MultiPolygon
 *  reste MultiPolygon, un Polygon reste Polygon, un Feature reste Feature.
 *
 *  Corrige le P0 : avant, `handleSave` extrayait les rings (perdant le
 *  groupement) puis réémettait `{ type: 'Polygon', ... }` même pour un
 *  MultiPolygon source. */
export function transformGeo(geo: any, transformRing: (r: Ring) => Ring): any {
  if (!geo) return null;
  if (geo.type === 'Feature') {
    return { ...geo, geometry: transformGeo(geo.geometry, transformRing) };
  }
  if (geo.type === 'FeatureCollection') {
    return { ...geo, features: (geo.features || []).map((f: any) => transformGeo(f, transformRing)) };
  }
  if (geo.type === 'Polygon') {
    return { ...geo, coordinates: (geo.coordinates || []).map((ring: Ring) => transformRing(ring)) };
  }
  if (geo.type === 'MultiPolygon') {
    return {
      ...geo,
      coordinates: (geo.coordinates || []).map((poly: Ring[]) =>
        poly.map((ring: Ring) => transformRing(ring)),
      ),
    };
  }
  return geo;
}

/** Aplatit toute géométrie en liste d'anneaux. Conservé pour le rendu SVG du
 *  composant — ne SERT PAS au save (qui doit passer par `transformGeo`). */
export function extractRings(geo: any): Ring[] {
  if (!geo) return [];
  const g = geo.type === 'Feature' ? geo.geometry : geo;
  if (!g) return [];
  if (g.type === 'Polygon') return (g.coordinates || []).map((r: any) => r as Ring);
  if (g.type === 'MultiPolygon') return (g.coordinates || []).flat().map((r: any) => r as Ring);
  if (g.type === 'FeatureCollection') {
    return (g.features || []).flatMap((f: any) => extractRings(f));
  }
  return [];
}

/** Centroïde naïf (moyenne des points) sur l'union des anneaux. */
export function centroidOf(rings: Ring[]): [number, number] | null {
  const pts = rings.flat();
  if (!pts.length) return null;
  const sx = pts.reduce((s, p) => s + p[0], 0);
  const sy = pts.reduce((s, p) => s + p[1], 0);
  return [sx / pts.length, sy / pts.length];
}

/** Applique rotation + scale + translation à UN anneau autour d'un centroïde
 *  PARTAGÉ (passé en argument). Corrige le P1 : un seul centre pour tous les
 *  anneaux du même bâtiment → les rings restent cohérents entre eux après
 *  rotation. */
export function transformRingAround(
  r: Ring,
  centroid: [number, number],
  rotDeg: number,
  scale: number,
  dx: number,
  dy: number,
): Ring {
  const cosA = Math.cos((rotDeg * Math.PI) / 180);
  const sinA = Math.sin((rotDeg * Math.PI) / 180);
  const [cx, cy] = centroid;
  return r.map(([x, y]) => {
    const lx = (x - cx) * scale;
    const ly = (y - cy) * scale;
    const rx = lx * cosA - ly * sinA;
    const ry = lx * sinA + ly * cosA;
    return [cx + rx + dx, cy + ry + dy];
  });
}

/** Translation pure d'un anneau. Utilisé pour le lot (pas de rotation/scale). */
export function translateRing(r: Ring, dx: number, dy: number): Ring {
  return r.map(([x, y]) => [x + dx, y + dy]);
}
