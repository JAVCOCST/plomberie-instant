# Architecture — « Ajouter Maximum 301 » (traceur toiture 2D/3D)

> Document de conception. **Aucun modèle 3D généré ici.** Les cotes réelles et
> distances réglementaires sont marquées `TODO_GUIDE` : à remplir depuis le
> guide d'installation officiel du Maximum 301 (je n'invente aucune valeur).

## Réalité technique de ton code (cadre la solution)

Ton moteur 3D n'est **pas** Three.js — c'est un **rasteriseur logiciel maison** :
`render3D()` → `proj3()` (projection perspective), z-buffer logiciel
(`zbufferFaces`), dessin sur un `<canvas>` 2D. Acquis réutilisables :

- Faces : `collectFaces(secs)` → `{ si, f, fpts, pl:{a,b,c}, grad, pignon, pitch }`
- Équation de plan d'une face : `z = a·x + b·y + c` (`facePlaneFromFace`)
- Picking face sous curseur : `hitFaceDetailed(x,y,...)`
- Faîtière : arêtes squelette `isRidge` ; noues : `computeValleys(secs)` ;
  arêtiers : arêtes hip ; pignon : `face.pignon === true`
- Coordonnées 2D = **pixels-image** (footprint) ; 3D = `sceneScale` + `proj3`
- Pattern d'interaction live déjà en place : `cbM/cbU`, `getXY`, refs (`guideR`,
  `zdrag3`), `setTick` → redraw. **On réutilise ce pipeline, pas un nouveau.**

---

## A) Architecture optimale

Trois couches strictement séparées.

**1. Catalogue (spec statique, partagée)** — une `RoofAccessorySpec` par type.
Jamais dupliquée par instance.
```
DEVICE_CATALOG["maximum_301"] = { dimensions, footprintTemplate, rules, mesh }
```

**2. Placement confirmé (donnée persistée)** — un `RoofAccessory` léger dans
`roofModel.accessories[]`, qui **référence** la spec + l'ancrage géométrique
(`planeId`/`sectionId`) + la pose. **Indépendant** des `sections`.

**3. État transitoire (jamais persisté)** — `draftR = useRef()` portant la pose
live + le résultat de validation pendant le déplacement (même pattern que
`guideR`/`zdrag3`).

**Séparation empreinte 2D ↔ visuel 3D (clé) :**
- **Empreinte technique 2D** = polygone en pixels-image → sert **uniquement** à
  la validation et au dessin 2D. C'est la *vérité métier*.
- **Visuel 3D** = **dérivé à la volée** du plan `(a,b,c)` + normale + pente.
  On ne stocke **pas** de géométrie 3D comme vérité : on stocke la **pose**
  (ancre + rotation) et on régénère le mesh au rendu → zéro désynchro si le toit
  est réédité.

**Machine à états** (un seul `accMode`) :
```
idle → placing(draft, type) → [vert + clic] → confirmed → idle
                             ↑ Échap / clic invalide = annule / reste en placing
```

**Où vit le code** (respecte « engine = géométrie, composant = UI ») :
- `src/lib/roof-core/accessories.ts` → **pur, testable, sans DOM** : catalogue,
  validation, projection 2D→3D, sérialisation (comme `annotation.ts`).
- `AdminRoofStudio.tsx` → état UI, preview, clic, dessin (2D dans l'effet draw,
  3D dans `render3D`).

---

## B) Format JSON

Deux objets distincts : **spec** (catalogue) et **instance** (placée).

```jsonc
// CATALOGUE — statique, 1 par type, hors RoofModel
{
  "modelType": "maximum_301",
  "label": "Maximum 301",
  "dimensions_in": { "w": 0, "d": 0, "h": 0 },          // TODO_GUIDE (pouces)
  "footprintTemplate": [[-1,-1],[1,-1],[1,1],[-1,1]],    // normalisé, *w/2,*d/2
  "rules": { /* section C */ },
  "mesh": { "kind": "parametric", "ref": "maximum_301_v1" }
}

// INSTANCE — persistée dans roofModel.accessories[]
{
  "id": "acc_8f3a",
  "type": "accessory",
  "modelType": "maximum_301",
  "specVersion": 1,                       // fige cotes+règles au placement
  "sectionId": 0,                         // index section (S1 = 0)
  "planeId": "P3",                        // = num de face (export `planes`)
  "position2D": { "x": 742.1, "y": 318.4 },              // ANCRE = centre, px-image
  "position3D": { "x": 742.1, "y": 318.4, "z": 196.3 },  // dérivé du plan
  "footprint2D": [[..],[..],[..],[..]],   // carré orienté, px-image
  "footprint3D": [[x,y,z], ...],          // posé sur le plan
  "dimensions": { "w": 0, "d": 0, "h": 0 },              // copie figée (TODO_GUIDE)
  "orientation": { "yawDeg": 12.0, "alignedTo": "ridge" },
  "planeNormal": [0.12, -0.31, 0.94],     // normale unitaire du plan
  "zOffset": 0.5,                         // anti z-fighting (px-image)
  "distanceRidge": 184.2,                 // px-image
  "validationStatus": "valid",            // valid | warn | invalid
  "validationErrors": [],                 // [{ rule, severity, value, limit }]
  "createdAt": "2026-..."
}
```

Décisions :
- **`position2D` = centre** (pas un coin) → rotation et collisions simples.
- On stocke `footprint2D` (take-off, export, collisions) **et** on fige la spec
  (`dimensions`, `specVersion`) pour la repro de la vérité human_corrected.
- `position3D`/`footprint3D`/`planeNormal` sont dérivables mais **figés à
  l'export** (comme tes `planes`) pour le consommateur aval.
- Ajouter `accessories?: RoofAccessory[]` au `RoofModel` + `Annotation`, et au
  round-trip `buildAnnotation`/`parseAnnotation`.

---

## C) Règles de validation (params `TODO_GUIDE`)

Chaque règle → une primitive **déjà dans le moteur**.

| Règle | Calcul | Paramètre |
|---|---|---|
| Distance faîtière min/max | arête `isRidge` → `distPtSeg(centre, ridgeA, ridgeB)` | `ridgeMin`, `ridgeMax` |
| Marge bordure (égout/débord) | `segDist`/`boundaryDist` footprint→arêtes d'égout | `edgeMargin` |
| Distance noue min | `computeValleys(secs)` → `distPtSeg` par noue | `valleyMin` |
| Distance arêtier min | arêtes hip squelette (`!isRidge`, `t>0`) | `hipMin` |
| Distance autre Maximum | gap min entre `footprint2D` (overlap + dist) | `accMin` |
| Interdit pignon / vertical | `face.pignon === true` → invalide | — |
| Interdit à cheval sur 2 plans | les **4 coins** doivent renvoyer la **même** face (`si`+`f`) | — |
| Hors toiture | un coin sans face dessous → invalide | — |

Sévérité :
- `invalid` (rouge) : une règle dure échoue.
- `warn` (jaune) : dans une bande tampon (ex. `ridgeMin ≤ d < ridgeMin + buffer`).
- `valid` (vert) : sinon.

```ts
type RuleResult = { rule: string; severity: "invalid" | "warn"; value: number; limit: number };
```

---

## D) Algorithme complet

```
1. Clic "Ajouter Maximum 301"
   accMode = "placing"; draft = { type:"maximum_301", center:null, yaw:auto }

2. onMouseMove (réutilise cbM) si accMode === "placing":
   a. centre = curseur px-image (getXY → wx,wy)
   b. face = hitFace2D(wx, wy)            // point-in-footprint sur secs (ou hitFaceDetailed en 3D)
   c. pas de face → invalid
   d. yaw auto = parallèle à la faîtière de la face (ridgeDir) ou à l'égout
      footprint2D = template * (w/2,d/2), tourné de yaw, centré sur le curseur
   e. validation = validate(draft, secs, valleys, accessories, spec.rules)
   f. draftR.current = { center, footprint2D, face, validation }
   g. setTick → redraw

3. Dessin 2D (effet draw, après les guides):
   couleur = invalid→#ff4444 / warn→#ffcc44 / valid→#44ff88
   trace footprint2D + remplissage translucide + (option) distance faîtière

4. Clic (cbU) si accMode === "placing":
   si validation.status === "valid" (ou "warn" confirmé):
     z      = pl.a*cx + pl.b*cy + pl.c          // équation du plan
     normal = normalize([-pl.a, -pl.b, 1])      // depuis a,b,c
     footprint3D = footprint2D.map(p => [p.x, p.y, pl.a*p.x+pl.b*p.y+pl.c]) + normal*zOffset
     acc = buildAccessory(draft, face, pl, normal)
     setAccessories(a => a.concat(acc)); accMode = "idle"
   sinon: feedback rouge, reste en placing

5. Rendu 3D (render3D, après les faces, avant les labels):
   pour chaque acc (section visible):
     mesh = genParametricMesh(spec)               // sommets locaux
     basis = repère(normal, yaw)                  // X=yaw projeté, Z=normal
     world = mesh.map(v => ancre + basis·v + normal*zOffset)
     proj3(world) + z-buffer (MÊME caméra que le toit) → occlusion cohérente
```

Le placement **réutilise** ton pipeline d'event existant (cbM/cbU, getXY,
setTick, overlay) — aucun nouveau système d'entrée.

---

## E) Recommandation technique (format du modèle)

**Décision : Option 4 = empreinte technique (donnée) + mesh PARAMÉTRIQUE rendu
par ton painter actuel.** Pour le v1, c'est la bonne.

- **Option 3 (paramétrique) pour le visuel** : un petit jeu de polygones plats
  (embase + capot + chapeau) généré par code, passé dans `proj3` + z-buffer.
  → ombrage et occlusion **cohérents avec le toit gratuitement**, aucune
  dépendance, suit la pente/normale nativement.
- **Pourquoi PAS GLB/GLTF (option 2) maintenant** : ça impose d'ajouter
  **Three.js** + un canvas overlay synchronisé sur ta caméra (`phi/theta/r`),
  soit **deux moteurs** à garder en phase (caméra, z-fighting inter-passes,
  resize). Lourd pour un gain surtout esthétique.
- **Option 1 (Three.js par code)** : même problème — pas de Three dans le repo.

**Chemin d'évolution** : si plus tard tu veux du photoréaliste, ajoute une
couche Three.js **en overlay** qui *miroite* `orb` (phi/theta/r) et rend un GLB,
en gardant **intacts** l'empreinte technique + la validation (qui restent la
vérité). La séparation données/visuel de la section A rend ça non-destructif.

> Résumé : **données = empreinte 2D + pose** (vérité, stable) ; **visuel =
> paramétrique maintenant, GLB/Three plus tard si besoin** (interchangeable).

---

## F) Livrables

### F.1 — Exemple JSON complet

```json
{
  "catalog": {
    "modelType": "maximum_301",
    "label": "Maximum 301",
    "dimensions_in": { "w": 0, "d": 0, "h": 0 },
    "footprintTemplate": [[-1,-1],[1,-1],[1,1],[-1,1]],
    "rules": {
      "ridgeMin": 0, "ridgeMax": 0, "ridgeBuffer": 0,
      "edgeMargin": 0, "valleyMin": 0, "hipMin": 0, "accMin": 0,
      "forbidPignon": true, "forbidMultiPlane": true
    },
    "mesh": { "kind": "parametric", "ref": "maximum_301_v1" }
  },
  "instance": {
    "id": "acc_8f3a2c",
    "type": "accessory",
    "modelType": "maximum_301",
    "specVersion": 1,
    "sectionId": 0,
    "planeId": "P3",
    "position2D": { "x": 742.1, "y": 318.4 },
    "position3D": { "x": 742.1, "y": 318.4, "z": 196.3 },
    "footprint2D": [[710,300],[774,306],[768,352],[704,346]],
    "footprint3D": [[710,300,188],[774,306,196],[768,352,201],[704,346,193]],
    "dimensions": { "w": 0, "d": 0, "h": 0 },
    "orientation": { "yawDeg": 12.0, "alignedTo": "ridge" },
    "planeNormal": [0.12, -0.31, 0.94],
    "zOffset": 0.5,
    "distanceRidge": 184.2,
    "validationStatus": "valid",
    "validationErrors": [],
    "createdAt": "2026-05-26T00:00:00.000Z"
  }
}
```

### F.2 — Pseudo-code TypeScript (`roof-core/accessories.ts`)

```ts
export interface RoofAccessorySpec {
  modelType: string; label: string;
  dimensions: { w: number; d: number; h: number };   // px-image (depuis cotes réelles + échelle)
  footprintTemplate: [number, number][];              // unités normalisées
  rules: AccessoryRules;
  mesh: { kind: "parametric"; ref: string };
}
export interface AccessoryRules {
  ridgeMin: number; ridgeMax: number; ridgeBuffer: number;
  edgeMargin: number; valleyMin: number; hipMin: number; accMin: number;
  forbidPignon: boolean; forbidMultiPlane: boolean;
}
export interface RoofAccessory {
  id: string; type: "accessory"; modelType: string; specVersion: number;
  sectionId: number; planeId: string;
  position2D: { x: number; y: number };
  position3D: { x: number; y: number; z: number };
  footprint2D: [number, number][]; footprint3D: [number, number, number][];
  dimensions: { w: number; d: number; h: number };
  orientation: { yawDeg: number; alignedTo: string };
  planeNormal: [number, number, number];
  zOffset: number; distanceRidge: number;
  validationStatus: "valid" | "warn" | "invalid";
  validationErrors: RuleResult[]; createdAt: string;
}
export interface RuleResult { rule: string; severity: "invalid" | "warn"; value: number; limit: number }

// Carré orienté autour d'un centre.
export function footprintAt(spec: RoofAccessorySpec, cx: number, cy: number, yaw: number): [number, number][] {
  const c = Math.cos(yaw), s = Math.sin(yaw), hw = spec.dimensions.w / 2, hd = spec.dimensions.d / 2;
  return spec.footprintTemplate.map(([ux, uy]) => {
    const x = ux * hw, y = uy * hd;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}

// Validation pure (toutes les primitives viennent de engine.ts).
export function validate(input: {
  center: { x: number; y: number }; footprint: [number, number][];
  face: any; secs: any; valleys: any; others: RoofAccessory[]; rules: AccessoryRules;
}): { status: "valid" | "warn" | "invalid"; errors: RuleResult[] } {
  const errs: RuleResult[] = [];
  if (!input.face) errs.push({ rule: "offRoof", severity: "invalid", value: 0, limit: 0 });
  if (input.face?.pignon && input.rules.forbidPignon)
    errs.push({ rule: "pignon", severity: "invalid", value: 0, limit: 0 });
  // 4 coins sur la même face ?
  if (input.rules.forbidMultiPlane && !sameFaceForAllCorners(input.footprint, input.secs))
    errs.push({ rule: "multiPlane", severity: "invalid", value: 0, limit: 0 });
  // distance faîtière
  const dR = distToRidge(input.center, input.face);
  if (dR < input.rules.ridgeMin) errs.push({ rule: "ridgeMin", severity: "invalid", value: dR, limit: input.rules.ridgeMin });
  else if (dR < input.rules.ridgeMin + input.rules.ridgeBuffer) errs.push({ rule: "ridgeMin", severity: "warn", value: dR, limit: input.rules.ridgeMin });
  if (input.rules.ridgeMax && dR > input.rules.ridgeMax) errs.push({ rule: "ridgeMax", severity: "invalid", value: dR, limit: input.rules.ridgeMax });
  // bordures, noues, arêtiers, autres Maximum → même schéma (distPtSeg / segDist / overlap)
  // ...
  const status = errs.some(e => e.severity === "invalid") ? "invalid"
    : errs.some(e => e.severity === "warn") ? "warn" : "valid";
  return { status, errors: errs };
}

// Pose 3D depuis l'équation du plan de la face.
export function poseOnPlane(footprint2D: [number, number][], pl: { a: number; b: number; c: number }, zOffset: number) {
  const n = unit([-pl.a, -pl.b, 1]);
  const fp3 = footprint2D.map(([x, y]) => add([x, y, pl.a * x + pl.b * y + pl.c], scale(n, zOffset)));
  return { normal: n, footprint3D: fp3 };
}

export function buildAccessory(draft: any, face: any, pl: any, spec: RoofAccessorySpec): RoofAccessory { /* assemble l'objet B */ }
```

### F.3 — Structure de fichiers recommandée

```
src/lib/roof-core/
  accessories.ts            # spec, catalogue, validate(), poseOnPlane(), build (PUR, testé)
  accessories.test.ts       # tests headless (validation + round-trip)
  catalog/
    maximum-301.ts          # la RoofAccessorySpec (cotes TODO_GUIDE)
  meshes/
    maximum-301.mesh.ts      # mesh paramétrique (sommets/faces locaux) — généré PLUS TARD
src/pages/
  AdminRoofStudio.tsx       # bouton, accMode, preview 2D, clic, rendu 3D (branche render3D)
```
+ étendre `annotation.ts` (`accessories` dans Annotation + round-trip) et
`engine.ts` (`render3D` dessine les accessoires).

### F.4 — Le prompt idéal à m'envoyer ensuite (pour le modèle 3D)

> « Génère le **mesh paramétrique** du Maximum 301 pour `meshes/maximum-301.mesh.ts`,
> compatible avec mon rasteriseur maison (`proj3` + z-buffer, faces plates).
> Contraintes :
> - Sortie : `{ verts: [x,y,z][], faces: { idx:number[], color:string }[] }` en
>   **unités locales** (origine = centre de l'embase, +Z = haut, +X = yaw).
> - Cotes réelles (je te les donne, en pouces, + facteur px/pouce) :
>   embase L×l×h = …, capot = …, chapeau = …, Ø col = ….
> - Style "ultra propre" mais **low-poly** (≤ ~200 faces) pour rester fluide dans
>   le painter logiciel ; pas de GLB, pas de Three.js.
> - Couleurs par groupe (embase, capot, ventilation).
> - Donne aussi la fonction `placeMesh(acc, mesh)` qui transforme les verts
>   locaux → monde via { ancre `position3D`, normale `planeNormal`, `yawDeg`,
>   `zOffset` } et retourne les verts monde prêts pour `proj3`.
> - Ajoute 2-3 tests headless (compte de sommets, AABB, watertight optionnel). »

Quand tu m'enverras ça (avec les cotes réelles + le facteur d'échelle px/pouce),
je générerai le mesh + le câblage `render3D`. **Pas avant.**

---

### Prochaine étape suggérée

1. Tu me donnes les **valeurs `TODO_GUIDE`** (cotes Maximum 301 + distances du
   guide + facteur px↔pouce de ton échelle d'image).
2. Je code `accessories.ts` + le bouton + la preview 2D + la validation (testée).
3. On valide le placement 2D (rouge/jaune/vert) avant de toucher au 3D.
4. Tu m'envoies le prompt F.4 → je génère le mesh + rendu 3D.
