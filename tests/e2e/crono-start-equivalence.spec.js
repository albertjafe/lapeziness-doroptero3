import {test,expect} from '@playwright/test';
const fixture={obras:[{id:'bach',name:'Sonata de prueba',composer:'Bach',movimientos:[],sol:70,solHistory:[]}],
  eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[],germanStudy:{version:1,materials:[],reviews:[],sessions:[],ledger:[],goals:[
    {id:'kindle',name:'Kindle',amount:220,createdAt:'2026-09-01T10:00:00Z'}]}};
async function prepare(page,data=fixture,platform='iPad'){
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* isolated */'}));
  await page.addInitScript(({data,platform})=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=>platform==='Windows'?'Win32':'MacIntel'});
    Object.defineProperty(navigator,'userAgentData',{configurable:true,get:()=>({platform})});
    if(platform==='iPad')Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
    if(!localStorage.getItem('alberto_piano_v2'))localStorage.setItem('alberto_piano_v2',JSON.stringify(data));
  },{data,platform});
  await page.goto('/');await page.evaluate(()=>cronoHydrate());
  await page.waitForFunction(()=>window.PianoActivityTypes && window.CronoSaveResilience && window.GermanStudy);
  await expect(page.locator('#splashScreen')).toBeHidden();
  await page.evaluate(()=>{
    showView('cronometro');cronoFillObraSelect();
    document.getElementById('cronoObraSelect').value='obra::bach';cronoUpdateStartBtn();
  });
}
for(const [platform,viewport] of [
  ['iPad',{width:1194,height:834}],['iPad',{width:834,height:1194}],['iPad',{width:1024,height:768}]]){
  test(`all preparation controls remain usable on ${platform} ${viewport.width}×${viewport.height}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);await prepare(page,fixture,platform);
    for(const mode of ['stopwatch','timer']){
      await page.evaluate(mode=>cronoSetMode(mode),mode);
      await page.locator('#cronoActivityType').selectOption('piano_class');
      await expect(page.locator('#cronoStartBtn')).toBeEnabled();
      const boxes=await page.evaluate(()=>{
        const box=id=>{const r=document.querySelector(id).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
        return {start:box('#cronoStartBtn'),stage:box('.crono-idle-main'),type:box('#cronoActivityType'),mode:box('#cronoModeToggle'),goal:box('#cronoPianoGoalIdle'),width:innerWidth,scrollWidth:document.documentElement.scrollWidth};
      });
      expect(boxes.start.top).toBeGreaterThanOrEqual(Math.max(boxes.type.bottom,boxes.mode.bottom,boxes.goal.bottom));
      expect(boxes.start.bottom).toBeLessThanOrEqual(boxes.stage.bottom+1);
      expect(boxes.start.left).toBeGreaterThanOrEqual(boxes.stage.left);
      expect(boxes.start.right).toBeLessThanOrEqual(boxes.stage.right);
      expect(boxes.scrollWidth).toBeLessThanOrEqual(boxes.width+1);
      for(const button of await page.locator('#cronoModeToggle .crono-mode-opt').all()){
        expect(await button.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      }
      await page.locator('#cronoStartBtn').click();
      expect(await page.evaluate(()=>({state:crono.state,type:crono.activityType}))).toEqual({state:'running',type:'piano_class'});
      await page.evaluate(()=>{cronoStopTick();cronoReset();cronoRender();});
    }
    await page.screenshot({path:testInfo.outputPath('preparar-cronometro.png'),fullPage:true});
  });
}

test('class type survives IndexedDB-only recovery and keeps its weight on finish',async({page})=>{
  await prepare(page);await page.locator('#cronoActivityType').selectOption('piano_class');
  await page.locator('#cronoStartBtn').click();
  const id=await page.evaluate(async()=>{
    cronoStopTick();crono.startTs=Date.now()-60*60000;cronoSaveState();await CronoStateStore.flush();return crono.runId;
  });
  await page.addInitScript(()=>{localStorage.removeItem('pianoCrono_v2');localStorage.removeItem('piano_activity_type_v1');});
  await page.reload();await page.evaluate(()=>cronoHydrate());
  expect(await page.evaluate(()=>crono.activityType)).toBe('piano_class');
  await page.evaluate(()=>{cronoStopTick();cronoFinish(crono.runId);});
  const result=await page.evaluate(id=>({plant:db.sessionPlants.find(p=>p.runId===id),reward:db.pianoRewards.sessions.find(p=>p.id===id),seconds:PianoRewards.summarizeDays(PianoRewards.studyState(db).sessions)[PianoRewards.dayKey()]}),id);
  expect(result.plant).toMatchObject({activityType:'piano_class',mins:60});
  expect(result.reward).toMatchObject({activityType:'piano_class',activityFactor:.5});
  expect(result.seconds).toBe(1800);
});

test('editing the price previews equivalence and keeps purchase identity, time and types',async({page})=>{
  const data=structuredClone(fixture),when=new Date().toISOString();
  data.sessionPlants=[{id:'manual',obraId:'bach',source:'manual',mins:120,startedAt:when,endedAt:when}];
  await prepare(page,data);
  const before=await page.evaluate(()=>({goal:structuredClone(db.germanStudy.goals[0]),plants:structuredClone(db.sessionPlants),live:PianoRewards.live(PianoRewards.studyState(db),db.germanStudy.goals,'kindle',0)}));
  await page.locator('#cronoPianoGoalIdle').click();await page.locator('[data-action="edit-goal"]').click();
  await page.locator('#germanGoalForm [name="amount"]').fill('150');
  await expect(page.locator('#germanGoalEquivalence')).toContainText('0,32 € → 0,27 € de 150,00 €');
  expect(await page.evaluate(()=>db.germanStudy.goals[0].amount)).toBe(220);
  await page.locator('#germanGoalForm [type="submit"]').click();
  await expect(page.locator('#germanSharedGoal')).toContainText('exclusivamente para Kindle');
  const after=await page.evaluate(()=>({goal:db.germanStudy.goals[0],plants:db.sessionPlants,live:PianoRewards.live(PianoRewards.studyState(db),db.germanStudy.goals,'kindle',0)}));
  expect(after.goal).toMatchObject({id:before.goal.id,createdAt:before.goal.createdAt,amount:150});
  expect(after.plants).toEqual(before.plants);expect(after.live.today).toBe(.27);
  await page.reload();await page.evaluate(()=>showView('cronometro'));
  await expect(page.locator('#cronoPianoIdleGoalBalance')).toContainText('0,27 € de 150,00 €');
});
