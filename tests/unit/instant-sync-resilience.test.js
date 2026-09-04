import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SyncResilience = require('../../instant-sync-resilience.js');

describe('InstantSyncResilience', () => {
  it('coalesces concurrent requests without overlapping writes', async () => {
    let running = 0;
    let maxRunning = 0;
    let calls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });

    const sync = SyncResilience.createSingleFlight(async () => {
      calls += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      if (calls === 1) await gate;
      await Promise.resolve();
      running -= 1;
      return calls;
    });

    const first = sync();
    const second = sync();
    const third = sync();
    release();
    await Promise.all([first, second, third]);

    expect(maxRunning).toBe(1);
    expect(calls).toBe(2);
  });
});
