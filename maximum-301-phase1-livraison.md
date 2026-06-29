# Maximum 301 — Phase 1 livrée

**Commit `583e165` sur `main`. 46 tests verts, 0 erreur TS, build OK.**
Toutes tes corrections appliquées. Aucun rendu 3D, aucun branchement
soumission/take-off (hors scope Phase 1).

---

## Fichiers créés — `src/lib/roof-accessories/` (couche pure, sans DOM)

### `types.ts`
`RoofAccessory` avec **vérité persistée minimale** :
```
attach = {
  section_id   : string  // id STABLE "S1", "R1"… (jamais un index numérique)
  ridgeAnchor  : {x,y}    // point sur la faîtière, pixels-image
  ridgeT       : number   // 0..1 le long de la faîtière
  panSide      : "up"|"down"
  slopeOffset  : number   // distance aval depuis la faîtière (px-image)
  heightOffset : number   // anti z-fighting le long de la normale
}
```
`edge_id` / `plane_id` / `position3D` / axes → dans `derived` = **cache** (jamais
la vérité, recalculés depuis la géométrie courante).
Inclut aussi : types catalogue (`MaximumSpec`), soffite (`SoffitVentilation`),
et I/O validation (`VentilationInput` / `VentilationSummary`).

### `catalog.ts`
Maximum **301-12 → 301-24** (7 modèles). Toutes les cotes/NFA = `null`,
`confirmed: false`, `requires_manufacturer_confirmation` rempli.
**Aucune valeur fabricant inventée** — à remplir depuis le guide officiel.

### `ventilationValidation.ts`
Moteur **paramétrable** :
- règle (`1/300` | `1/150`) et split intake/exhaust = **entrées**, pas en dur ;
- `required_total = surface / règle × 144` (po²) ;
- **calibration absente → `status: "calibration_required"`** (placement visuel
  possible, mais validation/take-off gelés) ;
- NFA non confirmé → warning `nfa_unconfirmed` ;
- sortie = `ventilation_summary` (format demandé).

### `ventilationValidation.test.ts`
Tests : catalogue non confirmé, NFA requis (1/300), ok / warn / insufficient,
`calibration_required`, surface inconnue, NFA non confirmé, `count_required`.

---

## Modifié — `src/lib/roof-core/annotation.ts`
`accessories[]` ajouté au round-trip `buildAnnotation` / `parseAnnotation` en
**pass-through** (jamais une section). Test prouvant : survit
save → parse → rebuild, garde un `section_id` **string**, n'apparaît jamais
dans `sections[]`.

---

## Corrections demandées — état

| # | Correction | État |
|---|---|---|
| 1 | `section_id` = id stable string (S1, R1…), pas un index | ✅ type `string` + test |
| 2 | vérité = section_id + ridgeAnchor + ridgeT + panSide + slopeOffset ; edge/plane/pos3D = dérivés | ✅ `attach` vs `derived` |
| 3 | Maximum = RoofAccessory, jamais une section | ✅ `accessories[]` séparé + test |
| 4 | dims fabricant en mm/catalogue ; calibration = placer/valider seulement | ✅ catalogue mm, calibration en entrée de validation |
| 5 | calibration absente → "calibration requise" | ✅ `status: "calibration_required"` |
| 6 | Phase 1 = types + catalog + ventilation + round-trip, rien d'autre | ✅ aucun rendu 3D / take-off |
| 7 | specs en catalogue seulement si confirmées, sinon flag | ✅ tout `null` + `requires_manufacturer_confirmation` |

---

## Prochaine étape (après validation par toi)
1. Brancher `accessories[]` dans l'état de `AdminRoofStudio` + `buildModel`
   pour tester le **save/reload réel** dans le traceur / Training Lab.
2. Pour activer la validation ventilation : me fournir les **specs confirmées**
   (NFA, col, déflecteur, hauteur, solin) + les **paramètres** (1/300 vs 1/150,
   split intake/exhaust) + le **facteur px↔mm/pi**.
3. Ensuite seulement : placement interactif (Phase 2).
