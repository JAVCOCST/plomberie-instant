import { useEffect, useState } from "react";
import {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain,
  CloudSnow, CloudLightning, Loader2, Droplets, Wind,
} from "lucide-react";
import { iso, DAYS } from "../lib/time";

// Granby, QC
const LAT = 45.4001;
const LON = -72.7333;

// Code WMO -> icône lucide + libellé
function wmo(code) {
  if (code === 0) return { Icon: Sun, label: "Ensoleillé" };
  if (code <= 2) return { Icon: CloudSun, label: "Partiellement nuageux" };
  if (code === 3) return { Icon: Cloud, label: "Nuageux" };
  if (code >= 45 && code <= 48) return { Icon: CloudFog, label: "Brouillard" };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, label: "Bruine" };
  if (code >= 61 && code <= 67) return { Icon: CloudRain, label: "Pluie" };
  if (code >= 71 && code <= 77) return { Icon: CloudSnow, label: "Neige" };
  if (code >= 80 && code <= 82) return { Icon: CloudRain, label: "Averses" };
  if (code >= 85 && code <= 86) return { Icon: CloudSnow, label: "Averses de neige" };
  if (code >= 95) return { Icon: CloudLightning, label: "Orage" };
  return { Icon: Cloud, label: "—" };
}

export default function WeatherStrip({ weekDays }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const startISO = weekDays[0] ? iso(weekDays[0]) : "";
  const endISO = weekDays[6] ? iso(weekDays[6]) : "";

  useEffect(() => {
    if (!startISO || !endISO) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
      `&timezone=America%2FMontreal&start_date=${startISO}&end_date=${endISO}`;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => {
        if (cancelled) return;
        const days = (j.daily?.time ?? []).map((t, i) => ({
          date: t,
          code: j.daily.weather_code[i],
          tMax: Math.round(j.daily.temperature_2m_max[i]),
          tMin: Math.round(j.daily.temperature_2m_min[i]),
          precip: j.daily.precipitation_sum[i] ?? 0,
          wind: Math.round(j.daily.wind_speed_10m_max[i] ?? 0),
        }));
        setData(days);
      })
      .catch((e) => { if (!cancelled) setError(e.message || "Erreur météo"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startISO, endISO]);

  return (
    <div className="weather">
      <div className="weather-head">
        <span className="weather-title">
          <CloudSun size={15} /> Météo de la semaine — Granby
        </span>
        {loading && <Loader2 size={14} className="spin" />}
        {error && <span className="weather-err">{error}</span>}
      </div>
      <div className="weather-grid">
        {weekDays.map((day, i) => {
          const f = data?.find((d) => d.date === iso(day));
          const { Icon, label } = f ? wmo(f.code) : { Icon: Cloud, label: "" };
          const warn = f && (f.precip >= 5 || f.wind >= 40);
          return (
            <div
              key={i}
              className={`weather-day ${warn ? "warn" : ""}`}
              title={f ? `${label} — Pluie ${f.precip} mm — Vent ${f.wind} km/h` : ""}
            >
              <span className="w-day">{DAYS[i]} {new Date(day).getDate()}</span>
              <Icon size={22} className="w-icon" />
              {f ? (
                <>
                  <span className="w-temp">
                    {f.tMax}° <span className="w-tmin">/ {f.tMin}°</span>
                  </span>
                  <span className="w-extra">
                    {f.precip > 0 && <span className="w-rain"><Droplets size={11} /> {f.precip}mm</span>}
                    {f.wind >= 25 && <span className="w-wind"><Wind size={11} /> {f.wind}</span>}
                  </span>
                </>
              ) : (
                <span className="w-temp">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
