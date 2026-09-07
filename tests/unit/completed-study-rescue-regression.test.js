import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../crono-save-resilience.js', import.meta.url), 'utf8');

describe('completed study rescue regression', () => {
  it('compiles the durable rescue layer', () => {
    expect(() => new vm.Script(source)).not.toThrow();
  });

  it('queues the permanent plant rescue before normal local persistence', () => {
    const start = source.indexOf('function installFinishPatch()');
    const rescueAt = source.indexOf('queueRescue(entry);', start);
    const localSaveAt = source.indexOf('const saveResult=saveLocalNow();', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(rescueAt).toBeGreaterThan(start);
    expect(localSaveAt).toBeGreaterThan(rescueAt);
  });

  it('captures the whole document after the Hecho modal closes', () => {
    expect(source).toContain('function installHechoPatch()');
    expect(source).toContain("typeof closeHechoDatos!=='function'");
    expect(source).toContain('queueDocumentRescue(obraId);');
    expect(source).toContain("kind:'completed-study-document'");
  });

  it('keeps the latest completed-session document rescue after an apparently clean sync', () => {
    expect(source).toContain('DOCUMENT_RESCUE_MAX_AGE_MS=48*60*60*1000');
    expect(source).toContain("rows.filter(row=>row?.id!==DOCUMENT_RESCUE_ID)");
    expect(source).toContain('hasDocumentSnapshot');
    expect(source).toContain('flush:flushRescueWrites');
  });

  it('merges a retained document rescue back on boot before deleting additive plant rescues', () => {
    expect(source).toContain('mergeDocumentRescue(local,documentRow)');
    expect(source).toContain('window.DocumentSyncCore.merge(local,row.data)');
    expect(source).toContain('window.DocumentSyncCore.assign(local,recovered)');
  });
});
