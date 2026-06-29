import { useState } from 'react';
import { Rnd } from 'react-rnd';
import { Eye, EyeOff, Edit2, GripVertical, X } from 'lucide-react';
import { useRoofStore } from './store';
import { toast } from 'sonner';

const KEY = 'roofpoly_layers_pos';

export default function LayersPanel({ onClose }: { onClose: () => void }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || ''); } catch { return null; } })();
  const [pos, setPos] = useState(saved || { x: window.innerWidth - 296, y: 16 });
  const layers = useRoofStore((s) => s.layers);
  const toggleLayerVisible = useRoofStore((s) => s.toggleLayerVisible);
  const setLayerOpacity = useRoofStore((s) => s.setLayerOpacity);
  const reorderLayers = useRoofStore((s) => s.reorderLayers);
  const removeLayer = useRoofStore((s) => s.removeLayer);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Display top-of-stack first (reverse array)
  const display = [...layers].reverse();

  const onDrop = (toDisplayIdx: number) => {
    if (dragIdx === null) return;
    const fromArrayIdx = layers.length - 1 - dragIdx;
    const toArrayIdx = layers.length - 1 - toDisplayIdx;
    const movingLayer = layers[fromArrayIdx];
    const targetLayer = layers[toArrayIdx];
    if (movingLayer.type === 'raster' && targetLayer.type === 'vector') {
      toast.error("Les rasters ne peuvent pas passer au-dessus des vecteurs.");
      setDragIdx(null);
      return;
    }
    reorderLayers(fromArrayIdx, toArrayIdx);
    setDragIdx(null);
  };

  return (
    <Rnd
      bounds="window"
      size={{ width: 280, height: 'auto' as any }}
      position={{ x: pos.x, y: pos.y }}
      onDragStop={(_, d) => { const np = { x: d.x, y: d.y }; setPos(np); localStorage.setItem(KEY, JSON.stringify(np)); }}
      enableResizing={false}
      dragHandleClassName="rp-layers-handle"
      style={{ zIndex: 50 }}
    >
      <div className="rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-md text-white shadow-2xl overflow-hidden">
        <div className="rp-layers-handle flex items-center justify-between px-3 py-2 bg-zinc-800/80 border-b border-white/5 cursor-move">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GripVertical size={14} className="opacity-50" />
            Couches
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded"><X size={14} /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {display.length === 0 && <div className="p-3 text-xs text-zinc-500">Aucun calque</div>}
          {display.map((layer, i) => (
            <div
              key={layer.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              className="group flex items-center gap-2 px-3 py-2 border-b border-white/5 hover:bg-white/5"
            >
              <button onClick={() => toggleLayerVisible(layer.id)} title="Visibilité">
                {layer.visible ? <Eye size={14} className="text-emerald-400" /> : <EyeOff size={14} className="text-zinc-500" />}
              </button>
              <button onClick={() => setEditing(editing === layer.id ? null : layer.id)} title="Propriétés">
                <Edit2 size={12} className="text-zinc-400" />
              </button>
              <span className="flex-1 text-xs truncate">{layer.name}</span>
              {layer.badge && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  layer.id === 'ortho-hd' ? 'bg-emerald-500/20 text-emerald-300'
                    : layer.id === 'sam-mask' ? 'bg-blue-500/20 text-blue-300'
                      : 'bg-purple-500/20 text-purple-300'
                }`}>{layer.badge}</span>
              )}
              {editing === layer.id && (
                <div className="absolute right-2 mt-16 z-10 bg-zinc-800 border border-white/10 rounded p-2 w-48 shadow-xl">
                  <div className="text-[10px] text-zinc-400 mb-1">Opacité {Math.round(layer.opacity * 100)}%</div>
                  <input
                    type="range" min={0} max={100} value={Math.round(layer.opacity * 100)}
                    onChange={(e) => setLayerOpacity(layer.id, Number(e.target.value) / 100)}
                    className="w-full"
                  />
                  {layer.generated && (
                    <button
                      onClick={() => { removeLayer(layer.id); setEditing(null); }}
                      className="mt-2 w-full text-[11px] py-1 rounded bg-red-600/80 hover:bg-red-500"
                    >Supprimer</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Rnd>
  );
}