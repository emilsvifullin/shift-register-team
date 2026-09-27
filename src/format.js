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

  const cents=Math.round(value*100);

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
