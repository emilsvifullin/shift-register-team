import {
  readFile,
  writeFile
} from "node:fs/promises";

const TEST_PATH=
  "tests/static.test.js";

let source=
  await readFile(
    TEST_PATH,
    "utf8"
  );

const helperAnchor=`const read=
  path=>
    readFile(
      new URL(
        \`../\${path}\`,
        import.meta.url
      ),
      "utf8"
    );
`;

const teamHelper=`

const TEAM_API_FILES=Object.freeze([
  "src/team.js",
  "src/api/result.js",
  "src/api/read.js",
  "src/api/employees.js",
  "src/api/realtime.js",
  "src/api/shifts.js",
  "src/api/points.js",
  "src/api/payouts.js"
]);

const readTeamApi=async()=>
  (
    await Promise.all(
      TEAM_API_FILES.map(read)
    )
  ).join("\\n");
`;

const styleHelper=`

const STYLE_FILES=Object.freeze([
  "styles.css",
  "styles/accessibility.css",
  "styles/motion.css",
  "styles/workflow.css",
  "styles/auth.css",
  "styles/platform.css"
]);

const readStyles=async()=>
  (
    await Promise.all(
      STYLE_FILES.map(read)
    )
  ).join("\\n");
`;

if(!source.includes(helperAnchor)){
  throw new Error(
    "Static test refactor aborted: read helper anchor not found"
  );
}

if(!source.includes("STYLE_FILES")){
  source=source.replace(
    helperAnchor,
    helperAnchor+styleHelper
  );
}

if(!source.includes("TEAM_API_FILES")){
  source=source.replace(
    helperAnchor,
    helperAnchor+teamHelper
  );
}

const teamReadPattern=/const team=\n\s+await read\(\n\s+"src\/team\.js"\n\s+\);/g;

source=source.replace(
  teamReadPattern,
  "const team=\n      await readTeamApi();"
);

source=source.replace(
  /await read\(\s*"styles\.css"\s*\)/g,
  "await readStyles()"
);

const caretStart=
  source.indexOf(
    'test(\n  "right-aligned fields keep convenient native caret placement"'
  );

const caretEnd=
  source.indexOf(
    '\ntest(\n  "package metadata matches application version"',
    caretStart
  );

if(caretStart<0 || caretEnd<0){
  throw new Error(
    "Static test refactor aborted: caret contract test not found"
  );
}

let caretBlock=
  source.slice(
    caretStart,
    caretEnd
  );

caretBlock=caretBlock
  .replace(
    /const app=\n\s+await read\(\n\s+"src\/app\.js"\n\s+\);/,
    'const inputBehavior=\n      await read(\n        "src/ui/input-behavior.js"\n      );'
  )
  .replaceAll(
    "      app,",
    "      inputBehavior,"
  );

if(
  !caretBlock.includes(
    '"src/ui/input-behavior.js"'
  )
){
  throw new Error(
    "Static test refactor aborted: caret module replacement failed"
  );
}

source=
  source.slice(0,caretStart)+
  caretBlock+
  source.slice(caretEnd);

if(source.match(teamReadPattern)){
  throw new Error(
    "Static test refactor aborted: monolithic team reads remain"
  );
}

if(
  /await read\(\s*"styles\.css"\s*\)/.test(source)
){
  throw new Error(
    "Static test refactor aborted: monolithic style reads remain"
  );
}

await writeFile(
  TEST_PATH,
  source,
  "utf8"
);

console.log(
  "Static source-contract tests now follow modular ownership"
);
