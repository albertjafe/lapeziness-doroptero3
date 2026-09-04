import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

export function professorHarness() {
  const context = { console, Date, Intl, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: { addEventListener() {} }, addEventListener() {}, localStorage: { getItem: () => null } };
  context.window = context;
  vm.createContext(context);
  for (const file of ['professor-core.js', 'professor-report-normalizer.js', 'professor-context-enrichment.js',
    'professor-competition-deadline-bridge.js', 'professor-event-gate.js', 'professor-duration-policy.js', 'professor-handoff-resilience.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return context;
}
const now = new Date('2026-09-04T17:23:45Z');
const work = { id: 'w', name: 'Sonata | especial', tipo: 'camara', dificultad: 8, minutosExtra: 6000,
  movimientos: [{ id: 'i', name: 'I', sol: 90, solHistory: [{ val: 90, date: '2026-08-01T12:30:00Z', confidence: 'high' }] },
    { id: 'iii', name: 'III', sol: 40 }] };
function fixture() { return { obras: [structuredClone(work)], sessionPlants: [], eventos: [
  { id: 'e', nombre: 'Proyecto', estado: 'confirmado', fecha: '2026-10-31', fechaFlexibleTipo: 'mes', fechaObjetivoMes: '2026-10',
    obras: ['w'], professorMovements: { w: ['i', 'iii'] }, nuevoCampoFuturo: { purpose: 'memoria' } }], cronoTasks: [{ id: 't', text: 'Preparar ensayo' }] }; }

describe('Professor musical contracts through the real module chain', () => {
  it('keeps unknown difficulty and solidity distinct from estimation defaults and preserves passage evidence', () => {
    const h=professorHarness(),data=fixture();delete data.obras[0].dificultad;delete data.obras[0].movimientos[1].sol;
    data.passageTracker={version:3,future:{x:1},passages:[{id:'p',obraId:'w',movId:'iii'}],observations:[{id:'o',passageId:'p',coldScore:5,postScore:9}]};
    const r=h.ProfessorCore.buildReport(data,{asOf:now,googleCalendarState:{}}),unit=r.units.find(u=>u.movId==='iii');
    expect(unit.difficulty).toBeNull();expect(unit.difficultyForEstimation).toBe(5);expect(unit.solidity).toBeNull();
    expect(unit.priority.reasons.join(' ')).not.toContain('solidez 35%');
    expect(h.ProfessorHandoffResilience.decodeContext(h.ProfessorHandoffResilience.denseContext(r)).sourceContext.passageTracker).toEqual(data.passageTracker);
  });
  it('includes the current unsaved session in today once, excluding rests and already-saved run IDs',()=>{
    const h=professorHarness(),data=fixture();data.sessionPlants=[{id:'p',runId:'old',obraId:'w',movId:'i',mins:25,startedAt:now.toISOString()}];
    const active={state:'paused',runId:'live',obraId:'w',movId:'iii',elapsedMs:30*60000,startTs:now.getTime()-45*60000,pausedMs:15*60000,observation:'Reentradas'};
    const build=a=>h.ProfessorCore.buildReport(data,{asOf:now,googleCalendarState:{},activeSession:a});
    expect(build(active).today.totalKnownMinutes).toBe(55);expect(build(active).units.find(u=>u.movId==='iii').recent.today).toBe(30);
    expect(build(active).sourceContext.activeSession.observation).toBe('Reentradas');
    expect(build({...active,runId:'old'}).today.totalKnownMinutes).toBe(25);
    expect(build({...active,isRest:true}).today.totalKnownMinutes).toBe(25);
    expect(data.sessionPlants).toHaveLength(1);
  });
  it('does not multiply small percentage observations by ten',()=>{
    const h=professorHarness(),data=fixture();data.obras[0].movimientos[0].solHistory=[{val:5,date:now.toISOString()}];
    expect(h.ProfessorCore.buildReport(data,{asOf:now,googleCalendarState:{}}).units.find(u=>u.movId==='i').solidity).toBe(5);
  });
  it('preserves month precision, original evidence, confidence, tasks and unknown event fields in the handoff', () => {
    const h = professorHarness(), data = fixture();
    const report = h.ProfessorCore.buildReport(data, { asOf: now, googleCalendarState: {} });
    expect(report.events[0].datePrecision).toBe('month');
    expect(report.events[0].day).toBe('2026-10');
    expect(report.units.find(u => u.movId === 'i').evidenceConfidence).toBe('high');
    const text = h.ProfessorHandoffResilience.buildDensePrompt(report, { now }, h.ProfessorCore);
    for (const value of ['2026-10', 'month', '2026-08-01T12:30:00', 'high', 'Preparar ensayo', 'nuevoCampoFuturo', 'HORA_LOCAL_REAL', '5 horas TOTALES', '6 horas TOTALES']) expect(text).toContain(value);
  });
  it.each(['camara', 'concierto'])('%s keeps high individual solidity without invented ensemble penalties', tipo => {
    const h = professorHarness(), data = fixture(); data.obras[0].tipo = tipo;
    const r = h.ProfessorCore.buildReport(data, { asOf: now, googleCalendarState: {} });
    expect(r.units.find(u => u.movId === 'i').solidity).toBe(90);
    expect(r.units.find(u => u.movId === 'iii').solidity).toBe(40);
    expect(r.units.find(u => u.movId === 'i').daysSinceEvidence).toBeGreaterThan(30);
  });
  it('counts whole-work, unallocated, activity and manual-session study today exactly once', () => {
    const h = professorHarness(), data = fixture();
    data.obras.push({ id: 'single', name: 'Preludio' }, { id: 'scales', tipo: 'actividad' });
    data.sessionPlants = [{ id: 'p', obraId: 'w', movId: 'i', mins: 60, startedAt: now.toISOString() },
      { id: 'p', obraId: 'w', movId: 'i', mins: 90, startedAt: now.toISOString(), correctedAt: now.toISOString() },
      { id: 'q', obraId: 'w', mins: 10, startedAt: now.toISOString() },
      { id: 'r', obraId: 'single', mins: 20, startedAt: now.toISOString() },
      { id: 's', obraId: 'scales', mins: 15, startedAt: now.toISOString() }];
    data.sesiones = [{ date: now.toISOString(), items: [{ obraId: 'w', movId: 'iii', minutosReales: 25 }] }];
    const r = h.ProfessorCore.buildReport(data, { asOf: now, googleCalendarState: {} });
    expect(r.today.totalKnownMinutes).toBe(160);
    expect(r.units.find(u => u.movId === 'i').recent.today).toBe(90);
    expect(r.units.find(u => u.movId === 'iii').recent.today).toBe(25);
  });
  it('does not merge distinct same-name events and preserves linked future events beyond 180 days', () => {
    const h = professorHarness(), data = fixture();
    data.eventos = ['a', 'b'].map(id => ({ id, nombre: 'Audición', fecha: '2028-11-01', obras: ['w'], estado: 'confirmado' }));
    const r = h.ProfessorCore.buildReport(data, { asOf: now, googleCalendarState: {} });
    expect(r.events).toHaveLength(2);
    expect(r.units[0].linkedEvents).toHaveLength(2);
  });
  it('keeps unknown scores unknown and uses historical familiarity only for recovery', () => {
    const h = professorHarness(), data = fixture();
    data.obras[0].movimientos[1].sol = null;
    const r = h.ProfessorCore.buildReport(data, { asOf: now, googleCalendarState: {} });
    expect(r.units.find(u => u.movId === 'iii').solidity).toBeNull();
    expect(r.units.find(u => u.movId === 'iii').movementModernMinutes).toBe(0);
    data.obras[0].minutosExtra = 0;
    const fresh = h.ProfessorCore.buildReport(data, { asOf: now, googleCalendarState: {} });
    expect(r.units.find(u => u.movId === 'iii').recoveryHours.high).toBeLessThan(fresh.units.find(u => u.movId === 'iii').recoveryHours.high);
  });
  it('Standby weighs less than Confirmado and discarded events never make a unit eligible', () => {
    const h = professorHarness(), data = fixture();
    const report = status => { data.eventos[0].estado = status; return h.ProfessorCore.buildReport(data, { asOf: now, googleCalendarState: {} }); };
    expect(report('standby').units[0].priority.score).toBeLessThan(report('confirmado').units[0].priority.score);
    expect(report('descartado').units.every(u => u.planningEligible === false)).toBe(true);
  });
  it('is deterministic and round-trips every field of 70+ units without top-N or delimiter/name collisions', () => {
    const h = professorHarness(), data = fixture();
    data.obras[0].movimientos = Array.from({ length: 75 }, (_, i) => ({ id: `m${i}`, name: `I|~\n${i}`, sol: i, future: { confidence: null } }));
    data.eventos[0].professorMovements = null;
    const opts = { asOf: now, googleCalendarState: {} };
    const r = h.ProfessorCore.buildReport(data, opts);
    expect(JSON.stringify(r)).toBe(JSON.stringify(h.ProfessorCore.buildReport(data, opts)));
    const encoded = h.ProfessorHandoffResilience.denseContext(r);
    expect(h.ProfessorHandoffResilience.decodeContext(encoded)).toEqual(JSON.parse(JSON.stringify(r)));
    expect((encoded.match(/^U\|/gm) || []).length).toBe(75);
  });
  it('keeps movement, round and purpose associations without borrowing another movement',()=>{
    const h=professorHarness(),data=fixture();
    delete data.eventos[0].professorMovements;
    data.eventos[0].repertorioPlanificado=[{obraId:'w',movimientoId:'iii',uso:'video',ronda:'semifinal',notas:'Solo el final'}];
    const r=h.ProfessorCore.buildReport(data,{asOf:now,googleCalendarState:{}});
    expect(r.units.find(u=>u.movId==='i').nextEvent).toBeNull();
    expect(r.units.find(u=>u.movId==='iii').nextEvent.sourceEvent.repertorioPlanificado[0]).toMatchObject({movimientoId:'iii',uso:'video',ronda:'semifinal'});
  });
  it('uses legacy forest study only when not already represented in detailed timer history',()=>{
    const h=professorHarness(),data=fixture();
    data.sessionPlants=[{id:'detailed',obraId:'w',movId:'i',mins:25,startedAt:now.toISOString()}];
    data.forestPlants=[{id:'mirror',obraId:'w',movId:'i',mins:25,startedAt:now.toISOString()},
      {id:'legacy',obraId:'w',movId:'iii',mins:10,startedAt:now.toISOString()}];
    const r=h.ProfessorCore.buildReport(data,{asOf:now,googleCalendarState:{}});
    expect(r.today.totalKnownMinutes).toBe(35);expect(r.units.find(u=>u.movId==='iii').recent.today).toBe(10);
    expect(r.sourceContext.forestPlants).toHaveLength(2);
  });
  it('keeps same-name movements in different works independent',()=>{
    const h=professorHarness(),data=fixture();const second=structuredClone(data.obras[0]);second.id='w2';second.movimientos[0].sol=19;second.movimientos[0].solHistory=[];
    data.obras.push(second);data.eventos[0].obras.push('w2');
    const r=h.ProfessorCore.buildReport(data,{asOf:now,googleCalendarState:{}});
    expect(r.units.find(u=>u.obraId==='w'&&u.movId==='i').solidity).toBe(90);
    expect(r.units.find(u=>u.obraId==='w2'&&u.movId==='i').solidity).toBe(19);
    expect(new Set(r.units.map(u=>u.key)).size).toBe(4);
  });
});
