/**
 * AutofillCoordinator
 * ───────────────────
 *
 * Encapsule l'ensemble de la logique d'auto-remplissage de la Vague A2 :
 *   1. Lookup `idbati` depuis `noLot` via RPC `idbati_from_no_lot`
 *   2. `useAutofillFromAddress` (Brikk MAMH + Solar API + roof-classify)
 *   3. `useSolarRoofModel` pour produire un `RoofModel` côté front
 *   4. Application des patches via `applyBrikkData` + `applySolarData`
 *      (en respectant la règle d'or : jamais écraser une saisie utilisateur)
 *   5. Suggestion de templates via `suggestTemplate`
 *   6. Rendu du `AutofillBanner` qui montre l'état des 3 sources
 *
 * **Le coordinator n'est mounté QUE si le feature flag est ON côté caller**
 * (cf. `AdminQuoteGenerator.tsx` qui le wrappe dans `{AUTOFILL_ENABLED && ...}`).
 * En flag OFF → composant non rendu → hooks jamais appelés → aucune query
 * React Query, aucune RPC, aucun appel à l'edge function `solar-api`.
 *
 * Pattern de communication avec le parent (AdminQuoteGenerator) :
 *   - Le coordinator REÇOIT les valeurs courantes (snapshot read-only)
 *   - Le coordinator APPELLE des callbacks `onSetX(value)` pour mettre à
 *     jour le state du parent. Le parent reste seul maître de son state.
 *   - Le coordinator n'écrit JAMAIS dans le DOM sauf via son banner.
 *
 * Spec :
 *   - architecture-review-roofing-pipeline.md §5 (plan étapes 1-2-3)
 *   - §6 (Brikk), §7 (complexité), §8 (évents)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

import {
  useAutofillFromAddress,
  type FicheBatimentComplete,
} from '@/hooks/useAutofillFromAddress';
import { useSolarRoofModel } from '@/hooks/useSolarRoofModel';
import {
  applyBrikkData,
  type BrikkAutofillSource,
} from '@/lib/quote-autofill/applyBrikkData';
import {
  applySolarData,
  type SolarAutofillSource,
} from '@/lib/quote-autofill/applySolarData';
import {
  estimateEventsPlomberie,
  computeComplexityScore,
  complexityScoreToCategory,
} from '@/lib/quote-autofill/heuristics';
import {
  suggestTemplate,
  type SuggestedTemplate,
  type SuggestTemplateCriteria,
} from '@/lib/quote-autofill/suggestTemplate';

import AutofillBanner, {
  type AutofillBannerSource,
  type SourceState,
} from '@/components/roofing/immersive/AutofillBanner';

import type {
  RoofType as WizardRoofType,
  SlopeCategory,
} from '@/lib/dynasty-calculator';
import type { ComplexityLevel } from '@/types/roofing';
import type { RoofModel } from '@/lib/roof-core/types';

/* ── Props (contrat avec AdminQuoteGenerator) ──────────────────────────── */

export interface AutofillCoordinatorProps {
  /** Adresse + coord courantes. Null tant que l'utilisateur n'a pas confirmé. */
  lat: number | null;
  lng: number | null;
  /** no_lot du cadastre rénové, format brut tel que stocké côté DB ("5 558 683"). */
  noLot: string | null;
  /**
   * Vague A2.1 — Adresse texte format Google Autocomplete (ex:
   * "546 Rue Trépanier, Granby, QC J2H 0A2, Canada"). Permet le matching
   * MAMH par civique+rue+ville (cf. RPC fiche_batiment_complete v2).
   * Optionnel — si absent, fallback comportement A2 (matching matricule
   * uniquement).
   */
  addressText?: string | null;
  /** Image satellite déjà capturée (utile pour roof-classify). */
  satelliteImageUrl?: string | null;

  /** Snapshot des valeurs actuelles du wizard (pour respecter "jamais écraser"). */
  currentValues: {
    year_built: number | null;
    dwelling_count: number | null;
    floor_count: number | null;
    roofType: WizardRoofType | null;
    slopeCategory: SlopeCategory | null;
    complexity: ComplexityLevel | null;
    coverageType: string | null;
    productBrand: string | null;
    productName: string | null;
    workType: string | null;
  };

  /** Callbacks de patch (le parent reste maître de son state). */
  onSetYearBuilt: (v: number) => void;
  onSetDwellingCount: (v: number) => void;
  onSetFloorCount: (v: number) => void;
  onSetMamhDataSource: (v: string) => void;
  onSetRoofType: (v: WizardRoofType) => void;
  onSetSlopeCategory: (v: SlopeCategory) => void;
  onSetComplexity: (v: ComplexityLevel) => void;
  onSetEventsPlomberie?: (v: number) => void;

  /** Rendu optionnel des suggestions de templates étape 2. */
  onTemplatesSuggested?: (templates: SuggestedTemplate[]) => void;

  /**
   * Callback étape 3 : quand l'utilisateur clique "Seeder le tracer depuis
   * Solar", on lui passe le `RoofModel` produit par Solar. Côté AQG, ça
   * setRoof3dModel(model) + setTakeoffOpen(true).
   * Si la prop n'est pas fournie ou si `solar.roofModel` est null, le
   * bouton n'apparaît pas.
   */
  onSeedFromSolar?: (roofModel: RoofModel) => void;

  /**
   * Vague A2.1 — Auto-déclenche le lookup propriétaire (via fetchOwner côté
   * AQG) dès que l'utilisateur clique Run et qu'un noLot est connu. Évite
   * que l'utilisateur ait à cliquer "Rechercher le propriétaire" manuellement.
   * Si la prop n'est pas fournie, l'auto-fetch est désactivé.
   */
  onAutoFetchOwner?: (lotNum: string) => void;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function brikkState(
  isLoading: boolean,
  isError: boolean,
  hasIdbati: boolean,
  hasImmeuble: boolean,
): SourceState {
  if (!hasIdbati) return 'na';
  if (isLoading) return 'loading';
  if (isError) return 'error';
  return hasImmeuble ? 'ok' : 'na';
}

function solarState(
  isLoading: boolean,
  error: Error | null,
  hasRoofModel: boolean,
): SourceState {
  if (isLoading) return 'loading';
  if (error) return 'error';
  return hasRoofModel ? 'ok' : 'na';
}

function classifyState(
  isLoading: boolean,
  isError: boolean,
  hasData: boolean,
): SourceState {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  return hasData ? 'ok' : 'na';
}

/* ── Composant principal ──────────────────────────────────────────────── */

export default function AutofillCoordinator(props: AutofillCoordinatorProps) {
  // ── Vague A2.1 — Gating manuel par bouton Run ────────────────────────
  // Tant que `runArmed === false`, aucune query (idbati, Brikk, Solar,
  // classify, useSolarRoofModel) ne se lance. L'utilisateur doit cliquer
  // explicitement le bouton "Lancer l'auto-remplissage" dans le banner.
  //
  // Reset automatique sur changement d'adresse (lat/lng/noLot) : si
  // l'utilisateur change d'adresse après un premier Run, le banner
  // redevient pré-armé et il faut re-cliquer.
  const [runArmed, setRunArmed] = useState(false);
  useEffect(() => {
    setRunArmed(false);
  }, [props.lat, props.lng, props.noLot]);

  // ── 1. Lookup idbati depuis noLot (via RPC créée en Vague A2) ─────────
  const idbatiQuery = useQuery<string | null, Error>({
    queryKey: ['autofill', 'idbati', props.noLot],
    // Gating Vague A2.1 : query désactivée tant que Run pas cliqué.
    enabled: !!props.noLot && runArmed,
    staleTime: 1000 * 60 * 30, // 30 min — no_lot ne change pas
    queryFn: async () => {
      if (!props.noLot) return null;
      const { data, error } = await supabase.rpc('idbati_from_no_lot', {
        p_no_lot: props.noLot,
      });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    },
    retry: 0,
  });
  const idbati = idbatiQuery.data ?? null;

  // ── 2. Hooks Vague A1 (Brikk + Solar + classify) ─────────────────────
  //      Gating Vague A2.1 : on passe `null` partout tant que `runArmed`
  //      est false → les `enabled` internes des useQuery sont false → 0 fetch.
  const autofill = useAutofillFromAddress({
    idbati: runArmed ? idbati : null,
    latitude: runArmed ? props.lat : null,
    longitude: runArmed ? props.lng : null,
    imageUrl: runArmed ? (props.satelliteImageUrl ?? null) : null,
    // Vague A2.1 — addressText passé à la RPC pour matching civique+rue+ville
    // dans brikk.immeubles_unified (cf. migration v2).
    addressText: runArmed ? (props.addressText ?? null) : null,
  });

  const mapParams = useMemo(
    () =>
      runArmed && props.lat != null && props.lng != null
        ? {
            centerLat: props.lat,
            centerLng: props.lng,
            zoom: 20,
            imageWidth: 1280,
            imageHeight: 1280,
            scaleParam: 2,
            provider: 'google',
          }
        : null,
    [runArmed, props.lat, props.lng],
  );

  const solar = useSolarRoofModel({
    latitude: runArmed ? props.lat : null,
    longitude: runArmed ? props.lng : null,
    mapParams,
  });

  // ── 3. Effets d'autofill : un patch par source, ne touche que les
  //      champs vides. Les dépendances incluent les `currentValues` pour
  //      éviter d'écraser une saisie utilisateur tardive.
  //
  //      ATTENTION : on lit currentValues SEULEMENT au moment où une nouvelle
  //      donnée arrive (deps = autofill.brikk.data). Sinon on re-déclencherait
  //      l'autofill à chaque keystroke de l'utilisateur.
  useEffect(() => {
    if (!autofill.brikk.data) return;
    const brikkSource: BrikkAutofillSource = {
      year_built: props.currentValues.year_built,
      dwelling_count: props.currentValues.dwelling_count,
      floor_count: props.currentValues.floor_count,
    };
    const patch = applyBrikkData(brikkSource, autofill.brikk.data as FicheBatimentComplete);
    if (patch.year_built !== undefined) props.onSetYearBuilt(patch.year_built);
    if (patch.dwelling_count !== undefined) props.onSetDwellingCount(patch.dwelling_count);
    if (patch.floor_count !== undefined) props.onSetFloorCount(patch.floor_count);
    if (patch.mamh_data_source) props.onSetMamhDataSource(patch.mamh_data_source);
    // Évents plomberie : dépend de dwelling_count + floor_count POST-patch.
    // On utilise les valeurs patchées si dispo, sinon les courantes.
    if (props.onSetEventsPlomberie) {
      const dw = patch.dwelling_count ?? props.currentValues.dwelling_count;
      const fl = patch.floor_count ?? props.currentValues.floor_count;
      if (dw != null && dw > 0) {
        props.onSetEventsPlomberie(estimateEventsPlomberie(dw, fl));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autofill.brikk.data]);

  useEffect(() => {
    if (!solar.roofModel) return;
    const solarSource: SolarAutofillSource = {
      roofType: props.currentValues.roofType,
      slopeCategory: props.currentValues.slopeCategory,
    };
    const patch = applySolarData(solarSource, solar.roofModel, solar.sourceQuality);
    if (patch.roofType) props.onSetRoofType(patch.roofType);
    if (patch.slopeCategory) props.onSetSlopeCategory(patch.slopeCategory);

    // Score de complexité — uniquement si les composantes Solar sont fiables
    if (
      patch.azimutVarianceNorm != null &&
      patch.estimatedNbPignons != null &&
      patch.dominantPitchX12 != null &&
      props.currentValues.complexity == null
    ) {
      const score = computeComplexityScore({
        solar_n_segments: solar.roofModel.sections.length,
        solar_max_pitch_x12: patch.dominantPitchX12 ?? 0,
        solar_n_pignons: patch.estimatedNbPignons,
        brikk_nb_etages: props.currentValues.floor_count,
        solar_azimut_variance_norm: patch.azimutVarianceNorm,
        brikk_nb_logements: props.currentValues.dwelling_count,
      });
      props.onSetComplexity(complexityScoreToCategory(score));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solar.roofModel, solar.sourceQuality]);

  // ── 4. Suggestion de templates (étape 2). Déclenchée quand on a un
  //      tuple matchable (coverageType au minimum).
  const templatesQuery = useQuery<SuggestedTemplate[], Error>({
    queryKey: [
      'autofill', 'templates',
      props.currentValues.coverageType,
      props.currentValues.productBrand,
      props.currentValues.productName,
      props.currentValues.roofType,
      props.currentValues.slopeCategory,
      props.currentValues.workType,
      props.currentValues.dwelling_count,
    ],
    enabled: !!props.currentValues.coverageType,
    staleTime: 1000 * 60 * 5, // 5 min
    queryFn: async () => {
      const criteria: SuggestTemplateCriteria = {
        coverage_type: props.currentValues.coverageType,
        product_brand: props.currentValues.productBrand,
        product_name: props.currentValues.productName,
        roof_type: props.currentValues.roofType,
        slope_category: props.currentValues.slopeCategory,
        work_type: props.currentValues.workType,
        nb_logements: props.currentValues.dwelling_count,
      };
      return await suggestTemplate(criteria);
    },
    retry: 0,
  });

  useEffect(() => {
    if (templatesQuery.data && props.onTemplatesSuggested) {
      props.onTemplatesSuggested(templatesQuery.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templatesQuery.data]);

  // ── 5. Construire les sources affichées dans le banner ───────────────
  const bannerSources: AutofillBannerSource[] = useMemo(() => {
    const brikkS = brikkState(
      idbatiQuery.isLoading || autofill.brikk.isLoading,
      autofill.brikk.isError || idbatiQuery.isError,
      !!idbati,
      !!autofill.brikk.data?.immeuble,
    );
    const solarS = solarState(solar.isLoading, solar.error, !!solar.roofModel);
    const classifyS = classifyState(
      autofill.classify.isLoading,
      autofill.classify.isError,
      !!autofill.classify.data,
    );
    return [
      {
        label: 'MAMH',
        state: brikkS,
        hint:
          brikkS === 'ok' ? 'année, logements, étages' :
          brikkS === 'na' && !props.noLot ? 'no_lot manquant' :
          // Vague A2.1 : "hors zone" était techniquement faux — le bâtiment
          // est dans la zone géographique mais pas dans les données MAMH.
          // 38% des bâtiments de Granby sont dans ce cas, c'est normal.
          brikkS === 'na' ? 'Pas de données municipales pour ce bâtiment' :
          brikkS === 'error' ? 'erreur RPC' :
          'chargement…',
      },
      {
        label: 'Solar',
        state: solarS,
        hint:
          solarS === 'ok'
            ? `${solar.roofModel?.sections.length ?? 0} pans · ${solar.sourceQuality ?? '?'}`
            : solarS === 'na'
              ? 'imagery indisponible'
              : solarS === 'error'
                ? 'erreur API'
                : 'chargement…',
      },
      {
        label: 'Type couv.',
        state: classifyS,
        hint:
          classifyS === 'ok'
            ? (autofill.classify.data?.roof_type ?? 'classifié')
            : classifyS === 'error'
              ? 'erreur API'
              : classifyS === 'na' && !props.satelliteImageUrl
                ? 'classification dans le tracer 3D'
                : '',
      },
    ];
  }, [
    idbatiQuery.isLoading, idbatiQuery.isError, idbati,
    autofill.brikk.isLoading, autofill.brikk.isError, autofill.brikk.data,
    autofill.classify.isLoading, autofill.classify.isError, autofill.classify.data,
    solar.isLoading, solar.error, solar.roofModel, solar.sourceQuality,
    props.noLot,
  ]);

  const isRefreshing = autofill.isLoadingAny || idbatiQuery.isFetching;
  const [refreshTick, setRefreshTick] = useState(0);

  // Bouton étape 3 — seed du tracer depuis Solar. Visible quand un modèle
  // Solar exploitable est disponible (quality !== 'BASE' / 'LOW') ET que
  // le caller a fourni un handler.
  const canSeedFromSolar = !!(
    solar.roofModel &&
    (solar.sourceQuality === 'HIGH' || solar.sourceQuality === 'MEDIUM') &&
    props.onSeedFromSolar
  );

  // Le bouton Run n'est activable que si on a au minimum lat+lng (l'adresse
  // a été confirmée via Google Maps autocomplete). Sans coord, rien ne peut
  // se lancer.
  const canArmRun = props.lat != null && props.lng != null;

  // Vague A2.1 — Auto-trigger du lookup propriétaire dès que Run est cliqué
  // et qu'un noLot est connu. Un ref pour ne déclencher qu'une seule fois
  // par adresse (sinon ça spammerait l'edge function `fetch-owner`).
  const ownerFetchedForLotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!runArmed) return;
    if (!props.noLot) return;
    if (!props.onAutoFetchOwner) return;
    if (ownerFetchedForLotRef.current === props.noLot) return;
    ownerFetchedForLotRef.current = props.noLot;
    props.onAutoFetchOwner(props.noLot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runArmed, props.noLot]);
  // Reset du flag quand l'adresse change → permet de re-fetch sur la nouvelle.
  useEffect(() => {
    ownerFetchedForLotRef.current = null;
  }, [props.lat, props.lng, props.noLot]);

  // Vague A2.1 — Détection du cas "bâtiment connu mais absent de MAMH".
  // C'est le cas exact où :
  //   - props.noLot est fourni (l'utilisateur a une adresse confirmée)
  //   - idbatiQuery a réussi (le bâtiment est dans `batiment_avec_lot`)
  //   - fiche_batiment_complete a réussi (la RPC retourne un objet)
  //   - mais `immeuble` est null (Brikk MAMH ne connaît pas ce matricule)
  // ≈ 38% des bâtiments de Granby sont dans ce cas (couverture MAMH
  // incomplète). Pas un bug — manque de données upstream.
  const mamhDataMissing = !!(
    runArmed
    && props.noLot
    && idbati
    && autofill.brikk.data
    && !autofill.brikk.data.immeuble
    && !autofill.brikk.isLoading
  );

  return (
    <div className="flex flex-col gap-2">
      <AutofillBanner
        key={refreshTick /* re-render forced quand actualiser */}
        sources={bannerSources}
        isRefreshing={isRefreshing}
        armed={runArmed}
        canArm={canArmRun}
        onArm={() => setRunArmed(true)}
        onRefresh={() => {
          // Invalidate les queries → re-fetch propre
          idbatiQuery.refetch();
          templatesQuery.refetch();
          setRefreshTick((t) => t + 1);
        }}
      />
      {/* Vague A2.1 — Avertissement MAMH absent.
          Affiché quand le bâtiment est connu du cadastre rénové
          (`batiment_avec_lot`) mais pas de la base municipale MAMH
          (`brikk.immeubles_unified`). Important pour distinguer un bug de
          récupération d'un vrai manque de données upstream. */}
      {mamhDataMissing && (
        <div
          className="rounded-md border border-sky-700/60 bg-sky-900/30 px-3 py-2 text-xs text-sky-100"
          role="status"
        >
          <div>
            ℹ️ <strong>Aucune fiche MAMH disponible pour ce bâtiment.</strong>
            {' '}La table <code className="px-1 rounded bg-sky-950/60 font-mono text-[10.5px]">brikk.immeubles_unified</code> ne contient pas de données pour le matricule <code className="px-1 rounded bg-sky-950/60 font-mono text-[10.5px]">{props.noLot?.replace(/\s+/g, '')}</code>.
            {' '}Ce n'est pas un bug de récupération — environ 38% des bâtiments
            de Granby ne sont pas couverts par les données MAMH publiées par
            Brikk Finance Québec.
          </div>
          {/* Vague A2.1 — Saisie manuelle inline des 3 champs MAMH quand
              la fiche est absente. Non-contrôlés (write-only via ref) pour
              minimiser le state. Stockés dans `autofillValuesRef` côté parent
              et persistés au save. Les `min` empêchent les saisies absurdes
              côté navigateur. */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="flex flex-col text-[10.5px] text-sky-200">
              Année construction
              <input
                type="number"
                min={1700}
                max={new Date().getFullYear()}
                placeholder="ex: 1968"
                defaultValue={props.currentValues.year_built ?? ''}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v > 0) props.onSetYearBuilt(v);
                }}
                className="mt-0.5 rounded bg-sky-950/40 border border-sky-800/60 px-2 py-1 text-sky-50 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
            <label className="flex flex-col text-[10.5px] text-sky-200">
              Nb logements
              <input
                type="number"
                min={1}
                max={999}
                placeholder="ex: 1"
                defaultValue={props.currentValues.dwelling_count ?? ''}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v > 0) props.onSetDwellingCount(v);
                }}
                className="mt-0.5 rounded bg-sky-950/40 border border-sky-800/60 px-2 py-1 text-sky-50 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
            <label className="flex flex-col text-[10.5px] text-sky-200">
              Nb étages
              <input
                type="number"
                min={1}
                max={99}
                placeholder="ex: 1"
                defaultValue={props.currentValues.floor_count ?? ''}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v > 0) props.onSetFloorCount(v);
                }}
                className="mt-0.5 rounded bg-sky-950/40 border border-sky-800/60 px-2 py-1 text-sky-50 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
          </div>
        </div>
      )}
      {/* Vague A2.1 — Avertissement qualité Solar LOW.
          Quand Google retourne une imagery LOW (qualité dégradée — typique
          des petites villes du Québec), on n'auto-remplit PAS le roofType
          et la slopeCategory (cf. garde-fou dans applySolarData). L'utilisateur
          voit la qualité dans le banner + ce message qui l'invite à
          remplir manuellement. */}
      {runArmed && solar.sourceQuality === 'LOW' && (
        <div
          className="rounded-md border border-amber-700/60 bg-amber-900/30 px-3 py-2 text-xs text-amber-100"
          role="alert"
        >
          ⚠️ Qualité Solar : <strong>LOW</strong>. Les données satellites
          sont peu précises pour cette zone — il est recommandé de remplir
          manuellement le type de toit et la pente, ou de passer par le Tracer 3D
          pour une mesure manuelle.
        </div>
      )}
      {canSeedFromSolar && (
        <button
          type="button"
          onClick={() => props.onSeedFromSolar!(solar.roofModel!)}
          className="self-start inline-flex items-center gap-1.5 rounded-md border border-emerald-700/60 bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-900/50"
          title={`Pré-remplit le Tracer 3D avec ${solar.roofModel?.sections.length ?? 0} pans Solar (quality ${solar.sourceQuality})`}
        >
          🔄 Seeder le tracer depuis Solar ({solar.roofModel?.sections.length ?? 0} pans · {solar.sourceQuality})
        </button>
      )}
    </div>
  );
}
