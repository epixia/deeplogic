export const meta = {
  name: 'build-deeplogic-saas',
  description: 'Add multi-tenant SaaS (Supabase auth + RLS + RBAC) to DeepLogic per PRD v2',
  phases: [
    { title: 'Core', detail: 'server auth/repo/org-scoped routes + client auth shell/api' },
    { title: 'Wire', detail: 'update existing pages to org-scoped, token-authed API' },
  ],
}

const SHARED = `
You are upgrading the EXISTING, WORKING DeepLogic app at c:/sites/deeplogic into a MULTI-TENANT SaaS.
READ FIRST: PRD.md (especially the "PRD v2 — Multi-Tenant SaaS (Supabase)" section at the end) — it is the contract.
The single-tenant app already builds and runs; the pure agent engine (server/src/engine/*) and the design system (client/src/styles/theme.css, Logo, theme tokens) MUST be preserved.

Stack decisions (locked): local Supabase (Postgres + Auth + RLS), email+password JWT, Org->members RBAC (owner/admin/member),
row-level isolation by org_id, each new org seeded with the two sample models. The DB schema + RLS already exist
(supabase/migrations/20260612000001_init.sql, already applied). Local Supabase is already running.
Tables: organizations, org_members(role in owner/admin/member), models(data jsonb = full SemanticModel), audit_entries.
RLS helpers: is_org_member(org), has_org_role(org, roles[]). Env files already exist (server/.env, client/.env).

CRITICAL CONTRACT — both the server and client must match these EXACT shapes:

CLIENT useAuth() hook (from client/src/auth/AuthContext.tsx) returns:
  { user: {id,email}|null, session, loading: boolean,
    orgs: { id:string, name:string, slug:string, role:'owner'|'admin'|'member' }[],
    refreshOrgs(): Promise<void>,
    signIn(email,password): Promise<{error?:string}>,
    signUp(email,password): Promise<{error?:string}>,
    signOut(): Promise<void>,
    getAccessToken(): Promise<string|null> }

CLIENT lib/api.ts signatures (every call takes the access token + orgId; SSE helpers append ?token=):
  getMe(token): Promise<{ user:{id,email}, orgs: OrgMembership[] }>
  createOrg(token, name): Promise<OrgMembership>                 // OrgMembership = {id,name,slug,role}
  listMembers(token, orgId): Promise<Member[]>                   // Member = {userId,email,role}
  updateMemberRole(token, orgId, userId, role): Promise<Member>
  removeMember(token, orgId, userId): Promise<void>
  addMemberByEmail(token, orgId, email, role): Promise<Member>   // adds an already-registered user; ok to surface "user must sign up first"
  listModels(token, orgId): Promise<ModelListItem[]>
  getModel(token, orgId, modelId): Promise<SemanticModel>
  ingestSample(token, orgId, sampleId): Promise<{modelId:string}>
  ingestUpload(token, orgId, file): Promise<{modelId:string}>
  anomalies(token, orgId, modelId): Promise<Anomaly[]>
  approveAction(token, orgId, modelId, anomalyId): Promise<AuditEntry>
  audit(token, orgId, modelId): Promise<AuditEntry[]>
  ask(token, orgId, modelId, question): Promise<AskAnswer>
  openIngestStream(token, orgId, modelId, handlers): EventSource    // GET /api/orgs/:orgId/ingest/:modelId/stream?token=
  openMissionStream(token, orgId, modelId, handlers): EventSource   // GET /api/orgs/:orgId/models/:modelId/mission/stream?token=
(keep the existing SSEHandlers interface + bindAgentStream behavior; just add token+orgId to the URLs)

ROUTE STRUCTURE (client React Router, App.tsx):
  '/'        Home (public)
  '/login'   Login (public)
  '/signup'  Signup (public)
  '/onboarding'                       Onboarding — create first org (RequireAuth)
  '/app/:orgId/ingest'                Ingest (RequireAuth + org)
  '/app/:orgId/dashboard/:modelId'    Dashboard
  '/app/:orgId/mission/:modelId'      Mission
  '/app/:orgId/settings'              Members/Settings (RBAC)
  '/app' (no org)  -> if user has orgs redirect to /app/<firstOrg>/ingest else /onboarding

SERVER routes (Express, all under /api). Auth: Bearer token in Authorization header; for SSE accept ?token= query too.
  GET    /api/me
  POST   /api/orgs                              {name} -> creates org + owner membership + SEEDS 2 sample models (service role)
  GET    /api/orgs/:orgId/members
  PATCH  /api/orgs/:orgId/members/:userId       {role}            (admin+; only owner manages owners)
  DELETE /api/orgs/:orgId/members/:userId                         (admin+)
  POST   /api/orgs/:orgId/members               {email, role}     (admin+; add an already-registered user)
  GET    /api/orgs/:orgId/models
  GET    /api/orgs/:orgId/models/:id
  POST   /api/orgs/:orgId/ingest                ({sampleId} or multipart file) -> {modelId}
  GET    /api/orgs/:orgId/ingest/:modelId/stream      (SSE)
  GET    /api/orgs/:orgId/models/:id/anomalies
  GET    /api/orgs/:orgId/models/:id/mission/stream   (SSE)
  POST   /api/orgs/:orgId/models/:id/actions/:anomalyId/approve  -> persisted AuditEntry
  GET    /api/orgs/:orgId/models/:id/audit
  POST   /api/orgs/:orgId/models/:id/ask        {question}
Every handler verifies org membership (defense in depth on top of RLS) and role-gates writes.
`

phase('Core')

const core = await parallel([
  () => agent(
    `${SHARED}

ROLE: SERVER. Implement the multi-tenant backend. Use the Supabase JS SDK and RLS.
Add deps to server/package.json: "@supabase/supabase-js" and "dotenv". (Do NOT run npm install.)
Create/modify ONLY server-side files:
- server/src/supabase.ts: load env (import 'dotenv/config'). Export serviceClient (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, no session persistence), userClientFor(token) (anon key + global headers Authorization Bearer token, so its queries run under the caller's RLS), and getUserFromToken(token) (serviceClient.auth.getUser(token)).
- server/src/auth.ts: Express middleware requireAuth — read token from 'Authorization: Bearer' OR req.query.token (for SSE); verify via getUserFromToken; 401 if invalid; set req.user={id,email}, req.token, req.db=userClientFor(token). Helpers requireMember(orgId) and requireRole(orgId, roles[]) using the org_members table (via service or user client); 403 on failure. (Augment Express Request types in a small d.ts or via 'declare global'.)
- server/src/repo.ts: data access:
    listModels(db, orgId), getModel(db, orgId, modelId) -> SemanticModel (spread row.data then override id=row.id, name=row.name), createModelRow(db, orgId, {name,source,data}) -> row id,
    insertAudit(db, orgId, modelId, {actor,summary}) -> AuditEntry, listAudit(db, orgId, modelId) -> AuditEntry[] (map db rows to the AuditEntry type from types.ts),
    createOrgWithSeed(service, userId, name) -> {id,name,slug,role:'owner'} : insert organization {name, slug: slugify(name)+'-'+short random, created_by:userId}; insert org_members {owner}; seed BOTH SAMPLES (import from ./data/index.js) as models rows (source 'sample'); return membership,
    listMembers(service, orgId) -> {userId,email,role}[] (join org_members with auth.users emails via service client / admin API), updateMemberRole, removeMember, addMemberByEmail (look up an existing auth user by email via service admin API; if none, throw a clear 'user must sign up first').
- Rework server/src/routes/*.ts into org-scoped routers per the ROUTE STRUCTURE: routes/me.ts, routes/orgs.ts (orgs + members), routes/models.ts (models/anomalies/audit/approve/ask), routes/ingest.ts, routes/mission.ts. Reuse the EXISTING engine (detectAnomalies, missionEvents, ingestEvents, answerQuestion, mapConnectors, extractKpis) and sse.ts helper unchanged. SSE routes read ?token. Approve persists an audit row and returns it. The agent feed/anomalies operate on the org's stored model loaded via repo.getModel.
- server/src/index.ts: import 'dotenv/config'; mount requireAuth on all /api routers except /api/health; mount the new routers.
Keep ESM '.js' import extensions. Do not touch client/ or engine/ internals. Return a short note of files created/changed.`,
    { label: 'server', phase: 'Core' }
  ),
  () => agent(
    `${SHARED}

ROLE: CLIENT SHELL + AUTH. Implement auth, org context, guards, and the shared API client. Use @supabase/supabase-js.
Add dep to client/package.json: "@supabase/supabase-js". (Do NOT run npm install.)
Create/modify ONLY these client files:
- client/src/lib/supabase.ts: browser Supabase client from import.meta.env VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (persistSession, autoRefreshToken).
- client/src/auth/AuthContext.tsx: AuthProvider + useAuth() with the EXACT shape in the contract. On mount, restore session; expose orgs via getMe(token) (refreshOrgs). getAccessToken returns session.access_token.
- client/src/auth/RequireAuth.tsx: redirect to /login if no session; render children/Outlet otherwise.
- client/src/lib/api.ts: REWRITE to the EXACT signatures in the contract (token + orgId; Authorization Bearer header; SSE helpers append ?token=). Keep SSEHandlers + bindAgentStream behavior.
- client/src/pages/Login.tsx, Signup.tsx: email+password forms using useAuth; on success go to /app. On signup, after the user is signed in, go to /onboarding if they have no orgs.
- client/src/pages/Onboarding.tsx: create the first org (createOrg) then navigate to /app/:orgId/ingest.
- client/src/pages/Settings.tsx: org members table + RBAC controls (change role / remove / add by email) — gate controls by the current user's role (owner/admin). Show the active org name + slug.
- client/src/components/OrgSwitcher.tsx: dropdown of useAuth().orgs; switching navigates to /app/:orgId/ingest.
- client/src/components/Nav.tsx: REWRITE — logo + wordmark; when signed in show OrgSwitcher + a link to Settings + Sign out; when signed out show Login/Signup. Keep ThemeToggle.
- client/src/App.tsx: REWRITE routes per the ROUTE STRUCTURE, wrapping everything in <AuthProvider>. '/app' index resolves first org or /onboarding. The /app/:orgId/* routes render under RequireAuth and read :orgId via useParams.
- client/src/main.tsx: keep BrowserRouter + theme.css import (adjust if needed).
Match the existing dark/cyan design system (theme.css tokens, rounded cards, hairline borders, grad). Do NOT modify Dashboard/Mission/Ingest/AskPanel/ingest-subcomponents — another agent updates those; just make sure the routes import them from their existing paths. Return a short note of files created/changed + the final api.ts signatures.`,
    { label: 'client-shell', phase: 'Core' }
  ),
])

log('Core complete: ' + core.filter(Boolean).length + '/2')

phase('Wire')

const wire = await agent(
  `${SHARED}

ROLE: WIRE EXISTING PAGES to the new tenant-scoped, token-authed API. The server and the client auth shell (AuthContext useAuth, lib/api.ts new signatures, routes with :orgId param) are now in place — READ client/src/lib/api.ts and client/src/auth/AuthContext.tsx to see the exact current signatures, then update ONLY these files to use them:
- client/src/pages/Dashboard.tsx, client/src/pages/Mission.tsx, client/src/pages/Ingest.tsx
- client/src/components/AskPanel.tsx
- client/src/components/ingest/DropZone.tsx, PipelineConsole.tsx, SamplePicker.tsx
- client/src/pages/Home.tsx (update its primary CTA to route to /login or /app)
Changes required in each: read :orgId (and :modelId where relevant) from useParams; obtain the access token via useAuth().getAccessToken(); pass (token, orgId, ...) to every api.ts call; update internal navigation to the /app/:orgId/... routes (e.g. Ingest's success -> /app/:orgId/dashboard/:modelId; Dashboard's link to Mission -> /app/:orgId/mission/:modelId). AskPanel takes props { orgId, modelId } now (or reads orgId from params) — keep it working inside Dashboard and Mission. Preserve all existing UI/UX and the design system. Do NOT change server files or the auth shell. Return a short note of what changed per file.`,
  { label: 'wire-pages', phase: 'Wire' }
)

return { core: core.map((_, i) => (core[i] ? 'ok' : 'failed')), wire: wire ? 'ok' : 'failed' }
