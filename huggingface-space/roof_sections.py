"""roof_sections.py
======================
Top-level orchestrator. v1.2 — activates conservative NMS on candidates,
adds anti-gutter scoring, fills selection/rejection reasons.

Output JSON (v1.2 extras marked ★):
  S1 main:
      semantic_order_valid, ridge_axis_px,
      ridge_visible_score, plane_symmetry_score,
      experimental = False,
      ★ ridge_internality_score   (computed for diagnostics)
      ★ rejected_as_gutter        (always False on main — main is never rejected)

  R1, R2... ridge_candidate (experimental=True always):
      semantic_order_valid, ridge_axis_px, source_ridge,
      ridge_visible_score, plane_symmetry_score, structural_score,
      ★ ridge_internality_score
      ★ rejected_as_gutter        (True if bilateral_roof < threshold)
      ★ selection_reason          (filled when kept, else None)
      ★ rejection_reason          (filled when rejected, else None)
      ★ kept_by_nms               (bool)
      would_have_been_selected    (legacy field, kept for compat)
"""
from __future__ import annotations
from typing import Dict, List, Optional
import cv2
import numpy as np

from fit_roof_rectangle import fit_roof_rectangle
from detect_building_footprint import (detect_building_footprint,
                                       BuildingFootprintConfig)
from global_axes import compute_global_axes
from ridge_hypotheses import detect_ridges, RidgeConfig
from rectangle_from_ridge import rectangle_from_ridge, RectFromRidgeConfig
from structural_scoring import (score_structural,
                                select_sections_with_reasons,
                                StructConfig, _ridge_perp_offset)
from semantic_order import (ensure_semantic_point_order,
                            compute_ridge_axis)
from scoring_extra import (ridge_visible_score,
                           roof_plane_symmetry_score,
                           ridge_internality_score)
from relational_graph import (compute_pair_relations,
                              RelationConfig)
from structural_selection import (select_structural,
                                  detect_typology,
                                  SelectionConfig)


def extract_roof_sections(image_bgr: np.ndarray,
                          roof_type: str = "4_pans",
                          prior_polygon_px: Optional[List[List[float]]] = None,
                          default_pitch_deg: float = 7.0,
                          ridge_config: RidgeConfig = RidgeConfig(),
                          rect_config: RectFromRidgeConfig = RectFromRidgeConfig(),
                          struct_config: StructConfig = StructConfig(),
                          relation_config: RelationConfig = RelationConfig(),
                          selection_config: Optional[SelectionConfig] = None,
                          footprint_config: Optional[BuildingFootprintConfig] = None,
                          ) -> Dict:
    """Run the full ridge-driven sections pipeline (v1.5 / v1.6.1)."""

    # ---- 0. Patch B (v1.6.1) — raffinement vision-based du prior -------
    # Le prior cadastral (lot ou building_geojson) est typiquement décalé
    # de 20-30 px et inclut souvent du non-bâtiment. detect_building_footprint
    # corrige ça via segmentation couleur + morpho avant que fit_roof_rectangle
    # tente son fit fin (±4 px). OFF par défaut → rollback safe.
    if footprint_config is None:
        footprint_config = BuildingFootprintConfig()  # enabled=False par défaut
    footprint_diag = {"used_vision": False, "fallback_reason": "not_called"}
    if footprint_config.enabled and prior_polygon_px:
        refined_prior, footprint_diag = detect_building_footprint(
            image_bgr, prior_polygon_px, config=footprint_config
        )
        # Utilise le polygone raffiné comme prior si la détection a réussi,
        # sinon refined_prior == prior_polygon_px original (fallback safe).
        prior_polygon_px = refined_prior

    # ---- 1. Main envelope (unchanged module) --------------------------
    main_fit = fit_roof_rectangle(image_bgr, roof_type=roof_type,
                                  prior_polygon_px=prior_polygon_px)
    main_raw = main_fit["rectangle_px"]

    # ---- 2. Global axes -----------------------------------------------
    axes = compute_global_axes(main_raw)

    # ---- 3. Detect ridges --------------------------------------------
    ridges = detect_ridges(image_bgr, axes, main_raw, config=ridge_config)

    # ---- shared gradient ---------------------------------------------
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.sqrt(gx * gx + gy * gy)
    gmax = float(grad.max())
    if gmax > 0:
        grad = grad / gmax

    # ---- 4. Build candidates with anti-gutter scoring ----------------
    raw_candidates: List[Dict] = []
    for r in ridges:
        rect = rectangle_from_ridge(r, image_bgr, axes,
                                    main_rect_4pts=main_raw,
                                    grad=grad, config=rect_config)
        # Anti-gutter scoring on the (not-yet-reordered) rect
        intern_total, intern_dbg = ridge_internality_score(
            rect["points"], image_bgr, main_raw,
            ridge_axis_hint=rect["ridge"],
            gutter_roof_frac_threshold=struct_config.gutter_roof_frac_threshold,
        )
        # Structural score with internality term
        sc_struct = score_structural(rect, image_bgr, axes,
                                     main_rect=main_raw,
                                     all_ridges=ridges, grad=grad,
                                     config=struct_config,
                                     ridge_internality=intern_total)
        raw_candidates.append({
            "ridge_id": r["id"],
            "rect": rect,
            "axis": r["axis"],
            "score": sc_struct,
            "ridge_internality_score": float(intern_total),
            "ridge_internality_debug": intern_dbg,
            "rejected_as_gutter":
                bool(struct_config.auto_reject_gutters
                     and intern_dbg.get("is_gutter_like", False)),
            "_perp": _ridge_perp_offset(np.asarray(r["p1"]),
                                        np.asarray(r["p2"]),
                                        axes, r["axis"]),
        })

    # Sort by structural score descending — important for NMS ordering
    raw_candidates.sort(key=lambda c: -c["score"]["total"])

    # v1.3: NO pre-stamping of score.total = 0 for gutters.
    # The anti-gutter heuristic is now Option B (continuous score):
    # ridge_internality is one component of the structural total, so a
    # poor internality pulls the score down naturally. The flag
    # `rejected_as_gutter` stays for diagnostics but does NOT force
    # rejection on its own (unless `auto_reject_gutters` is explicitly
    # re-enabled in the config, which is False by default in v1.3).
    if struct_config.auto_reject_gutters:
        for c in raw_candidates:
            if c["rejected_as_gutter"]:
                c["score"] = {**c["score"], "total": 0.0}

    # ---- 5. v1.4: assign semantic order + ridge_axis to every candidate
    #             BEFORE we compute pair-relations (relations need ridge_axis).
    for c in raw_candidates:
        rect_pts_raw = c["rect"]["points"]
        rect_pts, valid = ensure_semantic_point_order(
            rect_pts_raw, ridge_axis_hint=c["rect"]["ridge"])
        c["_rect_pts_ordered"] = rect_pts
        c["_semantic_order_valid"] = valid
        c["_ridge_axis_px"] = compute_ridge_axis(rect_pts)
        # The relational_graph + selection layer needs an "id" upfront,
        # which we don't have until we enumerate sections. We assign a
        # provisional one here, in the score-sorted order (same order
        # that produces S2…Sn / R1…Rn below).
        c["id_provisional"] = f"R{raw_candidates.index(c) + 1}"

    # ---- 5b. v1.4: pair relations on candidates -----------------------
    # Compute short side of main for relative thresholds
    main_pts_tmp, _ = ensure_semantic_point_order(main_raw)
    main_sides = [float(np.linalg.norm(
        np.asarray(main_pts_tmp[(i+1) % 4])
        - np.asarray(main_pts_tmp[i]))) for i in range(4)]
    short_main = float(min(main_sides))

    rel_candidates_input = [{
        "id":             c["id_provisional"],
        "points":         c["_rect_pts_ordered"],
        "ridge_axis_px":  c["_ridge_axis_px"],
        "score":          c["score"],
        "axis":           c["axis"],
        "_perp":          c["_perp"],
    } for c in raw_candidates]
    pair_relations = compute_pair_relations(
        rel_candidates_input, short_side_px=short_main,
        config=relation_config)

    # ---- 5c. v1.5: compute main_points early (needed by selection 5b) -
    main_pts, main_valid = ensure_semantic_point_order(main_raw)
    main_pts_list = [[float(p[0]), float(p[1])] for p in main_pts]

    # ---- 5d. v1.5: structural_selection pass --------------------------
    #          graph pruning + standard NMS + parent annotation +
    #          v1.5 "say no" passes (5b/c/d/e), in one call.
    selected_w_reasons = select_structural(
        rel_candidates_input, pair_relations, struct_config,
        main_points=main_pts_list,
        selection_config=selection_config,
        top_k_alternatives=3, alternative_score_min=0.30)

    # Index back to original candidates by id_provisional
    by_pid = {c["id_provisional"]: c for c in raw_candidates}
    for s in selected_w_reasons:
        orig = by_pid[s["id"]]
        # Splice ALL the original fields back in (rect, scores, dbg, etc)
        s["rect"] = orig["rect"]
        s["ridge_internality_score"] = orig["ridge_internality_score"]
        s["ridge_internality_debug"] = orig["ridge_internality_debug"]
        s["rejected_as_gutter"] = orig["rejected_as_gutter"]
        s["_rect_pts_ordered"] = orig["_rect_pts_ordered"]
        s["_semantic_order_valid"] = orig["_semantic_order_valid"]
        s["_ridge_axis_px"] = orig["_ridge_axis_px"]

    # ---- 6. Build main section (semantic order + enrichments) --------
    # main_pts already computed in step 5c
    main_ridge_axis = compute_ridge_axis(main_pts)
    main_rvs, main_rvs_dbg = ridge_visible_score(main_pts, image_bgr,
                                                 axes, grad=grad)
    main_pss, main_pss_dbg = roof_plane_symmetry_score(main_pts, image_bgr)
    main_intern, main_intern_dbg = ridge_internality_score(
        main_pts, image_bgr, main_pts,
        ridge_axis_hint=main_ridge_axis,
        gutter_roof_frac_threshold=struct_config.gutter_roof_frac_threshold,
    )

    sections: List[Dict] = [{
        "id": "S1",
        "role": "main",
        "experimental": False,
        "points": [[int(round(p[0])), int(round(p[1]))] for p in main_pts],
        "semantic_order_valid": bool(main_valid),
        "ridge_axis_px": [[int(round(p[0])), int(round(p[1]))]
                          for p in main_ridge_axis],
        "ridge_visible_score": float(main_rvs),
        "plane_symmetry_score": float(main_pss),
        "ridge_internality_score": float(main_intern),
        "rejected_as_gutter": False,
        # v1.4 contract — main is ALWAYS kept, role=main
        "selection_status":   "kept",
        "selection_reason":   "main envelope — always kept",
        "rejection_reason":   None,
        "relationship_type":  "main",
        "parent_id":          None,
        "group_id":           None,
        "top_k_alternatives": [],
        "related_ids":        [],   # filled below from kept children
        "pruned_by":          [],
        # back-compat
        "kept_by_nms":        True,
        "roof_type": roof_type,
        "pitch": default_pitch_deg,
        "debug": {
            "ridge_visible_components": main_rvs_dbg,
            "plane_symmetry_components": main_pss_dbg,
            "ridge_internality_components": main_intern_dbg,
            "main_fit_score": main_fit.get("score"),
            "main_fit_selected": main_fit.get("selected"),
            "raw_points_before_reorder": main_raw,
        },
    }]

    # ---- 7. Build ridge_candidate sections (experimental) ------------
    for i, c in enumerate(selected_w_reasons, start=1):
        rect_pts = c["_rect_pts_ordered"]
        valid    = c["_semantic_order_valid"]
        ridge_axis = c["_ridge_axis_px"]
        rvs, rvs_dbg = ridge_visible_score(rect_pts, image_bgr,
                                           axes, grad=grad)
        pss, pss_dbg = roof_plane_symmetry_score(
            rect_pts, image_bgr, ridge_axis_hint=c["rect"]["ridge"])

        # Map provisional ids (Ri based on score-sort order) to the
        # final ids we'll emit. They are identical here because we
        # enumerate in the same order, but we record both for clarity.
        sections.append({
            "id": f"R{i}",
            "role": "ridge_candidate",
            "experimental": True,
            "points": [[int(round(p[0])), int(round(p[1]))] for p in rect_pts],
            "semantic_order_valid": bool(valid),
            "ridge_axis_px": [[int(round(p[0])), int(round(p[1]))]
                              for p in ridge_axis],
            "source_ridge": c["rect"]["ridge"],
            "ridge_visible_score": float(rvs),
            "plane_symmetry_score": float(pss),
            "ridge_internality_score": float(c["ridge_internality_score"]),
            "rejected_as_gutter": bool(c["rejected_as_gutter"]),
            # v1.4 contract
            "selection_status":   c["selection_status"],
            "selection_reason":   c.get("selection_reason"),
            "rejection_reason":   None if c["selection_status"] == "kept"
                                  else c.get("selection_reason"),
            "relationship_type":  c.get("relationship_type"),
            "parent_id":          c.get("parent_id"),
            "group_id":           c.get("group_id"),
            "top_k_alternatives": c.get("top_k_alternatives", []),
            "related_ids":        c.get("related_ids", []),
            "pruned_by":          c.get("pruned_by", []),
            # back-compat for v1.3 callers
            "kept_by_nms":              c["selection_status"] == "kept",
            "would_have_been_selected": c["selection_status"] == "kept",
            # carried-over fields
            "axis": c["axis"],
            "ridge_type": c["rect"].get("ridge_type", "internal"),
            "n_sides_with_peak": int(c["rect"].get("n_sides_with_peak", 2)),
            "recenter_debug": c["rect"].get("recenter_debug", {}),
            "structural_score": float(c["score"]["total"]),
            "gutter_support": c["rect"]["gutter_support"],
            "roof_type": roof_type,
            "pitch": default_pitch_deg,
            "debug": {
                "ridge_visible_components": rvs_dbg,
                "plane_symmetry_components": pss_dbg,
                "structural_components": c["score"],
                "ridge_internality_components":
                    c["ridge_internality_debug"],
            },
        })

    n_kept   = sum(1 for s in sections if s["role"] == "ridge_candidate"
                                       and s["selection_status"] == "kept")
    n_alt    = sum(1 for s in sections if s["role"] == "ridge_candidate"
                                       and s["selection_status"] == "alternative")
    n_rejected = sum(1 for s in sections if s["role"] == "ridge_candidate"
                                         and s["selection_status"] == "rejected")
    n_gutter = sum(1 for s in sections if s["role"] == "ridge_candidate"
                                       and s["rejected_as_gutter"])

    # v1.4 — typology detection on the kept set
    kept_candidates_only = [s for s in sections
                            if s["role"] == "ridge_candidate"
                               and s["selection_status"] == "kept"]
    kept_ids = {s["id"] for s in kept_candidates_only}
    relations_kept = {
        k: v for k, v in pair_relations.items()
        if k[0] in kept_ids and k[1] in kept_ids
    }
    typology = detect_typology(kept_candidates_only, relations_kept)

    # Build a serializable list of pair relations (str keys)
    pair_relations_serial = [
        {**v, "id_a": k[0], "id_b": k[1]}
        for k, v in pair_relations.items()
    ]

    # Annotate main's related_ids = direct children (kept with parent_id=S1
    # OR kept and not contained)
    for s in sections:
        if s["id"] == "S1":
            s["related_ids"] = [c["id"] for c in kept_candidates_only
                                if c.get("parent_id") in (None, "S1")]
            break

    return {
        "schema_version":     "sections-1.6.0",
        "primary_axis_deg":   axes["primary_axis_deg"],
        "secondary_axis_deg": axes["secondary_axis_deg"],
        "global_axes":        axes,
        "sections":           sections,
        "n_sections":         len(sections),
        "n_ridges_detected":  len(ridges),
        "n_experimental":     len(sections) - 1,
        # v1.4 counts by selection_status
        "n_ridge_kept":         n_kept,
        "n_ridge_alternative":  n_alt,
        "n_ridge_rejected":     n_rejected,
        "n_rejected_as_gutter": n_gutter,
        # v1.4 — relational + typology
        "detected_typology":  typology,
        "pair_relations":     pair_relations_serial,
        "n_pair_relations":   len(pair_relations_serial),
        "diagnostics": {
            "main_semantic_order_valid":     bool(main_valid),
            "main_ridge_visible_score":      float(main_rvs),
            "main_plane_symmetry_score":     float(main_pss),
            "main_ridge_internality_score":  float(main_intern),
            "footprint_detection":           footprint_diag,
            "ridge_candidates_all": [
                {"id": r["id"], "axis": r["axis"],
                 "length_px": r["length_px"], "strength": r["strength"],
                 "p1": r["p1"], "p2": r["p2"]}
                for r in ridges
            ],
        },
    }
