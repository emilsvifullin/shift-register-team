import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>
  readFile(
    new URL(`../${path}`,import.meta.url),
    "utf8"
  );

const migrationPath=
  "supabase/migrations/20260912180551_fix_employee_payout_delete_and_add_point_delete.sql";

const cascadePath=
  "supabase/migrations/20260922120000_delete_point_with_history.sql";

test("employee deletion cascades payout rows without weakening shift history protection",async()=>{
  const [migration,safeDeletion]=
    await Promise.all([
      read(migrationPath),
      read(
        "supabase/migrations/20260824225714_safe_deletion_cleanup.sql"
      )
    ]);

  assert.match(
    migration,
    /employee_payouts_employee_id_fkey[\s\S]*?references public\.employees\(id\)[\s\S]*?on delete cascade/i
  );

  assert.match(
    safeDeletion,
    /admin_begin_employee_deletion[\s\S]*?employee_has_history/i
  );

  assert.match(
    safeDeletion,
    /admin_finalize_employee_deletion[\s\S]*?employee_has_history/i
  );
});

/*
  Удаление ПВЗ — полное: архив его не заменяет. Но оно необратимо и
  уносит смены, по которым считались выплаты, поэтому защищено с обеих
  сторон: набором названия в интерфейсе и сверкой того же названия на
  сервере.
*/
test("deleting a point removes its history and is hard to trigger by accident",async()=>{
  const [migration,pointsApi,app,indexHtml]=
    await Promise.all([
      read(cascadePath),
      read("src/api/points.js"),
      read("src/app.js"),
      read("index.html")
    ]);

  assert.match(
    migration,
    /create or replace function public\.admin_delete_point_cascade/i
  );

  assert.match(
    migration,
    /private\.is_admin\(\)/i
  );

  /*
    Порядок задан связями: points <- shifts стоит на restrict, поэтому
    смены уходят раньше самого ПВЗ.
  */
  assert.match(
    migration,
    /delete from public\.shifts\s*\n\s*where point_id = p_point_id;[\s\S]*?delete from public\.points/i
  );

  /* Сервер удаляет ровно то, что назвал человек. */
  assert.match(
    migration,
    /point_name_mismatch/
  );

  assert.match(
    migration,
    /grant execute on function public\.admin_delete_point_cascade\(uuid, text\)[\s\S]*?to authenticated/i
  );

  /*
    Журнал и записи о выплаченных деньгах переживают удаление: первый —
    след того, что было снято, вторые — факт выплаты, привязанный к
    сотруднику, а не к ПВЗ.
  */
  assert.doesNotMatch(
    migration,
    /delete from public\.(audit_log|employee_payouts)/i
  );

  assert.match(
    pointsApi,
    /export async function deleteAdminPointWithHistory[\s\S]*?"admin_delete_point_cascade"[\s\S]*?p_point_name/
  );

  /*
    Удаление живёт в самом редакторе ПВЗ: подтверждение, вызов API и
    ошибка показываются одним владельцем экрана.
  */
  assert.match(
    app,
    /id="managePointDelete"/
  );

  assert.match(
    app,
    /async function deleteManagedPoint\(\)/
  );

  /* Подтверждение — набор названия, а не одна кнопка. */
  assert.match(
    app,
    /appConfirm\([\s\S]*?confirm:point\.name/
  );

  /*
    Необратимость названа там, где её нельзя пропустить: в заголовке и на
    самой кнопке. Отдельной строкой в пояснении она повторяла то же
    третий раз.
  */
  assert.match(
    app,
    /навсегда\?`/
  );

  assert.match(
    app,
    /okText:"Удалить навсегда"/
  );

  assert.match(
    app,
    /deleteAdminPointWithHistory\(\{[\s\S]*?id:point\.id,[\s\S]*?name:point\.name/
  );

  /* Кнопка оживает только на точном совпадении. */
  assert.match(
    app,
    /appConfirmExpected[\s\S]*?ok\.disabled=Boolean\(confirm\)/
  );

  assert.match(
    indexHtml,
    /id="appConfirmInput"/
  );

  /* Архив больше не предлагается вместо удаления. */
  assert.doesNotMatch(
    app,
    /используйте архив/i
  );
});

test("phone bottom navigation uses the same horizontal gutter as page content",async()=>{
  const css=await read(
    "styles/management.css"
  );

  assert.match(
    css,
    /@media \(max-width:520px\)[\s\S]*?\.bottom-controls\{[\s\S]*?padding-left:calc\(var\(--ui-gutter,16px\) \+ env\(safe-area-inset-left\)\)[\s\S]*?padding-right:calc\(var\(--ui-gutter,16px\) \+ env\(safe-area-inset-right\)\)[\s\S]*?nav\.tabs\{[\s\S]*?width:100%/
  );
});
