"""relational_graph.py
=========================
Classify each (Ri, Rj) candidate pair into a relationship type, per the
taxonomy in the R&D doc (§5 + §2). Sparse: only pairs that are not
fully disjoint are scored.

Pure annotation module. No selection / pruning lives here — see
`candidate_selection.py` for that.

Relationship taxonomy
---------------------
    duplicate                  : same ridge line + IoU > 0.70
                                 → one is a redundant duplicate
    redundant_variant          : IoU > 0.40, no perpendicular ridge between
                                 them → two attempts at the same volume
    child_of                   : containment ≥ 0.85 (Rj inscribed in Ri)
                                 → dormer, inner volume
    siblings_perpendicular     : ridges perpendicular, IoU 0.05..0.50
                                 → T-shape / L-shape junction
    siblings_parallel          : ridges parallel & non-collinear,
                                 IoU < 0.20  → parallel volumes adjacent
    siblings_adjacent          : share an edge, IoU ≤ 0.05
                                 → wings side-by-side
    ambiguous                  : everything else with non-zero IoU
    disjoint                   : IoU = 0  (filtered out, not returned)

Public API
----------
    relations = compute_pair_relations(candidates,
                                       short_side_px=…,
                                       config=RelationConfig())
    # → dict { (id_i, id_j) : {"type": str, "iou": float,
    #                          "contains_a_in_b": float,
    #                          "contains_b_in_a": float,
    #                          "ridge_angle_delta_deg": float,
    #                          "ridge_collinear": bool, …} }

Each candidate dict is expected to have at least:
    "id", "points" (4 [x,y]), "ridge_axis_px" (2 [x,y])
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple
import numpy as np
from shapely.geometry import Polygon


@dataclass
class RelationConfig:
    iou_duplicate:           float = 0.70
    iou_redundant:           float = 0.25   # v1.5: was 0.40, now catches
                                            # moderate-overlap variants too
    containment_child:       float = 0.85
    parallel_angle_tol_deg:  float = 15.0
    perp_angle_tol_deg:      float = 15.0
    collinear_perp_dist_frac: float = 0.05   # of short_side
    siblings_adjacent_edge_frac: float = 0.05  # gap < this × short_side
    siblings_adjacent_iou_max:   float = 0.05
    siblings_perp_iou_min:       float = 0.05
    siblings_perp_iou_max:       float = 0.50
    siblings_parallel_iou_max:   float = 0.20


# ===========================================================================
def compute_pair_relations(candidates: List[Dict],
                           short_side_px: float,
                           config: RelationConfig = RelationConfig()
                           ) -> Dict[Tuple[str, str], Dict]:
    """Compute classification for every overlapping/near pair."""
    out: Dict[Tuple[str, str], Dict] = {}
    n = len(candidates)
    polys = []
    for c in candidates:
        try:
            p = Polygon(c["points"])
            if not p.is_valid:
                p = p.buffer(0)
            polys.append(p)
        except Exception:
            polys.append(None)

    collinear_thresh = config.collinear_perp_dist_frac * short_side_px

    for i in range(n):
        if polys[i] is None or polys[i].area <= 0:
            continue
        for j in range(i + 1, n):
            if polys[j] is None or polys[j].area <= 0:
                continue
            inter = polys[i].intersection(polys[j])
            if inter.is_empty or inter.area <= 0:
                continue
            area_i = polys[i].area
            area_j = polys[j].area
            union = polys[i].union(polys[j]).area
            iou = inter.area / max(1e-9, union)
            cont_j_in_i = inter.area / area_j   # how much of j is inside i
            cont_i_in_j = inter.area / area_i   # how much of i is inside j

            # Ridge geometry
            ridge_i = np.asarray(candidates[i].get("ridge_axis_px", [[0,0],[1,0]]))
            ridge_j = np.asarray(candidates[j].get("ridge_axis_px", [[0,0],[1,0]]))
            ang_i = _ridge_angle_deg(ridge_i)
            ang_j = _ridge_angle_deg(ridge_j)
            d_ang = _angle_dist_mod180(ang_i - ang_j)
            d_ang_abs = abs(d_ang)
            parallel = d_ang_abs < config.parallel_angle_tol_deg
            perpendicular = (abs(d_ang_abs - 90.0)
                             < config.perp_angle_tol_deg)
            perp_dist = _perpendicular_distance_between_lines(
                ridge_i, ridge_j) if parallel else float("nan")
            collinear = (parallel
                         and not np.isnan(perp_dist)
                         and perp_dist < collinear_thresh)

            # Classification (priority order matters)
            rel_type = _classify(iou, cont_i_in_j, cont_j_in_i,
                                 parallel, perpendicular, collinear,
                                 config)

            id_i = candidates[i]["id"]
            id_j = candidates[j]["id"]
            out[(id_i, id_j)] = {
                "type":              rel_type,
                "iou":               float(iou),
                "contains_a_in_b":   float(cont_i_in_j),
                "contains_b_in_a":   float(cont_j_in_i),
                "ridge_angle_delta_deg": float(d_ang_abs),
                "ridge_parallel":    bool(parallel),
                "ridge_perpendicular": bool(perpendicular),
                "ridge_perp_distance_px": (float(perp_dist)
                                           if not np.isnan(perp_dist)
                                           else None),
                "ridge_collinear":   bool(collinear),
                # For convenience downstream
                "id_a": id_i, "id_b": id_j,
                "area_a": float(area_i), "area_b": float(area_j),
            }
    return out


# ===========================================================================
def _classify(iou: float, cont_a_in_b: float, cont_b_in_a: float,
              parallel: bool, perpendicular: bool, collinear: bool,
              cfg: RelationConfig) -> str:
    # 1. duplicate beats everything (same line, large overlap)
    if collinear and iou > cfg.iou_duplicate:
        return "duplicate"
    # 2. containment (dormer / inner)
    if max(cont_a_in_b, cont_b_in_a) >= cfg.containment_child:
        return "child_of"
    # 3. siblings perpendicular (T / L junctions, real structure)
    if perpendicular and cfg.siblings_perp_iou_min <= iou <= cfg.siblings_perp_iou_max:
        return "siblings_perpendicular"
    # 4. redundant variant: high overlap but NO perpendicular ridge between them
    #    (two attempts at the same volume)
    if iou >= cfg.iou_redundant and not perpendicular:
        return "redundant_variant"
    # 5. siblings parallel: non-collinear, low overlap
    if parallel and not collinear and iou <= cfg.siblings_parallel_iou_max:
        return "siblings_parallel"
    # 6. siblings adjacent: nearly disjoint
    if iou <= cfg.siblings_adjacent_iou_max:
        return "siblings_adjacent"
    return "ambiguous"


# ===========================================================================
def _ridge_angle_deg(ridge_2pts: np.ndarray) -> float:
    v = np.asarray(ridge_2pts[1]) - np.asarray(ridge_2pts[0])
    return float(np.rad2deg(np.arctan2(v[1], v[0])))


def _angle_dist_mod180(a: float) -> float:
    """Wrap to (-90, 90]."""
    return ((a + 90.0) % 180.0) - 90.0


def _perpendicular_distance_between_lines(line_a: np.ndarray,
                                          line_b: np.ndarray) -> float:
    """Average perpendicular distance from line_b endpoints to line_a (as a line)."""
    a0, a1 = np.asarray(line_a[0]), np.asarray(line_a[1])
    direction = a1 - a0
    n = float(np.linalg.norm(direction))
    if n < 1e-9:
        return float("nan")
    direction = direction / n
    normal = np.array([-direction[1], direction[0]])
    d0 = abs(float(np.dot(np.asarray(line_b[0]) - a0, normal)))
    d1 = abs(float(np.dot(np.asarray(line_b[1]) - a0, normal)))
    return 0.5 * (d0 + d1)
