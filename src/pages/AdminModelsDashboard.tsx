/**
 * AdminModelsDashboard.tsx — Page Model Progress (Phase 5 refonte)
 *
 * Route : /admin/training-lab/models
 *
 * Affiche l'historique des versions de modèles avec métriques,
 * comparaison avant/après, bouton "Set as active model".
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Brain, RefreshCw, CheckCircle2, Loader2, AlertCircle,
  Activity, ChevronRight,
} from 'lucide-react';
import {
  loadModelVersions,
  setActiveModelVersion,
  type ModelVersion,
  type ModelVersionStatus,
} from '@/lib/training-lab';

const STATUS_COLORS: Record<ModelVersionStatus, string> = {
  draft:     'hsl(230,10%,55%)',
  training:  'hsl(38,90%,55%)',
  trained:   'hsl(200,75%,55%)',
  deployed:  'hsl(140,65%,50%)',
  archived:  'hsl(230,10%,40%)',
};

const STATUS_LABELS: Record<ModelVersionStatus, string> = {
  draft:     'Brouillon',
  training:  'Entraînement en cours',
  trained:   'Entraîné',
  deployed:  'Déployé',
  archived:  'Archivé',
};

export default function AdminModelsDashboard() {
  const [models, setModels] = useState<ModelVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await loadModelVersions();
      setModels(rows);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSetActive = async (modelCode: string) => {
    if (!confirm(`Activer ${modelCode} ? Les anciens modèles seront désactivés.`)) return;
    setActivating(modelCode);
    try {
      await setActiveModelVersion(modelCode);
      toast.success(`${modelCode} est maintenant le modèle actif`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActivating(null);
    }
  };

  const active = models.find((m) => m.is_active);
  const hasMl = models.some((m) => m.model_code.startsWith('roof_obb'));

  return (
    <div style={{ padding: 20, color: '#e5e7eb' }}>
      <div style={headerStyle}>
        <Brain size={22} color="hsl(265,70%,65%)" />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Versions de modèles</h1>
        <span style={subtitleStyle}>
          Historique, métriques et bascule du modèle actif
        </span>
        <button onClick={load} className="vb-btn" style={{ marginLeft: 'auto' }}>
          <RefreshCw size={14} /> Actualiser
        </button>
      </div>

      {/* Modèle actif highlight */}
      {active && (
        <div style={{ ...activeCardStyle, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={20} color="hsl(140,65%,50%)" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'hsl(140,65%,60%)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                Modèle actif — pré-annotations
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                {active.name}
              </div>
              <div style={{ fontSize: 12, color: 'hsl(230,10%,60%)', fontFamily: 'monospace', marginTop: 2 }}>
                {active.model_code} · v{active.version}
              </div>
            </div>
          </div>
        </div>
      )}

      {!hasMl && (
        <div style={hintStyle}>
          <AlertCircle size={16} color="hsl(38,90%,55%)" style={{ flexShrink: 0 }} />
          <div>
            <strong>Encore aucun modèle ML entraîné.</strong> Le pipeline tourne sur l'algo classique (algo_v1_6).
            Pour entraîner le premier YOLOv8-OBB, va dans l'onglet <strong>Actions</strong> du repo GitHub
            et lance le workflow <strong>Train YOLOv8-OBB</strong> (cf. <code>huggingface-space/training/README.md</code>).
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : models.length === 0 ? (
        <div style={emptyStyle}>Aucune version de modèle encore.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {models.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              activating={activating === m.model_code}
              onSetActive={() => handleSetActive(m.model_code)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ModelCard
// ─────────────────────────────────────────────────────────────────────────────
const ModelCard: React.FC<{
  model: ModelVersion;
  activating: boolean;
  onSetActive: () => void;
}> = ({ model, activating, onSetActive }) => {
  const color = STATUS_COLORS[model.status] || 'hsl(230,10%,50%)';
  const label = STATUS_LABELS[model.status] || model.status;
  const metrics = model.metrics_json || {};
  // YOLO sauve les métriques au format YOLO standard :
  //   metrics/mAP50(B), metrics/precision(B), metrics/recall(B), etc.
  // On accepte plusieurs noms en fallback pour rester compatible avec d'autres
  // training stacks qui pourraient écrire la même métrique différemment.
  const m = (...keys: string[]): string => {
    for (const k of keys) {
      const v = metrics[k];
      if (typeof v === 'number') return v.toFixed(3);
      if (v != null && v !== '') return String(v);
    }
    return '—';
  };

  return (
    <div style={{ ...cardStyle, borderColor: model.is_active ? 'hsl(140,65%,30%)' : 'hsl(230,20%,18%)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'hsl(230,10%,60%)' }}>
              {model.model_code}
            </span>
            <span style={{ fontSize: 11, color: 'hsl(230,10%,55%)' }}>v{model.version}</span>
            <span style={{ ...statusBadgeStyle, color, borderColor: `${color}55`, background: `${color}15` }}>
              {label}
            </span>
            {model.is_active && (
              <span style={{
                ...statusBadgeStyle,
                color: 'hsl(140,65%,50%)',
                borderColor: 'hsl(140,65%,40%)',
                background: 'hsl(140,65%,15%)',
              }}>
                ACTIVE
              </span>
            )}
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{model.name}</h3>
          {model.notes && (
            <p style={{ fontSize: 12, color: 'hsl(230,10%,55%)', margin: '4px 0 0', maxWidth: 700 }}>
              {model.notes.slice(0, 300)}{model.notes.length > 300 ? '…' : ''}
            </p>
          )}
        </div>
        {!model.is_active && model.status !== 'archived' && (
          <button
            onClick={onSetActive}
            disabled={activating}
            className="vb-btn vb-btn-primary"
            style={{ padding: '6px 12px' }}
          >
            {activating ? (
              <><Loader2 size={14} className="animate-spin" /> Activation…</>
            ) : (
              <>Définir comme actif <ChevronRight size={14} /></>
            )}
          </button>
        )}
      </div>

      <div style={statsGridStyle}>
        <Stat label="Datasets training" value={String(model.dataset_count ?? '—')} />
        <Stat label="Train" value={String(model.train_count ?? '—')} />
        <Stat label="Val" value={String(model.val_count ?? '—')} />
        <Stat label="Test" value={String(model.test_count ?? '—')} />
        {/* Format YOLO standard d'abord (metrics/mAP50(B)), puis fallback */}
        <Stat label="mAP@0.5" value={m('metrics/mAP50(B)', 'mAP50', 'mAP@0.5')} />
        <Stat label="mAP@0.5-0.95" value={m('metrics/mAP50-95(B)', 'mAP50-95', 'mAP')} />
        <Stat label="Précision" value={m('metrics/precision(B)', 'precision')} />
        <Stat label="Recall" value={m('metrics/recall(B)', 'recall')} />
        <Stat label="Val box loss" value={m('val/box_loss')} />
        <Stat label="Val cls loss" value={m('val/cls_loss')} />
        <Stat label="Epoch atteint" value={m('epoch')} />
        <Stat label="Durée train (s)" value={m('time')} />
      </div>

      {model.trained_from_batch_ids && model.trained_from_batch_ids.length > 0 && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: '1px solid hsl(230,20%,16%)',
          fontSize: 11, color: 'hsl(230,10%,55%)',
        }}>
          Batches utilisés au training :{' '}
          <span style={{ fontFamily: 'monospace', color: 'hsl(230,10%,75%)' }}>
            {model.trained_from_batch_ids.length} batch(es)
          </span>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 10, color: 'hsl(230,10%,50%)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{value}</div>
  </div>
);

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap',
};
const subtitleStyle: React.CSSProperties = {
  color: 'hsl(230,10%,55%)', fontSize: 12,
};
const cardStyle: React.CSSProperties = {
  padding: 16, background: 'hsl(230,22%,11%)', border: '1px solid hsl(230,20%,18%)',
  borderRadius: 8,
};
const activeCardStyle: React.CSSProperties = {
  padding: 14, background: 'hsl(140,30%,10%)', border: '1px solid hsl(140,40%,25%)',
  borderRadius: 8,
};
const statusBadgeStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', fontSize: 10, fontWeight: 600,
  border: '1px solid', borderRadius: 4,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const statsGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: 12, marginTop: 10,
  paddingTop: 10, borderTop: '1px solid hsl(230,20%,16%)',
};
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: 'center', color: 'hsl(230,10%,50%)',
  background: 'hsl(230,22%,11%)', border: '1px dashed hsl(230,20%,20%)',
  borderRadius: 8,
};
const hintStyle: React.CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'flex-start',
  padding: 14, marginBottom: 20,
  background: 'hsl(38,30%,10%)', border: '1px solid hsl(38,50%,25%)',
  borderRadius: 8, fontSize: 13, lineHeight: 1.5,
};
