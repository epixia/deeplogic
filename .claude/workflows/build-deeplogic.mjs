export const meta = {
  name: 'build-deeplogic',
  description: 'Build the DeepLogic full-stack product (agentic mission control) per PRD.md',
  phases: [
    { title: 'Foundation', detail: 'scaffold workspace, shared types, sample data, app shell' },
    { title: 'Implement', detail: 'agent engine, server routes, dashboard, mission control, ingest, ask' },
    { title: 'Review', detail: 'code review of the generated app' },
  ],
}

const CONTRACT = `
You are building DeepLogic — a runnable full-stack TypeScript app. The authoritative spec is the
file PRD.md at the repo root (c:/sites/deeplogic/PRD.md). READ IT FIRST, in full, before writing code.
Also read deeplogic-landing.html for the exact design tokens, the #dlmark logo SVG, and the theme toggle.

Hard rules:
- npm workspaces monorepo: packages 'server' and 'client'. ESM ("type":"module").
- Server: Express + TypeScript, dev via 'tsx watch', port 8787, all routes under /api, SSE where specified.
- Client: Vite + React + TS + Recharts, port 5173, Vite dev proxy '/api' -> http://localhost:8787.
- Reuse the landing page's design tokens (CSS custom properties + --grad gradient + #dlmark logo) and dark/light toggle (localStorage key 'dl-theme').
- Two bundled sample semantic models named EXACTLY "Atlas Retail" and "Northwind SaaS". Neutral names only — never use any real company name.
- Must run fully OFFLINE with no API key. Do NOT run 'npm install' or builds — only create/edit your owned files. Keep file ownership DISJOINT per PRD §10.

Shared domain types are defined in PRD §6 — use those exact field names. Do not rename fields.

ENGINE PUBLIC API (server/src/engine/index.ts) — both the engine and the server-routes agent code to this exact interface:
  export function mapConnectors(model: SemanticModel): Connector[]
  export function extractKpis(model: SemanticModel): KPI[]
  export async function detectAnomalies(model: SemanticModel): Promise<Anomaly[]>   // real z-score over each KPI series; async so it can optionally call Anthropic for briefs
  export function answerQuestion(model: SemanticModel, question: string): AskAnswer
  export function ingestEvents(model: SemanticModel): AgentEvent[]   // ordered list streamed during ingestion
  export function missionEvents(model: SemanticModel): AgentEvent[]  // base list looped for the live mission feed

OPTIONAL Anthropic brief enhancement (default OFF; engine only): if process.env.ANTHROPIC_API_KEY is set, the briefWriter may call the Anthropic SDK. Use EXACTLY this shape, wrapped in try/catch with a deterministic template fallback (never throw, never block):
  import Anthropic from '@anthropic-ai/sdk'
  const client = new Anthropic() // reads ANTHROPIC_API_KEY
  const res = await client.messages.create({ model: 'claude-opus-4-8', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('')
Mark '@anthropic-ai/sdk' as an OPTIONAL dependency: import it lazily inside the try/catch (dynamic import) so the app runs even if the package is not installed.
`

phase('Foundation')

const foundation = await parallel([
  () => agent(
    `${CONTRACT}

ROLE: Foundation — SERVER side. Create ONLY these files (per PRD §5/§6/§10):
- /package.json (root): npm workspaces ["server","client"], scripts: "dev" (concurrently runs dev:server + dev:client), "dev:server", "dev:client", "build", "typecheck". Add devDependency "concurrently".
- /tsconfig.base.json
- /.gitignore (node_modules, dist, .env, *.log)
- /server/package.json (express, cors; dev dep tsx, typescript, @types/express, @types/cors, @types/node, adm-zip + @types/adm-zip for pbix parsing; OPTIONAL @anthropic-ai/sdk listed under optionalDependencies). Scripts: dev (tsx watch src/index.ts), build (tsc), typecheck (tsc --noEmit).
- /server/tsconfig.json (module NodeNext, moduleResolution NodeNext, strict, outDir dist).
- /server/src/types.ts — the full type set from PRD §6, exported.
- /server/src/data/atlasRetail.ts and /server/src/data/northwindSaas.ts — each exports a complete SemanticModel:
    * 'Atlas Retail' (omnichannel retail): connectors incl Power BI + Snowflake + Salesforce; dimensions like Region/Channel/Category; KPIs: Revenue (currency, up good), Orders (number, up), Margin % (percent, up), Returns % (percent, DOWN good).
    * 'Northwind SaaS' (B2B subscription): connectors incl Power BI + HubSpot + SQL Server; dimensions like Plan/Region/Segment; KPIs: MRR (currency, up), Active Users (number, up), Churn % (percent, DOWN good), NPS (number, up).
    * Each KPI has ~90 days of daily 'series' ({date:'YYYY-MM-DD', value}) and a 'byDimension' breakdown per dimension (dimId -> [{label,value}]).
    * PLANT A REAL ANOMALY in at least one KPI per model: a sharp dip/spike on a specific recent date that a trailing-window z-score (|z|>=2.5) will flag, concentrated in ONE dimension member so root-cause attribution has a clear answer.
    * Use a SEEDED PRNG (small mulberry32/xorshift) for reproducibility — do NOT use Math.random (so anomalies are stable). Make the series realistic (trend + weekly seasonality + noise).
    * 'current'/'previous' = last value vs value ~7 days prior. dateRange spans the series.
- /server/src/data/index.ts — registry: SAMPLES array + getModel(id), list of {id,name,source}.
Return a concise manifest: the two model ids, each model's kpi ids, dimension ids, and the planted-anomaly (kpiId + date + dimension member) so other agents know the data shape.`,
    { label: 'foundation:server', phase: 'Foundation' }
  ),
  () => agent(
    `${CONTRACT}

ROLE: Foundation — CLIENT side. Create ONLY these files (per PRD §5/§9/§10). Vite + React + TS.
- /client/package.json (react, react-dom, react-router-dom, recharts; dev deps vite, @vitejs/plugin-react, typescript, @types/react, @types/react-dom). Scripts: dev (vite), build (tsc && vite build), typecheck (tsc --noEmit), preview.
- /client/tsconfig.json (+ tsconfig.node.json), strict, moduleResolution Bundler, jsx react-jsx.
- /client/vite.config.ts — react plugin, server.port 5173, server.proxy '/api' -> 'http://localhost:8787'.
- /client/index.html, /client/src/main.tsx (BrowserRouter), /client/src/vite-env.d.ts.
- /client/src/types.ts — COPY of the PRD §6 types (kept in sync with server).
- /client/src/styles/theme.css — port the landing page's :root tokens (--bg,--bg2,--card,--card2,--line,--cyan,--blue,--ink,--mut,--mut2,--grad) AND the [data-theme="light"] overrides; base body/typography; a .grad-text helper; rounded-card + hairline-border utility classes; glow backdrop.
- /client/src/lib/api.ts — typed fetch client for every PRD §7 endpoint (listModels, getModel, ingestSample, ingestUpload, anomalies, approveAction, audit, ask) + helpers to open the two SSE streams (ingest stream, mission stream) via EventSource.
- /client/src/components/Logo.tsx — the #dlmark triangle SVG (inline defs from the landing page) as a React component (size prop).
- /client/src/components/ThemeToggle.tsx — dark/light toggle persisted to localStorage 'dl-theme', applied via document.documentElement[data-theme].
- /client/src/components/Nav.tsx — sticky top nav: logo + DEEPLOGIC wordmark, links, ThemeToggle.
- /client/src/App.tsx — React Router routes: '/' Home, '/ingest' Ingest, '/dashboard/:modelId' Dashboard, '/mission/:modelId' Mission. Import page components from ./pages/{Home,Ingest,Dashboard,Mission}.
- PLACEHOLDER page files so the app compiles before the feature agents run: /client/src/pages/Home.tsx, Ingest.tsx, Dashboard.tsx, Mission.tsx (each a default-exported component rendering a 'coming soon' panel) and /client/src/components/AskPanel.tsx (placeholder default export). The feature agents WILL OVERWRITE these — keep the export shape: default export, pages take no required props, AskPanel takes prop { modelId: string }.
Return a manifest: exact import paths/props for the page components and AskPanel, the api.ts function signatures, and the CSS class/variable names you exposed.`,
    { label: 'foundation:client', phase: 'Foundation' }
  ),
])

log('Foundation complete: ' + foundation.filter(Boolean).length + '/2 agents finished')
const serverManifest = foundation[0] || '(see PRD.md and server/src/data)'
const clientManifest = foundation[1] || '(see PRD.md and client/src/lib/api.ts)'

phase('Implement')

const impl = await parallel([
  // --- Backend ---
  () => agent(
    `${CONTRACT}

ROLE: Implement the AGENT ENGINE. Create ONLY files under /server/src/engine/ (index.ts + helper modules). Import types from '../types.js' and sample data from '../data/index.js'.
Implement the exact ENGINE PUBLIC API in the contract above. Make the analytics REAL:
- detectAnomalies: for each KPI, compute a trailing-window (e.g. 14d) rolling mean & std; flag points with |value-mean|/std >= ~2.5. severity from |z| (low/med/high). It MUST flag the planted anomalies.
- rootCause: for a flagged date, pick the byDimension member with the largest contribution to the change; fill Anomaly.rootCause.
- recommender: map (kpi, dimension, severity) -> a concrete, sensible recommendation {id,title,detail,action}.
- briefWriter: deterministic NL template (number + direction + cause + recommendation). OPTIONALLY enhance via Anthropic per the contract snippet (lazy dynamic import, try/catch, fallback). Default offline.
- answerQuestion: simple keyword/intent matcher over kpi names + 'why'/'cause' -> returns AskAnswer with value/format/trend and a short answer (use anomaly root-cause when asking 'why').
- ingestEvents / missionEvents: produce ordered AgentEvent[] consistent with PRD §6 (stages ingest->connectors->kpis->anomaly->brief; mission feed references real anomalies).
SERVER DATA MANIFEST: ${serverManifest}`,
    { label: 'impl:engine', phase: 'Implement' }
  ),
  () => agent(
    `${CONTRACT}

ROLE: Implement the EXPRESS SERVER. Create ONLY /server/src/index.ts, /server/src/routes/*.ts, /server/src/sse.ts. Import the engine from './engine/index.js', data from './data/index.js', types from './types.js'. Use cors().
Implement EVERY endpoint in PRD §7 exactly (paths, methods, shapes):
- GET /api/models, GET /api/models/:id
- POST /api/ingest (multipart 'file' via a tiny multipart handler or busboy-free approach — OR accept JSON { sampleId }). For uploads: use adm-zip to open the .pbix/.pbit and attempt to read a model name; on ANY failure derive a model from the filename via a synthetic generator (reuse a sample's shape, rename). NEVER error to the client. Return { modelId }. Keep ingested upload models in an in-memory map.
- GET /api/ingest/:modelId/stream (SSE): emit engine.ingestEvents over ~6-10s (setInterval), end with a final 'done' event, then close.
- GET /api/models/:id/anomalies -> await detectAnomalies
- GET /api/models/:id/mission/stream (SSE): loop missionEvents every few seconds (live feed); clean up on client disconnect (req.on('close')).
- POST /api/models/:id/actions/:anomalyId/approve -> create + store an AuditEntry, return it.
- GET /api/models/:id/audit -> AuditEntry[]
- POST /api/models/:id/ask { question } -> engine.answerQuestion
Put a reusable SSE helper in sse.ts (set headers text/event-stream, no-cache, keep-alive; write 'data: <json>\\n\\n'). index.ts wires routes + listens on 8787 and logs the URL.
SERVER DATA MANIFEST: ${serverManifest}`,
    { label: 'impl:server', phase: 'Implement' }
  ),
  // --- Frontend ---
  () => agent(
    `${CONTRACT}

ROLE: Implement the DASHBOARD page. Create ONLY /client/src/pages/Dashboard.tsx and /client/src/components/dashboard/*. Default export, route param :modelId, fetch the model via api.ts.
Render: header (model name + connectors strip), KPI cards (value formatted by KPI.format + delta vs previous, colored by goodDirection), a time-series chart (Recharts, cyan->blue gradient stroke) for a selected KPI, a dimension-breakdown bar chart, and filters (KPI selector + dimension selector + date-range). Reuse theme.css tokens; cards look like the landing page. Embed <AskPanel modelId={modelId} /> from '../components/AskPanel'. Include a link to Mission Control. Make it interactive and clean.
CLIENT MANIFEST: ${clientManifest}`,
    { label: 'impl:dashboard', phase: 'Implement' }
  ),
  () => agent(
    `${CONTRACT}

ROLE: Implement MISSION CONTROL. Create ONLY /client/src/pages/Mission.tsx and /client/src/components/mission/*. Default export, route param :modelId.
Render: top KPI strip; a LIVE agent activity feed driven by the mission SSE stream (api.ts EventSource helper) showing AgentEvent items with status styling (running/done/alert); anomaly alert cards (GET anomalies) each showing severity, the NL brief, root cause, and a recommended action with an "Approve" button -> POST approve -> append to an audit log panel (also GET audit on load); a small "control room" aesthetic matching the landing page's console mockups. Embed <AskPanel modelId={modelId} />. Clean up EventSource on unmount.
CLIENT MANIFEST: ${clientManifest}`,
    { label: 'impl:mission', phase: 'Implement' }
  ),
  () => agent(
    `${CONTRACT}

ROLE: Implement HOME + INGEST. Create ONLY /client/src/pages/Home.tsx, /client/src/pages/Ingest.tsx, and /client/src/components/ingest/*. Default exports.
- Home: a condensed version of the landing hero (reuse the headline "From a Power BI report to a control room that thinks." and the 3-step how-it-works) with a primary CTA "Open the product" -> /ingest. Reuse theme.css + Logo.
- Ingest: pick a bundled sample (GET /api/models) OR upload a .pbix/.pbit file (drag/drop, posts to /api/ingest). After ingest, open the ingest SSE stream and animate the agent pipeline (stages ingest->connectors->kpis->anomaly->brief) with live AgentEvent rows + progress; on the 'done' event, navigate to /dashboard/:modelId. Looks like the landing page's drop zone + console.
CLIENT MANIFEST: ${clientManifest}`,
    { label: 'impl:ingest', phase: 'Implement' }
  ),
  () => agent(
    `${CONTRACT}

ROLE: Implement the ASK panel. Create ONLY /client/src/components/AskPanel.tsx. Default export, props { modelId: string }. A compact "Ask DeepLogic" input + send button that POSTs to /api/models/:id/ask and renders the AskAnswer (answer text, the value formatted, trend). Suggest 2-3 example questions (e.g. "What is revenue?", "Why did churn change?"). Match theme.css styling. Keep it self-contained (no new shared files).
CLIENT MANIFEST: ${clientManifest}`,
    { label: 'impl:ask', phase: 'Implement' }
  ),
])

log('Implementation complete: ' + impl.filter(Boolean).length + '/6 agents finished')

phase('Review')

const review = await agent(
  `Review the DeepLogic app just generated under c:/sites/deeplogic (server/ and client/). Read PRD.md for the contract.
Check for: (1) type/field mismatches against PRD §6, (2) import path errors (ESM .js extensions on server, correct relative paths on client), (3) missing endpoints vs PRD §7, (4) anything that would break 'npm run typecheck' or 'npm run dev', (5) the two SSE streams and the approve->audit flow being wired correctly.
Return a SHORT prioritized list of concrete fixes (file:line where possible). Findings first, most severe first. Do not rewrite the code.`,
  { label: 'review', phase: 'Review', agentType: 'reviewer' }
)

return {
  foundation: foundation.map((_, i) => (foundation[i] ? 'ok' : 'failed')),
  implemented: impl.filter(Boolean).length,
  review,
}
