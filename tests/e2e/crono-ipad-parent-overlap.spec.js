import { test, expect } from '@playwright/test';
const fixture = {
  obras: [{ id:'bach', name:'Bach', composer:'Bach', tipo:'obra', sol:50, compasesTotal:100, compasActual:100, movimientos:[] }],
  eventos:[], sesiones:[], registro:[], sessionPlants:[], forestPlants:[], estadoEventos:[], impulsoEventos:[], deporteEventos:[], suenoEventos:[], triggerEventos:[], tiempoDisponibleEventos:[], dailyJournalEntries:[],
};
for (const viewport of [{width:1194,height:834},{width:1366,height:1024}]) {
  test(`idle landscape parent geometry ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({status:200, contentType:'application/javascript', body:'/* offline */'}));
    await page.addInitScript(data => localStorage.setItem('alberto_piano_v2', JSON.stringify(data)), fixture);
    await page.goto('/', {waitUntil:'domcontentloaded'});
    await page.waitForTimeout(600);
    await page.evaluate(() => showView('cronometro'));
    const g = await page.evaluate(() => {
      const box = sel => { const r=document.querySelector(sel).getBoundingClientRect(); return {x:r.x,y:r.y,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
      const overlap=(a,b)=>a.x<b.right&&a.right>b.x&&a.top<b.bottom&&a.bottom>b.top;
      const main=box('.crono-idle-main'), drawer=box('#cronoIdleDrawer'), mode=box('#cronoModeToggle'), start=box('#cronoStartBtn'), ring=box('#cronoIdleDisplayWrap'), view=box('#view-cronometro');
      return {main,drawer,mode,start,ring,view,modeDrawer:overlap(mode,drawer),startDrawer:overlap(start,drawer),columns:getComputedStyle(document.querySelector('#cronoModeToggle')).gridTemplateColumns.split(' ').filter(Boolean).length};
    });
    expect(g.modeDrawer).toBe(false);
    expect(g.startDrawer).toBe(false);
    expect(g.mode.bottom).toBeLessThanOrEqual(g.main.bottom + 1);
    expect(g.start.bottom).toBeLessThanOrEqual(g.main.bottom + 1);
    expect(g.drawer.top).toBeGreaterThanOrEqual(g.main.bottom + 8);
    expect(g.drawer.bottom).toBeLessThanOrEqual(g.view.bottom + 1);
    expect(g.columns).toBe(2);
    expect(g.ring.width).toBeGreaterThanOrEqual(270);
    expect(g.main.height).toBeGreaterThanOrEqual(490);
  });
}
