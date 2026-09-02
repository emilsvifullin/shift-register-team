const DESKTOP_PICKER_QUERY=
  "(min-width:760px) and (hover:hover) and (pointer:fine)";

function clamp(
  value,
  min,
  max
){
  return Math.min(
    Math.max(value,min),
    max
  );
}

export function resetAppPickerPosition(
  picker
){
  if(!picker){
    return;
  }

  picker.classList.remove(
    "app-picker-anchored",
    "app-picker-above"
  );

  [
    "--app-picker-left",
    "--app-picker-top",
    "--app-picker-width",
    "--app-picker-max-height",
    "--app-picker-list-height"
  ].forEach(property=>{
    picker.style.removeProperty(
      property
    );
  });
}

export function positionAppPicker(
  picker,
  anchor
){
  resetAppPickerPosition(
    picker
  );

  if(
    !picker ||
    !(anchor instanceof Element) ||
    !window.matchMedia(
      DESKTOP_PICKER_QUERY
    ).matches
  ){
    return false;
  }

  const viewportWidth=
    window.visualViewport?.width ||
    window.innerWidth;

  const viewportHeight=
    window.visualViewport?.height ||
    window.innerHeight;

  const edge=16;
  const gap=8;
  const anchorRect=
    anchor.getBoundingClientRect();

  const widthSource=
    anchor.closest(".card") ||
    anchor;

  const widthRect=
    widthSource.getBoundingClientRect();

  const width=clamp(
    widthRect.width,
    Math.min(300,viewportWidth-edge*2),
    Math.min(604,viewportWidth-edge*2)
  );

  const left=clamp(
    widthRect.left,
    edge,
    viewportWidth-width-edge
  );

  const maxHeight=Math.min(
    420,
    viewportHeight-edge*2
  );

  picker.classList.add(
    "app-picker-anchored"
  );

  picker.style.setProperty(
    "--app-picker-left",
    `${Math.round(left)}px`
  );

  picker.style.setProperty(
    "--app-picker-width",
    `${Math.round(width)}px`
  );

  picker.style.setProperty(
    "--app-picker-max-height",
    `${Math.round(maxHeight)}px`
  );

  const fixedHeight=
    Array.from(
      picker.children
    )
      .filter(child=>
        !child.classList.contains(
          "point-list"
        ) &&
        !child.hidden &&
        getComputedStyle(child)
          .display!=="none"
      )
      .reduce(
        (height,child)=>{
          const style=
            getComputedStyle(child);

          return height+
            child.getBoundingClientRect()
              .height+
            parseFloat(style.marginTop || 0)+
            parseFloat(style.marginBottom || 0);
        },
        0
      );

  picker.style.setProperty(
    "--app-picker-list-height",
    `${Math.max(88,Math.round(maxHeight-fixedHeight))}px`
  );

  const pickerHeight=Math.min(
    picker.scrollHeight,
    maxHeight
  );

  const below=
    viewportHeight-
    anchorRect.bottom-
    edge;

  const above=
    anchorRect.top-
    edge;

  const openAbove=
    below<Math.min(
      pickerHeight,
      200
    ) &&
    above>below;

  const top=openAbove
    ? Math.max(
        edge,
        anchorRect.top-
        pickerHeight-
        gap
      )
    : Math.min(
        viewportHeight-
        pickerHeight-
        edge,
        anchorRect.bottom+gap
      );

  picker.classList.toggle(
    "app-picker-above",
    openAbove
  );

  picker.style.setProperty(
    "--app-picker-top",
    `${Math.round(top)}px`
  );

  return true;
}
