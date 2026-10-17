import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), R=require('../../readiness-core.js');
const data=()=>({obras:[{id:'w',sol:40,movimientos:[]}],sesiones:[],forestPlants:[],
  sessionPlants:[{id:'p',obraId:'w',mins:20,startedAt:'2026-09-01T10:00:00Z',endedAt:'2026-09-01T10:20:00Z'}]});

describe('readiness calculation context',()=>{
  it('shares immutable calculation inputs within a call and refreshes after in-place edits',()=>{
    const db=data();
    R.withContext(db,()=>{
      const first=R.collectTimeline(db,'w');
      expect(R.collectTimeline(db,'w')).toBe(first);
      expect(R.estimateReadiness(db,'w').diagnostics.timeline).toBe(first);
    });
    db.sessionPlants[0].mins=35;
    expect(R.estimateReadiness(db,'w').diagnostics.realMinutes).toBe(35);
    expect(R.collectTimeline(db,'w').practice[0].minutes).toBe(35);
  });
  it('restores outer contexts after nested calculations and exceptions',()=>{
    const outer=data(),inner=data();inner.sessionPlants[0].mins=45;
    R.withContext(outer,()=>{
      const first=R.collectTimeline(outer,'w');
      expect(()=>R.withContext(inner,()=>{expect(R.collectTimeline(inner,'w').practice[0].minutes).toBe(45);throw Error('stop');})).toThrow('stop');
      expect(R.collectTimeline(outer,'w')).toBe(first);
    });
    outer.sessionPlants[0].mins=60;
    expect(R.collectTimeline(outer,'w').practice[0].minutes).toBe(60);
  });
});
