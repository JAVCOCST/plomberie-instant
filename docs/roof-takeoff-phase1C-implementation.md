# Phase 1C — Chrome Takeoff + UX fullscreen mobile préservée

> Suite des Phases 1A (domaine `roof-takeoff`) et 1B (overlay + autosave derrière
> flag). Scope strict. Aucune réécriture du studio, aucun changement de
> `roof-core`, aucune migration Supabase, aucune feature active sans le flag
> `VITE_FEATURE_ROOF_TAKEOFF`.

---

## 1. Fichiers modifiés / créés

| Fichier | Changement |
|---|---|
| `src/pages/AdminRoofStudio.tsx` | **2 props optionnelles additives** : `onReadyApi(api)` (expose `api.validate()` = même action que le bouton « Valider » interne) et `onModelChange(model)` (émet le modèle courant à l'édition, pour l'autosave hôte). Effets **no-op** si les props sont absentes → `/admin/roof-studio` et Training Lab inchangés. Le menu « Fichier » et tous les outils restent en place. |
| `src/components/roofing/immersive/TakeoffFullscreen.tsx` | Chrome de l'overlay : bouton **« Valider le takeoff »** (déclenche `studioApi.validate()`), bouton **« Fermer »**, **indicateur de brouillon** (enregistré ✓ / enregistrement…), **bannière d'erreur** si modèle non calibré/invalide. Autosave hôte **debouncé 2 s** branché sur `onModelChange`. Fullscreen mobile renforcé. |
| `docs/roof-takeoff-phase1C-implementation.md` | Ce document. |

> Aucun autre fichier modifié. `roof-core`, `roof-takeoff`, Supabase, pricing, routing, wizard (hors 1B) : intacts. Le branchement wizard (bouton + montage) reste celui de la 1B, derrière le flag.

---

## 2. Validation externe — comment elle est déclenchée

La seule modification du studio est **additive et minimale** :

```ts
// AdminRoofStudio props (optionnelles)
onReadyApi?: (api: { validate: () => void }) => void;
onModelChange?: (model: RoofModel) => void;

// Effet (no-op si la prop est absente) :
useEffect(() => {
  if (!onReadyApi) return;
  onReadyApi({ validate: () => { if (onValidateR.current) onValidateR.current(buildModel("validated")); } });
}, [onReadyApi]);
```

`api.validate()` appelle **exactement** la même logique que le bouton « Valider »
interne du studio (`onValidate(buildModel("validated"))`). Le bouton « Valider le
takeoff » de l'overlay appelle `studioApi.validate()`. Le menu « Fichier → Valider »
existant reste disponible et fonctionne à l'identique.

Flux de validation :

```
« Valider le takeoff » (overlay)  ──►  studioApi.validate()
   ──►  onValidate(buildModel("validated"))   (logique studio inchangée)
   ──►  handleStudioValidate(emitted)  dans TakeoffFullscreen
         buildTakeoffFromStudio → fromRoofModel → validate → toFormDataPatch
         draft.saveDraft(takeoff)
         onApplyPatch(patch) → updateData(patch)   (merge non destructif)
         ferme l'overlay si validation non bloquante, sinon bannière d'erreur
```

---

## 3. Comportement fullscreen mobile

- Overlay `position:fixed; inset:0; height:100dvh; width:100vw; zIndex:11000`.
- `padding` safe-area (`env(safe-area-inset-top/bottom)`), `touch-action:none` sur le wrapper.
- **Body scroll lock** au montage (`overflow:hidden` + `overscroll-behavior:none`), **restauré** au démontage (valeurs précédentes mémorisées).
- **Back-button** (Android/iOS) : `history.pushState` au montage, `popstate` ferme **l'overlay seulement** (pas la soumission). Au démontage par bouton, l'entrée poussée est retirée (`history.back()` si encore au sommet) → le back ne sur-navigue jamais. Le wizard n'utilise pas `history`/`popstate` (vérifié) → aucun conflit.
- **Retour à la soumission** : après validation non bloquante, `onClose()` démonte l'overlay et le wizard reprend à l'étape Bâtiment avec les champs injectés.
- Autosave **flush** sur `visibilitychange`/`pagehide` (via `useRoofTakeoffDraft`) + flush du timer à l'unmount.

---

## 4. Autosave (amélioré, sans refactor du studio)

- Le studio émet `onModelChange(buildModel("draft"))` sur édition (sections, alternatives, rejets, accessoires, georef, nom). **Émis uniquement si la prop est passée** (coût nul sinon).
- `TakeoffFullscreen` stocke le dernier modèle brut et **debounce 2 s** : il ne construit le `RoofTakeoff` (dérive lourde) **qu'une fois les éditions stabilisées**, puis `draft.saveDraft`. L'indicateur passe « Enregistrement… » → « Brouillon enregistré ✓ ».
- Le state interne du studio **n'est pas** refactoré : on observe seulement, en sortie.

---

## 5. Préservation de l'existant (vérifié)

- **RoofStudio standalone** (`/admin/roof-studio`) : rendu sans les nouvelles props → effets no-op → comportement identique. Menus/outils intacts.
- **Training Lab** : passe `onValidate/onClose` (pas les nouvelles props) → inchangé.
- **Outils / menus du studio** : aucun retrait ; le menu « Fichier » et son « Valider » restent.
- **Modèles / templates de soumission** : `updateData` fait un **merge** (`setData(prev => ({...prev, ...partial}))`). Le patch ne touche que `area`, `areaUnit`, `slope`, `complexity`, `roofTakeoff?`, `roofModel?`. Tous les autres champs (`client`, `address`, `product`, `coverageType`, `repairMessages`, …) **conservent leurs valeurs**. Les templates lisent les mêmes champs existants → aucun template cassé.
- **Flag off** : aucun bouton, aucun overlay, domaine code-splitté non chargé → aucune régression.

---

## 6. Validation exécutée

- `npx vitest run` → **100/100 verts** (16 fichiers).
- `npx tsc --noEmit -p tsconfig.app.json` → propre, **sauf 2 erreurs pré-existantes** dans `src/components/roofing/steps/StepDate.tsx` (`desiredInstallDate` absent de `FormData`) — antérieures à ce travail, non liées.
- `npx vite build` → OK. Chunks séparés : `TakeoffFullscreen-*.js` ≈ 14 kB, `AdminRoofStudio-*.js` ≈ 86 kB (lazy).

### À tester manuellement (appareil réel)
- **Flag off** : aucun bouton « Tracer le toit », aucun changement, soumission normale.
- **Flag on mobile** : bouton visible (étape Bâtiment) → overlay fluide plein écran → outils du traceur accessibles → « Valider le takeoff » visible → validation injecte superficie/pente/complexité → overlay se ferme → la soumission continue, données existantes préservées.
- **Flag on desktop** : overlay utilisable, retour wizard correct.

---

## 7. Risques restants

- Le back-button utilise une seule entrée d'historique poussée ; à valider sur Safari iOS / Chrome Android réels (gestes de retour).
- L'autosave reconstruit le `RoofTakeoff` (dérive lourde) au plus toutes les 2 s après stabilisation des éditions — acceptable, mais sur de très gros toits la dérive peut être coûteuse (throttle possible en 1D).
- La calibration n'est pas réinjectée dans l'état interne du studio via `initialModel` (re-geler la carte si besoin) ; le takeoff conserve l'échelle → pricing correct.
- Modèle non calibré → `ZERO_AREA` (error) : la validation reste bloquante et affiche la bannière (voulu).

---

## 8. TODO Phase 1D

- Seed du toit depuis le polygone bâtiment (RPC `find_building_polygon`) pour démarrer pré-rempli.
- Throttle/idle-callback pour la dérive d'autosave sur très gros toits.
- Persistance serveur + révisions (Phase 2) : `soumissions.roof_takeoff JSONB` (migration rédigée, application décidée hors scope).
- Restauration de la géoréférence dans l'état interne du studio (nécessiterait une petite prop supplémentaire).
- Cible admin (en plus du wizard public) si décidé.

---

## 9. GO / NO-GO

**GO pour merge.** Modification du studio strictement additive et no-op hors takeoff ;
fullscreen mobile renforcé ; outils/menus/templates préservés ; `updateData` merge
non destructif ; flag off = identique ; 100 tests verts, build OK, typecheck propre
(hors 2 erreurs `StepDate` pré-existantes documentées).
