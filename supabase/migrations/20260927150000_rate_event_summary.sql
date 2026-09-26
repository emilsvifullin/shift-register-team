-- Дата в событии о ставке стояла дважды.
--
-- Запись читалась так: «Своя ставка назначена · 26 сентября · Финал ПВЗ
-- · 4 200 ₽ с 26.09.2026». Дату пишет приложение — она приходит
-- отдельным полем, — а строка от сервера добавляла её ещё раз и другим
-- почерком. В строке остаётся только то, чего приложение знать не
-- может: ПВЗ и сама ставка.
begin;

create or replace function public.admin_add_employee_rate(
  p_employee_id uuid,
  p_point_id uuid,
  p_effective_from date,
  p_pricing_type text,
  p_fixed_rate numeric,
  p_shk_tiers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_point text;
begin
  if not private.is_admin() then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if
    p_employee_id is null or
    p_point_id is null or
    p_effective_from is null
  then
    raise exception 'invalid_employee_rate_target'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.employee_points ep
    where ep.employee_id = p_employee_id
      and ep.point_id = p_point_id
      and ep.active = true
  ) then
    raise exception 'point_not_assigned'
      using errcode = '22023';
  end if;

  perform private.validate_tariff_payload(
    p_pricing_type,
    p_fixed_rate,
    p_shk_tiers
  );

  insert into public.employee_point_rates(
    employee_id,
    point_id,
    effective_from,
    pricing_type,
    fixed_rate,
    shk_tiers,
    created_by,
    updated_by
  ) values (
    p_employee_id,
    p_point_id,
    p_effective_from,
    p_pricing_type,
    p_fixed_rate,
    p_shk_tiers,
    auth.uid(),
    auth.uid()
  )
  returning id into v_id;

  select name into v_point from public.points where id = p_point_id;

  perform private.record_rate_event(
    p_employee_id,
    p_point_id,
    p_effective_from,
    'rate_added',
    coalesce(v_point, 'ПВЗ') || ' · ' ||
      private.rate_text(p_pricing_type, p_fixed_rate, p_shk_tiers)
  );

  return v_id;
end;
$$;

commit;
