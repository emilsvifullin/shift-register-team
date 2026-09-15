/*
  Минимальный DOM-реконсилятор.

  Приложение описывает экраны строками HTML. Раньше результат попадал в DOM
  через `container.innerHTML=html`, то есть каждый рендер уничтожал все узлы
  экрана. Из-за этого терялись фокус, каретка, позиция прокрутки и элемент,
  который в этот момент держал палец, — отсюда «потерянные» тапы, мигание
  и целый слой внешних заплаток, которые пытались это чинить наблюдателями.

  `patchChildren` применяет ту же строку HTML как набор минимальных правок:
  узлы переиспользуются, ключи позволяют переставлять строки списков, а
  состояние, которого нет в разметке (значение поля, позиция каретки,
  раскрытый `<details>`, нажатая кнопка), сохраняется.
*/

const KEY_ATTRIBUTE="data-key";

/*
  Состояние, которого нет в разметке, принадлежит рантайму и переживает
  рендер: классы жеста, раскрытый <details>, инлайновая геометрия,
  значение и каретка поля.
*/
const RUNTIME_CLASSES=Object.freeze([
  "touch-active"
]);

/*
  Эти атрибуты полей ставит src/ui/input-behavior.js, чтобы менеджеры паролей
  и автозаполнение не всплывали над служебными полями. Разметка их не
  описывает, поэтому рендер не вправе их снимать.
*/
const RUNTIME_FIELD_ATTRIBUTES=new Set([
  "autocomplete",
  "data-1p-ignore",
  "data-lpignore",
  "data-form-type"
]);

const VALUE_TAGS=new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT"
]);

export function nodeKey(node){
  if(!node || node.nodeType!==1){
    return null;
  }

  return (
    node.getAttribute(KEY_ATTRIBUTE) ||
    node.getAttribute("id") ||
    null
  );
}

export function isCompatible(target,source){
  if(target.nodeType!==source.nodeType){
    return false;
  }

  if(target.nodeType!==1){
    return true;
  }

  return (
    target.nodeName===source.nodeName &&
    target.namespaceURI===source.namespaceURI
  );
}

/*
  «Подпись» — то, что о состоянии поля утверждает разметка.

  Живое значение принадлежит человеку, только пока он работает с этим полем:
  оно в фокусе, и разметка утверждает о нём то же, что в прошлый раз. Во всех
  остальных случаях значение берётся из разметки, как при полной отрисовке.
  Приложение перед перерисовкой переносит ввод в черновик, а узел без ключа
  мог достаться другой строке списка или новой форме — оставленный в нём
  чужой ввод уходил бы в сохранение.
*/
function formSignature(element){
  if(element.nodeName==="SELECT"){
    const selected=element.querySelector(
      "option[selected]"
    );

    return selected
      ? selected.getAttribute("value") ??
        selected.textContent
      : null;
  }

  if(element.nodeName==="TEXTAREA"){
    return element.textContent;
  }

  const type=element.getAttribute("type");

  if(type==="checkbox" || type==="radio"){
    return element.hasAttribute("checked")
      ? "on"
      : "off";
  }

  return element.getAttribute("value");
}

function applyFormSignature(target,source,previous){
  const next=formSignature(source);

  if(
    next===previous &&
    target.ownerDocument.activeElement===target
  ){
    return;
  }

  if(target.nodeName==="SELECT"){
    if(next!==null){
      if(target.value!==next){
        target.value=next;
      }
    }else if(target.options.length){
      target.selectedIndex=0;
    }

    return;
  }

  const type=target.getAttribute("type");

  if(type==="file"){
    return;
  }

  if(type==="checkbox" || type==="radio"){
    const checked=next==="on";

    if(target.checked!==checked){
      target.checked=checked;
    }

    return;
  }

  const value=next ?? "";

  if(target.value!==value){
    target.value=value;
  }
}

function runtimeClasses(element){
  return RUNTIME_CLASSES.filter(name=>
    element.classList.contains(name)
  );
}

function patchClass(target,source){
  const next=source.getAttribute("class");
  const preserved=runtimeClasses(target);

  if(next===null){
    if(preserved.length){
      target.setAttribute(
        "class",
        preserved.join(" ")
      );
    }else{
      target.removeAttribute("class");
    }

    return;
  }

  const declared=next.split(/\s+/);

  const value=preserved.length
    ? [
        next,
        ...preserved.filter(name=>
          !declared.includes(name)
        )
      ].join(" ")
    : next;

  if(target.getAttribute("class")!==value){
    target.setAttribute("class",value);
  }
}

function patchAttributes(target,source){
  const sourceAttributes=source.attributes;

  for(let index=0;index<sourceAttributes.length;index++){
    const {name,value}=sourceAttributes[index];

    if(name==="class"){
      continue;
    }

    if(target.getAttribute(name)!==value){
      target.setAttribute(name,value);
    }
  }

  const targetAttributes=target.attributes;

  for(let index=targetAttributes.length-1;index>=0;index--){
    const {name}=targetAttributes[index];

    if(name==="class"){
      continue;
    }

    /*
      Раскрытый <details> — состояние пользователя, а не разметки.
    */
    if(
      name==="open" &&
      target.nodeName==="DETAILS" &&
      !source.hasAttribute("open")
    ){
      continue;
    }

    /*
      Инлайновый style в этом приложении всегда вычисляет рантайм
      (подгонка высоты списка смен, кадры переходов). Разметка его не
      описывает, поэтому снимать его вправе только тот, кто поставил.
    */
    if(
      name==="style" &&
      !source.hasAttribute("style")
    ){
      continue;
    }

    if(
      RUNTIME_FIELD_ATTRIBUTES.has(name) &&
      VALUE_TAGS.has(target.nodeName)
    ){
      continue;
    }

    if(!source.hasAttribute(name)){
      target.removeAttribute(name);
    }
  }

  patchClass(target,source);
}

function patchElement(target,source){
  const signature=VALUE_TAGS.has(target.nodeName)
    ? formSignature(target)
    : null;

  patchAttributes(target,source);

  /*
    У <textarea> разметка и живое значение — один и тот же слот, поэтому
    детей не трогаем: значение синхронизируется отдельно.
  */
  if(target.nodeName!=="TEXTAREA"){
    patchChildNodes(target,source);
  }

  if(VALUE_TAGS.has(target.nodeName)){
    applyFormSignature(target,source,signature);
  }
}

function patchNode(target,source){
  if(target.nodeType===1){
    patchElement(target,source);
    return;
  }

  if(target.nodeValue!==source.nodeValue){
    target.nodeValue=source.nodeValue;
  }
}

function collectKeyed(parent){
  const keyed=new Map();

  for(
    let node=parent.firstChild;
    node;
    node=node.nextSibling
  ){
    const key=nodeKey(node);

    if(key && !keyed.has(key)){
      keyed.set(key,node);
    }
  }

  return keyed;
}

function collectSourceKeys(source){
  const keys=new Set();

  for(
    let node=source.firstChild;
    node;
    node=node.nextSibling
  ){
    const key=nodeKey(node);

    if(key){
      keys.add(key);
    }
  }

  return keys;
}

function patchChildNodes(parent,source){
  const keyed=collectKeyed(parent);
  const sourceKeys=collectSourceKeys(source);

  let cursor=parent.firstChild;

  for(
    let next=source.firstChild;
    next;
    next=next.nextSibling
  ){
    const key=nodeKey(next);
    const reusable=key
      ? keyed.get(key) || null
      : null;

    if(reusable){
      if(reusable===cursor){
        cursor=cursor.nextSibling;
      }else{
        parent.insertBefore(reusable,cursor);
      }

      keyed.delete(key);
      patchNode(reusable,next);
      continue;
    }

    /*
      Убираем узлы, которых в новой разметке уже нет. Узел с ключом,
      который ещё встретится дальше, остаётся на месте — перед ним
      просто вставляется новый.
    */
    while(cursor){
      const cursorKey=nodeKey(cursor);

      if(cursorKey && sourceKeys.has(cursorKey)){
        break;
      }

      if(!cursorKey && isCompatible(cursor,next)){
        break;
      }

      const discard=cursor;
      cursor=cursor.nextSibling;

      if(cursorKey){
        keyed.delete(cursorKey);
      }

      discard.remove();
    }

    if(
      cursor &&
      !nodeKey(cursor) &&
      isCompatible(cursor,next)
    ){
      const reused=cursor;
      cursor=cursor.nextSibling;
      patchNode(reused,next);
      continue;
    }

    parent.insertBefore(
      next.cloneNode(true),
      cursor
    );
  }

  while(cursor){
    const discard=cursor;
    cursor=cursor.nextSibling;
    discard.remove();
  }
}

/*
  Разбор разметки в отсоединённом <template>: скрипты не выполняются,
  а изображения не загружаются, пока узлы не попали в документ.
*/
function parseFragment(html,documentRef){
  const template=documentRef.createElement("template");
  template.innerHTML=html;

  return template.content;
}

export function patchChildren(
  container,
  html,
  {documentRef=container.ownerDocument}={}
){
  patchChildNodes(
    container,
    parseFragment(html,documentRef)
  );

  return container;
}
