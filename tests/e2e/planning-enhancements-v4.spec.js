import { test, expect } from '@playwright/test';

const base = {
  obras: [{ id:'obra_1', name:'Bach · Preludio', composer:'J. S. Bach', tipo:'obra', movimientos:[], sol:50, solHistory:[] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [], weeklyPlans: [], cronoTasks: [],
  competitionPlanningSeedVersion: 1,
};

async function prepare(page, options = {}) {
  if(options.ios){
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { configurable:true, get:() => 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable:true, get:() => 5 });
      window.__taskRecognitionInstances = [];
      window.SpeechRecognition = class {
        constructor(){ window.__taskRecognitionInstances.push(this); }
        start(){ this.started = true; }
        stop(){ this.stopped = true; this.onend?.(); }
        abort(){ this.aborted = true; this.onend?.(); }
      };
    });
  }
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status:200, contentType:'application/javascript', body:'/* Supabase bloqueado en e2e */'
  }));
  await page.addInitScript(seed => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(seed));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision:0, dirtyRevision:0, lastSyncedRevision:0 }));
  }, options.data || base);
  await page.goto('/', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1600);
  await expect.poll(() => page.evaluate(() => Boolean(window.PlanningEnhancementsV4))).toBe(true);
}

test('priority parser accepts masculine/feminine and strips spoken control words', async ({ page }) => {
  await prepare(page);
  const parsed = await page.evaluate(() => [
    PlanningEnhancementsV4.parseTaskText('Revisar la coda urgentísimo'),
    PlanningEnhancementsV4.parseTaskText('Arreglar digitación urgentísima'),
    PlanningEnhancementsV4.parseTaskText('Mandar correo urgente'),
    PlanningEnhancementsV4.parseTaskText('Escalas normal'),
    PlanningEnhancementsV4.parseTaskText('Tocar lento'),
  ]);
  expect(parsed.map(item => item.priority)).toEqual([3,3,2,1,0]);
  expect(parsed.map(item => item.text)).toEqual(['Revisar la coda','Arreglar digitación','Mandar correo','Escalas','Tocar lento']);
});

test('inline dictated task stores clean text and maximum priority', async ({ page }) => {
  await page.setViewportSize({ width:430, height:932 });
  await prepare(page);
  await page.evaluate(() => showView('cronometro'));
  const panel = page.locator('#cronoIdleTasksPanel');
  await panel.getByRole('button', { name:'Añadir tarea de Personal' }).click();
  const input = panel.locator('#cronoIdleTaskInput');
  await input.fill('Revisar coda urgentísimo');
  await panel.locator('.crono-task-add-btn').click();
  await expect.poll(() => page.evaluate(() => cronoTasks().at(-1)?.priority)).toBe(3);
  expect(await page.evaluate(() => cronoTasks().at(-1)?.text)).toBe('Revisar coda');
});

test('readiness guide scores own part first and adds ensemble evidence at the end', async ({ page }) => {
  await prepare(page);
  const guide = page.locator('#solidityGuideQuickV3');
  await expect(guide).toContainText('Cámara · tu parte primero');
  await expect(guide).toContainText('Durante el estudio solo, puntúa tu propia parte');
  await expect(guide).toContainText('Concierto con orquesta');
  await expect(guide).toContainText('especialmente importante para 90+');
  await expect(guide).toContainText('Repertorio recuperado');
  await expect(guide).toContainText('cómo está hoy');
});

test('personal projects are isolated in their own events section with month target', async ({ page }) => {
  const data = structuredClone(base);
  data.eventos = [{
    id:'project_oct', nombre:'Terminar nueva composición', tipo:'proyecto', estado:'planificado',
    fecha:'2026-10-31', fechaFlexibleTipo:'mes', fechaObjetivoMes:'2026-10',
    fechaFlexibleDesde:'2026-10-01', fechaFlexibleHasta:'2026-10-31', fechaFlexibleLabel:'Octubre de 2026', obras:[]
  }];
  await prepare(page, { data });
  await page.evaluate(() => {
    showView('calendario');
    switchCalTab('eventos', document.getElementById('calTabEventos'));
    PlanningEnhancementsV4.refreshUi();
  });
  const section = page.locator('#personalProjectsSection');
  await expect(section).toBeVisible();
  await expect(section).toContainText('Proyectos personales');
  await expect(section).toContainText('Terminar nueva composición');
  await expect(section).toContainText('Objetivo flexible · Octubre de 2026');
  await expect(page.locator('#eventosList .evento-card.project-original-hidden')).toHaveCount(1);
});

test('iPad auto-starts task dictation and writes the transcript again', async ({ page }) => {
  await page.setViewportSize({ width:834, height:1194 });
  await prepare(page, { ios:true });
  await expect.poll(() => page.evaluate(() => Boolean(window.PlanningV4SpeechFix?.restored))).toBe(true);
  await page.evaluate(() => showView('cronometro'));
  const panel = page.locator('#cronoIdleTasksPanel');
  await panel.getByRole('button', { name:'Añadir tarea de Personal' }).click();
  const input = panel.locator('#cronoIdleTaskInput');
  await expect(input).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__taskRecognitionInstances.some(instance => instance.started))).toBe(true);
  await expect(page.locator('html')).not.toHaveClass(/planning-ios-keyboard-dictation/);
  await expect(panel.locator('[id^="cronoTaskVoiceBtn"]')).toBeVisible();
  await page.evaluate(() => {
    const active = window.__taskRecognitionInstances.find(instance => instance.started && !instance.stopped);
    active?.onresult?.({ results: [[{ transcript:'Recordar la postura urgentísima' }]] });
  });
  await expect(input).toHaveValue('Recordar la postura urgentísima');
});

test('slow pill drag keeps the last stable position after release', async ({ page }) => {
  await page.setViewportSize({ width:1024, height:768 });
  await prepare(page);
  await page.evaluate(() => registerPase('obra_1'));
  const reservoir = page.locator('#paseQMeter .pase-liquid-reservoir');
  const box = await reservoir.boundingBox();
  expect(box).toBeTruthy();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * .2, y);
  await page.mouse.down();
  for(const ratio of [.27,.35,.43,.51,.59,.67,.73]){
    await page.mouse.move(box.x + box.width * ratio, y, { steps:3 });
    await page.waitForTimeout(18);
  }
  const before = await page.locator('#paseQPercent').inputValue();
  await page.mouse.up();
  await page.waitForTimeout(240);
  const after = await page.locator('#paseQPercent').inputValue();
  expect(Number(before)).toBeGreaterThan(50);
  expect(after).toBe(before);
});
