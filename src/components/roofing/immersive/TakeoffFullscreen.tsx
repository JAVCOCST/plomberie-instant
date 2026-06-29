// TakeoffFullscreen — local fullscreen overlay hosting AdminRoofStudio for the
// quote takeoff flow. GLUE only: adapts the studio's emitted model through the
// roof-takeoff domain and hands a FormData patch back to the wizard.
//
// Phase 1D (hardening): scroll-lock orphan guard, double-validate guard,
// skip-save-when-unchanged + idle-deferred autosave, save-on-close (no data
// loss), live calibration banner, larger field-friendly controls. No studio
// rewrite, no roof-core change.
import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { FormData } from "@/types/roofing";
import { buildTakeoffFromStudio, isBlocking } from "./takeoffBridge";
import { ux } from "./takeoffMetrics";

const AdminRoofStudio = lazy(() => import("@/pages/AdminRoofStudio"));

export interface TakeoffFullscreenProps {
  initialModel?: any;
  backgroundImage?: string;
  draftId?: string | null;
  mapSeed?: { lat?: number | null; lng?: number | null; address?: string | null };
  /** Brouillon RoofTakeoff non-validé chargé depuis soumissions.takeoff_draft.
   *  Prioritaire sur initialModel pour le seed du traceur. */
  initialDraft?: any | null;
  /** Demande au parent de persister le brouillon sur Supabase. Passer `null`
   *  pour effacer (à la validation). Pas de stockage local — voir le parent. */
  onAutosaveDraft?: (takeoff: any | null) => void | Promise<void>;
  onApplyPatch: (patch: Partial<FormData>) => void;
  onClose: () => void;
  /** Dernière vue caméra gelée (orbite/zoom) à restaurer à l'ouverture. */
  initialView?: { phi: number; theta: number; r: number } | null;
  /** Émis quand l'utilisateur relâche une orbite/zoom → le parent persiste. */
  onViewChange?: (v: { phi: number; theta: number; r: number }) => void;
  /** Géoréf de la vue satellite gelée à restaurer (re-fetch du même fond). */
  initialGeoRef?: any | null;
  /** Émis quand l'utilisateur gèle une vue → le parent persiste le géoréf. */
  onGeoRefChange?: (g: any) => void;
}

type SaveStatus = "idle" | "dirty" | "saved";
// Brouillon : tampon en mémoire + flush débouncé vers Supabase. Pas de
// localStorage (write sync coûteux sur gros payloads).
const AUTOSAVE_MS = 5000;
const VALIDATE_COOLDOWN_MS = 600;

// Single-overlay guard (dev observability + safety). The wizard already gates a
// single instance; this catches accidental double-mounts.
let OVERLAY_OPEN = false;

// Module-level scroll-lock counter: robust against orphan locks / theoretical
// double mounts (only the first lock captures, only the last restores).
let scrollLockCount = 0;
let savedBodyStyle: { overflow: string; overscroll: string } | null = null;
function lockScroll() {
  const b = document.body;
  if (scrollLockCount === 0) { savedBodyStyle = { overflow: b.style.overflow, overscroll: b.style.overscrollBehavior }; b.style.overflow = "hidden"; b.style.overscrollBehavior = "none"; }
  scrollLockCount++;
}
function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0 && savedBodyStyle) { const b = document.body; b.style.overflow = savedBodyStyle.overflow; b.style.overscrollBehavior = savedBodyStyle.overscroll; savedBodyStyle = null; }
}

// Cheap structural signature to skip redundant derive/saves (big-roof friendly).
function modelSig(m: any): string {
  try {
    return JSON.stringify({
      s: ((m && m.sections) || []).map((x: any) => [x.pts, x.pitch, x.elev, x.hf, x.roof_type]),
      a: (m && m.accessories) || null,
      g: (m && m.georef) || null,
      c: m && m.calibration ? m.calibration.gsd : null,
      n: (m && m.name) || null,
    });
  } catch { return "sig_" + Math.random(); }
}
function isCalibrated(m: any): boolean { return !!(m && m.calibration && m.calibration.gsd > 0); }
function runIdle(cb: () => void): void {
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === "function") ric(cb, { timeout: 1000 }); else setTimeout(cb, 0);
}

const TakeoffFullscreen: React.FC<TakeoffFullscreenProps> = ({ initialModel, backgroundImage, draftId: _draftId, mapSeed, initialDraft, onAutosaveDraft, onApplyPatch, onClose, initialView, onViewChange, initialGeoRef, onGeoRefChange }) => {
  void _draftId; // conservé dans l'API mais le keying est désormais côté parent (loadedId)
  const onAutosaveDraftRef = useRef(onAutosaveDraft);
  onAutosaveDraftRef.current = onAutosaveDraft;
  const [warning, setWarning] = useState<string | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [calibrated, setCalibrated] = useState(true); // assume ok until a model says otherwise

  const [entered, setEntered] = useState(false);    // light fade-in transition

  const closeRef = useRef(onClose); closeRef.current = onClose;
  const studioApi = useRef<{ validate: () => void } | null>(null);
  const lastModel = useRef<any>(null);
  const lastSavedSig = useRef<string>("");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValidateAt = useRef(0);
  const closed = useRef(false);                       // double-close guard
  const validatedOnce = useRef(false);                // for the abandon metric
  const prevFocus = useRef<Element | null>(null);     // focus restoration
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const wasUncalibrated = useRef(false);

  // Le brouillon Supabase l'emporte (édits non-validés cross-device) ;
  // initialModel (roof3d_model validé) sert de fallback.
  const draftModel = (initialDraft && initialDraft.geometry && initialDraft.geometry.snapshot && initialDraft.geometry.snapshot.roofModel) || undefined;
  const seedModel = useRef<any>(draftModel || initialModel);
  const seededFromDraft = useRef<boolean>(!!draftModel);

  // ── pure-ish handlers (defined before the effects that reference them) ──
  const persistIfDirty = useCallback(() => {
    if (!lastModel.current) return;
    const sig = modelSig(lastModel.current);
    if (sig === lastSavedSig.current) return;       // dirty guard: nothing new
    try {
      const stop = ux.time("derive_autosave");
      const { takeoff } = buildTakeoffFromStudio(lastModel.current);
      stop();
      // Délègue la persistance au parent (Supabase). Pas de localStorage.
      try { void onAutosaveDraftRef.current?.(takeoff); } catch { /* ignore */ }
      lastSavedSig.current = sig; setSaveStatus("saved"); ux.count("autosave");
    } catch { /* never block on a draft save */ }
  }, []);

  const handleReadyApi = useCallback((api: { validate: () => void }) => { studioApi.current = api; setApiReady(true); ux.event("studio_ready"); }, []);

  const handleModelChange = useCallback((model: any) => {
    lastModel.current = model;
    const cal = isCalibrated(model);
    setCalibrated(cal);
    if (!cal && !wasUncalibrated.current) { wasUncalibrated.current = true; ux.event("calibration_missing"); }
    const sig = modelSig(model);
    if (sig === lastSavedSig.current) return;        // unchanged → no dirty, no derive
    setSaveStatus("dirty");
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => runIdle(persistIfDirty), AUTOSAVE_MS);
  }, [persistIfDirty]);

  const handleStudioValidate = useCallback((emitted: any) => {
    const stop = ux.time("validate");
    const { takeoff, validation, patch } = buildTakeoffFromStudio(emitted);
    lastSavedSig.current = modelSig(emitted);
    setSaveStatus("saved");
    // Persiste le modèle EXACT du studio (ce que l'utilisateur a validé), pas la
    // reconstruction roof-core : ainsi la ré-édition ré-ouvre fidèlement et
    // l'aperçu affiche le même modèle. Fallback sur la reconstruction si absent.
    (patch as any).roof3dModel = emitted ?? takeoff.geometry?.snapshot?.roofModel ?? null;
    onApplyPatch(patch);
    if (isBlocking(validation)) {
      // Bloquant : on garde le brouillon pour récupération.
      try { void onAutosaveDraftRef.current?.(takeoff); } catch { /* ignore */ }
      const msg = validation.issues.filter((i) => i.level === "error").map((i) => i.message).join(" · ");
      setWarning(msg || "Takeoff incomplet — gèle une carte pour l'échelle, puis retrace les pans.");
      ux.event("validate_blocked", validation.issues.map((i) => i.code));
      stop();
      return;
    }
    setWarning(null);
    validatedOnce.current = true;
    // Validation OK : on efface le brouillon (le modèle canonique va dans roof3d_model).
    try { void onAutosaveDraftRef.current?.(null); } catch { /* ignore */ }
    ux.event("validate_ok"); stop();
    closeRef.current();
  }, [onApplyPatch]);

  const triggerValidate = useCallback(() => {
    if (!studioApi.current) return;
    const now = Date.now();
    if (now - lastValidateAt.current < VALIDATE_COOLDOWN_MS) { ux.event("validate_double_tap_ignored"); return; }   // double-tap guard
    lastValidateAt.current = now;
    studioApi.current.validate();
  }, []);

  // Save-on-close: persist any dirty edits (recoverable draft), then close once.
  const requestClose = useCallback(() => {
    if (closed.current) return;                      // double-close guard
    closed.current = true;
    persistIfDirty();
    closeRef.current();
  }, [persistIfDirty]);
  const requestCloseRef = useRef(requestClose); requestCloseRef.current = requestClose;

  // ── lifecycle effects ──
  useEffect(() => { if (seededFromDraft.current) { setSaveStatus("saved"); ux.count("draft_restore"); } }, []);

  // Mount/open: fade-in, focus into the dialog, open metric + multi-open guard.
  useEffect(() => {
    const openStop = ux.time("overlay_lifetime");
    if (OVERLAY_OPEN) ux.event("multi_open_detected");
    OVERLAY_OPEN = true;
    ux.event("overlay_open", { seededFromDraft: seededFromDraft.current });
    prevFocus.current = (typeof document !== "undefined" ? document.activeElement : null);
    const raf = requestAnimationFrame(() => { setEntered(true); if (dialogRef.current) try { dialogRef.current.focus(); } catch { /* ignore */ } });
    return () => {
      cancelAnimationFrame(raf);
      OVERLAY_OPEN = false;
      if (!validatedOnce.current) ux.event("overlay_abandon");
      openStop();
      // Restore focus to the element that opened the overlay.
      const el = prevFocus.current as HTMLElement | null;
      if (el && typeof el.focus === "function") try { el.focus(); } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => { lockScroll(); return () => unlockScroll(); }, []);

  // Back-button: push one entry, close ONLY the overlay on pop; pop our entry on
  // a button-close so back never over-navigates the submission.
  useEffect(() => {
    const onPop = () => requestCloseRef.current();
    try { window.history.pushState({ __takeoff: true }, ""); } catch { /* ignore */ }
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      try { if (window.history.state && (window.history.state as any).__takeoff) window.history.back(); } catch { /* ignore */ }
    };
  }, []);

  // Flush pending autosave on unmount (never lose in-flight edits).
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    persistIfDirty();
  }, [persistIfDirty]);

  // Flush sur visibilitychange (onglet caché) + beforeunload (fermeture) — sans
  // localStorage, c'est notre seule barrière contre la perte d'édits in-flight.
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") persistIfDirty(); };
    const onBeforeUnload = () => { persistIfDirty(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onBeforeUnload);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onBeforeUnload);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [persistIfDirty]);

  const statusLabel = saveStatus === "saved" ? "Brouillon enregistré"
    : saveStatus === "dirty" ? "Enregistrement…" : "";
  // En-tête compact par défaut (proche du Traceur 3D autonome) ; la bannière
  // d'aide « Échelle non définie… » reste visible. Le bouton permet d'agrandir.
  const [chromeMin, setChromeMin] = useState(true);
  const bigBtn: React.CSSProperties = chromeMin
    ? { minHeight: 34, padding: "6px 12px", borderRadius: 8, fontFamily: "monospace", fontSize: 13, fontWeight: "bold", cursor: "pointer", touchAction: "manipulation" }
    : { minHeight: 48, padding: "10px 18px", borderRadius: 8, fontFamily: "monospace", fontSize: 15, fontWeight: "bold", cursor: "pointer", touchAction: "manipulation" };
  const toggleBtn: React.CSSProperties = { minHeight: chromeMin ? 34 : 40, padding: "6px 10px", borderRadius: 8, border: "1px solid #3a3f66", background: "transparent", color: "#9aa3c8", fontFamily: "monospace", fontSize: 12, cursor: "pointer", touchAction: "manipulation", flexShrink: 0 };

  return (
    <div
      ref={dialogRef} tabIndex={-1}
      role="dialog" aria-modal="true" aria-label="Tracer le toit"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, height: "100dvh", zIndex: 11000,
        background: "#060610", display: "flex", flexDirection: "column", touchAction: "none",
        paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)",
        outline: "none",
        opacity: entered ? 1 : 0, transition: "opacity 140ms ease-out",
      }}
    >
      <header style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
        padding: chromeMin ? "4px 10px" : "8px 12px", background: "#0a0a1e", borderBottom: "1px solid #1e2240",
        color: "#cdd8f5", fontFamily: "monospace", fontSize: 13, flexWrap: chromeMin ? "nowrap" : "wrap",
      }}>
        <span style={{ color: "#aa88ff", fontWeight: "bold", fontSize: chromeMin ? 13 : 15, whiteSpace: "nowrap" }}>Takeoff</span>
        {!chromeMin && statusLabel && <span style={{ color: saveStatus === "saved" ? "#66cc88" : "#ffb454", fontSize: 12 }}>{statusLabel}</span>}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setChromeMin(v => !v)}
          title={chromeMin ? "Afficher les outils" : "Réduire les outils pour agrandir la carte"}
          style={toggleBtn}
        >{chromeMin ? "Agrandir outils" : "Réduire outils"}</button>
        <button
          onClick={triggerValidate}
          disabled={!apiReady}
          title={apiReady ? "Valider le takeoff et revenir à la soumission" : "Traceur en cours de chargement…"}
          style={{ ...bigBtn, border: "1px solid #44ff88", background: apiReady ? "#44ff8822" : "#1e2a22", color: apiReady ? "#44ff88" : "#3a5a44", cursor: apiReady ? "pointer" : "not-allowed" }}
        >{chromeMin ? "Valider" : "Valider le takeoff"}</button>
        <button onClick={requestClose} aria-label="Fermer" style={{ ...bigBtn, border: "1px solid #556", background: "transparent", color: "#cdd8f5", fontWeight: "normal" }}>Fermer</button>
      </header>

      {!calibrated && !warning && (
        <div role="status" style={{
          flexShrink: 0, padding: "7px 12px", background: "#2a2210", borderBottom: "1px solid #5a4a1e",
          color: "#ffcf7a", fontFamily: "monospace", fontSize: 12, lineHeight: 1.35,
        }}>Échelle non définie. Ouvre le menu <b>Carte</b> du traceur et « Geler la vue » pour mesurer en pi². Sans échelle, la validation reste bloquée.</div>
      )}

      {warning && (
        <div role="alert" style={{
          flexShrink: 0, padding: "9px 12px", background: "#3a1320", borderBottom: "1px solid #66263a",
          color: "#ffb4c4", fontFamily: "monospace", fontSize: 12.5, lineHeight: 1.4,
        }}>{warning}</div>
      )}

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <Suspense fallback={<div style={{ color: "#8a93a8", fontFamily: "monospace", padding: 24 }}>Chargement du traceur…</div>}>
          <AdminRoofStudio
            mode="review"
            initialModel={seedModel.current}
            backgroundImage={backgroundImage}
            mapSeed={mapSeed}
            onValidate={handleStudioValidate}
            onClose={requestClose}
            onReadyApi={handleReadyApi}
            onModelChange={handleModelChange}
            initialView={initialView}
            onViewChange={onViewChange}
            initialGeoRef={initialGeoRef}
            onGeoRefChange={onGeoRefChange}
          />
        </Suspense>
      </div>
    </div>
  );
};

export default TakeoffFullscreen;
