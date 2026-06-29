import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Ruler, Target, Upload, FileImage, ZoomIn, ZoomOut, RotateCcw, Crosshair, MousePointer } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

/* ── Types ── */
interface Point { x: number; y: number }

export type PlanMeasureMode = string | null; // tool id

export interface PlanAnnotationInfo {
  target: string;
  feet: number;
  index: number;
}

interface PlanViewerProps {
  measureMode: PlanMeasureMode;
  measureColors: Record<string, string>;
  measureLabels: Record<string, string>;
  measureToolTypes: Record<string, string>;
  measureUnits: Record<string, string>;
  measureMarkerShapes?: Record<string, string>;
  onMeasureComplete: (target: string | null, value: number) => void;
  onMeasureCancel: () => void;
  onAnnotationsChange?: (annotations: PlanAnnotationInfo[]) => void;
  deleteAnnotationIndex?: number | null;
  onDeleteAnnotationDone?: () => void;
  clearAllAnnotations?: boolean;
  onClearAllAnnotationsDone?: () => void;
  onBuildingEdited?: (newAreaM2: number, newPerimM: number) => void;
  /** URL of a previously saved plan image to auto-load */
  initialImageUrl?: string | null;
  /** Called whenever a plan image is loaded, providing a data-URL for persistence */
  onPlanImageData?: (dataUrl: string | null) => void;
}

interface Calibration {
  p1: Point;
  p2: Point;
  realDistance: number;
  unit: 'm' | 'pi';
  pixelDistance: number;
}

interface PlanAnnotation {
  toolId: string;
  points: Point[];
  type: 'line' | 'surface';
  valuePx: number;
  valueReal: number;
  unit: string;
}

/* ── PDF.js worker setup ── */
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

const PlanViewer: React.FC<PlanViewerProps> = ({
  measureMode, measureColors, measureLabels, measureToolTypes, measureUnits, measureMarkerShapes,
  onMeasureComplete, onMeasureCancel,
  onAnnotationsChange, deleteAnnotationIndex, onDeleteAnnotationDone,
  clearAllAnnotations, onClearAllAnnotationsDone, onBuildingEdited,
  initialImageUrl, onPlanImageData,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image state
  const [planImage, setPlanImage] = useState<HTMLImageElement | null>(null);
  const [planFileName, setPlanFileName] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // View transform
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const lastPan = useRef<Point>({ x: 0, y: 0 });
  const lastTouchDist = useRef<number | null>(null);
  const lastTouchCenter = useRef<Point | null>(null);

  // Calibration
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibPoints, setCalibPoints] = useState<Point[]>([]);
  const [calibDistance, setCalibDistance] = useState('');
  const [calibUnit, setCalibUnit] = useState<'m' | 'pi'>('pi');
  const [showCalibInput, setShowCalibInput] = useState(false);

  // Annotations
  const [annotations, setAnnotations] = useState<PlanAnnotation[]>([]);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  // ── Auto-load plan from URL ──
  const initialLoadedRef = useRef(false);
  useEffect(() => {
    if (!initialImageUrl || initialLoadedRef.current) return;
    initialLoadedRef.current = true;
    setLoading(true);
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setPlanImage(img);
      setPlanFileName('Plan sauvegardé');
      fitToView(img.width, img.height);
      setLoading(false);
    };
    img.onerror = () => {
      console.error('Failed to load initial plan image');
      setLoading(false);
    };
    img.src = initialImageUrl;
  }, [initialImageUrl]);

  // ── Notify parent when plan image changes ──
  useEffect(() => {
    if (!onPlanImageData) return;
    if (!planImage) { onPlanImageData(null); return; }
    // Convert to data URL via offscreen canvas
    try {
      const c = document.createElement('canvas');
      c.width = planImage.naturalWidth || planImage.width;
      c.height = planImage.naturalHeight || planImage.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(planImage, 0, 0);
        onPlanImageData(c.toDataURL('image/jpeg', 0.85));
      }
    } catch { onPlanImageData(null); }
  }, [planImage, onPlanImageData]);

  // ── Sync annotations to parent ──
  useEffect(() => {
    if (!onAnnotationsChange) return;
    const infos: PlanAnnotationInfo[] = annotations.map((a, i) => ({
      target: a.toolId,
      feet: Math.round(a.valueReal),
      index: i,
    }));
    onAnnotationsChange(infos);
  }, [annotations, onAnnotationsChange]);

  // ── Delete annotation by index from parent ──
  useEffect(() => {
    if (deleteAnnotationIndex == null) return;
    setAnnotations(prev => {
      if (deleteAnnotationIndex < 0 || deleteAnnotationIndex >= prev.length) return prev;
      const deleted = prev[deleteAnnotationIndex];
      const next = prev.filter((_, i) => i !== deleteAnnotationIndex);
      // Defer recalculation to avoid state conflicts
      if (deleted) {
        const toolId = deleted.toolId;
        const toolType = measureToolTypes[toolId] || 'Ligne';
        const remaining = next.filter(a => a.toolId === toolId);
        requestAnimationFrame(() => {
          if (toolType === 'Compteur') {
            onMeasureComplete(toolId, remaining.length);
          } else {
            const total = remaining.reduce((s, a) => s + a.valueReal, 0);
            onMeasureComplete(toolId, Math.round(total));
          }
        });
      }
      return next;
    });
    onDeleteAnnotationDone?.();
  }, [deleteAnnotationIndex]);

  // ── Clear all annotations from parent ──
  useEffect(() => {
    if (!clearAllAnnotations) return;
    setAnnotations([]);
    setCurrentPoints([]);
    onClearAllAnnotationsDone?.();
  }, [clearAllAnnotations]);

  // Convert screen coords to plan coords
  const screenToPlan = useCallback((sx: number, sy: number): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (sx - rect.left - pan.x) / zoom,
      y: (sy - rect.top - pan.y) / zoom,
    };
  }, [zoom, pan]);

  const planToScreen = useCallback((px: number, py: number): Point => ({
    x: px * zoom + pan.x,
    y: py * zoom + pan.y,
  }), [zoom, pan]);

  // Distance in pixels between two plan-space points
  const pixelDist = (a: Point, b: Point) => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

  // Convert pixel distance to real-world distance
  const toReal = useCallback((pxDist: number): number => {
    if (!calibration) return pxDist;
    return (pxDist / calibration.pixelDistance) * calibration.realDistance;
  }, [calibration]);

  // Calculate polygon area in pixel² then convert
  const polygonAreaPx = (pts: Point[]): number => {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y;
      area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
  };

  const toRealArea = useCallback((pxArea: number): number => {
    if (!calibration) return pxArea;
    const scale = calibration.realDistance / calibration.pixelDistance;
    return pxArea * scale * scale;
  }, [calibration]);

  /* ── File handling ── */
  const handleFile = async (file: File) => {
    setLoading(true);
    setPlanFileName(file.name);
    // Reset state for new file
    setCalibration(null);
    setAnnotations([]);
    setCurrentPoints([]);

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';

    try {
      if (isPdf) {
        await loadPdf(file);
      } else {
        await loadImage(file);
      }
    } catch (err) {
      console.error('Failed to load plan:', err);
      alert(`Erreur lors du chargement du fichier: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const loadImage = (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.onload = () => {
        setPlanImage(img);
        fitToView(img.width, img.height);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error(`Impossible de charger l'image: ${file.name}`));
      };
      img.src = url;
    });
  };

  const loadPdf = async (file: File) => {
    // Dynamic import of pdf.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);

    const scale = 2; // High res
    const viewport = page.getViewport({ scale });

    const offscreen = document.createElement('canvas');
    offscreen.width = viewport.width;
    offscreen.height = viewport.height;
    const ctx = offscreen.getContext('2d')!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const img = new Image();
    img.onload = () => {
      setPlanImage(img);
      fitToView(img.width, img.height);
    };
    img.src = offscreen.toDataURL();
  };

  const fitToView = (imgW: number, imgH: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const z = Math.min(cw / imgW, ch / imgH, 1) * 0.95;
    setZoom(z);
    setPan({
      x: (cw - imgW * z) / 2,
      y: (ch - imgH * z) / 2,
    });
  };

  /* ── Drawing ── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!planImage) return;

    // Draw plan image
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    ctx.drawImage(planImage, 0, 0);
    ctx.restore();

    // Draw calibration points
    if (calibrating && calibPoints.length > 0) {
      ctx.save();
      for (const p of calibPoints) {
        const sp = planToScreen(p.x, p.y);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (calibPoints.length === 2) {
        const s1 = planToScreen(calibPoints[0].x, calibPoints[0].y);
        const s2 = planToScreen(calibPoints[1].x, calibPoints[1].y);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Draw calibration line indicator
    if (calibration) {
      const s1 = planToScreen(calibration.p1.x, calibration.p1.y);
      const s2 = planToScreen(calibration.p2.x, calibration.p2.y);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.strokeStyle = 'rgba(34,197,94,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label
      const mx = (s1.x + s2.x) / 2;
      const my = (s1.y + s2.y) / 2;
      ctx.font = '10px monospace';
      ctx.fillStyle = '#22c55e';
      ctx.textAlign = 'center';
      ctx.fillText(`${calibration.realDistance} ${calibration.unit}`, mx, my - 6);
      ctx.restore();
    }

    // Draw completed annotations
    for (const ann of annotations) {
      const color = measureColors[ann.toolId] || '#fff';
      ctx.save();
      if (ann.type === 'line') {
        for (let i = 0; i < ann.points.length - 1; i++) {
          const s1 = planToScreen(ann.points[i].x, ann.points[i].y);
          const s2 = planToScreen(ann.points[i + 1].x, ann.points[i + 1].y);
          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // Label
        if (ann.points.length >= 2) {
          const last = ann.points[ann.points.length - 1];
          const sl = planToScreen(last.x, last.y);
          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.fillText(`${ann.valueReal.toFixed(1)} ${ann.unit}`, sl.x + 8, sl.y - 4);
        }
      } else if (ann.type === 'surface') {
        ctx.beginPath();
        for (let i = 0; i < ann.points.length; i++) {
          const s = planToScreen(ann.points[i].x, ann.points[i].y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
        ctx.fillStyle = color + '22';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Label at centroid
        const cx = ann.points.reduce((s, p) => s + p.x, 0) / ann.points.length;
        const cy = ann.points.reduce((s, p) => s + p.y, 0) / ann.points.length;
        const sc = planToScreen(cx, cy);
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(`${ann.valueReal.toFixed(1)} ${ann.unit}`, sc.x, sc.y);
      }
      // Points / counter markers
      const toolType = measureToolTypes[ann.toolId] || 'Ligne';
      const shape = (measureMarkerShapes && measureMarkerShapes[ann.toolId]) || 'circle';
      const isCounter = toolType === 'Compteur';
      const markerSize = isCounter ? 10 : 4;

      for (let pi = 0; pi < ann.points.length; pi++) {
        const p = ann.points[pi];
        const sp = planToScreen(p.x, p.y);

        if (isCounter) {
          // Draw the selected shape for counters
          ctx.fillStyle = color;
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          switch (shape) {
            case 'square':
              ctx.rect(sp.x - markerSize, sp.y - markerSize, markerSize * 2, markerSize * 2);
              break;
            case 'diamond':
              ctx.moveTo(sp.x, sp.y - markerSize);
              ctx.lineTo(sp.x + markerSize, sp.y);
              ctx.lineTo(sp.x, sp.y + markerSize);
              ctx.lineTo(sp.x - markerSize, sp.y);
              ctx.closePath();
              break;
            case 'triangle':
              ctx.moveTo(sp.x, sp.y - markerSize);
              ctx.lineTo(sp.x + markerSize, sp.y + markerSize);
              ctx.lineTo(sp.x - markerSize, sp.y + markerSize);
              ctx.closePath();
              break;
            case 'star': {
              const spikes = 5;
              const outerR = markerSize;
              const innerR = markerSize * 0.45;
              for (let s = 0; s < spikes * 2; s++) {
                const r = s % 2 === 0 ? outerR : innerR;
                const angle = (Math.PI / 2) * -1 + (Math.PI / spikes) * s;
                const sx = sp.x + Math.cos(angle) * r;
                const sy = sp.y + Math.sin(angle) * r;
                if (s === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
              }
              ctx.closePath();
              break;
            }
            default: // circle
              ctx.arc(sp.x, sp.y, markerSize, 0, Math.PI * 2);
              break;
          }
          ctx.fill();
          ctx.stroke();

          // Counter number label
          const counterIdx = annotations.filter(a => a.toolId === ann.toolId).indexOf(ann) + 1;
          ctx.font = 'bold 10px monospace';
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(counterIdx), sp.x, sp.y);
        } else {
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Draw current in-progress annotation
    if (currentPoints.length > 0 && measureMode) {
      const color = measureColors[measureMode] || '#fff';
      const toolType = measureToolTypes[measureMode] || 'Ligne';
      const isSurface = toolType === 'Surface';

      ctx.save();
      // Lines between placed points
      for (let i = 0; i < currentPoints.length - 1; i++) {
        const s1 = planToScreen(currentPoints[i].x, currentPoints[i].y);
        const s2 = planToScreen(currentPoints[i + 1].x, currentPoints[i + 1].y);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // Line to cursor
      if (cursorPos && currentPoints.length > 0) {
        const last = currentPoints[currentPoints.length - 1];
        const sl = planToScreen(last.x, last.y);
        const sc = planToScreen(cursorPos.x, cursorPos.y);
        ctx.beginPath();
        ctx.moveTo(sl.x, sl.y);
        ctx.lineTo(sc.x, sc.y);
        ctx.strokeStyle = color + '80';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Show live distance
        const dist = pixelDist(last, cursorPos);
        const realDist = toReal(dist);
        const unit = measureUnits[measureMode] || 'pi';
        const mx = (sl.x + sc.x) / 2;
        const my = (sl.y + sc.y) / 2;
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(`${realDist.toFixed(1)} ${unit}`, mx, my - 6);
      }
      // Points
      for (const p of currentPoints) {
        const sp = planToScreen(p.x, p.y);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();
    }
  }, [planImage, zoom, pan, calibrating, calibPoints, calibration, annotations, currentPoints, cursorPos, measureMode, measureColors, measureToolTypes, measureUnits, measureMarkerShapes, planToScreen, toReal]);

  useEffect(() => {
    const raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  /* ── Keyboard: space to pan ── */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); setSpaceHeld(true); } };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { setSpaceHeld(false); setIsPanning(false); } };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  /* ── Mouse handlers ── */
  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle click, right click, space+click, or left click without active mode → pan
    if (e.button === 1 || e.button === 2 || spaceHeld || (e.button === 0 && !calibrating && !measureMode)) {
      e.preventDefault();
      setIsPanning(true);
      lastPan.current = { x: e.clientX, y: e.clientY };
      return;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan(p => ({
        x: p.x + (e.clientX - lastPan.current.x),
        y: p.y + (e.clientY - lastPan.current.y),
      }));
      lastPan.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (measureMode || calibrating) {
      const pp = screenToPlan(e.clientX, e.clientY);
      setCursorPos(pp);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  /* ── Touch handlers (two-finger pan + pinch zoom) ── */
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      lastTouchDist.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      lastTouchCenter.current = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
    } else if (e.touches.length === 1 && !calibrating && !measureMode) {
      setIsPanning(true);
      lastPan.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const center = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };

      if (lastTouchDist.current && lastTouchCenter.current) {
        // Pinch zoom
        const factor = dist / lastTouchDist.current;
        const newZoom = Math.max(0.1, Math.min(10, zoom * factor));
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const mx = center.x - rect.left;
          const my = center.y - rect.top;
          setPan(p => ({
            x: mx - (mx - p.x) * (newZoom / zoom) + (center.x - lastTouchCenter.current!.x),
            y: my - (my - p.y) * (newZoom / zoom) + (center.y - lastTouchCenter.current!.y),
          }));
          setZoom(newZoom);
        }
      }
      lastTouchDist.current = dist;
      lastTouchCenter.current = center;
    } else if (e.touches.length === 1 && isPanning) {
      const t = e.touches[0];
      setPan(p => ({
        x: p.x + (t.clientX - lastPan.current.x),
        y: p.y + (t.clientY - lastPan.current.y),
      }));
      lastPan.current = { x: t.clientX, y: t.clientY };
    }
  };

  const handleTouchEnd = () => {
    setIsPanning(false);
    lastTouchDist.current = null;
    lastTouchCenter.current = null;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isPanning) return;
    const pp = screenToPlan(e.clientX, e.clientY);

    // Calibration mode
    if (calibrating) {
      if (calibPoints.length < 2) {
        const next = [...calibPoints, pp];
        setCalibPoints(next);
        if (next.length === 2) {
          setShowCalibInput(true);
        }
      }
      return;
    }

    // Measure mode
    if (measureMode && planImage) {
      const toolType = measureToolTypes[measureMode] || 'Ligne';
      const unit = measureUnits[measureMode] || 'pi';

      if (toolType === 'Compteur') {
        // Counter: just place a point
        const ann: PlanAnnotation = {
          toolId: measureMode,
          points: [pp],
          type: 'line',
          valuePx: 0,
          valueReal: 1,
          unit: 'unité',
        };
        setAnnotations(prev => [...prev, ann]);
        // Update count
        const count = annotations.filter(a => a.toolId === measureMode).length + 1;
        onMeasureComplete(measureMode, count);
        return;
      }

      if (toolType === 'Ligne') {
        if (currentPoints.length === 0) {
          setCurrentPoints([pp]);
        } else {
          // Complete the line
          const allPts = [...currentPoints, pp];
          let totalDist = 0;
          for (let i = 0; i < allPts.length - 1; i++) {
            totalDist += pixelDist(allPts[i], allPts[i + 1]);
          }
          const realDist = toReal(totalDist);
          const ann: PlanAnnotation = {
            toolId: measureMode,
            points: allPts,
            type: 'line',
            valuePx: totalDist,
            valueReal: realDist,
            unit,
          };
          setAnnotations(prev => [...prev, ann]);
          setCurrentPoints([]);
          onMeasureComplete(measureMode, Math.round(realDist));
        }
        return;
      }

      if (toolType === 'Multi-segment') {
        setCurrentPoints(prev => [...prev, pp]);
        return;
      }

      if (toolType === 'Surface') {
        setCurrentPoints(prev => [...prev, pp]);
        return;
      }
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!measureMode || currentPoints.length < 2) return;

    const toolType = measureToolTypes[measureMode] || 'Ligne';
    const unit = measureUnits[measureMode] || 'pi';

    if (toolType === 'Multi-segment') {
      let totalDist = 0;
      for (let i = 0; i < currentPoints.length - 1; i++) {
        totalDist += pixelDist(currentPoints[i], currentPoints[i + 1]);
      }
      const realDist = toReal(totalDist);
      const ann: PlanAnnotation = {
        toolId: measureMode,
        points: [...currentPoints],
        type: 'line',
        valuePx: totalDist,
        valueReal: realDist,
        unit,
      };
      setAnnotations(prev => [...prev, ann]);
      setCurrentPoints([]);
      onMeasureComplete(measureMode, Math.round(realDist));
    }

    if (toolType === 'Surface' && currentPoints.length >= 3) {
      const areaPx = polygonAreaPx(currentPoints);
      const realArea = toRealArea(areaPx);
      const ann: PlanAnnotation = {
        toolId: measureMode,
        points: [...currentPoints],
        type: 'surface',
        valuePx: areaPx,
        valueReal: realArea,
        unit,
      };
      setAnnotations(prev => [...prev, ann]);
      setCurrentPoints([]);
      onMeasureComplete(measureMode, Math.round(realArea));
    }
  };

  const handleWheelNative = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(prev => {
      const newZoom = Math.max(0.1, Math.min(10, prev * factor));
      setPan(p => ({
        x: mx - (mx - p.x) * (newZoom / prev),
        y: my - (my - p.y) * (newZoom / prev),
      }));
      return newZoom;
    });
  }, []);

  // Attach native wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheelNative);
  }, [handleWheelNative]);

  const confirmCalibration = () => {
    if (calibPoints.length !== 2 || !calibDistance) return;
    const dist = parseFloat(calibDistance);
    if (isNaN(dist) || dist <= 0) return;

    const pxDist = pixelDist(calibPoints[0], calibPoints[1]);
    setCalibration({
      p1: calibPoints[0],
      p2: calibPoints[1],
      realDistance: dist,
      unit: calibUnit,
      pixelDistance: pxDist,
    });
    setCalibrating(false);
    setShowCalibInput(false);
    setCalibPoints([]);
    setCalibDistance('');
  };

  const cancelCalibration = () => {
    setCalibrating(false);
    setShowCalibInput(false);
    setCalibPoints([]);
    setCalibDistance('');
  };

  /* ── Escape key ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (calibrating) cancelCalibration();
        else if (currentPoints.length > 0) setCurrentPoints([]);
        else if (measureMode) onMeasureCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calibrating, currentPoints, measureMode, onMeasureCancel]);

  /* ── Upload area (when no plan loaded) ── */
  if (!planImage && !loading) {
    return (
      <div
        ref={containerRef}
        style={{
          width: '100%', height: '100%', minHeight: 400,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(10,10,20,0.8)', borderRadius: 8, gap: 16,
          border: '2px dashed rgba(255,255,255,0.12)',
          cursor: 'pointer',
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff,.bmp,image/*,application/pdf"
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        <Upload size={40} style={{ color: '#4b5563' }} />
        <div style={{ color: '#9ca3af', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          Glissez un plan ici ou cliquez pour importer
        </div>
        <div style={{ color: '#6b7280', fontSize: 11 }}>
          PDF, PNG, JPG, WEBP…
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div ref={containerRef} style={{
        width: '100%', height: '100%', minHeight: 400,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(10,10,20,0.8)', borderRadius: 8,
      }}>
        <div style={{ color: '#a5b4fc', fontSize: 13 }}>Chargement du plan…</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 400, position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor: spaceHeld || isPanning ? 'grabbing' : (calibrating || measureMode) ? 'crosshair' : 'grab', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={e => e.preventDefault()}
      />

      {/* Top toolbar */}
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8,
        display: 'flex', alignItems: 'center', gap: 6,
        pointerEvents: 'none',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
          background: 'rgba(0,0,0,0.7)', borderRadius: 6, backdropFilter: 'blur(8px)',
          pointerEvents: 'auto',
        }}>
          <FileImage size={12} style={{ color: '#a5b4fc' }} />
          <span style={{ fontSize: 10, color: '#d1d5db', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {planFileName}
          </span>
          <button onClick={() => fileInputRef.current?.click()}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', color: '#9ca3af', fontSize: 9 }}>
            Changer
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff,.bmp,image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        </div>

        <div style={{ flex: 1 }} />

        {/* Calibration button */}
        <div style={{ pointerEvents: 'auto' }}>
          {!calibration ? (
            <button onClick={() => { setCalibrating(true); setCalibPoints([]); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 6, cursor: 'pointer', color: '#f87171', fontSize: 10, fontWeight: 700,
              }}>
              <Target size={12} /> Calibrer
            </button>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
              background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 6, fontSize: 10, color: '#22c55e',
            }}>
              <Crosshair size={11} />
              {calibration.realDistance} {calibration.unit} / {Math.round(calibration.pixelDistance)}px
              <button onClick={() => { setCalibration(null); setCalibrating(true); setCalibPoints([]); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 10, marginLeft: 4 }}>
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Zoom controls */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2, padding: '2px 4px',
          background: 'rgba(0,0,0,0.7)', borderRadius: 6, backdropFilter: 'blur(8px)',
          pointerEvents: 'auto',
        }}>
          <button onClick={() => { setZoom(z => Math.max(0.1, z * 0.8)); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', padding: 4 }}>
            <ZoomOut size={14} />
          </button>
          <span style={{ fontSize: 10, color: '#9ca3af', minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => { setZoom(z => Math.min(10, z * 1.2)); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', padding: 4 }}>
            <ZoomIn size={14} />
          </button>
          <button onClick={() => { if (planImage) fitToView(planImage.width, planImage.height); }}
            title="Ajuster à la vue"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', padding: 4 }}>
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Calibration instruction */}
      {calibrating && !showCalibInput && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(239,68,68,0.9)', color: '#fff', padding: '8px 16px',
          borderRadius: 8, fontSize: 12, fontWeight: 600, pointerEvents: 'none',
          backdropFilter: 'blur(8px)',
        }}>
          <Target size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
          {calibPoints.length === 0 ? 'Cliquez sur le 1er point de référence' :
           calibPoints.length === 1 ? 'Cliquez sur le 2e point de référence' : ''}
        </div>
      )}

      {/* Calibration distance input dialog */}
      {showCalibInput && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 12, padding: 20, backdropFilter: 'blur(12px)',
          minWidth: 280, pointerEvents: 'auto',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>
            Distance réelle entre les deux points
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="number"
              value={calibDistance}
              onChange={e => setCalibDistance(e.target.value)}
              placeholder="ex: 10"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') confirmCalibration(); }}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff', fontSize: 14, fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
              {(['pi', 'm'] as const).map(u => (
                <button key={u} onClick={() => setCalibUnit(u)}
                  style={{
                    padding: '8px 14px', border: 'none', cursor: 'pointer',
                    background: calibUnit === u ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
                    color: calibUnit === u ? '#a5b4fc' : '#9ca3af',
                    fontSize: 13, fontWeight: 700,
                  }}>
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={cancelCalibration}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}>
              Annuler
            </button>
            <button onClick={confirmCalibration}
              disabled={!calibDistance || parseFloat(calibDistance) <= 0}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff',
                fontSize: 12, fontWeight: 700,
                opacity: (!calibDistance || parseFloat(calibDistance) <= 0) ? 0.5 : 1,
              }}>
              Confirmer
            </button>
          </div>
        </div>
      )}

      {/* Measure mode indicator */}
      {measureMode && !calibrating && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: `${measureColors[measureMode] || '#6366f1'}cc`, color: '#fff',
          padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600,
          pointerEvents: 'none', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Ruler size={12} />
          {measureLabels[measureMode] || 'Mesure'}
          {!calibration && <span style={{ opacity: 0.7, fontSize: 9 }}>⚠ Non calibré</span>}
        </div>
      )}
    </div>
  );
};

export default PlanViewer;
