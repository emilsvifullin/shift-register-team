import {
  test,
  expect
} from "@playwright/test";

const FIXTURE=
  "http://127.0.0.1:4173/tests/fixtures/dom-patch.html";

const list=items=>`
  <div class="ml">Список</div>
  <div class="card" id="listCard">
    ${items
      .map(item=>`
        <button type="button" class="row" data-key="row-${item}">
          <span class="title">Строка ${item}</span>
        </button>
      `)
      .join("")}
  </div>
`;

async function patch(page,html){
  await page.evaluate(
    value=>globalThis.patchHost(value),
    html
  );
}

test(
  "reused rows keep their identity when the list is reordered",
  async({page})=>{
    await page.goto(FIXTURE);

    await patch(page,list([1,2,3]));

    await page.evaluate(()=>{
      document
        .querySelectorAll("[data-key]")
        .forEach((node,index)=>{
          node.identityStamp=index;
        });
    });

    await patch(page,list([3,1,2]));

    const stamps=await page.evaluate(()=>
      [...document.querySelectorAll("[data-key]")]
        .map(node=>
          `${node.dataset.key}:${node.identityStamp}`
        )
    );

    expect(stamps).toEqual([
      "row-3:2",
      "row-1:0",
      "row-2:1"
    ]);
  }
);

test(
  "focus, caret and typed text survive a re-render",
  async({page})=>{
    await page.goto(FIXTURE);

    const field=value=>`
      <input id="search" type="search" value="${value}">
      <div id="count">0</div>
    `;

    await patch(page,field(""));
    await page.click("#search");
    await page.keyboard.type("абвгд");
    await page.evaluate(()=>{
      const input=document.getElementById("search");
      input.setSelectionRange(2,2);
    });

    /*
      Приложение перерисовывает экран с тем же значением поля — как это
      происходит при любом фоновом обновлении данных.
    */
    await patch(page,`
      <input id="search" type="search" value="">
      <div id="count">7</div>
    `);

    const state=await page.evaluate(()=>{
      const input=document.getElementById("search");

      return {
        focused:document.activeElement===input,
        value:input.value,
        caret:input.selectionStart,
        count:document.getElementById("count")
          .textContent
      };
    });

    expect(state.focused).toBe(true);
    expect(state.value).toBe("абвгд");
    expect(state.caret).toBe(2);
    expect(state.count).toBe("7");
  }
);

test(
  "a changed value attribute still replaces the field value",
  async({page})=>{
    await page.goto(FIXTURE);

    await patch(page,`<input id="search" type="search" value="один">`);
    await patch(page,`<input id="search" type="search" value="два">`);

    await expect(page.locator("#search")).toHaveValue("два");
  }
);

test(
  "scroll position and open details survive a re-render",
  async({page})=>{
    await page.goto(FIXTURE);

    const rows=Array.from(
      {length:40},
      (_,index)=>index+1
    );

    await patch(page,`
      <details id="history"><summary>История</summary><p>Тело</p></details>
      ${list(rows)}
    `);

    await page.evaluate(()=>{
      document.getElementById("history").open=true;
      document.getElementById("host").scrollTop=180;
    });

    await patch(page,`
      <details id="history"><summary>История</summary><p>Тело</p></details>
      ${list(rows)}
    `);

    const state=await page.evaluate(()=>({
      open:document.getElementById("history").open,
      scrollTop:document.getElementById("host").scrollTop
    }));

    expect(state.open).toBe(true);
    expect(state.scrollTop).toBe(180);
  }
);

test(
  "the element under an active press is not recreated",
  async({page})=>{
    await page.goto(FIXTURE);

    await patch(page,list([1,2,3]));

    await page.evaluate(()=>{
      const row=document.querySelector(
        '[data-key="row-2"]'
      );

      row.classList.add("touch-active");
      row.identityStamp="held";
    });

    await patch(page,list([1,2,3,4]));

    const state=await page.evaluate(()=>{
      const row=document.querySelector(
        '[data-key="row-2"]'
      );

      return {
        stamp:row.identityStamp,
        held:row.classList.contains(
          "touch-active"
        ),
        rows:document.querySelectorAll(
          "[data-key]"
        ).length
      };
    });

    expect(state.stamp).toBe("held");
    expect(state.held).toBe(true);
    expect(state.rows).toBe(4);
  }
);

test(
  "removed rows disappear and text updates in place",
  async({page})=>{
    await page.goto(FIXTURE);

    await patch(page,list([1,2,3,4,5]));
    await patch(page,list([2,4]));

    const keys=await page.evaluate(()=>
      [...document.querySelectorAll("[data-key]")]
        .map(node=>node.dataset.key)
    );

    expect(keys).toEqual([
      "row-2",
      "row-4"
    ]);

    await patch(page,`
      <div class="ml">Список</div>
      <div class="card" id="listCard">
        <div class="empty">Ничего не найдено</div>
      </div>
    `);

    await expect(
      page.locator("#listCard .empty")
    ).toHaveText("Ничего не найдено");
  }
);

test(
  "svg content is patched without losing its namespace",
  async({page})=>{
    await page.goto(FIXTURE);

    const chevron=path=>`
      <span id="icon">
        <svg viewBox="0 0 12 16"><path d="${path}"></path></svg>
      </span>
    `;

    await patch(page,chevron("M3 3L9 8L3 13"));
    await patch(page,chevron("M9 3L3 8L9 13"));

    const state=await page.evaluate(()=>{
      const svg=document.querySelector("#icon svg");

      return {
        namespace:svg.namespaceURI,
        path:svg.querySelector("path")
          .getAttribute("d")
      };
    });

    expect(state.namespace).toBe(
      "http://www.w3.org/2000/svg"
    );

    expect(state.path).toBe("M9 3L3 8L9 13");
  }
);

/*
  Инлайновую геометрию ставит рантайм (подгонка окна списка смен под
  высоту экрана). Рендер не должен сбрасывать её на кадр.
*/
test(
  "runtime inline geometry survives a re-render",
  async({page})=>{
    await page.goto(FIXTURE);

    await patch(page,`<div id="frame">Окно</div>`);

    await page.evaluate(()=>{
      const frame=document.getElementById("frame");
      frame.style.height="123px";
      frame.style.flex="0 0 auto";
    });

    await patch(page,`<div id="frame">Окно</div>`);

    expect(
      await page.evaluate(()=>
        document.getElementById("frame")
          .getAttribute("style")
      )
    ).toContain("123px");

    await patch(
      page,
      `<div id="frame" style="height:40px">Окно</div>`
    );

    expect(
      await page.evaluate(()=>
        document.getElementById("frame")
          .getAttribute("style")
      )
    ).toBe("height:40px");
  }
);
