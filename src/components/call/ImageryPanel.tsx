import React, { useEffect, useState } from 'react';
import { Map as MapIcon, Home, ImageOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const KEY = (import.meta.env as any).VITE_GOOGLE_MAPS_API_KEY || '';

// Parse un GeoJSON string (Polygon | MultiPolygon) en anneaux de [lng,lat].
function parseRings(geojsonStr: string | null): number[][][] {
  if (!geojsonStr) return [];
  try {
    const p = JSON.parse(geojsonStr);
    if (p.type === 'Polygon') return p.coordinates as number[][][];
    if (p.type === 'MultiPolygon') {
      const rings: number[][][] = [];
      (p.coordinates as number[][][][]).forEach((poly) => rings.push(...poly));
      return rings;
    }
  } catch { /* ignore */ }
  return [];
}

// Décime un anneau trop dense pour garder l'URL Static Maps courte.
function decimate(ring: number[][], maxN: number): number[][] {
  if (ring.length <= maxN) return ring;
  const step = Math.ceil(ring.length / maxN);
  const out: number[][] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  out.push(ring[0]); // referme
  return out;
}

// Construit le paramètre `path` (contour jaune) à partir de l'anneau extérieur.
function buildContourPath(geojsonStr: string | null): string | null {
  const rings = parseRings(geojsonStr);
  if (!rings.length) return null;
  const ext = decimate(rings[0], 60);
  if (!ext || ext.length < 3) return null;
  const coords = ext.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join('|');
  return `color:0xffff00ff|weight:3|fillcolor:0xffff0022|${coords}`;
}

const aerialUrl = (lat: number, lng: number, contour: string | null) =>
  `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x400&maptype=satellite` +
  (contour ? `&path=${encodeURIComponent(contour)}` : '') +
  `&key=${KEY}`;

const facadeUrl = (lat: number, lng: number) =>
  `https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${lat},${lng}&fov=80&pitch=8&source=outdoor&key=${KEY}`;

const Empty: React.FC<{ msg: string; url?: string }> = ({ msg, url }) => (
  <div className="w-full h-full flex flex-col items-center justify-center text-[hsl(230,10%,45%)] text-sm gap-1.5 p-6 text-center">
    <ImageOff className="h-5 w-5 opacity-60" />
    {msg}
    {url && (
      <a href={url} target="_blank" rel="noreferrer" className="text-[hsl(250,80%,75%)] underline text-xs">
        Ouvrir l'image directement ↗ (montre l'erreur Google exacte)
      </a>
    )}
  </div>
);

const Tab: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({
  active,
  onClick,
  icon,
  label,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-2.5 py-1 rounded-md text-xs inline-flex items-center gap-1.5 ${
      active ? 'bg-[hsl(250,60%,22%)] text-[hsl(250,80%,82%)]' : 'text-[hsl(230,10%,60%)] hover:bg-[hsl(230,20%,14%)]'
    }`}
  >
    {icon} {label}
  </button>
);

export const ImageryPanel: React.FC<{ lat: number | null; lng: number | null; address: string | null }> = ({
  lat,
  lng,
  address,
}) => {
  const [view, setView] = useState<'aerial' | 'facade'>('aerial');
  const [errAerial, setErrAerial] = useState(false);
  const [errFacade, setErrFacade] = useState(false);
  const [contour, setContour] = useState<string | null>(null);

  // Récupère le contour du bâtiment (RPC publique find_building_polygon).
  useEffect(() => {
    let cancelled = false;
    setContour(null);
    setErrAerial(false);
    setErrFacade(false);
    if (lat == null || lng == null) return;
    (async () => {
      try {
        const { data } = await supabase.rpc('find_building_polygon', {
          p_lat: lat,
          p_lng: lng,
          p_radius_meters: 60,
        } as any);
        const row: any = Array.isArray(data) && data.length ? data[0] : null;
        if (!cancelled && row) setContour(buildContourPath(row.geojson || null));
      } catch { /* contour optionnel */ }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);

  const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="rounded-xl border border-[hsl(230,20%,16%)] bg-[hsl(230,22%,10%)] overflow-hidden">
      <div className="flex items-center gap-1 p-1.5 border-b border-[hsl(230,20%,14%)]">
        <Tab active={view === 'aerial'} onClick={() => setView('aerial')} icon={<MapIcon className="h-3.5 w-3.5" />} label="Vue aérienne" />
        <Tab active={view === 'facade'} onClick={() => setView('facade')} icon={<Home className="h-3.5 w-3.5" />} label="Vue façade" />
        {address && <div className="ml-auto pr-2 text-[10px] text-[hsl(230,10%,40%)] truncate max-w-[45%]">{address}</div>}
      </div>
      <div className="relative bg-black aspect-[16/10]">{children}</div>
    </div>
  );

  if (lat == null || lng == null) return <Frame><Empty msg="Coordonnées indisponibles pour cette propriété." /></Frame>;
  if (!KEY) return <Frame><Empty msg="Clé Google absente (VITE_GOOGLE_MAPS_API_KEY)." /></Frame>;

  return (
    <Frame>
      {view === 'aerial' ? (
        errAerial ? (
          <Empty msg="Image satellite indisponible." url={aerialUrl(lat, lng, contour)} />
        ) : (
          <>
            <img src={aerialUrl(lat, lng, contour)} alt="Vue aérienne" loading="lazy" referrerPolicy="no-referrer" onError={() => setErrAerial(true)} className="w-full h-full object-cover" />
            <span className="absolute top-2 right-2 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">N ↑</span>
            <span className="absolute bottom-2 left-2 text-[10px] bg-black/60 text-[hsl(230,10%,75%)] px-1.5 py-0.5 rounded">
              Google satellite{contour ? ' · contour bâtiment' : ''}
            </span>
          </>
        )
      ) : errFacade ? (
        <Empty msg="Street View indisponible à cette adresse." url={facadeUrl(lat, lng)} />
      ) : (
        <>
          <img src={facadeUrl(lat, lng)} alt="Vue façade" loading="lazy" referrerPolicy="no-referrer" onError={() => setErrFacade(true)} className="w-full h-full object-cover" />
          <span className="absolute bottom-2 left-2 text-[10px] bg-black/60 text-[hsl(230,10%,75%)] px-1.5 py-0.5 rounded">Google Street View</span>
        </>
      )}
    </Frame>
  );
};
