import {test,expect} from '@playwright/test';

async function boot(page) {
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(()=>{
    if(localStorage.getItem('alberto_piano_v2'))return;
    const d=new Date(),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    localStorage.setItem('alberto_piano_v2',JSON.stringify({competitionPlanningSeedVersion:999,eventos:[],registro:[],sesiones:[],forestPlants:[],
      obras:[{id:'w',name:'Cuarteto',composer:'Mozart',movimientos:[{id:'one',name:'I. Allegro'},{id:'two',name:'II. Adagio'}]}],
      sessionPlants:[{id:'a',obraId:'w',movId:'one',mins:30,startedAt:day+'T09:00:00',endedAt:day+'T09:30:00',source:'app'},
        {id:'b',obraId:'w',movId:'two',mins:30,startedAt:day+'T09:35:00',endedAt:day+'T10:05:00',source:'app'}],
      passageTracker:{passages:[{id:'p1',obraId:'w',movId:'one',name:'Exposición'},{id:'p2',obraId:'w',movId:'two',name:'Coda'}]},
      dailyJournalEntries:[{id:'old',day,ref:'p:a',about:'Mozart · Cuarteto · I, II · 09:00–10:05',text:'Nota de ambos movimientos',future:7}]}));
  });
  await page.goto('/');await expect(page.locator('#splashScreen')).toHaveClass(/gone/);
  await page.evaluate(()=>{document.querySelectorAll('.modal-overlay.visible').forEach(x=>closeModal(x.id));showView('diario');});
}
const current=page=>page.locator('#view-diario .dia-page[data-day]').last().getAttribute('data-day');
const offset=(key,n)=>{const d=new Date(key+'T12:00:00');d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const wheel=(page,deltaX,deltaY=0,extra={})=>page.locator('#view-diario').evaluate((el,p)=>{
  const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,...p});el.dispatchEvent(e);return e.defaultPrevented;
},{deltaX,deltaY,...extra});

test.use({reducedMotion:'reduce'});
test('movement headings and sections stay independent and retain historical notes after reload',async({page})=>{
  await page.setViewportSize({width:1000,height:800});await boot(page);
  const items=page.locator('.dia-item');
  await expect(items.locator('.dia-title')).toHaveText(['Mozart · Cuarteto · I','Mozart · Cuarteto · II']);
  await expect(items.first().locator('.dia-fmt')).toHaveText('Nota de ambos movimientos');
  await items.nth(1).locator('[data-act="section"]').click();
  await expect(page.locator('.dia-section-picker')).toContainText('Coda');
  await expect(page.locator('.dia-section-picker')).not.toContainText('Exposición');
  const area=items.nth(1).locator('.dia-ink');
  await area.fill('@Exposición');await page.locator('.dia-section-choice').click();
  await area.pressSequentially('Más ligero');await area.blur();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem(DB_KEY)).dailyJournalEntries.some(e=>e.movId==='two'&&e.sectionRefs?.[0]?.movId==='two'))).toBe(true);
  expect(await page.evaluate(()=>db.passageTracker.passages.length)).toBe(2);
  await page.reload();await expect(page.locator('#splashScreen')).toHaveClass(/gone/);await page.evaluate(()=>showView('diario'));
  await expect(items.nth(1).locator('.dia-fmt')).toContainText('Más ligero');
  expect(await page.evaluate(()=>db.dailyJournalEntries.find(e=>e.id==='old'))).toMatchObject({text:'Nota de ambos movimientos',about:'Mozart · Cuarteto · I, II · 09:00–10:05',future:7});
});

for(const width of [1000,1366])test(`trackpad at ${width}px: axis lock, distance, boundaries and unsaved text`,async({page})=>{
  await page.setViewportSize({width,height:800});await boot(page);
  const today=await current(page),step=width>=1200?2:1;
  const distance=await page.locator('#view-diario').evaluate(el=>Math.max(120,Math.min(280,el.clientWidth*.24)));
  // Vertical scrolling and its diagonal tail must not turn pages.
  expect(await wheel(page,4,100)).toBe(false);
  expect(await wheel(page,-distance*2,10)).toBe(false);
  expect(await current(page)).toBe(today);
  await page.waitForTimeout(250);
  expect(await wheel(page,-distance*2,0,{ctrlKey:true})).toBe(false);
  expect(await current(page)).toBe(today);
  await page.locator('.dia-item .dia-fmt').first().click();
  await page.locator('.dia-item .dia-ink').first().fill('Escrito antes de pasar');
  // Small movement does not turn; accumulated distance can cross several leaves.
  expect(await wheel(page,-distance*.4)).toBe(true);
  expect(await current(page)).toBe(today);
  await wheel(page,-distance*2.8);
  await expect.poll(()=>current(page)).toBe(offset(today,-3*step));
  await page.waitForTimeout(250);await wheel(page,distance*10);
  await expect.poll(()=>current(page)).toBe(today);
  await expect(page.locator('.dia-item .dia-fmt').first()).toHaveText('Escrito antes de pasar');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem(DB_KEY)).dailyJournalEntries.find(e=>e.id==='old').text)).toBe('Escrito antes de pasar');
  await page.waitForTimeout(250);
  await page.locator('.dia-item .dia-fmt').first().click();
  const area=page.locator('.dia-item .dia-ink').first();
  await area.dispatchEvent('compositionstart');await wheel(page,-distance*2);
  expect(await current(page)).toBe(today);await area.dispatchEvent('compositionend');
});
