-- Lets an administrator explicitly choose which scheduled payout deducts a
-- penalty. NULL preserves the established automatic payout rule.
alter table public.shift_penalties
  add column if not exists payout_kind text;

alter table public.shift_penalties
  drop constraint if exists shift_penalties_payout_kind_check;

alter table public.shift_penalties
  add constraint shift_penalties_payout_kind_check
  check (
    payout_kind is null or
    payout_kind in ('first_half', 'second_half')
  );

create or replace function private.replace_shift_adjustments(
  p_shift_id uuid,
  p_bonuses jsonb,
  p_penalties jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_amount numeric;
  v_comment text;
  v_payout_kind text;
begin
  if
    jsonb_typeof(coalesce(p_bonuses, '[]'::jsonb)) <> 'array' or
    jsonb_typeof(coalesce(p_penalties, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid_adjustments'
      using errcode = '22023';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_bonuses, '[]'::jsonb))
  loop
    if nullif(v_item ->> 'id', '') is null then
      raise exception 'bonus_id_required'
        using errcode = '22023';
    end if;

    v_id := (v_item ->> 'id')::uuid;
    v_amount := (v_item ->> 'amount')::numeric;
    v_comment := trim(coalesce(v_item ->> 'comment', ''));

    if
      v_amount <= 0 or
      v_amount > 10000000 or
      v_amount * 100 <> trunc(v_amount * 100) or
      length(v_comment) = 0
    then
      raise exception 'invalid_bonus'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.shift_bonuses b
      where b.id = v_id
        and b.shift_id <> p_shift_id
    ) then
      raise exception 'bonus_belongs_to_another_shift'
        using errcode = '23503';
    end if;

    insert into public.shift_bonuses(
      id,
      shift_id,
      amount,
      comment,
      created_by,
      updated_by
    ) values (
      v_id,
      p_shift_id,
      v_amount,
      v_comment,
      auth.uid(),
      auth.uid()
    )
    on conflict (id)
    do update set
      amount = excluded.amount,
      comment = excluded.comment,
      updated_by = auth.uid();
  end loop;

  delete from public.shift_bonuses b
  where b.shift_id = p_shift_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_bonuses, '[]'::jsonb)) item
      where nullif(item ->> 'id', '')::uuid = b.id
    );

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_penalties, '[]'::jsonb))
  loop
    if nullif(v_item ->> 'id', '') is null then
      raise exception 'penalty_id_required'
        using errcode = '22023';
    end if;

    v_id := (v_item ->> 'id')::uuid;
    v_amount := (v_item ->> 'amount')::numeric;
    v_comment := trim(coalesce(v_item ->> 'comment', ''));
    v_payout_kind := nullif(
      coalesce(
        v_item ->> 'payoutKind',
        v_item ->> 'payout_kind',
        ''
      ),
      ''
    );

    if
      v_amount <= 0 or
      v_amount > 10000000 or
      v_amount * 100 <> trunc(v_amount * 100) or
      length(v_comment) = 0 or
      (
        v_payout_kind is not null and
        v_payout_kind not in ('first_half', 'second_half')
      )
    then
      raise exception 'invalid_penalty'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.shift_penalties p
      where p.id = v_id
        and p.shift_id <> p_shift_id
    ) then
      raise exception 'penalty_belongs_to_another_shift'
        using errcode = '23503';
    end if;

    insert into public.shift_penalties(
      id,
      shift_id,
      amount,
      comment,
      payout_kind,
      created_by,
      updated_by
    ) values (
      v_id,
      p_shift_id,
      v_amount,
      v_comment,
      v_payout_kind,
      auth.uid(),
      auth.uid()
    )
    on conflict (id)
    do update set
      amount = excluded.amount,
      comment = excluded.comment,
      payout_kind = excluded.payout_kind,
      updated_by = auth.uid();
  end loop;

  delete from public.shift_penalties p
  where p.shift_id = p_shift_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_penalties, '[]'::jsonb)) item
      where nullif(item ->> 'id', '')::uuid = p.id
    );
end;
$$;
