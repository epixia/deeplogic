// AI Interview ("mind dump") routes — a gap-driven interviewer that captures a
// staff member's tacit knowledge straight into the Data Vault + memory graph.
//
//   POST /orgs/:orgId/interview/token   -> short-lived HeyGen streaming token
//   POST /orgs/:orgId/interview/next    -> the next question (grounded in graph gaps)
//   POST /orgs/:orgId/interview/finish  -> compile transcript -> vault note -> graph
//
// The HeyGen avatar is a client-side layer on top; the knowledge plumbing here
// works on its own (text/voice interview) so it's useful before the avatar lands.

import { Router, raw, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireMember } from '../auth.js';
import { loadAiConfig } from './studio.js';
import type { AiConfig } from '../studio/generator.js';
import { ingestEpisode } from '../memory/graph.js';
import { embedText, profileText, toVectorLiteral, resolveEmbeddingKey } from '../studio/embeddings.js';
import { serviceClient } from '../supabase.js';
import { getPlatformIntegrations } from '../platformConfig.js';

export const interviewRouter = Router();
// Public router (no user session) — Vapi posts the end-of-call transcript here.
export const vapiWebhookRouter = Router();

// HeyGen / Vapi keys are global platform services — set in the Admin dashboard
// (stored in platform_settings) with env vars as fallback. Read per-request.
const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-opus-4-8', openai: 'gpt-4o', openrouter: 'openai/gpt-4o',
};

interface QA { q: string; a: string }

// The shared mind-dump persona — used by the in-browser brain AND the Vapi phone
// agent so every channel feels the same. NOT a quiz: draw out THEIR knowledge.
const MIND_DUMP_PERSONA = [
  'You are a warm, genuinely curious facilitator helping a person do a BRAIN DUMP — getting the knowledge inside their head out into the open. This is THEIR mind dump, not a quiz.',
  'Hard rules:',
  '- Do NOT quiz them on company facts, metrics, competitors, or industry trivia. Never ask "what is our X" style questions.',
  '- Draw out THEIR tacit knowledge: how they actually do their work, the judgment calls and rules of thumb, the shortcuts, the gotchas and edge cases, the recurring problems and how they handle them, what would break if they were away for a month, who they go to and why, and the things they wish were written down.',
  '- FOLLOW THEIR LEAD: whatever they bring up, dig into THAT with a natural follow-up. Let them ramble and pull the thread — depth over breadth.',
  '- Strongly prefer "walk me through…", "how do you actually…", "what do you do when…", "why…", "what would happen if…" over "what is…".',
  '- Keep it human and encouraging, like a sharp colleague who is genuinely interested.',
].join('\n');

// Shared spoken-interview prompts (phone + in-browser voice) so every voice
// channel runs the same mind-dump persona.
function voicePrompts(who: string, role: string, topic: string, channel: 'phone' | 'voice') {
  const firstName = who && who !== 'Team member' ? who.split(' ')[0] : '';
  const system = [
    MIND_DUMP_PERSONA,
    `You are on a ${channel === 'phone' ? 'PHONE CALL' : 'VOICE CALL'}. Speak naturally and conversationally — short turns, ONE question at a time, and really listen.`,
    topic ? `They mentioned they want to focus on: ${topic}. Stay on how THEY work within that — not facts about it.` : '',
    'When they have clearly emptied out (or after ~10–12 minutes), warmly thank them by name and wrap up.',
  ].filter(Boolean).join('\n');
  const firstMessage = `Hi${firstName ? ` ${firstName}` : ''}! Thanks for taking a few minutes — I'd love to capture what's in your head, the stuff that probably isn't written down anywhere. To start: what's something you do or know that you suspect nobody else here really knows?`;
  return { system, firstMessage };
}

// Build the Vapi assistant config for a spoken mind-dump.
/* eslint-disable @typescript-eslint/no-explicit-any */
function buildVapiAssistant(who: string, role: string, topic: string, channel: 'phone' | 'voice', voiceId = 'Elliot'): Record<string, any> {
  const { system, firstMessage } = voicePrompts(who, role, topic, channel);
  return {
    firstMessage,
    model: { provider: 'openai', model: 'gpt-4o', messages: [{ role: 'system', content: system }] },
    voice: { provider: 'vapi', voiceId: voiceId || 'Elliot' },
    transcriber: { provider: 'deepgram', model: 'nova-2' },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Persist an interview transcript as a Data Vault knowledge note (with provenance),
// embed it for recall, and grow the memory graph. Works with any db client, so
// both the authed /finish path and the public Vapi webhook (serviceClient) reuse it.
async function saveKnowledgeNote(
  db: SupabaseClient, orgId: string, ownerId: string,
  opts: { interviewee: string; role: string; date: string; tags: string[]; content: string; source: string },
): Promise<{ docId: string; name: string; entities: number; facts: number }> {
  const heading = `Interview: ${opts.interviewee}${opts.role ? ` — ${opts.role}` : ''}`;
  const meta = {
    category: 'knowledge', categorySource: 'auto', tags: opts.tags,
    interviewee: opts.interviewee, role: opts.role, date: opts.date, source: opts.source,
  };
  const { data, error } = await db.from('context_items')
    .insert({ org_id: orgId, owner_id: ownerId, scope: 'org', kind: 'note', name: heading, content: opts.content, meta, enabled: true })
    .select('id').single();
  if (error) throw new Error(error.message);
  const docId = (data as { id: string }).id;

  const ai = await loadAiConfig(orgId).catch(() => null);
  const embedKey = resolveEmbeddingKey(ai);
  if (embedKey) {
    const vec = await embedText(profileText({ name: heading, content: opts.content, profile: meta }), embedKey);
    if (vec) await db.from('context_items').update({ embedding: toVectorLiteral(vec) }).eq('id', docId).eq('org_id', orgId);
  }
  let entities = 0, facts = 0;
  if (ai) {
    const r = await ingestEpisode(db, orgId, { sourceKind: 'vault', sourceRef: docId, title: heading, text: opts.content }, ai, embedKey);
    entities = r.entities; facts = r.facts;
  }
  return { docId, name: heading, entities, facts };
}

// Minimal single-shot LLM text call (Anthropic native + OpenAI-compatible).
async function llmText(ai: AiConfig, system: string, user: string): Promise<string> {
  if (ai.provider === 'anthropic') {
    const mod = await import('@anthropic-ai/sdk');
    const client = new mod.default({ apiKey: ai.apiKey });
    const res = await client.messages.create({
      model: ai.model || DEFAULT_MODEL.anthropic, max_tokens: 400, system,
      messages: [{ role: 'user', content: user }],
    });
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    return (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  }
  const base = ai.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model || DEFAULT_MODEL[ai.provider], max_tokens: 400,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Provider error ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

// POST /interview/token — create a LiveAvatar session token (HeyGen's current,
// post-sunset API). The API key stays server-side; the browser only sees the
// short-lived session token. Avatar/voice are env-configurable.
//   HEYGEN_API_KEY    — LiveAvatar key from app.liveavatar.com/developers
//   HEYGEN_AVATAR_ID  — a LiveAvatar avatar UUID
//   HEYGEN_VOICE_ID   — (optional) voice id
/* eslint-disable @typescript-eslint/no-explicit-any */
interviewRouter.post('/orgs/:orgId/interview/token', requireMember(), async (_req: Request, res: Response) => {
  const cfg = await getPlatformIntegrations();
  if (!cfg.heygenApiKey) { res.status(503).json({ error: 'Avatar is not configured — add a LiveAvatar API key in Admin → Integrations (app.liveavatar.com/developers).' }); return; }
  const avatarId = cfg.heygenAvatarId || '';
  try {
    const body: Record<string, unknown> = {
      video_settings: { quality: process.env.HEYGEN_QUALITY || 'high', encoding: 'H264' },
    };
    if (avatarId) body.avatar_id = avatarId;
    if (cfg.heygenVoiceId) body.avatar_persona = { voice_id: cfg.heygenVoiceId, language: 'en' };

    const r = await fetch('https://api.liveavatar.com/v1/sessions/token', {
      method: 'POST',
      headers: { 'X-API-KEY': cfg.heygenApiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = await r.text();
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { /* non-JSON upstream */ }

    if (!r.ok) {
      const reason = parsed?.message || parsed?.error?.message || raw.slice(0, 300) || `HTTP ${r.status}`;
      const code = parsed?.code ? ` (code ${parsed.code})` : '';
      const hint = r.status === 401
        ? ' — set a valid LiveAvatar API key (app.liveavatar.com/developers) as HEYGEN_API_KEY in server/.env, and make sure the account has wallet balance.'
        : !avatarId ? ' — set HEYGEN_AVATAR_ID to a LiveAvatar avatar UUID in server/.env.' : '';
      res.status(502).json({ error: `LiveAvatar ${r.status}: ${reason}${code}${hint}`, upstreamStatus: r.status });
      return;
    }
    // The token field name varies by API surface — accept the common shapes.
    const d = parsed?.data ?? parsed;
    const token = d?.token ?? d?.session_token ?? d?.access_token;
    if (!token) { res.status(502).json({ error: 'LiveAvatar returned no session token.' }); return; }
    res.json({ token });
  } catch (err) {
    console.error('liveavatar token failed', err);
    res.status(500).json({ error: 'Failed to get LiveAvatar session token' });
  }
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// POST /interview/next — the mind-dump facilitator. NOT a quiz: it draws the
// person's OWN tacit knowledge out and follows wherever they lead.
interviewRouter.post('/orgs/:orgId/interview/next', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const body = (req.body || {}) as { interviewee?: string; role?: string; topic?: string; transcript?: QA[] };
  try {
    const ai = await loadAiConfig(orgId).catch(() => null);
    if (!ai) { res.status(400).json({ error: 'Connect an AI provider in Settings → AI.' }); return; }
    const transcript = (body.transcript ?? []).filter((p) => p && (p.q || p.a));

    const system = [
      MIND_DUMP_PERSONA,
      'This is a turn-by-turn text interview:',
      '- Ask exactly ONE question. Short, open, human, inviting. No preamble, no lists.',
      '- Do not repeat earlier questions.',
      '- When they have clearly emptied out on this thread (or after ~10+ exchanges), reply with exactly: DONE',
      'Reply with ONLY the question (or DONE).',
    ].join('\n');

    const user = [
      `You're helping ${body.interviewee || 'a teammate'}${body.role ? `, ${body.role}` : ''} brain-dump what's in their head.`,
      body.topic ? `They'd like to focus on: ${body.topic}. Stay on how THEY work within that — not facts about it.` : '',
      '',
      'Conversation so far:',
      transcript.length
        ? transcript.map((p, i) => `Q${i + 1}: ${p.q}\nA${i + 1}: ${p.a}`).join('\n')
        : '(none yet — open with a warm, broad invitation that gets them unloading their own know-how — e.g. what they do that probably isn’t written down anywhere, or what colleagues always come to them for.)',
    ].filter(Boolean).join('\n');

    const out = (await llmText(ai, system, user)).replace(/^["']|["']$/g, '').trim();
    const done = /^done\.?$/i.test(out);
    res.json({ question: done ? '' : out, done });
  } catch (err) {
    console.error('interview next failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Could not generate a question' });
  }
});

// POST /interview/video — receive a recorded interview (webm) and store it in a
// private Supabase Storage bucket; returns a long-lived signed URL for the note.
interviewRouter.post('/orgs/:orgId/interview/video',
  raw({ type: ['video/webm', 'application/octet-stream'], limit: '300mb' }),
  requireMember(),
  async (req: Request, res: Response) => {
    const { orgId } = req.params;
    const buf = req.body as Buffer;
    if (!buf || !buf.length) { res.status(400).json({ error: 'No video data received.' }); return; }
    const bucket = 'interview-videos';
    try {
      await serviceClient.storage.createBucket(bucket, { public: false }).catch(() => undefined); // idempotent
      const path = `${orgId}/${randomUUID()}.webm`;
      const { error: upErr } = await serviceClient.storage.from(bucket).upload(path, buf, { contentType: 'video/webm', upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: signed } = await serviceClient.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 365);
      res.json({ url: signed?.signedUrl ?? '', path });
    } catch (err) {
      console.error('interview video upload failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Video upload failed.' });
    }
  });

// POST /interview/finish — compile the transcript into a knowledge note, store it
// in the Data Vault, and grow the memory graph. Returns what was learned.
interviewRouter.post('/orgs/:orgId/interview/finish', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const body = (req.body || {}) as { interviewee?: string; role?: string; date?: string; topics?: string[]; transcript?: QA[]; videoUrl?: string };
  const who = (body.interviewee || '').toString().trim() || 'Team member';
  const role = (body.role || '').toString().trim();
  const date = (body.date || new Date().toISOString().slice(0, 10)).toString();
  const videoUrl = (body.videoUrl || '').toString().trim();
  const pairs = (body.transcript ?? []).filter((p) => p && (p.q?.trim() || p.a?.trim()));
  if (pairs.length === 0) { res.status(400).json({ error: 'Nothing to save — the transcript is empty.' }); return; }
  const tags = (body.topics ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 12);

  const heading = `Interview: ${who}${role ? ` — ${role}` : ''}`;
  const lines = [`# ${heading}`, `_Captured ${date}${role ? ` · ${role}` : ''}_`, ''];
  if (videoUrl) lines.push(`📹 [Watch the recording](${videoUrl})`, '');
  for (const p of pairs) {
    if (p.q?.trim()) lines.push(`**Q:** ${p.q.trim()}`);
    if (p.a?.trim()) lines.push(`**A:** ${p.a.trim()}`);
    lines.push('');
  }
  const content = lines.join('\n').trim();

  try {
    const r = await saveKnowledgeNote(req.db!, orgId, req.user!.id, { interviewee: who, role, date, tags, content, source: 'ai-interview' });
    res.json(r);
  } catch (err) {
    console.error('interview finish failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Could not save the interview' });
  }
});

// POST /interview/call — start an OUTBOUND PHONE interview via Vapi. The Vapi
// voice agent runs the mind-dump persona; the end-of-call transcript arrives at
// the public webhook below and is ingested automatically.
//   VAPI_API_KEY · VAPI_PHONE_NUMBER_ID · PUBLIC_API_URL · (VAPI_WEBHOOK_SECRET, VAPI_VOICE_ID)
/* eslint-disable @typescript-eslint/no-explicit-any */
interviewRouter.post('/orgs/:orgId/interview/call', requireMember(), async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const body = (req.body || {}) as { phoneNumber?: string; interviewee?: string; role?: string; topic?: string };
  const phone = (body.phoneNumber || '').toString().trim();
  const who = (body.interviewee || '').toString().trim() || 'Team member';
  const role = (body.role || '').toString().trim();
  const topic = (body.topic || '').toString().trim();
  const cfg = await getPlatformIntegrations();
  const publicUrl = cfg.publicApiUrl.replace(/\/$/, '');

  if (!cfg.vapiApiKey || !cfg.vapiPhoneNumberId) { res.status(503).json({ error: 'Phone interviews are not configured — add a Vapi API key + phone number ID in Admin → Integrations.' }); return; }
  if (!/^\+?[0-9][0-9\s().-]{6,}$/.test(phone)) { res.status(400).json({ error: 'Enter a valid phone number in E.164 format, e.g. +14155551234.' }); return; }

  const assistant = buildVapiAssistant(who, role, topic, 'phone', cfg.vapiVoiceId);
  assistant.metadata = { orgId, ownerId: req.user!.id, interviewee: who, role, date: new Date().toISOString().slice(0, 10), topic };
  // Only wire the transcript webhook if we have a public URL Vapi can reach.
  // Without it the call still happens; the transcript just isn't auto-saved.
  if (publicUrl) {
    assistant.server = { url: `${publicUrl}/api/webhooks/vapi`, ...(cfg.vapiWebhookSecret ? { secret: cfg.vapiWebhookSecret } : {}) };
    assistant.serverMessages = ['end-of-call-report'];
  }

  try {
    const r = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.vapiApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumberId: cfg.vapiPhoneNumberId, customer: { number: phone }, assistant }),
    });
    const raw = await r.text();
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { /* non-JSON */ }
    if (!r.ok) {
      const m = parsed?.message;
      const reason = Array.isArray(m) ? m.join('; ') : (m || parsed?.error?.message || raw.slice(0, 300) || `HTTP ${r.status}`);
      res.status(502).json({ error: `Vapi ${r.status}: ${reason}` });
      return;
    }
    res.json({ callId: parsed?.id ?? null, status: parsed?.status ?? 'queued', transcriptCaptured: !!publicUrl });
  } catch (err) {
    console.error('vapi call failed', err);
    res.status(500).json({ error: 'Failed to start the phone interview' });
  }
});

// POST /interview/web-config — config for an IN-BROWSER voice call (Vapi Web SDK).
// Returns the public key + assistant; the browser runs the call and captures the
// transcript, saving via /finish. No phone number or public URL needed.
interviewRouter.post('/orgs/:orgId/interview/web-config', requireMember(), async (req: Request, res: Response) => {
  const cfg = await getPlatformIntegrations();
  if (!cfg.vapiPublicKey) { res.status(503).json({ error: 'In-browser voice calls are not configured — add a Vapi public key in Admin → Integrations.' }); return; }
  const body = (req.body || {}) as { interviewee?: string; role?: string; topic?: string };
  const who = (body.interviewee || '').toString().trim() || 'Team member';
  const role = (body.role || '').toString().trim();
  const topic = (body.topic || '').toString().trim();
  res.json({ publicKey: cfg.vapiPublicKey, assistant: buildVapiAssistant(who, role, topic, 'voice', cfg.vapiVoiceId) });
});

// POST /api/webhooks/vapi — Vapi posts call events here. On end-of-call we take
// the transcript and ingest it via serviceClient (no user session). Public route.
vapiWebhookRouter.post('/webhooks/vapi', async (req: Request, res: Response) => {
  const { vapiWebhookSecret: VAPI_WEBHOOK_SECRET } = await getPlatformIntegrations();
  if (VAPI_WEBHOOK_SECRET) {
    const sig = (req.header('x-vapi-secret') || '').trim();
    if (sig !== VAPI_WEBHOOK_SECRET) { res.status(403).json({ error: 'Invalid signature' }); return; }
  }
  const msg = (req.body?.message ?? {}) as any;
  // Ack everything; only act on the end-of-call report.
  if (msg.type !== 'end-of-call-report') { res.json({ ok: true }); return; }
  try {
    const meta = (msg.call?.metadata ?? msg.assistant?.metadata ?? msg.metadata ?? {}) as any;
    const orgId = (meta.orgId || '').toString();
    const ownerId = (meta.ownerId || '').toString();
    if (!orgId || !ownerId) { res.json({ ok: true, skipped: 'no metadata' }); return; }

    const who = (meta.interviewee || 'Team member').toString();
    const role = (meta.role || '').toString();
    const date = (meta.date || new Date().toISOString().slice(0, 10)).toString();
    const tags = meta.topic ? [String(meta.topic)] : [];
    const transcript = (msg.transcript || msg.artifact?.transcript || '').toString().trim();
    const summary = (msg.summary || msg.analysis?.summary || '').toString().trim();
    if (!transcript && !summary) { res.json({ ok: true, skipped: 'empty transcript' }); return; }

    const heading = `Interview: ${who}${role ? ` — ${role}` : ''}`;
    const content = [
      `# ${heading}`,
      `_Captured ${date}${role ? ` · ${role}` : ''} · phone call (Vapi)_`,
      '',
      summary ? `**Summary:** ${summary}\n` : '',
      '## Transcript',
      transcript || '(no transcript text)',
    ].filter(Boolean).join('\n');

    await saveKnowledgeNote(serviceClient, orgId, ownerId, { interviewee: who, role, date, tags, content, source: 'vapi-phone' });
    res.json({ ok: true });
  } catch (err) {
    console.error('vapi webhook failed', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
/* eslint-enable @typescript-eslint/no-explicit-any */
