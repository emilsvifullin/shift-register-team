import {
  supabaseClient
} from "../supabase.js";

import {
  resultData
} from "./result.js";

export async function saveAdminPoint({
  id=null,
  name,
  sortOrder,
  active=true,
  advanceEnabled=false,
  pricingType=null,
  fixedRate=null,
  shkTiers=null,
  effectiveFrom=null
}){
  const result=
    await supabaseClient
      .rpc(
        "admin_save_point",
        {
          p_point_id:id,
          p_name:name,
          p_sort_order:Number(
            sortOrder
          ),
          p_active:active,
          p_advance_enabled:
            advanceEnabled,
          p_pricing_type:
            pricingType,
          p_fixed_rate:
            fixedRate===null ||
            fixedRate===""
              ? null
              : Number(fixedRate),
          p_shk_tiers:shkTiers,
          p_effective_from:
            effectiveFrom
        }
      );

  return resultData(
    result,
    "Не удалось сохранить ПВЗ"
  );
}

/*
  Полное удаление ПВЗ вместе с его историей: сменами, их премиями и
  штрафами, назначениями сотрудников и тарифами. Имя уходит на сервер и
  там сверяется — удалится ровно тот ПВЗ, который человек назвал, даже
  если список на экране отстал от данных.

  Возвращается опись удалённого: её видно в подтверждающем сообщении.
*/
export async function deleteAdminPointWithHistory({
  id,
  name
}){
  const result=
    await supabaseClient.rpc(
      "admin_delete_point_cascade",
      {
        p_point_id:id,
        p_point_name:name
      }
    );

  return resultData(
    result,
    "Не удалось удалить ПВЗ"
  );
}

export async function addAdminTariff({
  pointId,
  effectiveFrom,
  pricingType,
  fixedRate=null,
  shkTiers=null
}){
  const result=
    await supabaseClient
      .rpc(
        "admin_add_point_tariff",
        {
          p_point_id:pointId,
          p_effective_from:
            effectiveFrom,
          p_pricing_type:
            pricingType,
          p_fixed_rate:
            fixedRate===null ||
            fixedRate===""
              ? null
              : Number(fixedRate),
          p_shk_tiers:shkTiers
        }
      );

  return resultData(
    result,
    "Не удалось добавить тариф"
  );
}

export async function updateAdminTariff({
  id,
  effectiveFrom,
  pricingType,
  fixedRate=null,
  shkTiers=null
}){
  const result=
    await supabaseClient.rpc(
      "admin_update_point_tariff",
      {
        p_tariff_id:id,
        p_effective_from:effectiveFrom,
        p_pricing_type:pricingType,
        p_fixed_rate:
          fixedRate===null ||
          fixedRate===""
            ? null
            : Number(fixedRate),
        p_shk_tiers:shkTiers
      }
    );

  return resultData(
    result,
    "Не удалось изменить тариф"
  );
}

export async function deleteAdminTariff(
  id
){
  const result=
    await supabaseClient.rpc(
      "admin_delete_point_tariff",
      {
        p_tariff_id:id
      }
    );

  return resultData(
    result,
    "Не удалось удалить тариф"
  );
}
