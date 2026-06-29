# External schemas — FDW Brikk Finance

> **Source de vérité technique** pour le schéma `brikk.*` (foreign tables) du
> projet Supabase Toitures VB. Ces objets ne sont **pas** versionnés dans
> `supabase/migrations/` parce qu'ils vivent dans un autre projet Supabase
> (Brikk Finance) et sont importés en read-mostly via `postgres_fdw`.
>
> **À lire** par tout nouveau dev avant de toucher au pipeline soumission ou
> de faire un `supabase db reset`.

---

## 1. Pourquoi un FDW

Le portail Toitures VB consomme les données du rôle d'évaluation foncière du
Québec (MAMH) pour auto-remplir les étapes 1-2-3 du module Soumission
(année de construction, nb logements, nb étages, superficie habitable, etc.).

Ces données vivent dans un autre projet Supabase : **Brikk Finance**
(`lkwwfpsxyeutgiksqrep`). Plutôt que de dupliquer le rôle MAMH (91 000+
immeubles, refresh annuel) dans Toitures VB, on accède aux tables Brikk via
**foreign tables PostgreSQL** (`postgres_fdw`).

---

## 2. Architecture

```
                    ┌──────────────────────────┐
                    │   Données Québec (MAMH)  │
                    │   Rôle évaluation 2026   │
                    └────────────┬─────────────┘
                                 │
                  Script Python (GitHub Actions, repo brikk-finance-builder)
                                 │
                                 ▼
         ┌──────────────────────────────────────────┐
         │           BRIKK FINANCE                  │
         │     Supabase project lkwwfpsxyeutgiksqrep │
         │                                          │
         │   Tables canoniques (source de vérité) : │
         │   - immeubles_unified  (~91 000 lignes)  │
         │   - municipalites_qc   (~106 lignes)     │
         │   - lots_cadastraux                      │
         │   - batiments                            │
         │   - proprietaires_unified                │
         │   - proprietaire_immeuble_unified        │
         └────────────────┬─────────────────────────┘
                          │
              FDW (postgres_fdw, user dédié `brikk_fdw_user` BYPASSRLS)
                          │
                          ▼
         ┌──────────────────────────────────────────┐
         │           TOITURES VB                    │
         │     Supabase project eeradaaxmqzyvxvmahlf │
         │                                          │
         │   Schema `brikk` (foreign tables) :      │
         │   - brikk.immeubles_unified              │
         │   - brikk.municipalites_qc               │
         │   - brikk.lots_cadastraux                │
         │   - brikk.batiments                      │
         │   - brikk.proprietaires_unified          │
         │   - brikk.proprietaire_immeuble_unified  │
         │                                          │
         │   RPC consommatrice (versionnée ici) :   │
         │   - public.fiche_batiment_complete()     │
         │                                          │
         │   + tables locales habituelles           │
         │   (batiment_avec_lot, soumissions, …)    │
         └──────────────────────────────────────────┘
```

---

## 3. Clé de jointure (critique)

**À utiliser** :
```sql
brikk.immeubles_unified.matricule  ⇔  REPLACE(public.batiment_avec_lot.no_lot, ' ', '')
```

**NE PAS utiliser** `brikk.immeubles_unified.no_lot` (qui contient les codes
courts internes `RL0104B`+`RL0104C` du XML MAMH, **pas** le matricule cadastre
rénové).

Côté Toitures VB, la colonne `batiment_avec_lot.no_lot` contient bien le
**matricule du cadastre rénové** (ex. `"1 651 911"` avec espaces). Côté MAMH,
le même matricule (sans espaces) se trouve dans `brikk.immeubles_unified.matricule`.

Couverture Granby (snapshot 2026-06-06) : ~51 000 matchs sur ~71 000
matricules MAMH (~72 %). Le reste = terrains vagues, stationnements, unités
sans bâtiment, hors zone.

---

## 4. Granularité MAMH

**1 ligne `brikk.immeubles_unified` = 1 matricule cadastral = 1 bâtiment
physique.** Pas 1 ligne par unité fiscale.

Exemple : copropriété de 20 condos → **1 seule ligne** dans `immeubles_unified`
qui représente le bâtiment, avec `nb_logements = 20`. C'est exactement ce qu'on
veut pour estimer une toiture (la toiture appartient au bâtiment, pas aux
unités individuelles).

Si un jour Toitures VB voulait découper par condo (jamais nécessaire pour de
la toiture), il faudrait revoir le modèle côté Brikk Finance — mais c'est
explicitement **hors scope**.

---

## 5. SQL exact pour recréer le FDW depuis zéro

Si `supabase db reset` est exécuté, ou pour cloner Toitures VB dans un
nouveau projet Supabase, les commandes ci-dessous **doivent être réexécutées
manuellement** (le schéma `brikk.*` n'est PAS dans `supabase/migrations/`).

### Côté Brikk Finance (préalable, à faire UNE FOIS par DBA Brikk)

Créer le user dédié + grants. Voir la documentation Brikk (`brikk-finance-builder`
repo, `scripts/import-mamh/HANDOFF_TOITURES_VB.md`). Récupérer le password
depuis `vault.decrypted_secrets WHERE name = 'brikk_fdw_user_pwd'`.

### Côté Toitures VB

```sql
-- 1) Extension postgres_fdw
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- 2) Foreign server vers Brikk Finance
CREATE SERVER IF NOT EXISTS brikk_finance
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (
    host 'db.lkwwfpsxyeutgiksqrep.supabase.co',
    port '5432',
    dbname 'postgres',
    sslmode 'require'
  );

-- 3) User mappings (3 rôles utilisés par PostgREST + RPC)
CREATE USER MAPPING IF NOT EXISTS FOR postgres        SERVER brikk_finance OPTIONS (user 'brikk_fdw_user', password '<PWD_DEPUIS_VAULT>');
CREATE USER MAPPING IF NOT EXISTS FOR authenticated   SERVER brikk_finance OPTIONS (user 'brikk_fdw_user', password '<PWD_DEPUIS_VAULT>');
CREATE USER MAPPING IF NOT EXISTS FOR service_role    SERVER brikk_finance OPTIONS (user 'brikk_fdw_user', password '<PWD_DEPUIS_VAULT>');

-- 4) Schéma brikk dédié (évite la pollution de public)
CREATE SCHEMA IF NOT EXISTS brikk;

-- 5) Import des 6 tables partagées
IMPORT FOREIGN SCHEMA public
  LIMIT TO (
    immeubles_unified,
    municipalites_qc,
    lots_cadastraux,
    batiments,
    proprietaires_unified,
    proprietaire_immeuble_unified
  )
  FROM SERVER brikk_finance
  INTO brikk;

-- 6) Grants pour PostgREST + RPC
GRANT USAGE ON SCHEMA brikk TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA brikk TO authenticated, service_role;
-- On exclut volontairement `anon` : aucune donnée MAMH n'est exposée
-- aux utilisateurs non-authentifiés (un visiteur public ne devrait
-- jamais déclencher de lookup MAMH).
```

### Pour refresh le schéma après un changement structurel côté Brikk

Si Brikk Finance ajoute / supprime une colonne dans une table partagée :

```sql
DROP FOREIGN TABLE IF EXISTS brikk.immeubles_unified CASCADE;
IMPORT FOREIGN SCHEMA public
  LIMIT TO (immeubles_unified)
  FROM SERVER brikk_finance
  INTO brikk;
-- (Répéter pour chaque table modifiée.)
```

---

## 6. Risque RLS & sécurité

### 6.1 Pas de RLS côté Toitures VB

Les foreign tables `brikk.*` n'ont **pas** de Row Level Security côté Toitures
VB (Postgres ne supporte pas RLS sur foreign tables). Toute la protection
passe par :

1. **Côté Brikk Finance** : le user `brikk_fdw_user` a `BYPASSRLS` mais ses
   GRANTs sont limités à 6 tables précises. Pas d'accès aux soumissions ou
   propriétaires sensibles de Brikk.
2. **Côté Toitures VB** : **on n'expose PAS le schéma `brikk` via PostgREST**.
   La seule porte d'entrée est la RPC `public.fiche_batiment_complete()`
   (SECURITY DEFINER) qui filtre par `idbati` et ne retourne que les champs
   nécessaires.

### 6.2 Conséquence pour le dev

- **Ne pas** ajouter `brikk` dans Settings → API → Exposed schemas du
  dashboard Toitures VB.
- **Ne pas** créer de policy RLS sur `brikk.*` (n'aurait aucun effet).
- **Toujours** passer par une RPC publique pour exposer des données MAMH
  au front (pattern `fiche_batiment_complete`).

---

## 7. RPC consommatrice : `public.fiche_batiment_complete()`

Versionnée dans `supabase/migrations/<ts>_brikk_fiche_batiment_rpc.sql`.

Signature :
```
public.fiche_batiment_complete(p_idbati text) RETURNS jsonb
```

Comportement :
- Cherche un `batiment_avec_lot.idbati = p_idbati`
- Join Brikk via `matricule = REPLACE(no_lot, ' ', '')`
- Join `brikk.municipalites_qc` via `code_geographique`
- Retourne `jsonb_build_object('batiment', ..., 'immeuble', ..., 'municipalite', ...)`
- **Si le FDW Brikk est cassé/indispo** : la RPC retourne quand même un objet
  avec `immeuble: null, municipalite: null` au lieu de crasher (graceful
  degradation côté front).

Accès :
- `GRANT EXECUTE TO authenticated`
- `REVOKE EXECUTE FROM anon`

---

## 8. Workflow de refresh annuel

Côté Brikk Finance, un workflow GitHub Actions (`brikk-finance-builder/.github/workflows/import-mamh.yml`)
se déclenche **chaque 5 avril à 03h UTC** et pomp le nouveau millésime MAMH
dans `immeubles_unified` via UPSERT (clé : `niue`).

Côté Toitures VB : **rien à faire**. Le FDW pointe vers la même table, donc
les nouvelles données apparaissent automatiquement après le run Brikk.

Si Brikk modifie la structure (rare), suivre la procédure §5 "refresh schéma".

---

## 9. Smoke tests

Pour vérifier que le FDW fonctionne côté Toitures VB, depuis le SQL editor du
dashboard Supabase :

```sql
-- Doit retourner > 0
SELECT COUNT(*) FROM brikk.immeubles_unified;

-- Doit retourner > 0
SELECT COUNT(*) FROM brikk.municipalites_qc;

-- Doit retourner > 0 (test cross-jointure)
SELECT COUNT(*)
FROM public.batiment_avec_lot bal
JOIN brikk.immeubles_unified iu
  ON iu.matricule = REPLACE(bal.no_lot, ' ', '');

-- Doit retourner un jsonb non-null
SELECT public.fiche_batiment_complete(
  (SELECT idbati FROM public.batiment_avec_lot LIMIT 1)
);
```

Si l'une de ces requêtes échoue, le FDW n'est pas en place : retomber sur la
procédure §5.

---

## 10. Liens

- Doc HANDOFF Brikk : `github.com/javcocst/brikk-finance-builder/blob/main/scripts/import-mamh/HANDOFF_TOITURES_VB.md`
- Architecture review : `docs/architecture-review-roofing-pipeline.md` §6
- Migration RPC : `supabase/migrations/<ts>_brikk_fiche_batiment_rpc.sql`
- Données source MAMH : https://www.donneesquebec.ca/recherche/dataset/roles-evaluation-fonciere
