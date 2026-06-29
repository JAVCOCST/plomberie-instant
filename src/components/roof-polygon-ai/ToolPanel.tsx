import { useState } from 'react';
import { Rnd } from 'react-rnd';
import { ChevronDown, ChevronRight, Play, Square, RotateCw, GripVertical, Minus, X, Sparkles, Ruler, Target, Edit3, Download, MousePointer, Hand, ZoomIn, Trash2 } from 'lucide-react';
import { useRoofStore, type StepId, type StepStatus } from './store';
import { runEnhance, runSegment, exportProjectJson } from './pipeline';
import { perimeter, pxArea2ToM2, shoelaceArea, pixelsToMeters } from './geometry';
import { toast } from 'sonner';

const PANEL_KEY = 'roofpoly_panel_pos';

const STATUS_COLORS: Record<StepStatus, string> = {
  ready: 'bg-blue-500',
  running: 'bg-amber-400 animate-pulse',
  done: 'bg-emerald-500',
  error: 'bg-red-500',
  blocked: 'bg-zinc-500',
};

export default function ToolPanel({ onClose }: { onClose: () => void }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(PANEL_KEY) || ''); } catch { return null; } })();
  const [pos, setPos] = useState(saved || { x: 16, y: 16, width: 320, height: 'auto' });
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState({ pipeline: true, tools: false, measures: true });

  const steps = useRoofStore((s) => s.steps);
  const segmentMode = useRoofStore((s) => s.segmentMode);
  const setSegmentMode = useRoofStore((s) => s.setSegmentMode);
  const segmentText = useRoofStore((s) => s.segmentText);
  const setSegmentText = useRoofStore((s) => s.setSegmentText);
  const activeTool = useRoofStore((s) => s.activeTool);
  const setActiveTool = useRoofStore((s) => s.setActiveTool);
  const layers = useRoofStore((s) => s.layers);
  const calibration = useRoofStore((s) => s.calibration);
  const selectedShapeId = useRoofStore((s) => s.selectedShapeId);

  const userZones = layers.find((l) => l.id === 'user-zones');
  const selectedShape = userZones?.vector?.shapes.find((sh) => sh.id === selectedShapeId);

  const ppm = calibration.pixelsPerMeter || 0;
  const areaPx = selectedShape ? shoelaceArea(selectedShape.vertices) : 0;
  const periPx = selectedShape ? perimeter(selectedShape.vertices, true) : 0;

  const handleRun = async (id: StepId) => {
    try {
      if (id === 'enhance') await runEnhance();
      else if (id === 'calibrate') {
        setActiveTool('calibrate');
        toast.info('Cliquez 2 points dont vous connaissez la distance.');
      } else if (id === 'segment') {
        if (!calibration.done) { toast.error('Calibrez d\'abord.'); return; }
        if (segmentMode === 'click') setActiveTool('segment-click');
        else if (segmentMode === 'box') setActiveTool('segment-box');
        if (segmentMode === 'text' || segmentMode === 'box') {
          // user can press "Lancer" button; for click we wait for inputs
        }
        await runSegment();
        setActiveTool('select');
      } else if (id === 'edit') {
        setActiveTool('select');
        toast.info('Sélectionnez une zone et glissez ses sommets.');
      } else if (id === 'export') {
        exportProjectJson();
        toast.success('Export téléchargé');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erreur');
    }
  };

  return (
    <Rnd
      bounds="window"
      size={{ width: pos.width, height: pos.height }}
      position={{ x: pos.x, y: pos.y }}
      onDragStop={(_, d) => { const np = { ...pos, x: d.x, y: d.y }; setPos(np); localStorage.setItem(PANEL_KEY, JSON.stringify(np)); }}
      enableResizing={false}
      dragHandleClassName="rp-drag-handle"
      style={{ zIndex: 50 }}
    >
      <div className="rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-md text-white shadow-2xl overflow-hidden" style={{ width: 320 }}>
        <div className="rp-drag-handle flex items-center justify-between px-3 py-2 bg-zinc-800/80 border-b border-white/5 cursor-move select-none">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GripVertical size={14} className="opacity-50" />
            Outils RoofPolygon AI
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setCollapsed((c) => !c)} className="p-1 hover:bg-white/10 rounded"><Minus size={14} /></button>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded"><X size={14} /></button>
          </div>
        </div>

        {!collapsed && (
          <div className="max-h-[80vh] overflow-y-auto">
            <Section title="Pipeline" open={open.pipeline} onToggle={() => setOpen((o) => ({ ...o, pipeline: !o.pipeline }))}>
              <StepCard id="enhance" icon={<Sparkles size={14} />} label="Real-ESRGAN — Améliorer l'image" step={steps.enhance} onAction={() => handleRun('enhance')} />
              {steps.enhance.status === 'ready' && (
                <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2 my-1">
                  💡 Astuce : améliorer l'image augmente la précision du polygone final.
                </div>
              )}
              <StepCard id="calibrate" icon={<Ruler size={14} />} label="Calibrer l'échelle" step={steps.calibrate} onAction={() => handleRun('calibrate')} />
              <StepCard id="segment" icon={<Target size={14} />} label="Segmenter zone" step={steps.segment} onAction={() => handleRun('segment')}>
                <div className="flex gap-3 text-[11px] mt-1">
                  {(['click', 'box', 'text'] as const).map((m) => (
                    <label key={m} className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" checked={segmentMode === m} onChange={() => setSegmentMode(m)} />
                      {m === 'click' ? 'Clic' : m === 'box' ? 'Boîte' : 'Texte'}
                    </label>
                  ))}
                </div>
                {segmentMode === 'text' && (
                  <input
                    value={segmentText}
                    onChange={(e) => setSegmentText(e.target.value)}
                    placeholder="ex: terrasse arrière"
                    className="w-full mt-2 px-2 py-1 text-xs rounded bg-zinc-800 border border-white/10"
                  />
                )}
                {segmentMode === 'click' && activeTool === 'segment-click' && (
                  <div className="text-[11px] text-zinc-400 mt-1">Clic gauche = inclure, Maj+clic = exclure. Puis « Lancer ».</div>
                )}
              </StepCard>
              <StepCard id="edit" icon={<Edit3 size={14} />} label="Éditer polygone" step={steps.edit} onAction={() => handleRun('edit')} />
              <StepCard id="export" icon={<Download size={14} />} label="Exporter" step={steps.export} onAction={() => handleRun('export')} />
            </Section>

            <Section title="Outils" open={open.tools} onToggle={() => setOpen((o) => ({ ...o, tools: !o.tools }))}>
              <div className="grid grid-cols-4 gap-1">
                <ToolBtn active={activeTool === 'select'} onClick={() => setActiveTool('select')} icon={<MousePointer size={14} />} label="Sélection" />
                <ToolBtn active={activeTool === 'pan'} onClick={() => setActiveTool('pan')} icon={<Hand size={14} />} label="Pan" />
                <ToolBtn active={activeTool === 'zoom'} onClick={() => setActiveTool('zoom')} icon={<ZoomIn size={14} />} label="Zoom" />
                <ToolBtn active={activeTool === 'delete-vertex'} onClick={() => setActiveTool('delete-vertex')} icon={<Trash2 size={14} />} label="Suppr." />
              </div>
            </Section>

            <Section title="Mesures (en direct)" open={open.measures} onToggle={() => setOpen((o) => ({ ...o, measures: !o.measures }))}>
              {selectedShape ? (
                <div className="text-xs space-y-1 font-mono">
                  <div>Aire&nbsp;&nbsp;&nbsp; : <span className="text-emerald-400 font-semibold">{ppm > 0 ? pxArea2ToM2(areaPx, ppm).toFixed(2) : '—'} m²</span></div>
                  <div>Périmètre : <span className="text-emerald-400 font-semibold">{ppm > 0 ? pixelsToMeters(periPx, ppm).toFixed(2) : '—'} m</span></div>
                  <div>Sommets&nbsp; : <span className="text-emerald-400 font-semibold">{selectedShape.vertices.length}</span></div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500">Aucune zone sélectionnée</div>
              )}
            </Section>
          </div>
        )}
      </div>
    </Rnd>
  );
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/5">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:bg-white/5">
        <span>{title}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

function StepCard({ icon, label, step, onAction, children }: { id: StepId; icon: React.ReactNode; label: string; step: { status: StepStatus; error?: string }; onAction: () => void; children?: React.ReactNode }) {
  const disabled = step.status === 'blocked' || step.status === 'running';
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-2">
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[step.status]}`} />
        <span className="opacity-80">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
      </div>
      {children}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onAction}
          disabled={disabled}
          className="px-2 py-1 text-[11px] rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {step.status === 'running' ? <><Square size={10} /> Annuler</> : step.status === 'done' ? <><RotateCw size={10} /> Refaire</> : <><Play size={10} /> Lancer</>}
        </button>
        {step.status === 'error' && <span className="text-[10px] text-red-400 truncate">{step.error}</span>}
      </div>
    </div>
  );
}

function ToolBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex flex-col items-center gap-1 p-2 rounded text-[10px] ${active ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10 text-zinc-300'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}