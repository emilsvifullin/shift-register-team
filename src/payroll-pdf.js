/*
  Документ зарплатного отчёта.

  Здесь только вёрстка: на вход приходит готовая модель отчёта, на выход
  — самостоятельный HTML-документ, который печатают в PDF. Ни одной
  суммы этот модуль не считает и не округляет заново: всё, что он
  показывает, посчитано там же, где живут деньги приложения.

  Документ деловой и светлый: печать почти всегда чёрно-белая, поэтому
  иерархия держится на типографике и линиях, а не на цвете. Фирменный
  акцент один — золотой волосок под шапкой.
*/

const STYLES=`
  *{box-sizing:border-box;}

  body{
    margin:0;
    padding:32px 36px 40px;

    color:#16171A;
    background:#fff;

    font:400 12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }

  header{
    padding-bottom:14px;
    border-bottom:2px solid #D6B278;
  }

  .brand{
    color:#8C7245;
    font-size:11px;
    font-weight:700;
    letter-spacing:.18em;
    text-transform:uppercase;
  }

  h1{
    margin:6px 0 0;
    font-size:21px;
    font-weight:600;
    letter-spacing:-.4px;
  }

  .meta{
    display:flex;
    flex-wrap:wrap;
    gap:4px 18px;
    margin-top:8px;
    color:#5F6166;
    font-size:11.5px;
  }

  .meta b{
    color:#16171A;
    font-weight:600;
  }

  h2{
    margin:26px 0 10px;
    font-size:11px;
    font-weight:700;
    letter-spacing:.14em;
    text-transform:uppercase;
    color:#5F6166;
  }

  .summary{
    display:grid;
    /* Плиток бывает четыре, пять или шесть — ряд заполняется целиком. */
    grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
    gap:10px;
    margin-top:14px;
  }

  .summary div{
    padding:10px 12px;
    border:1px solid #E3E1DC;
    border-radius:8px;
  }

  .summary span{
    display:block;
    color:#5F6166;
    font-size:10.5px;
  }

  .summary b{
    display:block;
    margin-top:2px;
    font-size:15px;
    font-weight:600;
    letter-spacing:-.3px;
  }

  table{
    width:100%;
    border-collapse:collapse;
  }

  th,td{
    padding:7px 8px;
    border-bottom:1px solid #E3E1DC;
    text-align:right;
    white-space:nowrap;
  }

  th{
    color:#5F6166;
    font-size:10px;
    font-weight:700;
    letter-spacing:.06em;
    text-transform:uppercase;
    border-bottom-width:1.5px;
  }

  th:first-child,
  td:first-child{
    text-align:left;
    white-space:normal;
  }

  tfoot td{
    border-top:1.5px solid #16171A;
    border-bottom:0;
    font-weight:700;
  }

  .person{
    margin-top:22px;
    padding-top:14px;
    border-top:1px solid #E3E1DC;
    page-break-inside:avoid;
  }

  .person h3{
    margin:0;
    font-size:14.5px;
    font-weight:600;
  }

  .person .totals{
    display:flex;
    flex-wrap:wrap;
    gap:4px 16px;
    margin-top:4px;
    color:#5F6166;
    font-size:11.5px;
  }

  .person .totals b{
    color:#16171A;
  }

  .person table{
    margin-top:10px;
  }

  .person h4{
    margin:14px 0 4px;
    font-size:10.5px;
    font-weight:700;
    letter-spacing:.08em;
    text-transform:uppercase;
    color:#5F6166;
  }

  .neg{color:#A8443A;}
  .own{color:#8C7245;}

  footer{
    margin-top:26px;
    padding-top:10px;
    border-top:1px solid #E3E1DC;
    color:#8A8C91;
    font-size:10.5px;
  }

  @page{
    size:A4;
    margin:14mm;
  }

  @media print{
    body{padding:0;}
  }
`;

const money=value=>
  `${Math.round(Number(value) || 0)
    .toLocaleString("ru-RU")
    .replace(/ /g," ")} ₽`;

/* Корректировка бывает и в минус — знак у неё часть смысла. */
const signed=value=>
  (Number(value) || 0)<0
    ? `− ${money(Math.abs(value))}`
    : `+ ${money(value)}`;

const esc=value=>
  String(value ?? "").replace(
    /[&<>"]/g,
    char=>({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;"
    }[char])
  );

function summaryHTML(report){
  const {totals}=report;

  const cells=[
    ["Сотрудников",totals.employees],
    ["Смен",totals.shifts],
    ["Начислено",money(totals.accrued)],
    ["Выплачено",money(totals.paid)]
  ];

  if(totals.unpaid){
    cells.push(["Не выплачено",money(totals.unpaid)]);
  }

  if(totals.overpaid){
    cells.push(["Переплата",money(totals.overpaid)]);
  }

  return `
    <div class="summary">
      ${cells.map(([label,value])=>`
        <div>
          <span>${esc(label)}</span>
          <b>${esc(value)}</b>
        </div>
      `).join("")}
    </div>
  `;
}

/*
  Колонка корректировок появляется, только если они были: пустой столбец
  ради шаблона занимает место и заставляет искать в нём смысл. Пока её
  нет, сумма за смены и есть тариф, и делить её надвое незачем.
*/
function tableHTML(report){
  const withCorrections=report.lines.some(
    line=>line.corrections
  );

  const head=[
    "Сотрудник",
    "Смены",
    withCorrections ? "По тарифу" : "За смены",
    ...(withCorrections ? ["Корректировки"] : []),
    "Премии",
    "Штрафы",
    "Начислено",
    "Выплачено",
    "Остаток"
  ];

  const row=line=>{
    const rest=line.overpaid
      ? `<span class="own">+${money(line.overpaid)}</span>`
      : line.unpaid
        ? `<span class="neg">${money(line.unpaid)}</span>`
        : "—";

    return `
      <tr>
        <td>${esc(line.employeeName)}</td>
        <td>${line.shifts}</td>
        <td>${money(withCorrections ? line.tariffBase : line.base)}</td>
        ${withCorrections
          ? `<td>${line.corrections ? signed(line.corrections) : "—"}</td>`
          : ""}
        <td>${line.bonus ? money(line.bonus) : "—"}</td>
        <td>${line.fine ? money(line.fine) : "—"}</td>
        <td><b>${money(line.accrued)}</b></td>
        <td>${money(line.paid)}</td>
        <td>${rest}</td>
      </tr>
    `;
  };

  const {totals}=report;

  return `
    <table>
      <thead>
        <tr>${head.map(name=>`<th>${esc(name)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${report.lines.map(row).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td>Итого</td>
          <td>${totals.shifts}</td>
          <td>${money(withCorrections ? totals.tariffBase : totals.base)}</td>
          ${withCorrections
            ? `<td>${totals.corrections ? signed(totals.corrections) : "—"}</td>`
            : ""}
          <td>${totals.bonus ? money(totals.bonus) : "—"}</td>
          <td>${totals.fine ? money(totals.fine) : "—"}</td>
          <td>${money(totals.accrued)}</td>
          <td>${money(totals.paid)}</td>
          <td>${
            totals.overpaid
              ? `+${money(totals.overpaid)}`
              : totals.unpaid
                ? money(totals.unpaid)
                : "—"
          }</td>
        </tr>
      </tfoot>
    </table>
  `;
}

/*
  Подробная часть: по каждому сотруднику видно, из чего сложилась сумма.
  Пустые блоки не печатаются — премий не было, значит и заголовка нет.
*/
function personHTML(line){
  const detail=line.detail || {};
  const shifts=detail.shifts || [];
  const bonuses=detail.bonuses || [];
  const fines=detail.fines || [];
  const payouts=detail.payouts || [];

  const shiftRows=shifts.map(shift=>`
    <tr>
      <td>${esc(shift.dateLabel)}</td>
      <td>${esc(shift.point)}</td>
      <td>${esc(shift.typeLabel)}</td>
      <td>${
        shift.rateSource==="employee"
          ? '<span class="own">своя ставка</span>'
          : "тариф ПВЗ"
      }</td>
      <td>${money(shift.rate)}</td>
      <td>${
        shift.manual
          ? `<b>${money(shift.base)}</b> <span class="neg">вручную</span>`
          : money(shift.base)
      }</td>
    </tr>
  `).join("");

  const list=(title,rows)=>rows.length
    ? `
      <h4>${esc(title)}</h4>
      <table>
        <tbody>
          ${rows.map(item=>`
            <tr>
              <td>${esc(item.label)}</td>
              <td>${money(item.amount)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : "";

  return `
    <div class="person">
      <h3>${esc(line.employeeName)}</h3>

      <div class="totals">
        <span>Смен <b>${line.shifts}</b></span>
        <span>Начислено <b>${money(line.accrued)}</b></span>
        <span>Выплачено <b>${money(line.paid)}</b></span>
        ${line.unpaid ? `<span>Не выплачено <b>${money(line.unpaid)}</b></span>` : ""}
        ${line.overpaid ? `<span>Переплата <b>${money(line.overpaid)}</b></span>` : ""}
      </div>

      ${shiftRows ? `
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>ПВЗ</th>
              <th>Тип</th>
              <!--
                Колонка «Ставка» держала слово «тариф ПВЗ», а сама ставка
                стояла под «Размером». Человек, который ищет в документе
                ставку, находил в ней не число.
              -->
              <th>Основание</th>
              <th>Ставка</th>
              <th>Сумма</th>
            </tr>
          </thead>
          <tbody>${shiftRows}</tbody>
        </table>
      ` : ""}

      ${list("Премии",bonuses)}
      ${list("Штрафы",fines)}
      ${list("Выплаты",payouts)}
    </div>
  `;
}

export function payrollReportDocument(report,{detailed=false}={}){
  const title=detailed
    ? "Зарплата за период — подробно"
    : "Зарплата за период";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${esc(report.fileName || title)}</title>
<style>${STYLES}</style>
</head>
<body>
  <header>
    <div class="brand">Shift Register</div>
    <h1>${esc(title)}</h1>
    <div class="meta">
      <span>Период <b>${esc(report.monthLabel)}, ${esc(report.periodLabel)}</b></span>
      <span>Состояние <b>${esc(report.statusLabel)}</b></span>
      <span>Сформирован <b>${esc(report.generatedAt)}</b></span>
      ${report.employeeId && report.lines[0]
        ? `<span>Сотрудник <b>${esc(report.lines[0].employeeName)}</b></span>`
        : ""}
    </div>
  </header>

  ${summaryHTML(report)}

  <h2>Свод по сотрудникам</h2>
  ${tableHTML(report)}

  ${detailed ? report.lines.map(personHTML).join("") : ""}

  <footer>
    Суммы соответствуют разделу выплат Shift Register за этот период.
  </footer>
</body>
</html>`;
}
