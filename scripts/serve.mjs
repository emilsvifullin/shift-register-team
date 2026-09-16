/*
  Статический сервер для браузерных тестов и снимков экрана.

  Раньше тесты шли через `python3 -m http.server`: у него очередь входящих
  соединений на пять запросов. Приложение при старте запрашивает десятки
  модулей и стилей разом, и на macOS лишние соединения сбрасывались —
  модуль не загружался, приложение не стартовало, а тест падал по таймауту
  так, будто завис сам экран.

    node ./scripts/serve.mjs [порт]   по умолчанию 4173
*/

import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {createServer} from "node:http";
import {extname,join,normalize,sep} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const port=Number(process.argv[2] || process.env.PORT || 4173);

const TYPES={
  ".css":"text/css; charset=utf-8",
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".png":"image/png",
  ".svg":"image/svg+xml",
  ".webmanifest":"application/manifest+json"
};

const server=createServer(async(request,response)=>{
  let path;

  try{
    path=decodeURIComponent(
      new URL(request.url,"http://localhost").pathname
    );
  }catch{
    response.writeHead(400).end();
    return;
  }

  if(path.endsWith("/")){
    path+="index.html";
  }

  const file=normalize(join(root,path));

  if(!file.startsWith(root) || file.split(sep).includes(".git")){
    response.writeHead(403).end();
    return;
  }

  try{
    const info=await stat(file);

    if(!info.isFile()){
      throw new Error("not a file");
    }

    response.writeHead(200,{
      "content-type":TYPES[extname(file)] || "application/octet-stream",
      "content-length":info.size,
      "cache-control":"no-cache"
    });

    createReadStream(file).pipe(response);
  }catch{
    response.writeHead(404,{"content-type":"text/plain; charset=utf-8"});
    response.end("not found");
  }
});

server.listen(port,"127.0.0.1",511,()=>{
  console.log(`Shift Register: http://127.0.0.1:${port}/`);
});
