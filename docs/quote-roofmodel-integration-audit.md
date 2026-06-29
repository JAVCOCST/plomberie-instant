# Audit d'intégration — Roof Model → étape Takeoff de la Soumission

> **Statut : AUDIT SEULEMENT.** Aucun fichier de code n'a été modifié, aucun refactor,
> aucune migration, aucune suppression. Ce document est le seul livrable.
> Aucun codage ne doit commencer avant validation explicite de la section
> [« Décision requise avant codage »](#décision-requise-avant-codage).

Date : 2026-05-26 · Branche : `claude/quote-roofmodel-audit-aXRf5`

---

## 1. Résumé exécutif

L'application contient en réalité **trois** sous-systèmes d'annotation/géométrie de
toiture, et non deux. C'est le fait le plus important de cet audit :

| # | Sous-système | Route / Hôte | Sortie | Moteur |
|---|---|---|---|---|
| **A** | **Soumission immersive** — `RoofPolygonAIInline` dans le flux carte | `/admin/quote` (et widget public) | **Empreinte unique** : `path[]`, `areaM2`, `perimeterM` | Google Maps `geometry.spherical` + edge functions SAM |
| **B** | **Roof Model** — `AdminRoofStudio` + `RoofPolygonAIWorkspace` + `lib/roof-core` | `/admin/roof-studio`, `/admin/quote/roof-polygon` | **Modèle 3D complet** : sections, pentes, noues, arêtes, faîtes, accessoires | `lib/roof-core/engine.ts` (straight-skeleton) |
| **C** | **Training Lab takeoff** — `TrainingTakeoffEditor` + `lib/roof-sections` | `/admin/training-lab` | Mesures par outil + `roof_sections` + edges | Google Maps + `lib/skeleton-overlay` + `roof-sections` |

**Constat clé n°1 — Le « takeoff » de la soumission n'existe pas comme étape dédiée.**
Aujourd'hui, la quantification est implicite et se réduit à `area_sqft` (issue du RPC
`find_building_polygon` ou d'une saisie manuelle), `slope` et `complexity`. Le
`FormData` (`src/types/roofing.ts`) ne contient **aucun** champ pour sections, pentes
par pan, noues, arêtes, périmètres ou accessoires.

**Constat clé n°2 — Le moteur Roof Model est déjà réutilisable.** `AdminRoofStudio`
est un composant **piloté par props** (`initialModel`, `backgroundImage`, `mode`,
`onValidate(model)`, `onClose`) sans dépendance de route ni de persistance. Il est
**déjà monté en plein écran** par le Training Lab (`AdminTrainingLab.tsx:742-753`,
`position:fixed; inset:0; zIndex:11000`, `mode="review"`). C'est **exactement** le
patron mobile plein écran demandé pour le takeoff — le précédent existe.

**Constat clé n°3 — Aucune persistance pour un RoofModel.** Aucune migration ne crée
les colonnes `roof_model` ni `roof_sections_v16`, alors que `AdminTrainingLab.tsx:186`
écrit `roof_model` via `.update(...)`. La table `soumissions` n'a aucune colonne
structurée pour la géométrie de toit (seulement `area_sqft`, `slope`, `complexity` et
un JSON libre `dynasty_breakdown`).

**Recommandation (résumée) :** **Option B — extraction d'un moteur partagé**. Réutiliser
`AdminRoofStudio` tel quel en overlay plein écran depuis le takeoff, brancher
`onValidate(model)` → fonction de dérivation des quantités → injection dans `FormData`,
et ajouter **une** colonne JSONB `roof_model` sur `soumissions` (+ régulariser celle de
`training_roof_takeoffs`). Voir [§ Décision](#décision-requise-avant-codage).

---

## 2. Cartographie des fichiers Admin / Quote / Soumission

### 2.1 Entrée & routing
- `src/App.tsx:79` — route `/admin/quote` → `AdminQuoteGenerator`.
- `src/App.tsx:80-87` — route `/admin/quote/roof-polygon` → `AdminRoofPolygonAI` (lazy).
- `src/pages/AdminQuoteGenerator.tsx` — page admin (génération/édition de soumission ;
  hôte réel de `RoofPolygonAIInline` via `MapToolbox`).
- `src/components/roofing/RoofingApp.tsx` — enveloppe `FormProvider` + `ImmersiveWizard`.

### 2.2 Wizards
- `src/components/roofing/immersive/ImmersiveWizard.tsx` (~2700 lignes) — **wizard
  principal**. Phases `intro → form → computing → result`. Étapes : Adresse →
  Bâtiment → Travaux → Analyse IA → Client.
- `src/components/roofing/FormWizard.tsx` — wizard classique 8 étapes (legacy).
- `src/components/roofing/Stepper.tsx` — indicateur de progression.

### 2.3 Étapes (steps)
- `src/components/roofing/steps/StepAddress.tsx`, `StepArea.tsx`, `StepCoverage.tsx`,
  `StepComplexity.tsx`, `StepSlope.tsx`, `StepProduct.tsx`, `StepColor.tsx`,
  `StepClient.tsx`, `StepDate.tsx`.
- `src/components/roofing/immersive/StepCoverageImmersive.tsx` — sélecteur couverture +
  badge détection IA.

### 2.4 Carte / annotation (où vit le « takeoff » actuel)
- `src/components/roofing/immersive/BuildingConfirmation.tsx` — appel RPC
  `find_building_polygon(p_lat, p_lng, p_radius_meters)` → `superficie`, `perimetre`,
  `geojson`, `lot_geojson`, `largeur`, `profondeur`. **Source primaire de la quantité.**
- `src/components/roofing/immersive/BuildingMapPicker.tsx` — sélection/édition manuelle
  du polygone bâtiment.
- `src/components/roofing/immersive/BuildingReadOnlyMap.tsx` — affichage carte (réutilisé
  aussi par le Training Lab — voir §3 et §4).
- `src/components/roofing/immersive/BuildingPolygonOverlay.tsx` — rendu GeoJSON.
- `src/components/roofing/immersive/MapToolbox.tsx` — barre d'outils flottante ; embarque
  `RoofPolygonAIInline` (interface `MapToolboxControls`).
- `src/components/roofing/immersive/MobilePrecisionLayer.tsx` — loupe tactile mobile,
  pression, double-tap, retour haptique.
- `src/components/roofing/immersive/RoofPolygonAIInline.tsx` — **pipeline IA parallèle
  (sous-système A)** : `doCapture` (composition tuiles Google/OrthoQC) → edge functions
  `roof-polygon-enhance` / `roof-polygon-segment` (SAM) → `maskToPolygon` → confirme un
  unique polygone `{ path, areaM2, perimeterM }` via `onConfirmPolygon`. **N'utilise PAS
  `lib/roof-core`.**

### 2.5 UI advisor / aperçu
- `AdvisorAnalysis.tsx`, `AdvisorBubble.tsx`, `AdvisorChat.tsx`, `SlopeAnalysis.tsx`,
  `RoofPreview.tsx`, `RepairDetailsChat.tsx`, `ProgressDrawer.tsx`, `Globe.tsx`,
  `IsometricHouse.tsx`, `DateAvailability.tsx` (tous sous
  `src/components/roofing/immersive/`).

### 2.6 État / types / persistance
- `src/context/FormContext.tsx` — **seul store** du module (React Context + `useState`).
  `data: FormData`, `step`, `updateData(partial)`, `resetForm()`. Pas de Zustand ici.
- `src/types/roofing.ts` — `FormData`, `CoverageType`, `SlopeLevel`/`SLOPE_FACTORS`,
  `ComplexityLevel`/`COMPLEXITY_FACTORS`, `Product`, `computeEstimation()`, `sqmToSqft()`.
- État supplémentaire local à `ImmersiveWizard` (hors contexte) : `buildingGeoJson`,
  `buildingSuperficie`, `buildingPerimetre`, `polygonAdjustments`, détections IA…
- Persistance : `localStorage` (`imm_roofing_data`, `imm_roofing_step`) + tables Supabase
  `form_sessions`, `soumissions`, `soumission_notes` ; upload plans dans bucket
  `quote-pdfs`. (Détails §3.6 et §4.)

### 2.7 Calcul & pricing
- `src/lib/pricing-matrix.ts` — `computeMatrixEstimate(...)`, `SLOPE_COEFFS`, table de prix
  par `work_type | roof_subtype | slope_label`.
- `src/lib/dynasty-calculator.ts` — `computeDynastyQuote(areaSqft, perimeterFt, vision)` →
  `dynasty_breakdown` (lignes, sous-totaux, taxes).
- `src/lib/quote-variables.ts`, `src/lib/quote-settings.ts` — variables et réglages.
- `src/lib/pdf-generators.ts`, `src/lib/pdf-storage.ts` — génération/stockage PDF.

---

## 3. Cartographie des fichiers Roof Model (sous-système B)

### 3.1 Pages / hôtes
- `src/pages/AdminRoofStudio.tsx` (~1131 lignes) — **traceur 2D + aperçu 3D** (canvas
  natif + math maison, **pas** Three.js dans ce composant). Props :
  `RoofStudioProps { initialModel?, backgroundImage?, mode?: "free"|"review", onValidate?(model: RoofModel), onClose? }`
  (`AdminRoofStudio.tsx:23-29, 52`). Sans props → traceur libre autonome.
- `src/pages/AdminRoofPolygonAI.tsx` — wrapper minimal → `RoofPolygonAIWorkspace`.

### 3.2 Workspace 2D (Konva)
- `src/components/roof-polygon-ai/RoofPolygonAIWorkspace.tsx` — conteneur ;
  upload orthophoto, `ResizeObserver`, orchestre `Canvas`/`ToolPanel`/`LayersPanel`.
- `src/components/roof-polygon-ai/Canvas.tsx` — stage Konva (rasters + vecteurs + outils).
- `src/components/roof-polygon-ai/ToolPanel.tsx` — pipeline (enhance/calibrate/segment/
  edit/export) + outils + mesures live.
- `src/components/roof-polygon-ai/LayersPanel.tsx` — gestion des calques.
- `src/components/roof-polygon-ai/store.ts` — **store Zustand local** (layers, steps,
  calibration, segmentMode, activeTool, selection, transform). Non global, non persisté.
- `src/components/roof-polygon-ai/geometry.ts` — `shoelaceArea`, `perimeter`,
  `pixelsToMeters`, `simplifyPolygon`, `maskToPolygon`, `distance`.
- `src/components/roof-polygon-ai/pipeline.ts` — `runEnhance`/`runSegment`
  (`supabase.functions.invoke`), `exportProjectJson` (export JSON, pas de save DB).

### 3.3 Moteur géométrique (`src/lib/roof-core/`)
- `engine.ts` (~1165 lignes) — straight-skeleton (local + chemin CGAL/WASM via
  `straight-skeleton`), faces 3D, **pentes par face** (`getFacePitches`), hauteurs/plans
  (`facePlaneFromFace`, `sectionRoofHeightAt`), **noues** (`findValleys`), **aires 3D**
  (`face3DArea`), détection pignon (`isPignon`), projection 3D (`buildView`, `proj3`),
  rendu (`draw2D`, `render3D`). **Fonctions pures, sans DOM.**
- `types.ts` — `RoofModel` (`version:1`, `image?`, `scale?`, `sections: RoofSectionInput[]`,
  `alternatives?`, `metadata`), `RoofSectionInput` (`pts`, `pitch`, `elev`, `hf`,
  `roof_type:"hip"|"gable"`), `RoofModelScale`/`RoofGeoref`, conversions Web-Mercator.
- `annotation.ts` — sérialisation `buildAnnotation`/`parseAnnotation`,
  `ENGINE_VERSION="roof-core-1"`, `ANNOTATION_VERSION=2`, provenance `source`
  (`mvp`/`human`/`merged`).
- `viewport.ts` — transformations vue.
- `adapters/fromRoofSectionsV16.ts` — adaptateur format MVP v1.6 → `RoofModel`.
- Tests : `engine.test.ts`, `annotation.test.ts`, `viewport.test.ts`,
  `adapters/fromRoofSectionsV16.test.ts`.

### 3.4 Accessoires (`src/lib/roof-accessories/`)
- `types.ts` — `AccessoryAnchor` (ancrage stable section/edge/t/offset), `AccessoryInstance`.
- `anchor.ts` (`validateAnchor`, `makeAnchor`), `resolve.ts` (ré-ancrage orphelins),
  `catalog.ts`, `max-301.product-spec.json`, `ventilationValidation.ts` (NFA 1/300 ou 1/150).

### 3.5 Sections & skeleton (partagés avec sous-système C)
- `src/lib/roof-sections.ts` — `RoofSection`, `RoofEdge` (`RIDGE/VALLEY/HIP/EAVE/GABLE`),
  `RoofSectionsBundle`, `buildSectionsBundle`, `deriveRoofEdges`, diagnostics.
- `src/lib/roof-sections-ops.ts` — `consolidateSections`, `splitNonConvexSections`,
  `optimizeSections`.
- `src/lib/skeleton-overlay.ts` — `computeSkeletonLatLng` (skeleton en lat/lng).
- `src/lib/skeleton-pipeline.ts` — classification géométrique.

### 3.6 Persistance / dépendances
- **Aucune persistance propre** : `AdminRoofStudio` rend la vérité via `onValidate(model)`,
  l'appelant gère le stockage. `RoofPolygonAIWorkspace` exporte en JSON / état Zustand local.
- Dépendances clés : `straight-skeleton` (engine), `konva`/`react-konva` (workspace 2D),
  `simplify-js` (geometry), `@turf/turf` (géodésie), `zustand`, `react-rnd`.
- **Couplage** : `AdminRoofStudio` = faible couplage (props only). `RoofPolygonAIWorkspace`
  = store Zustand scoping local, wrapper de route. Moteur `roof-core` = portable.

---

## 4. Persistance & données partagées (Supabase)

Sources vérifiées : `src/integrations/supabase/types.ts`, `supabase/migrations/*`,
`src/lib/training-lab.ts`, `src/hooks/useProjects.ts`,
`src/hooks/mutations/projectMutations.ts`.

### 4.1 Table `soumissions` (devis)
Migration `supabase/migrations/20260215221848_*.sql`, type `types.ts:1515-1648`.
Colonnes pertinentes : client (`first_name`…), adresse (`formatted_address`, `place_id`,
`lat`, `lng`), toit (`coverage_type`, `slope`, `complexity`, `area_sqft`, `area_input`,
`area_unit`, `building_type`, `roof_category`), produit, prix (`low_estimate`,
`high_estimate`, `subtotal`, `complexity_factor`, `slope_factor`), **`dynasty_breakdown`
(JSONB)**, `utm` (JSONB), `status`, `form_session_id`.
**→ Aucune colonne structurée pour un RoofModel / sections / noues / arêtes.** Le seul
réceptacle JSON libre est `dynasty_breakdown`.

### 4.2 Table `training_roof_takeoffs` (Training Lab)
Migration `20260524000000_training_lab.sql`, type `types.ts:1704+`.
- `annotations_json` (JSONB) — outils de mesure, segments, marqueurs, `roof_sections`,
  `roof_edges`, totaux (cf. `TrainingTakeoffEditor.tsx:223-250`).
- Géométries `original_/corrected_building_geojson`, `original_/corrected_lot_geojson`.
- Calibration (`calibration_*`), cycle de vie `dataset_status`, `source_takeoff_id`
  (lien vers `soumissions`).
- ⚠️ **`roof_model` et `roof_sections_v16` sont déclarés dans l'interface TS
  (`src/lib/training-lab.ts:28-31`) et écrits (`AdminTrainingLab.tsx:186`
  `updateRow(id, { roof_model: model })`) mais NE FIGURENT dans AUCUNE migration ni dans
  le type généré** (vérifié : `grep roof_model supabase/migrations/` = aucun résultat).

### 4.3 Liens existants Soumission ↔ Takeoff
- `src/lib/training-lab.ts` : `recoverTakeoffGeometryFromSoumission(...)` et
  `importFromSoumissions(...)` reconstruisent un takeoff d'entraînement À PARTIR d'une
  soumission (RPC `find_building_polygon`, `dynasty_breakdown`). Il existe donc déjà un
  pont **soumission → takeoff entraînement**, mais **pas** de retour
  **takeoff → soumission** des quantités structurées.

### 4.4 Hooks
- `src/hooks/useProjects.ts` — lecture `soumissions` (React Query, staleTime 30s) + canal
  realtime `projects-stream`.
- `src/hooks/mutations/projectMutations.ts` — `useUpdateProject(id, patch)` →
  `.update()` sur `soumissions`.

---

## 5. Schéma du flow ACTUEL

```
SOUMISSION (ImmersiveWizard / AdminQuoteGenerator)
  Adresse (lat/lng)
     │
     ▼
  BuildingConfirmation ──RPC find_building_polygon──► superficie(m²), perimetre(m), geojson
     │                                                        │
     │  (fallback) StepArea: area + areaUnit                  │
     ▼                                                        ▼
  FormData.area ─────────────────────────────────►  areaSqft = sqmToSqft(superficie) ou area
  FormData.slope / complexity                        perimeterFt = perimetre*3.28084
     │
     ▼
  pricing-matrix / dynasty-calculator ► low/high_estimate, dynasty_breakdown(JSON)
     │
     ▼
  soumissions (insert/update)  +  form_sessions  +  soumission_notes  +  PDF(quote-pdfs)

— EN PARALLÈLE, NON BRANCHÉ AU PRICING —
  MapToolbox ▸ RoofPolygonAIInline (SAM)  ►  { path, areaM2, perimeterM }  (empreinte seule)

ROOF MODEL (séparé)                       TRAINING LAB (séparé)
  AdminRoofStudio / RoofPolygonAIWorkspace   TrainingTakeoffEditor
   ► RoofModel (sections, pentes, noues,      ► annotations_json + roof_sections
     arêtes, accessoires) via onValidate        (table training_roof_takeoffs)
   ► (aucune persistance propre)              ◄─ recoverTakeoffGeometryFromSoumission
```

---

## 6. Schéma du flow CIBLE

```
SOUMISSION — étape TAKEOFF (nouvelle, explicite)
  Adresse + BuildingConfirmation (footprint geojson, image satellite)
     │
     ▼
  [Bouton « Tracer le toit »]  ──ouvre OVERLAY PLEIN ÉCRAN──►  AdminRoofStudio (mode review)
     │   props: initialModel (seed depuis footprint/MVP), backgroundImage (capture)         │
     │                                                                                       │
     │   ◄──────────────── onValidate(model: RoofModel) ─────────────────────────────────── ┘
     ▼
  deriveTakeoffQuantities(model)   ← NOUVEAU module pur (lib partagée)
     │   → surface_3D, perimetre, pentes par pan, noues(ml), arêtes(ml),
     │     faîtes(ml), nb accessoires/évents, complexité dérivée
     ▼
  Injection dans FormData (champs existants + roofModel)
     │   area ← surface_3D ;  slope ← pente dominante ;  complexity ← dérivée
     ▼
  pricing-matrix / dynasty-calculator (inchangé)  ►  estimés
     ▼
  soumissions.update({ ..., roof_model: model (JSONB) })   ← NOUVELLE colonne
     │
     └─► (optionnel) alimente Training Lab via le pont existant source_takeoff_id
```

---

## 7. Proposition d'architecture cible

### 7.1 Principe directeur
**Une seule vérité géométrique = `RoofModel` (`lib/roof-core/types.ts`).** Le takeoff
réutilise `AdminRoofStudio` comme éditeur et reçoit le `RoofModel` validé. Toutes les
quantités du devis dérivent de ce modèle via une fonction **pure** unique.

### 7.2 Structure de fichiers recommandée (cible, à créer en Phase 1+)
```
src/lib/roof-core/
  quantities.ts        ◄ NOUVEAU — deriveTakeoffQuantities(model): TakeoffQuantities
  quantities.test.ts   ◄ NOUVEAU
src/lib/roof-core/types.ts
  + interface TakeoffQuantities { surface_m2, surface_3d_m2, perimetre_m,
      pentes: {section_id, x12}[], noues_m, aretes_m, faites_m, accessoires: {...}[],
      complexite_suggeree }  ◄ AJOUT (type partagé, pas de refactor du reste)
src/components/roofing/immersive/
  TakeoffStep.tsx      ◄ NOUVEAU — bouton + overlay plein écran + glue onValidate→FormData
src/types/roofing.ts
  + FormData.roofModel?: RoofModel        ◄ AJOUT champ optionnel
  + FormData.roofQuantities?: TakeoffQuantities
```

### 7.3 Composants à réutiliser tels quels (zéro modification)
- `AdminRoofStudio` (déjà props-driven, déjà monté plein écran par le Training Lab).
- `lib/roof-core/*`, `lib/roof-accessories/*` (fonctions pures).
- `useIsMobile` (`src/hooks/use-mobile.tsx`), pattern overlay de `AdminTrainingLab.tsx:742`.

### 7.4 Hooks / glue partagés à créer
- `deriveTakeoffQuantities(model)` (pur, testable). C'est le **seul** nouveau « moteur ».
- `TakeoffStep.tsx` : ouvre l'overlay, passe `initialModel` (seed), reçoit `onValidate`,
  appelle la dérivation, fait `updateData({ area, slope, complexity, roofModel, roofQuantities })`.

### 7.5 Flow de données
`soumission → takeoff (footprint+image) → AdminRoofStudio → RoofModel → quantities → FormData → pricing → soumissions.roof_model (JSONB)`.

### 7.6 Persistance
- **Ajouter** `soumissions.roof_model JSONB NULL` (et éventuellement
  `roof_quantities JSONB NULL` pour un accès rapide sans recalcul).
- **Régulariser** `training_roof_takeoffs.roof_model` / `roof_sections_v16` (créer la
  migration manquante) — bug latent indépendant de ce projet, à corriger.
- Brouillon local (à l'image de `TrainingTakeoffEditor`, clé `localStorage`) pour
  résister aux crashs mobiles pendant le traçage.

### 7.7 Stratégie mobile plein écran
Réplique exacte du précédent Training Lab : overlay `position:fixed; inset:0; zIndex haut`,
`AdminRoofStudio mode="review"`, boutons Valider/Fermer, retour automatique à l'étape
takeoff au `onValidate`/`onClose`. `useIsMobile` pour adapter la chrome.

### 7.8 Stratégie desktop
Même composant, présenté en **panneau modal large** (ou split-view à côté du formulaire)
plutôt qu'en plein écran intégral — comportement déjà géré par `AdminRoofStudio` sans
changement. Ne pas casser l'usage `/admin/roof-studio` autonome.

### 7.9 Prévention des régressions Roof Model
- Ne pas toucher `AdminRoofStudio`, `roof-core`, le store Zustand ni les routes existantes.
- L'intégration se fait **par-dessus** (nouveau composant + nouvelle fonction pure).
- Conserver `/admin/roof-studio` et `/admin/quote/roof-polygon` opérationnels.
- Tests de `roof-core` (`engine.test.ts`…) servent de filet ; ajouter
  `quantities.test.ts`.

---

## 8. Comportement UX souhaité (précis)

### Mobile
1. Dans une soumission, nouvelle **étape Takeoff** (après confirmation du bâtiment).
2. Bouton **« Tracer le toit »** → ouvre la carte/plan en **plein écran**.
3. Annotation du toit en plein écran (traceur `AdminRoofStudio`, image satellite en fond).
4. Génération/visualisation du **roof model 3D** (déjà fournie par le studio).
5. Validation des quantités (surface 3D, périmètre, pentes, noues, arêtes, accessoires).
6. **Retour automatique** à l'étape Takeoff au `onValidate` (ou manuel via Fermer).
7. **Injection** des surfaces, périmètres, pentes, noues, arêtes, accessoires dans les
   champs de la soumission (`area`, `slope`, `complexity`, + bloc détaillé `roofQuantities`).

### Desktop
- Même composant en panneau modal large / split-view ; édition souris, mêmes sorties.
- Ne remplace pas l'outil admin `RoofPolygonAIInline` existant (peut rester en parallèle
  ou être déprécié plus tard — hors scope de l'intégration de base).

---

## 9. Risques techniques

| Risque | Détail | Gravité |
|---|---|---|
| **Duplication d'état** | 3 systèmes (A/B/C) + 2 stores (Context vs Zustand). Risque de vérités divergentes si on ne canonise pas sur `RoofModel`. | Élevé |
| **Conflit de formats JSON** | `RoofModel` (px image, sections) vs `RoofSectionsBundle` (lat/lng, edges) vs empreinte Google (`path[]` lat/lng) vs `annotations_json`. Conversions à cadrer. | Élevé |
| **Logique de calcul dispersée** | Aires : `geometry.ts` (shoelace), `roof-core/engine.ts` (`face3DArea`), Google `spherical.computeArea`, `roof-sections` diagnostics. Choisir UNE source pour le devis. | Moyen |
| **Persistance manquante / cassée** | `roof_model`/`roof_sections_v16` écrits mais absents du schéma → données potentiellement perdues. `soumissions` sans colonne dédiée. | Élevé |
| **Performance mobile** | Traceur canvas + skeleton + `straight-skeleton` WASM + tuiles satellite → coûteux sur mobile bas de gamme. Prévoir lazy-load (déjà `lazy()` sur le studio) et brouillon local. | Moyen |
| **Sauvegarde partielle** | Crash en plein traçage = perte. Le Training Lab a un brouillon `localStorage` (`TrainingTakeoffEditor.tsx:388-406`) — à répliquer. | Moyen |
| **Navigation inter-modules** | Overlay plein écran dans un wizard à phases : gérer back hardware Android, état du wizard, focus. | Moyen |
| **Couplage à une route** | `RoofPolygonAIWorkspace` suppose son wrapper de route ; **préférer `AdminRoofStudio`** (props-only) pour l'embed. | Faible |
| **Calibration / échelle** | Quantités fiables = échelle correcte (`RoofModelScale`/georef). Sans calibration, surfaces en px non métriques. Le seed depuis footprint géoréférencé doit fixer l'échelle. | Élevé |
| **Régression Roof Model** | Tout refactor de `roof-core`/`AdminRoofStudio` peut casser studio autonome + Training Lab. À éviter en Option A/B. | Élevé en Option C |

---

## 10. Questions à valider avant de coder

1. **Source de surface pour le prix** : on bascule le pricing sur la **surface 3D réelle**
   (`face3DArea`, tient compte de la pente) ou on garde l'empreinte `area_sqft` actuelle et
   le RoofModel n'enrichit que le détail ? (Impact direct sur les montants facturés.)
2. **Échelle/calibration mobile** : accepte-t-on de dériver l'échelle automatiquement du
   footprint géoréférencé (`find_building_polygon`), ou faut-il une étape de calibration
   manuelle dans le takeoff ?
3. **Périmètre des sous-systèmes** : `RoofPolygonAIInline` (SAM, sous-système A) est-il
   conservé, remplacé par le studio, ou gardé en option avancée ?
4. **Public vs admin** : l'étape Takeoff plein écran cible-t-elle le wizard **client public**
   ou seulement l'outil **admin** (`AdminQuoteGenerator`) ? (Le studio est aujourd'hui admin.)
5. **Persistance** : OK pour ajouter une colonne `soumissions.roof_model JSONB` (migration) ?
   Et corrige-t-on la colonne manquante `training_roof_takeoffs.roof_model` au passage ?
6. **Accessoires/ventilation** : doit-on injecter aussi évents/maximums/cheminées dans le
   devis (mapping vers `dynasty_breakdown`) ou seulement les quantités linéaires/surfaces ?
7. **Mapping pente** : `RoofModel` a une pente **par pan** (X/12) ; `FormData.slope` est une
   **catégorie** (`flat`…`12+`). Règle de réduction (pente dominante ? pondérée par aire ?).

---

## 11. Recommandation finale

Adopter **l'Option B (extraction d'un moteur partagé léger)** : réutiliser
`AdminRoofStudio` en overlay plein écran depuis une nouvelle étape `TakeoffStep`, créer
**une** fonction pure `deriveTakeoffQuantities(model)`, ajouter `FormData.roofModel` et la
colonne `soumissions.roof_model`. C'est le meilleur rapport valeur/risque : on s'appuie sur
un composant déjà réutilisable et un précédent d'intégration **déjà en production** (Training
Lab), sans toucher au moteur `roof-core` ni risquer de régression sur le Roof Model existant.
Avant de coder, trancher les questions §10.1 (surface 3D vs empreinte), §10.2 (calibration)
et §10.4 (public vs admin), qui déterminent le périmètre exact.

---

## Décision requise avant codage

Trois options d'intégration. **Aucun code ne doit être écrit avant le choix d'une option et
la validation des questions §10.**

### Option A — Réutilisation minimale (« bouton qui ouvre le studio »)
Monter `AdminRoofStudio` en overlay plein écran depuis le takeoff, récupérer le `RoofModel`
via `onValidate`, et n'injecter que **`area`** (surface) + éventuellement le périmètre dans
`FormData`. Aucune nouvelle colonne (le modèle complet n'est pas persisté, ou stocké dans
`dynasty_breakdown`).
- **Avantages** : le plus rapide ; aucun changement de schéma ; zéro risque sur Roof Model ;
  livrable mobile plein écran immédiat (le précédent existe).
- **Inconvénients** : quantités riches (noues, arêtes, accessoires) non exploitées ni
  persistées proprement ; modèle non rechargeable ; dette si on veut plus tard le détail.
- **Risque** : Faible.
- **Temps estimé** : ~2-3 jours.
- **Recommandation** : bon **MVP / preuve de valeur**, à faire si l'objectif immédiat est
  surtout l'UX mobile plein écran.

### Option B — Extraction moteur partagé *(recommandée)*
Option A **+** module pur `deriveTakeoffQuantities(model)` (surfaces 3D, périmètre, pentes
par pan, noues, arêtes, faîtes, accessoires) **+** `FormData.roofModel`/`roofQuantities`
**+** colonne `soumissions.roof_model JSONB` (et régularisation de la colonne manquante côté
Training Lab). Aucun refactor de `roof-core`/`AdminRoofStudio`.
- **Avantages** : une seule vérité (`RoofModel`) ; quantités complètes injectées et
  persistées ; modèle rechargeable/éditable ; réutilise le pont Soumission↔Training Lab ;
  pas de régression (on ajoute, on ne modifie pas).
- **Inconvénients** : nécessite une migration ; demande de trancher la règle surface/pente
  pour le prix (§10.1, §10.7).
- **Risque** : Moyen (concentré sur la dérivation des quantités et la calibration d'échelle).
- **Temps estimé** : ~5-8 jours.
- **Recommandation** : **meilleur équilibre**. Cible recommandée.

### Option C — Fusion profonde avec refactor
Unifier les trois sous-systèmes : un seul moteur d'annotation/géométrie, suppression de
`RoofPolygonAIInline` et/ou convergence `roof-sections` ↔ `roof-core`, store partagé,
persistance unifiée (soumissions + training_roof_takeoffs).
- **Avantages** : élimine la duplication structurelle ; base saine à long terme ; un seul
  format, un seul calcul, un seul éditeur.
- **Inconvénients** : gros chantier transverse ; touche du code en production
  (studio autonome, Training Lab, flux public) ; conversions lat/lng↔px↔sections à
  réconcilier.
- **Risque** : Élevé (forte surface de régression).
- **Temps estimé** : ~3-5 semaines.
- **Recommandation** : à **planifier plus tard**, idéalement **après** l'Option B en
  production, comme refactor de consolidation — pas comme première étape.

---

> **Réponse attendue : choisir A, B ou C, puis valider les questions §10.** Tant que ce
> choix n'est pas confirmé, aucun fichier de code, hook, composant ou migration ne sera créé.
