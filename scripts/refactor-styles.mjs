import {
  access,
  readFile,
  writeFile,
  mkdir
} from "node:fs/promises";

const STYLE_PATH="styles.css";

const SECTIONS=[
  {
    marker:"/* ===== hardening / accessibility ===== */",
    path:"styles/accessibility.css"
  },
  {
    marker:"/* ===== плавный переход месяца ===== */",
    path:"styles/motion.css"
  },
  {
    marker:"/* ===== расширенный рабочий процесс ===== */",
    path:"styles/workflow.css"
  },
  {
    marker:"/* ===== авторизация ===== */",
    path:"styles/auth.css"
  }
];

const exists=async path=>{
  try{
    await access(path);
    return true;
  }catch{
    return false;
  }
};

await mkdir(
  "styles",
  {recursive:true}
);

let styles=
  await readFile(
    STYLE_PATH,
    "utf8"
  );

const firstIndex=
  styles.indexOf(
    SECTIONS[0].marker
  );

if(firstIndex>=0){
  const indexes=
    SECTIONS.map(section=>
      styles.indexOf(
        section.marker
      )
    );

  if(
    indexes.some(index=>index<0) ||
    indexes.some(
      (index,position)=>
        position>0 &&
        index<=indexes[position-1]
    )
  ){
    throw new Error(
      "Style refactor aborted: section markers are missing or out of order"
    );
  }

  const base=
    styles.slice(
      0,
      indexes[0]
    ).trimEnd()+"\n";

  for(
    let index=0;
    index<SECTIONS.length;
    index++
  ){
    const start=indexes[index];
    const end=
      index+1<indexes.length
        ? indexes[index+1]
        : styles.length;

    const content=
      styles.slice(start,end)
        .trim()+"\n";

    await writeFile(
      SECTIONS[index].path,
      content,
      "utf8"
    );
  }

  await writeFile(
    STYLE_PATH,
    base,
    "utf8"
  );
}else{
  for(const section of SECTIONS){
    if(!await exists(section.path)){
      throw new Error(
        `Style refactor aborted: ${section.path} is missing`
      );
    }
  }
}

const styleLinks=`
  <link
    rel="stylesheet"
    href="./styles/accessibility.css"
  >

  <link
    rel="stylesheet"
    href="./styles/motion.css"
  >

  <link
    rel="stylesheet"
    href="./styles/workflow.css"
  >

  <link
    rel="stylesheet"
    href="./styles/auth.css"
  >`;

for(const path of [
  "index.html",
  "login.html"
]){
  let html=
    await readFile(
      path,
      "utf8"
    );

  if(
    html.includes(
      "./styles/accessibility.css"
    )
  ){
    continue;
  }

  const pattern=/(<link\s+rel="stylesheet"\s+href="\.\/styles\.css"\s*>)/m;

  if(!pattern.test(html)){
    throw new Error(
      `Style refactor aborted: stylesheet link not found in ${path}`
    );
  }

  html=html.replace(
    pattern,
    `$1\n${styleLinks}`
  );

  await writeFile(
    path,
    html,
    "utf8"
  );
}

let sw=
  await readFile(
    "sw.js",
    "utf8"
  );

const swAssets=[
  "./styles/accessibility.css",
  "./styles/motion.css",
  "./styles/workflow.css",
  "./styles/auth.css",
  "./src/ui/input-behavior.js"
];

const swAnchor=
  '  "./styles/platform.css",';

if(!sw.includes(swAnchor)){
  throw new Error(
    "Style refactor aborted: service worker style anchor not found"
  );
}

const missingAssets=
  swAssets.filter(asset=>
    !sw.includes(
      `  "${asset}",`
    )
  );

if(missingAssets.length){
  sw=sw.replace(
    swAnchor,
    [
      swAnchor,
      ...missingAssets.map(
        asset=>`  "${asset}",`
      )
    ].join("\n")
  );

  await writeFile(
    "sw.js",
    sw,
    "utf8"
  );
}

console.log(
  "Styles split into stable cascade layers"
);
