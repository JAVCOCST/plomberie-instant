/**
 * Adaptateur pur : projection des données Brikk MAMH → patch d'état pour
 * le wizard de soumission (`AdminQuoteGenerator`).
 *
 * Contrat :
 *   - **Entrée**  : `BrikkAutofillSource` (le snapshot des champs courants
 *     du wizard) + `FicheBatimentComplete` (résultat de la RPC Brikk).
 *   - **Sortie**  : `Partial<BrikkAutofillTarget>` qui contient SEULEMENT
 *     les champs à mettre à jour côté wizard.
 *
 * Règle d'or UX (cf. architecture-review-roofing-pipeline.md §6.3) :
 *   **Ne JAMAIS écraser une saisie utilisateur.** Le patch ne contient que
 *   les champs qui sont actuellement vides côté wizard (current === null/undefined/0).
 *
 * Pur. Aucun useState, aucun React, aucun appel réseau.
 */

import type { FicheBatimentComplete } from "@/hooks/useAutofillFromAddress";

/* ── Source : snapshot du state courant (subset utile) ────────────────── */

export interface BrikkAutofillSource {
  year_built?: number | null;
  dwelling_count?: number | null;
  floor_count?: number | null;
  /** Adresse courante (string libre + place_id Google). */
  current_address?: string | null;
  current_place_id?: string | null;
}

/* ── Target : champs autorisés à être patchés ─────────────────────────── */

export interface BrikkAutofillTarget {
  year_built: number;
  dwelling_count: number;
  floor_count: number;
  mamh_data_source: string;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function isEmpty(v: number | null | undefined): boolean {
  return v == null || v === 0;
}

/* ── Adaptateur ───────────────────────────────────────────────────────── */

/**
 * Produit un patch des champs MAMH à appliquer sur l'état du wizard.
 *
 * Renvoie un objet vide `{}` si :
 *   - La fiche est null/sans immeuble (pas de match Brikk)
 *   - Aucun champ source MAMH n'est utilisable
 *   - Tous les champs cibles sont déjà remplis côté wizard (règle d'or)
 *
 * Tag `mamh_data_source = 'brikk_mamh_2026'` est ajouté SEULEMENT si on
 * a effectivement patché au moins un champ — c'est l'audit trail demandé
 * par §6.4.
 */
export function applyBrikkData(
  source: BrikkAutofillSource,
  fiche: FicheBatimentComplete | null,
): Partial<BrikkAutofillTarget> {
  if (!fiche?.immeuble) return {};
  const immeuble = fiche.immeuble;
  const patch: Partial<BrikkAutofillTarget> = {};

  if (isEmpty(source.year_built) && typeof immeuble.annee_construction === "number" && immeuble.annee_construction > 0) {
    patch.year_built = immeuble.annee_construction;
  }
  if (isEmpty(source.dwelling_count) && typeof immeuble.nb_logements === "number" && immeuble.nb_logements > 0) {
    patch.dwelling_count = immeuble.nb_logements;
  }
  if (isEmpty(source.floor_count) && typeof immeuble.nb_etages === "number" && immeuble.nb_etages > 0) {
    patch.floor_count = immeuble.nb_etages;
  }

  if (Object.keys(patch).length > 0) {
    patch.mamh_data_source = "brikk_mamh_2026";
  }

  return patch;
}
