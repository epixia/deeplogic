// End-to-end multi-tenant smoke test against the running API + local Supabase.
const SUPA = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const API = 'http://localhost:8787/api';

let pass = 0,
  fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + msg);
  } else {
    fail++;
    console.log('  FAIL  ' + msg);
  }
}

async function signup(email, password) {
  const r = await fetch(`${SUPA}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('signup failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function api(token, path, init = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

const stamp = Date.now();
const userA = `a_${stamp}@deeplogic.test`;
const userB = `b_${stamp}@deeplogic.test`;

console.log('\n# Multi-tenant smoke test\n');

const tokA = await signup(userA, 'password123');
const tokB = await signup(userB, 'password123');
ok(!!tokA && !!tokB, 'signed up two users, got JWTs');

// /api/me before any org
let me = await api(tokA, '/me');
ok(me.status === 200 && me.body.user.email === userA, '/api/me returns user A');
ok(Array.isArray(me.body.orgs) && me.body.orgs.length === 0, 'user A has no orgs yet');

// create org A -> seeds samples
const orgARes = await api(tokA, '/orgs', {
  method: 'POST',
  body: JSON.stringify({ name: 'Acme Analytics' }),
});
ok(orgARes.status === 200 || orgARes.status === 201, 'POST /api/orgs created org A');
const orgA = orgARes.body;
ok(orgA && orgA.role === 'owner', 'creator is owner of org A');

const modelsA = await api(tokA, `/orgs/${orgA.id}/models`);
ok(modelsA.status === 200 && modelsA.body.length === 2, 'org A auto-seeded with 2 sample models');
const names = (modelsA.body || []).map((m) => m.name).sort();
ok(
  JSON.stringify(names) === JSON.stringify(['Atlas Retail', 'Northwind SaaS']),
  'seeded models are Atlas Retail + Northwind SaaS',
);

// anomalies + approve + audit on org A's first model
const m0 = modelsA.body[0];
const anomA = await api(tokA, `/orgs/${orgA.id}/models/${m0.id}/anomalies`);
ok(anomA.status === 200 && Array.isArray(anomA.body), 'anomalies endpoint works for org A');
const anomalyCount = (anomA.body || []).length;
ok(anomalyCount >= 1, `engine flagged ${anomalyCount} anomaly(ies) on "${m0.name}"`);

if (anomalyCount > 0) {
  const an = anomA.body[0];
  const appr = await api(
    tokA,
    `/orgs/${orgA.id}/models/${m0.id}/actions/${an.id}/approve`,
    { method: 'POST' },
  );
  ok(appr.status === 200 || appr.status === 201, 'approving an anomaly persists an audit entry');
  const auditA = await api(tokA, `/orgs/${orgA.id}/models/${m0.id}/audit`);
  ok(
    auditA.status === 200 && auditA.body.length >= 1,
    `audit log persisted (${(auditA.body || []).length} entr(y/ies))`,
  );
}

// ask
const askA = await api(tokA, `/orgs/${orgA.id}/models/${m0.id}/ask`, {
  method: 'POST',
  body: JSON.stringify({ question: 'What is revenue?' }),
});
ok(askA.status === 200 && typeof askA.body.answer === 'string', 'Ask DeepLogic returns an answer');

// --- RLS isolation: user B must NOT see org A ---
const orgBRes = await api(tokB, '/orgs', {
  method: 'POST',
  body: JSON.stringify({ name: 'Globex BI' }),
});
const orgB = orgBRes.body;
ok(orgB && orgB.id !== orgA.id, 'user B created a separate org B');

const bSeesA = await api(tokB, `/orgs/${orgA.id}/models`);
ok(
  bSeesA.status === 403 || (bSeesA.status === 200 && (bSeesA.body || []).length === 0),
  `RLS: user B blocked from org A models (got HTTP ${bSeesA.status})`,
);

const bModelOfA = await api(tokB, `/orgs/${orgA.id}/models/${m0.id}`);
ok(
  bModelOfA.status === 403 || bModelOfA.status === 404,
  `RLS: user B cannot read org A's model directly (got HTTP ${bModelOfA.status})`,
);

const meB = await api(tokB, '/me');
ok(
  meB.body.orgs.length === 1 && meB.body.orgs[0].id === orgB.id,
  'user B only sees their own org',
);

console.log(`\n# Result: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
