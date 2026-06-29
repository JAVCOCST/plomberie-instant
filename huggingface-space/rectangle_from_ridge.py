"""rectangle_from_ridge.py
============================
Generate a structural rectangle from a ridge candidate.

Inputs
------
    ridge          : dict from ridge_hypotheses (has p1, p2, axis, angle_deg,
                                                 length_px, axis_angle_deg…)
    image_bgr      : the image (for gutter-edge search)
    axes           : the global axes dict
    main_rect_4pts : main envelope, used only to clip the candidate

Output
------
    {
      "points":          [[x,y]*4],       # 4 corners snapped to axes
      "ridge":           [[x1,y1],[x2,y2]],
      "width_px":        float,           # short dim (perpendicular to ridge)
      "length_px":       float,           # long dim (along ridge)
      "axis":            "primary"|"secondary",
      "gutter_support":  {"side_a": ..., "side_b": ..., "method": "edge|fallback"},
    }

Method
------
The ridge gives:
  - the LONG axis of the rectangle (direction of the ridge)
  - the CENTER of the rectangle (along the ridge perpendicular)

Width estimation (perpendicular distance to the gutter on each side):
  1. Compute the gradient magnitude image (cached if you pass `grad`).
  2. Sample perpendicular profiles at N points along the ridge,
     out to ±max_search_px from the ridge.
  3. For each profile, find the strongest gradient peak (mean stack).
  4. Take the median peak distance on each side → side_a, side_b.
  5. If no clean peak → fallback to FALLBACK_WIDTH_RATIO × ridge_length.
  6. Build the rectangle in canonical (axis-aligned) frame, unproject.

The rectangle is allowed to overlap the main envelope (that's the whole point).
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import numpy as np
import cv2

from global_axes import (project_points_to_axes,
                         unproject_axes_to_points)


@dataclass
class RectFromRidgeConfig:
    n_profile_samples:   int   = 21        # along the ridge
    max_search_px:       int   = 80        # ± perpendicular search distance
    min_peak_distance_px: int  = 6         # ignore peaks too close to the ridge
    min_peak_strength:   float = 0.10      # normalized gradient ≥ this
    fallback_width_ratio: float = 0.55     # if no peak: width = ratio × length
    width_max_ratio_to_length: float = 1.10  # cap absurd widths
    width_min_px:        float = 30.0

    # v1.3 — peripheral ridge handling
    min_samples_for_side: int   = 3        # need ≥ this many profile hits
                                           # to call a side "supported"
    peripheral_fallback_ratio: float = 0.35  # fallback span for the OFF-roof
                                             # side when only one side is supported
    # v1.3 — local roof recentering
    recenter_enabled:           bool  = True
    recenter_max_shift_ratio:   float = 0.25   # cap shift to ratio × short_side
    recenter_lab_threshold:     float = 25.0   # roof color tolerance
    recenter_sample_inset_pct:  float = 0.30   # central inset on main for sample
    # v1.4 — stabilization: never apply a shift that DECREASES internality.
    recenter_revert_if_worse:   bool  = True
    recenter_min_improve_pct:   float = 0.02   # require ≥ 2 pp improvement


def rectangle_from_ridge(ridge: Dict, image_bgr: np.ndarray, axes: Dict,
                         main_rect_4pts: Optional[List[List[float]]] = None,
                         grad: Optional[np.ndarray] = None,
                         config: RectFromRidgeConfig = RectFromRidgeConfig()
                         ) -> Dict:
    """Build a structural rectangle around the given ridge."""
    H, W = image_bgr.shape[:2]
    if grad is None:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        grad = np.sqrt(gx * gx + gy * gy)
        m = float(grad.max())
        if m > 0:
            grad = grad / m

    p1 = np.asarray(ridge["p1"], dtype=np.float64)
    p2 = np.asarray(ridge["p2"], dtype=np.float64)

    # In the canonical frame: project the ridge, work in (u, v).
    local = project_points_to_axes(np.stack([p1, p2]), axes)
    if ridge["axis"] == "primary":
        # Ridge lies along u (primary). v is the "perpendicular" direction.
        u_long = local[:, 0]
        v_perp = float(np.mean(local[:, 1]))
        long_dir, perp_dir = "u", "v"
    else:
        # Ridge lies along v (secondary). u is perpendicular.
        u_long = local[:, 1]
        v_perp = float(np.mean(local[:, 0]))
        long_dir, perp_dir = "v", "u"

    t_min, t_max = float(min(u_long)), float(max(u_long))
    length = t_max - t_min

    # ---- 1. Estimate width by perpendicular profile sweep --------------
    side_a, side_b, method, ridge_type, n_supported = _estimate_widths(
        ridge, image_bgr, grad, axes, config)

    # Sanity caps — but allow asymmetric widths for peripheral ridges
    total_w = side_a + side_b
    max_total = config.width_max_ratio_to_length * length
    if total_w > max_total:
        # Scale down proportionally (preserves asymmetry)
        scale = max_total / total_w
        side_a *= scale
        side_b *= scale
        method = method + "_capped"
    if (side_a + side_b) < config.width_min_px:
        # Both sides tiny → fall back proportional symmetric
        w = max(config.width_min_px, config.fallback_width_ratio * length)
        side_a = side_b = w / 2.0
        method = "fallback"
        ridge_type = "peripheral"

    # ---- 2. Build canonical rect ---------------------------------------
    if long_dir == "u":
        u1, u2 = t_min, t_max
        v1, v2 = v_perp - side_a, v_perp + side_b
    else:
        v1, v2 = t_min, t_max
        u1, u2 = v_perp - side_a, v_perp + side_b

    canonical = np.array([[u1, v1], [u2, v1], [u2, v2], [u1, v2]],
                         dtype=np.float64)
    img_pts = unproject_axes_to_points(canonical, axes)

    # Clip to image
    img_pts[:, 0] = np.clip(img_pts[:, 0], 0, W - 1)
    img_pts[:, 1] = np.clip(img_pts[:, 1], 0, H - 1)

    # ---- 3. Local roof recentering (v1.3, stabilized in v1.4) ---------
    recenter_dbg: Dict = {"enabled": False}
    if config.recenter_enabled and main_rect_4pts is not None:
        # Measure internality BEFORE shift (for stabilization check)
        before_score = _measure_bilateral_roof_frac(
            img_pts, image_bgr, main_rect_4pts, config)
        recentered_pts, applied_offset, recenter_dbg = _recenter_on_roof_mass(
            img_pts, image_bgr, main_rect_4pts, config)
        recenter_dbg["enabled"] = True
        recenter_dbg["applied_offset"] = list(applied_offset)
        recenter_dbg["bilateral_roof_before"] = float(before_score)

        # v1.4 stabilization: keep shift only if it improves bilateral roof
        if (config.recenter_revert_if_worse
                and (abs(applied_offset[0]) > 0.5
                     or abs(applied_offset[1]) > 0.5)):
            after_score = _measure_bilateral_roof_frac(
                recentered_pts, image_bgr, main_rect_4pts, config)
            recenter_dbg["bilateral_roof_after"] = float(after_score)
            if after_score < (before_score + config.recenter_min_improve_pct):
                # Revert: shift didn't help meaningfully
                recenter_dbg["reverted"] = True
                recenter_dbg["applied_offset"] = [0.0, 0.0]
                # img_pts stays unchanged
            else:
                recenter_dbg["reverted"] = False
                img_pts = recentered_pts
        else:
            img_pts = recentered_pts

    return {
        "points": [[int(round(p[0])), int(round(p[1]))] for p in img_pts],
        "ridge":  [[int(round(p1[0])), int(round(p1[1]))],
                   [int(round(p2[0])), int(round(p2[1]))]],
        "width_px":  float(side_a + side_b),
        "length_px": float(length),
        "axis":      ridge["axis"],
        "ridge_type": ridge_type,                  # v1.3 — internal | peripheral
        "n_sides_with_peak": int(n_supported),     # v1.3 — 0, 1, 2
        "gutter_support": {"side_a_px": float(side_a),
                           "side_b_px": float(side_b),
                           "method": method},
        "recenter_debug": recenter_dbg,            # v1.3
    }


# ===========================================================================
def _estimate_widths(ridge: Dict, image_bgr: np.ndarray, grad: np.ndarray,
                     axes: Dict, cfg: RectFromRidgeConfig
                     ) -> Tuple[float, float, str, str, int]:
    """Sample perpendicular profiles along the ridge, find gutter peaks.

    Returns (side_a, side_b, method, ridge_type, n_sides_with_peak).
    v1.3: classify the ridge as 'internal' (peaks on both sides) or
          'peripheral' (peak on only one side, or none) and DO NOT
          symmetrize asymmetric measurements.
    """
    H, W = grad.shape
    p1 = np.asarray(ridge["p1"], dtype=np.float64)
    p2 = np.asarray(ridge["p2"], dtype=np.float64)
    L = float(np.linalg.norm(p2 - p1))
    if L < 5:
        w = cfg.fallback_width_ratio * L / 2
        return w, w, "fallback", "peripheral", 0

    direction = (p2 - p1) / L
    perp = np.array([-direction[1], direction[0]])  # 90° CCW

    samples_a, samples_b = [], []
    for i in range(cfg.n_profile_samples):
        t = (i + 0.5) / cfg.n_profile_samples
        center = p1 + t * L * direction

        offsets = np.arange(-cfg.max_search_px, cfg.max_search_px + 1)
        prof = np.zeros(len(offsets), dtype=np.float32)
        for k, off in enumerate(offsets):
            pt = center + off * perp
            x, y = int(round(pt[0])), int(round(pt[1]))
            if 0 <= x < W and 0 <= y < H:
                prof[k] = float(grad[y, x])

        mid = cfg.max_search_px
        a_prof = prof[:mid - cfg.min_peak_distance_px]
        b_prof = prof[mid + cfg.min_peak_distance_px + 1:]

        if a_prof.size > 0 and a_prof.max() >= cfg.min_peak_strength:
            k_a = int(np.argmax(a_prof))
            d_a = (mid - cfg.min_peak_distance_px - 1 - k_a)
            samples_a.append(d_a)
        if b_prof.size > 0 and b_prof.max() >= cfg.min_peak_strength:
            k_b = int(np.argmax(b_prof))
            d_b = cfg.min_peak_distance_px + 1 + k_b
            samples_b.append(d_b)

    # Classify ridge_type from peak supports
    has_a = len(samples_a) >= cfg.min_samples_for_side
    has_b = len(samples_b) >= cfg.min_samples_for_side
    n_supported = int(has_a) + int(has_b)

    if n_supported == 2:
        # INTERNAL — keep both measured medians, no symmetrization
        side_a = float(np.median(samples_a))
        side_b = float(np.median(samples_b))
        return side_a, side_b, "edge", "internal", 2

    if n_supported == 1:
        # PERIPHERAL — use the measured side as-is, fallback CONTROLLED
        # for the unsupported side (don't pretend it's symmetric).
        fb = cfg.peripheral_fallback_ratio * L
        if has_a:
            side_a = float(np.median(samples_a))
            side_b = float(fb)
        else:
            side_a = float(fb)
            side_b = float(np.median(samples_b))
        return side_a, side_b, "edge_one_side", "peripheral", 1

    # NEITHER side has a peak → fully proportional fallback, peripheral
    w = cfg.fallback_width_ratio * L
    return w / 2.0, w / 2.0, "fallback", "peripheral", 0


# ===========================================================================
def _recenter_on_roof_mass(
    rect_pts: np.ndarray,
    image_bgr: np.ndarray,
    main_rect_4pts: List[List[float]],
    cfg: RectFromRidgeConfig,
) -> Tuple[np.ndarray, Tuple[float, float], Dict]:
    """Translate the rect slightly toward the roof centroid INSIDE its bounds.

    Bounded shift (≤ recenter_max_shift_ratio × short_side). Returns the
    shifted rect, the (dx, dy) applied, and a debug dict.
    """
    H, W = image_bgr.shape[:2]
    pts = np.asarray(rect_pts, dtype=np.float64)
    main = np.asarray(main_rect_4pts, dtype=np.float64)
    if pts.shape[0] >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if main.shape[0] >= 2 and np.allclose(main[0], main[-1]):
        main = main[:-1]

    # Sample roof color from the centre of main
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    c_main = main.mean(axis=0)
    shrunk = c_main + (main - c_main) * (1.0 - cfg.recenter_sample_inset_pct)
    smask = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(smask, [shrunk.astype(np.int32)], 255)
    ys_s, xs_s = np.nonzero(smask)
    if xs_s.size < 5:
        return pts, (0.0, 0.0), {"skipped": "no_sample"}
    sample_lab = np.median(lab[ys_s, xs_s], axis=0)

    # Roof mask within rect bounds
    rect_mask = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(rect_mask, [pts.astype(np.int32)], 255)
    ys, xs = np.nonzero(rect_mask)
    if xs.size < 20:
        return pts, (0.0, 0.0), {"skipped": "rect_too_small"}

    dist_lab = np.linalg.norm(lab[ys, xs] - sample_lab[None, :], axis=1)
    is_roof = dist_lab < cfg.recenter_lab_threshold
    n_roof = int(is_roof.sum())
    n_total = int(xs.size)
    if n_roof < 10:
        return pts, (0.0, 0.0), {"skipped": "no_roof_pixels",
                                  "n_roof": n_roof}

    roof_centroid = np.array([float(xs[is_roof].mean()),
                              float(ys[is_roof].mean())])
    rect_centroid = pts.mean(axis=0)
    raw_offset = roof_centroid - rect_centroid

    # Cap the shift to ratio × short_side (anti-drift)
    sides = [float(np.linalg.norm(pts[(i + 1) % 4] - pts[i]))
             for i in range(4)]
    short_side = float(min(sides))
    max_shift = cfg.recenter_max_shift_ratio * short_side
    raw_norm = float(np.linalg.norm(raw_offset))
    if raw_norm > max_shift and raw_norm > 1e-6:
        offset = raw_offset * (max_shift / raw_norm)
    else:
        offset = raw_offset

    new_pts = pts + offset
    new_pts[:, 0] = np.clip(new_pts[:, 0], 0, W - 1)
    new_pts[:, 1] = np.clip(new_pts[:, 1], 0, H - 1)

    return new_pts, (float(offset[0]), float(offset[1])), {
        "roof_pixel_count": n_roof,
        "rect_pixel_count": n_total,
        "raw_offset_px":    [float(raw_offset[0]), float(raw_offset[1])],
        "applied_offset_px": [float(offset[0]), float(offset[1])],
        "max_shift_px":     float(max_shift),
        "clamped":          bool(raw_norm > max_shift),
    }


# ===========================================================================
def _measure_bilateral_roof_frac(
    rect_pts: np.ndarray,
    image_bgr: np.ndarray,
    main_rect_4pts: List[List[float]],
    cfg: RectFromRidgeConfig,
) -> float:
    """v1.4: bilateral_roof_frac = min(roof_frac_a, roof_frac_b)
    for the rect split along its ridge axis. Used to decide whether a
    recentering shift improved the rect or made it worse.
    Returns 0..1, higher = both sides more roof-like.
    """
    H, W = image_bgr.shape[:2]
    pts = np.asarray(rect_pts, dtype=np.float64)
    main = np.asarray(main_rect_4pts, dtype=np.float64)
    if pts.shape[0] >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if main.shape[0] >= 2 and np.allclose(main[0], main[-1]):
        main = main[:-1]
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    c_main = main.mean(axis=0)
    shrunk = c_main + (main - c_main) * (1.0 - cfg.recenter_sample_inset_pct)
    smask = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(smask, [shrunk.astype(np.int32)], 255)
    ys_s, xs_s = np.nonzero(smask)
    if xs_s.size < 5:
        return 0.0
    sample_lab = np.median(lab[ys_s, xs_s], axis=0)
    rect_mask = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(rect_mask, [pts.astype(np.int32)], 255)
    ys, xs = np.nonzero(rect_mask)
    if xs.size < 20:
        return 0.0
    # Split along ridge axis (= long side direction)
    side01 = pts[1] - pts[0]
    n01 = float(np.linalg.norm(side01))
    if n01 < 1e-6:
        return 0.0
    long_dir = side01 / n01
    perp = np.array([-long_dir[1], long_dir[0]])
    centroid = pts.mean(axis=0)
    coords = np.column_stack([xs, ys]).astype(np.float64)
    perp_proj = (coords - centroid) @ perp
    side_a = perp_proj > 0
    side_b = perp_proj < 0
    if int(side_a.sum()) < 8 or int(side_b.sum()) < 8:
        return 0.0
    dist_lab = np.linalg.norm(lab[ys, xs] - sample_lab[None, :], axis=1)
    is_roof = dist_lab < cfg.recenter_lab_threshold
    fa = float(is_roof[side_a].mean())
    fb = float(is_roof[side_b].mean())
    return float(min(fa, fb))
