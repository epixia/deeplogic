-- Raise maximum widget height from 2 to 5 rows
alter table public.widgets
  drop constraint if exists widgets_grid_h_check;

alter table public.widgets
  add constraint widgets_grid_h_check check (grid_h between 1 and 5);
