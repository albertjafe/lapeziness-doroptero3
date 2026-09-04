import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(rootDir, 'update-safety.js'), 'utf8');

function harness({ dirty = 1, synced = 1, controlled = true } = {}) {
  const storage = new Map([
    ['alberto_piano_v2', JSON.stringify({ _localRevision: dirty, _savedAt: '2026-09-04T10:00:00Z', sessionPlants: [{ id: 'recent' }], eventos: [] })],
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
  const window = {
    document,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    navigator: { serviceWorker: { controller:controlled ? {} : null, getRegistration: () => Promise.resolve(registration), addEventListener:(type,fn)=>{listeners[type]=fn;} } },
    location:{reload:()=>calls.push('reload')},
    swDoUpdate() {},
    saveLocalNow() { calls.push('save-local'); },
    enqueueCloudSync() { calls.push('enqueue'); },
    syncPendingCloudChanges() { calls.push('sync'); return Promise.resolve(true); },
    LocalSaveResilience: {
      retryMeta() { calls.push('retry-meta'); },
      hasPendingRescue: () => false,
      hasPendingMeta: () => false,
    },
    CronoSaveResilience: { protectCloud() { calls.push('verify-cloud'); return Promise.resolve(true); } },
    showToast(message) { calls.push(`toast:${message}`); },
    setTimeout:schedule,
    clearTimeout,
  };
  const context = {
    window,
    document,
    db: { _localRevision: dirty, _savedAt: '2026-09-04T10:00:00Z', sessionPlants: [{ id: 'recent' }], eventos: [] },
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

describe('UpdateSafety v3', () => {
  it('persists, syncs and verifies before activating the waiting worker', async () => {
    const { window, calls, messages } = harness({ dirty: 4, synced: 4 });
    const result = await window.UpdateSafety.safeUpdate();

    expect(result).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'SAFE_SKIP_WAITING', safe: true });
    expect(calls.indexOf('save-local')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('sync')).toBeGreaterThan(calls.indexOf('save-local'));
    expect(calls.indexOf('verify-cloud')).toBeGreaterThan(calls.indexOf('sync'));
    expect(calls.indexOf('check-update')).toBeGreaterThan(calls.indexOf('verify-cloud'));
    expect(calls.indexOf('activate')).toBeGreaterThan(calls.indexOf('check-update'));
  });

  it('refuses activation when a local revision is still pending', async () => {
    const { window, calls, messages } = harness({ dirty: 5, synced: 4 });
    const result = await window.UpdateSafety.safeUpdate();

    expect(result).toBe(false);
    expect(messages).toHaveLength(0);
    expect(calls).not.toContain('check-update');
    expect(calls.some(call => call.startsWith('toast:No se actualiza'))).toBe(true);
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
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(false);
    expect(h.messages).toHaveLength(0);
  });
  it('controllerchange snapshots once and cannot enter a reload loop',async()=>{
    const h=harness();
    await h.listeners.controllerchange();await h.listeners.controllerchange();
    expect(h.calls.filter(x=>x==='reload')).toHaveLength(1);
    expect(h.calls.indexOf('save-local')).toBeLessThan(h.calls.indexOf('reload'));
  });
  it('the first passive worker claim does not reload a newly opened app',async()=>{
    const h=harness({controlled:false});await h.listeners.controllerchange();
    expect(h.calls).not.toContain('reload');
  });
  it('an explicit update reloads even if iOS reported no initial controller',async()=>{
    const h=harness({controlled:false});
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(true);
    expect(h.messages).toHaveLength(1);
    await h.listeners.controllerchange();
    expect(h.calls.filter(x=>x==='reload')).toHaveLength(1);
    expect(h.calls.indexOf('save-local')).toBeLessThan(h.calls.indexOf('reload'));
  });
  it('temporary network failure keeps local data and does not activate',async()=>{
    const h=harness({dirty:2,synced:1});const before=h.storage.get('alberto_piano_v2');
    h.context.syncPendingCloudChanges=async()=>{throw Error('offline');};
    expect(await h.window.UpdateSafety.safeUpdate()).toBe(false);
    expect(h.messages).toHaveLength(0);expect(h.storage.get('alberto_piano_v2')).toBe(before);
  });
});
