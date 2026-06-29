"""
build_dataset_from_supabase.py
==============================

Pipeline complet automatique : pull les datasets `validated` / `ready_for_training`
directement depuis Supabase, télécharge les images, et construit la structure
YOLOv8-OBB prête à l'entraînement.

Conçu pour tourner en GitHub Actions (CI) sans intervention manuelle :
  - Pas besoin d'exporter un bundle ZIP depuis le portail
  - Pas besoin d'un humain pour upload/copier des fichiers
  - Pull les images depuis l'URL `raw_image_url` (Google Static Maps cached)

Variables d'environnement requises (GitHub Secrets) :
  SUPABASE_URL                — ex https://eeradaaxmqzyvxvmahlf.supabase.co
  SUPABASE_SERVICE_KEY        — service_role JWT (bypass RLS, lecture seule
                                via cette policy)

Usage CLI :
  python build_dataset_from_supabase.py --out /tmp/yolo_dataset/
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import time
from pathlib import Path
from typing import Iterable, List, Optional
from urllib.request import Request, urlopen

# Réutilise la logique de conversion existante (déjà testée)
from convert_to_yolo_obb import (
    CLASS_MAP, CLASS_NAMES,
    SPLIT_TRAIN, SPLIT_VAL,
    Dataset, Section,
    obb_to_yolo_line, section_to_obb, split_for,
    write_yolo_dataset,
)

# Lazy imports — ces deps sont uniquement nécessaires côté CI training
import cv2  # noqa: E402
import numpy as np  # noqa: E402


# ──────────────────────────────────────────────────────────────────────────────
# Supabase fetch (PostgREST direct, pas besoin de supabase-py)
# ──────────────────────────────────────────────────────────────────────────────
def _supabase_select(table: str, select: str, filters: str = "") -> List[dict]:
    """REST GET vers PostgREST avec auth service_role."""
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    url = f"{base}/rest/v1/{table}?select={select}"
    if filters:
        url += "&" + filters
    req = Request(
        url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_image_bytes(url: str, timeout: int = 30) -> Optional[bytes]:
    """GET sur l'URL de l'image (Google Static Maps cached côté Supabase Storage
    ou directement). Retourne None silencieusement en cas d'échec."""
    try:
        req = Request(url, headers={"User-Agent": "toitures-vb-ci/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] image fetch failed: {url[:80]}… → {exc}")
        return None


# ──────────────────────────────────────────────────────────────────────────────
# Pull datasets + construit Dataset[] (compatible avec write_yolo_dataset)
# ──────────────────────────────────────────────────────────────────────────────
def pull_validated_datasets(out_image_dir: Path) -> Iterable[Dataset]:
    """
    Iterator sur les datasets exportables (validated + ready_for_training),
    avec leurs images déjà téléchargées localement.
    """
    out_image_dir.mkdir(parents=True, exist_ok=True)

    filters = (
        "dataset_status=in.(validated,ready_for_training)"
        "&roof_model=not.is.null"
        "&raw_image_url=not.is.null"
    )
    rows = _supabase_select(
        "training_roof_takeoffs",
        "id,reference,raw_image_url,roof_model",
        filters,
    )
    print(f"Fetched {len(rows)} candidate datasets from Supabase")

    yielded = 0
    for row in rows:
        ref = row.get("reference") or row.get("id")
        raw_url = row.get("raw_image_url")
        if not raw_url:
            print(f"  [skip] {ref} : raw_image_url null")
            continue
        roof_model = row.get("roof_model") or {}
        sections_raw = roof_model.get("sections") or []
        if not sections_raw:
            print(f"  [skip] {ref} : roof_model empty")
            continue

        # Download image
        img_bytes = _fetch_image_bytes(raw_url)
        if img_bytes is None:
            print(f"  [skip] {ref} : image fetch failed")
            continue

        # Decode pour récupérer les dimensions (le converter en a besoin)
        arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            print(f"  [skip] {ref} : image decode failed")
            continue
        h, w = img.shape[:2]

        # Save image localement (le write_yolo_dataset copie depuis ce path)
        img_path = out_image_dir / f"{ref}.jpg"
        img_path.write_bytes(img_bytes)

        # Convert sections au format Section
        sections: List[Section] = []
        for s in sections_raw:
            pts = s.get("pts") or []
            if len(pts) < 3:
                continue
            pts_norm = [(float(p["x"]), float(p["y"])) for p in pts]
            sections.append(Section(
                pts=pts_norm,
                roof_type=str(s.get("roof_type") or "hip"),
                pitch=s.get("pitch"),
                section_id=s.get("id"),
            ))
        if not sections:
            print(f"  [skip] {ref} : 0 valid sections after parse")
            continue

        yield Dataset(
            reference=ref,
            image_path=img_path,
            image_w=w, image_h=h,
            sections=sections,
            split=split_for(ref),
        )
        yielded += 1

    print(f"\nTotal usable datasets : {yielded}")


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", required=True, type=Path,
                    help="Dossier de sortie YOLO-OBB")
    args = ap.parse_args()

    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        if not os.environ.get(key):
            raise SystemExit(f"missing env var: {key}")

    raw_image_dir = Path("/tmp/raw_images")
    if raw_image_dir.exists():
        shutil.rmtree(raw_image_dir)

    datasets = list(pull_validated_datasets(raw_image_dir))
    if not datasets:
        raise SystemExit("no usable datasets — abort")

    print(f"\nWriting YOLO-OBB structure to {args.out}…")
    stats = write_yolo_dataset(datasets, args.out)

    print()
    print("──── Build stats ────")
    print(f"  Datasets exportés : {stats['n_datasets']}")
    print(f"  Sections totales  : {stats['n_sections']}")
    print(f"  Split             : train={stats['by_split']['train']}, "
          f"val={stats['by_split']['val']}, test={stats['by_split']['test']}")
    print(f"  Par classe        :")
    for name, n in stats["by_class"].items():
        if n > 0:
            print(f"    {name:8s} : {n}")
    if stats["skipped_unknown_class"] > 0:
        print(f"  ⚠ Sections skipped (class inconnue) : {stats['skipped_unknown_class']}")

    # Sanity check minimal pour CI : doit avoir au moins 1 train et 1 val
    if stats["by_split"]["train"] < 1:
        raise SystemExit("CI abort : no training samples")
    if stats["by_split"]["val"] < 1:
        print("⚠ Warning : no validation samples — training will skip val metrics")


if __name__ == "__main__":
    main()
