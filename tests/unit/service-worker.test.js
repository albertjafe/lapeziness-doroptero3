import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadPushHandler() {
  const handlers = {};
  const notifications = [];
  const self = {
    addEventListener(type, handler) { handlers[type] = handler; },
    registration: {
      scope: 'https://example.test/app/',
      showNotification(title, options) {
        notifications.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), {
    self,
    caches: {},
    URL,
    Request,
    fetch,
    Promise,
    Number,
    String,
  });
  return { handler: handlers.push, notifications };
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
    const { handler, notifications } = loadPushHandler();

    await deliver(handler, {
      title: 'Has logrado 11070 minutos',
      tag: 'crono-milestone-old-run-11070',
      data: { view: 'cronometro' },
    });
    expect(notifications).toHaveLength(0);

    await deliver(handler, {
      title: 'Has logrado 105 minutos',
      tag: 'crono-milestone-current-run-105',
      data: { view: 'cronometro' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Has logrado 105 minutos');
  });
});
