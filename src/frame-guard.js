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
    void import(
      new URL(
        "./management-navigation.js",
        source
      ).href
    );
  }
}
