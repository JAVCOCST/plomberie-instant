import { supabase } from '@/integrations/supabase/client';
import { useRoofStore, type Layer, type PolygonShape } from './store';
import { maskToPolygon, simplifyPolygon } from './geometry';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function imageLayerToBase64(layer: Layer): Promise<string> {
  if (!layer.raster?.image) throw new Error('Layer has no raster');
  const img = layer.raster.image;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function runEnhance() {
  const s = useRoofStore.getState();
  s.setStep('enhance', { status: 'running' });
  try {
    const ortho = s.layers.find((l) => l.id === 'ortho');
    if (!ortho) throw new Error("Aucune orthophoto chargée");
    const image_b64 = await imageLayerToBase64(ortho);
    const { data, error } = await supabase.functions.invoke('roof-polygon-enhance', {
      body: { image_b64, model: 'real-esrgan-x4' },
    });
    if (error) throw new Error(error.message);
    if (!data?.upscaledUrl) throw new Error('Aucune image retournée');
    const scaleFactor: number = data.scaleFactor ?? 4;
    const hd = await loadImage(data.upscaledUrl);
    const newLayer: Layer = {
      id: 'ortho-hd',
      name: 'Orthophoto HD',
      type: 'raster',
      visible: true,
      opacity: 1,
      locked: false,
      generated: true,
      sourceStep: 'enhance',
      badge: '✨ HD',
      raster: {
        image: hd,
        url: data.upscaledUrl,
        naturalWidth: hd.naturalWidth,
        naturalHeight: hd.naturalHeight,
      },
      transform: {
        x: ortho.transform.x,
        y: ortho.transform.y,
        scaleX: 1 / scaleFactor,
        scaleY: 1 / scaleFactor,
      },
    };
    // insert just above ortho
    const layers = [...s.layers];
    const idx = layers.findIndex((l) => l.id === 'ortho');
    layers[idx] = { ...layers[idx], visible: false };
    layers.splice(idx + 1, 0, newLayer);
    s.setLayers(layers);
    if (s.calibration.done && s.calibration.appliedTo === 'ortho') {
      s.setCalibration({ pixelsPerMeter: (s.calibration.pixelsPerMeter || 0) * scaleFactor, appliedTo: 'ortho-hd' });
    }
    s.setStep('enhance', { status: 'done', outputLayerId: 'ortho-hd' });
  } catch (e: any) {
    s.setStep('enhance', { status: 'error', error: e.message });
    throw e;
  }
}

export async function runSegment() {
  const s = useRoofStore.getState();
  s.setStep('segment', { status: 'running' });
  try {
    const sourceLayer =
      s.layers.find((l) => l.id === 'ortho-hd' && l.visible) ||
      s.layers.find((l) => l.id === 'ortho');
    if (!sourceLayer) throw new Error('Aucune image source');
    const image_b64 = await imageLayerToBase64(sourceLayer);
    // Convert click points (world px in ortho space) into source-image px
    const sx = sourceLayer.transform.scaleX;
    const sy = sourceLayer.transform.scaleY;
    const toImagePx = (p: [number, number]): [number, number] => [
      Math.round((p[0] - sourceLayer.transform.x) / sx),
      Math.round((p[1] - sourceLayer.transform.y) / sy),
    ];
    const points = s.segmentClicks.map((c) => ({ point: toImagePx(c.point), positive: c.positive }));
    const box = s.segmentBox
      ? [...toImagePx([s.segmentBox[0], s.segmentBox[1]]), ...toImagePx([s.segmentBox[2], s.segmentBox[3]])]
      : null;

    const { data, error } = await supabase.functions.invoke('roof-polygon-segment', {
      body: {
        image_b64,
        mode: s.segmentMode,
        points,
        box,
        prompt: s.segmentText || undefined,
      },
    });
    if (error) throw new Error(error.message);

    let polygonPx: [number, number][] = data?.polygon || [];
    if ((!polygonPx || polygonPx.length < 3) && data?.maskBase64) {
      const img = await loadImage(data.maskBase64);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const im = ctx.getImageData(0, 0, c.width, c.height);
      const mask = new Uint8Array(c.width * c.height);
      for (let i = 0, j = 0; i < im.data.length; i += 4, j++) {
        mask[j] = im.data[i] > 128 ? 1 : 0;
      }
      polygonPx = maskToPolygon(mask, c.width, c.height, 1.5);
    }
    if (!polygonPx.length) throw new Error('Segmentation vide');

    // Convert back to world coords
    const worldVerts: [number, number][] = polygonPx.map(([x, y]) => [
      sourceLayer.transform.x + x * sx,
      sourceLayer.transform.y + y * sy,
    ]);
    const simplified = simplifyPolygon(worldVerts, Math.max(1.5 * sx, 0.5));

    const shapeId = `zone-${Date.now()}`;
    const newShape: PolygonShape = {
      id: shapeId,
      name: s.segmentText || `Zone ${(s.layers.find((l) => l.id === 'user-zones')?.vector?.shapes.length ?? 0) + 1}`,
      vertices: simplified,
      closed: true,
      color: '#a855f7',
    };
    s.addShape('user-zones', newShape);
    s.selectShape(shapeId);

    // Optionally insert mask raster
    if (data?.maskBase64) {
      const maskImg = await loadImage(data.maskBase64);
      const maskLayer: Layer = {
        id: 'sam-mask',
        name: 'Masque segmentation',
        type: 'raster',
        visible: true,
        opacity: 0.4,
        locked: false,
        generated: true,
        sourceStep: 'segment',
        badge: '🤖 IA',
        raster: { image: maskImg, naturalWidth: maskImg.naturalWidth, naturalHeight: maskImg.naturalHeight },
        transform: {
          x: sourceLayer.transform.x,
          y: sourceLayer.transform.y,
          scaleX: sx,
          scaleY: sy,
        },
      };
      s.upsertLayer(maskLayer);
    }

    s.setStep('segment', { status: 'done', outputLayerId: 'user-zones' });
    s.setStep('edit', { status: 'ready' });
    s.setStep('export', { status: 'ready' });
    s.resetSegmentInputs();
  } catch (e: any) {
    s.setStep('segment', { status: 'error', error: e.message });
    throw e;
  }
}

export function exportProjectJson() {
  const s = useRoofStore.getState();
  const ortho = s.layers.find((l) => l.id === 'ortho');
  const orthoHd = s.layers.find((l) => l.id === 'ortho-hd');
  const ppm = s.calibration.pixelsPerMeter || 0;
  const userZones = s.layers.find((l) => l.id === 'user-zones');
  const out = {
    metadata: {
      image: {
        original_width_px: ortho?.raster?.naturalWidth ?? 0,
        original_height_px: ortho?.raster?.naturalHeight ?? 0,
      },
      enhancement: {
        applied: !!orthoHd,
        model: orthoHd ? 'real-esrgan-x4' : null,
        scale_factor: orthoHd ? Math.round(1 / orthoHd.transform.scaleX) : 1,
      },
      calibration: {
        p1_px: s.calibration.p1,
        p2_px: s.calibration.p2,
        real_distance_m: s.calibration.realDistanceM,
        pixels_per_meter: ppm,
        applied_to: s.calibration.appliedTo,
      },
      segmentation_mode: s.segmentMode,
      timestamp: new Date().toISOString(),
    },
    layers: {
      'user-zones': (userZones?.vector?.shapes || []).map((sh) => ({
        id: sh.id,
        name: sh.name,
        vertices_px: sh.vertices,
        vertices_m: ppm > 0 ? sh.vertices.map(([x, y]) => [x / ppm, y / ppm]) : [],
      })),
    },
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `roof-polygon-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}