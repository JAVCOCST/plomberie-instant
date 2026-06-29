/**
 * Heuristiques de calcul pour l'autofill du wizard de soumission (Vague A2).
 *
 * Toutes les fonctions sont :
 *   - **Pures** : aucune dépendance DOM, aucun appel réseau, aucun side-effect.
 *   - **Déterministes** : même input → même output.
 *   - **Tunables a posteriori** : les coefficients ne sont pas figés en
 *     production (Vague C les ajustera empiriquement avec l'historique
 *     des 30 dernières soumissions).
 *
 * Spec :
 *   - `estimateEventsPlomberie` : architecture-review-roofing-pipeline.md §8
 *   - `computeComplexityScore` + `complexityToCategory` : §7
 */

import type { ComplexityLevel } from "@/types/roofing";

/* ── 1. Évents plomberie ────────────────────────────────────────────────── */

/**
 * Estime le nombre d'évents de plomberie qui sortent du toit à partir du
 * nombre de logements et d'étages MAMH.
 *
 * Heuristique du brief §8 (à tuner) :
 *   - 1 étage          → 1 évent par logement (plomberie au sol)
 *   - 2 étages         → vents partagés sur cheminée principale, ~½ logements
 *   - 3 étages ou plus → plus mutualisé, ~⅓ logements
 *
 * Garde-fous :
 *   - Floor `>= 1` sur le total (au moins un évent par bâtiment habité)
 *   - Si `nb_logements` null ou 0 → retourne 1 (cas "édifice utilitaire ou
 *     habitable minimum")
 *   - Si `nb_etages` null → traite comme 1 (cas le plus simple)
 */
export function estimateEventsPlomberie(
  nb_logements: number | null | undefined,
  nb_etages: number | null | undefined,
): number {
  const logements = typeof nb_logements === "number" && nb_logements > 0
    ? nb_logements
    : 1;
  const etages = typeof nb_etages === "number" && nb_etages > 0
    ? nb_etages
    : 1;
  if (etages === 1) return Math.max(1, logements);
  if (etages === 2) return Math.max(2, Math.ceil(logements / 2));
  // 3 étages ou plus
  return Math.max(2, Math.ceil(logements / 3));
}

/* ── 2. Score de complexité ──────────────────────────────────────────────── */

export interface ComplexityScoreInput {
  /** Nombre de plans/segments détectés par Solar (typique : 2-8 sur résidentiel). */
  solar_n_segments: number;
  /** Pente maximale en X/12 (typique : 4-12). */
  solar_max_pitch_x12: number;
  /** Nombre estimé de pignons (typique : 0-4 sur résidentiel). */
  solar_n_pignons: number;
  /** Nombre d'étages MAMH (null si non disponible — composante neutralisée). */
  brikk_nb_etages: number | null | undefined;
  /** Écart-type des azimuts Solar normalisé sur [0, 1] (0 = très uniforme, 1 = très hétérogène). */
  solar_azimut_variance_norm: number;
  /** Nombre de logements MAMH (null si non disponible). */
  brikk_nb_logements: number | null | undefined;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Score de complexité dans `[0, 1]`. Pondérations brief §7 :
 *   - 0.25 × (n_segments / 6)           — typologie
 *   - 0.20 × (max_pitch_x12 / 12)       — raideur de travail
 *   - 0.20 × (n_pignons / 4)            — formes irrégulières
 *   - 0.20 × (nb_etages / 3)            — hauteur de travail (Brikk)
 *   - 0.10 × (azimut_variance_norm)     — orientations hétérogènes
 *   - 0.05 × (nb_logements ≥ 4 ? 1 : 0) — multi-logements
 *
 * Si une composante Brikk (`nb_etages` ou `nb_logements`) est null :
 *   - `nb_etages` → la composante c4 vaut `0.5` (neutre — pas pénaliser le
 *     score juste parce qu'on n'a pas la donnée).
 *   - `nb_logements` → la composante c6 vaut `0` (par défaut, pas de bonus).
 *
 * Le résultat est strictement dans `[0, 1]` (chaque composante est `clamp01`).
 */
export function computeComplexityScore(input: ComplexityScoreInput): number {
  const c1 = clamp01(input.solar_n_segments / 6);
  const c2 = clamp01(input.solar_max_pitch_x12 / 12);
  const c3 = clamp01(input.solar_n_pignons / 4);
  const c4 = input.brikk_nb_etages != null && input.brikk_nb_etages > 0
    ? clamp01(input.brikk_nb_etages / 3)
    : 0.5;
  const c5 = clamp01(input.solar_azimut_variance_norm);
  const c6 = (input.brikk_nb_logements ?? 0) >= 4 ? 1 : 0;
  const score = 0.25 * c1 + 0.20 * c2 + 0.20 * c3 + 0.20 * c4 + 0.10 * c5 + 0.05 * c6;
  return clamp01(score);
}

/* ── 3. Score → catégorie utilisateur ─────────────────────────────────────── */

/**
 * Mappe un score numérique sur les 4 niveaux qualitatifs exposés à
 * l'utilisateur dans le wizard (cf. `src/types/roofing.ts#ComplexityLevel`).
 *
 * Seuils choisis pour donner une distribution roughly équilibrée sur les
 * cas observés sur 383 Provence + cas simulés (à valider en Vague C avec
 * l'historique réel) :
 *   - [0.00, 0.30[  → simple
 *   - [0.30, 0.55[  → moyenne
 *   - [0.55, 0.75[  → complexe
 *   - [0.75, 1.00]  → tres_complexe
 */
export function complexityScoreToCategory(score: number): ComplexityLevel {
  if (!Number.isFinite(score)) return "moyenne";
  if (score < 0.30) return "simple";
  if (score < 0.55) return "moyenne";
  if (score < 0.75) return "complexe";
  return "tres_complexe";
}
