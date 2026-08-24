import {
  invokeSupabaseFunction,
  supabaseClient,
  supabaseRealtimeClient
} from "./supabase.js";

import {
  mapServerShift
} from "./team-domain.js";

const SHIFT_SELECT=`
  id,
  employee_id,
  shift_date,
  point_id,
  shift_type,
  shk,
  partial,
  hours,
  full_hours,
  base_amount,
  pricing_snapshot,
  note,
  employee:employees!shifts_employee_id_fkey(
    id,
    user_id,
    full_name,
    status
  ),
  point:points!shifts_point_id_fkey(
    id,
    code,
    name,
    active,
    advance_enabled
  ),
  bonuses:shift_bonuses(
    id,
    amount,
    comment,
    created_at,
    updated_at
  ),
  penalties:shift_penalties(
    id,
    amount,
    comment,
    created_at,
    updated_at
  )
`;

const ERROR_MESSAGES=Object.freeze({
  forbidden:
    "Недостаточно прав для этой операции",
  employee_not_found:
    "Сотрудник не найден",
  employee_inactive:
    "Для новой смены нужен активный сотрудник",
  point_not_found:
    "Пункт выдачи не найден",
  point_inactive:
    "Для новой смены нужен активный ПВЗ",
  point_not_assigned:
    "Этот ПВЗ не назначен сотруднику",
  tariff_not_found_for_date:
    "Для выбранного ПВЗ и даты тариф не найден",
  account_already_linked:
    "Этот аккаунт уже привязан к другому сотруднику",
  employee_account_required:
    "Выберите аккаунт с ролью сотрудника",
  employee_has_history:
    "Сотрудника со сменами можно только перенести в архив",
  shift_not_found:
    "Смена не найдена",
  invalid_partial_hours:
    "Неполная смена должна быть от 0,5 до 11,5 часа с шагом 0,5",
  invalid_bonus:
    "Проверьте сумму и комментарий премии",
  invalid_penalty:
    "Проверьте сумму и комментарий штрафа",
  employee_creation_rollback_forbidden:
    "Нельзя отменить создание сотрудника: карточка уже используется",
  employee_deletion_pending:
    "Удаление сотрудника уже выполняется"
});

function readableError(
  result,
  fallback
){
  const raw=String(
    result.error?.message ||
    ""
  );

  const known=Object.entries(
    ERROR_MESSAGES
  ).find(([code])=>
    raw.includes(code)
  );

  return known?.[1] ||
    raw ||
    fallback;
}

function resultData(
  result,
  message
){
  if(result.error){
    const error=new Error(
      readableError(
        result,
        message
      )
    );

    error.code=
      result.error.code;

    error.details=
      result.error.details;

    throw error;
  }

  return result.data;
}

function loadShiftRows(
  employeeId=null
){
  let query=
    supabaseClient
      .from("shifts")
      .select(SHIFT_SELECT)
      .order(
        "shift_date",
        {
          ascending:false
        }
      )
      .order(
        "id",
        {
          ascending:true
        }
      );

  if(employeeId){
    query=query.eq(
      "employee_id",
      employeeId
    );
  }

  return query;
}

function mapShifts(
  rows
){
  return (rows || [])
    .map(mapServerShift);
}

export async function loadAdminTeamData(){
  const [
    employeesResult,
    pointsResult,
    employeePointsResult,
    accountsResult,
    tariffsResult,
    shiftsResult
  ]=
    await Promise.all([
      supabaseClient
        .from("employees")
        .select(
          "id, user_id, full_name, status, hired_at, phone, transfer_phone, transfer_bank, transfer_recipient"
        )
        .order(
          "status",
          {
            ascending:true
          }
        )
        .order(
          "full_name",
          {
            ascending:true
          }
        ),

      supabaseClient
        .from("points")
        .select(
          "id, code, name, active, pricing_type, fixed_rate, advance_enabled, sort_order"
        )
        .order(
          "sort_order",
          {
            ascending:true
          }
        )
        .order(
          "name",
          {
            ascending:true
          }
        ),

      supabaseClient
        .from("employee_points")
        .select(
          "employee_id, point_id, active"
        ),

      supabaseClient
        .rpc(
          "admin_account_options_v2"
        ),

      supabaseClient
        .from("point_tariffs")
        .select(
          "id, point_id, effective_from, pricing_type, fixed_rate, shk_tiers, created_at"
        )
        .order(
          "effective_from",
          {
            ascending:false
          }
        ),

      loadShiftRows()
    ]);

  const employees=
    resultData(
      employeesResult,
      "Не удалось загрузить сотрудников"
    ) || [];

  const accounts=
    resultData(
      accountsResult,
      "Не удалось загрузить аккаунты"
    ) || [];

  const employeesById=
    new Map(
      employees.map(
        employee=>[
          employee.id,
          employee
        ]
      )
    );

  return {
    linked:true,
    archived:false,
    employee:null,

    employees,

    points:
      resultData(
        pointsResult,
        "Не удалось загрузить пункты"
      ) || [],

    employeePoints:
      resultData(
        employeePointsResult,
        "Не удалось загрузить назначения"
      ) || [],

    accounts:
      accounts.map(account=>{
        const employee=
          employeesById.get(
            account.employee_id
          );

        if(!employee?.phone){
          return account;
        }

        return {
          ...account,
          login:employee.phone,
          phone:employee.phone,
          email:null
        };
      }),

    tariffs:
      resultData(
        tariffsResult,
        "Не удалось загрузить тарифы"
      ) || [],

    shifts:
      mapShifts(
        resultData(
          shiftsResult,
          "Не удалось загрузить смены"
        )
      )
  };
}

export async function loadEmployeeTeamData(
  userId
){
  const employeeResult=
    await supabaseClient
      .from("employees")
      .select(
        "id, user_id, full_name, status, hired_at, phone, transfer_phone, transfer_bank, transfer_recipient"
      )
      .eq(
        "user_id",
        userId
      )
      .maybeSingle();

  const employee=
    resultData(
      employeeResult,
      "Не удалось проверить привязку аккаунта"
    );

  if(!employee){
    return {
      linked:false,
      archived:false,
      employee:null,
      employees:[],
      points:[],
      employeePoints:[],
      accounts:[],
      tariffs:[],
      shifts:[]
    };
  }

  if(employee.status==="inactive"){
    return {
      linked:true,
      archived:true,
      employee,
      employees:[employee],
      points:[],
      employeePoints:[],
      accounts:[],
      tariffs:[],
      shifts:[]
    };
  }

  const shiftsResult=
    await loadShiftRows(
      employee.id
    );

  return {
    linked:true,
    archived:false,
    employee,
    employees:[employee],
    points:[],
    employeePoints:[],
    accounts:[],
    tariffs:[],
    shifts:
      mapShifts(
        resultData(
          shiftsResult,
          "Не удалось загрузить смены"
        )
      )
  };
}

export function loadTeamData({
  role,
  userId
}){
  return role==="admin"
    ? loadAdminTeamData()
    : loadEmployeeTeamData(
        userId
      );
}

export async function saveAdminEmployee({
  id=null,
  fullName,
  status,
  hiredAt=null,
  userId=null,
  phone,
  transferPhone=null,
  transferBank=null,
  transferRecipient=null,
  pointIds=[]
}){
  const result=
    await supabaseClient
      .rpc(
        "admin_save_employee_profile",
        {
          p_employee_id:id,
          p_full_name:fullName,
          p_status:status,
          p_hired_at:hiredAt,
          p_user_id:userId,
          p_phone:phone,
          p_transfer_phone:
            transferPhone,
          p_transfer_bank:
            transferBank,
          p_transfer_recipient:
            transferRecipient,
          p_point_ids:pointIds
        }
      );

  return resultData(
    result,
    "Не удалось сохранить сотрудника"
  );
}

export async function saveAdminEmployeeAuth({
  employeeId,
  email,
  password=""
}){
  return invokeSupabaseFunction(
    "admin-employee-auth",
    {
      action:"save",
      employeeId,
      email,
      password:
        password || undefined
    }
  );
}

export async function rollbackAdminEmployeeCreation(
  id
){
  const result=
    await supabaseClient
      .rpc(
        "admin_rollback_employee_creation",
        {
          p_employee_id:id
        }
      );

  return resultData(
    result,
    "Не удалось отменить создание сотрудника"
  );
}

export async function subscribeTeamChanges({
  role,
  onChange=()=>{},
  onStatus=()=>{}
}){
  const tables=
    role==="admin"
      ? [
          "employees",
          "employee_points",
          "points",
          "point_tariffs",
          "shifts",
          "shift_bonuses",
          "shift_penalties"
        ]
      : [
          "employees",
          "shifts",
          "shift_bonuses",
          "shift_penalties"
        ];

  const sessionResult=
    await supabaseClient.auth
      .getSession();

  if(sessionResult.error){
    throw sessionResult.error;
  }

  const accessToken=
    sessionResult.data.session
      ?.access_token;

  if(accessToken){
    await supabaseRealtimeClient
      .realtime
      .setAuth(accessToken);
  }

  let channel=
    supabaseRealtimeClient.channel(
      `shift-register-${role}-${crypto.randomUUID()}`
    );

  tables.forEach(table=>{
    channel=channel.on(
      "postgres_changes",
      {
        event:"*",
        schema:"public",
        table
      },
      payload=>onChange({
        table,
        payload
      })
    );
  });

  channel.subscribe(
    status=>onStatus(status)
  );

  return ()=>{
    void supabaseRealtimeClient
      .removeChannel(channel);
  };
}

export async function deleteAdminEmployee(
  id
){
  return invokeSupabaseFunction(
    "admin-employee-auth",
    {
      action:"delete",
      employeeId:id
    }
  );
}

function adjustmentPayload(
  rows
){
  return (rows || [])
    .map(item=>({
      id:item.id,
      amount:Number(item.amount),
      comment:String(
        item.comment || ""
      ).trim()
    }));
}

export async function saveAdminShift(
  value
){
  const result=
    await supabaseClient
      .rpc(
        "admin_save_shift",
        {
          p_shift_id:value.id,
          p_employee_id:
            value.employeeId,
          p_shift_date:value.date,
          p_point_id:
            value.dbPointId,
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
              value.penalties
            )
        }
      );

  return resultData(
    result,
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
              value.penalties
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

  for(let index=0;index<values.length;index++){
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
