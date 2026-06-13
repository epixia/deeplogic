-- DeepLogic Studio — per-report "Data Vault" (PRD v3.1).
-- Each report can attach its own files, MCP servers, APIs, and notes that feed
-- the AI's context when vibecoding THIS report. Stored as jsonb on the project
-- (project-scoped, already RLS-isolated by the studio_projects policies).
--   vault: [{ id, kind: 'file'|'mcp'|'api'|'note', name, content, meta, ts }]

alter table public.studio_projects
  add column if not exists vault jsonb not null default '[]'::jsonb;
