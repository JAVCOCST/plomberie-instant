import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Eye, EyeOff, Pencil, Layers, Move, Maximize2,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, RotateCw,
  RefreshCcw, ZoomIn, ZoomOut, Pin, PinOff, GripVertical, Sparkles, Trash2,
} from 'lucide-react';

/**
 * MapToolboxControls — API exposée par BuildingReadOnlyMap pour piloter
 * tous ses calques et le fond de carte depuis un panneau externe.
 */
export interface MapToolboxControls {
  // Couches
  hasLot: boolean;
  showLot: boolean;
  toggleLot: () => void;
  isEditingLot: boolean;
  toggleLotEdit: () => void;
  showBuilding: boolean;
  toggleBuilding: () => void;
  isEditingBuilding: boolean;
  toggleBuildingEdit: () => void;
  // Mesures sauvegardées
  annotations: { target: string; feet: number; visible: boolean; color: string; label: string }[];
  toggleAnnotation: (index: number) => void;
  // Calques d'image carte (indépendants — peuvent être activés ensemble ou séparément).
  showGoogleSatellite: boolean;
  toggleGoogleSatellite: () => void;
  showOrthoQC: boolean;
  toggleOrthoQC: () => void;
  // Zoom carte
  zoomIn: () => void;
  zoomOut: () => void;
  // Calques vectoriels extra (skeleton, etc.) — injectés via props parent.
  extraLayers?: { id: string; label: string; color: string; visible: boolean }[];
  toggleExtraLayer?: (id: string) => void;
}

import type { AdjustControls } from './BuildingReadOnlyMap';

interface MapToolboxProps {
  mapControls: MapToolboxControls | null;
  adjustControls: AdjustControls | null;
  /** Clé localStorage pour mémoriser l'état (position, taille, ancré) */
  storageKey?: string;
  /** Mode navigation libre (drag/zoom) sur la carte */
  navigateMode?: boolean;
  onToggleNavigate?: () => void;
  /** Calques image IA gérés par le parent (capture / améliorée / polygone). */
  aiOverlays?: { id: string; label: string; visible: boolean; kind: 'capture' | 'enhanced' | 'polygon' }[];
  onToggleAiOverlay?: (id: string) => void;
  onRemoveAiOverlay?: (id: string) => void;
  /** Contenu inline à placer en bas du panneau (ex. RoofPolygonAIInline). */
  aiInlineContent?: React.ReactNode;
}

interface PersistedState {
  docked: boolean;
  // Position quand flottant (px depuis viewport)
  x: number;
  y: number;
  // Taille (px)
  width: number;
  height: number;
  collapsed: boolean;
}

const DEFAULT_STATE: PersistedState = {
  docked: true,
  x: 24,
  y: 120,
  width: 280,
  height: 520,
  collapsed: false,
};

const loadState = (key: string): PersistedState => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STATE;
  }
};

const saveState = (key: string, st: PersistedState) => {
  try { localStorage.setItem(key, JSON.stringify(st)); } catch { /* ignore */ }
};

const MapToolbox: React.FC<MapToolboxProps> = ({
  mapControls,
  adjustControls,
  storageKey = 'maptoolbox-v1',
  navigateMode = false,
  onToggleNavigate,
  aiOverlays,
  onToggleAiOverlay,
  onRemoveAiOverlay,
  aiInlineContent,
}) => {
  const [state, setState] = useState<PersistedState>(() => loadState(storageKey));
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; saveState(storageKey, state); }, [state, storageKey]);

  // ── Drag handling (flottant uniquement) ──────────────────────────────
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const onDragStart = (e: React.MouseEvent) => {
    if (state.docked) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: state.x, baseY: state.y };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  };
  const onDragMove = (e: MouseEvent) => {
    const d = dragRef.current; if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const w = stateRef.current.width;
    const h = stateRef.current.height;
    const newX = Math.max(0, Math.min(window.innerWidth - 80, d.baseX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 40, d.baseY + dy));
    setState(s => ({ ...s, x: newX, y: newY }));
  };
  const onDragEnd = () => {
    dragRef.current = null;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  };

  // ── Resize handling ───────────────────────────────────────────────────
  const resizeRef = useRef<{ startX: number; startY: number; baseW: number; baseH: number } | null>(null);
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, baseW: state.width, baseH: state.height };
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', onResizeEnd);
  };
  const onResizeMove = (e: MouseEvent) => {
    const r = resizeRef.current; if (!r) return;
    const newW = Math.max(220, Math.min(600, r.baseW + (e.clientX - r.startX)));
    const newH = Math.max(180, Math.min(window.innerHeight - 80, r.baseH + (e.clientY - r.startY)));
    setState(s => ({ ...s, width: newW, height: newH }));
  };
  const onResizeEnd = () => {
    resizeRef.current = null;
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', onResizeEnd);
  };

  const toggleDock = useCallback(() => setState(s => ({ ...s, docked: !s.docked })), []);
  const toggleCollapse = useCallback(() => setState(s => ({ ...s, collapsed: !s.collapsed })), []);

  // ── Style du conteneur ────────────────────────────────────────────────
  const containerStyle: React.CSSProperties = state.docked
    ? {
        position: 'relative',
        width: '100%',
        marginTop: 12,
      }
    : {
        position: 'fixed',
        top: state.y,
        left: state.x,
        width: state.width,
        zIndex: 100,
      };

  const innerStyle: React.CSSProperties = {
    background: 'rgba(15,23,42,0.95)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    boxShadow: state.docked ? 'none' : '0 12px 32px rgba(0,0,0,0.5)',
    color: '#e5e7eb',
    overflow: 'hidden',
    height: state.collapsed ? 'auto' : (state.docked ? 'auto' : state.height),
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  };

  if (!mapControls && !adjustControls) return null;

  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        {/* ── Header (drag handle + actions) ──────────────────────────── */}
        <div
          onMouseDown={onDragStart}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 10px',
            background: 'rgba(99,102,241,0.12)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            cursor: state.docked ? 'default' : 'move',
            userSelect: 'none',
            flexShrink: 0,
          }}
        >
          {!state.docked && <GripVertical size={12} color="#6b7280" />}
          <Layers size={13} color="#a5b4fc" />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#c7d2fe', letterSpacing: 0.3, flex: 1 }}>
            Boîte à outils carte
          </span>
          {onToggleNavigate && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleNavigate(); }}
              onMouseDown={(e) => e.stopPropagation()}
              title={navigateMode ? 'Terminer le déplacement' : 'Déplacer la carte'}
              style={{
                display: 'flex', alignItems: 'center', gap: 3,
                padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
                fontSize: 9, fontWeight: 700,
                background: navigateMode ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${navigateMode ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.12)'}`,
                color: navigateMode ? '#a5b4fc' : '#cbd5e1',
              }}
            >
              <Move size={11} />
              {navigateMode ? 'Fin' : 'Déplacer'}
            </button>
          )}
          <button
            type="button"
            onClick={toggleCollapse}
            title={state.collapsed ? 'Déplier' : 'Replier'}
            style={iconBtn()}
          >
            {state.collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <button
            type="button"
            onClick={toggleDock}
            title={state.docked ? 'Détacher (flottant)' : 'Ancrer à gauche'}
            style={iconBtn(state.docked ? '#a5b4fc' : '#fbbf24')}
          >
            {state.docked ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        {!state.collapsed && (
          <div style={{
            padding: 10, display: 'flex', flexDirection: 'column', gap: 12,
            overflow: 'auto', flex: 1, minHeight: 0,
          }}>
            {/* Zoom carte */}
            {mapControls && (
              <Section icon={<Maximize2 size={11} />} title="Zoom carte">
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" onClick={mapControls.zoomOut} style={zoomBtn()} title="Réduire">
                    <ZoomOut size={14} />
                  </button>
                  <button type="button" onClick={mapControls.zoomIn} style={zoomBtn()} title="Agrandir">
                    <ZoomIn size={14} />
                  </button>
                </div>
              </Section>
            )}

            {/* Couches */}
            {mapControls && (
              <Section icon={<Layers size={11} />} title="Couches">
                {/* Calques d'image carte (fond) — listés en premier, devant
                    les calques vectoriels (lot, bâtiment). */}
                <BasemapLayerRow
                  visible={mapControls.showGoogleSatellite}
                  onToggle={mapControls.toggleGoogleSatellite}
                  color="#fbbf24"
                  label="Satellite Google"
                />
                <BasemapLayerRow
                  visible={mapControls.showOrthoQC}
                  onToggle={mapControls.toggleOrthoQC}
                  color="#34d399"
                  label="Orthophoto QC"
                />
                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
                {mapControls.hasLot && (
                  <LayerRow
                    visible={mapControls.showLot}
                    onToggleVisible={mapControls.toggleLot}
                    color="#60a5fa"
                    label="Périmètre de lot"
                    isEditing={mapControls.isEditingLot}
                    onToggleEdit={mapControls.toggleLotEdit}
                    editColor="#3b82f6"
                  />
                )}
                <LayerRow
                  visible={mapControls.showBuilding}
                  onToggleVisible={mapControls.toggleBuilding}
                  color="#f59e0b"
                  label="Polygone bâtiment"
                  isEditing={mapControls.isEditingBuilding}
                  onToggleEdit={mapControls.toggleBuildingEdit}
                  editColor="#f59e0b"
                />
                {mapControls.annotations.length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 }}>
                      Mesures
                    </div>
                    {mapControls.annotations.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => mapControls.toggleAnnotation(i)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
                          background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', width: '100%',
                        }}
                      >
                        {a.visible
                          ? <Eye size={12} color={a.color} />
                          : <EyeOff size={12} color="#6b7280" />}
                        <div style={{ width: 14, height: 3, borderRadius: 2, background: a.color, opacity: a.visible ? 1 : 0.3 }} />
                        <span style={{ fontSize: 10, color: a.visible ? '#e5e7eb' : '#6b7280', fontWeight: 600, flex: 1, textAlign: 'left' }}>
                          {a.label} — {a.feet} pi
                        </span>
                      </button>
                    ))}
                  </>
                )}
                {mapControls.extraLayers && mapControls.extraLayers.length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 }}>
                      Calques extra
                    </div>
                    {mapControls.extraLayers.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => mapControls.toggleExtraLayer?.(l.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
                          background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', width: '100%',
                        }}
                      >
                        {l.visible
                          ? <Eye size={12} color={l.color} />
                          : <EyeOff size={12} color="#6b7280" />}
                        <div style={{ width: 14, height: 3, borderRadius: 2, background: l.color, opacity: l.visible ? 1 : 0.3 }} />
                        <span style={{ fontSize: 10, color: l.visible ? '#e5e7eb' : '#6b7280', fontWeight: 600, flex: 1, textAlign: 'left' }}>
                          {l.label}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </Section>
            )}

            {/* Calques IA (overlays géoréférencés) */}
            {aiOverlays && aiOverlays.length > 0 && (
              <Section icon={<Sparkles size={11} />} title="Calques IA">
                {aiOverlays.map(o => {
                  const color = o.kind === 'capture' ? '#60a5fa'
                    : o.kind === 'enhanced' ? '#a78bfa'
                    : '#22c55e';
                  return (
                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <button type="button" onClick={() => onToggleAiOverlay?.(o.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1,
                          background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0' }}>
                        {o.visible ? <Eye size={12} color={color} /> : <EyeOff size={12} color="#6b7280" />}
                        <div style={{ width: 14, height: 10, borderRadius: 2, background: color,
                          opacity: o.visible ? 0.9 : 0.25, border: '1px solid rgba(255,255,255,0.15)' }} />
                        <span style={{ fontSize: 10, color: o.visible ? '#e5e7eb' : '#6b7280', fontWeight: 600, textAlign: 'left' }}>
                          {o.label}
                        </span>
                      </button>
                      {onRemoveAiOverlay && (
                        <button type="button" onClick={() => onRemoveAiOverlay(o.id)}
                          title="Supprimer ce calque"
                          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 4, padding: 3, cursor: 'pointer', color: '#fca5a5',
                            display: 'flex', alignItems: 'center' }}>
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </Section>
            )}

            {/* Pipeline IA inline */}
            {aiInlineContent && (
              <Section icon={<Sparkles size={11} />} title="IA RoofPolygon">
                {aiInlineContent}
              </Section>
            )}

            {/* Ajustement polygone (calibration) */}
            {adjustControls && (
              <Section icon={<Move size={11} />} title="Ajustement polygone">
                {adjustControls.hasLot && (
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    {(['building', 'lot'] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => adjustControls.setTarget(t)}
                        style={{
                          flex: 1, padding: '4px 6px', fontSize: 10, fontWeight: 600,
                          borderRadius: 4, cursor: 'pointer',
                          border: '1px solid ' + (adjustControls.target === t
                            ? (t === 'building' ? '#f59e0b' : '#3b82f6')
                            : 'rgba(255,255,255,0.08)'),
                          background: adjustControls.target === t
                            ? (t === 'building' ? 'rgba(245,158,11,0.18)' : 'rgba(59,130,246,0.18)')
                            : 'rgba(255,255,255,0.04)',
                          color: adjustControls.target === t
                            ? (t === 'building' ? '#fbbf24' : '#60a5fa')
                            : '#9ca3af',
                        }}
                      >
                        {t === 'building' ? 'Bâtiment' : 'Lot'}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button type="button" onClick={adjustControls.rotateCCW} style={padBtn()} title="Rotation antihoraire">
                    <RotateCcw size={14} />
                  </button>
                  <div style={{
                    flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3,
                  }}>
                    <div />
                    <button type="button" onClick={adjustControls.nudgeNorth} style={padBtn()}><ChevronUp size={14} /></button>
                    <div />
                    <button type="button" onClick={adjustControls.nudgeWest} style={padBtn()}><ChevronLeft size={14} /></button>
                    <button type="button" onClick={adjustControls.reset} style={padBtn('#6b7280')} title="Réinitialiser"><RefreshCcw size={12} /></button>
                    <button type="button" onClick={adjustControls.nudgeEast} style={padBtn()}><ChevronRight size={14} /></button>
                    <div />
                    <button type="button" onClick={adjustControls.nudgeSouth} style={padBtn()}><ChevronDown size={14} /></button>
                    <div />
                  </div>
                  <button type="button" onClick={adjustControls.rotateCW} style={padBtn()} title="Rotation horaire">
                    <RotateCw size={14} />
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <button type="button" onClick={adjustControls.zoomOut} style={padBtn()} title="Réduire"><ZoomOut size={12} /></button>
                  <span style={{ flex: 1, textAlign: 'center', color: '#9ca3af', fontSize: 10 }}>
                    {Math.round(adjustControls.scaleFactor * 100)}%
                  </span>
                  <button type="button" onClick={adjustControls.zoomIn} style={padBtn()} title="Agrandir"><ZoomIn size={12} /></button>
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ── Resize handle (flottant uniquement, hors collapse) ──────── */}
        {!state.docked && !state.collapsed && (
          <div
            onMouseDown={onResizeStart}
            title="Redimensionner"
            style={{
              position: 'absolute', right: 0, bottom: 0, width: 14, height: 14,
              cursor: 'nwse-resize',
              background: 'linear-gradient(135deg, transparent 50%, rgba(165,180,252,0.5) 50%)',
              borderBottomRightRadius: 10,
            }}
          />
        )}
      </div>
    </div>
  );
};

/* ── Sub-components ─────────────────────────────────────────────────── */
const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div>
    <div style={{
      fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
      marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4, letterSpacing: 0.5,
    }}>
      {icon}{title}
    </div>
    {children}
  </div>
);

const LayerRow: React.FC<{
  visible: boolean; onToggleVisible: () => void; color: string; label: string;
  isEditing: boolean; onToggleEdit: () => void; editColor: string;
}> = ({ visible, onToggleVisible, color, label, isEditing, onToggleEdit, editColor }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
    <button type="button" onClick={onToggleVisible} style={{
      display: 'flex', alignItems: 'center', gap: 6, flex: 1,
      background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0',
    }}>
      {visible ? <Eye size={12} color={color} /> : <EyeOff size={12} color="#6b7280" />}
      <div style={{ width: 14, height: 3, borderRadius: 2, background: color, opacity: visible ? 1 : 0.3 }} />
      <span style={{ fontSize: 10, color: visible ? '#e5e7eb' : '#6b7280', fontWeight: 600 }}>
        {label}
      </span>
    </button>
    <button
      type="button"
      onClick={onToggleEdit}
      title={isEditing ? "Terminer l'édition" : 'Éditer'}
      style={{
        background: isEditing ? editColor : 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
        cursor: 'pointer', padding: '3px 5px', display: 'flex', alignItems: 'center',
      }}
    >
      <Pencil size={11} color={isEditing ? '#fff' : editColor} />
    </button>
  </div>
);

/** Ligne d'un calque image (fond de carte) — sans bouton d'édition. */
const BasemapLayerRow: React.FC<{
  visible: boolean; onToggle: () => void; color: string; label: string;
}> = ({ visible, onToggle, color, label }) => (
  <button
    type="button"
    onClick={onToggle}
    style={{
      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
      background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0',
      width: '100%',
    }}
  >
    {visible ? <Eye size={12} color={color} /> : <EyeOff size={12} color="#6b7280" />}
    <div style={{
      width: 14, height: 10, borderRadius: 2,
      background: color, opacity: visible ? 0.9 : 0.25,
      border: '1px solid rgba(255,255,255,0.15)',
    }} />
    <span style={{ fontSize: 10, color: visible ? '#e5e7eb' : '#6b7280', fontWeight: 600, textAlign: 'left', flex: 1 }}>
      {label}
    </span>
  </button>
);

const iconBtn = (color = '#9ca3af'): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 4, padding: 3, cursor: 'pointer', color,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});

const zoomBtn = (): React.CSSProperties => ({
  flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer',
  background: 'rgba(255,255,255,0.04)', color: '#d1d5db',
  border: '1px solid rgba(255,255,255,0.1)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});

const padBtn = (color = '#d1d5db'): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 4, padding: '6px', cursor: 'pointer', color,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});

export default MapToolbox;