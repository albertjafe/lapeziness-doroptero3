import {test,expect} from '@playwright/test';

const fixture={
  obras:[{id:'bach',name:'Bach',composer:'J. S. Bach',movimientos:[],sol:70,solHistory:[]}],
  eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[],
  germanStudy:{
    version:1,materials:[],reviews:[],sessions:[],ledger:[],
    goals:[{id:'kindle',name:'E-book',amount:150,createdAt:'2026-09-01T10:00:00Z'}]
  }
};

async function prepare(page,viewport={width:1024,height:1194}){
  await page.setViewportSize(viewport);
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});
    Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
    Object.defineProperty(navigator,'userAgentData',{configurable:true,get:()=>({platform:'iPadOS'})});
  });
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* isolated */'}));
  await page.addInitScript(data=>{
    localStorage.setItem('alberto_piano_v2',JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1',JSON.stringify({localRevision:0,dirtyRevision:0,lastSyncedRevision:0}));
  },fixture);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.PianoRewards&&window.GermanRewards&&window.crono);
  await page.evaluate(()=>{
    showView('cronometro');
    document.getElementById('cronoObraSelect').value='obra::bach';
    cronoUpdateStartBtn();
  });
}

test('the taximeter card stays complete on a phone and a landscape tablet',async({page})=>{
  await prepare(page,{width:390,height:844});
  await page.evaluate(()=>cronoStart());
  for (const viewport of [{width:390,height:844},{width:1024,height:768},{width:1180,height:820}]) {
    await page.setViewportSize(viewport);
    const geometry=await page.locator('#cronoPianoMoney').evaluate(el=>{
      const meter=el.getBoundingClientRect(),stage=document.getElementById('cronoStageRun').getBoundingClientRect();
      return {left:meter.left,right:meter.right,bottom:meter.bottom,stageLeft:stage.left,stageRight:stage.right,stageBottom:stage.bottom,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
    });
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.stageLeft-1);
    expect(geometry.right).toBeLessThanOrEqual(geometry.stageRight+1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.stageBottom+1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport+1);
  }
  await expect(page.locator('#cronoPianoMoneyTier')).toContainText('Tramo');
});

test('the piano stopwatch shows a progressive live taximeter and saves it once',async({page})=>{
  await prepare(page);
  await expect(page.locator('#cronoPianoGoalIdle')).toContainText('E-book');
  await page.locator('#cronoPianoGoalIdle').click();
  await expect(page.locator('#germanSharedGoal')).toContainText('E-book');
  await page.evaluate(()=>showView('cronometro'));
  await page.clock.install();
  await page.evaluate(()=>cronoStart());
  await expect(page.locator('#cronoPianoMoney')).toBeVisible();
  await expect(page.locator('#cronoPianoMoneyNext')).toContainText('Se guarda a los 10 min');
  const before=await page.locator('#cronoPianoMoneyValue').innerText();
  await page.clock.runFor(2000);
  await expect.poll(()=>page.locator('#cronoPianoMoneyValue').innerText()).not.toBe(before);

  const geometry=await page.locator('#cronoPianoMoney').evaluate(el=>{
    const meter=el.getBoundingClientRect(),stage=document.getElementById('cronoStageRun').getBoundingClientRect(),destello=document.getElementById('cronoRunDestello').getBoundingClientRect();
    return {left:meter.left,right:meter.right,top:meter.top,stageLeft:stage.left,stageRight:stage.right,destelloBottom:destello.bottom,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.stageLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.stageRight);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.destelloBottom-1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport+1);

  await page.evaluate(()=>{
    cronoStopTick();
    crono.startTs=Date.now()-11*60000;
    cronoRender();
    cronoFinish(crono.runId);
  });
  const saved=await page.evaluate(()=>({state:crono.state,rewards:db.pianoRewards.sessions,plants:db.sessionPlants}));
  expect(saved.state).toBe('idle');
  expect(saved.rewards).toHaveLength(1);
  expect(saved.rewards[0]).toMatchObject({goalId:'kindle'});
  expect(saved.rewards[0].seconds).toBeGreaterThanOrEqual(660);
  expect(saved.plants.filter(item=>item.obraId==='bach')).toHaveLength(1);

  const ledger=await page.evaluate(()=>PianoRewards.ledger(db.pianoRewards.sessions,db.germanStudy.goals));
  expect(ledger[0].finalReward).toBeGreaterThan(0);
  expect(ledger[0].finalReward).toBeLessThan(.08);
});
