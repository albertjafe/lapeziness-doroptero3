import {test,expect} from '@playwright/test';
const fixture={obras:[{id:'w',name:'Pieza de prueba',composer:'Compositor de prueba',movimientos:[],sol:70,solHistory:[]}],sessionPlants:[],forestPlants:[],sesiones:[],eventos:[],registro:[],habitChallenges:[],
  germanStudy:{version:1,materials:[],reviews:[],sessions:[],ledger:[],goals:[{id:'g',name:'Kindle',amount:150,createdAt:'2026-08-01T10:00:00Z'}],
    effortWallet:{version:1,createdAt:'2026-08-01T12:00:00Z',seedGoalIds:['g'],seedCostPoints:{g:150},displayGoalId:'g',redemptions:[]}}};
async function prepare(page,width,height,time='2026-10-20T12:00:00+02:00'){
 await page.setViewportSize({width,height});await page.clock.install({time:new Date(time)});
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* local fixture */'}));
 await page.route('**/*.supabase.co/**',r=>r.abort());
 await page.addInitScript(data=>{if(!localStorage.getItem('alberto_piano_v2'))localStorage.setItem('alberto_piano_v2',JSON.stringify(data));},fixture);
 await page.goto('/');await page.waitForFunction(()=>window.StudyIncentives&&window.CronoSaveResilience);
 await page.evaluate(async()=>{await cronoHydrate();showView('cronometro');});
}
for(const [width,height] of [[834,1194],[1194,834]])test(`balanced effort ${width}x${height}: manual money, live cap and monthly upgrades survive reload`,async({page})=>{
 test.setTimeout(60000);await prepare(page,width,height);
 await page.evaluate(()=>{
   const resolved=studyRegisterResolveValue('obra::w');
   for(let day=1;day<=19;day++)persistManualStudyHistory(resolved,300,'2026-10-'+String(day).padStart(2,'0'),{});
   persistManualStudyHistory(resolved,180,'2026-10-20',{});
   cronoFillObraSelect();document.getElementById('cronoObraSelect').value='obra::w';cronoStart();cronoStopTick();cronoUpdatePianoReward();
 });
 expect(await page.evaluate(()=>crono.rewardPolicyVersion)).toBe(6);
 await expect(page.locator('#cronoPianoMoneyValue')).toContainText('1,00');
 await expect(page.locator('#cronoPianoMoneyTier')).toContainText('0,480');
 await expect(page.locator('#cronoPianoMultiplierValue')).toHaveText('×2,09');
 const before=await page.evaluate(()=>PianoRewards.walletSnapshot(db).points);
 await page.evaluate(()=>{crono.startTs=Date.now()-2*3600000;cronoSaveState();cronoUpdatePianoReward();});
 const live=await page.evaluate(()=>PianoRewards.live(PianoRewards.studyState(db),db.germanStudy.goals,'g',2*3600,PianoRewards.dayKey(),[],6));
 expect(live.rewardMultiplier).toBe(1.5);expect(live.walletPoints-before).toBeCloseTo(25+2.1*1.5-1,5);
 await page.evaluate(()=>cronoFinish(crono.runId));
 await expect(page.locator('#modalHechoDatos')).toBeVisible();
 await page.locator('#modalHechoDatos').getByRole('button',{name:'Hecho',exact:true}).click();
 await expect(page.locator('#modalHechoDatos')).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBeCloseTo(live.walletPoints,5);
 await page.evaluate(()=>StudyIncentives.open());
 await expect(page.locator('#studyIncentivesContent')).toContainText('25 puntos abonados este mes');
 await expect(page.locator('.study-incentive-bonus-history')).toContainText('+15 pts');
 const bounds=await page.locator('.study-incentives-modal').boundingBox();
 expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(height+1);
 await page.screenshot({path:`.ai/runtime/balanced-effort-${width}x${height}.png`});
 await page.getByRole('button',{name:'Cerrar',exact:true}).click();
 await page.evaluate(()=>{saveData();});await page.reload();await page.waitForFunction(()=>window.PianoRewards&&db.sessionPlants?.length===21);
 expect(await page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBeCloseTo(live.walletPoints,5);
 await page.evaluate(()=>{
   // Upgrade existing canonical evidence; opening/reloading must not add credits.
   for(const block of db.sessionPlants)block.mins*=6/5;
   saveData();StudyIncentives.open();
 });
 await expect(page.locator('#studyIncentivesContent')).toContainText('30 puntos abonados este mes');
 expect(await page.evaluate(()=>PianoRewards.bonusRows(db,PianoRewards.studyState(db).sessions).map(PianoRewards.rowEffortPoints))).toEqual([10,15,5]);
 const upgraded=await page.evaluate(()=>PianoRewards.walletSnapshot(db).points);
 await page.getByRole('button',{name:'Cerrar',exact:true}).click();await page.reload();await page.waitForFunction(()=>window.PianoRewards&&db.sessionPlants?.length===21);
 expect(await page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBeCloseTo(upgraded,6);
});
test('a running pre-transition policy and previous money survive reload and the boundary',async({page})=>{
 await prepare(page,834,1194,'2026-09-18T23:50:00+02:00');
 await page.evaluate(()=>{
   persistManualStudyHistory(studyRegisterResolveValue('obra::w'),120,'2026-09-18',{});
   cronoFillObraSelect();document.getElementById('cronoObraSelect').value='obra::w';cronoStart();cronoStopTick();
 });
 expect(await page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBe(.27);
 expect(await page.evaluate(()=>crono.rewardPolicyVersion)).toBe(5);
 await page.clock.fastForward(20*60000);await page.reload();await page.waitForFunction(()=>window.PianoRewards&&window.CronoSaveResilience);await page.evaluate(()=>cronoHydrate());
 expect(await page.evaluate(()=>crono.rewardPolicyVersion)).toBe(5);
 expect(await page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBe(.27);
 await page.evaluate(()=>{cronoFinish(crono.runId);});
 expect(await page.evaluate(()=>PianoRewards.studyState(db).sessions.map(s=>s.policyVersion))).toEqual([5,5]);
});
