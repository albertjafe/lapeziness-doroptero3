/* Selección explícita de movimientos dentro del repertorio de eventos.
   Una obra marcada incluye todos sus movimientos por defecto; el usuario puede
   dejar solo uno o varios. Las obras antiguas sin detalle se leen como obra completa. */
(function eventMovementSelector(root) {
  'use strict';

  const VERSION = 2;
  const HOST_ID = 'obraCheckList';
  const MODAL_ID = 'modalAddEvento';
  const EDIT_ID = 'eventoEditId';
  let draft = Object.create(null);
  let activeEventId = '';
  let installTimer = null;
  let observer = null;
  let boundHost = null;

  const arr = value => Array.isArray(value) ? value : [];
  const id = value => value == null ? '' : String(value);
  const uniq = values => Array.from(new Set(arr(values).map(id).filter(Boolean)));
  const safeDb = () => { try { return typeof db !== 'undefined' && db ? db : null; } catch (_) { return null; } };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[ch]);
  }

  function host() { return document.getElementById(HOST_ID); }
  function workById(workId) {
    const database = safeDb();
    return database ? arr(database.obras).find(work => id(work && work.id) === id(workId)) || null : null;
  }
  function movementList(work) { return arr(work && work.movimientos).filter(Boolean); }
  function movementId(movement) { return id(movement && (movement.id ?? movement.movId ?? movement.movimientoId)); }
  function movementName(movement, index) {
    return movement && (movement.name || movement.nombre || movement.title || movement.titulo) || `Movimiento ${index + 1}`;
  }
  function parentCheckboxes() {
    const node = host();
    if (!node) return [];
    return Array.from(node.querySelectorAll('.obra-check-item input[type="checkbox"], input[type="checkbox"]'))
      .filter((checkbox, index, all) => all.indexOf(checkbox) === index && !checkbox.closest('.event-movement-options'));
  }
  function workIdForCheckbox(checkbox) {
    return id(checkbox && (checkbox.value || checkbox.dataset.obraId || checkbox.closest('.obra-check-item')?.dataset.obraId));
  }
  function checkboxForWork(workId) {
    return parentCheckboxes().find(checkbox => workIdForCheckbox(checkbox) === id(workId)) || null;
  }
  function selectedWorkIds() {
    return parentCheckboxes().filter(checkbox => checkbox.checked).map(workIdForCheckbox).filter(Boolean);
  }

  function allMovementIds(work) {
    return movementList(work).map(movementId).filter(Boolean);
  }

  function relationMovementIds(event, workId) {
    return uniq(arr(event && event.repertorioPlanificado)
      .filter(rel => rel && id(rel.obraId) === id(workId) && rel.movimientoId != null)
      .map(rel => rel.movimientoId));
  }

  function eventMovementIds(event, workId, work) {
    const allowed = new Set(allMovementIds(work));
    if (!allowed.size) return [];
    const maps = [event && event.professorMovements, event && event.movimientosObjetivo];
    for (const map of maps) {
      if (!map || typeof map !== 'object') continue;
      const raw = map[id(workId)] ?? map[workId];
      if (Array.isArray(raw) && raw.length) {
        const clean = uniq(raw).filter(value => allowed.has(value));
        if (clean.length) return clean;
      }
    }
    const relations = relationMovementIds(event, workId).filter(value => allowed.has(value));
    if (relations.length) return relations;
    // Backward compatibility: historically a selected work without movement
    // detail meant the complete work.
    return allMovementIds(work);
  }

  function resetDraft(event) {
    draft = Object.create(null);
    activeEventId = id(event && event.id);
    const selected = new Set(arr(event && event.obras).map(id));
    selected.forEach(workId => {
      const work = workById(workId);
      const all = allMovementIds(work);
      if (all.length) draft[workId] = eventMovementIds(event, workId, work);
    });
  }

  function ensureDraftForCheckedWorks() {
    selectedWorkIds().forEach(workId => {
      const work = workById(workId);
      const all = allMovementIds(work);
      if (!all.length) return;
      if (!Array.isArray(draft[workId]) || !draft[workId].length) draft[workId] = all;
      else draft[workId] = uniq(draft[workId]).filter(value => all.includes(value));
      if (!draft[workId].length) draft[workId] = all;
    });
  }

  function injectStyles() {
    if (document.getElementById('eventMovementSelectorStyles')) return;
    const style = document.createElement('style');
    style.id = 'eventMovementSelectorStyles';
    style.textContent = `
      .obra-check-item .event-movement-options{display:flex;flex-wrap:wrap;gap:7px;width:100%;padding:8px 0 2px 30px}
      .event-movement-option{appearance:none;border:1px solid var(--border);background:var(--bg2);color:var(--text2);border-radius:999px;padding:7px 10px;font:600 11px/1.2 inherit;display:inline-flex;align-items:center;gap:6px;cursor:pointer;transition:.15s ease}
      .event-movement-option::before{content:'✓';display:grid;place-items:center;width:15px;height:15px;border-radius:50%;border:1px solid currentColor;font-size:9px;opacity:.45}
      .event-movement-option[aria-pressed="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--bg2));color:var(--accent)}
      .event-movement-option[aria-pressed="true"]::before{opacity:1;background:var(--accent);color:var(--bg);border-color:var(--accent)}
      .event-movement-summary{width:100%;font-size:10px;color:var(--text3);margin-top:1px}
      @media(max-width:700px){.obra-check-item .event-movement-options{padding-left:24px}.event-movement-option{padding:7px 9px}}
    `;
    document.head.appendChild(style);
  }

  function renderWorkRow(checkbox) {
    const workId = workIdForCheckbox(checkbox);
    if (!workId) return;
    const work = workById(workId);
    const movements = movementList(work);
    const row = checkbox.closest('.obra-check-item') || checkbox.parentElement;
    if (!row) return;
    row.querySelector('.event-movement-options')?.remove();
    checkbox.indeterminate = false;
    if (!movements.length || !checkbox.checked) return;

    const allIds = allMovementIds(work);
    let chosen = uniq(draft[workId]).filter(value => allIds.includes(value));
    if (!chosen.length) chosen = allIds.slice();
    draft[workId] = chosen;
    const chosenSet = new Set(chosen);
    checkbox.indeterminate = chosen.length > 0 && chosen.length < allIds.length;

    const options = document.createElement('div');
    options.className = 'event-movement-options';
    options.dataset.workId = workId;
    options.innerHTML = movements.map((movement, index) => {
      const movId = movementId(movement);
      const active = chosenSet.has(movId);
      return `<button type="button" class="event-movement-option" data-event-movement="${esc(movId)}" aria-pressed="${active ? 'true' : 'false'}"><span>${esc(movementName(movement, index))}</span></button>`;
    }).join('') + `<div class="event-movement-summary">${chosen.length === allIds.length ? 'Obra completa · puedes desmarcar movimientos' : `${chosen.length} de ${allIds.length} movimientos incluidos`}</div>`;
    row.appendChild(options);
  }

  function render() {
    injectStyles();
    ensureDraftForCheckedWorks();
    parentCheckboxes().forEach(renderWorkRow);
  }

  function onHostChange(event) {
    const checkbox = event.target;
    if (!checkbox || checkbox.type !== 'checkbox' || checkbox.closest('.event-movement-options')) return;
    const workId = workIdForCheckbox(checkbox);
    if (!workId) return;
    if (checkbox.checked) {
      const all = allMovementIds(workById(workId));
      if (all.length) draft[workId] = all;
    } else {
      delete draft[workId];
    }
    render();
  }

  function onHostClick(event) {
    const button = event.target && event.target.closest && event.target.closest('[data-event-movement]');
    if (!button) return;
    // Los botones viven dentro de un <label>. Sin cancelar su acción por
    // defecto, Safari/Chromium alternan también el checkbox padre al soltar,
    // vaciando el repertorio aunque queden movimientos seleccionados.
    event.preventDefault();
    event.stopPropagation();
    const group = button.closest('.event-movement-options');
    const workId = id(group && group.dataset.workId);
    const movId = id(button.dataset.eventMovement);
    if (!workId || !movId) return;
    const checkbox = checkboxForWork(workId);
    const work = workById(workId);
    const all = allMovementIds(work);
    const current = new Set(uniq(draft[workId]).filter(value => all.includes(value)));
    if (current.has(movId)) current.delete(movId); else current.add(movId);
    if (!current.size) {
      delete draft[workId];
      if (checkbox) { checkbox.checked = false; checkbox.indeterminate = false; }
    } else {
      draft[workId] = Array.from(current);
      if (checkbox) checkbox.checked = true;
    }
    render();
    // Keep the existing repertoire search/count UI in sync with parent works.
    try { root.EventRepertoirePicker?.applyFilter?.(); } catch (_) {}
  }

  function bindHost() {
    const node = host();
    if (!node) return false;
    if (boundHost !== node) {
      if (boundHost) {
        boundHost.removeEventListener('change', onHostChange);
        boundHost.removeEventListener('click', onHostClick);
      }
      boundHost = node;
      node.addEventListener('change', onHostChange);
      node.addEventListener('click', onHostClick);
      observer?.disconnect();
      observer = new MutationObserver(() => render());
      observer.observe(node, { childList:true, subtree:false });
    }
    return true;
  }

  function modalEvent() {
    const database = safeDb();
    const editId = id(document.getElementById(EDIT_ID)?.value || activeEventId);
    return database && editId ? arr(database.eventos).find(event => id(event && event.id) === editId) || null : null;
  }

  function afterOpen(event) {
    resetDraft(event || modalEvent());
    requestAnimationFrame(() => { bindHost(); render(); });
    setTimeout(() => { bindHost(); render(); }, 80);
  }

  function selectedSnapshot() {
    const snapshot = Object.create(null);
    selectedWorkIds().forEach(workId => {
      const all = allMovementIds(workById(workId));
      if (!all.length) return;
      const chosen = uniq(draft[workId]).filter(value => all.includes(value));
      snapshot[workId] = chosen.length ? chosen : all;
    });
    return snapshot;
  }

  function rebuildRelations(event, snapshot) {
    const old = arr(event.repertorioPlanificado).filter(Boolean);
    const output = [];
    arr(event.obras).map(id).filter(Boolean).forEach(workId => {
      const work = workById(workId);
      const all = allMovementIds(work);
      const generic = old.find(rel => id(rel.obraId) === workId && rel.movimientoId == null)
        || old.find(rel => id(rel.obraId) === workId) || {};
      if (!all.length) {
        output.push(Object.assign({}, generic, { obraId:workId, movimientoId:null }));
        return;
      }
      const chosen = uniq(snapshot[workId]).filter(value => all.includes(value));
      (chosen.length ? chosen : all).forEach(movId => {
        const exact = old.find(rel => id(rel.obraId) === workId && id(rel.movimientoId) === movId) || generic;
        output.push(Object.assign({}, exact, { obraId:workId, movimientoId:movId }));
      });
    });
    event.repertorioPlanificado = output;
  }

  function applySnapshot(event, snapshot) {
    if (!event) return false;
    const selectedWorks = new Set(arr(event.obras).map(id));
    const normalized = Object.create(null);
    Object.entries(snapshot || {}).forEach(([workId, movementIds]) => {
      if (!selectedWorks.has(id(workId))) return;
      const all = allMovementIds(workById(workId));
      const chosen = uniq(movementIds).filter(value => all.includes(value));
      if (all.length && chosen.length) normalized[id(workId)] = chosen;
    });
    event.professorMovements = JSON.parse(JSON.stringify(normalized));
    event.movimientosObjetivo = JSON.parse(JSON.stringify(normalized));
    rebuildRelations(event, normalized);

    // Competition milestones already mirror the parent's repertoire. Keep the
    // new movement-level contract in that mirror as well.
    if (event.planSourceId && !event.esHito) {
      const database = safeDb();
      arr(database && database.eventos).filter(child => child && child.esHito && child.parentSourceId === event.planSourceId).forEach(child => {
        child.obras = arr(event.obras).slice();
        child.professorMovements = JSON.parse(JSON.stringify(normalized));
        child.movimientosObjetivo = JSON.parse(JSON.stringify(normalized));
        child.repertorioPlanificado = arr(event.repertorioPlanificado).map(rel => Object.assign({}, rel));
      });
    }
    event.updatedAt = new Date().toISOString();
    try {
      if (typeof root.saveData === 'function') root.saveData();
      else if (typeof root.saveLocalNow === 'function') root.saveLocalNow();
    } catch (error) { console.warn('[event-movement-selector] no se pudo persistir', error); }
    return true;
  }

  function wrapFunctions() {
    let changed = false;
    if (typeof root.openAddEvento === 'function' && !root.openAddEvento.__eventMovementSelectorWrapped) {
      const original = root.openAddEvento;
      const wrapped = function () {
        activeEventId = '';
        draft = Object.create(null);
        const result = original.apply(this, arguments);
        afterOpen(null);
        return result;
      };
      wrapped.__eventMovementSelectorWrapped = true;
      wrapped.__original = original;
      root.openAddEvento = wrapped;
      changed = true;
    }
    if (typeof root.openEditEvento === 'function' && !root.openEditEvento.__eventMovementSelectorWrapped) {
      const original = root.openEditEvento;
      const wrapped = function (eventId) {
        const database = safeDb();
        const event = database ? arr(database.eventos).find(item => id(item && item.id) === id(eventId)) || null : null;
        const result = original.apply(this, arguments);
        afterOpen(event);
        return result;
      };
      wrapped.__eventMovementSelectorWrapped = true;
      wrapped.__original = original;
      root.openEditEvento = wrapped;
      changed = true;
    }
    if (typeof root.saveEvento === 'function' && !root.saveEvento.__eventMovementSelectorWrapped) {
      const original = root.saveEvento;
      const wrapped = function () {
        const database = safeDb();
        const editId = id(document.getElementById(EDIT_ID)?.value || activeEventId);
        const beforeIds = new Set(arr(database && database.eventos).map(event => id(event && event.id)));
        const snapshot = selectedSnapshot();
        const result = original.apply(this, arguments);
        const finalize = () => {
          const currentDb = safeDb();
          if (!currentDb) return;
          let event = editId ? arr(currentDb.eventos).find(item => id(item && item.id) === editId) || null : null;
          if (!event) event = arr(currentDb.eventos).find(item => !beforeIds.has(id(item && item.id))) || null;
          if (event) applySnapshot(event, snapshot);
        };
        if (result && typeof result.then === 'function') result.then(() => finalize()).catch(() => {});
        else setTimeout(finalize, 0);
        return result;
      };
      wrapped.__eventMovementSelectorWrapped = true;
      wrapped.__original = original;
      root.saveEvento = wrapped;
      changed = true;
    }
    return changed;
  }

  function install() {
    injectStyles();
    bindHost();
    wrapFunctions();
    render();
    return typeof root.EventPlanning !== 'undefined' && typeof root.saveEvento === 'function';
  }

  function boot() {
    clearInterval(installTimer);
    let stable = 0;
    installTimer = setInterval(() => {
      const ready = install();
      // Keep checking briefly after EventPlanning appears so this wrapper ends
      // up outside any late event-planning wrappers.
      if (ready) stable += 1; else stable = 0;
      if (stable >= 8) clearInterval(installTimer);
    }, 200);
    install();
  }

  root.EventMovementSelector = {
    version: VERSION,
    render,
    getDraft: () => JSON.parse(JSON.stringify(draft)),
    applySnapshot,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
}(window));
