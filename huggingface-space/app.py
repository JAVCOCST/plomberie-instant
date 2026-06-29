"""
FastAPI wrapper around `roof_sections.extract_roof_sections` for the
Hugging Face Space "javco/roof-sections-v16".

Endpoints :
  GET  /            → minimal health + version banner
  GET  /health      → JSON health check (used by uptime monitors)
  POST /roof-sections/v1.6 → run the pipeline, return sections-1.6.0 JSON

Input shape (POST /roof-sections/v1.6) :
{
  "image_b64": "data:image/jpeg;base64,...",   // or raw base64 string
  "prior_polygon_px": [[x1, y1], [x2, y2], ...], // 4+ points in image pixels
  "roof_type": "4_pans" | "2_pans" | "mixed",   // default "mixed"
  "selection_mode": "conservative" | "normal" | "complex" | "cross" | "adaptive"
                                                // default "conservative"
}

Output : the pipeline dict (schema_version "sections-1.6.0" + sections[]).
"""
from __future__ import annotations

import base64
import logging
import os
import time
import traceback
from typing import List, Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from roof_sections import extract_roof_sections
from detect_building_footprint import BuildingFootprintConfig
from structural_selection import SelectionConfig

# Optional ML backend (YOLOv8-OBB). Import is best-effort : si onnxruntime ou
# le modèle ONNX manquent, le module se charge en mode disabled et l'API peut
# toujours servir via v1.6 algorithmique (fallback automatique).
try:
    import yolo_obb_inference as _yolo_ml
except Exception as _ml_exc:  # noqa: BLE001
    _yolo_ml = None
    logging.getLogger("roof-sections-v16").info(
        "yolo-obb backend not importable (%s) — ML mode unavailable", _ml_exc
    )

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("roof-sections-v16")

# Optional shared secret. If set on the HF Space (Settings → Repository
# secrets → `SHARED_SECRET`), clients must send `Authorization: Bearer <secret>`.
# Left empty by default → endpoint open (rate-limited by HF anyway).
SHARED_SECRET = os.environ.get("SHARED_SECRET", "").strip()

SCHEMA_VERSION = "sections-1.6.0"

app = FastAPI(
    title="roof-sections v1.6",
    version="1.6.0",
    description="Conservative structural roof sections pipeline. "
                "Input: satellite image + prior polygon. Output: sections-1.6.0 JSON.",
)

# Permissive CORS so the Training Lab (browser or edge function) can call us.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    image_b64: str = Field(..., description="data URL or raw base64 of the satellite image")
    prior_polygon_px: List[List[float]] = Field(..., description="≥3 pts [x,y] in image pixels")
    roof_type: str = Field("mixed", description="2_pans | 4_pans | mixed")
    selection_mode: str = Field("conservative", description="conservative | normal | complex | cross | adaptive")
    # v1.6.1 Patch B — opt-in vision-based building footprint detection
    # avant fit_roof_rectangle. Le client passe `use_vision_prior=true` pour
    # activer. Par défaut désactivé → comportement identique à v1.6.
    use_vision_prior: bool = Field(False, description="v1.6.1: refine prior via color segmentation before fit (opt-in)")
    # v2 ML backend (YOLOv8-OBB) — opt-in. Si "ml_v1" et modèle dispo, on
    # bypass complètement la pipeline algorithmique. Si modèle absent, on log
    # un warning et on retombe sur "algo".
    backend: str = Field("algo", description="algo (v1.6 default) | ml_v1 (YOLOv8-OBB, requires trained model)")
    # Régularisation géométrique Manhattan-world bootstrappée sur l'axe
    # principal détecté dans l'image. Snap toutes les sections sur la grille
    # {axis, axis+45°, axis+90°, axis+135°}. Marche pour les deux backends.
    # Recommandé fortement, à activer côté client dès qu'on a validé que la
    # détection d'axe est robuste.
    regularize: bool = Field(False, description="Apply Manhattan-world regularization on sections (opt-in)")


def _decode_image(b64: str) -> np.ndarray:
    """Decode a data URL or raw base64 string into a BGR cv2 image."""
    if not b64:
        raise ValueError("image_b64 is empty")
    # Strip optional data URL prefix.
    if "," in b64 and b64.lstrip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception as exc:
        raise ValueError(f"image_b64 is not valid base64: {exc}") from exc
    if not raw:
        raise ValueError("image_b64 decoded to zero bytes")
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None or img.size == 0:
        raise ValueError("OpenCV could not decode the image bytes")
    return img


def _selection_config(mode: str) -> SelectionConfig:
    mode = (mode or "conservative").strip().lower()
    if mode == "conservative":
        return SelectionConfig.conservative()
    if mode == "normal":
        return SelectionConfig.normal()
    if mode == "complex":
        return SelectionConfig.complex()
    if mode == "cross":
        return SelectionConfig.cross()
    if mode == "adaptive":
        return SelectionConfig.adaptive()
    raise ValueError(f"unknown selection_mode '{mode}'")


@app.get("/")
def root():
    return {
        "service": "roof-sections-v16",
        "schema_version": SCHEMA_VERSION,
        "endpoints": ["GET /health", "POST /roof-sections/v1.6"],
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "ts": int(time.time()),
        "backends": {
            "algo":  {"available": True, "default": True},
            "ml_v1": {
                "available": bool(_yolo_ml and _yolo_ml.is_available()),
                "model_file": _yolo_ml.MODEL_FILENAME if _yolo_ml else None,
            },
        },
    }


@app.post("/roof-sections/v1.6")
def predict(req: PredictRequest, authorization: Optional[str] = None):
    # Optional shared-secret auth.
    if SHARED_SECRET:
        token = (authorization or "").replace("Bearer ", "").strip()
        if token != SHARED_SECRET:
            raise HTTPException(status_code=401, detail="unauthorized")

    started = time.monotonic()
    try:
        img = _decode_image(req.image_b64)
        backend = (req.backend or "algo").strip().lower()
        log.info(
            "predict request: img=%dx%d, prior=%d pts, roof_type=%s, mode=%s, backend=%s",
            img.shape[1], img.shape[0], len(req.prior_polygon_px),
            req.roof_type, req.selection_mode, backend,
        )
        if len(req.prior_polygon_px) < 3:
            raise ValueError("prior_polygon_px requires at least 3 points")

        if backend == "ml_v1":
            # Bypass complet de la pipeline algo → inférence YOLOv8-OBB.
            # Fallback transparent vers 'algo' si le modèle ONNX est absent
            # (cas pendant le développement où on a pas encore poussé le .onnx).
            if not (_yolo_ml and _yolo_ml.is_available()):
                log.warning("backend=ml_v1 requested but model unavailable — falling back to algo")
                backend = "algo"
            else:
                result = _yolo_ml.predict_obb(
                    image_bgr=img,
                    prior_polygon_px=req.prior_polygon_px,
                    roof_type=req.roof_type or "mixed",
                )

        if backend == "algo":
            cfg = _selection_config(req.selection_mode)
            footprint_cfg = BuildingFootprintConfig(enabled=bool(req.use_vision_prior))
            result = extract_roof_sections(
                image_bgr=img,
                roof_type=req.roof_type or "mixed",
                prior_polygon_px=req.prior_polygon_px,
                selection_config=cfg,
                footprint_config=footprint_cfg,
            )
    except ValueError as ve:
        log.warning("input error: %s", ve)
        raise HTTPException(status_code=400, detail=str(ve)) from ve
    except Exception as exc:
        log.error("pipeline error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"pipeline error: {exc}") from exc

    # Régularisation géométrique opt-in (étape 3 Manhattan-world).
    # Marche sur les deux backends (algo et ml_v1) → snap les sections sur la
    # grille dérivée de l'axe principal détecté dans l'image.
    if req.regularize and isinstance(result, dict) and result.get("sections"):
        try:
            from geometric_regularization import apply_regularization_to_result
            result = apply_regularization_to_result(
                result, img, req.prior_polygon_px,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("regularization failed (non-fatal): %s", exc)

    elapsed = time.monotonic() - started
    if not isinstance(result, dict) or result.get("schema_version") != SCHEMA_VERSION:
        log.error("pipeline returned non-conforming output: %r", type(result))
        raise HTTPException(status_code=500, detail="pipeline returned non-conforming output")
    sec_count = len(result.get("sections", []))
    log.info(
        "predict ok: %.2fs, %d sections (backend=%s, mode=%s, regularize=%s)",
        elapsed, sec_count, backend, req.selection_mode, req.regularize,
    )
    return result
