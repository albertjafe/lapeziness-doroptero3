(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

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

  function civilDayOrdinal(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const check = new Date(timestamp);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return Math.floor(timestamp / DAY_MS);
  }

  function civilDayFromOrdinal(ordinal) {
    if (!Number.isFinite(ordinal)) return null;
    return new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
  }

  function localTodayCivilDay(now) {
    const date = now instanceof Date ? now : new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function habitLogStatus(log) {
    return String(log && log.status || '').trim().toLowerCase();
  }

  function isFailureLog(log) {
    const status = habitLogStatus(log);
    return !status || ['failed', 'fail', 'failure', 'relapse', 'broken', 'missed'].includes(status);
  }

  function isDoneLog(log) {
    return ['done', 'success', 'succeeded', 'complete', 'completed'].includes(habitLogStatus(log));
  }

  function summarizeHabitChallenge(habit, todayDay) {
    if (!habit || !habit.id) return null;
    const mode = String(habit.mode || '').trim().toLowerCase();
    const startOrdinal = civilDayOrdinal(habit.startDate);
    const durationDays = Math.max(1, Math.floor(Number(habit.durationDays) || 1));
    const today = todayDay || localTodayCivilDay();
    const todayOrdinal = civilDayOrdinal(today);
    const completionOrdinal = startOrdinal == null ? null : startOrdinal + durationDays - 1;
    const completionDate = civilDayFromOrdinal(completionOrdinal);

    let phase = 'unknown';
    let currentDay = 0;
    let closedDays = 0;
    let daysRemaining = durationDays;
    if (habit.deleted) {
      phase = 'deleted';
    } else if (startOrdinal != null && todayOrdinal != null) {
      if (todayOrdinal < startOrdinal) {
        phase = 'scheduled';
      } else if (todayOrdinal <= completionOrdinal) {
        phase = 'active';
        currentDay = Math.min(durationDays, todayOrdinal - startOrdinal + 1);
        closedDays = Math.min(durationDays, Math.max(0, todayOrdinal - startOrdinal));
        daysRemaining = Math.max(0, completionOrdinal - todayOrdinal + 1);
      } else {
        phase = 'maintenance';
        currentDay = durationDays;
        closedDays = durationDays;
        daysRemaining = 0;
      }
    }

    const failureDays = new Set();
    const closedFailureDays = new Set();
    const closedDoneDays = new Set();
    Object.entries(habit.logs || {}).forEach(([day, log]) => {
      const ordinal = civilDayOrdinal(day);
      if (ordinal == null || startOrdinal == null || todayOrdinal == null) return;
      if (ordinal < startOrdinal || ordinal > completionOrdinal || ordinal > todayOrdinal) return;
      if (isFailureLog(log)) {
        failureDays.add(day);
        if (ordinal < todayOrdinal) closedFailureDays.add(day);
      }
      if (ordinal < todayOrdinal && isDoneLog(log)) closedDoneDays.add(day);
    });

    const avoidMode = mode === 'avoid';
    const successfulClosedDays = avoidMode
      ? Math.max(0, closedDays - closedFailureDays.size)
      : Math.min(closedDays, closedDoneDays.size);
    const successRateClosedDays = closedDays > 0
      ? Math.round((successfulClosedDays / closedDays) * 100)
      : null;

    return {
      id: habit.id,
      title: habit.title || '',
      mode: mode || null,
      startDate: habit.startDate || null,
      durationDays,
      completionDate,
      phase,
      currentDay,
      closedDays,
      daysRemaining,
      failureCount: failureDays.size,
      failureDays: Array.from(failureDays).sort(),
      successfulClosedDays,
      successRateClosedDays,
      challengeCompleted: phase === 'maintenance',
      successRule: avoidMode ? 'closed_day_without_failure_log' : 'closed_day_with_done_log',
      logSemantics: avoidMode ? 'failures_only' : 'explicit_daily_status',
    };
  }

  function buildHabitObjectiveSummary(habits, todayDay) {
    const today = todayDay || localTodayCivilDay();
    const items = (habits || [])
      .map(habit => summarizeHabitChallenge(habit, today))
      .filter(Boolean);
    const active = items
      .filter(item => item.phase === 'active')
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))[0] || null;
    return {
      schemaVersion: 1,
      asOf: today,
      semantics: {
        avoid: {
          logSemantics: 'failures_only',
          successRule: 'a closed day with no failure log counts as successful',
        },
        do: {
          logSemantics: 'explicit_daily_status',
          successRule: 'a closed day needs a done log to count as successful',
        },
      },
      activeHabitId: active && active.id || null,
      active,
      items,
    };
  }

  function mergeRepertoireIntoResult(base, other, merged) {
    const result = Object.assign({}, merged || {});
    result.obras = mergeObrasFromFreshest(base || {}, other || {});
    const maxRevision = Math.max(dbRevision(base), dbRevision(other));
    if (maxRevision) result._localRevision = maxRevision;
    const freshest = compareDbFreshness(base || {}, other || {}) >= 0 ? (base || {}) : (other || {});
    if (freshest._savedAt) result._savedAt = freshest._savedAt;
    const habits = Array.isArray(result.habitChallenges)
      ? result.habitChallenges
      : (result.habitChallenge ? [result.habitChallenge] : []);
    result.habitObjectiveSummary = buildHabitObjectiveSummary(habits);
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
    summarizeHabitChallenge,
    buildHabitObjectiveSummary,
    installRepertoireSync
  };
});

// data-core.js is loaded immediately before this file in the app. Patch its
// merge at startup so the very first cloud/local reconciliation also includes
// repertoire metadata and a self-describing habit-objective summary.
if (typeof window !== 'undefined' && window.SyncCore && window.DataCore) {
  window.SyncCore.installRepertoireSync(window.DataCore);
}
