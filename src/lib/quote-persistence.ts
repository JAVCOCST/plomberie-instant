/**
 * Quote persistence — single source of truth for the AdminQuoteGenerator
 * row shape sent to Supabase (`soumissions` table).
 *
 * Vague A note: this module is consumed ONLY by `useQuoteAutosave` (under
 * the `VITE_QUOTE_MOBILE_V2` flag). The legacy `handleSave` function in
 * `AdminQuoteGenerator.tsx` continues to build its own payload inline so
 * that when the flag is OFF the runtime is bit-identical to today. The
 * shape of the row we write here is intentionally kept equivalent to the
 * legacy draft payload (lines 3441-3520) so that subsequent reads by
 * `loadSoumission` stay compatible.
 */

export const DYNASTY_BREAKDOWN_SCHEMA_VERSION = '1.0.0';

/** Localstorage draft schema version (scoped key: `quote_draft_v2:<id|tmp>`). */
export const QUOTE_DRAFT_SCHEMA_VERSION = '2.0.0';

/** Maximum size of a JSON draft we accept to write to localStorage. */
export const QUOTE_DRAFT_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

/** Shape of the snapshot we read from React state to build a Supabase row. */
export interface QuoteStateSnapshot {
  // Client / address
  clientFirst: string; clientLast: string; clientEmail: string; clientPhone: string;
  clientCompany: string; clientPostalAddress: string; isCompany: boolean; clientNeq: string;
  addressText: string; lat: number | null; lng: number | null;

  // Roof params
  selectedCoverageType: string | null;
  roofType: string | null;
  slopeCategory: string | null;
  workType: string | null;
  roofCategory: string | null;
  buildingType: string | null;
  complexity: string | null;
  colorName: string | null;
  selectedMarque: string | null;
  selectedGamme: string | null;
  contactPreference: string | null;

  // Building geometry / map
  buildingGeojson: string | null;
  lotGeojson: string | null;
  noLot: string | null;
  superficie: number | null;
  perimetre: number | null;
  largeur: number | null;
  profondeur: number | null;
  mapParams: { zoom: number; centerLat: number; centerLng: number };
  // PolygonAdjustments-compatible — `scaleFactor` is optional in the parent
  // type, so we accept it optional here too.
  polygonAdj: { offsetEastM: number; offsetNorthM: number; rotationDeg: number; scaleFactor?: number };
  lotAdj: { offsetEastM: number; offsetNorthM: number; rotationDeg: number; scaleFactor?: number };
  streetViewState: unknown;

  // Take-off
  measureTools: Array<Record<string, unknown>>;
  mapAnnotations: Array<Record<string, unknown>>;
  effectiveAreaSqft: number;

  // Quote-level UI
  quoteNotes: string;
  paymentTerms: string;
  quoteHeaderFields: Record<string, unknown>;
  exclusionsList: unknown;
  exclusionsChecked: unknown;

  // Lines + overrides
  extraLines: unknown;
  hiddenLines: number[];
  lineOverrides: Record<string, unknown>;
  lineQbProducts: Record<string, unknown>;
  lineMeasureMappings: Record<string, unknown>;
  lineMajorations: Record<string, unknown>;
  lineCategories: Record<string, unknown>;
  lineCostOverrides: Record<string, unknown>;
  lineLaborTypes: Record<string, unknown>;
  realCosts: Record<string, unknown>;

  // Contract / warranty
  contractType: string;
  // Concrete types live in AdminQuoteGenerator.tsx (ContractFields /
  // ContractInlineEdits). We accept any object here to avoid coupling.
  contractFields: object;
  contractInlineEdits: object;
  warrantyYears: number;
  warrantyCompletionDate: string;
  warrantyInvoice: string;
  warrantyContractAmount: string;
  warrantyIncludeConditions: boolean;

  // Files
  pdfFiles: unknown;
  contactPhotoUrl: string | null;
  projectPhotoUrl: string | null;
  savedPlanUrl: string | null;
  manualMeasureMode: boolean;

  // QB
  selectedQbCustomerId: string | null;
  useOwnerAsClient: boolean;

  // Roof model (3D)
  roof3dMeasures: unknown;
  roof3dModel: unknown;

  // Preview / extra UI
  previewConfirmed?: Record<string, unknown>;
}

/**
 * Sentinel constants kept identical to `handleSave` lines 3442-3445 so the
 * autosave draft path writes the same fallbacks as the legacy save. Vague C
 * will replace these with real validation; Vague A keeps compatibility.
 */
const SENTINEL_FIRST = 'Brouillon';
const SENTINEL_LAST = 'Admin';
const SENTINEL_EMAIL = 'admin@toituresvb.ca';
const SENTINEL_PHONE = '000-000-0000';

/**
 * Build the row payload the autosave should send to `soumissions.update` /
 * `soumissions.insert`. The shape mirrors the existing draft payload
 * (handleSave:3441-3520) — `is_draft: true` is kept so the row is identifiable
 * as a take-off in progress and the legacy `loadSoumission` keeps reading it.
 */
export function buildDraftPayload(state: QuoteStateSnapshot): Record<string, unknown> {
  const {
    clientFirst, clientLast, clientEmail, clientPhone,
    clientCompany, clientPostalAddress, isCompany, clientNeq,
    addressText, lat, lng,
    selectedCoverageType, roofType, slopeCategory, workType,
    roofCategory, buildingType, complexity, colorName,
    selectedMarque, selectedGamme, contactPreference,
    buildingGeojson, lotGeojson, noLot,
    superficie, perimetre, largeur, profondeur,
    mapParams, polygonAdj, lotAdj, streetViewState,
    measureTools, mapAnnotations,
    quoteNotes, paymentTerms, quoteHeaderFields,
    pdfFiles, contactPhotoUrl, projectPhotoUrl,
    selectedQbCustomerId, useOwnerAsClient,
    contractType, contractFields, contractInlineEdits,
    warrantyYears, warrantyCompletionDate, warrantyInvoice,
    warrantyContractAmount, warrantyIncludeConditions,
    effectiveAreaSqft, roof3dMeasures, roof3dModel,
  } = state;

  return {
    first_name: clientFirst || SENTINEL_FIRST,
    last_name: clientLast || SENTINEL_LAST,
    email: clientEmail || SENTINEL_EMAIL,
    phone: clientPhone || SENTINEL_PHONE,
    formatted_address: addressText || null,
    lat,
    lng,
    coverage_type: selectedCoverageType || (roofType ? `shingle_${roofType}` : 'shingle_2_versants'),
    slope: slopeCategory || null,
    area_sqft: effectiveAreaSqft || 0,
    area_input: effectiveAreaSqft || 0,
    area_unit: 'sqft',
    contact_preference: contactPreference || 'email',
    work_type: workType || null,
    roof_category: roofCategory || 'residential',
    building_type: buildingType || null,
    complexity: complexity || null,
    color: colorName || null,
    product_brand: selectedMarque || null,
    product_name: selectedGamme || null,
    dynasty_breakdown: {
      schema_version: DYNASTY_BREAKDOWN_SCHEMA_VERSION,
      is_draft: true,
      ui_roof_type: roofType,
      ui_slope_category: slopeCategory,
      ui_work_type: workType,
      quote_notes: quoteNotes || '',
      payment_terms: paymentTerms || '',
      building_geojson: buildingGeojson,
      quote_header_fields: quoteHeaderFields,
      lot_geojson: lotGeojson,
      map_params: mapParams,
      polygon_adj: polygonAdj,
      lot_adj: lotAdj,
      street_view_state: streetViewState,
      superficie_m2: superficie,
      perimetre_m: perimetre,
      largeur_m: largeur,
      profondeur_m: profondeur,
      no_lot: noLot,
      selected_coverage_type: selectedCoverageType,
      selected_marque: selectedMarque,
      selected_gamme: selectedGamme,
      roof3d_measures: roof3dMeasures,
      roof3d_model: roof3dModel,
      selected_qb_customer_id: selectedQbCustomerId || null,
      use_owner_as_client: useOwnerAsClient,
      client_postal_address: clientPostalAddress || '',
      client_company: clientCompany || '',
      is_company: isCompany,
      client_neq: clientNeq || '',
      pdf_files: pdfFiles,
      contact_photo_url: contactPhotoUrl,
      project_photo_url: projectPhotoUrl,
      contract_type: contractType,
      contract_fields: contractFields,
      contract_inline_edits: contractInlineEdits,
      warranty_settings: {
        years: warrantyYears,
        completion_date: warrantyCompletionDate,
        invoice: warrantyInvoice,
        contract_amount: warrantyContractAmount,
        include_conditions: warrantyIncludeConditions,
      },
      measure_tools: (measureTools || []).map((t: any) => ({
        id: t.id, name: t.name, toolType: t.toolType,
        rawValue: t.rawValue, correctedValue: t.correctedValue,
        unit: t.unit, color: t.color, visible: t.visible,
        linkedTo: t.linkedTo, markerShape: t.markerShape,
        qbProductId: t.qbProductId || undefined,
        slopeType: t.slopeType || undefined,
        slopeFactor: t.slopeFactor ?? undefined,
        majoration: t.majoration ?? undefined,
      })),
      map_annotations: (mapAnnotations || []).map((a: any) => ({
        target: a.target, feet: a.feet, visible: a.visible, index: a.index,
        segments: a.segments || [], markerPositions: a.markerPositions || [],
      })),
    },
  };
}

/**
 * Build the local draft (~ localStorage) snapshot. Includes every field in
 * the Supabase payload PLUS the extra UI fields whose loss bothers users
 * (preview confirmations, exclusions, extra lines, line overrides…).
 *
 * The draft is keyed by `quote_draft_v2:<loadedId|new:<tmpId>>` — never the
 * old global key — so a fresh tab does not contaminate an existing
 * soumission and vice-versa.
 */
export interface DraftEnvelope {
  schema_version: string;
  scope: string;          // e.g. `quote_draft_v2:<id|tmp>`
  saved_at: number;       // Date.now()
  loadedId: string | null;
  tmpId: string;
  payload: Record<string, unknown>;
}

export function buildLocalDraftEnvelope(
  state: QuoteStateSnapshot,
  meta: { loadedId: string | null; tmpId: string },
): DraftEnvelope {
  const scope = makeDraftKey(meta);
  return {
    schema_version: QUOTE_DRAFT_SCHEMA_VERSION,
    scope,
    saved_at: Date.now(),
    loadedId: meta.loadedId,
    tmpId: meta.tmpId,
    payload: {
      // Mirrors buildDraftPayload but flattens to UI keys for cheap restore.
      addressText: state.addressText, lat: state.lat, lng: state.lng,
      clientFirst: state.clientFirst, clientLast: state.clientLast,
      clientEmail: state.clientEmail, clientPhone: state.clientPhone,
      clientCompany: state.clientCompany, clientPostalAddress: state.clientPostalAddress,
      isCompany: state.isCompany, clientNeq: state.clientNeq,
      workType: state.workType, roofType: state.roofType, slopeCategory: state.slopeCategory,
      roofCategory: state.roofCategory, buildingType: state.buildingType,
      complexity: state.complexity, colorName: state.colorName,
      contactPreference: state.contactPreference,
      selectedMarque: state.selectedMarque, selectedGamme: state.selectedGamme,
      selectedCoverageType: state.selectedCoverageType,
      buildingGeojson: state.buildingGeojson, lotGeojson: state.lotGeojson,
      noLot: state.noLot,
      superficie: state.superficie, perimetre: state.perimetre,
      largeur: state.largeur, profondeur: state.profondeur,
      mapParams: state.mapParams, polygonAdj: state.polygonAdj, lotAdj: state.lotAdj,
      streetViewState: state.streetViewState,
      measureTools: state.measureTools, mapAnnotations: state.mapAnnotations,
      quoteNotes: state.quoteNotes, paymentTerms: state.paymentTerms,
      quoteHeaderFields: state.quoteHeaderFields,
      exclusionsList: state.exclusionsList, exclusionsChecked: state.exclusionsChecked,
      extraLines: state.extraLines, hiddenLines: state.hiddenLines,
      lineOverrides: state.lineOverrides, lineQbProducts: state.lineQbProducts,
      lineMeasureMappings: state.lineMeasureMappings, lineMajorations: state.lineMajorations,
      lineCategories: state.lineCategories, lineCostOverrides: state.lineCostOverrides,
      lineLaborTypes: state.lineLaborTypes, realCosts: state.realCosts,
      contractType: state.contractType, contractFields: state.contractFields,
      contractInlineEdits: state.contractInlineEdits,
      warrantyYears: state.warrantyYears,
      warrantyCompletionDate: state.warrantyCompletionDate,
      warrantyInvoice: state.warrantyInvoice,
      warrantyContractAmount: state.warrantyContractAmount,
      warrantyIncludeConditions: state.warrantyIncludeConditions,
      pdfFiles: state.pdfFiles,
      contactPhotoUrl: state.contactPhotoUrl,
      projectPhotoUrl: state.projectPhotoUrl,
      savedPlanUrl: state.savedPlanUrl,
      manualMeasureMode: state.manualMeasureMode,
      selectedQbCustomerId: state.selectedQbCustomerId,
      useOwnerAsClient: state.useOwnerAsClient,
      roof3dMeasures: state.roof3dMeasures,
      roof3dModel: state.roof3dModel,
      previewConfirmed: state.previewConfirmed,
    },
  };
}

export function makeDraftKey({ loadedId, tmpId }: { loadedId: string | null; tmpId: string }): string {
  return `quote_draft_v2:${loadedId || `new:${tmpId}`}`;
}

/** Cheap heuristic: does the snapshot contain anything worth keeping? */
export function snapshotHasContent(state: QuoteStateSnapshot): boolean {
  return !!(
    state.addressText || state.clientFirst || state.clientLast ||
    state.clientEmail || state.clientPhone || state.clientCompany ||
    (state.measureTools && state.measureTools.length > 0 &&
      state.measureTools.some((t: any) => t?.correctedValue || t?.rawValue)) ||
    (state.mapAnnotations && state.mapAnnotations.length > 0) ||
    (state.extraLines && (state.extraLines as unknown[]).length > 0) ||
    (state.lineOverrides && Object.keys(state.lineOverrides).length > 0) ||
    state.quoteNotes || state.paymentTerms ||
    state.savedPlanUrl || state.manualMeasureMode
  );
}

/** Returns the JSON-encoded size in bytes. Used to abort suspicious writes. */
export function envelopeByteSize(env: DraftEnvelope): number {
  try {
    return new TextEncoder().encode(JSON.stringify(env)).byteLength;
  } catch {
    return 0;
  }
}

/** Legacy draft key from before Vague A (mobile-only, single global key). */
export const LEGACY_DRAFT_KEY = 'quote_generator_draft_v1';
