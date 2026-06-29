import { describe, expect, it } from 'vitest';
import {
  buildDraftPayload,
  buildLocalDraftEnvelope,
  makeDraftKey,
  snapshotHasContent,
  envelopeByteSize,
  DYNASTY_BREAKDOWN_SCHEMA_VERSION,
  QUOTE_DRAFT_SCHEMA_VERSION,
  type QuoteStateSnapshot,
} from './quote-persistence';

function emptySnapshot(): QuoteStateSnapshot {
  return {
    clientFirst: '', clientLast: '', clientEmail: '', clientPhone: '',
    clientCompany: '', clientPostalAddress: '', isCompany: false, clientNeq: '',
    addressText: '', lat: null, lng: null,
    selectedCoverageType: null, roofType: null, slopeCategory: null,
    workType: null, roofCategory: null, buildingType: null, complexity: null,
    colorName: null, selectedMarque: null, selectedGamme: null, contactPreference: null,
    buildingGeojson: null, lotGeojson: null, noLot: null,
    superficie: null, perimetre: null, largeur: null, profondeur: null,
    mapParams: { zoom: 19, centerLat: 0, centerLng: 0 },
    polygonAdj: { offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 },
    lotAdj: { offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 },
    streetViewState: null,
    measureTools: [], mapAnnotations: [], effectiveAreaSqft: 0,
    quoteNotes: '', paymentTerms: '', quoteHeaderFields: {},
    exclusionsList: [], exclusionsChecked: {},
    extraLines: [], hiddenLines: [],
    lineOverrides: {}, lineQbProducts: {}, lineMeasureMappings: {},
    lineMajorations: {}, lineCategories: {}, lineCostOverrides: {},
    lineLaborTypes: {}, realCosts: {},
    contractType: 'forfaitaire', contractFields: {}, contractInlineEdits: {},
    warrantyYears: 5, warrantyCompletionDate: '', warrantyInvoice: '',
    warrantyContractAmount: '', warrantyIncludeConditions: true,
    pdfFiles: [], contactPhotoUrl: null, projectPhotoUrl: null, savedPlanUrl: null,
    manualMeasureMode: false,
    selectedQbCustomerId: null, useOwnerAsClient: false,
    roof3dMeasures: null, roof3dModel: null,
  };
}

describe('quote-persistence', () => {
  describe('buildDraftPayload', () => {
    it('emits sentinel placeholders for empty client identity (mirrors legacy handleSave)', () => {
      const p = buildDraftPayload(emptySnapshot());
      expect(p.first_name).toBe('Brouillon');
      expect(p.last_name).toBe('Admin');
      expect(p.email).toBe('admin@toituresvb.ca');
      expect(p.phone).toBe('000-000-0000');
    });

    it('keeps real client values when provided', () => {
      const s = emptySnapshot();
      s.clientFirst = 'Marie'; s.clientLast = 'Tremblay';
      s.clientEmail = 'marie@example.com'; s.clientPhone = '5145551234';
      const p = buildDraftPayload(s);
      expect(p.first_name).toBe('Marie');
      expect(p.email).toBe('marie@example.com');
    });

    it('writes schema_version + is_draft into dynasty_breakdown', () => {
      const p = buildDraftPayload(emptySnapshot()) as any;
      expect(p.dynasty_breakdown.schema_version).toBe(DYNASTY_BREAKDOWN_SCHEMA_VERSION);
      expect(p.dynasty_breakdown.is_draft).toBe(true);
    });

    it('serializes annotations and tools verbatim', () => {
      const s = emptySnapshot();
      s.mapAnnotations = [
        { target: 'a1', feet: 12.5, visible: true, index: 0, segments: [], markerPositions: [] } as any,
      ];
      s.measureTools = [
        { id: 'faitiere', name: 'Faîtière', toolType: 'Ligne', rawValue: '20',
          correctedValue: '20', unit: 'pi', color: '#ef4444', visible: true,
          linkedTo: '', markerShape: 'circle' } as any,
      ];
      const p = buildDraftPayload(s) as any;
      expect(p.dynasty_breakdown.map_annotations).toHaveLength(1);
      expect(p.dynasty_breakdown.measure_tools[0].id).toBe('faitiere');
    });

    it('derives coverage_type fallback from roofType when none selected', () => {
      const s = emptySnapshot();
      s.roofType = '4pans';
      const p = buildDraftPayload(s);
      expect(p.coverage_type).toBe('shingle_4pans');
    });
  });

  describe('makeDraftKey', () => {
    it('scopes by loadedId when present', () => {
      expect(makeDraftKey({ loadedId: 'abc', tmpId: 'tmp-1' })).toBe('quote_draft_v2:abc');
    });
    it('falls back to tmpId when no loadedId', () => {
      expect(makeDraftKey({ loadedId: null, tmpId: 'tmp-1' })).toBe('quote_draft_v2:new:tmp-1');
    });
  });

  describe('buildLocalDraftEnvelope', () => {
    it('versions and scopes the envelope', () => {
      const env = buildLocalDraftEnvelope(emptySnapshot(), { loadedId: null, tmpId: 't' });
      expect(env.schema_version).toBe(QUOTE_DRAFT_SCHEMA_VERSION);
      expect(env.scope).toBe('quote_draft_v2:new:t');
      expect(env.tmpId).toBe('t');
      expect(env.loadedId).toBeNull();
    });

    it('captures measureTools + mapAnnotations + exclusions + lineOverrides', () => {
      const s = emptySnapshot();
      s.measureTools = [{ id: 'a' } as any];
      s.mapAnnotations = [{ target: 'a' } as any];
      s.exclusionsChecked = { a: true };
      s.lineOverrides = { '0': { rate: 99 } };
      s.extraLines = [{ uid: 'x' }];
      const env = buildLocalDraftEnvelope(s, { loadedId: null, tmpId: 't' });
      const p = env.payload as any;
      expect(p.measureTools).toHaveLength(1);
      expect(p.mapAnnotations).toHaveLength(1);
      expect(p.exclusionsChecked).toEqual({ a: true });
      expect(p.lineOverrides).toEqual({ '0': { rate: 99 } });
      expect(p.extraLines).toHaveLength(1);
    });
  });

  describe('snapshotHasContent', () => {
    it('returns false for a truly empty snapshot', () => {
      expect(snapshotHasContent(emptySnapshot())).toBe(false);
    });
    it('returns true when address is set', () => {
      const s = emptySnapshot();
      s.addressText = '123 rue';
      expect(snapshotHasContent(s)).toBe(true);
    });
    it('returns true when annotations exist', () => {
      const s = emptySnapshot();
      s.mapAnnotations = [{ target: 'a' } as any];
      expect(snapshotHasContent(s)).toBe(true);
    });
    it('returns true when a measure tool has a corrected value', () => {
      const s = emptySnapshot();
      s.measureTools = [{ id: 'x', correctedValue: '42' } as any];
      expect(snapshotHasContent(s)).toBe(true);
    });
    it('returns false when measure tools exist but are all empty', () => {
      const s = emptySnapshot();
      s.measureTools = [{ id: 'x', correctedValue: '', rawValue: '' } as any];
      expect(snapshotHasContent(s)).toBe(false);
    });
  });

  describe('envelopeByteSize', () => {
    it('returns a positive number for a populated envelope', () => {
      const env = buildLocalDraftEnvelope(emptySnapshot(), { loadedId: null, tmpId: 't' });
      expect(envelopeByteSize(env)).toBeGreaterThan(50);
    });
  });
});
