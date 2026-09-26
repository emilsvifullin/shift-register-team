-- Прежние версии финансовых функций больше не вызываются снаружи.
--
-- Проверку закрытого периода знают только последние версии: v4 для
-- сохранения смены, v2 для её удаления, пересчёта и для выплат. Прежние
-- версии остались в базе, потому что новые вызывают их внутри — но
-- `execute` для `authenticated` у них тоже остался. А это значит, что
-- закрытый или уже выплаченный период можно изменить в обход и
-- подтверждения, и записи в истории: достаточно назвать старое имя.
--
-- Функции не удаляются: цепочка v4 → v3 → admin_save_shift рабочая, и
-- v2-обёртки выплат тоже опираются на прежние. `security definer`
-- исполняет их от владельца, поэтому внутренние вызовы снятие прав
-- снаружи не задевает.
--
-- admin_import_legacy_shift здесь нет намеренно: перенос локального
-- архива по своей природе пишет смены в старые, давно закрытые месяцы,
-- и проверка периода запретила бы его целиком.
begin;

revoke execute on function public.admin_save_shift(
  uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb
) from authenticated;

revoke execute on function public.admin_save_shift_v2(
  uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb, numeric
) from authenticated;

revoke execute on function public.admin_save_shift_v3(
  uuid, uuid, date, uuid, text, integer, boolean, numeric, text, jsonb, jsonb, numeric, text
) from authenticated;

revoke execute on function public.admin_delete_shift(uuid)
  from authenticated;

revoke execute on function public.admin_reprice_shift(uuid)
  from authenticated;

revoke execute on function public.admin_save_employee_payout(
  uuid, uuid, date, text, numeric, date, text
) from authenticated;

revoke execute on function public.admin_delete_employee_payout(uuid)
  from authenticated;

commit;
