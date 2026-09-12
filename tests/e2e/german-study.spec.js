import {test,expect} from '@playwright/test';
const fixture={obras:[{id:'piano',name:'Bach',movimientos:[]}],eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[]};
const pack={schema:'german-study-pack.v1',metadata:{title:'Clase de prueba'},cards:[{type:'de_es',front:'der Bahnhof',back:'la estación',explanation:'Sustantivo masculino.'}],exercises:[{type:'conjugation',prompt:'Conjuga warten con du.',answer:'du wartest',acceptedAnswers:['wartest']},{type:'free_write',prompt:'Describe tu viaje.',answer:'Ich fahre nach Berlin.'}]};
async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* offline test */'}));
  await page.addInitScript(data=>{if(!localStorage.getItem('german_test_seed')){localStorage.setItem('alberto_piano_v2',JSON.stringify(data));localStorage.setItem('german_test_seed','1');}},fixture);
  await page.goto('/');await page.waitForFunction(()=>window.GermanStudy && window.UpdateSafety);
  await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();
}
async function importPack(page,data=pack) {
  await page.getByRole('button',{name:'Materiales',exact:true}).click();
  await page.locator('#germanImportFile').setInputFiles({name:'clase.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator('#germanError')).toContainText('Material importado');
}
async function createGoal(page) {
  await page.getByRole('button',{name:'Resumen',exact:true}).click();
  await page.getByLabel('Nombre del objetivo',{exact:true}).fill('Kindle');
  await page.getByLabel('Importe (€)',{exact:true}).fill('150');
  await page.getByRole('button',{name:'Crear objetivo',exact:true}).click();
}

test('Deutsch end to end: goal, import, card, exercise, money, pause/reload and idempotent finish',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await prepare(page);await importPack(page);await createGoal(page);
  await page.getByRole('button',{name:'Empezar estudio',exact:true}).click();
  await expect(page.getByRole('heading',{name:'der Bahnhof',exact:true})).toBeVisible();
  await expect(page.locator('#germanMoneyLabel')).toContainText('Pendiente');
  await expect.poll(()=>page.locator('#germanMoney').innerText()).not.toBe('0,000 €');
  await page.getByRole('button',{name:'Mostrar respuesta',exact:true}).click();
  await expect(page.getByRole('heading',{name:'la estación',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Good',exact:true}).click();
  await page.getByLabel('Tu respuesta',{exact:true}).fill('wartest');
  await page.getByRole('button',{name:'Comprobar respuesta',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Correcto ✓',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();
  await page.getByLabel('Tu respuesta',{exact:true}).fill('Ich fahre nach Berlin.');
  await page.getByRole('button',{name:'Ver solución modelo',exact:true}).click();
  await page.getByRole('button',{name:'Parcial',exact:true}).click();
  await expect(page.getByRole('heading',{name:'¡Repaso terminado!',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Seguir repasando',exact:true}).click();
  await page.getByRole('button',{name:'Pausar',exact:true}).click();
  const seconds=await page.evaluate(()=>db.germanStudy.sessions[0].segments.reduce((n,x)=>n+x.seconds,0));
  expect(await page.evaluate(()=>UpdateSafety.safeUpdate())).toBe(false);
  await page.reload();await page.waitForFunction(()=>window.GermanStudy);
  await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continuar',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].segments.reduce((n,x)=>n+x.seconds,0))).toBe(seconds);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('button',{name:'Terminar sesión',exact:true}).click();
  const result=await page.evaluate(()=>({study:db.germanStudy,piano:db.sessionPlants,obras:db.obras}));
  expect(result.study.sessions).toHaveLength(1);expect(result.study.sessions[0].endedAt).toBeTruthy();expect(result.study.reviews).toHaveLength(3);
  expect(result.study.ledger.reduce((n,x)=>n+x.finalReward,0)).toBe(0);expect(result.piano).toEqual([]);expect(result.obras[0].id).toBe('piano');
  await page.evaluate(()=>{const s=db.germanStudy;GermanSession.finish(s,s.sessions[0].id);saveData();});
  expect(await page.evaluate(()=>db.germanStudy.sessions.length)).toBe(1);expect(errors).toEqual([]);
});

test('imports are atomic, duplicates detected and imported HTML is inert',async({page})=>{
  await prepare(page);await importPack(page);
  await page.locator('#germanImportFile').setInputFiles({name:'clase.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack,null,2))});
  await expect(page.locator('#germanError')).toContainText('ya estaba importado');
  await page.locator('#germanImportFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...pack,cards:[{}]}))});
  await expect(page.locator('#germanError')).toContainText('cards[0]');expect(await page.evaluate(()=>db.germanStudy.materials.length)).toBe(1);
  await importPack(page,{...pack,metadata:{title:'<img src=x onerror=alert(1)>'}});
  expect(await page.locator('#view-deutsch img').count()).toBe(0);
});

test('qualifies at 15:00, keeps the cap and pauses when leaving Deutsch',async({page})=>{
  await prepare(page);await importPack(page);await createGoal(page);
  await page.clock.install();
  await page.getByRole('button',{name:'Empezar estudio',exact:true}).click();
  await page.evaluate(()=>{const s=db.germanStudy.sessions[0],day=GermanRewards.dayKey();s.segments=[{id:day,day,seconds:899}];saveData();});
  await page.clock.runFor(1000);
  await expect(page.locator('#germanMinimum')).toContainText('15 min mínimos ✓');
  await expect(page.locator('#germanMoneyLabel')).toContainText('Consolidado');
  await expect(page.locator('#germanMilestone')).toContainText('Día conseguido');
  expect(await page.evaluate(()=>db.germanStudy.ledger.reduce((n,e)=>n+e.finalReward,0))).toBeGreaterThanOrEqual(1);
  await page.getByRole('button',{name:'Volver a Hoy',exact:true}).click();
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].status)).toBe('paused');
  const before=await page.evaluate(()=>db.germanStudy.sessions[0].segments[0].seconds);
  await page.clock.fastForward(3600000);
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].segments[0].seconds)).toBe(before);
});

test('a second tab cannot run or finalize the first tab session',async({page,context})=>{
  await prepare(page);await importPack(page);await createGoal(page);
  await page.getByRole('button',{name:'Empezar estudio',exact:true}).click();
  const other=await context.newPage();await prepare(other);
  await other.getByRole('button',{name:'Continuar',exact:true}).click();
  await expect(other.locator('#germanError')).toContainText('otra pestaña');
  expect(await page.evaluate(()=>db.germanStudy.sessions.length)).toBe(1);
  await other.close();
});

test('small-screen Deutsch keeps controls inside the viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await prepare(page);await importPack(page);await createGoal(page);
  await page.getByRole('button',{name:'Empezar estudio',exact:true}).click();
  expect(await page.locator('#view-deutsch').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'Pausar',exact:true})).toBeVisible();
});

test('finished goal can be archived and a new goal preserves reviews and history',async({page})=>{
  await prepare(page);await importPack(page);
  await page.getByRole('button',{name:'Resumen',exact:true}).click();
  await page.getByLabel('Nombre del objetivo',{exact:true}).fill('Libro');await page.getByLabel('Importe (€)',{exact:true}).fill('0.50');
  await page.getByRole('button',{name:'Crear objetivo',exact:true}).click();
  await page.getByRole('button',{name:'Empezar estudio',exact:true}).click();
  await page.getByRole('button',{name:'Mostrar respuesta',exact:true}).click();await page.getByRole('button',{name:'Good',exact:true}).click();
  await page.evaluate(()=>{const s=db.germanStudy.sessions[0],day=GermanRewards.dayKey();s.segments=[{id:day,day,seconds:900}];saveData();});
  await page.getByRole('button',{name:'Terminar sesión',exact:true}).click();
  await expect(page.locator('.german-goal')).toContainText('OBJETIVO CONSEGUIDO');
  await page.getByRole('button',{name:'Archivar y crear otro objetivo',exact:true}).click();await createGoal(page);
  expect(await page.evaluate(()=>({goals:db.germanStudy.goals.length,reviews:db.germanStudy.reviews.length,sessions:db.germanStudy.sessions.length}))).toEqual({goals:2,reviews:1,sessions:1});
});

test('reload of running exercise preserves draft and excludes all closed time',async({page})=>{
  await prepare(page);await importPack(page);await createGoal(page);
  await page.getByRole('button',{name:'Elegir modo',exact:true}).click();await page.getByRole('button',{name:'Ejercicios',exact:true}).click();
  await page.getByLabel('Tu respuesta',{exact:true}).fill('Mi borrador');
  await page.reload();await page.waitForFunction(()=>window.GermanStudy);
  await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continuar',exact:true})).toBeVisible();
  await expect(page.getByLabel('Tu respuesta',{exact:true})).toHaveValue('Mi borrador');
  const before=await page.evaluate(()=>db.germanStudy.sessions[0].segments.reduce((n,x)=>n+x.seconds,0));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].segments.reduce((n,x)=>n+x.seconds,0))).toBe(before);
});

test.describe('Deutsch installed PWA',()=>{
  test.use({serviceWorkers:'allow'});
  test('imports, studies and restores material and reviews offline',async({page,context})=>{
    test.setTimeout(60000);await prepare(page);await importPack(page);await createGoal(page);
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.getByRole('button',{name:'Empezar estudio',exact:true}).click();
    await page.getByRole('button',{name:'Mostrar respuesta',exact:true}).click();await page.getByRole('button',{name:'Good',exact:true}).click();
    await page.getByRole('button',{name:'Pausar',exact:true}).click();
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.GermanStudy);
    await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();
    await expect(page.getByLabel('Tu respuesta',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByLabel('Tu respuesta',{exact:true}).fill('wartest');
    await page.getByRole('button',{name:'Comprobar respuesta',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Correcto ✓',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Terminar sesión',exact:true}).click();
    expect(await page.evaluate(()=>db.germanStudy.reviews.length)).toBe(2);
  });
});
