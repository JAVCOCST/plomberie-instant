import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapPin, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { supabase } from '../../../integrations/supabase/client';
import advisorAvatar from '../../../assets/advisor-avatar.png';
import BuildingReadOnlyMap from './BuildingReadOnlyMap';
import BuildingMapPicker from './BuildingMapPicker';
import s from './BuildingConfirmation.module.css';

import type { PolygonAdjustments } from './BuildingReadOnlyMap';

interface Props {
  firstName: string;
  address: string;
  lat: number;
  lng: number;
  onConfirm: (geojson: string, superficie: number | null, perimetre: number | null, extra?: { lotGeojson: string | null; noLot: string | null; largeur: number | null; profondeur: number | null }) => void;
  onNotCovered: () => void;
  onContinueWithout: () => void;
  onAdjustmentsChange?: (adj: PolygonAdjustments) => void;
}

type Phase = 'loading' | 'found' | 'not_found' | 'manual_select';

/** Compute the best zoom level to fit a GeoJSON polygon in a square image */
function computeZoomForPolygon(geojsonStr: string, imgSize: number, scale: number): { zoom: number; centerLat: number; centerLng: number } {
  try {
    const parsed = JSON.parse(geojsonStr);
    let coords: number[][] = [];
    if (parsed.type === 'Polygon') {
      coords = parsed.coordinates[0];
    } else if (parsed.type === 'MultiPolygon') {
      parsed.coordinates.forEach((poly: number[][][]) => coords.push(...poly[0]));
    }
    if (coords.length === 0) return { zoom: 19, centerLat: 0, centerLng: 0 };

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lng, lat] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const tileSize = 256;
    const availablePx = imgSize * scale;

    const zoomLng = lngSpan > 0 ? Math.log2(availablePx * 360 / (lngSpan * tileSize * scale)) : 21;
    const latRad = centerLat * Math.PI / 180;
    const zoomLat = latSpan > 0 ? Math.log2(availablePx * 360 / (latSpan * tileSize * scale * (1 / Math.cos(latRad)))) : 21;

    // Math.floor(min(...)) already gives the zoom at which the polygon fits
    // within the viewport — no need to add +1 (which previously made the
    // polygon overflow because each zoom level doubles the scale).
    const zoom = Math.min(Math.floor(Math.min(zoomLng, zoomLat)), 21);
    return { zoom: Math.max(zoom, 17), centerLat, centerLng };
  } catch {
    return { zoom: 19, centerLat: 0, centerLng: 0 };
  }
}

const BuildingConfirmation: React.FC<Props> = ({ firstName, address, lat, lng, onConfirm, onNotCovered, onContinueWithout, onAdjustmentsChange }) => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [geojson, setGeojson] = useState<string | null>(null);
  const [lotGeojson, setLotGeojson] = useState<string | null>(null);
  const [noLot, setNoLot] = useState<string | null>(null);
  const [superficie, setSuperficie] = useState<number | null>(null);
  const [perimetre, setPerimetre] = useState<number | null>(null);
  const [largeur, setLargeur] = useState<number | null>(null);
  const [profondeur, setProfondeur] = useState<number | null>(null);
  const [mapParams, setMapParams] = useState<{ zoom: number; centerLat: number; centerLng: number }>({ zoom: 19, centerLat: lat, centerLng: lng });
  const [reloading, setReloading] = useState(false);
  const launched = useRef(false);

  const name = firstName || 'là';


  const lookupBuilding = useCallback(async (lookupLat: number, lookupLng: number) => {
    setReloading(true);
    try {
      // Safety net: if the RPC hangs (slow network, gateway timeout), fall through
      // to the manual not_found path so the user is never stuck in 'loading'.
      // Radius 200 m : Google géocode parfois au centre de la rue plutôt qu'à
      // l'adresse exacte (rues sans données précises). 100 m était trop strict
      // et créait des faux "not_found". En zone résidentielle 200 m couvre
      // largement le bâtiment cible sans matcher le voisin par erreur (le
      // ORDER BY dist ASC garde toujours le plus proche).
      const rpcPromise = supabase.rpc('find_building_polygon', {
        p_lat: lookupLat,
        p_lng: lookupLng,
        p_radius_meters: 200,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('rpc_timeout')), 10000)
      );
      const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as Awaited<typeof rpcPromise>;

      if (error) throw error;

      if (data && data.length > 0) {
        const row = data[0];
        setGeojson(row.geojson);
        setLotGeojson(row.lot_geojson);
        setNoLot(row.no_lot);
        setSuperficie(row.superficie);
        setPerimetre(row.perimetre);
        setLargeur(row.largeur);
        setProfondeur(row.profondeur);

        const zoomTarget = row.lot_geojson || row.geojson;
        const params = computeZoomForPolygon(zoomTarget, 640, 2);
        setMapParams(params);
        setPhase('found');
      } else {
        // Log les coordonnées pour debug terrain : si le bâtiment existe en
        // BD mais n'est pas trouvé, c'est que le géocoding Google pointe
        // ailleurs (centre de rue, mauvaise ville, etc.).
        console.warn('[BuildingConfirmation] not_found at', lookupLat, lookupLng);
        // Centre la carte sur les coords géocodées pour que l'utilisateur
        // puisse pointer son bâtiment manuellement.
        setMapParams({ zoom: 19, centerLat: lookupLat, centerLng: lookupLng });
        setPhase('not_found');
      }
    } catch (e) {
      console.error('Building polygon lookup error:', e);
      setMapParams({ zoom: 19, centerLat: lookupLat, centerLng: lookupLng });
      setPhase('not_found');
    } finally {
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    lookupBuilding(lat, lng);
  }, [lat, lng, lookupBuilding]);

  const handleManualSelect = useCallback((clickLat: number, clickLng: number) => {
    lookupBuilding(clickLat, clickLng);
  }, [lookupBuilding]);

  return (
    <div className={s.wrap}>
      {/* Advisor bubble */}
      <div className={s.msgRow}>
        <div className={s.avatar}>
          <img src={advisorAvatar} alt="Marie-Ève" className={s.avatarImg} />
          <div className={s.onlineDot} />
        </div>
        <div className={s.bubble}>
          <span className={s.name}>Marie-Ève</span>

          {phase === 'loading' && (
            <motion.p className={s.text} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <span className={s.spinner} />
              Recherche de votre bâtiment en cours…
            </motion.p>
          )}

          {phase === 'not_found' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <p className={s.text} style={{ marginBottom: 8 }}>
                <MapPin size={14} style={{ color: 'var(--imm-accent)', flexShrink: 0 }} />
                {name}, on n'a pas localisé votre bâtiment automatiquement. Pointez-le directement sur la carte pour qu'on puisse l'analyser.
              </p>
              <p className={s.textDim}>
                Si vous préférez, vous pouvez aussi continuer sans — on vous demandera la superficie manuellement à la fin.
              </p>
            </motion.div>
          )}

          {phase === 'found' && !reloading && (
            <motion.p className={s.text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <MapPin size={14} style={{ color: 'var(--imm-accent)', flexShrink: 0 }} />
              {name}, est-ce bien votre bâtiment ?
            </motion.p>
          )}

          {phase === 'found' && reloading && (
            <motion.p className={s.text} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <span className={s.spinner} />
              Mise à jour du bâtiment…
            </motion.p>
          )}

          {phase === 'manual_select' && (
            <motion.p className={s.text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <MapPin size={14} style={{ color: 'var(--imm-accent)', flexShrink: 0 }} />
              Déplacez la carte et cliquez directement sur votre bâtiment.
            </motion.p>
          )}
        </div>
      </div>

      {/* Satellite view with native Google Map polygons.
          defaultShowOrthoQC: superpose l'orthophoto officielle du Québec (WMTS
          geoegl.msp.gouv.qc.ca) au-dessus du fond Google Satellite. Sert de
          backup haute résolution si les tuiles Google échouent (clé API,
          quota, ou indisponibilité au zoom 19-20). Tous les bâtiments du QC
          sont couverts par le WMTS provincial. */}
      {phase === 'found' && geojson && !reloading && (
        <BuildingReadOnlyMap
          centerLat={mapParams.centerLat}
          centerLng={mapParams.centerLng}
          zoom={mapParams.zoom}
          buildingGeojson={geojson}
          lotGeojson={lotGeojson}
          address={address}
          superficie={superficie}
          largeur={largeur}
          profondeur={profondeur}
          noLot={noLot}
          onAdjustmentsChange={onAdjustmentsChange}
          defaultShowOrthoQC
          alwaysInteractive
        />
      )}

      {/* Interactive map for manual selection — affiché aussi sur not_found
          pour que l'utilisateur puisse pointer son bâtiment quand le
          géocoding automatique a échoué. */}
      {(phase === 'manual_select' || phase === 'not_found') && (
        <BuildingMapPicker
          lat={mapParams.centerLat || lat}
          lng={mapParams.centerLng || lng}
          zoom={mapParams.zoom || 19}
          buildingGeojson={geojson}
          lotGeojson={lotGeojson}
          onSelectLocation={handleManualSelect}
        />
      )}

      {/* Confirm button */}
      {phase === 'found' && !reloading && (
        <>
          <motion.button
            className={s.confirmBtn}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            onClick={() => onConfirm(geojson!, superficie, perimetre, { lotGeojson, noLot, largeur, profondeur })}
          >
            <CheckCircle size={18} />
            Oui, c'est mon bâtiment
          </motion.button>

          <motion.button
            className={s.rejectBtn}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            onClick={() => setPhase('manual_select')}
          >
            <RotateCcw size={14} />
            Non, sélectionner un autre bâtiment
          </motion.button>
        </>
      )}

      {phase === 'not_found' && (
        <motion.button
          className={s.rejectBtn}
          style={{ background: 'hsla(230, 20%, 25%, 0.8)', borderColor: 'hsla(230, 20%, 40%, 0.5)' }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          onClick={onContinueWithout}
        >
          Continuer sans bâtiment →
        </motion.button>
      )}
    </div>
  );
};

export default BuildingConfirmation;
