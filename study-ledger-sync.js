/* Historial maestro de estudio (tabla public.study_ledger).

   El documento user_data guarda todo el historial en un único JSON que crece
   sin límite; cada subida lo relee y reescribe entero. Este canal paralelo
   sincroniza los registros que determinan el tiempo estudiado de uno en uno:

   - Subida: solo los registros cuyo contenido cambió desde la última subida
     confirmada (huella por registro) y los borrados explícitos.
   - Descarga: solo las filas con updated_at posterior al cursor del dispositivo.
   - Fusión conservadora: nunca se elimina un registro sin marca de borrado, y
     los cambios locales pendientes se fusionan campo a campo con la nube.

   El documento user_data sigue sincronizándose como antes; este canal asegura
   que el estudio llegue a todos los dispositivos aunque esa subida grande falle. */
(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudyLedgerSync = api;
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict';

  const TABLE = 'study_ledger';
  const COLLECTIONS = ['sessionPlants', 'forestPlants', 'sesiones'];
  const BATCH = 200;
  const PAGE = 500;
  // Rows committed out of order around the cursor are re-read; applying a
  // row twice is harmless.
  const CURSOR_OVERLAP_MS = 2 * 60 * 1000;
  const EPOCH = '2000-01-01T00:00:00.000Z';
  const DELETED = 'deleted';
  const IDB_NAME = 'study-ledger-v1';

  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const canonical = x => Array.isArray(x) ? x.map(canonical) : object(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  // Two independent 32-bit hashes of the canonical JSON: JSONB reorders keys,
  // so the fingerprint must not depend on property order.
  function fingerprint(value) {
    const text = JSON.stringify(canonical(value));
    let a = 0x811c9dc5, b = 5381;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = (Math.imul(b, 33) + c) | 0;
    }
    return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36) + '.' + text.length.toString(36);
  }
  const stampOf = x => String(x?.correctedAt || x?.manualSavedAt || x?.updatedAt || x?._savedAt || x?.createdAt || '');
  const validStamp = s => s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : '';

  function docCore() { return root.DocumentSyncCore; }
  function stateKey(collection, key) { return collection + '\u0000' + key; }

  /* Rows to upload: records whose fingerprint differs from the last confirmed
     one, plus explicit deletions not yet confirmed. */
  function pendingRows(database, pushed, userId, now) {
    const Doc = docCore(), rows = [];
    for (const collection of COLLECTIONS) {
      const list = Array.isArray(database?.[collection]) ? database[collection] : [];
      const present = new Set();
      for (const record of list) {
        if (!object(record)) continue;
        const key = Doc.identity(record);
        present.add(key);
        const hash = fingerprint(record), previous = pushed[stateKey(collection, key)];
        if (previous === hash) continue;
        // A record never confirmed keeps its own evidence date, so an old copy
        // cannot overwrite a newer edit made on another device.
        const edited = previous ? now : (validStamp(stampOf(record)) || EPOCH);
        rows.push({ user_id:userId, collection, record_key:key, record, deleted:false, edited_at:edited, _hash:hash });
      }
      const deletions = database?._deletedChildren?.[collection] || {};
      for (const key of Object.keys(deletions)) {
        if (present.has(key) || pushed[stateKey(collection, key)] === DELETED) continue;
        rows.push({ user_id:userId, collection, record_key:key, record:null, deleted:true,
          edited_at:validStamp(deletions[key]) || now, _hash:DELETED });
      }
    }
    return rows;
  }

  /* Applies downloaded rows to the local database. Returns true when the
     database changed. `pushed` is updated to the server fingerprints. */
  function applyRows(database, rows, pushed) {
    const Doc = docCore();
    let changed = false;
    for (const row of rows) {
      const collection = row.collection;
      if (!COLLECTIONS.includes(collection) || !row.record_key) continue;
      if (!Array.isArray(database[collection])) database[collection] = [];
      const list = database[collection], key = row.record_key, id = stateKey(collection, key);
      const index = list.findIndex(x => object(x) && Doc.identity(x) === key);
      if (row.deleted) {
        if (index >= 0) { list.splice(index, 1); changed = true; }
        database._deletedChildren ||= {};
        database._deletedChildren[collection] ||= {};
        const stamp = validStamp(row.edited_at) || EPOCH;
        if (String(database._deletedChildren[collection][key] || '') < stamp) {
          database._deletedChildren[collection][key] = stamp; changed = true;
        }
        pushed[id] = DELETED;
        continue;
      }
      if (!object(row.record)) continue;
      const remoteHash = fingerprint(row.record);
      if (index >= 0) {
        const local = list[index];
        const localHash = fingerprint(local);
        // Unconfirmed local edits win conflicts; otherwise the cloud does.
        const pending = pushed[id] !== undefined ? pushed[id] !== localHash : localHash !== remoteHash;
        const merged = pending ? Doc.mergeRemote(local, row.record) : Doc.mergeRemote(row.record, local);
        if (fingerprint(merged) !== localHash) { list[index] = merged; changed = true; }
      } else {
        const tomb = database._deletedChildren?.[collection]?.[key];
        // A local deletion newer than this edit stays deleted (and is uploaded).
        if (tomb && String(tomb) >= String(validStamp(row.edited_at) || EPOCH)) continue;
        if (tomb) delete database._deletedChildren[collection][key];
        list.push(row.record); changed = true;
      }
      pushed[id] = remoteHash;
    }
    return changed;
  }

  // ── Persistent per-user state (IndexedDB, memory fallback) ─────────────────
  const memoryState = new Map();
  function idb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('IndexedDB no disponible'));
      const request = root.indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function loadState(userId) {
    const empty = { cursor:null, pushed:{} };
    try {
      const database = await idb();
      const value = await new Promise((resolve, reject) => {
        const request = database.transaction('state').objectStore('state').get(userId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return value && object(value.pushed) ? value : (memoryState.get(userId) || empty);
    } catch (_) { return memoryState.get(userId) || empty; }
  }
  async function saveState(userId, state) {
    memoryState.set(userId, state);
    try {
      const database = await idb();
      await new Promise((resolve, reject) => {
        const tx = database.transaction('state', 'readwrite');
        tx.objectStore('state').put(state, userId);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      database.close();
    } catch (_) {}
  }

  // ── Browser runtime ────────────────────────────────────────────────────────
  let running = null, again = false, disabledUntil = 0, timer = null;
  let status = { phase:'inactivo', at:null, pushed:0, pulled:0, error:null };
  function setStatus(patch) { status = { ...status, ...patch, at:new Date().toISOString() }; }

  function appDb() { try { return typeof db !== 'undefined' ? db : root.db; } catch (_) { return root.db; } }
  function client() { try { return typeof root.getSB === 'function' ? root.getSB() : null; } catch (_) { return null; } }
  function missingTable(error) {
    return error && (error.code === 'PGRST205' || error.code === '42P01' || error.status === 404);
  }

  // Time window (with overlap) selects the changes; the unique seq pages them
  // deterministically, so ties and concurrent writes never skip a row.
  async function pull(sb, userId, state) {
    let rows = [], cursor = state.cursor, lastSeq = null;
    for (let pages = 0; pages < 400; pages++) {
      let query = sb.from(TABLE).select('collection,record_key,record,deleted,edited_at,updated_at,seq').eq('user_id', userId);
      if (cursor) query = query.gt('updated_at', new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString());
      if (lastSeq != null) query = query.gt('seq', lastSeq);
      const { data, error } = await query.order('seq', { ascending:true }).limit(PAGE);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      rows = rows.concat(page);
      if (page.length < PAGE) break;
      lastSeq = page[page.length - 1].seq;
    }
    for (const row of rows) if (!cursor || String(row.updated_at) > String(cursor)) cursor = row.updated_at;
    return { rows, cursor };
  }

  // deps lets tests run independent simulated devices against one backend.
  async function cycle(deps = {}) {
    const currentDb = deps.database ? () => deps.database : appDb;
    const database = currentDb(), sb = deps.sb || client();
    const store = deps.store || { load:loadState, save:saveState };
    const hooks = deps.hooks || root;
    if (!database || !sb || !docCore()) return false;
    const { data:sessionData } = await sb.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) { setStatus({ phase:'sin cuenta' }); return false; }
    const state = await store.load(userId);

    setStatus({ phase:'descargando cambios' });
    const { rows:downloaded, cursor } = await pull(sb, userId, state);
    // Overlapping pages and this device's own uploads come back unchanged.
    const rows = downloaded.filter(row => state.pushed[stateKey(row.collection, row.record_key)] !==
      (row.deleted ? DELETED : fingerprint(row.record)));
    if (rows.length) {
      // Flush pending local edits into their own tracking before applying the
      // download, then make the result the saved baseline so the local save
      // does not restamp downloaded records as new local edits.
      const save = hooks.saveData?.__studyLedger ? hooks.saveData.__original : hooks.saveData;
      if (typeof save === 'function') save();
      const current = currentDb();
      if (applyRows(current, rows, state.pushed)) {
        if (typeof hooks._rememberLocalDocument === 'function') hooks._rememberLocalDocument();
        if (typeof hooks._persistCloudDocument === 'function') await hooks._persistCloudDocument(current);
        if (typeof hooks.refreshStudyViews === 'function') hooks.refreshStudyViews();
      }
    }
    state.cursor = cursor;
    await store.save(userId, state);

    const pending = pendingRows(currentDb(), state.pushed, userId, (deps.now ? deps.now() : new Date()).toISOString());
    setStatus({ phase:pending.length ? 'subiendo ' + pending.length + ' registros' : 'al día' });
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const { error } = await sb.from(TABLE).upsert(batch.map(({ _hash, ...row }) => row), { onConflict:'user_id,collection,record_key' });
      if (error) throw error;
      for (const row of batch) state.pushed[stateKey(row.collection, row.record_key)] = row._hash;
      await store.save(userId, state);
    }
    setStatus({ phase:'al día', pushed:status.pushed + pending.length, pulled:status.pulled + rows.length, error:null });
    return true;
  }

  function syncNow() {
    if (running) { again = true; return running; }
    if (Date.now() < disabledUntil) return Promise.resolve(false);
    running = (async () => {
      let ok = false;
      do {
        again = false;
        try { ok = await cycle(); }
        catch (error) {
          ok = false;
          // Until the table exists (migration not applied) stay quiet and retry later.
          disabledUntil = Date.now() + (missingTable(error) ? 10 * 60 * 1000 : 60 * 1000);
          setStatus({ phase:'pendiente', error:error?.code || error?.message || String(error) });
        }
      } while (again && ok);
      return ok;
    })().finally(() => { running = null; });
    return running;
  }

  function schedule(delay = 4000) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; syncNow(); }, delay);
  }

  function install() {
    if (typeof document === 'undefined' || root.__studyLedgerInstalled) return false;
    root.__studyLedgerInstalled = true;
    const original = root.saveData;
    if (typeof original === 'function' && !original.__studyLedger) {
      const patched = function() { const result = original.apply(this, arguments); schedule(); return result; };
      patched.__studyLedger = true; patched.__original = original;
      try { root.saveData = patched; } catch (_) {}
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(500); });
    root.addEventListener?.('online', () => schedule(500));
    root.addEventListener?.('focus', () => schedule(500));
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 90 * 1000);
    schedule(3000);
    return true;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete') install();
    else root.addEventListener('load', install, { once:true });
  }

  return { COLLECTIONS, fingerprint, pendingRows, applyRows, cycle, syncNow, schedule, status:() => ({ ...status }) };
});
