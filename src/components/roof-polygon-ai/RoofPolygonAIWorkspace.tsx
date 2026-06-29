import { useEffect, useRef, useState } from 'react';
import { useRoofStore, type Layer } from './store';
import RoofCanvas from './Canvas';
import ToolPanel from './ToolPanel';
import LayersPanel from './LayersPanel';
import { Upload, ArrowLeft } from 'lucide-react';

interface Props {
  onClose?: () => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export default function RoofPolygonAIWorkspace({ onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [showTool, setShowTool] = useState(true);
  const [showLayers, setShowLayers] = useState(true);
  const setLayers = useRoofStore((s) => s.setLayers);
  const layers = useRoofStore((s) => s.layers);
  const reset = useRoofStore((s) => s.reset);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const handleUpload = async (file: File) => {
    reset();
    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    const ortho: Layer = {
      id: 'ortho',
      name: 'Orthophoto',
      type: 'raster',
      visible: true,
      opacity: 1,
      locked: false,
      generated: false,
      raster: { image: img, url, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    };
    const userZones: Layer = {
      id: 'user-zones',
      name: 'Zones utilisateur',
      type: 'vector',
      visible: true,
      opacity: 1,
      locked: false,
      generated: false,
      vector: { shapes: [] },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    };
    setLayers([ortho, userZones]);
  };

  const hasOrtho = layers.some((l) => l.id === 'ortho');

  return (
    <div className="fixed inset-0 bg-black z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-950 border-b border-white/10 text-white">
        <div className="flex items-center gap-3">
          {onClose && (
            <button onClick={onClose} className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-white/10">
              <ArrowLeft size={14} /> Retour
            </button>
          )}
          <span className="text-sm font-semibold">RoofPolygon AI</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 cursor-pointer">
            <Upload size={14} /> {hasOrtho ? 'Remplacer image' : 'Charger orthophoto'}
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
          </label>
          <button onClick={() => setShowTool((v) => !v)} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20">Outils</button>
          <button onClick={() => setShowLayers((v) => !v)} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20">Couches</button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {hasOrtho ? (
          <RoofCanvas width={size.w} height={size.h} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
            Chargez une orthophoto pour commencer.
          </div>
        )}
        {showTool && <ToolPanel onClose={() => setShowTool(false)} />}
        {showLayers && <LayersPanel onClose={() => setShowLayers(false)} />}
      </div>
    </div>
  );
}