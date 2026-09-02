// Sincroniza la corrección manual de minutos del modal "Hecho" con el bloque permanente del cronómetro.
(function sessionMinutesCorrection(){
  'use strict';
  let lastFinished = null;
  let activePlantId = null;

  function database(){ try { return typeof db !== 'undefined' ? db : null; } catch(e){ return null; } }
  function showMinutesField(){
    const field = document.querySelector('#modalHechoDatos .hecho-minutes-field');
    if (field) field.classList.remove('hecho-advanced-only');
  }
  function correctedMinutes(){
    const input = document.getElementById('hechoMinutos');
    const value = Number(input && input.value);
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(480, Math.round(value))) : null;
  }
  function patchPlant(minutes){
    if (!activePlantId || !minutes) return false;
    const data = database();
    const plants = data && Array.isArray(data.sessionPlants) ? data.sessionPlants : [];
    const plant = plants.find(item => item && String(item.id) === String(activePlantId));
    if (!plant) return false;
    const previous = Number(plant.mins ?? plant.min ?? plant.minutes);
    if (!Number.isFinite(previous) || previous === minutes) return false;
    if (plant.originalMins == null) plant.originalMins = previous;
    plant.mins = minutes;
    const now = new Date().toISOString();
    plant.correctedAt = now;
    plant.updatedAt = now;
    plant.minuteCorrection = { from: previous, to: minutes, at: now, source: 'hecho-modal' };
    if (!Array.isArray(plant.minuteCorrections)) plant.minuteCorrections = [];
    plant.minuteCorrections.push(plant.minuteCorrection);
    plant.minuteCorrections = plant.minuteCorrections.slice(-10);
    return true;
  }

  const originalFinish = window.finishStudyBlock;
  if (typeof originalFinish === 'function' && !originalFinish.__minuteCorrectionWrapped) {
    const wrappedFinish = function(details){
      const result = originalFinish.apply(this, arguments);
      if (result && result.persisted && result.entry) {
        lastFinished = { id: result.entry.id, at: Date.now() };
      }
      return result;
    };
    wrappedFinish.__minuteCorrectionWrapped = true;
    window.finishStudyBlock = wrappedFinish;
  }

  const originalOpen = window.openHechoDatos;
  if (typeof originalOpen === 'function' && !originalOpen.__minuteCorrectionWrapped) {
    const wrappedOpen = function(planId, minPlan, opts){
      const result = originalOpen.apply(this, arguments);
      showMinutesField();
      activePlantId = null;
      if (opts && opts.subSession && lastFinished && Date.now() - lastFinished.at < 15000) {
        activePlantId = lastFinished.id;
      }
      return result;
    };
    wrappedOpen.__minuteCorrectionWrapped = true;
    window.openHechoDatos = wrappedOpen;
  }

  const originalClose = window.closeHechoDatos;
  if (typeof originalClose === 'function' && !originalClose.__minuteCorrectionWrapped) {
    const wrappedClose = function(save){
      const changed = save ? patchPlant(correctedMinutes()) : false;
      const result = originalClose.apply(this, arguments);
      if (changed && typeof window.saveData === 'function') {
        try { window.saveData(); } catch(e){}
      }
      activePlantId = null;
      return result;
    };
    wrappedClose.__minuteCorrectionWrapped = true;
    window.closeHechoDatos = wrappedClose;
  }

  // El editor "Horas" ya permitía modificar sesiones antiguas, pero esas
  // mutaciones no llevaban sello de versión. Ante dos dispositivos, una copia
  // vieja podía volver a ganar. Marcamos la edición ANTES de que la función
  // original llame a saveData(), de modo que minutos, obra/movimiento y hora
  // viajen en la misma escritura con prioridad de sincronización.
  const originalHistoricalSave = window.saveTimedStudyEdit;
  if (typeof originalHistoricalSave === 'function' && !originalHistoricalSave.__minuteCorrectionWrapped) {
    const wrappedHistoricalSave = function(source, index){
      const data = database();
      const list = source === 'forestPlants'
        ? (data && Array.isArray(data.forestPlants) ? data.forestPlants : [])
        : (data && Array.isArray(data.sessionPlants) ? data.sessionPlants : []);
      const plant = list[index];
      const form = document.getElementById('sesdet-edit-' + source + '-' + index);
      const minutesInput = form && form.querySelector('[data-field="minutes"]');
      const requested = Number(minutesInput && minutesInput.value);
      if (plant && form) {
        const previous = Number(plant.mins ?? plant.min ?? plant.minutes);
        const finalMinutes = Number.isFinite(requested) && requested > 0
          ? Math.max(1, Math.min(480, Math.round(requested)))
          : previous;
        const now = new Date().toISOString();
        plant.updatedAt = now;
        plant.historicalEdit = {
          at: now,
          source: 'sessions-by-hours',
          from: {
            mins: Number.isFinite(previous) ? previous : null,
            startedAt: plant.startedAt || null,
            obraId: plant.obraId || null,
            movId: plant.movId || null
          },
          requestedMinutes: Number.isFinite(finalMinutes) ? finalMinutes : null
        };
        if (Number.isFinite(previous) && Number.isFinite(finalMinutes) && previous !== finalMinutes) {
          if (plant.originalMins == null) plant.originalMins = previous;
          plant.correctedAt = now;
          plant.minuteCorrection = { from: previous, to: finalMinutes, at: now, source: 'sessions-by-hours' };
          if (!Array.isArray(plant.minuteCorrections)) plant.minuteCorrections = [];
          plant.minuteCorrections.push(plant.minuteCorrection);
          plant.minuteCorrections = plant.minuteCorrections.slice(-10);
        }
      }
      return originalHistoricalSave.apply(this, arguments);
    };
    wrappedHistoricalSave.__minuteCorrectionWrapped = true;
    window.saveTimedStudyEdit = wrappedHistoricalSave;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showMinutesField, {once:true});
  else showMinutesField();
})();
