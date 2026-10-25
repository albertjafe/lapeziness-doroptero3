import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../../tasks-today.js');

const TODAY = '2026-10-25'; // domingo

describe('tasks-today: leer lo que se escribe', () => {
  const p = text => T.parse(text, TODAY);
  it('reads dates at the start or the end and removes them', () => {
    expect(p('Comprar pan para mañana')).toMatchObject({ text: 'Comprar pan', dueDate: '2026-10-26' });
    expect(p('Mañana llamar al banco')).toMatchObject({ text: 'Llamar al banco', dueDate: '2026-10-26' });
    expect(p('Ir a correos pasado mañana')).toMatchObject({ text: 'Ir a correos', dueDate: '2026-10-27' });
    expect(p('Revisar hoy')).toMatchObject({ text: 'Revisar', dueDate: TODAY });
    expect(p('Enviar vídeo el 3/12')).toMatchObject({ text: 'Enviar vídeo', dueDate: '2026-12-03' });
    expect(p('Pagar el 3 de diciembre')).toMatchObject({ text: 'Pagar', dueDate: '2026-12-03' });
    // El mismo día de la semana que hoy es el de la semana que viene.
    expect(p('Llamar el domingo').dueDate).toBe('2026-11-01');
    expect(p('Reservar aula el lunes').dueDate).toBe('2026-10-26');
    // Una fecha ya pasada este año es la del año que viene.
    expect(p('Renovar el 2/1').dueDate).toBe('2027-01-02');
  });
  it('reads priority and type, also glued by dictation, and keeps words in the middle', () => {
    expect(p('UrgentePoner clases en el calendario')).toMatchObject({ text: 'Poner clases en el calendario', priority: 2 });
    expect(p('Llamar a Fernando el jueves urgente')).toMatchObject({ text: 'Llamar a Fernando', priority: 2, dueDate: '2026-10-29' });
    expect(p('Importante arreglar persiana')).toMatchObject({ text: 'Arreglar persiana', priority: 1 });
    expect(p('reservar #piano aula')).toMatchObject({ text: 'Reservar aula', kind: 'piano' });
    expect(p('no es urgente que llame')).toMatchObject({ text: 'No es urgente que llame', priority: 0 });
    expect(p('Leer La mañana de Proust')).toMatchObject({ text: 'Leer La mañana de Proust', dueDate: null });
    expect(p('Hoy')).toMatchObject({ text: 'Hoy', dueDate: null });
  });
});

describe('tasks-today: hoy, elegir y repaso', () => {
  const old = '2026-10-01T10:00:00.000Z';
  const tasks = [
    { id: 'a', text: 'Hoy normal', dueDate: TODAY, priority: 0, createdAt: old },
    { id: 'b', text: 'Atrasada urgente', dueDate: '2026-10-20', priority: 2, createdAt: old },
    { id: 'c', text: 'Mañana', dueDate: '2026-10-26', priority: 0, createdAt: old },
    { id: 'd', text: 'Vieja sin fecha', priority: 0, createdAt: old },
    { id: 'e', text: 'Nueva sin fecha', priority: 3, createdAt: '2026-10-24T10:00:00.000Z' },
    { id: 'f', text: 'Hecha', dueDate: TODAY, done: true, createdAt: old },
  ];
  it('today = open tasks due today or earlier, most urgent first', () => {
    expect(T.todayTasks(tasks, TODAY).map(t => t.id)).toEqual(['b', 'a']);
  });
  it('candidates = the rest, urgent and dated first', () => {
    expect(T.candidates(tasks, TODAY).map(t => t.id)).toEqual(['e', 'c', 'd']);
  });
  it('the review offers undated tasks older than two weeks, on Sunday or Monday, once a week', () => {
    expect(T.stale(tasks, TODAY).map(t => t.id)).toEqual(['d']);
    expect(T.reviewDue(tasks, TODAY, '')).toBe(true);
    expect(T.reviewDue(tasks, '2026-10-26', '')).toBe(true);
    expect(T.reviewDue(tasks, '2026-10-26', T.weekKey(TODAY))).toBe(false);
    expect(T.reviewDue(tasks, '2026-10-27', '')).toBe(false);
  });
  it('labels dates without numbers that invite checking', () => {
    expect(T.dueLabel({ dueDate: '2026-10-24' }, TODAY)).toBe('Atrasada');
    expect(T.dueLabel({ dueDate: TODAY }, TODAY)).toBe('Hoy');
    expect(T.dueLabel({ dueDate: '2026-10-26' }, TODAY)).toBe('Mañana');
    expect(T.dueLabel({ dueDate: '2026-10-29' }, TODAY)).toBe('jue');
    expect(T.dueLabel({ dueDate: '2026-12-03' }, TODAY)).toBe('3 dic');
    expect(T.weekDue('2026-10-27')).toBe('2026-10-30');
  });
});
