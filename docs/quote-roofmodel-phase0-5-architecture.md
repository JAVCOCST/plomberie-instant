# Phase 0.5 — Architecture cible : intégration Roof Model → Takeoff → Quote

> **PRÉPARATION ARCHITECTURE — AUCUN CODE.** Aucun refactor, aucune réécriture du
> roof engine, aucune migration appliquée, aucun changement de comportement existant.
> Ce document conçoit la structure cible avant la Phase 1.
>
> Option retenue : **B** (extraction d'un moteur partagé léger).
> Décision structurante : **introduire une couche métier intermédiaire `RoofTakeoff`** entre
> le `RoofModel` (géométrie pure) et le `Quote`. Le `RoofModel` ne devient **jamais** le
> modèle métier du takeoff.

Date : 2026-05-26 · Branche : `claude/quote-roofmodel-audit-aXRf5`
Réfs : `docs/quote-roofmodel-integration-audit.md`, `docs/quote-roofmodel-research-findings.md`

---

## 0. Principe directeur

```
RoofModel            →   RoofTakeoff             →   Quote
(géométrie pure)         (modèle métier de            (devis / pricing)
 lib/roof-core           quantification)               soumissions + FormData
                         lib/roof-takeoff (NOUVEAU)
```

- `RoofModel` = **vérité géométrique** produite/éditée par le studio. Immuable côté takeoff.
- `RoofTakeoff` = **modèle métier de quantification**. Il *référence* un snapshot de
  `RoofModel`, calcule des dérivées, porte les décisions humaines et expose des
  *pricing inputs*. C'est lui qui est persisté et versionné.
- `Quote` = consomme une **projection** du `RoofTakeoff` (pas le RoofModel directement).

Règle d'or : **les dépendances ne pointent que vers la gauche.**
`quote → roof-takeoff → roof-core`. Jamais l'inverse.

---

## 1. RoofTakeoff Domain Model

### 1.1 Les quatre strates (séparation explicite)

| Strate | Nature | Mutable par l'humain ? | Recalculable ? | Source |
|---|---|---|---|---|
| **A. Géométrie brute** | snapshot RoofModel + imagerie + calibration | non (figée au snapshot) | non | studio (`onValidate`) |
| **B. Données dérivées** | sections, pentes, noues, faîtes, arêtes, débords, mesures | non (jamais éditées à la main) | **oui** (fonctions pures `roof-core`) | `deriveTakeoff()` |
| **C. Données métier** | rôles, scope de travaux, pénétrations, accessoires, overrides | **oui** | non | utilisateur |
| **D. Pricing inputs** | aires, périmètres, métrés linéaires, comptages, facteurs | dérivé + ajustable | partiellement | `buildPricingInputs()` |

> Invariant : la strate B est **toujours reproductible** à partir de A. Si on perd B, on la
> régénère depuis le snapshot. La strate C ne se régénère **pas** (décisions humaines) → c'est
> elle qu'il faut protéger en priorité à la persistance.

### 1.2 Types proposés (`src/lib/roof-takeoff/types.ts`)

```ts
// ─────────────────────────────────────────────────────────────
// RoofTakeoff — modèle métier de quantification (NOUVEAU)
// Dépend de roof-core (types géométriques) ; NE dépend PAS du quote.
// ─────────────────────────────────────────────────────────────
import type { RoofModel } from "@/lib/roof-core/types";

export const ROOF_TAKEOFF_SCHEMA_VERSION = "1.0.0";

export type Unit = "m" | "ft";
export type SlopeLevel = "flat" | "4-7" | "7-9" | "9-12" | "12+"; // aligné types/roofing.ts
export type ComplexityLevel = "simple" | "moyenne" | "complexe" | "tres_complexe";

// ===== STRATE A — GÉOMÉTRIE BRUTE =====
export interface SourceImagery {
  provider: "google_satellite" | "orthoqc_wmts" | "upload";
  capturedAt: string;            // ISO
  centerLat: number; centerLng: number; zoom: number;
  bounds: { north: number; south: number; east: number; west: number };
  imageUrl?: string;             // storage path (pas de data-URL persistée)
  widthPx?: number; heightPx?: number;
}

export interface Calibration {
  status: "auto_georef" | "manual" | "uncalibrated";
  pixelsPerMeter?: number;
  offsetM?: { x: number; y: number };
  rotationDeg?: number;
  scale?: number;
  confidence?: number;           // 0..1
  notes?: string;
}

export interface RoofModelSnapshot {
  roofModel: RoofModel;          // géométrie pure, figée
  engineVersion: string;         // roof-core/annotation.ts ENGINE_VERSION
  annotationVersion: number;     // ANNOTATION_VERSION
  snapshotAt: string;            // ISO
}

export interface RoofGeometry {
  snapshot: RoofModelSnapshot;
  imagery: SourceImagery | null;
  calibration: Calibration;
}

// ===== STRATE B — DONNÉES DÉRIVÉES (pures, recalculables) =====
export type SectionType = "MAIN" | "SECONDARY" | "GARAGE" | "DORMER" | "FLAT" | "UNKNOWN";
export type EdgeKind = "RIDGE" | "VALLEY" | "HIP" | "EAVE" | "RAKE"; // RAKE = rampant/pignon
export type QualityFlag = "VERIFIED" | "ESTIMATED" | "UNCERTAIN";

export interface DerivedSection {
  id: string;
  type: SectionType;
  areaFootprintM2: number;       // projetée au sol
  area3dM2: number;              // réelle (tient compte de la pente)
  pitchDeg: number;              // pente du pan
  pitchX12: number;              // pente en X/12 (toiture QC)
  aspectDeg: number;             // orientation
  perimeterM: number;
  quality: QualityFlag;
}

export interface DerivedSlope {           // agrégat pente
  sectionId: string;
  pitchDeg: number; pitchX12: number;
  level: SlopeLevel;             // mappé sur la catégorie de devis
}

export interface DerivedEdge {
  id: string; kind: EdgeKind;
  lengthM: number;
  sectionA?: string; sectionB?: string;
}

export interface DerivedMeasurements {
  footprintAreaM2: number;
  roof3dAreaM2: number;
  totalPerimeterM: number;
  linealByKind: Record<EdgeKind, number>;  // RIDGE/VALLEY/HIP/EAVE/RAKE → ml
  dominantPitchX12: number;
  dominantSlopeLevel: SlopeLevel;
  sectionCount: number;
  diagnostics: {
    coveragePct: number;          // sections vs footprint
    overlapPct: number;
    warnings: string[];
  };
}

export interface RoofDerived {
  sections: DerivedSection[];
  slopes: DerivedSlope[];
  ridges: DerivedEdge[];
  hips: DerivedEdge[];
  valleys: DerivedEdge[];
  eaves: DerivedEdge[];
  rakes: DerivedEdge[];
  measurements: DerivedMeasurements;
  computedAt: string;            // ISO — invalidé si snapshot change
  derivedFromSnapshotAt: string; // doit == geometry.snapshot.snapshotAt
}

// ===== STRATE C — DONNÉES MÉTIER (décisions humaines) =====
export type WorkScope = "refection" | "nouvelle_couverture" | "reparation" | "inspection";

export interface Penetration {
  id: string;
  kind: "cheminee" | "puits_lumiere" | "event" | "tuyau" | "trappe" | "autre";
  sectionId?: string;
  anchor?: unknown;              // AccessoryAnchor (roof-accessories) — non couplé en dur
  countAsUnit: boolean;
  note?: string;
}

export interface AccessoryItem {
  id: string;
  catalogId?: string;            // roof-accessories/catalog
  kind: string;                  // event de toit, max-301, solin, etc.
  quantity: number;
  unit: "unite" | "ml" | "m2";
  anchor?: unknown;              // AccessoryAnchor
}

export interface ManualOverride {
  field: string;                 // ex: "measurements.roof3dAreaM2"
  value: number | string;
  reason?: string;
  by?: string; at: string;
}

export interface RoofBusiness {
  workScope: WorkScope;
  sectionRoleOverrides: Record<string, SectionType>;
  complexityOverride?: ComplexityLevel;
  slopeOverride?: SlopeLevel;
  penetrations: Penetration[];
  accessories: AccessoryItem[];
  overrides: ManualOverride[];
  notes?: string;
}

// ===== STRATE D — PRICING INPUTS (dérivé + ajustable) =====
export interface PricingInputs {
  // Tout est exprimé dans des unités directement consommables par
  // pricing-matrix.ts / dynasty-calculator.ts (SANS les importer ici).
  footprintAreaSqft: number;
  roof3dAreaSqft: number;
  perimeterFt: number;
  slopeLevel: SlopeLevel;
  complexityLevel: ComplexityLevel;
  linealFt: { ridge: number; hip: number; valley: number; eave: number; rake: number };
  accessoryCounts: Record<string, number>;
  wasteFactorPct: number;        // défaut 10 (cohérent dynasty contingency)
  source: "derived" | "derived_with_overrides" | "manual";
}

// ===== CROSS-CUTTING : métadonnées, révision, validation =====
export interface RevisionState {
  revision: number;              // incrémenté à chaque sauvegarde validée
  parentRevision?: number;
  status: "draft" | "autosaved" | "validated" | "superseded";
  createdAt: string; updatedAt: string;
  createdBy?: string;
}

export type ValidationLevel = "ok" | "warning" | "error";
export interface ValidationIssue { code: string; level: ValidationLevel; message: string; path?: string; }
export interface ValidationState {
  level: ValidationLevel;
  issues: ValidationIssue[];
  validatedByHuman: boolean;
  validatedAt?: string;
}

export interface TakeoffMetadata {
  schemaVersion: string;         // ROOF_TAKEOFF_SCHEMA_VERSION
  soumissionId?: string;         // lien vers le devis (FK logique)
  trainingTakeoffId?: string;    // lien optionnel vers training_roof_takeoffs
  origin: "studio" | "import" | "manual";
  label?: string; address?: string;
}

// ===== AGRÉGAT RACINE =====
export interface RoofTakeoff {
  id: string;
  metadata: TakeoffMetadata;
  geometry: RoofGeometry;        // A
  derived: RoofDerived;          // B (recalculable)
  business: RoofBusiness;        // C
  pricing: PricingInputs;        // D
  revision: RevisionState;
  validation: ValidationState;
}
```

### 1.3 Fonctions de domaine (pures, sans DOM, testables)

```ts
// src/lib/roof-takeoff/derive.ts
deriveRoofTakeoff(model: RoofModel, opts): RoofDerived          // B ← A, via roof-core
// src/lib/roof-takeoff/pricing-inputs.ts
buildPricingInputs(t: RoofTakeoff): PricingInputs               // D ← B+C
// src/lib/roof-takeoff/quote-binding.ts
toFormDataPatch(t: RoofTakeoff): Partial<FormData>              // projection vers le devis
// src/lib/roof-takeoff/factory.ts
fromRoofModel(model, imagery, calibration): RoofTakeoff         // A→B init
emptyRoofTakeoff(): RoofTakeoff
// src/lib/roof-takeoff/validate.ts
validateRoofTakeoff(t: RoofTakeoff): ValidationState
```

> `derive.ts` est le **seul** point qui appelle `roof-core` (`getFacePitches`, `findValleys`,
> `face3DArea`, `deriveRoofEdges`…). Aucun composant UI n'appelle directement le moteur pour
> calculer des quantités métier.

---

## 2. Séparation des responsabilités

```
┌──────────────────────────────────────────────────────────────────────────┐
│ roof-core  (lib/roof-core, lib/roof-accessories, lib/roof-sections*)       │
│  • Géométrie pure : skeleton, faces 3D, pentes, noues, aires, accessoires  │
│  • Rendu math (draw2D/render3D sur Canvas 2D)                              │
│  • AUCUNE notion de devis, de prix, de Supabase, de FormData               │
│  • Sortie : RoofModel + primitives géométriques                           │
└──────────────────────────────────────────────────────────────────────────┘
                 ▲ (importé en lecture seule)
┌──────────────────────────────────────────────────────────────────────────┐
│ roof studio  (pages/AdminRoofStudio, components/roof-polygon-ai/*)         │
│  • UI d'annotation/édition + aperçu 3D                                     │
│  • Piloté par props : initialModel, backgroundImage, mode, onValidate      │
│  • Émet un RoofModel via onValidate(model)                                 │
│  • NE connaît PAS RoofTakeoff ni Quote                                     │
└──────────────────────────────────────────────────────────────────────────┘
                 ▲ (onValidate → RoofModel)
┌──────────────────────────────────────────────────────────────────────────┐
│ takeoff domain  (lib/roof-takeoff — NOUVEAU)                               │
│  • RoofTakeoff (A/B/C/D), derive/pricing/validate/quote-binding           │
│  • Persistance domaine (draft + révisions)                                 │
│  • Importe roof-core ; NE dépend PAS du quote module                       │
└──────────────────────────────────────────────────────────────────────────┘
                 ▲ (toFormDataPatch / pricingInputs)
┌──────────────────────────────────────────────────────────────────────────┐
│ quote domain  (components/roofing/*, types/roofing.ts, pricing-matrix,     │
│                dynasty-calculator, hooks/soumissions)                       │
│  • Wizard, FormData, pricing, PDF, persistance soumissions                 │
│  • Consomme une projection du RoofTakeoff (jamais le RoofModel brut)       │
│  • Hôte de l'overlay takeoff (mais ignore la géométrie interne)            │
└──────────────────────────────────────────────────────────────────────────┘
```

Responsabilités d'« assemblage » (glue) — un seul composant, côté quote :
`TakeoffFullscreen` ouvre le studio, reçoit le `RoofModel`, appelle `lib/roof-takeoff` pour
produire le `RoofTakeoff`, puis injecte `toFormDataPatch()` dans le `FormContext`.

---

## 3. Modes du studio

`AdminRoofStudio` expose déjà `mode?: "free" | "review"`. On **ajoute conceptuellement** un
3ᵉ mode `"quote"` **sans modifier le moteur** : c'est une configuration de props + un wrapper.

| Aspect | `viewer` (lecture seule) | `editor` (édition libre) | `quote` (takeoff devis) |
|---|---|---|---|
| Base studio | `mode="review"` figé | `mode="free"` | `mode="review"` + garde-fous |
| Édition vertices/sections | ❌ | ✅ | ✅ (limitée) |
| Outils dessin / split / merge | ❌ | ✅ | ✅ (essentiels) |
| Pipeline SAM / enhance | ❌ | ✅ | optionnel (lazy, off par défaut) |
| Alternatives (promote/reject) | lecture | ✅ | ✅ |
| Aperçu 3D `render3D` | ✅ (on-demand) | ✅ | ✅ (throttlé) |
| Bouton **Valider** | ❌ | ❌ (export JSON) | ✅ → `onValidate(model)` |
| UI masquée | tous outils d'édition | aucun | export JSON, debug, calques avancés |
| État persisté | aucun | aucun (export manuel) | **draft RoofTakeoff autosave** |
| Calculs déclenchés | aucun | mesures live (`computeMeasures`) | mesures + `deriveRoofTakeoff` au Valider |

> Implémentation : `mode="quote"` n'est **pas** une nouvelle valeur dans le moteur. C'est
> `TakeoffFullscreen` qui monte `AdminRoofStudio mode="review"` et masque/active des contrôles
> via props existantes + son propre chrome. **Zéro modification de `AdminRoofStudio`** en Phase 1.

---

## 4. Flow mobile fullscreen (UX / state / navigation)

```
[Wizard soumission — étape Takeoff]
   │  data.step === STEP_TAKEOFF
   │  bouton « Tracer le toit »
   ▼
[Ouverture overlay fullscreen]   ── transition: fade + lock scroll body
   │  monte <TakeoffFullscreen>  (position:fixed; inset:0; zIndex 11000)
   │  pattern identique à AdminTrainingLab.tsx:742-753
   │  initialModel = draft existant ? snapshot : seed depuis footprint geojson
   ▼
[Annotation]  AdminRoofStudio mode="review"
   │  autosave debounce 2 s → draft local (localStorage) + (option) serveur
   ▼
[Generate/update RoofModel]  (moteur, déjà intégré au studio)
   ▼
[Valider]  onValidate(model)
   │  deriveRoofTakeoff(model) → RoofDerived
   │  buildPricingInputs() → PricingInputs
   │  validateRoofTakeoff() → ValidationState
   │  revision++ ; status="validated"
   ▼
[Injection quantités]  updateData(toFormDataPatch(takeoff))
   │  area ← roof3d/footprint (selon décision §Q1) ; slope ← dominantSlopeLevel ;
   │  complexity ← dérivée ; + data.roofTakeoff = takeoff
   ▼
[Retour wizard étape Takeoff]   ── overlay démonté, scroll restauré
```

**Sauvegarde auto** : `useRoofTakeoffDraft` debounce 2 s →
`localStorage["roof_takeoff_draft:{soumissionId|sessionId}"]` (strates A+C ; B recalculable au
reload). Sync serveur optionnelle (Phase 2) toutes les 15 s ou au `blur`/`visibilitychange`.

**Restauration session** : au montage de `TakeoffFullscreen`, si un draft existe (< 24 h) →
proposer « Reprendre / Recommencer ». La strate B est régénérée via `deriveRoofTakeoff` à partir
du snapshot restauré (pas stockée localement → évite l'incohérence).

**Crash / reload** : draft écrit avant chaque RAF lourd évité ; on persiste sur
`visibilitychange === "hidden"` et `pagehide` (fiable iOS) plutôt que `beforeunload`.

**Back iOS / Android** : `history.pushState` à l'ouverture de l'overlay ; listener `popstate`
ferme l'overlay au lieu de quitter le wizard (et déclenche autosave). Bouton matériel Android
géré par le même `popstate`. Geste de retour Safari ⇒ intercepté par l'entrée d'historique.

**Transitions fullscreen** : pas d'API `requestFullscreen` (instable mobile Safari) — on simule
via overlay `position:fixed; inset:0` + `body { overflow:hidden; overscroll-behavior:none }` +
`viewport-fit=cover` et `env(safe-area-inset-*)` pour les encoches.

---

## 5. Analyse risques GPU / mobile (faits vérifiés)

**Fait clé** : le rendu 3D du roof model **n'est pas WebGL/Three.js**. `render3D` est un
**rastériseur logiciel Canvas 2D** (`engine.ts:778`, z-buffer maison `zbufferFaces`/`rasterTri`),
appelé dans une boucle `requestAnimationFrame` (`AdminRoofStudio.tsx:295-298`). Three.js
n'est utilisé **que** par `Globe.tsx` (intro). Le **vrai** consommateur GPU du takeoff est
**Google Maps** (vector maps WebGL).

| Risque | Source réelle | Mitigation concrète |
|---|---|---|
| **Contention main-thread** | 2 boucles RAF : map + rastériseur 3D logiciel (CPU) | Render-on-demand : ne lancer la boucle 3D que si l'aperçu 3D est visible/actif ; `cancelAnimationFrame` dès qu'inactif |
| **Redraw loops** | RAF 2D (`draw2D`) + 3D + pinch (`:546`) tournent en continu | Throttle à ~30 fps sur mobile ; dirty-flag (ne redessine que si `tick`/sélection change) ; pause sur `visibilitychange` |
| **Memory pressure** | Tuiles satellite, `bgImg` data-URL, instance Three globe non détruite | Ne pas persister de data-URL (stocker en storage) ; **détruire le globe Three** (`renderer.dispose()`, contexts) avant d'ouvrir le takeoff ; libérer `bgImg` à la fermeture |
| **WebGL context loss** | Google Maps + un éventuel 2ᵉ contexte WebGL = limite navigateur | N'avoir qu'**un** consommateur WebGL actif à la fois ; démonter la carte si l'aperçu plein écran la cache ; gérer `webglcontextlost` |
| **Touch gestures conflits** | pan/zoom carte vs édition vertices vs pinch studio | `touch-action: none` sur le canvas studio ; geler la carte (`gestureHandling:'none'`) pendant l'édition (pattern `MobilePrecisionLayer`) |
| **Fullscreen Safari iOS** | `requestFullscreen` non fiable, barres d'URL dynamiques | Overlay simulé `position:fixed` + safe-area ; `100dvh` plutôt que `100vh` |
| **Lazy loading** | studio + engine + straight-skeleton WASM lourds | `React.lazy` sur `TakeoffFullscreen` (le studio est déjà lazy via route) ; charger le WASM CGAL à la demande (fallback skeleton local) |
| **Render throttling** | rastériseur logiciel coûteux sur gros toits | Limiter le DPR du canvas 3D (`devicePixelRatio` capé à 1.5 sur mobile) ; baisser la résolution 3D en interaction |
| **Cleanup lifecycle** | RAF/listeners/observers fuités à la fermeture | `useEffect` cleanup strict : `cancelAnimationFrame(raf3/pinchRaf)`, retrait listeners maps, `ResizeObserver.disconnect()`, libération images |

---

## 6. Stratégie de persistance

### 6.1 Supabase (structure proposée — migration NON appliquée en Phase 0.5)
- `soumissions.roof_takeoff JSONB NULL` — l'agrégat `RoofTakeoff` (A+B+C+D+états).
  *Alternative* : ne stocker que A+C+D et recalculer B au chargement (réduit la taille).
- *(optionnel Phase 2)* `roof_takeoff_revisions` (table) : `id`, `soumission_id`,
  `revision`, `payload jsonb`, `created_at` — historique/snapshots.
- **Régularisation séparée** (bug indépendant) : créer la migration manquante pour
  `training_roof_takeoffs.roof_model` / `roof_sections_v16`.
- ⚠️ `src/integrations/supabase/types.ts` est **généré** → ne pas l'éditer à la main ;
  régénérer après migration. Les types domaine vivent dans `lib/roof-takeoff/types.ts`.

### 6.2 JSONB & versioning
- Champ `metadata.schemaVersion` (`ROOF_TAKEOFF_SCHEMA_VERSION`) dans chaque payload.
- Migrations de schéma JSON gérées par une fonction pure `migrateRoofTakeoff(payload)` côté
  lib (lecture tolérante), pas par SQL.

### 6.3 Snapshots & révisions
- `revision.revision` incrémenté à chaque **Valider**. `status` : draft → autosaved →
  validated → superseded. Conserver le dernier validé sur la soumission ; historique en table
  dédiée si besoin (Phase 2).

### 6.4 Autosave / reload draft
- Draft local `localStorage` (clé par soumission/session), debounce 2 s, flush sur
  `visibilitychange`/`pagehide`. Reload : restauration A+C, recompute B.

### 6.5 Optimistic updates
- À la validation, `queryClient.setQueryData(['soumission', id], patch)` avant l'`update`
  serveur ; rollback sur erreur. Cohérent avec le canal realtime `projects-stream`.

---

## 7. Boundaries anti-dette-technique

**DOIT rester standalone (aucune dépendance entrante du quote)**
- `roof-core`, `roof-accessories`, `roof-sections*`, `AdminRoofStudio`,
  `RoofPolygonAIWorkspace`. Le studio reste utilisable seul sur `/admin/roof-studio`.

**DOIT être partagé (source unique)**
- Le format `RoofModel` (`roof-core/types.ts`) = seule représentation géométrique.
- `lib/roof-takeoff` = seule couche qui dérive des quantités métier depuis un `RoofModel`.
- Les unités/enums de pente/complexité = alignés sur `types/roofing.ts` (réexport unidirectionnel).

**NE DOIT PAS être partagé**
- L'état Zustand du workspace 2D (`roof-polygon-ai/store.ts`) reste local au studio.
- Le `FormContext` ne fuit pas dans le studio ni dans `roof-takeoff`.
- Les helpers de pricing (`pricing-matrix`, `dynasty-calculator`) ne sont importés que par le
  quote ; `roof-takeoff` produit des *inputs*, il n'appelle pas le calcul de prix.

**NE DOIT JAMAIS dépendre du quote module**
- `roof-core` et `roof-takeoff` : aucun `import` depuis `components/roofing/**`,
  `context/FormContext`, `hooks/soumissions`, `pricing-*`. (À garder vérifiable par lint/ADR.)

**Direction des dépendances (à faire respecter)**
`quote → roof-takeoff → roof-core`. Toute flèche inverse = dette à refuser en revue.

---

## 8. Plan exact de Phase 1 (sans coder)

### 8.1 Fichiers à CRÉER (isolés, additifs)
1. `src/lib/roof-takeoff/types.ts` — modèle domaine (§1.2)
2. `src/lib/roof-takeoff/factory.ts` — `fromRoofModel`, `emptyRoofTakeoff`
3. `src/lib/roof-takeoff/derive.ts` — `deriveRoofTakeoff` (seul appelant de roof-core)
4. `src/lib/roof-takeoff/pricing-inputs.ts` — `buildPricingInputs`
5. `src/lib/roof-takeoff/quote-binding.ts` — `toFormDataPatch`
6. `src/lib/roof-takeoff/validate.ts` — `validateRoofTakeoff`
7. `src/lib/roof-takeoff/migrate.ts` — `migrateRoofTakeoff` (versioning JSON)
8. `src/lib/roof-takeoff/index.ts` — barrel exports
9. Tests : `derive.test.ts`, `pricing-inputs.test.ts`, `quote-binding.test.ts`,
   `validate.test.ts`
10. `src/components/roofing/immersive/TakeoffFullscreen.tsx` — overlay hôte (glue)
11. `src/hooks/useRoofTakeoffDraft.ts` — autosave/restore local
12. `supabase/migrations/<ts>_soumissions_roof_takeoff.sql` — **fichier créé, NON appliqué**

### 8.2 Fichiers à MODIFIER (minimal, additif, non destructif)
- `src/types/roofing.ts` — ajouter champs **optionnels** :
  `roofTakeoff?: RoofTakeoff` (et `roofModel?: RoofModel`) à `FormData`. Optionnels ⇒
  zéro changement de comportement existant.
- `src/components/roofing/immersive/ImmersiveWizard.tsx` — ajouter l'étape Takeoff
  **derrière un feature flag** + le bouton « Tracer le toit » ouvrant `TakeoffFullscreen`.
  Aucune suppression d'étape existante.
- *(Pas de modification de `FormContext` : `updateData` merge déjà ; à confirmer.)*

### 8.3 Ordre recommandé
1. types → factory → derive (+ tests) — **pur, sans UI, sans risque**
2. pricing-inputs → quote-binding → validate (+ tests)
3. `useRoofTakeoffDraft` (local only)
4. `TakeoffFullscreen` montant `AdminRoofStudio` (sans persistance serveur)
5. Branchement wizard derrière flag + injection FormData
6. Migration **rédigée** + revue (application décidée hors Phase 1)
7. (Phase 2) persistance serveur + révisions + optimistic updates

### 8.4 Dépendances critiques
- Signature `AdminRoofStudio` (`initialModel`, `backgroundImage`, `mode`, `onValidate`,
  `onClose`) — figée, ne pas casser.
- Fonctions `roof-core` consommées par `derive.ts` (`getFacePitches`, `findValleys`,
  `face3DArea`, `deriveRoofEdges`, `computeMeasures`).
- Mapping pente X/12 → `SlopeLevel` (décision §Q ci-dessous).
- Géoréférencement du footprint (RPC `find_building_polygon`) pour fixer l'échelle.

### 8.5 Zones dangereuses
- `roof-core/engine.ts` = **god-module** à immense surface d'export → **ne pas refactorer** ;
  seulement importer.
- `types.ts` Supabase **généré** → ne pas éditer à la main.
- Boucles RAF du studio (cleanup) + coexistence WebGL Google Maps (§5).
- `Globe.tsx` Three.js : s'assurer qu'il est démonté avant le takeoff (mémoire).
- `ImmersiveWizard` (~2700 l.) : modifications chirurgicales, derrière flag.

### 8.6 Stratégie de rollback
- **Feature flag** (ex. `VITE_FEATURE_ROOF_TAKEOFF` ou flag runtime) gardant l'étape +
  le bouton. Off ⇒ comportement strictement identique à aujourd'hui.
- Tout le nouveau code est isolé dans `lib/roof-takeoff` + `TakeoffFullscreen` ⇒
  suppression = retrait du flag + du dossier, sans toucher au reste.
- Colonne `roof_takeoff` **nullable** ⇒ aucune donnée existante impactée ; migration
  réversible (`DROP COLUMN`).
- Aucune modification de `roof-core`/studio ⇒ studio autonome et Training Lab intacts.

---

## 9. Questions à trancher avant la Phase 1 (rappel)

- **Q1** Surface de facturation : `roof3dAreaSqft` (réelle) ou `footprintAreaSqft` (empreinte
  actuelle) ? — impacte `quote-binding` et les montants.
- **Q2** Mapping pente : `dominantSlopeLevel` = pente dominante par aire, ou par pan principal ?
- **Q3** Persistance serveur en Phase 1 ou Phase 2 (local-only d'abord) ?
- **Q4** Cible : wizard public **et** admin, ou admin d'abord ?
- **Q5** Régularise-t-on `training_roof_takeoffs.roof_model` dans la même migration ?

---

## 10. Recommandation avant Phase 1

Démarrer la Phase 1 par les **strates pures** (`types` → `derive` → `pricing-inputs` →
`quote-binding` + tests) : zéro UI, zéro risque, valeur immédiate et vérifiable. Brancher
ensuite `TakeoffFullscreen` en **local-only** derrière un **feature flag**, sans persistance
serveur ni modification de `roof-core`/studio. Trancher **Q1 (surface 3D vs empreinte)** et
**Q4 (public vs admin)** avant d'écrire la glue, car elles déterminent la projection
`toFormDataPatch` et la cible UX. La persistance serveur, les révisions et la migration
restent en Phase 2, une fois la boucle locale validée.
