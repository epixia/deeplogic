// Supabase client factory (PRD v2).
// - serviceClient: trusted, service-role key; bypasses RLS. Used for seeding,
//   compute, and admin-only operations (auth.users lookups).
// - userClientFor(token): anon key + the caller's JWT in the Authorization
//   header, so every query runs under the caller's RLS context.
// - getUserFromToken(token): verify a JWT and return the auth user.

import 'dotenv/config';
import { createHmac } from 'node:crypto';
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
// PostgREST validates JWTs with this HS256 secret. We re-issue a short-lived
// token for each request (see mintPgToken) so the data layer accepts it even
// when GoTrue signs user tokens with a different (e.g. ES256) scheme. Defaults
// to the standard local Supabase secret; set SUPABASE_JWT_SECRET in prod.
const SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

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
 * Mint a short-lived HS256 JWT that PostgREST trusts, for an already-verified
 * user. This decouples the data layer from GoTrue's token signing scheme: the
 * server verifies the incoming token (getUserFromToken), then issues its own
 * token so RLS (auth.uid() = sub, role = authenticated) works regardless.
 */
export function mintPgToken(userId: string, email: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: userId,
    email,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${SUPABASE_URL}/auth/v1`,
    iat: now,
    exp: now + 3600,
  });
  const sig = createHmac('sha256', SUPABASE_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

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

/** Verify a JWT and return its auth user (or null).
 *
 * Local Supabase now signs JWTs with asymmetric keys (ES256) and its GoTrue
 * /user endpoint can reject its own tokens, so we verify LOCALLY against the
 * published JWKS via auth.getClaims() (handles ES256 + HS256). We fall back to
 * the legacy getUser() call for stacks where getClaims isn't available. */
export async function getUserFromToken(
  token: string
): Promise<{ id: string; email: string } | null> {
  // Preferred: local signature verification against the project JWKS.
  try {
    // getClaims exists in newer supabase-js; guard for older versions.
    const auth = serviceClient.auth as unknown as {
      getClaims?: (jwt: string) => Promise<{
        data: { claims?: { sub?: string; email?: string } } | null;
        error: unknown;
      }>;
    };
    if (typeof auth.getClaims === 'function') {
      const { data, error } = await auth.getClaims(token);
      if (!error && data?.claims?.sub) {
        return { id: String(data.claims.sub), email: String(data.claims.email ?? '') };
      }
    }
  } catch {
    /* fall through to getUser */
  }

  // Fallback: ask GoTrue (works on HS256 stacks).
  try {
    const { data, error } = await serviceClient.auth.getUser(token);
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? '' };
  } catch {
    return null;
  }
}
