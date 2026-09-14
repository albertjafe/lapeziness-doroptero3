import {test,expect} from '@playwright/test';

test('piano taximeter remains legible inside the running clock',async({page},testInfo)=>{
  await page.setViewportSize({width:1024,height:1194});
  await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* isolated */'}));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'platform',{configurable:true,get:()=> 'MacIntel'});
    localStorage.setItem('alberto_piano_v2',JSON.stringify({
      obras:[{id:'rach',name:'Concierto n.º 3',composer:'Rachmaninov',movimientos:[],sol:72,solHistory:[]}],
      eventos:[],sesiones:[],registro:[],sessionPlants:[],forestPlants:[],
      germanStudy:{version:1,materials:[],reviews:[],sessions:[],ledger:[],goals:[{id:'ebook',name:'E-book',amount:150,createdAt:'2026-09-01T10:00:00Z'}]}
    }));
  });
  await page.goto('/');
  await page.waitForFunction(()=>window.PianoRewards&&window.crono);
  await expect(page.locator('#splashScreen')).toBeHidden();
  await page.evaluate(()=>{
    showView('cronometro');
    crono.state='running';crono.mode='stopwatch';crono.runId='visual-run';crono.isRest=false;
    crono.obraId='rach';crono.displayName='Concierto n.º 3';crono.subName='Rachmaninov';crono.rewardGoalId='ebook';
    crono.startTs=Date.now()-(5*60+15)*60000;
    cronoRender();
  });
  await expect(page.locator('#cronoPianoMoney')).toBeVisible();
  await expect(page.locator('#cronoPianoMoneyValue')).not.toHaveText('0,000000 €');
  await page.screenshot({path:testInfo.outputPath('piano-taximeter.png'),fullPage:true});
});
