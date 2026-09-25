import {test,expect} from '@playwright/test';
test.use({hasTouch:true,userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});

async function boot(page,viewport){
  await page.setViewportSize(viewport);
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* local fixture */'}));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});
    Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,get:()=>5});
    localStorage.setItem('alberto_piano_v2',JSON.stringify({obras:[{id:'w',name:'Preludio',movimientos:[]}],eventos:[],sesiones:[],sessionPlants:[],forestPlants:[],registro:[]}));
  });
  await page.goto('/');
  await page.waitForFunction(()=>window.PianoRewards&&typeof initViewSwipeNavigation==='function');
  await expect(page.locator('#splashScreen')).toBeHidden();
  await page.evaluate(()=>showView('session'));
}

async function touch(page,type,x,y=300){
  await page.evaluate(({type,x,y})=>{
    const event=new Event(type,{bubbles:true,cancelable:true});
    const point={identifier:1,clientX:x,clientY:y};
    Object.defineProperties(event,{touches:{value:type==='touchend'||type==='touchcancel'?[]:[point]},changedTouches:{value:[point]}});
    document.querySelector('.view.active').dispatchEvent(event);
  },{type,x,y});
}

async function box(page,selector){
  return page.locator(selector).evaluate(node=>{
    const r=node.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  });
}

for(const viewport of [{width:834,height:1194},{width:1194,height:834}]){
  test(`iPad ${viewport.width}: live Hoy preview matches the committed layout`,async({page})=>{
    await boot(page,viewport);
    const expected=await box(page,'#sessionResumenCard');
    await page.evaluate(()=>{
      showView('cronometro');
      const now=new Date();
      db.sessionPlants.push({id:'new-study',obraId:'w',startedAt:new Date(now.getTime()-90*60000).toISOString(),endedAt:now.toISOString(),mins:90});
    });
    await touch(page,'touchstart',150);
    await touch(page,'touchmove',viewport.width/2);
    await expect(page.locator('body')).toHaveClass(/view-swipe-dragging/);
    await expect(page.locator('#sessionConcentradoText')).toContainText(/1\s*h\s*30\s*min/);
    await expect(page.locator('.ipad-today-next')).toBeVisible();
    const preview=await box(page,'#sessionResumenCard');
    expect(preview.width).toBeCloseTo(expected.width,0);
    expect(preview.height).toBeCloseTo(expected.height,0);
    expect(preview.y).toBeCloseTo(expected.y,0);
    if(process.env.CAPTURE_IPAD_SWIPE) await page.screenshot({path:`.ai/runtime/ipad-swipe-preview-${viewport.width}.png`});
    await touch(page,'touchmove',viewport.width-30);
    await touch(page,'touchend',viewport.width-30);
    await expect(page.locator('body')).toHaveAttribute('data-view','session');
    await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
    const arrived=await box(page,'#sessionResumenCard');
    expect(arrived).toEqual(expected);
    await expect(page.locator('#sessionConcentradoText')).toContainText(/1\s*h\s*30\s*min/);
    await expect(page.locator('.view-swipe-header,.view-swipe-nav')).toHaveCount(0);
    if(process.env.CAPTURE_IPAD_SWIPE) await page.screenshot({path:`.ai/runtime/ipad-swipe-arrived-${viewport.width}.png`});
  });

  test(`iPad ${viewport.width}: Cronometro preview has the final ring dimensions and cancelled gestures restore Hoy`,async({page})=>{
    await boot(page,viewport);
    await page.evaluate(()=>showView('cronometro'));
    const expected=await box(page,'#cronoIdleDisplayWrap');
    await page.evaluate(()=>showView('session'));
    await touch(page,'touchstart',viewport.width-100);
    await touch(page,'touchmove',viewport.width/2);
    const preview=await box(page,'#cronoIdleDisplayWrap');
    expect(preview.width).toBeCloseTo(expected.width,0);
    expect(preview.height).toBeCloseTo(expected.height,0);
    expect(preview.y).toBeCloseTo(expected.y,0);
    await touch(page,'touchcancel',viewport.width/2);
    await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
    await expect(page.locator('body')).toHaveAttribute('data-view','session');
    await expect(page.locator('body')).not.toHaveClass(/crono-focus/);
    await expect(page.locator('.ipad-today-next')).toBeVisible();
    await expect(page.locator('.view-swipe-header,.view-swipe-nav')).toHaveCount(0);
  });

  for(const [mode,running] of [['timer',false],['timer',true],['stopwatch',true]]){
    test(`iPad ${viewport.width}: ${mode} ${running?'running':'idle'} keeps its geometry through a committed swipe`,async({page})=>{
      await boot(page,viewport);
      await page.evaluate(async({mode,running})=>{
        await cronoHydrate();showView('cronometro');cronoSetMode(mode);
        if(running){
          document.getElementById('cronoObraSelect').value='obra::w';
          cronoStart();cronoStopTick();
        }
      },{mode,running});
      const selector=running?'#cronoDisplayWrap':'#cronoIdleDisplayWrap';
      if(running) await page.waitForFunction(()=>document.querySelector('.crono-wrap').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).every(a=>a.playState==='finished'));
      const expected=await box(page,selector);
      const original=await page.evaluate(()=>({runId:crono.runId,state:crono.state,mode:crono.mode}));
      if(running){
        await touch(page,'touchstart',100);
        await touch(page,'touchmove',viewport.width/2);
        await touch(page,'touchcancel',viewport.width/2);
        await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
        expect(await box(page,selector)).toEqual(expected);
        expect(await page.locator('#cronoStageRun').evaluate(n=>getComputedStyle(n).animationName)).toBe('none');
      }
      await page.evaluate(()=>showView('session'));
      await touch(page,'touchstart',viewport.width-100);
      await touch(page,'touchmove',viewport.width/2);
      const preview=await box(page,selector);
      expect(preview.width).toBeCloseTo(expected.width,0);
      expect(preview.height).toBeCloseTo(expected.height,0);
      expect(preview.y).toBeCloseTo(expected.y,0);
      await touch(page,'touchmove',30);
      await touch(page,'touchend',30);
      await expect(page.locator('body')).toHaveAttribute('data-view','cronometro');
      await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
      const arrived=await box(page,selector);
      expect(arrived).toEqual(expected);
      expect(await page.evaluate(()=>({runId:crono.runId,state:crono.state,mode:crono.mode}))).toEqual(original);
      expect(await page.evaluate(()=>db.sessionPlants.length)).toBe(0);
    });
  }

  test(`iPad ${viewport.width}: a cancelled return preserves Historial, a committed return previews Hoy immediately`,async({page})=>{
    await boot(page,viewport);
    await page.evaluate(()=>{showView('session',{sessionMode:'history'});showView('cronometro');});
    await touch(page,'touchstart',100);
    await touch(page,'touchmove',viewport.width/2);
    await expect(page.locator('#view-session')).not.toHaveClass(/session-history-mode/);
    await expect(page.locator('.ipad-today-next')).toBeVisible();
    await touch(page,'touchcancel',viewport.width/2);
    await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
    await expect(page.locator('body')).toHaveAttribute('data-view','cronometro');
    await expect(page.locator('#view-session')).toHaveClass(/session-history-mode/);
    await touch(page,'touchstart',100);
    await touch(page,'touchmove',viewport.width-30);
    await touch(page,'touchend',viewport.width-30);
    await expect(page.locator('body')).toHaveAttribute('data-view','session');
    await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
    await expect(page.locator('#view-session')).not.toHaveClass(/session-history-mode/);
    await expect(page.locator('.ipad-today-next')).toBeVisible();
    await expect(page.locator('body')).not.toHaveAttribute('data-swipe-preview');
  });
}
