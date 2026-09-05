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
  await page.evaluate(()=>{
    showView('cronometro');crono.mode='stopwatch';
    document.getElementById('cronoObraSelect').value='mov::waldstein::iii';cronoUpdateStartBtn();cronoStart();
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
