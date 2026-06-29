import React, { useEffect, useRef, useState } from 'react';
import { Cloud, CloudRain, CloudSnow, CloudLightning, Sun as SunIcon, MapPin, Radio, Hand } from 'lucide-react';

/**
 * Scène météo toiture TOITURES VB — moteur dynamique (calques séparés, mascotte Roger).
 * Toit + Roger + arbres = scène fixe ; ciel/soleil/lune/nuages/brouillard/pluie bougent.
 * Réalisme runtime : grade unifié par condition, ombre de contact, light-wrap, brume
 * d'horizon, vignette, grain. Slider/glisser au doigt = heures réelles (Open-Meteo).
 */

const LAT = 45.4, LON = -72.73, TZ = 'America/Toronto', CITY = 'Granby';
const DAYS = 3;
const PX_PER_HOUR = 20;
const CANVAS_RATIO = 1320 / 2868;

// ── Assets (glob → url) ──
const A = import.meta.glob('../../assets/scene/wvb/**/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const asset = (cat: string, id: string) => {
  const hit = Object.entries(A).find(([p]) => p.endsWith(`/${cat}/${id}.webp`));
  return hit ? hit[1] : '';
};
const FAIR_CLOUD_IDS = ['CLOUD_01', 'CLOUD_02', 'CLOUD_04', 'CLOUD_05', 'CLOUD_06']; // cumulus blancs (beau temps)
const RAIN_CLOUD_IDS = ['CLOUD_STORM_02', 'CLOUD_STORM_03', 'CLOUD_06', 'CLOUD_05']; // plus gris (pluie)
const STORM_CLOUD_IDS = ['CLOUD_STORM_01', 'CLOUD_STORM_02', 'CLOUD_STORM_03'];

interface HourData { day: number; hour: number; temp: number; cloud: number; precip: number; precipProb: number; snow: number; code: number; wind: number; }

function mockHours(): HourData[] {
  const out: HourData[] = [];
  for (let d = 0; d < DAYS; d++) for (let h = 0; h < 24; h++) {
    const rain = h >= 14 && h <= 19 && d !== 1;
    out.push({ day: d, hour: h, temp: Math.round(15 + 8 * Math.sin(((h - 7) / 24) * Math.PI * 2) + (rain ? -3 : 0)),
      cloud: rain ? 85 : h < 6 || h > 20 ? 35 : 45, precip: rain ? 1.6 : 0, precipProb: rain ? 70 : 10,
      snow: 0, code: rain ? 63 : h < 6 || h > 20 ? 1 : 2, wind: 12 });
  }
  return out;
}

async function fetchHours(): Promise<{ hours: HourData[]; sunrise: number; sunset: number }> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&hourly=temperature_2m,precipitation,precipitation_probability,cloud_cover,weather_code,wind_speed_10m,snowfall` +
    `&daily=sunrise,sunset&timezone=${encodeURIComponent(TZ)}&forecast_days=${DAYS}`;
  const r = await fetch(url); if (!r.ok) throw new Error('open-meteo ' + r.status);
  const j = await r.json(); const H = j.hourly;
  const hours: HourData[] = (H.time as string[]).slice(0, DAYS * 24).map((t, i) => ({
    day: Math.floor(i / 24), hour: new Date(t).getHours(), temp: Math.round(H.temperature_2m[i]),
    cloud: H.cloud_cover[i] ?? 0, precip: H.precipitation[i] ?? 0, precipProb: H.precipitation_probability?.[i] ?? 0,
    snow: H.snowfall?.[i] ?? 0, code: H.weather_code[i] ?? 0, wind: Math.round(H.wind_speed_10m[i] ?? 0),
  }));
  const hm = (s: string) => { const d = new Date(s); return d.getHours() + d.getMinutes() / 60; };
  return { hours, sunrise: hm(j.daily.sunrise[0]), sunset: hm(j.daily.sunset[0]) };
}

const dayDate = (day: number) => { const d = new Date(); d.setDate(d.getDate() + day); return d; };
function dayLabel(day: number): { wd: string; dm: string } {
  const d = dayDate(day);
  return { wd: day === 0 ? 'Auj.' : d.toLocaleDateString('fr-CA', { weekday: 'short' }), dm: d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }) };
}

function wmo(code: number): { label: string; Icon: React.ComponentType<{ className?: string }> } {
  if (code === 0) return { label: 'Dégagé', Icon: SunIcon };
  if (code <= 2) return { label: 'Éclaircies', Icon: Cloud };
  if (code === 3) return { label: 'Couvert', Icon: Cloud };
  if (code === 45 || code === 48) return { label: 'Brouillard', Icon: Cloud };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Neige', Icon: CloudSnow };
  if (code >= 95) return { label: 'Orages', Icon: CloudLightning };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Pluie', Icon: CloudRain };
  return { label: '—', Icon: Cloud };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ── TEMPORAIRE : sélecteur de scènes pour validation. Mettre false pour masquer. ──
const DEMO_ENABLED = false;
interface DemoPreset { label: string; h: number; code: number; cloud: number; temp: number; precip?: number; snow?: number; }
const demoPresets = (sr: number, ss: number): DemoPreset[] => [
  { label: '☀️ Dégagé', h: 13, code: 0, cloud: 6, temp: 24 },
  { label: '⛅ Partiel', h: 13, code: 2, cloud: 38, temp: 22 },
  { label: '☁️ Couvert', h: 13, code: 3, cloud: 96, temp: 18 },
  { label: '🌅 Aube (golden)', h: sr + 0.4, code: 0, cloud: 12, temp: 15 },
  { label: '🌇 Coucher', h: ss - 0.25, code: 0, cloud: 14, temp: 20 },
  { label: '🌙 Nuit claire', h: 1, code: 0, cloud: 8, temp: 12 },
  { label: '🪟 Nuit (lampes 22h)', h: 22, code: 0, cloud: 10, temp: 14 },
  { label: '🌧️ Pluie', h: 15, code: 63, cloud: 92, temp: 14, precip: 2 },
  { label: '⛈️ Orage', h: 16, code: 95, cloud: 100, temp: 17, precip: 6 },
  { label: '❄️ Neige', h: 14, code: 73, cloud: 95, temp: -2, snow: 3 },
  { label: '🌫️ Brouillard', h: 8, code: 45, cloud: 92, temp: 9 },
  { label: '🥵 Canicule', h: 13, code: 0, cloud: 4, temp: 31 },
];

interface Light { dayW: number; goldenW: number; nightW: number; sunFrac: number; sunUp: boolean; nightProg: number; }
function computeLight(t: number, sr: number, ss: number): Light {
  const gh = 2.2;
  const goldenW = clamp01(Math.max(1 - Math.abs(t - sr) / gh, 1 - Math.abs(t - ss) / gh));
  const dayW = (t > sr && t < ss) ? clamp01(Math.min(t - sr, ss - t) / gh) : 0;
  const nightW = (t < sr || t > ss) ? clamp01(Math.max(sr - t, t - ss) / 0.9) : 0;
  const sunFrac = (t - sr) / (ss - sr);
  const nightLen = (24 - ss) + sr;
  const nightProg = t >= ss ? (t - ss) / nightLen : t <= sr ? ((24 - ss) + t) / nightLen : 0;
  return { dayW, goldenW, nightW, sunFrac, sunUp: t >= sr && t <= ss, nightProg };
}

type Mood = 'day' | 'golden' | 'sunset' | 'night' | 'overcast' | 'storm' | 'fog' | 'hot';
interface MoodDef { filter: string; overlay: string; blend: React.CSSProperties['mixBlendMode']; wrap: string; shadow: number; vig: number; haze: string; }
const MOODS: Record<Mood, MoodDef> = {
  day:      { filter: 'brightness(1.03) contrast(1.06) saturate(1.07)', overlay: 'rgba(255,240,210,0.12)', blend: 'soft-light', wrap: 'rgba(160,200,238,0.85)', shadow: 0.34, vig: 0.18, haze: 'rgba(196,222,245,0.16)' },
  golden:   { filter: 'brightness(1.02) contrast(1.05) saturate(1.28)', overlay: 'rgba(255,150,48,0.40)',  blend: 'soft-light', wrap: 'rgba(255,196,128,0.85)', shadow: 0.30, vig: 0.22, haze: 'rgba(255,200,140,0.26)' },
  sunset:   { filter: 'brightness(1.0) contrast(1.06) saturate(1.32)',  overlay: 'rgba(255,104,60,0.44)',  blend: 'soft-light', wrap: 'rgba(255,150,110,0.85)', shadow: 0.30, vig: 0.24, haze: 'rgba(255,160,120,0.26)' },
  night:    { filter: 'brightness(0.9) contrast(1.05) saturate(0.85)',  overlay: 'rgba(28,42,92,0.34)',    blend: 'soft-light', wrap: 'rgba(60,80,150,0.85)',   shadow: 0.18, vig: 0.42, haze: 'rgba(22,32,72,0.22)' },
  overcast: { filter: 'brightness(0.95) contrast(0.95) saturate(0.72)', overlay: 'rgba(150,160,175,0.22)', blend: 'soft-light', wrap: 'rgba(160,170,185,0.85)', shadow: 0.12, vig: 0.26, haze: 'rgba(170,178,188,0.26)' },
  storm:    { filter: 'brightness(0.8) contrast(1.08) saturate(0.62)',  overlay: 'rgba(48,55,72,0.36)',    blend: 'soft-light', wrap: 'rgba(96,104,124,0.85)', shadow: 0.12, vig: 0.44, haze: 'rgba(64,70,88,0.30)' },
  fog:      { filter: 'brightness(1.03) contrast(0.82) saturate(0.65)', overlay: 'rgba(205,210,214,0.16)', blend: 'screen',     wrap: 'rgba(214,218,224,0.85)', shadow: 0.08, vig: 0.18, haze: 'rgba(214,218,224,0.34)' },
  hot:      { filter: 'brightness(1.05) contrast(1.0) saturate(1.12)',  overlay: 'rgba(255,220,160,0.18)', blend: 'soft-light', wrap: 'rgba(255,225,180,0.85)', shadow: 0.32, vig: 0.18, haze: 'rgba(255,225,175,0.2)' },
}

interface Pick { sky: string; roof: string; roger: string; tree: string; mood: Mood; rain: boolean; snow: boolean; heavyPrecip: boolean; storm: boolean; fog: boolean; overcastOp: number; }
function pick(cur: HourData, L: Light, isNight: boolean): Pick {
  const c = cur.code, p = cur.precip, s = cur.snow, h = cur.hour;
  const storm = c >= 95;
  const snow = (c >= 71 && c <= 77) || c === 85 || c === 86 || s > 0;
  const rain = !snow && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || p > 0);
  const fog = c === 45 || c === 48;
  const overcast = c === 3 || cur.cloud > 80;
  const heavyPrecip = storm || c === 65 || c === 67 || c === 75 || c === 82 || c === 86 || p >= 4;

  let sky: string;
  if (storm) sky = 'SKY_STORM';
  else if (fog) sky = 'SKY_FOG';
  else if (isNight) sky = 'SKY_NIGHT';
  else if (L.goldenW > 0.5) sky = h < 12 ? 'SKY_GOLDEN' : 'SKY_SUNSET';
  else sky = 'SKY_DAY';
  // Voile « couvert » translucide superposé au ciel de base → transition fluide bleu↔gris.
  const overcastOp = (storm || fog || isNight) ? 0 : clamp01((cur.cloud - 18) / 72) * 0.85;

  let roof: string;
  if (snow) roof = 'ROOF_SNOW';
  else if (rain || storm) roof = 'ROOF_WET';
  else if (isNight) roof = (h === 22 || h === 23 || h === 4 || h === 5) ? 'ROOF_NIGHT_LIT' : 'ROOF_NIGHT';
  else if (L.goldenW > 0.5) roof = 'ROOF_GOLDEN';
  else roof = 'ROOF_DAY';

  let roger: string;
  if (rain) roger = 'ROGER_RAIN_HEAVY';   // parapluie dès qu'il pleut
  else if (snow) roger = 'ROGER_SNOW';
  else if (isNight) roger = 'ROGER_NIGHT';
  else if (c <= 1 && cur.cloud < 45 && cur.temp >= 16) roger = 'ROGER_HOT';   // plein soleil → camisole
  else roger = 'ROGER_DAY';

  let tree: string;
  if (snow) tree = 'TREE_SNOW';
  else if (rain || storm) tree = 'TREE_WET';
  else if (isNight) tree = (h === 22 || h === 23 || h === 4 || h === 5) ? 'TREE_NIGHT_LIT' : 'TREE_NIGHT';
  else if (L.goldenW > 0.5) tree = 'TREE_GOLDEN';
  else tree = 'TREE_DAY';

  let mood: Mood;
  if (storm) mood = 'storm'; else if (fog) mood = 'fog';
  else if (isNight) mood = 'night';
  else if (rain || snow || overcast) mood = 'overcast';
  else if (sky === 'SKY_GOLDEN') mood = 'golden';
  else if (sky === 'SKY_SUNSET') mood = 'sunset';
  else if (cur.temp >= 29) mood = 'hot';
  else mood = 'day';

  return { sky, roof, roger, tree, mood, rain, snow, heavyPrecip, storm, fog, overcastOp };
}

// ── Crossfade d'un calque pleine toile (cover) ──
const layerStyle: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', pointerEvents: 'none', userSelect: 'none' };
// Cross-fade propre : la nouvelle image apparaît en fondu PUIS l'ancienne est retirée
// (sinon, pour un calque transparent comme Roger, l'ancienne reste visible derrière → doublon).
const Cross: React.FC<{ src: string; alt?: string; extra?: React.CSSProperties; className?: string }> = ({ src, alt = '', extra, className }) => {
  const [layers, setLayers] = useState<{ src: string; k: number }[]>(() => [{ src, k: 0 }]);
  const kref = useRef(0);
  useEffect(() => {
    setLayers((prev) => (prev[prev.length - 1].src === src ? prev : [...prev, { src, k: ++kref.current }]));
    const t = setTimeout(() => setLayers((prev) => prev.slice(-1)), 800);
    return () => clearTimeout(t);
  }, [src]);
  return (<>{layers.map((l, i) => (
    <img key={l.k} src={l.src} alt={i === layers.length - 1 ? alt : ''} className={className}
      style={{ ...layerStyle, ...extra, animation: i > 0 ? 'ywxFade 750ms ease forwards' : undefined }} />
  ))}</>);
};

// ── Astres sur arc (soleil le jour, vraie lune le soir + la nuit) ──
const Celestial: React.FC<{ L: Light; isNight: boolean; eveningMoon: boolean; sunSprite: string; sunOpacity: number }> = ({ L, isNight, eveningMoon, sunSprite, sunOpacity }) => {
  const moonSrc = asset('moon', 'MOON_FULL');
  // Soleil (jour) — bas à l'horizon au coucher ; s'efface derrière les nuages / orage
  const sunNode = (!isNight && sunOpacity > 0.03 && L.sunUp && L.sunFrac > -0.03 && L.sunFrac < 1.03) ? (
    <img src={asset('sun', sunSprite)} alt="" style={{ position: 'absolute', left: `${6 + clamp01(L.sunFrac) * 88}%`, top: `${15 + (1 - Math.sin(clamp01(L.sunFrac) * Math.PI)) * 44}%`, width: '30%', transform: 'translate(-50%,-50%)', opacity: sunOpacity, pointerEvents: 'none', transition: 'opacity 500ms ease' }} />
  ) : null;
  // Lune : la nuit (arc) — et déjà levée le soir (ciel de coucher), côté opposé au soleil
  let moonNode: React.ReactNode = null;
  if (isNight) {
    const x = 6 + L.nightProg * 88, y = 13 + (1 - Math.sin(L.nightProg * Math.PI)) * 40;
    moonNode = <img src={moonSrc} alt="" style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: '34%', transform: 'translate(-50%,-50%)', opacity: Math.max(0.5, L.nightW), pointerEvents: 'none' }} />;
  } else if (eveningMoon) {
    moonNode = <img src={moonSrc} alt="" style={{ position: 'absolute', left: '24%', top: '17%', width: '28%', transform: 'translate(-50%,-50%)', opacity: clamp01(L.goldenW * 1.15), pointerEvents: 'none', transition: 'opacity 500ms ease' }} />;
  }
  return <>{moonNode}{sunNode}</>;
};

// ── Nuages : champ qui dérive de gauche à droite + se forme (fondu) à l'entrée et se dissipe à la sortie ──
const CLOUD_POOL = 9;
const rnd = (s: number) => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };

// Un nuage : la DIV dérive + fondu de formation (ywxCloudDrift) ; la densité (couverture) et le
// cross-fade de COULEUR (changement de régime) sont sur des couches internes.
const CloudSlot: React.FC<{ src: string; top: string; width: string; densOp: number; dur: number; delay: number; bright: number }> = ({ src, top, width, densOp, dur, delay, bright }) => {
  const [layers, setLayers] = useState<{ src: string; id: number }[]>([{ src, id: 0 }]);
  const idRef = useRef(0);
  useEffect(() => {
    setLayers((prev) => (prev[prev.length - 1].src === src ? prev : [...prev, { src, id: ++idRef.current }]));
    const t = setTimeout(() => setLayers((prev) => prev.slice(-1)), 900);
    return () => clearTimeout(t);
  }, [src]);
  return (
    <div className="ywx-cloud" style={{ top, width, animationDuration: `${dur}s`, animationDelay: `${delay}s`, willChange: 'transform, opacity' }}>
      <div style={{ opacity: densOp, transition: 'opacity 800ms ease' }}>
        {layers.map((l, i) => (
          <img key={l.id} src={l.src} alt="" style={{ position: i === 0 ? 'relative' : 'absolute', top: 0, left: 0, width: '100%', height: 'auto', filter: `brightness(${bright})`, animation: i > 0 ? 'ywxFade 850ms ease forwards' : undefined }} />
        ))}
      </div>
    </div>
  );
};

const Clouds: React.FC<{ regime: string; cover: number; nightW: number }> = ({ regime, cover, nightW }) => {
  // Aube / coucher clair : voiles chauds (cirrus) au lieu des cumulus blancs.
  if (regime === 'dawn' || regime === 'dusk') {
    const id = regime === 'dusk' ? 'CLOUD_DUSK' : 'CLOUD_DAWN';
    const b = 1 - nightW * 0.3;
    return (<>
      <img src={asset('clouds', id)} alt="" className="ywx-cloud-twi" style={{ top: '3%', opacity: 0.7, filter: `brightness(${b})`, animationDuration: '26s', animationDelay: '0s' }} />
      <img src={asset('clouds', id)} alt="" className="ywx-cloud-twi" style={{ top: '14%', opacity: 0.34, filter: `brightness(${b})`, animationDuration: '38s', animationDelay: '-16s' }} />
    </>);
  }
  const storm = regime === 'storm', rain = regime === 'rain';
  const ids = storm ? STORM_CLOUD_IDS : rain ? RAIN_CLOUD_IDS : FAIR_CLOUD_IDS;
  const bright = (storm ? 0.7 : rain ? 0.85 : 1) * (1 - nightW * 0.5);
  const low = rain || storm;                                  // pluie/orage → nuages plus bas
  const densOp = clamp01((cover - 8) / 55);                   // dégagé → ~0 ; couvert → 1 (densité douce)
  return (<>{Array.from({ length: CLOUD_POOL }).map((_, i) => {
    const top = (low ? 14 : 2) + rnd(i * 1.7 + 0.3) * (low ? 33 : 42);     // hauteurs réparties (pas en grille)
    const w = (storm ? 34 : 20) + rnd(i * 2.3 + 0.5) * 18;                 // tailles variées
    const dur = 70 + rnd(i * 3.1 + 0.7) * 45;                              // 70-115s, vitesses variées
    const delay = -(((i + 0.5) / CLOUD_POOL) + rnd(i * 5.3) * 0.05) * dur; // phases réparties → toujours étalés
    return <CloudSlot key={i} src={asset('clouds', ids[i % ids.length])} top={`${top}%`} width={`${w}%`} densOp={densOp} dur={dur} delay={delay} bright={bright} />;
  })}</>);
};

// Cross-fade seulement entre TYPES de nuages (cumulus ↔ cirrus aube/coucher). Dans le cumulus,
// les nuages restent montés (juste la couleur se fond) → ils n'apparaissent jamais dans la scène.
const cloudType = (r: string) => (r === 'dawn' || r === 'dusk') ? r : 'cumulus';
const CloudsFade: React.FC<{ regime: string; cover: number; nightW: number }> = ({ regime, cover, nightW }) => {
  const ct = cloudType(regime);
  const [layers, setLayers] = useState<{ k: string; regime: string; id: number }[]>([{ k: ct, regime, id: 0 }]);
  const idRef = useRef(0);
  useEffect(() => {
    setLayers((prev) => (prev[prev.length - 1].k === ct ? prev : [...prev, { k: ct, regime, id: ++idRef.current }]));
    const t = setTimeout(() => setLayers((prev) => prev.slice(-1)), 950);
    return () => clearTimeout(t);
  }, [ct, regime]);
  return (<>{layers.map((l, i) => {
    const isCur = i === layers.length - 1;
    return (
      <div key={l.id} className="absolute inset-0" style={{ pointerEvents: 'none', animation: i > 0 ? 'ywxFade 850ms ease forwards' : undefined }}>
        <Clouds regime={isCur ? regime : l.regime} cover={cover} nightW={nightW} />
      </div>
    );
  })}</>);
};

// ── Précipitation / brouillard / étoiles filantes ──
const Precip: React.FC<{ pick: Pick; intensity: number }> = ({ pick, intensity }) => {
  let src = '', dur = '1s', op = 0.5;
  if (pick.rain) { src = asset('precip', pick.heavyPrecip ? 'RAIN_HEAVY' : 'RAIN_LIGHT'); dur = pick.heavyPrecip ? '0.7s' : '1s'; op = 0.55; }
  else if (pick.snow) { src = asset('precip', pick.heavyPrecip ? 'SNOW_HEAVY' : 'SNOW_LIGHT'); dur = pick.heavyPrecip ? '4s' : '6.5s'; op = 0.85; }
  if (!src) return null;
  return (
    <div key={src} className="absolute inset-0 overflow-hidden pointer-events-none" style={{ animation: 'ywxFade 700ms ease forwards' }}>
      <div className="ywx-fall" style={{ animationDuration: dur, opacity: op * Math.min(1, 0.6 + intensity) }}>
        <img src={src} alt="" className="ywx-fall-tile" style={{ top: 0 }} />
        <img src={src} alt="" className="ywx-fall-tile" style={{ top: '-100%' }} />
      </div>
    </div>
  );
};

// ── Étoiles filantes : petites, en boucle constante, seulement sur le ciel de nuit ──
// Départs en haut/gauche → la filante descend vers le bas-droite (sens de la traînée).
const STAR_CFG = [
  { top: '3%', left: '16%', w: 8, dur: 4.2, delay: 0 },
  { top: '9%', left: '40%', w: 6.5, dur: 5.2, delay: 1.1 },
  { top: '2%', left: '58%', w: 7, dur: 3.7, delay: 2.3 },
  { top: '15%', left: '26%', w: 7.5, dur: 4.9, delay: 3.0 },
  { top: '7%', left: '50%', w: 6, dur: 5.7, delay: 0.6 },
  { top: '19%', left: '10%', w: 5.5, dur: 4.4, delay: 2.0 },
];
const ShootingStars: React.FC<{ on: boolean }> = ({ on }) => on ? (<>{STAR_CFG.map((s, i) => (
  <img key={i} src={asset('fx', 'SHOOTING_STAR_02')} alt="" className="ywx-star"
    style={{ top: s.top, left: s.left, width: `${s.w}%`, animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }} />
))}</>) : null;

const Fog: React.FC<{ on: boolean; dense: boolean; nightW: number }> = ({ on, dense, nightW }) => {
  if (!on) return null;
  const url = asset('fog', dense ? 'FOG_DENSE' : 'FOG_LIGHT');
  const op = (dense ? 0.95 : 0.7) * (1 - nightW * 0.4);
  // 2 nappes qui dérivent en avant-plan (vitesses différentes)
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ opacity: op }}>
      <div className="ywx-fog" style={{ backgroundImage: `url(${url})`, animationDuration: '55s' }} />
      <div className="ywx-fog" style={{ backgroundImage: `url(${url})`, animationDuration: '85s', animationDelay: '-30s', bottom: '-4%', opacity: 0.7 }} />
    </div>
  );
};

// Calque de canicule (chaleur) superposé devant tout.
const HeatHaze: React.FC = () => (
  <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(0deg, rgba(255,138,28,0.20), rgba(255,170,70,0.06) 38%, transparent 62%)', mixBlendMode: 'soft-light' }}>
    <div className="ywx-heat" />
  </div>
);

// Éclairs : flash plein écran + éclair (sprite) à intervalles aléatoires pendant l'orage.
const Lightning: React.FC<{ active: boolean }> = ({ active }) => {
  const [flash, setFlash] = useState(0);
  const [bolt, setBolt] = useState<{ x: number; show: boolean }>({ x: 50, show: false });
  useEffect(() => {
    if (!active) { setFlash(0); setBolt((b) => ({ ...b, show: false })); return; }
    let cancelled = false; const timers: number[] = [];
    const strike = () => {
      if (cancelled) return;
      setBolt({ x: 18 + Math.random() * 56, show: Math.random() < 0.72 });
      setFlash(0.95);
      timers.push(window.setTimeout(() => setFlash(0.18), 70));
      timers.push(window.setTimeout(() => setFlash(0.85), 150));
      timers.push(window.setTimeout(() => { setFlash(0); setBolt((b) => ({ ...b, show: false })); }, 360));
      timers.push(window.setTimeout(strike, 2600 + Math.random() * 6500));
    };
    timers.push(window.setTimeout(strike, 1000 + Math.random() * 2500));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [active]);
  if (!active) return null;
  return (<>
    {bolt.show && <img src={asset('fx', 'LIGHTNING')} alt="" style={{ position: 'absolute', left: `${bolt.x}%`, top: 0, height: '72%', transform: 'translateX(-50%)', opacity: flash > 0.5 ? 1 : 0, transition: 'opacity 50ms', pointerEvents: 'none' }} />}
    <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(214,226,255,0.92)', mixBlendMode: 'screen', opacity: flash, transition: 'opacity 80ms ease' }} />
  </>);
};

export const WeatherScene: React.FC = () => {
  const [hours, setHours] = useState<HourData[]>(mockHours());
  const [sun, setSun] = useState({ sunrise: 5.3, sunset: 20.6 });
  const [pos, setPos] = useState<number>(() => new Date().getHours());
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [touched, setTouched] = useState(false);
  const [demo, setDemo] = useState<number | null>(null);
  const [litPhase, setLitPhase] = useState(0);
  const [demoOpen, setDemoOpen] = useState(false);
  const posRef = useRef(pos); posRef.current = pos;
  const targetRef = useRef(pos);
  const rafRef = useRef(0);

  useEffect(() => {
    let c = false;
    fetchHours().then((d) => { if (!c) { setHours(d.hours); setSun({ sunrise: d.sunrise, sunset: d.sunset }); setUsingMock(false); setLoading(false); } })
      .catch(() => { if (!c) { setHours(mockHours()); setUsingMock(true); setLoading(false); } });
    return () => { c = true; };
  }, []);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const maxIdx = hours.length - 1;
  const clampPos = (v: number) => Math.max(0, Math.min(maxIdx, v));
  const idx = Math.round(clampPos(pos));
  const i0 = Math.floor(clampPos(pos));
  const frac = clamp01(clampPos(pos) - i0);
  const presets = demoPresets(sun.sunrise, sun.sunset);
  const dp = demo != null ? presets[demo] : null;
  // heure continue (fractionnaire) → éclairage/ciel/soleil glissent en douceur pendant le drag
  const effHour = dp ? dp.h : ((hours[i0] || hours[0]).hour + frac);
  const cur: HourData = dp
    ? { day: 0, hour: Math.round(dp.h) % 24, temp: dp.temp, cloud: dp.cloud, precip: dp.precip ?? 0, precipProb: (dp.precip || dp.snow) ? 80 : 5, snow: dp.snow ?? 0, code: dp.code, wind: 10 }
    : (hours[idx] || hours[0]);
  // Couverture nuageuse interpolée (continue) → apparition/disparition douce des nuages & du voile gris.
  const coverF = dp ? cur.cloud : ((hours[i0] || hours[0]).cloud + (((hours[Math.min(maxIdx, i0 + 1)] || hours[i0]).cloud) - (hours[i0] || hours[0]).cloud) * frac);
  const isNight = effHour < sun.sunrise || effHour >= sun.sunset;
  const L = computeLight(effHour, sun.sunrise, sun.sunset);
  const P = pick(cur, L, isNight);
  // Nuit avec lampes : on alterne 2 toits (fenêtres allumées différentes) → la lumière « passe » d'une pièce à l'autre.
  const isLitNight = P.roof === 'ROOF_NIGHT_LIT';
  const roofSrc = isLitNight && litPhase === 1 ? 'ROOF_NIGHT_LIT_02' : P.roof;
  useEffect(() => {
    if (!isLitNight) return;
    const id = setInterval(() => setLitPhase((p) => (p + 1) % 2), 4500);
    return () => clearInterval(id);
  }, [isLitNight]);
  // Ciel en fondu continu : le bleu apparaît/disparaît doucement (crépuscule large)
  const sr = sun.sunrise, ss = sun.sunset;
  const skyDayOp = Math.min(smoothstep(sr - 0.4, sr + 2.4, effHour), 1 - smoothstep(ss - 2.4, ss + 0.4, effHour));
  const skyGoldenOp = clamp01(1 - Math.abs(effHour - sr) / 2.6);   // aube plus longue
  const skySunsetOp = clamp01(1 - Math.abs(effHour - ss) / 2.6);   // coucher plus long
  // L'ambiance (grade) suit le crépuscule, pas la frontière nuit/jour brute.
  const overcastOpF = (P.storm || P.fog || isNight) ? 0 : clamp01((coverF - 18) / 72) * 0.85;   // voile gris continu
  let mood: Mood;
  if (P.storm) mood = 'storm';
  else if (P.fog) mood = 'fog';
  else if (P.rain || P.snow || coverF > 80) mood = 'overcast';
  else if (skyGoldenOp > 0.32 && effHour < 12) mood = 'golden';
  else if (skySunsetOp > 0.32) mood = 'sunset';
  else if (isNight) mood = 'night';
  else if (cur.temp >= 29) mood = 'hot';
  else mood = 'day';
  const M = MOODS[mood];
  const { label, Icon } = wmo(cur.code);
  const sunSprite = P.storm || coverF > 78 ? 'SUN_STORM' : L.goldenW > 0.45 ? 'SUN_GOLDEN' : 'SUN_DAY';
  const sunOpacity = P.storm ? 0 : Math.max(0.35, clamp01(1 - (coverF - 45) / 50));   // reste diffusé derrière le couvert
  const nightSky = isNight && !P.storm && !P.fog && !P.rain && !P.snow;
  const cloudRegime = P.storm ? 'storm' : P.rain ? 'rain'
    : (!P.fog && coverF < 70 && skyGoldenOp > 0.4) ? 'dawn'
    : (!P.fog && coverF < 70 && skySunsetOp > 0.4) ? 'dusk'
    : 'fair';
  // ── Scrub fluide : lerp en requestAnimationFrame vers une cible (drag beurré + relâchement qui se stabilise) ──
  const tick = () => {
    const t = targetRef.current, p = posRef.current;
    const np = p + (t - p) * 0.24;
    if (Math.abs(t - np) < 0.012) { posRef.current = t; setPos(t); rafRef.current = 0; return; }
    posRef.current = np; setPos(np); rafRef.current = requestAnimationFrame(tick);
  };
  const goTo = (t: number, immediate = false) => {
    targetRef.current = clampPos(t);
    if (immediate) { posRef.current = targetRef.current; setPos(targetRef.current); if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } return; }
    if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
  };
  const goLive = () => { goTo(new Date().getHours()); setLive(true); };
  const setIdx = (v: number) => { goTo(v); setLive(false); setTouched(true); };

  // Drag fiable sur mobile : on écoute pointermove/up au niveau window (pas de capture, pas de gestes navigateur).
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('input,button,a,[data-ui]')) return;
    const startX = e.clientX, startSel = posRef.current;
    setLive(false); setTouched(true);
    const move = (ev: PointerEvent) => { goTo(startSel + (ev.clientX - startX) / PX_PER_HOUR); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
  };

  const dayStart = Math.floor(idx / 24) * 24;
  const sliderVal = idx - dayStart;
  const curDay = Math.floor(idx / 24);
  // Heure continue affichée près du curseur (HH:MM) → repère pendant le drag
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const hhmm = dp ? `${pad2(Math.round(dp.h) % 24)}:00` : `${pad2(Math.floor(effHour) % 24)}:${pad2(Math.floor((effHour - Math.floor(effHour)) * 60))}`;

  return (
    <div className="relative w-full h-full overflow-hidden flex justify-center" style={{ background: '#05070f' }}>

      {/* Scène : remplit l'écran sur mobile, colonne portrait centrée sur desktop. Surface de drag. */}
      <div className="ywx-stage relative h-full overflow-hidden cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={onDown}>

      {/* ── MONDE (gradé) ── */}
      <div className="absolute inset-0" style={{ filter: M.filter, transition: 'filter 600ms ease' }}>
        {/* CIEL — pile en fondu continu : nuit (base) → golden/coucher → jour */}
        <img src={asset('sky', 'SKY_NIGHT')} alt="" style={layerStyle} />
        <img src={asset('sky', 'SKY_GOLDEN')} alt="" style={{ ...layerStyle, opacity: skyGoldenOp, transition: 'opacity 500ms ease', willChange: 'opacity' }} />
        <img src={asset('sky', 'SKY_SUNSET')} alt="" style={{ ...layerStyle, opacity: skySunsetOp, transition: 'opacity 500ms ease', willChange: 'opacity' }} />
        <img src={asset('sky', 'SKY_DAY')} alt="" style={{ ...layerStyle, opacity: skyDayOp, transition: 'opacity 500ms ease', willChange: 'opacity' }} />
        {/* soleil/lune AVANT les voiles → le soleil reste diffusé derrière le ciel couvert */}
        <Celestial L={L} isNight={isNight} eveningMoon={!isNight && P.sky === 'SKY_SUNSET'} sunSprite={sunSprite} sunOpacity={sunOpacity} />
        {/* voile couvert translucide → transition fluide bleu↔gris (monté seulement si nuageux) */}
        {overcastOpF > 0.01 && <img src={asset('sky', 'SKY_OVERCAST')} alt="" style={{ ...layerStyle, opacity: overcastOpF, willChange: 'opacity' }} />}
        {/* orage / brouillard (montés seulement si actifs) */}
        {P.storm && <img src={asset('sky', 'SKY_STORM')} alt="" style={{ ...layerStyle, animation: 'ywxFade 500ms ease forwards' }} />}
        {P.fog && <img src={asset('sky', 'SKY_FOG')} alt="" style={{ ...layerStyle, animation: 'ywxFade 500ms ease forwards' }} />}
        {/* nuages + étoiles filantes */}
        <CloudsFade regime={cloudRegime} cover={coverF} nightW={L.nightW} />
        <ShootingStars on={nightSky} />
        {/* toit (héros) + ombre de contact + Roger + arbres */}
        <Cross src={asset('roof', roofSrc)} alt="Toiture" />
        <img src={asset('fx', 'CONTACT_SHADOW')} alt="" style={{ ...layerStyle, opacity: M.shadow, transition: 'opacity 500ms ease' }} />
        <div className="ywx-bob"><Cross src={asset('roger', P.roger)} alt="Roger" /></div>
        <div className="ywx-sway"><Cross src={asset('trees', P.tree)} alt="Arbres" /></div>
        {/* brouillard + précip */}
        <Fog on={P.fog} dense={cur.code === 48 || coverF > 90} nightW={L.nightW} />
        <Precip pick={P} intensity={Math.max(cur.precip, cur.snow * 2)} />
        {/* éclairs pendant l'orage */}
        <Lightning active={P.storm} />
        {/* brume d'horizon */}
        <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ height: '34%', background: `linear-gradient(0deg, ${M.haze}, transparent)`, transition: 'background 600ms ease' }} />
        {/* grade unifié */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: M.overlay, mixBlendMode: M.blend, transition: 'background 600ms ease' }} />
        {/* vignette */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(120% 80% at 50% 42%, transparent 58%, rgba(0,0,0,${M.vig}))`, transition: 'background 600ms ease' }} />
        {/* grain */}
        <div className="absolute inset-0 pointer-events-none ywx-grain" />
        {/* canicule : voile de chaleur devant tout */}
        {mood === 'hot' && <HeatHaze />}
      </div>

      {/* lisibilité UI */}
      <div className="absolute inset-x-0 top-0 h-44 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.42), transparent)' }} />
      <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ height: 150, background: 'linear-gradient(0deg, rgba(0,0,0,0.6), transparent)' }} />

      {/* ── HUD haut ── */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-start justify-between text-white">
        <div>
          <button data-ui onClick={goLive} className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md ${live ? 'bg-emerald-500/30 text-emerald-100' : 'bg-black/35 text-white/80 hover:bg-black/50'}`}>
            <Radio className="h-3.5 w-3.5" /> {live ? 'LIVE' : 'Revenir à LIVE'}
          </button>
          <div className="text-sm text-white/90 drop-shadow inline-flex items-center gap-1.5 mt-1.5"><Icon className="h-4 w-4" /> {label}</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold drop-shadow inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {CITY}</div>
        </div>
        <div className="text-right">
          <div className="text-5xl font-light tabular-nums drop-shadow">{cur.temp}°</div>
          <div className="text-[11px] text-white/80 mt-1 drop-shadow">💧 {cur.precipProb}% · {cur.precip.toFixed(1)} mm · 🌬 {cur.wind}</div>
        </div>
      </div>

      {/* indice doigt */}
      {!touched && (
        <div className="absolute left-1/2 top-[34%] -translate-x-1/2 flex flex-col items-center text-white/80 pointer-events-none select-none">
          <div className="ywx-finger"><Hand className="h-9 w-9 drop-shadow" /></div>
          <div className="text-xs mt-1 drop-shadow">glisse pour changer l'heure →</div>
        </div>
      )}

      {/* ── TEMPORAIRE : sélecteur de scènes (validation) ── */}
      {DEMO_ENABLED && (
        <div className="absolute top-24 left-2 z-20 flex flex-col items-start" data-ui>
          <button data-ui onClick={() => setDemoOpen((o) => !o)}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
            style={{ background: demo != null ? 'rgba(245,158,11,0.4)' : 'rgba(0,0,0,0.5)', color: '#fde68a', border: '1px solid rgba(245,158,11,0.55)' }}>
            🎬 {demo != null ? presets[demo].label : 'Scènes'}
          </button>
          {demoOpen && (
            <div className="mt-1 flex flex-col gap-0.5 max-h-[58vh] overflow-y-auto p-1 rounded-md no-scrollbar"
              style={{ background: 'rgba(0,0,0,0.62)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(4px)' }}>
              <button data-ui onClick={() => setDemo(null)} className="text-[11px] text-left px-2 py-1 rounded whitespace-nowrap"
                style={{ color: demo == null ? '#86efac' : '#d1d5db', background: demo == null ? 'rgba(16,185,129,0.25)' : 'transparent' }}>▶︎ Auto (live)</button>
              {presets.map((p, i) => (
                <button key={i} data-ui onClick={() => { setDemo(i); setLive(false); setTouched(true); }} className="text-[11px] text-left px-2 py-1 rounded whitespace-nowrap"
                  style={{ color: demo === i ? '#fde68a' : '#e5e7eb', background: demo === i ? 'rgba(245,158,11,0.28)' : 'transparent' }}>{p.label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TIMELINE bas (dates + heures, style YoWindow) ── */}
      <div className="absolute bottom-0 left-0 right-0 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2" data-ui>
        {/* bandeau de dates + heure courante (à droite, près du curseur) */}
        <div className="flex items-stretch gap-1.5 pb-1.5">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
          {Array.from({ length: DAYS }).map((_, d) => {
            const dl = dayLabel(d); const act = d === curDay;
            const noon = hours[d * 24 + 12] || hours[d * 24];
            const { Icon: DI } = wmo(noon?.code ?? 0);
            return (
              <button key={d} data-ui onClick={() => setIdx(d * 24 + 7)}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-left transition-colors"
                style={{ background: act ? 'rgba(99,102,241,0.32)' : 'rgba(0,0,0,0.32)', border: `1px solid ${act ? 'rgba(199,210,254,0.5)' : 'rgba(255,255,255,0.12)'}` }}>
                <div className="text-[11px] font-semibold leading-tight" style={{ color: act ? '#e0e7ff' : '#d1d5db' }}>{dl.wd}</div>
                <div className="text-[10px] leading-tight" style={{ color: act ? '#c7d2fe' : '#9ca3af' }}>{dl.dm}</div>
                <div className="mt-0.5 flex items-center gap-1" style={{ color: act ? '#e0e7ff' : '#cbd5e1' }}>
                  <DI className="h-3 w-3" /><span className="text-[11px] tabular-nums">{noon?.temp ?? '--'}°</span>
                </div>
              </button>
            );
          })}
          </div>
          {/* heure courante — juste à droite des journées, au-dessus du curseur */}
          <div className="shrink-0 flex flex-col items-end justify-center pr-1 pl-1 text-white">
            <div className="text-3xl font-light tabular-nums leading-none drop-shadow">{hhmm}</div>
            <div className="text-[10px] text-white/75 mt-0.5">{dayLabel(curDay).wd}</div>
          </div>
        </div>
        {/* bande horaire */}
        <div className="rounded-xl bg-black/40 backdrop-blur-sm px-3 py-2">
          <input type="range" min={0} max={23} step={1} value={sliderVal}
            onChange={(e) => setIdx(dayStart + parseInt(e.target.value, 10))} className="ywx-slider w-full" aria-label="Heure" />
          <div className="flex justify-between text-[10px] text-white/65 mt-0.5 tabular-nums">
            {['00:00', '06:00', '12:00', '18:00', '24:00'].map((t) => <span key={t}>{t}</span>)}
          </div>
        </div>
      </div>

      {loading && <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm bg-black/30">Chargement de la météo…</div>}
      {usingMock && <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-amber-200 bg-black/40 px-2 py-0.5 rounded">données simulées</div>}

      <style>{`
        @keyframes ywxFade { from { opacity:0; } to { opacity:1; } }
        .ywx-stage { width: 100%; will-change: transform; touch-action: none; }
        @media (min-width: 640px) { .ywx-stage { width: auto; aspect-ratio: 1320 / 2868; max-width: 100%; } }
        .ywx-cloud { position:absolute; left:0; height:auto; pointer-events:none; animation-name: ywxCloudDrift; animation-timing-function: linear; animation-iteration-count: infinite; }
        /* dérive gauche→droite + se forme (fondu) à l'entrée, se dissipe à la sortie */
        @keyframes ywxCloudDrift {
          0%   { transform: translateX(-42%); opacity: 0; }
          9%   { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateX(132vw); opacity: 0; }
        }
        .ywx-cloud-twi { position:absolute; left:-9%; width:118%; height:auto; pointer-events:none; animation-name: ywxTwiDrift; animation-timing-function: ease-in-out; animation-iteration-count: infinite; animation-direction: alternate; }
        @keyframes ywxTwiDrift { from { transform: translateX(-9%); } to { transform: translateX(9%); } }
        .ywx-bob { position:absolute; inset:0; animation: ywxBob 5.5s ease-in-out infinite; }
        @keyframes ywxBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-0.35%); } }
        .ywx-sway { position:absolute; inset:0; transform-origin: 50% 100%; animation: ywxSway 7s ease-in-out infinite; }
        @keyframes ywxSway { 0%,100% { transform: rotate(-0.25deg); } 50% { transform: rotate(0.25deg); } }
        .ywx-fall { position:absolute; inset:0; animation-name: ywxFall; animation-timing-function: linear; animation-iteration-count: infinite; }
        .ywx-fall-tile { position:absolute; left:0; width:100%; height:100%; object-fit:cover; }
        @keyframes ywxFall { from { transform: translateY(0); } to { transform: translateY(100%); } }
        .ywx-star { position:absolute; pointer-events:none; opacity:0; height:auto; will-change:transform,opacity; animation-name: ywxStar; animation-timing-function: ease-in; animation-iteration-count: infinite; }
        @keyframes ywxStar { 0% { opacity:0; transform: translate(0,0); } 7% { opacity:0.95; } 24% { opacity:0; transform: translate(265%, 450%); } 100% { opacity:0; transform: translate(265%,450%); } }
        .ywx-fog { position:absolute; left:0; bottom:0; width:220%; height:66%; background-repeat: repeat-x; background-size: auto 100%; animation-name: ywxFogDrift; animation-timing-function: linear; animation-iteration-count: infinite; }
        .ywx-heat { position:absolute; left:0; right:0; bottom:0; height:58%; mix-blend-mode: overlay; background: repeating-linear-gradient(0deg, rgba(255,255,255,0) 0px, rgba(255,244,214,0.06) 3px, rgba(255,255,255,0) 7px); animation: ywxHeat 2.6s linear infinite; }
        @keyframes ywxHeat { 0% { transform: translateY(0); opacity:0.65; } 50% { opacity:1; } 100% { transform: translateY(-7px); opacity:0.65; } }
        @keyframes ywxFogDrift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .ywx-finger { animation: ywxFinger 1.8s ease-in-out infinite; }
        @keyframes ywxFinger { 0%,100% { transform: translateX(-12px); } 50% { transform: translateX(14px); } }
        .ywx-grain { opacity:0.05; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .no-scrollbar::-webkit-scrollbar { display:none; } .no-scrollbar { -ms-overflow-style:none; scrollbar-width:none; }
        .ywx-slider { -webkit-appearance:none; appearance:none; height:26px; background:transparent; cursor:pointer; }
        .ywx-slider::-webkit-slider-runnable-track { height:6px; border-radius:9999px; background: rgba(255,255,255,0.35); }
        .ywx-slider::-moz-range-track { height:6px; border-radius:9999px; background: rgba(255,255,255,0.35); }
        .ywx-slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:28px; height:28px; border-radius:50%; background:#fff; border:3px solid #6366f1; margin-top:-11px; box-shadow:0 2px 8px rgba(0,0,0,0.45); }
        .ywx-slider::-moz-range-thumb { width:28px; height:28px; border-radius:50%; background:#fff; border:3px solid #6366f1; box-shadow:0 2px 8px rgba(0,0,0,0.45); }
      `}</style>
      </div>
    </div>
  );
};

export default WeatherScene;
