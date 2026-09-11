import {
  readFile,
  writeFile
} from "node:fs/promises";

const APP_PATH="src/app.js";

let source=
  await readFile(
    APP_PATH,
    "utf8"
  );

const inputImport=`import {
  installInputBehavior
} from "./ui/input-behavior.js";

`;

if(
  !source.includes(
    'from "./ui/input-behavior.js"'
  )
){
  const importAnchor=`import {
  employeeSearchText,`;

  const importIndex=
    source.indexOf(importAnchor);

  if(importIndex<0){
    throw new Error(
      "App refactor aborted: workflow import anchor not found"
    );
  }

  source=
    source.slice(0,importIndex)+
    inputImport+
    source.slice(importIndex);
}

if(
  !source.includes(
    "installInputBehavior();"
  )
){
  const start=
    source.indexOf(
      "function disableFieldSuggestions("
    );

  const endMarker=
    "\nfunction availableTabs(){";

  const end=
    source.indexOf(
      endMarker,
      start
    );

  if(
    start<0 ||
    end<0 ||
    end<=start
  ){
    throw new Error(
      "App refactor aborted: input behavior block not found"
    );
  }

  source=
    source.slice(0,start)+
    "installInputBehavior();\n"+
    source.slice(end);
}

if(
  source.includes(
    "function disableFieldSuggestions("
  ) ||
  source.includes(
    "let caretPointerEntry=null;"
  )
){
  throw new Error(
    "App refactor aborted: legacy input behavior is still present"
  );
}

await writeFile(
  APP_PATH,
  source,
  "utf8"
);

console.log(
  "src/app.js input behavior extracted successfully"
);
