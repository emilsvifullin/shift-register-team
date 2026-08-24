alter table public.points
  add column if not exists code text,
  add column if not exists pricing_type text not null default 'shk_tiers',
  add column if not exists fixed_rate numeric(12,2),
  add column if not exists advance_enabled boolean not null default false,
  add column if not exists sort_order integer;

create unique index if not exists points_code_key
  on public.points(code)
  where code is not null;

alter table public.points
  drop constraint if exists points_code_format_check,
  add constraint points_code_format_check
    check (code is null or code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  drop constraint if exists points_pricing_type_check,
  add constraint points_pricing_type_check
    check (pricing_type in ('fixed','shk_tiers')),
  drop constraint if exists points_fixed_rate_consistency_check,
  add constraint points_fixed_rate_consistency_check
    check (
      (pricing_type = 'fixed' and fixed_rate is not null and fixed_rate > 0)
      or
      (pricing_type = 'shk_tiers' and fixed_rate is null)
    ),
  drop constraint if exists points_sort_order_check,
  add constraint points_sort_order_check
    check (sort_order is null or sort_order > 0);

insert into public.points (
  code,
  name,
  pricing_type,
  fixed_rate,
  advance_enabled,
  sort_order,
  active
)
values
  ('kommunalnaya-10', 'Коммунальная Улица 10', 'shk_tiers', null, false, 1, true),
  ('radialnaya-3k11', '6-Я Радиальная 3к11', 'fixed', 3000, false, 2, true),
  ('novoyasenevskiy-22k1', 'Новоясеневский Проспект 22к1', 'shk_tiers', null, false, 3, true),
  ('kuzminskaya-5', 'Кузьминская 5', 'shk_tiers', null, false, 4, true),
  ('korabelnaya-1', 'Корабельная 1', 'fixed', 3000, false, 5, true),
  ('nagatinskaya-56a', 'Нагатинская Набережная 56а', 'fixed', 3000, false, 6, true),
  ('volgogradskiy-73s1', 'Волгоградский Проспект 73с1', 'shk_tiers', null, true, 7, true),
  ('yartsevskaya-6', 'Ярцевская 6', 'shk_tiers', null, true, 8, true),
  ('yartsevskaya-25a', 'Ярцевская 25а', 'shk_tiers', null, true, 9, true),
  ('pyatnitskiy-2', 'Пятницкий Переулок 2', 'shk_tiers', null, true, 10, true),
  ('mustaya-karima-12', 'Мустая Карима 12', 'fixed', 3000, false, 11, true),
  ('kruzenshterna-9', 'Крузенштерна 9', 'fixed', 3000, false, 12, true),
  ('bolshoy-ovchinnikovskiy-16', 'Большой Овчинниковский Переулок 16', 'shk_tiers', null, true, 13, true),
  ('prokatnaya-2', 'Прокатная 2', 'shk_tiers', null, true, 14, true)
on conflict (code) where code is not null do update
set
  name = excluded.name,
  pricing_type = excluded.pricing_type,
  fixed_rate = excluded.fixed_rate,
  advance_enabled = excluded.advance_enabled,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();
