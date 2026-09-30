import {
  supabaseClient
} from "../supabase.js";

import {
  mapServerShift,
  sortPointsAlphabetically
} from "../team-domain.js?shell=7";

import {
  resultData
} from "./result.js";

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
  base_amount_override_reason,
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
    payout_kind,
    created_at,
    updated_at
  )
`;

function loadShiftRows(
  employeeId=null
){
  return allRows(
    counted=>shiftQuery(
      employeeId,
      counted
    ),
    "Не удалось загрузить смены"
  );
}

function shiftQuery(
  employeeId,
  counted
){
  let query=
    supabaseClient
      .from("shifts")
      .select(
        SHIFT_SELECT,
        counted
          ? {count:"exact"}
          : undefined
      )
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

/*
  Все строки, а не первая тысяча.

  PostgREST отдаёт не больше max_rows строк на запрос (у Supabase это
  1000) и молча обрезает остальное. Смен в месяц около двухсот, и через
  полгода самые старые из них перестали бы приходить — вместе с деньгами
  прошлых месяцев, закрытыми периодами и отчётами по ним, без единой
  ошибки на экране. Поэтому растущие таблицы читаются страницами, пока
  не придёт столько строк, сколько их есть: число сервер сообщает на
  первой странице, и размер страницы тогда может быть любым — хоть
  меньше, чем max_rows у проекта.

  Строка, добавленная между страницами, может сдвинуть границу и прийти
  дважды — повтор отбрасывается по id.
*/
const PAGE_SIZE=1000;

async function allRows(
  buildQuery,
  message
){
  const rows=[];
  const seen=new Set();
  let total=null;

  for(;;){
    const result=
      await buildQuery(
        total===null
      ).range(
        rows.length,
        rows.length+PAGE_SIZE-1
      );

    const page=
      resultData(
        result,
        message
      ) || [];

    if(total===null){
      total=Number.isFinite(result.count)
        ? result.count
        : null;
    }

    for(const row of page){
      if(!seen.has(row.id)){
        seen.add(row.id);
        rows.push(row);
      }
    }

    if(
      !page.length ||
      total===null ||
      rows.length>=total
    ){
      return {
        data:rows,
        error:null
      };
    }
  }
}

function mapShifts(
  rows
){
  return (rows || [])
    .map(mapServerShift);
}

/*
  История расчёта — за один месяц.

  Раньше приходили последние 300 событий по всей базе. История растёт с
  каждым действием, и однажды старые периоды молча остались бы без неё:
  не «событий нет», а просто пусто. Показывается она по периоду, а
  период — половина месяца, так что и читать её надо по месяцу: целиком,
  сколько бы там ни было, и не больше.
*/
export function loadPayrollEvents(
  periodMonth
){
  return allRows(
    counted=>supabaseClient
      .from("payroll_events")
      .select(
        "id, period_month, payout_kind, employee_id, kind, summary, reason, effect, period_status, details, occurred_at",
        counted
          ? {count:"exact"}
          : undefined
      )
      .eq(
        "period_month",
        periodMonth
      )
      .order(
        "occurred_at",
        {ascending:false}
      )
      .order(
        "id",
        {ascending:true}
      ),
    "Не удалось загрузить историю расчётов"
  );
}

export async function loadAdminTeamData({
  periodMonth=null
}={}){
  const [
    employeesResult,
    pointsResult,
    employeePointsResult,
    accountsResult,
    tariffsResult,
    employeeRatesResult,
    shiftsResult,
    payoutsResult,
    periodsResult,
    periodEntriesResult,
    periodEventsResult
  ]=
    await Promise.all([
      supabaseClient
        .from("employees")
        .select(
          "id, user_id, full_name, status, hired_at, is_system_substitute, phone, transfer_phone, transfer_bank, transfer_recipient"
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

      supabaseClient
        .from("employee_point_rates")
        .select(
          "id, employee_id, point_id, effective_from, pricing_type, fixed_rate, shk_tiers, created_at"
        )
        .order(
          "effective_from",
          {
            ascending:false
          }
        ),

      loadShiftRows(),

      allRows(
        counted=>supabaseClient
          .from("employee_payouts")
          .select(
            "id, employee_id, period_month, payout_kind, amount, paid_on, comment, created_at, updated_at",
            counted
              ? {count:"exact"}
              : undefined
          )
          .order(
            "paid_on",
            {ascending:false}
          )
          .order(
            "id",
            {ascending:true}
          ),
        "Не удалось загрузить выплаты"
      ),

      supabaseClient
        .from("payroll_periods")
        .select(
          "id, period_month, payout_kind, status, checked_fingerprint, checked_at, closed_at, paid_at"
        )
        .order(
          "period_month",
          {ascending:false}
        ),

      allRows(
        counted=>supabaseClient
          .from("payroll_period_entries")
          .select(
            "id, period_id, employee_id, shifts, base, bonus, fine, due, paid, detail",
            counted
              ? {count:"exact"}
              : undefined
          )
          .order(
            "id",
            {ascending:true}
          ),
        "Не удалось загрузить снимки периодов"
      ),

      periodMonth
        ? loadPayrollEvents(periodMonth)
        : Promise.resolve({data:[],error:null})
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

  return {
    linked:true,
    archived:false,
    employee:null,
    employees,
    points:
      sortPointsAlphabetically(
        resultData(
          pointsResult,
          "Не удалось загрузить пункты"
        ) || []
      ),
    employeePoints:
      resultData(
        employeePointsResult,
        "Не удалось загрузить назначения"
      ) || [],
    accounts,
    tariffs:
      resultData(
        tariffsResult,
        "Не удалось загрузить тарифы"
      ) || [],
    employeeRates:
      resultData(
        employeeRatesResult,
        "Не удалось загрузить индивидуальные ставки"
      ) || [],
    shifts:
      mapShifts(
        resultData(
          shiftsResult,
          "Не удалось загрузить смены"
        )
      ),
    payouts:
      resultData(
        payoutsResult,
        "Не удалось загрузить выплаты"
      ) || [],
    periods:
      resultData(
        periodsResult,
        "Не удалось загрузить расчётные периоды"
      ) || [],
    periodEntries:
      resultData(
        periodEntriesResult,
        "Не удалось загрузить снимки периодов"
      ) || [],
    periodEvents:
      resultData(
        periodEventsResult,
        "Не удалось загрузить историю расчётов"
      ) || []
  };
}

export async function loadEmployeeTeamData(
  userId
){
  const employeeResult=
    await supabaseClient
      .from("employees")
      .select(
        "id, user_id, full_name, status, hired_at, is_system_substitute, phone, transfer_phone, transfer_bank, transfer_recipient"
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
      employeeRates:[],
      shifts:[],
      payouts:[],
      periods:[],
      periodEntries:[],
      periodEvents:[]
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
      employeeRates:[],
      shifts:[],
      payouts:[],
      periods:[],
      periodEntries:[],
      periodEvents:[]
    };
  }

  const [
    shiftsResult,
    payoutsResult
  ]=await Promise.all([
    loadShiftRows(employee.id),
    allRows(
      counted=>supabaseClient
        .from("employee_payouts")
        .select(
          "id, employee_id, period_month, payout_kind, amount, paid_on, comment, created_at, updated_at",
          counted
            ? {count:"exact"}
            : undefined
        )
        .eq(
          "employee_id",
          employee.id
        )
        .order(
          "paid_on",
          {ascending:false}
        )
        .order(
          "id",
          {ascending:true}
        ),
      "Не удалось загрузить выплаты"
    )
  ]);

  return {
    linked:true,
    archived:false,
    employee,
    employees:[employee],
    points:[],
    employeePoints:[],
    accounts:[],
    tariffs:[],
    /*
      Сотруднику ставки не нужны отдельно: стоимость каждой его смены уже
      заморожена снимком, а чужие ставки он видеть не должен.
    */
    employeeRates:[],
    /* Состояние периодов — инструмент администратора. */
    periods:[],
    periodEntries:[],
    periodEvents:[],
    shifts:
      mapShifts(
        resultData(
          shiftsResult,
          "Не удалось загрузить смены"
        )
      ),
    payouts:
      resultData(
        payoutsResult,
        "Не удалось загрузить выплаты"
      ) || []
  };
}

export function loadTeamData({
  role,
  userId,
  periodMonth=null
}){
  return role==="admin"
    ? loadAdminTeamData({periodMonth})
    : loadEmployeeTeamData(
        userId
      );
}
