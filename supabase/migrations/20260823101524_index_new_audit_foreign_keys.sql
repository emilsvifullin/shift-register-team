create index employee_points_created_by_idx
  on public.employee_points(created_by);

create index employee_points_updated_by_idx
  on public.employee_points(updated_by);

create index point_tariffs_created_by_idx
  on public.point_tariffs(created_by);

create index point_tariffs_updated_by_idx
  on public.point_tariffs(updated_by);
