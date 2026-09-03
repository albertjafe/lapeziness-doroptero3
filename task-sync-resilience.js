(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaskSyncResilience = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DB_KEY = 'alberto_piano_v2';
  const SYNC_KEY = 'alberto_sync_v1';
  const RESCUE_KEY = 'alberto_crono_tasks_rescue_v1';
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
    if (root && root.TaskSyncBootstrap && typeof root.TaskSyncBootstrap.taskTimeMs === 'function') return root.TaskSyncBootstrap.taskTimeMs(task);
    if (!task || typeof task !== 'object') return 0;
    let best = [task.updatedAt, task.createdAt, task.completedAt, task.doneAt, task.endedAt, task.endTime, task.at, task.date]
      .reduce((max, value) => Math.max(max, timeMs(value)), 0);
    const match = String(task.id || '').match(/(\d{13})/);
    if (match) best = Math.max(best, Number(match[1]) || 0);
    return best;
  }

  function tombstoneTimeMs(item) {
    return timeMs(item && (item.deletedAt || item.updatedAt || item.at));
  }

  function taskMap(tasks) {
    const map = new Map();
    arr(tasks).forEach((task, index) => {
      if (!task || typeof task !== 'object') return;
      const id = String(task.id || `__missing_${index}`);
      const previous = map.get(id);
      if (!previous || taskTimeMs(task) >= taskTimeMs(previous)) map.set(id, { ...task, id: task.id || id });
    });
    return map;
  }

  function mergeTombstones() {
    const map = new Map();
    Array.from(arguments).forEach(list => arr(list).forEach(item => {
      if (!item || item.id == null) return;
      const id = String(item.id);
      const previous = map.get(id);
      if (!previous || tombstoneTimeMs(item) >= tombstoneTimeMs(previous)) map.set(id, { ...item, id: item.id });
    }));
    return map;
  }

  function newestTaskAt(tasks) {
    return arr(tasks).reduce((max, task) => Math.max(max, taskTimeMs(task)), 0);
  }

  function revisionOf(data) {
    return num(data && data._localRevision);
  }

  function maxKnownRevision(data, rescue, storage) {
    const sync = parseJson(storage && storage.getItem ? storage.getItem(SYNC_KEY) : null) || {};
    return Math.max(
      revisionOf(data),
      num(rescue && rescue.revision),
      num(sync.localRevision),
      num(sync.dirtyRevision),
      num(sync.lastSyncedRevision)
    );
  }

  function nextRevision(remoteData, localData, rescue, storage) {
    return Math.max(revisionOf(remoteData), maxKnownRevision(localData, rescue, storage)) + 1;
  }

  function fingerprint(tasks) {
    if (root && root.TaskSyncBootstrap && typeof root.TaskSyncBootstrap.hashTasks === 'function') return root.TaskSyncBootstrap.hashTasks(tasks);
    return JSON.stringify(arr(tasks).map(task => [String(task && task.id || ''), taskTimeMs(task), task && (task.text || task.title || task.nombre || ''), Boolean(task && (task.done || task.completed))]));
  }

  function bestRescue(storage) {
    let snapshots = [];
    if (root && root.TaskSyncBootstrap && typeof root.TaskSyncBootstrap.snapshots === 'function') snapshots = root.TaskSyncBootstrap.snapshots(storage);
    else {
      const state = parseJson(storage && storage.getItem ? storage.getItem(RESCUE_KEY) : null);
      snapshots = arr(state && state.snapshots);
    }
    return snapshots.slice().sort((a, b) => {
      const byRevision = num(b && b.revision) - num(a && a.revision);
      if (byRevision) return byRevision;
      const byTask = num(b && b.newestTaskAt) - num(a && a.newestTaskAt);
      if (byTask) return byTask;
      return timeMs(b && b.savedAt) - timeMs(a && a.savedAt);
    })[0] || null;
  }

  function isRescueAuthoritative(rescue, remoteData) {
    if (!rescue) return false;
    const remoteTasks = arr(remoteData && remoteData.cronoTasks);
    return num(rescue.revision) > revisionOf(remoteData)
      || num(rescue.newestTaskAt) > newestTaskAt(remoteTasks) + 500;
  }

  function mergeTaskState(localTasks, remoteTasks, localTombstones, remoteTombstones, options) {
    const opts = options || {};
    const local = taskMap(localTasks);
    const remote = taskMap(remoteTasks);
    const tombstones = mergeTombstones(localTombstones, remoteTombstones);
    const deleteAt = num(opts.authoritativeAbsenceAt);

    if (deleteAt > 0) {
      remote.forEach((task, id) => {
        if (local.has(id)) return;
        if (taskTimeMs(task) > deleteAt) return;
        const previous = tombstones.get(id);
        if (!previous || tombstoneTimeMs(previous) < deleteAt) tombstones.set(id, { id: task.id || id, deletedAt: new Date(deleteAt).toISOString(), source: 'newer-device-snapshot' });
      });
    }

    const ids = new Set([...local.keys(), ...remote.keys()]);
    const tasks = [];
    ids.forEach(id => {
      const a = local.get(id);
      const b = remote.get(id);
      let winner = null;
      if (a && b) {
        const at = taskTimeMs(a), bt = taskTimeMs(b);
        if (at > bt) winner = a;
        else if (bt > at) winner = b;
        else winner = opts.preferLocalOnTie ? a : b;
      } else winner = a || b;
      if (!winner) return;
      const deleted = tombstones.get(id);
      if (deleted && tombstoneTimeMs(deleted) >= taskTimeMs(winner)) return;
      tasks.push(winner);
    });

    tasks.sort((a, b) => taskTimeMs(a) - taskTimeMs(b) || String(a.id || '').localeCompare(String(b.id || '')));
    const cleanTombstones = Array.from(tombstones.values()).sort((a, b) => tombstoneTimeMs(a) - tombstoneTimeMs(b));
    return { tasks, tombstones: cleanTombstones };
  }

  function database() {
    try { return typeof db !== 'undefined' ? db : (root && root.db); } catch (error) { return root && root.db; }
  }

  function writeLocalTaskState(data, tasks, tombstones, revision, savedAt, storage) {
    if (!data || typeof data !== 'object') return;
    data.cronoTasks = tasks.map(task => ({ ...task }));
    data.cronoTaskTombstones = tombstones.map(item => ({ ...item }));
    if (revision != null) data._localRevision = Math.max(revisionOf(data), num(revision));
    if (savedAt) data._savedAt = savedAt;
    try {
      if (storage && storage.setItem) storage.setItem(DB_KEY, JSON.stringify(data));
    } catch (error) {}
    try {
      if (root && root.TaskSyncBootstrap && typeof root.TaskSyncBootstrap.captureData === 'function') root.TaskSyncBootstrap.captureData(data, storage);
    } catch (error) {}
    try { if (root && typeof root.renderCronoTasks === 'function') root.renderCronoTasks(); } catch (error) {}
  }

  function sameTaskState(aTasks, aTombs, bTasks, bTombs) {
    const tombSig = list => JSON.stringify(arr(list).map(item => [String(item && item.id || ''), tombstoneTimeMs(item)]).sort());
    return fingerprint(aTasks) === fingerprint(bTasks) && tombSig(aTombs) === tombSig(bTombs);
  }

  let inFlight = null;
  let timer = 0;
  let shadow = new Map();
  let userActivityUntil = 0;

  async function fetchRemote(client, userId) {
    const query = client.from('user_data').select('data,updated_at').eq('id', userId);
    const response = typeof query.maybeSingle === 'function' ? await query.maybeSingle() : await query.single();
    if (response && response.error) throw response.error;
    return response && response.data ? response.data : null;
  }

  async function reconcile(reason) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const storage = root && root.localStorage;
      const client = root && typeof root.getSB === 'function' ? root.getSB() : null;
      if (!storage || !client) return { ok: false, reason: 'no-client' };
      const auth = await client.auth.getUser();
      const user = auth && auth.data && auth.data.user;
      if (!user || !user.id) return { ok: false, reason: 'no-user' };
      const row = await fetchRemote(client, user.id);
      if (!row || !row.data) return { ok: false, reason: 'no-remote' };

      const remoteData = row.data;
      const localData = database() || parseJson(storage.getItem(DB_KEY)) || {};
      const rescue = bestRescue(storage);
      const rescueWins = isRescueAuthoritative(rescue, remoteData);
      const remoteNewest = newestTaskAt(remoteData.cronoTasks);
      const rescueHasNewerTaskEvidence = Boolean(rescue && num(rescue.newestTaskAt) > remoteNewest + 500);
      const localTasks = rescueWins && rescue ? arr(rescue.tasks) : arr(localData.cronoTasks);
      const localTombs = mergeTombstones(arr(localData.cronoTaskTombstones), arr(rescue && rescue.tombstones));
      const absenceAt = rescueWins && rescueHasNewerTaskEvidence
        ? Math.max(timeMs(rescue.savedAt), num(rescue.newestTaskAt))
        : 0;
      const merged = mergeTaskState(localTasks, remoteData.cronoTasks, Array.from(localTombs.values()), remoteData.cronoTaskTombstones, {
        preferLocalOnTie: rescueWins,
        authoritativeAbsenceAt: absenceAt,
      });

      const remoteSame = sameTaskState(merged.tasks, merged.tombstones, remoteData.cronoTasks, remoteData.cronoTaskTombstones);
      let effectiveRevision = revisionOf(remoteData);
      let savedAt = remoteData._savedAt || row.updated_at || null;

      if (!remoteSame) {
        const stamp = new Date().toISOString();
        const rev = nextRevision(remoteData, localData, rescue, storage);
        const nextData = { ...remoteData, cronoTasks: merged.tasks, cronoTaskTombstones: merged.tombstones, _localRevision: rev, _savedAt: stamp };
        const write = await client.from('user_data').upsert({ id: user.id, data: nextData, updated_at: stamp });
        if (write && write.error) throw write.error;
        effectiveRevision = rev;
        savedAt = stamp;
      }

      writeLocalTaskState(localData, merged.tasks, merged.tombstones, effectiveRevision, savedAt, storage);
      shadow = taskMap(merged.tasks);
      return { ok: true, reason: reason || 'manual', rescueWins, wrote: !remoteSame, revision: effectiveRevision, taskCount: merged.tasks.length };
    })().catch(error => ({ ok: false, reason: 'error', error: String(error && error.message || error) })).finally(() => { inFlight = null; });
    return inFlight;
  }

  function scheduleReconcile(reason, delay) {
    if (!root || !root.setTimeout) return;
    clearTimeout(timer);
    timer = root.setTimeout(() => reconcile(reason), delay == null ? 900 : delay);
  }

  function taskComparable(task) {
    if (!task || typeof task !== 'object') return '';
    const copy = { ...task };
    delete copy.updatedAt;
    return JSON.stringify(copy);
  }

  function markTaskChanges(data) {
    if (!data || !Array.isArray(data.cronoTasks)) return false;
    const now = Date.now();
    if (now > userActivityUntil) return false;
    const current = taskMap(data.cronoTasks);
    const removed = [...shadow.keys()].filter(id => !current.has(id));
    const suspiciousBulkReplacement = shadow.size > 8 && removed.length > Math.max(3, Math.ceil(shadow.size * 0.25));
    let changed = false;

    current.forEach((task, id) => {
      const before = shadow.get(id);
      if (!before || taskComparable(before) !== taskComparable(task)) {
        task.updatedAt = new Date(now).toISOString();
        changed = true;
      }
    });

    if (!suspiciousBulkReplacement && removed.length) {
      const tombstones = mergeTombstones(data.cronoTaskTombstones);
      removed.forEach(id => tombstones.set(id, { id, deletedAt: new Date(now).toISOString(), source: 'local-user-delete' }));
      data.cronoTaskTombstones = Array.from(tombstones.values());
      changed = true;
    }
    return changed;
  }

  function noteUserActivity(event) {
    const target = event && event.target;
    let taskSpecific = false;
    try { taskSpecific = Boolean(target && target.closest && target.closest('[class*="task"],[id*="Task"],[id*="task"],#cronoNoteInput,.crono-tomorrow-voice-btn')); } catch (error) {}
    userActivityUntil = Date.now() + (taskSpecific ? 120000 : 6000);
  }

  function wrapSaveData() {
    const original = root && root.saveData;
    if (typeof original !== 'function' || original.__taskSyncResilience) return;
    const wrapped = function taskSafeSaveData() {
      const data = database();
      const taskChanged = markTaskChanges(data);
      const result = original.apply(this, arguments);
      if (taskChanged && data) {
        try { if (root.TaskSyncBootstrap && typeof root.TaskSyncBootstrap.captureData === 'function') root.TaskSyncBootstrap.captureData(data, root.localStorage); } catch (error) {}
        shadow = taskMap(data.cronoTasks);
        scheduleReconcile('local-task-change', 700);
      }
      return result;
    };
    wrapped.__taskSyncResilience = true;
    wrapped.__original = original;
    root.saveData = wrapped;
    try { saveData = wrapped; } catch (error) {}
  }

  function install() {
    if (!root || root.__taskSyncResilienceInstalled) return;
    root.__taskSyncResilienceInstalled = true;
    const data = database();
    shadow = taskMap(data && data.cronoTasks);
    ['pointerdown', 'click', 'keydown', 'input', 'change'].forEach(type => document.addEventListener(type, noteUserActivity, true));
    wrapSaveData();
    root.addEventListener('online', () => scheduleReconcile('online', 250));
    root.addEventListener('pageshow', () => scheduleReconcile('pageshow', 300));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleReconcile('visible', 300); });
    [300, 1800, 6000, 18000].forEach(delay => root.setTimeout(() => reconcile('startup'), delay));
  }

  const api = { taskTimeMs, tombstoneTimeMs, newestTaskAt, nextRevision, bestRescue, isRescueAuthoritative, mergeTaskState, reconcile, scheduleReconcile, install };
  if (root && root.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
  return api;
});
