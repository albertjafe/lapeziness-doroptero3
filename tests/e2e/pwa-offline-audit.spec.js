import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'allow'});
test('installed PWA reopens offline with the complete document and Profesor',async({page,context})=>{
  test.setTimeout(60000);
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* isolated offline account */'}));
  await page.goto('/');
  await page.waitForFunction(()=>window.ProfessorHandoffResilience);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const before=await page.evaluate(()=>{
    db.obras.push({id:'offline-new',name:'Sin conexión',movimientos:[{id:'offline-m',name:'III',sol:83,solHistory:[{val:83,date:new Date().toISOString()}]}]});
    db.eventos.push({id:'offline-project',nombre:'Mes',tipo:'proyecto',fecha:'2028-10-31',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2028-10',obras:['offline-new']});
    (db.cronoTasks ||= []).push({id:'offline-task',text:'Conservar'});saveLocalNow();return JSON.parse(localStorage.getItem('alberto_piano_v2'));
  });
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.ProfessorHandoffResilience);
  const after=await page.evaluate(()=>({data:JSON.parse(localStorage.getItem('alberto_piano_v2')),report:ProfessorCore.buildReport(db,{googleCalendarState:{}})}));
  expect(after.data.obras.find(x=>x.id==='offline-new')).toEqual(before.obras.find(x=>x.id==='offline-new'));
  const {updatedAt,_fieldClock,...originalEvent}=before.eventos.find(x=>x.id==='offline-project');
  expect(after.data.eventos.find(x=>x.id==='offline-project')).toMatchObject(originalEvent);
  expect(after.data.cronoTasks.some(x=>x.id==='offline-task')).toBe(true);
  expect(after.report.units.find(u=>u.obraId==='offline-new')).toMatchObject({movId:'offline-m',solidity:83});
  expect(after.report.events.find(e=>e.id==='offline-project')).toMatchObject({day:'2028-10',datePrecision:'month'});
});
