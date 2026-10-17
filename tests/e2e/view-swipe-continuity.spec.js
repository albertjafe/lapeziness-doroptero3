import {test,expect} from '@playwright/test';

const ipad='Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const iphone=ipad.replace('iPad; CPU OS','iPhone; CPU iPhone OS');
test.use({hasTouch:true,userAgent:ipad});
const fixture={competitionPlanningSeedVersion:999,obras:Array.from({length:20},(_,i)=>({id:'w'+i,name:'Synthetic work '+i,movimientos:[],sol:40})),
  eventos:[{id:'e',nombre:'Recital de repertorio de otoño en el auditorio principal',fecha:'2030-01-01',obras:['w0']}],
  sesiones:[],sessionPlants:[],forestPlants:[],registro:[]};

async function boot(page,viewport){
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(({data,phone})=>{
    Object.defineProperty(navigator,'platform',{get:()=>phone?'iPhone':'MacIntel'});
    Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});
    localStorage.setItem('alberto_mobile_design','v2');
    localStorage.setItem('alberto_piano_v2',JSON.stringify(data));
  },{data:fixture,phone:viewport.width<700});
  await page.goto('/');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/);
  await page.waitForFunction(()=>window.MobileV2&&window.PianoRewards);
  await page.evaluate(async()=>{await cronoHydrate();document.querySelectorAll('.modal-overlay.visible').forEach(x=>closeModal(x.id));});
}

async function touch(page,type,x){
  await page.evaluate(({type,x})=>{
    const point={identifier:1,clientX:x,clientY:430},event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{touches:{value:/end|cancel/.test(type)?[]:[point]},changedTouches:{value:[point]}});
    document.querySelector('.view.active').dispatchEvent(event);
  },{type,x});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
}

async function geometry(page,view,selectors){
  return page.evaluate(({view,selectors})=>{
    const root=document.querySelector(view).getBoundingClientRect();
    return selectors.map(selector=>{
      const r=document.querySelector(selector).getBoundingClientRect();
      return {x:r.x-root.x,y:r.y,width:r.width,height:r.height};
    });
  },{view,selectors});
}
function sameGeometry(actual,expected){
  actual.forEach((box,i)=>Object.keys(box).forEach(key=>expect(Math.abs(box[key]-expected[i][key]),`${i}.${key}: ${box[key]} vs ${expected[i][key]}`).toBeLessThan(1)));
}

for(const viewport of [{width:390,height:844},{width:834,height:1194},{width:1194,height:834}])test.describe(`continuous swipe ${viewport.width}`,()=>{
  test.use({viewport,hasTouch:true,userAgent:viewport.width<700?iphone:ipad});

  test('fixed timer tools keep their final geometry throughout a slow drag and its handoff',async({page})=>{
    await boot(page,viewport);
    await page.evaluate(()=>showView('cronometro'));
    await page.waitForFunction(()=>document.getElementById('view-cronometro').getAnimations({subtree:true})
      .filter(animation=>animation.effect.getComputedTiming().iterations!==Infinity).every(animation=>animation.playState==='finished'));
    const selectors=['#cronoIdleDisplayWrap','#cronoIdleDrawer','#cronoStartBtn'];
    const expected=await geometry(page,'#view-cronometro',selectors);
    await page.evaluate(()=>showView('session'));
    await page.evaluate(()=>{
      window.__swipeNodes=['view-session','view-cronometro','cronoIdleDisplayWrap','cronoIdleDrawer'].map(id=>{
        const node=document.getElementById(id);return {node,parent:node.parentNode};
      });
    });
    const start=viewport.width-45;
    await touch(page,'touchstart',start);
    for(const progress of [.25,.5,.75]){
      await touch(page,'touchmove',start-viewport.width*progress);
      sameGeometry(await geometry(page,'#view-cronometro',selectors),expected);
    }
    await page.evaluate(()=>{
      const stage=document.querySelector('.view-swipe-page-neighbor')||document.querySelector('.view-swipe-neighbor');
      document.addEventListener('transitionend',event=>{
        if(event.target===stage&&event.propertyName==='transform')window.__handoffSettling=document.body.classList.contains('view-swipe-settling');
      });
    });
    await touch(page,'touchend',start-viewport.width*.75);
    await expect(page.locator('body')).toHaveAttribute('data-view','cronometro');
    await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
    sameGeometry(await geometry(page,'#view-cronometro',selectors),expected);
    expect(await page.evaluate(()=>window.__handoffSettling)).toBe(false);
    expect(await page.evaluate(()=>window.__swipeNodes.every(x=>x.node.isConnected&&x.node.parentNode===x.parent))).toBe(true);
    await expect(page.locator('.view-swipe-page,.view-swipe-header,.view-swipe-nav')).toHaveCount(0);
  });

  test('the first calendar preview has the same header, content and nodes after arrival',async({page})=>{
    await boot(page,viewport);
    await page.evaluate(()=>showView('obras'));
    const start=viewport.width-45;
    await touch(page,'touchstart',start);
    await touch(page,'touchmove',start-viewport.width*.65);
    const selectors=['#mv2Cal','.mv2-cal-grid'];
    const preview=await geometry(page,'#view-calendario',selectors);
    const header=await page.locator('.view-swipe-header-neighbor').evaluate(node=>({height:node.getBoundingClientRect().height,
      date:node.querySelector('.header-date').textContent,event:node.querySelector('.header-next-event').getBoundingClientRect().width}));
    await page.evaluate(()=>{window.__calendarNodes=[document.querySelector('#mv2Cal .mv2-card'),document.querySelector('.mv2-cal-grid')];});
    await touch(page,'touchend',start-viewport.width*.65);
    await expect(page.locator('body')).toHaveAttribute('data-view','calendario');
    await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
    sameGeometry(await geometry(page,'#view-calendario',selectors),preview);
    const arrived=await page.locator('body > .topbar').evaluate(node=>({height:node.getBoundingClientRect().height,
      date:node.querySelector('.header-date').textContent,event:node.querySelector('.header-next-event').getBoundingClientRect().width}));
    expect(arrived.date).toBe(header.date);
    expect(Math.abs(arrived.height-header.height)).toBeLessThan(1);
    expect(Math.abs(arrived.event-header.event)).toBeLessThan(1);
    expect(await page.evaluate(()=>window.__calendarNodes.every(node=>node.isConnected))).toBe(true);
  });
});

test('cancelling a scrolled page and reversing direction leave the original page intact',async({page})=>{
  test.setTimeout(45000);
  const viewport={width:390,height:844};await page.setViewportSize(viewport);
  await boot(page,viewport);
  await page.evaluate(()=>showView('obras'));
  await expect(page.locator('#obrasList .ob3-row')).toHaveCount(20);
  await page.evaluate(()=>window.scrollTo({top:260,behavior:'instant'}));
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(100);
  const scroll=await page.evaluate(()=>window.scrollY);
  await touch(page,'touchstart',80);await touch(page,'touchmove',400);await touch(page,'touchcancel',400);
  await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
  expect(await page.evaluate(()=>window.scrollY)).toBe(scroll);
  await expect(page.locator('body')).toHaveAttribute('data-view','obras');
  await touch(page,'touchstart',viewport.width/2);await touch(page,'touchmove',viewport.width/2+220);
  await touch(page,'touchmove',100);await touch(page,'touchend',100);
  await expect(page.locator('body')).toHaveAttribute('data-view','calendario');
  await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
  await expect(page.locator('.view-swipe-page,.view-swipe-header,.view-swipe-nav')).toHaveCount(0);
  expect(await page.evaluate(()=>window.scrollY)).toBe(0);
});

test('native touch tracking completes the same swipe without replacing its touched nodes',async({page})=>{
  const viewport={width:1194,height:834};await page.setViewportSize(viewport);await boot(page,viewport);
  await page.evaluate(()=>showView('session'));
  const client=await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:1100,y:430}]});
  for(const x of [980,820,660,500,340,180]){
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:430}]});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
  }
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('body')).toHaveAttribute('data-view','cronometro');
  await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
  await expect(page.locator('#cronoIdleDisplayWrap')).toBeVisible();
  await expect(page.locator('.view-swipe-page')).toHaveCount(0);
});
