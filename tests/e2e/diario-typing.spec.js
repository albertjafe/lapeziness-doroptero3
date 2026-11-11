import {test,expect} from '@playwright/test';
async function boot(page){
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(()=>{
    if(localStorage.getItem('alberto_piano_v2'))return;
    const now=new Date(),day=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
    localStorage.setItem('alberto_piano_v2',JSON.stringify({competitionPlanningSeedVersion:999,eventos:[],registro:[],sesiones:[],forestPlants:[],obras:[{id:'w',name:'Sonata',composer:'Example'}],
      sessionPlants:[{id:'a',obraId:'w',mins:40,startedAt:day+'T09:00:00',endedAt:day+'T09:40:00',source:'app'}],
      passageTracker:{passages:Array.from({length:800},(_,i)=>({id:'p'+i,obraId:'w',name:'Pasaje '+i})),observations:[]},
      dailyJournalEntries:[{id:'note',day,ref:'p:a',text:'[[Pasaje 1]]\n'+('Una línea de estudio.\n'.repeat(35))+'Final'}]}));
  });
  await page.goto('/');await expect(page.locator('#splashScreen')).toHaveClass(/gone/);await page.waitForFunction(()=>window.Diario&&window.DiarioSections);
  await page.evaluate(()=>{document.querySelectorAll('.modal-overlay.visible').forEach(x=>closeModal(x.id));showView('diario');saveData();});
  await page.waitForTimeout(100);
  await page.locator('.dia-item .dia-fmt').click();
  return page.locator('.dia-item .dia-ink');
}
test.use({viewport:{width:390,height:700},reducedMotion:'reduce'});
test('native sizing avoids measurement copies; older browsers still grow and shrink',async({page})=>{
  const area=await boot(page);
  expect(await page.evaluate(()=>CSS.supports('field-sizing','content'))).toBe(true);
  await expect(page.locator('.dia-size-probe')).toHaveCount(0);
  await area.fill('Una línea\n'.repeat(100));
  const tall=await area.evaluate(e=>e.clientHeight);
  await area.fill('Breve');
  await expect.poll(()=>area.evaluate(e=>e.clientHeight)).toBeLessThan(tall/2);
  await page.addInitScript(()=>{
    const supports=CSS.supports.bind(CSS);
    CSS.supports=(...args)=>args[0]==='field-sizing'?false:supports(...args);
  });
  await page.reload();await expect(page.locator('#splashScreen')).toHaveClass(/gone/);await page.evaluate(()=>showView('diario'));
  await page.locator('.dia-item .dia-fmt').click();
  await area.fill('Otra línea\n'.repeat(100));
  await expect.poll(()=>area.evaluate(e=>e.clientHeight)).toBeGreaterThan(2000);
  await expect(page.locator('.dia-size-probe')).toHaveCount(1);
  await area.fill('Breve');
  await expect.poll(()=>area.evaluate(e=>e.clientHeight)).toBeLessThan(100);
});
test('prose keeps section references and autosaves without recalculating study or collapsing the editor',async({page})=>{
  const area=await boot(page);
  await page.evaluate(()=>{
    window.typingProbe={catalogs:0,refreshes:0,collapses:0,version:_studyDataVersion};
    const catalog=DiarioSections.catalog;DiarioSections.catalog=(...args)=>{typingProbe.catalogs++;return catalog(...args);};
    const refresh=refreshStudyViews;refreshStudyViews=(...args)=>{typingProbe.refreshes++;return refresh(...args);};
    const descriptor=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,'height'),style=document.querySelector('.dia-item .dia-ink').style;
    Object.defineProperty(style,'height',{configurable:true,get(){return descriptor.get.call(this);},set(v){if(v==='auto')typingProbe.collapses++;descriptor.set.call(this,v);}});
  });
  await area.press('End');await area.pressSequentially(' El gesto resulta más ligero.',{delay:12});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem(DB_KEY)).dailyJournalEntries.find(x=>x.id==='note').text)).toContain('El gesto resulta más ligero.');
  const result=await page.evaluate(()=>({ ...typingProbe,stable:_studyDataVersion===typingProbe.version,refs:db.dailyJournalEntries.find(x=>x.id==='note').sectionRefs.map(x=>x.id)}));
  expect(result.catalogs).toBeLessThanOrEqual(1);expect(result.refreshes).toBe(0);expect(result.collapses).toBe(0);expect(result.stable).toBe(true);expect(result.refs).toEqual(['p1']);
  // A real study mutation must still invalidate the same projection.
  expect(await page.evaluate(()=>{const v=_studyDataVersion;db.sessionPlants[0].mins=45;saveData();return _studyDataVersion>v;})).toBe(true);
});
test('long notes stay sized while typing, shrink after deletion and survive an immediate page hide',async({page})=>{
  const area=await boot(page);const before=await area.boundingBox();
  await area.press('End');await area.pressSequentially(' abc');
  await expect.poll(()=>area.evaluate(e=>e.getBoundingClientRect().height)).toBe(before.height);
  await area.fill('palabra '.repeat(300));
  await page.setViewportSize({width:320,height:700});
  await expect.poll(()=>area.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
  await area.fill('Texto corto guardado');
  await expect.poll(()=>area.evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(before.height/2);
  await page.evaluate(async()=>{window.dispatchEvent(new PageTransitionEvent('pagehide'));await LocalSaveResilience.flush();});
  await page.reload();await expect(page.locator('#splashScreen')).toHaveClass(/gone/);await page.waitForFunction(()=>window.Diario);await page.evaluate(()=>showView('diario'));
  await expect(page.locator('.dia-item .dia-fmt')).toHaveText('Texto corto guardado');
  expect(await page.evaluate(()=>db.dailyJournalEntries.find(x=>x.id==='note').sectionRefs)).toEqual([]);
});
test('composition saves text without opening suggestions until the composed input is committed',async({page})=>{
  const area=await boot(page);
  await area.evaluate(e=>{e.value='@Pasaje';e.setSelectionRange(e.value.length,e.value.length);e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  await expect(page.locator('.dia-section-picker')).toHaveCount(0);
  expect(await page.evaluate(()=>db.dailyJournalEntries.find(x=>x.id==='note').text)).toBe('@Pasaje');
  await area.dispatchEvent('input',{isComposing:false});await expect(page.locator('.dia-section-picker')).toBeVisible();
  await page.keyboard.press('Escape');await area.fill('[[Pasaje 2]]\nNueva referencia');await area.blur();
  expect(await page.evaluate(()=>db.dailyJournalEntries.find(x=>x.id==='note').sectionRefs.map(x=>x.id))).toEqual(['p2']);
  await page.locator('.dia-item .dia-fmt').click();await area.fill('[[Pasaje nuevo]]\nSin coincidencia todavía');
  await page.evaluate(()=>flushSaveDataSoon());
  await page.evaluate(()=>db.passageTracker.passages.push({id:'late',obraId:'w',name:'Pasaje nuevo'}));
  await area.blur();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem(DB_KEY)).dailyJournalEntries.find(x=>x.id==='note').sectionRefs.map(x=>x.id))).toEqual(['late']);
});
