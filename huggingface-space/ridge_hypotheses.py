"""ridge_hypotheses.py
=========================
Detect ridge candidates in an aerial roof image.

A "ridge" here is a line segment on the roof that is:
  - close to the building's primary OR secondary global axis
  - long enough to be structural (not noise)
  - aligned with strong gradient (Canny edge)

Multiple Hough segments lying on the same support line are clustered
into a single Ridge object.

Public API
----------
    ridges = detect_ridges(image_bgr, axes, main_rect_4pts, config=RidgeConfig())
    # → list of Ridge dicts:
    #   {"p1":[x,y], "p2":[x,y], "angle_deg": ...,
    #    "length_px": ..., "strength": ...,
    #    "axis": "primary" | "secondary",
    #    "n_supporting_segments": int}

Method
------
1. ROI = bbox(main_rect) dilated by `roi_margin_px`. Outside is masked out.
2. Grayscale → bilateral filter → Canny (auto-thresholds from median).
3. HoughLinesP → list of segments (x1, y1, x2, y2).
4. Filter each segment:
     - angle within `angle_tolerance_deg` of primary OR secondary axis
     - length ≥ `min_length_frac` × short side of main_rect
5. Cluster segments lying on the same support line:
     - project each segment's midpoint to the (axis, perpendicular_distance)
       canonical coordinate
     - bin by (axis, perp_dist rounded to `cluster_perp_bin_px`)
     - within each bin, take the convex hull of all endpoints in the axis
       direction → one merged segment per bin
6. For each merged Ridge, compute strength = mean gradient magnitude
   under its line (anti-aliased sampling).
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple
import numpy as np
import cv2


@dataclass
class RidgeConfig:
    # ROI
    roi_margin_px: int = 25

    # Pre-processing
    bilateral_d: int = 7
    bilateral_sigma_color: float = 35.0
    bilateral_sigma_space: float = 35.0
    canny_sigma: float = 0.33                  # auto t1/t2 from median

    # HoughLinesP
    hough_rho: float = 1.0
    hough_theta: float = np.pi / 360.0
    hough_threshold: int = 30                  # was 40
    hough_min_line_length_frac: float = 0.07   # fraction of short(main)
    hough_max_line_gap_px: int = 10

    # Filtering
    angle_tolerance_deg: float = 10.0          # was 7
    min_segment_length_frac: float = 0.07      # was 0.10

    # Clustering on (axis, perpendicular_distance)
    cluster_perp_bin_px: float = 14.0
    cluster_min_total_length_frac: float = 0.12  # was 0.15

    # Strength sampling
    strength_thickness_px: int = 3


# ===========================================================================
# Public API
# ===========================================================================
def detect_ridges(image_bgr: np.ndarray,
                  axes: Dict,
                  main_rect_4pts: List[List[float]],
                  config: RidgeConfig = RidgeConfig()) -> List[Dict]:
    """Detect ridge candidates. See module docstring."""
    H, W = image_bgr.shape[:2]
    main = np.asarray(main_rect_4pts, dtype=np.float64)[:4]

    # ---- 1. ROI mask ----------------------------------------------------
    roi_mask = _build_roi_mask(H, W, main, config.roi_margin_px)

    # Short side of main (for relative length thresholds)
    sides = [float(np.linalg.norm(main[(i+1) % 4] - main[i])) for i in range(4)]
    sides.sort()
    short_side = sides[0]
    min_len = max(20.0, config.min_segment_length_frac * short_side)
    hough_min_len = max(15, int(config.hough_min_line_length_frac * short_side))

    # ---- 2. Edge map ---------------------------------------------------
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, config.bilateral_d,
                               config.bilateral_sigma_color,
                               config.bilateral_sigma_space)
    m = float(np.median(gray))
    lo = int(max(0,   (1.0 - config.canny_sigma) * m))
    hi = int(min(255, (1.0 + config.canny_sigma) * m))
    edges = cv2.Canny(gray, lo, hi)
    edges = cv2.bitwise_and(edges, roi_mask)

    # Gradient magnitude (for strength scoring)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.sqrt(gx * gx + gy * gy)
    gmax = float(grad.max())
    if gmax > 0:
        grad = grad / gmax

    # ---- 3. HoughLinesP ------------------------------------------------
    raw = cv2.HoughLinesP(edges, config.hough_rho, config.hough_theta,
                          config.hough_threshold,
                          minLineLength=hough_min_len,
                          maxLineGap=config.hough_max_line_gap_px)
    if raw is None or len(raw) == 0:
        return []
    segs = raw.reshape(-1, 4).astype(np.float64)

    # ---- 4. Filter by angle + length ----------------------------------
    pa = axes["primary_axis_deg"]
    sa = axes["secondary_axis_deg"]
    kept: List[Dict] = []
    for x1, y1, x2, y2 in segs:
        dx, dy = x2 - x1, y2 - y1
        length = float(np.hypot(dx, dy))
        if length < min_len:
            continue
        ang = float(np.rad2deg(np.arctan2(dy, dx)))
        # Wrap to [-90, 90)
        ang = _wrap90(ang)
        dp = _angle_dist_mod180(ang - pa)
        ds = _angle_dist_mod180(ang - sa)
        if abs(dp) <= config.angle_tolerance_deg:
            axis = "primary"; ax_ang = pa
        elif abs(ds) <= config.angle_tolerance_deg:
            axis = "secondary"; ax_ang = sa
        else:
            continue
        kept.append({
            "x1": float(x1), "y1": float(y1),
            "x2": float(x2), "y2": float(y2),
            "angle_deg": ang,
            "length_px": length,
            "axis": axis,
            "axis_angle_deg": ax_ang,
        })

    if not kept:
        return []

    # ---- 5. Cluster colinear segments ---------------------------------
    ridges = _cluster_colinear(kept, axes, config, short_side)

    # ---- 6. Strength scoring ------------------------------------------
    out: List[Dict] = []
    min_total = config.cluster_min_total_length_frac * short_side
    for r in ridges:
        if r["length_px"] < min_total:
            continue
        r["strength"] = _line_strength(grad, r["p1"], r["p2"],
                                       config.strength_thickness_px)
        out.append(r)

    # Sort by length descending
    out.sort(key=lambda r: -r["length_px"])
    for i, r in enumerate(out):
        r["id"] = f"R{i+1}"
    return out


# ===========================================================================
# Internals
# ===========================================================================
def _build_roi_mask(H: int, W: int, main: np.ndarray,
                    margin_px: int) -> np.ndarray:
    """Filled polygon of main_rect, dilated by margin, used to mask edges."""
    m = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(m, [main.astype(np.int32)], 255)
    if margin_px > 0:
        k = np.ones((2 * margin_px + 1,) * 2, np.uint8)
        m = cv2.dilate(m, k)
    return m


def _wrap90(a: float) -> float:
    """Wrap an angle in degrees to [-90, 90)."""
    while a < -90.0:
        a += 180.0
    while a >= 90.0:
        a -= 180.0
    return a


def _angle_dist_mod180(a: float) -> float:
    """Shortest signed delta in (-90, 90]."""
    return ((a + 90.0) % 180.0) - 90.0


def _cluster_colinear(segments: List[Dict], axes: Dict,
                      cfg: RidgeConfig, short_side: float) -> List[Dict]:
    """Bin segments by (axis, perpendicular distance from main center),
    then merge each bin into one segment along the axis direction."""
    c = np.asarray(axes["center_px"], dtype=np.float64)
    u = np.asarray(axes["primary_unit_vec"], dtype=np.float64)
    v = np.asarray(axes["secondary_unit_vec"], dtype=np.float64)

    bins: Dict[Tuple[str, int], List[Dict]] = {}
    for s in segments:
        mid = np.array([(s["x1"] + s["x2"]) / 2,
                        (s["y1"] + s["y2"]) / 2]) - c
        if s["axis"] == "primary":
            # Perp direction is v; segment lies along u
            perp = float(np.dot(mid, v))
            along_axis = u
        else:
            perp = float(np.dot(mid, u))
            along_axis = v
        bin_idx = int(round(perp / cfg.cluster_perp_bin_px))
        key = (s["axis"], bin_idx)
        s["_along_axis"] = along_axis
        s["_perp"] = perp
        bins.setdefault(key, []).append(s)

    merged: List[Dict] = []
    for (axis_name, _bidx), group in bins.items():
        if not group:
            continue
        # All endpoints projected onto along_axis from center c
        along = group[0]["_along_axis"]
        endpoints = []
        for s in group:
            for px, py in [(s["x1"], s["y1"]), (s["x2"], s["y2"])]:
                t = float(np.dot(np.array([px, py]) - c, along))
                endpoints.append((t, px, py))
        endpoints.sort()
        t_min, _, _ = endpoints[0]
        t_max, _, _ = endpoints[-1]

        # Perpendicular position = average of group perps
        perp = float(np.mean([s["_perp"] for s in group]))

        # Reconstruct ridge endpoints in image frame:
        # p = center + t * along + perp * perp_dir
        if axis_name == "primary":
            perp_dir = v
        else:
            perp_dir = u
        p_min = c + t_min * along + perp * perp_dir
        p_max = c + t_max * along + perp * perp_dir

        length = float(np.linalg.norm(p_max - p_min))
        merged.append({
            "p1": [float(p_min[0]), float(p_min[1])],
            "p2": [float(p_max[0]), float(p_max[1])],
            "axis": axis_name,
            "angle_deg": (axes["primary_axis_deg"] if axis_name == "primary"
                          else axes["secondary_axis_deg"]),
            "length_px": length,
            "n_supporting_segments": len(group),
            "perp_offset_px": perp,
        })
    return merged


def _line_strength(grad: np.ndarray, p1: List[float], p2: List[float],
                   thickness: int) -> float:
    """Mean gradient magnitude under the line p1→p2 (rasterized, thick)."""
    H, W = grad.shape
    mask = np.zeros((H, W), dtype=np.uint8)
    cv2.line(mask, (int(round(p1[0])), int(round(p1[1]))),
                  (int(round(p2[0])), int(round(p2[1]))),
             255, thickness=thickness)
    on = mask > 0
    n = int(on.sum())
    if n == 0:
        return 0.0
    return float(grad[on].mean())
