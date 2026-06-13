export const meta = {
  name: 'build-deeplogic-studio',
  description: 'Build DeepLogic Studio — AI "vibecoding" report builder (PRD v3)',
  phases: [
    { title: 'Core', detail: 'server studio engine/routes + client api/home/context-library' },
    { title: 'Editor', detail: 'the Lovable-style vibecoding editor page' },
  ],
}

const SHARED = `
You are adding a new subsystem — DEEPLOGIC STUDIO — to the EXISTING, WORKING multi-tenant DeepLogic app at c:/sites/deeplogic.
READ FIRST: the "PRD v3 — DeepLogic Studio" section at the end of PRD.md (the contract). Also skim PRD v2 for the auth/RLS model.
Preserve everything that works. The app: npm workspaces; server (Express+TS, ESM, '.js' import extensions) on :8787; client (Vite+React+TS) on :5173; local Supabase (Postgres+Auth+RLS). Auth = Supabase email+password JWT; server middleware requireAuth/requireMember already exist (server/src/auth.ts); per-request RLS client is req.db; req.user={id,email}; service client + repo.getModel exist (server/src/repo.ts, server/src/supabase.ts). The DB tables studio_projects + context_items already exist with RLS (supabase/migrations/20260612000002_studio.sql).

DeepLogic Studio = a Lovable/Replit-style report builder. Each user has a private SILO; they chat to generate a self-contained HTML report (live preview + code + versions), and can share to the org / publish. A per-user/org CONTEXT LIBRARY (docs, existing HTML, MCP descriptors, notes) compiles into an augmented CONTEXT.md the AI reads; reports can also be GROUNDED in one of the org's semantic models (real KPIs).

AI generation (locked): use Claude 'claude-opus-4-8' via '@anthropic-ai/sdk' (already installed) WHEN process.env.ANTHROPIC_API_KEY is set; otherwise a deterministic TEMPLATE generator (the flow must run fully offline). Lazy-import the SDK inside try/catch; never throw — always return HTML.
MCP uploads = descriptors only (name + url + description) added to context; NO live tool execution.

DESIGN: generated reports + Studio UI use DeepLogic's dark design tokens — background #070b12, card #0e1726, hairline borders rgba(120,180,220,.14), text #eaf3fb, muted #8ea3b8, accent gradient linear-gradient(120deg,#6fe3f0,#49a0e6,#5560e8) (cyan->blue). The Studio UI must match the existing client (client/src/styles/theme.css tokens, rounded cards, .btn/.btn-primary/.btn-ghost, .eyebrow, .grad-text).

CONTRACT — client/src/lib/api.ts studio additions (every call takes token + orgId; Authorization Bearer):
  // types (define & export in api.ts, same pattern as OrgMembership):
  StudioProjectListItem { id,name,slug, visibility:'private'|'org'|'published', ownerId, isOwner:boolean, updatedAt }
  StudioMessage { role:'user'|'assistant'|'system', content, ts }
  StudioVersion { html, prompt, ts }
  StudioProject { id,name,slug,visibility,ownerId,isOwner, html, modelId:string|null, messages:StudioMessage[], versions:StudioVersion[], updatedAt }
  ContextItem { id, scope:'user'|'org', kind:'doc'|'html'|'mcp'|'note', name, content, meta:Record<string,unknown>, enabled:boolean, isOwner:boolean }
  listStudioProjects(token,orgId): Promise<StudioProjectListItem[]>
  createStudioProject(token,orgId,{name,seedHtml?,modelId?}): Promise<StudioProject>
  getStudioProject(token,orgId,projectId): Promise<StudioProject>
  updateStudioProject(token,orgId,projectId,patch:{name?,visibility?,html?,modelId?:string|null}): Promise<StudioProject>
  deleteStudioProject(token,orgId,projectId): Promise<void>
  generateStudioReport(token,orgId,projectId,prompt): Promise<{html:string, message:StudioMessage, usedAI:boolean}>
  getCompiledContext(token,orgId,projectId): Promise<{markdown:string}>
  listContext(token,orgId): Promise<ContextItem[]>
  createContext(token,orgId,{kind,name,content?,meta?,scope?}): Promise<ContextItem>
  updateContext(token,orgId,id,patch:{enabled?,name?,content?,scope?,meta?}): Promise<ContextItem>
  deleteContext(token,orgId,id): Promise<void>

SERVER routes — all under '/api/orgs/:orgId/studio', protected by requireMember (org membership). Use req.db (RLS) for studio_projects + context_items CRUD; repo.getModel(req.db, orgId, modelId) for grounding. Map DB rows -> the api shapes (snake_case -> camelCase; isOwner = row.owner_id === req.user.id). Routes:
  GET    projects                      GET    projects/:id
  POST   projects {name,seedHtml?,modelId?}   (owner=caller; slug from name+random; html=seedHtml||'')
  PATCH  projects/:id {name?,visibility?,html?,modelId?}
  DELETE projects/:id
  POST   projects/:id/generate {prompt}  -> load project + enabled context items + grounding model; compileContext; generateReport; append {role:'user'} then {role:'assistant'} messages; push a version {html,prompt,ts} (cap last 10); set html + updated_at; return {html,message,usedAI}
  GET    projects/:id/compiled-context  -> { markdown }
  GET    context                        POST   context {kind,name,content?,meta?,scope?}
  PATCH  context/:id                    DELETE context/:id

CLIENT routes (App.tsx, under RequireAuth):
  /app/:orgId/studio              -> Studio (home: My reports + Shared gallery + Context Library + New report)
  /app/:orgId/studio/:projectId   -> StudioEditor (vibecoding editor; read-only viewer when !isOwner)
`

phase('Core')

const core = await parallel([
  () => agent(
    `${SHARED}

ROLE: SERVER (DeepLogic Studio backend). Create/modify ONLY server-side files:
- server/src/types.ts: ADD exported types StudioProject, StudioMessage, StudioVersion, ContextItem matching the contract (alongside existing types; do not remove anything).
- server/src/studio/context.ts: export compileContext(items, model?) -> string. Include only enabled items, grouped by kind with clear markdown headers (## Documents / ## Existing HTML reports / ## MCP servers / ## Notes). For 'mcp' use meta.url + meta.description. If a grounding model is passed, append "## Live data — <model name>" summarizing each KPI (name, current, previous, format, goodDirection) and the dimension names. Cap the whole string to ~12000 chars.
- server/src/studio/generator.ts: export async generateReport({prompt,currentHtml,context,modelData?,history?}) -> {html,usedAI}. If process.env.ANTHROPIC_API_KEY: lazy 'await import("@anthropic-ai/sdk")', new Anthropic(), client.messages.create({ model:'claude-opus-4-8', max_tokens:8000, system, messages }). The SYSTEM prompt: "You are DeepLogic Studio, an expert at building beautiful, self-contained analytics reports. Output ONE complete HTML document (<!doctype html> ... </html>) and NOTHING else — no markdown, no code fences, no commentary. Use a dark theme with DeepLogic's tokens: background #070b12, cards #0e1726, hairline borders rgba(120,180,220,.14), text #eaf3fb, muted #8ea3b8, and the cyan->blue accent gradient linear-gradient(120deg,#6fe3f0,#49a0e6,#5560e8). Inline all CSS (and any JS). Use ONLY the data/facts in the provided context; when you cite KPIs use the real numbers. If a current report is provided, modify it to satisfy the user's request rather than starting over." The user message includes the compiled CONTEXT, the current HTML (if any), and the user's prompt. Read the response text from res.content (filter type==='text'); strip any leading/trailing \`\`\`html / \`\`\` fences; if it doesn't look like HTML, wrap it. Return usedAI:true. On ANY error or missing key -> deterministic TEMPLATE: a full dark-themed HTML doc titled from the prompt, rendering KPI cards from modelData (if present) using the tokens above, plus a small note "Template mode — set ANTHROPIC_API_KEY for full AI generation." Return usedAI:false. NEVER throw.
- server/src/routes/studio.ts: implement all routes in the contract with requireMember. Build the generate handler exactly as specified (append messages, cap versions to 10). Return rows mapped to the api shapes (isOwner via req.user.id).
- server/src/index.ts: import { studioRouter } from './routes/studio.js' and app.use('/api', studioRouter) AFTER requireAuth (with the other org-scoped routers).
Keep ESM '.js' import extensions. Do NOT touch client/ or the engine. Return a short note of files changed.`,
    { label: 'studio:server', phase: 'Core' }
  ),
  () => agent(
    `${SHARED}

ROLE: CLIENT CORE (Studio home + Context Library + api + routing). Create/modify ONLY these client files:
- client/src/lib/api.ts: APPEND the studio types + functions from the contract (Authorization Bearer; reuse the existing jsonFetch helper + enc()). Do not change existing exports.
- client/src/App.tsx: add the two studio routes under RequireAuth importing './pages/Studio' and './pages/StudioEditor'.
- client/src/components/Nav.tsx: when signed in and inside an org, add a "Studio" link to /app/:orgId/studio (keep OrgSwitcher / Settings / Sign out / ThemeToggle).
- client/src/pages/Studio.tsx: Studio home. Tabs/sections: "My reports" (silo — projects where isOwner), "Shared" (visibility 'org'/'published' from others), and the Context Library. A "New report" action (modal or inline form): name + start option [blank | upload existing .html (read file text -> seedHtml) | from a grounding model (pick from listModels(token,orgId))] -> createStudioProject -> navigate to /app/:orgId/studio/:projectId. Project cards link to the editor; show visibility + updatedAt; owner can delete.
- client/src/components/studio/ContextLibrary.tsx: list context items (mine + org), add items: doc/note (name + paste/textarea or upload .md/.txt/.html as text), html (upload .html), mcp (name + url + description). Toggle 'enabled', toggle scope user/org, delete. Clean cards matching the design system.
- client/src/components/studio/studio.css: shared Studio styles (cards, split layout helpers, chat bubbles, preview frame) — used by Studio home, ContextLibrary, and the editor.
- client/src/pages/StudioEditor.tsx: create a PLACEHOLDER default-export component (the Editor agent overwrites it next) so App.tsx compiles — render a simple "Loading editor…" panel; default export, reads :orgId/:projectId via useParams.
Match the existing dark/cyan design system. Do NOT modify server files or other client pages. Return a short note + the final api.ts studio signatures you implemented.`,
    { label: 'studio:client-core', phase: 'Core' }
  ),
])

log('Core complete: ' + core.filter(Boolean).length + '/2')

phase('Editor')

const editor = await agent(
  `${SHARED}

ROLE: THE VIBECODING EDITOR. READ client/src/lib/api.ts (the studio functions just added) and client/src/components/studio/studio.css, then implement ONLY:
- client/src/pages/StudioEditor.tsx (overwrite the placeholder) and any helper components under client/src/components/studio/ (e.g. ChatPanel.tsx, PreviewPane.tsx) — your own NEW files only.
Build a Lovable/Replit-style split editor for /app/:orgId/studio/:projectId:
  * Load the project via getStudioProject. If !isOwner, render a READ-ONLY viewer (preview + name + a "duplicate to my silo" is optional) — no chat input.
  * LEFT pane (owner): a chat column — message history (user/assistant bubbles from project.messages), a prompt textarea + Send that calls generateStudioReport(token,orgId,projectId,prompt); while generating show a working state; on result update the preview + append the assistant message; surface usedAI (badge "AI" vs "Template"). Show "context chips" — a small row linking to the Context Library and the grounding model picker (listModels) wired to updateStudioProject({modelId}). A "What the AI sees" button opens a drawer showing getCompiledContext().markdown.
  * RIGHT pane: tabs Preview / Code. Preview = <iframe sandbox="allow-scripts" srcDoc={html} /> filling the pane. Code = a read-only <pre> or textarea of the HTML with a Copy + Download (.html) button.
  * TOP bar: editable project name (PATCH on blur), a visibility selector Private/Org/Published (updateStudioProject), a versions dropdown (project.versions — restore sets html via updateStudioProject({html}) and updates preview), and a back link to /app/:orgId/studio.
  * Empty state (no html yet): a friendly prompt-starter with example prompts ("Build an executive summary of revenue and churn", "Turn this into a one-page board report").
Use the design tokens + studio.css. Clean up nothing else. Handle token via useAuth().getAccessToken(). Return a short note of files created.`,
  { label: 'studio:editor', phase: 'Editor' }
)

return { core: core.map((_, i) => (core[i] ? 'ok' : 'failed')), editor: editor ? 'ok' : 'failed' }
