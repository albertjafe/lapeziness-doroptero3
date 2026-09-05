/* Actualizaciones de PWA transaccionales: primero persistir + sincronizar,
   después (y solo después) permitir que el service worker cambie de versión. */
(function updateSafety(root){
  'use strict';

  const DB_KEY = 'alberto_piano_v2';
  const SYNC_KEY = 'alberto_sync_v1';
  const RESCUE_DB = 'piano_pre_update_rescue_v1';
  const RESCUE_STORE = 'snapshots';
  let installed = false;
  let updating = false;
  let reloading = false;
  let controlled = Boolean(root.navigator?.serviceWorker?.controller);
  let explicitPromotionRequested = false;
  let promotionFallbackTimer = null;

  function wait(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
  function withTimeout(promise, ms, label){
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label || 'timeout')), ms); })
    ]);
  }
  function timerActive(){
    try { if(typeof crono !== 'undefined' && ['running','paused'].includes(crono.state)) return true; } catch (_) {}
    return !!(root.document && root.document.body && root.document.body.classList.contains('crono-running'));
  }
  function toast(message){
    try { if(typeof root.showToast === 'function') root.showToast(message); } catch(error) {}
  }
  function updateBanner(){ return root.document && root.document.getElementById('swUpdateBanner'); }
  function hideBanner(){ const banner = updateBanner(); if(banner) banner.style.display = 'none'; }
  function showBanner(){ const banner = updateBanner(); if(banner) banner.style.display = 'flex'; }
  function buttonState(text, disabled){
    const banner = updateBanner();
    const button = banner && banner.querySelector('button');
    if(button){
      if(text != null) button.textContent = text;
      button.disabled = !!disabled;
    }
    return button;
  }
  function clearPromotionFallback(){
    if(promotionFallbackTimer) clearTimeout(promotionFallbackTimer);
    promotionFallbackTimer = null;
  }
  function armPromotionFallback(){
    clearPromotionFallback();
    promotionFallbackTimer = setTimeout(() => {
      promotionFallbackTimer = null;
      if(reloading) return;
      explicitPromotionRequested = false;
      showBanner();
      buttonState('Actualizar →', false);
      toast('La actualización no terminó de aplicarse. Puedes volver a intentarlo.');
    }, 12000);
  }

  function currentDbRaw(){
    try {
      if(typeof db !== 'undefined' && db) return JSON.stringify(db);
    } catch(error) {}
    try { return root.localStorage && root.localStorage.getItem(DB_KEY) || ''; }
    catch(error) { return ''; }
  }

  function sameDocumentContent(leftRaw, rightRaw){
    if(leftRaw === rightRaw) return true;
    if(!leftRaw || !rightRaw) return false;
    try {
      const left = JSON.parse(leftRaw);
      const right = JSON.parse(rightRaw);
      const core = root.DocumentSyncCore || (typeof DocumentSyncCore !== 'undefined' ? DocumentSyncCore : null);
      if(core && typeof core.sameContent === 'function') return core.sameContent(left, right);
      if(left && typeof left === 'object') { delete left._localRevision; delete left._savedAt; }
      if(right && typeof right === 'object') { delete right._localRevision; delete right._savedAt; }
      return JSON.stringify(left) === JSON.stringify(right);
    } catch(error) { return false; }
  }

  function memoryNeedsLocalSave(){
    let memoryRaw = '';
    try { if(typeof db !== 'undefined' && db) memoryRaw = JSON.stringify(db); } catch(error) {}
    if(!memoryRaw) return false;
    let diskRaw = '';
    try { diskRaw = root.localStorage && root.localStorage.getItem(DB_KEY) || ''; } catch(error) {}
    return !sameDocumentContent(memoryRaw, diskRaw);
  }

  function persistMemoryLocally(){
    // A no-op save increments the document revision and marks the complete
    // document dirty. Avoid another multi-megabyte upload during an update.
    if(!memoryNeedsLocalSave()) return true;
    try {
      if(typeof root.saveLocalNow === 'function') {
        root.saveLocalNow();
        return true;
      }
      if(typeof saveLocalNow === 'function') {
        saveLocalNow();
        return true;
      }
    } catch(error) {}
    try {
      if(typeof saveData === 'function') {
        saveData();
        return true;
      }
    } catch(error) {}
    return false;
  }

  function openRescueDb(){
    return new Promise((resolve, reject) => {
      if(!root.indexedDB) { resolve(null); return; }
      const request = root.indexedDB.open(RESCUE_DB, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if(!database.objectStoreNames.contains(RESCUE_STORE)) database.createObjectStore(RESCUE_STORE, { keyPath:'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexedDB open failed'));
      request.onblocked = () => reject(new Error('indexedDB blocked'));
    });
  }

  async function snapshotBeforeUpdate(){
    persistMemoryLocally();
    if (root.LocalSaveResilience?.flush) await root.LocalSaveResilience.flush();
    const raw = currentDbRaw();
    let durable = false;
    try { durable = sameDocumentContent(root.localStorage.getItem(DB_KEY), raw); } catch (_) {}
    if (!durable && root.LocalSaveResilience?.getRescueSnapshot) {
      const rescue = await root.LocalSaveResilience.getRescueSnapshot();
      durable = Boolean(rescue && sameDocumentContent(JSON.stringify(rescue.data), raw));
    }
    if (!durable) throw new Error('No durable local snapshot');
    if(!raw) throw new Error('No se pudo obtener el estado local');
    const stamp = new Date().toISOString();
    let snapshot;
    try {
      const parsed = JSON.parse(raw);
      snapshot = {
        id:'latest', capturedAt:stamp, raw,
        savedAt:parsed && parsed._savedAt || null,
        revision:Number(parsed && parsed._localRevision) || 0,
        sessionPlants:Array.isArray(parsed && parsed.sessionPlants) ? parsed.sessionPlants.length : 0,
        eventos:Array.isArray(parsed && parsed.eventos) ? parsed.eventos.length : 0,
      };
    } catch(error) {
      snapshot = { id:'latest', capturedAt:stamp, raw, savedAt:null, revision:0 };
    }

    try {
      const database = await withTimeout(openRescueDb(),2500,'indexedDB timeout');
      if(database){
        await new Promise((resolve, reject) => {
          const tx = database.transaction(RESCUE_STORE, 'readwrite');
          tx.objectStore(RESCUE_STORE).put(snapshot);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('snapshot failed'));
          tx.onabort = () => reject(tx.error || new Error('snapshot aborted'));
        });
        database.close();
        return snapshot;
      }
    } catch(error) {}

    /* Último recurso. Puede fallar por cuota; el estado principal ya está en
       localStorage y no lo sobreescribimos. */
    try {
      root.localStorage.setItem('alberto_pre_update_rescue_meta_v1', JSON.stringify({
        capturedAt:stamp, savedAt:snapshot.savedAt, revision:snapshot.revision,
        sessionPlants:snapshot.sessionPlants, eventos:snapshot.eventos
      }));
    } catch(error) {}
    return snapshot;
  }

  function syncMetaPending(){
    try {
      const meta = JSON.parse(root.localStorage.getItem(SYNC_KEY) || '{}') || {};
      return Number(meta.dirtyRevision || 0) > Number(meta.lastSyncedRevision || 0);
    } catch(error) { return false; }
  }

  function resiliencePending(){
    try {
      const api = root.LocalSaveResilience;
      if(!api) return false;
      const rescue = typeof api.hasPendingRescue === 'function' && api.hasPendingRescue();
      const meta = typeof api.hasPendingMeta === 'function' && api.hasPendingMeta();
      return !!(rescue || meta);
    } catch(error) { return true; }
  }

  async function syncEverything(){
    if(root.LocalSaveResilience && typeof root.LocalSaveResilience.retryMeta === 'function') {
      try { root.LocalSaveResilience.retryMeta(); } catch(error) {}
    }
    if(typeof root.enqueueCloudSync === 'function') {
      try { root.enqueueCloudSync({ immediate:true }); } catch(error) {}
    } else {
      try { if(typeof enqueueCloudSync === 'function') enqueueCloudSync({ immediate:true }); } catch(error) {}
    }

    const syncFn = typeof root.syncPendingCloudChanges === 'function'
      ? root.syncPendingCloudChanges
      : (typeof syncPendingCloudChanges === 'function' ? syncPendingCloudChanges : null);
    if(syncFn) await withTimeout(syncFn(), 8000, 'La sincronización no terminó a tiempo');

    if(root.CronoSaveResilience && typeof root.CronoSaveResilience.protectCloud === 'function') {
      await withTimeout(root.CronoSaveResilience.protectCloud(), 5000, 'No se pudo verificar el estudio reciente');
    }

    /* Da un pequeño margen a los metadatos de sincronización que se actualizan
       en microtareas separadas. */
    await wait(120);
    if(resiliencePending() || syncMetaPending()) {
      throw new Error('Quedan cambios locales pendientes de sincronizar');
    }
    return true;
  }

  async function waitingWorker(registration){
    if(!registration) return null;
    if(registration.waiting) return registration.waiting;
    const worker = registration.installing;
    if(!worker) return null;
    if(worker.state === 'installed') return registration.waiting || worker;
    await withTimeout(new Promise(resolve => {
        const check = () => {
          if(worker.state === 'installed' || worker.state === 'redundant') resolve();
        };
        worker.addEventListener('statechange', check);
        check();
      }), 9000, 'La actualización no terminó de descargarse');
    if(worker.state === 'redundant') throw new Error('No se pudo instalar la actualización');
    return registration.waiting || (worker.state === 'installed' ? worker : null);
  }

  async function checkForUpdate(){
    if(!root.navigator?.serviceWorker) throw new Error('Service worker no disponible');
    const registration = await root.navigator.serviceWorker.getRegistration();
    if(!registration) throw new Error('No hay actualización registrada');
    await withTimeout(registration.update(), 9000, 'No se pudo comprobar la nueva versión');
    const waiting = await waitingWorker(registration);
    return { registration, waiting };
  }

  async function safeUpdate(){
    if(updating) return false;
    if(timerActive()){
      toast('Hay un cronómetro activo. Termínalo antes de actualizar.');
      return false;
    }
    updating = true;
    explicitPromotionRequested = false;
    clearPromotionFallback();
    const button = buttonState('Protegiendo datos…', true);
    try {
      await snapshotBeforeUpdate();
      await syncEverything();
      if(button) button.textContent = 'Datos seguros · actualizando…';

      const { waiting } = await checkForUpdate();
      if(!waiting){
        hideBanner();
        toast('Datos seguros. No queda una versión en espera; al reabrir se comprobará de nuevo.');
        return true;
      }
      // Network checks may have yielded while the user entered more data.
      if (root.LocalSaveResilience?.flush) await root.LocalSaveResilience.flush();
      if (syncMetaPending() || resiliencePending() || timerActive()) throw new Error('State changed during update');
      if (!sameDocumentContent(root.localStorage.getItem(DB_KEY), currentDbRaw())) throw new Error('Unpersisted edits');
      explicitPromotionRequested = true;
      hideBanner();
      waiting.postMessage({ type:'SAFE_SKIP_WAITING', safe:true, requestedAt:new Date().toISOString() });
      armPromotionFallback();
      return true;
    } catch(error) {
      explicitPromotionRequested = false;
      clearPromotionFallback();
      console.warn('[update-safety] actualización cancelada', error);
      showBanner();
      toast('No se actualiza: tus datos todavía no están confirmados como seguros.');
      return false;
    } finally {
      updating = false;
      if(button){ button.disabled = false; button.textContent = 'Actualizar →'; }
    }
  }

  function install(){
    if(installed) return true;
    const current = root.swDoUpdate || (typeof swDoUpdate === 'function' ? swDoUpdate : null);
    if(typeof current !== 'function') return false;
    safeUpdate.__safeUpdateV2 = true;
    safeUpdate.__original = current;
    try { root.swDoUpdate = safeUpdate; } catch(error) {}
    try { swDoUpdate = safeUpdate; } catch(error) {}
    installed = true;
    root.navigator?.serviceWorker?.addEventListener?.('controllerchange', async () => {
      const explicit = explicitPromotionRequested;
      if (!controlled && !explicit) { controlled = true; return; }
      controlled = true;
      if (reloading) return;
      reloading = true;
      explicitPromotionRequested = false;
      clearPromotionFallback();
      try {
        await snapshotBeforeUpdate();
        hideBanner();
        root.location.reload();
      } catch (error) {
        reloading = false;
        showBanner();
        toast('Guarda los cambios antes de reabrir la actualización.');
      }
    });
    root.UpdateSafety = {
      version:4,
      safeUpdate,
      checkForUpdate,
      snapshotBeforeUpdate,
      syncEverything,
      syncMetaPending,
      resiliencePending,
    };
    return true;
  }

  function boot(attempt){
    if(install()) return;
    if(attempt < 100) root.setTimeout(() => boot(attempt + 1), 100);
  }
  boot(0);
})(typeof window !== 'undefined' ? window : globalThis);

/* Capa de persistencia para eventos manuales. */
(function loadEventDataProtection(){
  'use strict';
  if(window.EventDataProtection || document.getElementById('eventDataProtectionScript')) return;
  const script=document.createElement('script');
  script.id='eventDataProtectionScript';
  script.src='./event-data-protection.js?v=342';
  script.async=false;
  document.head.appendChild(script);
})();
