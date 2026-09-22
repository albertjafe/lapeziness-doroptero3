import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const D=createRequire(import.meta.url)('../../document-sync-core.js');

describe('conservative partial history uploads',()=>{
  it('sends only new practice instead of a multi-megabyte history',()=>{
    const server={forestPlants:Array.from({length:7426},(_,i)=>({id:'f'+i,mins:30,unknown:'history '.repeat(45)})),sessionPlants:Array.from({length:833},(_,i)=>({id:'p'+i,mins:30}))};
    const merged=D.mergeRemote(server,{sessionPlants:[{id:'today',mins:86}]});
    const delta=D.uploadDelta(server,merged);
    expect(JSON.stringify(server).length).toBeGreaterThan(2500000);
    expect(JSON.stringify(delta).length).toBeLessThan(100);
    expect(delta.forestPlants).toBeUndefined();expect(delta.sessionPlants).toEqual([{id:'today',mins:86}]);
    expect(D.sameContent(D.mergeRemote(server,delta),merged)).toBe(true);
  });
  it('preserves clocks, explicit clears, nested tombstones and unknown fields',()=>{
    const server={obras:[{id:'w',name:'Old',unknown:{keep:42},movimientos:[{id:'m1'},{id:'m2'}]}],preferences:{selection:['one'],nested:{future:'keep',value:1}},sessionPlants:[{id:'block',mins:30}],germanStudy:{cards:[{id:'c'}]}};
    const edit=structuredClone(server);edit.obras[0].name='New';edit.obras[0].movimientos.splice(0,1);edit.preferences.selection=[];edit.preferences.nested.value=null;edit.sessionPlants[0].mins=20;edit.germanStudy.cards=[];
    const merged=D.mergeRemote(server,D.track(edit,server,'2026-09-19T10:00:00Z'));
    const delta=D.uploadDelta(server,merged);
    expect(delta.obras[0].id).toBe('w');expect(delta.obras[0].unknown.keep).toBe(42);
    expect(delta.preferences._fieldClock.selection).toBeTruthy();
    expect(D.sameContent(D.mergeRemote(server,delta),merged)).toBe(true);
    expect(D.sameContent(D.mergeRemote(merged,delta),merged)).toBe(true);
  });
  it('keeps complete anonymous and composite-identity records and does not resend reordered JSON',()=>{
    const server={anonymous:[{weekStart:'2026-09-14',nested:{longer:1,a:2}}],items:[{obraId:'w',movId:'m',uso:'pass',value:1}]};
    const incoming={anonymous:[{nested:{a:2,longer:1},weekStart:'2026-09-14'}],items:[{obraId:'new',movId:'m',uso:'study',value:2}]};
    const merged=D.mergeRemote(server,incoming),delta=D.uploadDelta(server,merged);
    expect(delta.anonymous).toBeUndefined();expect(delta.items).toEqual(incoming.items);
    expect(D.sameContent(D.mergeRemote(server,delta),merged)).toBe(true);
  });
});
