-- Per-goal rollup: a synthesized brief from the goal's last agent run, stored on
-- the goal so the Goals page can show "Latest findings" and link to the full doc.

alter table public.goals
  add column last_findings_summary text,
  add column last_findings_doc_id  uuid,
  add column last_findings_at       timestamptz;
