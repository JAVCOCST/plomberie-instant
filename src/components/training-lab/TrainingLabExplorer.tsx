/**
 * TrainingLabExplorer — Mode "label-on-the-fly" pour le Training Lab.
 *
 * Workflow :
 *   1. L'utilisateur navigue sur Google Maps (pan/zoom libre).
 *   2. Il tap un bâtiment → marker rouge + appel find_building_polygon RPC.
 *   3. Il clique "Geler la vue + IA" :
 *        a. Construit l'URL Google Static Maps (1280×1280 satellite + hybrid).
 *        b. INSERT une nouvelle row dans training_roof_takeoffs avec image +
 *           building_geojson + map_params.
 *        c. Appelle runMvpV16Prediction sur la HF Space → reçoit le JSON v1.6.
 *        d. UPDATE row avec roof_sections_v16.
 *        e. Notifie parent via onDatasetCreated(row) → parent ouvre le tracer.
 *
 * Aucun export, aucune calibration, aucune validation gate ici — on est dans
 * un flow d'acquisition rapide. La validation se fait après dans le tracer.
 */

/// <reference types="google.maps" />
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, MapPin, Search, X, Sparkles, RotateCcw, Pencil } from 'lucide-react';
import type { TrainingTakeoff } from '@/lib/training-lab';
import { runMvpV16Prediction } from '@/lib/training-lab-mvp-bridge';
import { metersPerPx } from '@/lib/roof-core/georef';
import { extractMainRingLatLng } from '@/lib/roof-sections';

interface Props {
  /** Appelé quand un nouveau dataset est créé + pré-annoté par l'IA.
   *  Le parent doit alors le rendre disponible dans la liste + ouvrir le tracer. */
  onDatasetCreated: (row: TrainingTakeoff) => void;
  onCancel: () => void;
}

const GOOGLE_API_KEY = (import.meta as { env?: Record<string, string> }).env?.VITE_GOOGLE_MAPS_API_KEY || '';
const DEFAULT_CENTER = { lat: 45.4001, lng: -72.7341 }; // Granby, QC
const DEFAULT_ZOOM = 18;

// Mémorisation de la dernière position de la carte explorer per-device. À la
// réouverture du modal, on restore center + zoom au lieu de retomber sur le
// défaut Granby — évite au user de re-naviguer chaque fois vers son chantier.
const MAP_VIEW_KEY = 'training-explorer-map-view';
type SavedMapView = { lat: number; lng: number; zoom: number };
function loadSavedMapView(): SavedMapView | null {
  try {
    const raw = localStorage.getItem(MAP_VIEW_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (typeof j?.lat === 'number' && typeof j?.lng === 'number' && typeof j?.zoom === 'number') return j as SavedMapView;
  } catch {}
  return null;
}
function saveMapView(v: SavedMapView): void {
  try { localStorage.setItem(MAP_VIEW_KEY, JSON.stringify(v)); } catch {}
}
const CAPTURE_ZOOM = 20; // zoom par défaut quand on n'a pas de polygone à fitter (fallback)
const CAPTURE_SIZE = 640; // 640 × scale=2 = 1280 px effectifs (cf. fromRoofSectionsV16 default)
const CAPTURE_ZOOM_MIN = 16; // zoom le plus large possible — au-delà c'est trop petit pour annoter
const CAPTURE_MARGIN = 1.2;  // 20% de marge autour du polygone pour ne pas coller aux bords

/** Auto-zoom : trouve le plus grand zoom où le polygone (bbox + marge) tient dans
 *  1280px (taille effective de l'image capturée). Évite que l'image satellite coupe
 *  le bâtiment quand il est gros — cause de plantage du pipeline IA v1.6 quand
 *  le prior dépasse l'image (toutes les variations dans fit_roof_rectangle sortent
 *  du cadre → 0 candidat → NoneType crash côté HF Space). */
function computeAutoZoom(lat: number, polygonLatLng: [number, number][]): number {
  if (!polygonLatLng || polygonLatLng.length < 2) return CAPTURE_ZOOM;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [pLat, pLng] of polygonLatLng) {
    if (pLat < minLat) minLat = pLat; if (pLat > maxLat) maxLat = pLat;
    if (pLng < minLng) minLng = pLng; if (pLng > maxLng) maxLng = pLng;
  }
  const latRange_m = (maxLat - minLat) * 111320;
  const lngRange_m = (maxLng - minLng) * 111320 * Math.cos((lat * Math.PI) / 180);
  const maxDim_m = Math.max(latRange_m, lngRange_m) * CAPTURE_MARGIN;
  if (!isFinite(maxDim_m) || maxDim_m <= 0) return CAPTURE_ZOOM;
  const TARGET_PX = CAPTURE_SIZE * 2; // 1280px effectifs (scale=2)
  for (let z = CAPTURE_ZOOM; z >= CAPTURE_ZOOM_MIN; z--) {
    const polyPx = maxDim_m / metersPerPx(lat, z, 2);
    if (polyPx <= TARGET_PX) return z;
  }
  return CAPTURE_ZOOM_MIN;
}

const sb = supabase as any;

function buildStaticMapUrl(lat: number, lng: number, mapType: 'satellite' | 'hybrid', zoom: number = CAPTURE_ZOOM): string {
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${CAPTURE_SIZE}x${CAPTURE_SIZE}`,
    scale: '2',
    maptype: mapType,
    key: GOOGLE_API_KEY,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

/** Charge le script Google Maps une seule fois pour toute l'app. */
let mapsLoaderPromise: Promise<void> | null = null;
function ensureGoogleMaps(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).google?.maps) return Promise.resolve();
  if (mapsLoaderPromise) return mapsLoaderPromise;
  mapsLoaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src*="maps.googleapis.com"]`);
    if (existing) {
      // Un autre composant l'a déjà chargé — attendre window.google.
      const iv = setInterval(() => {
        if ((window as any).google?.maps) { clearInterval(iv); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(iv); reject(new Error('Google Maps load timeout')); }, 10000);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps script load failed'));
    document.head.appendChild(script);
  });
  return mapsLoaderPromise;
}

interface SelectedBuilding {
  lat: number;
  lng: number;
  buildingGeojson: any;
  lotGeojson: any;
  address: string | null;
}

export default function TrainingLabExplorer({ onDatasetCreated, onCancel }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const buildingPolygonRef = useRef<google.maps.Polygon | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<SelectedBuilding | null>(null);
  const [loadingBldg, setLoadingBldg] = useState(false);
  const [freezing, setFreezing] = useState(false);
  // Mode de sélection v1.6 — change le `cap` de structural_selection :
  //   conservative=1 ridge / normal=2 / complex=4 / cross=6 / adaptive=auto
  // Cf. structural_selection.py dans huggingface-space/.
  // Mode IA hard-codé en 'adaptive' depuis 2026-06-05 : la pipeline détermine
  // toute seule combien de ridges garder (1-5) selon la typologie du bâtiment.
  // L'ancien dropdown laissait l'opérateur choisir manuellement → tout le monde
  // restait sur 'conservative' (default) et sous-détectait les L-shape/multi-wing.
  // State conservé pour compat (passé à runMvpV16Prediction) mais plus exposé en UI.
  const [selectionMode] = useState<'conservative' | 'normal' | 'complex' | 'cross' | 'adaptive'>('adaptive');

  // ── Mount : load Google Maps, instantiate map + click handler + autocomplete.
  useEffect(() => {
    if (!GOOGLE_API_KEY) {
      toast.error('VITE_GOOGLE_MAPS_API_KEY manquant — impossible d\'ouvrir la carte.');
      return;
    }
    let cancelled = false;
    ensureGoogleMaps().then(() => {
      if (cancelled || !mapDivRef.current) return;
      // Restore la dernière vue (per-device, localStorage). Fallback Granby
      // au premier lancement.
      const saved = loadSavedMapView();
      const initCenter = saved ? { lat: saved.lat, lng: saved.lng } : DEFAULT_CENTER;
      const initZoom = saved ? saved.zoom : DEFAULT_ZOOM;
      const map = new google.maps.Map(mapDivRef.current, {
        center: initCenter,
        zoom: initZoom,
        mapTypeId: 'satellite',
        tilt: 0,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
      });
      mapRef.current = map;
      // Persiste center + zoom à chaque idle (= fin d'un mouvement / zoom).
      // L'event "idle" est moins bavard que "center_changed"/"zoom_changed"
      // qui spamment pendant le drag, et il garantit que la position finale
      // est sauvée (pas une intermédiaire pendant le drag).
      map.addListener('idle', () => {
        const c = map.getCenter(); const z = map.getZoom();
        if (!c || typeof z !== 'number') return;
        saveMapView({ lat: c.lat(), lng: c.lng(), zoom: z });
      });
      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        handleMapClick(lat, lng);
      });
      // Places autocomplete sur la search box.
      if (searchInputRef.current) {
        const ac = new google.maps.places.Autocomplete(searchInputRef.current, {
          types: ['address'],
          componentRestrictions: { country: 'ca' },
        });
        ac.bindTo('bounds', map);
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          const loc = place.geometry?.location;
          if (loc) {
            map.setCenter(loc);
            map.setZoom(CAPTURE_ZOOM);
          }
        });
      }
      setMapReady(true);
    }).catch((e) => {
      toast.error(`Carte Google indisponible : ${e?.message || e}`);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Click sur un point de la carte → cherche le bâtiment à cet endroit.
  const handleMapClick = async (lat: number, lng: number) => {
    setLoadingBldg(true);
    setSelected(null);
    try {
      // Marker visuel immédiat pour feedback.
      if (markerRef.current) markerRef.current.setMap(null);
      markerRef.current = new google.maps.Marker({
        position: { lat, lng },
        map: mapRef.current!,
        animation: google.maps.Animation.DROP,
      });
      if (buildingPolygonRef.current) {
        buildingPolygonRef.current.setMap(null);
        buildingPolygonRef.current = null;
      }
      // RPC find_building_polygon — même appel que recoverTakeoffGeometryFromSoumission.
      const { data, error } = await sb.rpc('find_building_polygon', {
        p_lat: lat, p_lng: lng, p_radius_meters: 100,
      });
      if (error) throw error;
      const row: any = Array.isArray(data) && data.length ? data[0] : null;
      if (!row?.geojson) {
        toast.error('Pas de bâtiment détecté à cet endroit (essaye un autre clic).');
        setLoadingBldg(false);
        return;
      }
      const bldg = typeof row.geojson === 'string' ? JSON.parse(row.geojson) : row.geojson;
      const lot = row.lot_geojson
        ? (typeof row.lot_geojson === 'string' ? JSON.parse(row.lot_geojson) : row.lot_geojson)
        : null;
      // Dessine le polygone bâtiment sur la carte (orange semi-transparent).
      const paths = extractGoogleMapsPaths(bldg);
      if (paths.length) {
        const poly = new google.maps.Polygon({
          paths: paths[0],
          map: mapRef.current!,
          strokeColor: '#f59e0b',
          strokeWeight: 3,
          fillColor: '#f59e0b',
          fillOpacity: 0.30,
          clickable: true,
          editable: true,          // ← drag corners + add via midpoint handles
          draggable: true,         // ← drag du polygone entier
          zIndex: 10,
        });
        buildingPolygonRef.current = poly;
        // Delete vertex au right-click / long-press : sur mobile iOS, on
        // intercepte `rightclick` qui est émis par Google Maps après un
        // long-press de ~500ms sur un sommet (pas sur le path lui-même).
        // Sur desktop, le right-click marche aussi.
        poly.addListener('rightclick', (e: google.maps.PolyMouseEvent) => {
          if (typeof e.vertex !== 'number') return;
          const path = poly.getPath();
          if (path.getLength() <= 3) {
            toast.warning('Un polygone doit avoir au moins 3 coins');
            return;
          }
          path.removeAt(e.vertex);
        });
      }
      // Reverse geocode pour avoir une adresse lisible (best-effort).
      let address: string | null = null;
      try {
        const geocoder = new google.maps.Geocoder();
        const res = await geocoder.geocode({ location: { lat, lng } });
        address = res.results?.[0]?.formatted_address || null;
      } catch { /* ignore */ }
      setSelected({ lat, lng, buildingGeojson: bldg, lotGeojson: lot, address });
    } catch (e: any) {
      toast.error(`Recherche bâtiment échouée : ${e?.message || e}`);
    } finally {
      setLoadingBldg(false);
    }
  };

  // ── "Geler + IA" : crée la row + appelle l'IA + ouvre le tracer.
  const handleFreezeAndPredict = async () => {
    if (!selected || !mapRef.current) return;
    setFreezing(true);
    const toastId = toast.loading('1/4 · Capture image satellite…');
    try {
      const { lat, lng, buildingGeojson: originalBldg, lotGeojson, address } = selected;
      // Si l'utilisateur a édité le polygone (drag des coins / drag du polygone
      // entier sur la map), on récupère les nouvelles coords directement depuis
      // la Polygon Google Maps. Sinon on garde le polygone cadastral original.
      let buildingGeojson = originalBldg;
      if (buildingPolygonRef.current) {
        const path = buildingPolygonRef.current.getPath();
        const ring: [number, number][] = [];
        for (let i = 0; i < path.getLength(); i++) {
          const ll = path.getAt(i);
          ring.push([ll.lng(), ll.lat()]);
        }
        if (ring.length >= 3) {
          // Ferme le ring (GeoJSON requirement)
          if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
            ring.push([ring[0][0], ring[0][1]]);
          }
          buildingGeojson = { type: 'Polygon', coordinates: [ring] };
        }
      }
      // Auto-zoom : on calcule le plus grand zoom où le polygone du bâtiment
      // tient dans 1280px avec 20% de marge. Évite que l'image satellite
      // coupe les gros bâtiments (cf. crash IA v1.6 NoneType quand le prior
      // dépasse l'image). Petites maisons → zoom 20 (haute rés). Gros
      // bâtiments → zoom 19/18/17/16 automatique.
      const polyLatLng = extractMainRingLatLng(buildingGeojson);
      const captureZoom = polyLatLng ? computeAutoZoom(lat, polyLatLng) : CAPTURE_ZOOM;
      // Centre la carte exactement sur le bâtiment + zoom de capture (sinon l'image
      // capturée ne correspondrait pas à la vue affichée).
      mapRef.current.setCenter({ lat, lng });
      mapRef.current.setZoom(captureZoom);
      const rawImageUrl = buildStaticMapUrl(lat, lng, 'satellite', captureZoom);
      const debugOverlayUrl = buildStaticMapUrl(lat, lng, 'hybrid', captureZoom);
      const mapParams = { centerLat: lat, centerLng: lng, zoom: captureZoom };
      // INSERT row "draft".
      const shortHash = Math.random().toString(36).slice(2, 10).toUpperCase();
      const reference = `VB-MAP-${shortHash}`;
      const { data: inserted, error: insErr } = await sb
        .from('training_roof_takeoffs')
        .insert({
          reference,
          address,
          raw_image_url: rawImageUrl,
          debug_overlay_url: debugOverlayUrl,
          original_building_geojson: originalBldg,
          // Si l'utilisateur a édité, on stocke le résultat corrigé. Sinon
          // corrected = original (= comportement v1.6 sans édition).
          corrected_building_geojson: buildingGeojson !== originalBldg ? buildingGeojson : null,
          original_lot_geojson: lotGeojson,
          annotations_json: { map_params: mapParams, source: 'training-lab-explorer' },
          dataset_status: 'draft',
          tags: [],
        })
        .select()
        .single();
      if (insErr) throw new Error(`DB insert : ${insErr.message}`);
      let row = inserted as TrainingTakeoff;
      toast.loading('2/4 · Dataset créé · Appel IA v1.6 en cours (10-30s)…', { id: toastId });
      // Appel IA v1.6 — peut prendre 10-30s.
      try {
        const v16 = await runMvpV16Prediction({
          imageUrl: rawImageUrl,
          buildingGeojson,
          mapParams,
          roofType: 'mixed',
          selectionMode,
        });
        toast.loading('3/4 · IA v1.6 OK · Sauvegarde des sections…', { id: toastId });
        const { error: updErr } = await sb
          .from('training_roof_takeoffs')
          .update({ roof_sections_v16: v16 })
          .eq('id', row.id);
        if (updErr) console.warn('[explorer] roof_sections_v16 update failed:', updErr);
        row = { ...row, roof_sections_v16: v16 };
        toast.success('4/4 · Prêt — ouverture du tracer.', { id: toastId });
      } catch (iaErr: any) {
        toast.error(`IA v1.6 indisponible : ${iaErr?.message || iaErr} — tracer ouvert vide.`, {
          id: toastId, duration: 8000,
        });
      }
      onDatasetCreated(row);
    } catch (e: any) {
      toast.error(`Échec : ${e?.message || e}`, { id: toastId });
    } finally {
      setFreezing(false);
    }
  };

  // ── Layout : top bar (search + close) + map + bottom action bar.
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'hsl(230,22%,7%)', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
      {/* Top bar : search + close */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        borderBottom: '1px solid hsl(230,20%,18%)', background: 'hsl(230,22%,9%)',
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'hsl(230,10%,55%)' }} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Adresse (ex: 569 Rue Notre Dame, Granby)"
            disabled={!mapReady}
            style={{
              width: '100%', padding: '8px 8px 8px 32px',
              background: 'hsl(230,22%,12%)', color: '#e5e7eb',
              border: '1px solid hsl(230,20%,18%)', borderRadius: 6,
              fontSize: 13, outline: 'none',
            }}
          />
        </div>
        <button onClick={onCancel} className="vb-btn" title="Fermer l'explorer">
          <X size={14} /> Fermer
        </button>
      </div>

      {/* Map */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={mapDivRef} style={{ position: 'absolute', inset: 0, background: 'hsl(230,22%,8%)' }} />
        {!mapReady && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(230,10%,55%)', flexDirection: 'column', gap: 8 }}>
            <Loader2 size={24} className="animate-spin" /> Chargement de la carte…
          </div>
        )}
        {loadingBldg && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            padding: '6px 12px', borderRadius: 999,
            background: 'hsl(38,90%,55%)', color: '#1a1100',
            fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Loader2 size={12} className="animate-spin" /> Recherche du bâtiment…
          </div>
        )}
      </div>

      {/* Bottom action bar — visible quand un bâtiment est sélectionné */}
      {selected && (
        <div style={{
          padding: '12px 14px', background: 'hsl(230,22%,9%)',
          borderTop: '1px solid hsl(230,20%,18%)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e5e7eb', fontSize: 12 }}>
            <MapPin size={14} color="hsl(35,95%,60%)" />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected.address || `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`}
            </span>
          </div>
          {/* Banner d'instruction — explique l'édition du polygone (les coins
              orange sont draggable, midpoint-tap pour ajouter, long-press pour
              supprimer). Visible seulement si un polygone est affiché. */}
          {selected.buildingGeojson && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '8px 10px',
              background: 'hsl(35,80%,12%)',
              border: '1px solid hsl(35,80%,30%)',
              borderRadius: 6,
              fontSize: 11, color: 'hsl(35,90%,75%)', lineHeight: 1.5,
            }}>
              <Pencil size={14} color="hsl(35,95%,60%)" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Polygone éditable</strong>
                Drag les <strong>coins orange</strong> pour recaler · tap les <strong>midpoints</strong> pour ajouter un coin · <strong>long-press</strong> sur un coin pour le supprimer
              </div>
              <button
                onClick={() => {
                  // Reset au polygone cadastral original
                  if (!mapRef.current || !selected?.buildingGeojson) return;
                  if (buildingPolygonRef.current) {
                    buildingPolygonRef.current.setMap(null);
                    buildingPolygonRef.current = null;
                  }
                  const paths = extractGoogleMapsPaths(selected.buildingGeojson);
                  if (paths.length && mapRef.current) {
                    const poly = new google.maps.Polygon({
                      paths: paths[0], map: mapRef.current,
                      strokeColor: '#f59e0b', strokeWeight: 3,
                      fillColor: '#f59e0b', fillOpacity: 0.30,
                      clickable: true, editable: true, draggable: true, zIndex: 10,
                    });
                    buildingPolygonRef.current = poly;
                    poly.addListener('rightclick', (e: google.maps.PolyMouseEvent) => {
                      if (typeof e.vertex !== 'number') return;
                      const path = poly.getPath();
                      if (path.getLength() <= 3) { toast.warning('Minimum 3 coins'); return; }
                      path.removeAt(e.vertex);
                    });
                  }
                  toast.info('Polygone réinitialisé au cadastral');
                }}
                title="Annuler les modifs et revenir au polygone cadastral original"
                disabled={freezing}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px', fontSize: 10, fontFamily: 'monospace',
                  background: 'transparent', color: 'hsl(35,90%,75%)',
                  border: '1px solid hsl(35,80%,40%)', borderRadius: 4,
                  cursor: 'pointer', flexShrink: 0,
                }}>
                <RotateCcw size={11} /> Reset
              </button>
            </div>
          )}
          {/* Dropdown 'Mode IA' supprimé 2026-06-05 — le mode est désormais
              forcé à 'adaptive' (typology-driven, auto). L'opérateur n'a plus
              à deviner le bon cap : la pipeline regarde le graphe de relations
              du bâtiment et choisit elle-même entre 1 (simple) et 5 (cross). */}
          <button
            onClick={handleFreezeAndPredict}
            disabled={freezing}
            className="vb-btn vb-btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontSize: 14, fontWeight: 700 }}
          >
            {freezing
              ? (<><Loader2 size={14} className="animate-spin" /> En cours…</>)
              : (<><Sparkles size={14} /> Geler la vue + Lancer IA</>)}
          </button>
        </div>
      )}
    </div>
  );
}

/** Convertit un GeoJSON Polygon/MultiPolygon en paths Google Maps. */
function extractGoogleMapsPaths(geo: any): google.maps.LatLngLiteral[][] {
  if (!geo) return [];
  const g = typeof geo === 'string' ? JSON.parse(geo) : geo;
  let rings: number[][][] = [];
  if (g.type === 'Polygon') rings = g.coordinates;
  else if (g.type === 'MultiPolygon') {
    rings = [];
    (g.coordinates || []).forEach((poly: number[][][]) => rings.push(...poly));
  }
  return rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
}
