(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaskSyncBootstrap = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DB_KEY = 'alberto_piano_v2';
  const SYNC_KEY = 'alberto_sync_v1';
  const RESCUE_KEY = 'alberto_crono_tasks_rescue_v1';
  const MAX_SNAPSHOTS = 8;

  const arr = value => Array.isArray(value) ? value : [];
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const parseJson = value => { try { return JSON.parse(value || 'null'); } catch (error) { return null; } };
  const timeMs = value => {
    if (!value) return 0;
    const n = Number(value);
    if (Number.isFinite(n) && n > 1000000000000) return n;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  function taskTimeMs(task) {
    if (!task || typeof task !== 'object') return 0;
    const candidates = [task.updatedAt, task.createdAt, task.completedAt, task.doneAt, task.endedAt, task.endTime, task.at, task.date];
    let best = candidates.reduce((max, value) => Math.max(max, timeMs(value)), 0);
    const match = String(task.id || '').match(/(\d{13})/);
    if (match) best = Math.max(best, Number(match[1]) || 0);
    return best;
  }

  function maxRevision(data, sync) {
    return Math.max(
      num(data && data._localRevision),
      num(sync && sync.localRevision),
      num(sync && sync.dirtyRevision),
      num(sync && sync.lastSyncedRevision)
    );
  }

  function hashTasks(tasks) {
    const text = JSON.stringify(arr(tasks).slice().sort((a, b) => String(a && a.id || '').localeCompare(String(b && b.id || ''))));
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function snapshotFromData(data, sync, capturedAt) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.cronoTasks)) return null;
    const tasks = data.cronoTasks.map(task => task && typeof task === 'object' ? { ...task } : task);
    const tombstones = arr(data.cronoTaskTombstones).map(item => item && typeof item === 'object' ? { ...item } : item);
    const newestTaskAt = tasks.reduce((max, task) => Math.max(max, taskTimeMs(task)), 0);
    return {
      capturedAt: capturedAt || new Date().toISOString(),
      savedAt: data._savedAt || null,
      revision: maxRevision(data, sync || {}),
      newestTaskAt,
      taskCount: tasks.length,
      fingerprint: hashTasks(tasks),
      tasks,
      tombstones,
    };
  }

  function readState(storage) {
    const raw = parseJson(storage && storage.getItem ? storage.getItem(RESCUE_KEY) : null);
    return raw && typeof raw === 'object' && Array.isArray(raw.snapshots)
      ? raw
      : { version: 1, snapshots: [] };
  }

  function appendSnapshot(storage, snapshot) {
    if (!storage || !storage.setItem || !snapshot) return snapshot;
    const state = readState(storage);
    const duplicate = state.snapshots.some(item => item && item.fingerprint === snapshot.fingerprint && num(item.revision) === num(snapshot.revision) && String(item.savedAt || '') === String(snapshot.savedAt || ''));
    if (!duplicate) state.snapshots.unshift(snapshot);
    state.version = 1;
    state.snapshots = state.snapshots.slice(0, MAX_SNAPSHOTS);
    state.updatedAt = new Date().toISOString();
    try { storage.setItem(RESCUE_KEY, JSON.stringify(state)); } catch (error) {}
    return snapshot;
  }

  function capture(storage, capturedAt) {
    const target = storage || (root && root.localStorage);
    if (!target) return null;
    const data = parseJson(target.getItem(DB_KEY));
    const sync = parseJson(target.getItem(SYNC_KEY)) || {};
    return appendSnapshot(target, snapshotFromData(data, sync, capturedAt));
  }

  function captureData(data, storage, capturedAt) {
    const target = storage || (root && root.localStorage);
    if (!target) return null;
    const sync = parseJson(target.getItem(SYNC_KEY)) || {};
    return appendSnapshot(target, snapshotFromData(data, sync, capturedAt));
  }

  function snapshots(storage) {
    const target = storage || (root && root.localStorage);
    return target ? readState(target).snapshots.slice() : [];
  }

  const api = { DB_KEY, SYNC_KEY, RESCUE_KEY, taskTimeMs, maxRevision, hashTasks, snapshotFromData, capture, captureData, snapshots };
  try { capture(); } catch (error) {}
  return api;
});
