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
      /id="authForm"[\s\S]*autocomplete="on"/
    );

    assert.doesNotMatch(
      html,
      /data-1p-ignore="true"/
    );

    assert.match(
      html,
      /name="username"[\s\S]*autocomplete="username"/
    );

    assert.match(
      html,
      /name="password"[\s\S]*autocomplete="current-password"/
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
        "src/team-domain.js",
        "src/phone.js",
        "src/employee-ui.js",
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

    assert.match(
      sw,
      /\.\/src\/employee-ui\.js/
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
  "email authentication and realtime synchronization stay explicit",
  async()=>{
    const loginHtml=
      await read(
        "login.html"
      );

    const login=
      await read(
        "src/login.js"
      );

    const supabase=
      await read(
        "src/supabase.js"
      );

    const team=
      await read(
        "src/team.js"
      );

    const employeeAuth=
      await read(
        "supabase/functions/admin-employee-auth/index.ts"
      );

    assert.match(
      loginHtml,
      /<span>Почта<\/span>/
    );

    assert.match(
      login,
      /signInWithPassword\([\s\S]*credentials[\s\S]*\)/
    );

    assert.doesNotMatch(
      login,
      /phoneAuthEmail/
    );

    assert.doesNotMatch(
      employeeAuth,
      /phone\.shift-register\.example\.com/
    );

    assert.match(
      employeeAuth,
      /normalizedEmail/
    );

    assert.match(
      employeeAuth,
      /email_confirm:true/
    );

    assert.match(
      employeeAuth,
      /user_metadata:[\s\S]*full_name:employee\.full_name/
    );

    assert.match(
      employeeAuth,
      /linkedProfile\?\.role==="admin"[\s\S]*admin_account_protected/
    );

    assert.doesNotMatch(
      employeeAuth,
      /phone_confirm:true/
    );

    assert.match(
      supabase,
      /SUPABASE_REALTIME_URL/
    );

    assert.match(
      supabase,
      /onAuthStateChange/
    );

    assert.match(
      team,
      /postgres_changes/
    );

    assert.match(
      team,
      /point_tariffs/
    );

    assert.match(
      team,
      /saveAdminEmployeeAuth\([\s\S]*email[\s\S]*admin-employee-auth/
    );
  }
);

test(
  "application uses its own calendar and keeps shift comments out of the editor",
  async()=>{
    const html=
      await read(
        "index.html"
      );

    const app=
      await read(
        "src/app.js"
      );

    assert.doesNotMatch(
      html,
      /type="date"/
    );

    assert.doesNotMatch(
      app,
      /Комментарий к смене/
    );

    assert.match(
      app,
      /datePickerTarget/
    );
  }
);

test(
  "desktop forms and accumulated shift UX guards stay explicit",
  async()=>{
    const app=
      await read(
        "src/app.js"
      );

    const styles=
      await read(
        "styles.css"
      );

    assert.match(
      app,
      /syncEmployeeDraftFromForm\(\)/
    );

    assert.match(
      app,
      /employeePasswordToggle/
    );

    assert.match(
      app,
      /pendingMonthWheelDirections/
    );

    assert.match(
      app,
      /id="statsPointOpen"/
    );

    assert.match(
      app,
      /id="statsEmployeeOpen"/
    );

    assert.doesNotMatch(
      app,
      /<select[\s\S]{0,120}id="stats(?:Point|Employee)"/
    );

    assert.match(
      app,
      /positionAppPicker\([\s\S]*pointPreviousFocus/
    );

    assert.match(
      app,
      /id="f-employee-open"/
    );

    assert.ok(
      app.indexOf(
        'id="f-date-open"'
      )<app.indexOf(
        'id="f-point-open"'
      ) &&
      app.indexOf(
        'id="f-point-open"'
      )<app.indexOf(
        'id="f-employee-open"'
      ) &&
      app.indexOf(
        'id="f-employee-open"'
      )<app.indexOf(
        'id="f-shk"'
      )
    );

    assert.match(
      app,
      /FULL_HOURS-0\.5/
    );

    assert.match(
      styles,
      /@media \(min-width:900px\)[\s\S]*max-width:720px/
    );
  }
);

test(
  "shifts empty state uses the management layout and a centered tab bar",
  async()=>{
    const html=
      await read(
        "index.html"
      );

    const app=
      await read(
        "src/app.js"
      );

    const styles=
      await read(
        "styles.css"
      );

    assert.doesNotMatch(
      html,
      /id="fab"|fab-slot/
    );

    assert.match(
      app,
      /class="manage-add"[\s\S]*id="shiftAdd"[\s\S]*Добавить смену/
    );

    assert.match(
      app,
      /<div class="ml">\$\{listLabel\}<\/div>[\s\S]*employee-empty[\s\S]*В этом месяце смен пока нет\./
    );

    assert.doesNotMatch(
      app,
      /emptyAdd|shouldShowFab|has-fab/
    );

    assert.doesNotMatch(
      styles,
      /\.fab(?:\{|\W)|has-fab|empty-add/
    );

    const bottomControls=
      styles.match(
        /(?:^|\n)\.bottom-controls\{([^}]*)\}/
      )?.[1] || "";

    assert.match(
      bottomControls,
      /left:0;/
    );

    assert.match(
      bottomControls,
      /right:0;/
    );

    assert.match(
      bottomControls,
      /justify-content:center;/
    );
  }
);

test(
  "management polish keeps the agreed information order and unified tariff flow",
  async()=>{
    const app=
      await read(
        "src/app.js"
      );

    const styles=
      await read(
        "styles.css"
      );

    assert.ok(
      app.indexOf(
        'id="statsPointOpen"'
      )<app.indexOf(
        'id="statsEmployeeOpen"'
      )
    );

    assert.match(
      app,
      /Пункты выдачи и тарифы/
    );

    assert.match(
      app,
      /id="manageTariffAdd"/
    );

    assert.match(
      app,
      /function pointInformationHTML/
    );

    assert.match(
      app,
      /<details class="tariff-history-item">/
    );

    assert.match(
      app,
      /Изменить тариф/
    );

    assert.match(
      app,
      /editing:false/
    );

    assert.doesNotMatch(
      app,
      /function pointPricingLabel/
    );

    assert.doesNotMatch(
      app,
      /data-manage-section="tariffs"/
    );

    assert.doesNotMatch(
      app,
      /placeholder="\+7 999 123-45-67"|placeholder="Если отличается"|placeholder="Например, СБП"|placeholder="ФИО получателя"/
    );

    assert.match(
      app,
      /class="card employee-detail"[\s\S]*ФИО[\s\S]*esc\(employee\.full_name\)/
    );

    assert.match(
      app,
      /kind:"wheel"/
    );

    assert.match(
      app,
      /class="row point-row shift-employee-row"/
    );

    assert.match(
      app,
      /class="adjustment-add-row"/
    );

    assert.match(
      styles,
      /\.tariff-info-card[\s\S]*\.tariff-history-item[\s\S]*\.shift-employee-row \.t/
    );

    assert.match(
      styles,
      /\.employee-password-row > \.t[\s\S]*font-size:14\.5px/
    );

    assert.match(
      styles,
      /\.employee-account-row,[\s\S]*\.employee-password-row[\s\S]*min-height:63px/
    );
  }
);

test(
  "desktop sheets and repeated gestures keep their regression guards",
  async()=>{
    const app=
      await read(
        "src/app.js"
      );

    const html=
      await read(
        "index.html"
      );

    const employeeUi=
      await read(
        "src/employee-ui.js"
      );

    const styles=
      await read(
        "styles.css"
      );

    assert.match(
      app,
      /function prepareBottomSheetOpen[\s\S]*getAnimations/
    );

    assert.match(
      app,
      /wheelSequence[\s\S]*canDismiss:[\s\S]*canStart\(event\.target\)/
    );

    assert.match(
      app,
      /wheelSequence\.canDismiss/
    );

    assert.match(
      app,
      /now-monthWheelLastAt>72/
    );

    assert.match(
      app,
      /flushPendingMonthWheel\(\)/
    );

    assert.match(
      app,
      /metadata\.full_name[\s\S]*ФИО не указано/
    );

    assert.ok(
      html.indexOf(
        'id="tab-manage"'
      )<html.indexOf(
        'id="tab-data"'
      )
    );

    assert.doesNotMatch(
      employeeUi,
      /function employeesManageView/
    );

    assert.match(
      employeeUi,
      /function manageSubsectionView[\s\S]*"manageBack"/
    );

    assert.match(
      styles,
      /@media \(min-width:900px\)[\s\S]*max-width:720px/
    );

    assert.match(
      styles,
      /\.point-picker[\s\S]*max-width:604px[\s\S]*\.month-picker[\s\S]*max-width:604px/
    );

    assert.match(
      styles,
      /\.tariff-tier-fields input[\s\S]*border-radius:10px/
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
  "employee UI exposes one explicit integration without duplicate state or requests",
  async()=>{
    const employeeUi=
      await read(
        "src/employee-ui.js"
      );

    assert.match(
      employeeUi,
      /export function initEmployeeUi\(/
    );

    assert.doesNotMatch(
      employeeUi,
      /MutationObserver/
    );

    assert.doesNotMatch(
      employeeUi,
      /supabaseClient|supabase\.from\(|client\.from\(/
    );
  }
);

test(
  "team shifts use Supabase as the canonical source",
  async()=>{
    const app=
      await read(
        "src/app.js"
      );

    assert.match(
      app,
      /await loadTeamData\(/
    );

    assert.match(
      app,
      /await saveAdminShift\(/
    );

    assert.match(
      app,
      /await deleteAdminShift\(/
    );

    assert.doesNotMatch(
      app,
      /store\.save\(/
    );
  }
);

test(
  "employee loading resolves ownership before requesting shifts",
  async()=>{
    const team=
      await read(
        "src/team.js"
      );

    const employeeFlow=
      team.slice(
        team.indexOf(
          "export async function loadEmployeeTeamData"
        ),
        team.indexOf(
          "export function loadTeamData"
        )
      );

    assert.ok(
      employeeFlow.indexOf(
        '.from("employees")'
      )<employeeFlow.indexOf(
        "loadShiftRows("
      )
    );

    assert.match(
      employeeFlow,
      /if\(!employee\)[\s\S]*shifts:\[\]/
    );

    assert.match(
      employeeFlow,
      /loadShiftRows\([\s\S]*employee\.id/
    );
  }
);

test(
  "database migration keeps writes admin-only and historical employee references restricted",
  async()=>{
    const migration=
      await read(
        "supabase/migrations/20260824090000_complete_team_workflow.sql"
      );

    assert.match(
      migration,
      /if not private\.is_admin\(\)/
    );

    assert.match(
      migration,
      /set search_path = ''/
    );

    assert.match(
      migration,
      /revoke all on table[\s\S]*from anon;/
    );

    assert.match(
      migration,
      /create unique index if not exists shifts_employee_legacy_source_uidx/
    );

    assert.doesNotMatch(
      migration,
      /drop table|truncate table|on delete cascade[\s\S]*employee_id/i
    );
  }
);

test(
  "employee phone migration and edge function preserve the security boundary",
  async()=>{
    const migration=
      await read(
        "supabase/migrations/20260824113000_employee_phone_realtime.sql"
      );

    const edge=
      await read(
        "supabase/functions/admin-employee-auth/index.ts"
      );

    const emailMigration=
      await read(
        "supabase/migrations/20260824151948_employee_email_accounts.sql"
      );

    const team=
      await read(
        "src/team.js"
      );

    assert.match(
      migration,
      /add column if not exists phone text/
    );

    assert.match(
      migration,
      /admin_save_employee_profile/
    );

    assert.match(
      migration,
      /alter publication supabase_realtime add table/
    );

    assert.match(
      migration,
      /revoke all on function public\.admin_save_employee/
    );

    assert.match(
      edge,
      /SUPABASE_SERVICE_ROLE_KEY/
    );

    assert.match(
      edge,
      /profile\?\.role!=="admin"/
    );

    assert.match(
      emailMigration,
      /security definer[\s\S]*set search_path = ''/
    );

    assert.match(
      emailMigration,
      /grant execute on function public\.admin_account_options_v2\(\)[\s\S]*to authenticated/
    );

    assert.doesNotMatch(
      team,
      /SERVICE_ROLE/
    );

    assert.match(
      team,
      /admin-employee-auth/
    );
  }
);
