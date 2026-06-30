-- Allow half-step block sizes/positions on dashboards (e.g. 4 × 2.5). The editor
-- runs the grid at 2× resolution and stores coarse units that can be fractional.
alter table public.widgets
  alter column grid_x type numeric using grid_x::numeric,
  alter column grid_y type numeric using grid_y::numeric,
  alter column grid_w type numeric using grid_w::numeric,
  alter column grid_h type numeric using grid_h::numeric;
