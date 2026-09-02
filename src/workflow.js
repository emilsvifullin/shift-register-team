function text(value){
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function moneySearchVariants(value){
  const number=Number(value);

  if(!Number.isFinite(number)){
    return [];
  }

  return [
    String(number),
    String(number).replace(".",","),
    new Intl.NumberFormat("ru-RU",{
      maximumFractionDigits:2
    }).format(number)
  ];
}

export function filterOptionSelected(
  selectedIds,
  id
){
  return selectedIds===null ||
    selectedIds.includes(id);
}

export function toggleFilterSelection(
  selectedIds,
  id,
  allIds
){
  if(!id){
    return selectedIds===null
      ? []
      : null;
  }

  const selected=new Set(
    selectedIds===null
      ? allIds
      : selectedIds
  );

  if(selected.has(id)){
    selected.delete(id);
  }else{
    selected.add(id);
  }

  return Array.from(selected);
}

export function shiftSearchText(
  shift,
  extra=[]
){
  const bonuses=shift.bonuses || [];
  const penalties=shift.penalties || [];

  return text([
    shift.date,
    shift.point,
    shift.pointId,
    shift.employeeName,
    shift.type,
    shift.type==="extra" ? "дополнительная доп" : "основная",
    shift.partial ? "неполная" : "полная",
    shift.shk,
    shift.shk!=="" ? "шк объём" : "",
    shift.hours,
    shift.hours!=="" ? "час часов" : "",
    shift.note,
    shift.baseAmount,
    shift.baseOverride,
    ...moneySearchVariants(shift.baseAmount),
    ...bonuses.flatMap(item=>[
      "премия",
      item.comment,
      item.amount,
      ...moneySearchVariants(item.amount)
    ]),
    ...penalties.flatMap(item=>[
      "штраф",
      item.comment,
      item.amount,
      ...moneySearchVariants(item.amount)
    ]),
    ...extra
  ].join(" "));
}

export function filterMonthShifts(
  shifts,
  {
    query="",
    pointIds=null,
    employeeIds=null,
    fromDay=1,
    toDay=31
  }={},
  extraText=()=>[]
){
  const needle=text(query);
  const pointSet=pointIds===null
    ? null
    : new Set(pointIds);
  const employeeSet=employeeIds===null
    ? null
    : new Set(employeeIds);
  const first=Math.max(1,Math.min(31,Number(fromDay) || 1));
  const last=Math.max(first,Math.min(31,Number(toDay) || 31));

  return shifts.filter(shift=>{
    const day=Number(String(shift.date || "").slice(8,10));

    if(day<first || day>last){
      return false;
    }

    if(pointSet && !pointSet.has(shift.dbPointId || shift.pointId)){
      return false;
    }

    if(employeeSet && !employeeSet.has(shift.employeeId)){
      return false;
    }

    return !needle || shiftSearchText(
      shift,
      extraText(shift)
    ).includes(needle);
  });
}

export function employeeSearchText(
  employee,
  {
    pointNames=[],
    account=""
  }={}
){
  return text([
    employee.full_name,
    employee.status,
    employee.status==="inactive" ? "архив" : "активен",
    employee.employment_type,
    employee.employment_type==="substitute"
      ? "подмена внештатный"
      : "штатный",
    employee.phone,
    employee.transfer_phone,
    employee.transfer_bank,
    employee.transfer_recipient,
    account,
    ...pointNames
  ].join(" "));
}

export function filterChoiceOptions(
  options,
  query=""
){
  const needle=
    text(query);

  if(!needle){
    return options.slice();
  }

  return options.filter(
    option=>
      text([
        option.label,
        option.searchText
      ].join(" ")).includes(
        needle
      )
  );
}

export function paymentProgress(
  due,
  payments=[]
){
  const paid=payments.reduce(
    (sum,item)=>sum+Number(item.amount || 0),
    0
  );
  const remaining=Number(due || 0)-paid;

  return {
    due:Number(due || 0),
    paid,
    remaining:Math.max(0,remaining),
    overpaid:Math.max(0,-remaining),
    complete:Number(due || 0)>0 && remaining<=0
  };
}
