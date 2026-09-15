/*
  Числа, деньги и русские числительные в одном месте: раньше каждая
  подсистема носила собственную копию форматирования, и они расходились.
*/

const NBSP=" ";

function withNonBreakingSpaces(value){
  return value.replace(/\s/g,NBSP);
}

export function formatNumber(number){
  const value=Number(number);

  if(!Number.isFinite(value)){
    return "";
  }

  return withNonBreakingSpaces(
    Math.round(value).toLocaleString("ru-RU")
  );
}

export function formatAmount(number){
  const value=Number(number);

  if(!Number.isFinite(value)){
    return "";
  }

  const cents=Math.round(value*100);

  return withNonBreakingSpaces(
    (cents/100).toLocaleString(
      "ru-RU",
      {
        minimumFractionDigits:
          Math.abs(cents)%100===0
            ? 0
            : 2,
        maximumFractionDigits:2
      }
    )
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
