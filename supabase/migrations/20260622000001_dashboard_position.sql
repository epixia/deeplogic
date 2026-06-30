-- Dashboard ordering: a per-org sort position so users can drag dashboards into
-- any order (within and across groups). Lower = earlier.
alter table dashboards add column if not exists position int not null default 0;

-- Backfill: seed positions from the current (updated_at desc) order per org so
-- existing dashboards keep a stable, sensible initial order.
with ranked as (
  select id, row_number() over (partition by org_id order by updated_at desc) - 1 as rn
  from dashboards
)
update dashboards d set position = ranked.rn from ranked where ranked.id = d.id;

create index if not exists dashboards_org_position_idx on dashboards (org_id, position);
