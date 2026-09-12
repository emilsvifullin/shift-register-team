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

test("point deletion is admin-only and refuses points with shift history",async()=>{
  const [migration,pointsApi,navigation]=
    await Promise.all([
      read(migrationPath),
      read("src/api/points.js"),
      read("src/management-navigation.js")
    ]);

  assert.match(
    migration,
    /create or replace function public\.admin_delete_point/i
  );
  assert.match(
    migration,
    /private\.is_admin\(\)/i
  );
  assert.match(
    migration,
    /from public\.shifts[\s\S]*?point_has_history/i
  );
  assert.match(
    migration,
    /grant execute on function public\.admin_delete_point\(uuid\)[\s\S]*?to authenticated/i
  );

  assert.match(
    pointsApi,
    /export async function deleteAdminPoint[\s\S]*?"admin_delete_point"/
  );

  assert.match(
    navigation,
    /POINT_DELETE_BUTTON_ID="managePointDelete"/
  );
  assert.match(
    navigation,
    /selectedPointId[\s\S]*?pointEditorOpen\(\)[\s\S]*?pointEditing\(\)/
  );
  assert.match(
    navigation,
    /await deleteAdminPoint\([\s\S]*?pointId[\s\S]*?\)/
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
