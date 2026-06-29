# Audit sécurité — Edge Functions Supabase (QuickBooks / Email)

> **Audit read-only.** Aucune modification de code, aucun déploiement, aucune
> migration. Ce document est le seul livrable. Portée : les fonctions Edge
> appelées depuis `AdminQuoteGenerator` qui poussent des données vers QuickBooks
> Online (QBO) ou envoient des courriels. Revue statique du code source au commit
> de la branche `claude/audit-edge-functions-7Ze9I`.

---

## 0. Résumé exécutif

| # | Finding | Sévérité | Fonction(s) |
|---|---|---|---|
| **F1** | « Admin guard » ne vérifie **aucun rôle** — authentification ≠ autorisation | **Majeure** (Critique si signup public activé) | create-customer, push-invoice, sync, auth |
| **F2** | `send-quote-email` = **relais courriel ouvert** (aucun JWT, `to`/`cc`/`bcc`/sujet/corps contrôlés par l'appelant) + PATCH `soumissions` arbitraire | **Majeure** | send-quote-email |
| **F3** | `push-invoice` : **aucune idempotence**, chaque appel crée un nouvel Estimate QBO | **Majeure** | push-invoice |
| **F4** | Statut RLS de `quickbooks_tokens` **non vérifiable** dans les migrations (tokens long-lived en clair) | **Majeure** (à confirmer) | toutes les QBO |
| **F5** | create-customer : idempotence par `DisplayName` → fenêtre de course + correspondance fragile | **Mineure** | create-customer |
| **F6** | Validation d'input absente (email, téléphone, **NEQ**) | **Mineure** | create-customer, push-invoice, email |
| **F7** | Échappement incomplet dans la requête QBO (`'`→`\'`, backslash non échappé) | **Mineure** | create-customer, push-invoice, sync |
| **F8** | Rate-limiting **absent** sur les fonctions QBO ; limiteur in-memory faible/non distribué (8/min) sur email | **Mineure** | toutes |
| **F9** | Fuite d'info dans les erreurs (`details: data`, `String(err)`) | **Mineure** | toutes |
| **F10** | OAuth `state` jamais validé au callback (CSRF) + suppression-puis-insertion non atomique des tokens | **Mineure** | auth |
| **F11** | PII loggée en clair (courriel/téléphone/adresse, payloads clients) | **Mineure** | create-customer, email, sync |

**Verdict : NO-GO en l'état pour une exposition élargie / multi-utilisateurs.**
Voir §7. Les fonctions sont fonctionnellement correctes pour l'usage actuel
(un seul opérateur admin, comptes provisionnés manuellement), mais reposent sur
des hypothèses implicites (un seul utilisateur = forcément admin, l'en-tête
`Origin` comme frontière de sécurité) qui ne tiennent pas dès qu'un second rôle
ou un client non-navigateur entre en jeu.

---

## 1. Méthodologie & honnêteté méthodo

- **Revue statique uniquement.** Cet environnement n'a **pas** accès au projet
  Supabase distant, ni aux secrets, ni aux journaux d'exécution. Je **n'ai pas**
  invoqué les fonctions ni observé de trafic réel. Les conclusions découlent de
  la lecture du code (`supabase/functions/**`), des migrations
  (`supabase/migrations/**`) et des appelants côté client
  (`src/pages/AdminQuoteGenerator.tsx`, `AdminProducts.tsx`, `ImmersiveWizard.tsx`).
- **Ce que je ne peux pas affirmer ici** (à confirmer côté projet) :
  - le réglage **« Enable signups »** de Supabase Auth (détermine si F1 est
    Majeure ou Critique) ;
  - la présence/absence de **RLS sur `quickbooks_tokens`** (aucune migration ne
    crée cette table ni de policy — elle a vraisemblablement été créée via le
    dashboard/Lovable ; F4) ;
  - le comportement « Warn if duplicate document number » de la société QBO
    (atténuant partiel de F3, mais c'est un simple avertissement côté API).
- **Fonctions auditées** : `quickbooks-create-customer`, `quickbooks-push-invoice`
  (l'« estimate » QBO), `send-quote-email`, `quickbooks-sync`, `quickbooks-auth`,
  et le module partagé `_shared/hardening.ts`. Note : il n'existe pas de fonction
  nommée `quickbooks-push-estimate` ; la création d'Estimate se fait dans
  `quickbooks-push-invoice`.

---

## 2. Contexte d'appel (côté client)

`AdminQuoteGenerator` invoque les fonctions de deux façons :
- `supabase.functions.invoke('quickbooks-sync', …)` (en-têtes JWT auto-attachés) ;
- `fetch(`${FN_BASE}/…`, { headers: { apikey: ANON_KEY, Authorization: Bearer <session.access_token> } })`
  pour `quickbooks-create-customer`, `quickbooks-push-invoice` et `send-quote-email`.

Le login admin se fait via `supabase.auth.signInWithPassword` (`AdminLogin.tsx`).
**Aucun** `signUp` n'existe côté client → les comptes sont provisionnés
manuellement. C'est la seule chose qui, aujourd'hui, empêche F1 d'être Critique.

---

## 3. Le module partagé `_shared/hardening.ts`

C'est le pivot de la posture sécurité. Il expose `cors`, `assertOrigin`,
`getClientIp`, `checkRateLimit`, `runGuards` et `runAdminGuards`.

### `runAdminGuards` — le cœur du problème (F1)

```ts
// ── Admin-only guard: verify Supabase JWT (no x-roof-token needed) ──
export async function runAdminGuards(req, corsHeaders) {
  if (!assertOrigin(req)) { /* 403 */ }
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) { /* 401 */ }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) { /* 401 */ }
  return null; // ← passe dès qu'un JWT valide existe
}
```

Le commentaire dit « Admin-only » mais la fonction **ne vérifie que
l'authentification** : n'importe quel utilisateur possédant un JWT Supabase
valide passe. **Aucun** contrôle de rôle (`app_metadata.role`, table
`user_roles`, `has_role()`, claim custom). Recherche dans tout le dépôt :
aucune occurrence de `has_role`, `user_roles`, `is_admin`, `app_role`. Il
n'existe donc **aucun modèle de rôle** dans ce projet.

**Conséquence.** Tout principal authentifié — y compris un compte créé via
l'endpoint public GoTrue `/auth/v1/signup` **si les inscriptions ne sont pas
désactivées** dans la config Auth — peut appeler `quickbooks-create-customer`,
`quickbooks-push-invoice` et `quickbooks-sync` (création/maj de clients, push
d'estimés, lecture de tout le carnet clients QBO). La clé publishable/anon
nécessaire pour atteindre les fonctions est, par définition, publique
(bundlée dans le JS client).

→ **Si « Enable signups » est ON : Critique** (escalade — voir §8).
→ **Si OFF (comptes provisionnés à la main) : Majeure** (faille
d'autorisation latente / défaut de défense en profondeur ; tout futur rôle
non-admin — portail client, employé dispatch — hériterait d'un accès QBO total).

### `assertOrigin` / CORS

`isAllowedOrigin` autorise les domaines de prod, `null`, et tout
`*.lovable.app` / `*.lovableproject.com` / `*.vercel.app`. **L'en-tête `Origin`
n'est pas une frontière de sécurité côté serveur** : il n'est imposé que par
les navigateurs. Un client non-navigateur (curl, script) fixe `Origin` à
volonté (ou l'omet → traité comme autorisé). `assertOrigin` est donc une
protection anti-CSRF navigateur utile, **pas** un contrôle d'accès. C'est
acceptable tant que ce n'est pas la *seule* barrière — ce qui est précisément
le problème de `send-quote-email` (F2).

### `checkRateLimit` (voir aussi F8)

Limiteur **in-memory** par instance (`Map`), 8 req/60 s. Trois limites :
(1) l'état est perdu au cold start ; (2) les Edge Functions scalent sur
plusieurs isolats → le compteur n'est **pas** global ; (3) il n'est **invoqué
que par `send-quote-email`** et `runGuards` — **jamais** par `runAdminGuards`.
Les fonctions QBO n'ont donc **aucun** rate-limiting.

---

## 4. Findings par fonction

### 4.1 `quickbooks-create-customer`

**Garde** : `runAdminGuards` → auth seule, pas de rôle (F1).

**Idempotence (F5 — Mineure).** Bon réflexe : si `qb_id` fourni → chemin update ;
sinon recherche par `DisplayName` puis diff/update sparse, sinon création. Un
retry réseau retrouvera donc en général le client déjà créé → pas de doublon
**dans le cas nominal**. Deux réserves :
- **Fenêtre de course** : deux requêtes concurrentes identiques peuvent toutes
  deux ne rien trouver et toutes deux créer → doublon. Pas de clé
  d'idempotence ni de verrou.
- **Correspondance fragile** : l'unicité repose sur l'égalité stricte de
  `DisplayName`. Un changement de casse/espacement crée un nouveau client.

**Validation d'input (F6 — Mineure).** Seul `display_name || given_name` est
exigé. **Aucune** validation de format pour `email`, `phone`, et surtout le
**NEQ** (au Québec : 10 chiffres) — poussé tel quel dans `Notes: "NEQ: <x>"`.
Pas de normalisation, pas de bornage de longueur.

**Injection requête QBO (F7 — Mineure).**
```ts
`SELECT * FROM Customer WHERE DisplayName = '${effectiveDisplayName.replace(/'/g, "\\'")}'`
```
L'échappement ne traite que `'`→`\'` ; le backslash lui-même n'est pas échappé
et le reste de la chaîne n'est pas borné. Surface limitée (requête de lecture
QBO, exécutée avec un compte déjà authentifié), mais l'échappement est
incorrect. Préférer un paramétrage / une recherche par identifiant.

**Secrets / fuite (F9, F11 — Mineures).** Les access tokens ne sont **jamais**
retournés au client (bon). En revanche : `console.log("Creating QB customer:",
JSON.stringify(newCustomer))` journalise nom/courriel/téléphone/adresse (PII).
Les erreurs renvoient `details: updData` / `details: createData` (réponse QBO
brute) et `error: String(err)` en 500 — fuite d'info interne mineure.

### 4.2 `quickbooks-push-invoice` (création d'Estimate)

**Garde** : `runAdminGuards` → auth seule (F1).

**Idempotence — F3 (Majeure).** **Aucune.** Chaque appel POST crée un **nouvel**
Estimate via `…/estimate`. Le `doc_number` (`VB-{seq_number}`) est transmis et
devient le `DocNumber`, mais la fonction **ne vérifie jamais** qu'un Estimate
portant ce `DocNumber` existe déjà. Conséquences :
- un **double-clic** sur « Pousser vers QBO » crée **deux estimés** ;
- un **retry réseau** (timeout côté client puis renvoi) crée un **doublon** ;
- QBO autorise par défaut les `DocNumber` dupliqués (l'option « warn if
  duplicate » n'est qu'un avertissement, non bloquant par l'API).

C'est le point le plus directement lié à la consigne « un retry réseau ne crée
pas de doublon QBO ». **Recommandation** : avant POST, requêter
`SELECT * FROM Estimate WHERE DocNumber = '<doc_number>'` ; si trouvé →
sparse-update au lieu de create (et idéalement persister le `qb_estimate_id`
retourné dans `soumissions` pour forcer le chemin update aux appels suivants).

**Création de client en cascade.** Si `customer_id` absent mais `customer_name`
fourni, la fonction cherche par nom puis **crée** un client → même fenêtre de
course que F5. De plus, `customerRef` retombe sur `"1"` (« premier client ») si
rien n'est résolu : un estimé peut être rattaché au **mauvais client** si la
résolution échoue silencieusement (`console.error` puis on continue). À durcir
(échouer explicitement plutôt que rattacher au client #1).

**Attachements & PDF.** Télécharge `att.url` (fourni par l'appelant) côté
serveur → SSRF théorique : aucune allowlist sur ces URLs (contrairement à
`isAllowedGoogleUrl` utilisée ailleurs). Dans l'usage actuel ce sont des URLs
du bucket `quote-pdfs`, mais rien ne le contraint. Le PDF QBO est stocké dans
un bucket **privé** avec URL signée 7 j (bon).

**Validation (F6), injection (F7), fuite (F9)** : mêmes remarques qu'en 4.1
(`details: qbData` renvoyé, `String(err)` en 500).

### 4.3 `send-quote-email`

**Garde — F2 (Majeure).** **Aucun `runAdminGuards`.** La fonction n'applique que
`assertOrigin` + `checkRateLimit`. Comme l'`Origin` n'est pas une frontière
serveur (§3), c'est en pratique un **endpoint public**. Or :
- le destinataire client est `to: [clientEmail]` — **entièrement contrôlé par
  le corps de la requête** ;
- `cc`, `bcc`, `replyTo`, `customSubject`, `customBody` sont aussi contrôlés par
  l'appelant.

→ **Relais courriel ouvert** : un tiers peut faire envoyer, depuis le domaine
**vérifié** `noreply@toituresvb.ca`, des courriels de marque Toitures VB à des
adresses arbitraires, avec sujet et corps libres → vecteur de **spam /
phishing** et risque pour la **réputation d'envoi** du domaine (Resend).

→ De plus, en cas de succès, la fonction **PATCH** `soumissions` (via
`SUPABASE_SERVICE_ROLE_KEY`, donc en contournant la RLS) pour **n'importe quel**
`soumissionId` fourni → écriture arbitraire des champs `email_status`,
`email_sent_at`, `email_recipient`, `email_cc`, `email_bcc` sur une ligne
choisie par l'appelant.

**Points positifs** : l'échappement HTML (`esc`) des valeurs contrôlées par
l'utilisateur dans les corps HTML est présent et correct (anti-injection HTML/
en-tête dans le rendu) ; `RESEND_API_KEY` n'est jamais retourné ni loggé ;
`fetchPdfAsBase64` restreint les URLs à `https://…supabase.co/storage/…`.

**Validation (F6)** : `clientEmail`, `cc`, `bcc`, `replyTo` ne sont pas validés
comme adresses ; `parseList` découpe librement → on peut injecter une liste
massive de destinataires (amplification).

**Rate-limit (F8)** : seul garde quantitatif ici, mais faible/non distribué
(8/min/IP in-memory). Insuffisant face à un abus distribué.

### 4.4 `quickbooks-sync`

**Garde** : `runAdminGuards` → auth seule (F1). C'est l'endpoint le plus
**exfiltrant** : `type:"customers"` renvoie **tout le carnet clients QBO**
(noms, courriels, téléphones, adresses, soldes) et `type:"products"` tout le
catalogue. Sous F1, accessible à tout JWT valide. Écrit aussi en masse dans
`qb_customers` / `qb_products` (service role).

`create_product` / `update_product` : pas de validation forte (`unitPrice`,
`purchaseCost` castés en `Number`, pas de borne) ; auto-sélection du premier
compte Income/COGS si non fourni → un produit peut être créé sur le **mauvais
compte comptable** silencieusement. Injection F7 idem (requêtes `Account`/`Item`
construites par concaténation, mais ici sans entrée utilisateur libre directe).

### 4.5 `quickbooks-auth`

**Garde** : `runAdminGuards` → auth seule (F1). Gère `status` / `authorize` /
`callback` / `refresh`.

**OAuth `state` non validé — F10 (Mineure).** `authorize` génère un
`state = crypto.randomUUID()` renvoyé au client, mais `callback` **ne le
revérifie jamais** (le `state` reçu d'Intuit n'est comparé à rien). CSRF OAuth
classique. Atténué par le fait que `callback` est lui-même derrière
`runAdminGuards`, mais le `state` devrait être persisté et validé.

**Suppression-puis-insertion non atomique.** `callback` fait
`delete().neq(id, <uuid zéro>)` (purge **tous** les tokens) **puis** `insert`.
Si l'insert échoue, on se retrouve **sans aucun token** (QBO déconnecté). Pas
de transaction. Préférer un upsert.

**Secrets** : `QB_CLIENT_SECRET` jamais retourné ni loggé (bon). Les échanges
de tokens renvoient `details: tokenData`/`details: refreshData` au client en
cas d'échec — peut exposer des messages d'erreur OAuth (pas le secret
lui-même, mais info interne). Mineur.

---

## 5. Stockage des tokens QBO — F4 (Majeure, à confirmer)

La table `quickbooks_tokens` stocke `access_token` et surtout `refresh_token`
(secret **long-lived**, ~100 jours) **en clair**. Toutes les fonctions y
accèdent via `SUPABASE_SERVICE_ROLE_KEY` (contournement RLS légitime côté
serveur). **Aucune migration du dépôt ne crée cette table ni de policy RLS** :
impossible de confirmer ici que la table est protégée. Si la RLS est absente ou
permissive, un porteur de la clé anon (publique) pourrait lire les refresh
tokens → **compromission totale du compte QBO**.

**À vérifier impérativement côté projet** : `quickbooks_tokens` a RLS
**activée** et **aucune** policy pour `anon`/`authenticated` (service_role
uniquement). Idem pour `qb_customers` / `qb_products` (données métier).
Recommandation complémentaire : chiffrer le refresh token au repos (Vault /
pgsodium) plutôt que stockage clair.

---

## 6. Compatibilité avec l'autosave AdminQuote (Vague A)

- L'**autosave** lui-même écrit dans la table `soumissions` (insert puis
  adoption de l'`id` retourné — voir `AdminQuoteGenerator.tsx` l. 3533/3703).
  Ce chemin est **idempotent** par adoption d'id : un retry réécrit la même
  ligne. ✅ Pas de doublon de soumission côté DB.
- Le **push QBO** (`quickbooks-push-invoice`) et l'**envoi courriel**
  (`send-quote-email`) sont des actions **manuelles, distinctes** de l'autosave,
  et **non idempotentes** (F3 pour QBO, et l'envoi courriel ne déduplique pas
  non plus). Le risque de doublon n'est donc pas porté par l'autosave de la
  Vague A elle-même, mais par **tout retry de ces deux actions** (réseau ou
  double-clic). **La consigne « un retry réseau ne crée pas de doublon QBO »
  n'est pas satisfaite** aujourd'hui pour le push d'estimé.

---

## 7. Liste à corriger (priorisée)

**Bloquants (avant toute exposition élargie ou ajout d'un rôle non-admin)**
1. **F1** — Ajouter une vraie vérification de **rôle admin** côté serveur dans
   `runAdminGuards` (claim `app_metadata.role`, ou table `user_roles` +
   `has_role()`), et renvoyer 403 si non-admin. Vérifier/désactiver
   « Enable signups » dans Supabase Auth.
2. **F2** — Protéger `send-quote-email` par `runAdminGuards` (+ rôle), et/ou
   contraindre les destinataires (pas de `to`/`cc`/`bcc` libres pour un appel
   non authentifié), borner et valider les listes d'adresses. Restreindre le
   PATCH `soumissions` au propriétaire de la soumission.
3. **F3** — Rendre `push-invoice` **idempotent** : dédup par `DocNumber`
   (recherche avant create → sparse-update si trouvé) et/ou persister le
   `qb_estimate_id` dans `soumissions` pour forcer l'update aux appels suivants.
4. **F4** — Confirmer que `quickbooks_tokens` (et `qb_*`) ont la **RLS activée,
   service_role uniquement** ; envisager le chiffrement du refresh token.

**Importants**
5. **F5** — Verrou/clé d'idempotence sur la création de client (éviter la course
   sur `DisplayName`).
6. **F6** — Valider/normaliser `email`, `phone`, **NEQ** (10 chiffres) côté
   serveur.
7. **F8** — Étendre un rate-limiting **persistant/distribué** (ex. table Postgres
   ou Redis) aux fonctions QBO et à l'email ; relever la robustesse du limiteur.

**Mineurs / défense en profondeur**
8. **F7** — Remplacer la concaténation de requêtes QBO par un échappement
   correct (ou recherche par id).
9. **F9** — Cesser de renvoyer `details:`/`String(err)` brut au client (logguer
   côté serveur, renvoyer un message générique + code).
10. **F10** — Valider le `state` OAuth au callback ; remplacer
    delete-puis-insert par un upsert atomique.
11. **F11** — Retirer les PII des `console.log` (ou les masquer).
12. **push-invoice** — Échouer explicitement plutôt que rattacher l'estimé au
    client `"1"` ; ajouter une allowlist sur les URLs d'attachements (SSRF).

---

## 8. Escalade

Conformément à la consigne (« escalade si vulnérabilité critique active »),
**deux points méritent une vérification urgente côté projet** car ils peuvent
être **activement exploitables aujourd'hui** :

- **F2 (relais courriel ouvert)** — exploitable **sans authentification**
  (l'`Origin` ne protège pas un client non-navigateur). Spam/phishing depuis un
  domaine vérifié + écriture arbitraire dans `soumissions`. **Actif dès
  maintenant.**
- **F1 + signups** — **Critique** *si et seulement si* « Enable signups » est
  activé sur le projet Supabase : dans ce cas, n'importe qui peut s'inscrire avec
  la clé anon publique puis piloter QuickBooks (créer/maj clients, pousser des
  estimés, exfiltrer le carnet clients via `quickbooks-sync`). **À vérifier en
  priorité.** Si OFF, le risque retombe à Majeure (latent).

Ces deux éléments ne pouvant être confirmés « actifs » sans accès au projet
distant (réglage Auth, test live volontairement non effectué en read-only),
ils sont documentés ici plutôt que testés.

---

## 9. GO / NO-GO production

**NO-GO** pour une exposition élargie, l'ajout d'un second rôle utilisateur,
ou tout usage où l'on ne peut pas garantir « 1 seul opérateur admin, comptes
créés à la main, signups désactivés ».

**Justification.** Les fonctions remplissent leur rôle métier et comportent de
bons réflexes ponctuels (escape HTML email, bucket PDF privé + URL signée,
tokens jamais renvoyés au client, allowlist d'URL pour le fetch de PDF). Mais la
**posture d'autorisation est insuffisante** : le « admin guard » ne vérifie
aucun rôle (F1), `send-quote-email` est un relais ouvert (F2), et le push
d'estimé n'est pas idempotent (F3) — ce dernier contredisant directement
l'objectif de robustesse au retry de la Vague A.

**Condition de GO** : traiter au minimum les bloquants F1, F2, F3 et confirmer
F4 (RLS `quickbooks_tokens`). Avec ces quatre points corrigés/confirmés et les
« Importants » (F5–F8) traités, la suite QBO/email serait raisonnablement prête
pour un usage multi-utilisateurs en production.
