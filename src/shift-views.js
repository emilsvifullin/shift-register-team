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

  Модуль ничего не импортирует из приложения: данные, форматтеры и
  общие куски разметки (раскрытие строки, поле поиска) приходят доводом,
  наружу уходит разметка. Состояние (режим, выбранный ПВЗ, открытый
  день, выбранные дни) живёт в app.js рядом с остальным состоянием
  экрана, поведения своего у модуля нет.

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
function monthSummary({
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

/*
  Выбор ПВЗ — строка с раскрывающимся списком и поиском, та же, что
  выбирает сотрудника в «Итогах».

  Раньше здесь была горизонтальная лента кнопок. На пяти пунктах она
  удобна, на тридцати до нужного приходилось долистывать, а на сотне
  найти его можно было только глазами. Список прокручивается по
  вертикали, где его и читают, и сужается поиском по первым буквам —
  число пунктов на это больше не влияет.

  Рядом с каждым пунктом — сколько у него смен в этом месяце: ноль тоже
  ответ, ради него календарь и открывают.
*/
function pointPickerHTML({
  points,
  pointId,
  counts,
  total,
  open,
  query,
  format
}){
  const {esc,reveal,search,filterOptions,shiftsWord}=format;

  const options=[
    {
      value:"",
      label:"Все ПВЗ",
      count:total
    },
    ...points.map(point=>({
      value:point.id,
      label:point.name,
      searchText:point.code || "",
      count:counts.get(point.id) || 0
    }))
  ];

  const visible=filterOptions(options,query);
  const current=options.find(option=>option.value===pointId) || options[0];

  const list=visible.length
    ? `
      <div class="inline-options">
        ${visible.map(option=>`
          <button
            type="button"
            class="point-option ${option.value===current.value ? "on" : ""}"
            data-calendar-point="${esc(option.value)}"
          >
            <span class="point-check">
              ${option.value===current.value ? "\u2713" : ""}
            </span>
            <span class="point-name">${esc(option.label)}</span>
            <span class="sv-option-count">${option.count}</span>
          </button>
        `).join("")}
      </div>
    `
    : `<div class="inline-empty">Ничего не найдено</div>`;

  return `
    <div class="ml">Пункт выдачи</div>
    <div class="card employee-editor sv-point-card">
      <button
        type="button"
        class="row point-row sv-point-row"
        id="calendarPointOpen"
        aria-expanded="${open ? "true" : "false"}"
        aria-label="Пункт выдачи: ${esc(current.label)}"
      >
        <div class="t">${esc(current.label)}</div>
        <div class="point-value">${shiftsWord(current.count)}</div>
      </button>

      ${reveal({
        key:"calendarPointReveal",
        open,
        body:`
          <div class="inline-choice">
            ${search({
              id:"calendarPointSearch",
              value:query,
              label:"Поиск ПВЗ"
            })}
            ${list}
          </div>
        `
      })}
    </div>
  `;
}

/*
  Клетка дня.

  Высота клетки не зависит от того, что в ней лежит: её задаёт строка
  сетки, а не содержимое. Раньше неделя с насыщенными днями вырастала,
  а последняя строка месяца — будущие дни без смен — оставалась ниже
  остальных, и сетка месяца выглядела собранной из разных кусков.
  Поэтому строк с именами помещается ровно столько, сколько влезает в
  клетку: три, а если смен больше — две и «ещё N».
*/
function dayCellHTML({
  date,
  list,
  today,
  selectedDay,
  picking,
  picked,
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

  const chosen=picking
    ? picked.has(date)
    : date===selectedDay;

  const classes=[
    "sv-day",
    list.length ? "has" : "empty",
    !list.length && past ? "missed" : "",
    !list.length && !past ? "ahead" : "",
    date===today ? "today" : "",
    chosen ? (picking ? "picked" : "on") : ""
  ].filter(Boolean);

  const shown=list.length>3 ? 2 : 3;

  const lines=list
    .slice(0,shown)
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

  const hidden=list.length>shown
    ? `<span class="sv-day-more">ещё ${list.length-shown}</span>`
    : "";

  return `
    <button
      type="button"
      class="${classes.join(" ")}"
      data-calendar-day="${date}"
      aria-pressed="${chosen ? "true" : "false"}"
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

/*
  Строка смены в панели. Одна разметка на панель дня и на выбор дней:
  отличается только то, что делает нажатие.
*/
function panelShiftHTML({
  shift,
  pick,
  format
}){
  const {esc,money,calc}=format;

  const attributes=pick
    ? `
      data-key="calendar-pick-${esc(shift.id)}"
      data-calendar-pick-shift="${esc(shift.id)}"
      aria-pressed="${pick.included ? "true" : "false"}"
    `
    : `
      data-key="calendar-day-shift-${esc(shift.id)}"
      data-edit="${esc(shift.id)}"
    `;

  return `
    <button
      type="button"
      class="sh${pick?.included ? " chosen" : ""}"
      ${attributes}
    >
      ${pick
        ? `<span class="sh-check" aria-hidden="true">${
            pick.included ? "✓" : ""
          }</span>`
        : ""}

      <span class="day">
        <span class="d">${Number(shift.date.slice(8,10))}</span>
        <span class="w">${
          WEEKDAYS[weekdayIndex(shift.date)]
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

      <span class="amt">${money(calc(shift).total)}</span>
    </button>
  `;
}

/*
  Панель дня.

  «Смен нет» говорится один раз. Прежде пустой день сообщал об этом
  дважды подряд — подписью под датой и отдельной строкой под ней, а
  рядом то же самое уже показывала клетка календаря.
*/
function dayPanelHTML({
  selectedDay,
  list,
  scopeName,
  today,
  isAdmin,
  format
}){
  const {esc,money,calc,dateLabel,shortDateLabel,shiftsWord}=format;

  if(!selectedDay){
    return `
      <div class="sv-panel sv-panel-empty">
        <div class="sv-panel-hint">
          Выберите день — здесь появятся его смены.
        </div>
      </div>
    `;
  }

  const total=list.reduce(
    (sum,shift)=>sum+calc(shift).total,
    0
  );

  return `
    <div class="sv-panel">
      <div class="sv-panel-head">
        <div class="sv-panel-date">
          ${esc(dateLabel(selectedDay))}
        </div>
        <div class="sv-panel-sub">
          ${esc(scopeName)}${
            list.length
              ? ` · ${shiftsWord(list.length)} · ${money(total)}`
              : ""
          }
        </div>
      </div>

      ${list.length
        ? `<div class="sv-panel-list">${
            list
              .map(shift=>panelShiftHTML({shift,format}))
              .join("")
          }</div>`
        : `<div class="sv-panel-hint">${
            selectedDay<=today
              ? "В этот день смен не записано."
              : "На этот день смен пока нет."
          }</div>`}

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

/*
  Панель выбора дней.

  Календарь выбирает дни, а не строки: «эти дни у этого ПВЗ» — и есть
  тот вопрос, с которым сюда приходят убирать ошибочно заведённое или
  заводить смены на несколько дней сразу. Поэтому массовое действие
  здесь начинается с дней, а панель показывает, во что выбор
  превращается: какие смены, на какую сумму. Любую из них можно снять —
  в одном дне бывают смены разных людей, а убрать нужно только чужие.

  Если среди смен есть закрытый или выплаченный период, панель говорит
  об этом до нажатия. Сама защита остаётся там, где была: сервер
  откажет, и про каждый такой период спросят отдельно.
*/
function pickPanelHTML({
  picked,
  shiftDays,
  shifts,
  skipped,
  scopeName,
  format
}){
  const {esc,money,calc,plural,shiftsWord,shiftsAccWord,periodLock}=format;

  const daysWord=count=>plural(
    count,
    ["день","дня","дней"]
  );

  /*
    Панель выбора устроена как панель дня: заголовок говорит, что
    выбрано, строка под ним — где и на сколько. Общий флажок стоит
    отдельной строкой над списком, в столбце флажков смен, и отвечает
    только за одно — отметить все дни со сменами или снять выбор. Раньше
    он делил одну строку со счётчиком «Ничего не выбрано», и две подписи
    одного веса спорили друг с другом.
  */
  const allShiftDays=
    shiftDays.length>0 &&
    shiftDays.every(date=>picked.includes(date));

  const master=allShiftDays
    ? "all"
    : picked.length
      ? "some"
      : "none";

  const masterHTML=`
    <button
      type="button"
      class="shift-select-all sv-pick-all"
      data-calendar-pick-all
      aria-pressed="${
        master==="all"
          ? "true"
          : master==="some"
            ? "mixed"
            : "false"
      }"
      ${shiftDays.length ? "" : "disabled"}
    >
      <span class="sh-check ${master}" aria-hidden="true">${
        master==="all"
          ? "✓"
          : master==="some"
            ? "–"
            : ""
      }</span>
      <span>${allShiftDays ? "Снять выбор" : "Все дни со сменами"}</span>
    </button>
  `;

  /*
    Пустое состояние — одна фраза о смысле панели. Диапазон с Shift
    остаётся тихой подсказкой внизу и только там, где есть клавиатура.
  */
  if(!picked.length){
    return `
      <div class="sv-panel sv-panel-pick">
        <div class="sv-panel-head">
          <div class="sv-panel-date">Выбор дней</div>
          <div class="sv-panel-sub">${esc(scopeName)}</div>
        </div>

        ${masterHTML}

        <div class="sv-panel-hint">
          Отметьте дни — их смены соберутся здесь.
        </div>

        <div class="sv-pick-tip">
          <kbd>Shift</kbd> — несколько дней подряд
        </div>
      </div>
    `;
  }

  const included=shifts.filter(
    shift=>!skipped.has(shift.id)
  );

  const total=included.reduce(
    (sum,shift)=>sum+calc(shift).total,
    0
  );

  const locks=new Map();

  for(const shift of included){
    const lock=periodLock(shift.date);

    if(lock){
      locks.set(lock.key,lock.label);
    }
  }

  return `
    <div class="sv-panel sv-panel-pick">
      <div class="sv-panel-head">
        <div class="sv-panel-date">
          Выбрано ${daysWord(picked.length)}
        </div>
        <div class="sv-panel-sub">
          ${esc(scopeName)}${
            shifts.length
              ? ` · ${shiftsWord(included.length)} · ${money(total)}`
              : ""
          }
        </div>
      </div>

      ${masterHTML}

      ${shifts.length
        ? `<div class="sv-panel-list">${
            shifts
              .map(shift=>panelShiftHTML({
                shift,
                pick:{included:!skipped.has(shift.id)},
                format
              }))
              .join("")
          }</div>`
        : `<div class="sv-panel-hint">
             В выбранных днях смен нет.
           </div>`}

      ${locks.size
        ? `<div class="sv-panel-note">${
            [...locks.values()]
              .map(label=>esc(label))
              .join(". ")
          }. Удаление там попадёт в историю периода — перед ним спросим отдельно.</div>`
        : ""}

      <div class="sv-panel-actions">
        <button
          type="button"
          class="btn gold"
          data-calendar-add-picked
        >
          Добавить смену на ${daysWord(picked.length)}
        </button>

        ${shifts.length
          ? `<button
               type="button"
               class="btn warn"
               data-calendar-delete-picked
               ${included.length ? "" : "disabled"}
             >
               Удалить ${
                 included.length
                   ? `${included.length} ${shiftsAccWord(included.length)}`
                   : "смены"
               }
             </button>`
          : ""}
      </div>
    </div>
  `;
}

/*
  Смены, которые попадают в выбранные дни при текущем ПВЗ. Тот же
  расчёт нужен и разметке, и действию, поэтому он здесь, в одном месте.
*/
export function pickedShifts({
  shifts,
  pointId,
  picked
}){
  return shifts
    .filter(shift=>
      picked.has(shift.date) &&
      (!pointId || shiftPointId(shift)===pointId)
    )
    .sort((first,second)=>
      first.date.localeCompare(second.date) ||
      String(first.point).localeCompare(
        String(second.point),
        "ru"
      )
    );
}

export function calendarViewHTML({
  cursor,
  shifts,
  points,
  pointId,
  pointOpen,
  pointQuery,
  selectedDay,
  picking,
  picked,
  skipped,
  today,
  isAdmin,
  format
}){
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
        picking,
        picked,
        pointId,
        format
      })
    )
  ];

  const point=points.find(
    item=>item.id===pointId
  );

  const scopeName=point?.name || "Все ПВЗ";

  const pickedDays=days.filter(
    date=>picked.has(date)
  );

  return `
    ${pointPickerHTML({
      points,
      pointId,
      counts,
      total:shifts.length,
      open:pointOpen,
      query:pointQuery,
      format
    })}

    <div class="sv-summary-row">
      <div class="sv-summary">
        <span class="sv-summary-item">
          дней со сменами <b>${summary.withShifts}</b>
        </span>
        <span class="sv-summary-item ${
          summary.missed ? "warn" : ""
        }">
          прошло без смен <b>${summary.missed}</b>
        </span>
      </div>

      ${isAdmin
        ? `<button
             type="button"
             class="ml-action sv-pick-toggle"
             data-calendar-pick-mode
             aria-pressed="${picking ? "true" : "false"}"
           >
             ${picking ? "Готово" : "Выбрать дни"}
           </button>`
        : ""}
    </div>

    <div class="sv-layout">
      <div class="card sv-calendar">
        <div class="sv-weekdays" aria-hidden="true">
          ${WEEKDAYS.map(name=>`
            <span class="sv-weekday">${name}</span>
          `).join("")}
        </div>

        <div
          class="sv-grid"
          role="group"
          aria-label="${picking ? "Выбор дней" : "Смены по дням"}"
        >
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
        ${picking
          ? pickPanelHTML({
              picked:pickedDays,
              shifts:pickedShifts({
                shifts,
                pointId,
                picked
              }),
              shiftDays:days.filter(date=>map.has(date)),
              skipped,
              scopeName,
              format
            })
          : dayPanelHTML({
              selectedDay,
              list:selectedDay
                ? map.get(selectedDay) || []
                : [],
              scopeName,
              today,
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
