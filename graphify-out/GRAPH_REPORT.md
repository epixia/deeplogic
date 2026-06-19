# Graph Report - deeplogic  (2026-06-18)

## Corpus Check
- 256 files · ~224,579 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1832 nodes · 3516 edges · 120 communities (102 shown, 18 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b68b2a72`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
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
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Report Preview & Theming|Report Preview & Theming]]
- [[_COMMUNITY_Community 31|Community 31]]
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
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 122|Community 122]]

## God Nodes (most connected - your core abstractions)
1. `jsonFetch()` - 126 edges
2. `useAuth()` - 97 edges
3. `SemanticModel Interface` - 28 edges
4. `cx()` - 27 edges
5. `inspectZip()` - 25 edges
6. `KPI Interface` - 23 edges
7. `compilerOptions` - 18 edges
8. `serviceClient` - 17 edges
9. `generateReport()` - 16 edges
10. `requireMember()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `DB: org_ai_settings table` --shares_data_with--> `AiConfig`  [INFERRED]
  supabase/migrations/20260612000004_ai_settings.sql → server/src/studio/generator.ts
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

## Communities (120 total, 18 thin omitted)

### Community 0 - "Server API & Database Layer"
Cohesion: 0.10
Nodes (34): Badge(), BadgeProps, BadgeTone, StatusPill, Button(), ButtonProps, ButtonSize, ButtonVariant (+26 more)

### Community 1 - "Studio AI Config & Context Store"
Cohesion: 0.15
Nodes (8): AgentRun, AgentRunEvent, getAgentRun(), listAgentRuns(), Activity(), CRON_LABEL, STATUS, TRIGGER_ICON

### Community 2 - "Demo Data & Sample Models"
Cohesion: 0.06
Nodes (42): atlasRetail, connectors, dates, dimensions, END, margin, marginSeries, measures (+34 more)

### Community 3 - "Analytics & Anomaly Engine"
Cohesion: 0.11
Nodes (28): callJson(), DEFAULT_MODEL, ENTITY_TYPES, EntityRow, ExtractedEntity, ExtractedFact, Extraction, extractKnowledge() (+20 more)

### Community 4 - "Dashboard UI Components"
Cohesion: 0.10
Nodes (46): Vite Dev Server + API Proxy Config, detectAnomalies(), detectAnomaliesSync(), detectInSeries(), Flag, severityFromZ(), ALIASES, answerQuestion() (+38 more)

### Community 5 - "Server Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, adm-zip, cors, dotenv, e2b, express, stripe, @supabase/supabase-js (+20 more)

### Community 6 - "Mission Control Components"
Cohesion: 0.05
Nodes (53): getMemoryGraph(), MemoryGraphData, rebuildMemory(), attr(), esc(), extractTags(), extractWikiLinks(), inline() (+45 more)

### Community 7 - "Client Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, react, react-dom, react-grid-layout, react-router-dom, recharts, @supabase/supabase-js, devDependencies (+14 more)

### Community 8 - "Frontend API Client"
Cohesion: 0.20
Nodes (18): StudioMessage, buildMessages(), buildUserMessage(), callAnthropic(), callOpenAICompatible(), CallResult, DEFAULT_MODEL, escapeHtml() (+10 more)

### Community 9 - "Client TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, moduleDetection (+11 more)

### Community 10 - "Root Monorepo Config"
Cohesion: 0.10
Nodes (20): devDependencies, concurrently, playwright, name, private, scripts, build, db:reset (+12 more)

### Community 11 - "Connector & PBIX Parser"
Cohesion: 0.05
Nodes (57): AGG_FNS, asciiStrings(), BusinessKeyCandidate, Confidence, CONNECTOR_PATTERNS, DataVaultAttributeCandidate, DataVaultEntityCandidate, DataVaultExtraction (+49 more)

### Community 12 - "API Client HTTP Functions"
Cohesion: 0.07
Nodes (31): addMemberByEmail(), cancelInvitation(), createCheckoutSession(), createOrg(), createPortalSession(), getIntegrations(), getPlatformStatus(), getWidget() (+23 more)

### Community 13 - "Product Docs & Landing"
Cohesion: 0.17
Nodes (16): Client SPA Entry Point, Landing Page Design System, DeepLogic Brand Mark, Agent Engine, Anomaly Detection Engine, Ask DeepLogic Feature, Atlas Retail Sample Model, Mission Control (+8 more)

### Community 14 - "Community 14"
Cohesion: 0.15
Nodes (23): SAMPLES, store, demoRouter, DemoSession, evictStale(), put(), store, ingestRouter (+15 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (17): Shared Domain Types (client copy of server/src/types.ts), addVaultItem(), ContextItem, generateStudioReport(), getCompiledContext(), getStudioProject(), removeVaultItem(), StudioProject (+9 more)

### Community 16 - "Auth Pages & Logo"
Cohesion: 0.15
Nodes (17): ContextRow, AgentEvent, AgentStage, Anomaly, AskAnswer, AuditEntry, Connector, Dimension (+9 more)

### Community 17 - "Vault & Studio API"
Cohesion: 0.05
Nodes (49): AdminUserAction, AgentEventKind, AgentRunStreamEvent, AiKeyTestResult, AiProvider, AiProviderState, AiSettings, AlertRule (+41 more)

### Community 18 - "Base TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+4 more)

### Community 19 - "Studio Project CRUD"
Cohesion: 0.13
Nodes (23): DB: org_members table, orgsRouter, Role, ROLES, callerRole(), checkMemberLimit(), requireRole(), acceptInvitation() (+15 more)

### Community 20 - "Studio Chat Interface"
Cohesion: 0.08
Nodes (24): description, devDependencies, react, react-dom, tsup, @types/react, typescript, exports (+16 more)

### Community 21 - "Graphify Knowledge Tool"
Cohesion: 0.20
Nodes (11): Graphify Skill Trigger, Graphify Project Rules, Graphify Skill, Graphify Add URL and Watch Reference, Graphify Graph Exports Reference, Graphify Extraction Subagent Spec, Graphify GitHub Clone and Cross-Repo Merge Reference, Graphify Commit Hook and CLAUDE.md Integration Reference (+3 more)

### Community 22 - "Client Domain Types"
Cohesion: 0.07
Nodes (24): Alert, AlertEvent, checkAlert(), createAlert(), createStudioProject(), deleteAlert(), deleteStudioProject(), listAlertEvents() (+16 more)

### Community 23 - "Vault Browser UI"
Cohesion: 0.08
Nodes (22): deleteVaultEntry(), deleteVaultKpi(), getOrgVault(), getVaultDocContent(), listVaultKpis(), listVaultPowerBI(), testConnectorUrl(), updateVaultMcp() (+14 more)

### Community 24 - "Context Library CRUD"
Cohesion: 0.05
Nodes (32): AnalysisLens, analyzeUrl(), CompetitorSuggestion, CompetitorTrends, ContextKind, ContextScope, createAgentsBulk(), createContext() (+24 more)

### Community 25 - "Server TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, module, moduleResolution, outDir, rootDir, sourceMap, strict, types (+2 more)

### Community 26 - "Auth Context & User Model"
Cohesion: 0.16
Nodes (22): AgentProvider, AgentRuntime, failAgent(), logEvent(), provisionExternalAgent(), ProvisionParams, runOrgoAgent(), normalizeComputer() (+14 more)

### Community 27 - "Vite Node TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, noEmit, skipLibCheck, strict (+1 more)

### Community 28 - "Navigation & Theme"
Cohesion: 0.11
Nodes (16): RequireAuth(), ADMIN_EMAILS, initials(), Nav(), TrialBadge(), TrialBadgeProps, trialCache, UserMenu() (+8 more)

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (14): ALLOWED_MODELS, ALLOWED_SCHEDULES, callAnthropic(), callOpenAICompatible(), CallResult, captionImage(), decodeEntities(), DEFAULT_MODEL (+6 more)

### Community 30 - "Report Preview & Theming"
Cohesion: 0.33
Nodes (9): braveSearch(), ddgInstantAnswer(), decodeEntities(), duckDuckGoSearch(), stripTags(), unwrapDdgUrl(), webSearch(), WebSearchResult (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.19
Nodes (7): Footer(), YEAR, demoIngestSample(), demoIngestUpload(), demoSamples(), BLURBS, Home()

### Community 32 - "BYOK Studio Smoke Test"
Cohesion: 0.25
Nodes (3): mineCard, sharedCard, ts

### Community 33 - "App Bootstrap"
Cohesion: 0.11
Nodes (20): AgentEvent, AgentStage, Anomaly, AskAnswer, AuditEntry, Connector, Dimension, KPI (+12 more)

### Community 45 - "Community 45"
Cohesion: 0.24
Nodes (13): DB: audit_entries table, DB: context_items table, DB: models table, DB: org_ai_settings table, DB: organizations table, DB: studio_projects table, modelsRouter, studioRouter (+5 more)

### Community 46 - "Community 46"
Cohesion: 0.08
Nodes (23): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+15 more)

### Community 47 - "Community 47"
Cohesion: 0.17
Nodes (10): AuthProvider(), acceptInviteToken(), createDashboard(), AcceptInvite(), InviteInfo, DashboardsList(), Login(), Signup() (+2 more)

### Community 48 - "Community 48"
Cohesion: 0.07
Nodes (20): ALL_PROVIDERS, esc(), gatherSiteInsights(), insightWidgetHtml(), KpiAgg, onboardingPublicRouter, ProjectListRow, ProjectRow (+12 more)

### Community 49 - "Community 49"
Cohesion: 0.15
Nodes (10): A, B, D, DATA, iA, iB, iD, Mission (+2 more)

### Community 50 - "Community 50"
Cohesion: 0.13
Nodes (10): DashboardScopeBar(), DashboardSidebar(), GROUP_ICON, Dashboard, DashboardListItem, deleteDashboard(), listDashboards(), updateDashboard() (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.22
Nodes (7): AdminUserDetailPage(), fmtDateTime(), adminDeleteUser(), adminGetUser(), adminResetUserEmail(), adminUpdateUser(), AdminUserDetail

### Community 52 - "Community 52"
Cohesion: 0.10
Nodes (20): CAT_TONE, Category, Skill, Skills, Agent, createAgent(), deleteAgent(), listAgents() (+12 more)

### Community 53 - "Community 53"
Cohesion: 0.05
Nodes (60): Graphify-First PreToolUse Hook, AskPanel(), formatValue(), SUGGESTIONS, ConnectorsStrip(), KIND_LABEL, DimensionBreakdown(), DimensionBreakdownProps (+52 more)

### Community 54 - "Community 54"
Cohesion: 0.15
Nodes (20): useAuth(), useDashboardScope(), SuggestGoalsModal(), GoalSuggestion, API Client, suggestGoals(), Supabase Client, Dashboard() (+12 more)

### Community 55 - "Community 55"
Cohesion: 0.15
Nodes (12): 10. File ownership map (parallel build — keep DISJOINT), 11. Acceptance criteria, 1. Vision, 2. Users, 3. Core user loop (must all work end-to-end), 4. MVP feature set, 5. Architecture, 6. Shared domain types (the contract) (+4 more)

### Community 56 - "Community 56"
Cohesion: 0.08
Nodes (31): ProposedAgent, AGENT_MODELS, ALLOWED_SCHEDULES, analyzeUrl(), ApiLens, buildSystem(), callAI(), callAnthropic() (+23 more)

### Community 57 - "Community 57"
Cohesion: 0.20
Nodes (9): Apply Preset Function, Dashboard Widget Snap Resize — Design Spec, Drag Handle UI, Files Changed, Live Size Badge, Out of Scope, Overview, Preset Constants (+1 more)

### Community 58 - "Community 58"
Cohesion: 0.22
Nodes (8): Dashboard Widget Snap Resize Implementation Plan, File Map, Spec Coverage Check, Task 1: Add preset button CSS and size badge CSS, Task 2: Fix resize handle CSS for all 8 directions, Task 3: Add PRESETS, applyPreset, resizing state, and onResize to DashboardEditor, Task 4: Wire onResize, add preset buttons and size badge to JSX, Task 5: Manual verification

### Community 59 - "Community 59"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 60 - "Community 60"
Cohesion: 0.13
Nodes (12): EVENT_ICON, MISSION, PROVIDERS, REGIONS, SIZES, STATUS, deleteExternalAgent(), deployExternalAgent() (+4 more)

### Community 61 - "Community 61"
Cohesion: 0.29
Nodes (6): DeepLogic, Prerequisites, Run it, Scripts, Stack, Verify

### Community 62 - "Community 62"
Cohesion: 0.08
Nodes (39): actionLabel(), AGENT_TOOL_NAMES, AGENT_TOOLS, AgentContext, ASSISTANT_TOOLS, AssistantReply, AssistantStep, buildSystem() (+31 more)

### Community 63 - "Community 63"
Cohesion: 0.25
Nodes (5): AdminDashboard(), PLAN_ORDER, RestartPhase, adminRestart(), adminStats

### Community 64 - "Community 64"
Cohesion: 0.14
Nodes (13): compilerOptions, declaration, esModuleInterop, jsx, lib, module, moduleResolution, noEmit (+5 more)

### Community 65 - "Community 65"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 66 - "Community 66"
Cohesion: 0.50
Nodes (3): Approach, Constraints, Output Format

### Community 67 - "Community 67"
Cohesion: 0.50
Nodes (3): Approach, Constraints, Output Format

### Community 68 - "Community 68"
Cohesion: 0.50
Nodes (3): Approach, Constraints, Output Format

### Community 69 - "Community 69"
Cohesion: 0.50
Nodes (3): Approach, Constraints, Output Format

### Community 70 - "Community 70"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 71 - "Community 71"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 72 - "Community 72"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 79 - "Community 79"
Cohesion: 0.17
Nodes (10): AdminOrgDetailPage(), fmtDate(), PLAN_PRICE, PLANS, STATUSES, adminGetOrg(), AdminOrgDetail, AdminOrgMember (+2 more)

### Community 80 - "Community 80"
Cohesion: 0.32
Nodes (7): callAI(), CompetitorsResult, CompetitorSuggestion, DEFAULT_MODEL, parseJsonObject(), suggestCompetitors(), SYSTEM

### Community 81 - "Community 81"
Cohesion: 0.06
Nodes (54): ThemeManager(), LibraryItem, Props, TYPES, deleteOrgWidget(), deleteWidget(), generateOrgWidget(), generateWidget() (+46 more)

### Community 82 - "Community 82"
Cohesion: 0.33
Nodes (5): createSandbox(), killSandbox(), updateSandbox(), PaneTab, Props

### Community 83 - "Community 83"
Cohesion: 0.07
Nodes (31): AgentActivityToasts(), ChatTurn, GlobalChat(), QUICK_POOL, render(), activities, Activity, ActivityStep (+23 more)

### Community 84 - "Community 84"
Cohesion: 0.22
Nodes (11): meRouter, checkReportLimit(), readToken(), requireAuth(), requireFeature(), Express.Request Augmentation (user/token/db), listOrgsForUser(), getUserFromToken() (+3 more)

### Community 85 - "Community 85"
Cohesion: 0.13
Nodes (13): ALLOWED, DropZone(), Props, PipelineConsole(), Props, STAGES, BLURBS, Props (+5 more)

### Community 86 - "Community 86"
Cohesion: 0.33
Nodes (3): Cycle, Tier, TIERS

### Community 87 - "Community 87"
Cohesion: 0.13
Nodes (12): ingestToVault(), OnboardingEvent, onboardingPersist(), PowerBIScan, ProposedAgentLite, scanPowerBI(), Company, Competitor (+4 more)

### Community 88 - "Community 88"
Cohesion: 0.09
Nodes (25): appendEvent(), beginRun(), BeginRunOpts, ensureExternalRun(), EventKind, finishRun(), RunStatus, RunTrigger (+17 more)

### Community 89 - "Community 89"
Cohesion: 0.33
Nodes (5): Context, Converter config (`.design-sync/config.json`), design-sync notes — DeepLogic, Re-sync risks / watch-list, The library (`packages/ui`)

### Community 90 - "Community 90"
Cohesion: 0.32
Nodes (7): AiSettingsRow, AiConfig, AiProvider, callAI(), clean(), DEFAULT_MODEL, generateTitle()

### Community 91 - "Community 91"
Cohesion: 0.40
Nodes (5): FEATURE_LABELS, FEATURE_PLAN, PlanGate(), Props, BillingSubscription

### Community 92 - "Community 92"
Cohesion: 0.15
Nodes (11): billingRouter, draftPlan(), GoalAgent, goalsRouter, normalize(), STARTER_GOALS, inviteRouter, sandboxRouter (+3 more)

### Community 93 - "Community 93"
Cohesion: 0.14
Nodes (13): AuthContext, AuthContextValue, AuthUser, RequireAdmin(), State, adminMe(), getMe(), OrgMembership (+5 more)

### Community 94 - "Community 94"
Cohesion: 0.12
Nodes (8): NAV, Props, AdminOrgs(), AdminUsers(), adminListOrgs(), adminListUsers(), AdminOrg, AdminUser

### Community 95 - "Community 95"
Cohesion: 0.40
Nodes (3): out, root, srcDir

### Community 99 - "Community 99"
Cohesion: 0.33
Nodes (4): CAPABILITIES, Capability, COORDINATES, FLOW

### Community 101 - "Community 101"
Cohesion: 0.13
Nodes (21): adminEmails(), adminRouter, PLAN_PRICE, requireAdmin(), handleStripeEvent(), orgIdForCustomer(), priceToplan(), stripe() (+13 more)

### Community 102 - "Community 102"
Cohesion: 0.24
Nodes (5): buildWidgetContext(), dashboardsRouter, fetchConnectorData(), parseConnectorUrl(), checkTokenBudget()

### Community 103 - "Community 103"
Cohesion: 0.29
Nodes (6): Components, DeepLogic UI — how to build with it, Idiomatic snippet, Setup, The styling idiom — use these tokens for your own layout glue, Where the truth lives

### Community 122 - "Community 122"
Cohesion: 0.22
Nodes (4): alertsRouter, inviteEmailHtml(), sendEmail(), SendOptions

## Knowledge Gaps
- **639 isolated node(s):** `meta`, `meta`, `meta`, `items`, `name` (+634 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SemanticModel Interface` connect `Community 14` to `Demo Data & Sample Models`, `Dashboard UI Components`, `Frontend API Client`, `Community 45`, `Auth Pages & Logo`, `Vault & Studio API`, `Studio Project CRUD`, `Community 53`?**
  _High betweenness centrality (0.247) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `Community 54` to `Studio AI Config & Context Store`, `Mission Control Components`, `API Client HTTP Functions`, `Community 15`, `Vault & Studio API`, `Client Domain Types`, `Vault Browser UI`, `Context Library CRUD`, `Navigation & Theme`, `App Bootstrap`, `Community 47`, `Community 50`, `Community 51`, `Community 52`, `Community 53`, `Community 63`, `Community 79`, `Community 81`, `Community 82`, `Community 83`, `Community 85`, `Community 87`, `Community 91`, `Community 93`, `Community 94`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `AuditEntry Interface` connect `Community 53` to `Vault & Studio API`, `Studio Project CRUD`, `Community 45`, `Community 14`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `meta`, `meta`, `meta` to the rest of the system?**
  _640 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server API & Database Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.09714285714285714 - nodes in this community are weakly interconnected._
- **Should `Demo Data & Sample Models` be split into smaller, more focused modules?**
  _Cohesion score 0.0647342995169082 - nodes in this community are weakly interconnected._
- **Should `Analytics & Anomaly Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.11491935483870967 - nodes in this community are weakly interconnected._