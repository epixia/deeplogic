// Coding agent for the Innovation Lab. An LLM tool-loop that builds a small
// static web tool by writing files into a sandbox via SandboxOps. Provider-
// agnostic: Anthropic native tools + OpenAI-compatible function calling.
//
// v1 scope: static single-page tools (HTML/CSS/JS, CDN libs) — instant, reliable
// preview with no build step. npm/full-stack projects come later (run_command).

import type { AiConfig } from '../studio/generator.js';

export interface SandboxOps {
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  listFiles(): Promise<string[]>;
}
export interface AgentStep { icon: string; text: string }
export interface AgentChatMsg { role: 'user' | 'assistant'; content: string }
export interface AgentResult { reply: string; steps: AgentStep[]; touched: string[] }

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-opus-4-8', openai: 'gpt-4o', openrouter: 'openai/gpt-4o',
};
const MAX_ITERS = 14;

const TOOLS = [
  {
    name: 'write_file',
    description: 'Create or overwrite a file. Path is relative to the app root (e.g. "index.html", "app.js", "styles.css").',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'read_file',
    description: 'Read a file you have written, to revise it.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'list_files',
    description: 'List the files currently in the app.',
    input_schema: { type: 'object', properties: {} },
  },
];

function systemPrompt(brief: string, context: string): string {
  return [
    'You are a senior front-end engineer building a small INTERNAL WEB TOOL for a business team.',
    'Hard constraints:',
    '- The app is a STATIC single-page site served from the app root. The entry file MUST be "index.html".',
    '- NO build step and NO npm. Use vanilla JS, or pull React/Vue/Tailwind/Chart.js etc. via CDN <script>/<link> tags.',
    '- Keep it to a handful of files. It must actually run and look clean and modern (dark UI is fine).',
    '- Create every file with the write_file tool. Use read_file/list_files to inspect/revise. NEVER paste code into the chat.',
    '- Prefer mock/sample data wired so the user can see it working; clearly mark where a real API/connector would plug in.',
    'When you are finished, STOP calling tools and reply with 1-3 sentences describing what you built and how to use it.',
    context ? `\n# Workspace context (the org's data you can build against)\n${context.slice(0, 6000)}` : '',
    `\n# The tool to build\n${brief}`,
  ].filter(Boolean).join('\n');
}

async function execTool(
  ops: SandboxOps, name: string, input: Record<string, unknown>,
  touched: Set<string>, steps: AgentStep[],
): Promise<string> {
  try {
    if (name === 'write_file') {
      const path = String(input.path ?? '').replace(/^\/+/, '').trim();
      const content = String(input.content ?? '');
      if (!path) return 'ERROR: path is required';
      await ops.writeFile(path, content);
      touched.add(path);
      steps.push({ icon: '📝', text: `Wrote ${path}` });
      return `Wrote ${path} (${content.length} bytes).`;
    }
    if (name === 'read_file') {
      const path = String(input.path ?? '').replace(/^\/+/, '').trim();
      const c = await ops.readFile(path);
      return c ? c.slice(0, 12000) : `(no file at ${path})`;
    }
    if (name === 'list_files') {
      const fs = await ops.listFiles();
      return fs.length ? fs.join('\n') : '(no files yet)';
    }
    return `ERROR: unknown tool ${name}`;
  } catch (e) {
    return `ERROR: ${e instanceof Error ? e.message : 'tool failed'}`;
  }
}

export async function runCodingAgent(
  ai: AiConfig,
  ops: SandboxOps,
  opts: { brief: string; context?: string; message: string; history?: AgentChatMsg[] },
): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const touched = new Set<string>();
  const sys = systemPrompt(opts.brief, opts.context ?? '');
  const history = opts.history ?? [];

  if (ai.provider === 'anthropic') {
    const mod = await import('@anthropic-ai/sdk');
    const client = new mod.default({ apiKey: ai.apiKey });
    const model = ai.model || DEFAULT_MODEL.anthropic;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const messages: any[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: opts.message },
    ];
    for (let i = 0; i < MAX_ITERS; i++) {
      const res: any = await client.messages.create({
        model, max_tokens: 8000, system: sys, tools: TOOLS as any, messages,
      });
      const toolUses = (res.content ?? []).filter((b: any) => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const text = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
        return { reply: text || 'Done.', steps, touched: [...touched] };
      }
      messages.push({ role: 'assistant', content: res.content });
      const results: any[] = [];
      for (const tu of toolUses) {
        const out = await execTool(ops, tu.name, (tu.input ?? {}) as Record<string, unknown>, touched, steps);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
      }
      messages.push({ role: 'user', content: results });
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return { reply: 'Stopped after the max number of build steps — ask me to continue.', steps, touched: [...touched] };
  }

  // OpenAI-compatible function calling (OpenAI / OpenRouter).
  const base = ai.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const model = ai.model || DEFAULT_MODEL[ai.provider];
  const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const messages: any[] = [
    { role: 'system', content: sys },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: opts.message },
  ];
  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}`, 'X-Title': 'DeepLogic Innovation' },
      body: JSON.stringify({ model, max_tokens: 8000, tools, messages }),
    });
    if (!res.ok) throw new Error(`Provider error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: any }[] };
    const msg = data.choices?.[0]?.message;
    const calls = msg?.tool_calls as { id: string; function: { name: string; arguments: string } }[] | undefined;
    if (!msg || !calls || calls.length === 0) {
      return { reply: (msg?.content ?? '').toString().trim() || 'Done.', steps, touched: [...touched] };
    }
    messages.push(msg);
    for (const c of calls) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(c.function.arguments || '{}'); } catch { /* keep {} */ }
      const out = await execTool(ops, c.function.name, input, touched, steps);
      messages.push({ role: 'tool', tool_call_id: c.id, content: out });
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { reply: 'Stopped after the max number of build steps — ask me to continue.', steps, touched: [...touched] };
}
