"""semantic_order.py
======================
Reorder a rectangle's 4 points so that pts[0]→pts[1] is the **ridge axis**
(parallel to the building's faîtière). This is what the downstream 3D
engine expects.

Public API
----------
    pts_ordered, valid = ensure_semantic_point_order(rect_4pts,
                                                     ridge_axis_hint=None)
    ridge_axis_px      = compute_ridge_axis(rect_4pts)   # midpoint 0→1 ↔ midpoint 2→3
    draw_orientation_debug(ax, rect_4pts, ridge_axis_px=None)

Conventions
-----------
  pts[0] → pts[1]   : RIDGE AXIS  (long side, parallel to faîtière)
  pts[1] → pts[2]   : GABLE SIDE  (short side, perpendicular to faîtière)
  pts[2] → pts[3]   : RIDGE AXIS  (other long side)
  pts[3] → pts[0]   : GABLE SIDE  (other short side)

`semantic_order_valid` is True iff
  length(pts[0]→pts[1]) ≥ length(pts[1]→pts[2])
i.e. the side 0→1 is at least as long as side 1→2.
"""
from __future__ import annotations
from typing import List, Optional, Tuple
import numpy as np


def ensure_semantic_point_order(
    rect_4pts: List[List[float]],
    ridge_axis_hint: Optional[List[List[float]]] = None
) -> Tuple[List[List[float]], bool]:
    """Reorder pts so pts[0]→pts[1] is the ridge axis.

    Args:
        rect_4pts        : 4 corners in any order (or 5 with closing duplicate).
        ridge_axis_hint  : optional segment [p1, p2] giving the ground-truth
                           ridge direction. If supplied, the side most parallel
                           to it becomes 0→1. If None, the longest side does.

    Returns:
        (pts_ordered : list of 4 [x, y],
         valid       : bool — True iff |0→1| >= |1→2| after reorder).
    """
    pts = np.asarray(rect_4pts, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2:
        raise ValueError(f"rect_4pts must be (N,2), got shape {pts.shape}")
    # Drop a possible closing duplicate
    if pts.shape[0] >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if pts.shape[0] != 4:
        raise ValueError(f"need exactly 4 corners, got {pts.shape[0]}")

    # 4 side vectors and their lengths
    sides = []
    for i in range(4):
        v = pts[(i + 1) % 4] - pts[i]
        L = float(np.linalg.norm(v))
        sides.append((L, i, v))

    if ridge_axis_hint is not None:
        # Pick the side most parallel to the hint
        hint = np.asarray(ridge_axis_hint, dtype=np.float64)
        if hint.shape != (2, 2):
            raise ValueError(f"ridge_axis_hint must be (2,2), got {hint.shape}")
        hv = hint[1] - hint[0]
        hn = np.linalg.norm(hv)
        if hn < 1e-9:
            best_i = max(range(4), key=lambda i: sides[i][0])
        else:
            hv = hv / hn
            best_i = max(range(4),
                         key=lambda i: abs(np.dot(sides[i][2] / max(sides[i][0], 1e-9), hv)))
    else:
        # Longest side wins
        best_i = max(range(4), key=lambda i: sides[i][0])

    # Roll pts so the start of best_i becomes index 0
    pts_ord = np.roll(pts, -best_i, axis=0)

    # Validate
    len_01 = float(np.linalg.norm(pts_ord[1] - pts_ord[0]))
    len_12 = float(np.linalg.norm(pts_ord[2] - pts_ord[1]))
    valid = len_01 >= len_12 - 1e-6  # tolerate equality on perfect squares

    return [[float(p[0]), float(p[1])] for p in pts_ord], bool(valid)


def compute_ridge_axis(rect_4pts: List[List[float]]) -> List[List[float]]:
    """Return [start, end] of the ridge axis.

    The ridge axis is the median line PARALLEL to pts[0]→pts[1]
    (i.e. parallel to the long side). It runs from the midpoint of
    one gable (side 3→0) to the midpoint of the other (side 1→2).

    Caller must pass an already semantically-ordered rect.
    """
    pts = np.asarray(rect_4pts, dtype=np.float64)
    if pts.shape[0] >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    # Gable 1 = side 1→2, gable 2 = side 3→0
    mid_gable_1 = (pts[1] + pts[2]) / 2.0
    mid_gable_2 = (pts[3] + pts[0]) / 2.0
    return [[float(mid_gable_2[0]), float(mid_gable_2[1])],
            [float(mid_gable_1[0]), float(mid_gable_1[1])]]


def draw_orientation_debug(ax, rect_4pts: List[List[float]],
                           ridge_axis_px: Optional[List[List[float]]] = None,
                           label_prefix: str = "") -> None:
    """Matplotlib overlay: pts[0]→pts[1] in RED, pts[1]→pts[2] in BLUE.

    Caller is responsible for `ax.imshow(image)` before calling this.
    """
    pts = np.asarray(rect_4pts, dtype=np.float64)
    if pts.shape[0] >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]

    # pts[0] → pts[1]  RED (RIDGE AXIS expected here)
    p0, p1 = pts[0], pts[1]
    ax.annotate("", xy=(p1[0], p1[1]), xytext=(p0[0], p0[1]),
                arrowprops=dict(arrowstyle="->", color="red", lw=3.0,
                                mutation_scale=22))
    ax.plot([p0[0]], [p0[1]], "o", color="red", markersize=10,
            markeredgecolor="white", markeredgewidth=1.5, zorder=6)

    # pts[1] → pts[2]  BLUE (GABLE / pignon)
    p2 = pts[2]
    ax.annotate("", xy=(p2[0], p2[1]), xytext=(p1[0], p1[1]),
                arrowprops=dict(arrowstyle="->", color="blue", lw=2.5,
                                mutation_scale=18))
    # remaining sides as faint dashed lines (close the rect)
    p3 = pts[3]
    ax.plot([p2[0], p3[0]], [p2[1], p3[1]], "--", color="red",
            lw=1.2, alpha=0.6)
    ax.plot([p3[0], p0[0]], [p3[1], p0[1]], "--", color="blue",
            lw=1.0, alpha=0.5)

    # Ridge axis (midpoint to midpoint), magenta
    if ridge_axis_px is None:
        ridge_axis_px = compute_ridge_axis(rect_4pts)
    ra = np.asarray(ridge_axis_px)
    ax.plot(ra[:, 0], ra[:, 1], "-", color="magenta", lw=2.2, alpha=0.9)
    ax.plot(ra[:, 0], ra[:, 1], "o", color="magenta", markersize=6,
            zorder=5)
    mid = ra.mean(axis=0)
    ax.text(mid[0], mid[1], f"{label_prefix}RIDGE AXIS EXPECTED",
            color="white", fontsize=8, ha="center", va="center",
            fontweight="bold",
            bbox=dict(facecolor="magenta", alpha=0.75, pad=2,
                      edgecolor="none"))
