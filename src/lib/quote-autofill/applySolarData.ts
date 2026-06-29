/**
 * Adaptateur pur : projection des données Solar API → patch d'état pour
 * le wizard de soumission (`AdminQuoteGenerator`).
 *
 * Contrat :
 *   - **Entrée**  : `SolarAutofillSource` (snapshot des champs courants) +
 *     `RoofModel` produit par `fromSolarAPI` (= sortie de l'edge function
 *     `solar-api` digérée).
 *   - **Sortie**  : `Partial<SolarAutofillTarget>` avec SEULEMENT les champs
 *     à mettre à jour.
 *
 * Règle d'or UX : ne JAMAIS écraser une saisie utilisateur. Le patch ne
 * contient que les champs vides côté wizard.
 *
 * Garde-fou qualité : si `sourceQuality === 'LOW'` ou `sourceQuality === 'BASE'`
 * ou null, l'adaptateur ne suggère **aucune** valeur (fallback manuel
 * obligatoire). Seul `MEDIUM` et `HIGH` produisent des suggestions.
 *
 * Spec : architecture-review-roofing-pipeline.md §5.4
 * (mapping segments → type de toit + pente)
 *
 * Pur. Aucune dépendance DOM, aucun appel réseau.
 */

import type { RoofModel } from "@/lib/roof-core/types";
import type {
  RoofType as WizardRoofType,
  SlopeCategory,
} from "@/lib/dynasty-calculator";
import type { SolarImageryQuality } from "@/lib/roof-core/adapters/fromSolarAPI";

/* ── Source : snapshot du state courant ───────────────────────────────── */

export interface SolarAutofillSource {
  roofType?: WizardRoofType | null;
  slopeCategory?: SlopeCategory | null;
  /** Pente dominante détectée (X/12) — champ optionnel exposé pour audit. */
  dominantPitchX12?: number | null;
}

/* ── Target ───────────────────────────────────────────────────────────── */

export interface SolarAutofillTarget {
  roofType: WizardRoofType;
  slopeCategory: SlopeCategory;
  dominantPitchX12: number;
  /** Composante du score de complexité dérivée de Solar (cf. §7). */
  azimutVarianceNorm: number;
  /** Estimation grossière du nombre de pignons (cf. §7). */
  estimatedNbPignons: number;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function isEmpty(v: string | number | null | undefined): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return v === 0;
  return false;
}

/**
 * Mappe un nombre de segments Solar (= plans) vers le type de toit du wizard.
 *
 * Heuristique simple :
 *   - 0 segment exploitable : sans suggestion (le caller doit gérer)
 *   - 1-2 segments → `2pans` (gable typique)
 *   - 3-4 segments → `4pans` (hip simple)
 *   - 5+ segments → `4pans_plus` (formes complexes : L, T, dormers…)
 *
 * Le cas `plat` n'est pas dérivé du nombre de segments mais de la pente
 * dominante (cf. `dominantPitchToCategory`).
 */
export function nSegmentsToRoofType(n: number): WizardRoofType {
  if (n <= 2) return "2pans";
  if (n <= 4) return "4pans";
  return "4pans_plus";
}

/**
 * Mappe une pente dominante X/12 vers la catégorie de pente du wizard.
 * Seuils tirés des constantes existantes du dynasty-calculator.
 *
 *   - 0-2/12   → `aucune` (toit plat / membrane)
 *   - 3-5/12   → `legere`
 *   - 6-9/12   → `moderee`
 *   - 10+/12   → `abrupte`
 */
export function dominantPitchToCategory(pitchX12: number): SlopeCategory {
  if (!Number.isFinite(pitchX12) || pitchX12 < 3) return "aucune";
  if (pitchX12 < 6) return "legere";
  if (pitchX12 < 10) return "moderee";
  return "abrupte";
}

/**
 * Pente dominante = moyenne pondérée par la surface 3D approximée des sections.
 *
 * Comme `fromSolarAPI` snape le pitch X/12 et stocke `solar_area_m2` dans
 * `meta.scores`, on peut reconstituer la pondération sans recalculer la
 * surface 3D. Si une section n'a pas d'area renseignée, on lui donne un
 * poids de 1 (équivalent à la moyenne arithmétique de fallback).
 */
function dominantPitchX12(model: RoofModel): number {
  if (!model.sections || model.sections.length === 0) return 0;
  let totalArea = 0;
  let weightedPitch = 0;
  for (const s of model.sections) {
    const area = (s.meta?.scores?.solar_area_m2 as number | undefined) ?? 1;
    totalArea += area;
    weightedPitch += s.pitch * area;
  }
  if (totalArea === 0) return 0;
  return Math.round(weightedPitch / totalArea);
}

/**
 * Variance normalisée des azimuts Solar sur [0, 1].
 *
 * 0  = tous les azimuts sont très proches (toit mono-orienté)
 * 1  = azimuts très hétérogènes (multi-dormers, formes irrégulières)
 *
 * Échantillonnée sur les `meta.scores.solar_azimuth_deg` stockés par
 * l'adaptateur Solar. Si une section manque d'azimut, elle est ignorée.
 *
 * Normalisation : std-dev / 90° clampée à 1.
 */
function azimutVarianceNorm(model: RoofModel): number {
  const azimuts: number[] = [];
  for (const s of model.sections) {
    const az = s.meta?.scores?.solar_azimuth_deg;
    if (typeof az === "number" && Number.isFinite(az)) {
      azimuts.push(az);
    }
  }
  if (azimuts.length < 2) return 0;
  const mean = azimuts.reduce((sum, v) => sum + v, 0) / azimuts.length;
  const variance = azimuts.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / azimuts.length;
  const stdDev = Math.sqrt(variance);
  // 90° de std-dev = grand mélange d'orientations → 1.0
  return Math.min(1, stdDev / 90);
}

/**
 * Estimation grossière du nombre de pignons depuis Solar.
 *
 * Approximation : un hip 4-pans canonique a 0 pignon, chaque section
 * supplémentaire au-delà des 4 versants principaux est ~1 pignon (chien-assis,
 * dormer, extension). Borné à 0 minimum.
 *
 * Sera tuné en Vague C avec l'historique réel. Pour MVP A2 c'est OK.
 */
function estimatedNbPignons(nSections: number): number {
  return Math.max(0, nSections - 4);
}

/* ── Adaptateur ───────────────────────────────────────────────────────── */

/**
 * Produit un patch des champs à appliquer sur l'état du wizard à partir
 * d'un `RoofModel` Solar.
 *
 * Retourne `{}` si :
 *   - `roofModel` null (pas de modèle Solar exploitable)
 *   - `sourceQuality` est 'LOW', 'BASE' ou null (qualité insuffisante)
 *   - Tous les champs cibles déjà remplis côté wizard (règle d'or)
 *
 * Les champs `azimutVarianceNorm` et `estimatedNbPignons` sont retournés
 * même si la qualité est insuffisante quand le modèle existe — ils servent
 * au scoring complexité, pas à l'autofill direct.
 */
export function applySolarData(
  source: SolarAutofillSource,
  roofModel: RoofModel | null,
  sourceQuality: SolarImageryQuality | null,
): Partial<SolarAutofillTarget> {
  if (!roofModel || !roofModel.sections || roofModel.sections.length === 0) {
    return {};
  }

  const patch: Partial<SolarAutofillTarget> = {};

  // Composantes scoring complexité : exposées dès que le modèle existe
  // (utiles même en LOW si le caller veut quand même tenter le score).
  patch.azimutVarianceNorm = azimutVarianceNorm(roofModel);
  patch.estimatedNbPignons = estimatedNbPignons(roofModel.sections.length);

  // Garde-fou qualité pour les suggestions directes (roofType, pente).
  // LOW / BASE / null → on ne suggère pas — l'utilisateur fait à la main.
  if (sourceQuality !== "HIGH" && sourceQuality !== "MEDIUM") {
    return patch;
  }

  const dominantPitch = dominantPitchX12(roofModel);
  if (dominantPitch > 0) {
    patch.dominantPitchX12 = dominantPitch;
    if (isEmpty(source.slopeCategory)) {
      patch.slopeCategory = dominantPitchToCategory(dominantPitch);
    }
  }

  if (isEmpty(source.roofType)) {
    patch.roofType = nSegmentsToRoofType(roofModel.sections.length);
  }

  return patch;
}
