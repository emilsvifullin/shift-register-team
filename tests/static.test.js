import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  readFile
} from "node:fs/promises";

const read=
  path=>
    readFile(
      new URL(
        `../${path}`,
        import.meta.url
      ),
      "utf8"
    );

test(
  "entrypoint contains accessibility and security essentials",
  async()=>{
    const html=
      await read(
        "index.html"
      );

    assert.match(
      html,
      /Content-Security-Policy/
    );

    assert.doesNotMatch(
      html,
      /maximum-scale=1/
    );

    assert.match(
      html,
      /role="dialog"/
    );

    assert.match(
      html,
      /aria-live="polite"/
    );

    assert.match(
      html,
      /src="\.\/src\/app\.js"/
    );
  }
);

test(
  "login entrypoint keeps the authentication contract",
  async()=>{
    const html=
      await read(
        "login.html"
      );

    assert.match(
      html,
      /Content-Security-Policy/
    );

    assert.match(
      html,
      /autocomplete="username"/
    );

    assert.match(
      html,
      /autocomplete="current-password"/
    );

    assert.equal(
      (
        html.match(
          /\sreadonly\b/g
        ) || []
      ).length,
      2
    );

    assert.match(
      html,
      /src="\.\/src\/login\.js"/
    );
  }
);

test(
  "application source keeps the production point contract centralized",
  async()=>{
    const config=
      await read(
        "src/config.js"
      );

    assert.match(
      config,
      /POINT_DEFINITIONS/
    );

    assert.match(
      config,
      /Object\.freeze/
    );
  }
);

test(
  "all service worker assets exist",
  async()=>{
    for(
      const path of [
        "index.html",
        "login.html",
        "styles.css",
        "manifest.webmanifest",
        "src/config.js",
        "src/domain.js",
        "src/storage.js",
        "src/team.js",
        "src/supabase.js",
        "src/auth.js",
        "src/login.js",
        "src/app.js",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-512.png"
      ]
    ){
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
  "service worker keeps the current update and network strategy",
  async()=>{
    const sw=
      await read(
        "sw.js"
      );

    assert.match(
      sw,
      /self\.skipWaiting\(\)/
    );

    assert.match(
      sw,
      /self\.clients\.claim\(\)/
    );

    assert.match(
      sw,
      /AbortController/
    );

    assert.match(
      sw,
      /\.\/src\/login\.js/
    );

    assert.match(
      sw,
      /\.\/src\/supabase\.js/
    );
  }
);

test(
  "Supabase traffic uses the Vercel proxy",
  async()=>{
    const proxy=
      "https://shift-register-supabase-proxy.vercel.app";

    const supabase=
      await read(
        "src/supabase.js"
      );

    const index=
      await read(
        "index.html"
      );

    const login=
      await read(
        "login.html"
      );

    assert.ok(
      supabase.includes(
        proxy
      )
    );

    assert.ok(
      index.includes(
        proxy
      )
    );

    assert.ok(
      login.includes(
        proxy
      )
    );

    assert.doesNotMatch(
      supabase,
      /workers\.dev/
    );
  }
);

test(
  "package metadata matches application version",
  async()=>{
    const config=
      await read(
        "src/config.js"
      );

    const packageJson=
      JSON.parse(
        await read(
          "package.json"
        )
      );

    const packageLock=
      JSON.parse(
        await read(
          "package-lock.json"
        )
      );

    const appVersion=
      config.match(
        /APP_VERSION = "([^"]+)"/
      )?.[1];

    assert.ok(
      appVersion
    );

    assert.equal(
      packageJson.version,
      appVersion
    );

    assert.equal(
      packageLock.version,
      appVersion
    );

    assert.equal(
      packageLock.packages[""]
        .version,
      appVersion
    );
  }
);

test(
  "manifest does not force portrait orientation",
  async()=>{
    const manifest=
      JSON.parse(
        await read(
          "manifest.webmanifest"
        )
      );

    assert.equal(
      Object.hasOwn(
        manifest,
        "orientation"
      ),
      false
    );
  }
);

test(
  "employee UI mutation observers settle after synchronizing the DOM",
  async()=>{
    const employeeUi=
      await read(
        "src/employee-ui.js"
      );

    assert.match(
      employeeUi,
      /function setTextIfChanged\(/
    );

    assert.doesNotMatch(
      employeeUi,
      /check\.textContent\s*=/
    );

    assert.match(
      employeeUi,
      /visible===0\s*&&\s*!existingEmpty/
    );
  }
);
