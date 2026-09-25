import {test,expect} from '@playwright/test';
const fixture={obras:[{id:'w',name:'Sonata',movimientos:[]}],sessionPlants:[],forestPlants:[],sesiones:[],eventos:[],registro:[],habitChallenges:[],
  germanStudy:{version:1,materials:[],reviews:[],sessions:[],ledger:[],goals:[{id:'g',name:'Kindle',amount:220,createdAt:'2026-09-01T10:00:00Z'}]}};
async function prepare(page){
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* isolated local fixture */'}));
 await page.addInitScript(data=>{if(!localStorage.getItem('alberto_piano_v2'))localStorage.setItem('alberto_piano_v2',JSON.stringify(data));},fixture);
 await page.goto('/');await page.waitForFunction(()=>window.StudyIncentives&&window.setCronoCalendarObjectivesMode);
 await page.evaluate(()=>showView('cronometro'));
}
for(const [width,height] of [[834,1194],[1194,834]])test(`iPad ${width}x${height}: habits, reward agreement and accessible study achievements`,async({page})=>{
 test.setTimeout(45000);await page.setViewportSize({width,height});await prepare(page);
 await page.getByRole('tab',{name:'Hábitos',exact:true}).click();
 await page.getByRole('button',{name:'Crear hábito',exact:true}).click();
 await page.locator('#habitTitleInput').fill('Evitar el móvil al despertar');
 await page.locator('#habitModeToggle [data-mode="avoid"]').click();
 await page.locator('#habitCriteriaInput').fill('Dejar el móvil fuera hasta desayunar');
 await expect(page.locator('#habitEffortRewardNote')).toContainText('0 caídas = 3 puntos');
 await page.getByRole('button',{name:'Guardar hábito',exact:true}).click();
 expect(await page.evaluate(()=>db.habitChallenges[0].effortReward)).toMatchObject({version:2,points:3,durationDays:21,mode:'avoid',failurePoints:[3,1.5,.75,0]});
 await page.getByRole('button',{name:'Ver detalles y reglas de Evitar el móvil al despertar',exact:true}).click();
 await expect(page.locator('#habitDurationInput')).toBeDisabled();await expect(page.locator('#habitCriteriaInput')).toBeDisabled();
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.getByRole('tab',{name:'Vitrina',exact:true}).click();
 await expect(page.locator('#habitTrophyRoomTitle')).toHaveText('Vitrina de hábitos');
 await page.getByRole('button',{name:'Rachas y logros de estudio',exact:true}).click();
 await expect(page.locator('#view-premios')).toHaveClass(/active/);
 await expect(page.locator('#studyIncentivesContent')).toContainText('Se congela');
 await expect(page.locator('#studyIncentivesContent')).toContainText('El ciclo no se reinicia al caer');
 const box=await page.locator('#studyIncentivesContent').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
 await page.screenshot({path:`.ai/runtime/incentives-${width}x${height}.png`});
 await page.evaluate(()=>closePremios());
 await page.reload();await page.waitForFunction(()=>window.PianoRewards&&window.StudyIncentives);
 expect(await page.evaluate(()=>db.habitChallenges[0].effortReward.points)).toBe(3);
 expect(await page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBe(0);
});
test('a completed avoid cycle contributes once, survives reload and appears in both money surfaces',async({page})=>{
 test.setTimeout(45000);await page.setViewportSize({width:834,height:1194});await prepare(page);
 await page.evaluate(()=>{
   const day=new Date();day.setDate(day.getDate()-22);const start=HabitTrophies.dayKey(day);
   const habit={id:'h',title:'Sin móvil en la cama',mode:'avoid',durationDays:21,startDate:start,successCriteria:'Móvil fuera de la habitación',logs:{}};
   habit.effortReward=HabitTrophies.createRewardPolicy(habit,day);db.habitChallenges=[habit];db.habitChallenge=habit;
   const earlier=new Date(day);earlier.setDate(day.getDate()-1);db.germanStudy.goals[0].createdAt=earlier.toISOString();
   db.germanStudy.effortWallet.createdAt=earlier.toISOString();saveData();cronoUpdatePianoReward();
 });
 await expect(page.locator('#cronoPianoIdleGoalBalance')).toContainText('3,56 €');
 await page.evaluate(()=>openPremios());
 await expect(page.locator('#germanSharedGoal .effort-goal-money')).toContainText('3,56 €');
 await expect(page.locator('.study-incentive-bonus-history')).toContainText('+3,56 €');
 await page.reload();await page.waitForFunction(()=>window.PianoRewards&&db.habitChallenges?.length);
 expect(await page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBe(3);
 await page.evaluate(()=>{db.habitChallenges[0].logs[db.habitChallenges[0].startDate]={status:'failed'};saveData();});
 await expect.poll(()=>page.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBe(1.5);
});
