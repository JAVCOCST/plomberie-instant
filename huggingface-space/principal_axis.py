"""
principal_axis.py
=================

Détecte l'axe principal d'un toit dans l'image satellite. C'est le SINGLE
SOURCE OF TRUTH dont découle toute la grille géométrique (étape 3 de
régularisation Manhattan world).

Pourquoi un SEUL axe et pas plusieurs : une ligne longue et bien détectée
est BEAUCOUP plus fiable qu'une moyenne d'arêtes courtes incertaines. On
choisit la direction dominante UNE fois, et toutes les autres arêtes
sont forcées sur la grille {axe, axe+45°, axe+90°, axe+135°}.

Stratégie en cascade (du plus fiable au moins fiable) :
  1. Hough lines probabilistic sur edges dans le polygone bâtiment
  2. Clustering des angles (modulo 90° puisqu'une arête horizontale ≡ verticale
     en termes de grille rectangulaire)
  3. Si pas assez de lignes confiantes → fallback sur l'axe principal du
     polygone bâtiment (calculé via PCA des vertices)
  4. Si TOUT échoue → angle 0° (axe-aligné image) — log un warning

L'axe retourné est en RADIANS, dans [0, π/2). Une rotation de π/2 donne la
même grille rectangulaire donc on normalise dans ce demi-intervalle.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np

log = logging.getLogger("principal-axis")


# ──────────────────────────────────────────────────────────────────────────────
# Tuning constants — calibrés pour images Google Static Maps 1280×1280 z=20-21
# ──────────────────────────────────────────────────────────────────────────────
HOUGH_THRESHOLD = 60               # ↓ détecte plus de lignes, ↑ plus strict
HOUGH_MIN_LINE_LENGTH = 40         # px — sous ce seuil on ignore (bruit)
HOUGH_MAX_LINE_GAP = 8             # px — tolérance de break dans une ligne continue
CANNY_LOW = 50
CANNY_HIGH = 150
EDGE_BLUR_KSIZE = 3
ANGLE_CLUSTER_TOLERANCE_DEG = 5.0  # ±5° → même cluster
MIN_TOTAL_LENGTH_FOR_CONFIDENCE = 80.0  # px — sous ce seuil on tombe en fallback
BUILDING_MASK_EXPAND_FRAC = 0.10   # élargit le mask de 10% pour catcher les eaves


@dataclass
class AxisDetection:
    """Résultat de la détection. Toujours retourné — `source` indique d'où ça vient."""
    angle_rad: float                # ∈ [0, π/2)
    source: str                     # 'hough' | 'building_pca' | 'fallback'
    confidence: float               # 0..1 — total_length / image_diag pour 'hough'
    n_lines_used: int               # nombre de lignes Hough dans le cluster gagnant


def _angle_normalize_pi_2(rad: float) -> float:
    """Ramène un angle dans [0, π/2). 0° et 90° sont équivalents pour une grille
    rectangulaire (rotation π/2 → même grille), donc on modulo π/2."""
    a = rad % math.pi
    if a >= math.pi / 2:
        a -= math.pi / 2
    return a


def _polygon_to_mask(polygon_px: List[List[float]], h: int, w: int,
                     expand_frac: float = 0.0) -> np.ndarray:
    """Polygone pixel → mask binaire uint8 (255 = inside, 0 = outside)."""
    mask = np.zeros((h, w), dtype=np.uint8)
    pts = np.asarray(polygon_px, dtype=np.float32)
    if expand_frac > 0:
        center = pts.mean(axis=0)
        pts = center + (pts - center) * (1.0 + expand_frac)
    cv2.fillPoly(mask, [pts.astype(np.int32)], 255)
    return mask


def _building_pca_axis(polygon_px: List[List[float]]) -> float:
    """Axe principal du polygone via PCA sur ses vertices. Fallback robuste
    quand Hough ne détecte rien d'utilisable."""
    pts = np.asarray(polygon_px, dtype=np.float32)
    centered = pts - pts.mean(axis=0)
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    # Vecteur propre associé à la plus grande variance
    principal = eigvecs[:, np.argmax(eigvals)]
    angle = math.atan2(principal[1], principal[0])
    return _angle_normalize_pi_2(angle)


def _hough_lines(image_bgr: np.ndarray,
                 mask: np.ndarray) -> Optional[np.ndarray]:
    """Détecte les lignes droites dans la zone masquée. Retourne (N, 1, 4) ou None."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (EDGE_BLUR_KSIZE, EDGE_BLUR_KSIZE), 0)
    edges = cv2.Canny(blurred, CANNY_LOW, CANNY_HIGH)
    edges_masked = cv2.bitwise_and(edges, edges, mask=mask)
    lines = cv2.HoughLinesP(
        edges_masked,
        rho=1,
        theta=np.pi / 180,
        threshold=HOUGH_THRESHOLD,
        minLineLength=HOUGH_MIN_LINE_LENGTH,
        maxLineGap=HOUGH_MAX_LINE_GAP,
    )
    return lines


def _line_angle_and_length(line: np.ndarray) -> Tuple[float, float]:
    """(x1, y1, x2, y2) → (angle_normalisé [0,π/2), longueur)."""
    x1, y1, x2, y2 = line.flatten()
    dx, dy = (x2 - x1), (y2 - y1)
    length = math.hypot(dx, dy)
    angle = math.atan2(dy, dx)
    return _angle_normalize_pi_2(angle), length


def _cluster_dominant_angle(lines: np.ndarray) -> Tuple[float, float, int]:
    """
    Cluster les lignes par angle (tolerance ±5°), retourne le cluster gagnant
    en longueur totale.

    Returns: (angle_rad, total_length, n_lines_in_winning_cluster)
    """
    if lines is None or len(lines) == 0:
        return 0.0, 0.0, 0

    tol = math.radians(ANGLE_CLUSTER_TOLERANCE_DEG)
    half_pi = math.pi / 2

    # Calc (angle, length) pour chaque ligne
    entries = [_line_angle_and_length(ln) for ln in lines]

    # Clustering simple : pour chaque angle candidat (discrétisation à 1°), on
    # somme la longueur des lignes dont l'angle est dans [candidate ± tol] (en
    # tenant compte de la circularité [0, π/2)).
    best_total = 0.0
    best_angle = 0.0
    best_count = 0
    for deg in range(0, 90):  # candidats tous les 1°
        candidate = math.radians(deg)
        total = 0.0
        count = 0
        for ang, length in entries:
            # Distance circulaire dans [0, π/2)
            d = abs(ang - candidate)
            d = min(d, half_pi - d)
            if d <= tol:
                total += length
                count += 1
        if total > best_total:
            best_total = total
            best_angle = candidate
            best_count = count

    return best_angle, best_total, best_count


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────
def detect_principal_axis(
    image_bgr: np.ndarray,
    building_polygon_px: List[List[float]],
) -> AxisDetection:
    """
    Détecte l'axe principal du toit. Cascade : Hough → PCA building → fallback 0°.

    Args:
        image_bgr : image satellite (cv2 BGR uint8 HWC)
        building_polygon_px : footprint bâtiment en pixels image (≥3 vertices)

    Returns:
        AxisDetection avec source ∈ {'hough', 'building_pca', 'fallback'}.
        Jamais None — on garantit toujours UN axe à utiliser en aval.
    """
    h, w = image_bgr.shape[:2]
    image_diag = math.hypot(h, w)

    # Validation polygon
    if not building_polygon_px or len(building_polygon_px) < 3:
        log.warning("building_polygon invalid — fallback to 0° axis")
        return AxisDetection(0.0, "fallback", 0.0, 0)

    # Étape 1 — Hough sur edges dans la zone building (élargie)
    mask = _polygon_to_mask(building_polygon_px, h, w, BUILDING_MASK_EXPAND_FRAC)
    lines = _hough_lines(image_bgr, mask)
    angle, total_length, n_lines = _cluster_dominant_angle(lines)

    if total_length >= MIN_TOTAL_LENGTH_FOR_CONFIDENCE:
        # On a un cluster Hough fiable — c'est le best case
        confidence = min(1.0, total_length / image_diag)
        log.info(
            "axis hough: %.1f° (n_lines=%d, total_len=%.0f px, conf=%.2f)",
            math.degrees(angle), n_lines, total_length, confidence,
        )
        return AxisDetection(angle, "hough", confidence, n_lines)

    # Étape 2 — Fallback PCA building polygon
    try:
        pca_angle = _building_pca_axis(building_polygon_px)
        log.info(
            "axis PCA building: %.1f° (Hough insufficient: total_len=%.0f < %.0f)",
            math.degrees(pca_angle), total_length, MIN_TOTAL_LENGTH_FOR_CONFIDENCE,
        )
        # Confidence moyenne — PCA marche bien sur des bâtiments rectangulaires
        # mais peut être trompeur sur des L-shapes / cross
        return AxisDetection(pca_angle, "building_pca", 0.5, 0)
    except Exception as exc:  # noqa: BLE001
        log.warning("PCA building axis failed (%s) — final fallback 0°", exc)
        return AxisDetection(0.0, "fallback", 0.0, 0)
