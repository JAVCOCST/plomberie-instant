# Briefing builder — AdminQuoteGenerator prod mobile

> **Destinataire : Claude principal (builder).**
> **Émetteur : Claude architecte/auditeur.**
> **But du document : transformer les audits en instructions actionnables pour livrer
> `AdminQuoteGenerator` en prod mobile, sans perte de données.**

Date : 2026-05-27 · Branche audit : `claude/quote-roofmodel-audit-aXRf5`
Fichier cible : `src/pages/AdminQuoteGenerator.tsx` (7289 lignes, 187 hooks)

---

## 0. Mission en une phrase

Rendre `/admin/quote` **utilisable au doigt sur iPhone** et **garantir qu'aucune
soumission en cours n'est perdue**, en livrant 3 vagues additives derrière feature flag,
sans toucher au moteur de calcul ni aux composants Roof Model.

---

## 1. À lire avant d'écrire la première ligne (ordre imposé)

1. **`docs/admin-quote-prod-readiness-deep-dive.md`** — cartographie d'état (187 hooks),
   15 vecteurs de perte, 3 vagues, critères « 100 % fonctionnel ». **Source de vérité.**
2. **`docs/admin-quote-mobile-ui-audit.md`** — 18 problèmes UI mobiles avec IDs `AQG-001`
   à `AQG-018`, sévérités, fichiers, lignes. Référencé par ID dans ce briefing.
3. **`docs/quote-roofmodel-phase0-5-architecture.md`** — architecture `RoofModel →
   RoofTakeoff → Quote`. Pertinent pour la Vague A : si tu ajoutes une colonne ou un
   champ JSONB pour le take-off, prévois la place pour `roof_takeoff` (Phase 1 future).
4. *Optionnel* : `docs/quote-roofmodel-integration-audit.md` et `docs/quote-roofmodel-research-findings.md`
   (contexte).

---

## 2. Objectifs vérifiables (Definition of Done)

| Goal | Mesurable comment |
|---|---|
| **G1 — Zéro perte** | Couper le réseau 5 min pendant l'édition → tout est rejoué au retour ; kill `Cmd+W` brutal → tout rouvre via `?id=` ; éditer A puis B → aucun champ de A ne fuite dans B. |
| **G2 — Fluidité mobile** | INP de saisie < 100 ms sur iPhone 11 ; aucune modale chevauchée par la barre sticky ; édition d'une ligne de soumission au doigt sans lag perceptible ; Lighthouse perf mobile ≥ 60. |
| **G3 — 100 % branché** | Aucun toast `error` muet ; chaque échec a une bannière + télémétrie ; aucun champ saisi ne disparaît silencieusement ; les sentinelles fantômes (`'Brouillon'`, `admin@toituresvb.ca`, `000-000-0000`) ne fuient plus dans `soumissions`. |

---

## 3. Vague A — Zéro perte (P0, à livrer en premier)

**Effort cible : 3–5 jours.** Couvre les 15 vecteurs L1–L15 du deep dive §2.

### 3.1 Fichiers à créer
- `src/hooks/useQuoteAutosave.ts` — hook debounce 3 s + flush sur `visibilitychange='hidden'`
  + `pagehide`. Accepte un `payload`, un `soumissionId | null`, et un statut online/offline.
  Délègue l'écriture à `src/lib/quote-persistence.ts` (cf. ci-dessous).
- `src/lib/quote-persistence.ts` — module pur : sérialise l'état complet en `draftPayload`
  (factorisé depuis `handleSave:3225-3285`). Une seule source de vérité pour le shape.
  Ajoute un champ `schema_version: '1.0.0'` au `dynasty_breakdown` (versioning).
- `src/lib/quote-offline-queue.ts` — file IndexedDB (`idb-keyval` ou `Dexie`). API :
  `enqueue(payload)`, `flush(online)`, `getPending()`. Reçoit les Save qui ont échoué.
- `src/hooks/useOnlineStatus.ts` — wrap `navigator.onLine` + écoute `online`/`offline`.
- `src/components/quote-saver/SaveStatusIndicator.tsx` — petit composant en haut de page :
  `Sauvegardé ✓ il y a 3 s` / `⟳ Sauvegarde…` / `⚠ Hors ligne — sera synchronisé` / `⚠ Échec`.
- `src/components/quote-saver/ConflictDialog.tsx` — placeholder pour Vague C (peut rester
  un stub en Vague A).

### 3.2 Fichiers à modifier (chirurgical)
- `src/pages/AdminQuoteGenerator.tsx` :
  - Importer `useQuoteAutosave`, `useOnlineStatus`, `SaveStatusIndicator`.
  - Factoriser le `draftPayload` (`3225-3285`) et le `dynastyBreakdown` (`3336-3425`) dans
    `src/lib/quote-persistence.ts` (export `buildPayloadFromState(state, kind)`), puis
    appeler depuis `handleSave` **et** depuis `useQuoteAutosave`. **Ne change pas la
    sémantique de `handleSave`.**
  - **Activer le brouillon localStorage sur desktop** : retirer la garde `if (!isMobile)
    return` ligne `1759` et étendre la liste des champs sauvegardés (cf. §3.3).
  - **Scoper la clé brouillon par soumission** : `DRAFT_KEY = 'quote_draft_v2:' + (loadedId || 'new:' + tmpId)`. `tmpId` = `useRef(crypto.randomUUID())` au montage.
  - **Reset complet dans `loadSoumission`** (`1431`) : appeler `resetForm()` ou un
    `resetStateForLoad()` au début, **avant** de remplir avec `s.*`. Corrige `AQG-005`.
  - **Confirmation destructive** : ajouter un `confirm()` (ou `Dialog`) sur
    `resetForm` (`3673`) et `setClearAllAnnotations` (`4711`) si l'état est sale.
  - **Upload immédiat du plan manuel** : déplacer le `supabase.storage.upload` de
    `3324-3333` dans `PlanViewer.onPlanImageData` (callback `4643`) → uploader dès que
    `planImageDataUrl` est défini, stocker l'URL dans `savedPlanUrl`. Ainsi `handleSave`
    n'a plus rien à uploader.
  - **Compression image** : intercepter `handlePdfUpload` (`1247`) et `handleDocDrop`
    (`1288`). Si `image/*` et taille > 1.5 Mo, compresser via Web Worker (cf. §3.4) ;
    si `heic/heif`, convertir via `heic2any` lazy-loadé.

- `src/integrations/supabase/types.ts` : généré, **ne pas éditer**. Si tu ajoutes une
  colonne (déconseillé en Vague A — reste sur `dynasty_breakdown` JSONB), regénère.

### 3.3 Champs à inclure dans le brouillon v2 (clé `quote_draft_v2:<id|tmp>`)
Tout ce qui figure dans `draftPayload` (`handleSave:3225-3285`) **plus** :
- `mapAnnotations` (sérialisable tel quel : `{ target, feet, visible, index, segments,
  markerPositions }`).
- `measureTools` (mêmes 11 champs que le Save).
- `extraLines`, `hiddenLines: Array.from(hiddenLines)`, `lineOverrides`, `lineQbProducts`,
  `lineMeasureMappings`, `lineMajorations`, `lineCategories`, `lineCostOverrides`,
  `lineLaborTypes`, `realCosts`.
- `quoteNotes`, `paymentTerms`, `exclusionsList`, `exclusionsChecked`, `quoteHeaderFields`,
  `previewConfirmed`.
- `contractType`, `contractFields`, `contractInlineEdits`.
- `warrantyYears`, `warrantyCompletionDate`, `warrantyInvoice`, `warrantyContractAmount`,
  `warrantyIncludeConditions`.
- `selectedQbCustomer?.Id`, `useOwnerAsClient`.
- `pdfFiles`, `contactPhotoUrl`, `projectPhotoUrl` (URLs déjà uploadées, OK à mettre).
- `polygonAdj`, `lotAdj`, `mapParams`, `streetViewState`.
- `_ts: Date.now()` (validité), `_tmpId` (si pas de `loadedId`).

### 3.4 Compression image — détail
- `src/lib/image-compress.worker.ts` : Web Worker, accepte un `File`, retourne un `Blob`
  JPEG qualité 0.82, max 2048 × 2048.
- `heic2any` lazy-loadé via `await import('heic2any')` à la demande.

### 3.5 Contraintes Vague A
- **Ne modifie pas** la signature des écritures `soumissions.insert/update` (lignes
  `3296/3298/3459/3461`) — le shape reste identique pour ne pas casser la lecture
  existante par `loadSoumission`.
- **Ne supprime pas** la persistance globale `roof_measure_tools` (line 365) en Vague A
  — désactive-la sous flag, garde la fallback en lecture pour les anciennes sessions.
- **Ajoute `schema_version: '1.0.0'`** dans `dynasty_breakdown` lors de l'écriture.
  Lecture tolérante (absent = considéré `1.0.0`).
- **Sentinelles** : conserve-les en Vague A (compatibilité), elles seront éliminées en
  Vague C.

### 3.6 Tests d'acceptance Vague A
1. iPhone Safari : ouvrir nouvelle soumission, taper 5 min, fermer brutalement l'onglet,
   rouvrir → tout est restauré (annotations, lignes, exclusions, contrat, garantie).
2. Couper le Wi-Fi pendant l'édition → bannière « Hors ligne », autosave continue dans
   IndexedDB, bouton Save manuel reste fonctionnel → réseau revient → flush automatique,
   bannière disparaît.
3. Charger A (avec annotations), charger B (sans annotations) → B n'a aucune annotation
   héritée de A.
4. Cliquer « Nouveau » sur état sale → confirmation demandée.
5. Cliquer « Tout effacer » annotations → confirmation demandée.
6. Dessiner un plan manuel, recharger la page **sans Save** → le plan est récupérable
   (uploadé en background).
7. Uploader une photo iPhone 12 Mo HEIC → compressée à < 1.5 Mo JPEG, upload réussit.

---

## 4. Vague B — Fluidité mobile (P0, à livrer en deuxième)

**Effort cible : 3–4 jours.** Traite `AQG-001`, `AQG-002`, `AQG-003`, `AQG-006`,
`AQG-009`, `AQG-013`, `AQG-015`.

### 4.1 Fichiers à créer
- `src/styles/z-index.ts` — tokens : `ZBASE=1`, `ZDROPDOWN=50`, `ZSTICKY=40`,
  `ZMODAL=60`, `ZOVERLAY_TOP=70`, `ZLIGHTBOX=80`. **Sticky < Modal.**
- `src/components/admin-quote/MobileToolPanel.tsx` — réécriture mobile-only du panneau
  outils de mesure : **cartes empilées** une par outil avec champs en wrap, labels
  visibles, cibles ≥ 44 px. Le panneau desktop existant reste intact.
- `src/components/admin-quote/QuotePreviewMobile.tsx` — wrapper `transform: scale()`
  fit-width autour de `QuotePreview` **hors `@media print`**. Pas de modification de
  `QuotePreview.tsx` (impression intacte).
- `src/components/admin-quote/MobileMetricsBanner.tsx` — variante responsive du bandeau
  métriques (`3779-3822`). Grille 2×2 mobile, flex desktop.

### 4.2 Fichiers à modifier
- `src/components/ui/dialog.tsx` : remplacer `z-50` par `z-[60]` via classe contrôlée par
  `src/styles/z-index.ts`. Vérifie qu'aucune autre modale Radix n'est dégradée.
- `src/pages/AdminQuoteGenerator.tsx` :
  - Importer `useAnyDialogOpen()` (nouveau hook qui écoute l'état combiné des Dialog).
    Masquer la barre sticky (`7072-7127`) quand `anyDialogOpen === true`.
  - Remplacer le bandeau métriques (`3779-3822`) par `<MobileMetricsBanner />`.
  - Remplacer le panneau outils mobile (`4706-4925`, conditionnellement `isMobile`) par
    `<MobileToolPanel />`. Garde la version desktop intacte.
  - Wrapper `<QuotePreview />` (`5585`) dans `<QuotePreviewMobile>` sur mobile.
  - Cibles tactiles ≥ 44 px : règle, archive, suppression, toggle GPS/manuel, actions
    modèles. Override mobile.
- `src/App.tsx` :
  - `AdminQuoteGenerator` passé en `lazy(() => import('./pages/AdminQuoteGenerator'))`.
- `src/lib/pdf-generators.ts` : imports dynamiques de `html2canvas`/`jspdf` au point
  d'appel.
- Inline styles → constantes hors render pour les composants chauds (mémoïsation).

### 4.3 Mémoïsation
- `React.memo` sur `QuotePreview`, `MetricCard`, `MetricGroup`, `SectionTitle`,
  `MajorSectionTitle`, `MobileToolPanel`.
- Extraire les `style={{ … }}` répétés en constantes module-level (déjà partiellement
  fait : `sectionStyle`, `inputStyle`).
- `useCallback` sur les setters passés à `BuildingReadOnlyMap` (`4649-4691`).

### 4.4 Tests d'acceptance Vague B
1. Ouvrir le dialog « Import QBO » sur iPhone → la barre sticky disparaît ; les boutons
   du dialog (Ajouter/Remplacer) sont entièrement visibles et cliquables.
2. Panneau d'outils sur iPhone : éditer pente, facteur, majoration → champs lisibles,
   tap fiable, valeurs non rognées.
3. Aperçu soumission sur iPhone → fit la largeur sans scroll horizontal.
4. Bandeau métriques sur iPhone → 4 métriques visibles, pas de débordement horizontal.
5. Saisie dans un champ de ligne avec 20+ lignes → INP < 100 ms (mesuré via DevTools).
6. Première peinture `/admin/quote` mobile : réduction observable de poids initial
   (lazy + dynamic imports).
7. PDF généré identique pixel par pixel à avant (snapshot test).

---

## 5. Vague C — Intégrité, observabilité, polish (à planifier après A+B)

Détails dans `docs/admin-quote-prod-readiness-deep-dive.md` §10 « Vague C ». Couvre
`AQG-004` (surface IA), `AQG-008` (mesureTools globaux), validation pré-QBO, élimination
des sentinelles, Sentry, dialog de conflit realtime, dropdowns hors-clic, mobile-cards
pour tables `minWidth ≥ 600`.

---

## 6. Liste interdite (NE PAS TOUCHER en Vagues A+B)

- **Moteur de calcul** : `src/lib/dynasty-calculator.ts`, `finalQuote` mémo
  (`AdminQuoteGenerator:2050`), métrique `metrics`. Aucune modification de logique de prix.
- **Roof Model** : `src/lib/roof-core/*`, `src/pages/AdminRoofStudio.tsx`,
  `src/components/roof-polygon-ai/*`. La Phase 1 RoofTakeoff arrive après ces vagues.
- **`QuotePreview.tsx`** : pas d'édition directe (sauf ajout de prop optionnelle).
  Toute correction mobile passe par un **wrapper** (`QuotePreviewMobile`), strictement
  hors `@media print`. Le PDF doit rester identique au bit près.
- **Supabase types généré** : `src/integrations/supabase/types.ts` (regénérer si
  nécessaire, ne pas éditer à la main).
- **Composants externes non audités** par l'auditeur (cf. §8) : `MapToolbox`,
  `RoofPolygonAIInline`, `ContractSignatureStep`, `PlanViewer`, `BuildingReadOnlyMap`,
  `BuildingMapPicker`, `StreetViewAnnotator`, `ProjectPhotoPanel`, `CopilotChat`,
  `SmartTextEditor`. **Si tu dois en modifier un, escalade à l'utilisateur d'abord.**
- **Migrations Supabase** : Vague A peut ajouter des champs JSONB, **pas de nouvelle
  colonne/table** sans GO explicite. `schema_version` reste dans `dynasty_breakdown`.
- **Edge functions** : `quickbooks-create-customer`, `quickbooks-push-estimate`,
  `send-quote-email` — pas d'édition.
- **Branche** : reste sur `claude/quote-roofmodel-audit-aXRf5` (où vivent les audits).
  Pousse tes vagues en commits distincts, séparés des commits docs.

---

## 7. Feature flag & rollback

- Flag : `VITE_QUOTE_MOBILE_V2` (env). `true` active autosave + UI mobile v2 ; `false`
  laisse le comportement actuel inchangé.
- Vague A et Vague B gardées chacune derrière un sous-flag interne si tu veux pouvoir
  rollback indépendamment : `FEATURE_AUTOSAVE`, `FEATURE_MOBILE_UI_V2`.
- En cas de régression terrain : couper le flag → comportement actuel restauré sans
  redéploiement.

---

## 8. Gaps d'audit à combler avant prod (Vague C ou pré-livraison)

L'audit n'a **pas couvert** les zones suivantes — à auditer avant bascule prod :

1. **Edge functions** Supabase : sécurité (rôle admin côté serveur), idempotence,
   gestion des erreurs côté `quickbooks-push-estimate` et `send-quote-email`.
2. **RLS** des tables `soumissions`, `quote_email_templates`, `quote_templates`,
   `quote-pdfs` bucket — vérifier qu'un `?id=` arbitraire est bien filtré par rôle.
3. **Composants externes** non lus en profondeur (cf. §6 « liste interdite »). Surtout
   `ContractSignatureStep` (signature tactile mobile), `MapToolbox` (touch gestures),
   `RoofPolygonAIInline` (cycle de vie démontage).
4. **Sections ~3000 lignes non lues** : 1810–3215 (Google Maps setup, owner lookup,
   init contrat, rebuild HTML), 4960–5560 (édition fine lignes), corps complets de
   `handlePushToQb`/`handleGeneratePdf`, `contractRebuildTimer`, warranty cert.
5. **Pas de profiling runtime** : tous les claims de perf sont statiques. Mesurer via
   Lighthouse/React DevTools sur iPhone avant validation Vague B.

---

## 9. Critères de Done par vague (résumé)

| Vague | Done quand… |
|---|---|
| **A** | Les 7 tests §3.6 passent ; aucune régression desktop ; `localStorage` ancien (`quote_generator_draft_v1`) lu en fallback et migré silencieusement vers `quote_draft_v2`. |
| **B** | Les 7 tests §4.4 passent ; PDF identique au snapshot ; pas de régression desktop ; les 5 critiques+majeures UI ciblées sont résolues. |
| **C** | Critères du deep-dive §9 ; Sentry branché et reçoit les événements. |

---

## 10. Protocole de coordination

- **Avant chaque vague** : poste un plan d'exécution court (3–5 bullets) et attends GO.
- **À mi-vague** : si tu touches un composant de la liste §6 ou si tu dois changer un
  schéma SQL, **escalade**.
- **À la fin de chaque vague** : ouvre une PR séparée vers `main` (pas vers la branche
  d'audit), avec :
  - lien vers ce briefing et vers les audits ;
  - capture mobile (iPhone) avant/après ;
  - résultats des tests d'acceptance ;
  - état du flag (`VITE_QUOTE_MOBILE_V2`).
- **Ne jamais** : modifier le moteur de calcul, casser le PDF, toucher un composant
  externe sans GO, supprimer la persistance globale `roof_measure_tools` avant Vague C.

---

## 11. Si tu es bloqué

Pose une question dans le PR (ou via `AskUserQuestion` si tu en as la capacité), avec :
- le fichier:ligne précis ;
- l'hypothèse que tu testes ;
- 2 options A/B avec les trade-offs.

Ne devine pas. Mieux vaut une question maintenant qu'une régression terrain.

---

*Briefing seulement. Aucune ligne de code écrite. La balle est dans le camp du builder
après GO explicite de l'utilisateur sur le périmètre Vague A.*
