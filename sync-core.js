(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function normalizeMeta(meta) {
    const src = meta || {};
    const localRevision = Math.max(0, Number(src.localRevision) || 0);
    const lastSyncedRevision = Math.max(0, Number(src.lastSyncedRevision) || 0);
    return {
      localRevision,
      dirtyRevision: Math.max(localRevision, Number(src.dirtyRevision) || 0),
      lastSyncedRevision: Math.min(lastSyncedRevision, Math.max(localRevision, Number(src.dirtyRevision) || 0)),
    };
  }

  function markDirty(meta) {
    const current = normalizeMeta(meta);
    const revision = Math.max(current.localRevision, current.dirtyRevision, current.lastSyncedRevision) + 1;
    return { localRevision: revision, dirtyRevision: revision, lastSyncedRevision: current.lastSyncedRevision };
  }

  function markSynced(meta, revision) {
    const current = normalizeMeta(meta);
    const synced = Math.max(current.lastSyncedRevision, Number(revision) || 0);
    return Object.assign({}, current, { lastSyncedRevision: synced });
  }

  function isDirty(meta) {
    const current = normalizeMeta(meta);
    return current.dirtyRevision > current.lastSyncedRevision;
  }

  function dbRevision(db) {
    const value = Number(db && db._localRevision);
    return Number.isFinite(value) ? value : 0;
  }

  function dbSavedAt(db) {
    return String(db && db._savedAt || '');
  }

  // Positive => a is fresher; negative => b is fresher.
  function compareDbFreshness(a, b) {
    const aRev = dbRevision(a);
    const bRev = dbRevision(b);
    if (aRev !== bRev) return aRev > bRev ? 1 : -1;
    const aSaved = dbSavedAt(a);
    const bSaved = dbSavedAt(b);
    if (aSaved === bSaved) return 0;
    return aSaved.localeCompare(bSaved) > 0 ? 1 : -1;
  }

  function historyKey(item) {
    if (item == null) return '';
    if (typeof item !== 'object') return String(item);
    if (item.id) return 'id:' + item.id;
    const when = item.date || item.at || item.startedAt || item.endedAt || item.timestamp || '';
    const kind = item.context || item.tipo || item.type || item.momento || item.status || '';
    const value = item.val ?? item.value ?? item.score ?? item.compas ?? item.solDespues ?? '';
    const label = item.label || item.text || item.summary || '';
    if (when || kind || value !== '' || label) return [when, kind, value, label].join('|');
    try { return JSON.stringify(item); } catch (error) { return String(item); }
  }

  // Histories are additive. When the same observation exists on both sides,
  // the version from the fresher snapshot replaces the older copy.
  function mergeHistoryList(older, fresher) {
    const map = new Map();
    (older || []).forEach(item => {
      const key = historyKey(item);
      if (key) map.set(key, item);
    });
    (fresher || []).forEach(item => {
      const key = historyKey(item);
      if (key) map.set(key, item);
    });
    return Array.from(map.values());
  }

  const HISTORY_FIELDS = ['solHistory', 'escHistory', 'paseHistory', 'zoneHistory', 'compasHistory', 'workHistory', 'sesiones'];

  function mergeRepertoireNode(older, fresher) {
    if (!older) return fresher;
    if (!fresher) return older;
    const merged = Object.assign({}, older, fresher);
    HISTORY_FIELDS.forEach(field => {
      if (Array.isArray(older[field]) || Array.isArray(fresher[field])) {
        merged[field] = mergeHistoryList(older[field], fresher[field]);
      }
    });
    if (Array.isArray(fresher.movimientos)) merged.movimientos = mergeAuthoritativeChildren(older.movimientos, fresher.movimientos);
    if (Array.isArray(fresher.pasajes)) merged.pasajes = mergeAuthoritativeChildren(older.pasajes, fresher.pasajes);
    return merged;
  }

  // Membership is authoritative on the fresher snapshot. This is intentional:
  // a work deleted on the newest device must not be resurrected by an older one.
  function mergeAuthoritativeChildren(olderList, fresherList) {
    const olderById = new Map((olderList || []).filter(Boolean).map(item => [String(item.id || ''), item]));
    return (fresherList || []).filter(Boolean).map(item => {
      const id = String(item.id || '');
      return id && olderById.has(id) ? mergeRepertoireNode(olderById.get(id), item) : item;
    });
  }

  function mergeObrasFromFreshest(base, other) {
    const comparison = compareDbFreshness(base, other);
    const fresher = comparison >= 0 ? base : other;
    const older = fresher === base ? other : base;
    if (!Array.isArray(fresher && fresher.obras)) return Array.isArray(older && older.obras) ? older.obras : [];
    return mergeAuthoritativeChildren(older && older.obras, fresher.obras);
  }

  function mergeRepertoireIntoResult(base, other, merged) {
    const result = Object.assign({}, merged || {});
    result.obras = mergeObrasFromFreshest(base || {}, other || {});
    const maxRevision = Math.max(dbRevision(base), dbRevision(other));
    if (maxRevision) result._localRevision = maxRevision;
    const freshest = compareDbFreshness(base || {}, other || {}) >= 0 ? (base || {}) : (other || {});
    if (freshest._savedAt) result._savedAt = freshest._savedAt;
    return result;
  }

  function installRepertoireSync(dataCore) {
    if (!dataCore || typeof dataCore.mergeStudyHistory !== 'function') return false;
    if (dataCore.__repertoireSyncInstalled) return true;
    const originalMerge = dataCore.mergeStudyHistory;
    dataCore.mergeStudyHistory = function (base, other) {
      return mergeRepertoireIntoResult(base, other, originalMerge(base, other));
    };
    Object.defineProperty(dataCore, '__repertoireSyncInstalled', { value: true, configurable: true });
    return true;
  }

  return {
    normalizeMeta,
    markDirty,
    markSynced,
    isDirty,
    compareDbFreshness,
    mergeHistoryList,
    mergeObrasFromFreshest,
    mergeRepertoireIntoResult,
    installRepertoireSync
  };
});

// data-core.js is loaded immediately before this file in the app. Patch its
// merge at startup so the very first cloud/local reconciliation also includes
// repertoire metadata, not only sessions and habits.
if (typeof window !== 'undefined' && window.SyncCore && window.DataCore) {
  window.SyncCore.installRepertoireSync(window.DataCore);
}
