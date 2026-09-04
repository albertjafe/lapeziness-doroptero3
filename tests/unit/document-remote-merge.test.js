import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {remoteDocumentCases} from '../fixtures/remote-document-cases.js';
const Doc=createRequire(import.meta.url)('../../document-sync-core.js');

describe('server-authoritative remote merge',()=>{
  it.each(remoteDocumentCases)('$name',({stored,incoming,expected})=>{
    const before=JSON.stringify([stored,incoming]);
    const merged=Doc.mergeRemote(stored,incoming);
    expect(merged).toMatchObject(expected);
    expect(Doc.mergeRemote(merged,incoming)).toEqual(merged);
    expect(JSON.stringify([stored,incoming])).toBe(before);
  });
  it('expresses server/client direction instead of treating remote revisions as comparable',()=>{
    const server={_localRevision:100,obras:[{id:'w',dificultad:9}]};
    const client={_localRevision:170,obras:[{id:'w',dificultad:5}]};
    expect(Doc.mergeRemote(server,client).obras[0].dificultad).toBe(9);
    expect(Doc.mergeRemote(client,server).obras[0].dificultad).toBe(5);
    // The local API remains available for snapshots from a single device.
    expect(Doc.merge(server,client).obras[0].dificultad).toBe(5);
  });
});
