/**
 * Viewport image-native — transform image-space → viewport-space.
 *
 * RÈGLE UNIQUE, sans déformation : l'image est affichée en **contain**
 * (entièrement visible, aspect ratio préservé, jamais rognée, jamais étirée),
 * centrée. `scaleX === scaleY` toujours. Les overlays MVP (points en pixels de
 * l'image source) sont projetés par CE transform — jamais dessinés en
 * coordonnées brutes.
 *
 * Le viewport raisonne en **CSS pixels** (renderedWidth/Height). La gestion DPR
 * se fait côté canvas (canvas.width = rendered × dpr, ctx.scale(dpr,dpr)), de
 * sorte que tout le dessin reste en CSS px via ce transform.
 *
 * Pur, sans DOM : testable en Node.
 */

export interface VPoint { x: number; y: number }

export interface Viewport {
  naturalW: number;
  naturalH: number;
  renderedW: number;
  renderedH: number;
  /** Échelle uniforme image→viewport (px CSS / px image). */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Rectangle occupé par l'image dans le viewport (CSS px). */
  imageRect: { x: number; y: number; w: number; h: number };
}

/** Calcule le transform contain (aucune distorsion). */
export function computeViewport(naturalW: number, naturalH: number, renderedW: number, renderedH: number): Viewport {
  const nw = Math.max(1, naturalW), nh = Math.max(1, naturalH);
  const scale = Math.min(renderedW / nw, renderedH / nh);
  const w = nw * scale, h = nh * scale;
  const offsetX = (renderedW - w) / 2;
  const offsetY = (renderedH - h) / 2;
  return {
    naturalW: nw, naturalH: nh, renderedW, renderedH,
    scale, offsetX, offsetY,
    imageRect: { x: offsetX, y: offsetY, w, h },
  };
}

/** Point image-space → viewport-space (CSS px). */
export function imageToViewport(p: VPoint, vp: Viewport): VPoint {
  return { x: vp.offsetX + p.x * vp.scale, y: vp.offsetY + p.y * vp.scale };
}

/** Point viewport-space (CSS px) → image-space. */
export function viewportToImage(p: VPoint, vp: Viewport): VPoint {
  return { x: (p.x - vp.offsetX) / vp.scale, y: (p.y - vp.offsetY) / vp.scale };
}

/** Le point image-space est-il dans les bornes de l'image ? */
export function inImage(p: VPoint, vp: Viewport): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= vp.naturalW && p.y <= vp.naturalH;
}
