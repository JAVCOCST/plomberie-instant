// Roof Studio — 2D polygon tracer + live straight-skeleton 3D preview.
//
// Adapted from a standalone canvas tool. The geometry/render engine (straight
// skeleton, per-face pitch, custom 3D projection) is intentionally kept as
// plain canvas + requestAnimationFrame: it is already smooth and avoids
// pulling three.js into this route. Only the shell wiring (component name,
// fills its container instead of the viewport) was changed.
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ImagePlus, Layers, Eye, EyeOff, House, Wrench } from "lucide-react";
import { HLSET,LEGEND,LIGHT,PAL,PIGNON_GRAD,PRESETS,SC,SkeletonBuilder,TOFF,HITR,VCOLOR,VTYPES,_vid,_zW,apOv,area2,boundaryDist,buildView,clipHalfPlane,clipSide,collectFaces,computeMeasures,computeValleys,convexDiff,cw,d3,distPtEdge,dot,draw2D,drawLineZ,ect,face3DArea,faceGradient,facePlane,facePlaneFromFace,faceRun,faceShell,facesFn,findValleys,gableEndsOverrides,getFacePitches,hitFace3D,hitFaceDetailed,initSkeleton,isPignon,len,membraneStrips,mkGable,mkPts,mkS,n3,newSec,nk,nrm,parseRGB,perpCornerSnap,pignonBuried,pitchColor,pointInPoly,polyAreaAbs,polyAreaSigned,polyClipConvex,proj3,projPtSeg,rasterTri,render3D,roofHeightAt,roofRise,s3,sceneScale,sceneSpan,sectionRoofHeightAt,segDist,shadeColor,skInitPromise,skReady,skelFn,skelFnLocal,skelFromCGAL,skelNodes,slopeDir,snap3D,snapToFootprint,sub,toCCW,unprojectGround,valleyCandidates,valleyHeight,vid,vv,w2s,withS,x3,zbufferFaces } from "@/lib/roof-core/engine";
import type { RoofModel } from "@/lib/roof-core/types";
import { fromRoofSectionsV16 } from "@/lib/roof-core/adapters/fromRoofSectionsV16";
import { computeViewport } from "@/lib/roof-core/viewport";
import { getVariant, defaultSlopeOffsetMm } from "@/lib/roof-accessories/catalog";
import { makeAnchor, validateAnchor } from "@/lib/roof-accessories/anchor";
import { sectionIdsOf, isAccessoryOrphan } from "@/lib/roof-accessories/resolve";
import { sectionRidge, resolvePlaced, projectToFrame, distToRidge, ACC_FOOTPRINT_HALF_PX } from "@/lib/roof-accessories/placement";
import { MAX_301_PRODUCT_ID } from "@/lib/roof-accessories/types";
import { buildAnnotation, parseAnnotation } from "@/lib/roof-core/annotation";
import { buildStaticMapUrl, principalBearingDeg, cardinal8, webMercatorPx, metersPerPx } from "@/lib/roof-core/georef";
import { offsetPolygonInward, inchesToPx } from "@/lib/roof-core/offset-polygon";
import { supabase } from "@/integrations/supabase/client";

// Props are all OPTIONAL: rendered with none (the /admin/roof-studio route),
// AdminRoofStudio behaves exactly as the standalone free tracer. The Training
// Lab opens it in `review` mode with a candidate RoofModel.
interface RoofStudioProps {
  initialModel?: RoofModel;
  backgroundImage?: string;            // data URL or URL
  mode?: "free" | "review";
  /** Quand vrai : cache les onglets Acc/Bât/Carte et le panneau Fichier
   *  (dev tooling inutile pour l'annotation training lab). Le tracer
   *  garde seulement Dessin + 2D/3D + Valider/Fermer + le toggle 👁️ IA.
   *  N'altère ni la persistance ni la logique métier — pur UI hide. */
  trainingLabMode?: boolean;
  onValidate?: (model: RoofModel) => void;
  onClose?: () => void;
  // Optional, additive hooks for an external host (e.g. TakeoffFullscreen). Not
  // used by /admin/roof-studio or the Training Lab → no behaviour change there.
  // onReadyApi exposes an imperative handle so the host can trigger the SAME
  // validation as the internal "Valider" button. onModelChange emits the current
  // model on edits (for host-side autosave). Both are no-ops when absent.
  onReadyApi?: (api: { validate: () => void }) => void;
  onModelChange?: (model: RoofModel) => void;
  // Caméra 3D persistée : on ré-ouvre le traceur sur la dernière vue gelée
  // (phi/theta = orbite, r = zoom) au lieu de la vue par défaut. onViewChange
  // est émis (orbit/zoom relâché) pour que le host la sauvegarde.
  initialView?: { phi: number; theta: number; r: number } | null;
  onViewChange?: (v: { phi: number; theta: number; r: number }) => void;
  // Vue gelée (image satellite/ortho) persistée : on restaure le MÊME fond +
  // géoréf à l'ouverture (image re-fetchée, déterministe) et on émet le géoréf
  // quand l'utilisateur gèle, pour que le host le sauvegarde.
  initialGeoRef?: any | null;
  onGeoRefChange?: (g: any) => void;
  // Pre-seed the Carte (address already known from the quote) so the user
  // doesn't retype it: opens the map centred on it + fetches the footprint.
  mapSeed?: { lat?: number | null; lng?: number | null; address?: string | null };
  // Per-dataset display tweaks (brightness/contrast pour l'image de fond).
  // Sauvegardé en DB côté host via onDisplaySettingsChange. Pur UI : n'affecte
  // pas le RoofModel. Quand absent → défauts neutres (brightness=1, contrast=1).
  displaySettings?: { brightness?: number; contrast?: number } | null;
  onDisplaySettingsChange?: (settings: { brightness: number; contrast: number }) => void;
  // Ouvre la page Recaler (TrainingTakeoffEditor) pour ajuster le polygone du
  // bâtiment quand l'IA s'est plantée. Bouton accessible via le pill RECALER
  // dans la barre latérale droite — uniquement en trainingLabMode.
  onOpenRecaler?: () => void;
  // Polygones lat/lng à afficher en overlay dans le canvas studio (Bâtiment +
  // Lot). Projetés en image px via overlayGeoRef. Toggle de visibilité dans
  // le pill SECTIONS (sous-section "Calques"). Step 1 = render-only (pas
  // encore éditable).
  overlayBuildingLatLng?: [number, number][] | null;
  overlayLotLatLng?: [number, number][] | null;
  overlayGeoRef?: { centerLat: number; centerLng: number; zoom: number; imageW: number; imageH: number; scale: number } | null;
}

// GeoJSON (Polygon/MultiPolygon) → arrays of {lat,lng} rings, for the map
// guidance overlay (building/lot). Tolerant of a bad/empty string.
function parseGeoJsonRings(geojsonStr: string): any[][] {
  try {
    const parsed = JSON.parse(geojsonStr); const rings: any[] = [];
    if (parsed.type === "Polygon") rings.push(...parsed.coordinates);
    else if (parsed.type === "MultiPolygon") parsed.coordinates.forEach(function (p: any) { rings.push(...p); });
    return rings.map(function (ring: any) { return ring.map(function (c: any) { return { lat: c[1], lng: c[0] }; }); });
  } catch { return []; }
}

// RoofModel section (truth-input) → the engine's internal section shape.
// On RESTAURE les overrides de nœuds manuels (`_no`) s'ils ont été persistés
// (déplacement de faîtiers) ; sinon on dérive les bouts de pignon du roof_type
// (comportement historique). Quand gable + overrides manuels coexistent, les
// manuels priment.
function modelSecToInternal(s: any) {
  const pts = (s.pts || []).map(function (p: any) { return { x: p.x, y: p.y }; });
  const derived = s.roof_type === "gable" ? gableEndsOverrides(pts) : {};
  const _no = (s._no && Object.keys(s._no).length) ? Object.assign({}, derived, s._no) : derived;
  return { pts: pts, closed: true, _skel: null as any, pitch: s.pitch || 7, elev: s.elev || 0, hf: s.hf || 0, _no: _no, hidden: false, roof_type: s.roof_type || "hip" };
}

// Stable signature of a polygon (rounded 0.1px) — used to detect when an
// imported MVP section was edited by the human (mvp → human).
function sigPts(pts: any[]) { return JSON.stringify((pts || []).map(function (p: any) { return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; })); }

// RoofModel/annotation section → internal section, carrying source provenance.
function annSecToInternal(s: any) {
  const base: any = modelSecToInternal(s);
  base.source = s.source || "mvp";
  base._orig = sigPts(base.pts);
  return base;
}

// Floating pill positions are per-device (localStorage). usePillPos retourne
// la position courante + handlers de drag à attacher à la "poignée" (le grip
// ⋮⋮ à gauche du pill). Les boutons internes restent cliquables — ils ne
// déclenchent pas le drag. Les listeners mousemove/up sont au niveau window
// pour ne pas perdre le drag quand le curseur sort du pill.
function usePillPos(id: string, cv2w: React.RefObject<HTMLDivElement>) {
  const stPos = useState<{ x: number; y: number } | null>(function () {
    try {
      const raw = localStorage.getItem("rs-pill-" + id);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (j && typeof j.x === "number" && typeof j.y === "number") return j;
    } catch {}
    return null;
  });
  const pos = stPos[0], setPos = stPos[1];
  // Expanded state — default false (pills collapsed à l'ouverture pour ne pas
  // bouffer l'écran). Persisté en localStorage par device.
  const stExp = useState<boolean>(function () {
    try { return localStorage.getItem("rs-pill-" + id + "-exp") === "1"; } catch { return false; }
  });
  const expanded = stExp[0], setExpanded = stExp[1];
  useEffect(function () {
    try { localStorage.setItem("rs-pill-" + id + "-exp", expanded ? "1" : "0"); } catch {}
  }, [expanded, id]);
  const elRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ active: false, sx: 0, sy: 0, origRight: 0, origTop: 0, moved: false });

  // Drag = mousedown sur l'icône → si déplacement > 6px : on bouge le pill.
  // Sinon le onClick du bouton fait le toggle expanded.
  const onDown = useCallback(function (e: any) {
    e.stopPropagation();
    const src = (e.touches && e.touches[0]) || e;
    const rect = elRef.current && elRef.current.getBoundingClientRect();
    const cr = cv2w.current && cv2w.current.getBoundingClientRect();
    if (!rect || !cr) return;
    dragRef.current = {
      active: true,
      sx: src.clientX,
      sy: src.clientY,
      origRight: cr.right - rect.right,
      origTop: rect.top - cr.top,
      moved: false,
    };
  }, [cv2w]);

  useEffect(function () {
    const onMove = function (e: any) {
      if (!dragRef.current.active) return;
      const src = (e.touches && e.touches[0]) || e;
      const dx = src.clientX - dragRef.current.sx;
      const dy = src.clientY - dragRef.current.sy;
      if (Math.hypot(dx, dy) > 6) dragRef.current.moved = true;
      if (!dragRef.current.moved) return;
      const cr = cv2w.current && cv2w.current.getBoundingClientRect();
      if (!cr) return;
      if (e.cancelable) e.preventDefault();
      const elW = (elRef.current && elRef.current.offsetWidth) || 60;
      const elH = (elRef.current && elRef.current.offsetHeight) || 40;
      setPos({
        right: Math.max(0, Math.min(cr.width - elW, dragRef.current.origRight - dx)),
        top: Math.max(4, Math.min(cr.height - elH - 4, dragRef.current.origTop + dy)),
      });
    };
    const onUp = function () { if (dragRef.current.active) dragRef.current.active = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return function () {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [cv2w]);

  useEffect(function () {
    if (pos === null) return;
    try { localStorage.setItem("rs-pill-" + id, JSON.stringify(pos)); } catch {}
  }, [pos, id]);

  // onToggle protégé : ignore le clic s'il a été précédé d'un drag (moved=true).
  const safeToggle = useCallback(function () {
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
    setExpanded(function (v) { return !v; });
  }, []);

  // Variante : exécute un callback custom si ce n'était pas un drag (utilisé
  // par le pill RECALER qui n'a pas d'état expanded — un clic = action directe).
  const safeClick = useCallback(function (cb: () => void) {
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
    cb();
  }, []);

  return { pos: pos, elRef: elRef, dragHandlers: { onMouseDown: onDown, onTouchStart: onDown }, expanded: expanded, setExpanded: setExpanded, safeToggle: safeToggle, safeClick: safeClick };
}

// Bouton-icône d'un pill : sert à la fois de drag handle (mousedown commence
// le tracking) ET de toggle au clic (si pas de drag détecté). Affiche une
// icône Lucide propre (pas d'emoji) + un dot coloré qui identifie le pill.
function PillIconButton({ icon, color, expanded, onClick, handlers }: { icon: any; color: string; expanded: boolean; onClick: () => void; handlers: any }) {
  const Icon = icon;
  return (
    <button
      onClick={onClick}
      {...handlers}
      style={{
        width: 44, height: 44,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: expanded ? color + "22" : "rgba(10,12,30,0.94)",
        border: "1px solid " + (expanded ? color : "#2a3a60"),
        borderRadius: 10,
        color: expanded ? color : "#9aa3c8",
        cursor: "grab",
        touchAction: "none",
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
        flexShrink: 0,
      }}
    >
      <Icon size={20} strokeWidth={2} />
    </button>
  );
}

// -- COMPONENT -----------------------------------------
export default function AdminRoofStudio({ initialModel, backgroundImage, mode = "free", trainingLabMode = false, onValidate, onClose, onReadyApi, onModelChange, initialView, onViewChange, initialGeoRef, onGeoRefChange, mapSeed, displaySettings, onDisplaySettingsChange, onOpenRecaler, overlayBuildingLatLng, overlayLotLatLng, overlayGeoRef }: RoofStudioProps = {}) {
  // Normalize an injected RoofModel/annotation once (tolerant: accepts both the
  // RoofModel `alternatives` shape and the saved annotation `suggestions` shape).
  const parsedInit = useRef<any>(undefined);
  if (parsedInit.current === undefined) parsedInit.current = initialModel ? parseAnnotation(initialModel) : null;
  const stSecs = useState<any[]>(function () { return parsedInit.current && parsedInit.current.sections.length ? withS(parsedInit.current.sections.map(annSecToInternal)) : [newSec()]; }), secs = stSecs[0], setSecs = stSecs[1];
  // Alternatives: MVP suggestions kept OUT of the geometry. Stored separately,
  // drawn only as dashed ghosts in 2D, never fed to computeMeasures / render3D.
  const stAlts = useState<any[]>(function () { return parsedInit.current ? parsedInit.current.suggestions.map(function (a: any) { return Object.assign(annSecToInternal(a), { _alt: a._alt }); }) : []; }), alts = stAlts[0], setAlts = stAlts[1];
  const modelMeta = useRef<any>(parsedInit.current ? { metadata: parsedInit.current.metadata, image: parsedInit.current.image, calibration: parsedInit.current.calibration, mvp_source_snapshot: parsedInit.current.mvp_source_snapshot, address: parsedInit.current.address } : (initialModel || null));
  // Review mode is active when opened with mode="review" OR after a manual v1.6
  // import in the standalone tracer.
  const stReview = useState(mode === "review"), reviewActive = stReview[0], setReviewActive = stReview[1];
  const stV16Err = useState<string | null>(null), v16Err = stV16Err[0], setV16Err = stV16Err[1];
  const stAi = useState(0), ai = stAi[0], setAi = stAi[1];
  const stSel = useState(-1), sel = stSel[0], setSel = stSel[1];
  const stPrev = useState<any>(null), prev = stPrev[0], setPrev = stPrev[1];
  const stView = useState("draw"), view = stView[0], setView = stView[1];
  const stCvSz = useState({ w: 400, h: 400 }), cvSz = stCvSz[0], setCvSz = stCvSz[1];
  const stBgImg = useState<any>(null), bgImg = stBgImg[0], setBgImg = stBgImg[1];
  const stBgOp = useState(0.7), bgOp = stBgOp[0], setBgOp = stBgOp[1];
  // Display tweaks — initialisés depuis displaySettings prop (DB) ; les sliders
  // émettent onDisplaySettingsChange (debounce côté host). 1 = neutre.
  const stBrightness = useState<number>(function () { return (displaySettings && typeof displaySettings.brightness === "number") ? displaySettings.brightness : 1; }), brightness = stBrightness[0], setBrightness = stBrightness[1];
  const stContrast = useState<number>(function () { return (displaySettings && typeof displaySettings.contrast === "number") ? displaySettings.contrast : 1; }), contrast = stContrast[0], setContrast = stContrast[1];
  // Re-sync state si le prop change (ex: host re-fetch ou changement de dataset).
  // Compare via JSON pour éviter le re-render quand l'objet est nouvellement
  // alloué avec les mêmes valeurs.
  const lastDsSig = useRef<string>("");
  useEffect(function () {
    const sig = displaySettings ? JSON.stringify(displaySettings) : "";
    if (sig === lastDsSig.current) return;
    lastDsSig.current = sig;
    if (displaySettings) {
      if (typeof displaySettings.brightness === "number") setBrightness(displaySettings.brightness);
      if (typeof displaySettings.contrast === "number") setContrast(displaySettings.contrast);
    }
  }, [displaySettings]);
  // Émet le changement au host (debounce 400ms) — évite un write DB par mouvement
  // de slider tout en restant réactif.
  const dispEmitR = useRef<any>(null);
  useEffect(function () {
    if (!onDisplaySettingsChange) return;
    if (dispEmitR.current) window.clearTimeout(dispEmitR.current);
    dispEmitR.current = window.setTimeout(function () {
      onDisplaySettingsChange({ brightness: brightness, contrast: contrast });
    }, 400);
    return function () { if (dispEmitR.current) window.clearTimeout(dispEmitR.current); };
  }, [brightness, contrast, onDisplaySettingsChange]);
  // Le filtre brightness/contrast est PRÉ-APPLIQUÉ dans le bgImg via un canvas
  // off-screen (cf. useEffect plus haut). Du coup on passe "none" à draw2D
  // pour éviter le double-filtre. C'est la solution iOS-safe.
  const imgFilter = "none";
  const stTick = useState(0), tick = stTick[0], setTick = stTick[1];

  // ── Calques overlays : visibility des polygones Lot + Bâtiment, persistée
  // per-device dans localStorage. Default OFF pour ne pas surcharger
  // visuellement à l'ouverture. L'user toggle dans le pill SECTIONS.
  const stShowBuilding = useState<boolean>(function () {
    try { return localStorage.getItem("rs-overlay-building") === "1"; } catch { return false; }
  });
  const showBuildingOverlay = stShowBuilding[0], setShowBuildingOverlay = stShowBuilding[1];
  useEffect(function () {
    try { localStorage.setItem("rs-overlay-building", showBuildingOverlay ? "1" : "0"); } catch {}
  }, [showBuildingOverlay]);
  const stShowLot = useState<boolean>(function () {
    try { return localStorage.getItem("rs-overlay-lot") === "1"; } catch { return false; }
  });
  const showLotOverlay = stShowLot[0], setShowLotOverlay = stShowLot[1];
  useEffect(function () {
    try { localStorage.setItem("rs-overlay-lot", showLotOverlay ? "1" : "0"); } catch {}
  }, [showLotOverlay]);

  // Projection lat/lng → image px en utilisant la formule Mercator standard.
  // Le résultat est en coords-image (= coords-monde du studio, puisque draw2D
  // dessine l'image à (0,0) et 1 unité-monde = 1 image px). Le xf du studio
  // se charge ensuite de la projection écran. Cache via useMemo pour éviter
  // de recalculer à chaque render.
  const projectLatLngRing = useCallback(function (ring: [number, number][] | null | undefined): { x: number; y: number }[] | null {
    if (!ring || ring.length < 2 || !overlayGeoRef) return null;
    const gr = overlayGeoRef;
    const cPx = webMercatorPx(gr.centerLng, gr.centerLat, gr.zoom);
    const out: { x: number; y: number }[] = [];
    for (const [lat, lng] of ring) {
      const p = webMercatorPx(lng, lat, gr.zoom);
      out.push({
        x: gr.imageW / 2 + (p.x - cPx.x) * gr.scale,
        y: gr.imageH / 2 + (p.y - cPx.y) * gr.scale,
      });
    }
    return out;
  }, [overlayGeoRef]);
  const buildingOverlayPx = useMemo(function () { return projectLatLngRing(overlayBuildingLatLng); }, [overlayBuildingLatLng, projectLatLngRing]);
  const lotOverlayPx = useMemo(function () { return projectLatLngRing(overlayLotLatLng); }, [overlayLotLatLng, projectLatLngRing]);

  // ── Solo mode (3D) ──
  // Toggle dans le pill SECTIONS qui force le 3D à n'afficher QUE la section
  // active (ai). Les autres sont court-circuitées en setting leur pts à [] →
  // render3D les skip via le check pts.length < 3. Permet d'inspecter chaque
  // section isolément quand le 3D produit un nœud de chevauchements.
  const stSolo3D = useState<boolean>(function () {
    try { return localStorage.getItem("rs-solo-3d") === "1"; } catch { return false; }
  });
  const solo3D = stSolo3D[0], setSolo3D = stSolo3D[1];
  useEffect(function () {
    try { localStorage.setItem("rs-solo-3d", solo3D ? "1" : "0"); } catch {}
  }, [solo3D]);
  const solo3DR = useRef(solo3D);
  useEffect(function () { solo3DR.current = solo3D; setTick(function (t) { return t + 1; }); }, [solo3D]);

  // ── Auto-calibration en training lab ──
  // Quand overlayGeoRef est fourni (= dataset capturé via Explorer avec
  // map_params), on injecte automatiquement geoRef dans le studio. Ça active
  // le gsd (ground sample distance) et donc le formatage des mesures en
  // pi² / pi.l. au lieu de u² / u. Avant ce fix, l'user devait "geler" une
  // carte pour calibrer manuellement — détour inutile vu qu'on a déjà les
  // params de capture.
  useEffect(function () {
    if (!overlayGeoRef) return;
    setGeoRef(function (prev: any) {
      if (prev && isFinite(prev.center_lat) && Math.abs(prev.center_lat - overlayGeoRef.centerLat) < 1e-6) return prev;
      return {
        provider: "training-lab-georef",
        center_lat: overlayGeoRef.centerLat,
        center_lng: overlayGeoRef.centerLng,
        zoom: overlayGeoRef.zoom,
        image_w: overlayGeoRef.imageW,
        image_h: overlayGeoRef.imageH,
        scale: overlayGeoRef.scale,
        north_up: true,
        bearing_deg: 0,
      };
    });
  }, [overlayGeoRef]);
  // Collapse the toolbars to free the canvas — default collapsed on mobile so
  // annotation is near full-screen; expandable on demand.
  // Three independent tool menus (instead of one "outils" that hides everything).
  const wideScreen = typeof window === "undefined" || window.innerWidth >= 768;
  // Touch-sized UI on phones (reactive to rotation/resize). Bigger toolbar
  // targets + spacing; desktop keeps its compact sizing.
  const stTouch = useState(typeof window !== "undefined" && window.innerWidth < 768), touchUI = stTouch[0], setTouchUI = stTouch[1];
  useEffect(function () {
    if (typeof window === "undefined") return;
    const onR = function () { setTouchUI(window.innerWidth < 768); };
    window.addEventListener("resize", onR);
    return function () { window.removeEventListener("resize", onR); };
  }, []);
  const stMDraw = useState(wideScreen), openDraw = stMDraw[0], setOpenDraw = stMDraw[1];
  const stMFile = useState(false), openFile = stMFile[0], setOpenFile = stMFile[1];
  const stMAcc = useState(false), openAcc = stMAcc[0], setOpenAcc = stMAcc[1];
  // Bâtiment 2D : footprint des MURS, offsetté vers l'intérieur depuis le débord
  // du toit. Persisté avec le modèle (rétro-compatible : section sans `building`
  // = comportement d'avant).
  const stMBat = useState(false), openBat = stMBat[0], setOpenBat = stMBat[1];
  const stBatIn = useState(12), batInsetIn = stBatIn[0], setBatInsetIn = stBatIn[1];
  const stBatH = useState(10), batHeightFt = stBatH[0], setBatHeightFt = stBatH[1];
  // Replier toute la barre d'outils pour annoter sur un canevas quasi plein écran
  // (la carte + « Geler la vue » restent visibles).
  const stToolsCol = useState(false), toolsCollapsed = stToolsCol[0], setToolsCollapsed = stToolsCol[1];
  // Toggle « masquer toute l'annotation » — quand ON, on rend toutes les
  // sections comme `hidden` au moment du draw (sans toucher la donnée
  // persistée). Permet à l'utilisateur de voir l'image satellite sans le
  // polygone IA par-dessus, pour comparer.
  const stHideAnn = useState(false), hideAnnotations = stHideAnn[0], setHideAnnotations = stHideAnn[1];
  // Index de l'alternative actuellement "sélectionnée" pour preview avant
  // promote/reject. Null = aucune sélection → seules les chips alt N sont
  // cliquables. Quand un index est set, l'alt correspondant est highlighté
  // en orange épais sur le canvas, et 2 boutons "Promouvoir" / "Rejeter"
  // apparaissent dans le REVIEW pane.
  const stSelAlt = useState<number | null>(null), selAltIdx = stSelAlt[0], setSelAltIdx = stSelAlt[1];
  const stSnap = useState<any>(null), setSnapPt = stSnap[1];
  const stSel3D = useState<any>({ sec: -1, edge: -1 }), sel3D = stSel3D[0], setSel3D = stSel3D[1];
  const stSelNode = useState<any>(null), selNode = stSelNode[0], setSelNode = stSelNode[1];
  const stPillPos = useState<any>({ x: null, y: null }), pillPos = stPillPos[0], setPillPos = stPillPos[1];
  const stSolid = useState(true), solid = stSolid[0], setSolid = stSolid[1];
  const stSkEng = useState(false), skEng = stSkEng[0], setSkEng = stSkEng[1];
  const stSelFace = useState<any>(null), selFace = stSelFace[0], setSelFace = stSelFace[1];
  // 3D interaction mode: "surface" = pick faces; "solid" = drag a whole solid in Z.
  const stEdit3d = useState<"surface" | "solid">("surface"), edit3d = stEdit3d[0], setEdit3d = stEdit3d[1];
  const stZinfo = useState<string | null>(null), zInfo = stZinfo[0], setZinfo = stZinfo[1];
  const stLeg = useState(true), legendOpen = stLeg[0], setLegendOpen = stLeg[1];
  const valleys = useMemo(function () { return computeValleys(secs); }, [secs]);
  const selV = -1;   // valleys are auto-derived now; no manual selection
  const stHl = useState<string | null>(null), hl = stHl[0], setHl = stHl[1];
  const stDbg = useState(false), dbg = stDbg[0], setDbg = stDbg[1];
  const stCur = useState<any>(null), cur = stCur[0], setCur = stCur[1];
  // Annotation identity / provenance (persisted in the RoofModel, reused by DB later).
  const stName = useState(""), name = stName[0], setName = stName[1];
  const stRej = useState<any[]>([]), rejected = stRej[0], setRejected = stRej[1];
  // Roof accessories (Maximum vents, etc.) — kept entirely separate from secs:
  // never a section, never fed to measures / 3D / take-off. Persisted as-is.
  const stAcc = useState<any[]>(function () { return ((initialModel && (initialModel as any).accessories) || []).slice(); }), accessories = stAcc[0], setAccessories = stAcc[1];
  const stPlacing = useState(false), placingAcc = stPlacing[0], setPlacingAcc = stPlacing[1];
  const stSelAcc = useState(-1), selAcc = stSelAcc[0], setSelAcc = stSelAcc[1];
  // Map freeze: georeference of the frozen satellite image (north-up).
  const stGeo = useState<any>(function () { return (initialModel && (initialModel as any).georef) || null; }), geoRef = stGeo[0], setGeoRef = stGeo[1];
  const seedHasLatLng = !!(mapSeed && mapSeed.lat != null && mapSeed.lng != null);
  const stMap = useState(seedHasLatLng), openMap = stMap[0], setOpenMap = stMap[1];   // auto-open Carte when seeded
  const stMapLat = useState(seedHasLatLng ? String(mapSeed!.lat) : "45.40"), mapLat = stMapLat[0], setMapLat = stMapLat[1];
  const stMapLng = useState(seedHasLatLng ? String(mapSeed!.lng) : "-72.73"), mapLng = stMapLng[0], setMapLng = stMapLng[1];
  const stMapZoom = useState(20), mapZoom = stMapZoom[0], setMapZoom = stMapZoom[1];
  const stMapSrc = useState<"google" | "ortho">("google"), mapSource = stMapSrc[0], setMapSource = stMapSrc[1];
  const stMapAddr = useState((mapSeed && mapSeed.address) || ""), mapAddr = stMapAddr[0], setMapAddr = stMapAddr[1];
  const seedFetchedRef = useRef(false);
  const stPlaces = useState(false), placesReady = stPlaces[0], setPlacesReady = stPlaces[1];
  const stBldgGeo = useState<string | null>(null), bldgGeo = stBldgGeo[0], setBldgGeo = stBldgGeo[1];
  const stLotGeo = useState<string | null>(null), lotGeo = stLotGeo[0], setLotGeo = stLotGeo[1];
  const stBldgLoading = useState(false), bldgLoading = stBldgLoading[0], setBldgLoading = stBldgLoading[1];
  const addrInputRef = useRef<HTMLInputElement>(null);
  const addressR = useRef<string | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<any>(null);
  const mapPolys = useRef<any[]>([]);
  const orthoTypeR = useRef<any>(null);
  const ftPerPxR = useRef<number | null>(null);
  const membraneSegsR = useRef<any[]>([]);
  const gsdR = useRef<number | null>(null);
  const onValidateR = useRef(onValidate); onValidateR.current = onValidate;
  const onModelChangeR = useRef(onModelChange); onModelChangeR.current = onModelChange;
  const onViewChangeR = useRef(onViewChange); onViewChangeR.current = onViewChange;
  const onGeoRefChangeR = useRef(onGeoRefChange); onGeoRefChangeR.current = onGeoRefChange;
  const createdAtR = useRef<string | null>(null);
  const rejectedDebugR = useRef<any[]>([]);
  const imageMetaR = useRef<any>(null);
  const mvpSnapR = useRef<any>(null);
  const calibR = useRef<any>(null);
  // Restore the full annotation (name, rejected, provenance) when opened from a
  // shell (e.g. Training Lab) with an injected model. Geometry is already set by
  // the useState initializers above.
  useEffect(function () {
    const p = parsedInit.current; if (!p) return;
    setName(p.name && p.name !== "Sans titre" ? p.name : "");
    setRejected(p.rejectedSuggestions.map(function (s: any) { return Object.assign(annSecToInternal(s), { _alt: s._alt }); }));
    setAccessories((p.accessories || []).slice());
    setGeoRef(p.georef || null);
    createdAtR.current = p.created_at || new Date().toISOString();
    rejectedDebugR.current = p.rejectedDebug || [];
    calibR.current = p.calibration || null;
    mvpSnapR.current = p.mvp_source_snapshot || null;
    imageMetaR.current = p.image || null;
  }, []);

  // Address autocomplete (same Google Places setup as the quote module's
  // StepAddress). Lazy-load the JS API the first time the Carte menu opens.
  useEffect(function () {
    if (!openMap) return;
    const key = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY || "";
    if ((window as any).google?.maps?.places) { setPlacesReady(true); return; }
    if (!key) return;
    if (document.querySelector('script[data-roof-places="1"]')) return;
    const sc = document.createElement("script");
    sc.src = "https://maps.googleapis.com/maps/api/js?key=" + key + "&libraries=places";
    sc.async = true; sc.setAttribute("data-roof-places", "1");
    sc.onload = function () { setPlacesReady(true); };
    document.head.appendChild(sc);
  }, [openMap]);

  // Attach the autocomplete once the API is ready and the input is mounted.
  // Selecting a place fills lat/lng (and the name/address if still empty).
  useEffect(function () {
    if (!placesReady || !openMap || !addrInputRef.current) return;
    const g = (window as any).google; if (!g?.maps?.places) return;
    const ac = new g.maps.places.Autocomplete(addrInputRef.current, {
      componentRestrictions: { country: "ca" },
      fields: ["formatted_address", "geometry"],
    });
    const lis = ac.addListener("place_changed", function () {
      const place = ac.getPlace(); const loc = place.geometry && place.geometry.location; if (!loc) return;
      const lat = loc.lat(), lng = loc.lng();
      setMapLat(lat.toFixed(6)); setMapLng(lng.toFixed(6));
      if (place.formatted_address) {
        setMapAddr(place.formatted_address);
        addressR.current = place.formatted_address;
        modelMeta.current = Object.assign({}, modelMeta.current || {}, { address: place.formatted_address });
        setName(function (n: string) { return n && n.trim() ? n : place.formatted_address; });
      }
      if (mapInst.current) { mapInst.current.setCenter({ lat: lat, lng: lng }); mapInst.current.setZoom(19); }
      fetchBuildingPolygon(lat, lng);
    });
    return function () { if (lis && lis.remove) lis.remove(); };
  }, [placesReady, openMap]);

  // Custom QC orthophoto base layer (WMTS, EPSG:3857) for the live map. Tiles
  // load via the page origin (no canvas read), so they work wherever the geoegl
  // host allowlist permits — same condition as the quote module's ortho.
  function applyMapSource(map: any) {
    const g = (window as any).google; if (!g?.maps || !map) return;
    if (mapSource === "ortho") {
      if (!orthoTypeR.current) {
        orthoTypeR.current = new g.maps.ImageMapType({
          name: "Ortho QC", tileSize: new g.maps.Size(256, 256), minZoom: 0, maxZoom: 21,
          getTileUrl: function (c: any, z: number) { return "https://geoegl.msp.gouv.qc.ca/carto/wmts/1.0.0/orthos/default/EPSG_3857/" + z + "/" + c.y + "/" + c.x + ".jpeg"; },
        });
        map.mapTypes.set("orthoqc", orthoTypeR.current);
      }
      map.setMapTypeId("orthoqc");
    } else {
      map.setMapTypeId("satellite");
    }
  }
  // Init the interactive map (pan + pinch-zoom, north-up) when the Carte menu is
  // open and the Maps JS API is ready. The user frames the building; "Geler la
  // vue" snapshots the CURRENT center/zoom.
  useEffect(function () {
    if (!openMap || !placesReady || !mapDivRef.current) return;
    const g = (window as any).google; if (!g?.maps) return;
    if (!mapInst.current) {
      const lat = parseFloat(mapLat) || 45.5, lng = parseFloat(mapLng) || -73.6;
      mapInst.current = new g.maps.Map(mapDivRef.current, {
        center: { lat: lat, lng: lng }, zoom: 19,
        mapTypeId: "satellite", disableDefaultUI: true, zoomControl: true,
        zoomControlOptions: { position: g.maps.ControlPosition.LEFT_BOTTOM },
        gestureHandling: "greedy", tilt: 0, headingInteractionEnabled: false,
        keyboardShortcuts: false, clickableIcons: false,
      });
      applyMapSource(mapInst.current);
      // Seeded from the quote address: centre + fetch the building footprint once,
      // so the user can frame & freeze without retyping the address.
      if (seedHasLatLng && !seedFetchedRef.current && !geoRef) {
        seedFetchedRef.current = true;
        const slat = parseFloat(mapLat), slng = parseFloat(mapLng);
        if (isFinite(slat) && isFinite(slng)) { mapInst.current.setCenter({ lat: slat, lng: slng }); mapInst.current.setZoom(19); fetchBuildingPolygon(slat, slng); }
      }
    }
    return function () { mapInst.current = null; mapPolys.current = []; orthoTypeR.current = null; };
  }, [openMap, placesReady]);

  // Switch the live map base layer when the source toggle changes.
  useEffect(function () {
    if (mapInst.current) applyMapSource(mapInst.current);
  }, [mapSource]);

  // Draw building (orange) + lot (blue) guidance polygons on the live map. These
  // are NOT baked into the frozen image (the static fetch is polygon-free).
  useEffect(function () {
    const g = (window as any).google; const map = mapInst.current;
    if (!g?.maps || !map) return;
    mapPolys.current.forEach(function (p: any) { p.setMap(null); }); mapPolys.current = [];
    const add = function (geo: string | null, fill: string, stroke: string, fo: number) {
      if (!geo) return;
      parseGeoJsonRings(geo).forEach(function (path: any) {
        mapPolys.current.push(new g.maps.Polygon({ paths: path, map: map, fillColor: fill, fillOpacity: fo, strokeColor: stroke, strokeOpacity: 0.9, strokeWeight: 2, clickable: false }));
      });
    };
    add(lotGeo, "#3b82f6", "#60a5fa", 0.10);
    add(bldgGeo, "#f59e0b", "#f59e0b", 0.22);
  }, [bldgGeo, lotGeo, openMap, placesReady]);

  // Look up the building & lot footprint for a point (same RPC as the quote
  // module's BuildingConfirmation) and fit the map to it. Pure guidance.
  function fetchBuildingPolygon(lat: number, lng: number) {
    setBldgGeo(null); setLotGeo(null); setBldgLoading(true);
    Promise.resolve(supabase.rpc("find_building_polygon", { p_lat: lat, p_lng: lng, p_radius_meters: 100 })).then(function (res: any) {
      const row = res && res.data && res.data[0]; if (!row) return;
      setBldgGeo(row.geojson || null); setLotGeo(row.lot_geojson || null);
      const g = (window as any).google; const map = mapInst.current;
      const rings = parseGeoJsonRings(row.lot_geojson || row.geojson || "");
      if (g?.maps && map && rings.length) {
        const b = new g.maps.LatLngBounds();
        rings.forEach(function (ring: any) { ring.forEach(function (pt: any) { b.extend(pt); }); });
        map.fitBounds(b, 40);
      }
    }).catch(function () { /* guidance only — silent */ }).finally(function () { setBldgLoading(false); });
  }

  // Keep each accessory's orphan flag in sync when sections change (deleted
  // section → orphaned). Only commits when a flag actually flips (no loop).
  useEffect(function () {
    setAccessories(function (accs: any) {
      if (!accs.length) return accs;
      const ids = sectionIdsOf(secs); let changed = false;
      const next = accs.map(function (a: any) {
        const orph = isAccessoryOrphan(a, ids);
        if (!!a.accessory_orphaned === orph) return a;
        changed = true;
        return Object.assign({}, a, { accessory_orphaned: orph, anchor: Object.assign({}, a.anchor, { orphan_state: orph ? { reason: "section_not_found", orphaned_at: new Date().toISOString() } : null }) });
      });
      return changed ? next : accs;
    });
  }, [secs]);

  const cv2w = useRef<any>(null), cv2 = useRef<any>(null), cv3 = useRef<any>(null);
  const orb = useRef<any>({ phi: 1.1, theta: .8, r: 14, down: false, lx: 0, ly: 0, pinch: null });
  // Caméra persistée : on seede l'orbite/zoom depuis initialView une seule fois
  // au montage, pour ré-ouvrir sur la dernière vue gelée.
  useEffect(function () {
    const iv = initialView;
    if (iv && typeof iv.r === "number" && iv.r > 0) {
      orb.current.phi = iv.phi; orb.current.theta = iv.theta; orb.current.r = iv.r;
      setTick(function (t) { return t + 1; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const emitView = useCallback(function () {
    const cb = onViewChangeR.current; if (!cb) return;
    cb({ phi: orb.current.phi, theta: orb.current.theta, r: orb.current.r });
  }, []);
  const xf = useRef<any>({ scale: 1, tx: 0, ty: 0 });
  const p2 = useRef<any>({ active: false });
  const drag2 = useRef<any>({ active: false, idx: -1, sx: 0, sy: 0, moved: false });
  const drag3 = useRef<any>({ active: false, startScr: { x: 0, y: 0 }, hData: null });
  const zdrag3 = useRef<any>({ active: false });   // dragging a whole solid in Z (solid mode)
  const accGhost = useRef<any>(null);              // placement ghost (Phase 2)
  const accDrag = useRef<any>({ active: false });  // dragging a placed accessory along its ridge frame
  const accProxR = useRef<any[]>([]);              // resolved 3D proxies for render
  const edit3dR = useRef(edit3d); edit3dR.current = edit3d;
  const dragNode = useRef<any>({ active: false, si: -1, key: "", ox: 0, oy: 0, startWx: 0, startWy: 0 });
  const dragGuide = useRef<any>(null);   // soft parallel guide while dragging a skeleton node
  const pinchRaf = useRef<any>(0);       // rAF throttle for 2D pinch redraws
  const perpR = useRef<any>(null);       // 90deg-locked edges while dragging a corner (drawn red)
  const secsR = useRef(secs); secsR.current = secs;
  const aiR = useRef(ai); aiR.current = ai;
  const sel3DR = useRef(sel3D); sel3DR.current = sel3D;
  const solidR = useRef(solid); solidR.current = solid;
  const hideAnnRef = useRef(hideAnnotations); hideAnnRef.current = hideAnnotations;
  const valleysR = useRef(valleys); valleysR.current = valleys;
  const selVR = useRef(selV); selVR.current = selV;
  const selFaceR = useRef(selFace); selFaceR.current = selFace;
  const hlR = useRef(hl); hlR.current = hl;
  const snapR = useRef<any>(null);
  const guideR = useRef<any>(null);     // parallel (blue) + collinear (fuchsia) guides vs every section's edges
  const dimR = useRef<any>(null);       // live segment dimensions (length + angle) while drawing
  const hCache = useRef<any[]>([]);
  const cbD = useRef<any>(null), cbM = useRef<any>(null), cbU = useRef<any>(null);
  const raf3 = useRef<any>(null);
  const pillDrag = useRef<any>({ active: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false });
  const pillRef = useRef<any>(null);
  // Pills flottants (trainingLabMode) — chacun a sa propre position persistée
  // dans localStorage. Drag via la poignée ⋮⋮ uniquement (les boutons internes
  // restent cliquables).
  const sectionsPill = usePillPos("sections", cv2w);
  const vuePill = usePillPos("vue", cv2w);
  const typePill = usePillPos("type", cv2w);
  const recalerPill = usePillPos("recaler", cv2w);

  const clamp = useCallback(function (raw: any) {
    const c = cv2.current, W = c ? c.width : 400, H = c ? c.height : 400, s = Math.max(0.05, Math.min(12, raw.scale));
    // Loose bounds so zooming out (s < 1) doesn't snap the content away.
    const mx = Math.max(W, H);
    return { scale: s, tx: Math.max(-W * s - mx, Math.min(mx, raw.tx)), ty: Math.max(-H * s - mx, Math.min(mx, raw.ty)) };
  }, []);

  const updSkel = useCallback(function (idx: number) {
    setSecs(function (ss: any) {
      const ns = ss.slice(), s = ns[idx];
      const newSkel = s.closed && s.pts.length >= 3 ? skelFn(s.pts) : null;
      // Re-key node overrides onto the nearest node of the recomputed skeleton so
      // an adjusted node stays put when the footprint changes (instead of the key
      // going stale and the node snapping back to its computed position). Gable
      // apexes are re-derived from scratch so they stay glued to their edge.
      let no = s._no || {};
      const keys = Object.keys(no);
      if (newSkel && keys.length) {
        const hasGable = keys.some(function (k) { return no[k] && no[k].gable; });
        const nodes = skelNodes(newSkel, {});
        const span = (function () { const sc = sceneScale(ns); return sc ? 9 / sc.sc : 100; })();
        const remap: any = {};
        keys.forEach(function (k: string) {
          if (no[k] && no[k].gable) return;   // gable apexes regenerated below
          const parts = k.split("_"), ox = (+parts[0]) / 10, oy = (+parts[1]) / 10;
          let best: any = null, bd = Infinity;
          nodes.forEach(function (nd: any) { const d = Math.hypot(nd.ox - ox, nd.oy - oy); if (d < bd) { bd = d; best = nd; } });
          if (best && bd < span * 0.2) remap[best.key] = no[k];
        });
        no = hasGable ? Object.assign(remap, gableEndsOverrides(s.pts)) : remap;
      }
      ns[idx] = Object.assign({}, s, { _skel: newSkel, _no: no });
      return ns;
    });
  }, []);

  useEffect(function () {
    const el = cv2w.current; if (!el) return;
    const ro = new ResizeObserver(function (e) {
      const r = e[0].contentRect, w = Math.max(50, Math.floor(r.width)), h = Math.max(50, Math.floor(r.height));
      const c = cv2.current; if (c) { c.width = w; c.height = h; } setCvSz({ w, h });
    });
    ro.observe(el); return function () { ro.disconnect(); };
  }, []);

  // Repaint du canvas 2D quand on revient en mode "draw" depuis la vue 3D.
  // Le canvas garde son backing store entre les toggles, MAIS si le
  // ResizeObserver ne renvoie pas une taille différente au retour (cas courant
  // quand la fenêtre n'a pas été redimensionnée), setCvSz est appelé avec la
  // même valeur, React zappe le re-render et l'effet draw2D ne refire pas.
  // Bumper `tick` force la dépendance à changer et donc un redraw propre.
  useEffect(function () { if (view === "draw") setTick(function (t) { return t + 1; }); }, [view]);

  // Image source brute (avant filtre brightness/contrast). On la garde séparée
  // pour pouvoir re-générer une version filtrée à chaque changement de
  // luminosité/contraste sans re-télécharger.
  const stSrcImg = useState<any>(null), srcImg = stSrcImg[0], setSrcImg = stSrcImg[1];

  useEffect(function () {
    if (!backgroundImage) return;
    const img = new Image();
    // Google Static Maps keys are HTTP-referrer-restricted: sending the app
    // origin as Referer is rejected (403), but a no-referer request loads. Strip
    // the referer so satellite backgrounds load regardless of the key's allowlist.
    img.referrerPolicy = "no-referrer";
    img.onload = function () { setSrcImg(img); if (!imageMetaR.current) imageMetaR.current = { name: null, width: img.naturalWidth, height: img.naturalHeight }; fitView(img.naturalWidth, img.naturalHeight); setTick(function (t) { return t + 1; }); };
    img.onerror = function () { setV16Err("Image non chargée (clé Google restreinte ?) — utilise « img » pour charger un fichier local"); };
    img.src = backgroundImage;
  }, [backgroundImage]);

  // Pré-rendre une version filtrée (luminosité/contraste) dans un canvas
  // off-screen. C'est cette version qui sera bgImg. Évite la galère iOS Safari
  // où ctx.filter ne s'applique pas correctement dans un contexte transformé.
  useEffect(function () {
    if (!srcImg) { setBgImg(null); return; }
    if (brightness === 1 && contrast === 1) { setBgImg(srcImg); setTick(function (t) { return t + 1; }); return; }
    const off = document.createElement("canvas");
    off.width = srcImg.naturalWidth; off.height = srcImg.naturalHeight;
    const octx = off.getContext("2d");
    if (!octx) { setBgImg(srcImg); return; }
    // Filter en pourcentage (plus compatible que les nombres décimaux sur iOS).
    octx.filter = "brightness(" + Math.round(brightness * 100) + "%) contrast(" + Math.round(contrast * 100) + "%)";
    octx.drawImage(srcImg, 0, 0);
    // Le canvas off-screen a aussi naturalWidth/Height implicites (via width/height).
    // On lui en pose une copie pour matcher l'interface attendue par draw2D.
    (off as any).naturalWidth = off.width;
    (off as any).naturalHeight = off.height;
    setBgImg(off);
    setTick(function (t) { return t + 1; });
  }, [srcImg, brightness, contrast]);

  // Valleys are displayed (read-only) in 2D; detection & endpoint editing live
  // in the 3D view. Alternatives (if any) are overlaid as dashed gold ghosts
  // AFTER the engine draw — they never enter the geometry/metrics/render.
  useEffect(function () {
    const c = cv2.current; if (!c) return;
    const ctx = c.getContext("2d");
    // Toggle 👁️ : si hideAnnotations on rend chaque section comme hidden (sans
    // toucher la donnée persistée → c'est juste un override de rendu).
    const drawSecs = hideAnnotations ? secs.map(function (s: any) { return Object.assign({}, s, { hidden: true }); }) : secs;
    draw2D(ctx, c.width, c.height, drawSecs, ai, sel, prev, bgImg, bgOp, xf.current, selNode, valleys, selV, solid, dragGuide.current, perpR.current, imgFilter);
    // Calques overlays (lat/lng → image px). Rendus APRÈS draw2D pour passer
    // par-dessus l'image satellite mais SOUS les sections actives. On
    // re-applique le xf transform (draw2D l'a restauré). Step 1 = render-only.
    if ((showLotOverlay && lotOverlayPx) || (showBuildingOverlay && buildingOverlayPx)) {
      ctx.save();
      ctx.translate(xf.current.tx, xf.current.ty);
      ctx.scale(xf.current.scale, xf.current.scale);
      const lw = 2.5 / xf.current.scale;
      if (showLotOverlay && lotOverlayPx) {
        ctx.beginPath();
        for (let i = 0; i < lotOverlayPx.length; i++) {
          const p = lotOverlayPx[i];
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(120,180,255,0.10)"; ctx.fill();
        ctx.strokeStyle = "rgba(120,180,255,0.9)"; ctx.lineWidth = lw;
        ctx.setLineDash([10 / xf.current.scale, 6 / xf.current.scale]);
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (showBuildingOverlay && buildingOverlayPx) {
        ctx.beginPath();
        for (let i = 0; i < buildingOverlayPx.length; i++) {
          const p = buildingOverlayPx[i];
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(255,170,80,0.10)"; ctx.fill();
        ctx.strokeStyle = "rgba(255,170,80,0.95)"; ctx.lineWidth = lw;
        ctx.stroke();
      }
      ctx.restore();
    }
    if (alts.length && !hideAnnotations) {
      ctx.save();
      alts.forEach(function (a: any, idx: number) {
        if (!a.pts || a.pts.length < 2) return;
        const isSelected = idx === selAltIdx;
        // Highlight de l'alt sélectionnée : orange épais + remplissage plus
        // visible, pour que l'utilisateur sache laquelle c'est avant de
        // promouvoir/rejeter via les boutons du REVIEW pane.
        ctx.setLineDash(isSelected ? [10, 6] : [6, 5]);
        ctx.lineWidth = isSelected ? 4 : 2;
        ctx.strokeStyle = isSelected ? "#ff8800" : "#d8ff00";
        ctx.fillStyle = isSelected ? "rgba(255,136,0,0.22)" : "rgba(216,255,0,0.07)";
        ctx.beginPath();
        a.pts.forEach(function (p: any, i: number) { const s = w2s(p.x, p.y, xf.current); if (i === 0) ctx.moveTo(s.sx, s.sy); else ctx.lineTo(s.sx, s.sy); });
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Numéro "alt N" en gros au centre de la sélectionnée — pour matcher
        // sans ambiguïté avec le bouton du REVIEW pane.
        if (isSelected) {
          const cx = a.pts.reduce((s: number, p: any) => s + p.x, 0) / a.pts.length;
          const cy = a.pts.reduce((s: number, p: any) => s + p.y, 0) / a.pts.length;
          const sc = w2s(cx, cy, xf.current);
          ctx.setLineDash([]);
          ctx.font = "bold 18px monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.strokeStyle = "#0a0a14"; ctx.lineWidth = 4;
          ctx.strokeText("alt " + (idx + 1), sc.sx, sc.sy);
          ctx.fillStyle = "#ff8800";
          ctx.fillText("alt " + (idx + 1), sc.sx, sc.sy);
        }
      });
      ctx.restore();
    }
    // Alignment guides: parallel edges + current segment glow blue; collinear
    // edges draw a fuchsia dashed extension line through the cursor.
    const gd = guideR.current;
    if (gd) {
      ctx.save(); ctx.lineCap = "round";
      if (gd.col && gd.col.length) {
        ctx.strokeStyle = "#ff2ec4"; ctx.setLineDash([11, 8]); ctx.lineWidth = 2;
        gd.col.forEach(function (e: any) {
          const a = w2s(e[0], e[1], xf.current), b = w2s(e[2], e[3], xf.current);
          let dx = b.sx - a.sx, dy = b.sy - a.sy, L = Math.hypot(dx, dy); if (L < 1e-6) return; dx /= L; dy /= L;
          ctx.beginPath(); ctx.moveTo(a.sx - dx * 3000, a.sy - dy * 3000); ctx.lineTo(b.sx + dx * 3000, b.sy + dy * 3000); ctx.stroke();
        });
        ctx.setLineDash([]);
      }
      if (gd.par && gd.par.length) {
        ctx.strokeStyle = "#21e6ff"; ctx.shadowColor = "#21e6ff"; ctx.shadowBlur = 9; ctx.lineWidth = 3.5;
        gd.par.forEach(function (e: any) { const a = w2s(e[0], e[1], xf.current), b = w2s(e[2], e[3], xf.current); ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); });
        if (gd.seg) { const a = w2s(gd.seg[0], gd.seg[1], xf.current), b = w2s(gd.seg[2], gd.seg[3], xf.current); ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
      }
      ctx.restore();
    }
    // Live segment dimensions near the cursor (length px + angle°; green if the
    // length was snapped equal to a neighbour edge).
    const dm = dimR.current;
    if (dm) {
      ctx.save();
      ctx.font = "bold 12px monospace";
      const lenTxt = ftPerPx != null ? (dm.len * ftPerPx).toFixed(1) + "pi" : Math.round(dm.len) + "px";
      const label = (dm.equal ? "= " : "") + lenTxt + "  " + Math.round(dm.ang) + "°";
      const tw = ctx.measureText(label).width, lx = dm.sx + 14, ly = dm.sy - 16, pad = 5;
      ctx.fillStyle = "rgba(8,10,24,0.88)"; ctx.strokeStyle = dm.equal ? "#44ff88" : "#2a3a60"; ctx.lineWidth = 1;
      ctx.fillRect(lx - pad, ly - 13, tw + pad * 2, 19); ctx.strokeRect(lx - pad, ly - 13, tw + pad * 2, 19);
      ctx.fillStyle = dm.equal ? "#44ff88" : "#cdd8f5"; ctx.fillText(label, lx, ly);
      ctx.restore();
    }
    // Accessories (Maximum) — footprint + opening + slope arrow + label, and the
    // placement ghost. Same accessories[] feeds 2D and 3D.
    (function () {
      const drawSym = function (fp: any[], slopeAxis: any, pos: any, col: string, label: string, fill: string) {
        ctx.save();
        ctx.beginPath();
        fp.forEach(function (p: any, i: number) { const s = w2s(p[0], p[1], xf.current); if (i === 0) ctx.moveTo(s.sx, s.sy); else ctx.lineTo(s.sx, s.sy); });
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
        const c = w2s(pos.x, pos.y, xf.current);
        ctx.beginPath(); ctx.arc(c.sx, c.sy, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();   // opening/col
        if (slopeAxis) { const half = fp && fp.length ? Math.hypot(fp[0][0] - pos.x, fp[0][1] - pos.y) : ACC_FOOTPRINT_HALF_PX; const reach = half + 14 / xf.current.scale; const tip = w2s(pos.x + slopeAxis[0] * reach, pos.y + slopeAxis[1] * reach, xf.current); ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(tip.sx, tip.sy); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.beginPath(); ctx.arc(tip.sx, tip.sy, 3, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
        ctx.font = "bold 11px monospace"; ctx.fillStyle = col; ctx.fillText(label, c.sx + 8, c.sy - 10);
        ctx.restore();
      };
      accessories.forEach(function (a: any, i: number) {
        const pl = placedForAcc(a);
        if (!pl) {   // orphan: warn at the last known px position
          const px2 = a.anchor && a.anchor.fallback_anchor_px; if (!px2) return;
          const s = w2s(px2.x, px2.y, xf.current); ctx.save(); ctx.strokeStyle = "#ff5555"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s.sx - 7, s.sy - 7); ctx.lineTo(s.sx + 7, s.sy + 7); ctx.moveTo(s.sx + 7, s.sy - 7); ctx.lineTo(s.sx - 7, s.sy + 7); ctx.stroke();
          ctx.font = "bold 10px monospace"; ctx.fillStyle = "#ff5555"; ctx.fillText("MAX orphelin", s.sx + 9, s.sy); ctx.restore(); return;
        }
        const sel = i === selAcc, col = sel ? "#ffee44" : "#44ddaa";
        drawSym(pl.footprint, pl.slopeAxis, pl.pos, col, "MAX " + (a.variant_id || "301"), sel ? "rgba(255,238,68,0.16)" : "rgba(68,221,170,0.14)");
      });
      const g = accGhost.current;
      if (placingAcc && g) {
        if (g.valid) drawSym(g.footprint, g.slopeAxis, g.pos, "#44ff88", "MAX 301-16", "rgba(68,255,136,0.18)");
        else { const s = w2s(g.pos.x, g.pos.y, xf.current); ctx.save(); ctx.strokeStyle = "#ff5555"; ctx.setLineDash([5, 4]); ctx.strokeRect(s.sx - 18, s.sy - 18, 36, 36); ctx.setLineDash([]); ctx.font = "10px monospace"; ctx.fillStyle = "#ff5555"; ctx.fillText("vise une faîtière", s.sx + 10, s.sy); ctx.restore(); }
      }
    })();
    // Debug overlay (image-native): image bounding rect + origin + X/Y axes,
    // projected through the SAME xf transform the points use.
    if (dbg && bgImg && bgImg.naturalWidth) {
      const iw = bgImg.naturalWidth, ih = bgImg.naturalHeight, xfc = xf.current;
      const o = w2s(0, 0, xfc), ax = w2s(iw, 0, xfc), ay = w2s(0, ih, xfc), far = w2s(iw, ih, xfc);
      ctx.save();
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1; ctx.strokeStyle = "#39d0ff";
      ctx.strokeRect(o.sx, o.sy, far.sx - o.sx, far.sy - o.sy); ctx.setLineDash([]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ff5544"; ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(ax.sx, ax.sy); ctx.stroke();
      ctx.strokeStyle = "#44ff88"; ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(ay.sx, ay.sy); ctx.stroke();
      ctx.font = "11px monospace";
      ctx.fillStyle = "#ff5544"; ctx.fillText("X", ax.sx - 12, ax.sy + 14);
      ctx.fillStyle = "#44ff88"; ctx.fillText("Y", ay.sx + 6, ay.sy - 4);
      ctx.fillStyle = "#cdd6f0"; ctx.beginPath(); ctx.arc(o.sx, o.sy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillText("0,0", o.sx + 6, o.sy + 12);
      ctx.restore();
    }
    // Compass rose (only on a georeferenced frozen view): screen-fixed, N = up.
    // A purple double-ended needle shows the dominant building axis vs north.
    if (geoRef && geoRef.north_up) {
      const bb = buildingBearing();
      const R = 34, cx = c.width - R - 18, cy = R + 18;
      ctx.save();
      ctx.fillStyle = "rgba(8,10,24,0.82)"; ctx.strokeStyle = "#2a2350"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = "bold 10px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      [["N", 0], ["E", 90], ["S", 180], ["O", 270]].forEach(function (cd: any) {
        const a = (cd[1] as number) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
        ctx.strokeStyle = "#3a3a66"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx + dx * (R - 6), cy + dy * (R - 6)); ctx.lineTo(cx + dx * R, cy + dy * R); ctx.stroke();
        ctx.fillStyle = cd[0] === "N" ? "#ff6677" : "#8a93a8"; ctx.fillText(cd[0], cx + dx * (R - 13), cy + dy * (R - 13));
      });
      ctx.strokeStyle = "#ff6677"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - (R - 8)); ctx.stroke();
      if (bb != null) {
        const a = bb * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
        ctx.strokeStyle = "#aa88ff"; ctx.lineWidth = 2.5; ctx.beginPath();
        ctx.moveTo(cx - dx * (R - 10), cy - dy * (R - 10)); ctx.lineTo(cx + dx * (R - 10), cy + dy * (R - 10)); ctx.stroke();
      }
      ctx.fillStyle = "#aa88ff"; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.font = "9px monospace"; ctx.fillStyle = "#9a93c8";
      if (bb != null) ctx.fillText("axe " + Math.round(bb) + "° " + cardinal8(bb), cx, cy + R + 3);
      ctx.restore();
    }
  }, [secs, ai, sel, prev, bgImg, bgOp, selNode, valleys, selV, solid, tick, cvSz, alts, dbg, accessories, selAcc, placingAcc, geoRef, hideAnnotations, selAltIdx, imgFilter, showBuildingOverlay, showLotOverlay, buildingOverlayPx, lotOverlayPx]);

  useEffect(function () {
    const c = cv3.current; if (!c) return;
    const loop = function () {
      raf3.current = requestAnimationFrame(loop);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      if (w <= 0 || h <= 0) return;
      const ctx = c.getContext("2d");
      const fpp = ftPerPxR.current;
      const areaFmt = fpp != null ? function (px2: number) { return Math.round(px2 * fpp * fpp).toLocaleString("fr-CA") + " pi²"; } : undefined;
      // Toggle 👁️ : override hidden=true sur toutes les sections au rendu seulement.
      // Solo mode : court-circuite les sections != ai en vidant leur pts pour
      // que render3D les skip totalement (check pts.length < 3 au début du loop).
      const aiNow = aiR.current;
      let renderSecs = hideAnnRef.current ? secsR.current.map(function (s: any) { return Object.assign({}, s, { hidden: true }); }) : secsR.current;
      if (solo3DR.current) {
        renderSecs = renderSecs.map(function (s: any, si: number) { return si === aiNow ? s : Object.assign({}, s, { pts: [], closed: false }); });
      }
      render3D(ctx, w, h, renderSecs, sel3DR.current, orb.current, hCache, solidR.current, valleysR.current, selVR.current, hlR.current, selFaceR.current, areaFmt, membraneSegsR.current);
      // Minimal 3D proxy for placed accessories (curb box + cap), same camera.
      const prox = accProxR.current;
      if (prox && prox.length) {
        const ss = sceneScale(secsR.current);
        if (ss) {
          const sc = ss.sc, ox = ss.ox, oy = ss.oy, o = orb.current;
          const vw = buildView(o.phi, o.theta, o.r), fov = 50 * Math.PI / 180;
          prox.forEach(function (pr: any) {
            pr.quads.forEach(function (q: any) {
              const sp = q.pts.map(function (p: any) { return proj3((p.x - ox) * sc, p.z * sc, (p.y - oy) * sc, vw, fov, w, h); });
              if (sp.some(function (p: any) { return !p; })) return;
              ctx.beginPath(); sp.forEach(function (p: any, i: number) { if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy); });
              ctx.closePath(); ctx.globalAlpha = 0.92; ctx.fillStyle = q.color; ctx.fill(); ctx.globalAlpha = 1;
              ctx.strokeStyle = q.sel ? "#ffee44" : "rgba(0,0,0,0.45)"; ctx.lineWidth = q.sel ? 2 : 1; ctx.stroke();
            });
          });
        }
      }
    };
    loop(); return function () { cancelAnimationFrame(raf3.current); };
  }, []);

  // Build the 3D accessory proxies (px + pre-sc height) when placement changes.
  useEffect(function () {
    const out: any[] = [];
    accessories.forEach(function (a: any, i: number) {
      const pl = placedForAcc(a); if (!pl) return;
      const sec = secsR.current[pl.idx];
      let z0 = sec ? sectionRoofHeightAt(sec, pl.pos.x, pl.pos.y) : 0;
      if (!isFinite(z0)) z0 = sec && sec.elev ? sec.elev * 0.5 : 0;
      const fp = pl.footprint, H = accHeightPx(a.variant_id || "301-16"), capGap = H * 0.18, sel = i === selAcc;
      const base = fp.map(function (p: any) { return { x: p[0], y: p[1], z: z0 }; });
      const top = fp.map(function (p: any) { return { x: p[0], y: p[1], z: z0 + H }; });
      const quads: any[] = [{ pts: top, color: "#aeb6bf", sel: sel }];
      for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; quads.push({ pts: [base[k], base[j], top[j], top[k]], color: "#9CA3A8", sel: sel }); }
      const cap = fp.map(function (p: any) { return { x: pl.pos.x + (p[0] - pl.pos.x) * 0.6, y: pl.pos.y + (p[1] - pl.pos.y) * 0.6, z: z0 + H + capGap }; });
      quads.push({ pts: cap, color: "#6b7280", sel: sel });
      out.push({ quads: quads });
    });
    accProxR.current = out;
  }, [accessories, secs, selAcc, geoRef]);

  useEffect(function () {
    const c = cv3.current; if (!c) return;
    function getScr(e: any) { const rect = c.getBoundingClientRect(), src = e.touches && e.touches[0] || e.changedTouches && e.changedTouches[0] || e; return { x: src.clientX - rect.left, y: src.clientY - rect.top }; }
    function onD(e: any) {
      e.preventDefault();
      if (e.touches && e.touches.length === 2) { orb.current.down = false; const t1 = e.touches[0], t2 = e.touches[1]; orb.current.pinch = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY); return; }
      const xy = getScr(e), x = xy.x, y = xy.y;
      // SOLID mode: grab the tapped solid and drag it in Z (no orbit, no edit handles).
      if (edit3dR.current === "solid") {
        const vw = buildView(orb.current.phi, orb.current.theta, orb.current.r), fov = 50 * Math.PI / 180;
        const hf = hitFaceDetailed(x, y, secsR.current, vw, fov, c.clientWidth, c.clientHeight);
        if (hf) {
          const sec = secsR.current[hf.si];
          zdrag3.current = { active: true, si: hf.si, startElev: sec.elev || 0, startY: y, k: 2 };
          setSelFace(null); setSel3D({ sec: hf.si, edge: -1 }); setZinfo("Z " + Math.round(sec.elev || 0));
          return;
        }
      }
      // Otherwise begin an orbit. Face selection is decided on pointer-UP so a
      // drag (orbit) keeps the current selection — only a tap selects a face.
      orb.current.down = true; orb.current.moved = false;
      const src2 = e.touches && e.touches[0] || e;
      orb.current.lx = src2.clientX; orb.current.ly = src2.clientY;
      orb.current.downCX = src2.clientX; orb.current.downCY = src2.clientY;
    }
    function onU(e: any) {
      const wasDown = orb.current.down, moved = orb.current.moved;
      orb.current.down = false; orb.current.pinch = null;
      if (zdrag3.current.active) { zdrag3.current.active = false; setZinfo(null); return; }
      // SURFACE mode: a tap (no orbit) selects/deselects a face.
      if (wasDown && !moved && edit3dR.current === "surface") {
        const xy = getScr(e), x = xy.x, y = xy.y;
        const vw = buildView(orb.current.phi, orb.current.theta, orb.current.r), fov = 50 * Math.PI / 180;
        const hf = hitFaceDetailed(x, y, secsR.current, vw, fov, c.clientWidth, c.clientHeight);
        if (hf) {
          const cur = selFaceR.current;
          if (cur && cur.si === hf.si && cur.fi === hf.fi) { setSelFace(null); setSel3D({ sec: -1, edge: -1 }); }
          else { setSelFace(hf); setSel3D({ sec: hf.si, edge: -1 }); }
        } else { setSelFace(null); setSel3D({ sec: -1, edge: -1 }); }
      }
      if (wasDown && moved) emitView();   // orbite relâchée → persiste la vue
    }
    function onM(e: any) {
      e.preventDefault && e.preventDefault();
      if (e.touches && e.touches.length === 2 && orb.current.pinch != null) { const t1 = e.touches[0], t2 = e.touches[1]; const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY); orb.current.r = Math.max(3, Math.min(35, orb.current.r + (orb.current.pinch - d) * 0.04)); orb.current.pinch = d; return; }
      if (zdrag3.current.active) {
        const xy = getScr(e), zd = zdrag3.current, dsy = xy.y - zd.startY;
        const newElev = Math.max(-4000, Math.min(4000, zd.startElev - dsy * zd.k));
        setSecs(function (ss: any) { const ns = ss.slice(); ns[zd.si] = Object.assign({}, ns[zd.si], { elev: newElev }); return ns; });
        const d = newElev - zd.startElev; setZinfo("Z " + Math.round(newElev) + "   (" + (d >= 0 ? "+" : "") + Math.round(d) + ")");
        return;
      }
      if (orb.current.down) { const src = e.touches && e.touches[0] || e; if (Math.hypot(src.clientX - orb.current.downCX, src.clientY - orb.current.downCY) > 9) orb.current.moved = true; orb.current.theta -= (src.clientX - orb.current.lx) * 0.012; orb.current.phi = Math.max(0.02, Math.min(Math.PI - 0.02, orb.current.phi - (src.clientY - orb.current.ly) * 0.012)); orb.current.lx = src.clientX; orb.current.ly = src.clientY; }
    }
    let wheelTimer: any = null;
    function onW(e: any) { orb.current.r = Math.max(3, Math.min(35, orb.current.r + e.deltaY * 0.012)); e.preventDefault(); if (wheelTimer) clearTimeout(wheelTimer); wheelTimer = setTimeout(emitView, 280); }
    c.addEventListener("mousedown", onD); window.addEventListener("mouseup", onU); window.addEventListener("mousemove", onM);
    c.addEventListener("wheel", onW, { passive: false });
    c.addEventListener("touchstart", onD, { passive: false }); c.addEventListener("touchmove", onM, { passive: false }); c.addEventListener("touchend", onU, { passive: true });
    return function () { c.removeEventListener("mousedown", onD); window.removeEventListener("mouseup", onU); window.removeEventListener("mousemove", onM); c.removeEventListener("wheel", onW); c.removeEventListener("touchstart", onD); c.removeEventListener("touchmove", onM); c.removeEventListener("touchend", onU); };
  }, [updSkel]);

  const getXY = useCallback(function (e: any) {
    const c = cv2.current, rect = c.getBoundingClientRect(), isT = !!(e.touches || e.changedTouches);
    const src = isT ? (e.touches && e.touches[0] || e.changedTouches && e.changedTouches[0]) : e;
    const rawX = src.clientX - rect.left, rawY = src.clientY - rect.top;
    const sc2 = xf.current.scale, tx2 = xf.current.tx, ty2 = xf.current.ty, offY = isT ? TOFF : 0;
    const px = (rawX - tx2) / sc2, py = ((rawY - offY) - ty2) / sc2, wx = (rawX - tx2) / sc2, wy = (rawY - ty2) / sc2;
    return { rawX, rawY, wx, wy, px, py, sx: px * sc2 + tx2, sy: py * sc2 + ty2, isT };
  }, []);

  const hitV = useCallback(function (wx: number, wy: number) {
    const r = HITR / xf.current.scale, pts = secsR.current[aiR.current] && secsR.current[aiR.current].pts || [];
    for (let i = pts.length - 1; i >= 0; i--) if (Math.hypot(wx - pts[i].x, wy - pts[i].y) <= r) return i;
    return -1;
  }, []);
  const hitSec = useCallback(function (wx: number, wy: number) {
    const r = 18 / xf.current.scale, ss = secsR.current;
    for (let si = ss.length - 1; si >= 0; si--) { if (si === aiR.current) continue; for (let pi = 0; pi < ss[si].pts.length; pi++) if (Math.hypot(wx - ss[si].pts[pi].x, wy - ss[si].pts[pi].y) <= r) return si; }
    return -1;
  }, []);
  const findSnap = useCallback(function (px: number, py: number) {
    // Thresholds are constant in SCREEN pixels (divided by scale → world units),
    // so zooming in physically separates nearby features on screen and lets you
    // place a point between two close lines without the snap grabbing the wrong one.
    const sc = xf.current.scale, ss = secsR.current, ai0 = aiR.current;
    const rv = 18 / sc, re = 18 / sc;
    // 1) Strongest: snap to a vertex of another section.
    for (let si = 0; si < ss.length; si++) {
      if (si === ai0) continue;
      const pts = ss[si].pts;
      for (let pi = 0; pi < pts.length; pi++) if (Math.hypot(px - pts[pi].x, py - pts[pi].y) <= rv) return { x: pts[pi].x, y: pts[pi].y, edge: false };
    }
    // 1b) snap to the MIDPOINT (center) of another section's edge.
    for (let si = 0; si < ss.length; si++) {
      if (si === ai0) continue;
      const s = ss[si], n = s.pts.length, m = s.closed ? n : n - 1;
      for (let i = 0; i < m; i++) { const a = s.pts[i], b = s.pts[(i + 1) % n], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; if (Math.hypot(px - mx, py - my) <= rv) return { x: mx, y: my, edge: false, mid: true }; }
    }
    // 2) Otherwise snap ONTO the nearest edge of another section (perfect alignment).
    let best: any = null, bestD = re;
    for (let si = 0; si < ss.length; si++) {
      if (si === ai0) continue;
      const s = ss[si], n = s.pts.length, m = s.closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const a = s.pts[i], b = s.pts[(i + 1) % n];
        const pr = projPtSeg(px, py, a.x, a.y, b.x, b.y);
        if (pr.d < bestD) { bestD = pr.d; best = { x: pr.x, y: pr.y, edge: true }; }
      }
    }
    return best;
  }, []);

  // Snap for drawing, in priority order: (1) explicit points — vertices &
  // edge-midpoints of OTHER sections; (2) soft angle snap to 0/90/180/270° of
  // the previous segment (tolerance ~12°, so square corners lock but a
  // deliberate 70° stays free); (3) projection onto another section's edge.
  // Angle wins over edge so a perpendicular wall isn't pulled off by a nearby line.
  const computeSnap = useCallback(function (px: number, py: number) {
    const sc = xf.current.scale, ss = secsR.current, ai0 = aiR.current;
    const rv = 26 / sc, re = 26 / sc;
    for (let si = 0; si < ss.length; si++) {
      if (si === ai0) continue;
      const s = ss[si], n = s.pts.length;
      for (let pi = 0; pi < n; pi++) if (Math.hypot(px - s.pts[pi].x, py - s.pts[pi].y) <= rv) return { x: s.pts[pi].x, y: s.pts[pi].y, edge: false };
      const m = s.closed ? n : n - 1;
      for (let i = 0; i < m; i++) { const a = s.pts[i], b = s.pts[(i + 1) % n], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; if (Math.hypot(px - mx, py - my) <= rv) return { x: mx, y: my, edge: false, mid: true }; }
    }
    const cur = ss[ai0];
    let bx = px, by = py, angle = false;
    // (2) soft angle snap to 0/90/180/270° of the previous segment (~16°)
    // Gating fin : k=0/k=2 (parallèle même direction / direction inverse) →
    // contrôlé par sm.parallel ; k=1/k=3 (perpendiculaire CCW/CW) → contrôlé
    // par sm.perpendicular. Sans ce filtre, désactiver "//" laisse passer
    // les angles parallèles via cette logique (bug user).
    if (cur && !cur.closed && cur.pts.length >= 2) {
      const sm = snapModesR.current;
      const a = cur.pts[cur.pts.length - 1], b = cur.pts[cur.pts.length - 2];
      const refAng = Math.atan2(a.y - b.y, a.x - b.x), curAng = Math.atan2(py - a.y, px - a.x), dist = Math.hypot(px - a.x, py - a.y);
      // Tolérance angulaire resserrée 0.28 → 0.10 rad (~16° → ~6°) pour
      // un snap CAD-grade. Le snap ne se déclenche QUE quand l'utilisateur
      // est vraiment proche de l'angle cible — plus de tirage parasite.
      const angSnapTol = 0.10;
      for (let k = 0; k < 4; k++) {
        const isPar = (k === 0 || k === 2), isPerp = (k === 1 || k === 3);
        if (isPar && !sm.parallel) continue;
        if (isPerp && !sm.perpendicular) continue;
        const cand = refAng + k * Math.PI / 2;
        const diff = Math.atan2(Math.sin(curAng - cand), Math.cos(curAng - cand));
        if (Math.abs(diff) < angSnapTol) { bx = a.x + Math.cos(cand) * dist; by = a.y + Math.sin(cand) * dist; angle = true; break; }
      }
    }
    // (X/Y axis-align removed: it fought the building-relative collinear/parallel
    // guides and was misleading on rotated roofs.)
    if (angle) return { x: bx, y: by, edge: false, angle: angle };
    let best: any = null, bestD = re;
    for (let si = 0; si < ss.length; si++) {
      if (si === ai0) continue;
      const s = ss[si], n = s.pts.length, m = s.closed ? n : n - 1;
      for (let i = 0; i < m; i++) { const a = s.pts[i], b = s.pts[(i + 1) % n], pr = projPtSeg(px, py, a.x, a.y, b.x, b.y); if (pr.d < bestD) { bestD = pr.d; best = { x: pr.x, y: pr.y, edge: true }; } }
    }
    return best;
  }, []);

  // Alignment guides vs EVERY section's edges (any angle, across solids):
  //  - parallel: existing edges parallel to the segment being drawn → blue fluo.
  //  - collinear: existing edges whose infinite line passes through the cursor →
  //    fuchsia dashed extension, and the point snaps onto that line (generalises
  //    the X/Y align so it works on rotated roofs too).
  const computeGuides = useCallback(function (px: number, py: number) {
    const sc = xf.current.scale, ss = secsR.current, ai0 = aiR.current;
    const sm = snapModesR.current;
    // Tolérances resserrées pour un snap CAD-grade :
    //  - colTol 9 → 5 px world : on ne snap au "infinite line" QUE quand
    //    on est vraiment proche (≤ 5 px), plus de tirage parasite à 9 px.
    //  - angTol 4° → 2.5° pour la détection parallèle stricte.
    const colTol = 5 / sc, angTol = 2.5 * Math.PI / 180;
    const cur = ss[ai0], drawing = cur && !cur.closed && cur.pts.length >= 1;
    const ax = drawing ? cur.pts[cur.pts.length - 1].x : 0, ay = drawing ? cur.pts[cur.pts.length - 1].y : 0;
    const segLen = drawing ? Math.hypot(px - ax, py - ay) : 0;
    const segAng = segLen > 4 / sc ? Math.atan2(py - ay, px - ax) : null;
    const col: any[] = [], par: any[] = [];
    let bestCol: any = null, bestColD = colTol;
    // BAIL-OUT EARLY : si rien d'activé (toggles tous off), on retourne
    // immédiatement sans calculer ni guides ni snap. C'est ça que l'utilisateur
    // veut quand il clique sur tous les boutons pour les désactiver.
    if (!sm.collinear && !sm.parallel && !sm.perpendicular) {
      return { x: px, y: py, snapped: false, col: [], par: [], seg: drawing ? [ax, ay, px, py] : null };
    }
    for (let si = 0; si < ss.length; si++) {
      const s = ss[si], n = s.pts.length, m = s.closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const A = s.pts[i], Bp = s.pts[(i + 1) % n], ex = Bp.x - A.x, ey = Bp.y - A.y, eL = Math.hypot(ex, ey);
        if (eL < 1e-6) continue;
        const ux = ex / eL, uy = ey / eL;
        // Collinear : on ne calcule + display + snap QUE si sm.collinear actif
        if (sm.collinear) {
          const d = Math.abs((px - A.x) * uy - (py - A.y) * ux);   // distance to the infinite line A-B
          if (d < colTol) {
            col.push([A.x, A.y, Bp.x, Bp.y]);
            if (d < bestColD) { bestColD = d; bestCol = { ox: A.x, oy: A.y, ux: ux, uy: uy }; }
          }
        }
        // Parallel : display uniquement quand sm.parallel ET on est en train
        // de tracer un segment assez long pour avoir un angle stable.
        if (sm.parallel && segAng != null) {
          let dA = Math.atan2(Math.sin(segAng - Math.atan2(ey, ex)), Math.cos(segAng - Math.atan2(ey, ex)));
          if (Math.abs(dA) > Math.PI / 2) dA = dA > 0 ? dA - Math.PI : dA + Math.PI;
          if (Math.abs(dA) < angTol) par.push([A.x, A.y, Bp.x, Bp.y]);
        }
      }
    }
    let x = px, y = py, snapped = false;
    // Le snap collinear (curseur tiré sur la ligne infinie) ne se fait QUE
    // si sm.collinear actif. bestCol a déjà été filtré par le check ci-dessus
    // mais on garde la garde explicite pour clarté.
    if (sm.collinear && bestCol) {
      const t = (px - bestCol.ox) * bestCol.ux + (py - bestCol.oy) * bestCol.uy;
      x = bestCol.ox + t * bestCol.ux; y = bestCol.oy + t * bestCol.uy;
      snapped = true;
    }
    return { x: x, y: y, snapped: snapped, col: col, par: par, seg: drawing ? [ax, ay, x, y] : null };
  }, []);

  // Guides to DISPLAY for the FINAL placed point: fuchsia only for edges the
  // point actually lies on (never lie about collinearity), blue for edges
  // parallel to the final segment.
  const displayGuides = useCallback(function (fpx: number, fpy: number, a0: any) {
    const sc = xf.current.scale, ss = secsR.current, onEps = 0.8 / sc, angTol = 0.6 * Math.PI / 180;
    const sm = snapModesR.current;
    const segAng = (a0 && Math.hypot(fpx - a0.x, fpy - a0.y) > 4 / sc) ? Math.atan2(fpy - a0.y, fpx - a0.x) : null;
    const col: any[] = [], par: any[] = [];
    // Pareil que computeGuides : si toggles tous off, on retourne vide.
    if (!sm.collinear && !sm.parallel && !sm.perpendicular) return { col: col, par: par };
    for (let si = 0; si < ss.length; si++) {
      const s = ss[si], n = s.pts.length, m = s.closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const A = s.pts[i], Bp = s.pts[(i + 1) % n], ex = Bp.x - A.x, ey = Bp.y - A.y, eL = Math.hypot(ex, ey);
        if (eL < 1e-6) continue; const ux = ex / eL, uy = ey / eL;
        if (sm.collinear && Math.abs((fpx - A.x) * uy - (fpy - A.y) * ux) < onEps) col.push([A.x, A.y, Bp.x, Bp.y]);
        if (sm.parallel && segAng != null) {
          let dA = Math.atan2(Math.sin(segAng - Math.atan2(ey, ex)), Math.cos(segAng - Math.atan2(ey, ex)));
          if (Math.abs(dA) > Math.PI / 2) dA = dA > 0 ? dA - Math.PI : dA + Math.PI;
          if (Math.abs(dA) < angTol) par.push([A.x, A.y, Bp.x, Bp.y]);
        }
      }
    }
    return { col: col, par: par };
  }, []);

  cbD.current = function (e: any) {
    e.preventDefault();
    // Pinch start. Capture the baseline only on first entry into multi-touch
    // (lock) so a 3rd finger / jitter never resets it mid-zoom.
    if (e.touches && e.touches.length >= 2) { if (!p2.current.lock) { const t1 = e.touches[0], t2 = e.touches[1], rect = cv2.current.getBoundingClientRect(); p2.current = { active: true, lock: true, dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY), initScale: xf.current.scale, initTx: xf.current.tx, initTy: xf.current.ty, initMidSx: (t1.clientX + t2.clientX) / 2 - rect.left, initMidSy: (t1.clientY + t2.clientY) / 2 - rect.top }; } drag2.current.active = false; dragNode.current.active = false; return; }
    const xy = getXY(e), wx = xy.wx, wy = xy.wy, rawX = xy.rawX, rawY = xy.rawY;
    // Placement mode: a tap places on the hovered ridge (handled in cbU). Don't draw.
    if (placingAcc) return;
    // Grab a placed accessory (select + constrained drag) if pressed on its footprint.
    for (let i = accessories.length - 1; i >= 0; i--) {
      const pl = placedForAcc(accessories[i]); if (!pl) continue;
      if (Math.hypot(wx - pl.pos.x, wy - pl.pos.y) < accHalfPx(accessories[i].variant_id || "301-16") + 8 / xf.current.scale) {
        accDrag.current = { active: true, idx: i, ridge: pl.ridge, panSide: accessories[i].anchor.pan_side };
        setSelAcc(i); drag2.current.active = false; dragNode.current.active = false; return;
      }
    }
    const curSec = secsR.current[aiR.current];
    if (curSec && curSec.closed && curSec._skel) {
      const hitR = 16 / xf.current.scale, nodes = skelNodes(curSec._skel, curSec._no || {});
      let hit = null; for (let ni = 0; ni < nodes.length; ni++) { if (Math.hypot(wx - nodes[ni].x, wy - nodes[ni].y) <= hitR) { hit = nodes[ni]; break; } }
      if (hit) {
        // Guide direction = the section's longest footprint edge (≈ the ridge
        // axis), so a dragged ridge node slides parallel to the walls by default.
        const p = curSec.pts; let bl = -1, gdx = 1, gdy = 0;
        for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length, dx = p[j].x - p[i].x, dy = p[j].y - p[i].y, L = Math.hypot(dx, dy); if (L > bl) { bl = L; gdx = dx / L; gdy = dy / L; } }
        // If this is a ridge node, find its ridge partner (current displayed pos)
        // so the ridge can be kept parallel to the side while dragging.
        let partner: any = null; const sk0 = curSec._skel;
        if (sk0) { for (let ei = 0; ei < sk0.edges.length; ei++) { const e = sk0.edges[ei]; if (!e.isRidge) continue; const ka = nk(e.ax, e.ay), kb = nk(e.bx, e.by); if (kb === hit.key) partner = { x: e.ax, y: e.ay, k: ka }; else if (ka === hit.key) partner = { x: e.bx, y: e.by, k: kb }; } }
        if (partner) { const ov = (curSec._no || {})[partner.k]; if (ov) { partner.x = ov.x; partner.y = ov.y; } }
        dragNode.current = { active: true, si: aiR.current, key: hit.key, ox: hit.x, oy: hit.y, startWx: wx, startWy: wy, gdx: gdx, gdy: gdy, partner: partner ? { x: partner.x, y: partner.y } : null };
        setSelNode({ si: aiR.current, key: hit.key }); drag2.current.active = false; return;
      }
    }
    dragNode.current.active = false;
    // Ghost midpoint hit : tap sur un rond creux entre 2 corners de la section
    // active → insertion d'un nouveau vertex à cet endroit. Le drag commence
    // dessus immédiatement pour que l'user puisse le positionner par glissement.
    // Permet de suivre des contours irréguliers (L-shape, T-shape, encoignures)
    // sans avoir à redessiner la section au complet.
    if (curSec && curSec.closed && curSec.pts.length >= 2) {
      const mhR = 14 / xf.current.scale;
      for (let i = 0; i < curSec.pts.length; i++) {
        const a = curSec.pts[i], b = curSec.pts[(i + 1) % curSec.pts.length];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (Math.hypot(wx - mx, wy - my) <= mhR) {
          const newIdx = i + 1;
          setSecs(function (ss: any) {
            const ns = ss.slice(), sc2 = Object.assign({}, ns[aiR.current]);
            const np = sc2.pts.slice();
            np.splice(newIdx, 0, { x: mx, y: my });
            ns[aiR.current] = Object.assign({}, sc2, { pts: np });
            return ns;
          });
          setSel(newIdx);
          drag2.current = { active: true, idx: newIdx, sx: rawX, sy: rawY, moved: false };
          setTimeout(function () { updSkel(aiR.current); }, 0);
          return;
        }
      }
    }
    const idx = hitV(wx, wy);
    drag2.current = { active: true, idx, sx: rawX, sy: rawY, moved: false }; if (idx >= 0) setSel(idx);
  };

  cbM.current = function (e: any) {
    e.preventDefault();
    if (e.touches && e.touches.length >= 2 && p2.current.active) {
      const t1 = e.touches[0], t2 = e.touches[1], rect = cv2.current.getBoundingClientRect();
      const nd = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const p2d = p2.current, rs = p2d.initScale * (nd / p2d.dist);
      const mwx = (p2d.initMidSx - p2d.initTx) / p2d.initScale, mwy = (p2d.initMidSy - p2d.initTy) / p2d.initScale;
      const cmx = (t1.clientX + t2.clientX) / 2 - rect.left, cmy = (t1.clientY + t2.clientY) / 2 - rect.top;
      xf.current = clamp({ scale: rs, tx: cmx - mwx * rs, ty: cmy - mwy * rs });
      // Update the transform every move but coalesce redraws to one per frame so
      // the zoom (image + annotations) stays smooth instead of jerky.
      if (!pinchRaf.current) pinchRaf.current = requestAnimationFrame(function () { pinchRaf.current = 0; setTick(function (t) { return t + 1; }); });
      return;
    }
    // A finger still down after a pinch: ignore it (no pan/draw) until full release.
    if (p2.current.lock) return;
    const xy = getXY(e), rawX = xy.rawX, rawY = xy.rawY, wx = xy.wx, wy = xy.wy, px = xy.px, py = xy.py, sx = xy.sx, sy = xy.sy, isT = xy.isT;
    // Drag a placed accessory: project onto its ridge frame (parallel + amont/aval only).
    if (accDrag.current.active) {
      const ad = accDrag.current, f = projectToFrame({ x: wx, y: wy }, ad.ridge, ad.panSide);
      setAccessories(function (list: any) { const ns = list.slice(), a = ns[ad.idx]; if (!a) return list; ns[ad.idx] = Object.assign({}, a, { anchor: Object.assign({}, a.anchor, { edge_t: f.edge_t, slope_offset_mm: +f.slope_offset_mm.toFixed(1) }) }); return ns; });
      return;
    }
    // Placement ghost: snap to the nearest ridge under the cursor.
    if (placingAcc) {
      const nr = nearestAccRidge(wx, wy);
      if (nr) { const f = projectToFrame({ x: wx, y: wy }, nr.ridge, "primary"); const tmp = makeAnchor({ section_id: "S" + (nr.idx + 1), edge_t: f.edge_t, slope_offset_mm: f.slope_offset_mm }); const pl = resolvePlaced(tmp, nr.ridge, accHalfPx("301-16")); accGhost.current = { valid: true, idx: nr.idx, ridge: nr.ridge, edge_t: f.edge_t, slope_offset: f.slope_offset_mm, pos: pl.pos, footprint: pl.footprint, slopeAxis: pl.slopeAxis }; }
      else accGhost.current = { valid: false, pos: { x: wx, y: wy } };
      setTick(function (t) { return t + 1; });
      return;
    }
    if (dragNode.current.active) {
      const dn = dragNode.current;
      let tx = dn.ox + (wx - dn.startWx), ty = dn.oy + (wy - dn.startWy);
      const nx = -dn.gdy, ny = dn.gdx, tol = 14 / xf.current.scale;
      let on = false, gox: number, goy: number, ridge = false;
      if (dn.partner) {
        // Keep the ridge PARALLEL to the side: match the dragged node's
        // perpendicular coord to the partner's (the ridge turns blue when on).
        const diff = (tx - dn.partner.x) * nx + (ty - dn.partner.y) * ny;
        if (Math.abs(diff) < tol) { tx -= diff * nx; ty -= diff * ny; on = true; }
        gox = dn.partner.x; goy = dn.partner.y; ridge = true;
      } else {
        // Non-ridge node: snap perpendicular onto the footprint centerline.
        const fp = secsR.current[dn.si].pts; let cx = 0, cy = 0; for (let k = 0; k < fp.length; k++) { cx += fp[k].x; cy += fp[k].y; } cx /= fp.length; cy /= fp.length;
        const perpC = (tx - cx) * nx + (ty - cy) * ny;
        if (Math.abs(perpC) < tol) { tx -= perpC * nx; ty -= perpC * ny; on = true; }
        gox = cx; goy = cy;
      }
      dragGuide.current = { ox: gox, oy: goy, dx: dn.gdx, dy: dn.gdy, on: on, center: !ridge, ridge: ridge };
      const sp = snap3D(secsR.current, tx, ty, tol); tx = sp.x; ty = sp.y;
      setSecs(function (ss: any) { const ns = ss.slice(), sc2 = Object.assign({}, ns[dn.si]); ns[dn.si] = Object.assign({}, sc2, { _no: Object.assign({}, sc2._no, { [dn.key]: { x: tx, y: ty } }) }); return ns; });
      return;
    }
    const d = drag2.current;
    if (d.active && d.idx >= 0 && Math.hypot(rawX - d.sx, rawY - d.sy) > 5) {
      d.moved = true;
      const cur = secsR.current[aiR.current];
      const vsn = findSnap(px, py);   // (1) snap onto other sections' lines/points
      let vx = vsn ? vsn.x : px, vy = vsn ? vsn.y : py;
      perpR.current = null;
      if (!vsn) {
        // (2) perpendicular snap: square the corner against its neighbour edges
        // (works for rotated rectangles); the locked edges turn red. Respecte
        // le toggle ⊥ — si le user a désactivé le snap 90°, on ne snappe PAS
        // (sinon le toggle ne sert à rien pendant un drag de coin).
        const perp = snapModesR.current.perpendicular
          ? perpCornerSnap(cur.pts, d.idx, vx, vy, 26 / xf.current.scale)
          : null;
        if (perp) { vx = perp.x; vy = perp.y; perpR.current = { si: aiR.current, segs: perp.segs }; }
        else {   // (3) fallback: align to this section's other corners (x & y)
          const al = 22 / xf.current.scale, rvx = vx, rvy = vy; let ndx = al, ndy = al;
          for (let k = 0; k < cur.pts.length; k++) { if (k === d.idx) continue; const dx = Math.abs(rvx - cur.pts[k].x); if (dx < ndx) { ndx = dx; vx = cur.pts[k].x; } const dy = Math.abs(rvy - cur.pts[k].y); if (dy < ndy) { ndy = dy; vy = cur.pts[k].y; } }
        }
      }
      setSecs(function (ss: any) { const ns = ss.slice(), sc2 = Object.assign({}, ns[aiR.current]), np = sc2.pts.slice(); np[d.idx] = { x: vx, y: vy }; ns[aiR.current] = Object.assign({}, sc2, { pts: np }); return ns; });
      setTimeout(function () { updSkel(aiR.current); }, 0);
    }
    const cd = secsR.current[aiR.current];
    const a0 = (cd && !cd.closed && cd.pts.length >= 1) ? cd.pts[cd.pts.length - 1] : null;
    let used: any = null, fpx = px, fpy = py, equal = false, closing = false;
    // (1) CLOSE — top priority: lock onto vertex 0 when the cursor is near it so
    // no other snap can pull the point away and the tap reliably closes the loop.
    if (cd && !cd.closed && cd.pts.length >= 3) {
      const v0 = cd.pts[0], v0s = w2s(v0.x, v0.y, xf.current);
      if (Math.hypot(sx - v0s.sx, sy - v0s.sy) < 30) { used = { x: v0.x, y: v0.y, close: true }; fpx = v0.x; fpy = v0.y; closing = true; }
    }
    const snap = closing ? null : computeSnap(px, py);
    const g: any = closing ? { snapped: false, col: [], par: [] } : computeGuides(px, py);
    if (!closing) {
      // (2) vertex/midpoint of other sections > (3) collinear > (4) parallel +
      // equal-length (all building-relative) > (5) 90° corner / edge proj fallback.
      const sm = snapModesR.current;
      const strong = snap && snap.edge === false && !snap.angle;
      if (strong) { used = snap; fpx = snap.x; fpy = snap.y; }
      else if (g.snapped && sm.collinear) { used = { x: g.x, y: g.y, edge: false, collinear: true }; fpx = g.x; fpy = g.y; }
      else if (a0) {
        const sc3 = xf.current.scale, ss2 = secsR.current; let par = false;
        const segdx = fpx - a0.x, segdy = fpy - a0.y, segL = Math.hypot(segdx, segdy);
        if (sm.parallel && segL > 6 / sc3) {
          const segAng = Math.atan2(segdy, segdx); let bU: any = null, bAd = 4 * Math.PI / 180;
          for (let si = 0; si < ss2.length; si++) { const s = ss2[si], n = s.pts.length, m = s.closed ? n : n - 1; for (let i = 0; i < m; i++) { const A = s.pts[i], Bp = s.pts[(i + 1) % n], ex = Bp.x - A.x, ey = Bp.y - A.y, eL = Math.hypot(ex, ey); if (eL < 1e-6) continue; let dA = Math.atan2(Math.sin(segAng - Math.atan2(ey, ex)), Math.cos(segAng - Math.atan2(ey, ex))); if (Math.abs(dA) > Math.PI / 2) dA = dA > 0 ? dA - Math.PI : dA + Math.PI; if (Math.abs(dA) < bAd) { bAd = Math.abs(dA); bU = { ux: ex / eL, uy: ey / eL }; } } }
          if (bU) { const t = segdx * bU.ux + segdy * bU.uy; fpx = a0.x + t * bU.ux; fpy = a0.y + t * bU.uy; par = true; }
        }
        const len2 = Math.hypot(fpx - a0.x, fpy - a0.y);
        if (len2 > 1e-3) {
          const tolL = 10 / sc3; let eq: any = null, eqd = tolL;
          for (let si = 0; si < ss2.length; si++) { const s = ss2[si], n = s.pts.length, m = s.closed ? n : n - 1; for (let i = 0; i < m; i++) { const A = s.pts[i], Bp = s.pts[(i + 1) % n], L = Math.hypot(Bp.x - A.x, Bp.y - A.y); if (Math.abs(L - len2) < eqd) { eqd = Math.abs(L - len2); eq = L; } } }
          if (eq != null) { const ux = (fpx - a0.x) / len2, uy = (fpy - a0.y) / len2; fpx = a0.x + ux * eq; fpy = a0.y + uy * eq; equal = true; }
        }
        if (par || equal) used = { x: fpx, y: fpy, edge: false, equal: equal };
      }
      // 90° / angle snap fallback (perpendicular). Filter out angle snaps when
      // the perpendicular mode is disabled so the user can place obtuse corners
      // (turret faces, cone gores) without a 90° pull.
      if (!used && snap && !(snap.angle && !sm.perpendicular)) { used = snap; fpx = snap.x; fpy = snap.y; }
    }
    // Length lock: force the candidate point onto the circle of radius refLen
    // centered on the previous vertex. Applied AFTER snaps so the locked length
    // wins (the user explicitly asked for a fixed distance).
    if (a0) { const cp = constrainToLockedLen(a0, fpx, fpy); fpx = cp.x; fpy = cp.y; }
    let dim: any = null;
    if (a0) { const len = Math.hypot(fpx - a0.x, fpy - a0.y); let ang = Math.atan2(fpy - a0.y, fpx - a0.x) * 180 / Math.PI; if (ang < 0) ang += 360; dim = { len: len, ang: ang, equal: equal, sx: fpx * xf.current.scale + xf.current.tx, sy: fpy * xf.current.scale + xf.current.ty }; }
    dimR.current = dim;
    snapR.current = used; setSnapPt(used);
    const fsx = (fpx * xf.current.scale + xf.current.tx), fsy = (fpy * xf.current.scale + xf.current.ty);
    // Guides reflect the FINAL point: fuchsia ⟺ the point lies on that line.
    const a0d = (!closing && cd && !cd.closed && cd.pts.length >= 1) ? cd.pts[cd.pts.length - 1] : null;
    const dg = closing ? { col: [], par: [] } : displayGuides(fpx, fpy, a0d);
    guideR.current = (dg.col.length || dg.par.length) ? { col: dg.col, par: dg.par, seg: a0d ? [a0d.x, a0d.y, fpx, fpy] : null } : null;
    setPrev({ wx, wy, px: fpx, py: fpy, sx: fsx, sy: fsy, rawX, rawY, isT, snapped: !!used, snapEdge: !!(used && used.edge), snapAngle: !!(snap && snap.angle), snapAlign: false });
  };

  cbU.current = function (e: any) {
    e.preventDefault();
    guideR.current = null; dimR.current = null;   // guides recompute on the next move
    // While a pinch is in progress OR fingers remain after one, never run tap /
    // add-point / select logic. The lock clears only once ALL fingers are up,
    // so lifting the 2nd finger can't drop a stray vertex.
    if (p2.current.active || p2.current.lock) { p2.current.active = false; if ((e.touches ? e.touches.length : 0) === 0) { p2.current.lock = false; drag2.current.active = false; dragNode.current.active = false; } if (pinchRaf.current) { cancelAnimationFrame(pinchRaf.current); pinchRaf.current = 0; } setTick(function (t) { return t + 1; }); return; }
    if (dragNode.current.active) { dragNode.current.active = false; dragGuide.current = null; setSecs(function (ss: any) { return ss.slice(); }); return; }
    if (accDrag.current.active) { accDrag.current.active = false; return; }
    // Placement: commit on the tapped ridge. On a tap with no prior hover the
    // ghost is null, so resolve the nearest ridge at the tap point directly.
    if (placingAcc) {
      const xyp = getXY(e); let g = accGhost.current;
      if (!g || !g.valid) {
        const nr = nearestAccRidge(xyp.wx, xyp.wy);
        if (nr) { const f = projectToFrame({ x: xyp.wx, y: xyp.wy }, nr.ridge, "primary"); const pl = resolvePlaced(makeAnchor({ section_id: "S" + (nr.idx + 1), edge_t: f.edge_t, slope_offset_mm: f.slope_offset_mm }), nr.ridge, accHalfPx("301-16")); g = { valid: true, idx: nr.idx, edge_t: f.edge_t, slope_offset: f.slope_offset_mm, pos: pl.pos }; }
      }
      if (g && g.valid) { commitAccessory(g.idx, g.edge_t, g.slope_offset, g.pos); setPlacingAcc(false); accGhost.current = null; }
      setTick(function (t) { return t + 1; });
      return;
    }
    const xy = getXY(e), rawX = xy.rawX, rawY = xy.rawY, wx = xy.wx, wy = xy.wy, px = xy.px, py = xy.py, sx = xy.sx, sy = xy.sy;
    const d = drag2.current; d.active = false;
    if (perpR.current) { perpR.current = null; setSecs(function (ss: any) { return ss.slice(); }); }
    if (!d.moved) {
      const s = secsR.current[aiR.current];
      // Length-lock picking: a single click anywhere over an existing segment
      // captures its length; we then exit picking and short-circuit normal
      // click handling (no point added, no selection change).
      if (lengthLockR.current.picking) {
        const tol = 16 / xf.current.scale; let bestD = tol, bestL = 0;
        for (const ss of secsR.current) {
          const n = ss.pts.length, m = ss.closed ? n : n - 1;
          for (let i = 0; i < m; i++) {
            const a = ss.pts[i], b = ss.pts[(i + 1) % n];
            const pr = projPtSeg(wx, wy, a.x, a.y, b.x, b.y);
            if (pr.d < bestD) { bestD = pr.d; bestL = Math.hypot(b.x - a.x, b.y - a.y); }
          }
        }
        if (bestL > 0) setLengthLock({ picking: false, refLen: bestL });
        else setLengthLock({ picking: false, refLen: null });
        d.idx = -1; d.moved = false; setPrev(null); return;
      }
      if (!s.closed && s.pts.length >= 3) { const v0s = w2s(s.pts[0].x, s.pts[0].y, xf.current); if (Math.hypot(sx - v0s.sx, sy - v0s.sy) < 34) { setSecs(function (ss: any) { const ns = ss.slice(); ns[aiR.current] = Object.assign({}, ns[aiR.current], { closed: true }); return ns; }); setTimeout(function () { updSkel(aiR.current); }, 0); setSel(-1); setPrev(null); d.idx = -1; d.moved = false; return; } }
      const idx = hitV(wx, wy);
      if (idx >= 0) { if (idx === 0 && s.pts.length >= 3 && !s.closed) { setSecs(function (ss: any) { const ns = ss.slice(); ns[aiR.current] = Object.assign({}, ns[aiR.current], { closed: true }); return ns; }); setTimeout(function () { updSkel(aiR.current); }, 0); setSel(-1); setPrev(null); } else setSel(function (v) { return v === idx ? -1 : idx; }); }
      else { const si = hitSec(wx, wy); if (si >= 0) { setAi(si); setSel(-1); setPrev(null); } else if (!s.closed) { const snap = computeSnap(px, py) || snapR.current; let fx = snap ? snap.x : px, fy = snap ? snap.y : py; if (s.pts.length > 0) { const cp = constrainToLockedLen(s.pts[s.pts.length - 1], fx, fy); fx = cp.x; fy = cp.y; } setSecs(function (ss: any) { const ns = ss.slice(), sc2 = Object.assign({}, ns[aiR.current]); ns[aiR.current] = Object.assign({}, sc2, { pts: sc2.pts.concat([{ x: fx, y: fy }]) }); return ns; }); setSel(-1); } }
    }
    d.idx = -1; d.moved = false;
  };

  useEffect(function () {
    const c = cv2.current; if (!c) return;
    const d = function (e: any) { return cbD.current(e); }, m = function (e: any) { return cbM.current(e); }, u = function (e: any) { return cbU.current(e); }, lv = function () { guideR.current = null; dimR.current = null; setPrev(null); };
    // Wheel zoom anchored at the cursor. Because the background image and the
    // polygon points share the same xf transform, zooming (in or out) keeps the
    // points locked onto the same spot of the image. Allows zoom-out below 1x.
    const w = function (e: any) {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const old = xf.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.max(0.05, Math.min(12, old.scale * factor));
      const wx = (mx - old.tx) / old.scale, wy = (my - old.ty) / old.scale;
      xf.current = { scale: ns, tx: mx - wx * ns, ty: my - wy * ns };
      setTick(function (t) { return t + 1; });
    };
    c.addEventListener("mousedown", d); c.addEventListener("mousemove", m); c.addEventListener("mouseup", u); c.addEventListener("mouseleave", lv);
    c.addEventListener("wheel", w, { passive: false });
    c.addEventListener("touchstart", d, { passive: false }); c.addEventListener("touchmove", m, { passive: false }); c.addEventListener("touchend", u, { passive: false });
    return function () { c.removeEventListener("mousedown", d); c.removeEventListener("mousemove", m); c.removeEventListener("mouseup", u); c.removeEventListener("mouseleave", lv); c.removeEventListener("wheel", w); c.removeEventListener("touchstart", d); c.removeEventListener("touchmove", m); c.removeEventListener("touchend", u); };
  }, []);

  function dbgMove(e: any) {
    if (!dbg) return; const c = cv2.current; if (!c) return;
    const rect = c.getBoundingClientRect(), vx = e.clientX - rect.left, vy = e.clientY - rect.top, xfc = xf.current;
    setCur({ vx: Math.round(vx), vy: Math.round(vy), ix: Math.round((vx - xfc.tx) / xfc.scale), iy: Math.round((vy - xfc.ty) / xfc.scale) });
  }
  const sec = secs[ai] || { pts: [], closed: false, pitch: 35, elev: 0, _no: {}, hf: 60 };
  const sec3d = sel3D.sec >= 0 ? (secs[sel3D.sec] || null) : null;
  const scale = xf.current.scale;
  const measures = useMemo(function () { return computeMeasures(secs, valleys); }, [secs, valleys]);
  // Real-world calibration: a georeferenced frozen image gives metres/pixel
  // (GSD), so footprint pixels convert to feet — matching the quote module's
  // measurement tools (pi, pi²). No georef → raw image units (u / u²).
  const gsd = (geoRef && isFinite(geoRef.center_lat)) ? metersPerPx(geoRef.center_lat, geoRef.zoom, geoRef.scale || 1) : null;
  const ftPerPx = gsd != null ? gsd * 3.28084 : null;
  ftPerPxR.current = ftPerPx;
  const fmtLen = function (px: number): string { return ftPerPx != null ? Math.round(px * ftPerPx).toLocaleString("fr-CA") + " pi" : Math.round(px) + " u"; };
  const fmtArea = function (px2: number): string { return ftPerPx != null ? Math.round(px2 * ftPerPx * ftPerPx).toLocaleString("fr-CA") + " pi²" : Math.round(px2) + " u²"; };
  // Real-width membrane band (36" = 0.9144 m → px via GSD). Pre-computed so the
  // 3D loop only projects it. Needs calibration; otherwise no band is drawn.
  const membraneWpx = gsd != null && gsd > 0 ? 0.9144 / gsd : 0;
  const membraneSegs = useMemo(function () { return hl === "membrane" && membraneWpx ? membraneStrips(secs, valleys, membraneWpx) : []; }, [hl, secs, valleys, membraneWpx]);
  membraneSegsR.current = membraneSegs;
  gsdR.current = gsd;

  // Additive host hooks (no-op unless a parent passes the props). onReadyApi
  // exposes the SAME action as the internal "Valider" button; onModelChange
  // emits the current model on edits for host-side autosave.
  useEffect(function () {
    if (!onReadyApi) return;
    onReadyApi({ validate: function () { const ov = onValidateR.current; if (ov) ov(buildModel("validated")); } });
  }, [onReadyApi]);
  useEffect(function () {
    const cb = onModelChangeR.current; if (!cb) return;
    cb(buildModel("draft"));
  }, [secs, alts, rejected, accessories, geoRef, name]);
  // Accessory footprint half-size in world px from its REAL cap diameter (mm)
  // once calibrated; otherwise the legacy fixed marker. Keeps Maximum proxies at
  // true scale instead of a fixed pixel blob.
  function accHalfPx(variantId: string): number {
    const g = gsdR.current;
    if (g != null && g > 0) { const v: any = getVariant(variantId); const mm = (v && v.dimensions_official && v.dimensions_official.B_deflector_mm) || 600; return (mm / 1000) / g / 2; }
    return ACC_FOOTPRINT_HALF_PX;
  }
  function accHeightPx(variantId: string): number {
    const g = gsdR.current;
    if (g != null && g > 0) { const v: any = getVariant(variantId); const mm = (v && v.dimensions_official && v.dimensions_official.C_total_height_mm) || 340; return (mm / 1000) / g; }
    return 30;
  }

  let pitchSummary: any = null;
  if (sec.closed && sec._skel) {
    const fp3 = getFacePitches(sec._skel, sec._skel.poly, sec._no || {}, sec.hf || 60).filter(function (v: any) { return v != null; });
    if (fp3.length) { const mn3 = Math.min.apply(null, fp3), mx3 = Math.max.apply(null, fp3); pitchSummary = (mn3 === mx3 ? (mn3 + "/12") : (mn3 + "/12-" + mx3 + "/12")) + " (" + fp3.length + " pans)"; }
  }

  function addSec() { if (!sec.closed) return; setSecs(function (ss: any) { return ss.concat([newSec(sec.pitch || 35)]); }); setAi(secs.length); setSel(-1); setPrev(null); }
  function delSec() { if (secs.length === 1) { setSecs([newSec()]); setAi(0); setSel(-1); return; } setSecs(function (ss: any) { return ss.filter(function (_: any, i: number) { return i !== ai; }); }); setAi(Math.max(0, ai - 1)); setSel(-1); }
  function delSel() { if (sel < 0) return; const np = sec.pts.filter(function (_: any, i: number) { return i !== sel; }); setSecs(function (ss: any) { const ns = ss.slice(); ns[ai] = Object.assign({}, ns[ai], { pts: np, closed: np.length >= 3 ? ns[ai].closed : false }); return ns; }); setSel(-1); updSkel(ai); }
  function undo() { if (sec.closed) { setSecs(function (ss: any) { const ns = ss.slice(); ns[ai] = Object.assign({}, ns[ai], { closed: false, _skel: null }); return ns; }); return; } if (!sec.pts.length) return; setSecs(function (ss: any) { const ns = ss.slice(); ns[ai] = Object.assign({}, ns[ai], { pts: ns[ai].pts.slice(0, -1) }); return ns; }); setSel(-1); }
  function closeSec() { if (sec.pts.length >= 3 && !sec.closed) { setSecs(function (ss: any) { const ns = ss.slice(); ns[ai] = Object.assign({}, ns[ai], { closed: true }); return ns; }); setTimeout(function () { updSkel(ai); }, 0); setSel(-1); setPrev(null); } }
  function resetNodes() { setSecs(function (ss: any) { const ns = ss.slice(); ns[ai] = Object.assign({}, ns[ai], { _no: {} }); return ns; }); setSelNode(null); }
  function loadPreset(name: string) {
    const c = cv2.current, W = c ? c.width : 400, H = c ? c.height : 400;
    const raw = PRESETS[name] && PRESETS[name](W, H); if (!raw) return;
    const cur = secs[ai];
    // Fill the active section in place only if it's still empty; otherwise ADD
    // the preset as a new solid (cascaded so it doesn't land exactly on top of
    // the existing geometry) without touching the others.
    const replace = !cur || ((!cur.pts || cur.pts.length === 0) && !cur.closed);
    const off = replace ? 0 : Math.min(28 * Math.max(1, secs.filter(function (s: any) { return s.closed; }).length), 120);
    const built = withS(raw.map(function (s: any) {
      if (!off) return s;
      const pts = s.pts.map(function (p: any) { return { x: p.x + off, y: p.y + off }; });
      const hasGable = s._no && Object.keys(s._no).length > 0;
      return Object.assign({}, s, { pts: pts, _no: hasGable ? gableEndsOverrides(pts) : (s._no || {}) });
    }));
    if (replace) { setSecs(function (ss: any) { const ns = ss.slice(); ns.splice(ai, 1, ...built); return ns; }); setAi(ai); xf.current = { scale: 1, tx: 0, ty: 0 }; }
    else { setSecs(function (ss: any) { return ss.concat(built); }); setAi(secs.length); }
    setSel(-1); setPrev(null); setSnapPt(null); setSel3D({ sec: -1, edge: -1 }); setTick(function (t) { return t + 1; });
  }
  function loadImg(e: any) { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = function (ev: any) { const img = new Image(); img.onload = function () { setSrcImg(img); imageMetaR.current = { name: f.name, width: img.naturalWidth, height: img.naturalHeight }; fitView(img.naturalWidth, img.naturalHeight); setTick(function (t) { return t + 1; }); }; img.src = ev.target.result; }; r.readAsDataURL(f); e.target.value = ""; }
  // Compose a north-up Québec orthophoto (WMTS, EPSG:3857) into a 1280px square
  // at tile-zoom tz. Rejects if NO tile loaded (host allowlist / CORS / outside
  // Québec) so the caller can surface a real error instead of a blank image.
  const ORTHO_MAX_TZ = 21;
  function composeOrtho(lat: number, lng: number, tz: number): Promise<string> {
    const T = 256, size = 1280;
    const cx = webMercatorPx(lng, lat, tz), x0 = cx.x - size / 2, y0 = cx.y - size / 2;
    const tx0 = Math.floor(x0 / T), ty0 = Math.floor(y0 / T), tx1 = Math.floor((x0 + size) / T), ty1 = Math.floor((y0 + size) / T);
    const cnv = document.createElement("canvas"); cnv.width = size; cnv.height = size;
    const ctx = cnv.getContext("2d"); if (!ctx) return Promise.reject(new Error("no ctx"));
    let ok = 0;
    const loads: Promise<void>[] = [];
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      const url = "https://geoegl.msp.gouv.qc.ca/carto/wmts/1.0.0/orthos/default/EPSG_3857/" + tz + "/" + ty + "/" + tx + ".jpeg";
      loads.push(new Promise<void>(function (res) {
        const t = new Image(); t.crossOrigin = "anonymous";
        t.onload = function () { ctx.drawImage(t, tx * T - x0, ty * T - y0); ok++; res(); };
        t.onerror = function () { res(); };
        t.src = url;
      }));
    }
    return Promise.all(loads).then(function () {
      if (!ok) throw new Error("no_tiles");
      return cnv.toDataURL("image/jpeg", 0.92);
    });
  }
  // Freeze the map view → a static north-up image and stamp the georef (N=up).
  // Google: referrer-restricted key → load with referrerPolicy="no-referrer".
  // Ortho QC: stitched WMTS tiles at z+1 (matches Google scale-2 footprint).
  function freezeMapView() {
    // Snapshot the CURRENT interactive view (center + zoom) if the map is live;
    // otherwise fall back to the geocoded address + last zoom.
    let lat = parseFloat(mapLat), lng = parseFloat(mapLng), z = Math.round(mapZoom);
    const map = mapInst.current;
    if (map && map.getCenter) { const c = map.getCenter(); if (c) { lat = c.lat(); lng = c.lng(); } z = Math.round(map.getZoom ? map.getZoom() : z); }
    if (!isFinite(lat) || !isFinite(lng)) { setV16Err("Coordonnées invalides"); return; }
    // georefZoom describes the 1280px image at scale 2: ground = 1280·mpp(zoom,2).
    const finish = function (img: any, provider: string, georefZoom: number) {
      const iw = img.naturalWidth || 1280, ih = img.naturalHeight || 1280;
      setSrcImg(img);
      imageMetaR.current = { name: provider + "-" + lat.toFixed(5) + "_" + lng.toFixed(5) + "_z" + georefZoom + ".png", width: iw, height: ih };
      const grObj = { provider: provider, center_lat: lat, center_lng: lng, zoom: georefZoom, image_w: iw, image_h: ih, scale: 2, north_up: true, bearing_deg: 0 };
      setGeoRef(grObj);
      // Persiste le géoréf côté host → restauration du même fond à la réouverture.
      try { onGeoRefChangeR.current && onGeoRefChangeR.current(grObj); } catch { /* ignore */ }
      // Auto scale calibration (GSD) so the report has real units, no manual step.
      calibR.current = { gsd: metersPerPx(lat, georefZoom, 2), unit: "m", source: "georef:" + provider };
      fitView(iw, ih); setOpenMap(false); setV16Err(null); setTick(function (t) { return t + 1; });
    };
    if (mapSource === "ortho") {
      const tz = Math.min(z + 1, ORTHO_MAX_TZ);
      setV16Err("Chargement orthophoto…");
      composeOrtho(lat, lng, tz).then(function (durl) {
        const img = new Image();
        img.onload = function () { finish(img, "ortho", tz - 1); };
        img.onerror = function () { setV16Err("Orthophoto non chargée"); };
        img.src = durl;
      }).catch(function () { setV16Err("Orthophoto indisponible ici (domaine non autorisé par geoegl.msp.gouv.qc.ca ou hors Québec)"); });
      return;
    }
    const key = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY || "";
    if (!key) { setV16Err("Clé Google Maps absente (VITE_GOOGLE_MAPS_API_KEY)"); return; }
    // Google Static satellite imagery tops out ~z20 (the interactive map shows
    // higher via different imagery). Past that it returns "no imagery here", so
    // clamp the frozen capture; the georef stays consistent at the clamped zoom.
    const gz = Math.min(z, 20);
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = function () { finish(img, "google", gz); };
    img.onerror = function () { setV16Err("Image satellite non chargée (clé ou restriction referrer)"); };
    img.src = buildStaticMapUrl({ lat: lat, lng: lng, zoom: gz, w: 640, h: 640, scale: 2, key: key });
  }

  // ── Restaure une vue gelée persistée (re-fetch déterministe du MÊME fond) ──
  // L'image n'est pas stockée : on re-télécharge depuis le géoréf (center/zoom/
  // provider), ce qui reproduit exactement le fond + l'échelle → les annotations
  // restent alignées. Une seule fois, et jamais si une image est déjà présente.
  const restoredGeoRefRef = useRef(false);
  useEffect(function () {
    if (restoredGeoRefRef.current || srcImg) return;
    const g = initialGeoRef;
    if (!g || typeof g.center_lat !== "number" || typeof g.center_lng !== "number") return;
    restoredGeoRefRef.current = true;
    const lat = g.center_lat, lng = g.center_lng, gz = Math.round(g.zoom || 19);
    const finishR = function (img: any, provider: string, georefZoom: number) {
      const iw = img.naturalWidth || g.image_w || 1280, ih = img.naturalHeight || g.image_h || 1280;
      setSrcImg(img);
      imageMetaR.current = { name: provider + "-restored", width: iw, height: ih };
      setGeoRef({ provider: provider, center_lat: lat, center_lng: lng, zoom: georefZoom, image_w: iw, image_h: ih, scale: 2, north_up: true, bearing_deg: 0 });
      calibR.current = { gsd: metersPerPx(lat, georefZoom, 2), unit: "m", source: "georef:" + provider };
      fitView(iw, ih); setOpenMap(false); setTick(function (t) { return t + 1; });
    };
    if (g.provider === "ortho") {
      composeOrtho(lat, lng, Math.min(gz + 1, ORTHO_MAX_TZ)).then(function (durl) {
        const img = new Image(); img.onload = function () { finishR(img, "ortho", gz); }; img.src = durl;
      }).catch(function () { restoredGeoRefRef.current = false; });
    } else {
      const key = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY || "";
      if (!key) { restoredGeoRefRef.current = false; return; }
      const img = new Image(); img.referrerPolicy = "no-referrer";
      img.onload = function () { finishR(img, "google", gz); };
      img.onerror = function () { restoredGeoRefRef.current = false; };
      img.src = buildStaticMapUrl({ lat: lat, lng: lng, zoom: gz, w: 640, h: 640, scale: 2, key: key });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGeoRef, srcImg]);

  function setSP(path: string, val: any) { setSecs(function (ss: any) { const ns = ss.slice(); ns[ai] = Object.assign({}, ns[ai]); ns[ai][path] = val; return ns; }); }
  function setSP3D(path: string, val: any) { const si = sel3D.sec; if (si < 0) return; setSecs(function (ss: any) { const ns = ss.slice(); ns[si] = Object.assign({}, ns[si]); ns[si][path] = val; return ns; }); }
  function toggleHidden() { const si = sel3D.sec; if (si < 0) return; setSecs(function (ss: any) { const ns = ss.slice(); ns[si] = Object.assign({}, ns[si], { hidden: !ns[si].hidden }); return ns; }); }

  // ── Training Lab: ridge-apex merge (tourelles, pyramides, hip mansardés) ──
  // The medial-axis skeleton on a regular polygon (turret/octagon) generates
  // 4–5 near-coincident interior nodes instead of a single apex. We cluster
  // interior nodes inside a 5%-bbox radius and override each cluster to its
  // centroid via the existing `_no` (node-override) system.
  const mergeCandidates = useMemo(function () {
    void tick; // recompute as the section is edited
    const s = secs[ai];
    if (!s || !s.closed || !s._skel || !s.pts.length) return [] as any[];
    const nodes = skelNodes(s._skel, s._no || {});
    const interior = nodes.filter(function (n: any) {
      return !s.pts.some(function (p: any) { return Math.hypot(p.x - n.ox, p.y - n.oy) < 0.5; });
    });
    if (interior.length < 2) return [];
    const xs = s.pts.map(function (p: any) { return p.x; });
    const ys = s.pts.map(function (p: any) { return p.y; });
    const tol = 0.05 * Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), Math.max.apply(null, ys) - Math.min.apply(null, ys));
    const used = new Set<string>();
    const clusters: any[] = [];
    for (const n of interior) {
      if (used.has(n.key)) continue;
      const cluster = [n];
      used.add(n.key);
      let grew = true;
      while (grew) {
        grew = false;
        const cx = cluster.reduce(function (a, c) { return a + c.x; }, 0) / cluster.length;
        const cy = cluster.reduce(function (a, c) { return a + c.y; }, 0) / cluster.length;
        for (const m of interior) {
          if (used.has(m.key)) continue;
          if (Math.hypot(cx - m.x, cy - m.y) < tol) { cluster.push(m); used.add(m.key); grew = true; }
        }
      }
      if (cluster.length >= 2) {
        const cx = cluster.reduce(function (a, c) { return a + c.x; }, 0) / cluster.length;
        const cy = cluster.reduce(function (a, c) { return a + c.y; }, 0) / cluster.length;
        clusters.push({ keys: cluster.map(function (c: any) { return c.key; }), centroid: { x: cx, y: cy }, points: cluster.map(function (c: any) { return { x: c.x, y: c.y }; }) });
      }
    }
    return clusters;
  }, [secs, ai, tick]);

  const [mergePreview, setMergePreview] = useState(false);

  function applyMergeApex() {
    if (!mergeCandidates.length) return;
    setSecs(function (ss: any) {
      const ns = ss.slice();
      const cur = ns[ai];
      if (!cur) return ss;
      const no = Object.assign({}, cur._no || {});
      for (const cl of mergeCandidates) {
        for (const k of cl.keys) no[k] = { x: cl.centroid.x, y: cl.centroid.y };
      }
      ns[ai] = Object.assign({}, cur, { _no: no });
      return ns;
    });
    setMergePreview(false);
  }

  // 🗼 Tourelle preset: pitch=12 + roof_type=tower + auto-merge apex to centroid.
  // We force every interior skeleton node onto the polygon centroid so all faces
  // converge to a single apex (the geometric truth of a pyramidal turret roof).
  function applyTowerPreset() {
    setSecs(function (ss: any) {
      const ns = ss.slice();
      const cur = ns[ai];
      if (!cur || !cur.pts.length) return ss;
      let cx = 0, cy = 0;
      for (const p of cur.pts) { cx += p.x; cy += p.y; }
      cx /= cur.pts.length; cy /= cur.pts.length;
      const no: any = Object.assign({}, cur._no || {});
      if (cur._skel) {
        const nodes = skelNodes(cur._skel, {});
        for (const n of nodes) {
          const isBoundary = cur.pts.some(function (p: any) { return Math.hypot(p.x - n.ox, p.y - n.oy) < 0.5; });
          if (!isBoundary) no[n.key] = { x: cx, y: cy };
        }
      }
      ns[ai] = Object.assign({}, cur, { pitch: 12, roof_type: "tower", _no: no });
      return ns;
    });
    setMergePreview(false);
  }

  // ── Length lock — copy the length of an existing segment to constrain the
  // next point placement. Workflow: click "📏" → click an existing segment to
  // pick its length → every subsequent point is placed at exactly that
  // distance from the previous point (direction stays free). Click ✕ to clear.
  const [lengthLock, setLengthLock] = useState<{ picking: boolean; refLen: number | null }>({ picking: false, refLen: null });
  const lengthLockR = useRef(lengthLock);
  useEffect(function () { lengthLockR.current = lengthLock; }, [lengthLock]);

  // ── Snap modes — let the user disable specific snap channels when they get
  // in the way (eg. a turret that fights with collinear guides). Defaults all
  // ON to keep current behaviour; refs are read inside the canvas callbacks.
  const [snapModes, setSnapModes] = useState({ collinear: true, parallel: true, perpendicular: true });
  const snapModesR = useRef(snapModes);
  useEffect(function () { snapModesR.current = snapModes; }, [snapModes]);

  // Apply the length lock to a candidate point: snap it onto the circle of
  // radius `refLen` centered on the previous vertex, preserving direction.
  function constrainToLockedLen(a0: any, fx: number, fy: number) {
    const lk = lengthLockR.current;
    if (!lk.refLen || !a0) return { x: fx, y: fy };
    const dx = fx - a0.x, dy = fy - a0.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-3) return { x: fx, y: fy };
    return { x: a0.x + dx / L * lk.refLen, y: a0.y + dy / L * lk.refLen };
  }

  // ── Valleys (noues) — propose candidates, then edit/lock/delete/retype ──
  function exportJSON() {
    // Computed planes (the BIM "truth"): each visible face → P#, plane eq, pitch, slope dir.
    const planes: any[] = []; let pn = 0;
    secs.forEach(function (s: any, si: number) {
      if (!s.closed || s.pts.length < 3 || s.hidden) return;
      const sk = apOv(s._skel || skelFn(s.pts), s._no || {});
      facesFn(sk.poly, sk).forEach(function (f: any) {
        pn++;
        const pl = facePlaneFromFace(s, f.pts);
        planes.push({
          id: "P" + pn, section: si, kind: isPignon(s, f.pts) ? "pignon" : "toiture",
          pitch: s.pitch || 7, dir: pl ? slopeDir(pl) : "vertical",
          plane: pl ? { a: +pl.a.toFixed(4), b: +pl.b.toFixed(4), c: +pl.c.toFixed(2) } : null,
          area3d: +face3DArea(s, f.pts).toFixed(0),
          footprint: f.pts.map(function (q: any) { return { x: +q.x.toFixed(1), y: +q.y.toFixed(1), t: +(q.t || 0).toFixed(1) }; }),
        });
      });
    });
    const model = { version: 1, sections: secs.map(function (s: any) { return { pts: s.pts, closed: s.closed, pitch: s.pitch || 7, elev: s.elev || 0, hf: s.hf || 0, hidden: !!s.hidden, _no: s._no || {} }; }), valleys, planes };
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "toiture.json"; a.click(); URL.revokeObjectURL(url);
  }
  function importJSON(e: any) {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = function (ev: any) {
      try {
        const m = JSON.parse(ev.target.result);
        // Image-native import. If the file carries an "image" block (AI
        // detection), recover the SOURCE image pixels via scale_factor; the xf
        // transform then supplies the contain-fit (no per-point crop/letterbox).
        // Hand-made files keep their raw coords.
        const im = m.image, sf = (im && im.scale_factor) ? im.scale_factor : 1;
        const iw = im && im.width ? im.width : 0, ih = im && im.height ? im.height : 0;
        const mapPt: any = (im && iw && ih && sf !== 1) ? function (p: any) { return { x: p.x / sf, y: p.y / sf }; } : null;
        const ss = (m.sections || []).map(function (s: any) {
          const pts = (mapPt && s.pts) ? s.pts.map(mapPt) : s.pts;
          return Object.assign({}, s, { pts: pts, _no: s._no || {}, pitch: s.pitch || 7, elev: s.elev || 0, hf: s.hf || 0, hidden: !!s.hidden, _skel: s.closed && pts && pts.length >= 3 ? skelFn(pts) : null });
        });
        setSecs(ss.length ? ss : [newSec()]); setAi(0); setSel(-1); setPrev(null);
        if (bgImg && bgImg.naturalWidth) fitView(bgImg.naturalWidth, bgImg.naturalHeight);
        else if (iw && ih) fitView(iw, ih);
        else { const all: any[] = []; ss.forEach(function (s: any) { (s.pts || []).forEach(function (p: any) { all.push(p); }); }); fitPoints(all); }
        setTick(function (t) { return t + 1; });
      } catch (err) { /* fichier invalide — ignoré */ }
    };
    r.readAsText(f); e.target.value = "";
  }
  // Image-native view fitting. World space = image pixels; the xf transform
  // (scale/tx/ty) supplies a CONTAIN fit (whole box visible, no crop, uniform
  // scale) via the shared, tested computeViewport. Points are always stored in
  // image-pixel space and never re-baked, so resizing only changes the view.
  function fitView(boxW: number, boxH: number) {
    const c = cv2.current; if (!c || !boxW || !boxH) return;
    const vp = computeViewport(boxW, boxH, c.width, c.height);
    xf.current = { scale: vp.scale, tx: vp.offsetX, ty: vp.offsetY };
  }
  function fitPoints(pts: any[]) {
    const c = cv2.current; if (!c || !pts || !pts.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p: any) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; });
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const s = Math.min(c.width / bw, c.height / bh) * 0.88;
    xf.current = { scale: s, tx: (c.width - bw * s) / 2 - minX * s, ty: (c.height - bh * s) / 2 - minY * s };
  }
  // Reset/fit the view: to the background image if loaded, else to the drawn
  // points, else 1:1.
  function resetView() {
    if (bgImg && bgImg.naturalWidth) { fitView(bgImg.naturalWidth, bgImg.naturalHeight); return; }
    const all: any[] = []; secsR.current.forEach(function (s: any) { (s.pts || []).forEach(function (p: any) { all.push(p); }); });
    if (all.length) fitPoints(all); else xf.current = { scale: 1, tx: 0, ty: 0 };
  }

  // Manual v1.6 import (review): JSON → RoofModel → active sections + ghost
  // alternatives, in raw source-image pixels. Starts a NEW annotation (fresh
  // created_at; MVP snapshot + auto-rejected candidates kept for later).
  function importV16(e: any) {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = function (ev: any) {
      let data: any; try { data = JSON.parse(ev.target.result); } catch (err) { setV16Err("JSON invalide"); return; }
      let res: any; try { res = fromRoofSectionsV16(data); } catch (err: any) { setV16Err(err && err.message || "v1.6 invalide"); return; }
      setV16Err(null);
      const all: any[] = [];
      res.model.sections.forEach(function (s: any) { (s.pts || []).forEach(function (p: any) { all.push(p); }); });
      (res.model.alternatives || []).forEach(function (a: any) { (a.pts || []).forEach(function (p: any) { all.push(p); }); });
      const mapSec = function (s: any) {
        const pts = (s.pts || []).map(function (p: any) { return { x: p.x, y: p.y }; });
        return { pts: pts, closed: true, _skel: null as any, pitch: s.pitch || 7, elev: 0, hf: 0, _no: s.roof_type === "gable" ? gableEndsOverrides(pts) : {}, hidden: false, roof_type: s.roof_type, meta: s.meta, source: "mvp", _orig: sigPts(pts) };
      };
      modelMeta.current = res.model;
      mvpSnapR.current = data;
      rejectedDebugR.current = res.rejected || [];
      calibR.current = (res.model.metadata && res.model.metadata.calibration) || null;
      createdAtR.current = new Date().toISOString();
      setRejected([]);   // accessories[] survive a MVP rerun (re-marked orphan if their section vanished)
      setSecs(withS(res.model.sections.map(mapSec)));
      setAlts((res.model.alternatives || []).map(function (a: any) { return Object.assign({}, mapSec(a), { _alt: a._alt }); }));
      setReviewActive(true); setAi(0); setSel(-1); setPrev(null); setSel3D({ sec: -1, edge: -1 }); setView("draw");
      if (bgImg && bgImg.naturalWidth) fitView(bgImg.naturalWidth, bgImg.naturalHeight); else fitPoints(all);
      setTick(function (t) { return t + 1; });
    };
    r.readAsText(f); e.target.value = "";
  }
  // Reopen a saved annotation (RoofModel↑): restore name, active sections,
  // unresolved suggestions (as ghosts), rejected, metadata + review_state. The
  // source image is NOT embedded — prompt to reload it when absent.
  function importRoofModel(e: any) {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = function (ev: any) {
      let j: any; try { j = JSON.parse(ev.target.result); } catch (err) { setV16Err("JSON invalide"); return; }
      let ann: any; try { ann = parseAnnotation(j); } catch (err: any) { setV16Err(err && err.message || "Annotation invalide"); return; }
      const toInternal = function (s: any) {
        const pts = (s.pts || []).map(function (p: any) { return { x: p.x, y: p.y }; });
        return { pts: pts, closed: true, _skel: null as any, pitch: s.pitch || 7, elev: s.elev || 0, hf: s.hf || 0, _no: s.roof_type === "gable" ? gableEndsOverrides(pts) : {}, hidden: false, roof_type: s.roof_type, source: s.source || "mvp", _orig: sigPts(pts) };
      };
      modelMeta.current = { metadata: ann.metadata, image: ann.image, calibration: ann.calibration, mvp_source_snapshot: ann.mvp_source_snapshot, address: ann.address };
      createdAtR.current = ann.created_at || new Date().toISOString();
      imageMetaR.current = ann.image || null;
      mvpSnapR.current = ann.mvp_source_snapshot || null;
      calibR.current = ann.calibration || null;
      rejectedDebugR.current = ann.rejectedDebug || [];
      setName(ann.name || "");
      setSecs(withS(ann.sections.map(toInternal)));
      setAlts(ann.suggestions.map(function (s: any) { return Object.assign(toInternal(s), { _alt: s._alt }); }));
      setRejected(ann.rejectedSuggestions.map(function (s: any) { return Object.assign(toInternal(s), { _alt: s._alt }); }));
      setAccessories((ann.accessories || []).slice());
      setGeoRef(ann.georef || null);
      setReviewActive(true); setAi(0); setSel(-1); setPrev(null); setSel3D({ sec: -1, edge: -1 }); setView("draw");
      if (bgImg && bgImg.naturalWidth) { fitView(bgImg.naturalWidth, bgImg.naturalHeight); setV16Err(null); }
      else if (ann.image && ann.image.width) { fitView(ann.image.width, ann.image.height); setV16Err("Annotation « " + (ann.name || "?") + " » chargée — recharge l'image source (img)"); }
      else { const all: any[] = []; ann.sections.forEach(function (s: any) { (s.pts || []).forEach(function (p: any) { all.push(p); }); }); fitPoints(all); setV16Err(null); }
      setTick(function (t) { return t + 1; });
    };
    r.readAsText(f); e.target.value = "";
  }
  // "reset alt" keeps the suggestions as human-rejected (never silently lost).
  function resetAlts() { setRejected(function (rr: any) { return rr.concat(alts); }); setAlts([]); }
  // Phase 1B: add a TEST accessory (no placement/3D yet) to exercise save/reload.
  // Anchored at the active section's centroid; never becomes a section.
  // ── Phase 2: accessory placement / resolution helpers ──
  // Ridge (longest isRidge edge) of a section, in world px, _no applied.
  function accRidgeForSection(idx: number): any {
    const s = secsR.current[idx]; if (!s || !s.closed || s.pts.length < 3) return null;
    return sectionRidge(apOv(s._skel || skelFn(s.pts), s._no || {}));
  }
  // Ridge target for a tap (px): nearest ridge within radius, else the ridge of
  // the section whose polygon contains the point (tap anywhere on a pan works).
  function nearestAccRidge(wx: number, wy: number): any {
    const ss = secsR.current, rad = 60 / xf.current.scale; let best: any = null, bd = rad;
    for (let i = 0; i < ss.length; i++) { const r = accRidgeForSection(i); if (!r) continue; const d = distToRidge({ x: wx, y: wy }, r); if (d < bd) { bd = d; best = { idx: i, ridge: r }; } }
    if (best) return best;
    for (let i = 0; i < ss.length; i++) { const s = ss[i]; if (s && s.closed && s.pts.length >= 3 && pointInPoly(s.pts, wx, wy)) { const r = accRidgeForSection(i); if (r) return { idx: i, ridge: r }; } }
    return null;
  }
  // Resolve a placed accessory to px (or null if its section/ridge is gone).
  function placedForAcc(acc: any): any {
    const sid = acc && acc.anchor && acc.anchor.section_id; if (!sid) return null;
    const idx = parseInt(String(sid).replace(/^S/, ""), 10) - 1;
    const ridge = accRidgeForSection(idx); if (!ridge) return null;
    return Object.assign({ idx: idx, ridge: ridge }, resolvePlaced(acc.anchor, ridge, accHalfPx(acc.variant_id || "301-16")));
  }
  // Toggle placement mode (click a ridge to place).
  function togglePlaceAccessory() { setPlacingAcc(function (v) { return !v; }); accGhost.current = null; setSel(-1); setSelNode(null); setSelAcc(-1); setTick(function (t) { return t + 1; }); }
  // Commit the ghost as a real accessory.
  function commitAccessory(idx: number, edge_t: number, slope_offset: number, pos: any) {
    const variant = "301-16", sid = "S" + (idx + 1);
    const anchor = makeAnchor({ section_id: sid, edge_type: "ridge", edge_index: 0, edge_t: edge_t, slope_offset_mm: slope_offset, pan_side: "primary" });
    anchor.fallback_anchor_px = { x: +pos.x.toFixed(1), y: +pos.y.toFixed(1) };
    if (!validateAnchor(anchor).ok) return;
    const acc = {
      id: "acc_" + Math.random().toString(36).slice(2, 8), type: "roof_accessory",
      product_id: MAX_301_PRODUCT_ID, variant_id: variant, anchor: anchor,
      parameters: { color_id: "galv" }, overrides: { accepted_warnings: [] },
      metadata: { created_at: new Date().toISOString() }, accessory_orphaned: false,
    };
    setAccessories(function (a: any) { setSelAcc(a.length); return a.concat([acc]); });
  }
  function exportModel(status: string) {
    const safe = ((name || "roofmodel").trim().replace(/[^\w.-]+/g, "_").slice(0, 60)) || "roofmodel";
    const blob = new Blob([JSON.stringify(buildModel(status), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = safe + "-" + status + ".json"; a.click(); URL.revokeObjectURL(url);
  }
  function exportImage() {
    const c = view === "3d" ? cv3.current : cv2.current; if (!c) return;
    try { const url = c.toDataURL("image/png"); const a = document.createElement("a"); a.href = url; a.download = "toiture-" + view + "-" + Date.now() + ".png"; a.click(); } catch (e) { /* ignore */ }
  }
  // ── Review mode: promote / reject alternatives, build the validated model ──
  function promoteAlt(i: number) {
    const a = alts[i]; if (!a) return;
    // Promoted suggestion = merged (MVP origin + human action) — a future MVP
    // rerun must not overwrite it.
    const internal = withS([{ pts: a.pts, closed: true, _skel: null as any, pitch: a.pitch || 7, elev: a.elev || 0, hf: a.hf || 0, _no: a._no || {}, hidden: false, roof_type: a.roof_type, source: "merged", _orig: sigPts(a.pts) }])[0];
    setSecs(function (ss: any) { return ss.concat([internal]); });
    setAi(secs.length);
    setAlts(function (list: any) { return list.filter(function (_: any, j: number) { return j !== i; }); });
    setView("draw"); setSel(-1); setPrev(null); setSel3D({ sec: -1, edge: -1 }); setTick(function (t) { return t + 1; });
  }
  function rejectAlt(i: number) { const a = alts[i]; if (!a) return; setRejected(function (rr: any) { return rr.concat([a]); }); setAlts(function (list: any) { return list.filter(function (_: any, j: number) { return j !== i; }); }); }
  function buildModel(status: string): any {
    const base = modelMeta.current || {};
    const mk = function (s: any) {
      const roof_type = s.roof_type || (Object.keys(s._no || {}).some(function (k: string) { return s._no[k] && s._no[k].gable; }) ? "gable" : "hip");
      let source = s.source || "human";
      if (source === "mvp" && s._orig && sigPts(s.pts) !== s._orig) source = "human";  // edited MVP section → human
      // _no : overrides de nœuds (déplacement manuel de faîtiers/arêtiers) —
      // sérialisés pour qu'ils survivent à Valider/Fermer + réouverture.
      return { pts: s.pts, pitch: s.pitch || 7, elev: s.elev || 0, hf: s.hf || 0, roof_type: roof_type, source: source, _no: s._no || {} };
    };
    return buildAnnotation({
      name: name,
      address: base.address || (base.metadata && base.metadata.address) || null,
      status: status,
      createdAt: createdAtR.current || undefined,
      image: imageMetaR.current || base.image || null,
      mvpSnapshot: mvpSnapR.current || base.mvp_source_snapshot || null,
      calibration: calibR.current || base.calibration || null,
      baseMetadata: base.metadata || {},
      sections: secsR.current.filter(function (s: any) { return s.closed && s.pts.length >= 3; }).map(mk),
      suggestions: alts.map(function (a: any) { return Object.assign(mk(a), { _alt: a._alt }); }),
      rejectedSuggestions: rejected.map(function (a: any) { return Object.assign(mk(a), { _alt: a._alt }); }),
      rejectedDebug: rejectedDebugR.current || [],
      accessories: accessories,
      georef: geoRef ? Object.assign({}, geoRef, { building_bearing_deg: buildingBearing() }) : null,
    });
  }
  // Dominant building axis (longest-edge bearing vs north) from the biggest
  // closed section — only meaningful when a frozen north-up map georef exists.
  function buildingBearing(): number | undefined {
    const ss = secsR.current.filter(function (s: any) { return s.closed && s.pts.length >= 3; });
    if (!ss.length) return undefined;
    let big = ss[0], ba = -1;
    ss.forEach(function (s: any) { const a = polyAreaAbs(s.pts); if (a > ba) { ba = a; big = s; } });
    const b = principalBearingDeg(big.pts);
    return b == null ? undefined : b;
  }
  const vbtn = function (col: string): any { return { padding: touchUI ? "12px 15px" : "9px 13px", minHeight: touchUI ? 46 : undefined, fontSize: touchUI ? 14 : 13, fontFamily: "monospace", borderRadius: 7, cursor: "pointer", touchAction: "manipulation", border: "1px solid " + col + "66", background: "transparent", color: col }; };
  // Toolbar cluster: groups related controls so they stay together and wrap as a
  // unit (clean alignment, no orphan separators).
  const grp: any = { display: "inline-flex", gap: touchUI ? 10 : 6, alignItems: "center", flexWrap: "wrap", padding: touchUI ? "6px 8px" : "4px 6px", borderRadius: 9, background: "#0c0f26", border: "1px solid #181c3a" };

  const pillDown = useCallback(function (e: any) { e.stopPropagation(); const src = e.touches && e.touches[0] || e, rect = pillRef.current && pillRef.current.getBoundingClientRect(); pillDrag.current = { active: true, startX: src.clientX, startY: src.clientY, origX: rect ? rect.left : 0, origY: rect ? rect.top : 0, moved: false }; }, []);
  const pillMove = useCallback(function (e: any) { if (!pillDrag.current.active) return; e.stopPropagation(); e.preventDefault && e.preventDefault(); const src = e.touches && e.touches[0] || e, dx = src.clientX - pillDrag.current.startX, dy = src.clientY - pillDrag.current.startY; if (Math.hypot(dx, dy) > 6) pillDrag.current.moved = true; if (pillDrag.current.moved) { const wr = cv2w.current && cv2w.current.getBoundingClientRect(); if (!wr) return; setPillPos({ x: Math.max(4, Math.min(wr.width - 70, pillDrag.current.origX + dx - wr.left)), y: Math.max(4, Math.min(wr.height - 50, pillDrag.current.origY + dy - wr.top)) }); } }, []);
  const pillUp = useCallback(function (e: any) { if (!pillDrag.current.moved && e.type !== "mouseleave") undo(); pillDrag.current.active = false; pillDrag.current.moved = false; }, [sec]);

  const hasNoOv = sec.closed && Object.keys(sec._no || {}).length > 0;
  const hasSkl = secs.some(function (s: any) { return s.closed; });

  function B(act: boolean, col: string, fn: any, dis: boolean, lbl: string) {
    const stl: any = {
      padding: touchUI ? "13px 16px" : "9px 14px",
      minHeight: touchUI ? 48 : undefined,
      fontSize: touchUI ? 15 : 14,
      fontFamily: "monospace", borderRadius: 8, touchAction: "manipulation",
      cursor: dis ? "not-allowed" : "pointer",
      border: "1px solid " + (act ? col : dis ? "#111" : "#1e2240"),
      background: act ? (col + "22") : "transparent",
      color: act ? col : dis ? "#2a3050" : "#5a6888",
      fontWeight: act ? 700 : 500,
      boxShadow: act && !dis ? ("0 0 0 1px " + col + "55, 0 2px 10px " + col + "22") : "none",
      opacity: dis ? 0.5 : 1,
    };
    return (<button onClick={fn} disabled={dis} style={stl}>{lbl}</button>);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "#060610", color: "#c8d4f0", fontFamily: "monospace", userSelect: "none", overflow: "hidden" }}>
      <style>{`
        .rs-range { -webkit-appearance: none; appearance: none; height: 28px; background: transparent; cursor: pointer; }
        .rs-range::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: #1e2240; }
        .rs-range::-moz-range-track { height: 6px; border-radius: 3px; background: #1e2240; }
        .rs-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 26px; height: 26px; border-radius: 50%; background: currentColor; margin-top: -10px; border: 2px solid #0a0a14; box-shadow: 0 1px 4px rgba(0,0,0,0.6); }
        .rs-range::-moz-range-thumb { width: 26px; height: 26px; border-radius: 50%; background: currentColor; border: 2px solid #0a0a14; box-shadow: 0 1px 4px rgba(0,0,0,0.6); }
        @keyframes rsGlowPulse { 0%,100% { box-shadow: 0 0 18px 3px rgba(130,100,255,0.35), inset 0 0 10px rgba(130,100,255,0.25); } 50% { box-shadow: 0 0 34px 9px rgba(130,100,255,0.6), inset 0 0 18px rgba(130,100,255,0.45); } }
        .rs-glow { animation: rsGlowPulse 2.2s ease-in-out infinite; }
        @keyframes rsSpin { to { transform: rotate(360deg); } }
        .rs-spin { animation: rsSpin 0.8s linear infinite; }
        .pac-container { z-index: 100000 !important; }
      `}</style>
      <div style={{ padding: touchUI ? "10px 10px" : "8px 10px", background: "#09091e", borderBottom: "1px solid #181838", display: "flex", gap: touchUI ? 10 : 8, flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
        {!trainingLabMode && <button onClick={function () { setToolsCollapsed(function (v) { return !v; }); }} title={toolsCollapsed ? "Afficher les outils" : "Masquer les outils pour annoter en plein écran"} style={{ padding: touchUI ? "10px 14px" : "8px 12px", minHeight: touchUI ? 44 : undefined, fontSize: touchUI ? 14 : 13, fontWeight: "bold", fontFamily: "monospace", borderRadius: 7, cursor: "pointer", touchAction: "manipulation", border: "1px solid " + (toolsCollapsed ? "#ffaa44" : "#3a3f66"), background: toolsCollapsed ? "#ffaa4422" : "transparent", color: toolsCollapsed ? "#ffaa44" : "#9aa3c8", flexShrink: 0 }}>{toolsCollapsed ? "Afficher les outils" : "Masquer les outils"}</button>}
        {!toolsCollapsed && (<>
        <div style={grp}>
          {B(view === "draw", "#4499ff", function () { setView("draw"); }, false, "2D")}
          {B(view === "3d", "#44ddaa", function () { if (hasSkl) setView("3d"); }, !hasSkl, "3D")}
        </div>
        {!trainingLabMode && <button
          onClick={function () { setHideAnnotations(function (v) { return !v; }); }}
          title={hideAnnotations ? "Afficher la pré-annotation IA" : "Cacher temporairement les polygones pour voir le toit"}
          style={{ padding: touchUI ? "10px 14px" : "8px 12px", minHeight: touchUI ? 44 : undefined, fontSize: touchUI ? 14 : 13, fontFamily: "monospace", borderRadius: 7, cursor: "pointer", touchAction: "manipulation", border: "1px solid " + (hideAnnotations ? "#ffaa44" : "#3a3f66"), background: hideAnnotations ? "#ffaa4422" : "transparent", color: hideAnnotations ? "#ffaa44" : "#9aa3c8", flexShrink: 0 }}>
          👁️ {hideAnnotations ? "Afficher IA" : "Masquer IA"}
        </button>}
        {!trainingLabMode && <div style={grp}>
          {B(openDraw, "#4499ff", function () { setOpenDraw(function (v) { return !v; }); }, false, "Dessin")}
          {B(openFile, "#8a93a8", function () { setOpenFile(function (v) { return !v; }); }, false, "Fichier")}
          {B(openAcc, "#44ddaa", function () { setOpenAcc(function (v) { return !v; }); }, false, "Acc" + (accessories.length ? " " + accessories.length : ""))}
          {B(openBat, "#88ccff", function () { setOpenBat(function (v) { return !v; }); }, false, "Bât" + (secs.some(function (s: any) { return !!s.building; }) ? " " + secs.filter(function (s: any) { return !!s.building; }).length : ""))}
          {B(openMap, "#aa88ff", function () { setOpenMap(function (v) { return !v; }); }, false, "Carte")}
        </div>}
        {openDraw && view === "draw" && !trainingLabMode && <>
          <div style={grp}>
            {secs.map(function (_: any, si: number) { return (<button key={si} onClick={function () { setAi(si); setSel(-1); setPrev(null); }} style={{ padding: touchUI ? "12px 16px" : "9px 14px", minHeight: touchUI ? 48 : undefined, fontSize: touchUI ? 15 : 14, fontFamily: "monospace", borderRadius: 7, cursor: "pointer", touchAction: "manipulation", border: "1px solid " + SC[si % SC.length], background: si === ai ? (SC[si % SC.length] + "33") : "transparent", color: si === ai ? SC[si % SC.length] : "#556677", fontWeight: si === ai ? "bold" : "normal" }}>{"S" + (si + 1) + (secs[si].closed ? " v" : "")}</button>); })}
            <button onClick={addSec} disabled={!sec.closed} style={{ padding: touchUI ? "10px 18px" : "8px 16px", minHeight: touchUI ? 48 : undefined, minWidth: touchUI ? 48 : undefined, fontSize: touchUI ? 20 : 18, lineHeight: 1, borderRadius: 7, cursor: sec.closed ? "pointer" : "not-allowed", touchAction: "manipulation", border: "1px solid #44ddaa", background: "transparent", color: sec.closed ? "#44ddaa" : "#1e4040", fontFamily: "monospace", opacity: sec.closed ? 1 : 0.4 }}>+</button>
          </div>
          <div style={grp}>
            {B(sel >= 0, "#ff4444", delSel, sel < 0, "x v" + sel)}
            {B(false, "#44ff88", closeSec, sec.pts.length < 3 || sec.closed, "[ ]")}
            {B(false, "#ff6644", delSec, secs.length === 1 && !sec.pts.length, "del S" + (ai + 1))}
            {hasNoOv && B(true, "#ffcc44", resetNodes, false, "reset nodes")}
          </div>
          <div style={grp}>
            {B(solid, "#44ddaa", function () { setSolid(function (v) { return !v; }); }, false, solid ? "solide" : "transparent")}
            {(bgImg || secs.some(function (s: any) { return s.pts.length; })) && B(true, "#88aaff", function () { resetView(); setTick(function (t) { return t + 1; }); }, false, "fit " + scale.toFixed(2) + "x")}
            {!trainingLabMode && B(dbg, "#39d0ff", function () { setDbg(function (v) { return !v; }); setTick(function (t) { return t + 1; }); }, false, "debug")}
            {!trainingLabMode && <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "9px 14px", fontSize: 14, fontFamily: "monospace", borderRadius: 6, cursor: "pointer", border: "1px solid " + (bgImg ? "#ffaa44" : "#1e2240"), background: bgImg ? "#ffaa4422" : "transparent", color: bgImg ? "#ffaa44" : "#5a6888" }}>
              img{bgImg ? " ok" : ""}
              <input type="file" accept="image/*" onChange={loadImg} style={{ display: "none" }} />
            </label>}
            {!trainingLabMode && bgImg && <><button onClick={function () { setSrcImg(null); setBgImg(null); }} style={{ padding: "9px 12px", fontSize: 14, borderRadius: 6, border: "1px solid #ff6644", background: "transparent", color: "#ff6644", cursor: "pointer", fontFamily: "monospace" }}>x</button><input type="range" min={0.1} max={1} step={0.05} value={bgOp} onChange={function (e) { setBgOp(+e.target.value); }} style={{ width: 70, height: 28, accentColor: "#ffaa44" }} /></>}
          </div>
          <div style={grp}>
            {Object.keys(PRESETS).map(function (n) { return (<button key={n} onClick={function () { loadPreset(n); }} style={{ padding: "8px 13px", fontSize: 13, fontFamily: "monospace", borderRadius: 6, cursor: "pointer", border: "1px solid #2a3a60", background: "transparent", color: "#7a90c0" }}>{n}</button>); })}
          </div>
          {trainingLabMode && sec.closed && (
            <div style={grp} title="Présets typologie — annote la section active (truth-label pour l'IA)">
              <span style={{ fontSize: 11, color: "#8a93a8", padding: "0 4px" }}>Type S{ai + 1} :</span>
              {[
                { label: "🏢 Plat", pitch: 0.5, roof_type: "flat", color: "#88aaff" },
                { label: "🏚️ Mono", pitch: 3, roof_type: "shed", color: "#ffaa88" },
                { label: "🏠 Hip", pitch: 7, roof_type: "hip", color: "#44ddaa" },
                { label: "🔺 Pignon", pitch: 7, roof_type: "gable", color: "#d8ff00" },
                { label: "🗼 Tourelle", pitch: 12, roof_type: "tower", color: "#ff66dd" },
              ].map(function (preset) {
                const isActive = (sec.roof_type || "hip") === preset.roof_type;
                return (
                  <button
                    key={preset.roof_type}
                    onClick={function () {
                      if (preset.roof_type === "tower") { applyTowerPreset(); return; }
                      setSecs(function (ss: any) {
                        const ns = ss.slice();
                        const cur = ns[ai];
                        if (!cur) return ss;
                        const updated: any = Object.assign({}, cur, { pitch: preset.pitch, roof_type: preset.roof_type });
                        updated._no = preset.roof_type === "gable" ? gableEndsOverrides(cur.pts) : {};
                        ns[ai] = updated;
                        return ns;
                      });
                    }}
                    style={{
                      padding: touchUI ? "10px 14px" : "8px 12px",
                      minHeight: touchUI ? 44 : undefined,
                      fontSize: touchUI ? 13 : 12,
                      fontFamily: "monospace",
                      borderRadius: 6,
                      cursor: "pointer",
                      touchAction: "manipulation",
                      border: "1px solid " + preset.color + (isActive ? "" : "66"),
                      background: isActive ? preset.color + "22" : "transparent",
                      color: preset.color,
                      fontWeight: isActive ? "bold" : "normal",
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
              {mergeCandidates.length > 0 && (
                <>
                  <div style={{ width: 1, height: 22, background: "#1e2240", margin: "0 4px" }} />
                  {!mergePreview ? (
                    <button
                      onClick={function () { setMergePreview(true); }}
                      title={"Aperçu du merge — " + mergeCandidates.reduce(function (s: number, c: any) { return s + c.points.length; }, 0) + " points seront fusionnés en " + mergeCandidates.length}
                      style={{
                        padding: touchUI ? "10px 14px" : "8px 12px",
                        minHeight: touchUI ? 44 : undefined,
                        fontSize: touchUI ? 13 : 12,
                        fontFamily: "monospace",
                        borderRadius: 6,
                        cursor: "pointer",
                        touchAction: "manipulation",
                        border: "1px solid #ffaa44",
                        background: "transparent",
                        color: "#ffaa44",
                      }}
                    >
                      {"⊙ Merge apex (" + mergeCandidates.reduce(function (s: number, c: any) { return s + c.points.length; }, 0) + "→" + mergeCandidates.length + ")"}
                    </button>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: "#ffaa44", padding: "0 4px" }}>Aperçu (cyan = à fusionner) :</span>
                      <button
                        onClick={applyMergeApex}
                        style={{
                          padding: touchUI ? "10px 14px" : "8px 12px",
                          minHeight: touchUI ? 44 : undefined,
                          fontSize: touchUI ? 13 : 12,
                          fontFamily: "monospace",
                          borderRadius: 6,
                          cursor: "pointer",
                          touchAction: "manipulation",
                          border: "1px solid #44ff88",
                          background: "#44ff8822",
                          color: "#44ff88",
                          fontWeight: "bold",
                        }}
                      >
                        ✓ Confirmer
                      </button>
                      <button
                        onClick={function () { setMergePreview(false); }}
                        style={{
                          padding: touchUI ? "10px 14px" : "8px 12px",
                          minHeight: touchUI ? 44 : undefined,
                          fontSize: touchUI ? 13 : 12,
                          fontFamily: "monospace",
                          borderRadius: 6,
                          cursor: "pointer",
                          touchAction: "manipulation",
                          border: "1px solid #888",
                          background: "transparent",
                          color: "#888",
                        }}
                      >
                        Annuler
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>}
        {openDraw && view === "3d" && <>
          <div style={grp}>
            {B(false, "#4499ff", function () { setView("draw"); }, false, "< 2D")}
            {B(solid, "#44ddaa", function () { setSolid(function (v) { return !v; }); }, false, solid ? "solide" : "transparent")}
            {B(edit3d === "solid", "#ffaa44", function () { setEdit3d(function (m) { return m === "solid" ? "surface" : "solid"; }); setSel3D({ sec: -1, edge: -1 }); setSelFace(null); setZinfo(null); }, false, edit3d === "solid" ? "↕ solide" : "⊞ surface")}
          </div>
          <div style={grp}>
            <button onClick={exportImage} style={vbtn("#44ddaa")}>capture↓</button>
            <button onClick={exportJSON} style={vbtn("#8a93a8")}>JSON↓</button>
            <label style={{ ...vbtn("#8a93a8"), display: "inline-flex", alignItems: "center" }}>JSON↑<input type="file" accept="application/json,.json" onChange={importJSON} style={{ display: "none" }} /></label>
          </div>
          {sec3d ? <>
            <span style={{ fontSize: 11, color: SC[sel3D.sec % SC.length], fontWeight: "bold" }}>{"S" + (sel3D.sec + 1)}</span>
            <button onClick={toggleHidden} style={vbtn(sec3d.hidden ? "#ff9944" : "#8a93a8")}>{sec3d.hidden ? "cachée (construction)" : "masquer"}</button>
            <button onClick={function () { setSel3D({ sec: -1, edge: -1 }); }} style={{ padding: "9px 13px", fontSize: 14, borderRadius: 6, border: "1px solid #334", background: "transparent", color: "#556", cursor: "pointer", fontFamily: "monospace" }}>x</button>
            {edit3d === "surface" && <div style={{ flexBasis: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 70, fontSize: 12, color: "#8a93a8", flexShrink: 0 }}>Pente</span>
                <input className="rs-range" type="range" min={1} max={12} step={1} value={sec3d.pitch || 7} onChange={function (e) { setSP3D("pitch", +e.target.value); }} style={{ flex: 1, color: SC[sel3D.sec % SC.length] }} />
                <strong style={{ width: 48, textAlign: "right", fontSize: 14, color: SC[sel3D.sec % SC.length], flexShrink: 0 }}>{(sec3d.pitch || 7) + "/12"}</strong>
              </div>
            </div>}
            {edit3d === "solid" && <span style={{ fontSize: 12, color: "#ffaa44" }}>{"Z " + Math.round(sec3d.elev || 0) + " — glisse le solide ↕"}</span>}
          </> : <span style={{ fontSize: 11, color: "#3a5080" }}>{edit3d === "solid" ? "Tape un solide et glisse-le en Z" : "Tape une surface"}</span>}
        </>}
        </>)}
      </div>
      {!toolsCollapsed && (openFile || trainingLabMode) && (mode === "review" || reviewActive) && (
        <div style={{ padding: "7px 10px", background: "#0a0a1e", borderBottom: "1px solid #1e2240", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0, fontSize: 11 }}>
          <span style={{ color: "#d8ff00", fontWeight: "bold", letterSpacing: 0.5 }}>REVIEW</span>
          <input value={name} onChange={function (e) { setName(e.target.value); }} placeholder="nom de l'annotation…" title="Nom de l'annotation (conservé à l'export)" style={{ padding: "5px 8px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, border: "1px solid #2a3a60", background: "#0c1024", color: "#d8e2ff", minWidth: 180 }} />
          <span style={{ color: alts.length ? "#ffaa44" : "#44ff88" }} title="review_state">{alts.length ? "validated_with_unresolved_suggestions" : "fully_validated"}</span>
          <span style={{ color: "#556677" }}>{secs.filter(function (s: any) { return s.closed; }).length + " actives · " + alts.length + " alt · " + rejected.length + " rejected · " + accessories.length + " acc" + (accessories.filter(function (a: any) { return a.accessory_orphaned; }).length ? " (" + accessories.filter(function (a: any) { return a.accessory_orphaned; }).length + " orphelins)" : "")}</span>
          {alts.length > 0 && <div style={{ width: 1, height: 14, background: "#1e2240" }} />}
          {/* Strip horizontalement scrollable : avec beaucoup d'alts (genre 41),
              wrap → grid énorme qui bouffait l'écran. flex-basis 100% pour
              forcer le strip à occuper toute la largeur dispo, overflowX:auto
              permet de swipe horizontal sur mobile sans casser le wrap des
              autres éléments du REVIEW row (Promouvoir/Rejeter restent
              accessibles dessous). */}
          {alts.length > 0 && (
            <div style={{
              display: "flex", flexDirection: "row", gap: 6,
              overflowX: "auto", overflowY: "hidden",
              flexBasis: "100%", minWidth: 0,
              padding: "2px 0",
              WebkitOverflowScrolling: "touch" as any,
              scrollbarWidth: "thin" as any,
            }}>
              {selAltIdx != null && (
                <span style={{ display: "inline-flex", alignItems: "center", padding: "0 6px", fontSize: 11, color: "#ffaa44", fontFamily: "monospace", flexShrink: 0, whiteSpace: "nowrap" }}>
                  {(selAltIdx + 1) + "/" + alts.length}
                </span>
              )}
              {alts.map(function (a: any, i: number) {
                const isSelected = i === selAltIdx;
                return (<button
                  key={i}
                  onClick={function () { setSelAltIdx(isSelected ? null : i); }}
                  title={isSelected ? "Cliquer à nouveau pour désélectionner" : "Sélectionner pour preview sur la carte"}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
                    border: "1px " + (isSelected ? "solid" : "dashed") + " " + (isSelected ? "#ff8800" : "#d8ff00"),
                    borderRadius: 6, padding: "5px 10px",
                    background: isSelected ? "#ff880033" : "transparent",
                    color: isSelected ? "#ff8800" : "#d8ff00",
                    fontFamily: "monospace", fontSize: 12, fontWeight: isSelected ? "bold" : "normal",
                    cursor: "pointer", touchAction: "manipulation",
                    whiteSpace: "nowrap",
                  }}>{isSelected ? "● " : ""}{"alt " + (i + 1)}</button>);
              })}
            </div>
          )}
          {/* Boutons Promouvoir/Rejeter — visibles seulement si une alt est sélectionnée. */}
          {selAltIdx != null && alts[selAltIdx] && (<>
            <button onClick={function () { promoteAlt(selAltIdx); setSelAltIdx(null); }}
              title={"Promouvoir alt " + (selAltIdx + 1) + " en section active (kept)"}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #44ff88", background: "#44ff8822", color: "#44ff88", cursor: "pointer", fontFamily: "monospace", fontSize: 12, fontWeight: "bold" }}>
              ✅ Promouvoir alt {selAltIdx + 1}
            </button>
            <button onClick={function () { rejectAlt(selAltIdx); setSelAltIdx(null); }}
              title={"Rejeter alt " + (selAltIdx + 1)}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ff6644", background: "#ff664422", color: "#ff8866", cursor: "pointer", fontFamily: "monospace", fontSize: 12 }}>
              ✕ Rejeter alt {selAltIdx + 1}
            </button>
          </>)}
          {alts.length > 0 && <button onClick={function () { resetAlts(); setSelAltIdx(null); }} title="Retirer toutes les suggestions" style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #ff664455", background: "transparent", color: "#ff8866", cursor: "pointer", fontFamily: "monospace", fontSize: 11 }}>reset alt</button>}
          <div style={{ flex: 1 }} />
          {onValidate
            ? <button onClick={function () { onValidate(buildModel("validated")); }} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #44ff88", background: "#44ff8822", color: "#44ff88", cursor: "pointer", fontFamily: "monospace", fontSize: 13, fontWeight: "bold" }}>Valider</button>
            : <button onClick={function () { exportModel("validated"); }} title="Télécharger le RoofModel validé" style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #44ff88", background: "#44ff8822", color: "#44ff88", cursor: "pointer", fontFamily: "monospace", fontSize: 13, fontWeight: "bold" }}>RoofModel↓</button>}
          {onClose && <button onClick={function () {
            // Force-emit the latest model BEFORE closing so the parent's
            // autosave (debounced) captures the most recent state even if the
            // user clicks Fermer right after an edit (before the React effect
            // had a chance to fire). The parent's onClose will then flush
            // synchronously and save to DB.
            const m = buildModel("draft");
            console.log('[studio] Fermer click — force-emitting model', { alts: m?.suggestions?.length, rej: m?.rejectedSuggestions?.length, sec: m?.sections?.length });
            const cb = onModelChangeR.current;
            if (cb) cb(m);
            onClose();
          }} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #334", background: "transparent", color: "#8a93a8", cursor: "pointer", fontFamily: "monospace", fontSize: 13 }}>Fermer</button>}
          {!onClose && reviewActive && <button onClick={function () { setReviewActive(false); setAlts([]); }} title="Quitter le mode review (garde la géométrie)" style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #334", background: "transparent", color: "#8a93a8", cursor: "pointer", fontFamily: "monospace", fontSize: 13 }}>quitter</button>}
        </div>
      )}
      {openFile && view === "draw" && !trainingLabMode && <div style={{ padding: "6px 10px", background: "#07071a", borderBottom: "1px solid #131330", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0, fontSize: 11 }}>
        <span style={{ color: SC[ai % SC.length], fontWeight: "bold" }}>{"S" + (ai + 1) + " " + sec.pts.length + "pts" + (sec.closed ? " ✓" : "")}</span>
        <span style={{ color: "#3a5080" }}>Pentes → vue 3D · molette/2 doigts = zoom</span>
        {v16Err && <span style={{ color: "#ff6644" }}>{v16Err}</span>}
        <div style={{ flex: 1, minWidth: 8 }} />
        <div style={grp}>
          <input value={name} onChange={function (e) { setName(e.target.value); }} placeholder="nom de l'annotation…" title="Nom conservé dans le fichier sauvegardé" style={{ padding: "7px 8px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, border: "1px solid #2a3a60", background: "#0c1024", color: "#d8e2ff", minWidth: 130 }} />
          <label title="Rouvrir une annotation RoofModel sauvegardée" style={{ ...vbtn("#44ff88"), display: "inline-flex", alignItems: "center" }}>RoofModel↑<input type="file" accept="application/json,.json" onChange={importRoofModel} style={{ display: "none" }} /></label>
          <button onClick={function () { exportModel("validated"); }} title="Sauver l'annotation RoofModel (réouvrable avec RoofModel↑)" style={vbtn("#44ff88")}>RoofModel↓</button>
        </div>
        <div style={grp}>
          <label title="Importer une pré-annotation MVP v1.6 (charge l'image d'abord)" style={{ ...vbtn("#d8ff00"), display: "inline-flex", alignItems: "center" }}>v1.6↑<input type="file" accept="application/json,.json" onChange={importV16} style={{ display: "none" }} /></label>
          <button onClick={exportJSON} style={vbtn("#8a93a8")}>JSON↓</button>
          <label style={{ ...vbtn("#8a93a8"), display: "inline-flex", alignItems: "center" }}>JSON↑<input type="file" accept="application/json,.json" onChange={importJSON} style={{ display: "none" }} /></label>
          <button onClick={exportImage} style={vbtn("#44ddaa")}>capture↓</button>
        </div>
      </div>}
      {!toolsCollapsed && openAcc && view === "draw" && !trainingLabMode && <div style={{ padding: "6px 10px", background: "#07111a", borderBottom: "1px solid #103030", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0, fontSize: 11 }}>
        <span style={{ color: "#44ddaa", fontWeight: "bold" }}>ACCESSOIRES</span>
        <button onClick={togglePlaceAccessory} title="Placer un Maximum 301 : clique ce bouton puis une faîtière" style={{ ...vbtn("#44ddaa"), background: placingAcc ? "#44ddaa22" : "transparent" }}>{placingAcc ? "↳ clique une faîtière" : "+ Maximum 301"}</button>
        <span style={{ color: "#556677" }}>{accessories.length + " posé" + (accessories.length > 1 ? "s" : "") + (accessories.filter(function (a: any) { return a.accessory_orphaned; }).length ? " · " + accessories.filter(function (a: any) { return a.accessory_orphaned; }).length + " orphelin(s)" : "")}</span>
        {selAcc >= 0 && accessories[selAcc] && <button onClick={function () { setAccessories(function (l: any) { return l.filter(function (_: any, i: number) { return i !== selAcc; }); }); setSelAcc(-1); }} title="Supprimer l'accessoire sélectionné" style={vbtn("#ff8866")}>suppr. sél.</button>}
        {accessories.length > 0 && <button onClick={function () { setAccessories([]); setSelAcc(-1); }} title="Vider les accessoires" style={vbtn("#ff6644")}>reset acc</button>}
        <span style={{ color: "#3a5080" }}>tape une faîtière · glisse pour ajuster</span>
      </div>}
      {!toolsCollapsed && openBat && view === "draw" && !trainingLabMode && <div style={{ padding: "6px 10px", background: "#07101a", borderBottom: "1px solid #102030", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0, fontSize: 11 }}>
        <span style={{ color: "#88ccff", fontWeight: "bold" }}>BÂTIMENT (S{ai + 1})</span>
        <label style={{ color: "#7a8499", display: "inline-flex", alignItems: "center", gap: 4 }}>débord (po)
          <input type="number" min={0} max={48} step={1} value={batInsetIn}
            onChange={function (e) { const v = parseFloat(e.target.value); if (isFinite(v)) setBatInsetIn(v); }}
            style={{ width: 56, fontFamily: "monospace", fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #1e2240", background: "#0a0d1a", color: "#c7d2fe" }} />
        </label>
        <label style={{ color: "#7a8499", display: "inline-flex", alignItems: "center", gap: 4 }}>murs (pi)
          <input type="number" min={4} max={40} step={0.5} value={batHeightFt}
            onChange={function (e) { const v = parseFloat(e.target.value); if (isFinite(v)) setBatHeightFt(v); }}
            style={{ width: 56, fontFamily: "monospace", fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #1e2240", background: "#0a0d1a", color: "#c7d2fe" }} />
        </label>
        <button
          onClick={function () {
            if (!sec.closed || sec.pts.length < 3) return;
            const gsd = calibR.current && calibR.current.gsd > 0 ? calibR.current.gsd : null;
            const offsetPx = inchesToPx(batInsetIn, gsd);
            if (offsetPx == null) { setV16Err("Calibrez la carte (Geler la vue) avant d'ajouter un bâtiment."); return; }
            const bp = offsetPolygonInward(sec.pts, offsetPx);
            if (!bp) { setV16Err("Débord trop grand pour ce contour de toit — réduis la valeur."); return; }
            // height_ft → image-pixels via gsd (mêmes unités que les pts du toit)
            const heightPx = batHeightFt * 0.3048 / gsd;
            setSecs(function (ss: any) {
              const ns = ss.slice();
              ns[ai] = Object.assign({}, ns[ai], { building: { pts: bp, inset_in: batInsetIn, height_ft: batHeightFt, _height_px: heightPx } });
              return ns;
            });
            setV16Err(null);
          }}
          disabled={!sec.closed}
          style={{ ...vbtn("#88ccff"), opacity: sec.closed ? 1 : 0.4, cursor: sec.closed ? "pointer" : "not-allowed" }}
          title={sec.closed ? "Calcule et ajoute le contour des murs à la section courante" : "Ferme d'abord le polygone de toit"}>
          {sec.building ? "↻ recalculer" : "+ ajouter à S" + (ai + 1)}
        </button>
        {sec.building && <button
          onClick={function () { setSecs(function (ss: any) { const ns = ss.slice(); const sc2 = Object.assign({}, ns[ai]); delete sc2.building; ns[ai] = sc2; return ns; }); }}
          style={vbtn("#ff8866")} title="Retirer le bâtiment de cette section">suppr.</button>}
        <span style={{ color: "#3a5080" }}>{sec.building ? `actuel : ${sec.building.inset_in}" / ${sec.building.height_ft}'` : "ajustable après pose, ré-extrudable en 3D"}</span>
      </div>}
      {!toolsCollapsed && openMap && view === "draw" && !trainingLabMode && <div style={{ padding: "6px 10px", background: "#0c081a", borderBottom: "1px solid #1c1430", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexShrink: 0, fontSize: 11 }}>
        <span style={{ color: "#aa88ff", fontWeight: "bold" }}>CARTE</span>
        <div style={grp}>
          {B(mapSource === "google", "#aa88ff", function () { setMapSource("google"); }, false, "Google")}
          {B(mapSource === "ortho", "#aa88ff", function () { setMapSource("ortho"); }, false, "Orthophoto QC")}
        </div>
        <input ref={addrInputRef} value={mapAddr} onChange={function (e) { setMapAddr(e.target.value); }}
          placeholder="Entre une adresse…" title="Cherche l'adresse, choisis-la dans la liste Google, navigue/zoome (2 doigts) puis gèle la vue"
          inputMode="text" autoComplete="off"
          style={{ flex: 1, minWidth: 200, padding: "9px 10px", fontSize: 16, fontFamily: "monospace", borderRadius: 6, border: "1px solid " + (placesReady ? "#3a2f66" : "#2a2350"), background: "#0c0c24", color: "#e0daff", touchAction: "manipulation" }} />
        <span style={{ color: "#3a5080" }}>2 doigts = zoom · glisse = déplacer</span>
        {geoRef && <span style={{ color: "#66cc88" }} title="Vue gelée géoréférencée">{"gelée " + (geoRef.provider || "?") + " z" + geoRef.zoom + " · N↑"}</span>}
        {!placesReady && <span style={{ color: "#7a6aa8" }}>chargement Google…</span>}
      </div>}
      <div ref={cv2w} style={{ display: view === "draw" ? "flex" : "none", flex: 1, position: "relative", overflow: "hidden" }}>
        <canvas ref={cv2} onMouseMove={dbgMove} style={{ display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "crosshair" }} />
        {/* Merge-apex preview overlay — highlights the ridge-node clusters that
            will collapse to their centroid when the user confirms. Re-renders
            with `tick` (same trigger as the canvas) so pan/zoom stay in sync. */}
        {trainingLabMode && mergePreview && mergeCandidates.length > 0 && (
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 5 }}
            width={cvSz.w}
            height={cvSz.h}
            viewBox={"0 0 " + cvSz.w + " " + cvSz.h}
          >
            {mergeCandidates.map(function (cl: any, ci: number) {
              const cScr = w2s(cl.centroid.x, cl.centroid.y, xf.current);
              return (
                <g key={ci}>
                  {cl.points.map(function (p: any, pi: number) {
                    const s = w2s(p.x, p.y, xf.current);
                    return (
                      <g key={pi}>
                        <line x1={s.sx} y1={s.sy} x2={cScr.sx} y2={cScr.sy} stroke="#22ddff" strokeWidth={1.5} strokeDasharray="3,3" opacity={0.7} />
                        <circle cx={s.sx} cy={s.sy} r={9} fill="none" stroke="#22ddff" strokeWidth={2} opacity={0.9} />
                      </g>
                    );
                  })}
                  <circle cx={cScr.sx} cy={cScr.sy} r={13} fill="#44ff8866" stroke="#44ff88" strokeWidth={2.5} />
                  <text x={cScr.sx} y={cScr.sy + 4} textAnchor="middle" fontSize={11} fontFamily="monospace" fill="#0a1a14" fontWeight="bold">{cl.points.length}</text>
                </g>
              );
            })}
          </svg>
        )}
        {/* Interactive map picker overlay — pan + pinch-zoom to frame the building.
            Polygons (building/lot) are guidance only; the frozen image excludes them. */}
        {openMap && view === "draw" && (
          <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "#060610" }}>
            <div ref={mapDivRef} style={{ position: "absolute", inset: 0 }} />
            {!placesReady && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#9a93c8", fontFamily: "monospace", fontSize: 13 }}>chargement de la carte…</div>}
            <div style={{ position: "absolute", left: 12, top: 12, zIndex: 31, background: "rgba(9,8,24,0.82)", border: "1px solid #2a2350", borderRadius: 8, padding: "6px 10px", fontFamily: "monospace", fontSize: 11, color: "#c4b5fd", pointerEvents: "none", maxWidth: 280, display: "flex", alignItems: "center", gap: 8 }}>
              {bldgLoading && <span className="rs-spin" style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid #4a3f7a", borderTopColor: "#c4b5fd", flexShrink: 0 }} />}
              <span>{bldgLoading ? "Recherche du bâtiment et du lot…" : (bldgGeo || lotGeo) ? "Bâtiment (orange) / lot (bleu) trouvés — cadre puis « Geler la vue »" : "Cherche une adresse, puis cadre le bâtiment (2 doigts = zoom)"}</span>
            </div>
            <button onClick={freezeMapView} style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 18, zIndex: 31, padding: "12px 22px", borderRadius: 10, border: "1px solid #aa88ff", background: "rgba(120,90,255,0.32)", color: "#ece4ff", cursor: "pointer", fontFamily: "monospace", fontSize: 15, fontWeight: "bold", backdropFilter: "blur(8px)", boxShadow: "0 4px 18px rgba(0,0,0,0.45)" }}>Geler la vue</button>
          </div>
        )}
        {dbg && (
          <div style={{ position: "absolute", left: 10, top: 10, zIndex: 11, background: "rgba(9,10,25,0.92)", border: "1px solid #1e2240", borderRadius: 8, padding: "8px 10px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.55, color: "#aab4c8", minWidth: 200, pointerEvents: "none" }}>
            <div>natural : <b style={{ color: "#e8ff66" }}>{bgImg && bgImg.naturalWidth ? bgImg.naturalWidth + "×" + bgImg.naturalHeight : "—"}</b></div>
            <div>rendered : <b style={{ color: "#e8ff66" }}>{cvSz.w}×{cvSz.h}</b></div>
            <div>scale : <b style={{ color: "#e8ff66" }}>{xf.current.scale.toFixed(5)}</b></div>
            <div>offset : <b style={{ color: "#e8ff66" }}>{Math.round(xf.current.tx)},{Math.round(xf.current.ty)}</b></div>
            <div>img-space : <b style={{ color: "#39d0ff" }}>{cur ? cur.ix + "," + cur.iy : "—"}</b></div>
            <div>vp-space : <b style={{ color: "#39d0ff" }}>{cur ? cur.vx + "," + cur.vy : "—"}</b></div>
          </div>
        )}
        {!bgImg && !secs.some(function (s: any) { return s.closed || (s.pts && s.pts.length > 0); }) && (
          <label style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div className="rs-glow" style={{ width: 84, height: 84, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(120,90,255,0.16)", border: "1px solid rgba(150,120,255,0.55)", color: "#c4b5fd" }}>
              <ImagePlus size={36} strokeWidth={1.8} />
            </div>
            <span style={{ fontSize: 13, color: "#c4b5fd", fontFamily: "monospace", textShadow: "0 0 10px rgba(130,100,255,0.6)" }}>Importer une image</span>
            <input type="file" accept="image/*" onChange={loadImg} style={{ display: "none" }} />
          </label>
        )}
        {/* Pills undo + snap modes : utiles uniquement quand on dessine en 2D.
            En 3D ils n'ont aucun sens (rien à undo, rien à snap) → on cache. */}
        {view !== "3d" && <>
        <div ref={pillRef}
          onMouseDown={pillDown} onMouseMove={pillMove} onMouseUp={pillUp} onMouseLeave={pillUp}
          onTouchStart={pillDown} onTouchMove={pillMove} onTouchEnd={pillUp}
          style={Object.assign(
            { position: "absolute" as const, zIndex: 10, background: "rgba(10,12,30,0.85)", border: "1px solid #2a3a60", borderRadius: 20, padding: "8px 14px", display: "flex", gap: 8, alignItems: "center", cursor: "grab", touchAction: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.5)" },
            pillPos.x === null ? { right: trainingLabMode ? 8 : 14 } : { left: pillPos.x },
            pillPos.y === null
              ? (trainingLabMode ? { top: 180 } : { bottom: 72 })
              : { top: pillPos.y }
          )}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{"<-"}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 9, color: "#3a5080", lineHeight: 1 }}>undo</span>
            <span style={{ fontSize: 10, color: sec.closed ? "#44ddaa" : sec.pts.length > 0 ? "#4499ff" : "#2a3a60", lineHeight: 1 }}>{sec.closed ? "closed" : (sec.pts.length + "pt")}</span>
          </div>
          <span style={{ fontSize: 10, color: "#1e2a40", marginLeft: 2 }}>::</span>
        </div>
        {/* Annotation modes pill — sous le pill "undo", suit son drag.
            Contient : length-lock + 3 toggles de snap. */}
        <div
          style={{
            position: "absolute",
            right: pillPos.x === null ? (trainingLabMode ? 8 : 14) : undefined,
            bottom: pillPos.y === null ? (trainingLabMode ? undefined : 14) : undefined,
            left: pillPos.x !== null ? pillPos.x : undefined,
            top: pillPos.y === null ? (trainingLabMode ? 236 : undefined) : (pillPos.y + 56),
            zIndex: 10,
            background: "rgba(10,12,30,0.85)",
            border: "1px solid #2a3a60",
            borderRadius: 20,
            padding: "6px 10px",
            display: "flex",
            gap: 6,
            alignItems: "center",
            boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
          }}
        >
          {/* 📏 Length lock — 3 états : idle / picking / locked */}
          {lengthLock.refLen != null ? (
            <button
              onClick={function () { setLengthLock({ picking: false, refLen: null }); }}
              title={"Longueur verrouillée : " + lengthLock.refLen.toFixed(1) + " — clic pour libérer"}
              style={{ padding: "5px 9px", fontSize: 11, fontFamily: "monospace", borderRadius: 14, cursor: "pointer", border: "1px solid #ffaa44", background: "#ffaa4422", color: "#ffaa44", fontWeight: "bold", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              📏 {lengthLock.refLen.toFixed(0)} ✕
            </button>
          ) : lengthLock.picking ? (
            <button
              onClick={function () { setLengthLock({ picking: false, refLen: null }); }}
              title="Tape un segment de référence dans le canvas — ou clic ici pour annuler"
              style={{ padding: "5px 9px", fontSize: 11, fontFamily: "monospace", borderRadius: 14, cursor: "pointer", border: "1px solid #22ddff", background: "#22ddff22", color: "#22ddff", fontWeight: "bold" }}
            >
              📏 sélectionne…
            </button>
          ) : (
            <button
              onClick={function () { setLengthLock({ picking: true, refLen: null }); }}
              title="Fixer la longueur d'un segment de référence — chaque point suivant sera placé à cette distance exacte"
              style={{ padding: "5px 9px", fontSize: 11, fontFamily: "monospace", borderRadius: 14, cursor: "pointer", border: "1px solid #2a3a60", background: "transparent", color: "#7a90c0" }}
            >
              📏 fixer L
            </button>
          )}
          <div style={{ width: 1, height: 18, background: "#1e2240" }} />
          {/* Snap mode toggles */}
          {[
            { key: "collinear" as const, label: "⟍", title: "Snap collinéaire (lignes alignées avec d'autres segments)" },
            { key: "parallel" as const, label: "//", title: "Snap parallèle (angle aligné avec un segment existant)" },
            { key: "perpendicular" as const, label: "⊥", title: "Snap 90° (coin perpendiculaire automatique)" },
          ].map(function (m) {
            const on = snapModes[m.key];
            return (
              <button
                key={m.key}
                onClick={function () { setSnapModes(function (sm) { return Object.assign({}, sm, { [m.key]: !sm[m.key] }); }); }}
                title={m.title + " — " + (on ? "actif" : "désactivé")}
                style={{
                  padding: "5px 9px",
                  fontSize: 13,
                  fontFamily: "monospace",
                  borderRadius: 14,
                  cursor: "pointer",
                  border: "1px solid " + (on ? "#44ddaa" : "#2a3a60"),
                  background: on ? "#44ddaa22" : "transparent",
                  color: on ? "#44ddaa" : "#556677",
                  minWidth: 28,
                  lineHeight: 1,
                  fontWeight: on ? "bold" : "normal",
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        </>}
        {/* ───────── Pills flottants en trainingLabMode (drag + localStorage) ─────────
            Remplacent la barre d'outils du haut, qui ne contient plus que 2D/3D.
            Chaque pill est déplaçable par sa poignée ⋮⋮ — les boutons internes
            restent cliquables. Position persistée par device dans localStorage. */}
        {trainingLabMode && (view === "draw" || view === "3d") && (<>
          {/* ── Pills "slide-out" ancrés à droite. Icône lucide propre quand
              collapsed (aucun emoji). Clic sur icône = toggle. Drag = bouge.
              Contenu s'étend vers la GAUCHE quand expanded (right anchored). ── */}

          {/* SECTIONS pill (icône Layers) */}
          <div
            ref={sectionsPill.elRef}
            style={Object.assign(
              { position: "absolute" as const, zIndex: 11, display: "flex", flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 6 },
              sectionsPill.pos ? { right: sectionsPill.pos.right, top: sectionsPill.pos.top } : { right: 8, top: 12 }
            )}
          >
            {sectionsPill.expanded && (
              <div style={{ background: "rgba(10,12,30,0.94)", border: "1px solid #2a3a60", borderRadius: 10, padding: "6px 8px", boxShadow: "0 2px 12px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {secs.map(function (_: any, si: number) {
                    const isHidden = !!secs[si].hidden;
                    return (
                      <div key={si} style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
                        <button
                          onClick={function () { setAi(si); setSel(-1); setPrev(null); }}
                          style={{
                            padding: "6px 8px 6px 10px",
                            fontSize: 12,
                            fontFamily: "monospace",
                            borderRadius: "6px 0 0 6px",
                            cursor: "pointer",
                            touchAction: "manipulation",
                            border: "1px solid " + SC[si % SC.length],
                            borderRight: "none",
                            background: si === ai ? (SC[si % SC.length] + "33") : "transparent",
                            color: isHidden ? "#555" : (si === ai ? SC[si % SC.length] : "#556677"),
                            fontWeight: si === ai ? "bold" : "normal",
                            textDecoration: isHidden ? "line-through" : "none",
                            opacity: isHidden ? 0.5 : 1,
                          }}
                        >
                          {"S" + (si + 1) + (secs[si].closed ? " v" : "")}
                        </button>
                        <button
                          onClick={function () {
                            setSecs(function (prevSecs: any[]) {
                              return prevSecs.map(function (s: any, idx: number) {
                                return idx === si ? Object.assign({}, s, { hidden: !s.hidden }) : s;
                              });
                            });
                          }}
                          title={isHidden ? "Réafficher S" + (si + 1) : "Masquer S" + (si + 1) + " (voir l'image en dessous)"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0 8px",
                            minWidth: 30,
                            borderRadius: "0 6px 6px 0",
                            cursor: "pointer",
                            touchAction: "manipulation",
                            border: "1px solid " + SC[si % SC.length],
                            background: isHidden ? "transparent" : (SC[si % SC.length] + "22"),
                            color: isHidden ? "#666" : SC[si % SC.length],
                          }}
                        >
                          {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    );
                  })}
                  <button onClick={addSec} disabled={!sec.closed} title="Nouvelle section" style={{ padding: "6px 12px", fontSize: 16, lineHeight: 1, borderRadius: 6, cursor: sec.closed ? "pointer" : "not-allowed", touchAction: "manipulation", border: "1px solid #44ddaa", background: "transparent", color: sec.closed ? "#44ddaa" : "#1e4040", fontFamily: "monospace", opacity: sec.closed ? 1 : 0.4 }}>+</button>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {B(sel >= 0, "#ff4444", delSel, sel < 0, "x v" + sel)}
                  {B(false, "#44ff88", closeSec, sec.pts.length < 3 || sec.closed, "fermer")}
                  {B(false, "#ff6644", delSec, secs.length === 1 && !sec.pts.length, "del S" + (ai + 1))}
                  {hasNoOv && B(true, "#ffcc44", resetNodes, false, "reset nodes")}
                </div>
                {/* Solo mode 3D — n'affiche que la section active. Utile quand
                    plusieurs sections se chevauchent et créent un nœud 3D. */}
                {view === "3d" && secs.length > 1 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button onClick={function () { setSolo3D(function (v) { return !v; }); }} title="Solo 3D : n'affiche que la section active (cache les autres)" style={{ padding: "6px 10px", fontSize: 11, fontFamily: "monospace", borderRadius: 6, cursor: "pointer", touchAction: "manipulation", border: "1px solid " + (solo3D ? "#ffaa44" : "#3a3f66"), background: solo3D ? "#ffaa4422" : "transparent", color: solo3D ? "#ffaa44" : "#9aa3c8", fontWeight: solo3D ? "bold" : "normal" }}>
                      {solo3D ? "● Solo 3D" : "Solo 3D"}
                    </button>
                  </div>
                )}
                {/* Toggles overlays Lot + Bâtiment — visibles seulement quand on
                    a les données nécessaires (lat/lng polygons + geoRef de
                    capture). Step 1 : render-only (pas encore éditable). */}
                {(buildingOverlayPx || lotOverlayPx) && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end", borderTop: "1px solid #1e2240", paddingTop: 5 }}>
                    {buildingOverlayPx && (
                      <button onClick={function () { setShowBuildingOverlay(function (v) { return !v; }); }} title="Afficher/cacher le polygone bâtiment (overlay orange)" style={{ padding: "6px 10px", fontSize: 11, fontFamily: "monospace", borderRadius: 6, cursor: "pointer", touchAction: "manipulation", border: "1px solid #ffaa50", background: showBuildingOverlay ? "#ffaa5022" : "transparent", color: "#ffaa50", fontWeight: showBuildingOverlay ? "bold" : "normal" }}>
                        {showBuildingOverlay ? "● Bâtiment" : "Bâtiment"}
                      </button>
                    )}
                    {lotOverlayPx && (
                      <button onClick={function () { setShowLotOverlay(function (v) { return !v; }); }} title="Afficher/cacher le polygone lot (overlay bleu)" style={{ padding: "6px 10px", fontSize: 11, fontFamily: "monospace", borderRadius: 6, cursor: "pointer", touchAction: "manipulation", border: "1px solid #78b4ff", background: showLotOverlay ? "#78b4ff22" : "transparent", color: "#78b4ff", fontWeight: showLotOverlay ? "bold" : "normal" }}>
                        {showLotOverlay ? "● Lot" : "Lot"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <PillIconButton icon={Layers} color="#4499ff" expanded={sectionsPill.expanded} onClick={sectionsPill.safeToggle} handlers={sectionsPill.dragHandlers} />
          </div>

          {/* VUE pill (icône Eye) */}
          <div
            ref={vuePill.elRef}
            style={Object.assign(
              { position: "absolute" as const, zIndex: 11, display: "flex", flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 6 },
              vuePill.pos ? { right: vuePill.pos.right, top: vuePill.pos.top } : { right: 8, top: 64 }
            )}
          >
            {vuePill.expanded && (
              <div style={{ background: "rgba(10,12,30,0.94)", border: "1px solid #2a3a60", borderRadius: 10, padding: "6px 8px", boxShadow: "0 2px 12px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 5, minWidth: 220 }}>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {B(solid, "#44ddaa", function () { setSolid(function (v) { return !v; }); }, false, solid ? "solide" : "transparent")}
                  {(bgImg || secs.some(function (s: any) { return s.pts.length; })) && B(true, "#88aaff", function () { resetView(); setTick(function (t) { return t + 1; }); }, false, "fit " + scale.toFixed(2) + "x")}
                  <button
                    onClick={function () { setHideAnnotations(function (v) { return !v; }); }}
                    title={hideAnnotations ? "Afficher la pré-annotation IA" : "Cacher temporairement les polygones pour voir le toit"}
                    style={{ padding: "6px 10px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, cursor: "pointer", touchAction: "manipulation", border: "1px solid " + (hideAnnotations ? "#ffaa44" : "#3a3f66"), background: hideAnnotations ? "#ffaa4422" : "transparent", color: hideAnnotations ? "#ffaa44" : "#9aa3c8" }}>
                    {hideAnnotations ? "IA cachée" : "IA visible"}
                  </button>
                </div>
                {bgImg && (<>
                  <label title="Luminosité (1 = neutre)" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", fontSize: 11, fontFamily: "monospace", borderRadius: 6, border: "1px solid " + (brightness !== 1 ? "#ffaa44" : "#1e2240"), background: brightness !== 1 ? "#ffaa4411" : "transparent", color: brightness !== 1 ? "#ffaa44" : "#8a93a8" }}>
                    <span style={{ minWidth: 64 }}>Luminosité</span>
                    <span style={{ minWidth: 32 }}>{brightness.toFixed(2)}</span>
                    <input type="range" min={0.3} max={2} step={0.05} value={brightness} onChange={function (e) { setBrightness(+e.target.value); }} style={{ flex: 1, minWidth: 70, accentColor: "#ffaa44" }} />
                    {brightness !== 1 && <button onClick={function () { setBrightness(1); }} title="Reset" style={{ padding: "1px 6px", fontSize: 10, border: "1px solid #ffaa4466", background: "transparent", color: "#ffaa44", borderRadius: 4, cursor: "pointer", fontFamily: "monospace" }}>reset</button>}
                  </label>
                  <label title="Contraste (1 = neutre)" style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", fontSize: 11, fontFamily: "monospace", borderRadius: 6, border: "1px solid " + (contrast !== 1 ? "#88aaff" : "#1e2240"), background: contrast !== 1 ? "#88aaff11" : "transparent", color: contrast !== 1 ? "#88aaff" : "#8a93a8" }}>
                    <span style={{ minWidth: 64 }}>Contraste</span>
                    <span style={{ minWidth: 32 }}>{contrast.toFixed(2)}</span>
                    <input type="range" min={0.3} max={2} step={0.05} value={contrast} onChange={function (e) { setContrast(+e.target.value); }} style={{ flex: 1, minWidth: 70, accentColor: "#88aaff" }} />
                    {contrast !== 1 && <button onClick={function () { setContrast(1); }} title="Reset" style={{ padding: "1px 6px", fontSize: 10, border: "1px solid #88aaff66", background: "transparent", color: "#88aaff", borderRadius: 4, cursor: "pointer", fontFamily: "monospace" }}>reset</button>}
                  </label>
                </>)}
              </div>
            )}
            <PillIconButton icon={Eye} color="#44ddaa" expanded={vuePill.expanded} onClick={vuePill.safeToggle} handlers={vuePill.dragHandlers} />
          </div>

          {/* TYPE pill (icône House) — toits stackés VERTICALEMENT comme demandé */}
          {sec.closed && (
            <div
              ref={typePill.elRef}
              style={Object.assign(
                { position: "absolute" as const, zIndex: 11, display: "flex", flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 6 },
                typePill.pos ? { right: typePill.pos.right, top: typePill.pos.top } : { right: 8, top: 116 }
              )}
            >
              {typePill.expanded && (
                <div style={{ background: "rgba(10,12,30,0.94)", border: "1px solid #2a3a60", borderRadius: 10, padding: "6px 8px", boxShadow: "0 2px 12px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 5, minWidth: 160 }}>
                  <div style={{ fontSize: 10, color: "#8a93a8", padding: "0 4px 2px", textAlign: "right" as const }}>S{ai + 1}</div>
                  {/* Pente de la section active (1-12 /12). Ajustable en
                      contexte sans devoir réappliquer un preset. Met à jour
                      sec.pitch puis re-run updSkel pour rafraîchir la 3D. */}
                  {sec.closed && sec.roof_type !== "flat" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", border: "1px solid #1e2240", borderRadius: 6, background: "rgba(255,255,255,0.02)" }}>
                      <span style={{ fontSize: 11, color: "#8a93a8", fontFamily: "monospace", minWidth: 36 }}>Pente</span>
                      <input
                        type="range" min={1} max={12} step={1}
                        value={Math.round(sec.pitch || 7)}
                        onChange={function (e) {
                          const newPitch = +e.target.value;
                          setSecs(function (ss: any) {
                            const ns = ss.slice();
                            ns[ai] = Object.assign({}, ns[ai], { pitch: newPitch });
                            return ns;
                          });
                          setTimeout(function () { updSkel(ai); }, 0);
                        }}
                        style={{ flex: 1, minWidth: 60, accentColor: "#d8ff00" }}
                      />
                      <strong style={{ fontSize: 11, color: "#d8ff00", fontFamily: "monospace", minWidth: 32, textAlign: "right" as const }}>{Math.round(sec.pitch || 7)}/12</strong>
                    </div>
                  )}
                  {/* Hauteur (elev) de la section active. Permet d'empiler les
                      sections en Z : un toit plus haut = elev plus grand. Utile
                      pour les bâtiments multi-niveaux (annexe + corps principal
                      avec toits décalés). */}
                  {sec.closed && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", border: "1px solid #1e2240", borderRadius: 6, background: "rgba(255,255,255,0.02)" }}>
                      <span style={{ fontSize: 11, color: "#8a93a8", fontFamily: "monospace", minWidth: 36 }}>Hauteur</span>
                      <input
                        type="range" min={0} max={50} step={1}
                        value={Math.round(sec.elev || 0)}
                        onChange={function (e) {
                          const newElev = +e.target.value;
                          setSecs(function (ss: any) {
                            const ns = ss.slice();
                            ns[ai] = Object.assign({}, ns[ai], { elev: newElev });
                            return ns;
                          });
                        }}
                        style={{ flex: 1, minWidth: 60, accentColor: "#ff66dd" }}
                      />
                      <strong style={{ fontSize: 11, color: "#ff66dd", fontFamily: "monospace", minWidth: 32, textAlign: "right" as const }}>{Math.round(sec.elev || 0)}</strong>
                    </div>
                  )}
                  {[
                    { label: "Plat", pitch: 0.5, roof_type: "flat", color: "#88aaff" },
                    { label: "Mono", pitch: 3, roof_type: "shed", color: "#ffaa88" },
                    { label: "Hip", pitch: 7, roof_type: "hip", color: "#44ddaa" },
                    { label: "Pignon", pitch: 7, roof_type: "gable", color: "#d8ff00" },
                    { label: "Tourelle", pitch: 12, roof_type: "tower", color: "#ff66dd" },
                  ].map(function (preset) {
                    const isActive = (sec.roof_type || "hip") === preset.roof_type;
                    return (
                      <button
                        key={preset.roof_type}
                        onClick={function () {
                          if (preset.roof_type === "tower") { applyTowerPreset(); return; }
                          setSecs(function (ss: any) {
                            const ns = ss.slice();
                            const cur = ns[ai];
                            if (!cur) return ss;
                            const updated: any = Object.assign({}, cur, { pitch: preset.pitch, roof_type: preset.roof_type });
                            updated._no = preset.roof_type === "gable" ? gableEndsOverrides(cur.pts) : {};
                            ns[ai] = updated;
                            return ns;
                          });
                        }}
                        style={{ padding: "8px 12px", fontSize: 12, fontFamily: "monospace", borderRadius: 6, cursor: "pointer", touchAction: "manipulation", border: "1px solid " + preset.color + (isActive ? "" : "66"), background: isActive ? preset.color + "22" : "transparent", color: preset.color, fontWeight: isActive ? "bold" : "normal", textAlign: "left" as const }}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                  {mergeCandidates.length > 0 && (
                    <>
                      <div style={{ height: 1, background: "#1e2240", margin: "2px 0" }} />
                      {!mergePreview ? (
                        <button
                          onClick={function () { setMergePreview(true); }}
                          title={"Aperçu du merge — " + mergeCandidates.reduce(function (s: number, c: any) { return s + c.points.length; }, 0) + " points fusionnés en " + mergeCandidates.length}
                          style={{ padding: "6px 10px", fontSize: 11, fontFamily: "monospace", borderRadius: 5, cursor: "pointer", touchAction: "manipulation", border: "1px solid #ffaa44", background: "transparent", color: "#ffaa44", textAlign: "left" as const }}
                        >
                          {"Merge apex (" + mergeCandidates.reduce(function (s: number, c: any) { return s + c.points.length; }, 0) + " → " + mergeCandidates.length + ")"}
                        </button>
                      ) : (
                        <div style={{ display: "flex", gap: 5 }}>
                          <button onClick={applyMergeApex} style={{ padding: "6px 10px", fontSize: 11, fontFamily: "monospace", borderRadius: 5, cursor: "pointer", touchAction: "manipulation", border: "1px solid #44ff88", background: "#44ff8822", color: "#44ff88", fontWeight: "bold", flex: 1 }}>Confirmer</button>
                          <button onClick={function () { setMergePreview(false); }} style={{ padding: "6px 10px", fontSize: 11, fontFamily: "monospace", borderRadius: 5, cursor: "pointer", touchAction: "manipulation", border: "1px solid #888", background: "transparent", color: "#888" }}>annuler</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <PillIconButton icon={House} color="#d8ff00" expanded={typePill.expanded} onClick={typePill.safeToggle} handlers={typePill.dragHandlers} />
            </div>
          )}

          {/* RECALER pill (icône Wrench) — ouvre la page Recaler pour ajuster le
              polygone du bâtiment quand l'IA s'est plantée. Bouton single-shot :
              on ne le collapse/expand pas, on clique → ça lance onOpenRecaler. */}
          {onOpenRecaler && (
            <div
              ref={recalerPill.elRef}
              style={Object.assign(
                { position: "absolute" as const, zIndex: 11, display: "flex", flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 6 },
                recalerPill.pos ? { right: recalerPill.pos.right, top: recalerPill.pos.top } : { right: 8, top: 168 }
              )}
            >
              <button
                onClick={function () { recalerPill.safeClick(function () { onOpenRecaler(); }); }}
                {...recalerPill.dragHandlers}
                title="Ouvrir Recaler — ajuster le polygone du bâtiment sur la carte"
                style={{
                  width: 44, height: 44,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(10,12,30,0.94)",
                  border: "1px solid #2a3a60",
                  borderRadius: 10,
                  color: "#c4b5fd",
                  cursor: "grab",
                  touchAction: "none",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
                  flexShrink: 0,
                }}
              >
                <Wrench size={20} strokeWidth={2} />
              </button>
            </div>
          )}
        </>)}
      </div>
      <div style={{ display: view === "3d" ? "flex" : "none", flex: 1, position: "relative", overflow: "hidden" }}>
        <canvas ref={cv3} style={{ display: "block", width: "100%", height: "100%", touchAction: "none", cursor: edit3d === "solid" ? "ns-resize" : "grab" }} />
        {zInfo && <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 12, background: "rgba(9,10,25,0.92)", border: "1px solid #ffaa44", borderRadius: 8, padding: "6px 14px", fontFamily: "monospace", fontSize: 16, fontWeight: "bold", color: "#ffaa44", letterSpacing: 0.5 }}>{zInfo}</div>}
        <div style={{ position: "absolute", left: 10, bottom: 10, zIndex: 10, background: "rgba(9,10,25,0.9)", border: "1px solid #1e2240", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4, fontFamily: "monospace", minWidth: legendOpen ? 170 : 0 }}>
          <button onClick={function () { setLegendOpen(function (v) { return !v; }); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: "monospace", fontSize: 11 }}>
            <span style={{ color: "#8a93a8" }}>{legendOpen ? "▾" : "▸"}</span>
            <span style={{ fontWeight: "bold", color: "#cbd5e1", flex: 1, textAlign: "left" }}>Mesures</span>
            {!legendOpen && <span style={{ color: "#e8ff66", fontWeight: "bold" }}>{fmtArea((measures as any).face || 0)}</span>}
          </button>
          {legendOpen && LEGEND.map(function (item) {
            const on = hl === item.key;
            const val = (measures as any)[item.key] || 0;
            return (
              <React.Fragment key={item.key}>
                <button onClick={function () { setHl(function (h) { return h === item.key ? null : item.key; }); }}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 4px", background: on ? "rgba(216,255,0,0.12)" : "transparent", border: "none", borderRadius: 4, cursor: "pointer", color: on ? "#e8ff66" : "#aab4c8", fontSize: 11, textAlign: "left", width: "100%" }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: item.key === "face" ? "transparent" : item.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {/* Quantité TOUJOURS visible (avant : seulement au clic). Vif si
                      surligné (on), atténué sinon. Le clic garde la surbrillance. */}
                  <b style={{ color: on ? "#e8ff66" : "#7c879e" }}>{item.area ? fmtArea(val) : fmtLen(val)}</b>
                </button>
                {item.key === "face" && <div style={{ paddingLeft: 19, display: "flex", flexDirection: "column", gap: 3, marginBottom: 2 }}>
                  {Object.keys((measures as any).byPitch || {}).sort(function (a, b) { return (+b) - (+a); }).map(function (p) {
                    return (<div key={p} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#cbd5e1" }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: pitchColor(+p), flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{p}/12</span>
                      <b style={{ color: "#e8ff66" }}>{fmtArea((measures as any).byPitch[p])}</b>
                    </div>);
                  })}
                </div>}
              </React.Fragment>
            );
          })}
          {legendOpen && accessories.length > 0 && (function () {
            const counts: Record<string, number> = {};
            accessories.forEach(function (a: any) { const k = a.variant_id || "?"; counts[k] = (counts[k] || 0) + 1; });
            const orph = accessories.filter(function (a: any) { return a.accessory_orphaned; }).length;
            return (
              <div style={{ paddingTop: 4, marginTop: 2, borderTop: "1px solid #1e2240" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#ffae5c", padding: "3px 4px" }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "#ff8c1a", boxShadow: "0 0 8px 2px rgba(255,140,26,0.85)", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: "bold" }}>Maximum</span>
                  <b style={{ color: "#ffae5c" }}>{accessories.length}</b>
                </div>
                {Object.keys(counts).sort().map(function (v) {
                  return (<div key={v} style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 19, fontSize: 11, color: "#cbd5e1" }}>
                    <span style={{ flex: 1 }}>{v}</span>
                    <b style={{ color: "#ffae5c" }}>{"× " + counts[v]}</b>
                  </div>);
                })}
                {orph > 0 && <div style={{ paddingLeft: 19, fontSize: 10, color: "#ff6655" }}>{orph + " orphelin(s)"}</div>}
              </div>
            );
          })()}
          {legendOpen && <div style={{ fontSize: 9, color: "#3a5080", marginTop: 2 }}>{ftPerPx != null ? "mesures réelles (pi/pi²) · échelle " + (gsd as number).toFixed(3) + " m/px · clic = surligner" : "mesures en unités image · gèle une carte pour calibrer · clic = surligner"}</div>}
        </div>
      </div>
    </div>
  );
}
