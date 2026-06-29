"""structural_selection.py
=============================
v1.4 — post-processing layer on top of v1.3 candidate scoring.

Entrée  : sections v1.3 (liste de candidats avec scores individuels)
Sortie  : sections filtrées + relations structurelles cohérentes

PHILOSOPHIE
-----------
v1.3 et avant : « ce rectangle est-il bon seul ? »
v1.4          : « ce rectangle est-il logique dans l'ensemble ? »

PIPELINE (additif, n'altère AUCUN module v1.3)
----------------------------------------------
    1. Hard threshold sur le score structurel
    2. Clustering par groupes d'équivalence sur les relations
       (duplicate / parasite=redundant_variant)
    3. Élection du gagnant par groupe (top score)
    4. Standard semantic NMS sur les survivants (perp + axis)
    5. Annotation parent_id depuis les relations child_of
    6. Préservation des bons rejetés comme `selection_status="alternative"`
    7. Mapping vers le vocabulaire de sortie demandé

CONTRAT JSON par candidat
-------------------------
    selection_status     : "kept" | "rejected" | "alternative"
    selection_reason     : str
    relationship_type    : "main" | "child" | "sibling" | "duplicate"
                          | "parasite" | "alternative" | None
    parent_id            : str | None       (set quand relationship_type=child)
    group_id             : str | None       ("G1", "G2", ... pour les clusters)
    top_k_alternatives   : List[str]        (rempli sur les kept en cas de groupe)
    related_ids          : List[str]        (tous les voisins dans le graphe)
    pruned_by            : List[Tuple[str,str]]   (pour debug)

CONTRAT du main S1 (jamais touché par ce module — handled by caller)
    relationship_type    : "main"
    selection_status     : "kept"
    parent_id            : None
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
import numpy as np
import cv2


# ============================================================================
# v1.5 — Selection config (drives the "say no" pass)
# ============================================================================
@dataclass
class SelectionConfig:
    """v1.6 — control the aggressive post-NMS pruning.

    Three regimes for the `structural_cap` (max kept ridge_candidates
    beyond the main):

      conservative  (default, v1.5 mandate)
        cap=1, adaptive=False
        → 0 FP guaranteed on simple/single-volume scenes
        → may miss a real sub-volume on a genuinely complex site

      normal
        cap=2, adaptive=False
        → tolerates one extra candidate (dormer/parallel scenes)

      complex / multi_wing
        cap=4, adaptive=False
        → for cross/L/T-shaped or multi-wing sites known to be complex

      adaptive
        adaptive=True
        → cap derived per scene from a pre-typology computed on the
          surviving candidates AFTER passes 5b/c/d have removed the
          noise. Best for production batches mixing simple and complex
          buildings, but on ambiguous scenes (e.g. a single-volume roof
          with several near-tie candidates) it may keep more than the
          conservative mode would.

    Construction
    ------------
      SelectionConfig()                  # conservative (default v1.6)
      SelectionConfig.conservative()     # explicit conservative
      SelectionConfig.normal()           # cap=2
      SelectionConfig.complex()          # cap=4
      SelectionConfig.cross()            # cap=6
      SelectionConfig.adaptive()         # typology-driven cap

    Pre-typology → cap mapping (when adaptive_cap=True)
    ---------------------------------------------------
      simple_addon / no relations  → cap_simple        (1)
      child_of relation present    → cap_with_child    (2, e.g. dormer)
      siblings_parallel present    → cap_with_parallel (2)
      1 sibling perpendicular      → cap_L_or_T        (3)
      2 siblings perpendicular     → cap_multi_wing    (4)
      3+ siblings perpendicular    → cap_cross         (5)

    All these caps can be overridden field-by-field.
    """
    # 5b — redundant with main
    # If a kept candidate covers ≥ 35 % of the main envelope, it is
    # essentially the main re-drawn → demote to alternative.
    # 0.35 chosen empirically: real sub-volumes (dormer, porch, garage,
    # wing, inner) all have IoU(C, S1) ≤ 0.20 in the synthetic bench;
    # "main lookalikes" all sit at IoU ≥ 0.40.
    main_dominance_iou:                 float = 0.35
    # 5c — pairwise dominance (kept vs kept)
    dominance_iou_threshold:            float = 0.25
    dominance_score_margin:             float = 0.03
    # 5d — isolated peripheral pruning
    isolated_peripheral_intern_thresh:  float = 0.55
    # 5e — structural cap (max kept ridge_candidates beyond the main)
    structural_cap:                     int   = 1
    # v1.6 — adaptive cap mode (typology-driven)
    adaptive_cap:                       bool  = False    # opt-in, off by default
    cap_simple:                         int   = 1
    cap_with_child:                     int   = 2
    cap_with_parallel:                  int   = 2
    cap_L_or_T:                         int   = 3
    cap_multi_wing:                     int   = 4
    cap_cross:                          int   = 5
    # Toggles (for debug / regression)
    enable_main_dominance:              bool  = True
    enable_dominance_pass:              bool  = True
    enable_isolated_peripheral_pruning: bool  = True
    enable_structural_cap:              bool  = True

    # ---------------- Presets ----------------------------------------
    @classmethod
    def conservative(cls) -> "SelectionConfig":
        """Default v1.5 mandate: 0 FP on simple scenes."""
        return cls(adaptive_cap=False, structural_cap=1)

    @classmethod
    def normal(cls) -> "SelectionConfig":
        """Tolerates 2 kept (e.g. dormer with both parent & child kept)."""
        return cls(adaptive_cap=False, structural_cap=2)

    @classmethod
    def complex(cls) -> "SelectionConfig":
        """For multi-wing / L-shaped / T-shaped roofs."""
        return cls(adaptive_cap=False, structural_cap=4)

    @classmethod
    def cross(cls) -> "SelectionConfig":
        """For cross-shaped / 4+ wings roofs."""
        return cls(adaptive_cap=False, structural_cap=6)

    @classmethod
    def adaptive(cls) -> "SelectionConfig":
        """Typology-driven cap: best for mixed-batch production runs."""
        return cls(adaptive_cap=True, structural_cap=1)


# ============================================================================
# Public API
# ============================================================================
def select_structural(
    candidates: List[Dict],
    relations: Dict[Tuple[str, str], Dict],
    struct_config,
    main_points: Optional[List[List[float]]] = None,
    selection_config: Optional[SelectionConfig] = None,
    top_k_alternatives: int = 3,
    # v1.6.2 (2026-06-05) : remonté 0.30 → 0.55.
    # Audit failure-mode sur 14 datasets : sections_promoted=0/14 (humains
    # n'ont JAMAIS promu une alternative en kept), datasets_with_promoted=0.
    # Les alternatives génèrent du visual noise dans le tracer (fantômes
    # superflus) sans aucune valeur ML. À 0.55 on n'expose plus que les
    # alternatives vraiment compétitives ; le reste tombe en rejected (debug).
    alternative_score_min: float = 0.55,
) -> List[Dict]:
    """Run the v1.5 structural selection pass.

    v1.5 additions
    --------------
    - main_points : if provided, enables step 5b (redundant_with_main pruning)
    - selection_config : drives the aggressive "say no" passes (5b/c/d/e)
    """
    if selection_config is None:
        selection_config = SelectionConfig()
    rel_index = _index_relations(relations)
    by_id: Dict[str, Dict] = {c["id"]: c for c in candidates}

    # Persistent state (everything we will eventually write)
    state: Dict[str, Dict] = {
        c["id"]: {
            "selection_status":   "rejected",   # default; promoted below
            "selection_reason":   None,
            "relationship_type":  None,
            "parent_id":          None,
            "group_id":           None,
            "top_k_alternatives": [],
            "related_ids":        sorted(rel_index.get(c["id"], {}).keys()),
            "pruned_by":          [],
        }
        for c in candidates
    }

    # ---- 1. Hard structural threshold ---------------------------------
    above_thresh: List[str] = []
    for c in candidates:
        s = float(c.get("score", {}).get("total", 0.0))
        if s < struct_config.min_total_score:
            state[c["id"]]["selection_reason"] = (
                f"structural_score {s:.2f} < "
                f"min_total_score {struct_config.min_total_score:.2f}")
        else:
            above_thresh.append(c["id"])

    # ---- 2. Cluster by duplicate relation (collinear ridge + high IoU) -
    dup_groups = _connected_components(
        above_thresh, rel_index, edge_types={"duplicate"})

    # ---- 3. Cluster by parasite relation (redundant_variant)
    # Note: we run this only on the SURVIVORS of step 2 to avoid mixing
    # the two semantics in one cluster. Survivors = the winners only.
    # We'll come back to losers at the end as alternatives.
    duplicate_winners: List[str] = []
    duplicate_assignments: Dict[str, str] = {}   # id → group_id
    for gi, group in enumerate(dup_groups, start=1):
        gid = f"G{gi}"
        if len(group) == 1:
            duplicate_winners.append(group[0])
            continue
        ranked = _rank_by_score(group, by_id)
        winner = ranked[0]
        duplicate_winners.append(winner)
        # Assign group_id only when ≥2 members
        for m in group:
            duplicate_assignments[m] = gid
        # Losers
        for loser in ranked[1:]:
            state[loser]["pruned_by"].append((winner, "duplicate"))
            state[loser]["selection_reason"] = (
                f"graph: duplicate of {winner} "
                f"(collinear ridge + high IoU)")
            state[loser]["relationship_type"] = "duplicate"

    # ---- 4. Cluster by parasite (redundant_variant) on the survivors --
    par_groups = _connected_components(
        duplicate_winners, rel_index, edge_types={"redundant_variant"})
    final_survivors: List[str] = []
    parasite_assignments: Dict[str, str] = {}
    for pi, group in enumerate(par_groups,
                               start=len(duplicate_assignments) + 1):
        gid = f"G{pi}"
        if len(group) == 1:
            final_survivors.append(group[0])
            continue
        ranked = _rank_by_score(group, by_id)
        winner = ranked[0]
        final_survivors.append(winner)
        for m in group:
            parasite_assignments[m] = gid
        for loser in ranked[1:]:
            state[loser]["pruned_by"].append((winner, "parasite"))
            state[loser]["selection_reason"] = (
                f"graph: parasite of {winner} "
                f"(high IoU, no perpendicular ridge between them)")
            state[loser]["relationship_type"] = "parasite"

    # ---- 5. Standard semantic NMS on final survivors ------------------
    kept_ids: List[str] = []
    for cid in final_survivors:
        c = by_id[cid]
        collision = None
        for kid in kept_ids:
            k = by_id[kid]
            if c.get("axis") != k.get("axis"):
                continue
            d_perp = abs(c.get("_perp", 0.0) - k.get("_perp", 0.0))
            if d_perp < struct_config.nms_perp_threshold_px:
                collision = (kid, d_perp)
                break
        if collision is not None:
            kid, d = collision
            state[cid]["pruned_by"].append((kid, "nms_perp"))
            state[cid]["selection_reason"] = (
                f"NMS: too close to {kid} on axis {c.get('axis')} "
                f"({d:.0f}px < {struct_config.nms_perp_threshold_px:.0f}px)")
            # NMS-collided candidates can become alternatives if score is good
            if float(c.get("score", {}).get("total", 0)) >= alternative_score_min:
                state[cid]["relationship_type"] = "alternative"
        else:
            kept_ids.append(cid)
            score = float(c.get("score", {}).get("total", 0.0))
            state[cid]["selection_status"] = "kept"
            state[cid]["selection_reason"] = (
                f"passed structural ({score:.2f}≥"
                f"{struct_config.min_total_score:.2f}), "
                f"graph (winner of duplicate/parasite group), "
                f"and NMS gates")

    # ============================================================
    # v1.5 — "say no" passes (5b/c/d/e)
    # ============================================================
    # 5b — REDUNDANT WITH MAIN
    #   If a kept candidate covers > X % of the main envelope, it is
    #   essentially the main re-drawn → demote to alternative.
    if (selection_config.enable_main_dominance
            and main_points is not None):
        for cid in list(kept_ids):
            iou_main = _polygon_iou(by_id[cid]["points"], main_points)
            if iou_main > selection_config.main_dominance_iou:
                _demote_to_alternative(
                    cid, state, kept_ids,
                    reason=(f"redundant with main "
                            f"(IoU={iou_main:.2f} > "
                            f"{selection_config.main_dominance_iou})"),
                    pruner=("S1", "redundant_with_main"),
                    main_id_for_reparent="S1",
                    candidates_state=state,
                )

    # 5c — DOMINANCE PASS (kept vs kept)
    #   For each pair of kept (A, B) with significant overlap, if
    #   score(A) > score(B) + margin AND B is not the parent of A,
    #   demote B → alternative.
    if selection_config.enable_dominance_pass:
        changed = True
        while changed:           # iterate until stable
            changed = False
            for B_id in list(kept_ids):
                if B_id not in kept_ids:
                    continue        # already demoted in this pass
                score_b = float(by_id[B_id].get("score", {}).get("total", 0))
                # Look for an A that dominates B
                for A_id in list(kept_ids):
                    if A_id == B_id or A_id not in kept_ids:
                        continue
                    rel = rel_index.get(B_id, {}).get(A_id)
                    if rel is None:
                        continue
                    if rel["iou"] < selection_config.dominance_iou_threshold:
                        continue
                    score_a = float(by_id[A_id].get("score", {}).get("total", 0))
                    if score_a < score_b + selection_config.dominance_score_margin:
                        continue
                    # If A is a child of B (B = parent), don't demote B
                    if rel["type"] == "child_of":
                        area_A = (rel["area_a"] if rel["id_a"] == A_id
                                  else rel["area_b"])
                        area_B = (rel["area_b"] if rel["id_a"] == A_id
                                  else rel["area_a"])
                        if area_A < area_B:
                            # A is the smaller one (child of B) — don't demote B
                            continue
                    # Demote B
                    _demote_to_alternative(
                        B_id, state, kept_ids,
                        reason=(f"dominated by {A_id} "
                                f"(score {score_a:.2f} > {score_b:.2f}, "
                                f"IoU {rel['iou']:.2f})"),
                        pruner=(A_id, "dominance"),
                        main_id_for_reparent=A_id,
                        candidates_state=state,
                    )
                    changed = True
                    break

    # 5d — ISOLATED PERIPHERAL PRUNING
    #   A kept candidate that is peripheral AND has no kept neighbour
    #   in a structural relation (child/sibling) is a lonely false
    #   positive (typical of gutter_only).
    if selection_config.enable_isolated_peripheral_pruning:
        STRUCTURAL_KEPT_RELS = {"child_of", "siblings_perpendicular",
                                "siblings_parallel"}
        for cid in list(kept_ids):
            c = by_id[cid]
            ridge_type = c.get("ridge_type", "internal")
            if ridge_type != "peripheral":
                continue
            has_kept_structural_rel = False
            for other_id, rel in rel_index.get(cid, {}).items():
                if other_id not in kept_ids:
                    continue
                if rel["type"] in STRUCTURAL_KEPT_RELS:
                    has_kept_structural_rel = True
                    break
            if has_kept_structural_rel:
                continue
            _demote_to_alternative(
                cid, state, kept_ids,
                reason=("isolated peripheral candidate "
                        "(ridge_type=peripheral, no structural relation "
                        "with another kept)"),
                pruner=(None, "isolated_peripheral"),
                main_id_for_reparent="S1",
                candidates_state=state,
            )

    # 5e — STRUCTURAL CAP (adaptive in v1.6)
    #   Hard ceiling on the number of kept ridge_candidates. The cap
    #   itself is computed AFTER 5b/c/d have cleaned the set, so that
    #   the typology estimate reflects real survivors, not noise.
    if selection_config.enable_structural_cap:
        effective_cap = _estimate_effective_cap(
            kept_ids, rel_index, selection_config)
        if len(kept_ids) > effective_cap:
            ranked = sorted(kept_ids,
                key=lambda i: -float(by_id[i].get("score", {}).get("total", 0)))
            keep_top = set(ranked[:effective_cap])
            for cid in ranked[effective_cap:]:
                _demote_to_alternative(
                    cid, state, kept_ids,
                    reason=(f"structural cap exceeded "
                            f"(effective cap = {effective_cap}, "
                            f"adaptive={selection_config.adaptive_cap})"),
                    pruner=(None, "structural_cap"),
                    main_id_for_reparent="S1",
                    candidates_state=state,
                )

    kept_set = set(kept_ids)

    # ---- 6. Annotate parent_id from child_of relations ----------------
    for cid in kept_ids:
        candidate_parents: List[Tuple[str, float]] = []
        for other_id, rel in rel_index.get(cid, {}).items():
            if rel["type"] != "child_of":
                continue
            # rel.id_a / rel.id_b — the LARGER area is the parent.
            area_a, area_b = rel["area_a"], rel["area_b"]
            if rel["id_a"] == cid:
                if area_b > area_a:
                    candidate_parents.append((other_id, area_b))
            else:
                if area_a > area_b:
                    candidate_parents.append((other_id, area_a))
        # Filter to KEPT parents only
        kept_parents = [(pid, a) for pid, a in candidate_parents
                        if pid in kept_set]
        if kept_parents:
            # Attach to the LARGEST kept parent (greedy)
            best_pid, _ = max(kept_parents, key=lambda t: t[1])
            state[cid]["parent_id"]         = best_pid
            state[cid]["relationship_type"] = "child"
        # else: parent_id stays None → relationship_type filled below

    # ---- 7. Fill relationship_type for kept candidates without a parent
    #         → sibling if they have a sibling-typed relation with another
    #           kept candidate; otherwise leave it None.
    SIBLING_REL_TYPES = {"siblings_perpendicular",
                         "siblings_parallel",
                         "siblings_adjacent"}
    for cid in kept_ids:
        if state[cid]["relationship_type"] is not None:
            continue
        is_sibling = False
        for other_id, rel in rel_index.get(cid, {}).items():
            if other_id not in kept_set:
                continue
            if rel["type"] in SIBLING_REL_TYPES:
                is_sibling = True
                break
        if is_sibling:
            state[cid]["relationship_type"] = "sibling"

    # ---- 8. Group IDs (write to state) --------------------------------
    for cid, gid in duplicate_assignments.items():
        state[cid]["group_id"] = gid
    for cid, gid in parasite_assignments.items():
        # Parasite groups override only if not already in a duplicate group
        if state[cid]["group_id"] is None:
            state[cid]["group_id"] = gid

    # ---- 9. Alternatives: promote good rejects to "alternative" -------
    #         A rejected candidate (loser in a duplicate/parasite group,
    #         or NMS-collided) with score >= alternative_score_min becomes
    #         status="alternative" instead of "rejected".
    for cid, st in state.items():
        if st["selection_status"] == "kept":
            continue
        score = float(by_id[cid].get("score", {}).get("total", 0.0))
        if score < alternative_score_min:
            continue
        # Only promote if it was rejected by graph or NMS (not by threshold)
        if any(reason in ("duplicate", "parasite", "nms_perp")
               for _, reason in st["pruned_by"]):
            st["selection_status"] = "alternative"

    # ---- 10. Fill top_k_alternatives on the kept candidates -----------
    #          For a kept candidate K with a group_id, list up to top_k
    #          alternatives from the same group (sorted by score).
    for cid in kept_ids:
        gid = state[cid]["group_id"]
        if gid is None:
            # Even if no group_id, expose NMS-collided alternatives that
            # overlap with this kept (related_ids ∩ alternatives)
            alts = []
            for other_id in state[cid]["related_ids"]:
                if state[other_id]["selection_status"] == "alternative":
                    alts.append(other_id)
            if alts:
                alts.sort(key=lambda i: -float(by_id[i]["score"]["total"]))
                state[cid]["top_k_alternatives"] = alts[:top_k_alternatives]
            continue
        # Same group, status = alternative (we don't include other kept
        # candidates, only the runners-up)
        group_alts = [oid for oid, ost in state.items()
                      if ost["group_id"] == gid
                      and ost["selection_status"] == "alternative"]
        group_alts.sort(key=lambda i: -float(by_id[i]["score"]["total"]))
        state[cid]["top_k_alternatives"] = group_alts[:top_k_alternatives]

    # ---- 11. Assemble enriched output ---------------------------------
    out: List[Dict] = []
    for c in candidates:
        cid = c["id"]
        st = state[cid]
        enriched = {
            **c,
            "selection_status":   st["selection_status"],
            "selection_reason":   st["selection_reason"],
            "relationship_type":  st["relationship_type"],
            "parent_id":          st["parent_id"],
            "group_id":           st["group_id"],
            "top_k_alternatives": st["top_k_alternatives"],
            "related_ids":        st["related_ids"],
            "pruned_by":          st["pruned_by"],
            # back-compat for v1.3 callers
            "kept":               st["selection_status"] == "kept",
        }
        out.append(enriched)
    return out


# ============================================================================
def detect_typology(kept_candidates: List[Dict],
                    relations_kept: Dict[Tuple[str, str], Dict]) -> str:
    """Classify the kept ensemble against ~7 standard typologies."""
    n = len(kept_candidates)
    if n == 0:
        return "simple"
    rel_types = [r["type"] for r in relations_kept.values()]
    n_child = rel_types.count("child_of")
    n_perp  = rel_types.count("siblings_perpendicular")
    n_par   = rel_types.count("siblings_parallel")
    if n_perp >= 2 and n >= 3:
        return "multi_wing"
    if n_perp >= 1:
        return "L_or_T_shape"
    if n_child >= 1:
        return "with_dormer"
    if n_par >= 1:
        return "parallel_volumes"
    return "complex" if n >= 3 else "single_addon"


# ============================================================================
# Internals
# ============================================================================
def _rank_by_score(ids: List[str], by_id: Dict[str, Dict]) -> List[str]:
    return sorted(ids,
                  key=lambda i: -float(by_id[i].get("score", {}).get("total", 0)))


def _index_relations(relations: Dict[Tuple[str, str], Dict]
                     ) -> Dict[str, Dict[str, Dict]]:
    """Build an adjacency map id → { other_id → relation_dict }."""
    out: Dict[str, Dict[str, Dict]] = defaultdict(dict)
    for (a, b), r in relations.items():
        out[a][b] = r
        out[b][a] = r
    return out


def _connected_components(active_ids: List[str],
                          rel_index: Dict[str, Dict[str, Dict]],
                          edge_types: set
                          ) -> List[List[str]]:
    """Union-find on edges of the given types, restricted to active_ids.

    Returns clusters in ORIGINAL active_ids order (preserves the score-
    sorted order of the caller within each cluster).
    """
    parent = {i: i for i in active_ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    active_set = set(active_ids)
    for a in active_ids:
        for b, rel in rel_index.get(a, {}).items():
            if b not in active_set:
                continue
            if rel["type"] in edge_types:
                union(a, b)

    groups: Dict[str, List[str]] = defaultdict(list)
    for i in active_ids:           # preserve order
        groups[find(i)].append(i)
    return list(groups.values())


# ============================================================================
# v1.5 helpers
# ============================================================================
def _polygon_iou(a, b) -> float:
    """Rasterized IoU on a tight bounding canvas. No shapely dep."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    pts = np.vstack([a, b])
    xmin, ymin = pts.min(axis=0).astype(int) - 4
    xmax, ymax = pts.max(axis=0).astype(int) + 4
    H, W = max(2, ymax - ymin), max(2, xmax - xmin)
    ma = np.zeros((H, W), dtype=np.uint8)
    mb = np.zeros((H, W), dtype=np.uint8)
    cv2.fillPoly(ma, [(a - [xmin, ymin]).astype(np.int32)], 1)
    cv2.fillPoly(mb, [(b - [xmin, ymin]).astype(np.int32)], 1)
    inter = int(((ma & mb) > 0).sum())
    union = int(((ma | mb) > 0).sum())
    return inter / max(1, union)


def _estimate_effective_cap(kept_ids: List[str],
                            rel_index: Dict[str, Dict[str, Dict]],
                            cfg: SelectionConfig) -> int:
    """v1.6 — adaptive cap based on pre-typology.

    Counts the structural relations among the currently-kept candidates
    (after 5b/c/d have removed lookalikes and parasites) and picks the
    matching cap from `cfg`.

    Order of priority (most specific first):
      3+ perp siblings → cross
      2  perp siblings → multi_wing
      1  perp sibling  → L_or_T
      child_of present → with_child   (e.g. dormer scene)
      parallel present → with_parallel
      no structural relation → simple (conservative)

    If `cfg.adaptive_cap=False`, returns `cfg.structural_cap` directly.
    Otherwise returns `max(cfg.structural_cap, mapped_cap)` so a manual
    lower bound is still honoured.
    """
    if not cfg.adaptive_cap:
        return cfg.structural_cap

    kept_set = set(kept_ids)
    n_perp = n_child = n_par = 0
    seen_pairs = set()
    for a in kept_ids:
        for b, rel in rel_index.get(a, {}).items():
            if b not in kept_set:
                continue
            pair = tuple(sorted([a, b]))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            t = rel.get("type")
            if t == "siblings_perpendicular":
                n_perp += 1
            elif t == "siblings_parallel":
                n_par += 1
            elif t == "child_of":
                n_child += 1

    if n_perp >= 3:
        mapped = cfg.cap_cross
    elif n_perp >= 2:
        mapped = cfg.cap_multi_wing
    elif n_perp >= 1:
        mapped = cfg.cap_L_or_T
    elif n_child >= 1:
        mapped = cfg.cap_with_child
    elif n_par >= 1:
        mapped = cfg.cap_with_parallel
    else:
        mapped = cfg.cap_simple
    # Honour the manual lower bound if set higher than the mapped value
    return max(cfg.structural_cap, mapped)


def _demote_to_alternative(cid: str,
                           state: Dict[str, Dict],
                           kept_ids: List[str],
                           reason: str,
                           pruner: Tuple[Optional[str], str],
                           main_id_for_reparent: str,
                           candidates_state: Dict[str, Dict]) -> None:
    """v1.5 — push a kept candidate down to alternative status.

    - Updates state[cid] (status, reason, pruned_by, relationship_type)
    - Removes cid from kept_ids
    - Re-parents any other entry whose parent_id pointed to cid:
        → main_id_for_reparent ("S1" by default, or the dominator)
    """
    if cid not in kept_ids:
        return
    kept_ids.remove(cid)
    st = state[cid]
    st["selection_status"]  = "alternative"
    st["selection_reason"]  = reason
    st["relationship_type"] = "alternative"
    pruner_id, pruner_kind = pruner
    st["pruned_by"].append((pruner_id, pruner_kind))
    # Re-parent any current orphans (children of cid) to the safe parent
    for other_cid, other_st in candidates_state.items():
        if other_st.get("parent_id") == cid:
            other_st["parent_id"] = main_id_for_reparent
            # Only retain "child" relationship_type if the new parent is
            # still a viable structure (S1 or a still-kept entry).
            if main_id_for_reparent in kept_ids or main_id_for_reparent == "S1":
                other_st["relationship_type"] = "child"
            else:
                other_st["relationship_type"] = None
