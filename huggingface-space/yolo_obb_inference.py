"""
yolo_obb_inference.py
=====================

Wrapper d'inférence YOLOv8-OBB pour la HF Space, alternative ML au pipeline
algorithmique v1.6. Charge un modèle ONNX au démarrage du service et expose
`predict_obb()` qui retourne un dict v1.6-compatible.

Stratégie d'intégration :
- Si `MODEL_PATH` n'existe pas → le module se charge en mode disabled. L'app
  peut toujours répondre via v1.6 algorithmique. Permet de pousser le code
  d'intégration AVANT que le modèle entraîné soit dispo.
- Si modèle dispo → `available=True`, inférence opérationnelle.

Schema output identique à `roof_sections.py` (v1.6 algo) — drop-in replacement.
"""
from __future__ import annotations

import logging
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

log = logging.getLogger("yolo-obb")

# Modèle ONNX exporté depuis training/train_yolo_obb.py --export-onnx
# Path relatif au dossier huggingface-space/.
MODEL_FILENAME = "yolov8_obb_toitures_vb_v1.onnx"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / MODEL_FILENAME

# Classes (doit matcher CLASS_NAMES dans training/convert_to_yolo_obb.py)
CLASS_NAMES = ["hip", "gable", "shed", "tower", "flat"]

# Confidence threshold pour le détecteur — un cran prudent au début car on n'a
# que 24 datasets de training. À tuner après les premières mesures terrain.
DEFAULT_CONF_THRESHOLD = 0.35
DEFAULT_IOU_THRESHOLD = 0.45    # NMS rotated IoU


# ──────────────────────────────────────────────────────────────────────────────
# Singleton model — chargé lazy au premier appel
# ──────────────────────────────────────────────────────────────────────────────
_session = None
_available: Optional[bool] = None


def is_available() -> bool:
    """True si le modèle ONNX est sur disque et l'env supporte onnxruntime."""
    global _available
    if _available is not None:
        return _available
    if not MODEL_PATH.exists():
        log.info("yolo-obb model not found at %s — ML inference disabled", MODEL_PATH)
        _available = False
        return False
    try:
        import onnxruntime  # noqa: F401
    except ImportError:
        log.warning("onnxruntime not installed — ML inference disabled")
        _available = False
        return False
    _available = True
    return True


def _get_session():
    """Charge la session ONNX au premier usage. ~50 ms cold start (yolov8n)."""
    global _session
    if _session is not None:
        return _session
    import onnxruntime as ort
    # CPU only — la HF Space free tier n'a pas de GPU. Si on passe sur paid
    # avec GPU plus tard, ajouter "CUDAExecutionProvider" en premier.
    providers = ["CPUExecutionProvider"]
    so = ort.SessionOptions()
    so.intra_op_num_threads = int(os.environ.get("ORT_NUM_THREADS", "2"))
    _session = ort.InferenceSession(str(MODEL_PATH), so, providers=providers)
    log.info("yolo-obb ONNX session ready (providers=%s)", providers)
    return _session


# ──────────────────────────────────────────────────────────────────────────────
# Preprocessing : image BGR → tensor float32 (1, 3, imgsz, imgsz)
# ──────────────────────────────────────────────────────────────────────────────
def _letterbox(img: np.ndarray, target: int = 1280) -> Tuple[np.ndarray, float, Tuple[int, int]]:
    """Resize en gardant l'aspect ratio + padding gray (114). Standard YOLO."""
    import cv2
    h, w = img.shape[:2]
    r = target / max(h, w)
    nh, nw = int(round(h * r)), int(round(w * r))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    pad_h = target - nh
    pad_w = target - nw
    top = pad_h // 2
    left = pad_w // 2
    padded = cv2.copyMakeBorder(
        resized, top, pad_h - top, left, pad_w - left,
        cv2.BORDER_CONSTANT, value=(114, 114, 114),
    )
    return padded, r, (left, top)


def _preprocess(image_bgr: np.ndarray, imgsz: int) -> Tuple[np.ndarray, float, Tuple[int, int]]:
    """BGR uint8 HWC → CHW float32 normalisé + letterbox metadata."""
    padded, ratio, (pad_x, pad_y) = _letterbox(image_bgr, target=imgsz)
    rgb = padded[:, :, ::-1]  # BGR → RGB
    tensor = rgb.astype(np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))[None]  # 1,3,H,W
    return np.ascontiguousarray(tensor), ratio, (pad_x, pad_y)


# ──────────────────────────────────────────────────────────────────────────────
# Postprocessing : ONNX raw output → OBB sections
# ──────────────────────────────────────────────────────────────────────────────
def _rotated_nms(
    boxes: np.ndarray, scores: np.ndarray, iou_thresh: float
) -> List[int]:
    """
    NMS sur rectangles orientés. boxes shape (N, 5) = (cx, cy, w, h, angle_rad).
    Retourne les indices à garder, triés par score décroissant.

    Pour rester pure-numpy (pas torchvision côté HF Space), on utilise cv2
    pour rotatedRectangleIntersection.
    """
    import cv2
    order = np.argsort(-scores)
    keep: List[int] = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        rest = order[1:]
        b_i = boxes[i]
        ious = np.zeros(rest.size, dtype=np.float32)
        rect_i = ((b_i[0], b_i[1]), (b_i[2], b_i[3]), math.degrees(b_i[4]))
        area_i = b_i[2] * b_i[3]
        for k, j in enumerate(rest):
            b_j = boxes[j]
            rect_j = ((b_j[0], b_j[1]), (b_j[2], b_j[3]), math.degrees(b_j[4]))
            ret, inter_pts = cv2.rotatedRectangleIntersection(rect_i, rect_j)
            if ret == 0 or inter_pts is None:
                continue
            inter_area = cv2.contourArea(inter_pts)
            area_j = b_j[2] * b_j[3]
            union = area_i + area_j - inter_area
            if union > 0:
                ious[k] = inter_area / union
        order = rest[ious < iou_thresh]
    return keep


def _decode_yolov8_obb(
    raw: np.ndarray,
    conf_thresh: float,
    iou_thresh: float,
    n_classes: int,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Décode l'output ONNX standard YOLOv8-OBB.
    Format : (1, 5+n_classes+1, N_anchors) — (cx, cy, w, h, angle, c0..c_n-1).
    Ultralytics export ONNX a déjà le sigmoïd appliqué sur les class probs.

    Retourne (kept_boxes, kept_scores, kept_cls) — boxes shape (M, 5).
    """
    pred = np.squeeze(raw)
    if pred.ndim != 2:
        raise ValueError(f"unexpected ONNX output shape {raw.shape}")
    # Transpose si format channels-first (Ultralytics export = (C, N))
    if pred.shape[0] == 5 + n_classes + 1 or pred.shape[0] < pred.shape[1]:
        pred = pred.T
    # Maintenant (N, 5 + n_classes + 1) — colonnes [cx, cy, w, h, c0..c_n-1, angle]
    # Note : l'ordre exact dépend de la version Ultralytics. On checke.
    if pred.shape[1] == 5 + n_classes + 1:
        # Variante "boxes-then-angle" (yolov8 standard) : cx cy w h c0..c_n-1 angle
        cx = pred[:, 0]; cy = pred[:, 1]; w = pred[:, 2]; h = pred[:, 3]
        cls_scores = pred[:, 4:4 + n_classes]
        angles = pred[:, 4 + n_classes]
    elif pred.shape[1] == 5 + n_classes:
        # Variante (rare) sans angle séparé — fallback
        cx = pred[:, 0]; cy = pred[:, 1]; w = pred[:, 2]; h = pred[:, 3]
        cls_scores = pred[:, 4:]
        angles = np.zeros_like(cx)
    else:
        raise ValueError(f"unexpected ONNX prediction width {pred.shape[1]} "
                         f"(expected {5 + n_classes} or {5 + n_classes + 1})")

    best_cls = np.argmax(cls_scores, axis=1)
    best_scores = cls_scores[np.arange(cls_scores.shape[0]), best_cls]

    mask = best_scores >= conf_thresh
    if not mask.any():
        return (np.zeros((0, 5), dtype=np.float32),
                np.zeros((0,), dtype=np.float32),
                np.zeros((0,), dtype=np.int64))

    boxes = np.stack(
        [cx[mask], cy[mask], w[mask], h[mask], angles[mask]],
        axis=1,
    ).astype(np.float32)
    scores = best_scores[mask].astype(np.float32)
    classes = best_cls[mask].astype(np.int64)

    # NMS per-class pour éviter de supprimer un toit voisin de classe différente
    keep_idx: List[int] = []
    for c in np.unique(classes):
        idx_c = np.where(classes == c)[0]
        kept = _rotated_nms(boxes[idx_c], scores[idx_c], iou_thresh)
        keep_idx.extend(idx_c[k] for k in kept)
    keep_idx = sorted(keep_idx)

    return boxes[keep_idx], scores[keep_idx], classes[keep_idx]


def _obb_to_4pts(box5: np.ndarray) -> np.ndarray:
    """(cx, cy, w, h, angle_rad) → 4 vertices np.ndarray (4, 2)."""
    cx, cy, w, h, ang = box5
    cos_a = math.cos(ang)
    sin_a = math.sin(ang)
    hw, hh = w / 2.0, h / 2.0
    # Local corners (centered, axis-aligned)
    local = np.array([
        [-hw, -hh],
        [+hw, -hh],
        [+hw, +hh],
        [-hw, +hh],
    ], dtype=np.float32)
    # Rotate
    R = np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=np.float32)
    rotated = local @ R.T
    rotated[:, 0] += cx
    rotated[:, 1] += cy
    return rotated


def _unletterbox_points(
    pts: np.ndarray, ratio: float, pad: Tuple[int, int]
) -> np.ndarray:
    """Inverse du letterbox : repasse les coords du tensor vers l'image originale."""
    out = pts.copy()
    out[:, 0] -= pad[0]
    out[:, 1] -= pad[1]
    out /= ratio
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Public API — drop-in compatible v1.6
# ──────────────────────────────────────────────────────────────────────────────
def predict_obb(
    image_bgr: np.ndarray,
    prior_polygon_px: List[List[float]],
    roof_type: str = "mixed",
    imgsz: int = 1280,
    conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    iou_threshold: float = DEFAULT_IOU_THRESHOLD,
) -> Dict[str, Any]:
    """
    Inférence ML — output au schema "sections-1.6.0" pour drop-in compat.

    Le prior_polygon_px n'est PAS encore utilisé activement (le modèle voit
    juste l'image entière). On le garde dans la signature pour pouvoir l'utiliser
    plus tard (crop autour de la bbox, ou comme channel input dans une v2 du
    modèle).
    """
    if not is_available():
        raise RuntimeError("YOLOv8-OBB model not available")

    sess = _get_session()
    tensor, ratio, pad = _preprocess(image_bgr, imgsz)

    input_name = sess.get_inputs()[0].name
    outputs = sess.run(None, {input_name: tensor})
    raw = outputs[0]

    n_cls = len(CLASS_NAMES)
    boxes5, scores, classes = _decode_yolov8_obb(
        raw, conf_threshold, iou_threshold, n_cls
    )

    sections = []
    for i, (box, score, cls_idx) in enumerate(zip(boxes5, scores, classes), start=1):
        pts_tensor = _obb_to_4pts(box)
        pts_img = _unletterbox_points(pts_tensor, ratio, pad)
        sections.append({
            "id": f"S{i}",
            "points": pts_img.tolist(),
            "roof_type": CLASS_NAMES[int(cls_idx)],
            "selection_status": "kept",
            "selection_reason": "yolov8_obb_score",
            "score": {"total": float(score), "ml_confidence": float(score)},
            "pitch": 7,        # default — le modèle ne prédit pas le pitch
            "relationship_type": None,
            "parent_id": None,
            "group_id": None,
            "top_k_alternatives": [],
            "related_ids": [],
            "pruned_by": [],
        })

    return {
        "schema_version": "sections-1.6.0",
        "sections": sections,
        "metadata": {
            "model": "yolov8-obb",
            "model_file": MODEL_FILENAME,
            "conf_threshold": conf_threshold,
            "iou_threshold": iou_threshold,
            "n_detections": len(sections),
        },
    }
