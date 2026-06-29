/// <reference types="google.maps" />
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { MousePointerClick, AlertCircle } from 'lucide-react';
import s from './BuildingConfirmation.module.css';

interface BuildingMapPickerProps {
  lat: number;
  lng: number;
  zoom?: number;
  buildingGeojson?: string | null;
  lotGeojson?: string | null;
  onSelectLocation: (lat: number, lng: number) => void;
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

const BuildingMapPicker: React.FC<BuildingMapPickerProps> = ({
  lat, lng, zoom = 19, buildingGeojson, lotGeojson, onSelectLocation,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const [satelliteFailed, setSatelliteFailed] = useState(false);

  const clearPolygons = useCallback(() => {
    polygonsRef.current.forEach(p => p.setMap(null));
    polygonsRef.current = [];
  }, []);

  const drawPolygons = useCallback(() => {
    if (!mapInstance.current) return;
    clearPolygons();

    // Draw lot polygon (blue, subtle)
    if (lotGeojson) {
      const paths = parseGeoJsonCoords(lotGeojson);
      paths.forEach(path => {
        const poly = new google.maps.Polygon({
          paths: path,
          map: mapInstance.current!,
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          strokeColor: '#60a5fa',
          strokeOpacity: 0.7,
          strokeWeight: 1.5,
          clickable: false,
        });
        polygonsRef.current.push(poly);
      });
    }

    // Draw building polygon (orange, highlighted)
    if (buildingGeojson) {
      const paths = parseGeoJsonCoords(buildingGeojson);
      paths.forEach(path => {
        const poly = new google.maps.Polygon({
          paths: path,
          map: mapInstance.current!,
          fillColor: '#f59e0b',
          fillOpacity: 0.25,
          strokeColor: '#f59e0b',
          strokeOpacity: 0.9,
          strokeWeight: 2,
          clickable: false,
        });
        polygonsRef.current.push(poly);
      });
    }
  }, [buildingGeojson, lotGeojson, clearPolygons]);

  const handleClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    const clickLat = e.latLng.lat();
    const clickLng = e.latLng.lng();

    if (markerRef.current) {
      markerRef.current.setPosition(e.latLng);
    } else if (mapInstance.current) {
      markerRef.current = new google.maps.Marker({
        position: e.latLng,
        map: mapInstance.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#f59e0b',
          fillOpacity: 0.9,
          strokeColor: '#fff',
          strokeWeight: 3,
        },
      });
    }

    onSelectLocation(clickLat, clickLng);
  }, [onSelectLocation]);

  // Init map once
  useEffect(() => {
    if (!mapRef.current || !(window as any).google?.maps) return;

    const map = new google.maps.Map(mapRef.current, {
      center: { lat, lng },
      zoom,
      mapTypeId: 'satellite',
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      tilt: 0,
    });

    mapInstance.current = map;
    map.addListener('click', handleClick);

    // Diagnostic : si après 2.5s le mapTypeId a basculé hors satellite
    // (Google le fait silencieusement quand la facturation/quota échoue),
    // on bascule en fallback Static Maps (qui n'utilise pas le même quota).
    const checkTimer = window.setTimeout(() => {
      try {
        const t = map.getMapTypeId();
        if (t !== 'satellite' && t !== 'hybrid') {
          console.warn('[BuildingMapPicker] Satellite indisponible (mapTypeId=', t, ') — fallback Static Maps activé. Vérifiez la facturation Google Cloud et les restrictions de référent.');
          setSatelliteFailed(true);
        } else {
          // Force re-set au cas où
          map.setMapTypeId('satellite');
        }
      } catch (e) {
        console.error('[BuildingMapPicker] Erreur diagnostic satellite', e);
      }
    }, 2500);

    return () => {
      window.clearTimeout(checkTimer);
      clearPolygons();
      google.maps.event.clearListeners(map, 'click');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update center/zoom when props change
  useEffect(() => {
    if (!mapInstance.current) return;
    mapInstance.current.setCenter({ lat, lng });
    mapInstance.current.setZoom(zoom);
  }, [lat, lng, zoom]);

  // Redraw polygons when geojson changes
  useEffect(() => {
    drawPolygons();
  }, [drawPolygons]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={s.mapPickerWrap}
    >
      <div className={s.mapPickerHint}>
        <MousePointerClick size={14} />
        Cliquez sur votre bâtiment sur la carte
      </div>
      <div ref={mapRef} className={s.mapPickerMap} />
      {satelliteFailed && (
        <div
          role="status"
          style={{
            position: 'absolute', top: 48, left: 12, right: 12, zIndex: 5,
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '8px 12px', borderRadius: 8,
            background: 'hsla(0, 70%, 25%, 0.92)', color: '#fecaca',
            border: '1px solid hsla(0, 80%, 60%, 0.35)',
            fontSize: 12, lineHeight: 1.4,
            backdropFilter: 'blur(8px)',
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Vue satellite temporairement indisponible — utilisez la vue carte pour positionner votre bâtiment.</span>
        </div>
      )}
    </motion.div>
  );
};

export default BuildingMapPicker;
