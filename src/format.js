/*
  Числа, деньги и русские числительные в одном месте: раньше каждая
  подсистема носила собственную копию форматирования, и они расходились.
*/

const NBSP=" ";

/*
  Форматировщики создаются один раз.

  toLocaleString() и new Intl.NumberFormat() при каждом вызове заново
  разбирают локаль и настройки — и это самая дорогая часть отрисовки
  списка: на экране со всеми сменами месяца форматирование съедало
  почти половину времени перерисовки. Настроек всего две, и обе
  известны заранее.
*/
const WHOLE=new Intl.NumberFormat("ru-RU",{
  maximumFractionDigits:0
});

const EXACT=new Intl.NumberFormat("ru-RU",{
  minimumFractionDigits:2,
  maximumFractionDigits:2
});

function withNonBreakingSpaces(value){
  return value.replace(/\s/g,NBSP);
}

/*
  Денежный контракт проекта — копейки.

  В базе каждая сумма — numeric(12,2), ввод принимает два знака после
  запятой, и сервер отказывает третьему. Значит, и всякое округление
  денег — до копейки, одно на все слои: отчёт, PDF, проверка периода и
  перерасчёт округляли до рубля каждый сам, и 1 500,50 ₽ выплаты
  превращались в документе в 1 501 ₽.

  Целый рубль остаётся там, где он — правило расчёта, а не формат:
  стоимость неполной смены округляется до рубля при её расчёте (calc).

  Сначала 15 значащих цифр, потом округление: 1,005 в двоичной записи
  чуть меньше самого себя, и прямое Math.round(1.005*100) дало бы 1,00.
*/
export function roundMoney(value){
  const number=Number(value);

  if(!Number.isFinite(number)){
    return 0;
  }

  const cents=Math.round(
    Number((number*100).toPrecision(15))
  );

  return cents/100 || 0;
}

export function formatNumber(number){
  const value=Number(number);

  if(!Number.isFinite(value)){
    return "";
  }

  return withNonBreakingSpaces(
    WHOLE.format(Math.round(value))
  );
}

export function formatAmount(number){
  const value=Number(number);

  if(!Number.isFinite(value)){
    return "";
  }

  const cents=Math.round(roundMoney(value)*100);

  return withNonBreakingSpaces(
    (Math.abs(cents)%100===0 ? WHOLE : EXACT)
      .format(cents/100)
  );
}

export function formatMoney(number){
  const amount=formatAmount(number);

  return amount
    ? `${amount}${NBSP}₽`
    : "";
}

/*
  Русские формы числительного: 1 смена, 2 смены, 5 смен.
*/
export function pluralForm(count,[one,few,many]){
  const absolute=Math.abs(Number(count)) || 0;
  const last=absolute%10;
  const lastTwo=absolute%100;

  if(last===1 && lastTwo!==11){
    return one;
  }

  if(
    last>=2 &&
    last<=4 &&
    (lastTwo<10 || lastTwo>=20)
  ){
    return few;
  }

  return many;
}

export function plural(count,forms){
  return `${count} ${pluralForm(count,forms)}`;
}

/*
  Дни месяца одной строкой: «2, 3 сентября», «2–5, 9, 16 сентября».

  Подряд идущие дни от трёх сжимаются в диапазон, два соседних остаются
  через запятую — «2–3» читается как «со второго по третье» и ничего не
  экономит. Подпись нужна там, где человек соглашается на действие над
  выбранными днями, и прежняя «первый–последний» врала бы про дни,
  выбранные вразброс: «2–16» при выбранных 2, 9 и 16.

  Когда кусков больше пяти, перечисление уже не читается, и подпись
  честно говорит о границах и числе дней.
*/
export function formatDayList(days,month=""){
  const sorted=[...new Set(
    days
      .map(Number)
      .filter(Number.isFinite)
  )].sort((first,second)=>first-second);

  if(!sorted.length){
    return "";
  }

  const runs=[];

  for(const day of sorted){
    const last=runs.at(-1);

    if(last && day===last[1]+1){
      last[1]=day;
    }else{
      runs.push([day,day]);
    }
  }

  const parts=runs.flatMap(([from,to])=>
    to-from>=2
      ? [`${from}–${to}`]
      : from===to
        ? [String(from)]
        : [String(from),String(to)]
  );

  const tail=month ? ` ${month}` : "";

  if(parts.length>5){
    return `${sorted[0]}–${sorted.at(-1)}${tail}, ${plural(
      sorted.length,
      ["день","дня","дней"]
    )}`;
  }

  return parts.join(", ")+tail;
}
