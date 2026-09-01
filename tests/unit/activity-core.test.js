import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Activity = require('../../activity-core.js');

function row(overrides) {
  return Object.assign({
    device_id: 'pc',
    device_type: 'windows',
    source: 'activitywatch_window',
    started_at: '2026-09-01T08:00:00Z',
    ended_at: '2026-09-01T08:10:00Z',
    app: 'code.exe',
    domain: null,
    category: 'productive',
    is_afk: false,
  }, overrides || {});
}

describe('ActivityCore', () => {
  it('uses web activity instead of double-counting an overlapping browser window', () => {
    const rows = [
      row({ app: 'chrome.exe', category: 'other', started_at: '2026-09-01T08:00:00Z', ended_at: '2026-09-01T08:10:00Z' }),
      row({ source: 'activitywatch_web', app: 'Navegador', domain: 'youtube.com', category: 'entertainment', started_at: '2026-09-01T08:00:05Z', ended_at: '2026-09-01T08:09:55Z' }),
    ];
    const summary = Activity.summarize(rows);
    expect(summary.trackedSeconds).toBe(590);
    expect(summary.categories.entertainment).toBe(590);
    expect(summary.categories.other).toBeUndefined();
  });

  it('keeps browser-window time when the web watcher is not installed', () => {
    const summary = Activity.summarize([
      row({ app: 'msedge.exe', category: 'other', started_at: '2026-09-01T08:00:00Z', ended_at: '2026-09-01T08:10:00Z' }),
    ]);
    expect(summary.trackedSeconds).toBe(600);
  });

  it('never counts AFK events as tracked activity', () => {
    const summary = Activity.summarize([
      row({ source: 'activitywatch_afk', app: 'Ausente', is_afk: true, category: 'other' }),
      row({ app: 'musescore.exe', category: 'piano', started_at: '2026-09-01T09:00:00Z', ended_at: '2026-09-01T09:30:00Z' }),
    ]);
    expect(summary.trackedSeconds).toBe(1800);
    expect(summary.categories.piano).toBe(1800);
  });

  it('merges adjacent equal blocks and counts real context switches', () => {
    const summary = Activity.summarize([
      row({ started_at: '2026-09-01T08:00:00Z', ended_at: '2026-09-01T08:05:00Z', app: 'code.exe' }),
      row({ started_at: '2026-09-01T08:05:10Z', ended_at: '2026-09-01T08:10:00Z', app: 'code.exe' }),
      row({ started_at: '2026-09-01T08:11:00Z', ended_at: '2026-09-01T08:20:00Z', app: 'Navegador', source: 'activitywatch_web', domain: 'reddit.com', category: 'social' }),
    ]);
    expect(summary.timeline).toHaveLength(2);
    expect(summary.switches).toBe(1);
    expect(summary.trackedSeconds).toBe(1140);
  });

  it('formats durations for the daily report', () => {
    expect(Activity.formatDuration(0)).toBe('0 min');
    expect(Activity.formatDuration(3600)).toBe('1 h');
    expect(Activity.formatDuration(4500)).toBe('1 h 15 min');
  });
});
