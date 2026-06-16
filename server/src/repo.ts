// Repository layer (PRD v2). Postgres-backed model + audit + org/member access.
// Model reads/writes go through a caller-bound client (RLS-scoped). Org/owner
// bootstrap seeding and auth.users lookups use the service client.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SemanticModel, AuditEntry } from './types.js';
import { SAMPLES } from './data/index.js';

/** A model row's listing shape (id,name,source). */
export interface ModelListItem {
  id: string;
  name: string;
  source: SemanticModel['source'];
}

/** Org membership returned to the client. */
export interface OrgMembership {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
}

/** A roster member (joined with the auth email). */
export interface Member {
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** List models for an org (RLS-scoped via db). */
export async function listModels(
  db: SupabaseClient,
  orgId: string
): Promise<ModelListItem[]> {
  const { data, error } = await db
    .from('models')
    .select('id, name, source')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ModelListItem[];
}

/**
 * Load one model as a SemanticModel: spread the stored data jsonb, then
 * override id/name from the row (authoritative). Returns null if not found.
 */
export async function getModel(
  db: SupabaseClient,
  orgId: string,
  modelId: string
): Promise<SemanticModel | null> {
  const { data, error } = await db
    .from('models')
    .select('id, name, source, data')
    .eq('org_id', orgId)
    .eq('id', modelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as {
    id: string;
    name: string;
    source: SemanticModel['source'];
    data: SemanticModel;
  };
  return {
    ...row.data,
    id: row.id,
    name: row.name,
    source: row.source,
  };
}

/** Insert a model row; returns its new id. */
export async function createModelRow(
  db: SupabaseClient,
  orgId: string,
  model: { name: string; source: SemanticModel['source']; data: SemanticModel }
): Promise<string> {
  const { data, error } = await db
    .from('models')
    .insert({
      org_id: orgId,
      name: model.name,
      source: model.source,
      data: model.data,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Insert an audit row and return it mapped to the AuditEntry type. */
export async function insertAudit(
  db: SupabaseClient,
  orgId: string,
  modelId: string,
  entry: { actor: AuditEntry['actor']; summary: string }
): Promise<AuditEntry> {
  const { data, error } = await db
    .from('audit_entries')
    .insert({
      org_id: orgId,
      model_id: modelId,
      actor: entry.actor,
      summary: entry.summary,
    })
    .select('id, ts, actor, summary')
    .single();
  if (error) throw new Error(error.message);
  const row = data as { id: string; ts: string; actor: AuditEntry['actor']; summary: string };
  return { id: row.id, ts: row.ts, actor: row.actor, summary: row.summary };
}

/** List audit entries for a model (newest last), mapped to AuditEntry[]. */
export async function listAudit(
  db: SupabaseClient,
  orgId: string,
  modelId: string
): Promise<AuditEntry[]> {
  const { data, error } = await db
    .from('audit_entries')
    .select('id, ts, actor, summary')
    .eq('org_id', orgId)
    .eq('model_id', modelId)
    .order('ts', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    id: string;
    ts: string;
    actor: AuditEntry['actor'];
    summary: string;
  }[]).map((r) => ({ id: r.id, ts: r.ts, actor: r.actor, summary: r.summary }));
}

// ---------------------------------------------------------------------------
// Orgs + members (service-role for bootstrap + auth.users joins)
// ---------------------------------------------------------------------------

/** slug = kebab(name) + '-' + short random, to keep the unique constraint happy. */
function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'org';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
}

/**
 * Create an org, add the caller as owner, and seed BOTH sample models.
 * Uses the service client (bypasses RLS) so the bootstrap is atomic-ish.
 * Returns the caller's owner membership.
 */
export async function createOrgWithSeed(
  service: SupabaseClient,
  userId: string,
  name: string
): Promise<OrgMembership> {
  const slug = slugify(name);

  const { data: orgRow, error: orgErr } = await service
    .from('organizations')
    .insert({ name, slug, created_by: userId })
    .select('id, name, slug')
    .single();
  if (orgErr) throw new Error(orgErr.message);
  const org = orgRow as { id: string; name: string; slug: string };

  const { error: memErr } = await service
    .from('org_members')
    .insert({ org_id: org.id, user_id: userId, role: 'owner' });
  if (memErr) throw new Error(memErr.message);

  // Seed the two bundled samples as fresh model rows for this org.
  const rows = SAMPLES.map((sample) => {
    const data: SemanticModel = JSON.parse(JSON.stringify(sample));
    data.source = 'sample';
    return { org_id: org.id, name: data.name, source: 'sample', data };
  });
  const { error: seedErr } = await service.from('models').insert(rows);
  if (seedErr) throw new Error(seedErr.message);

  return { id: org.id, name: org.name, slug: org.slug, role: 'owner' };
}

/** List the orgs the user belongs to (with role). */
export async function listOrgsForUser(
  service: SupabaseClient,
  userId: string
): Promise<OrgMembership[]> {
  const { data, error } = await service
    .from('org_members')
    .select('role, organizations:org_id (id, name, slug)')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as {
    role: OrgMembership['role'];
    organizations: { id: string; name: string; slug: string } | null;
  }[];
  return rows
    .filter((r) => r.organizations)
    .map((r) => ({
      id: r.organizations!.id,
      name: r.organizations!.name,
      slug: r.organizations!.slug,
      role: r.role,
    }));
}

/** Resolve emails for a set of user ids via the admin API. */
async function emailsForUsers(
  service: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const wanted = new Set(userIds);
  // listUsers is paginated; walk pages until we've matched everyone (cap pages).
  let page = 1;
  const perPage = 1000;
  while (wanted.size > map.size && page <= 10) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      if (wanted.has(u.id)) map.set(u.id, u.email ?? '');
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return map;
}

/** List members of an org with their email + role. */
export async function listMembers(
  service: SupabaseClient,
  orgId: string
): Promise<Member[]> {
  const { data, error } = await service
    .from('org_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { user_id: string; role: Member['role'] }[];
  const emails = await emailsForUsers(
    service,
    rows.map((r) => r.user_id)
  );
  return rows.map((r) => ({
    userId: r.user_id,
    email: emails.get(r.user_id) ?? '',
    role: r.role,
  }));
}

/** Update a member's role; returns the updated member. */
export async function updateMemberRole(
  service: SupabaseClient,
  orgId: string,
  userId: string,
  role: Member['role']
): Promise<Member> {
  const { error } = await service
    .from('org_members')
    .update({ role })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  const emails = await emailsForUsers(service, [userId]);
  return { userId, email: emails.get(userId) ?? '', role };
}

/** Remove a member from an org. */
export async function removeMember(
  service: SupabaseClient,
  orgId: string,
  userId: string
): Promise<void> {
  const { error } = await service
    .from('org_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/** Find a member's current role in an org (or null). */
export async function getMemberRole(
  service: SupabaseClient,
  orgId: string,
  userId: string
): Promise<Member['role'] | null> {
  const { data, error } = await service
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { role: Member['role'] }).role;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export interface Invitation {
  id: string;
  orgId: string;
  email: string;
  role: Member['role'];
  invitedBy: string | null;
  token: string;
  acceptedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** Create or refresh (upsert) a pending invitation for an email. */
export async function createInvitation(
  service: SupabaseClient,
  orgId: string,
  email: string,
  role: Member['role'],
  invitedById: string
): Promise<Invitation> {
  const target = email.trim().toLowerCase();
  // If one already exists, delete it so we can re-invite with a fresh token.
  await service
    .from('org_invitations')
    .delete()
    .eq('org_id', orgId)
    .eq('email', target)
    .is('accepted_at', null);

  const { data, error } = await service
    .from('org_invitations')
    .insert({ org_id: orgId, email: target, role, invited_by: invitedById })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapInvitation(data as Record<string, unknown>);
}

/** List pending (not accepted, not expired) invitations for an org. */
export async function listInvitations(
  service: SupabaseClient,
  orgId: string
): Promise<Invitation[]> {
  const { data, error } = await service
    .from('org_invitations')
    .select('*')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapInvitation);
}

/** Delete a pending invitation by id. */
export async function deleteInvitation(
  service: SupabaseClient,
  orgId: string,
  invitationId: string
): Promise<void> {
  const { error } = await service
    .from('org_invitations')
    .delete()
    .eq('id', invitationId)
    .eq('org_id', orgId);
  if (error) throw new Error(error.message);
}

/**
 * Look up an invitation by token. Returns null if not found, expired, or
 * already accepted.
 */
export async function getInvitationByToken(
  service: SupabaseClient,
  token: string
): Promise<Invitation | null> {
  const { data, error } = await service
    .from('org_invitations')
    .select('*')
    .eq('token', token)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapInvitation(data as Record<string, unknown>);
}

/**
 * Accept an invitation: mark it accepted, add the user as a member.
 * Idempotent — if already a member, just marks the invitation accepted.
 */
export async function acceptInvitation(
  service: SupabaseClient,
  token: string,
  userId: string
): Promise<{ orgId: string; role: Member['role'] }> {
  const inv = await getInvitationByToken(service, token);
  if (!inv) throw new Error('Invitation not found, expired, or already used');

  // Upsert membership (may already exist if user signed up another way).
  const { error: memErr } = await service
    .from('org_members')
    .upsert(
      { org_id: inv.orgId, user_id: userId, role: inv.role },
      { onConflict: 'org_id,user_id' }
    );
  if (memErr) throw new Error(memErr.message);

  // Mark accepted.
  await service
    .from('org_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inv.id);

  return { orgId: inv.orgId, role: inv.role };
}

function mapInvitation(row: Record<string, unknown>): Invitation {
  return {
    id:          row.id as string,
    orgId:       row.org_id as string,
    email:       row.email as string,
    role:        row.role as Member['role'],
    invitedBy:   (row.invited_by as string | null) ?? null,
    token:       row.token as string,
    acceptedAt:  (row.accepted_at as string | null) ?? null,
    expiresAt:   row.expires_at as string,
    createdAt:   row.created_at as string,
  };
}

/**
 * Add an already-registered user (by email) to an org with a role.
 * Throws a clear error if no such auth user exists ("user must sign up first").
 */
export async function addMemberByEmail(
  service: SupabaseClient,
  orgId: string,
  email: string,
  role: Member['role']
): Promise<Member> {
  const target = email.trim().toLowerCase();
  // Walk the admin user list to find a matching email.
  let found: { id: string; email: string } | null = null;
  let page = 1;
  const perPage = 1000;
  while (!found && page <= 10) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      if ((u.email ?? '').toLowerCase() === target) {
        found = { id: u.id, email: u.email ?? '' };
        break;
      }
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  if (!found) {
    throw new Error('user must sign up first');
  }

  const { error } = await service
    .from('org_members')
    .upsert(
      { org_id: orgId, user_id: found.id, role },
      { onConflict: 'org_id,user_id' }
    );
  if (error) throw new Error(error.message);
  return { userId: found.id, email: found.email, role };
}
