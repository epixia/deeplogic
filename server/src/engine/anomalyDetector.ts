// anomalyDetector — real trailing-window z-score detection over each KPI
// series. For every point we compute the mean/std of the preceding window
// (default 14 days) and flag points where |value - mean| / std >= threshold.
// Severity is derived from |z|. This reliably flags the planted anomalies
// (Atlas "Returns %" / Online, Northwind "Churn %" / Enterprise).

import type { SemanticModel, KPI, Anomaly } from '../types.js';
import { mean, std, round, idFrom } from './util.js';
import { attributeRootCause } from './rootCause.js';
import { recommend } from './recommender.js';
import { writeBrief } from './briefWriter.js';

const WINDOW = 14;
const THRESHOLD = 2.5;

interface Flag {
  index: number;
  date: string;
  observed: number;
  expected: number;
  z: number;
  direction: 'up' | 'down';
}

/** Flag the single strongest anomalous point in a KPI series (if any). */
function detectInSeries(kpi: KPI): Flag | null {
  const series = kpi.series;
  let strongest: Flag | null = null;

  for (let i = WINDOW; i < series.length; i++) {
    const window = series.slice(i - WINDOW, i).map((p) => p.value);
    const m = mean(window);
    const s = std(window);
    if (s <= 0) continue; // flat baseline — no meaningful z

    const value = series[i].value;
    const z = (value - m) / s;
    if (Math.abs(z) >= THRESHOLD) {
      const flag: Flag = {
        index: i,
        date: series[i].date,
        observed: round(value, 2),
        expected: round(m, 2),
        z: round(z, 2),
        direction: value >= m ? 'up' : 'down',
      };
      if (!strongest || Math.abs(flag.z) > Math.abs(strongest.z)) {
        strongest = flag;
      }
    }
  }

  return strongest;
}

function severityFromZ(z: number): Anomaly['severity'] {
  const a = Math.abs(z);
  if (a >= 5) return 'high';
  if (a >= 3.5) return 'medium';
  return 'low';
}

/**
 * Detect anomalies across every KPI in the model. Async so the brief writer
 * can optionally call Anthropic; offline it resolves with template briefs.
 */
export async function detectAnomalies(model: SemanticModel): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];

  for (const kpi of model.kpis) {
    const flag = detectInSeries(kpi);
    if (!flag) continue;

    const rc = attributeRootCause(model, kpi, flag.direction);
    if (!rc) continue;

    const severity = severityFromZ(flag.z);
    const recommendation = recommend(kpi, rc, severity);
    const brief = await writeBrief(
      kpi,
      flag.date,
      flag.observed,
      flag.expected,
      flag.z,
      rc,
      recommendation
    );

    anomalies.push({
      id: idFrom('anom', model.id, kpi.id, flag.date),
      kpiId: kpi.id,
      kpiName: kpi.name,
      date: flag.date,
      observed: flag.observed,
      expected: flag.expected,
      deviation: flag.z,
      severity,
      rootCause: {
        dimensionId: rc.dimensionId,
        dimensionName: rc.dimensionName,
        label: rc.label,
        contribution: rc.contribution,
      },
      brief,
      recommendation,
    });
  }

  // Most severe first, then most recent.
  anomalies.sort(
    (a, b) =>
      Math.abs(b.deviation) - Math.abs(a.deviation) || b.date.localeCompare(a.date)
  );
  return anomalies;
}

/**
 * Synchronous detection without briefs — used by event generators that need to
 * reference real anomalies cheaply without awaiting the (optional) brief call.
 */
export function detectAnomaliesSync(
  model: SemanticModel
): { kpiId: string; kpiName: string; date: string; label: string; severity: Anomaly['severity'] }[] {
  const out: { kpiId: string; kpiName: string; date: string; label: string; severity: Anomaly['severity'] }[] = [];
  for (const kpi of model.kpis) {
    const flag = detectInSeries(kpi);
    if (!flag) continue;
    const rc = attributeRootCause(model, kpi, flag.direction);
    if (!rc) continue;
    out.push({
      kpiId: kpi.id,
      kpiName: kpi.name,
      date: flag.date,
      label: rc.label,
      severity: severityFromZ(flag.z),
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}
