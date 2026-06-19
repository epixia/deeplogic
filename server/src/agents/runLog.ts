// AI Activity Log helpers — record agent runs and their step-by-step trace into
// the unified agent_runs / agent_run_events tables. Best-effort: logging never
// throws into the caller, so a logging failure can't break an actual agent run.
//
// `db` is the caller's client: the RLS client for app-side runs, or the service
// client for the public VM callback (no user session).

import type { SupabaseClient } from '@supabase/supabase-js';

export type RunTrigger = 'manual' | 'schedule' | 'chat' | 'goal' | 'orchestrator' | 'deploy';
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type EventKind = 'step' | 'tool_call' | 'tool_result' | 'reasoning' | 'output';

export interface BeginRunOpts {
  orgId: string;
  agentId?: string | null;
  externalAgentId?: string | null;
  agentKind?: 'internal' | 'external';
  agentName: string;
  trigger: RunTrigger;
  model?: string | null;
  triggerContext?: Record<string, unknown>;
  groupId?: string | null;
  groupLabel?: string | null;
}

// Open a run record. Returns the run id (or null if the insert failed — callers
// treat null as "logging unavailable" and carry on).
export async function beginRun(db: SupabaseClient, opts: BeginRunOpts): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('agent_runs')
      .insert({
        org_id: opts.orgId,
        agent_id: opts.agentId ?? null,
        external_agent_id: opts.externalAgentId ?? null,
        agent_kind: opts.agentKind ?? (opts.externalAgentId ? 'external' : 'internal'),
        agent_name: opts.agentName.slice(0, 200),
        trigger: opts.trigger,
        model: opts.model ?? null,
        trigger_context: opts.triggerContext ?? {},
        group_id: opts.groupId ?? null,
        group_label: opts.groupLabel ?? null,
      })
      .select('id')
      .maybeSingle();
    if (error) { console.error('[runLog] beginRun failed', error.message); return null; }
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.error('[runLog] beginRun threw', e);
    return null;
  }
}

export async function appendEvent(
  db: SupabaseClient, orgId: string, runId: string | null,
  kind: EventKind, message: string, icon?: string, data?: unknown,
): Promise<void> {
  if (!runId) return;
  try {
    await db.from('agent_run_events').insert({
      run_id: runId, org_id: orgId, kind,
      icon: icon ?? null, message: (message ?? '').slice(0, 2000),
      data: data ?? null,
    });
  } catch (e) {
    console.error('[runLog] appendEvent threw', e);
  }
}

export async function finishRun(
  db: SupabaseClient, runId: string | null, status: RunStatus,
  fields: { result?: string; error?: string; tokensIn?: number; tokensOut?: number } = {},
): Promise<void> {
  if (!runId) return;
  try {
    await db.from('agent_runs').update({
      status,
      result: fields.result != null ? fields.result.slice(0, 20000) : null,
      error: fields.error != null ? fields.error.slice(0, 2000) : null,
      tokens_in: fields.tokensIn ?? null,
      tokens_out: fields.tokensOut ?? null,
      finished_at: new Date().toISOString(),
    }).eq('id', runId);
  } catch (e) {
    console.error('[runLog] finishRun threw', e);
  }
}

// For deployed (external) agents whose work is reported asynchronously: find the
// currently-running run for this external agent, or open one. Idempotent so both
// the lifecycle advancer and the VM callback can call it without duplicating.
export async function ensureExternalRun(
  db: SupabaseClient, orgId: string, externalAgentId: string, agentName: string, model?: string | null,
): Promise<string | null> {
  try {
    const { data } = await db
      .from('agent_runs').select('id')
      .eq('org_id', orgId).eq('external_agent_id', externalAgentId).eq('status', 'running')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const existing = (data as { id: string } | null)?.id;
    if (existing) return existing;
  } catch { /* fall through to create */ }
  return beginRun(db, { orgId, externalAgentId, agentKind: 'external', agentName, trigger: 'deploy', model: model ?? null });
}
