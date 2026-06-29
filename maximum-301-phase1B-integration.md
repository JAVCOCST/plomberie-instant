# Maximum 301 — Phase 1B intégrée aux contrats Phase 0

**51 tests verts · build OK · typecheck src propre (seules 2 erreurs pré-existantes
hors-sujet dans `StepDate.tsx`).** Aligné sur les vrais fichiers du builder :
`max-301.product-spec` + `accessory-anchor.schema` + README Phase 0.
Viewer V5 **non importé** (référence QA seulement).

---

## 1. ProductSpec = source unique de vérité
- `src/lib/roof-accessories/max-301.product-spec.json` — le spec **verbatim**
  (7 variantes 301-12→301-24, dimensions officielles A/B/C/D, NFA, déflecteurs,
  placement_rules, ventilation_rules, geometry_rules, ui_hints, open_questions).
- `catalog.ts` lit ce JSON (aucune dimension hardcodée ailleurs) :
  `getVariant(id)`, `nfaSqInOf`, `nfaSqFtOf`, `defaultSlopeOffsetMm(id)`
  (= `max(min_ridge, (A+flange)/2+30)` depuis le spec), `VARIANT_IDS`, `MAX_301_SPEC`.

## 2. AccessoryInstance (type) — forme réelle
`types.ts` :
```
AccessoryInstance = {
  id, type: "roof_accessory", product_id, variant_id,
  anchor: AccessoryAnchor, parameters?{color_id}, overrides?{accepted_warnings}, metadata?{created_at,…}
}
```
Pas de snapshot de dimensions sur l'instance → runtime lit le ProductSpec.

## 3. AccessoryAnchor + validation du schéma
`anchor.ts` — `validateAnchor()` conforme à `accessory-anchor.schema v1.0.0` :
- `anchor_version` **string** `"1.0.0"`
- `section_id` / `edge_id` strings stables — **rejet des index numériques**
- `edge_t` ∈ [0,1] · `slope_offset_mm` ≥ 0 · `pan_side` ∈ {`primary`,`secondary`}
- `fallback_anchor` objet (`strategy` validée) · `orphan_state`
- `makeAnchor()` construit la forme exacte (edge_id dérivé `S1:ridge:0`,
  fallback `nearest_ridge_in_section`, radius 2000).

## 4. Round-trip save/reload
`annotation.ts` — `accessories[]` dans `buildAnnotation`/`parseAnnotation`
(**pass-through**, jamais une section). Test : survit save→parse→rebuild,
`type:"roof_accessory"`, `variant_id`, `anchor.anchor_version "1.0.0"`, et
**jamais présent dans `sections[]`**.

## 5. Branché dans le traceur (`AdminRoofStudio.tsx`)
- État `accessories` (init `initialModel`, restauré depuis l'annotation parsée).
- `RoofModel↓` (buildModel) → inclut `accessories[]`.
- `RoofModel↑` (importRoofModel) → restaure `accessories[]`.
- `v1.6↑` → reset `accessories[]`.
- Bouton **`+ acc test`** : crée un Maximum **301-16** réel (product_id +
  variant_id + anchor validé, `slope_offset_mm` auto = 305), `reset acc` vide.
- Bandeau REVIEW : `… · N acc`.

## 6/7. Garanties
- `accessories[]` = état distinct de `secs` → **aucune section créée**.
- `computeMeasures(secs,…)` et `render3D(secs,…)` ne lisent que `secs`
  → **mesures, 3D, take-off intacts**.
- Validation ventilation paramétrable (`ventilationValidation.ts`) :
  règle 1/300 ou 1/150 en entrée ; **`calibration_required`** si pas de
  calibration ; NFA réels (256 po² pour 301-16, 484 pour 301-22, etc.).

---

## Fichiers
```
src/lib/roof-accessories/
  max-301.product-spec.json     (contrat, verbatim)
  types.ts                      (anchor + instance + variant typings)
  catalog.ts                    (lit le spec)
  anchor.ts                     (validateAnchor + makeAnchor)
  ventilationValidation.ts      (moteur paramétrable)
  anchor.test.ts · ventilationValidation.test.ts
src/lib/roof-core/annotation.ts + .test.ts   (round-trip accessories[])
src/pages/AdminRoofStudio.tsx                (état + RoofModel↓/↑ + bouton test)
tsconfig.app.json                            (resolveJsonModule: true)
```

## À tester en live (après redéploiement)
1. Ouvre une toiture → **`+ acc test`** (compteur `1 acc`).
2. **`RoofModel↓`** → le JSON contient `accessories[{ type:"roof_accessory",
   variant_id:"301-16", anchor:{ anchor_version:"1.0.0", … } }]`, **absent** de `sections[]`.
3. Recharge → **`RoofModel↑`** → `1 acc` restauré, mesures/3D inchangés.

## Hors scope (pas encore)
Placement interactif · clic faîtière · résolution anchor→world · rendu 3D Maximum ·
ventilation finale branchée · take-off / soumission.

> Note typecheck : utiliser `tsc -p tsconfig.app.json` (le `-p tsconfig.json`
> ne vérifie rien — solution-file `files:[]`). 2 erreurs pré-existantes dans
> `StepDate.tsx` (non liées aux accessoires).
