-- Agents — named AI agents with system prompts, model selection, and optional schedule.

CREATE TABLE IF NOT EXISTS public.agents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by   uuid        REFERENCES auth.users(id),
  name         text        NOT NULL,
  description  text        NOT NULL DEFAULT '',
  model        text        NOT NULL DEFAULT 'claude-sonnet-4-6',
  system_prompt text       NOT NULL DEFAULT '',
  schedule     text,       -- cron expression or NULL (manual only)
  last_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- All org members can read agents
CREATE POLICY "org_members_read_agents" ON public.agents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = agents.org_id AND user_id = auth.uid()
    )
  );

-- All org members can create agents
CREATE POLICY "org_members_insert_agents" ON public.agents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = agents.org_id AND user_id = auth.uid()
    )
  );

-- Creator or owner/admin can update
CREATE POLICY "creator_or_admin_update_agents" ON public.agents
  FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = agents.org_id AND user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Creator or owner/admin can delete
CREATE POLICY "creator_or_admin_delete_agents" ON public.agents
  FOR DELETE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE org_id = agents.org_id AND user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
