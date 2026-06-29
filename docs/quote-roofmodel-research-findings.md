# Recherche détaillée — Modules Soumission & Roof Model

> Document de **référence de recherche** (analyse seulement, aucun code modifié).
> Complément au document de décision `docs/quote-roofmodel-integration-audit.md`.
> Ce fichier consolide *toutes* les découvertes : inventaire de fichiers, schémas
> Supabase, structures de données, flux de calcul, persistance et migrations.

Date : 2026-05-26 · Branche : `claude/quote-roofmodel-audit-aXRf5`

---

## Table des matières
1. [Les trois sous-systèmes de géométrie](#1-les-trois-sous-systèmes-de-géométrie)
2. [Inventaire complet des fichiers](#2-inventaire-complet-des-fichiers)
3. [Schéma Supabase détaillé](#3-schéma-supabase-détaillé)
4. [Structures de données clés](#4-structures-de-données-clés)
5. [Flux de calcul & pricing](#5-flux-de-calcul--pricing)
6. [Persistance (client & serveur)](#6-persistance-client--serveur)
7. [Migrations (inventaire)](#7-migrations-inventaire)
8. [Constats & lacunes d'intégration](#8-constats--lacunes-dintégration)
9. [Index des références fichier:ligne](#9-index-des-références-fichierligne)

---

## 1. Les trois sous-systèmes de géométrie

L'application contient **trois** pipelines d'annotation/géométrie de toiture distincts.

| # | Sous-système | Hôte | Sortie | Moteur | Persistance |
|---|---|---|---|---|---|
| **A** | `RoofPolygonAIInline` (empreinte SAM) | `AdminQuoteGenerator` via `MapToolbox` | empreinte unique `{ path[], areaM2, perimeterM }` | Google Maps `geometry.spherical` + edge functions SAM (`roof-polygon-enhance/segment`) | aucune (callback `onConfirmPolygon`) |
| **B** | **Roof Model** : `AdminRoofStudio` + `RoofPolygonAIWorkspace` + `lib/roof-core` | `/admin/roof-studio`, `/admin/quote/roof-polygon` | `RoofModel` 3D complet (sections, pentes, noues, arêtes, faîtes, accessoires) | `lib/roof-core/engine.ts` (straight-skeleton, local + CGAL/WASM) | aucune propre (`onValidate(model)`) ; export JSON |
| **C** | **Training Lab** : `TrainingTakeoffEditor` + `lib/roof-sections` | `/admin/training-lab` | mesures par outil + `roof_sections` + `roof_edges` | Google Maps + `lib/skeleton-overlay` + `roof-sections` | table `training_roof_takeoffs.annotations_json` |

**Le sous-système B (Roof Model) est la cible d'intégration.** Il est déjà piloté par props
et déjà monté en plein écran par le Training Lab (précédent réutilisable).

---

## 2. Inventaire complet des fichiers

### 2.1 Module Soumission / Quote
**Routing & entrée**
- `src/App.tsx:79` → route `/admin/quote` (`AdminQuoteGenerator`)
- `src/App.tsx:80-87` → route `/admin/quote/roof-polygon` (`AdminRoofPolygonAI`, lazy)
- `src/components/roofing/RoofingApp.tsx` → `FormProvider` + `ImmersiveWizard`
- `src/pages/AdminQuoteGenerator.tsx` → page admin, hôte de `RoofPolygonAIInline`

**Wizards**
- `src/components/roofing/immersive/ImmersiveWizard.tsx` (~2700 l.) — principal, phases
  `intro → form → computing → result`, étapes Adresse → Bâtiment → Travaux → Analyse IA → Client
- `src/components/roofing/FormWizard.tsx` — legacy 8 étapes
- `src/components/roofing/Stepper.tsx`

**Étapes**
- `src/components/roofing/steps/` : `StepAddress`, `StepArea`, `StepCoverage`,
  `StepComplexity`, `StepSlope`, `StepProduct`, `StepColor`, `StepClient`, `StepDate`
- `src/components/roofing/immersive/StepCoverageImmersive.tsx`

**Carte / annotation (takeoff actuel)**
- `src/components/roofing/immersive/BuildingConfirmation.tsx` — RPC `find_building_polygon`
- `src/components/roofing/immersive/BuildingMapPicker.tsx`
- `src/components/roofing/immersive/BuildingReadOnlyMap.tsx`
- `src/components/roofing/immersive/BuildingPolygonOverlay.tsx`
- `src/components/roofing/immersive/MapToolbox.tsx`
- `src/components/roofing/immersive/MobilePrecisionLayer.tsx`
- `src/components/roofing/immersive/RoofPolygonAIInline.tsx` (sous-système A)

**UI advisor / aperçu**
- `AdvisorAnalysis`, `AdvisorBubble`, `AdvisorChat`, `SlopeAnalysis`, `RoofPreview`,
  `RepairDetailsChat`, `ProgressDrawer`, `Globe`, `IsometricHouse`, `DateAvailability`
  (tous dans `src/components/roofing/immersive/`)

**État / types**
- `src/context/FormContext.tsx` — seul store du module (Context + `useState`)
- `src/types/roofing.ts` — `FormData`, enums, facteurs, `computeEstimation`, `sqmToSqft`

**Calcul & pricing**
- `src/lib/pricing-matrix.ts` — `computeMatrixEstimate`, `SLOPE_COEFFS`, table de prix
- `src/lib/dynasty-calculator.ts` — `computeDynastyQuote`
- `src/lib/quote-variables.ts`, `src/lib/quote-settings.ts`
- `src/lib/pdf-generators.ts`, `src/lib/pdf-storage.ts`

**Hooks**
- `src/hooks/useProjects.ts` — lecture `soumissions` (React Query + realtime)
- `src/hooks/mutations/projectMutations.ts` — `useUpdateProject`

### 2.2 Module Roof Model (sous-système B)
**Pages / hôtes**
- `src/pages/AdminRoofStudio.tsx` (~1131 l.) — traceur 2D + aperçu 3D (canvas natif, math
  maison ; props `initialModel?`, `backgroundImage?`, `mode?`, `onValidate?`, `onClose?`)
- `src/pages/AdminRoofPolygonAI.tsx` — wrapper → `RoofPolygonAIWorkspace`

**Workspace 2D (Konva)**
- `src/components/roof-polygon-ai/RoofPolygonAIWorkspace.tsx`
- `src/components/roof-polygon-ai/Canvas.tsx`
- `src/components/roof-polygon-ai/ToolPanel.tsx`
- `src/components/roof-polygon-ai/LayersPanel.tsx`
- `src/components/roof-polygon-ai/store.ts` — store **Zustand** local (non global)
- `src/components/roof-polygon-ai/geometry.ts` — `shoelaceArea`, `perimeter`,
  `pixelsToMeters`, `simplifyPolygon`, `maskToPolygon`, `distance`
- `src/components/roof-polygon-ai/pipeline.ts` — `runEnhance`, `runSegment`,
  `exportProjectJson`

**Moteur géométrique `src/lib/roof-core/`**
- `engine.ts` (~1165 l.) — straight-skeleton (local + CGAL/WASM `straight-skeleton`),
  `getFacePitches`, `facePlaneFromFace`, `sectionRoofHeightAt`, `findValleys`,
  `face3DArea`, `isPignon`, `buildView`, `proj3`, `draw2D`, `render3D`
- `types.ts` — `RoofModel`, `RoofSectionInput`, `RoofModelScale`/`RoofGeoref`, conversions
- `annotation.ts` — `buildAnnotation`/`parseAnnotation`, `ENGINE_VERSION`,
  `ANNOTATION_VERSION`, provenance `source` (`mvp`/`human`/`merged`)
- `viewport.ts` — transformations vue
- `adapters/fromRoofSectionsV16.ts` — MVP v1.6 → `RoofModel`
- Tests : `engine.test.ts`, `annotation.test.ts`, `viewport.test.ts`,
  `adapters/fromRoofSectionsV16.test.ts`

**Accessoires `src/lib/roof-accessories/`**
- `types.ts` (`AccessoryAnchor`, `AccessoryInstance`), `anchor.ts`, `resolve.ts`,
  `catalog.ts`, `max-301.product-spec.json`, `ventilationValidation.ts` (NFA 1/300 ou 1/150)

### 2.3 Module Training Lab & sections partagées (sous-système C)
- `src/pages/AdminTrainingLab.tsx` (~670 l.) — UI admin ; monte `AdminRoofStudio` en
  overlay plein écran (`:742-753`, `position:fixed; inset:0; zIndex:11000`, `mode="review"`)
- `src/components/training-lab/TrainingTakeoffEditor.tsx` (~595 l.) — éditeur sections sur carte
- `src/lib/training-lab.ts` (~573 l.) — interface `TrainingTakeoff`, `buildRichAnnotations`,
  `buildTrainingAnnotationsFromSoumissionBreakdown`, `recoverTakeoffGeometryFromSoumission`,
  `buildBundleZip`, `importFromSoumissions`
- `src/lib/roof-sections.ts` (~726 l.) — `RoofSection`, `RoofEdge`, `RoofSectionsBundle`,
  `buildSectionsBundle`, `deriveRoofEdges`, diagnostics
- `src/lib/roof-sections-ops.ts` (~525 l.) — `consolidateSections`, `splitNonConvexSections`,
  `optimizeSections`
- `src/lib/skeleton-overlay.ts`, `src/lib/skeleton-pipeline.ts`

---

## 3. Schéma Supabase détaillé

### 3.1 `soumissions` (devis)
Migration `supabase/migrations/20260215221848_*.sql` · type `types.ts:1515-1648` · PK `id` (UUID)
- **Client** : `first_name`, `last_name`, `email`, `phone`, `contact_preference`
- **Adresse** : `formatted_address`, `place_id`, `lat`, `lng` (DOUBLE PRECISION)
- **Toit** : `coverage_type`, `building_type`, `roof_category`, `slope`, `complexity`,
  `area_sqft`, `area_input`, `area_unit`
- **Produit** : `product_id`, `product_name`, `product_brand`, `color`, `price_per_sqft`,
  `work_type`
- **Prix** : `low_estimate`, `high_estimate`, `subtotal`, `mobilisation`,
  `complexity_factor`, `slope_factor`
- **JSON** : `dynasty_breakdown` (JSONB, `:1528/1570/1612`), `utm` (JSONB)
- **Méta** : `created_at`, `updated_at` (via `20260509130000_soumissions_updated_at.sql`),
  `status`, `seq_number`, `form_session_id`, `reference_id`, `user_agent`, `page_url`
- ⚠️ **Aucune colonne structurée pour la géométrie de toit** (sections, noues, arêtes,
  pentes par pan). Seul réceptacle JSON libre : `dynasty_breakdown`.

### 3.2 `training_roof_takeoffs` (Training Lab)
Migration `20260524000000_training_lab.sql` · type `types.ts:1704+` · PK `id` (UUID)
- **Lien** : `source_takeoff_id` (→ `soumissions.id`), `reference`, `address`
- **Images** : `raw_image_url`, `annotated_image_url`, `debug_overlay_url`, `json_url`
- **Géométries** : `original_/corrected_building_geojson`, `original_/corrected_lot_geojson`
- **Annotations** : `annotations_json` (JSONB, `:1708`) — segments, marqueurs, `roof_sections`,
  `roof_edges`, totaux
- **Calibration** : `calibration_status`, `calibration_offset_px/m`,
  `calibration_rotation_deg`, `calibration_scale`, `calibration_confidence`,
  `calibration_notes`
- **Cycle de vie** : `dataset_status` (`draft`→`validated`→`exported`…), `quality_score`,
  `tags[]`, `human_notes`, `export_batch_id`
- **Index** : `idx_trt_status`, `idx_trt_source`
- ⚠️ **`roof_model` et `roof_sections_v16`** : déclarés dans `src/lib/training-lab.ts:28-31`
  et écrits via `AdminTrainingLab.tsx:186` (`updateRow(id, { roof_model })`), **mais absents
  de toute migration et du type généré** (vérifié : `grep roof_model supabase/migrations/`
  = 0 résultat). Bug latent.

### 3.3 `training_export_batches`
Migration `20260524000000` · type `types.ts:1668-1702` · PK `id`
- `created_at`, `created_by`, `status`, `schema_version`, `description`,
  `takeoff_ids[]`, `bundle_url`, `metadata` (JSONB)

### 3.4 Pricing (non persisté comme table dédiée — code)
`src/lib/pricing-matrix.ts` — clé `"${workType}|${roofSubtype}|${slopeLabel}"` →
`[price_low, price_high]` ; `SLOPE_COEFFS` (1.00 / 1.12 / 1.32 / 1.58 ; 1.05 membranes)

### 3.5 RPC
- `find_building_polygon(p_lat, p_lng, p_radius_meters)` → `geojson`, `lot_geojson`,
  `superficie` (m²), `perimetre` (m), `largeur`, `profondeur`

---

## 4. Structures de données clés

### 4.1 `FormData` (`src/types/roofing.ts:71-87`)
```ts
interface FormData {
  client: ClientInfo; address: AddressInfo | null;
  coverageType: CoverageType | null; complexity: ComplexityLevel | null;
  slope: SlopeLevel | null; area: number; areaUnit: AreaUnit;
  product: Product | null; color: string; contactPreference: ContactPreference;
  workType: WorkType | null; repairMessages: RepairMessage[]; repairPhotos: string[];
  constructionPlans: string[]; projectDetails: string;
}
```
**→ Aucun champ géométrie de toit (sections/pentes/noues/arêtes).**

Enums & facteurs :
- `CoverageType` : 8 valeurs (`membrane_elastomere/gravier`, `shingle_2pans/4pans/4pans_plus`,
  `tole_2pans/4pans/4pans_plus`)
- `ComplexityLevel` → `COMPLEXITY_FACTORS` (simple 1.0 → tres_complexe 1.4)
- `SlopeLevel` (`flat`,`4-7`,`7-9`,`9-12`,`12+`) → `SLOPE_FACTORS` (1.0 → 1.35)
- `sqmToSqft(sqm) = sqm * 10.7639` ; `MOBILISATION = 350` CAD

### 4.2 `RoofModel` (`src/lib/roof-core/types.ts`)
```ts
interface RoofModel {
  version: 1; image?: ...; scale?: RoofModelScale;
  sections: RoofSectionInput[]; alternatives?: ...; metadata: {...};
}
interface RoofSectionInput { pts; pitch; elev; hf; roof_type: "hip" | "gable"; }
```
Moteur dérive : faces 3D, pentes par face (`getFacePitches`), noues (`findValleys`),
aires 3D (`face3DArea`), pignons (`isPignon`).

### 4.3 `RoofSection` / `RoofEdge` (`src/lib/roof-sections.ts`)
```ts
interface RoofSection { section_id; polygon_px; polygon_latlng;
  section_type: MAIN|SECONDARY|GARAGE|DORMER|FLAT|UNKNOWN; section_role?;
  pitch_deg; aspect_deg; quality_flag: VERIFIED|ESTIMATED|UNCERTAIN; label?; }
interface RoofEdge { edge_id; edge_type: RIDGE|VALLEY|HIP|EAVE|GABLE;
  section_a; section_b; points_px; points_latlng; length_m; derived; }
interface RoofSectionsBundle { roof_sections; roof_edges; migration_status; diagnostics; }
```
Seuils : `MICRO_AREA_M2=15`, `CONVEXITY_MIN=0.90`, `COVERAGE_TARGET=0.95`,
`SECTION_COUNT 5..7`.

### 4.4 `TrainingTakeoff` (`src/lib/training-lab.ts:5-35`)
Champs persistés (cf. §3.2) + `roof_sections_v16` / `roof_model` (interface seulement).

### 4.5 Types inline
- `ImmersiveWizard` : `RoofType` (`2pans`…`unknown`), `SlopeCategory`
  (`faible`…`tres_raide`), `PolygonAdjustments {offsetEastM, offsetNorthM, rotationDeg}`
- `RoofPolygonAIInline` : `CaptureParams`, `AiOverlay`, `AiResult`
- `MapToolbox` : `MapToolboxControls`

---

## 5. Flux de calcul & pricing

**Surface :** priorité (`ImmersiveWizard:~1130`)
```
areaSqft = buildingSuperficie ? sqmToSqft(buildingSuperficie)
         : (areaUnit==='sqm' ? sqmToSqft(area) : area)
perimeterFt = buildingPerimetre ? buildingPerimetre*3.28084 : 0
```
**Facteurs :** `complexity` (explicite ou dérivée du `coverageType`) ;
`slope` → `SLOPE_FACTORS`.
**Estimation simple (`types/roofing.ts:103-122`) :**
```
base = areaSqft * pricePerSqft
subtotal = base * complexityFactor * slopeFactor
low = subtotal*0.93 + 350 ; high = subtotal*1.1 + 350
```
**Matrice :** `computeMatrixEstimate(coverageType, slope, footprintSqft, workType)`.
**Dynasty :** `computeDynastyQuote(areaSqft, perimeterFt, vision)` → `dynasty_breakdown`
(lignes, sous-totaux, contingence 10%, TPS/TVQ, total).
**Aires — sources multiples (à canoniser) :** `geometry.ts` (shoelace), `roof-core`
(`face3DArea`), Google `spherical.computeArea`, diagnostics `roof-sections`.

---

## 6. Persistance (client & serveur)

**localStorage**
- `imm_roofing_data` / `imm_roofing_step` (ImmersiveWizard, auto-restore < 24 h, purgé au submit)
- `quote_settings_v1` (`quote-settings.ts`)
- `TrainingTakeoffEditor` : brouillon local (`:388-406`)
- Session Supabase (`client.ts` : `persistSession: true`)

**Zustand** : `roof-polygon-ai/store.ts` (workspace 2D, non persisté)

**React Query** : `useProjects` (staleTime 30 s) + canal realtime `projects-stream`

**Supabase (au submit)** : insert `soumissions` + `form_sessions` (timings, debounce 1.5 s)
+ `soumission_notes` (summary/repair/plans/details) + upload bucket `quote-pdfs/{sessionId}/`
+ edge function `send-quote-email`

**Roof Model** : aucune persistance propre (`onValidate(model)` / export JSON).

---

## 7. Migrations (inventaire)

Phases (sélection) :
- **Core (fév. 2026)** : `20260215221848` soumissions + bucket `quote-pdfs` ;
  `20260215222049` RLS
- **Extensions (fév.–mars)** : pricing_matrix, products, form_sessions, appointments,
  schedule_tasks, UTM, soumission_notes
- **Quote & contrat (mars–mai)** : dispatch, equipment, email_templates, status,
  `20260522000000` contract_signature_system (+ retry `20260523000000`)
- **Training Lab (mai)** : `20260524000000_training_lab` (training_roof_takeoffs,
  training_export_batches, bucket `training-assets`, trigger updated_at) ;
  `20260525000000_training_lab_apply`
- **Récent** : `20260526000000_contract_archived_at`,
  `20260527000000_soumission_notes_allow_session`,
  `20260527120000_reapply_…`, `20260528000000_skeleton_tests_diagnostics`

⚠️ Aucune migration ne crée `roof_model` ni `roof_sections_v16`.

---

## 8. Constats & lacunes d'intégration

1. **Pas d'étape Takeoff dédiée** : quantification implicite (`area_sqft` + `slope` +
   `complexity`). `FormData` sans champ géométrie.
2. **`AdminRoofStudio` déjà réutilisable** : props-only, déjà monté plein écran par le
   Training Lab (`AdminTrainingLab.tsx:742`). Précédent d'intégration mobile existant.
3. **Persistance RoofModel manquante** : colonnes `roof_model`/`roof_sections_v16` écrites
   mais absentes du schéma ; `soumissions` sans colonne dédiée.
4. **Trois formats à réconcilier** : `RoofModel` (px image/sections) vs
   `RoofSectionsBundle` (lat/lng/edges) vs empreinte Google (`path[]` lat/lng) vs
   `annotations_json`.
5. **Calcul d'aire dispersé** : choisir **une** source pour le devis (surface 3D vs empreinte).
6. **Pont existant Soumission → Training Lab** (`recoverTakeoffGeometryFromSoumission`,
   `importFromSoumissions`) mais **pas** de retour Takeoff → Soumission des quantités.
7. **Calibration/échelle** : quantités fiables = échelle correcte (georef depuis footprint).

→ Options d'intégration, plan par phases et recommandation : voir
`docs/quote-roofmodel-integration-audit.md` (§ « Décision requise avant codage »).

---

## 9. Index des références fichier:ligne

| Élément | Référence |
|---|---|
| Routes quote / roof-polygon | `src/App.tsx:79`, `:80-87` |
| Wizard immersif | `src/components/roofing/immersive/ImmersiveWizard.tsx` |
| RPC bâtiment | `src/components/roofing/immersive/BuildingConfirmation.tsx` |
| Empreinte SAM (A) | `src/components/roofing/immersive/RoofPolygonAIInline.tsx` |
| Studio Roof Model (B) | `src/pages/AdminRoofStudio.tsx:23-29,52` |
| Moteur géométrique | `src/lib/roof-core/engine.ts`, `types.ts`, `annotation.ts` |
| Adaptateur MVP | `src/lib/roof-core/adapters/fromRoofSectionsV16.ts` |
| Accessoires | `src/lib/roof-accessories/*` |
| Sections (C) | `src/lib/roof-sections.ts`, `roof-sections-ops.ts` |
| Éditeur Training | `src/components/training-lab/TrainingTakeoffEditor.tsx` |
| Overlay plein écran (précédent) | `src/pages/AdminTrainingLab.tsx:742-753` |
| `roof_model` écrit sans colonne | `src/pages/AdminTrainingLab.tsx:186`, `src/lib/training-lab.ts:28-31` |
| FormData / enums | `src/types/roofing.ts:71-87`, `:42-48`, `:103-122` |
| Store du module | `src/context/FormContext.tsx` |
| Store workspace 2D | `src/components/roof-polygon-ai/store.ts` |
| Pricing | `src/lib/pricing-matrix.ts`, `src/lib/dynasty-calculator.ts` |
| Schéma soumissions | `src/integrations/supabase/types.ts:1515-1648` |
| Schéma training takeoffs | `src/integrations/supabase/types.ts:1704+` |
| Migration training lab | `supabase/migrations/20260524000000_training_lab.sql` |
| Migration soumissions | `supabase/migrations/20260215221848_*.sql` |
| Hooks soumissions | `src/hooks/useProjects.ts`, `src/hooks/mutations/projectMutations.ts` |
