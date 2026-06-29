# Mobile Toolbar &amp; Touch Interaction Pass — AdminRoofStudio

> Passe **mobile touch UX only** sur la toolbar du traceur. Aucun changement de
> `roof-core`, de géométrie, d'architecture, de flow, ni de features. Desktop et
> studio standalone préservés.

> ⚠️ Pas d'appareil réel dans cet environnement → revue de code + tailles
> conformes aux repères iOS (HIG ≥ 44 px). À confirmer sur device.

---

## 0. Fichiers modifiés
| Fichier | Changement |
|---|---|
| `src/pages/AdminRoofStudio.tsx` | Flag **`touchUI`** réactif (viewport < 768, suit la rotation) ; agrandissement des cibles tactiles de la toolbar + états actifs ; rien d'autre. |
| `docs/mobile-toolbar-touch-pass.md` | Ce document. |

---

## 1. Problèmes trouvés
- **Boutons trop petits** : menu (`B`) ~36 px, bandes Fichier/Acc/Carte (`vbtn`) ~33 px, sélecteur de sections (S1/S2/+) ~36 px — sous le seuil tactile (44 px).
- **Espacement serré** : clusters (`grp`) gap 6 px, toolbar gap 8 px — dense au pouce.
- **État actif peu marqué** : fond translucide seulement.
- **Délai tactile** : pas de `touch-action:manipulation` → risque de délai 300 ms / double-tap-zoom sur les contrôles.
- **Non réactif à la rotation** : `wideScreen` était calculé une seule fois.

---

## 2. Corrections appliquées (mobile uniquement)
- **`touchUI`** réactif (`useState` + listener `resize`) → bascule taille compacte (desktop) ↔ tactile (mobile) et suit la rotation.
- **`B` (tous les boutons de menu/outil)** : sur mobile `min-height 48 px`, padding `13/16`, police 15, **`touch-action:manipulation`**, **état actif renforcé** (texte gras + halo `box-shadow` à la couleur du bouton).
- **`vbtn` (bandes Fichier / Acc / Carte)** : sur mobile `min-height 46 px`, padding `12/15`, police 14, `touch-action`.
- **`grp` (clusters d'outils)** : sur mobile gap 10, padding `6/8`.
- **Toolbar haute** : sur mobile gap 10, padding 10.
- **Sélecteur de sections + bouton `+`** : sur mobile `min-height 48 px`, `min-width 48` pour le `+`, `touch-action`.

Desktop : tailles d'origine conservées (le seul effet visible hors mobile est un léger halo sur le bouton actif + coins un poil plus arrondis — cosmétique, non cassant).

---

## 3. Layout mobile (inchangé, déjà OK)
- Menus repliables (Dessin/Fichier/Acc/Carte) **repliés par défaut sur mobile** (`wideScreen=false`) → seule la rangée de menus s'affiche au départ (peu d'encombrement).
- La toolbar `flex-wrap` ; avec des boutons plus grands elle peut prendre 1–2 lignes, le canvas occupe le reste (flex).
- Outil actif désormais dominant (gras + halo).

---

## 4. Canvas interaction (inchangé — déjà géré)
- `touch-action:none` sur les canvas 2D/3D ; pinch-zoom 2 doigts corrigé précédemment ; pan OK.
- Safe-area/notch : gérée par l'overlay `TakeoffFullscreen` (quand le studio y est monté) ; en standalone `/admin/roof-studio`, hérite du layout admin (inchangé).
- Pas de modification des gestures (hors scope).

---

## 5. Problèmes restants / sections fragiles
- **Petits boutons « x » inline** (retrait image de fond, fermeture sélection) et **slider d'opacité** : non agrandis (peu fréquents, agrandissement = plus d'edits inline à risque). À faire si gênant en test.
- **Panneau « Mesures » 3D** (légende repliable) : boutons compacts ; panneau secondaire, non prioritaire.
- **Densité quand tous les menus sont ouverts** sur petit écran : la toolbar peut occuper plusieurs lignes. Acceptable (replié par défaut) mais à observer.
- **Barres dynamiques Safari / clavier** autour du studio en overlay : à valider sur device.

---

## 6. Risques iPhone restants
- Tailles ≥ 46–48 px conformes HIG, mais le **confort réel avec des gants** reste à valider sur device.
- Toolbar multi-lignes si beaucoup d'outils ouverts → vérifier qu'elle ne mange pas trop l'écran sur petit iPhone.
- `touch-action:manipulation` supprime le double-tap-zoom **sur les boutons** ; le canvas garde son propre `touch-action:none`.

---

## 7. Validation
- `vitest run` → **103 tests verts**.
- `tsc --noEmit -p tsconfig.app.json` → propre (hors 2 erreurs `StepDate` pré-existantes).
- `vite build` → OK.

---

## 8. GO / NO-GO chantier réel
**GO pour bêta terrain encadrée** : les cibles tactiles principales de la toolbar
(menus, bandes, sélecteur de sections) passent à 46–48 px avec espacement accru,
état actif clair et suppression du délai tactile — nettement plus confortable au
pouce, sans toucher au moteur ni casser desktop/standalone. **NO-GO usage large**
tant qu'une vérification sur **vrai iPhone/Android** (confort gants, toolbar
multi-lignes, barres Safari) n'est pas faite, et tant que les quelques contrôles
inline secondaires (« x », slider, panneau Mesures) n'ont pas été observés en
conditions réelles.
