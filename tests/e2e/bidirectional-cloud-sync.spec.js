import {test,expect} from '@playwright/test';
import Doc from '../../document-sync-core.js';

test('independent iPad and phone exchange study, goal edits and offline additions',async({browser})=>{
  test.setTimeout(90000);
  const initial={obras:[],sessionPlants:[],forestPlants:[],sesiones:[],eventos:[],registro:[],germanStudy:{version:1,materials:[],reviews:[],sessions:[],ledger:[],goals:[{id:'kindle',name:'Kindle',amount:200,createdAt:'2026-09-18T00:00:00Z'}]}};
  let row={id:'u',data:structuredClone(initial),updated_at:'v1'},version=1,offlinePhone=false;
  const contexts=[];
  async function device(phone){
    const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:phone?{width:390,height:844}:{width:1194,height:834},timezoneId:'Europe/Berlin',serviceWorkers:'block'});contexts.push(context);
    await context.route('**/supabase-sdk-v2-116-0.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* SDK transport isolated by this suite */'}));
    await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* isolated transport */'}));
    await context.route('https://cloud-sync.test/**',async route=>{
      if(phone&&offlinePhone)return route.abort('internetdisconnected');
      const {op,value,expected,selection}=route.request().postDataJSON();
      let result;
      if(op==='read')result={data:selection==='updated_at'?{updated_at:row.updated_at}:structuredClone(row)};
      else if(op==='update'&&expected!==row.updated_at)result={data:null};
      else {row={...structuredClone(value),data:Doc.mergeRemote(row.data,value.data),updated_at:'v'+(++version)};result={data:structuredClone(row)};}
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await context.addInitScript(initial=>{
      if(!localStorage.getItem('alberto_piano_v2'))localStorage.setItem('alberto_piano_v2',JSON.stringify(initial));
      const sb={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}}),getUser:async()=>({data:{user:{id:'u'}}}),onAuthStateChange:()=>({data:{subscription:{}}})},
        from:table=>{
          let op='read',value,expected,selection;
          const execute=async()=>table!=='user_data'?{data:[]}:
            (await fetch('https://cloud-sync.test/document',{method:'POST',body:JSON.stringify({op,value,expected,selection})})).json();
          const q={select:v=>{selection=v;return q;},eq:(k,v)=>{if(k==='updated_at')expected=v;return q;},order:()=>q,limit:()=>q,in:()=>q,lte:()=>q,
            update:v=>{op='update';value=v;return q;},insert:v=>{op='insert';value=v;return q;},maybeSingle:execute,single:execute,then:(a,b)=>execute().then(a,b)};return q;
        },rpc:async()=>({data:[]})};window.supabase={createClient:()=>sb};
    },initial);
    const page=await context.newPage();await page.clock.install({time:new Date('2026-09-18T17:00:00Z')});await page.goto('/');
    await page.waitForFunction(()=>window.InstantSyncResilience?.isInstalled()&&window.LocalSaveResilience&&_cloudSyncConnected===true);
    await page.evaluate(()=>requestCloudRefresh());return page;
  }
  async function study(page,id,mins){
    await page.evaluate(async({id,mins})=>{
      const from=new Date('2026-09-18T06:00:00Z').getTime()+db.sessionPlants.reduce((sum,p)=>sum+Number(p.mins||0),0)*60000;
      db.sessionPlants.push({id,runId:id,mins,startedAt:new Date(from).toISOString(),endedAt:new Date(from+mins*60000).toISOString()});
      saveData();await LocalSaveResilience.flush();await syncPendingCloudChanges();
    },{id,mins});
  }
  const minutes=page=>page.evaluate(()=>DailyStudyMinutes.todayMinutes());
  const resume=async page=>{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>page.evaluate(()=>SyncCore.isDirty(_readSyncMeta()))).toBe(false);};
  try{
    const ipad=await device(false);await study(ipad,'ipad-six',360);
    const phone=await device(true);expect(await minutes(phone)).toBe(360);
    await study(phone,'phone-two',120);await resume(ipad);await expect.poll(()=>minutes(ipad)).toBe(480);
    await phone.evaluate(()=>showView('deutsch'));
    await expect(phone.locator('#germanSharedGoal h3')).toHaveText('Kindle');
    await ipad.evaluate(async()=>{db.germanStudy.goals[0].name='Kindle actualizado';saveData();await syncPendingCloudChanges();});
    await resume(phone);await expect.poll(()=>phone.evaluate(()=>db.germanStudy.goals[0].name)).toBe('Kindle actualizado');
    await expect(phone.locator('#germanSharedGoal h3')).toHaveText('Kindle actualizado');
    await phone.waitForFunction(()=>window.GermanSession);
    await phone.evaluate(async()=>{
      const state=GermanSession.ensure(db),from=new Date('2026-09-18T15:00:00Z').getTime();
      const session=GermanSession.create({id:'phone-german',deviceId:'phone',now:from});
      GermanSession.addInterval(session,from,from+30*60000);state.sessions.push(session);GermanSession.finish(state,session.id,from+30*60000);
      saveData();await syncPendingCloudChanges();
    });
    await resume(ipad);await expect.poll(()=>ipad.evaluate(()=>db.germanStudy?.sessions.find(s=>s.id==='phone-german')?.segments[0]?.seconds)).toBe(1800);
    expect(await minutes(ipad)).toBe(480);
    offlinePhone=true;await study(phone,'offline-phone',30);
    expect(await phone.evaluate(()=>SyncCore.isDirty(_readSyncMeta()))).toBe(true);
    await expect(phone.locator('#syncIndicator')).toBeVisible();
    await study(ipad,'online-ipad',15);offlinePhone=false;
    await phone.evaluate(()=>window.dispatchEvent(new Event('online')));
    await expect.poll(()=>phone.evaluate(()=>SyncCore.isDirty(_readSyncMeta()))).toBe(false);
    await expect.poll(()=>minutes(phone)).toBe(525);await resume(ipad);await expect.poll(()=>minutes(ipad)).toBe(525);
    expect(row.data.sessionPlants).toHaveLength(4);
    await ipad.evaluate(()=>requestCloudRefresh());await phone.evaluate(()=>requestCloudRefresh());
    const points=await ipad.evaluate(()=>PianoRewards.walletSnapshot(db).points);
    expect(points).toBeGreaterThan(0);expect(await phone.evaluate(()=>PianoRewards.walletSnapshot(db).points)).toBeCloseTo(points,6);
    await phone.reload();await expect.poll(()=>minutes(phone)).toBe(525);
    expect(await phone.evaluate(()=>db.germanStudy.sessions.filter(s=>s.id==='phone-german').length)).toBe(1);
  }finally{await Promise.all(contexts.map(context=>context.close()));}
});
