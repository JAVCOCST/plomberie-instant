"""
train_yolo_obb.py
=================

Entraîne un YOLOv8-OBB sur le dataset Toitures VB exporté par
convert_to_yolo_obb.py. Conçu pour tourner en priorité sur Google Colab Free
(T4 GPU, 12h sessions) mais marche sur n'importe quel host Python avec PyTorch.

Stratégie d'entraînement adaptée au petit dataset (24 → ~17 train + 4 val + 3 test) :

1. Transfer learning depuis YOLOv8n-OBB pretrained sur DOTA (15k images aériennes
   annotées en OBB, classes véhicules/bâtiments). Le backbone capture déjà la
   notion de "rectangle orienté vu d'en-haut".

2. Augmentation lourde pour compenser la petite taille :
   - Rotations 0/90/180/270° (toits invariants par rotation aérienne)
   - Flips horizontal + vertical
   - Variations couleur (HSV) + luminosité
   - Mosaic = 4 → 1 (YOLO native)
   - → factor ×8-16 d'examples effectifs

3. Loss YOLO-OBB native (rotated IoU + classification + objectness).

4. Validation à chaque epoch, sauvegarde du best mAP50 only.

5. Export ONNX en fin de training pour intégration HF Space CPU.

Usage :
    # Local (avec GPU)
    pip install ultralytics
    python train_yolo_obb.py --data /path/to/yolo_dataset/data.yaml

    # Colab Free (T4 GPU)
    !pip install -q ultralytics
    !python train_yolo_obb.py --data /content/yolo_dataset/data.yaml --epochs 150
"""
from __future__ import annotations

import argparse
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Defaults conservateurs pour petit dataset — éviter l'overfit catastrophique
# ──────────────────────────────────────────────────────────────────────────────
DEFAULT_EPOCHS = 150
DEFAULT_BATCH = 8           # T4 = 16 GB VRAM, batch=8 à imgsz=1280 = OK
DEFAULT_IMGSZ = 1280        # match Google Static Maps output (1280×1280)
DEFAULT_PATIENCE = 30       # early stop si pas d'amélioration mAP50 sur 30 epochs
DEFAULT_LR0 = 0.002         # un cran sous le default 0.01 — small dataset friendly
DEFAULT_DROPOUT = 0.15      # régularisation supplémentaire
DEFAULT_OPTIM = "AdamW"     # plus stable qu'SGD sur petit dataset


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data", required=True, type=Path,
                    help="Path vers data.yaml généré par convert_to_yolo_obb.py")
    ap.add_argument("--model", default="yolov8n-obb.pt",
                    help="Base model (yolov8n-obb / yolov8s-obb / yolov8m-obb)")
    ap.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    ap.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    ap.add_argument("--imgsz", type=int, default=DEFAULT_IMGSZ)
    ap.add_argument("--patience", type=int, default=DEFAULT_PATIENCE)
    ap.add_argument("--lr0", type=float, default=DEFAULT_LR0)
    ap.add_argument("--dropout", type=float, default=DEFAULT_DROPOUT)
    ap.add_argument("--project", default="runs/obb",
                    help="Dossier racine pour les runs")
    ap.add_argument("--name", default="toitures_vb_v1",
                    help="Nom du run (sera créé sous --project)")
    ap.add_argument("--device", default="0",
                    help="GPU id ('0', '0,1') ou 'cpu' pour le test")
    ap.add_argument("--export-onnx", action="store_true",
                    help="Exporte le best en ONNX à la fin (pour HF Space CPU)")
    args = ap.parse_args()

    # Import ici pour que --help marche même si ultralytics pas installé
    from ultralytics import YOLO

    if not args.data.exists():
        raise SystemExit(f"data.yaml not found: {args.data}")

    print(f"Loading base model: {args.model}")
    print(f"  (will auto-download if not cached)")
    model = YOLO(args.model)

    print(f"\nTraining config :")
    print(f"  data    : {args.data}")
    print(f"  epochs  : {args.epochs}")
    print(f"  batch   : {args.batch}")
    print(f"  imgsz   : {args.imgsz}")
    print(f"  lr0     : {args.lr0}")
    print(f"  dropout : {args.dropout}")
    print(f"  device  : {args.device}")
    print()

    # Hyperparams optimisés petit-dataset
    train_kwargs = dict(
        data=str(args.data),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        patience=args.patience,
        device=args.device,
        project=args.project,
        name=args.name,
        exist_ok=True,
        # Optimizer : AdamW plus stable que SGD sur 17 samples
        optimizer=DEFAULT_OPTIM,
        lr0=args.lr0,
        lrf=0.01,                # final lr = lr0 * lrf (cosine)
        momentum=0.937,
        weight_decay=0.0005,
        warmup_epochs=5,         # un peu plus long que le default 3 pour stabiliser
        # Régularisation
        dropout=args.dropout,
        # Augmentation — toits sont rotation-invariants en aérien, on pousse fort
        hsv_h=0.015,             # teinte légère (saisons / éclairage)
        hsv_s=0.5,               # saturation
        hsv_v=0.4,               # luminosité (ombres / soleil)
        degrees=180.0,           # rotation full 0-180° (l'image aérienne s'en fout)
        translate=0.1,           # translation modérée (déjà cadré sur le toit)
        scale=0.3,               # scale ±30%
        shear=0.0,               # shear OFF — déforme les angles droits, contre-productif
        perspective=0.0,         # perspective OFF — même raison
        flipud=0.5,              # flip vertical 50%
        fliplr=0.5,              # flip horizontal 50%
        mosaic=1.0,              # mosaic toujours (YOLO native, ×4 effective batch)
        mixup=0.15,              # mixup léger
        copy_paste=0.0,          # off — peut briser le contexte spatial
        # Validation
        val=True,
        save=True,
        save_period=-1,          # ne sauvegarde que best + last (pas tous les N epochs)
        plots=True,              # courbes loss/mAP/PR
    )

    print("Starting training… (logs dans", args.project + "/" + args.name + ")")
    results = model.train(**train_kwargs)

    # Best checkpoint path
    best_pt = Path(args.project) / args.name / "weights" / "best.pt"
    print(f"\nBest checkpoint : {best_pt}")
    if results is not None:
        print(f"  Best mAP50      : {results.box.map50:.4f}")
        print(f"  Best mAP50-95   : {results.box.map:.4f}")

    # Export ONNX pour HF Space CPU
    if args.export_onnx and best_pt.exists():
        print(f"\nExporting ONNX from best checkpoint…")
        best_model = YOLO(best_pt)
        onnx_path = best_model.export(
            format="onnx",
            imgsz=args.imgsz,
            opset=12,           # ONNX Runtime 1.16+ compatible
            simplify=True,
            dynamic=False,      # fixed batch=1 pour HF Space inference
        )
        print(f"  ONNX exported : {onnx_path}")
        print(f"  Drop ce fichier dans huggingface-space/models/ et commit.")


if __name__ == "__main__":
    main()
