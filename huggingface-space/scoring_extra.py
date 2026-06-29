"""scoring_extra.py
=====================
Two diagnostic scores for a rectangle expected to model a 2-pans roof:

  ridge_visible_score(rect, image, axes=None) -> (score, details)
      Looks for a visible faîtière running parallel to pts[0]→pts[1]
      through the centre of the rect.

  roof_plane_symmetry_score(rect, image) -> (score, details)
      Splits the rect into 2 strips on either side of the ridge axis and
      compares L* statistics. A real 2-pans typically shows two distinct
      but internally-coherent plans.

These scores are DIAGNOSTIC. They DO NOT REPLACE the existing structural
scoring; the caller decides whether to use them as filters or annotations.
"""
from __future__ import annotations
from typing import Dict, List, Optional, Tuple
import numpy as np
import cv2

from semantic_order import compute_ridge_axis


# ===========================================================================
# 1. ridge_visible_score
# ===========================================================================
def ridge_visible_score(rect_4pts: List[List[float]],
                        image_bgr: np.ndarray,
                        axes: Optional[Dict] = None,
                        grad: Optional[np.ndarray] = None,
                        thickness_px: int = 3,
                        ) -> Tuple[float, Dict]:
    """Score the visibility of a ridge running through the rect center.

    The rect is expected to be in semantic order (pts[0]→pts[1] = ridge axis).
    """
    pts = np.asarray(rect_4pts, dtype=np.float64)
    if pts.shape[0] >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if pts.shape[0] != 4:
        return 0.0, {"error": "need 4 pts"}

    H, W = image_bgr.shape[:2]
    if grad is None:
        grad = _grad_norm(image_bgr)

    # Ridge axis: midpoint(0→1) → midpoint(2→3)
    ridge = np.asarray(compute_ridge_axis(rect_4pts), dtype=np.float64)
    rp1, rp2 = ridge[0], ridge[1]
    rv = rp2 - rp1
    L = float(np.linalg.norm(rv))
    if L < 5:
        return 0.0, {"error": "ridge too short"}
    rv_unit = rv / L

    # ---- 1. mean gradient strength along the ridge line ---------------
    mask = np.zeros((H, W), dtype=np.uint8)
    cv2.line(mask,
             (int(round(rp1[0])), int(round(rp1[1]))),
             (int(round(rp2[0])), int(round(rp2[1]))),
             255, thickness=thickness_px)
    on = mask > 0
    n_on = int(on.sum())
    if n_on == 0:
        return 0.0, {"error": "ridge line rasterized to empty mask"}
    strength = float(grad[on].mean())

    # ---- 2. gradient direction must be perpendicular to the ridge ----
    gy_img = cv2.Sobel(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY),
                       cv2.CV_32F, 0, 1, ksize=3)
    gx_img = cv2.Sobel(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY),
                       cv2.CV_32F, 1, 0, ksize=3)
    ys, xs = np.nonzero(on)
    gx_on = gx_img[ys, xs]; gy_on = gy_img[ys, xs]
    mag = np.hypot(gx_on, gy_on)
    keep = mag > (mag.max() * 0.3) if mag.size > 0 else np.zeros_like(mag, bool)
    if keep.any():
        gx_strong = gx_on[keep]; gy_strong = gy_on[keep]
        # cos(angle between grad and ridge_v_unit); want this near 0
        # (i.e. grad perpendicular to ridge)
        cos_with_ridge = (gx_strong * rv_unit[0] + gy_strong * rv_unit[1]) / \
                          np.maximum(mag[keep], 1e-6)
        # fraction with |cos| < cos(70°) ≈ 0.34  → grad within ±20° of perpendicular
        perp_frac = float((np.abs(cos_with_ridge) < 0.34).mean())
    else:
        perp_frac = 0.0

    # ---- 3. ridge contrast vs surrounding strip (the line should
    #         stand out vs the parallel band of pixels just off it) -----
    # Build a thin "central" band (already in `on`) and a "neighbour" band
    # at ± `band_dist` pixels along the perpendicular.
    perp_unit = np.array([-rv_unit[1], rv_unit[0]])
    band_dist = max(6, int(0.10 * _short_side(pts)))
    nb_mask = np.zeros((H, W), dtype=np.uint8)
    for sign in (-1, +1):
        d = sign * band_dist * perp_unit
        cv2.line(nb_mask,
                 (int(round(rp1[0] + d[0])), int(round(rp1[1] + d[1]))),
                 (int(round(rp2[0] + d[0])), int(round(rp2[1] + d[1]))),
                 255, thickness=thickness_px)
    if (nb_mask > 0).sum() > 0:
        nb_mean = float(grad[nb_mask > 0].mean())
        contrast = max(0.0, float((strength - nb_mean) /
                                   max(nb_mean, 1e-3)))
        contrast = min(1.0, contrast / 2.0)   # squash to [0, 1]
    else:
        contrast = 0.0

    total = 0.45 * strength + 0.25 * perp_frac + 0.30 * contrast

    return float(min(1.0, total)), {
        "strength":  float(strength),
        "perp_frac": float(perp_frac),
        "contrast":  float(contrast),
        "ridge_length_px": float(L),
        "thickness_px":    thickness_px,
    }


# ===========================================================================
# 2. roof_plane_symmetry_score
# ===========================================================================
def roof_plane_symmetry_score(rect_4pts: List[List[float]],
                              image_bgr: np.ndarray,
                              ridge_axis_hint: Optional[List[List[float]]] = None,
                              ) -> Tuple[float, Dict]:
    """Split rect along its ridge axis and compare L* of the two strips.

    A real 2-pans roof should show two distinct (different L*) but each
    internally homogeneous (low std) bands. Returns 0..1 + details.
    """
    pts = np.asarray(rect_4pts, dtype=np.float64)
    if pts.shape[0] >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if pts.shape[0] != 4:
        return 0.0, {"error": "need 4 pts"}

    H, W = image_bgr.shape[:2]

    # Ridge axis: take the hint if any, else from semantic order
    if ridge_axis_hint is not None:
        ra = np.asarray(ridge_axis_hint, dtype=np.float64)
    else:
        ra = np.asarray(compute_ridge_axis(rect_4pts), dtype=np.float64)
    ridge_v = ra[1] - ra[0]
    nL = float(np.linalg.norm(ridge_v))
    if nL < 1e-6:
        return 0.0, {"error": "ridge degenerate"}
    ridge_v /= nL
    perp_v = np.array([-ridge_v[1], ridge_v[0]])
    centroid = pts.mean(axis=0)

    # Rasterize the rect to know which pixels we're talking about
    rect_mask = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(rect_mask, [pts.astype(np.int32)], 255)
    ys, xs = np.nonzero(rect_mask)
    if xs.size < 30:
        return 0.0, {"error": "rect too small (<30 px)"}

    # Side label = sign of (pixel - centroid) · perp_v
    coords = np.column_stack([xs, ys]).astype(np.float64)
    perp_proj = (coords - centroid) @ perp_v
    side_a = perp_proj > 0
    side_b = perp_proj < 0
    if int(side_a.sum()) < 10 or int(side_b.sum()) < 10:
        return 0.0, {"error": "one side too thin"}

    # L* statistics
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    Lchan = lab[:, :, 0].astype(np.float32)
    L_a = Lchan[ys[side_a], xs[side_a]]
    L_b = Lchan[ys[side_b], xs[side_b]]
    mean_a, std_a = float(L_a.mean()), float(L_a.std())
    mean_b, std_b = float(L_b.mean()), float(L_b.std())
    delta = float(abs(mean_a - mean_b))
    avg_std = 0.5 * (std_a + std_b)

    # Components
    # - delta_score : higher delta → more "2-pans like" (saturates around 30)
    delta_score = min(1.0, delta / 30.0)
    # - homogeneity : low intra-side std → each side is uniform
    homogeneity = max(0.0, 1.0 - avg_std / 25.0)

    total = 0.55 * delta_score + 0.45 * homogeneity

    return float(min(1.0, total)), {
        "L_mean_side_a": mean_a,  "L_mean_side_b": mean_b,
        "L_std_side_a":  std_a,   "L_std_side_b":  std_b,
        "L_delta":       delta,
        "delta_score":   delta_score,
        "homogeneity":   homogeneity,
        "n_pixels_side_a": int(side_a.sum()),
        "n_pixels_side_b": int(side_b.sum()),
    }


# ===========================================================================
# 3. ridge_internality_score — ANTI-GUTTER FILTER (v1.2)
# ===========================================================================
def ridge_internality_score(rect_4pts: List[List[float]],
                            image_bgr: np.ndarray,
                            main_rect_4pts: List[List[float]],
                            ridge_axis_hint: Optional[List[List[float]]] = None,
                            lab_dist_threshold: float = 25.0,
                            sample_inset_pct: float = 0.30,
                            gutter_roof_frac_threshold: float = 0.50,
                            ) -> Tuple[float, Dict]:
    """Anti-gutter score: penalize ridges that look like a roof boundary
    rather than an internal faîtière.

    Heuristic
    ---------
    A real ridge separates two roof-colored half-strips.
    A gutter has roof pixels on ONE side only — the other side is
    pavement / wall shadow / soil. So we sample the main-roof color
    and check that BOTH halves of the candidate rect are mostly
    roof-colored.

    Components (each in [0,1]):
      bilateral_roof  : min(roof_frac_a, roof_frac_b)  — 1 ⇒ both sides
                        are very roof-like, 0 ⇒ one side is off-roof
      bilateral_count : 2·min(n_a,n_b)/(n_a+n_b)        — balance check

    Total = 0.7 · bilateral_roof + 0.3 · bilateral_count

    Flags
    -----
    is_gutter_like = (bilateral_roof < `gutter_roof_frac_threshold`)
    """
    H, W = image_bgr.shape[:2]
    pts = np.asarray(rect_4pts, dtype=np.float64)
    if pts.shape[0] >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if pts.shape[0] != 4:
        return 0.0, {"error": "need 4 pts", "is_gutter_like": True}

    main = np.asarray(main_rect_4pts, dtype=np.float64)
    if main.shape[0] >= 2 and np.allclose(main[0], main[-1]):
        main = main[:-1]

    # ---- 1. Sample main-roof color (median LAB, central inset) -------
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    c_main = main.mean(axis=0)
    shrunk = c_main + (main - c_main) * (1.0 - sample_inset_pct)
    smask = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(smask, [shrunk.astype(np.int32)], 255)
    ys_s, xs_s = np.nonzero(smask)
    if xs_s.size < 10:
        return 0.0, {"error": "sample empty", "is_gutter_like": True}
    sample_lab = np.median(lab[ys_s, xs_s], axis=0)

    # ---- 2. Ridge axis ------------------------------------------------
    if ridge_axis_hint is not None:
        ra = np.asarray(ridge_axis_hint, dtype=np.float64)
    else:
        ra = np.asarray(compute_ridge_axis(rect_4pts), dtype=np.float64)
    rv = ra[1] - ra[0]
    nrv = float(np.linalg.norm(rv))
    if nrv < 1e-6:
        return 0.0, {"error": "ridge degenerate", "is_gutter_like": True}
    rv /= nrv
    perp = np.array([-rv[1], rv[0]])

    # ---- 3. Split rect along ridge axis ------------------------------
    rect_mask = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(rect_mask, [pts.astype(np.int32)], 255)
    ys, xs = np.nonzero(rect_mask)
    if xs.size < 30:
        return 0.0, {"error": "rect too small",
                     "is_gutter_like": True}

    coords = np.column_stack([xs, ys]).astype(np.float64)
    centroid = pts.mean(axis=0)
    perp_proj = (coords - centroid) @ perp
    side_a_mask = perp_proj > 0
    side_b_mask = perp_proj < 0
    n_a, n_b = int(side_a_mask.sum()), int(side_b_mask.sum())
    if n_a < 8 or n_b < 8:
        return 0.0, {"error": "one side too thin",
                     "n_a": n_a, "n_b": n_b, "is_gutter_like": True}

    # ---- 4. Roof-likeness per side -----------------------------------
    dist_lab = np.linalg.norm(lab[ys, xs] - sample_lab[None, :], axis=1)
    is_roof = dist_lab < lab_dist_threshold
    roof_frac_a = float(is_roof[side_a_mask].mean())
    roof_frac_b = float(is_roof[side_b_mask].mean())
    bilateral_roof = float(min(roof_frac_a, roof_frac_b))
    bilateral_count = 2.0 * min(n_a, n_b) / max(1, (n_a + n_b))

    total = 0.7 * bilateral_roof + 0.3 * bilateral_count
    is_gutter = bilateral_roof < gutter_roof_frac_threshold

    return float(min(1.0, total)), {
        "bilateral_roof":  bilateral_roof,
        "bilateral_count": bilateral_count,
        "roof_frac_side_a": roof_frac_a,
        "roof_frac_side_b": roof_frac_b,
        "n_pixels_side_a": n_a,
        "n_pixels_side_b": n_b,
        "is_gutter_like": bool(is_gutter),
        "gutter_threshold": float(gutter_roof_frac_threshold),
        "lab_dist_threshold": float(lab_dist_threshold),
    }


# ===========================================================================
# helpers
# ===========================================================================
def _grad_norm(image_bgr: np.ndarray) -> np.ndarray:
    g = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    m = np.sqrt(gx * gx + gy * gy)
    mm = float(m.max())
    return m / mm if mm > 0 else m


def _short_side(pts: np.ndarray) -> float:
    lens = [float(np.linalg.norm(pts[(i + 1) % 4] - pts[i])) for i in range(4)]
    return float(min(lens))
