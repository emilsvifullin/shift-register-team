import {
  readdir
} from "node:fs/promises";

import {
  spawnSync
} from "node:child_process";

import {
  join
} from "node:path";

async function javascriptFiles(
  directory
){
  const entries=
    await readdir(
      directory,
      {
        withFileTypes:true
      }
    );

  const files=[];

  for(const entry of entries){
    const path=
      join(
        directory,
        entry.name
      );

    if(entry.isDirectory()){
      files.push(
        ...await javascriptFiles(path)
      );
      continue;
    }

    if(
      entry.isFile() &&
      entry.name.endsWith(".js")
    ){
      files.push(path);
    }
  }

  return files;
}

const files=[
  "sw.js",
  ...await javascriptFiles("src")
].sort();

for(const file of files){
  const result=
    spawnSync(
      process.execPath,
      [
        "--check",
        file
      ],
      {
        stdio:"inherit"
      }
    );

  if(result.status!==0){
    process.exit(
      result.status || 1
    );
  }
}

console.log(
  `Syntax OK: ${files.length} JavaScript files`
);
