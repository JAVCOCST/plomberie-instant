/**
 * AdminBatchesDashboard.tsx — Page Batchs (Phase 5 refonte training-lab)
 *
 * Route : /admin/training-lab/batches
 *
 * Liste tous les batches avec stats agrégées + actions :
 *  - Ouvrir batch (= filtre AdminTrainingLab par batch_id)
 *  - Marquer training_ready
 *  - Comparer 2 batchs (graphes correction_weight / quality_score moyens)
 *  - Générer un nouveau batch (appelle l'edge function training-batch-generate)
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Layers, Plus, Play, BarChart3, RefreshCw,
  CheckCircle2, AlertCircle, Loader2, ChevronRight,
  Rocket, ExternalLink, Trash2,
} from 'lucide-react';
import {
  loadBatches,
  recomputeBatchStats,
  launchTrainingFromPortal,
  pollTrainingStatus,
  loadTrainingRuns,
  type TrainingBatch,
  type BatchStatus,
  type TrainingRun,
  type TrainingRunStatus,
} from '@/lib/training-lab';

const STATUS_COLORS: Record<BatchStatus, string> = {
  draft:             'hsl(230,10%,55%)',
  generating:        'hsl(38,90%,55%)',
  preannotating:     'hsl(265,70%,65%)',
  ready_for_review:  'hsl(200,75%,55%)',
  training_ready:    'hsl(140,65%,50%)',
  training:          'hsl(38,90%,55%)',
  trained:           'hsl(160,70%,48%)',
  archived:          'hsl(230,10%,40%)',
};

const STATUS_LABELS: Record<BatchStatus, string> = {
  draft:             'Brouillon',
  generating:        'Génération en cours',
  preannotating:     'Pré-annotation en cours',
  ready_for_review:  'À réviser',
  training_ready:    'Prêt pour entraînement',
  training:          'Entraînement en cours',
  trained:           'Entraîné',
  archived:          'Archivé',
};

export default function AdminBatchesDashboard() {
  const navigate = useNavigate();
  const [batches, setBatches] = useState<TrainingBatch[]>([]);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<TrainingRun | null>(null);
  const [livePollData, setLivePollData] = useState<{ status: TrainingRunStatus; duration_sec: number | null; github_run_url: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [batchRows, runRows] = await Promise.all([loadBatches(), loadTrainingRuns()]);
      setBatches(batchRows);
      setRuns(runRows);
      // Si un run est encore en cours, l'épingle pour le polling
      const live = runRows.find((r) =>
        ['dispatched', 'queued', 'in_progress'].includes(r.status),
      );
      setActiveRun(live ?? null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Polling auto toutes les 30s tant qu'un run est en cours
  useEffect(() => {
    if (!activeRun) return;
    let cancelled = false;
    const pollOnce = async () => {
      try {
        const status = await pollTrainingStatus(activeRun.id);
        if (cancelled) return;
        setLivePollData(status);
        if (['success', 'failure', 'cancelled'].includes(status.status)) {
          // Run terminé → reload tout (model_versions a peut-être changé)
          toast[status.status === 'success' ? 'success' : 'error'](
            status.status === 'success'
              ? `Entraînement terminé en ${formatDuration(status.duration_sec)}`
              : `Entraînement échoué (${status.conclusion || status.status})`,
          );
          await load();
        }
      } catch (e: any) {
        console.warn('poll failed:', e);
      }
    };
    pollOnce();
    const interval = setInterval(pollOnce, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeRun?.id, load]);

  const totalDatasets = useMemo(
    () => batches.reduce((sum, b) => sum + (b.dataset_count || 0), 0),
    [batches],
  );
  const totalValidated = useMemo(
    () => batches.reduce((sum, b) => sum + (b.validated_count || 0), 0),
    [batches],
  );

  const handleRefreshStats = async (batchId: string) => {
    setRefreshing(batchId);
    try {
      await recomputeBatchStats(batchId);
      await load();
      toast.success('Stats batch recalculées');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRefreshing(null);
    }
  };

  const handleDeleteBatch = async (batch: TrainingBatch) => {
    if (batch.batch_code === 'batch_000_initial') {
      toast.error('Batch 0 est ton baseline — protégé, jamais supprimable.');
      return;
    }
    const hasDatasets = batch.dataset_count > 0;
    const message = hasDatasets
      ? `Supprimer le batch "${batch.batch_code}" qui contient ${batch.dataset_count} dataset(s) ?\n\n` +
        `Les datasets ne seront PAS supprimés — ils deviendront orphelins (batch_id = NULL) mais resteront dans le Training Lab. ` +
        `Tu peux les re-rattacher à un autre batch ou les nettoyer manuellement après.`
      : `Supprimer le batch vide "${batch.batch_code}" ?`;
    if (!confirm(message)) return;
    try {
      const { error } = await (supabase as any).from('training_batches').delete().eq('id', batch.id);
      if (error) throw new Error(error.message);
      toast.success(`Batch ${batch.batch_code} supprimé`);
      await load();
    } catch (e: any) {
      toast.error(`Suppression échouée : ${e.message}`);
    }
  };

  const handleLaunchTraining = async (batchId?: string) => {
    if (activeRun) {
      toast.error("Un entraînement est déjà en cours. Attends qu'il finisse.");
      return;
    }
    if (!confirm("Lancer un nouvel entraînement YOLOv8-OBB ?\n\nÇa va tourner ~1h30-2h en background sur GitHub Actions. Tu peux suivre l'avancement ici.")) return;
    setLaunching(batchId || 'global');
    try {
      const result = await launchTrainingFromPortal({ batchId });
      toast.success(result.message || 'Entraînement lancé');
      await load();
    } catch (e: any) {
      toast.error(`Lancement échoué : ${e.message}`);
    } finally {
      setLaunching(null);
    }
  };

  return (
    <div style={{ padding: 20, color: '#e5e7eb' }}>
      <div style={headerStyle}>
        <Layers size={22} color="hsl(265,70%,65%)" />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Batchs d'entraînement</h1>
        <span style={subtitleStyle}>
          Lots de datasets organisés par source (initial · random · active learning)
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={load} className="vb-btn" title="Actualiser">
            <RefreshCw size={14} /> Actualiser
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="vb-btn vb-btn-primary"
            title="Générer un nouveau batch"
          >
            <Plus size={14} /> Nouveau batch
          </button>
        </div>
      </div>

      {/* KPI globaux */}
      <div style={kpisStyle}>
        <Kpi label="Batchs total" value={String(batches.length)} />
        <Kpi label="Datasets total" value={String(totalDatasets)} />
        <Kpi label="Validés" value={String(totalValidated)} />
        <Kpi
          label="Quality score moyen"
          value={
            batches.length
              ? (batches.reduce((s, b) => s + (Number(b.avg_quality_score) || 0), 0) / batches.length).toFixed(3)
              : '—'
          }
        />
      </div>

      {/* Bannière "training en cours" — visible tant qu'un run est actif */}
      {activeRun && (
        <div style={liveRunBannerStyle}>
          <Loader2 size={18} className="animate-spin" color="hsl(38,90%,55%)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'hsl(38,90%,70%)' }}>
              Entraînement YOLOv8-OBB en cours
            </div>
            <div style={{ fontSize: 11, color: 'hsl(230,10%,60%)', marginTop: 2 }}>
              Status : {livePollData?.status || activeRun.status}
              {livePollData?.duration_sec != null && ` · ${formatDuration(livePollData.duration_sec)} écoulé`}
              {livePollData?.status === 'in_progress' && ' · ~1h30-2h total attendu'}
            </div>
          </div>
          {(livePollData?.github_run_url || activeRun.github_run_url) && (
            <a
              href={livePollData?.github_run_url || activeRun.github_run_url || '#'}
              target="_blank"
              rel="noreferrer"
              className="vb-btn"
              style={{ padding: '6px 10px', textDecoration: 'none' }}
            >
              Voir logs GitHub <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'hsl(230,10%,50%)' }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : batches.length === 0 ? (
        <div style={emptyStyle}>
          Aucun batch encore. Crée le batch 1 pour commencer le cycle d'amélioration.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {batches.map((b) => (
            <BatchCard
              key={b.id}
              batch={b}
              refreshing={refreshing === b.id}
              launching={launching === b.id}
              canLaunch={!activeRun && b.status === 'training_ready'}
              isProtected={b.batch_code === 'batch_000_initial'}
              onOpen={() => navigate(`/admin/training-lab?batch_id=${b.id}`)}
              onRefresh={() => handleRefreshStats(b.id)}
              onLaunch={() => handleLaunchTraining(b.id)}
              onDelete={() => handleDeleteBatch(b)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <NewBatchModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
          isGenerating={generating}
          setGenerating={setGenerating}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BatchCard
// ─────────────────────────────────────────────────────────────────────────────
const BatchCard: React.FC<{
  batch: TrainingBatch;
  refreshing: boolean;
  launching: boolean;
  canLaunch: boolean;
  isProtected: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onLaunch: () => void;
  onDelete: () => void;
}> = ({ batch, refreshing, launching, canLaunch, isProtected, onOpen, onRefresh, onLaunch, onDelete }) => {
  const color = STATUS_COLORS[batch.status] || 'hsl(230,10%,50%)';
  const label = STATUS_LABELS[batch.status] || batch.status;
  const validatedPct = batch.dataset_count > 0
    ? Math.round((batch.validated_count / batch.dataset_count) * 100)
    : 0;
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'hsl(230,10%,60%)' }}>
              {batch.batch_code}
            </span>
            <span style={{ ...statusBadgeStyle, color, borderColor: `${color}55`, background: `${color}15` }}>
              {label}
            </span>
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{batch.name}</h3>
          {batch.description && (
            <p style={{ fontSize: 12, color: 'hsl(230,10%,55%)', margin: '4px 0 0 0', maxWidth: 600 }}>
              {batch.description.slice(0, 200)}{batch.description.length > 200 ? '…' : ''}
            </p>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="vb-btn"
          style={{ padding: '6px 10px' }}
          title="Recalculer les stats agrégées"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
        {canLaunch && (
          <button
            onClick={onLaunch}
            disabled={launching}
            className="vb-btn vb-btn-primary"
            style={{
              padding: '6px 12px',
              background: 'hsl(38,90%,50%)',
              borderColor: 'hsl(38,90%,40%)',
            }}
            title="Lancer un entraînement YOLOv8-OBB depuis ce batch (~1h30-2h)"
          >
            {launching ? (
              <><Loader2 size={14} className="animate-spin" /> Lancement…</>
            ) : (
              <><Rocket size={14} /> Lancer ML</>
            )}
          </button>
        )}
        <button onClick={onOpen} className="vb-btn vb-btn-primary" style={{ padding: '6px 12px' }}>
          Ouvrir <ChevronRight size={14} />
        </button>
        {!isProtected && (
          <button
            onClick={onDelete}
            className="vb-btn"
            style={{
              padding: '6px 10px',
              borderColor: 'hsl(0,60%,40%)',
              color: 'hsl(0,70%,70%)',
            }}
            title={
              batch.dataset_count > 0
                ? `Supprimer le batch (les ${batch.dataset_count} datasets resteront en orphelins)`
                : 'Supprimer ce batch vide'
            }
          >
            <Trash2 size={14} />
          </button>
        )}
        {isProtected && (
          <span
            style={{
              fontSize: 10,
              color: 'hsl(140,40%,55%)',
              padding: '0 6px',
              fontFamily: 'monospace',
            }}
            title="Le baseline est protégé contre la suppression"
          >
            🔒 baseline
          </span>
        )}
      </div>

      <div style={statsGridStyle}>
        <Stat label="Datasets" value={String(batch.dataset_count)} />
        <Stat label="Validés" value={`${batch.validated_count} (${validatedPct}%)`} />
        <Stat label="Auto-validés" value={String(batch.auto_validated_count)} />
        <Stat label="Rejetés" value={String(batch.rejected_count)} />
        <Stat
          label="Q-Score moy."
          value={batch.avg_quality_score != null ? Number(batch.avg_quality_score).toFixed(3) : '—'}
        />
        <Stat
          label="Correction moy."
          value={batch.avg_correction_weight != null ? Number(batch.avg_correction_weight).toFixed(3) : '—'}
        />
        <Stat label="Modèle utilisé" value={batch.model_version_used || '—'} mono />
        <Stat label="Source" value={batch.source_type} mono />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// NewBatchModal — appelle training-batch-generate
// ─────────────────────────────────────────────────────────────────────────────
const NewBatchModal: React.FC<{
  onClose: () => void;
  onCreated: () => Promise<void>;
  isGenerating: boolean;
  setGenerating: (b: boolean) => void;
}> = ({ onClose, onCreated, isGenerating, setGenerating }) => {
  const [batchCode, setBatchCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('Granby');
  const [limit, setLimit] = useState(30);
  const [sourceType, setSourceType] = useState('random');
  const [modelVersion, setModelVersion] = useState('algo_v1_6');

  // Auto-suggest batch_code suivant
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('training_batches')
        .select('batch_code')
        .order('created_at', { ascending: false })
        .limit(1);
      const last = data?.[0]?.batch_code as string | undefined;
      const m = last?.match(/^batch_(\d{3})/);
      const next = m ? parseInt(m[1], 10) + 1 : 1;
      const code = `batch_${String(next).padStart(3, '0')}_${sourceType}_${(city || 'all').toLowerCase()}`;
      setBatchCode(code);
      if (!name) setName(`${sourceType} ${city || 'Tous'} — ${limit} toits`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceType, city, limit]);

  const submit = async () => {
    if (!batchCode || !name || !modelVersion) {
      toast.error('batch_code, name, model_version requis');
      return;
    }
    setGenerating(true);
    const tId = toast.loading('Génération du batch en cours…');
    try {
      // On passe la Google Maps API key depuis le frontend (qui l'a déjà via
      // VITE_GOOGLE_MAPS_API_KEY) → évite à l'opérateur de la dupliquer dans
      // les secrets Supabase. C'est la même clé que celle déjà bundle dans
      // le JS public — pas d'aggravation du risque sécurité.
      const gmapsKey =
        (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
      const { data, error } = await (supabase as any).functions.invoke('training-batch-generate', {
        body: {
          batch_code: batchCode,
          name,
          description: description || null,
          source_type: sourceType,
          city: city || null,
          limit,
          model_version: modelVersion,
          exclude_existing: true,
          google_maps_api_key: gmapsKey,
        },
      });
      if (error) throw new Error(error.message);
      toast.success(
        `Batch ${data.batch_code} créé — ${data.dataset_count} datasets`,
        { id: tId },
      );
      await onCreated();
    } catch (e: any) {
      toast.error(`Erreur : ${e.message || e}`, { id: tId });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>Nouveau batch</h2>

        <Field label="Batch code (auto-suggéré)">
          <input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Nom">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Description (optionnel)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Ville">
            <input value={city} onChange={(e) => setCity(e.target.value)} style={inputStyle} placeholder="Granby" />
          </Field>
          <Field label="Quantité">
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value || '0', 10))}
              style={inputStyle}
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Source">
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} style={inputStyle}>
              <option value="random">random</option>
              <option value="active_learning">active_learning</option>
              <option value="curated">curated</option>
            </select>
          </Field>
          <Field label="Modèle utilisé pour pré-annotation">
            <input value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} style={inputStyle} />
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} className="vb-btn" disabled={isGenerating}>Annuler</button>
          <button onClick={submit} className="vb-btn vb-btn-primary" disabled={isGenerating}>
            {isGenerating ? (
              <><Loader2 size={14} className="animate-spin" /> Génération…</>
            ) : (
              <><Play size={14} /> Générer</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers UI
// ─────────────────────────────────────────────────────────────────────────────
const Kpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={kpiStyle}>
    <div style={{ fontSize: 11, color: 'hsl(230,10%,55%)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
  </div>
);

const Stat: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <div style={{ fontSize: 10, color: 'hsl(230,10%,50%)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit', marginTop: 2 }}>{value}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
    <span style={{ fontSize: 12, color: 'hsl(230,10%,60%)' }}>{label}</span>
    {children}
  </label>
);

function formatDuration(sec: number | null): string {
  if (sec == null || sec < 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}`;
  return `${s}s`;
}

const liveRunBannerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 16px', marginBottom: 16,
  background: 'hsl(38,30%,12%)', border: '1px solid hsl(38,60%,28%)',
  borderRadius: 8,
};

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap',
};
const subtitleStyle: React.CSSProperties = {
  color: 'hsl(230,10%,55%)', fontSize: 12,
};
const kpisStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10, marginBottom: 20,
};
const kpiStyle: React.CSSProperties = {
  padding: 14, background: 'hsl(230,22%,11%)', border: '1px solid hsl(230,20%,18%)',
  borderRadius: 8,
};
const cardStyle: React.CSSProperties = {
  padding: 16, background: 'hsl(230,22%,11%)', border: '1px solid hsl(230,20%,18%)',
  borderRadius: 8,
};
const statusBadgeStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', fontSize: 10, fontWeight: 600,
  border: '1px solid', borderRadius: 4,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const statsGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 12, marginTop: 10,
  paddingTop: 10, borderTop: '1px solid hsl(230,20%,16%)',
};
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: 'center', color: 'hsl(230,10%,50%)',
  background: 'hsl(230,22%,11%)', border: '1px dashed hsl(230,20%,20%)',
  borderRadius: 8,
};
const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
  display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200,
};
const modalCardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 540, padding: 20,
  background: 'hsl(230,22%,11%)', border: '1px solid hsl(230,20%,18%)',
  borderRadius: 10, color: '#e5e7eb',
};
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13,
  background: 'hsl(230,22%,9%)', color: '#e5e7eb',
  border: '1px solid hsl(230,20%,20%)', borderRadius: 6,
  outline: 'none', width: '100%', boxSizing: 'border-box',
};
