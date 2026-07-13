import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SyncCore = require('../../sync-core.js');

describe('SyncCore', () => {
  it('tracks a dirty local revision until the matching cloud write completes', () => {
    const dirty = SyncCore.markDirty({ localRevision: 4, dirtyRevision: 4, lastSyncedRevision: 4 });
    expect(dirty).toEqual({ localRevision: 5, dirtyRevision: 5, lastSyncedRevision: 4 });
    expect(SyncCore.isDirty(dirty)).toBe(true);
    expect(SyncCore.isDirty(SyncCore.markSynced(dirty, 5))).toBe(false);
  });
});
