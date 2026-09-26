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

      supabaseClient
        .from("employee_payouts")
        .select(
          "id, employee_id, period_month, payout_kind, amount, paid_on, comment, created_at, updated_at"
        )
        .order(
          "paid_on",
          {ascending:false}
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

      supabaseClient
        .from("payroll_period_entries")
        .select(
          "id, period_id, employee_id, shifts, base, bonus, fine, due, paid, detail"
        ),

      supabaseClient
        .from("payroll_events")
        .select(
          "id, period_month, payout_kind, employee_id, kind, summary, reason, effect, period_status, details, occurred_at"
        )
        .order(
          "occurred_at",
          {ascending:false}
        )
        .limit(300)
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
    supabaseClient
      .from("employee_payouts")
      .select(
        "id, employee_id, period_month, payout_kind, amount, paid_on, comment, created_at, updated_at"
      )
      .eq(
        "employee_id",
        employee.id
      )
      .order(
        "paid_on",
        {ascending:false}
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
  userId
}){
  return role==="admin"
    ? loadAdminTeamData()
    : loadEmployeeTeamData(
        userId
      );
}
