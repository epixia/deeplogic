// End-to-end smoke test for DeepLogic Studio (PRD v3).
const SUPA = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const API = 'http://localhost:8787/api';

let pass = 0,
  fail = 0;
const ok = (c, m) => {
  if (c) {
    pass++;
    console.log('  PASS  ' + m);
  } else {
    fail++;
    console.log('  FAIL  ' + m);
  }
};

async function signup(email) {
  const r = await fetch(`${SUPA}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password: 'password123' }),
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
  const t = await r.text();
  let body;
  try {
    body = t ? JSON.parse(t) : undefined;
  } catch {
    body = t;
  }
  return { status: r.status, body };
}

const ts = Date.now();
console.log('\n# DeepLogic Studio smoke test\n');

const tokA = await signup(`studio_a_${ts}@deeplogic.test`);
const tokB = await signup(`studio_b_${ts}@deeplogic.test`);

const orgA = (await api(tokA, '/orgs', { method: 'POST', body: JSON.stringify({ name: 'Studio Org A' }) })).body;
const orgB = (await api(tokB, '/orgs', { method: 'POST', body: JSON.stringify({ name: 'Studio Org B' }) })).body;
ok(orgA?.id && orgB?.id, 'two orgs created');

const models = (await api(tokA, `/orgs/${orgA.id}/models`)).body;
const modelId = models?.[0]?.id;
ok(!!modelId, 'org A has a grounding model available');

// empty silo
const empty = await api(tokA, `/orgs/${orgA.id}/studio/projects`);
ok(empty.status === 200 && Array.isArray(empty.body) && empty.body.length === 0, 'studio silo starts empty');

// create a project grounded in a model
const created = await api(tokA, `/orgs/${orgA.id}/studio/projects`, {
  method: 'POST',
  body: JSON.stringify({ name: 'Q2 Board Report', modelId }),
});
const proj = created.body;
ok((created.status === 200 || created.status === 201) && proj?.id, 'created a studio project');
ok(proj?.isOwner === true && proj?.visibility === 'private', 'project is owned + private by default');

// add context (a doc + an MCP descriptor)
const doc = await api(tokA, `/orgs/${orgA.id}/studio/context`, {
  method: 'POST',
  body: JSON.stringify({ kind: 'doc', name: 'Brand voice', content: 'Reports must be concise and board-ready.' }),
});
const mcp = await api(tokA, `/orgs/${orgA.id}/studio/context`, {
  method: 'POST',
  body: JSON.stringify({ kind: 'mcp', name: 'Snowflake MCP', meta: { url: 'https://mcp.example.com', description: 'Warehouse access' } }),
});
ok(doc.status < 300 && mcp.status < 300, 'added doc + MCP descriptor to the Context Library');

const ctxList = await api(tokA, `/orgs/${orgA.id}/studio/context`);
ok(ctxList.status === 200 && ctxList.body.length >= 2, `context library lists items (${ctxList.body?.length})`);

// compiled context should include the doc + mcp
const compiled = await api(tokA, `/orgs/${orgA.id}/studio/projects/${proj.id}/compiled-context`);
const md = compiled.body?.markdown ?? '';
ok(compiled.status === 200 && md.includes('Brand voice') && md.includes('mcp.example.com'),
  'compiled CONTEXT.md includes the doc + MCP descriptor');

// generate (template mode — no API key)
const gen = await api(tokA, `/orgs/${orgA.id}/studio/projects/${proj.id}/generate`, {
  method: 'POST',
  body: JSON.stringify({ prompt: 'Build an executive summary of revenue and churn.' }),
});
ok(gen.status === 200 && typeof gen.body?.html === 'string' && gen.body.html.includes('<'),
  `generate returned an HTML report (usedAI=${gen.body?.usedAI})`);
ok(gen.body?.message?.role === 'assistant', 'generate appended an assistant message');

// project now has html + version + messages
const full = await api(tokA, `/orgs/${orgA.id}/studio/projects/${proj.id}`);
ok(full.body?.html?.length > 0, 'project html persisted');
ok((full.body?.versions?.length ?? 0) >= 1, `version checkpoint saved (${full.body?.versions?.length})`);
ok((full.body?.messages?.length ?? 0) >= 2, `chat history persisted (${full.body?.messages?.length} msgs)`);

// share to org
const shared = await api(tokA, `/orgs/${orgA.id}/studio/projects/${proj.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ visibility: 'org' }),
});
ok(shared.status === 200 && shared.body?.visibility === 'org', 'visibility updated to org');

// --- silo isolation: user B (different org) cannot see org A's studio ---
const bList = await api(tokB, `/orgs/${orgA.id}/studio/projects`);
ok(bList.status === 403 || (bList.status === 200 && bList.body.length === 0),
  `RLS: user B blocked from org A studio (HTTP ${bList.status})`);
const bProj = await api(tokB, `/orgs/${orgA.id}/studio/projects/${proj.id}`);
ok(bProj.status === 403 || bProj.status === 404,
  `RLS: user B cannot open org A's project (HTTP ${bProj.status})`);

// seed-from-HTML start
const seeded = await api(tokA, `/orgs/${orgA.id}/studio/projects`, {
  method: 'POST',
  body: JSON.stringify({ name: 'Imported report', seedHtml: '<!doctype html><html><body><h1>Imported</h1></body></html>' }),
});
ok(seeded.body?.html?.includes('Imported'), 'can start a project from an uploaded HTML report');

console.log(`\n# Result: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
