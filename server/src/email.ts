// Thin email helper using the Resend HTTP API (no SDK dependency).
// Set RESEND_API_KEY in .env. When the key is absent, emails are logged to
// stdout instead (safe for local dev with Supabase Inbucket).

const RESEND_API = 'https://api.resend.com/emails';
const FROM = process.env.EMAIL_FROM ?? 'DeepLogic <noreply@deeplogic.app>';

interface SendOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(opts: SendOptions): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log('[email:dev] To:', opts.to, '| Subject:', opts.subject);
    return;
  }
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

export function inviteEmailHtml(params: {
  orgName: string;
  inviterEmail: string;
  role: string;
  acceptUrl: string;
  expiresAt: string;
}): string {
  const expires = new Date(params.expiresAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>You're invited to ${params.orgName}</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1a1a1a">
  <h2 style="margin-bottom:4px">You're invited to join <strong>${params.orgName}</strong></h2>
  <p style="color:#555;margin-top:4px">${params.inviterEmail} has invited you as <strong>${params.role}</strong>.</p>
  <a href="${params.acceptUrl}"
     style="display:inline-block;margin:24px 0;padding:12px 28px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
    Accept invitation
  </a>
  <p style="color:#888;font-size:13px">This link expires on ${expires}. If you don't have a DeepLogic account yet, you'll be prompted to create one first.</p>
</body>
</html>`;
}
