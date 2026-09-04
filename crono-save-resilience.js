/* Cronómetro: un fallo de localStorage no debe perder el bloque ni impedir el modal Hecho. */
(function cronoSaveResilience(){
  'use strict';

  const IDB_NAME='piano_timer_rescue_v1';
  const IDB_STORE='pendingPlants';
  let protectTimer=null;
  let lastTargetObraId=null;

  function clone(value){
    try { if(typeof structuredClone==='function') return structuredClone(value); } catch(e) {}
    try { return JSON.parse(JSON.stringify(value)); } catch(e) { return value; }
  }

  function globalDb(){
    try { return db; } catch(e) { return null; }
  }

  function sameDocumentContent(left,right){
    if(left===right) return true;
    if(!left || !right) return false;
    try {
      const core=window.DocumentSyncCore || (typeof DocumentSyncCore!=='undefined' ? DocumentSyncCore : null);
      if(core && typeof core.sameContent==='function') return core.sameContent(JSON.parse(left),JSON.parse(right));
      const a=JSON.parse(left),b=JSON.parse(right);
      if(a && typeof a==='object'){ delete a._localRevision;delete a._savedAt; }
      if(b && typeof b==='object'){ delete b._localRevision;delete b._savedAt; }
      return JSON.stringify(a)===JSON.stringify(b);
    } catch(e){ return false; }
  }

  function persistCurrentIfNeeded(){
    const current=globalDb();
    if(!current) return false;
    let disk='';
    try { disk=window.localStorage?.getItem('alberto_piano_v2') || ''; } catch(e) {}
    const memory=JSON.stringify(current);
    if(sameDocumentContent(memory,disk)) return false;
    if(typeof saveLocalNow==='function') saveLocalNow();
    return true;
  }

  function isQuotaError(error){
    if(!error) return false;
    const name=String(error.name||'');
    const code=Number(error.code);
    return name==='QuotaExceededError' || name==='NS_ERROR_DOM_QUOTA_REACHED' || code===22 || code===1014;
  }

  function plantKey(plant){
    if(!plant) return '';
    return String(plant.id || [plant.obraId||'',plant.startedAt||'',plant.endedAt||''].join('|'));
  }

  function mergePlantsPreferLocal(remote,local){
    const map=new Map();
    (remote||[]).forEach(plant=>{ const key=plantKey(plant); if(key) map.set(key,plant); });
    (local||[]).forEach(plant=>{ const key=plantKey(plant); if(key) map.set(key,plant); });
    return Array.from(map.values()).sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||'')));
  }

  function openRescueDb(){
    return new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined'){ reject(new Error('IndexedDB unavailable')); return; }
      const request=indexedDB.open(IDB_NAME,1);
      request.onupgradeneeded=()=>{
        const database=request.result;
        if(!database.objectStoreNames.contains(IDB_STORE)) database.createObjectStore(IDB_STORE,{keyPath:'id'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
    });
  }

  async function rescuePut(plant){
    if(!plant || !plant.id) return false;
    try {
      const database=await openRescueDb();
      await new Promise((resolve,reject)=>{
        const tx=database.transaction(IDB_STORE,'readwrite');
        tx.objectStore(IDB_STORE).put(clone(plant));
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));
      });
      database.close();
      return true;
    } catch(e) { return false; }
  }

  async function rescueDelete(id){
    if(!id) return;
    try {
      const database=await openRescueDb();
      await new Promise((resolve,reject)=>{
        const tx=database.transaction(IDB_STORE,'readwrite');
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('IndexedDB delete failed'));
      });
      database.close();
    } catch(e) {}
  }

  async function rescueAll(){
    try {
      const database=await openRescueDb();
      const rows=await new Promise((resolve,reject)=>{
        const tx=database.transaction(IDB_STORE,'readonly');
        const request=tx.objectStore(IDB_STORE).getAll();
        request.onsuccess=()=>resolve(request.result||[]);
        request.onerror=()=>reject(request.error||new Error('IndexedDB read failed'));
      });
      database.close();
      return rows;
    } catch(e) { return []; }
  }

  function currentHechoObraId(){
    try { if(typeof _hechoObraId!=='undefined' && _hechoObraId) return _hechoObraId; } catch(e) {}
    return lastTargetObraId;
  }

  async function protectCloud(){
    try {
      persistCurrentIfNeeded();
      if(window.LocalSaveResilience?.flush) await window.LocalSaveResilience.flush();
      if(typeof syncPendingCloudChanges !== 'function') return false;
      await syncPendingCloudChanges();
      return typeof SyncCore !== 'undefined' && !SyncCore.isDirty(_readSyncMeta());
    } catch(error) { return false; }
  }

  function scheduleProtection(targetObraId){
    if(targetObraId) lastTargetObraId=targetObraId;
    if(protectTimer) clearTimeout(protectTimer);
    protectTimer=setTimeout(async()=>{
      protectTimer=null;
      const rows=await rescueAll();
      const ok=await protectCloud(targetObraId||lastTargetObraId);
      if(ok){
        await Promise.all(rows.map(row=>rescueDelete(row.id)));
      }
    },40);
  }

  function installFinishPatch(){
    if(typeof finishStudyBlock!=='function' || finishStudyBlock.__resilientTimerSave) return false;
    const patched=function(details){
      const entry=recordSessionPlant(
        details.obraId,
        details.movId,
        details.startedAt,
        details.endedAt,
        details.mins,
        Object.assign({},details.opts||{},{runId:details.runId})
      );
      if(!entry) return {entry:null,persisted:false};
      try {
        saveLocalNow();
        refreshStudyViews();
        enqueueCloudSync();
        return {entry,persisted:true};
      } catch(error){
        lastTargetObraId=details.obraId||lastTargetObraId;
        rescuePut(entry);
        scheduleProtection(details.obraId);
        try {
          if(typeof showToast==='function') showToast(isQuotaError(error)
            ? 'El almacenamiento local está lleno. La sesión sigue a salvo y la estoy protegiendo en la nube.'
            : 'La copia local falló. La sesión sigue a salvo y puedes completar sus datos.');
        } catch(e) {}
        // Importante: cronoFinish debe continuar hasta openHechoDatos().
        return {entry,persisted:true,degradedPersistence:true,error};
      }
    };
    patched.__resilientTimerSave=true;
    try { finishStudyBlock=patched; } catch(e) {}
    try { window.finishStudyBlock=patched; } catch(e) {}
    return true;
  }

  function installSaveDataFallback(){
    if(typeof saveData!=='function' || saveData.__resilientTimerSave) return false;
    const original=saveData;
    const patched=function(){
      const result=original.apply(this,arguments);
      if(result===false) scheduleProtection(currentHechoObraId());
      return result;
    };
    patched.__resilientTimerSave=true;
    patched.__original=original;
    try { saveData=patched; } catch(e) {}
    try { window.saveData=patched; } catch(e) {}
    return true;
  }

  async function recoverPending(){
    const local=globalDb();
    if(!local) return;
    const rows=await rescueAll();
    if(!rows.length) return;
    if(!Array.isArray(local.sessionPlants)) local.sessionPlants=[];
    let changed=false;
    rows.forEach(row=>{
      const key=plantKey(row);
      const index=local.sessionPlants.findIndex(item=>plantKey(item)===key);
      if(index<0){ local.sessionPlants.push(row); changed=true; }
      else if(JSON.stringify(local.sessionPlants[index])!==JSON.stringify(row)){
        local.sessionPlants[index]=row; changed=true;
      }
    });
    if(changed) local.sessionPlants.sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||'')));
    try { if(changed && typeof saveLocalNow==='function') saveLocalNow(); } catch (_) {}
    const ok=await protectCloud(rows[rows.length-1] && rows[rows.length-1].obraId);
    if(ok) await Promise.all(rows.map(row=>rescueDelete(row.id)));
    try { if(changed && typeof refreshStudyViews==='function') refreshStudyViews(); } catch(e) {}
  }

  function boot(attempt){
    const installed=installFinishPatch();
    installSaveDataFallback();
    if(installed || attempt>60){ recoverPending(); return; }
    setTimeout(()=>boot(attempt+1),100);
  }

  window.CronoSaveResilience={isQuotaError,mergePlantsPreferLocal,protectCloud,recoverPending,persistCurrentIfNeeded};
  boot(0);
})();
