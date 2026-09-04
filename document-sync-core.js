/* Conservative document merge. Revision numbers order uploads on ONE device;
 * field clocks order edits, IDs identify records, tombstones identify deletions.
 * Missing fields in an older client are never interpreted as deletion. */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DocumentSyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const internal = new Set(['_fieldClock','_deletedChildren','_savedAt','_localRevision']);
  const additive = new Set(['sessionPlants','forestPlants','sesiones','items','registro','solHistory','paseHistory','zoneHistory','compasHistory','workHistory','historicalRepertoire','historicalEvents','cronoTaskTombstones','planningEventTombstones','competitionPlanTombstones']);
  const stampOf = x => String(x?.correctedAt || x?.manualSavedAt || x?.updatedAt || x?._savedAt || x?.createdAt || '');
  const identity = x => object(x) && x.id != null ? 'id:' + String(x.id) :
    object(x) && x.runId != null ? 'run:' + String(x.runId) :
    object(x) && (x.at || x.date || x.startedAt) ? JSON.stringify([x.at || x.date || x.startedAt, x.obraId, x.movId, x.tipo || x.type || x.kind, x.context, x.momento]) :
    object(x) && x.obraId != null ? JSON.stringify(['item',x.obraId,x.movId ?? x.movimientoId,x.uso ?? x.purpose,x.ronda ?? x.round]) : JSON.stringify(x);
  const maxMap = (a,b) => Object.fromEntries([...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])]
    .map(k => [k, String(a?.[k] || '') > String(b?.[k] || '') ? a[k] : b[k]]));

  function merge(left, right, inheritedLeft = '', inheritedRight = '', revisionOrder = 0, remote = false) {
    if (left === undefined) return clone(right);
    if (right === undefined) return clone(left);
    if (equal(left,right)) return clone(left);
    if (Array.isArray(left) && Array.isArray(right)) {
      const records = new Map();
      left.forEach(x => records.set(identity(x), clone(x)));
      right.forEach(x => { const key = identity(x); records.set(key, records.has(key) ? merge(records.get(key),x,inheritedLeft,inheritedRight,revisionOrder,remote) : clone(x)); });
      const preferred = remote || inheritedLeft > inheritedRight ? [...left,...right] : [...right,...left];
      return [...new Set(preferred.map(identity))].map(key => records.get(key));
    }
    // Remote conflicts default to the server (left). Local revision and record/
    // document dates cannot prove a field edit on another device.
    if (!object(left) || !object(right)) return clone(remote || revisionOrder > 0 || (!revisionOrder && inheritedLeft > inheritedRight) ? left : right);
    const result = {};
    const leftTime = stampOf(left) || inheritedLeft, rightTime = stampOf(right) || inheritedRight;
    const clocks = maxMap(left._fieldClock, right._fieldClock);
    const deleted = {};
    for (const k of new Set([...Object.keys(left._deletedChildren || {}), ...Object.keys(right._deletedChildren || {})]))
      deleted[k] = maxMap(left._deletedChildren?.[k], right._deletedChildren?.[k]);
    for (const k of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (k === '_fieldClock' || k === '_deletedChildren') continue;
      const a = left[k], b = right[k];
      const ac = left._fieldClock?.[k], bc = right._fieldClock?.[k];
      if (a === undefined || b === undefined) result[k] = clone(a === undefined ? b : a);
      // A collection clock is not an edit clock for every field in its records.
      else if (remote && Array.isArray(a) && Array.isArray(b) && a.every(object) && b.every(object))
        result[k] = merge(a,b,leftTime,rightTime,revisionOrder,remote);
      else if (ac !== bc && (ac || bc) && !additive.has(k)) {
        // Nested records still merge independently; a scalar/selection is atomic.
        result[k] = object(a) && object(b) ? merge(a,b,leftTime,rightTime,revisionOrder,remote) : clone(String(ac || '') > String(bc || '') ? a : b);
      } else result[k] = merge(a,b,leftTime,rightTime,revisionOrder,remote);
      if (Array.isArray(result[k]) && deleted[k]) result[k] = result[k].filter(x => !deleted[k][identity(x)]);
    }
    if (Object.keys(clocks).length) result._fieldClock = clocks;
    if (Object.keys(deleted).length) result._deletedChildren = deleted;
    if (left._localRevision != null || right._localRevision != null) result._localRevision = Math.max(Number(left._localRevision)||0, Number(right._localRevision)||0);
    return result;
  }

  function track(current, previous, stamp) {
    if (!object(current)) return current;
    const before = object(previous) ? previous : {};
    const next = clone(current);
    const clocks = { ...before._fieldClock, ...current._fieldClock };
    const deleted = merge(before._deletedChildren || {}, current._deletedChildren || {});
    let changed = false;
    for (const k of Object.keys(current)) {
      if (internal.has(k)) continue;
      const a = before[k], b = current[k];
      if (equal(a,b)) continue;
      changed = true;
      if (object(b)) next[k] = track(b,a,stamp);
      else if (Array.isArray(b) && [...(Array.isArray(a) ? a : []), ...b].every(x => object(x) && x.id != null)) {
        const oldById = new Map((a || []).map(x => [identity(x),x]));
        const ids = new Set(b.map(identity));
        next[k] = b.map(x => track(x,oldById.get(identity(x)),stamp));
        for (const id of oldById.keys()) if (!ids.has(id)) { deleted[k] ||= {}; deleted[k][id] = stamp; }
      } else if (Array.isArray(b) && additive.has(k)) {
        const prior = new Map((Array.isArray(a) ? a : []).map(x => [identity(x),x]));
        next[k] = b.map(x => object(x) ? track(x,prior.get(identity(x)),stamp) : x);
      } else clocks[k] = stamp;
    }
    // Do not erase fields unknown to a normalizer. Explicit clear uses null or [].
    for (const k of Object.keys(before)) if (!Object.hasOwn(next,k) && !internal.has(k)) next[k] = clone(before[k]);
    if (changed && current.id != null) next.updatedAt = stamp;
    if (Object.keys(clocks).length) next._fieldClock = clocks;
    if (Object.keys(deleted).length) next._deletedChildren = deleted;
    return next;
  }

  function applyTombstones(data) {
    const result = clone(data);
    const remove = (field, list, key) => {
      if (!Array.isArray(result[field])) return;
      const ids = new Set((result[list] || []).map(x => String(object(x) ? x.id ?? x[key] : x)));
      result[field] = result[field].filter(x => !ids.has(String(x.id)));
    };
    remove('eventos','planningEventTombstones','eventId');
    remove('competitionPlans','competitionPlanTombstones','planId');
    remove('cronoTasks','cronoTaskTombstones','taskId');
    return result;
  }
  // Transport revisions/timestamps alone do not require an upload. All nested
  // fields, including evidence dates, unknown properties and edit clocks, count.
  function sameContent(a,b,root=true) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value,i) => sameContent(value,b[i],false));
    if (!object(a) || !object(b)) return false;
    const keys = value => Object.keys(value).filter(k => !root || (k !== '_localRevision' && k !== '_savedAt'));
    const ak = keys(a), bk = keys(b);
    return ak.length === bk.length && ak.every(k => Object.hasOwn(b,k) && sameContent(a[k],b[k],false));
  }
  // Open editors keep references to these objects across synchronous saves.
  // Reconcile by ID without invalidating the object an editor will next mutate.
  function assign(target, source) {
    if (Array.isArray(target) && Array.isArray(source)) {
      const prior = new Map(target.map(x => [identity(x),x]));
      const next = source.map(x => assign(prior.get(identity(x)),x));
      target.length = 0;
      for (const item of next) target.push(item);
      return target;
    }
    if (object(target) && object(source)) {
      for (const k of Object.keys(target)) if (!Object.hasOwn(source,k)) delete target[k];
      for (const k of Object.keys(source)) target[k] = assign(target[k],source[k]);
      return target;
    }
    return clone(source);
  }
  return {
    // Only for snapshots on the same device; never use this for a cloud row.
    merge: (a,b) => applyTombstones(merge(a || {},b || {},'','',Math.sign((Number(a?._localRevision)||0)-(Number(b?._localRevision)||0)))),
    // Direction matters: an incoming existing scalar needs its own later clock.
    mergeRemote: (server,client) => applyTombstones(merge(server || {},client || {},'','',0,true)),
    track, identity, assign, sameContent
  };
});
