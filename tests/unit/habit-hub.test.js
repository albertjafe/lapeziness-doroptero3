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
  it('lists every habit as one word with a one-tap «Caí» button, plus today\'s actions', () => {
    const detox = habit({ actions: [{ id: 'a1', date: '2026-09-29', text: 'Cargador en el pasillo', type: 'task', doneAt: null }] });
    const bed = { id: 'bed', title: 'No móvil en la cama', mode: 'avoid', startDate: '2026-08-23', durationDays: 21, logs: {} };
    const html = H.hoyHtml({ habits: [detox, bed], todayKey: '2026-09-29', metrics: metricsAt('2026-09-29'), maintenanceApi: M });
    const text = strip(html);
    expect(text).toContain('🌅 Mañanas día 3 de 21 Caí');
    expect(text).toContain('🛏️ Cama 17 días sin caer Caí');
    expect(html).toContain("HabitHub.quick('h1','active')");
    expect(html).toContain("HabitHub.quick('bed','upkeep')");
    expect(html).not.toContain('HabitMaintenance.openLapse');
    expect(text).toContain('Acciones de hoy Cargador en el pasillo');
    expect(text).not.toContain('Crear un hábito nuevo');
  });

  it('shows the fall of today as marked, for the running challenge and for maintenance', () => {
    const detox = habit({ logs: { '2026-09-29': { status: 'failed', at: '2026-09-29T08:00:00Z' } } });
    const bed = { id: 'bed', title: 'No móvil en la cama', mode: 'avoid', startDate: '2026-08-23', durationDays: 21, logs: {},
      maintenanceLogs: { '2026-09-29': { status: 'lapse', at: '2026-09-29T08:00:00Z', note: '' } } };
    const text = strip(H.hoyHtml({ habits: [detox, bed], todayKey: '2026-09-29', metrics: metricsAt('2026-09-29'), maintenanceApi: M }));
    expect(text).toContain('Mañanas día 3 de 21 ✓ Caído');
    expect(text).toContain('Cama Caída apuntada hoy ✓ Caído');
  });

  it('derives one word and an icon from the title, or uses a short label', () => {
    const w = title => H.shortLabel({ title, mode: 'avoid' });
    expect(w('No coger el móvil en el baño')).toEqual({ icon: '🚿', word: 'Baño' });
    expect(w('Sin consumo hasta 1 h de estudio')).toEqual({ icon: '🚫', word: 'Consumo' });
    expect(w('Mañanas sin consumo hasta las 12')).toEqual({ icon: '🌅', word: 'Mañanas' });
    expect(w('No comprar ropa nueva')).toEqual({ icon: '⛔', word: 'Comprar' });
    expect(H.shortLabel({ title: 'Leer cada noche', mode: 'do' })).toEqual({ icon: '✅', word: 'Leer' });
    expect(H.shortLabel({ title: 'No móvil en la cama', mode: 'avoid', shortLabel: 'Noche' }).word).toBe('Noche');
  });

  it('invites to create a habit when none is running', () => {
    const html = H.hoyHtml({ habits: [], todayKey: '2026-09-29', metrics: metricsAt('2026-09-29'), maintenanceApi: M });
    expect(strip(html)).toContain('＋ Crear un hábito nuevo');
  });
});
