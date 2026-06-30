// describePowerBi — given a Power BI report's structure (tables/columns,
// connections, KPIs, entities, pages), ask the AI to explain in plain English
// what the dashboard portrays and who it's for. One AI call; heuristic fallback.

import type { AiConfig, AiProvider } from './generator.js';

export interface PbiStructure {
  name: string;
  tables: { name: string; columns: string[] }[];
  sources: string[];     // "server / db", "file.xlsx", dataset names…
  sourceTypes: string[]; // sql_server, excel_workbook…
  kpis: string[];
  entities: string[];
  pages: string[];
}

const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o',
  openrouter: 'openai/gpt-4o',
};

async function callAI(ai: AiConfig, system: string, user: string): Promise<string> {
  const model = ai.model || DEFAULT_MODEL[ai.provider];
  if (ai.provider === 'anthropic') {
    const mod = await import('@anthropic-ai/sdk');
    const client = new mod.default({ apiKey: ai.apiKey });
    const res = await client.messages.create({ model, max_tokens: 700, system, messages: [{ role: 'user', content: user }] });
    return (res.content ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text).join('');
  }
  const baseUrl = ai.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}`);
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? '';
}

const SYSTEM = `You are a data analyst. Given the structure of a Power BI report (its tables & columns, data sources, KPIs, business entities and pages), explain in plain business English WHAT the dashboard portrays: the business domain/subject, what questions it answers, who would use it, and the story its pages tell. Be specific and reference real table/KPI/page names. 3-5 sentences, no preamble, no bullet lists, no markdown headers.`;

function compact(s: PbiStructure): string {
  const tbls = s.tables.slice(0, 40).map((t) => `${t.name}(${t.columns.slice(0, 12).join(', ')})`).join('; ');
  return [
    `Report: ${s.name}`,
    s.sourceTypes.length ? `Source types: ${s.sourceTypes.join(', ')}` : '',
    s.sources.length ? `Sources: ${s.sources.slice(0, 8).join(', ')}` : '',
    `Tables & columns: ${tbls}`,
    s.kpis.length ? `KPIs: ${s.kpis.slice(0, 40).join(', ')}` : '',
    s.entities.length ? `Entities: ${s.entities.slice(0, 30).join(', ')}` : '',
    s.pages.length ? `Pages: ${s.pages.join(', ')}` : '',
  ].filter(Boolean).join('\n').slice(0, 8000);
}

export async function describePowerBi(ai: AiConfig | null, s: PbiStructure): Promise<{ description: string; usedAI: boolean }> {
  if (ai) {
    try {
      const text = (await callAI(ai, SYSTEM, compact(s))).trim();
      if (text) return { description: text, usedAI: true };
    } catch { /* fall through to heuristic */ }
  }
  // Heuristic fallback — describe from structure alone.
  const subject = s.entities[0] || s.tables[0]?.name || 'business data';
  const bits = [
    `"${s.name}" is a Power BI report on ${subject}${s.sources.length ? `, built from ${s.sources.slice(0, 3).join(', ')}` : ''}.`,
    s.kpis.length ? `It tracks ${s.kpis.length} metrics${s.kpis.length ? ` including ${s.kpis.slice(0, 4).join(', ')}` : ''}.` : '',
    s.pages.length ? `Its ${s.pages.length} page(s) — ${s.pages.slice(0, 5).join(', ')} — organise the story.` : '',
  ].filter(Boolean);
  return { description: bits.join(' '), usedAI: false };
}
