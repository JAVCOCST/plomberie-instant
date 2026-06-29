import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { render3D, buildView, hitFaceDetailed } from '@/lib/roof-core/engine';

interface ToolLite {
  id: string;
  name: string;
  color: string;
  unit: string;
  visible?: boolean;
  rawValue?: string;
  correctedValue?: string;
}

interface Props {
  /** roof-core RoofModel persisté avec la soumission (dynasty_breakdown.roof3d_model). */
  model: any | null;
  /** Outils de mesure de la soumission, pour la légende avec valeurs réelles. */
  tools?: ToolLite[];
  /** Surface + pente (depuis roof3dMeasures ou les overrides de la soumission). */
  summary?: { pitchX12?: number | null; areaSqft?: number | null } | null;
  /** Mesures 3D complètes (longueurs par type) — affichées directement dans le
   *  panneau Mesures, indépendamment de la config des outils. */
  measures?: { ridgeFt?: number; hipFt?: number; valleyFt?: number; eaveFt?: number; membraneFt?: number; maximumCount?: number } | null;
  /** Si fourni, affiche un bouton « Éditer le 3D » par-dessus le viewer qui
   *  ouvre le traceur fullscreen. */
  onEdit?: () => void;
  /** Si fourni, active le mode « ↕ Z » : un bouton apparaît, et en mode actif
   *  le drag sur une face change l'élévation de la section correspondante.
   *  Appelé UNE seule fois à la fin du drag avec le tableau de sections muté
   *  (les `elev` ont été modifiés). Le parent en fait ce qu'il veut (typiquement
   *  re-wrap dans roof3d_model et déclencher l'autosave). */
  onSecsChange?: (sections: any[]) => void;
  /** Hauteur fixe (px) ou "fill" pour prendre toute la place dispo dans un
   *  parent flex-column (aligne le bas du viewer sur le bas de la colonne). */
  height?: number | 'fill';
}

// Aperçu 3D non interactif-destructif du modèle validé, affiché À MÊME la
// soumission (section Take-off, EN BAS). Réutilise le moteur render3D : les
// sections du RoofModel suffisent (render3D recalcule le squelette à partir
// des points), avec une caméra orbitale et un cache locaux à ce composant.
const RoofModelViewer: React.FC<Props> = ({ model, tools, summary, measures, onEdit, onSecsChange, height = 300 }) => {
  const isFill = height === 'fill';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const orbRef = useRef<any>({ phi: 1.1, theta: 0.8, r: 14, down: false, lx: 0, ly: 0 });
  const hCacheRef = useRef<any[]>([]);
  const rafRef = useRef<any>(null);

  const sections = useMemo(
    () => (model?.sections || []).map((s: any) => ({ ...s, closed: true })),
    [model],
  );
  const secsRef = useRef(sections);
  secsRef.current = sections;

  const hasModel = sections.some((s: any) => Array.isArray(s.pts) && s.pts.length >= 3);

  // Rendu À LA DEMANDE plutôt qu'un rAF continu (qui maintenait le CPU à
  // ~60 fps en permanence et cassait la fluidité du scroll mobile). On
  // schedule un seul rAF quand quelque chose change ; entre deux drags ou
  // mises à jour de modèle, zéro travail dans la boucle d'animation.
  const drawOne = useCallback(() => {
    rafRef.current = null;
    const c = canvasRef.current; if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    if (w <= 0 || h <= 0) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const noSel = { sec: -1, edge: -1 };
    render3D(ctx, w, h, secsRef.current, noSel, orbRef.current, hCacheRef, false, [], -1, null, null, undefined, []);
  }, []);
  const requestRender = useCallback(() => {
    if (rafRef.current != null) return;       // un seul frame en file
    rafRef.current = requestAnimationFrame(drawOne);
  }, [drawOne]);

  // Premier rendu + à chaque changement de sections (ex. validation 3D).
  useEffect(() => {
    requestRender();
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [sections, requestRender]);

  // Redraw quand le conteneur change de taille (resize fenêtre, ouverture
  // d'une autre section, etc.) — sinon le canvas resterait gelé sur l'ancien
  // viewport.
  useEffect(() => {
    const c = canvasRef.current; if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => requestRender());
    ro.observe(c);
    return () => ro.disconnect();
  }, [requestRender]);

  // Mode édition Z : porté du tracer (zdrag3). Quand actif, un tap sur une
  // face attrape la section et un drag vertical change son `elev` jusqu'au
  // relâchement, qui propage les sections mutées au parent (autosave).
  const [editZ, setEditZ] = useState(false);
  const editZRef = useRef(false); editZRef.current = editZ;
  const zDragRef = useRef<{ active: boolean; si: number; startElev: number; startY: number } | null>(null);
  const [zInfo, setZInfo] = useState<string | null>(null);
  const onSecsChangeRef = useRef(onSecsChange); onSecsChangeRef.current = onSecsChange;

  // Coords canvas-locales pour le hit-test (indépendantes du scroll/offset).
  const localXY = (clientX: number, clientY: number) => {
    const c = canvasRef.current; if (!c) return { sx: 0, sy: 0 };
    const r = c.getBoundingClientRect();
    return { sx: clientX - r.left, sy: clientY - r.top };
  };

  const down = (x: number, y: number) => {
    // En mode Z + callback dispo : tente d'attraper une face. Sinon → orbite.
    if (editZRef.current && onSecsChangeRef.current) {
      const c = canvasRef.current;
      const { sx, sy } = localXY(x, y);
      if (c) {
        const vw = buildView(orbRef.current.phi, orbRef.current.theta, orbRef.current.r);
        const hf = hitFaceDetailed(sx, sy, secsRef.current, vw, 50 * Math.PI / 180, c.clientWidth, c.clientHeight);
        if (hf) {
          const sec = secsRef.current[hf.si];
          zDragRef.current = { active: true, si: hf.si, startElev: sec?.elev || 0, startY: y };
          setZInfo("Z " + Math.round(sec?.elev || 0));
          return;
        }
      }
    }
    const o = orbRef.current; o.down = true; o.lx = x; o.ly = y;
  };
  const move = (x: number, y: number) => {
    const zd = zDragRef.current;
    if (zd && zd.active) {
      // Même facteur k=2 que le tracer (zdrag3 line 624) — 1 px curseur = 2 unités Z.
      const newElev = Math.max(-4000, Math.min(4000, zd.startElev - (y - zd.startY) * 2));
      const sec = secsRef.current[zd.si];
      // Mutation directe : render3D lit depuis secsRef.current. Pas de setState
      // ici sinon le useMemo (alimenté par le prop `model`) écraserait la mutation
      // au render suivant. Le commit React-friendly arrive sur drag-end.
      if (sec) sec.elev = newElev;
      const d = newElev - zd.startElev;
      setZInfo("Z " + Math.round(newElev) + "   (" + (d >= 0 ? "+" : "") + Math.round(d) + ")");
      requestRender();
      return;
    }
    const o = orbRef.current;
    if (!o.down) return;
    o.theta -= (x - o.lx) * 0.01;
    o.phi = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, o.phi - (y - o.ly) * 0.01));
    o.lx = x; o.ly = y;
    requestRender();
  };
  const up = () => {
    const zd = zDragRef.current;
    if (zd && zd.active) {
      zDragRef.current = null;
      setZInfo(null);
      // Une seule notif parent — il met à jour roof3d_model, l'autosave suit.
      onSecsChangeRef.current?.(secsRef.current);
      return;
    }
    orbRef.current.down = false;
  };
  const zoom = (delta: number) => {
    const o = orbRef.current;
    o.r = Math.max(4, Math.min(80, o.r + (delta > 0 ? 1.5 : -1.5)));
    requestRender();
  };

  return (
    <div style={{
      position: 'relative', width: '100%',
      flex: isFill ? 1 : undefined,
      minHeight: isFill ? 280 : undefined,
      height: isFill ? undefined : height,
      borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: '#060610', marginTop: 12,
    }}>
      <canvas
        ref={canvasRef}
        onMouseDown={e => down(e.clientX, e.clientY)}
        onMouseMove={e => move(e.clientX, e.clientY)}
        onMouseUp={up}
        onMouseLeave={up}
        onWheel={e => zoom(e.deltaY)}
        onTouchStart={e => { const t = e.touches[0]; if (t) down(t.clientX, t.clientY); }}
        onTouchMove={e => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }}
        onTouchEnd={up}
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: editZ ? 'ns-resize' : 'grab' }}
      />

      {/* Bouton « Éditer le 3D » — par-dessus le viewer, ouvre le traceur. */}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          title="Ouvrir le traceur 3D pour éditer le modèle"
          style={{
            position: 'absolute', left: 10, top: 8, zIndex: 5,
            padding: '7px 14px', borderRadius: 8,
            background: 'rgba(120,90,255,0.92)', border: '1px solid #aa88ff',
            color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(80,40,200,0.35)', touchAction: 'manipulation',
          }}
        >
          ✎ Éditer le 3D
        </button>
      )}

      {/* Mode édition Z — affiché uniquement si le parent fournit un setter. */}
      {onSecsChange && (
        <button
          type="button"
          onClick={() => setEditZ(v => !v)}
          title={editZ ? 'Sortir du mode édition d\'élévation' : 'Glisser une face verticalement pour ajuster son élévation'}
          style={{
            position: 'absolute', left: onEdit ? 138 : 10, top: 8, zIndex: 5,
            padding: '7px 12px', borderRadius: 8,
            background: editZ ? 'rgba(255,170,68,0.95)' : 'rgba(20,24,40,0.85)',
            border: '1px solid ' + (editZ ? '#ffaa44' : '#3a4a70'),
            color: editZ ? '#1a1100' : '#ffaa44', fontWeight: 800, fontSize: 12, cursor: 'pointer',
            boxShadow: editZ ? '0 4px 14px rgba(255,170,68,0.35)' : 'none', touchAction: 'manipulation',
          }}
        >
          ↕ Z {editZ ? 'actif' : ''}
        </button>
      )}

      {/* Badge live pendant le drag — au centre-haut. */}
      {zInfo && (
        <div style={{
          position: 'absolute', left: '50%', top: 12, transform: 'translateX(-50%)', zIndex: 5,
          padding: '6px 12px', borderRadius: 8,
          background: 'rgba(255,170,68,0.95)', color: '#1a1100',
          fontFamily: 'monospace', fontSize: 12, fontWeight: 800,
          boxShadow: '0 4px 14px rgba(255,170,68,0.35)', pointerEvents: 'none',
        }}>{zInfo}</div>
      )}

      {/* Hint déplacé en BAS-GAUCHE pour laisser la place au bouton Éditer. */}
      <div style={{ position: 'absolute', left: 10, bottom: 8, fontFamily: 'monospace', fontSize: 11, color: '#8a93b8', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#44ddaa' }} />Modèle 3D · glisser pour pivoter
      </div>

      {/* Panneau « Mesures » — légende des outils avec valeurs réelles. */}
      <div style={{
        position: 'absolute', right: 10, top: 8, maxWidth: 'min(60%, 240px)', maxHeight: `calc(100% - 16px)`,
        overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        background: 'rgba(10,10,22,0.78)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8, padding: '8px 10px', fontFamily: 'monospace', fontSize: 11,
        color: '#c7d2fe', pointerEvents: 'auto',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Mesures</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
          <span style={{ color: '#9aa3c8', fontSize: 10 }}>Surface toiture</span>
          <span style={{ color: '#f4f4f5', fontSize: 12, fontWeight: 700 }}>
            {summary?.pitchX12 ? `${summary.pitchX12}/12` : null}
            {summary?.pitchX12 && summary?.areaSqft ? ' · ' : ''}
            {summary?.areaSqft ? `${Math.round(summary.areaSqft).toLocaleString('fr-CA')} pi²` : (!summary?.pitchX12 ? '—' : '')}
          </span>
        </div>
        {measures && (() => {
          const ft = (v?: number) => (v && v > 0 ? `${Math.round(v).toLocaleString('fr-CA')} pi` : null);
          const rows: [string, string][] = [];
          const add = (label: string, v: string | null) => { if (v) rows.push([label, v]); };
          add('Faîtière', ft(measures.ridgeFt));
          add('Arête', ft(measures.hipFt));
          add('Noue', ft(measures.valleyFt));
          add('Avant-toit / débord', ft(measures.eaveFt));
          add('Membrane autocoll.', ft(measures.membraneFt));
          if (measures.maximumCount && measures.maximumCount > 0) add('Maximum', String(measures.maximumCount));
          if (!rows.length) return null;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6, marginBottom: 6 }}>
              {rows.map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: '#9aa3c8', fontSize: 10 }}>{label}</span>
                  <span style={{ color: '#34d399', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{val}</span>
                </div>
              ))}
            </div>
          );
        })()}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
          {(tools || []).filter(t => t.visible !== false).length === 0 && (
            <div style={{ color: '#4a5278', fontSize: 10 }}>Aucun outil visible.</div>
          )}
          {(tools || []).filter(t => t.visible !== false).map(t => {
            const v = (t.correctedValue || t.rawValue || '').toString().trim();
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 16 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, color: '#e0e0ec', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                <span style={{ color: v ? '#34d399' : '#4a5278', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{v ? `${v} ${t.unit}` : '—'}</span>
              </div>
            );
          })}
        </div>
      </div>

      {!hasModel && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5278', fontFamily: 'monospace', fontSize: 12, pointerEvents: 'none', textAlign: 'center', padding: 16 }}>
          Trace le toit en 3D pour afficher le modèle ici.
        </div>
      )}
    </div>
  );
};

export default RoofModelViewer;
