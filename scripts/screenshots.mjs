/*
  Снимки экранов настоящего приложения и сравнение двух прогонов.

  Нужен, когда правка касается CSS: тест «до/после» показывает, какие
  экраны изменились и насколько, вместо того чтобы полагаться на глаз.

    node ./scripts/screenshots.mjs capture /tmp/before
    …правка…
    node ./scripts/screenshots.mjs capture /tmp/after
    node ./scripts/screenshots.mjs diff /tmp/before /tmp/after

  Требуется запущенный статический сервер на 127.0.0.1:4173 и
  установленный @playwright/test (как в browser-джобе CI).
*/

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  existsSync
} from "node:fs";

import {chromium} from "@playwright/test";

import {
  openApp
} from "../e2e/support/supabase-stub.mjs";

import {
  SCREENS
} from "../e2e/support/screens.mjs";

const THEMES=["dark","light"];

const SIZES=[
  {name:"phone",width:390,height:844,touch:true},
  {name:"laptop",width:1440,height:900,touch:false}
];

async function capture(target){
  mkdirSync(target,{recursive:true});

  const browser=await chromium.launch();
  let failures=0;

  for(const theme of THEMES){
    for(const size of SIZES){
      for(const screen of SCREENS){
        const page=await browser.newPage({
          viewport:{
            width:size.width,
            height:size.height
          },
          colorScheme:theme,
          hasTouch:size.touch,
          deviceScaleFactor:1
        });

        try{
          await openApp(page);
          await screen.open(page);
          await page.waitForTimeout(700);

          await page.screenshot({
            path:`${target}/${theme}-${size.name}-${screen.name}.png`
          });
        }catch(error){
          failures++;
          console.log(
            "failed",
            theme,
            size.name,
            screen.name,
            error.message.split("\n")[0]
          );
        }

        await page.close();
      }
    }
  }

  await browser.close();

  console.log(
    `captured into ${target}${failures ? ` (${failures} failed)` : ""}`
  );
}

async function diff(before,after){
  const browser=await chromium.launch();
  const page=await browser.newPage();
  await page.goto("about:blank");

  const dataUrl=file=>
    "data:image/png;base64,"+
    readFileSync(file).toString("base64");

  const names=readdirSync(before)
    .filter(name=>name.endsWith(".png"));

  let identical=0;
  const changed=[];

  for(const name of names){
    if(!existsSync(`${after}/${name}`)){
      changed.push(`${name} — missing`);
      continue;
    }

    const result=await page.evaluate(
      async([a,b])=>{
        const load=source=>
          new Promise(resolve=>{
            const image=new Image();
            image.onload=()=>resolve(image);
            image.src=source;
          });

        const [first,second]=await Promise.all([
          load(a),
          load(b)
        ]);

        if(
          first.width!==second.width ||
          first.height!==second.height
        ){
          return {resized:true};
        }

        const canvas=document.createElement("canvas");
        canvas.width=first.width;
        canvas.height=first.height;

        const context=canvas.getContext(
          "2d",
          {willReadFrequently:true}
        );

        context.drawImage(first,0,0);
        const left=context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;

        context.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );
        context.drawImage(second,0,0);
        const right=context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;

        let pixels=0;
        let maximum=0;
        let box=null;

        for(let index=0;index<left.length;index+=4){
          const delta=Math.max(
            Math.abs(left[index]-right[index]),
            Math.abs(left[index+1]-right[index+1]),
            Math.abs(left[index+2]-right[index+2])
          );

          if(!delta){
            continue;
          }

          pixels++;
          maximum=Math.max(maximum,delta);

          const position=index/4;
          const x=position%canvas.width;
          const y=Math.floor(position/canvas.width);

          box=box
            ? [
                Math.min(box[0],x),
                Math.min(box[1],y),
                Math.max(box[2],x),
                Math.max(box[3],y)
              ]
            : [x,y,x,y];
        }

        return {
          pixels,
          maximum,
          box,
          total:left.length/4
        };
      },
      [
        dataUrl(`${before}/${name}`),
        dataUrl(`${after}/${name}`)
      ]
    );

    if(result.resized){
      changed.push(`${name} — different size`);
      continue;
    }

    if(!result.pixels){
      identical++;
      continue;
    }

    changed.push(
      `${name} — ${result.pixels} px ` +
      `(${(result.pixels/result.total*100).toFixed(3)}%) ` +
      `maxΔ=${result.maximum} box=${result.box}`
    );
  }

  await browser.close();

  console.log(
    `identical: ${identical}/${names.length}`
  );

  for(const line of changed){
    console.log("  "+line);
  }

  return changed.length;
}

const [command,...rest]=process.argv.slice(2);

if(command==="capture" && rest[0]){
  await capture(rest[0]);
}else if(command==="diff" && rest.length===2){
  process.exitCode=await diff(rest[0],rest[1])
    ? 1
    : 0;
}else{
  console.log(
    "usage: screenshots.mjs capture <dir> | diff <before> <after>"
  );

  process.exitCode=1;
}
