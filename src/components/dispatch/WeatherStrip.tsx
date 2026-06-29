/**
 * WeatherStrip — Compact 7-day weather forecast aligned with dispatch week.
 * Uses Open-Meteo (free, no API key). Default location: Montréal.
 */
import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CloudSun, Loader2 } from 'lucide-react';

interface Props {
  weekDays: Date[];
  /** Latitude (default Montréal) */
  lat?: number;
  /** Longitude (default Montréal) */
  lon?: number;
}

interface DayForecast {
  date: string;
  tMax: number;
  tMin: number;
  precip: number; // mm
  windMax: number; // km/h
  code: number;
}

// WMO weather code → emoji + label (FR)
const wmoToEmoji = (code: number): { emoji: string; label: string } => {
  if (code === 0) return { emoji: '☀️', label: 'Ensoleillé' };
  if (code <= 2) return { emoji: '🌤️', label: 'Partiellement nuageux' };
  if (code === 3) return { emoji: '☁️', label: 'Nuageux' };
  if (code >= 45 && code <= 48) return { emoji: '🌫️', label: 'Brouillard' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', label: 'Bruine' };
  if (code >= 61 && code <= 67) return { emoji: '🌧️', label: 'Pluie' };
  if (code >= 71 && code <= 77) return { emoji: '❄️', label: 'Neige' };
  if (code >= 80 && code <= 82) return { emoji: '🌧️', label: 'Averses' };
  if (code >= 85 && code <= 86) return { emoji: '🌨️', label: 'Averses de neige' };
  if (code >= 95) return { emoji: '⛈️', label: 'Orage' };
  return { emoji: '🌥️', label: '—' };
};

export const WeatherStrip: React.FC<Props> = ({ weekDays, lat = 45.5017, lon = -73.5673 }) => {
  const [data, setData] = useState<DayForecast[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startISO = weekDays[0] ? format(weekDays[0], 'yyyy-MM-dd') : '';
  const endISO = weekDays[6] ? format(weekDays[6], 'yyyy-MM-dd') : '';

  useEffect(() => {
    if (!startISO || !endISO) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max`
      + `&timezone=America%2FMontreal&start_date=${startISO}&end_date=${endISO}`;
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(j => {
        if (cancelled) return;
        const days: DayForecast[] = (j.daily?.time ?? []).map((t: string, i: number) => ({
          date: t,
          code: j.daily.weather_code[i],
          tMax: Math.round(j.daily.temperature_2m_max[i]),
          tMin: Math.round(j.daily.temperature_2m_min[i]),
          precip: j.daily.precipitation_sum[i] ?? 0,
          windMax: Math.round(j.daily.wind_speed_10m_max[i] ?? 0),
        }));
        setData(days);
      })
      .catch(e => { if (!cancelled) setError(e.message || 'Erreur météo'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startISO, endISO, lat, lon]);

  return (
    <div className="mb-3 rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <CloudSun className="h-3.5 w-3.5 text-primary" />
          Météo de la semaine — Montréal
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day, i) => {
          const iso = format(day, 'yyyy-MM-dd');
          const f = data?.find(d => d.date === iso);
          const meta = f ? wmoToEmoji(f.code) : null;
          const heavyRain = f && f.precip >= 5;
          const highWind = f && f.windMax >= 40;
          const warn = heavyRain || highWind;
          return (
            <div
              key={iso}
              title={f ? `${meta?.label} — Pluie ${f.precip}mm — Vent ${f.windMax} km/h` : ''}
              className={`flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-center transition-colors ${
                warn ? 'bg-destructive/10 border border-destructive/30' : 'bg-muted/30'
              }`}
            >
              <div className="text-[9px] font-semibold uppercase text-muted-foreground">
                {format(day, 'EEE d', { locale: fr })}
              </div>
              <div className="text-base leading-none sm:text-lg">{meta?.emoji ?? '—'}</div>
              {f ? (
                <>
                  <div className="text-[10px] font-bold text-foreground">
                    {f.tMax}° <span className="text-muted-foreground font-normal">/ {f.tMin}°</span>
                  </div>
                  <div className="flex flex-col items-center gap-0 text-[9px] leading-tight">
                    {f.precip > 0 && <span className="text-blue-400">💧 {f.precip}mm</span>}
                    {f.windMax >= 25 && <span className="text-amber-400">💨 {f.windMax}</span>}
                  </div>
                </>
              ) : (
                <div className="text-[9px] text-muted-foreground">—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WeatherStrip;