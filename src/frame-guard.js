if(globalThis.self!==globalThis.top){
  document.documentElement.style.display=
    "none";

  try{
    globalThis.top.location.replace(
      globalThis.self.location.href
    );
  }catch{}
}

if(
  globalThis.self===globalThis.top &&
  typeof document!=="undefined"
){
  const source=
    document.currentScript?.src ||
    document.baseURI;

  const styleUrl=
    new URL(
      "../styles/platform.css",
      source
    ).href;

  if(
    !document.querySelector(
      'link[data-platform-style="true"]'
    )
  ){
    const link=
      document.createElement("link");

    link.rel="stylesheet";
    link.href=styleUrl;
    link.dataset.platformStyle="true";

    document.head.appendChild(link);
  }

  const moduleUrl=
    new URL(
      "./platform-shell.js",
      source
    ).href;

  import(moduleUrl).catch(error=>{
    console.error(
      "Platform shell не загружен:",
      error
    );
  });
}
