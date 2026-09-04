import {test,expect} from '@playwright/test';

async function boot(page){
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* Offline test account */'}));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});
    Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,get:()=>5});
    if(!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2',JSON.stringify({obras:[],eventos:[],sesiones:[],sessionPlants:[],forestPlants:[],registro:[],competitionPlanningSeedVersion:999,cronoTasks:[]}));
  });
  await page.goto('/');
  await page.waitForFunction(()=>window.ProfessorHandoffResilience && window.PlanningEnhancementsV4 && window.TaskSyncResilience);
  // A first-time local account offers cloud recovery; use its ordinary dismiss action.
  if(await page.locator('#modalCloudSync').isVisible()) await page.locator('#modalCloudSync').getByRole('button',{name:'Empezar de cero'}).click();
}
test('real workflow: repertoire, two movements, readiness, study, events, monthly project, task, timer, handoff and reopen',async({page,context})=>{
  test.setTimeout(120000);
  await page.setViewportSize({width:1024,height:768});
  await boot(page);
  await page.evaluate(()=>{showView('obras');openAddObra();});
  await page.locator('#newObraName').fill('Sonata de auditoría');
  await page.locator('#newObraComposer').fill('Compositor de prueba');
  await page.locator('#modalAddObra .modal-btn.primary').click();
  const wid=await page.evaluate(()=>db.obras.find(x=>x.name==='Sonata de auditoría').id);
  await page.evaluate(id=>openPremiumWork(id),wid);
  const sheet=page.locator('#obraPremiumOverlay');
  await sheet.getByRole('button',{name:'Editar obra'}).click({force:true});
  await page.locator('#obraPremiumDifficulty').fill('8');
  await sheet.locator('[data-action="add-mov"]').click();
  await sheet.locator('[data-mov-field="name"]').nth(0).fill('I · Allegro');
  await sheet.locator('[data-mov-field="duracion"]').nth(0).fill('5');
  await sheet.locator('[data-action="add-mov"]').click();
  await sheet.locator('[data-mov-field="name"]').nth(1).fill('III · Finale');
  await sheet.locator('[data-mov-field="duracion"]').nth(1).fill('7');
  await sheet.getByRole('button',{name:'Guardar cambios'}).click();
  const mids=await page.evaluate(id=>findObra(id).movimientos.map(x=>x.id),wid);
  await page.evaluate(()=>document.querySelector('#obraPremiumOverlay [data-action="close"]').click());
  await page.evaluate(({wid,mid})=>registerPase(wid,mid),{wid,mid:mids[0]});
  await page.locator('#paseQPercent').fill(await page.evaluate(()=>pasePctToPosition(82).toFixed(2)));
  await page.locator('#paseQSaveBtn').click();
  await page.evaluate(()=>{showView('session');document.querySelector('#sessionStatsSection .stats-primary-add').click();});
  await page.locator('#studyRegisterObra').selectOption(`mov::${wid}::${mids[1]}`);
  await page.locator('#studyMinutePresets [data-minutes="25"]').click();
  await page.locator('#studyRegisterSaveBtn').click();
  await page.evaluate(()=>{showView('calendario');openAddEvento();});
  await page.locator('#eventoNombre').fill('Audición de auditoría');
  await page.locator('#eventoFecha').fill('2028-10-12');
  await page.locator(`#obraCheckList input[value="${wid}"]`).check();
  await page.locator('#modalAddEvento .modal-btn.primary').click();
  await page.evaluate(()=>openAddEvento());
  await page.locator('[data-evento-tipo="proyecto"]').click();
  await page.locator('#eventoNombre').fill('Proyecto mensual de auditoría');
  await page.locator('[data-project-mode="month"]').click();
  await page.locator('#eventoProyectoMes').fill('2028-11');
  await page.locator(`#obraCheckList input[value="${wid}"]`).check();
  await page.locator('#modalAddEvento .modal-btn.primary').click();
  await page.evaluate(()=>{showView('cronometro');cronoSetIdleDrawerTab('tareas');});
  await page.locator('#cronoIdleTasksPanel button[aria-label="Añadir tarea de Personal"]').click();
  await page.locator('#cronoIdleTaskInput').fill('Preparar la partitura urgentísima');
  await page.locator('#cronoIdleTasksPanel .crono-task-add-btn').click();
  await page.evaluate(({wid,mid})=>{
    document.getElementById('cronoObraSelect').value=`mov::${wid}::${mid}`;cronoUpdateStartBtn();cronoStart();
    crono.startTs=Date.now()-10*60000;cronoSaveState();
  },{wid,mid:mids[0]});
  await page.evaluate(()=>cronoStop());
  await page.locator('#modalCronoConfirmFinish').getByRole('button',{name:'Hecho',exact:true}).click();
  await page.locator('#modalHechoDatos').getByRole('button',{name:'Hecho',exact:true}).click();
  await page.evaluate(()=>showView('profesor'));
  const fixed='2026-09-04T20:00:00+02:00';
  const before=await page.evaluate(({wid,fixed})=>{
    const report=ProfessorCore.buildReport(db,{asOf:new Date(fixed),googleCalendarState:{}});
    const encoded=ProfessorHandoffResilience.denseContext(report);
    const built=ProfessorCore.buildChatGptUrl(report,{now:new Date(fixed),note:'Conservar todos los movimientos'});
    return {units:report.units.filter(u=>String(u.obraId)===String(wid)),report,decoded:ProfessorHandoffResilience.decodeContext(encoded),built,
      doc:JSON.parse(localStorage.getItem('alberto_piano_v2'))};
  },{wid,fixed});
  expect(before.decoded).toEqual(JSON.parse(JSON.stringify(before.report)));
  expect(before.units).toHaveLength(2);
  expect(before.units.every(x=>x.linkedEvents.length>=2)).toBe(true);
  expect(before.doc.eventos.find(x=>x.nombre==='Proyecto mensual de auditoría')).toMatchObject({fechaFlexibleTipo:'mes',fechaObjetivoMes:'2028-11'});
  expect(before.doc.cronoTasks.some(x=>x.text==='Preparar la partitura'&&x.priority===3)).toBe(true);
  expect(before.doc.sessionPlants.filter(x=>String(x.obraId)===String(wid)).length).toBeGreaterThanOrEqual(2);
  expect(before.built.truncated).toBe(false);
  // The application shell is served locally; connected services are unavailable.
  // SW promotion is exercised independently by the update-protocol tests.
  await context.setOffline(true);
  expect(await page.evaluate(()=>UpdateSafety.safeUpdate())).toBe(false);
  await context.setOffline(false);
  await page.reload();
  await page.waitForFunction(()=>window.ProfessorHandoffResilience && window.TaskSyncResilience);
  const after=await page.evaluate(({wid,fixed})=>{
    const r=ProfessorCore.buildReport(db,{asOf:new Date(fixed),googleCalendarState:{}});
    return {units:r.units.filter(u=>String(u.obraId)===String(wid)),doc:JSON.parse(localStorage.getItem('alberto_piano_v2'))};
  },{wid,fixed});
  expect(after.units).toEqual(before.units);
  expect(after.doc.sessionPlants).toEqual(before.doc.sessionPlants);
  expect(after.doc.obras.find(x=>x.id===wid)).toEqual(before.doc.obras.find(x=>x.id===wid));
  expect(after.doc.cronoTasks).toEqual(before.doc.cronoTasks);
  expect(after.doc.eventos).toEqual(before.doc.eventos);
});

test('iPad release coordinates and delayed Safari snapback cannot replace a committed rating or a new drag',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{
    db.obras.push({id:'gesture',name:'Gestos',movimientos:[],solHistory:[]});registerPase('gesture');
  });
  const result=await page.evaluate(async()=>{
    const meter=document.getElementById('paseQMeter'),input=document.getElementById('paseQPercent');
    const reservoir=meter.querySelector('.pase-liquid-reservoir'),r=reservoir.getBoundingClientRect();
    const emit=(type,ratio)=>reservoir.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:73,pointerType:'touch',button:0,clientX:r.left+r.width*ratio,clientY:r.top+r.height/2}));
    emit('pointerdown',.2);emit('pointermove',.74);await new Promise(requestAnimationFrame);const stable=input.value;emit('pointerup',.1);
    input.value='10';input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,180));const corrected=input.value;
    emit('pointerdown',.5);emit('pointerup',.1);emit('pointerdown',.9);
    await new Promise(r=>setTimeout(r,80));await new Promise(requestAnimationFrame);const newDrag=input.value;emit('pointerup',.1);
    return {stable,corrected,newDrag,final:input.value};
  });
  expect(result.corrected).toBe(result.stable);expect(Number(result.newDrag)).toBeGreaterThan(85);expect(result.final).toBe(result.newDrag);
});

test('worker and main report are equivalent; opening ChatGPT keeps every unit and the real local time',async({page})=>{
  test.setTimeout(60000);await boot(page);
  await page.waitForFunction(()=>ReadinessCore.estimateReadiness.__technicalDifficultyModel===true);
  const result=await page.evaluate(async()=>{
    db.obras=Array.from({length:15},(_,w)=>({id:'w'+w,name:'Sonata '+w,tipo:w%2?'camara':'obra',dificultad:8,minutosExtra:3000,
      movimientos:Array.from({length:5},(_,m)=>({id:'m'+m,name:'I | ~ '+m,sol:40+m*10,solHistory:[]}))}));
    db.obras.push({id:'whole-ready',name:'Obra sin movimientos',tipo:'obra',dificultad:9,dificultadFuente:'manual',sol:45,
      solHistory:[{date:'2026-09-01T12:00:00Z',val:45}],movimientos:[]});
    db.eventos=[{id:'all',nombre:'Concierto',fecha:'2028-12-01',obras:db.obras.map(w=>w.id),estado:'confirmado'}];saveLocalNow();
    const now='2026-09-04T17:23:45Z';
    const main=ProfessorCore.buildReport(db,{asOf:new Date(now),googleCalendarState:{}});
    const original=ProfessorCore.buildReport;let calls=0;ProfessorCore.buildReport=(...args)=>{calls++;return original(...args);};
    const worker=await ProfessorHandoffResilience.buildReportAsync(db,{now,googleCalendarState:{}});
    ProfessorCore.buildReport=original;
    window.__auditOpened=[];window.__auditClipboard='';
    window.open=()=>({opener:null,location:{replace:url=>window.__auditOpened.push(url)},close(){}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__auditClipboard=t;}}});
    showView('profesor');
    return {main:JSON.parse(JSON.stringify(main)),worker:JSON.parse(JSON.stringify(worker)),calls};
  });
  expect(result.calls,'heavy report computation must run off the main thread').toBe(0);
  expect(result.worker).toEqual(result.main);
  await page.locator('#professorUserNote').fill('No perder ningún movimiento');
  const openedAfter=Date.now();
  await page.locator('[data-prof-mode="remaining"]').click();
  await expect.poll(()=>page.evaluate(()=>window.__auditOpened.length)).toBe(1);
  const sent=await page.evaluate(()=>({url:window.__auditOpened[0],text:window.__auditClipboard,
    report:ProfessorHandoffResilience.decodeContext(window.__auditClipboard)}));
  expect(sent.url.length).toBeLessThan(1000);expect(sent.report.units).toHaveLength(76);
  expect(sent.text).toContain('No perder ningún movimiento');expect(sent.text).toContain('HORA_LOCAL_REAL');
  expect(Date.parse(sent.report.asOf)).toBeGreaterThanOrEqual(openedAfter-1000);
  expect(new Set(sent.report.units.map(u=>u.key)).size).toBe(76);
});
