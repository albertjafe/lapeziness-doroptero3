import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const page = require('../../habits-page.js');

const metrics = over => ({ duration: 21, day: 9, streak: 3, success: 7, failure: 1, complete: false, compliance: 33, todayKey: '2026-10-06', todayLog: '', ...over });
const habit = over => ({ id: 'h', mode: 'do', startDate: '2026-09-28', durationDays: 21, ...over });

describe('página de hábitos · lo siguiente', () => {
  it('says what counts today, when it ends and the next streak milestone', () => {
    const text = page.nextSteps(habit(), metrics(), null, '2026-10-06').map(l => l.text);
    expect(text[0]).toBe('Hoy aún falta marcarlo. Si no lo marcas, contará como fallado.');
    expect(text[1]).toBe('Mañana: día 10 de 21. Quedan 12 días · termina el 18 oct.');
    expect(text[2]).toBe('Racha actual 3 días; siguiente hito: 7 (4 días más).');
  });

  it('explains what one more slip would cost while the prize is in play', () => {
    const reward = { status: 'active', potentialPoints: 1.5, item: { failure: 1 } };
    const line = page.nextSteps(habit({ mode: 'avoid' }), metrics(), reward, '2026-10-06').find(l => l.kind === 'reward');
    expect(line.text).toBe('Premio en juego: 1,5 puntos (1 caída). Con otra caída bajaría a 0,75 puntos.');
  });

  it('handles planned and finished habits without future-tense noise', () => {
    expect(page.nextSteps(habit({ startDate: '2026-10-07' }), metrics(), null, '2026-10-06')[0].text)
      .toBe('Empieza mañana y dura 21 días (hasta el 27 oct).');
    const done = page.nextSteps(habit(), metrics({ complete: true, success: 20, compliance: 95 }), null, '2026-10-30');
    expect(done).toHaveLength(1);
    expect(done[0].text).toBe('Terminado el 18 oct 2026: 20 de 21 días (95 %).');
  });

  it('never leaves the success rule unwritten', () => {
    const rules = Object.fromEntries(page.rulesFor(habit(), null));
    expect(rules['Qué cuenta como cumplido']).toMatch(/Sin criterio escrito/);
    expect(rules['Si fallas']).toMatch(/no vuelve a empezar/);
  });
});
