"""detect_building_footprint.py
=================================
JAVCO v1.6.1 — Patch B : raffinement vision-based du prior bâtiment.

Mission
-------
Le `prior_polygon_px` envoyé au pipeline v1.6 est le polygone CADASTRAL
(building ou lot). Il est typiquement décalé de 20-30 px et inclut souvent
des zones non-bâtiment (parking, gazon, cour). Conséquence : `fit_roof_rectangle`
avec une grid de recherche ±4 px ne peut pas rattraper.

Cette fonction prend le prior cadastral comme HINT (région d'intérêt) et
détecte le footprint réel du bâtiment via segmentation couleur + morpho.
Le résultat est utilisé comme `prior_polygon_px` raffiné pour les passes
downstream.

Approche
--------
1. Élargir le hint cadastral de 30% (donner de la marge si le lot exclut une
   partie du bâtiment réel).
2. Masquer la ROI : on travaille SEULEMENT dans cette zone.
3. Segmentation couleur HSV : exclure les verts (végétation) et les bleus
   (eau, ciel). Garder tout ce qui ressemble à du toit (saturation modérée,
   value moyenne à haute).
4. Morphologie : ouverture pour éliminer le bruit, fermeture pour combler
   les trous (lucarnes, ombres, gravier).
5. Plus grosse composante connexe = bâtiment principal.
6. Contour externe + simplification Douglas-Peucker.
7. Sanity check : aire raisonnable vs hint (0.4x à 2.5x). Sinon fallback.

Fallback
--------
Si l'algorithme échoue (pas de composante, trop petite, trop grosse,
masque vide), on retourne le hint cadastral original — comportement
identique à v1.6 sans Patch B.

Config
------
`enabled=False` par défaut au niveau pipeline pour rollback trivial. Active
via `BuildingFootprintConfig(enabled=True)` dans `extract_roof_sections`.

Note : ce module n'ajoute AUCUN nouveau modèle ML, AUCUN download, AUCUNE
dépendance. Utilise uniquement opencv + shapely (déjà présents).
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Optional, Tuple
import numpy as np
import cv2
from shapely.geometry import Polygon


# ===========================================================================
# Configuration
# ===========================================================================
@dataclass
class BuildingFootprintConfig:
    """Tunables pour la détection vision-based."""
    enabled: bool = False           # Off par défaut → rollback safe sans flag
    expansion_pct: float = 0.30     # élargissement du hint cadastral

    # Segmentation HSV (espace OpenCV : H ∈ [0, 180], S/V ∈ [0, 255])
    grass_h_min: int = 35           # vert grass : H ∈ [35, 85], S élevée
    grass_h_max: int = 85
    grass_s_min: int = 60
    sky_h_min: int = 100            # bleu ciel/eau : H ∈ [100, 130], S élevée
    sky_h_max: int = 130
    sky_s_min: int = 80
    min_value: int = 30             # exclure pixels trop sombres (ombre dense)

    # Morphologie
    morph_kernel_px: int = 15
    morph_iterations: int = 1

    # Sanity check sur le contour détecté vs le hint
    area_ratio_min: float = 0.4
    area_ratio_max: float = 2.5

    # Simplification finale
    epsilon_arc_ratio: float = 0.005   # Douglas-Peucker — 0.005 * périmètre


# ===========================================================================
# API
# ===========================================================================
def detect_building_footprint(image_bgr: np.ndarray,
                              prior_polygon_px: List[List[float]],
                              config: BuildingFootprintConfig = BuildingFootprintConfig()
                              ) -> Tuple[List[List[float]], dict]:
    """Détecte le footprint du bâtiment depuis l'image satellite.

    Args:
        image_bgr        : H×W×3 uint8 BGR image (full resolution).
        prior_polygon_px : ≥3 vertices [[x, y], ...] en pixels image (hint
                           cadastral — lot ou bâtiment, peu importe).
        config           : tunables.

    Returns:
        (refined_polygon_px, diag) :
            refined_polygon_px : liste [[x, y], ...] du polygone raffiné.
                                 Si l'algo échoue, retourne `prior_polygon_px`
                                 tel quel (fallback safe).
            diag : dict avec metadata pour debug / logs :
                {
                  "used_vision": bool,
                  "fallback_reason": str | None,
                  "area_ratio": float,
                  "n_vertices_in": int,
                  "n_vertices_out": int,
                }
    """
    diag = {
        "used_vision": False,
        "fallback_reason": None,
        "area_ratio": None,
        "n_vertices_in": len(prior_polygon_px) if prior_polygon_px else 0,
        "n_vertices_out": 0,
    }

    if not config.enabled:
        diag["fallback_reason"] = "feature_disabled"
        return prior_polygon_px, diag

    if not prior_polygon_px or len(prior_polygon_px) < 3:
        diag["fallback_reason"] = "prior_too_few_vertices"
        return prior_polygon_px, diag

    H, W = image_bgr.shape[:2]
    hint = np.asarray(prior_polygon_px, dtype=np.float32)
    if hint.shape[1] != 2:
        diag["fallback_reason"] = "prior_bad_shape"
        return prior_polygon_px, diag

    # --- 1. ROI = hint élargi -------------------------------------------
    centroid = hint.mean(axis=0)
    expanded = centroid + (hint - centroid) * (1.0 + config.expansion_pct)
    expanded[:, 0] = np.clip(expanded[:, 0], 0, W - 1)
    expanded[:, 1] = np.clip(expanded[:, 1], 0, H - 1)
    expanded_i = expanded.astype(np.int32)
    roi_mask = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(roi_mask, [expanded_i], 255)

    # --- 2. Segmentation HSV --------------------------------------------
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    not_grass = ~((h >= config.grass_h_min) & (h <= config.grass_h_max)
                  & (s >= config.grass_s_min))
    not_sky = ~((h >= config.sky_h_min) & (h <= config.sky_h_max)
                & (s >= config.sky_s_min))
    has_value = v >= config.min_value
    roof_mask = (not_grass & not_sky & has_value
                 & (roi_mask > 0)).astype(np.uint8) * 255

    # --- 3. Morphologie -------------------------------------------------
    k = max(3, config.morph_kernel_px)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    roof_mask = cv2.morphologyEx(roof_mask, cv2.MORPH_OPEN, kernel,
                                 iterations=config.morph_iterations)
    roof_mask = cv2.morphologyEx(roof_mask, cv2.MORPH_CLOSE, kernel,
                                 iterations=config.morph_iterations)

    # --- 4. Plus grosse composante connexe -------------------------------
    n, labels, stats, _ = cv2.connectedComponentsWithStats(roof_mask)
    if n <= 1:
        diag["fallback_reason"] = "no_connected_component"
        return prior_polygon_px, diag
    # ignorer background (label 0), prendre la plus grande aire
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    building_mask = (labels == biggest).astype(np.uint8) * 255

    # --- 5. Contour externe ---------------------------------------------
    contours, _ = cv2.findContours(building_mask, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        diag["fallback_reason"] = "no_contour"
        return prior_polygon_px, diag
    cnt = max(contours, key=cv2.contourArea)

    # --- 6. Simplification ---------------------------------------------
    perimeter = cv2.arcLength(cnt, True)
    epsilon = config.epsilon_arc_ratio * perimeter
    approx = cv2.approxPolyDP(cnt, epsilon, True).reshape(-1, 2)

    if len(approx) < 3:
        diag["fallback_reason"] = "too_few_vertices_after_simplify"
        return prior_polygon_px, diag

    # --- 7. Sanity check sur l'aire -------------------------------------
    try:
        area_detected = Polygon(approx).area
        area_hint = Polygon(hint).area
        ratio = area_detected / max(area_hint, 1e-6)
        diag["area_ratio"] = float(ratio)
        if ratio < config.area_ratio_min or ratio > config.area_ratio_max:
            diag["fallback_reason"] = (
                f"area_ratio_out_of_range ({ratio:.2f} not in "
                f"[{config.area_ratio_min}, {config.area_ratio_max}])"
            )
            return prior_polygon_px, diag
    except Exception as e:
        diag["fallback_reason"] = f"sanity_check_failed: {e}"
        return prior_polygon_px, diag

    # --- 8. Succès -----------------------------------------------------
    refined = [[float(p[0]), float(p[1])] for p in approx]
    diag["used_vision"] = True
    diag["n_vertices_out"] = len(refined)
    return refined, diag


# ===========================================================================
# CLI helper (debug)
# ===========================================================================
if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 3:
        print("Usage: python detect_building_footprint.py image.jpg prior.json [--enabled]")
        sys.exit(0)
    img = cv2.imread(sys.argv[1])
    prior = json.load(open(sys.argv[2]))
    if isinstance(prior, dict):
        prior = prior.get("prior_polygon_px") or prior.get("building_polygon_px") or []
    enabled = "--enabled" in sys.argv
    config = BuildingFootprintConfig(enabled=enabled)
    refined, diag = detect_building_footprint(img, prior, config)
    print(f"Diagnostics: {json.dumps(diag, indent=2)}")
    print(f"Refined polygon ({len(refined)} vertices):")
    for p in refined:
        print(f"  [{p[0]:.1f}, {p[1]:.1f}]")
