/**
 * Recommandation des modèles de soumission depuis l'historique 30 derniers
 * jours, pour l'étape 2 du wizard.
 *
 * Spec : architecture-review-roofing-pipeline.md §5.3
 *
 * Stratégie :
 *   - Match sur (coverage_type, brand, product_name, roof_type, slope_category,
 *     work_type, nb_logements_bracket) si dispo
 *   - Top 3 par fréquence d'usage sur les 30 derniers jours
 *   - Si 1 match exact → suggestion unique
 *   - Si 0 match exact → fallback sur match dégradé (sans nb_logements_bracket)
 *   - Si 0 match dégradé → retourne []
 *
 * Le hook caller (étape 2 du wizard) décide comment afficher : auto-select
 * si 1 match, badge "Top match (N uses)" si plusieurs.
 */

import { supabase } from "@/integrations/supabase/client";

export interface SuggestTemplateCriteria {
  coverage_type?: string | null;
  product_brand?: string | null;
  product_name?: string | null;
  roof_type?: string | null;
  slope_category?: string | null;
  work_type?: string | null;
  /** Nombre de logements bracketé : 1 / 2-3 / 4+ */
  nb_logements?: number | null;
}

export interface SuggestedTemplate {
  /** ID de la soumission de référence (pas l'ID d'un template — on s'appuie
   *  sur les soumissions approuvées existantes comme templates). */
  soumission_id: string;
  /** Description courte pour l'UI (ex: "Bardeaux IKO – Cambridge – 4pans – moderee"). */
  label: string;
  /** Compte d'usages sur 30 jours (= fréquence du même tuple). */
  uses_30d: number;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function bracketLogements(n: number | null | undefined): "1" | "2-3" | "4+" {
  if (typeof n !== "number" || n <= 1) return "1";
  if (n <= 3) return "2-3";
  return "4+";
}

function buildLabel(row: {
  coverage_type?: string | null;
  product_brand?: string | null;
  product_name?: string | null;
  roof_category?: string | null;
  slope?: string | null;
}): string {
  const parts: string[] = [];
  if (row.product_brand) parts.push(row.product_brand);
  if (row.product_name) parts.push(row.product_name);
  if (row.roof_category) parts.push(row.roof_category);
  if (row.slope) parts.push(row.slope);
  if (parts.length === 0 && row.coverage_type) parts.push(row.coverage_type);
  return parts.join(" – ") || "Soumission récente";
}

/* ── Public API ───────────────────────────────────────────────────────── */

/**
 * Cherche les 3 meilleurs templates parmi les soumissions des 30 derniers
 * jours qui matchent le tuple de critères.
 *
 * Retourne `[]` si :
 *   - Aucun critère n'est fourni (pas de tuple à matcher)
 *   - La query Supabase échoue (gracieux — pas de throw, juste un log)
 *   - Aucune soumission ne matche
 */
export async function suggestTemplate(
  criteria: SuggestTemplateCriteria,
): Promise<SuggestedTemplate[]> {
  // Doit avoir au minimum coverage_type pour proposer quelque chose
  if (!criteria.coverage_type) return [];

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const bracket = bracketLogements(criteria.nb_logements);

  // 1) Match exact (tuple complet) → on récupère brut puis on aggrège côté JS
  //    parce que Supabase JS ne supporte pas GROUP BY ergonomiquement.
  //    Colonnes utilisées (cf. snapshot `soumissions` au 2026-06-07) :
  //      - `roof_category` (et non `roof_type`)
  //      - `slope` (et non `slope_category`)
  const exactCols = "id, coverage_type, product_brand, product_name, roof_category, slope, work_type, dwelling_count, created_at";

  let query = supabase
    .from("soumissions")
    .select(exactCols)
    .gte("created_at", since)
    .eq("coverage_type", criteria.coverage_type);

  if (criteria.product_brand) query = query.eq("product_brand", criteria.product_brand);
  if (criteria.product_name) query = query.eq("product_name", criteria.product_name);
  if (criteria.roof_type) query = query.eq("roof_category", criteria.roof_type);
  if (criteria.slope_category) query = query.eq("slope", criteria.slope_category);
  if (criteria.work_type) query = query.eq("work_type", criteria.work_type);

  query = query.order("created_at", { ascending: false }).limit(50);

  const { data: exactRows, error: exactErr } = await query;

  if (exactErr) {
    // Pas de throw — le hook caller voit `[]` et bascule sur le sélecteur manuel.
    // eslint-disable-next-line no-console
    console.warn("[suggestTemplate] exact query error:", exactErr.message);
    return [];
  }

  // Filtre supplémentaire en mémoire pour le bracket logements (la colonne
  // `dwelling_count` peut être null sur les soumissions antérieures à A2).
  const matched = (exactRows ?? []).filter((r) => {
    if (criteria.nb_logements == null) return true;
    const rowBracket = bracketLogements(r.dwelling_count);
    return rowBracket === bracket;
  });

  if (matched.length === 0) return [];

  // Aggrégation : on dédoublonne par tuple de fait (coverage + brand + product
  // + roof + slope) et on compte les hits. Le `soumission_id` retourné = la
  // plus récente (created_at DESC est déjà appliqué côté DB).
  type Bucket = {
    soumission_id: string;
    label: string;
    uses_30d: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const row of matched) {
    const key = [
      row.coverage_type ?? "",
      row.product_brand ?? "",
      row.product_name ?? "",
      row.roof_category ?? "",
      row.slope ?? "",
    ].join("|");
    const existing = buckets.get(key);
    if (existing) {
      existing.uses_30d += 1;
    } else {
      buckets.set(key, {
        soumission_id: row.id,
        label: buildLabel(row),
        uses_30d: 1,
      });
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.uses_30d - a.uses_30d)
    .slice(0, 3);
}
