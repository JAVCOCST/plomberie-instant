# Spec de livraison des assets — Scène météo toiture (moteur dynamique)

But : le moteur **compose et anime** la scène en direct (ciel, soleil/lune, nuages, brouillard,
pluie/neige bougent intelligemment), pendant que **toit + Roger + arbres** restent la scène fixe.
Pour ça, les calques doivent arriver **séparés** (jamais fusionnés) et **calés au pixel**.

---

## 0. Règles globales
- **Canvas : 1320 × 2868** (portrait, ton standard). **Tous** les fichiers à cette taille sauf les
  petits sprites (soleil/lune/nuages) — voir plus bas.
- **Format : WebP, qualité 88–92.** `RGBA` (transparence) **partout** SAUF les ciels = `RGB` opaque.
- Alpha propre, pas de damier baked, light-wrap OK. Ne jamais changer la géométrie du toit ni la
  silhouette des arbres/Roger entre variantes.
- **Regrouper par CALQUE** (dossiers ci-dessous), **pas par scène** : un même `ROOF_NIGHT` sert à
  TOUTES les scènes de nuit. Grouper par scène dupliquerait le toit 18×. (Si tu groupes quand même
  par scène, garde les calques séparés, je dédupliquerai.)

---

## 1. Deux familles de calques

### A) Calques FIXES — pleine toile 1320×2868, sujet déjà placé
Je les empile à 100 % sans aucun calcul → le layout est garanti par l'art.
Le sujet est à sa position finale, **transparent partout ailleurs**.

| Dossier | Fichiers | Notes de calage |
|---|---|---|
| `roof/` | `ROOF_DAY` `ROOF_GOLDEN` `ROOF_NIGHT` `ROOF_WET` | **Les 4 = même toit au pixel près**, seul l'éclairage change (sinon ça « saute » au cross-fade). |
| `roger/` | `ROGER_DAY` `ROGER_RAIN` `ROGER_RAIN_HEAVY` `ROGER_SNOW` `ROGER_NIGHT` `ROGER_HOT` | **Mêmes pieds / même échelle** pour toutes les poses. Debout sur la pente. |
| `trees/` | `TREES` (gauche+droite placés) — ou `TREE_LEFT` + `TREE_RIGHT` | Pleine toile, enracinés en bas, écartés sur les bords. |

### B) Calques DYNAMIQUES — le moteur les bouge (ne bake AUCUN mouvement)
| Dossier | Fichiers | Forme attendue |
|---|---|---|
| `sky/` | `SKY_DAY` `SKY_GOLDEN` `SKY_SUNSET` `SKY_NIGHT` `SKY_OVERCAST` `SKY_STORM` `SKY_FOG` | **Pleine toile 1320×2868, RGB opaque, plein cadre.** Horizon à la **même hauteur** sur tous. |
| `sun/` | `SUN_DAY` `SUN_GOLDEN` `SUN_STORM` | **Petit sprite transparent centré, halo/bloom inclus** (~500–700 px). Je le déplace sur un arc. |
| `moon/` | `MOON_FULL` `MOON_HALF` | Idem, disque + halo, centré. |
| `clouds/` | `CLOUD_01`…`CLOUD_06`, `CLOUD_STORM_01`,`CLOUD_STORM_02` | **Sprites séparés transparents**, tailles variées (~800–1500 px). Je les fais dériver en profondeur. |
| `fog/` | `FOG_LIGHT` `FOG_DENSE` | Voile large transparent, **raccordable gauche↔droite** (tileable horizontalement) pour la dérive. |
| `precip/` | `RAIN_LIGHT` `RAIN_HEAVY` `SNOW_LIGHT` `SNOW_HEAVY` `SHOOTING_STARS` | Texture transparente **raccordable haut↔bas (seamless vertical)** → je la fais défiler en boucle. |

---

## 2. Calage / registration (le plus important)
1. `sky` / `roof` / `roger` / `trees` : **exactement 1320×2868**, sujet à sa position finale.
2. `roof_*` : 4 variantes **superposables au pixel** (seule la lumière change).
3. `roger_*` : **même point de pieds** et même échelle sur les 6.
4. `sky_*` : **ligne d'horizon identique** sur les 7.
5. `precip_*` : couture **haut↔bas invisible** (boucle verticale). `fog_*` : couture gauche↔droite.
6. `sun`/`moon` : sujet **centré** dans le sprite, halo symétrique.

---

## 3. Ce que le MOTEUR fait (donc à NE PAS baker)
- Cross-fade du ciel selon **heure × condition** (Open-Meteo).
- **Soleil/lune sur un arc** du lever au coucher (golden bas, midi haut, lune la nuit).
- **Nuages** : dérive horizontale multi-profondeur, densité selon `cloud_cover %`.
- **Brouillard** : dérive + opacité selon la condition.
- **Pluie/neige** : défilement vertical, densité selon l'intensité ; **étoiles filantes** la nuit claire.
- Toit/Roger : cross-fade entre variantes selon moment/météo ; Roger **bob idle** ; arbres **sway** au vent.
- **Grade golden** près du lever/coucher.

L'UI (timeline en bas, bandeau de dates type YoWindow, icône de doigt, sens du scrub) = **code**,
aucun asset requis de ta part.

---

## 4. Arborescence finale du zip
```
weather-vb/
  sky/    SKY_DAY SKY_GOLDEN SKY_SUNSET SKY_NIGHT SKY_OVERCAST SKY_STORM SKY_FOG          (.webp RGB 1320×2868)
  roof/   ROOF_DAY ROOF_GOLDEN ROOF_NIGHT ROOF_WET                                         (.webp RGBA 1320×2868)
  roger/  ROGER_DAY ROGER_RAIN ROGER_RAIN_HEAVY ROGER_SNOW ROGER_NIGHT ROGER_HOT          (.webp RGBA 1320×2868)
  trees/  TREES   (ou TREE_LEFT + TREE_RIGHT)                                              (.webp RGBA 1320×2868)
  sun/    SUN_DAY SUN_GOLDEN SUN_STORM                                                     (.webp RGBA sprite)
  moon/   MOON_FULL MOON_HALF                                                              (.webp RGBA sprite)
  clouds/ CLOUD_01..06 CLOUD_STORM_01 CLOUD_STORM_02                                       (.webp RGBA sprite)
  fog/    FOG_LIGHT FOG_DENSE                                                              (.webp RGBA tileable-H)
  precip/ RAIN_LIGHT RAIN_HEAVY SNOW_LIGHT SNOW_HEAVY SHOOTING_STARS                       (.webp RGBA tileable-V)
```

> Résumé : **FIXE = pleine toile déjà placée** (toit/Roger/arbres) ; **DYNAMIQUE = éléments séparés**
> (ciel/soleil/lune/nuages/brouillard/précip). Calé au pixel, jamais fusionné. Je m'occupe de tout
> le mouvement et de l'UI.
