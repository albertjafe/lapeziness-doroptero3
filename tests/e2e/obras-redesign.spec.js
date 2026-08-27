import { test, expect } from '@playwright/test';

const fixture = {
  obras: [
    { id:'w1', name:'Sonata para piano n.º 21 «Waldstein», Op. 53', composer:'Beethoven', tipo:'obra', duracion:25, dificultad:8, sol:72, esc:64, learningStage:'consolidando', solHistory:[{val:72,date:'2026-08-26T12:00:00Z'}], paseHistory:[], movimientos:[{id:'m1',name:'I. Allegro con brio',duracion:11,sol:70,solHistory:[],paseHistory:[]}] },
    { id:'w2', name:'Étude n.º 7 «Galamb borong»', composer:'Ligeti', tipo:'obra', duracion:2, sol:66, esc:90, solHistory:[{val:66,date:'2026-08-16T12:00:00Z'}], paseHistory:[], movimientos:[] },
    { id:'a1', name:'Lectura', composer:'', tipo:'actividad', minutosExtra:30 },
  ],
  historicalRepertoire:[{id:'h1',name:'Sonata antigua',composer:'Mozart',fromYear:2017,toYear:2018,lastPlayedYear:2019,estimatedHours:40,peakLevel:'solida'}],
  eventos:[], sesiones:[], registro:[], sessionPlants:[], forestPlants:[], estadoEventos:[], impulsoEventos:[], malestarEventos:[], deporteEventos:[], suenoEventos:[], triggerEventos:[], tiempoDisponibleEventos:[], dailyJournalEntries:[],
};

test('uses the compact repertoire list and master-detail sheet on wide tablets', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status:200, contentType:'application/javascript', body:'/* offline test */' }));
  await page.addInitScript(data => {
    Object.defineProperty(navigator, 'platform', { configurable:true, get:() => 'MacIntel' });
    Object.defineProperty(navigator, 'userAgent', {
      configurable:true,
      get:() => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    });
    Object.defineProperty(navigator, 'userAgentData', { configurable:true, get:() => ({ platform:'macOS' }) });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable:true, get:() => 5 });
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision:0, dirtyRevision:0, lastSyncedRevision:0 }));
  }, fixture);
  await page.goto('/', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1400);
  await page.evaluate(() => showView('obras'));

  await expect(page.locator('#obrasRedesignHead')).toBeVisible();
  await expect(page.locator('.obras-rd-section.now')).toContainText('Ahora');
  await expect(page.locator('.obras-rd-section.history')).toContainText('Histórico');
  await expect(page.locator('[data-work-id="w1"]')).toBeVisible();
  await expect(page.locator('[data-work-id="w1"]')).toContainText('Sólida');
  await expect(page.locator('[data-work-id="w1"]')).not.toContainText('Consolidando');
  await expect(page.locator('#obrasRdDetail')).toBeVisible();
  await expect(page.locator('#obrasRdDetail')).toContainText('Waldstein');

  await page.locator('#obrasRdDetail [data-detail-action="edit"]').click();
  await expect(page.locator('#obrasRdDetail [data-edit-field="name"]')).toHaveValue(/Waldstein/);
  await expect(page.locator('#obrasRdDetail [data-mov-field="duration"]')).toHaveValue('11');
  await page.locator('#obrasRdDetail [data-detail-action="cancel"]').click();

  await page.locator('#obrasRdMenuBtn').click();
  await expect(page.locator('#obrasRdMenu [data-menu="legacy"]')).toHaveCount(0);
});