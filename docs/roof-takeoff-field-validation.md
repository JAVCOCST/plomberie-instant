# Roof Takeoff — Field Validation &amp; UX Observation

> Phase d'observation/stabilisation. **Aucune** nouvelle feature, **aucun** refactor,
> **aucune** nouvelle architecture, **aucun** changement de domaine. Instrumentation
> **DEV-only** (console.debug), protections UX finales, et documentation. Tout reste
> derrière `VITE_FEATURE_ROOF_TAKEOFF`. L'expérience fullscreen mobile actuelle est
> préservée.

---

## 0. Fichiers modifiés / créés

| Fichier | Changement |
|---|---|
| `src/components/roofing/immersive/takeoffMetrics.ts` **(nouveau)** | Instrumentation **DEV-only** : `ux.event/count/time`. No-op total en prod (`import.meta.env.DEV`), aucune dépendance, aucun backend, aucun analytics externe. |
| `src/components/roofing/immersive/TakeoffFullscreen.tsx` | Instrumentation branchée (open/close/abandon, validate, autosave, derive timing, restore, calibration). Protections finales : **multi-open guard**, **double-close guard**, **focus restoration**, **fade-in léger**, double-validate déjà présent. |
| `docs/roof-takeoff-field-validation.md` **(nouveau)** | Ce document. |

> Aucun autre fichier touché. `AdminRoofStudio`, `roof-core`, domaine `roof-takeoff`, wizard (hors 1B), templates : intacts.

---

## 1. Instrumentation ajoutée (DEV-only)

Événements/temps émis dans la console en build dev seulement :

| Signal | Type | Sens |
|---|---|---|
| `overlay_open` / `overlay_lifetime` | event + timer | ouverture + durée totale de l'overlay |
| `overlay_abandon` | event | fermeture **sans** validation réussie |
| `studio_ready` | event | le traceur (lazy) a exposé son API |
| `validate` | timer | durée de la validation (adaptation domaine incluse) |
| `validate_ok` / `validate_blocked` | event | succès / blocage (+ codes d'erreur) |
| `validate_double_tap_ignored` | event | double-tap « Valider » filtré |
| `autosave` | counter | nombre de sauvegardes effectives |
| `derive_autosave` | timer | coût de la dérive `RoofTakeoff` à l'autosave |
| `draft_restore` | counter | restauration d'un brouillon |
| `calibration_missing` | event | échelle absente détectée |
| `multi_open_detected` | event | tentative de 2ᵉ overlay (anomalie) |

> Production : zéro coût (toutes les fonctions court-circuitent si `!DEV`).

---

## 2. Protections UX finales ajoutées

- **Multi-open guard** : drapeau module-level `OVERLAY_OPEN` ; un 2ᵉ montage est tracé (`multi_open_detected`). Le wizard n'autorise déjà qu'une instance.
- **Double-close guard** : `requestClose` ne s'exécute qu'une fois (`closed` ref) → pas de double `onClose` (back + bouton).
- **Double-validate** : cooldown 600 ms (déjà en 1D) + trace `validate_double_tap_ignored`.
- **Focus restoration** : on mémorise `document.activeElement` à l'ouverture, on **focus le dialog** à l'entrée (a11y), on **restaure** le focus initial à la fermeture.
- **Transition légère** : fade-in opacité 140 ms (pas d'animation lourde, pas de fade-out bloquant le démontage).
- **Loading** : bouton « Valider » désactivé tant que `studio_ready` n'est pas émis ; fallback Suspense « Chargement du traceur… ».
- **Scroll-lock compté** + **save-on-close** + **flush au démontage** (hérités 1D).

---

## 3. Tests terrain exécutés

> ⚠️ **Honnêteté méthodo** : cet environnement n'a **pas** d'appareil mobile ni de
> navigateur piloté. Je **n'ai pas** pu exécuter Safari iOS / Chrome Android réels.
> Ce qui suit = **revue de code + raisonnement** sur chaque scénario, plus les
> tests automatiques. Les ✅ « device » sont à confirmer manuellement.

### Automatique (exécuté ici)
- `vitest run` → **103/103 verts**.
- `tsc --noEmit -p tsconfig.app.json` → propre, **sauf 2 erreurs pré-existantes** `StepDate.tsx` (`desiredInstallDate`), antérieures &amp; non liées.
- `vite build` → OK. `TakeoffFullscreen-*.js` ≈ 17 kB (lazy, hors bundle eager).

### Scénarios à valider sur appareil (procédure)
**iPhone Safari** : rotation · swipe-back · multitâche/arrière-plan · lock/unlock ·
reload · appel entrant · LTE faible · gros toit · pinch rapide · validation répétée.
**Android Chrome** : back matériel · gestes · rotation · arrière-plan · gros toit.
Pour chaque : ouvrir via « Tracer le toit », vérifier fullscreen stable, autosave
(console `autosave`), validation, retour soumission, **aucune** perte de données,
flag off = aucun changement.

---

## 4. Comportements observés (revue de code)

- **Ouverture** : overlay `fixed 100dvh` + safe-area + fade-in ; scroll body verrouillé ; focus déplacé dans le dialog.
- **Tracé** : le studio garde son comportement (touch-action none sur son canvas) ; aucun changement de gestures.
- **Autosave** : déclenché à l'édition, **dédupliqué** (skip si signature inchangée), **différé** (debounce 2 s + idle).
- **Validation** : « Valider le takeoff » → même action que le studio → patch `updateData` (merge) → fermeture si non bloquant.
- **Fermeture** : save-on-close → brouillon persistant → focus restauré → retour soumission.
- **Back-button** : ferme l'overlay seulement (1 entrée d'historique, nettoyée).

---

## 5. Frictions UX détectées (à arbitrer)

1. **« Valider » en double** : le studio expose son propre « Valider » dans le menu **Fichier**, et l'overlay ajoute « Valider le takeoff ». Deux points d'entrée → légère ambiguïté. *Reco : à terme, n'exposer qu'un seul Valider visible (overlay) — nécessiterait une petite option d'UI côté studio, hors scope ici.*
2. **Calibration** : sans carte gelée, la validation est bloquée. La bannière jaune l'explique, mais l'utilisateur peut tracer longtemps **avant** de comprendre qu'il faut geler une carte d'abord. *Reco : inviter à geler la carte dès l'ouverture si non calibré.*
3. **Découverte du bouton** : « Tracer le toit » est à l'étape Bâtiment ; discret. *Reco : style/emplacement plus visible quand le flag sera promu.*
4. **Validation = action terminale** : rien n'indique clairement « ça va fermer et revenir à la soumission ». *Reco : micro-libellé/àconfirmation visuelle (toast court) au retour.*
5. **Gros toits** : la dérive d'autosave peut être perceptible. Atténuée (skip + idle + debounce) mais à mesurer (`derive_autosave`).

---

## 6. Bugs réels détectés

- Aucun bug fonctionnel nouveau détecté en revue/CI sur le périmètre takeoff.
- **Pré-existant (hors périmètre, documenté)** : 2 erreurs TS dans `StepDate.tsx` (`desiredInstallDate` absent de `FormData`) — antérieures à ce travail.
- **À confirmer sur device** : comportement précis de `100dvh` + barres dynamiques Safari, gestes de retour, focus clavier — non vérifiable ici.

---

## 7. Risques mobiles restants

- **Validation device non faite ici** (priorité avant bêta large).
- **Safari `100dvh`/safe-area** : à confirmer sur encoches + barre d'URL dynamique.
- **Gros toits** : dérive d'autosave coûteuse possible (atténuée).
- **Calibration non réinjectée** dans l'état interne du studio via `initialModel` (le takeoff conserve l'échelle → pricing correct).
- **Save-on-close** retenu (pas de confirmation « dirty ») : zéro friction/perte ; à confirmer comme préférence produit.

---

## 8. Performance observée (instrumentée, à lire en dev)

Les vraies valeurs sont à relever via la console (`derive_autosave`, `validate`,
`overlay_lifetime`) sur device. Attendus (revue) :
- Ouverture : dominée par le **lazy-load** du chunk `AdminRoofStudio` (~86 kB) au 1ᵉʳ usage, puis instantané (mise en cache).
- Validation/dérive : `computeMeasures`/`collectFaces` sur le nb de sections ; rapide pour des toits résidentiels, à surveiller sur très gros toits.
- Autosave : 1 dérive max / 2 s, et **0** si rien n'a changé (skip).
- Redraws studio : inchangés (hors scope) — le studio gère déjà son RAF.

---

## 9. Recommandations UX (avant promotion)

- Un seul « Valider » visible (overlay) ; masquer/atténuer le doublon studio.
- Pousser à **geler la carte** dès l'ouverture si non calibré (réduit la friction #2).
- Toast court « Takeoff appliqué » au retour dans la soumission (clôture lisible).
- Boutons déjà ≥ 48 px ; conserver.

---

## 10. Recommandations techniques Phase 2 (NON implémentées)

| Sujet | Pourquoi | Quand |
|---|---|---|
| **Persistance serveur** (`soumissions.roof_takeoff JSONB`) | survivre au changement d'appareil / partage / historique | Phase 2 (migration déjà esquissée en archi) |
| **Révisions** (`roof_takeoff_revisions`) | traçabilité des validations successives | Phase 2 |
| **Optimistic updates** (React Query) | retour instantané + rollback | Phase 2 |
| **Realtime** | utile **uniquement** si édition multi-appareil/collaboration | à évaluer, pas avant un vrai besoin |
| **Collaboration** | plusieurs intervenants sur un même toit | spéculatif — ne pas anticiper |
| **Throttle adaptatif de la dérive** | très gros toits | si la mesure `derive_autosave` le justifie |
| **Seed depuis footprint bâtiment** (RPC `find_building_polygon`) | démarrer pré-rempli (moins de tracé) | améliore fortement l'UX terrain |
| **Option « un seul Valider »** côté studio | retirer l'ambiguïté | petite prop d'UI non destructive |

---

## 11. GO / NO-GO

**GO pour bêta interne / terrain restreinte (derrière flag), NO-GO pour activation
large** tant que la **validation sur Safari iOS / Chrome Android réels** n'est pas
faite. Justification : instrumentation DEV-only en place (observation possible),
protections UX finales ajoutées (multi-open, double-close, focus, transition),
zéro perte de données (save-on-close + autosave robuste), studio/roof-core/templates
intacts, flag off = identique, 103 tests verts. Recommandation : déployer en bêta
restreinte avec le flag, relever les métriques console sur quelques toits réels,
arbitrer les frictions §5, puis décider de l'activation large + Phase 2.
