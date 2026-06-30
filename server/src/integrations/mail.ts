// Outbound mail via the admin-configured SMTP server (platform_settings → 'mail').
// nodemailer is an optional dependency: it's imported dynamically so the app runs
// without it; mail features just report that it needs installing.

import { serviceClient } from '../supabase.js';

export interface MailSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
}

const EMPTY: MailSettings = { host: '', port: 587, secure: false, username: '', password: '', fromName: '', fromEmail: '' };

export async function loadMailSettings(): Promise<MailSettings> {
  const { data } = await serviceClient.from('platform_settings').select('value').eq('key', 'mail').maybeSingle();
  return { ...EMPTY, ...((data?.value ?? {}) as Partial<MailSettings>) };
}

export async function saveMailSettings(next: MailSettings): Promise<void> {
  await serviceClient.from('platform_settings').upsert({ key: 'mail', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function transport(cfg: MailSettings): Promise<any> {
  if (!cfg.host) throw new Error('No SMTP host configured.');
  let nodemailer: any;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new Error('nodemailer is not installed on the server. Run `npm install` in /server.');
  }
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
  });
}

/** Send an email using the stored SMTP settings. */
export async function sendMail(to: string, subject: string, html: string, text?: string): Promise<void> {
  const cfg = await loadMailSettings();
  const t = await transport(cfg);
  const from = cfg.fromEmail ? `${cfg.fromName || 'DeepLogic'} <${cfg.fromEmail}>` : cfg.username;
  await t.sendMail({ from, to, subject, html, text: text ?? html.replace(/<[^>]+>/g, '') });
}

/** Verify the SMTP connection + credentials, then send a test message. */
export async function sendTestMail(cfg: MailSettings, to: string): Promise<void> {
  const t = await transport(cfg);
  await t.verify();
  const from = cfg.fromEmail ? `${cfg.fromName || 'DeepLogic'} <${cfg.fromEmail}>` : cfg.username;
  await t.sendMail({
    from,
    to,
    subject: 'DeepLogic test email',
    html: '<p>✅ Your DeepLogic mail server is configured correctly.</p>',
    text: 'Your DeepLogic mail server is configured correctly.',
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
