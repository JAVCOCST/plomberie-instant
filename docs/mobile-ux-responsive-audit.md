# Mobile UX / Responsive Audit — Roof Takeoff &amp; Admin Quote

> Audit interaction/mobile/responsive du module privé (`/admin/quote`),
> `TakeoffFullscreen` et `AdminRoofStudio` (mobile). **Polish + robustesse**,
> pas de redesign, pas de refactor massif, pas de réécriture du studio.

> ⚠️ **Méthodo honnête** : pas d'appareil réel ni de navigateur piloté dans cet
> environnement. L'audit est une **revue de code** ; les corrections appliquées
> sont **ciblées et à faible risque**. Les ✅ « device » restent à confirmer
> manuellement sur Safari iOS / Chrome Android.

---

## 0. Fichiers modifiés (corrections appliquées)

| Fichier | Correctif |
|---|---|
| `src/pages/AdminQuoteGenerator.tsx` | Bannière adresse/métriques : `flexWrap:'wrap'` → plus d'overflow horizontal sur mobile quand le bouton Takeoff + métriques cohabitent. Bouton Takeoff : `minHeight:44`, `padding 12/18`, `fontSize 14`, `touchAction:'manipulation'` (cible tactile confortable, pas de délai 300 ms). |
| `src/components/roofing/immersive/TakeoffFullscreen.tsx` | Positionnement durci : `top/left/right:0 + height:100dvh` au lieu de `inset:0 + width:100vw` → supprime le risque d'overflow horizontal dû à `100vw` (barre de défilement) tout en gardant le `dvh` mobile. `touchAction:'manipulation'` sur les boutons du chrome. |

> Aucune modification de `roof-core`, du moteur, des templates, des flux, ni du style global. 103 tests verts, typecheck propre (hors 2 erreurs `StepDate` pré-existantes), build OK.

---

## 1. Problèmes trouvés (exhaustif, par zone)

### 1.1 Touch targets
- **(corrigé)** Bouton « 📐 Tracer le toit (3D) » : 40 px → **≥ 44 px**.
- **(corrigé)** Boutons du chrome `TakeoffFullscreen` : déjà ≥ 48 px (1D) ; ajout `touch-action:manipulation`.
- **(restant — studio)** Les boutons de la toolbar `AdminRoofStudio` font ~36 px (`padding:9px 14px`). Acceptables au doigt fin, **un peu petits avec des gants**. Non corrigé volontairement (modif large d'un fichier moteur ~hors scope/risque).

### 1.2 Responsive / overflow
- **(corrigé)** Bannière `/admin/quote` : `flex` sans `wrap` → overflow horizontal probable sur petit écran ; passé en `flexWrap:'wrap'`.
- **(corrigé)** `TakeoffFullscreen` `width:100vw` (peut dépasser le viewport avec scrollbar) → remplacé par `right:0`.
- **(restant)** `AdminQuoteGenerator` est très dense (formulaire admin ~7000 lignes) : certaines lignes de boutons/tableaux peuvent provoquer du scroll horizontal sur très petit écran. Non audité ligne par ligne (risque de régression). À vérifier sur device.
- **(OK)** `TakeoffFullscreen` : `100dvh` + `env(safe-area-inset-*)` déjà en place (1C/1D).

### 1.3 Dropdowns / menus
- **(OK)** Google Places autocomplete : `.pac-container { z-index:100000 }` déjà forcé (sinon caché sous l'overlay). Touch sur iOS géré par le pattern existant (StepAddress).
- **(restant — studio)** Les « menus » du studio (Dessin/Fichier/Acc/Carte) sont des **bandes de boutons** (pas des dropdowns flottants) → pas de problème de troncature/hover-only. Densité élevée sur petit écran (voir 1.1).
- **(restant — quote)** Vérifier les `<select>`/dropdowns custom du formulaire admin sur iOS (natif vs custom) — non audité en détail.

### 1.4 Fullscreen mobile (TakeoffFullscreen)
- **(OK)** `position:fixed`, `100dvh`, safe-area top/bottom, body-scroll-lock compté, `overscroll-behavior:none`, flush visibility/pagehide, back-button popstate (ferme l'overlay seulement). Tous hérités 1C/1D.
- **(corrigé)** suppression `100vw` (overflow potentiel).
- **(restant)** Comportement précis des **barres dynamiques Safari** + **clavier** (resize viewport) à confirmer sur device — `dvh` aide mais non testé réel.

### 1.5 Form UX
- **(restant — quote)** Champs numériques (superficie/overrides) : vérifier `inputMode="decimal"`/`numeric` pour le bon clavier mobile. L'input adresse a déjà l'autocomplete Google. Non modifié (risque sur un formulaire de prod).
- **(OK)** CTA « Valider le takeoff » bien visible (vert, ≥ 48 px). « 📐 Tracer le toit (3D) » visible (mauve, ≥ 44 px).

### 1.6 AdminRoofStudio mobile
- **(OK)** pinch-zoom 2 doigts corrigé précédemment ; `touch-action:none` sur le canvas ; toolbars repliables (menus Dessin/Fichier/Acc/Carte), défaut replié sur mobile (`wideScreen`).
- **(restant)** Densité des toolbars + taille des boutons (~36 px) sur iPhone : confortable mais perfectible. Hors scope (ne pas réécrire le studio).

### 1.7 Performance UX
- **(OK)** 3D = rastériseur logiciel en RAF ; autosave debouncé + idle + skip-si-inchangé (1D) → pas de dérive par frame.
- **(restant)** Sur **très gros toits**, la dérive (validation/autosave) peut être perceptible ; atténuée, mesurable via l'instrumentation DEV (`derive_autosave`, `validate`).

---

## 2. Corrections appliquées (résumé)
1. Bannière `/admin/quote` → `flexWrap` (anti-overflow).
2. Bouton Takeoff → cible ≥ 44 px + `touch-action:manipulation`.
3. `TakeoffFullscreen` → positionnement `top/left/right + 100dvh` (anti-`100vw`), `touch-action` sur boutons.

Toutes vérifiées par typecheck + build + 103 tests.

---

## 3. Problèmes restants NON résolus (volontaire — hors scope / risque)
- Taille des boutons de la toolbar studio (~36 px) — modifierait un fichier moteur dense.
- Audit ligne par ligne du formulaire `/admin/quote` (overflow possible, claviers numériques, ordre de focus) — risque de régression sur un écran de prod.
- `<select>`/dropdowns du formulaire admin sur iOS — à vérifier au cas par cas.
- Comportement clavier/barres dynamiques Safari — nécessite un device.

---

## 4. Risques Safari iOS restants
- `100dvh` + barres d'URL dynamiques : robuste en théorie, **à confirmer** (encoches, bas d'écran).
- Geste de retour (swipe) : `popstate` intercepte et ferme l'overlay ; à valider sur device réel.
- Clavier qui ouvre/ferme : peut modifier la hauteur visible ; non testé.
- Tap-delay/double-tap-zoom : atténué par `touch-action:manipulation` sur les boutons clés.

---

## 5. Sections les plus fragiles
1. **Formulaire `/admin/quote`** (très dense, ~7000 lignes) — le plus à risque d'overflow/clavier sur petit écran ; non audité en profondeur.
2. **Toolbars `AdminRoofStudio`** sur iPhone (densité + taille des boutons).
3. **Barres dynamiques Safari** autour de l'overlay fullscreen.

---

## 6. Recommandations UX terrain
- Boutons ≥ 44–48 px partout où l'utilisateur agit avec des gants (fait pour les CTA takeoff ; à étendre à la toolbar studio en Phase suivante).
- `inputMode` numérique sur les champs de surface/longueur du formulaire admin.
- Un seul « Valider » visible (atténuer le doublon menu Fichier / overlay).
- Toast court « Takeoff appliqué » au retour dans la soumission.
- Tester sur 2–3 vrais appareils (un iPhone à encoche, un Android milieu de gamme) avant usage large.

---

## 7. GO / NO-GO usage terrain réel

**GO pour bêta terrain encadrée (interne), NO-GO pour usage terrain large** tant
qu'une **passe sur appareils réels** (Safari iOS + Chrome Android) n'a pas validé :
overflow du formulaire admin, claviers, barres dynamiques, gestes retour. Les
correctifs de cette passe (anti-overflow bannière, anti-`100vw`, cibles tactiles)
réduisent les risques évidents sans rien casser (tests/build verts), mais
l'expérience « gants sur un toit » du **formulaire admin dense** et de la **toolbar
studio** mérite une itération dédiée (touch targets + claviers) après observation
sur device.
