import {
  formatMoney,
  plural
} from "./format.js";

/*
  Подписи карточки ПВЗ. Чистые функции над уже загруженными данными:
  отдельной загрузки и отдельного кеша у списка ПВЗ больше нет.
*/

const EMPLOYEE_FORMS=Object.freeze([
  "сотрудник",
  "сотрудника",
  "сотрудников"
]);

export function assignedEmployees(
  pointId,
  employees,
  employeePoints
){
  const employeeById=new Map(
    (employees || []).map(employee=>[
      String(employee.id),
      employee
    ])
  );

  return (employeePoints || [])
    .filter(item=>
      String(item.point_id)===String(pointId) &&
      item.active!==false
    )
    .map(item=>
      employeeById.get(
        String(item.employee_id)
      )
    )
    .filter(employee=>
      employee &&
      employee.status!=="inactive" &&
      employee.is_system_substitute!==true
    )
    .sort((first,second)=>
      String(first.full_name || "")
        .localeCompare(
          String(second.full_name || ""),
          "ru-RU",
          {sensitivity:"base"}
        )
    );
}

export function pointEmployeeSummary(
  pointId,
  employees,
  employeePoints
){
  const assigned=assignedEmployees(
    pointId,
    employees,
    employeePoints
  );

  if(!assigned.length){
    return "Сотрудники не назначены";
  }

  const count=plural(
    assigned.length,
    EMPLOYEE_FORMS
  );

  if(assigned.length<=2){
    return `${count}: ${assigned
      .map(employee=>employee.full_name)
      .join(", ")}`;
  }

  return count;
}

export function pointTariffSummary(point,tariff){
  let label="Тариф не задан";

  if(tariff?.pricing_type==="fixed"){
    label=[
      "Фиксированный",
      formatMoney(tariff.fixed_rate)
    ]
      .filter(Boolean)
      .join(" · ");
  }else if(tariff){
    const rates=(tariff.shk_tiers || [])
      .map(tier=>Number(tier.rate))
      .filter(Number.isFinite);

    if(rates.length){
      const min=Math.min(...rates);
      const max=Math.max(...rates);

      label=
        min===max
          ? `По ШК · ${formatMoney(min)}`
          : `По ШК · ${formatMoney(min)}–${formatMoney(max)}`;
    }else{
      label="По ШК";
    }
  }

  if(point?.advance_enabled===true){
    label+=" · Аванс";
  }

  return label;
}
