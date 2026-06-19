-- Extend the context_items.kind check constraint to support two new vault
-- sections — 'website' (a tracked URL the AI fetches live) and 'data' (uploaded
-- spreadsheets / CSV / tabular files) — plus 'image', which the API handler has
-- always accepted but the original constraint omitted.

alter table public.context_items
  drop constraint if exists context_items_kind_check;

alter table public.context_items
  add constraint context_items_kind_check
  check (kind in ('doc', 'html', 'mcp', 'note', 'image', 'website', 'data'));
