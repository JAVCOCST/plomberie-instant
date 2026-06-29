import React, { useState } from 'react';
import { CloudSun, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { WeatherScene } from '@/components/weather/WeatherScene';

/**
 * Weather Radar — embeds Windy.com interactive radar map.
 * Free embed, no API key required. Centered on Montréal by default.
 */
type Layer = 'rain' | 'wind' | 'temp' | 'clouds' | 'thunder';

// Modèles Windy (paramètre `product`). Radar = observation ; les autres = prévision.
const MODELS: { id: string; label: string; title: string }[] = [
  { id: 'radar', label: 'Radar', title: 'Observation radar — précipitations réelles (0–2 h)' },
  { id: 'ecmwf', label: 'ECMWF', title: 'Européen — meilleur modèle global, ~9 km, jusqu’à 10 j' },
  { id: 'gfs', label: 'GFS', title: 'NOAA (US) — global gratuit, ~22 km, 10–16 j' },
  { id: 'icon', label: 'ICON', title: 'DWD (Allemagne) — global, ~13 km' },
  { id: 'namConus', label: 'NAM', title: 'NOAA — régional Amérique du Nord, ~5 km, ~2,5 j' },
  { id: 'hrrr', label: 'HRRR', title: 'NOAA — haute résolution 3 km, court terme (18–48 h)' },
];

const AdminWeatherRadar: React.FC = () => {
  const [layer, setLayer] = useState<Layer>('rain');
  const [model, setModel] = useState<string>('radar');
  const [view, setView] = useState<'radar' | 'scene'>('scene');
  const [dateStr, setDateStr] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  });
  // Windy `calendar` accepts a unix timestamp (seconds) or 'now'.
  const calendarParam = (() => {
    const t = new Date(dateStr).getTime();
    if (Number.isFinite(t)) return Math.floor(t / 1000).toString();
    return 'now';
  })();
  const shiftHours = (delta: number) => {
    const t = new Date(dateStr).getTime();
    if (!Number.isFinite(t)) return;
    const d = new Date(t + delta * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    setDateStr(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
  };
  // Slider: offset in hours from "now", range -120h (5 days back) to +240h (10 days ahead)
  const nowMs = Date.now();
  const offsetHours = Math.round((new Date(dateStr).getTime() - nowMs) / 3600000);
  const setOffsetHours = (h: number) => {
    const d = new Date(nowMs + h * 3600000);
    const pad = (n: number) => String(n).padStart(2, '0');
    setDateStr(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
  };
  const src = `https://embed.windy.com/embed2.html?lat=45.50&lon=-73.57&zoom=8&level=surface&overlay=${layer}&product=${model}&menu=&message=&marker=true&calendar=${calendarParam}&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`;
  return (
    <div className="flex flex-col h-[calc(100dvh-44px)]">
      <div
        className="flex items-center gap-2 px-3 py-2.5 shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid hsl(230,20%,16%)', background: 'hsl(230,22%,7%)' }}
      >
        <CloudSun className="h-4 w-4" style={{ color: 'hsl(250,80%,75%)' }} />
        <h2 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>
          Carte radar — Windy
        </h2>
        <div className="inline-flex rounded-md overflow-hidden" style={{ border: '1px solid hsl(230,20%,16%)' }}>
          {(['radar', 'scene'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className="px-3 py-2 min-h-[40px] text-[11px] font-semibold"
              style={{ background: view === v ? 'rgba(99,102,241,0.25)' : 'transparent', color: view === v ? '#c7d2fe' : '#9ca3af' }}>
              {v === 'radar' ? 'Radar' : 'Scène'}
            </button>
          ))}
        </div>
        {view === 'radar' && (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            title="Modèle de prévision"
            className="text-[11px] rounded-md px-2 py-2 min-h-[40px] font-semibold"
            style={{ background: 'hsl(230,22%,10%)', color: '#c7d2fe', border: '1px solid hsl(230,20%,16%)', colorScheme: 'dark' }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id} title={m.title}>{m.label}</option>
            ))}
          </select>
        )}
        {view === 'radar' && (<>
        <div className="ml-auto flex items-center gap-1">
          {(['rain', 'wind', 'temp', 'clouds', 'thunder'] as Layer[]).map(l => (
            <button
              key={l}
              type="button"
              onClick={() => setLayer(l)}
              className="px-3 py-2 min-h-[40px] text-[11px] rounded-md font-semibold transition-colors"
              style={{
                background: layer === l ? 'rgba(99,102,241,0.25)' : 'transparent',
                color: layer === l ? '#c7d2fe' : '#9ca3af',
                border: '1px solid hsl(230,20%,16%)',
              }}
            >
              {l === 'rain' ? 'Pluie' : l === 'wind' ? 'Vent' : l === 'temp' ? 'Temp.' : l === 'clouds' ? 'Nuages' : 'Orages'}
            </button>
          ))}
          <label
            className="ml-2 inline-flex items-center gap-1 px-3 py-2 min-h-[40px] text-[11px] rounded-md font-semibold"
            style={{ background: 'rgba(99,102,241,0.18)', color: '#c7d2fe', border: '1px solid rgba(99,102,241,0.3)' }}
          >
            <CalendarIcon className="h-3 w-3" />
            <input
              type="datetime-local"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="bg-transparent outline-none text-[11px]"
              style={{ color: '#c7d2fe', colorScheme: 'dark' }}
            />
          </label>
          <div className="inline-flex items-center rounded-md overflow-hidden" style={{ border: '1px solid hsl(230,20%,16%)' }}>
            <button
              type="button"
              onClick={() => shiftHours(-1)}
              title="Reculer 1 h"
              className="px-3 py-2 min-w-[40px] min-h-[40px] text-[11px] font-semibold flex items-center justify-center"
              style={{ background: 'transparent', color: '#c7d2fe' }}
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => shiftHours(1)}
              title="Avancer 1 h"
              className="px-3 py-2 min-w-[40px] min-h-[40px] text-[11px] font-semibold flex items-center justify-center"
              style={{ background: 'transparent', color: '#c7d2fe', borderLeft: '1px solid hsl(230,20%,16%)' }}
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              const pad = (n: number) => String(n).padStart(2, '0');
              setDateStr(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
            }}
            className="px-3 py-2 min-h-[40px] text-[11px] rounded-md font-semibold"
            style={{ background: 'transparent', color: '#9ca3af', border: '1px solid hsl(230,20%,16%)' }}
          >
            Maintenant
          </button>
        </div>
        {/* Scrub wheel: -5 jours → +10 jours */}
        <div className="w-full flex items-center gap-3 mt-2">
          <span className="text-[11px] font-semibold" style={{ color: '#6b7280' }}>-5 j</span>
          <input
            type="range"
            min={-120}
            max={240}
            step={1}
            value={Math.max(-120, Math.min(240, offsetHours))}
            onChange={(e) => setOffsetHours(parseInt(e.target.value, 10))}
            className="flex-1 weather-scrub"
            style={{ colorScheme: 'dark' }}
            aria-label="Décalage temporel"
          />
          <span className="text-[11px] font-semibold tabular-nums" style={{ color: '#c7d2fe', minWidth: 48, textAlign: 'right' }}>
            {offsetHours >= 0 ? `+${offsetHours} h` : `${offsetHours} h`}
          </span>
          <span className="text-[11px] font-semibold" style={{ color: '#6b7280' }}>+10 j</span>
        </div>
        </>)}
        <style>{`
          input.weather-scrub { -webkit-appearance: none; appearance: none; height: 22px; background: transparent; cursor: pointer; }
          input.weather-scrub::-webkit-slider-runnable-track { height: 14px; border-radius: 9999px; background: linear-gradient(90deg, rgba(99,102,241,0.45), rgba(99,102,241,0.15)); border: 1px solid rgba(99,102,241,0.35); }
          input.weather-scrub::-moz-range-track { height: 14px; border-radius: 9999px; background: linear-gradient(90deg, rgba(99,102,241,0.45), rgba(99,102,241,0.15)); border: 1px solid rgba(99,102,241,0.35); }
          input.weather-scrub::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 28px; height: 28px; border-radius: 50%; background: #c7d2fe; border: 2px solid #6366f1; margin-top: -8px; box-shadow: 0 2px 8px rgba(99,102,241,0.5); }
          input.weather-scrub::-moz-range-thumb { width: 28px; height: 28px; border-radius: 50%; background: #c7d2fe; border: 2px solid #6366f1; box-shadow: 0 2px 8px rgba(99,102,241,0.5); }
        `}</style>
      </div>
      <div className={`flex-1 min-h-0 overflow-hidden ${view === 'radar' ? 'pb-[calc(88px+env(safe-area-inset-bottom))] sm:pb-0' : ''}`}>
        {view === 'radar' ? (
          <div className="relative w-full h-full">
            <iframe
              key={`${model}-${layer}-${calendarParam}`}
              title="Windy Radar"
              src={src}
              className="w-full h-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              allow="geolocation"
            />
          </div>
        ) : (
          <WeatherScene />
        )}
      </div>
    </div>
  );
};

export default AdminWeatherRadar;