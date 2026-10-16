import {test,expect} from "@playwright/test";
import {ADMIN_SEED,FROZEN_TODAY,openApp} from "./support/supabase-stub.mjs";
import {settleScreen} from "./support/settle.mjs";

function emptyPayrollSeed(){
  const seed=structuredClone(ADMIN_SEED);
  // Mode transitions require both actions to be available; zero accrual now
  // intentionally disables ordinary payout and is covered separately.
  seed.shifts=[{
    id:"earned-motion-shift",
    employee_id:"employee-1",point_id:"point-2",
    shift_date:"2026-09-10",shift_type:"main",
    base_amount:15000,partial:false,full_hours:12,
    pricing_snapshot:{version:2,fixed:true,pricingType:"fixed",rate:15000,fullHours:12},
    bonuses:[],penalties:[]
  }];
  seed.employee_points=[];
  seed.points.forEach(point=>{point.advance_enabled=false;});
  return seed;
}

async function openPayout(page){
  await openApp(page,{seed:emptyPayrollSeed()});
  await page.locator("#tab-stats").click();
  await settleScreen(page);
  await page.locator("#statsEmployeeOpen").click();
  await settleScreen(page);
  await page.locator('[data-stats-employee="employee-1"]').click();
  await settleScreen(page);
  await page.locator('[data-payout-toggle="first_half"]').click();
  await settleScreen(page);
}

async function openEditor(page){
  await page.locator('.payout-block.open [data-payout-add]').click();
  await expect(page.locator(".payout-editor")).toBeVisible();
  await settleScreen(page);
}

async function openCalendar(page){
  await page.locator('[data-payout-date-open]').click();
  await expect(page.locator('[data-payout-date-open]')).toHaveAttribute('aria-expanded','true');
  await settleScreen(page);
  return page.locator('#payoutDateCalendar');
}

async function touchCalendar(page,{dx,dy,clickAfter=false}){
  return page.locator('#payoutDateCalendar .date-grid').evaluate((grid,options)=>{
    const dispatch=(type,x,y)=>{
      const event=new Event(type,{bubbles:true,cancelable:true});
      const point={identifier:1,clientX:x,clientY:y};
      Object.defineProperties(event,{
        touches:{value:type==='touchend' ? [] : [point]},
        changedTouches:{value:[point]}
      });
      grid.dispatchEvent(event);
      return event.defaultPrevented;
    };
    dispatch('touchstart',180,180);
    const prevented=dispatch('touchmove',180+options.dx,180+options.dy);
    dispatch('touchend',180+options.dx,180+options.dy);
    if(options.clickAfter){
      // Browsers synthesize this click after a touch; it must not select a day.
      document.querySelector('#payoutDateCalendar .date-day:not(.outside)')
        .dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
    }
    return {prevented};
  },{dx,dy,clickAfter});
}

/*
  Read a real CSS transition at deterministic points on its own timeline.
  This proves intermediate layout without depending on a loaded runner's FPS.
  Resume it afterwards so cancellation and cleanup still run normally.
*/
async function sampleReveal(page,buttonSelector){
  return page.evaluate(async selector=>{
    const reveal=document.querySelector('.payout-block.open .payout-editor-reveal');
    const before=reveal.getBoundingClientRect().height;
    document.querySelector(selector).click();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const animation=reveal.getAnimations().find(item=>
      item.transitionProperty==='grid-template-rows'
    );
    const form=reveal.querySelector('.payout-editor');
    const result={
      before,
      open:reveal.classList.contains('on'),
      inert:Boolean(form?.closest('[inert]')),
      contentVisible:form ? getComputedStyle(form).visibility : null,
      running:animation?.playState==='running',
      heights:[]
    };
    if(animation){
      const duration=Number(animation.effect.getTiming().duration);
      animation.pause();
      for(const progress of [0,.5,1]){
        animation.currentTime=duration*progress;
        result.heights.push(reveal.getBoundingClientRect().height);
      }
      animation.currentTime=duration*.5;
      animation.play();
    }
    return result;
  },buttonSelector);
}

function expectIntermediateReveal(sample,opening){
  expect(sample.running).toBe(true);
  expect(sample.heights).toHaveLength(3);
  const [start,middle,end]=sample.heights;
  if(opening){
    expect(start).toBeLessThan(middle);
    expect(middle).toBeLessThan(end);
    expect(end).toBeGreaterThan(200);
  }else{
    expect(start).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(end);
    expect(end).toBeLessThan(1);
    expect(sample.contentVisible).toBe('visible');
    expect(sample.inert).toBe(true);
  }
}

for(const width of [390,1440]){
  for(const reducedMotion of ['no-preference','reduce']){
    test.describe(`payout motion at ${width}px, ${reducedMotion}`,()=>{
      test.use({viewport:{width,height:940},hasTouch:true,colorScheme:'dark',reducedMotion});

      test('editor opens and cancels in place with accessible cleanup',async({page})=>{
        await openPayout(page);
        const block=page.locator('.payout-block.open .payout-expanded');
        const positions=await block.evaluate(element=>{
          const box=element.getBoundingClientRect();
          const add=element.querySelector('[data-payout-add]').getBoundingClientRect();
          return {
            left:add.left-box.left,right:box.right-add.right,
            afterProgress:add.top>=element.querySelector('.payout-progress').getBoundingClientRect().bottom,
            afterDetails:add.top>=element.querySelector('.payout-breakdown').getBoundingClientRect().bottom
          };
        });
        expect(positions.left).toBeCloseTo(16,0);
        expect(positions.right).toBeCloseTo(16,0);
        expect(positions.afterProgress).toBe(true);
        expect(positions.afterDetails).toBe(true);

        const opening=await sampleReveal(page,'.payout-block.open [data-payout-add]');
        expect(opening.open).toBe(true);
        if(reducedMotion==='reduce') expect(opening.running).toBe(false);
        else expectIntermediateReveal(opening,true);
        await settleScreen(page);

        const geometry=await block.evaluate(element=>{
          const box=element.getBoundingClientRect();
          const editor=element.querySelector('.payout-editor').getBoundingClientRect();
          return {
            left:editor.left-box.left,right:box.right-editor.right,
            afterDetails:editor.top>=element.querySelector('.payout-breakdown').getBoundingClientRect().bottom,
            overflow:document.documentElement.scrollWidth>innerWidth
          };
        });
        expect(geometry.left).toBeCloseTo(16,0);
        expect(geometry.right).toBeCloseTo(16,0);
        expect(geometry.afterDetails).toBe(true);
        expect(geometry.overflow).toBe(false);
        const retainedAction=await block.locator('[data-payout-add]').evaluate(element=>({
          inert:Boolean(element.closest('[inert]')),
          revealHeight:element.closest('.field-reveal').getBoundingClientRect().height
        }));
        expect(retainedAction.inert).toBe(true);
        expect(retainedAction.revealHeight).toBeLessThan(1);

        const closing=await sampleReveal(page,'[data-payout-cancel]');
        expect(closing.open).toBe(false);
        if(reducedMotion==='reduce'){
          expect(closing.running).toBe(false);
          await expect(page.locator('.payout-editor')).toHaveCount(0);
        }else expectIntermediateReveal(closing,false);
        await expect(page.locator('.payout-editor')).toHaveCount(0);
        await expect(block.locator('[data-payout-add]')).toBeVisible();
        expect(await page.evaluate(()=>globalThis.__stubDb.employee_payouts.length)).toBe(0);
      });

      test('mode switch animates without replacing focused fields or their draft',async({page})=>{
        await openPayout(page);
        await openEditor(page);
        await page.locator('#payoutAmount').fill('12345,67');
        await page.locator('#payoutComment').fill('Согласованный аванс');
        const date=await page.locator('[data-payout-date-open]').textContent();
        const switched=await page.evaluate(async()=>{
          const amount=document.querySelector('#payoutAmount');
          const comment=document.querySelector('#payoutComment');
          amount.focus();
          amount.setSelectionRange(2,5);
          const mode=document.querySelector('.payout-mode');
          const before=getComputedStyle(mode,'::before').transform;
          document.querySelector('[data-payout-mode="advance"]').click();
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          return {
            sameAmount:amount===document.querySelector('#payoutAmount'),
            sameComment:comment===document.querySelector('#payoutComment'),
            focused:document.activeElement===amount,
            selection:[amount.selectionStart,amount.selectionEnd],
            before,
            running:mode.getAnimations({subtree:true}).some(animation=>animation.playState==='running')
          };
        });
        expect(switched.sameAmount).toBe(true);
        expect(switched.sameComment).toBe(true);
        expect(switched.focused).toBe(true);
        expect(switched.selection).toEqual([2,5]);
        expect(switched.running).toBe(reducedMotion==='no-preference');
        await expect(page.locator('.payout-mode')).toHaveAttribute('data-mode','advance');
        await expect(page.locator('.payout-advance-note')).toHaveCount(1);
        await expect(page.locator('.payout-advance-note')).toContainText('независимо от начислений');
        await settleScreen(page);
        const thumb=await page.locator('.payout-mode').evaluate(element=>getComputedStyle(element,'::before').transform);
        expect(thumb).not.toBe(switched.before);
        await page.locator('[data-payout-mode="regular"]').click();
        await settleScreen(page);
        await page.locator('[data-payout-mode="advance"]').click();
        await settleScreen(page);
        await expect(page.locator('#payoutAmount')).toHaveValue('12345,67');
        await expect(page.locator('#payoutComment')).toHaveValue('Согласованный аванс');
        await expect(page.locator('[data-payout-date-open]')).toHaveText(date);
        await expect(page.locator('.payout-editor')).toHaveCount(1);
      });

      test('date stays inline through rapid navigation, year selection and Today',async({page})=>{
        await openPayout(page);
        await openEditor(page);
        await page.locator('#payoutAmount').fill('12345,67');
        await page.locator('#payoutComment').fill('Дата без потери черновика');
        await page.locator('[data-payout-mode="advance"]').click();
        await settleScreen(page);
        const button=page.locator('[data-payout-date-open]');
        await button.click();
        await expect(button).toHaveAttribute('aria-expanded','true');
        await expect(button).toHaveAttribute('aria-controls','payoutDateCalendar');
        const calendar=page.locator('#payoutDateCalendar');
        await expect(calendar.locator('.inline-calendar')).toBeVisible();
        await settleScreen(page);
        await expect(page.locator('#datePicker')).not.toHaveClass(/\bon\b/);
        await expect(page.locator('#dateVeil')).not.toHaveClass(/\bon\b/);
        expect(await page.locator('body').evaluate(element=>element.classList.contains('date-picker-open'))).toBe(false);

        const navigation=await calendar.evaluate(async element=>{
          for(let index=0;index<3;index++){
            element.querySelector('[data-payout-date-step="1"]').click();
          }
          await new Promise(requestAnimationFrame);
          return {running:element.getAnimations({subtree:true}).some(animation=>animation.playState==='running')};
        });
        expect(navigation.running).toBe(reducedMotion==='no-preference');
        await expect(calendar.locator('.date-calendar-title')).toHaveText('Декабрь 2026');
        await settleScreen(page);
        await calendar.locator('[data-payout-date-jump="open"]').click();
        await expect(calendar.locator('.date-calendar-title')).toHaveText('2026');
        await calendar.locator('[data-payout-date-step="1"]').click();
        await expect(calendar.locator('.date-calendar-title')).toHaveText('2027');
        await calendar.locator('[data-payout-date-month="2027-02"]').click();
        await settleScreen(page);
        await expect(calendar.locator('.date-calendar-title')).toHaveText('Февраль 2027');
        await calendar.locator('[data-date="2027-02-10"]').click();
        await expect(button).toHaveText('10 февраля 2027');
        await expect(button).toHaveAttribute('aria-expanded','false');
        await settleScreen(page);

        await button.click();
        await settleScreen(page);
        await calendar.locator('[data-payout-date-jump="open"]').click();
        await calendar.locator('[data-payout-date-current]').click();
        await settleScreen(page);
        await expect(calendar.locator('.date-calendar-title')).toHaveText('Сентябрь 2026');
        await expect(button).toHaveText('10 февраля 2027');
        await calendar.locator('[data-payout-date-today]').click();
        const today=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'})
          .format(FROZEN_TODAY).replace(/\s*г\.$/u,'');
        await expect(button).toHaveText(today);
        await expect(button).toHaveAttribute('aria-expanded','false');
        await expect(page.locator('#payoutAmount')).toHaveValue('12345,67');
        await expect(page.locator('#payoutComment')).toHaveValue('Дата без потери черновика');
        await expect(page.locator('[data-payout-mode="advance"]')).toHaveAttribute('aria-pressed','true');
        expect(await page.evaluate(()=>globalThis.__stubDb.employee_payouts.length)).toBe(0);
      });

      test('a cancelled editor cannot erase a new employee draft after its closing transition',async({page})=>{
        await openPayout(page);
        await openEditor(page);
        await page.locator('#payoutAmount').fill('111');
        // Same-turn clicks deliberately exercise state changes during closing.
        await page.evaluate(()=>{
          document.querySelector('[data-payout-cancel]').click();
          // The old draft's removal runs after 320ms. Await its deadline below
          // even if reversing the reveal finishes sooner than that timer.
          globalThis.__payoutCancelDeadline=new Promise(resolve=>setTimeout(resolve,350));
          document.querySelector('#statsEmployeeOpen').click();
          document.querySelector('[data-stats-employee="employee-2"]').click();
          document.querySelector('.payout-block.open [data-payout-add]').click();
        });
        await expect(page.locator('#statsEmployeeOpen')).toContainText('Роман Белов');
        await expect(page.locator('#payoutAmount')).toHaveValue('');
        await page.locator('#payoutAmount').fill('222');
        await settleScreen(page);
        await page.evaluate(()=>globalThis.__payoutCancelDeadline);
        await expect(page.locator('#payoutAmount')).toHaveValue('222');
        await expect(page.locator('.payout-editor')).toHaveCount(1);
        await expect(page.locator('.payout-editor-reveal.on')).toHaveCount(1);
        expect(await page.locator('.payout-editor').evaluate(element=>Boolean(element.closest('[inert]')))).toBe(false);
      });

      test('horizontal wheel and touch navigate only the calendar and suppress the touch click',async({page})=>{
        await openPayout(page);
        await openEditor(page);
        await page.locator('#payoutAmount').fill('12345,67');
        await page.locator('#payoutComment').fill('Жесты не меняют выплату');
        const calendar=await openCalendar(page);
        const date=await page.locator('[data-payout-date-open]').textContent();
        const wheelPrevented=await calendar.locator('.date-grid').evaluate(element=>{
          const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:70,deltaY:2});
          element.dispatchEvent(event);
          return event.defaultPrevented;
        });
        expect(wheelPrevented).toBe(true);
        await expect(calendar.locator('.date-calendar-title')).toHaveText('Октябрь 2026');
        await settleScreen(page);
        await touchCalendar(page,{dx:-90,dy:2,clickAfter:true});
        await expect(calendar.locator('.date-calendar-title')).toHaveText('Ноябрь 2026');
        await expect(page.locator('[data-payout-date-open]')).toHaveAttribute('aria-expanded','true');
        await expect(page.locator('[data-payout-date-open]')).toHaveText(date);
        await settleScreen(page);

        // The calendar header does not inherit the day grid's swipe handling.
        const outside=await calendar.locator('.date-calendar-head').evaluate(header=>{
          const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:70,deltaY:2});
          header.dispatchEvent(event);
          return event.defaultPrevented;
        });
        expect(outside).toBe(false);
        await expect(calendar.locator('.date-calendar-title')).toHaveText('Ноябрь 2026');
        await expect(page.locator('#payoutAmount')).toHaveValue('12345,67');
        await expect(page.locator('#payoutComment')).toHaveValue('Жесты не меняют выплату');
        const keyboardDay=calendar.locator('.date-day:not(.outside)').first();
        const keyboardDate=await keyboardDay.getAttribute('aria-label');
        // Keyboard activation is not the synthetic mouse click from a swipe.
        await keyboardDay.dispatchEvent('click',{detail:0});
        await expect(page.locator('[data-payout-date-open]')).toHaveText(keyboardDate);
        await expect(page.locator('[data-payout-date-open]')).toHaveAttribute('aria-expanded','false');
        expect(await page.evaluate(()=>globalThis.__stubDb.employee_payouts.length)).toBe(0);
      });

      test('vertical wheel and touch remain available to native scrolling',async({page})=>{
        await openPayout(page);
        await openEditor(page);
        const calendar=await openCalendar(page);
        const date=await page.locator('[data-payout-date-open]').textContent();
        const wheelPrevented=await calendar.locator('.date-grid').evaluate(element=>{
          const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:2,deltaY:90});
          element.dispatchEvent(event);
          return event.defaultPrevented;
        });
        expect(wheelPrevented).toBe(false);
        const touch=await touchCalendar(page,{dx:2,dy:-90});
        expect(touch.prevented).toBe(false);
        await expect(calendar.locator('.date-calendar-title')).toHaveText('Сентябрь 2026');
        await expect(page.locator('[data-payout-date-open]')).toHaveText(date);
        await expect(page.locator('[data-payout-date-open]')).toHaveAttribute('aria-expanded','true');
      });

      test('Escape returns from year selection, then closes only the inline calendar',async({page})=>{
        await openPayout(page);
        await openEditor(page);
        await page.locator('#payoutAmount').fill('12345,67');
        await page.locator('#payoutComment').fill('Черновик после Escape');
        const calendar=await openCalendar(page);
        const date=page.locator('[data-payout-date-open]');
        const value=await date.textContent();
        await calendar.locator('[data-payout-date-jump="open"]').click();
        await settleScreen(page);
        await expect(calendar.locator('.date-jump-months')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(date).toHaveAttribute('aria-expanded','true');
        await expect(calendar.locator('.date-calendar-title')).toHaveText('Сентябрь 2026');
        await settleScreen(page);
        await expect(calendar.locator('.date-grid')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(date).toHaveAttribute('aria-expanded','false');
        await expect(date).toBeFocused();
        await settleScreen(page);
        await expect(page.locator('.payout-editor')).toBeVisible();
        await expect(page.locator('#payoutAmount')).toHaveValue('12345,67');
        await expect(page.locator('#payoutComment')).toHaveValue('Черновик после Escape');
        await expect(date).toHaveText(value);
        await expect(page.locator('#datePicker')).not.toHaveClass(/\bon\b/);
        await expect(page.locator('#dateVeil')).not.toHaveClass(/\bon\b/);
      });
    });
  }
}
