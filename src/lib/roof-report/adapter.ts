/**
 * adapter.ts — convertit le RoofModel validé (roof3d_model) vers le format
 * `toiture.json` que consomme le rapport (planes/valleys/sections).
 *
 * Reproduit fidèlement la logique de `AdminRoofStudio.exportJSON()` (qui
 * télécharge déjà ce format), mais en fonction PURE branchable sur une
 * soumission, en réutilisant les helpers de roof-core/engine.
 *
 * Orientation : `slopeDir` du studio renvoie 8 directions ; le rapport n'en
 * gère que 4 (N/E/S/O) + vertical → on replie sur le cardinal dominant
 * (georef : N = -y, E = +x, S = +y, O = -x).
 */
import { skelFn, facesFn, apOv, facePlaneFromFace, isPignon, face3DArea } from '@/lib/roof-core/engine';
import type { RPlane, ReportData } from './reportableGeometry';

/** Replie une équation de plan sur le cardinal vers lequel le versant descend. */
function cardinalDir(plane: { a: number; b: number }): 'N' | 'E' | 'S' | 'O' {
  const dx = -plane.a, dy = -plane.b; // direction descendante (downhill)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'O';
  return dy >= 0 ? 'S' : 'N';
}

interface StudioSection {
  pts: { x: number; y: number }[];
  closed?: boolean; pitch?: number; elev?: number; hf?: number;
  hidden?: boolean; _no?: any; roof_type?: string;
}

/**
 * Construit le modèle « toiture.json » (planes + sections) à partir d'un
 * RoofModel. `valleys` est laissé vide : reportableGeometry reclasse de toute
 * façon les arêtes basses partagées en noues (longueur dérivée de la topologie).
 */
export function buildToitureModel(roofModel: any): ReportData {
  const rawSections: StudioSection[] = (roofModel && roofModel.sections) || [];
  const planes: RPlane[] = [];
  let pn = 0;

  rawSections.forEach((raw, si) => {
    const s: any = {
      pts: raw.pts, closed: raw.closed !== false,
      pitch: raw.pitch || 7, elev: raw.elev || 0, hf: raw.hf || 0,
      hidden: !!raw.hidden, _no: raw._no || {}, roof_type: raw.roof_type || 'hip',
    };
    if (!s.closed || !s.pts || s.pts.length < 3 || s.hidden) return;

    const sk = apOv(skelFn(s.pts), s._no || {});
    if (!sk || !sk.poly) return;
    facesFn(sk.poly, sk).forEach((f: any) => {
      pn++;
      const pl = facePlaneFromFace(s, f.pts);
      const pignon = isPignon(s, f.pts);
      planes.push({
        id: 'P' + pn,
        section: si,
        kind: pignon ? 'pignon' : 'toiture',
        pitch: s.pitch,
        dir: (pl && !pignon) ? cardinalDir(pl) : 'vertical',
        plane: pl ? { a: +pl.a.toFixed(4), b: +pl.b.toFixed(4), c: +pl.c.toFixed(2) } : null,
        area3d: +face3DArea(s, f.pts).toFixed(0),
        footprint: f.pts.map((q: any) => ({ x: +q.x.toFixed(1), y: +q.y.toFixed(1), t: +(q.t || 0).toFixed(1) })),
      });
    });
  });

  return { planes, valleys: [], sections: rawSections };
}
