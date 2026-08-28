/* Persistencia local: si la BD ya se escribió, un fallo del metadato de sync no invalida el guardado. */
(function localSaveResilience(){
  'use strict';
  let pendingMeta=null;

  function install(){
    if(typeof saveLocalNow!=='function' || saveLocalNow.__metadataTolerant) return false;
    const patched=function(){
      let nextMeta;
      try {
        const currentMeta=_readSyncMeta();
        nextMeta=(typeof SyncCore!=='undefined') ? SyncCore.markDirty(currentMeta) : currentMeta;
        db._savedAt=new Date().toISOString();
        if(nextMeta && nextMeta.localRevision) db._localRevision=nextMeta.localRevision;
        localStorage.setItem(DB_KEY,JSON.stringify(db));
      } catch(error){
        try { if(typeof showSyncIndicator==='function') showSyncIndicator('⚠ error al guardar en este dispositivo'); } catch(e) {}
        console.error('[sync] no se pudo guardar la base local',error);
        throw error;
      }

      try {
        _writeSyncMeta(nextMeta);
        pendingMeta=null;
      } catch(metaError){
        // El snapshot principal YA está guardado. No convertir este fallo secundario
        // en un falso “no se guardó”. Borramos el metadato anterior y reintentamos:
        // libera unos bytes justo en el caso típico de cuota al límite.
        try {
          localStorage.removeItem(SYNC_META_KEY);
          _writeSyncMeta(nextMeta);
          pendingMeta=null;
        } catch(secondError){
          pendingMeta=nextMeta;
          console.warn('[sync] snapshot guardado; metadato pendiente',secondError);
          try { if(typeof showSyncIndicator==='function') showSyncIndicator('✓ guardado · sincronización pendiente'); } catch(e) {}
          setTimeout(retryMeta,250);
        }
      }
      return nextMeta;
    };
    patched.__metadataTolerant=true;
    try { saveLocalNow=patched; } catch(e) {}
    try { window.saveLocalNow=patched; } catch(e) {}
    return true;
  }

  function retryMeta(){
    if(!pendingMeta) return;
    try {
      localStorage.removeItem(SYNC_META_KEY);
      _writeSyncMeta(pendingMeta);
      pendingMeta=null;
      if(typeof enqueueCloudSync==='function') enqueueCloudSync({immediate:true});
    } catch(error){
      // CronoSaveResilience protegerá las sesiones en nube/IndexedDB si procede.
      try {
        if(window.CronoSaveResilience && typeof window.CronoSaveResilience.protectCloud==='function') {
          window.CronoSaveResilience.protectCloud();
        }
      } catch(e) {}
    }
  }

  function boot(attempt){
    if(install()) return;
    if(attempt<80) setTimeout(()=>boot(attempt+1),100);
  }

  window.LocalSaveResilience={retryMeta,hasPendingMeta:()=>!!pendingMeta};
  boot(0);
})();
