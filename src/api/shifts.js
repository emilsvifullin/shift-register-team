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

/*
  Причину корректировки оклада хранит своё поле, и требует её v3.

  База обновляется отдельно от статики, поэтому клиент может застать базу
  без v3. Пока причина не введена, терять нечего: смена уходит через v2
  ровно как раньше. Если причина введена, молча сохранить её некуда —
  тогда честнее сказать, что база ещё не обновлена, чем принять текст и
  выбросить его.
*/
function missingFunction(error){
  if(error?.code==="PGRST202"){
    return true;
  }

  const message=String(
    error?.message || ""
  );

  return (
    message.includes(
      "admin_save_shift_v3"
    ) &&
    /does not exist|could not find|schema cache/i
      .test(message)
  );
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

export async function saveAdminShift(
  value
){
  const payload=shiftPayload(value);

  const result=
    await supabaseClient
      .rpc(
        "admin_save_shift_v3",
        payload
      );

  if(
    !result.error ||
    !missingFunction(result.error)
  ){
    return resultData(
      result,
      "Не удалось сохранить смену"
    );
  }

  if(payload.p_base_amount_reason){
    throw new Error(
      "Причину корректировки пока негде сохранить: база не обновлена"
    );
  }

  const {
    p_base_amount_reason,
    ...legacy
  }=payload;

  return resultData(
    await supabaseClient
      .rpc(
        "admin_save_shift_v2",
        legacy
      ),
    "Не удалось сохранить смену"
  );
}
export async function deleteAdminShift(
  id
){
  const result=
    await supabaseClient
      .rpc(
        "admin_delete_shift",
        {
          p_shift_id:id
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
