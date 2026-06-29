/**
 * useSolarRoofModel
 * =================
 *
 * Hook qui combine `useAutofillFromAddress` (sous-source Solar uniquement)
 * avec l'adaptateur pur `fromSolarAPI` pour produire un `RoofModel`
 * directement consommable par le Tracer 3D en aval (Vague A2).
 *
 * Le caller (en Vague A2, typiquement `AdminQuoteGenerator` étape 3)
 * passe les `mapParams` (centre + zoom + dimensions de l'image satellite
 * sur laquelle on veut afficher le modèle) et reçoit :
 *   - `roofModel` : un `RoofModel` prêt à seed le Tracer, ou null si
 *     Solar a échoué / qualité insuffisante.
 *   - `sourceQuality` : la qualité Solar reportée (HIGH / MEDIUM / LOW / BASE).
 *   - `isLoading` / `error` : état React Query simplifié.
 *   - `stats` : compteurs de skip pour observabilité.
 *
 * **Pas de side-effect** : pas d'écriture en DB, pas de toast. La Vague A2
 * décide de seeder le tracer ou de proposer le fallback manuel.
 *
 * Spec : docs/architecture-review-roofing-pipeline.md §9.2, §9.3
 */

import { useMemo } from "react";
import { useAutofillFromAddress, type AutofillAddressInput } from "./useAutofillFromAddress";
import {
  fromSolarAPI,
  type FromSolarAPIResult,
  type SolarAPIDigested,
  type SolarMapParams,
} from "@/lib/roof-core/adapters/fromSolarAPI";

export interface UseSolarRoofModelInput {
  /** Lat/lng du centroïde du bâtiment (pour l'appel Solar). */
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  /**
   * Paramètres de la carte Static Maps qui produit l'image satellite affichée
   * dans le Tracer 3D. Le `RoofModel` retourné aura ses polygones projetés
   * dans CETTE image.
   *
   * `null` ⇒ le hook attend que le caller lui fournisse mapParams avant de
   * générer le modèle. Évite de générer un modèle avec des coordonnées
   * incohérentes par rapport à l'image affichée.
   */
  mapParams: SolarMapParams | null;
}

export interface UseSolarRoofModelResult {
  roofModel: FromSolarAPIResult["model"];
  sourceQuality: FromSolarAPIResult["sourceQuality"] | null;
  stats: FromSolarAPIResult["stats"] | null;
  isLoading: boolean;
  error: Error | null;
}

export function useSolarRoofModel(input: UseSolarRoofModelInput): UseSolarRoofModelResult {
  // On consomme uniquement la sous-source Solar du hook agrégateur.
  // L'idbati et l'imageUrl sont volontairement omis pour ne pas déclencher
  // Brikk + classify quand on ne veut que le RoofModel.
  const autofillInput: AutofillAddressInput = {
    idbati: null,
    latitude: input.latitude,
    longitude: input.longitude,
    imageUrl: null,
  };
  const { solar } = useAutofillFromAddress(autofillInput);

  const result = useMemo<UseSolarRoofModelResult>(() => {
    if (solar.isLoading) {
      return {
        roofModel: null,
        sourceQuality: null,
        stats: null,
        isLoading: true,
        error: null,
      };
    }
    if (solar.isError) {
      return {
        roofModel: null,
        sourceQuality: null,
        stats: null,
        isLoading: false,
        error: solar.error,
      };
    }
    if (!solar.data || !input.mapParams) {
      // Pas de data Solar (lat/lng manquant) OU pas de mapParams (le caller
      // n'a pas encore décidé du cadre image). On ne génère pas de modèle.
      return {
        roofModel: null,
        sourceQuality: null,
        stats: null,
        isLoading: false,
        error: null,
      };
    }
    const adapter = fromSolarAPI(solar.data as SolarAPIDigested, input.mapParams);
    return {
      roofModel: adapter.model,
      sourceQuality: adapter.sourceQuality,
      stats: adapter.stats,
      isLoading: false,
      error: null,
    };
  }, [solar.data, solar.isLoading, solar.isError, solar.error, input.mapParams]);

  return result;
}
