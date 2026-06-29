"""
geometric_regularization.py
===========================

Étape 3 du pipeline : régularisation Manhattan world bootstrappée sur l'axe
principal détecté (cf. principal_axis.py).

Principe (raffinement v2) :
  On NE FIT PAS un rectangle englobant à chaque section — ça détruirait la
  géométrie trapézoïdale des hip facets (la pente devient un rectangle plat).
  À la place, on snap CHAQUE ARÊTE individuellement sur la grille
    G = {axe, axe+45°, axe+90°, axe+135°}
  puis on RE-INTERSECTE les arêtes adjacentes pour calculer les nouveaux
  coins. Le polygone garde sa topologie (nb de vertices, ordre) mais chaque
  côté est géométriquement parfait par rapport à l'axe principal du bâtiment.

Concrètement, pour un trapèze hip standard :
  - Top (faîtière) : snap → exactement parallèle à l'axe
  - Bottom (avant-toit) : snap → exactement parallèle à l'axe (donc parallèle
    à la faîtière)
  - Left (hip line) : snap → exactement à axe+45° (ou axe+135°)
  - Right (hip line) : snap → idem
  → résultat : trapèze parfaitement géométrique, pas un rectangle

Cas spéciaux :
  - 'tower' : préserve l'octogone régulier inscrit (les 8 côtés ne snap pas
    proprement sur 4 directions, ça donne des arêtes dégénérées). On extrait
    l'OBB englobant, on snap son angle, on regénère l'octogone régulier.
  - Polygones < 3 vertices : on les laisse passer tels quels (no-op).
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

log = logging.getLogger("geom-regul")


# ──────────────────────────────────────────────────────────────────────────────
# Snapping atomique : angle libre → grille à 4 directions
# ──────────────────────────────────────────────────────────────────────────────
def _snap_angle_to_grid(angle_rad: float, principal_axis_rad: float) -> float:
    """
    Snap un angle à la direction de G = {axis, axis+45°, axis+90°, axis+135°}
    la plus proche. Modulo π puisqu'une arête à θ ≡ θ+π.
    """
    pi = math.pi
    a = angle_rad % pi
    base = principal_axis_rad % pi
    candidates = [(base + k * pi / 4) % pi for k in range(4)]

    def circular_diff(x: float, y: float) -> float:
        d = abs(x - y) % pi
        return min(d, pi - d)

    return min(candidates, key=lambda c: circular_diff(a, c))


# ──────────────────────────────────────────────────────────────────────────────
# Représentation d'une arête comme ligne implicite Ax + By = C
# ──────────────────────────────────────────────────────────────────────────────
def _line_from_point_and_angle(
    px: float, py: float, angle_rad: float
) -> Tuple[float, float, float]:
    """
    Ligne passant par (px, py) avec direction d'angle `angle_rad`.
    Forme implicite Ax + By = C avec normale unitaire (A, B) = (-sin θ, cos θ).
    """
    A = -math.sin(angle_rad)
    B = math.cos(angle_rad)
    C = A * px + B * py
    return A, B, C


def _intersect_lines(
    L1: Tuple[float, float, float], L2: Tuple[float, float, float]
) -> Optional[Tuple[float, float]]:
    """
    Intersection (x, y) de deux lignes L1, L2 en forme A x + B y = C.
    Retourne None si parallèles (det ≈ 0).
    """
    A1, B1, C1 = L1
    A2, B2, C2 = L2
    det = A1 * B2 - B1 * A2
    if abs(det) < 1e-9:
        return None
    x = (C1 * B2 - B1 * C2) / det
    y = (A1 * C2 - C1 * A2) / det
    return x, y


# ──────────────────────────────────────────────────────────────────────────────
# Cœur : snap edges + re-intersect (préserve la topologie du polygone)
# ──────────────────────────────────────────────────────────────────────────────
def _snap_edges_and_reintersect(
    pts: List[List[float]],
    principal_axis_rad: float,
) -> Tuple[List[List[float]], float]:
    """
    Pour CHAQUE arête du polygone :
      1. Calcul l'angle actuel de l'arête
      2. Snap à G = {axis, axis+45°, axis+90°, axis+135°}
      3. Représente comme ligne implicite passant par le MIDPOINT de l'arête
         (préserve la position de l'arête, change uniquement son orientation)

    Pour CHAQUE vertex (i.e. intersection des arêtes adjacentes) :
      1. Intersection des 2 lignes snappées qui le bordent
      2. C'est le nouveau vertex

    Si une intersection est parallèle (ne devrait pas arriver vu qu'on a 4
    directions distinctes), on retombe sur le vertex original — fallback safe.

    Retourne (new_pts, max_snap_delta_deg).
    """
    n = len(pts)
    if n < 3:
        return list(pts), 0.0

    # Étape 1 — pour chaque arête, snap son angle + ligne implicite à son midpoint
    snapped_lines: List[Tuple[float, float, float]] = []
    max_delta_deg = 0.0
    for i in range(n):
        ax, ay = pts[i][0], pts[i][1]
        bx, by = pts[(i + 1) % n][0], pts[(i + 1) % n][1]
        mid_x = (ax + bx) / 2.0
        mid_y = (ay + by) / 2.0
        cur_angle = math.atan2(by - ay, bx - ax)
        snapped = _snap_angle_to_grid(cur_angle, principal_axis_rad)
        snapped_lines.append(_line_from_point_and_angle(mid_x, mid_y, snapped))

        # Track le delta (pour metadata / audit)
        a_norm = cur_angle % math.pi
        d = abs(a_norm - snapped) % math.pi
        d = min(d, math.pi - d)
        deg = math.degrees(d)
        if deg > max_delta_deg:
            max_delta_deg = deg

    # Étape 2 — pour chaque vertex i, intersect snapped_lines[i-1] (arête
    # arrivante) avec snapped_lines[i] (arête sortante)
    new_pts: List[List[float]] = []
    for i in range(n):
        L_in = snapped_lines[(i - 1) % n]
        L_out = snapped_lines[i]
        inter = _intersect_lines(L_in, L_out)
        if inter is None:
            # Arêtes adjacentes parallèles (= dégénéré, ne devrait pas arriver
            # car G a 4 directions distinctes et adj_angle ≠ même direction
            # sauf cas dégénéré du polygone source). Fallback : vertex original.
            new_pts.append([float(pts[i][0]), float(pts[i][1])])
        else:
            new_pts.append([float(inter[0]), float(inter[1])])

    return new_pts, max_delta_deg


# ──────────────────────────────────────────────────────────────────────────────
# Tower : cas spécial (octogone régulier inscrit)
# ──────────────────────────────────────────────────────────────────────────────
def _tower_regularize(
    pts: List[List[float]], principal_axis_rad: float
) -> Tuple[List[List[float]], float]:
    """
    Pour 'tower' (8 vertices octogonal), per-edge snap dégénérerait (les
    arêtes diagonales naturelles à 22.5° / 67.5° ne sont pas sur la grille).
    À la place :
      1. Fit OBB englobant via minAreaRect
      2. Snap l'angle de l'OBB à la grille
      3. Re-génère un octogone régulier inscrit dans cet OBB
    """
    arr = np.asarray(pts, dtype=np.float32).reshape(-1, 1, 2)
    (cx, cy), (w, h), deg = cv2.minAreaRect(arr)
    if w < h:
        w, h = h, w
        deg += 90.0
    original_rad = math.radians(deg)
    snapped_rad = _snap_angle_to_grid(original_rad, principal_axis_rad)

    cos_a = math.cos(snapped_rad)
    sin_a = math.sin(snapped_rad)
    r = min(w, h) / 2.0
    pts_out: List[List[float]] = []
    for k in range(8):
        theta = (2 * math.pi * k / 8) + math.pi / 8  # offset π/8 → arêtes propres
        lx = r * math.cos(theta)
        ly = r * math.sin(theta)
        x = cx + lx * cos_a - ly * sin_a
        y = cy + lx * sin_a + ly * cos_a
        pts_out.append([float(x), float(y)])

    delta_deg = math.degrees(abs((original_rad - snapped_rad) % math.pi))
    delta_deg = min(delta_deg, 180.0 - delta_deg)
    return pts_out, delta_deg


# ──────────────────────────────────────────────────────────────────────────────
# Public API — préserve la topologie de chaque section
# ──────────────────────────────────────────────────────────────────────────────
def regularize_sections(
    sections: List[Dict[str, Any]],
    principal_axis_rad: float,
) -> List[Dict[str, Any]]:
    """
    Régularise chaque section :
      - 'tower' → octogone régulier inscrit dans OBB snappé
      - tout le reste (hip, gable, shed, flat) → per-edge snap + re-intersect
        qui PRÉSERVE la topologie (nb de vertices, ordre) tout en forçant la
        géométrie sur la grille Manhattan de l'axe principal.

    Les sections sont retournées dans une nouvelle liste — inputs non modifiés.
    Le champ 'metadata' reçoit 'regularized: true' + 'snap_delta_deg' pour audit.
    """
    out: List[Dict[str, Any]] = []
    for s in sections:
        pts_key = "points" if "points" in s else "pts"
        pts_raw = s.get(pts_key)
        if not pts_raw or len(pts_raw) < 3:
            out.append(dict(s))
            continue

        # pts_raw peut être [{x,y}, ...] ou [[x,y], ...]
        if isinstance(pts_raw[0], dict):
            pts_list = [[float(p["x"]), float(p["y"])] for p in pts_raw]
            pts_format = "dict"
        else:
            pts_list = [[float(p[0]), float(p[1])] for p in pts_raw]
            pts_format = "tuple"

        roof_type = str(s.get("roof_type", "hip")).lower()

        if roof_type == "tower" and len(pts_list) >= 6:
            new_pts, delta_deg = _tower_regularize(pts_list, principal_axis_rad)
        else:
            new_pts, delta_deg = _snap_edges_and_reintersect(pts_list, principal_axis_rad)

        # Reformatte au même format que l'input (dict ou tuple)
        if pts_format == "dict":
            new_pts_formatted = [{"x": p[0], "y": p[1]} for p in new_pts]
        else:
            new_pts_formatted = new_pts

        new_section = dict(s)
        new_section[pts_key] = new_pts_formatted

        meta = dict(new_section.get("metadata") or {})
        meta["regularized"] = True
        meta["snap_max_delta_deg"] = round(delta_deg, 2)
        meta["principal_axis_deg"] = round(math.degrees(principal_axis_rad), 2)
        new_section["metadata"] = meta

        out.append(new_section)

    log.info(
        "regularized %d sections (principal_axis=%.1f°)",
        len(out), math.degrees(principal_axis_rad),
    )
    return out


def apply_regularization_to_result(
    result: Dict[str, Any],
    image_bgr: np.ndarray,
    building_polygon_px: List[List[float]],
) -> Dict[str, Any]:
    """
    Wrapper end-to-end : prend l'output v1.6 (ou ml_v1) + l'image + le polygone
    bâtiment, détecte l'axe principal, régularise chaque section avec per-edge
    snap + re-intersect, retourne le résultat enrichi.

    Compatible drop-in : ne casse pas le schema v1.6.
    """
    # Import local pour éviter circular si principal_axis grossit
    from principal_axis import detect_principal_axis

    sections = result.get("sections", [])
    if not sections:
        return result

    detection = detect_principal_axis(image_bgr, building_polygon_px)
    new_sections = regularize_sections(sections, detection.angle_rad)

    new_result = dict(result)
    new_result["sections"] = new_sections
    metadata = dict(new_result.get("metadata") or {})
    metadata["regularization"] = {
        "applied": True,
        "principal_axis_deg": round(math.degrees(detection.angle_rad), 2),
        "axis_source": detection.source,
        "axis_confidence": round(detection.confidence, 3),
        "n_lines_used": detection.n_lines_used,
    }
    new_result["metadata"] = metadata
    return new_result
