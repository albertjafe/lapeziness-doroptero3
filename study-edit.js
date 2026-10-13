/* Quitar estudio y arreglar duplicados (oct 2026).

   1) Eliminar un tramo. Quitarlo de la lista no basta: la fusión nunca borra
      por ausencia, así que volvería desde la nube, el historial maestro
      (study_ledger) u otro dispositivo. Cada tramo quitado deja su lápida en
      `_deletedChildren` de la raíz (sessionPlants/forestPlants, la misma clave
      que usan DocumentSyncCore, el servidor y el historial maestro) y su copia
      en la sesión del día se corrige:
      - un registro manual (item `manual` con su planta) se quita, con lápida
        en `sesion._deletedChildren.items`;
      - un tramo del cronómetro se quita de su sub-sesión y la tarjeta del día
        se queda con los minutos que le quedan; si no le queda ninguno, se
        marca `deletedAt` y deja de contar (sin lápida: su identidad es la de
        cualquier tarjeta de esa obra ese día y bloquearía las siguientes).
   2) Copias fantasma de los registros manuales. Al rehacer la sesión de hoy
      desde la nube, un registro manual se convertía en una tarjeta del plan
      (`restored_…`, sin hora) y el autoguardado la escribía como estudio
      normal: los minutos contaban dos veces y, al corregir el registro, la
      copia seguía. `repairManualMirrors` las neutraliza (`mirrorOf`).

   Todo es puro sobre el documento: la app guarda y repinta. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudyEdit = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const PLANT_LISTS = ['sessionPlants', 'forestPlants'];
  const MANUAL_SOURCES = new Set(['manual', 'manual-recovery']);
  const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);

  function syncCore() {
    if (root.DocumentSyncCore) return root.DocumentSyncCore;
    try { return typeof DocumentSyncCore !== 'undefined' ? DocumentSyncCore : null; } catch (e) { return null; }
  }
  function minutesCore() {
    if (root.DailyStudyMinutes) return root.DailyStudyMinutes;
    try { return typeof DailyStudyMinutes !== 'undefined' ? DailyStudyMinutes : null; } catch (e) { return null; }
  }
  function identity(record) {
    const core = syncCore();
    if (core && typeof core.identity === 'function') return core.identity(record);
    return record && record.id != null ? 'id:' + record.id : JSON.stringify(record);
  }
  function tomb(owner, collection, record, stamp) {
    owner._deletedChildren = isObj(owner._deletedChildren) ? owner._deletedChildren : {};
    owner._deletedChildren[collection] = isObj(owner._deletedChildren[collection]) ? owner._deletedChildren[collection] : {};
    owner._deletedChildren[collection][identity(record)] = stamp;
  }

  const dayOf = value => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toDateString() : '';
  };
  const sameTarget = (a, b) => a && b && a.obraId === b.obraId && (a.movId || null) === (b.movId || null);
  const plantStart = p => p && (p.startedAt || p.endedAt);

  function duplicateKey(plant) {
    const core = minutesCore();
    if (core && typeof core.duplicatePlantKey === 'function') return core.duplicatePlantKey(plant);
    if (plant && plant.runId) return 'run::' + plant.runId;
    return [plant && plant.obraId, plant && plant.movId, plant && plant.startedAt, plant && plant.endedAt, plant && plant.mins].join('|');
  }
  function runBase(plant) {
    if (!plant) return '';
    if (plant.runId) return String(plant.runId).split('::passage::')[0];
    const id = String(plant.id || '');
    return id.startsWith('run_') ? id.slice(4) : '';
  }

  /* ── Copias fantasma de los registros manuales ─────────────────────── */
  function manualCounterpart(item, session, data) {
    const items = Array.isArray(session && session.items) ? session.items : [];
    const manualItem = items.find(m => m && m !== item && m.manual && sameTarget(m, item));
    if (manualItem) return manualItem.id || manualItem.studyPlantId || 'manual';
    const day = dayOf(session && session.date);
    for (const list of PLANT_LISTS) {
      const plant = (data && data[list] || []).find(p => p && MANUAL_SOURCES.has(p.source) && sameTarget(p, item) && dayOf(plantStart(p)) === day);
      if (plant) return plant.id || 'manual';
    }
    return '';
  }

  function isManualMirror(item, session, data) {
    if (!isObj(item) || item.manual || item.mirrorOf || item.deletedAt) return false;
    if (!/^restored_/.test(String(item._planId || ''))) return false;
    if (item.startedAt || item.endedAt) return false;
    return !!manualCounterpart(item, session, data);
  }

  function neutralize(item, fields, stamp) {
    Object.assign(item, fields, { estudiado: false, minutosReales: null, minutosPlan: null, updatedAt: stamp });
  }

  function repairManualMirrors(data, stamp, onlyDay) {
    const now = stamp || new Date().toISOString();
    let fixed = 0;
    (data && data.sesiones || []).forEach(session => {
      if (!session || !Array.isArray(session.items)) return;
      if (onlyDay && dayOf(session.date) !== onlyDay) return;
      session.items.forEach(item => {
        if (!isManualMirror(item, session, data)) return;
        neutralize(item, { mirrorOf: manualCounterpart(item, session, data) }, now);
        session.updatedAt = now;
        fixed++;
      });
    });
    return fixed;
  }

  // Lo que no es una tarjeta del plan en memoria: registros manuales, copias
  // neutralizadas y tarjetas cuyo estudio se quitó.
  function isHistoryOnlyItem(item) {
    return !!(item && (item.manual || item.mirrorOf || item.deletedAt));
  }

  /* ── Eliminar un tramo con hora (planta) ───────────────────────────── */
  function plantFamily(data, plant) {
    const key = duplicateKey(plant), base = runBase(plant), out = [];
    PLANT_LISTS.forEach(collection => (data[collection] || []).forEach(record => {
      if (!record) return;
      const same = record === plant || duplicateKey(record) === key ||
        (base && String(record.runId || '').startsWith(base + '::passage::'));
      if (same) out.push({ collection, record });
    }));
    return out;
  }

  function subsOf(session, planId) {
    const agg = session && isObj(session._aggregate) ? session._aggregate[planId] : null;
    return agg && Array.isArray(agg.subsessions) ? agg.subsessions : null;
  }

  function settleItem(item, subs, stamp) {
    const left = subs.reduce((sum, s) => sum + (Number(s && s.min) || 0), 0);
    if (left > 0) {
      item.minutosReales = left;
      item.minutosPlan = left;
      if (item.minutosEstudiados != null) item.minutosEstudiados = left;
      const timed = subs.filter(s => s && s.startedAt);
      if (timed.length) {
        item.startedAt = timed[0].startedAt;
        item.endedAt = timed[timed.length - 1].endedAt || timed[timed.length - 1].timestamp || item.endedAt || null;
      }
      item.updatedAt = stamp;
    } else {
      neutralize(item, { deletedAt: stamp }, stamp);
    }
    return left;
  }

  function removePlant(data, plant, stamp) {
    const now = stamp || new Date().toISOString();
    const family = plantFamily(data, plant);
    if (!family.length) return null;
    const snapshot = { kind: 'plant', plants: [], sessions: [], at: now };
    const touched = new Set();
    const keep = session => {
      if (touched.has(session)) return;
      touched.add(session);
      snapshot.sessions.push({ date: session.date, items: clone(session.items || []), aggregate: clone(session._aggregate) });
    };
    const ids = new Set(family.map(f => f.record.id).filter(Boolean));
    const starts = new Set(family.map(f => f.record.startedAt).filter(Boolean));
    const day = dayOf(plantStart(plant));

    family.forEach(({ collection, record }) => {
      const list = data[collection];
      const index = list.indexOf(record);
      if (index >= 0) list.splice(index, 1);
      tomb(data, collection, record, now);
      snapshot.plants.push({ collection, record: clone(record) });
    });

    (data.sesiones || []).forEach(session => {
      if (!session || !Array.isArray(session.items)) return;
      // 1) Registro manual enlazado a la planta: se quita con su lápida.
      const manualItems = session.items.filter(it => it && it.manual && (ids.has(it.studyPlantId) || ids.has(it.id)));
      if (manualItems.length) {
        keep(session);
        manualItems.forEach(it => {
          session.items.splice(session.items.indexOf(it), 1);
          tomb(session, 'items', it, now);
        });
        session.updatedAt = now;
      }
      // 2) Sub-sesión del cronómetro con la misma hora de inicio.
      Object.keys(isObj(session._aggregate) ? session._aggregate : {}).forEach(planId => {
        const subs = subsOf(session, planId);
        if (!subs) return;
        const hit = subs.filter(s => s && s.startedAt && starts.has(s.startedAt));
        if (!hit.length) return;
        keep(session);
        hit.forEach(s => subs.splice(subs.indexOf(s), 1));
        const item = session.items.find(it => it && it._planId === planId);
        if (item) settleItem(item, subs, now);
        session.updatedAt = now;
      });
      // 3) Tarjeta con la hora exacta del tramo y sin sub-sesiones (antiguas).
      if (dayOf(session.date) === day) {
        session.items.forEach(it => {
          if (!it || it.manual || it.deletedAt || !sameTarget(it, plant) || !it.startedAt || !starts.has(it.startedAt)) return;
          if (subsOf(session, it._planId)) return;
          keep(session);
          neutralize(it, { deletedAt: now }, now);
          session.updatedAt = now;
        });
        // La copia fantasma de un registro manual que ya no está.
        if (MANUAL_SOURCES.has(plant.source)) repairManualMirrors(data, now, day);
      }
    });
    return snapshot;
  }

  /* ── Eliminar una tarjeta sin tramo con hora ───────────────────────── */
  function removeItem(data, session, item, stamp) {
    const now = stamp || new Date().toISOString();
    if (!session || !Array.isArray(session.items) || session.items.indexOf(item) < 0) return null;
    const snapshot = { kind: 'item', plants: [], at: now,
      sessions: [{ date: session.date, items: clone(session.items), aggregate: clone(session._aggregate) }] };
    if (item.manual) {
      session.items.splice(session.items.indexOf(item), 1);
      tomb(session, 'items', item, now);
      // Su planta (si la tiene) también se va.
      const plantId = item.studyPlantId || item.id;
      PLANT_LISTS.forEach(collection => {
        const list = data[collection] || [];
        list.filter(p => p && plantId && p.id === plantId).forEach(p => {
          list.splice(list.indexOf(p), 1);
          tomb(data, collection, p, now);
          snapshot.plants.push({ collection, record: clone(p) });
        });
      });
      repairManualMirrors(data, now, dayOf(session.date));
    } else {
      neutralize(item, { deletedAt: now }, now);
    }
    session.updatedAt = now;
    return snapshot;
  }

  /* ── Deshacer ──────────────────────────────────────────────────────────
     Las lápidas son para siempre: lo que vuelve lleva una identidad nueva. */
  function undo(data, snapshot, stamp) {
    if (!snapshot) return false;
    const now = stamp || new Date().toISOString();
    const suffix = '_r' + Date.parse(now).toString(36);
    const idMap = {};
    snapshot.plants.forEach(({ collection, record }) => {
      const copy = clone(record);
      if (copy.id != null) { idMap[copy.id] = copy.id + suffix; copy.id = idMap[record.id]; }
      copy.updatedAt = now;
      if (!Array.isArray(data[collection])) data[collection] = [];
      data[collection].push(copy);
      data[collection].sort((a, b) => String(a && a.startedAt || '').localeCompare(String(b && b.startedAt || '')));
    });
    snapshot.sessions.forEach(saved => {
      const session = (data.sesiones || []).find(s => s && s.date === saved.date);
      if (!session) return;
      const tombs = session._deletedChildren && session._deletedChildren.items || {};
      session.items = saved.items.map(item => {
        const copy = clone(item);
        if (copy.manual && copy.id != null && tombs[identity(item)]) {
          copy.id = idMap[copy.id] || copy.id + suffix;
          if (copy.studyPlantId != null) copy.studyPlantId = idMap[copy.studyPlantId] || copy.id;
        }
        if (!copy.mirrorOf) copy.updatedAt = now;
        return copy;
      });
      if (saved.aggregate !== undefined) session._aggregate = clone(saved.aggregate);
      session.updatedAt = now;
    });
    return true;
  }

  /* ── En la app: tras cada descarga de la nube ─────────────────────── */
  function database() { try { return typeof db !== 'undefined' ? db : root.db; } catch (e) { return root.db; } }
  function run() {
    const data = database();
    if (!data || !Array.isArray(data.sesiones)) return 0;
    let n = 0;
    try { n = repairManualMirrors(data); } catch (e) { console.warn('[study-edit]', e); return 0; }
    if (!n) return 0;
    try { if (typeof root.saveData === 'function') root.saveData(); } catch (e) {}
    try { if (typeof root.refreshStudyViews === 'function') root.refreshStudyViews(); } catch (e) {}
    console.info('[study-edit] ' + n + ' copias de registros manuales dejan de contar dos veces');
    return n;
  }
  if (root.document && root.addEventListener) {
    root.addEventListener('study-cloud-hydrated', run);
    if (root.__studyCloudHydrated) setTimeout(run, 0);
  }

  return { identity, isManualMirror, repairManualMirrors, isHistoryOnlyItem, plantFamily, removePlant, removeItem, undo, run };
});
