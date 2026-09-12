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
