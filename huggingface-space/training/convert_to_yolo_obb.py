"""
convert_to_yolo_obb.py
======================

Convertit un bundle export du Training Lab (ZIP avec takeoffs/<ref>/{raw_image.jpg,
roof_model.json, ...}) vers le format YOLOv8-OBB pour entraînement.

Format YOLOv8-OBB (par image) :
    images/train/<ref>.jpg
    labels/train/<ref>.txt   <-- une ligne par section :
                                  class_idx x1 y1 x2 y2 x3 y3 x4 y4
                                  (coordonnées normalisées dans [0, 1])

Classes (mappées depuis roof_model.sections[].roof_type) :
    0 = hip      (88% du dataset, quadrilatère)
    1 = gable    (3%, quadrilatère)
    2 = shed     (2%, quadrilatère)
    3 = tower    (4%, octogone régulier — converti en OBB englobant)
    4 = flat     (3%, polygone parfois complexe — OBB englobant si ≠4 vertices)

Pour les sections > 4 vertices (tower octogones, flat polygones complexes), on
extrait l'OBB minimum englobant via cv2.minAreaRect. La forme exacte est
reconstructible côté inference (snap octogone régulier sur un OBB, etc.).

Split train/val/test : 70/15/15 deterministic via hash du dataset id, EXACTEMENT
le même split que `src/lib/training-lab.ts:splitFor()` pour ne pas leaker la
val/test entre les générations de bundles.

Usage CLI :
    python convert_to_yolo_obb.py \\
        --bundle path/to/training-bundle-XXX.zip \\
        --out   path/to/yolo_dataset/ \\
        [--include-pre-augment]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

import cv2
import numpy as np

# ──────────────────────────────────────────────────────────────────────────────
# Mapping classes — aligné sur la distribution observée des 24 datasets
# (88% hip / 4% tower / 3% gable / 2% shed / 3% flat)
# ──────────────────────────────────────────────────────────────────────────────
CLASS_MAP = {
    "hip":   0,
    "gable": 1,
    "shed":  2,
    "tower": 3,
    "flat":  4,
}
CLASS_NAMES = ["hip", "gable", "shed", "tower", "flat"]

# Split fractions (doit matcher src/lib/training-lab.ts:splitFor)
SPLIT_TRAIN = 0.70
SPLIT_VAL   = 0.15
# le reste va dans test


@dataclass
class Section:
    """Une section dans roof_model.sections[]. pts sont en pixels image."""
    pts: List[Tuple[float, float]]
    roof_type: str
    pitch: Optional[float] = None
    section_id: Optional[str] = None


@dataclass
class Dataset:
    """Un dataset (= un toit) tiré du bundle."""
    reference: str
    image_path: Path          # raw_image.jpg
    image_w: int
    image_h: int
    sections: List[Section]
    split: str                # 'train' | 'val' | 'test'


# ──────────────────────────────────────────────────────────────────────────────
# Split deterministic (même logique que TS src/lib/training-lab.ts)
# ──────────────────────────────────────────────────────────────────────────────
def split_for(dataset_id: str) -> str:
    """Hash du dataset id → split train/val/test reproducible."""
    h = int(hashlib.sha256(dataset_id.encode()).hexdigest(), 16)
    frac = (h % 10000) / 10000.0
    if frac < SPLIT_TRAIN:
        return "train"
    if frac < SPLIT_TRAIN + SPLIT_VAL:
        return "val"
    return "test"


# ──────────────────────────────────────────────────────────────────────────────
# Conversion sections → OBB 4-vertex
# ──────────────────────────────────────────────────────────────────────────────
def section_to_obb(pts: List[Tuple[float, float]]) -> np.ndarray:
    """
    Retourne les 4 vertices du minimum-area-rectangle de la section.

    - Si la section a EXACTEMENT 4 vertices (= 93% des cas), on les retourne
      tels quels (pas de perte d'info).
    - Sinon (towers 8 vertices, flat 12+ vertices), on extrait l'OBB
      minimum-area-rectangle via OpenCV. La forme exacte n'est PAS
      reconstructible côté inference, mais :
        * Pour 'tower' : un octogone régulier inscrit dans l'OBB est une
          excellente approximation (déterministe).
        * Pour 'flat' complexe : approx grossière acceptable (3% du dataset).
    """
    if len(pts) == 4:
        return np.asarray(pts, dtype=np.float32)
    contour = np.asarray(pts, dtype=np.float32).reshape(-1, 1, 2)
    rect = cv2.minAreaRect(contour)  # ((cx,cy), (w,h), angle)
    box = cv2.boxPoints(rect)        # 4 vertices ordonnés
    return box.astype(np.float32)


def obb_to_yolo_line(
    obb: np.ndarray, class_idx: int, img_w: int, img_h: int
) -> str:
    """
    Sérialise un OBB 4-vertex en ligne YOLOv8-OBB :
        class_idx x1 y1 x2 y2 x3 y3 x4 y4
    Coordonnées normalisées dans [0, 1].
    """
    if obb.shape != (4, 2):
        raise ValueError(f"OBB must be 4x2, got {obb.shape}")
    xs = obb[:, 0] / float(img_w)
    ys = obb[:, 1] / float(img_h)
    coords = " ".join(f"{v:.6f}" for pair in zip(xs, ys) for v in pair)
    return f"{class_idx} {coords}"


# ──────────────────────────────────────────────────────────────────────────────
# Bundle extraction
# ──────────────────────────────────────────────────────────────────────────────
def load_bundle_datasets(bundle_path: Path) -> Iterable[Dataset]:
    """
    Itère sur les datasets d'un bundle ZIP. Yield un Dataset par dossier
    `takeoffs/<ref>/`. Skip silencieusement les datasets sans roof_model ou
    sans raw_image.
    """
    with zipfile.ZipFile(bundle_path) as zf:
        # Index les fichiers par dossier <ref>
        by_ref: dict = {}
        for name in zf.namelist():
            parts = name.split("/")
            if len(parts) < 3 or parts[0] != "takeoffs":
                continue
            ref = parts[1]
            by_ref.setdefault(ref, []).append(name)

        for ref, files in by_ref.items():
            roof_model_name = next(
                (f for f in files if f.endswith("/roof_model.json")), None
            )
            image_name = next(
                (f for f in files if f.endswith("/raw_image.jpg")), None
            )
            if not roof_model_name or not image_name:
                print(f"  [skip] {ref} : missing roof_model.json or raw_image.jpg")
                continue

            with zf.open(roof_model_name) as f:
                model = json.load(f)
            with zf.open(image_name) as f:
                img_bytes = f.read()
            arr = np.frombuffer(img_bytes, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                print(f"  [skip] {ref} : image decode failed")
                continue
            h, w = img.shape[:2]

            sections_raw = model.get("sections") or []
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
                print(f"  [skip] {ref} : 0 sections in roof_model")
                continue

            # Temp dir pour l'image (extraite à la volée)
            tmp_img = Path("/tmp") / f"yolo_src_{ref}.jpg"
            tmp_img.write_bytes(img_bytes)

            yield Dataset(
                reference=ref,
                image_path=tmp_img,
                image_w=w, image_h=h,
                sections=sections,
                split=split_for(ref),
            )


# ──────────────────────────────────────────────────────────────────────────────
# Output YOLO dataset structure
# ──────────────────────────────────────────────────────────────────────────────
def write_yolo_dataset(datasets: List[Dataset], out_dir: Path) -> dict:
    """
    Écrit la structure YOLOv8-OBB sur disque :

        out_dir/
            data.yaml
            images/train/<ref>.jpg
            images/val/<ref>.jpg
            images/test/<ref>.jpg
            labels/train/<ref>.txt
            labels/val/<ref>.txt
            labels/test/<ref>.txt

    Retourne un dict de stats.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for split in ["train", "val", "test"]:
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    stats = {
        "n_datasets": 0,
        "n_sections": 0,
        "by_split": {"train": 0, "val": 0, "test": 0},
        "by_class": {name: 0 for name in CLASS_NAMES},
        "skipped_unknown_class": 0,
        "skipped_no_sections": 0,
    }

    for ds in datasets:
        img_dst = out_dir / "images" / ds.split / f"{ds.reference}.jpg"
        lbl_dst = out_dir / "labels" / ds.split / f"{ds.reference}.txt"
        shutil.copy(ds.image_path, img_dst)

        lines: List[str] = []
        for s in ds.sections:
            class_idx = CLASS_MAP.get(s.roof_type)
            if class_idx is None:
                stats["skipped_unknown_class"] += 1
                continue
            try:
                obb = section_to_obb(s.pts)
                line = obb_to_yolo_line(obb, class_idx, ds.image_w, ds.image_h)
                lines.append(line)
                stats["by_class"][s.roof_type] += 1
                stats["n_sections"] += 1
            except Exception as e:
                print(f"  [warn] {ds.reference} section error: {e}")

        if not lines:
            stats["skipped_no_sections"] += 1
            img_dst.unlink(missing_ok=True)
            continue

        lbl_dst.write_text("\n".join(lines) + "\n", encoding="utf-8")
        stats["n_datasets"] += 1
        stats["by_split"][ds.split] += 1

    # data.yaml — config YOLOv8 standard
    data_yaml = out_dir / "data.yaml"
    data_yaml.write_text(
        f"""# Auto-généré par convert_to_yolo_obb.py
# Dataset Toitures VB — sections de toit en OBB
path: {out_dir.resolve()}
train: images/train
val: images/val
test: images/test

# Classes (OBB)
nc: {len(CLASS_NAMES)}
names:
{chr(10).join(f"  {i}: {n}" for i, n in enumerate(CLASS_NAMES))}
""",
        encoding="utf-8",
    )
    return stats


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bundle", required=True, type=Path,
                    help="Bundle ZIP exporté depuis le Training Lab")
    ap.add_argument("--out", required=True, type=Path,
                    help="Dossier de sortie YOLO-OBB")
    args = ap.parse_args()

    if not args.bundle.exists():
        raise SystemExit(f"bundle not found: {args.bundle}")

    print(f"Loading bundle {args.bundle.name}…")
    datasets = list(load_bundle_datasets(args.bundle))
    print(f"  → {len(datasets)} datasets parsed")

    print(f"Writing YOLO-OBB structure to {args.out}…")
    stats = write_yolo_dataset(datasets, args.out)

    print()
    print("──── Conversion stats ────")
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
    if stats["skipped_no_sections"] > 0:
        print(f"  ⚠ Datasets skipped (0 section)      : {stats['skipped_no_sections']}")

    print(f"\nDataset prêt à l'entraînement :")
    print(f"  yolo obb train data={args.out}/data.yaml model=yolov8n-obb.pt epochs=100 imgsz=1280")


if __name__ == "__main__":
    main()
