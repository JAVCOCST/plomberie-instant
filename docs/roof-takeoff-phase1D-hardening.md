# Phase 1D — Hardening &amp; stabilisation mobile du Takeoff

> Phase de **durcissement**, pas d'architecture. Suite des Phases 1A/1B/1C.
> Aucun refactor massif, aucune modification de `roof-core`, aucune réécriture du
> studio, aucun Supabase/realtime. Tout reste derrière `VITE_FEATURE_ROOF_TAKEOFF`.
> Priorité absolue : préserver la fluidité et le comportement fullscreen actuels.

---

## 1. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `src/components/roofing/immersive/TakeoffFullscreen.tsx` | Scroll-lock **compté** (anti-orphelin), garde **double-validate**, autosave **skip-si-inchangé** + **idle-deferred**, **save-on-close** (zéro perte), **bannière calibration live**, boutons **gros (≥ 48 px)**, feedback brouillon clarifié. |
| `src/hooks/useRoofTakeoffDraft.ts` | **Version de draft** (`v:1`), **guard de corruption/structure** (snapshot requis), **safe fallback** si la dérive échoue, **`cleanupExpiredDrafts()`** balayé au montage du hook. |
| `src/hooks/useRoofTakeoffDraft.test.ts` | +3 tests (version, structure invalide, sweep expiré/corrompu). |
| `docs/roof-takeoff-phase1D-hardening.md` | Ce document. |

> Aucun autre fichier touché. `AdminRoofStudio`, `roof-core`, `roof-takeoff` (domaine), `ImmersiveWizard`, templates : intacts. Les props additives `onReadyApi`/`onModelChange` de la 1C ne changent rien quand elles sont absentes.

---

## 2. Protections lifecycle ajoutées

- **Scroll-lock orphelin** : compteur module-level ; seule la 1ʳᵉ ouverture capture le style du `body`, seule la dernière fermeture le restaure → pas d'`overflow:hidden` résiduel même en cas de double montage théorique.
- **Double-validate** : cooldown 600 ms + `studioApi` requis ; un double-tap « Valider » ne déclenche pas deux soumissions.
- **Multiple popstate** : une **seule** entrée d'historique poussée (effet `[]`), listener retiré au démontage, entrée retirée si encore au sommet → le back ne sur-navigue jamais la soumission.
- **Flush au démontage** : timer d'autosave nettoyé + persistance des éditions en attente (aucune perte si l'overlay disparaît).
- **Save-on-close** : `Fermer`, back-button et `onClose` du studio passent tous par `requestClose` → persistance avant fermeture.

---

## 3. Stabilisation autosave / performance gros toits

- **Skip-si-inchangé** : signature structurelle légère (`sections` pts/pente/elev/hf/type + accessoires + georef + gsd + nom). Si la signature n'a pas changé, **aucune dérive, aucune écriture** (dirty-guard).
- **Idle-deferred** : la construction du `RoofTakeoff` (dérive lourde via roof-core) est repoussée par `requestIdleCallback` (fallback `setTimeout`) **après** le debounce 2 s → ne concurrence pas le tracé.
- **Une seule dérive par fenêtre** : la dérive ne tourne qu'au flush (au plus ~toutes les 2 s, et seulement si dirty), pas par frame.
- Léger volontairement : **pas** d'event bus, pas d'observer, pas de state machine. Le studio observe en sortie (`onModelChange`), rien de plus.

---

## 4. UX terrain améliorée

- **Boutons gros** (≥ 48 px, police 15) : « ✓ Valider le takeoff » (vert) et « ✕ Fermer ».
- **Feedback sauvegarde clair** : chip « Enregistrement… » (orange) → « Brouillon enregistré ✓ » (vert).
- **Bannière calibration live** (jaune) tant que l'échelle est absente : indique d'ouvrir le menu **Carte → Geler la vue** et prévient que la validation est bloquée sans échelle.
- **Bannière d'erreur** (rouge) au Valider si bloquant, avec message actionnable.
- **Désambiguïsation « Valider »** : libellé explicite « Valider le **takeoff** » dans le chrome de l'overlay (en plus du « Valider » du studio).
- **État loading** : bouton Valider désactivé tant que le traceur (lazy) n'a pas exposé son API ; fallback « Chargement du traceur… ».

---

## 5. Rehydration / recovery renforcée

- **Version de draft** (`v:1`) stampée dans chaque payload.
- **Guard de corruption/structure** : JSON invalide, payload sans `geometry.snapshot.roofModel`, ou TTL dépassé → entrée **supprimée** et `null` retourné (jamais de crash).
- **Safe fallback** : si la recompute B/D échoue, `readDraft` renvoie `null` plutôt que de propager l'erreur.
- **B/D jamais persistés** : recalculés depuis le snapshot figé → pas de dérive périmée restaurée.
- **Sweep des drafts expirés** : `cleanupExpiredDrafts()` au montage du hook nettoie tous les `roof_takeoff_draft:*` périmés/corrompus.
- **Restore** : au montage de l'overlay, si pas de `initialModel` mais un draft valide (≤ 24 h), le modèle restauré sert de seed et l'indicateur passe « enregistré ».

---

## 6. Comportements testés

### Automatique (CI)
- `npx vitest run` → **103/103 verts** (16 fichiers). Nouveaux : version draft, structure invalide, sweep expiré/corrompu, round-trip + recompute B/D, TTL.
- `npx tsc --noEmit -p tsconfig.app.json` → propre **sauf 2 erreurs pré-existantes** `StepDate.tsx` (`desiredInstallDate`), antérieures &amp; non liées.
- `npx vite build` → OK. `TakeoffFullscreen-*.js` ≈ 16 kB (lazy, hors bundle eager).

### À valider sur appareil réel (NON exécuté ici — pas d'appareil)
> Je ne peux pas piloter Safari iOS / Chrome Android depuis cet environnement.
> Scénarios à vérifier manuellement avant prod :
- iPhone Safari : ouverture fullscreen, rotation, multitâche/arrière-plan, verrouillage, low-power, back-button, fermeture/réouverture (draft), gros toit, autosave, validation.
- Android Chrome : mêmes scénarios + bouton retour matériel.
- Flag **off** : aucun bouton, aucun changement.
- Flag **on** : flow complet stable, retour soumission, données préservées.

---

## 7. Préservation de l'existant (inchangé)

- **Studio standalone** (`/admin/roof-studio`) et **Training Lab** : aucune nouvelle prop passée → no-op → identiques.
- **Outils / menus** du studio : rien retiré.
- **Templates de soumission** : `updateData` reste un **merge** ; le patch ne touche que `area/areaUnit/slope/complexity` + `roofTakeoff?/roofModel?`. Les autres champs conservent leurs valeurs.

---

## 8. Limitations / risques restants

- **Tests appareil réel non faits** ici → à exécuter avant prod large (cf. §6).
- **Autosave continu** : déclenché par `onModelChange` (édits) ; la dérive reste potentiellement coûteuse sur de très gros toits, atténuée par debounce + idle + skip-si-inchangé. Un throttle adaptatif plus fin reste possible.
- **Calibration non réinjectée** dans l'état interne du studio via `initialModel` (re-geler la carte) ; le takeoff conserve l'échelle → pricing correct.
- **Save-on-close** retenu plutôt qu'un dialogue de confirmation « dirty » : choix terrain (zéro friction, zéro perte, draft récupérable). Une confirmation explicite pourrait être ajoutée si souhaité.
- **Modèle non calibré** → validation bloquante (`ZERO_AREA`) : voulu ; la bannière jaune l'explique en amont.

---

## 9. TODO Phase suivante

- Tests appareils réels + ajustements (safe-area, clavier, gestes retour).
- Throttle adaptatif de la dérive d'autosave (par taille de toit).
- Seed du toit depuis le polygone bâtiment (RPC `find_building_polygon`).
- Réinjection de la géoréférence dans le studio.
- Persistance serveur + révisions (Phase 2) : `soumissions.roof_takeoff JSONB`.

---

## 10. GO / NO-GO

**GO pour production EXPÉRIMENTALE (derrière flag).** Durcissement lifecycle,
autosave stabilisé (skip + idle), recovery robuste (version + guards + sweep),
UX terrain (gros boutons, feedback, bannière calibration), zéro perte de données
(save-on-close). Flag off = identique ; studio/roof-core/templates intacts ;
103 tests verts, build OK, typecheck propre (hors 2 erreurs `StepDate`
pré-existantes). **Réserve** : validation finale sur Safari iOS / Chrome Android
réels avant activation large.
