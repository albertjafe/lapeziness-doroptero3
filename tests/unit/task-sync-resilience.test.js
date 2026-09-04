import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const TaskSync = require('../../task-sync-resilience.js');

const iso = ms => new Date(ms).toISOString();

describe('task sync resilience', () => {
  it('lets a newer device snapshot remove stale remote tasks while preserving its new task', () => {
    const old = { id: 't1783244267661', text: 'old task', createdAt: iso(1783244267661) };
    const fresh = { id: 't1788460000000', text: 'new iPad task', createdAt: iso(1788460000000) };
    const merged = TaskSync.mergeTaskState([fresh], [old], [], [], {
      preferLocalOnTie: true,
      authoritativeAbsenceAt: 1788461000000,
    });

    expect(merged.tasks.map(task => task.id)).toEqual([fresh.id]);
    expect(merged.tombstones.some(item => item.id === old.id)).toBe(true);
  });

  it('does not delete a genuinely newer remote task when applying an older absence snapshot', () => {
    const local = { id: 't1788460000000', text: 'local', createdAt: iso(1788460000000) };
    const remoteNew = { id: 't1788463000000', text: 'remote new', createdAt: iso(1788463000000) };
    const merged = TaskSync.mergeTaskState([local], [remoteNew], [], [], {
      authoritativeAbsenceAt: 1788461000000,
    });
    expect(merged.tasks.map(task => task.id).sort()).toEqual([local.id, remoteNew.id].sort());
  });

  it('keeps deletions deleted through explicit tombstones', () => {
    const task = { id: 't1', text: 'deleted', updatedAt: '2026-09-03T18:00:00Z' };
    const tombstone = { id: 't1', deletedAt: '2026-09-03T19:00:00Z' };
    const merged = TaskSync.mergeTaskState([], [task], [tombstone], [], {});
    expect(merged.tasks).toHaveLength(0);
  });

  it('always publishes a revision above every local and remote revision', () => {
    const storage = {
      getItem(key) {
        if (key === 'alberto_sync_v1') return JSON.stringify({ localRevision: 944, dirtyRevision: 945, lastSyncedRevision: 943 });
        return null;
      },
    };
    expect(TaskSync.nextRevision({ _localRevision: 252 }, { _localRevision: 940 }, { revision: 946 }, storage)).toBe(947);
  });

  it('recognizes a rescue with a newer task even if global revisions are tied', () => {
    const remote = { _localRevision: 945, cronoTasks: [{ id: 't1783244267661' }] };
    const rescue = { revision: 945, newestTaskAt: 1788460000000, tasks: [{ id: 't1788460000000' }] };
    expect(TaskSync.isRescueAuthoritative(rescue, remote)).toBe(true);
  });

  it('captures tasks before app.js and loads the recovery layer afterwards', () => {
    const syncCore = fs.readFileSync('sync-core.js', 'utf8');
    const loader = fs.readFileSync('piano-rooms.js', 'utf8');
    expect(syncCore.indexOf('preSyncTaskRescue')).toBeGreaterThanOrEqual(0);
    expect(syncCore.indexOf('preSyncTaskRescue')).toBeLessThan(syncCore.indexOf('root.SyncCore'));
    const html = fs.readFileSync('index.html','utf8');
    expect(html.indexOf('task-sync-bootstrap.js')).toBeLessThan(html.indexOf('src="app.js'));
    expect(loader).toContain("./task-sync-resilience.js?v=342");
  });

  it('ships a database guard against revision regression', () => {
    const sql = fs.readFileSync('supabase/migrations/202609030003_task_sync_revision_guard.sql', 'utf8');
    expect(sql).toContain('if new_rev < old_rev');
    expect(sql).toContain('return old');
  });
});
