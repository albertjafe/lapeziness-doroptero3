import {test,expect} from '@playwright/test';

// The big user_data document upload always fails with a statement timeout
// (57014), as it did on the real iPad. Study must still reach the phone
// through the per-record study ledger.
test('study reaches the phone through the study ledger while the document upload times out',async({browser})=>{
  test.setTimeout(90000);
  const ledger=new Map();let seq=0,documentWrites=0;
  const initial={obras:[{id:'bach',name:'Bach',movimientos:[]}],sessionPlants:[],forestPlants:[],sesiones:[],eventos:[],registro:[]};
  const contexts=[];
  function handle({op,filters,rows}){
    if(op==='select'){
      const since=filters.updated_at||'',after=filters.seq??-1;
      const data=[...ledger.values()].filter(r=>r.updated_at>since&&r.seq>after).sort((a,b)=>a.seq-b.seq).slice(0,filters.limit);
      return {data:structuredClone(data),error:null};
    }
    for(const row of rows){
      const key=row.collection+'|'+row.record_key,old=ledger.get(key);
      if(old&&(row.edited_at<old.edited_at||(row.edited_at===old.edited_at&&old.deleted&&!row.deleted)))continue;
      if(old&&row.edited_at===old.edited_at&&row.deleted===old.deleted&&JSON.stringify(row.record)===JSON.stringify(old.record))continue;
      ledger.set(key,{...structuredClone(row),updated_at:new Date(Date.now()+seq).toISOString(),seq:++seq});
    }
    return {error:null};
  }
  async function device(phone){
    const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:phone?{width:390,height:844}:{width:1194,height:834},serviceWorkers:'block'});contexts.push(context);
    await context.route('**/supabase-sdk-v2-116-0.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* SDK isolated */'}));
    await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'text/javascript',body:'/* isolated */'}));
    await context.route('https://ledger.test/**',async route=>{
      const body=route.request().postDataJSON();
      if(body.table==='user_data'){
        if(body.op==='read')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:null,error:null})});
        documentWrites++;
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:null,error:{code:'57014',message:'canceling statement due to statement timeout'}})});
      }
      const result=body.table==='study_ledger'?handle(body):{data:[],error:null};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await context.addInitScript(initial=>{
      if(!localStorage.getItem('alberto_piano_v2'))localStorage.setItem('alberto_piano_v2',JSON.stringify(initial));
      const call=payload=>fetch('https://ledger.test/',{method:'POST',body:JSON.stringify(payload)}).then(r=>r.json());
      const sb={auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}}),getUser:async()=>({data:{user:{id:'u'}}}),onAuthStateChange:()=>({data:{subscription:{}}})},
        from:table=>{
          const filters={};let op='read';
          const q={select:()=>q,eq:()=>q,gt:(k,v)=>{filters[k]=v;return q;},order:()=>q,in:()=>q,lte:()=>q,abortSignal:()=>q,
            limit:n=>{filters.limit=n;return table==='study_ledger'?call({table,op:'select',filters}):q;},
            update:()=>{op='write';return q;},insert:()=>{op='write';return q;},
            upsert:rows=>call({table,op:'upsert',rows}),
            maybeSingle:()=>call({table,op}),single:()=>call({table,op}),then:(a,b)=>call({table,op}).then(a,b)};
          return q;
        },rpc:async()=>({data:[]})};
      window.supabase={createClient:()=>sb};
    },initial);
    const page=await context.newPage();await page.goto('/');
    await page.waitForFunction(()=>window.StudyLedgerSync&&window.LocalSaveResilience&&typeof DailyStudyMinutes!=='undefined');
    return page;
  }
  async function study(page,id,mins){
    await page.evaluate(async({id,mins})=>{
      const end=Date.now()-60000,start=end-mins*60000;
      db.sessionPlants.push({id,runId:id,obraId:'bach',mins,startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString()});
      saveData();await StudyLedgerSync.syncNow();
    },{id,mins});
  }
  const minutes=page=>page.evaluate(()=>DailyStudyMinutes.todayMinutes());
  try{
    const ipad=await device(false),phone=await device(true);
    await study(ipad,'ipad-a',120);await study(ipad,'ipad-b',120);
    // The document path really is broken: every upload attempt timed out.
    await ipad.evaluate(()=>syncPendingCloudChanges());
    expect(documentWrites).toBeGreaterThan(0);
    await phone.evaluate(()=>StudyLedgerSync.syncNow());
    await expect.poll(()=>minutes(phone)).toBe(240);
    // The phone adds study; the iPad receives it on focus.
    await study(phone,'phone-c',30);
    await ipad.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect.poll(()=>minutes(ipad),{timeout:10000}).toBe(270);
    // Nothing is uploaded twice and a reload keeps everything.
    const rows=ledger.size;
    await ipad.evaluate(()=>StudyLedgerSync.syncNow());await phone.evaluate(()=>StudyLedgerSync.syncNow());
    expect(ledger.size).toBe(rows);expect(rows).toBe(3);
    await phone.reload();await phone.waitForFunction(()=>typeof DailyStudyMinutes!=='undefined');
    await expect.poll(()=>minutes(phone)).toBe(270);
  }finally{await Promise.all(contexts.map(context=>context.close()));}
});
