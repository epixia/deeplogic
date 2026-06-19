-- Finer dashboard grid (half-step sizing): double the column/row resolution.
-- Existing widget cells are doubled so they keep the same visual size, and the
-- size limits are widened to fit the finer grid (6 columns, half-height rows).
alter table public.widgets drop constraint if exists widgets_grid_w_check;
alter table public.widgets drop constraint if exists widgets_grid_h_check;

update public.widgets
  set grid_x = grid_x * 2, grid_y = grid_y * 2, grid_w = grid_w * 2, grid_h = grid_h * 2;

alter table public.widgets add constraint widgets_grid_w_check check (grid_w between 1 and 12);
alter table public.widgets add constraint widgets_grid_h_check check (grid_h between 1 and 12);
