import {test,expect} from '@playwright/test';
const fixture={obras:[{id:'bach',name:'Pieza de prueba',composer:'Compositor de prueba',movimientos:[],sol:70,solHistory:[]}],
  eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[],
  germanStudy:{version:1,materials:[],reviews:[],sessions:[],ledger:[],goals:[
    {id:'g',name:'E-book',amount:150,createdAt:'2026-09-01T10:00:00Z'}]}};
async function prepare(page,data=fixture){
  await page.clock.install({time:new Date('2026-09-18T12:00:00+02:00')});
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* offline fixture */'}));
  await page.addInitScript(data=>{
    if(!localStorage.getItem('alberto_piano_v2'))localStorage.setItem('alberto_piano_v2',JSON.stringify(data));
  },data);
  await page.goto('/',{waitUntil:'load'});
  await page.evaluate(()=>cronoHydrate());
  await page.waitForFunction(()=>window.CronoSaveResilience && window.PianoRewards && window.DailyStudyMinutes);
}
async function start(page,mode='stopwatch'){
  await page.evaluate(()=>showView('cronometro'));
  await expect(page.locator('#cronoStageIdle')).toBeVisible();
  await page.evaluate(mode=>{
    cronoFillObraSelect();cronoSetMode(mode);
    document.getElementById('cronoObraSelect').value='obra::bach';
    cronoStart();cronoStopTick();
  },mode);
  const status=await page.evaluate(()=>({state:crono.state,selected:document.getElementById('cronoObraSelect').value,works:db.obras.map(o=>o.id),hydrated:_cronoHydrated,urgent:cronoUrgentTaskCandidates().length}));
  expect(status.state,JSON.stringify(status)).toBe('running');
}
test('recovers an empty wallet seed once, persists it, and keeps historical activity weights',async({page})=>{
  const data=structuredClone(fixture);
  const when=new Date('2026-09-18T12:00:00+02:00');when.setDate(when.getDate()-2);when.setHours(10,0,0,0);
  const startedAt=when.toISOString();
  data.sessionPlants=[{id:'run_old',runId:'old',obraId:'bach',source:'app',mins:360,startedAt}];
  data.pianoRewards={version:1,sessions:[{id:'old',goalId:'g',startedAt,seconds:360*60,policyVersion:4,activityType:'piano_class',activityFactor:.5}]};
  data.germanStudy.goals[0].createdAt=new Date(when.getTime()-86400000).toISOString();
  data.germanStudy.effortWallet={version:1,createdAt:new Date().toISOString(),seedGoalIds:[],seedCostPoints:{},displayGoalId:'g',redemptions:[]};
  await prepare(page,data);
  await page.evaluate(()=>showView('deutsch'));
  await expect(page.locator('#germanSharedGoal .effort-goal-money')).toContainText('0,53 €');
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('alberto_piano_v2')));
  await expect.poll(async()=> (await saved()).germanStudy.effortWallet.seedGoalIds).toEqual(['g']);
  expect((await saved()).sessionPlants).toEqual(data.sessionPlants);
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>window.PianoRewards);
  expect(await page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBe(.53);
  await page.evaluate(()=>{
    db.sessionPlants[0].mins=120;saveData();GermanStudy.refreshMoney();
  });
  await expect.poll(()=>page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBe(.11);
  expect((await saved()).germanStudy.effortWallet.seedGoalIds).toEqual(['g']);
});
test('manual study, edits and deletion recalculate money and the live tier',async({page})=>{
  await prepare(page);
  await page.evaluate(()=>{
    const resolved=studyRegisterResolveValue('obra::bach');
    persistManualStudyHistory(resolved,120,sessionJournalDayKey(new Date()),{});
  });
  await start(page);
  await expect(page.locator('#cronoPianoMoneyValue')).toContainText('0,27');
  await expect(page.locator('#cronoPianoMoneyTier')).toContainText('2 h–2:30 h');
  await expect(page.locator('#cronoPianoGoalBalance')).toContainText('0,27 €');
  await expect(page.locator('#cronoPianoMultiplierValue')).toHaveText('×2,20');
  const money=()=>page.evaluate(()=>PianoRewards.live(PianoRewards.studyState(db),db.germanStudy.goals,'g',0).today);
  await page.evaluate(()=>{
    _editSesionIdx=0;setEditExistingMinutos(0,'300');saveData();
  });
  expect(await money()).toBeCloseTo(2.0265,6);
  await expect(page.locator('#cronoPianoMultiplierValue')).toHaveText('×13,7');
  await page.evaluate(()=>{setEditExistingMinutos(0,'60');saveData();});
  expect(await money()).toBe(.11);
  await expect(page.locator('#cronoPianoMultiplierValue')).toHaveText('×1,40');
  await page.evaluate(()=>deleteEditExistingItem(0));
  expect(await money()).toBe(0);
  expect(await page.evaluate(()=>db.sessionPlants.length)).toBe(0);
  await page.evaluate(()=>_doUndo());
  expect(await money()).toBe(.11);
});
test('recovers thirty minutes after page destruction even if localStorage lost the timer key',async({page,context})=>{
  await prepare(page);await start(page);
  const runId=await page.evaluate(async()=>{
    crono.startTs=Date.now()-30*60000;cronoSaveState();
    await CronoStateStore.flush();
    return crono.runId;
  });
  const reopenTime=await page.evaluate(()=>Date.now());
  await page.close();
  const reopened=await context.newPage();
  await reopened.clock.install({time:new Date(reopenTime+1000)});
  await reopened.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* offline fixture */'}));
  await reopened.addInitScript(()=>localStorage.removeItem('pianoCrono_v2'));
  await reopened.goto('/',{waitUntil:'load'});
  await reopened.evaluate(()=>cronoHydrate());
  expect(await reopened.evaluate(()=>crono.runId)).toBe(runId);
  expect(await reopened.evaluate(()=>cronoEffectiveElapsedMs())).toBeGreaterThanOrEqual(30*60000);
  await expect(reopened.locator('#cronoStageRun')).toBeVisible();
  await expect(reopened.locator('#cronoPianoMoneyValue')).toContainText('0,05');
  await reopened.evaluate(async()=>{
    cronoFinish(crono.runId);await CronoStateStore.flush();await CronoSaveResilience.flush();
  });
  await reopened.reload({waitUntil:'load'});
  await reopened.evaluate(()=>cronoHydrate());
  expect(await reopened.evaluate(()=>crono.state)).toBe('idle');
  expect(await reopened.evaluate(id=>db.sessionPlants.filter(p=>p.runId===id).length,runId)).toBe(1);
});
test('restores an expired timer, saves its target exactly once and does not revive it',async({page})=>{
  await prepare(page);await start(page,'timer');
  await page.evaluate(async()=>{
    crono.startTs=Date.now()-40*60000;cronoSaveState();await CronoStateStore.flush();
  });
  await page.reload({waitUntil:'load'});await page.evaluate(()=>cronoHydrate());
  await expect.poll(()=>page.evaluate(()=>crono.state)).toBe('idle');
  expect(await page.evaluate(()=>db.sessionPlants.map(p=>p.mins))).toEqual([25]);
  await page.evaluate(async()=>{await CronoStateStore.flush();await CronoSaveResilience.flush();});
  await page.reload({waitUntil:'load'});await page.evaluate(()=>cronoHydrate());
  expect(await page.evaluate(()=>db.sessionPlants.length)).toBe(1);
});
test('an expired pause excludes only five minutes after reopening',async({page})=>{
  await prepare(page);await start(page);
  await page.evaluate(async()=>{
    crono.startTs=Date.now()-40*60000;crono.state='paused';crono.pauseStartTs=Date.now()-20*60000;
    cronoSaveState();await CronoStateStore.flush();
  });
  await page.reload({waitUntil:'load'});await page.evaluate(()=>cronoHydrate());
  expect(await page.evaluate(()=>crono.state)).toBe('running');
  expect(await page.evaluate(()=>crono.pausedMs)).toBe(5*60000);
  const elapsed=await page.evaluate(()=>cronoEffectiveElapsedMs());
  expect(elapsed).toBeGreaterThanOrEqual(35*60000);
  expect(elapsed).toBeLessThan(36*60000);
});
test('old manual entries without IDs still correct, delete and restore their canonical block',async({page})=>{
  const data=structuredClone(fixture),when=new Date('2026-09-18T10:00:00Z').toISOString();
  data.sessionPlants=[{id:'legacy-plant',obraId:'bach',mins:30,source:'manual',startedAt:when,endedAt:when}];
  data.sesiones=[{date:when,items:[{obraId:'bach',manual:true,tick:'hecho',minutosEstudiados:30,minutosReales:30}]}];
  await prepare(page,data);
  const money=()=>page.evaluate(()=>PianoRewards.live(PianoRewards.studyState(db),db.germanStudy.goals,'g',0).today);
  await page.evaluate(()=>{_editSesionIdx=0;setEditExistingMinutos(0,'120');saveData();});
  expect(await money()).toBe(.27);
  await page.evaluate(()=>deleteEditExistingItem(0));expect(await money()).toBe(0);
  await page.evaluate(()=>_doUndo());expect(await money()).toBe(.27);
});
