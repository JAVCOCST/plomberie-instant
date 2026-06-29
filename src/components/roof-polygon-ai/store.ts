import { create } from 'zustand';

export type LayerId =
  | 'ortho'
  | 'ortho-hd'
  | 'sam-mask'
  | 'lot-perimeter'
  | 'building-polygon'
  | 'user-zones'
  | 'calibration';

export type LayerType = 'raster' | 'vector';

export interface RasterData {
  image: HTMLImageElement | null;
  url?: string;
  naturalWidth: number;
  naturalHeight: number;
}

export interface PolygonShape {
  id: string;
  name: string;
  vertices: [number, number][]; // pixel space (original ortho)
  closed: boolean;
  color?: string;
}

export interface VectorData {
  shapes: PolygonShape[];
}

export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

export interface Layer {
  id: LayerId | string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number;
  locked: boolean;
  generated: boolean;
  sourceStep?: string;
  badge?: string;
  raster?: RasterData;
  vector?: VectorData;
  transform: LayerTransform;
}

export type StepId = 'enhance' | 'calibrate' | 'segment' | 'edit' | 'export';
export type StepStatus = 'ready' | 'running' | 'done' | 'error' | 'blocked';

export interface PipelineStep {
  id: StepId;
  status: StepStatus;
  error?: string;
  outputLayerId?: string;
}

export interface Calibration {
  done: boolean;
  p1?: [number, number];
  p2?: [number, number];
  realDistanceM?: number;
  pixelsPerMeter?: number;
  appliedTo?: 'ortho' | 'ortho-hd';
}

export type SegmentMode = 'click' | 'box' | 'text';
export type Tool = 'select' | 'pan' | 'zoom' | 'delete-vertex' | 'calibrate' | 'segment-click' | 'segment-box';

interface State {
  layers: Layer[];
  steps: Record<StepId, PipelineStep>;
  calibration: Calibration;
  segmentMode: SegmentMode;
  segmentClicks: { point: [number, number]; positive: boolean }[];
  segmentBox: [number, number, number, number] | null;
  segmentText: string;
  activeTool: Tool;
  selectedShapeId: string | null;
  selectedVertex: number | null;
  stagePosition: { x: number; y: number; scale: number };

  setLayers: (l: Layer[]) => void;
  upsertLayer: (l: Layer) => void;
  removeLayer: (id: string) => void;
  toggleLayerVisible: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  reorderLayers: (from: number, to: number) => void;

  setStep: (id: StepId, patch: Partial<PipelineStep>) => void;
  setCalibration: (c: Partial<Calibration>) => void;
  setSegmentMode: (m: SegmentMode) => void;
  addSegmentClick: (point: [number, number], positive: boolean) => void;
  resetSegmentInputs: () => void;
  setSegmentBox: (b: [number, number, number, number] | null) => void;
  setSegmentText: (t: string) => void;
  setActiveTool: (t: Tool) => void;
  selectShape: (id: string | null) => void;
  selectVertex: (i: number | null) => void;
  setStagePosition: (p: { x: number; y: number; scale: number }) => void;

  updateShape: (layerId: string, shapeId: string, patch: Partial<PolygonShape>) => void;
  addShape: (layerId: string, shape: PolygonShape) => void;
  reset: () => void;
}

const defaultSteps: Record<StepId, PipelineStep> = {
  enhance: { id: 'enhance', status: 'ready' },
  calibrate: { id: 'calibrate', status: 'ready' },
  segment: { id: 'segment', status: 'blocked' },
  edit: { id: 'edit', status: 'blocked' },
  export: { id: 'export', status: 'blocked' },
};

export const useRoofStore = create<State>((set) => ({
  layers: [],
  steps: defaultSteps,
  calibration: { done: false },
  segmentMode: 'click',
  segmentClicks: [],
  segmentBox: null,
  segmentText: '',
  activeTool: 'select',
  selectedShapeId: null,
  selectedVertex: null,
  stagePosition: { x: 0, y: 0, scale: 1 },

  setLayers: (layers) => set({ layers }),
  upsertLayer: (layer) => set((s) => {
    const idx = s.layers.findIndex((l) => l.id === layer.id);
    if (idx === -1) return { layers: [...s.layers, layer] };
    const next = [...s.layers];
    next[idx] = { ...next[idx], ...layer };
    return { layers: next };
  }),
  removeLayer: (id) => set((s) => ({ layers: s.layers.filter((l) => l.id !== id) })),
  toggleLayerVisible: (id) => set((s) => ({
    layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
  })),
  setLayerOpacity: (id, opacity) => set((s) => ({
    layers: s.layers.map((l) => (l.id === id ? { ...l, opacity } : l)),
  })),
  reorderLayers: (from, to) => set((s) => {
    const next = [...s.layers];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    return { layers: next };
  }),

  setStep: (id, patch) => set((s) => ({ steps: { ...s.steps, [id]: { ...s.steps[id], ...patch } } })),
  setCalibration: (c) => set((s) => ({ calibration: { ...s.calibration, ...c } })),
  setSegmentMode: (segmentMode) => set({ segmentMode }),
  addSegmentClick: (point, positive) => set((s) => ({ segmentClicks: [...s.segmentClicks, { point, positive }] })),
  resetSegmentInputs: () => set({ segmentClicks: [], segmentBox: null, segmentText: '' }),
  setSegmentBox: (segmentBox) => set({ segmentBox }),
  setSegmentText: (segmentText) => set({ segmentText }),
  setActiveTool: (activeTool) => set({ activeTool }),
  selectShape: (selectedShapeId) => set({ selectedShapeId, selectedVertex: null }),
  selectVertex: (selectedVertex) => set({ selectedVertex }),
  setStagePosition: (stagePosition) => set({ stagePosition }),

  updateShape: (layerId, shapeId, patch) => set((s) => ({
    layers: s.layers.map((l) => {
      if (l.id !== layerId || !l.vector) return l;
      return {
        ...l,
        vector: {
          shapes: l.vector.shapes.map((sh) => (sh.id === shapeId ? { ...sh, ...patch } : sh)),
        },
      };
    }),
  })),
  addShape: (layerId, shape) => set((s) => ({
    layers: s.layers.map((l) => {
      if (l.id !== layerId || !l.vector) return l;
      return { ...l, vector: { shapes: [...l.vector.shapes, shape] } };
    }),
  })),

  reset: () => set({
    layers: [],
    steps: defaultSteps,
    calibration: { done: false },
    segmentClicks: [],
    segmentBox: null,
    segmentText: '',
    activeTool: 'select',
    selectedShapeId: null,
    selectedVertex: null,
    stagePosition: { x: 0, y: 0, scale: 1 },
  }),
}));