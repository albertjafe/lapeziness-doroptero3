import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(rootDir, 'update-safety.js'), 'utf8');

function harness({ dirty = 1, synced = 1, controlled = true, syncCompletes = true, memoryDocument, diskDocument } = {}) {
  const baseline = diskDocument || { _localRevision: dirty, _savedAt: '2026-09-04T10:00:00Z', sessionPlants: [{ id: 'recent' }], eventos: [] };
  const memory = memoryDocument || structuredClone(baseline);
  const storage = new Map([
    ['alberto_piano_v2', JSON.stringify(baseline)],
    ['alberto_sync_v1', JSON.stringify({ localRevision: dirty, dirtyRevision: dirty, lastSyncedRevision: synced })],
  ]);
  const calls = [];
  const messages = [];
  const listeners = {};
  const schedule = (fn, ms) => { const timer = setTimeout(fn, ms); if (ms >= 10000 && timer && typeof timer.unref === 'function') timer.unref(); return timer; };
  const waiting = { postMessage(message) { calls.push('activate'); messages.push(message); } };
  const registration = {
    waiting,
    installing: null,
    update() { calls.push('check-update'); return Promise.resolve(registration); },
  };
  const document = {
    body: { classList: { contains: () => false } },
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ id: '', src: '', async: false }),
  };
  let context;
  const sameContent = (a,b) => {
    const clean = value => {
      const copy=structuredClone(value);
      delete copy._localRevision;delete copy._savedAt;
      return copy;
    };
    return JSON.stringify(clean(a))===JSON.stringify(clean(b));
  };
  const window = {
    document,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    navigator: { serviceWorker: { controller:controlled ? {} : null, getRegistration: () => Promise.resolve(registration), addEventListener:(type,fn)=>{listeners[type]=fn;} } },
    location:{reload:()=>calls.push('reload')},
    swDoUpdate() {},
    DocumentSyncCore:{sameContent},
    saveLocalNow() {
      calls.push('save-local');
      context.db._localRevision=Number(context.db._localRevision||0)+1;
      context.db._savedAt='2026-09-04T10:01:00Z';
      storage.set('alberto_piano_v2',JSON.stringify(context.db));
      const meta=JSON.parse(storage.get('alberto_sync_v1')||'{}');
      meta.localRevision=context.db._localRevision;meta.dirtyRevision=context.db._localRevision;
      storage.set('alberto_sync_v1',JSON.stringify(meta));
    },
    enqueueCloudSync() { calls.push('enqueue'); },
    syncPendingCloudChanges() {
      calls.push('sync');
      const meta=JSON.parse(storage.get('alberto_sync_v1')||'{}');
      if(Number(meta.dirtyRevision||0)>Number(meta.lastSyncedRevision||0)){
        calls.push('cloud-write');
        if(syncCompletes){meta.lastSyncedRevision=meta.dirtyRevision;storage.set('alberto_sync_v1',JSON.stringify(meta));}
      }
      return Promise.resolve(true);
    },
    LocalSaveResilience: {
      retryMeta() { calls.push('retry-meta'); },
      hasPendingRescue: () => false,
      hasPendingMeta: () => false,
    },
    CronoSaveResilience: { protectCloud() { calls.push('verify-cloud'); return Promise.resolve(true); } },
    showToast(message) { calls.push(`toast:${message}`); },
    setTimeout:schedule,
  };
  context = {
    window,
    document,
    db: memory,
    DocumentSyncCore:window.DocumentSyncCore,
    swDoUpdate: window.swDoUpdate,
    saveLocalNow: window.saveLocalNow,
    syncPendingCloudChanges: window.syncPendingCloudChanges,
    enqueueCloudSync: window.enqueueCloudSync,
    setTimeout:schedule,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Number,
    console,
  };
  vm.runInNewContext(source, context);
  return { window, calls, messages, storage, context, registration, listeners };
}

describe('UpdateSafety v5', () => {
  it('checking for an update never saves, syncs, or promotes a clean document', async () => {
    const h = harness();
    const result = await h.window.UpdateSafety.checkForUpdate();
    expect(result.waiting).toBe(h.registration.waiting);
    expect(h.calls).toEqual(['check-update']);
  });
  it('waits for installation to finish before declaring a check complete', async () => {
    const h = harness();
    let changed;
    const worker = { state: 'installing', addEventListener: (_, fn) => { changed = fn; } };
    h.registration.waiting = null;
    h.registration.installing = worker;
    const checking = h.window.UpdateSafety.checkForUpdate();
    await new Promise(resolve => setTimeout(resolve, 0));
    worker.state = 'installed';
    h.registration.waiting = worker;
    changed();
    expect((await checking).waiting).toBe(worker);
  });
  it('does not treat a failed install as no update pending', async () => {
    const h = harness();
    h.registration.waiting = null;
    h.registration.installing = { state: 'redundant', addEventListener() {} };
    await expect(h.window.UpdateSafety.checkForUpdate()).rejects.toThrow('No se pudo instalar');
  });
  it('does not create a revision or cloud write for an already durable clean document', async () => {
    const { window, calls, messages } = harness({ dirty: 4, synced: 4 });
    const result = await window.UpdateSafety.safeUpdate();

    expect(result).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'SAFE_SKIP_WAITING', safe: true });
    expect(calls).not.toContain('save-local');
    expect(calls).not.toContain('cloud-write');
    expect(calls.indexOf('verify-cloud')).toBeGreaterThan(calls.indexOf('sync'));
    expect(calls.indexOf('check-update')).toBeGreaterThan(calls.indexOf('verify-cloud'));
    expect(calls.indexOf('activate')).toBeGreaterThan(calls.indexOf('check-update'));
  });

  it('allows a durably saved pending revision without marking it synchronized', async () => {
    const { window, calls, messages } = harness({ dirty: 5, synced: 4, syncCompletes:false });
    const result = await window.UpdateSafety.safeUpdate();

    expect(result).toBe(true);
    expect(messages).toHaveLength(1);
    expect(calls).toContain('check-update');
    expect(window.UpdateSafety.syncMetaPending()).toBe(true);
  });
  it('persists and uploads an actual in-memory edit before promotion',async()=>{
    const h=harness();h.context.db.eventos.push({id:'new-event'});
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(true);
    expect(h.calls.filter(x=>x==='save-local')).toHaveLength(1);
    expect(h.calls.filter(x=>x==='cloud-write')).toHaveLength(1);
    expect(JSON.parse(h.storage.get('alberto_piano_v2')).eventos).toEqual([{id:'new-event'}]);
  });
  it('ten clean openings do not produce writes or revision churn',async()=>{
    const h=harness({dirty:12,synced:12});
    for(let index=0;index<10;index+=1) expect(await h.window.UpdateSafety.safeUpdate()).toBe(true);
    expect(h.calls).not.toContain('save-local');
    expect(h.calls).not.toContain('cloud-write');
    expect(JSON.parse(h.storage.get('alberto_piano_v2'))._localRevision).toBe(12);
  });
  it('does not promote the worker if an edit arrives while update() awaits the server',async()=>{
    const h=harness();
    h.registration.update=async()=>{
      h.context.db.eventos.push({id:'just-created'});
      h.storage.set('alberto_piano_v2',JSON.stringify(h.context.db));
      h.storage.set('alberto_sync_v1',JSON.stringify({dirtyRevision:2,lastSyncedRevision:1}));
    };
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(false);
    expect(h.messages).toHaveLength(0);
    expect(JSON.parse(h.storage.get('alberto_piano_v2')).eventos[0].id).toBe('just-created');
  });
  it('blocks activation when neither localStorage nor the rescue durably holds current memory',async()=>{
    const h=harness();h.context.db.obras=[{id:'unsaved'}];
    h.window.saveLocalNow=()=>h.calls.push('save-local-noop');
    h.context.saveLocalNow=h.window.saveLocalNow;
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(false);
    expect(h.messages).toHaveLength(0);
  });
  it('accepts an exact IndexedDB rescue when localStorage is full',async()=>{
    const h=harness({dirty:2,synced:1,syncCompletes:false});
    h.context.db.eventos.push({id:'in-rescue'});
    h.window.saveLocalNow=()=>{};h.context.saveLocalNow=h.window.saveLocalNow;
    h.window.LocalSaveResilience.getRescueSnapshot=async()=>({data:structuredClone(h.context.db)});
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(true);
    expect(h.messages).toHaveLength(1);
  });
  it('controllerchange snapshots once and cannot enter a reload loop',async()=>{
    const h=harness();
    await h.listeners.controllerchange();await h.listeners.controllerchange();
    expect(h.calls.filter(x=>x==='reload')).toHaveLength(1);
    expect(h.calls).not.toContain('save-local');
  });
  it('the first worker claim does not reload a newly opened app',async()=>{
    const h=harness({controlled:false});await h.listeners.controllerchange();
    expect(h.calls).not.toContain('reload');
  });
  it('an explicit update reloads even if iOS reported no initial controller',async()=>{
    const h=harness({controlled:false});
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(true);
    await h.listeners.controllerchange();
    expect(h.calls.filter(x=>x==='reload')).toHaveLength(1);
    expect(h.calls).not.toContain('save-local');
  });
  it('temporary network failure keeps local data and pending synchronization while applying the fix',async()=>{
    const h=harness({dirty:2,synced:1});const before=h.storage.get('alberto_piano_v2');
    h.window.syncPendingCloudChanges=async()=>{throw Error('offline');};
    h.context.syncPendingCloudChanges=h.window.syncPendingCloudChanges;
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(true);
    expect(h.messages).toHaveLength(1);expect(h.storage.get('alberto_piano_v2')).toBe(before);
    expect(h.window.UpdateSafety.syncMetaPending()).toBe(true);
  });
});
