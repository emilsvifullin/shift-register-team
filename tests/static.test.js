import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  readFile,
  readdir
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
  "confirmation dialogs pass text and options through the shared API",
  async()=>{
    const app=
      await read(
        "src/app.js"
      );

    assert.doesNotMatch(
      app,
      /appConfirm\(\s*\{/
    );

    assert.match(
      app,
      /appConfirm\(\s*"Закрыть без сохранения\?",\s*\{[\s\S]*?detail:"Внесённые в смену данные будут потеряны\."[\s\S]*?okText:"Закрыть"/
    );
  }
);

test(
  "repository contains the complete applied Supabase migration history",
  async()=>{
    const files=
      await readdir(
        new URL(
          "../supabase/migrations/",
          import.meta.url
        )
      );

    for(const version of [
      "20260822132510",
      "20260822132637",
      "20260822133735",
      "20260822133824",
      "20260823101457",
      "20260823101524",
      "20260823113313",
      "20260823230320",
      "20260823230333",
      "20260824151948",
      "20260824225714",
      "20260824225728",
      "20260825110804",
      "20260901080730",
      "20260901194500",
      "20260902073338"
    ]){
      assert.ok(
        files.some(
          file=>
            file.startsWith(
              version
            )
        ),
        `migration ${version} is missing`
      );
    }
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

    assert.doesNotMatch(
      html,
      /\sreadonly\b/
    );

    const login=
      await read(
        "src/login.js"
      );

    assert.match(
      login,
      /\(hover:none\) and \(pointer:coarse\)/
    );

    assert.match(
      login,
      /const IS_IOS=/
    );

    assert.match(
      login,
      /!USE_READONLY_FOCUS_GUARD[\s\S]*userInteracted=true;[\s\S]*setFocusEnabled\(true\);/
    );

    assert.doesNotMatch(
      login,
      /animationstart[\s\S]*scheduleAutofillSubmit/
    );

    assert.doesNotMatch(
      login,
      /releaseAutofillFocus/
    );

    assert.match(
      login,
      /insertReplacementText[\s\S]*scheduleAutofillSubmit/
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
        "src/frame-guard.js",
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

    assert.match(
      sw,
      /SUPABASE_CDN_URL/
    );
  }
);

test(
  "Supabase REST, Auth and Edge Functions use proxy while Realtime stays direct",
  async()=>{
    const projectUrl=
      "https://rxosovinouuonwrrzigs.supabase.co";

    const proxyUrl=
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
        proxyUrl
      )
    );

    assert.ok(
      supabase.includes(
        projectUrl
      )
    );

    assert.ok(
      index.includes(
        proxyUrl
      )
    );

    assert.ok(
      index.includes(
        projectUrl
      )
    );

    assert.ok(
      login.includes(
        proxyUrl
      )
    );

    assert.match(
      supabase,
      /SUPABASE_PROXY_URL/
    );

    assert.match(
      supabase,
      /SUPABASE_PROJECT_URL/
    );

    assert.match(
      supabase,
      /SUPABASE_FUNCTIONS_URL/
    );

    assert.match(
      supabase,
      /\/functions\/v1/
    );

    assert.match(
      supabase,
      /Authorization:[\s\S]*Bearer \$\{token\}/
    );

    assert.match(
      supabase,
      /apikey:[\s\S]*SUPABASE_PUBLISHABLE_KEY/
    );

    assert.doesNotMatch(
      supabase,
      /workers\.dev/
    );

    assert.match(
      supabase,
      /refreshSession\(\)/
    );
  }
);

test(
  "entrypoints pin the Supabase CDN asset and block embedding",
  async()=>{
    const index=
      await read("index.html");
    const login=
      await read("login.html");
    const frameGuard=
      await read("src/frame-guard.js");

    assert.match(
      index,
      /integrity="sha384-[^"]+"/
    );

    assert.match(
      index,
      /crossorigin="anonymous"/
    );

    assert.match(
      login,
      /frame-src 'none'/
    );

    assert.match(
      frameGuard,
      /globalThis\.self!==globalThis\.top/
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
      /SUPABASE_PROJECT_URL/
    );

    assert.match(
      supabase,
      /invokeSupabaseFunction/
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
      /saveAdminEmployeeAuth\([\s\S]*email[\s\S]*invokeSupabaseFunction\([\s\S]*admin-employee-auth/
    );

    assert.doesNotMatch(
      team,
      /\.functions[\s\S]*\.invoke\(/
    );
  }
);

test(
  "application uses its own calendar and keeps optional shift comments in the editor",
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

    assert.match(
      app,
      /Комментарий к смене/
    );

    assert.match(
      app,
      /class="shift-note-input"[^>]*placeholder="Комментарий"/
    );

    assert.doesNotMatch(
      app,
      /placeholder="Комментарий \.\.\."/
    );

    assert.match(
      await read(
        "styles.css"
      ),
      /\.shift-note-input\{\s*text-align:left;\s*\}[\s\S]*\.shift-note-input:focus::placeholder\{\s*color:transparent;/
    );

    assert.match(
      app,
      /id="f-note"/
    );

    assert.match(
      app,
      /draft\.note=\s*get\("f-note"\)\.value/
    );

    assert.match(
      app,
      /datePickerTarget/
    );
  }
);

test(
  "employee shift details reuse saved pricing and keep mobile content readable",
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
      /if\(existing\?\.pricing && sameDrivers\)\{\s*pricing=existing\.pricing;/
    );

    assert.match(
      app,
      /class="row adjustment-readonly-row"/
    );

    assert.match(
      app,
      /Данные обновляются автоматически\./
    );

    assert.match(
      styles,
      /\.shead\{[^}]*grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/
    );

    assert.match(
      styles,
      /\.adjustment-readonly-row \.t\{[\s\S]*white-space:normal;[\s\S]*overflow-wrap:anywhere;/
    );

    for(const label of [
      "Дата",
      "ПВЗ",
      "Тип",
      "Часы",
      "Объём",
      "Смена"
    ]){
      assert.match(
        app,
        new RegExp(
          `class="row shift-detail-readonly-row"[^\\n]*class="s">${label}<\\/div><div class="t">`
        )
      );
    }

    assert.match(
      styles,
      /\.shift-detail-readonly-row \.s\{\s*margin:0 0 3px;/
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
      /class="employee-secret-input"[\s\S]*type="text"[\s\S]*id="employeePassword"/
    );

    assert.doesNotMatch(
      app,
      /type="password"/
    );

    assert.match(
      app,
      /class="employee-secret-mask"[\s\S]*"•"\.repeat/
    );

    assert.match(
      styles,
      /\.employee-secret-input:not\(\.is-visible\) input\{[\s\S]*color:transparent;/
    );

    assert.match(
      app,
      /pendingMonthWheelDirections/
    );

    assert.match(
      app,
      /id="statsEmployeeOpen"/
    );

    assert.match(
      app,
      /function statsEmployeeOptions\(\)\{\s*return teamData\.employees\.slice\(\);\s*\}/
    );

    assert.doesNotMatch(
      app,
      /statsPointId|statsPointOpen|stats-point/
    );

    assert.match(
      app,
      /const statsShifts=[\s\S]*shift\.employeeId===[\s\S]*selectedEmployee\.id[\s\S]*: \[\];/
    );

    const statsView=
      app.slice(
        app.indexOf(
          "function viewStats()"
        ),
        app.indexOf(
          "function statsEmployeeOptions()"
        )
      );

    assert.doesNotMatch(
      statsView,
      /shift\.dbPointId/
    );

    assert.match(
      statsView,
      /"Выберите сотрудника"[\s\S]*"Сотрудники не добавлены"/
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
      /app-picker-anchored[\s\S]*applyPointPickerValue\(\)/
    );

    assert.match(
      styles,
      /\.point-veil\.app-picker-anchored-veil\{[\s\S]*background:transparent;[\s\S]*transition:none;/
    );

    assert.match(
      styles,
      /\.point-picker\.app-picker-anchored\{[\s\S]*opacity:0;[\s\S]*transform \.16s ease-out,[\s\S]*opacity \.13s ease-out;/
    );

    assert.match(
      app,
      /app-picker-anchored-veil[\s\S]*pointPickerHideTimer=setTimeout\([\s\S]*finishClose,[\s\S]*160/
    );

    assert.match(
      app,
      /picker\.style\.transition="none";[\s\S]*positionAppPicker\([\s\S]*picker\.style\.removeProperty\("transition"\);[\s\S]*picker\.classList\.add\("on"\)/
    );

    assert.match(
      app,
      /veil\.classList\.remove\("on"\);[\s\S]*void veil\.offsetHeight;[\s\S]*veil\.classList\.remove\([\s\S]*"app-picker-anchored-veil"/
    );

    assert.match(
      styles,
      /\.point-picker\.app-picker-anchored \.picker-toolbar\{\s*display:none;/
    );

    assert.match(
      app,
      /id="f-employee-open"/
    );

    assert.match(
      app,
      /employeeId:"",[\s\S]*employeeName:"",[\s\S]*dbPointId:"",[\s\S]*pointId:"",[\s\S]*point:""/
    );

    assert.match(
      app,
      /const pointChanged=[\s\S]*draft\.dbPointId!==point\.id;[\s\S]*if\(pointChanged\)\{[\s\S]*draft\.employeeId="";/
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
      /<div class="ml">\$\{label\}<\/div>[\s\S]*employee-empty[\s\S]*В этом месяце смен пока нет\./
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

    assert.match(
      app,
      /<div class="ml">Фильтры<\/div>[\s\S]*id="statsEmployeeOpen"/
    );

    assert.doesNotMatch(
      app,
      /id="statsPointOpen"/
    );

    assert.match(
      app,
      /Пункты выдачи и тарифы/
    );

    assert.match(
      app,
      /id="pointSearch"/
    );

    assert.match(
      app,
      /id="pointFilterOpen"[\s\S]*Авансные ПВЗ[\s\S]*Остальные ПВЗ/
    );

    assert.match(
      app,
      /function filteredManagePoints\(\)[\s\S]*point\.advance_enabled/
    );

    assert.match(
      styles,
      /\.point-manage-row\{[\s\S]*min-height:54px;/
    );

    assert.match(
      app,
      /id="manageTariffAdd"/
    );

    assert.doesNotMatch(
      app,
      /Новая версия тарифа/
    );

    assert.match(
      app,
      /function pointInformationHTML/
    );

    assert.doesNotMatch(
      app,
      /managePointSort|<div class="s">Порядок<\/div>/
    );

    assert.match(
      app,
      /function filteredManagePoints\(\)[\s\S]*orderedTeamPoints\(\)/
    );

    assert.match(
      app,
      /<details class="tariff-history-item">/
    );

    assert.doesNotMatch(
      app,
      /Система оплаты/
    );

    assert.match(
      app,
      /\? "Фиксированный"\s+: "По ШК";/
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
        "supabase/migrations/20260823230320_complete_team_workflow.sql"
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
        "supabase/migrations/20260823230333_employee_phone_realtime.sql"
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

    assert.match(
      team,
      /\n    accounts,\n/
    );

    assert.doesNotMatch(
      team,
      /email:null/
    );
  }
);

test(
  "employee deletion removes auth access and keeps only a minimal audit tombstone",
  async()=>{
    const migration=
      await read(
        "supabase/migrations/20260824225714_safe_deletion_cleanup.sql"
      );

    const edge=
      await read(
        "supabase/functions/admin-employee-auth/index.ts"
      );

    const team=
      await read(
        "src/team.js"
      );

    const app=
      await read(
        "src/app.js"
      );

    assert.match(
      edge,
      /admin_begin_employee_deletion[\s\S]*deleteUser\(authUserId\)[\s\S]*admin_finalize_employee_deletion/
    );

    assert.match(
      edge,
      /employee\.status==="inactive"[\s\S]*ban_duration/
    );

    assert.match(
      migration,
      /delete from public\.audit_log[\s\S]*entity_id = object_id/
    );

    assert.match(
      migration,
      /admin_rollback_employee_creation/
    );

    assert.match(
      migration,
      /lock table public\.shifts[\s\S]*share row exclusive/
    );

    assert.match(
      migration,
      /shifts_block_deleting_employee/
    );

    assert.match(
      migration,
      /shifts_select_own_or_admin[\s\S]*e\.status = 'active'[\s\S]*not e\.deletion_pending/
    );

    assert.match(
      migration,
      /shift_bonuses_select_own_or_admin[\s\S]*e\.status = 'active'/
    );

    assert.match(
      migration,
      /shift_penalties_select_own_or_admin[\s\S]*e\.status = 'active'/
    );

    assert.match(
      team,
      /action:"delete",[\s\S]*employeeId:id/
    );

    assert.match(
      app,
      /Сотрудник находится в архиве/
    );

    assert.match(
      app,
      /rollbackAdminEmployeeCreation\([\s\S]*Аккаунт не создан, карточка не сохранена/
    );

    assert.match(
      edge,
      /ALLOWED_ORIGINS[\s\S]*origin_not_allowed/
    );

    assert.doesNotMatch(
      team,
      /SUPABASE_SERVICE_ROLE_KEY/
    );
  }
);

test(
  "manual shift pay is admin-only, atomic and keeps the tariff snapshot intact",
  async()=>{
    const migration=
      await read(
        "supabase/migrations/20260825110804_support_manual_shift_pay.sql"
      );

    const team=
      await read(
        "src/team.js"
      );

    const app=
      await read(
        "src/app.js"
      );

    assert.match(
      migration,
      /admin_save_shift_v2[\s\S]*security definer[\s\S]*set search_path = ''/
    );

    assert.match(
      migration,
      /public\.admin_save_shift\([\s\S]*base_amount = v_effective_base/
    );

    assert.match(
      migration,
      /shift_base_amount_comment_required/
    );

    assert.match(
      migration,
      /revoke all on function public\.admin_save_shift_v2[\s\S]*from public, anon/
    );

    assert.doesNotMatch(
      migration,
      /pricing_snapshot\s*=/
    );

    assert.match(
      team,
      /\.rpc\(\s*"admin_save_shift_v2"[\s\S]*p_base_amount_override/
    );

    assert.match(
      app,
      /data-pay-mode="tariff"[\s\S]*По тарифу[\s\S]*data-pay-mode="manual"[\s\S]*Корректировка оклада/
    );

    assert.match(
      app,
      /manualPayment \? `[\s\S]*id="f-base-override"[\s\S]*Укажите фактическую сумму за смену, а причину — в комментарии/
    );

    assert.match(
      app,
      /draft\.baseOverrideMode=[\s\S]*t\.dataset\.payMode[\s\S]*draft\.baseOverride="";/
    );
  }
);

test(
  "penalty payout targeting is nullable, validated and saved atomically",
  async()=>{
    const migration=
      await read(
        "supabase/migrations/20260901194500_add_penalty_payout_kind.sql"
      );

    const team=
      await read(
        "src/team.js"
      );

    const app=
      await read(
        "src/app.js"
      );

    assert.match(
      migration,
      /add column if not exists payout_kind text/
    );

    assert.match(
      migration,
      /payout_kind is null[\s\S]*first_half[\s\S]*second_half/
    );

    assert.match(
      migration,
      /replace_shift_adjustments[\s\S]*set search_path = ''[\s\S]*payout_kind = excluded\.payout_kind/
    );

    assert.match(
      team,
      /penalties:shift_penalties\([\s\S]*payout_kind/
    );

    assert.match(
      app,
      /Удержать из выплаты[\s\S]*data-penalty-payout-kind/
    );
  }
);

test(
  "substitute employees keep full accounting access without requiring a login account",
  async()=>{
    const migration=
      await read(
        "supabase/migrations/20260902073338_add_employee_employment_type.sql"
      );

    const team=
      await read(
        "src/team.js"
      );

    const app=
      await read(
        "src/app.js"
      );

    assert.match(
      migration,
      /add column if not exists employment_type text not null default 'staff'/
    );

    assert.match(
      migration,
      /employment_type in \('staff', 'substitute'\)/
    );

    assert.match(
      migration,
      /security definer[\s\S]*set search_path = ''/
    );

    assert.match(
      migration,
      /grant execute on function public\.admin_save_employee_profile\([\s\S]*uuid\[\], text[\s\S]*\) to authenticated/
    );

    assert.match(
      team,
      /p_employment_type:[\s\S]*employmentType/
    );

    assert.match(
      app,
      /data-employee-type="substitute"[\s\S]*Подмена/
    );

    assert.match(
      app,
      /data-employee-account-mode="none"[\s\S]*Без аккаунта[\s\S]*data-employee-account-mode="create"/
    );

    assert.match(
      app,
      /employeeDraft\.userId \|\|[\s\S]*employeeDraft\.accountEnabled/
    );
  }
);
