import {
  expect
} from "@playwright/test";

/*
  Экран в покое — то состояние, в котором человек на него нажимает.

  Переход раздела, листа или раскрытия двигает элементы, а навигация во
  время перехода встаёт в очередь и выполняется после него. Нажатие
  посреди движения проверяет уже не поведение экрана, а то, успела ли
  анимация к этому кадру: на быстрой машине успевает, на загруженном
  раннере CI — нет. Поэтому перед нажатием, которое зависит от
  раскладки, тест ждёт, пока ни одна анимация не идёт и слепок прежнего
  экрана снят.
*/
export async function settleScreen(page){
  await expect
    .poll(()=>page.evaluate(()=>
      document.querySelectorAll(
        'body > main[aria-hidden="true"][inert]'
      ).length+
      document.getAnimations().filter(animation=>
        animation.playState==="running"
      ).length
    ))
    .toBe(0);
}
