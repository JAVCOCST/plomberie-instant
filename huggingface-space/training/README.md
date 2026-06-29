# Entraînement YOLOv8-OBB sur Toitures VB

Pipeline d'entraînement d'un détecteur de sections de toit en Oriented Bounding
Box (OBB), à partir des datasets validés dans le Training Lab.

**Pourquoi YOLOv8-OBB plutôt que Mask R-CNN ou Polygon-Transformer** : 93 % des
sections annotées sont des quadrilatères 4-vertices. Un détecteur OBB sort
nativement des rectangles propres orientés, alignés avec la géométrie d'un
toit, sans la "blobiness" classique d'une segmentation pixel.

---

## Option recommandée : workflow GitHub Actions (100 % auto, zéro Colab)

Configuré dans `.github/workflows/train-yolo-obb.yml`. Pull les datasets
directement depuis Supabase, train sur CPU runner free tier, exporte l'ONNX
et le commit automatiquement → la HF Space se redéploie toute seule.

### Setup (one-shot, 2 min)

Dans **Settings → Secrets and variables → Actions → New repository secret**,
ajouter 2 secrets :

| Nom du secret           | Valeur                                                  |
|-------------------------|---------------------------------------------------------|
| `SUPABASE_URL`          | `https://eeradaaxmqzyvxvmahlf.supabase.co`             |
| `SUPABASE_SERVICE_KEY`  | Le `service_role` JWT (Supabase Dashboard → Settings → API) |

⚠ Le `service_role` bypass RLS, donc lecture seule sur la table
`training_roof_takeoffs`. Ne JAMAIS le mettre côté client. Il reste sécurisé
dans GitHub Secrets.

### Lancer un entraînement

1. Onglet **Actions** du repo
2. **Train YOLOv8-OBB** dans la sidebar
3. **Run workflow** → optionnellement régler epochs / imgsz / model
4. Attendre ~1.5-2 h (CPU runner)
5. À la fin : commit auto sur `main` du `.onnx` → HF Space redéploie

Pas besoin d'ordi, pas besoin de Colab, pas besoin de bundle ZIP.

### Cron mensuel

Le workflow tourne aussi automatiquement le premier dimanche de chaque mois
à 06:00 UTC pour re-train avec les datasets accumulés depuis. Désactivable
en commentant la section `schedule:` du YAML.

### Quotas free tier GitHub

- 2000 min/mois pour repos privés (training = ~120 min → 16 runs/mois théoriques)
- Pas de GPU sur le free tier → on entraîne yolov8n (12 MB) à 640px par défaut
- Si on veut un modèle plus gros (yolov8s ou imgsz 1280), il faut soit
  passer en GitHub Pro ($4/mois → 3000 min), soit déclencher via Colab manuel

---

## Option alternative : Colab manuel (Phase B initial)

### 1. Export d'un bundle depuis le Training Lab

Dans `/admin/training-lab` :
- Filtre **« Prêt pour export »**
- **Tout sélectionner** (case en haut)
- **« Générer bundle Claude (N) »**
- Un ZIP `training-bundle-XXX.zip` se télécharge

### 2. Setup Colab Free (T4 GPU, 12h)

Ouvre [colab.research.google.com](https://colab.research.google.com) → New Notebook.
Active le GPU : **Runtime → Change runtime type → T4 GPU**.

### 3. Conversion + entraînement (un seul cell à coller)

```python
# %% Setup
!pip install -q ultralytics opencv-python-headless
!git clone --depth 1 https://github.com/JAVCOCST/webflow-quote-builder.git /tmp/repo

# %% Upload du bundle ZIP
from google.colab import files
print("Sélectionne le ZIP training-bundle-XXX.zip téléchargé depuis le Training Lab")
uploaded = files.upload()
bundle_path = next(iter(uploaded.keys()))
print(f"Bundle uploadé : {bundle_path}")

# %% Conversion JSON → YOLO-OBB
!python /tmp/repo/huggingface-space/training/convert_to_yolo_obb.py \
    --bundle "{bundle_path}" \
    --out /content/yolo_dataset/

# %% Sanity check : combien d'images dans chaque split ?
!ls /content/yolo_dataset/images/train/ | wc -l
!ls /content/yolo_dataset/images/val/ | wc -l
!ls /content/yolo_dataset/images/test/ | wc -l

# %% Training (~30-90 min sur T4 selon nb d'epochs)
!python /tmp/repo/huggingface-space/training/train_yolo_obb.py \
    --data /content/yolo_dataset/data.yaml \
    --epochs 150 \
    --batch 8 \
    --imgsz 1280 \
    --device 0 \
    --export-onnx

# %% Download des artefacts
from google.colab import files
files.download('/content/runs/obb/toitures_vb_v1/weights/best.pt')
files.download('/content/runs/obb/toitures_vb_v1/weights/best.onnx')
files.download('/content/runs/obb/toitures_vb_v1/results.png')        # courbes loss
files.download('/content/runs/obb/toitures_vb_v1/confusion_matrix.png')
```

### 4. Validation visuelle

Avant d'intégrer, regarde `results.png` :
- **mAP50** (boîte verte) doit monter vers 0.5+ pour être utilisable
- Si **mAP50 < 0.3**, le modèle n'a pas convergé — il faut plus de data ou des
  hyperparams différents

`confusion_matrix.png` te montre quelles classes sont confondues (typiquement
hip ↔ gable).

### 5. Intégration dans HF Space

Pousse `best.onnx` dans le repo :

```bash
mkdir -p huggingface-space/models/
mv ~/Downloads/best.onnx huggingface-space/models/yolov8_obb_toitures_vb_v1.onnx
git add huggingface-space/models/yolov8_obb_toitures_vb_v1.onnx
git commit -m "feat(hf-space): yolov8-obb v1 (24 datasets, mAP50=X.XX)"
git push origin main
```

Le CI auto-deploy va pousser le modèle vers la HF Space dans 3-5 min.

> Note : si le ONNX > 25 Mo (typiquement yolov8n = 12 Mo, yolov8s = 40 Mo),
> utiliser Git LFS ou hébergement HF Models distinct.

L'intégration côté `app.py` se fait dans une étape suivante (voir
`huggingface-space/yolo_obb_inference.py` — à venir Phase B4).

---

## Itération sur les hyperparams

Si la première run a un mAP médiocre, essayer dans cet ordre :

| Symptôme | Action |
|----------|--------|
| Loss train baisse, val plateau → overfit | ↑ `--dropout 0.25`, ↑ augmentation `hsv_*` |
| Loss train ET val plateau haute → underfit | Modèle plus gros (`--model yolov8s-obb.pt`), ↑ `--epochs 250` |
| Classes mineures (tower/shed/flat) ignorées | Class weights → modifier `loss.py` (non standard YOLO) ou doubler ces samples |
| mAP@0.5 OK mais mAP@0.5:0.95 bas | Précision géométrique faible → c'est attendu pour 4-vertex OBB, sera réglé par Phase A (régularisation) |

---

## Métrique cible

Pour considérer le modèle viable en remplacement de v1.6 algorithmique :

- **mAP@0.5 ≥ 0.55** (vs ~0.40 pour v1.6 actuel mesurée via roof_model_diff)
- **Précision ≥ 0.70** sur la classe `hip` (88 % du dataset)
- **Recall ≥ 0.60** sur la classe `hip`
- **Temps inférence CPU ≤ 5 s/image** (HF Space free tier)

Si on atteint ça avec 24 datasets, on a un signal clair que le scaling à 100+
datasets va donner un modèle production-grade.
