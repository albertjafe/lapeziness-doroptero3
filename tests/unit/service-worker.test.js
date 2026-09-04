import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadWorker() {
  const handlers = {};
  const notifications = [];
  let skipWaitingCalls = 0;
  const cache = { addAll: () => Promise.resolve(), put: () => Promise.resolve() };
  const self = {
    addEventListener(type, handler) { handlers[type] = handler; },
    skipWaiting() { skipWaitingCalls += 1; return Promise.resolve(); },
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve() },
    registration: {
      scope: 'https://example.test/app/',
      showNotification(title, options) {
        notifications.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  const caches = {
    open: () => Promise.resolve(cache),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
    match: () => Promise.resolve(undefined),
  };
  class WorkerRequest {
    constructor(url, options) { this.url = url; this.options = options || {}; this.method = 'GET'; this.mode = 'same-origin'; }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), {
    self,
    caches,
    URL,
    Request: WorkerRequest,
    Response,
    fetch,
    Promise,
    Number,
    String,
  });
  return { handlers, notifications, getSkipWaitingCalls: () => skipWaitingCalls };
}

async function deliver(handler, payload) {
  let pending;
  handler({
    data: { json: () => payload },
    waitUntil(promise) { pending = promise; },
  });
  await pending;
}

describe('service worker push guard', () => {
  it('suppresses orphaned stopwatch milestones but keeps valid ones', async () => {
    const { handlers, notifications } = loadWorker();

    await deliver(handlers.push, {
      title: 'Has logrado 11070 minutos',
      tag: 'crono-milestone-old-run-11070',
      data: { view: 'cronometro' },
    });
    expect(notifications).toHaveLength(0);

    await deliver(handlers.push, {
      title: 'Has logrado 105 minutos',
      tag: 'crono-milestone-current-run-105',
      data: { view: 'cronometro' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Has logrado 105 minutos');
  });

  it('does not activate a new version during install', async () => {
    const { handlers, getSkipWaitingCalls } = loadWorker();
    let pending;
    handlers.install({ waitUntil(promise) { pending = promise; } });
    await pending;
    expect(getSkipWaitingCalls()).toBe(0);
  });

  it('ignores legacy automatic SKIP_WAITING and only accepts the explicit safe message', () => {
    const { handlers, getSkipWaitingCalls } = loadWorker();

    handlers.message({ data: { type: 'SKIP_WAITING' } });
    expect(getSkipWaitingCalls()).toBe(0);

    handlers.message({ data: { type: 'SAFE_SKIP_WAITING', safe: true } });
    expect(getSkipWaitingCalls()).toBe(1);

    handlers.message({ data: { type: 'SAFE_SKIP_WAITING', safe: false } });
    expect(getSkipWaitingCalls()).toBe(1);
  });

  it('keeps cache-busted app assets aligned with index.html', () => {
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

    for (const asset of ['styles.css', 'app.js']) {
      const escaped = asset.replace('.', '\\.');
      const match = index.match(new RegExp(`["'](${escaped}\\?v=\\d+)["']`));
      expect(match, `${asset} should have a cache-busted reference in index.html`).not.toBeNull();
      expect(worker).toContain(`"./${match[1]}"`);
    }
  });
});
