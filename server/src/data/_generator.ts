// Seeded series generator for sample semantic models.
// Deterministic (mulberry32 PRNG) so planted anomalies are stable across runs.

import type { KPI } from '../types.js';

/** mulberry32 — tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build an array of N daily ISO dates ending today (inclusive). */
export function dailyDates(days: number, endDate: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(isoDate(d));
  }
  return out;
}

export interface SeriesSpec {
  base: number; // starting baseline value
  trendPerDay: number; // additive drift per day
  weeklyAmp: number; // weekly seasonality amplitude (fraction of base)
  noiseAmp: number; // noise amplitude (fraction of base)
  /** Planted anomaly: spike/dip injected `daysAgo` from the end. */
  anomaly?: { daysAgo: number; multiplier: number };
  round?: (v: number) => number; // optional value rounder
  min?: number;
}

/** Generate a realistic daily series with trend + weekly seasonality + noise. */
export function genSeries(
  dates: string[],
  spec: SeriesSpec,
  rand: () => number
): { date: string; value: number }[] {
  const n = dates.length;
  const round = spec.round ?? ((v: number) => Math.round(v * 100) / 100);
  return dates.map((date, i) => {
    const trend = spec.base + spec.trendPerDay * i;
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    // weekend dip pattern, peaks midweek
    const weekly =
      Math.sin(((dow - 1) / 7) * Math.PI * 2) * spec.weeklyAmp * spec.base;
    const noise = (rand() - 0.5) * 2 * spec.noiseAmp * spec.base;
    let value = trend + weekly + noise;
    if (spec.anomaly && i === n - 1 - spec.anomaly.daysAgo) {
      value = value * spec.anomaly.multiplier;
    }
    if (spec.min !== undefined) value = Math.max(spec.min, value);
    return { date, value: round(value) };
  });
}

export const round0 = (v: number) => Math.round(v);
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;

/** current = last value, previous = value ~7 days prior. */
export function currentPrevious(series: { date: string; value: number }[]): {
  current: number;
  previous: number;
} {
  const current = series[series.length - 1]?.value ?? 0;
  const prevIdx = Math.max(0, series.length - 1 - 7);
  const previous = series[prevIdx]?.value ?? current;
  return { current, previous };
}

/**
 * Build a byDimension breakdown for a KPI. Each dimension's members get a
 * share of the KPI's current value. When an anomaly is planted in a specific
 * member, that member's share is depressed/inflated so root-cause attribution
 * resolves to it. Shares sum to ~current value (for currency/number) or are
 * member-level rates (for percent).
 */
export function genBreakdown(
  current: number,
  dimensions: { id: string; values: string[]; anomalyLabel?: string }[],
  format: 'currency' | 'percent' | 'number',
  rand: () => number,
  anomalyDirection: 'up' | 'down'
): Record<string, { label: string; value: number }[]> {
  const out: Record<string, { label: string; value: number }[]> = {};
  for (const dim of dimensions) {
    // random positive weights
    const weights = dim.values.map(() => 0.4 + rand());
    const total = weights.reduce((a, b) => a + b, 0);
    out[dim.id] = dim.values.map((label, i) => {
      let value: number;
      if (format === 'percent') {
        // member-level rate near the overall rate, jittered
        value = Math.round((current + (rand() - 0.5) * current * 0.6) * 100) / 100;
        value = Math.max(0, value);
      } else {
        const share = weights[i] / total;
        value = Math.round(current * share);
      }
      // concentrate the anomaly into one member
      if (dim.anomalyLabel && label === dim.anomalyLabel) {
        if (format === 'percent') {
          value =
            anomalyDirection === 'up'
              ? Math.round(value * 2.1 * 100) / 100
              : Math.round(value * 0.35 * 100) / 100;
        } else {
          value =
            anomalyDirection === 'up'
              ? Math.round(value * 1.9)
              : Math.round(value * 0.32);
        }
      }
      return { label, value };
    });
  }
  return out;
}

export type { KPI };
