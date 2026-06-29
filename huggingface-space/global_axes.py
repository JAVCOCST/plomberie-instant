"""global_axes.py
==================
Compute the two orthogonal global axes of the building from the main
rectangle. Every downstream rectangle (addons, future ridges) MUST snap
to one of these axes — no free rotation allowed.

Public API
----------
    axes = compute_global_axes(main_rect_4pts)
    # → {"primary_axis_deg": ..., "secondary_axis_deg": ...,
    #    "center_px": [cx, cy], "primary_length_px": ...,
    #    "secondary_length_px": ...}

    snapped = snap_angle_to_axes(angle_deg, axes)
    # → "primary" | "secondary"  (whichever is closer modulo 180°)
"""
from __future__ import annotations
from typing import Dict, List
import numpy as np


def compute_global_axes(main_rect_4pts: List[List[float]]) -> Dict:
    """Compute primary (long side) + secondary (short side) global axes.

    Args:
        main_rect_4pts: 4 corners of the main rectangle, in any order.

    Returns dict with:
        primary_axis_deg     : long-side orientation, in [-90, 90)
        secondary_axis_deg   : primary + 90, normalized to [-90, 90)
        center_px            : [cx, cy]
        primary_length_px    : length along primary axis
        secondary_length_px  : length along secondary axis
        primary_unit_vec     : [ux, uy]
        secondary_unit_vec   : [ux, uy]
    """
    pts = np.asarray(main_rect_4pts, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[0] < 4:
        raise ValueError(f"main_rect_4pts must be 4×2, got shape {pts.shape}")
    pts = pts[:4]  # truncate any closing duplicate

    center = pts.mean(axis=0)

    # Compute the 4 side vectors and pick the longest as primary.
    sides = []
    for i in range(4):
        v = pts[(i + 1) % 4] - pts[i]
        length = float(np.linalg.norm(v))
        sides.append((length, v))
    sides.sort(key=lambda x: x[0], reverse=True)

    # Average the two longest (opposite) sides for stability.
    long1, long2 = sides[0][1], sides[1][1]
    if np.dot(long1, long2) < 0:
        long2 = -long2
    primary_vec = (long1 + long2) / 2.0
    primary_len = float(np.linalg.norm(primary_vec))
    primary_unit = primary_vec / max(primary_len, 1e-9)

    # Secondary = 90° rotation of primary (CCW).
    secondary_unit = np.array([-primary_unit[1], primary_unit[0]])

    # Same averaging for the secondary length using the 2 short sides.
    short1, short2 = sides[2][1], sides[3][1]
    if np.dot(short1, short2) < 0:
        short2 = -short2
    secondary_len = float(np.linalg.norm((short1 + short2) / 2.0))

    primary_deg = _wrap_angle(np.rad2deg(np.arctan2(primary_unit[1],
                                                    primary_unit[0])))
    secondary_deg = _wrap_angle(primary_deg + 90.0)

    return {
        "primary_axis_deg":    float(primary_deg),
        "secondary_axis_deg":  float(secondary_deg),
        "center_px":           [float(center[0]), float(center[1])],
        "primary_length_px":   float(primary_len),
        "secondary_length_px": float(secondary_len),
        "primary_unit_vec":    [float(primary_unit[0]), float(primary_unit[1])],
        "secondary_unit_vec":  [float(secondary_unit[0]), float(secondary_unit[1])],
    }


def snap_angle_to_axes(angle_deg: float, axes: Dict) -> str:
    """Return 'primary' or 'secondary' based on which axis is closer
    (modulo 180°) to angle_deg."""
    pa = _wrap_angle(angle_deg) - axes["primary_axis_deg"]
    sa = _wrap_angle(angle_deg) - axes["secondary_axis_deg"]
    pa = _angle_diff_mod180(pa)
    sa = _angle_diff_mod180(sa)
    return "primary" if abs(pa) <= abs(sa) else "secondary"


def project_points_to_axes(points_px: np.ndarray, axes: Dict) -> np.ndarray:
    """Project (N, 2) image points into the global axis frame.

    Returns (N, 2): first column = primary-axis coord, second = secondary."""
    c = np.asarray(axes["center_px"], dtype=np.float64)
    u = np.asarray(axes["primary_unit_vec"], dtype=np.float64)
    v = np.asarray(axes["secondary_unit_vec"], dtype=np.float64)
    R = np.stack([u, v], axis=0)            # 2×2 (rows = u, v)
    return (points_px - c) @ R.T


def unproject_axes_to_points(local_pts: np.ndarray, axes: Dict) -> np.ndarray:
    """Inverse of project_points_to_axes."""
    c = np.asarray(axes["center_px"], dtype=np.float64)
    u = np.asarray(axes["primary_unit_vec"], dtype=np.float64)
    v = np.asarray(axes["secondary_unit_vec"], dtype=np.float64)
    R = np.stack([u, v], axis=0)
    return local_pts @ R + c


def _wrap_angle(a: float) -> float:
    while a < -90.0:
        a += 180.0
    while a >= 90.0:
        a -= 180.0
    return a


def _angle_diff_mod180(a: float) -> float:
    """Return the signed angle in (-90, +90] equivalent to a modulo 180."""
    a = ((a + 90.0) % 180.0) - 90.0
    return a
