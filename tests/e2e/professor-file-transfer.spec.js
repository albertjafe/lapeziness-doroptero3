import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import handoff from '../../professor-handoff-resilience.js';

test('large iPad context downloads as one complete file, preserves history and saves the selected daily hours',async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1024,height:768});
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* no cloud account */'}));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});
    Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,get:()=>5});
    if(localStorage.getItem('alberto_piano_v2')) return;
    const works=Array.from({length:20},(_,i)=>({id:'w'+i,name:'Obra '+i,dificultad:7,minutosExtra:4000,
      movimientos:Array.from({length:4},(_,m)=>({id:'m'+m,name:'Movimiento '+m,sol:50,solHistory:[]}))}));
    const sessionPlants=Array.from({length:3000},(_,i)=>{
      const date=new Date();date.setMinutes(date.getMinutes()-1);date.setDate(date.getDate()-i%120);
      return {id:'p'+i,obraId:'w'+i%20,movId:'m'+i%4,mins:12.5,startedAt:date.toISOString(),
        observation:'Memoria, ataques y reentradas: conservar esta observación musical completa. '+i};
    });
    sessionPlants.push({id:'old-sentinel',obraId:'w0',movId:'m0',mins:37,startedAt:'2021-01-01T10:00:00Z',future:{unknown:null}});
    localStorage.setItem('alberto_piano_v2',JSON.stringify({obras:works,sessionPlants,sesiones:[],forestPlants:[],registro:[],
      competitionPlanningSeedVersion:999,eventos:[
        {id:'linked',nombre:'Concierto',fecha:'2028-12-01',estado:'confirmado',obras:works.map(w=>w.id)},
        {id:'empty-event',nombre:'Pendiente de repertorio',fecha:'2028-11-01',obras:[]},
      ],cronoTasks:[{id:'task',text:'Preparar ensayo'}]}));
  });
  await page.goto('/');
  await page.waitForFunction(()=>window.ProfessorHandoffResilience&&window.ProfessorDurationPolicy);
  if(await page.locator('#modalCloudSync').isVisible()) await page.locator('#modalCloudSync').getByRole('button',{name:'Empezar de cero'}).click();
  await page.evaluate(()=>{
    window.__mainReportCalls=0;
    const original=ProfessorCore.buildReport;
    ProfessorCore.buildReport=(...args)=>{window.__mainReportCalls++;return original(...args);};
    showView('profesor');
  });
  await page.locator('#professorDailyHours').selectOption('5');
  await page.locator('#professorUserNote').fill('Esta semana hay ensayo el jueves; respeta mi contexto completo.');
  const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('alberto_piano_v2')).sessionPlants);
  await page.locator('[data-prof-mode="week"]').click();
  const panel=page.locator('#professorTransfer');
  await expect(panel).toBeVisible();
  await expect(panel.locator('textarea')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('professor-transfer.png')});
  expect(await page.evaluate(()=>window.__mainReportCalls)).toBe(0);
  const link=panel.getByRole('link',{name:'Abrir ChatGPT'});
  const url=new URL(await link.getAttribute('href'));
  expect(url.pathname).toBe('/');expect(url.searchParams.has('prompt')).toBe(false);
  expect(url.searchParams.get('temporary-chat')).toBe('true');
  const downloadPromise=page.waitForEvent('download');
  await panel.getByRole('link',{name:'Guardar archivo completo'}).click();
  const download=await downloadPromise;
  const text=fs.readFileSync(await download.path(),'utf8');
  const report=handoff.decodeContext(text);
  expect(report.units).toHaveLength(80);
  expect(report.sourceContext.sessionPlants).toEqual(original);
  expect(report.sourceContext.events.some(e=>e.id==='empty-event')).toBe(true);
  expect(report.recentStudyDays).toHaveLength(90);
  expect(text).toContain('Referencia guardada: 5 horas TOTALES');
  expect(text).toContain('Esta referencia es diaria, no el total semanal');
  expect(text).toContain('Esta semana hay ensayo el jueves');
  expect(text).toContain('FIN_PIANO_PROF_V4');
  await page.evaluate(()=>{
    window.__staleCopies=0;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{window.__staleCopies++;},write:async()=>{window.__staleCopies++;}}});
    db.cronoTasks.push({id:'new-after-file',text:'Nueva condición después del archivo'});saveLocalNow();
  });
  await panel.getByRole('button',{name:'Copiar todo · un mensaje'}).click();
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(()=>window.__staleCopies)).toBe(0);
  await page.locator('#professorDailyHours').selectOption('6');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('alberto_piano_v2')).professorSettings.dailyHours)).toBe(6);
  await page.reload();
  await page.waitForFunction(()=>window.ProfessorHandoffResilience&&window.ProfessorDurationPolicy);
  await page.evaluate(()=>showView('profesor'));
  await expect(page.locator('#professorDailyHours')).toHaveValue('6');
});
