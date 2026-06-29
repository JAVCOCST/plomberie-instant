# Feature flags

Liste des flags de fonctionnalité actifs dans le portail Toitures VB. Tous
les flags sont lus côté client via `import.meta.env.VITE_*` (Vite remplace
ces valeurs au moment du build).

**Convention** : tout flag est OFF par défaut. Pour activer en local, ajouter
au `.env.local` (jamais commité). Pour activer en preview Vercel, configurer
la variable d'environnement dans le dashboard Vercel.

---

## VITE_QUOTE_MOBILE_V2 (Vague A — mobile readiness)

**État** : déployé.

Active l'autosave Supabase + offline queue + scoped draft + reset-before-load +
confirmations destructives + image compression + indicateur de statut de save.

Sous-flags (chacun lit son propre env, défaut = valeur du master) :
- `VITE_QUOTE_FEATURE_AUTOSAVE`
- `VITE_QUOTE_FEATURE_CONFIRM_DESTRUCTIVE`
- `VITE_QUOTE_FEATURE_IMAGE_COMPRESSION`

Code : `src/lib/quote-feature-flags.ts`.

---

## VITE_QUOTE_AUTOFILL_V1 (Vague A2 — autofill MAMH + Solar + classify)

**État** : nouveau (Vague A2, non encore déployé en prod).

Active l'auto-remplissage des étapes 1-2-3 du wizard de soumission :
1. **Étape 1 — Identification** : 8 champs auto-remplis depuis Brikk MAMH
   (`year_built`, `dwelling_count`, `floor_count`, etc.) + Solar API
   (`roofType`, `slopeCategory`) + roof-classify (type de couverture matériau).
2. **Étape 2 — Modèle de soumission** : suggestion top 3 par fréquence
   d'usage 30 derniers jours (via `suggestTemplate`).
3. **Étape 3 — Take-off** : bouton "Seeder le tracer depuis Solar" qui
   pré-remplit le Tracer 3D avec le modèle de toit dérivé de Solar API.

### Activation locale

```bash
# .env.local
VITE_QUOTE_AUTOFILL_V1=true
```

### Garanties en flag OFF

- Aucun mount des hooks `useAutofillFromAddress` / `useSolarRoofModel`.
- Aucune query React Query supplémentaire.
- Aucune RPC Brikk ni appel à l'edge function `solar-api`.
- Le composant `AutofillCoordinator` n'est pas rendu.
- Les colonnes MAMH ajoutées à `soumissions` (`year_built`, `dwelling_count`,
  `floor_count`, `mamh_data_source`) restent à NULL pour toute nouvelle
  soumission créée en flag OFF.
- Le PDF généré est bit-identique au comportement pré-A2.

### Dépendances backend

Cette fonctionnalité dépend de :
- RPC `public.fiche_batiment_complete(p_idbati)` (migration `20260607_brikk_fiche_batiment_rpc`)
- RPC `public.idbati_from_no_lot(p_no_lot)` (migration `20260607_soumissions_mamh_columns`)
- Tables `solar_api_cache` + `solar_api_calls` (migration `20260607_solar_api_cache`)
- Edge function `solar-api` (déployée Vague A1)
- Schema `brikk` (FDW vers Brikk Finance — voir `docs/external-schemas.md`)
- Edge function `roof-classify` (déjà existante, signature pas modifiée)

Si l'une de ces dépendances échoue, l'autofill dégrade gracieusement : le
banner affiche l'état "erreur" ou "indisponible" pour la source concernée,
les autres continuent à fonctionner.

### Roadmap

- **A2 (cette vague)** : câblage UI + tests d'acceptance + ship en preview.
- **A3** : telemetry (mesure du gain de temps réel par soumission), cache
  Solar côté front (React Query peristence), vue diff Solar QA dans
  Training Lab pour valider visuellement.

Voir `docs/architecture-review-roofing-pipeline.md` §11 pour les
recommandations P0/P1/P2 complètes.
