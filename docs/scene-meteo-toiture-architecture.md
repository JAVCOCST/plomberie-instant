# Scène Météo Toiture — Architecture **v2** (plateforme any-roof, cible : portail web)

> **Reframing produit (v2) :** on ne construit pas une *démo* (14 calques figés autour d'un
> toit). On construit une **plateforme** : un moteur générique piloté par `scene.json`, où la
> **toiture est de la donnée, pas du code**. Aujourd'hui un toit démo ; demain une photo/drone/
> satellite client génère automatiquement la scène.
>
> **Cible retenue : onglet « Scène » du portail web Toitures VB.** Stack web (voir §0). L'UI VB
> (logo, onglets Radar/Scène, ville, température) est conservée.

Cette v2 **remplace** la v1. Différences majeures : (1) ombres+reflets fusionnés en **Lighting
Engine** ; (2) scène **data-driven** (`scene.json`) au lieu de calques codés en dur ; (3)
pipeline **Weather → Lighting → Atmosphere → RenderFrame** au lieu d'un blob `SceneState` ;
(4) **pipeline de génération** conçu dès maintenant ; (5) **abstraction matériau** baked|pbr.

---

## 0. Stack (cible web)

| Usage | Techno | Pourquoi |
|---|---|---|
| **Prototype P1** | React + **Canvas 2D / CSS layers** | Voir le rendu + slider vite, zéro dépendance lourde |
| **Production** | React + **PixiJS (WebGL)** | Scène 2D en calques + **filtres GPU** (grading lumière, mouillé, god-rays) + **ParticleContainer** (pluie/neige). Léger vs CanvasKit/WASM |
| (Alternative) | @shopify/react-native-skia **build web** | Si on veut partager le code avec une future app RN |

Le slider n'a pas de « thread UI » sur web → on anime `tHour` avec un **lerp** (cible ↔ courant)
dans le ticker `requestAnimationFrame` : drag fluide, relâchement qui se stabilise.

---

## A. Critique de la v1 (ce qui était faux)

1. **Erreurs de conception**
   - Ombres (L05) & reflets (L06) traités comme **calques z-ordonnés** → ce sont des **sorties
     d'éclairage** appliquées au matériau, pas des plans. → **Lighting Engine**.
   - HUD (L13) & Slider (L14) numérotés comme « calques de scène » → **erreur de catégorie**
     (UI ≠ scene-graph).
   - **Couplage à un toit unique** (`RoofLayer` = LE png). Ne tient pas au 2ᵉ toit. → renderer
     **agnostique** piloté par `scene.json`.
   - **`SceneState` en bloc** mélange physique météo / optique / uniforms. → **pipeline**.
   - **Génération auto reléguée en P4** alors que c'est la *raison d'être* → conçue maintenant.
2. **Inutile/prématuré** : fog & god-rays en calques de 1ʳᵉ classe ; `roof_shadow.png` comme
   *calque* (c'est un **input matériau** AO) ; baked **et** grading runtime décrits sans trancher.
3. **Simplifications** : 14 calques → **scene-graph générique** + **3 moteurs** ; **un seul bloc
   d'uniforms** lu par chaque shader.
4. **Risques** : **🔴 re-éclairer une photo déjà éclairée** (double lumière → faux ; il faut
   **delighting → albédo**) ; **🔴 satellite top-down ≠ vue oblique** d'un toit ; normalisation
   expo/WB des photos clients ; perf scène shader-driven sur web.
5. **Perf** : cross-fade de variantes cuites > relighting cher ; uniform block unique ;
   particules bornées+instanciées ; atlas nuages ; ne recalculer que les uniforms dynamiques.
6. **Fusionner** : shadows+reflets+grading → **Lighting** ; cloudsFar+cloudsNear →
   **CloudField(depth)** ; pluie+neige+givre → **ParticleSystem(preset)** ; fog+rays →
   **Atmosphere**.
7. **Séparer** : Renderer ↔ HUD ; **Weather Engine ↔ Lighting Engine** ; **scene.json ↔
   runtime** ; **pipeline (offline) ↔ runtime (realtime)**.

---

## B. Architecture finale

### Pipeline : `t` → 3 moteurs → `RenderFrame` → renderer générique

```
Forecast + DayContext + tHour
        │
  WeatherEngine ──► WeatherState   (cloud, precip{type,angle,intensité}, neige cumulée*,
        │                           wetness avec décroissance*, vent, gel, canicule, orage)
  LightingEngine ─► LightingState  (sunDir az/alt, moonDir, colorTemp K, intensité, ambient,
        │                           skyGradient, shadow{dir,len,soft}, goldenHour, specWetBoost)
  AtmosphereEngine ► AtmoState     (fog, haze, rays(origin=sunDir), particlePreset)
        │
   Compositor ─────► RenderFrame (uniforms)  ──►  PixiRenderer(scene.json) → calques z-ordonnés
```
*États **persistants** : la neige s'**accumule**, le toit reste **mouillé** après la pluie
(décroissance). Pas seulement instantané (manque clé de la v1).*

### Décision CENTRALE — matériau : `baked` vs `pbr`
Abstraire le **matériau** d'un calque pour supporter les deux :
- **Strategy A — baked (V1-V2, recommandée)** : le pipeline cuit quelques looks (day/dusk/
  night/wet/snow) ; le runtime **cross-fade** selon `t`+météo. Pas cher, robuste, photoréaliste,
  **dé-risque le delighting**.
- **Strategy B — PBR runtime (V3+)** : albédo + normal + roughness re-éclairés en direct.
  Infiniment dynamique mais exige delighting + géométrie propres (durs).
→ Le renderer gère `material: BakedSet | PbrSet`. **On livre A, on migre les points chauds vers
B** sans réécrire.

### Modèle de données
```ts
type SourceKind = 'demo' | 'photo' | 'drone' | 'satellite';

interface SceneDefinition {            // scene.json — le contrat any-roof
  id: string;
  source: { kind: SourceKind; capturedAt?: string };
  camera: { projection: 'oblique' | 'eye'; horizonY: number };       // horizon normalisé 0..1
  lighting: { lat: number; lng: number; baselineSunAzimuth: number }; // course solaire
  layers: LayerDef[];                  // ordre = z
  defaults: { tHour: number };
}
interface LayerDef {
  id: string;
  kind: 'sky'|'celestial'|'cloudfield'|'roof'|'foreground'|'particles'|'atmosphere';
  z: number; parallax: number; anchor?: Rect;
  material?: { baked?: Record<string,string>;                         // { day, dusk, night, wet }
               pbr?: { albedo:string; normal:string; rough:string; ao:string } };
}

interface ForecastHour { hour:number; tempC:number; cloudPct:number; precipMmH:number;
  precipProb:number; snowCm:number; windKmh:number; windDir:number; code:number; }
interface DayContext { lat:number; lng:number; sunriseH:number; sunsetH:number; moonPhase:number; }

interface WeatherState { cloud:number; precip:{type:'none'|'rain'|'snow'; intensity:number; angleDeg:number};
  snowAccum:number; wetness:number; wind:{kmh:number;dir:number}; frost:number; heat:number; storm:number; }
interface LightingState { sun:{az:number;alt:number;opacity:number}; moon:{az:number;alt:number;opacity:number};
  colorTempK:number; intensity:number; ambient:string; sky:{top:string;mid:string;bottom:string};
  shadow:{dir:number;len:number;soft:number}; goldenHour:number; specWetBoost:number; }
interface RenderFrame { weather:WeatherState; lighting:LightingState; atmo:any; tHour:number; }
```

### Structure des dossiers (web, dans le portail)
```
src/scene-engine/
  core/        types.ts · time.ts · interp.ts (lerp/easing)
  weather/     weatherEngine.ts   (états persistants : neige cumulée, wetness)
  lighting/    lightingEngine.ts  (astro soleil/lune, colorTemp, ombres)  ← remplace L05+L06
  atmosphere/  atmosphere.ts      (fog, rays, presets particules)
  render/      PixiRenderer.tsx · layers/ · materials/ (baked|pbr) · shaders/*.frag
  scene/       sceneLoader.ts · schema.ts (validation scene.json)
  hud/         SceneHUD.tsx       (réutilise l'UI VB : ville, temp, onglets)
  hooks/       useScene.ts · useTimeline.ts
src/scenes/    granby_demo/{ roof.png, roof_mask.png, roof_wet.png, trees_fg.png, scene.json }
pipeline/      (offline, HORS bundle) ingest · segment · matte · delight · geometry · export
```
Le renderer s'insère dans l'onglet **Scène** existant (remplace le `WeatherScene` actuel).

### Weather Engine (la météo pilote le toit)
| Condition | Effet (via WeatherState → matériau/particules) |
|---|---|
| Pluie | `wetness↑` → roof **plus foncé** + **spéculaire↑** (cross-fade `roof_wet`) ; particules pluie (angle = vent) |
| Neige | **accumulation progressive** (mask additif sur faces vers le haut via normal/AO) |
| Gel | givre (overlay) ; spéculaire dur |
| Vent | vitesse nuages + angle pluie |
| Canicule | shimmer atmosphérique (filtre subtil) |
| Orage | ciel dramatique (LightingState.sky) + flashs d'éclairs |

### Lighting Engine (un seul système — remplace ombres+reflets)
Entrées : `lat/lng, date, tHour, cloud`. Sorties : `sun/moon (az,alt,opacity)`, `colorTempK`
(golden hour chaud, midi neutre, nuit froid bleuté), `intensity` (atténuée par `cloud`),
`ambient`, `sky{top,mid,bottom}`, `shadow{dir,len,soft}` (dérivés de `sunDir`), `goldenHour`,
`specWetBoost`. Pure fonction → testable.

### Renderer (PixiJS)
`(RenderFrame, SceneDefinition) → frame`. Un `Container` par calque (z), `Sprite` (roof, clouds,
sun, trees), **filtres GPU** : grading (Lighting), wetness, rain/rays. `ParticleContainer` pour
pluie/neige. Aucun nom de toit en dur. **HUD/slider par-dessus, découplés.**

### Pipeline futur de génération auto (P4 — conçu maintenant)
```
photo / drone / satellite
 → ingest      (normalise expo/WB ; redresse vers la caméra canonique)
 → segment     (mask toit · mask arbres/avant-plan · retrait ciel)
 → matte       (alpha propre)
 → DELIGHT     → albédo (retire soleil/ombres cuits — prérequis pour re-éclairer)   ← clé
 → geometry    (normal/height → ombres + spéculaire + accumulation neige)
 → export      roof.png(albédo) · roof_mask.png · roof_normal.png · trees_fg.png
 → scene.json  (horizon, base course solaire, z-order, bounds)  +  bakes (day/dusk/night/wet)
```
Le runtime ne connaît que `scene.json` + textures → **aucun composant critique ne dépend d'un
toit spécifique.**

---

## C. Roadmap (web)

- **P1** : `sceneLoader` + **PixiRenderer** (baked roof day/dusk/night cross-fade) + ciel
  (Lighting) + **soleil/lune** sur arc + **slider 24h** (lerp fluide). Toit démo détouré.
- **P2** : **Weather Engine** wetness + **pluie** (ParticleContainer) + `roof_wet` cross-fade +
  **ombre directionnelle douce** (AO × sunDir).
- **P3** : **CloudField** (avant/arrière) + **fog** (filtre) + **neige accumulée**.
- **P4** : **pipeline de génération** (delighting + segmentation) → any-roof.

---

## D. Réalité des assets (important)

Les références fournies sont des **scènes complètes (ciel inclus)** — donc **pas utilisables
telles quelles** : pour que le ciel/soleil réagissent, il faut le **toit détouré** (`roof.png` +
`roof_mask.png`), séparé du ciel. Pour démarrer la **P1**, il faut **un** toit démo détouré
(retrait d'arrière-plan d'une référence) ; le pipeline (P4) automatisera ça ensuite.

---

## Décision n°1 à acter avant de coder
**`scene.json`-driven + matériau `baked` (Strategy A) pour la V1.** Débloque le photoréalisme
tout de suite, dé-risque le delighting, garde la porte ouverte au PBR/any-roof sans réécriture.
