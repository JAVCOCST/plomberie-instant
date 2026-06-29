"""fit_roof_rectangle.py
==========================
JAVCO MVP — simplified roof rectangle fitter.

Public API
----------
    result = fit_roof_rectangle(image_bgr, roof_type="unknown",
                                prior_polygon_px=optional_prior)
    print(result["selected"], result["score"], result["needs_review"])

Mission
-------
Find the best oriented rectangle / convex quadrilateral that matches the
roof's outer overhang line. NO masks, NO 20-vertex polygons, NO RANSAC,
NO organic segmentation. Just a clean quadrilateral.

Method
------
1. Take the prior (or fall back to a coarse center estimate).
2. Estimate dominant angle of the building (minAreaRect of the prior).
3. Generate ~2900 candidates around the prior:
       ±6° rotation (step 1°),
       ±10% width / height (step 5%),
       ±4 px translation (step 4 px).
4. Score each rectangle: edge alignment + proximity to prior +
   size sanity + (hips consistency for 4_pans).
5. Keep the best. If gain vs prior is small → return A_prior, expose B
   as suggestion only, flag needs_review.

Output
------
    {
      "selected": "A_prior" | "B_fitted_rectangle",
      "rectangle_px": [[x,y],[x,y],[x,y],[x,y]],
      "angle_deg": float,
      "score": float in [0,1],
      "needs_review": bool,
      "reason": str,
      # diagnostics:
      "A_prior_px": ...,
      "B_fitted_rectangle_px": ...,
      "scores_A": {...},
      "scores_B": {...},
    }
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import numpy as np
import cv2
from shapely.geometry import Polygon


# ===========================================================================
# Tunables
# ===========================================================================
@dataclass
class FitConfig:
    # Candidate generation grid
    rot_half_deg: float = 3.0           # ±3° (was 6) — prior is already well-oriented
    rot_step_deg: float = 1.0
    scale_half_pct: float = 10.0
    scale_step_pct: float = 5.0
    trans_half_px: int = 4
    trans_step_px: int = 4

    # Score weights
    w_edge_align:  float = 0.40
    w_proximity:   float = 0.30
    w_size_sanity: float = 0.20
    w_hips:        float = 0.10

    # Score helpers
    edge_thickness_px: int = 3
    grad_percentile: float = 70.0
    hips_thickness_px: int = 2

    # ROI for the gradient percentile: bbox of the prior + this margin.
    # Avoids rewarding edges on neighboring buildings / road / cars.
    roi_margin_px: int = 60

    # Size sanity band
    size_lo_ratio: float = 0.70
    size_hi_ratio: float = 1.30

    # Selection
    min_gain_to_swap: float = 0.05   # B - A must exceed this to swap
    min_score_no_review: float = 0.65

    # Roof_type → enable hips term
    hips_types = ("4_pans", "hip_4_sides", "pyramide")


CFG = FitConfig()


# ===========================================================================
# Public API
# ===========================================================================
def fit_roof_rectangle(image_bgr: np.ndarray,
                       roof_type: str = "unknown",
                       prior_polygon_px: Optional[List[List[float]]] = None
                       ) -> Dict:
    """Fit the best oriented rectangle for the roof outline.

    Args:
        image_bgr        : H×W×3 uint8 BGR image (full resolution).
        roof_type        : "flat" | "2_pans" | "4_pans" | "mixed" | ...
        prior_polygon_px : optional 4+-vertex polygon. If None, the function
                           uses a coarse center-block fallback.

    Returns: see module docstring.
    """
    H, W = image_bgr.shape[:2]

    # ---- 1. Preprocess + gradient -------------------------------------
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    grad = _gradient_norm(gray)

    # ---- 2. Build A_prior as a clean quadrilateral --------------------
    if prior_polygon_px is None or len(prior_polygon_px) < 4:
        A_prior = _fallback_center_rect(W, H)
        used_fallback = True
    else:
        A_prior = _to_quad4(prior_polygon_px)
        used_fallback = False

    base_angle = _angle_from_quad(A_prior)

    # Gradient strength threshold computed in the ROI of the prior + margin.
    # This avoids rewarding rectangles whose edges land on neighboring
    # buildings, the road, or cars far from the actual roof.
    grad_thr = _grad_threshold_in_roi(grad, A_prior, CFG.roi_margin_px,
                                      CFG.grad_percentile)

    # ---- 3. Generate candidates ---------------------------------------
    candidates = _generate_candidates(A_prior, base_angle, W, H)

    # ---- 4. Score A_prior + every candidate ---------------------------
    scores_A = _score_rect(A_prior, grad, A_prior, roof_type, grad_thr)

    best_B, scores_B = None, None
    for cand in candidates:
        sc = _score_rect(cand, grad, A_prior, roof_type, grad_thr)
        if scores_B is None or sc["total"] > scores_B["total"]:
            best_B, scores_B = cand, sc

    # ---- 5. Selection ------------------------------------------------
    gain = scores_B["total"] - scores_A["total"]
    if gain >= CFG.min_gain_to_swap:
        selected = "B_fitted_rectangle"
        rect = best_B
        score_final = scores_B["total"]
        reason = (f"B beats A by {gain:+.3f} "
                  f"(edge={scores_B['edge_alignment']:.2f}, "
                  f"prox={scores_B['proximity_to_prior']:.2f}, "
                  f"size={scores_B['size_sanity']:.2f}, "
                  f"hips={scores_B['hips_consistency']:.2f})")
    else:
        selected = "A_prior"
        rect = A_prior
        score_final = scores_A["total"]
        reason = (f"B gain {gain:+.3f} < {CFG.min_gain_to_swap}; "
                  f"kept A_prior")

    needs_review = (score_final < CFG.min_score_no_review) or used_fallback
    if used_fallback:
        reason = "no prior provided → coarse center fallback; " + reason

    return {
        "selected": selected,
        "rectangle_px": _as_int_list(rect),
        "angle_deg": float(_angle_from_quad(rect)),
        "score": float(score_final),
        "needs_review": bool(needs_review),
        "reason": reason,
        # Diagnostics:
        "A_prior_px": _as_int_list(A_prior),
        "B_fitted_rectangle_px": _as_int_list(best_B),
        "scores_A": scores_A,
        "scores_B": scores_B,
        "n_candidates": len(candidates),
        "used_fallback": used_fallback,
        "roof_type": roof_type,
    }


# ===========================================================================
# Helpers
# ===========================================================================
def _gradient_norm(gray: np.ndarray) -> np.ndarray:
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx ** 2 + gy ** 2)
    m = float(mag.max())
    return mag / m if m > 0 else mag


def _to_quad4(poly: List[List[float]]) -> np.ndarray:
    """Coerce a list of vertices into a 4-corner quadrilateral.

    If 4 vertices (with optional closing duplicate) → use as-is.
    Otherwise → minAreaRect of the input points.
    """
    pts = np.asarray(poly, dtype=np.float32)
    if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if len(pts) == 4:
        return pts.astype(np.float32)
    rect = cv2.minAreaRect(pts.reshape(-1, 1, 2))
    return cv2.boxPoints(rect).astype(np.float32)


def _fallback_center_rect(W: int, H: int) -> np.ndarray:
    """Coarse fallback when no prior is supplied: central 50%×50% rect."""
    cx, cy = W / 2.0, H / 2.0
    w, h = W * 0.5, H * 0.5
    return np.array([
        [cx - w / 2, cy - h / 2],
        [cx + w / 2, cy - h / 2],
        [cx + w / 2, cy + h / 2],
        [cx - w / 2, cy + h / 2],
    ], dtype=np.float32)


def _angle_from_quad(quad: np.ndarray) -> float:
    """Dominant angle of the quad in degrees, in [-90, 90)."""
    rect = cv2.minAreaRect(quad.reshape(-1, 1, 2))
    ang = rect[-1]
    (_, _), (w, h), _ = rect
    # OpenCV convention: angle is for the side closer to horizontal.
    # Normalize to "long side" angle.
    if w < h:
        ang = ang - 90.0
    # Wrap to [-90, 90)
    while ang < -90.0:
        ang += 180.0
    while ang >= 90.0:
        ang -= 180.0
    return float(ang)


def _build_rect(cx: float, cy: float, w: float, h: float,
                angle_deg: float) -> np.ndarray:
    """Build the 4 corners of an oriented rectangle centered on (cx, cy)."""
    rad = np.deg2rad(angle_deg)
    c, s = np.cos(rad), np.sin(rad)
    R = np.array([[c, -s], [s, c]], dtype=np.float32)
    hw, hh = w / 2.0, h / 2.0
    local = np.array([[-hw, -hh], [+hw, -hh], [+hw, +hh], [-hw, +hh]],
                     dtype=np.float32)
    return (local @ R.T) + np.array([cx, cy], dtype=np.float32)


def _generate_candidates(prior_quad: np.ndarray, base_angle: float,
                         W: int, H: int) -> List[np.ndarray]:
    """Grid search around the prior."""
    # Decompose prior into (center, w, h) in its own orientation
    center = prior_quad.mean(axis=0)
    rad = np.deg2rad(base_angle)
    c, s = np.cos(rad), np.sin(rad)
    Rt = np.array([[c, s], [-s, c]], dtype=np.float32)  # inverse rotation
    local = (prior_quad - center) @ Rt.T
    w0 = float(local[:, 0].max() - local[:, 0].min())
    h0 = float(local[:, 1].max() - local[:, 1].min())

    rotations = np.arange(-CFG.rot_half_deg, CFG.rot_half_deg + 1e-6, CFG.rot_step_deg)
    scales_w = np.arange(1 - CFG.scale_half_pct / 100, 1 + CFG.scale_half_pct / 100 + 1e-6,
                         CFG.scale_step_pct / 100)
    scales_h = scales_w.copy()
    trans = np.arange(-CFG.trans_half_px, CFG.trans_half_px + 1e-6, CFG.trans_step_px)

    out = []
    for dr in rotations:
        ang = base_angle + dr
        for sw in scales_w:
            for sh in scales_h:
                for tx in trans:
                    for ty in trans:
                        rect = _build_rect(center[0] + tx, center[1] + ty,
                                           w0 * sw, h0 * sh, ang)
                        # Clip-check: skip if any corner outside the image
                        if (rect[:, 0].min() < 0 or rect[:, 0].max() >= W or
                                rect[:, 1].min() < 0 or rect[:, 1].max() >= H):
                            continue
                        out.append(rect)
    return out


def _score_rect(rect: np.ndarray, grad: np.ndarray,
                prior_rect: np.ndarray, roof_type: str,
                grad_threshold: float) -> Dict[str, float]:
    H, W = grad.shape[:2]
    grad_strong = grad > grad_threshold

    # 1) edge_alignment: contour pixels coinciding with strong gradient
    cnt_mask = np.zeros((H, W), dtype=np.uint8)
    cv2.drawContours(cnt_mask, [rect.astype(np.int32)], -1, 255,
                     thickness=CFG.edge_thickness_px)
    pts_on = cnt_mask > 0
    n_on = int(pts_on.sum())
    edge_align = float((pts_on & grad_strong).sum() / n_on) if n_on > 0 else 0.0

    # 2) proximity_to_prior: IoU
    try:
        pa = Polygon(rect); pp = Polygon(prior_rect)
        if not pa.is_valid: pa = pa.buffer(0)
        if not pp.is_valid: pp = pp.buffer(0)
        inter = pa.intersection(pp).area
        union = pa.union(pp).area
        proximity = float(inter / union) if union > 0 else 0.0
        a_area = float(pa.area)
        p_area = float(pp.area)
    except Exception:
        proximity, a_area, p_area = 0.0, 0.0, 1.0

    # 3) size_sanity: ratio of cand-area / prior-area within [lo, hi] band
    if p_area > 0:
        r = a_area / p_area
        lo, hi = CFG.size_lo_ratio, CFG.size_hi_ratio
        if lo <= r <= hi:
            size_sanity = 1.0
        elif r < lo:
            size_sanity = max(0.0, r / lo)
        else:  # r > hi
            size_sanity = max(0.0, 1.0 - (r - hi) / 1.0)
    else:
        size_sanity = 0.0

    # 4) hips_consistency: only for hip-style roofs
    if roof_type in CFG.hips_types:
        diag = np.zeros((H, W), dtype=np.uint8)
        center = rect.mean(axis=0).astype(int)
        for corner in rect.astype(int):
            cv2.line(diag, tuple(corner), tuple(center), 255,
                     thickness=CFG.hips_thickness_px)
        on_diag = diag > 0
        n_diag = int(on_diag.sum())
        hips_score = float((on_diag & grad_strong).sum() / n_diag) if n_diag > 0 else 0.0
    else:
        hips_score = 1.0  # neutral

    total = (CFG.w_edge_align  * edge_align
           + CFG.w_proximity   * proximity
           + CFG.w_size_sanity * size_sanity
           + CFG.w_hips        * hips_score)

    return {
        "edge_alignment":     edge_align,
        "proximity_to_prior": proximity,
        "size_sanity":        size_sanity,
        "hips_consistency":   hips_score,
        "total":              float(total),
    }


def _grad_threshold_in_roi(grad: np.ndarray, prior_quad: np.ndarray,
                           margin_px: int, percentile: float) -> float:
    """Compute the gradient strength threshold from a ROI = bbox(prior) + margin.

    This excludes neighboring buildings / road / cars from setting the bar.
    """
    H, W = grad.shape[:2]
    x_min = max(0,    int(prior_quad[:, 0].min()) - margin_px)
    x_max = min(W - 1, int(prior_quad[:, 0].max()) + margin_px)
    y_min = max(0,    int(prior_quad[:, 1].min()) - margin_px)
    y_max = min(H - 1, int(prior_quad[:, 1].max()) + margin_px)
    if x_max <= x_min or y_max <= y_min:
        return float(np.percentile(grad, percentile))
    roi = grad[y_min:y_max + 1, x_min:x_max + 1]
    return float(np.percentile(roi, percentile))


def _as_int_list(arr: np.ndarray) -> List[List[int]]:
    return [[int(round(p[0])), int(round(p[1]))] for p in arr]


# ===========================================================================
# CLI helper (optional)
# ===========================================================================
if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("Usage: python fit_roof_rectangle.py image.jpg [roof_type]")
        sys.exit(0)
    img = cv2.imread(sys.argv[1])
    rtype = sys.argv[2] if len(sys.argv) > 2 else "unknown"
    res = fit_roof_rectangle(img, roof_type=rtype)
    print(json.dumps({k: v for k, v in res.items()
                      if k in ("selected", "rectangle_px", "angle_deg",
                               "score", "needs_review", "reason")},
                     indent=2))
