/* Actualizaciones de PWA: primero una copia local durable y verificable.
   La sincronización remota pendiente se conserva durante el cambio de versión. */
(function updateSafety(root){
  'use strict';

  const DB_KEY = 'alberto_piano_v2';
  const SYNC_KEY = 'alberto_sync_v1';
  const CRONO_STORAGE_KEY = 'pianoCrono_v2';
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

  function uncommittedTimerSnapshot(){
    let raw = '';
    try { raw = root.localStorage?.getItem(CRONO_STORAGE_KEY) || ''; } catch (_) {}
    if(!raw) return null;
    try {
      const snapshot = JSON.parse(raw);
      if(!snapshot || !snapshot.runId || !snapshot.obraId || !snapshot.startTs) return null;
      let current = null;
      try { if(typeof db !== 'undefined' && db) current = db; } catch (_) {}
      if(!current){
        try {
          const dbRaw = root.localStorage?.getItem(DB_KEY) || '';
          current = dbRaw ? JSON.parse(dbRaw) : null;
        } catch (_) {}
      }
      const plants = Array.isArray(current?.sessionPlants) ? current.sessionPlants : [];
      const alreadyCommitted = plants.some(plant => plant && (
        plant.runId === snapshot.runId ||
        plant.rid === snapshot.runId ||
        plant.id === 'run_' + snapshot.runId
      ));
      return alreadyCommitted ? null : snapshot;
    } catch (_) { return null; }
  }

  function timerActive(){
    if(root.GermanStudy?.hasActiveSession()) return true;
    // Also protect recovery before the Deutsch addon initializes (including update.html).
    try {
      const device = root.localStorage?.getItem('german_device_v1');
      const stored = JSON.parse(root.localStorage?.getItem(DB_KEY) || '{}');
      if(device && stored.germanStudy?.sessions?.some(s => s.deviceId === device && !s.endedAt)) return true;
    } catch (_) {}
    try { if(typeof crono !== 'undefined' && ['running','paused'].includes(crono.state)) return true; } catch (_) {}
    if(root.document?.getElementById('modalHechoDatos')?.classList?.contains('visible')) return true;
    if(uncommittedTimerSnapshot()) return true;
    return !!(root.document && root.document.body && root.document.body.classList.contains('crono-running'));
  }
  function toast(message){
    try { if(typeof root.showToast === 'function') root.showToast(message); } catch(error) {}
  }
  function updateBanner(){ return root.document && root.document.getElementById('swUpdateBanner'); }
  function bannerClass(on){
    try {
      root.document.body.classList.toggle('sw-banner-on', !!on);
      const banner = updateBanner();
      if(on && banner) root.document.documentElement.style.setProperty('--sw-banner-h', banner.offsetHeight + 'px');
    } catch(error) {}
  }
  function hideBanner(){ const banner = updateBanner(); if(banner) banner.style.display = 'none'; bannerClass(false); }
  function showBanner(){ const banner = updateBanner(); if(banner) banner.style.display = 'flex'; bannerClass(true); }
  /* El aviso vive en el propio banner: un toast de 2 s quedaba tapado por él
     en el móvil y no se llegaba a leer. */
  function bannerMessage(text, tone){
    const el = root.document && root.document.getElementById('swUpdateMsg');
    if(!el) return false;
    el.textContent = text || 'Nueva versión disponible';
    if(el.dataset) el.dataset.tone = tone || '';
    bannerClass(updateBanner()?.style?.display !== 'none');
    return true;
  }
  function notify(text, tone){
    showBanner();
    if(!bannerMessage(text, tone)) toast(text);
  }
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
      buttonState('Reintentar →', false);
      notify('La versión nueva no terminó de aplicarse. Tus datos están a salvo.', 'warn');
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

  async function hasDurableCopy(raw){
    let durable = false;
    try { durable = sameDocumentContent(root.localStorage.getItem(DB_KEY), raw); } catch (_) {}
    if (!durable && root.LocalSaveResilience?.getRescueSnapshot) {
      const rescue = await root.LocalSaveResilience.getRescueSnapshot();
      durable = Boolean(rescue && sameDocumentContent(JSON.stringify(rescue.data), raw));
    }
    return durable;
  }

  async function snapshotBeforeUpdate(){
    if(timerActive()) throw new Error('Timer finalization pending');
    persistMemoryLocally();
    if (root.LocalSaveResilience?.flush) await root.LocalSaveResilience.flush();
    if(timerActive()) throw new Error('Timer finalization pending');
    const raw = currentDbRaw();
    const durable = await hasDurableCopy(raw);
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

  function stageError(stage, error){
    const wrapped = error && typeof error === 'object' ? error : new Error(String(error));
    wrapped.stage = stage;
    return wrapped;
  }

  /* Deja la copia local al día y comprobada. Si mientras tanto llegan cambios
     (la sincronización que sigue en segundo plano fusiona datos de la nube),
     se vuelve a guardar en vez de abortar: lo que importa es que lo que hay en
     memoria esté en el dispositivo justo antes de recargar. */
  async function protectLocalCopy(attempts){
    let lastError = null;
    for(let attempt = 0; attempt < attempts; attempt += 1){
      try {
        const snapshot = await snapshotBeforeUpdate();
        if (root.LocalSaveResilience?.flush) await root.LocalSaveResilience.flush();
        if (timerActive()) throw new Error('Timer finalization pending');
        if (sameDocumentContent(snapshot.raw, currentDbRaw()) && await hasDurableCopy(currentDbRaw())) return snapshot;
        lastError = new Error('State changed during update');
      } catch(error) {
        lastError = error;
        if (timerActive()) break;
      }
      await wait(150);
    }
    throw stageError('local', lastError || new Error('No durable local snapshot'));
  }

  /* La nube tiene un margen corto: sus cambios pendientes quedan marcados en
     este dispositivo y se suben al reabrir, así que no hay que esperarla. */
  const CLOUD_BUDGET_MS = 4000;
  async function syncWithinBudget(){
    try { await withTimeout(syncEverything(), CLOUD_BUDGET_MS, 'nube lenta'); }
    catch(error) { console.warn('[update-safety] copia local protegida; nube pendiente', error); }
  }

  async function pendingWorker(){
    const registration = await root.navigator?.serviceWorker?.getRegistration?.();
    // Ya descargada: no hace falta volver a preguntar al servidor.
    if (registration && registration.waiting) return registration.waiting;
    try { return (await checkForUpdate()).waiting; }
    catch(error) { throw stageError('download', error); }
  }

  const FAILURE_TEXT = {
    local: 'No se pudo guardar la copia en este dispositivo, así que no actualizo. Vuelve a intentarlo en un momento.',
    download: 'No se pudo descargar la versión nueva (¿conexión?). Tus datos están a salvo.',
  };

  async function safeUpdate(){
    if(updating) return false;
    const pendingTimer = uncommittedTimerSnapshot();
    if(timerActive()){
      notify(pendingTimer
        ? 'Hay una sesión de estudio aún sin consolidar. No se actualizará hasta que quede guardada.'
        : root.GermanStudy?.hasActiveSession()
          ? 'Termina la sesión de Deutsch antes de actualizar. Tu progreso está guardado.'
          : 'Termina el cronómetro y guarda la píldora Hecho antes de actualizar.', 'warn');
      return false;
    }
    updating = true;
    explicitPromotionRequested = false;
    clearPromotionFallback();
    const button = buttonState('Guardando…', true);
    bannerMessage('Guardando tus datos en este dispositivo…');
    let failed = false;
    try {
      await protectLocalCopy(2);
      // Updating code does not remove local data. A remote outage must not
      // prevent installing the fix when the full current document is durable.
      // Keep dirty metadata intact so synchronization resumes after reopening.
      if(button) button.textContent = 'Subiendo…';
      bannerMessage('Copia local segura · subiendo a la nube…');
      await syncWithinBudget();

      if(button) button.textContent = 'Instalando…';
      bannerMessage('Copia local segura · instalando la versión nueva…');
      const waiting = await pendingWorker();
      if(!waiting){
        hideBanner();
        toast('Datos seguros. No queda una versión en espera; al reabrir se comprobará de nuevo.');
        return true;
      }
      // Justo antes de recargar: lo que haya en memoria, al dispositivo.
      await protectLocalCopy(3);
      explicitPromotionRequested = true;
      hideBanner();
      waiting.postMessage({ type:'SAFE_SKIP_WAITING', safe:true, requestedAt:new Date().toISOString() });
      armPromotionFallback();
      return true;
    } catch(error) {
      failed = true;
      explicitPromotionRequested = false;
      clearPromotionFallback();
      console.warn('[update-safety] actualización cancelada', error);
      const text = timerActive()
        ? 'Has empezado a estudiar: la actualización espera a que termines.'
        : FAILURE_TEXT[error && error.stage] || FAILURE_TEXT.local;
      notify(text, 'warn');
      return false;
    } finally {
      updating = false;
      if(button){ button.disabled = false; button.textContent = failed ? 'Reintentar →' : 'Actualizar →'; }
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
      controlled = true;
      // WebKit can occasionally hand control to a newly activated worker even
      // when this page never requested promotion. Never turn that unsolicited
      // controllerchange into a reload: the old page can keep running safely
      // and the new shell will load on the next normal reopen.
      if (!explicit) return;
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
        notify('Guarda los cambios antes de reabrir la actualización.', 'warn');
      }
    });
    root.UpdateSafety = {
      version:7,
      safeUpdate,
      checkForUpdate,
      snapshotBeforeUpdate,
      syncEverything,
      syncMetaPending,
      resiliencePending,
      hasUncommittedTimer:() => !!uncommittedTimerSnapshot(),
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
