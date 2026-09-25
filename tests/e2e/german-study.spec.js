import {test,expect} from '@playwright/test';
const fixture={obras:[{id:'piano',name:'Bach',movimientos:[]}],eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[]};
const pack={schema:'german-study-pack.v1',metadata:{title:'Clase de prueba'},cards:[{type:'de_es',front:'der Bahnhof',back:'la estación',explanation:'Sustantivo masculino.'}],exercises:[{type:'conjugation',prompt:'Conjuga warten con du.',answer:'du wartest',acceptedAnswers:['wartest']},{type:'free_write',prompt:'Describe tu viaje.',answer:'Ich fahre nach Berlin.'}]};
async function openDeutsch(page) {
  const desktopEntry=page.getByRole('button',{name:'Alemán',exact:true});
  if(await desktopEntry.isVisible()) await desktopEntry.click();
  else await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();
}
async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* offline test */'}));
  await page.addInitScript(data=>{if(!localStorage.getItem('german_test_seed')){localStorage.setItem('alberto_piano_v2',JSON.stringify(data));localStorage.setItem('german_test_seed','1');}},fixture);
  await page.goto('/');await page.waitForFunction(()=>window.GermanStudy && window.UpdateSafety);
  await openDeutsch(page);
}
async function importPack(page,data=pack) {
  await page.locator('#germanImportFile').setInputFiles({name:'clase.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator('#germanError')).toContainText('Material importado');
}
// Goals live in the shared purchase-goal wallet, on the Premios screen.
async function openWallet(page){await page.evaluate(()=>openPremios());return page.locator('#germanSharedGoal');}
async function createGoal(page,name='Kindle',amount='150',stay=false) {
  const wallet=await openWallet(page);
  await wallet.getByLabel('Objetivo',{exact:true}).fill(name);
  await wallet.getByLabel('Precio (€)',{exact:true}).fill(amount);
  await wallet.getByRole('button',{name:'Añadir objetivo',exact:true}).click();
  await expect(wallet).toContainText(name);
  if(!stay)await page.evaluate(()=>showView('deutsch'));
}

test('Deutsch end to end: goal, class deck, Anki card, money, pause/reload and idempotent finish',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await prepare(page);await importPack(page);await createGoal(page);
  await expect(page.locator('.german-habit-phase')).toContainText('Tarifa de implantación');
  await expect(page.locator('.german-habit-phase')).toContainText('15/21');
  await expect(page.getByRole('heading',{name:'Tus tarjetas',exact:true})).toBeVisible();
  await expect(page.locator('.german-deck')).toContainText('Clase de prueba');
  await expect(page.locator('.german-deck')).not.toContainText('ejercicios');
  await page.getByRole('button',{name:'Estudiar esta clase',exact:true}).click();
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].queue.every(item=>item.kind==='card'))).toBe(true);
  await expect(page.getByRole('heading',{name:'der Bahnhof',exact:true})).toBeVisible();
  await expect(page.locator('#germanMoneyLabel')).toContainText('Pendiente');
  // Cents appear after a few seconds of real study time.
  await expect.poll(()=>page.locator('#germanMoney').innerText(),{timeout:15000}).not.toBe('0,00 €');
  await page.getByRole('button',{name:'Mostrar respuesta',exact:true}).click();
  await expect(page.getByRole('heading',{name:'la estación',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Bien/})).toContainText('1 día');
  await page.getByRole('button',{name:/Bien/}).click();
  await expect(page.getByRole('heading',{name:'Repaso terminado',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pausar',exact:true}).click();
  const seconds=await page.evaluate(()=>db.germanStudy.sessions[0].segments.reduce((n,x)=>n+x.seconds,0));
  expect(await page.evaluate(()=>UpdateSafety.safeUpdate())).toBe(false);
  await page.reload();await page.waitForFunction(()=>window.GermanStudy);
  await openDeutsch(page);
  await expect(page.getByRole('button',{name:'Continuar',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].segments.reduce((n,x)=>n+x.seconds,0))).toBe(seconds);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('button',{name:'Terminar sesión',exact:true}).click();
  const result=await page.evaluate(()=>({study:db.germanStudy,piano:db.sessionPlants,obras:db.obras}));
  expect(result.study.sessions).toHaveLength(1);expect(result.study.sessions[0].endedAt).toBeTruthy();expect(result.study.reviews).toHaveLength(1);
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
  await page.getByRole('button',{name:'Estudiar tarjetas',exact:true}).click();
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
  await page.getByRole('button',{name:'Estudiar tarjetas',exact:true}).click();
  const other=await context.newPage();await prepare(other);
  await other.getByRole('button',{name:'Continuar',exact:true}).click();
  await expect(other.locator('#germanError')).toContainText('otra pestaña');
  expect(await page.evaluate(()=>db.germanStudy.sessions.length)).toBe(1);
  await other.close();
});

test('small-screen Deutsch keeps controls inside the viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await prepare(page);await importPack(page);await createGoal(page);
  await page.getByRole('button',{name:'Estudiar tarjetas',exact:true}).click();
  expect(await page.locator('#view-deutsch').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'Pausar',exact:true})).toBeVisible();
});

test('a completed goal can be redeemed and a new goal preserves reviews and history',async({page})=>{
  page.on('dialog',dialog=>dialog.accept());
  await prepare(page);await importPack(page);await createGoal(page,'Libro','0.50');
  await page.getByRole('button',{name:'Estudiar tarjetas',exact:true}).click();
  await page.getByRole('button',{name:'Mostrar respuesta',exact:true}).click();await page.getByRole('button',{name:/Bien/}).click();
  await page.evaluate(()=>{const s=db.germanStudy.sessions[0],day=GermanRewards.dayKey();s.segments=[{id:day,day,seconds:900}];saveData();});
  await page.getByRole('button',{name:'Terminar sesión',exact:true}).click();
  const wallet=await openWallet(page);
  await wallet.getByRole('button',{name:'Canjear · comprado',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(db.germanStudy.goals[0].archivedAt))).toBe(true);
  await wallet.getByRole('button',{name:/Añadir/}).first().click();
  await createGoal(page,'Kindle','150',true);
  expect(await page.evaluate(()=>({goals:db.germanStudy.goals.length,reviews:db.germanStudy.reviews.length,sessions:db.germanStudy.sessions.length}))).toEqual({goals:2,reviews:1,sessions:1});
});

test('shared economic goal can be edited and deleted without deleting session evidence',async({page})=>{
  page.on('dialog',dialog=>dialog.accept());
  await prepare(page);await createGoal(page,'Kindle','150',true);
  const wallet=page.locator('#germanSharedGoal');
  await wallet.getByRole('button',{name:'Editar',exact:true}).click();
  await wallet.getByLabel('Objetivo',{exact:true}).fill('E-reader');
  await wallet.getByLabel('Precio (€)',{exact:true}).fill('249.99');
  await wallet.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(wallet).toContainText('E-reader');
  expect(await page.evaluate(()=>db.germanStudy.goals[0])).toMatchObject({name:'E-reader',amount:249.99});

  await page.evaluate(()=>{
    const goalId=db.germanStudy.goals[0].id,now=new Date().toISOString();
    db.pianoRewards={version:1,sessions:[{id:'kept-piano-session',goalId,startedAt:now,endedAt:now,date:PianoRewards.dayKey(),seconds:1800,policyVersion:2}]};
    saveData();
  });
  await wallet.getByRole('button',{name:'Eliminar',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(db.germanStudy.goals[0].deletedAt))).toBe(true);
  const result=await page.evaluate(()=>db.pianoRewards.sessions);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('kept-piano-session');
});

test('free study uses the same taximeter and reloads paused without counting closed time',async({page})=>{
  await prepare(page);await createGoal(page);
  await page.clock.install();
  await page.getByRole('button',{name:'Estudio libre',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Estudio libre',exact:true})).toBeVisible();
  await page.clock.runFor(301000);
  // Cents appear after a few seconds of real study time.
  await expect.poll(()=>page.locator('#germanMoney').innerText(),{timeout:15000}).not.toBe('0,00 €');
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].status)).toBe('running');
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].segments.reduce((n,x)=>n+x.seconds,0))).toBeGreaterThan(0);
  await page.reload();await page.waitForFunction(()=>window.GermanStudy);
  await openDeutsch(page);
  await expect(page.getByRole('button',{name:'Continuar',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].mode)).toBe('free');
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
    await page.getByRole('button',{name:'Estudiar tarjetas',exact:true}).click();
    await page.getByRole('button',{name:'Mostrar respuesta',exact:true}).click();await page.getByRole('button',{name:/Bien/}).click();
    await page.getByRole('button',{name:'Pausar',exact:true}).click();
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.GermanStudy);
    await openDeutsch(page);
    await expect(page.getByRole('heading',{name:'Repaso terminado',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Continuar',exact:true}).click();
    await page.getByRole('button',{name:'Terminar sesión',exact:true}).click();
    expect(await page.evaluate(()=>db.germanStudy.reviews.length)).toBe(1);
  });
});
