import {test,expect} from '@playwright/test';
const day=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
async function boot(page,desktop=false){
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(({day,desktop})=>{
    if(desktop)Object.defineProperty(navigator,'platform',{get:()=> 'Win32'});
    const data={competitionPlanningSeedVersion:999,eventos:[],sesiones:[],forestPlants:[],registro:[],
      obras:[{id:'w1',name:'Sonata para piano (1900), Op. 123',composer:'Example Composer'},{id:'w2',name:'Cuarteto',composer:'Other Composer'}],
      sessionPlants:[{id:'a',obraId:'w1',mins:40,startedAt:day+'T09:00:00',endedAt:day+'T09:40:00',source:'app'},{id:'b',obraId:'w2',mins:40,startedAt:day+'T10:00:00',endedAt:day+'T10:40:00',source:'app'}],
      passageTracker:{version:3,passages:[{id:'p1',obraId:'w1',name:'Octavas',difficulty:3},{id:'p2',obraId:'w2',name:'Arpegios',difficulty:3}],observations:[]}};
    if(!localStorage.getItem('alberto_piano_v2'))localStorage.setItem('alberto_piano_v2',JSON.stringify(data));
  },{day:day(),desktop});
  await page.goto('/');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/);
  await page.waitForFunction(()=>window.Diario&&window.DiarioSections&&window.UpdateSafety);
  await page.evaluate(()=>{
    document.querySelectorAll('.modal-overlay.visible').forEach(x=>closeModal(x.id));
    showView('diario');
  });
  await expect(page.locator('.dia-turning')).toHaveCount(0,{timeout:5000});
}
for(const width of [390,1366])test.describe('scoped diary sections '+width,()=>{
  test.use({viewport:{width,height:900},reducedMotion:'reduce',
    userAgent:width>1200?'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36':undefined});
  test('reuses a passage, creates a section and restores it without offering other works or free notes',async({page})=>{
    await boot(page,width>1200);
    const today=page.locator('[data-day="'+day()+'"]'),a=today.locator('[data-work="w1"]'),b=today.locator('[data-work="w2"]');
    await a.locator('[data-act="section"]').click();
    const area=a.locator('.dia-ink').first();
    await area.fill('@Oct');
    await expect(a.getByRole('option')).toHaveText(['Octavas','Crear «Oct»En esta obra']);
    await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');await page.keyboard.insertText('Más estable hoy');
    await area.blur();
    await expect(a.locator('.dia-section-heading')).toHaveText('Octavas');
    await expect.poll(()=>page.evaluate(()=>db.dailyJournalEntries.find(e=>e.ref==='p:a')?.sectionRefs?.[0]?.id)).toBe('p1');

    await b.locator('[data-act="section"]').click();
    await expect(b.getByRole('option')).toHaveText('Arpegios');
    await b.locator('.dia-ink').fill('@Desarrollo');
    await b.getByRole('option',{name:/Crear «Desarrollo»/}).click();
    await page.keyboard.insertText('Lento y claro');
    await b.locator('.dia-ink').blur();
    await expect.poll(()=>page.evaluate(()=>db.journalSections?.filter(x=>x.obraId==='w2').length)).toBe(1);
    await page.evaluate(async()=>{flushSaveDataSoon();await LocalSaveResilience.flush();});
    await page.reload();await expect(page.locator('#splashScreen')).toHaveClass(/gone/);await page.waitForFunction(()=>window.Diario&&window.DiarioSections);
    await page.evaluate(()=>{document.querySelectorAll('.modal-overlay.visible').forEach(x=>closeModal(x.id));showView('diario');});
    await expect(a.locator('.dia-section-heading')).toHaveText('Octavas');
    await expect(b.locator('.dia-section-heading')).toHaveText('Desarrollo');
    await b.locator('[data-act="section"]').click();
    await b.locator('.dia-ink').fill('[[Desarrollo]]\nLento y claro\n@Des');
    await expect(b.getByRole('option')).toHaveText(['Desarrollo','Crear «Des»En esta obra']);
    await page.keyboard.press('Escape');await b.locator('.dia-ink').blur();
    const free=today.locator('.dia-new .dia-ink');await free.fill('@Oct');
    await expect(page.locator('.dia-section-picker')).toHaveCount(0);
    expect(await page.evaluate(()=>db.passageTracker.passages.filter(x=>x.id==='p1').length)).toBe(1);
  });
  test('compact headers, full details and lists stay within the page in focus mode',async({page})=>{
    await boot(page,width>1200);
    await page.locator('[data-act="focus"]').first().click();
    const item=page.locator('[data-day="'+day()+'"] [data-work="w1"]');
    await expect(item.locator('.dia-title')).toHaveText('Composer · Sonata para piano');
    await expect(item.locator('.dia-time')).toHaveText('09:00');
    await item.locator('summary').click();
    await expect(item.locator('.dia-study-details')).toContainText('Op. 123');
    await expect(item.locator('.dia-study-details')).toContainText('09:00–09:40');
    const box=await item.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
    await item.locator('[data-act="section"]').click();await item.locator('.dia-ink').fill('@Arp');
    await expect(item.getByRole('option')).toHaveText('Crear «Arp»En esta obra');
  });
});

test('a long update warning stays readable above navigation and a reduced visual viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await boot(page);
  await page.evaluate(()=>{
    document.querySelectorAll('.modal-overlay.visible').forEach(x=>closeModal(x.id));
    window.GermanStudy={hasActiveSession:()=>true};
  });
  expect(await page.evaluate(()=>UpdateSafety.safeUpdate())).toBe(false);
  const banner=page.locator('#swUpdateBanner'),msg=page.locator('#swUpdateMsg');
  await expect(msg).toContainText('Termina la sesión');
  const geometry=()=>banner.evaluate(b=>{
    const r=b.getBoundingClientRect(),m=b.querySelector('#swUpdateMsg'),q=m.getBoundingClientRect();
    return {x:r.x,right:r.right,bottom:r.bottom,top:r.top,msgRight:q.right,clipped:m.scrollHeight>m.clientHeight+1,covered:document.elementFromPoint(r.x+8,r.y+8)?.closest('#swUpdateBanner')===b};
  });
  let g=await geometry();expect(g.x).toBeGreaterThanOrEqual(0);expect(g.right).toBeLessThanOrEqual(390);expect(g.bottom).toBeLessThanOrEqual(844);expect(g.clipped).toBe(false);expect(g.covered).toBe(true);
  await page.evaluate(()=>{
    Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:420,offsetTop:0}});
    window.dispatchEvent(new Event('resize'));
  });
  g=await geometry();expect(g.bottom).toBeLessThanOrEqual(421);expect(g.top).toBeGreaterThanOrEqual(0);expect(g.clipped).toBe(false);
});
