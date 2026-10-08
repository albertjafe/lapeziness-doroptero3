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

describe('records with different ids',()=>{
  it('a new habit challenge replaces the old one instead of inheriting its fields',()=>{
    const stored={habitChallenge:{id:'habit_old',title:'Viejo',completedAt:'2026-08-22',rewardClaimedAt:'2026-10-06T09:44:08Z',
      logs:{'2026-08-02':{status:'failed'}},updatedAt:'2026-08-22T10:00:00Z'}};
    const incoming={habitChallenge:{id:'habit_new',title:'Nuevo',startDate:'2026-10-07',logs:{'2026-10-07':{status:'failed'}},updatedAt:'2026-10-08T10:00:00Z'}};
    expect(Doc.mergeRemote(stored,incoming).habitChallenge).toEqual(incoming.habitChallenge);
    // Al revés (el servidor ya tiene el nuevo): el viejo de otro dispositivo no lo pisa.
    expect(Doc.mergeRemote(incoming,stored).habitChallenge).toEqual(incoming.habitChallenge);
  });
  it('the same record still merges field by field',()=>{
    const a={habitChallenge:{id:'h',title:'A',logs:{'2026-10-07':{status:'failed'}},updatedAt:'2026-10-07T10:00:00Z'}};
    const b={habitChallenge:{id:'h',title:'A',logs:{'2026-10-08':{status:'failed'}},updatedAt:'2026-10-08T10:00:00Z'}};
    expect(Object.keys(Doc.mergeRemote(a,b).habitChallenge.logs).sort()).toEqual(['2026-10-07','2026-10-08']);
  });
});
