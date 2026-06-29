# Briefing builder — Training Lab pour entraînement IA

> **Destinataire : Claude principal (builder).**
> **Émetteur : Claude architecte/auditeur.**
> **But : transformer le diagnostic Training Lab en instructions actionnables pour que la
> pipeline soit réellement capable d'entraîner et d'améliorer l'IA d'annotation.**

Date : 2026-05-30 · Branche audit : `claude/quote-roofmodel-audit-aXRf5`
Périmètre : `src/lib/training-lab.ts`, `src/pages/AdminTrainingLab.tsx`,
`src/lib/roof-core/adapters/fromRoofSectionsV16.ts`,
`src/components/training-lab/*`, migrations Supabase.

---

## 0. Mission en une phrase

Réparer les **3 fractures structurelles** qui empêchent aujourd'hui le Training Lab de
servir d'amont d'entraînement, puis ajouter le minimum de **rigueur ML** (split, diff,
métriques) pour que l'IA puisse **s'améliorer mesurablement**.

---

## 1. À lire avant d'écrire la première ligne (ordre imposé)

1. **Ce document** (priorités, périmètre, contraintes).
2. **`docs/quote-roofmodel-research-findings.md` §3.2** — confirme que les colonnes
   `roof_model` / `roof_sections_v16` n'existent pas dans les migrations ni dans les
   types générés. Le présent briefing part de là.
3. **`src/lib/training-lab.ts`** — module de domaine (export, validation, filtres,
   builders d'annotations). Source de vérité côté code.
4. **`src/pages/AdminTrainingLab.tsx:163-300`** — wiring lab ↔ tracer ↔ DB.
5. **`src/lib/roof-core/adapters/fromRoofSectionsV16.ts`** — adapter MVP → `RoofModel`,
   contrat à respecter (en-tête du fichier).

---

## 2. Diagnostic résumé (les 3 fractures)

| # | Fracture | Symptôme | Conséquence pour l'IA |
|---|---|---|---|
| F1 | **Schéma hors-migration** : `roof_model` et `roof_sections_v16` lues/écrites par le code mais absentes des migrations + de `types.ts`. | Colonnes ajoutées à la main dans Supabase Studio (hypothèse). Tout nouvel env / restore / `db reset` les perd. | Perte silencieuse de la vérité humaine corrigée. |
| F2 | **Vérité corrigée hors-bundle** : `buildBundleZip` (`training-lab.ts:340-423`) exporte `annotations_json` (legacy) **mais pas `roof_model`**. | Le ZIP envoyé à l'entraînement contient les annotations legacy, pas les corrections du tracer. | L'IA s'entraîne sur du legacy, pas sur ta vérité → aucun apprentissage des corrections. |
| F3 | **Pas de boucle de retraining** : aucun script d'entraînement, aucun versioning de modèle, aucun split train/val/test, aucune métrique d'amélioration. | Tu peux exporter mille bundles, aucun moyen de prouver que le prochain modèle est meilleur. | Pas d'amélioration mesurable possible. |

---

## 3. Objectifs vérifiables (Definition of Done)

| Goal | Mesurable comment |
|---|---|
| **G1 — Schéma reproductible** | `supabase db reset` + replay migrations → `roof_model` et `roof_sections_v16` présents, types regénérés, `as any` retirés. |
| **G2 — Boucle de feedback réelle** | Un dataset annoté dans le tracer → ZIP exporté contient `roof_model.json` à jour. Diff v1.6 ↔ corrigé persisté en DB. |
| **G3 — Amélioration mesurable** | Bundle contient `manifest.json` avec `split: train|val|test`. Métriques d'écart v1.6 ↔ corrigé exportées. Au moins un script de validation modèle (IoU sur val) en place. |

---

## 4. Vague A — Réparer les fractures (P0, à livrer en premier)

**Effort cible : 1–2 jours.** Sans ça, le reste est sur du sable.

### 4.1 Fichiers à créer
- **`supabase/migrations/<ts>_training_lab_roof_model_columns.sql`** — migration qui :
  ```sql
  ALTER TABLE public.training_roof_takeoffs
    ADD COLUMN IF NOT EXISTS roof_model jsonb,
    ADD COLUMN IF NOT EXISTS roof_sections_v16 jsonb,
    ADD COLUMN IF NOT EXISTS roof_model_diff jsonb;   -- F3 : diff persistant
  CREATE INDEX IF NOT EXISTS idx_trt_roof_model_status
    ON public.training_roof_takeoffs(dataset_status)
    WHERE roof_model IS NOT NULL;
  ```
  RLS : même politique que les colonnes existantes (vérifier que les `policies` actuelles
  s'appliquent aux nouvelles colonnes ; sinon, étendre).

- **`src/lib/training-lab-diff.ts`** — module pur :
  ```ts
  export interface RoofModelDiff {
    section_count_v16: number;
    section_count_human: number;
    sections_added: number;
    sections_removed: number;
    sections_modified: number;
    iou_overall: number;            // 0..1
    iou_per_section: Record<string, number>;
    pitch_delta_mean_deg: number;
    coverage_pct_v16: number;
    coverage_pct_human: number;
    correction_weight: number;      // 0..1 — heuristique pour quality_score auto
  }
  export function diffV16VsRoofModel(v16: any, model: RoofModel): RoofModelDiff;
  ```
  Tests : `src/lib/training-lab-diff.test.ts` (au moins : zéro diff, ajout d'une section,
  pitch modifié, polygone redessiné, sections rejetées promues).

### 4.2 Fichiers à modifier (chirurgical)

#### `src/lib/training-lab.ts`
- **`buildBundleZip` (`:340-423`)** : ajouter au `dir` de chaque takeoff :
  ```ts
  if (t.roof_model) dir.file('roof_model.json', JSON.stringify(t.roof_model, null, 2));
  if (t.roof_sections_v16) dir.file('roof_sections_v16.json',
    JSON.stringify(t.roof_sections_v16, null, 2));
  if (t.roof_model_diff) dir.file('diff.json',
    JSON.stringify(t.roof_model_diff, null, 2));
  ```
  Mettre à jour le `takeoff.json` pour inclure une référence aux noms de fichiers
  (`{ roof_model_file: 'roof_model.json', ... }`).
  **Conserver `annotations_json` en parallèle** pour ne pas casser un consommateur amont
  qui en dépendrait. C'est additif.
- **`validateTakeoffForExport` (`:247-289`)** : exiger `t.roof_model` (au moins une
  `sections[]`). Refuser l'export si truth humaine absente. Garde-fou explicite.
- **Ajouter `splitFor(t): 'train'|'val'|'test'`** — déterministe par hash de `t.id` :
  - hash modulo 100 ∈ [0, 70) → train, [70, 85) → val, [85, 100) → test.
  - Stable : même ID = même split à travers les exports.
- **`buildBundleZip`** écrit un `manifest.json` racine enrichi :
  ```json
  {
    "version": "1.0.0",
    "exported_at": "...",
    "schema_version": "training_lab/1.0.0",
    "datasets": [
      { "reference": "...", "id": "...", "split": "train", "quality_score": 0.84,
        "has_roof_model": true, "has_diff": true, "correction_weight": 0.42 }
    ],
    "splits": { "train": 70, "val": 15, "test": 15 }
  }
  ```

#### `src/pages/AdminTrainingLab.tsx`
- **Save tracer (`:186`)** : après écriture de `roof_model`, calculer
  `diffV16VsRoofModel(row.roof_sections_v16, model)` et l'écrire dans `roof_model_diff` en
  même temps. Garder l'écriture atomique :
  ```ts
  const diff = diffV16VsRoofModel(row.roof_sections_v16, model);
  await updateRow(row.id, {
    roof_model: model,
    roof_model_diff: diff,
    quality_score: row.quality_score ?? diff.correction_weight,  // auto si null
    dataset_status: 'validated',
  });
  ```
- **Set automatique de `debug_overlay_url`** à l'ingestion (ou au premier render du
  tracer si manquant) — sinon `validateTakeoffForExport` rejette tout.

#### `src/integrations/supabase/types.ts`
- **Regénérer** après application de la migration via Supabase CLI :
  `supabase gen types typescript --project-id … > src/integrations/supabase/types.ts`.
- Retirer les `as any` et `as Partial<TrainingTakeoff>` autour de `roof_model` /
  `roof_sections_v16` une fois les types présents.

### 4.3 Contraintes Vague A
- **Ne casse pas `buildRichAnnotations`** ni `annotations_json` — restent dans le bundle
  pour compat amont. Ajouts purs.
- **Ne touche pas l'adapter v1.6** (`fromRoofSectionsV16.ts`) ni les 14 tests. Contrat
  documenté en tête du fichier = invariant.
- **Ne touche pas `AdminRoofStudio`** ni `roof-core/engine.ts`.
- Les nouvelles colonnes sont **nullable** : aucune row existante ne casse.

### 4.4 Tests d'acceptance Vague A
1. `supabase db reset && supabase db push` → colonnes présentes ; `select roof_model from
   training_roof_takeoffs limit 1` n'erreure pas.
2. Annoter un dataset dans le tracer → en DB : `roof_model` rempli, `roof_model_diff`
   rempli, `dataset_status = 'validated'`, `quality_score` rempli si initialement null.
3. Exporter un batch de 10 datasets → ZIP contient `roof_model.json` +
   `roof_sections_v16.json` + `diff.json` dans chaque dossier ; `manifest.json` racine
   contient `split` et `correction_weight` par dataset ; répartition ≈ 70/15/15.
4. `validateTakeoffForExport` refuse un takeoff sans `roof_model` même si `validated`.
5. Tests `training-lab-diff.test.ts` verts (au moins 5 cas).
6. Tests adapter v1.6 toujours 14/14 verts.
7. Aucun `as any` restant autour des nouvelles colonnes.

---

## 5. Vague B — Rigueur ML & opérations (P1)

**Effort cible : 2–3 jours.** Polish opérationnel + signaux d'apprentissage.

### 5.1 Fichiers à créer
- **`src/lib/training-lab-quality.ts`** :
  ```ts
  // Score auto basé sur diff + complétude + calibration.
  export function computeQualityScoreAuto(t: TrainingTakeoff): number; // 0..1
  ```
  Heuristique : pondération `(1 - correction_weight) * 0.6 + completeness * 0.3 +
  calibration_confidence * 0.1`. Documentée dans le code.

### 5.2 Fichiers à modifier
- **`AdminTrainingLab.tsx`** :
  - **Transition auto `draft → needs_review` à l'ingestion** d'un v1.6 (déclenchée
    quand `roof_sections_v16` passe de null à non-null).
  - **Retirer le statut `corrected`** des dropdowns (ou le câbler à un 2e relecteur,
    mais en l'état il pollue). Migration de données : `update training_roof_takeoffs set
    dataset_status = 'validated' where dataset_status = 'corrected'`.
  - **Bouton « Recalculer score auto »** par row (utilise `computeQualityScoreAuto`).
  - **Bulk-action toolbar** : checkbox par row + actions « Marquer prêt »,
    « Exporter sélection », « Tagger ». Le filtrage existe déjà (`training-lab.ts:247-262`).
  - **KPIs en haut du dashboard** : counts par statut, délai moyen
    `created_at → validated`, taux de rejet, `correction_weight` moyen.
- **`training-lab.ts`** :
  - `validateTakeoffForExport` : si `quality_score` null, appeler
    `computeQualityScoreAuto(t)` au lieu de refuser. Logger les scores auto vs manuels
    dans le bundle.
- **`src/components/training-lab/`** : nouvelle vue **DiffViewer** (côte à côte v1.6 vs
  corrigé) — utilise `t.roof_model_diff` + rendu visuel (svg overlay des deux polygones).

### 5.3 Tests d'acceptance Vague B
1. Importer un nouveau v1.6 → `dataset_status = 'needs_review'` automatiquement.
2. Bulk-export 20 datasets en 1 clic.
3. Score auto calculé pour les rows sans saisie manuelle ; visible dans le tableau.
4. DiffViewer affiche les écarts pour un dataset corrigé.
5. KPIs cohérents avec les counts réels.

---

## 6. Vague C — Boucle d'entraînement (P1, peut être différée)

**Effort cible : variable, dépend du choix d'architecture ML.** Hors scope de l'app web
si tu sors l'entraînement dans un service séparé.

### 6.1 Ce qui doit exister hors de cette app
- **Script d'entraînement** (`/training/` repo séparé ou même repo, dossier dédié) qui :
  - Consomme un ZIP exporté.
  - Charge `split: train|val|test` depuis `manifest.json`.
  - Entraîne un modèle de segmentation ou de prédiction polygonale (à arbitrer).
  - Versionne le modèle en sortie (`models/v0.1.0/`, `v0.2.0/`…).
- **Banc de test** : sur le split `test`, calcule IoU moyen + per-section ; refuse une
  release modèle si régression vs version précédente.
- **Hard-negative mining** : top-20 datasets avec `correction_weight` le plus élevé →
  jeu de validation prioritaire pour la prochaine itération.
- **Re-ingestion** : quand un nouveau modèle est promu, ré-exécuter l'inférence v1.7 sur
  tous les datasets `ready_for_training` et stocker le résultat → re-comparer avec
  `roof_model` humain → mesure d'amélioration.

### 6.2 Ce qui doit exister dans cette app
- **`training_model_releases` table** (Vague C, migration séparée) : `version`,
  `released_at`, `notes`, `metrics_json`, `bundle_id` (FK vers `training_export_batches`).
- **Vue « Releases »** dans le lab : IoU par version, dataset par dataset, diff
  d'amélioration.
- **Action « Ré-évaluer cette row avec le modèle v… »** : appelle un edge function qui
  lance l'inférence sur l'image et compare au `roof_model` humain.

> **Décision à prendre avec toi** : Vague C peut être livrée par le builder, ou
> externalisée à une équipe ML, ou différée. Je recommande de **valider Vague A et B
> avant** de poser ces fondations — sinon on bâtit sur F1/F2/F3.

---

## 7. Liste interdite (NE PAS TOUCHER en Vagues A+B)

- **`src/lib/roof-core/*`** : moteur géométrique, type `RoofModel`. Aucune modif.
- **`src/lib/roof-core/adapters/fromRoofSectionsV16.ts`** : adapter MVP — contrat figé
  documenté en tête. 14 tests doivent rester verts.
- **`src/pages/AdminRoofStudio.tsx`** : le tracer reste la seule UI d'annotation. Le lab
  est un shell autour.
- **`src/components/training-lab/CalibrationEditor.tsx`** : non audité, pas de modif
  sans GO.
- **`buildRichAnnotations` et `annotations_json`** : conservés pour compat amont.
- **Types `RoofSectionInput` et la convention pixels** (points en pixels image, pas
  lat/lng) : invariants.
- **Règle « S1 toujours actif »** : invariant contractuel, ne pas dégrader.
- **`roof_sections_v16` immutable** côté lab : seul `roof_model` évolue.

---

## 8. Feature flag & rollback

- Pas de flag pour la migration (additive nullable, rollback = `DROP COLUMN`).
- Flag `VITE_TRAINING_LAB_V2` pour les changements UI (transitions auto, bulk, diff
  viewer). Off = comportement actuel.
- Vague A peut être déployée sans flag (additive, non destructive).
- Vague B derrière flag pour permettre rollback opérationnel.

---

## 9. Critères de Done par vague (résumé)

| Vague | Done quand… |
|---|---|
| **A** | Les 7 tests §4.4 passent. Migration appliquée sur prod (après backup). Types Supabase regénérés. `as any` retirés sur `roof_model`/`roof_sections_v16`. Le ZIP contient enfin la vérité humaine + le diff + le split. |
| **B** | Les 5 tests §5.3 passent. Score auto calculé sur 100 % des rows sans saisie manuelle. DiffViewer visible. KPIs en haut du dashboard. |
| **C** | À spécifier après accord sur l'architecture ML (modèle, script, hosting). |

---

## 10. Gaps d'audit non couverts (à fermer avant prod Vague C)

- **RLS** sur les nouvelles colonnes : vérifier que les politiques existantes les
  couvrent.
- **`CalibrationEditor.tsx`** (345 lignes) : non audité.
- **`MapboxDebugOverlay` / génération de `debug_overlay_url`** : à identifier dans le
  pipeline d'ingestion (n'apparaît jamais peuplé automatiquement dans le code lu).
- **`importFromSoumissions` (`training-lab.ts:?`)** : pas inspecté ; vérifier qu'il
  remplit `roof_sections_v16` correctement.
- **`recoverTakeoffGeometryFromSoumission`** : pas audité.
- **Tests adapter v1.6** : prétendus verts, **pas exécutés** dans cette passe (échec
  d'environnement npm/vitest local).

---

## 11. Protocole de coordination

- **Avant Vague A** : poste un plan d'exécution (3–5 bullets) + confirme la stratégie
  de backup avant migration. Attends GO.
- **Migration** : appliquer d'abord en staging si dispo. Sinon, prendre un dump
  `pg_dump` avant `db push`.
- **Après Vague A** : ouvrir une PR distincte avec :
  - le diff de la migration ;
  - le diff de `types.ts` regénéré ;
  - une capture d'un ZIP exporté (arborescence avec `roof_model.json`, `diff.json`,
    `manifest.json` enrichi) ;
  - résultats des tests §4.4.
- **Si l'audit révèle que `debug_overlay_url` ne peut pas être set automatiquement**
  proprement, escalade — c'est un blocage à `validateTakeoffForExport` et donc à toute
  la chaîne.
- **Ne jamais** : modifier l'adapter v1.6, casser `annotations_json`, supprimer un
  statut sans migration de données, toucher au tracer.

---

## 12. Si tu es bloqué

Pose une question avec :
- fichier:ligne précis ;
- hypothèse testée ;
- 2 options A/B avec trade-offs.

Ne devine pas sur la sémantique du diff ou du score auto — c'est de la donnée qui
nourrira un modèle, l'erreur silencieuse y coûte cher.

---

*Briefing seulement. Aucune ligne de code, aucune migration appliquée. La balle est dans
le camp du builder après GO explicite sur la Vague A (migration + ZIP enrichi).*
