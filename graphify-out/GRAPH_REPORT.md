# Graph Report - .  (2026-06-13)

## Corpus Check
- 121 files · ~65,936 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 705 nodes · 1415 edges · 45 communities (36 shown, 9 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.86)
- Token cost: 24,800 input · 4,450 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Server API & Database Layer|Server API & Database Layer]]
- [[_COMMUNITY_Studio AI Config & Context Store|Studio AI Config & Context Store]]
- [[_COMMUNITY_Demo Data & Sample Models|Demo Data & Sample Models]]
- [[_COMMUNITY_Analytics & Anomaly Engine|Analytics & Anomaly Engine]]
- [[_COMMUNITY_Dashboard UI Components|Dashboard UI Components]]
- [[_COMMUNITY_Server Dependencies|Server Dependencies]]
- [[_COMMUNITY_Mission Control Components|Mission Control Components]]
- [[_COMMUNITY_Client Dependencies|Client Dependencies]]
- [[_COMMUNITY_Frontend API Client|Frontend API Client]]
- [[_COMMUNITY_Client TypeScript Config|Client TypeScript Config]]
- [[_COMMUNITY_Root Monorepo Config|Root Monorepo Config]]
- [[_COMMUNITY_Connector & PBIX Parser|Connector & PBIX Parser]]
- [[_COMMUNITY_API Client HTTP Functions|API Client HTTP Functions]]
- [[_COMMUNITY_Product Docs & Landing|Product Docs & Landing]]
- [[_COMMUNITY_Ingest UI Pipeline|Ingest UI Pipeline]]
- [[_COMMUNITY_Core Auth & Navigation|Core Auth & Navigation]]
- [[_COMMUNITY_Auth Pages & Logo|Auth Pages & Logo]]
- [[_COMMUNITY_Vault & Studio API|Vault & Studio API]]
- [[_COMMUNITY_Base TypeScript Config|Base TypeScript Config]]
- [[_COMMUNITY_Studio Project CRUD|Studio Project CRUD]]
- [[_COMMUNITY_Studio Chat Interface|Studio Chat Interface]]
- [[_COMMUNITY_Graphify Knowledge Tool|Graphify Knowledge Tool]]
- [[_COMMUNITY_Client Domain Types|Client Domain Types]]
- [[_COMMUNITY_Vault Browser UI|Vault Browser UI]]
- [[_COMMUNITY_Context Library CRUD|Context Library CRUD]]
- [[_COMMUNITY_Server TypeScript Config|Server TypeScript Config]]
- [[_COMMUNITY_Auth Context & User Model|Auth Context & User Model]]
- [[_COMMUNITY_Vite Node TypeScript Config|Vite Node TypeScript Config]]
- [[_COMMUNITY_Navigation & Theme|Navigation & Theme]]
- [[_COMMUNITY_AI Provider Settings|AI Provider Settings]]
- [[_COMMUNITY_Report Preview & Theming|Report Preview & Theming]]
- [[_COMMUNITY_Dev Tooling & Smoke Tests|Dev Tooling & Smoke Tests]]
- [[_COMMUNITY_BYOK Studio Smoke Test|BYOK Studio Smoke Test]]
- [[_COMMUNITY_App Bootstrap|App Bootstrap]]
- [[_COMMUNITY_Multi-tenant Smoke Test|Multi-tenant Smoke Test]]
- [[_COMMUNITY_Studio E2E Smoke Test|Studio E2E Smoke Test]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 38 edges
2. `jsonFetch()` - 33 edges
3. `SemanticModel Interface` - 28 edges
4. `KPI Interface` - 23 edges
5. `compilerOptions` - 18 edges
6. `detectAnomalies()` - 15 edges
7. `generateReport()` - 14 edges
8. `studioRouter` - 13 edges
9. `DeepLogic Product Requirements` - 13 edges
10. `scripts` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Studio E2E Smoke Test` --conceptually_related_to--> `writeBrief()`  [INFERRED]
  scripts/studio-smoke.mjs → server/src/engine/briefWriter.ts
- `DeepLogic Product Requirements` --references--> `TypeScript Base Configuration`  [EXTRACTED]
  PRD.md → tsconfig.base.json
- `Graphify Project Rules` --semantically_similar_to--> `Graphify Skill Trigger`  [INFERRED] [semantically similar]
  CLAUDE.md → .claude/CLAUDE.md
- `DeepLogic Studio` --semantically_similar_to--> `Ask DeepLogic Feature`  [INFERRED] [semantically similar]
  README.md → PRD.md
- `DeepLogic Brand Mark` --references--> `Landing Page Design System`  [INFERRED]
  deeplogic-logo.svg → deeplogic-landing.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Auth Guard System** — auth_authcontext_authprovider, auth_authcontext_useauth, auth_requireauth_requireauth [EXTRACTED 1.00]
- **Dashboard Visualization System** — dashboard_kpicards_kpicards, dashboard_timeserieschart_timeserieschart, dashboard_dimensionbreakdown_dimensionbreakdown, dashboard_filters_filters [INFERRED 0.95]
- **Ingest Pipeline Flow** — ingest_dropzone_dropzone, ingest_samplepicker_samplepicker, ingest_pipelineconsole_pipelineconsole [INFERRED 0.95]
- **SSE Stream Consumers** — pages_mission_mission, pages_demo_demo, pages_ingest_ingest [EXTRACTED 1.00]
- **Mission Control UI Suite** — mission_auditlog_auditlog, mission_kpistrip_kpistrip, mission_livefeed_livefeed [INFERRED 0.95]
- **Studio Editor Components** — studio_chatpanel_chatpanel, studio_previewpane_previewpane, studio_datavault_datavault, studio_aisettingscard_aisettingscard, studio_contextlibrary_contextlibrary [INFERRED 0.95]
- **Auth Flow Pages** — pages_login_login, pages_signup_signup, pages_onboarding_onboarding [INFERRED 0.90]
- **Public Demo API Consumers** — pages_home_home, pages_demo_demo [EXTRACTED 1.00]
- **Report Theme Consumers** — studio_previewpane_previewpane, studio_reportthumb_reportthumb [EXTRACTED 1.00]
- **Ingest Agent Pipeline (5-stage ordered sequence)** — engine_events_ingestevents, engine_connectormapper_mapconnectors, engine_kpiextractor_extractkpis, engine_anomalydetector_detectanomaliessync, engine_briefwriter_writebrief [EXTRACTED 1.00]
- **Anomaly Detection Pipeline** — engine_anomalydetector_detectanomalies, engine_recommender_recommend, engine_briefwriter_writebrief, engine_briefwriter_templatebrief [EXTRACTED 1.00]
- **Deterministic Sample Data Layer** — data_generator_mulberry32, data_generator_genseries, data_generator_genbreakdown, data_atlasretail_atlasretail, data_northwindsaas_northwindsaas, data_index_modelregistry [EXTRACTED 1.00]
- **E2E Smoke Test Suite** — scripts_smoke_multitenant, scripts_studiosmoketest_studio, scripts_studio2smoketest_byok [EXTRACTED 1.00]
- **Auth + RBAC Middleware Stack** — server_auth_requireauth, server_auth_requiremember, server_auth_requirerole [EXTRACTED 1.00]
- **Planted Anomaly Test Contract (data ↔ detector)** — data_generator_genseries, data_atlasretail_atlasretail, data_northwindsaas_northwindsaas, engine_anomalydetector_detectanomalies [INFERRED 0.95]
- **Client/Server Shared Type Contract** — client_types_sharedtypes, server_types_sharedtypes [EXTRACTED 1.00]
- **SSE Pipeline Consumers** — routes_demo_demorouter, routes_ingest_ingestrouter, routes_mission_missionrouter, src_sse_sseinit, src_sse_ssesend, src_sse_ssedone [EXTRACTED 1.00]
- **Repo + DB RLS Security Stack** — src_repo_listmodels, src_repo_getmodel, src_repo_createmodelrow, db_models, db_org_members, db_is_org_member, db_has_org_role [EXTRACTED 1.00]
- **Studio AI Generation Pipeline** — routes_studio_studiorouter, studio_context_compilecontext, studio_generator_generatereport, studio_pbix_parsepbix, db_org_ai_settings [EXTRACTED 1.00]
- **Ingest Parse Chain** — src_ingestparse_parsemultipartfile, src_ingestparse_tryreadpbixname, src_ingestparse_synthesizefromupload, src_ingestparse_buildmodelfromupload, src_ingestparse_resolvesample [EXTRACTED 1.00]
- **GitHub Agent Development Crew** — agents_debugger_agent_bug_debugger, agents_implementer_agent_feature_implementer, agents_planner_agent_coding_planner, agents_reviewer_agent_code_reviewer [EXTRACTED 1.00]
- **DeepLogic Sample Data Contract** — prd_atlas_retail, prd_northwind_saas, prd_semantic_model [EXTRACTED 1.00]
- **Graphify Skill Documentation Subsystem** — graphify_skill_graphify_skill, references_extraction_spec_extraction_prompt, references_query_graph_query, references_update_incremental_update [INFERRED 0.95]

## Communities (45 total, 9 thin omitted)

### Community 0 - "Server API & Database Layer"
Cohesion: 0.08
Nodes (58): DB: audit_entries table, DB: context_items table, DB: models table, DB: org_ai_settings table, DB: org_members table, DB: organizations table, DB: studio_projects table, demoRouter (+50 more)

### Community 1 - "Studio AI Config & Context Store"
Cohesion: 0.06
Nodes (46): AiSettingsRow, ALL_PROVIDERS, ContextRow, loadAiConfig(), loadAiRow(), ProjectListRow, ProjectRow, ProviderEntry (+38 more)

### Community 2 - "Demo Data & Sample Models"
Cohesion: 0.06
Nodes (44): atlasRetail, connectors, dates, dimensions, END, margin, marginSeries, measures (+36 more)

### Community 3 - "Analytics & Anomaly Engine"
Cohesion: 0.13
Nodes (38): detectAnomalies(), detectAnomaliesSync(), detectInSeries(), Flag, severityFromZ(), ALIASES, answerQuestion(), isWhy() (+30 more)

### Community 4 - "Dashboard UI Components"
Cohesion: 0.12
Nodes (28): AskPanel(), formatValue(), SUGGESTIONS, ConnectorsStrip(), KIND_LABEL, DimensionBreakdown(), DimensionBreakdownProps, DateRange (+20 more)

### Community 5 - "Server Dependencies"
Cohesion: 0.07
Nodes (26): dependencies, adm-zip, cors, dotenv, express, @supabase/supabase-js, @types/ws, ws (+18 more)

### Community 6 - "Mission Control Components"
Cohesion: 0.14
Nodes (20): AnomalyCard(), AnomalyCardProps, AuditLog(), AuditLogProps, deltaPct(), formatCurrency(), formatDate(), formatNumber() (+12 more)

### Community 7 - "Client Dependencies"
Cohesion: 0.09
Nodes (21): dependencies, react, react-dom, react-router-dom, recharts, @supabase/supabase-js, devDependencies, @types/react (+13 more)

### Community 8 - "Frontend API Client"
Cohesion: 0.15
Nodes (19): AiProviderState, anomalies(), approveAction(), audit(), authHeaders(), bindAgentStream(), demoIngestSample(), demoIngestUpload() (+11 more)

### Community 9 - "Client TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, moduleDetection (+11 more)

### Community 10 - "Root Monorepo Config"
Cohesion: 0.10
Nodes (19): devDependencies, concurrently, name, private, scripts, build, db:reset, dev (+11 more)

### Community 11 - "Connector & PBIX Parser"
Cohesion: 0.19
Nodes (16): Connector Interface, decodeEntry(), dedupeSources(), extractMashupM(), KIND_LABEL, kindFromSignal(), parseConnectors(), parseModel() (+8 more)

### Community 12 - "API Client HTTP Functions"
Cohesion: 0.14
Nodes (16): addMemberByEmail(), ask(), createOrg(), errorDetail(), getCompiledContext(), getMe(), getOrgVault(), ingestSample() (+8 more)

### Community 13 - "Product Docs & Landing"
Cohesion: 0.17
Nodes (16): Client SPA Entry Point, Landing Page Design System, DeepLogic Brand Mark, Agent Engine, Anomaly Detection Engine, Ask DeepLogic Feature, Atlas Retail Sample Model, Mission Control (+8 more)

### Community 14 - "Ingest UI Pipeline"
Cohesion: 0.16
Nodes (10): ALLOWED, DropZone(), Props, PipelineConsole(), Props, STAGES, BLURBS, Props (+2 more)

### Community 15 - "Core Auth & Navigation"
Cohesion: 0.26
Nodes (12): useAuth(), RequireAuth(), API Client, Supabase Client, Dashboard(), Demo(), Ingest(), Mission() (+4 more)

### Community 16 - "Auth Pages & Logo"
Cohesion: 0.17
Nodes (6): LogoProps, Login(), Cycle, Tier, TIERS, Signup()

### Community 17 - "Vault & Studio API"
Cohesion: 0.17
Nodes (9): addVaultItem(), generateStudioReport(), getStudioProject(), removeVaultItem(), StudioProject, StudioVersion, VaultItem, VaultKind (+1 more)

### Community 18 - "Base TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+4 more)

### Community 19 - "Studio Project CRUD"
Cohesion: 0.17
Nodes (9): createStudioProject(), deleteStudioProject(), listModels(), listStudioProjects(), StudioProjectListItem, StudioVisibility, StartMode, Studio() (+1 more)

### Community 20 - "Studio Chat Interface"
Cohesion: 0.26
Nodes (10): PromptAttachment, StudioMessage, ModelListItem, ChatPanel(), fileToAttachment(), isImage(), isPdf(), Props (+2 more)

### Community 21 - "Graphify Knowledge Tool"
Cohesion: 0.20
Nodes (11): Graphify Skill Trigger, Graphify Project Rules, Graphify Skill, Graphify Add URL and Watch Reference, Graphify Graph Exports Reference, Graphify Extraction Subagent Spec, Graphify GitHub Clone and Cross-Repo Merge Reference, Graphify Commit Hook and CLAUDE.md Integration Reference (+3 more)

### Community 22 - "Client Domain Types"
Cohesion: 0.18
Nodes (10): AgentEvent, AgentStage, Anomaly, AskAnswer, AuditEntry, Connector, Dimension, KPI (+2 more)

### Community 23 - "Vault Browser UI"
Cohesion: 0.18
Nodes (9): Shared Domain Types (client copy of server/src/types.ts), VaultConnector, VaultDocument, StudioEditor(), KIND_ICON, OwnerBadge(), SOURCE_LABEL, Vault() (+1 more)

### Community 24 - "Context Library CRUD"
Cohesion: 0.18
Nodes (10): ContextItem, ContextKind, ContextScope, createContext(), deleteContext(), listContext(), updateContext(), AddKind (+2 more)

### Community 25 - "Server TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, module, moduleResolution, outDir, rootDir, sourceMap, strict, types (+2 more)

### Community 26 - "Auth Context & User Model"
Cohesion: 0.24
Nodes (7): AuthContext, AuthContextValue, AuthUser, OrgMembership, anonKey, supabase, url

### Community 27 - "Vite Node TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, noEmit, skipLibCheck, strict (+1 more)

### Community 28 - "Navigation & Theme"
Cohesion: 0.24
Nodes (6): Nav(), OrgSwitcher(), Theme, ThemeToggle(), build-deeplogic-saas Multi-tenant Workflow, build-deeplogic-studio Studio Workflow

### Community 29 - "AI Provider Settings"
Cohesion: 0.20
Nodes (9): AiKeyTestResult, AiProvider, AiSettings, getAiSettings(), saveAiSettings(), testAiSettings(), AiSettingsCard(), PROVIDERS (+1 more)

### Community 30 - "Report Preview & Theming"
Cohesion: 0.40
Nodes (7): PaneTab, PreviewPane(), Props, applyReportTheme(), reportTheme Utilities, useAppTheme(), ReportThumb()

### Community 31 - "Dev Tooling & Smoke Tests"
Cohesion: 0.32
Nodes (8): Vite Dev Server + API Proxy Config, Root Monorepo Workspace (server + client), Multi-Tenant E2E Smoke Test, Studio BYOK + Ownership Smoke Test, Studio E2E Smoke Test, requireAuth middleware, requireMember middleware, requireRole middleware

### Community 32 - "BYOK Studio Smoke Test"
Cohesion: 0.25
Nodes (3): mineCard, sharedCard, ts

### Community 33 - "App Bootstrap"
Cohesion: 0.38
Nodes (5): AuthProvider(), Graphify-First PreToolUse Hook, App(), AppIndex(), build-deeplogic Foundation Workflow

## Knowledge Gaps
- **247 isolated node(s):** `meta`, `meta`, `meta`, `name`, `version` (+242 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SemanticModel Interface` connect `Server API & Database Layer` to `Studio AI Config & Context Store`, `Demo Data & Sample Models`, `Analytics & Anomaly Engine`, `Dashboard UI Components`, `Frontend API Client`?**
  _High betweenness centrality (0.242) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `Core Auth & Navigation` to `App Bootstrap`, `Dashboard UI Components`, `Frontend API Client`, `API Client HTTP Functions`, `Ingest UI Pipeline`, `Auth Pages & Logo`, `Vault & Studio API`, `Studio Project CRUD`, `Vault Browser UI`, `Context Library CRUD`, `Auth Context & User Model`, `Navigation & Theme`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `AuditEntry Interface` connect `Mission Control Components` to `Server API & Database Layer`, `Frontend API Client`, `Dashboard UI Components`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `meta`, `meta`, `meta` to the rest of the system?**
  _248 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server API & Database Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.07589781562384303 - nodes in this community are weakly interconnected._
- **Should `Studio AI Config & Context Store` be split into smaller, more focused modules?**
  _Cohesion score 0.05669199298655757 - nodes in this community are weakly interconnected._
- **Should `Demo Data & Sample Models` be split into smaller, more focused modules?**
  _Cohesion score 0.05731523378582202 - nodes in this community are weakly interconnected._