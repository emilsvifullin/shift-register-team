import {
  supabaseClient
} from "../supabase.js";

import {
  resultData
} from "./result.js";

function adjustmentPayload(
  rows,
  {
    includePayoutKind=false
  }={}
){
  return (rows || [])
    .map(item=>({
      id:item.id,
      amount:Number(item.amount),
      comment:String(
        item.comment || ""
      ).trim(),
      ...(includePayoutKind
        ? {
            payoutKind:
              item.payoutKind ||
              null
          }
        : {})
    }));
}

function shiftPayload(value){
  return {
    p_shift_id:value.id,
    p_employee_id:value.employeeId,
    p_shift_date:value.date,
    p_point_id:value.dbPointId,
    p_shift_type:value.type,
    p_shk:
      value.shk==="" ||
      value.shk===null
        ? null
        : Number(value.shk),
    p_partial:
      value.partial===true,
    p_hours:
      value.partial
        ? Number(value.hours)
        : null,
    p_note:
      value.note || null,
    p_bonuses:
      adjustmentPayload(
        value.bonuses
      ),
    p_penalties:
      adjustmentPayload(
        value.penalties,
        {
          includePayoutKind:true
        }
      ),
    p_base_amount_override:
      value.baseOverride==="" ||
      value.baseOverride===null ||
      value.baseOverride===undefined
        ? null
        : Number(
            value.baseOverride
          ),
    p_base_amount_reason:
      String(
        value.baseOverrideReason || ""
      ).trim() || null
  };
}

/*
  Все изменения смен идут через версию с проверкой периода: закрытый
  период не должен меняться без согласия, и решать это должен сервер, а
  не желание вызывающего.

  Запасного пути на прежнюю версию здесь нет намеренно. Она не знает ни
  про причину корректировки, ни про закрытый период, поэтому «сохранить
  хоть как-нибудь» означало бы записать смену в закрытый период без
  подтверждения и без следа в истории. Если базы с v4 не окажется,
  правильный ответ — отказ, а не тихий обход проверки.
*/
export async function saveAdminShift(
  value,
  {force=false,reason=null}={}
){
  return resultData(
    await supabaseClient.rpc(
      "admin_save_shift_v4",
      {
        ...shiftPayload(value),
        p_force:force,
        p_reason:reason
      }
    ),
    "Не удалось сохранить смену"
  );
}

/*
  Явный пересчёт смены по тарифу, действующему на её дату сейчас.
  Обычное сохранение ничего не переоценивает — это отдельное решение
  администратора.
*/
export async function repriceAdminShift(
  id,
  {force=false,reason=null}={}
){
  return resultData(
    await supabaseClient.rpc(
      "admin_reprice_shift_v2",
      {
        p_shift_id:id,
        p_force:force,
        p_reason:reason
      }
    ),
    "Не удалось пересчитать смену"
  );
}

export async function deleteAdminShift(
  id,
  {force=false,reason=null}={}
){
  const result=
    await supabaseClient
      .rpc(
        "admin_delete_shift_v2",
        {
          p_shift_id:id,
          p_force:force,
          p_reason:reason
        }
      );

  return resultData(
    result,
    "Не удалось удалить смену"
  );
}

export async function importAdminLegacyShift(
  value
){
  const result=
    await supabaseClient
      .rpc(
        "admin_import_legacy_shift",
        {
          p_legacy_source_id:
            value.legacySourceId,
          p_employee_id:
            value.employeeId,
          p_point_id:value.pointId,
          p_shift_date:
            value.shiftDate,
          p_shift_type:
            value.shiftType,
          p_shk:value.shk,
          p_partial:value.partial,
          p_hours:value.hours,
          p_full_hours:
            value.fullHours,
          p_base_amount:
            value.baseAmount,
          p_pricing_snapshot:
            value.pricingSnapshot,
          p_bonuses:
            adjustmentPayload(
              value.bonuses
            ),
          p_penalties:
            adjustmentPayload(
              value.penalties,
              {
                includePayoutKind:
                  true
              }
            )
        }
      );

  return resultData(
    result,
    "Не удалось импортировать смену"
  );
}

export async function importAdminLegacyShifts(
  values,
  {
    onProgress=()=>{}
  }={}
){
  const ids=[];

  for(
    let index=0;
    index<values.length;
    index++
  ){
    ids.push(
      await importAdminLegacyShift(
        values[index]
      )
    );

    onProgress({
      completed:index+1,
      total:values.length
    });
  }

  return ids;
}
