import { test, expect } from '@playwright/test';
const fixture={obras:[{id:'bach',name:'Partita n.º 2',composer:'J. S. Bach',tipo:'obra',sol:68,movimientos:[],paseHistory:[],solHistory:[{date:'2026-08-28T12:00:00Z',val:68,inputVal:74,samples:3,context:'sesion'}]}],eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[],estadoEventos:[],impulsoEventos:[],deporteEventos:[],suenoEventos:[],triggerEventos:[],tiempoDisponibleEventos:[],dailyJournalEntries:[]};
async function prepare(page,data=fixture){await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* offline */'}));await page.addInitScript(d=>localStorage.setItem('alberto_piano_v2',JSON.stringify(d)),data);await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForTimeout(500);}
test('uses previous manual rating and nonlinear physical scale',async({page})=>{await page.setViewportSize({width:1024,height:768});await prepare(page);const m=await page.evaluate(()=>({previous:paseTargetPreviousPct('bach',null),p30:pasePctToPosition(30),p40:pasePctToPosition(40),p50:pasePctToPosition(50),p80:pasePctToPosition(80),p90:pasePctToPosition(90)}));expect(m.previous).toBe(74);expect(m.p50).toBeGreaterThan(32);expect(m.p50).toBeLessThan(35);expect(m.p90-m.p80).toBeGreaterThan((m.p40-m.p30)*1.8);await page.evaluate(()=>registerPase('bach'));await expect(page.locator('#paseQMeter [data-pase-previous]')).toContainText('Anterior · 74% · Fiable');await expect(page.locator('#paseQMeter [data-pase-current]')).toContainText('74% · Fiable');await expect(page.locator('#paseQMeter')).toHaveAttribute('data-rating-profile','pase');await expect(page.locator('#paseQMeter .pase-liquid-guide')).toHaveCount(5);const ratio=await page.locator('#paseQMeter .pase-liquid-guide').nth(1).evaluate(guide=>{const parent=guide.parentElement.getBoundingClientRect();const item=guide.getBoundingClientRect();return((item.left+item.width/2)-parent.left)/parent.width;});expect(ratio).toBeGreaterThan(.19);expect(ratio).toBeLessThan(.23);const pos90=await page.evaluate(()=>pasePctToPosition(90).toFixed(2));await page.locator('#paseQPercent').fill(pos90);await expect(page.locator('#paseQMeter [data-pase-current]')).toContainText('90% · Pase de escena');});
test('does not use smoothed target.sol as previous manual rating',async({page})=>{const data=structuredClone(fixture);data.obras[0].solHistory=[];data.obras[0].paseHistory=[];data.obras[0].sol=68;await prepare(page,data);expect(await page.evaluate(()=>paseTargetPreviousPct('bach',null))).toBeNull();await page.evaluate(()=>registerPase('bach'));await expect(page.locator('#paseQMeter [data-pase-previous]')).toContainText('Primera valoración');await expect(page.locator('#paseQMeter [data-pase-current]')).toContainText('50% · Completo con tensión');});

test('uses repertoire language for recovered, learned, experienced or performed solo works',async({page})=>{
  const data=structuredClone(fixture);
  data.obras.push(
    {id:'recovered',name:'Rach 3',composer:'Rachmaninov',tipo:'obra',origen:'recuperacion',movimientos:[]},
    {id:'learned',name:'Sonata aprendida',composer:'X',tipo:'obra',apr:10,movimientos:[]},
    {id:'experienced',name:'Obra con horas',composer:'Y',tipo:'obra',movimientos:[]},
    {id:'performed',name:'Obra de concierto',composer:'Z',tipo:'obra',movimientos:[]},
  );
  data.sessionPlants=Array.from({length:8},(_,index)=>({id:'s'+index,obraId:'experienced',mins:80,startedAt:new Date(Date.now()-index*86400000).toISOString()}));
  data.eventos=[{id:'past',fecha:'2025-04-02',obras:['performed']}];
  await prepare(page,data);
  const profiles=await page.evaluate(()=>['recovered','learned','experienced','performed'].map(id=>paseWorkRatingProfile(findObra(id))));
  expect(profiles).toEqual(['repertorio','repertorio','repertorio','repertorio']);
  expect(await page.evaluate(()=>paseRatingStage(60,paseWorkRatingProfile(findObra('recovered'))))).toBe('En repertorio');
});
