/*
  Сборка инструкции: HTML из снимков out/shots и, если указан путь, PDF.

    node docs/manual/build.mjs                 только out/manual.html и проверки
    node docs/manual/build.mjs ~/Desktop/x.pdf  ещё и PDF

  Номера и рамки накладываются здесь, по разметке из shots/<имя>.json:
  на любой странице номер одного размера, как в пояснениях рядом, как бы
  ни был уменьшен снимок. Ссылки «с. N» пишутся как {{ключ страницы}} и
  подставляются по фактическому порядку страниц.
*/

import {chromium} from "@playwright/test";
import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const OUT=fileURLToPath(new URL("./out/",import.meta.url));
const OUT_PDF=process.argv[2];

/* ---------- снимки ---------- */

const ACCENT="#D9771E";

/* Размеры в миллиметрах печатной страницы. */
const BADGE=5.2;
const BADGE_GAP=1.3;
const STROKE=0.5;
const MAT=7;
const WINDOW_RADIUS=3.4;
const FADE=16;

/* Кегль основного текста приложения — по нему считаем, читается ли снимок. */
const APP_TEXT_PX=13;
const PT=0.3528;

const scales=[];

const meta=name=>JSON.parse(readFileSync(`${OUT}shots/${name}.json`,"utf8"));

const mm=v=>`${v.toFixed(2)}mm`;

function fadeMask(fade){
  if(fade==="bottom") return `linear-gradient(to bottom,#000 calc(100% - ${FADE}mm),transparent)`;
  if(fade==="top") return `linear-gradient(to bottom,transparent,#000 ${FADE*.75}mm)`;
  if(fade==="bottom-right") return `linear-gradient(to bottom,#000 calc(100% - ${FADE*.7}mm),transparent),linear-gradient(to right,#000 calc(100% - ${FADE}mm),transparent)`;
  if(fade==="both") return `linear-gradient(to bottom,transparent,#000 ${FADE*.75}mm,#000 calc(100% - ${FADE}mm),transparent)`;
  return "";
}

function markHtml(m,k){
  const pad=m.pad*k;
  const x=m.x*k-pad;
  const y=m.y*k-pad;
  const w=m.w*k+pad*2;
  const h=m.h*k+pad*2;
  let html="";

  if(m.box){
    const radius=m.radius>=999 ? "999px" : mm(Math.max(m.radius*k,.8));
    html+=`<i class="mbox" style="left:${mm(x)};top:${mm(y)};width:${mm(w)};height:${mm(h)};border-radius:${radius}"></i>`;
  }

  if(m.n===null){
    return html;
  }

  const cx=x+w/2;
  const cy=y+h/2;
  const at={
    left:[x-BADGE-BADGE_GAP,cy-BADGE/2],
    right:[x+w+BADGE_GAP,cy-BADGE/2],
    top:[cx-BADGE/2,y-BADGE-BADGE_GAP],
    bottom:[cx-BADGE/2,y+h+BADGE_GAP],
    "inside-left":[x+BADGE_GAP*2,cy-BADGE/2],
    "inside-right":[x+w-BADGE-BADGE_GAP*2,cy-BADGE/2],
    corner:[x-BADGE/2,y-BADGE/2]
  }[m.at];

  html+=`<b class="mbadge" style="left:${mm(at[0])};top:${mm(at[1])}">${m.n}</b>`;
  return html;
}

/*
  Снимок, вписанный в рамку w×h мм.

  Экран приложения — «окно»: скругление, тонкая обводка и тень. Панель или
  диалог лежат на подложке с полями, в которые выходят номера.
*/
function fig(name,{w,h}){
  const m=meta(name);
  const mat=m.floating ? MAT : 0;
  const k=Math.min((w-mat*2)/m.width,(h-mat*2)/m.height);
  const iw=m.width*k;
  const ih=m.height*k;

  scales.push({name,k,pt:APP_TEXT_PX*k/PT});

  const kind=m.bare ? "bare" : (m.floating ? "panel" : "window");
  const radius=kind==="window" ? WINDOW_RADIUS : (kind==="panel" ? Math.max(m.radius*k,2) : 0);
  const mask=fadeMask(m.fade);
  /* У растворяющегося края тень оборвалась бы полосой — там обходимся без неё. */
  const shade=kind==="bare" || m.fade ? "" : `<span class="shade" style="top:0;bottom:0;border-radius:${mm(radius)}"></span>`;

  return `
    <div class="fig${mat ? " mat" : ""}" style="width:${mm(iw+mat*2)};height:${mm(ih+mat*2)}">
      <div class="shot ${kind}" style="left:${mm(mat)};top:${mm(mat)};width:${mm(iw)};height:${mm(ih)}">
        ${shade}
        <div class="clip" style="border-radius:${mm(radius)};${mask ? `-webkit-mask-image:${mask};mask-image:${mask};-webkit-mask-composite:source-in;mask-composite:intersect` : ""}">
          <img src="shots/${name}.png" alt="">
        </div>
        <div class="marks">${m.marks.map(mark=>markHtml(mark,k)).join("")}</div>
      </div>
    </div>`;
}

/* ---------- разметка страниц ---------- */

const esc=s=>String(s)
  .replace(/&/g,"&amp;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;");

/* Пункт легенды: «жирное начало — пояснение». Разметку внутри текста допускаем. */
const legend=items=>`
  <ol class="legend">
    ${items.map(([n,title,text])=>`
      <li>
        <span class="badge">${n}</span>
        <div><b>${title}</b>${text ? ` — ${text}` : ""}</div>
      </li>
    `).join("")}
  </ol>
`;

/* Та же легенда в две колонки — под снимком во всю ширину. */
const legend2=items=>legend(items).replace('class="legend"','class="legend cols"');

const note=(text,kind="")=>`<div class="note ${kind}">${text}</div>`;

/* Ширина тела страницы: 297 − 2×15 мм. */
const BODY_W=267;
const GAP=9;

/* Снимок слева шириной до w мм, пояснения справа. */
const split=(figure,side)=>`
  <div class="split">
    <div class="figcol">${figure}</div>
    <div class="side">${side}</div>
  </div>`;

/* Две колонки: снимок и пояснения под ним. */
const pair=(left,right,{ratio=[1,1]}={})=>`
  <div class="pair">
    <div class="col" style="flex:${ratio[0]}">${left}</div>
    <div class="col" style="flex:${ratio[1]}">${right}</div>
  </div>`;

/* Снимок во всю ширину, пояснения строкой ниже. */
const stack=(figure,below)=>`
  <div class="stack">
    <div class="figrow">${figure}</div>
    <div class="row3">${below}</div>
  </div>`;

const subfig=(figure,after)=>`
  <div class="subfig">
    ${figure}
    ${after}
  </div>`;

const pages=[];

/*
  Страница: ключ для ссылок, раздел (подпись сверху), заголовок, вводная
  фраза и тело. toc — строка в оглавлении.
*/
function page({key,section,title,lead="",body,toc=true,cls=""}){
  pages.push({key,section,title,lead,body,toc,cls});
}

/* ---------- обложка и оглавление ---------- */

pages.push({cover:true});
pages.push({contents:true});

/* ---------- 1. Начало работы ---------- */

page({
  key:"login",
  section:"Начало работы",
  title:"Вход в приложение",
  lead:"Shift Register открывается в браузере или как отдельное приложение. Администратор входит под своей рабочей почтой.",
  body:split(fig("01-login",{w:125,h:135}),`
    ${legend([
      [1,"Почта","адрес рабочего аккаунта."],
      [2,"Пароль",""],
      [3,"Войти","откроется раздел «Смены» за текущий месяц."]
    ])}
    ${note("Вход сохраняется: пока вы не нажмёте «Выйти» в разделе «Данные», вводить пароль снова не нужно.")}
    ${note("Сайт можно установить как приложение — кнопкой «Установить» в адресной строке браузера или в его меню. Тогда Shift Register открывается отдельным окном, как на скриншотах в этой инструкции.")}
  `)
});

page({
  key:"screen",
  section:"Начало работы",
  title:"Устройство экрана и выбор месяца",
  lead:"Все разделы показывают один выбранный месяц. Переключение месяца и разделов работает одинаково везде.",
  body:split(fig("02-overview",{w:150,h:150}),`
    ${legend([
      [1,"Месяц","нажмите на название, чтобы выбрать месяц и год."],
      [2,"Стрелки","предыдущий и следующий месяц. На тачпаде можно листать двумя пальцами влево и вправо."],
      [3,"Разделы","<i>Смены</i> — учёт смен; <i>Итоги</i> — начисления, выплаты и расчётные периоды; <i>Управление</i> — сотрудники, пункты выдачи и тарифы; <i>Данные</i> — синхронизация, экспорт и выход."]
    ])}
    ${subfig(fig("03-month",{w:BODY_W-150-GAP,h:72}),legend([
      [1,"Год","стрелками по сторонам."],
      [2,"Месяц","нажмите, затем «Готово»."],
      [3,"Текущий месяц","быстрый возврат к сегодняшнему."]
    ]))}
  `)
});

/* ---------- 2. Смены ---------- */

page({
  key:"registry",
  section:"Смены",
  title:"Реестр смен",
  lead:"Реестр — список всех смен месяца, свежие сверху. С него раздел открывается.",
  body:split(fig("04-registry",{w:150,h:150}),legend([
    [1,"Добавить смену","открывает форму новой смены ({{new-shift}})."],
    [2,"Представление","<i>Реестр</i> — список; <i>Календарь</i> — месяц по дням для одного ПВЗ ({{calendar}}); <i>Контроль</i> — все ПВЗ одной таблицей ({{control}})."],
    [3,"Поиск","по ПВЗ, сотруднику, дате, сумме, типу смены и комментарию."],
    [4,"Фильтр","период месяца, ПВЗ и сотрудники ({{filter}}). Справа видно, что сейчас выбрано."],
    [5,"Выбрать","режим удаления нескольких смен ({{select}})."],
    [6,"Строка смены","дата, ПВЗ, оплата, сотрудник и сумма. Нажмите, чтобы открыть карточку."]
  ]))
});

page({
  key:"new-shift",
  section:"Смены",
  title:"Новая смена",
  lead:"Заполните поля сверху вниз и нажмите «Готово». Сумма считается сразу — её видно в блоке «Расчёт».",
  body:split(fig("05-new-shift",{w:140,h:150}),`
    ${legend([
      [1,"Дата","по умолчанию сегодня. Можно выбрать несколько дней сразу ({{dates}})."],
      [2,"Пункт","ПВЗ, где отработана смена."],
      [3,"Сотрудник","в списке — те, кто назначен на этот ПВЗ, и подменный сотрудник."],
      [4,"Тип","основная или дополнительная смена."],
      [5,"Отработано","полная смена или неполная — тогда укажите часы."],
      [6,"Оплата","по тарифу ПВЗ или корректировка оклада — своя сумма с причиной."],
      [7,"Премии","доплаты к смене — подробнее на {{extras}}."],
      [8,"Штрафы","удержания из выплаты — там же."],
      [9,"Комментарий","необязательно."],
      [10,"Расчёт","оклад, тариф, с какой даты он действует, итог за смену."],
      [11,"Готово","сохранить. «Отмена» — закрыть без сохранения."]
    ])}
    ${note("Для ПВЗ с тарифом по ШК в форме появляется поле «ШК» — от количества зависит ставка.")}
  `)
});

page({
  key:"dates",
  section:"Смены",
  title:"Смены на несколько дней",
  lead:"Одна форма создаёт смены сразу на несколько дат.",
  body:split(fig("06-dates",{w:140,h:150}),`
    ${legend([
      [1,"Отметьте дни","каждое нажатие добавляет или убирает дату."],
      [2,"Проверьте итог","«Выбрано 3 даты — будет создано столько же смен». Лишнюю дату уберите крестиком."]
    ])}
    ${note("Точка под числом — у сотрудника в этот день уже есть смена. Если выбрать такой день, приложение предложит создать смены только на остальных датах.")}
  `)
});

page({
  key:"extras",
  section:"Смены",
  title:"Неполная смена, премии и штрафы",
  lead:"Та же форма учитывает всё, что меняет сумму смены.",
  body:split(fig("07-extras",{w:140,h:150}),legend([
    [1,"Часов","для неполной смены; оплата — пропорционально часам."],
    [2,"За смену","сумма вместо тарифа (корректировка оклада)."],
    [3,"Комментарий","причина корректировки — обязательна."],
    [4,"Премия","сумма и комментарий. «Добавить ещё» — следующая."],
    [5,"Штраф","сумма, комментарий и из какой выплаты удержать: по умолчанию, 25-го или 10-го."]
  ]))
});

page({
  key:"card",
  section:"Смены",
  title:"Карточка смены: просмотр, изменение, удаление",
  lead:"Нажмите на смену в реестре или календаре — откроется её карточка.",
  body:pair(`
    ${fig("08a-card",{w:(BODY_W-10)/2,h:112})}
    ${legend([
      [1,"Изменить","перейти к редактированию."],
      [2,"Итого","из чего сложилась сумма."],
      [3,"Закрыть","вернуться к списку."]
    ])}
  `,`
    ${fig("08b-edit",{w:(BODY_W-10)/2,h:112})}
    ${legend([
      [1,"Готово","сохранить изменения. «Назад» — выйти без сохранения."],
      [2,"Удалить смену","удаление с подтверждением."]
    ])}
    ${note("Если тариф ПВЗ изменился после того, как смена была сохранена, в карточке появится кнопка «Пересчитать по текущему тарифу». Сама по себе сумма сохранённой смены не меняется.")}
  `)
});

page({
  key:"filter",
  section:"Смены",
  title:"Поиск и фильтр",
  lead:"Фильтр сужает реестр и выбор смен. Поиск работает поверх фильтра.",
  body:split(fig("09-filter",{w:140,h:150}),`
    ${legend([
      [1,"Период месяца","весь месяц, 1–15, с 16-го до конца или свои даты."],
      [2,"Пункты выдачи","отметьте нужные. «Все ПВЗ» — отметить или снять все сразу."],
      [3,"Сотрудники","так же, списком ниже."],
      [4,"Готово","применить. «Отмена» — оставить как было."]
    ])}
    ${note("Чтобы сбросить фильтр, выберите «Весь», «Все ПВЗ» и «Все сотрудники». Над списком будет написано «Все смены».")}
  `)
});

page({
  key:"select",
  section:"Смены",
  title:"Удаление нескольких смен",
  lead:"Режим выбора убирает сразу несколько ошибочных смен. Нажатие по строке в нём отмечает смену, а не открывает.",
  body:split(fig("10a-select",{w:150,h:150}),`
    ${legend([
      [1,"Выбрать / Готово","вход в режим и выход из него — на одном месте."],
      [2,"Выбрать все / Снять выбор","общий флажок. Учитывает поиск и фильтр: отмечаются только видимые смены."],
      [3,"Счётчик","сколько смен выбрано."],
      [4,"Удалить","доступна, когда выбрана хотя бы одна смена."],
      [5,"Флажок смены","нажмите на строку, чтобы отметить или снять."]
    ])}
    ${subfig(fig("10b-confirm",{w:78,h:62}),legend([
      [1,"Число смен","при удалении пяти и больше смен его нужно набрать."],
      [2,"Удалить","отменить удаление нельзя."]
    ]))}
  `)
});

page({
  key:"calendar",
  section:"Смены",
  title:"Календарь",
  lead:"Календарь показывает месяц по дням: в какие дни смены есть, в какие нет и что в выбранном дне.",
  body:split(fig("11a-calendar",{w:150,h:150}),`
    ${legend([
      [1,"Пункт выдачи","выбор ПВЗ со списком и поиском; «Все ПВЗ» — все сразу."],
      [2,"Сводка","сколько дней со сменами и сколько прошло без смен."],
      [3,"Выбрать дни","действия сразу с несколькими днями ({{pick}})."],
      [4,"Клетка дня","число смен, сотрудники и сумма."],
      [5,"Обозначения","серая клетка — смены есть; розовая с точкой — день прошёл без смен; пунктир — день впереди."],
      [6,"Панель дня","смены выбранного дня. Сегодняшний день открыт сразу; нажмите смену, чтобы открыть карточку."],
      [7,"Добавить смену на день","форма откроется с этой датой и выбранным ПВЗ."]
    ])}
    ${subfig(fig("11b-points",{w:BODY_W-150-GAP,h:48}),`<p class="caption">Поиск в списке ПВЗ: начните вводить название (<b>1</b>), затем нажмите нужный пункт (<b>2</b>). В строке пункта справа — число его смен за месяц.</p>`)}
  `)
});

page({
  key:"pick",
  section:"Смены",
  title:"Выбор дней в календаре",
  lead:"Отметьте дни — справа соберутся их смены. На эти дни можно сразу добавить смены или удалить лишние.",
  body:split(fig("12-pick",{w:150,h:150}),legend([
    [1,"Готово","выйти из режима выбора."],
    [2,"Отмеченные дни","нажатие отмечает или снимает день. С клавишей Shift отмечаются все дни подряд от предыдущего."],
    [3,"Все дни со сменами","общий флажок; когда отмечены все — «Снять выбор»."],
    [4,"Смены выбранных дней","только выбранного ПВЗ. Снимите флажок у смены, которую удалять не нужно."],
    [5,"Предупреждение","если среди смен есть закрытый или выплаченный период."],
    [6,"Добавить смену на N дней","форма новой смены сразу со всеми отмеченными датами."],
    [7,"Удалить N смен","удаление с подтверждением."]
  ]))
});

page({
  key:"control",
  section:"Смены",
  title:"Контроль",
  lead:"Контроль показывает все ПВЗ месяца одной таблицей — чтобы сразу увидеть, где прошли дни без смен.",
  body:stack(fig("13-control",{w:BODY_W,h:112}),`
    ${legend([
      [1,"Строка ПВЗ","смен за месяц и сколько дней прошло без смен."],
      [2,"День без смен","розовая клетка с пунктиром: день прошёл, смены нет."],
      [3,"Сегодня","выделено рамкой; дни после него — пустые."]
    ])}
    ${note("Нажмите на любую клетку — откроется этот день в календаре выбранного ПВЗ.")}
  `)
});

/* ---------- 3. Итоги ---------- */

page({
  key:"stats",
  section:"Итоги",
  title:"Итоги месяца",
  lead:"«Итоги» открываются общей картиной по команде. Выберите сотрудника, чтобы увидеть его расчёт, — блоки останутся те же.",
  body:split(fig("14-stats",{w:165,h:150}),`
    ${legend([
      [1,"Сотрудник","«Все сотрудники» — вся команда; выберите человека для его расчёта."],
      [2,"Начислено","сумма за месяц, число смен и сотрудников."],
      [3,"Выплата 25-го","за 1–15 число. Справа — состояние периода и сумма к выплате."],
      [4,"Выплата 10-го","следующего месяца, за 16-е число и до конца месяца."],
      [5,"За месяц","смены, премии, штрафы и итог."]
    ])}
    ${note("<b>Аванс.</b> На ПВЗ с включённым авансом выплата 25-го — не больше 20 000 ₽ на сотрудника; остальное переносится на выплату 10-го.")}
    ${note("Строка выплаты раскрывается нажатием: в режиме «Все сотрудники» — подробности периода ({{period}}), у сотрудника — его выплата ({{person}}).")}
  `)
});

page({
  key:"period",
  section:"Итоги",
  title:"Расчётный период: проверка, закрытие, выплата",
  lead:"Период — половина месяца, общая для всей команды. Работа с ним — в раскрытой строке выплаты в режиме «Все сотрудники».",
  body:split(fig("15-period",{w:160,h:150}),`
    ${legend([
      [1,"Строка периода","нажмите, чтобы раскрыть или свернуть."],
      [2,"Сотрудники","кому сколько причитается и сколько выплачено. Нажатие открывает расчёт человека."],
      [3,"Проверка","«Все готовы» или «Вопросы по N из M». Нажмите, чтобы увидеть вопросы; каждый ведёт к нужной смене или выплате."],
      [4,"Отчёт · Подробно","документ по периоду ({{report}})."],
      [5,"Действие","следующий шаг по состоянию периода — таблица на {{states}}."]
    ])}
    ${note("Порядок работы: проверить вопросы → «Проверено» → «Закрыть период» → записать выплаты → «Отметить выплаченным».")}
  `)
});

page({
  key:"states",
  section:"Итоги",
  title:"Состояния периода и изменения после закрытия",
  lead:"Состояние видно справа в строке периода. Оно меняется кнопками в раскрытой строке и само — если данные разошлись.",
  body:`
    <div class="split">
      <div class="side grow">
        <table class="states">
          <thead><tr><th>Состояние</th><th>Что значит</th><th>Доступные действия</th></tr></thead>
          <tbody>
            <tr><td><span class="st">В работе</span></td><td>Период ещё правится.</td><td>Проверено</td></tr>
            <tr><td><span class="st gold">Проверено</span></td><td>Цифры сверены администратором.</td><td>Закрыть период · Вернуть в работу</td></tr>
            <tr><td><span class="st green">Закрыто</span></td><td>Расчёт зафиксирован. Правки — только с подтверждением.</td><td>Отметить выплаченным · Вернуть в работу</td></tr>
            <tr><td><span class="st green">Выплачено</span></td><td>Выплаты записаны. Без записанных выплат отметить нельзя.</td><td>Вернуть в работу</td></tr>
            <tr><td><span class="st rust">Данные изменились</span></td><td>После проверки изменились суммы.</td><td>Проверено — проверить заново</td></tr>
            <tr><td><span class="st rust">Есть расхождение</span></td><td>Период выплачен, но суммы уже не сходятся.</td><td>Сверить выплаты</td></tr>
          </tbody>
        </table>
        ${note("<b>Недоплата</b> — выплачено меньше, чем причитается; <b>переплата</b> — больше. Метки появляются под строкой периода и у каждого сотрудника. «Не выплачено» в открытом периоде недоплатой не считается.")}
        ${note("<b>История изменений</b> в раскрытой строке показывает, что и когда менялось в периоде.")}
      </div>
      <div class="side narrow">
        ${fig("18-closed",{w:92,h:80})}
        ${legend([
          [1,"Изменение в закрытом периоде","приложение предупреждает, что период закрыт или выплачен, и объясняет последствия."],
          [2,"Изменить","правка сохранится и попадёт в историю периода."]
        ])}
      </div>
    </div>
  `
});

page({
  key:"person",
  section:"Итоги",
  title:"Расчёт сотрудника и отметка выплаты",
  lead:"Выберите сотрудника вверху «Итогов» или нажмите на него в раскрытом периоде. Раскройте нужную выплату.",
  body:stack(fig("16-person",{w:BODY_W,h:100}),legend2([
    [1,"Выплата","состояние («Не выплачено», «Частично выплачено», «Выплачено») и сумма."],
    [2,"Из чего сформирована сумма","смены этой выплаты с суммами."],
    [3,"Отметить выплату","сумма, дата выплаты и комментарий. Можно частями — кнопка станет «Добавить часть выплаты»."],
    [4,"Сохранить","выплата появится в списке записей; ошибочную запись удалите крестиком."],
    [5,"Период команды","его состояние, отчёт по сотруднику и переход к «Все сотрудники»."]
  ]))
});

page({
  key:"report",
  section:"Итоги",
  title:"Отчёты и PDF",
  lead:"Отчёт — документ по периоду для сверки и хранения. Он строится из тех же данных, что и экран.",
  body:stack(fig("17a-report",{w:BODY_W,h:100}),`
    ${legend([
      [1,"Отчёт","свод по сотрудникам: смены, начислено, выплачено, остаток."],
      [2,"Подробно","то же и смены каждого сотрудника."],
      [3,"Отчёт по сотруднику","в раскрытой выплате сотрудника — только его расчёт."]
    ])}
    ${note("Отчёт открывается в новом окне. Чтобы сохранить PDF: <b>⌘P</b> (или «Печать») → «Сохранить как PDF». Если период закрыт, а расчёт потом меняли, отчёт укажет, на какую сумму период был закрыт.")}
  `)
});

/* ---------- 4. Управление ---------- */

page({
  key:"employees",
  section:"Управление",
  title:"Сотрудники",
  lead:"«Управление» открывается двумя пунктами: «Сотрудники» и «Пункты выдачи и тарифы». Нажмите нужный.",
  body:split(fig("20-employees",{w:150,h:150}),legend([
    [1,"Назад","вернуться в «Управление»."],
    [2,"Добавить сотрудника","форма на {{new-employee}}."],
    [3,"Архив","сотрудники со статусом «В архиве»."],
    [4,"Поиск и фильтр","по имени, телефону, почте; фильтр — по ПВЗ."],
    [5,"Сотрудник","ПВЗ и аккаунт. Нажмите, чтобы открыть карточку."]
  ]))
});

page({
  key:"new-employee",
  section:"Управление",
  title:"Новый сотрудник",
  lead:"Достаточно ФИО и хотя бы одного ПВЗ. Остальное можно заполнить позже.",
  body:split(fig("21-employee-new",{w:140,h:150}),legend([
    [1,"ФИО и телефон","ФИО обязательно."],
    [2,"Реквизиты для переводов","телефон, банк и получатель — для выплат."],
    [3,"Аккаунт","«Без аккаунта» — смены и расчёты работают и так. «Создать аккаунт» — почта и пароль: сотрудник сможет входить и видеть свои смены и выплаты."],
    [4,"Пункты выдачи","где сотрудник работает. От этого зависит, в каких ПВЗ его можно выбрать в смене."],
    [5,"Готово","сохранить."]
  ]))
});

page({
  key:"employee-card",
  section:"Управление",
  title:"Карточка сотрудника",
  lead:"Карточка открывается для просмотра; «Изменить» переводит её в редактирование.",
  body:split(fig("22a-employee-card",{w:140,h:150}),legend([
    [1,"Изменить","редактирование карточки."],
    [2,"Реквизиты для переводов","куда перечислять выплаты."],
    [3,"Пункты выдачи","с тарифом или индивидуальной ставкой на каждом ({{rate}})."]
  ]))
});

page({
  key:"rate",
  section:"Управление",
  title:"Редактирование и индивидуальная ставка",
  lead:"В редактировании меняются аккаунт и пункты выдачи, а на каждом пункте можно задать сотруднику свою ставку.",
  body:split(fig("22b-employee-rate",{w:140,h:150}),legend([
    [1,"Аккаунт","почта и новый пароль. Пустой пароль оставляет текущий."],
    [2,"Ставка на ПВЗ","нажмите «По тарифу ПВЗ», чтобы задать сотруднику свою ставку на этом пункте."],
    [3,"Задать ставку","действует с указанной даты. Уже сохранённые смены не меняются."],
    [4,"Удалить сотрудника","только если у него нет смен. Иначе переведите его в «В архиве» — история сохранится."]
  ]))
});

page({
  key:"points",
  section:"Управление",
  title:"Пункты выдачи",
  lead:"У каждого ПВЗ — статус, аванс и тариф с историей.",
  body:pair(`
    ${fig("23-points",{w:150,h:108})}
    ${legend([
      [1,"Добавить ПВЗ","открывает форму нового пункта."],
      [2,"Архив","пункты со статусом «В архиве»."],
      [3,"Пункт","сотрудники, тариф и отметка «Аванс». Нажмите, чтобы открыть."]
    ])}
  `,`
    ${fig("24a-point-card",{w:BODY_W-150-10,h:108})}
    ${legend([
      [1,"Изменить","редактирование пункта и тарифа ({{tariff}})."],
      [2,"Текущий тариф","тип, ставка и с какой даты действует."],
      [3,"История тарифов","прежние тарифы с датами."]
    ])}
  `,{ratio:[150,BODY_W-150-10]})
});

page({
  key:"tariff",
  section:"Управление",
  title:"Тариф ПВЗ",
  lead:"Тариф бывает фиксированный или по ШК. Новый тариф действует с выбранной даты; прежний остаётся в истории.",
  body:pair(`
    ${fig("24b-point-edit",{w:(BODY_W-10)/2,h:104})}
    ${legend([
      [1,"Статус","«В архиве» скрывает пункт из выбора, смены сохраняются."],
      [2,"Аванс","включает ограничение выплаты 25-го ({{stats}})."],
      [3,"Изменить текущий тариф","исправить ошибку в действующем тарифе без новой записи в истории."],
      [4,"Новый тариф","с новой даты; прежний уйдёт в историю."],
      [5,"Удалить ПВЗ","навсегда, вместе со сменами; нужно набрать название. Обычно достаточно архива."]
    ])}
  `,`
    ${fig("24c-tariff-shk",{w:(BODY_W-10)/2,h:104})}
    ${legend([
      [1,"Фикс / По ШК","фиксированная ставка за смену или ставка по количеству ШК."],
      [2,"Действует с","дата начала тарифа."],
      [3,"Границы и ставки","«ШК до» — верхняя граница; до неё действует ставка справа."],
      [4,"Добавить границу","следующая ступень."],
      [5,"Добавить тариф","сохранить. Для исправления — «Сохранить тариф»."]
    ])}
  `)
});

page({
  key:"recalc",
  section:"Управление",
  title:"Перерасчёт смен после изменения тарифа",
  lead:"Если новый тариф затрагивает уже сохранённые смены, приложение покажет их и спросит, что сделать с каждой.",
  body:split(fig("25-recalc",{w:140,h:150}),`
    ${legend([
      [1,"Сводка","сколько смен затронуто, что с ними будет и разница в сумме."],
      [2,"По каждой смене","<i>Пересчитать</i> — по новому тарифу; <i>Оставить</i> — прежняя сумма; <i>Своя сумма</i> — ввести вручную."],
      [3,"Применить","сохранить решения. «Отмена» — смены останутся как были, тариф сохранится."]
    ])}
    ${note("Старая сумма показана зачёркнутой, новая — под ней. Смены закрытых и выплаченных периодов попадут в историю периода.")}
  `)
});

/* ---------- 5. Данные ---------- */

page({
  key:"data",
  section:"Данные",
  title:"Данные, экспорт и выход",
  lead:"Здесь видно, есть ли связь с сервером, можно скачать резервную копию и выйти из аккаунта.",
  body:stack(fig("26-data",{w:BODY_W,h:100}),`
    ${legend([
      [1,"Синхронизация","«Синхронизация в реальном времени» — изменения других пользователей появляются сами."],
      [2,"Скачать экспорт","файл с рабочими данными: смены, ПВЗ, тарифы, сотрудники с контактами и реквизитами. Храните его как резервную копию в надёжном месте."],
      [3,"Выйти","завершить сеанс на этом устройстве."]
    ])}
    ${note("Нет связи — приложение продолжает показывать последние данные и само обновится, когда сеть вернётся. Если сохранить не удалось, повторите действие.")}
  `)
});

page({
  key:"faq",
  section:"Справка",
  title:"Термины и частые вопросы",
  lead:"",
  cls:"glossary",
  body:`
    <div class="pair text">
      <div class="col">
        <dl class="terms">
          <dt>Расчётный период</dt><dd>Половина месяца: 1–15 (выплата 25-го) или с 16-го до конца месяца (выплата 10-го следующего месяца). Общий для всей команды.</dd>
          <dt>Аванс</dt><dd>Настройка ПВЗ: выплата 25-го не больше 20 000 ₽ на сотрудника, остаток — 10-го.</dd>
          <dt>Основная и дополнительная смена</dt><dd>Тип смены; оба типа оплачиваются по тарифу.</dd>
          <dt>Корректировка оклада</dt><dd>Своя сумма за смену вместо тарифа, с обязательной причиной.</dd>
          <dt>Индивидуальная ставка</dt><dd>Ставка сотрудника на конкретном ПВЗ вместо тарифа пункта, с даты.</dd>
          <dt>Недоплата / переплата</dt><dd>Разница между тем, что причитается, и записанными выплатами.</dd>
          <dt>Архив</dt><dd>Скрывает сотрудника или ПВЗ из выбора; история и смены сохраняются.</dd>
        </dl>
      </div>
      <div class="col">
        <div class="faq">
          <h4>Как исправить смену в закрытом периоде?</h4>
          <p>Откройте смену, нажмите «Изменить», внесите правку и «Готово». Приложение попросит подтвердить изменение закрытого периода — правка попадёт в его историю.</p>
          <h4>Как быстро убрать ошибочно созданные смены?</h4>
          <p>В реестре — «Выбрать», отметьте смены, «Удалить». В календаре — «Выбрать дни», отметьте дни, снимите лишние смены и «Удалить».</p>
          <h4>Почему после изменения тарифа суммы смен не поменялись?</h4>
          <p>Сохранённая смена хранит свою цену. Пересчитать можно в окне перерасчёта сразу после смены тарифа или в карточке смены — «Пересчитать по текущему тарифу».</p>
          <h4>Как посмотреть расчёт одного человека?</h4>
          <p>«Итоги» → «Сотрудник» → выберите человека. Вернуться к команде — «Все сотрудники».</p>
          <h4>Как сохранить отчёт в PDF?</h4>
          <p>«Итоги» → раскройте период → «Отчёт» или «Подробно» → ⌘P → «Сохранить как PDF».</p>
        </div>
      </div>
    </div>
  `
});

/* ---------- ссылки «с. N» ---------- */

const numberOf=new Map(pages.map((p,i)=>[p.key,i+1]).filter(([key])=>key));

const unknown=new Set();
const withRefs=text=>text.replace(/\{\{([a-z-]+)\}\}/g,(_,key)=>{
  if(!numberOf.has(key)){
    unknown.add(key);
    return "с. ?";
  }
  return `<a class="ref" href="#p${numberOf.get(key)}">с.&nbsp;${numberOf.get(key)}</a>`;
});

for(const p of pages){
  if(p.body){
    p.body=withRefs(p.body);
  }
}

if(unknown.size){
  throw new Error("нет страниц для ссылок: "+[...unknown].join(", "));
}

/* ---------- сборка HTML ---------- */

const contentPages=pages
  .map((p,i)=>({...p,number:i+1}))
  .filter(p=>p.title && p.toc);

const sections=[];
for(const p of contentPages){
  let s=sections.find(x=>x.name===p.section);
  if(!s){s={name:p.section,items:[]};sections.push(s);}
  s.items.push(p);
}

const total=pages.length;

function footer(n){
  return `<footer><span>Shift Register · Инструкция администратора</span><span>${n} / ${total}</span></footer>`;
}

const html=`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Инструкция по использованию Shift Register</title>
<style>
@page{size:297mm 210mm;margin:0}
:root{
  --bg:#F2F1EE;--surf:#FFFFFF;--mat:#E7E5E0;--line:rgba(0,0,0,.08);--line2:rgba(0,0,0,.12);
  --ink:#171614;--ink2:#45433F;--ink3:#6E6B66;
  --gold:#8F6A31;--gold-soft:rgba(143,106,49,.09);--gold-line:rgba(143,106,49,.32);
  --rust:#A4534A;--green:#3F7A4E;--accent:${ACCENT};
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:297mm;height:210mm;padding:13mm 15mm 11mm;position:relative;overflow:hidden;
  page-break-after:always;break-after:page;display:flex;flex-direction:column}
.page:last-child{page-break-after:auto;break-after:auto}
.top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4mm}
.ml{font-size:8.5pt;font-weight:700;letter-spacing:.19em;text-transform:uppercase;color:var(--ink3)}
.brand{font-size:8pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
h2{margin:0 0 2mm;font-size:21pt;font-weight:600;letter-spacing:-.3px}
.lead{margin:0 0 6mm;max-width:250mm;color:var(--ink2);font-size:10.5pt;line-height:1.45}
.body{flex:1;min-height:0}
footer{position:absolute;left:15mm;right:15mm;bottom:6mm;display:flex;justify-content:space-between;
  font-size:7.5pt;color:var(--ink3);letter-spacing:.02em}
a.ref{color:inherit;text-decoration:none;white-space:nowrap}

/* раскладки */
.split{display:flex;gap:${GAP}mm;height:100%;min-height:0;align-items:flex-start}
.split .figcol{flex:none}
.split .side{flex:1;min-width:0;display:flex;flex-direction:column;gap:3.4mm;align-self:stretch}
.split .side.grow{flex:1.6}
.split .side.narrow{flex:1;align-items:flex-start}
.pair{display:flex;gap:10mm;height:100%;min-height:0}
.pair .col{min-width:0;display:flex;flex-direction:column;gap:3.4mm}
.pair .col > .fig{margin-bottom:3mm}
.stack{display:flex;flex-direction:column;gap:7mm}
.figrow{display:flex;justify-content:center}
.row3{display:flex;gap:10mm;align-items:flex-start}
.row3 .legend{flex:2}
.row3 .note{flex:1}
.subfig{display:flex;flex-direction:column;gap:4mm;margin-top:auto;padding-top:5mm;border-top:1px solid var(--line)}
.caption{margin:0;font-size:9pt;color:var(--ink2);line-height:1.4}

/* снимки */
.fig{position:relative;flex:none}
.fig.mat{background:var(--mat);border-radius:5mm}
.shot{position:absolute}
.shot .clip{position:absolute;inset:0;overflow:hidden}
.shot img{display:block;width:100%;height:100%}
.shot .shade{position:absolute;left:0;right:0;box-shadow:0 .6mm 3mm rgba(0,0,0,.09),0 0 0 .25mm rgba(0,0,0,.07)}
.shot.window .clip::after,.shot.panel .clip::after{content:"";position:absolute;inset:0;border-radius:inherit;
  box-shadow:inset 0 0 0 .25mm rgba(0,0,0,.08);pointer-events:none}
.shot .marks{position:absolute;inset:0}
.mbox{position:absolute;border:${STROKE}mm solid var(--accent);box-sizing:border-box}
.mbadge{position:absolute;width:${BADGE}mm;height:${BADGE}mm;border-radius:50%;background:var(--accent);color:#fff;
  font-size:8.2pt;font-weight:700;font-style:normal;display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 .6mm #fff,0 .4mm 1.2mm .6mm rgba(0,0,0,.12)}

/* пояснения */
.legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2.2mm}
.legend li{display:flex;gap:2.6mm;align-items:flex-start;font-size:9.6pt;line-height:1.38;color:var(--ink2)}
.legend b{color:var(--ink);font-weight:600}
.legend i{font-style:normal;color:var(--ink)}
.legend.cols{display:grid;grid-template-columns:1fr 1fr;column-gap:10mm;row-gap:2.2mm}
.badge{flex:none;width:${BADGE}mm;height:${BADGE}mm;border-radius:50%;background:var(--accent);color:#fff;
  font-size:8.2pt;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:.1mm}
.note{background:var(--surf);border:1px solid var(--line);border-radius:3.4mm;padding:2.8mm 3.6mm;
  font-size:9pt;line-height:1.42;color:var(--ink2)}
.note b{color:var(--ink)}

table.states{width:100%;border-collapse:separate;border-spacing:0;background:var(--surf);border:1px solid var(--line);
  border-radius:3.4mm;overflow:hidden;font-size:9.4pt;margin-bottom:3mm}
table.states th{text-align:left;font-size:7.8pt;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);
  font-weight:700;padding:2.6mm 3mm;border-bottom:1px solid var(--line)}
table.states td{padding:2.4mm 3mm;border-bottom:1px solid var(--line);color:var(--ink2);vertical-align:top;line-height:1.35}
table.states tr:last-child td{border-bottom:0}
.st{font-weight:650;color:var(--ink3);white-space:nowrap}
.st.gold{color:var(--gold)}.st.green{color:var(--green)}.st.rust{color:var(--rust)}

/* обложка */
.cover{background:var(--bg);padding:0;flex-direction:row}
.cover .left{flex:0 0 118mm;padding:22mm 16mm 16mm;display:flex;flex-direction:column}
.cover .brand{font-size:10pt}
.cover h1{margin:12mm 0 5mm;font-size:34pt;line-height:1.05;letter-spacing:-.8px;font-weight:650}
.cover .sub{font-size:12pt;line-height:1.45;color:var(--ink2)}
.cover .meta{margin-top:auto;font-size:9pt;color:var(--ink3);line-height:1.6}
.cover .meta b{color:var(--ink2);font-weight:600}
.cover .right{flex:1;position:relative;overflow:hidden}
.cover .right .window{position:absolute;left:0;top:24mm;width:205mm;border-radius:5mm 0 0 5mm;overflow:hidden;
  box-shadow:0 3mm 12mm rgba(0,0,0,.10),0 0 0 .25mm rgba(0,0,0,.08)}
.cover .right img{display:block;width:100%}
.rule{width:18mm;height:2px;background:var(--gold);margin-top:6mm}

/* оглавление */
.toc{display:flex;gap:10mm}
.toc .col{flex:1}
.toc h3{margin:0 0 2.5mm;font-size:8.5pt;font-weight:700;letter-spacing:.19em;text-transform:uppercase;color:var(--gold)}
.toc .card{background:var(--surf);border:1px solid var(--line);border-radius:3.4mm;margin-bottom:5mm;overflow:hidden}
.toc a{display:flex;justify-content:space-between;gap:4mm;padding:1.6mm 3.6mm;border-top:1px solid var(--line);
  color:var(--ink);text-decoration:none;font-size:10pt}
.toc a:first-child{border-top:0}
.toc a span:last-child{color:var(--ink3);font-variant-numeric:tabular-nums}
.howto{display:flex;flex-direction:column;gap:3mm}

/* справка */
.text .col{flex:1;gap:0}
.terms{margin:0;background:var(--surf);border:1px solid var(--line);border-radius:3.4mm;padding:1mm 4mm}
.terms dt{font-weight:600;font-size:10pt;margin-top:2.6mm}
.terms dd{margin:.8mm 0 2.6mm;font-size:9.4pt;color:var(--ink2);line-height:1.4;padding-bottom:2.4mm;border-bottom:1px solid var(--line)}
.terms dd:last-child{border-bottom:0}
.faq{background:var(--surf);border:1px solid var(--line);border-radius:3.4mm;padding:2mm 4.5mm}
.faq h4{margin:3mm 0 1mm;font-size:10pt;font-weight:600}
.faq p{margin:0 0 2.5mm;font-size:9.4pt;color:var(--ink2);line-height:1.42;padding-bottom:2.5mm;border-bottom:1px solid var(--line)}
.faq p:last-child{border-bottom:0}
</style>
</head>
<body>
${pages.map((p,i)=>{
  const n=i+1;

  if(p.cover){
    return `<section class="page cover">
      <div class="left">
        <div class="brand">Shift Register</div>
        <h1>Инструкция администратора</h1>
        <div class="sub">Учёт смен, выплат и расчётных периодов — по шагам, со скриншотами.</div>
        <div class="rule"></div>
        <div class="meta">
          <div><b>Разделы:</b> Смены · Итоги · Управление · Данные</div>
          <div>Скриншоты сделаны на демонстрационных данных: имена, пункты и суммы вымышлены.</div>
          <div>Сентябрь 2026</div>
        </div>
      </div>
      <div class="right"><div class="window"><img src="shots/00-cover.png" alt=""></div></div>
    </section>`;
  }

  if(p.contents){
    const half=Math.ceil(sections.length/2);
    const col=list=>list.map(s=>`
      <h3>${esc(s.name)}</h3>
      <div class="card">
        ${s.items.map(it=>`<a href="#p${it.number}"><span>${esc(it.title)}</span><span>${it.number}</span></a>`).join("")}
      </div>`).join("");
    return `<section class="page" id="p${n}">
      <div class="top"><div class="ml">Содержание</div><div class="brand">Shift Register</div></div>
      <h2>Содержание</h2>
      <div class="toc body">
        <div class="col">${col(sections.slice(0,half))}</div>
        <div class="col">${col(sections.slice(half))}
          <h3>Как читать инструкцию</h3>
          <div class="howto">
            <div class="note">Оранжевые номера на скриншотах совпадают с номерами в пояснениях рядом.</div>
            <div class="note">Ссылки вида «с. 12» ведут на страницу инструкции с подробностями.</div>
          </div>
        </div>
      </div>
      ${footer(n)}
    </section>`;
  }

  return `<section class="page ${p.cls}" id="p${n}">
    <div class="top"><div class="ml">${esc(p.section)}</div><div class="brand">Shift Register</div></div>
    <h2>${esc(p.title)}</h2>
    ${p.lead ? `<p class="lead">${esc(p.lead)}</p>` : ""}
    <div class="body">${p.body}</div>
    ${footer(n)}
  </section>`;
}).join("\n")}
</body>
</html>`;

writeFileSync(OUT+"manual.html",html);

/* ---------- проверки ---------- */

const small=scales.filter(s=>s.pt<4.7);
console.log("снимки (кегль текста приложения на бумаге):");
for(const s of scales){
  console.log(`  ${s.name.padEnd(20)} ${s.pt.toFixed(1)} pt${s.pt<4.7 ? "  ← мелко" : ""}`);
}

const browser=await chromium.launch();
const page2=await browser.newPage();
await page2.goto("file://"+OUT+"manual.html");
await page2.waitForLoadState("networkidle");
await page2.evaluate(()=>document.fonts.ready);

/* Ни одна страница не переполнена, номера не вылезают за край листа. */
const problems=await page2.evaluate(()=>[...document.querySelectorAll(".page")].flatMap((p,i)=>{
  const out=[];
  const body=p.querySelector(".body");
  const footer=p.querySelector("footer");
  const pr=p.getBoundingClientRect();
  if(body && footer){
    const last=[...body.querySelectorAll("*")].reduce((m,e)=>Math.max(m,e.getBoundingClientRect().bottom),0);
    const limit=footer.getBoundingClientRect().top-4;
    if(last>limit) out.push(`стр. ${i+1}: вылезает вниз на ${Math.round(last-limit)}px`);
  }
  for(const b of p.querySelectorAll(".mbadge,.mbox")){
    const r=b.getBoundingClientRect();
    if(r.left<pr.left+20 || r.right>pr.right-20) out.push(`стр. ${i+1}: отметка «${b.textContent}» у края листа`);
  }
  return out;
}));

console.log(problems.length ? problems.join("\n") : "без переполнения");
console.log(`страниц: ${pages.length}`);

if(OUT_PDF){
  await page2.pdf({path:OUT_PDF,width:"297mm",height:"210mm",printBackground:true,preferCSSPageSize:true});
  console.log("pdf:",OUT_PDF);
}

await browser.close();
process.exit(problems.length || small.length ? 1 : 0);
