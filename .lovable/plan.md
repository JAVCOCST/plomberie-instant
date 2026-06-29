# Training Lab Toiture — Plan d'implémentation

Module séparé pour préparer et exporter des bundles d'entraînement IA toiture, sans toucher au flux soumission existant.

## 1. Base de données (migration Supabase)

Nouvelle table `training_roof_takeoffs` :

```
id uuid pk
source_takeoff_id uuid (ref soumissions.id, nullable)
reference text
address text
raw_image_url text
annotated_image_url text
debug_overlay_url text
json_url text
original_building_geojson jsonb
corrected_building_geojson jsonb
original_lot_geojson jsonb
corrected_lot_geojson jsonb
annotations_json jsonb
calibration_status text  -- pending|ok|issue
calibration_offset_px jsonb  -- {dx, dy}
calibration_offset_m jsonb
calibration_rotation_deg numeric default 0
calibration_scale numeric default 1
calibration_confidence numeric
calibration_notes text
dataset_status text default 'draft'
  -- draft|needs_review|calibration_issue|corrected|ready_for_training|exported|rejected
quality_score numeric
tags text[] default '{}'
human_notes text
export_batch_id uuid
created_at, updated_at timestamptz
```

+ RLS `authenticated` ALL.
+ Bucket Storage `training-assets` (privé, signedUrl) pour images générées et ZIP.
+ Table `training_export_batches` (id, created_at, created_by, takeoff_ids uuid[], bundle_url, status, schema_version).

## 2. Routing & sidebar

- `src/App.tsx` : route `/admin/training-lab` (lazy).
- `src/pages/AdminLayout.tsx` : entrée nav `Training Lab Toiture` (icône `FlaskConical`).
- Page `src/pages/AdminTrainingLab.tsx` qui orchestre la liste + le détail (panneau latéral ou route imbriquée `/admin/training-lab/:id`).

## 3. Composants

```
src/components/training-lab/
  TakeoffsTable.tsx        -- table filtrable (filtres + tags + statut + score)
  FiltersBar.tsx           -- Tous / Valides / À corriger / Calibration / Footprint / Image / JSON / Ready
  TakeoffRowActions.tsx    -- ouvrir, marquer bon/problème/ne pas utiliser, tags, notes
  CalibrationEditor.tsx    -- canvas SVG/Konva: ortho fond + polygons + annotations
                              drag building, drag lot, rotation, scale, offset readouts
                              centroid building vs annotations, % points in footprint
  BatchImageGenerator.tsx  -- multi-select + génération images manquantes (canvas → PNG → Storage)
  ExportBundleDialog.tsx   -- sélection + validation + génération ZIP (jszip)
  hooks/useTrainingTakeoffs.ts
  hooks/useCalibration.ts
  lib/overlayRenderer.ts   -- dessine polygons sur image, retourne Blob
  lib/validateBundle.ts
  lib/zipBundle.ts         -- assemble /metadata.json + /takeoffs/REF/*
```

## 4. Génération d'images (client-side)

Pour chaque takeoff sélectionné :
1. Charger `raw_image_url` dans un `<img>` (CORS) → `OffscreenCanvas`.
2. Projeter les polygons (GeoJSON lat/lng) vers pixels via bbox de l'image (ou via calibration stockée).
3. Rendre 4 overlays : lot, building, annotations, debug (centroids + offsets).
4. Upload PNG dans `training-assets/{takeoff_id}/...`, update colonnes URL.

Si polygons absents : tirer depuis `batiment_avec_lot` via RPC existante en se basant sur lat/lng de la soumission.

## 5. Recalage manuel

`CalibrationEditor` :
- Image en fond, polygons en SVG overlay.
- Drag-to-translate building / lot (Shift = rotation, Alt = scale).
- Affichage live : offset px, offset m (via `pixelsPerMeter` calibration), rotation°, scale, confidence (slider).
- Bouton **Sauvegarder** → écrit `corrected_*_geojson` + `calibration_*`, ne touche jamais à `original_*`.
- Bouton **Reset** rétablit à `original_*`.
- Calcul "% points annotations dans footprint" via point-in-polygon (turf-lite custom, pas de dep si possible).

## 6. Export ZIP

Lib : `jszip` (ajout dépendance).

Validation préalable (bloquante sauf override "Forcer") :
- raw + annotated + json + building + lot + annotations + calibration_status + offset + quality_score.

Structure produite :
```
metadata.json
takeoffs/<REFERENCE>/
  raw_image.jpg
  annotated_image.jpg
  debug_overlay.jpg
  takeoff.json           -- annotations + geojson original/corrected
  calibration_report.json
  notes.md               -- human_notes + tags
```

`metadata.json` : `{ exported_at, schema_version: "1.0.0", count, references[], quality_summary, description }`.

ZIP uploadé dans `training-assets/bundles/{batch_id}.zip` + lien signé proposé en téléchargement.

## 7. Statuts & filtres

Filtres = preset queries sur `dataset_status` + heuristiques (manque image / manque JSON / footprint douteux = score < seuil).

Actions ligne : changer statut, ajouter notes, tags, "bon exemple" / "cas problème" / "ne pas utiliser" (tags réservés `good_example`, `problem_case`, `do_not_use`).

## 8. Isolation

- Aucun import ni modification dans `AdminQuoteGenerator`, `ContractSignatureStep`, flow soumission.
- Lecture seule sur `soumissions` pour seeder (bouton "Importer takeoffs depuis soumissions").
- Toutes les écritures vont dans `training_roof_takeoffs` / `training_export_batches`.

## 9. Étapes de livraison (dans cet ordre)

1. Migration tables + bucket + RLS.
2. Sidebar entry + route + page coquille.
3. Hook + table + filtres (lecture).
4. Import depuis `soumissions` (seed initial).
5. CalibrationEditor + sauvegarde correction.
6. BatchImageGenerator (canvas + upload).
7. Validation + ExportBundleDialog (jszip).
8. Polish (tags, notes, "bon exemple" etc).

## Hors scope (explicite)

- Pas de modèle IA, pas de straight skeleton, pas de pipeline serveur d'entraînement.
- Pas de modification du flow de soumission ni du contrat.
