-- Полное удаление ПВЗ вместе с историей.
--
-- admin_delete_point отказывал, если по ПВЗ есть смены (point_has_history),
-- и предлагал архив. Архив — не удаление: закрытый ПВЗ остаётся в данных,
-- в расчётах и в списках. Администратору нужно именно убрать пункт
-- целиком.
--
-- Порядок удаления задаётся связями: points <- shifts стоит на restrict,
-- поэтому смены удаляются первыми, а с ними каскадом уходят их премии и
-- штрафы. Назначения сотрудников и история тарифов уходят каскадом от
-- самого ПВЗ. Всё это одна транзакция: функция либо снимает ПВЗ целиком,
-- либо не меняет ничего.
--
-- Что намеренно остаётся:
--
--   * audit_log — след удаления. Его пишет триггер на самих таблицах, и
--     ссылок по внешнему ключу у него нет, так что записи переживают
--     удаление. Это и нужно: журнал должен помнить, что было снято.
--   * employee_payouts — записи о деньгах, которые действительно
--     выплачены. Они привязаны к сотруднику, а не к ПВЗ. Удалять их
--     вместе с ПВЗ значило бы стереть факт выплаты; приложение честно
--     покажет переплату, если начисления уменьшились.
--
-- Имя ПВЗ передаётся вторым доводом и сверяется на сервере: даже если
-- интерфейс отстал от данных, удалится ровно то, что человек назвал.
begin;

create or replace function public.admin_delete_point_cascade(
  p_point_id uuid,
  p_point_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_point public.points%rowtype;
  v_shifts integer;
  v_bonuses integer;
  v_penalties integer;
  v_links integer;
  v_tariffs integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_point
  from public.points
  where id = p_point_id
  for update;

  if not found then
    raise exception 'point_not_found'
      using errcode = 'P0002';
  end if;

  if
    lower(btrim(coalesce(p_point_name, ''))) is distinct from
    lower(btrim(v_point.name))
  then
    raise exception 'point_name_mismatch'
      using errcode = '22023';
  end if;

  select count(*)
  into v_shifts
  from public.shifts
  where point_id = p_point_id;

  select count(*)
  into v_bonuses
  from public.shift_bonuses b
  join public.shifts s on s.id = b.shift_id
  where s.point_id = p_point_id;

  select count(*)
  into v_penalties
  from public.shift_penalties p
  join public.shifts s on s.id = p.shift_id
  where s.point_id = p_point_id;

  select count(*)
  into v_links
  from public.employee_points
  where point_id = p_point_id;

  select count(*)
  into v_tariffs
  from public.point_tariffs
  where point_id = p_point_id;

  -- Смены первыми: связь points <- shifts стоит на restrict. Премии и
  -- штрафы уходят каскадом от самих смен.
  delete from public.shifts
  where point_id = p_point_id;

  -- Назначения сотрудников и история тарифов уходят каскадом отсюда.
  delete from public.points
  where id = p_point_id;

  return jsonb_build_object(
    'point_id', p_point_id,
    'name', v_point.name,
    'shifts', v_shifts,
    'bonuses', v_bonuses,
    'penalties', v_penalties,
    'employee_points', v_links,
    'tariffs', v_tariffs
  );
end;
$$;

revoke all on function public.admin_delete_point_cascade(uuid, text)
  from public, anon;

grant execute on function public.admin_delete_point_cascade(uuid, text)
  to authenticated;

commit;
