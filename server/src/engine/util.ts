// Shared engine utilities: stats, formatting, ids.

import type { KPI } from '../types.js';

/** Mean of a numeric array (0 for empty). */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation of a numeric array (0 for length < 2). */
export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return Math.sqrt(variance);
}

/** Round to n decimal places. */
export function round(v: number, n = 2): number {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

/** Format a KPI value for display given its format. */
export function formatValue(value: number, format: KPI['format']): string {
  switch (format) {
    case 'currency':
      return `$${Math.round(value).toLocaleString('en-US')}`;
    case 'percent':
      return `${round(value, 2)}%`;
    case 'number':
    default:
      return Math.round(value).toLocaleString('en-US');
  }
}

/** Percent change current vs previous (guards divide-by-zero). */
export function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

/** Human "up X%" / "down X%" / "flat" trend phrase. */
export function trendPhrase(current: number, previous: number): string {
  const d = pctChange(current, previous);
  if (d > 0.05) return `up ${Math.abs(d)}% vs last week`;
  if (d < -0.05) return `down ${Math.abs(d)}% vs last week`;
  return 'flat vs last week';
}

/** Deterministic short id from parts (no randomness — reproducible). */
export function idFrom(...parts: (string | number)[]): string {
  return parts.join('-').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
}
