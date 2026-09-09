import {test,expect} from '@playwright/test';

for(const size of [{width:1194,height:834},{width:834,height:1194},{width:390,height:844}])test(`timer tools and clean Hecho ${size.width}x${size.height}`,async({page})=>{
  await page.setViewportSize(size);
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* local fixture */'}));
  await page.addInitScript(()=>{
    localStorage.setItem('alberto_piano_v2',JSON.stringify({obras:[{id:'w',name:'Waldstein',movimientos:[{id:'iii',name:'III. Rondo',sol:60,solHistory:[]}]}],eventos:[],sesiones:[],sessionPlants:[],forestPlants:[],registro:[],cronoTasks:[{id:'personal',kind:'personal',text:'Preparar ensayo',done:false},{id:'piano',kind:'piano',text:'Tarea antigua de piano',done:false}],passageTracker:{version:1,passages:[{id:'p',obraId:'w',movId:'iii',name:'Octavas de la coda',difficulty:8}],observations:[]}}));
  });
  await page.goto('/');
  await page.waitForFunction(()=>window.PassageTrackerResilience&&window.ProfessorHandoffResilience);
  await page.evaluate(()=>{showView('cronometro');document.getElementById('cronoObraSelect').value='mov::w::iii';cronoUpdateStartBtn();PassageTracker.render();});
  await expect(page.locator('#cronoTargetSolidity')).toBeVisible();
  const idle=page.locator('#cronoIdleDrawer');
  await expect(idle.getByRole('button',{name:'Profesor'})).toBeVisible();
  await expect(idle.locator('[data-tab="memoria"]')).toHaveCount(0);
  await expect(idle.locator('.crono-task-lane.piano')).toHaveCount(0);
  await expect(idle).toContainText('Preparar ensayo');
  await idle.getByRole('tab',{name:'Pasajes',exact:true}).click();
  await expect(idle.locator('#cronoPassageTracker')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('idle.png')});
  await page.evaluate(()=>{crono.mode='stopwatch';cronoStart();crono.startTs=Date.now()-36*60000;crono.quickDestelloNote='Destello desde el botón';cronoSaveState();});
  await page.locator('#cronoTargetSoliditySlider').evaluate(slider=>{
    slider.value=pasePctToPosition(67).toFixed(2);
    slider.dispatchEvent(new Event('input',{bubbles:true}));
    commitCronoSolidityPending('test');
  });
  await expect.poll(()=>page.evaluate(()=>db.obras[0].movimientos[0].solHistory?.map(item=>item.inputVal)||[])).toEqual([67]);
  const run=page.locator('#cronoRunDrawer');
  await run.getByRole('tab',{name:'Pasajes',exact:true}).click();
  await expect(run.locator('#cronoPassageTracker')).toBeVisible();
  await run.locator('.passage-inline-meter .pase-liquid-input').evaluate(slider=>{
    slider.value=pasePctToPosition(72).toFixed(2);
    slider.dispatchEvent(new Event('input',{bubbles:true}));
    PassageTracker.flushPendingScores('test');
  });
  await expect(run.locator('.crono-passage-inline-score')).toContainText('72');
  await page.screenshot({path:test.info().outputPath('rating-inline.png')});
  await expect(page.locator('.crono-tomorrow-note-btn')).toHaveCount(0);
  await expect(page.locator('#cronoStageRun .crono-quick-destello-btn')).toHaveCount(1);
  await run.getByRole('button',{name:'Profesor'}).click();
  await expect(page.locator('#view-profesor')).toBeVisible();
  expect(await page.evaluate(()=>crono.state)).toBe('running');
  await page.evaluate(()=>showView('cronometro'));
  await run.getByRole('tab',{name:'Pasajes',exact:true}).click();
  await page.screenshot({path:test.info().outputPath('running.png')});
  const panel=await run.locator('#cronoPassageTracker').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(size.width+1);
  await page.evaluate(()=>cronoStop());
  await page.locator('#modalCronoConfirmFinish').getByRole('button',{name:'Hecho',exact:true}).click();
  await expect(page.locator('#modalHechoDatos')).toBeVisible();
  await expect(page.locator('#hechoAdvancedToggle')).toHaveCount(0);
  await expect(page.locator('#hechoDestelloChk')).toHaveCount(0);
  await expect(page.locator('#hechoMinutos')).toBeVisible();
  await expect(page.locator('#hechoPassOccurredSection')).toBeVisible();
  await page.locator('#hechoPassOccurredSection').getByRole('button',{name:'Sí'}).click();
  await page.screenshot({path:test.info().outputPath('hecho.png')});
  await page.locator('#modalHechoDatos').getByRole('button',{name:'Hecho',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.stringify(db.sesiones))).toContain('Destello desde el botón');
  await expect.poll(()=>page.evaluate(()=>db.obras[0].movimientos[0].paseHistory?.length||0)).toBe(1);
  expect(await page.evaluate(()=>({
    scores:db.obras[0].movimientos[0].solHistory.map(item=>item.inputVal),
    context:db.obras[0].movimientos[0].solHistory[0].context,
    passScore:db.obras[0].movimientos[0].paseHistory[0].solidezPct,
  }))).toEqual({scores:[67],context:'observacion-libre',passScore:67});
  expect(await page.evaluate(()=>db.cronoTasks.some(t=>t.id==='piano'))).toBe(true);
});
