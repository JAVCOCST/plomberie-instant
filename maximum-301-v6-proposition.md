# V6 — Intégration des Maximum / évents dans le traceur (proposition, sans code)

> Aucune ligne de code ici. Proposition UX + architecture + données à valider
> **avant** implémentation. Calée sur le moteur **réel** du traceur.
> Les cotes/NFA réels = `requires_manufacturer_confirmation` (je n'invente rien).

## Cadre technique réel (ce qu'on réutilise)

- **Rasteriseur maison** (`render3D` → `proj3` + z-buffer), **pas Three.js** → modèle **paramétrique** low-poly, pas de GLB pour le v6.
- **Faces** : `collectFaces(secs)` → `{ si, f, fpts, pl:{a,b,c}, grad, pignon, pitch }` ; plan `z = a·x + b·y + c`.
- **Faîtières** : arêtes squelette `isRidge` ; **noues** : `computeValleys(secs)` ; **arêtiers** : arêtes hip ; **pignon** : `face.pignon`.
- **Picking** : `hitFaceDetailed(x,y,…)` (déjà amélioré : profondeur au curseur).
- **Le drag contraint existe déjà** : ton mode **solide ↕Z** (`zdrag3`, down-grab → drag 1-DOF → readout live → release). On **reproduit ce feeling** pour 2 axes au lieu de l'axe Z. Pas de gizmo.
- Coords 2D = **pixels-image** ; 3D = `sceneScale` + `proj3`. Persistance via `annotation.ts` (`buildAnnotation`/`parseAnnotation`).

⚠️ **Clarification produit importante** : un ventilateur Maximum se pose **sur le pan, près de la faîtière** (pas *sur* l'arête comme un ridge vent). Donc « cliquer une faîtière » = **ancrer par rapport à la faîtière**, mais le corps vit sur le pan avec un `slope_offset` (distance en aval). Le v6 modélise ça (offset par défaut ≈ demi-curb + marge).

---

## A) Proposition UX exacte

**Choix + pose en 2 clics :**
1. Sélecteur de modèle dans la barre 3D (boutons `301-12 … 301-24`) → entre en `mode placement`.
2. **Survol d'une faîtière** → elle se met en surbrillance + un **ghost** (empreinte + mini-modèle translucide) apparaît, ancré sur la faîtière au point survolé, posé sur le pan sous le curseur, orienté avec la faîtière.
3. **Clic** → confirme. `Échap` annule.

**Déplacement (objet sélectionné) — 2 drags 1-DOF, même feeling que le Z-drag :**
- **Drag par défaut = parallèle à la faîtière** (curseur ↔ direction faîtière projetée).
- **2ᵉ axe = amont/aval** : soit un petit **toggle** `↔ faîtière / ▲ pente`, soit **deux poignées** sur le modèle (bleue = faîtière, orange = pente). Pas de XYZ libre, pas de rotation.
- **Readout live** (comme `zInfo`) : `↔ faîtière t=0.42 · ▲ pente 180 mm`.
- **Feedback couleur** de l'empreinte : **vert** valide / **jaune** limite / **rouge** invalide (mêmes seuils que la validation placement).
- **Snapping visuel** : centre de faîtière (`t=0.5`), espacement régulier entre plusieurs Maximum, marge de bord. Lignes guides discrètes (réutilise le style des guides 2D).

Même logique en 2D et 3D : clic faîtière → ghost → confirmer → drag contraint.

---

## B) Architecture minimale

```
src/lib/roof-accessories/        ← PUR, testable, sans DOM (comme annotation.ts)
  types.ts                       ← RoofAccessory, specs, validation
  catalog.ts                     ← Maximum 301-12..24 (params + confidence)
  placement.ts                   ← localFrame(), derivePose(), constrainMove(), validatePlacement()
  geometry.ts                    ← generateMaximumMesh() (paramétrique, repère local)
  ventilation.ts                 ← validateVentilationBalance()
  *.test.ts                      ← tests headless (placement, contraintes, NFA)

RoofModel/Annotation.accessories[]   ← persistance (round-trip annotation.ts)

AdminRoofStudio.tsx
  - accMode + draftR (ghost)     ← même pattern que zdrag3 / guideR
  - rendu 2D (effet draw) + rendu 3D (render3D)  ← lisent le MÊME accessories[]
```

Règle d'or : **`accessories[]` ≠ `sections[]`**. Le Maximum n'altère jamais la géométrie de toiture ; il ajoute une ouverture/obstacle/quantité **dérivée** au take-off et au rapport.

---

## C) Structure JSON — `RoofModel.accessories[]`

Principe clé : **stocker la vérité minimale, dériver le reste.** Comme le squelette est recalculé, `edge_id`/`plane_id` ne sont **pas** une vérité stable. La vérité = `section_id` + une **ancre 2D en pixels-image** + offsets. On **re-résout** l'arête/pan au chargement.

```jsonc
{
  "id": "acc_max301_001",
  "type": "ventilation_maximum",
  "modelType": "maximum_301_16",          // → catalogue
  "specVersion": 1,                       // fige specs au placement
  // ── VÉRITÉ (persistée, robuste au re-skeleton) ──
  "attach": {
    "sectionId": 0,                       // index de section (S1=0)
    "ridgeAnchor": { "x": 640.0, "y": 420.0 },  // point sur la faîtière, px-image
    "panSide": "down",                    // de quel côté de la faîtière vit le corps
    "ridgeT": 0.50,                       // 0..1 le long de la faîtière (redondant/cache)
    "slopeOffset": 180.0,                 // distance en aval depuis la faîtière, px-image (signé)
    "heightOffset": 0.0                   // anti z-fight, le long de la normale
  },
  // ── DÉRIVÉ (recalculé au rendu; figé à l'export pour l'aval) ──
  "derived": {
    "planeId": "P3", "edgeId": "E12", "edgeType": "ridge",
    "position2D": { "x": 658.0, "y": 470.0 },
    "position3D": { "x": 658.0, "y": 470.0, "z": 196.3 },
    "footprint2D": [[..],[..],[..],[..]],
    "footprint3D": [[x,y,z], ...],
    "ridgeAxis": [dx,dy], "slopeAxis": [dx,dy], "roofNormal": [nx,ny,nz],
    "pitchDeg": 45.0, "pitch": "12/12"
  },
  // ── SPEC FIGÉE (copie depuis catalogue) ──
  "dimensions": { "curb_mm": 559, "deflector_mm": 749, "height_mm": 400,
                  "flashing_downslope_mm": 413, "nfa_sq_in": 484 },
  "confidence": {
    "official_dimensions": true,
    "internal_supports_confirmed": false,
    "curb_embed_depth_confirmed": false
  },
  "validation": {
    "placement_status": "ok",            // ok | warn | invalid
    "warnings": []                        // [{ rule, severity, value, limit }]
  }
}
```

**Champs que je garde / change vs ta proposition :**
- Je **fusionne** `attached_to` + `placement` → `attach` (la seule vérité). `anchor` devient `ridgeAnchor` (px-image, jamais en coord 3D figées).
- `edge_id/plane_id/orientation/geometry/position*` → passent dans `derived` (calculés, figés seulement à l'export, comme tes `planes`).
- J'ajoute `modelType` + `specVersion` (catalogue non dupliqué, repro garantie).
- `assembly_vertical_world` → pas un champ : c'est une **règle de géométrie** (curb toujours vertical monde), implicite.

`accessories[]` est ajouté à `Annotation` + au round-trip `buildAnnotation`/`parseAnnotation` → survit save / reload / Training Lab / rapport.

---

## D) Logique de placement sur faîtière

Au clic (2D ou 3D) :
1. **Faîtière cliquée** : projeter toutes les arêtes `isRidge` (toutes sections) à l'écran ; prendre la plus proche du curseur (< seuil px). → `ridgeAnchor` = projection du curseur sur le segment ; `ridgeT` = paramètre 0..1.
2. **section_id** : la section propriétaire de cette arête de faîtière.
3. **pan / plane_id** : une faîtière sépare **deux pans**. `panSide` = le pan sous le curseur (ou le plus grand par défaut). Le `plane_id` = `collectFaces` de ce pan.
4. **Repère local** (tout dérivé, jamais stocké comme vérité) :
   - `ridgeAxis` = `unit(ridge.b − ridge.a)` (plan).
   - `roofNormal` = `unit([-pl.a, -pl.b, 1])` (depuis l'équation du plan).
   - `slopeAxis` (plan) = perpendiculaire à `ridgeAxis`, **pointant en aval** dans le pan (vers l'intérieur, descendant).
   - `worldUp` = `[0,0,1]`.
5. **Position initiale** : `ridgeAnchor + slopeAxis * slopeOffsetDefault` (≈ demi-curb + marge), `z = pl.a·x + pl.b·y + pl.c`, décalée de `heightOffset` le long de `roofNormal`.
6. **Orientation** : `roof_assembly` suit la pente (rotation autour de `ridgeAxis` de `pitchDeg`) ; `max301_assembly` **reste vertical monde** (curb sur `worldUp`).

Flux : `clic faîtière → preview ghost → confirmer/placer`.

---

## E) Déplacement contraint (2 axes seulement)

Réutilise **exactement** le pattern du drag de solide (`zdrag3`) : on grab, on mappe le delta-écran sur **un axe-monde projeté**, readout live, release.

- **A. Parallèle faîtière** : `Δt` = (drag-écran · `ridgeAxis` projeté à l'écran) × ratio. Met à jour `ridgeT` / `ridgeAnchor` le long de l'arête.
- **B. Amont/aval** : `Δoffset` = (drag-écran · `slopeAxis` projeté) × ratio. Met à jour `slopeOffset`.
- Ratio = `1/|axe projeté à l'écran|` (même calcul que les anciennes poignées `perpScr/ratio`).

**Clamp / interdits** (la position est *bornée*, pas refusée — feedback rouge si on force au bord) :
- rester **dans le pan** : les 4 coins du footprint sur la **même** face (`hitFace`), sinon clamp.
- distance min **noue** (`computeValleys` → `distPtSeg`), **arêtier** (arêtes hip), **bord/égout** (`boundaryDist`/`segDist`).
- distance min **autre Maximum** (gap entre footprints).
- pas à cheval sur 2 plans ; pas sur pignon/vertical.
- distances = **paramètres** du guide (TODO_GUIDE), pas inventées.

UX : hover faîtière (surbrillance) → ghost → 2 poignées (ou toggle `↔ / ▲`) → readout `t / offset mm` → empreinte vert/jaune/rouge → snapping (centre, espacement régulier).

---

## F) Vue 2D + Vue 3D (une seule source)

Les deux vues **dérivent** de `attach` (via `placement.ts`). Aucune duplication.

**2D** (overlay dans l'effet draw) : empreinte du solin (carré orienté), symbole d'ouverture, **flèche de pente** (`slopeAxis`), trait vers la faîtière attachée, **label modèle**, warnings, (option) zone d'influence ventilation.

**3D** (`render3D`, après les faces) : mesh paramétrique projeté via `proj3` + z-buffer (occlusion cohérente avec le toit), décalé de `heightOffset` le long de la normale.

---

## G) Surface de soffite

```jsonc
"soffit": {
  "ventilation_area_sq_in": 0,           // surface libre estimée
  "ventilated_length_ft": 0,
  "ventilated_width_in": 0,
  "open_ratio": 0,                       // ratio d'ouverture (perfo/grille)
  "source": "manual",                    // manual | estimated | imported
  "confidence": "low",                   // low | medium | high
  "notes": ""
}
```
Stocké au niveau **RoofModel** (pas par accessoire) → sert au bilan intake/exhaust.

---

## H) Validation du nombre de Maximum (moteur paramétrable)

Pas de règle légale en dur. Entrées = paramètres ; sortie = ton format :

```jsonc
"ventilation_summary": {
  "rule": "1/300",                       // 1/300 | 1/150 | custom (param)
  "attic_area_sqft": 1500,               // saisi / dérivé du take-off
  "required_total_nfa_sq_in": 720,       // area/rule*144
  "required_exhaust_nfa_sq_in": 360,     // split 50/50 (param)
  "required_intake_nfa_sq_in": 360,
  "provided_exhaust_nfa_sq_in": 968,     // Σ NFA des Maximum installés
  "provided_intake_nfa_sq_in": 420,      // depuis soffit.ventilation_area
  "max301_count_required": 2,            // ceil(required_exhaust / NFA_modèle)
  "max301_count_installed": 2,
  "ventilation_balance_status": "ok",    // ok | warn | insufficient
  "warnings": []
}
```
Tous les facteurs (rule, split, marge pente, modèle) sont des **params**.

---

## I) Specs Maximum à stocker (catalogue)

Par modèle `301-12 … 301-24` :
```jsonc
{
  "modelType": "maximum_301_16", "label": "Maximum 301-16",
  "throat_in": 0, "deflector_mm": 0, "height_mm": 0,
  "curb_mm": 0, "flashing_downslope_mm": 0,
  "nfa_sq_in": 0,                        // confirmé fabricant
  "pitch_compat": { "min": null, "max": null },
  "source": "manufacturer_guide | deduced",
  "official_dimensions": true,           // cotes officielles confirmées
  "requires_manufacturer_confirmation": ["internal_supports","curb_embed_depth"]
}
```
**Cotes/NFA officiels** (confirmés) **distingués** des détails visuels déduits (`requires_manufacturer_confirmation`). Valeurs réelles = à remplir depuis le guide.

---

## J) Risques / ambiguïtés

1. **Renderer custom** (pas Three.js) → modèle paramétrique low-poly ; GLB = évolution future en overlay.
2. **Cotes/NFA réels** = du fabricant uniquement (TODO_GUIDE) — non inventés.
3. **« Sur la faîtière » vs « sur le pan »** : un Maximum se pose sur le pan près de la faîtière → modèle ancre+offset (clarifié plus haut).
4. **Références stables** : pas d'`edge_id` stable dans le moteur (squelette recalculé). → vérité = `sectionId + ridgeAnchor(px) + offsets`, on re-résout au chargement. `edge_id/plane_id` = cache.
5. **Faîtière partagée par 2 pans** : besoin de `panSide`.
6. **Pans concaves/complexes** : fiabilité du pick + contrainte « un seul plan ».
7. **Curb vertical sur forte pente** : la géométrie doit garder le curb vertical-monde alors que le flashing épouse la pente.
8. **Take-off** : l'ouverture du Maximum **réduit-elle** la surface de bardeaux ? → param (oui/non) ; par défaut, accessoire = quantité séparée, ne modifie pas `sections`.

---

## K) Ordre d'implémentation recommandé

1. **`roof-accessories/` pur** : `types` + `catalog` (specs en params) + `ventilation.ts` (validation NFA/équilibre) + tests headless. → valeur immédiate (rapport/validation) sans toucher au rendu.
2. **`accessories[]` round-trip** dans `annotation.ts` (save/reload/Training Lab).
3. **`placement.ts` pur** : `localFrame`, `derivePose`, `constrainMove` (clamp), `validatePlacement` + tests (direction des axes, bornes).
4. **2D** : sélecteur modèle → clic faîtière → ghost → pose → 2 drags contraints → empreinte vert/jaune/rouge.
5. **3D** : `geometry.ts` mesh paramétrique + mêmes 2 drags (reprend le feel `zdrag3`) + rendu `render3D`.
6. **Rapport** : section ventilation (modèle, NFA/unité, NFA total, aire, soffite, statut, emplacements, confirmations requises) — même géométrie reportable que 2D/3D.
7. *(plus tard)* upgrade visuel GLB/Three.js si besoin photoréaliste.

**Objectif tenu** : placer un Maximum en **2 clics**, le déplacer **uniquement** parallèle-faîtière + amont/aval, et **valider** la ventilation — le tout sur `accessories[]` séparé, persistant, reportable.

---

### Ce dont j'ai besoin de toi pour passer au code (étape 1)
- Les **specs réelles** par modèle (col, déflecteur, hauteur, solin, **NFA**) + le **facteur px↔mm/pouce** de ton échelle d'image.
- Les **paramètres de validation** (règle 1/300 vs 1/150, split intake/exhaust, marges).
- Confirmer le choix « **ancre faîtière + offset pan** » (point 3 / clarification produit).
