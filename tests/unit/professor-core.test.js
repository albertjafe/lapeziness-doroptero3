import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Professor = require('../../professor-core.js');

const asOf = new Date('2026-09-02T18:00:00+02:00');
const work = (extra={}) => ({ id:'wald', name:'Waldstein', composer:'Beethoven', tipo:'obra', dificultad:8, minutosExtra:4800, movimientos:[{id:'m1',name:'I',sol:85},{id:'m3',name:'III',sol:52}], ...extra });

describe('ProfessorCore', () => {
  it('treats movements as independent study units and never smears recent minutes', () => {
    const db={obras:[work()],sessionPlants:[
      {id:'a',obraId:'wald',movId:'m1',mins:300,startedAt:'2026-09-01T10:00:00Z'},
      {id:'b',obraId:'wald',movId:'m3',mins:20,startedAt:'2026-09-02T10:00:00Z'},
      {id:'c',obraId:'wald',mins:60,startedAt:'2026-09-02T11:00:00Z'},
    ],eventos:[]};
    const report=Professor.buildReport(db,{asOf,googleCalendarState:{}});
    const first=report.units.find(u=>u.movId==='m1');
    const third=report.units.find(u=>u.movId==='m3');
    expect(first.recent.d7).toBe(300);
    expect(third.recent.d7).toBe(20);
    expect(third.recent.today).toBe(20);
    expect(report.today.unallocatedMinutes).toBe(60);
    expect(first.historicalWorkHours).toBe(80);
    expect(third.historicalWorkHours).toBe(80);
  });

  it('ranks the weak movement above the strong saturated movement for the same event', () => {
    const db={obras:[work()],sessionPlants:[
      {id:'a',obraId:'wald',movId:'m1',mins:420,startedAt:'2026-09-01T10:00:00Z'},
      {id:'b',obraId:'wald',movId:'m3',mins:30,startedAt:'2026-09-02T10:00:00Z'},
    ],eventos:[{id:'exam',nombre:'Examen',tipo:'examen',fecha:'2026-09-12',obras:['wald']}]};
    const report=Professor.buildReport(db,{asOf,googleCalendarState:{}});
    expect(report.units[0].movId).toBe('m3');
    expect(report.units.find(u=>u.movId==='m3').priority.score).toBeGreaterThan(report.units.find(u=>u.movId==='m1').priority.score);
  });

  it('supports movement-specific event targets', () => {
    const event={id:'exam',nombre:'Examen parcial',tipo:'examen',fecha:'2026-09-10',obras:['wald'],professorMovements:{wald:['m3']}};
    const report=Professor.buildReport({obras:[work()],sessionPlants:[],eventos:[event]},{asOf,googleCalendarState:{}});
    expect(report.units.find(u=>u.movId==='m1').nextEvent).toBeNull();
    expect(report.units.find(u=>u.movId==='m3').nextEvent.name).toBe('Examen parcial');
  });

  it('uses Google events as schedule context without inventing repertoire links', () => {
    const report=Professor.buildReport({obras:[work()],sessionPlants:[],eventos:[]},{asOf,googleCalendarState:{selectedIds:['cal'],events:[{id:'g',calendarId:'cal',title:'Clase con Claudio',start:'2026-09-05T10:00:00+02:00'}]}});
    expect(report.events[0].source).toBe('google');
    expect(report.events[0].repertoireLinked).toBe(false);
    expect(report.units.every(u=>u.nextEvent===null)).toBe(true);
    expect(report.warnings.join(' ')).toMatch(/no tienen repertorio enlazado/i);
  });

  it('excludes activities and includes every repertoire movement in the ChatGPT context', () => {
    const db={obras:[work(),{id:'scale',name:'Escalas',tipo:'actividad',movimientos:[]}],sessionPlants:[],eventos:[]};
    const report=Professor.buildReport(db,{asOf,googleCalendarState:{}});
    expect(report.units).toHaveLength(2);
    const prompt=Professor.buildPrompt(report,{mode:'remaining'});
    expect(prompt).toContain('Waldstein · I');
    expect(prompt).toContain('Waldstein · III');
    expect(prompt).not.toContain('Escalas');
    expect(prompt).toMatch(/lo que queda de HOY/i);
  });
});
