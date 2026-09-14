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
    const loadModule=modulePath=>{
      const script=
        document.createElement("script");

      script.type="module";
      script.src=
        new URL(
          modulePath,
          source
        ).href;

      document.head.append(script);
    };

    loadModule(
      "./management-navigation.js"
    );

    loadModule(
      "./team-motion.js"
    );

    const loadReferenceSwipes=()=>{
      loadModule(
        "./reference-swipes.js"
      );
    };

    if(document.readyState==="loading"){
      document.addEventListener(
        "DOMContentLoaded",
        loadReferenceSwipes,
        {once:true}
      );
    }else{
      loadReferenceSwipes();
    }
  }
}
