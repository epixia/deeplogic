// briefWriter — produce the natural-language brief for an anomaly.
//
// Default path is a deterministic template (number + direction + cause +
// recommendation) so the app runs fully offline with no API key.
//
// OPTIONAL enhancement: if process.env.ANTHROPIC_API_KEY is set, we lazily
// import the Anthropic SDK (an optional dependency) and ask Claude to polish
// the brief. Everything is wrapped in try/catch and falls back to the template
// — it never throws and never blocks the response on failure.

import type { KPI, Anomaly } from '../types.js';
import type { RootCause } from './rootCause.js';
import { formatValue, round } from './util.js';

/** Deterministic template brief. Always available, no network. */
export function templateBrief(
  kpi: KPI,
  date: string,
  observed: number,
  expected: number,
  z: number,
  rc: RootCause,
  recommendation: Anomaly['recommendation']
): string {
  const obs = formatValue(observed, kpi.format);
  const exp = formatValue(expected, kpi.format);
  const badUp = kpi.goodDirection === 'down'; // up move is bad
  const moved = observed >= expected ? 'rose to' : 'fell to';
  const qualifier = (observed >= expected) === badUp ? 'concerning' : 'notable';

  return (
    `${kpi.name} ${moved} ${obs} on ${date}, versus an expected ${exp} ` +
    `(${round(z, 1)}σ from the trailing-14-day baseline — a ${qualifier} swing). ` +
    `The move is concentrated in ${rc.dimensionName} = ${rc.label}, ` +
    `which sits well outside the rest of the segment. ` +
    `Recommended next step: ${recommendation.title.toLowerCase()}.`
  );
}

/** Prompt sent to Claude when enhancement is enabled. */
function buildPrompt(
  kpi: KPI,
  date: string,
  observed: number,
  expected: number,
  z: number,
  rc: RootCause,
  recommendation: Anomaly['recommendation']
): string {
  return [
    `You are an analytics agent writing a crisp executive brief about a KPI anomaly.`,
    `Write 2-3 sentences, plain language, no markdown, no preamble.`,
    `State the number and direction, the most likely cause, and the recommended action.`,
    ``,
    `KPI: ${kpi.name} (${kpi.format}, good when it goes ${kpi.goodDirection})`,
    `Date: ${date}`,
    `Observed: ${formatValue(observed, kpi.format)}`,
    `Expected (14d baseline): ${formatValue(expected, kpi.format)}`,
    `Deviation: ${round(z, 1)} standard deviations`,
    `Root cause: ${rc.dimensionName} = ${rc.label} (contribution ${rc.contribution})`,
    `Recommended action: ${recommendation.title} — ${recommendation.detail}`,
  ].join('\n');
}

/**
 * Build the brief, optionally enhanced by Claude. Async because the SDK call
 * is async; the template path resolves immediately.
 */
export async function writeBrief(
  kpi: KPI,
  date: string,
  observed: number,
  expected: number,
  z: number,
  rc: RootCause,
  recommendation: Anomaly['recommendation']
): Promise<string> {
  const fallback = templateBrief(kpi, date, observed, expected, z, rc, recommendation);

  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  try {
    // Lazy, optional dependency — import only when a key is present so the app
    // runs even if '@anthropic-ai/sdk' is not installed.
    const mod = await import('@anthropic-ai/sdk');
    const Anthropic = mod.default;
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY
    const prompt = buildPrompt(kpi, date, observed, expected, z, rc, recommendation);
    const res = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content
      .filter((b: { type: string }): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return text.length > 0 ? text : fallback;
  } catch {
    // Any failure (missing package, network, auth) -> deterministic fallback.
    return fallback;
  }
}
