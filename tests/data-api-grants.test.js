import test from "node:test";
import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";

/*
  Права на таблицы в public задаёт репозиторий, а не платформа.

  С 30 октября 2026 Supabase перестаёт раздавать права на новые объекты в
  public. До этого дня умолчание работает наоборот: новая таблица сразу
  достаётся anon и authenticated со всеми правами. Обе ошибки молчаливые
  — забытая строка либо открывает таблицу всему интернету, либо оставляет
  её недоступной приложению, — и какая именно случится, зависит лишь от
  того, когда проиграна миграция.

  Поэтому здесь проверяется не живая база, а сами миграции: каждая
  созданная таблица обязана получить явное решение о правах, и это
  решение не должно выходить за пределы того, что приложению нужно.
*/

const MIGRATIONS=new URL(
  "../supabase/migrations/",
  import.meta.url
);

async function migrationSql(){
  const files=(await readdir(MIGRATIONS))
    .filter(name=>name.endsWith(".sql"))
    .sort();

  const parts=await Promise.all(
    files.map(async name=>({
      name,
      sql:await readFile(
        new URL(name,MIGRATIONS),
        "utf8"
      )
    }))
  );

  return parts;
}

/* Комментарии — не решение о правах, поэтому в разборе их нет. */
function statements(sql){
  return sql
    .split("\n")
    .filter(line=>!line.trim().startsWith("--"))
    .join("\n");
}

function createdTables(sql){
  return [
    ...statements(sql).matchAll(
      /create table\s+(?:if not exists\s+)?public\.([a-z_]+)/gi
    )
  ].map(match=>match[1]);
}

const DML=["SELECT","INSERT","UPDATE","DELETE"];

/*
  Права разбираются так же, как их применил бы Postgres: по порядку
  миграций, grant добавляет, revoke убирает. Проверять каждый файл по
  отдельности нельзя — ранняя миграция выдала authenticated полный CRUD,
  а следующая его отозвала; важен итог, то есть состояние базы,
  восстановленной с нуля.
*/
function applyPrivileges(parts){
  const state=new Map();

  const touch=table=>{
    if(!state.has(table)){
      state.set(table,new Map());
    }

    return state.get(table);
  };

  const pattern=
    /\b(grant|revoke)\s+([a-z, ]+?)\s+on\s+(?:table\s+)?([^;]+?)\s+(?:to|from)\s+([^;]+);/gi;

  for(const part of parts){
    for(const table of createdTables(part.sql)){
      touch(table);
    }

    /*
      `alter default privileges ... revoke all on tables` говорит о
      будущих объектах, а не о таблице по имени «tables»: к разбору прав
      на конкретные таблицы он отношения не имеет.
    */
    const sql=statements(part.sql).replace(
      /alter default privileges[\s\S]*?;/gi,
      ""
    );

    for(const match of sql.matchAll(pattern)){
      const [,action,rawPrivileges,rawTables,rawRoles]=match;

      /* Права на функции и схемы к таблицам отношения не имеют. */
      if(/function|schema|sequence|\(/i.test(rawTables)){
        continue;
      }

      const privileges=/\ball\b/i.test(rawPrivileges)
        ? DML
        : rawPrivileges
            .split(",")
            .map(item=>item.trim().toUpperCase())
            .filter(item=>DML.includes(item));

      const roles=rawRoles
        .split(",")
        .map(item=>item.trim());

      const tables=rawTables
        .split(",")
        .map(item=>item.trim().replace(/^public\./,""))
        .filter(item=>/^[a-z_]+$/.test(item));

      for(const table of tables){
        const owners=touch(table);

        for(const role of roles){
          const held=owners.get(role) || new Set();

          for(const privilege of privileges){
            if(action.toLowerCase()==="grant"){
              held.add(privilege);
            }else{
              held.delete(privilege);
            }
          }

          owners.set(role,held);
        }
      }
    }
  }

  return state;
}

test(
  "a database restored from migrations gives authenticated exactly select",
  async()=>{
    const parts=await migrationSql();
    const state=applyPrivileges(parts);

    assert.ok(
      state.size>=10,
      "разбор миграций должен находить таблицы"
    );

    const problems=[];

    for(const [table,roles] of state){
      const authenticated=[
        ...(roles.get("authenticated") || new Set())
      ].sort();

      if(authenticated.join(",")!=="SELECT"){
        problems.push(
          `${table}: authenticated → ${authenticated.join(",") || "ничего"}`
        );
      }
    }

    /*
      Таблица без select невидима для Data API после 30 октября 2026,
      а любое право сверх select обходит функции security definer.
    */
    assert.deepEqual(problems,[]);
  }
);

test(
  "no table created by migrations is left reachable by anon",
  async()=>{
    const parts=await migrationSql();
    const state=applyPrivileges(parts);

    const exposed=[];

    for(const [table,roles] of state){
      const anon=[...(roles.get("anon") || new Set())];

      if(anon.length){
        exposed.push(`${table}: ${anon.sort().join(",")}`);
      }
    }

    /* До входа приложение не читает ни одной таблицы. */
    assert.deepEqual(exposed,[]);
  }
);

test(
  "the platform default for future tables is revoked by a migration",
  async()=>{
    const parts=await migrationSql();
    const all=parts.map(part=>statements(part.sql)).join("\n");

    /*
      Пример из письма Supabase снимает только четыре права, и новая
      таблица всё равно достаётся anon с references, trigger и truncate.
      Здесь снимается всё.
    */
    assert.match(
      all,
      /alter default privileges for role postgres in schema public\s+revoke all on tables\s+from anon, authenticated, service_role;/i
    );

    assert.match(
      all,
      /alter default privileges for role postgres in schema public\s+revoke all on sequences\s+from anon, authenticated, service_role;/i
    );

    /* Восстановление с нуля проверяет итог само. */
    assert.match(
      all,
      /anon получил доступ к таблицам/
    );

    assert.match(
      all,
      /у authenticated лишние права/
    );

    assert.match(
      all,
      /таблицы без доступа для authenticated/
    );
  }
);
