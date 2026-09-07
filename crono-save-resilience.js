/* Cronómetro: cada bloque terminado y cada cierre Hecho conservan una copia
   independiente hasta que la sincronización y una reapertura sean seguras. */
(function cronoSaveResilience(){
  'use strict';

  const IDB_NAME='piano_timer_rescue_v1';
  const IDB_STORE='pendingPlants';
  const DOCUMENT_RESCUE_ID='document_latest';
  const DOCUMENT_RESCUE_MAX_AGE_MS=48*60*60*1000;
  let protectTimer=null;
  let lastTargetObraId=null;
  let pendingRescueWrites=Promise.resolve(true);

  function clone(value){
    try { if(typeof structuredClone==='function') return structuredClone(value); } catch(e) {}
    try { return JSON.parse(JSON.stringify(value)); } catch(e) { return value; }
  }

  function globalDb(){
    try { return db; } catch(e) { return window.db||null; }
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
    if(!plant || plant.id===DOCUMENT_RESCUE_ID) return '';
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

  async function rescuePut(record){
    if(!record || !record.id) return false;
    try {
      const database=await openRescueDb();
      await new Promise((resolve,reject)=>{
        const tx=database.transaction(IDB_STORE,'readwrite');
        tx.objectStore(IDB_STORE).put(clone(record));
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));
      });
      database.close();
      return true;
    } catch(e) { return false; }
  }

  function queueRescue(record){
    const write=Promise.resolve(pendingRescueWrites).then(()=>rescuePut(record));
    pendingRescueWrites=write.catch(()=>false);
    return write;
  }

  function flushRescueWrites(){
    return Promise.resolve(pendingRescueWrites).then(()=>true,()=>false);
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

  function documentRescueExpired(row){
    const stamp=Date.parse(row?.capturedAt||'');
    return Number.isFinite(stamp) && Date.now()-stamp>DOCUMENT_RESCUE_MAX_AGE_MS;
  }

  function queueDocumentRescue(obraId){
    const current=globalDb();
    if(!current) return Promise.resolve(false);
    return queueRescue({
      id:DOCUMENT_RESCUE_ID,
      kind:'completed-study-document',
      obraId:obraId||currentHechoObraId()||lastTargetObraId||null,
      capturedAt:new Date().toISOString(),
      data:clone(current),
    });
  }

  async function getDocumentRescue(){
    await flushRescueWrites();
    const rows=await rescueAll();
    const row=rows.find(item=>item && item.id===DOCUMENT_RESCUE_ID) || null;
    if(row && documentRescueExpired(row)){
      await rescueDelete(DOCUMENT_RESCUE_ID);
      return null;
    }
    return row;
  }

  async function hasDocumentSnapshot(raw){
    if(!raw) return false;
    const row=await getDocumentRescue();
    return !!(row?.data && sameDocumentContent(JSON.stringify(row.data),raw));
  }

  async function protectCloud(){
    try {
      await flushRescueWrites();
      persistCurrentIfNeeded();
      if(window.LocalSaveResilience?.flush) await window.LocalSaveResilience.flush();
      await flushRescueWrites();
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
      await flushRescueWrites();
      const rows=await rescueAll();
      const ok=await protectCloud(targetObraId||lastTargetObraId);
      if(ok){
        // Los bloques individuales son aditivos y pueden retirarse tras una
        // sincronización limpia. La instantánea completa del último cierre se
        // conserva durante 48 h: protege frente a un falso “sincronizado” y a
        // una recarga que vuelva a cargar un documento remoto atrasado.
        await Promise.all(rows.filter(row=>row?.id!==DOCUMENT_RESCUE_ID).map(row=>rescueDelete(row.id)));
        const documentRow=rows.find(row=>row?.id===DOCUMENT_RESCUE_ID);
        if(documentRow && documentRescueExpired(documentRow)) await rescueDelete(DOCUMENT_RESCUE_ID);
      }
    },60);
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
      lastTargetObraId=details.obraId||lastTargetObraId;
      // Siempre hay una segunda copia independiente. No dependemos de que
      // saveLocalNow lance una excepción: otras capas pueden absorber un fallo
      // de localStorage y devolver un fallback de IndexedDB sin throw.
      queueRescue(entry);
      try {
        const saveResult=saveLocalNow();
        refreshStudyViews();
        enqueueCloudSync();
        scheduleProtection(details.obraId);
        const degraded=!!(saveResult && (saveResult.localStorageFailed || saveResult.indexedDbFallback || saveResult.recovered));
        return {entry,persisted:true,degradedPersistence:degraded};
      } catch(error){
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

  function flushTodaySessionNow(){
    try {
      const immediate=typeof window._autoSaveTodayPlanNow==='function'
        ? window._autoSaveTodayPlanNow
        : (typeof _autoSaveTodayPlanNow==='function' ? _autoSaveTodayPlanNow : null);
      if(immediate){ immediate(); return true; }
    } catch(e) {}
    try {
      if(typeof autoSaveTodayPlan==='function') autoSaveTodayPlan();
    } catch(e) {}
    return false;
  }

  function installHechoPatch(){
    if(typeof closeHechoDatos!=='function' || closeHechoDatos.__resilientTimerSave) return false;
    const original=closeHechoDatos;
    const patched=function(){
      const obraId=currentHechoObraId();
      const finalize=()=>{
        // closeHechoDatos actualiza UI/aggregate y el autosave normal puede ser
        // diferido. Forzamos el escritor inmediato antes de capturar el rescate,
        // para que minutos, solidez y el item de Hoy estén en db ya mismo.
        flushTodaySessionNow();
        try { persistCurrentIfNeeded(); } catch(e) {}
        queueDocumentRescue(obraId);
        scheduleProtection(obraId);
      };
      try {
        const result=original.apply(this,arguments);
        if(result && typeof result.then==='function') return Promise.resolve(result).finally(finalize);
        finalize();
        return result;
      } catch(error){
        finalize();
        throw error;
      }
    };
    patched.__resilientTimerSave=true;
    patched.__original=original;
    try { closeHechoDatos=patched; } catch(e) {}
    try { window.closeHechoDatos=patched; } catch(e) {}
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

  function mergeDocumentRescue(local,row){
    if(!row?.data) return local;
    try {
      if(window.DocumentSyncCore?.merge) return window.DocumentSyncCore.merge(local,row.data);
      if(typeof DocumentSyncCore!=='undefined' && typeof DocumentSyncCore.merge==='function') return DocumentSyncCore.merge(local,row.data);
    } catch(e) {}
    return local;
  }

  async function recoverPending(){
    const local=globalDb();
    if(!local) return;
    await flushRescueWrites();
    const rows=await rescueAll();
    if(!rows.length) return;
    const documentRow=rows.find(row=>row?.id===DOCUMENT_RESCUE_ID && !documentRescueExpired(row));
    const plantRows=rows.filter(row=>row?.id!==DOCUMENT_RESCUE_ID);
    let changed=false;

    if(documentRow?.data){
      const recovered=mergeDocumentRescue(local,documentRow);
      if(recovered && JSON.stringify(recovered)!==JSON.stringify(local)){
        if(window.DocumentSyncCore?.assign) window.DocumentSyncCore.assign(local,recovered);
        else {
          Object.keys(local).forEach(key=>{ try { delete local[key]; } catch(e) {} });
          Object.assign(local,recovered);
        }
        changed=true;
      }
    }

    if(!Array.isArray(local.sessionPlants)) local.sessionPlants=[];
    plantRows.forEach(row=>{
      const key=plantKey(row);
      if(!key) return;
      const index=local.sessionPlants.findIndex(item=>plantKey(item)===key);
      if(index<0){ local.sessionPlants.push(row); changed=true; }
      else if(JSON.stringify(local.sessionPlants[index])!==JSON.stringify(row)){
        local.sessionPlants[index]=row; changed=true;
      }
    });
    if(changed) local.sessionPlants.sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||'')));
    try { if(changed && typeof saveLocalNow==='function') saveLocalNow(); } catch (_) {}
    const ok=await protectCloud((plantRows[plantRows.length-1]||documentRow)?.obraId);
    if(ok) await Promise.all(plantRows.map(row=>rescueDelete(row.id)));
    if(documentRow && documentRescueExpired(documentRow)) await rescueDelete(DOCUMENT_RESCUE_ID);
    try { if(changed && typeof refreshStudyViews==='function') refreshStudyViews(); } catch(e) {}
  }

  function boot(attempt){
    const finishReady=installFinishPatch() || (typeof finishStudyBlock==='function' && !!finishStudyBlock.__resilientTimerSave);
    const hechoReady=installHechoPatch() || (typeof closeHechoDatos==='function' && !!closeHechoDatos.__resilientTimerSave);
    installSaveDataFallback();
    if((finishReady && hechoReady) || attempt>80){ recoverPending(); return; }
    setTimeout(()=>boot(attempt+1),100);
  }

  window.CronoSaveResilience={
    isQuotaError,
    mergePlantsPreferLocal,
    protectCloud,
    recoverPending,
    persistCurrentIfNeeded,
    flush:flushRescueWrites,
    getDocumentRescue,
    hasDocumentSnapshot,
    queueDocumentRescue,
    flushTodaySessionNow,
  };
  boot(0);
})();
