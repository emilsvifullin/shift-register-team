/*
  Настоящий Postgres для проверки настоящих миграций.

  Заглушка e2e повторяет серверные правила на JavaScript, и расходиться с
  базой ей ничто не мешает: правило поменяли в SQL, а копия осталась
  прежней — браузерные тесты зелёные, production ведёт себя иначе. Эти
  тесты ставят базу из тех же файлов supabase/migrations/, что уходят в
  Supabase, и вызывают те же функции под той же ролью authenticated.

  Нужен только клиент psql и сервер Postgres: в CI это сервис-контейнер,
  локально — любой сервер, адрес которого лежит в PG* переменных
  окружения (PGHOST, PGPORT, PGUSER, PGPASSWORD). Каждый прогон создаёт
  свою базу и удаляет её в конце.
*/

import {
  spawnSync
} from "node:child_process";

import {
  readdirSync,
  readFileSync
} from "node:fs";

import {
  fileURLToPath
} from "node:url";

import path from "node:path";

const ROOT=path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const MIGRATIONS=path.join(ROOT,"supabase","migrations");

function psql(database,args,input=null){
  const result=spawnSync(
    "psql",
    [
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      database,
      ...args
    ],
    {
      input,
      encoding:"utf8",
      env:{
        ...process.env,
        PGOPTIONS:"--client-min-messages=warning"
      }
    }
  );

  if(result.error){
    throw result.error;
  }

  return result;
}

function must(result,what){
  if(result.status!==0){
    throw new Error(`${what}: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

/* Строковый литерал SQL. */
export function literal(value){
  if(value===null || value===undefined){
    return "null";
  }

  return `'${String(value).replace(/'/g,"''")}'`;
}

export function jsonLiteral(value){
  return `${literal(JSON.stringify(value))}::jsonb`;
}

export function createDatabase(){
  const name=`sr_contract_${process.pid}_${Date.now()}`;
  const admin=process.env.PGDATABASE || "postgres";

  must(
    psql(admin,["-c",`create database ${name}`]),
    "create database"
  );

  must(
    psql(name,["-f",path.join(ROOT,"db-tests","bootstrap.sql")]),
    "bootstrap"
  );

  for(const file of readdirSync(MIGRATIONS).filter(item=>item.endsWith(".sql")).sort()){
    must(
      psql(name,["-f",path.join(MIGRATIONS,file)]),
      file
    );
  }

  /*
    Запрос от имени суперпользователя: наполнение базы и чтение того,
    что проверяется. Результат — JSON последнего выражения.
  */
  function query(sql){
    const out=must(
      psql(name,[],`${sql}\n`),
      "query"
    ).trim();

    return out ? JSON.parse(out.split("\n").at(-1)) : null;
  }

  /*
    Вызов RPC так, как его делает PostgREST: роль authenticated,
    пользователь из JWT, одна транзакция на вызов. Ошибка возвращается
    текстом сообщения — тем, что увидит клиент.
  */
  function rpc(user,fn,args={}){
    const params=Object.entries(args)
      .map(([key,value])=>`${key} => ${value}`)
      .join(", ");

    const result=psql(
      name,
      [],
      [
        "begin;",
        "set local role authenticated;",
        `set local request.jwt.claim.sub = ${literal(user)};`,
        `select to_jsonb(public.${fn}(${params}));`,
        "commit;"
      ].join("\n")
    );

    if(result.status!==0){
      const message=result.stderr
        .split("\n")
        .find(line=>line.startsWith("ERROR:")) || result.stderr;

      return {
        error:message.replace(/^ERROR:\s*/,"").trim(),
        data:null
      };
    }

    const out=result.stdout.trim();

    return {
      error:null,
      data:out ? JSON.parse(out.split("\n").at(-1)) : null
    };
  }

  function drop(){
    psql(admin,["-c",`drop database if exists ${name} with (force)`]);
  }

  return {
    name,
    query,
    rpc,
    drop
  };
}

export function migrationSource(file){
  return readFileSync(path.join(MIGRATIONS,file),"utf8");
}
