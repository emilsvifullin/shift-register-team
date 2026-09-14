/*
  Классический скрипт, выполняемый до разметки: единственная его задача —
  не дать странице работать внутри чужого фрейма.

  Раньше этот же файл ещё и подставлял в <head> шесть модулей во время
  работы, поэтому граф зависимостей приложения существовал только в
  рантайме: его не видели ни modulepreload, ни service worker, ни тесты,
  а порядок загрузки был недетерминированным. Теперь модули подключены
  явно в index.html.
*/

if(globalThis.self!==globalThis.top){
  document.documentElement.style.display=
    "none";

  try{
    globalThis.top.location.replace(
      globalThis.self.location.href
    );
  }catch{}
}
