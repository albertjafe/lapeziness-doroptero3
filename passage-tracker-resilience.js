/* Cierre robusto del cronómetro de pasajes.
   Parar el cronómetro maestro con un pasaje activo debe equivaler a parar
   primero el pasaje: cerramos el chunk, conservamos el draft y garantizamos
   que el resumen aparezca en el modal Hecho. También reenganchamos los hooks
   si otro módulo los reemplaza después durante el arranque. */
(function passageTrackerResilience(){
  'use strict';

  const VERSION = 1;
  const CHECK_MS = 180;
  let lastMasterState = '';
  let stoppingByResilience = false;

  function tracker(){ return window.PassageTracker || null; }
  function currentMasterState(){
    try { return (typeof crono !== 'undefined' && crono && crono.state) || 'idle'; }
    catch(error) { return 'idle'; }
  }

  function activeTimerButton(){
    return document.querySelector('.crono-passage-timer.is-active');
  }

  function stopActivePassage(){
    if (stoppingByResilience) return false;
    const button = activeTimerButton();
    if (!button || typeof button.click !== 'function') return false;
    stoppingByResilience = true;
    try { button.click(); return true; }
    catch(error) { return false; }
    finally { stoppingByResilience = false; }
  }

  function formatMs(ms){
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h) return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }

  function ensureSummarySection(){
    let section = document.getElementById('hechoPassageSummary');
    if (section) return section;
    const body = document.querySelector('#modalHechoDatos .hecho-modal-body');
    if (!body) return null;
    section = document.createElement('section');
    section.id = 'hechoPassageSummary';
    section.className = 'hecho-passage-summary';
    section.hidden = true;
    const advanced = document.getElementById('hechoAdvancedToggle');
    if (advanced && advanced.parentElement === body) body.insertBefore(section, advanced);
    else body.appendChild(section);
    return section;
  }

  function passageMap(){
    const api = tracker();
    const data = api && typeof api.getTracker === 'function' ? api.getTracker() : null;
    const map = new Map();
    (data && data.passages || []).forEach(item => { if (item && item.id) map.set(String(item.id), item); });
    return map;
  }

  function touchedEntries(){
    const api = tracker();
    const draft = api && typeof api.getDraft === 'function' ? api.getDraft() : null;
    if (!draft || !draft.entries) return [];
    return Object.values(draft.entries).filter(entry => entry && (
      entry.ratingTouched || Number(entry.focusedMs) > 0 || (entry.chunks && entry.chunks.length)
    ));
  }

  function renderHechoSummary(){
    const section = ensureSummarySection();
    if (!section) return false;
    const entries = touchedEntries();
    if (!entries.length) {
      section.hidden = true;
      section.replaceChildren();
      return false;
    }

    const passages = passageMap();
    section.hidden = false;
    section.replaceChildren();

    const label = document.createElement('div');
    label.className = 'hecho-passage-summary-label';
    label.textContent = 'PASAJES MEDIDOS';
    section.appendChild(label);

    entries.forEach(entry => {
      const passage = passages.get(String(entry.passageId));
      const row = document.createElement('div');
      row.className = 'hecho-passage-summary-row';
      const name = document.createElement('span');
      name.textContent = passage && passage.name ? passage.name : 'Pasaje';
      const detail = document.createElement('strong');
      const scores = entry.postScore != null
        ? ((entry.coldScore != null ? entry.coldScore : '—') + '→' + entry.postScore)
        : (entry.coldScore != null ? 'frío ' + entry.coldScore : 'sin medida');
      detail.textContent = formatMs(entry.focusedMs) + ' · ' + scores;
      row.append(name, detail);
      section.appendChild(row);
    });

    const note = document.createElement('small');
    note.textContent = 'El tiempo del pasaje está incluido dentro del cronómetro maestro; no se suma dos veces.';
    section.appendChild(note);
    return true;
  }

  function scheduleSummary(){
    const draw = () => { try { renderHechoSummary(); } catch(error) {} };
    if (typeof queueMicrotask === 'function') queueMicrotask(draw);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(draw);
    [0, 60, 180, 420].forEach(delay => setTimeout(draw, delay));
  }

  function commitDraft(){
    const api = tracker();
    if (!api || typeof api.commitDraft !== 'function') return [];
    try { return api.commitDraft() || []; } catch(error) { return []; }
  }

  function resetDraft(){
    const api = tracker();
    if (!api || typeof api.resetDraft !== 'function') return;
    try { api.resetDraft(); } catch(error) {}
  }

  function installFinishHook(){
    const current = window.cronoFinish;
    if (typeof current !== 'function' || current.__passageTrackerResilienceV1) return false;
    const wrapped = function cronoFinishWithPassageResilience(){
      // Importante: cerrar el subcronómetro ANTES de que el maestro cambie a
      // idle y reconstruya la interfaz. Así no se pierde el último chunk.
      stopActivePassage();
      const result = current.apply(this, arguments);
      const after = value => { scheduleSummary(); return value; };
      if (result && typeof result.then === 'function') return result.then(after, error => { scheduleSummary(); throw error; });
      return after(result);
    };
    wrapped.__passageTrackerResilienceV1 = true;
    wrapped.__original = current;
    try { window.cronoFinish = wrapped; } catch(error) {}
    try { cronoFinish = wrapped; } catch(error) {}
    return true;
  }

  function installHechoHook(){
    const current = window.closeHechoDatos;
    if (typeof current !== 'function' || current.__passageTrackerResilienceV1) return false;
    const wrapped = function closeHechoWithPassageResilience(save){
      const shouldSave = save === true;
      if (shouldSave) {
        stopActivePassage();
        // commitDraft es idempotente. Si el wrapper original del tracker sigue
        // presente, su segunda llamada será un no-op seguro.
        commitDraft();
      }
      const result = current.apply(this, arguments);
      const after = value => {
        if (shouldSave) resetDraft();
        return value;
      };
      if (result && typeof result.then === 'function') return result.then(after, error => { if (shouldSave) resetDraft(); throw error; });
      return after(result);
    };
    wrapped.__passageTrackerResilienceV1 = true;
    wrapped.__original = current;
    try { window.closeHechoDatos = wrapped; } catch(error) {}
    try { closeHechoDatos = wrapped; } catch(error) {}
    return true;
  }

  function monitor(){
    installFinishHook();
    installHechoHook();

    const state = currentMasterState();
    // Fallback para cualquier ruta que cambie el estado sin pasar por el hook.
    if ((lastMasterState === 'running' && state !== 'running') || (state !== 'running' && activeTimerButton())) {
      stopActivePassage();
      scheduleSummary();
    }
    lastMasterState = state;
  }

  function boot(attempt){
    if (!tracker() && attempt < 80) { setTimeout(() => boot(attempt + 1), 100); return; }
    lastMasterState = currentMasterState();
    monitor();
    setInterval(monitor, CHECK_MS);
  }

  window.PassageTrackerResilience = {
    version: VERSION,
    stopActivePassage,
    renderHechoSummary,
    scheduleSummary,
    installFinishHook,
    installHechoHook,
  };

  boot(0);
}());
