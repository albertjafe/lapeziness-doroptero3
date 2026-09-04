/* Calendar-event reconciliation.
   Events are additive user data: omission by one device is not deletion.
   Deletion is explicit through planningEventTombstones. */
(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EventSyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const VERSION = 1;

  function toMs(value) {
    if (value == null || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 1000000000000) return numeric;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function dbRevision(db) {
    const value = Number(db && db._localRevision);
    return Number.isFinite(value) ? value : 0;
  }

  function dbSavedAt(db) {
    return toMs(db && db._savedAt);
  }

  function compareDbFreshness(a, b) {
    try {
      if (root && root.SyncCore && typeof root.SyncCore.compareDbFreshness === 'function') {
        return root.SyncCore.compareDbFreshness(a || {}, b || {});
      }
    } catch (error) {}
    const ar = dbRevision(a);
    const br = dbRevision(b);
    if (ar !== br) return ar > br ? 1 : -1;
    const at = dbSavedAt(a);
    const bt = dbSavedAt(b);
    if (at === bt) return 0;
    return at > bt ? 1 : -1;
  }

  function eventMutationAt(event) {
    if (!event || typeof event !== 'object') return 0;
    let best = [
      event.manualSavedAt,
      event.updatedAt,
      event.recoveredAt,
      event.completedDate,
      event.createdAt,
      event.deletedAt,
      event.at,
    ].reduce((max, value) => Math.max(max, toMs(value)), 0);

    // Legacy event IDs often embed their creation timestamp.
    const match = String(event.id || '').match(/(\d{13})/);
    if (match) best = Math.max(best, Number(match[1]) || 0);
    return best;
  }

  function normalizeTombstones(list) {
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach(item => {
      const id = typeof item === 'string' || typeof item === 'number'
        ? String(item)
        : String(item && (item.id || item.eventId) || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return out.slice(-5000);
  }

  function mergeTombstones(a, b) {
    return normalizeTombstones((Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []));
  }

  function mergeEventRecord(current, candidate, candidateWinsTie) {
    if (!current) return candidate;
    if (!candidate) return current;
    const currentAt = eventMutationAt(current);
    const candidateAt = eventMutationAt(candidate);
    if (candidateAt > currentAt || (candidateAt === currentAt && candidateWinsTie)) {
      return Object.assign({}, current, candidate);
    }
    return Object.assign({}, candidate, current);
  }

  function mergeCalendarEvents(base, other) {
    const left = base || {};
    const right = other || {};
    const tombstones = mergeTombstones(left.planningEventTombstones, right.planningEventTombstones);
    const deleted = new Set(tombstones);
    const rightIsFresher = compareDbFreshness(left, right) < 0;
    const byId = new Map();
    const order = [];

    const add = (event, fromRight) => {
      if (!event || typeof event !== 'object') return;
      const id = String(event.id || '').trim();
      if (!id || deleted.has(id)) return;
      if (!byId.has(id)) order.push(id);
      const current = byId.get(id);
      const candidateWinsTie = fromRight ? rightIsFresher : !rightIsFresher;
      byId.set(id, mergeEventRecord(current, event, candidateWinsTie));
    };

    (Array.isArray(left.eventos) ? left.eventos : []).forEach(event => add(event, false));
    (Array.isArray(right.eventos) ? right.eventos : []).forEach(event => add(event, true));

    return {
      eventos: order.filter(id => byId.has(id) && !deleted.has(id)).map(id => byId.get(id)),
      planningEventTombstones: tombstones,
    };
  }

  function install(dataCore) {
    if (!dataCore || typeof dataCore.mergeStudyHistory !== 'function') return false;
    if (dataCore.__calendarEventSyncInstalled) return true;

    const original = dataCore.mergeStudyHistory;
    dataCore.mergeStudyHistory = function mergeStudyHistoryWithCalendarEvents(base, other) {
      const merged = original.apply(this, arguments);
      if (!merged) return merged;
      const calendar = mergeCalendarEvents(base, other);
      merged.eventos = calendar.eventos;
      merged.planningEventTombstones = calendar.planningEventTombstones;

      const protectionAt = Math.max(
        toMs(base && base.eventProtectionUpdatedAt),
        toMs(other && other.eventProtectionUpdatedAt)
      );
      if (protectionAt) merged.eventProtectionUpdatedAt = new Date(protectionAt).toISOString();
      return merged;
    };

    Object.defineProperty(dataCore, '__calendarEventSyncInstalled', {
      value: true,
      configurable: true,
    });
    return true;
  }

  const api = {
    version: VERSION,
    eventMutationAt,
    mergeTombstones,
    mergeCalendarEvents,
    install,
  };

  try {
    if (root && root.DataCore) install(root.DataCore);
  } catch (error) {}

  return api;
});
