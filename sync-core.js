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

  return { normalizeMeta, markDirty, markSynced, isDirty };
});
