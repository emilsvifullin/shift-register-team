/*
  Представления раздела «Смены».

  Одни и те же смены месяца показываются тремя способами, и выбор между
  ними — не украшение, а разные вопросы к одним данным:

    «Реестр»    — список: что именно записано, с поиском и фильтром.
                  Его строит сам app.js, этот модуль его не трогает.
    «Календарь» — месяц по дням для выбранного ПВЗ: в какие дни смены
                  есть, в какие нет, сколько их в день. Отвечает на
                  вопрос «что в этом дне».
    «Контроль»  — все ПВЗ месяца одной таблицей: строка на ПВЗ, столбец
                  на день. Отвечает на вопрос «где вообще пропуски».

  Модуль ничего не импортирует из приложения: данные и форматтеры
  приходят доводом, наружу уходит разметка. Состояние (режим, выбранный
  ПВЗ, выбранный день) живёт в app.js рядом с остальным состоянием
  экрана. Исключение — лента ПВЗ: её прокрутка это поведение самой
  разметки, и она целиком здесь.

  Про «пропущенный день». Расписание ПВЗ приложению неизвестно, поэтому
  нигде не утверждается, что смена была обязана быть. Показывается
  факт: день прошёл, а смены нет. Будущие дни отмечаются нейтрально — в
  них смены ещё и не должно быть.
*/

const WEEKDAYS=[
  "Пн",
  "Вт",
  "Ср",
  "Чт",
  "Пт",
  "Сб",
  "Вс"
];

export const SHIFT_VIEW_MODES=Object.freeze([
  "registry",
  "calendar",
  "control"
]);

const MODE_LABELS={
  registry:"Реестр",
  calendar:"Календарь",
  control:"Контроль"
};

function pad(value){
  return String(value).padStart(2,"0");
}

function monthDays(cursor){
  const [year,month]=cursor
    .split("-")
    .map(Number);

  const total=new Date(
    year,
    month,
    0,
    12
  ).getDate();

  const days=[];

  for(let day=1;day<=total;day++){
    days.push(
      `${cursor}-${pad(day)}`
    );
  }

  return days;
}

/* Понедельник — первый столбец: неделя в России начинается с него. */
function weekdayIndex(ymd){
  const date=new Date(
    `${ymd}T12:00:00`
  );

  return (date.getDay()+6)%7;
}

function shiftPointId(shift){
  return shift.dbPointId ||
    shift.pointId ||
    "";
}

function byDay(shifts){
  const map=new Map();

  for(const shift of shifts){
    const list=map.get(shift.date) || [];

    list.push(shift);
    map.set(shift.date,list);
  }

  return map;
}

/*
  Сводка месяца для выбранного среза. Считается один раз и используется
  и подписью над календарём, и строкой итогов в «Контроле».
*/
export function monthSummary({
  shifts,
  cursor,
  today
}){
  const days=monthDays(cursor);
  const map=byDay(shifts);

  const past=days.filter(
    date=>date<=today
  );

  const withShifts=days.filter(
    date=>map.has(date)
  );

  const missed=past.filter(
    date=>!map.has(date)
  );

  return {
    days:days.length,
    shifts:shifts.length,
    withShifts:withShifts.length,
    missed:missed.length,
    past:past.length
  };
}

export function shiftViewSwitcherHTML(mode){
  return `
    <div class="ml">Представление</div>
    <div class="card segbox sv-switch">
      <div class="seg">
        ${SHIFT_VIEW_MODES.map(name=>`
          <button
            type="button"
            data-shift-view="${name}"
            class="${name===mode ? "on" : ""}"
          >
            ${MODE_LABELS[name]}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function pointChipsHTML({
  points,
  pointId,
  counts,
  esc
}){
  /*
    Лента ПВЗ прокручивается по горизонтали, и до дальних пунктов надо
    доставать всеми способами сразу: пальцем и двумя пальцами по
    трекпаду — самой прокруткой, колесом мыши — переносом вертикального
    шага в горизонтальный, а стрелками — для тех, у кого ни того, ни
    другого. Стрелки показываются только указательным устройствам и
    только когда лента действительно не помещается; их состояние
    проставляет syncShiftViewChips.
  */
  return `
    <div class="sv-points" data-points-strip>
      <button
        type="button"
        class="sv-points-nav back"
        data-points-scroll="-1"
        aria-label="Показать предыдущие ПВЗ"
        hidden
      >
        <svg viewBox="0 0 12 16" aria-hidden="true">
          <path d="M9 3L3 8L9 13"></path>
        </svg>
      </button>

      <div
        class="sv-chips"
        data-points-chips
        role="group"
        aria-label="Пункт выдачи"
        tabindex="0"
      >
        <button
          type="button"
          class="sv-chip ${pointId ? "" : "on"}"
          data-calendar-point=""
        >
          Все ПВЗ
        </button>

        ${points.map(point=>`
          <button
            type="button"
            class="sv-chip ${point.id===pointId ? "on" : ""}"
            data-calendar-point="${esc(point.id)}"
          >
            ${esc(point.name)}
            <span class="sv-chip-count">
              ${counts.get(point.id) || 0}
            </span>
          </button>
        `).join("")}
      </div>

      <button
        type="button"
        class="sv-points-nav ahead"
        data-points-scroll="1"
        aria-label="Показать следующие ПВЗ"
        hidden
      >
        <svg viewBox="0 0 12 16" aria-hidden="true">
          <path d="M3 3L9 8L3 13"></path>
        </svg>
      </button>
    </div>
  `;
}

/* Погрешность дробной ширины: иначе «конец» не наступает никогда. */
const SCROLL_EPS=2;

/*
  Состояние ленты ПВЗ: видны ли стрелки, упёрлась ли она в край и надо
  ли затенять обрезанный край. Вызывается после каждой перерисовки и на
  прокрутку с изменением размера окна.
*/
export function syncShiftViewChips(root=document){
  const frame=root.querySelector("[data-points-strip]");
  const strip=frame?.querySelector("[data-points-chips]");

  if(!frame || !strip){
    return;
  }

  const overflow=
    strip.scrollWidth-
    strip.clientWidth;

  const left=strip.scrollLeft;

  frame.classList.toggle(
    "has-start",
    overflow>SCROLL_EPS &&
    left>SCROLL_EPS
  );

  frame.classList.toggle(
    "has-end",
    overflow>SCROLL_EPS &&
    left<overflow-SCROLL_EPS
  );

  for(const button of frame.querySelectorAll(
    "[data-points-scroll]"
  )){
    const ahead=
      button.dataset.pointsScroll==="1";

    button.hidden=overflow<=SCROLL_EPS;

    button.disabled=ahead
      ? left>=overflow-SCROLL_EPS
      : left<=SCROLL_EPS;
  }
}

/*
  Выбранный ПВЗ не должен уезжать за край после переключения: лента
  подтягивает его к себе, а не заставляет искать заново.

  Подтягивает ровно один раз на выбор. Перерисовка случается и сама по
  себе — например, когда приходят свежие данные; если возвращать ленту
  на каждой, она будет отматываться из-под руки у того, кто её листает.
*/
let revealedPointId=null;

function revealActiveChip(root){
  const strip=root.querySelector("[data-points-chips]");
  const active=strip?.querySelector(".sv-chip.on");

  if(!strip || !active){
    revealedPointId=null;
    return;
  }

  const pointId=active.dataset.calendarPoint ?? "";

  if(pointId===revealedPointId){
    return;
  }

  revealedPointId=pointId;

  const stripBox=strip.getBoundingClientRect();
  const chipBox=active.getBoundingClientRect();

  if(
    chipBox.left>=stripBox.left-SCROLL_EPS &&
    chipBox.right<=stripBox.right+SCROLL_EPS
  ){
    return;
  }

  active.scrollIntoView({
    behavior:"smooth",
    block:"nearest",
    inline:"nearest"
  });
}

/*
  Разовая установка обработчиков ленты. Поведение ленты живёт здесь
  целиком, поэтому в app.js от неё остаётся одна строка.
*/
export function installShiftViewChips(root){
  const sync=()=>syncShiftViewChips(root);

  root.addEventListener(
    "scroll",
    event=>{
      if(
        event.target instanceof HTMLElement &&
        event.target.hasAttribute("data-points-chips")
      ){
        sync();
      }
    },
    true
  );

  /*
    Колесо мыши шлёт только deltaY, и лента для него неподвижна.
    Горизонтальный жест трекпада приходит со своим deltaX — его отдаём
    браузеру как есть.
  */
  root.addEventListener(
    "wheel",
    event=>{
      const strip=event.target instanceof Element
        ? event.target.closest("[data-points-chips]")
        : null;

      if(!strip){
        return;
      }

      const overflow=
        strip.scrollWidth-
        strip.clientWidth;

      /* Лента помещается целиком — колесу здесь делать нечего. */
      if(overflow<=SCROLL_EPS){
        return;
      }

      /*
        Пока курсор над лентой, колесо принадлежит ей. Листание месяцев
        слушает горизонтальный жест на всём документе, и без этого
        двухпальцевый свайп по ленте заодно перелистывал бы месяц.
      */
      event.stopPropagation();

      /* Горизонтальный жест лента прокручивает сама, без нас. */
      if(
        Math.abs(event.deltaX)>
        Math.abs(event.deltaY)
      ){
        return;
      }

      const next=Math.max(
        0,
        Math.min(
          overflow,
          strip.scrollLeft+event.deltaY
        )
      );

      if(next===strip.scrollLeft){
        return;
      }

      event.preventDefault();
      strip.scrollLeft=next;
      sync();
    },
    {passive:false}
  );

  root.addEventListener("click",event=>{
    const button=event.target instanceof Element
      ? event.target.closest("[data-points-scroll]")
      : null;

    if(!button){
      return;
    }

    const strip=button
      .closest("[data-points-strip]")
      ?.querySelector("[data-points-chips]");

    if(!strip){
      return;
    }

    /* Шаг — почти экран ленты: край остаётся виден для связи. */
    strip.scrollBy({
      left:
        Number(button.dataset.pointsScroll)*
        Math.max(
          120,
          strip.clientWidth*0.8
        ),
      behavior:"smooth"
    });
  });

  window.addEventListener("resize",sync);
}

export function afterShiftViewRender(root=document){
  syncShiftViewChips(root);
  revealActiveChip(root);
}

function dayCellHTML({
  date,
  list,
  today,
  selectedDay,
  pointId,
  format
}){
  const {esc,money,calc}=format;
  const day=Number(date.slice(8,10));
  const past=date<=today;

  const total=list.reduce(
    (sum,shift)=>
      sum+calc(shift).total,
    0
  );

  const classes=[
    "sv-day",
    list.length ? "has" : "empty",
    !list.length && past ? "missed" : "",
    !list.length && !past ? "ahead" : "",
    date===today ? "today" : "",
    date===selectedDay ? "on" : ""
  ].filter(Boolean);

  const lines=list
    .slice(0,3)
    .map(shift=>`
      <span class="sv-day-line">
        <span class="sv-day-line-main">
          ${esc(
            pointId
              ? shift.employeeName || "—"
              : shift.point
          )}
        </span>
        ${shift.type==="extra"
          ? `<span class="sv-day-flag">доп</span>`
          : ""}
        ${shift.partial
          ? `<span class="sv-day-flag">часть</span>`
          : ""}
      </span>
    `)
    .join("");

  const hidden=list.length>3
    ? `<span class="sv-day-more">ещё ${list.length-3}</span>`
    : "";

  return `
    <button
      type="button"
      class="${classes.join(" ")}"
      data-calendar-day="${date}"
      aria-pressed="${date===selectedDay ? "true" : "false"}"
      aria-label="${day}, ${
        list.length
          ? `смен: ${list.length}`
          : past
            ? "смен нет"
            : "день ещё не наступил"
      }"
    >
      <span class="sv-day-head">
        <span class="sv-day-num">${day}</span>
        ${list.length
          ? `<span class="sv-day-count">${list.length}</span>`
          : past
            ? `<span class="sv-day-gap" aria-hidden="true"></span>`
            : ""}
      </span>

      <span class="sv-day-body">${lines}${hidden}</span>

      ${list.length
        ? `<span class="sv-day-sum">${money(total)}</span>`
        : ""}
    </button>
  `;
}

function dayPanelHTML({
  selectedDay,
  list,
  pointName,
  isAdmin,
  format
}){
  const {esc,money,calc,dateLabel,shortDateLabel}=format;

  if(!selectedDay){
    return `
      <div class="sv-panel sv-panel-empty">
        <div class="sv-panel-hint">
          Выберите день — здесь появятся его смены.
        </div>
      </div>
    `;
  }

  const rows=list
    .map(shift=>{
      const result=calc(shift);

      return `
        <button
          type="button"
          class="sh"
          data-key="calendar-day-shift-${esc(shift.id)}"
          data-edit="${esc(shift.id)}"
        >
          <span class="day">
            <span class="d">${Number(selectedDay.slice(8,10))}</span>
            <span class="w">${
              WEEKDAYS[weekdayIndex(selectedDay)]
            }</span>
          </span>

          <span class="mid">
            <span class="p">${esc(shift.point)}</span>
            <span class="meta">
              <span>${esc(shift.employeeName || "—")}</span>
              ${shift.type==="extra"
                ? `<span class="tag g">Доп</span>`
                : ""}
              ${shift.partial
                ? `<span class="tag">часть</span>`
                : ""}
            </span>
          </span>

          <span class="amt">${money(result.total)}</span>
        </button>
      `;
    })
    .join("");

  return `
    <div class="sv-panel">
      <div class="sv-panel-head">
        <div class="sv-panel-date">
          ${esc(dateLabel(selectedDay))}
        </div>
        <div class="sv-panel-sub">
          ${pointName ? esc(pointName)+" · " : ""}${
            list.length
              ? `смен: ${list.length}`
              : "смен нет"
          }
        </div>
      </div>

      ${list.length
        ? `<div class="sv-panel-list">${rows}</div>`
        : `<div class="sv-panel-hint">
             В этот день смен не записано.
           </div>`}

      ${isAdmin
        ? `<button
             type="button"
             class="btn gold sv-panel-add"
             data-calendar-add="${selectedDay}"
           >
             Добавить смену на ${esc(
               shortDateLabel(selectedDay)
             )}
           </button>
           `
        : ""}
    </div>
  `;
}

export function calendarViewHTML({
  cursor,
  shifts,
  points,
  pointId,
  selectedDay,
  today,
  isAdmin,
  format
}){
  const {esc}=format;

  const counts=new Map();

  for(const shift of shifts){
    const id=shiftPointId(shift);

    counts.set(
      id,
      (counts.get(id) || 0)+1
    );
  }

  const scoped=pointId
    ? shifts.filter(
        shift=>
          shiftPointId(shift)===pointId
      )
    : shifts;

  const map=byDay(scoped);
  const days=monthDays(cursor);
  const summary=monthSummary({
    shifts:scoped,
    cursor,
    today
  });

  const lead=weekdayIndex(days[0]);

  const cells=[
    ...Array.from(
      {length:lead},
      ()=>`<span class="sv-day outside" aria-hidden="true"></span>`
    ),
    ...days.map(date=>
      dayCellHTML({
        date,
        list:map.get(date) || [],
        today,
        selectedDay,
        pointId,
        format
      })
    )
  ];

  const point=points.find(
    item=>item.id===pointId
  );

  return `
    <div class="ml">Пункт выдачи</div>
    ${pointChipsHTML({
      points,
      pointId,
      counts,
      esc
    })}

    <div class="sv-summary">
      <span class="sv-summary-name">
        ${point ? esc(point.name) : "Все ПВЗ"}
      </span>
      <span class="sv-summary-item">
        смен <b>${summary.shifts}</b>
      </span>
      <span class="sv-summary-item">
        дней со сменами <b>${summary.withShifts}</b>
      </span>
      <span class="sv-summary-item ${
        summary.missed ? "warn" : ""
      }">
        прошло без смен <b>${summary.missed}</b>
      </span>
    </div>

    <div class="sv-layout">
      <div class="card sv-calendar">
        <div class="sv-weekdays" aria-hidden="true">
          ${WEEKDAYS.map(name=>`
            <span class="sv-weekday">${name}</span>
          `).join("")}
        </div>

        <div class="sv-grid" role="grid" aria-label="Смены по дням">
          ${cells.join("")}
        </div>

        <div class="sv-legend">
          <span class="sv-legend-item">
            <span class="sv-legend-mark has"></span>
            есть смены
          </span>
          <span class="sv-legend-item">
            <span class="sv-legend-mark missed"></span>
            день прошёл без смен
          </span>
          <span class="sv-legend-item">
            <span class="sv-legend-mark ahead"></span>
            день ещё впереди
          </span>
        </div>
      </div>

      <div class="sv-panel-slot">
        ${dayPanelHTML({
          selectedDay,
          list:selectedDay
            ? map.get(selectedDay) || []
            : [],
          pointName:point?.name || "",
          isAdmin,
          format
        })}
      </div>
    </div>

    <div class="sheet-spacer" aria-hidden="true"></div>
  `;
}

export function controlViewHTML({
  cursor,
  shifts,
  points,
  today,
  format
}){
  const {esc}=format;
  const days=monthDays(cursor);

  const rows=points.map(point=>{
    const scoped=shifts.filter(
      shift=>
        shiftPointId(shift)===point.id
    );

    const map=byDay(scoped);

    const summary=monthSummary({
      shifts:scoped,
      cursor,
      today
    });

    const cells=days.map(date=>{
      const list=map.get(date) || [];
      const past=date<=today;

      const classes=[
        "sv-cell",
        list.length ? "has" : "",
        !list.length && past ? "missed" : "",
        !list.length && !past ? "ahead" : "",
        date===today ? "today" : ""
      ].filter(Boolean);

      return `
        <td class="${classes.join(" ")}">
          <button
            type="button"
            data-control-cell="${esc(point.id)}|${date}"
            aria-label="${esc(point.name)}, ${
              Number(date.slice(8,10))
            } — ${
              list.length
                ? `смен: ${list.length}`
                : past
                  ? "смен нет"
                  : "день впереди"
            }"
          >
            ${list.length > 1 ? list.length : ""}
          </button>
        </td>
      `;
    });

    return `
      <tr>
        <th scope="row" class="sv-control-point">
          <span class="sv-control-name">
            ${esc(point.name)}
          </span>
          <span class="sv-control-sub">
            смен ${summary.shifts} ·
            <b class="${summary.missed ? "warn" : ""}">
              без смен ${summary.missed}
            </b>
          </span>
        </th>
        ${cells.join("")}
      </tr>
    `;
  });

  if(!rows.length){
    return `
      <div class="ml">Контроль</div>
      <div class="card">
        <div class="employee-empty">
          Нет пунктов выдачи для проверки.
        </div>
      </div>
    `;
  }

  return `
    <div class="ml">
      Дни без смен по каждому ПВЗ
    </div>

    <div class="card sv-control">
      <div class="sv-control-scroll">
        <table style="--sv-days:${days.length}">
          <colgroup>
            <col class="sv-col-name">
            ${days.map(()=>`<col class="sv-col-day">`).join("")}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="sv-control-point">ПВЗ</th>
              ${days.map(date=>`
                <th
                  scope="col"
                  class="${date===today ? "today" : ""}"
                >
                  ${Number(date.slice(8,10))}
                </th>
              `).join("")}
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>

      <div class="sv-legend">
        <span class="sv-legend-item">
          <span class="sv-legend-mark has"></span>
          есть смены
        </span>
        <span class="sv-legend-item">
          <span class="sv-legend-mark missed"></span>
          день прошёл без смен
        </span>
        <span class="sv-legend-item">
          клетка открывает день в календаре
        </span>
      </div>
    </div>

    <div class="sheet-spacer" aria-hidden="true"></div>
  `;
}
