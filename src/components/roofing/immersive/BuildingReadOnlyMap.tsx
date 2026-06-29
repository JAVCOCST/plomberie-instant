/// <reference types="google.maps" />
import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { motion } from 'framer-motion';
import { MapPin, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, RotateCw, RefreshCcw, Settings2, X, Check, Eye, EyeOff, Layers, ZoomIn, ZoomOut, Pencil } from 'lucide-react';
import s from './BuildingConfirmation.module.css';
import { useIsMobile } from '@/hooks/use-mobile';
import MobilePrecisionLayer from './MobilePrecisionLayer';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Cache en mémoire (module-level) pour les toggles de calques.
// Volontairement PAS localStorage : évite OOM/quota et corruption.
const __layerStateMemCache = new Map<string, {
  showGoogleSatellite: boolean;
  showOrthoQC: boolean;
  showLot: boolean;
  showBuilding: boolean;
}>();

let googleMapsScriptPromise: Promise<void> | null = null;
const hasGoogleMaps = () => Boolean(window.google?.maps);

function ensureGoogleMapsScript(): Promise<void> {
  if (hasGoogleMaps()) return Promise.resolve();
  if (googleMapsScriptPromise) return googleMapsScriptPromise;
  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      existing.addEventListener('load', () => (hasGoogleMaps() ? resolve() : reject(new Error('Google Maps non disponible'))), { once: true });
      existing.addEventListener('error', () => reject(new Error('Chargement Google Maps échoué')), { once: true });
      return;
    }
    if (!GOOGLE_MAPS_API_KEY) { reject(new Error('Clé Google Maps manquante')); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.dataset.googleMapsLoader = 'lovable';
    script.onload = () => (hasGoogleMaps() ? resolve() : reject(new Error('Google Maps non disponible')));
    script.onerror = () => reject(new Error('Chargement Google Maps échoué'));
    document.head.appendChild(script);
  });
  return googleMapsScriptPromise;
}

export interface PolygonAdjustments {
  offsetEastM: number;
  offsetNorthM: number;
  rotationDeg: number;
  scaleFactor?: number;
}

export type MeasureTarget = string | null;

export interface AnnotationInfo {
  target: string;
  feet: number;
  visible: boolean;
  index: number;
  segments?: google.maps.LatLngLiteral[][];
  markerPositions?: google.maps.LatLngLiteral[];
}

export interface AdjustControls {
  nudgeNorth: () => void;
  nudgeSouth: () => void;
  nudgeEast: () => void;
  nudgeWest: () => void;
  rotateCCW: () => void;
  rotateCW: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  scaleFactor: number;
  target: 'building' | 'lot';
  setTarget: (t: 'building' | 'lot') => void;
  hasLot: boolean;
}

/**
 * Contrôles exposés pour piloter calques + fond + zoom carte depuis un
 * composant externe (MapToolbox).
 */
export interface MapToolboxControls {
  hasLot: boolean;
  showLot: boolean;
  toggleLot: () => void;
  isEditingLot: boolean;
  toggleLotEdit: () => void;
  showBuilding: boolean;
  toggleBuilding: () => void;
  isEditingBuilding: boolean;
  toggleBuildingEdit: () => void;
  annotations: { target: string; feet: number; visible: boolean; color: string; label: string }[];
  toggleAnnotation: (index: number) => void;
  showGoogleSatellite: boolean;
  toggleGoogleSatellite: () => void;
  showOrthoQC: boolean;
  toggleOrthoQC: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Calques vectoriels supplémentaires (skeleton, etc.) injectés via props. */
  extraLayers: { id: string; label: string; color: string; visible: boolean }[];
  toggleExtraLayer: (id: string) => void;
  /**
   * Renvoie les paramètres de la vue carte courante pour capture/IA.
   * `topLayer` est le calque le plus avancé en Z parmi ceux qui sont visibles
   * ('ortho' si Ortho QC est activé, sinon 'google'). Renvoie null si la map
   * n'est pas prête.
   */
  getCaptureParams: () => null | {
    centerLat: number;
    centerLng: number;
    zoom: number;
    width: number;
    height: number;
    bounds: { north: number; south: number; east: number; west: number };
    topLayer: 'ortho' | 'google';
    showGoogleSatellite: boolean;
    showOrthoQC: boolean;
  };
}

interface BuildingReadOnlyMapProps {
  centerLat: number;
  centerLng: number;
  zoom: number;
  buildingGeojson: string;
  lotGeojson?: string | null;
  address: string;
  superficie?: number | null;
  largeur?: number | null;
  profondeur?: number | null;
  noLot?: string | null;
  onAdjustmentsChange?: (adj: PolygonAdjustments) => void;
  onLotAdjustmentsChange?: (adj: PolygonAdjustments) => void;
  onBuildingGeojsonChange?: (geojson: string) => void;
  onLotGeojsonChange?: (geojson: string) => void;
  measureMode?: MeasureTarget;
  measureColors?: Record<string, string>;
  measureLabels?: Record<string, string>;
  measureToolTypes?: Record<string, string>;
  measureMarkerShapes?: Record<string, string>;
  onMeasureComplete?: (target: MeasureTarget, value: number) => void;
  onMeasureCancel?: () => void;
  onBuildingEdited?: (newSuperficieM2: number, newPerimetreM: number) => void;
  onAnnotationsChange?: (annotations: AnnotationInfo[]) => void;
  deleteAnnotationIndex?: number | null;
  onDeleteAnnotationDone?: () => void;
  clearAllAnnotations?: boolean;
  onClearAllAnnotationsDone?: () => void;
  hideBuiltinAdjust?: boolean;
  onAdjustControlsReady?: (controls: AdjustControls) => void;
  /** Cache les contrôles internes (basemap, layer panel, panneau Couches) — utile lorsqu'ils sont rendus dans MapToolbox externe. */
  hideBuiltinMapTools?: boolean;
  onMapToolboxControlsReady?: (controls: MapToolboxControls) => void;
  navigateMode?: boolean;
  /** Masque les petits cercles posés à chaque vertex en mode mesure (utile sur mobile pour gagner en précision visuelle). Les compteurs ne sont pas affectés. */
  hideMeasureVertexMarkers?: boolean;
  /** Force la carte à toujours accepter pan/pinch-zoom (gestureHandling 'greedy'), même hors mode mesure/navigation. */
  alwaysInteractive?: boolean;
  initialAnnotations?: AnnotationInfo[];
  initialAdjustments?: PolygonAdjustments;
  initialLotAdjustments?: PolygonAdjustments;
  /**
   * Calques image géo-référencés superposés sur la carte (ex. capture
   * orthophoto, image améliorée Real-ESRGAN, masque polygone IA).
   * Chaque overlay est rendu comme `google.maps.GroundOverlay` aux bounds
   * fournis. Géré par le parent ; l'ordre Z suit l'ordre du tableau (le
   * dernier élément est au-dessus).
   */
  imageOverlays?: {
    id: string;
    url: string;            // data: ou https:
    bounds: { north: number; south: number; east: number; west: number };
    visible: boolean;
    opacity?: number;       // 0..1 (défaut 1)
  }[];
  /**
   * Polylignes vectorielles supplémentaires (ex. straight skeleton) rendues
   * en overlay au-dessus des polygones. Toggleables via la boîte à outils.
   */
  extraPolylines?: {
    id: string;
    label: string;
    color: string;
    paths: Array<Array<{ lat: number; lng: number }>>;
    visible: boolean;
    weight?: number;
  }[];
  onToggleExtraPolyline?: (id: string) => void;
  /** Si fourni, persiste l'état des calques (satellite, ortho, lot, bâtiment) dans localStorage. */
  layerStateStorageKey?: string;
  /** Affiche Orthophoto QC dès l'ouverture pour éviter une fenêtre noire si les tuiles Google Satellite ne chargent pas. */
  defaultShowOrthoQC?: boolean;
  /** Notifie le parent à chaque fin de pan/zoom afin de persister la vue. */
  onViewChange?: (view: { centerLat: number; centerLng: number; zoom: number }) => void;
}

function parseGeoJsonCoords(geojsonStr: string): google.maps.LatLngLiteral[][] {
  try {
    const parsed = JSON.parse(geojsonStr);
    let rings: number[][][] = [];
    if (parsed.type === 'Polygon') rings = parsed.coordinates;
    else if (parsed.type === 'MultiPolygon') parsed.coordinates.forEach((p: number[][][]) => rings.push(...p));
    return rings.map(ring => ring.map(([lng, lat]) => ({ lat, lng })));
  } catch {
    return [];
  }
}

function offsetPoint(point: google.maps.LatLngLiteral, northMeters: number, eastMeters: number): google.maps.LatLngLiteral {
  const latDelta = northMeters / 111320;
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const lngDelta = eastMeters / (111320 * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat));
  return { lat: point.lat + latDelta, lng: point.lng + lngDelta };
}

function rotatePoint(
  point: google.maps.LatLngLiteral,
  centerLat: number,
  centerLng: number,
  angleDeg: number
): google.maps.LatLngLiteral {
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dx = (point.lng - centerLng) * cosLat;
  const dy = point.lat - centerLat;
  const rx = dx * cosA - dy * sinA;
  const ry = dx * sinA + dy * cosA;
  return {
    lat: centerLat + ry,
    lng: centerLng + rx / (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat),
  };
}

/** Haversine distance in feet between two LatLng points */
function haversineFeet(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): number {
  const R = 6371000; // earth radius meters
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c * 3.28084; // meters to feet
}

/** Formatage compact d'une longueur en pieds, ex: 12'  ou  12'6" */
function formatFeetLabel(feet: number): string {
  if (!isFinite(feet) || feet < 0) return '';
  const whole = Math.floor(feet);
  const inches = Math.round((feet - whole) * 12);
  if (inches === 0) return `${whole}'`;
  if (inches === 12) return `${whole + 1}'`;
  return `${whole}'${inches}"`;
}

/**
 * Crée et maintient des étiquettes de longueur (pieds) au centre de chaque
 * segment d'un polygone Google Maps. Met à jour automatiquement quand le
 * path change (déplacement / ajout / suppression de sommet) et au zoom.
 *
 * Si le segment est trop court pour contenir le texte, l'étiquette se
 * décale perpendiculairement et une fine ligne de rappel (leader line)
 * relie l'étiquette au milieu du segment.
 */
function createEdgeLengthLabels(
  poly: google.maps.Polygon,
  map: google.maps.Map,
): { destroy: () => void; setVisible: (v: boolean) => void } {
  const Overlay = class extends google.maps.OverlayView {
    private root: HTMLDivElement | null = null;
    private visible = true;

    onAdd() {
      const root = document.createElement('div');
      root.style.position = 'absolute';
      root.style.left = '0';
      root.style.top = '0';
      root.style.width = '0';
      root.style.height = '0';
      root.style.pointerEvents = 'none';
      this.root = root;
      const panes = this.getPanes();
      panes?.overlayLayer.appendChild(root);
    }

    onRemove() {
      if (this.root && this.root.parentNode) {
        this.root.parentNode.removeChild(this.root);
      }
      this.root = null;
    }

    setVis(v: boolean) {
      this.visible = v;
      if (this.root) this.root.style.display = v ? '' : 'none';
    }

    draw() {
      if (!this.root) return;
      const proj = this.getProjection();
      if (!proj) return;
      const path = poly.getPath();
      const n = path.getLength();
      if (n < 2) {
        this.root.innerHTML = '';
        return;
      }

      // Reconstruit en HTML/SVG (rapide pour <50 segments).
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const a = path.getAt(i);
        const b = path.getAt((i + 1) % n);
        const aLL = { lat: a.lat(), lng: a.lng() };
        const bLL = { lat: b.lat(), lng: b.lng() };
        const feet = haversineFeet(aLL, bLL);
        if (feet < 0.5) continue;
        const text = formatFeetLabel(feet);

        const pa = proj.fromLatLngToDivPixel(a)!;
        const pb = proj.fromLatLngToDivPixel(b)!;
        if (!pa || !pb) continue;
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const segLenPx = Math.sqrt(dx * dx + dy * dy);
        if (segLenPx < 8) continue;

        // Largeur estimée du label (police 9px, ~5.5px par caractère).
        const estW = text.length * 5.5 + 8;
        const estH = 14;
        // Si le segment est trop court, on décale perpendiculairement.
        const needsLeader = segLenPx < estW + 6;
        let cx = mx;
        let cy = my;
        if (needsLeader) {
          // Vecteur perpendiculaire normalisé (vers l'extérieur du polygone
          // approximé par le côté opposé au centroïde).
          const nx = -dy / segLenPx;
          const ny = dx / segLenPx;
          const offset = 14;
          cx = mx + nx * offset;
          cy = my + ny * offset;
        }

        // Angle de rotation aligné sur le segment, redressé pour rester lisible.
        let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angleDeg > 90) angleDeg -= 180;
        if (angleDeg < -90) angleDeg += 180;

        if (needsLeader) {
          parts.push(
            `<svg style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none" width="0" height="0">` +
              `<line x1="${mx}" y1="${my}" x2="${cx}" y2="${cy}" stroke="rgba(255,255,255,0.85)" stroke-width="0.75" stroke-dasharray="2,2"/>` +
            `</svg>`,
          );
        }
        parts.push(
          `<div style="` +
            `position:absolute;` +
            `left:${cx}px;top:${cy}px;` +
            `transform:translate(-50%,-50%) rotate(${needsLeader ? 0 : angleDeg}deg);` +
            `transform-origin:center center;` +
            `font:600 9px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
            `color:#ffffff;` +
            `text-shadow:0 0 2px rgba(0,0,0,0.95),0 0 1px rgba(0,0,0,0.95),0 1px 1px rgba(0,0,0,0.9);` +
            `padding:1px 4px;` +
            `white-space:nowrap;` +
            `letter-spacing:0.02em;` +
            `min-width:${estW}px;` +
            `min-height:${estH}px;` +
            `display:flex;align-items:center;justify-content:center;` +
          `">${text}</div>`,
        );
      }
      this.root.innerHTML = parts.join('');
      this.root.style.display = this.visible ? '' : 'none';
    }
  };

  const overlay = new Overlay();
  overlay.setMap(map);

  // Re-render quand le path est modifié (déplacement / ajout / suppression).
  const path = poly.getPath();
  const listeners: google.maps.MapsEventListener[] = [];
  // Coalesce rapid mutations (drag of a vertex fires many set_at events) into
  // a single rAF draw to keep mobile at 60fps.
  let rafId: number | null = null;
  const trigger = () => {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => { rafId = null; overlay.draw(); });
  };
  listeners.push(google.maps.event.addListener(path, 'set_at', trigger));
  listeners.push(google.maps.event.addListener(path, 'insert_at', trigger));
  listeners.push(google.maps.event.addListener(path, 'remove_at', trigger));
  // Re-render quand on remplace tout le path (rare).
  listeners.push(google.maps.event.addListener(poly, 'paths_changed', trigger));
  // Re-render au zoom (les distances pixel changent).
  listeners.push(google.maps.event.addListener(map, 'zoom_changed', trigger));
  listeners.push(google.maps.event.addListener(map, 'idle', trigger));

  return {
    destroy: () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      listeners.forEach((l) => google.maps.event.removeListener(l));
      overlay.setMap(null);
    },
    setVisible: (v: boolean) => overlay.setVis(v),
  };
}

/** Haversine distance in meters */
function haversineMeters(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

/** Spherical polygon area in m² using the Shoelace formula with lat/lng projected to meters */
function computePolygonAreaM2(path: google.maps.LatLngLiteral[]): number {
  if (path.length < 3) return 0;
  const refLat = path[0].lat;
  const cosLat = Math.cos(refLat * Math.PI / 180);
  const pts = path.map(p => ({
    x: (p.lng - path[0].lng) * cosLat * 111320,
    y: (p.lat - path[0].lat) * 111320,
  }));
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

/** Perimeter of a polygon path in meters */
function computePolygonPerimeterM(path: google.maps.LatLngLiteral[]): number {
  let total = 0;
  for (let i = 0; i < path.length; i++) {
    const next = path[(i + 1) % path.length];
    total += haversineMeters(path[i], next);
  }
  return total;
}

const NUDGE_STEP_METERS = 0.25;
const ROTATE_STEP_DEG = 0.5;
const SCALE_STEP = 0.02;

const MEASURE_LABELS: Record<string, string> = {
  faitiere: 'Faîtière',
  aretes: 'Arêtes',
  noues: 'Noues',
};

const MEASURE_COLORS: Record<string, string> = {
  faitiere: '#ef4444',  // red
  aretes: '#3b82f6',    // blue
  noues: '#f59e0b',     // amber
};

interface SavedAnnotation {
  target: string;
  feet: number;
  polylines: google.maps.Polyline[];
  markers: google.maps.Marker[];
  label: google.maps.InfoWindow | null;
  visible: boolean;
}

// Google Maps Symbol only supports M, L, Z (no arcs). Use polygons to approximate shapes.
const SHAPE_PATHS: Record<string, { path: string; builtIn?: boolean }> = {
  circle: { path: '', builtIn: true }, // use google.maps.SymbolPath.CIRCLE
  square: { path: 'M -1,-1 L 1,-1 L 1,1 L -1,1 Z' },
  diamond: { path: 'M 0,-1.2 L 0.8,0 L 0,-1.2 L -0.8,0 Z' },
  triangle: { path: 'M 0,-1.1 L 1,0.8 L -1,0.8 Z' },
  star: { path: 'M 0,-1.2 L 0.35,-0.35 L 1.1,-0.35 L 0.5,0.15 L 0.7,1 L 0,0.5 L -0.7,1 L -0.5,0.15 L -1.1,-0.35 L -0.35,-0.35 Z' },
};

function createImagePaneOverlay(
  url: string,
  bounds: { north: number; south: number; east: number; west: number },
  opacity: number,
  zIndex: number,
  paneName: 'mapPane' | 'overlayLayer' | 'markerLayer' | 'overlayMouseTarget' | 'floatPane' = 'mapPane',
) {
  return new (class extends google.maps.OverlayView {
    private root: HTMLDivElement | null = null;
    private img: HTMLImageElement | null = null;

    onAdd() {
      const root = document.createElement('div');
      root.style.position = 'absolute';
      root.style.pointerEvents = 'none';
      root.style.overflow = 'hidden';
      root.style.zIndex = String(zIndex);
      const img = document.createElement('img');
      img.src = url;
      img.style.position = 'absolute';
      img.style.inset = '0';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.opacity = String(opacity);
      img.style.userSelect = 'none';
      img.draggable = false;
      root.appendChild(img);
      this.root = root;
      this.img = img;
      const panes = this.getPanes();
      // mapPane = couche la plus basse, sous les polygones SVG Google
      // → l'image IA reste visible mais derrière les polygones lot/bâtiment.
      const targetPane = (panes as any)?.[paneName] || panes?.overlayLayer;
      targetPane?.appendChild(root);
    }

    draw() {
      if (!this.root) return;
      const projection = this.getProjection();
      if (!projection) return;
      const sw = projection.fromLatLngToDivPixel(new google.maps.LatLng(bounds.south, bounds.west));
      const ne = projection.fromLatLngToDivPixel(new google.maps.LatLng(bounds.north, bounds.east));
      if (!sw || !ne) return;
      const left = Math.min(sw.x, ne.x);
      const top = Math.min(sw.y, ne.y);
      const width = Math.abs(ne.x - sw.x);
      const height = Math.abs(sw.y - ne.y);
      this.root.style.left = `${left}px`;
      this.root.style.top = `${top}px`;
      this.root.style.width = `${width}px`;
      this.root.style.height = `${height}px`;
    }

    onRemove() {
      this.root?.parentNode?.removeChild(this.root);
      this.root = null;
      this.img = null;
    }
  })();
}

const BuildingReadOnlyMap: React.FC<BuildingReadOnlyMapProps> = ({
  centerLat, centerLng, zoom,
  buildingGeojson, lotGeojson,
  address, superficie, largeur, profondeur, noLot,
  onAdjustmentsChange,
  onLotAdjustmentsChange,
  onBuildingGeojsonChange,
  onLotGeojsonChange,
  measureMode, measureColors: extColors, measureLabels: extLabels, onMeasureComplete, onMeasureCancel,
  onBuildingEdited,
  measureToolTypes: extToolTypes, measureMarkerShapes: extMarkerShapes,
  onAnnotationsChange, deleteAnnotationIndex, onDeleteAnnotationDone,
  clearAllAnnotations, onClearAllAnnotationsDone,
  hideBuiltinAdjust, onAdjustControlsReady, hideBuiltinMapTools, onMapToolboxControlsReady, navigateMode, initialAnnotations, initialAdjustments, initialLotAdjustments,
  hideMeasureVertexMarkers,
  alwaysInteractive,
  imageOverlays,
  defaultShowOrthoQC = false,
  onViewChange,
  extraPolylines,
  onToggleExtraPolyline,
  layerStateStorageKey,
}) => {
  const isMobile = useIsMobile();
  // Merge external colors/labels with defaults
  const mergedColors = useMemo(() => ({ ...MEASURE_COLORS, ...extColors }), [extColors]);
  const mergedLabels = useMemo(() => ({ ...MEASURE_LABELS, ...extLabels }), [extLabels]);
  const mergedToolTypes = useMemo(() => extToolTypes || {}, [extToolTypes]);
  const mergedMarkerShapes = useMemo(() => extMarkerShapes || {}, [extMarkerShapes]);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // ── GroundOverlay management (image_overlays prop) ──────────────────
  // Map id → GroundOverlay so we can update visibility/opacity in place
  // and only rebuild when bounds/url change.
  const overlayInstancesRef = useRef<Map<string, {
    overlay: google.maps.OverlayView;
    url: string;
    bounds: { north: number; south: number; east: number; west: number };
  }>>(new Map());
  // Calques d'image carte indépendants (activables/désactivables séparément).
  // Google satellite est le fond par défaut ; Orthophoto QC peut se superposer
  // par-dessus pour un secteur où elle offre plus de détail/fraîcheur.
  // Si les deux sont désactivés, on affiche un fond gris neutre (roadmap).
  // ── Persisted layer state (in-memory only) ──
  // On NE persiste PAS dans localStorage (risque OOM / quota). On garde un
  // cache module-level en mémoire, qui survit aux navigations SPA mais pas
  // à un reload complet — comportement volontaire.
  const persistedLayers = useMemo(() => {
    if (!layerStateStorageKey) return null;
    return __layerStateMemCache.get(layerStateStorageKey) ?? null;
  }, [layerStateStorageKey]);
  const [showGoogleSatellite, setShowGoogleSatellite] = useState(
    persistedLayers?.showGoogleSatellite ?? true,
  );
  const [showOrthoQC, setShowOrthoQC] = useState(
    persistedLayers?.showOrthoQC ?? defaultShowOrthoQC,
  );
  const [qcError, setQcError] = useState(false);
  const qcMapTypeRef = useRef<google.maps.ImageMapType | null>(null);
  useEffect(() => { if (defaultShowOrthoQC) setShowOrthoQC(true); }, [defaultShowOrthoQC]);
  // Échelle personnalisée (toujours visible, indépendante du fond de carte)
  const [scale, setScale] = useState<{ label: string; widthPx: number } | null>(null);
  const [offsetEastM, setOffsetEastM] = useState(initialAdjustments?.offsetEastM || 0);
  const [offsetNorthM, setOffsetNorthM] = useState(initialAdjustments?.offsetNorthM || 0);
  const [rotationDeg, setRotationDeg] = useState(initialAdjustments?.rotationDeg || 0);
  const [scaleFactor, setScaleFactor] = useState(initialAdjustments?.scaleFactor || 1);
  // Lot transforms (independent of building)
  const [lotOffsetEastM, setLotOffsetEastM] = useState(initialLotAdjustments?.offsetEastM || 0);
  const [lotOffsetNorthM, setLotOffsetNorthM] = useState(initialLotAdjustments?.offsetNorthM || 0);
  const [lotRotationDeg, setLotRotationDeg] = useState(initialLotAdjustments?.rotationDeg || 0);
  const [lotScaleFactor, setLotScaleFactor] = useState(initialLotAdjustments?.scaleFactor || 1);
  // Which polygon the arrows control
  const [adjustTarget, setAdjustTarget] = useState<'building' | 'lot'>('building');
  const [showControls, setShowControls] = useState(false);
  // Store user-edited base paths (after manual vertex dragging)
  const editedBasePathsRef = useRef<google.maps.LatLngLiteral[][] | null>(null);
  const editedBaseLotPathsRef = useRef<google.maps.LatLngLiteral[][] | null>(null);
  // Store last applied transform so we can "undo" it to get raw coords
  const lastTransformRef = useRef({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
  const lastLotTransformRef = useRef({ offsetEastM: 0, offsetNorthM: 0, rotationDeg: 0, scaleFactor: 1 });
  // Flag to skip the "new building" reset when geojson change came from our own edit emit
  const selfEmitBuildingRef = useRef(false);
  const selfEmitLotRef = useRef(false);

  // Expose adjust controls to parent
  useEffect(() => {
    if (onAdjustControlsReady) {
      const isLot = adjustTarget === 'lot';
      onAdjustControlsReady({
        nudgeNorth: () => isLot ? setLotOffsetNorthM(v => v + NUDGE_STEP_METERS) : setOffsetNorthM(v => v + NUDGE_STEP_METERS),
        nudgeSouth: () => isLot ? setLotOffsetNorthM(v => v - NUDGE_STEP_METERS) : setOffsetNorthM(v => v - NUDGE_STEP_METERS),
        nudgeEast: () => isLot ? setLotOffsetEastM(v => v + NUDGE_STEP_METERS) : setOffsetEastM(v => v + NUDGE_STEP_METERS),
        nudgeWest: () => isLot ? setLotOffsetEastM(v => v - NUDGE_STEP_METERS) : setOffsetEastM(v => v - NUDGE_STEP_METERS),
        rotateCCW: () => isLot ? setLotRotationDeg(v => v + ROTATE_STEP_DEG) : setRotationDeg(v => v + ROTATE_STEP_DEG),
        rotateCW: () => isLot ? setLotRotationDeg(v => v - ROTATE_STEP_DEG) : setRotationDeg(v => v - ROTATE_STEP_DEG),
        zoomIn: () => isLot ? setLotScaleFactor(v => Math.min(2, v + SCALE_STEP)) : setScaleFactor(v => Math.min(2, v + SCALE_STEP)),
        zoomOut: () => isLot ? setLotScaleFactor(v => Math.max(0.5, v - SCALE_STEP)) : setScaleFactor(v => Math.max(0.5, v - SCALE_STEP)),
        reset: () => {
          if (isLot) {
            editedBaseLotPathsRef.current = null;
            setLotOffsetEastM(0); setLotOffsetNorthM(0); setLotRotationDeg(0); setLotScaleFactor(1);
          } else {
            editedBasePathsRef.current = null;
            setOffsetEastM(0); setOffsetNorthM(0); setRotationDeg(0); setScaleFactor(1);
          }
        },
        scaleFactor: isLot ? lotScaleFactor : scaleFactor,
        target: adjustTarget,
        setTarget: setAdjustTarget,
        hasLot: !!lotGeojson,
      });
    }
  }, [onAdjustControlsReady, scaleFactor, lotScaleFactor, adjustTarget, lotGeojson]);


  const measureSegmentsRef = useRef<google.maps.LatLngLiteral[][]>([[]]);
  const measureMarkersRef = useRef<google.maps.Marker[]>([]);
  const measurePolylinesRef = useRef<google.maps.Polyline[]>([]);
  const measureLabelRef = useRef<google.maps.InfoWindow | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const dblClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const lastClickTimeRef = useRef(0);
  const pendingClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [measureTotal, setMeasureTotal] = useState(0);
  const [segmentCount, setSegmentCount] = useState(1);
  const [flashGreen, setFlashGreen] = useState(false);
  const [measureZoom, setMeasureZoom] = useState<number | null>(null);
  const savedAnnotationsRef = useRef<SavedAnnotation[]>([]);
  const [savedAnnotations, setSavedAnnotations] = useState<{ target: string; feet: number; visible: boolean }[]>([]);
  const [showLot, setShowLot] = useState(persistedLayers?.showLot ?? true);
  const [showBuilding, setShowBuilding] = useState(persistedLayers?.showBuilding ?? true);
  // Persistance des 4 toggles en mémoire uniquement.
  useEffect(() => {
    if (!layerStateStorageKey) return;
    __layerStateMemCache.set(layerStateStorageKey, {
      showGoogleSatellite, showOrthoQC, showLot, showBuilding,
    });
  }, [layerStateStorageKey, showGoogleSatellite, showOrthoQC, showLot, showBuilding]);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const lotPolygonsRef = useRef<google.maps.Polygon[]>([]);
  const buildingPolygonsRef = useRef<google.maps.Polygon[]>([]);
  // Labels DOM persistants au centre de chaque segment du polygone de lot.
  // Chaque entrée gère ses propres listeners (set_at, insert_at, remove_at, zoom).
  const lotEdgeLabelsRef = useRef<Array<{ destroy: () => void; setVisible: (v: boolean) => void }>>([]);
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);
  const editListenersRef = useRef<google.maps.MapsEventListener[]>([]);

  // Navigate mode toggle
  useEffect(() => {
    if (!mapInstance.current) return;
    if (measureMode) {
      // In measure mode, the map must accept clicks for the measurement listeners to fire.
      // Use 'greedy' so single-finger pan still works while measuring.
      mapInstance.current.setOptions({ gestureHandling: 'greedy', draggable: true, scrollwheel: true, zoomControl: true, clickableIcons: false });
    } else if (navigateMode) {
      mapInstance.current.setOptions({ gestureHandling: 'greedy', draggable: true, scrollwheel: true, zoomControl: true });
    } else if (alwaysInteractive) {
      mapInstance.current.setOptions({ gestureHandling: 'greedy', draggable: true, scrollwheel: true, zoomControl: true });
    } else {
      mapInstance.current.setOptions({ gestureHandling: 'none', draggable: false, scrollwheel: false, zoomControl: false });
    }
  }, [mapReady, navigateMode, measureMode, alwaysInteractive]);

  // Notify parent of adjustments changes
  useEffect(() => {
    onAdjustmentsChange?.({ offsetEastM, offsetNorthM, rotationDeg, scaleFactor });
  }, [offsetEastM, offsetNorthM, rotationDeg, scaleFactor, onAdjustmentsChange]);
  useEffect(() => {
    onLotAdjustmentsChange?.({ offsetEastM: lotOffsetEastM, offsetNorthM: lotOffsetNorthM, rotationDeg: lotRotationDeg, scaleFactor: lotScaleFactor });
  }, [lotOffsetEastM, lotOffsetNorthM, lotRotationDeg, lotScaleFactor, onLotAdjustmentsChange]);

  const clearPolygons = useCallback(() => {
    lotPolygonsRef.current.forEach((p) => p.setMap(null));
    lotPolygonsRef.current = [];
    lotEdgeLabelsRef.current.forEach((lbl) => lbl.destroy());
    lotEdgeLabelsRef.current = [];
    buildingPolygonsRef.current.forEach((p) => p.setMap(null));
    buildingPolygonsRef.current = [];
    editListenersRef.current.forEach(l => google.maps.event.removeListener(l));
    editListenersRef.current = [];
  }, []);

  const onBuildingEditedRef = useRef(onBuildingEdited);
  useEffect(() => { onBuildingEditedRef.current = onBuildingEdited; }, [onBuildingEdited]);
  const onBuildingGeojsonChangeRef = useRef(onBuildingGeojsonChange);
  useEffect(() => { onBuildingGeojsonChangeRef.current = onBuildingGeojsonChange; }, [onBuildingGeojsonChange]);
  const onLotGeojsonChangeRef = useRef(onLotGeojsonChange);
  useEffect(() => { onLotGeojsonChangeRef.current = onLotGeojsonChange; }, [onLotGeojsonChange]);

  // Serialize array of LatLng rings to a GeoJSON Polygon/MultiPolygon string
  const ringsToGeojson = (rings: google.maps.LatLngLiteral[][]): string => {
    const closeRing = (ring: number[][]) => {
      if (ring.length === 0) return ring;
      const first = ring[0]; const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
      return ring;
    };
    const coords = rings.map(r => closeRing(r.map(p => [p.lng, p.lat])));
    if (coords.length === 1) return JSON.stringify({ type: 'Polygon', coordinates: coords });
    return JSON.stringify({ type: 'MultiPolygon', coordinates: coords.map(c => [c]) });
  };

  const handlePolygonEdited = useCallback(() => {
    // Capture current polygon paths from the map as the new base
    // We need to reverse-transform them to get "raw" base coords
    const t = lastTransformRef.current;
    const rawPaths = parseGeoJsonCoords(buildingGeojson);
    let sumLat = 0, sumLng = 0, count = 0;
    rawPaths.forEach(path => path.forEach(p => { sumLat += p.lat; sumLng += p.lng; count++; }));
    const pivotLat = count > 0 ? sumLat / count : centerLat;
    const pivotLng = count > 0 ? sumLng / count : centerLng;

    const newBasePaths: google.maps.LatLngLiteral[][] = [];
    let allCoords: google.maps.LatLngLiteral[] = [];

    buildingPolygonsRef.current.forEach(poly => {
      const path = poly.getPath();
      const coords: google.maps.LatLngLiteral[] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const pt = path.getAt(i);
        let p: google.maps.LatLngLiteral = { lat: pt.lat(), lng: pt.lng() };
        // Reverse offset
        if (t.offsetNorthM !== 0 || t.offsetEastM !== 0) p = offsetPoint(p, -t.offsetNorthM, -t.offsetEastM);
        // Reverse rotation
        if (t.rotationDeg !== 0) p = rotatePoint(p, pivotLat, pivotLng, -t.rotationDeg);
        // Reverse scale
        if (t.scaleFactor !== 1) {
          p = {
            lat: pivotLat + (p.lat - pivotLat) / t.scaleFactor,
            lng: pivotLng + (p.lng - pivotLng) / t.scaleFactor,
          };
        }
        coords.push(p);
      }
      newBasePaths.push(coords);
      allCoords = allCoords.concat(coords);
    });

    editedBasePathsRef.current = newBasePaths;

    // Also report the actual (transformed) area/perimeter
    const displayCoords: google.maps.LatLngLiteral[] = [];
    buildingPolygonsRef.current.forEach(poly => {
      const path = poly.getPath();
      for (let i = 0; i < path.getLength(); i++) {
        const pt = path.getAt(i);
        displayCoords.push({ lat: pt.lat(), lng: pt.lng() });
      }
    });
    const areaM2 = computePolygonAreaM2(displayCoords);
    const perimM = computePolygonPerimeterM(displayCoords);
    onBuildingEditedRef.current?.(areaM2, perimM);

    // Emit edited polygon GeoJSON to parent so it persists in DB.
    // We emit the RAW (reverse-transformed) base coords so saved polygon_adj
    // remains independent and does not double-apply.
    if (onBuildingGeojsonChangeRef.current && newBasePaths.length > 0) {
      selfEmitBuildingRef.current = true;
      onBuildingGeojsonChangeRef.current(ringsToGeojson(newBasePaths));
    }
  }, [buildingGeojson, centerLat, centerLng]);

  const toggleEditMode = useCallback((enable: boolean) => {
    setIsEditing(enable);
    isEditingRef.current = enable;
    buildingPolygonsRef.current.forEach(poly => {
      poly.setEditable(enable);
      poly.setDraggable(false);
      poly.setOptions({
        strokeWeight: enable ? 3.5 : 2,
        strokeOpacity: enable ? 1 : 0.9,
        fillOpacity: enable ? 0.35 : 0.25,
      });
    });
    // Clean up old listeners
    editListenersRef.current.forEach(l => google.maps.event.removeListener(l));
    editListenersRef.current = [];
    if (enable) {
      buildingPolygonsRef.current.forEach(poly => {
        const path = poly.getPath();
        const l1 = google.maps.event.addListener(path, 'set_at', () => handlePolygonEdited());
        const l2 = google.maps.event.addListener(path, 'insert_at', () => handlePolygonEdited());
        const l3 = google.maps.event.addListener(path, 'remove_at', () => handlePolygonEdited());
        editListenersRef.current.push(l1, l2, l3);
      });
    }
  }, [handlePolygonEdited]);

  // Same logic for the lot polygon — capture edited vertices, reverse-transform, emit
  const handleLotEdited = useCallback(() => {
    if (!lotGeojson) return;
    const t = lastLotTransformRef.current;
    const rawPaths = parseGeoJsonCoords(lotGeojson);
    let sumLat = 0, sumLng = 0, count = 0;
    rawPaths.forEach(path => path.forEach(p => { sumLat += p.lat; sumLng += p.lng; count++; }));
    const pivotLat = count > 0 ? sumLat / count : centerLat;
    const pivotLng = count > 0 ? sumLng / count : centerLng;

    const newBasePaths: google.maps.LatLngLiteral[][] = [];
    lotPolygonsRef.current.forEach(poly => {
      const path = poly.getPath();
      const coords: google.maps.LatLngLiteral[] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const pt = path.getAt(i);
        let p: google.maps.LatLngLiteral = { lat: pt.lat(), lng: pt.lng() };
        if (t.offsetNorthM !== 0 || t.offsetEastM !== 0) p = offsetPoint(p, -t.offsetNorthM, -t.offsetEastM);
        if (t.rotationDeg !== 0) p = rotatePoint(p, pivotLat, pivotLng, -t.rotationDeg);
        if (t.scaleFactor !== 1) {
          p = { lat: pivotLat + (p.lat - pivotLat) / t.scaleFactor, lng: pivotLng + (p.lng - pivotLng) / t.scaleFactor };
        }
        coords.push(p);
      }
      newBasePaths.push(coords);
    });
    editedBaseLotPathsRef.current = newBasePaths;
    if (onLotGeojsonChangeRef.current && newBasePaths.length > 0) {
      selfEmitLotRef.current = true;
      onLotGeojsonChangeRef.current(ringsToGeojson(newBasePaths));
    }
  }, [lotGeojson, centerLat, centerLng]);

  const [isEditingLot, setIsEditingLot] = useState(false);
  const isEditingLotRef = useRef(false);
  const lotEditListenersRef = useRef<google.maps.MapsEventListener[]>([]);
  const toggleLotEditMode = useCallback((enable: boolean) => {
    setIsEditingLot(enable);
    isEditingLotRef.current = enable;
    lotPolygonsRef.current.forEach(poly => {
      poly.setEditable(enable);
      poly.setOptions({
        strokeWeight: enable ? 3 : 1.5,
        strokeOpacity: enable ? 1 : 0.7,
        fillOpacity: enable ? 0.22 : 0.12,
      });
    });
    lotEditListenersRef.current.forEach(l => google.maps.event.removeListener(l));
    lotEditListenersRef.current = [];
    if (enable) {
      lotPolygonsRef.current.forEach(poly => {
        const path = poly.getPath();
        const l1 = google.maps.event.addListener(path, 'set_at', () => handleLotEdited());
        const l2 = google.maps.event.addListener(path, 'insert_at', () => handleLotEdited());
        const l3 = google.maps.event.addListener(path, 'remove_at', () => handleLotEdited());
        lotEditListenersRef.current.push(l1, l2, l3);
      });
    }
  }, [handleLotEdited]);
  const toggleLotEditModeRef = useRef(toggleLotEditMode);
  useEffect(() => { toggleLotEditModeRef.current = toggleLotEditMode; }, [toggleLotEditMode]);

  const toggleEditModeRef = useRef(toggleEditMode);
  useEffect(() => { toggleEditModeRef.current = toggleEditMode; }, [toggleEditMode]);

  const measureModeRef = useRef(measureMode);
  useEffect(() => {
    measureModeRef.current = measureMode;
    // When entering/exiting measure mode, toggle polygon clickability
    // so the polygons don't swallow map clicks during annotation.
    buildingPolygonsRef.current.forEach(p => p.setOptions({ clickable: !measureMode }));
    lotPolygonsRef.current.forEach(p => p.setOptions({ clickable: !measureMode }));
    // Saved annotation polylines must never swallow measurement clicks.
    savedAnnotationsRef.current.forEach(ann => {
      ann.polylines.forEach(pl => pl.setOptions({ clickable: false }));
    });
  }, [mapReady, measureMode]);

  const drawPolygons = useCallback(() => {
    if (!mapInstance.current) return;
    // Préserve l'état d'édition à travers le redraw (un sommet déplacé déclenche
    // onLotGeojsonChange → re-render → drawPolygons ; sans cette préservation,
    // l'utilisateur devrait recliquer sur le crayon après chaque déplacement).
    const wasEditingBuilding = isEditingRef.current;
    const wasEditingLot = isEditingLotRef.current;
    clearPolygons();
    setIsEditing(false);
    isEditingRef.current = false;
    setIsEditingLot(false);
    isEditingLotRef.current = false;

    if (lotGeojson) {
      const originalLotPaths = parseGeoJsonCoords(lotGeojson);
      const baseLotPaths = editedBaseLotPathsRef.current || originalLotPaths;
      let lSumLat = 0, lSumLng = 0, lCount = 0;
      originalLotPaths.forEach(path => path.forEach(p => { lSumLat += p.lat; lSumLng += p.lng; lCount++; }));
      const lotPivotLat = lCount > 0 ? lSumLat / lCount : centerLat;
      const lotPivotLng = lCount > 0 ? lSumLng / lCount : centerLng;
      lastLotTransformRef.current = { offsetEastM: lotOffsetEastM, offsetNorthM: lotOffsetNorthM, rotationDeg: lotRotationDeg, scaleFactor: lotScaleFactor };
      baseLotPaths.forEach((path) => {
        const transformedPath = path.map((point) => {
          let p = point;
          if (lotScaleFactor !== 1) p = { lat: lotPivotLat + (p.lat - lotPivotLat) * lotScaleFactor, lng: lotPivotLng + (p.lng - lotPivotLng) * lotScaleFactor };
          if (lotRotationDeg !== 0) p = rotatePoint(p, lotPivotLat, lotPivotLng, lotRotationDeg);
          if (lotOffsetNorthM !== 0 || lotOffsetEastM !== 0) p = offsetPoint(p, lotOffsetNorthM, lotOffsetEastM);
          return p;
        });
        const poly = new google.maps.Polygon({
          paths: transformedPath,
          map: mapInstance.current!,
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          strokeColor: '#60a5fa',
          strokeOpacity: 0.7,
          strokeWeight: 1.5,
          clickable: !measureModeRef.current,
          editable: false,
          zIndex: 1,
        });
        // Le clic ne déclenche PAS automatiquement l'édition.
        // L'édition est activée uniquement via le panneau « Calques » (icône crayon).
        // Suppression d'un sommet du lot via clic droit en mode édition.
        poly.addListener('rightclick', (e: google.maps.PolyMouseEvent) => {
          if (!isEditingLotRef.current) return;
          if (e.vertex === undefined || e.vertex === null) return;
          const path = poly.getPath();
          if (path.getLength() <= 3) return;
          path.removeAt(e.vertex);
        });
        // Translation d'une arête (edge drag) en mode édition.
        // Shift+mousedown sur le milieu d'un segment pour déplacer toute la ligne
        // tout en gardant les sommets adjacents connectés.
        poly.addListener('mousedown', (e: google.maps.PolyMouseEvent) => {
          if (!isEditingLotRef.current) return;
          // Only trigger on edge midpoint handle OR when shift is held on the edge
          const domEvt = (e as any).domEvent as MouseEvent | undefined;
          const isShift = !!(domEvt && domEvt.shiftKey);
          // edge index is provided when clicking the ghost midpoint handle
          let edgeIdx: number | undefined = (e as any).edge;
          const path = poly.getPath();
          if (edgeIdx === undefined && isShift && e.latLng) {
            // find closest edge to click point
            const click = e.latLng;
            let best = -1;
            let bestDist = Infinity;
            const n = path.getLength();
            for (let i = 0; i < n; i++) {
              const a = path.getAt(i);
              const b = path.getAt((i + 1) % n);
              // approximate distance from click to segment in lat/lng units
              const ax = a.lng(), ay = a.lat();
              const bx = b.lng(), by = b.lat();
              const px = click.lng(), py = click.lat();
              const dx = bx - ax, dy = by - ay;
              const len2 = dx * dx + dy * dy || 1e-12;
              let t = ((px - ax) * dx + (py - ay) * dy) / len2;
              t = Math.max(0, Math.min(1, t));
              const cx = ax + t * dx, cy = ay + t * dy;
              const d = (px - cx) ** 2 + (py - cy) ** 2;
              if (d < bestDist) { bestDist = d; best = i; }
            }
            if (best >= 0) edgeIdx = best;
          }
          if (edgeIdx === undefined || !e.latLng) return;
          const n = path.getLength();
          const i1 = edgeIdx;
          const i2 = (edgeIdx + 1) % n;
          const startA = path.getAt(i1);
          const startB = path.getAt(i2);
          const startClick = e.latLng;
          const map = mapInstance.current!;
          const prevDraggable = map.get('draggable');
          map.setOptions({ draggable: false });
          // Temporarily disable polygon edit handles to avoid conflicts
          poly.setEditable(false);

          const moveListener = google.maps.event.addListener(map, 'mousemove', (ev: google.maps.MapMouseEvent) => {
            if (!ev.latLng) return;
            const dLat = ev.latLng.lat() - startClick.lat();
            const dLng = ev.latLng.lng() - startClick.lng();
            path.setAt(i1, new google.maps.LatLng(startA.lat() + dLat, startA.lng() + dLng));
            path.setAt(i2, new google.maps.LatLng(startB.lat() + dLat, startB.lng() + dLng));
          });
          const upListener = google.maps.event.addListenerOnce(map, 'mouseup', () => {
            google.maps.event.removeListener(moveListener);
            map.setOptions({ draggable: prevDraggable !== false });
            poly.setEditable(true);
            handleLotEdited();
          });
          lotEditListenersRef.current.push(moveListener, upListener);
        });
        // Labels au centre de chaque segment (longueur en pieds, mis à jour
        // automatiquement quand on déplace / ajoute / supprime un sommet).
        const labelHandle = createEdgeLengthLabels(poly, mapInstance.current!);
        lotEdgeLabelsRef.current.push(labelHandle);
        lotPolygonsRef.current.push(poly);
      });
    }

    const originalPaths = parseGeoJsonCoords(buildingGeojson);
    // Use edited base paths if user has manually moved vertices, otherwise use original
    const basePaths = editedBasePathsRef.current || originalPaths;
    
    // Compute pivot from ORIGINAL paths (stable reference point)
    let sumLat = 0, sumLng = 0, count = 0;
    originalPaths.forEach(path => path.forEach(p => { sumLat += p.lat; sumLng += p.lng; count++; }));
    const pivotLat = count > 0 ? sumLat / count : centerLat;
    const pivotLng = count > 0 ? sumLng / count : centerLng;

    // Save current transform so we can reverse it later
    lastTransformRef.current = { offsetEastM, offsetNorthM, rotationDeg, scaleFactor };

    const allTransformedCoords: google.maps.LatLngLiteral[] = [];

    basePaths.forEach((path) => {
      const transformedPath = path.map((point) => {
        let p = point;
        if (scaleFactor !== 1) {
          p = {
            lat: pivotLat + (p.lat - pivotLat) * scaleFactor,
            lng: pivotLng + (p.lng - pivotLng) * scaleFactor,
          };
        }
        if (rotationDeg !== 0) p = rotatePoint(p, pivotLat, pivotLng, rotationDeg);
        if (offsetNorthM !== 0 || offsetEastM !== 0) p = offsetPoint(p, offsetNorthM, offsetEastM);
        return p;
      });
      allTransformedCoords.push(...transformedPath);
      const poly = new google.maps.Polygon({
        paths: transformedPath,
        map: mapInstance.current!,
        fillColor: '#f59e0b',
        fillOpacity: 0.25,
        strokeColor: '#f59e0b',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        clickable: !measureModeRef.current,
        editable: false,
        zIndex: 2,
      });
      // Le clic ne déclenche PAS automatiquement l'édition.
      // L'édition est activée uniquement via le panneau « Calques » (icône crayon).
      // Suppression d'un sommet : clic droit (desktop) ou appui long (mobile) sur un point en mode édition.
      poly.addListener('rightclick', (e: google.maps.PolyMouseEvent) => {
        if (!isEditingRef.current) return;
        if (e.vertex === undefined || e.vertex === null) return;
        const path = poly.getPath();
        if (path.getLength() <= 3) return; // un polygone doit garder au moins 3 sommets
        path.removeAt(e.vertex);
      });
      buildingPolygonsRef.current.push(poly);
    });

    // Recalculate surface/perimeter after transform
    if (onBuildingEditedRef.current && allTransformedCoords.length > 0) {
      const areaM2 = computePolygonAreaM2(allTransformedCoords);
      const perimM = computePolygonPerimeterM(allTransformedCoords);
      onBuildingEditedRef.current(areaM2, perimM);
    }

    // Réactive l'édition après le redraw si elle était active avant.
    // Sans cela, déplacer un sommet redessine le polygone et coupe l'édition.
    if (wasEditingBuilding) toggleEditModeRef.current(true);
    if (wasEditingLot) toggleLotEditModeRef.current(true);
  }, [buildingGeojson, lotGeojson, clearPolygons, offsetEastM, offsetNorthM, rotationDeg, scaleFactor, lotOffsetEastM, lotOffsetNorthM, lotRotationDeg, lotScaleFactor, centerLat, centerLng]);

  // Toggle lot/building visibility
  useEffect(() => {
    lotPolygonsRef.current.forEach(p => p.setVisible(showLot));
    lotEdgeLabelsRef.current.forEach(l => l.setVisible(showLot));
  }, [showLot]);
  useEffect(() => {
    buildingPolygonsRef.current.forEach(p => p.setVisible(showBuilding));
  }, [showBuilding]);

  // Init map
  useEffect(() => {
    let cancelled = false;
    if (!mapRef.current) return;

    ensureGoogleMapsScript().then(() => {
      if (cancelled || !mapRef.current || !hasGoogleMaps()) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: centerLat, lng: centerLng },
        zoom,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        zoomControl: false,
        gestureHandling: 'none',
        tilt: 0,
        draggable: false,
        scrollwheel: false,
        disableDoubleClickZoom: true,
        keyboardShortcuts: false,
        maxZoom: 28,
        scaleControl: true,
      });

      mapInstance.current = map;
      setMapReady(true);
    }).catch((error) => {
      console.error('[BuildingReadOnlyMap] Google Maps failed to load:', error);
    });

    return () => {
      cancelled = true;
      setMapReady(false);
      clearPolygons();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;
    const m = mapInstance.current;
    const c = m.getCenter();
    const z = m.getZoom();
    // Évite les boucles : ne réapplique le centre/zoom que s'il diffère sensiblement
    // de l'état courant de la carte (évite d'écraser un pan/zoom utilisateur juste
    // remonté via onViewChange → parent → props).
    const sameCenter = c && Math.abs(c.lat() - centerLat) < 1e-7 && Math.abs(c.lng() - centerLng) < 1e-7;
    const sameZoom = z != null && Math.abs(z - zoom) < 0.01;
    if (!sameCenter) m.setCenter({ lat: centerLat, lng: centerLng });
    if (!sameZoom) m.setZoom(zoom);
  }, [mapReady, centerLat, centerLng, zoom]);

  // Persistance de la vue : notifie le parent à chaque fin de pan/zoom.
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => { onViewChangeRef.current = onViewChange; }, [onViewChange]);
  useEffect(() => {
    const m = mapInstance.current;
    if (!m) return;
    const fire = () => {
      const c = m.getCenter();
      const z = m.getZoom();
      if (!c || z == null) return;
      onViewChangeRef.current?.({ centerLat: c.lat(), centerLng: c.lng(), zoom: z });
    };
    const l1 = m.addListener('idle', fire);
    return () => { google.maps.event.removeListener(l1); };
  }, [mapReady]);

  // ───────────────────────────────────────────────────────────────────────────
  // Couche Orthophoto Québec (WMTS officiel — geoegl.msp.gouv.qc.ca)
  // Implémentée comme google.maps.ImageMapType pour préserver TOUS les overlays
  // (polygones, marqueurs, mesures) — seul le fond raster change.
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current || !hasGoogleMaps()) return;
    const map = mapInstance.current;

    // 1) Fond satellite Google : actif si showGoogleSatellite, sinon fond neutre.
    map.setMapTypeId(showGoogleSatellite ? 'satellite' : 'roadmap');

    // 2) Couche orthophoto QC en overlay (peut se superposer au satellite OU
    //    être seule sur fond neutre).
    map.overlayMapTypes.clear();
    if (showOrthoQC) {
      if (!qcMapTypeRef.current) {
        // WMTS Québec — couche "orthos" (mosaïque orthophotos provinciale)
        // TileMatrixSet « EPSG_3857 » = Web Mercator standard (compatible XYZ Google).
        // Endpoint vérifié via GetCapabilities — extension .jpeg (le .jpg renvoie 404).
        // https://geoegl.msp.gouv.qc.ca/carto/wmts/1.0.0/orthos/default/EPSG_3857/{z}/{y}/{x}.jpeg
        const qcLayer = new google.maps.ImageMapType({
          name: 'Orthophoto QC',
          tileSize: new google.maps.Size(256, 256),
          minZoom: 0,
          maxZoom: 21,
          getTileUrl: (coord, z) => {
            if (z < 0 || z > 21) return '';
            return `https://geoegl.msp.gouv.qc.ca/carto/wmts/1.0.0/orthos/default/EPSG_3857/${z}/${coord.y}/${coord.x}.jpeg`;
          },
        });
        // Détection d'erreur réseau discrète (premier échec → message d'avertissement)
        google.maps.event.addListener(qcLayer, 'tileloaderror' as any, () => setQcError(true));
        qcMapTypeRef.current = qcLayer;
      }
      map.overlayMapTypes.insertAt(0, qcMapTypeRef.current);
      setQcError(false);
    }
  }, [mapReady, showGoogleSatellite, showOrthoQC]);

  // Échelle dynamique : recalcule à chaque changement de zoom/centre
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const NICE_METERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const NICE_FEET = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5280, 10560];
    const FT_PER_M = 3.28084;
    const TARGET_PX = 100; // largeur cible de la barre d'échelle

    const recompute = () => {
      const center = map.getCenter();
      const z = map.getZoom();
      if (!center || z == null) return;
      // Mètres par pixel à la latitude courante (projection Web Mercator)
      const metersPerPx =
        (156543.03392 * Math.cos((center.lat() * Math.PI) / 180)) / Math.pow(2, z);
      const targetMeters = metersPerPx * TARGET_PX;
      // En contexte québécois on affiche en pieds (cohérent avec le reste de l'UI)
      const targetFeet = targetMeters * FT_PER_M;
      const niceFt = NICE_FEET.reduce((p, c) =>
        Math.abs(c - targetFeet) < Math.abs(p - targetFeet) ? c : p
      , NICE_FEET[0]);
      const widthPx = (niceFt / FT_PER_M) / metersPerPx;
      const label =
        niceFt >= 5280 ? `${(niceFt / 5280).toFixed(niceFt % 5280 === 0 ? 0 : 1)} mi` : `${niceFt} pi`;
      setScale({ label, widthPx });
    };

    recompute();
    const l1 = map.addListener('zoom_changed', recompute);
    const l2 = map.addListener('center_changed', recompute);
    const l3 = map.addListener('idle', recompute);
    return () => {
      l1.remove();
      l2.remove();
      l3.remove();
    };
  }, [mapReady, showGoogleSatellite, showOrthoQC]);

  useEffect(() => {
    drawPolygons();
  }, [mapReady, drawPolygons]);

  // Restore saved annotations from initialAnnotations once the map instance exists.
  // mapInstance is a ref, so mapReady forces this effect to re-run after init.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !mapReady || !mapInstance.current || !initialAnnotations?.length) return;
    restoredRef.current = true;
    const map = mapInstance.current;

    initialAnnotations.forEach(ann => {
      const color = mergedColors[ann.target] || '#22c55e';
      const isCounter = mergedToolTypes[ann.target] === 'Compteur';
      const shapeName = mergedMarkerShapes[ann.target] || 'circle';
      const shapeInfo = SHAPE_PATHS[shapeName] || SHAPE_PATHS.circle;
      const savedPolylines: google.maps.Polyline[] = [];
      const savedMarkers: google.maps.Marker[] = [];

      if (isCounter && ann.markerPositions?.length) {
        ann.markerPositions.forEach((pos, idx) => {
          const iconPath = shapeInfo.builtIn ? google.maps.SymbolPath.CIRCLE : shapeInfo.path;
          const marker = new google.maps.Marker({
            position: pos, map,
            icon: { path: iconPath, fillColor: color, fillOpacity: 0.85, strokeColor: '#fff', strokeWeight: 2, scale: shapeInfo.builtIn ? 10 : 8, anchor: new google.maps.Point(0, 0), labelOrigin: new google.maps.Point(0, 0) },
            label: { text: String(idx + 1), color: '#fff', fontSize: '10px', fontWeight: '700' },
            zIndex: 999, clickable: false,
          });
          savedMarkers.push(marker);
        });
      } else if (ann.segments?.length) {
        ann.segments.forEach(seg => {
          if (seg.length >= 2) {
            const pl = new google.maps.Polyline({ path: seg, map, strokeColor: color, strokeOpacity: 1, strokeWeight: 3, zIndex: 998, clickable: false });
            savedPolylines.push(pl);
          }
          if (hideMeasureVertexMarkers) return;
          seg.forEach(pt => {
            const marker = new google.maps.Marker({
              position: pt, map,
              icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 6 },
              zIndex: 999, clickable: false,
            });
            savedMarkers.push(marker);
          });
        });
      }

      // Place label
      const labelText = isCounter
        ? `${mergedLabels[ann.target] || ann.target} ×${ann.feet}`
        : `${mergedLabels[ann.target] || ann.target} ${ann.feet} pi`;
      const labelPos = isCounter
        ? (savedMarkers.length > 0 ? savedMarkers[savedMarkers.length - 1].getPosition()?.toJSON() : null)
        : (ann.segments?.flat().slice(-1)[0] || null);

      let persistentLabel: google.maps.InfoWindow | null = null;
      if (labelPos) {
        persistentLabel = new google.maps.InfoWindow({
          content: `<div style="font-weight:700;font-size:9px;color:${color};white-space:nowrap;background:rgba(0,0,0,0.75);padding:1px 5px;border-radius:3px;pointer-events:none">${labelText}</div>`,
          position: labelPos, disableAutoPan: true, pixelOffset: new google.maps.Size(0, -12),
        });
        persistentLabel.open(map);
      }

      savedAnnotationsRef.current.push({ target: ann.target, feet: ann.feet, polylines: savedPolylines, markers: savedMarkers, label: persistentLabel, visible: ann.visible !== false });
    });

    setSavedAnnotations(savedAnnotationsRef.current.map(a => ({ target: a.target, feet: a.feet, visible: a.visible })));
  }, [mapReady, initialAnnotations, mergedColors, mergedLabels, mergedToolTypes, mergedMarkerShapes]);


  useEffect(() => {
    if (!mapInstance.current) return;
    const map = mapInstance.current;
    // L'édition reste active jusqu'à ce que l'utilisateur clique explicitement
    // sur « Terminer » ou sur l'icône crayon. Un simple clic carte ne doit
    // PAS la désactiver (sinon chaque drag de sommet la coupe).
    const listener = map.addListener('click', () => {
      // no-op — désactivation explicite uniquement
    });
    return () => google.maps.event.removeListener(listener);
  }, []);

  // ── Measure mode logic ──
  const clearMeasure = useCallback(() => {
    if (pendingClickRef.current) {
      clearTimeout(pendingClickRef.current);
      pendingClickRef.current = null;
    }
    measureMarkersRef.current.forEach(m => m.setMap(null));
    measureMarkersRef.current = [];
    measurePolylinesRef.current.forEach(p => p.setMap(null));
    measurePolylinesRef.current = [];
    measureLabelRef.current?.close();
    measureLabelRef.current = null;
    measureSegmentsRef.current = [[]];
    setMeasureTotal(0);
    setSegmentCount(1);
    if (clickListenerRef.current) {
      google.maps.event.removeListener(clickListenerRef.current);
      clickListenerRef.current = null;
    }
    if (dblClickListenerRef.current) {
      google.maps.event.removeListener(dblClickListenerRef.current);
      dblClickListenerRef.current = null;
    }
  }, []);

  const computeSegmentLength = useCallback((points: google.maps.LatLngLiteral[]) => {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversineFeet(points[i - 1], points[i]);
    }
    return total;
  }, []);

  const computeAllTotal = useCallback((segments: google.maps.LatLngLiteral[][]) => {
    return segments.reduce((sum, seg) => sum + computeSegmentLength(seg), 0);
  }, [computeSegmentLength]);

  useEffect(() => {
    if (!mapInstance.current) return;
    const map = mapInstance.current;

    if (!measureMode) {
      // Exiting measure mode
      clearMeasure();
      map.setOptions({ gestureHandling: 'none', draggable: false, scrollwheel: false });
      return;
    }

    // Entering measure mode - flash green
    setFlashGreen(true);
    const flashTimer = setTimeout(() => setFlashGreen(false), 800);

    const activeColor = mergedColors[measureMode] || '#22c55e';
    const isCounter = mergedToolTypes[measureMode] === 'Compteur';
    const shapeKey = mergedMarkerShapes[measureMode] || 'circle';
    const shapeInfo = SHAPE_PATHS[shapeKey] || SHAPE_PATHS.circle;

    // Enable interactions for measuring
    map.setOptions({ gestureHandling: 'greedy', draggable: true, scrollwheel: true });
    clearMeasure();

    if (isCounter) {
      // ── Counter mode: each click places a marker, total = count ──
      let counterCount = 0;
      const handleCounterClick = (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        counterCount++;
        const currentNum = counterCount;
        const iconPath = shapeInfo.builtIn ? google.maps.SymbolPath.CIRCLE : shapeInfo.path;
        const marker = new google.maps.Marker({
          position: point,
          map,
          icon: {
            path: iconPath,
            fillColor: activeColor,
            fillOpacity: 0.85,
            strokeColor: '#fff',
            strokeWeight: 2,
            scale: shapeInfo.builtIn ? 10 : 8,
            anchor: new google.maps.Point(0, 0),
            labelOrigin: new google.maps.Point(0, 0),
          },
          label: {
            text: String(currentNum),
            color: '#fff',
            fontSize: '10px',
            fontWeight: '700',
          },
          zIndex: 999,
          clickable: false,
        });
        measureMarkersRef.current.push(marker);
        setMeasureTotal(measureMarkersRef.current.length);
      };

      const listener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (pendingClickRef.current) clearTimeout(pendingClickRef.current);
        pendingClickRef.current = setTimeout(() => {
          handleCounterClick(e);
          pendingClickRef.current = null;
        }, 250);
      });
      clickListenerRef.current = listener;

      // Double-click to undo last marker
      const dblListener = map.addListener('dblclick', (e: google.maps.MapMouseEvent) => {
        e.stop();
        if (pendingClickRef.current) { clearTimeout(pendingClickRef.current); pendingClickRef.current = null; }
        const last = measureMarkersRef.current.pop();
        if (last) last.setMap(null);
        counterCount = measureMarkersRef.current.length;
        // Renumber remaining markers
        measureMarkersRef.current.forEach((mk, i) => mk.setLabel({ text: String(i + 1), color: '#fff', fontSize: '9px', fontWeight: '700' }));
        setMeasureTotal(measureMarkersRef.current.length);
      });
      dblClickListenerRef.current = dblListener;

    } else {
      // ── Line / Multi-segment / Surface / Périmètre mode ──
      const handleMeasureClick = (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        const segments = measureSegmentsRef.current;
        const currentSeg = segments[segments.length - 1];
        currentSeg.push(point);

        const marker = new google.maps.Marker({
          position: point,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: activeColor,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
            scale: 6,
          },
          zIndex: 999,
          clickable: false,
          visible: !hideMeasureVertexMarkers,
        });
        measureMarkersRef.current.push(marker);

        const segIdx = segments.length - 1;
        if (measurePolylinesRef.current[segIdx]) {
          measurePolylinesRef.current[segIdx].setPath(currentSeg);
        } else if (currentSeg.length >= 2) {
          const polyline = new google.maps.Polyline({
            path: currentSeg,
            map,
            strokeColor: activeColor,
            strokeOpacity: 1,
            strokeWeight: 3,
            zIndex: 998,
            clickable: false,
          });
          measurePolylinesRef.current[segIdx] = polyline;
        }

        const total = computeAllTotal(segments);
        setMeasureTotal(total);

        if (measureLabelRef.current) { measureLabelRef.current.close(); measureLabelRef.current = null; }
      };

      const listener = map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (pendingClickRef.current) clearTimeout(pendingClickRef.current);
        pendingClickRef.current = setTimeout(() => {
          handleMeasureClick(e);
          pendingClickRef.current = null;
        }, 250);
      });
      clickListenerRef.current = listener;

      const dblListener = map.addListener('dblclick', (e: google.maps.MapMouseEvent) => {
        e.stop();
        if (pendingClickRef.current) { clearTimeout(pendingClickRef.current); pendingClickRef.current = null; }
        measureSegmentsRef.current.push([]);
        setSegmentCount(measureSegmentsRef.current.length);
      });
      dblClickListenerRef.current = dblListener;
    }

    return () => { clearTimeout(flashTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureMode]);

  const handleZoomOut = () => {
    if (!mapInstance.current) return;
    const cur = mapInstance.current.getZoom() || zoom;
    const next = Math.max(cur - 1, 15);
    mapInstance.current.setZoom(next);
    setMeasureZoom(next);
  };

  const handleZoomIn = () => {
    if (!mapInstance.current) return;
    const cur = mapInstance.current.getZoom() || zoom;
    const next = Math.min(cur + 1, 24);
    mapInstance.current.setZoom(next);
    setMeasureZoom(next);
  };

  /** Undo the last placed point in the active measure mode. Works for counter
   *  (pop last marker, renumber) and line/multi-segment (pop last vertex,
   *  update polyline, recompute total). Safe to call when nothing is placed. */
  const handleUndoLastPoint = useCallback(() => {
    if (!measureMode) return;
    const isCounter = mergedToolTypes[measureMode] === 'Compteur';
    if (isCounter) {
      const last = measureMarkersRef.current.pop();
      if (!last) return;
      last.setMap(null);
      measureMarkersRef.current.forEach((mk, i) =>
        mk.setLabel({ text: String(i + 1), color: '#fff', fontSize: '10px', fontWeight: '700' }));
      setMeasureTotal(measureMarkersRef.current.length);
      return;
    }
    const segments = measureSegmentsRef.current;
    while (segments.length > 1 && segments[segments.length - 1].length === 0) segments.pop();
    const curSeg = segments[segments.length - 1];
    if (!curSeg || curSeg.length === 0) return;
    curSeg.pop();
    const lastMarker = measureMarkersRef.current.pop();
    if (lastMarker) lastMarker.setMap(null);
    const segIdx = segments.length - 1;
    const pl = measurePolylinesRef.current[segIdx];
    if (curSeg.length < 2) {
      if (pl) { pl.setMap(null); measurePolylinesRef.current[segIdx] = undefined as any; }
    } else if (pl) {
      pl.setPath(curSeg);
    }
    setMeasureTotal(computeAllTotal(segments));
    setSegmentCount(segments.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureMode, mergedToolTypes, computeAllTotal]);

  // Toggle d'une annotation par index — partagé entre l'UI interne et MapToolbox externe.
  const toggleAnnotationByIndex = useCallback((i: number) => {
    const ann = savedAnnotationsRef.current[i];
    if (!ann) return;
    ann.visible = !ann.visible;
    ann.polylines.forEach(p => p.setVisible(ann.visible));
    ann.markers.forEach(m => m.setVisible(ann.visible));
    if (ann.label) {
      if (ann.visible && mapInstance.current) ann.label.open(mapInstance.current);
      else ann.label.close();
    }
    setSavedAnnotations(savedAnnotationsRef.current.map(x => ({ target: x.target, feet: x.feet, visible: x.visible })));
  }, []);

  // Expose les contrôles carte (couches, basemap, zoom) à un parent externe.
  useEffect(() => {
    if (!onMapToolboxControlsReady) return;
    onMapToolboxControlsReady({
      hasLot: !!lotGeojson,
      showLot,
      toggleLot: () => setShowLot(v => !v),
      isEditingLot,
      toggleLotEdit: () => { if (!showLot) setShowLot(true); toggleLotEditMode(!isEditingLot); },
      showBuilding,
      toggleBuilding: () => setShowBuilding(v => !v),
      isEditingBuilding: isEditing,
      toggleBuildingEdit: () => { if (!showBuilding) setShowBuilding(true); toggleEditMode(!isEditing); },
      annotations: savedAnnotations.map(a => ({
        target: a.target,
        feet: a.feet,
        visible: a.visible,
        color: mergedColors[a.target] || '#22c55e',
        label: mergedLabels[a.target] || a.target,
      })),
      toggleAnnotation: toggleAnnotationByIndex,
      showGoogleSatellite,
      toggleGoogleSatellite: () => setShowGoogleSatellite(v => !v),
      showOrthoQC,
      toggleOrthoQC: () => setShowOrthoQC(v => !v),
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
      extraLayers: (extraPolylines || []).map(p => ({
        id: p.id, label: p.label, color: p.color, visible: p.visible,
      })),
      toggleExtraLayer: (id: string) => onToggleExtraPolyline?.(id),
      getCaptureParams: () => {
        const map = mapInstance.current;
        if (!map) return null;
        const c = map.getCenter();
        const z = map.getZoom();
        const b = map.getBounds();
        const div = mapRef.current;
        if (!c || z == null || !b || !div) return null;
        const ne = b.getNorthEast();
        const sw = b.getSouthWest();
        return {
          centerLat: c.lat(),
          centerLng: c.lng(),
          zoom: z,
          width: div.clientWidth,
          height: div.clientHeight,
          bounds: { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() },
          // Ortho QC est inséré en overlayMapTypes.insertAt(0, ...) → toujours
          // au-dessus du basemap satellite. Donc s'il est visible, c'est lui
          // le calque "en avant" en Z.
          topLayer: showOrthoQC ? 'ortho' : 'google',
          showGoogleSatellite,
          showOrthoQC,
        };
      },
    });
  }, [
    onMapToolboxControlsReady, lotGeojson, showLot, isEditingLot, showBuilding, isEditing,
    savedAnnotations, showGoogleSatellite, showOrthoQC, mergedColors, mergedLabels, toggleAnnotationByIndex,
    toggleLotEditMode, toggleEditMode, extraPolylines, onToggleExtraPolyline,
  ]);

  // ── Rendu des polylignes extra (skeleton, etc.) ──
  // Recrée à chaque changement de paths/visibility/color. Simple et suffisant
  // pour les volumes attendus (<100 segments).
  const extraPolyInstancesRef = useRef<google.maps.Polyline[]>([]);
  useEffect(() => {
    if (!mapInstance.current) return;
    extraPolyInstancesRef.current.forEach(p => p.setMap(null));
    extraPolyInstancesRef.current = [];
    if (!extraPolylines?.length) return;
    for (const layer of extraPolylines) {
      if (!layer.visible) continue;
      for (const path of layer.paths) {
        const pl = new google.maps.Polyline({
          path,
          map: mapInstance.current,
          strokeColor: layer.color,
          strokeOpacity: 1,
          strokeWeight: layer.weight ?? 3,
          zIndex: 1500,
        });
        extraPolyInstancesRef.current.push(pl);
      }
    }
    return () => {
      extraPolyInstancesRef.current.forEach(p => p.setMap(null));
      extraPolyInstancesRef.current = [];
    };
  }, [mapReady, extraPolylines]);

  const handleConfirmMeasure = () => {
    if (measureMode && measureTotal > 0 && onMeasureComplete) {
      const color = mergedColors[measureMode] || '#22c55e';
      const isCounter = mergedToolTypes[measureMode] === 'Compteur';
      const savedPolylines: google.maps.Polyline[] = [];
      const savedMarkers: google.maps.Marker[] = [];

      measurePolylinesRef.current.forEach(pl => {
        if (pl) savedPolylines.push(pl);
      });
      measureMarkersRef.current.forEach(mk => {
        savedMarkers.push(mk);
      });

      // Place a persistent label
      let persistentLabel: google.maps.InfoWindow | null = null;
      const labelText = isCounter
        ? `${mergedLabels[measureMode]} ×${Math.round(measureTotal)}`
        : `${mergedLabels[measureMode]} ${measureTotal.toFixed(0)} pi`;

      // For counter, use last marker position; for lines, use last point of segments
      const labelPos = isCounter
        ? (savedMarkers.length > 0 ? savedMarkers[savedMarkers.length - 1].getPosition()?.toJSON() : null)
        : measureSegmentsRef.current.flat().slice(-1)[0] || null;

      if (labelPos && mapInstance.current) {
        persistentLabel = new google.maps.InfoWindow({
          content: `<div style="font-weight:700;font-size:9px;color:${color};white-space:nowrap;background:rgba(0,0,0,0.75);padding:1px 5px;border-radius:3px;pointer-events:none">${labelText}</div>`,
          position: labelPos,
          disableAutoPan: true,
          pixelOffset: new google.maps.Size(0, -12),
        });
        persistentLabel.open(mapInstance.current);
      }

      savedAnnotationsRef.current.push({
        target: measureMode,
        feet: Math.round(measureTotal),
        polylines: savedPolylines,
        markers: savedMarkers,
        label: persistentLabel,
        visible: true,
      });
      emitAnnotations();

      measurePolylinesRef.current = [];
      measureMarkersRef.current = [];
      if (measureLabelRef.current) { measureLabelRef.current.close(); measureLabelRef.current = null; }
      measureSegmentsRef.current = [[]];
      setMeasureTotal(0);
      setSegmentCount(1);
      if (clickListenerRef.current) { google.maps.event.removeListener(clickListenerRef.current); clickListenerRef.current = null; }
      if (dblClickListenerRef.current) { google.maps.event.removeListener(dblClickListenerRef.current); dblClickListenerRef.current = null; }

      onMeasureComplete(measureMode, Math.round(measureTotal));
    }
  };

  const handleCancelMeasure = () => {
    clearMeasure();
    onMeasureCancel?.();
  };

  // Sync annotations list to parent
  const emitAnnotations = useCallback(() => {
    const list = savedAnnotationsRef.current.map((a, i) => {
      // Extract coordinates from polylines
      const segments: google.maps.LatLngLiteral[][] = a.polylines.map(pl => {
        const path = pl.getPath();
        const coords: google.maps.LatLngLiteral[] = [];
        for (let j = 0; j < path.getLength(); j++) {
          const pt = path.getAt(j);
          coords.push({ lat: pt.lat(), lng: pt.lng() });
        }
        return coords;
      });
      // Extract marker positions
      const markerPositions: google.maps.LatLngLiteral[] = a.markers.map(mk => {
        const pos = mk.getPosition();
        return pos ? { lat: pos.lat(), lng: pos.lng() } : { lat: 0, lng: 0 };
      }).filter(p => p.lat !== 0 || p.lng !== 0);
      return { target: a.target, feet: a.feet, visible: a.visible, index: i, segments, markerPositions };
    });
    setSavedAnnotations(list.map(a => ({ target: a.target, feet: a.feet, visible: a.visible })));
    onAnnotationsChange?.(list);
  }, [onAnnotationsChange]);

  // Handle delete from parent
  useEffect(() => {
    if (deleteAnnotationIndex == null || deleteAnnotationIndex < 0) return;
    const ann = savedAnnotationsRef.current[deleteAnnotationIndex];
    if (ann) {
      ann.polylines.forEach(p => p.setMap(null));
      ann.markers.forEach(m => m.setMap(null));
      ann.label?.close();
      savedAnnotationsRef.current.splice(deleteAnnotationIndex, 1);
      emitAnnotations();
    }
    onDeleteAnnotationDone?.();
  }, [deleteAnnotationIndex, emitAnnotations, onDeleteAnnotationDone]);

  // Handle clear all from parent
  useEffect(() => {
    if (!clearAllAnnotations) return;
    savedAnnotationsRef.current.forEach(a => {
      a.polylines.forEach(p => p.setMap(null));
      a.markers.forEach(m => m.setMap(null));
      a.label?.close();
    });
    savedAnnotationsRef.current = [];
    emitAnnotations();
    onClearAllAnnotationsDone?.();
  }, [clearAllAnnotations, emitAnnotations, onClearAllAnnotationsDone]);

  // Keep saved annotations when buildingGeojson changes. The parent can re-send
  // the same/new polygon during async hydration or Training Lab recovery; wiping
  // annotations here can erase visible take-off layers before the user saves.
  // Explicit deletion remains handled by deleteAnnotationIndex / clearAllAnnotations.
  const buildingGeojsonMountRef = useRef(true);
  useEffect(() => {
    if (buildingGeojsonMountRef.current) { buildingGeojsonMountRef.current = false; return; }
    // If this geojson change came from our own polygon-edit emit, do NOT wipe annotations
    // and do NOT clear the editedBasePathsRef (the new geojson IS the edited shape).
    if (selfEmitBuildingRef.current) {
      selfEmitBuildingRef.current = false;
      // The new buildingGeojson now equals our edited shape, so we drop the local override.
      editedBasePathsRef.current = null;
      return;
    }
    editedBasePathsRef.current = null;
    restoredRef.current = false;
  }, [buildingGeojson]);

  // Same protection for the lot polygon
  const lotGeojsonMountRef = useRef(true);
  useEffect(() => {
    if (lotGeojsonMountRef.current) { lotGeojsonMountRef.current = false; return; }
    if (selfEmitLotRef.current) {
      selfEmitLotRef.current = false;
      editedBaseLotPathsRef.current = null;
      return;
    }
    editedBaseLotPathsRef.current = null;
  }, [lotGeojson]);

  // ── Sync image overlays (ground overlays) ─────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !(window as any).google?.maps) return;
    const desired = imageOverlays || [];
    const current = overlayInstancesRef.current;
    // Stratégie : pour garantir le Z-order (les GroundOverlay s'empilent dans
    // l'ordre d'ajout à la carte), on retire TOUTES les overlays puis on les
    // ré-ajoute dans l'ordre du tableau `desired`. Coût négligeable (≤ 5 overlays).
    for (const [, entry] of current.entries()) {
      try { entry.overlay.setMap(null); } catch { /* ignore */ }
    }
    current.clear();
    desired.forEach((o, index) => {
      // Tous les calques IA (capture, enhanced, polygone rasterisé) sont placés
      // dans `mapPane` (la couche la plus basse de Google Maps) afin qu'ils
      // restent visibles MAIS DERRIÈRE les polygones natifs de lot/bâtiment,
      // pour que l'utilisateur puisse continuer à éditer ces polygones.
      const ov = createImagePaneOverlay(o.url, o.bounds, o.opacity ?? 1, 40 + index, 'mapPane');
      ov.setMap(o.visible ? map : null);
      current.set(o.id, { overlay: ov, url: o.url, bounds: o.bounds });
    });
    return () => { /* keep overlays across re-renders */ };
  }, [mapReady, imageOverlays]);

  // Cleanup on unmount
  useEffect(() => () => {
    clearMeasure();
    savedAnnotationsRef.current.forEach(a => {
      a.polylines.forEach(p => p.setMap(null));
      a.markers.forEach(m => m.setMap(null));
      a.label?.close();
    });
    savedAnnotationsRef.current = [];
    extraPolyInstancesRef.current.forEach(p => p.setMap(null));
    extraPolyInstancesRef.current = [];
    overlayInstancesRef.current.forEach(({ overlay }) => {
      try { overlay.setMap(null); } catch { /* ignore */ }
    });
    overlayInstancesRef.current.clear();
  }, [clearMeasure]);

  const borderStyle = measureMode
    ? flashGreen
      ? '3px solid #22c55e'
      : '3px solid rgba(34,197,94,0.5)'
    : undefined;

  return (
    <motion.div
      className={s.satelliteBlock}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      style={borderStyle ? { border: borderStyle, borderRadius: 14, transition: 'border 0.3s ease' } : undefined}
    >
      <div className={s.satelliteWrap}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} className={measureMode ? 'measure-cursor-active' : ''} />
        {measureMode && isMobile && (
          <MobilePrecisionLayer
            getMap={() => mapInstance.current}
            getContainer={() => mapRef.current}
            color={mergedColors[measureMode] || '#22c55e'}
            onPrecisePlace={(latLng) => {
              const map = mapInstance.current;
              if (!map || !window.google?.maps) return;
              const ll = new google.maps.LatLng(latLng.lat, latLng.lng);
              // Fire the existing click listener with a synthetic event.
              google.maps.event.trigger(map, 'click', {
                latLng: ll,
                stop: () => {},
              } as any);
            }}
            onPreciseDouble={(latLng) => {
              const map = mapInstance.current;
              if (!map || !window.google?.maps) return;
              const ll = new google.maps.LatLng(latLng.lat, latLng.lng);
              google.maps.event.trigger(map, 'dblclick', {
                latLng: ll,
                stop: () => {},
              } as any);
            }}
          />
        )}
        <style>{`
          .measure-cursor-active, .measure-cursor-active * {
            cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><circle cx='20' cy='20' r='13' fill='none' stroke='white' stroke-width='2.5'/><circle cx='20' cy='20' r='13' fill='none' stroke='%23${((mergedColors[measureMode || ''] || '#00d4ff').replace('#',''))}' stroke-width='1.5'/><line x1='20' y1='2' x2='20' y2='14' stroke='white' stroke-width='2.5'/><line x1='20' y1='2' x2='20' y2='14' stroke='%23${((mergedColors[measureMode || ''] || '#00d4ff').replace('#',''))}' stroke-width='1.5'/><line x1='20' y1='26' x2='20' y2='38' stroke='white' stroke-width='2.5'/><line x1='20' y1='26' x2='20' y2='38' stroke='%23${((mergedColors[measureMode || ''] || '#00d4ff').replace('#',''))}' stroke-width='1.5'/><line x1='2' y1='20' x2='14' y2='20' stroke='white' stroke-width='2.5'/><line x1='2' y1='20' x2='14' y2='20' stroke='%23${((mergedColors[measureMode || ''] || '#00d4ff').replace('#',''))}' stroke-width='1.5'/><line x1='26' y1='20' x2='38' y2='20' stroke='white' stroke-width='2.5'/><line x1='26' y1='20' x2='38' y2='20' stroke='%23${((mergedColors[measureMode || ''] || '#00d4ff').replace('#',''))}' stroke-width='1.5'/><circle cx='20' cy='20' r='1.5' fill='%23${((mergedColors[measureMode || ''] || '#00d4ff').replace('#',''))}'/></svg>") 20 20, crosshair !important;
          }
          .gm-style-iw-c { background: none !important; box-shadow: none !important; padding: 0 !important; border-radius: 0 !important; }
          .gm-style-iw-d { overflow: visible !important; }
          .gm-style-iw-tc { display: none !important; }
          .gm-style-iw-chr { display: none !important; }
          button.gm-ui-hover-effect { display: none !important; }
        `}</style>

        {/* Échelle dynamique (toujours visible, fonctionne avec Google ET Orthophoto QC) */}
        {scale && !(measureMode && isMobile) && (
          <div
            aria-label="Échelle de la carte"
            style={{
              position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
              background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
              padding: '4px 8px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 2, pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            }}
          >
            <span style={{ fontSize: 10, color: '#e5e7eb', fontWeight: 600, lineHeight: 1 }}>
              {scale.label}
            </span>
            <div
              style={{
                width: Math.max(20, scale.widthPx), height: 6,
                borderLeft: '2px solid #fbbf24', borderRight: '2px solid #fbbf24',
                borderBottom: '2px solid #fbbf24',
              }}
            />
          </div>
        )}

        {/* Attribution / message d'erreur du calque Orthophoto Québec.
            Le contrôle d'activation/désactivation est désormais dans la
            MapToolbox (section « Couches »), aux côtés des polygones. */}
        {showOrthoQC && (
          <div
            style={{
              position: 'absolute', top: 10, right: 10, zIndex: 50,
              display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4,
              pointerEvents: 'none',
            }}
          >
            {!qcError ? (
              <div style={{
                fontSize: 9, color: '#e5e7eb', background: 'rgba(15,23,42,0.75)',
                padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)',
              }}>
                Orthophotos — Gouvernement du Québec
              </div>
            ) : (
              <div style={{
                fontSize: 9, color: '#fca5a5', background: 'rgba(127,29,29,0.85)',
                padding: '3px 7px', borderRadius: 4, border: '1px solid rgba(248,113,113,0.4)',
                maxWidth: 200, textAlign: 'right',
              }}>
                Orthophoto Québec non disponible pour ce secteur.
              </div>
            )}
          </div>
        )}

        {/* Measure mode overlay */}
        {measureMode && (() => {
          const isCounterMode = mergedToolTypes[measureMode] === 'Compteur';
          const activeColor = mergedColors[measureMode] || '#22c55e';
          const valueText = isCounterMode
            ? `${Math.round(measureTotal)}`
            : `${measureTotal.toFixed(1)} pi`;
          const canPlace = measureTotal > 0 || measureMarkersRef.current.length > 0;
          return (
          <>
            {/* Compact header pill (mobile) / detailed bar (desktop) */}
            {isMobile ? (
              <div style={{
                position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.85)', borderRadius: 999, padding: '6px 12px',
                display: 'inline-flex', alignItems: 'center', gap: 8, zIndex: 10,
                border: `1px solid ${activeColor}66`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                maxWidth: 'calc(100% - 96px)',
              }}>
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: activeColor, boxShadow: `0 0 6px ${activeColor}` }} />
                <span style={{ fontSize: 12, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
                  {mergedLabels[measureMode]}
                </span>
                {(measureTotal > 0 || isCounterMode) && (
                  <span style={{ fontSize: 13, color: activeColor, fontWeight: 800, fontFamily: 'monospace' }}>
                    {valueText}
                  </span>
                )}
              </div>
            ) : (
              <div style={{
                position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.85)', borderRadius: 10, padding: '6px 14px',
                display: 'flex', alignItems: 'center', gap: 8, zIndex: 10,
                border: '1px solid rgba(34,197,94,0.4)',
              }}>
                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>
                  {isCounterMode ? '📍' : '📐'} {mergedLabels[measureMode]}
                </span>
                {measureTotal > 0 && (
                  <span style={{ fontSize: 14, color: '#fff', fontWeight: 800, fontFamily: 'monospace' }}>
                    {valueText}
                  </span>
                )}
                {!isCounterMode && segmentCount > 1 && (
                  <span style={{ fontSize: 10, color: '#86efac', fontWeight: 600 }}>
                    ({segmentCount} segments)
                  </span>
                )}
                <span style={{ fontSize: 9, color: '#6b7280' }}>
                  {isCounterMode ? 'Double-clic = retirer dernier' : 'Double-clic = nouveau segment'}
                </span>
              </div>
            )}

            {/* Zoom controls - right side */}
            <div style={{
              position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10,
            }}>
              <button onClick={handleZoomIn} style={{
                background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
                color: '#fff', width: isMobile ? 40 : 30, height: isMobile ? 40 : 30,
                fontSize: isMobile ? 20 : 16, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>+</button>
              <button onClick={handleZoomOut} style={{
                background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
                color: '#fff', width: isMobile ? 40 : 30, height: isMobile ? 40 : 30,
                fontSize: isMobile ? 20 : 16, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>−</button>
            </div>

            {/* Bottom action bar — compact on mobile, with Undo + safe-area */}
            <div style={{
              position: 'absolute', left: 8, right: 8,
              bottom: isMobile ? 'calc(env(safe-area-inset-bottom, 0px) + 10px)' : 10,
              display: 'flex', gap: 8, zIndex: 12,
              justifyContent: 'center', alignItems: 'stretch',
              pointerEvents: 'none',
            }}>
              <button
                onClick={handleUndoLastPoint}
                disabled={!canPlace}
                aria-label="Annuler dernier point"
                style={{
                  pointerEvents: 'auto',
                  background: 'rgba(0,0,0,0.78)', border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 12, padding: isMobile ? '0 14px' : '8px 12px',
                  minHeight: isMobile ? 48 : 36, minWidth: isMobile ? 56 : 40,
                  cursor: canPlace ? 'pointer' : 'default',
                  opacity: canPlace ? 1 : 0.4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  color: '#fff', fontSize: isMobile ? 13 : 12, fontWeight: 700,
                }}
                title="Annuler dernier point"
              >
                <RotateCcw size={isMobile ? 18 : 14} />
                {!isMobile && <span>Annuler point</span>}
              </button>
              <button
                onClick={handleConfirmMeasure}
                disabled={measureTotal <= 0}
                style={{
                  pointerEvents: 'auto',
                  background: measureTotal > 0 ? '#22c55e' : 'rgba(34,197,94,0.3)',
                  border: 'none', borderRadius: 12,
                  padding: isMobile ? '0 18px' : '8px 20px',
                  minHeight: isMobile ? 48 : 36, flex: isMobile ? 1 : 'unset', maxWidth: isMobile ? 220 : undefined,
                  cursor: measureTotal > 0 ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  color: '#fff', fontSize: isMobile ? 15 : 12, fontWeight: 800,
                  boxShadow: measureTotal > 0 ? '0 6px 18px rgba(34,197,94,0.4)' : 'none',
                }}
              >
                <Check size={isMobile ? 18 : 14} />
                {isMobile ? valueText : `Confirmer (${valueText})`}
              </button>
              <button
                onClick={handleCancelMeasure}
                aria-label="Annuler"
                style={{
                  pointerEvents: 'auto',
                  background: 'rgba(248,113,113,0.18)', border: '1px solid rgba(248,113,113,0.35)',
                  borderRadius: 12, padding: isMobile ? '0 14px' : '8px 16px',
                  minHeight: isMobile ? 48 : 36, minWidth: isMobile ? 56 : 40,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  color: '#f87171', fontSize: isMobile ? 13 : 12, fontWeight: 700,
                }}
              >
                <X size={isMobile ? 18 : 14} />
                {!isMobile && <span>Annuler</span>}
              </button>
            </div>
          </>
          );
        })()}

        {!measureMode && (
          <>
            {isEditing && (
              <div style={{
                position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(245,158,11,0.95)', borderRadius: 8, padding: '6px 16px',
                display: 'flex', alignItems: 'center', gap: 8, zIndex: 12, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 'calc(100% - 16px)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}>
                <span style={{ fontSize: 11, color: '#000', fontWeight: 700 }}>
                  ✏️ Glissez les coins pour ajuster · Clic droit sur un point pour le supprimer
                </span>
                <button onClick={() => toggleEditMode(false)} style={{
                  background: 'rgba(0,0,0,0.3)', border: 'none', borderRadius: 4,
                  color: '#fff', padding: '2px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}>Terminé</button>
              </div>
            )}
            {isEditingLot && (
              <div style={{
                position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(59,130,246,0.95)', borderRadius: 8, padding: '6px 16px',
                display: 'flex', alignItems: 'center', gap: 8, zIndex: 12, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 'calc(100% - 16px)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}>
                <span style={{ fontSize: 11, color: '#fff', fontWeight: 700 }}>
                  📐 Lot : glissez les coins · Clic droit = supprimer un point · Shift + glisser une ligne = déplacer l'arête
                </span>
                <button onClick={() => toggleLotEditMode(false)} style={{
                  background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: 4,
                  color: '#fff', padding: '2px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}>Terminé</button>
              </div>
            )}
            <div className={s.addressBadge}>
              <MapPin size={12} />
              <span>{address}</span>
            </div>

            {/* Layer toggle button */}
            {!hideBuiltinMapTools && <button
              onClick={() => setShowLayerPanel(v => !v)}
              style={{
                position: 'absolute', top: 52, right: 10,
                background: showLayerPanel ? 'rgba(34,197,94,0.9)' : 'rgba(0,0,0,0.8)',
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
                color: '#fff', width: 32, height: 32, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11,
              }}
              title="Couches & annotations"
            >
              <Layers size={16} />
            </button>}

            {!hideBuiltinMapTools && showLayerPanel && (
              <div style={{
                position: 'absolute', top: 90, right: 52, background: 'rgba(0,0,0,0.92)',
                borderRadius: 10, padding: '8px 10px', zIndex: 11, border: '1px solid rgba(255,255,255,0.15)',
                minWidth: 180,
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 6 }}>Couches</div>

                {lotGeojson && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <button onClick={() => setShowLot(v => !v)} style={{
                      display: 'flex', alignItems: 'center', gap: 6, flex: 1,
                      background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0',
                    }}>
                      {showLot ? <Eye size={12} color="#60a5fa" /> : <EyeOff size={12} color="#6b7280" />}
                      <div style={{ width: 14, height: 3, borderRadius: 2, background: '#60a5fa', opacity: showLot ? 1 : 0.3 }} />
                      <span style={{ fontSize: 10, color: showLot ? '#e5e7eb' : '#6b7280', fontWeight: 600 }}>
                        Périmètre de lot
                      </span>
                    </button>
                    <button
                      onClick={() => { if (!showLot) setShowLot(true); toggleLotEditMode(!isEditingLot); }}
                      title={isEditingLot ? 'Terminer l\u2019édition du lot' : 'Éditer le lot'}
                      style={{
                        background: isEditingLot ? 'rgba(59,130,246,0.9)' : 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
                        cursor: 'pointer', padding: '3px 5px', display: 'flex', alignItems: 'center',
                      }}
                    >
                      <Pencil size={11} color={isEditingLot ? '#fff' : '#60a5fa'} />
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <button onClick={() => setShowBuilding(v => !v)} style={{
                    display: 'flex', alignItems: 'center', gap: 6, flex: 1,
                    background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0',
                  }}>
                    {showBuilding ? <Eye size={12} color="#f59e0b" /> : <EyeOff size={12} color="#6b7280" />}
                    <div style={{ width: 14, height: 3, borderRadius: 2, background: '#f59e0b', opacity: showBuilding ? 1 : 0.3 }} />
                    <span style={{ fontSize: 10, color: showBuilding ? '#e5e7eb' : '#6b7280', fontWeight: 600 }}>
                      Polygone bâtiment
                    </span>
                  </button>
                  <button
                    onClick={() => { if (!showBuilding) setShowBuilding(true); toggleEditMode(!isEditing); }}
                    title={isEditing ? 'Terminer l\u2019édition du bâtiment' : 'Éditer le bâtiment'}
                    style={{
                      background: isEditing ? 'rgba(245,158,11,0.9)' : 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
                      cursor: 'pointer', padding: '3px 5px', display: 'flex', alignItems: 'center',
                    }}
                  >
                    <Pencil size={11} color={isEditing ? '#fff' : '#f59e0b'} />
                  </button>
                </div>

                {savedAnnotations.length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '6px 0' }} />
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 }}>Mesures</div>
                    {savedAnnotations.map((a, i) => (
                      <button key={i} onClick={() => {
                        const ann = savedAnnotationsRef.current[i];
                        if (!ann) return;
                        ann.visible = !ann.visible;
                        ann.polylines.forEach(p => p.setVisible(ann.visible));
                        ann.markers.forEach(m => m.setVisible(ann.visible));
                        if (ann.label) { if (ann.visible && mapInstance.current) ann.label.open(mapInstance.current); else ann.label.close(); }
                        setSavedAnnotations(savedAnnotationsRef.current.map(x => ({ target: x.target, feet: x.feet, visible: x.visible })));
                      }} style={{
                        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
                        background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', width: '100%',
                      }}>
                        {a.visible ? <Eye size={12} color={mergedColors[a.target] || '#22c55e'} /> : <EyeOff size={12} color="#6b7280" />}
                        <div style={{ width: 14, height: 3, borderRadius: 2, background: mergedColors[a.target] || '#22c55e', opacity: a.visible ? 1 : 0.3 }} />
                        <span style={{ fontSize: 10, color: a.visible ? '#e5e7eb' : '#6b7280', fontWeight: 600 }}>
                          {mergedLabels[a.target]} — {a.feet} pi
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            {superficie && (
              <div className={s.areaBadge}>
                {(superficie * 10.7639).toFixed(0)} pi²
              </div>
            )}
            {largeur && profondeur && (
              <div className={s.dimsBadge}>
                {(largeur * 3.28084).toFixed(0)}' × {(profondeur * 3.28084).toFixed(0)}'
              </div>
            )}
            {noLot && (
              <div className={s.lotBadge}>
                Lot {noLot}
              </div>
            )}
          </>
        )}
      </div>

      {!measureMode && !hideBuiltinAdjust && (
        <>
          <button type="button" className={s.offsetToggle} onClick={() => setShowControls((v) => !v)}>
            <Settings2 size={14} />
            Ajuster le contour
          </button>

          <AnimatePresence>
            {showControls && (
              <motion.div
                className={s.offsetControls}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className={s.offsetRow}>
                  <button type="button" className={s.offsetBtnRound} onClick={() => setRotationDeg((v) => v + ROTATE_STEP_DEG)} title="Rotation antihoraire">
                    <RotateCcw size={18} />
                  </button>

                  <div className={s.offsetPad}>
                    <span />
                    <button type="button" className={s.offsetBtn} onClick={() => setOffsetNorthM((v) => v + NUDGE_STEP_METERS)}><ChevronUp size={20} strokeWidth={2.5} /></button>
                    <span />
                    <button type="button" className={s.offsetBtn} onClick={() => setOffsetEastM((v) => v - NUDGE_STEP_METERS)}><ChevronLeft size={20} strokeWidth={2.5} /></button>
                    <button type="button" className={s.offsetBtnGhost} onClick={() => { editedBasePathsRef.current = null; setOffsetEastM(0); setOffsetNorthM(0); setRotationDeg(0); setScaleFactor(1); }} title="Réinitialiser"><RefreshCcw size={14} /></button>
                    <button type="button" className={s.offsetBtn} onClick={() => setOffsetEastM((v) => v + NUDGE_STEP_METERS)}><ChevronRight size={20} strokeWidth={2.5} /></button>
                    <span />
                    <button type="button" className={s.offsetBtn} onClick={() => setOffsetNorthM((v) => v - NUDGE_STEP_METERS)}><ChevronDown size={20} strokeWidth={2.5} /></button>
                    <span />
                  </div>

                  <button type="button" className={s.offsetBtnRound} onClick={() => setRotationDeg((v) => v - ROTATE_STEP_DEG)} title="Rotation horaire">
                    <RotateCw size={18} />
                  </button>
                </div>

                {/* Scale controls */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 6, alignItems: 'center' }}>
                  <button type="button" className={s.offsetBtnRound} onClick={() => setScaleFactor((v) => Math.max(0.5, v - SCALE_STEP))} title="Réduire">
                    <ZoomOut size={16} />
                  </button>
                  <span style={{ color: '#9ca3af', fontSize: 10, minWidth: 40, textAlign: 'center' }}>{Math.round(scaleFactor * 100)}%</span>
                  <button type="button" className={s.offsetBtnRound} onClick={() => setScaleFactor((v) => Math.min(2, v + SCALE_STEP))} title="Agrandir">
                    <ZoomIn size={16} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
};

export default BuildingReadOnlyMap;
