// Orgo.ai integration — provision and control virtual computers for autonomous
// agents. https://docs.orgo.ai  Base: https://www.orgo.ai/api  Auth: Bearer sk_live_...
//
// We talk to Orgo over plain REST (no SDK dependency). The flow we use:
//   1. ensure a workspace            POST /workspaces
//   2. provision a computer          POST /computers
//   3. run a mission on the computer POST /v1/chat/completions (OpenAI-compatible;
//      Orgo's agent drives the VM with screenshots/click/type to do the task)
//   4. stop / destroy                POST /computers/:id/stop · DELETE /computers/:id
//
// Response field names are handled defensively — Orgo's exact shapes aren't all
// documented, so we probe a few common keys for status/host.

const ORGO_BASE = 'https://www.orgo.ai/api';

export interface OrgoComputer {
  id: string;
  status?: string;
  host?: string;
  raw: unknown;
}

async function orgoReq(apiKey: string, path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Response> {
  return fetch(`${ORGO_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// Validate a key without provisioning anything: a list call that only needs auth.
export async function orgoTestKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await orgoReq(apiKey, '/workspaces', { method: 'GET' });
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Invalid or unauthorized API key.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'request failed' };
  }
}

export async function orgoEnsureWorkspace(apiKey: string, name: string): Promise<string> {
  const r = await orgoReq(apiKey, '/workspaces', { method: 'POST', body: JSON.stringify({ name }) });
  if (!r.ok) throw new Error(`Orgo workspace create failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { id?: string };
  if (!j.id) throw new Error('Orgo workspace create returned no id.');
  return j.id;
}

function pickHost(j: Record<string, unknown>): string | undefined {
  for (const k of ['url', 'host', 'connection_url', 'vnc_url', 'stream_url', 'dashboard_url']) {
    if (typeof j[k] === 'string' && j[k]) return j[k] as string;
  }
  return typeof j.id === 'string' ? `https://www.orgo.ai/computers/${j.id}` : undefined;
}
function normalizeComputer(j: Record<string, unknown>): OrgoComputer {
  const status = typeof j.status === 'string' ? j.status : (typeof j.state === 'string' ? j.state : undefined);
  return { id: String(j.id ?? ''), status, host: pickHost(j), raw: j };
}

export async function orgoCreateComputer(
  apiKey: string,
  opts: { workspaceId: string; name: string; cpu?: number; ram?: number },
): Promise<OrgoComputer> {
  const r = await orgoReq(apiKey, '/computers', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: opts.workspaceId, name: opts.name, os: 'linux',
      cpu: opts.cpu ?? 1, ram: opts.ram ?? 4,
    }),
  }, 30_000);
  if (!r.ok) throw new Error(`Orgo computer create failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return normalizeComputer((await r.json()) as Record<string, unknown>);
}

export async function orgoGetComputer(apiKey: string, id: string): Promise<OrgoComputer | null> {
  try {
    const r = await orgoReq(apiKey, `/computers/${id}`, { method: 'GET' });
    if (!r.ok) return null;
    return normalizeComputer((await r.json()) as Record<string, unknown>);
  } catch {
    return null;
  }
}

// Run a natural-language mission on the computer. Orgo's agent loop executes it
// and returns a final assistant message. Missions can run for minutes.
export async function orgoRunMission(
  apiKey: string,
  computerId: string,
  mission: string,
  model = 'claude-sonnet-4-6',
): Promise<{ text: string }> {
  const r = await orgoReq(apiKey, '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model, computer_id: computerId, messages: [{ role: 'user', content: mission }] }),
  }, 600_000);
  if (!r.ok) throw new Error(`Orgo mission failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: j.choices?.[0]?.message?.content ?? '' };
}

export async function orgoStop(apiKey: string, id: string): Promise<void> {
  await orgoReq(apiKey, `/computers/${id}/stop`, { method: 'POST' }).catch(() => undefined);
}

export async function orgoDestroy(apiKey: string, id: string): Promise<void> {
  const r = await orgoReq(apiKey, `/computers/${id}`, { method: 'DELETE' }).catch(() => null);
  if (!r || !r.ok) await orgoStop(apiKey, id);
}
