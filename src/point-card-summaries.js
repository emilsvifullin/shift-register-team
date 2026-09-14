const CACHE_MS=15000;

let cache=null;
let cacheAt=0;
let loadPromise=null;
let clientPromise=null;
let preloadStarted=false;

function currentDate(){
  const value=new Date();

  return [
    value.getFullYear(),
    String(value.getMonth()+1).padStart(2,"0"),
    String(value.getDate()).padStart(2,"0")
  ].join("-");
}

function money(value){
  const number=Number(value);

  if(!Number.isFinite(number)){
    return "";
  }

  return number
    .toLocaleString(
      "ru-RU",
      {
        minimumFractionDigits:0,
        maximumFractionDigits:2
      }
    )
    .replace(/\s/g,"\u00A0")+
    "\u00A0₽";
}

function employeeWord(count){
  const last=count%10;
  const lastTwo=count%100;

  if(last===1 && lastTwo!==11){
    return `${count} сотрудник`;
  }

  if(
    last>=2 &&
    last<=4 &&
    (lastTwo<12 || lastTwo>14)
  ){
    return `${count} сотрудника`;
  }

  return `${count} сотрудников`;
}

function currentTariff(
  tariffs,
  pointId,
  date=currentDate()
){
  return (tariffs || [])
    .filter(tariff=>
      tariff.point_id===pointId &&
      tariff.effective_from<=date
    )
    .sort((first,second)=>
      second.effective_from.localeCompare(
        first.effective_from
      )
    )[0] || null;
}

export function pointEmployeeSummary(
  pointId,
  employees,
  employeePoints
){
  const employeeById=
    new Map(
      (employees || []).map(employee=>[
        employee.id,
        employee
      ])
    );

  const assigned=(employeePoints || [])
    .filter(item=>
      item.point_id===pointId &&
      item.active!==false
    )
    .map(item=>
      employeeById.get(
        item.employee_id
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

  if(!assigned.length){
    return "Сотрудники не назначены";
  }

  if(assigned.length<=2){
    return `${employeeWord(assigned.length)}: ${assigned
      .map(employee=>employee.full_name)
      .join(", ")}`;
  }

  return employeeWord(
    assigned.length
  );
}

export function pointTariffSummary(
  point,
  tariffs
){
  const tariff=currentTariff(
    tariffs,
    point.id
  );

  let label="Тариф не задан";

  if(tariff?.pricing_type==="fixed"){
    label=[
      "Фиксированный",
      money(tariff.fixed_rate)
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
          ? `По ШК · ${money(min)}`
          : `По ШК · ${money(min)}–${money(max)}`;
    }else{
      label="По ШК";
    }
  }

  if(point.advance_enabled===true){
    label+=" · Аванс";
  }

  return label;
}

async function client(){
  if(!clientPromise){
    clientPromise=
      import("./supabase.js")
        .then(module=>
          module.supabaseClient
        );
  }

  return clientPromise;
}

async function loadSummaryData(){
  const now=Date.now();

  if(
    cache &&
    now-cacheAt<CACHE_MS
  ){
    return cache;
  }

  if(loadPromise){
    return loadPromise;
  }

  loadPromise=(async()=>{
    const supabase=
      await client();

    const [
      employeesResult,
      employeePointsResult,
      pointsResult,
      tariffsResult
    ]=await Promise.all([
      supabase
        .from("employees")
        .select(
          "id, full_name, status, is_system_substitute"
        ),
      supabase
        .from("employee_points")
        .select(
          "employee_id, point_id, active"
        ),
      supabase
        .from("points")
        .select(
          "id, advance_enabled"
        ),
      supabase
        .from("point_tariffs")
        .select(
          "point_id, effective_from, pricing_type, fixed_rate, shk_tiers"
        )
    ]);

    for(const result of [
      employeesResult,
      employeePointsResult,
      pointsResult,
      tariffsResult
    ]){
      if(result.error){
        throw result.error;
      }
    }

    cache={
      employees:
        employeesResult.data || [],
      employeePoints:
        employeePointsResult.data || [],
      points:
        pointsResult.data || [],
      tariffs:
        tariffsResult.data || []
    };

    cacheAt=Date.now();

    return cache;
  })().finally(()=>{
    loadPromise=null;
  });

  return loadPromise;
}

function warmSummaryData(){
  if(preloadStarted){
    return;
  }

  preloadStarted=true;

  void loadSummaryData()
    .catch(()=>{
      preloadStarted=false;
    });
}

function addSummaryPlaceholder(
  copy,
  kind,
  documentRef
){
  if(
    copy.querySelector(
      `[data-point-card-summary="${kind}"]`
    )
  ){
    return;
  }

  const line=
    documentRef.createElement("span");

  line.className="manage-row-detail";
  line.dataset.pointCardSummary=kind;
  line.dataset.pointCardSummaryPlaceholder=
    "true";
  line.setAttribute(
    "aria-hidden",
    "true"
  );
  line.textContent="\u00A0";

  copy.append(line);
}

function prepareList(
  list,
  documentRef
){
  if(!list){
    return;
  }

  list.dataset.pointCardSummariesPending=
    "true";
  list.setAttribute(
    "aria-busy",
    "true"
  );
  list.style.visibility="hidden";
  list.style.pointerEvents="none";

  list
    .querySelectorAll(
      ".point-manage-row[data-point-id]"
    )
    .forEach(row=>{
      const copy=
        row.querySelector(
          ".manage-row-copy"
        );

      if(!copy){
        return;
      }

      addSummaryPlaceholder(
        copy,
        "employees",
        documentRef
      );
      addSummaryPlaceholder(
        copy,
        "tariff",
        documentRef
      );
    });
}

function revealList(list){
  if(!list){
    return;
  }

  delete list.dataset
    .pointCardSummariesPending;
  list.removeAttribute(
    "aria-busy"
  );
  list.style.removeProperty(
    "visibility"
  );
  list.style.removeProperty(
    "pointer-events"
  );
}

function clearSummaryPlaceholders(list){
  list
    ?.querySelectorAll(
      "[data-point-card-summary-placeholder]"
    )
    .forEach(element=>
      element.remove()
    );
}

function decorateList(
  list,
  data,
  documentRef=document
){
  const pointById=
    new Map(
      data.points.map(point=>[
        String(point.id),
        point
      ])
    );

  list
    .querySelectorAll(
      ".point-manage-row[data-point-id]"
    )
    .forEach(row=>{
      const pointId=
        String(
          row.dataset.pointId || ""
        );

      const point=
        pointById.get(pointId) || {
          id:pointId,
          advance_enabled:false
        };

      const employeeText=
        pointEmployeeSummary(
          pointId,
          data.employees,
          data.employeePoints
        );

      const tariffText=
        pointTariffSummary(
          point,
          data.tariffs
        );

      const signature=
        `${employeeText}\n${tariffText}`;

      if(
        row.dataset
          .pointCardSummarySignature===
        signature
      ){
        return;
      }

      const copy=
        row.querySelector(
          ".manage-row-copy"
        );

      if(!copy){
        return;
      }

      copy
        .querySelectorAll(
          "[data-point-card-summary]"
        )
        .forEach(element=>
          element.remove()
        );

      const employeeLine=
        documentRef.createElement("span");

      employeeLine.className=
        "manage-row-detail";
      employeeLine.dataset
        .pointCardSummary="employees";
      employeeLine.textContent=
        employeeText;

      const tariffLine=
        documentRef.createElement("span");

      tariffLine.className=
        "manage-row-detail";
      tariffLine.dataset
        .pointCardSummary="tariff";
      tariffLine.textContent=
        tariffText;

      copy.append(
        employeeLine,
        tariffLine
      );

      row.dataset
        .pointCardSummarySignature=
          signature;
    });
}

export function installPointCardSummaries({
  windowRef=window,
  documentRef=document
}={}){
  if(
    documentRef.documentElement.dataset
      .pointCardSummaries==="ready"
  ){
    return ()=>{};
  }

  documentRef.documentElement.dataset
    .pointCardSummaries="ready";

  let frame=0;
  let activeList=null;
  let token=0;

  const primeCurrentList=()=>{
    const list=
      documentRef.getElementById(
        "pointManageList"
      );

    if(
      list &&
      list!==activeList
    ){
      prepareList(
        list,
        documentRef
      );
    }
  };

  const sync=async()=>{
    const list=
      documentRef.getElementById(
        "pointManageList"
      );

    if(!list){
      activeList=null;
      return;
    }

    const listChanged=
      list!==activeList;

    if(listChanged){
      activeList=list;
      prepareList(
        list,
        documentRef
      );
    }else if(cache){
      decorateList(
        list,
        cache,
        documentRef
      );
      revealList(list);
      return;
    }

    const syncToken=++token;

    try{
      const data=
        await loadSummaryData();

      if(
        syncToken!==token ||
        list!==documentRef.getElementById(
          "pointManageList"
        )
      ){
        return;
      }

      decorateList(
        list,
        data,
        documentRef
      );
      revealList(list);
    }catch{
      if(
        list===documentRef.getElementById(
          "pointManageList"
        )
      ){
        clearSummaryPlaceholders(list);
        revealList(list);
      }
    }
  };

  const queueSync=()=>{
    if(frame){
      return;
    }

    frame=
      windowRef.requestAnimationFrame(()=>{
        frame=0;
        void sync();
      });
  };

  const app=
    documentRef.getElementById("app");

  if(!app){
    return ()=>{};
  }

  const observer=
    new windowRef.MutationObserver(()=>{
      /*
        MutationObserver runs before the next paint. Prime the newly
        rendered point list immediately so the one-line intermediate
        cards can never become a visible frame.
      */
      primeCurrentList();
      queueSync();
    });

  observer.observe(
    app,
    {
      childList:true,
      subtree:true
    }
  );

  warmSummaryData();
  primeCurrentList();
  queueSync();

  return ()=>{
    observer.disconnect();
    token++;

    if(frame){
      windowRef.cancelAnimationFrame(
        frame
      );
    }

    if(
      documentRef.documentElement.dataset
        .pointCardSummaries==="ready"
    ){
      delete documentRef.documentElement.dataset
        .pointCardSummaries;
    }
  };
}

function autoInstall(){
  installPointCardSummaries();
}

if(
  typeof window!=="undefined" &&
  typeof document!=="undefined"
){
  if(document.readyState==="loading"){
    document.addEventListener(
      "DOMContentLoaded",
      autoInstall,
      {once:true}
    );
  }else{
    autoInstall();
  }
}
