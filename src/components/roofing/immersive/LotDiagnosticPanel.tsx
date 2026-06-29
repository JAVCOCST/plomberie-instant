import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Hash, Building2, MapPin, Landmark, X,
  CheckCircle2, AlertTriangle, XCircle, Loader2, Circle, Pencil, ExternalLink,
} from 'lucide-react';
import { fetchSatelliteDataUrl, compositeMapWithPolygons } from '@/lib/pdf-generators';
import type { PolygonAdjustments } from '@/components/roofing/immersive/BuildingReadOnlyMap';

/**
 * LotDiagnosticPanel — Vague A2.2
 *
 * Affiche, en tête de la Section 1 du générateur de devis admin :
 *  1. Une ZONE DE SAISIE éditable du numéro de lot, préremplie par la
 *     détection automatique (`find_building_polygon`). L'utilisateur peut la
 *     corriger à la main (ex. après avoir lu le bon lot dans le take off).
 *  2. Un badge de PRÉCISION clair. La détection renvoie `distance_meters` =
 *     distance du point géocodé au polygone de lot. 0 → le point est DANS le
 *     lot (précis). > seuil → on est tombé sur le lot voisin le plus proche
 *     (imprécis) : on le dit explicitement au lieu de « deviner ».
 *  3. Un BOUTON « Pipeline détection » qui CLIGNOTE dès que le polygone + le
 *     lot + les infos sont récupérés, et qui ouvre une FENÊTRE (modale) avec
 *     la carte (empreinte + lot dessinés) et les ÉTAPES du pipeline
 *     (géocodage → bâtiment → lot → données municipales) en montrant où ça
 *     bloque.
 */

export type BuildingPhase = 'idle' | 'loading' | 'found' | 'not_found' | 'manual';

export interface LotDiagnosticPanelProps {
  noLot: string | null;
  onNoLotChange: (v: string) => void;
  lotManual: boolean;
  onLotManualChange: (v: boolean) => void;

  buildingPhase: BuildingPhase;
  /** Distance (m) du point géocodé au polygone de lot. 0 = point dans le lot. */
  lotDistanceM: number | null;

  lat: number | null;
  lng: number | null;
  addressText: string | null;

  buildingGeojson: string | null;
  lotGeojson: string | null;
  mapParams: { zoom: number; centerLat: number; centerLng: number };
  polygonAdj?: PolygonAdjustments | null;

  superficie: number | null;
  perimetre: number | null;
  largeur: number | null;
  profondeur: number | null;

  yearBuilt: number | null;
  dwellingCount: number | null;
  floorCount: number | null;
  mamhDataSource: string | null;
  autofillEnabled: boolean;

  apiKey: string;
  isMobile?: boolean;
  onOpenTakeoff?: () => void;

  /**
   * Bloc « Données municipales & auto-remplissage » (AutofillCoordinator).
   * Rendu DANS la modale du pipeline pour que le bouton MAMH et les infos
   * soient regroupés avec la carte + les étapes. `null` si le flag autofill
   * est OFF.
   */
  mamhSlot?: React.ReactNode;
}

/** Seuil (m) en deçà duquel on considère le point « dans le lot » → lot précis. */
const PRECISE_THRESHOLD_M = 1.0;

type StepStatus = 'ok' | 'warn' | 'fail' | 'loading' | 'pending' | 'off';
type Precision = 'idle' | 'loading' | 'precise' | 'imprecise' | 'manual' | 'none' | 'loaded';

const STATUS_META: Record<StepStatus, { color: string; bg: string; border: string; Icon: React.ComponentType<{ size?: number; color?: string; className?: string }> }> = {
  ok:      { color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.45)',  Icon: CheckCircle2 },
  warn:    { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.45)',  Icon: AlertTriangle },
  fail:    { color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.45)', Icon: XCircle },
  loading: { color: '#818cf8', bg: 'rgba(129,140,248,0.12)', border: 'rgba(129,140,248,0.45)', Icon: Loader2 },
  pending: { color: '#6b7280', bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.30)', Icon: Circle },
  off:     { color: '#6b7280', bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.30)', Icon: Circle },
};

const fmt = (n: number) => n.toLocaleString('fr-CA');

const LotDiagnosticPanel: React.FC<LotDiagnosticPanelProps> = (props) => {
  const {
    noLot, onNoLotChange, lotManual, onLotManualChange,
    buildingPhase, lotDistanceM, lat, lng, addressText,
    buildingGeojson, lotGeojson, mapParams, polygonAdj,
    superficie, largeur, profondeur,
    yearBuilt, dwellingCount, floorCount, mamhDataSource, autofillEnabled,
    apiKey, isMobile, onOpenTakeoff, mamhSlot,
  } = props;

  const lotVal = (noLot || '').trim();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // ── Précision du lot ────────────────────────────────────────────────────
  const precision: Precision = useMemo(() => {
    if (lotManual && lotVal) return 'manual';
    if (buildingPhase === 'loading') return 'loading';
    if (buildingPhase === 'found') {
      if (lotDistanceM == null) return lotVal ? 'loaded' : 'none';
      return lotDistanceM <= PRECISE_THRESHOLD_M ? 'precise' : 'imprecise';
    }
    if (buildingPhase === 'not_found') return lotVal ? 'imprecise' : 'none';
    if (lotVal) return 'loaded'; // chargé depuis une soumission existante
    return 'idle';
  }, [lotManual, lotVal, buildingPhase, lotDistanceM]);

  const isImprecise = precision === 'imprecise' || precision === 'none';

  // ── Étapes du pipeline ──────────────────────────────────────────────────
  const steps = useMemo(() => {
    const geoOk = lat != null && lng != null;
    // `found` = détection fraîche ; sinon un polygone chargé depuis la
    // soumission compte aussi comme « bâtiment OK » (cas réouverture).
    const hasBuilding = !!buildingGeojson;

    const lotDetail =
      precision === 'precise'   ? `Lot ${lotVal} · point dans le lot${lotDistanceM != null ? ` (${lotDistanceM.toFixed(1)} m)` : ''}`
      : precision === 'manual'  ? `Lot ${lotVal} · saisi manuellement`
      : precision === 'loaded'  ? `Lot ${lotVal} · chargé depuis la soumission`
      : precision === 'imprecise' ? `Lot ${lotVal || '?'} · point à ${lotDistanceM != null ? lotDistanceM.toFixed(0) : '?'} m du lot le plus proche — imprécis`
      : precision === 'none'    ? 'Aucun lot associé — sélectionnez-le dans le take off'
      : precision === 'loading' ? 'Recherche en cours…'
      : 'En attente du bâtiment';

    const lotStatus: StepStatus =
      precision === 'precise' || precision === 'manual' || precision === 'loaded' ? 'ok'
      : precision === 'imprecise' ? 'warn'
      : precision === 'none' ? 'fail'
      : precision === 'loading' ? 'loading'
      : 'pending';

    const mamhParts = [
      yearBuilt ? `année ${yearBuilt}` : null,
      dwellingCount ? `${dwellingCount} logement${dwellingCount > 1 ? 's' : ''}` : null,
      floorCount ? `${floorCount} étage${floorCount > 1 ? 's' : ''}` : null,
    ].filter(Boolean);
    const hasMamh = mamhParts.length > 0;

    const mamhStatus: StepStatus =
      !autofillEnabled ? 'off'
      : hasMamh ? 'ok'
      : buildingPhase === 'found' && lotVal ? 'warn'
      : 'pending';
    const mamhDetail =
      !autofillEnabled ? 'Autofill municipal désactivé (flag OFF)'
      : hasMamh ? `${mamhParts.join(' · ')}${mamhDataSource ? ` · ${mamhDataSource}` : ''}`
      : buildingPhase === 'found' && lotVal ? 'Aucune donnée municipale pour ce bâtiment (normal pour ~38 % des bâtiments)'
      : 'En attente du numéro de lot';

    return [
      {
        key: 'geo',
        label: 'Géocodage de l’adresse',
        Icon: MapPin,
        status: (geoOk ? 'ok' : 'pending') as StepStatus,
        detail: geoOk ? `${lat!.toFixed(5)}, ${lng!.toFixed(5)}` : 'Adresse non géocodée — saisir / sélectionner une adresse',
      },
      {
        key: 'bat',
        label: 'Empreinte du bâtiment (find_building_polygon · 100 m)',
        Icon: Building2,
        status: (buildingPhase === 'loading' ? 'loading' : (buildingPhase === 'found' || hasBuilding) ? 'ok' : buildingPhase === 'not_found' ? 'fail' : 'pending') as StepStatus,
        detail:
          buildingPhase === 'loading' ? 'Recherche en cours…'
          : (buildingPhase === 'found' || hasBuilding)
            ? `Empreinte ${buildingPhase === 'found' ? 'trouvée' : 'chargée'}${largeur && profondeur ? ` · ${(largeur * 3.28084).toFixed(0)}'×${(profondeur * 3.28084).toFixed(0)}'` : ''}${superficie ? ` · ${fmt(Math.round(superficie * 10.7639))} pi²` : ''}`
          : buildingPhase === 'not_found' ? 'Aucun bâtiment dans 100 m du point géocodé (hors couverture / géocodage décalé)'
          : 'En attente du géocodage',
      },
      {
        key: 'lot',
        label: 'Numéro de lot',
        Icon: Hash,
        status: lotStatus,
        detail: lotDetail,
      },
      {
        key: 'mamh',
        label: 'Données municipales (MAMH / Brikk)',
        Icon: Landmark,
        status: mamhStatus,
        detail: mamhDetail,
      },
    ];
  }, [lat, lng, buildingPhase, buildingGeojson, precision, lotVal, lotDistanceM, largeur, profondeur, superficie, yearBuilt, dwellingCount, floorCount, mamhDataSource, autofillEnabled]);

  // ── Clignotement : actif dès que polygone + lot + infos sont récupérés ───
  const dataReady = !!buildingGeojson && !!lotVal;
  useEffect(() => {
    // Nouvelle détection (le polygone change) → on ré-arme le clignotement.
    setAcknowledged(false);
  }, [buildingGeojson, lotGeojson]);
  const shouldBlink = dataReady && !acknowledged && !open;

  // ── Carte composite (satellite + polygones) calculée à l'ouverture ───────
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    if (!open) return;
    const cLat = mapParams.centerLat || lat || 0;
    const cLng = mapParams.centerLng || lng || 0;
    if (!cLat || !cLng) { setMapUrl(null); setMapError('Adresse non géocodée — aucune carte à afficher'); return; }
    const z = Math.max(1, Math.round(mapParams.zoom || 19));
    const key = `${cLat.toFixed(6)},${cLng.toFixed(6)},${z},${buildingGeojson?.length || 0},${lotGeojson?.length || 0}`;
    if (key === lastKeyRef.current && mapUrl) return;
    lastKeyRef.current = key;
    let cancelled = false;
    (async () => {
      setMapLoading(true); setMapError(null);
      try {
        const raw = await fetchSatelliteDataUrl(cLat, cLng, z, apiKey);
        if (!raw) { if (!cancelled) { setMapError('Image satellite indisponible'); setMapUrl(null); } return; }
        const composed = (buildingGeojson || lotGeojson)
          ? await compositeMapWithPolygons(raw, cLat, cLng, z, buildingGeojson, lotGeojson, polygonAdj || null)
          : raw;
        if (!cancelled) setMapUrl(composed);
      } catch {
        if (!cancelled) { setMapError('Erreur de génération de la carte'); }
      } finally {
        if (!cancelled) setMapLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapParams.centerLat, mapParams.centerLng, mapParams.zoom, buildingGeojson, lotGeojson, polygonAdj, lat, lng, apiKey]);

  // ── Styles ───────────────────────────────────────────────────────────────
  const inputBorder =
    precision === 'precise' ? 'rgba(52,211,153,0.6)'
    : isImprecise ? 'rgba(251,191,36,0.65)'
    : precision === 'manual' ? 'rgba(96,165,250,0.6)'
    : 'rgba(99,102,241,0.3)';

  const pill = (() => {
    switch (precision) {
      case 'precise':   return { s: 'ok' as StepStatus, label: 'Lot précis' };
      case 'manual':    return { s: 'ok' as StepStatus, label: 'Saisi manuellement' };
      case 'loaded':    return { s: 'ok' as StepStatus, label: 'Lot chargé' };
      case 'imprecise': return { s: 'warn' as StepStatus, label: 'Lot imprécis' };
      case 'none':      return { s: 'fail' as StepStatus, label: 'Lot manquant' };
      case 'loading':   return { s: 'loading' as StepStatus, label: 'Détection…' };
      default:          return { s: 'pending' as StepStatus, label: 'En attente' };
    }
  })();
  const PillIcon = precision === 'manual' ? Pencil : STATUS_META[pill.s].Icon;

  return (
    <>
      <div style={{
        marginBottom: 10,
        padding: '12px 14px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(20,20,50,0.7), rgba(15,15,40,0.55))',
        border: `1px solid ${isImprecise ? 'rgba(251,191,36,0.3)' : 'rgba(99,102,241,0.18)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Hash size={14} color="#60a5fa" />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.6 }}>Numéro de lot</span>
          </div>

          <input
            value={lotVal}
            onChange={(e) => { onNoLotChange(e.target.value); onLotManualChange(true); }}
            placeholder="ex. 4 848 083"
            inputMode="numeric"
            style={{
              flex: isMobile ? '1 1 100%' : '0 1 220px',
              minWidth: 140,
              background: 'rgba(0,0,0,0.35)',
              border: `1px solid ${inputBorder}`,
              borderRadius: 8,
              padding: '8px 10px',
              color: '#e2e8f0',
              fontFamily: 'monospace',
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 0.5,
              outline: 'none',
            }}
          />

          {/* Badge précision */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 9px', borderRadius: 999,
            background: STATUS_META[pill.s].bg,
            border: `1px solid ${STATUS_META[pill.s].border}`,
            color: STATUS_META[pill.s].color,
            fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
          }}>
            <PillIcon size={13} color={STATUS_META[pill.s].color} className={pill.s === 'loading' ? 'lotdiag-spin' : undefined} />
            {pill.label}
          </span>

          {/* Bouton pipeline (clignote quand prêt) */}
          <button
            type="button"
            onClick={() => { setOpen(true); setAcknowledged(true); }}
            className={shouldBlink ? 'lotdiag-blink' : undefined}
            style={{
              marginLeft: isMobile ? 0 : 'auto',
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '8px 12px', borderRadius: 9,
              background: dataReady ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(99,102,241,0.45)',
              color: '#c7d2fe', fontSize: 12, fontWeight: 800, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="Voir la carte et les étapes de détection (où ça bloque)"
          >
            <Building2 size={14} />
            Pipeline détection
            {dataReady && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 6px #34d399', display: 'inline-block' }} />
            )}
          </button>
        </div>

        {/* Avertissement « lot imprécis » */}
        {isImprecise && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            marginTop: 10, padding: '8px 10px', borderRadius: 8,
            background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.3)',
          }}>
            <AlertTriangle size={15} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: '#fde68a', lineHeight: 1.45 }}>
              <b>Le lot n’est pas précis.</b> Le point géocodé ne tombe pas clairement dans un lot.{' '}
              {onOpenTakeoff ? (
                <button
                  type="button"
                  onClick={onOpenTakeoff}
                  style={{ background: 'none', border: 'none', padding: 0, color: '#fcd34d', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                >
                  Ouvrir le take off <ExternalLink size={11} />
                </button>
              ) : <b>Ouvrez le take off</b>}
              , relevez le bon numéro de lot, puis entrez-le ci-dessus manuellement.
            </span>
          </div>
        )}
      </div>

      {/* ── Modale : carte + étapes du pipeline + MAMH ──
          Toujours montée (visibilité via `display`) pour que le bloc MAMH
          (AutofillCoordinator) conserve son état « armé » entre ouvertures. */}
      {(open || !!mamhSlot) && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.78)', display: open ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 0 : 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: isMobile ? '100%' : 'min(720px, 96vw)',
              height: isMobile ? '100dvh' : 'auto',
              maxHeight: isMobile ? '100dvh' : '92vh',
              overflowY: 'auto',
              background: 'linear-gradient(160deg, #12122e, #0d0d22)',
              border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: isMobile ? 0 : 16,
              boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }}
          >
            {/* Header */}
            <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: 'rgba(13,13,34,0.95)', borderBottom: '1px solid rgba(99,102,241,0.18)', backdropFilter: 'blur(6px)' }}>
              <Building2 size={18} color="#a5b4fc" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>Pipeline de détection du lot</div>
                <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{addressText || 'Aucune adresse'}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Carte */}
            <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', maxHeight: isMobile ? '50vh' : 380, background: '#0a0a18', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {mapLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#818cf8' }}>
                  <Loader2 size={26} className="lotdiag-spin" color="#818cf8" />
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>Génération de la carte…</span>
                </div>
              ) : mapUrl ? (
                <img src={mapUrl} alt="Carte du bâtiment et du lot" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#6b7280', padding: 20, textAlign: 'center' }}>
                  <MapPin size={26} color="#4b5563" />
                  <span style={{ fontSize: 12 }}>{mapError || 'Aucune carte disponible'}</span>
                </div>
              )}
              {/* Légende */}
              {mapUrl && (
                <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 8, padding: '5px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
                  {lotGeojson && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#bfdbfe', fontWeight: 700 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(59,130,246,0.3)', border: '1.5px solid rgba(96,165,250,0.9)' }} /> Lot
                    </span>
                  )}
                  {buildingGeojson && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#fed7aa', fontWeight: 700 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(245,158,11,0.35)', border: '1.5px solid rgba(245,158,11,0.95)' }} /> Bâtiment
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Étapes */}
            <div style={{ padding: '14px 18px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6b7280', marginBottom: 12 }}>
                Étapes de récupération
              </div>
              {steps.map((st, i) => {
                const meta = STATUS_META[st.status];
                const last = i === steps.length - 1;
                return (
                  <div key={st.key} style={{ display: 'flex', gap: 12, position: 'relative' }}>
                    {/* Rail + pastille de statut */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: meta.bg, border: `1px solid ${meta.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <meta.Icon size={15} color={meta.color} className={st.status === 'loading' ? 'lotdiag-spin' : undefined} />
                      </div>
                      {!last && <div style={{ width: 2, flex: 1, minHeight: 14, background: 'rgba(255,255,255,0.08)', marginTop: 2, marginBottom: 2 }} />}
                    </div>
                    {/* Texte */}
                    <div style={{ paddingBottom: last ? 0 : 14, flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <st.Icon size={13} color="#9ca3af" />
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0' }}>{st.label}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: meta.color === '#6b7280' ? '#9ca3af' : meta.color, marginTop: 3, lineHeight: 1.4 }}>
                        {st.detail}
                      </div>
                    </div>
                  </div>
                );
              })}

              {(precision === 'imprecise' || precision === 'none') && onOpenTakeoff && (
                <button
                  type="button"
                  onClick={() => { onOpenTakeoff(); setOpen(false); }}
                  style={{ marginTop: 14, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 14px', borderRadius: 10, background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.4)', color: '#fde68a', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
                >
                  <ExternalLink size={14} /> Ouvrir le take off pour relever le bon lot
                </button>
              )}
            </div>

            {/* Données municipales & auto-remplissage (MAMH / Solar / Type couv.) */}
            {mamhSlot && (
              <div style={{ padding: '0 18px 20px' }}>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 0 14px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                  <Landmark size={13} color="#9ca3af" />
                  <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6b7280' }}>
                    Données municipales &amp; auto-remplissage
                  </span>
                </div>
                {mamhSlot}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes lotdiagBlink {
          0%, 100% { box-shadow: 0 0 0 0 rgba(96,165,250,0); border-color: rgba(99,102,241,0.45); }
          50%      { box-shadow: 0 0 0 4px rgba(96,165,250,0.35); border-color: rgba(96,165,250,1); }
        }
        .lotdiag-blink { animation: lotdiagBlink 1.1s ease-in-out infinite; }
        @keyframes lotdiagSpin { to { transform: rotate(360deg); } }
        .lotdiag-spin { animation: lotdiagSpin 0.9s linear infinite; }
      `}</style>
    </>
  );
};

export default LotDiagnosticPanel;
