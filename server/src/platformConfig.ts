// Global platform integration config (HeyGen / Vapi) — platform-wide services
// shared by all orgs, configured by a super-admin in the Admin dashboard.
// Stored in the server's .env file: saving writes the keys back to .env AND
// updates process.env in memory so changes take effect immediately (no restart).

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface PlatformIntegrations {
  heygenApiKey: string;
  heygenAvatarId: string;
  heygenVoiceId: string;
  vapiApiKey: string;
  vapiPublicKey: string;
  vapiPhoneNumberId: string;
  vapiVoiceId: string;
  vapiWebhookSecret: string;
  publicApiUrl: string;
}

export const INTEGRATION_FIELDS: (keyof PlatformIntegrations)[] = [
  'heygenApiKey', 'heygenAvatarId', 'heygenVoiceId',
  'vapiApiKey', 'vapiPublicKey', 'vapiPhoneNumberId', 'vapiVoiceId', 'vapiWebhookSecret',
  'publicApiUrl',
];

// Which fields are secret keys (UI hides them behind a reveal toggle).
export const SECRET_FIELDS: (keyof PlatformIntegrations)[] = ['heygenApiKey', 'vapiApiKey', 'vapiWebhookSecret'];

const ENV_OF: Record<keyof PlatformIntegrations, string> = {
  heygenApiKey: 'HEYGEN_API_KEY', heygenAvatarId: 'HEYGEN_AVATAR_ID', heygenVoiceId: 'HEYGEN_VOICE_ID',
  vapiApiKey: 'VAPI_API_KEY', vapiPublicKey: 'VAPI_PUBLIC_KEY', vapiPhoneNumberId: 'VAPI_PHONE_NUMBER_ID',
  vapiVoiceId: 'VAPI_VOICE_ID', vapiWebhookSecret: 'VAPI_WEBHOOK_SECRET', publicApiUrl: 'PUBLIC_API_URL',
};

// Read the live values from process.env (loaded from .env at boot + any in-memory updates).
export async function getPlatformIntegrations(): Promise<PlatformIntegrations> {
  const out = {} as PlatformIntegrations;
  for (const k of INTEGRATION_FIELDS) out[k] = process.env[ENV_OF[k]] || '';
  return out;
}

// Admin view — actual values (the admin explicitly wants to see/edit them).
export async function getIntegrationsView(): Promise<Record<keyof PlatformIntegrations, string>> {
  const out = {} as Record<keyof PlatformIntegrations, string>;
  for (const k of INTEGRATION_FIELDS) out[k] = process.env[ENV_OF[k]] || '';
  return out;
}

function envPath(): string {
  return path.resolve(process.cwd(), '.env');
}

function quoteEnv(v: string): string {
  if (v === '') return '';
  if (/[\s#"'$]/.test(v)) return '"' + v.replace(/(["\\])/g, '\\$1') + '"';
  return v;
}

// Upsert keys into .env, preserving every other line/comment and the file order.
async function writeEnv(updates: Record<string, string>): Promise<void> {
  const p = envPath();
  let text = '';
  try { text = await fs.readFile(p, 'utf8'); } catch { text = ''; }
  const lines = text.length ? text.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      seen.add(m[1]);
      return `${m[1]}=${quoteEnv(updates[m[1]])}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${quoteEnv(v)}`);
  }
  let joined = out.join('\n');
  if (!joined.endsWith('\n')) joined += '\n';
  await fs.writeFile(p, joined, 'utf8');
}

// Persist an admin update: update process.env immediately, then write to .env.
export async function savePlatformIntegrations(patch: Partial<Record<keyof PlatformIntegrations, string>>): Promise<void> {
  const updates: Record<string, string> = {};
  for (const k of INTEGRATION_FIELDS) {
    if (!(k in patch)) continue;
    const v = (patch[k] ?? '').toString().trim();
    const env = ENV_OF[k];
    process.env[env] = v;     // take effect now
    updates[env] = v;         // persist to .env
  }
  if (Object.keys(updates).length) await writeEnv(updates);
}
