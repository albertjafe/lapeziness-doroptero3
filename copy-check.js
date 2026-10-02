/* Comprobar una copia (02-10-2026).
 * Ajustes → «Recuperar datos de este dispositivo» → «Comprobar una copia…».
 * Lee un archivo guardado antes (copia completa nueva, «Descargar copia» del
 * rescate, «JSON completo» de Exportar para IA o la copia antigua de datos) y
 * lo compara con lo que la app tiene AHORA: lista cada registro (bloque de
 * estudio, obra, movimiento, objetivo, tarea, hábito, evento…) que está en la
 * copia y falta en la app. «Recuperar lo seleccionado» solo AÑADE esos
 * registros; nunca cambia ni borra nada, y no resucita lo que se borró a
 * propósito (bajas de la sincronización). La identidad de un registro es la
 * misma que usa la sincronización (DocumentSyncCore.identity). */
(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CopyCheckCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict';
  // Misma identidad que la sincronización (document-sync-core.js se carga antes).
  const identity = x => root.DocumentSyncCore.identity(x);
  const INTERNAL = new Set(['_fieldClock', '_deletedChildren', '_localRevision', '_savedAt']);
  const ROOT_TOMBSTONES = { eventos: ['planningEventTombstones', 'eventId'], cronoTasks: ['cronoTaskTombstones', 'taskId'], competitionPlans: ['competitionPlanTombstones', 'planId'] };
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const clone = x => JSON.parse(JSON.stringify(x));
  const MAX_DEPTH = 5;

  function looksLikeDoc(value) {
    return object(value) && (Array.isArray(value.sessionPlants) || Array.isArray(value.obras) || Array.isArray(value.sesiones) || object(value.germanStudy));
  }
  function asDoc(value, depth = 0) {
    if (depth > 3 || value == null) return null;
    let parsed = value;
    if (typeof parsed === 'string') {
      if (parsed.length < 20 || parsed.trim()[0] !== '{') return null;
      try { parsed = JSON.parse(parsed); } catch (error) { return null; }
    }
    if (!object(parsed)) return null;
    if (looksLikeDoc(parsed)) return parsed;
    for (const key of ['raw', 'data', 'doc', 'snapshot', 'value', 'rawData', 'memory']) {
      const inner = asDoc(parsed[key], depth + 1);
      if (inner) return inner;
    }
    return null;
  }

  // Todas las copias de estudio que contiene el archivo.
  function extractDocs(file) {
    const found = [];
    const add = (label, value) => { const doc = asDoc(value); if (doc && !found.some(x => x.doc === doc)) found.push({ label, doc }); };
    if (!object(file)) throw new Error('El archivo no es una copia de la app.');
    add('Datos en memoria al copiar', file.memory);
    add('Exportación «JSON completo»', file.rawData);
    if (object(file.data) && looksLikeDoc(file.data)) add('Copia de datos', file.data);
    if (object(file.localStorage)) Object.entries(file.localStorage).forEach(([key, value]) => add('Almacenamiento: ' + key, value));
    if (object(file.indexedDB)) Object.entries(file.indexedDB).forEach(([name, stores]) => {
      if (!object(stores)) return;
      Object.entries(stores).forEach(([store, content]) => {
        (Array.isArray(content && content.values) ? content.values : []).forEach((value, i) => add(`Copia interna ${name}/${store} #${i + 1}`, value));
      });
    });
    if (!found.length && looksLikeDoc(file)) found.push({ label: 'Copia', doc: file });
    if (!found.length) throw new Error('No encuentro datos de estudio en este archivo.');
    return found;
  }

  function tombstoned(currentRoot, parent, key, id, item) {
    if (parent && object(parent._deletedChildren) && object(parent._deletedChildren[key]) && parent._deletedChildren[key][id]) return true;
    const rule = parent === currentRoot && ROOT_TOMBSTONES[key];
    if (rule && Array.isArray(currentRoot[rule[0]])) {
      const target = String(item && item.id);
      return currentRoot[rule[0]].some(t => String(object(t) ? (t.id != null ? t.id : t[rule[1]]) : t) === target);
    }
    return false;
  }

  // Registros de la copia que faltan ahora. path: claves y {id} para entrar
  // en elementos de listas (p. ej. ['obras', {id:'id:w1'}, 'movimientos']).
  function diff(copy, current) {
    const out = [];
    const walk = (c, cur, path, parent, key, depth) => {
      if (depth > MAX_DEPTH) return;
      if (Array.isArray(c)) {
        if (!c.length || !c.every(object)) return;
        const curList = Array.isArray(cur) ? cur : [];
        const byId = new Map(curList.filter(object).map(x => [identity(x), x]));
        c.forEach(item => {
          const id = identity(item);
          const match = byId.get(id);
          // Sin id propio la identidad es el contenido: una edición parecería
          // un registro nuevo, así que esos solo se muestran.
          if (!match) out.push({ path, id, item, anonymous: !/^(id|run):/.test(id), tombstoned: tombstoned(current, parent, key, id, item) });
          else walk(item, match, path.concat([{ id }]), null, null, depth + 1);
        });
        return;
      }
      if (!object(c)) return;
      const curObj = object(cur) ? cur : {};
      Object.keys(c).forEach(k => {
        if (INTERNAL.has(k)) return;
        walk(c[k], curObj[k], path.concat([k]), curObj, k, depth + 1);
      });
    };
    walk(copy, current, [], null, null, 0);
    return out;
  }

  // Une lo que falta de todas las copias del archivo sin repetir registros.
  function compare(file, current) {
    const docs = extractDocs(file);
    const seen = new Map();
    docs.forEach(({ label, doc }) => diff(doc, current).forEach(entry => {
      const key = JSON.stringify(entry.path) + '|' + entry.id;
      if (!seen.has(key)) seen.set(key, Object.assign({ key, sources: [label] }, entry));
      else if (!seen.get(key).sources.includes(label)) seen.get(key).sources.push(label);
    }));
    return { copies: docs.map(d => d.label), missing: [...seen.values()] };
  }

  function resolve(rootDoc, path, create) {
    let node = rootDoc;
    for (let i = 0; i < path.length; i += 1) {
      const step = path[i];
      if (typeof step === 'string') {
        if (!object(node)) return null;
        if (node[step] === undefined && create) node[step] = i === path.length - 1 ? [] : {};
        node = node[step];
      } else {
        if (!Array.isArray(node)) return null;
        node = node.find(x => object(x) && identity(x) === step.id) || null;
      }
      if (node == null) return null;
    }
    return node;
  }

  // Añade los registros elegidos. Devuelve cuántos se añadieron.
  function restore(current, entries) {
    let added = 0;
    entries.forEach(entry => {
      if (entry.tombstoned || entry.anonymous) return;
      const list = resolve(current, entry.path, true);
      if (!Array.isArray(list) || list.some(x => object(x) && identity(x) === entry.id)) return;
      list.push(clone(entry.item));
      added += 1;
    });
    return added;
  }

  const AREA = {
    sessionPlants: 'Bloques de estudio', forestPlants: 'Bloques Forest', sesiones: 'Sesiones', obras: 'Obras', movimientos: 'Movimientos',
    eventos: 'Eventos del calendario', goals: 'Objetivos (hucha)', cronoTasks: 'Tareas', habitChallenges: 'Hábitos', dailyJournalEntries: 'Diario',
    materials: 'Material de alemán', reviews: 'Repasos de alemán', concursos: 'Concursos', registro: 'Registro', weeklyPlans: 'Planes semanales',
    solHistory: 'Historial de solidez', paseHistory: 'Pases', competitionPlans: 'Plan de concursos', cronoPasajes: 'Pasajes',
  };
  function area(entry) {
    const keys = entry.path.filter(step => typeof step === 'string');
    const last = keys[keys.length - 1] || '';
    if (keys[0] === 'germanStudy' && last === 'sessions') return 'Sesiones de alemán';
    if (AREA[last]) return AREA[last];
    if (/Eventos$/.test(last)) return 'Registro de ' + last.replace(/Eventos$/, '');
    return keys.join(' › ') || 'Datos';
  }
  function describe(entry) {
    const x = entry.item || {};
    const name = x.name || x.nombre || x.title || x.titulo || x.text || x.texto || '';
    const when = x.startedAt || x.at || x.date || x.fecha || x.createdAt || '';
    const mins = Number(x.mins != null ? x.mins : x.min);
    const parts = [];
    if (name) parts.push(String(name).slice(0, 80));
    if (x.amount != null) parts.push(x.amount + ' €');
    if (when) parts.push(String(when).slice(0, 16).replace('T', ' '));
    if (Number.isFinite(mins) && mins > 0) parts.push(mins + ' min');
    return parts.join(' · ') || String(entry.id).slice(0, 60);
  }
  function group(missing) {
    const groups = new Map();
    missing.forEach(entry => {
      const label = area(entry);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(entry);
    });
    return [...groups.entries()].map(([label, items]) => ({ label, items }));
  }

  return { extractDocs, diff, compare, restore, group, describe, area };
});

(function copyCheckView() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const C = window.CopyCheckCore;
  let result = null;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = id => document.getElementById(id);
  function currentDb() { try { return typeof db !== 'undefined' ? db : null; } catch (e) { return null; } }
  function say(text, kind) {
    const node = el('copyCheckFeedback');
    if (!node) return;
    node.style.display = text ? '' : 'none';
    node.textContent = text || '';
    node.dataset.kind = kind || '';
  }
  function render() {
    const host = el('copyCheckResult');
    if (!host) return;
    if (!result) { host.innerHTML = ''; return; }
    const groups = C.group(result.missing);
    if (!groups.length) {
      host.innerHTML = `<p class="copy-check-ok">✓ Todo lo que hay en la copia está en la app (${result.copies.length} copia${result.copies.length === 1 ? '' : 's'} revisada${result.copies.length === 1 ? '' : 's'}).</p>`;
      return;
    }
    const restorable = result.missing.filter(m => !m.tombstoned && !m.anonymous).length;
    host.innerHTML = `${groups.map((g, gi) => {
      const free = g.items.filter(m => !m.tombstoned && !m.anonymous);
      return `<section class="copy-check-group">
        <label class="copy-check-head"><input type="checkbox" data-group="${gi}" ${free.length ? 'checked' : 'disabled'}> <b>${esc(g.label)}</b> <span>${g.items.length} que faltan</span></label>
        <ul>${g.items.slice(0, 12).map(m => `<li${m.tombstoned ? ' class="is-deleted"' : ''}>${esc(C.describe(m))}${m.tombstoned ? ' <small>(borrado a propósito: no se recupera)</small>' : m.anonymous ? ' <small>(sin identificador: revísalo a mano)</small>' : ''}</li>`).join('')}${g.items.length > 12 ? `<li class="copy-check-more">y ${g.items.length - 12} más</li>` : ''}</ul>
      </section>`;
    }).join('')}
    ${restorable ? `<div class="st-actions"><button type="button" class="st-btn st-btn--primary" id="copyCheckRestore">Recuperar lo seleccionado</button></div>` : ''}`;
  }
  async function onFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    result = null; render();
    say('Comparando la copia con la app…', 'loading');
    try {
      const data = JSON.parse(await file.text());
      result = C.compare(data, currentDb() || {});
      const free = result.missing.filter(m => !m.tombstoned && !m.anonymous).length;
      say(result.missing.length
        ? `${result.missing.length} registro${result.missing.length === 1 ? '' : 's'} de la copia no está${result.missing.length === 1 ? '' : 'n'} en la app${free !== result.missing.length ? ` (${result.missing.length - free} no se recupera${result.missing.length - free === 1 ? '' : 'n'} solo${result.missing.length - free === 1 ? '' : 's'})` : ''}.`
        : 'No falta nada: la app tiene todo lo de la copia.', result.missing.length ? 'warn' : 'ok');
      render();
    } catch (error) {
      say('No se pudo leer la copia: ' + (error.message || error), 'error');
    } finally { input.value = ''; }
  }
  function onRestore() {
    if (!result) return;
    const groups = C.group(result.missing);
    const chosen = [];
    document.querySelectorAll('#copyCheckResult input[data-group]').forEach(box => {
      if (box.checked) chosen.push(...groups[Number(box.dataset.group)].items);
    });
    const current = currentDb();
    if (!current || !chosen.length) return;
    const added = C.restore(current, chosen);
    try { if (typeof saveData === 'function') saveData(); } catch (error) { console.error('[copy-check] no se pudo guardar', error); }
    try { if (typeof window.render === 'function') window.render(); } catch (error) {}
    say(`Recuperado${added === 1 ? '' : 's'} ${added} registro${added === 1 ? '' : 's'}. Se subirán a la nube con la próxima sincronización.`, 'ok');
    result = null;
    render();
  }
  function bind() {
    el('copyCheckFile')?.addEventListener('change', event => onFile(event.target));
    el('copyCheckResult')?.addEventListener('click', event => { if (event.target.id === 'copyCheckRestore') onRestore(); });
  }
  window.CopyCheck = { compare: data => C.compare(data, currentDb() || {}) };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', bind) : bind();
})();
