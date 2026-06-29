# Phase 1B — Intégration locale Quote ↔ RoofStudio (derrière feature flag)

> Implémentation réelle, scope strict. Aucun changement de comportement quand le
> flag est **off**. Aucune modification de `roof-core` ni de `AdminRoofStudio`.
> Aucune migration Supabase, aucune persistance serveur, aucun realtime.

Suite de la Phase 1A (`src/lib/roof-takeoff` — domaine pur, livré au commit `cd6b94c`).

---

## 1. Fichiers créés / modifiés

### Créés
| Fichier | Rôle |
|---|---|
| `src/hooks/useRoofTakeoffDraft.ts` | Autosave/restore **local** (localStorage). Sauvegarde A+C+metadata+revision ; **recalcule B/D** au restore via le domaine. Debounce 2 s, TTL 24 h, flush sur `visibilitychange`/`pagehide`. |
| `src/components/roofing/immersive/takeoffFlag.ts` | Feature flag **leaf** (aucun import du domaine) → importer le flag ne tire pas le moteur dans le bundle eager. |
| `src/components/roofing/immersive/takeoffBridge.ts` | **Glue pure & testable** : adapte le modèle émis par le studio (annotation v2) en `RoofModel` roof-core (v1), puis `fromRoofModel → validate → toFormDataPatch`. |
| `src/components/roofing/immersive/TakeoffFullscreen.tsx` | Overlay plein écran local hébergeant `AdminRoofStudio` (mode `review`). Body-scroll-lock, 100dvh, safe-area, back-button (popstate), flush draft. |
| `src/hooks/useRoofTakeoffDraft.test.ts` | Tests draft (round-trip, TTL, recalcul B/D, clear, corrupt). |
| `src/components/roofing/immersive/takeoffBridge.test.ts` | Tests adaptateur + handler pur + cas non calibré bloquant. |
| `docs/roof-takeoff-phase1B-implementation.md` | Ce document. |

### Modifiés (additif, derrière flag)
| Fichier | Changement |
|---|---|
| `src/components/roofing/immersive/ImmersiveWizard.tsx` | Imports `lazy/Suspense` + flag (leaf) + `TakeoffFullscreen` (lazy). State `takeoffOpen`. Bouton **« Tracer le toit (expérimental) »** dans l'étape **Bâtiment** (step 2), gardé par le flag. Montage de l'overlay (lazy, gardé par le flag) avant la fermeture du shell. |

> **Aucun autre fichier modifié.** `AdminRoofStudio`, `roof-core`, `roof-takeoff`, Supabase, pricing, routing : intacts.

---

## 2. Comportement du flag — `VITE_FEATURE_ROOF_TAKEOFF`

- Lu dans `takeoffFlag.ts` : `true` si la variable vaut `"true"` ou `"1"`, sinon `false`.
- **Off (défaut)** : le bouton n'est pas rendu, l'overlay n'est jamais monté. Le flux du wizard est **strictement identique** à aujourd'hui. Le domaine et le moteur ne sont **pas** chargés (code-split : chunk `TakeoffFullscreen-*.js` ~13 kB, chargé à la demande seulement).
- **On** : un bouton expérimental « Tracer le toit » apparaît à l'étape Bâtiment (si une adresse est saisie). Il ouvre `TakeoffFullscreen`.

Activation locale : ajouter à `.env.local` :

```
VITE_FEATURE_ROOF_TAKEOFF=true
```

---

## 3. Boucle d'intégration (flag on)

```
Étape Bâtiment → bouton « Tracer le toit »
  → TakeoffFullscreen (overlay fixed, 100dvh, scroll lock)
      monte AdminRoofStudio mode="review" (props existantes)
      seed = data.roofModel  OU  draft local restauré (≤ 24h)
  → l'utilisateur trace / gèle une carte (calibration via le studio)
  → Valider (menu « Fichier » du traceur) → onValidate(model émis)
      buildTakeoffFromStudio(model) :
        studioModelToRoofModel()  (annotation v2 → RoofModel v1, échelle via calibration.gsd)
        fromRoofModel()           → RoofTakeoff (B + D dérivés)
        validateRoofTakeoff()
        toFormDataPatch()
      saveDraft(takeoff)          (local)
      onApplyPatch(patch) → updateData(patch)   (area 3D réelle, slope, complexity, roofTakeoff, roofModel)
      ferme l'overlay SI validation non bloquante (sinon bannière d'erreur)
```

Surface facturée projetée (décision Q1) : **surface 3D réelle** (`roof3dAreaSqft`, arrondie).

---

## 4. Comment tester manuellement

1. `VITE_FEATURE_ROOF_TAKEOFF=true` dans `.env.local`, puis `npm run dev`.
2. Wizard → saisir une adresse → avancer jusqu'à **Bâtiment**.
3. Cliquer **« Tracer le toit (expérimental) »** → l'overlay s'ouvre plein écran.
4. Dans le traceur : geler une carte (pour l'échelle), tracer les pans.
5. Menu **Fichier → Valider**. L'overlay se ferme et la superficie / pente / complexité sont injectées dans le devis ; `data.roofTakeoff` + `data.roofModel` sont renseignés.
6. Rouvrir : le **draft** local est proposé comme point de départ (≤ 24 h).
7. Vérifier flag **off** : retirer la variable → aucun bouton, aucun changement.

CI/local : `npx vitest run` (100 tests verts) · `tsc --noEmit -p tsconfig.app.json` (seules les 2 erreurs pré-existantes `StepDate`) · `npx vite build` (OK, chunk Takeoff séparé).

---

## 5. Risques restants

- **UX de validation** : le bouton « Valider » du studio est dans son menu **Fichier** (comportement existant du studio). L'overlay l'indique mais ne peut pas le remonter sans modifier `AdminRoofStudio` (hors scope). → voir TODO 1C.
- **Autosave continu** : le studio possède son état live en interne et ne l'expose pas. La sauvegarde se fait donc **à la validation** (et au flush visibility/pagehide), pas en continu pendant le tracé. Le hook supporte déjà le debounce 2 s pour un usage continu futur.
- **Back-button** : `pushState` + `popstate` ferme l'overlay ; nettoyage `history.back()` si l'entrée est encore au sommet. Testé manuellement requis sur iOS/Android réels.
- **Restauration calibration dans le studio** : `initialModel` (RoofModel v1) ne réinjecte pas la géoréférence dans l'état du studio (il faudrait re-geler la carte). Le **takeoff** conserve la calibration → le pricing reste correct depuis le draft.
- **Modèle non calibré** : sans carte gelée, `validateRoofTakeoff` renvoie `ZERO_AREA` (error) → l'overlay reste ouvert avec un message. Comportement voulu (pas de surface réelle sans échelle).

---

## 6. Limites connues (volontaires, hors scope 1B)

- Pas de persistance serveur, pas de migration Supabase, pas de realtime.
- Pas de seed automatique du toit depuis le polygone bâtiment (footprint geojson → sections px) : l'utilisateur trace/gèle dans le studio.
- Découpage par arête individuelle non fourni (totaux par type seulement ; noues individuelles).
- Une seule cible branchée : le wizard immersif (`/`). Pas d'admin.

---

## 7. TODO Phase 1C

- Exposer **Valider/Fermer** dans le chrome de l'overlay (nécessite une petite prop sur `AdminRoofStudio` — à proposer proprement, non destructif).
- Seed du toit depuis le footprint bâtiment (RPC `find_building_polygon`) pour démarrer le tracé pré-rempli.
- Autosave continu (debounce 2 s) si le studio expose un `onChange(model)` léger.
- Découpage par arête individuelle dans `derive`.
- Persistance serveur + révisions (Phase 2) : colonne `soumissions.roof_takeoff JSONB`.

---

## 8. GO / NO-GO

**GO pour merge.** Tout est additif et code-splitté ; flag **off** = comportement identique (vérifié) ; 100 tests verts, typecheck (hors baseline) et build OK ; aucune modification de `roof-core`/`AdminRoofStudio`/Supabase.
