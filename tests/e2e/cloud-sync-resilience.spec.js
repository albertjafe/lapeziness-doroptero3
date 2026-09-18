import {test,expect} from '@playwright/test';

// Only the remote transport is mocked. Real app auth handlers, merges,
// IndexedDB, local persistence and the single cloud writer run in the browser.
for(const alreadySignedIn of [false,true]) test(`account connects and uploads study with localStorage full (initial session=${alreadySignedIn})`,async({page})=>{
  test.setTimeout(45000);
  await page.setViewportSize({width:1194,height:834});
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* isolated fixture */'}));
  await page.addInitScript(({alreadySignedIn})=>{
    const initial={obras:[{id:'w',name:'Sonata',movimientos:[{id:'m',name:'I',sol:50}]}],sessionPlants:[{id:'local-session',mins:30}],forestPlants:[],sesiones:[],eventos:[],registro:[]};
    if(!localStorage.getItem('alberto_piano_v2'))localStorage.setItem('alberto_piano_v2',JSON.stringify(initial));
    const f=window.__cloudFake={listeners:[],session:alreadySignedIn?{user:{id:'u'}}:null,locked:false,writes:0,reads:0,
      row:{id:'u',updated_at:'v1',data:{...initial,sessionPlants:[...initial.sessionPlants,{id:'cloud-recovery',mins:240}]}}};
    f.emit=async event=>{
      if(event==='SIGNED_IN')f.session={user:{id:'u'}};
      f.locked=true;
      try{await Promise.all(f.listeners.map(fn=>fn(event,f.session)));}finally{f.locked=false;}
    };
    const sb={auth:{getSession:async()=>({data:{session:f.session}}),
      getUser:async()=>{if(f.locked)return new Promise(()=>{});return {data:{user:f.session?.user||null}};},
      onAuthStateChange:fn=>{f.listeners.push(fn);return {data:{subscription:{}}};}},
      from:table=>{
        let op='read',value,expected;
        const execute=async()=>{
          if(table!=='user_data')return {data:[],error:null};
          if(op==='read'){f.reads++;return {data:structuredClone(f.row)};}
          if(op==='update'&&expected!==f.row.updated_at)return {data:null};
          f.writes++;f.row={...structuredClone(value),updated_at:'v'+(f.writes+1)};return {data:structuredClone(f.row)};
        };
        const q={select:()=>q,eq:(key,v)=>{if(key==='updated_at')expected=v;return q;},in:()=>q,lte:()=>q,order:()=>q,limit:()=>q,
          update:v=>{op='update';value=v;return q;},insert:v=>{op='insert';value=v;return q;},
          maybeSingle:execute,single:execute,then:(resolve,reject)=>execute().then(resolve,reject)};
        return q;
      },rpc:async()=>({data:[],error:null})};
    window.supabase={createClient:()=>sb};
  },{alreadySignedIn});
  await page.goto('/');
  await page.waitForFunction(()=>window.LocalSaveResilience&&saveLocalNow.__metadataTolerantV2&&window.__cloudFake.listeners.length>0);
  await page.evaluate(()=>{
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='alberto_piano_v2')throw new DOMException('Full storage','QuotaExceededError');return set.call(this,key,value);};
  });
  await page.evaluate(()=>__cloudFake.emit(__cloudFake.session?'TOKEN_REFRESHED':'SIGNED_IN'));
  await expect.poll(()=>page.evaluate(()=>db.sessionPlants.some(p=>p.id==='cloud-recovery'))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>_cloudSyncConnected)).toBe(true);
  await page.evaluate(async()=>{
    db.sessionPlants.push({id:'new-study',mins:45,startedAt:new Date().toISOString()});
    saveData();await LocalSaveResilience.flush();await syncPendingCloudChanges();
  });
  await expect.poll(()=>page.evaluate(()=>__cloudFake.row.data.sessionPlants.filter(p=>p.id==='new-study').length)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>SyncCore.isDirty(_readSyncMeta()))).toBe(false);
  const snapshot=await page.evaluate(async()=>{await LocalSaveResilience.flush();return (await LocalSaveResilience.getRescueSnapshot()).data;});
  expect(snapshot.sessionPlants.map(p=>p.id)).toEqual(expect.arrayContaining(['local-session','cloud-recovery','new-study']));
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>db.sessionPlants.filter(p=>p.id==='new-study').length)).toBe(1);
  await page.evaluate(()=>__cloudFake.emit('SIGNED_IN'));
  await expect.poll(()=>page.evaluate(()=>__cloudFake.row.data.sessionPlants.filter(p=>p.id==='new-study').length)).toBe(1);
});
