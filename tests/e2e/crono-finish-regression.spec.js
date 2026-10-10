import {test,expect} from '@playwright/test';

for(const quota of ["none","draft","all"]) test(`planting 36 minutes ends the timer and opens Hecho (storage quota=${quota})`,async({page})=>{
  await page.setViewportSize({width:1194,height:834});
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* offline fixture */'}));
  await page.addInitScript(()=>{
    if(localStorage.getItem('alberto_piano_v2'))return;
    localStorage.setItem('alberto_piano_v2',JSON.stringify({obras:[{id:'waldstein',name:'Waldstein',movimientos:[{id:'iii',name:'III',sol:60,solHistory:[]}]}],sessionPlants:[],sesiones:[],eventos:[],forestPlants:[],registro:[],passageTracker:{version:1,passages:[{id:"octaves",obraId:"waldstein",movId:"iii",name:"Octavas"}],observations:[]}}));
  });
  await page.goto('/');
  await page.waitForFunction(()=>window.PassageTrackerResilience&&window.CronoSaveResilience&&window.DailyStudyMinutes);
  // cronoStart defers until hydration; backdating before that would be lost.
  await page.evaluate(()=>cronoHydrate());
  await page.evaluate(()=>{
    showView('cronometro');crono.mode='stopwatch';
    document.getElementById('cronoObraSelect').value='mov::waldstein::iii';cronoUpdateStartBtn();cronoStart();
    if(crono.state!=='running')throw new Error('timer did not start synchronously');
    crono.startTs=Date.now()-36*60000;cronoSaveState();PassageTracker.toggleTimer("octaves");
  });
  if(quota!=="none")await page.evaluate(quota=>{
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(quota==="all" || key===DRAFT_KEY)throw new DOMException('Simulated full draft storage','QuotaExceededError');
      return set.call(this,key,value);
    };
  },quota);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>cronoStop());
  await page.locator('#modalCronoConfirmFinish').getByRole('button',{name:'Hecho',exact:true}).click();
  await expect(page.locator('#modalHechoDatos')).toBeVisible();
  expect(await page.evaluate(()=>crono.state)).toBe('idle');
  await page.locator('#modalHechoDatos').getByRole('button',{name:'Hecho',exact:true}).click();
  await expect(page.locator('#modalHechoDatos')).not.toBeVisible();
  const saved=await page.evaluate(async quota=>{await LocalSaveResilience.flush();return (quota==='all'?(await LocalSaveResilience.getRescueSnapshot()).data:JSON.parse(localStorage.getItem('alberto_piano_v2'))).sessionPlants;},quota);
  expect(saved.filter(p=>p.obraId==='waldstein'&&p.movId==='iii')).toHaveLength(1);
  expect(saved.find(p=>p.obraId==='waldstein').mins).toBe(36);
  await page.reload();
  await page.waitForFunction(()=>window.DailyStudyMinutes);
  await expect.poll(()=>page.evaluate(()=>crono.state)).toBe('idle');
  expect(await page.evaluate(()=>db.passageTracker.observations.length)).toBe(1);
  expect(await page.evaluate(()=>DailyStudyMinutes.todayMinutes())).toBe(36);
});

test('a pass marked when finishing is saved as a real pass inside that session, with type and scoring guide',async({page})=>{
  await page.setViewportSize({width:1024,height:1366});
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* offline fixture */'}));
  await page.addInitScript(()=>{
    if(localStorage.getItem('alberto_piano_v2'))return;
    localStorage.setItem('alberto_piano_v2',JSON.stringify({obras:[{id:'waldstein',name:'Waldstein',movimientos:[{id:'iii',name:'III',solHistory:[],paseHistory:[]}]}],sessionPlants:[],sesiones:[],eventos:[],forestPlants:[],registro:[]}));
  });
  await page.goto('/');
  await page.waitForFunction(()=>window.CronoSaveResilience&&window.DailyStudyMinutes);
  await page.evaluate(()=>cronoHydrate());
  await page.evaluate(()=>{
    showView('cronometro');crono.mode='stopwatch';
    document.getElementById('cronoObraSelect').value='mov::waldstein::iii';cronoUpdateStartBtn();cronoStart();
    crono.startTs=Date.now()-25*60000;cronoSaveState();
  });
  await page.evaluate(()=>cronoStop());
  await page.locator('#modalCronoConfirmFinish').getByRole('button',{name:'Hecho',exact:true}).click();
  const modal=page.locator('#modalHechoDatos');
  await expect(modal).toBeVisible();
  await expect(page.locator('#hechoPassDetail')).toBeHidden();
  await modal.locator('[data-hecho-pass="yes"]').click();
  // Lo mismo que «¿Cómo fue el pase?»: tipo explicado, escala de pase y guía.
  await expect(page.locator('#hechoPassDetail')).toBeVisible();
  await expect(page.locator('#hechoPassTipoHint')).toContainText('sin grabar');
  await page.locator('#hechoPassTipos .pase-tipo-btn.grabacion').click();
  await expect(page.locator('#hechoPassTipoHint')).toContainText('aunque estés solo');
  await expect(page.locator('#hechoPassMeter')).toHaveAttribute('data-rating-profile','pase');
  const guide=page.locator('#hechoPassGuide details.pase-guide');
  await guide.locator('summary').click();
  await expect(guide).toContainText('Si dudas entre dos tramos, quédate con el más bajo');
  expect(await page.evaluate(()=>parseFloat(getComputedStyle(document.getElementById('hechoPassOccurredTitle')).fontSize))).toBeGreaterThanOrEqual(15);
  await page.evaluate(()=>{const input=document.getElementById('hechoPassPercent');hechoSelectPassPct(pasePctToPosition(74),input);});
  await modal.getByRole('button',{name:'Hecho',exact:true}).click();
  await expect(modal).not.toBeVisible();
  const saved=await page.evaluate(()=>{const mov=findMovimiento('waldstein','iii');return {pases:mov.paseHistory,plants:db.sessionPlants.filter(p=>p.obraId==='waldstein'),sol:mov.solHistory};});
  // Un pase normal (no hace falta apuntarlo aparte) y el tramo de estudio lo lleva dentro.
  expect(saved.pases).toHaveLength(1);
  expect(saved.pases[0]).toMatchObject({tipo:'grabacion',solidezPct:74,source:'cierre-sesion'});
  expect(saved.plants).toHaveLength(1);
  expect(saved.plants[0]).toMatchObject({mins:25,pase:true,paseId:saved.pases[0].id,pasePct:74,paseTipo:'grabacion'});
  expect(saved.sol[0]).toMatchObject({val:74,context:'pase-grabacion'});
});
