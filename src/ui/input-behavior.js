const CARET_INPUT_TYPES=
  new Set([
    "email",
    "number",
    "password",
    "search",
    "tel",
    "text",
    "url"
  ]);

function disableFieldSuggestions(
  root,
  windowRef
){
  const fields=
    root instanceof windowRef.HTMLInputElement ||
    root instanceof windowRef.HTMLTextAreaElement
      ? [root]
      : root.querySelectorAll?.(
          "input,textarea"
        ) || [];

  fields.forEach(field=>{
    field.setAttribute(
      "autocomplete",
      "off"
    );

    field.setAttribute(
      "data-1p-ignore",
      "true"
    );

    field.setAttribute(
      "data-lpignore",
      "true"
    );

    field.setAttribute(
      "data-form-type",
      "other"
    );
  });
}

function editableCaretField(
  target,
  windowRef
){
  if(
    target instanceof
      windowRef.HTMLTextAreaElement
  ){
    return target;
  }

  if(
    target instanceof
      windowRef.HTMLInputElement &&
    CARET_INPUT_TYPES.has(target.type)
  ){
    return target;
  }

  const row=
    target instanceof windowRef.Element
      ? target.closest("label.row")
      : null;

  const field=
    row?.querySelector(
      "input,textarea"
    );

  if(
    field instanceof
      windowRef.HTMLTextAreaElement ||
    field instanceof
      windowRef.HTMLInputElement &&
    CARET_INPUT_TYPES.has(field.type)
  ){
    return field;
  }

  return null;
}

function moveCaretToEnd(
  field
){
  if(
    !field ||
    field.disabled ||
    field.readOnly ||
    field.value===""
  ){
    return;
  }

  const value=field.value;

  try{
    field.setSelectionRange(
      value.length,
      value.length
    );
  }catch{
    field.value="";
    field.value=value;
  }
}

export function installInputBehavior({
  windowRef=window,
  documentRef=document
}={}){
  let caretPointerEntry=null;
  let caretMeasureContext=null;

  disableFieldSuggestions(
    documentRef,
    windowRef
  );

  const clickBeforeRightAlignedValue=(
    field,
    clientX
  )=>{
    const style=
      windowRef.getComputedStyle(field);

    if(
      ![
        "right",
        "end"
      ].includes(style.textAlign)
    ){
      return false;
    }

    const value=String(
      field.value || ""
    );

    if(!value){
      return false;
    }

    if(!caretMeasureContext){
      caretMeasureContext=
        documentRef
          .createElement("canvas")
          .getContext("2d");
    }

    if(!caretMeasureContext){
      return true;
    }

    caretMeasureContext.font=
      style.font;

    const rect=
      field.getBoundingClientRect();

    const paddingRight=
      Number.parseFloat(
        style.paddingRight
      ) || 0;

    const valueWidth=
      caretMeasureContext
        .measureText(value)
        .width;

    const valueStart=
      rect.right-
      paddingRight-
      valueWidth;

    return clientX<valueStart-3;
  };

  const onPointerDown=event=>{
    if(!event.isPrimary){
      caretPointerEntry=null;
      return;
    }

    const field=
      editableCaretField(
        event.target,
        windowRef
      );

    if(!field){
      caretPointerEntry=null;
      return;
    }

    caretPointerEntry={
      id:event.pointerId,
      field,
      x:event.clientX,
      y:event.clientY,
      clickedField:
        event.target===field,
      moved:false
    };
  };

  const onPointerMove=event=>{
    const entry=caretPointerEntry;

    if(
      !entry ||
      event.pointerId!==entry.id
    ){
      return;
    }

    if(
      Math.hypot(
        event.clientX-entry.x,
        event.clientY-entry.y
      )>8
    ){
      entry.moved=true;
    }
  };

  const onPointerUp=event=>{
    const entry=caretPointerEntry;

    caretPointerEntry=null;

    if(
      !entry ||
      entry.moved ||
      event.pointerId!==entry.id
    ){
      return;
    }

    const shouldMove=
      !entry.clickedField ||
      clickBeforeRightAlignedValue(
        entry.field,
        event.clientX
      );

    if(!shouldMove){
      return;
    }

    windowRef.setTimeout(()=>{
      if(
        documentRef.activeElement!==
        entry.field
      ){
        entry.field.focus({
          preventScroll:true
        });
      }

      moveCaretToEnd(entry.field);
    },0);
  };

  const onPointerCancel=()=>{
    caretPointerEntry=null;
  };

  documentRef.addEventListener(
    "pointerdown",
    onPointerDown,
    true
  );

  documentRef.addEventListener(
    "pointermove",
    onPointerMove,
    true
  );

  documentRef.addEventListener(
    "pointerup",
    onPointerUp,
    true
  );

  documentRef.addEventListener(
    "pointercancel",
    onPointerCancel,
    true
  );

  const observer=
    new windowRef.MutationObserver(
      records=>{
        records.forEach(record=>{
          record.addedNodes.forEach(
            node=>{
              if(
                node instanceof
                  windowRef.Element
              ){
                disableFieldSuggestions(
                  node,
                  windowRef
                );
              }
            }
          );
        });
      }
    );

  observer.observe(
    documentRef.body,
    {
      childList:true,
      subtree:true
    }
  );

  return ()=>{
    observer.disconnect();

    documentRef.removeEventListener(
      "pointerdown",
      onPointerDown,
      true
    );

    documentRef.removeEventListener(
      "pointermove",
      onPointerMove,
      true
    );

    documentRef.removeEventListener(
      "pointerup",
      onPointerUp,
      true
    );

    documentRef.removeEventListener(
      "pointercancel",
      onPointerCancel,
      true
    );
  };
}
