// Smoke test for BYOK AI settings + team ownership (PRD v3.1/3.2).
const SUPA = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const API = 'http://localhost:8787/api';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

async function signup(email) {
  const r = await fetch(`${SUPA}/auth/v1/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ email, password: 'password123' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('signup failed: ' + JSON.stringify(j));
  return j.access_token;
}
async function api(token, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const t = await r.text(); let body; try { body = t ? JSON.parse(t) : undefined; } catch { body = t; }
  return { status: r.status, body, raw: t };
}

const ts = Date.now();
const emailA = `owner_${ts}@deeplogic.test`;
const emailB = `member_${ts}@deeplogic.test`;
console.log('\n# Studio BYOK + ownership smoke test\n');

const tokA = await signup(emailA);
const tokB = await signup(emailB);
const orgA = (await api(tokA, '/orgs', { method: 'POST', body: JSON.stringify({ name: 'Team Org' }) })).body;
ok(orgA?.id, 'owner created org');

// add B as a member of org A
const added = await api(tokA, `/orgs/${orgA.id}/members`, { method: 'POST', body: JSON.stringify({ email: emailB, role: 'member' }) });
ok(added.status < 300, `added ${emailB} as member`);

// --- AI settings (BYOK, multi-provider list) ---
const findP = (body, id) => body.providers.find((p) => p.id === id);
let s = await api(tokA, `/orgs/${orgA.id}/studio/ai-settings`);
ok(s.status === 200 && s.body.active === 'anthropic' && s.body.providers.length === 3 && s.body.canEdit === true,
  'default ai-settings: 3 providers listed, anthropic active, owner can edit');
ok(s.body.providers.every((p) => p.hasKey === false), 'no keys set initially');

// save keys for TWO providers + set active
const put = await api(tokA, `/orgs/${orgA.id}/studio/ai-settings`, { method: 'PUT', body: JSON.stringify({
  active: 'openrouter',
  entries: [
    { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet', apiKey: 'sk-or-secret-123' },
    { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-openai-secret' },
  ],
}) });
ok(put.status === 200 && put.body.active === 'openrouter', 'owner set active = openrouter');
ok(findP(put.body, 'openrouter').hasKey && findP(put.body, 'openai').hasKey && !findP(put.body, 'anthropic').hasKey,
  'keys saved for openrouter + openai, anthropic still empty');
ok(!put.raw.includes('sk-or-secret') && !put.raw.includes('sk-openai-secret'), 'response does NOT leak raw keys');

// test all keys (cheap validation; fake keys -> ok:false, but reachable)
const test = await api(tokA, `/orgs/${orgA.id}/studio/ai-settings/test`, { method: 'POST' });
ok(test.status === 200 && Array.isArray(test.body), 'test-all returns results');
ok(findP({ providers: test.body }, 'openrouter').hasKey === true && findP({ providers: test.body }, 'anthropic').hasKey === false,
  'test reports which providers have keys');
ok(!test.raw.includes('secret'), 'test results never include raw keys');

// member can read status but not edit
const sB = await api(tokB, `/orgs/${orgA.id}/studio/ai-settings`);
ok(sB.status === 200 && sB.body.canEdit === false && findP(sB.body, 'openrouter').hasKey === true,
  'member can read provider status (canEdit=false)');
const putB = await api(tokB, `/orgs/${orgA.id}/studio/ai-settings`, { method: 'PUT', body: JSON.stringify({ active: 'openai' }) });
ok(putB.status === 403, 'member CANNOT change AI settings (403)');

// preserve a provider's key when apiKey omitted; clear another with ""
const put2 = await api(tokA, `/orgs/${orgA.id}/studio/ai-settings`, { method: 'PUT', body: JSON.stringify({
  entries: [ { provider: 'openrouter', model: 'x/y' }, { provider: 'openai', apiKey: '' } ],
}) });
ok(findP(put2.body, 'openrouter').hasKey === true, 'omitting apiKey preserves that key');
ok(findP(put2.body, 'openai').hasKey === false, 'empty apiKey clears that key');

// --- ownership ---
const proj = (await api(tokA, `/orgs/${orgA.id}/studio/projects`, { method: 'POST', body: JSON.stringify({ name: 'Shared Board Report' }) })).body;
await api(tokA, `/orgs/${orgA.id}/studio/projects/${proj.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'org' }) });

const listA = await api(tokA, `/orgs/${orgA.id}/studio/projects`);
const mineCard = listA.body.find((p) => p.id === proj.id);
ok(mineCard?.isOwner === true && mineCard?.ownerEmail === emailA, 'owner sees their report with their email + isOwner');

const listB = await api(tokB, `/orgs/${orgA.id}/studio/projects`);
const sharedCard = listB.body.find((p) => p.id === proj.id);
ok(!!sharedCard && sharedCard.isOwner === false && sharedCard.ownerEmail === emailA,
  `member sees the shared report attributed to owner (${emailA})`);

const getB = await api(tokB, `/orgs/${orgA.id}/studio/projects/${proj.id}`);
ok(getB.status === 200 && getB.body.ownerEmail === emailA && getB.body.isOwner === false,
  'member opening the report sees owner attribution (read-only)');

console.log(`\n# Result: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
