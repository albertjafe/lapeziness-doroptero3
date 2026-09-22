import {test,expect} from '@playwright/test';
import Doc from '../../document-sync-core.js';

// Only HTTP endpoints are simulated. The pinned SDK, refresh machinery,
// auth events, PostgREST builders and app persistence all run unchanged.
test('real SDK renews expired sessions and exchanges pending iPad study with a phone',async({browser})=>{
  test.setTimeout(60000);
  const now=Date.parse('2026-09-18T17:00:00Z');
  const user={id:'00000000-0000-4000-8000-000000000001',email:'sync@example.test',aud:'authenticated',role:'authenticated'};
  const expires=Math.floor(now/1000)+3600;
  const jwt='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url')+'.test-signature';
  const base={obras:[],sesiones:[],forestPlants:[],registro:[],eventos:[],sessionPlants:[{id:'morning',runId:'morning',mins:77,startedAt:new Date(now-400*60000).toISOString(),endedAt:new Date(now-323*60000).toISOString()}]};
  const later={id:'later',runId:'later',mins:289,startedAt:new Date(now-300*60000).toISOString(),endedAt:new Date(now-11*60000).toISOString()};
  let row={id:user.id,data:structuredClone(base),updated_at:new Date(now).toISOString()},writes=0;
  const contexts=[],refreshes=[],authorized=[];
  async function device(ipad){
    const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:ipad?{width:1194,height:834}:{width:390,height:844},timezoneId:'Europe/Berlin',serviceWorkers:'block'});contexts.push(context);
    await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* external presentation assets */'}));
    let attempted=0;
    await context.route('https://fexfeekifzgszluemihs.supabase.co/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname==='/auth/v1/token'){
        refreshes.push(ipad?'ipad':'phone');
        if(ipad&&++attempted===1)return send({message:'Temporary auth outage'},503);
        return send({access_token:jwt,refresh_token:'rotated-test-refresh',token_type:'bearer',expires_in:3600,expires_at:expires,user});
      }
      if(url.pathname==='/auth/v1/user'){
        authorized.push(req.headers().authorization);return send(user);
      }
      if(url.pathname==='/rest/v1/user_data'){
        expect(req.headers().authorization).toBe('Bearer '+jwt);
        if(req.method()==='GET')return send(url.searchParams.get('select')==='updated_at'?[{updated_at:row.updated_at}]:[structuredClone(row)]);
        if(req.method()==='PATCH'){
          if(url.searchParams.get('updated_at')!=='eq.'+row.updated_at)return send(null);
          const incoming=req.postDataJSON();
          row={...incoming,data:Doc.mergeRemote(row.data,incoming.data),updated_at:new Date(now+(++writes)*1000).toISOString()};return send(structuredClone(row));
        }
      }
      return send([]);
    });
    const page=await context.newPage();
    await page.clock.install({time:new Date(now)});
    await page.addInitScript(({base,later,user,ipad})=>{
      localStorage.setItem('alberto_piano_v2',JSON.stringify({...base,sessionPlants:ipad?[...base.sessionPlants,later]:base.sessionPlants}));
      localStorage.setItem('piano_auth_v1',JSON.stringify({access_token:'expired-test-access',refresh_token:'expired-test-refresh',expires_at:Math.floor(Date.now()/1000)-30,token_type:'bearer',user}));
      // A lock left by an older SDK must not block the official lockless SDK.
      if(navigator.locks)navigator.locks.request('lock:piano_auth_v1',()=>new Promise(()=>{}));
    },{base,later,user,ipad});
    await page.goto('/');return page;
  }
  try{
    const ipad=await device(true);
    await expect.poll(()=>row.data.sessionPlants.reduce((sum,p)=>sum+p.mins,0),{timeout:20000}).toBe(366);
    await expect.poll(()=>ipad.evaluate(()=>SyncCore.isDirty(_readSyncMeta()))).toBe(false);
    expect(await ipad.evaluate(()=>JSON.parse(localStorage.getItem('piano_auth_v1')).refresh_token)).toBe('rotated-test-refresh');
    const phone=await device(false);
    await expect.poll(()=>phone.evaluate(()=>DailyStudyMinutes.todayMinutes()),{timeout:20000}).toBe(366);
    await phone.evaluate(()=>updateSyncStatusInfo());await expect(phone.locator('#syncStatusInfo')).toContainText('sync@example.test');
    expect(refreshes).toContain('ipad');expect(refreshes).toContain('phone');
    expect(authorized.length).toBeGreaterThan(0);expect(authorized.every(v=>v==='Bearer '+jwt)).toBe(true);
    expect(row.data.sessionPlants).toHaveLength(2);
  }finally{await Promise.all(contexts.map(context=>context.close()));}
});
