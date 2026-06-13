// answerQuestion — lightweight NL → KPI matcher over the model.
// Intent detection:
//   - "why"/"cause"/"reason"/"driver"  -> explain using anomaly root-cause
//   - otherwise                        -> report value + trend for the KPI
// KPI resolution is a keyword/alias scan over KPI names and ids.

import type { SemanticModel, KPI, AskAnswer } from '../types.js';
import { extractKpis } from './kpiExtractor.js';
import { detectAnomaliesSync } from './anomalyDetector.js';
import { formatValue, trendPhrase, pctChange } from './util.js';

// Extra synonyms so plain-English questions resolve to the right KPI.
const ALIASES: Record<string, string[]> = {
  revenue: ['revenue', 'sales', 'turnover', 'topline', 'top line'],
  orders: ['orders', 'order count', 'transactions'],
  margin: ['margin', 'profitability', 'gross margin'],
  returns: ['returns', 'return rate', 'refunds'],
  mrr: ['mrr', 'recurring revenue', 'monthly recurring'],
  active: ['active users', 'actives', 'active', 'engagement', 'users', 'dau', 'mau'],
  churn: ['churn', 'attrition', 'cancellations', 'cancellation'],
  nps: ['nps', 'net promoter', 'satisfaction'],
};

function tokenScore(question: string, terms: string[]): number {
  const q = question.toLowerCase();
  let score = 0;
  for (const t of terms) if (q.includes(t)) score += t.length; // longer match wins
  return score;
}

/** Resolve the most likely KPI for a question (or null if nothing matches). */
function resolveKpi(model: SemanticModel, question: string): KPI | null {
  const kpis = extractKpis(model);
  let best: KPI | null = null;
  let bestScore = 0;

  for (const kpi of kpis) {
    const terms = new Set<string>([kpi.name.toLowerCase(), kpi.id.toLowerCase()]);
    // pull the bare token after "k-" for alias lookup (k-revenue -> revenue)
    const key = kpi.id.replace(/^k-/, '');
    for (const a of ALIASES[key] ?? []) terms.add(a);

    const score = tokenScore(question, Array.from(terms));
    if (score > bestScore) {
      bestScore = score;
      best = kpi;
    }
  }
  return bestScore > 0 ? best : null;
}

function isWhy(question: string): boolean {
  return /\b(why|cause|caused|reason|driver|driving|explain|because|behind)\b/i.test(
    question
  );
}

export function answerQuestion(model: SemanticModel, question: string): AskAnswer {
  const q = (question ?? '').trim();
  const kpi = resolveKpi(model, q);

  if (!kpi) {
    return {
      kpiId: null,
      answer:
        `I can answer questions about ${model.name}'s KPIs: ` +
        `${extractKpis(model).map((k) => k.name).join(', ')}. ` +
        `Try "what is ${extractKpis(model)[0]?.name ?? 'revenue'}" or "why did ${
          extractKpis(model).find((k) => k.goodDirection === 'down')?.name ?? 'churn'
        } change".`,
    };
  }

  const trend = trendPhrase(kpi.current, kpi.previous);
  const valueStr = formatValue(kpi.current, kpi.format);

  if (isWhy(q)) {
    // Use the detected anomaly root-cause if this KPI has one.
    const anom = detectAnomaliesSync(model).find((a) => a.kpiId === kpi.id);
    if (anom) {
      return {
        kpiId: kpi.id,
        value: kpi.current,
        format: kpi.format,
        trend,
        answer:
          `${kpi.name} is at ${valueStr} (${trend}). The recent swing on ${anom.date} ` +
          `is driven primarily by ${anom.label}, which deviates sharply from the rest of ` +
          `the segment (severity: ${anom.severity}).`,
      };
    }
    return {
      kpiId: kpi.id,
      value: kpi.current,
      format: kpi.format,
      trend,
      answer:
        `${kpi.name} is at ${valueStr} and is ${trend}. No statistically significant ` +
        `anomaly is currently flagged, so the movement looks within normal variation.`,
    };
  }

  const delta = pctChange(kpi.current, kpi.previous);
  const dirWord = delta === 0 ? 'unchanged' : delta > 0 ? `up ${Math.abs(delta)}%` : `down ${Math.abs(delta)}%`;
  return {
    kpiId: kpi.id,
    value: kpi.current,
    format: kpi.format,
    trend,
    answer: `${kpi.name} is ${valueStr}, ${dirWord} versus the prior week.`,
  };
}
