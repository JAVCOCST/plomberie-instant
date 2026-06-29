import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  type TrainingTakeoff,
  type DatasetStatus,
  type FilterPreset,
  STATUS_LABELS,
  STATUS_COLORS,
  applyPresetFilter,
  validateTakeoffForExport,
  buildBundleZip,
  importFromSoumissions,
  recoverTakeoffGeometryFromSoumission,
  diffV16VsRoofModel,
} from '@/lib/training-lab';
import TrainingTakeoffEditor from '@/components/training-lab/TrainingTakeoffEditor';
import TrainingLabExplorer from '@/components/training-lab/TrainingLabExplorer';
import { extractMainRingLatLng } from '@/lib/roof-sections';
const AdminRoofStudio = lazy(() => import('@/pages/AdminRoofStudio'));
import { fromRoofSectionsV16 } from '@/lib/roof-core/adapters/fromRoofSectionsV16';
import { runMvpV16Prediction, runClaudeVisionPrediction } from '@/lib/training-lab-mvp-bridge';
import { Download, RefreshCw, Plus, FlaskConical, Image as ImageIcon, FileJson, Wrench, CheckCircle2, AlertTriangle, Ban, Star, ChevronLeft, ChevronRight, Trash2, Boxes, Telescope, Sparkles, Loader2, Sun } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const sb = supabase as any;

const PRESETS: { id: FilterPreset; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'valid', label: 'Valides' },
  { id: 'to_fix', label: 'À corriger' },
  { id: 'calibration_issue', label: 'Problème calibration' },
  { id: 'footprint_suspect', label: 'Footprint douteux' },
  { id: 'image_missing', label: 'Image manquante' },
  { id: 'json_incomplete', label: 'JSON incomplet' },
  { id: 'ready', label: 'Prêt pour export' },
];

/** Petit badge derivé de l'état IA du dataset (3 états visuels) :
 *   - 🪄 Vierge    : ni roof_model ni roof_sections_v16.
 *   - ⏳ Génération : IA v1.6 en cours (in-memory).
 *   - 🤖 IA prête  : roof_sections_v16 rempli, pas encore validé humain.
 *   - ✅ Validé    : roof_model rempli (truth humaine).
 *  Le badge est purement informatif — pas cliquable. */
function AiStatusBadge({ row, generating }: { row: TrainingTakeoff; generating: boolean }) {
  let label: string, color: string;
  if (row.roof_model) { label = '✅ Validé'; color = 'hsl(160,70%,55%)'; }
  else if (generating) { label = '⏳ Génération'; color = 'hsl(38,90%,55%)'; }
  else if (row.roof_sections_v16) { label = '🤖 IA prête'; color = 'hsl(265,70%,65%)'; }
  else { label = '🪄 Vierge'; color = 'hsl(230,10%,60%)'; }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 600, background: color + '22', color, border: `1px solid ${color}55`,
    }}>{label}</span>
  );
}

function StatusPill({ status }: { status: DatasetStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: STATUS_COLORS[status] + '22',
        color: STATUS_COLORS[status],
        border: `1px solid ${STATUS_COLORS[status]}55`,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function Dot({ ok, title }: { ok: boolean; title: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: 999,
        background: ok ? 'hsl(140,65%,50%)' : 'hsl(0,60%,55%)',
      }}
    />
  );
}

function annotationSummary(row: TrainingTakeoff) {
  const anns = Array.isArray(row.annotations_json?.annotations) ? row.annotations_json.annotations.length : 0;
  const tools = Array.isArray(row.annotations_json?.tools) ? row.annotations_json.tools.length : 0;
  return { anns, tools };
}

export default function AdminTrainingLab() {
  const [rows, setRows] = useState<TrainingTakeoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<FilterPreset>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TrainingTakeoff | null>(null);
  const [annotating, setAnnotating] = useState<TrainingTakeoff | null>(null);
  // In-memory : ids des rows dont la pré-annotation IA v1.6 tourne en ce moment.
  // Permet le badge ⏳ et bloque les double-clicks sur le même dataset.
  const [generatingV16, setGeneratingV16] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [forceExport, setForceExport] = useState(false);
  // Mode "label-on-the-fly" : Google Maps plein écran pour annoter des bâtiments
  // hors-soumission. Cf. TrainingLabExplorer.
  const [explorerOpen, setExplorerOpen] = useState(false);
  const isMobile = useIsMobile();

  const load = async () => {
    setLoading(true);
    const { data, error } = await sb
      .from('training_roof_takeoffs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setRows((data || []) as TrainingTakeoff[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Auto-backfill : à chaque load, on calcule le roof_model_diff manquant pour
  // tous les datasets `validated`/`ready_for_training` qui ont un roof_model
  // mais pas encore de diff. Ça nourrit auto le quality_score (auto-fill
  // depuis correction_weight) sans que l'utilisateur ait à rouvrir chaque row.
  //
  // Pourquoi ici et pas en SQL : le diff a besoin de la lib JS
  // (`diffV16VsRoofModel` — Monte Carlo IoU, polygones, etc.) qui n'a pas
  // d'équivalent SQL. On le fait au load donc c'est idempotent (next-load
  // est gratuit puisque les rows ont déjà leur diff).
  useEffect(() => {
    if (loading || !rows.length) return;
    const needsDiff = rows.filter((r) =>
      (r.dataset_status === 'validated' || r.dataset_status === 'ready_for_training')
      && r.roof_model && Array.isArray((r.roof_model as any).sections)
      && (r.roof_model as any).sections.length > 0
      && !r.roof_model_diff
    );
    if (!needsDiff.length) return;
    let cancelled = false;
    (async () => {
      let computed = 0;
      for (const r of needsDiff) {
        if (cancelled) break;
        try {
          const diff = diffV16VsRoofModel(r.roof_sections_v16 as any, r.roof_model as any);
          const autoQuality = typeof diff.correction_weight === 'number'
            ? Math.max(0, Math.min(1, 1 - diff.correction_weight))
            : null;
          await sb.from('training_roof_takeoffs').update({
            roof_model_diff: diff,
            quality_score: r.quality_score != null ? r.quality_score : autoQuality,
          }).eq('id', r.id);
          computed++;
        } catch (e) {
          console.warn('[diff-backfill] failed for', r.id, e);
        }
      }
      if (!cancelled && computed > 0) {
        toast.success(`Diff backfill : ${computed} dataset(s) mis à jour`);
        await load();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const filtered = useMemo(() => {
    let r = applyPresetFilter(rows, preset);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((x) => (x.reference || '').toLowerCase().includes(q) || (x.address || '').toLowerCase().includes(q));
    }
    return r;
  }, [rows, preset, search]);

  const counts = useMemo(() => {
    const c: Record<FilterPreset, number> = {} as any;
    for (const p of PRESETS) c[p.id] = applyPresetFilter(rows, p.id).length;
    return c;
  }, [rows]);

  const editingIndex = editing ? filtered.findIndex((r) => r.id === editing.id) : -1;
  const goPrev = () => {
    if (!filtered.length) return;
    const i = editingIndex < 0 ? 0 : (editingIndex - 1 + filtered.length) % filtered.length;
    setEditing(filtered[i]);
  };
  const goNext = () => {
    if (!filtered.length) return;
    const i = editingIndex < 0 ? 0 : (editingIndex + 1) % filtered.length;
    setEditing(filtered[i]);
  };
  useEffect(() => {
    if (!editing) return;
    const h = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'Escape') setEditing(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, filtered, editingIndex]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  };

  const updateRow = async (id: string, patch: Partial<TrainingTakeoff>) => {
    const { error } = await sb.from('training_roof_takeoffs').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } as TrainingTakeoff : r)));
  };

  // Lazy first-render auto-fill of `debug_overlay_url` for rows that pre-date
  // the ingestion patch (Vague A §4.2). We use the same hybrid satellite tile
  // as ingest. Best-effort: if the patch fails (RLS, network) we just warn.
  // NOTE: this is the pragmatic fallback documented in audit §10 — the real
  // overlay is generated server-side later and will simply overwrite this.
  const ensureDebugOverlay = async (row: TrainingTakeoff): Promise<TrainingTakeoff> => {
    if (row.debug_overlay_url) return row;
    const apiKey = (import.meta as { env?: Record<string, string> }).env?.VITE_GOOGLE_MAPS_API_KEY || '';
    const mp = row.annotations_json?.map_params || {};
    const lat = typeof mp.centerLat === 'number' ? mp.centerLat : null;
    const lng = typeof mp.centerLng === 'number' ? mp.centerLng : null;
    const zoom = typeof mp.zoom === 'number' ? mp.zoom : 20;
    let url: string | null = null;
    if (apiKey && typeof lat === 'number' && typeof lng === 'number') {
      url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${Math.round(zoom)}&size=640x640&scale=2&maptype=hybrid&key=${apiKey}`;
    } else if (row.raw_image_url) {
      url = row.raw_image_url;
    }
    if (!url) return row;
    await updateRow(row.id, { debug_overlay_url: url } as Partial<TrainingTakeoff>);
    return { ...row, debug_overlay_url: url };
  };

  // ── "Annoter" click handler — opens the tracer with whatever truth exists.
  // CAS 1 : roof_model existe (truth humaine) → ouvre tel quel, JAMAIS d'appel IA.
  // CAS 2 : roof_sections_v16 existe (pré-annotation IA déjà générée) → ouvre tel quel.
  // CAS 3 : les deux absents → appelle la HF Space v1.6, sauve dans roof_sections_v16,
  //          puis ouvre le tracer avec la pré-annotation visible.
  // CAS 4 : HF Space échoue → toast clair + ouvre tracer vide (l'utilisateur peut
  //          dessiner à la main ou réessayer plus tard).
  // In-memory set des rows en cours de génération — pour le badge ⏳ et bloquer
  // les doubles-clicks.
  // Améliorer avec Claude Vision (mode refine si une pré-annotation existe,
  // mode predict sinon). Coût ~$0.01 par appel. Workflow recommandé :
  // 1. Clic "Annoter" → v1.6 ou YOLO fait le 1er jet (cheap)
  // 2. Clic "✨ Claude" → Claude corrige (un peu plus cher mais sémantique)
  // 3. Humain ouvre tracer, finit la correction (résiduelle, devrait être petite)
  // 4. Validate → roof_model = ce qui sert pour le retrain YOLO
  // → Boucle vertueuse : YOLO apprend de Claude → cycle suivant YOLO plus précis
  //   → besoin de moins de Claude → coût total diminue
  const [refiningWithClaude, setRefiningWithClaude] = useState<Set<string>>(new Set());

  // Test Google Solar API — appel direct + ouvre modal avec les résultats
  // pour qu'on compare manuellement à la truth humaine. Pas de save BD à cette
  // étape, c'est un OUTIL DE TEST pour évaluer la qualité avant intégration full.
  const [solarTesting, setSolarTesting] = useState<Set<string>>(new Set());
  const [solarResult, setSolarResult] = useState<null | {
    reference: string;
    summary: any;
    segments: any[];
    n_sections_human: number;
    n_sections_v16: number;
  }>(null);
  const onSolarTestClick = async (r: TrainingTakeoff) => {
    if (typeof r.centroid_lat !== 'number' || typeof r.centroid_lng !== 'number') {
      toast.error('Pas de centroid_lat/lng sur cette row — Solar API a besoin de lat/lng.');
      return;
    }
    setSolarTesting((s) => new Set(s).add(r.id));
    const tId = toast.loading('Google Solar API…');
    try {
      const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
      const { data, error } = await (sb as any).functions.invoke('solar-api-test', {
        body: { latitude: r.centroid_lat, longitude: r.centroid_lng, api_key: apiKey },
      });
      if (error) {
        let serverMsg = error.message || 'erreur';
        try {
          const ctx: any = (error as any).context;
          if (ctx?.body?.error) serverMsg = String(ctx.body.error);
          else if (typeof ctx?.json === 'function') {
            const j = await ctx.json();
            if (j?.error) serverMsg = String(j.error);
          }
        } catch { /* fallback */ }
        throw new Error(serverMsg);
      }
      if (data?.ok === false) throw new Error(data.error || 'Solar API a refusé');
      const summary = data?.summary;
      const segments = data?.segments || [];
      const nHuman = Array.isArray(r.roof_model?.sections) ? r.roof_model.sections.length : 0;
      const nV16 = Array.isArray(r.roof_sections_v16?.sections) ? r.roof_sections_v16.sections.length : 0;
      setSolarResult({
        reference: r.reference || r.id.slice(0, 6),
        summary,
        segments,
        n_sections_human: nHuman,
        n_sections_v16: nV16,
      });
      toast.success(`Solar API : ${summary.n_segments} segments, ${summary.total_area_m2} m²`, { id: tId });
    } catch (e: any) {
      toast.error(`Solar API : ${e?.message || e}`, { id: tId, duration: 8000 });
    } finally {
      setSolarTesting((s) => { const n = new Set(s); n.delete(r.id); return n; });
    }
  };
  const onClaudeRefineClick = async (r: TrainingTakeoff) => {
    if (r.roof_model) {
      const ok = confirm('Cette ligne a déjà une truth humaine validée. Vraiment écraser avec Claude ?');
      if (!ok) return;
    }
    if (!r.raw_image_url) {
      toast.error('Image manquante — Claude ne peut pas analyser.');
      return;
    }
    const buildingGeo = r.corrected_building_geojson || r.original_building_geojson;
    if (!buildingGeo) {
      toast.error('Polygone bâtiment manquant.');
      return;
    }
    setRefiningWithClaude((s) => new Set(s).add(r.id));
    const tId = toast.loading('✨ Claude analyse l\'image…');
    try {
      const mp = r.annotations_json?.map_params || null;
      // Si on a déjà du roof_sections_v16, on est en mode REFINE (Claude corrige)
      // Sinon mode PREDICT (Claude fait le 1er jet)
      const currentSections = r.roof_sections_v16?.sections;
      const mode = currentSections && currentSections.length > 0 ? 'refine' : 'predict';
      const out: any = await runClaudeVisionPrediction({
        imageUrl: r.raw_image_url,
        buildingGeojson: buildingGeo,
        mapParams: mp,
        mode,
        currentSections,
        currentBackend: mode === 'refine' ? (r.model_version_used || 'algo_v1_6') : undefined,
      });
      const cost = out?.metadata?.cost_estimate_usd ?? 0;
      const nSections = Array.isArray(out?.sections) ? out.sections.length : 0;
      toast.success(
        `Claude ${mode === 'refine' ? 'a corrigé' : 'a analysé'} (${nSections} sections, $${cost.toFixed(4)})`,
        { id: tId },
      );
      // Save dans roof_sections_v16 (pre-annotation IA) + postprocessed_json
      // (= version raffinée pour tracking lineage). On NE TOUCHE PAS au
      // roof_model si c'est une vraie truth humaine, mais si roof_model
      // existe vide (cas typique : tracer ouvert/fermé sans rien dessiner),
      // on le clear pour que le tracer charge la pré-annotation Claude au
      // prochain open.
      const existingHumanSections = Array.isArray(r.roof_model?.sections) ? r.roof_model.sections.length : 0;
      const clearEmptyRoofModel = r.roof_model && existingHumanSections === 0;
      const patch: Partial<TrainingTakeoff> = {
        roof_sections_v16: out,
        postprocessed_json: out,
        prediction_json: r.prediction_json || out,
        model_version_used: 'claude_vision_sonnet_4_6',
      };
      if (clearEmptyRoofModel) patch.roof_model = null as any;
      await updateRow(r.id, patch);
      // Ouvre le tracer avec la pré-annotation Claude — roof_model effacé
      // si vide donc le studio fallback sur roof_sections_v16.
      const updatedRow: TrainingTakeoff = {
        ...r, roof_sections_v16: out,
        roof_model: clearEmptyRoofModel ? null : r.roof_model,
      };
      openAnnotating(await ensureDebugOverlay(updatedRow));
    } catch (e: any) {
      toast.error(`Claude a échoué : ${e?.message || e}`, { id: tId, duration: 8000 });
    } finally {
      setRefiningWithClaude((s) => { const n = new Set(s); n.delete(r.id); return n; });
    }
  };

  const onAnnoterClick = async (r: TrainingTakeoff) => {
    // Safety guard: jamais écraser roof_model human_corrected.
    if (r.roof_model || r.roof_sections_v16) {
      openAnnotating(await ensureDebugOverlay(r));
      return;
    }
    if (generatingV16.has(r.id)) {
      toast.info('Génération IA déjà en cours pour ce dataset…');
      return;
    }
    if (!r.raw_image_url) {
      toast.error("Image satellite manquante — impossible de lancer l'IA.");
      openAnnotating(await ensureDebugOverlay(r));
      return;
    }
    const mp = r.annotations_json?.map_params || null;
    const buildingGeo = r.corrected_building_geojson || r.original_building_geojson;
    if (!buildingGeo) {
      toast.error('Polygone bâtiment manquant — impossible de cadrer la prédiction IA.');
      openAnnotating(await ensureDebugOverlay(r));
      return;
    }
    setGeneratingV16((s) => new Set(s).add(r.id));
    const toastId = toast.loading('🪄 Génération pré-annotation IA v1.6…');
    try {
      const v16 = await runMvpV16Prediction({
        imageUrl: r.raw_image_url,
        buildingGeojson: buildingGeo,
        mapParams: mp,
        roofType: 'mixed',
        // 'adaptive' : la pipeline détermine le cap (1-5 sections sub-volumes)
        // depuis le graphe de relations du bâtiment (typology-driven). Plus de
        // sélection manuelle dans le portail — l'IA s'auto-régule.
        selectionMode: 'adaptive',
      });
      // Phase 7 hybride : on persiste l'output dans 2 colonnes pour trace.
      // - roof_sections_v16 : rétrocompat code existant
      // - postprocessed_json : output après régul Manhattan (= ce qu'on montre
      //   à l'humain dans le tracer)
      // - prediction_json : reste backfillé via roof_sections_v16 (la sortie
      //   complète régularisée). Quand le backend ML_v1 sera live, on splitera
      //   en envoyant raw_before_regul dans la metadata HF.
      const activeModel = await (async () => {
        try {
          const { data } = await (sb.from as any)('model_versions').select('model_code').eq('is_active', true).maybeSingle();
          return (data as any)?.model_code || 'algo_v1_6';
        } catch { return 'algo_v1_6'; }
      })();
      await updateRow(r.id, {
        roof_sections_v16: v16,
        prediction_json: v16,
        postprocessed_json: v16,
        model_version_used: activeModel,
      } as Partial<TrainingTakeoff>);
      toast.success('Pré-annotation IA v1.6 générée.', { id: toastId });
      const updatedRow: TrainingTakeoff = { ...r, roof_sections_v16: v16 };
      openAnnotating(await ensureDebugOverlay(updatedRow));
    } catch (e: any) {
      toast.error(`Pré-annotation IA indisponible : ${e?.message || e}`, { id: toastId, duration: 10000 });
      openAnnotating(await ensureDebugOverlay(r));
    } finally {
      setGeneratingV16((s) => { const n = new Set(s); n.delete(r.id); return n; });
    }
  };

  // ── RoofModel annotation. Training Lab is ONLY the shell: AdminRoofStudio owns
  // all geometry/correction/truth. Open priority: human_corrected RoofModel →
  // MVP v1.6 pre-annotation → empty tracer + image. ──
  const studioPropsFor = (row: TrainingTakeoff): { initialModel?: any; backgroundImage?: string; displaySettings?: any; overlayBuildingLatLng?: [number, number][] | null; overlayLotLatLng?: [number, number][] | null; overlayGeoRef?: { centerLat: number; centerLng: number; zoom: number; imageW: number; imageH: number; scale: number } | null } => {
    const backgroundImage = row.raw_image_url || row.annotated_image_url || undefined;
    const seedName = row.reference || row.address || '';
    const displaySettings = (row as any).display_settings || null;
    // Polygones lat/lng à projeter en overlay dans le studio (Calques pill).
    // On préfère corrected_ (édité par le user) sinon original_ (sortie IA).
    const overlayBuildingLatLng = extractMainRingLatLng(row.corrected_building_geojson || row.original_building_geojson);
    const overlayLotLatLng = extractMainRingLatLng(row.corrected_lot_geojson || row.original_lot_geojson);
    // geoRef de la capture Static Maps (centre lat/lng + zoom utilisés). Sans
    // ces 3 valeurs, impossible de projeter le lat/lng → image px → overlay
    // désactivé silencieusement. map_params.zoom peut être absent si vieux
    // dataset → fallback 20 (default historique de buildStaticMapUrl).
    const mp = row.annotations_json?.map_params;
    const overlayGeoRef = (mp && typeof mp.centerLat === 'number' && typeof mp.centerLng === 'number')
      ? { centerLat: mp.centerLat, centerLng: mp.centerLng, zoom: typeof mp.zoom === 'number' ? mp.zoom : 20, imageW: 1280, imageH: 1280, scale: 2 }
      : null;

    // Filet localStorage : si la DB n'a PAS reçu le dernier flush (réseau,
    // crash, etc.), on a une copie locale. On la préfère SI son updated_at
    // est plus récent que le row.updated_at de la DB. Sinon on prend la DB.
    let initialModel: any;
    if (row.roof_model && Array.isArray(row.roof_model?.sections)) {
      const m = { ...row.roof_model };
      if (!m.name) m.name = seedName;
      if (!m.address && row.address) m.address = row.address;
      initialModel = m;
    } else if (row.roof_sections_v16) {
      try {
        const res = fromRoofSectionsV16(row.roof_sections_v16);
        initialModel = { ...res.model, rejectedDebug: res.rejected, name: seedName, address: row.address || null };
      } catch (e: any) {
        toast.error(`MVP v1.6 invalide: ${e?.message || e}`);
        initialModel = { version: 1, sections: [], name: seedName, address: row.address || null, metadata: { source: 'human_corrected', status: 'needs_review' } };
      }
    } else {
      initialModel = { version: 1, sections: [], name: seedName, address: row.address || null, metadata: { source: 'human_corrected', status: 'needs_review' } };
    }

    const local = readLocalDraft(row.id);
    if (local && local.model) {
      const rowUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      if (local.savedAt > rowUpdatedAt) {
        console.log('[autosave] localStorage draft NEWER than DB — restoring', { id: row.id, localSavedAt: new Date(local.savedAt).toISOString(), dbUpdatedAt: row.updated_at, localAlts: local.model?.suggestions?.length, localRej: local.model?.rejectedSuggestions?.length, dbAlts: initialModel?.suggestions?.length, dbRej: initialModel?.rejectedSuggestions?.length });
        toast.info('Brouillon local restauré (la DB n\'avait pas reçu la dernière sauvegarde)');
        initialModel = local.model;
      } else {
        console.log('[autosave] localStorage draft older than DB — ignoring', { id: row.id });
        clearLocalDraft(row.id);
      }
    }
    console.log('[autosave] opening annotation', { id: row.id, alts: initialModel?.suggestions?.length, rej: initialModel?.rejectedSuggestions?.length, sec: initialModel?.sections?.length });
    return { initialModel, backgroundImage, displaySettings, overlayBuildingLatLng, overlayLotLatLng, overlayGeoRef };
  };

  // Autosave display_settings — sliders brightness/contrast déjà debounced
  // côté studio (400ms). Ici on push direct vers la DB.
  const onStudioDisplayChange = (settings: { brightness: number; contrast: number }) => {
    const id = annotatingIdRef.current;
    if (!id) return;
    void updateRow(id, { display_settings: settings } as any).catch((e: any) => {
      console.warn('[training-lab display_settings] save failed:', e);
    });
  };

  // ── Autosave brouillon — sauve roof_model à chaque edit (debounced) puis
  // flush au close pour qu'aucun travail ne soit perdu si l'utilisateur ferme
  // sans cliquer "Valider". Le dataset_status NE change pas tant qu'on n'a pas
  // validé : on garde 'draft' / 'ready_for_training' / etc. tel quel.
  const draftTimerRef = useRef<number | null>(null);
  const latestDraftRef = useRef<any>(null);
  const annotatingIdRef = useRef<string | null>(null);
  // Belt-and-suspenders : on synchronise AUSSI via useEffect au cas où
  // setAnnotating est appelé sans passer par openAnnotating (safety net).
  useEffect(() => { annotatingIdRef.current = annotating?.id || null; }, [annotating?.id]);

  // openAnnotating remplace setAnnotating(row) : on set annotatingIdRef
  // SYNCHRONEMENT avant le render React. Sinon, le premier onModelChange émis
  // par le studio au mount tombe dans la branche `if (!annotatingIdRef.current) return`
  // (parent effects run APRÈS child effects → race).
  const openAnnotating = (row: TrainingTakeoff | null) => {
    annotatingIdRef.current = row?.id || null;
    setAnnotating(row);
  };

  // Filet de sécurité : on copie chaque draft dans localStorage. Si la DB
  // foire (réseau, RLS, race) on a TOUJOURS le travail au prochain open.
  const lsKey = (id: string) => 'tl-draft-' + id;
  const writeLocalDraft = (id: string, model: any) => {
    try { localStorage.setItem(lsKey(id), JSON.stringify({ model: model, savedAt: Date.now() })); } catch {}
  };
  const readLocalDraft = (id: string): any | null => {
    try { const raw = localStorage.getItem(lsKey(id)); if (!raw) return null; const j = JSON.parse(raw); return j && j.model ? j : null; } catch { return null; }
  };
  const clearLocalDraft = (id: string) => { try { localStorage.removeItem(lsKey(id)); } catch {} };

  const flushDraft = async () => {
    const id = annotatingIdRef.current;
    const model = latestDraftRef.current;
    console.log('[autosave] flushDraft called', { id: id, hasModel: !!model, alts: model?.suggestions?.length, rej: model?.rejectedSuggestions?.length, sec: model?.sections?.length });
    if (!id || !model) return;
    latestDraftRef.current = null;
    // Filet local AVANT la DB — comme ça même si le réseau crashe à mi-chemin,
    // le draft survit dans localStorage et sera proposé au prochain open.
    writeLocalDraft(id, model);
    try {
      await updateRow(id, { roof_model: model });
      // Succès DB : on peut effacer le local (la DB est la vérité).
      clearLocalDraft(id);
      console.log('[autosave] DB update OK for', id);
    } catch (e) {
      console.warn('[autosave] DB update FAILED, draft kept in localStorage:', e);
    }
  };

  const onStudioDraftChange = (model: any) => {
    if (!annotatingIdRef.current) {
      console.warn('[autosave] onStudioDraftChange: annotatingIdRef is null — model dropped');
      return;
    }
    latestDraftRef.current = model;
    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      void flushDraft();
    }, 1500);
  };

  const handleStudioClose = async () => {
    if (draftTimerRef.current) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    const hadDraft = latestDraftRef.current != null;
    const row = annotating;
    const draftModel = latestDraftRef.current;

    // Avant : on flushait juste le draft (roof_model) et le dataset_status
    // restait en 'draft'. Résultat : 9 datasets avaient une truth réelle
    // (≥2 sections dessinées) mais étaient ignorés au moment de l'export.
    //
    // Maintenant : si la truth est non-triviale au close (≥1 section avec
    // ≥3 pts), on fait le MÊME traitement que onStudioValidate :
    // → roof_model + diff + quality_score + dataset_status='validated'.
    // L'utilisateur peut toujours rouvrir et modifier ; il n'y a aucun coût
    // à promouvoir tôt, alors qu'il y a un coût énorme à laisser fuiter.
    const sections = Array.isArray(draftModel?.sections) ? draftModel.sections : [];
    const hasUsableTruth = sections.some(
      (s: any) => Array.isArray(s?.pts) && s.pts.length >= 3,
    );

    if (row && draftModel && hasUsableTruth && row.dataset_status === 'draft') {
      latestDraftRef.current = null;
      let diff: ReturnType<typeof diffV16VsRoofModel> | null = null;
      try {
        diff = diffV16VsRoofModel(row.roof_sections_v16, draftModel);
      } catch (e) {
        console.warn('[autosave] diff at close failed (non-fatal):', e);
      }
      const autoQuality = diff && typeof diff.correction_weight === 'number'
        ? Math.max(0, Math.min(1, 1 - diff.correction_weight))
        : null;
      const patch: Partial<TrainingTakeoff> = {
        roof_model: draftModel,
        roof_model_diff: diff,
        quality_score: row.quality_score != null ? row.quality_score : autoQuality,
        dataset_status: 'validated',
      };
      try {
        await updateRow(row.id, patch);
        clearLocalDraft(row.id);
        toast.success('Brouillon finalisé — dataset marqué « Validé »');
      } catch (e) {
        console.warn('[autosave] close-time validate failed, falling back to draft flush:', e);
        await flushDraft();
        toast.success('Brouillon sauvegardé (status inchangé)');
      }
    } else {
      // Pas de truth utilisable → on reste sur le comportement historique
      // (juste flush du draft, status inchangé).
      await flushDraft();
      if (hadDraft) toast.success('Brouillon sauvegardé');
    }
    openAnnotating(null);
  };

  const onStudioValidate = async (model: any) => {
    const row = annotating; if (!row) return;
    // Pending draft becomes the validated model — no need to write twice.
    if (draftTimerRef.current) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    latestDraftRef.current = null;
    // Vague A §4.2: at save time we ALSO compute the v1.6 ↔ human diff so the
    // bundle's diff.json and the auto quality_score are produced atomically.
    // A single updateRow() call writes: roof_model + roof_model_diff +
    // quality_score (auto-fill from diff.correction_weight when null) +
    // dataset_status='validated' to keep the row coherent in one DB round-trip.
    let diff: ReturnType<typeof diffV16VsRoofModel> | null = null;
    try {
      diff = diffV16VsRoofModel(row.roof_sections_v16, model);
    } catch (e) {
      console.warn('[training-lab] diff computation failed (non-fatal):', e);
    }
    const patch: Partial<TrainingTakeoff> = {
      roof_model: model,
      roof_model_diff: diff,
      // Auto-fill quality_score only when not yet set manually. Heuristic:
      // 1 - correction_weight (a perfect MVP match scores 1, total redraw scores 0).
      quality_score:
        row.quality_score != null
          ? row.quality_score
          : diff && typeof diff.correction_weight === 'number'
            ? Math.max(0, Math.min(1, 1 - diff.correction_weight))
            : null,
      dataset_status: 'validated',
    };
    await updateRow(row.id, patch);
    toast.success('RoofModel validé — cas marqué « Validé »');
    openAnnotating(null);
  };

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    const tId = toast.loading('Import depuis soumissions… (peut prendre 30-60s)');
    try {
      const n = await importFromSoumissions();
      toast.success(`${n} takeoff(s) importé(s)`, { id: tId });
      await load();
    } catch (e: any) {
      console.error('[training-lab import] failed:', e);
      toast.error(`Import échoué: ${e?.message || e}`, { id: tId });
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce takeoff ?')) return;
    const { error } = await sb.from('training_roof_takeoffs').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length) { toast.error('Aucun takeoff sélectionné'); return; }
    const ok = confirm(
      `Supprimer ${ids.length} takeoff(s) du Training Lab ?\n\n` +
      `Cette action n'affecte PAS la table soumissions — uniquement training_roof_takeoffs.`,
    );
    if (!ok) return;
    const { error } = await sb.from('training_roof_takeoffs').delete().in('id', ids);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
    toast.success(`${ids.length} takeoff(s) supprimé(s) du lab`);
  };

  const handleAddTag = async (row: TrainingTakeoff, tag: string) => {
    const has = (row.tags || []).includes(tag);
    const next = has ? (row.tags || []).filter((t) => t !== tag) : [...(row.tags || []), tag];
    await updateRow(row.id, { tags: next });
    toast.success(has ? `Tag retiré: ${tag}` : `Tag ajouté: ${tag}`);
  };

  const handleMarkReady = async (row: TrainingTakeoff) => {
    await updateRow(row.id, { dataset_status: 'ready_for_training' });
    toast.success(`${row.reference || row.id.slice(0, 6)} marqué prêt pour entraînement`);
  };

  const openEditor = async (row: TrainingTakeoff) => {
    const annCount = Array.isArray(row.annotations_json?.annotations) ? row.annotations_json.annotations.length : 0;
    if ((row.original_building_geojson || row.corrected_building_geojson) && annCount > 0) { setEditing(row); return; }
    const tId = toast.loading('Récupération du polygone depuis la soumission…');
    const patch = await recoverTakeoffGeometryFromSoumission(row);
    if (patch) {
      await updateRow(row.id, patch);
      const fixed = { ...row, ...patch } as TrainingTakeoff;
      setEditing(fixed);
      toast.success('Données récupérées depuis la soumission', { id: tId });
    } else {
      setEditing(row);
      toast.error('Aucune donnée source récupérable trouvée dans la soumission', { id: tId });
    }
  };

  // Ouvre directement Annoter (AdminRoofStudio), sans passer par la page
  // Recaler intermédiaire. Fait la même prep de données qu'openEditor mais
  // appelle openAnnotating au lieu de setEditing. C'est le path standard
  // depuis la carte dataset — l'utilisateur peut toujours ouvrir Recaler
  // explicitement via le bouton wrench, mais 90% du temps il veut juste
  // annoter direct.
  const openAnnotateDirectly = async (row: TrainingTakeoff) => {
    const annCount = Array.isArray(row.annotations_json?.annotations) ? row.annotations_json.annotations.length : 0;
    if ((row.original_building_geojson || row.corrected_building_geojson) && annCount > 0) { openAnnotating(row); return; }
    const tId = toast.loading('Récupération du polygone depuis la soumission…');
    const patch = await recoverTakeoffGeometryFromSoumission(row);
    if (patch) {
      await updateRow(row.id, patch);
      const fixed = { ...row, ...patch } as TrainingTakeoff;
      openAnnotating(fixed);
      toast.success('Données récupérées depuis la soumission', { id: tId });
    } else {
      openAnnotating(row);
      toast.error('Aucune donnée source récupérable trouvée dans la soumission', { id: tId });
    }
  };

  const handleExport = async () => {
    const picks = rows.filter((r) => selected.has(r.id));
    if (!picks.length) { toast.error('Aucun takeoff sélectionné'); return; }
    const issues: string[] = [];
    for (const p of picks) {
      const v = validateTakeoffForExport(p);
      if (!v.ok) issues.push(`${p.reference || p.id.slice(0, 6)}: ${v.errors.join(', ')}`);
    }
    if (issues.length && !forceExport) {
      toast.error(
        `Validation échouée (${issues.length}) — coche "Forcer l'export (brouillon)" pour ignorer.\n` +
          issues.slice(0, 5).join('\n'),
        { duration: 9000 }
      );
      console.warn('Bundle validation issues:', issues);
      return;
    }
    setExporting(true);
    try {
      const blob = await buildBundleZip(picks, `Bundle ${new Date().toISOString()}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training-bundle-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      const { data: batch } = await sb.from('training_export_batches').insert({
        takeoff_ids: picks.map((p) => p.id),
        status: 'completed',
        description: `Export ${picks.length} takeoff(s)`,
      }).select().single();
      if (batch) {
        await sb.from('training_roof_takeoffs')
          .update({ dataset_status: 'exported', export_batch_id: batch.id })
          .in('id', picks.map((p) => p.id));
        await load();
      }
      toast.success(`Bundle généré (${picks.length} takeoff(s))`);
    } catch (e: any) { toast.error(e.message); }
    finally { setExporting(false); }
  };

  return (
    <div style={{ padding: isMobile ? 12 : 20, color: '#e5e7eb', minHeight: '100%', paddingBottom: isMobile && selected.size > 0 ? 88 : (isMobile ? 16 : 20) }}>
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FlaskConical size={18} color="hsl(265,70%,65%)" />
            <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0, flex: 1 }}>Training Lab</h1>
            <button onClick={load} className="vb-btn" style={{ padding: '8px 10px' }} title="Actualiser">
              <RefreshCw size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
            <button onClick={() => setExplorerOpen(true)} className="vb-btn vb-btn-primary" style={{ flexShrink: 0, whiteSpace: 'nowrap' }} title="Annoter de nouveaux bâtiments depuis la carte">
              <Telescope size={14} /> Explorer
            </button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'hsl(230,10%,65%)', flexShrink: 0, padding: '0 6px', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={forceExport} onChange={(e) => setForceExport(e.target.checked)} />
              Forcer
            </label>
          </div>
        </div>
      ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <FlaskConical size={22} color="hsl(265,70%,65%)" />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Training Lab Toiture</h1>
        <span style={{ color: 'hsl(230,10%,50%)', fontSize: 12 }}>
          Préparation de datasets pour entraînement IA — séparé du flux soumission
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={load} className="vb-btn" title="Actualiser">
            <RefreshCw size={14} /> Actualiser
          </button>
          <button onClick={() => setExplorerOpen(true)} className="vb-btn vb-btn-primary" title="Annoter de nouveaux bâtiments depuis la carte">
            <Telescope size={14} /> Explorer la carte
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'hsl(230,10%,55%)' }}>
            <input type="checkbox" checked={forceExport} onChange={(e) => setForceExport(e.target.checked)} />
            Forcer l'export
          </label>
          <button
            onClick={handleExport}
            disabled={exporting || selected.size === 0}
            className="vb-btn vb-btn-primary"
          >
            <Download size={14} /> {exporting ? 'Génération…' : `Générer bundle Claude (${selected.size})`}
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selected.size === 0}
            className="vb-btn"
            style={{ borderColor: 'hsl(0,60%,40%)', color: 'hsl(0,70%,70%)' }}
            title="Supprimer du Training Lab uniquement (n'affecte pas les soumissions)"
          >
            <Trash2 size={14} /> Supprimer ({selected.size})
          </button>
        </div>
      </div>
      )}

      <div style={isMobile
        ? { display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 10, paddingBottom: 2 }
        : { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }
      }>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            style={{
              padding: isMobile ? '8px 12px' : '6px 10px',
              borderRadius: 8,
              fontSize: isMobile ? 13 : 12,
              border: '1px solid hsl(230,20%,18%)',
              background: preset === p.id ? 'hsl(265,70%,65%)' : 'hsl(230,22%,12%)',
              color: preset === p.id ? '#fff' : 'hsl(230,10%,75%)',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {p.label} <span style={{ opacity: 0.6 }}>({counts[p.id] || 0})</span>
          </button>
        ))}
        {!isMobile && <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (référence, adresse)…"
          style={{
            marginLeft: 'auto',
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid hsl(230,20%,18%)',
            background: 'hsl(230,22%,10%)',
            color: '#e5e7eb',
            fontSize: 13,
            minWidth: 240,
          }}
        />}
      </div>
      {isMobile && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (référence, adresse)…"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid hsl(230,20%,18%)',
            background: 'hsl(230,22%,10%)',
            color: '#e5e7eb',
            fontSize: 16,
            marginBottom: 10,
            boxSizing: 'border-box',
          }}
        />
      )}

      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'hsl(230,10%,50%)' }}>Chargement…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'hsl(230,10%,50%)' }}>
              Aucun takeoff. Touche "Importer" pour démarrer.
            </div>
          )}
          {filtered.map((r) => {
            const { anns, tools } = annotationSummary(r);
            const isSel = selected.has(r.id);
            return (
              <div
                key={r.id}
                style={{
                  background: 'hsl(230,22%,10%)',
                  border: `1px solid ${isSel ? 'hsl(265,70%,55%)' : 'hsl(230,20%,15%)'}`,
                  borderRadius: 12,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(r.id)}
                    style={{ width: 22, height: 22, flexShrink: 0, marginTop: 2 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }} onClick={() => openAnnotateDirectly(r)}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'ui-monospace, monospace' }}>
                      {r.reference || r.id.slice(0, 6)}
                    </div>
                    <div style={{ fontSize: 12, color: 'hsl(230,10%,70%)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.address || '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'hsl(230,10%,50%)', marginTop: 2 }}>
                      {new Date(r.created_at).toLocaleDateString('fr-CA')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                    <StatusPill status={r.dataset_status} />
                    <AiStatusBadge row={r} generating={generatingV16.has(r.id)} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }} onClick={() => openAnnotateDirectly(r)}>
                  <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 6, background: 'hsl(230,22%,8%)', border: '1px solid hsl(230,20%,18%)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {r.raw_image_url
                      ? <img src={r.raw_image_url} alt="brute" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                      : <ImageIcon size={20} color="hsl(0,40%,40%)" />}
                  </div>
                  <div style={{ flex: 1, aspectRatio: '4/3', borderRadius: 6, background: 'hsl(230,22%,8%)', border: '1px solid hsl(230,20%,18%)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {(() => {
                      // Priorité : si on a un roof_model (truth humaine), on le dessine
                      // en SVG par-dessus l'image raw → l'utilisateur voit immédiatement
                      // ses annotations sans devoir ouvrir le tracer. Sinon fallback
                      // sur annotated_image_url (qui ne sera jamais set pour Mode Explorer).
                      const hasRm = r.roof_model && Array.isArray(r.roof_model?.sections) && r.roof_model.sections.length;
                      if (hasRm && r.raw_image_url) {
                        const imgW = r.roof_model?.image?.width || 1280;
                        const imgH = r.roof_model?.image?.height || 1280;
                        return (
                          <>
                            <img src={r.raw_image_url} alt="annotée" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                            <svg viewBox={`0 0 ${imgW} ${imgH}`} preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                              {r.roof_model.sections.map((sec: any, si: number) => {
                                if (!Array.isArray(sec?.pts) || sec.pts.length < 3) return null;
                                const d = sec.pts.map((p: any, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
                                return <path key={si} d={d} fill="rgba(68,255,136,0.30)" stroke="#44ff88" strokeWidth={4} />;
                              })}
                            </svg>
                          </>
                        );
                      }
                      if (r.annotated_image_url) {
                        return <img src={r.annotated_image_url} alt="annotée" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />;
                      }
                      return <span style={{ fontSize: 10, color: 'hsl(230,10%,40%)' }}>Pas d'annotation</span>;
                    })()}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'hsl(230,10%,60%)', flexWrap: 'wrap' }}>
                  <span><Dot ok={!!(r.original_lot_geojson || r.corrected_lot_geojson)} title="Lot" /> Lot</span>
                  <span><Dot ok={!!(r.original_building_geojson || r.corrected_building_geojson)} title="Bât." /> Bât.</span>
                  <span style={{ color: r.annotations_json ? 'hsl(140,65%,55%)' : 'hsl(230,10%,40%)' }}>
                    {anns} ann. · {tools} outils
                  </span>
                  {r.quality_score != null && <span>Score {r.quality_score}</span>}
                </div>

                {(r.tags || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(r.tags || []).map((t) => (
                      <button
                        key={t}
                        onClick={() => handleAddTag(r, t)}
                        style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'hsl(265,40%,25%)', color: 'hsl(265,70%,80%)', border: 'none' }}
                      >
                        {t} ×
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => openEditor(r)} className="vb-btn" style={{ flex: 1, justifyContent: 'center', minWidth: 90 }} title="Recaler le polygone bâtiment sur l'image satellite">
                    <Wrench size={14} /> Recaler
                  </button>
                  <button onClick={() => onAnnoterClick(r)} className="vb-btn" style={{ flex: 1, justifyContent: 'center', minWidth: 90 }} title="Tracer la toiture en 2D/3D — ce que l'IA apprend">
                    <Boxes size={14} color={r.roof_model ? 'hsl(160,70%,55%)' : r.roof_sections_v16 ? 'hsl(265,70%,65%)' : undefined} /> Annoter
                  </button>
                  <button
                    onClick={() => onSolarTestClick(r)}
                    disabled={solarTesting.has(r.id)}
                    className="vb-btn"
                    style={{ padding: '8px 10px', borderColor: 'hsl(38,90%,40%)', color: 'hsl(38,90%,70%)' }}
                    title="Test Google Solar API sur cette row (~$0.01) — compare nb segments vs ta truth"
                  >
                    {solarTesting.has(r.id) ? <Loader2 size={14} className="animate-spin" /> : <Sun size={14} />}
                  </button>
                  <button onClick={() => handleAddTag(r, 'good_example')} className="vb-btn" style={{ padding: '8px 10px' }} title="Bon exemple">
                    <Star size={14} color="hsl(48,90%,60%)" />
                  </button>
                  <button onClick={() => handleAddTag(r, 'problem_case')} className="vb-btn" style={{ padding: '8px 10px' }} title="Cas problème">
                    <AlertTriangle size={14} color="hsl(28,90%,60%)" />
                  </button>
                  <button onClick={() => handleMarkReady(r)} className="vb-btn" style={{ padding: '8px 10px' }} title="Prêt">
                    <CheckCircle2 size={14} color="hsl(140,65%,55%)" />
                  </button>
                  <button onClick={() => handleDelete(r.id)} className="vb-btn" style={{ padding: '8px 10px', borderColor: 'hsl(0,60%,40%)', color: 'hsl(0,70%,70%)' }} title="Supprimer">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div style={{ border: '1px solid hsl(230,20%,15%)', borderRadius: 10, overflow: 'auto', background: 'hsl(230,22%,9%)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: 'hsl(230,22%,11%)', position: 'sticky', top: 0 }}>
            <tr style={{ color: 'hsl(230,10%,55%)', textAlign: 'left' }}>
              <th style={{ padding: 8, width: 28 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th style={{ padding: 8 }}>Référence</th>
              <th style={{ padding: 8 }}>Adresse</th>
              <th style={{ padding: 8 }}>Date</th>
              <th style={{ padding: 8 }}>Brute</th>
              <th style={{ padding: 8 }}>Annotée</th>
              <th style={{ padding: 8, textAlign: 'center' }}>JSON</th>
              <th style={{ padding: 8, textAlign: 'center' }}>Lot</th>
              <th style={{ padding: 8, textAlign: 'center' }}>Bât.</th>
              <th style={{ padding: 8 }}>Statut</th>
              <th style={{ padding: 8 }}>Score</th>
              <th style={{ padding: 8 }}>Tags</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={13} style={{ padding: 18, textAlign: 'center', color: 'hsl(230,10%,50%)' }}>Chargement…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={13} style={{ padding: 18, textAlign: 'center', color: 'hsl(230,10%,50%)' }}>
                Aucun takeoff. Clique "Importer depuis soumissions" pour démarrer.
              </td></tr>
            )}
            {filtered.map((r) => (
              <tr
                key={r.id}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('button, a, input, select, textarea, label')) return;
                  openAnnotateDirectly(r);
                }}
                style={{ borderTop: '1px solid hsl(230,20%,13%)', cursor: 'pointer' }}
                title="Cliquer pour ouvrir l'éditeur d'annotations"
              >
                <td style={{ padding: 8 }} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td style={{ padding: 8, fontFamily: 'ui-monospace, monospace', color: '#fff' }}>{r.reference || r.id.slice(0, 6)}</td>
                <td style={{ padding: 8, color: 'hsl(230,10%,70%)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address || '—'}</td>
                <td style={{ padding: 8, color: 'hsl(230,10%,55%)' }}>{new Date(r.created_at).toLocaleDateString('fr-CA')}</td>
                <td style={{ padding: 4 }}>
                  {r.raw_image_url ? (
                    <a href={r.raw_image_url} target="_blank" rel="noreferrer">
                      <img src={r.raw_image_url} alt="brute" referrerPolicy="no-referrer" style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 4, border: '1px solid hsl(230,20%,20%)' }} loading="lazy" />
                    </a>
                  ) : <span style={{ fontSize: 10, color: 'hsl(0,40%,55%)' }}>—</span>}
                </td>
                <td style={{ padding: 4 }}>
                  {r.annotated_image_url ? (
                    <a href={r.annotated_image_url} target="_blank" rel="noreferrer">
                      <img src={r.annotated_image_url} alt="annotée" referrerPolicy="no-referrer" style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 4, border: '1px solid hsl(230,20%,20%)' }} loading="lazy" />
                    </a>
                  ) : <span style={{ fontSize: 10, color: 'hsl(230,10%,40%)' }}>—</span>}
                </td>
                <td style={{ padding: 8, textAlign: 'center' }} title={r.annotations_json ? JSON.stringify(r.annotations_json, null, 2) : 'aucune annotation'}>
                  {r.annotations_json ? (() => {
                    const { anns, tools } = annotationSummary(r);
                    return (
                    <span style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'hsl(140,65%,55%)' }}>
                      {anns} ann. · {tools} outils
                    </span>
                    );
                  })() : (
                    <FileJson size={14} color="hsl(0,40%,40%)" />
                  )}
                </td>
                <td style={{ padding: 8, textAlign: 'center' }}>
                  <Dot ok={!!(r.original_lot_geojson || r.corrected_lot_geojson)} title="Polygon lot" />
                </td>
                <td style={{ padding: 8, textAlign: 'center' }}>
                  <Dot ok={!!(r.original_building_geojson || r.corrected_building_geojson)} title="Polygon bâtiment" />
                </td>
                <td style={{ padding: 8 }}>
                  <select
                    value={r.dataset_status}
                    onChange={(e) => updateRow(r.id, { dataset_status: e.target.value as DatasetStatus })}
                    style={{
                      background: 'transparent',
                      color: STATUS_COLORS[r.dataset_status],
                      border: `1px solid ${STATUS_COLORS[r.dataset_status]}55`,
                      borderRadius: 6,
                      padding: '2px 6px',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {Object.keys(STATUS_LABELS).map((k) => (
                      <option key={k} value={k} style={{ background: '#111' }}>{STATUS_LABELS[k as DatasetStatus]}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    type="number" min={0} max={1} step={0.05}
                    value={r.quality_score ?? ''}
                    onChange={(e) => updateRow(r.id, { quality_score: e.target.value === '' ? null : Number(e.target.value) })}
                    style={{ width: 60, padding: '2px 6px', background: 'hsl(230,22%,12%)', border: '1px solid hsl(230,20%,18%)', color: '#fff', borderRadius: 4, fontSize: 12 }}
                  />
                </td>
                <td style={{ padding: 8, maxWidth: 200 }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(r.tags || []).map((t) => (
                      <button
                        key={t}
                        onClick={() => handleAddTag(r, t)}
                        title="Cliquer pour retirer ce tag"
                        style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'hsl(265,40%,25%)', color: 'hsl(265,70%,80%)', border: 'none', cursor: 'pointer' }}
                      >
                        {t} ×
                      </button>
                    ))}
                  </div>
                </td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEditor(r)} className="vb-icon-btn" title="Recaler le polygone bâtiment sur l'image satellite">
                    <Wrench size={13} />
                  </button>
                  <button onClick={() => onAnnoterClick(r)} className="vb-icon-btn" title="Annoter la toiture en 2D/3D — ce que l'IA apprend">
                    <Boxes size={13} color={r.roof_model ? 'hsl(160,70%,55%)' : r.roof_sections_v16 ? 'hsl(265,70%,65%)' : 'hsl(230,10%,60%)'} />
                  </button>
                  <button onClick={() => handleAddTag(r, 'good_example')} className="vb-icon-btn" title="Bon exemple">
                    <Star size={13} color="hsl(48,90%,60%)" />
                  </button>
                  <button onClick={() => handleAddTag(r, 'problem_case')} className="vb-icon-btn" title="Cas problème">
                    <AlertTriangle size={13} color="hsl(28,90%,60%)" />
                  </button>
                  <button onClick={() => handleAddTag(r, 'do_not_use')} className="vb-icon-btn" title="Ne pas utiliser">
                    <Ban size={13} color="hsl(0,70%,60%)" />
                  </button>
                  <button onClick={() => handleMarkReady(r)} className="vb-icon-btn" title="Marquer prêt pour entraînement">
                    <CheckCircle2 size={13} color="hsl(140,65%,55%)" />
                  </button>
                  <button onClick={() => handleDelete(r.id)} className="vb-icon-btn" title="Supprimer cette ligne du Training Lab (n'affecte pas la soumission)" style={{ color: 'hsl(0,60%,60%)' }}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {editing && (
        <>
          <TrainingTakeoffEditor
            key={editing.id}
            takeoff={editing}
            onClose={() => setEditing(null)}
            onRecovered={async (patch) => updateRow(editing.id, patch)}
            onPatch={async (patch) => {
              await updateRow(editing.id, patch);
              setEditing((e) => (e ? ({ ...e, ...patch } as TrainingTakeoff) : e));
            }}
            onDelete={async () => {
              const id = editing.id;
              const { error } = await sb.from('training_roof_takeoffs').delete().eq('id', id);
              if (error) { toast.error(error.message); return; }
              setRows((rs) => rs.filter((r) => r.id !== id));
              setEditing(null);
            }}
            onSaved={async (patch) => {
              await updateRow(editing.id, patch);
              // keep current takeoff open; user navigates manually via ◀ ▶
              setEditing((e) => (e ? ({ ...e, ...patch } as TrainingTakeoff) : e));
              toast.success('Annotations enregistrées');
            }}
          />
          <div
            style={{
              position: 'fixed',
              ...(isMobile
                ? { bottom: 'calc(8px + env(safe-area-inset-bottom))', top: 'auto' }
                : { top: 12 }),
              left: '50%', transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'hsl(230,22%,10%)', border: '1px solid hsl(230,20%,22%)',
              borderRadius: 999, padding: isMobile ? '6px 8px' : '4px 6px', zIndex: 10000,
              boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
              maxWidth: 'calc(100vw - 16px)',
            }}
          >
            <button onClick={goPrev} className="vb-icon-btn" title="Précédent (←)"><ChevronLeft size={16} /></button>
            <span style={{ fontSize: 12, color: 'hsl(230,10%,70%)', minWidth: 80, textAlign: 'center', fontFamily: 'ui-monospace, monospace' }}>
              {editingIndex + 1} / {filtered.length}
            </span>
            <button onClick={goNext} className="vb-icon-btn" title="Suivant (→)"><ChevronRight size={16} /></button>
            <span style={{ fontSize: 11, color: 'hsl(230,10%,55%)', padding: '0 8px', maxWidth: isMobile ? 140 : 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {editing.reference || editing.id.slice(0, 6)} — {editing.address || '—'}
            </span>
          </div>
        </>
      )}

      {explorerOpen && (
        <TrainingLabExplorer
          onCancel={() => setExplorerOpen(false)}
          onDatasetCreated={async (row) => {
            // Le row vient d'être inséré + éventuellement IA prête. On l'ajoute
            // localement à la liste et on ouvre le tracer dessus immédiatement.
            setRows((rs) => [row, ...rs]);
            setExplorerOpen(false);
            openAnnotating(await ensureDebugOverlay(row));
          }}
        />
      )}

      {annotating && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 11000, background: '#060610',
          // Le studio est monté via Portal directement sur document.body pour
          // s'évader d'un éventuel transform/filter ancêtre qui briserait
          // position:fixed. paddingTop = safe-area + 44px pour passer SOUS
          // l'entête mobile d'AdminLayout (TOITURES VB) qui sinon crop nos
          // boutons 2D/3D du studio.
          paddingTop: 'calc(env(safe-area-inset-top) + 44px)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          <Suspense fallback={<div style={{ color: '#8a93a8', fontFamily: 'monospace', padding: 24 }}>Chargement du traceur…</div>}>
            <AdminRoofStudio
              key={annotating.id}
              mode="review"
              trainingLabMode
              {...studioPropsFor(annotating)}
              onValidate={onStudioValidate}
              onModelChange={onStudioDraftChange}
              onClose={handleStudioClose}
              onDisplaySettingsChange={onStudioDisplayChange}
              onOpenRecaler={() => { if (annotating) setEditing(annotating); }}
            />
          </Suspense>
        </div>,
        document.body
      )}

      {isMobile && selected.size > 0 && !editing && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
          background: 'hsl(230,22%,8%)', borderTop: '1px solid hsl(230,20%,18%)',
          padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
          display: 'flex', gap: 8,
        }}>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="vb-btn vb-btn-primary"
            style={{ flex: 1, justifyContent: 'center', padding: '12px' }}
          >
            <Download size={14} /> {exporting ? 'Génération…' : `Bundle (${selected.size})`}
          </button>
          <button
            onClick={handleDeleteSelected}
            className="vb-btn"
            style={{ padding: '12px 14px', borderColor: 'hsl(0,60%,40%)', color: 'hsl(0,70%,70%)' }}
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="vb-btn"
            style={{ padding: '12px 14px' }}
          >
            ×
          </button>
        </div>
      )}

      <style>{`
        .vb-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid hsl(230,20%,18%);background:hsl(230,22%,12%);color:#e5e7eb;font-size:12px;cursor:pointer;}
        .vb-btn:hover{background:hsl(230,22%,15%);}
        .vb-btn-primary{background:hsl(265,70%,55%);border-color:hsl(265,70%,55%);color:#fff;}
        .vb-btn-primary:hover{background:hsl(265,70%,60%);}
        .vb-btn-primary:disabled{opacity:0.5;cursor:not-allowed;}
        .vb-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;border:1px solid transparent;background:transparent;color:hsl(230,10%,70%);cursor:pointer;margin-left:2px;}
        .vb-icon-btn:hover{background:hsl(230,22%,14%);border-color:hsl(230,20%,18%);}
      `}</style>

      {solarResult && (
        <div onClick={() => setSolarResult(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)',
          zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 640, maxHeight: '85vh', overflow: 'auto',
            background: 'hsl(230,22%,11%)', border: '1px solid hsl(230,20%,18%)',
            borderRadius: 10, padding: 20, color: '#e5e7eb',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Sun size={20} color="hsl(38,90%,60%)" />
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>
                Google Solar API · {solarResult.reference}
              </h2>
              <button onClick={() => setSolarResult(null)} className="vb-btn" style={{ padding: '4px 10px' }}>
                Fermer
              </button>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10, marginBottom: 16, padding: 12,
              background: 'hsl(38,30%,12%)', border: '1px solid hsl(38,40%,22%)', borderRadius: 8,
            }}>
              <div>
                <div style={{ fontSize: 10, color: 'hsl(230,10%,55%)', textTransform: 'uppercase' }}>Segments</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'hsl(38,90%,70%)' }}>{solarResult.summary.n_segments}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'hsl(230,10%,55%)', textTransform: 'uppercase' }}>Surface totale</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{solarResult.summary.total_area_m2} m²</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'hsl(230,10%,55%)', textTransform: 'uppercase' }}>Qualité imagery</div>
                <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>{solarResult.summary.imagery_quality || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'hsl(230,10%,55%)', textTransform: 'uppercase' }}>Date imagery</div>
                <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>{solarResult.summary.imagery_date || '—'}</div>
              </div>
            </div>

            <div style={{
              padding: 12, marginBottom: 16,
              background: 'hsl(230,22%,9%)', border: '1px solid hsl(230,20%,18%)', borderRadius: 8,
            }}>
              <div style={{ fontSize: 11, color: 'hsl(230,10%,55%)', textTransform: 'uppercase', marginBottom: 6 }}>
                Comparaison vs ta truth
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                <div>
                  <strong style={{ color: 'hsl(38,90%,70%)' }}>{solarResult.summary.n_segments}</strong>{' '}
                  <span style={{ color: 'hsl(230,10%,60%)' }}>par Solar</span>
                </div>
                <div>
                  <strong style={{ color: 'hsl(140,65%,60%)' }}>{solarResult.n_sections_human}</strong>{' '}
                  <span style={{ color: 'hsl(230,10%,60%)' }}>humain (roof_model)</span>
                </div>
                <div>
                  <strong style={{ color: 'hsl(265,70%,75%)' }}>{solarResult.n_sections_v16}</strong>{' '}
                  <span style={{ color: 'hsl(230,10%,60%)' }}>algo v1.6</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: 'hsl(230,10%,55%)', textTransform: 'uppercase', marginBottom: 6 }}>
              Détails par segment
            </div>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid hsl(230,20%,18%)', borderRadius: 6 }}>
              <table style={{ width: '100%', fontSize: 11, fontFamily: 'monospace', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'hsl(230,22%,14%)', color: 'hsl(230,10%,60%)' }}>
                    <th style={{ padding: 6, textAlign: 'left' }}>#</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>pitch°</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>azimuth°</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>m²</th>
                  </tr>
                </thead>
                <tbody>
                  {solarResult.segments.map((s: any, i: number) => (
                    <tr key={i} style={{ borderTop: '1px solid hsl(230,20%,16%)' }}>
                      <td style={{ padding: 6 }}>{i + 1}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{s.pitch_deg?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{s.azimuth_deg?.toFixed(0) ?? '—'}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{s.area_m2?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}