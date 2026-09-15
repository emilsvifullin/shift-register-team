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

/*
  Узел без ключа может достаться другой строке или новой форме. Ввод,
  оставленный в нём, уходил в сохранение: ступень тарифа получала ставку
  удалённой строки, а новая смена — ШК и комментарий предыдущей.
*/
const rateRows=rates=>rates
  .map(rate=>`
    <div class="row">
      <input type="text" data-rate value="${rate}">
    </div>
  `)
  .join("");

test(
  "a field nobody is editing takes its value from the markup",
  async({page})=>{
    await page.goto(FIXTURE);

    await patch(page,rateRows(["3000","6500","6500"]));

    await page.locator("[data-rate]").nth(1).fill("5000");
    await page.evaluate(()=>document.activeElement.blur());

    await patch(page,rateRows(["3000","6500"]));

    expect(
      await page.locator("[data-rate]").evaluateAll(inputs=>
        inputs.map(input=>input.value)
      )
    ).toEqual(["3000","6500"]);
  }
);

test(
  "a reopened form does not keep what was typed into the previous one",
  async({page})=>{
    await page.goto(FIXTURE);

    const form=`
      <input type="number" id="shk" value="">
      <input type="checkbox" id="partial">
      <select id="kind">
        <option value="main">Основная</option>
        <option value="extra">Дополнительная</option>
      </select>
    `;

    await patch(page,form);

    await page.locator("#shk").fill("150");
    await page.locator("#partial").check();
    await page.locator("#kind").selectOption("extra");
    await page.evaluate(()=>document.activeElement?.blur());

    await patch(page,form);

    expect(
      await page.evaluate(()=>({
        shk:document.getElementById("shk").value,
        partial:document.getElementById("partial").checked,
        kind:document.getElementById("kind").value
      }))
    ).toEqual({
      shk:"",
      partial:false,
      kind:"main"
    });
  }
);

test(
  "field attributes set at runtime by the input layer survive a render",
  async({page})=>{
    await page.goto(FIXTURE);

    const field=value=>`<input type="search" id="search" value="${value}">`;

    await patch(page,field(""));

    await page.evaluate(()=>{
      const input=document.getElementById("search");
      input.setAttribute("autocomplete","off");
      input.setAttribute("data-1p-ignore","true");
      input.setAttribute("data-lpignore","true");
      input.setAttribute("data-form-type","other");
    });

    await patch(page,field("Кораб"));

    expect(
      await page.evaluate(()=>{
        const input=document.getElementById("search");

        return [
          "autocomplete",
          "data-1p-ignore",
          "data-lpignore",
          "data-form-type"
        ].map(name=>input.getAttribute(name));
      })
    ).toEqual(["off","true","true","other"]);
  }
);

/*
  Узел, который достался другому элементу экрана, не приносит с собой ни
  фокус, ни состояние нажатия: иначе после перехода между разделами белая
  рамка выделения оказывалась на элементе, которого никто не нажимал.
*/
test(
  "a node reused for another element does not carry focus or press state",
  async({page})=>{
    await page.goto(FIXTURE);

    await patch(
      page,
      `<button type="button" data-manage-section="employees">Сотрудники</button>`
    );

    await page.evaluate(()=>{
      const button=document.querySelector("[data-manage-section]");

      button.focus();
      button.classList.add("touch-active");
    });

    await patch(
      page,
      `<button type="button" id="statsEmployeeOpen">Выберите сотрудника</button>`
    );

    expect(
      await page.evaluate(()=>{
        const button=document.getElementById("statsEmployeeOpen");

        return {
          focused:document.activeElement===button,
          pressed:button.classList.contains("touch-active"),
          active:document.activeElement.tagName
        };
      })
    ).toEqual({focused:false,pressed:false,active:"BODY"});
  }
);

test(
  "a keyed row is never built from an unrelated node",
  async({page})=>{
    await page.goto(FIXTURE);

    await patch(page,`<div class="card">старая карточка</div>`);

    await page.evaluate(()=>{
      document.querySelector(".card").identityStamp="old";
    });

    await patch(page,`<div class="card" data-key="row-1">строка</div>`);

    expect(
      await page.evaluate(()=>
        document.querySelector("[data-key]").identityStamp ?? null
      )
    ).toBe(null);
  }
);
