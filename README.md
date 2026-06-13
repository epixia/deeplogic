# DeepLogic

**From reports to a control room that thinks.**

A multi-tenant SaaS that ingests a semantic model, auto-generates an interactive
dashboard, and runs an agentic Mission Control that watches KPIs, detects
anomalies, explains the root cause, and recommends the next action.

See [PRD.md](PRD.md) for the full product spec and architecture (v1 = the agentic
product; v2 = the multi-tenant SaaS layer).

## Stack

- **client/** — Vite + React + TypeScript + Recharts (design system from `deeplogic-landing.html`).
- **server/** — Express + TypeScript. The **agent engine** (`server/src/engine/*`)
  does real analytics: rolling-baseline z-score anomaly detection, dimension
  root-cause attribution, recommendations, NL briefs (optionally enhanced by the
  Claude API if `ANTHROPIC_API_KEY` is set — off by default).
- **supabase/** — local Supabase (Postgres + Auth + RLS). Multi-tenant:
  Organization → members with `owner/admin/member` RBAC, row-level isolation by
  `org_id`. Each new org is seeded with two sample models (Atlas Retail, Northwind SaaS).
- **DeepLogic Studio** — a Lovable/Replit-style AI report builder. Each member has a
  private silo; chat to generate a self-contained HTML report (live preview + code +
  versions), share to the org or publish. A per-user/org **Context Library** (docs, HTML,
  MCP descriptors, notes) compiles into an augmented `CONTEXT.md` the model reads, and
  reports can be **grounded** in the org's real semantic models. Uses `claude-opus-4-8`
  when `ANTHROPIC_API_KEY` is set, else a deterministic template generator.
- **Public homepage demo** — upload a `.pbix`/`.pbit` (or pick a sample) at `/` and explore a
  full ephemeral dashboard + Mission Control with no login.

## Prerequisites

- Node 20+ and npm
- Docker (running) + the [Supabase CLI](https://supabase.com/docs/guides/cli)

## Run it

```bash
# 1. Start local Supabase (Postgres + Auth + Studio). First run pulls images.
npm run supabase:start
#    -> apply the schema/RLS migration:
npm run db:reset

# 2. Install dependencies
npm install

# 3. Env: server/.env and client/.env are pre-filled with the standard local
#    Supabase keys. If `supabase status` shows different keys, copy them in
#    (see server/.env.example and client/.env.example).

# 4. Run client + server together
npm run dev
#    client -> http://localhost:5173   (Vite, proxies /api -> :8787)
#    server -> http://localhost:8787
#    Supabase Studio -> http://localhost:54323
```

Then open http://localhost:5173 → **Sign up** → **create an organization** (auto-seeded
with the two sample models) → explore the **Dashboard**, **Mission Control**, and **Ask DeepLogic**.

## Verify

```bash
# With Supabase up and the API server running, run the end-to-end smoke test:
npm run smoke
```

It signs up two users in separate orgs and asserts: auto-seeding, real anomaly
detection, approve→persisted audit, Ask, and **RLS isolation** (one tenant cannot
read another's data).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Run client + server (watch mode) |
| `npm run build` | Type-check + build both packages |
| `npm run typecheck` | `tsc --noEmit` for both packages |
| `npm run supabase:start` / `:stop` | Start / stop local Supabase |
| `npm run db:reset` | Re-apply migrations (resets local DB) |
| `npm run smoke` | End-to-end multi-tenant smoke test |
