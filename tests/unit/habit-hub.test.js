import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../habit-rulebook.js');
const M = require('../../habit-maintenance.js');
const H = require('../../habit-hub.js');

const habit = over => ({ id: 'h1', title: 'Desintoxicación por la mañana', mode: 'avoid', startDate: '2026-09-27', durationDays: 21, logs: {}, ...over });
const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// habitMetrics simplificado (el real vive en app.js): día, racha y registro de hoy.
function metricsAt(todayKey) {
  return h => {
    const day = Math.round((Date.parse(todayKey) - Date.parse(h.startDate)) / 864e5) + 1;
    const duration = h.durationDays;
    const complete = day > duration || !!h.completedAt;
    return { day: Math.max(1, Math.min(duration, day)), duration, elapsed: Math.max(0, Math.min(duration, day)), streak: Math.max(0, day - 1), complete, todayLog: (h.logs[todayKey] || {}).status || '' };
  };
}

describe('hub · sugerencias tras una caída', () => {
  it('uses the rulebook preparation and always offers to take the case to the AI', () => {
    const rb = { rule: 'Regla', relapse: ['x'], allowed: [], exceptions: [], examples: [], terms: [], setup: ['Modo Concentración al despertar.', 'Reloj de pulsera para la hora.', 'Tercera cosa.'] };
    const h = habit({ rulebooks: R.withRulebook(habit(), rb, '2026-09-26', 'x') });
    const list = H.suggestions(h, { todayKey: '2026-09-29', rulebookApi: R });
    expect(list.map(s => [s.text, s.type, s.date])).toEqual([
      ['Modo Concentración al despertar.', 'task', '2026-09-29'],
      ['Reloj de pulsera para la hora.', 'task', '2026-09-29'],
      ['Añadir el caso de hoy al reglamento con la IA.', 'rulebook', '2026-09-29'],
    ]);
  });

  it('without a rulebook proposes a physical barrier and preparing the rules', () => {
    const list = H.suggestions(habit(), { todayKey: '2026-09-29', rulebookApi: R });
    expect(list[0].text).toMatch(/barrera física/);
    expect(list[1]).toMatchObject({ type: 'rulebook', text: 'Preparar el reglamento con la IA para que no haya dudas.' });
  });

  it('never proposes again an action that is still pending', () => {
    const h = habit({ actions: [{ id: 'a1', date: '2026-09-28', text: 'Preparar el reglamento con la IA para que no haya dudas.', type: 'rulebook', doneAt: null }] });
    expect(H.suggestions(h, { todayKey: '2026-09-29', rulebookApi: R }).map(s => s.type)).toEqual(['task']);
  });
});

describe('hub · acciones', () => {
  const nowIso = '2026-09-29T10:00:00.000Z';

  it('adds actions with dates and notes, toggles them and lists what is due today', () => {
    let h = habit();
    h = { ...h, actions: H.withActions(h, [
      { text: 'Cargador en el pasillo', type: 'task', date: '2026-09-29' },
      { text: 'Añadir el caso al reglamento', type: 'rulebook', date: '2026-09-30', note: 'Miré WhatsApp' },
      { text: '', type: 'task', date: '2026-09-29' },
    ], nowIso, 'relapse') };
    expect(h.actions).toHaveLength(2);
    expect(h.actions[1]).toMatchObject({ type: 'rulebook', note: 'Miré WhatsApp', source: 'relapse', doneAt: null });
    expect(H.dueToday([h], '2026-09-29').map(r => r.action.text)).toEqual(['Cargador en el pasillo']);
    // Atrasada al día siguiente; hecha hoy sigue a la vista, tachada.
    expect(H.dueToday([h], '2026-09-30').map(r => [r.action.text, r.overdue])).toEqual([['Cargador en el pasillo', true], ['Añadir el caso al reglamento', false]]);
    h = { ...h, actions: H.toggled(h, h.actions[0].id, '2026-09-30T08:00:00.000Z') };
    expect(H.dueToday([h], '2026-09-30').map(r => r.action.text)).toEqual(['Añadir el caso al reglamento', 'Cargador en el pasillo']);
    expect(H.dueToday([h], '2026-10-01').map(r => r.action.text)).toEqual(['Añadir el caso al reglamento']);
    expect(Object.keys(H.byDay([h])).sort()).toEqual(['2026-09-29', '2026-09-30']);
  });
});

describe('hub · tarjeta de Hoy', () => {
  it('shows the day of the challenge, today button, actions and maintenance', () => {
    const detox = habit({ actions: [{ id: 'a1', date: '2026-09-29', text: 'Cargador en el pasillo', type: 'task', doneAt: null }] });
    const bed = { id: 'bed', title: 'No móvil en la cama', mode: 'avoid', startDate: '2026-08-23', durationDays: 21, logs: {} };
    const html = H.hoyHtml({ habits: [detox, bed], todayKey: '2026-09-29', metrics: metricsAt('2026-09-29'), maintenanceApi: M });
    const text = strip(html);
    expect(text).toContain('Desintoxicación por la mañana Evitar · día 3 de 21 · racha 2 días Hoy, sin recaída');
    expect(text).toContain('Registrar recaída');
    expect(text).toContain('Acciones de hoy Cargador en el pasillo');
    expect(text).toContain('En mantenimiento No móvil en la cama 17 días sin caídas Caída');
    expect(text).not.toContain('Crear un hábito nuevo');
  });

  it('invites to create a habit when none is running', () => {
    const html = H.hoyHtml({ habits: [], todayKey: '2026-09-29', metrics: metricsAt('2026-09-29'), maintenanceApi: M });
    expect(strip(html)).toContain('＋ Crear un hábito nuevo');
  });
});
