# Audit mobile / UI — AdminQuoteGenerator (`/admin/quote`)

> **AUDIT SEULEMENT — aucune correction appliquée.** Aucune modification de
> `AdminQuoteGenerator.tsx`, du CSS, des composants, du routing, de roof-core, de
> Supabase ni des templates. Ce document est un rapport. Aucun correctif ne sera
> écrit sans GO explicite.

Date : 2026-05-27 · Branche : `claude/quote-roofmodel-audit-aXRf5`
Fichier audité : `src/pages/AdminQuoteGenerator.tsx` (7289 lignes, 187 hooks d'état)

---

## 1. Résumé exécutif

La page est fonctionnellement très riche (générateur de soumission, take-off carto,
aperçu PDF, contrat, e-mail, QuickBooks) mais c'est un **monolithe de 7289 lignes avec
styles 100% inline**, ce qui crée des angles morts mobiles. Le style est propre sur
desktop ; les problèmes sont **structurels mobiles** : un **conflit de z-index** où la
barre d'action mobile (et les panneaux flottants) passent **au-dessus des modales**, un
**panneau d'outils de mesure en grille 7 colonnes à largeurs fixes** rendu inutilisable
par la règle anti-zoom iOS (`font-size:16px !important`), un **aperçu de soumission au
format A4 (210 mm)** sans mise à l'échelle (scroll horizontal forcé), et plusieurs
**fuites d'état entre soumissions** (chargement sans réinitialisation, brouillon partiel,
outils de mesure persistés globalement). À cela s'ajoute une **logique qui écrase la
surface de toit détectée par l'IA** par l'empreinte au sol.

**Total : 18 problèmes documentés** (sous-composants non inspectés en profondeur = risque
résiduel). **2 critiques, 7 majeurs, 9 mineurs.**

**Verdict mobile : NO-GO conditionnel** — utilisable en lecture/consultation, mais l'édition
de take-off et l'usage des modales sur téléphone présentent des blocages réels. Corriger
les 2 critiques + les 3 majeurs prioritaires lève le NO-GO.

---

## 2. Méthodologie

- Lecture intégrale de la structure de `AdminQuoteGenerator.tsx` (régions de rendu lues
  en détail : conteneur racine, bandeau métriques, sections 1–10, panneau outils de mesure,
  toutes les modales, barre mobile, sous-composants de pied de fichier).
- Lecture ciblée de `src/components/QuotePreview.tsx` (viewer de soumission) et
  `src/components/ui/dialog.tsx` (z-index Radix).
- Greps systématiques : `zIndex`, `position:fixed/absolute`, `isMobile`, `minWidth`,
  `gridTemplateColumns`, `overflow`, montages de modales/viewers.
- Simulation mentale des flux mobiles (iPhone étroit ~360–390 px) et des transitions
  d'ouverture/fermeture des overlays.
- **Non inspecté en profondeur (risque résiduel, à auditer séparément)** : internes de
  `MapToolbox`, `RoofPolygonAIInline`, `BuildingReadOnlyMap`, `BuildingMapPicker`,
  `PlanViewer`, `ContractSignatureStep`, `StreetViewAnnotator`, `ProjectPhotoPanel`,
  `CopilotChat`. Les constats les concernant sont marqués « à confirmer ».

---

## 3. Carte des sections de la page

| # | Section | Réf. | Notes mobiles |
|---|---|---|---|
| Header | Titre + Charger / Nouveau | `3654` | `flexWrap` OK |
| Bandeau | Adresse + 4 métriques | `3779` | ⚠️ flex `nowrap`, **pas** `isMobile` → débordement |
| — | Photo projet | `3825` | composant externe |
| 1 | Informations du projet (adresse + client) | `3833` | grille `1fr` mobile OK ; dropdown QB `3919` |
| 2 | Couverture / marque / gamme / toit / pente / travaux + modèles | `4362` | dropdown couverture custom `4377` ; tables `minWidth 700` |
| 3 | Take-off (carte + panneau outils) | `4567` | ⚠️ panneau outils grille 7 col `4723/4751` |
| 4 | Soumission complète (métriques + lignes) | `4939` | table lignes `minWidth 900` `5115` |
| 5 | Aperçu de la soumission (`QuotePreview`) | `5578` | ⚠️ page A4 210 mm `QuotePreview:506` |
| 6 | Envoi au client (e-mail, templates, contrat) | `5654` | modale contrat plein écran `6451` |
| 8 | Signature électronique (`ContractSignatureStep`) | `6474` | composant externe |
| 9 | Gestion documentaire (upload PDF) | `6488` | dropzone OK |
| 10 | Estimation vue par le client | `6593` | grille `1fr` mobile OK |
| — | Actions fixes (PDF / Save / QBO) | `6627` | ⚠️ inline en bas, Save masqué mobile |
| — | Panneau config outils (flottant) | `6692` | plein écran mobile, `zIndex 9990` |
| — | Modales : Settings `5050`, Contrat `6451`, QBO devis `6885`, Import `7018` | — | toutes `z-50` |
| — | Barre mobile sticky (Save + haut de page) | `7072` | ⚠️ `zIndex 1000` > modales |

---

## 4. Liste complète des boutons

| Libellé | Réf. | Action | Disabled / Loading | Affichage | Taille mobile | Risques |
|---|---|---|---|---|---|---|
| Charger | `3670` | toggle panneau | — | toujours | ~ok | — |
| Nouveau | `3673` | `resetForm` | — | toujours | ~ok | **destructif** (efface brouillon `2905`) sans confirmation |
| Voir archives | `3686` | toggle | — | dans panneau | ok | — |
| Rafraîchir | `3698` | refetch | — | dans panneau | petit (icône) | cible <44px |
| Ligne soumission | `3727` | `loadSoumission` | — | liste | ok | **pas de reset** → fuite d'état (voir AQG-005) |
| Archiver/désarchiver | `3749` | toggle archive | — | liste | petit | cible <44px |
| Agrandir vignettes z18/19/20 | `3866` | lightbox | — | si lat/lng | ok | — |
| Fermer lightbox | `3880` | close | — | si lightbox | 44×44 ✓ | — |
| Dropdown client QB | `3907` | recherche | — | si qbCustomers | ok | dépend hover (cosmétique) |
| Lookup propriétaire | `3957` | `fetchOwner` | loading state | si noLot | ok | — |
| Dropdown couverture | `4367` | toggle multi-select | — | toujours | ok | **pas de fermeture hors-clic** (AQG-010) |
| Marque / Gamme / Toit / Pente | `4404`,`4410`,`4418`,`4423` | `<select>` natif | — | toujours | ok | natif = OK iOS |
| Type de travaux (chips) + Autre | `4432`,`4452` | set / add | — | toujours | ok | — |
| Enregistrer modèle | `4472` | `saveAsTemplate` | disabled si vide | toujours | ok | — |
| Charger / Éditer / Suppr modèle | `4536`,`4540`,`4544` | template ops | — | table | **petits (fontSize 9)** | cibles <44px ; suppr **destructif** |
| Toggle GPS/Manuel | `4592` | toggle mode | — | si carte | 34×18 px | **cible très petite** |
| Sélectionner autre bâtiment | `4698` | phase manual | — | si found | pleine largeur | — |
| Tout effacer (annotations) | `4711` | `setClearAllAnnotations` | — | si annotations | petit | **destructif** sans confirm |
| Config outils (engrenage) | `4716` | ouvre panneau | — | toujours | petit | — |
| Règle / mesure (par outil) | `4770` | `setMeasureMode` | — | si canAnnotate | 22×22 px | **cible <44px** |
| Inputs valeur/pente/facteur/maj (par outil) | `4784`+ | édition | disabled si lié | panneau | **cellules 38–56px** | ⚠️ AQG-002 |
| Suppr / suppr annotation | `4844`,`4863` | clear | — | conditionnel | 9px icône | cible <44px |
| Confirmer polygone IA | `4892` | ajoute outil | — | dans RoofPolygonAIInline | à confirmer | ⚠️ écrase surface (AQG-004) |
| Hommes / Couv. paquet | `4952`,`4957` | inputs | — | si finalQuote | 48–60px | ok |
| Paramètres métriques | `4961` | ouvre Settings | — | si finalQuote | ok | — |
| Ajouter un poste | `5567` | `addExtraLine` | — | section 4 | pleine largeur | — |
| Valider & pousser QBO (aperçu) | `5627` | `handlePushToQb` | disabled si !ready | section 5 | 52px ✓ | — |
| Modèle e-mail `<select>` + Éditer/Sauver/Nouveau/Défaut/Suppr | `5671`+ | template e-mail | — | section 6 | ok | suppr **destructif** (confirm `834`) |
| Aperçu contrat plein écran | `6451` (trigger ~section 6) | ouvre Dialog | — | section 6 | ok | — |
| Upload PDF (dropzone) | `6500` | file picker | loading | section 9 | pleine largeur ✓ | — |
| Suppr fichier / photo contact | `6556`,`6542` | ops | — | par fichier | petit | — |
| Générer liste matériaux | `6576` | génère | disabled / loading | section 9 | pleine largeur ✓ | — |
| **Télécharger PDF** | `6629` | `handleGeneratePdf` | disabled/loading | actions fixes | 52px ✓ | ⚠️ **bas de page** mobile (AQG-009) |
| **Sauvegarder** (inline) | `6642` | `handleSave` | disabled/loading | **`!isMobile`** | — | masqué mobile (→ barre sticky) |
| **Pousser vers QuickBooks** | `6656` | `handlePushToQb` | disabled/loading | actions fixes | 48px ✓ | ⚠️ **bas de page** mobile |
| Télécharger PDF QB | `6679` | download | — | si résultat | ok | — |
| Drag header config / Fermer config | `6704`,`6715` | drag/close | — | si panneau | close 44×44 mobile ✓ | drag = souris seult |
| Haut de page (sticky) | `7088` | scroll top | — | mobile | 48×48 ✓ | — |
| Sauvegarder (sticky) | `7102` | `handleSave` | disabled si saving | mobile | 48px ✓ | ⚠️ **z-index sur modales** (AQG-001) |
| Toggles collapse sections | `MajorSectionTitle 7135` | `toggleSection` | — | toutes | pleine largeur ✓ | bon (tap target large) |
| Modales QBO : sélection client/devis, importer (ajouter/remplacer), annuler | `6885`–`7066` | import QBO | loading states | si dialog | ok | — |

> Boutons **destructifs sans confirmation** : « Nouveau » (`3673`), « Tout effacer »
> annotations (`4711`), suppression de modèle de soumission (`4544`). « Suppr » modèle
> e-mail a un `confirm()` (`834`).

---

## 5. Audit viewer de soumission (Section 5 — `QuotePreview`)

- **Ouverture/fermeture** : pas une modale — rendu **inline** dans la section 5 (collapse).
  Pas de backdrop, pas de fermeture ; visible tant que la section 5 est dépliée. OK.
- **Rendu mobile** : ⚠️ la page est une **feuille A4 `width: 210mm` (`min-height: 297mm`)**
  (`QuotePreview.tsx:506`), placée dans un conteneur `overflowX:'auto'` (`555`) / `overflow:'auto'`
  (`657`). 210 mm ≈ **794 px** ≫ 360–390 px d'un iPhone. **Aucun `transform: scale()`** pour
  l'ajuster à la largeur → l'aperçu n'est lisible qu'au **scroll horizontal / pinch-zoom**.
  → **Friction mobile majeure** (AQG-003).
- **Pagination interne** : « Page x/2 » (`613`) avec scroll interne `overflow:auto` — OK desktop,
  imbrication de scroll délicate sur mobile.
- **Boutons internes** (notes, exclusions cochables, confirmations) : présents ; cibles petites.
- **État après fermeture** (collapse) : conservé (état React parent). OK.
- **Perte de données** : non — les champs (`quoteNotes`, `paymentTerms`, exclusions) sont
  remontés au parent via callbacks (`5598`+). OK.

---

## 6. Audit viewer de contrat (Section 6 — Dialog plein écran `6451`)

- **Ouverture** : Radix `Dialog`, `DialogContent h-[92vh] w-[96vw] max-w-[96vw]` (`6452`),
  contenu = `iframe srcDoc={contractHtml}` (`6458`).
- **Fermeture** : bouton X Radix par défaut + clic backdrop. OK.
- **Z-index** : Radix `z-50` (`dialog.tsx:39`). ⚠️ Sur mobile, la **barre sticky `zIndex:1000`**
  (`7077`) et le **panneau outils flottant `9990`** passent **au-dessus** de ce dialog (AQG-001).
- **Lisibilité mobile** : le contrat est du HTML à largeur fixe → **scroll horizontal dans
  l'iframe** probable (à confirmer selon le gabarit du contrat). `minHeight: calc(92vh-110px)`.
- **Signature** : gérée par `ContractSignatureStep` (section 8, `6476`) — **non inspecté**
  (à auditer : champs de signature tactile, scroll, boutons sur petit écran).
- **Retour au formulaire** : fermeture du dialog → état conservé. OK.
- **Note historique** : commentaire `6450` « Dialog déplacé HORS de la section 6 pour empêcher
  l'overlay Radix de bloquer les sections 7-8 » → un bug de stacking a déjà été rencontré ici.

---

## 7. Audit collapses / accordions

- **Sections majeures 1–10** : `MajorSectionTitle` (`7135`) = `<button>` pleine largeur,
  `toggleSection(n)`, contenu masqué via `display:'none'` (`3837`, `4571`, etc.).
  **Tap target large et fiable.** Bon point.
- **Persistance** : `collapsedSections` est en état local — non persisté (re-déplié au reload).
  Acceptable.
- ⚠️ **`majorSectionStyle` a `overflow:'hidden'`** (`7202`) : tout contenu absolument
  positionné (dropdown, popover) débordant des bornes d'une section majeure sera **rogné**.
  Risque latent pour les dropdowns proches d'un bord (AQG-011).
- **Outils de mesure (collapse par outil)** : `collapsedMeasureTools` (`4745`), toggle via
  chevron, n'ouvre que si l'outil a une valeur/annotation (`4757`). Logique OK ; cible chevron
  ~11px (petite).
- **Aucun collapse cassé détecté** (pas de hauteur animée bricolée ; `display:none` propre).

---

## 8. Audit dropdowns / selects / menus

- `<select>` **natifs** (Marque, Gamme, Toit, Pente, Pente par outil, Modèle e-mail) :
  bon comportement iOS (roue native). ✓
- **Dropdown couverture (custom, `4377`)** : `position:absolute; top:100%; zIndex:50`,
  `maxHeight:200; overflowY:auto`. ⚠️ **Aucune fermeture au clic extérieur ni au scroll**
  — se ferme uniquement en re-cliquant le bouton (AQG-010). Risque de rognage par
  `overflow:hidden` parent si placé près d'un bord (AQG-011).
- **Dropdown client QB (custom, `3919`)** : `zIndex:50`, fermeture via `onBlur`+timeout 150 ms
  (`3905`) et `onMouseDown` preventDefault (`3928`) → pattern correct tactile. ✓
- **Highlight hover** (`onMouseEnter/Leave`) sur les deux dropdowns custom : **cosmétique,
  sans effet tactile** ; la sélection fonctionne (checkbox/onMouseDown). Mineur (AQG-012).
- **`<select>` pente par outil (`4797`, cellule ~52px)** : avec `font-size:16px !important`
  mobile, le texte d'option déborde la cellule. Lié à AQG-002.

---

## 9. Audit formulaires / inputs

- **Anti-zoom iOS** : règle globale `@media(max-width:600px){ .aqg-root input/select/textarea
  { font-size:16px !important } }` (`3649`). ✓ Empêche le zoom auto iOS — **mais** force 16px
  dans des cellules de **38–56 px** (panneau outils) → **débordement / illisibilité** (AQG-002).
- **inputMode/clavier numérique** : les champs numériques utilisent `type="number"`
  (clavier numérique iOS) ✓, mais **pas de `inputMode="decimal"`** explicite → le clavier
  `number` masque parfois la virgule décimale (fr-CA). Mineur.
- **Labels** : présents (`labelStyle`), parfois `fontSize 7–10` (entêtes colonnes outils
  `4724`) → quasi illisibles mobile. Mineur/majeur selon section.
- **Champs trop étroits** : panneau outils (AQG-002), table config (`6723`, `minWidth 700`),
  table lignes (`5115`, `minWidth 900`).
- **Perte de focus / clavier masquant le champ** : sur mobile, l'ouverture du clavier peut
  cacher la **barre sticky** ou les champs du bas ; pas de `scrollIntoView` au focus. À confirmer.
- **Validation/erreurs** : système de « champs manquants » par section (`MissingFieldsPanel`,
  flash jaune `fieldFlash` `3648`) — bon. Pas de validation de format (e-mail, NEQ) visible.

---

## 10. Audit take-off / roof model

> Rappel : le bouton « 📐 Tracer le toit (3D) » / `TakeoffFullscreen` **n'existe pas encore**
> (Phase 1 non construite). L'intégration actuelle = `RoofPolygonAIInline` + `MapToolbox`
> dans la section 3.

- **Position/visibilité mobile** : la carte (`BuildingReadOnlyMap`) et le panneau d'outils
  s'empilent (`flexDirection:column`, `4581`) ; panneau pleine largeur (`4706`). OK structurellement.
- ⚠️ **Panneau outils — grille 7 colonnes à largeurs fixes** `1fr 56px 52px 42px 38px 44px 16px`
  (`4723`/`4751`) : sur iPhone, ~248px de colonnes fixes + 1fr ; les inputs (`fontSize 8–10`
  forcés à **16px** mobile) **débordent** leurs cellules de 38–44px → valeurs rognées, tap
  difficile (AQG-002, **critique**).
- ⚠️ **Surface IA écrasée** : `RoofPolygonAIInline.onConfirmPolygon` (`4892`) crée un outil
  `toolType:'Surface bâtiment'` avec la surface du toit (areaSqft). Mais l'effet `461`
  **force la `correctedValue` de TOUT outil `Surface bâtiment`** à la **superficie d'empreinte**
  (`superficie`) dès que celle-ci change → **la surface de toit détectée par l'IA est écrasée
  par l'empreinte au sol** (AQG-004, **majeur, correctness**). Unités : m²→pi² gérées, mais la
  valeur source est la mauvaise.
- **Injection superficie/périmètre** : édition du polygone bâtiment (`onBuildingEdited 4674`)
  met à jour `superficie/perimetre` + `areaSqftOverride/perimeterFtOverride`. Cohérent.
- **Conservation des autres champs** : OK pour l'édition de polygone.
- **Comportement si brouillon / réouverture** : `mapAnnotations` **non** persistées dans le
  brouillon mobile (AQG-007) → take-off perdu au reload d'une soumission non sauvegardée.
- **Fermeture accidentelle** : pas de plein écran dédié (donc pas de back-iOS à gérer ici
  aujourd'hui) ; le risque viendra avec `TakeoffFullscreen` (Phase 1).

---

## 11. Audit navigation mobile

- **Back navigateur / swipe iOS** : aucune modale n'utilise `history.pushState` → un retour
  géré OS **ne ferme pas** un Dialog/panneau, il **quitte la page** (`/admin/quote`) et **perd
  l'état non sauvegardé** (sauf brouillon mobile partiel). Friction (AQG-018 lié).
- **Fermeture modale** : Radix gère Échap + backdrop ; le panneau outils flottant et le
  lightbox ont leur propre X. OK individuellement.
- **Body scroll lock** : Radix verrouille le scroll quand un Dialog est ouvert ; le **panneau
  flottant (`6692`) et le lightbox (`3878`) ne verrouillent PAS** le scroll du body → scroll
  d'arrière-plan possible derrière ces overlays plein écran. Mineur.
- **Scroll restoration** : « Haut de page » (`7088`) `scrollTo({top:0})` ; pas de restauration
  de position après fermeture d'overlay. Mineur.
- **Overscroll bounce** : pas de `overscroll-behavior:none` global → rebond iOS possible.
- **Reload** : `?id=` rechargé (`1704`) ✓ ; nouvelle soumission → brouillon mobile partiel (`1722`).

---

## 12. Audit z-index / overlays

Échelle observée (incohérente) :

| Élément | z-index | Réf. |
|---|---|---|
| Sections majeures | 1 / 5 | `7204`,`7145` |
| Dropdowns custom (couverture, QB) | 50 | `4378`,`3921` |
| **Radix Dialog (overlay + content)** | **50** | `dialog.tsx:22,39` |
| **Barre mobile sticky** | **1000** | `7077` |
| Panneau outils flottant | 9990 | `6694` |
| Lightbox satellite | 9999 | `3878` |

⚠️ **Conflit principal (AQG-001, critique)** : `Dialog` Radix = **z-50**. La **barre sticky
(z-1000)** et le **panneau flottant (z-9990)** / **lightbox (z-9999)** sont **au-dessus**.
Conséquences mobiles :
- Quand une modale est ouverte (Settings, **Contrat plein écran**, **Import QBO**, Import
  lignes), la **barre sticky « Sauvegarder » flotte par-dessus** et peut **recouvrir les
  boutons d'action en bas du dialog** (ex. boutons « Ajouter / Remplacer » de l'import QBO
  `7018`, ou le bas du contrat). Le `<button>` sticky reste **cliquable au-dessus de la modale**.
- Si `showToolConfig` (9990) ou le lightbox (9999) est ouvert et qu'une modale s'ouvre, la
  modale est **masquée** par ces panneaux.

---

## 13. Audit performance UX

- **Monolithe 7289 lignes, 187 hooks d'état, styles inline** : chaque frappe re-rend la page
  entière (pas de mémoïsation des sous-arbres ; styles inline = nouveaux objets à chaque
  render). Sur mobile bas de gamme → **latence de saisie probable** dans les champs.
- `finalQuote` est `useMemo` (`2050`) ✓ ; mais `QuotePreview`, le panneau outils et les
  tables ne sont pas mémoïsés.
- **Propagation des outils liés** : plusieurs `useEffect` qui re-`setMeasureTools` sur
  `mapAnnotations`/`perimetre`/`superficie` (`461`, `611`, `645`) → risque de cascades de
  renders pendant le dessin.
- **Google Maps + canvas** : un seul consommateur carto à la fois (mode GPS **ou** manuel) — OK.
- **PDF / `html2canvas` + `jsPDF`** : génération synchrone potentiellement bloquante (freeze)
  sur mobile — à confirmer.
- Pas de lazy-load de la page (`/admin/quote` importée directement, `App.tsx:79`) ; les libs
  lourdes (`html2canvas`, `jspdf`, maps) chargent d'emblée.

---

## 14. Bugs critiques

### AQG-001 — Barre mobile sticky & panneaux flottants AU-DESSUS des modales
- **ID** : AQG-001
- **Sévérité** : critique
- **Zone** : z-index / overlays / navigation mobile
- **Symptôme** : sur mobile, la barre sticky (Save/Haut) reste visible et cliquable
  **par-dessus** un `Dialog` ouvert ; elle peut masquer les boutons d'action en bas du dialog
  (import QBO, contrat). Panneau flottant (9990) / lightbox (9999) masquent toute modale.
- **Cause probable** : `Dialog` Radix en `z-50` (`dialog.tsx:22,39`) vs barre `zIndex:1000`
  (`7077`), panneau `9990` (`6694`), lightbox `9999` (`3878`).
- **Fichier(s)** : `src/pages/AdminQuoteGenerator.tsx:7077,6694,3878` ; `src/components/ui/dialog.tsx:22,39`.
- **Reproduction** : mobile → ouvrir « Importer un devis QuickBooks » (`6885`) ou « Aperçu
  contrat plein écran » (`6451`) → la barre « Sauvegarder » chevauche le bas de la modale.
- **Impact mobile** : peut **bloquer la validation d'actions dans les modales**.
- **Correction recommandée** : masquer la barre sticky quand une modale est ouverte
  (état `anyDialogOpen`), **ou** aligner les z-index (barre < overlay Radix, ou monter les
  dialogs au-dessus de 1000). Idéalement, un système de z-index centralisé (tokens).
- **Risque de correction** : faible–moyen (toucher au rendu conditionnel de la barre ; vérifier
  toutes les modales). **Hors périmètre tant que pas de GO.**

### AQG-002 — Panneau d'outils de mesure illisible/inutilisable sur mobile
- **ID** : AQG-002
- **Sévérité** : critique
- **Zone** : take-off / formulaires
- **Symptôme** : la grille 7 colonnes à largeurs fixes (`1fr 56px 52px 42px 38px 44px 16px`)
  combinée à `font-size:16px !important` (anti-zoom iOS) fait **déborder** inputs et `<select>`
  hors de cellules de 38–56 px ; valeurs rognées, pente/facteur/majoration quasi intouchables.
- **Cause probable** : grille pensée desktop (`4723`,`4751`) non repensée mobile + override 16px
  (`3649`).
- **Fichier(s)** : `src/pages/AdminQuoteGenerator.tsx:4723,4751,4784-4840,3649`.
- **Reproduction** : mobile → section 3 → dérouler un outil avec valeur → éditer pente/facteur/maj.
- **Impact mobile** : **édition du take-off sur téléphone effectivement bloquée**.
- **Correction recommandée** : layout mobile dédié (cartes empilées une ligne = un outil avec
  champs en colonnes/wrap, labels visibles) au lieu de la grille dense ; ou masquer colonnes
  avancées derrière un « détails ».
- **Risque de correction** : moyen (réécriture du rendu du panneau, sans toucher la logique de
  calcul). **Hors périmètre tant que pas de GO.**

---

## 15. Bugs majeurs

### AQG-003 — Aperçu de soumission A4 (210 mm) sans mise à l'échelle mobile
- **Sévérité** : majeure · **Zone** : viewer soumission
- **Symptôme** : aperçu rendu à `width:210mm` (≈794px) en conteneur `overflow:auto` → scroll
  horizontal / pinch obligatoire sur mobile, pas de fit-to-width.
- **Cause** : `QuotePreview.tsx:506` (`.quote-page{width:210mm}`), conteneurs `555/657`.
- **Fichier(s)** : `src/components/QuotePreview.tsx:506,555,657`.
- **Impact mobile** : aperçu difficilement consultable au doigt.
- **Correction recommandée** : `transform: scale(viewportWidth/794)` + `transform-origin: top left`
  sur wrapper mobile, ou conteneur `zoom`/CSS responsive. **Risque** : moyen (impacte impression/PDF
  si mal isolé — à scoper hors `@media print`).

### AQG-004 — Surface de toit IA écrasée par l'empreinte au sol
- **Sévérité** : majeure (correctness) · **Zone** : take-off / roof model
- **Symptôme** : la surface confirmée via `RoofPolygonAIInline` (outil `Surface bâtiment`,
  `4892`) est remplacée par `superficie` (empreinte) par l'effet `461` dès recalcul.
- **Cause** : l'effet auto-remplit **tous** les outils `Surface bâtiment` depuis `superficie`.
- **Fichier(s)** : `src/pages/AdminQuoteGenerator.tsx:461-489,4892-4907`.
- **Reproduction** : confirmer un polygone IA → modifier le bâtiment (ou tout recalcul de
  superficie) → la valeur de l'outil IA bascule sur l'empreinte.
- **Impact mobile** (et desktop) : **mauvaise surface → mauvais prix**.
- **Correction recommandée** : distinguer la source (`auto-empreinte` vs `IA/manuel`) ; ne
  pas écraser les outils marqués IA/manuel. **Risque** : moyen (logique de quantification).

### AQG-005 — Fuite d'état entre soumissions (chargement sans réinitialisation)
- **Sévérité** : majeure · **Zone** : navigation / état
- **Symptôme** : charger une soumission B après A **sans** « Nouveau » conserve les valeurs de A
  pour tout champ absent de B : `areaSqftOverride` (`1459` set seulement si `s.area_sqft`),
  `measure_tools` (`1508` seulement si présents), `lineOverrides` (`1479` seulement si `db.lines`).
- **Cause** : `loadSoumission` (`1431`) n'appelle pas un reset complet avant de remplir.
- **Fichier(s)** : `src/pages/AdminQuoteGenerator.tsx:1431-1520,1459,1479,1508`.
- **Impact** : quantités/prix d'une autre soumission **silencieusement reportés**.
- **Correction recommandée** : `resetForm()` (ou reset ciblé) en début de `loadSoumission`.
  **Risque** : moyen (s'assurer que les champs effectivement chargés ne sont pas ré-effacés).

### AQG-006 — Bandeau métriques non responsive (débordement horizontal)
- **Sévérité** : majeure · **Zone** : structure / overflow
- **Symptôme** : adresse + 4 métriques en flex `nowrap` `gap:16` sans `isMobile` → débordement
  horizontal sur iPhone étroit, possible scroll horizontal de page.
- **Cause** : `3779-3822` sans variante mobile (contrairement au reste de la page).
- **Fichier(s)** : `src/pages/AdminQuoteGenerator.tsx:3779-3822`.
- **Impact mobile** : barre coupée / page qui scrolle latéralement.
- **Correction recommandée** : `flexWrap`/grille mobile, ou réduire à 2 métriques + repli.
  **Risque** : faible.

### AQG-007 — Brouillon incomplet + aucun brouillon desktop
- **Sévérité** : majeure · **Zone** : persistance / état perdu
- **Symptôme** : le brouillon mobile (`1717`) **ne** sauvegarde **pas** `mapAnnotations` ni les
  valeurs mesurées par outil ; **aucun** brouillon sur desktop. Reload/crash d'une soumission
  non sauvegardée → take-off perdu.
- **Cause** : `1758-1789` (sous-ensemble de champs), garde `if(!isMobile) return` (`1759`).
- **Fichier(s)** : `src/pages/AdminQuoteGenerator.tsx:1717-1789`.
- **Impact** : perte de travail de mesure.
- **Correction recommandée** : inclure annotations/outils dans le brouillon ; étendre au desktop.
  **Risque** : moyen (volume localStorage, sérialisation des annotations).

### AQG-008 — Outils de mesure persistés globalement (fuite inter-session)
- **Sévérité** : majeure · **Zone** : persistance / état
- **Symptôme** : `measureTools` est lu/écrit dans **localStorage global** `roof_measure_tools`
  (`336`,`365`), restauré au montage — les **valeurs** d'une session précédente réapparaissent
  pour une nouvelle visite/soumission tant que rien n'a été chargé/réinitialisé.
- **Cause** : clé localStorage non liée à la soumission.
- **Fichier(s)** : `src/pages/AdminQuoteGenerator.tsx:336-353,364-366`.
- **Impact** : valeurs résiduelles trompeuses.
- **Correction recommandée** : ne persister globalement que la **config** (sans valeurs), ou clé
  par soumission. **Risque** : moyen.

### AQG-009 — Actions primaires (PDF / QBO) enterrées en bas sur mobile
- **Sévérité** : majeure · **Zone** : navigation mobile
- **Symptôme** : la barre sticky mobile n'expose que **Save + Haut de page** ; « Télécharger PDF »
  et « Pousser vers QuickBooks » sont **inline en bas** d'une page très longue (`6627`,`6656`),
  le Save inline étant masqué mobile (`6642 !isMobile`).
- **Fichier(s)** : `src/pages/AdminQuoteGenerator.tsx:6627-6668,7072-7127`.
- **Impact mobile** : long scroll pour des actions clés.
- **Correction recommandée** : menu d'actions secondaires dans la barre sticky (ou bouton
  « Actions » qui déplie PDF/QBO). **Risque** : faible–moyen.

---

## 16. Bugs mineurs

- **AQG-010** (mineure, dropdowns) : dropdown couverture (`4377`) sans fermeture au clic
  extérieur/scroll. → ajouter un handler `pointerdown` document.
- **AQG-011** (mineure, overflow) : `majorSectionStyle` `overflow:hidden` (`7202`) peut **rogner**
  un dropdown/popover près d'un bord de section. → portail ou retirer l'overflow sur sections
  contenant des dropdowns.
- **AQG-012** (mineure, dropdowns) : highlight `onMouseEnter/Leave` cosmétique, sans effet
  tactile (`3933`,`4383`). → état `:active`/focus tactile.
- **AQG-013** (mineure→majeure, tables) : tables à `minWidth` (load `600` `3713`, modèles `700`
  `4487`, lignes `900` `5115`, config `700` `6723`) → scroll horizontal mobile. La **table des
  lignes (900)** est une surface d'édition centrale → friction notable. → vue carte mobile.
- **AQG-014** (mineure, z-index) : panneau flottant (`9990`) et lightbox (`9999`) au-dessus des
  modales (corollaire d'AQG-001).
- **AQG-015** (mineure, cibles tactiles) : nombreux boutons icône < 44px (toggle GPS/Manuel 34×18
  `4592`, règle 22×22 `4770`, archive/suppr/rafraîchir, actions modèles fontSize 9). → agrandir
  à ≥44px mobile.
- **AQG-016** (mineure, scroll lock) : panneau flottant et lightbox ne verrouillent pas le scroll
  du body. → `overflow:hidden` body à l'ouverture.
- **AQG-017** (mineure, navigation) : modales non liées à l'historique → back iOS quitte la page.
  → `history.pushState`/`popstate` (pertinent surtout pour le futur `TakeoffFullscreen`).
- **AQG-018** (mineure, contrat) : iframe contrat (`6458`) probablement à largeur fixe → scroll
  horizontal dans l'iframe sur mobile (à confirmer selon gabarit).

---

## 17. Corrections recommandées (synthèse)

1. **Z-index centralisé** : tokens (`--z-base/dropdown/sticky/modal/overlayTop`) ; barre sticky
   masquée si modale ouverte ; dialogs au-dessus de la barre. (AQG-001, 014)
2. **Panneau outils mobile** : remplacer la grille 7-col par des cartes empilées une-ligne-par-outil
   avec champs en wrap + labels. (AQG-002)
3. **QuotePreview** : wrapper `scale` fit-to-width sur mobile (hors `@media print`). (AQG-003)
4. **Quantification** : marquer la source des outils `Surface bâtiment` (empreinte vs IA/manuel)
   et ne pas écraser. (AQG-004)
5. **`loadSoumission`** : reset complet avant remplissage. (AQG-005)
6. **Bandeau métriques** : variante mobile (wrap/grille). (AQG-006)
7. **Brouillon** : inclure annotations/outils, étendre au desktop ; clé par soumission. (AQG-007, 008)
8. **Barre sticky** : exposer PDF/QBO via menu d'actions. (AQG-009)
9. **Polish** : fermeture dropdowns hors-clic, cibles ≥44px, scroll-lock overlays, vues mobiles
   des tables. (AQG-010→018)

---

## 18. Plan de correction par priorité

| Priorité | Items | Justification |
|---|---|---|
| **P0 — bloque l'usage mobile** | AQG-001 (z-index modales), AQG-002 (panneau outils) | Empêchent de compléter des actions / d'éditer le take-off au doigt |
| **P1 — nuit fortement au terrain** | AQG-003 (aperçu A4), AQG-004 (surface IA écrasée), AQG-005 (fuite d'état), AQG-006 (bandeau), AQG-007 (brouillon) | Lisibilité, exactitude des prix, perte de données |
| **P2 — friction modérée** | AQG-008 (persistance globale), AQG-009 (actions enterrées), AQG-013 (tables), AQG-015 (cibles tactiles) | Ralentit sans bloquer |
| **P3 — polish** | AQG-010, 011, 012, 014, 016, 017, 018 | Confort / robustesse |

Ordre conseillé : P0 (AQG-001 puis 002) → P1 exactitude (004, 005) → P1 lisibilité (003, 006, 007)
→ P2 → P3. Chaque correctif isolé, derrière revue, **après GO**.

---

## 19. Liste des choses à NE PAS modifier

- **Logique de calcul** `finalQuote`/`computeDynastyQuote`/pricing (`2050`+, `dynasty-calculator`)
  — hors périmètre UI ; ne pas toucher en corrigeant l'affichage.
- **roof-core / TakeoffFullscreen** (n'existe pas encore) — interdiction explicite.
- **Supabase / migrations / templates** — interdiction explicite.
- **Génération PDF** (`pdf-generators`, `html2canvas`, `jsPDF`) et le **CSS `@media print`** de
  `QuotePreview` — le fit-to-width mobile (AQG-003) doit être **isolé de l'impression/PDF**.
- **Comportements desktop validés** (« le style est déjà clean ») — les correctifs doivent être
  **mobile-scoped** (`@media`/`isMobile`) pour ne pas régresser le desktop.
- **Composants externes non audités** (`MapToolbox`, `RoofPolygonAIInline`, `ContractSignatureStep`,
  `PlanViewer`, `BuildingReadOnlyMap/Picker`) — à auditer avant toute modification.

---

## 20. GO / NO-GO mobile terrain

**NO-GO conditionnel pour usage terrain mobile complet (édition de soumission au téléphone).**

- **Consultation/lecture** d'une soumission existante sur mobile : acceptable (avec friction
  d'aperçu A4).
- **Création/édition de take-off + envoi via modales** sur mobile : **bloqué/risqué** par AQG-001
  (z-index modales) et AQG-002 (panneau outils), avec risque d'exactitude (AQG-004/005).

**Condition de passage en GO** : corriger **AQG-001 + AQG-002** (P0) et **AQG-004 + AQG-005**
(exactitude P1). Les autres P1/P2/P3 peuvent suivre en itérations.

---

*Audit uniquement. Aucune ligne de code, de style, de composant ou de migration modifiée.
En attente d'un GO explicite pour engager une phase de correction (priorisée P0→P3).*
