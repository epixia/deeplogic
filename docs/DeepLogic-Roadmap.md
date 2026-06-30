# DeepLogic — Product Roadmap

> **Vision:** Turn an organization's scattered, tacit knowledge into a living, queryable "second brain" — and let staff capture it, build on it, and ship internal tools against it without leaving the platform.

**Status:** H1 2026 foundation **shipped** ✅ · Now hardening & scaling
**Owner:** Michael (michael@epixia.com) · **Last updated:** 29 Jun 2026

---

## Legend

| Badge | Meaning |
|---|---|
| ✅ | Shipped / live |
| 🚧 | In progress |
| 🔮 | Planned / next |
| ⚠️ | Needs configuration or dependency |

---

## At a glance

| Workstream | Status | Headline |
|---|---|---|
| 1. Data Vault & Ingestion | ✅ | Multi-upload, tagging, edit/delete, second-brain recall |
| 2. Knowledge Graph & Memory | ✅ | GraphRAG recall, dedupe, curation UI, visual graph |
| 3. AI Interviews ("Brain Dump") | ✅ | Browser, Avatar, Voice, Phone & **Video** capture |
| 4. Employees & Mass Dispatch | ✅ | Roster, LinkedIn enrichment, bulk interview dispatch |
| 5. Innovation Lab (vibecoding) | ✅ | Build tools in sandboxes, data-grounded, walled Garden |
| 6. Autonomous Agents | ✅ | Hermes / OpenClaw on real Orgo VMs, governed missions |
| 7. Admin & Integrations | ✅ | Global service keys, env-backed, super-admin managed |
| 8. Analytics & Demo | ✅ | Cannara demo data, dashboards, realistic sales emulation |

---

## Workstream 1 — Data Vault & Knowledge Ingestion ✅

The single home for the org's knowledge: files, documents, datasets, websites, connectors and notes.

- ✅ **Multi-file upload** with live ingestion feedback
- ✅ **Markdown knowledge files** — hybrid auto-classification + manual tag/category override
- ✅ **Edit / multi-select / delete** of MD files
- ✅ **"Second brain" recall** — semantic match over vault content; the assistant cites *which* MD files it read
- ✅ **Databases, MCP, API & website connectors** unified in the vault
- ✅ Hidden KPIs tab (parked) · 👥 **Employees** tab added (see WS4)

**Next:** 🔮 Vault-wide search + type filter on the main page · 🔮 inline preview for more file types

---

## Workstream 2 — Knowledge Graph & Memory (GraphRAG) ✅

Bi-temporal memory of entities, facts and episodes that powers recall and attribution.

- ✅ **Graph-aware recall (GraphRAG)** — seed + 1-hop expansion over the knowledge graph
- ✅ **Dedupe hardening** — canonical keys, predicate canonicalization, entity reuse with aliases
- ✅ **Curation UI** — merge / edit / delete entities & facts
- ✅ **Visual graph** — search, filters, focus mode, directional edges, mention counts

**Next:** 🔮 Auto-schema grounding from analyzed databases feeding the graph

---

## Workstream 3 — AI Interviews ("Brain Dump") ✅

An AI interviewer pulls a teammate's know-how straight into the Data Vault + graph, with attribution. A **mind dump**, not a quiz.

| Channel | Status | Notes |
|---|---|---|
| 💬 In browser | ✅ | Typed or spoken (mic) answers |
| 🧑‍💼 Avatar (HeyGen / LiveAvatar) | ✅ ⚠️ | Live avatar interviewer; needs LiveAvatar key |
| 🎙 Voice call (Vapi web) | ✅ | In-browser voice, mute + "speaking" indicator |
| ☎ Phone call (Vapi) | ✅ ⚠️ | Outbound call; transcripts auto-save with `PUBLIC_API_URL` |
| 📹 **Video** | ✅ | Records interviewee webcam → private storage + transcript |

- ✅ **Interviewee picker** pre-fills from the **Employees roster** (name / role / phone)
- ✅ Remembers last interviewee · ✅ saves transcript → vault note → memory graph

**Next:** 🔮 Inline video playback on the note · 🔮 recording length/size cap

---

## Workstream 4 — Employees & Mass Interview Dispatch ✅

The company's people as data — the launchpad for harvesting knowledge at scale.

- ✅ **Employees roster** (name, email, phone, title, dept, status)
- ✅ **CSV import** (auto-maps LinkedIn / HRIS / Clay / Lusha exports)
- ✅ **🔎 Fetch from LinkedIn** — enrichment via provider API (Apollo / Proxycurl) ⚠️ needs key
- ✅ **Multi-select → mass interview dispatch**
- ✅ Status tracking: pending → dispatched → interviewed

**Next:** 🔮 Directory connectors (Google Workspace / M365 / Slack) for authoritative rosters · 🔮 coverage dashboard (knowledge-risk by department) · 🔮 email-link async dispatch

---

## Workstream 5 — Innovation Lab (Vibecoding) ✅

Staff build internal tools with a coding agent in isolated sandboxes, then share them on a walled wall.

- ✅ **Build** tools via Claude / Gemini / Codex / OpenRouter in **e2b sandboxes** with live preview
- ✅ **Remembered engine** choice (per-org, in DB)
- ✅ **Data grounding** — pick Data Vault sources (docs, MCP, **connected databases**, APIs) to build against
- ✅ **Search + type filter** on sources · ✅ **"Data used (N)"** transparency bar
- ✅ **🌱 Garden** — publish tools to the org-only wall
- ✅ **Open app ↗** — published tools launch standalone (app-only, new window)
- ✅ Click-to-open cards, delete, resume-on-open (no stale-sandbox flash)

**Next:** 🔮 Auto-inject analyzed DB **schema** into builds · 🔮 persistent "always-on" deploy on publish

---

## Workstream 6 — Autonomous Agents (Hermes / OpenClaw + Orgo) ✅

Outsource multi-step missions to autonomous agents on real cloud computers.

- ✅ **Orgo.ai integration** — provisions real VMs and runs missions
- ✅ **Hermes** (outreach) & **OpenClaw** (research/extraction) personas with generated "souls"
- ✅ **Human-in-the-loop** deploy (preview → explicit approval)
- ✅ **Governed goal generation** — missions scoped to legitimate purpose + owned data; agents keep their own judgment
- ✅ Reliability: long-mission timeout fix, real error causes surfaced, VM auto-stop on failure

**Next:** 🔮 One-click "owned source" wiring · 🔮 budget/cadence guardrail presets in UI

---

## Workstream 7 — Admin & Platform Integrations ✅

Global, platform-wide services managed by super-admins.

- ✅ **Admin → Integrations** panel for **HeyGen** & **Vapi** keys
- ✅ **Env-backed storage** — view/edit actual values, saves to `.env`, applied live (no restart)
- ✅ Show/Hide keys toggle · audit-logged saves
- ✅ Per-org Orgo connection (BYOK) with connection test

**Next:** 🔮 Fold Orgo + enrichment (Apollo/Lusha) keys into the same panel

---

## Workstream 8 — Analytics & Demo (Cannara) ✅

A hands-on testing ground proving the platform end-to-end.

- ✅ **Cannara demo dataset** (cultivation + sales, `cnra_*`)
- ✅ **Mission Control dashboard** with live Blocks reading Supabase
- ✅ **Realistic sales emulation** — product×channel mix, growth, seasonality, 4/20 & holiday spikes, promos
- ✅ **Cached DB analysis** — schema stored, re-used unless refreshed
- ✅ Dark-mode fixes (Power BI doc titles)

**Next:** 🔮 Schema-aware Block generation from cached analysis

---

## Roadmap horizons

### Now (shipped, hardening)
End-to-end loop works: **capture** (interviews/vault) → **organize** (graph) → **act** (vibecode tools, dispatch agents).

### Next (H2 2026)
- Directory connectors for authoritative employee rosters
- Database **schema grounding** for vibecoding & graph
- Coverage / knowledge-risk dashboard
- Persistent deploy for published tools
- Consolidated integrations admin

### Later
- Multi-tenant BYOK across all services
- Async (email-link) interview dispatch at scale
- Inline media (video playback) across the vault

---

## Dependencies & configuration ⚠️

| Capability | Requires |
|---|---|
| Avatar interviews | LiveAvatar API key (`HEYGEN_API_KEY`) |
| Voice / Phone interviews | Vapi keys; phone transcripts need `PUBLIC_API_URL` (ngrok in dev) |
| LinkedIn enrichment | Apollo or Proxycurl key (`ENRICH_*`) |
| Autonomous agents | Orgo API key + paid plan for VMs |
| Vibecoding sandboxes | `E2B_API_KEY` |
| Video interviews | Supabase Storage (auto-bucket) + camera/mic permission |

> 🔐 **Security note:** API keys are configured server-side (Admin → Integrations / `.env`); rotate any key that has been shared, and keep `server/.env` out of version control.
