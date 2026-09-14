const HELP_SELECTOR=
  ".tariff-current-editor .employee-help";
const STABLE_HELP_SELECTOR=
  ".tariff-current-editor .tariff-editor-help";

export function tariffHelpMessage(intent){
  return intent==="edit-current"
    ? "Редактируется текущий тариф. Новая запись в истории не создаётся."
    : "Создаётся новая версия тарифа с выбранной даты. Предыдущий тариф останется в истории.";
}

export function stabilizeTariffHelp(
  documentRef=document
){
  const sheet=documentRef.getElementById(
    "manageEditorSheet"
  );

  if(!sheet){
    return 0;
  }

  const message=tariffHelpMessage(
    sheet.dataset.tariffIntent || "create"
  );

  const unstable=[
    ...sheet.querySelectorAll(HELP_SELECTOR)
  ];

  for(const help of unstable){
    help.classList.remove("employee-help");
    help.classList.add("tariff-editor-help");

    if(help.textContent!==message){
      help.textContent=message;
    }
  }

  const stable=[
    ...sheet.querySelectorAll(
      STABLE_HELP_SELECTOR
    )
  ];

  for(const help of stable){
    if(help.textContent!==message){
      help.textContent=message;
    }
  }

  return unstable.length;
}

function installStyle(documentRef=document){
  if(
    documentRef.getElementById(
      "managementTariffFreezeGuardStyle"
    )
  ){
    return;
  }

  const style=documentRef.createElement("style");
  style.id="managementTariffFreezeGuardStyle";
  style.textContent=`
#manageEditorSheet .tariff-editor-help{
  margin:7px 4px 0;
  color:var(--ink3);
  font-size:10.5px;
  line-height:1.35;
}
`;
  documentRef.head.append(style);
}

function observeSheet({
  windowRef=window,
  documentRef=document
}={}){
  const sheet=documentRef.getElementById(
    "manageEditorSheet"
  );

  if(!sheet){
    return false;
  }

  stabilizeTariffHelp(documentRef);

  const observer=new windowRef.MutationObserver(
    ()=>{
      stabilizeTariffHelp(documentRef);
    }
  );

  observer.observe(sheet,{
    childList:true,
    subtree:true,
    attributes:true,
    attributeFilter:["data-tariff-intent"]
  });

  return true;
}

function install({
  windowRef=window,
  documentRef=document
}={}){
  installStyle(documentRef);

  if(observeSheet({windowRef,documentRef})){
    return;
  }

  const rootObserver=new windowRef.MutationObserver(
    ()=>{
      if(
        observeSheet({
          windowRef,
          documentRef
        })
      ){
        rootObserver.disconnect();
      }
    }
  );

  rootObserver.observe(
    documentRef.documentElement,
    {
      childList:true,
      subtree:true
    }
  );
}

if(
  typeof window!=="undefined" &&
  typeof document!=="undefined"
){
  install();
}
