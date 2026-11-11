import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),S=require('../../diario-sections.js'),D=require('../../diario.js');
const fixture=()=>({obras:[{id:'a',movimientos:[{id:'m',name:'I'}]},{id:'b'}],future:{kept:7},
  passageTracker:{passages:[{id:'p',obraId:'a',movId:'m',name:'Octavas',future:9},{id:'gone',obraId:'a',name:'Borrado',deletedAt:'2026-01-01'}]},
  journalSections:[{id:'b1',obraId:'b',name:'Desarrollo'}]});
describe('named sections in the diary',()=>{
  it('isolates movements and General, with stable names shared only within that movement',()=>{
    const data=fixture();
    data.obras[0].movimientos.push({id:'m2',name:'II'});
    const now=new Date('2026-11-11T12:00:00Z');
    expect(S.register(data,'a','Octavas',now,'m').id).toBe('p');
    const second=S.register(data,'a','Octavas',now,'m2');
    const general=S.register(data,'a','Octavas',now,null);
    expect(new Set(['p',second.id,general.id]).size).toBe(3);
    expect(S.register(data,'a','ÓCTAVAS',now,'m2').id).toBe(second.id);
    expect(S.catalog(data,'a','m2').map(x=>x.id)).toEqual([second.id]);
    expect(S.catalog(data,'a',null).map(x=>x.id)).toEqual([general.id]);
    expect(S.references('[[Octavas]]',S.catalog(data,'a','m2'))).toEqual([expect.objectContaining({id:second.id,movId:'m2'})]);
    expect(S.register(data,'a','Error',now,'missing')).toBeNull();
    const other=fixture();other.obras[0].movimientos.push({id:'m2',name:'II'});
    expect(S.register(other,'a','Octavas',now,'m2').id).toBe(second.id);
  });
  it('suggests only this work, reuses passages and never mutates during lookup',()=>{
    const data=fixture(),before=structuredClone(data);
    expect(S.suggest(data,'a','oct')).toEqual([expect.objectContaining({id:'p',kind:'passage',movement:'I'})]);
    expect(S.suggest(data,'a','des')).toEqual([]);
    expect(S.catalog(data,'')).toEqual([]);
    expect(S.catalog(data,'a').map(x=>x.id)).toEqual(['p']);
    expect(data).toEqual(before);
  });
  it('creates once, deduplicates spelling/case/accents within a work, and keeps unknown fields',()=>{
    const data=fixture(),a=S.register(data,'a','  Desarrollo  '),again=S.register(data,'a','desarróllo');
    expect(a.id).toBe(again.id);
    expect(S.register(data,'b','Desarrollo').id).toBe('b1');
    expect(S.register(data,'a','Octavas').id).toBe('p');
    expect(data.journalSections).toHaveLength(2);
    expect(data.passageTracker.passages[0].future).toBe(9);
    expect(data.future).toEqual({kept:7});
  });
  it('does not create unowned, empty or ambiguous names',()=>{
    const data=fixture();
    expect(S.register(data,'missing','Octavas')).toBeNull();
    expect(S.register(data,'a','[]\n')).toBeNull();
    data.passageTracker.passages.push({id:'p2',obraId:'a',name:'Octavas',movId:'m2'});
    expect(S.register(data,'a','Octavas')).toBeNull();
  });
  it('recognizes @ only at the start of a line and inserts without losing adjacent text',()=>{
    expect(S.queryAt('mail@example.org',10)).toBeNull();
    expect(S.queryAt('Notas\n@Oct',10)).toEqual({start:6,end:10,query:'Oct'});
    const next=S.insert('Notas\n@Oct\nDespués',{start:6,end:10},{name:'Octavas'});
    expect(next.value).toBe('Notas\n[[Octavas]]\nDespués');
    expect(next.value.slice(next.caret)).toBe('Después');
  });
  it('preserves stable references when the catalog changes, and drops removed references',()=>{
    const previous=[{id:'p',kind:'passage',name:'Octavas',obraId:'a'}];
    expect(S.references('[[Octavas]]\nMejor hoy',[],previous)).toEqual(previous);
    expect(S.references('Ya no hay encabezado',[],previous)).toEqual([]);
  });
  it('saves section identity and original block context on the same daily entry',()=>{
    const data=fixture(),refs=[{id:'p',kind:'passage',name:'Octavas',obraId:'a'}];
    const id=D.write(data,{key:'2026-11-09',ref:'p:run',about:'Work · 09:00–10:00',obraId:'a',text:'[[Octavas]]\nLento',sectionRefs:refs});
    expect(data.dailyJournalEntries[0]).toMatchObject({id,day:'2026-11-09',ref:'p:run',obraId:'a',sectionRefs:refs});
    data.dailyJournalEntries[0].future={keep:true};
    D.write(data,{id,text:'[[Octavas]]\nLento',sectionRefs:[]});
    expect(data.dailyJournalEntries[0].sectionRefs).toEqual([]);
    expect(data.dailyJournalEntries[0].future).toEqual({keep:true});
    expect(data.dailyJournalEntries[0].about).toBe('Work · 09:00–10:00');
  });
  it('renders headings safely without changing task line identities',()=>{
    const html=D.formatHtml('[[<img onerror=x>]]\nTareas:\n- Afinar');
    expect(html).toContain('dia-section-heading');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img onerror=x&gt;');
    expect(html).toContain('data-line="2"');
    expect(D.toggleLine('[[Octavas]]\n- Afinar',1)).toBe('[[Octavas]]\n- [x] Afinar');
  });
});

it('independent devices create the same section identity without merging different works',()=>{
  const left=fixture(),right=fixture();
  const a=S.register(left,'a','Desarrollo'),b=S.register(right,'a','desarróllo');
  expect(a.id).toBe(b.id);
  expect(S.register(right,'b','Otra sección').id).not.toBe(a.id);
  const Sync=require('../../document-sync-core.js');
  expect(Sync.mergeRemote(left,right).journalSections.filter(x=>x.id===a.id)).toHaveLength(1);
});
