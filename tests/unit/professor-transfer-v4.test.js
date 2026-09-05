import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handoff = require('../../professor-handoff-resilience.js');
const core = require('../../professor-core.js');
const now = '2026-09-05T12:00:00Z';
const emptyReport = () => ({asOf:now,units:[],events:[],today:{totalKnownMinutes:0},sourceContext:{}});

function policy() {
  const ctx={window:{},Date,Intl};
  vm.runInNewContext(fs.readFileSync('professor-duration-policy.js','utf8'),ctx);
  return ctx.window.ProfessorDurationPolicy;
}

describe('lossless single Professor transfer', () => {
  it('roundtrips all daily history, unknown fields, nulls, empty records and reserved table keys', () => {
    const report=emptyReport();
    report.works=[{id:'empty',name:''}];
    report.events=[{id:'no-links',workIds:[],future:null}];
    report.sourceContext={rows:Array.from({length:400},(_,i)=>({
      observationDate:'2026-09-01T10:20:30.123Z',movementIdentifier:'m'+i,actualPracticeMinutes:12.3456789,
      confidenceInEvidence:null,originalMusicalNote:'Nota | Unicode 🎹 \n C|no es una columna',
    })), empty:[], nothing:null, absentVsNull:[{}, {x:null}],
    collisions:[{$columns:['a'],$rows:[[1]]},{$object:[['a','literal']]},JSON.parse('{"__proto__":{"future":true}}')]};
    const encoded=handoff.denseContext(report);
    expect(handoff.decodeContext(encoded)).toEqual(report);
    expect(encoded).toContain('$columns');
    expect(encoded.length).toBeLessThan(JSON.stringify(report).length * .75);
    expect(()=>handoff.decodeContext(encoded.replace('FIN_PIANO_PROF_V4',''))).toThrow('incompleto');
    expect(handoff.decodeContext('C|una nota del usuario\n'+encoded)).toEqual(report);
  });

  it('keeps V3 reports readable after the codec update', () => {
    const old='PIANO_PROF_V3\nR|{"meta":{"asOf":"old"},"eventOrder":[],"hasPriorities":false}\nW|{"obraId":"w"}\nU|{"work":0,"data":{"key":"w"},"refs":{}}';
    expect(handoff.decodeContext(old)).toEqual({asOf:'old',events:[],units:[{obraId:'w',key:'w'}]});
  });

  it('returns a Blob containing task + note + complete context, not two giant string copies or a preliminary message', async () => {
    const report=emptyReport();report.sourceContext.note='Historial íntegro '.repeat(6000);
    const built=handoff.transferArtifact(report,{note:'Esta semana tengo ensayo',mode:'week'},{DEFAULT_MASTER_PROMPT:'Planifica con prudencia.'});
    expect(built.transport).toBe('file');
    expect(built.promptForUrl).toBeUndefined();expect(built.fullPrompt).toBeUndefined();
    expect(built.file).toBeInstanceOf(Blob);expect(built.file.size).toBe(built.byteLength);
    expect(new URL(built.url).searchParams.has('prompt')).toBe(false);
    const text=await built.file.text();
    expect(text).toContain('Planifica con prudencia.');expect(text).toContain('Esta semana tengo ensayo');
    expect(text).toContain('próximos 7 días');expect(text).toContain('no esperes un segundo mensaje');
    expect(handoff.decodeContext(text)).toEqual(report);
  });

  it('keeps a genuinely small complete transfer in its URL', () => {
    const built=handoff.buildSafeChatGptUrl(emptyReport(),{}, {DEFAULT_MASTER_PROMPT:'Planifica'});
    expect(built.transport).toBe('url');
    expect(new URL(built.url).searchParams.get('prompt')).toBe(built.promptForUrl);
  });

  it.each([4,5,6])('uses the chosen %s-hour daily reference and subtracts today only once', hours => {
    const text=policy().budgetContext(hours,{today:{totalKnownMinutes:100}},'today');
    expect(text).toContain(`Referencia guardada: ${hours===6?'6+':hours} horas TOTALES`);
    expect(text).toContain(`faltan ${hours*60-100} min`);
    expect(text).not.toContain('faltan -');
  });

  it('handles exceeded totals, 6+ flexibility, invalid old settings and the weekly meaning', () => {
    const p=policy();
    expect(p.normalizeHours('5')).toBe(5);expect(p.normalizeHours('invalid')).toBe(4);
    const text=p.budgetContext(6,{today:{totalKnownMinutes:500}},'week');
    expect(text).toContain('faltan 0 min');expect(text).toContain('ya alcanzado');
    expect(text).toContain('no obliga a 7 h');expect(text).toContain('diaria, no el total semanal');
    expect(p.RULES).toContain('condición explícita del usuario para este turno > preferencia diaria guardada');
  });

  it('provides a deduplicated daily timeline without removing older history or allocating whole-work time', () => {
    const data={obras:[{id:'w',movimientos:[{id:'i'},{id:'iii'}]}],eventos:[],sessionPlants:[
      {id:'old',obraId:'w',movId:'i',mins:90,at:'2025-01-01T12:00:00Z'},
      {id:'a',obraId:'w',movId:'i',mins:20,at:now},
      {id:'b',obraId:'w',movId:'iii',mins:30,at:'2026-09-04T12:00:00Z'},
      {id:'c',obraId:'w',mins:10,at:now},
    ],forestPlants:[{id:'mirror',obraId:'w',movId:'i',mins:20,at:now}],sesiones:[]};
    const report=core.buildReport(data,{asOf:new Date(now),googleCalendarState:{}});
    expect(report.recentStudyDays).toHaveLength(2);
    expect(report.recentStudyDays[0]).toMatchObject({day:'2026-09-05',totalMinutes:30});
    expect(report.recentStudyDays[0].byUnit).toContainEqual({obraId:'w',movId:null,minutes:10});
    const restored=handoff.decodeContext(handoff.denseContext(report));
    expect(restored.sourceContext.sessionPlants).toEqual(data.sessionPlants);
    expect(restored.sourceContext.forestPlants).toEqual(data.forestPlants);
    expect(restored.units.find(u=>u.movId==='i').recent.today).toBe(20);
  });
});
