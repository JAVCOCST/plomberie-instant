/// <reference types="google.maps" />
import { getSignedQuotePdfUrl, QUOTE_PDF_LONG_TTL } from '@/lib/pdf-storage';
import React, { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuoteListConfig } from '@/hooks/useQuoteListConfig';
import { useQuoteAmountStore } from '@/features/financing-calculator/quote-amount-store';
import { Button } from '@/components/ui/button';
import {
  MapPin, Search, Save, ChevronDown, ChevronUp, Plus, Trash2, RefreshCw,
  Building2, Ruler, Calculator, User, Layers, FileDown, DollarSign, TrendingUp, Clock,
  FolderOpen, ArrowRight, Maximize2, AlertTriangle, CheckCircle2, Send, Loader2, FileText,
  Settings, Eye, EyeOff, GripVertical, RotateCcw, RotateCw, ChevronLeft, ChevronRight,
  RefreshCcw, ZoomIn, ZoomOut, Settings2, Move, Shield, PenLine, FileImage, Satellite, Paperclip,
  Lock, Unlock, Star, Archive, ArchiveRestore, Sparkles, Bot, UserPlus, Check
} from 'lucide-react';
import PlanViewer from '@/components/roofing/PlanViewer';
import { ProjectCloseout } from '@/components/ProjectCloseout';
import { RoofReportPanel } from '@/components/RoofReportPanel';
import CopilotChat from '@/components/admin/CopilotChat';
import StreetViewAnnotator, { type StreetViewState } from '@/components/admin/StreetViewAnnotator';
import ProjectPhotoPanel from '@/components/admin/ProjectPhotoPanel';
import RoofModelViewer from '@/components/admin/RoofModelViewer';
import ContractSignatureStep from '@/components/admin/ContractSignatureStep';
import { generateWarrantyCertificatePdf, generateSpecimenCertificatePdf, type WarrantyData } from '@/lib/warranty-certificate';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { useUpdateProjectStatus } from '@/hooks/useProjects';
import {
  ROOF_CATEGORY_OPTIONS, BUILDING_TYPE_OPTIONS, COMPLEXITY_OPTIONS, CONTACT_PREFERENCE_OPTIONS,
  COLORS_BY_PRODUCT,
} from '@/lib/soumissionFieldOptions';
// ── Vague A: feature-flagged autosave + offline queue + status indicator ──
// Everything below this comment is a no-op when VITE_QUOTE_MOBILE_V2 is OFF.
import {
  QUOTE_MOBILE_V2,
  FEATURE_AUTOSAVE,
  FEATURE_CONFIRM_DESTRUCTIVE,
  FEATURE_IMAGE_COMPRESSION,
} from '@/lib/quote-feature-flags';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useQuoteAutosave } from '@/hooks/useQuoteAutosave';
import SaveStatusIndicator from '@/components/quote-saver/SaveStatusIndicator';
import {
  buildDraftPayload as buildDraftPayloadV2,
  buildLocalDraftEnvelope as buildLocalDraftEnvelopeV2,
  makeDraftKey as makeDraftKeyV2,
  snapshotHasContent as snapshotHasContentV2,
  envelopeByteSize as envelopeByteSizeV2,
  LEGACY_DRAFT_KEY,
  QUOTE_DRAFT_MAX_BYTES,
  type QuoteStateSnapshot,
} from '@/lib/quote-persistence';
import { compressImageFile } from '@/lib/image-compress';
// ── Vague A2 (feature-flagged) — autofill MAMH + Solar + classify ─────────
// `AutofillCoordinator` encapsule TOUS les hooks et logique A2. Si le flag
// est OFF, le composant n'est PAS rendu, donc ses hooks (useAutofillFromAddress,
// useSolarRoofModel, useQuery idbati) ne sont jamais mountés et React Query
// ne déclenche AUCUNE query. Garantie "bit-identique" en flag OFF.
import AutofillCoordinator from '@/components/roofing/immersive/AutofillCoordinator';

const AUTOFILL_ENABLED = import.meta.env.VITE_QUOTE_AUTOFILL_V1 === 'true';

/* ── Measurement Tool Types ── */
type ToolType = 'Ligne' | 'Surface' | 'Compteur' | 'Multi-segment' | 'Surface bâtiment' | 'Périmètre bâtiment';
type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'star';
const MARKER_SHAPES: { value: MarkerShape; label: string }[] = [
  { value: 'circle', label: '●' },
  { value: 'square', label: '■' },
  { value: 'diamond', label: '◆' },
  { value: 'triangle', label: '▲' },
  { value: 'star', label: '★' },
];
interface MeasureTool {
  id: string;
  name: string;
  toolType: ToolType;
  rawValue: string;
  correctedValue: string;
  unit: string;
  color: string;
  visible: boolean;
  linkedTo: string;
  markerShape: MarkerShape;
  qbProductId?: string;
  slopeType?: SlopeCategory;
  slopeFactor?: number;
  majoration?: number;
}

// Mesures dérivées du modèle 3D, en unités d'affichage (pi² / pi / compte).
// Assemblées à la validation du traceur depuis roofTakeoff.derived.measurements.
interface Roof3dMeasures {
  roofAreaSqft: number;                      // surface toiture 3D totale (pi²)
  areaByPitchSqft: Record<string, number>;   // pente X/12 → pi²
  ridgeFt: number;                           // faîtière (pi)
  hipFt: number;                             // arête (pi)
  valleyFt: number;                          // noue (pi)
  eaveFt: number;                            // débord de toit (pi)
  membraneFt: number;                        // membrane autocollante (pi)
  maximumCount: number;                      // Maximum 301 (compte)
  dominantPitchX12: number;
  computedAt: string;
}

const DEFAULT_TOOLS: MeasureTool[] = [
  { id: 'faitiere', name: 'Faîtière', toolType: 'Ligne', rawValue: '', correctedValue: '', unit: 'pi', color: '#ef4444', visible: true, linkedTo: '', markerShape: 'circle' },
  { id: 'aretes', name: 'Arêtes', toolType: 'Ligne', rawValue: '', correctedValue: '', unit: 'pi', color: '#f97316', visible: true, linkedTo: '', markerShape: 'circle' },
  { id: 'noues', name: 'Noues', toolType: 'Multi-segment', rawValue: '', correctedValue: '', unit: 'pi', color: '#3b82f6', visible: true, linkedTo: '', markerShape: 'circle' },
  { id: 'events', name: 'Évents / sorties', toolType: 'Compteur', rawValue: '', correctedValue: '', unit: 'unité', color: '#22c55e', visible: true, linkedTo: '', markerShape: 'circle' },
  { id: 'maximums', name: 'Maximums', toolType: 'Ligne', rawValue: '', correctedValue: '', unit: 'pi', color: '#8b5cf6', visible: true, linkedTo: '', markerShape: 'circle' },
];

const TOOL_TYPES: ToolType[] = ['Ligne', 'Multi-segment', 'Surface', 'Compteur', 'Surface bâtiment', 'Périmètre bâtiment'];

// Catalogue des mesures dérivées du moteur 3D — UN SEUL endroit qui reflète
// `Roof3dMeasures` ci-dessus. Chaque entrée mappe la `value` du dropdown à la
// clé canonique de Roof3dMeasures qui l'alimente. Étendre `Roof3dMeasures`
// + cette liste = nouvel item visible dans le dropdown sans autre changement.
export interface Tool3dType { value: string; label: string; unit: string; r3dKey: keyof Roof3dMeasures }
export const TOOL_TYPES_3D: Tool3dType[] = [
  { value: '3D · Surface toiture',         label: 'Surface toiture',         unit: 'pi²',   r3dKey: 'roofAreaSqft' },
  { value: '3D · Faîtière',                label: 'Faîtière',                unit: 'pi',    r3dKey: 'ridgeFt' },
  { value: '3D · Arête',                   label: 'Arête',                   unit: 'pi',    r3dKey: 'hipFt' },
  { value: '3D · Noue',                    label: 'Noue',                    unit: 'pi',    r3dKey: 'valleyFt' },
  { value: '3D · Débord de toit',          label: 'Débord de toit',          unit: 'pi',    r3dKey: 'eaveFt' },
  { value: '3D · Membrane autocollante',   label: 'Membrane autocollante',   unit: 'pi',    r3dKey: 'membraneFt' },
  { value: '3D · Maximum',                 label: 'Maximum',                 unit: 'unité', r3dKey: 'maximumCount' },
];
const TOOL_TYPES_3D_BY_VALUE: Record<string, Tool3dType> = Object.fromEntries(TOOL_TYPES_3D.map(t => [t.value, t]));

const UNITS_BY_TOOL_TYPE: Record<string, string[]> = {
  'Surface': ['pi²', 'm²'],
  'Ligne': ['pi', 'm', 'po'],
  'Compteur': ['unité', 'pcs'],
  'Multi-segment': ['pi', 'm', 'po'],
  'Surface bâtiment': ['pi²', 'm²'],
  'Périmètre bâtiment': ['pi', 'm'],
  // Les types 3D verrouillent l'unité sur celle imposée par le moteur.
  ...Object.fromEntries(TOOL_TYPES_3D.map(t => [t.value, [t.unit]])),
};

// Which tool types are "building source" types (auto-filled, not drawable)
const isBuildingSourceType = (t: ToolType) => t === 'Surface bâtiment' || t === 'Périmètre bâtiment';
// Which tool types map to a drawable measure type for the map
const getMapToolType = (t: ToolType): string => {
  if (t === 'Surface bâtiment' || t === 'Périmètre bâtiment') return '';
  return t;
};
import {
  computeDynastyQuote, DynastyQuote, VisionResult,
  RoofType, SlopeCategory, QuoteLine,
} from '@/lib/dynasty-calculator';
import { generateQuotePdf, fetchSatelliteDataUrl, compositeMapWithPolygons } from '@/lib/pdf-generators';
import type { PdfContext, BuildingData } from '@/lib/pdf-generators';
import type { PolygonAdjustments, MeasureTarget, AnnotationInfo, AdjustControls, MapToolboxControls } from '@/components/roofing/immersive/BuildingReadOnlyMap';
import BuildingReadOnlyMap from '@/components/roofing/immersive/BuildingReadOnlyMap';
import MapToolbox from '@/components/roofing/immersive/MapToolbox';
import RoofPolygonAIInline, { type AiOverlay } from '@/components/roofing/immersive/RoofPolygonAIInline';
import BuildingMapPicker from '@/components/roofing/immersive/BuildingMapPicker';
import LotDiagnosticPanel from '@/components/roofing/immersive/LotDiagnosticPanel';
const TakeoffFullscreen = lazy(() => import('@/components/roofing/immersive/TakeoffFullscreen'));
import QuotePreview from '@/components/QuotePreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SmartTextEditor from '@/components/SmartTextEditor';
import { QUOTE_VARIABLE_DEFS, buildQuoteValues } from '@/lib/quote-variables';
import {
  loadSettings as loadQuoteSettings,
  saveSettings as saveQuoteSettings,
  DEFAULT_QUOTE_SETTINGS,
  TONE_COLORS,
  marginTone,
  priceFloorTone,
  buildSmartAlerts,
  type QuoteSettings,
  type Tone,
} from '@/lib/quote-settings';

/* ── Constants ── */
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FN_BASE = `https://${PROJECT_ID}.supabase.co/functions/v1`;
const HOURLY_RATE = 80;

const ROOF_TYPES: { value: RoofType; label: string }[] = [
  { value: '2pans', label: '2 versants' },
  { value: '4pans', label: '4 versants' },
  { value: '4pans_plus', label: '4+ versants (complexe)' },
  { value: 'plat', label: 'Plat' },
];

const SLOPE_CATEGORIES: { value: SlopeCategory; label: string }[] = [
  { value: 'aucune', label: 'Aucune (0-4/12)' },
  { value: 'legere', label: 'Légère (4-7/12)' },
  { value: 'moderee', label: 'Modérée (8-12/12)' },
  { value: 'abrupte', label: 'Abrupte (12/12+)' },
];

const SLOPE_FACTOR_MAP: Record<SlopeCategory, number> = {
  aucune: 1.00,   // toit plat
  legere: 1.06,   // ~4-5/12 (sec ≈ 1.054)
  moderee: 1.12,  // ~6-8/12 (sec ≈ 1.118)
  abrupte: 1.25,  // ~9-12/12 (sec ≈ 1.25 → 1.41)
};

const fmt = (n: number) => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const fmt2 = (n: number) => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const normalizeSlopeCategory = (value?: string | null): SlopeCategory | null => {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return null;
  if (['aucune', 'flat', 'plat', '0-4', '0-4/12'].includes(v)) return 'aucune';
  if (['legere', 'légère', 'faible', '4-7', '4-7/12', '4-5', '4-5/12'].includes(v)) return 'legere';
  if (['moderee', 'modérée', 'moyenne', '7-9', '7-9/12', '6-8', '6-8/12', '8-12', '8-12/12'].includes(v)) return 'moderee';
  if (['abrupte', 'forte', '9-12', '9-12/12', '12+', '12/12+'].includes(v)) return 'abrupte';
  return null;
};

const normalizeRoofTypeFromCoverage = (value?: string | null): RoofType | null => {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return null;
  if (v.includes('membrane') || v.includes('plat')) return 'plat';
  if (v.includes('2pans') || v.includes('2 pans')) return '2pans';
  if (v.includes('4pans_plus') || v.includes('4 pans plus') || v.includes('complexe')) return '4pans_plus';
  if (v.includes('4pans') || v.includes('4 pans')) return '4pans';
  return null;
};

const buildLinesFromPdfSections = (db: any): QuoteLine[] => {
  if (!db || Array.isArray(db.lines) || !Array.isArray(db.sections)) return [];
  return db.sections.flatMap((section: any) =>
    Array.isArray(section.items)
      ? section.items.map((item: any) => {
          const amount = Number(item.amount) || 0;
          return {
            _uid: `pdf-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
            description: `${section.title ? `${section.title} — ` : ''}${item.description || 'Poste PDF'}`,
            quantity: 1,
            unit: 'forfait',
            rate: amount,
            total_base: amount,
            ratio: 0,
            total_displayed: amount,
          } as QuoteLine;
        })
      : []
  );
};

const newUid = () => `xl-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
const ensureUid = (line: QuoteLine): QuoteLine => (line._uid ? line : { ...line, _uid: newUid() });

// ── Config des listes (Type de couverture / Marque / Gamme / Fournisseur) ──
// Source partagée gérée par useQuoteListConfig (Supabase + migration legacy
// + realtime entre les pages /admin/products et la soumission).

const sanitizeFilenamePart = (value?: string | null) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'CONTRAT';

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

function computeZoomForPolygon(geojsonStr: string) {
  try {
    const parsed = JSON.parse(geojsonStr);
    let coords: number[][] = [];
    if (parsed.type === 'Polygon') coords = parsed.coordinates[0];
    else if (parsed.type === 'MultiPolygon') parsed.coordinates.forEach((p: number[][][]) => coords.push(...p[0]));
    if (coords.length === 0) return { zoom: 19, centerLat: 0, centerLng: 0 };
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lng, lat] of coords) { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); }
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const availablePx = 640 * 2;
    const zoomLng = lngSpan > 0 ? Math.log2(availablePx * 360 / (lngSpan * 256 * 2)) : 21;
    const latRad = centerLat * Math.PI / 180;
    const zoomLat = latSpan > 0 ? Math.log2(availablePx * 360 / (latSpan * 256 * 2 * (1 / Math.cos(latRad)))) : 21;
    return { zoom: Math.max(Math.min(Math.floor(Math.min(zoomLng, zoomLat)), 21), 17), centerLat, centerLng };
  } catch { return { zoom: 19, centerLat: 0, centerLng: 0 }; }
}

const buildSatUrl = (lat: number, lng: number, zoom: number, size = '400x300') =>
  `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&maptype=satellite&key=${GOOGLE_API_KEY}`;

type SoumissionRow = {
  id: string; seq_number: number; first_name: string; last_name: string;
  email: string; phone: string; formatted_address: string | null;
  lat: number | null; lng: number | null; coverage_type: string | null;
  slope: string | null; area_sqft: number | null; product_name: string | null;
  product_brand: string | null; color: string | null; desired_install_date: string | null;
  dynasty_breakdown: any; subtotal: number | null; low_estimate: number | null; high_estimate: number | null;
  status: string; created_at: string; roof_category: string | null;
  building_type: string | null; work_type: string | null;
};

/* ── Styles ── */
const sectionStyle: React.CSSProperties = {
  background: 'rgba(20,20,40,0.6)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)',
  padding: 14, marginBottom: 12,
};
const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, display: 'block' };
const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, fontSize: 13 };
const selectStyle: React.CSSProperties = { ...inputStyle, padding: '8px 10px', width: '100%', cursor: 'pointer', outline: 'none' };
const numInputStyle: React.CSSProperties = { ...inputStyle, padding: '8px 10px', width: '100%', fontFamily: 'monospace' };

// Vague A2.1 — Styles "glow" indigo pour les champs auto-remplis par l'IA.
// Couleur principale du portail : indigo `#6366f1` / `#a5b4fc` (alignée avec
// les boutons, l'animation logo-shine, le hover sidebar). Les styles ci-dessous
// ajoutent un anneau lumineux + une lueur autour du champ + un drop-shadow sur
// l'icône Bot. Une keyframe `botPulse` (définie inline dans le composant) fait
// respirer l'opacité de l'icône pour signaler l'origine IA.
const glowFieldStyle: React.CSSProperties = {
  borderColor: 'rgba(165,180,252,0.55)',
  boxShadow: '0 0 0 1px rgba(99,102,241,0.55), 0 0 12px 2px rgba(99,102,241,0.35)',
};
const glowBotStyle: React.CSSProperties = {
  display: 'inline',
  verticalAlign: -2,
  marginLeft: 4,
  color: '#a5b4fc',
  filter: 'drop-shadow(0 0 3px #a5b4fc) drop-shadow(0 0 6px rgba(99,102,241,0.6))',
  animation: 'botPulse 2.4s ease-in-out infinite',
};

/* ─────────────── Main Component ─────────────── */
const AdminQuoteGenerator: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const updateProjectStatusMut = useUpdateProjectStatus();
  const [savedSoumissions, setSavedSoumissions] = useState<SoumissionRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [loadSearch, setLoadSearch] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  // Ref synchrone de loadedId (utilisable dans des callbacks mémoïsés sans
  // dépendance, ex. persistance immédiate du bâtiment trouvé).
  const loadedIdRef = useRef<string | null>(null);
  useEffect(() => { loadedIdRef.current = loadedId; }, [loadedId]);
  const [loadedSeqNumber, setLoadedSeqNumber] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const autoLoadedRef = useRef(false);
  // API impérative exposée par la détection IA inline (bouton « Relancer »).
  const aiApiRef = useRef<{ recapture: () => void } | null>(null);

  // Adopte l'id d'une soumission fraîchement insérée (autosave ou sauvegarde manuelle) :
  // on fixe loadedId ET on pousse ?id=… dans l'URL pour qu'un rechargement (PWA iOS,
  // bouton retour) rouvre la MÊME soumission avec TOUS ses champs. autoLoadedRef évite
  // que l'effet d'auto-chargement ne recharge par-dessus l'édition en cours.
  const adoptSoumissionId = useCallback((id: string) => {
    setLoadedId(id);
    autoLoadedRef.current = true;
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('id') !== id) { sp.set('id', id); setSearchParams(sp, { replace: true }); }
    } catch {}
  }, [setSearchParams]);

  // Address
  const [addressText, setAddressText] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [addressLoaded, setAddressLoaded] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);

  // Building
  const [buildingGeojson, setBuildingGeojson] = useState<string | null>(null);
  const [lotGeojson, setLotGeojson] = useState<string | null>(null);
  const [noLot, setNoLot] = useState<string | null>(null);
  const [superficie, setSuperficie] = useState<number | null>(null);
  const [perimetre, setPerimetre] = useState<number | null>(null);
  const [largeur, setLargeur] = useState<number | null>(null);
  const [profondeur, setProfondeur] = useState<number | null>(null);
  const [buildingPhase, setBuildingPhase] = useState<'idle' | 'loading' | 'found' | 'not_found' | 'manual'>('idle');
  // Vague A2.2 — diagnostic de lot. `lotDistanceM` = distance (m) du point
  // géocodé au polygone de lot renvoyée par find_building_polygon (0 = point
  // DANS le lot → précis ; > seuil → lot voisin le plus proche → imprécis).
  // `lotManual` = l'utilisateur a saisi/corrigé le lot à la main.
  const [lotDistanceM, setLotDistanceM] = useState<number | null>(null);
  const [lotManual, setLotManual] = useState(false);
  const [mapParams, setMapParams] = useState({ zoom: 19, centerLat: 0, centerLng: 0 });
  const [streetViewState, setStreetViewState] = useState<StreetViewState | null>(null);
  const [polygonAdj, setPolygonAdj] = useState<PolygonAdjustments>({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
  const [lotAdj, setLotAdj] = useState<PolygonAdjustments>({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
  const [adjustControls, setAdjustControls] = useState<AdjustControls | null>(null);
  const [showAdjustControls, setShowAdjustControls] = useState(false);
  const [mapToolboxControls, setMapToolboxControls] = useState<MapToolboxControls | null>(null);
  // RoofPolygon AI — calques image géoréférencés gérés inline (pas de modale).
  const [aiOverlays, setAiOverlays] = useState<AiOverlay[]>([]);
  const [navigateMode, setNavigateMode] = useState(false);

  // Experimental RoofStudio takeoff overlay (3D tracer → superficie + pente)
  const [takeoffOpen, setTakeoffOpen] = useState(false);
  // ── Vague A2 — autofill MAMH (feature-flagged).
  // Vague A2.1 : conversion ref → useState pour rendre les inputs contrôlés
  // de la nouvelle section "Caractéristiques du bâtiment". En flag OFF, la
  // section n'est pas rendue → les setters ne sont jamais appelés → states
  // restent à null. Le payload save est identique (gated par AUTOFILL_ENABLED).
  const [yearBuilt, setYearBuilt] = useState<number | null>(null);
  const [dwellingCount, setDwellingCount] = useState<number | null>(null);
  const [floorCount, setFloorCount] = useState<number | null>(null);
  const [mamhDataSource, setMamhDataSource] = useState<string | null>(null);
  // Vague A2.1 — Set des champs auto-remplis par l'IA (MAMH/Solar). Sert à
  // afficher une icône Sparkles dans le label tant que l'utilisateur n'a pas
  // touché. Modification = unmark = retire l'icône (= signal "saisie manuelle").
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());
  const markAutoFilled = useCallback((field: string) => {
    setAutoFilledFields(s => { const n = new Set(s); n.add(field); return n; });
  }, []);
  const unmarkAutoFilled = useCallback((field: string) => {
    setAutoFilledFields(s => {
      if (!s.has(field)) return s;
      const n = new Set(s); n.delete(field); return n;
    });
  }, []);
  // Quote params
  const [roofType, setRoofType] = useState<RoofType>('4pans');
  const [slopeCategory, setSlopeCategory] = useState<SlopeCategory>('moderee');
  const [confidence, setConfidence] = useState(0.75);
  const [areaSqftOverride, setAreaSqftOverride] = useState<string>('');
  const [perimeterFtOverride, setPerimeterFtOverride] = useState<string>('');

  // Coverage / brand / gamme selections
  const [selectedCoverageTypes, setSelectedCoverageTypes] = useState<string[]>([]);
  // Backward-compat alias
  const selectedCoverageType = selectedCoverageTypes.join(', ');
  const setSelectedCoverageType = (v: string) => setSelectedCoverageTypes(v ? [v] : []);
  const [selectedMarque, setSelectedMarque] = useState<string>('');
  const [selectedGamme, setSelectedGamme] = useState<string>('');
  // Source partagée avec /admin/products via le hook : lecture/écriture
  // directe dans soumissions.quote_list_config + realtime entre les deux pages.
  const listsCfg = useQuoteListConfig();
  const coverageTypesList = listsCfg.coverageTypes;
  const setCoverageTypesList = listsCfg.setCoverageTypes;
  const marquesList = listsCfg.marques;
  const setMarquesList = listsCfg.setMarques;
  const gammesList = listsCfg.gammes;
  const setGammesList = listsCfg.setGammes;
  const suppliersList = listsCfg.suppliers;
  const setSuppliersList = listsCfg.setSuppliers;
  const [showListConfig, setShowListConfig] = useState(false);
  const [newCoverageType, setNewCoverageType] = useState('');
  const [newMarque, setNewMarque] = useState('');
  const [newGamme, setNewGamme] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  // Dynamic measurement tools
  const [measureTools, setMeasureTools] = useState<MeasureTool[]>(() => {
    try {
      const saved = localStorage.getItem('roof_measure_tools');
      if (saved) {
        const parsed = JSON.parse(saved) as any[];
        // Migrate old tools: convert source field to toolType
        return parsed.map((t: any) => {
          let toolType = t.toolType || 'Ligne';
          if (t.source === 'batiment_surface') toolType = 'Surface bâtiment';
          else if (t.source === 'batiment_perimetre') toolType = 'Périmètre bâtiment';
          else if (toolType === 'Périmètre') toolType = 'Ligne'; // Remove old Périmètre type
          const { source, ...rest } = t;
          return { ...rest, toolType, markerShape: t.markerShape || 'circle', linkedTo: t.linkedTo || '' };
        });
      }
    } catch {}
    return DEFAULT_TOOLS;
  });
  // Mesures issues du traceur 3D (unités d'affichage : pi²/pi/compte). Alimentées
  // à la validation du traceur, persistées dans dynasty_breakdown.roof3d_measures.
  // Phase 1 : on les stocke seulement ; aucune UI ne les consomme encore.
  const [roof3dMeasures, setRoof3dMeasures] = useState<Roof3dMeasures | null>(null);
  // Modèle 3D (roof-core RoofModel) capturé à la validation du traceur, persisté
  // dans dynasty_breakdown.roof3d_model et réinjecté comme initialModel au
  // rechargement — c'est ce qui rend le modèle 3D *vraiment* lié à la soumission
  // (cross-device, au-delà du brouillon localStorage 24 h).
  const [roof3dModel, setRoof3dModel] = useState<any | null>(null);
  // Dernière vue caméra 3D gelée (orbite/zoom), persistée dans dynasty_breakdown
  // pour ré-ouvrir le traceur sur la même vue.
  const [roof3dView, setRoof3dView] = useState<{ phi: number; theta: number; r: number } | null>(null);
  // Géoréf de la vue satellite gelée dans le traceur (pour restaurer le fond).
  const [roof3dGeoRef, setRoof3dGeoRef] = useState<any | null>(null);
  // Chemin du rapport de toiture PDF joint à la soumission (storage quote-pdfs).
  const [roofReportPdfPath, setRoofReportPdfPath] = useState<string | null>(null);
  // Brouillon RoofTakeoff non-validé, autosavé sur soumissions.takeoff_draft
  // (PAS de localStorage — voir TakeoffFullscreen). Lu par le traceur comme
  // seed prioritaire ; effacé à la validation.
  const [roof3dTakeoffDraft, setRoof3dTakeoffDraft] = useState<any | null>(null);
  // Flush « 1ʳᵉ fois » du brouillon bufferisé en mémoire (cas brand-new : le
  // traceur a écrit avant que la soumission n'ait un id ; on pousse dès l'id
  // adopté). Ref garde un seul flush par id (pas de boucle).
  const flushedDraftForIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedId || flushedDraftForIdRef.current === loadedId) return;
    flushedDraftForIdRef.current = loadedId;
    if (!roof3dTakeoffDraft) return;
    // 'takeoff_draft' est une colonne jsonb ajoutée par migration ; le cast évite
    // de devoir régénérer les types Supabase pour un champ JSON libre.
    supabase.from('soumissions').update({ takeoff_draft: roof3dTakeoffDraft } as any).eq('id', loadedId)
      .then(({ error }) => { if (error) console.warn('takeoff_draft initial flush failed:', error); });
    // intentionally not depending on roof3dTakeoffDraft — only on loadedId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId]);
  const [showToolConfig, setShowToolConfig] = useState(false);
  const [toolConfigPos, setToolConfigPos] = useState({ x: 200, y: 100 });
  const [toolConfigSize, setToolConfigSize] = useState({ w: 900, h: 500 });
  const [draggingConfig, setDraggingConfig] = useState(false);
  const [resizingConfig, setResizingConfig] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const [collapsedMeasureTools, setCollapsedMeasureTools] = useState<Record<string, boolean>>({});

  // Save tools to localStorage on change
  useEffect(() => {
    localStorage.setItem('roof_measure_tools', JSON.stringify(measureTools));
  }, [measureTools]);

  // Helper to update a single tool (with linked tool propagation)
  const updateTool = (id: string, field: keyof MeasureTool, value: any) => {
    setMeasureTools(prev => {
      let updated = prev.map(t => t.id === id ? { ...t, [field]: value } : t);
      // If toolType changed, auto-correct unit if current unit is invalid + auto-fill building values
      if (field === 'toolType') {
        const newType = value as ToolType;
        const allowedUnits = UNITS_BY_TOOL_TYPE[newType] || ['pi'];
        updated = updated.map(t => {
          if (t.id !== id) return t;
          const fixedUnit = allowedUnits.includes(t.unit) ? t.unit : allowedUnits[0];
          const unit = fixedUnit;
          let cv = t.correctedValue;
          // Auto-fill from building data when switching to building source types
          if (newType === 'Surface bâtiment' && superficie) {
            cv = unit === 'm²' ? superficie.toFixed(1) : String(Math.round(superficie * 10.7639));
          } else if (newType === 'Périmètre bâtiment' && perimetre) {
            cv = unit === 'm' ? perimetre.toFixed(1) : String(Math.round(perimetre * 3.28084));
          }
          return { ...t, unit, correctedValue: cv };
        });
        // Propagate to linked tools
        const sourceTool = updated.find(t => t.id === id);
        if (sourceTool && sourceTool.correctedValue) {
          updated = updated.map(t => {
            if (t.linkedTo === id) {
              let propagatedValue = sourceTool.correctedValue;
              if (t.unit !== sourceTool.unit) {
                const numVal = parseFloat(propagatedValue);
                if (!isNaN(numVal)) {
                  if (sourceTool.unit === 'pi²' && t.unit === 'm²') propagatedValue = String((numVal / 10.7639).toFixed(1));
                  else if (sourceTool.unit === 'm²' && t.unit === 'pi²') propagatedValue = String(Math.round(numVal * 10.7639));
                  else if (sourceTool.unit === 'pi' && t.unit === 'm') propagatedValue = String((numVal / 3.28084).toFixed(1));
                  else if (sourceTool.unit === 'm' && t.unit === 'pi') propagatedValue = String(Math.round(numVal * 3.28084));
                }
              }
              return { ...t, correctedValue: propagatedValue, rawValue: sourceTool.rawValue };
            }
            return t;
          });
        }
      }
      // If correctedValue changed, propagate to tools linked to this one
      if (field === 'correctedValue') {
        const sourceTool = updated.find(t => t.id === id);
        if (sourceTool) {
          return updated.map(t => {
            if (t.linkedTo === id) {
              // Convert value if units differ
              let propagatedValue = value;
              if (t.unit !== sourceTool.unit) {
                const numVal = parseFloat(value);
                if (!isNaN(numVal)) {
                  if (sourceTool.unit === 'pi²' && t.unit === 'm²') propagatedValue = String((numVal / 10.7639).toFixed(1));
                  else if (sourceTool.unit === 'm²' && t.unit === 'pi²') propagatedValue = String(Math.round(numVal * 10.7639));
                  else if (sourceTool.unit === 'pi' && t.unit === 'm') propagatedValue = String((numVal / 3.28084).toFixed(1));
                  else if (sourceTool.unit === 'm' && t.unit === 'pi') propagatedValue = String(Math.round(numVal * 3.28084));
                  else propagatedValue = value;
                }
              }
              return { ...t, correctedValue: propagatedValue, rawValue: sourceTool.rawValue };
            }
            return t;
          });
        }
      }
      return updated;
    });
  };
  const addTool = () => {
    const newId = `tool_${Date.now()}`;
    setMeasureTools(prev => [...prev, { id: newId, name: 'Nouvel outil', toolType: 'Ligne' as ToolType, rawValue: '', correctedValue: '', unit: 'pi', color: '#9ca3af', visible: true, linkedTo: '', markerShape: 'circle' as MarkerShape }]);
  };
  const removeTool = (id: string) => {
    // Also clear any linkedTo references to this tool
    setMeasureTools(prev => prev.filter(t => t.id !== id).map(t => t.linkedTo === id ? { ...t, linkedTo: '' } : t));
  };

  // Legacy getters for backward compat with quote computation
  const faitiereOverride = measureTools.find(t => t.id === 'faitiere')?.correctedValue || '';
  const aretesOverride = measureTools.find(t => t.id === 'aretes')?.correctedValue || '';
  const nouesOverride = measureTools.find(t => t.id === 'noues')?.correctedValue || '';
  const eventsCount = measureTools.find(t => t.id === 'events')?.correctedValue || '';
  const maximumsCount = measureTools.find(t => t.id === 'maximums')?.correctedValue || '';

  // Legacy setters
  const setFaitiereOverride = (v: string) => updateTool('faitiere', 'correctedValue', v);
  const setAretesOverride = (v: string) => updateTool('aretes', 'correctedValue', v);
  const setNouesOverride = (v: string) => updateTool('noues', 'correctedValue', v);
  const setEventsCount = (v: string) => updateTool('events', 'correctedValue', v);
  const setMaximumsCount = (v: string) => updateTool('maximums', 'correctedValue', v);

  // Auto-populate tools linked to building polygon + propagate to linked tools
  useEffect(() => {
    setMeasureTools(prev => {
      let changed = false;
      let updated = prev.map(t => {
        if (t.toolType === 'Périmètre bâtiment' && perimetre) {
          const val = t.unit === 'm' ? perimetre.toFixed(1) : String(Math.round(perimetre * 3.28084));
          if (t.correctedValue !== val) { changed = true; return { ...t, correctedValue: val }; }
        }
        if (t.toolType === 'Surface bâtiment' && superficie) {
          const val = t.unit === 'm²' ? superficie.toFixed(1) : String(Math.round(superficie * 10.7639));
          if (t.correctedValue !== val) { changed = true; return { ...t, correctedValue: val }; }
        }
        return t;
      });
      // Propagate correctedValue from any source tool to linked tools
      if (changed) {
        updated = updated.map(t => {
          if (t.linkedTo) {
            const source = updated.find(s => s.id === t.linkedTo);
            if (source && source.correctedValue !== t.correctedValue) {
              return { ...t, correctedValue: source.correctedValue, rawValue: source.rawValue };
            }
          }
          return t;
        });
      }
      return changed ? updated : prev;
    });
  }, [perimetre, superficie]);

  // When linkedTo changes, sync values immediately
  const handleLinkedToChange = (toolId: string, newLinkedTo: string) => {
    setMeasureTools(prev => {
      const updated = prev.map(t => t.id === toolId ? { ...t, linkedTo: newLinkedTo } : t);
      if (newLinkedTo) {
        const source = updated.find(t => t.id === newLinkedTo);
        const target = updated.find(t => t.id === toolId);
        if (source && target) {
          let val = source.correctedValue;
          if (source.unit !== target.unit) {
            const numVal = parseFloat(val);
            if (!isNaN(numVal)) {
              if (source.unit === 'pi²' && target.unit === 'm²') val = String((numVal / 10.7639).toFixed(1));
              else if (source.unit === 'm²' && target.unit === 'pi²') val = String(Math.round(numVal * 10.7639));
              else if (source.unit === 'pi' && target.unit === 'm') val = String((numVal / 3.28084).toFixed(1));
              else if (source.unit === 'm' && target.unit === 'pi') val = String(Math.round(numVal * 3.28084));
            }
          }
          return updated.map(t => t.id === toolId ? { ...t, linkedTo: newLinkedTo, correctedValue: val, rawValue: source.rawValue } : t);
        }
      }
      return updated;
    });
  };

  const handleConfigMouseDown = (e: React.MouseEvent) => {
    setDraggingConfig(true);
    dragOffset.current = { x: e.clientX - toolConfigPos.x, y: e.clientY - toolConfigPos.y };
  };
  useEffect(() => {
    if (!draggingConfig) return;
    const move = (e: MouseEvent) => setToolConfigPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    const up = () => setDraggingConfig(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [draggingConfig]);
  const handleConfigResizeDown = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setResizingConfig(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: toolConfigSize.w, h: toolConfigSize.h };
  };
  useEffect(() => {
    if (!resizingConfig) return;
    const move = (e: MouseEvent) => {
      const dw = e.clientX - resizeStart.current.x;
      const dh = e.clientY - resizeStart.current.y;
      setToolConfigSize({ w: Math.max(500, resizeStart.current.w + dw), h: Math.max(250, resizeStart.current.h + dh) });
    };
    const up = () => setResizingConfig(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [resizingConfig]);
  // Line item overrides
  const [lineOverrides, setLineOverrides] = useState<Record<number, Partial<QuoteLine>>>({});
  const [extraLines, setExtraLines] = useState<QuoteLine[]>([]);
  const [showLineEditor, setShowLineEditor] = useState(false);
  const [hiddenLines, setHiddenLines] = useState<Set<number>>(new Set());

  // QB product mapping per line index
  const [lineQbProducts, setLineQbProducts] = useState<Record<number, string>>({});
  const [qbProducts, setQbProducts] = useState<any[]>([]);

  // QBO Estimate import
  const [qboEstimateDialogOpen, setQboEstimateDialogOpen] = useState(false);
  const [qboEstCustomers, setQboEstCustomers] = useState<any[]>([]);
  const [qboEstSearch, setQboEstSearch] = useState('');
  const [qboEstLoading, setQboEstLoading] = useState(false);
  const [qboEstSelectedCustomer, setQboEstSelectedCustomer] = useState<any>(null);
  const [qboEstimates, setQboEstimates] = useState<any[]>([]);
  const [qboEstimatesLoading, setQboEstimatesLoading] = useState(false);
  const [qboEstLines, setQboEstLines] = useState<any[]>([]);
  const [qboEstLinesLoading, setQboEstLinesLoading] = useState(false);
  const [qboEstSelectedEstimate, setQboEstSelectedEstimate] = useState<any>(null);

  const [lineMeasureMappings, setLineMeasureMappings] = useState<Record<number, string>>({});

  // Majoration % per line
  const [lineMajorations, setLineMajorations] = useState<Record<number, number>>({});
  const defaultMajoration = 5;

  // Push to QB state
  const [pushingToQb, setPushingToQb] = useState(false);
  const [qbPushResult, setQbPushResult] = useState<{ success: boolean; message: string; pdfUrl?: string } | null>(null);

  // Measure mode
  const [measureMode, setMeasureMode] = useState<MeasureTarget>(null);
  const [manualMeasureMode, setManualMeasureMode] = useState(false);
  const [planImageDataUrl, setPlanImageDataUrl] = useState<string | null>(null);
  const [savedPlanUrl, setSavedPlanUrl] = useState<string | null>(null);
  const [mapAnnotations, setMapAnnotations] = useState<AnnotationInfo[]>([]);
  const [deleteAnnotIdx, setDeleteAnnotIdx] = useState<number | null>(null);
  const [clearAllAnnotations, setClearAllAnnotations] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Crew size
  const [crewSize, setCrewSize] = useState(3);
  // Coverage per package (sqft) — overridable from settings
  const [coveragePerPkg, setCoveragePerPkg] = useState<number>(33.3);
  // Global Quote Generator settings (persisted in localStorage)
  const [quoteSettings, setQuoteSettings] = useState<QuoteSettings>(() => loadQuoteSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Hydrate dependent defaults once on mount from settings
  useEffect(() => {
    setCrewSize(quoteSettings.defaultCrewSize);
    setCoveragePerPkg(quoteSettings.defaultCoveragePerPkg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist settings whenever they change
  useEffect(() => { saveQuoteSettings(quoteSettings); }, [quoteSettings]);

  // ── Auto-sync correctedValue from annotations for ALL tools that accept annotations ──
  // Bug fix #1: onMeasureComplete previously REPLACED correctedValue with the latest
  // segment value, losing prior segments. We now derive correctedValue from the
  // full annotations list so additions AND deletions stay consistent.
  // Applies to Ligne, Multi-segment, and Compteur (i.e. anything that is not a
  // "Surface bâtiment" / "Périmètre bâtiment" / linked tool).
  //
  // Bug fix #2: dedupe identical annotations (same target + same segments_latlng)
  // before computing the sum, so a duplicate save event cannot inflate quantities.
  useEffect(() => {
    setMeasureTools(prev => {
      let changed = false;
      const next = prev.map(t => {
        if (t.toolType !== 'Ligne' && t.toolType !== 'Multi-segment' && t.toolType !== 'Compteur') return t;
        if (t.linkedTo) return t; // linked tools inherit value from source
        const anns = mapAnnotations.filter(a => a.target === t.id);
        if (anns.length === 0) return t;
        // Dedupe by signature of segments_latlng (fallback: segments_px, then feet)
        const seen = new Set<string>();
        const unique = anns.filter(a => {
          const sig = JSON.stringify(
            (a as any).segments_latlng ?? (a as any).segments_px ?? [a.feet, (a as any).index]
          );
          if (seen.has(sig)) return false;
          seen.add(sig);
          return true;
        });
        const derived = t.toolType === 'Compteur'
          ? unique.length
          : Math.round(unique.reduce((s, a) => s + (Number(a.feet) || 0), 0));
        const derivedStr = String(derived);
        if (t.correctedValue !== derivedStr) {
          changed = true;
          return { ...t, correctedValue: derivedStr, rawValue: derivedStr };
        }
        return t;
      });
      return changed ? next : prev;
    });
  }, [mapAnnotations]);

  // ── Physically dedupe identical annotations in state (same target + geometry) ──
  // Prevents duplicate UI rows and double counts on save.
  useEffect(() => {
    setMapAnnotations(prev => {
      const seen = new Set<string>();
      const next = prev.filter(a => {
        const sig = `${a.target}|` + JSON.stringify(
          (a as any).segments_latlng ?? (a as any).segments_px ?? [a.feet]
        );
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapAnnotations.length]);
  const [quoteNotes, setQuoteNotes] = useState('');
  // Confirmation des 4 boîtes de l'aperçu (Section 5)
  const [previewConfirmed, setPreviewConfirmed] = useState<{
    header: boolean; notes: boolean; terms: boolean; exclusions: boolean;
  }>({ header: false, notes: false, terms: false, exclusions: false });
  const [paymentTerms, setPaymentTerms] = useState('');
  // Champs en-tête éditables du PDF + QBO (persistés dans dynasty_breakdown)
  const [quoteHeaderFields, setQuoteHeaderFields] = useState<{
    quoteDate: string; validityDays: number; devisNo: string;
    contractType: 'FORFAITAIRE' | 'BUDGÉTAIRE' | 'COST PLUS';
    projectAddress: string; projectNo: string;
  }>(() => ({
    quoteDate: new Date().toISOString().slice(0, 10),
    validityDays: 16,
    devisNo: '',
    contractType: 'FORFAITAIRE',
    projectAddress: '',
    projectNo: '',
  }));

  // Exclusions / Inclusions list (cochables, ajoutables) — affichées dans l'aperçu
  const DEFAULT_EXCLUSIONS = [
    'Permis de construction',
    'Protection des aménagements',
    'Conteneur à déchets',
    'Gouttières',
    'Ventilation',
    'Isolation',
    'Réparation de la structure (charpente)',
    'Remplacement du pontage (plywood)',
    'Travaux de maçonnerie / cheminée',
    'Réparation de soffites et fascias',
    'Installation de pare-neige',
    'Travaux électriques (CP, antenne, panneaux solaires)',
    'Démolition de structures existantes (cabanon, abri)',
    'Frais de stationnement / permis municipaux',
    'Déneigement du toit',
  ];
  const [exclusionsList, setExclusionsList] = useState<string[]>(DEFAULT_EXCLUSIONS);
  const [exclusionsChecked, setExclusionsChecked] = useState<Record<string, boolean>>({});
  const [newExclusionText, setNewExclusionText] = useState('');

  // ── Email d'envoi au client ──
  type EmailTemplate = { id: string; name: string; subject: string; body: string; is_default?: boolean; default_attachments?: { name: string; url: string; size: number; path?: string }[] };
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [emailToOverride, setEmailToOverride] = useState<string>('');
  const [emailCc, setEmailCc] = useState<string>('');
  const [emailBcc, setEmailBcc] = useState<string>('');
  // Historique des CC/BCC saisis pour proposer en autocomplétion
  const [ccHistory, setCcHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('vb_quote_cc_history') || '[]'); } catch { return []; }
  });
  const [bccHistory, setBccHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('vb_quote_bcc_history') || '[]'); } catch { return []; }
  });
  const rememberRecipients = (cc: string, bcc: string) => {
    const parse = (s: string) => s.split(/[,;]/).map(x => x.trim()).filter(x => /.+@.+\..+/.test(x));
    const nextCc = Array.from(new Set([...parse(cc), ...ccHistory])).slice(0, 25);
    const nextBcc = Array.from(new Set([...parse(bcc), ...bccHistory])).slice(0, 25);
    setCcHistory(nextCc); setBccHistory(nextBcc);
    try {
      localStorage.setItem('vb_quote_cc_history', JSON.stringify(nextCc));
      localStorage.setItem('vb_quote_bcc_history', JSON.stringify(nextBcc));
    } catch { /* noop */ }
  };
  const [emailSubject, setEmailSubject] = useState<string>('');
  const [emailBody, setEmailBody] = useState<string>('');
  const [emailEditMode, setEmailEditMode] = useState<boolean>(false);
  const [sendingClientEmail, setSendingClientEmail] = useState<boolean>(false);
  const [emailSendResult, setEmailSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // Sélection des pièces jointes (par nom de fichier) — toutes cochées par défaut
  const [includeOfficialPdf, setIncludeOfficialPdf] = useState<boolean>(true);
  const [excludedAttachments, setExcludedAttachments] = useState<Set<string>>(new Set());
  const toggleAttachment = (name: string) => {
    setExcludedAttachments(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  const readTemplateAttachmentCache = (): Record<string, EmailTemplate['default_attachments']> => {
    try { return JSON.parse(localStorage.getItem('vb_quote_template_attachments') || '{}'); } catch { return {}; }
  };
  const writeTemplateAttachmentCache = (id: string, attachments: EmailTemplate['default_attachments']) => {
    try {
      localStorage.setItem('vb_quote_template_attachments', JSON.stringify({ ...readTemplateAttachmentCache(), [id]: attachments || [] }));
    } catch { /* noop */ }
  };

  // Charger les templates au montage
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('quote_email_templates').select('*').order('is_default', { ascending: false });
      if (data && data.length) {
        const cachedAttachments = readTemplateAttachmentCache();
        const templates = data.map((t: any) => ({ ...t, default_attachments: Array.isArray(t.default_attachments) ? t.default_attachments : (cachedAttachments[t.id] || []) }));
        setEmailTemplates(templates);
        const def = templates.find((t: any) => t.is_default) || templates[0];
        setSelectedTemplateId(def.id);
        setEmailSubject(def.subject);
        setEmailBody(def.body);
        const defAtt = Array.isArray(def.default_attachments) ? def.default_attachments : [];
        if (defAtt.length) setPdfFiles(defAtt);
      }
    })();
  }, []);

  // Quand on change de template, charger son contenu
  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const t = emailTemplates.find(x => x.id === id);
    if (t) {
      setEmailSubject(t.subject);
      setEmailBody(t.body);
      const defAtt = Array.isArray((t as any).default_attachments) ? (t as any).default_attachments : [];
      setPdfFiles(defAtt);
    }
  };

  // Sauvegarder le modèle courant (mise à jour)
  const saveCurrentTemplate = async () => {
    const t = emailTemplates.find(x => x.id === selectedTemplateId);
    if (!t) { alert('Aucun modèle sélectionné. Cliquez sur "Nouveau" pour en créer un.'); return; }
    const newName = prompt('Nom du modèle :', t.name);
    if (!newName) return;
    const attachmentsPayload = (pdfFiles || []).map(f => ({ name: f.name, url: f.url, size: f.size }));
    let { error } = await (supabase as any)
      .from('quote_email_templates')
      .update({ name: newName, subject: emailSubject, body: emailBody, default_attachments: attachmentsPayload, updated_at: new Date().toISOString() })
      .eq('id', t.id);
    if (error?.message?.includes('default_attachments')) {
      writeTemplateAttachmentCache(t.id, attachmentsPayload);
      const retry = await (supabase as any)
        .from('quote_email_templates')
        .update({ name: newName, subject: emailSubject, body: emailBody, updated_at: new Date().toISOString() })
        .eq('id', t.id);
      error = retry.error;
    }
    if (error) { alert('Erreur : ' + error.message); return; }
    setEmailTemplates(prev => prev.map(x => x.id === t.id ? { ...x, name: newName, subject: emailSubject, body: emailBody, default_attachments: attachmentsPayload } : x));
    alert(`Modèle mis à jour ✓${attachmentsPayload.length ? ` (${attachmentsPayload.length} pièce(s) jointe(s) par défaut)` : ''}`);
  };

  // Créer un nouveau modèle à partir du contenu courant
  const saveAsNewTemplate = async () => {
    const name = prompt('Nom du nouveau modèle :', 'Mon modèle personnalisé');
    if (!name) return;
    const attachmentsPayload = (pdfFiles || []).map(f => ({ name: f.name, url: f.url, size: f.size }));
    let { data, error } = await (supabase as any)
      .from('quote_email_templates')
      .insert({ name, subject: emailSubject, body: emailBody, is_default: false, default_attachments: attachmentsPayload })
      .select()
      .single();
    if (error?.message?.includes('default_attachments')) {
      const retry = await (supabase as any)
        .from('quote_email_templates')
        .insert({ name, subject: emailSubject, body: emailBody, is_default: false })
        .select()
        .single();
      data = retry.data;
      error = retry.error;
      if (data?.id) writeTemplateAttachmentCache(data.id, attachmentsPayload);
    }
    if (error) { alert('Erreur : ' + error.message); return; }
    setEmailTemplates(prev => [...prev, { ...data, default_attachments: attachmentsPayload }]);
    setSelectedTemplateId(data.id);
    alert('Nouveau modèle créé ✓');
  };

  // Supprimer le modèle courant
  const deleteCurrentTemplate = async () => {
    const t = emailTemplates.find(x => x.id === selectedTemplateId);
    if (!t) return;
    if (!confirm(`Supprimer le modèle "${t.name}" ?`)) return;
    const { error } = await (supabase as any).from('quote_email_templates').delete().eq('id', t.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    const remaining = emailTemplates.filter(x => x.id !== t.id);
    setEmailTemplates(remaining);
    if (remaining.length) {
      const next = remaining[0];
      setSelectedTemplateId(next.id);
      setEmailSubject(next.subject);
      setEmailBody(next.body);
    } else {
      setSelectedTemplateId('');
    }
  };

  // Définir le modèle courant comme défaut
  const setAsDefaultTemplate = async () => {
    const t = emailTemplates.find(x => x.id === selectedTemplateId);
    if (!t) return;
    await (supabase as any).from('quote_email_templates').update({ is_default: false }).neq('id', t.id);
    const { error } = await (supabase as any).from('quote_email_templates').update({ is_default: true }).eq('id', t.id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setEmailTemplates(prev => prev.map(x => ({ ...x, is_default: x.id === t.id })));
    alert('Modèle défini par défaut ✓');
  };

  // Work type
  const DEFAULT_WORK_TYPES = ['Réfection complète', 'Nouvelle couverture', 'Réparations mineures'];
  const [workTypeOptions, setWorkTypeOptions] = useState<string[]>(DEFAULT_WORK_TYPES);
  const [workType, setWorkType] = useState<string>('');
  const [showAddWorkType, setShowAddWorkType] = useState(false);
  const [newWorkTypeText, setNewWorkTypeText] = useState('');

  // Champs de classification partagés avec le tableau de bord / Gantt (mêmes colonnes
  // Supabase). Chargés depuis la soumission et réécrits tels quels pour ne JAMAIS
  // écraser ce qui a été saisi ailleurs (avant : valeurs codées en dur à la sauvegarde).
  const [roofCategory, setRoofCategory] = useState<string>('residential');
  const [buildingType, setBuildingType] = useState<string>('');
  const [complexity, setComplexity] = useState<string>('');
  const [colorName, setColorName] = useState<string>('');
  const [contactPreference, setContactPreference] = useState<string>('email');

  // Coverage type multi-select dropdown
  const [showCoverageDropdown, setShowCoverageDropdown] = useState(false);

  const [lineCategories, setLineCategories] = useState<Record<number, LineCategory>>({});

  // Quote templates
  // ── Lot 2: extended line metadata ──
  type LineCategory = 'materiau' | 'main_oeuvre' | 'sous_traitance' | 'equipement' | 'transport' | 'divers';
  type LaborType = 'arrachage' | 'pose';
  const LINE_CATEGORIES: { value: LineCategory; label: string; color: string; bg: string }[] = [
    { value: 'main_oeuvre',    label: "Main d'œuvre",    color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
    { value: 'materiau',       label: 'Matériaux',       color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
    { value: 'sous_traitance', label: 'Sous-traitance',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
    { value: 'equipement',     label: 'Équipement',      color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
    { value: 'transport',      label: 'Transport',       color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
    { value: 'divers',         label: 'Divers',          color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
  ];
  const LABOR_TYPES: { value: LaborType; label: string }[] = [
    { value: 'arrachage', label: 'Arrachage' },
    { value: 'pose',      label: 'Pose' },
  ];
  // Per-line cost override (manual edit, falls back to QBO purchase_cost)
  const [lineCostOverrides, setLineCostOverrides] = useState<Record<number, number>>({});
  // Per-line labor sub-types (only when category = main_oeuvre)
  const [lineLaborTypes, setLineLaborTypes] = useState<Record<number, LaborType[]>>({});
  // Global margin threshold (% target) for visual indicators
  const [marginThresholdPct, setMarginThresholdPct] = useState<number>(() => {
    const saved = localStorage.getItem('quote_margin_threshold');
    return saved ? Number(saved) : 35;
  });
  useEffect(() => {
    localStorage.setItem('quote_margin_threshold', String(marginThresholdPct));
  }, [marginThresholdPct]);

  interface QuoteTemplate {
    id: string;
    name: string;
    tools: MeasureTool[];
    coverageType: string;
    marque: string;
    gamme: string;
    roofType: RoofType;
    slopeCategory: SlopeCategory;
    workType: string;
    lineMeasureMappings?: Record<number, string>;
    lineQbProducts?: Record<number, string>;
    lineCategories?: Record<number, LineCategory>;
    lineCostOverrides?: Record<number, number>;
    lineLaborTypes?: Record<number, LaborType[]>;
    marginThresholdPct?: number;
    lineMajorations?: Record<number, number>;
    extraLines?: QuoteLine[];
    hiddenLines?: number[];
    lineOverrides?: Record<number, Partial<QuoteLine>>;
  }
  const [quoteTemplates, setQuoteTemplates] = useState<QuoteTemplate[]>([]);
  const [quoteTemplatesLoading, setQuoteTemplatesLoading] = useState(true);
  const [quoteTemplatesError, setQuoteTemplatesError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');

  const normalizeQuoteTemplate = (row: any): QuoteTemplate => {
    const payload = row?.payload || row || {};
    return {
      ...payload,
      id: row?.id || payload.id || crypto.randomUUID(),
      name: row?.name || payload.name || 'Modèle sans nom',
      tools: Array.isArray(payload.tools) ? payload.tools : DEFAULT_TOOLS,
      coverageType: payload.coverageType || '',
      marque: payload.marque || '',
      gamme: payload.gamme || '',
      roofType: payload.roofType || '2pans',
      slopeCategory: payload.slopeCategory || 'aucune',
      workType: payload.workType || '',
    };
  };

  // Charger les modèles depuis Supabase + migration auto depuis localStorage si présent
  useEffect(() => {
    let cancelled = false;
    const loadQuoteTemplates = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']) => {
      setQuoteTemplatesLoading(true);
      setQuoteTemplatesError(null);
      if (!session) {
        if (!cancelled) {
          setQuoteTemplates([]);
          setQuoteTemplatesError('Session admin non prête: reconnecte-toi pour charger les modèles Supabase.');
          setQuoteTemplatesLoading(false);
        }
        return;
      }

      const { data, error } = await (supabase as any)
        .from('quote_templates')
        .select('*')
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        setQuoteTemplatesError(`Impossible de charger les modèles Supabase: ${error.message}`);
      }
      const remote: QuoteTemplate[] = error ? [] : (data || []).map(normalizeQuoteTemplate);
      if (remote.length > 0) {
        setQuoteTemplates(remote);
        setQuoteTemplatesLoading(false);
        return;
      }

      // Si la table Supabase est vide, récupérer les anciens modèles locaux et retenter l'import.
      try {
        const legacyRaw = localStorage.getItem('quote_templates');
        const legacy: QuoteTemplate[] = legacyRaw ? JSON.parse(legacyRaw) : [];
        if (Array.isArray(legacy) && legacy.length > 0) {
          const localTemplates = legacy.map(normalizeQuoteTemplate);
          setQuoteTemplates(localTemplates);
          const rows = localTemplates.map(({ id, name, ...payload }) => ({ name, payload, created_by: session.user.id }));
          const { data: inserted, error: insertError } = await (supabase as any).from('quote_templates').insert(rows).select('*');
          if (cancelled) return;
          if (insertError) {
            setQuoteTemplatesError(`Modèles locaux trouvés, mais import Supabase échoué: ${insertError.message}`);
          } else if (inserted) {
            setQuoteTemplates(inserted.map(normalizeQuoteTemplate));
            localStorage.setItem('quote_templates_migrated_v1', '1');
          }
          setQuoteTemplatesLoading(false);
          return;
        }
      } catch (e) { console.warn('legacy migration skipped', e); }

      setQuoteTemplates([]);
      setQuoteTemplatesLoading(false);
    };

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      await loadQuoteTemplates(session);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) loadQuoteTemplates(session);
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  const stripToolQuantities = (tools: MeasureTool[]): MeasureTool[] =>
    tools.map(t => ({ ...t, rawValue: '', correctedValue: '' }));

  const saveAsTemplate = async () => {
    if (!templateName.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { alert('Session admin non prête. Reconnecte-toi puis réessaie.'); return; }
    const payload: Omit<QuoteTemplate, 'id' | 'name'> = {
      tools: stripToolQuantities(measureTools),
      coverageType: selectedCoverageType,
      marque: selectedMarque,
      gamme: selectedGamme,
      roofType,
      slopeCategory,
      workType,
      lineMeasureMappings,
      lineQbProducts,
      lineCategories,
      lineMajorations,
      extraLines: extraLines.map(l => ({ ...l, quantity: 0, total_base: 0, total_displayed: 0 })),
      hiddenLines: Array.from(hiddenLines),
      lineOverrides: Object.fromEntries(
        Object.entries(lineOverrides).map(([k, v]) => [k, { ...v, quantity: undefined }])
      ),
      lineCostOverrides,
      lineLaborTypes,
      marginThresholdPct,
    } as any;
    const { data, error } = await (supabase as any)
      .from('quote_templates')
      .insert({ name: templateName.trim(), payload, created_by: session.user.id })
      .select('*')
      .single();
    if (error || !data) { alert('Échec de l\'enregistrement: ' + (error?.message || 'inconnu')); return; }
    const tpl: QuoteTemplate = { id: data.id, ...(data.payload || {}), name: data.name };
    setQuoteTemplates(prev => [...prev, tpl]);
    setTemplateName('');
  };

  const loadTemplate = (tpl: QuoteTemplate) => {
    setMeasureTools(tpl.tools);
    setSelectedCoverageType(tpl.coverageType);
    setSelectedMarque(tpl.marque);
    setSelectedGamme(tpl.gamme);
    setRoofType(tpl.roofType);
    setSlopeCategory(tpl.slopeCategory);
    setWorkType(tpl.workType || '');
    setActiveTemplateId(tpl.id);
    if (tpl.lineMeasureMappings) setLineMeasureMappings(tpl.lineMeasureMappings);
    if (tpl.lineQbProducts) setLineQbProducts(tpl.lineQbProducts);
    if (tpl.lineCategories) setLineCategories(tpl.lineCategories);
    if (tpl.lineMajorations) setLineMajorations(tpl.lineMajorations);
    if (tpl.extraLines) setExtraLines(tpl.extraLines);
    if (tpl.hiddenLines) setHiddenLines(new Set(tpl.hiddenLines));
    if (tpl.lineOverrides) setLineOverrides(tpl.lineOverrides);
    if (tpl.lineCostOverrides) setLineCostOverrides(tpl.lineCostOverrides);
    if (tpl.lineLaborTypes) setLineLaborTypes(tpl.lineLaborTypes);
    if (typeof tpl.marginThresholdPct === 'number') setMarginThresholdPct(tpl.marginThresholdPct);
  };

  const updateTemplate = async (id: string) => {
    const current = quoteTemplates.find(t => t.id === id);
    const newName = editingTemplateName.trim() || current?.name || 'Modèle';
    const payload: Omit<QuoteTemplate, 'id' | 'name'> = {
      tools: stripToolQuantities(measureTools),
      coverageType: selectedCoverageType,
      marque: selectedMarque,
      gamme: selectedGamme,
      roofType,
      slopeCategory,
      workType,
      lineMeasureMappings,
      lineQbProducts,
      lineCategories,
      lineMajorations,
      extraLines: extraLines.map(l => ({ ...l, quantity: 0, total_base: 0, total_displayed: 0 })),
      hiddenLines: Array.from(hiddenLines),
      lineOverrides: Object.fromEntries(
        Object.entries(lineOverrides).map(([k, v]) => [k, { ...v, quantity: undefined }])
      ),
      lineCostOverrides,
      lineLaborTypes,
      marginThresholdPct,
    } as any;
    const { error } = await (supabase as any)
      .from('quote_templates')
      .update({ name: newName, payload })
      .eq('id', id);
    if (error) { alert('Échec de la mise à jour: ' + error.message); return; }
    setQuoteTemplates(prev => prev.map(t => t.id === id ? { id, name: newName, ...payload } as QuoteTemplate : t));
    setEditingTemplateId(null);
    setEditingTemplateName('');
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Supprimer ce modèle ?')) return;
    const snapshot = quoteTemplates;
    setQuoteTemplates(prev => prev.filter(t => t.id !== id));
    if (editingTemplateId === id) setEditingTemplateId(null);
    const { error } = await (supabase as any).from('quote_templates').delete().eq('id', id);
    if (error) {
      setQuoteTemplates(snapshot);
      alert('Échec de la suppression: ' + error.message);
    }
  };

   // Real costs (kept for backward compat with saved data)
  const [realCosts, setRealCosts] = useState<Record<number, number>>({});

  // Client info
  const [clientFirst, setClientFirst] = useState('');
  const [clientLast, setClientLast] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientPostalAddress, setClientPostalAddress] = useState('');
  const [isCompany, setIsCompany] = useState(false);
  const [clientNeq, setClientNeq] = useState('');
  const [useOwnerAsClient, setUseOwnerAsClient] = useState(false);
  const [selectedQbCustomer, setSelectedQbCustomer] = useState<any>(null);
  const [qbCustomers, setQbCustomers] = useState<any[]>([]);
  const [qbCustomerSearch, setQbCustomerSearch] = useState('');
  const [showQbDropdown, setShowQbDropdown] = useState(false);
  const [qbDuplicateMatch, setQbDuplicateMatch] = useState<any>(null);
  const [creatingQbCustomer, setCreatingQbCustomer] = useState(false);
  const [qbCreateResult, setQbCreateResult] = useState<{ success: boolean; message: string } | null>(null);
  // Pending qb_id to rehydrate after qbCustomers list loads
  const [pendingQbCustomerId, setPendingQbCustomerId] = useState<string | null>(null);

  // Owner lookup (supports multiple owners)
  type OwnerEntry = {
    ownerName: string; address: string; city: string; postalCode: string;
    acquisitionDate?: string; price?: string;
  };
  const [ownerList, setOwnerList] = useState<OwnerEntry[]>([]);
  const [selectedOwnerIdxs, setSelectedOwnerIdxs] = useState<number[]>([0]);
  const selectedOwnerIdx = selectedOwnerIdxs[0] ?? 0;
  const ownerData = ownerList.length > 0 ? ownerList[selectedOwnerIdx] || ownerList[0] : null;
  const toggleOwnerIdx = (idx: number) => {
    setSelectedOwnerIdxs(prev => {
      if (prev.includes(idx)) {
        const next = prev.filter(i => i !== idx);
        return next.length > 0 ? next : [idx]; // keep at least one selected
      }
      return [...prev, idx];
    });
    setUseOwnerAsClient(false);
  };
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);

  // Saving & PDF
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Refs (et non un state) : un autosave silencieux ne doit déclencher AUCUN
  // re-render du module — sinon le scroll devient saccadé toutes les ~3 s.
  const autosavingRef = useRef(false);
  const autosavedAtRef = useRef<number | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [contractType, setContractType] = useState<'forfaitaire' | 'budgetaire' | 'cost-plus'>('forfaitaire');
  const [contractHtml, setContractHtml] = useState('');
  const [contractPreviewStatus, setContractPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [contractPreviewError, setContractPreviewError] = useState<string | null>(null);
  const [showContractFullscreen, setShowContractFullscreen] = useState(false);
  const [contractDropdownOpen, setContractDropdownOpen] = useState(true); // aperçu du contrat ouvert par défaut
  const [generatingContractPdf, setGeneratingContractPdf] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<number, boolean>>({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true });
  const [openedMissingFor, setOpenedMissingFor] = useState<number | null>(null);
  const [originalEstimateLow, setOriginalEstimateLow] = useState<number | null>(null);
  const [originalEstimateHigh, setOriginalEstimateHigh] = useState<number | null>(null);
  const [originalSubtotal, setOriginalSubtotal] = useState<number | null>(null);
  const toggleSection = (n: number) => {
    // En repliant une section, on referme aussi son panneau « champs à compléter »
    // (rendu hors du conteneur repliable) pour qu'elle ne reste pas figée ouverte.
    const willCollapse = !collapsedSections[n];
    setCollapsedSections(prev => ({ ...prev, [n]: !prev[n] }));
    if (willCollapse) setOpenedMissingFor(cur => (cur === n ? null : cur));
  };
  const contractIframeRef = useRef<HTMLIFrameElement>(null);

  // Editable contract fields
  interface ContractFields {
    clientName: string; clientAddress: string; clientPhone: string; clientEmail: string;
    dossierNo: string; contractDate: string; workAddress: string; devisNo: string;
    startDate: string; durationDays: string;
    prixForfaitaire: string;
    budgetMateriaux: string; budgetMainOeuvre: string; budgetTotal: string;
    honorairePct: string; estimationInitiale: string; plafondBudget: string; plafondType: 'sans' | 'avec';
  }
  const [contractFields, setContractFields] = useState<ContractFields>({
    clientName: '', clientAddress: '', clientPhone: '', clientEmail: '',
    dossierNo: '', contractDate: new Date().toLocaleDateString('fr-CA'), workAddress: '', devisNo: '',
    startDate: '', durationDays: '',
    prixForfaitaire: '', budgetMateriaux: '', budgetMainOeuvre: '', budgetTotal: '',
    honorairePct: '15', estimationInitiale: '', plafondBudget: '', plafondType: 'sans',
  });
  const contractFieldsInitRef = useRef(false);
  const updateContractField = (key: keyof ContractFields, value: string) => {
    setContractFields(prev => ({ ...prev, [key]: value }));
  };

  // ── Inline edits inside the contract preview iframe ──
  // Persisted alongside the quote so checkbox states & warranty duration survive reloads.
  interface ContractInlineEdits {
    checkboxes: Record<string, boolean>;   // cb-id -> checked
    warrantyYearsContract: number;          // duration shown in Article "Garantie"
    freeText: Record<string, string>;       // optional free-text inline edits
  }
  const [contractInlineEdits, setContractInlineEdits] = useState<ContractInlineEdits>({
    checkboxes: {},
    warrantyYearsContract: 5,
    freeText: {},
  });
  // Mode "Blanks" : remplace les valeurs préremplies par des lignes vides à remplir à la main.
  const [blankContractMode, setBlankContractMode] = useState(false);
  

  // PDF attachments
  const [pdfFiles, setPdfFiles] = useState<{ name: string; url: string; size: number; path?: string }[]>([]);
  // URL of the image (typically a Street View capture) used as the contact's
  // photo. Embedded into the .vcf so iPhone shows it on caller ID.
  const [contactPhotoUrl, setContactPhotoUrl] = useState<string | null>(null);
  // Photo principale du projet (affichée en section 1, persistée dans dynasty_breakdown)
  const [projectPhotoUrl, setProjectPhotoUrl] = useState<string | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [generatingMaterialList, setGeneratingMaterialList] = useState(false);

  /** Extract the storage object path from a previously-signed quote-pdfs URL.
   *  Returns null if the URL doesn't match the expected signed-URL format. */
  const extractStoragePath = (url: string): string | null => {
    if (!url) return null;
    const m = url.match(/\/object\/(?:sign|public)\/quote-pdfs\/([^?]+)/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  };

  /** Re-sign a quote-pdfs URL with the long TTL. Falls back to the original
   *  URL if the path can't be resolved (legacy entries). */
  const refreshSignedUrl = async (url: string, knownPath?: string): Promise<string> => {
    const path = knownPath || extractStoragePath(url);
    if (!path) return url;
    const fresh = await getSignedQuotePdfUrl(path, QUOTE_PDF_LONG_TTL);
    return fresh || url;
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingPdf(true);
    try {
      for (const file of Array.from(files)) {
        const isPdf = file.type === 'application/pdf';
        const isImg = file.type.startsWith('image/');
        if (!isPdf && !isImg) continue;
        // ── Vague A : compression image transparente (HEIC → JPEG, ≤ 1.5 Mo) ──
        let uploadBlob: Blob = file;
        let uploadName: string = file.name;
        let uploadSize: number = file.size;
        if (FEATURE_IMAGE_COMPRESSION && isImg) {
          try {
            const c = await compressImageFile(file);
            uploadBlob = c.blob;
            uploadName = c.name;
            uploadSize = c.finalSize;
            if (c.converted && c.finalSize < c.originalSize * 0.6) {
              toast.success(
                `Image compressée (${(c.originalSize / 1024 / 1024).toFixed(1)} Mo → ${(c.finalSize / 1024 / 1024).toFixed(1)} Mo)`,
                { duration: 2200 },
              );
            }
          } catch (err) {
            console.warn('[Vague A] image compression failed, uploading original:', err);
          }
        }
        const safeName = `uploads/${Date.now()}_${uploadName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error } = await supabase.storage.from('quote-pdfs').upload(safeName, uploadBlob, {
          upsert: true,
          contentType: (uploadBlob as any).type || file.type || undefined,
        });
        if (error) { console.error('Upload error:', error); continue; }
        const __signed = await getSignedQuotePdfUrl(safeName, QUOTE_PDF_LONG_TTL);
        setPdfFiles(prev => [...prev, { name: uploadName, url: __signed || '', size: uploadSize, path: safeName }]);
      }
    } catch (err) { console.error('PDF upload failed:', err); }
    finally { setUploadingPdf(false); if (pdfInputRef.current) pdfInputRef.current.value = ''; }
  };

  const removePdfFile = (idx: number) => setPdfFiles(prev => prev.filter((_, i) => i !== idx));

  /** Upload a generated Blob (e.g. street view annotation PNG) to the documents bucket. */
  const uploadDocBlob = useCallback(async (blob: Blob, suggestedName: string) => {
    setUploadingPdf(true);
    try {
      const safeName = `uploads/${Date.now()}_${suggestedName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const file = new File([blob], suggestedName, { type: blob.type || 'image/png' });
      const { error } = await supabase.storage.from('quote-pdfs').upload(safeName, file, { upsert: true, contentType: file.type });
      if (error) { console.error('Upload error:', error); toast.error('Téléversement échoué'); return; }
      const __signed = await getSignedQuotePdfUrl(safeName, QUOTE_PDF_LONG_TTL);
      setPdfFiles(prev => [...prev, { name: suggestedName, url: __signed || '', size: blob.size, path: safeName }]);
      toast.success('Capture enregistrée dans la gestion documentaire');
    } catch (err) {
      console.error('Doc blob upload failed:', err);
      toast.error('Téléversement échoué');
    } finally {
      setUploadingPdf(false);
    }
  }, []);

  /** Drop handler that accepts PDF + image files. */
  const handleDocDrop = useCallback(async (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    const files = ev.dataTransfer?.files;
    if (!files || files.length === 0) return;
    setUploadingPdf(true);
    try {
      for (const file of Array.from(files)) {
        const isPdf = file.type === 'application/pdf';
        const isImg = file.type.startsWith('image/');
        if (!isPdf && !isImg) continue;
        // ── Vague A : compression image (alignée sur handlePdfUpload) ──
        let uploadBlob: Blob = file;
        let uploadName: string = file.name;
        let uploadSize: number = file.size;
        if (FEATURE_IMAGE_COMPRESSION && isImg) {
          try {
            const c = await compressImageFile(file);
            uploadBlob = c.blob;
            uploadName = c.name;
            uploadSize = c.finalSize;
          } catch (err) {
            console.warn('[Vague A] image compression failed, uploading original:', err);
          }
        }
        const safeName = `uploads/${Date.now()}_${uploadName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error } = await supabase.storage.from('quote-pdfs').upload(safeName, uploadBlob, {
          upsert: true,
          contentType: (uploadBlob as any).type || file.type || undefined,
        });
        if (error) { console.error('Upload error:', error); continue; }
        const __signed = await getSignedQuotePdfUrl(safeName, QUOTE_PDF_LONG_TTL);
        setPdfFiles(prev => [...prev, { name: uploadName, url: __signed || '', size: uploadSize, path: safeName }]);
      }
    } finally { setUploadingPdf(false); }
  }, []);

  // Warranty certificate
  const [showWarranty, setShowWarranty] = useState(false);
  const [warrantyYears, setWarrantyYears] = useState(5);
  const [warrantyCompletionDate, setWarrantyCompletionDate] = useState('');
  const [warrantyInvoice, setWarrantyInvoice] = useState('');
  const [warrantyContractAmount, setWarrantyContractAmount] = useState('');
  const [warrantyIncludeConditions, setWarrantyIncludeConditions] = useState(true);
  const [generatingWarranty, setGeneratingWarranty] = useState(false);

  // ── Load QB customers & products from cache ──
  useEffect(() => {
    const loadQbData = async () => {
      const [custRes, prodRes] = await Promise.all([
        (supabase as any).from('qb_customers').select('*').order('display_name'),
        (supabase as any).from('qb_products').select('*').eq('active', true).order('name'),
      ]);
      if (custRes.data && custRes.data.length > 0) {
        setQbCustomers(custRes.data.map((c: any) => ({
          Id: c.qb_id, DisplayName: c.display_name,
          CompanyName: c.company_name,
          GivenName: c.raw_data?.GivenName || '',
          FamilyName: c.raw_data?.FamilyName || '',
          PrimaryEmailAddr: c.email ? { Address: c.email } : null,
          PrimaryPhone: c.phone ? { FreeFormNumber: c.phone } : null,
          Mobile: c.mobile ? { FreeFormNumber: c.mobile } : null,
          BillAddr: c.bill_address ? { Line1: c.bill_address } : null,
        })));
      }
      if (prodRes.data) setQbProducts(prodRes.data);
    };
    loadQbData();
  }, []);

  // ── Duplicate detection ──
  useEffect(() => {
    if (!clientFirst && !clientLast && !clientEmail) { setQbDuplicateMatch(null); return; }
    const fullName = `${clientFirst} ${clientLast}`.trim().toLowerCase();
    const match = qbCustomers.find((c: any) => {
      const dn = (c.DisplayName || '').toLowerCase();
      const email = (c.PrimaryEmailAddr?.Address || '').toLowerCase();
      if (clientEmail && email && clientEmail.toLowerCase() === email) return true;
      if (fullName.length >= 3 && dn.includes(fullName)) return true;
      if (fullName.length >= 3 && fullName.includes(dn) && dn.length >= 3) return true;
      return false;
    });
    setQbDuplicateMatch(match || null);
  }, [clientFirst, clientLast, clientEmail, qbCustomers]);

  const selectQbCustomer = (cust: any) => {
    const displayName = cust.DisplayName || '';
    const givenName = cust.GivenName || '';
    const familyName = cust.FamilyName || '';

    // Valeurs fournies par QuickBooks. Une chaîne vide = champ NON fourni : dans ce
    // cas on conserve la valeur existante (fusion non destructive) au lieu de
    // l'effacer — c'est ce qui causait la perte des coordonnées du client.
    let qbFirst = '', qbLast = '';
    if (givenName || familyName) { qbFirst = givenName; qbLast = familyName; }
    else { const names = displayName.split(' '); qbFirst = names[0] || ''; qbLast = names.slice(1).join(' ') || ''; }
    const qbEmail = cust.PrimaryEmailAddr?.Address || '';
    const qbPhone = cust.PrimaryPhone?.FreeFormNumber || cust.Mobile?.FreeFormNumber || '';
    const qbCompany = cust.CompanyName || '';
    const qbBill = cust.BillAddr?.Line1 || '';

    // Confirmation si des coordonnées sont déjà saisies : on n'écrase jamais par
    // mégarde le client en cours.
    const hasExisting = !!(clientFirst || clientLast || clientEmail || clientPhone || clientCompany || clientPostalAddress);
    if (hasExisting) {
      const who = displayName || `${qbFirst} ${qbLast}`.trim() || 'ce client';
      const ok = window.confirm(
        `Remplacer les coordonnées actuelles par celles de « ${who} » (QuickBooks) ?\n\n` +
        `Les champs non renseignés dans QuickBooks ne seront PAS effacés.`
      );
      if (!ok) return;
    }

    setSelectedQbCustomer(cust);
    setClientFirst(prev => qbFirst || prev);
    setClientLast(prev => qbLast || prev);
    setClientEmail(prev => qbEmail || prev);
    setClientPhone(prev => qbPhone || prev);
    setClientCompany(prev => qbCompany || prev);
    setClientPostalAddress(prev => qbBill || prev);

    // Adresse principale uniquement si vide (ne jamais écraser l'adresse des travaux).
    if (qbBill && !addressText) setAddressText(qbBill);
    if (qbCompany) setIsCompany(true);
    setShowQbDropdown(false);
    setQbCustomerSearch('');
    setQbDuplicateMatch(null);
  };

  const useExistingQbCustomer = () => {
    if (qbDuplicateMatch) selectQbCustomer(qbDuplicateMatch);
  };

  const filteredQbCustomers = useMemo(() => {
    if (!qbCustomerSearch.trim()) return qbCustomers.slice(0, 20);
    const q = qbCustomerSearch.toLowerCase();
    return qbCustomers.filter((c: any) =>
      (c.DisplayName || '').toLowerCase().includes(q) ||
      (c.CompanyName || '').toLowerCase().includes(q) ||
      (c.PrimaryEmailAddr?.Address || '').toLowerCase().includes(q)
    ).slice(0, 20);
  }, [qbCustomers, qbCustomerSearch]);

  // ── Load saved soumissions ──
  const fetchSavedSoumissions = useCallback(async () => {
    setLoadingList(true);
    try {
      let query = supabase.from('soumissions').select('*').order('created_at', { ascending: false }).limit(500);
      if (showArchived) query = query.eq('status', 'archived');
      else query = query.neq('status', 'archived');
      const { data } = await query;
      if (data) setSavedSoumissions(data as any);
    } finally { setLoadingList(false); }
  }, [showArchived]);

  useEffect(() => {
    if (showLoadPanel) fetchSavedSoumissions();
  }, [showLoadPanel, showArchived, fetchSavedSoumissions]);

  const filteredSoumissions = useMemo(() => {
    if (!loadSearch.trim()) return savedSoumissions;
    const q = loadSearch.toLowerCase();
    return savedSoumissions.filter(s =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      (s.formatted_address || '').toLowerCase().includes(q) ||
      String(s.seq_number).includes(q)
    );
  }, [savedSoumissions, loadSearch]);

  const loadSoumission = useCallback(async (s: SoumissionRow) => {
    // ── Vague A — reset state before fill (corrige AQG-005) ──
    // Sans ça, charger B après A laisse les champs absents de B contenir les
    // valeurs résiduelles de A (annotations, lineOverrides, exclusions cochées,
    // contrat, garantie…). Cette purge est strictement encadrée par le flag :
    // quand FEATURE_AUTOSAVE est OFF, on garde le comportement legacy.
    if (FEATURE_AUTOSAVE) {
      // Champs de données — on NE touche PAS loadedId / URL / saved / autoLoadedRef
      // (ceux-là sont gérés en aval par loadSoumission lui-même).
      setBuildingGeojson(null); setLotGeojson(null); setNoLot(null); setYearBuilt(null); setDwellingCount(null); setFloorCount(null); setMamhDataSource(null); setAutoFilledFields(new Set());
      setSuperficie(null); setPerimetre(null); setLargeur(null); setProfondeur(null);
      setLotDistanceM(null); setLotManual(false);
      setBuildingPhase('idle'); setMapParams({ zoom: 19, centerLat: 0, centerLng: 0 });
      setPolygonAdj({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
      setLotAdj({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
      setAreaSqftOverride(''); setPerimeterFtOverride('');
      // Note : setFaitiereOverride/setAretesOverride/... ne sont PAS appelés ici —
      // ce sont des wrappers qui mutent measureTools, et nous remettons measureTools
      // à DEFAULT_TOOLS plus bas (donc les overrides repartent vides automatiquement).
      setLineOverrides({}); setExtraLines([]); setHiddenLines(new Set());
      setLineQbProducts({}); setLineMeasureMappings({}); setLineMajorations({});
      setLineCategories({}); setLineCostOverrides({}); setLineLaborTypes({});
      setRealCosts({}); setQbPushResult(null);
      setClientCompany(''); setClientPostalAddress(''); setIsCompany(false);
      setClientNeq(''); setUseOwnerAsClient(false);
      setSelectedQbCustomer(null); setQbDuplicateMatch(null);
      setManualMeasureMode(false); setPlanImageDataUrl(null); setSavedPlanUrl(null);
      setPdfFiles([]); setContactPhotoUrl(null); setProjectPhotoUrl(null);
      setStreetViewState(null);
      setSelectedCoverageTypes([]); setSelectedMarque(''); setSelectedGamme('');
      setRoof3dMeasures(null); setRoof3dModel(null);
      setQuoteNotes(''); setPaymentTerms('');
      setQuoteHeaderFields({
        quoteDate: new Date().toISOString().slice(0, 10), validityDays: 16, devisNo: '',
        contractType: 'FORFAITAIRE', projectAddress: '', projectNo: '',
      });
      setContractType('forfaitaire');
      setContractFields({
        clientName: '', clientAddress: '', clientPhone: '', clientEmail: '',
        dossierNo: '', contractDate: new Date().toLocaleDateString('fr-CA'), workAddress: '', devisNo: '',
        startDate: '', durationDays: '',
        prixForfaitaire: '', budgetMateriaux: '', budgetMainOeuvre: '', budgetTotal: '',
        honorairePct: '15', estimationInitiale: '', plafondBudget: '', plafondType: 'sans',
      });
      setContractInlineEdits({ checkboxes: {}, warrantyYearsContract: 5, freeText: {} });
      setBlankContractMode(false);
      setWarrantyYears(5); setWarrantyCompletionDate(''); setWarrantyInvoice('');
      setWarrantyContractAmount(''); setWarrantyIncludeConditions(true);
      setExclusionsList(DEFAULT_EXCLUSIONS); setExclusionsChecked({});
      // Annotations et outils de mesure : remis à l'état d'origine.
      setMapAnnotations([]);
      setMeasureTools(DEFAULT_TOOLS);
      // previewConfirmed : on remet à false (l'utilisateur reconfirmera selon B).
      setPreviewConfirmed({ header: false, notes: false, terms: false, exclusions: false });
    }
    // Fill all fields from the saved soumission
    setAddressText(s.formatted_address || '');
    setLat(s.lat);
    setLng(s.lng);
    setClientFirst(s.first_name || '');
    setClientLast(s.last_name || '');
    setClientEmail(s.email || '');
    setClientPhone(s.phone || '');
    setLoadedId(s.id);
    // Sync ?id=… into URL so a refresh re-opens the same soumission.
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('id') !== s.id) {
        sp.set('id', s.id);
        setSearchParams(sp, { replace: true });
      }
    } catch {}
    setLoadedSeqNumber(s.seq_number || null);
    setOriginalEstimateLow((s as any).low_estimate ?? null);
    setOriginalEstimateHigh(s.high_estimate ?? null);
    setOriginalSubtotal(s.subtotal ?? null);

    // Roof params from coverage_type
    const roofTypeFromCoverage = normalizeRoofTypeFromCoverage(s.coverage_type);
    if (roofTypeFromCoverage) setRoofType(roofTypeFromCoverage);
    const normalizedSlope = normalizeSlopeCategory(s.slope);
    if (normalizedSlope) setSlopeCategory(normalizedSlope);
    if (s.area_sqft) setAreaSqftOverride(String(Math.round(s.area_sqft)));
    if ((s as any).work_type) setWorkType((s as any).work_type);

    // Mesures 3D persistées (Phase 1) — restaurées telles quelles si présentes.
    if (s.dynasty_breakdown?.roof3d_measures) setRoof3dMeasures(s.dynasty_breakdown.roof3d_measures);
    setRoof3dModel(s.dynasty_breakdown?.roof3d_model || null);
    setRoof3dView(s.dynasty_breakdown?.roof3d_view || null);
    setRoof3dGeoRef(s.dynasty_breakdown?.roof3d_georef || null);
    setRoofReportPdfPath(s.dynasty_breakdown?.roof_report_pdf_path || null);
    // Brouillon non-validé du traceur (autosavé côté serveur, hors localStorage).
    setRoof3dTakeoffDraft((s as any).takeoff_draft || null);

    // Champs de classification partagés (tableau de bord / Gantt) — chargés tels quels.
    setRoofCategory((s as any).roof_category || 'residential');
    setBuildingType((s as any).building_type || '');
    setComplexity((s as any).complexity || '');
    setColorName((s as any).color || '');
    setContactPreference((s as any).contact_preference || 'email');

    // Dynasty breakdown overrides
    const db = s.dynasty_breakdown;
    if (db) {
      // Restauration prioritaire des champs UI sauvegardés explicitement
      if (db.ui_roof_type && ['2pans', '4pans', '4pans_plus', 'plat'].includes(db.ui_roof_type)) {
        setRoofType(db.ui_roof_type);
      }
      const uiSlope = normalizeSlopeCategory(db.ui_slope_category || db.slope_category);
      if (uiSlope) setSlopeCategory(uiSlope);
      if (db.ui_work_type) setWorkType(db.ui_work_type);
      if (db.perimeter_ft) setPerimeterFtOverride(String(Math.round(db.perimeter_ft)));
      if (db.confidence) setConfidence(db.confidence);
      if (db.length_faitiere) setFaitiereOverride(String(Math.round(db.length_faitiere)));
      if (db.length_hanches) setAretesOverride(String(Math.round(db.length_hanches)));
      if (db.length_noues) setNouesOverride(String(Math.round(db.length_noues)));

      // Restore manual line overrides. Prefer the faithfully-persisted map
      // (keyed by the ORIGINAL base-quote index, exactly as edited); fall back to
      // the legacy position-based reconstruction only for soumissions saved
      // before line_overrides was persisted. The legacy path re-keyed overrides
      // by display position over the COMPACTED finalQuote.lines, so any hidden
      // base line shifted every key and the entered rates landed on the wrong
      // line (or reverted to the catalog default) on reload.
      if (db.line_overrides && typeof db.line_overrides === 'object' && !Array.isArray(db.line_overrides)) {
        const restored: Record<number, Partial<QuoteLine>> = {};
        Object.entries(db.line_overrides).forEach(([k, v]) => { restored[Number(k)] = v as Partial<QuoteLine>; });
        setLineOverrides(restored);
      } else if (db.lines && Array.isArray(db.lines)) {
        const overrides: Record<number, Partial<QuoteLine>> = {};
        db.lines.forEach((line: any, i: number) => {
          overrides[i] = { description: line.description, quantity: line.quantity, unit: line.unit, rate: line.rate };
        });
        setLineOverrides(overrides);
      }

      const pdfSectionLines = buildLinesFromPdfSections(db);
      if (pdfSectionLines.length) {
        setHiddenLines(new Set(Array.from({ length: 20 }, (_, i) => i)));
        setExtraLines(pdfSectionLines);
      }
    }

    // Restore manual mode + plan image
    if (db?.is_manual_mode) {
      setManualMeasureMode(true);
      if (db.manual_plan_url) setSavedPlanUrl(db.manual_plan_url);
    } else {
      setManualMeasureMode(false);
      setSavedPlanUrl(null);
    }

    // Restore notes & terms
    if (db?.quote_notes) setQuoteNotes(db.quote_notes);
    if (db?.payment_terms) setPaymentTerms(db.payment_terms);

    // ── Restore persisted annotation & tool state ──
    if (db?.measure_tools && Array.isArray(db.measure_tools)) {
      setMeasureTools(db.measure_tools.map((t: any) => ({
        id: t.id || `tool_${Date.now()}_${Math.random()}`,
        name: t.name || 'Outil',
        toolType: t.toolType || 'Ligne',
        rawValue: t.rawValue || '',
        correctedValue: t.correctedValue || '',
        unit: t.unit || 'pi',
        color: t.color || '#9ca3af',
        visible: t.visible !== false,
        linkedTo: t.linkedTo || '',
        markerShape: t.markerShape || 'circle',
        qbProductId: t.qbProductId || undefined,
        slopeType: t.slopeType || undefined,
        slopeFactor: t.slopeFactor ?? undefined,
        majoration: t.majoration ?? undefined,
      } as MeasureTool)));
    }
    if (db?.map_annotations && Array.isArray(db.map_annotations)) {
      setMapAnnotations(db.map_annotations.map((a: any) => ({
        target: a.target, feet: a.feet, visible: a.visible !== false, index: a.index,
        segments: a.segments || [], markerPositions: a.markerPositions || [],
      })));
    }
    if (db?.polygon_adj) {
      setPolygonAdj({
        offsetEastM: db.polygon_adj.offsetEastM || 0,
        offsetNorthM: db.polygon_adj.offsetNorthM || 0,
        rotationDeg: db.polygon_adj.rotationDeg || 0,
        scaleFactor: db.polygon_adj.scaleFactor ?? 1,
      });
    }
    if (db?.lot_adj) {
      setLotAdj({
        offsetEastM: db.lot_adj.offsetEastM || 0,
        offsetNorthM: db.lot_adj.offsetNorthM || 0,
        rotationDeg: db.lot_adj.rotationDeg || 0,
        scaleFactor: db.lot_adj.scaleFactor ?? 1,
      });
    }
    if (db?.map_params) {
      setMapParams({
        zoom: db.map_params.zoom || 19,
        centerLat: db.map_params.centerLat || 0,
        centerLng: db.map_params.centerLng || 0,
      });
    }
    if (db?.street_view_state && typeof db.street_view_state === 'object') {
      setStreetViewState(db.street_view_state as StreetViewState);
    }
    if (db?.extra_lines && Array.isArray(db.extra_lines)) setExtraLines(db.extra_lines.map(ensureUid));
    if (db?.hidden_lines && Array.isArray(db.hidden_lines)) setHiddenLines(new Set(db.hidden_lines));
    if (db?.line_qb_products && typeof db.line_qb_products === 'object') setLineQbProducts(db.line_qb_products);
    if (db?.line_measure_mappings && typeof db.line_measure_mappings === 'object') setLineMeasureMappings(db.line_measure_mappings);
    if (db?.line_majorations && typeof db.line_majorations === 'object') setLineMajorations(db.line_majorations);
    if (db?.line_categories && typeof db.line_categories === 'object') setLineCategories(db.line_categories);
    if (db?.real_costs && typeof db.real_costs === 'object') setRealCosts(db.real_costs);
    if (db?.line_cost_overrides && typeof db.line_cost_overrides === 'object') setLineCostOverrides(db.line_cost_overrides);
    if (db?.line_labor_types && typeof db.line_labor_types === 'object') setLineLaborTypes(db.line_labor_types);
    if (typeof db?.margin_threshold_pct === 'number') setMarginThresholdPct(db.margin_threshold_pct);
    if (db?.crew_size) setCrewSize(db.crew_size);
    if (db?.client_postal_address) setClientPostalAddress(db.client_postal_address);
    if (db?.client_company) setClientCompany(db.client_company);
    if (db?.is_company) setIsCompany(db.is_company);
    if (db?.client_neq) setClientNeq(db.client_neq);
    if (db?.building_geojson) setBuildingGeojson(db.building_geojson);
    if (db?.lot_geojson) setLotGeojson(db.lot_geojson);
    if (db?.no_lot) setNoLot(db.no_lot);
    if (db?.superficie_m2 != null) setSuperficie(db.superficie_m2);
    if (db?.perimetre_m != null) setPerimetre(db.perimetre_m);
    if (db?.largeur_m != null) setLargeur(db.largeur_m);
    if (db?.profondeur_m != null) setProfondeur(db.profondeur_m);
    if (db?.selected_coverage_type) setSelectedCoverageType(db.selected_coverage_type);
    if (db?.selected_marque) setSelectedMarque(db.selected_marque);
    if (db?.selected_gamme) setSelectedGamme(db.selected_gamme);
    if (db?.pdf_files && Array.isArray(db.pdf_files)) {
      // Set immediately for instant UI, then refresh expired signed URLs.
      setPdfFiles(db.pdf_files);
      (async () => {
        const refreshed = await Promise.all(
          db.pdf_files.map(async (f: any) => ({
            ...f,
            url: await refreshSignedUrl(f?.url || '', f?.path),
          })),
        );
        setPdfFiles(refreshed);
      })();
    }
    if (typeof db?.contact_photo_url === 'string') {
      setContactPhotoUrl(db.contact_photo_url);
      refreshSignedUrl(db.contact_photo_url).then(u => setContactPhotoUrl(u));
    }
    if (typeof db?.project_photo_url === 'string') {
      setProjectPhotoUrl(db.project_photo_url);
      refreshSignedUrl(db.project_photo_url).then(u => setProjectPhotoUrl(u));
    }
    if (db?.quote_header_fields && typeof db.quote_header_fields === 'object') {
      const qh = db.quote_header_fields;
      setQuoteHeaderFields(prev => ({
        quoteDate: typeof qh.quoteDate === 'string' ? qh.quoteDate : prev.quoteDate,
        validityDays: Number.isFinite(Number(qh.validityDays)) ? Number(qh.validityDays) : prev.validityDays,
        devisNo: typeof qh.devisNo === 'string' ? qh.devisNo : prev.devisNo,
        contractType: ['FORFAITAIRE', 'BUDGÉTAIRE', 'COST PLUS'].includes(qh.contractType) ? qh.contractType : prev.contractType,
        projectAddress: typeof qh.projectAddress === 'string' ? qh.projectAddress : prev.projectAddress,
        projectNo: typeof qh.projectNo === 'string' ? qh.projectNo : prev.projectNo,
      }));
    }

    // ── Restore contract state ──
    if (db?.contract_type && ['forfaitaire', 'budgetaire', 'cost-plus'].includes(db.contract_type)) {
      setContractType(db.contract_type);
    }
    if (db?.contract_fields && typeof db.contract_fields === 'object') {
      setContractFields(prev => ({ ...prev, ...db.contract_fields }));
      contractFieldsInitRef.current = true;
    }
    if (db?.contract_inline_edits && typeof db.contract_inline_edits === 'object') {
      setContractInlineEdits({
        checkboxes: db.contract_inline_edits.checkboxes || {},
        warrantyYearsContract: db.contract_inline_edits.warrantyYearsContract || 5,
        freeText: db.contract_inline_edits.freeText || {},
      });
    }
    // ── Restore warranty certificate settings ──
    if (db?.warranty_settings && typeof db.warranty_settings === 'object') {
      const w = db.warranty_settings;
      if (typeof w.years === 'number') setWarrantyYears(w.years);
      if (typeof w.completion_date === 'string') setWarrantyCompletionDate(w.completion_date);
      if (typeof w.invoice === 'string') setWarrantyInvoice(w.invoice);
      if (typeof w.contract_amount === 'string') setWarrantyContractAmount(w.contract_amount);
      if (typeof w.include_conditions === 'boolean') setWarrantyIncludeConditions(w.include_conditions);
    }

    // Restore client linkage (QB customer + "use building address" toggle)
    setUseOwnerAsClient(db?.use_owner_as_client === true);
    if (db?.selected_qb_customer_id) {
      setPendingQbCustomerId(db.selected_qb_customer_id);
    } else {
      setSelectedQbCustomer(null);
      setPendingQbCustomerId(null);
    }

    // ── Fallback: hydrate brand/gamme/coverage from the soumission's own
    // columns when no explicit dynasty_breakdown override exists. This makes
    // sure leads converted from the public funnel (where Marie-Ève captured
    // brand/product/coverage) appear pre-filled in « Informations du projet »
    // even before the user opens « Paramètres de toiture ». ──
    if (!db?.selected_marque && (s as any).product_brand) {
      setSelectedMarque(String((s as any).product_brand));
    }
    if (!db?.selected_gamme && (s as any).product_name) {
      setSelectedGamme(String((s as any).product_name));
    }
    if (!db?.selected_coverage_type && s.coverage_type) {
      // Web flow stores codes like 'shingle_4pans', 'shingle_2pans', 'membrane',
      // 'membrane_gravier'. Map them to the human label used in the catalogue.
      const ct = String(s.coverage_type).toLowerCase();
      const label = ct.startsWith('shingle')
        ? "Bardeaux d'asphalte"
        : ct === 'membrane_gravier'
          ? 'Membrane + gravier'
          : ct === 'membrane'
            ? 'Membrane élastomère'
            : '';
      if (label) setSelectedCoverageType(label);
    }

    if (s.lat && s.lng && !db?.is_manual_mode) {
      if (!db?.building_geojson) {
        await lookupBuilding(s.lat, s.lng);
      }
    }

    setShowLoadPanel(false);
  }, []);

  // ── Archive / unarchive a soumission ──
  // TODO(P1-1): "archived" n'existe pas dans PROJECT_STATUSES — décision à prendre
  // (ajout dans la taxonomie OU colonne dédiée `archived_at`). Voir audit P1-1.
  // En attendant on passe par le hook centralisé pour que React Query +
  // Realtime restent cohérents partout.
  const toggleArchiveSoumission = useCallback(async (s: SoumissionRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const isArchived = s.status === 'archived';
    const newStatus = isArchived ? 'new' : 'archived';
    const verb = isArchived ? 'désarchiver' : 'archiver';
    if (!confirm(`Voulez-vous ${verb} la soumission #${s.seq_number} ?`)) return;
    try {
      await updateProjectStatusMut.mutateAsync({ id: s.id, status: newStatus as any });
      setSavedSoumissions(prev => prev.map(x => x.id === s.id ? { ...x, status: newStatus } : x));
    } catch (err: any) {
      alert('Erreur: ' + (err?.message || String(err)));
    }
  }, [updateProjectStatusMut]);

  // ── Auto-load soumission from URL param (?id=...) ──
  useEffect(() => {
    const idParam = searchParams.get('id');
    if (!idParam || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    (async () => {
      const { data } = await supabase.from('soumissions').select('*').eq('id', idParam).single();
      if (data) {
        loadSoumission(data as any);
        // Keep ?id=… in the URL so a refresh re-opens the same soumission.
      }
    })();
  }, [searchParams, loadSoumission, setSearchParams]);

  // ── Brouillon mobile : persiste les champs client/adresse/sélections d'une nouvelle soumission ──
  // Survit au refresh / rotation du téléphone. Effacé après vraie sauvegarde ou "Nouveau".
  // VAGUE A : quand FEATURE_AUTOSAVE est ON, le brouillon v2 (scoped, full state) prend le relais
  // et ces deux effets se court-circuitent — ils restent intacts pour la branche flag-OFF (bit-identique).
  const DRAFT_KEY = 'quote_generator_draft_v1';
  const draftRestoredRef = useRef(false);
  // Vague A : id temporaire (par soumission "neuve") pour scoper la clé localStorage v2.
  const tmpDraftIdRef = useRef<string>('');
  if (!tmpDraftIdRef.current) {
    try {
      tmpDraftIdRef.current = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    } catch {
      tmpDraftIdRef.current = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
  }
  // Restauration à l'ouverture (uniquement sur mobile + nouvelle soumission + pas d'?id=)
  useEffect(() => {
    if (FEATURE_AUTOSAVE) return; // Vague A : laisse le brouillon v2 piloter la restauration
    if (draftRestoredRef.current) return;
    if (!isMobile) { draftRestoredRef.current = true; return; }
    if (loadedId) { draftRestoredRef.current = true; return; }
    if (searchParams.get('id')) { draftRestoredRef.current = true; return; }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) { draftRestoredRef.current = true; return; }
      const d = JSON.parse(raw);
      if (d.addressText) setAddressText(d.addressText);
      if (typeof d.lat === 'number') setLat(d.lat);
      if (typeof d.lng === 'number') setLng(d.lng);
      if (d.clientFirst) setClientFirst(d.clientFirst);
      if (d.clientLast) setClientLast(d.clientLast);
      if (d.clientEmail) setClientEmail(d.clientEmail);
      if (d.clientPhone) setClientPhone(d.clientPhone);
      if (d.clientCompany) setClientCompany(d.clientCompany);
      if (d.clientPostalAddress) setClientPostalAddress(d.clientPostalAddress);
      if (typeof d.isCompany === 'boolean') setIsCompany(d.isCompany);
      if (d.clientNeq) setClientNeq(d.clientNeq);
      if (d.workType) setWorkType(d.workType);
      if (d.roofType) setRoofType(d.roofType);
      if (d.slopeCategory) setSlopeCategory(d.slopeCategory);
      if (d.areaSqftOverride) setAreaSqftOverride(d.areaSqftOverride);
      if (d.perimeterFtOverride) setPerimeterFtOverride(d.perimeterFtOverride);
      if (d.selectedMarque) setSelectedMarque(d.selectedMarque);
      if (d.selectedGamme) setSelectedGamme(d.selectedGamme);
      if (Array.isArray(d.selectedCoverageTypes)) setSelectedCoverageTypes(d.selectedCoverageTypes);
      if (d.quoteNotes) setQuoteNotes(d.quoteNotes);
      if (d.paymentTerms) setPaymentTerms(d.paymentTerms);
      toast.success('Brouillon restauré', { description: 'Vos champs ont été récupérés.' });
    } catch {}
    draftRestoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);
  // Sauvegarde continue du brouillon (debounce léger via timer)
  useEffect(() => {
    if (FEATURE_AUTOSAVE) return; // Vague A : remplacé par le brouillon v2 ci-dessous
    if (!isMobile) return;
    if (!draftRestoredRef.current) return;
    if (loadedId) { try { localStorage.removeItem(DRAFT_KEY); } catch {} return; }
    const t = setTimeout(() => {
      try {
        const draft = {
          addressText, lat, lng,
          clientFirst, clientLast, clientEmail, clientPhone, clientCompany,
          clientPostalAddress, isCompany, clientNeq,
          workType, roofType, slopeCategory,
          areaSqftOverride, perimeterFtOverride,
          selectedMarque, selectedGamme, selectedCoverageTypes,
          quoteNotes, paymentTerms,
          _ts: Date.now(),
        };
        // Ne sauvegarder que si au moins UN champ utile est rempli
        const hasContent = !!(draft.addressText || draft.clientFirst || draft.clientLast || draft.clientEmail || draft.clientPhone);
        if (hasContent) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [
    isMobile, loadedId,
    addressText, lat, lng,
    clientFirst, clientLast, clientEmail, clientPhone, clientCompany,
    clientPostalAddress, isCompany, clientNeq,
    workType, roofType, slopeCategory,
    areaSqftOverride, perimeterFtOverride,
    selectedMarque, selectedGamme, selectedCoverageTypes,
    quoteNotes, paymentTerms,
  ]);

  // ── Resolve pending QB customer link once qbCustomers list is available ──
  useEffect(() => {
    if (!pendingQbCustomerId || qbCustomers.length === 0) return;
    const match = qbCustomers.find(c => c.Id === pendingQbCustomerId);
    if (match) {
      setSelectedQbCustomer(match);
      setPendingQbCustomerId(null);
    }
  }, [pendingQbCustomerId, qbCustomers]);

  // ── Google Maps ──
  useEffect(() => {
    if ((window as any).google?.maps?.places) { setAddressLoaded(true); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => setAddressLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!addressLoaded || autocompleteRef.current) return;
    const timer = setTimeout(() => {
      if (!addressInputRef.current) return;
      const ac = new google.maps.places.Autocomplete(addressInputRef.current, {
        componentRestrictions: { country: 'ca' },
        fields: ['formatted_address', 'place_id', 'geometry'],
      });
      autocompleteRef.current = ac;
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (place.formatted_address && place.geometry?.location) {
          const pLat = place.geometry.location.lat();
          const pLng = place.geometry.location.lng();
          setAddressText(place.formatted_address);
          setLat(pLat);
          setLng(pLng);
          lookupBuilding(pLat, pLng);
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [addressLoaded]);

  // ── Building lookup ──
  // ── Owner lookup ──
  // Vague A2.1 — fast path : check pel_proprietaires locally avant le slow path n8n.
  // pel_proprietaires contient 185 979 rows de proprios déjà ingérés (dont 35 074
  // Granby). Si le lot est dedans, on retourne en <100ms au lieu de 50s (polling
  // n8n). Le n8n reste comme fallback pour les lots absents du cache local.
  const fetchOwner = useCallback(async (lotNum: string) => {
    setOwnerLoading(true);
    setOwnerError(null);
    setOwnerList([]);
    setSelectedOwnerIdxs([0]);
    try {
      const cleanLot = lotNum.replace(/\s+/g, '');
      // ── FAST PATH : pel_proprietaires (instantané) ──
      const { data: localOwners, error: localErr } = await supabase
        .from('pel_proprietaires')
        .select('owner_name, address, city, postal_code, telephone, matricule, lot')
        .or(`lot.eq.${cleanLot},matricule.eq.${cleanLot}`)
        .limit(10);

      if (!localErr && localOwners && localOwners.length > 0) {
        const owners: OwnerEntry[] = localOwners
          .filter((o) => o.owner_name)
          .map((o) => ({
            ownerName: o.owner_name as string,
            address: (o.address as string | null) || '',
            city: (o.city as string | null) || '',
            postalCode: (o.postal_code as string | null) || '',
          }));
        if (owners.length > 0) {
          setOwnerList(owners);
          setOwnerLoading(false);
          return;
        }
      }
      // ── SLOW PATH : fallback n8n via edge function (jusqu'à 50s) ──
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch(`${FN_BASE}/fetch-owner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ lotNumber: lotNum }),
      });
      const data = await res.json();
      if (res.ok && (data.ownerName || data.proprietaire)) {
        // Build list of owners from proprietaire (array or string) or ownerName
        const owners: OwnerEntry[] = [];
        const rawProprio = data.proprietaire;
        if (Array.isArray(rawProprio) && rawProprio.length > 0) {
          // Each entry could be a string (name) or an object with details
          for (const p of rawProprio) {
            if (typeof p === 'string') {
              owners.push({
                ownerName: p,
                address: data.address || '',
                city: data.city || '',
                postalCode: data.postalCode || '',
                acquisitionDate: data.acquisitionDate,
                price: data.price,
              });
            } else if (typeof p === 'object' && p !== null) {
              owners.push({
                ownerName: p.nom || p.ownerName || p.name || String(p),
                address: p.address || p.adresse || data.address || '',
                city: p.city || p.ville || data.city || '',
                postalCode: p.postalCode || p.codePostal || data.postalCode || '',
                acquisitionDate: p.acquisitionDate || p.dateAcquisition || data.acquisitionDate,
                price: p.price || p.prix || data.price,
              });
            }
          }
        }
        // Fallback: if no array or empty, use ownerName
        if (owners.length === 0 && data.ownerName) {
          owners.push({
            ownerName: data.ownerName,
            address: data.address || '',
            city: data.city || '',
            postalCode: data.postalCode || '',
            acquisitionDate: data.acquisitionDate,
            price: data.price,
          });
        }
        if (owners.length > 0) {
          setOwnerList(owners);
        } else {
          setOwnerError('Propriétaire introuvable');
        }
      } else {
        setOwnerError(data.error || 'Propriétaire introuvable');
      }
    } catch (e) {
      console.error('Owner lookup error:', e);
      setOwnerError('Erreur réseau');
    } finally {
      setOwnerLoading(false);
    }
  }, []);

  const lookupBuilding = useCallback(async (lookupLat: number, lookupLng: number, forceUpdateOverrides = false) => {
    setBuildingPhase('loading');
    setLotDistanceM(null);
    setLotManual(false);
    setPolygonAdj({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
    setLotAdj({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
    setOwnerList([]); setSelectedOwnerIdxs([0]);
    setOwnerError(null);
    setUseOwnerAsClient(false);
    try {
      const { data, error } = await supabase.rpc('find_building_polygon', {
        p_lat: lookupLat, p_lng: lookupLng, p_radius_meters: 100,
      });
      if (error) throw error;
      if (data && data.length > 0) {
        const row = data[0];
        setBuildingGeojson(row.geojson);
        setLotGeojson(row.lot_geojson);
        setNoLot(row.no_lot);
        setLotDistanceM(typeof row.distance_meters === 'number' ? row.distance_meters : null);
        setSuperficie(row.superficie);
        setPerimetre(row.perimetre);
        setLargeur(row.largeur);
        setProfondeur(row.profondeur);
        const target = row.lot_geojson || row.geojson;
        const params = computeZoomForPolygon(target);
        setMapParams(params);
        setBuildingPhase('found');
        // Persiste IMMÉDIATEMENT le bâtiment/lot/carte en DB (fusion non
        // destructive dans dynasty_breakdown) pour ne PAS re-chercher le
        // polygone à la réouverture, même sans sauvegarde explicite.
        {
          const lid = loadedIdRef.current;
          if (lid) {
            (async () => {
              try {
                const { data: cur } = await supabase.from('soumissions').select('dynasty_breakdown').eq('id', lid).single();
                const bd = { ...(((cur as any)?.dynasty_breakdown) || {}), building_geojson: row.geojson, lot_geojson: row.lot_geojson, map_params: params };
                await supabase.from('soumissions').update({ dynasty_breakdown: bd } as any).eq('id', lid);
              } catch { /* non bloquant */ }
            })();
          }
        }
        if (row.superficie && (forceUpdateOverrides || !areaSqftOverride)) setAreaSqftOverride(String(Math.round(row.superficie * 10.7639)));
        if (row.perimetre && (forceUpdateOverrides || !perimeterFtOverride)) setPerimeterFtOverride(String(Math.round(row.perimetre * 3.28084)));
        if (forceUpdateOverrides) {
          setFaitiereOverride('');
          setAretesOverride('');
          setNouesOverride('');
          setLineOverrides({});
          setHiddenLines(new Set());
          setExtraLines([]);
        }
        // Owner lookup is now triggered manually via button (see "Rechercher le propriétaire")
      } else {
        setBuildingPhase('not_found');
      }
    } catch (e) {
      console.error('Building lookup error:', e);
      setBuildingPhase('not_found');
    }
  }, [areaSqftOverride, perimeterFtOverride, fetchOwner]);

  const handleManualSelect = useCallback((clickLat: number, clickLng: number) => {
    setLat(clickLat);
    setLng(clickLng);
    lookupBuilding(clickLat, clickLng, true);
  }, [lookupBuilding]);

  // ── Computed quote ──
  const effectiveAreaSqft = areaSqftOverride ? parseFloat(areaSqftOverride) : (superficie ? superficie * 10.7639 : 0);
  const effectivePerimeterFt = perimeterFtOverride ? parseFloat(perimeterFtOverride) : (perimetre ? perimetre * 3.28084 : Math.sqrt(effectiveAreaSqft) * 4);

  const baseQuote = useMemo<DynastyQuote | null>(() => {
    if (effectiveAreaSqft <= 0 || effectivePerimeterFt <= 0) return null;
    const vision: VisionResult = { slope_category: slopeCategory, roof_type: roofType, confidence, reasoning_short: '' };
    return computeDynastyQuote(effectiveAreaSqft, effectivePerimeterFt, vision);
  }, [effectiveAreaSqft, effectivePerimeterFt, slopeCategory, roofType, confidence]);

  // ── Helper: compute effective qty for a line given take-off + QB product ──
  const computeEffectiveQty = useCallback((
    lineIdx: number,
    baseLine: QuoteLine,
    isExtra: boolean,
    extraIdx: number,
    origBaseIdx: number,
  ): number => {
    // 1) Check manual override first
    if (!isExtra && lineOverrides[origBaseIdx]?.quantity != null) {
      return lineOverrides[origBaseIdx].quantity!;
    }
    if (isExtra && extraLines[extraIdx]?.quantity != null) {
      return extraLines[extraIdx].quantity;
    }

    // 2) Take-off mapped quantity
    const toolId = lineMeasureMappings[lineIdx];
    if (!toolId) return baseLine.quantity;
    const tool = measureTools.find(t => t.id === toolId);
    if (!tool) return baseLine.quantity;

    const rawBase = Number(tool.correctedValue) || 0;
    if (rawBase === 0) return baseLine.quantity;

    // Apply slope factor + tool majoration → "Qté mesurée"
    const sf = tool.slopeFactor ?? SLOPE_FACTOR_MAP[tool.slopeType || slopeCategory];
    const toolMaj = tool.majoration ?? 0;
    let qty = rawBase * sf * (1 + toolMaj / 100);

    // Coverage conversion: divide by coverage_value if QB product has it
    const qbProdId = lineQbProducts[lineIdx];
    const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
    const covValue = qbProd?.coverage_value ? Number(qbProd.coverage_value) : 0;
    const covUnit = qbProd?.coverage_unit || '';

    if (covValue > 0 && covUnit) {
      const normCovUnit = covUnit.replace(/\s*lin\.?/, '').trim();
      const toolUnit = tool.unit;
      let measureInCovUnit = qty;
      if (toolUnit === 'pi²' && (normCovUnit === 'm²' || normCovUnit === 'm2')) measureInCovUnit = qty / 10.7639;
      else if (toolUnit === 'm²' && (normCovUnit === 'pi²' || normCovUnit === 'pi2')) measureInCovUnit = qty * 10.7639;
      else if (toolUnit === 'pi' && normCovUnit === 'm') measureInCovUnit = qty / 3.28084;
      else if (toolUnit === 'm' && normCovUnit === 'pi') measureInCovUnit = qty * 3.28084;
      qty = Math.ceil(measureInCovUnit / covValue);
    } else {
      // Fallback: direct unit conversion to line unit
      const targetUnit = (!isExtra && lineOverrides[origBaseIdx]?.unit) ? lineOverrides[origBaseIdx].unit! : baseLine.unit;
      const toolUnit = tool.unit;
      if ((toolUnit === 'pi' || toolUnit === 'pi²') && (targetUnit === 'm' || targetUnit === 'm²')) {
        qty = toolUnit === 'pi²' ? qty / 10.7639 : qty / 3.28084;
      } else if ((toolUnit === 'm' || toolUnit === 'm²') && (targetUnit === 'pi' || targetUnit === 'pi²')) {
        qty = toolUnit === 'm²' ? qty * 10.7639 : qty * 3.28084;
      }
    }

    // Apply per-line majoration
    const lineMaj = lineMajorations[lineIdx] ?? defaultMajoration;
    qty = qty * (1 + lineMaj / 100);
    return Math.round(qty * 100) / 100;
  }, [lineMeasureMappings, measureTools, lineQbProducts, qbProducts, slopeCategory, lineMajorations, lineOverrides, extraLines]);

  // ── Helper: compute effective rate for a line ──
  const computeEffectiveRate = useCallback((
    lineIdx: number,
    baseLine: QuoteLine,
    isExtra: boolean,
    origBaseIdx: number,
  ): number => {
    if (isExtra) return baseLine.rate;
    // Manual override > QB product unit_price > base rate
    if (lineOverrides[origBaseIdx]?.rate != null) return lineOverrides[origBaseIdx].rate!;
    const qbProdId = lineQbProducts[lineIdx];
    const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
    if (qbProd?.unit_price != null) return Number(qbProd.unit_price);
    return baseLine.rate;
  }, [lineOverrides, lineQbProducts, qbProducts]);

  // Apply overrides to line items — SINGLE SOURCE OF TRUTH
  const finalQuote = useMemo<DynastyQuote | null>(() => {
    if (!baseQuote) return null;
    const q = { ...baseQuote };

    // Apply roof measurement overrides
    if (faitiereOverride) q.length_faitiere = parseFloat(faitiereOverride) || 0;
    if (aretesOverride) q.length_hanches = parseFloat(aretesOverride) || 0;
    if (nouesOverride) q.length_noues = parseFloat(nouesOverride) || 0;

    // Build visible base line indices
    const baseLineCount = q.lines.length;
    const visibleBaseIndices: number[] = [];
    for (let j = 0; j < baseLineCount; j++) {
      if (!hiddenLines.has(j)) visibleBaseIndices.push(j);
    }

    // Process base lines
    let lines: QuoteLine[] = visibleBaseIndices.map((origIdx, displayIdx) => {
      const line = { ...q.lines[origIdx] };
      // Apply description/unit overrides
      const over = lineOverrides[origIdx];
      // Use `!== undefined` so an explicit empty string ("") still overrides
      // the original description (otherwise deleting it would silently revert).
      if (over?.description !== undefined) line.description = over.description;
      if (over?.unit) line.unit = over.unit;

      // Compute effective quantity and rate
      const effQty = computeEffectiveQty(displayIdx, line, false, -1, origIdx);
      const effRate = computeEffectiveRate(displayIdx, line, false, origIdx);

      line.quantity = effQty;
      line.rate = effRate;
      line.total_base = effQty * effRate;
      line.total_displayed = effQty * effRate; // No hidden contingency — what you see is what you get
      line.ratio = 0;
      // Fallback: if description is empty, use the linked QB product name
      if (!line.description || !line.description.trim()) {
        const qbProdId = lineQbProducts[displayIdx];
        const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
        if (qbProd?.name) line.description = String(qbProd.name);
      }
      return line;
    });

    // Process extra lines
    const extraProcessed: QuoteLine[] = extraLines.map((eLine, extraIdx) => {
      const displayIdx = visibleBaseIndices.length + extraIdx;
      const effQty = computeEffectiveQty(displayIdx, eLine, true, extraIdx, -1);
      const effRate = eLine.rate;
      const processed: QuoteLine = {
        ...eLine,
        quantity: effQty,
        rate: effRate,
        total_base: effQty * effRate,
        total_displayed: effQty * effRate,
        ratio: 0,
      };
      if (!processed.description || !processed.description.trim()) {
        const qbProdId = lineQbProducts[displayIdx];
        const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
        if (qbProd?.name) processed.description = String(qbProd.name);
        else processed.description = 'Poste sans description';
      }
      return processed;
    });

    lines = [...lines, ...extraProcessed];

    const subtotalBase = lines.reduce((s, l) => s + l.total_base, 0);
    const subtotalDisplayed = subtotalBase; // Same — no hidden contingency
    const contingency = 0; // Removed hidden contingency
    const tps = 0.05 * subtotalDisplayed;
    const tvq = 0.09975 * subtotalDisplayed;

    return {
      ...q,
      lines,
      subtotal_base: subtotalBase,
      contingency,
      subtotal_displayed: subtotalDisplayed,
      tps,
      tvq,
      total_final: subtotalDisplayed + tps + tvq,
    };
  }, [baseQuote, lineOverrides, extraLines, hiddenLines, faitiereOverride, aretesOverride, nouesOverride,
      computeEffectiveQty, computeEffectiveRate, lineQbProducts, qbProducts]);

  // ── Derived metrics — reads directly from finalQuote (single source of truth) ──
  const metrics = useMemo(() => {
    if (!finalQuote) return null;
    const bardLine = finalQuote.lines.find(l => l.description.includes('Bardeaux Dynasty'));

    // Helper: a line is tagged labor of given type if either:
    //   (a) checkbox in lineLaborTypes[i] includes the type, OR
    //   (b) untagged + description matches the auto-generated Dynasty line
    const isLaborOf = (line: any, i: number, type: LaborType) => {
      const tags = lineLaborTypes[i];
      if (tags && tags.length) return tags.includes(type);
      const cat = lineCategories[i];
      if (cat) return false; // explicit non-labor category
      if (type === 'arrachage' && line.description === 'Arrachage') return true;
      if (type === 'pose' && line.description === 'Pose') return true;
      return false;
    };

    let tearoffHours = 0;
    let installHours = 0;
    let materialCost = 0;
    let laborCost = 0;
    finalQuote.lines.forEach((line, i) => {
      const cat = lineCategories[i];
      const tags = lineLaborTypes[i] || [];
      const isTear = isLaborOf(line, i, 'arrachage');
      const isPose = isLaborOf(line, i, 'pose');
      const isLabor = cat === 'main_oeuvre' || isTear || isPose;

      if (isTear) tearoffHours += line.total_base / HOURLY_RATE;
      if (isPose) installHours += line.total_base / HOURLY_RATE;

      if (isLabor) laborCost += line.total_displayed;
      else materialCost += line.total_displayed;
    });
    const tearoffDays = crewSize > 0 ? tearoffHours / crewSize / 8 : 0;
    const installDays = crewSize > 0 ? installHours / crewSize / 8 : 0;
    const tearoffLine = finalQuote.lines.find(l => l.description === 'Arrachage');
    const installLine = finalQuote.lines.find(l => l.description === 'Pose');

    const pricePerPkg = bardLine ? bardLine.rate : 0;
    // Total packages: use bardeau line quantity when available,
    // otherwise fall back to surface / coverage-per-package so cadence works
    // for non-shingle roofs and for custom shingle line labels.
    let totalPkgs = bardLine ? bardLine.quantity : 0;

    // Compute total cost from QB purchase_cost × quantity per line
    let totalRealCost = 0;
    finalQuote.lines.forEach((line, i) => {
      // 1) Manual cost override wins
      // 2) Else fallback to QBO purchase_cost × quantity
      const override = lineCostOverrides[i];
      if (typeof override === 'number' && override > 0) {
        totalRealCost += override * line.quantity;
      } else {
        const qbProdId = lineQbProducts[i];
        const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
        const purchaseCost = qbProd?.purchase_cost != null ? Number(qbProd.purchase_cost) : 0;
        if (purchaseCost > 0) {
          totalRealCost += purchaseCost * line.quantity;
        }
      }
    });
    const margin = finalQuote.subtotal_displayed - totalRealCost;
    const marginPct = finalQuote.subtotal_displayed > 0 ? (margin / finalQuote.subtotal_displayed) * 100 : 0;

    // ── Extended production metrics ──
    const slopeFactor = SLOPE_FACTOR_MAP[slopeCategory] ?? 1;
    const surfaceCorrigee = effectiveAreaSqft * slopeFactor;
    // Fallback for totalPkgs when no Bardeaux line is detected (custom labels, SBS/membrane, etc.)
    if (totalPkgs <= 0 && surfaceCorrigee > 0 && coveragePerPkg > 0) {
      totalPkgs = surfaceCorrigee / coveragePerPkg;
    }
    const totalDays = tearoffDays + installDays;
    const pricePerSqft = surfaceCorrigee > 0 ? finalQuote.subtotal_displayed / surfaceCorrigee : 0;
    const pricePerPkgComputed = (surfaceCorrigee > 0 && coveragePerPkg > 0)
      ? finalQuote.subtotal_displayed / (surfaceCorrigee / coveragePerPkg)
      : 0;
    const profit = margin;
    const profitPerDay = totalDays > 0 ? profit / totalDays : 0;
    const profitPerManDay = (totalDays > 0 && crewSize > 0) ? profit / (totalDays * crewSize) : 0;
    const installPricePerH = installHours > 0 ? (installLine?.total_displayed ?? 0) / installHours : 0;
    const tearoffPricePerH = tearoffHours > 0 ? (tearoffLine?.total_displayed ?? 0) / tearoffHours : 0;
    const cadencePkgH = installHours > 0 ? totalPkgs / installHours : 0;
    const cadenceSqftH = installHours > 0 ? surfaceCorrigee / installHours : 0;

    return {
      tearoffHours, installHours, tearoffDays, installDays,
      materialCost, laborCost, pricePerPkg, totalPkgs, totalRealCost, margin, marginPct,
      // extended
      slopeFactor, surfaceCorrigee, totalDays, pricePerSqft, pricePerPkgComputed,
      profit, profitPerDay, profitPerManDay,
      installPricePerH, tearoffPricePerH, cadencePkgH, cadenceSqftH,
    };
  }, [finalQuote, crewSize, lineCategories, lineLaborTypes, lineQbProducts, qbProducts, lineCostOverrides, slopeCategory, effectiveAreaSqft, coveragePerPkg]);

  // ── Material list (Home Depot-ready) PDF generator ──
  const buildMaterialListHtml = useCallback((): string => {
    const today = new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const refNo = loadedSeqNumber ? `VB-${loadedSeqNumber}` : 'VB-—';
    const projectAddr = (addressText || 'Adresse non spécifiée').replace(/</g, '&lt;');
    const clientName = `${(clientFirst || '').trim()} ${(clientLast || '').trim()}`.trim() || '—';
    type Item = { sku: string; description: string; brand: string; quantity: number; unit: string; supplier: string };
    const items: Item[] = [];
    const seen: Record<string, number> = {};
    (finalQuote?.lines || []).forEach((line, i) => {
      const cat = lineCategories[i];
      if (cat === 'main_oeuvre' || cat === 'sous_traitance' || cat === 'equipement' || cat === 'transport') return;
      const qbProdId = lineQbProducts[i];
      const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
      // Heuristic skip: lines that look like labor even when uncategorized
      const desc0 = (line.description || '').toLowerCase();
      if (!qbProd && (/main.?d.?oeuvre|arrachage|pose|installation|labor|d[ée]molition/.test(desc0))) return;
      const sku = (qbProd?.sku || qbProd?.qb_id || '—').toString();
      const description = (qbProd?.name || line.description || 'Article').toString();
      const brand = (qbProd?.brand || '').toString();
      const supplier = (qbProd?.supplier || '').toString();
      const unit = line.unit || qbProd?.coverage_unit || 'unité';
      const qty = Math.max(0, Math.ceil(line.quantity || 0));
      if (qty <= 0) return;
      const key = `${sku}|${unit}`;
      if (seen[key] != null) items[seen[key]].quantity += qty;
      else { seen[key] = items.length; items.push({ sku, description, brand, quantity: qty, unit, supplier }); }
    });
    const rows = items.length
      ? items.map((it, idx) => `<tr><td class="c">${idx + 1}</td><td><strong>${it.sku}</strong></td><td>${it.description}${it.brand ? ` <span style="color:#888">— ${it.brand}</span>` : ''}</td><td class="c">${it.supplier || '—'}</td><td class="r"><strong>${it.quantity.toLocaleString('fr-CA')}</strong></td><td class="c">${it.unit}</td></tr>`).join('')
      : `<tr><td colspan="6" style="text-align:center;color:#888;padding:20px">Aucun produit lié — assignez des produits QuickBooks aux postes du devis pour générer la liste.</td></tr>`;
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Liste de matériaux ${refNo}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:9pt;color:#111;background:#fff}
.page{width:210mm;min-height:297mm;background:#fff;margin:0 auto;padding-bottom:20px}
.hdr{background:#1a1a1a;height:36mm;padding:0 20px;display:flex;justify-content:space-between;align-items:center}
.hdr-right{text-align:right}
.hdr-label{color:#c9a84c;font-size:6pt;font-weight:700;letter-spacing:.22em;text-transform:uppercase;margin-bottom:3px}
.hdr-title{color:#fff;font-size:20pt;font-weight:900;text-transform:uppercase;letter-spacing:.04em;line-height:1}
.hdr-ref{color:#999;font-size:6.5pt;margin-top:4px}
.gold-bar{height:3px;background:#c9a84c}
.body{padding:14px 20px}
.meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #ccc;margin-bottom:14px}
.mc{padding:6px 11px;background:#f5f5f5}
.mc+.mc{border-left:1px solid #ccc}
.mc-lbl{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-bottom:3px}
.mc-val{font-size:8.5pt;font-weight:600;color:#111}
h2.section{font-size:9.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #111;padding-bottom:4px;margin:14px 0 8px}
table.tbl{width:100%;border-collapse:collapse;font-size:8pt;margin:6px 0 12px}
table.tbl thead tr{background:#1a1a1a}
table.tbl thead th{color:#fff;padding:6px 9px;font-weight:700;font-size:7.5pt;text-align:left;text-transform:uppercase}
table.tbl thead th.r{text-align:right}.table.tbl thead th.c{text-align:center}
table.tbl tbody tr{border-bottom:1px solid #e8e8e8}
table.tbl tbody tr:nth-child(even){background:#f7f7f7}
table.tbl tbody td{padding:6px 9px;vertical-align:top}
table.tbl tbody td.r{text-align:right;font-weight:600}
table.tbl tbody td.c{text-align:center}
.note{font-size:7.5pt;color:#555;background:#f9f9f9;border:1px solid #ddd;padding:8px 11px;margin-top:8px;line-height:1.6}
.ftr{background:#1a1a1a;padding:6px 20px;display:flex;justify-content:space-between;margin-top:18px}
.ftr span{color:#888;font-size:6.5pt}
.summary{display:flex;justify-content:space-between;align-items:center;border:1.5px solid #111;padding:8px 14px;margin:9px 0;background:#fafafa}
.sm-lbl{font-size:7.5pt;font-weight:700;text-transform:uppercase;color:#444}
.sm-val{font-size:13pt;font-weight:900;color:#111}
</style></head><body><div class="page">
<div class="hdr"><div style="color:#fff;font-size:18pt;font-weight:900;letter-spacing:.04em">TOITURES VB</div>
<div class="hdr-right"><div class="hdr-label">Bon de commande matériaux</div><div class="hdr-title">LISTE DE MATÉRIAUX</div><div class="hdr-ref">N° ${refNo} | ${today}</div></div></div>
<div class="gold-bar"></div>
<div class="body">
<div class="meta">
<div class="mc"><div class="mc-lbl">Référence</div><div class="mc-val">${refNo}</div></div>
<div class="mc"><div class="mc-lbl">Client / Projet</div><div class="mc-val">${clientName}</div></div>
<div class="mc"><div class="mc-lbl">Adresse du chantier</div><div class="mc-val">${projectAddr}</div></div>
<div class="mc"><div class="mc-lbl">Date d'émission</div><div class="mc-val">${today}</div></div>
</div>
<h2 class="section">Articles à commander</h2>
<table class="tbl"><thead><tr><th class="c" style="width:6%">#</th><th style="width:18%">SKU</th><th>Description</th><th class="c" style="width:14%">Fournisseur</th><th class="r" style="width:10%">Qté</th><th class="c" style="width:10%">Unité</th></tr></thead><tbody>${rows}</tbody></table>
<div class="summary"><div><div class="sm-lbl">Total d'articles distincts</div><div style="font-size:6.5pt;color:#999;margin-top:1px">Quantités arrondies à l'unité supérieure</div></div><div class="sm-val">${items.length}</div></div>
<div class="note"><strong>Notes pour le fournisseur :</strong> Veuillez confirmer la disponibilité de chaque article et tout délai de livraison applicable. Les SKU correspondent aux références internes Toitures VB / QuickBooks. Pour toute question, contactez le bureau au 450-521-3227.</div>
</div>
<div class="ftr"><span>TOITURES VB INC. — RBQ 5854-9353-01</span><span>Liste de matériaux ${refNo}</span></div>
</div></body></html>`;
  }, [finalQuote, lineCategories, lineQbProducts, qbProducts, addressText, clientFirst, clientLast, loadedSeqNumber]);

  const handleGenerateMaterialList = useCallback(async () => {
    if (!finalQuote || generatingMaterialList) return;
    setGeneratingMaterialList(true);
    let iframe: HTMLIFrameElement | null = null;
    try {
      const html = buildMaterialListHtml();
      iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:920px;height:1400px;border:0;opacity:0;pointer-events:none;z-index:-1';
      document.body.appendChild(iframe);
      await new Promise<void>((resolve) => {
        const fb = window.setTimeout(resolve, 600);
        iframe!.onload = () => { window.clearTimeout(fb); resolve(); };
        iframe!.srcdoc = html;
      });
      const frameDoc = iframe.contentDocument;
      if (!frameDoc?.body) throw new Error('Contenu introuvable');
      frameDoc.body.style.background = '#fff';
      await new Promise(r => setTimeout(r, 150));
      const w = Math.max(frameDoc.documentElement.scrollWidth, frameDoc.body.scrollWidth, 920);
      const h = Math.max(frameDoc.documentElement.scrollHeight, frameDoc.body.scrollHeight, 1200);
      const canvas = await html2canvas(frameDoc.body, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff', width: w, height: h, windowWidth: w, windowHeight: h });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const imgData = canvas.toDataURL('image/png');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfPageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pdfW) / canvas.width;
      let remain = imgH; let pos = 0;
      pdf.addImage(imgData, 'PNG', 0, pos, pdfW, imgH);
      remain -= pdfPageH;
      while (remain > 0) { pos = remain - imgH; pdf.addPage(); pdf.addImage(imgData, 'PNG', 0, pos, pdfW, imgH); remain -= pdfPageH; }
      const refNo = loadedSeqNumber ? `VB-${loadedSeqNumber}` : `VB-${Date.now()}`;
      const fileName = `Liste_Materiaux_${refNo}.pdf`;
      pdf.save(fileName);
      try {
        const blob = pdf.output('blob');
        const safeName = `materials/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: upErr } = await supabase.storage.from('quote-pdfs').upload(safeName, blob, { contentType: 'application/pdf', upsert: true });
        if (!upErr) {
          const __signed = await getSignedQuotePdfUrl(safeName, QUOTE_PDF_LONG_TTL);
          if (__signed) setPdfFiles(prev => [...prev, { name: fileName, url: __signed, size: blob.size, path: safeName }]);
        }
      } catch (e) { console.warn('Material list upload error:', e); }
    } catch (e) {
      console.error('Material list generation error:', e);
      alert('Erreur lors de la génération de la liste de matériaux');
    } finally {
      iframe?.remove();
      setGeneratingMaterialList(false);
    }
  }, [finalQuote, generatingMaterialList, buildMaterialListHtml, loadedSeqNumber]);

  // ── Sync contract fields when quote data changes ──
  useEffect(() => {
    if (!contractFieldsInitRef.current) { contractFieldsInitRef.current = true; }
    setContractFields(prev => ({
      ...prev,
      clientName: `${clientFirst} ${clientLast}`.trim() || prev.clientName,
      clientAddress: (clientPostalAddress || addressText || '') || prev.clientAddress,
      clientPhone: clientPhone || prev.clientPhone,
      clientEmail: clientEmail || prev.clientEmail,
      dossierNo: loadedSeqNumber ? `VB-${loadedSeqNumber}` : prev.dossierNo,
      workAddress: addressText || prev.workAddress,
      devisNo: loadedSeqNumber ? `VB-${loadedSeqNumber}` : prev.devisNo,
      prixForfaitaire: finalQuote ? finalQuote.total_final.toFixed(2) : prev.prixForfaitaire,
      budgetTotal: finalQuote ? finalQuote.subtotal_displayed.toFixed(2) : prev.budgetTotal,
      estimationInitiale: finalQuote ? finalQuote.subtotal_displayed.toFixed(2) : prev.estimationInitiale,
      durationDays: (metrics && metrics.totalDays > 0)
        ? String(Math.max(1, Math.ceil(metrics.totalDays)))
        : prev.durationDays,
    }));
  }, [clientFirst, clientLast, clientPostalAddress, addressText, clientPhone, clientEmail, loadedSeqNumber, finalQuote?.total_final, metrics?.totalDays]);

  // Publie le total du devis courant vers la calculatrice de financement de la
  // sidebar (pré-remplissage du champ Montant). Re-publié à chaque variation.
  useEffect(() => {
    useQuoteAmountStore.getState().setQuoteAmount(finalQuote?.total_final ?? null);
  }, [finalQuote?.total_final]);

  // ── Contract pre-fill logic (uses contractFields) ──
  const getContractTemplateFileName = useCallback((type: 'forfaitaire' | 'budgetaire' | 'cost-plus') => {
    return `CONTRAT_${type === 'cost-plus' ? 'COST_PLUS' : type.toUpperCase()}_TOITURES_VB.html`;
  }, []);

  const getContractExportFilename = useCallback((extension: 'html' | 'pdf') => {
    const typeName = contractType === 'cost-plus' ? 'COST_PLUS' : contractType.toUpperCase();
    const descriptor = contractFields.devisNo || contractFields.dossierNo || (loadedSeqNumber ? `VB-${loadedSeqNumber}` : contractFields.clientName);
    return `CONTRAT_${typeName}_${sanitizeFilenamePart(descriptor)}.${extension}`;
  }, [contractFields.clientName, contractFields.devisNo, contractFields.dossierNo, contractType, loadedSeqNumber]);

  const buildContractHtml = useCallback(async (
    type: 'forfaitaire' | 'budgetaire' | 'cost-plus',
    fields: typeof contractFields,
    inlineEdits: ContractInlineEdits,
    editableText: boolean = true,
  ) => {
    const fileName = getContractTemplateFileName(type);
    const resp = await fetch(`/contracts/${fileName}`, { cache: 'no-store' });

    if (!resp.ok) {
      throw new Error(`Le modèle ${fileName} est introuvable.`);
    }

    let html = await resp.text();
    const fn = fields.clientName;

    // Mobile : ajuste le contrat à la largeur de l'écran et autorise le pincer-zoom
    // dans l'iframe (sinon le document A4 déborde et iOS bloque le zoom).
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
      html = html.replace(/<head>/i, '<head>\n<meta name="viewport" content="width=820, initial-scale=1, maximum-scale=5, user-scalable=yes">');
    }

    // Échappe le texte injecté ; en édition inline on produit un <span contenteditable>
    // tagué data-field qui renvoie ses changements au parent (postMessage).
    const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fld = (field: string, value: string) =>
      editableText
        ? `<span class="ce-fld" data-field="${field}"${value ? '' : ' data-empty="1"'} contenteditable="true">${esc(value)}</span>`
        : esc(value);

    html = html.replace(/<div class="p-name"><span class="fill">&nbsp;<\/span><\/div>/, `<div class="p-name">${fld('clientName', fn)}</div>`);

    const reps: [RegExp, string][] = [
      [/Adresse\s*:\s*<span class="fill">&nbsp;<\/span>/, `Adresse : ${fld('clientAddress', fields.clientAddress)}`],
      [/Téléphone\s*:\s*<span class="fill">&nbsp;<\/span>/, `Téléphone : ${fld('clientPhone', fields.clientPhone)}`],
      [/Courriel\s*:\s*<span class="fill">&nbsp;<\/span>/, `Courriel : ${fld('clientEmail', fields.clientEmail)}`],
    ];

    for (const [rx, val] of reps) html = html.replace(rx, val);

    const metaMap: [string, string, string][] = [
      ['No. de dossier', fields.dossierNo, 'dossierNo'],
      ['Date du contrat', fields.contractDate, 'contractDate'],
      ['Adresse des travaux', fields.workAddress, 'workAddress'],
      ['No. de devis', fields.devisNo, 'devisNo'],
    ];

    for (const [label, val, key] of metaMap) {
      const rx = new RegExp(`(<div class="mc-lbl">${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/div>)<span class="mc-val">&nbsp;<\\/span>`);
      html = html.replace(rx, `$1<span class="mc-val">${fld(key, val)}</span>`);
    }

    html = html.replace(/Date de début prévue\s*:\s*<span class="fill"[^>]*>&nbsp;<\/span>/, `Date de début prévue : ${fld('startDate', fields.startDate)}`);
    html = html.replace(/<span class="fill" style="min-width:50px">&nbsp;<\/span>\s*jours ouvrables/, `${fld('durationDays', fields.durationDays)} jours ouvrables`);

    if (type === 'forfaitaire' && fields.prixForfaitaire) {
      const v = parseFloat(fields.prixForfaitaire);
      if (!isNaN(v)) html = html.replace(/\$&nbsp;<span style="border-bottom:1\.5px solid #111;display:inline-block;min-width:130px">&nbsp;<\/span>/, `$ ${v.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }

    if (type === 'budgetaire') {
      if (fields.budgetMateriaux) {
        const v = parseFloat(fields.budgetMateriaux);
        if (!isNaN(v)) html = html.replace(/(<div class="bc-lbl">Budget — Matériaux<\/div><div class="bc-val">\$&nbsp;)<span class="fill"[^>]*>&nbsp;<\/span>/, `$1${v.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}`);
      }
      if (fields.budgetMainOeuvre) {
        const v = parseFloat(fields.budgetMainOeuvre);
        if (!isNaN(v)) html = html.replace(/(<div class="bc-lbl">Budget — Main-d'œuvre<\/div><div class="bc-val">\$&nbsp;)<span class="fill"[^>]*>&nbsp;<\/span>/, `$1${v.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}`);
      }
      if (fields.budgetTotal) {
        const v = parseFloat(fields.budgetTotal);
        if (!isNaN(v)) html = html.replace(/(<div class="bc-lbl">Budget total autorisé<\/div><div class="bc-val">\$&nbsp;)<span class="fill"[^>]*>&nbsp;<\/span>/, `$1${v.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}`);
      }
    }

    if (type === 'cost-plus') {
      if (fields.honorairePct) html = html.replace(/<span class="fill" style="min-width:40px">&nbsp;<\/span>&nbsp;%/, `${fields.honorairePct} %`);
      if (fields.estimationInitiale) {
        const v = parseFloat(fields.estimationInitiale);
        if (!isNaN(v)) html = html.replace(/\$&nbsp;<span class="fill" style="min-width:80px">&nbsp;<\/span><\/strong>/, `$ ${v.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}</strong>`);
      }
      if (fields.plafondType === 'avec' && fields.plafondBudget) {
        const v = parseFloat(fields.plafondBudget);
        if (!isNaN(v)) html = html.replace(/\$&nbsp;<span class="fill" style="min-width:100px">&nbsp;<\/span>/, `$ ${v.toLocaleString('fr-CA', { minimumFractionDigits: 2 })}`);
      }
    }

    if (fn) {
      html = html.replace(/(<div class="sig-lbl">Propriétaire<\/div>\s*<div class="sig-line"><\/div>\s*<div class="sig-name">)&nbsp;(<\/div>)/, `$1${fn}$2`);
      html = html.replace(/Nom imprimé : ___________________________/, `Nom imprimé : ${fn}`);
    }

    // ── Make the warranty duration editable ("5 ans" → editable span) ──
    const wy = Math.max(1, Math.min(99, Number(inlineEdits.warrantyYearsContract) || 5));
    html = html.replace(
      /Certificat de Garantie de main-d'œuvre \(\s*\d+\s*ans?\s*\)/g,
      `Certificat de Garantie de main-d'œuvre (<span class="ce-wy" data-wy contenteditable="true">${wy}</span>&nbsp;ans)`
    );

    // ── Make every ☐/☒ pair clickable. We assign each occurrence a stable id
    //     based on its index so the state survives re-renders. ──
    let cbIdx = 0;
    html = html.replace(/☐|☒/g, (match) => {
      const id = `cb-${cbIdx++}`;
      const stored = inlineEdits.checkboxes[id];
      const checked = stored ?? (match === '☒');
      return `<span class="ce-cb" data-cb-id="${id}" data-checked="${checked ? '1' : '0'}" role="checkbox" aria-checked="${checked}">${checked ? '☒' : '☐'}</span>`;
    });

    // ── Inject styles + interactive script. Communicates with parent via postMessage. ──
    const interactiveAssets = `
<style>
  .ce-cb { cursor: pointer; user-select: none; padding: 0 1px; border-radius: 2px; transition: background 0.15s; font-size: 1.05em; }
  .ce-cb:hover { background: #fef3c7; }
  .ce-cb[data-checked="1"] { color: #059669; font-weight: 700; }
  .ce-wy { display: inline-block; min-width: 1.2em; padding: 0 4px; border-bottom: 2px dashed #2563eb; color: #2563eb; font-weight: 700; outline: none; cursor: text; }
  .ce-wy:focus { background: #dbeafe; border-bottom-style: solid; }
  .ce-fld { display: inline-block; min-width: 60px; padding: 0 3px; background: #fde047; border-bottom: 1.5px solid #ca8a04; border-radius: 2px; color: #111; outline: none; cursor: text; transition: background 0.15s; }
  .ce-fld:hover { background: #facc15; }
  .ce-fld:focus { background: #fef08a; box-shadow: 0 0 0 2px rgba(202,138,4,0.45); }
  .ce-fld[data-empty="1"] { min-width: 90px; background: #fef9c3; }
  @media print {
    .ce-cb:hover { background: transparent; }
    .ce-wy { border-bottom: none; color: inherit; background: transparent; }
    .ce-fld { border-bottom: none; background: transparent !important; box-shadow: none; }
  }
</style>
<script>
(function(){
  function send(payload){ try{ parent.postMessage(Object.assign({__contractEdit:true}, payload), '*'); }catch(e){} }
  document.addEventListener('click', function(ev){
    var t = ev.target;
    if (t && t.classList && t.classList.contains('ce-cb')) {
      var checked = t.getAttribute('data-checked') === '1';
      var next = !checked;
      t.setAttribute('data-checked', next ? '1' : '0');
      t.setAttribute('aria-checked', next ? 'true' : 'false');
      t.textContent = next ? '☒' : '☐';
      send({ kind: 'checkbox', id: t.getAttribute('data-cb-id'), checked: next });
    }
  });
  document.addEventListener('input', function(ev){
    var t = ev.target;
    if (t && t.classList && t.classList.contains('ce-wy')) {
      var n = parseInt((t.textContent||'').replace(/\\D/g,''), 10);
      if (!isNaN(n) && n > 0) send({ kind: 'warrantyYearsContract', value: n });
    }
    if (t && t.classList && t.classList.contains('ce-fld')) {
      if ((t.textContent||'').length) t.removeAttribute('data-empty');
    }
  });
  // Champs texte éditables : on commit la valeur au blur (capture car blur ne bulle pas)
  document.addEventListener('blur', function(ev){
    var t = ev.target;
    if (t && t.classList && t.classList.contains('ce-fld')) {
      var field = t.getAttribute('data-field');
      if (field) send({ kind: 'field', field: field, value: (t.textContent||'').trim() });
    }
  }, true);
  // Block Enter from inserting <br> in single-line editable spans
  document.addEventListener('keydown', function(ev){
    if (ev.target && ev.target.classList && ev.key === 'Enter' &&
        (ev.target.classList.contains('ce-wy') || ev.target.classList.contains('ce-fld'))) {
      ev.preventDefault();
      ev.target.blur();
    }
  });
})();
</script>`;
    html = html.replace(/<\/body>/i, `${interactiveAssets}</body>`);

    return html;
  }, [getContractTemplateFileName]);

  // Debounced rebuild
  const contractRebuildTimer = useRef<ReturnType<typeof setTimeout>>();

  // Quand un champ texte est modifié DANS le contrat (postMessage), on met à jour
  // contractFields sans relancer le rebuild de l'iframe (sinon on volerait le focus).
  const contractFieldFromIframeRef = useRef(false);

  // ── Listen to inline edits coming from the contract iframe ──
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const data: any = ev.data;
      if (!data || data.__contractEdit !== true) return;
      if (data.kind === 'checkbox' && typeof data.id === 'string') {
        setContractInlineEdits(prev => ({
          ...prev,
          checkboxes: { ...prev.checkboxes, [data.id]: !!data.checked },
        }));
      } else if (data.kind === 'warrantyYearsContract' && typeof data.value === 'number') {
        setContractInlineEdits(prev => ({ ...prev, warrantyYearsContract: data.value }));
      } else if (data.kind === 'field' && typeof data.field === 'string' && data.field in contractFields) {
        const key = data.field as keyof ContractFields;
        const value = String(data.value ?? '');
        setContractFields(prev => {
          if (prev[key] === value) return prev;
          contractFieldFromIframeRef.current = true;
          return { ...prev, [key]: value };
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Édition inline venue de l'iframe : la valeur est déjà affichée dans le DOM
    // contenteditable. On ne reconstruit pas l'iframe (cela volerait le focus).
    if (contractFieldFromIframeRef.current) {
      contractFieldFromIframeRef.current = false;
      return;
    }
    let cancelled = false;
    clearTimeout(contractRebuildTimer.current);
    setContractPreviewStatus('loading');
    setContractPreviewError(null);

    contractRebuildTimer.current = setTimeout(async () => {
      try {
        const fieldsForRender: ContractFields = blankContractMode
          ? (Object.fromEntries(
              Object.entries(contractFields).map(([k, v]) => {
                if (k === 'plafondType') return [k, v];
                // Ligne vide stylisée pour signer/remplir à la main
                return [k, '____________________'];
              })
            ) as ContractFields)
          : contractFields;
        const html = await buildContractHtml(contractType, fieldsForRender, contractInlineEdits, !blankContractMode);
        if (cancelled) return;
        setContractHtml(html);
        setContractPreviewStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('Error building contract:', err);
        setContractHtml('');
        setContractPreviewStatus('error');
        setContractPreviewError(err instanceof Error ? err.message : 'Impossible de générer le contrat.');
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(contractRebuildTimer.current);
    };
  // NOTE: contractInlineEdits is intentionally excluded — the iframe maintains
  // its own visual state for clicks/typing; rebuilding here would steal focus.
  // The edits are re-applied on contractType/contractFields change and PDF export.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractType, contractFields, buildContractHtml, blankContractMode]);

  const downloadContractHtml = useCallback(() => {
    if (!contractHtml) return;
    downloadBlob(new Blob([contractHtml], { type: 'text/html;charset=utf-8' }), getContractExportFilename('html'));
  }, [contractHtml, getContractExportFilename]);

  const handleGenerateContractPdf = useCallback(async () => {
    if (!contractHtml || generatingContractPdf) return;

    let iframe: HTMLIFrameElement | null = null;
    setGeneratingContractPdf(true);

    try {
      // Rebuild the HTML so it embeds the latest inline edits (checkboxes / warranty years).
      // editableText=false → champs en texte plein (pas de soulignés pointillés) pour un PDF propre.
      const freshHtml = await buildContractHtml(contractType, contractFields, contractInlineEdits, false);
      iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '920px';
      iframe.style.height = '1400px';
      iframe.style.border = '0';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.style.zIndex = '-1';
      document.body.appendChild(iframe);

      await new Promise<void>((resolve, reject) => {
        const fallback = window.setTimeout(resolve, 600);
        iframe!.onload = () => {
          window.clearTimeout(fallback);
          resolve();
        };
        iframe!.onerror = () => {
          window.clearTimeout(fallback);
          reject(new Error('Chargement du contrat impossible.'));
        };
        iframe!.srcdoc = freshHtml;
      });

      const frameDoc = iframe.contentDocument;
      if (!frameDoc?.body) {
        throw new Error('Contenu du contrat introuvable.');
      }

      frameDoc.documentElement.style.background = '#ffffff';
      frameDoc.body.style.background = '#ffffff';
      frameDoc.body.style.margin = '0';
      frameDoc.querySelectorAll<HTMLElement>('.page').forEach((page) => {
        page.style.boxShadow = 'none';
      });

      await wait(150);

      const windowWidth = Math.max(frameDoc.documentElement.scrollWidth, frameDoc.body.scrollWidth, 920);
      const windowHeight = Math.max(frameDoc.documentElement.scrollHeight, frameDoc.body.scrollHeight, 1200);

      const canvas = await html2canvas(frameDoc.body, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: windowWidth,
        height: windowHeight,
        windowWidth,
        windowHeight,
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const imgData = canvas.toDataURL('image/png');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfPageHeight = pdf.internal.pageSize.getHeight();
      const canvasImageHeight = (canvas.height * pdfWidth) / canvas.width;

      let remainingHeight = canvasImageHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, canvasImageHeight);
      remainingHeight -= pdfPageHeight;

      while (remainingHeight > 0) {
        position = remainingHeight - canvasImageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, canvasImageHeight);
        remainingHeight -= pdfPageHeight;
      }

      pdf.save(getContractExportFilename('pdf'));
    } catch (err) {
      console.error('Contract PDF generation error:', err);
      alert('Erreur lors de la génération du PDF du contrat');
    } finally {
      iframe?.remove();
      setGeneratingContractPdf(false);
    }
  }, [contractHtml, generatingContractPdf, getContractExportFilename, buildContractHtml, contractType, contractFields, contractInlineEdits]);

  const addExtraLine = () => {
    setExtraLines(prev => [...prev, { _uid: newUid(), description: 'Nouveau poste', quantity: 1, unit: 'forfait', rate: 0, total_base: 0, ratio: 0, total_displayed: 0 }]);
  };
  const updateExtraLine = (idx: number, field: string, value: any) => {
    setExtraLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };
  const getVisibleBaseLineCount = () => {
    const baseLineCount = baseQuote?.lines.length || 0;
    const hiddenBaseCount = Array.from(hiddenLines).filter(idx => idx >= 0 && idx < baseLineCount).length;
    return Math.max(0, baseLineCount - hiddenBaseCount);
  };
  const removeExtraLine = (idx: number) => {
    const displayIdx = getVisibleBaseLineCount() + idx;
    shiftDisplayLineMapsAfter(displayIdx);
    setExtraLines(prev => prev.filter((_, i) => i !== idx));
  };
  const removeExtraLineByUid = (uid: string) => {
    const idx = extraLines.findIndex((l) => l._uid === uid);
    if (idx >= 0) {
      const displayIdx = getVisibleBaseLineCount() + idx;
      shiftDisplayLineMapsAfter(displayIdx);
    }
    setExtraLines(prev => prev.filter((l) => l._uid !== uid));
  };

  // When a visible quote row is removed, shift only display-indexed metadata.
  // Base overrides + hidden lines are keyed by original base index and must not move.
  const shiftDisplayLineMapsAfter = (removedIdx: number) => {
    const shiftRecord = <T,>(rec: Record<number, T>): Record<number, T> => {
      const next: Record<number, T> = {};
      for (const k of Object.keys(rec)) {
        const i = Number(k);
        if (i < removedIdx) next[i] = rec[i];
        else if (i > removedIdx) next[i - 1] = rec[i];
        // i === removedIdx is dropped
      }
      return next;
    };
    setLineQbProducts(prev => shiftRecord(prev));
    setLineMeasureMappings(prev => shiftRecord(prev));
    setLineMajorations(prev => shiftRecord(prev));
    setLineCategories(prev => shiftRecord(prev));
    setLineCostOverrides(prev => shiftRecord(prev));
    setLineLaborTypes(prev => shiftRecord(prev));
  };

  // ── QBO Estimate Import handlers ──
  const openQboEstimateImport = async () => {
    setQboEstimateDialogOpen(true);
    setQboEstSelectedCustomer(null);
    setQboEstimates([]);
    setQboEstLines([]);
    setQboEstSelectedEstimate(null);
    setQboEstSearch('');
    setQboEstLoading(true);
    const { data } = await (supabase as any).from('qb_customers').select('id, qb_id, display_name, bill_address').order('display_name');
    setQboEstCustomers(data || []);
    setQboEstLoading(false);
  };

  const selectQboEstCustomer = async (customer: any) => {
    setQboEstSelectedCustomer(customer);
    setQboEstLines([]);
    setQboEstSelectedEstimate(null);
    setQboEstimatesLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('quickbooks-sync', {
        body: { type: 'customer_estimates', customerId: customer.qb_id },
      });
      if (error) throw error;
      setQboEstimates(data?.estimates || []);
    } catch (err: any) {
      console.error('QBO estimates error:', err);
      alert('Erreur chargement devis: ' + (err?.message || err));
    }
    setQboEstimatesLoading(false);
  };

  const selectQboEstimate = async (estimate: any) => {
    setQboEstSelectedEstimate(estimate);
    setQboEstLinesLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('quickbooks-sync', {
        body: { type: 'estimate_detail', estimateId: estimate.id },
      });
      if (error) throw error;
      setQboEstLines(data?.lines || []);
    } catch (err: any) {
      console.error('QBO estimate detail error:', err);
      alert('Erreur chargement lignes: ' + (err?.message || err));
    }
    setQboEstLinesLoading(false);
  };

  const [qbImportMode, setQbImportMode] = useState<'append' | 'replace' | null>(null);

  const importQboEstimateLines = (mode: 'append' | 'replace' = 'append') => {
    if (!qboEstLines.length) return;
    // Resolve each QB line against the local qb_products catalog so we can
    // pre-fill unit, category and the QB product mapping correctly.
    const resolved = qboEstLines.map((l: any) => {
      const qbProd = l.item_ref
        ? qbProducts.find((p: any) => String(p.qb_id) === String(l.item_ref))
        : null;
      const qty = Number(l.quantity) || 1;
      const rate = Number(l.rate) || 0;
      const desc = (l.description || l.item_name || qbProd?.name || 'Article').toString();
      const unit = (qbProd?.coverage_unit || 'unité').toString();
      // Heuristic category from QB product / description
      const descLc = desc.toLowerCase();
      let category: LineCategory = 'materiau';
      if (qbProd?.type === 'Service' || /main.?d.?oeuvre|installation|pose|arrachage|labor|d[ée]molition/.test(descLc)) {
        category = 'main_oeuvre';
      } else if (/sous.?trait/.test(descLc)) {
        category = 'sous_traitance';
      } else if (/transport|livraison|conteneur/.test(descLc)) {
        category = 'transport';
      } else if (/location|grue|nacelle|[ée]chafaudage/.test(descLc)) {
        category = 'equipement';
      }
      const line: QuoteLine = {
        description: desc,
        quantity: qty,
        unit,
        rate,
        total_base: qty * rate,
        ratio: 0,
        total_displayed: qty * rate,
      };
      return { line, qbId: qbProd?.qb_id || l.item_ref || '', category };
    });

    if (mode === 'replace') {
      // Garder uniquement les lignes importées : masquer toutes les lignes
      // de base calculées et remplacer les extras existants.
      setHiddenLines(new Set(Array.from({ length: 20 }, (_, i) => i)));
      setExtraLines(resolved.map(r => ensureUid(r.line)));
      // Les extras importés démarrent à l'index 0 (toutes les bases masquées)
      setLineQbProducts(() => {
        const next: Record<number, string> = {};
        resolved.forEach((r, idx) => { if (r.qbId) next[idx] = r.qbId; });
        return next;
      });
      setLineCategories(() => {
        const next: Record<number, LineCategory> = {} as any;
        resolved.forEach((r, idx) => { next[idx] = r.category; });
        return next;
      });
    } else {
      // Append : la position de départ correspond à la longueur courante
      const startIdx = finalQuote?.lines.length || 0;
      setExtraLines(prev => [...prev, ...resolved.map(r => ensureUid(r.line))]);
      setLineQbProducts(prev => {
        const next = { ...prev };
        resolved.forEach((r, idx) => { if (r.qbId) next[startIdx + idx] = r.qbId; });
        return next;
      });
      setLineCategories(prev => {
        const next = { ...prev };
        resolved.forEach((r, idx) => { next[startIdx + idx] = r.category; });
        return next;
      });
    }
    setQbImportMode(null);
    setQboEstimateDialogOpen(false);
  };
  const updateLineOverride = (lineIdx: number, field: string, value: any) => {
    setLineOverrides(prev => ({ ...prev, [lineIdx]: { ...(prev[lineIdx] || {}), [field]: value } }));
  };

  // ── Reset measurements ──
  const resetMeasurements = useCallback(() => {
    setMeasureTools(prev => prev.map(t => ({ ...t, rawValue: '', correctedValue: '' })));
    setMapAnnotations([]);
    setClearAllAnnotations(true);
    setMeasureMode(null);
  }, []);

  // ── Reset form ──
  const resetForm = () => {
    // ── Vague A : confirmation destructive ──
    // Quand FEATURE_CONFIRM_DESTRUCTIVE est ON et que l'utilisateur a des
    // modifications non sauvegardées, on demande une confirmation avant
    // d'effacer le formulaire (corrige AQG-005 « Nouveau cliqué par erreur »).
    if (FEATURE_CONFIRM_DESTRUCTIVE) {
      const dirty = !!(addressText || clientFirst || clientLast || clientEmail ||
        clientPhone || (mapAnnotations && mapAnnotations.length > 0) ||
        Object.keys(lineOverrides).length > 0 || extraLines.length > 0 ||
        quoteNotes || paymentTerms || finalQuote);
      if (dirty) {
        const ok = typeof window !== 'undefined'
          ? window.confirm('Effacer toute la soumission en cours ? Les modifications non sauvegardées seront perdues.')
          : true;
        if (!ok) return;
      }
    }
    setAddressText(''); setLat(null); setLng(null);
    setBuildingGeojson(null); setLotGeojson(null); setNoLot(null); setYearBuilt(null); setDwellingCount(null); setFloorCount(null); setMamhDataSource(null); setAutoFilledFields(new Set());
    setSuperficie(null); setPerimetre(null); setLargeur(null); setProfondeur(null);
    setLotDistanceM(null); setLotManual(false);
    setBuildingPhase('idle'); setMapParams({ zoom: 19, centerLat: 0, centerLng: 0 });
    setPolygonAdj({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
    setLotAdj({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
    setRoofType('4pans'); setSlopeCategory('moderee'); setConfidence(0.75);
    setAreaSqftOverride(''); setPerimeterFtOverride('');
    setFaitiereOverride(''); setAretesOverride(''); setNouesOverride('');
    setEventsCount(''); setMaximumsCount('');
    setLineOverrides({}); setExtraLines([]); setHiddenLines(new Set());
    setLineQbProducts({}); setQbPushResult(null);
    setRealCosts({}); setShowLineEditor(false);
    setClientFirst(''); setClientLast(''); setClientEmail(''); setClientPhone(''); setClientCompany('');
    setClientPostalAddress(''); setIsCompany(false); setClientNeq(''); setUseOwnerAsClient(false);
    setSelectedQbCustomer(null); setQbDuplicateMatch(null);
    setQbCreateResult(null); setCreatingQbCustomer(false);
    setOwnerList([]); setSelectedOwnerIdxs([0]); setOwnerError(null); setOwnerLoading(false);
    setSaved(false); setLoadedId(null); setLoadedSeqNumber(null); setCrewSize(3);
    setManualMeasureMode(false); setPlanImageDataUrl(null); setSavedPlanUrl(null);
    setWorkType(''); setLineCategories({}); setLineCostOverrides({}); setLineLaborTypes({});
    setRoofCategory('residential'); setBuildingType(''); setComplexity(''); setColorName(''); setContactPreference('email');
    // ── Fichiers & médias rattachés à l'ancienne soumission ──
    // Sans ça, le PDF généré, les photos et l'annotation aérienne (poussée dans
    // pdfFiles) fuient d'une soumission à l'autre, même après « Nouveau ».
    setPdfFiles([]); setContactPhotoUrl(null); setProjectPhotoUrl(null); setStreetViewState(null);
    // ── Produit / mesures 3D / mappages propres à la soumission ──
    setSelectedCoverageTypes([]); setSelectedMarque(''); setSelectedGamme('');
    setLineMeasureMappings({}); setLineMajorations({}); setRoof3dMeasures(null); setRoof3dModel(null);
    // ── Notes, conditions, en-tête de l'aperçu ──
    setQuoteNotes(''); setPaymentTerms('');
    setQuoteHeaderFields({
      quoteDate: new Date().toISOString().slice(0, 10), validityDays: 16, devisNo: '',
      contractType: 'FORFAITAIRE', projectAddress: '', projectNo: '',
    });
    // ── Contrat & garantie ──
    setContractType('forfaitaire');
    setContractFields({
      clientName: '', clientAddress: '', clientPhone: '', clientEmail: '',
      dossierNo: '', contractDate: new Date().toLocaleDateString('fr-CA'), workAddress: '', devisNo: '',
      startDate: '', durationDays: '',
      prixForfaitaire: '', budgetMateriaux: '', budgetMainOeuvre: '', budgetTotal: '',
      honorairePct: '15', estimationInitiale: '', plafondBudget: '', plafondType: 'sans',
    });
    setContractInlineEdits({ checkboxes: {}, warrantyYearsContract: 5, freeText: {} });
    setBlankContractMode(false);
    setWarrantyYears(5); setWarrantyCompletionDate(''); setWarrantyInvoice(''); setWarrantyContractAmount(''); setWarrantyIncludeConditions(true);
    // ── Exclusions cochées ──
    setExclusionsList(DEFAULT_EXCLUSIONS); setExclusionsChecked({});
    resetMeasurements();
    try { localStorage.removeItem('quote_generator_draft_v1'); } catch {}
    // ── Vague A : purge des brouillons v2 scoped (l'ancien et le nouveau « new:<tmpId> ») ──
    if (FEATURE_AUTOSAVE) {
      try {
        if (loadedId) localStorage.removeItem(makeDraftKeyV2({ loadedId, tmpId: tmpDraftIdRef.current }));
        localStorage.removeItem(makeDraftKeyV2({ loadedId: null, tmpId: tmpDraftIdRef.current }));
      } catch { /* noop */ }
      // Nouveau tmpId pour la prochaine soumission, sinon le brouillon repartirait sur l'ancien scope.
      try {
        tmpDraftIdRef.current = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      } catch {
        tmpDraftIdRef.current = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
    }
    // Repartir à neuf : on retire ?id=… de l'URL et on réarme l'auto-chargement
    // pour qu'un rechargement conserve un formulaire vierge (et non l'ancienne soumission).
    autoLoadedRef.current = false;
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('id')) { sp.delete('id'); setSearchParams(sp, { replace: true }); }
    } catch {}
  };

  // ── Create QB Customer ──
  const handleCreateQbCustomer = async () => {
    if (creatingQbCustomer) return;
    setCreatingQbCustomer(true);
    setQbCreateResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const displayName = isCompany && clientCompany
        ? clientCompany
        : `${clientFirst} ${clientLast}`.trim();

      const res = await fetch(`${FN_BASE}/quickbooks-create-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          // If a QB customer is already linked, force the update path
          qb_id: selectedQbCustomer?.Id || undefined,
          given_name: clientFirst,
          family_name: clientLast,
          display_name: displayName,
          email: clientEmail,
          phone: clientPhone,
          company_name: isCompany ? clientCompany : undefined,
          neq: isCompany ? clientNeq : undefined,
          bill_address: clientPostalAddress || undefined,
          ship_address: addressText || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setQbCreateResult({ success: true, message: data.message });
        // Select the created/found customer
        setSelectedQbCustomer({
          Id: data.customer.id,
          DisplayName: displayName,
          GivenName: clientFirst,
          FamilyName: clientLast,
          CompanyName: isCompany ? clientCompany : '',
          PrimaryEmailAddr: clientEmail ? { Address: clientEmail } : null,
          PrimaryPhone: clientPhone ? { FreeFormNumber: clientPhone } : null,
          BillAddr: clientPostalAddress ? { Line1: clientPostalAddress } : null,
        });
        // Refresh local QB customers
        const { data: custRes } = await (supabase as any).from('qb_customers').select('*').order('display_name');
        if (custRes && custRes.length > 0) {
          setQbCustomers(custRes.map((c: any) => ({
            Id: c.qb_id, DisplayName: c.display_name,
            CompanyName: c.company_name,
            GivenName: c.raw_data?.GivenName || '',
            FamilyName: c.raw_data?.FamilyName || '',
            PrimaryEmailAddr: c.email ? { Address: c.email } : null,
            PrimaryPhone: c.phone ? { FreeFormNumber: c.phone } : null,
            Mobile: c.mobile ? { FreeFormNumber: c.mobile } : null,
            BillAddr: c.bill_address ? { Line1: c.bill_address } : null,
          })));
        }
      } else {
        setQbCreateResult({ success: false, message: `${data.error || 'Erreur inconnue'}` });
      }
    } catch (e) {
      console.error('Create QB customer error:', e);
      setQbCreateResult({ success: false, message: 'Erreur réseau' });
    } finally {
      setCreatingQbCustomer(false);
    }
  };

  // ── Push to QuickBooks ──
  const handlePushToQb = async () => {
    if (!finalQuote || pushingToQb) return;
    setPushingToQb(true);
    setQbPushResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      // Build lines with QB product refs
      const qbLines = finalQuote.lines.map((line, i) => {
        const qbProductId = lineQbProducts[i];
        const cat = lineCategories[i];
        // Map internal category -> QBO section
        let section: 'labor' | 'material' | 'other' = 'other';
        if (cat === 'main_oeuvre' || cat === 'sous_traitance') section = 'labor';
        else if (cat === 'materiau' || cat === 'equipement' || cat === 'transport' || cat === 'divers') section = 'material';
        return {
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          rate: line.rate,
          total: line.total_displayed,
          qb_product_id: qbProductId || null,
          section,
        };
      });

      // Build descriptive intro lines (product, color, warranty, surface, price/sqft)
      const introLines: string[] = [];
      const productLabel = [selectedMarque, selectedGamme].filter(Boolean).join(' ').toUpperCase();
      if (productLabel) {
        introLines.push(`${productLabel} - COULEUR À VALIDER AVEC LE CLIENT`);
      }
      if (selectedMarque && /iko/i.test(selectedMarque)) {
        introLines.push('**GARANTIE 40 - VOIR LA GARANTIE IKO EN PJ**');
      }
      introLines.push('**GARANTIE TOITURES VB 10 ANS**');
      if (effectiveAreaSqft) {
        introLines.push(`SUPERFICIE BARDEAUX : ${Math.round(effectiveAreaSqft).toLocaleString('fr-CA')} pi²`);
      }
      if (finalQuote && effectiveAreaSqft) {
        const pricePerSqft = (finalQuote.subtotal_displayed / effectiveAreaSqft).toFixed(2);
        const pricePerPq = Math.round(Number(pricePerSqft) * 100 / 3);
        introLines.push(`PRIX/PQ : ${pricePerPq}$\nPRIX/PI2 : ${pricePerSqft}$/PI2`);
      }

      // Build footer lines (exclusions + payment terms reproduisant le PDF)
      const exclusionLines = [
        'EXCLUSIONS :',
        "• Installation de CP ou charpente endommagées ou moisies",
        "• Installation de Solin \"Flashing\" de toit",
        "• Conteneur",
        "• Retours de corniches",
        "• Calfeutrage",
        "• Charpente, parapet, etc",
      ];

      const res = await fetch(`${FN_BASE}/quickbooks-push-invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          lines: qbLines,
          intro_lines: introLines,
          footer_lines: exclusionLines,
          customer_id: selectedQbCustomer?.Id || null,
          customer_name: `${clientFirst} ${clientLast}`.trim(),
          customer_email: clientEmail,
          address: addressText,
          // Message affiché sur le devis (Customer Memo) + Modalités de paiement
          memo: [
            quoteNotes?.trim(),
            paymentTerms?.trim() ? `Modalités de paiement:\n${paymentTerms.trim()}` : '',
          ].filter(Boolean).join('\n\n') ||
            `Soumission - ${clientFirst} ${clientLast} - ${addressText?.split(',')[0] || ''}`,
          // Numéro de devis VB (devient le DocNumber dans QBO)
          doc_number: (quoteHeaderFields.devisNo || (loadedSeqNumber ? `VB-${loadedSeqNumber}` : '')) || undefined,
          // Dates et champs personnalisés (poussés sur l'Estimate QBO)
          txn_date: quoteHeaderFields.quoteDate || undefined,
          expiration_date: (() => {
            if (!quoteHeaderFields.quoteDate) return undefined;
            const d = new Date(quoteHeaderFields.quoteDate + 'T00:00:00');
            d.setDate(d.getDate() + (Number(quoteHeaderFields.validityDays) || 0));
            return d.toISOString().slice(0, 10);
          })(),
          custom_fields: {
            contract_type: quoteHeaderFields.contractType,
            project_address: (quoteHeaderFields.projectAddress || (addressText || '').toUpperCase()).slice(0, 31),
            project_no: (quoteHeaderFields.projectNo || '').slice(0, 31),
          },
          // Pièces jointes (PDF déjà uploadés dans le bucket quote-pdfs)
          attachments: (pdfFiles || []).map(f => ({ name: f.name, url: f.url })),
        }),
      });

      const data = await res.json();
      if (data.success) {
        const att = Array.isArray(data.attachments) ? data.attachments : [];
        const okCount = att.filter((a: any) => a.ok).length;
        const failCount = att.length - okCount;
        const attMsg = att.length
          ? ` — ${okCount}/${att.length} pièce(s) jointe(s) envoyée(s)${failCount ? ' ' : ''}`
          : '';
        setQbPushResult({
          success: true,
          message: `Estimé #${data.qb_estimate_number || data.qb_estimate_id} créé dans QuickBooks${attMsg}`,
          pdfUrl: data.pdf_url || null,
        });
      } else {
        const detail = data.details?.Fault?.Error?.[0]?.Detail || data.error || 'Erreur inconnue';
        setQbPushResult({ success: false, message: `${detail}` });
      }
    } catch (e) {
      console.error('Push to QB error:', e);
      setQbPushResult({ success: false, message: 'Erreur réseau' });
    } finally {
      setPushingToQb(false);
    }
  };

  const downloadQbPdf = async () => {
    if (!qbPushResult?.pdfUrl) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch(qbPushResult.pdfUrl, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': ANON_KEY },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `QB_Estimate_${clientLast || 'soumission'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Erreur lors du téléchargement du PDF QB'); }
  };

  // ── Warranty Certificate Generation ──
  const handleGenerateWarranty = async () => {
    setGeneratingWarranty(true);
    try {
      const city = addressText ? (addressText.split(',')[1] || '').trim() : '';
      const wData: WarrantyData = {
        clientName: `${clientFirst} ${clientLast}`.trim() || 'Client',
        projectAddress: addressText ? addressText.split(',')[0].trim() : '',
        city,
        roofType: roofType === '4pans' ? 'Bardeaux 4 versants' : roofType === '2pans' ? 'Bardeaux 2 versants' : roofType === '4pans_plus' ? 'Bardeaux complexe' : roofType,
        surfaceArea: effectiveAreaSqft ? `${Math.round(effectiveAreaSqft).toLocaleString()} pi²` : '—',
        completionDate: warrantyCompletionDate || new Date().toLocaleDateString('fr-CA'),
        invoiceNumber: warrantyInvoice || '—',
        warrantyYears,
        contractAmount: warrantyContractAmount ? `${Number(warrantyContractAmount).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })}` : (finalQuote ? `${finalQuote.total_final.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })}` : '—'),
        referenceId: `VB_${addressText ? addressText.split(',')[0].toUpperCase().replace(/[^A-Z0-9 ]/g, '') : 'GARANTIE'}`,
      };
      const stampNumber = await generateWarrantyCertificatePdf(wData, warrantyIncludeConditions);
      
      // Save to Supabase
      try {
        await (supabase as any).from('warranty_certificates').insert({
          certificate_number: stampNumber,
          client_name: wData.clientName,
          project_address: wData.projectAddress,
          city: wData.city,
          roof_type: wData.roofType,
          surface_area: wData.surfaceArea,
          completion_date: wData.completionDate,
          invoice_number: wData.invoiceNumber,
          warranty_years: wData.warrantyYears,
          contract_amount: wData.contractAmount,
          reference_id: wData.referenceId,
        });
      } catch (dbErr) {
        console.warn('Could not save warranty certificate:', dbErr);
      }
    } catch (e) {
      console.error('Warranty PDF error:', e);
      alert('Erreur lors de la génération du certificat');
    } finally {
      setGeneratingWarranty(false);
    }
  };

  // ── PDF Generation ──
  const handleGeneratePdf = async () => {
    if (!finalQuote) return;
    setGeneratingPdf(true);
    try {
      let satDataUrl: string | null = null;
      if (lat && lng) {
        const rawSat = await fetchSatelliteDataUrl(lat, lng, mapParams.zoom || 19, GOOGLE_API_KEY);
        if (rawSat && buildingGeojson) {
          satDataUrl = await compositeMapWithPolygons(rawSat, mapParams.centerLat || lat, mapParams.centerLng || lng, mapParams.zoom || 19, buildingGeojson, lotGeojson, polygonAdj);
        } else {
          satDataUrl = rawSat;
        }
      }

      const building: BuildingData = {
        geojson: buildingGeojson, lotGeojson, superficie, perimetre, largeur, profondeur,
        noLot, slopeCategory, roofType, confidence,
        productName: 'Dynasty', productBrand: 'IKO', colorName: 'Standard',
        coverageType: `shingle_${roofType}`, satImageDataUrl: satDataUrl,
      };

      const pdfCtx: PdfContext = {
        clientName: `${clientFirst || 'Admin'} ${clientLast || 'Généré'}`,
        address: addressText || 'Adresse non spécifiée',
        product: 'IKO Dynasty',
        color: 'Standard',
        date: new Date().toLocaleDateString('fr-CA'),
        quote: finalQuote,
        building,
        pdfFilenameBase: `VB_ADMIN_${addressText ? addressText.split(',')[0].toUpperCase().replace(/[^A-Z0-9 ]/g, '') : 'SOUMISSION'}`,
        quoteNotes: quoteNotes || undefined,
        paymentTerms: paymentTerms || undefined,
        seqNumber: loadedSeqNumber || undefined,
        gamme: selectedGamme || undefined,
        marque: selectedMarque || undefined,
        effectiveAreaSqft: effectiveAreaSqft || undefined,
      };

      await generateQuotePdf(pdfCtx);
    } catch (e) {
      console.error('PDF generation error:', e);
      alert('Erreur lors de la génération du PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  // ── Save ──
  const handleSave = async (opts?: { silent?: boolean }) => {
    const silent = !!(opts && (opts as any).silent === true);
    if (saving) return;
    if (silent && autosavingRef.current) return;
    if (silent) autosavingRef.current = true; else setSaving(true);
    // Draft mode: no finalQuote yet → persist a minimal row to Supabase
    // so the soumission is recoverable from any device.
    if (!finalQuote) {
      try {
        const draftPayload: any = {
          first_name: clientFirst || 'Brouillon',
          last_name: clientLast || 'Admin',
          email: clientEmail || 'admin@toituresvb.ca',
          phone: clientPhone || '000-000-0000',
          formatted_address: addressText || null,
          lat, lng,
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
            // Vague A §3.5 : version du schéma JSONB (ajoutée sous flag).
            ...(FEATURE_AUTOSAVE ? { schema_version: '1.0.0' } : {}),
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
            roof3d_view: roof3dView,
            roof3d_georef: roof3dGeoRef,
            roof_report_pdf_path: roofReportPdfPath,
            selected_qb_customer_id: selectedQbCustomer?.Id || null,
            use_owner_as_client: useOwnerAsClient,
            client_postal_address: clientPostalAddress || '',
            client_company: clientCompany || '',
            is_company: isCompany,
            client_neq: clientNeq || '',
            pdf_files: pdfFiles,
            contact_photo_url: contactPhotoUrl,
            project_photo_url: projectPhotoUrl,
            // Contrat + garantie : persistés aussi en mode brouillon pour ne rien perdre
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
            measure_tools: measureTools.map(t => ({
              id: t.id, name: t.name, toolType: t.toolType,
              rawValue: t.rawValue, correctedValue: t.correctedValue,
              unit: t.unit, color: t.color, visible: t.visible,
              linkedTo: t.linkedTo, markerShape: t.markerShape,
              qbProductId: t.qbProductId || undefined,
              slopeType: t.slopeType || undefined,
              slopeFactor: t.slopeFactor ?? undefined,
              majoration: t.majoration ?? undefined,
            })),
            map_annotations: mapAnnotations.map(a => ({
              target: a.target, feet: a.feet, visible: a.visible, index: a.index,
              segments: a.segments || [], markerPositions: a.markerPositions || [],
            })),
          },
        };
        let error;
        if (loadedId) {
          if (!draftPayload.dynasty_breakdown.map_annotations.length) {
            const { data: current } = await supabase.from('soumissions').select('dynasty_breakdown').eq('id', loadedId).maybeSingle();
            const existing = (current as any)?.dynasty_breakdown;
            if (Array.isArray(existing?.map_annotations) && existing.map_annotations.length) {
              draftPayload.dynasty_breakdown.map_annotations = existing.map_annotations;
              if (Array.isArray(existing?.measure_tools) && existing.measure_tools.length) draftPayload.dynasty_breakdown.measure_tools = existing.measure_tools;
            }
          }
          // Vague A2 : injection sous flag des colonnes MAMH dans la payload UPDATE.
          // En flag OFF, l'objet `year_built: yearBuilt, dwelling_count: dwellingCount, floor_count: floorCount, mamh_data_source: mamhDataSource` n'est PAS spread,
          // donc payload bit-identique à avant Vague A2.
          const updatePayload = AUTOFILL_ENABLED
            ? { ...draftPayload, year_built: yearBuilt, dwelling_count: dwellingCount, floor_count: floorCount, mamh_data_source: mamhDataSource }
            : draftPayload;
          ({ error } = await supabase.from('soumissions').update(updatePayload).eq('id', loadedId));
        } else {
          const insertPayload = AUTOFILL_ENABLED
            ? { ...draftPayload, status: 'new' as const, year_built: yearBuilt, dwelling_count: dwellingCount, floor_count: floorCount, mamh_data_source: mamhDataSource }
            : { ...draftPayload, status: 'new' as const };
          const res = await supabase.from('soumissions').insert(insertPayload).select('id, seq_number').single();
          error = res.error;
          if (res.data?.id) adoptSoumissionId(res.data.id);
          if (res.data?.seq_number) setLoadedSeqNumber(res.data.seq_number);
        }
        if (error) throw error;
        if (silent) { autosavedAtRef.current = Date.now(); }
        else {
          setSaved(true);
          toast.success('Brouillon sauvegardé dans la base ✓', {
            description: 'Complétez les mesures pour finaliser la soumission.',
          });
          setTimeout(() => setSaved(false), 3000);
        }
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
        // Vague A : purge aussi le brouillon v2 — Supabase est canonique maintenant.
        if (FEATURE_AUTOSAVE) {
          try {
            localStorage.removeItem(makeDraftKeyV2({ loadedId: null, tmpId: tmpDraftIdRef.current }));
            if (loadedId) localStorage.removeItem(makeDraftKeyV2({ loadedId, tmpId: tmpDraftIdRef.current }));
          } catch { /* noop */ }
        }
      } catch (e) {
        console.error('Draft save error:', e);
        if (!silent) { const msg = (e as any)?.message || 'Erreur inconnue'; toast.error('Échec de la sauvegarde', { description: msg }); }
      } finally {
        if (silent) autosavingRef.current = false; else setSaving(false);
      }
      return;
    }
    try {
      // Upload manual plan image if present
      let manualPlanUrl = savedPlanUrl || null;
      if (manualMeasureMode && planImageDataUrl) {
        try {
          const blob = await (await fetch(planImageDataUrl)).blob();
          const fileName = `plan_${Date.now()}.jpg`;
          const storagePath = `plans/${fileName}`;
          const { error: uploadErr } = await supabase.storage.from('quote-pdfs').upload(storagePath, blob, { contentType: 'image/jpeg', upsert: true });
          if (!uploadErr) {
            const __signed = await getSignedQuotePdfUrl(storagePath);
          const urlData = { publicUrl: __signed || '' };
            manualPlanUrl = urlData?.publicUrl || null;
          }
        } catch (e) { console.warn('Plan image upload failed:', e); }
      }

      const dynastyBreakdown = {
        // Vague A §3.5 : schema_version permet une lecture tolérante future
        // (absent = `1.0.0`). Ajouté uniquement quand le flag est ON pour ne
        // pas modifier l'octet près l'écriture côté flag-OFF.
        ...(FEATURE_AUTOSAVE ? { schema_version: '1.0.0' } : {}),
        surface_sqft: finalQuote.surface_displayed,
        subtotal_base: finalQuote.subtotal_base,
        contingency: finalQuote.contingency,
        subtotal_displayed: finalQuote.subtotal_displayed,
        tps: finalQuote.tps, tvq: finalQuote.tvq,
        total_final: finalQuote.total_final,
        slope_category: finalQuote.slope_category, slope_factor: finalQuote.slope_factor,
        roof_type: finalQuote.roof_type, perimeter_ft: finalQuote.perimeter_ft,
        area_sqft: finalQuote.area_sqft, surface_corrected: finalQuote.surface_corrected,
        confidence: finalQuote.confidence, low_confidence: finalQuote.low_confidence,
        length_faitiere: finalQuote.length_faitiere,
        length_hanches: finalQuote.length_hanches,
        length_noues: finalQuote.length_noues,
        lines: finalQuote.lines.map(l => ({ description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, total_displayed: l.total_displayed })),
        is_manual_mode: manualMeasureMode,
        manual_plan_url: manualPlanUrl,
        quote_notes: quoteNotes || '',
        payment_terms: paymentTerms || '',
        quote_header_fields: quoteHeaderFields,
        measure_tools: measureTools.map(t => ({
          id: t.id, name: t.name, toolType: t.toolType,
          rawValue: t.rawValue, correctedValue: t.correctedValue,
          unit: t.unit, color: t.color, visible: t.visible,
          linkedTo: t.linkedTo, markerShape: t.markerShape,
          qbProductId: t.qbProductId || undefined,
          slopeType: t.slopeType || undefined,
          slopeFactor: t.slopeFactor ?? undefined,
          majoration: t.majoration ?? undefined,
        })),
        map_annotations: mapAnnotations.map(a => ({
          target: a.target, feet: a.feet, visible: a.visible, index: a.index,
          segments: a.segments || [], markerPositions: a.markerPositions || [],
        })),
        polygon_adj: polygonAdj,
        lot_adj: lotAdj,
        map_params: mapParams,
        street_view_state: streetViewState,
        extra_lines: extraLines,
        hidden_lines: Array.from(hiddenLines),
        // Persist the manual overrides verbatim (keyed by original base-quote
        // index) so entered rates/quantities survive a save→reload round-trip.
        line_overrides: lineOverrides,
        line_qb_products: lineQbProducts,
        line_measure_mappings: lineMeasureMappings,
        line_majorations: lineMajorations,
        line_categories: lineCategories,
        real_costs: realCosts,
        line_cost_overrides: lineCostOverrides,
        line_labor_types: lineLaborTypes,
        margin_threshold_pct: marginThresholdPct,
        crew_size: crewSize,
        // Durée estimée par le moteur de soumission (jours ouvrables)
        total_days_estimated: metrics.totalDays,
        tearoff_days_estimated: metrics.tearoffDays,
        install_days_estimated: metrics.installDays,
        client_postal_address: clientPostalAddress || '',
        client_company: clientCompany || '',
        is_company: isCompany,
        client_neq: clientNeq || '',
        building_geojson: buildingGeojson,
        lot_geojson: lotGeojson,
        no_lot: noLot,
        superficie_m2: superficie,
        perimetre_m: perimetre,
        largeur_m: largeur,
        profondeur_m: profondeur,
        selected_coverage_type: selectedCoverageType,
        selected_marque: selectedMarque,
        selected_gamme: selectedGamme,
        roof3d_measures: roof3dMeasures,
        roof3d_model: roof3dModel,
        roof3d_view: roof3dView,
        roof3d_georef: roof3dGeoRef,
        roof_report_pdf_path: roofReportPdfPath,
        // Champs de configuration toiture (sauvegarde explicite pour fiabilité au rechargement)
        ui_roof_type: roofType,
        ui_slope_category: slopeCategory,
        ui_work_type: workType,
        pdf_files: pdfFiles,
        contact_photo_url: contactPhotoUrl,
        project_photo_url: projectPhotoUrl,
        // Persist client linkage so it survives reloads
        selected_qb_customer_id: selectedQbCustomer?.Id || null,
        use_owner_as_client: useOwnerAsClient,
        // Contrat — type, champs éditables et edits inline (cases à cocher, durée garantie)
        contract_type: contractType,
        contract_fields: contractFields,
        contract_inline_edits: contractInlineEdits,
        // Certificat de garantie
        warranty_settings: {
          years: warrantyYears,
          completion_date: warrantyCompletionDate,
          invoice: warrantyInvoice,
          contract_amount: warrantyContractAmount,
          include_conditions: warrantyIncludeConditions,
        },
      };

      const payload = {
        first_name: clientFirst || 'Admin', last_name: clientLast || 'Généré',
        email: clientEmail || 'admin@toituresvb.ca', phone: clientPhone || '000-000-0000',
        formatted_address: addressText || null, lat, lng,
        coverage_type: selectedCoverageType || `shingle_${roofType}`,
        slope: slopeCategory,
        area_sqft: effectiveAreaSqft, area_input: effectiveAreaSqft, area_unit: 'sqft',
        subtotal: finalQuote.subtotal_displayed,
        low_estimate: finalQuote.total_final * 0.9, high_estimate: finalQuote.total_final,
        slope_factor: finalQuote.slope_factor, complexity_factor: 1,
        dynasty_breakdown: dynastyBreakdown, contact_preference: contactPreference || 'email',
        product_name: selectedGamme || 'Dynasty',
        product_brand: selectedMarque || 'IKO',
        color: colorName || null,
        roof_category: roofCategory || 'residential',
        building_type: buildingType || null,
        work_type: workType || null,
        complexity: complexity || null,
        price_per_sqft: effectiveAreaSqft > 0 ? finalQuote.subtotal_displayed / effectiveAreaSqft : null,
      } as any;

      let error;
      if (loadedId) {
        if (!payload.dynasty_breakdown.map_annotations.length) {
          const { data: current } = await supabase.from('soumissions').select('dynasty_breakdown').eq('id', loadedId).maybeSingle();
          const existing = (current as any)?.dynasty_breakdown;
          if (Array.isArray(existing?.map_annotations) && existing.map_annotations.length) {
            payload.dynasty_breakdown.map_annotations = existing.map_annotations;
            if (Array.isArray(existing?.measure_tools) && existing.measure_tools.length) payload.dynasty_breakdown.measure_tools = existing.measure_tools;
            if (!silent) toast.info('Annotations existantes conservées pendant la sauvegarde');
          }
        }
        // Vague A2 : injection sous flag des colonnes MAMH dans la payload UPDATE/INSERT.
        // En flag OFF, les spreads `year_built: yearBuilt, dwelling_count: dwellingCount, floor_count: floorCount, mamh_data_source: mamhDataSource` ne s'exécutent pas.
        const updatePayload = AUTOFILL_ENABLED
          ? { ...payload, year_built: yearBuilt, dwelling_count: dwellingCount, floor_count: floorCount, mamh_data_source: mamhDataSource }
          : payload;
        ({ error } = await supabase.from('soumissions').update(updatePayload).eq('id', loadedId));
      } else {
        const insertPayload = AUTOFILL_ENABLED
          ? { ...payload, status: 'new' as const, year_built: yearBuilt, dwelling_count: dwellingCount, floor_count: floorCount, mamh_data_source: mamhDataSource }
          : { ...payload, status: 'new' as const };
        const res = await supabase.from('soumissions').insert(insertPayload).select('id, seq_number').single();
        error = res.error;
        if (res.data?.id) adoptSoumissionId(res.data.id);
        if (res.data?.seq_number) setLoadedSeqNumber(res.data.seq_number);
      }
      if (error) throw error;
      if (silent) { autosavedAtRef.current = Date.now(); }
      else { setSaved(true); toast.success('Soumission sauvegardée ✓'); setTimeout(() => setSaved(false), 3000); }
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
    } catch (e) {
      console.error('Save error:', e);
      if (!silent) { const msg = (e as any)?.message || 'Erreur inconnue'; toast.error('Échec de la sauvegarde', { description: msg }); }
    } finally { if (silent) autosavingRef.current = false; else setSaving(false); }
  };

  // ── Autosave : sauvegarde silencieuse debouncée (plus besoin de cliquer « Enregistrer ») ──
  const handleSaveRef = useRef(handleSave); handleSaveRef.current = handleSave;
  useEffect(() => {
    if (FEATURE_AUTOSAVE) return; // Vague A : remplacé par useQuoteAutosave (block ci-dessous)
    const hasContent = !!(addressText || clientFirst || clientLast || clientEmail || clientPhone || finalQuote);
    if (!hasContent || saving) return;
    const t = setTimeout(() => { handleSaveRef.current({ silent: true }); }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addressText, lat, lng, clientFirst, clientLast, clientEmail, clientPhone, clientCompany,
    clientPostalAddress, isCompany, clientNeq, workType, roofType, slopeCategory,
    areaSqftOverride, perimeterFtOverride, selectedMarque, selectedGamme, selectedCoverageTypes,
    quoteNotes, paymentTerms, measureTools, mapAnnotations, finalQuote,
    contractType, contractFields, contractInlineEdits, blankContractMode, selectedQbCustomer,
    warrantyYears, warrantyCompletionDate, warrantyInvoice, warrantyContractAmount, warrantyIncludeConditions,
    roofCategory, buildingType, complexity, colorName, contactPreference,
  ]);

  // Alimente les outils « 3D · … » avec les mesures du modèle 3D validé
  // (roof3dMeasures). Sans ça les outils 3D restent à « — » (mesures stockées
  // mais pas lues). rawValue = mesure 3D ; correctedValue préservée si l'user
  // l'a corrigée manuellement.
  useEffect(() => {
    if (!roof3dMeasures) return;
    setMeasureTools(prev => {
      let changed = false;
      const next = prev.map(t => {
        const t3d = TOOL_TYPES_3D_BY_VALUE[t.toolType as unknown as string];
        if (!t3d) return t;
        const v = (roof3dMeasures as any)[t3d.r3dKey];
        const sv = (v == null || isNaN(Number(v))) ? '' : String(v);
        const keepCorrected = !!t.correctedValue && t.correctedValue !== t.rawValue;
        if (t.rawValue === sv && (keepCorrected || t.correctedValue === sv)) return t;
        changed = true;
        return { ...t, rawValue: sv, correctedValue: keepCorrected ? t.correctedValue : sv };
      });
      return changed ? next : prev;
    });
  }, [roof3dMeasures]);

  // Persistance IMMÉDIATE en DB des annotations 2D (outils de mesure +
  // annotations carte) — débouncée, fusion non destructive, jamais par du vide.
  // Garantit que la détection IA / le tracé manuel survit à une réouverture,
  // même sans sauvegarde explicite (mêmes correctifs que bâtiment/modèle/vue).
  useEffect(() => {
    const lid = loadedIdRef.current;
    if (!lid) return;
    if (measureTools.length === 0 && mapAnnotations.length === 0) return; // n'écrase pas avec du vide
    const t = setTimeout(() => {
      (async () => {
        try {
          const { data: cur } = await supabase.from('soumissions').select('dynasty_breakdown').eq('id', lid).single();
          const bd = { ...(((cur as any)?.dynasty_breakdown) || {}), measure_tools: measureTools, map_annotations: mapAnnotations };
          await supabase.from('soumissions').update({ dynasty_breakdown: bd } as any).eq('id', lid);
        } catch { /* non bloquant */ }
      })();
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureTools, mapAnnotations]);

  // ═══════════════════════════════════════════════════════════════════════
  // VAGUE A — Zero-loss autosave (feature-flagged behind VITE_QUOTE_MOBILE_V2)
  // ═══════════════════════════════════════════════════════════════════════
  // Everything in this block is a no-op when FEATURE_AUTOSAVE is false.
  // It augments — never replaces — the existing manual handleSave path.
  // Passing `enabled=FEATURE_AUTOSAVE` skips the global online/offline
  // listeners when the flag is OFF so this code path adds zero side-effects.
  const onlineV2 = useOnlineStatus(FEATURE_AUTOSAVE);
  // Build the snapshot used by both the Supabase payload and the localStorage draft.
  const buildSnapshotV2 = useCallback((): QuoteStateSnapshot => ({
    clientFirst, clientLast, clientEmail, clientPhone,
    clientCompany, clientPostalAddress, isCompany, clientNeq,
    addressText, lat, lng,
    selectedCoverageType, roofType, slopeCategory, workType,
    roofCategory, buildingType, complexity, colorName,
    selectedMarque, selectedGamme, contactPreference,
    buildingGeojson, lotGeojson, noLot,
    superficie, perimetre, largeur, profondeur,
    mapParams, polygonAdj, lotAdj, streetViewState,
    measureTools: measureTools as any, mapAnnotations: mapAnnotations as any,
    effectiveAreaSqft,
    quoteNotes, paymentTerms, quoteHeaderFields,
    exclusionsList, exclusionsChecked,
    extraLines, hiddenLines: Array.from(hiddenLines),
    lineOverrides: lineOverrides as any,
    lineQbProducts: lineQbProducts as any,
    lineMeasureMappings: lineMeasureMappings as any,
    lineMajorations: lineMajorations as any,
    lineCategories: lineCategories as any,
    lineCostOverrides: lineCostOverrides as any,
    lineLaborTypes: lineLaborTypes as any,
    realCosts: realCosts as any,
    contractType, contractFields, contractInlineEdits,
    warrantyYears, warrantyCompletionDate, warrantyInvoice,
    warrantyContractAmount, warrantyIncludeConditions,
    pdfFiles, contactPhotoUrl, projectPhotoUrl, savedPlanUrl,
    manualMeasureMode,
    selectedQbCustomerId: selectedQbCustomer?.Id ?? null,
    useOwnerAsClient,
    roof3dMeasures, roof3dModel,
    previewConfirmed,
  }), [
    clientFirst, clientLast, clientEmail, clientPhone,
    clientCompany, clientPostalAddress, isCompany, clientNeq,
    addressText, lat, lng,
    selectedCoverageType, roofType, slopeCategory, workType,
    roofCategory, buildingType, complexity, colorName,
    selectedMarque, selectedGamme, contactPreference,
    buildingGeojson, lotGeojson, noLot,
    superficie, perimetre, largeur, profondeur,
    mapParams, polygonAdj, lotAdj, streetViewState,
    measureTools, mapAnnotations, effectiveAreaSqft,
    quoteNotes, paymentTerms, quoteHeaderFields,
    exclusionsList, exclusionsChecked,
    extraLines, hiddenLines,
    lineOverrides, lineQbProducts, lineMeasureMappings, lineMajorations,
    lineCategories, lineCostOverrides, lineLaborTypes, realCosts,
    contractType, contractFields, contractInlineEdits,
    warrantyYears, warrantyCompletionDate, warrantyInvoice,
    warrantyContractAmount, warrantyIncludeConditions,
    pdfFiles, contactPhotoUrl, projectPhotoUrl, savedPlanUrl,
    manualMeasureMode, selectedQbCustomer, useOwnerAsClient,
    roof3dMeasures, roof3dModel, previewConfirmed,
  ]);

  // Restore the v2 scoped localStorage draft on mount (and migrate legacy v1).
  // Runs once when FEATURE_AUTOSAVE is ON and we haven't already loaded a row from URL.
  useEffect(() => {
    if (!FEATURE_AUTOSAVE) return;
    if (draftRestoredRef.current) return;
    if (loadedId) { draftRestoredRef.current = true; return; }
    if (searchParams.get('id')) { draftRestoredRef.current = true; return; }
    try {
      let envelope: any = null;
      // Stratégie de récupération :
      //   1. Clé v2 pour le tmpId courant (cas where rare — fresh mount).
      //   2. Sinon, scan localStorage pour la plus récente clé `quote_draft_v2:new:*`
      //      (cas le plus fréquent : l'utilisateur recharge `/admin/quote` après un
      //      crash, donc un NOUVEAU tmpId est généré et l'ancien brouillon serait
      //      orphelin sans ce scan).
      //   3. Sinon, brouillon legacy v1 mobile (migration silencieuse).
      const currentKey = makeDraftKeyV2({ loadedId: null, tmpId: tmpDraftIdRef.current });
      let raw = localStorage.getItem(currentKey);
      if (raw) envelope = JSON.parse(raw);
      if (!envelope) {
        let mostRecent: { key: string; ts: number; env: any } | null = null;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith('quote_draft_v2:new:')) continue;
          try {
            const r = localStorage.getItem(k);
            if (!r) continue;
            const env = JSON.parse(r);
            const ts = typeof env?.saved_at === 'number' ? env.saved_at : 0;
            if (!mostRecent || ts > mostRecent.ts) mostRecent = { key: k, ts, env };
          } catch { /* ignore broken entries */ }
        }
        if (mostRecent) {
          envelope = mostRecent.env;
          // Adopt the recovered tmpId so the autosave keeps writing under the same scope.
          const m = mostRecent.key.match(/^quote_draft_v2:new:(.+)$/);
          if (m && m[1]) tmpDraftIdRef.current = m[1];
        }
      }
      // Migration silencieuse de l'ancien brouillon v1 → v2 (la première fois seulement).
      if (!envelope) {
        const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
        if (legacy) {
          try {
            const d = JSON.parse(legacy);
            envelope = { payload: d };
            // On garde la legacy key intacte au cas où l'utilisateur rétrograde le flag.
          } catch { /* noop */ }
        }
      }
      if (!envelope || !envelope.payload) { draftRestoredRef.current = true; return; }
      const p = envelope.payload;
      if (p.addressText) setAddressText(p.addressText);
      if (typeof p.lat === 'number') setLat(p.lat);
      if (typeof p.lng === 'number') setLng(p.lng);
      if (p.clientFirst) setClientFirst(p.clientFirst);
      if (p.clientLast) setClientLast(p.clientLast);
      if (p.clientEmail) setClientEmail(p.clientEmail);
      if (p.clientPhone) setClientPhone(p.clientPhone);
      if (p.clientCompany) setClientCompany(p.clientCompany);
      if (p.clientPostalAddress) setClientPostalAddress(p.clientPostalAddress);
      if (typeof p.isCompany === 'boolean') setIsCompany(p.isCompany);
      if (p.clientNeq) setClientNeq(p.clientNeq);
      if (p.workType) setWorkType(p.workType);
      if (p.roofType) setRoofType(p.roofType);
      if (p.slopeCategory) setSlopeCategory(p.slopeCategory);
      if (p.roofCategory) setRoofCategory(p.roofCategory);
      if (p.buildingType) setBuildingType(p.buildingType);
      if (p.complexity) setComplexity(p.complexity);
      if (p.colorName) setColorName(p.colorName);
      if (p.contactPreference) setContactPreference(p.contactPreference);
      if (p.selectedMarque) setSelectedMarque(p.selectedMarque);
      if (p.selectedGamme) setSelectedGamme(p.selectedGamme);
      if (typeof p.selectedCoverageType === 'string' && p.selectedCoverageType) {
        setSelectedCoverageType(p.selectedCoverageType);
      }
      if (p.buildingGeojson) setBuildingGeojson(p.buildingGeojson);
      if (p.lotGeojson) setLotGeojson(p.lotGeojson);
      if (p.noLot) setNoLot(p.noLot);
      if (typeof p.superficie === 'number') setSuperficie(p.superficie);
      if (typeof p.perimetre === 'number') setPerimetre(p.perimetre);
      if (typeof p.largeur === 'number') setLargeur(p.largeur);
      if (typeof p.profondeur === 'number') setProfondeur(p.profondeur);
      if (p.mapParams) setMapParams(p.mapParams);
      if (p.polygonAdj) setPolygonAdj(p.polygonAdj);
      if (p.lotAdj) setLotAdj(p.lotAdj);
      if (p.streetViewState && typeof p.streetViewState === 'object') {
        setStreetViewState(p.streetViewState as StreetViewState);
      }
      if (Array.isArray(p.measureTools) && p.measureTools.length > 0) {
        setMeasureTools(p.measureTools);
      }
      if (Array.isArray(p.mapAnnotations) && p.mapAnnotations.length > 0) {
        setMapAnnotations(p.mapAnnotations);
      }
      if (p.quoteNotes) setQuoteNotes(p.quoteNotes);
      if (p.paymentTerms) setPaymentTerms(p.paymentTerms);
      if (p.quoteHeaderFields) setQuoteHeaderFields(prev => ({ ...prev, ...p.quoteHeaderFields }));
      if (Array.isArray(p.exclusionsList)) setExclusionsList(p.exclusionsList);
      if (p.exclusionsChecked && typeof p.exclusionsChecked === 'object') setExclusionsChecked(p.exclusionsChecked);
      if (Array.isArray(p.extraLines)) setExtraLines(p.extraLines.map(ensureUid));
      if (Array.isArray(p.hiddenLines)) setHiddenLines(new Set(p.hiddenLines));
      if (p.lineOverrides && typeof p.lineOverrides === 'object') setLineOverrides(p.lineOverrides);
      if (p.lineQbProducts && typeof p.lineQbProducts === 'object') setLineQbProducts(p.lineQbProducts);
      if (p.lineMeasureMappings && typeof p.lineMeasureMappings === 'object') setLineMeasureMappings(p.lineMeasureMappings);
      if (p.lineMajorations && typeof p.lineMajorations === 'object') setLineMajorations(p.lineMajorations);
      if (p.lineCategories && typeof p.lineCategories === 'object') setLineCategories(p.lineCategories);
      if (p.lineCostOverrides && typeof p.lineCostOverrides === 'object') setLineCostOverrides(p.lineCostOverrides);
      if (p.lineLaborTypes && typeof p.lineLaborTypes === 'object') setLineLaborTypes(p.lineLaborTypes);
      if (p.realCosts && typeof p.realCosts === 'object') setRealCosts(p.realCosts);
      if (p.contractType) setContractType(p.contractType);
      if (p.contractFields) setContractFields(prev => ({ ...prev, ...p.contractFields }));
      if (p.contractInlineEdits) setContractInlineEdits(p.contractInlineEdits);
      if (typeof p.warrantyYears === 'number') setWarrantyYears(p.warrantyYears);
      if (typeof p.warrantyCompletionDate === 'string') setWarrantyCompletionDate(p.warrantyCompletionDate);
      if (typeof p.warrantyInvoice === 'string') setWarrantyInvoice(p.warrantyInvoice);
      if (typeof p.warrantyContractAmount === 'string') setWarrantyContractAmount(p.warrantyContractAmount);
      if (typeof p.warrantyIncludeConditions === 'boolean') setWarrantyIncludeConditions(p.warrantyIncludeConditions);
      if (Array.isArray(p.pdfFiles)) setPdfFiles(p.pdfFiles);
      if (typeof p.contactPhotoUrl === 'string') setContactPhotoUrl(p.contactPhotoUrl);
      if (typeof p.projectPhotoUrl === 'string') setProjectPhotoUrl(p.projectPhotoUrl);
      if (typeof p.savedPlanUrl === 'string') setSavedPlanUrl(p.savedPlanUrl);
      if (typeof p.manualMeasureMode === 'boolean') setManualMeasureMode(p.manualMeasureMode);
      if (typeof p.useOwnerAsClient === 'boolean') setUseOwnerAsClient(p.useOwnerAsClient);
      if (p.roof3dMeasures) setRoof3dMeasures(p.roof3dMeasures);
      if (p.roof3dModel) setRoof3dModel(p.roof3dModel);
      if (p.previewConfirmed) setPreviewConfirmed(prev => ({ ...prev, ...p.previewConfirmed }));
      toast.success('Brouillon restauré', { description: 'Vos modifications ont été récupérées.' });
    } catch (e) {
      console.warn('[Vague A] draft restore failed:', e);
    }
    draftRestoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continuous v2 draft write (scoped by id|tmpId). Survives crashes/reloads on
  // BOTH desktop and mobile. Cleared on adopt/loaded/manual save.
  useEffect(() => {
    if (!FEATURE_AUTOSAVE) return;
    if (!draftRestoredRef.current) return;
    const t = setTimeout(() => {
      try {
        const snap = buildSnapshotV2();
        const key = makeDraftKeyV2({ loadedId, tmpId: tmpDraftIdRef.current });
        if (!snapshotHasContentV2(snap)) {
          try { localStorage.removeItem(key); } catch { /* noop */ }
          return;
        }
        const env = buildLocalDraftEnvelopeV2(snap, { loadedId, tmpId: tmpDraftIdRef.current });
        const size = envelopeByteSizeV2(env);
        if (size > QUOTE_DRAFT_MAX_BYTES) {
          // Trop gros pour localStorage → on n'écrit pas, IndexedDB prendra le relais
          // via la file d'attente quand un autosave Supabase échouera.
          console.warn(`[Vague A] draft envelope ${(size / 1024).toFixed(0)} KB exceeds cap; skipping localStorage`);
          return;
        }
        localStorage.setItem(key, JSON.stringify(env));
      } catch (e) {
        console.warn('[Vague A] draft write failed:', e);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [buildSnapshotV2, loadedId]);

  // Clear v2 draft once we are bound to a Supabase id and Supabase has the latest.
  useEffect(() => {
    if (!FEATURE_AUTOSAVE) return;
    if (!loadedId) return;
    // We keep the row-scoped key alive (it's specific to this id) but remove
    // the "new:<tmp>" key in case the user just adopted the row right now.
    try {
      localStorage.removeItem(makeDraftKeyV2({ loadedId: null, tmpId: tmpDraftIdRef.current }));
    } catch { /* noop */ }
  }, [loadedId]);

  // Supabase executor for useQuoteAutosave. Builds the row from the snapshot,
  // sends it through `soumissions.update` or `soumissions.insert`. Returns the
  // contract expected by the offline-queue executor.
  const executeAutosaveV2 = useCallback(async (
    kind: 'insert' | 'update',
    id: string | null,
    payload: Record<string, unknown>,
  ) => {
    try {
      if (kind === 'update' && id) {
        // Cast aligné sur handleSave (payload typé comme `any` côté legacy car
        // les colonnes JSONB et les champs optionnels ne satisfont pas le
        // type généré). On garde le même contrat de lecture/écriture.
        const { error } = await supabase.from('soumissions').update(payload as any).eq('id', id);
        if (error) {
          console.warn('[Vague A] autosave update failed:', error);
          return { ok: false as const };
        }
        return { ok: true as const };
      }
      const insertPayload = { ...payload, status: 'new' } as any;
      const res = await supabase
        .from('soumissions')
        .insert(insertPayload)
        .select('id, seq_number')
        .single();
      if (res.error) {
        console.warn('[Vague A] autosave insert failed:', res.error);
        return { ok: false as const };
      }
      const newId = (res.data as any)?.id || null;
      if ((res.data as any)?.seq_number) setLoadedSeqNumber((res.data as any).seq_number);
      return { ok: true as const, newId };
    } catch (e) {
      console.warn('[Vague A] autosave executor threw:', e);
      return { ok: false as const };
    }
  }, []);

  // Cheap content gate — recomputed via useMemo on the same deps as the snapshot
  // so we only trigger the autosave when something actually changed.
  const autosaveHasContent = useMemo(() => {
    if (!FEATURE_AUTOSAVE) return false;
    return snapshotHasContentV2(buildSnapshotV2());
  }, [buildSnapshotV2]);
  const autosave = useQuoteAutosave({
    enabled: FEATURE_AUTOSAVE,
    soumissionId: loadedId,
    online: onlineV2,
    isManualSaving: saving,
    hasContent: autosaveHasContent,
    // `buildSnapshotV2` is memoized on the underlying state deps — it only
    // changes when something the user actually edited changes. We use it as
    // the trigger so the debounce timer doesn't reset on every render.
    trigger: buildSnapshotV2,
    buildPayload: () => {
      if (!FEATURE_AUTOSAVE) return null;
      return buildDraftPayloadV2(buildSnapshotV2());
    },
    executeSave: executeAutosaveV2,
    onAdoptNewId: adoptSoumissionId,
  });

  // ── Vague A : upload immédiat du plan manuel ──
  // Auparavant, le plan dessiné n'était envoyé qu'au Save (handleSave:~3717), donc un
  // crash entre le dessin et le Save = plan perdu (L14). Sous flag, on l'upload dès
  // que planImageDataUrl est défini et on stocke l'URL signée dans savedPlanUrl ;
  // handleSave est ensuite no-op pour ce blob (déjà uploadé). Aucun effet quand le
  // flag est OFF.
  const planUploadInFlightRef = useRef<string | null>(null);
  useEffect(() => {
    if (!FEATURE_AUTOSAVE) return;
    if (!planImageDataUrl) return;
    if (savedPlanUrl) return; // Déjà uploadé
    if (planUploadInFlightRef.current === planImageDataUrl) return;
    planUploadInFlightRef.current = planImageDataUrl;
    (async () => {
      try {
        const blob = await (await fetch(planImageDataUrl)).blob();
        const fileName = `plan_${Date.now()}.jpg`;
        const storagePath = `plans/${fileName}`;
        const { error: uploadErr } = await supabase.storage
          .from('quote-pdfs')
          .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: true });
        if (!uploadErr) {
          const signed = await getSignedQuotePdfUrl(storagePath);
          if (signed) setSavedPlanUrl(signed);
        }
      } catch (e) {
        console.warn('[Vague A] immediate plan upload failed:', e);
      } finally {
        if (planUploadInFlightRef.current === planImageDataUrl) {
          planUploadInFlightRef.current = null;
        }
      }
    })();
  }, [planImageDataUrl, savedPlanUrl]);

  // Valeurs résolues pour la palette de variables (utilisées par SmartTextEditor)
  const quoteVarValues = useMemo(() => buildQuoteValues({
    clientFirst, clientLast, clientCompany, clientEmail, clientPhone,
    addressText,
    selectedMarque, selectedGamme,
    coverageType: selectedCoverageType, slopeCategory,
    effectiveAreaSqft, perimeterFt: effectivePerimeterFt,
    subtotal: finalQuote?.subtotal_displayed,
    total: finalQuote?.total_final,
    loadedSeqNumber,
  }), [clientFirst, clientLast, clientCompany, clientEmail, clientPhone, addressText, selectedMarque, selectedGamme, selectedCoverageType, slopeCategory, effectiveAreaSqft, effectivePerimeterFt, finalQuote, loadedSeqNumber]);

  // ── Champs manquants & complétion par section ─────────────────────────
  const [flashFieldId, setFlashFieldId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const flashField = useCallback((id: string, sectionNumber: number = 1) => {
    // Si la section parente est repliée, on déplie d'abord.
    setCollapsedSections(prev => ({ ...prev, [sectionNumber]: false }));
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    setFlashFieldId(id);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashFieldId(null), 2000);
  }, []);

  const flashStyle = (id: string): React.CSSProperties =>
    flashFieldId === id
      ? { animation: 'fieldFlash 0.45s ease-in-out 4', borderRadius: 8 }
      : {};

  // Panneau réutilisable « Champs à compléter » pour n'importe quelle section.
  const MissingFieldsPanel: React.FC<{ section: number }> = ({ section }) => {
    const list = sectionChecklists[section];
    if (!list) return null;
    const missingCount = list.filter(f => !f.filled).length;
    const filledCount = list.length - missingCount;
    const allFilled = missingCount === 0;
    return (
      <div style={{
        marginTop: 14, padding: '12px 14px', borderRadius: 10,
        background: allFilled ? 'rgba(34,197,94,0.06)' : 'rgba(251,191,36,0.05)',
        border: '1px solid ' + (allFilled ? 'rgba(34,197,94,0.45)' : 'rgba(251,191,36,0.25)'),
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: allFilled ? '#22c55e' : '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          {allFilled ? <Check size={13} strokeWidth={3} /> : <AlertTriangle size={13} />} Champs ({filledCount}/{list.length} complétés)
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {list.map(f => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => flashField(f.id, section)}
                style={{
                  width: '100%', textAlign: 'left',
                  background: f.filled ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.03)',
                  border: '1px solid ' + (f.filled ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)'),
                  color: f.filled ? '#86efac' : '#e5e7eb', fontSize: 12,
                  textDecoration: f.filled ? 'line-through' : 'none',
                  padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  const bg = f.filled ? 'rgba(34,197,94,0.14)' : 'rgba(251,191,36,0.10)';
                  const bc = f.filled ? 'rgba(34,197,94,0.5)'  : 'rgba(251,191,36,0.4)';
                  (e.currentTarget as HTMLButtonElement).style.background = bg;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = bc;
                }}
                onMouseLeave={e => {
                  const bg = f.filled ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.03)';
                  const bc = f.filled ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)';
                  (e.currentTarget as HTMLButtonElement).style.background = bg;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = bc;
                }}
              >
                {f.filled
                  ? <Check size={12} style={{ color: '#22c55e', flexShrink: 0 }} strokeWidth={3} />
                  : <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fbbf24', flexShrink: 0 }} />}
                {f.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  type FieldCheck = { id: string; label: string; filled: boolean };
  const sectionChecklists: Record<number, FieldCheck[]> = {
    1: [
      { id: 'field-address', label: "Adresse de l'immeuble", filled: !!addressText && !!lat && !!lng },
      { id: 'field-building', label: 'Bâtiment confirmé sur la carte', filled: !!buildingGeojson },
      ...(isCompany
        ? [{ id: 'field-client-company', label: "Nom de l'entreprise", filled: !!clientCompany.trim() }]
        : [
            { id: 'field-client-first', label: 'Prénom du client', filled: !!clientFirst.trim() },
            { id: 'field-client-last', label: 'Nom du client', filled: !!clientLast.trim() },
          ]),
      { id: 'field-client-email', label: 'Courriel du client', filled: !!clientEmail.trim() },
      { id: 'field-client-phone', label: 'Téléphone du client', filled: !!clientPhone.trim() },
      { id: 'field-client-postal', label: 'Adresse postale du client', filled: !!clientPostalAddress.trim() },
    ],
    2: [
      { id: 'field-coverage', label: 'Type de couverture', filled: !!selectedCoverageType },
      { id: 'field-marque', label: 'Marque du produit', filled: !!selectedMarque },
      { id: 'field-gamme', label: 'Gamme du produit', filled: !!selectedGamme },
      { id: 'field-roof-type', label: 'Type de toit', filled: !!roofType },
      { id: 'field-slope', label: 'Pente du toit', filled: !!slopeCategory && slopeCategory !== ('aucune' as any) },
      { id: 'field-work-type', label: 'Type de travaux', filled: !!workType },
    ],
    3: [
      { id: 'field-area', label: 'Superficie au sol mesurée', filled: effectiveAreaSqft > 0 },
    ],
    4: (() => {
      if (!finalQuote) return [{ id: 'field-final-quote', label: 'Soumission calculée', filled: false }];
      const lines = (finalQuote as any).lines || [];
      const visibleLines = lines.filter((_l: any, i: number) => !hiddenLines[i]);
      const linesWithQb = visibleLines.filter((_l: any, i: number) => !!lineQbProducts[i]);
      return [
        { id: 'field-qbo-products', label: 'Tous les postes ont un produit QuickBooks lié', filled: visibleLines.length > 0 && linesWithQb.length === visibleLines.length },
        { id: 'field-total', label: 'Total > 0 $', filled: (finalQuote.total_final || 0) > 0 },
      ];
    })(),
    5: [
      { id: 'field-preview-header', label: 'EN-TÊTE DU PROJET confirmé', filled: previewConfirmed.header },
      { id: 'field-preview-notes', label: 'NOTES DU DEVIS confirmées', filled: previewConfirmed.notes },
      { id: 'field-preview-terms', label: 'MODALITÉS DE PAIEMENT confirmées', filled: previewConfirmed.terms },
      { id: 'field-preview-exclusions', label: 'INCLUSIONS / EXCLUSIONS confirmées', filled: previewConfirmed.exclusions },
      { id: 'field-preview-qbo-push', label: 'Soumission poussée vers QuickBooks', filled: !!qbPushResult?.success },
    ],
    6: [
      { id: 'field-email-sent', label: 'Soumission envoyée au client par courriel', filled: !!emailSendResult?.ok },
    ],
    7: [
      { id: 'field-contract-type', label: 'Modèle de contrat sélectionné', filled: !!contractType },
      { id: 'field-contract-date', label: 'Date du contrat', filled: !!contractFields.contractDate?.trim() },
      { id: 'field-contract-start', label: 'Date de début prévue', filled: !!contractFields.startDate?.trim() },
      { id: 'field-contract-email', label: 'Courriel', filled: !!contractFields.clientEmail?.trim() },
      { id: 'field-contract-phone', label: 'Téléphone', filled: !!contractFields.clientPhone?.trim() },
      { id: 'field-contract-workaddress', label: 'Adresse des travaux', filled: !!contractFields.workAddress?.trim() },
      { id: 'field-contract-devisno', label: 'No. de devis', filled: !!contractFields.devisNo?.trim() },
      { id: 'field-contract-duration', label: 'Durée estimée (jours)', filled: !!contractFields.durationDays && Number(contractFields.durationDays) > 0 },
      { id: 'field-contract-amount', label: 'Montant total', filled: contractType === 'forfaitaire'
          ? !!contractFields.prixForfaitaire && Number(contractFields.prixForfaitaire) > 0
          : contractType === 'budgetaire'
            ? !!contractFields.budgetTotal && Number(contractFields.budgetTotal) > 0
            : !!contractFields.estimationInitiale && Number(contractFields.estimationInitiale) > 0 },
    ],
  };
  const sectionPct = (n: number): number | null => {
    const list = sectionChecklists[n];
    if (!list || list.length === 0) return null; // pas de checklist → pas de badge
    const filled = list.filter(f => f.filled).length;
    return Math.round((filled / list.length) * 100);
  };

  return (
    <div className="aqg-root" style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '12px 8px 80px' : '16px 12px 60px' }}>
      {/* Keyframes pour le flash jaune des champs manquants + scope mobile anti-iOS-zoom.
          On force font-size: 16px sur tous les inputs/selects/textareas du composant
          sur mobile : sinon le module-level inputStyle (fontSize: 13) et plusieurs
          overrides inline (fontSize 9-10) déclenchent un zoom automatique iOS au
          focus, rendant la saisie impossible. La table Tool Config (qui a des
          colonnes très étroites avec fontSize 9) reste de toute façon peu
          utilisable sur petit écran et le bump à 16 ne casse pas plus que ce qui
          est déjà désagréable. */}
      <style>{`
        @keyframes fieldFlash { 0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,0); } 50% { box-shadow: 0 0 0 4px rgba(251,191,36,0.85); } }
        /* Vague A2.1 — pulse de l'icône Bot pour signaler "rempli par IA".
           Indigo principal du portail (#a5b4fc / rgba(99,102,241,X)). */
        @keyframes botPulse {
          0%,100% {
            opacity: 0.75;
            filter: drop-shadow(0 0 2px #a5b4fc) drop-shadow(0 0 4px rgba(99,102,241,0.5));
          }
          50% {
            opacity: 1;
            filter: drop-shadow(0 0 4px #a5b4fc) drop-shadow(0 0 10px rgba(99,102,241,0.9));
          }
        }
        @media (max-width: 600px) {
          .aqg-root input, .aqg-root select, .aqg-root textarea { font-size: 16px !important; }
        }
      `}</style>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
            <Calculator size={16} style={{ verticalAlign: -3, marginRight: 6, color: '#a5b4fc' }} />
            Générateur de soumission
            {loadedSeqNumber && (
              <span style={{ marginLeft: 12, fontSize: 22, fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace', letterSpacing: 1 }}>
                #{loadedSeqNumber}
              </span>
            )}
          </h1>
          {FEATURE_AUTOSAVE ? (
            // Vague A : ligne « mode administrateur » + indicateur d'autosave.
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
                {loadedSeqNumber ? `Soumission #${loadedSeqNumber} chargée` : 'Mode administrateur'}
              </p>
              <SaveStatusIndicator
                status={autosave.status}
                lastSavedAt={autosave.lastSavedAt}
                online={onlineV2}
                pendingCount={autosave.pendingCount}
                compact={isMobile}
              />
            </div>
          ) : (
            <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
              {loadedSeqNumber ? `Soumission #${loadedSeqNumber} chargée` : 'Mode administrateur'}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          <button onClick={() => setShowLoadPanel(!showLoadPanel)} style={{ ...topBtnStyle(showLoadPanel), padding: isMobile ? '12px 16px' : '6px 10px', fontSize: isMobile ? 14 : 11, minHeight: isMobile ? 44 : undefined, touchAction: 'manipulation' }}>
            <FolderOpen size={isMobile ? 16 : 12} /> Charger
          </button>
          <button onClick={resetForm} style={{ ...topBtnStyle(false), padding: isMobile ? '12px 16px' : '6px 10px', fontSize: isMobile ? 14 : 11, minHeight: isMobile ? 44 : undefined, touchAction: 'manipulation' }}>
            <RefreshCw size={isMobile ? 16 : 12} /> Nouveau
          </button>
        </div>
      </div>

      {/* ── Load soumission panel ── */}
      {showLoadPanel && (
        <div style={{ ...sectionStyle, marginBottom: 20, borderColor: 'rgba(99,102,241,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionTitle icon={<FolderOpen size={14} />} title="Soumissions sauvegardées" />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => setShowArchived(v => !v)}
                style={{
                  background: showArchived ? 'rgba(245,158,11,0.15)' : 'transparent',
                  border: '1px solid ' + (showArchived ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)'),
                  color: showArchived ? '#fbbf24' : '#9ca3af',
                  cursor: 'pointer', fontSize: 11, padding: '4px 10px', borderRadius: 6,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
                title={showArchived ? 'Voir les soumissions actives' : 'Voir les archives'}
              >
                <Archive size={12} /> {showArchived ? 'Archives' : 'Voir archives'}
              </button>
              <button onClick={fetchSavedSoumissions} style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11 }}>
                <RefreshCw size={12} /> Rafraîchir
              </button>
            </div>
          </div>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#4b5563' }} />
            <input value={loadSearch} onChange={e => setLoadSearch(e.target.value)}
              placeholder="Rechercher par nom, adresse ou numéro..."
              style={{ ...numInputStyle, paddingLeft: 32, width: '100%' }} />
          </div>
          {loadingList ? (
            <div style={{ color: '#6b7280', fontSize: 12, padding: 20, textAlign: 'center' }}>Chargement…</div>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: isMobile ? 'auto' : undefined, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: isMobile ? 600 : undefined }}>
                <thead>
                  <tr style={{ background: 'rgba(25,25,50,0.8)', position: 'sticky', top: 0 }}>
                    <th style={thSt}>#</th>
                    <th style={thSt}>Client</th>
                    <th style={thSt}>Adresse</th>
                    <th style={{ ...thSt, textAlign: 'right' }}>Total</th>
                    <th style={thSt}>Statut</th>
                    <th style={{ ...thSt, textAlign: 'right' }}>Date</th>
                    <th style={{ ...thSt, width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSoumissions.map(s => (
                    <tr key={s.id}
                      onClick={() => loadSoumission(s)}
                      style={{ borderTop: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...tdSt, color: '#a5b4fc', fontWeight: 600 }}>{s.seq_number}</td>
                      <td style={{ ...tdSt, color: '#d1d5db', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.first_name} {s.last_name}</td>
                      <td style={{ ...tdSt, color: '#9ca3af', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.formatted_address?.split(',').slice(0, 2).join(',') || '—'}
                      </td>
                      <td style={{ ...tdSt, textAlign: 'right', color: '#34d399', fontWeight: 600, fontFamily: 'monospace' }}>
                        {s.high_estimate ? fmt(s.high_estimate) : '—'}
                      </td>
                      <td style={tdSt}>
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ ...tdSt, textAlign: 'right', color: '#6b7280', fontSize: 10 }}>
                        {new Date(s.created_at).toLocaleDateString('fr-CA')}
                      </td>
                      <td style={{ ...tdSt, textAlign: 'center' }}>
                        <button
                          onClick={(e) => toggleArchiveSoumission(s, e)}
                          title={s.status === 'archived' ? 'Désarchiver' : 'Archiver'}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: s.status === 'archived' ? '#34d399' : '#9ca3af',
                            padding: 4, borderRadius: 4, display: 'inline-flex',
                          }}
                        >
                          {s.status === 'archived' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredSoumissions.length === 0 && (
                    <tr><td colSpan={7} style={{ ...tdSt, textAlign: 'center', color: '#9ca3af', padding: 20 }}>Aucune soumission trouvée</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {loadedId && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', fontSize: 11, color: '#a5b4fc' }}>
              ✓ Soumission chargée — Modifiez les paramètres puis sauvegardez ou générez le PDF
            </div>
          )}
        </div>
      )}

      {/* ── Compact address + metrics banner ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16, padding: '14px 18px', background: 'linear-gradient(135deg, rgba(20,20,50,0.8), rgba(15,15,40,0.6))', borderRadius: 12, border: '1px solid rgba(99,102,241,0.15)' }}>
        <div style={{ flex: isMobile ? '1 1 100%' : 1, minWidth: isMobile ? '100%' : 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#e2e8f0', letterSpacing: 0.5, whiteSpace: isMobile ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {addressText ? addressText.split(',')[0] : 'Aucune adresse'}
          </div>
          {addressText && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {addressText.split(',').slice(1).join(',').trim()}
            </div>
          )}
        </div>
        {/* Inline metrics */}
        <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Superficie</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace' }}>
              {superficie ? `${Math.round(superficie * 10.7639).toLocaleString('fr-CA')}` : '—'}
            </div>
            <div style={{ fontSize: 8, color: '#6b7280' }}>pi²</div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.08)', alignSelf: 'stretch' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Périmètre</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace' }}>
              {perimetre ? `${Math.round(perimetre * 3.28084).toLocaleString('fr-CA')}` : '—'}
            </div>
            <div style={{ fontSize: 8, color: '#6b7280' }}>pi</div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.08)', alignSelf: 'stretch' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dimensions</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace' }}>
              {largeur && profondeur ? `${(largeur * 3.28084).toFixed(0)}'×${(profondeur * 3.28084).toFixed(0)}'` : '—'}
            </div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,0.08)', alignSelf: 'stretch' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>Lot</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: noLot ? '#60a5fa' : '#6b7280', fontFamily: 'monospace' }}>
              {noLot || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Photo du projet (à l'extérieur, au-dessus de l'étape 1) ── */}
      <ProjectPhotoPanel
        large
        value={projectPhotoUrl}
        onChange={setProjectPhotoUrl}
        documents={pdfFiles}
        onUploadedToDocs={(f) => setPdfFiles(prev => [...prev, f])}
      />

      {/* ═══════════════ SECTION 1: INFORMATIONS DU PROJET ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<MapPin size={20} />} title="Informations du projet" number={1} collapsed={!!collapsedSections[1]} onToggle={() => toggleSection(1)} completion={sectionPct(1)} onCompletionClick={() => setOpenedMissingFor(p => p === 1 ? null : 1)} missingOpen={openedMissingFor === 1} />
        {openedMissingFor === 1 && <MissingFieldsPanel section={1} />}
      <div style={{ display: collapsedSections[1] ? 'none' : 'block' }}>
      {/* Vague A2.2 — Zone de saisie du lot + diagnostic de précision +
          bouton « Pipeline détection » (carte + étapes). Toujours rendu
          (indépendant du flag autofill) : c'est le cœur de la localisation. */}
      <LotDiagnosticPanel
        noLot={noLot}
        onNoLotChange={(v) => setNoLot(v)}
        lotManual={lotManual}
        onLotManualChange={setLotManual}
        buildingPhase={buildingPhase}
        lotDistanceM={lotDistanceM}
        lat={lat}
        lng={lng}
        addressText={addressText || null}
        buildingGeojson={buildingGeojson}
        lotGeojson={lotGeojson}
        mapParams={mapParams}
        polygonAdj={polygonAdj}
        superficie={superficie}
        perimetre={perimetre}
        largeur={largeur}
        profondeur={profondeur}
        yearBuilt={yearBuilt}
        dwellingCount={dwellingCount}
        floorCount={floorCount}
        mamhDataSource={mamhDataSource}
        autofillEnabled={AUTOFILL_ENABLED}
        apiKey={GOOGLE_API_KEY}
        isMobile={isMobile}
        onOpenTakeoff={() => setTakeoffOpen(true)}
        mamhSlot={AUTOFILL_ENABLED ? (
          <AutofillCoordinator
            lat={lat}
            lng={lng}
            noLot={noLot}
            addressText={addressText || null}
            satelliteImageUrl={null /* l'image satellite est capturée plus tard, pas critique pour A2 */}
            currentValues={{
              year_built: yearBuilt,
              dwelling_count: dwellingCount,
              floor_count: floorCount,
              roofType,
              slopeCategory,
              complexity: (complexity || null) as never,
              coverageType: selectedCoverageType || null,
              productBrand: selectedMarque || null,
              productName: selectedGamme || null,
              workType: workType || null,
            }}
            onSetYearBuilt={(v) => { setYearBuilt(v); markAutoFilled('year_built'); }}
            onSetDwellingCount={(v) => {
              setDwellingCount(v);
              markAutoFilled('dwelling_count');
              // Vague A2.1 — Déduction Catégorie/Bâtiment depuis nb_logements
              // (règles métier Québec). N'override pas si l'utilisateur a
              // déjà choisi manuellement (= field absent de autoFilledFields
              // mais avec valeur non-default).
              if (!buildingType || autoFilledFields.has('buildingType')) {
                let bt: string | null = null;
                if (v === 1) bt = 'unifamiliale';
                else if (v === 2) bt = 'duplex';
                else if (v === 3) bt = 'triplex';
                else if (v && v >= 4) bt = 'multiplex';
                if (bt) { setBuildingType(bt); markAutoFilled('buildingType'); }
              }
              // roofCategory reste 'residential' par défaut (le plus commun).
              // On marque comme auto si on a touché à buildingType.
              if (!autoFilledFields.has('roofCategory') && roofCategory === 'residential') {
                markAutoFilled('roofCategory');
              }
            }}
            onSetFloorCount={(v) => { setFloorCount(v); markAutoFilled('floor_count'); }}
            onSetMamhDataSource={(v) => setMamhDataSource(v)}
            onSetRoofType={(v) => { setRoofType(v); markAutoFilled('roofType'); }}
            onSetSlopeCategory={(v) => { setSlopeCategory(v); markAutoFilled('slopeCategory'); }}
            onSetComplexity={(v) => { setComplexity(v); markAutoFilled('complexity'); }}
            onSeedFromSolar={(roofModel) => {
              // Étape 3 du plan A2 : seed le tracer avec un RoofModel Solar.
              // setRoof3dModel + setTakeoffOpen ouvre le TakeoffFullscreen
              // existant avec `initialModel={roof3dModel}` (ligne ~8161).
              setRoof3dModel(roofModel);
              setTakeoffOpen(true);
            }}
            onAutoFetchOwner={(lotNum) => {
              // Vague A2.1 — auto-trigger du lookup propriétaire dès que
              // Run est cliqué. Évite à l'utilisateur d'avoir à cliquer
              // manuellement "Rechercher le propriétaire". Si un fetch
              // est déjà en cours ou si on a déjà des résultats pour ce
              // lot, on ne re-fetch pas.
              if (ownerLoading) return;
              if (ownerList.length > 0) return;
              fetchOwner(lotNum);
            }}
          />
        ) : null}
      />
      {/* Vague A2.1 — Restauration de la grille 2-cols (Adresse | Client) pour
          ne pas étirer la map. La section "Caractéristiques du bâtiment" passe
          en dessous, full width. Si tu veux un autre ordre, dis-le et je
          peux remonter ce bloc au-dessus de la grille. */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
        {/* LEFT: Address */}
        <div style={sectionStyle}>
          <SectionTitle icon={<MapPin size={14} />} title="Adresse de l'immeuble" />
          <div id="field-address" style={{ position: 'relative', ...flashStyle('field-address') }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#4b5563' }} />
            <input
              ref={addressInputRef}
              value={addressText}
              onChange={e => {
                const value = e.target.value;
                setAddressText(value);
                setLat(null); setLng(null);
                setBuildingGeojson(null); setLotGeojson(null); setNoLot(null); setYearBuilt(null); setDwellingCount(null); setFloorCount(null); setMamhDataSource(null); setAutoFilledFields(new Set());
                setSuperficie(null); setPerimetre(null); setLargeur(null); setProfondeur(null);
                setLotDistanceM(null); setLotManual(false);
                setBuildingPhase('idle');
                setMapParams({ zoom: 19, centerLat: 0, centerLng: 0 });
                setOwnerList([]); setSelectedOwnerIdxs([0]);
                setOwnerError(null); setOwnerLoading(false); setUseOwnerAsClient(false);
                resetMeasurements();
              }}
              placeholder="Rechercher une adresse..."
              style={{ ...numInputStyle, paddingLeft: 32, width: '100%' }}
            />
          </div>
          {lat && lng && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 10 }}>
              {[18, 19, 20].map(z => (
                <div key={z} onClick={() => setLightboxUrl(buildSatUrl(lat!, lng!, z, '640x640'))}
                  style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', position: 'relative', cursor: 'pointer', transition: 'border-color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}>
                  <img src={buildSatUrl(lat, lng, z)} alt={`z${z}`} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} loading="lazy" />
                  <Maximize2 size={10} style={{ position: 'absolute', top: 3, right: 3, color: '#fff', opacity: 0.6 }} />
                  <span style={{ position: 'absolute', bottom: 2, right: 3, background: 'rgba(0,0,0,0.7)', borderRadius: 3, padding: '1px 4px', fontSize: 8, color: '#9ca3af' }}>z{z}</span>
                </div>
              ))}
            </div>
          )}
          {lightboxUrl && (
            <div onClick={() => setLightboxUrl(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
              <img src={lightboxUrl} alt="Vue satellite agrandie" referrerPolicy="no-referrer"
                onClick={e => e.stopPropagation()}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                style={{ width: 'min(90vw, 90vh, 640px)', height: 'auto', objectFit: 'contain', borderRadius: 12, border: '2px solid rgba(255,255,255,0.15)', boxShadow: '0 20px 60px rgba(0,0,0,0.8)', background: '#111' }} />
              <button onClick={() => setLightboxUrl(null)} aria-label="Fermer la vue agrandie" style={{ position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', right: 'max(20px, env(safe-area-inset-right))', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, color: '#fff', width: 44, height: 44, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          )}
          {lat && lng && addressLoaded && (
            <StreetViewAnnotator
              lat={lat}
              lng={lng}
              apiKey={GOOGLE_API_KEY}
              ready={addressLoaded}
              onCapture={uploadDocBlob}
              initialView={streetViewState}
              onViewChange={setStreetViewState}
            />
          )}
        </div>

        {/* RIGHT: Client */}
        <div style={sectionStyle}>
          <SectionTitle icon={<User size={14} />} title="Client" />

            {/* QB Customer selector */}
            {qbCustomers.length > 0 && (
              <div style={{ marginBottom: 12, position: 'relative' }}>
                <label style={labelStyle}>Client QuickBooks existant</label>
                <div style={{ position: 'relative' }}
                  onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTimeout(() => setShowQbDropdown(false), 150); }}
                >
                  <input
                    value={selectedQbCustomer ? selectedQbCustomer.DisplayName : qbCustomerSearch}
                    onChange={e => { setQbCustomerSearch(e.target.value); setShowQbDropdown(true); setSelectedQbCustomer(null); }}
                    onFocus={() => setShowQbDropdown(true)}
                    placeholder="Rechercher un client QB..."
                    style={{ ...numInputStyle, width: '100%', paddingRight: 30, borderColor: selectedQbCustomer ? 'rgba(52,211,153,0.4)' : undefined }}
                  />
                  {selectedQbCustomer && (
                    <button onClick={() => { setSelectedQbCustomer(null); setQbCustomerSearch(''); }}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  )}
                </div>
                {showQbDropdown && !selectedQbCustomer && (
                  <div onClick={() => setShowQbDropdown(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                )}
                {showQbDropdown && !selectedQbCustomer && (
                  <div style={{
                    position: 'absolute', zIndex: 50, width: '100%', maxHeight: 220, overflowY: 'auto',
                    background: 'rgba(15,15,35,0.98)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, marginTop: 2, boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                  }}>
                    {filteredQbCustomers.length === 0 ? (
                      <div style={{ padding: '12px 14px', fontSize: 11, color: '#6b7280' }}>Aucun client trouvé</div>
                    ) : filteredQbCustomers.map((c: any) => (
                      <div key={c.Id} onMouseDown={(e) => { e.preventDefault(); selectQbCustomer(c); }}
                        style={{
                          padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.15)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>{c.DisplayName}</div>
                        <div style={{ fontSize: 10, color: '#6b7280' }}>
                          {c.CompanyName ? `${c.CompanyName} · ` : ''}
                          {c.PrimaryEmailAddr?.Address || ''}{c.PrimaryPhone?.FreeFormNumber ? ` · ${c.PrimaryPhone.FreeFormNumber}` : ''}
                        </div>
                      </div>
                    ))}
                    <div onClick={() => setShowQbDropdown(false)}
                      style={{ padding: '6px 14px', fontSize: 10, color: '#4b5563', textAlign: 'center', cursor: 'pointer' }}>Fermer</div>
                  </div>
                )}
                {selectedQbCustomer && (
                  <div style={{ fontSize: 10, color: '#34d399', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={10} /> Client QB sélectionné
                  </div>
                )}
              </div>
            )}

            {/* Owner lookup result */}
            {noLot && !ownerLoading && ownerList.length === 0 && (
              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    const cleanLot = (noLot || '').replace(/\s/g, '');
                    if (cleanLot) fetchOwner(cleanLot);
                  }}
                  style={{
                    padding: '8px 14px', borderRadius: 8,
                    background: 'rgba(99,102,241,0.12)',
                    border: '1px solid rgba(99,102,241,0.35)',
                    color: '#a5b4fc', fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                    letterSpacing: 0.4, textTransform: 'uppercase',
                  }}
                >
                  <Search size={13} /> Rechercher le propriétaire (lot {noLot})
                </button>
              </div>
            )}
            {ownerLoading && (
              <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', fontSize: 11, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Recherche du propriétaire…
              </div>
            )}
            {ownerList.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{
                  padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)',
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                    {ownerList.length > 1 ? `${ownerList.length} propriétaires trouvés — cliquez pour sélectionner` : 'Propriétaire trouvé'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {ownerList.map((o, i) => {
                      const isSelected = selectedOwnerIdxs.includes(i);
                      return (
                        <div
                          key={i}
                          onClick={() => ownerList.length > 1 ? toggleOwnerIdx(i) : null}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: isSelected ? '2px solid #34d399' : '1px solid rgba(255,255,255,0.08)',
                            background: isSelected ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.02)',
                            cursor: ownerList.length > 1 ? 'pointer' : 'default',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {ownerList.length > 1 && (
                              <div style={{
                                width: 18, height: 18, borderRadius: 4,
                                border: isSelected ? '2px solid #34d399' : '2px solid rgba(255,255,255,0.2)',
                                background: isSelected ? '#34d399' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 11, color: '#1a1a2e', fontWeight: 700, flexShrink: 0,
                              }}>
                                {isSelected && '✓'}
                              </div>
                            )}
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600 }}>{o.ownerName}</div>
                              <div style={{ fontSize: 11, color: '#9ca3af' }}>
                                {[o.address, o.city, o.postalCode].filter(Boolean).join(', ')}
                              </div>
                              {o.acquisitionDate && (
                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                                  Acquis le {o.acquisitionDate}{o.price ? ` — ${Number(o.price).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })}` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" id="useOwner" checked={useOwnerAsClient}
                      onChange={e => {
                        setUseOwnerAsClient(e.target.checked);
                        if (e.target.checked && ownerData) {
                          // If multiple selected, combine names
                          const selectedOwners = selectedOwnerIdxs.map(idx => ownerList[idx]).filter(Boolean);
                          if (selectedOwners.length === 1) {
                            const o = selectedOwners[0];
                            const commaIdx = o.ownerName.indexOf(',');
                            if (commaIdx > -1) {
                              setClientLast(o.ownerName.slice(0, commaIdx).trim());
                              setClientFirst(o.ownerName.slice(commaIdx + 1).trim());
                            } else {
                              const nameParts = o.ownerName.split(' ');
                              setClientFirst(nameParts[0] || '');
                              setClientLast(nameParts.slice(1).join(' ') || '');
                            }
                            const postal = [o.address, o.city, o.postalCode].filter(Boolean).join(', ');
                            setClientPostalAddress(postal);
                          } else {
                            // Multiple owners: combine names, use first address
                            const names = selectedOwners.map(o => o.ownerName);
                            setClientFirst('');
                            setClientLast(names.join(' & '));
                            const first = selectedOwners[0];
                            const postal = [first.address, first.city, first.postalCode].filter(Boolean).join(', ');
                            setClientPostalAddress(postal);
                          }
                          setSelectedQbCustomer(null);
                        }
                      }}
                      style={{ accentColor: '#22c55e', width: 16, height: 16, cursor: 'pointer' }} />
                    <label htmlFor="useOwner" style={{ fontSize: 11, color: '#d1d5db', cursor: 'pointer' }}>
                      Utiliser {selectedOwnerIdxs.length > 1 ? `les ${selectedOwnerIdxs.length} propriétaires` : 'le propriétaire'} comme client
                    </label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" id="isCompanyOwner" checked={isCompany}
                      onChange={e => setIsCompany(e.target.checked)}
                      style={{ accentColor: '#6366f1', width: 16, height: 16, cursor: 'pointer' }} />
                    <label htmlFor="isCompanyOwner" style={{ fontSize: 11, color: '#d1d5db', cursor: 'pointer', fontWeight: 600 }}>
                      Compagnie
                    </label>
                  </div>
                </div>
              </div>
            )}
            {ownerError && !ownerLoading && (
              <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', fontSize: 11, color: '#f87171' }}>
                ⚠ {ownerError}
              </div>
            )}

            {/* Use address as postal checkbox (fallback when no owner) */}
            {addressText && !ownerData && !ownerLoading && (
              <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="useAddrPostal" checked={useOwnerAsClient}
                  onChange={e => {
                    setUseOwnerAsClient(e.target.checked);
                    if (e.target.checked && addressText) {
                      setClientPostalAddress(addressText);
                    }
                  }}
                  style={{ accentColor: '#6366f1', width: 16, height: 16, cursor: 'pointer' }} />
                <label htmlFor="useAddrPostal" style={{ fontSize: 11, color: '#d1d5db', cursor: 'pointer' }}>
                  Utiliser l'adresse de l'immeuble comme adresse postale
                </label>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div id="field-client-first" style={flashStyle('field-client-first')}><label style={labelStyle}>Prénom</label><input value={clientFirst} onChange={e => setClientFirst(e.target.value)} placeholder="Prénom" style={numInputStyle} /></div>
              <div id="field-client-last" style={flashStyle('field-client-last')}><label style={labelStyle}>Nom</label><input value={clientLast} onChange={e => setClientLast(e.target.value)} placeholder="Nom" style={numInputStyle} /></div>
              <div id="field-client-email" style={flashStyle('field-client-email')}><label style={labelStyle}>Courriel</label><input value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="courriel@..." style={numInputStyle} /></div>
              <div id="field-client-phone" style={flashStyle('field-client-phone')}><label style={labelStyle}>Téléphone</label><input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="514-..." style={numInputStyle} /></div>
              <div id="field-client-postal" style={{ gridColumn: '1 / -1', ...flashStyle('field-client-postal') }}>
                <label style={labelStyle}>Adresse postale</label>
                <input value={clientPostalAddress} onChange={e => setClientPostalAddress(e.target.value)}
                  placeholder="Adresse postale du client" style={numInputStyle} />
              </div>
              {/* Classification synchronisée avec le tableau de bord / Gantt.
                  Vague A2.1 : icône Sparkles indique l'auto-remplissage IA
                  (MAMH/Solar). Disparaît dès que l'utilisateur modifie le champ. */}
              <div><label style={labelStyle}>
                Catégorie
                {autoFilledFields.has('roofCategory') && <Bot size={12} style={glowBotStyle} />}
              </label>
                <select value={roofCategory} onChange={e => { setRoofCategory(e.target.value); unmarkAutoFilled('roofCategory'); }} style={autoFilledFields.has('roofCategory') ? { ...selectStyle, ...glowFieldStyle } : selectStyle}>
                  {ROOF_CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>
                Bâtiment
                {autoFilledFields.has('buildingType') && <Bot size={12} style={glowBotStyle} />}
              </label>
                <select value={buildingType} onChange={e => { setBuildingType(e.target.value); unmarkAutoFilled('buildingType'); }} style={autoFilledFields.has('buildingType') ? { ...selectStyle, ...glowFieldStyle } : selectStyle}>
                  <option value="">—</option>
                  {BUILDING_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {AUTOFILL_ENABLED && (
                <div><label style={labelStyle}>
                  Année construction
                  {autoFilledFields.has('year_built') && <Bot size={12} style={glowBotStyle} />}
                </label>
                  <input
                    type="number"
                    min={1700}
                    max={new Date().getFullYear()}
                    value={yearBuilt ?? ''}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setYearBuilt(Number.isFinite(v) && v > 0 ? v : null);
                      unmarkAutoFilled('year_built');
                      if (mamhDataSource) setMamhDataSource(null);
                    }}
                    placeholder="ex: 2007"
                    style={autoFilledFields.has('year_built') ? { ...numInputStyle, ...glowFieldStyle } : numInputStyle}
                  />
                </div>
              )}
              <div><label style={labelStyle}>Préférence de contact</label>
                <select value={contactPreference} onChange={e => setContactPreference(e.target.value)} style={selectStyle}>
                  {CONTACT_PREFERENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {/* Company toggle (fallback when no owner data) */}
            {!ownerData && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="isCompany" checked={isCompany}
                  onChange={e => setIsCompany(e.target.checked)}
                  style={{ accentColor: '#6366f1', width: 16, height: 16, cursor: 'pointer' }} />
                <label htmlFor="isCompany" style={{ fontSize: 11, color: '#d1d5db', cursor: 'pointer', fontWeight: 600 }}>
                  Compagnie
                </label>
              </div>
            )}
            {isCompany && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <div>
                  <label style={labelStyle}>Nom de l'entreprise</label>
                  <input value={clientCompany} onChange={e => setClientCompany(e.target.value)}
                    placeholder="Nom d'entreprise" style={numInputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>NEQ (optionnel)</label>
                  <input value={clientNeq} onChange={e => setClientNeq(e.target.value)}
                    placeholder="1234567890" style={numInputStyle} />
                </div>
              </div>
            )}

            {/* Duplicate detection warning */}
            {qbDuplicateMatch && !selectedQbCustomer && (
              <div style={{
                marginTop: 10, padding: '10px 14px', background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <AlertTriangle size={16} style={{ color: '#fbbf24', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700 }}>
                    Client possiblement existant dans QuickBooks
                  </div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                    « {qbDuplicateMatch.DisplayName} »
                    {qbDuplicateMatch.PrimaryEmailAddr?.Address ? ` — ${qbDuplicateMatch.PrimaryEmailAddr.Address}` : ''}
                  </div>
                </div>
                <button onClick={useExistingQbCustomer} style={{
                  background: 'rgba(251,191,36,0.2)', border: '1px solid rgba(251,191,36,0.3)',
                  color: '#fbbf24', borderRadius: 6, padding: '6px 12px', fontSize: 10, fontWeight: 700,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  Utiliser ce client
                </button>
              </div>
            )}

            {/* QB Create — inline within client card */}
            {(clientFirst || clientLast) && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>QuickBooks</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10, marginBottom: 8 }}>
                  <div><span style={{ color: '#4b5563' }}>Display:</span> <span style={{ color: '#9ca3af' }}>{isCompany && clientCompany ? clientCompany : `${clientFirst} ${clientLast}`.trim()}</span></div>
                  <div><span style={{ color: '#4b5563' }}>Email:</span> <span style={{ color: '#9ca3af' }}>{clientEmail || '—'}</span></div>
                </div>
                <button onClick={handleCreateQbCustomer} disabled={creatingQbCustomer || (!clientFirst && !clientLast)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 6, border: 'none', cursor: creatingQbCustomer ? 'wait' : 'pointer',
                    fontSize: 11, fontWeight: 700,
                    background: selectedQbCustomer
                      ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                      : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#fff',
                    opacity: creatingQbCustomer ? 0.7 : 1,
                  }}>
                  {creatingQbCustomer ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <User size={12} />}
                  {creatingQbCustomer
                    ? (selectedQbCustomer ? 'Mise à jour…' : 'Création…')
                    : (selectedQbCustomer ? 'Mettre à jour dans QuickBooks' : 'Créer dans QuickBooks')}
                </button>
                {qbCreateResult && (
                  <div style={{
                    marginTop: 6, padding: '6px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                    background: qbCreateResult.success ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
                    border: `1px solid ${qbCreateResult.success ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
                    color: qbCreateResult.success ? '#34d399' : '#f87171',
                  }}>
                    {qbCreateResult.message}
                  </div>
                )}
              </div>
            )}
          </div>
      </div>{/* end 2-column grid */}
      {/* Vague A2.1 — Section "Caractéristiques du bâtiment" séparée retirée.
          Année construction est désormais inline dans la grille Client (à
          côté de Catégorie/Bâtiment/Préférence de contact). Nb logements et
          Nb étages sont déduits silencieusement depuis MAMH et utilisés
          pour piloter Catégorie/Bâtiment (règles métier nb_logements →
          unifamiliale/duplex/triplex/multiplex) + le score de complexité.
          Pour saisie manuelle quand MAMH absent, le bandeau bleu
          d'AutofillCoordinator expose les 3 inputs.
          // OLD: {AUTOFILL_ENABLED && (
          //   <div style={sectionStyle}>
          //     <SectionTitle ... title="Caractéristiques du bâtiment" />
          //     <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }}>
      */}
      {/* ── Liste des champs à compléter ─────────────────────────────── */}
      {sectionChecklists[1].some(f => !f.filled) && (
        <div style={{
          marginTop: 14, padding: '12px 14px', borderRadius: 10,
          background: 'rgba(251,191,36,0.05)',
          border: '1px solid rgba(251,191,36,0.25)',
          maxHeight: 180, overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} /> Champs à compléter ({sectionChecklists[1].filter(f => !f.filled).length})
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sectionChecklists[1].filter(f => !f.filled).map(f => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => flashField(f.id)}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    color: '#e5e7eb', fontSize: 12,
                    padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(251,191,36,0.10)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(251,191,36,0.4)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.06)'; }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fbbf24', flexShrink: 0 }} />
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>{/* end collapsable wrapper section 1 */}
      </div>{/* end SECTION 1 */}

      {/* ═══════════════ SECTION 2: PARAMÈTRES DE SOUMISSIONS ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<Layers size={20} />} title="Paramètres de soumissions" number={2} collapsed={!!collapsedSections[2]} onToggle={() => toggleSection(2)} completion={sectionPct(2)} onCompletionClick={() => setOpenedMissingFor(p => p === 2 ? null : 2)} missingOpen={openedMissingFor === 2} />
        {openedMissingFor === 2 && <MissingFieldsPanel section={2} />}
        <div style={{ display: collapsedSections[2] ? 'none' : 'block' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -12, marginBottom: 8 }}>
          <button onClick={() => setShowListConfig(p => !p)} style={{
            padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
            background: showListConfig ? 'rgba(165,180,252,0.2)' : 'rgba(255,255,255,0.06)',
            color: showListConfig ? '#a5b4fc' : '#9ca3af',
            border: `1px solid ${showListConfig ? 'rgba(165,180,252,0.3)' : 'rgba(255,255,255,0.1)'}`,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Settings size={11} /> Config listes
          </button>
        </div>

        {showListConfig && (
          <div style={{ ...sectionStyle, borderColor: 'rgba(165,180,252,0.2)', marginBottom: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Settings size={13} /> Configuration des listes
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {/* Types de couverture */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Types de couverture</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {coverageTypesList.map(t => (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 6, fontSize: 10, color: '#fbbf24', fontWeight: 600 }}>
                      {t}
                      <button onClick={() => setCoverageTypesList(prev => prev.filter(x => x !== t))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input type="text" value={newCoverageType} onChange={e => setNewCoverageType(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newCoverageType.trim()) { setCoverageTypesList(prev => [...prev, newCoverageType.trim()]); setNewCoverageType(''); } }}
                    placeholder="Nouveau type…" style={{ ...inputStyle, width: '100%', padding: '4px 8px', fontSize: 11 }} />
                  <button onClick={() => { if (newCoverageType.trim()) { setCoverageTypesList(prev => [...prev, newCoverageType.trim()]); setNewCoverageType(''); } }}
                    disabled={!newCoverageType.trim()} style={{ padding: '4px 8px', fontSize: 10, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 4, cursor: 'pointer' }}>
                    <Plus size={10} />
                  </button>
                </div>
              </div>
              {/* Marques */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Marques</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {marquesList.map(m => (
                    <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 6, fontSize: 10, color: '#34d399', fontWeight: 600 }}>
                      {m}
                      <button onClick={() => setMarquesList(prev => prev.filter(x => x !== m))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input type="text" value={newMarque} onChange={e => setNewMarque(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newMarque.trim()) { setMarquesList(prev => [...prev, newMarque.trim()]); setNewMarque(''); } }}
                    placeholder="Nouvelle marque…" style={{ ...inputStyle, width: '100%', padding: '4px 8px', fontSize: 11 }} />
                  <button onClick={() => { if (newMarque.trim()) { setMarquesList(prev => [...prev, newMarque.trim()]); setNewMarque(''); } }}
                    disabled={!newMarque.trim()} style={{ padding: '4px 8px', fontSize: 10, background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 4, cursor: 'pointer' }}>
                    <Plus size={10} />
                  </button>
                </div>
              </div>
              {/* Gammes */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Gammes</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {gammesList.map(g => (
                    <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: 'rgba(165,180,252,0.1)', border: '1px solid rgba(165,180,252,0.2)', borderRadius: 6, fontSize: 10, color: '#a5b4fc', fontWeight: 600 }}>
                      {g}
                      <button onClick={() => setGammesList(prev => prev.filter(x => x !== g))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input type="text" value={newGamme} onChange={e => setNewGamme(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newGamme.trim()) { setGammesList(prev => [...prev, newGamme.trim()]); setNewGamme(''); } }}
                    placeholder="Nouvelle gamme…" style={{ ...inputStyle, width: '100%', padding: '4px 8px', fontSize: 11 }} />
                  <button onClick={() => { if (newGamme.trim()) { setGammesList(prev => [...prev, newGamme.trim()]); setNewGamme(''); } }}
                    disabled={!newGamme.trim()} style={{ padding: '4px 8px', fontSize: 10, background: 'rgba(165,180,252,0.15)', color: '#a5b4fc', border: '1px solid rgba(165,180,252,0.2)', borderRadius: 4, cursor: 'pointer' }}>
                    <Plus size={10} />
                  </button>
                </div>
              </div>
              {/* Fournisseurs */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Fournisseurs</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {suppliersList.map(s => (
                    <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 6, fontSize: 10, color: '#a78bfa', fontWeight: 600 }}>
                      {s}
                      <button onClick={() => setSuppliersList(prev => prev.filter(x => x !== s))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input type="text" value={newSupplier} onChange={e => setNewSupplier(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newSupplier.trim()) { setSuppliersList(prev => [...prev, newSupplier.trim()]); setNewSupplier(''); } }}
                    placeholder="Nouveau fournisseur…" style={{ ...inputStyle, width: '100%', padding: '4px 8px', fontSize: 11 }} />
                  <button onClick={() => { if (newSupplier.trim()) { setSuppliersList(prev => [...prev, newSupplier.trim()]); setNewSupplier(''); } }}
                    disabled={!newSupplier.trim()} style={{ padding: '4px 8px', fontSize: 10, background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 4, cursor: 'pointer' }}>
                    <Plus size={10} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

          <div style={sectionStyle}>
            
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div><label style={labelStyle}>Type de couverture</label>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setShowCoverageDropdown(p => !p)}
                    style={{ ...selectStyle, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 38 }}
                  >
                    <span style={{ fontSize: 12, color: selectedCoverageTypes.length > 0 ? '#fff' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedCoverageTypes.length > 0 ? selectedCoverageTypes.join(', ') : '— Tous —'}
                    </span>
                    <ChevronDown size={14} style={{ color: '#6b7280', flexShrink: 0 }} />
                  </button>
                  {showCoverageDropdown && (
                    <div onClick={() => setShowCoverageDropdown(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                  )}
                  {showCoverageDropdown && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: 'auto', padding: 4 }}>
                      {coverageTypesList.map(t => {
                        const checked = selectedCoverageTypes.includes(t);
                        return (
                          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 12, color: checked ? '#fbbf24' : '#d1d5db', background: checked ? 'rgba(251,191,36,0.08)' : 'transparent' }}
                            onMouseEnter={e => (e.currentTarget.style.background = checked ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.06)')}
                            onMouseLeave={e => (e.currentTarget.style.background = checked ? 'rgba(251,191,36,0.08)' : 'transparent')}
                          >
                            <input type="checkbox" checked={checked}
                              onChange={() => { setSelectedCoverageTypes(prev => checked ? prev.filter(x => x !== t) : [...prev, t]); setShowCoverageDropdown(false); }}
                              style={{ accentColor: '#fbbf24', width: 14, height: 14 }} />
                            {t}
                          </label>
                        );
                      })}
                      {selectedCoverageTypes.length > 0 && (
                        <button onClick={() => setSelectedCoverageTypes([])}
                          style={{ width: '100%', padding: '6px 8px', fontSize: 10, color: '#9ca3af', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4 }}>
                          Effacer la sélection
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div><label style={labelStyle}>Marque</label>
                <select value={selectedMarque} onChange={e => setSelectedMarque(e.target.value)} style={selectStyle}>
                  <option value="" style={{ background: '#1a1a2e' }}>— Toutes —</option>
                  {marquesList.map(m => <option key={m} value={m} style={{ background: '#1a1a2e' }}>{m}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Gamme</label>
                <select value={selectedGamme} onChange={e => setSelectedGamme(e.target.value)} style={selectStyle}>
                  <option value="" style={{ background: '#1a1a2e' }}>— Toutes —</option>
                  {gammesList.map(g => <option key={g} value={g} style={{ background: '#1a1a2e' }}>{g}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
              <div><label style={labelStyle}>
                Type de toit
                {autoFilledFields.has('roofType') && <Bot size={12} style={glowBotStyle} />}
              </label>
                <select value={roofType} onChange={e => { setRoofType(e.target.value as RoofType); unmarkAutoFilled('roofType'); }} style={autoFilledFields.has('roofType') ? { ...selectStyle, ...glowFieldStyle } : selectStyle}>
                  {ROOF_TYPES.map(t => <option key={t.value} value={t.value} style={{ background: '#1a1a2e' }}>{t.label}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>
                Pente
                {autoFilledFields.has('slopeCategory') && <Bot size={12} style={glowBotStyle} />}
              </label>
                <select value={slopeCategory} onChange={e => { setSlopeCategory(e.target.value as SlopeCategory); unmarkAutoFilled('slopeCategory'); }} style={autoFilledFields.has('slopeCategory') ? { ...selectStyle, ...glowFieldStyle } : selectStyle}>
                  {SLOPE_CATEGORIES.map(s => <option key={s.value} value={s.value} style={{ background: '#1a1a2e' }}>{s.label}</option>)}
                </select>
              </div>
            </div>
            {/* Complexité + Couleur — synchronisés avec le tableau de bord / Gantt */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
              <div><label style={labelStyle}>
                Complexité
                {autoFilledFields.has('complexity') && <Bot size={12} style={glowBotStyle} />}
              </label>
                <select value={complexity} onChange={e => { setComplexity(e.target.value); unmarkAutoFilled('complexity'); }} style={autoFilledFields.has('complexity') ? { ...selectStyle, ...glowFieldStyle } : selectStyle}>
                  <option value="" style={{ background: '#1a1a2e' }}>—</option>
                  {COMPLEXITY_OPTIONS.map(o => <option key={o.value} value={o.value} style={{ background: '#1a1a2e' }}>{o.label}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Couleur</label>
                <select value={colorName} onChange={e => setColorName(e.target.value)} style={selectStyle}>
                  <option value="" style={{ background: '#1a1a2e' }}>—</option>
                  {(COLORS_BY_PRODUCT[selectedGamme] || []).map(c => <option key={c} value={c} style={{ background: '#1a1a2e' }}>{c}</option>)}
                  {colorName && !(COLORS_BY_PRODUCT[selectedGamme] || []).includes(colorName) && (
                    <option value={colorName} style={{ background: '#1a1a2e' }}>{colorName}</option>
                  )}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>Type de travaux</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {workTypeOptions.map(wt => (
                  <button key={wt} onClick={() => setWorkType(wt)}
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: workType === wt ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${workType === wt ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                      color: workType === wt ? '#c7d2fe' : '#9ca3af',
                    }}>
                    {wt}
                  </button>
                ))}
                {showAddWorkType ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input value={newWorkTypeText} onChange={e => setNewWorkTypeText(e.target.value)}
                      placeholder="Nouveau type..." autoFocus
                      onKeyDown={e => { if (e.key === 'Enter' && newWorkTypeText.trim()) { setWorkTypeOptions(prev => [...prev, newWorkTypeText.trim()]); setWorkType(newWorkTypeText.trim()); setNewWorkTypeText(''); setShowAddWorkType(false); } }}
                      style={{ ...miniInputStyle, width: 130 }} />
                    <button onClick={() => { if (newWorkTypeText.trim()) { setWorkTypeOptions(prev => [...prev, newWorkTypeText.trim()]); setWorkType(newWorkTypeText.trim()); setNewWorkTypeText(''); } setShowAddWorkType(false); }}
                      style={{ background: 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 4, color: '#34d399', cursor: 'pointer', padding: '4px 8px', fontSize: 10 }}>✓</button>
                  </div>
                ) : (
                  <button onClick={() => setShowAddWorkType(true)}
                    style={{
                      padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.15)',
                      color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                    <Plus size={10} /> Autre
                  </button>
                )}
              </div>
            </div>
          </div>

      {/* ── Modèles de soumissions ── */}
          <div style={sectionStyle}>
            <SectionTitle icon={<FileText size={14} />} title="Modèles de soumissions" />
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input value={templateName} onChange={e => setTemplateName(e.target.value)}
                placeholder="Nom du modèle..." style={{ ...numInputStyle, flex: 1, padding: '6px 10px' }}
                onKeyDown={e => { if (e.key === 'Enter') saveAsTemplate(); }} />
              <button onClick={saveAsTemplate} disabled={!templateName.trim()}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: templateName.trim() ? 'pointer' : 'not-allowed',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff',
                  opacity: templateName.trim() ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <Save size={12} /> Enregistrer
              </button>
            </div>
            {quoteTemplatesLoading ? (
              <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: '12px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Chargement des modèles…
              </div>
            ) : quoteTemplates.length > 0 ? (
              <div style={{ borderRadius: 8, overflow: 'auto', border: '1px solid rgba(255,255,255,0.06)', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: 'rgba(25,25,50,0.8)' }}>
                      <th style={thSt}>Nom</th>
                      <th style={thSt}>Couverture</th>
                      <th style={thSt}>Marque</th>
                      <th style={thSt}>Gamme</th>
                      <th style={thSt}>Toit</th>
                      <th style={thSt}>Pente</th>
                      <th style={thSt}>Travaux</th>
                      <th style={thSt}>Outils</th>
                      <th style={{ ...thSt, width: 70 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {quoteTemplates.map(tpl => {
                      const isEditing = editingTemplateId === tpl.id;
                      return (
                      <tr key={tpl.id} style={{ borderTop: '1px solid rgba(255,255,255,0.03)', background: isEditing ? 'rgba(99,102,241,0.06)' : undefined }}>
                        <td style={{ ...tdSt, color: '#c7d2fe', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, maxWidth: 220, minWidth: 140 }}>
                          {isEditing ? (
                            <input value={editingTemplateName} onChange={e => setEditingTemplateName(e.target.value)}
                              style={{ ...miniInputStyle, width: '100%' }} autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') updateTemplate(tpl.id); if (e.key === 'Escape') setEditingTemplateId(null); }} />
                          ) : <span title={tpl.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{tpl.name}</span>}
                          {activeTemplateId === tpl.id && !isEditing && <CheckCircle2 size={14} style={{ color: '#34d399', flexShrink: 0 }} />}
                        </td>
                        <td style={{ ...tdSt, color: '#9ca3af' }}>{tpl.coverageType || '—'}</td>
                        <td style={{ ...tdSt, color: '#9ca3af' }}>{tpl.marque || '—'}</td>
                        <td style={{ ...tdSt, color: '#9ca3af' }}>{tpl.gamme || '—'}</td>
                        <td style={{ ...tdSt, color: '#9ca3af' }}>{ROOF_TYPES.find(r => r.value === tpl.roofType)?.label || tpl.roofType}</td>
                        <td style={{ ...tdSt, color: '#9ca3af' }}>{SLOPE_CATEGORIES.find(s => s.value === tpl.slopeCategory)?.label || tpl.slopeCategory}</td>
                        <td style={{ ...tdSt, color: '#9ca3af' }}>{tpl.workType || '—'}</td>
                        <td style={{ ...tdSt, color: '#6b7280', fontSize: 10 }}>{tpl.tools.length}</td>
                        <td style={{ ...tdSt, textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {isEditing ? (
                              <>
                                <button onClick={() => updateTemplate(tpl.id)}
                                  style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 4, color: '#fbbf24', cursor: 'pointer', padding: '3px 8px', fontSize: 9, fontWeight: 600 }}>
                                  Sauver
                                </button>
                                <button onClick={() => setEditingTemplateId(null)}
                                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: '#9ca3af', cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}>
                                  Annuler
                                </button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => loadTemplate(tpl)}
                                  style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 4, color: '#34d399', cursor: 'pointer', padding: '3px 8px', fontSize: 9, fontWeight: 600 }}>
                                  Charger
                                </button>
                                <button onClick={() => { setEditingTemplateId(tpl.id); setEditingTemplateName(tpl.name); }}
                                  style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 4, color: '#a5b4fc', cursor: 'pointer', padding: '3px 8px', fontSize: 9, fontWeight: 600 }}>
                                  Éditer
                                </button>
                                <button onClick={() => deleteTemplate(tpl.id)}
                                  style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: 2 }}>
                                  <Trash2 size={11} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', padding: '12px 0' }}>
                {quoteTemplatesError || 'Aucun modèle enregistré. Configurez vos paramètres puis enregistrez un modèle.'}
              </div>
            )}
          </div>
        </div>{/* end collapse wrapper section 2 */}
      </div>{/* end SECTION 2 */}

      {/* ═══════════════ SECTION 3: TAKE-OFF ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<Ruler size={20} />} title="Take-off" number={3} collapsed={!!collapsedSections[3]} onToggle={() => toggleSection(3)} completion={sectionPct(3)} onCompletionClick={() => setOpenedMissingFor(p => p === 3 ? null : 3)} missingOpen={openedMissingFor === 3} />
        {openedMissingFor === 3 && <MissingFieldsPanel section={3} />}
        <div style={{ display: collapsedSections[3] ? 'none' : 'block' }}>
            <div style={sectionStyle}>

              {/* Relancer la détection IA du toit sur la vue carte actuelle —
                  régénère des annotations propres (utile si le tracé est désaligné). */}
              <button
                onClick={() => { if (aiApiRef.current) aiApiRef.current.recapture(); else toast.info('Ouvre/affiche la carte pour activer la détection IA.'); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '9px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg, rgba(139,92,246,0.22), rgba(99,102,241,0.22))', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.4)' }}>
                <Sparkles size={14} /> Relancer la détection IA
              </button>

              {/* L'ancien bouton « Tracer le toit (3D) » a été retiré : l'action
                  vit désormais en superposition du viewer 3D (« Éditer le 3D »). */}

              {buildingPhase === 'loading' && !manualMeasureMode && <div style={{ color: '#6b7280', fontSize: 12 }}>Recherche du bâtiment…</div>}
              {!lat && !manualMeasureMode && (
                <div style={{ padding: '16px 0', textAlign: 'center', color: '#4b5563', fontSize: 12 }}>
                  Entrez une adresse dans la section 1 pour afficher la carte et les outils de mesure.
                </div>
              )}
              {(lat || manualMeasureMode) && (
                <div style={{ display: 'flex', gap: 0, marginBottom: 12, flexDirection: isMobile ? 'column' : 'row', alignItems: 'stretch' }}>
                  {/* Left: Map area — flex-column pour que le viewer 3D
                      remplisse l'espace restant et aligne son bas sur celui
                      du panneau d'outils à droite. */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  {/* Toggle GPS / Manuel above map */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '6px 10px', background: 'rgba(10,10,20,0.4)', borderRadius: '8px 8px 0 0', border: '1px solid rgba(255,255,255,0.06)', borderBottom: 'none' }}>
                    {/* Mode toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <span style={{ fontSize: 9, fontWeight: 600, color: !manualMeasureMode ? '#fbbf24' : '#6b7280', transition: 'color 0.2s' }}>
                        <Satellite size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />GPS
                      </span>
                      <button
                        onClick={() => setManualMeasureMode(v => !v)}
                        title={manualMeasureMode ? 'Passer en mode GPS' : 'Passer en mode Manuel'}
                        style={{
                          position: 'relative',
                          width: 34, height: 18,
                          borderRadius: 9,
                          border: 'none',
                          cursor: 'pointer',
                          background: manualMeasureMode ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.15)',
                          transition: 'background 0.2s',
                          padding: 0,
                          flexShrink: 0,
                        }}
                      >
                        <span style={{
                          position: 'absolute',
                          top: 2, left: manualMeasureMode ? 18 : 2,
                          width: 14, height: 14,
                          borderRadius: '50%',
                          background: manualMeasureMode ? '#fbbf24' : '#9ca3af',
                          transition: 'left 0.2s, background 0.2s',
                          display: 'block',
                        }} />
                      </button>
                      <span style={{ fontSize: 9, fontWeight: 600, color: manualMeasureMode ? '#fbbf24' : '#6b7280', transition: 'color 0.2s' }}>
                        <PenLine size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />Manuel
                      </span>
                    </div>
                  </div>

                  {/* Map or Plan */}
                  <div>
                    {manualMeasureMode ? (
                      <PlanViewer
                        measureMode={measureMode}
                        measureColors={Object.fromEntries(measureTools.map(t => [t.id, t.color]))}
                        measureLabels={Object.fromEntries(measureTools.map(t => [t.id, t.name]))}
                        measureToolTypes={Object.fromEntries(measureTools.map(t => [t.id, t.toolType]))}
                        measureUnits={Object.fromEntries(measureTools.map(t => [t.id, t.unit]))}
                        measureMarkerShapes={Object.fromEntries(measureTools.map(t => [t.id, t.markerShape || 'circle']))}
                        onMeasureComplete={(target, value) => {
                          if (target) updateTool(target, 'correctedValue', String(value));
                          setMeasureMode(null);
                        }}
                        onMeasureCancel={() => setMeasureMode(null)}
                        onAnnotationsChange={(anns) => setMapAnnotations(anns.map(a => ({ ...a, visible: true })))}
                        deleteAnnotationIndex={deleteAnnotIdx}
                        onDeleteAnnotationDone={() => setDeleteAnnotIdx(null)}
                        clearAllAnnotations={clearAllAnnotations}
                        onClearAllAnnotationsDone={() => setClearAllAnnotations(false)}
                        initialImageUrl={savedPlanUrl}
                        onPlanImageData={setPlanImageDataUrl}
                      />
                    ) : (
                      <BuildingReadOnlyMap centerLat={mapParams.centerLat} centerLng={mapParams.centerLng} zoom={mapParams.zoom}
                        buildingGeojson={buildingGeojson!} lotGeojson={lotGeojson} address={addressText}
                        superficie={superficie} largeur={largeur} profondeur={profondeur} noLot={noLot}
                        onViewChange={view => setMapParams(prev => (
                          Math.abs(prev.centerLat - view.centerLat) < 1e-7 &&
                          Math.abs(prev.centerLng - view.centerLng) < 1e-7 &&
                          Math.abs(prev.zoom - view.zoom) < 0.01
                            ? prev : view
                        ))}
                        onAdjustmentsChange={setPolygonAdj}
                        onLotAdjustmentsChange={setLotAdj}
                        onBuildingGeojsonChange={setBuildingGeojson}
                        onLotGeojsonChange={setLotGeojson}
                        measureMode={measureMode}
                        measureColors={Object.fromEntries(measureTools.map(t => [t.id, t.color]))}
                        measureLabels={Object.fromEntries(measureTools.map(t => [t.id, t.name]))}
                        measureToolTypes={Object.fromEntries(measureTools.map(t => [t.id, t.toolType]))}
                        measureMarkerShapes={Object.fromEntries(measureTools.map(t => [t.id, t.markerShape || 'circle']))}
                        onMeasureComplete={(target, value) => {
                          if (target) updateTool(target, 'correctedValue', String(value));
                          setMeasureMode(null);
                        }}
                        onMeasureCancel={() => setMeasureMode(null)}
                        onAnnotationsChange={setMapAnnotations}
                        deleteAnnotationIndex={deleteAnnotIdx}
                        onDeleteAnnotationDone={() => setDeleteAnnotIdx(null)}
                        clearAllAnnotations={clearAllAnnotations}
                        onClearAllAnnotationsDone={() => setClearAllAnnotations(false)}
                        onBuildingEdited={(newAreaM2, newPerimM) => {
                          setSuperficie(newAreaM2);
                          setPerimetre(newPerimM);
                          setAreaSqftOverride(String(Math.round(newAreaM2 * 10.7639)));
                          setPerimeterFtOverride(String(Math.round(newPerimM * 3.28084)));
                        }}
                        hideBuiltinAdjust
                        onAdjustControlsReady={setAdjustControls}
                        hideBuiltinMapTools
                        onMapToolboxControlsReady={setMapToolboxControls}
                        navigateMode={navigateMode}
                        initialAnnotations={mapAnnotations}
                        initialAdjustments={polygonAdj}
                        initialLotAdjustments={lotAdj}
                        imageOverlays={aiOverlays.map(o => ({
                          id: o.id, url: o.url, bounds: o.bounds,
                          visible: o.visible, opacity: o.opacity ?? 1,
                        }))}
                      />
                    )}
                  </div>


                   {!manualMeasureMode && buildingPhase === 'found' && (
                     <button onClick={() => setBuildingPhase('manual')}
                       style={{ marginTop: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#6b7280', fontSize: 11, padding: '6px 12px', cursor: 'pointer', width: '100%' }}>
                       <RefreshCw size={11} style={{ marginRight: 4 }} /> Sélectionner un autre bâtiment
                     </button>
                   )}

                   {/* Aperçu 3D du modèle validé — SOUS la carte, dans la même
                       colonne (à GAUCHE des outils), à même la soumission. */}
                   <RoofModelViewer
                     model={roof3dModel}
                     tools={measureTools}
                     measures={roof3dMeasures}
                     summary={{
                       pitchX12: roof3dMeasures?.dominantPitchX12 ?? null,
                       areaSqft: (roof3dMeasures?.roofAreaSqft ?? (areaSqftOverride ? parseFloat(areaSqftOverride) : (superficie ? superficie * 10.7639 : null))) || null,
                     }}
                     onEdit={() => setTakeoffOpen(true)}
                     onSecsChange={(newSecs) => {
                       // Drag de Z dans le viewer → on reflète immédiatement
                       // sur roof3d_model. L'autosave existant prend le relais
                       // pour persister dans dynasty_breakdown.
                       setRoof3dModel((prev: any) => prev ? { ...prev, sections: newSecs } : prev);
                     }}
                     height={isMobile ? 240 : 'fill'}
                   />
                   </div>

                  {/* Right: Measurement tools side panel */}
                  <div style={{ width: isMobile ? '100%' : 420, flexShrink: 0, borderRadius: isMobile ? '8px' : '0 8px 8px 0', overflow: isMobile ? 'auto' : 'hidden', WebkitOverflowScrolling: 'touch', border: '1px solid rgba(255,255,255,0.06)', borderLeft: isMobile ? undefined : 'none', background: 'rgba(15,15,35,0.6)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'rgba(25,25,50,0.6)' }}>
                      <span style={{ color: '#9ca3af', fontWeight: 600, fontSize: 9, textTransform: 'uppercase' }}>Outils de mesure</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {mapAnnotations.length > 0 && (
                          <button onClick={() => {
                            // Vague A : confirmation destructive (corrige AQG-010 listé)
                            if (FEATURE_CONFIRM_DESTRUCTIVE && typeof window !== 'undefined') {
                              const ok = window.confirm(`Effacer les ${mapAnnotations.length} annotation${mapAnnotations.length > 1 ? 's' : ''} sur la carte ?`);
                              if (!ok) return;
                            }
                            setClearAllAnnotations(true);
                          }}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Trash2 size={10} /> Tout effacer
                          </button>
                        )}
                        <button onClick={() => setShowToolConfig(true)} title="Configuration des outils de mesure"
                          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, padding: '3px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                          <Settings size={11} style={{ color: '#9ca3af' }} />
                        </button>
                      </div>
                    </div>
                    {/* Column headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 74px 104px 74px 60px 56px 22px' : '1fr 56px 52px 42px 38px 44px 16px', minWidth: isMobile ? 560 : undefined, alignItems: 'center', padding: '3px 8px', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(25,25,50,0.3)' }}>
                      <span style={{ fontSize: 7, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3 }}>Outil</span>
                      <span style={{ fontSize: 7, color: '#6b7280', textTransform: 'uppercase', textAlign: 'right' }}>Valeur</span>
                      <span style={{ fontSize: 7, color: '#818cf8', textTransform: 'uppercase', textAlign: 'center' }}>Pente</span>
                      <span style={{ fontSize: 7, color: '#a5b4fc', textTransform: 'uppercase', textAlign: 'right' }}>F. pente</span>
                      <span style={{ fontSize: 7, color: '#fbbf24', textTransform: 'uppercase', textAlign: 'right' }}>Maj. %</span>
                      <span style={{ fontSize: 7, color: '#34d399', textTransform: 'uppercase', textAlign: 'right' }}>Total</span>
                      <span></span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', maxHeight: 500 }}>
                      {(() => {
                        const visibleTools = measureTools.filter(t => t.visible);
                        return visibleTools.map(tool => {
                          const toolAnns = mapAnnotations.filter(a => a.target === tool.id);
                          const isCounter = tool.toolType === 'Compteur';
                          const totalMeasured = isCounter ? toolAnns.length : toolAnns.reduce((s, a) => s + a.feet, 0);
                          const hasAnnotations = toolAnns.length > 0;
                          const hasValue = !!tool.correctedValue;
                          const linkedSource = tool.linkedTo ? measureTools.find(t => t.id === tool.linkedTo) : null;
                          const isBldgSrc = isBuildingSourceType(tool.toolType);
                          const isActive = measureMode === tool.id;
                          const canAnnotate = (!!buildingGeojson || manualMeasureMode) && !isBuildingSourceType(tool.toolType);
                          const isCollapsed = collapsedMeasureTools[tool.id] !== false;
                          return (
                            <div key={tool.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                              {/* Tool header */}
                              <div
                                style={{
                                  display: 'grid', gridTemplateColumns: isMobile ? '1fr 74px 104px 74px 60px 56px 22px' : '1fr 56px 52px 42px 38px 44px 16px', minWidth: isMobile ? 560 : undefined, alignItems: 'center', gap: 4, padding: '6px 8px',
                                  background: isActive ? `${tool.color}18` : 'rgba(0,0,0,0.15)', transition: 'background 0.15s',
                                  borderLeft: isActive ? `3px solid ${tool.color}` : '3px solid transparent',
                                }}>
                                {/* Col 1: Outil (name + chevron + dot + ruler btn) */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                  <div onClick={() => { if (hasAnnotations || hasValue) setCollapsedMeasureTools(prev => ({ ...prev, [tool.id]: !isCollapsed })); }}
                                    style={{ flexShrink: 0, opacity: (hasAnnotations || hasValue) ? 1 : 0.3 }}>
                                    {isCollapsed ? <ChevronRight size={11} style={{ color: '#6b7280' }} /> : <ChevronDown size={11} style={{ color: '#9ca3af' }} />}
                                  </div>
                                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: tool.color, flexShrink: 0, boxShadow: isActive ? `0 0 6px ${tool.color}` : 'none' }} />
                                  <div
                                    onClick={() => { if (canAnnotate) setMeasureMode(isActive ? null : tool.id); }}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: canAnnotate ? 'pointer' : 'default', minWidth: 0 }}>
                                    <span title={tool.name} style={{ color: isActive ? '#fff' : '#e2e8f0', fontWeight: 700, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{tool.name}</span>
                                    {linkedSource && <span style={{ fontSize: 7, color: '#facc15' }}>⟵ {linkedSource.name}</span>}
                                    {isBldgSrc && <span style={{ fontSize: 7, color: '#818cf8' }}>auto</span>}
                                  </div>
                                  {canAnnotate && (
                                    <button onClick={e => { e.stopPropagation(); setMeasureMode(isActive ? null : tool.id); }}
                                      style={{
                                        ...measureBtnStyle,
                                        width: 22, height: 22,
                                        background: isActive ? `${tool.color}30` : 'rgba(255,255,255,0.06)',
                                        borderColor: isActive ? tool.color : 'rgba(255,255,255,0.12)',
                                        color: isActive ? tool.color : '#9ca3af',
                                      }}>
                                      <Ruler size={9} />
                                    </button>
                                  )}
                                </div>
                                {/* Col 2: Valeur */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                                  <input type="number" value={tool.correctedValue}
                                    onChange={e => updateTool(tool.id, 'correctedValue', e.target.value)}
                                    placeholder={hasAnnotations ? String(totalMeasured) : '0'}
                                    disabled={!!tool.linkedTo || isBldgSrc}
                                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, color: '#e2e8f0', fontFamily: 'monospace', fontWeight: 700, fontSize: 10, width: '100%', textAlign: 'right', padding: '2px 3px', opacity: (!!tool.linkedTo || isBldgSrc) ? 0.5 : 1 }} />
                                </div>
                                {/* Col 3: Pente dropdown */}
                                {(() => {
                                  const slopeColors: Record<string, string> = { aucune: '#22c55e', legere: '#3b82f6', moderee: '#f59e0b', abrupte: '#ef4444' };
                                  const currentSlope = tool.slopeType || slopeCategory;
                                  const sColor = slopeColors[currentSlope] || '#818cf8';
                                  return (
                                    <div onClick={e => e.stopPropagation()}>
                                      <select
                                        value={currentSlope}
                                        onChange={e => {
                                          const val = e.target.value as SlopeCategory;
                                          updateTool(tool.id, 'slopeType', val);
                                          updateTool(tool.id, 'slopeFactor', SLOPE_FACTOR_MAP[val]);
                                        }}
                                        style={{ background: `${sColor}15`, border: `1px solid ${sColor}40`, borderRadius: 3, color: sColor, fontSize: 8, fontWeight: 600, width: '100%', padding: '2px 1px', cursor: 'pointer' }}>
                                        {SLOPE_CATEGORIES.map(sc => (
                                          <option key={sc.value} value={sc.value} style={{ background: '#1a1a2e' }}>{sc.label.split(' ')[0]}</option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                })()}
                                {/* Col 4: F. pente */}
                                <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
                                  <span style={{ fontSize: 6, color: '#6b7280' }}>×</span>
                                  <input type="number" step="0.01" value={tool.slopeFactor ?? SLOPE_FACTOR_MAP[slopeCategory]}
                                    onChange={e => updateTool(tool.id, 'slopeFactor', Number(e.target.value))}
                                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, color: '#a5b4fc', fontFamily: 'monospace', fontWeight: 600, fontSize: 9, width: '100%', textAlign: 'right', padding: '2px 2px' }}
                                    title="Facteur de pente" />
                                </div>
                                {/* Col 5: Majoration */}
                                <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
                                  <input type="number" step="1" value={tool.majoration ?? 0}
                                    onChange={e => updateTool(tool.id, 'majoration', Number(e.target.value))}
                                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, color: '#fbbf24', fontFamily: 'monospace', fontWeight: 600, fontSize: 9, width: '100%', textAlign: 'right', padding: '2px 2px' }}
                                    title="Majoration %" />
                                  <span style={{ fontSize: 6, color: '#6b7280' }}>%</span>
                                </div>
                                {/* Col 5: Total */}
                                {(() => {
                                  const baseVal = Number(tool.correctedValue) || 0;
                                  const sf = tool.slopeFactor ?? SLOPE_FACTOR_MAP[tool.slopeType || slopeCategory];
                                  const maj = tool.majoration ?? 0;
                                  const total = baseVal * sf * (1 + maj / 100);
                                  return (
                                    <span style={{ fontSize: 9, color: total > 0 ? '#34d399' : '#4b5563', fontFamily: 'monospace', fontWeight: 700, textAlign: 'right' }}
                                      title="Total (valeur × pente × majoration)">
                                      {total > 0 ? Math.round(total) : '—'}
                                    </span>
                                  );
                                })()}
                                {/* Col 6: Delete */}
                                <div style={{ textAlign: 'center' }}>
                                  {toolAnns.length === 0 && hasValue && !isBldgSrc && !tool.linkedTo && (
                                    <button onClick={e => { e.stopPropagation(); updateTool(tool.id, 'correctedValue', ''); }}
                                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: '#f87171', flexShrink: 0 }}>
                                      <Trash2 size={9} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {/* Annotations list */}
                              {!isCollapsed && toolAnns.length > 0 && (
                                <div style={{ padding: '0 8px 4px 28px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                                  {toolAnns.map((ann, j) => (
                                    <div key={`${tool.id}-${j}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', borderTop: j > 0 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: tool.color, opacity: 0.5, flexShrink: 0 }} />
                                      <span style={{ color: '#6b7280', fontSize: 9, flex: 1 }}>
                                        {tool.name} #{j + 1}
                                      </span>
                                      <span style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: 9 }}>
                                        {isCounter ? '×1' : `${ann.feet} ${tool.unit}`}
                                      </span>
                                      <button onClick={() => setDeleteAnnotIdx(ann.index)}
                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: '#f87171' }}>
                                        <Trash2 size={9} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>

                    {/* Boîte à outils carte unifiée (Couches + Fond + Zoom + Ajustement) */}
                    {!measureMode && !manualMeasureMode && (mapToolboxControls || adjustControls) && (
                      <MapToolbox
                        mapControls={mapToolboxControls}
                        adjustControls={adjustControls}
                        storageKey="quote-generator-maptoolbox"
                        navigateMode={navigateMode}
                        onToggleNavigate={() => setNavigateMode(v => !v)}
                        aiOverlays={aiOverlays.map(o => ({ id: o.id, label: o.label, visible: o.visible, kind: o.kind }))}
                        onToggleAiOverlay={(id) => setAiOverlays(prev => prev.map(o => o.id === id ? { ...o, visible: !o.visible } : o))}
                        onRemoveAiOverlay={(id) => setAiOverlays(prev => prev.filter(o => o.id !== id))}
                        aiInlineContent={mapToolboxControls && (
                          <RoofPolygonAIInline
                            getCaptureParams={() => mapToolboxControls.getCaptureParams()}
                            onReadyApi={(api) => { aiApiRef.current = api; }}
                            setOverlays={(updater) => setAiOverlays(updater)}
                            onConfirmPolygon={({ path, areaM2, perimeterM }) => {
                              const areaSqft = Math.round(areaM2 * 10.7639);
                              const newId = `ai-roof-${Date.now()}`;
                              const newName = `Toit IA (${path.length} pts)`;
                              setMeasureTools(prev => [...prev, {
                                id: newId,
                                name: newName,
                                toolType: 'Surface bâtiment' as ToolType,
                                rawValue: String(areaSqft),
                                correctedValue: String(areaSqft),
                                unit: 'pi²',
                                color: '#a78bfa',
                                visible: true,
                                linkedTo: '',
                                markerShape: 'circle',
                              }]);
                              const closedRing = [...path, path[0]];
                              setMapAnnotations(prev => [
                                ...prev,
                                {
                                  target: newId,
                                  feet: Math.round(perimeterM * 3.28084),
                                  visible: true,
                                  index: prev.length,
                                  segments: [closedRing],
                                  markerPositions: path,
                                },
                              ]);
                            }}
                          />
                        )}
                      />
                    )}
                  </div>
                </div>
              )}
              {buildingPhase === 'manual' && lat && lng && (
                <BuildingMapPicker lat={mapParams.centerLat || lat} lng={mapParams.centerLng || lng} zoom={mapParams.zoom || 19}
                  buildingGeojson={buildingGeojson} lotGeojson={lotGeojson} onSelectLocation={handleManualSelect} />
              )}
              {buildingPhase === 'not_found' && (
                <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>Bâtiment non trouvé. Entrez les valeurs manuellement.</div>
              )}
            </div>
        </div>{/* end collapse wrapper section 3 */}
      </div>{/* end SECTION 3 */}

      {/* ═══════════════ RAPPORT DE TOITURE (depuis le 3D validé) ═══════════════ */}
      <div style={sectionStyle}>
        <SectionTitle icon={<FileText size={14} />} title="Rapport de toiture" />
        <RoofReportPanel
          roofModel={roof3dModel}
          soumissionId={loadedId}
          onAttached={setRoofReportPdfPath}
          meta={{
            client: [clientFirst, clientLast].filter(Boolean).join(' '),
            address: addressText,
            devisNo: loadedSeqNumber ? `VB-${loadedSeqNumber}` : '',
            date: new Date().toLocaleDateString('fr-CA'),
            pitch: roof3dMeasures?.dominantPitchX12 ? `${roof3dMeasures.dominantPitchX12}/12` : undefined,
          }}
        />
      </div>

      {/* ═══════════════ SECTION 4: SOUMISSION COMPLÈTE ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<Calculator size={20} />} title="Soumission complète" number={4} collapsed={!!collapsedSections[4]} onToggle={() => toggleSection(4)} completion={sectionPct(4)} onCompletionClick={() => setOpenedMissingFor(p => p === 4 ? null : 4)} missingOpen={openedMissingFor === 4} />
        {openedMissingFor === 4 && <MissingFieldsPanel section={4} />}
      <div style={{ display: collapsedSections[4] ? 'none' : 'block' }}>
      {/* ── Key metrics — full width ── */}
      {finalQuote && metrics && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <SectionTitle icon={<Clock size={14} />} title="Métriques clés" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: 0.5 }}>Hommes</label>
                    <input type="number" min={1} max={20} value={crewSize} onChange={e => setCrewSize(Math.max(1, Number(e.target.value)))}
                      style={{ ...miniInputStyle, width: 48, textAlign: 'center', fontSize: 13, fontWeight: 700 }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: 0.5 }}>Couv./paq</label>
                    <input type="number" min={1} step={0.1} value={coveragePerPkg} onChange={e => setCoveragePerPkg(Math.max(1, Number(e.target.value)))}
                      style={{ ...miniInputStyle, width: 60, textAlign: 'center', fontSize: 12, fontWeight: 700 }} />
                    <span style={{ fontSize: 10, color: '#9ca3af' }}>pi²</span>
                  </div>
                  <button onClick={() => setSettingsOpen(true)} title="Paramètres métriques"
                    style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', color: '#c7d2fe',
                      borderRadius: 8, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Settings size={13} />
                  </button>
                </div>
              </div>
              {/* Group 1 — Surface & pente */}
              <MetricGroup title="Surface & pente" accent="#a5b4fc">
                <MetricCard label="Surface couverture" value={`${effectiveAreaSqft.toFixed(0)} pi²`} sub="brute (polygone)" color="#a5b4fc" />
                <MetricCard label="Pente" value={SLOPE_CATEGORIES.find(s => s.value === slopeCategory)?.label.split(' ')[0] || '—'} sub={`facteur ×${metrics.slopeFactor.toFixed(2)}`} color="#a5b4fc" />
                <MetricCard label="Surface corrigée" value={`${metrics.surfaceCorrigee.toFixed(0)} pi²`} sub="× facteur pente" color="#a5b4fc" />
                <MetricCard label="Couv. / paquet" value={`${coveragePerPkg.toFixed(1)} pi²`} sub="modifiable" color="#a5b4fc" />
              </MetricGroup>

              {/* Group 2 — Production (heures / jours) */}
              <MetricGroup title="Production" accent="#a78bfa">
                <MetricCard label="Arrachage" value={`${metrics.tearoffHours.toFixed(1)} h`} sub={`≈ ${metrics.tearoffDays.toFixed(1)} j · ${crewSize} hommes`} />
                <MetricCard label="Pose" value={`${metrics.installHours.toFixed(1)} h`} sub={`≈ ${metrics.installDays.toFixed(1)} j · ${crewSize} hommes`} />
                <MetricCard label="Jours total" value={`${metrics.totalDays.toFixed(1)} j`} sub={`${crewSize} hommes`} color="#a78bfa" />
              </MetricGroup>

              {/* Group 3 — Prix de vente */}
              <MetricGroup title="Prix de vente" accent="#34d399">
                <MetricCard label="Prix / paquet" value={fmt2(metrics.pricePerPkgComputed || metrics.pricePerPkg)} sub={`${metrics.totalPkgs} paquets`} color="#34d399" />
                <MetricCard label="Prix / pi²" value={`${metrics.pricePerSqft.toFixed(2)} $`}
                  tone={priceFloorTone(metrics.pricePerSqft, quoteSettings.pricePerSqftFloor)} sub="vente / corrigée" />
              </MetricGroup>

              {/* Group 4 — Coûts */}
              <MetricGroup title="Coûts" accent="#fbbf24">
                <MetricCard label="Coût matériaux" value={fmt(metrics.materialCost)} color="#fbbf24" />
                <MetricCard label="Coût main-d'œuvre" value={fmt(metrics.laborCost)} color="#60a5fa" />
                {metrics.totalRealCost > 0 && (
                  <MetricCard label="Coût produits (achat)" value={fmt(metrics.totalRealCost)} color="#f87171" />
                )}
              </MetricGroup>

              {/* Group 5 — Rentabilité */}
              <MetricGroup title="Rentabilité" accent="#10b981">
                <MetricCard label="Profit brut" value={fmt(metrics.profit)}
                  tone={metrics.profit >= 0 ? 'good' : 'bad'} />
                <MetricCard label="Marge %" value={`${metrics.marginPct.toFixed(1)}%`}
                  tone={marginTone(metrics.marginPct, quoteSettings)}
                  sub={`seuil ${quoteSettings.marginThresholdGreen}% / ${quoteSettings.marginThresholdYellow}%`} />
                <MetricCard label="Profit / jour" value={fmt(metrics.profitPerDay)}
                  tone={metrics.profitPerDay > 1500 ? 'good' : metrics.profitPerDay > 800 ? 'warn' : 'bad'} />
                <MetricCard label="Profit / homme / jour" value={fmt(metrics.profitPerManDay)}
                  tone={metrics.profitPerManDay > 500 ? 'good' : metrics.profitPerManDay > 250 ? 'warn' : 'bad'} />
              </MetricGroup>

              {/* Group 6 — Cadence */}
              <MetricGroup title="Cadence attendue" accent="#818cf8">
                <MetricCard label="Cadence (paq/h)" value={metrics.cadencePkgH > 0 ? metrics.cadencePkgH.toFixed(1) : '—'} sub="paquets / h" color="#818cf8" />
                <MetricCard label="Cadence (pi²/h)" value={metrics.cadenceSqftH > 0 ? metrics.cadenceSqftH.toFixed(0) : '—'} sub="pi² / h" color="#818cf8" />
              </MetricGroup>
              {/* Smart alerts strip */}
              {(() => {
                const alerts = buildSmartAlerts({
                  marginPct: metrics.marginPct,
                  pricePerSqft: metrics.pricePerSqft,
                  installPricePerH: metrics.installPricePerH,
                  tearoffPricePerH: metrics.tearoffPricePerH,
                  totalPkgs: metrics.totalPkgs,
                  installHours: metrics.installHours,
                  totalDays: metrics.totalDays,
                  surfaceCorrigee: metrics.surfaceCorrigee,
                }, quoteSettings);
                if (!alerts.length) return null;
                return (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {alerts.map((a, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: `${TONE_COLORS[a.tone]}14`,
                        border: `1px solid ${TONE_COLORS[a.tone]}55`,
                        borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: TONE_COLORS[a.tone], fontWeight: 600,
                      }}>
                        {a.tone === 'good' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                        <span>{a.message}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
      )}

      {/* ── Settings dialog: Métriques clés ── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg" style={{ background: '#0f172a', color: '#e5e7eb', border: '1px solid rgba(99,102,241,0.3)' }}>
          <DialogHeader>
            <DialogTitle style={{ color: '#c7d2fe', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Settings size={16} /> Paramètres — Métriques clés
            </DialogTitle>
          </DialogHeader>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
            <SettingRow label="Hommes par défaut" value={quoteSettings.defaultCrewSize} step={1} min={1}
              onChange={v => setQuoteSettings(s => ({ ...s, defaultCrewSize: v }))} />
            <SettingRow label="Couv. / paquet (pi²)" value={quoteSettings.defaultCoveragePerPkg} step={0.1} min={1}
              onChange={v => setQuoteSettings(s => ({ ...s, defaultCoveragePerPkg: v }))} />
            <SettingRow label="Taux horaire ($)" value={quoteSettings.hourlyRate} step={1} min={1}
              onChange={v => setQuoteSettings(s => ({ ...s, hourlyRate: v }))} />
            <SettingRow label="Seuil marge vert (%)" value={quoteSettings.marginThresholdGreen} step={1} min={0}
              onChange={v => setQuoteSettings(s => ({ ...s, marginThresholdGreen: v }))} />
            <SettingRow label="Seuil marge jaune (%)" value={quoteSettings.marginThresholdYellow} step={1} min={0}
              onChange={v => setQuoteSettings(s => ({ ...s, marginThresholdYellow: v }))} />
            <SettingRow label="Seuil marge / ligne (%)" value={quoteSettings.lineMarginThreshold} step={1} min={0}
              onChange={v => setQuoteSettings(s => ({ ...s, lineMarginThreshold: v }))} />
            <SettingRow label="Plancher prix pose ($/h)" value={quoteSettings.installPriceFloor} step={0.05} min={0}
              onChange={v => setQuoteSettings(s => ({ ...s, installPriceFloor: v }))} />
            <SettingRow label="Plancher prix arrachage ($/h)" value={quoteSettings.tearoffPriceFloor} step={0.05} min={0}
              onChange={v => setQuoteSettings(s => ({ ...s, tearoffPriceFloor: v }))} />
            <SettingRow label="Plancher prix / pi² ($)" value={quoteSettings.pricePerSqftFloor} step={0.1} min={0}
              onChange={v => setQuoteSettings(s => ({ ...s, pricePerSqftFloor: v }))} />
            <div>
              <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Mode taxes</div>
              <select value={quoteSettings.taxesMode}
                onChange={e => setQuoteSettings(s => ({ ...s, taxesMode: e.target.value as 'sans' | 'avec' }))}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 12 }}>
                <option value="sans">Sans taxes</option>
                <option value="avec">Avec taxes</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, gap: 8 }}>
            <button onClick={() => setQuoteSettings({ ...DEFAULT_QUOTE_SETTINGS })}
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: '#9ca3af', borderRadius: 6, padding: '6px 12px', fontSize: 11, cursor: 'pointer' }}>
              Réinitialiser
            </button>
            <button onClick={() => setSettingsOpen(false)}
              style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.5)', color: '#c7d2fe', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Fermer
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── FULL-WIDTH: Postes du devis ── */}
      {finalQuote && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <SectionTitle icon={<Ruler size={14} />} title="Postes du devis" />
                <button onClick={openQboEstimateImport}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6,
                    background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.3)',
                    color: '#60a5fa', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>
                  <FileDown size={13} /> Importer devis QB
                </button>
              </div>

              <div style={{ borderRadius: 8, overflow: isMobile ? 'auto' : 'hidden', border: '1px solid rgba(255,255,255,0.06)', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: isMobile ? 900 : undefined }}>
                  <thead>
                    <tr style={{ background: 'rgba(25,25,50,0.8)' }}>
                      <th style={{ ...thSt, textAlign: 'center' }}>Take-off</th>
                      <th style={{ ...thSt, textAlign: 'center' }}>Couv./unité</th>
                      <th style={{ ...thSt, textAlign: 'right' }}>Qté mesure</th>
                      <th style={{ ...thSt, textAlign: 'right' }} title="Qté mesure ÷ Couv./unité">Qté mesure/Couv./unité</th>
                      <th style={{ ...thSt, color: '#fbbf24', borderBottom: '2px solid rgba(251,191,36,0.4)' }}>Produit QB</th>
                      <th style={{ ...thSt, textAlign: 'right', color: '#fbbf24', borderBottom: '2px solid rgba(251,191,36,0.4)' }}>Qté</th>
                      <th style={{ ...thSt, textAlign: 'center' }}>Unité</th>
                      <th style={{ ...thSt, color: '#fbbf24', borderBottom: '2px solid rgba(251,191,36,0.4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                          <span>Description</span>
                          <button
                            type="button"
                            onClick={() => {
                              // Vider toutes les descriptions surchargées pour que le fallback
                              // ré-applique le nom du Produit/Service QB lié à chaque ligne.
                              if (!confirm('Remplacer toutes les descriptions par les noms des produits QB liés ?')) return;
                              setLineOverrides(prev => {
                                const next: typeof prev = { ...prev };
                                Object.keys(next).forEach(k => {
                                  const idx = Number(k);
                                  next[idx] = { ...next[idx], description: '' };
                                });
                                // Couvre aussi les lignes de base qui n'ont pas encore d'override.
                                (baseQuote?.lines || []).forEach((_, i) => {
                                  if (!next[i]) next[i] = { description: '' };
                                  else next[i] = { ...next[i], description: '' };
                                });
                                return next;
                              });
                              setExtraLines(prev => prev.map(l => ({ ...l, description: '' })));
                            }}
                            title="Réinitialiser toutes les descriptions avec les noms des produits QB"
                            style={{
                              background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)',
                              color: '#93c5fd', borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 700,
                              cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >↻ QB</button>
                        </div>
                      </th>
                      {/* ── Bloc financier (groupé visuellement) ── */}
                      <th style={{ ...thSt, textAlign: 'right', color: '#fbbf24', borderBottom: '2px solid rgba(251,191,36,0.4)', borderLeft: '2px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.05)' }}>Taux</th>
                      <th style={{ ...thSt, textAlign: 'right', color: '#f87171', background: 'rgba(99,102,241,0.05)' }}>Taux (cost)</th>
                      <th style={{ ...thSt, textAlign: 'center', background: 'rgba(99,102,241,0.05)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <span style={{ color: '#a5b4fc' }}>Marge %</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 7, color: '#6b7280' }}>seuil</span>
                            <input
                              type="number"
                              value={marginThresholdPct}
                              onChange={e => setMarginThresholdPct(Number(e.target.value) || 0)}
                              min={0} max={100}
                              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(165,180,252,0.3)', borderRadius: 3, color: '#a5b4fc', fontFamily: 'monospace', fontWeight: 700, fontSize: 9, width: 32, textAlign: 'right', padding: '1px 3px' }}
                              title="Seuil marge global (%)"
                            />
                            <span style={{ fontSize: 7, color: '#6b7280' }}>%</span>
                          </div>
                        </div>
                      </th>
                      <th style={{ ...thSt, textAlign: 'right', color: '#fbbf24', borderBottom: '2px solid rgba(251,191,36,0.4)', background: 'rgba(99,102,241,0.05)' }}>Total</th>
                      <th style={{ ...thSt, textAlign: 'right', color: '#f87171', background: 'rgba(99,102,241,0.05)', borderRight: '2px solid rgba(99,102,241,0.25)' }}>Total (cost)</th>
                      <th style={{ ...thSt, textAlign: 'center', minWidth: 110 }}>Catégorie</th>
                      <th style={{ ...thSt, width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalQuote.lines.map((line, i) => {
                      const baseLineCount = baseQuote?.lines.length || 0;
                      const hiddenBaseCount = Array.from(hiddenLines).filter(idx => idx >= 0 && idx < baseLineCount).length;
                      const baseLen = Math.max(0, baseLineCount - hiddenBaseCount);
                      const isExtra = i >= baseLen;
                      const extraIdx = i - baseLen;
                      let origBaseIdx = -1;
                      if (!isExtra && baseQuote) {
                        let visCount = 0;
                        for (let j = 0; j < baseQuote.lines.length; j++) {
                          if (!hiddenLines.has(j)) {
                            if (visCount === i) { origBaseIdx = j; break; }
                            visCount++;
                          }
                        }
                      }
                      const mappedToolId = lineMeasureMappings[i] || '';
                      const mappedTool = mappedToolId ? measureTools.find(t => t.id === mappedToolId) : null;
                      // finalQuote.lines already has effective qty/rate/total — just read them
                      const displayQty = line.quantity;
                      const effectiveLineRate = line.rate;
                      const lineTotal = line.total_displayed;
                      // Unit mismatch warning
                      const unitMismatch = mappedTool && (() => {
                        const tU = mappedTool.unit;
                        const lU = line.unit;
                        const linearUnits = ['pi', 'm', 'po'];
                        const areaUnits = ['pi²', 'm²'];
                        const countUnits = ['unité', 'pcs'];
                        const tType = linearUnits.includes(tU) ? 'linear' : areaUnits.includes(tU) ? 'area' : countUnits.includes(tU) ? 'count' : 'other';
                        const lType = linearUnits.includes(lU) ? 'linear' : areaUnits.includes(lU) ? 'area' : countUnits.includes(lU) ? 'count' : 'other';
                        return tType !== lType && lType !== 'other';
                      })();

                      return (
                       <tr key={line._uid || (isExtra ? `x-${extraIdx}` : `b-${origBaseIdx}`)} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                          {/* Take-off — first column */}
                          <td style={{ ...tdSt, textAlign: 'center', minWidth: 100 }}>
                            <select
                              value={mappedToolId}
                              onChange={e => {
                                const toolId = e.target.value;
                                setLineMeasureMappings(prev => ({ ...prev, [i]: toolId }));
                                if (toolId) {
                                  const tool = measureTools.find(t => t.id === toolId);
                                  if (tool?.qbProductId) {
                                    setLineQbProducts(prev => ({ ...prev, [i]: tool.qbProductId! }));
                                    const qbProd = qbProducts.find((p: any) => p.qb_id === tool.qbProductId);
                                    if (qbProd?.unit_price != null) {
                                      const rate = Number(qbProd.unit_price);
                                      if (isExtra) {
                                        updateExtraLine(extraIdx, 'rate', rate);
                                      } else {
                                        updateLineOverride(origBaseIdx, 'rate', rate);
                                      }
                                    }
                                    // Auto-fill unit from QB product coverage_unit
                                    if (qbProd?.coverage_unit) {
                                      const covUnit = qbProd.coverage_unit === 'pi2' ? 'pi²' : qbProd.coverage_unit === 'pi.l.' ? 'pi' : qbProd.coverage_unit;
                                      if (isExtra) {
                                        updateExtraLine(extraIdx, 'unit', covUnit);
                                      } else {
                                        updateLineOverride(origBaseIdx, 'unit', covUnit);
                                      }
                                    }
                                  }
                                }
                              }}
                              style={{
                                background: mappedToolId ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
                                border: `1px solid ${unitMismatch ? 'rgba(251,191,36,0.5)' : mappedToolId ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.08)'}`,
                                color: mappedToolId ? '#34d399' : '#4b5563', borderRadius: 4,
                                padding: '2px 14px 2px 4px', fontSize: 9, outline: 'none', cursor: 'pointer',
                                width: '100%', maxWidth: 110,
                                WebkitAppearance: 'none' as any, appearance: 'none' as any,
                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%234b5563'/%3E%3C/svg%3E")`,
                                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 3px center',
                              }}
                            >
                              <option value="" style={{ background: '#1a1a2e' }}>—</option>
                              {measureTools.filter(t => t.visible && t.correctedValue).map(t => {
                                const baseVal = Number(t.correctedValue) || 0;
                                const sf = t.slopeFactor ?? SLOPE_FACTOR_MAP[t.slopeType || slopeCategory];
                                const maj = t.majoration ?? 0;
                                const total = Math.round(baseVal * sf * (1 + maj / 100));
                                return (
                                  <option key={t.id} value={t.id} style={{ background: '#1a1a2e' }}>
                                    {t.name} ({total} {t.unit})
                                  </option>
                                );
                              })}
                            </select>
                            {unitMismatch && <span title="Unités différentes" style={{ fontSize: 8, color: '#fbbf24' }}>⚠</span>}
                          </td>
                          {/* Couv./unité (moved to 2nd) */}
                          <td style={{ ...tdSt, textAlign: 'center', fontSize: 9, color: '#818cf8' }}>
                            {(() => {
                              const qbProdId = lineQbProducts[i];
                              const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
                              const cv = qbProd?.coverage_value ? Number(qbProd.coverage_value) : 0;
                              const cu = qbProd?.coverage_unit || '';
                              return cv > 0 ? `${cv} ${cu}` : '—';
                            })()}
                          </td>
                          {/* Qté mesure — raw total from tool (with slope+maj) */}
                          <td style={{ ...tdSt, textAlign: 'right', fontSize: 10, fontFamily: 'monospace', color: mappedTool ? '#c4b5fd' : '#4b5563', fontWeight: mappedTool ? 600 : 400 }}>
                            {(() => {
                              if (!mappedTool) return '—';
                              const baseVal = Number(mappedTool.correctedValue) || 0;
                              if (baseVal === 0) return '—';
                              const sf = mappedTool.slopeFactor ?? SLOPE_FACTOR_MAP[mappedTool.slopeType || slopeCategory];
                              const maj = mappedTool.majoration ?? 0;
                              const total = Math.round(baseVal * sf * (1 + maj / 100));
                              return `${total} ${mappedTool.unit}`;
                            })()}
                          </td>
                          {/* Qté mesure ÷ Couv./unité — computed package qty */}
                          <td style={{ ...tdSt, textAlign: 'right', fontSize: 10, fontFamily: 'monospace', color: mappedTool ? '#34d399' : '#4b5563', fontWeight: mappedTool ? 700 : 400 }}>
                            {(() => {
                              if (!mappedTool) return '—';
                              const baseVal = Number(mappedTool.correctedValue) || 0;
                              if (baseVal === 0) return '—';
                              const sf = mappedTool.slopeFactor ?? SLOPE_FACTOR_MAP[mappedTool.slopeType || slopeCategory];
                              const maj = mappedTool.majoration ?? 0;
                              const qteMesure = baseVal * sf * (1 + maj / 100);
                              const qbProdId = lineQbProducts[i];
                              const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
                              const cv = qbProd?.coverage_value ? Number(qbProd.coverage_value) : 0;
                              if (cv > 0) {
                                const pkgs = Math.ceil(qteMesure / cv);
                                return pkgs;
                              }
                              // No coverage → fall back to raw qty
                              return Math.round(qteMesure);
                            })()}
                          </td>
                          {/* Produit QB */}
                          <td style={{ ...tdSt, minWidth: 160 }}>
                            <select
                              value={lineQbProducts[i] || ''}
                              onChange={e => {
                                const qbId = e.target.value;
                                setLineQbProducts(prev => ({ ...prev, [i]: qbId }));
                                if (qbId) {
                                  const qbProd = qbProducts.find((p: any) => p.qb_id === qbId);
                                  if (qbProd?.unit_price != null) {
                                    const rate = Number(qbProd.unit_price);
                                    if (isExtra) {
                                      updateExtraLine(extraIdx, 'rate', rate);
                                    } else {
                                      updateLineOverride(origBaseIdx, 'rate', rate);
                                    }
                                  }
                                  // Auto-fill cost from QBO purchase_cost (only if no manual override yet)
                                  if (qbProd?.purchase_cost != null && lineCostOverrides[i] == null) {
                                    setLineCostOverrides(prev => ({ ...prev, [i]: Number(qbProd.purchase_cost) }));
                                  }
                                  // Auto-fill unit from QB product coverage_unit
                                  if (qbProd?.coverage_unit) {
                                    const covUnit = qbProd.coverage_unit === 'pi2' ? 'pi²' : qbProd.coverage_unit === 'pi.l.' ? 'pi' : qbProd.coverage_unit;
                                    if (isExtra) {
                                      updateExtraLine(extraIdx, 'unit', covUnit);
                                    } else {
                                      updateLineOverride(origBaseIdx, 'unit', covUnit);
                                    }
                                  }
                                }
                              }}
                              style={{
                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                                color: lineQbProducts[i] ? '#fbbf24' : '#6b7280', borderRadius: 4,
                                padding: '3px 18px 3px 4px', fontSize: 10, outline: 'none', cursor: 'pointer',
                                maxWidth: 200, width: '100%',
                                WebkitAppearance: 'none' as any, appearance: 'none' as any,
                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b7280'/%3E%3C/svg%3E")`,
                                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center',
                              }}
                            >
                              <option value="" style={{ background: '#1a1a2e' }}>— {line.description} —</option>
                              {qbProducts.map((p: any) => (
                                <option key={p.qb_id} value={p.qb_id} style={{ background: '#1a1a2e' }}>
                                  {p.name}{p.unit_price ? ` ($${Number(p.unit_price).toFixed(2)})` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ ...tdSt, textAlign: 'right' }}>
                              <input type="number" value={displayQty || ''}
                                placeholder="0"
                                onFocus={e => e.currentTarget.select()}
                                onChange={e => { const v = e.target.value === '' ? 0 : Number(e.target.value); isExtra ? updateExtraLine(extraIdx, 'quantity', v) : updateLineOverride(origBaseIdx, 'quantity', v); }}
                                style={{ ...miniInputStyle, width: 50, textAlign: 'right' }} />
                          </td>
                          <td style={{ ...tdSt, textAlign: 'center', fontSize: 9 }}>
                            <select
                              value={line.unit}
                              onChange={e => isExtra ? updateExtraLine(extraIdx, 'unit', e.target.value) : updateLineOverride(origBaseIdx, 'unit', e.target.value)}
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, color: '#9ca3af', fontSize: 9, padding: '2px 2px', cursor: 'pointer', textAlign: 'center' }}>
                              {['pi²', 'pi', 'unité', 'pcs', 'heure', 'm²', 'm'].map(u => (
                                <option key={u} value={u} style={{ background: '#1a1a2e' }}>{u}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ ...tdSt, fontSize: 9, color: '#9ca3af' }}>
                              <textarea
                                value={line.description}
                                rows={1}
                                onChange={e => {
                                  const ta = e.currentTarget;
                                  ta.style.height = 'auto';
                                  ta.style.height = ta.scrollHeight + 'px';
                                  isExtra ? updateExtraLine(extraIdx, 'description', e.target.value) : updateLineOverride(origBaseIdx, 'description', e.target.value);
                                }}
                                onFocus={e => { const ta = e.currentTarget; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }}
                                ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                                onKeyDown={e => {
                                  // Shift+Enter or Alt+Enter inserts a newline (default for textarea).
                                  // Plain Enter blurs to commit, mirroring an input's behaviour.
                                  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
                                    e.preventDefault();
                                    (e.currentTarget as HTMLTextAreaElement).blur();
                                  }
                                }}
                                style={{ ...miniInputStyle, width: '100%', minWidth: 80, resize: 'none', overflow: 'hidden', whiteSpace: 'pre-wrap', lineHeight: 1.35, fontFamily: 'inherit' }} />
                          </td>
                          {/* ── Bloc financier ── */}
                          {(() => {
                            const qbProdId = lineQbProducts[i];
                            const qbProd = qbProdId ? qbProducts.find((p: any) => p.qb_id === qbProdId) : null;
                            const qboCost = qbProd?.purchase_cost != null ? Number(qbProd.purchase_cost) : 0;
                            const unitCost = lineCostOverrides[i] != null ? lineCostOverrides[i] : qboCost;
                            const totalCost = unitCost * displayQty;
                            const lineMargePct = effectiveLineRate > 0 ? ((effectiveLineRate - unitCost) / effectiveLineRate) * 100 : 0;
                            const hasCost = unitCost > 0;
                            const margeColor = !hasCost ? '#4b5563'
                              : lineMargePct >= marginThresholdPct ? '#34d399'
                              : lineMargePct >= marginThresholdPct - 10 ? '#fbbf24'
                              : '#f87171';
                            const margeBg = !hasCost ? 'transparent'
                              : lineMargePct >= marginThresholdPct ? 'rgba(52,211,153,0.10)'
                              : lineMargePct >= marginThresholdPct - 10 ? 'rgba(251,191,36,0.10)'
                              : 'rgba(248,113,113,0.10)';
                            const blockBg = 'rgba(99,102,241,0.04)';
                            return (
                              <>
                                {/* Taux */}
                                <td style={{ ...tdSt, textAlign: 'right', background: blockBg, borderLeft: '2px solid rgba(99,102,241,0.25)' }}>
                                  <input type="number" step="0.01" value={effectiveLineRate || ''}
                                    placeholder="0.00"
                                    onFocus={e => e.currentTarget.select()}
                                    onChange={e => { const v = e.target.value === '' ? 0 : Number(e.target.value); isExtra ? updateExtraLine(extraIdx, 'rate', v) : updateLineOverride(origBaseIdx, 'rate', v); }}
                                    style={{ ...miniInputStyle, width: 64, textAlign: 'right', color: '#fbbf24', fontWeight: 600 }} />
                                </td>
                                {/* Taux (cost) — modifiable */}
                                <td style={{ ...tdSt, textAlign: 'right', background: blockBg }}>
                                  <input type="number" step="0.01" value={unitCost || ''}
                                    placeholder="—"
                                    onFocus={e => e.currentTarget.select()}
                                    onChange={e => {
                                      const v = e.target.value === '' ? null : Number(e.target.value);
                                      setLineCostOverrides(prev => {
                                        const n = { ...prev };
                                        if (v == null) delete n[i]; else n[i] = v;
                                        return n;
                                      });
                                    }}
                                    title={qboCost > 0 ? `QBO: $${qboCost.toFixed(2)}` : 'Aucun coût QBO'}
                                    style={{ ...miniInputStyle, width: 60, textAlign: 'right', color: '#f87171', fontWeight: 500 }} />
                                </td>
                                {/* Marge % avec indicateur seuil */}
                                <td style={{ ...tdSt, textAlign: 'center', background: margeBg, fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: margeColor }}>
                                  {hasCost ? `${lineMargePct.toFixed(0)}%` : '—'}
                                </td>
                                {/* Total */}
                                <td style={{ ...tdSt, textAlign: 'right', background: blockBg }}>
                                  <span style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 11 }}>{fmt(lineTotal)}</span>
                                </td>
                                {/* Total (cost) */}
                                <td style={{ ...tdSt, textAlign: 'right', background: blockBg, fontSize: 10, fontFamily: 'monospace', borderRight: '2px solid rgba(99,102,241,0.25)' }}>
                                  {totalCost > 0 ? <span style={{ color: '#f87171' }}>{fmt(totalCost)}</span> : <span style={{ color: '#4b5563' }}>—</span>}
                                </td>
                              </>
                            );
                          })()}
                          {/* Catégorie + sous-types main d'œuvre */}
                          <td style={{ ...tdSt, textAlign: 'center', minWidth: 110, padding: '4px' }}>
                            {(() => {
                              const cat = lineCategories[i];
                              const catDef = LINE_CATEGORIES.find(c => c.value === cat);
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  <select
                                    value={cat || ''}
                                    onChange={e => {
                                      const v = e.target.value as LineCategory | '';
                                      setLineCategories(prev => {
                                        const n = { ...prev };
                                        if (!v) delete n[i]; else n[i] = v;
                                        return n;
                                      });
                                    }}
                                    style={{
                                      background: catDef?.bg || 'rgba(255,255,255,0.04)',
                                      border: `1px solid ${catDef ? catDef.color + '4D' : 'rgba(255,255,255,0.08)'}`,
                                      color: catDef?.color || '#4b5563',
                                      borderRadius: 4, padding: '2px 4px', fontSize: 9, outline: 'none', cursor: 'pointer', width: '100%', fontWeight: 600,
                                    }}>
                                    <option value="" style={{ background: '#1a1a2e' }}>—</option>
                                    {LINE_CATEGORIES.map(c => (
                                      <option key={c.value} value={c.value} style={{ background: '#1a1a2e' }}>{c.label}</option>
                                    ))}
                                  </select>
                                  {cat === 'main_oeuvre' && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
                                      {LABOR_TYPES.map(lt => {
                                        const checked = (lineLaborTypes[i] || []).includes(lt.value);
                                        return (
                                          <label key={lt.value} title={lt.label}
                                            style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: checked ? '#60a5fa' : '#9ca3af', cursor: 'pointer', padding: '2px 5px', borderRadius: 3, background: checked ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${checked ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.06)'}`, fontWeight: 600 }}>
                                            <input type="checkbox" checked={checked}
                                              onChange={e => {
                                                setLineLaborTypes(prev => {
                                                  const cur = prev[i] || [];
                                                  const next = e.target.checked ? [...cur, lt.value] : cur.filter(x => x !== lt.value);
                                                  return { ...prev, [i]: next };
                                                });
                                              }}
                                              style={{ accentColor: '#60a5fa', width: 10, height: 10, margin: 0, cursor: 'pointer' }} />
                                            {lt.label}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ ...tdSt, textAlign: 'center' }}>
                            <button onClick={() => {
                              if (isExtra) {
                                if (line._uid) removeExtraLineByUid(line._uid);
                                else removeExtraLine(extraIdx);
                              }
                              else {
                                shiftDisplayLineMapsAfter(i);
                                setHiddenLines(prev => { const n = new Set(prev); n.add(origBaseIdx); return n; });
                              }
                            }}
                              style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: 2 }}>
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(25,25,50,0.5)' }}>
                      <td colSpan={11} style={{ ...tdSt, fontWeight: 600, color: '#9ca3af', textAlign: 'right' }}>Sous-total</td>
                      <td style={{ ...tdSt, textAlign: 'right', fontWeight: 600, color: '#d1d5db' }}>{fmt(finalQuote.subtotal_displayed)}</td>
                      <td colSpan={3}></td>
                    </tr>
                    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                      <td colSpan={11} style={{ ...tdSt, color: '#9ca3af', textAlign: 'right' }}>TPS (5%)</td>
                      <td style={{ ...tdSt, textAlign: 'right', color: '#9ca3af' }}>{fmt2(finalQuote.tps)}</td>
                      <td colSpan={3}></td>
                    </tr>
                    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                      <td colSpan={11} style={{ ...tdSt, color: '#9ca3af', textAlign: 'right' }}>TVQ (9.975%)</td>
                      <td style={{ ...tdSt, textAlign: 'right', color: '#9ca3af' }}>{fmt2(finalQuote.tvq)}</td>
                      <td colSpan={3}></td>
                    </tr>
                    <tr style={{ borderTop: '2px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)' }}>
                      <td colSpan={11} style={{ ...tdSt, fontWeight: 700, color: '#fff', fontSize: 13, textAlign: 'right' }}>Total final</td>
                      <td style={{ ...tdSt, textAlign: 'right', fontWeight: 700, color: '#34d399', fontSize: 15 }}>{fmt(finalQuote.total_final)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <button onClick={addExtraLine}
                style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(99,102,241,0.1)', border: '1px dashed rgba(99,102,241,0.3)', borderRadius: 8, color: '#a5b4fc', fontSize: 12, padding: '8px 14px', cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                <Plus size={14} /> Ajouter un poste
              </button>

              {/* QB push moved to bottom sticky actions */}
            </div>
          )}
      </div>{/* end collapse wrapper section 4 */}
      </div>{/* end SECTION 4 */}

      {/* ═══════════════ SECTION 5: APERÇU DE LA SOUMISSION ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<Eye size={20} />} title="Aperçu de la soumission" number={5} collapsed={!!collapsedSections[5]} onToggle={() => toggleSection(5)} completion={sectionPct(5)} onCompletionClick={() => setOpenedMissingFor(p => p === 5 ? null : 5)} missingOpen={openedMissingFor === 5} />
        {openedMissingFor === 5 && <MissingFieldsPanel section={5} />}
        <div style={{ display: collapsedSections[5] ? 'none' : 'block' }}>

          {/* ── Aperçu de la soumission (PDF preview + édition manuelle) ── */}
          <QuotePreview
            clientFirst={clientFirst}
            clientLast={clientLast}
            addressText={addressText}
            seqNumber={loadedSeqNumber}
            quote={finalQuote}
            workType={workType}
            effectiveAreaSqft={effectiveAreaSqft}
            slopeCategory={slopeCategory}
            roofType={roofType}
            selectedGamme={selectedGamme}
            selectedMarque={selectedMarque}
            quoteNotes={quoteNotes}
            onQuoteNotesChange={setQuoteNotes}
            paymentTerms={paymentTerms}
            onPaymentTermsChange={setPaymentTerms}
            lineCategories={lineCategories}
            exclusionsList={exclusionsList}
            exclusionsChecked={exclusionsChecked}
            onExclusionsListChange={setExclusionsList}
            onExclusionsCheckedChange={setExclusionsChecked}
            defaultExclusions={DEFAULT_EXCLUSIONS}
            smartVariables={QUOTE_VARIABLE_DEFS}
            smartValues={quoteVarValues}
            confirmed={previewConfirmed}
            onConfirmChange={(key, value) => setPreviewConfirmed(prev => ({ ...prev, [key]: value }))}
            headerFields={{
              ...quoteHeaderFields,
              devisNo: quoteHeaderFields.devisNo || (loadedSeqNumber ? `VB-${loadedSeqNumber}` : ''),
              projectAddress: quoteHeaderFields.projectAddress || (addressText || '').toUpperCase().slice(0, 31),
            }}
            onHeaderFieldsChange={setQuoteHeaderFields}
          />

          {/* ── Confirmation des 4 boîtes de la soumission ── */}
          <div style={{ ...sectionStyle, marginTop: 14 }}>
            {/* Bouton « Valider et pousser vers QBO » sous la fenêtre d'aperçu */}
            {(() => {
              const allConfirmed = previewConfirmed.header && previewConfirmed.notes && previewConfirmed.terms && previewConfirmed.exclusions;
              const section4Ok = (sectionPct(4) || 0) === 100;
              const ready = allConfirmed && section4Ok && !!finalQuote && !pushingToQb;
              return (
                <button onClick={handlePushToQb} disabled={!ready}
                  id="field-preview-qbo-push"
                  style={{
                    width: '100%', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    borderRadius: 12, border: 'none', cursor: ready ? 'pointer' : 'not-allowed',
                    fontSize: 14, fontWeight: 800, letterSpacing: 0.3,
                    background: ready ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'rgba(255,255,255,0.05)',
                    color: ready ? '#fff' : '#6b7280',
                    opacity: ready ? 1 : 0.6,
                    boxShadow: ready ? '0 4px 15px rgba(37,99,235,0.25)' : 'none',
                    transition: 'all 0.2s',
                  }}>
                  {pushingToQb ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
                  {pushingToQb ? 'Envoi en cours…' : 'Valider et pousser vers QuickBooks'}
                </button>
              );
            })()}
            {!((previewConfirmed.header && previewConfirmed.notes && previewConfirmed.terms && previewConfirmed.exclusions) && (sectionPct(4) || 0) === 100) && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>
                Confirmez les 4 sections dans l'aperçu ci-dessus et complétez la section 4 pour activer le bouton.
              </div>
            )}
          </div>

        </div>{/* end collapse wrapper section 5 (split) */}
      </div>{/* end SECTION 5 (split) */}

      {/* ═══════════════ SECTION 6: ENVOI AU CLIENT ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<Send size={20} />} title="Envoi au client" number={6} collapsed={!!collapsedSections[6]} onToggle={() => toggleSection(6)} completion={sectionPct(6)} onCompletionClick={() => setOpenedMissingFor(p => p === 6 ? null : 6)} missingOpen={openedMissingFor === 6} />
        {openedMissingFor === 6 && <MissingFieldsPanel section={6} />}
        <div style={{ display: collapsedSections[6] ? 'none' : 'block' }}>

          {/* ── Courriel d'envoi au client ── */}
          <div style={sectionStyle}>
            <SectionTitle icon={<Send size={14} />} title="Courriel d'envoi au client" />
            <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>
              Envoyez la soumission par courriel au client. Le destinataire reçoit le PDF + des boutons Accepter / Refuser qui mettent à jour le statut dans le portail.
            </p>

            {/* Choix de template */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Modèle de courriel</label>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto', gap: 8 }}>
                <select value={selectedTemplateId} onChange={e => applyTemplate(e.target.value)} style={selectStyle}>
                  {emailTemplates.length === 0 && <option value="">Aucun modèle</option>}
                  {emailTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' ★' : ''}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setEmailEditMode(m => !m)}
                    title={emailEditMode ? 'Verrouiller' : 'Modifier'}
                    style={{
                      padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      background: emailEditMode ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.05)',
                      border: '1px solid ' + (emailEditMode ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.1)'),
                      color: emailEditMode ? '#fbbf24' : '#d1d5db', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {emailEditMode ? <Unlock size={13} /> : <Lock size={13} />}
                    {emailEditMode ? 'Édition' : 'Modifier'}
                  </button>
                  <button
                    onClick={saveCurrentTemplate}
                    disabled={!selectedTemplateId}
                    title="Enregistrer les modifications du modèle courant"
                    style={{
                      padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      background: 'rgba(34,197,94,0.12)',
                      border: '1px solid rgba(34,197,94,0.35)',
                      color: '#86efac', cursor: selectedTemplateId ? 'pointer' : 'not-allowed',
                      opacity: selectedTemplateId ? 1 : 0.5,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <Save size={13} /> Enregistrer
                  </button>
                  <button
                    onClick={saveAsNewTemplate}
                    title="Créer un nouveau modèle à partir du contenu courant"
                    style={{
                      padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      background: 'rgba(99,102,241,0.12)',
                      border: '1px solid rgba(99,102,241,0.35)',
                      color: '#a5b4fc', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <Plus size={13} /> Nouveau
                  </button>
                  <button
                    onClick={setAsDefaultTemplate}
                    disabled={!selectedTemplateId}
                    title="Définir comme modèle par défaut"
                    style={{
                      padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      background: 'rgba(251,191,36,0.10)',
                      border: '1px solid rgba(251,191,36,0.3)',
                      color: '#fcd34d', cursor: selectedTemplateId ? 'pointer' : 'not-allowed',
                      opacity: selectedTemplateId ? 1 : 0.5,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <Star size={13} /> Défaut
                  </button>
                  <button
                    onClick={deleteCurrentTemplate}
                    disabled={!selectedTemplateId}
                    title="Supprimer ce modèle"
                    style={{
                      padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      background: 'rgba(239,68,68,0.10)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: '#fca5a5', cursor: selectedTemplateId ? 'pointer' : 'not-allowed',
                      opacity: selectedTemplateId ? 1 : 0.5,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <Trash2 size={13} /> Supprimer
                  </button>
                </div>
              </div>
            </div>

            {/* Destinataires */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={labelStyle}>À (par défaut : courriel QuickBooks du client)</label>
                <input
                  value={emailToOverride || clientEmail}
                  onChange={e => setEmailToOverride(e.target.value)}
                  placeholder="client@exemple.com"
                  style={{ ...numInputStyle, padding: '8px 10px', width: '100%' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>CC (séparés par virgule)</label>
                  <input value={emailCc} onChange={e => setEmailCc(e.target.value)}
                    list="vb-cc-history"
                    placeholder="estimateur@toituresvb.ca, ..."
                    style={{ ...numInputStyle, padding: '8px 10px', width: '100%' }} />
                  <datalist id="vb-cc-history">
                    {ccHistory.map(e => <option key={e} value={e} />)}
                  </datalist>
                  {ccHistory.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {ccHistory.slice(0, 6).map(addr => {
                        const present = emailCc.split(/[,;]/).map(s => s.trim()).includes(addr);
                        return (
                          <button key={addr} type="button"
                            onClick={() => {
                              const list = emailCc.split(/[,;]/).map(s => s.trim()).filter(Boolean);
                              if (present) {
                                setEmailCc(list.filter(x => x !== addr).join(', '));
                              } else {
                                setEmailCc([...list, addr].join(', '));
                              }
                            }}
                            style={{
                              padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                              background: present ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                              border: '1px solid ' + (present ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.1)'),
                              color: present ? '#a5b4fc' : '#94a3b8', cursor: 'pointer',
                            }}>{present ? '✓ ' : '+ '}{addr}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>CCI (cachés)</label>
                  <input value={emailBcc} onChange={e => setEmailBcc(e.target.value)}
                    list="vb-bcc-history"
                    placeholder="archives@toituresvb.ca"
                    style={{ ...numInputStyle, padding: '8px 10px', width: '100%' }} />
                  <datalist id="vb-bcc-history">
                    {bccHistory.map(e => <option key={e} value={e} />)}
                  </datalist>
                </div>
              </div>
            </div>

            {/* Sujet & corps */}
            <div style={{ marginBottom: 8 }}>
              <SmartTextEditor
                label="Sujet"
                value={emailSubject}
                onChange={setEmailSubject}
                variables={QUOTE_VARIABLE_DEFS}
                values={quoteVarValues}
                multiline={false}
                readOnly={!emailEditMode}
                showPalette={emailEditMode}
                paletteCompact
                fieldStyle={{
                  background: emailEditMode ? 'rgba(251,191,36,0.05)' : 'rgba(255,255,255,0.03)',
                  borderColor: emailEditMode ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.12)',
                }}
              />
            </div>
            <div style={{ marginBottom: 10 }}>
              <SmartTextEditor
                label="Message (drag-and-drop variables, ou tapez {{ pour la suggestion)"
                value={emailBody}
                onChange={setEmailBody}
                variables={QUOTE_VARIABLE_DEFS}
                values={quoteVarValues}
                rows={10}
                readOnly={!emailEditMode}
                showPalette={emailEditMode}
                fieldStyle={{
                  background: emailEditMode ? 'rgba(251,191,36,0.05)' : 'rgba(255,255,255,0.03)',
                  borderColor: emailEditMode ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.12)',
                  fontSize: 12, lineHeight: 1.6,
                }}
              />
            </div>

            {/* ── Pièces jointes (annexe à la soumission) ── */}
            <div style={{
              marginBottom: 12,
              padding: '12px 14px',
              background: 'rgba(99,102,241,0.06)',
              border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Paperclip size={13} style={{ color: '#a5b4fc' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#c7d2fe', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Pièces jointes en annexe à la soumission
                </span>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#e5e7eb' }}>
                  <input
                    type="checkbox"
                    checked={includeOfficialPdf}
                    onChange={e => setIncludeOfficialPdf(e.target.checked)}
                    style={{ accentColor: '#6366f1', width: 14, height: 14, cursor: 'pointer' }}
                  />
                  <FileText size={12} style={{ color: '#10b981' }} />
                  <span style={{ fontWeight: 600 }}>Soumission officielle (PDF)</span>
                  <span style={{ color: '#6b7280', fontSize: 11 }}>— générée automatiquement</span>
                </li>
                {(pdfFiles || []).map((f, i) => {
                  const checked = !excludedAttachments.has(f.name);
                  return (
                    <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#e5e7eb' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAttachment(f.name)}
                        style={{ accentColor: '#6366f1', width: 14, height: 14, cursor: 'pointer' }}
                      />
                      <FileText size={12} style={{ color: '#a5b4fc' }} />
                      <span style={{ fontWeight: 500, opacity: checked ? 1 : 0.5, textDecoration: checked ? 'none' : 'line-through' }}>{f.name}</span>
                      <span style={{ color: '#6b7280', fontSize: 11 }}>
                        — {(f.size / 1024).toFixed(0)} Ko
                      </span>
                    </li>
                  );
                })}
                {(pdfFiles?.length || 0) === 0 && (
                  <li style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', paddingLeft: 20 }}>
                    Aucun document additionnel. Ajoutez-en dans la section « Documents PDF » plus bas.
                  </li>
                )}
              </ul>
            </div>

            {/* Bouton envoi */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                disabled={sendingClientEmail || !finalQuote || (!emailToOverride && !clientEmail)}
                onClick={async () => {
                  setSendingClientEmail(true);
                  setEmailSendResult(null);
                  try {
                    const totalFmt = finalQuote ? `${finalQuote.total_final.toLocaleString('fr-CA', { minimumFractionDigits: 2 })} $` : '—';
                    const clientFullName = `${clientFirst} ${clientLast}`.trim() || clientCompany || 'client';
                    const { resolveTemplate } = await import('@/components/SmartTextEditor');
                    const replaced = (s: string) => resolveTemplate(s || '', quoteVarValues);

                    // ── Générer le PDF de soumission (modèle officiel) et l'uploader pour l'attacher ──
                    let clientPdfUrl: string | null = null;
                    let pdfFilenameBase: string | null = null;
                    if (includeOfficialPdf) try {
                      let satDataUrl: string | null = null;
                      if (lat && lng) {
                        const rawSat = await fetchSatelliteDataUrl(lat, lng, mapParams.zoom || 19, GOOGLE_API_KEY);
                        if (rawSat && buildingGeojson) {
                          satDataUrl = await compositeMapWithPolygons(rawSat, mapParams.centerLat || lat, mapParams.centerLng || lng, mapParams.zoom || 19, buildingGeojson, lotGeojson, polygonAdj);
                        } else {
                          satDataUrl = rawSat;
                        }
                      }
                      const building: BuildingData = {
                        geojson: buildingGeojson, lotGeojson, superficie, perimetre, largeur, profondeur,
                        noLot, slopeCategory, roofType, confidence,
                        productName: selectedGamme || 'Dynasty', productBrand: selectedMarque || 'IKO',
                        colorName: 'Standard',
                        coverageType: `shingle_${roofType}`, satImageDataUrl: satDataUrl,
                      };
                      const baseName = loadedSeqNumber
                        ? `VB_${loadedSeqNumber}_${(addressText || 'SOUMISSION').split(',')[0].toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, '_')}`
                        : `VB_${(addressText || 'SOUMISSION').split(',')[0].toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, '_')}_${Date.now()}`;
                      const pdfCtx: PdfContext = {
                        clientName: clientFullName,
                        address: addressText || 'Adresse non spécifiée',
                        product: `${selectedMarque || 'IKO'} ${selectedGamme || 'Dynasty'}`,
                        color: 'Standard',
                        date: new Date().toLocaleDateString('fr-CA'),
                        quote: finalQuote!,
                        building,
                        pdfFilenameBase: baseName,
                        quoteNotes: quoteNotes || undefined,
                        paymentTerms: paymentTerms || undefined,
                        seqNumber: loadedSeqNumber || undefined,
                        gamme: selectedGamme || undefined,
                        marque: selectedMarque || undefined,
                        effectiveAreaSqft: effectiveAreaSqft || undefined,
                      };
                      const result = await generateQuotePdf(pdfCtx, { returnBlob: true });
                      if (result?.blob) {
                        const safePath = `emails/${baseName}.pdf`;
                        const { error: upErr } = await supabase.storage
                          .from('quote-pdfs')
                          .upload(safePath, result.blob, { contentType: 'application/pdf', upsert: true });
                        if (!upErr) {
                          const __signed = await getSignedQuotePdfUrl(safePath);
          const urlData = { publicUrl: __signed || '' };
                          clientPdfUrl = urlData?.publicUrl || null;
                          pdfFilenameBase = baseName;
                        } else {
                          console.warn('PDF upload failed:', upErr);
                        }
                      }
                    } catch (pdfErr) {
                      console.warn('PDF generation/upload failed, sending email without attachment:', pdfErr);
                    }

                    const { data: { session } } = await supabase.auth.getSession();
                    const token = session?.access_token || '';
                    const res = await fetch(`${FN_BASE}/send-quote-email`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'apikey': ANON_KEY,
                        'Authorization': `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        clientName: clientFullName,
                        clientEmail: emailToOverride || clientEmail,
                        clientPhone, address: addressText,
                        product: selectedGamme, productBrand: selectedMarque,
                        totalFormatted: totalFmt,
                        surfaceFormatted: effectiveAreaSqft ? `${Math.round(effectiveAreaSqft).toLocaleString()} pi²` : '—',
                        slopeLabel: slopeCategory, coverageLabel: selectedCoverageType,
                        dynastyBreakdown: finalQuote,
                        referenceId: loadedSeqNumber ? `VB-${loadedSeqNumber}` : null,
                        soumissionId: loadedId,
                        customSubject: replaced(emailSubject),
                        customBody: replaced(emailBody),
                        ccList: emailCc, bccList: emailBcc,
                        replyTo: 'info@toituresvb.ca',
                        clientPdfUrl,
                        pdfFilenameBase,
                        extraAttachments: (pdfFiles || [])
                          .filter(f => !excludedAttachments.has(f.name))
                          .map(f => ({ name: f.name, url: f.url })),
                      }),
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                      const recipient = emailToOverride || clientEmail || '';
                      setEmailSendResult({ ok: true, msg: `✓ Courriel envoyé au client avec succès à ${recipient}` });
                      rememberRecipients(emailCc, emailBcc);
                    } else {
                      setEmailSendResult({ ok: false, msg: `${data.error || 'Erreur inconnue'}` });
                    }
                  } catch (e) {
                    setEmailSendResult({ ok: false, msg: `${(e as Error).message}` });
                  } finally {
                    setSendingClientEmail(false);
                  }
                }}
                style={{
                  padding: '10px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: (finalQuote && (emailToOverride || clientEmail) && !sendingClientEmail)
                    ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255,255,255,0.06)',
                  border: 'none', color: '#fff',
                  cursor: (finalQuote && (emailToOverride || clientEmail) && !sendingClientEmail) ? 'pointer' : 'not-allowed',
                  opacity: (finalQuote && (emailToOverride || clientEmail)) ? 1 : 0.4,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                {sendingClientEmail ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sendingClientEmail ? 'Envoi en cours...' : 'Envoyer au client'}
              </button>
              {!loadedId && (
                <span style={{ fontSize: 11, color: '#fbbf24' }}>
                  Sauvegardez d'abord la soumission pour activer les boutons Accepter / Refuser.
                </span>
              )}
              {emailSendResult && (
                <span style={{ fontSize: 12, color: emailSendResult.ok ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                  {emailSendResult.msg}
                </span>
              )}
            </div>
          </div>

          <div style={{ ...sectionStyle, borderColor: showWarranty ? 'rgba(201,168,76,0.3)' : undefined }}>
            <button
              onClick={() => setShowWarranty(!showWarranty)}
              style={{
                background: showWarranty ? 'rgba(201,168,76,0.08)' : 'rgba(255,255,255,0.03)',
                border: '1px solid ' + (showWarranty ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.1)'),
                borderRadius: 10, cursor: 'pointer', width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', transition: 'all 0.2s',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Shield size={15} style={{ color: '#c9a84c' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#c9a84c' }}>Certificat de garantie</span>
              </div>
              {showWarranty ? <ChevronUp size={16} style={{ color: '#c9a84c' }} /> : <ChevronDown size={16} style={{ color: '#6b7280' }} />}
            </button>

            {showWarranty && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Durée de garantie (ans)</label>
                    <select value={warrantyYears} onChange={e => setWarrantyYears(Number(e.target.value))} style={selectStyle}>
                      {[1, 2, 3, 5, 7, 10, 15].map(n => (
                        <option key={n} value={n}>{n} an{n > 1 ? 's' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Date de fin des travaux</label>
                    <input type="date" value={warrantyCompletionDate} onChange={e => setWarrantyCompletionDate(e.target.value)}
                      style={{ ...numInputStyle, padding: '8px 10px' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>N° de facture</label>
                    <input value={warrantyInvoice} onChange={e => setWarrantyInvoice(e.target.value)}
                      placeholder="Ex: F-2025-001" style={{ ...numInputStyle, padding: '8px 10px' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Montant du contrat ($)</label>
                    <input type="number" value={warrantyContractAmount}
                      onChange={e => setWarrantyContractAmount(e.target.value)}
                      placeholder={finalQuote ? Math.round(finalQuote.total_final).toString() : '0'}
                      style={{ ...numInputStyle, padding: '8px 10px' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <input type="checkbox" id="warranty-conditions" checked={warrantyIncludeConditions}
                    onChange={e => setWarrantyIncludeConditions(e.target.checked)}
                    style={{ accentColor: '#2563eb' }} />
                  <label htmlFor="warranty-conditions" style={{ fontSize: 11, color: '#9ca3af', cursor: 'pointer' }}>
                    Inclure les conditions détaillées (page 2)
                  </label>
                </div>

                {/* Preview summary */}
                <div style={{
                  marginTop: 12, padding: 10, borderRadius: 8,
                  background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.15)',
                  fontSize: 11, color: '#9ca3af',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Client</span>
                    <span style={{ color: '#d1d5db', fontWeight: 600 }}>{clientFirst} {clientLast}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Adresse</span>
                    <span style={{ color: '#d1d5db', maxWidth: 180, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {addressText ? addressText.split(',')[0] : '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Garantie</span>
                    <span style={{ color: '#34d399', fontWeight: 700 }}>{warrantyYears} an{warrantyYears > 1 ? 's' : ''}</span>
                  </div>
                </div>

                <button onClick={handleGenerateWarranty} disabled={generatingWarranty}
                  style={{
                    marginTop: 12, width: '100%', height: 42, borderRadius: 10, fontWeight: 700, fontSize: 12,
                    background: 'linear-gradient(135deg, #c9a84c, #a88a3a)',
                    border: 'none', color: '#fff', cursor: generatingWarranty ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    opacity: generatingWarranty ? 0.7 : 1,
                    boxShadow: '0 4px 15px rgba(201,168,76,0.3)',
                  }}>
                  {generatingWarranty ? 'Génération…' : <><Shield size={14} /> Télécharger certificat de garantie</>}
                </button>

                <button onClick={() => generateSpecimenCertificatePdf()}
                  style={{
                    marginTop: 8, width: '100%', height: 36, borderRadius: 10, fontWeight: 600, fontSize: 11,
                    background: 'rgba(201,168,76,0.08)',
                    border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                  <FileText size={13} /> Spécimen de certificat
                </button>
              </div>
            )}
          </div>
        </div>{/* end collapse wrapper section 5 */}
      </div>{/* end SECTION 5 */}

      {/* ═══════════════ SECTION 7: PRÉPARATION DE CONTRAT ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<FileText size={20} />} title="Préparation de contrat" number={7} collapsed={!!collapsedSections[7]} onToggle={() => toggleSection(7)} completion={sectionPct(7)} onCompletionClick={() => setOpenedMissingFor(p => p === 7 ? null : 7)} missingOpen={openedMissingFor === 7} />
        {openedMissingFor === 7 && <MissingFieldsPanel section={7} />}
        <div style={{ display: collapsedSections[7] ? 'none' : 'block' }}>

        {/* Sélection du client QBO */}
        <div style={sectionStyle}>
          <SectionTitle icon={<User size={14} />} title="Sélection du client QuickBooks" />
          {selectedQbCustomer ? (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)', fontSize: 11, color: '#34d399', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={14} />
              <span style={{ fontWeight: 700 }}>{selectedQbCustomer.DisplayName}</span>
              <span style={{ color: '#6b7280' }}>{selectedQbCustomer.PrimaryEmailAddr?.Address || ''}</span>
            </div>
          ) : (
            <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', fontSize: 11, color: '#fbbf24' }}>
              ⚠ Aucun client QuickBooks sélectionné — remplissez la section Client ci-dessus
            </div>
          )}
        </div>

        {/* Type de contrat */}
        <div style={sectionStyle}>
          <SectionTitle icon={<FileText size={14} />} title="Modèle de contrat" />
          <div id="field-contract-type" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 12, ...flashStyle('field-contract-type') }}>
            {([
              { key: 'forfaitaire', label: 'Forfaitaire', desc: 'Prix fixe et définitif' },
              { key: 'budgetaire', label: 'Budgétaire', desc: 'Budget par phases' },
              { key: 'cost-plus', label: 'Cost-Plus', desc: 'Coûts réels + honoraires' },
            ] as const).map(ct => (
              <button key={ct.key}
                onClick={() => setContractType(ct.key)}
                style={{
                  padding: '10px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  background: contractType === ct.key ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${contractType === ct.key ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  color: contractType === ct.key ? '#a5b4fc' : '#9ca3af',
                  cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
                }}>
                <div>{ct.label}</div>
                <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2, opacity: 0.7 }}>{ct.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Champs modifiables du contrat */}
        <div style={sectionStyle}>
          <SectionTitle icon={<PenLine size={14} />} title="Champs du contrat" />
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            padding: '8px 10px', borderRadius: 8,
            background: blankContractMode ? 'rgba(251,191,36,0.08)' : 'rgba(99,102,241,0.06)',
            border: `1px solid ${blankContractMode ? 'rgba(251,191,36,0.35)' : 'rgba(99,102,241,0.25)'}`,
            cursor: 'pointer', fontSize: 11, color: '#e2e8f0',
          }}>
            <input type="checkbox" checked={blankContractMode} onChange={e => setBlankContractMode(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <span style={{ fontWeight: 700 }}>Laisser les champs vides (contrat à remplir à la main)</span>
            <span style={{ color: '#9ca3af', marginLeft: 'auto', fontSize: 10 }}>
              {blankContractMode ? 'Les valeurs sont masquées par des lignes vides.' : 'Contrat dynamique : tout est prérempli avec les variables.'}
            </span>
          </label>
          {(() => {
            const fldStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: 11, outline: 'none' };
            const lblStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: '#9ca3af', marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' };
            const gridRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8, marginBottom: 8 };
            const gridRow3: React.CSSProperties = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 8 };
            const gridRow4: React.CSSProperties = { display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 };
            return (
              <>
                {/* Parties */}
                <div style={{ fontSize: 10, fontWeight: 700, color: '#a5b4fc', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Propriétaire</div>
                <div style={gridRow}>
                  <div><label style={lblStyle}>Nom complet</label><input style={fldStyle} value={contractFields.clientName} onChange={e => updateContractField('clientName', e.target.value)} /></div>
                  <div id="field-contract-email" style={flashStyle('field-contract-email')}><label style={lblStyle}>Courriel</label><input style={fldStyle} value={contractFields.clientEmail} onChange={e => updateContractField('clientEmail', e.target.value)} /></div>
                </div>
                <div style={gridRow}>
                  <div><label style={lblStyle}>Adresse</label><input style={fldStyle} value={contractFields.clientAddress} onChange={e => updateContractField('clientAddress', e.target.value)} /></div>
                  <div id="field-contract-phone" style={flashStyle('field-contract-phone')}><label style={lblStyle}>Téléphone</label><input style={fldStyle} value={contractFields.clientPhone} onChange={e => updateContractField('clientPhone', e.target.value)} /></div>
                </div>

                {/* Méta */}
                <div style={{ fontSize: 10, fontWeight: 700, color: '#a5b4fc', marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Informations du contrat</div>
                <div style={gridRow3}>
                  <div id="field-contract-date" style={flashStyle('field-contract-date')}><label style={lblStyle}>Date du contrat</label><input style={fldStyle} value={contractFields.contractDate} onChange={e => updateContractField('contractDate', e.target.value)} /></div>
                  <div id="field-contract-workaddress" style={flashStyle('field-contract-workaddress')}><label style={lblStyle}>Adresse des travaux</label><input style={fldStyle} value={contractFields.workAddress} onChange={e => updateContractField('workAddress', e.target.value)} /></div>
                  <div id="field-contract-devisno" style={flashStyle('field-contract-devisno')}><label style={lblStyle}>No. de devis</label><input style={fldStyle} value={contractFields.devisNo} onChange={e => updateContractField('devisNo', e.target.value)} /></div>
                </div>

                {/* Calendrier */}
                <div style={gridRow}>
                  <div id="field-contract-start" style={flashStyle('field-contract-start')}><label style={lblStyle}>Date de début prévue</label><input type="date" style={fldStyle} value={contractFields.startDate} onChange={e => updateContractField('startDate', e.target.value)} /></div>
                  <div id="field-contract-duration" style={flashStyle('field-contract-duration')}><label style={lblStyle}>Durée estimée (jours ouvrables) — auto</label><input style={fldStyle} type="number" value={contractFields.durationDays} onChange={e => updateContractField('durationDays', e.target.value)} placeholder="ex: 5" /></div>
                </div>

                {/* Type-specific fields */}
                {contractType === 'forfaitaire' && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#34d399', marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Prix forfaitaire</div>
                    <div id="field-contract-amount" style={{ marginBottom: 8, ...flashStyle('field-contract-amount') }}>
                      <label style={lblStyle}>Montant total (taxes incluses)</label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>$</span>
                        <input style={{ ...fldStyle, paddingLeft: 24, fontSize: 14, fontWeight: 700 }} type="number" step="0.01" value={contractFields.prixForfaitaire} onChange={e => updateContractField('prixForfaitaire', e.target.value)} />
                      </div>
                    </div>
                  </>
                )}

                {contractType === 'budgetaire' && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Budgets</div>
                    <div style={gridRow3}>
                      <div>
                        <label style={lblStyle}>Budget — Matériaux</label>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>$</span>
                          <input style={{ ...fldStyle, paddingLeft: 24 }} type="number" step="0.01" value={contractFields.budgetMateriaux} onChange={e => updateContractField('budgetMateriaux', e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <label style={lblStyle}>Budget — Main-d'œuvre</label>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>$</span>
                          <input style={{ ...fldStyle, paddingLeft: 24 }} type="number" step="0.01" value={contractFields.budgetMainOeuvre} onChange={e => updateContractField('budgetMainOeuvre', e.target.value)} />
                        </div>
                      </div>
                      <div id="field-contract-amount" style={flashStyle('field-contract-amount')}>
                        <label style={lblStyle}>Budget total autorisé</label>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>$</span>
                          <input style={{ ...fldStyle, paddingLeft: 24, fontWeight: 700 }} type="number" step="0.01" value={contractFields.budgetTotal} onChange={e => updateContractField('budgetTotal', e.target.value)} />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {contractType === 'cost-plus' && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Paramètres Cost-Plus</div>
                    <div style={gridRow3}>
                      <div>
                        <label style={lblStyle}>Honoraire (%)</label>
                        <div style={{ position: 'relative' }}>
                          <input style={fldStyle} type="number" step="0.5" value={contractFields.honorairePct} onChange={e => updateContractField('honorairePct', e.target.value)} />
                          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 11 }}>%</span>
                        </div>
                      </div>
                      <div id="field-contract-amount" style={flashStyle('field-contract-amount')}>
                        <label style={lblStyle}>Estimation initiale</label>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>$</span>
                          <input style={{ ...fldStyle, paddingLeft: 24 }} type="number" step="0.01" value={contractFields.estimationInitiale} onChange={e => updateContractField('estimationInitiale', e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <label style={lblStyle}>Plafond budgétaire</label>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                          {(['sans', 'avec'] as const).map(pt => (
                            <button key={pt} onClick={() => updateContractField('plafondType', pt)} style={{
                              flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 9, fontWeight: 700,
                              background: contractFields.plafondType === pt ? 'rgba(99,102,241,0.15)' : 'transparent',
                              border: `1px solid ${contractFields.plafondType === pt ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
                              color: contractFields.plafondType === pt ? '#a5b4fc' : '#6b7280', cursor: 'pointer',
                            }}>{pt === 'sans' ? 'Sans plafond' : 'Avec plafond'}</button>
                          ))}
                        </div>
                        {contractFields.plafondType === 'avec' && (
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>$</span>
                            <input style={{ ...fldStyle, paddingLeft: 24 }} type="number" step="0.01" value={contractFields.plafondBudget} onChange={e => updateContractField('plafondBudget', e.target.value)} placeholder="Montant plafond" />
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Reset button */}
                <button onClick={() => setContractFields(prev => ({
                  ...prev,
                  clientName: `${clientFirst} ${clientLast}`.trim(),
                  clientAddress: clientPostalAddress || addressText || '',
                  clientPhone: clientPhone || '',
                  clientEmail: clientEmail || '',
                  dossierNo: loadedSeqNumber ? `VB-${loadedSeqNumber}` : '',
                  workAddress: addressText || '',
                  devisNo: loadedSeqNumber ? `VB-${loadedSeqNumber}` : '',
                  prixForfaitaire: finalQuote ? finalQuote.total_final.toFixed(2) : '',
                  budgetTotal: finalQuote ? finalQuote.subtotal_displayed.toFixed(2) : '',
                  estimationInitiale: finalQuote ? finalQuote.subtotal_displayed.toFixed(2) : '',
                }))} style={{
                  marginTop: 4, padding: '6px 12px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#6b7280',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <RotateCcw size={11} /> Réinitialiser depuis la soumission
                </button>
              </>
            );
          })()}
        </div>

        {/* ── Aperçu du contrat (dropdown) ── */}
        {(() => {
          const contractTypeName = contractType === 'forfaitaire' ? 'Forfaitaire' : contractType === 'budgetaire' ? 'Budgétaire' : 'Cost-Plus';
          return (
            <div style={{
              background: 'rgba(20,20,40,0.6)', borderRadius: 12,
              border: contractDropdownOpen ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.06)',
              marginBottom: 12, overflow: 'hidden',
            }}>
              <button
                onClick={() => setContractDropdownOpen(!contractDropdownOpen)}
                style={{
                  background: contractDropdownOpen ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)',
                  border: '1px solid ' + (contractDropdownOpen ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'),
                  borderRadius: 10, cursor: 'pointer', width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', transition: 'all 0.2s',
                  margin: contractDropdownOpen ? '14px 14px 0' : 0,
                  ...(contractDropdownOpen ? { width: 'calc(100% - 28px)' } : {}),
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={15} style={{ color: '#10b981' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>Aperçu du contrat — {contractTypeName}</span>
                </div>
                {contractDropdownOpen ? <ChevronUp size={16} style={{ color: '#10b981' }} /> : <ChevronDown size={16} style={{ color: '#6b7280' }} />}
              </button>

              {contractDropdownOpen && (
                <div style={{ padding: '12px 14px 14px' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                    fontSize: 11, color: '#a5b4fc',
                  }}>
                    <PenLine size={12} />
                    <span>Champs modifiables directement dans le contrat — cliquez sur un champ souligné pour l'éditer.</span>
                  </div>
                  <div style={{
                    borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)',
                    background: '#fff', minHeight: 400,
                  }}>
                    {contractPreviewStatus === 'ready' && contractHtml ? (
                      <iframe
                        ref={contractIframeRef}
                        srcDoc={contractHtml}
                        style={{ width: '100%', height: 700, border: 'none' }}
                        title="Aperçu du contrat"
                      />
                    ) : contractPreviewStatus === 'error' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, padding: 24, color: '#ef4444', fontSize: 12, textAlign: 'center', gap: 8 }}>
                        <AlertTriangle size={18} />
                        <div>L'aperçu du contrat n'a pas pu être généré.</div>
                        {contractPreviewError ? <div style={{ color: '#9ca3af', maxWidth: 420 }}>{contractPreviewError}</div> : null}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#6b7280', fontSize: 12 }}>
                        <Loader2 size={16} className="animate-spin" style={{ marginRight: 8 }} /> Chargement du contrat…
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      onClick={handleGenerateContractPdf}
                      disabled={contractPreviewStatus !== 'ready' || !contractHtml || generatingContractPdf}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: 8,
                        background: 'linear-gradient(135deg, #059669, #10b981)',
                        border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        opacity: contractPreviewStatus !== 'ready' || !contractHtml ? 0.5 : 1,
                      }}>
                      {generatingContractPdf ? 'Génération…' : <><FileDown size={14} /> Télécharger PDF</>}
                    </button>
                    <button
                      onClick={() => setShowContractFullscreen(true)}
                      disabled={contractPreviewStatus !== 'ready' || !contractHtml}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: 8,
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        opacity: contractPreviewStatus !== 'ready' || !contractHtml ? 0.5 : 1,
                      }}>
                      <Maximize2 size={14} /> Plein écran
                    </button>
                    <button
                      onClick={downloadContractHtml}
                      disabled={contractPreviewStatus !== 'ready' || !contractHtml}
                      style={{
                        padding: '10px 16px', borderRadius: 8,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)', color: '#d1d5db', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        opacity: contractPreviewStatus !== 'ready' || !contractHtml ? 0.5 : 1,
                      }}>
                      <FileDown size={14} /> HTML
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        </div>{/* end collapse wrapper section 6 */}
      </div>{/* end SECTION 6 */}

      {/* Dialog moved OUTSIDE section 6 to prevent Radix overlay from blocking sections 7-8 */}
      {/* Plein écran contrat — overlay simple (PAS un Dialog Radix : son focus-trap
          + scroll-lock gèlent le défilement et l'édition de l'iframe sur iOS). */}
      {showContractFullscreen && (
        <div
          role="dialog" aria-modal="true" aria-label="Contrat plein écran"
          style={{
            position: 'fixed', inset: 0, zIndex: 11000, background: '#0a0a14',
            display: 'flex', flexDirection: 'column',
            paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)', background: '#0a0a1e' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#e5e7eb' }}>Contrat — plein écran</span>
            <button
              onClick={() => setShowContractFullscreen(false)}
              style={{ padding: '10px 22px', borderRadius: 8, border: '1px solid #556', background: 'rgba(255,255,255,0.06)', color: '#e5e7eb', fontSize: 14, fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', flexShrink: 0 }}
            >Fermer</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, background: '#fff' }}>
            {contractHtml ? (
              <iframe
                srcDoc={contractHtml}
                title="Contrat plein écran"
                style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
              />
            ) : (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 13 }}>
                Le contrat n'est pas encore prêt.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════ SECTION 7: GESTION DOCUMENTAIRE ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<PenLine size={20} />} title="Signature électronique" number={8} collapsed={!!collapsedSections[8]} onToggle={() => toggleSection(8)} completion={null} />
        <div style={{ display: collapsedSections[8] ? 'none' : 'block' }}>
          <ContractSignatureStep
            soumissionId={loadedId}
            contractHtml={contractHtml}
            defaultClient={{ name: contractFields.clientName, email: contractFields.clientEmail, phone: contractFields.clientPhone }}
            defaultContractor={{ name: 'Toitures VB Inc.', email: 'info@toituresvb.ca' }}
            sectionStyle={sectionStyle}
            isMobile={isMobile}
          />
        </div>
      </div>

      {/* ═══════════════ SECTION 9: GESTION DOCUMENTAIRE ═══════════════ */}
      <div style={majorSectionStyle}>
        <MajorSectionTitle icon={<FolderOpen size={20} />} title="Gestion documentaire" number={9} collapsed={!!collapsedSections[9]} onToggle={() => toggleSection(9)} completion={sectionPct(8)} />
        <div style={{ display: collapsedSections[9] ? 'none' : 'block' }}>

          {/* ── PDF Attachments / Dépôt de documents ── */}
          <div style={sectionStyle}>
            <SectionTitle icon={<FileText size={14} />} title="Documents (PDF & images)" />
            <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>
              Déposez ou glissez vos fichiers PDF et images (contrats, plans, photos, captures Street View, etc.)
            </p>
            <input ref={pdfInputRef} type="file" accept="application/pdf,image/*" multiple onChange={handlePdfUpload}
              style={{ display: 'none' }} />
            <div
              onClick={() => pdfInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(165,180,252,0.6)'; }}
              onDragLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.15)'; }}
              onDrop={e => { handleDocDrop(e); (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.15)'; }}
              style={{
                width: '100%', padding: '18px 0', borderRadius: 8,
                border: '2px dashed rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.03)',
                color: '#a5b4fc', fontSize: 12, fontWeight: 600, cursor: uploadingPdf ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'border-color 0.2s', textAlign: 'center',
              }}>
              {uploadingPdf
                ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Téléversement…</>
                : <><Plus size={14} /> Cliquer ou glisser des fichiers (PDF / JPG / PNG)</>}
            </div>
            {pdfFiles.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pdfFiles.map((f, i) => {
                  const isImg = /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i.test(f.name);
                  const isContactPhoto = isImg && contactPhotoUrl === f.url;
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                      background: isContactPhoto ? 'rgba(16,185,129,0.08)' : 'rgba(0,0,0,0.2)', borderRadius: 8,
                      border: '1px solid ' + (isContactPhoto ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.06)'),
                    }}>
                      {isImg ? (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, lineHeight: 0 }}>
                          <img src={f.url} alt={f.name} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)' }} />
                        </a>
                      ) : (
                        <FileText size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                      )}
                      <a href={f.url} target="_blank" rel="noopener noreferrer"
                        style={{ flex: 1, color: '#d1d5db', fontSize: 11, fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.name}{isContactPhoto && <span style={{ marginLeft: 6, color: '#10b981', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>· Photo contact</span>}
                      </a>
                      <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>
                        {(f.size / 1024).toFixed(0)} Ko
                      </span>
                      {isImg && (
                        <button
                          type="button"
                          onClick={() => setContactPhotoUrl(isContactPhoto ? null : f.url)}
                          title={isContactPhoto ? 'Retirer comme photo de contact' : 'Utiliser comme photo de contact (.vcf)'}
                          style={{
                            background: isContactPhoto ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.04)',
                            border: '1px solid ' + (isContactPhoto ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.1)'),
                            color: isContactPhoto ? '#34d399' : '#9ca3af',
                            borderRadius: 6, padding: '3px 6px', fontSize: 9, fontWeight: 700,
                            cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3,
                          }}>
                          <UserPlus size={10} /> {isContactPhoto ? 'Photo ✓' : 'Photo'}
                        </button>
                      )}
                      <button onClick={() => removePdfFile(i)} style={{
                        background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 2, flexShrink: 0,
                      }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Aperçu du contrat déplacé dans la section Préparation de contrat */}

      {/* Générateur de liste de matériaux */}
        <div style={sectionStyle}>
          <SectionTitle icon={<Layers size={14} />} title="Générateur de liste de matériaux" />
          <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>
            Générez automatiquement une liste de matériaux basée sur les mesures du take-off.
          </p>
          <button
            onClick={handleGenerateMaterialList}
            disabled={!finalQuote || generatingMaterialList}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 8,
              background: finalQuote ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.06)',
              border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: finalQuote && !generatingMaterialList ? 'pointer' : 'not-allowed',
              opacity: finalQuote ? 1 : 0.4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {generatingMaterialList ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Génération…</> : <><Layers size={14} /> Générer la liste de matériaux</>}
          </button>
        </div>
        </div>{/* end collapse wrapper section 9 */}
      </div>{/* end SECTION 9 */}

      {/* ═══════════════ SECTION 10: ESTIMATION ORIGINALE ═══════════════ */}
      {(originalEstimateLow || originalEstimateHigh || originalSubtotal) && (
        <div style={majorSectionStyle}>
          <MajorSectionTitle icon={<Eye size={20} />} title="Estimation vue par le client" number={10} collapsed={!!collapsedSections[10]} onToggle={() => toggleSection(10)} completion={sectionPct(9)} />
          <div style={{ display: collapsedSections[10] ? 'none' : 'block' }}>
            <div style={sectionStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 16, textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Estimation basse</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace' }}>
                    {originalEstimateLow ? `${Math.round(originalEstimateLow).toLocaleString('fr-CA')} $` : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Estimation haute</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#34d399', fontFamily: 'monospace' }}>
                    {originalEstimateHigh ? `${Math.round(originalEstimateHigh).toLocaleString('fr-CA')} $` : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Sous-total affiché</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#a5b4fc', fontFamily: 'monospace' }}>
                    {originalSubtotal ? `${Math.round(originalSubtotal).toLocaleString('fr-CA')} $` : '—'}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 10, color: '#4b5563', textAlign: 'center', fontStyle: 'italic' }}>
                Fourchette de prix présentée au client lors de sa soumission en ligne
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ ÉTAPE 11 — CLÔTURE DE PROJET ═══════════════ */}
      {loadedId && (
        <div>
          <MajorSectionTitle icon={<Calculator size={20} />} title="Clôture de projet" number={11} collapsed={!!collapsedSections[11]} onToggle={() => toggleSection(11)} completion={null} />
          <div style={{ display: collapsedSections[11] ? 'none' : 'block' }}>
            <div style={sectionStyle}>
              <ProjectCloseout soumissionId={loadedId} revenue={Number(originalSubtotal) || 0} />
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ ACTIONS FIXES ═══════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16, paddingBottom: isMobile ? 88 : 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
          <button onClick={handleGeneratePdf} disabled={generatingPdf || !finalQuote}
            style={{
              height: 52, borderRadius: 12, fontWeight: 700, fontSize: 13, letterSpacing: 0.3,
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              border: '1px solid rgba(245,158,11,0.4)', color: '#fff',
              cursor: generatingPdf || !finalQuote ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: !finalQuote ? 0.4 : 1,
              boxShadow: '0 4px 15px rgba(245,158,11,0.25)',
              transition: 'all 0.2s',
            }}>
            {generatingPdf ? 'Génération…' : <><FileDown size={16} /> Télécharger PDF</>}
          </button>
          {!isMobile && <button onClick={() => handleSave()} disabled={saving || !finalQuote}
            style={{
              height: 52, borderRadius: 12, fontWeight: 700, fontSize: 13, letterSpacing: 0.3,
              background: saved ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: '1px solid ' + (saved ? 'rgba(34,197,94,0.4)' : 'rgba(99,102,241,0.4)'), color: '#fff',
              cursor: saving || !finalQuote ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: !finalQuote ? 0.4 : 1,
              boxShadow: saved ? '0 4px 15px rgba(34,197,94,0.25)' : '0 4px 15px rgba(99,102,241,0.25)',
              transition: 'all 0.2s',
            }}>
            {saving ? 'Sauvegarde…' : saved ? '✓ Sauvegardé !' : <><Save size={16} /> Sauvegarder</>}
          </button>}
        </div>
        <button onClick={handlePushToQb} disabled={pushingToQb || !finalQuote}
          style={{
            width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            borderRadius: 12, border: 'none', cursor: pushingToQb || !finalQuote ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 700,
            background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff',
            opacity: !finalQuote ? 0.4 : pushingToQb ? 0.7 : 1,
            boxShadow: '0 4px 15px rgba(37,99,235,0.25)',
            transition: 'all 0.2s',
          }}>
          {pushingToQb ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
          {pushingToQb ? 'Envoi en cours…' : 'Pousser vers QuickBooks'}
        </button>
        {qbPushResult && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600,
            background: qbPushResult.success ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${qbPushResult.success ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
            color: qbPushResult.success ? '#34d399' : '#f87171',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>{qbPushResult.message}</span>
            {qbPushResult.pdfUrl && (
              <button onClick={downloadQbPdf} style={{
                display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(52,211,153,0.15)',
                border: '1px solid rgba(52,211,153,0.3)', borderRadius: 6, padding: '5px 10px',
                color: '#34d399', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}>
                <FileText size={12} /> Télécharger PDF QB
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Floating Tool Config Panel ── */}
      {showToolConfig && (
        <div style={{
          position: 'fixed', zIndex: 9990,
          left: isMobile ? 0 : Math.max(8, Math.min(toolConfigPos.x, (typeof window !== 'undefined' ? window.innerWidth : 1280) - toolConfigSize.w - 8)),
          top: isMobile ? 0 : Math.max(8, Math.min(toolConfigPos.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 80)),
          width: isMobile ? '100%' : Math.min(toolConfigSize.w, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 16),
          height: isMobile ? '100%' : Math.min(toolConfigSize.h, (typeof window !== 'undefined' ? window.innerHeight : 800) - 16),
          maxWidth: '100vw', maxHeight: '100vh',
          background: 'rgba(15,15,35,0.98)', border: isMobile ? 'none' : '1px solid rgba(99,102,241,0.3)',
          borderRadius: isMobile ? 0 : 12, boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          paddingTop: isMobile ? 'env(safe-area-inset-top)' : undefined,
          paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : undefined,
        }}>
          {/* Draggable header */}
          <div onMouseDown={handleConfigMouseDown}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
              cursor: 'grab', userSelect: 'none', background: 'rgba(25,25,55,0.8)',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GripVertical size={14} style={{ color: '#4b5563' }} />
              <Settings size={14} style={{ color: '#a5b4fc' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe' }}>Configuration des outils de mesure</span>
            </div>
            <button onClick={() => setShowToolConfig(false)} aria-label="Fermer la configuration des outils"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#9ca3af', width: isMobile ? 44 : 28, height: isMobile ? 44 : 28, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              ✕
            </button>
          </div>

          {/* Table */}
          <div style={{ overflowY: 'auto', overflowX: isMobile ? 'auto' : undefined, padding: 12, WebkitOverflowScrolling: 'touch' }}>
            {isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {measureTools.map(tool => {
                  const isLinked = !!tool.linkedTo;
                  const linkedSource = isLinked ? measureTools.find(t => t.id === tool.linkedTo) : null;
                  const toolFamily = (tt: ToolType) => tt === 'Surface bâtiment' ? 'Surface' : tt === 'Périmètre bâtiment' ? 'Ligne' : tt;
                  const linkableTools = measureTools.filter(t => t.id !== tool.id && toolFamily(t.toolType) === toolFamily(tool.toolType));
                  const isBldgSrc = isBuildingSourceType(tool.toolType);
                  const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 9, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' };
                  return (
                    <div key={tool.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12, background: 'rgba(25,25,50,0.35)', opacity: isLinked ? 0.85 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: tool.color, flexShrink: 0 }} />
                        <input value={tool.name} onChange={e => updateTool(tool.id, 'name', e.target.value)} style={{ ...miniInputStyle, flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13 }} />
                        <button onClick={() => updateTool(tool.id, 'visible', !tool.visible)} aria-label="Visibilité" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: tool.visible ? '#34d399' : '#4b5563' }}>
                          {tool.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                        </button>
                        <button onClick={() => removeTool(tool.id)} aria-label="Supprimer" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: '#f87171' }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <label style={{ ...fieldLabel, gridColumn: '1 / -1' }}>Type d'outil
                          <select value={tool.toolType} onChange={e => updateTool(tool.id, 'toolType', e.target.value)} style={{ ...miniInputStyle, width: '100%', padding: '6px 6px', cursor: 'pointer', background: isBldgSrc ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)', borderColor: isBldgSrc ? 'rgba(99,102,241,0.3)' : undefined }}>
                            <optgroup label="── Mesures – 2D ──" style={{ background: '#1a1a2e' }}>
                              {TOOL_TYPES.map(tt => <option key={tt} value={tt} style={{ background: '#1a1a2e' }}>{tt} - 2D</option>)}
                            </optgroup>
                            <optgroup label="── Mesures – 3D ──" style={{ background: '#1a1a2e' }}>
                              {TOOL_TYPES_3D.map(t => <option key={t.value} value={t.value} style={{ background: '#1a1a2e' }}>{t.label} - 3D</option>)}
                            </optgroup>
                          </select>
                        </label>
                        <label style={fieldLabel}>Unité
                          <select value={tool.unit} onChange={e => updateTool(tool.id, 'unit', e.target.value)} style={{ ...miniInputStyle, width: '100%', padding: '6px 6px', cursor: 'pointer', background: 'rgba(255,255,255,0.06)' }}>
                            {(UNITS_BY_TOOL_TYPE[tool.toolType] || ['pi', 'unité']).map(u => <option key={u} value={u} style={{ background: '#1a1a2e' }}>{u}</option>)}
                          </select>
                        </label>
                        <label style={fieldLabel}>Couleur
                          <input type="color" value={tool.color} onChange={e => updateTool(tool.id, 'color', e.target.value)} style={{ width: '100%', height: 34, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer', background: 'transparent', padding: 2 }} />
                        </label>
                        <label style={{ ...fieldLabel, gridColumn: '1 / -1' }}>Lié à
                          <select value={tool.linkedTo || ''} onChange={e => handleLinkedToChange(tool.id, e.target.value)} style={{ ...miniInputStyle, width: '100%', padding: '6px 6px', cursor: 'pointer', background: isLinked ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)', borderColor: isLinked ? 'rgba(52,211,153,0.3)' : undefined }}>
                            <option value="" style={{ background: '#1a1a2e' }}>— Aucun —</option>
                            {linkableTools.map(lt => <option key={lt.id} value={lt.id} style={{ background: '#1a1a2e' }}>🔗 {lt.name}</option>)}
                          </select>
                          {isLinked && linkedSource && <span style={{ fontSize: 9, color: '#34d399', textTransform: 'none' }}>= {linkedSource.name}</span>}
                        </label>
                        <label style={{ ...fieldLabel, gridColumn: '1 / -1' }}>Produit/Service QBO
                          <select value={tool.qbProductId || ''} onChange={e => updateTool(tool.id, 'qbProductId', e.target.value)} style={{ ...miniInputStyle, width: '100%', padding: '6px 6px', cursor: 'pointer', background: tool.qbProductId ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.06)', borderColor: tool.qbProductId ? 'rgba(251,191,36,0.3)' : undefined }}>
                            <option value="" style={{ background: '#1a1a2e' }}>— Aucun —</option>
                            {qbProducts.map((p: any) => <option key={p.qb_id} value={p.qb_id} style={{ background: '#1a1a2e' }}>{p.name}</option>)}
                          </select>
                        </label>
                        {tool.toolType === 'Compteur' && (
                          <label style={fieldLabel}>Forme
                            <select value={tool.markerShape || 'circle'} onChange={e => updateTool(tool.id, 'markerShape', e.target.value)} style={{ ...miniInputStyle, width: '100%', padding: '6px 6px', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', fontSize: 16 }}>
                              {MARKER_SHAPES.map(s => <option key={s.value} value={s.value} style={{ background: '#1a1a2e' }}>{s.label}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'rgba(25,25,50,0.8)' }}>
                  <th style={thSt}>Outils</th>
                  <th style={thSt}>Type d'outil</th>
                  
                  <th style={thSt}>Lié à</th>
                  <th style={thSt}>Produit/Service QBO</th>
                  <th style={{ ...thSt, textAlign: 'center' }}>Unité</th>
                  <th style={{ ...thSt, textAlign: 'center' }}>Couleur</th>
                  <th style={{ ...thSt, textAlign: 'center', width: 40 }}>Forme</th>
                  <th style={{ ...thSt, textAlign: 'center', width: 40 }}>Vis.</th>
                  <th style={{ ...thSt, width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {measureTools.map(tool => {
                  const isLinked = !!tool.linkedTo;
                  const linkedSource = isLinked ? measureTools.find(t => t.id === tool.linkedTo) : null;
                  const toolFamily = (tt: ToolType) => tt === 'Surface bâtiment' ? 'Surface' : tt === 'Périmètre bâtiment' ? 'Ligne' : tt;
                  const linkableTools = measureTools.filter(t => t.id !== tool.id && toolFamily(t.toolType) === toolFamily(tool.toolType));
                  const isBldgSrc = isBuildingSourceType(tool.toolType);

                  return (
                  <tr key={tool.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', opacity: isLinked ? 0.7 : 1 }}>
                    <td style={tdSt}>
                      <input value={tool.name} onChange={e => updateTool(tool.id, 'name', e.target.value)}
                        style={{ ...miniInputStyle, width: '100%' }} />
                    </td>
                    <td style={tdSt}>
                      <select value={tool.toolType} onChange={e => updateTool(tool.id, 'toolType', e.target.value)}
                        style={{ ...miniInputStyle, width: '100%', padding: '3px 4px', cursor: 'pointer', background: isBldgSrc ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)', borderColor: isBldgSrc ? 'rgba(99,102,241,0.3)' : undefined }}>
                        {/* <optgroup> labels = entêtes non-cliquables (HTML).
                            Le suffixe « - 2D » / « - 3D » est inclus dans le label
                            de chaque option : ainsi quand le select est fermé,
                            on voit p.ex. « Faîtière - 3D » et on sait d'où vient
                            la valeur du compteur. */}
                        <optgroup label="── Mesures – 2D ──" style={{ background: '#1a1a2e' }}>
                          {TOOL_TYPES.map(tt => <option key={tt} value={tt} style={{ background: '#1a1a2e' }}>{tt} - 2D</option>)}
                        </optgroup>
                        <optgroup label="── Mesures – 3D ──" style={{ background: '#1a1a2e' }}>
                          {TOOL_TYPES_3D.map(t => <option key={t.value} value={t.value} style={{ background: '#1a1a2e' }}>{t.label} - 3D</option>)}
                        </optgroup>
                      </select>
                    </td>
                    <td style={tdSt}>
                      <select value={tool.linkedTo || ''} onChange={e => handleLinkedToChange(tool.id, e.target.value)}
                        style={{ ...miniInputStyle, width: '100%', padding: '3px 4px', cursor: 'pointer', background: isLinked ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)', borderColor: isLinked ? 'rgba(52,211,153,0.3)' : undefined, fontSize: 10 }}>
                        <option value="" style={{ background: '#1a1a2e' }}>— Aucun —</option>
                        {linkableTools.map(lt => (
                          <option key={lt.id} value={lt.id} style={{ background: '#1a1a2e' }}>🔗 {lt.name}</option>
                        ))}
                      </select>
                      {isLinked && linkedSource && (
                        <div style={{ fontSize: 8, color: '#34d399', marginTop: 2 }}>= {linkedSource.name}</div>
                      )}
                    </td>
                    <td style={tdSt}>
                      <select value={tool.qbProductId || ''} onChange={e => updateTool(tool.id, 'qbProductId', e.target.value)}
                        style={{ ...miniInputStyle, width: '100%', minWidth: 120, padding: '3px 4px', cursor: 'pointer', background: tool.qbProductId ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.06)', borderColor: tool.qbProductId ? 'rgba(251,191,36,0.3)' : undefined, fontSize: 10 }}>
                        <option value="" style={{ background: '#1a1a2e' }}>— Aucun —</option>
                        {qbProducts.map((p: any) => (
                          <option key={p.qb_id} value={p.qb_id} style={{ background: '#1a1a2e' }}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...tdSt, textAlign: 'center' }}>
                      <select value={tool.unit} onChange={e => updateTool(tool.id, 'unit', e.target.value)}
                        style={{ ...miniInputStyle, width: 50, textAlign: 'center', padding: '3px 2px', cursor: 'pointer', background: 'rgba(255,255,255,0.06)' }}>
                        {(UNITS_BY_TOOL_TYPE[tool.toolType] || ['pi', 'unité']).map(u => (
                          <option key={u} value={u} style={{ background: '#1a1a2e' }}>{u}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...tdSt, textAlign: 'center' }}>
                      <input type="color" value={tool.color} onChange={e => updateTool(tool.id, 'color', e.target.value)}
                        style={{ width: 24, height: 20, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, cursor: 'pointer', background: 'transparent', padding: 0 }} />
                    </td>
                    <td style={{ ...tdSt, textAlign: 'center' }}>
                      {tool.toolType === 'Compteur' ? (
                        <select value={tool.markerShape || 'circle'} onChange={e => updateTool(tool.id, 'markerShape', e.target.value)}
                          style={{ ...miniInputStyle, width: 36, textAlign: 'center', padding: '2px 0', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', fontSize: 14 }}>
                          {MARKER_SHAPES.map(s => <option key={s.value} value={s.value} style={{ background: '#1a1a2e' }}>{s.label}</option>)}
                        </select>
                      ) : (
                        <span style={{ fontSize: 9, color: '#4b5563' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...tdSt, textAlign: 'center' }}>
                      <button onClick={() => updateTool(tool.id, 'visible', !tool.visible)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: tool.visible ? '#34d399' : '#4b5563' }}>
                        {tool.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    </td>
                    <td style={{ ...tdSt, textAlign: 'center' }}>
                      <button onClick={() => removeTool(tool.id)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: '#f87171' }}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            )}
            <button onClick={addTool}
              style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(99,102,241,0.1)', border: '1px dashed rgba(99,102,241,0.3)', borderRadius: 8, color: '#a5b4fc', fontSize: 11, padding: '6px 12px', cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
              <Plus size={12} /> Ajouter un outil
            </button>
          </div>
          {/* Resize handle */}
          <div onMouseDown={handleConfigResizeDown}
            style={{
              position: 'absolute', right: 0, bottom: 0, width: 18, height: 18,
              cursor: 'nwse-resize', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.4 }}>
              <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}

      {/* Copilot IA */}
      <CopilotChat
        context={{
          address: addressText,
          lat, lng,
          superficie, perimetre, noLot,
          roofType, slopeCategory,
          areaSqft: areaSqftOverride || (superficie ? Math.round(superficie * 10.7639) : null),
          perimeterFt: perimeterFtOverride || (perimetre ? Math.round(perimetre * 3.28084) : null),
          lines: finalQuote?.lines?.map((l, i) => ({ index: i, ...l })) || [],
          subtotal: finalQuote?.subtotal_displayed,
          total: finalQuote?.total_final,
          clientName: `${clientFirst} ${clientLast}`.trim(),
          clientEmail, clientPhone,
          selectedCoverageType,
          selectedMarque, selectedGamme,
        }}
        onApplyEdits={(edits) => {
          for (const edit of edits) {
            if (edit.action === 'add') {
              setExtraLines(prev => [...prev, {
                _uid: newUid(),
                description: edit.description || 'Nouveau poste',
                quantity: edit.quantity || 1,
                unit: edit.unit || 'forfait',
                rate: edit.rate || 0,
                total_base: (edit.quantity || 1) * (edit.rate || 0),
                ratio: 0,
                total_displayed: 0,
              }]);
            } else if (edit.action === 'update' && edit.lineIndex != null) {
              const overrides: Partial<QuoteLine> = {};
              if (edit.description) overrides.description = edit.description;
              if (edit.quantity != null) overrides.quantity = edit.quantity;
              if (edit.unit) overrides.unit = edit.unit;
              if (edit.rate != null) overrides.rate = edit.rate;
              setLineOverrides(prev => ({
                ...prev,
                [edit.lineIndex!]: { ...(prev[edit.lineIndex!] || {}), ...overrides },
              }));
            } else if (edit.action === 'remove' && edit.lineIndex != null) {
              setHiddenLines(prev => new Set([...prev, edit.lineIndex!]));
            }
          }
        }}
      />
      {/* QBO Estimate Import Dialog */}
      <Dialog open={qboEstimateDialogOpen} onOpenChange={setQboEstimateDialogOpen}>
        <DialogContent className="sm:max-w-lg" style={{ maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'hsl(230,22%,8%)', border: '1px solid rgba(99,102,241,0.2)', color: '#e5e7eb' }}>
          <DialogHeader>
            <DialogTitle style={{ color: '#e2e8f0' }}>Importer un devis QuickBooks</DialogTitle>
          </DialogHeader>

          {/* Step 1: Customer search */}
          {!qboEstSelectedCustomer && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflow: 'hidden' }}>
              <div style={{ position: 'relative' }}>
                <Search style={{ position: 'absolute', left: 10, top: 10, width: 14, height: 14, color: '#6b7280' }} />
                <input
                  placeholder="Rechercher un client QBO..."
                  value={qboEstSearch}
                  onChange={e => setQboEstSearch(e.target.value)}
                  style={{ width: '100%', padding: '8px 8px 8px 32px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#e5e7eb', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div style={{ overflow: 'auto', flex: 1, maxHeight: 350 }}>
                {qboEstLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: '#6b7280' }} />
                  </div>
                ) : (
                  qboEstCustomers.filter(c => c.display_name.toLowerCase().includes(qboEstSearch.toLowerCase())).map((c: any) => (
                    <button key={c.id} onClick={() => selectQboEstCustomer(c)}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: '#e5e7eb', fontSize: 13 }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ fontWeight: 600 }}>{c.display_name}</div>
                      {c.bill_address && <div style={{ fontSize: 11, color: '#6b7280' }}>{c.bill_address}</div>}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Step 2: Estimates list */}
          {qboEstSelectedCustomer && !qboEstSelectedEstimate && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setQboEstSelectedCustomer(null)}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 8px', color: '#9ca3af', fontSize: 11, cursor: 'pointer' }}>
                  ← Retour
                </button>
                <span style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 600 }}>{qboEstSelectedCustomer.display_name}</span>
              </div>
              <div style={{ overflow: 'auto', flex: 1, maxHeight: 350 }}>
                {qboEstimatesLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: '#6b7280' }} />
                  </div>
                ) : qboEstimates.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#6b7280', padding: 24, fontSize: 13 }}>Aucun devis trouvé pour ce client</p>
                ) : (
                  qboEstimates.map((est: any) => (
                    <button key={est.id} onClick={() => selectQboEstimate(est)}
                      style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', color: '#e5e7eb', fontSize: 12, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}>
                      <div>
                        <div style={{ fontWeight: 600 }}>Devis #{est.doc_number || est.id}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          {est.txn_date} • {est.line_count} poste{est.line_count > 1 ? 's' : ''}
                          {est.status && ` • ${est.status}`}
                        </div>
                      </div>
                      <span style={{ fontWeight: 700, color: '#34d399', fontFamily: 'monospace' }}>${Number(est.total).toFixed(2)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Step 3: Estimate lines preview + import */}
          {qboEstSelectedEstimate && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => { setQboEstSelectedEstimate(null); setQboEstLines([]); }}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 8px', color: '#9ca3af', fontSize: 11, cursor: 'pointer' }}>
                  ← Retour
                </button>
                <span style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 600 }}>
                  Devis #{qboEstSelectedEstimate.doc_number || qboEstSelectedEstimate.id} — ${Number(qboEstSelectedEstimate.total).toFixed(2)}
                </span>
              </div>
              <div style={{ overflow: 'auto', flex: 1, maxHeight: 300, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
                {qboEstLinesLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: '#6b7280' }} />
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'rgba(25,25,50,0.8)' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', color: '#9ca3af', fontSize: 10 }}>Description</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', color: '#9ca3af', fontSize: 10 }}>Qté</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', color: '#9ca3af', fontSize: 10 }}>Taux</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', color: '#9ca3af', fontSize: 10 }}>Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qboEstLines.map((l: any, i: number) => (
                        <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '5px 8px', color: '#d1d5db' }}>{l.description || l.item_name}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#d1d5db', fontFamily: 'monospace' }}>{l.quantity}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#d1d5db', fontFamily: 'monospace' }}>${Number(l.rate).toFixed(2)}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#34d399', fontWeight: 600, fontFamily: 'monospace' }}>${Number(l.amount).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {qboEstLines.length > 0 && (
                <button onClick={() => setQbImportMode('append')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 700,
                    background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff',
                  }}>
                  <FileDown size={14} /> Importer {qboEstLines.length} ligne{qboEstLines.length > 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dialogue : mode d'importation des lignes QuickBooks ── */}
      <Dialog open={qbImportMode !== null} onOpenChange={(o) => { if (!o) setQbImportMode(null); }}>
        <DialogContent style={{ maxWidth: 520, background: 'linear-gradient(180deg, rgba(20,20,40,0.98), rgba(15,15,30,0.98))', border: '1px solid rgba(99,102,241,0.25)', color: '#e2e8f0' }}>
          <DialogHeader>
            <DialogTitle style={{ color: '#e2e8f0', fontSize: 17 }}>Comment importer ces {qboEstLines.length} ligne{qboEstLines.length > 1 ? 's' : ''} ?</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 14px 0', lineHeight: 1.5 }}>
            Choisissez comment traiter les lignes provenant du devis QuickBooks par rapport à la soumission en cours.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => importQboEstimateLines('append')}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                padding: '14px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.4)', color: '#dbeafe',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
                <Plus size={14} /> Ajouter à la soumission existante
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                Conserve toutes les lignes calculées et ajoute les lignes QuickBooks à la suite.
              </div>
            </button>
            <button
              onClick={() => importQboEstimateLines('replace')}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                padding: '14px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.4)', color: '#fde68a',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
                <RefreshCcw size={14} /> Utiliser uniquement les lignes importées
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>
                Masque les lignes calculées et garde seulement les lignes provenant de QuickBooks.
              </div>
            </button>
            <button
              onClick={() => setQbImportMode(null)}
              style={{
                marginTop: 4, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#9ca3af',
                fontSize: 12, fontWeight: 600,
              }}
            >
              Annuler
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ MOBILE STICKY ACTION BAR (Sauvegarder toujours visible) ═══════════════ */}
      {isMobile && (
        <div
          style={{
            position: 'fixed',
            left: 0, right: 0, bottom: 0,
            zIndex: 1000,
            // Fond opaque : le precedent backdrop-filter:blur(12px) forçait le
            // GPU à recalculer le flou de tout ce qui scrollait derrière la
            // barre à chaque frame → killer #1 de la fluidité mobile.
            background: 'rgb(11,11,22)',
            borderTop: '1px solid rgba(99,102,241,0.25)',
            padding: '10px 12px calc(10px + env(safe-area-inset-bottom)) 12px',
            display: 'flex', gap: 8, alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Haut de page"
            style={{
              height: 48, width: 48, flexShrink: 0,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#9ca3af',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <ChevronDown size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={saving}
            style={{
              flex: 1, height: 48, borderRadius: 12,
              fontWeight: 800, fontSize: 14, letterSpacing: 0.3,
              background: saved
                ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                : !finalQuote
                  ? 'linear-gradient(135deg, #4338ca, #6d28d9)'
                  : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: '1px solid ' + (saved ? 'rgba(34,197,94,0.5)' : 'rgba(99,102,241,0.5)'),
              color: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: saved ? '0 4px 18px rgba(34,197,94,0.35)' : '0 4px 18px rgba(99,102,241,0.4)',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Sauvegarde…' : saved ? '✓ Sauvegardé !' : (
              <><Save size={16} /> {finalQuote ? 'Sauvegarder' : 'Sauvegarder le brouillon'}</>
            )}
          </button>
        </div>
      )}

      {takeoffOpen && (
        <Suspense fallback={null}>
          <TakeoffFullscreen
            draftId={loadedId || addressText || null}
            initialModel={roof3dModel}
            initialView={roof3dView}
            onViewChange={setRoof3dView}
            initialGeoRef={roof3dGeoRef}
            onGeoRefChange={(g: any) => {
              setRoof3dGeoRef(g);
              // Persiste le géoréf en DB tout de suite → le fond gelé revient à
              // la réouverture, même sans sauvegarde explicite.
              const lid = loadedIdRef.current;
              if (lid && g) {
                (async () => {
                  try {
                    const { data: cur } = await supabase.from('soumissions').select('dynasty_breakdown').eq('id', lid).single();
                    const bd = { ...(((cur as any)?.dynasty_breakdown) || {}), roof3d_georef: g };
                    await supabase.from('soumissions').update({ dynasty_breakdown: bd } as any).eq('id', lid);
                  } catch { /* non bloquant */ }
                })();
              }
            }}
            initialDraft={roof3dTakeoffDraft}
            onAutosaveDraft={async (takeoff: any | null) => {
              // 1) tampon en mémoire (toujours)
              setRoof3dTakeoffDraft(takeoff);
              // 2) flush sur Supabase si la soumission a un id. Si pas encore
              //    d'id (brand-new), on attend que l'autosave parent en crée un —
              //    voir l'effet de flush plus bas (loadedId → flush bufferisé).
              if (!loadedId) return;
              try {
                // jsonb libre — cast pour éviter une régénération des types.
                await supabase.from('soumissions').update({ takeoff_draft: takeoff } as any).eq('id', loadedId);
              } catch (e) { console.warn('takeoff_draft autosave failed:', e); }
            }}
            mapSeed={{ lat, lng, address: addressText || null }}
            onApplyPatch={(patch: any) => {
              const t = patch?.roofTakeoff;
              const m = t?.derived?.measurements;
              // Modèle 3D canonique (roof-core RoofModel) → persisté avec la
              // soumission et réinjecté comme initialModel au rechargement.
              if (patch?.roof3dModel) setRoof3dModel(patch.roof3dModel);
              if (m && m.roof3dAreaM2 > 0) setSuperficie(m.roof3dAreaM2);        // module stores m²
              if (m && m.totalPerimeterM > 0) setPerimetre(m.totalPerimeterM);   // m
              const sc = normalizeSlopeCategory(patch?.slope);
              if (sc) setSlopeCategory(sc);
              // Assemble les mesures 3D en unités d'affichage (pi²/pi/compte) pour
              // la table d'outils (Phase 1 : stockées + persistées, pas encore lues).
              let measuresObj: any = null;
              if (m) {
                const M2_TO_SQFT = 10.7639, M_TO_FT = 3.28084;
                const lk = m.linealByKind || {};
                const byPitch: Record<string, number> = {};
                Object.keys(m.areaByPitchM2 || {}).forEach(k => { byPitch[k] = +((m.areaByPitchM2[k] || 0) * M2_TO_SQFT).toFixed(1); });
                measuresObj = {
                  roofAreaSqft: +((m.roof3dAreaM2 || 0) * M2_TO_SQFT).toFixed(1),
                  areaByPitchSqft: byPitch,
                  ridgeFt: +((lk.RIDGE || 0) * M_TO_FT).toFixed(1),
                  hipFt: +((lk.HIP || 0) * M_TO_FT).toFixed(1),
                  valleyFt: +((lk.VALLEY || 0) * M_TO_FT).toFixed(1),
                  eaveFt: +((lk.EAVE || 0) * M_TO_FT).toFixed(1),
                  membraneFt: +((m.membraneM || 0) * M_TO_FT).toFixed(1),
                  maximumCount: Number(patch?.roof3dMaximumCount) || 0,
                  dominantPitchX12: m.dominantPitchX12 || 0,
                  computedAt: new Date().toISOString(),
                };
                setRoof3dMeasures(measuresObj);
              }
              // ── Persistance IMMÉDIATE en DB du modèle validé ──
              // La validation efface le takeoff_draft ; sans ça, rouvrir avant une
              // sauvegarde explicite perd tout. On fusionne roof3d_model/measures
              // dans dynasty_breakdown tout de suite (non bloquant).
              const lid = loadedIdRef.current;
              if (lid && patch?.roof3dModel) {
                (async () => {
                  try {
                    const { data: cur } = await supabase.from('soumissions').select('dynasty_breakdown').eq('id', lid).single();
                    const bd = { ...(((cur as any)?.dynasty_breakdown) || {}), roof3d_model: patch.roof3dModel, ...(measuresObj ? { roof3d_measures: measuresObj } : {}) };
                    await supabase.from('soumissions').update({ dynasty_breakdown: bd } as any).eq('id', lid);
                  } catch { /* non bloquant */ }
                })();
              }
            }}
            onClose={() => setTakeoffOpen(false)}
          />
        </Suspense>
      )}

    </div>
  );
};

/* ── Sub-components ── */
const MajorSectionTitle: React.FC<{ icon: React.ReactNode; title: string; number: number; collapsed?: boolean; onToggle?: () => void; completion?: number | null; onCompletionClick?: () => void; missingOpen?: boolean }> = ({ icon, title, number, collapsed, onToggle, completion, onCompletionClick, missingOpen }) => (
  <div
    role="button"
    tabIndex={onToggle ? 0 : undefined}
    onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
    onKeyDown={(e) => { if (onToggle && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } }}
    style={{
      display: 'flex', alignItems: 'center', gap: 12,
      marginBottom: collapsed ? 0 : 16, paddingBottom: collapsed ? 0 : 12,
      borderBottom: collapsed ? 'none' : '2px solid rgba(99,102,241,0.25)',
      cursor: onToggle ? 'pointer' : 'default', userSelect: 'none',
      background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
      width: '100%', textAlign: 'left',
      padding: '8px 4px', position: 'relative', zIndex: 5,
      pointerEvents: 'auto',
    }}>
    <div style={{
      width: 32, height: 32, borderRadius: 8,
      background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.15))',
      border: '1px solid rgba(99,102,241,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#a5b4fc', fontSize: 14, fontWeight: 800, flexShrink: 0,
    }}>{number}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <span style={{ color: '#a5b4fc', display: 'flex', alignItems: 'center' }}>{icon}</span>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0', letterSpacing: 0.3, margin: 0 }}>{title}</h2>
    </div>
    {completion != null && (
      completion >= 100 ? (
        <span
          title="Section complète"
          onClick={(e) => { e.stopPropagation(); onCompletionClick?.(); }}
          style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, borderRadius: 999,
          background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.45)',
          color: '#22c55e', flexShrink: 0, cursor: onCompletionClick ? 'pointer' : 'default',
        }}>
          <Check size={15} strokeWidth={3} />
        </span>
      ) : (
        <span
          title="Cliquer pour voir les champs à compléter"
          onClick={(e) => { e.stopPropagation(); onCompletionClick?.(); }}
          style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 44, height: 24, padding: '0 8px', borderRadius: 999,
          background: missingOpen ? 'rgba(251,191,36,0.25)' : 'rgba(251,191,36,0.12)',
          border: '1px solid rgba(251,191,36,0.45)',
          color: '#fbbf24', fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          flexShrink: 0, letterSpacing: 0.2, cursor: onCompletionClick ? 'pointer' : 'default',
        }}>
          {completion}%
        </span>
      )
    )}
    {onToggle && (
      <span style={{ color: '#6b7280', transition: 'transform 0.2s', transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}>
        <ChevronDown size={18} />
      </span>
    )}
  </div>
);

const majorSectionStyle: React.CSSProperties = {
  background: 'rgba(15,15,40,0.5)',
  borderRadius: 16,
  border: '1px solid rgba(99,102,241,0.12)',
  padding: '20px 14px',
  marginBottom: 24,
  overflow: 'hidden',
  position: 'relative',
  zIndex: 1,
};

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <h2 style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
    {icon} {title}
  </h2>
);

const SettingRow: React.FC<{ label: string; value: number; step?: number; min?: number; onChange: (v: number) => void }> = ({ label, value, step = 1, min, onChange }) => (
  <div>
    <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
    <input type="number" value={value} step={step} min={min}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'monospace' }} />
  </div>
);

const InfoBadge: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color = '#fbbf24' }) => (
  <span style={{
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6, padding: '4px 8px', fontSize: 10, display: 'inline-flex', gap: 4, alignItems: 'center',
  }}>
    <span style={{ color: '#6b7280' }}>{label}:</span>
    <span style={{ color, fontWeight: 600, fontFamily: 'monospace' }}>{value}</span>
  </span>
);

const MetricCard: React.FC<{ label: string; value: string; sub?: string; color?: string; tone?: Tone }> = ({ label, value, sub, color, tone }) => {
  const toneColor = tone ? TONE_COLORS[tone] : undefined;
  const finalColor = toneColor ?? color ?? '#f3f4f6';
  const accent = tone ? `${toneColor}55` : 'rgba(255,255,255,0.08)';
  const bg = tone ? `${toneColor}14` : 'rgba(255,255,255,0.03)';
  return (
    <div style={{
      background: bg, borderRadius: 6, padding: '6px 10px',
      border: `1px solid ${accent}`,
      transition: 'border-color .15s, background .15s',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      minHeight: 32,
    }}>
      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.2 }}>
        <div style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        {sub && <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: finalColor, fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>{value}</div>
    </div>
  );
};

const MetricGroup: React.FC<{ title: string; accent?: string; children: React.ReactNode }> = ({ title, accent = '#a5b4fc', children }) => (
  <div style={{ marginTop: 10 }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5,
      fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: 0.8,
    }}>
      <span style={{ width: 3, height: 11, background: accent, borderRadius: 2 }} />
      <span>{title}</span>
      <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${accent}66, transparent)` }} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 6 }}>
      {children}
    </div>
  </div>
);

const topBtnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  background: active ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
  border: `1px solid ${active ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
  color: active ? '#c7d2fe' : '#9ca3af',
});

const thSt: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, color: '#9ca3af', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left' };
const tdSt: React.CSSProperties = { padding: '5px 8px' };
const miniInputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff', borderRadius: 4, padding: '3px 6px', fontSize: 11, fontFamily: 'monospace', outline: 'none',
};
const measureBtnStyle: React.CSSProperties = {
  border: '1px solid', borderRadius: 6, padding: '6px 7px', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};

export default AdminQuoteGenerator;
