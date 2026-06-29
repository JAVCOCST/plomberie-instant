/**
 * useAutofillFromAddress
 * ======================
 *
 * Hook React Query qui agrège les 3 sources de données utilisées par
 * l'autofill des étapes 1-2-3 du module Soumission :
 *
 *   1. Brikk MAMH (via RPC `fiche_batiment_complete`)
 *      → année construction, nb logements, nb étages, superficie habitable,
 *        adresse complète, etc.
 *
 *   2. Google Solar API (via edge function `solar-api`)
 *      → segments de toit (pitch, azimuth, area_m2, bbox).
 *
 *   3. roof-classify (via edge function existante)
 *      → type de couverture matériau (bardeaux / tôle / membrane).
 *
 * Chaque source est requêtée **indépendamment** (3 queries React Query
 * parallèles). Si l'une échoue, les autres restent disponibles — la Vague A2
 * gère la dégradation gracieuse côté UI.
 *
 * **Pas de side-effect ni d'UI ici** : le hook retourne un objet structuré
 * que la Vague A2 consommera pour piloter le wizard étape 1.
 *
 * Spec : docs/architecture-review-roofing-pipeline.md §6.3, §9.3
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ── Types d'entrée ────────────────────────────────────────────────────── */

export interface AutofillAddressInput {
  /**
   * idbati de `batiment_avec_lot` — clé primaire pour la RPC Brikk.
   * Null/undefined = la query Brikk est désactivée (pas de fetch).
   */
  idbati: string | null | undefined;

  /** Coord du centroïde du bâtiment, pour Solar + classify. */
  latitude: number | null | undefined;
  longitude: number | null | undefined;

  /**
   * URL de l'image satellite (ou GeoJSON building) — utilisée par
   * roof-classify. Si non fournie, la query classify est désactivée.
   */
  imageUrl?: string | null;

  /**
   * Vague A2.1 — Adresse texte (format Google Autocomplete, ex:
   * "546 Rue Trépanier, Granby, QC J2H 0A2, Canada"). Passée à la RPC
   * `fiche_batiment_complete` pour matcher par civique+rue+ville dans
   * `brikk.immeubles_unified` quand le matching legacy par matricule
   * échoue (cas typique au Québec où no_lot cadastre ≠ matricule MAMH).
   * Optionnel — si absent, fallback comportement Vague A1.
   */
  addressText?: string | null;
}

/* ── Types Brikk (sous-ensemble de ce que la RPC retourne) ─────────────── */

/**
 * Forme strictement minimale de ce que `fiche_batiment_complete` retourne
 * dans `immeuble`. Tout le reste (champs MAMH supplémentaires) est ignoré
 * par la Vague A1 mais reste accessible via le `raw` ci-dessous.
 *
 * Tous les champs sont nullable parce que :
 *   - le bâtiment peut ne pas avoir de match MAMH (immeuble = null entier)
 *   - certains champs MAMH peuvent être null pour un immeuble donné
 */
export interface BrikkImmeuble {
  matricule: string;
  niue?: string | null;
  adresse_complete?: string | null;
  annee_construction?: number | null;
  nb_logements?: number | null;
  nb_etages?: number | null;
  superficie_habitable_m2?: number | null;
  type_construction?: string | null;
  garage?: boolean | null;
  nb_chambres?: number | null;
  nb_pieces?: number | null;
  municipal_eval_total?: number | null;
  derniere_vente_date?: string | null;
  nom_municipalite_off?: string | null;
  code_geo_municipalite?: string | null;
}

export interface BrikkMunicipalite {
  code_geographique: string;
  nom_territoire?: string | null;
  millesime?: number | null;
}

export interface BrikkBatiment {
  idbati: string;
  no_lot: string | null;
  superficie?: number | null;
  altmin?: number | null;
  altmax?: number | null;
  altmoy?: number | null;
  [k: string]: unknown;
}

export interface FicheBatimentComplete {
  batiment: BrikkBatiment | null;
  immeuble: BrikkImmeuble | null;
  municipalite: BrikkMunicipalite | null;
}

/* ── Types Solar (= output de l'edge function solar-api) ───────────────── */

export interface SolarSummary {
  n_segments: number;
  total_area_m2: number;
  imagery_quality: "HIGH" | "MEDIUM" | "LOW" | "BASE" | null;
  imagery_date: string | null;
}

export interface SolarSegmentLite {
  pitch_deg: number | null;
  azimuth_deg: number | null;
  area_m2: number | null;
  center: { lat: number; lng: number } | null;
  bbox: {
    sw: { lat: number; lng: number };
    ne: { lat: number; lng: number };
  } | null;
}

export interface SolarAPIResult {
  ok: true;
  summary: SolarSummary;
  segments: SolarSegmentLite[];
  cache_hit?: boolean;
  raw?: unknown;
}

/* ── Types roof-classify (= output existant) ───────────────────────────── */

/**
 * Forme conservative — roof-classify peut retourner d'autres champs (les
 * tests existants n'imposent pas de contrat strict). On expose seulement
 * ce dont la Vague A2 a besoin pour l'étape 1.
 */
export interface RoofClassifyResult {
  /** Type de couverture détecté (heuristique vision). */
  roof_type?: string | null;
  /** Confiance 0..1 (si fournie par le classifier). */
  confidence?: number | null;
  [k: string]: unknown;
}

/* ── Output du hook ────────────────────────────────────────────────────── */

export interface SourceStatus<T> {
  data: T | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export interface UseAutofillFromAddressResult {
  brikk: SourceStatus<FicheBatimentComplete>;
  solar: SourceStatus<SolarAPIResult>;
  classify: SourceStatus<RoofClassifyResult>;
  /**
   * `true` tant qu'au moins une source est en cours de chargement.
   * `false` quand les 3 sont terminées (succès ou erreur).
   */
  isLoadingAny: boolean;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function isFiniteLatLng(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === "number" && isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === "number" && isFinite(lng) && lng >= -180 && lng <= 180
  );
}

const STALE_TIME_MS = 1000 * 60 * 10; // 10 minutes — la Brikk MAMH change 1×/an, Solar peu

/* ── Hook ──────────────────────────────────────────────────────────────── */

export function useAutofillFromAddress(input: AutofillAddressInput): UseAutofillFromAddressResult {
  // 1) Brikk via RPC. Vague A2.1 : on passe aussi `p_address` à la RPC pour
  //    permettre le matching civique+rue+ville (cf. migration v2). Backward-
  //    compat avec la signature A1 : si `addressText` n'est pas fourni, la
  //    RPC fait juste le matching legacy par matricule.
  const brikkQuery = useQuery<FicheBatimentComplete | null, Error>({
    queryKey: ["autofill", "brikk", input.idbati, input.addressText ?? null],
    enabled: !!input.idbati,
    staleTime: STALE_TIME_MS,
    queryFn: async () => {
      if (!input.idbati) return null;
      const rpcArgs: Record<string, unknown> = { p_idbati: input.idbati };
      if (input.addressText) rpcArgs.p_address = input.addressText;
      const { data, error } = await supabase.rpc("fiche_batiment_complete", rpcArgs);
      if (error) throw new Error(error.message);
      // Cast prudent : la RPC retourne jsonb, le client le voit comme `unknown`.
      // On valide minimalement la shape avant de cast.
      if (data && typeof data === "object" && "batiment" in data) {
        return data as FicheBatimentComplete;
      }
      return null;
    },
  });

  // 2) Solar via edge function
  const solarQuery = useQuery<SolarAPIResult | null, Error>({
    queryKey: ["autofill", "solar", input.latitude, input.longitude],
    enabled: isFiniteLatLng(input.latitude, input.longitude),
    staleTime: STALE_TIME_MS,
    queryFn: async () => {
      if (!isFiniteLatLng(input.latitude, input.longitude)) return null;
      const { data, error } = await supabase.functions.invoke("solar-api", {
        body: {
          latitude: input.latitude,
          longitude: input.longitude,
          caller: "admin_quote",
        },
      });
      if (error) {
        // Supabase JS masque souvent le message — on extrait si possible.
        const ctx = (error as unknown as { context?: { body?: { error?: string } } }).context;
        throw new Error(ctx?.body?.error ?? error.message);
      }
      if (!data || typeof data !== "object" || !("ok" in data) || (data as { ok: unknown }).ok !== true) {
        // Solar a renvoyé une erreur HTTP : on lève pour que le caller bascule sur le fallback.
        const errMsg = typeof (data as { error?: string })?.error === "string"
          ? (data as { error?: string }).error
          : "Solar API a renvoyé une réponse invalide";
        throw new Error(errMsg);
      }
      return data as SolarAPIResult;
    },
    // 404 Solar (bâtiment hors zone) ne doit pas spammer les retries
    retry: (failureCount, err) => {
      if (failureCount >= 1) return false;
      // Si le message contient "404" ou "NOT_FOUND", on ne retry pas.
      const msg = err.message?.toLowerCase() ?? "";
      if (msg.includes("not_found") || msg.includes("404")) return false;
      return true;
    },
  });

  // 3) roof-classify via edge function existante.
  //
  // Vague A2.1 — fix signature : la fn `roof-classify` attend strictement
  // `{ lat: number, lng: number, satelliteZoom18Url, satelliteZoom21Url }`
  // avec les 2 URLs Google Maps Static (validées via `isAllowedGoogleUrl`).
  // Sans ces 2 URLs valides → la fn renvoie HTTP 400 "Invalid image URLs".
  //
  // Au moment du autofill étape 1, on n'a normalement PAS encore d'images
  // satellite capturées (c'est le Tracer 3D qui les génère plus tard). On
  // dégrade donc gracieusement : si `imageUrl` n'est pas fournie au hook,
  // la query reste désactivée → l'indicateur affichera "N/A" (au lieu de
  // "erreur API"). Le wizard utilisera la signature OpenAI vision plus tard
  // dans le tracer.
  const classifyEnabled = isFiniteLatLng(input.latitude, input.longitude) && !!input.imageUrl;
  const classifyQuery = useQuery<RoofClassifyResult | null, Error>({
    queryKey: ["autofill", "classify", input.latitude, input.longitude, input.imageUrl ?? null],
    enabled: classifyEnabled,
    staleTime: STALE_TIME_MS,
    queryFn: async () => {
      if (!classifyEnabled) return null;
      // Format conforme à la signature actuelle de roof-classify (cf.
      // supabase/functions/roof-classify/index.ts). Si on n'a qu'une seule
      // image, on l'envoie comme zoom18 ET zoom21 — la fn les accepte.
      const body: Record<string, unknown> = {
        lat: input.latitude,
        lng: input.longitude,
        satelliteZoom18Url: input.imageUrl,
        satelliteZoom21Url: input.imageUrl,
      };
      const { data, error } = await supabase.functions.invoke("roof-classify", {
        body,
      });
      if (error) {
        const ctx = (error as unknown as { context?: { body?: { error?: string } } }).context;
        throw new Error(ctx?.body?.error ?? error.message);
      }
      if (!data || typeof data !== "object") return null;
      return data as RoofClassifyResult;
    },
    // Idem : pas de retry agressif sur 404
    retry: 0,
  });

  return {
    brikk: {
      data: brikkQuery.data ?? null,
      isLoading: brikkQuery.isLoading,
      isError: brikkQuery.isError,
      error: (brikkQuery.error as Error | null) ?? null,
    },
    solar: {
      data: solarQuery.data ?? null,
      isLoading: solarQuery.isLoading,
      isError: solarQuery.isError,
      error: (solarQuery.error as Error | null) ?? null,
    },
    classify: {
      data: classifyQuery.data ?? null,
      isLoading: classifyQuery.isLoading,
      isError: classifyQuery.isError,
      error: (classifyQuery.error as Error | null) ?? null,
    },
    isLoadingAny:
      brikkQuery.isLoading || solarQuery.isLoading || classifyQuery.isLoading,
  };
}
