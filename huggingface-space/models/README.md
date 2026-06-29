# Models — checkpoints ML

Ce dossier reçoit les modèles ONNX entraînés (cf. `../training/README.md`).

À la racine du dossier doit se trouver :
    yolov8_obb_toitures_vb_v1.onnx

Le wrapper `yolo_obb_inference.py` regarde exactement ce chemin. Si le fichier
est absent, l'API tombe sur `algo` (v1.6 algorithmique) automatiquement.

## Pourquoi pas tracker le `.onnx` dans le repo par défaut

Les ONNX font typiquement 10-50 Mo. Ils sont ajoutés au repo (Git LFS si
nécessaire) UNIQUEMENT quand une nouvelle version remplace la précédente.

Workflow ajout :
1. Entraîner via `training/train_yolo_obb.py --export-onnx`
2. Renommer en `yolov8_obb_toitures_vb_v1.onnx`
3. `git add` + commit avec mention de la mAP@0.5 et du dataset utilisé
4. Push → CI auto-deploy HF Space → le wrapper se réactive auto
