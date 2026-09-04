/* Persistencia local: si localStorage está lleno, conserva un snapshot completo
   en IndexedDB y mantiene la sincronización pendiente en vez de abortar el guardado. */
(function localSaveResilience(){
  'use strict';

  const RESCUE_DB='piano_snapshot_rescue_v1';
  const RESCUE_STORE='snapshots';
  const RESCUE_KEY='latest';
  let pendingMeta=null;
  let rescuePromise=null;

  function clone(value){
    try { if(typeof structuredClone==='function') return structuredClone(value); } catch(e) {}
    try { return JSON.parse(JSON.stringify(value)); } catch(e) { return value; }
  }

  function currentDb(){
    try { return db; } catch(e) { return window.db||null; }
  }

  function show(message){
    try { if(typeof showSyncIndicator==='function') showSyncIndicator(message); } catch(e) {}
  }

  function openRescueDb(){
    return new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined'){ reject(new Error('IndexedDB unavailable')); return; }
      const request=indexedDB.open(RESCUE_DB,1);
      request.onupgradeneeded=()=>{
        const database=request.result;
        if(!database.objectStoreNames.contains(RESCUE_STORE)) database.createObjectStore(RESCUE_STORE,{keyPath:'id'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
    });
  }

  async function putRescueSnapshot(snapshot){
    const database=await openRescueDb();
    try {
      await new Promise((resolve,reject)=>{
        const tx=database.transaction(RESCUE_STORE,'readwrite');
        tx.objectStore(RESCUE_STORE).put({
          id:RESCUE_KEY,
          data:clone(snapshot),
          savedAt:snapshot&&snapshot._savedAt||new Date().toISOString(),
          revision:Number(snapshot&&snapshot._localRevision)||0,
          capturedAt:new Date().toISOString()
        });
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));
      });
    } finally { database.close(); }
    return true;
  }

  async function getRescueSnapshot(){
    try {
      const database=await openRescueDb();
      const row=await new Promise((resolve,reject)=>{
        const tx=database.transaction(RESCUE_STORE,'readonly');
        const request=tx.objectStore(RESCUE_STORE).get(RESCUE_KEY);
        request.onsuccess=()=>resolve(request.result||null);
        request.onerror=()=>reject(request.error||new Error('IndexedDB read failed'));
      });
      database.close();
      return row;
    } catch(e) { return null; }
  }

  function enqueueImmediate(){
    try {
      if(typeof enqueueCloudSync==='function') enqueueCloudSync({immediate:true,source:'local-save-resilience'});
      else if(typeof syncPendingCloudChanges==='function') Promise.resolve(syncPendingCloudChanges()).catch(()=>{});
    } catch(e) {}
  }

  function rescueCurrentSnapshot(snapshot){
    show('Guardando copia segura…');
    const previous=rescuePromise;
    const pending=Promise.resolve(previous).then(()=>putRescueSnapshot(snapshot)).then(()=>{
      show('✓ guardado en este dispositivo · sincronizando');
      enqueueImmediate();
      return true;
    }).catch(error=>{
      console.error('[sync] también falló IndexedDB',error);
      show('⚠ copia local degradada · sincronización pendiente');
      enqueueImmediate();
      return false;
    }).finally(()=>{ if(rescuePromise===pending) rescuePromise=null; });
    rescuePromise=pending;
    return pending;
  }

  function install(){
    if(typeof saveLocalNow!=='function' || saveLocalNow.__metadataTolerantV2) return false;
    const patched=function(){
      if(typeof _prepareLocalDocument === 'function') _prepareLocalDocument(true);
      const live=currentDb();
      if(!live) return false;
      let nextMeta;
      try {
        const currentMeta=_readSyncMeta();
        currentMeta.localRevision=Math.max(currentMeta.localRevision,Number(live._localRevision)||0);
        nextMeta=(typeof SyncCore!=='undefined') ? SyncCore.markDirty(currentMeta) : currentMeta;
        live._savedAt=new Date().toISOString();
        if(nextMeta && nextMeta.localRevision) live._localRevision=nextMeta.localRevision;
        localStorage.setItem(DB_KEY,JSON.stringify(live));
        if(typeof _rememberLocalDocument === 'function') _rememberLocalDocument();
      } catch(error){
        pendingMeta=nextMeta||pendingMeta;
        console.warn('[sync] localStorage lleno/no disponible; usando IndexedDB',error);
        rescueCurrentSnapshot(clone(live));
        try { setTimeout(retryMeta,250); } catch(e) {}
        return Object.assign({},nextMeta||{}, {recovered:true,indexedDbFallback:true,localStorageFailed:true});
      }

      try {
        _writeSyncMeta(nextMeta);
        pendingMeta=null;
      } catch(metaError){
        // El snapshot principal YA está guardado. No convertir este fallo secundario
        // en un falso “no se guardó”. Liberamos el metadato anterior y reintentamos.
        try {
          localStorage.removeItem(SYNC_META_KEY);
          _writeSyncMeta(nextMeta);
          pendingMeta=null;
        } catch(secondError){
          pendingMeta=nextMeta;
          console.warn('[sync] snapshot guardado; metadato pendiente',secondError);
          show('✓ guardado · sincronización pendiente');
          setTimeout(retryMeta,250);
        }
      }
      return nextMeta;
    };
    patched.__metadataTolerant=true;
    patched.__metadataTolerantV2=true;
    try { saveLocalNow=patched; } catch(e) {}
    try { window.saveLocalNow=patched; } catch(e) {}
    return true;
  }

  function retryMeta(){
    if(!pendingMeta){ enqueueImmediate(); return; }
    try {
      localStorage.removeItem(SYNC_META_KEY);
      _writeSyncMeta(pendingMeta);
      pendingMeta=null;
      enqueueImmediate();
    } catch(error){
      enqueueImmediate();
    }
  }

  function replaceObject(target,source){
    if(!target||!source||typeof target!=='object'||typeof source!=='object') return false;
    Object.keys(target).forEach(key=>{ try { delete target[key]; } catch(e) {} });
    Object.assign(target,source);
    return true;
  }

  async function recoverSnapshot(){
    const row=await getRescueSnapshot();
    const live=currentDb();
    if(!row||!row.data||!live) return false;
    try {
      const comparison=(typeof SyncCore!=='undefined'&&typeof SyncCore.compareDbFreshness==='function')
        ? SyncCore.compareDbFreshness(row.data,live)
        : ((Number(row.data._localRevision)||0)-(Number(live._localRevision)||0));
      if(comparison<=0 && !window.DocumentSyncCore) return false;
      let recovered=row.data;
      if(window.DataCore&&typeof window.DataCore.mergeStudyHistory==='function'){
        recovered=typeof _mergeStudyHistory === 'function' ? _mergeStudyHistory(live,row.data) : window.DataCore.mergeStudyHistory(live,row.data);
      }
      if(JSON.stringify(live) === JSON.stringify(recovered)) return false;
      if(window.DocumentSyncCore) window.DocumentSyncCore.assign(live,recovered);
      else replaceObject(live,recovered);
      if(typeof saveLocalNow === 'function') saveLocalNow();
      try { localStorage.setItem(DB_KEY,JSON.stringify(live)); } catch(e) {}
      show('✓ copia local recuperada · sincronizando');
      enqueueImmediate();
      return true;
    } catch(error){
      console.warn('[sync] no se pudo recuperar snapshot IndexedDB',error);
      return false;
    }
  }

  function boot(attempt){
    if(install()){
      setTimeout(recoverSnapshot,50);
      return;
    }
    if(attempt<80) setTimeout(()=>boot(attempt+1),100);
  }

  window.LocalSaveResilience={
    retryMeta,
    flush:()=>rescuePromise || Promise.resolve(true),
    recoverSnapshot,
    getRescueSnapshot,
    hasPendingMeta:()=>!!pendingMeta,
    hasPendingRescue:()=>!!rescuePromise
  };
  boot(0);
})();
