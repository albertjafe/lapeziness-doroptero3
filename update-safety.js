/* Una actualización de la PWA no debe interrumpir un cronómetro ni adelantarse al guardado. */
(function updateSafety(){
  'use strict';
  let installed=false;

  function wait(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
  function withTimeout(promise,ms){ return Promise.race([Promise.resolve(promise),wait(ms)]); }
  function timerActive(){
    return !!(document.body && document.body.classList.contains('crono-running'));
  }

  function install(){
    if(installed || typeof swDoUpdate!=='function') return false;
    const original=swDoUpdate;
    const patched=async function(){
      if(timerActive()){
        try { if(typeof showToast==='function') showToast('Hay un cronómetro activo. Termínalo antes de actualizar para no cortar la sesión.'); } catch(e) {}
        return;
      }
      const banner=document.getElementById('swUpdateBanner');
      const button=banner && banner.querySelector('button');
      const previous=button && button.textContent;
      if(button){ button.disabled=true; button.textContent='Protegiendo datos…'; }
      try {
        if(window.LocalSaveResilience && typeof window.LocalSaveResilience.retryMeta==='function') {
          window.LocalSaveResilience.retryMeta();
        }
        if(typeof enqueueCloudSync==='function') {
          try { enqueueCloudSync({immediate:true}); } catch(e) {}
        }
        if(typeof syncPendingCloudChanges==='function') {
          try { await withTimeout(syncPendingCloudChanges(),2200); } catch(e) {}
        }
        if(window.CronoSaveResilience && typeof window.CronoSaveResilience.protectCloud==='function') {
          try { await withTimeout(window.CronoSaveResilience.protectCloud(),2600); } catch(e) {}
        }
      } finally {
        if(button){ button.disabled=false; button.textContent=previous||'Actualizar →'; }
      }
      return original.apply(this,arguments);
    };
    patched.__safeUpdate=true;
    try { swDoUpdate=patched; } catch(e) {}
    try { window.swDoUpdate=patched; } catch(e) {}
    installed=true;
    return true;
  }

  function boot(attempt){
    if(install()) return;
    if(attempt<80) setTimeout(()=>boot(attempt+1),100);
  }
  boot(0);
})();

/* Capa de persistencia para eventos manuales. Se carga desde un módulo global
   ya presente en todas las vistas para no depender del orden del modal. */
(function loadEventDataProtection(){
  'use strict';
  if(window.EventDataProtection || document.getElementById('eventDataProtectionScript')) return;
  const script=document.createElement('script');
  script.id='eventDataProtectionScript';
  script.src='./event-data-protection.js?v=1';
  script.async=false;
  document.head.appendChild(script);
})();
