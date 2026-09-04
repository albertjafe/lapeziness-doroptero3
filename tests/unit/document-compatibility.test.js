import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { staleDocumentCases } from '../fixtures/stale-document-cases.js';
const require = createRequire(import.meta.url);
const Doc = require('../../document-sync-core.js');
const t1 = '2026-09-04T10:00:00.000Z', t2 = '2026-09-04T11:00:00.000Z';
function base() { return { obras:[{ id:'w', name:'Sonata', dificultad:5, movimientos:[{ id:'m', name:'I', sol:50 }] }],
  eventos:[{ id:'e', nombre:'Proyecto', fechaFlexibleTipo:'mes', fechaObjetivoMes:'2026-10', nuevoCampoFuturo:{ a:1,b:2 } }],
  cronoTasks:[{ id:'t', text:'ensayo', done:false }], sessionPlants:[] }; }
function change(input, mutation, stamp=t1) { const next=structuredClone(input); mutation(next); return Doc.track(next,input,stamp); }

describe('passage normalizer compatibility',()=>{
  it('keeps distinct same-time observations and the same movement in multiple rounds',()=>{
    const a={solHistory:[{date:'2026-09-04T10:00:00Z',context:'pase-antes',val:51}],repertorioPlanificado:[{obraId:'w',movimientoId:'m',uso:'video',ronda:'preseleccion'}]};
    const b={solHistory:[{date:'2026-09-04T10:00:00Z',context:'pase-despues',val:70}],repertorioPlanificado:[{obraId:'w',movimientoId:'m',uso:'directo',ronda:'final'}]};
    const merged=Doc.merge(a,b);expect(merged.solHistory).toHaveLength(2);expect(merged.repertorioPlanificado).toHaveLength(2);
    expect(Doc.merge(merged,merged)).toEqual(merged);
  });
  it('retains future root and record properties while preserving live references across reads',()=>{
    const data={passageTracker:{version:4,futurePolicy:{x:1},passages:[{id:'p',futureNotation:['cue']}],observations:[]}};
    const context={db:data,DocumentSyncCore:Doc,document:{readyState:'loading',addEventListener(){}}};context.window=context;
    vm.createContext(context);vm.runInContext(fs.readFileSync('passage-tracker.js','utf8'),context);
    const live=data.passageTracker;context.PassageTracker.getTracker();
    expect(data.passageTracker).toBe(live);live.observations.push({id:'o',coldScore:5,futureConfidence:.9});
    expect(context.PassageTracker.getTracker()).toMatchObject({version:4,futurePolicy:{x:1},observations:[{id:'o',futureConfidence:.9}]});
    const merged=context.PassageTracker.mergeTrackers(data.passageTracker,{version:1,passages:[{id:'p',name:'Editado'}],observations:[]});
    expect(merged).toMatchObject({version:4,futurePolicy:{x:1},passages:[{id:'p',name:'Editado',futureNotation:['cue']}],observations:[{id:'o'}]});
  });
});

describe('Conservative user document across devices and versions', () => {
  it.each(staleDocumentCases)('$name', ({stored,incoming,expected}) => {
    const saved=JSON.stringify([stored,incoming]);
    expect(Doc.merge(stored,incoming)).toMatchObject(expected);
    expect(Doc.merge(incoming,stored)).toMatchObject(expected);
    expect(JSON.stringify([stored,incoming])).toBe(saved);
  });

  it('preserves editor references through two successive synchronous saves', () => {
    const d=base(), event=d.eventos[0], work=d.obras[0], movements=work.movimientos;
    const tracked=change(d,x=>{x.obras[0].dificultad=8;});
    Doc.assign(d,Doc.merge(d,tracked));
    expect(d.obras[0]).toBe(work); expect(work.movimientos).toBe(movements);
    event.fechaObjetivoMes='2026-11';
    expect(Doc.merge(tracked,Doc.track(d,tracked,t2)).eventos[0].fechaObjetivoMes).toBe('2026-11');
  });
  it.each([
    ['work', d=>d.obras.push({ id:'new',name:'Nueva obra' }), d=>d.obras.some(w=>w.id==='new')],
    ['movement', d=>d.obras[0].movimientos.push({ id:'new',name:'III' }), d=>d.obras[0].movimientos.some(m=>m.id==='new')],
    ['solidity', d=>{d.obras[0].movimientos[0].sol=84;},d=>d.obras[0].movimientos[0].sol===84],
    ['event', d=>d.eventos.push({ id:'new',fecha:'2026-11-04' }),d=>d.eventos.some(e=>e.id==='new')],
    ['monthly project', d=>d.eventos.push({ id:'new',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2026-12' }),d=>d.eventos.find(e=>e.id==='new')?.fechaObjetivoMes==='2026-12'],
    ['task', d=>d.cronoTasks.push({id:'new',text:'llamar'}), d=>d.cronoTasks.some(t=>t.id==='new')],
    ['timer record', d=>d.sessionPlants.push({id:'new',obraId:'w',movId:'m',mins:25}),d=>d.sessionPlants.length===1],
  ])('preserves a new %s across serialization and a stale-device write', (_,mutation,check) => {
    const old=base(), newer=JSON.parse(JSON.stringify(change(old,mutation)));
    const stale=change(old,d=>{d.settings={ theme:'dark' };},t2);
    expect(check(Doc.merge(newer,stale))).toBe(true);
    expect(check(Doc.merge(stale,newer))).toBe(true);
  });
  it('keeps two independent fields edited on different devices', () => {
    const old=base();
    const a=change(old,d=>{d.obras[0].dificultad=9;});
    const b=change(old,d=>{d.obras[0].movimientos[0].sol=88;},t2);
    expect(Doc.merge(a,b).obras[0]).toMatchObject({ dificultad:9,movimientos:[{sol:88}] });
    expect(Doc.merge(b,a)).toEqual(Doc.merge(a,b));
  });
  it('retains nested unknown properties when an older compatible normalizer saves', () => {
    const old=base(), legacy=structuredClone(old);
    delete legacy.eventos[0].fechaFlexibleTipo; delete legacy.eventos[0].fechaObjetivoMes;
    legacy.eventos[0].nuevoCampoFuturo={ a:1 }; legacy.eventos[0].nombre='Editado';
    const r=Doc.merge(old,Doc.track(legacy,old,t2));
    expect(r.eventos[0]).toMatchObject({nombre:'Editado',fechaFlexibleTipo:'mes',fechaObjetivoMes:'2026-10',nuevoCampoFuturo:{a:1,b:2}});
  });
  it('an explicit task deletion survives an older device and retry', () => {
    const old=base(), deleted=change(old,d=>{d.cronoTasks=[];});
    expect(Doc.merge(deleted,old).cronoTasks).toEqual([]);
    expect(Doc.merge(old,deleted).cronoTasks).toEqual([]);
  });
  it('does not duplicate timer records during retries and preserves a correction', () => {
    const old=base(); old.sessionPlants=[{id:'r',mins:25,startedAt:t1}];
    const corrected=change(old,d=>{d.sessionPlants[0].mins=20;},t2);
    let result=corrected;
    for(let i=0;i<5;i++) result=Doc.merge(result,old);
    expect(result.sessionPlants).toHaveLength(1);
    expect(result.sessionPlants[0].mins).toBe(20);
  });
  it('does not resurrect event or task tombstones from legacy snapshots', () => {
    const old=base();
    expect(Doc.merge(old,{planningEventTombstones:['e'],cronoTaskTombstones:[{id:'t',deletedAt:t2}]})).toMatchObject({ eventos:[],cronoTasks:[] });
  });
});
