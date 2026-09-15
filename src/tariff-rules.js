/*
  Правила версионирования тарифов.

  У ПВЗ есть история тарифов. Редактирование текущего тарифа меняет
  существующую запись, а «новый тариф с даты» создаёт следующую версию и
  оставляет предыдущую в истории. Ограничения на даты одинаковы для
  интерфейса и для сохранения, поэтому живут отдельно от разметки.
*/

export function currentTariffForDate(tariffs,today){
  return [...(tariffs || [])]
    .filter(tariff=>
      tariff.effective_from<=today
    )
    .sort((first,second)=>
      second.effective_from.localeCompare(
        first.effective_from
      )
    )[0] || null;
}

export function assertCurrentTariffDate({
  tariffs,
  tariffId,
  effectiveFrom,
  today
}){
  if(effectiveFrom>today){
    throw new Error(
      "Текущий тариф нельзя перенести в будущее. Используйте «Новый тариф с даты»."
    );
  }

  const previous=(tariffs || [])
    .filter(tariff=>
      tariff.id!==tariffId &&
      tariff.effective_from<=today
    )
    .sort((first,second)=>
      second.effective_from.localeCompare(
        first.effective_from
      )
    )[0];

  if(
    previous &&
    effectiveFrom<=previous.effective_from
  ){
    throw new Error(
      "Дата текущего тарифа должна быть позже предыдущего тарифа."
    );
  }
}

export function assertNewTariffDate({
  tariffs,
  effectiveFrom,
  today
}){
  if(
    (tariffs || []).some(tariff=>
      tariff.effective_from===effectiveFrom
    )
  ){
    throw new Error(
      "На эту дату тариф уже задан."
    );
  }

  const current=currentTariffForDate(
    tariffs,
    today
  );

  if(
    current &&
    effectiveFrom<=current.effective_from
  ){
    throw new Error(
      "Для более ранней даты измените текущий тариф, а не создавайте новый."
    );
  }
}

/*
  Запись из истории редактируется на месте. Её дату можно сдвинуть, но не
  на дату другой версии того же ПВЗ.
*/
export function assertTariffVersionDate({
  tariffs,
  tariffId,
  effectiveFrom
}){
  if(
    (tariffs || []).some(tariff=>
      tariff.id!==tariffId &&
      tariff.effective_from===effectiveFrom
    )
  ){
    throw new Error(
      "На эту дату тариф уже задан."
    );
  }
}

/*
  Сохранение по намерению: изменить существующую запись или создать
  следующую версию.
*/
export function tariffIntentUpdatesRecord(intent){
  return intent==="edit-current" ||
    intent==="edit-version";
}

export function tariffIntentHelp(intent){
  if(intent==="edit-current"){
    return "Редактируется текущий тариф. Новая запись в истории не создаётся.";
  }

  if(intent==="edit-version"){
    return "Редактируется тариф из истории. Новая запись не создаётся.";
  }

  return "Создаётся новая версия тарифа с выбранной даты. Предыдущий тариф останется в истории.";
}
