import { useEffect, useRef, useState } from 'react';
import { Stage, Layer as KLayer, Image as KImage, Line, Circle, Rect, Group, Text } from 'react-konva';
import Konva from 'konva';
import { useRoofStore, type Layer, type PolygonShape } from './store';
import { distance, perimeter, shoelaceArea } from './geometry';

interface Props {
  width: number;
  height: number;
}

export default function RoofCanvas({ width, height }: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0, scale: 1 });
  const layers = useRoofStore((s) => s.layers);
  const activeTool = useRoofStore((s) => s.activeTool);
  const setActiveTool = useRoofStore((s) => s.setActiveTool);
  const calibration = useRoofStore((s) => s.calibration);
  const setCalibration = useRoofStore((s) => s.setCalibration);
  const setStep = useRoofStore((s) => s.setStep);
  const segmentMode = useRoofStore((s) => s.segmentMode);
  const segmentClicks = useRoofStore((s) => s.segmentClicks);
  const segmentBox = useRoofStore((s) => s.segmentBox);
  const addSegmentClick = useRoofStore((s) => s.addSegmentClick);
  const setSegmentBox = useRoofStore((s) => s.setSegmentBox);
  const selectedShapeId = useRoofStore((s) => s.selectedShapeId);
  const selectShape = useRoofStore((s) => s.selectShape);
  const updateShape = useRoofStore((s) => s.updateShape);

  const [calibPoints, setCalibPoints] = useState<[number, number][]>([]);
  const [boxStart, setBoxStart] = useState<[number, number] | null>(null);

  // Fit base ortho on load
  useEffect(() => {
    const ortho = layers.find((l) => l.id === 'ortho');
    if (!ortho?.raster?.image) return;
    const w = ortho.raster.naturalWidth;
    const h = ortho.raster.naturalHeight;
    const scale = Math.min(width / w, height / h) * 0.95;
    setStagePos({ x: (width - w * scale) / 2, y: (height - h * scale) / 2, scale });
  }, [layers.find((l) => l.id === 'ortho')?.raster?.image]);

  const stageToWorld = (sx: number, sy: number): [number, number] => {
    return [(sx - stagePos.x) / stagePos.scale, (sy - stagePos.y) / stagePos.scale];
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stagePos.scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.15;
    const newScale = Math.max(0.05, Math.min(40, direction > 0 ? oldScale * factor : oldScale / factor));
    setStagePos({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const world = stageToWorld(pointer.x, pointer.y);

    if (activeTool === 'calibrate') {
      const next = [...calibPoints, world] as [number, number][];
      setCalibPoints(next);
      if (next.length === 2) {
        const dPx = distance(next[0], next[1]);
        const real = window.prompt('Distance réelle entre ces 2 points (en mètres) ?', '10');
        const meters = real ? parseFloat(real.replace(',', '.')) : NaN;
        if (meters && meters > 0) {
          const orthoHd = layers.find((l) => l.id === 'ortho-hd' && l.visible);
          setCalibration({
            done: true,
            p1: next[0],
            p2: next[1],
            realDistanceM: meters,
            pixelsPerMeter: dPx / meters,
            appliedTo: orthoHd ? 'ortho-hd' : 'ortho',
          });
          setStep('calibrate', { status: 'done' });
          setStep('segment', { status: 'ready' });
        }
        setCalibPoints([]);
        setActiveTool('select');
      }
      return;
    }

    if (activeTool === 'segment-click') {
      const positive = !(e.evt.button === 2 || e.evt.shiftKey);
      addSegmentClick(world, positive);
      return;
    }

    if (activeTool === 'segment-box') {
      setBoxStart(world);
      setSegmentBox([world[0], world[1], world[0], world[1]]);
      return;
    }

    // click on empty -> deselect
    if (e.target === stage) selectShape(null);
  };

  const handleStageMouseMove = () => {
    if (activeTool !== 'segment-box' || !boxStart) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const world = stageToWorld(pointer.x, pointer.y);
    setSegmentBox([
      Math.min(boxStart[0], world[0]),
      Math.min(boxStart[1], world[1]),
      Math.max(boxStart[0], world[0]),
      Math.max(boxStart[1], world[1]),
    ]);
  };

  const handleStageMouseUp = () => {
    if (activeTool === 'segment-box' && boxStart) {
      setBoxStart(null);
    }
  };

  // Sort layers: render in array order (first = bottom)
  const sortedLayers = layers;

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      onWheel={handleWheel}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
      onContextMenu={(e) => e.evt.preventDefault()}
      draggable={activeTool === 'pan'}
      x={stagePos.x}
      y={stagePos.y}
      scaleX={stagePos.scale}
      scaleY={stagePos.scale}
      onDragEnd={(e) => {
        if (activeTool !== 'pan') return;
        setStagePos({ ...stagePos, x: e.target.x(), y: e.target.y() });
      }}
      style={{ background: '#0a0a14', cursor: activeTool === 'pan' ? 'grab' : activeTool === 'calibrate' ? 'crosshair' : 'default' }}
    >
      {sortedLayers.map((layer) => (
        <KLayer key={layer.id} visible={layer.visible} opacity={layer.opacity} listening={!layer.locked}>
          {layer.type === 'raster' && layer.raster?.image && (
            <KImage
              image={layer.raster.image}
              x={layer.transform.x}
              y={layer.transform.y}
              scaleX={layer.transform.scaleX}
              scaleY={layer.transform.scaleY}
            />
          )}
          {layer.type === 'vector' && layer.vector?.shapes.map((shape) => (
            <ShapeRenderer
              key={shape.id}
              shape={shape}
              layer={layer}
              isSelected={selectedShapeId === shape.id}
              onSelect={() => selectShape(shape.id)}
              onUpdate={(patch) => updateShape(layer.id, shape.id, patch)}
              editable={layer.id === 'user-zones'}
            />
          ))}
        </KLayer>
      ))}

      {/* Calibration in-progress overlay */}
      <KLayer listening={false}>
        {calibPoints.map((p, i) => (
          <Circle key={i} x={p[0]} y={p[1]} radius={6 / stagePos.scale} fill="#22c55e" stroke="#fff" strokeWidth={1.5 / stagePos.scale} />
        ))}
        {calibration.done && calibration.p1 && calibration.p2 && (
          <>
            <Line
              points={[calibration.p1[0], calibration.p1[1], calibration.p2[0], calibration.p2[1]]}
              stroke="#22c55e"
              strokeWidth={2 / stagePos.scale}
              dash={[8 / stagePos.scale, 6 / stagePos.scale]}
            />
            <Circle x={calibration.p1[0]} y={calibration.p1[1]} radius={5 / stagePos.scale} fill="#22c55e" />
            <Circle x={calibration.p2[0]} y={calibration.p2[1]} radius={5 / stagePos.scale} fill="#22c55e" />
          </>
        )}
        {/* Segment click points */}
        {segmentClicks.map((c, i) => (
          <Circle
            key={i}
            x={c.point[0]}
            y={c.point[1]}
            radius={6 / stagePos.scale}
            fill={c.positive ? '#3b82f6' : '#ef4444'}
            stroke="#fff"
            strokeWidth={1.5 / stagePos.scale}
          />
        ))}
        {/* Segment box */}
        {segmentBox && (
          <Rect
            x={segmentBox[0]}
            y={segmentBox[1]}
            width={segmentBox[2] - segmentBox[0]}
            height={segmentBox[3] - segmentBox[1]}
            stroke="#3b82f6"
            strokeWidth={2 / stagePos.scale}
            dash={[6 / stagePos.scale, 4 / stagePos.scale]}
          />
        )}
      </KLayer>
    </Stage>
  );
}

function ShapeRenderer({
  shape,
  layer,
  isSelected,
  onSelect,
  onUpdate,
  editable,
}: {
  shape: PolygonShape;
  layer: Layer;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<PolygonShape>) => void;
  editable: boolean;
}) {
  const stagePos = useRoofStore((s) => s.stagePosition);
  const activeTool = useRoofStore((s) => s.activeTool);
  const flat: number[] = [];
  for (const [x, y] of shape.vertices) flat.push(x, y);
  const color = shape.color || (layer.id === 'building-polygon' ? '#fb923c' : layer.id === 'lot-perimeter' ? '#3b82f6' : '#a855f7');
  return (
    <Group>
      <Line
        points={flat}
        closed={shape.closed}
        stroke={color}
        strokeWidth={isSelected ? 3 : 2}
        fill={`${color}33`}
        onClick={onSelect}
        onTap={onSelect}
        hitStrokeWidth={20}
      />
      {editable && isSelected && shape.vertices.map((v, i) => (
        <Circle
          key={i}
          x={v[0]}
          y={v[1]}
          radius={6}
          fill="#fff"
          stroke={color}
          strokeWidth={2}
          draggable
          onDragMove={(e) => {
            const next: [number, number][] = shape.vertices.map((vv, idx) =>
              idx === i ? [e.target.x(), e.target.y()] : vv,
            );
            onUpdate({ vertices: next });
          }}
        />
      ))}
    </Group>
  );
}