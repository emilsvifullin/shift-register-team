import {
  FULL_HOURS,
  MAX_MONEY,
  MAX_SHK
} from "./config.js";

import {
  calc,
  isValidDateString,
  normalizeShiftRecord
} from "./domain.js";

const TEAM_RULES_VERSION=
  "supabase-point-tariffs-v1";

export function createTeamId(){
  if(
    typeof globalThis.crypto
      ?.randomUUID==="function"
  ){
    return globalThis.crypto
      .randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    .replace(/[xy]/g,character=>{
      const random=
        Math.floor(Math.random()*16);

      const value=
        character==="x"
          ? random
          : random&0x3|0x8;

      return value.toString(16);
    });
}

function moneyNumber(
  value,
  label="Сумма"
){
  const number=Number(
    typeof value==="string"
      ? value.replace(",",".")
      : value
  );
  const cents=Math.round(number*100);

  if(
    !Number.isFinite(number) ||
    number<=0 ||
    number>MAX_MONEY ||
    Math.abs(number*100-cents)>1e-7
  ){
    throw new Error(
      `${label} должна быть больше 0 и содержать не более 2 знаков после запятой`
    );
  }

  return cents/100;
}

export function normalizeShkTiers(
  value
){
  if(
    !Array.isArray(value) ||
    !value.length
  ){
    throw new Error(
      "Добавьте хотя бы одну границу тарифа"
    );
  }

  let previous=0;

  return value.map((item,index)=>{
    if(
      !item ||
      typeof item!=="object"
    ){
      throw new Error(
        `Некорректная строка тарифа ${index+1}`
      );
    }

    const final=
      index===value.length-1;

    const upTo=
      item.up_to===null ||
      item.up_to==="" ||
      item.upTo===null ||
      item.upTo===""
        ? null
        : Number(
            item.up_to ??
            item.upTo
          );

    if(
      final &&
      upTo!==null
    ){
      throw new Error(
        "Последняя ставка должна действовать без верхней границы"
      );
    }

    if(
      !final &&
      (
        !Number.isSafeInteger(upTo) ||
        upTo<=previous ||
        upTo>MAX_SHK
      )
    ){
      throw new Error(
        "Границы ШК должны быть целыми и идти по возрастанию"
      );
    }

    if(
      !final
    ){
      previous=upTo;
    }

    return {
      up_to:upTo,
      rate:moneyNumber(
        item.rate,
        "Ставка"
      )
    };
  });
}

export function tariffForDate(
  tariffs,
  pointId,
  shiftDate
){
  if(!isValidDateString(shiftDate)){
    throw new Error(
      "Некорректная дата смены"
    );
  }

  return (tariffs || [])
    .filter(
      tariff=>
        tariff.point_id===pointId &&
        tariff.effective_from<=shiftDate
    )
    .sort((a,b)=>
      b.effective_from.localeCompare(
        a.effective_from
      )
    )[0] || null;
}

export function rateForTariff(
  tariff,
  shk
){
  if(!tariff){
    throw new Error(
      "Для выбранной даты тариф не найден"
    );
  }

  if(tariff.pricing_type==="fixed"){
    return moneyNumber(
      tariff.fixed_rate,
      "Фиксированная ставка"
    );
  }

  if(tariff.pricing_type!=="shk_tiers"){
    throw new Error(
      "Неизвестный тип тарифа"
    );
  }

  const number=
    shk==="" ||
    shk===null ||
    shk===undefined
      ? 0
      : Number(shk);

  if(
    !Number.isSafeInteger(number) ||
    number<0 ||
    number>MAX_SHK
  ){
    throw new Error(
      "ШК должно быть целым неотрицательным числом"
    );
  }

  const tiers=
    normalizeShkTiers(
      tariff.shk_tiers
    );

  const tier=
    tiers.find(
      item=>
        item.up_to===null ||
        number<item.up_to
    );

  if(!tier){
    throw new Error(
      "Для значения ШК ставка не найдена"
    );
  }

  return tier.rate;
}

export function createPricingSnapshot({
  tariff,
  point,
  shiftDate,
  shk,
  fullHours=FULL_HOURS
}){
  if(!point?.id){
    throw new Error(
      "Пункт выдачи не найден"
    );
  }

  const rate=
    rateForTariff(
      tariff,
      shk
    );

  const fixed=
    tariff.pricing_type===
    "fixed";

  return {
    version:2,
    rulesVersion:
      TEAM_RULES_VERSION,
    tariffId:tariff.id,
    pointId:point.id,
    pointName:point.name,
    effectiveFrom:
      tariff.effective_from,
    pricingType:
      tariff.pricing_type,
    fixed,
    fixedRate:
      fixed
        ? rate
        : null,
    shkTiers:
      fixed
        ? null
        : normalizeShkTiers(
            tariff.shk_tiers
          ),
    shk:
      fixed
        ? 0
        : Number(shk) || 0,
    rate,
    fullHours:Number(fullHours),
    advanceEnabled:
      point.advance_enabled===true,
    shiftDate
  };
}

export function calculateBaseAmount(
  pricing,
  {
    partial,
    hours
  }
){
  const fullHours=
    Number(
      pricing?.fullHours
    );

  const rate=
    Number(
      pricing?.rate
    );

  if(
    !Number.isFinite(fullHours) ||
    fullHours<=0 ||
    !Number.isFinite(rate) ||
    rate<0
  ){
    throw new Error(
      "Некорректный снимок тарифа"
    );
  }

  if(!partial){
    return rate;
  }

  const worked=Number(hours);

  if(
    !Number.isFinite(worked) ||
    worked<=0 ||
    worked>=fullHours
  ){
    throw new Error(
      "Некорректное количество часов"
    );
  }

  return Math.round(
    rate/fullHours*worked
  );
}

function normalizedDriver(
  value
){
  if(
    value==="" ||
    value===null ||
    value===undefined
  ){
    return null;
  }

  return Number(value);
}

function driverValue(
  value,
  serverKey,
  clientKey
){
  return value?.[serverKey] ??
    value?.[clientKey];
}

export function pricingDriversChanged(
  previous,
  next
){
  if(!previous){
    return true;
  }

  return (
    driverValue(
      previous,
      "employee_id",
      "employeeId"
    )!==
      driverValue(
        next,
        "employee_id",
        "employeeId"
      ) ||
    driverValue(
      previous,
      "point_id",
      "dbPointId"
    )!==
      driverValue(
        next,
        "point_id",
        "dbPointId"
      ) ||
    driverValue(
      previous,
      "shift_date",
      "date"
    )!==
      driverValue(
        next,
        "shift_date",
        "date"
      ) ||
    normalizedDriver(
      previous.shk
    )!==
      normalizedDriver(next.shk) ||
    previous.partial!==
      next.partial ||
    normalizedDriver(
      previous.hours
    )!==
      normalizedDriver(next.hours)
  );
}

export function roleCapabilities(
  role
){
  const admin=role==="admin";

  return Object.freeze({
    manageTeam:admin,
    managePoints:admin,
    manageTariffs:admin,
    createShift:admin,
    editShift:admin,
    deleteShift:admin,
    manageAdjustments:admin,
    importLegacy:admin,
    exportData:admin
  });
}

export function ownEmployee(
  employees,
  userId
){
  return (employees || [])
    .find(
      employee=>
        employee.user_id===userId
    ) || null;
}

export function filterEmployeeShifts(
  shifts,
  employeeId
){
  if(!employeeId){
    return [];
  }

  return (shifts || [])
    .filter(
      shift=>
        shift.employee_id===
        employeeId
    );
}

export function shiftPointChoices(
  points,
  selectedPointId=""
){
  return sortPointsAlphabetically(
    (points || []).filter(
      point=>
        point.active!==false ||
        point.id===selectedPointId
    )
  );
}

export function sortPointsAlphabetically(
  points
){
  return [...(points || [])]
    .sort((first,second)=>{
      const byName=String(
        first?.name || ""
      ).localeCompare(
        String(second?.name || ""),
        "ru-RU",
        {
          sensitivity:"base",
          numeric:true
        }
      );

      if(byName){
        return byName;
      }

      return String(
        first?.id || ""
      ).localeCompare(
        String(second?.id || "")
      );
    });
}

export function shiftEmployeeChoices({
  employees,
  employeePoints,
  pointId,
  selectedEmployeeId="",
  includeInactive=false
}){
  const assignedEmployeeIds=
    new Set(
      (employeePoints || [])
        .filter(
          item=>
            item.point_id===pointId &&
            item.active!==false
        )
        .map(
          item=>item.employee_id
        )
    );

  return (employees || [])
    .filter(
      employee=>
        (
          Boolean(pointId) &&
          (
            includeInactive ||
            employee.status==="active"
          ) &&
          (
            employee.is_system_substitute===
              true ||
            assignedEmployeeIds.has(
              employee.id
            )
          )
        ) ||
        employee.id===selectedEmployeeId
    );
}

function adjustmentRows(
  value
){
  if(!Array.isArray(value)){
    return [];
  }

  return value.map(item=>({
    ...item,
    ...(Object.prototype.hasOwnProperty.call(
      item,
      "payout_kind"
    )
      ? {
          payoutKind:
            item.payout_kind ||
            ""
        }
      : {})
  }));
}

function adjustmentAmount(
  rows
){
  return rows.reduce(
    (sum,item)=>
      sum+Number(item.amount || 0),
    0
  );
}

export function mapServerShift(
  row
){
  const point=
    row.point ||
    row.points ||
    {};

  const employee=
    row.employee ||
    row.employees ||
    {};

  const bonuses=
    adjustmentRows(
      row.bonuses ||
      row.shift_bonuses
    );

  const penalties=
    adjustmentRows(
      row.penalties ||
      row.shift_penalties
    );

  const pricing={
    ...row.pricing_snapshot,
    version:
      row.pricing_snapshot
        ?.version || 2,
    fixed:
      row.pricing_snapshot
        ?.fixed ??
      row.pricing_snapshot
        ?.pricingType===
        "fixed",
    rate:Number(
      row.pricing_snapshot
        ?.rate ??
      row.base_amount ??
      0
    ),
    fullHours:Number(
      row.pricing_snapshot
        ?.fullHours ??
      row.full_hours ??
      FULL_HOURS
    ),
    advanceEnabled:
      row.pricing_snapshot
        ?.advanceEnabled ??
      point.advance_enabled===true,
    rulesVersion:
      row.pricing_snapshot
        ?.rulesVersion ||
      TEAM_RULES_VERSION
  };

  const calculatedBase=
    row.partial===true
      ? Math.round(
          pricing.rate /
          pricing.fullHours *
          Number(row.hours)
        )
      : pricing.rate;

  const savedBase=
    Number(row.base_amount);

  const baseAmount=
    Number.isFinite(savedBase) &&
    savedBase>=0
      ? savedBase
      : calculatedBase;

  return {
    v:3,
    id:row.id,
    employeeId:
      row.employee_id,
    employeeName:
      employee.full_name ||
      "Сотрудник",
    dbPointId:
      row.point_id,
    pointId:
      point.code ||
      row.point_id,
    point:
      point.name ||
      pricing.pointName ||
      "Пункт выдачи",
    pointActive:
      point.active!==false,
    employeeActive:
      employee.status!==
      "inactive",
    date:row.shift_date,
    type:row.shift_type,
    shk:
      row.shk===null
        ? ""
        : Number(row.shk),
    partial:
      row.partial===true,
    hours:
      row.partial
        ? Number(row.hours)
        : "",
    bonus:
      adjustmentAmount(
        bonuses
      ) || "",
    fine:
      adjustmentAmount(
        penalties
      ) || "",
    bonuses,
    penalties,
    note:row.note || "",
    baseAmount,
    baseOverride:
      baseAmount!==calculatedBase
        ? baseAmount
        : "",
    pricing
  };
}

export function legacyShiftPayload({
  source,
  employeeId,
  points
}){
  const shift=
    normalizeShiftRecord(
      source,
      0
    );

  const point=
    (points || [])
      .find(item=>
        item.code===shift.pointId ||
        item.name===shift.point
      );

  if(!point){
    throw new Error(
      `ПВЗ «${shift.point}» отсутствует в Supabase`
    );
  }

  const result=calc(shift);

  const pricing={
    version:2,
    rulesVersion:
      shift.pricing.rulesVersion,
    tariffId:null,
    pointId:point.id,
    pointName:point.name,
    effectiveFrom:null,
    pricingType:
      shift.pricing.fixed
        ? "fixed"
        : "shk_tiers",
    fixed:
      shift.pricing.fixed,
    fixedRate:
      shift.pricing.fixed
        ? shift.pricing.rate
        : null,
    shkTiers:null,
    shk:
      shift.pricing.fixed
        ? 0
        : Number(shift.shk) || 0,
    rate:shift.pricing.rate,
    fullHours:
      shift.pricing.fullHours,
    advanceEnabled:
      point.advance_enabled===true,
    shiftDate:shift.date,
    legacy:true
  };

  return {
    legacySourceId:shift.id,
    employeeId,
    pointId:point.id,
    shiftDate:shift.date,
    shiftType:shift.type,
    shk:
      pricing.fixed
        ? null
        : Number(shift.shk) || 0,
    partial:shift.partial,
    hours:
      shift.partial
        ? Number(shift.hours)
        : null,
    fullHours:
      shift.pricing.fullHours,
    baseAmount:result.base,
    pricingSnapshot:pricing,
    bonuses:
      result.bonus>0
        ? [{
            id:createTeamId(),
            amount:result.bonus,
            comment:
              "Импорт из локального реестра"
          }]
        : [],
    penalties:
      result.fine>0
        ? [{
            id:createTeamId(),
            amount:result.fine,
            comment:
              "Импорт из локального реестра"
          }]
        : []
  };
}
