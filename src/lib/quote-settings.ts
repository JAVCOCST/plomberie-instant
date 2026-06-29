/**
 * Quote Generator — global settings (margin thresholds, default crew, taxes, etc.)
 *
 * Single source of truth used by Métriques clés, alerts, and templates.
 * Persisted in localStorage today; the `loadSettings`/`saveSettings` API is
 * shaped so it can be swapped to a Supabase `user_settings` table without
 * touching consumers (a migration is planned — see plan.md).
 */

export type TaxesMode = 'sans' | 'avec';

export interface QuoteSettings {
  /** Default crew size (men on site) */
  defaultCrewSize: number;
  /** Default coverage per shingle package (sqft) */
  defaultCoveragePerPkg: number;
  /** Hourly labor rate ($/h) used for tear-off / install conversions */
  hourlyRate: number;
  /** Margin % thresholds (line + global) */
  marginThresholdGreen: number; // ≥ this = healthy
  marginThresholdYellow: number; // ≥ this = ok / borderline
  /** Per-line margin alert threshold (used in line table header) */
  lineMarginThreshold: number;
  /** Minimum acceptable selling price ($/h) for install labor */
  installPriceFloor: number;
  /** Minimum acceptable selling price ($/h) for tear-off labor */
  tearoffPriceFloor: number;
  /** Minimum price per sqft alert ($/pi²) */
  pricePerSqftFloor: number;
  /** Taxes calculation mode for displayed totals */
  taxesMode: TaxesMode;
}

export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  defaultCrewSize: 3,
  defaultCoveragePerPkg: 33.3,
  hourlyRate: 80,
  marginThresholdGreen: 25,
  marginThresholdYellow: 15,
  lineMarginThreshold: 20,
  installPriceFloor: 1.25,
  tearoffPriceFloor: 0.55,
  pricePerSqftFloor: 4.5,
  taxesMode: 'sans',
};

const STORAGE_KEY = 'quote_settings_v1';

export function loadSettings(): QuoteSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QUOTE_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_QUOTE_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_QUOTE_SETTINGS };
  }
}

export function saveSettings(settings: QuoteSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota errors
  }
}

/* ── Tone helpers ── */

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export const TONE_COLORS: Record<Tone, string> = {
  good: '#34d399',
  warn: '#fbbf24',
  bad: '#f87171',
  neutral: '#d1d5db',
};

export function marginTone(pct: number, s: QuoteSettings): Tone {
  if (pct >= s.marginThresholdGreen) return 'good';
  if (pct >= s.marginThresholdYellow) return 'warn';
  return 'bad';
}

export function priceFloorTone(value: number, floor: number): Tone {
  if (value <= 0) return 'neutral';
  if (value >= floor * 1.1) return 'good';
  if (value >= floor) return 'warn';
  return 'bad';
}

/* ── Smart messages ── */

export interface SmartAlert {
  tone: Tone;
  message: string;
}

export interface AlertInputs {
  marginPct: number;
  pricePerSqft: number;
  installPricePerH: number;
  tearoffPricePerH: number;
  totalPkgs: number;
  installHours: number;
  totalDays: number;
  surfaceCorrigee: number;
}

export function buildSmartAlerts(i: AlertInputs, s: QuoteSettings): SmartAlert[] {
  const alerts: SmartAlert[] = [];

  // Margin
  if (i.marginPct >= s.marginThresholdGreen) {
    alerts.push({ tone: 'good', message: `Marge de ${i.marginPct.toFixed(1)}% — soumission saine, bon coussin.` });
  } else if (i.marginPct >= s.marginThresholdYellow) {
    alerts.push({ tone: 'warn', message: `Marge de ${i.marginPct.toFixed(1)}% — acceptable mais faible buffer si coûts montent.` });
  } else if (i.marginPct > 0) {
    alerts.push({ tone: 'bad', message: `Marge de ${i.marginPct.toFixed(1)}% sous le seuil de ${s.marginThresholdYellow}% — soumission trop agressive.` });
  } else {
    alerts.push({ tone: 'bad', message: 'Marge négative — révise les prix immédiatement.' });
  }

  // Price/sqft
  if (i.pricePerSqft > 0 && i.pricePerSqft < s.pricePerSqftFloor) {
    alerts.push({ tone: 'bad', message: `Prix au pi² (${i.pricePerSqft.toFixed(2)} $) sous le plancher (${s.pricePerSqftFloor.toFixed(2)} $).` });
  }

  // Install labor
  if (i.installPricePerH > 0 && i.installPricePerH < s.installPriceFloor * 100) {
    alerts.push({ tone: 'warn', message: 'Prix de pose semble bas — vérifie les heures.' });
  }

  // Tear-off
  if (i.tearoffPricePerH > 0 && i.tearoffPricePerH < s.tearoffPriceFloor * 100) {
    alerts.push({ tone: 'warn', message: 'Arrachage sous-chargé — temps ou prix trop bas.' });
  }

  // Cadence sanity
  if (i.installHours > 0 && i.totalPkgs / i.installHours > 4) {
    alerts.push({ tone: 'warn', message: 'Cadence pose anormalement élevée — heures sous-estimées?' });
  }

  return alerts;
}