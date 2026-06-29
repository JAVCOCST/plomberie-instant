# Plomberie Instant — Portail

Page de login minimaliste (React + Vite) branchée sur **Supabase Auth**, prête à déployer sur **Vercel**.

## Stack

- React 18 + Vite
- Supabase (`@supabase/supabase-js`) pour l'authentification (email + mot de passe)

## Développement local

```bash
npm install
cp .env.example .env.local   # déjà pré-rempli avec le projet Supabase
npm run dev
```

L'app tourne sur http://localhost:5173

## Variables d'environnement

| Variable                  | Description                          |
| ------------------------- | ------------------------------------ |
| `VITE_SUPABASE_URL`       | URL du projet Supabase               |
| `VITE_SUPABASE_ANON_KEY`  | Clé publique (publishable / anon)    |

> Ces valeurs sont aussi présentes en dur comme valeurs par défaut dans `src/supabaseClient.js`, donc l'app fonctionne même sans `.env`. La clé publique est conçue pour être exposée côté navigateur.

## Déploiement sur Vercel

1. Pousse le repo sur GitHub.
2. Sur [vercel.com](https://vercel.com) → **Add New → Project** → importe le repo.
3. Vercel détecte automatiquement **Vite** (Build: `npm run build`, Output: `dist`).
4. (Optionnel) Ajoute les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans **Settings → Environment Variables**.
5. **Deploy**.

## Configuration Supabase

Dans le dashboard Supabase → **Authentication** :

- **Providers → Email** : activé.
- Pour tester sans confirmation par courriel, désactive « Confirm email » (sinon les nouveaux comptes doivent valider leur adresse).
- **URL Configuration** : ajoute l'URL Vercel dans les *Redirect URLs* / *Site URL*.
