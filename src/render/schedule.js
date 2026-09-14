/*
  Планирование перерисовки и завершение переходов.

  Обе задачи раньше решались в app.js и обе умели зависать:

  - перерисовка ждала конца анимации опросом setTimeout(60) без верхней
    границы, каждый отложенный рендер заводил свою цепочку, и если
    анимация не завершалась, экран не обновлялся никогда;

  - флаг перехода снимался только по `animation.finished`. На iOS вкладка,
    ушедшая в фон, ставит анимацию на паузу, промис не разрешается, флаг
    остаётся поднятым — и навигация перестаёт отвечать.

  Здесь ожидание одно, идёт по кадрам анимации (в фоне оно
  останавливается вместе с ними) и всегда ограничено сверху.
*/

export const MAX_RENDER_DEFERRAL=900;
export const TRANSITION_TIMEOUT=1200;

export function createDeferredRender({
  shouldDefer,
  render,
  windowRef=globalThis,
  maxDeferral=MAX_RENDER_DEFERRAL,
  now=()=>performance.now()
}){
  let deferred=false;
  let since=0;
  let frame=0;

  const cancel=()=>{
    deferred=false;

    if(frame){
      windowRef.cancelAnimationFrame(frame);
      frame=0;
    }
  };

  const flush=()=>{
    frame=0;

    if(!deferred){
      return;
    }

    if(
      shouldDefer() &&
      now()-since<maxDeferral
    ){
      frame=windowRef.requestAnimationFrame(flush);
      return;
    }

    deferred=false;
    render();
  };

  return ()=>{
    if(!shouldDefer()){
      cancel();
      render();
      return;
    }

    if(deferred){
      return;
    }

    deferred=true;
    since=now();
    frame=windowRef.requestAnimationFrame(flush);
  };
}

export function whenAnimationsSettle(
  animations,
  done,
  {
    windowRef=globalThis,
    timeout=TRANSITION_TIMEOUT
  }={}
){
  let finished=false;

  const finish=()=>{
    if(finished){
      return;
    }

    finished=true;
    windowRef.clearTimeout(timer);
    done();
  };

  const timer=windowRef.setTimeout(
    finish,
    timeout
  );

  void Promise.allSettled(
    animations.map(animation=>
      animation.finished
    )
  ).then(finish,finish);

  return finish;
}
