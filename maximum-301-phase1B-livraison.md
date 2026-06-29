# Maximum 301 — Phase 1B livrée

**Commit `003d6b9` sur `main`. 46 tests verts · 0 erreur TS · build OK.**

Objectif : brancher `accessories[]` dans l'état réel de `AdminRoofStudio` et
dans `buildModel` / `parseAnnotation` pour tester le **save/reload complet** dans
le traceur — sans placement interactif, sans rendu 3D, sans take-off.

---

## Ce qui a été fait (mapping de tes 7 points)

| # | Tâche | Fait |
|---|---|---|
| 1 | `accessories[]` dans l'état du traceur | ✅ état `accessories` (init depuis `initialModel`, restauré à l'ouverture depuis le Lab) |
| 2 | Accessoire test manuel/importable | ✅ bouton **`+ acc test`** (Maximum 301-16 depuis le catalogue) + restauration via `RoofModel↑` |
| 3 | `RoofModel↓` contient `accessories[]` | ✅ `buildModel` → `buildAnnotation({ …, accessories })` |
| 4 | `RoofModel↑` restaure `accessories[]` | ✅ `importRoofModel` → `setAccessories(ann.accessories)` |
| 5 | Aucune section créée | ✅ état **séparé**, jamais ajouté à `secs` |
| 6 | Ne touche pas mesures / 3D / take-off | ✅ `computeMeasures` et `render3D` lisent `secs` uniquement |
| 7 | Test round-trip annotation avec `accessories[]` | ✅ `annotation.test.ts` (survit save→parse→rebuild, `section_id` string, jamais dans `sections`) |

---

## Fichiers modifiés

### `src/pages/AdminRoofStudio.tsx`
- **État** `accessories` ajouté (à côté de `rejected`), initialisé depuis
  `initialModel.accessories`.
- **Effet d'init** (ouverture depuis le Lab) : `setAccessories(p.accessories)`.
- **`buildModel`** (RoofModel↓) : passe `accessories` à `buildAnnotation`.
- **`importRoofModel`** (RoofModel↑) : `setAccessories(ann.accessories)`.
- **`importV16`** (nouvelle annotation MVP) : `setAccessories([])`.
- **`addTestAccessory()`** : crée un Maximum 301-16 ancré au centroïde de la
  section active, `section_id` = string (`"S1"`…), specs = catalogue (toutes
  `null`, non confirmées), `placement_status: "unplaced"`.
- **Barre REVIEW** : compteur `… · N acc` + boutons `+ acc test` / `reset acc`.

### `src/lib/roof-core/annotation.ts` (déjà en Phase 1, confirmé ici)
- `accessories[]` dans `Annotation`, `BuildInput`, `ParsedAnnotation`,
  `buildAnnotation`, `parseAnnotation` — **pass-through** (jamais une section).

### `src/lib/roof-core/annotation.test.ts`
- Round-trip incluant un accessoire ; assertions : `section_id` string,
  accessoire absent de `sections[]`.

---

## Garanties (par conception)
- `accessories[]` est un **état distinct** de `secs` → ne crée jamais de pan.
- `computeMeasures(secs, valleys)` et `render3D(secs…)` n'utilisent que `secs`
  → **mesures, 3D et take-off intacts**.
- `buildModel` met les sections dans `sections[]` et les accessoires dans
  `accessories[]` → aucune fusion possible.

---

## Critère de réussite — à vérifier en conditions réelles
> Comme je ne peux pas piloter le navigateur, le round-trip est prouvé au niveau
> données (tests). À confirmer à l'écran après redéploiement :

1. Charger une toiture → cliquer **`+ acc test`** → le compteur passe à `1 acc`.
2. **`RoofModel↓`** → ouvrir le JSON : `accessories[]` présent, **absent** de `sections[]`.
3. Recharger la page → **`RoofModel↑`** (le fichier) → compteur `1 acc` restauré,
   mesures / vue 3D inchangées.

---

## Hors scope (non touché, comme demandé)
- Placement interactif / clic faîtière
- Rendu 3D du Maximum
- Validation ventilation finale
- Branchement take-off / soumission

## Prochaine étape
Tu valides le **data model + save/reload réel** → on passe à la **Phase 2
(placement interactif : clic faîtière → ghost → drag contraint)**.
