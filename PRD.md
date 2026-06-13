# DeepLogic — Product Requirements & Build Contract

> **Tagline:** *From reports to a control room that thinks.*
> This document is both the PRD and the **technical contract** every build agent must conform to.
> When in doubt, this file wins. Keep file ownership disjoint (see §10).

---

## 1. Vision

DeepLogic ingests a Power BI semantic model (uploaded `.pbix`/`.pbit` or a bundled sample),
understands its connectors / KPIs / measures, **auto-generates an interactive dashboard**, and
runs an **always-on agentic crew** ("Mission Control") that watches KPIs, detects anomalies,
explains the root cause in plain language, and recommends or executes the next action.

The product must be a **real, runnable web app** — the agent engine performs genuine analytics
(anomaly detection, dimension attribution, NL briefs), not hardcoded mockups.

## 2. Users
- **Operators / analysts** — ingest a model, explore the auto-dashboard, ask KPI questions.
- **Leadership** — open Mission Control, see the signal + cause + recommended action in one screen.

## 3. Core user loop (must all work end-to-end)
1. **Ingest** a model (sample or upload) → animated agent pipeline runs → ingestion summary.
2. **Dashboard** auto-generated from the model → KPI cards, time series, breakdowns, filters.
3. **Mission Control** → live SSE agent feed, anomaly alerts, root-cause briefs, recommended
   actions with one-click approve → simulated execution + audit log.
4. **Ask DeepLogic** → natural-language question over the model returns number + trend + cause.

## 4. MVP feature set
- [x] Shared design system reused from `deeplogic-landing.html` (tokens, gradient, logo, dark/light).
- [x] Ingestion flow: sample picker + file upload (`.pbix`/`.pbit`), staged agent animation, summary.
- [x] Auto dashboard: KPI cards (value + delta), time-series chart, dimension breakdown chart, date-range + dimension filters.
- [x] Mission Control: live agent activity feed (SSE), anomaly alert cards, NL brief w/ root cause, recommended actions, approve → audit log entry.
- [x] Ask DeepLogic panel: NL → KPI answer (deterministic; optional Claude enhancement).
- [x] Two bundled sample semantic models — **"Atlas Retail"** (omnichannel retail) and **"Northwind SaaS"** (B2B subscription) — each with a planted anomaly. Use ONLY these neutral names; do not use any real company/customer names.

Out of scope for MVP: auth, persistence/DB (in-memory + JSON is fine), real connector OAuth, multi-tenant.

## 5. Architecture
Monorepo with **npm workspaces**. Two packages: `client`, `server`. Root scripts run both via `concurrently`.

```
deeplogic/
  package.json            # root: workspaces, scripts (dev/build/typecheck)
  tsconfig.base.json
  shared/                 # shared TS types (imported by both via path or copy) -> see §6
  server/                 # Express + TS API + agent engine + sample data
  client/                 # Vite + React + TS SPA
```

- **Ports:** server `8787`, client (Vite) `5173`. Vite dev server proxies `/api` → `8787`.
- **Dev:** root `npm run dev` → `concurrently "npm:dev:server" "npm:dev:client"`.
  - server dev via `tsx watch src/index.ts`; client dev via `vite`.
- **Build:** `npm run build` builds both; `npm run typecheck` runs `tsc --noEmit` in both.
- **Node:** v20. ESM modules (`"type":"module"`). Use `.js` extensions in relative TS imports where needed for NodeNext, OR set `moduleResolution: bundler` for client and `NodeNext` for server. Keep server tsconfig `module: NodeNext`.

## 6. Shared domain types (the contract)
Define in `server/src/types.ts` AND mirror in `client/src/types.ts` (copy is acceptable; keep in sync).
These shapes are authoritative — do not rename fields.

```ts
export interface Connector { id: string; name: string; kind: 'powerbi'|'snowflake'|'salesforce'|'hubspot'|'sqlserver'|'sheets'|'sap'|'excel'|'rest'; tables: string[]; status: 'connected'|'syncing'; }
export interface Measure { id: string; name: string; expression: string; format: 'currency'|'percent'|'number'; }
export interface Dimension { id: string; name: string; values: string[]; }
export interface KPI {
  id: string; name: string; format: 'currency'|'percent'|'number';
  current: number; previous: number;            // for delta
  goodDirection: 'up'|'down';                    // is up good?
  series: { date: string; value: number }[];     // daily time series
  byDimension: Record<string, { label: string; value: number }[]>; // dimId -> breakdown
}
export interface SemanticModel {
  id: string; name: string; source: 'sample'|'upload';
  connectors: Connector[]; dimensions: Dimension[]; measures: Measure[]; kpis: KPI[];
  dateRange: { start: string; end: string };
}
export type AgentStage = 'ingest'|'connectors'|'kpis'|'anomaly'|'brief';
export interface AgentEvent {
  id: string; agent: string; stage: AgentStage;
  message: string; status: 'running'|'done'|'alert'; ts: string;
}
export interface Anomaly {
  id: string; kpiId: string; kpiName: string; date: string;
  observed: number; expected: number; deviation: number;  // z-like score
  severity: 'low'|'medium'|'high';
  rootCause: { dimensionId: string; dimensionName: string; label: string; contribution: number };
  brief: string;                                  // NL explanation
  recommendation: { id: string; title: string; detail: string; action: string };
}
export interface AuditEntry { id: string; ts: string; actor: 'agent'|'user'; summary: string; }
export interface AskAnswer { kpiId: string | null; answer: string; value?: number; format?: string; trend?: string; }
```

## 7. API contract (server)
All under `/api`. JSON unless noted.
- `GET  /api/models` → `{ id, name, source }[]` (lists bundled samples).
- `GET  /api/models/:id` → `SemanticModel`.
- `POST /api/ingest` (multipart `file` OR `{ sampleId }`) → `{ modelId }`. For uploads: unzip pbix/pbit, attempt to read model schema; **on any failure fall back** to deriving a model from the file name + a synthetic generator (never error to the user). For sampleId: just resolve the sample.
- `GET  /api/ingest/:modelId/stream` (SSE, `text/event-stream`) → streams `AgentEvent` over ~6–10s covering stages ingest→connectors→kpis→anomaly→brief, ending with a `done` event.
- `GET  /api/models/:id/anomalies` → `Anomaly[]` (computed by the engine).
- `GET  /api/models/:id/mission/stream` (SSE) → ongoing live `AgentEvent` feed for Mission Control (loop a small set every few seconds).
- `POST /api/models/:id/actions/:anomalyId/approve` → `AuditEntry` (records simulated execution).
- `GET  /api/models/:id/audit` → `AuditEntry[]`.
- `POST /api/models/:id/ask` `{ question }` → `AskAnswer`.

## 8. Agent engine (server/src/engine/*) — real logic
- **connectorMapper** — derive `Connector[]` from the model (sample defines them; upload infers from tables).
- **kpiExtractor** — resolve `KPI[]` from measures + series.
- **anomalyDetector** — over each KPI series compute a rolling baseline (mean/std of trailing window, e.g. 14d) and flag points where |value-mean|/std ≥ threshold (~2.5). Map to `severity`. This must actually flag the **planted anomaly** in each sample.
- **rootCauseAttributor** — for a flagged date, find the `byDimension` breakdown member with the largest negative/positive contribution to the change; populate `rootCause`.
- **recommender** — map (kpi, dimension, severity) → a concrete `recommendation` (templated, sensible).
- **briefWriter** — produce the NL `brief`. Default: deterministic template. **Optional:** if `process.env.ANTHROPIC_API_KEY` is set, call the Anthropic SDK to write the brief. The agent implementing this MUST consult the `claude-api` skill for correct model id/params (use the latest model, `claude-opus-4-8`). Wrap in try/catch → fall back to template. Never block on it.

## 9. Design system (client)
Reuse tokens from `deeplogic-landing.html` verbatim: CSS custom properties (`--bg, --card, --line, --cyan, --blue, --ink, --mut, --grad`), the `--grad` gradient, the triangle **logo symbol** (`#dlmark` SVG), dark/light theme toggle persisted to `localStorage` key `dl-theme`. Put global tokens in `client/src/styles/theme.css`. Components should feel like the landing page (rounded cards, hairline borders, glow). Charts use the cyan→blue gradient.

Pages/routes (React Router):
- `/` Landing-style home (can embed the existing hero copy) with "Open the product" CTA → `/ingest`.
- `/ingest` ingestion flow.
- `/dashboard/:modelId` auto dashboard.
- `/mission/:modelId` Mission Control.
(Ask DeepLogic is a panel available on dashboard + mission.)

## 10. File ownership map (parallel build — keep DISJOINT)
- **Foundation (done first):** root `package.json`, `tsconfig.base.json`, `server/package.json`, `server/tsconfig.json`, `server/src/types.ts`, `server/src/data/*` (sample models + generator), `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx` (router + shell), `client/src/types.ts`, `client/src/styles/theme.css`, `client/src/lib/api.ts`, `client/src/components/Logo.tsx`, `client/src/components/Nav.tsx`. Placeholder page components so the router compiles.
- **Engine agent:** `server/src/engine/*.ts` only.
- **Server routes agent:** `server/src/index.ts`, `server/src/routes/*.ts`, `server/src/sse.ts` (imports engine + data + types only).
- **Dashboard agent:** `client/src/pages/Dashboard.tsx` + `client/src/components/dashboard/*`.
- **Mission Control agent:** `client/src/pages/Mission.tsx` + `client/src/components/mission/*`.
- **Ingestion agent:** `client/src/pages/Ingest.tsx` + `client/src/pages/Home.tsx` + `client/src/components/ingest/*`.
- **Ask panel agent:** `client/src/components/AskPanel.tsx` (imported by Dashboard/Mission — they reference it by this path).

## 11. Acceptance criteria
- `npm install` at root succeeds; `npm run typecheck` passes; `npm run build` passes.
- `npm run dev` serves client at 5173, API at 8787; `/api/models` returns the 2 samples.
- Ingest → pipeline animates via SSE → redirects to dashboard.
- Dashboard renders KPI cards + charts from real model data; filters work.
- Mission Control shows live SSE feed; at least one anomaly card appears with a root-cause brief and a recommended action; approving it adds an audit entry.
- Ask DeepLogic returns a sensible answer for "what is revenue" / "why did churn change".
- Runs fully offline (no API key required).
```

---

# PRD v2 — Multi-Tenant SaaS (Supabase)

DeepLogic becomes a **multi-tenant SaaS**. Decisions (locked):
- **Persistence:** a **local Supabase instance** (Postgres + Auth + RLS), run via the Supabase CLI + Docker (`supabase start`).
- **Auth:** Supabase Auth, **email + password**, JWT access token (httpOnly not required — token held by `@supabase/supabase-js` client; sent as `Authorization: Bearer` to our API).
- **Tenancy + RBAC:** **Organization → members**. Shared DB with **row-level security** keyed on `org_id`. Roles `owner | admin | member`. Destructive/admin actions are role-gated. Each new org is **seeded** with the two sample models (Atlas Retail, Northwind SaaS).

## v2 Architecture
- **Supabase (local)** — `supabase/` dir (config.toml + migrations). Postgres holds tenant data with RLS; Supabase Auth (GoTrue) holds users and issues JWTs; Studio for inspection. Started with `supabase start`; reset/apply migrations with `supabase db reset`.
- **Express API (existing)** — keeps the agent engine. Gains: Supabase clients (a **service-role** client for trusted seeding/compute, and a **per-request user client** bound to the caller's JWT so reads/writes are RLS-scoped), an **auth middleware** (`supabase.auth.getUser(token)`), and a **repository layer** that replaces the in-memory `data/index.ts` registry with Postgres-backed model loading. The pure engine (`engine/*`) is unchanged — it still operates on a `SemanticModel` object.
- **Client (existing)** — gains an **AuthProvider** (`@supabase/supabase-js`), **login/signup/onboarding** pages, an **org switcher**, **member management** (RBAC) UI, **route guards**, and threads `{ accessToken, orgId }` into `lib/api.ts`. Existing Dashboard/Mission/Ingest/Ask are wired to tenant-scoped endpoints.

## v2 Data model (Postgres)
Schema `public`, RLS enabled on every table.
- `organizations(id uuid pk default gen_random_uuid(), name text, slug text unique, created_by uuid, created_at timestamptz default now())`
- `org_members(org_id uuid fk organizations, user_id uuid fk auth.users, role text check in ('owner','admin','member'), created_at, pk(org_id,user_id))`
- `models(id uuid pk default gen_random_uuid(), org_id uuid fk organizations, name text, source text check in ('sample','upload'), data jsonb /* full SemanticModel: connectors,dimensions,measures,kpis,dateRange */, created_at)`
- `audit_entries(id uuid pk default gen_random_uuid(), org_id uuid fk organizations, model_id uuid fk models, ts timestamptz default now(), actor text check in ('agent','user'), summary text)`

### RLS helpers (SECURITY DEFINER, search_path locked)
- `is_org_member(org uuid) returns boolean` — true if `auth.uid()` is a member of `org`.
- `has_org_role(org uuid, roles text[]) returns boolean` — true if caller's role in `org` ∈ roles.

### RLS policy intent
- `organizations`: SELECT if `is_org_member(id)`; INSERT allowed to any authenticated user (creator becomes owner via API/trigger); UPDATE/DELETE require `has_org_role(id, '{owner,admin}')`.
- `org_members`: SELECT if `is_org_member(org_id)`; INSERT/UPDATE/DELETE require `has_org_role(org_id,'{owner,admin}')` (owner cannot be demoted by non-owner — enforce in API).
- `models` / `audit_entries`: SELECT if `is_org_member(org_id)`; INSERT/UPDATE/DELETE require `is_org_member(org_id)` (member+) for models; audit inserts via API.

## v2 API (all under /api; all require a valid Bearer JWT except where noted)
- `GET  /api/me` → `{ user, orgs: { id,name,slug,role }[] }`
- `POST /api/orgs` `{ name }` → creates org, adds caller as **owner**, **seeds** the 2 sample models. Returns the org.
- `GET  /api/orgs/:orgId/members` → members (with email + role). `POST` invite/add (admin+), `PATCH`/`DELETE` role changes (admin+; only owner manages owners).
- `GET  /api/orgs/:orgId/models` → `{id,name,source}[]`
- `GET  /api/orgs/:orgId/models/:id` → `SemanticModel`
- `POST /api/orgs/:orgId/ingest` (sample copy or upload) → `{ modelId }`
- `GET  /api/orgs/:orgId/ingest/:modelId/stream` (SSE) — pipeline events
- `GET  /api/orgs/:orgId/models/:id/anomalies`
- `GET  /api/orgs/:orgId/models/:id/mission/stream` (SSE)
- `POST /api/orgs/:orgId/models/:id/actions/:anomalyId/approve` → AuditEntry (persisted)
- `GET  /api/orgs/:orgId/models/:id/audit`
- `POST /api/orgs/:orgId/models/:id/ask` `{ question }`
Every handler: verify membership of `:orgId` (defense in depth on top of RLS); role-gate writes per the table above.

## v2 Env / config
- `supabase/.env` not used; CLI prints local keys on `supabase start`.
- `server/.env`: `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_ANON_KEY=…`, `SUPABASE_SERVICE_ROLE_KEY=…`, `PORT=8787`.
- `client/.env`: `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=…`, `VITE_API_URL=` (proxy `/api`).
- Add `.env*` to .gitignore. Provide `.env.example` files with placeholders.

## v2 Acceptance criteria
- `supabase start` brings up local Postgres/Auth; `supabase db reset` applies migrations cleanly.
- `npm run dev` runs client+server; sign up → create org → 2 sample models auto-seeded → land on dashboard scoped to that org.
- A second user in a different org cannot see the first org's models (RLS verified).
- Approving an anomaly persists an audit entry visible to org members only.
- RBAC: a `member` cannot change roles / delete the org; an `owner/admin` can.
- Still runs locally; no external internet required (Supabase is local).

---

# PRD v3 — DeepLogic Studio (AI "vibecoding" reports)

A Lovable/Replit-style **report builder** inside DeepLogic. Each teammate gets a **private silo**;
they chat to generate a **self-contained HTML report** with live preview + code + version history,
and can **share to the org** or **publish** it into a hosted gallery. The differentiator: a per-user/
per-org **Context Library** (uploaded docs, existing HTML reports, MCP descriptors, notes) compiled into
an **augmented `CONTEXT.md`** the model reads — plus optional **grounding in the org's real semantic
models/KPIs** so reports cite actual numbers.

Decisions (locked): AI generation uses **Claude `claude-opus-4-8`** via `@anthropic-ai/sdk` when
`ANTHROPIC_API_KEY` is set, else a **deterministic template generator** (the whole flow still runs offline;
drop a key into `server/.env` to switch on real vibecoding). **MCP uploads = descriptors as context**
(name + URL + description added to the augmented context; no live tool execution in v1).

## v3 Data model (Postgres, RLS) — migration `2026..._studio.sql`
- `studio_projects(id uuid pk, org_id fk, owner_id fk auth.users, name text, slug text, visibility text check in ('private','org','published') default 'private', html text default '', model_id uuid null fk models, messages jsonb default '[]' /* [{role,content,ts}] */, versions jsonb default '[]' /* [{html,prompt,ts}] cap 10 */, created_at, updated_at)`
- `context_items(id uuid pk, org_id fk, owner_id fk auth.users, scope text check in ('user','org') default 'user', kind text check in ('doc','html','mcp','note'), name text, content text default '', meta jsonb default '{}', enabled boolean default true, created_at)`

### RLS intent
- `studio_projects` SELECT: `is_org_member(org_id) AND (owner_id = auth.uid() OR visibility IN ('org','published'))`. INSERT: member AND `owner_id = auth.uid()`. UPDATE: `owner_id = auth.uid()`. DELETE: owner or `has_org_role(org_id,'{owner,admin}')`.
- `context_items` SELECT: `is_org_member(org_id) AND (scope='org' OR owner_id = auth.uid())`. INSERT: member AND owner = self. UPDATE/DELETE: owner or org admin.

## v3 Server (`server/src/studio/*` + `routes/studio.ts`, org-scoped, authed)
- `studio/context.ts`: `compileContext(items, model?)` → augmented markdown (enabled items by kind + a compact KPI summary if a grounding model is attached). Cap total length.
- `studio/generator.ts`: `generateReport({ prompt, currentHtml, context, history }) -> { html, usedAI }`. If `ANTHROPIC_API_KEY`: lazy-import the SDK, `messages.create({ model:'claude-opus-4-8', max_tokens: 8000, messages:[...] })` with a system prompt instructing a single, complete, self-contained HTML document using DeepLogic's dark/cyan design tokens, grounded ONLY in the provided context, editing `currentHtml` when present; strip any ```html fences. Else deterministic template from KPIs + prompt. Wrap in try/catch → fallback; never throw.
- Routes (all under `/api/orgs/:orgId/studio`, `requireMember`):
  - `GET projects` · `POST projects {name, seedHtml?, modelId?}` · `GET projects/:id` · `PATCH projects/:id {name?,visibility?,html?,modelId?}` · `DELETE projects/:id`
  - `POST projects/:id/generate {prompt}` → compiles context (+ grounding model), generates, appends user+assistant messages, pushes a version (cap 10), updates html; returns `{ html, message, usedAI }`
  - `GET projects/:id/compiled-context` → the `CONTEXT.md` string (transparency)
  - `GET context` · `POST context {kind,name,content?,meta?,scope?}` · `PATCH context/:id` · `DELETE context/:id`

## v3 Client routes
- `/app/:orgId/studio` — Studio home: **My reports** (silo) · **Shared** gallery (org/published) · **Context Library** manager · **New report** (blank / upload existing `.html` / from a grounding model).
- `/app/:orgId/studio/:projectId` — **vibecoding editor** (Lovable-style split): left = chat (history, prompt, context chips, grounding-model picker); right = tabs **Preview** (sandboxed `<iframe srcDoc>`) / **Code**; top bar = editable name, visibility (Private/Org/Published), version restore, download HTML, "What the AI sees" drawer. Non-owners get a read-only viewer.
- Add a **Studio** link to the workspace nav.

## v3 api.ts signatures (token + orgId)
listStudioProjects · createStudioProject(token,orgId,{name,seedHtml?,modelId?}) · getStudioProject · updateStudioProject · deleteStudioProject · generateStudioReport(token,orgId,projectId,prompt) · getCompiledContext · listContext · createContext · updateContext · deleteContext.

## v3 Acceptance
- New migration applies via `supabase db reset`/`migration up`.
- A member creates a private report; chat → a real HTML report renders in the preview; versions accrue; downloading yields valid HTML.
- Upload an existing `.html` as a seed → it appears in the preview and can be iterated.
- Add a doc + an MCP descriptor to the Context Library → they show in the compiled `CONTEXT.md` and influence generation.
- Visibility: private reports are invisible to other members (RLS); 'org'/'published' show in the Shared gallery.
- Works with no API key (template mode) and upgrades to real AI when `ANTHROPIC_API_KEY` is set.
