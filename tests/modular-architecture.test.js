import test from "node:test";
import assert from "node:assert/strict";

import {
  access,
  readFile
} from "node:fs/promises";

const read=path=>
  readFile(
    new URL(
      `../${path}`,
      import.meta.url
    ),
    "utf8"
  );

const API_MODULES=[
  "src/api/result.js",
  "src/api/read.js",
  "src/api/employees.js",
  "src/api/realtime.js",
  "src/api/shifts.js",
  "src/api/points.js",
  "src/api/payouts.js"
];

const STYLE_MODULES=[
  "styles/accessibility.css",
  "styles/motion.css",
  "styles/workflow.css",
  "styles/auth.css",
  "styles/platform.css"
];

test(
  "production architecture keeps API and UI responsibilities modular",
  async()=>{
    const team=await read(
      "src/team.js"
    );
    const app=await read(
      "src/app.js"
    );

    for(const path of [
      ...API_MODULES,
      "src/ui/input-behavior.js",
      "src/platform-shell.js"
    ]){
      await access(
        new URL(
          `../${path}`,
          import.meta.url
        )
      );
    }

    assert.match(
      app,
      /from "\.\/ui\/input-behavior\.js"/
    );

    assert.match(
      app,
      /installInputBehavior\(\);/
    );

    assert.doesNotMatch(
      app,
      /function disableFieldSuggestions\(/
    );

    for(const module of [
      "api/read.js",
      "api/employees.js",
      "api/realtime.js",
      "api/shifts.js",
      "api/points.js",
      "api/payouts.js"
    ]){
      assert.match(
        team,
        new RegExp(
          module.replace(/[./]/g,"\\$&")
        )
      );
    }
  }
);

test(
  "split styles retain deterministic cascade order in both entrypoints",
  async()=>{
    const index=await read("index.html");
    const login=await read("login.html");
    const base=await read("styles.css");

    const expected=[
      "./styles.css",
      "./styles/accessibility.css",
      "./styles/motion.css",
      "./styles/workflow.css",
      "./styles/auth.css"
    ];

    for(const html of [index,login]){
      let previous=-1;

      for(const asset of expected){
        const position=
          html.indexOf(asset);

        assert.ok(
          position>previous,
          `${asset} must follow the previous stylesheet`
        );

        previous=position;
      }
    }

    assert.doesNotMatch(
      base,
      /===== hardening \/ accessibility =====/
    );

    for(const path of STYLE_MODULES){
      await access(
        new URL(
          `../${path}`,
          import.meta.url
        )
      );
    }
  }
);

test(
  "service worker precaches every modular production asset",
  async()=>{
    const sw=await read("sw.js");

    for(const path of [
      ...API_MODULES,
      ...STYLE_MODULES,
      "src/ui/input-behavior.js",
      "src/platform-shell.js"
    ]){
      assert.ok(
        sw.includes(`./${path}`),
        `${path} is missing from the service worker cache`
      );
    }
  }
);
