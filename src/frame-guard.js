if(globalThis.self!==globalThis.top){
  document.documentElement.style.display=
    "none";

  try{
    globalThis.top.location.replace(
      globalThis.self.location.href
    );
  }catch{}
}else{
  const source=
    document.currentScript?.src;

  if(source){
    const script=
      document.createElement("script");

    script.type="module";
    script.src=
      new URL(
        "./management-navigation.js",
        source
      ).href;

    document.head.append(script);
  }
}
