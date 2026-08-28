/* Evita falsos negativos cuando el snapshot principal sí se escribió pero falla
 * el pequeño metadato de sincronización (p. ej. Safari cerca de cuota local).
 */
(function persistenceGuard(){
  'use strict';
  const DB_KEY='alberto_piano_v2';
  const META_KEY='alberto_sync_v1';
  const original=window.saveLocalNow;
  if(typeof original!=='function') return;

  function memoryDb(){
    try { if(typeof db!=='undefined' && db) return db; } catch(e) {}
    try { if(typeof DB!=='undefined' && DB) return DB; } catch(e) {}
    return null;
  }

  function snapshotWasWritten(){
    try {
      const raw=localStorage.getItem(DB_KEY);
      if(!raw) return false;
      const disk=JSON.parse(raw);
      const mem=memoryDb();
      if(!mem) return false;
      if(mem._savedAt && disk._savedAt && String(mem._savedAt)===String(disk._savedAt)) return true;
      const memRev=Number(mem._localRevision)||0;
      const diskRev=Number(disk._localRevision)||0;
      return memRev>0 && diskRev===memRev;
    } catch(e){ return false; }
  }

  function repairSyncMeta(){
    try {
      const mem=memoryDb();
      const revision=Math.max(0,Number(mem && mem._localRevision)||0);
      let old={};
      try { old=JSON.parse(localStorage.getItem(META_KEY)||'{}')||{}; } catch(e) {}
      /* Si la cuota quedó al límite tras crecer el snapshot, liberar primero el
         metadato anterior permite reescribir uno mínimo. */
      localStorage.removeItem(META_KEY);
      localStorage.setItem(META_KEY,JSON.stringify({
        localRevision:revision,
        dirtyRevision:revision,
        lastSyncedRevision:Math.min(revision,Math.max(0,Number(old.lastSyncedRevision)||0))
      }));
      return true;
    } catch(e){ return false; }
  }

  window.saveLocalNow=function guardedSaveLocalNow(){
    try {
      return original.apply(this,arguments);
    } catch(error){
      /* _writeLocalSnapshot escribe primero DB_KEY y después META_KEY. Si DB_KEY
         ya contiene exactamente el snapshot de memoria, el estudio está a salvo:
         no debemos cancelar el modal de fin de sesión por un fallo secundario. */
      if(snapshotWasWritten()){
        repairSyncMeta();
        try { if(typeof showSyncIndicator==='function') showSyncIndicator('✓ guardado · sincronización pendiente'); } catch(e) {}
        const mem=memoryDb();
        const revision=Math.max(0,Number(mem && mem._localRevision)||0);
        return {localRevision:revision,dirtyRevision:revision,lastSyncedRevision:0,recovered:true};
      }
      throw error;
    }
  };
})();
