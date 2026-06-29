# Analyse profonde — AdminQuoteGenerator pour la production mobile

> **ANALYSE / PLAN — AUCUNE LIGNE DE CODE N'A ÉTÉ ÉCRITE.**
> Ce document approfondit l'audit `docs/admin-quote-mobile-ui-audit.md` avec un angle
> **production** : ce qu'il faut pour livrer sur mobile **sans perdre de soumissions** et
> **avec une fluidité réelle**. À la fin, une **question explicite GO/NO-GO** pour engager
> les corrections.

Date : 2026-05-27 · Branche : `claude/quote-roofmodel-audit-aXRf5`
Fichier audité : `src/pages/AdminQuoteGenerator.tsx` (7289 l., 187 hooks) + ses dépendances directes
Audit UI antérieur : `docs/admin-quote-mobile-ui-audit.md` (18 problèmes documentés)

---

## 0. Cadre & priorités explicites

Tu as posé **trois objectifs** :
1. **Ultra fluide sur mobile**.
2. **Ne plus perdre de soumissions en cours de travail.**
3. **Tout branché, 100 % fonctionnel — livraison prod**.

Cette analyse traite ces trois objectifs comme **non-négociables** et les décompose en
exigences vérifiables. Tout le reste est secondaire.

**Verdict d'entrée :** la page n'est **pas prod-ready** pour mobile dans ces 3 critères.
Les blocages sont **identifiables et corrigeables**, mais **pas en un seul lot**.
Recommandation : 3 vagues de correctifs derrière feature flags, sans toucher au moteur de
calcul. Détail en §10.

---

## 1. Cartographie complète de l'état — où vit quoi, quand est-ce sauvegardé ?

J'ai inventorié les **187 hooks** et tracé pour chacun **(a) où il vit**, **(b) quand il
est persisté**, **(c) ce qui se passe en cas de crash/reload**.

### 1.1 Légende
- 🟢 **Persisté à chaque modification** (Supabase + state durable).
- 🟡 **Persisté manuellement** (utilisateur doit appuyer sur Save).
- 🟠 **Persisté partiellement** (brouillon localStorage **mobile uniquement**).
- 🔴 **Non persisté** (perdu au reload).
- ⚫ **Global non scopé** (fuite inter-soumission).

### 1.2 Inventaire

| Domaine | Données | Statut | Vit dans | Risque de perte |
|---|---|---|---|---|
| Client | `clientFirst/Last/Email/Phone/Company/PostalAddress/NEQ/isCompany` | 🟠/🟡 | `soumissions.*` + brouillon | Reload desktop avant Save = perdu |
| Adresse | `addressText/lat/lng/buildingGeojson/lotGeojson/noLot/superficie/perimetre/largeur/profondeur` | 🟠/🟡 | `soumissions.*` + `dynasty_breakdown.*` | Desktop : oui ; mobile : adresse OK, mais polygones perdus |
| Carto | `mapParams/polygonAdj/lotAdj/streetViewState` | 🔴/🟡 | `dynasty_breakdown.*` | Reload avant Save = perdu (brouillon ne les contient pas) |
| Phase bâtiment | `buildingPhase/manualMeasureMode` | 🔴 | uniquement state local | Reload = retour à `idle` |
| **Annotations carte** (mesures dessinées) | `mapAnnotations[]` | 🔴/🟡 | `dynasty_breakdown.map_annotations` au Save | **Travail principal du take-off — perdu au crash** |
| **Outils de mesure** (valeurs) | `measureTools[]` | ⚫/🟡 | `localStorage.roof_measure_tools` global + Save | Fuite inter-soumission ; perdu si pas dans la dernière sauvegarde |
| Choix produit | `selectedCoverageTypes/marque/gamme/roofType/slopeCategory/workType` | 🟠/🟡 | `soumissions.*` + `dynasty_breakdown.ui_*` | Mobile : OK ; desktop : perdu |
| Overrides quantités | `areaSqftOverride/perimeterFtOverride/faitiere/aretes/noues/events/maximums` | 🟠 (partiel)/🟡 | `dynasty_breakdown` | Partiellement dans brouillon mobile |
| Lignes de soumission | `lineOverrides/extraLines/hiddenLines/lineQbProducts/lineMeasureMappings/lineMajorations/lineCategories/lineCostOverrides/lineLaborTypes/realCosts` | 🔴/🟡 | `dynasty_breakdown.*` | **Toute édition de ligne perdue avant Save** |
| Notes / conditions | `quoteNotes/paymentTerms/exclusionsList/exclusionsChecked/quoteHeaderFields` | 🟠 (notes/CGV)/🟡 | `dynasty_breakdown.*` | Exclusions cochées & en-tête perdus avant Save |
| Aperçu confirmé | `previewConfirmed.{header,notes,terms,exclusions}` | 🔴 | state local | Perdu au reload — l'utilisateur doit revalider |
| E-mail client | `selectedTemplateId/emailSubject/emailBody/emailToOverride/emailCc/emailBcc/excludedAttachments/includeOfficialPdf/ccHistory/bccHistory` | 🟠 (historiques CC/BCC localStorage)/🔴 | local + `quote_email_templates` global | Compositeur d'e-mail perdu au reload |
| Contrat | `contractType/contractFields/contractInlineEdits/contractHtml/showContractFullscreen` | 🔴/🟡 | `dynasty_breakdown.contract_*` | Édition inline perdue avant Save |
| Garantie | `warrantyYears/warrantyCompletionDate/warrantyInvoice/warrantyContractAmount/warrantyIncludeConditions` | 🔴/🟡 | `dynasty_breakdown.warranty_settings` | Perdu avant Save |
| Documents | `pdfFiles[]/projectPhotoUrl/contactPhotoUrl` | 🟢 (storage)/🟡 (liens dans la row) | `quote-pdfs` bucket + `dynasty_breakdown.pdf_files` | Fichiers OK (bucket) ; **liens** perdus avant Save |
| Plan manuel | `planImageDataUrl/savedPlanUrl` | 🔴 (data URL en mémoire) / 🟢 (après upload au Save) | mémoire + `dynasty_breakdown.manual_plan_url` | **Crash avant Save = plan perdu (jamais uploadé)** |
| QB customer | `selectedQbCustomer/qbCustomerSearch/pendingQbCustomerId` | 🔴/🟡 | `dynasty_breakdown.selected_qb_customer_id` | Re-recherche au reload (mineur) |
| QB devis (import) | `qboEstCustomers/qboEstimates/qboEstLines/qboEstSelectedCustomer/qboEstSelectedEstimate` | 🔴 | state local dans dialog | Acceptable (refetch sur ré-ouverture) |
| Settings UI | `quoteSettings/marginThresholdPct/crewSize/coveragePerPkg` | 🟢 localStorage globaux | `quote_settings_v1`, `quote_margin_threshold` | OK |
| Templates de devis | `quoteTemplates` | 🟢 Supabase | `quote_templates` table | OK |
| Templates e-mail | `emailTemplates` (avec `default_attachments` mis en cache si colonne absente) | 🟢/🟠 | `quote_email_templates` + cache localStorage | OK |

### 1.3 Conclusions de la cartographie
- **Le travail du take-off** (`mapAnnotations`, `measureTools`, overrides, lignes éditées,
  notes, exclusions, contrat, garantie) **n'est sauvegardé qu'au Save manuel**.
- Le **brouillon mobile** (`DRAFT_KEY = 'quote_generator_draft_v1'`) **ne couvre que 22 champs**
  texte/sélection. Il **omet** : `mapAnnotations`, `measureTools` (sauf via clé globale partagée),
  toutes les lignes éditées, exclusions, contrat, garantie, polygones et leurs ajustements.
- Sur **desktop**, le brouillon est **désactivé** (`if (!isMobile) return`, ligne `1759`).
  → un refresh de l'onglet sur desktop avant Save = **tout perdu**.
- Le **plan manuel dessiné** (`planImageDataUrl`) n'est **uploadé que pendant le Save**
  (lignes `3321-3333`) ; un crash juste avant = plan perdu.
- `measureTools` est persisté **globalement** (clé `roof_measure_tools`), donc **partagé entre
  soumissions** — fuite documentée comme AQG-008.

---

## 2. Tous les vecteurs de perte de soumission — scénarios concrets

| # | Scénario | Conséquence | Probabilité mobile | Couverture actuelle |
|---|---|---|---|---|
| L1 | Crash navigateur / kill par iOS suspend après 30 min de take-off | Annotations + lignes éditées + exclusions cochées perdues | **Élevée** | Aucune |
| L2 | Réseau perdu pendant le Save | `error` toasté, **payload non sauvegardé** ; pas de retry, pas de file d'attente | Élevée | Aucune |
| L3 | Session Supabase expirée pendant la saisie | Save échoue (401), pas de re-auth automatique visible | Moyenne | Aucune |
| L4 | Refresh accidentel desktop avant Save | **Tout perdu** (pas de brouillon desktop) | Moyenne | Aucune |
| L5 | Ouvre soumission B après A sans « Nouveau » | A contamine B (AQG-005) | Élevée | Aucune |
| L6 | Deux appareils éditent la même soumission | Last-write-wins **silencieux** ; pas de conflict detection | Moyenne | Aucune |
| L7 | Photo iPhone 10–15 Mo (HEIC) uploadée | Bloque l'UI, timeout/échec silencieux possible | Élevée | Aucune (pas de compression) |
| L8 | iOS swipe-back ferme la page durant la modale | Quitte la page, état non sauvegardé perdu (pas de `history.pushState`) | Élevée | Aucune |
| L9 | « Nouveau » cliqué par erreur | `resetForm()` **sans confirmation** + supprime le brouillon | Moyenne | Aucune |
| L10 | « Tout effacer » annotations sans confirmation | Annotations perdues silencieusement | Moyenne | Aucune |
| L11 | Brouillon mobile écrit pour une *autre* soumission, puis utilisateur ouvre nouvelle soumission | Restauration du brouillon → contamine la nouvelle (clé non scopée) | Faible | Aucune |
| L12 | iOS kill l'onglet sans `pagehide` capturé | Dernière frappe non sauvegardée perdue (debounce 400 ms `1778`) | Moyenne | Aucune (`pagehide` non écouté) |
| L13 | Network slow / partial Save (timeout côté Supabase) | Pas d'idempotence (insert vs update) ; risque de doublon si user re-clique | Faible | Aucune |
| L14 | Plan manuel dessiné, crash avant Save | `planImageDataUrl` jamais uploadé → plan perdu | Moyenne | Aucune |
| L15 | Photos contact/projet en data URL en attente d'upload | Idem L14 | Faible (upload immédiat dans `ProjectPhotoPanel`, à vérifier) | À confirmer |

→ **15 vecteurs de perte ; 0 sont couverts aujourd'hui.**

---

## 3. Fluidité mobile — points chauds vérifiés

### 3.1 Coût de rendu (CPU / main thread)
- **Composant monolithe 7289 lignes**, **187 hooks**, **styles 100 % inline** : chaque
  `setState` re-rend l'arbre entier ; chaque inline `style={{ … }}` produit un nouvel objet
  à chaque render → React doit refaire le diff. Sur **iPhone milieu de gamme**, la saisie
  dans un champ devient laggy au-delà de 50–100 lignes de soumission.
- `finalQuote` est `useMemo` (`2050`) ✓, mais `QuotePreview` (1130 l.), `MetricCard`/`MetricGroup`
  (`7232`–`7268`) et la **liste des outils de mesure** ne sont **pas mémoïsés** → re-render
  intégral à chaque frappe.
- **3 `useEffect` en cascade** sur `mapAnnotations`/`perimetre`/`superficie` (`461`, `611`,
  `645`) : un setState dans l'un peut redéclencher les autres → coût quadratique potentiel
  pendant le dessin.

### 3.2 Coût d'interaction
- Règle anti-zoom iOS `font-size:16px !important` (`3649`) appliquée **globalement** aux
  inputs : combinée à des cellules de 38–56 px (panneau outils) = **débordement + tap raté**
  (AQG-002). Critique pour le take-off.
- **Cibles tactiles < 44 px** sur de nombreux boutons critiques : règle 22×22 (`4770`),
  toggle GPS/manuel 34×18 (`4592`), actions modèle fontSize 9 (`4536`+).
- Conflit tactile potentiel : la barre sticky (`z:1000`) couvre 60–70 px du bas de viewport
  — chevauche les boutons inline des dialogs (AQG-001).

### 3.3 Coût réseau / chargement
- `/admin/quote` **n'est PAS lazy-loaded** (`App.tsx:79`) — contrairement à
  `AdminRoofStudio`/`AdminRoofPolygonAI` (`App.tsx:15-16`). **Tout le code de la page
  (7289 l.) + `html2canvas` + `jspdf` + Google Maps + lucide-react entier** chargent dès
  l'entrée admin.
- Première peinture mobile estimée : **~250–500 ko JS + 100 ko CSS avant interactivité**,
  dont 80 % inutiles à 90 % des sessions admin.

### 3.4 Coût de la carte
- Google Maps charge en plein écran (`BuildingReadOnlyMap`) avec tuiles satellite + 3
  vignettes (`3866`) → coût tuiles élevé sur data mobile (chaque vignette = `staticmap`,
  ré-appelée à chaque render parent si non mémoïsée).
- Aucun `loading="lazy"` sur ces images (✓ présent à 3870 — bon).
- `RoofPolygonAIInline` mounté dans le `MapToolbox` `aiInlineContent` : à confirmer s'il
  est démonté quand non visible (sinon, écoute continue en arrière-plan).

### 3.5 Coût d'aperçu / impression
- `QuotePreview` rend **2 pages A4 complètes** (`width:210mm × min-height:297mm`) en
  permanence dans la section 5 → un canvas A4 vivant pour rien.
- `html2canvas` (utilisé pour le PDF) est **synchrone bloquant** ~500 ms à 2 s sur mobile.
  Lance un freeze pendant la génération.

---

## 4. Réseau / offline / résilience

| Aspect | État actuel | Cible prod |
|---|---|---|
| Détection online/offline | ❌ aucune | `navigator.onLine` + écoute `online`/`offline` → banner « Mode hors ligne » |
| Save autosave | ❌ aucune | Debounce 3–5 s + flush sur `visibilitychange='hidden'` + `pagehide` |
| Retry réseau | ❌ aucun | Exponentiel (1s, 2s, 4s, 8s, abandon) + indicateur visuel |
| Idempotence Save | ⚠️ partielle (insert vs update via `loadedId`) | Clé d'idempotence côté row + `If-Match` ou `updated_at` optimistic |
| File offline | ❌ aucune | Queue IndexedDB → flush quand `online` |
| Upload images | ❌ pas de compression, pas de progress | Compression (WebP/JPEG ≤ 1.5 Mo), barre de progression, retry, abort |
| Session expirée | ❌ pas de gestion | Intercepteur 401 → `refreshSession()` transparent + bannière |
| Concurrence multi-appareils | ❌ last-write-wins silencieux | Optimistic concurrency (`updated_at`) ; canal realtime → dialog « ce devis a été modifié ailleurs » |
| Realtime déjà branché | ✓ `projects-stream` dans `useProjects` | Mais **n'invalide pas** le state local d'AdminQuoteGenerator |

---

## 5. Données / intégrité

- **Valeurs sentinelles fantômes** : si `clientFirst/Last/Email/Phone` sont vides, le Save
  insère « Brouillon / Admin / admin@toituresvb.ca / 000-000-0000 » (`3226-3229`, `3428-3429`).
  → un brouillon non finalisé poussé vers QBO injecte un faux client.
- `area_sqft: effectiveAreaSqft || 0` (`3433`) : sauvegarde 0 si rien — pollue les analytics
  et les filtres.
- `dynasty_breakdown` est un **gros JSONB libre** sans schéma versionné → dérive silencieuse
  entre versions (déjà visible : `ui_roof_type` ajouté plus tard, `coverage_type` est dérivé
  de `roofType` si vide, etc.).
- **Pas de validation** d'e-mail, NEQ, téléphone côté front avant Save / Push QBO.
- Pas d'invariant assuré : un Save peut écrire `dynasty_breakdown.lines` vide tout en gardant
  `subtotal > 0` (incohérence possible).

---

## 6. Authentification / session / sécurité

- `supabase.auth.getSession()` appelé ponctuellement (`2914`, `2988`, `3170+` PDF) — pas
  d'intercepteur global. Un token expiré pendant la saisie n'est détecté qu'au Save.
- `ANON_KEY` exposé en clair (normal Supabase) ; **fonctions edge non auditées ici** :
  `quickbooks-create-customer`, `quickbooks-push-estimate`, etc. — à confirmer qu'elles
  vérifient le rôle admin côté serveur.
- Le `?id=` dans l'URL permet de re-ouvrir une soumission (`1704`) — assure-toi que la RLS
  Supabase empêche un utilisateur non admin de lire un `id` arbitraire.

---

## 7. Gestion des erreurs & observabilité

- **26 blocs `catch`** dans le fichier, gestion hétérogène : `toast.error`, `alert()`,
  `console.error`, parfois `setQbPushResult({success:false,…})`. **Pas de canal centralisé.**
- **Aucune télémetrie** : impossible aujourd'hui de savoir en prod combien de Save échouent,
  combien de PDFs ne se génèrent pas, combien de pushes QBO sont rejetés, ni pourquoi.
- **Aucun monitoring** d'erreurs JS (Sentry/équivalent) visible dans le repo.
- `console.error` n'apparaîtra jamais en prod pour le terrain.

---

## 8. Bundle / chargement

- `/admin/quote` chargé **eager** par `App.tsx:79`.
- Dépendances lourdes importées en tête de fichier :
  - `html2canvas`, `jspdf` (lignes 21–22) → ~300 ko gzip.
  - `lucide-react` icon imports — l'import nommé garde le tree-shaking, OK.
- **Recommandation prod** : `lazy(() => import('./pages/AdminQuoteGenerator'))` +
  imports dynamiques de `html2canvas`/`jspdf` au moment du clic « Télécharger PDF ».

---

## 9. Critères « 100 % fonctionnel » pour la prod

Une liste vérifiable avant de presser le bouton prod :

**P0 — Perte de données (zéro toléré)**
- ✅ Autosave Supabase debounce 3–5 s (toutes les zones critiques : annotations, mesures,
  lignes, notes, contrat, garantie, e-mail, exclusions, en-tête, polygones).
- ✅ Flush sur `visibilitychange='hidden'` et `pagehide` (iOS).
- ✅ Détection online/offline + file d'attente IndexedDB + flush au retour en ligne.
- ✅ Retry exponentiel (max 4) + indication visible « Sauvegarde en attente / Réessai… / Échec ».
- ✅ Optimistic concurrency (champ `updated_at` ou `version`) + dialog conflit.
- ✅ Brouillon desktop activé (même mécanisme que mobile).
- ✅ Brouillon **scopé par `id` ou `tmp_id`** (plus de clé globale).
- ✅ `loadSoumission` fait un **reset complet** avant remplissage (AQG-005).
- ✅ Confirmation pour « Nouveau » et « Tout effacer » si données non sauvegardées.
- ✅ Plan manuel uploadé dès le dessin terminé (pas au Save).
- ✅ Compression image avant upload (≤ 1.5 Mo, conversion HEIC→JPEG).

**P0 — Fluidité mobile**
- ✅ Z-index unifié, barre sticky **masquée** quand une modale Radix est ouverte (AQG-001).
- ✅ Panneau d'outils en layout mobile dédié (cartes empilées) — fini la grille 7-col (AQG-002).
- ✅ Aperçu `QuotePreview` avec `transform: scale(fit-width)` mobile (AQG-003).
- ✅ Bandeau métriques responsive (AQG-006).
- ✅ Cibles tactiles ≥ 44 px sur tous les boutons critiques (AQG-015).
- ✅ Lazy-load `/admin/quote` + `html2canvas`/`jspdf` (perf chargement).
- ✅ Mémoïsation de `QuotePreview`, `MapToolbox`, panneau outils, tables (perf saisie).
- ✅ `viewport-fit=cover` + `100dvh` (au lieu de `100vh`) sur les overlays plein écran.

**P1 — Intégrité / Branchements**
- ✅ Surface IA non écrasée par l'empreinte (AQG-004 : marquer la **source** de l'outil).
- ✅ Validation client (e-mail, téléphone) avant Push QBO.
- ✅ Plus de valeurs sentinelles (`'Brouillon'`/`admin@toituresvb.ca`) injectées dans la row.
- ✅ `effectiveAreaSqft` nullable plutôt que `0`.
- ✅ Schéma versionné du `dynasty_breakdown` (`schema_version: 1.x`) + lecture tolérante.
- ✅ Toutes les modales liées à `history.pushState` → swipe-back ferme la modale, pas la page.
- ✅ Realtime → dialog conflit quand une autre session modifie la même `id`.

**P1 — Observabilité**
- ✅ Sentry (ou équivalent) branché : erreurs JS, échecs Save, échecs PDF, échecs Push QBO.
- ✅ Événements métier loggués : `quote.save.ok/fail`, `quote.push_qbo.ok/fail`,
  `quote.pdf.ok/fail`, `quote.autosave.queued/flushed`.
- ✅ Bannière utilisateur claire : « Mode hors ligne — vos modifications seront synchronisées ».
- ✅ Indicateur d'autosave (« ✓ Sauvegardé il y a 3 s » / « ⟳ Sauvegarde… » / « ⚠ Hors ligne »).

---

## 10. Plan d'implémentation prod — 3 vagues

> Tous les correctifs **mobile-scoped** (`isMobile`/`@media`), **derrière feature flag**
> (`VITE_QUOTE_MOBILE_V2`), **sans toucher** au moteur de calcul ni à `QuotePreview` côté
> impression. Chaque vague livrable indépendamment et **rollback en une bascule**.

### Vague A — Zéro perte de données (P0)
Effort estimé : **3–5 jours** · Cible : aucun scénario L1–L15 n'est laissé sans filet.

1. **Autosave Supabase** (1 j)
   - Nouveau hook `useQuoteAutosave({ soumissionId|null, payload, online })`.
   - Debounce 3 s sur les changements ; flush immédiat sur `visibilitychange='hidden'` +
     `pagehide`.
   - Réutilise la fonction de payload existante (`handleSave` factorisé).
   - Indicateur visuel discret en haut (« Sauvegardé · ⟳ · Hors ligne »).
2. **File d'attente offline IndexedDB** (1 j)
   - `Dexie` (déjà compatible) ou `idb-keyval`.
   - Au retour online (`navigator.onLine` + `online` event), flush séquentiel avec
     optimistic concurrency (`updated_at` check).
3. **Brouillon desktop + scope par soumission** (0.5 j)
   - Activer le brouillon localStorage sur desktop ; clé `quote_draft_v2:<id|tmp>`.
   - Inclure annotations, mesures, lignes, exclusions, contrat, garantie.
4. **Reset complet avant `loadSoumission`** (0.5 j) — corrige AQG-005.
5. **Confirmation destructive** : « Nouveau » / « Tout effacer » si l'état est sale (0.5 j).
6. **Upload immédiat plan manuel et compression photos** (1 j)
   - Web Worker pour compression JPEG/WebP ; cible ≤ 1.5 Mo.
   - Polyfill HEIC ou bascule via `heic2any` lazy-loadé.
7. **Indicateur d'état** en haut (« ✓ Sauvegardé / ⟳ / ⚠ Hors ligne ») + bannière offline.

**Acceptance** : couper le réseau pendant 5 min d'édition → tout est rejoué au retour ;
fermer l'onglet brutalement → tout rouvre via `?id=` ; éditer A puis B → aucune contamination.

### Vague B — Fluidité mobile (P0)
Effort estimé : **3–4 jours** · Cible : take-off et envoi utilisables au doigt sans friction.

1. **Z-index centralisé** + barre sticky masquée si Dialog ouvert (0.5 j) — AQG-001.
2. **Panneau d'outils mobile** réécrit en cartes empilées (1 outil = 1 carte avec labels)
   (1 j) — AQG-002.
3. **`QuotePreview` fit-width mobile** via `transform: scale()` scoped hors `@media print`
   (0.5 j) — AQG-003.
4. **Bandeau métriques responsive** + cibles tactiles ≥ 44 px (0.5 j) — AQG-006, 015.
5. **Lazy-load `/admin/quote`** (`App.tsx`) + imports dynamiques `html2canvas`/`jspdf`
   (0.5 j).
6. **Mémoïsation** : `React.memo` sur `QuotePreview`, `MetricCard/Group`, panneau outils ;
   isolation de l'inline style → constantes hors render (1 j).
7. **`history.pushState`** sur l'ouverture de chaque modale plein écran (panneau outils,
   contrat) → swipe-back ferme la modale, pas la page (0.5 j).

**Acceptance** : profil Lighthouse mobile ≥ 60 perf ; INP de la saisie < 100 ms ; édition
d'une ligne sur iPhone 11 sans lag perceptible ; aucune modale chevauchée par la barre sticky.

### Vague C — Intégrité, observabilité, polish (P1)
Effort estimé : **3–4 jours**.

1. **Source des outils** (`source: 'auto' | 'ai' | 'manual'`) + protection contre l'écrasement
   IA (AQG-004) (0.5 j).
2. **Validation pré-Push QBO** (e-mail, téléphone, NEQ optionnel) + interdiction des
   sentinelles « Brouillon / admin@… / 000-… » dans la row (0.5 j).
3. **Versioning `dynasty_breakdown`** (`schema_version`) + lecture tolérante (`migrate()`)
   (0.5 j).
4. **Realtime conflit** : si `?id=` reçoit une mise à jour distante, dialog « Modifié
   ailleurs · Recharger / Garder mes modifications » (1 j).
5. **Sentry (ou équivalent) + événements métier** + dashboard léger (0.5–1 j).
6. **Polish UI** : fermeture dropdowns hors-clic, scroll-lock overlays, mobile-cards pour
   les tables `minWidth ≥ 600` (1 j) — AQG-010 → 018.

**Acceptance** : aucune sentinelle dans `soumissions` créées par les nouveaux flux ;
événements Save/PDF/QBO visibles dans Sentry ; conflit concurrent détecté en local entre
deux navigateurs.

---

## 11. Risques résiduels après mise en prod

- **`QuotePreview` mobile** : la mise à l'échelle fit-width peut altérer l'aperçu à l'écran
  mais **ne doit pas** altérer le PDF — à isoler strictement (test snapshot PDF avant/après).
- **`html2canvas` mobile** : peut produire des PDFs lourds (4–8 Mo) — prévoir compression
  PDF si poids critique.
- **Realtime de conflit** : risque de fausses détections si l'autosave de l'autre session
  rafale → debounce serveur (5 s) et signature de l'auteur (`session_id`) pour ignorer
  ses propres updates.
- **iOS swipe-back + `history.pushState`** : peut casser le bouton retour natif si mal
  géré ; tester sur Safari 16/17.
- **Bundle dynamique** : un `lazy()` non précédé d'un `Suspense` adéquat = flash de
  chargement → soigner les fallbacks.
- **IndexedDB en navigation privée** : capacité limitée (~50 Mo) ; bannière dégradée si
  refus.
- **Roof Model Phase 1 à venir** : la couche `RoofTakeoff` planifiée (`docs/quote-roofmodel-phase0-5-architecture.md`)
  arrivera **après** ces 3 vagues ; veille à ce que la Vague A persiste un `roof_model`
  JSONB nullable pour que Phase 1 s'y insère sans nouveau Save.

---

## 12. GO / NO-GO + question explicite

**État actuel : NO-GO production mobile.** Les 15 vecteurs de perte et les 2 critiques UI
(z-index modales + panneau outils) **doivent** être traités avant livraison terrain.

**Après les Vagues A + B : GO conditionnel** (couvre les 2 priorités explicites : zéro perte
+ fluidité mobile). La Vague C consolide pour la sérénité long-terme et l'observabilité prod.

### Question pour démarrer

> **Donnes-tu le GO pour engager la Vague A (zéro perte) dès maintenant, puis enchaîner la
> Vague B (fluidité mobile) ?**
>
> Précise aussi :
> - **Périmètre du flag** : `VITE_QUOTE_MOBILE_V2` activable on/off par admin pour rollback ?
> - **Sentry** ou autre fournisseur d'observabilité déjà disponible ?
> - **Capacité IndexedDB** : OK pour Dexie comme dépendance ?
> - **Compression image** : `heic2any` acceptable comme dépendance lazy ?
> - **Branche cible** : on reste sur `claude/quote-roofmodel-audit-aXRf5` ou on dérive
>   `claude/quote-mobile-prod-v1` ?
>
> Tant que ces réponses ne sont pas données, **aucun code ne sera écrit**. Le précédent posé
> tient : architecte d'abord, builder seulement sur GO.

---

*Analyse profonde uniquement. Aucune ligne de code, de style, de composant, de migration ou de
configuration modifiée. Documents liés : `docs/admin-quote-mobile-ui-audit.md` (audit surface),
`docs/quote-roofmodel-phase0-5-architecture.md` (intégration Roof Model future).*
