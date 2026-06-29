"""structural_scoring.py
==========================
Score a candidate structural rectangle by structural signals ONLY.

Explicitly does NOT use:
  - IoU vs roof mask
  - new-contribution vs already-selected rects
  - overlap penalty vs main envelope

Inputs
------
    rect_dict   : dict from rectangle_from_ridge (has "points", "ridge",
                  "axis", "gutter_support", …)
    image_bgr   : original image (BGR uint8)
    axes        : global axes dict
    main_rect   : 4-corner main envelope (for size plausibility only)
    all_ridges  : full list of detected ridges (for distinct_ridge_score)
    grad        : (optional, cached) normalized gradient magnitude

Components
----------
  ridge_strength       : mean grad along the ridge line (already on
                         the ridge dict — copied here for the bundle)
  gutter_edge_support  : 'edge' method ⇒ 1.0, 'fallback' ⇒ 0.4
                         (continuous version: med-grad on the two long sides)
  axis_alignment       : cos² of the angle gap to the closest global axis
  symmetry_score       : 1 - |side_a - side_b| / (side_a + side_b)
                         → 1.0 if the rect is centered on the ridge
  size_plausibility    : 1.0 in [low, high]; linear falloff outside
  distinct_ridge_score : minimum perpendicular distance to any other
                         RETAINED ridge, normalized
                         → low ⇒ duplicate, high ⇒ distinct

Total
-----
    total = Σ wᵢ · componentᵢ     (weights configurable, default sum = 1)
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional
import numpy as np
import cv2


@dataclass
class StructConfig:
    w_ridge_strength:      float = 0.25     # (was 0.30, ↓ to make room)
    w_gutter_edge_support: float = 0.20     # (was 0.25, ↓)
    w_axis_alignment:      float = 0.10
    w_symmetry:            float = 0.10     # (was 0.15, ↓)
    w_size_plausibility:   float = 0.10
    w_distinct_ridge:      float = 0.10
    w_ridge_internality:   float = 0.15     # v1.2 — anti-gutter weight

    gutter_thickness_px:   int   = 3
    # v1.6.2 (2026-06-05) : bumped 0.10 → 0.15 d'après l'audit failure-mode
    # sur 14 datasets (avg sections_removed=8.5/dataset). Les rectangles sous
    # 15% de la taille du toit principal sont quasi-toujours du bruit
    # (gouttières, ombres, débris) qui contaminent l'output et alourdit la
    # correction humaine. Trade-off : on risque de manquer ~1 vrai sous-volume
    # très petit par batch, vs. couper ~3 faux positifs/dataset.
    min_size_frac_of_main: float = 0.15
    max_size_frac_of_main: float = 1.20
    distinct_perp_norm_px: float = 40.0

    # Selection
    # v1.6.2 (2026-06-05) : remonté 0.44 → 0.50.
    # Historique : v1.6.0 = 0.45, v1.6.1 = 0.44 (audit "training-bundle-
    # 1780270201323" sur 15 datasets → +3 TPs de bord, -15 FPs supposés
    # non-bruit). MAIS l'audit failure-mode v1.6.2 sur 14 datasets corrigés
    # montre avg sections_removed=8.5/dataset (humains suppriment massivement
    # l'output IA), avg correction_weight=0.628 (63% du travail refait).
    # Le passage 0.45→0.44 a apporté seulement +1 TP/dataset au coût de ~1
    # FP/dataset persistant. À 0.50 on retire ces FPs marginaux sans perdre
    # les TPs majeurs (qui scorent >0.55 typiquement).
    min_total_score:       float = 0.50
    nms_perp_threshold_px: float = 20.0

    # v1.2 anti-gutter — v1.3 disabled hard gate (Option B: continuous score)
    gutter_roof_frac_threshold: float = 0.50   # used only for diagnostic flag
    auto_reject_gutters:        bool  = False  # v1.3: NOT a hard gate anymore
                                               # — internality flows through
                                               # the score component instead


def score_structural(rect_dict: Dict, image_bgr: np.ndarray, axes: Dict,
                     main_rect: List[List[float]],
                     all_ridges: List[Dict],
                     grad: Optional[np.ndarray] = None,
                     config: StructConfig = StructConfig(),
                     ridge_internality: Optional[float] = None) -> Dict:
    """Compute structural score components for one rectangle.

    `ridge_internality` (v1.2): optional pre-computed value in [0,1] from
    `ridge_internality_score`. If None, the term is treated as neutral 1.0
    (no anti-gutter penalty applied).
    """
    H, W = image_bgr.shape[:2]
    if grad is None:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        grad = np.sqrt(gx * gx + gy * gy)
        m = float(grad.max())
        if m > 0: grad = grad / m

    pts = np.asarray(rect_dict["points"], dtype=np.float64)
    ridge_p1 = np.asarray(rect_dict["ridge"][0], dtype=np.float64)
    ridge_p2 = np.asarray(rect_dict["ridge"][1], dtype=np.float64)

    # --- ridge_strength ----------------------------------------------
    ridge_strength = _line_strength(grad, ridge_p1, ridge_p2, 3)

    # --- gutter_edge_support ----------------------------------------
    method = rect_dict["gutter_support"]["method"]
    side_a = rect_dict["gutter_support"]["side_a_px"]
    side_b = rect_dict["gutter_support"]["side_b_px"]
    if method == "edge":
        gutter_score = 1.0
    else:
        gutter_score = 0.4   # fallback: no real edge evidence
    # Additional: measure gradient strength along the two long sides
    long_sides = _long_sides(pts)
    grad_a = _line_strength(grad, long_sides[0][0], long_sides[0][1],
                            config.gutter_thickness_px)
    grad_b = _line_strength(grad, long_sides[1][0], long_sides[1][1],
                            config.gutter_thickness_px)
    side_grad = 0.5 * (grad_a + grad_b)
    gutter_score = 0.5 * gutter_score + 0.5 * min(1.0, side_grad * 4.0)

    # --- axis_alignment ---------------------------------------------
    ridge_vec = ridge_p2 - ridge_p1
    ang = float(np.rad2deg(np.arctan2(ridge_vec[1], ridge_vec[0])))
    ax = (axes["primary_axis_deg"] if rect_dict["axis"] == "primary"
          else axes["secondary_axis_deg"])
    d = _angle_dist_mod180(ang - ax)
    axis_alignment = float(np.cos(np.deg2rad(d)) ** 2)

    # --- symmetry ---------------------------------------------------
    if side_a + side_b > 0:
        symmetry = 1.0 - abs(side_a - side_b) / (side_a + side_b)
    else:
        symmetry = 0.0

    # --- size_plausibility ------------------------------------------
    main_area = _polygon_area(np.asarray(main_rect, dtype=np.float64))
    rect_area = _polygon_area(pts)
    af = rect_area / max(1.0, main_area)
    lo, hi = config.min_size_frac_of_main, config.max_size_frac_of_main
    if lo <= af <= hi:
        size_score = 1.0
    elif af < lo:
        size_score = max(0.0, af / lo)
    else:
        size_score = max(0.0, 1.0 - (af - hi) / 0.5)

    # --- distinct_ridge ---------------------------------------------
    # Minimum perpendicular distance to any OTHER ridge along the same axis
    min_perp = float("inf")
    this_perp = _ridge_perp_offset(ridge_p1, ridge_p2, axes,
                                   rect_dict["axis"])
    for r in all_ridges:
        if r["p1"] == rect_dict["ridge"][0] and r["p2"] == rect_dict["ridge"][1]:
            continue
        if r["axis"] != rect_dict["axis"]:
            continue
        r_perp = _ridge_perp_offset(np.asarray(r["p1"]),
                                    np.asarray(r["p2"]),
                                    axes, r["axis"])
        d = abs(r_perp - this_perp)
        if d < min_perp:
            min_perp = d
    if min_perp == float("inf"):
        distinct = 1.0
    else:
        distinct = min(1.0, min_perp / config.distinct_perp_norm_px)

    internality_term = (1.0 if ridge_internality is None
                        else float(ridge_internality))
    total = (config.w_ridge_strength      * ridge_strength
           + config.w_gutter_edge_support * gutter_score
           + config.w_axis_alignment      * axis_alignment
           + config.w_symmetry            * symmetry
           + config.w_size_plausibility   * size_score
           + config.w_distinct_ridge      * distinct
           + config.w_ridge_internality   * internality_term)

    return {
        "ridge_strength":      float(ridge_strength),
        "gutter_edge_support": float(gutter_score),
        "axis_alignment":      float(axis_alignment),
        "symmetry":            float(symmetry),
        "size_plausibility":   float(size_score),
        "distinct_ridge":      float(distinct),
        "ridge_internality":   float(internality_term),
        "total":               float(total),
    }


def select_sections(ranked: List[Dict], config: StructConfig
                    ) -> List[Dict]:
    """NMS on similar ridges only — never on rectangle IoU.

    `ranked` must be sorted by score descending, each item has
    keys: 'rect', 'score' (dict including 'total'), 'ridge', 'axis'.
    """
    kept: List[Dict] = []
    for item in ranked:
        if item["score"]["total"] < config.min_total_score:
            continue
        # NMS by ridge: reject if there's a kept ridge on the same axis with
        # |perp_dist| < nms_perp_threshold_px
        too_close = False
        for k in kept:
            if k["axis"] != item["axis"]:
                continue
            d = abs(k["_perp"] - item["_perp"])
            if d < config.nms_perp_threshold_px:
                too_close = True
                break
        if not too_close:
            kept.append(item)
    return kept


# ============================================================================
# v1.2 — Enriched NMS with selection / rejection reasons
# ============================================================================
def select_sections_with_reasons(ranked: List[Dict], config: StructConfig
                                 ) -> List[Dict]:
    """Activate select_sections() conservatively, ALWAYS on ridge_candidates
    only — the main S1 is handled separately by the caller and is never
    passed to this function.

    For every input item this returns a copy with two additional keys:
        kept                : bool
        selection_reason    : str|None    (filled when kept=True)
        rejection_reason    : str|None    (filled when kept=False)

    Inputs must already include `_perp` (ridge perpendicular offset) and an
    `axis` field. Items are processed in the order they are given — caller
    should sort by score descending first.

    The function NEVER mutates the input items.
    """
    out: List[Dict] = []
    for item in ranked:
        entry: Dict = {
            **item,
            "kept": False,
            "selection_reason": None,
            "rejection_reason": None,
        }
        score = item.get("score", {}).get("total", 0.0)

        # Gate 1 — structural threshold
        if score < config.min_total_score:
            entry["rejection_reason"] = (
                f"structural_score {score:.2f} < "
                f"min_total_score {config.min_total_score:.2f}"
            )
            out.append(entry)
            continue

        # Gate 2 — NMS on similar ridges (same axis + close perp offset)
        # Only the kept ones (entries already accepted) count.
        nms_collision = None
        for k in out:
            if not k["kept"]:
                continue
            if k.get("axis") != item.get("axis"):
                continue
            d_perp = abs(k.get("_perp", 0.0) - item.get("_perp", 0.0))
            if d_perp < config.nms_perp_threshold_px:
                nms_collision = (k, d_perp)
                break
        if nms_collision is not None:
            k, d = nms_collision
            entry["rejection_reason"] = (
                f"NMS: too close to "
                f"{k.get('ridge_id', '?')} on axis "
                f"{item.get('axis')} ({d:.0f}px < "
                f"{config.nms_perp_threshold_px:.0f}px)"
            )
            out.append(entry)
            continue

        # Passed everything
        entry["kept"] = True
        entry["selection_reason"] = (
            f"passed structural ({score:.2f}≥{config.min_total_score:.2f}) "
            f"and NMS gates"
        )
        out.append(entry)
    return out


# ===========================================================================
# Internals
# ===========================================================================
def _line_strength(grad: np.ndarray, p1, p2, thickness: int) -> float:
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


def _long_sides(pts: np.ndarray) -> List[tuple]:
    """Return the two longest sides as [(p1, p2), (p3, p4)]."""
    sides = []
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        sides.append((float(np.linalg.norm(b - a)), a, b))
    sides.sort(key=lambda s: -s[0])
    return [(sides[0][1], sides[0][2]),
            (sides[1][1], sides[1][2])]


def _polygon_area(pts: np.ndarray) -> float:
    x = pts[:, 0]; y = pts[:, 1]
    return 0.5 * float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def _angle_dist_mod180(a: float) -> float:
    return ((a + 90.0) % 180.0) - 90.0


def _ridge_perp_offset(p1, p2, axes: Dict, axis_name: str) -> float:
    """Signed perpendicular distance from axes center to the ridge line."""
    c = np.asarray(axes["center_px"], dtype=np.float64)
    if axis_name == "primary":
        perp_dir = np.asarray(axes["secondary_unit_vec"], dtype=np.float64)
    else:
        perp_dir = np.asarray(axes["primary_unit_vec"], dtype=np.float64)
    mid = (np.asarray(p1) + np.asarray(p2)) * 0.5 - c
    return float(np.dot(mid, perp_dir))
