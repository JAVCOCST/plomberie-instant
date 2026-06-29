# Audit RoofPolygonAIInline & MapToolbox — Mobile UX / Perf

> Audit **read-only** des deux composants carte externes non couverts par les
> passes précédentes (`mobile-ux-responsive-audit.md`, `mobile-toolbar-touch-pass.md`,
> qui visaient `AdminQuoteGenerator` / `TakeoffFullscreen` / `AdminRoofStudio`) :
> - `src/components/roofing/immersive/RoofPolygonAIInline.tsx`
> - `src/components/roofing/immersive/MapToolbox.tsx`
>
> Angle : **touch gestures, cycle de vie des listeners, perf (re-renders),
> z-index, cibles tactiles, perte d'état, compat autosave Vague A**. Aucune
> modification de code — ce document est le seul livrable.

> ⚠️ **Méthodo honnête** : pas d'appareil réel ni de navigateur piloté dans cet
> environnement. C'est une **revue de code statique**. Les fréquences de re-render
> sont **déduites du code** (un `setState` par `mousemove` ⇒ ~60/s à 60 fps), pas
> mesurées au profiler. Les ✅ « device » restent à confirmer sur Safari iOS /
> Chrome Android.

---

## 0. Contexte d'intégration (où vivent ces composants)

| Élément | Emplacement |
|---|---|
| `MapToolbox` monté | `AdminQuoteGenerator.tsx:5204` (section 3, **pas une modale** — panneau in-flow) |
| `RoofPolygonAIInline` monté | passé en `aiInlineContent` du `MapToolbox`, `AdminQuoteGenerator.tsx:5213-5246` |
| Condition de montage | `!measureMode && !manualMeasureMode && (mapToolboxControls || adjustControls)` — bascule `measureMode` ⇒ **démontage** |
| `getCaptureParams` | fourni par `BuildingReadOnlyMap` via `mapToolboxControls.getCaptureParams()` |
| `setOverlays` | écrit dans `aiOverlays` (state parent, `AdminQuoteGenerator.tsx:346`) |
| `onConfirmPolygon` | crée un `measureTool` + un `mapAnnotation`, `AdminQuoteGenerator.tsx:5217-5245` |
| Barre sticky mobile (AQG-001) | `position:fixed; bottom:0; zIndex:1000`, `AdminQuoteGenerator.tsx:7500-7502` |
| Panneau config flottant | `zIndex:9990`, `AdminQuoteGenerator.tsx:7039` |

> ℹ️ Le doc `admin-quote-mobile-ui-audit.md` cité en consigne n'existe pas dans le
> repo ; le format est aligné sur `mobile-ux-responsive-audit.md` /
> `mobile-toolbar-touch-pass.md`, et la barre « AQG-001 » est identifiée comme la
> **barre d'action sticky mobile** (`AdminQuoteGenerator.tsx:7500`).

> 🔴 **Constat structurant** : dans `RoofPolygonAIInline`, les **étapes 3
> (Détecter / SAM) et 4 (Créer outil)** sont **retirées du rendu**
> (`RoofPolygonAIInline.tsx:725`). `doDetect()` et `doConfirm()` sont définis mais
> **jamais appelés depuis l'UI**. Conséquence : aujourd'hui un utilisateur **ne
> peut pas confirmer** de polygone IA via ce composant, donc `onConfirmPolygon`
> (parent) **n'est jamais déclenché**. Les questions 6 & 7 (perte d'état au
> dessin, compat autosave) sont donc **latentes** : réelles dans le code, mais non
> déclenchables tant que les étapes 3/4 ne sont pas réactivées. Sévérités notées
> en conséquence.

---

## 1. Synthèse des bugs

| ID | Sévérité | Composant | Titre | Actif aujourd'hui ? |
|---|---|---|---|---|
| MTBX-001 | P2 | MapToolbox | Listeners `window` drag/resize non nettoyés au démontage | Oui |
| MTBX-002 | P2 | MapToolbox | `localStorage` écrit à **chaque frame** de drag/resize (~60/s) | Oui |
| MTBX-003 | P1 | MapToolbox | Toutes les cibles tactiles < 44 px sur mobile | Oui |
| MTBX-004 | P2 | MapToolbox | Drag/resize **souris uniquement** → inutilisables au tactile (mode flottant) | Oui |
| MTBX-005 | P2 | MapToolbox | Z-index flottant (100) sous la barre sticky (1000) ; docké masqué par la barre | Oui |
| RPAI-001 | P1 | RoofPolygonAIInline | Cibles tactiles < 44 px (boutons d'étape, Reset) | Oui |
| RPAI-002 | P2 | RoofPolygonAIInline | Pose de point en `onClick` souris, sans `touch-action` (délai 300 ms) | Oui |
| RPAI-003 | P2 | RoofPolygonAIInline | `setState` après démontage pendant Capture/Enhance (pas de garde) | Oui |
| RPAI-004 | P2 | RoofPolygonAIInline | État local (point, polygone) perdu au démontage de la modale/section | Oui |
| RPAI-005 | P3 | RoofPolygonAIInline | Chemin Détecter/Confirmer mort + pipeline masque bloquant (latent) | Non (UI désactivée) |
| RPAI-006 | P2 | RoofPolygonAIInline → autosave | Polygone confirmé **partiellement perdu** au reload (géométrie + overlays) | Latent (confirm désactivé) |

**Aucun P0 actif** (pas de data-loss ni de freeze déclenchable dans l'état courant
du code). Pas d'escalade. → **PR avec ce doc uniquement** (livrable demandé).

---

## 2. Détail des bugs

### MTBX-001 — Listeners `window` drag/resize non nettoyés au démontage
- **Sévérité** : P2 (fuite de listener + `setState` post-démontage)
- **Fichier** : `MapToolbox.tsx:108-150`
- **Repro** : passer le panneau en mode flottant, commencer à le déplacer (ou
  redimensionner), et pendant le drag déclencher un démontage (bascule
  `measureMode`/`manualMeasureMode`, ou navigation). `onMouseDown` a posé
  `window.addEventListener('mousemove'/'mouseup')` mais le retrait ne se fait que
  dans `onDragEnd`/`onResizeEnd`, qui n'est jamais atteint → les handlers restent
  liés à `window`, capturant un closure `setState` sur un composant démonté.
- **Cause** : aucun `useEffect(() => () => { … removeEventListener … }, [])` de
  nettoyage ; le retrait dépend uniquement du `mouseup`.
- **Correction recommandée** : `useEffect` de cleanup au démontage qui retire
  inconditionnellement `onDragMove/onDragEnd/onResizeMove/onResizeEnd` de
  `window` ; idéalement basculer drag/resize sur Pointer Events avec
  `setPointerCapture` (résout aussi MTBX-004).

### MTBX-002 — `localStorage` écrit à chaque frame pendant drag/resize
- **Sévérité** : P2 (perf / jank mobile)
- **Fichier** : `MapToolbox.tsx:104` (effet), alimenté par `:123` (drag) et `:144` (resize)
- **Repro** : déplacer ou redimensionner le panneau flottant. `onDragMove`/
  `onResizeMove` appellent `setState` à chaque `mousemove` (~60/s à 60 fps).
  L'effet `useEffect(… [state]) ⇒ saveState()` (`:104`) exécute un
  `JSON.stringify` + `localStorage.setItem` **synchrone à chaque rendu**, donc
  ~60 écritures disque/s pendant tout le geste.
- **Perf — réponse à la Q3** : c'est **la seule** boucle de re-render « par
  seconde » des deux composants. Estimation déduite du code : **~60 re-renders/s**
  pendant un drag/resize actif, chacun déclenchant une sérialisation +
  `localStorage`. `RoofPolygonAIInline`, lui, ne re-render que sur événements
  discrets (capture / enhance / clic), pas par frame — **aucune édition de
  polygone continue** n'a lieu dans ces deux composants (l'édition de sommets du
  bâtiment vit dans `BuildingReadOnlyMap`, hors périmètre).
- **Correction recommandée** : ne persister qu'à la fin du geste
  (`onDragEnd`/`onResizeEnd`) ou debouncer `saveState` (≥ 150 ms / `requestIdleCallback`).

### MTBX-003 — Cibles tactiles < 44 px (toute la boîte à outils)
- **Sévérité** : P1 (ergonomie mobile — confirmé par revue, à valider device)
- **Fichiers** :
  - `iconBtn` (collapse / dock, header) `:548-552` → padding 3 + icône 12 ≈ **18 px**
  - bouton « Déplacer » (navigate) `:207-225` → padding 3/6, police 9 ≈ **~20 px**
  - `zoomBtn` `:554-559` → padding `6px 0`, icône 14 ≈ **~26 px**
  - `padBtn` (nudge/rotate/zoom ajustement) `:561-565` → padding 6, icône 14 ≈ **~26 px**
  - `LayerRow`/`BasemapLayerRow` toggles `:497-519`, `:527-546` → padding `3px 0` ≈ **~18-20 px**
  - crayon « Éditer » `:508-519` → padding 3/5 ≈ **~20 px**
  - toggles/`Trash2` calques IA `:368-386` ≈ **~18 px**
  - poignée de resize `:463-474` → **14×14 px**
- **Repro** : ouvrir la boîte à outils sur mobile, tenter de toucher un toggle de
  couche / un bouton nudge au pouce. Aucune logique `touchUI` réactive (contrairement
  à `AdminRoofStudio`, cf. `mobile-toolbar-touch-pass.md`).
- **Correction recommandée** : flag `touchUI` (viewport < 768, listener `resize`)
  agrandissant les contrôles à `min-height/min-width 44-48 px` + espacement, sur
  le modèle déjà appliqué au studio. Ajouter `touch-action:manipulation`.

### MTBX-004 — Drag/resize souris uniquement (inutilisables au tactile)
- **Sévérité** : P2 (fonction flottante morte sur mobile)
- **Fichier** : `MapToolbox.tsx:108` (drag header), `:133` (resize), `:191` (header `onMouseDown`)
- **Repro** : sur mobile, détacher le panneau (Pin) puis essayer de le déplacer
  ou de le redimensionner au doigt → rien ne se passe (`onMouseDown` /
  `mousemove`/`mouseup` ne sont pas émis par le tactile). La poignée de resize est
  également inerte.
- **Conflit gestes — réponse à la Q1** : le header drag ne pose que
  `userSelect:'none'`, **pas** de `touch-action`. Comme le drag tactile n'est de
  toute façon pas câblé, un appui sur le header laisse le scroll/zoom natif
  s'exécuter (pas de blocage), donc **pas de conflit de geste actif** — mais la
  fonctionnalité de déplacement est simplement absente au tactile. (À l'inverse,
  le canvas carte sous-jacent a déjà son `touch-action:none`, hors périmètre.)
- **Correction recommandée** : Pointer Events (`onPointerDown` +
  `pointermove`/`pointerup` + `setPointerCapture`) pour drag et resize ;
  `touch-action:none` sur les **poignées uniquement**.

### MTBX-005 — Z-index flottant sous la barre sticky / docké masqué (Q4)
- **Sévérité** : P2
- **Fichier** : `MapToolbox.tsx:167` (`zIndex:100` flottant) vs
  `AdminQuoteGenerator.tsx:7502` (barre sticky `zIndex:1000`) et `:7039`
  (config flottante `zIndex:9990`).
- **Repro** :
  1. *Flottant* : détacher le panneau → il passe en `zIndex:100`, **sous** la barre
     d'action sticky mobile (1000) et sous le panneau de config (9990) ; s'il
     chevauche le bas de l'écran, sa partie basse (resize, contenu) est masquée.
  2. *Docké (défaut)* : le panneau est in-flow (`position:relative`, pas de
     z-index) ; la barre sticky `fixed; bottom:0` recouvre le **bas du contenu
     docké** — Reset, Journal et le pipeline `RoofPolygonAIInline` peuvent passer
     **derrière** la barre, sans padding bas pour la dégager.
- **Correction recommandée** : pour le mode flottant, relever le `zIndex` au-dessus
  de la chrome sticky (mais sous `.pac-container` = 100000) ; pour le mode docké,
  ajouter un espace bas (`padding-bottom` ≈ hauteur barre + `safe-area-inset-bottom`)
  quand `isMobile`.

### RPAI-001 — Cibles tactiles < 44 px
- **Sévérité** : P1
- **Fichier** : `RoofPolygonAIInline.tsx`
  - boutons d'étape (`Step`) `:793-809` → padding 5/10, police 10 ≈ **~24 px**
  - « Tout réinitialiser » `:729-738` → padding 4/8, police 10 ≈ **~22 px**
  - « Effacer » (journal) `:752-755` → police 9, sans padding ≈ minuscule
- **Repro** : toucher « Capturer » / « Améliorer » / « Réinitialiser » au pouce.
- **Correction recommandée** : `min-height 44 px` + `touch-action:manipulation`
  sur ces boutons en mode mobile.

### RPAI-002 — Pose de point en `onClick` souris, sans `touch-action`
- **Sévérité** : P2 (Q1)
- **Fichier** : `RoofPolygonAIInline.tsx:551` (`handleImageClick`, `React.MouseEvent`),
  rendu `:691-698` (`<img onClick>` + `cursor:'crosshair'`, aucun `touch-action`).
- **Repro** : sur iOS, taper l'aperçu capturé pour poser le point SAM → tap-delay
  ~300 ms possible et risque de double-tap-zoom ; `cursor:crosshair` est une
  affordance souris sans équivalent tactile.
- **Note** : impact pratique réduit tant que l'étape 3 (Détecter) est désactivée
  (le point posé ne sert plus à rien dans l'UI courante — cf. RPAI-005).
- **Correction recommandée** : `touch-action:manipulation` sur l'`<img>` ;
  envisager `onPointerDown` pour une pose immédiate.

### RPAI-003 — `setState` après démontage pendant Capture/Enhance
- **Sévérité** : P2 (React 18 ⇒ no-op + warning console, pas de crash)
- **Fichier** : `RoofPolygonAIInline.tsx:473-507` (`doCapture`), `:510-548` (`doEnhance`)
- **Repro** : lancer « Capturer » (compositing Google Static / Ortho QC + réseau)
  ou « Améliorer » (`supabase.functions.invoke('roof-polygon-enhance')`), puis
  démonter le composant avant la fin (bascule `measureMode`, navigation). Les
  `setBusy`/`setError`/`setOverlays`/`log→setLogs` du `try/catch/finally`
  s'exécutent sur un composant démonté ; les `Image()`/fetch en vol continuent
  (pas d'`AbortController`).
- **Cycle de vie — réponse à la Q2** : ces deux composants **n'attachent aucun
  listener Google Maps directement** (RPAI passe par `getCaptureParams` du parent ;
  MapToolbox ne touche pas l'objet `google.maps`). Le seul vrai défaut de cycle de
  vie côté listeners est **MTBX-001** (listeners `window`). Côté async, c'est ce
  RPAI-003 (pas de garde « monté »).
- **Correction recommandée** : `mountedRef` (ou `AbortController`) ; court-circuiter
  les `setState`/`log` si démonté.

### RPAI-004 — État local perdu au démontage en plein dessin (Q6)
- **Sévérité** : P2 (latent — voir RPAI-005)
- **Fichier** : `RoofPolygonAIInline.tsx:455-463` (state local : `capture`,
  `captureDataUrl`, `imgDataUrl`, `enhancedDataUrl`, `polygonPx`, `clickPt`, `busy`).
- **Repro** : capturer la vue, poser un point (et, si étapes réactivées, détecter
  un polygone), puis démonter le composant (bascule `measureMode` / fermeture de
  section). Tout l'état **local** est perdu : point cliqué et polygone non
  confirmé disparaissent.
- **Nuance** : les **overlays** capture/enhanced/polygon sont « remontés » dans le
  parent via `setOverlays` (`aiOverlays`, `AdminQuoteGenerator.tsx:346`) et
  **survivent** au démontage du composant tant que la page parente reste montée —
  mais **pas** au reload (cf. RPAI-006). Le **point** et le `polygonPx` local, eux,
  ne sont jamais remontés.
- **Correction recommandée** : remonter `clickPt`/`polygonPx` dans le parent (comme
  les overlays), ou avertir avant démontage si un dessin est en cours.

### RPAI-005 — Chemin Détecter/Confirmer mort + pipeline masque bloquant (latent)
- **Sévérité** : P3 (informationnel — UI désactivée)
- **Fichier** : `RoofPolygonAIInline.tsx:725` (commentaire « étapes 3/4 retirées »),
  `doDetect` `:562-619`, `doConfirm` `:622-632`, pipeline masque `:166-353`.
- **Constat** : `doDetect`/`doConfirm` ne sont déclenchés par aucun élément du
  rendu. Si les étapes 3/4 sont **réactivées**, attention : `maskToPolygon`
  (`morph`, `keepBestComponent`, `fillInteriorHoles`, `traceOuterContour`) est un
  pipeline pixel **synchrone sur le thread principal**, en O(W·H·r²) — sur une
  capture grande (potentiellement enhanced ×4) il peut **figer l'UI** plusieurs
  centaines de ms (risque P1 de freeze une fois réactivé).
- **Correction recommandée** (si réactivation) : exécuter le pipeline masque dans
  un Web Worker / `OffscreenCanvas` ; sinon laisser tel quel et documenter.

### RPAI-006 — Polygone confirmé partiellement perdu au reload (compat autosave Vague A) (Q7)
- **Sévérité** : P2 (perte d'état partielle ; latent car confirm désactivé)
- **Fichiers** : `AdminQuoteGenerator.tsx:5217-5245` (`onConfirmPolygon`),
  `:437-440` (persist `measureTools` → `roof_measure_tools`), `:656` + `:3055`
  (`mapAnnotations` init/reset `[]`, **jamais** en localStorage), `:346`
  (`aiOverlays` init `[]`, **jamais** persisté), `:1889-1901` (brouillon mobile
  Vague A `quote_generator_draft_v1`).
- **Analyse** : confirmer un polygone IA produit deux choses :
  1. un **`measureTool`** « Toit IA » → persisté dans `localStorage`
     (`roof_measure_tools`, `:439`) ⇒ **survit** au reload ;
  2. un **`mapAnnotation`** (`segments` + `markerPositions`, la géométrie carte)
     → `mapAnnotations` n'est **jamais** écrit en localStorage et n'est restauré
     que depuis une **soumission sauvegardée** (serveur) ⇒ **perdu** au reload
     d'une soumission non sauvegardée.

  Le **brouillon Vague A** (`:1889-1901`) ne sérialise que les champs
  client/adresse/sélections — **ni `measureTools`, ni `mapAnnotations`, ni
  `aiOverlays`**. Les overlays image IA (`aiOverlays`) ne sont persistés nulle part.
- **Résultat au reload (soumission non sauvegardée)** : on conserve la **valeur de
  surface** (outil) mais on perd **le polygone sur la carte** et **les calques IA**
  → outil « Toit IA » **orphelin** sans polygone affiché, calques IA disparus.
  Incohérence d'état (pas une perte totale : le chiffre reste).
- **Latence** : non déclenchable tant que la confirmation IA est désactivée
  (RPAI-005). Le devient si étapes 3/4 réactivées.
- **Correction recommandée** : inclure dans le brouillon (ou un store dédié) les
  `mapAnnotations` liés aux cibles `ai-roof-*` **et** les `aiOverlays`, ou persister
  la géométrie confirmée à côté du `measureTool` afin que polygone + surface
  restent cohérents au reload.

---

## 3. Réponses directes aux 7 points de la mission

1. **Touch vs map gestures / `touch-action`** : `MapToolbox` drag/resize sont
   souris-only (MTBX-004) → pas de conflit actif mais fonction tactile absente ;
   `RoofPolygonAIInline` pose le point en `onClick` sans `touch-action` (RPAI-002).
   Aucun `touch-action:none` posé par ces composants (le canvas carte, hors
   périmètre, a déjà le sien).
2. **Cycle de vie / listeners** : aucun listener `google.maps` attaché par ces deux
   composants. Défaut réel = **MTBX-001** (listeners `window` drag/resize non
   nettoyés au démontage) + **RPAI-003** (`setState`/fetch async sans garde).
3. **Re-renders/s en édition** : pas d'édition de polygone continue ici. Seule
   boucle par frame = drag/resize `MapToolbox` ≈ **~60 re-renders/s** (déduit du
   code), chacun avec écriture `localStorage` synchrone (**MTBX-002**).
4. **Z-index vs barre sticky AQG-001** : oui, conflit (**MTBX-005**) — flottant
   `zIndex:100` < sticky `1000` ; docké masqué en bas par la barre `fixed`.
5. **Cibles ≥ 44 px** : **non**, aucun bouton des deux composants n'atteint 44 px
   sur mobile (**MTBX-003**, **RPAI-001**) ; ~14-26 px selon le contrôle.
6. **État perdu à la fermeture en plein dessin** : oui pour l'état **local**
   (point, polygone non confirmé) — **RPAI-004** ; les overlays survivent dans le
   parent (mais pas au reload).
7. **Compat autosave Vague A** : **incompatibilité partielle** (**RPAI-006**) — un
   polygone confirmé garde sa **surface** (localStorage `roof_measure_tools`) mais
   perd sa **géométrie carte** + ses **calques IA** au reload d'une soumission non
   sauvegardée ; le brouillon Vague A ne couvre pas ces données. *Latent* tant que
   la confirmation IA reste désactivée (RPAI-005).

---

## 4. Sections les plus fragiles
1. **Persistance** : la dichotomie « surface persistée / géométrie non persistée »
   (RPAI-006) est le risque d'intégrité le plus sérieux si la confirmation IA est
   réactivée.
2. **Drag/resize flottant `MapToolbox`** : souris-only + listeners non nettoyés +
   `localStorage` par frame (MTBX-001/002/004).
3. **Cibles tactiles** : systématiquement sous 44 px (MTBX-003 / RPAI-001).

## 5. Risques Safari iOS / Android restants (à valider device)
- Tap-delay 300 ms / double-tap-zoom sur les boutons et l'aperçu (aucun
  `touch-action:manipulation`).
- Mode flottant `MapToolbox` non manipulable au doigt (MTBX-004).
- Recouvrement par la barre sticky (MTBX-005) selon hauteur d'écran / encoche.

## 6. GO / NO-GO

**GO** pour l'usage **desktop** des deux composants (drag/resize souris, z-index
flottant gérable, pas de data-loss actif). **NO-GO mobile « confortable »** tant
que **MTBX-003 / RPAI-001** (cibles ≥ 44 px) et **MTBX-004** (drag/resize tactile)
ne sont pas traités. **Aucun P0 actif** : la confirmation IA — et donc les
scénarios de perte d'état RPAI-004/006 — est **désactivée** dans l'UI courante
(étapes 3/4 retirées). ⚠️ **Avant toute réactivation des étapes 3/4**, traiter en
priorité **RPAI-006** (cohérence surface/géométrie au reload) et **RPAI-005**
(pipeline masque bloquant → Web Worker), faute de quoi ces deux points deviennent
P1/P0 actifs.
