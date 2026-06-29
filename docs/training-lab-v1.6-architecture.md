# Architecture v1.6 — Training Lab Toitures VB

Document complet expliquant comment le pipeline `roof_sections v1.6` est intégré
dans le Training Lab, comment il fonctionne aujourd'hui, et comment continuer à
l'entraîner. Écrit pour qu'une autre IA (ou un humain) qui n'a PAS accès au
code puisse comprendre le système de bout en bout.

Date : 2026-05-30
Version v1.6 du pipeline = `sections-1.6.0` (déployée en prod)


## 1. Vue d'ensemble en 30 secondes

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Image satellite + polygone bâtiment                                      │
│                       ↓                                                   │
│  Pipeline Python v1.6 (hébergé sur Hugging Face Space, free CPU)          │
│                       ↓                                                   │
│  JSON sections-1.6.0 (sections kept / alternative / rejected)             │
│                       ↓                                                   │
│  Training Lab → tracer 2D/3D pré-annoté                                   │
│                       ↓                                                   │
│  Humain corrige + valide → RoofModel (truth)                              │
│                       ↓                                                   │
│  Export bundle ZIP (datasets train/val/test + diff)                       │
│                       ↓                                                   │
│  Retraining hors-app (Python scripts) → nouvelle version du pipeline      │
└──────────────────────────────────────────────────────────────────────────┘
```

Le but : générer des datasets annotés par des humains pour entraîner / améliorer
itérativement le pipeline. Chaque humain qui corrige une prédiction crée un
exemple d'entraînement supervisé.


## 2. Les 4 grands composants

### 2.1 Le pipeline Python (le "modèle")

**Où** : repo GitHub `JAVCOCST/webflow-quote-builder`, dossier `huggingface-space/`
Aussi déployé en prod sur Hugging Face : `https://huggingface.co/spaces/JAVCOCST/roof-sections-v16`

**Quoi** : 10 modules Python, 100% algorithmique classique (pas de LLM, pas de
réseau de neurones). Stack :
- `numpy` — math vectorielle
- `opencv-python-headless` (`cv2`) — détection d'arêtes, segmentation image
- `shapely` — opérations sur polygones

**Modules** (ordre d'invocation logique) :
1. `fit_roof_rectangle.py` — calcule l'enveloppe principale du toit
2. `global_axes.py` — détermine les axes principaux (primary/secondary)
3. `ridge_hypotheses.py` — propose des candidats faîtière à partir de l'image
4. `rectangle_from_ridge.py` — convertit chaque faîtière candidate en rectangle structurel
5. `structural_scoring.py` — score chaque rectangle (structural_score, plane_symmetry_score, ridge_visible_score, etc.)
6. `relational_graph.py` — construit un graphe des relations entre sections (parent/child, perpendiculaire, parallèle)
7. `semantic_order.py` — vérifie l'ordre sémantique des sommets
8. `scoring_extra.py` — scores additionnels (rejected_as_gutter, etc.)
9. `structural_selection.py` — applique NMS + cap selon le `selection_mode`
10. `roof_sections.py` — orchestration : appelle tout le monde dans l'ordre

**Entry point** :
```python
from roof_sections import extract_roof_sections
from structural_selection import SelectionConfig

result = extract_roof_sections(
    image_bgr,                                          # numpy array cv2
    roof_type="mixed",                                  # "2_pans" | "4_pans" | "mixed"
    prior_polygon_px=[[x1,y1], [x2,y2], ...],          # ≥3 pts pixels image
    selection_config=SelectionConfig.conservative()    # défaut
)
# → dict avec schema_version "sections-1.6.0" + sections[]
```

### 2.2 Le HF Space (l'API)

**URL publique** : `https://javcocst-roof-sections-v16.hf.space`

**Visibilité** : public (rendu public le 30 mai pour permettre les calls
server-to-server depuis le Training Lab).

**Endpoints** :
- `GET /health` → `{"ok": true, "schema_version": "sections-1.6.0", "ts": <epoch>}`
- `GET /` → bannière minimale
- `POST /roof-sections/v1.6` → exécute le pipeline

**Format POST** :
```json
{
  "image_b64": "data:image/jpeg;base64,...",
  "prior_polygon_px": [[x1,y1], [x2,y2], ...],
  "roof_type": "mixed",
  "selection_mode": "conservative"
}
```

**Réponse** : le dict v1.6 brut du pipeline (voir §3 pour la structure).

**Auth optionnelle** : si la var d'env `SHARED_SECRET` est settée côté Space
(Settings → Repository secrets), les POST doivent inclure
`Authorization: Bearer <SHARED_SECRET>`. Sinon endpoint ouvert (rate-limit HF
s'en occupe).

**Stack runtime** : Docker (Python 3.11-slim + libgl1) + FastAPI + uvicorn
sur port 7860. Fichier `app.py` dans la Space = le wrapper FastAPI.

**Keep-alive** : UptimeRobot ping `/health` toutes les 5 min (free tier) pour
éviter que la Space s'endorme (HF free tier sleep après 48h inactivité, cold
start 30-60s).

### 2.3 Le déploiement automatique

**GitHub Action** : `.github/workflows/deploy-hf-space.yml`

À chaque push sur main qui touche `huggingface-space/**` (ou le workflow
lui-même), l'action :
1. Clone le repo
2. Installe `huggingface_hub` Python
3. Vérifie le token (`HF_TOKEN` dans repo secrets, scope write)
4. `api.upload_folder()` → push tout `huggingface-space/` vers la Space HF
5. HF détecte le push, rebuild le Docker (~3-5 min), redémarre

**Pour itérer sur le pipeline** : modifier les fichiers dans
`huggingface-space/*.py`, commit/push sur main → l'Action redéploie tout
seul. Tu n'as JAMAIS à toucher manuellement la Space.

### 2.4 Le Training Lab (le frontend)

**URL** : `/admin/training-lab`
**Fichier principal** : `src/pages/AdminTrainingLab.tsx`
**Stack** : React + TypeScript + Tailwind, hébergé sur Vercel (Lovable redeploie
à chaque push sur main).

**Vue** : liste de datasets (rows de la table Supabase `training_roof_takeoffs`),
chaque card a :
- Référence + adresse + date
- Image satellite preview
- 2 indicateurs `Lot` / `Bât.` (verts si polygones lot/bâtiment présents, rouges sinon)
- Compteur `0 ann · 0 outils` (legacy, sera ignoré)
- 4 boutons : `Recaler` (calibrage du polygone bâtiment), `Annoter` (ouvre le tracer),
  ⭐ (marque comme bon exemple), ⚠️ (marque comme cas problème),
  ✅ (marque prêt pour entraînement), 🗑️ (supprimer)
- 2 badges status :
  - **StatusPill** : statut du flow (`Brouillon` / `À réviser` / `Corrigé` / `Validé` / `Prêt entraînement` / `Exporté`)
  - **AiStatusBadge** : statut IA (`🪄 Vierge` / `⏳ Génération` / `🤖 IA prête` / `✅ Validé`)


## 3. Le format `sections-1.6.0` (contrat)

C'est LA pièce centrale. Tout le système tourne autour de ce JSON.

### 3.1 Structure haut-niveau

```json
{
  "schema_version": "sections-1.6.0",
  "selection_mode": "conservative",
  "primary_axis_deg": 0.0,
  "secondary_axis_deg": -90.0,
  "detected_typology": "single_addon",
  "sections": [ /* array de sections */ ],
  "n_sections": 4,
  "n_ridges_detected": 3,
  "n_experimental": 3,
  "n_ridge_kept": 1,
  "n_ridge_alternative": 1,
  "n_ridge_rejected": 1,
  "n_rejected_as_gutter": 0,
  "pair_relations": [],
  "n_pair_relations": 0
}
```

### 3.2 Une section individuelle

```json
{
  "id": "S1",
  "role": "main",
  "experimental": false,
  "points": [[80, 100], [660, 100], [660, 460], [80, 460]],
  "ridge_axis_px": [[80, 280], [660, 280]],
  "semantic_order_valid": true,
  "selection_status": "kept",
  "selection_reason": "main envelope — always kept",
  "rejection_reason": null,
  "relationship_type": "main",
  "parent_id": null,
  "group_id": null,
  "top_k_alternatives": [],
  "related_ids": ["R2"],
  "pruned_by": [],
  "structural_score": 0.517,
  "ridge_visible_score": 0.013,
  "plane_symmetry_score": 0.55,
  "ridge_internality_score": 0.306,
  "rejected_as_gutter": false,
  "kept_by_nms": true,
  "roof_type": "2_pans",
  "pitch": 7.0
}
```

### 3.3 LA RÈGLE D'OR — `selection_status`

C'est la SEULE source de vérité d'import. Trois valeurs possibles :

| `selection_status` | Sens | Rendu visuel dans le tracer |
|---|---|---|
| `"kept"` | Section ACTIVE — fait partie de la géométrie validée | Polygone plein, coloré, interactif (S1 bleu, ridges en couleurs distinctes) |
| `"alternative"` | Suggestion fantôme — visible mais HORS géométrie active | Pointillés jaune/gold, non-interactif, ne participe à aucun calcul |
| `"rejected"` | Debug seulement | Caché dans le tracer, juste dispo pour analyse |

**Ne JAMAIS utiliser** `relationship_type`, `parent_id`, `pair_relations`, ou
n'importe quel autre champ pour décider de l'activation. **C'est `selection_status` qui décide. Point.**

S1 (la section principale, `role: "main"`) est TOUJOURS active (`kept`), peu
importe ce qui se passe ailleurs.

### 3.4 Les modes de sélection

Configurables via `selection_config` à l'appel Python ou `selection_mode`
dans le POST de l'API :

| Mode | Cap | Usage |
|---|---|---|
| `conservative()` | 1 fixe | **DÉFAUT** — sites simples, 0 faux positif garanti |
| `normal()` | 2 fixe | dormer, volumes parallèles connus |
| `complex()` | 4 fixe | toiture en L/T, multi-wing |
| `cross()` | 6 fixe | toiture en croix, 4+ ailes |
| `adaptive()` | auto | typology-driven (compte les relations perpendiculaires) |

**En prod aujourd'hui** : `conservative` est hardcodé dans le bridge
TypeScript (`src/lib/training-lab-mvp-bridge.ts`). Si tu veux tester un autre
mode, il faut modifier le call ou exposer un dropdown UI.


## 4. Le pipeline app — flow exact "Annoter"

Quand l'utilisateur clique le bouton **Annoter** sur une row du Training Lab :

```
handler: onAnnoterClick(row)
  │
  ├── CAS 1 : row.roof_model existe
  │    → setAnnotating(row) → ouvre tracer avec roof_model human_corrected
  │    → AUCUN appel IA (safety guard absolu : ne jamais écraser truth humaine)
  │
  ├── CAS 2 : row.roof_sections_v16 existe (mais pas roof_model)
  │    → setAnnotating(row) → ouvre tracer avec la pré-annotation IA existante
  │    → AUCUN re-call IA
  │
  ├── CAS 3 : les deux absents
  │    → fetch image satellite via raw_image_url
  │    → blob → base64
  │    → projette le polygone bâtiment lat/lng → coords image-px
  │       (formule Mercator identique à Google Static Maps)
  │    → POST {image_b64, prior_polygon_px, roof_type, selection_mode: "conservative"}
  │       à https://javcocst-roof-sections-v16.hf.space/roof-sections/v1.6
  │    → reçoit le JSON sections-1.6.0
  │    → valide schema_version
  │    → UPDATE training_roof_takeoffs SET roof_sections_v16 = <json> WHERE id = ...
  │    → setAnnotating(rowAvecV16) → ouvre tracer avec pré-annotation visible
  │
  └── CAS 4 : IA échoue (timeout, 500, polygone invalide)
       → toast "Pré-annotation IA indisponible : <message>"
       → setAnnotating(row) → ouvre tracer vide (l'utilisateur peut dessiner manuellement)
```

**Bridge code** : `src/lib/training-lab-mvp-bridge.ts`
- `runMvpV16Prediction(args)` — fonction principale
- `latLngToImagePx(lat, lng, centerLat, centerLng, zoom)` — projection Mercator
- `extractOuterRing(geo)` — accepte Polygon, MultiPolygon, Feature, FeatureCollection, et string JSON-encoded (Supabase peut renvoyer jsonb comme string parfois)
- `buildPriorPolygonPx(geojson, map_params)` — wrapper qui combine les 2


## 5. Schéma DB (table `training_roof_takeoffs`)

Colonnes clés pour le flow v1.6 :

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid | PK |
| `reference` | text | ex. `VB-B9C9A335-5D0` |
| `address` | text | adresse géocodée |
| `raw_image_url` | text | URL Google Static Maps de l'image satellite |
| `original_building_geojson` | jsonb | polygone bâtiment importé (lat/lng) |
| `corrected_building_geojson` | jsonb | polygone bâtiment recalé par humain via CalibrationEditor |
| `original_lot_geojson` | jsonb | polygone lot importé |
| `corrected_lot_geojson` | jsonb | polygone lot recalé |
| `annotations_json` | jsonb | legacy (contient `map_params.{centerLat,centerLng,zoom}`) |
| **`roof_sections_v16`** | **jsonb** | **Pré-annotation IA générée par le pipeline v1.6** |
| **`roof_model`** | **jsonb** | **Truth humaine après correction dans le tracer** |
| **`roof_model_diff`** | **jsonb** | **Diff calculé entre roof_sections_v16 et roof_model** |
| `quality_score` | float | 0..1, auto-rempli depuis `1 - correction_weight` du diff |
| `dataset_status` | text | flow state (voir §6) |
| `tags` | text[] | `good_example`, `problem_case` |
| `human_notes` | text | notes libres |
| `export_batch_id` | uuid | référence le batch ZIP qui a inclus ce dataset |

**Migration v1.6** : `supabase/migrations/20260530141155_training_lab_roof_model_columns.sql`
ajoute les colonnes `roof_model`, `roof_sections_v16`, `roof_model_diff`.


## 6. Le flow `dataset_status` (machine à états)

```
            (création depuis soumission)
                       ↓
                   ┌────────┐
                   │ draft  │ ← entry point
                   └───┬────┘
                       │
                  (recalibrage)
                       ↓
                  ┌──────────┐
                  │ corrected│ ← CalibrationEditor save
                  └───┬──────┘
                       │
              (annotation tracer + Valider)
                       ↓
                  ┌──────────┐
                  │ validated│ ← roof_model écrit
                  └───┬──────┘
                       │
            (marquage manuel "prêt")
                       ↓
              ┌────────────────────┐
              │ ready_for_training │
              └─────────┬──────────┘
                        │
                  (export bundle ZIP)
                        ↓
                   ┌──────────┐
                   │ exported │
                   └──────────┘

  + 2 états parallèles : "needs_review" (à réviser manuellement),
                          "calibration_issue" (polygone bâtiment foireux),
                          "rejected" (mis de côté).
```


## 7. Comment ON ENTRAÎNE — le workflow réel

Le système ne fait PAS de retraining automatique. Il génère des **datasets
labellisés par humain** que tu utilises HORS app pour réentraîner.

### 7.1 Boucle d'amélioration

1. **Ingestion** : nouvelles soumissions importées via `importFromSoumissions()` →
   crée des rows en `dataset_status: 'draft'` avec `raw_image_url`,
   `original_building_geojson`, `annotations_json.map_params`.
2. **(Optionnel) Recalage** : opérateur ouvre CalibrationEditor pour aligner
   le polygone bâtiment sur l'image satellite si besoin. Save → status `corrected`.
3. **Pré-annotation IA** : opérateur clique **Annoter** → CAS 3 fire → l'IA v1.6
   génère sa prédiction → `roof_sections_v16` rempli, badge `🤖 IA prête`.
4. **Correction humaine** : tracer 3D s'ouvre avec la prédiction visible.
   L'opérateur déplace les points, ajuste les arêtes, supprime les fausses
   sections, promeut les alternatives pertinentes. Click **Valider** →
   `roof_model` rempli (truth corrigée), `roof_model_diff` calculé en parallèle
   (compare v1.6 vs human), `quality_score` auto = `1 - correction_weight`,
   status → `validated`.
5. **Triage qualité** : opérateur tag `good_example` ⭐ ou `problem_case` ⚠️
   selon l'utilité du cas pour l'entraînement.
6. **Marquage prêt** : click ✅ → status → `ready_for_training`.
7. **Export batch** : depuis le top de la page Training Lab, bouton
   `Exporter`. Génère un ZIP via `buildBundleZip()` dans `src/lib/training-lab.ts`.

### 7.2 Contenu du bundle ZIP

```
takeoffs.zip
├── manifest.json                  ← schema_version "training_lab/1.0.0",
│                                     liste datasets, splits train/val/test,
│                                     correction_weight par dataset
├── metadata.json                  ← legacy, kept pour back-compat
└── takeoffs/
    └── <reference>/               ← un dossier par dataset
        ├── raw_image.jpg          ← image satellite originale
        ├── annotated_image.jpg    ← idem avec annotations human
        ├── debug_overlay.jpg      ← overlay debug (currently hybrid map)
        ├── takeoff.json           ← metadata légère (ref, address, geojsons, pointeurs)
        ├── roof_model.json        ← TRUTH HUMAINE (target d'entraînement)
        ├── roof_sections_v16.json ← input IA brut (la prédiction non corrigée)
        ├── diff.json              ← RoofModelDiff calculé (signal de correction)
        ├── calibration_report.json
        ├── notes.md
        └── validation_report.json
```

**Splits** : 70% train / 15% val / 15% test, deterministic par hash de `t.id`
(même dataset = même split à travers les exports). Voir
`splitFor(t)` dans `src/lib/training-lab.ts`.

### 7.3 Ce que tu fais avec le bundle (HORS app)

C'est ICI que tu réentraînes. L'app ne s'en occupe pas. Workflow typique :

1. Tu télécharges le ZIP.
2. Sur ta machine / serveur ML, tu écris un script Python qui :
   - Lit `manifest.json` pour la liste des datasets et leur split.
   - Pour chaque dataset train :
     - Charge `raw_image.jpg` comme image input
     - Charge `roof_model.json` comme target (la truth)
     - Optionnellement `roof_sections_v16.json` comme baseline prediction
     - Optionnellement `diff.json` pour pondérer les cas où l'IA s'est plantée
       (`correction_weight` haut = cas où l'humain a beaucoup corrigé = à
       up-weighter pendant l'entraînement = hard-negative mining).
3. Tu fais évoluer ton pipeline Python — par ex :
   - Ajustes les seuils dans `structural_scoring.py`
   - Ajoutes des features dans `structural_selection.py`
   - Change la logique de NMS dans `structural_selection.py`
4. Tu valides la nouvelle version contre le split val.
5. Si meilleurs scores → tu écris la nouvelle version dans
   `huggingface-space/` du repo et tu commit/push.
6. GitHub Action redéploie automatiquement la Space → la prod tourne sur la
   nouvelle version dans 3-5 min.
7. Tous les futurs clics "Annoter" utilisent la nouvelle version.

### 7.4 Le diff `RoofModelDiff` (signal de correction)

Calculé par `diffV16VsRoofModel(v16, model)` dans `src/lib/training-lab-diff.ts`.
Structure :

```typescript
{
  section_count_v16: 4,
  section_count_human: 3,
  sections_added: 0,      // sections que l'humain a créé en plus
  sections_removed: 1,    // sections IA que l'humain a supprimées
  sections_modified: 1,   // sections paired où la géom a bougé
  iou_overall: 0.82,      // IoU global v1.6 kept vs human active
  iou_per_section: { "S1": 0.95, "R2": 0.71 },
  pitch_delta_mean_deg: 1.3,
  coverage_pct_v16: 0.87,
  coverage_pct_human: 0.91,
  correction_weight: 0.18  // 0 = match parfait, 1 = redraw total
}
```

C'est ce `correction_weight` qui devient `quality_score = 1 - correction_weight`
auto. Plus c'est haut, plus l'IA était bonne sur ce cas. Plus c'est bas, plus
le cas est intéressant pour l'entraînement.


## 8. Comment tester localement

### 8.1 Tester la Space HF directement

```bash
# Health check
curl https://javcocst-roof-sections-v16.hf.space/health
# → {"ok":true,"schema_version":"sections-1.6.0","ts":...}

# Prédiction (image factice juste pour le shape)
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "image_b64": "data:image/jpeg;base64,<...>",
    "prior_polygon_px": [[100,100],[600,100],[600,600],[100,600]],
    "roof_type": "mixed",
    "selection_mode": "conservative"
  }' \
  https://javcocst-roof-sections-v16.hf.space/roof-sections/v1.6
```

### 8.2 Smoke test bout-en-bout

1. Ouvrir `/admin/training-lab` (admin connecté).
2. Identifier une row avec badge `🪄 Vierge` ET indicateurs Lot/Bât. VERTS.
3. Cliquer `Annoter`.
4. Toast `🪄 Génération pré-annotation IA v1.6…` apparaît.
5. Attendre 10-30s (15-60s si cold start).
6. Tracer 3D s'ouvre avec polygone visible.
7. Si plante → toast d'erreur détaillé (10s d'affichage).


## 9. Limitations actuelles (à connaître)

- **Selection mode hardcoded à `conservative`** dans le bridge. Pas d'UI pour
  changer. C'est intentionnel : conservative garantit 0 faux positif. Si tu
  veux plus de sections détectées, faut modifier `runMvpV16Prediction` dans
  `src/lib/training-lab-mvp-bridge.ts` ligne ~140.
- **roof_type forcé à "mixed"** côté bridge. La table `training_roof_takeoffs`
  n'a pas de colonne `roof_type` dédiée, et l'extraire de `annotations_json.seed.coverage_type`
  demanderait un mapping (membrane/élastomère/etc. → "2_pans"/"4_pans"/"mixed").
  Pas fait, c'est probablement une amélioration utile.
- **Pas de retry auto sur cold start**. Si l'appel timeout > 60s (HF Space
  dormait), l'utilisateur voit un toast d'erreur et doit cliquer Annoter à
  nouveau. UptimeRobot mitige ce cas mais pas à 100%.
- **Pas de queue / async pattern**. L'appel est synchrone, le tracer attend.
  Pour des batchs (annoter 50 datasets d'un coup), il faudrait implémenter
  une queue. Pas fait.
- **Pas de fine-tuning automatique**. La boucle de retraining est manuelle
  (cf. §7.3). C'est volontaire — l'app reste un outil de capture, le ML
  reste à l'opérateur.
- **`debug_overlay_url`** = juste l'image hybrid Google Maps, pas un vrai
  overlay de debug labellé. Audit §10 — chantier futur.


## 10. Comment améliorer le pipeline (workflow concret)

Tu veux ajuster un seuil, ajouter un check, fixer un bug du pipeline ?

```bash
# 1. Modifier les fichiers Python dans huggingface-space/
git checkout -b claude/v16-pipeline-tweak
vim huggingface-space/structural_selection.py
# ... édite ...

# 2. Commit + push
git add huggingface-space/
git commit -m "fix(v16): adjust NMS threshold for narrow buildings"
git push -u origin claude/v16-pipeline-tweak

# 3. PR → merge → main
gh pr create --base main
# review, merge

# 4. GitHub Action démarre automatiquement (workflow file :
#    .github/workflows/deploy-hf-space.yml)
# 5. ~30s plus tard, la Space HF reçoit le push
# 6. HF rebuild le Docker (~3-5 min)
# 7. La nouvelle version est live, tous les nouveaux "Annoter" l'utilisent
```

**Versionner le pipeline** : si tu fais un changement breaking, change
`schema_version` dans `roof_sections.py` ET dans `app.py` (constante
`SCHEMA_VERSION`). L'adapter TypeScript `fromRoofSectionsV16.ts` rejettera
tout JSON qui n'est pas `"sections-1.6.0"` — tu auras besoin d'un nouvel
adapter (`fromRoofSectionsV17.ts`) si tu changes la structure.


## 11. Fichiers clés à connaître

| Fichier | Rôle |
|---|---|
| `huggingface-space/app.py` | Wrapper FastAPI autour du pipeline Python |
| `huggingface-space/roof_sections.py` | Orchestrateur Python (entry point) |
| `huggingface-space/structural_selection.py` | Logique kept/alternative/rejected + SelectionConfig |
| `huggingface-space/Dockerfile` | Image runtime (Python 3.11 + opencv) |
| `huggingface-space/requirements.txt` | Deps Python (numpy, opencv-headless, shapely, fastapi) |
| `.github/workflows/deploy-hf-space.yml` | Auto-deploy GitHub → HF Space |
| `src/lib/training-lab-mvp-bridge.ts` | Bridge browser→HF Space (Mercator, fetch, validation) |
| `src/lib/training-lab-mvp-bridge.test.ts` | 15 tests vitest verts |
| `src/lib/roof-core/adapters/fromRoofSectionsV16.ts` | Adapter v1.6 → RoofModel canonique (CONTRAT FIGÉ, 14 tests verts) |
| `src/lib/training-lab-diff.ts` | Calcul du RoofModelDiff (signal de correction) |
| `src/lib/training-lab.ts` | Domain : export bundle, validation, filtres, splits |
| `src/pages/AdminTrainingLab.tsx` | Page React (liste datasets, boutons, badges) |
| `src/pages/AdminRoofStudio.tsx` | Tracer 2D/3D — l'éditeur géométrique (LISTE INTERDITE, ne pas toucher) |
| `supabase/migrations/20260530141155_*.sql` | Migration colonnes roof_model + roof_sections_v16 + roof_model_diff |


## 12. Pour récapituler en une image mentale

Le système est en réalité **3 systèmes orthogonaux** qui communiquent via
des contrats simples :

1. **Le pipeline Python** (HF Space) — un programme qui prend une image +
   un polygone et retourne du JSON `sections-1.6.0`. **C'est le "modèle".**
   Il évolue indépendamment de l'app : tu améliores son code, tu pushs,
   ça redéploie tout seul.
2. **Le Training Lab** (React + Supabase) — un outil de capture de truth.
   Il appelle le modèle, montre la prédiction, laisse l'humain corriger,
   stocke la truth. **C'est le "labelleur".**
3. **L'export bundle** (ZIP) — le pont entre l'app et ton workflow ML
   externe. **C'est le "snapshot d'entraînement".**

Le `schema_version: "sections-1.6.0"` est le CONTRAT qui les fait tenir
ensemble. Tant qu'il est stable, les 3 peuvent évoluer indépendamment.


---

Pour toute question concrète sur un comportement, le code source est la
référence. Ce document décrit l'intent et l'architecture ; le code décrit
l'implémentation exacte.
