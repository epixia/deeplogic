// Shared provisioning for external agents (Hermes / OpenClaw). Used by both the
// manual deploy route and the assistant's deploy_agent tool, so they behave
// identically.
//
// When Orgo.ai is enabled for the org, deploying provisions a REAL Orgo virtual
// computer and runs the mission on it (Orgo's agent drives the VM). Otherwise we
// fall back to the simulated lifecycle (see advanceLifecycle in routes/agents).
//
// The Orgo work runs in the background (fire-and-forget) using the SERVICE client
// — it outlives the HTTP request, so it must not use the request's RLS client.

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { serviceClient } from '../supabase.js';
import { loadOrgoCreds, cacheOrgoWorkspace, type OrgoCreds } from '../routes/integrations.js';
import { orgoEnsureWorkspace, orgoCreateComputer, orgoRunMission, orgoStop } from '../integrations/orgo.js';
import { generateAgentSoul, type AgentSoul } from './agentSoul.js';

export type AgentProvider = 'hermes' | 'openclaw';
export type AgentRuntime = 'orgo' | 'simulated' | 'self-hosted';

export interface ProvisionParams {
  orgId: string;
  userId: string;
  provider: AgentProvider;
  name: string;
  mission: string;
  reason: string;
  deployedVia: 'ui' | 'chat';
  region?: string;
  size?: string;
  /** Force a runtime; 'self-hosted' = your own machine claims the mission via poll. */
  runtime?: AgentRuntime;
  /** Operator settings (budget caps / cadence / guardrails) injected into the mission. */
  settings?: AgentSettings;
}

export interface AgentSettings {
  budget?: { maxRuntimeMin?: number; maxSteps?: number; maxSpendUsd?: number };
  cadence?: 'once' | 'hourly' | 'daily' | 'weekly';
  guardrails?: { requireApproval?: boolean; readOnly?: boolean; allowedDomains?: string[] };
}

// Turn operator settings into explicit instructions the agent must follow.
function constraintsText(s?: AgentSettings): string {
  if (!s) return '';
  const lines: string[] = [];
  const b = s.budget ?? {};
  if (b.maxRuntimeMin) lines.push(`- Finish within ${b.maxRuntimeMin} minutes, then stop.`);
  if (b.maxSteps) lines.push(`- Take at most ${b.maxSteps} actions/steps total.`);
  if (b.maxSpendUsd) lines.push(`- Keep any spend under $${b.maxSpendUsd}.`);
  const g = s.guardrails ?? {};
  if (g.readOnly) lines.push('- READ-ONLY: research & report only — do NOT send messages or take outbound actions.');
  if (g.requireApproval) lines.push('- Do NOT send any outbound message without approval — draft it and report back instead.');
  if (g.allowedDomains?.length) lines.push(`- Only interact with these domains: ${g.allowedDomains.join(', ')}.`);
  return lines.length ? `\n\n## Operating constraints (must respect)\n${lines.join('\n')}` : '';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function logEvent(db: SupabaseClient, orgId: string, agentId: string, kind: string, message: string, data?: unknown) {
  await db.from('external_agent_events').insert({ agent_id: agentId, org_id: orgId, kind, message, data: data ?? null });
}

// Node's `fetch failed` hides the real reason in `.cause` — surface it so the
// Activity log shows ECONNRESET / timeout / DNS instead of a bare message.
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown error';
  const cause = (e as { cause?: unknown }).cause;
  if (cause) {
    const c = cause as { code?: string; message?: string };
    const detail = c.code || c.message || (typeof cause === 'string' ? cause : '');
    if (detail) return `${e.message} — ${detail}`;
  }
  return e.message;
}

async function failAgent(orgId: string, agentId: string, message: string) {
  await serviceClient.from('external_agents')
    .update({ status: 'failed', mission_status: 'failed', mission_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', agentId);
  await logEvent(serviceClient, orgId, agentId, 'failed', `Orgo error: ${message}`.slice(0, 1000));
}

// Background: provision a real Orgo computer, then run the mission on it.
async function runOrgoAgent(orgId: string, agentId: string, provider: AgentProvider, name: string, mission: string, creds: OrgoCreds, soul: AgentSoul | null, settings?: AgentSettings) {
  // 1) Ensure a workspace for this org (cached after first use).
  let workspaceId = creds.workspaceId;
  if (!workspaceId) {
    workspaceId = await orgoEnsureWorkspace(creds.apiKey, `deeplogic-${orgId.slice(0, 8)}`);
    await cacheOrgoWorkspace(orgId, workspaceId);
  }
  // 2) Provision the computer.
  const comp = await orgoCreateComputer(creds.apiKey, { workspaceId, name: name.slice(0, 60) || provider });
  await serviceClient.from('external_agents').update({
    status: 'running', host: comp.host ?? null,
    config: { runtime: 'orgo', orgo: { computerId: comp.id, workspaceId } },
    mission_status: mission ? 'in_progress' : 'pending',
    mission_started_at: mission ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', agentId);
  await logEvent(serviceClient, orgId, agentId, 'provisioned', `Orgo VM provisioned${comp.host ? ` (${comp.host})` : ''}.`);
  if (!mission) return;

  // 3) Run the mission via Orgo's agent loop (can take minutes).
  await logEvent(serviceClient, orgId, agentId, 'mission_started', `Mission started on Orgo: ${mission.slice(0, 160)}`);
  const persona = soul
    ? `You are ${soul.name}. ${soul.soul}\n\n## Your operator profile (human.md)\n${soul.humanMd}\n\n## Your skills\n${soul.skills.join(', ')}\n\n## Goal\n${soul.goal}`
    : (provider === 'hermes'
        ? 'You are Hermes, an autonomous outreach & messaging agent running on a cloud computer.'
        : 'You are OpenClaw, an autonomous web-scraping & data-extraction agent running on a cloud computer.');
  let text: string;
  try {
    ({ text } = await orgoRunMission(creds.apiKey, comp.id, `${persona}\n\n## Mission\n${mission}${constraintsText(settings)}`));
  } catch (e) {
    // Don't leave a VM billing after a failed mission.
    await orgoStop(creds.apiKey, comp.id).catch(() => undefined);
    throw e;
  }
  await serviceClient.from('external_agents').update({
    mission_status: 'completed',
    result: { summary: text.slice(0, 4000), source: 'orgo', finishedAt: new Date().toISOString() },
    mission_completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', agentId);
  await logEvent(serviceClient, orgId, agentId, 'completed', 'Mission fulfilled on Orgo — results reported back to DeepLogic central.', { summary: text.slice(0, 2000) });
}

// Insert the agent row, log the deploy event, and (if Orgo is enabled) kick off
// real provisioning + mission in the background. Returns the inserted row and
// which runtime was chosen.
export async function provisionExternalAgent(
  db: SupabaseClient,
  p: ProvisionParams,
): Promise<{ row: any; runtime: AgentRuntime }> {
  const selfHosted = p.runtime === 'self-hosted';
  // Self-hosted skips Orgo entirely — your own machine runs the mission.
  const creds = selfHosted ? null : await loadOrgoCreds(p.orgId);
  const runtime: AgentRuntime = selfHosted ? 'self-hosted' : (creds ? 'orgo' : 'simulated');
  const id = randomUUID();
  const now = new Date().toISOString();
  const mission = p.mission.trim();

  // The orchestrator gives every agent a distinct identity (random name, soul,
  // human.md, skills, refined goal) — injected into the Orgo mission.
  const soul = mission
    ? await generateAgentSoul(p.orgId, { provider: p.provider, mission, nameHint: p.name }).catch(() => null)
    : null;
  const agentName = (soul?.name || p.name.trim() || (p.provider === 'hermes' ? 'Hermes agent' : 'OpenClaw agent')).slice(0, 80);

  const { data, error } = await db.from('external_agents').insert({
    id, org_id: p.orgId, created_by: p.userId, provider: p.provider,
    name: agentName,
    // Self-hosted is "running" immediately (the machine exists) and waits for the
    // worker to claim the mission via /agent-poll.
    status: selfHosted ? 'running' : 'provisioning', region: p.region ?? 'us-east', size: p.size ?? 'small',
    mission: mission.slice(0, 2000), reason: p.reason.trim().slice(0, 1000),
    deployed_via: p.deployedVia, mission_status: 'pending',
    callback_token: randomUUID(), config: { runtime, ...(soul ? { soul } : {}), ...(p.settings ? { settings: p.settings } : {}) },
    created_at: now, updated_at: now,
  }).select('*').single();
  if (error) throw new Error(error.message);

  await logEvent(db, p.orgId, id, selfHosted ? 'message' : 'deployed',
    selfHosted
      ? 'Registered a self-hosted runtime — waiting for your worker to claim the mission.'
      : (mission ? `Deployed for mission: ${mission.slice(0, 160)}` : 'Deployed (no mission set).'));

  if (creds) {
    void runOrgoAgent(p.orgId, id, p.provider, agentName, mission, creds, soul, p.settings)
      .catch((e) => void failAgent(p.orgId, id, describeError(e)));
  }
  return { row: data, runtime };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
