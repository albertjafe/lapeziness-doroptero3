/* Protección anti-pérdida para eventos manuales.
   - Todo evento creado o editado por el usuario queda planningProtected.
   - Los eventos actuales no protegidos se migran una sola vez.
   - Una eliminación voluntaria genera tombstone para que el merge no lo resucite. */
(function eventDataProtection(){
  'use strict';

  const VERSION = 1;
  const MIGRATION_KEY = 'manual-event-protection-v1';
  let installed = false;
  let migrating = false;

  function ready(){
    try {
      return typeof db !== 'undefined' && db && Array.isArray(db.eventos)
        && typeof window.saveEvento === 'function'
        && typeof window.deleteEvento === 'function';
    } catch(error){ return false; }
  }

  function nowIso(){ return new Date().toISOString(); }

  function saveSafe(){
    try {
      if(typeof saveData === 'function') return saveData();
      if(typeof saveLocalNow === 'function') {
        const result = saveLocalNow();
        if(typeof enqueueCloudSync === 'function') enqueueCloudSync({ immediate:true });
        return result;
      }
    } catch(error){
      console.error('[event-protection] no se pudo guardar', error);
    }
    return false;
  }

  function ensureTombstone(id){
    if(!id) return false;
    if(!Array.isArray(db.planningEventTombstones)) db.planningEventTombstones = [];
    const key = String(id);
    if(db.planningEventTombstones.some(item => String(item) === key)) return false;
    db.planningEventTombstones.push(key);
    if(db.planningEventTombstones.length > 5000) db.planningEventTombstones = db.planningEventTombstones.slice(-5000);
    return true;
  }

  function removeTombstone(id){
    if(!id || !Array.isArray(db.planningEventTombstones)) return false;
    const key = String(id);
    const before = db.planningEventTombstones.length;
    db.planningEventTombstones = db.planningEventTombstones.filter(item => String(item) !== key);
    return db.planningEventTombstones.length !== before;
  }

  function protectEvent(ev, options){
    if(!ev || typeof ev !== 'object' || !ev.id) return false;
    const opts = options || {};
    const stamp = opts.stamp || nowIso();
    let changed = false;

    if(ev.planningProtected !== true){ ev.planningProtected = true; changed = true; }
    if(ev.dataProtection !== 'manual-event-v1'){ ev.dataProtection = 'manual-event-v1'; changed = true; }
    if(opts.manualSave && ev.manualSaved !== true){ ev.manualSaved = true; changed = true; }
    if(!ev.createdAt){ ev.createdAt = stamp; changed = true; }

    if(opts.touch){
      ev.updatedAt = stamp;
      ev.manualSavedAt = stamp;
      changed = true;
    }

    if(removeTombstone(ev.id)) changed = true;
    return changed;
  }

  function findSavedEvent(editId, beforeIds, formName, formDate){
    let ev = editId ? db.eventos.find(item => String(item && item.id) === String(editId)) : null;
    if(!ev && beforeIds) ev = db.eventos.find(item => item && !beforeIds.has(String(item.id))) || null;
    if(!ev && formName) {
      ev = [...db.eventos].reverse().find(item => item && String(item.nombre || '') === formName && String(item.fecha || '') === String(formDate || '')) || null;
    }
    return ev;
  }

  function patchSave(){
    const current = window.saveEvento;
    if(typeof current !== 'function' || current.__eventDataProtectionPatched) return false;

    const patched = function saveEventoProtected(){
      const editId = document.getElementById('eventoEditId')?.value || '';
      const beforeIds = new Set((db.eventos || []).map(ev => String(ev && ev.id)));
      const formName = document.getElementById('eventoNombre')?.value?.trim() || '';
      const formDate = document.getElementById('eventoFecha')?.value || '';

      const finalize = value => {
        const ev = findSavedEvent(editId, beforeIds, formName, formDate);
        if(ev && protectEvent(ev, { manualSave:true, touch:true })) saveSafe();
        return value;
      };

      const result = current.apply(this, arguments);
      if(result === false) return false;
      if(result && typeof result.then === 'function') return result.then(finalize);
      return finalize(result);
    };

    patched.__eventDataProtectionPatched = true;
    patched.__original = current;
    window.saveEvento = patched;
    try { saveEvento = patched; } catch(error) {}
    return true;
  }

  function patchDelete(){
    const current = window.deleteEvento;
    if(typeof current !== 'function' || current.__eventDataProtectionPatched) return false;

    const patched = function deleteEventoProtected(eventoId){
      const id = String(eventoId || '');
      const existed = (db.eventos || []).some(ev => ev && String(ev.id) === id);
      const result = current.apply(this, arguments);

      const finalize = value => {
        const stillExists = (db.eventos || []).some(ev => ev && String(ev.id) === id);
        if(existed && !stillExists){
          ensureTombstone(id);
          db.eventProtectionUpdatedAt = nowIso();
          saveSafe();
        }
        return value;
      };

      if(result && typeof result.then === 'function') return result.then(finalize);
      return finalize(result);
    };

    patched.__eventDataProtectionPatched = true;
    patched.__original = current;
    window.deleteEvento = patched;
    try { deleteEvento = patched; } catch(error) {}
    return true;
  }

  function migrateCurrentEvents(){
    if(migrating || !ready()) return false;
    if(db.eventProtectionMigration === MIGRATION_KEY) return false;
    migrating = true;
    try {
      const stamp = nowIso();
      let changed = false;
      (db.eventos || []).forEach(ev => {
        if(!ev || typeof ev !== 'object' || !ev.id) return;
        if(protectEvent(ev, { stamp })) changed = true;
      });
      db.eventProtectionMigration = MIGRATION_KEY;
      db.eventProtectionUpdatedAt = stamp;
      changed = true;
      if(changed) saveSafe();
      return changed;
    } finally {
      migrating = false;
    }
  }

  function install(){
    if(installed || !ready()) return false;

    /* EventPlanning envuelve saveEvento después del núcleo. Esperamos unos
       ticks si todavía no se ha instalado para quedar como capa exterior. */
    if(window.EventPlanning && typeof window.saveEvento === 'function') {
      patchSave();
      patchDelete();
      migrateCurrentEvents();
      installed = true;
      window.EventDataProtection = {
        version: VERSION,
        protectEvent,
        ensureTombstone,
        migrateCurrentEvents,
      };
      return true;
    }
    return false;
  }

  function boot(attempt){
    if(install()) return;
    if(attempt < 160) setTimeout(() => boot(attempt + 1), 100);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(0), { once:true });
  else boot(0);
})();
