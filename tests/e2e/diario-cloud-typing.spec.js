import {test,expect} from '@playwright/test';

async function boot(page){
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.addInitScript(()=>{
    const d=new Date(),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    localStorage.setItem('alberto_piano_v2',JSON.stringify({competitionPlanningSeedVersion:999,obras:[],eventos:[],sesiones:[],forestPlants:[],registro:[],
      dailyJournalEntries:[{id:'note',day,text:'Original',future:{keep:true}}]}));
  });
  await page.goto('/');await expect(page.locator('#splashScreen')).toHaveClass(/gone/);
  await page.evaluate(()=>{
    document.querySelectorAll('.modal-overlay.visible').forEach(x=>closeModal(x.id));showView('diario');
    clearTimeout(_syncTimer);_syncTimer=null;
    const f=window.cloudTyping={row:{id:'u',data:structuredClone(db),updated_at:'v0'},writes:0,merges:0,hold:false};
    const merge=DocumentSyncCore.mergeRemote;
    DocumentSyncCore.mergeRemote=(...args)=>{f.merges++;return merge(...args);};
    const sb={auth:{getUser:async()=>({data:{user:{id:'u'}}})},from:()=>{
      let value,expected;const q={select:()=>q,eq:(key,v)=>{if(key==='updated_at')expected=v;return q;},
        update:v=>{value=v;return q;},insert:v=>{value=v;return q;},maybeSingle:async()=>{
          if(!value){
            const result={data:structuredClone(f.row)};
            if(f.holdRead)await new Promise(resolve=>{f.releaseRead=resolve;});
            return result;
          }
          if(expected!==f.row.updated_at)return {data:null};
          f.writes++;f.row={...value,data:merge(f.row.data,value.data),updated_at:'v'+f.writes};
          const result={data:structuredClone(f.row)};
          if(f.hold)await new Promise(resolve=>{f.release=resolve;});
          return result;
        }};return q;
    }};
    _sbClient=sb;_cloudRetryAt=0;_cloudRetryCount=0;
    db.dailyJournalEntries[0].text='Primera versión';saveData();clearTimeout(_syncTimer);_syncTimer=null;
  });
}

test('a cloud response arriving during typing waits, preserves the newer text and defers the next upload',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{cloudTyping.hold=true;window.syncDone=false;syncPendingCloudChanges().then(()=>{syncDone=true;});});
  await expect.poll(()=>page.evaluate(()=>!!cloudTyping.release)).toBe(true);
  await page.locator('.dia-free:not(.dia-new) .dia-fmt').click();
  const area=page.locator('.dia-free:not(.dia-new) .dia-ink');
  await area.fill('Texto nuevo durante la subida');
  await page.evaluate(()=>{cloudTyping.before=cloudTyping.merges;cloudTyping.hold=false;cloudTyping.release();});
  await area.pressSequentially(' sin perder letras',{delay:40});
  expect(await page.evaluate(()=>cloudTyping.merges-cloudTyping.before)).toBe(0);
  expect(await page.evaluate(()=>syncDone)).toBe(false);
  await area.blur();
  await expect.poll(()=>page.evaluate(()=>syncDone)).toBe(true);
  const pending=await page.evaluate(()=>({writes:cloudTyping.writes,dirty:SyncCore.isDirty(_readSyncMeta()),
    note:JSON.parse(localStorage.getItem(DB_KEY)).dailyJournalEntries.find(e=>e.id==='note')}));
  expect(pending.writes).toBe(1);expect(pending.dirty).toBe(true);
  expect(pending.note).toMatchObject({text:'Texto nuevo durante la subida sin perder letras',future:{keep:true}});
  await page.evaluate(()=>syncPendingCloudChanges());
  expect(await page.evaluate(()=>cloudTyping.row.data.dailyJournalEntries.find(e=>e.id==='note').text)).toBe(pending.note.text);
  expect(await page.evaluate(()=>SyncCore.isDirty(_readSyncMeta()))).toBe(false);
});

test('an already queued upload waits for typing; local autosave still happens without a save button',async({page})=>{
  await boot(page);
  await page.locator('.dia-free:not(.dia-new) .dia-fmt').click();
  const area=page.locator('.dia-free:not(.dia-new) .dia-ink');
  await area.fill('Texto continuo');
  await page.evaluate(()=>{window.syncDone=false;syncPendingCloudChanges().then(()=>{syncDone=true;});});
  await area.pressSequentially(' y más letras',{delay:60});
  expect(await page.evaluate(()=>cloudTyping.writes)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem(DB_KEY)).dailyJournalEntries[0].text)).toBe('Texto continuo y más letras');
  await expect.poll(()=>page.evaluate(()=>syncDone)).toBe(true);
  expect(await page.evaluate(()=>cloudTyping.row.data.dailyJournalEntries.find(e=>e.id==='note').text)).toBe('Texto continuo y más letras');
});

test('hiding the page or changing account releases the typing wait',async({page})=>{
  await boot(page);await page.locator('.dia-free:not(.dia-new) .dia-fmt').click();
  await page.locator('.dia-free:not(.dia-new) .dia-ink').fill('Conservado al ocultar');
  await page.evaluate(()=>{window.waitDone=false;_waitForDiaryQuiet().then(()=>{waitDone=true;});});
  expect(await page.evaluate(()=>waitDone)).toBe(false);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});window.dispatchEvent(new PageTransitionEvent('pagehide'));});
  await expect.poll(()=>page.evaluate(()=>waitDone)).toBe(true);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(DB_KEY)).dailyJournalEntries[0].text)).toBe('Conservado al ocultar');
  await page.evaluate(()=>{delete document.hidden;window.waitDone=false;_waitForDiaryQuiet().then(()=>{waitDone=true;});_cloudAuthEpoch++;});
  await expect.poll(()=>page.evaluate(()=>waitDone)).toBe(true);
});

test('a download arriving while a note is deleted cannot resurrect it',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{cloudTyping.holdRead=true;window.downloadDone=false;loadFromCloud().then(()=>{downloadDone=true;});});
  await expect.poll(()=>page.evaluate(()=>!!cloudTyping.releaseRead)).toBe(true);
  await page.locator('.dia-free:not(.dia-new) .dia-fmt').click();
  const area=page.locator('.dia-free:not(.dia-new) .dia-ink');
  await area.fill('');
  await page.evaluate(()=>{cloudTyping.before=cloudTyping.merges;cloudTyping.holdRead=false;cloudTyping.releaseRead();});
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>cloudTyping.merges-cloudTyping.before)).toBe(0);
  await area.blur();await expect.poll(()=>page.evaluate(()=>downloadDone)).toBe(true);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(DB_KEY)).dailyJournalEntries.some(e=>e.id==='note'))).toBe(false);
  expect(await page.evaluate(()=>db._deletedChildren.dailyJournalEntries['id:note'])).toBeTruthy();
});
