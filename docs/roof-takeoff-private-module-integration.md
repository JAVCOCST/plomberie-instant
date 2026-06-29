# Roof Takeoff — Intégration dans le module de soumission PRIVÉ (admin)

> Correctif de ciblage : le bouton « Tracer le toit » avait été branché dans le
> wizard **public** (`ImmersiveWizard`). Il devait être dans le module de
> **soumission privé admin** (`AdminQuoteGenerator`, route `/admin/quote`).
> Ce document décrit le déplacement. Aucun changement de `roof-core` ni du studio.

---

## 1. Ce qui a changé

### Retiré (wizard public)
`src/components/roofing/immersive/ImmersiveWizard.tsx` — suppression du bouton
expérimental, du montage de l'overlay, des imports (`lazy/Suspense`, flag,
`TakeoffFullscreen`) et de l'état `takeoffOpen`. Le wizard public revient à son
état d'avant (aucune trace de takeoff).

### Ajouté (module privé admin)
`src/pages/AdminQuoteGenerator.tsx` :
- import paresseux `TakeoffFullscreen` (chunk lazy ~17 kB).
- état `takeoffOpen`.
- **bouton « 📐 Tracer le toit (3D) »** dans la bannière adresse/métriques (à
  côté de Superficie/Périmètre/Dimensions/Lot), **visible par défaut** (module
  interne admin — pas de feature flag ici).
- montage de `<TakeoffFullscreen>` en overlay plein écran à la fin du composant.
- à la validation, écriture dans l'**état local du module** (qui n'utilise PAS
  FormData) :
  - `setSuperficie(roof3dAreaM2)` — le module stocke la superficie en **m²** ;
  - `setPerimetre(totalPerimeterM)` — en **m** ;
  - `setSlopeCategory(normalizeSlopeCategory(slope))` — mappe `flat/4-7/7-9/9-12/12+`
    vers `aucune/legere/moderee/abrupte` (fonction existante du module).

> La superficie alimente le prix via `superficie * 10.7639` (pi²) déjà en place.
> `areaSqftOverride` (saisie manuelle) garde la priorité s'il est renseigné.

---

## 2. Pourquoi visible sans flag ici

Le flag `VITE_FEATURE_ROOF_TAKEOFF` protégeait le **funnel public**. Le module
`/admin/quote` est **interne** ; le bouton y est donc affiché directement
(libellé explicite, action additive). Rien n'est retiré ni écrasé : l'utilisateur
valide dans le traceur, la superficie + la pente sont **remplies** (il peut encore
les ajuster), puis il sauvegarde la soumission normalement.

---

## 3. Flux

```
/admin/quote → bannière → « 📐 Tracer le toit (3D) »
  → TakeoffFullscreen (overlay 100dvh) → AdminRoofStudio (review)
     geler une carte (échelle) → tracer → membrane/Maximum/3D
  → « Valider le takeoff »
     → superficie (m²) + périmètre (m) + pente remplis dans la soumission
     → overlay fermé, retour au formulaire admin
  → sauvegarde / PDF inchangés
```

Autosave local (brouillon) géré par `useRoofTakeoffDraft`, clé = `loadedId`
(id soumission) ou adresse.

---

## 4. Préservation

- `AdminRoofStudio` et `roof-core` : inchangés.
- Module admin : aucun champ existant écrasé ; seuls superficie/périmètre/pente
  sont renseignés (valeurs visibles, ajustables). `RoofPolygonAIInline` existant
  conservé.
- Wizard public : revenu à l'identique.
- Build/tests : 103 tests verts, typecheck propre (hors 2 erreurs `StepDate`
  pré-existantes), `TakeoffFullscreen` en chunk lazy séparé.

---

## 5. Limites / TODO

- Le `roofModel`/`roofTakeoff` n'est pas (encore) persisté dans la ligne
  soumission (pas de migration Supabase) → réouverture = via le brouillon local.
  À brancher en Phase 2 (colonne `soumissions.roof_takeoff JSONB`).
- Validation sur appareils réels (iOS/Android) toujours à faire avant usage large.
- Le « Valider » du studio (menu Fichier) coexiste avec « Valider le takeoff » de
  l'overlay (les deux marchent).
