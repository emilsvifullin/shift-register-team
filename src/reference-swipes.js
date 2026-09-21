const HORIZONTAL_DEAD_ZONE=8;
const HORIZONTAL_LOCK=10;
const VERTICAL_LOCK=14;
const YEAR_DISTANCE=35;
const FLICK_DISTANCE=22;
const FLICK_VELOCITY=.30;

function activeMainMonthTab(){
  const selected=
    document.querySelector(
      '[role="tab"][aria-selected="true"]'
    );

  return [
    "tab-shifts",
    "tab-stats"
  ].includes(selected?.id);
}

function monthSwipeStartBlocked(target){
  if(!(target instanceof Element)){
    return true;
  }

  return Boolean(
    target.closest(
      "input,textarea,select,a,button:not(.sh)"
    )
  );
}

function modalBlocksMonthSwipe(){
  return (
    document.body.classList.contains(
      "sheet-open"
    ) ||
    document.body.classList.contains(
      "point-picker-open"
    ) ||
    document.body.classList.contains(
      "month-picker-open"
    )
  );
}

/*
  shift-register меняет месяц пальцем только
  через touch-события. В team уже есть этот
  же touch-алгоритм в app.js. Здесь гасится
  лишний pointer-путь: протащить месяц мышью
  по экрану нельзя, это чужой жест и он
  мешает выделению текста.

  Горизонтальное колесо здесь не трогается.
  Двухпальцевый свайп по трекпаду приходит
  именно колесом, и это отдельный намеренный
  жест — его разбирает app.js со своими
  порогами. Раньше он гасился здесь же
  вместе с мышью, и перелистывание месяцев
  на ноутбуке не работало вовсе, хотя весь
  его разбор в приложении был на месте.
*/
let pointerMonthGuard=null;

document.addEventListener(
  "pointerdown",
  event=>{
    if(
      event.pointerType==="touch" ||
      !event.isPrimary ||
      !activeMainMonthTab() ||
      modalBlocksMonthSwipe() ||
      monthSwipeStartBlocked(event.target)
    ){
      pointerMonthGuard=null;
      return;
    }

    pointerMonthGuard={
      id:event.pointerId,
      x:event.clientX,
      y:event.clientY,
      axis:null
    };
  },
  true
);

document.addEventListener(
  "pointermove",
  event=>{
    if(
      !pointerMonthGuard ||
      event.pointerId!==pointerMonthGuard.id
    ){
      return;
    }

    const dx=
      event.clientX-pointerMonthGuard.x;
    const dy=
      event.clientY-pointerMonthGuard.y;
    const absX=Math.abs(dx);
    const absY=Math.abs(dy);

    if(pointerMonthGuard.axis===null){
      if(
        absX<HORIZONTAL_DEAD_ZONE &&
        absY<HORIZONTAL_DEAD_ZONE
      ){
        return;
      }

      if(
        absX>=HORIZONTAL_LOCK &&
        absX>absY*1.10
      ){
        pointerMonthGuard.axis="x";
      }else if(
        absY>=VERTICAL_LOCK &&
        absY>absX*1.25
      ){
        pointerMonthGuard.axis="y";
      }else{
        return;
      }
    }

    if(pointerMonthGuard.axis==="x"){
      event.stopPropagation();
    }
  },
  true
);

function finishPointerMonthGuard(event){
  if(
    !pointerMonthGuard ||
    event.pointerId!==pointerMonthGuard.id
  ){
    return;
  }

  const horizontal=
    pointerMonthGuard.axis==="x";

  pointerMonthGuard=null;

  if(horizontal){
    event.stopPropagation();
  }
}

document.addEventListener(
  "pointerup",
  finishPointerMonthGuard,
  true
);

document.addEventListener(
  "pointercancel",
  finishPointerMonthGuard,
  true
);

/*
  В shift-register выбор года свайпается
  только непосредственно по сетке месяцев,
  только touch/pen и с этими порогами.
  Лишний whole-sheet жест мышью блокируется
  ниже; колесо трекпада — нет, его разбирает
  app.js как отдельный жест.
*/
function installYearSwipe({
  containerId,
  gridId,
  previousButtonId,
  nextButtonId
}){
  const container=
    document.getElementById(
      containerId
    );

  const grid=
    document.getElementById(
      gridId
    );

  if(!container || !grid){
    return;
  }

  let guard=null;
  let swipe=null;

  container.addEventListener(
    "pointerdown",
    event=>{
      if(!event.isPrimary){
        guard=null;
        return;
      }

      guard={
        id:event.pointerId,
        x:event.clientX,
        y:event.clientY,
        axis:null,
        exact:
          ["touch","pen"].includes(
            event.pointerType
          ) &&
          grid.contains(event.target)
      };
    },
    true
  );

  container.addEventListener(
    "pointermove",
    event=>{
      if(
        !guard ||
        event.pointerId!==guard.id
      ){
        return;
      }

      const dx=event.clientX-guard.x;
      const dy=event.clientY-guard.y;
      const absX=Math.abs(dx);
      const absY=Math.abs(dy);

      if(guard.axis===null){
        if(
          absX<HORIZONTAL_DEAD_ZONE &&
          absY<HORIZONTAL_DEAD_ZONE
        ){
          return;
        }

        if(
          absX>=HORIZONTAL_LOCK &&
          absX>absY*1.10
        ){
          guard.axis="x";
        }else if(
          absY>=VERTICAL_LOCK &&
          absY>absX*1.25
        ){
          guard.axis="y";
        }else{
          return;
        }
      }

      if(
        guard.axis==="x" &&
        !guard.exact
      ){
        event.stopPropagation();
      }
    },
    true
  );

  const finishGuard=event=>{
    if(
      !guard ||
      event.pointerId!==guard.id
    ){
      return;
    }

    const shouldBlock=
      guard.axis==="x" &&
      !guard.exact;

    guard=null;

    if(shouldBlock){
      event.stopPropagation();
    }
  };

  container.addEventListener(
    "pointerup",
    finishGuard,
    true
  );

  container.addEventListener(
    "pointercancel",
    finishGuard,
    true
  );

  grid.addEventListener(
    "pointerdown",
    event=>{
      if(
        !event.isPrimary ||
        !["touch","pen"].includes(
          event.pointerType
        )
      ){
        swipe=null;
        return;
      }

      swipe={
        id:event.pointerId,
        x:event.clientX,
        y:event.clientY,
        time:performance.now(),
        axis:null
      };

      event.stopPropagation();

      try{
        grid.setPointerCapture(
          event.pointerId
        );
      }catch{}
    },
    true
  );

  grid.addEventListener(
    "pointermove",
    event=>{
      if(
        !swipe ||
        event.pointerId!==swipe.id
      ){
        return;
      }

      const dx=event.clientX-swipe.x;
      const dy=event.clientY-swipe.y;
      const absX=Math.abs(dx);
      const absY=Math.abs(dy);

      if(swipe.axis===null){
        if(
          absX<HORIZONTAL_DEAD_ZONE &&
          absY<HORIZONTAL_DEAD_ZONE
        ){
          return;
        }

        if(
          absX>=HORIZONTAL_LOCK &&
          absX>absY*1.10
        ){
          swipe.axis="x";
        }else if(
          absY>=VERTICAL_LOCK &&
          absY>absX*1.25
        ){
          swipe.axis="y";
          return;
        }else{
          return;
        }
      }

      if(swipe.axis!=="x"){
        return;
      }

      if(event.cancelable){
        event.preventDefault();
      }

      event.stopPropagation();
    },
    true
  );

  grid.addEventListener(
    "pointerup",
    event=>{
      if(
        !swipe ||
        event.pointerId!==swipe.id
      ){
        return;
      }

      const current=swipe;
      swipe=null;

      event.stopPropagation();

      try{
        if(
          grid.hasPointerCapture(
            event.pointerId
          )
        ){
          grid.releasePointerCapture(
            event.pointerId
          );
        }
      }catch{}

      const dx=event.clientX-current.x;
      const dy=event.clientY-current.y;
      const absX=Math.abs(dx);
      const absY=Math.abs(dy);
      const duration=Math.max(
        1,
        performance.now()-current.time
      );
      const velocity=absX/duration;
      const horizontal=
        absX>absY*1.08;
      const enoughDistance=
        absX>=YEAR_DISTANCE;
      const fastSwipe=
        absX>=FLICK_DISTANCE &&
        velocity>=FLICK_VELOCITY;

      if(
        current.axis!=="x" ||
        !horizontal ||
        (
          !enoughDistance &&
          !fastSwipe
        )
      ){
        return;
      }

      document
        .getElementById(
          dx<0
            ? nextButtonId
            : previousButtonId
        )
        ?.click();
    },
    true
  );

  grid.addEventListener(
    "pointercancel",
    event=>{
      if(
        !swipe ||
        event.pointerId!==swipe.id
      ){
        return;
      }

      swipe=null;
      event.stopPropagation();
    },
    true
  );
}

installYearSwipe({
  containerId:"monthPicker",
  gridId:"monthGrid",
  previousButtonId:"monthYearPrev",
  nextButtonId:"monthYearNext"
});

installYearSwipe({
  containerId:"dateJump",
  gridId:"dateJumpMonths",
  previousButtonId:"dateJumpPrevYear",
  nextButtonId:"dateJumpNextYear"
});

document.documentElement.dataset.referenceSwipes=
  "shift-register";
