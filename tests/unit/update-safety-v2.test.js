import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(rootDir, 'update-safety.js'), 'utf8');

function harness({ dirty = 1, synced = 1 } = {}) {
  const storage = new Map([
    ['alberto_piano_v2', JSON.stringify({ _localRevision: dirty, _savedAt: '2026-09-04T10:00:00Z', sessionPlants: [{ id: 'recent' }], eventos: [] })],
    ['alberto_sync_v1', JSON.stringify({ localRevision: dirty, dirtyRevision: dirty, lastSyncedRevision: synced })],
  ]);
  const calls = [];
  const messages = [];
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
    navigator: { serviceWorker: { getRegistration: () => Promise.resolve(registration) } },
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
    setTimeout,
  };
  const context = {
    window,
    document,
    db: { _localRevision: dirty, _savedAt: '2026-09-04T10:00:00Z', sessionPlants: [{ id: 'recent' }], eventos: [] },
    swDoUpdate: window.swDoUpdate,
    saveLocalNow: window.saveLocalNow,
    syncPendingCloudChanges: window.syncPendingCloudChanges,
    enqueueCloudSync: window.enqueueCloudSync,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Number,
    console,
  };
  vm.runInNewContext(source, context);
  return { window, calls, messages, storage };
}

describe('UpdateSafety v2', () => {
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
});
