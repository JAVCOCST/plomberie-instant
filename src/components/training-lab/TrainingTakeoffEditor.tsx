import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, Trash2, Plus, Ruler, ChevronDown, ChevronRight, Star, AlertTriangle, Ban, CheckCircle2, FileJson, ExternalLink, Wrench, FlaskConical } from 'lucide-react';
import html2canvas from 'html2canvas';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import BuildingReadOnlyMap from '@/components/roofing/immersive/BuildingReadOnlyMap';
import MapToolbox from '@/components/roofing/immersive/MapToolbox';
import SkeletonTestModal from '@/components/training-lab/SkeletonTestModal';
import RoofSectionsEditor from '@/components/training-lab/RoofSectionsEditor';
import {
  buildSectionsBundle,
  sectionsToExtraPolylines,
  edgesToExtraPolylines,
  extractMainRingLatLng,
  applyRingAdjustments,
  SECTION_TYPE_COLORS,
  SECTION_TYPE_LABELS,
  type RoofSection,
  type RoofSectionsBundle,
} from '@/lib/roof-sections';
import type {
  AnnotationInfo,
  AdjustControls,
  MapToolboxControls,
  PolygonAdjustments,
  MeasureTarget,
} from '@/components/roofing/immersive/BuildingReadOnlyMap';
import {
  parseGeojsonValue,
  recoverTakeoffGeometryFromSoumission,
  STATUS_LABELS,
  STATUS_COLORS,
  type DatasetStatus,
  type TrainingTakeoff,
} from '@/lib/training-lab';
import { computeSkeletonLatLng } from '@/lib/skeleton-overlay';
import { toast } from 'sonner';

/* ── Types ── */
type ToolType = 'Ligne' | 'Multi-segment' | 'Surface' | 'Compteur';

interface TLTool {
  id: string;
  name: string;
  toolType: ToolType;
  unit: string;
  color: string;
  visible: boolean;
  manualValue: string; // optional manual override when no annotations
}

const DEFAULT_TL_TOOLS: TLTool[] = [
  { id: 'faitiere', name: 'Faîtière', toolType: 'Ligne', unit: 'pi', color: '#ef4444', visible: true, manualValue: '' },
  { id: 'aretes', name: 'Arêtes', toolType: 'Ligne', unit: 'pi', color: '#f97316', visible: true, manualValue: '' },
  { id: 'noues', name: 'Noues', toolType: 'Multi-segment', unit: 'pi', color: '#3b82f6', visible: true, manualValue: '' },
  { id: 'noues_membrane', name: 'Noues membrane', toolType: 'Ligne', unit: 'pi', color: '#06b6d4', visible: true, manualValue: '' },
  { id: 'events', name: 'Évents / sorties', toolType: 'Compteur', unit: 'unité', color: '#22c55e', visible: true, manualValue: '' },
  { id: 'maximums', name: 'Maximums', toolType: 'Ligne', unit: 'pi', color: '#8b5cf6', visible: true, manualValue: '' },
  { id: 'cheminees', name: 'Cheminées', toolType: 'Compteur', unit: 'unité', color: '#a78bfa', visible: true, manualValue: '' },
  { id: 'lanterneaux', name: 'Lanterneaux', toolType: 'Compteur', unit: 'unité', color: '#f43f5e', visible: true, manualValue: '' },
  { id: 'surface_extra', name: 'Surface annexe', toolType: 'Surface', unit: 'pi²', color: '#10b981', visible: true, manualValue: '' },
];

const UNITS_BY_TOOL_TYPE: Record<ToolType, string[]> = {
  Surface: ['pi²', 'm²'],
  Ligne: ['pi', 'm', 'po'],
  Compteur: ['unité', 'pcs'],
  'Multi-segment': ['pi', 'm', 'po'],
};

const TOOL_COLORS = ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e'];

/* ── Helpers ── */
function extractRings(geo: any): [number, number][][] {
  if (!geo) return [];
  const g = geo.type === 'Feature' ? geo.geometry : geo;
  if (!g) return [];
  if (g.type === 'Polygon') return (g.coordinates || []) as any;
  if (g.type === 'MultiPolygon') return ((g.coordinates || []) as any[]).flat();
  if (g.type === 'FeatureCollection') return (g.features || []).flatMap((f: any) => extractRings(f));
  return [];
}

function centroidLngLat(geo: any): [number, number] | null {
  const rings = extractRings(geo);
  const pts = rings.flat();
  if (!pts.length) return null;
  const sx = pts.reduce((s, p) => s + p[0], 0);
  const sy = pts.reduce((s, p) => s + p[1], 0);
  return [sx / pts.length, sy / pts.length];
}

const TAKEOFF_DRAFT_VERSION = 1;
function readTakeoffDraft(id: string): { savedAt: string; annotations_json: any; version: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`training_takeoff_draft_${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.version === TAKEOFF_DRAFT_VERSION && parsed?.annotations_json ? parsed : null;
  } catch {
    return null;
  }
}

function timestampMs(value: any): number {
  const n = Date.parse(String(value || ''));
  return Number.isFinite(n) ? n : 0;
}

/* ── Component ── */
interface Props {
  takeoff: TrainingTakeoff;
  onClose: () => void;
  onSaved: (patch: Partial<TrainingTakeoff>) => void | Promise<void>;
  onRecovered?: (patch: Partial<TrainingTakeoff>) => void | Promise<void>;
  /** Patch immédiat (changement statut / score / tags) sans fermer l'éditeur. */
  onPatch?: (patch: Partial<TrainingTakeoff>) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

export default function TrainingTakeoffEditor({ takeoff, onClose, onSaved, onRecovered, onPatch, onDelete }: Props) {
  const isMobile = useIsMobile();
  const [recoveredPatch, setRecoveredPatch] = useState<Partial<TrainingTakeoff> | null>(null);
  const effectiveTakeoff = useMemo(() => ({ ...takeoff, ...(recoveredPatch || {}) }) as TrainingTakeoff, [takeoff, recoveredPatch]);
  const rawBuildingGeo = effectiveTakeoff.corrected_building_geojson || effectiveTakeoff.original_building_geojson;
  const rawLotGeo = effectiveTakeoff.corrected_lot_geojson || effectiveTakeoff.original_lot_geojson;
  const buildingGeo = useMemo(() => parseGeojsonValue(rawBuildingGeo), [rawBuildingGeo]);
  const lotGeo = useMemo(() => parseGeojsonValue(rawLotGeo), [rawLotGeo]);

  const center = useMemo(() => {
    const c = centroidLngLat(buildingGeo) || centroidLngLat(lotGeo);
    return c ? { lat: c[1], lng: c[0] } : null;
  }, [buildingGeo, lotGeo]);

  const buildingStr = useMemo(() => (buildingGeo ? JSON.stringify(buildingGeo) : ''), [buildingGeo]);
  const lotStr = useMemo(() => (lotGeo ? JSON.stringify(lotGeo) : null), [lotGeo]);

  /* persisted state from annotations_json + crash-safe local draft */
  const draftStorageKey = `training_takeoff_draft_${takeoff.id}`;
  const basePersisted = useMemo(() => (
    effectiveTakeoff.annotations_json && typeof effectiveTakeoff.annotations_json === 'object'
      ? effectiveTakeoff.annotations_json as any
      : {}
  ), [effectiveTakeoff.annotations_json]);
  const localDraft = useMemo(() => readTakeoffDraft(takeoff.id), [takeoff.id]);
  const persisted = useMemo(() => {
    const dbUpdatedAt = timestampMs(basePersisted?.meta?.updated_at || effectiveTakeoff.updated_at || effectiveTakeoff.created_at);
    const draftUpdatedAt = timestampMs(localDraft?.savedAt);
    if (localDraft?.annotations_json && draftUpdatedAt > dbUpdatedAt) {
      return {
        ...basePersisted,
        ...localDraft.annotations_json,
        meta: { ...(basePersisted.meta || {}), ...(localDraft.annotations_json.meta || {}), draft_restored_at: localDraft.savedAt },
      };
    }
    return basePersisted;
  }, [basePersisted, effectiveTakeoff.updated_at, effectiveTakeoff.created_at, localDraft]);

  const [tools, setTools] = useState<TLTool[]>(
    Array.isArray(persisted.tools) && persisted.tools.length ? persisted.tools : DEFAULT_TL_TOOLS,
  );
  const measureColors = useMemo(() => Object.fromEntries(tools.map((t) => [t.id, t.color])), [tools]);
  const measureLabels = useMemo(() => Object.fromEntries(tools.map((t) => [t.id, t.name])), [tools]);
  const measureToolTypes = useMemo(() => Object.fromEntries(tools.map((t) => [t.id, t.toolType])), [tools]);
  const measureMarkerShapes = useMemo(() => Object.fromEntries(tools.map((t) => [t.id, 'circle'])), [tools]);
  const [annotations, setAnnotations] = useState<AnnotationInfo[]>(
    Array.isArray(persisted.annotations) ? persisted.annotations : [],
  );
  const [polygonAdj, setPolygonAdj] = useState<PolygonAdjustments | undefined>(persisted.polygon_adj);
  const [lotAdj, setLotAdj] = useState<PolygonAdjustments | undefined>(persisted.lot_adj);

  const [mapParams, setMapParams] = useState(() => ({
    centerLat: persisted?.map_params?.centerLat ?? center?.lat ?? 46.81,
    centerLng: persisted?.map_params?.centerLng ?? center?.lng ?? -71.21,
    zoom: persisted?.map_params?.zoom ?? 20,
  }));
  const [measureMode, setMeasureMode] = useState<MeasureTarget>(null);
  const [deleteAnnotIdx, setDeleteAnnotIdx] = useState<number | null>(null);
  const [clearAllAnnotations, setClearAllAnnotations] = useState(false);
  const [adjustControls, setAdjustControls] = useState<AdjustControls | null>(null);
  const [mapToolboxControls, setMapToolboxControls] = useState<MapToolboxControls | null>(null);
  const [navigateMode, setNavigateMode] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showConfig, setShowConfig] = useState(false);
  /** Id de l'outil en cours de renommage inline (dans la liste principale). */
  const [renamingId, setRenamingId] = useState<string | null>(null);

  /** Onglet actif du panneau latéral pour réduire le scroll vertical
   *  (avant : sections + mesures + carte empilés). */
  const [sidePanelTab, setSidePanelTab] = useState<'measures' | 'map' | 'sections'>('measures');

  /** Mode "focus" mobile : pendant qu'un outil de mesure est actif on cache
   *  toute la chrome admin (meta, statut, score, actions externes) pour ne
   *  laisser que la carte + la barre de mesure. Réduit le bruit cognitif. */
  const focusMode = isMobile && !!measureMode;

  const [correctedBuilding, setCorrectedBuilding] = useState<any>(buildingGeo);
  const [correctedLot, setCorrectedLot] = useState<any>(lotGeo);

  const [saving, setSaving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [showSkeletonTest, setShowSkeletonTest] = useState(false);
  const [showSectionsEditor, setShowSectionsEditor] = useState(false);
  const [roofSections, setRoofSections] = useState<RoofSection[]>(
    Array.isArray(persisted.roof_sections) ? persisted.roof_sections : [],
  );
  /** Toggles d'overlays roof_sections / derived edges sur la carte principale. */
  const [showSectionsOverlay, setShowSectionsOverlay] = useState(true);
  const [showDerivedEdges, setShowDerivedEdges] = useState(true);

  const footprintRing = useMemo(() => {
    const rawRing = extractMainRingLatLng(correctedBuilding || buildingGeo);
    // Applique les ajustements live (offset E/N, rotation, scale) pour rester
    // aligné avec ce que l'utilisateur voit dans la carte principale.
    return applyRingAdjustments(rawRing, polygonAdj);
  }, [correctedBuilding, buildingGeo, polygonAdj]);
  const sectionsBundle: RoofSectionsBundle = useMemo(
    () => buildSectionsBundle(roofSections, footprintRing, annotations.length),
    [roofSections, footprintRing, annotations.length],
  );
  const latestAnnotationsJson = useMemo(() => ({
    tools,
    annotations,
    polygon_adj: polygonAdj,
    lot_adj: lotAdj,
    map_params: mapParams,
    roof_sections: roofSections,
    roof_edges: sectionsBundle.roof_edges,
    migration_status: sectionsBundle.migration_status,
    sections_diagnostics: sectionsBundle.diagnostics,
    totals: Object.fromEntries(
      tools.map((t) => {
        const anns = annotations.filter((a) => a.target === t.id);
        const isCounter = t.toolType === 'Compteur';
        const total = isCounter ? anns.length : anns.reduce((s, a) => s + a.feet, 0);
        const value = total > 0 ? total : Number(t.manualValue) || 0;
        return [t.id, { value, unit: t.unit, count: anns.length }];
      }),
    ),
    meta: { ...(persisted.meta || {}) },
    seed: persisted.seed || {
      area_sqft: persisted.area_sqft,
      slope: persisted.slope,
      coverage_type: persisted.coverage_type,
      product_name: persisted.product_name,
      color: persisted.color,
    },
  }), [tools, annotations, polygonAdj, lotAdj, mapParams, roofSections, sectionsBundle.roof_edges, sectionsBundle.migration_status, sectionsBundle.diagnostics, persisted]);
  // Skeleton overlay (dessiné directement sur la map).
  const [skeletonPaths, setSkeletonPaths] = useState<Array<Array<{ lat: number; lng: number }>>>([]);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [computingSkeleton, setComputingSkeleton] = useState(false);

  const handleComputeSkeleton = async () => {
    const geo = correctedBuilding || buildingGeo;
    if (!geo) { toast.error('Pas de polygone bâtiment'); return; }
    setComputingSkeleton(true);
    try {
      const res = await computeSkeletonLatLng(geo);
      if (!res || !res.paths.length) { toast.error('Skeleton non calculable'); return; }
      setSkeletonPaths(res.paths);
      setShowSkeleton(true);
      toast.success(`Skeleton : ${res.edgeCount} arêtes intérieures`);
    } catch (e: any) {
      toast.error(`Erreur skeleton : ${e?.message || e}`);
    } finally {
      setComputingSkeleton(false);
    }
  };

  const extraPolylines = useMemo(() => {
    const out: Array<{ id: string; label: string; color: string; paths: Array<Array<{ lat: number; lng: number }>>; visible: boolean; weight?: number }> = [];
    if (skeletonPaths.length) {
      out.push({ id: 'skeleton', label: 'Skeleton (arêtes)', color: '#a855f7', paths: skeletonPaths, visible: showSkeleton, weight: 3 });
    }
    // Sections (contour fermé).
    for (const layer of sectionsToExtraPolylines(roofSections)) {
      out.push({ ...layer, visible: showSectionsOverlay });
    }
    // Derived edges (RIDGE / VALLEY / HIP / EAVE / GABLE).
    for (const layer of edgesToExtraPolylines(sectionsBundle.roof_edges)) {
      out.push({ ...layer, visible: showDerivedEdges });
    }
    return out;
  }, [skeletonPaths, showSkeleton, roofSections, showSectionsOverlay, sectionsBundle.roof_edges, showDerivedEdges]);
  const mapColRef = useRef<HTMLDivElement | null>(null);

  /* Mobile floating toolbox pastille (draggable vertically along right edge) */
  const FAB_SIZE = 52;

  /** Dynamic viewport height — tracks rotation, iOS Safari URL bar, virtual keyboard.
   *  Uses visualViewport when available (iOS keyboard) and falls back to window.innerHeight. */
  const getViewportHeight = () => {
    if (typeof window === 'undefined') return 800;
    return window.visualViewport?.height ?? window.innerHeight;
  };
  const [vh, setVh] = useState<number>(() => getViewportHeight());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setVh(getViewportHeight());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  const [fabY, setFabY] = useState<number>(() => Math.round(getViewportHeight() * 0.55));
  // Keep FAB in view when viewport shrinks (e.g. keyboard opens)
  useEffect(() => {
    setFabY((y) => Math.max(80, Math.min(vh - FAB_SIZE - 24, y)));
  }, [vh]);
  const [fabOpen, setFabOpen] = useState(false);
  const fabDragRef = useRef<{ startY: number; startFabY: number; moved: boolean } | null>(null);

  /** Bottom-sheet snap heights: compact / medium / full. */
  const SHEET_SNAPS = [0.32, 0.62, 0.92] as const;
  const [sheetSnap, setSheetSnap] = useState<0 | 1 | 2>(1);
  const sheetDragRef = useRef<{ startY: number; startH: number; h: number } | null>(null);
  const [sheetDragH, setSheetDragH] = useState<number | null>(null);
  const onFabPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    fabDragRef.current = { startY: e.clientY, startFabY: fabY, moved: false };
  };
  const onFabPointerMove = (e: React.PointerEvent) => {
    const d = fabDragRef.current; if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > 4) d.moved = true;
    const min = 80, max = vh - FAB_SIZE - 24;
    setFabY(Math.max(min, Math.min(max, d.startFabY + dy)));
  };
  const onFabPointerUp = (e: React.PointerEvent) => {
    const d = fabDragRef.current; fabDragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {/* */}
    if (!d?.moved) setFabOpen((v) => !v);
  };

  /** Capture exactement ce que l'utilisateur voit dans la colonne carte
   *  (calques activés/désactivés, annotations, polygones, fond Google/OrthoQC)
   *  puis upload dans le bucket `training-assets`. */
  const captureCurrentView = async (): Promise<string | null> => {
    const el = mapColRef.current;
    if (!el) return null;
    try {
      const canvas = await html2canvas(el, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#0b0b12',
        logging: false,
        scale: Math.min(2, window.devicePixelRatio || 1),
        ignoreElements: (node) => {
          // Ignore les overlays UI (toolbox flottante, badges) qu'on ne veut pas
          // dans l'image d'entraînement. On garde uniquement le canvas carte.
          const cls = (node as HTMLElement).className || '';
          if (typeof cls !== 'string') return false;
          return /maptoolbox|tl-floating|gm-style-cc|gmnoprint|gm-bundled-control/i.test(cls);
        },
      });
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.9));
      if (!blob) return null;
      const path = `captures/${takeoff.id}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('training-assets')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (upErr) { console.warn('[training-lab] capture upload failed', upErr); return null; }
      const { data } = await supabase.storage.from('training-assets').createSignedUrl(path, 60 * 60 * 24 * 365);
      return data?.signedUrl || null;
    } catch (err) {
      console.warn('[training-lab] html2canvas capture failed', err);
      return null;
    }
  };

  useEffect(() => {
    if (!center || persisted?.map_params) return;
    setMapParams((prev) => (
      Math.abs(prev.centerLat - 46.81) < 0.001 && Math.abs(prev.centerLng + 71.21) < 0.001
        ? { ...prev, centerLat: center.lat, centerLng: center.lng }
        : prev
    ));
  }, [center, persisted?.map_params]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        window.localStorage.setItem(draftStorageKey, JSON.stringify({
          version: TAKEOFF_DRAFT_VERSION,
          savedAt,
          annotations_json: {
            ...latestAnnotationsJson,
            meta: { ...(latestAnnotationsJson.meta || {}), local_draft_at: savedAt },
          },
        }));
      } catch (err) {
        console.warn('[training-lab] draft autosave failed', err);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftStorageKey, latestAnnotationsJson]);

  useEffect(() => {
    const needsSourceRecovery = !buildingStr || annotations.length === 0;
    if (!needsSourceRecovery) return;
    let cancelled = false;
    setRecovering(true);
    recoverTakeoffGeometryFromSoumission(takeoff)
      .then(async (patch) => {
        if (cancelled || !patch) return;
        setRecoveredPatch((prev) => ({ ...(prev || {}), ...patch }));
        setCorrectedBuilding((current: any) => current || patch.original_building_geojson || patch.corrected_building_geojson || null);
        setCorrectedLot((current: any) => current || patch.original_lot_geojson || patch.corrected_lot_geojson || null);
        const recovered = patch.annotations_json as any;
        if (recovered && annotations.length === 0) {
          if (Array.isArray(recovered.tools) && recovered.tools.length) setTools(recovered.tools);
          if (Array.isArray(recovered.annotations)) setAnnotations(recovered.annotations);
          if (recovered.polygon_adj) setPolygonAdj(recovered.polygon_adj);
          if (recovered.lot_adj) setLotAdj(recovered.lot_adj);
          if (recovered.map_params) setMapParams(recovered.map_params);
        }
        await onRecovered?.(patch);
      })
      .finally(() => { if (!cancelled) setRecovering(false); });
    return () => { cancelled = true; };
  }, [annotations.length, buildingStr, onRecovered, takeoff]);

  const updateTool = (id: string, patch: Partial<TLTool>) => {
    setTools((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };
  const addTool = () => {
    const id = `tool_${Date.now()}`;
    setTools((ts) => [
      ...ts,
      { id, name: 'Nouvel outil', toolType: 'Ligne', unit: 'pi', color: TOOL_COLORS[ts.length % TOOL_COLORS.length], visible: true, manualValue: '' },
    ]);
  };
  const removeTool = (id: string) => {
    setTools((ts) => ts.filter((t) => t.id !== id));
    setAnnotations((as) => as.filter((a) => a.target !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1) Capture l'image visible AVANT d'écrire en DB pour la stocker
      //    comme `annotated_image_url` (reflet exact de la vue utilisateur).
      const capturedUrl = await captureCurrentView();
      const annotations_json = {
        ...latestAnnotationsJson,
        meta: { ...(latestAnnotationsJson.meta || {}), updated_at: new Date().toISOString() },
      };
      const patch: Partial<TrainingTakeoff> = {
        annotations_json,
        corrected_building_geojson: correctedBuilding,
        corrected_lot_geojson: correctedLot,
        calibration_status: 'reviewed',
      };
      if (capturedUrl) patch.annotated_image_url = capturedUrl;
      await onSaved(patch);
      if (typeof window !== 'undefined') window.localStorage.removeItem(draftStorageKey);
    } finally {
      setSaving(false);
    }
  };

  if (!buildingStr || !center) {
    return createPortal(
      <div style={overlayStyle}>
        <div style={{ ...modalStyle, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#fff' }}>Données géométriques manquantes</h3>
            <button onClick={onClose} className="tl-btn"><X size={14} /></button>
          </div>
          <p style={{ color: '#9ca3af', fontSize: 13 }}>
            {recovering
              ? 'Récupération automatique du polygone depuis la soumission…'
              : 'Ce takeoff n\'a pas de polygone bâtiment. Relance "Importer depuis soumissions" pour le remplir, ou ajoute manuellement le geojson.'}
          </p>
          <style>{btnCss}</style>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div style={overlayStyle}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, padding: isMobile ? '10px 12px' : '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <Ruler size={isMobile ? 18 : 16} color="hsl(265,70%,65%)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#fff', fontSize: isMobile ? 14 : 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isMobile ? (takeoff.reference || takeoff.id.slice(0, 6)) : `Take-off entraînement — ${takeoff.reference || takeoff.id.slice(0, 6)}`}
            </div>
            <div style={{ color: '#9ca3af', fontSize: isMobile ? 11 : 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {takeoff.address || '—'}
            </div>
          </div>
          {!isMobile && (
            <button onClick={() => setNavigateMode((v) => !v)} className="tl-btn" title="Navigation libre carte">
              {navigateMode ? 'Mode édition' : 'Mode navigation'}
            </button>
          )}
          <button
            onClick={() => setShowSkeletonTest(true)}
            className="tl-btn"
            title="Test temporaire: straight skeleton vs faîtière humaine"
            style={{ borderColor: 'hsl(280,70%,55%)', color: 'hsl(280,80%,75%)' }}
          >
            <FlaskConical size={isMobile ? 16 : 12} /> {!isMobile && 'Test Skeleton'}
          </button>
          <button
            onClick={handleComputeSkeleton}
            disabled={computingSkeleton}
            className="tl-btn"
            title="Calculer le straight skeleton et l'afficher sur la carte"
            style={{ borderColor: 'hsl(265,70%,55%)', color: 'hsl(265,80%,80%)' }}
          >
            <Ruler size={isMobile ? 16 : 12} /> {!isMobile && (computingSkeleton ? '…' : 'Skeleton')}
          </button>
          <button
            onClick={() => setShowSectionsEditor(true)}
            className="tl-btn"
            title="Éditeur de sections de toiture (Roof Sections First)"
            style={{ borderColor: 'hsl(265,70%,55%)', color: 'hsl(265,80%,80%)' }}
          >
            <Plus size={isMobile ? 16 : 12} /> {!isMobile && `Sections (${roofSections.length})`}
          </button>
          <button onClick={handleSave} disabled={saving} className="tl-btn tl-btn-primary">
            <Save size={isMobile ? 18 : 13} /> {saving ? '…' : (isMobile ? '' : 'Enregistrer')}
          </button>
          <button onClick={onClose} className="tl-btn" title="Fermer"><X size={isMobile ? 20 : 14} /></button>
        </div>

        {/* Meta bar — accessible en mode édition comme en mode normal */}
        {onPatch && !focusMode && (() => {
          const toggleTag = (tag: string) => {
            const has = (takeoff.tags || []).includes(tag);
            const next = has ? (takeoff.tags || []).filter((t) => t !== tag) : [...(takeoff.tags || []), tag];
            void onPatch({ tags: next });
          };
          const jsonHref = takeoff.annotations_json
            ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(takeoff.annotations_json, null, 2))}`
            : null;
          const created = takeoff.created_at ? new Date(takeoff.created_at).toLocaleString('fr-CA') : '—';
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, padding: isMobile ? '10px 12px' : '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(15,15,35,0.5)', flexWrap: 'wrap', fontSize: isMobile ? 12 : 11 }}>
              <span style={{ color: '#9ca3af' }}>Statut</span>
              <select
                value={takeoff.dataset_status}
                onChange={(e) => onPatch({ dataset_status: e.target.value as DatasetStatus })}
                style={{
                  background: 'transparent',
                  color: STATUS_COLORS[takeoff.dataset_status as DatasetStatus],
                  border: `1px solid ${STATUS_COLORS[takeoff.dataset_status as DatasetStatus]}55`,
                  borderRadius: 8, padding: isMobile ? '8px 10px' : '2px 6px', fontSize: isMobile ? 13 : 11, fontWeight: 600, minHeight: isMobile ? 40 : undefined,
                }}
              >
                {Object.keys(STATUS_LABELS).map((k) => (
                  <option key={k} value={k} style={{ background: '#111' }}>{STATUS_LABELS[k as DatasetStatus]}</option>
                ))}
              </select>

              <span style={{ color: '#9ca3af', marginLeft: 6 }}>Score</span>
              <input
                type="number" min={0} max={1} step={0.05}
                value={takeoff.quality_score ?? ''}
                onChange={(e) => onPatch({ quality_score: e.target.value === '' ? null : Number(e.target.value) })}
                style={{ width: isMobile ? 70 : 60, padding: isMobile ? '8px 10px' : '2px 6px', background: 'hsl(230,22%,12%)', border: '1px solid hsl(230,20%,18%)', color: '#fff', borderRadius: isMobile ? 8 : 4, fontSize: isMobile ? 16 : 11, minHeight: isMobile ? 40 : undefined }}
              />

              {!isMobile && <span style={{ color: '#9ca3af', marginLeft: 6 }}>Tags</span>}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(takeoff.tags || []).length === 0 && !isMobile && <span style={{ color: '#6b7280', fontSize: 10 }}>aucun</span>}
                {(takeoff.tags || []).map((t) => (
                  <button key={t} onClick={() => toggleTag(t)} title="Retirer le tag"
                    style={{ fontSize: isMobile ? 12 : 10, padding: isMobile ? '6px 10px' : '1px 6px', borderRadius: isMobile ? 8 : 4, background: 'hsl(265,40%,25%)', color: 'hsl(265,70%,80%)', border: 'none', cursor: 'pointer' }}>
                    {t} ×
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: isMobile ? 4 : 2, marginLeft: 4 }}>
                <button onClick={() => toggleTag('good_example')} className="tl-icon-btn" title="Bon exemple"><Star size={isMobile ? 18 : 13} color="hsl(48,90%,60%)" /></button>
                <button onClick={() => toggleTag('problem_case')} className="tl-icon-btn" title="Cas problème"><AlertTriangle size={isMobile ? 18 : 13} color="hsl(28,90%,60%)" /></button>
                <button onClick={() => toggleTag('do_not_use')} className="tl-icon-btn" title="Ne pas utiliser"><Ban size={isMobile ? 18 : 13} color="hsl(0,70%,60%)" /></button>
                <button onClick={() => onPatch({ dataset_status: 'ready_for_training' })} className="tl-icon-btn" title="Marquer prêt"><CheckCircle2 size={isMobile ? 18 : 13} color="hsl(140,65%,55%)" /></button>
              </div>

              <div style={{ flex: 1 }} />

              {!isMobile && <span style={{ color: '#6b7280' }}>Créé&nbsp;: {created}</span>}
              {/* Sur mobile, on regroupe les actions externes sur une rangée dédiée (plein largeur, équirépartie). */}
              <div style={{ display: 'flex', gap: isMobile ? 6 : 6, flexWrap: 'wrap', width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'stretch' : 'flex-end' }}>
                {jsonHref && (
                  <a href={jsonHref} download={`takeoff-${takeoff.reference || takeoff.id.slice(0, 6)}.json`}
                     className="tl-btn" style={{ textDecoration: 'none', flex: isMobile ? 1 : undefined }} title="Télécharger annotations_json">
                    <FileJson size={isMobile ? 16 : 12} /> {!isMobile && 'JSON'}
                  </a>
                )}
                {takeoff.raw_image_url && (
                  <a href={takeoff.raw_image_url} target="_blank" rel="noreferrer" className="tl-btn" style={{ textDecoration: 'none', flex: isMobile ? 1 : undefined }} title="Image brute">
                    <ExternalLink size={isMobile ? 16 : 12} /> {!isMobile && 'Brute'}
                  </a>
                )}
                {takeoff.annotated_image_url && (
                  <a href={takeoff.annotated_image_url} target="_blank" rel="noreferrer" className="tl-btn" style={{ textDecoration: 'none', flex: isMobile ? 1 : undefined }} title="Image annotée">
                    <ExternalLink size={isMobile ? 16 : 12} /> {!isMobile && 'Annotée'}
                  </a>
                )}
                {onDelete && (
                  <button onClick={() => { if (confirm('Supprimer ce takeoff ?')) void onDelete(); }} className="tl-btn tl-btn-danger" title="Supprimer du Training Lab" style={isMobile ? { flex: 1 } : undefined}>
                    <Trash2 size={isMobile ? 16 : 12} /> {!isMobile && 'Supprimer'}
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Body: map + side panel */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: 1, minHeight: 0, overflow: isMobile ? 'auto' : 'hidden', WebkitOverflowScrolling: 'touch' as any }}>
          {/* Map */}
          <div ref={mapColRef} className="tl-map-col" style={{ flex: isMobile ? 'none' : 1, width: isMobile ? '100%' : undefined, height: isMobile ? '55vh' : undefined, position: 'relative', minWidth: 0, background: '#0b0b12', display: 'flex', overflow: 'hidden', flexShrink: 0 }}>
            <BuildingReadOnlyMap
              centerLat={mapParams.centerLat}
              centerLng={mapParams.centerLng}
              zoom={mapParams.zoom}
              buildingGeojson={buildingStr}
              lotGeojson={lotStr}
              address={takeoff.address || ''}
              onViewChange={(view) => setMapParams((prev) =>
                Math.abs(prev.centerLat - view.centerLat) < 1e-7 &&
                Math.abs(prev.centerLng - view.centerLng) < 1e-7 &&
                Math.abs(prev.zoom - view.zoom) < 0.01 ? prev : view,
              )}
              onAdjustmentsChange={setPolygonAdj}
              onLotAdjustmentsChange={setLotAdj}
              onBuildingGeojsonChange={(s) => { try { setCorrectedBuilding(JSON.parse(s)); } catch {/* */} }}
              onLotGeojsonChange={(s) => { try { setCorrectedLot(JSON.parse(s)); } catch {/* */} }}
              measureMode={measureMode}
              measureColors={measureColors}
              measureLabels={measureLabels}
              measureToolTypes={measureToolTypes}
              measureMarkerShapes={measureMarkerShapes}
              onMeasureComplete={(target) => { setMeasureMode(null); void target; }}
              onMeasureCancel={() => setMeasureMode(null)}
              onAnnotationsChange={setAnnotations}
              deleteAnnotationIndex={deleteAnnotIdx}
              onDeleteAnnotationDone={() => setDeleteAnnotIdx(null)}
              clearAllAnnotations={clearAllAnnotations}
              onClearAllAnnotationsDone={() => setClearAllAnnotations(false)}
              hideBuiltinAdjust
              onAdjustControlsReady={setAdjustControls}
              hideBuiltinMapTools
              onMapToolboxControlsReady={setMapToolboxControls}
              navigateMode={navigateMode}
              initialAnnotations={annotations}
              initialAdjustments={polygonAdj}
              initialLotAdjustments={lotAdj}
              defaultShowOrthoQC
              hideMeasureVertexMarkers
              alwaysInteractive={isMobile}
              layerStateStorageKey="tl_layers_v1"
              extraPolylines={extraPolylines}
              onToggleExtraPolyline={(id) => { if (id === 'skeleton') setShowSkeleton((v) => !v); }}
            />
          </div>

          {/* Side panel — measurement tools */}
          <div style={{ width: isMobile ? '100%' : 380, flexShrink: 0, borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.08)', borderTop: isMobile ? '1px solid rgba(255,255,255,0.08)' : 'none', background: 'rgba(15,15,35,0.6)', display: 'flex', flexDirection: 'column', minHeight: isMobile ? undefined : 0 }}>
            {/* ── Tabs : Mesures · Sections · Carte ── */}
            {!isMobile && (
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.35)' }}>
                {([
                  { id: 'measures', label: 'Mesures', count: annotations.length },
                  { id: 'sections', label: 'Sections', count: roofSections.length },
                  { id: 'map', label: 'Carte', count: 0 },
                ] as const).map((t) => {
                  const active = sidePanelTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSidePanelTab(t.id)}
                      style={{
                        flex: 1, padding: '10px 8px', background: active ? 'rgba(99,102,241,0.18)' : 'transparent',
                        border: 'none', borderBottom: `2px solid ${active ? 'hsl(245,80%,65%)' : 'transparent'}`,
                        color: active ? '#c7d2fe' : '#94a3b8', fontSize: 11, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      {t.label}
                      {t.count > 0 && (
                        <span style={{
                          background: active ? 'hsl(245,80%,65%)' : 'rgba(255,255,255,0.1)',
                          color: active ? '#fff' : '#cbd5e1',
                          fontSize: 10, padding: '1px 6px', borderRadius: 10, minWidth: 18, textAlign: 'center',
                        }}>{t.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Roof Sections (nouvelle primitive) ─ compact summary card ── */}
            {(isMobile || sidePanelTab === 'sections') && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(168,85,247,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'hsl(265,80%,80%)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Sections toiture · {sectionsBundle.migration_status}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setShowSectionsOverlay((v) => !v)} className="tl-btn" title="Afficher / masquer sections" style={{ padding: '2px 6px', fontSize: 10, opacity: showSectionsOverlay ? 1 : 0.5 }}>
                    Sections
                  </button>
                  <button onClick={() => setShowDerivedEdges((v) => !v)} className="tl-btn" title="Afficher / masquer edges dérivées" style={{ padding: '2px 6px', fontSize: 10, opacity: showDerivedEdges ? 1 : 0.5 }}>
                    Edges
                  </button>
                  <button onClick={() => setShowSectionsEditor(true)} className="tl-btn tl-btn-primary" style={{ padding: '2px 8px', fontSize: 10 }}>
                    Éditer
                  </button>
                </div>
              </div>
              {roofSections.length === 0 ? (
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Aucune section. Cliquez sur « Éditer » pour dessiner les pans de toiture.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                    {roofSections.map((s) => (
                      <span key={s.section_id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px',
                        borderRadius: 4, fontSize: 10,
                        background: `${SECTION_TYPE_COLORS[s.section_type]}22`,
                        color: SECTION_TYPE_COLORS[s.section_type],
                        border: `1px solid ${SECTION_TYPE_COLORS[s.section_type]}55`,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: SECTION_TYPE_COLORS[s.section_type] }} />
                        {s.label || SECTION_TYPE_LABELS[s.section_type]}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10, color: '#cbd5e1' }}>
                    <span>Aire&nbsp;: <b>{sectionsBundle.diagnostics.total_section_area_m2.toFixed(1)} m²</b></span>
                    <span>Edges&nbsp;: <b>{sectionsBundle.roof_edges.length}</b></span>
                    {sectionsBundle.diagnostics.footprint_coverage_pct != null && (
                      <span>Couverture&nbsp;: <b>{sectionsBundle.diagnostics.footprint_coverage_pct}%</b></span>
                    )}
                    <span>Recouvr.&nbsp;: <b>{sectionsBundle.diagnostics.overlap_between_sections_pct}%</b></span>
                  </div>
                  {sectionsBundle.diagnostics.warnings.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 10, color: '#fbbf24' }}>
                      {sectionsBundle.diagnostics.warnings.length} alerte(s) géom. — voir éditeur
                    </div>
                  )}
                </>
              )}
            </div>
            )}

            {(isMobile || sidePanelTab === 'measures') && (
            <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(25,25,50,0.6)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Outils de mesure</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {annotations.length > 0 && (
                  <button onClick={() => setClearAllAnnotations(true)} className="tl-btn tl-btn-danger" title="Tout effacer">
                    <Trash2 size={11} /> Effacer
                  </button>
                )}
                <button onClick={() => setShowConfig((v) => !v)} className="tl-btn" title="Configurer outils">
                  {showConfig ? 'Fermer config' : 'Configurer'}
                </button>
                <button onClick={addTool} className="tl-btn" title="Ajouter un outil">
                  <Plus size={11} /> Outil
                </button>
              </div>
            </div>

            {showConfig && createPortal(
              <div
                onClick={() => setShowConfig(false)}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 'min(820px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'hsl(230,22%,10%)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(99,102,241,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Wrench size={16} color="#a5b4fc" />
                      <div>
                        <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14 }}>Configuration des outils</div>
                        <div style={{ color: '#94a3b8', fontSize: 11 }}>{tools.length} outil(s) — clic pour modifier nom, couleur, type, unité</div>
                      </div>
                    </div>
                    <button onClick={() => setShowConfig(false)} className="tl-icon-btn" title="Fermer"><X size={16} /></button>
                  </div>
                  <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 130px 100px 32px', gap: 10, alignItems: 'center', padding: '0 0 6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
                      <span></span><span>Nom</span><span>Type</span><span>Unité</span><span></span>
                    </div>
                    {tools.map((t) => (
                      <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 130px 100px 32px', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}>
                        <input type="color" value={t.color} onChange={(e) => updateTool(t.id, { color: e.target.value })} style={{ width: 28, height: 28, padding: 0, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, background: 'transparent', cursor: 'pointer' }} title="Couleur" />
                        <input value={t.name} onChange={(e) => updateTool(t.id, { name: e.target.value })} placeholder="Nom de l'outil" style={{ ...inputSt, fontSize: 13, padding: '8px 10px' }} />
                        <select value={t.toolType} onChange={(e) => updateTool(t.id, { toolType: e.target.value as ToolType, unit: UNITS_BY_TOOL_TYPE[e.target.value as ToolType][0] })} style={{ ...inputSt, fontSize: 12, padding: '8px 8px' }}>
                          {(Object.keys(UNITS_BY_TOOL_TYPE) as ToolType[]).map((tt) => <option key={tt} value={tt}>{tt}</option>)}
                        </select>
                        <select value={t.unit} onChange={(e) => updateTool(t.id, { unit: e.target.value })} style={{ ...inputSt, fontSize: 12, padding: '8px 8px' }}>
                          {UNITS_BY_TOOL_TYPE[t.toolType].map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <button onClick={() => removeTool(t.id)} className="tl-icon-btn" title="Supprimer outil"><Trash2 size={14} color="#f87171" /></button>
                      </div>
                    ))}
                    {tools.length === 0 && (
                      <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 12 }}>Aucun outil. Cliquez sur « Ajouter un outil ».</div>
                    )}
                  </div>
                  <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.25)' }}>
                    <button onClick={addTool} className="tl-btn tl-btn-primary"><Plus size={14} /> Ajouter un outil</button>
                    <button onClick={() => setShowConfig(false)} className="tl-btn">Fermer</button>
                  </div>
                </div>
              </div>,
              document.body,
            )}

            <div style={{ flex: isMobile ? 'none' : 1, overflowY: isMobile ? 'visible' : 'auto', WebkitOverflowScrolling: 'touch' as any }}>
              {tools.filter((t) => t.visible).map((tool) => {
                const anns = annotations.filter((a) => a.target === tool.id);
                const isCounter = tool.toolType === 'Compteur';
                const total = isCounter ? anns.length : anns.reduce((s, a) => s + a.feet, 0);
                const isActive = measureMode === tool.id;
                const isCol = collapsed[tool.id] !== false;
                return (
                  <div key={tool.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: isActive ? `${tool.color}10` : 'transparent', borderLeft: isActive ? `3px solid ${tool.color}` : '3px solid transparent' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        // Ignore clicks on the manual value input / unit / explicit icon buttons.
                        const tgt = e.target as HTMLElement;
                        if (tgt.closest('input, select, button, a')) return;
                        setMeasureMode(isActive ? null : tool.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMeasureMode(isActive ? null : tool.id); }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: isMobile ? '12px 12px' : '8px 10px',
                        minHeight: isMobile ? 56 : undefined,
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (anns.length || tool.manualValue) setCollapsed((c) => ({ ...c, [tool.id]: !isCol }));
                        }}
                        className="tl-icon-btn"
                        style={{ opacity: (anns.length || tool.manualValue) ? 1 : 0.3 }}
                        aria-label="Replier"
                      >
                        {isCol ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </button>
                      <span style={{ width: isMobile ? 12 : 8, height: isMobile ? 12 : 8, borderRadius: '50%', background: tool.color, boxShadow: isActive ? `0 0 10px ${tool.color}` : 'none', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {renamingId === tool.id ? (
                          <input
                            autoFocus
                            value={tool.name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateTool(tool.id, { name: e.target.value })}
                            onBlur={() => setRenamingId(null)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setRenamingId(null); } }}
                            style={{ ...inputSt, width: '100%', fontSize: isMobile ? 14 : 12, fontWeight: 700, padding: isMobile ? '6px 8px' : '3px 6px' }}
                          />
                        ) : (
                          <div
                            onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(tool.id); }}
                            title="Double-clic pour renommer"
                            style={{ color: isActive ? tool.color : '#e2e8f0', fontSize: isMobile ? 14 : 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'text' }}
                          >
                            {tool.name}
                          </div>
                        )}
                        <div style={{ color: '#6b7280', fontSize: isMobile ? 10 : 9, textTransform: 'uppercase' }}>{tool.toolType}</div>
                      </div>
                      <input
                        type="number"
                        placeholder={anns.length ? String(Math.round(total)) : '0'}
                        value={tool.manualValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateTool(tool.id, { manualValue: e.target.value })}
                        style={{ ...inputSt, width: isMobile ? 70 : 60, textAlign: 'right', fontFamily: 'monospace', fontSize: isMobile ? 16 : 11, padding: isMobile ? '8px 8px' : '3px 6px' }}
                        disabled={anns.length > 0}
                        title="Valeur manuelle (ignorée si des annotations existent)"
                      />
                      <span style={{ color: '#9ca3af', fontSize: 10, width: 28 }}>{tool.unit}</span>
                      {/* Indicateur d'état (la ligne entière est tappable). */}
                      <span
                        aria-hidden
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: isMobile ? 40 : 30, height: isMobile ? 40 : 28, borderRadius: 10,
                          background: isActive ? `${tool.color}22` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isActive ? tool.color : 'rgba(255,255,255,0.12)'}`,
                          color: isActive ? tool.color : '#9ca3af',
                          flexShrink: 0,
                        }}
                      >
                        <Ruler size={isMobile ? 16 : 12} />
                      </span>
                    </div>
                    {!isCol && anns.length > 0 && (
                      <div style={{ padding: '0 10px 8px 32px' }}>
                        {anns.map((a, j) => (
                          <div key={`${tool.id}-${j}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 10, color: '#9ca3af' }}>
                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: tool.color, opacity: 0.7 }} />
                            <span style={{ flex: 1 }}>{tool.name} #{j + 1}</span>
                            <span style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>
                              {isCounter ? '×1' : `${a.feet} ${tool.unit}`}
                            </span>
                            <button onClick={() => setDeleteAnnotIdx(a.index)} className="tl-icon-btn" title="Supprimer">
                              <Trash2 size={10} color="#f87171" />
                            </button>
                          </div>
                        ))}
                        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed rgba(255,255,255,0.06)', fontSize: 10, color: '#34d399', textAlign: 'right', fontFamily: 'monospace' }}>
                          Total : {isCounter ? `${total} unité(s)` : `${Math.round(total)} ${tool.unit}`}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ padding: 10, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 10, color: '#6b7280', background: 'rgba(0,0,0,0.2)' }}>
              {annotations.length} annotation(s) · {tools.length} outil(s) · Pas de produit lié — sortie JSON pure pour l'entraînement.
            </div>
            </>
            )}

            {/* Boîte à outils carte (Couches, Lot/Bâtiment, flèches, rotation, échelle, fond) */}
            {(isMobile || sidePanelTab === 'map') && !isMobile && (mapToolboxControls || adjustControls) && (
              <div style={{ padding: 8, borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.25)' }}>
                <MapToolbox
                  mapControls={mapToolboxControls}
                  adjustControls={adjustControls}
                  storageKey="training_lab_maptoolbox"
                  navigateMode={navigateMode}
                  onToggleNavigate={() => setNavigateMode((v) => !v)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Mobile : pastille flottante (toolbox) + drawer ancré à sa position verticale */}
        {isMobile && (mapToolboxControls || adjustControls) && (() => {
          const snapPx = SHEET_SNAPS.map((r) => Math.round(vh * r));
          const sheetH = sheetDragH != null ? sheetDragH : snapPx[sheetSnap];
          const onSheetPointerDown = (e: React.PointerEvent) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            sheetDragRef.current = { startY: e.clientY, startH: sheetH, h: sheetH };
          };
          const onSheetPointerMove = (e: React.PointerEvent) => {
            const d = sheetDragRef.current; if (!d) return;
            const dy = e.clientY - d.startY;
            const next = Math.max(120, Math.min(vh - 24, d.startH - dy));
            d.h = next;
            setSheetDragH(next);
          };
          const onSheetPointerUp = (e: React.PointerEvent) => {
            const d = sheetDragRef.current; sheetDragRef.current = null;
            try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {/* */}
            if (!d) return;
            // Snap to nearest height; if dragged below smallest by >60px → close.
            if (d.h < snapPx[0] - 60) { setFabOpen(false); setSheetDragH(null); return; }
            let best: 0 | 1 | 2 = 1;
            let bestD = Infinity;
            snapPx.forEach((p, i) => { const dist = Math.abs(p - d.h); if (dist < bestD) { bestD = dist; best = i as 0 | 1 | 2; } });
            setSheetSnap(best);
            setSheetDragH(null);
          };
          return (
            <>
              {fabOpen && (
                <div
                  onClick={() => setFabOpen(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)' }}
                />
              )}
              {fabOpen && (
                <div
                  role="dialog"
                  aria-label="Boîte à outils carte"
                  style={{
                    position: 'fixed', left: 0, right: 0, bottom: 0,
                    height: sheetH,
                    zIndex: 10001, background: 'hsl(230,22%,10%)',
                    borderTopLeftRadius: 18, borderTopRightRadius: 18,
                    border: '1px solid hsl(230,20%,22%)', borderBottom: 'none',
                    boxShadow: '0 -20px 50px rgba(0,0,0,0.6)',
                    display: 'flex', flexDirection: 'column',
                    transition: sheetDragRef.current ? 'none' : 'height 220ms cubic-bezier(.2,.8,.2,1)',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                  }}
                >
                  {/* Drag handle */}
                  <div
                    onPointerDown={onSheetPointerDown}
                    onPointerMove={onSheetPointerMove}
                    onPointerUp={onSheetPointerUp}
                    style={{
                      padding: '10px 12px 6px', cursor: 'grab', touchAction: 'none',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ width: 44, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.25)' }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, letterSpacing: 0.2 }}>Boîte à outils carte</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setFabOpen(false); }}
                        className="tl-icon-btn"
                        aria-label="Fermer"
                        style={{ width: 40, height: 40 }}
                      >
                        <X size={20} />
                      </button>
                    </div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any, padding: '8px 10px 16px' }}>
                    <MapToolbox
                      mapControls={mapToolboxControls}
                      adjustControls={adjustControls}
                      storageKey="training_lab_maptoolbox"
                      navigateMode={navigateMode}
                      onToggleNavigate={() => setNavigateMode((v) => !v)}
                    />
                  </div>
                </div>
              )}
              <button
                onPointerDown={onFabPointerDown}
                onPointerMove={onFabPointerMove}
                onPointerUp={onFabPointerUp}
                aria-label="Boîte à outils"
                style={{
                  position: 'fixed', right: 12, top: fabY, zIndex: 10002,
                  width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
                  background: 'linear-gradient(135deg, hsl(265,70%,55%), hsl(280,70%,55%))',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 10px 28px rgba(139,92,246,0.45), 0 0 0 1px rgba(255,255,255,0.05) inset',
                  touchAction: 'none', cursor: 'grab',
                  opacity: focusMode ? 0.55 : 1,
                }}
              >
                <Wrench size={22} />
              </button>
            </>
          );
        })()}

        <style>{btnCss}</style>
      </div>
      {showSkeletonTest && (
        <SkeletonTestModal takeoff={effectiveTakeoff} onClose={() => setShowSkeletonTest(false)} />
      )}
      {showSectionsEditor && (
        <RoofSectionsEditor
          centerLat={mapParams.centerLat}
          centerLng={mapParams.centerLng}
          zoom={mapParams.zoom}
          buildingRingLatLng={footprintRing}
          initialSections={roofSections}
          onClose={() => setShowSectionsEditor(false)}
          onSave={(bundle) => setRoofSections(bundle.roof_sections)}
        />
      )}
    </div>,
    document.body,
  );
}

/* ── Styles ── */
const overlayStyle: React.CSSProperties = {
  // zIndex 12000 = au-dessus du studio Annoter (11000) pour que Recaler
  // s'affiche correctement quand ouvert depuis le pill wrench.
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 12000,
  display: 'flex', alignItems: 'stretch', justifyContent: 'stretch', overflow: 'hidden',
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
};
const modalStyle: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', background: 'hsl(230,22%,8%)',
  color: '#e5e7eb', minWidth: 0, maxWidth: '100vw', overflow: 'hidden',
};
const inputSt: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4, color: '#e2e8f0', fontSize: 11, padding: '3px 6px', minWidth: 0,
};
const btnCss = `
.tl-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#e2e8f0;font-size:11px;cursor:pointer;}
.tl-btn:hover{background:rgba(255,255,255,0.1);}
.tl-btn-primary{background:hsl(265,70%,55%);border-color:hsl(265,70%,55%);color:#fff;}
.tl-btn-primary:hover{background:hsl(265,70%,60%);}
.tl-btn-primary:disabled{opacity:0.5;cursor:not-allowed;}
.tl-btn-danger{color:#f87171;border-color:rgba(248,113,113,0.3);}
.tl-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;border:none;background:transparent;color:#9ca3af;cursor:pointer;}
.tl-icon-btn:hover{background:rgba(255,255,255,0.08);}
@media (max-width: 767px){
  .tl-btn{min-height:44px;min-width:44px;padding:10px 14px;font-size:13px;gap:6px;border-radius:10px;justify-content:center;}
  .tl-btn-primary{font-weight:700;}
  .tl-icon-btn{width:40px;height:40px;border-radius:8px;}
  .tl-icon-btn svg{width:18px;height:18px;}
}
/* Make BuildingReadOnlyMap fill the editor's map column (override aspect-ratio
   from BuildingConfirmation.module.css that otherwise leaves black space). */
.tl-map-col > *{flex:1;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;}
.tl-map-col > * > div:first-child{flex:1;width:100%;height:100%;aspect-ratio:auto !important;max-width:none !important;min-height:0;}
`;