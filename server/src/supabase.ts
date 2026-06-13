// Supabase client factory (PRD v2).
// - serviceClient: trusted, service-role key; bypasses RLS. Used for seeding,
//   compute, and admin-only operations (auth.users lookups).
// - userClientFor(token): anon key + the caller's JWT in the Authorization
//   header, so every query runs under the caller's RLS context.
// - getUserFromToken(token): verify a JWT and return the auth user.

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// supabase-js constructs a Realtime client eagerly, which needs a global
// WebSocket. Node < 22 has none — polyfill it (we never use Realtime).
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[supabase] Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in server/.env'
  );
}

/**
 * Service-role client: bypasses RLS. Never bind a user JWT to this. Used for
 * org/owner bootstrap seeding and admin auth.users lookups.
 */
export const serviceClient: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

/**
 * Per-request client bound to the caller's JWT. Its queries run under the
 * caller's RLS policies (auth.uid() resolves to the token's user).
 */
export function userClientFor(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Verify a JWT and return its auth user (or null). */
export async function getUserFromToken(
  token: string
): Promise<{ id: string; email: string } | null> {
  try {
    const { data, error } = await serviceClient.auth.getUser(token);
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? '' };
  } catch {
    return null;
  }
}
