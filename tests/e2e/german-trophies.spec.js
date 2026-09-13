import {test,expect} from '@playwright/test';
const makeGoal=(id,name,amount,createdAt,archivedAt)=>({id,name,amount,createdAt,...(archivedAt?{archivedAt}:{})});
const study=(id,goalId,day,seconds)=>({id,goalId,deviceId:'fixture',startedAt:day+'T10:00:00Z',endedAt:day+'T11:00:00Z',status:'finished',segments:[{id:day,day,seconds}]});
const goals=[makeGoal('book','Mi primer libro',.5,'2026-08-30T10:00:00Z','2026-09-02T10:00:00Z'),makeGoal('concert','Una entrada de concierto',.5,'2026-09-02T10:00:00Z','2026-09-04T10:00:00Z'),makeGoal('trip','Escapada a Berlín',50,'2026-09-05T10:00:00Z'),makeGoal('future','Auriculares',75,'2026-09-07T10:00:00Z')];
const sessions=[study('s1','book','2026-09-01',3600),study('s2','concert','2026-09-03',3600),study('s3','trip','2026-09-06',1800)];
async function prepare(page,withGoals=true) {
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* isolated test */'}));
  await page.addInitScript(data=>{
    if(!localStorage.getItem('german_trophies_seed')){
      localStorage.setItem('alberto_piano_v2',JSON.stringify(data));localStorage.setItem('german_trophies_seed','1');
    }
  },{obras:[{id:'piano',name:'Bach',movimientos:[]}],eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[],germanStudy:{goals:withGoals?goals:[],sessions:withGoals?sessions:[],materials:[],reviews:[],ledger:[]}});
  await page.goto('/');await page.waitForFunction(()=>window.GermanStudy && window.GermanTrophies);
  await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();
  await page.getByRole('button',{name:'Trofeos',exact:true}).click();
}

test('trophies show every goal, actual dates and filters, and preserve evidence after reload',async({page})=>{
  await prepare(page);
  const before=await page.evaluate(()=>JSON.stringify({goals:db.germanStudy.goals,sessions:db.germanStudy.sessions}));
  await expect(page.locator('.german-trophy-card')).toHaveCount(4);
  await expect(page.locator('.german-trophy-featured')).toContainText('Una entrada de concierto');
  const book=page.getByRole('article',{name:'Mi primer libro · Conseguido',exact:true});
  await expect(book.locator('.german-trophy-dates')).toContainText('1 sept');
  await book.getByText('Ver recorrido',{exact:true}).click();
  await expect(book.locator('ol')).toContainText('30 ago');
  await expect(book.locator('ol')).toContainText('2 sept');
  await expect(page.getByRole('article',{name:'Auriculares · En espera',exact:true})).toContainText('Aún sin estudiar');
  await page.getByRole('button',{name:'Conseguidos 2',exact:true}).click();
  await expect(page.locator('.german-trophy-card')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Conseguidos 2',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Pendientes 2',exact:true}).click();
  await expect(page.locator('.german-trophy-card')).toHaveCount(2);
  await expect(page.locator('.german-trophy-card.is-earned')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify({goals:db.germanStudy.goals,sessions:db.germanStudy.sessions}))).toBe(before);
  await page.reload();await page.waitForFunction(()=>window.GermanStudy);
  await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();await page.getByRole('button',{name:'Trofeos',exact:true}).click();
  await expect(page.locator('.german-trophy-card')).toHaveCount(4);
});

test('empty room leads to goal creation and a pending trophy without a fake start date',async({page})=>{
  await prepare(page,false);
  await page.getByRole('button',{name:'Crear mi primer objetivo',exact:true}).click();
  await page.getByLabel('Nombre del objetivo',{exact:true}).fill('<img src=x onerror=alert(1)>');
  await page.getByLabel('Importe (€)',{exact:true}).fill('50');
  await page.getByRole('button',{name:'Crear objetivo',exact:true}).click();
  await page.getByRole('button',{name:'Trofeos',exact:true}).click();
  await expect(page.locator('.german-trophy-card')).toHaveCount(1);
  await expect(page.locator('.german-trophy-card')).toContainText('Por empezar');
  await expect(page.locator('.german-trophy-dates')).toContainText('Aún sin estudiar');
  await expect(page.locator('#view-deutsch img')).toHaveCount(0);
  await page.getByRole('button',{name:'Conseguidos 0',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Tu primer trofeo está por llegar'})).toBeVisible();
});

test('opening trophies pauses a running study session without finishing it',async({page})=>{
  await prepare(page,false);
  await page.evaluate(async()=>{const st=GermanSession.ensure(db);GermanImport.insert(st,await GermanImport.parse(JSON.stringify(GermanImport.EXAMPLE)));saveData();});
  await page.getByRole('button',{name:'Resumen',exact:true}).click();
  await page.getByRole('button',{name:'Empezar estudio',exact:true}).click();
  await page.getByRole('button',{name:'Trofeos',exact:true}).click();
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].status)).toBe('paused');
  expect(await page.evaluate(()=>db.germanStudy.sessions[0].endedAt)).toBeFalsy();
  await page.getByRole('button',{name:'Resumen',exact:true}).click();
  await page.getByRole('button',{name:'Volver a la sesión',exact:true}).click();
  await expect(page.getByRole('button',{name:'Mostrar respuesta',exact:true})).toBeVisible();
});

test.describe('offline trophy room',()=>{
  test.use({serviceWorkers:'allow',timezoneId:'America/Los_Angeles',contextOptions:{reducedMotion:'reduce'}});
  test('keeps local study dates, renders on mobile and reopens offline',async({page,context})=>{
    test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await prepare(page);
    const dates=page.getByRole('article',{name:'Mi primer libro · Conseguido',exact:true}).locator('.german-trophy-dates');
    await expect(dates).toContainText('1 sept');
    expect(await page.locator('#view-deutsch').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(await page.locator('.german-trophy-art svg').first().evaluate(el=>getComputedStyle(el).transitionProperty)).toBe('none');
    expect(await page.locator('.german-trophy-art svg').first().evaluate(el=>getComputedStyle(el).transform)).toBe('none');
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.GermanStudy && window.GermanTrophies);
    await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();await page.getByRole('button',{name:'Trofeos',exact:true}).click();
    await expect(page.locator('.german-trophy-card')).toHaveCount(4);await expect(dates).toContainText('1 sept');
  });
});
