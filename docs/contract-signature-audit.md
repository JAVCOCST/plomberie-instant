# Audit — ContractSignatureStep (mobile + signature tactile)

- **Date** : 2026-05-30
- **Auditeur** : construction@javcoimmobilier.com
- **Branche** : `claude/audit-contract-signature-TExhe`
- **Périmètre** : `src/components/admin/ContractSignatureStep.tsx` (éditeur admin, section 8 de
  `AdminQuoteGenerator`, monté à `src/pages/AdminQuoteGenerator.tsx:6821`), la page signataire
  `src/pages/SignContract.tsx` (route `/sign/:token`), et les Edge Functions
  `contract-signature-{send,public,remind,void}`.
- **Mode** : **lecture seule**. Aucune modification de code. Ce document est le seul livrable.

> ⚠️ **ESCALADE SÉCURITÉ** — Un trou de sécurité **critique** a été identifié (voir §6,
> bug **SEC-1**) et signalé immédiatement à l'utilisateur avant la fin de l'audit. Décision
> retenue : rester en lecture seule, documenter uniquement. Le correctif est décrit mais
> **non appliqué**.

---

## Résumé exécutif

| # | Bug | Sévérité | Fichier:ligne |
|---|-----|----------|---------------|
| SEC-1 | Endpoints admin `send`/`void`/`remind` appelables **sans authentification** | **Critique** | `config.toml:64,70,73` + `contract-signature-{send,void,remind}/index.ts` |
| SEC-2 | Bucket `contract-signatures` public + URL de signature persistante non signée | Mineure | `migrations/20260522000000_…sql:3-9` |
| SEC-3 | Le `get` public divulgue IP / user-agent / image de signature des **co-signataires** | Mineure | `contract-signature-public/index.ts:51-53,87` |
| PDF-1 | Aucun PDF signé n'est généré ni stocké : `signed_pdf_url` jamais renseigné | **Majeure** | `contract-signature-public/index.ts` (absent) ; `ContractSignatureStep.tsx:942` |
| PDF-2 | « Télécharger PDF » = `window.open` + `window.print()` : non fiable sur iOS (popups) | Majeure | `ContractSignatureStep.tsx:534-538` |
| CNV-1 | `toDataURL('image/png')` appelé à **chaque** `pointermove` → jank du tracé sur iPhone | Majeure | `SignContract.tsx:142` |
| CNV-2 | Canvas non ré-initialisé sur rotation/`resize` → tracé décalé après rotation | Majeure | `SignContract.tsx:50-54,113-119` |
| CNV-3 | Aucun **undo** (seulement « Effacer » qui remet tout à zéro) | Mineure | `SignContract.tsx:185-191` |
| CNV-4 | Réutilisation de la signature entre pad inline et plein écran → distorsion (ratios ≠) | Mineure | `SignContract.tsx:125-129` |
| STATE-1 | État de l'éditeur (signataires, champs, sujet, message) **perdu au rechargement** | Majeure | `AdminQuoteGenerator.tsx:1889-1898` |
| STATE-2 | Champs signataire **absents** de l'autosave « Vague A » | Majeure | `AdminQuoteGenerator.tsx:1889-1898` |
| MOB-1 | `user-scalable=no` global empêche le zoom sur le contrat signé (lisibilité) | Mineure | `index.html:5` |
| MOB-2 | Champs signataire admin sans `autoComplete` (suggestions iOS incohérentes) | Mineure | `ContractSignatureStep.tsx:618-620` |
| FLOW-1 | `consent: true` codé en dur à l'envoi côté signataire | Mineure | `SignContract.tsx:208` |

---

## 1. Signature tactile (canvas, qualité iPhone, undo, clear)

La signature est dessinée sur la **page signataire** `SignContract.tsx`, pas dans le composant admin.

**Ce qui est correct :**
- Mise à l'échelle DPR (`SignContract.tsx:116-120`) : `c.width = rect.width * dpr`, `ctx.scale(dpr,dpr)` →
  rendu net sur écrans Retina.
- `lineWidth` adapté mobile (`:122`, 3.2 vs 2.4), `lineCap/lineJoin = 'round'` → tracé propre.
- `touchAction:'none'` sur le canvas (`:328`, `:509`) → pas de scroll parasite pendant le tracé.
- `touchstart/touchmove` avec `{ passive:false }` (`:146-147`) + `e.preventDefault()` → bon comportement tactile.
- Pad **plein écran** mobile (`FullscreenSignaturePad`, `:467-531`) avec verrou de scroll body (`:164-165`).

### CNV-1 — `toDataURL` à chaque déplacement (Majeure)
- **Fichier** : `SignContract.tsx:142`
- **Repro** : sur iPhone, signer rapidement. À chaque `mousemove`/`touchmove`, `setSignatureData(c.toDataURL('image/png'))`
  est appelé. `toDataURL` sérialise tout le bitmap (Retina = `rect.width*2 × rect.height*2` px) en PNG base64
  **à chaque frame de tracé** + déclenche un re-render React. Sur un canvas plein écran cela peut faire chuter
  le framerate → tracé saccadé/anguleux.
- **Correctif** : ne pas appeler `toDataURL` dans `move()`. Mettre un flag `dirty=true`, exporter une seule fois
  dans `up()` (fin du trait), ou debouncer via `requestAnimationFrame`. `canContinue`/`hasSignature` peuvent
  s'appuyer sur un booléen « a dessiné » plutôt que sur la dataURL.

### CNV-2 — Canvas non recalibré sur rotation (Majeure)
- **Fichier** : `SignContract.tsx:50-54` (listener `resize` ne met à jour que `isMobile`) ; `:113-119`
  (`attachSigPad` lit `getBoundingClientRect()` **une seule fois** à l'attache, deps `[step, fullscreenPad]`).
- **Repro** : ouvrir `/sign/:token`, aller à l'étape « Signature », faire pivoter l'iPhone (portrait→paysage).
  Le CSS du canvas se redimensionne mais `canvas.width/height` (bitmap) et la transformation `ctx.scale` restent
  ceux de l'orientation initiale. `pos()` calcule `clientX - rect.left` avec le **nouveau** rect → les coordonnées
  du tracé ne correspondent plus au système de coordonnées du bitmap → trait décalé/déformé.
- **Correctif** : ré-attacher/recalibrer le canvas sur `resize`/`orientationchange` (réintroduire la dépendance
  dans le `useEffect` ou un `ResizeObserver`), en re-rejouant la signature existante après recalibrage.

### CNV-3 — Pas d'undo (Mineure)
- **Fichier** : `SignContract.tsx:185-191` (`clearSig`)
- **Constat** : seul « Effacer » existe ; il efface **toute** la signature. Le point d'audit demandait
  explicitement un *undo*. Aucun historique de traits n'est conservé.
- **Correctif** : conserver une pile de traits (tableau de polylignes) et redessiner ; bouton « Annuler »
  retirant le dernier trait. Coût modéré (refactor du modèle de tracé).

### CNV-4 — Distorsion inline ↔ plein écran (Mineure)
- **Fichier** : `SignContract.tsx:125-129`
- **Repro** : dessiner dans le pad inline (ratio ~ largeur×180px), ouvrir « Signer en grand » (ratio plein écran
  très différent). À l'attache, la signature est rejouée via `drawImage(img, 0,0, rect.width, rect.height)` →
  étirée au nouveau ratio → signature déformée. Idem au retour.
- **Correctif** : stocker la signature avec son ratio d'origine et la rejouer en `object-fit: contain` (lettrage
  centré), ou imposer un seul ratio de pad.

---

## 2. Champs signataire (validation, autocomplete iOS, tap targets)

Côté **admin** (`ContractSignatureStep.tsx:606-629`) — configuration des signataires.

**Correct :**
- `type="email" inputMode="email" autoCapitalize="off" autoCorrect="off"` (`:619`) et `type="tel" inputMode="tel"`
  (`:620`) → bons claviers iOS.
- Tap targets mobile : inputs `minHeight:44`, `fontSize:16` (`:555-558`) → évite le zoom auto iOS et respecte
  la cible tactile 44px. Boutons supprimer/ajouter à 44/48px (`:626,629`).
- Validation d'envoi : au moins un signataire avec `@` (`:348-352`).

### MOB-2 — Pas d'`autoComplete`/`name` sur les champs signataire (Mineure)
- **Fichier** : `ContractSignatureStep.tsx:618-620`
- **Constat** : les `<input>` nom/courriel/téléphone n'ont ni `name` ni `autoComplete` (`name`, `email`, `tel`).
  iOS propose ses suggestions de contacts de façon incohérente.
- **Correctif** : ajouter `autoComplete="name|email|tel"` (et éventuellement `name=…`) sur chaque champ.

**Note validation (Mineure)** : `expiresInDays` accepte n'importe quel entier ≥ 1 (`:830`) ; aucun plafond.
La validation du courriel est laxiste (`includes('@')`, `:348`). Sans gravité.

---

## 3. Flow d'envoi (email signataire → attente → « signé »)

Chaîne : admin `handleSend` (`ContractSignatureStep.tsx:343-387`) → Edge `contract-signature-send`
→ insert `requests`/`signers`/`fields` + emails Resend → signataire ouvre `/sign/:token` →
Edge `contract-signature-public?action=get` (marque `viewed`) → `action=submit` (marque `signed`,
recalcule `progress_percent`, passe à `partially_signed`/`completed`).

**Correct :**
- Recalcul de progression et statut serveur-side (`contract-signature-public/index.ts:156-165`).
- Realtime sur `requests` + `signers` (`ContractSignatureStep.tsx:180-187`) → le suivi se met à jour en direct.
- Email de complétion à l'admin quand `signed === total` (`…public/index.ts:168-181`).
- Étiquettes de statut complètes (`STATUS_LABELS`, `:983-994`).

**Remarques :**
- Envoi des emails « best-effort » : si `RESEND_API_KEY` manque, la requête est créée mais **aucun email** n'est
  envoyé (`…send/index.ts:116`) ; l'admin voit « envoyé à 0 signataire(s) ». Acceptable mais peu explicite.
- L'email de complétion est codé en dur vers `info@toituresvb.ca` (`…public/index.ts:175`), indépendamment du
  propriétaire de la soumission. À vérifier si multi-utilisateurs.

---

## 4. Reprise si le signataire ferme l'onglet en plein signing

**Le lien reste valide** — bon comportement :
- Le `signer_token` est persistant (`migrations:61`). Tant que `status !== 'signed'` et que la demande n'est ni
  `voided` ni expirée, ré-ouvrir `/sign/:token` recharge la page (`SignContract.tsx:57-80`).
- À l'ouverture, si `status === 'signed'`, on saute directement à l'écran « done » (`:76`). Sinon le signataire
  recommence le parcours. Aucune corruption d'état serveur.

**Limite (Mineure, attendue)** : la signature dessinée et les valeurs saisies vivent uniquement dans l'état React
(`signatureData`, `values`, `:33-36`). Fermer l'onglet **avant** `submit` perd le travail en cours ; il faut
re-signer. Le lien fonctionne, mais aucune sauvegarde brouillon côté signataire. Acceptable pour un parcours court.

---

## 5. PDF du contrat signé (génération, stockage, lien persistant)

### PDF-1 — Aucun PDF signé n'est généré ni stocké (Majeure)
- **Fichiers** : colonne `signed_pdf_url` définie (`migrations/20260522000000_…sql:29`), **jamais écrite** par
  aucune Edge Function ni le client (vérifié : aucune occurrence d'écriture dans `supabase/` ni `src/`).
  L'UI conditionne le lien « PDF signé » sur `r.signed_pdf_url` (`ContractSignatureStep.tsx:942-946`) → **ce lien
  n'apparaît jamais**.
- **Impact** : il n'existe **aucun artefact PDF immuable** du contrat signé stocké dans Supabase. Seules les
  **images PNG de signature** sont stockées (`…public/index.ts:119-123`). Le « contrat signé » est reconstruit à
  la volée côté client (HTML + overlays) au moment du téléchargement. Problème d'archivage légal / d'intégrité de
  preuve : rien ne fige le document signé.
- **Correctif** : générer un PDF côté serveur à la complétion (Edge Function dédiée : HTML contrat + overlays +
  certificat → PDF), l'uploader dans le bucket et renseigner `signed_pdf_url`. À défaut, au minimum figer le
  `contract_html` final + overlays dans un blob immuable horodaté.

### PDF-2 — Téléchargement par impression non fiable sur mobile (Majeure)
- **Fichier** : `ContractSignatureStep.tsx:448-542` (`downloadContract`), spécifiquement `:534-538`.
- **Repro** : sur iPhone, onglet « Suivi » → « Télécharger PDF ». La fonction crée un Blob HTML, `window.open(url)`
  puis auto-`window.print()` (`:529`). Sur iOS Safari, `window.open` vers un blob est souvent bloqué (popup) →
  toast « Veuillez autoriser les fenêtres pop-up », et `window.print()` sur blob est peu fiable.
- **Correctif** : générer le PDF côté serveur (voir PDF-1) et offrir un lien de téléchargement direct, plutôt que
  de dépendre de `window.print()` dans un onglet popup.

**Note** : le certificat d'authenticité (journal d'événements, IP, UA) est bien rendu côté signataire
(`SignContract.tsx:693-788`) et dans le HTML imprimable admin (`:511-528`) — bonne traçabilité, mais non figée en PDF.

---

## 6. Sécurité — un signataire peut-il accéder au contrat d'un autre ? URL devinable ?

### Réponse au point 6 (vecteur « URL devinable ») : **NON vulnérable**
- `signer_token = rndToken(20)` (20 octets, `…send/index.ts:83`) et `access_token = rndToken(24)` (24 octets,
  `:54`), générés via `crypto.getRandomValues` (`:8-12`) → 160–192 bits d'entropie. **Non devinables / non
  énumérables.**
- Le `get`/`submit` public sont strictement bornés par `signer_token` (`…public/index.ts:37,106`) : un signataire
  ne voit que **sa** demande. Aucun IDOR : pas de paramètre `request_id` accepté directement côté lecture/écriture
  signataire. Les UUID de `requests`/`signers` sont `gen_random_uuid()`.
- RLS activée sur les 4 tables (`migrations:105-117`) ; les signataires (non authentifiés) ne touchent jamais la
  base directement, uniquement via l'Edge Function en `service_role`.

### SEC-1 — Endpoints admin de mutation appelables SANS authentification (CRITIQUE) ⚠️ ESCALADÉ
- **Fichiers** :
  - `supabase/config.toml:64,70,73` → `verify_jwt = false` pour `contract-signature-send`, `-remind`, `-void`.
  - `contract-signature-send/index.ts:21-32`, `contract-signature-void/index.ts:6-12`,
    `contract-signature-remind/index.ts:12-18` → seul `assertOrigin(req)` est appelé ; **jamais** `runAdminGuards`
    (qui, lui, vérifie le JWT — utilisé par `quickbooks-*`, `google-calendar-*`).
  - `_shared/hardening.ts:70-74` : `assertOrigin` renvoie `true` **quand l'en-tête `Origin` est absent**
    (`if (!origin || origin === "null") return true`).
- **Cause** : `verify_jwt=false` désactive la vérification du JWT par la passerelle Supabase, et le code applicatif
  ne re-vérifie aucune identité. La seule barrière est `Origin`, en-tête posé uniquement par les navigateurs : un
  client non-navigateur (curl, script serveur) l'omet → `assertOrigin` passe.
- **Repro** (conceptuelle, non exécutée — lecture seule) :
  ```
  # Envoi d'email arbitraire depuis le domaine vérifié de l'entreprise, sans aucun login :
  curl -X POST "$SUPABASE_URL/functions/v1/contract-signature-send" \
    -H "apikey: <ANON_KEY_publique_extraite_du_bundle_JS>" \
    -H "Authorization: Bearer <ANON_KEY>" \
    -H "Content-Type: application/json" \
    --data '{"contractHtml":"<p>…</p>","subject":"Phishing","message":"…",
             "signers":[{"name":"X","email":"victime@exemple.com","role":"client"}]}'
  # (pas d'en-tête Origin → assertOrigin renvoie true → email envoyé via Resend depuis contrats@toituresvb.ca)
  ```
- **Impact** :
  1. **`send`** : relais d'emails non authentifié depuis le domaine vérifié `contrats@toituresvb.ca` vers
     n'importe quel destinataire, avec sujet/message/contenu contrôlés → **phishing/spam** au nom de l'entreprise,
     atteinte à la réputation du domaine d'envoi (Resend) ; écritures DB non bornées (création de demandes).
  2. **`void`** : quiconque connaît un `requestId` (UUID) peut **annuler n'importe quel contrat**. Or un
     signataire légitime obtient `request.id` via le `get` public (`…public/index.ts:78`) → un signataire peut
     saboter la demande.
  3. **`remind`** : quiconque connaît un `requestId` peut déclencher des emails de rappel → **email-bombing** des
     signataires.
- **Correctif recommandé (non appliqué)** : appliquer `runAdminGuards(req, corsHeaders)` (vérification du JWT
  Supabase, déjà présent dans `_shared/hardening.ts:145-183`) en tête de `send`/`void`/`remind`, comme le font
  `quickbooks-*`/`google-calendar-*`. `verify_jwt=false` doit rester (les fonctions sont appelées avec une session
  utilisateur, pas seulement l'anon), mais la garde applicative doit rejeter toute requête sans session admin
  valide. Pour `void`/`remind`, vérifier en plus que l'utilisateur a le droit sur la `soumission`/`request` ciblée.

### SEC-2 — Bucket de signatures public, URL non signée (Mineure)
- **Fichiers** : `migrations/20260522000000_…sql:3-5` (`public: true`), `:7-9` (lecture publique) ; URL via
  `getPublicUrl` (`…public/index.ts:123`) au chemin `signatures/{request_id}/{signer_id}.png`.
- **Constat** : les images de signature sont accessibles publiquement via une URL stable. Les UUID rendent l'URL
  non énumérable en pratique, mais une image de signature divulguée (ex. via le certificat) reste accessible
  indéfiniment sans jeton.
- **Correctif** : bucket privé + URLs **signées** à durée limitée (`createSignedUrl`), ou au minimum confirmer que
  l'exposition publique des images de signature est acceptable juridiquement.

### SEC-3 — Divulgation des co-signataires dans le `get` public (Mineure)
- **Fichier** : `…public/index.ts:51-53` puis `:87` (renvoie `allSigners` avec `ip_address`, `user_agent`,
  `signature_image_url`).
- **Constat** : chaque signataire, via son propre jeton, reçoit l'IP, le user-agent et l'image de signature des
  **autres** signataires de la même demande. C'est utile pour le certificat, mais expose des données personnelles
  des co-parties.
- **Correctif** : ne renvoyer les IP/UA/images des autres signataires qu'une fois la demande **complétée** (ou les
  omettre du `get` en cours de signature).

---

## 7. Comportement mobile (viewport, scroll, clavier, safe-area)

**Correct :**
- Page signataire : `env(safe-area-inset-bottom)` sur les barres d'action collantes (`SignContract.tsx:453,515`)
  et `safe-area-inset-top` sur l'en-tête plein écran (`:481`). Bonnes pratiques iPhone (encoche / home indicator).
- Iframe contrat avec viewport responsive + media query mobile dédiée (`:86-99`).
- Inputs signataire `fontSize:16`/`minHeight:48` (`SignContract.tsx:349,394`) → pas de zoom auto, cibles correctes.

### MOB-1 — `user-scalable=no` global gêne la lecture du contrat (Mineure)
- **Fichier** : `index.html:5` (`maximum-scale=1.0, user-scalable=no, viewport-fit=cover`).
- **Constat** : sur la page signataire, l'utilisateur ne peut **pas zoomer** pour lire les clauses fines du
  contrat dans l'iframe (l'iframe réinjecte d'ailleurs `maximum-scale=1`, `SignContract.tsx:87`). Problème
  d'accessibilité/lisibilité sur petit écran, et potentiellement de validité du consentement (le signataire doit
  pouvoir lire ce qu'il signe).
- **Correctif** : pour la route `/sign/:token`, autoriser le zoom (`user-scalable=yes`, retirer `maximum-scale`),
  ou rendre le contenu du contrat zoomable indépendamment.

**Note** : la section 8 admin n'applique pas de `safe-area` propre (hérite de `sectionStyle`,
`AdminQuoteGenerator.tsx:284`), mais elle est inline dans le flux, sans barre collante → impact faible.

---

## 8. État perdu si fermeture en plein remplissage (côté admin)

### Constat principal — Section 8 n'est PAS une modale
- **Fichier** : `AdminQuoteGenerator.tsx:6817-6830`. La section est un **bloc repliable** inline
  (`display: collapsedSections[8] ? 'none' : 'block'`, `:6820`), pas une modale fermable (pas de X, pas d'overlay,
  pas d'Escape).
- **Replier/déplier** : le composant **n'est pas démonté** (juste masqué en CSS) → l'état interne (signataires,
  champs placés, sujet, message) **survit** au repli/dépli. Bon point.

### STATE-1 — État perdu au rechargement / à la navigation (Majeure)
- **Fichiers** : l'état vit dans `ContractSignatureStep` (`useState`, `:108-137`). Aucune persistance
  (localStorage/serveur) de cet état avant l'envoi.
- **Repro** : configurer 2 signataires + 5 champs + un message personnalisé, **recharger la page** (ou naviguer
  ailleurs et revenir) → tout est réinitialisé aux valeurs par défaut (`:108-122`). Les champs placés sur le
  contrat sont perdus.
- **Correctif** : persister l'état de l'éditeur (signataires + `fields` + sujet/message) en localStorage par
  `soumissionId`, ou comme « brouillon de demande » serveur, restauré au montage.

---

## 9. Compatibilité autosave « Vague A » (champs signataire dans le brouillon ?)

### STATE-2 — Les champs signataire NE SONT PAS dans le brouillon (Majeure)
- **Fichier** : `AdminQuoteGenerator.tsx:1889-1898` (objet `draft`), clé `quote_generator_draft_v1` (`:1844`).
- **Constat** : l'autosave « Vague A » :
  - n'est actif **que sur mobile**, **que pour les nouvelles soumissions** (sans `loadedId`), debounce 400 ms
    (`:1883-1914`) ;
  - sérialise uniquement : adresse, client (prénom/nom/courriel/téléphone/entreprise/NEQ/adresse postale),
    type de travaux/toit/pente, surfaces, sélections produit, notes, modalités de paiement, `_ts`.
  - **N'inclut PAS** : les signataires de l'éditeur de signature, les champs de signature placés, le sujet/message
    de l'email de signature, `expiresInDays`. Le `contractHtml` (étape 7) n'est pas non plus dans le brouillon
    (regénéré via `buildContractHtml`, `AdminQuoteGenerator.tsx:2530-2691`).
- **Impact** : combiné à STATE-1, toute la configuration de signature est volatile et hors périmètre de
  récupération « Vague A ». Sur desktop, **aucun** autosave ne couvre la section 8.
- **Correctif** : étendre l'objet `draft` (ou un brouillon dédié) pour inclure l'état de l'éditeur de signature,
  et activer la persistance aussi sur desktop pour cette section.

---

## Annexe — Fichiers examinés

- `src/components/admin/ContractSignatureStep.tsx` (éditeur admin, 1006 l.)
- `src/pages/SignContract.tsx` (page signataire `/sign/:token`, 816 l.)
- `src/pages/AdminQuoteGenerator.tsx` (intégration section 8 `:6817-6830`, autosave `:1844-1914`, contrat `:2530-2691`)
- `supabase/functions/contract-signature-send/index.ts`
- `supabase/functions/contract-signature-public/index.ts`
- `supabase/functions/contract-signature-remind/index.ts`
- `supabase/functions/contract-signature-void/index.ts`
- `supabase/functions/_shared/hardening.ts`
- `supabase/config.toml`
- `supabase/migrations/20260522000000_contract_signature_system.sql` (+ `…20260523000000_…retry.sql`)
- `index.html`
