# Architecture review — pipeline toiture (étapes 1-2-3 du module Soumission)

> **Audit + design — 6 sections, mission : 30 min → 5 min par soumission.**
> **Ne touche pas au code applicatif. Plan d'exécution destiné au builder.**

**Auteur** : Claude (architecte)
**Date** : 2026-06-06
**Branche** : `claude/architecture-review-pipeline`
**Commit de référence du repo** : `ea1241b` (main au moment de l'audit)
**Documents source** :
- Brief utilisateur du 2026-06-06 : décisions business (étapes 1-2-3, fallback Solar échec, devenir Training Lab)
- Note utilisateur du 2026-06-06 : rectification d'état (Hypothèse 2+3, fichiers existent, Brikk hors-repo)
- Repo `webflow-quote-builder` à `ea1241b`

---

## 0. Préambule de transparence

J'ai démarré cet audit sur un checkout obsolète (`3308806`, juste après le merge de ma PR #15) et signalé à tort que Solar Viewer / Batches Dashboard / Models Dashboard n'existaient pas. Après rectification, je suis maintenant sur `ea1241b` et **tous les fichiers décrits par l'utilisateur existent**. Le rapport ci-dessous est écrit sur cette base à jour.

Une **contradiction stratégique** existe entre la note business du 6 juin et le code committé le 5 juin (cf. §2). Cette contradiction conditionne plusieurs verdicts. Je présente, quand pertinent, **les deux paths possibles** plutôt que de présumer lequel l'utilisateur veut.

J'ai été honnête sur ce que j'ai pu lire (lectures intégrales : `AdminBatchesDashboard.tsx`, `AdminModelsDashboard.tsx`, `AdminSolarViewer.tsx`, `solar-api-test/index.ts`, `migration 20260605_training_lab_batches_and_versions.sql`, `training-lab.ts` complet 1213 l.) et sur ce que je n'ai pas pu lire intégralement (le `solar-viewer.html` de 189 KB — j'ai mappé ses titres et features par grep ; les 35 edge functions — j'ai lu seulement `solar-api-test` ; les ~7700 lignes d'AdminQuoteGenerator audited séparément dans `docs/admin-quote-mobile-ui-audit.md`).

---

## 1. État réel du repo découvert au commit `ea1241b`

### 1.1 Les 6 sections existent toutes

| # | Section | Fichier(s) clé | Lignes | État routing |
|---|---|---|---|---|
| 01 | Training Lab | `src/pages/AdminTrainingLab.tsx` + `src/lib/training-lab.ts` | 934 + 1213 | `/admin/training-lab` (sidebar) |
| 02 | Tracer 3D | `src/pages/AdminRoofStudio.tsx` + `src/lib/roof-core/engine.ts` | 1733 + 1363 | `/admin/roof-studio` (sidebar, full-bleed) |
| 03 | Batches Dashboard | `src/pages/AdminBatchesDashboard.tsx` | 634 | `/admin/training-lab/batches` (sidebar sub-item) |
| 04 | Models Dashboard | `src/pages/AdminModelsDashboard.tsx` | 283 | `/admin/training-lab/models` (sidebar sub-item) |
| 05 | Solar Viewer | `src/pages/AdminSolarViewer.tsx` (60 l.) + `public/admin/solar-viewer.html` (189 KB) | 60 + ~6000 | `/admin/solar-3d` (sidebar) |
| 06 | Soumission Takeoff | `src/pages/AdminQuoteGenerator.tsx` | 7772 | `/admin/quote` (sidebar) |

### 1.2 Pipeline ML : actif et utilisé

- **35 edge functions** dans `supabase/functions/`. Les 4 critiques pour le pipeline ML : `training-batch-generate`, `training-launch`, `training-status`, `solar-api-test`.
- **Migration `20260605_training_lab_batches_and_versions.sql`** (datée du 5 juin) crée formellement :
  - `training_batches` (statuts `draft → generating → preannotating → ready_for_review → training_ready → training → trained → archived`)
  - `model_versions` (statuts `draft → training → trained → deployed → archived`, contrainte `UNIQUE(is_active) WHERE is_active = true`)
  - Colonnes ajoutées à `training_roof_takeoffs` : `batch_id`, `prediction_json`, `postprocessed_json`, `model_version_used`, `qc_status`, `review_priority`, etc.
  - Seed : `batch_000_initial` (training_ready) + `algo_v1_6` (deployed, **active**)
  - Backfill : tous les datasets existants → batch_000_initial + algo_v1_6
- **Workflow GitHub Actions YOLOv8-OBB** : commits récents `fd99622` et `2758193` montrent **des trainings réussis qui ont produit des weights de 12 Mo** (`yolov8-obb auto-trained from N datasets (12208 KB)`). Le pipeline produit des modèles concrets, ce n'est pas du POC.
- **Commit `04b63e7`** : `ci(train): fail-fast validation des secrets (détecte anon vs service_role)` — pipeline mature avec garde-fous.

### 1.3 `algo_v1_6` n'est PAS un modèle Hugging Face

Avant cette analyse, j'avais conclu (à tort) qu'`algo_v1_6` était un Space HF appelé par `runMvpV16Prediction`. C'est plus nuancé :

- **`algo_v1_6` est le pipeline algorithmique classique** (numpy + opencv + shapely) qui s'exécute dans un HF Space (probablement) MAIS qui est par nature **algorithmique, pas ML**. Pipeline en 10 étapes (note de la migration) :
  `fit_roof_rectangle → global_axes → ridge_hypotheses → rectangle_from_ridge → structural_scoring → relational_graph → semantic_order → scoring_extra → structural_selection → roof_sections`
  + **Étape 3 « Manhattan-world regularization » ajoutée le 2026-06-05**.
- C'est le **modèle actif/deployed** d'après la migration. C'est lui qui pré-annote.
- **Le YOLOv8-OBB est en cours d'amorçage** : la migration le mentionne (`roof_obb_v0_1`) mais aucun modèle YOLO n'est encore actif. Le hint de `AdminModelsDashboard.tsx:106-115` dit explicitement : *« Encore aucun modèle ML entraîné. Le pipeline tourne sur l'algo classique »*.

### 1.4 Solar API : POC bien fait, pas câblée au flux soumission

- **`solar-api-test/index.ts`** (139 l.) :
  - Endpoint admin (`runAdminGuards`)
  - Hit `solar.googleapis.com/v1/buildingInsights:findClosest?requiredQuality=HIGH`
  - **Hack référer** pour bypasser la restriction `*.toituresvb.ca/*` de la clé Google Maps (commit `4c4c618`)
  - Retourne `summary` (n_segments, total_area_m2, imagery_quality, imagery_date) + `segments` pré-digérés + `raw` brut
  - Auto-déclaré POC : *« Pas un endpoint de production — c'est un OUTIL DE TEST pour décider si Google Solar est suffisamment bon pour devenir le backend principal »*
- **Appelée nulle part dans `AdminQuoteGenerator`** — confirmé par grep. Le câblage Solar → étapes 1-2-3 reste **à concevoir**.
- **Solar viewer** (`solar-viewer.html`, 189 KB inliné via Vite `?raw`) contient 3 sections principales : `Solar API`, `Humain (engine.ts décomposé)`, `Repère`. Features confirmées : DSM, grille XY, slider pitch, toggles azimuth. C'est un **viewer de debug pour comparer Solar API et le pipeline humain `engine.ts`**, sur un seul cas inliné (« 383 Provence »).

### 1.5 Brikk FDW : hors repo (Hypothèse 3 confirmée)

- **0 migration** mentionne `brikk`, `FOREIGN`, `postgres_fdw`, `immeubles_unified`.
- **0 RPC** `fiche_batiment_complete` dans le repo.
- **1 référence dans `types.ts`** (généré par Supabase CLI — donc la regen voit le schéma `brikk` connecté côté DB, mais le repo ne sait pas le recréer).
- → Le FDW vit dans le projet Supabase de prod, appliqué via Studio Dashboard, **non reproductible sur un nouvel environnement** sans intervention manuelle. Risque opérationnel à flagger (cf. §10).

---

## 2. Contradiction stratégique — note 6 juin vs code 5 juin

La note utilisateur du 6 juin dit, **mot pour mot** :

> **Q2** : « Le Solar viewer standalone (POC) sera supprimé une fois ses fonctionnalités utiles migrées dans le Traceur 3D. »
> **Q4** : « HF v1.6 archivé dans legacy/ mais n'est plus appelé. »
> **Q5** : « **Enlever** : génération de batchs, lancement training YOLO, model versions — toute la pipeline ML custom (qui ne sert plus puisqu'on bascule sur Solar). »
> « **Renommage suggéré** : Training Lab → Solar QA Lab »

Le commit `20260605_training_lab_batches_and_versions.sql` du 5 juin (la veille) fait **l'inverse exact** :

- Construit `training_batches` formellement
- Construit `model_versions` formellement
- Pose `algo_v1_6` comme modèle actif
- Backfill tous les datasets vers le système
- Le `Batches Dashboard` ajoute un bouton « Lancer ML » qui déclenche `training-launch` (= YOLOv8-OBB sur GitHub Actions)

**Trois lectures possibles** :

| Lecture | Implication |
|---|---|
| **A — La note remplace la décision du 5 juin** | Le code committé hier devient à jeter. Coût : ~1 jour d'écriture + rollback migration (`DROP TABLE training_batches; DROP TABLE model_versions; ALTER TABLE training_roof_takeoffs DROP COLUMN batch_id ...`). C'est cassant si des dashboards sont utilisés. |
| **B — La note est une intention future, pas immédiate** | Le pipeline ML continue à tourner. Solar API est intégrée comme **source alternative** dans le flux soumission, sans démanteler le ML. Solar QA Lab cohabite avec Training Lab existant. |
| **C — Convergence intelligente** | Solar API devient la **source primaire** des étapes 1-2-3 du devis. Le pipeline ML continue à tourner mais sur un **rôle plus restreint** : raffiner ce que Solar fournit pour les cas où Solar échoue (LOW quality, 404). HF v1.6 (= algo_v1_6) reste utile comme **filet de sécurité algorithmique**, pas archivé. |

**Mon vote d'architecte** : **lecture C**. Justifications :

1. Démanteler l'infra ML qui vient d'être construite et qui produit des artefacts concrets (`fd99622` = 12 Mo de weights) est du gâchis d'investissement.
2. Solar API est **POC**, pas prod (déclaré dans son propre code). Tabler 100 % dessus pour une fonction métier critique sans coexistence est un risque.
3. Solar API peut **échouer sur 5-15 %** des cas (rural, LOW quality, 404 selon la note Q4). Sans fallback de qualité, l'utilisateur revient à un tracé 100 % manuel — c'est l'état actuel, donc aucun gain mesurable.
4. La cible business (30 min → 5 min) est atteignable avec Solar pour 85-95 % des cas + algo_v1_6 ou YOLOv8-OBB pour les autres. Pas besoin de jeter quoi que ce soit.

**Conséquence pratique pour ce doc** : les verdicts par section sont écrits en supposant la **lecture C**. Pour chaque section, je flag explicitement ce qui change si l'utilisateur tranche pour la lecture A.

---

## 3. Carte du pipeline actuel (ASCII)

```
                      ┌──────────────────────────────────────────┐
                      │           AdminQuoteGenerator             │
                      │     (étapes 1, 2, 3, 4 du devis)           │
                      │  ~7772 l. — REVENUE PATH, fragile mobile  │
                      └────────────┬─────────────────────────────┘
                                   │
                                   │ étape 3 = take-off mesures
                                   ▼
                ┌──────────────────────────────────────┐
                │     find_building_polygon (RPC)       │
                │   (Batiment_poly local + lat/lng)     │
                └────────────┬─────────────────────────┘
                             │
                             ▼
              ┌───────────────────────────────────┐
              │   Take-off manuel sur la carte    │
              │   (Google Static Maps + outils    │
              │    mesure faîtière/noues/etc.)    │
              │   ~30 min de saisie + correction   │
              └───────────────┬───────────────────┘
                              │ enregistre via Save
                              ▼
                      ┌────────────────────┐
                      │   soumissions      │
                      │   (dynasty_breakd. │
                      │    JSONB libre)    │
                      └─────────┬──────────┘
                                │
                                │  importFromSoumissions
                                ▼
       ┌──────────────────────────────────────────────────────┐
       │            Training Lab (1 vue)                        │
       │  ┌──────────────────────────────────────┐              │
       │  │ training_roof_takeoffs               │              │
       │  │  - raw_image_url (Google sat.)       │              │
       │  │  - original_building_geojson          │              │
       │  │  - roof_sections_v16 (pré-annotation) │              │
       │  │  - roof_model (truth humaine)         │              │
       │  │  - roof_model_diff (signal)           │              │
       │  │  - batch_id (NEW 2026-06-05)          │              │
       │  └──────────────────────────────────────┘              │
       └─────────┬───────────────────────────┬────────────────────┘
                 │ Annoter                   │ Exporter
                 ▼                           ▼
       ┌──────────────────────┐    ┌──────────────────────────┐
       │   AdminRoofStudio    │    │   buildBundleZip          │
       │   (tracer 2D + 3D)   │    │   ZIP enrichi             │
       │   engine.ts 1363 l.  │    │   + manifest lineage      │
       │   straight-skeleton  │    │   + README auto           │
       └──────────────────────┘    └─────────────┬────────────┘
                                                  │
                                  ┌───────────────┴───────────────┐
                                  │      Batches Dashboard         │
                                  │      (NEW 2026-06-05)          │
                                  │   - status batch_*             │
                                  │   - bouton « Lancer ML »       │
                                  │   - polling live (30s)         │
                                  └─────────┬─────────────────────┘
                                            │ launchTrainingFromPortal
                                            ▼
                              ┌──────────────────────────────┐
                              │  GitHub Actions              │
                              │  Workflow YOLOv8-OBB         │
                              │  ~1h30-2h, 12 MB weights     │
                              │  (commit fd99622 = SUCCESS)  │
                              └─────────┬────────────────────┘
                                        │
                                        ▼
                              ┌──────────────────────────────┐
                              │  model_versions              │
                              │  (NEW 2026-06-05)            │
                              │  - algo_v1_6 (ACTIVE)        │
                              │  - roof_obb_v0_1 (à venir)   │
                              │  Models Dashboard pour       │
                              │  switch active model         │
                              └──────────────────────────────┘

CÔTÉ — outils satellites :
       ┌────────────────────────┐       ┌─────────────────────────────┐
       │   solar-api-test       │       │   AdminSolarViewer          │
       │   POC edge function    │       │   (iframe → 189 KB HTML)    │
       │   Google Solar API     │ ─POC─►│   3 layers : Solar API +    │
       │   buildingInsights     │       │   Humain engine.ts +        │
       │                        │       │   Repère DSM                │
       └────────────────────────┘       │   1 cas inliné : 383 Provence │
                                        └─────────────────────────────┘

CÔTÉ — données externes (HORS-REPO) :
       ┌────────────────────────────────────────────────────────────┐
       │   Brikk Finance Supabase                                     │
       │   db.lkwwfpsxyeutgiksqrep                                    │
       │   ─► FDW vers Toitures VB (schéma `brikk`)                   │
       │   ┌──────────────────────────────┐                           │
       │   │ brikk.immeubles_unified      │ 25 000+ lignes MAMH       │
       │   │ brikk.proprietaires_unified  │ 9 955 lignes              │
       │   │ brikk.municipalites_qc       │ 1 134 munis               │
       │   └──────────────────────────────┘                           │
       │   ⚠ Non versionné dans migrations Toitures VB                │
       └────────────────────────────────────────────────────────────┘
```

**Constats** :
- Le pipeline ML est **entièrement câblé et fonctionnel** (étapes 1.2 et 1.3). Les fichiers existent, la migration est appliquée, des trainings ont déjà tourné.
- Solar API est **complètement isolée** : un endpoint POC + un viewer standalone. Aucune connexion au flux soumission ni au pipeline ML.
- Brikk FDW est **techniquement disponible** mais **non versionné** — l'audit ne peut pas reproduire le setup sans accès au Studio.
- Le flux soumission **n'utilise rien de tout ça** : ni Solar, ni Brikk, ni le modèle actif. Il fait un `find_building_polygon` local + take-off manuel sur Google Static Maps. C'est ce qui prend ~30 min.

---

## 4. Verdicts par section

### Section 01 — Training Lab

| Décision | **GARDE (mode allégé) + intégrer le rôle « Solar QA »** |
|---|---|
| Justification | Le Training Lab héberge la table `training_roof_takeoffs` et la logique de bundle export — c'est l'amont d'amélioration continue du pipeline. Il est neuf, sain, et bien tenu (j'ai relu les 1213 lignes de `training-lab.ts`). Le supprimer = perdre la boucle d'amélioration ET les ~43 datasets corrigés. |
| Ce qui reste | Vue liste filtrée par batch, Annoter (ouvre le Tracer 3D), Exporter bundle. C'est l'usage déjà courant. |
| Ce qui peut s'alléger | La pré-annotation v1.6 (HF Space `algo_v1_6`) peut devenir **optionnelle** : si Solar API HIGH quality est disponible sur le dataset, on l'utilise comme baseline ; sinon on retombe sur `algo_v1_6`. Le `roof_sections_v16` reste écrit en BD (input), juste alimenté différemment selon la source. |
| Ce qui peut s'ajouter | Une vue « **Diff Solar vs humain** » (chambre l'idée du Solar QA Lab) : prend un dataset annoté à la main → relance Solar API dessus → affiche IoU + écarts. C'est précisément ce que le `solar-viewer.html` fait pour `engine.ts` ; on étend à Solar. |
| Renommage Solar QA Lab ? | **Non**, garde Training Lab. Solar QA est un **mode de vue**, pas un produit séparé. Rajouter un toggle « Comparer Solar » suffit. |
| Effort | 0.5 j (toggle Solar dans la pré-annotation) + 1 j (vue diff Solar vs humain) = **1.5 j** |
| Si lecture A | **SUPPRIME tables batches+versions** : 1 migration `DROP`, retire `loadBatches/loadModelVersions/launchTraining/pollStatus` de `training-lab.ts` (~200 l. en moins), retire imports `AdminBatchesDashboard`/`AdminModelsDashboard` de `App.tsx`, retire les 3 sidebar items. Casse les 2 dashboards (cf. §03 et §04). Coût : **2 j** + perte de l'investissement migration. Risque : cassant si quelqu'un consultait les dashboards. |

### Section 02 — Tracer 3D (AdminRoofStudio + roof-core/engine.ts)

| Décision | **GARDE — outil de prod, ne pas refactorer** |
|---|---|
| Justification | C'est l'outil de validation/correction humaine. Il marche bien (utilisé par le Training Lab pour produire `roof_model`). Le `engine.ts` (1363 l.) implémente le straight-skeleton — code dense mais qui fonctionne. La liste interdite §6 du handoff précédent l'a déjà classé hors-touche, et c'est juste. |
| Ce qui s'ajoute (Solar) | Permettre au tracer de **charger un `RoofModel` seedé depuis Solar API** au lieu de partir d'un v1.6 ou d'une page blanche. Côté code : un adaptateur `fromSolarAPI(buildingInsights) → RoofModel` similaire à `fromRoofSectionsV16`, exporté depuis `src/lib/roof-core/adapters/`. Ne touche pas au moteur. |
| Ce qui s'ajoute (Solar viewer migration) | Les 4 éléments visuels listés par l'utilisateur — point cloud DSM, grillage XY, toggle pill cyan/violet, palette dark — peuvent être intégrés au tracer **seulement s'ils ont une vraie valeur pour le métier de tous les jours**. Mon avis : la palette + toggle style oui (UX cohérence) ; DSM + grillage XY non (debug, pas usage quotidien). |
| Effort | 1.5 j (adaptateur `fromSolarAPI`) + 0.5 j (palette + toggles migration) + 0 j (DSM/grid — pas migrés) = **2 j** |

### Section 03 — Batches Dashboard

| Décision | **GARDE (lecture C) ou SUPPRIME (lecture A)** |
|---|---|
| Si lecture C | Garde. C'est un dashboard sain, code propre (634 l. dont 80 l. de styles, gérable). Affiche les KPIs, gère les statuts, lance les trainings depuis le portail (`launchTrainingFromPortal`), suit le polling live. L'investissement est récent et fonctionnel. **Suggestion** : ajouter un onglet « Source » qui distingue les batchs créés depuis Solar API auto vs depuis le flux soumission. C'est ~0.3 j. |
| Si lecture A | Supprime. Retire `AdminBatchesDashboard` de `App.tsx`, retire de la sidebar, supprime le fichier, retire `loadBatches/recomputeBatchStats/launchTrainingFromPortal/pollTrainingStatus/loadTrainingRuns` de `training-lab.ts`. Casse les boutons « Lancer ML » et le polling live. Coût : **0.5 j**. |
| Risque oublié | La page consomme une edge function `training-batch-generate` qui appelle Google Maps API. Si supprimer, vérifier qu'aucun script externe l'appelle (probable que non, mais à confirmer). |

### Section 04 — Models Dashboard

| Décision | **GARDE (lecture C) ou SUPPRIME (lecture A)** |
|---|---|
| Si lecture C | Garde. Plus simple que Batches (283 l.). Affiche les métriques YOLO standard (mAP@0.5, precision, recall, val/box_loss…). Le bouton « Définir comme actif » fait juste un `UPDATE model_versions SET is_active=true` (logique pure, robuste). Aujourd'hui `algo_v1_6` est l'unique entrée — c'est légitime, c'est la baseline. Quand un YOLO est entraîné, il apparaît ici automatiquement. |
| Si lecture A | Supprime. Retire de `App.tsx`, sidebar, fichier. Retire `loadModelVersions/setActiveModelVersion/getActiveModelVersion` de `training-lab.ts`. Coût : **0.5 j**. |
| Détail à corriger même en C | Le hint dit *« Pour entraîner le premier YOLOv8-OBB, va dans l'onglet Actions du repo GitHub et lance le workflow »* (ligne 110-113). C'est obsolète depuis que `launchTrainingFromPortal` existe. À corriger en 5 min. |

### Section 05 — Solar Viewer

| Décision | **SUPPRIME le viewer standalone** (lecture A et C confondues), **migre 1 élément vers Tracer 3D** |
|---|---|
| Justification | Le viewer (189 KB) est codé en dur sur « 383 Provence ». Son intérêt est de **comparer Solar vs engine.ts** sur ce cas précis pour décider si Solar est suffisant. **Cette décision est déjà prise** (note utilisateur Q2 : « Solar API est le futur »). Donc le viewer a accompli sa mission. |
| Ce qu'on garde | 1 élément seulement, à migrer dans le Tracer 3D : **la palette dark + les toggles pill cyan/violet**. Concrètement : extraire les classes Tailwind / styles inline du viewer, les appliquer au header/toolbar du tracer. C'est cosmétique, ~0.3 j. |
| Ce qu'on ne migre PAS | Point cloud DSM (3D viewer dense, dépend de coordonnées Solar API granulaires non encore intégrées au flux normal) + grillage XY + slider Z. Tous utiles en debug, sans intérêt en prod quotidienne. À garder dans `archives/solar-viewer-snapshot.html` au cas où. |
| Effort | 0.3 j (palette/toggles) + 0.2 j (suppression propre + archive) = **0.5 j** |
| Côté code | `AdminSolarViewer.tsx` : supprimer. Route `/admin/solar-3d` : retirer. Sidebar item : retirer. `public/admin/solar-viewer.html` : déplacer dans `archives/` (hors build). |

### Section 06 — AdminQuoteGenerator (étapes 1-2-3)

| Décision | **GARDE — c'est le revenue path. Refactor étapes 1-2-3 dans une **vague chirurgicale** intégrant Solar + Brikk + historique** |
|---|---|
| Justification | Page de 7772 l., monolithe, fragile mobile (cf. `docs/admin-quote-mobile-ui-audit.md` : 18 bugs UI déjà documentés + `docs/admin-quote-prod-readiness-deep-dive.md` : 187 hooks + 15 vecteurs de perte). On n'y touche pas pour le plaisir. Mais c'est **dans ce fichier** que se joue le 30 min → 5 min. |
| Plan étapes 1-2-3 | Cf. §5. Conserve le squelette du wizard, branche autosave Solar/Brikk en amont. Le reste (étape 4 = postes de devis avec quantités/taux QBO) reste intact. |
| Effort | 5-8 j selon scope (cf. §11) |
| Risque | C'est le chemin du revenu. Une régression silencieuse = devis foirés. Tout doit passer par feature flag (`VITE_QUOTE_AUTOFILL_V1`). |

---

## 5. Plan détaillé étapes 1-2-3

Cible : passer de ~30 min à ~5 min sur ces 3 étapes.

### 5.1 Architecture cible

```
Adresse saisie
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│  Hook useAutofillFromAddress(address)                          │
│  (à créer dans src/hooks/useAutofillFromAddress.ts)            │
│                                                                │
│  1. Géocodage Google Places (déjà en place)                    │
│  2. Lookup batiment_avec_lot (local) → no_lot                  │
│  3. RPC fiche_batiment_complete(no_lot)                        │
│     ├─ batiment_avec_lot (local)                                │
│     ├─ brikk.immeubles_unified (FDW) ← NEW                      │
│     └─ brikk.municipalites_qc (FDW) ← NEW                       │
│  4. solar-api-test(lat, lng) — quality HIGH only                │
│  5. roof-classify(image) ou roof-vision-claude(image) — matériau│
└─────────────┬──────────────────────────────────────────────────┘
              │
              ▼
       résultats consolidés → autofill du formulaire
       avec UI « modifier » à chaque champ
```

### 5.2 Champ par champ — étape 1 (Identification + matériel)

| Champ | Source primaire | Fallback | Validation |
|---|---|---|---|
| Adresse | Saisie + autocomplete Google Places (existe) | — | — |
| Propriétaire QBO | Lookup `qb_customers` par adresse | `brikk.proprietaires_unified` via matricule | Humain confirme |
| Type couverture | `roof-classify(image)` ou `roof-vision-claude(image)` | Défaut « bardeaux d'asphalte » | Humain si confiance < 0.8 |
| Type de toit (hip/gable/mansarde) | Solar API segments → classification (≥4 segments avec azimuts opposés deux à deux = hip ; 2 segments opposés = gable) | `algo_v1_6` (roof-polygon-enhance) | Humain valide dans Tracer 3D |
| Pente dominante | Solar API segments → moyenne pondérée par area_m2 → snap aux pentes X/12 standard | Slider manuel | Humain dans Tracer 3D |
| **Année construction** | `brikk.immeubles_unified.annee_construction` via RPC | — | Auto |
| **Nb logements** | `brikk.immeubles_unified.nb_logements` | — | Auto |
| **Nb étages** | `brikk.immeubles_unified.nb_etages` | — | Auto |
| Superficie habitable (réf.) | `brikk.immeubles_unified.superficie_habitable_m2` | — | Corrobore Solar |
| Complexité (score 0-1) | Formule §7 | — | Affichage en ★ |
| Marque / Gamme / Couleur | Saisie manuelle | — | — |
| Type de travaux | Suggestion depuis `annee_construction` (< 1985 → réfection probable) | Saisie manuelle | Humain |

**Conditions de succès**

- Solar API quality `HIGH` ou `MEDIUM` → 6 champs auto-remplis en ~3s (Solar + Brikk en parallèle).
- Solar API quality `LOW` ou `404` → fallback `algo_v1_6` (existe) pour le type de toit + pente. Brikk continue de remplir les 4 champs MAMH.
- Brikk FDW indispo → message « Données municipales non disponibles, saisis manuellement », et les champs MAMH restent vides.

### 5.3 Étape 2 — Modèle de soumission

**Auto-sélection** depuis `soumissions` (table existante) :
```sql
SELECT m.id, m.name, m.coverage_type, m.product_brand, m.product_name, COUNT(*) AS uses_30d
FROM soumissions s
JOIN quote_templates m ON m.id = s.template_id
WHERE s.created_at > now() - interval '30 days'
  AND s.coverage_type = $1
  AND s.product_brand = $2
  AND s.work_type = $3
GROUP BY m.id, m.name, m.coverage_type, m.product_brand, m.product_name
ORDER BY uses_30d DESC
LIMIT 3;
```

- 1 match → auto-sélectionné, badge « Top match (X uses dernier mois) »
- 2-3 matches → propose top 3 par fréquence (cards)
- 0 match → fallback manuel actuel

**Impact** : ~3 min gagnées (l'utilisateur tape ça à la main aujourd'hui sur clavier mobile = friction max).

### 5.4 Étape 3 — Mesures toiture (cas bardeaux)

| Mesure | Source | Précision attendue |
|---|---|---|
| Faîtière (ml) | Solar segments → intersection des plans avec azimuts opposés (haut-haut) | ≤ 50 cm |
| Noues (ml) | Solar segments → intersection des plans avec azimuts opposés (bas-bas) | ≤ 50 cm |
| Bardeaux (m²) | Solar `total_area_m2` × facteur de perte (f(complexité)) | ≤ 5% |
| Membrane autocollante (ml) | Eaves + noues calculées Solar | ≤ 50 cm |
| Membrane synthétique (m²) | `total_area_m2` − zone membrane autoco | ≤ 5% |
| Bande de départ (ml) | Σ eaves Solar | ≤ 50 cm |
| Flashing / débord (ml) | Eaves + rakes + objets ponctuels | ≤ 50 cm + count |
| **Maximums** | Calcul math : surface isolée toit ÷ surface ventilée règlementaire | Exact |
| **Évents plomberie** | Heuristique : `nb_logements × f(nb_etages)` (formule §7) + 3 clics ajustement | Approx |
| **Cheminée(s)** | Heuristique : `type_construction + annee_construction` + saisie manuelle | Approx |

**Boucle de confiance** : pour chaque mesure auto, affichage `mesure ± marge d'erreur estimée`. Si la marge dépasse 10 %, badge « Vérifier » qui ouvre le Tracer 3D centré sur la mesure en question.

**Impact** : ~20 min gagnées (le take-off manuel actuel = la majeure partie des 30 min).

### 5.5 Le 30 min → 5 min décomposé

| Étape | Aujourd'hui | Avec autofill | Gain |
|---|---|---|---|
| 1 — Identification | ~5 min | ~1 min | 4 min |
| 2 — Modèle soumission | ~3 min | ~30 s | 2.5 min |
| 3 — Take-off | ~20 min | ~2 min | 18 min |
| 4 — Postes (hors scope) | ~2 min | ~2 min | — |
| **Total** | **~30 min** | **~5.5 min** | **~24.5 min** |

**Conclusion** : la cible 5 min est atteignable, marge surtout sur l'étape 3 (Solar API).

---

## 6. Câblage Brikk FDW dans le portail

### 6.1 RPC à créer dans Toitures VB Supabase

**Migration à committer** (proposée, **PAS appliquée** dans cet audit) :

```sql
-- supabase/migrations/<ts>_brikk_fiche_batiment_rpc.sql

CREATE OR REPLACE FUNCTION public.fiche_batiment_complete(p_idbati text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, brikk
AS $$
  SELECT jsonb_build_object(
    'batiment', to_jsonb(bal.*),
    'immeuble', to_jsonb(iu.*),
    'municipalite', to_jsonb(m.*)
  )
  FROM public.batiment_avec_lot bal
  LEFT JOIN brikk.immeubles_unified iu
         ON iu.matricule = REPLACE(bal.no_lot, ' ', '')
  LEFT JOIN brikk.municipalites_qc m
         ON m.code_geographique = iu.code_geo_municipalite
  WHERE bal.idbati = p_idbati
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.fiche_batiment_complete(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fiche_batiment_complete(text) FROM anon;
```

**Garde-fou** : la RPC échouera silencieusement (`null` dans `immeuble`) si le schéma `brikk` n'est pas attaché côté DB. C'est volontaire — le front gère le cas (cf. §6.3). Si tu veux dur, ajoute `IF NOT EXISTS (SELECT 1 FROM information_schema.foreign_tables WHERE foreign_table_schema = 'brikk') THEN RAISE EXCEPTION '...' END IF;` mais alors la migration **doit** s'appliquer dans cet ordre : FDW Studio → migration RPC.

### 6.2 Documentation du FDW à versionner

Créer `docs/external-schemas.md` qui décrit :
- Connexion FDW vers `db.lkwwfpsxyeutgiksqrep.supabase.co`
- Le SQL exact à exécuter pour recréer le FDW depuis zéro (`CREATE SERVER`, `CREATE USER MAPPING`, `IMPORT FOREIGN SCHEMA brikk`)
- Les tables importées + leur granularité (1 ligne = 1 matricule = 1 bâtiment, **pas** 1 unité fiscale)
- Le workflow Brikk d'`import-mamh` chaque 5 avril
- Le risque RLS (les foreign tables n'ont **pas** de RLS côté Toitures VB ; toute la protection est côté Brikk Finance + côté RPC `SECURITY DEFINER` ici)

C'est ~30 min d'écriture, ça sauve un futur dev (ou Lovable) qui essaie de `supabase db reset`.

### 6.3 UI étape 1 — branchement

Dans `AdminQuoteGenerator.tsx`, hook autour de l'adresse confirmée :

```ts
// Pseudo-code, à intégrer dans le wizard étape 1
const { data: ficheBatiment } = useQuery({
  queryKey: ['fiche-batiment', addressData?.no_lot],
  enabled: !!addressData?.no_lot,
  queryFn: async () => {
    const { data, error } = await supabase.rpc('fiche_batiment_complete', {
      p_idbati: addressData.no_lot,
    });
    if (error) throw error;
    return data as {
      batiment: any;
      immeuble: {
        annee_construction: number | null;
        nb_logements: number | null;
        nb_etages: number | null;
        superficie_habitable_m2: number | null;
        type_construction: string | null;
        garage: boolean | null;
      } | null;
      municipalite: any;
    };
  },
  staleTime: 1000 * 60 * 10, // 10 min cache
});

// Auto-fill quand dispo
useEffect(() => {
  if (!ficheBatiment?.immeuble) return;
  // Auto-fill seulement les champs vides (jamais écraser une saisie utilisateur)
  if (!data.year_built && ficheBatiment.immeuble.annee_construction) {
    updateData({ year_built: ficheBatiment.immeuble.annee_construction });
  }
  if (!data.dwelling_count && ficheBatiment.immeuble.nb_logements) {
    updateData({ dwelling_count: ficheBatiment.immeuble.nb_logements });
  }
  // etc.
}, [ficheBatiment?.immeuble]);
```

**Règle d'or UX** : ne JAMAIS écraser une saisie utilisateur. L'autofill ne remplit que les champs vides. Si l'utilisateur corrige, on conserve la correction.

### 6.4 Impact tables `soumissions`

Ajouter (migration séparée) à `soumissions` :
- `year_built INTEGER NULL`
- `dwelling_count INTEGER NULL`
- `floor_count INTEGER NULL`
- `mamh_data_source TEXT NULL` — valeur `'brikk_mamh_2026'` quand auto-rempli (audit trail)

Permet de :
1. Distinguer les soumissions auto-remplies des manuelles (analytics)
2. Détecter le bracket par `nb_logements` pour le matching étape 2
3. Tracer la source pour audit qualité

---

## 7. Formule de complexité

La formule proposée par l'utilisateur tient. Une seule modification d'architecte :

```ts
function computeComplexityScore(input: {
  solar_n_segments: number;
  solar_max_pitch_x12: number;
  solar_n_pignons: number; // estimé depuis count de segments avec rake type
  brikk_nb_etages: number | null;
  solar_azimut_variance_norm: number; // 0..1, écart-type des azimuts ÷ 90
  brikk_nb_logements: number | null;
}): number {
  // Tous les composants en [0..1], pondérés selon la note
  const c1 = clamp01(input.solar_n_segments / 6);
  const c2 = clamp01(input.solar_max_pitch_x12 / 12);
  const c3 = clamp01(input.solar_n_pignons / 4);
  const c4 = input.brikk_nb_etages != null
    ? clamp01(input.brikk_nb_etages / 3)
    : 0.5; // valeur neutre si Brikk indispo (à tuner)
  const c5 = clamp01(input.solar_azimut_variance_norm);
  const c6 = (input.brikk_nb_logements ?? 0) >= 4 ? 1 : 0;
  return 0.25 * c1 + 0.20 * c2 + 0.20 * c3 + 0.20 * c4 + 0.10 * c5 + 0.05 * c6;
}
```

**Différence avec la note** : la note prévoit `nb_etages_mamh / 3` mais ne dit pas quoi faire si Brikk indispo. J'ai mis valeur neutre `0.5` plutôt que `0` (qui sous-estimerait), à tuner avec l'historique.

**Tuning** : sortir un script qui, sur les ~43 datasets validés du Training Lab, calcule cette complexité et la corrèle avec :
- Le `correction_weight` (travail humain réel)
- Le temps de prise de mesure réel (à logger côté `AdminQuoteGenerator` via un timer simple)

Ça donne une ground truth pour ajuster les poids. À faire en Vague C.

---

## 8. Heuristique évents plomberie

La formule proposée par l'utilisateur :
```
si nb_etages == 1 : nb_logements
si nb_etages == 2 : max(2, ceil(nb_logements / 2))
si nb_etages >= 3 : max(2, ceil(nb_logements / 3))
```

Verdict d'architecte : **acceptable comme V0**, à tuner avec l'historique.

**Suggestions amélioration V1** :
- Brikk fournit aussi `type_construction` (résidentiel/commercial). Sur commercial multi-étages, les évents sont plus mutualisés que sur résidentiel → ajouter un facteur.
- L'`annee_construction` donne le code en vigueur : avant 1995, plomberie souvent par logement direct (= règle V0 OK) ; après 1995, mutualisation plus poussée (= retire 0.5 unité par étage).
- Sur duplex/triplex (résidentiel 2-3 logements, 2-3 étages), la règle V0 sur-estime. Cas réel à valider avec l'utilisateur.

**Recommandation** : ship V0 immédiatement (note Q3). Logger systématiquement la valeur prédite + la valeur saisie réelle (par l'utilisateur quand il corrige). Après 30 soumissions, tuner.

---

## 9. Solar API — intégration au flux soumission

### 9.1 Edge function — usage prod

L'edge function `solar-api-test` est **utilisable telle quelle** comme base. Renommer en `solar-api` (sans `-test`) au moment de la mettre en prod, ou copier dans une seconde fonction qui drop le `_test` et ajoute :

- **Cache** : `solar_api_cache` table par hash(lat, lng) → réponse pré-digérée. TTL 90 jours (les bâtiments ne changent pas). Évite de cramer le quota Google sur les ré-ouvertures de soumission.
- **Métrique** : log dans `solar_api_calls` (timestamp, lat, lng, status, quality, n_segments, latency_ms) pour suivre coût et taux d'échec.

Migration proposée :
```sql
CREATE TABLE IF NOT EXISTS public.solar_api_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  geohash     text NOT NULL,
  response    jsonb NOT NULL,
  quality     text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (geohash)
);
CREATE INDEX idx_solar_cache_geohash ON solar_api_cache(geohash);

CREATE TABLE IF NOT EXISTS public.solar_api_calls (
  id          bigserial PRIMARY KEY,
  called_at   timestamptz NOT NULL DEFAULT now(),
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  http_status integer,
  quality     text,
  n_segments  integer,
  latency_ms  integer,
  cache_hit   boolean NOT NULL DEFAULT false,
  caller      text  -- 'admin_quote' | 'training_lab' | 'solar_viewer'
);
```

**Coût** : ~0.5 j (cache + métrique). **ROI** : élimine 80 % des appels payants Google (ré-ouvertures, retours arrière, dev/test interne).

### 9.2 Adaptateur Solar → RoofModel

Dans `src/lib/roof-core/adapters/fromSolarAPI.ts` (à créer) :

```ts
import type { RoofModel, RoofSection } from '@/lib/roof-core/types';

interface SolarSegment {
  pitch_deg: number;
  azimuth_deg: number;
  area_m2: number;
  center: { lat: number; lng: number };
  bbox: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } };
}

interface SolarAPIDigested {
  ok: true;
  summary: {
    n_segments: number;
    total_area_m2: number;
    imagery_quality: 'HIGH' | 'MEDIUM' | 'LOW' | 'BASE';
    imagery_date: string;
  };
  segments: SolarSegment[];
}

export function fromSolarAPI(
  data: SolarAPIDigested,
  mapParams: { centerLat: number; centerLng: number; zoom: number },
): { model: RoofModel; sourceQuality: 'HIGH' | 'MEDIUM' | 'LOW' } {
  // Projette chaque segment lat/lng → image pixels (1280×1280)
  // Construit une section RoofModel par segment Solar
  // Convertit pitch_deg → pitch X/12 (snap aux pentes standard)
  // Marque source: 'solar' pour traçabilité
  // ...
}
```

L'adaptateur est **pur** (aucune dépendance DOM) et **testable**. Suit le contrat de `fromRoofSectionsV16.ts` (qui est sur la liste interdite — donc on respecte le pattern, on ne le touche pas).

**Coût** : 1 j (adaptateur + tests unitaires).

### 9.3 Branchement dans étape 3

```ts
// AdminQuoteGenerator.tsx — pseudo-code dans l'étape 3 take-off
const { data: solarData } = useQuery({
  queryKey: ['solar', addressData?.lat, addressData?.lng],
  enabled: !!addressData?.lat && !!addressData?.lng,
  queryFn: async () => {
    const { data, error } = await supabase.functions.invoke('solar-api', {
      body: { latitude: addressData.lat, longitude: addressData.lng },
    });
    if (error) throw error;
    return data;
  },
  staleTime: 1000 * 60 * 60, // 1h cache UI (le cache serveur est 90j)
});

const solarRoofModel = useMemo(() => {
  if (!solarData?.ok || solarData.summary.imagery_quality === 'BASE') return null;
  return fromSolarAPI(solarData, mapParams);
}, [solarData, mapParams]);

// Si solarRoofModel disponible, le Tracer 3D s'ouvre avec ce modèle en seed
// + bouton "Recalculer depuis Solar" qui re-pull et re-seed
```

---

## 10. Risques et garde-fous

### 10.1 Risques techniques

| # | Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Brikk FDW indispo (réseau Brikk Finance down) | Moyenne | Étape 1 dégradée (champs MAMH vides) | UI : message clair + saisie manuelle. Pas de blocage. |
| R2 | Brikk schéma non-versionné → `db reset` casse le FDW | Faible mais critique | Pipeline cassé silencieusement | `docs/external-schemas.md` + check au startup app (`supabase.rpc('fiche_batiment_complete', { p_idbati: 'health-check' })` qui throw clairement si schéma manquant) |
| R3 | Solar API quota Google explose | Moyenne | Coût ↑ + dégradation 429 | Cache `solar_api_cache` (§9.1) + alerte à 80 % du quota mensuel |
| R4 | Solar API HIGH quality manquante sur zones rurales | Élevée | 5-15 % des cas en fallback manuel | Conservé (note Q4) : Tracer 3D manuel acceptable |
| R5 | Régression sur AdminQuoteGenerator | Moyenne | Devis cassé, perte de revenu | Feature flag `VITE_QUOTE_AUTOFILL_V1`, rollback en 1 toggle. Smoke test mobile obligatoire après chaque déploiement. |
| R6 | Confusion algo_v1_6 vs roof_obb_v0_1 dans l'UI | Faible | Confusion utilisateur | Renommer `algo_v1_6` en `pipeline_classique_v1_6` dans `model_versions.name` (plus parlant que `algo_v1_6`) |
| R7 | Training Lab consomme Google Static Maps quota pour `importFromSoumissions` | Moyenne | Coût ↑ | Cap à 25 datasets/run + bouton « Mode rapide » qui skip les images |

### 10.2 Risques business

| # | Risque | Mitigation |
|---|---|---|
| B1 | Le user (toi) change d'avis sur le devenir Training Lab → travaux jetés | **Demander tranche explicite (A/B/C) avant Phase 1** |
| B2 | Solar API change ses prix Google → équation casse | Suivre la news Google Solar API + alternative Microsoft Building Footprints en backup étude |
| B3 | Brikk Finance change le schéma `brikk.immeubles_unified` → RPC casse | Coordonner avec l'équipe Brikk Finance (note utilisateur dit que le workflow est annuel = changement rare) |
| B4 | Nouveau dev ne sait pas que `brikk.*` n'est pas dans les migrations | `docs/external-schemas.md` + README.md du repo qui pointe dessus |

### 10.3 Risques de simplification (si lecture A retenue)

Si l'utilisateur tranche pour la lecture A (démanteler le pipeline ML) :
- Perte de l'investissement migration `20260605_*` (1-2 j de dev déjà committés)
- Perte de la capacité de retraining sans réécriture (pas de modèle qui s'améliore)
- Casse les 2 dashboards qui sont déjà câblés
- Bonne raison de le faire : focus produit, moins de surface à maintenir

→ **Ma recommandation : lecture C** (cf. §2). Lecture A acceptable si l'utilisateur a une raison stratégique forte (ex. : décision board, contrainte ressources). Lecture B = compromis acceptable mais moins clair.

---

## 11. Recommandations finales priorisées

### P0 — Bloquant pour la cible 30→5 min (à faire avant tout reste)

| # | Action | Effort | Section concernée |
|---|---|---|---|
| P0.1 | **Décider lecture A/B/C** sur le pipeline ML (cf. §2) | 30 min de réflexion utilisateur | Stratégique |
| P0.2 | Documenter le FDW Brikk dans `docs/external-schemas.md` | 0.5 j | §6.2 |
| P0.3 | Migration RPC `fiche_batiment_complete` (+ exécuter en prod après backup) | 0.5 j | §6.1 |
| P0.4 | Smoke test FDW : les 3 requêtes SQL de la note utilisateur | 5 min | §6 |
| P0.5 | Edge function `solar-api` prod (avec cache + métrique) | 1 j | §9.1 |
| P0.6 | Adaptateur `fromSolarAPI(data, mapParams) → RoofModel` + tests | 1 j | §9.2 |
| P0.7 | Hook `useAutofillFromAddress` (Brikk + Solar) | 1 j | §5.1 |
| P0.8 | UI étape 1 : auto-fill champs Brikk + Solar avec bouton « modifier » | 1.5 j | §5.2 |
| P0.9 | UI étape 3 : seed du tracer avec `solarRoofModel` + bouton « Recalculer Solar » | 1 j | §5.4 + §9.3 |
| P0.10 | UI étape 2 : auto-sélection modèle depuis historique 30 j | 0.5 j | §5.3 |
| P0.11 | Feature flag `VITE_QUOTE_AUTOFILL_V1` + rollback en 1 toggle | 0.5 j | §10.1 R5 |

**Sous-total P0** : ~7-8 j (1 développeur).

### P1 — Important mais non bloquant

| # | Action | Effort |
|---|---|---|
| P1.1 | Migration ajout colonnes `soumissions` : `year_built`, `dwelling_count`, `floor_count`, `mamh_data_source` | 0.5 j |
| P1.2 | Renommer `algo_v1_6` → `pipeline_classique_v1_6` dans `model_versions.name` (1 ligne update) | 5 min |
| P1.3 | Corriger hint obsolète dans `AdminModelsDashboard.tsx:110-113` (mention « onglet Actions du repo GitHub ») | 5 min |
| P1.4 | Heuristique évents plomberie V0 + logging réel pour tuning V1 | 0.5 j |
| P1.5 | Formule complexité V0 + logging réel pour tuning V1 | 0.5 j |
| P1.6 | Migration `solar_api_cache` + `solar_api_calls` | 0.3 j |
| P1.7 | Solar Viewer : extraire palette + toggles → Tracer 3D + archive viewer | 0.5 j |
| P1.8 | Vue diff Solar vs humain dans Training Lab (si lecture B ou C) | 1 j |
| P1.9 | Documenter dans `docs/training-lab-batches-versions.md` le cycle d'amélioration ML (si lecture C) | 0.5 j |

**Sous-total P1** : ~4 j.

### P2 — Polish et tuning

| # | Action | Effort |
|---|---|---|
| P2.1 | Onglet « Source » dans Batches Dashboard (Solar auto vs soumission) (si lecture B/C) | 0.3 j |
| P2.2 | Métriques INP/Lighthouse sur AdminQuoteGenerator | 0.5 j |
| P2.3 | Test mobile complet flux étapes 1-2-3 sur 3 modèles iPhone | 1 j (manuel) |
| P2.4 | Vague tuning formules après 30 soumissions réelles | 1 j (3 mois plus tard) |

**Sous-total P2** : ~3 j (étalés).

### Total prévisionnel

- **P0 seul** : 7-8 j → atteint la cible 30→5 min, prod-ready avec feature flag.
- **P0 + P1** : ~11 j → version complète + télémétrie + Solar QA.
- **P0 + P1 + P2** : ~14 j → version polish.

Vu que le user est habitué à du « builder agentique en parallèle », un découpage possible :
- Builder Solar/Brikk integration (P0.5 → P0.10) : ~5 j
- Builder migrations + docs (P0.2, P0.3, P1.1, P1.6, P1.9) : ~1.5 j
- Audit final + smoke test : 1 j

---

## 12. Liste interdite (pour le builder qui prendra le relais)

À ne **pas** toucher en Phase 1 :

- `src/lib/roof-core/engine.ts` (1363 l. — straight-skeleton, prod)
- `src/lib/roof-core/adapters/fromRoofSectionsV16.ts` (contrat figé + 14 tests verts)
- `src/pages/AdminRoofStudio.tsx` (1733 l. — outil de prod)
- `src/lib/training-lab.ts` côté `buildBundleZip` + types `TrainingBatch`/`ModelVersion` (sauf si lecture A : auquel cas tout retirer en lot)
- `src/components/QuotePreview.tsx` (PDF doit rester identique au bit près — pattern wrapper si modif mobile)
- Edge functions `quickbooks-*`, `send-quote-email`, `contract-signature-*` (= revenue + sécurité — déjà documenté dans `docs/edge-functions-audit.md`, fix en cours)

Composants à toucher en chirurgie (pas refacto) :

- `src/pages/AdminQuoteGenerator.tsx` — étapes 1-2-3 seulement, sous feature flag

Composants à créer :

- `src/lib/roof-core/adapters/fromSolarAPI.ts`
- `src/hooks/useAutofillFromAddress.ts`
- `src/hooks/useSolarRoofModel.ts`
- `supabase/migrations/<ts>_brikk_fiche_batiment_rpc.sql`
- `supabase/migrations/<ts>_soumissions_mamh_columns.sql`
- `supabase/migrations/<ts>_solar_api_cache.sql`
- `supabase/functions/solar-api/index.ts` (copie de `solar-api-test` + cache + log)
- `docs/external-schemas.md`

---

## 13. Réponses aux 7 questions ouvertes de la note

**Q1 — Vision classifier matériau** : MVP = défaut « bardeaux d'asphalte ». Étend plus tard quand on a de la donnée historique pour entraîner. La fonction `roof-classify` (existe) est probablement déjà bonne pour du matériau ; à confirmer côté code (non audité dans cette passe). Si oui, l'utiliser directement.

**Q2 — Formule complexité** : la formule proposée tient (§7). Une modification : valeur neutre `0.5` quand Brikk indispo plutôt que `0`. Tuning à faire avec l'historique soumissions + Training Lab après 30 j de prod.

**Q3 — Solar QA Lab** : garde Training Lab existant + ajoute un **mode de vue** « Comparer Solar » plutôt qu'un produit séparé. Coût plus bas, surface UI moins fragmentée.

**Q4 — MAMH côté front** : passer par **RPC `SECURITY DEFINER`** (proposé §6.1). Plus propre que d'exposer le schéma `brikk` via PostgREST (qui aurait nécessité une politique RLS sur des foreign tables, ce qui est lourd/fragile).

**Q5 — Heuristique évents plomberie** : V0 acceptable, ship-it (§8). V1 plus tard avec `type_construction` + `annee_construction` après tuning sur 30+ soumissions.

**Q6 — Coverage géographique MAMH** : prioriser Granby (où ça marche déjà). Pour Cowansville/Bromont/Magog, déclencher un import dédié via le workflow `import-mamh` côté Brikk Finance. Coût bas — c'est un workflow GitHub Actions configurable par ville. Coordonner avec l'équipe Brikk.

**Q7 — Estimation effort total** :
- Intégration Solar API dans Tracer 3D : **2 j** (§02)
- Câblage MAMH (RPC + UI) : **3 j** (§6)
- Simplification Training Lab (mode Solar QA) : **1.5 j** (§01)
- Retrait HF v1.6 : **non recommandé** (cf. §2 lecture C). Si forcé : **0 j** (HF Space externe, on cesse juste de l'appeler — pas de code à retirer car `algo_v1_6` est déjà la pré-annotation par défaut).

**Total Q7 brut** : ~6.5 j si on prend juste les 4 items. **Total incluant le câblage étapes 1-2-3 du devis (le 30→5 min)** : ~11 j (P0 + P1).

---

## 14. Conclusion d'architecte

Le projet est **structurellement sain** : pipeline ML mature (en cours d'amorçage YOLO), Tracer 3D solide, Training Lab récemment refactoré avec batches+models. La cible business 30→5 min est **clairement atteignable** en ~7-8 j de travail concentré sur les étapes 1-2-3 du devis.

**Le point de blocage est stratégique, pas technique** : la contradiction entre la note business (« enlever le ML, bascule Solar ») et le code committé hier (« construction formelle de l'infra ML ») doit être tranchée **avant** que le builder n'attaque la Phase 1. Sinon, le builder risque de jeter ou de garder à mauvais escient et générer du gâchis.

**Ma recommandation finale** : **lecture C** (Solar API en source primaire + algo_v1_6/YOLO comme filet de sécurité, Training Lab conservé en mode allégé). C'est le path qui :
- Atteint la cible 30→5 min (Solar fait le gros du job)
- Conserve l'investissement ML (12 Mo de weights déjà entraînés, infra mature)
- Évite la régression silencieuse (15 % de cas où Solar échoue)
- Renomme rien d'intrusif, ne casse aucun dashboard

**Branche pour la Phase 1** : `claude/quote-autofill-v1` depuis `main` après ce merge.
**Flag pour la Phase 1** : `VITE_QUOTE_AUTOFILL_V1` (off par défaut, rollback en 1 toggle).
**Ordre d'exécution** : P0 dans l'ordre listé §11, smoke test sur mobile à chaque jalon.

---

*Architect-only document. Aucun code modifié, aucune migration appliquée. Branche `claude/architecture-review-pipeline`, à merger après revue.*
