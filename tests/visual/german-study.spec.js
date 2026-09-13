import {test,expect} from '@playwright/test';

test('Deutsch dashboard and study remain readable on desktop and mobile',async({page},testInfo)=>{
  test.setTimeout(60000);
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* isolated visual fixture */'}));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});
    Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36'});
    Object.defineProperty(navigator,'userAgentData',{configurable:true,get:()=>({platform:'macOS'})});
    localStorage.setItem('alberto_piano_v2',JSON.stringify({obras:[{id:'piano',name:'Bach',movimientos:[]}],eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[]}));
  });
  await page.goto('/');await page.waitForFunction(()=>window.GermanStudy);
  await page.evaluate(async()=>{
    const st=GermanSession.ensure(db),pack=await GermanImport.parse(JSON.stringify(GermanImport.EXAMPLE));
    GermanImport.insert(st,pack);
    st.goals.push({id:'kindle',name:'Kindle',amount:149.99,createdAt:'2026-08-01T10:00:00Z'});
    const today=GermanRewards.dayKey();
    for(let i=1;i<=9;i++) {const day=GermanRewards.shiftDay(today,-i);st.sessions.push({id:'day'+i,goalId:'kindle',startedAt:day+'T10:00:00Z',endedAt:day+'T10:30:00Z',segments:[{id:day,day,seconds:1800}]});}
    saveData();showView('deutsch');
  });
  for(const [name,width,height] of [['desktop',1280,1000],['mobile',390,844]]) {
    await page.setViewportSize({width,height});
    await expect(page.locator('.german-goal')).toContainText('Kindle');
    expect(await page.locator('#view-deutsch').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('deutsch-dashboard-'+name+'.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'Empezar estudio',exact:true}).click();
  for(const [name,width,height] of [['mobile',390,844],['desktop',1280,1000]]) {
    await page.setViewportSize({width,height});
    await expect(page.locator('#germanMoney')).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('deutsch-study-'+name+'.png'),fullPage:true});
  }
});

test('trophy room presents achieved and pending goals on desktop and mobile',async({page},testInfo)=>{
  test.setTimeout(60000);
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'/* isolated visual fixture */'}));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});
    Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36'});
    Object.defineProperty(navigator,'userAgentData',{configurable:true,get:()=>({platform:'macOS'})});
    localStorage.setItem('alberto_piano_v2',JSON.stringify({obras:[{id:'piano',name:'Bach',movimientos:[]}],eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[],germanStudy:{materials:[],reviews:[],ledger:[],goals:[
      {id:'book',name:'Mi primer libro en alemán',amount:.5,createdAt:'2026-08-20T10:00:00Z',archivedAt:'2026-08-23T10:00:00Z'},
      {id:'concert',name:'Una noche de concierto',amount:.5,createdAt:'2026-08-24T10:00:00Z',archivedAt:'2026-08-27T10:00:00Z'},
      {id:'trip',name:'Una escapada a Berlín',amount:50,createdAt:'2026-08-28T10:00:00Z'}
    ],sessions:[['a','book','2026-08-22'],['b','concert','2026-08-26'],['c','trip','2026-09-01']].map(([id,goalId,day])=>({id,goalId,startedAt:day+'T10:00:00Z',endedAt:day+'T11:00:00Z',segments:[{id:day,day,seconds:3600}]}))}}));
  });
  await page.goto('/');await page.waitForFunction(()=>window.GermanTrophies && window.GermanStudy);
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/);
  await page.getByRole('button',{name:'Abrir Deutsch',exact:true}).click();await page.getByRole('button',{name:'Trofeos',exact:true}).click();
  for(const [name,width,height] of [['desktop',1280,1000],['mobile',390,844]]) {
    await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
    await expect(page.locator('.german-trophy-card')).toHaveCount(3);
    expect(await page.locator('#view-deutsch').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('deutsch-trophies-'+name+'.png'),fullPage:true});
  }
});
