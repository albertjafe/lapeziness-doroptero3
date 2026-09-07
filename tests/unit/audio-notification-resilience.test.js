import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TimerCore = require('../../timer-core.js');

describe('audio and background notification resilience', () => {
  it('keeps the client and server timer schedules aligned at 10, 5 and 1 minutes', () => {
    const migration = fs.readFileSync(
      'supabase/migrations/20260907205158_timer_notifications_10_5_1.sql',
      'utf8'
    );

    expect(TimerCore.TIMER_WARNING_MINUTES).toEqual([10, 5, 1]);
    expect(migration).toContain('current_warning = any(array[10, 5, 1])');
    expect(migration).toContain("interval '120 minutes'");
    expect(migration).toContain('current_milestone between 15 and 105');
  });

  it('rebuilds both audio engines after browser lifecycle interruption', () => {
    const app = fs.readFileSync('app.js', 'utf8');
    const metronome = fs.readFileSync('metronome.js', 'utf8');

    expect(app).toContain("_discardAudioContext('bfcache')");
    expect(app).toContain("created.state === 'interrupted'");
    expect(app).toContain('_acNeedsGestureReset = true');
    expect(metronome).toContain("created.state === 'closed' || created.state === 'interrupted'");
    expect(metronome).toContain('recoverAudio(true)');
    expect(metronome).toContain('master.gain.value = 2.35');
    expect(metronome).toContain('filter.frequency.value = accented ? 2700 : 3400');
  });

  it('retries registration of the active run used by background push', () => {
    const pushClient = fs.readFileSync('push-client.js', 'utf8');

    expect(pushClient).toContain('const SYNC_RETRY_DELAYS_MS = [0, 1200, 4000]');
    expect(pushClient).toContain('if (await syncRunAttempt(options)) return true');
  });
});
