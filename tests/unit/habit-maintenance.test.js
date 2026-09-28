import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../habit-maintenance.js');
const R = require('../../habit-rulebook.js');
const DataCore = require('../../data-core.js');
globalThis.HabitRulebook = R;
globalThis.HabitMaintenance = M;
const page = require('../../habits-page.js');

// Reglamentos reales de los dos hábitos terminados (se pegan en la app).
const BATH = `REGLAMENTO
REGLA: El móvil no cruza la puerta del baño; fuera de casa, si no hay un sitio privado donde dejarlo, va guardado y bloqueado y no se saca.
DEFINICIONES:
- Móvil: el móvil y el iPad.
- Baño: cualquier baño o aseo, en casa o fuera, ducha incluida.
- Sitio privado: casa, casa ajena donde tengo habitación o mochila, y hotel. Tren, bar, conservatorio y aeropuerto no lo son.
- Sacarlo: tenerlo en la mano dentro del baño, aunque no lo desbloquee.
ES RECAÍDA:
- En un sitio privado, entrar al baño con el móvil, aunque vaya en el bolsillo.
- Fuera de un sitio privado, sacarlo dentro del baño.
- Salir a por el móvil a mitad y volver a entrar con él.
- Llevarlo para el temporizador, la música o «mirar la hora».
- Usar el iPad o cualquier otra pantalla dentro del baño.
NO ES RECAÍDA:
- Dejarlo fuera del baño, aunque suene o vibre.
- Música puesta antes de entrar, sonando desde fuera.
- Fuera de un sitio privado, llevarlo guardado y bloqueado sin sacarlo.
- Salir del baño para atender una llamada, sin volver a entrar con él.
EXCEPCIONES:
- Urgencia real: llamada o aviso sobre la salud o la seguridad de alguien, o necesito pedir ayuda → atiendo lo necesario y lo saco del baño en cuanto pueda.
EJEMPLOS:
- En el tren voy al baño con el móvil en el bolsillo y no lo saco | NO | No hay sitio privado: guardado y bloqueado.
- En el tren lo saco en el baño para ver un mensaje | RECAÍDA | Fuera de casa se puede llevar, no sacar.
- En casa lo llevo en el bolsillo sin sacarlo | RECAÍDA | En un sitio privado no entra.
- En casa de un amigo lo dejo en mi mochila | NO | Hay sitio privado.
- En un hotel lo meto en el baño porque es mi habitación | RECAÍDA | El hotel es sitio privado: se queda en la habitación.
- Pongo música antes de la ducha y lo dejo fuera | NO | Suena desde fuera.
- Me ducho con el temporizador del móvil dentro | RECAÍDA | Usa un reloj o déjalo fuera.
- Suena una llamada normal y termino antes de salir | NO | No sales a por él.
- Salgo a por el móvil y vuelvo al baño con él | RECAÍDA | Entra en el baño.
- En el conservatorio lo llevo en la mochila al aseo sin abrirla | NO | Guardado y sin sacar.
- Lo saco solo para mirar la hora | RECAÍDA | Frase de negociación.
- Llevo el iPad al baño para leer una partitura | RECAÍDA | El iPad cuenta como móvil.
- Leo un libro de papel en el baño | NO | No es una pantalla.
PREPARACIÓN:
- Un sitio fijo fuera del baño para dejarlo, por ejemplo el mueble de la entrada.
- Reloj de pulsera o de pared para la hora.
- Si quieres música, ponla antes de entrar.
FIN`;

const BED = `REGLAMENTO
REGLA: En la cama no toco el móvil ni el iPad, a ninguna hora, y por la noche el móvil duerme donde no llego sin levantarme.
DEFINICIONES:
- En la cama: tumbado, sentado o de rodillas encima o dentro de la cama, a cualquier hora, siesta incluida.
- Móvil: el móvil, el iPad y el ordenador. El Kindle no cuenta.
- Tocar: cogerlo, desbloquearlo o manejarlo, aunque sea un segundo.
- Fuera de alcance: no lo alcanzo sin poner los pies en el suelo.
ES RECAÍDA:
- Tocar el móvil estando en la cama, aunque sea para ver la hora o un aviso.
- Que por la noche el móvil esté al alcance desde la cama, aunque no lo toque.
- Posponer la alarma desde la cama o volver a la cama con el móvil.
- Levantarme a usarlo de pie junto a la cama y volver a acostarme.
- Poner o cambiar música, pódcast o ruido blanco desde la cama.
NO ES RECAÍDA:
- Levantarme y apagar la alarma de pie.
- Dejar ruido blanco o música puestos antes de acostarme, bocabajo y fuera de alcance.
- Encender la linterna de pie desde la pantalla bloqueada para ir al baño, y volver a la cama sin él.
- Leer en el Kindle o en papel en la cama.
- Oír el móvil sonar lejos sin ir a por él.
EXCEPCIONES:
- Urgencia real: llamadas repetidas o un aviso sobre la salud o la seguridad de alguien → me levanto, lo atiendo fuera de la cama y lo devuelvo a su sitio.
- Casa ajena u hotel sin otro sitio donde sentarse → sentado y vestido, nunca tumbado.
EJEMPLOS:
- Me despierto a las 3 y cojo el móvil de la mesilla para ver la hora | RECAÍDA | Lo toqué y además estaba al alcance.
- Me despierto a las 3 y miro el reloj | NO | Sin móvil.
- Suena la alarma, me levanto y la apago de pie | NO | Pies en el suelo.
- Pospongo la alarma desde la cama | RECAÍDA | Tocarlo en la cama.
- Pongo el ruido blanco antes de acostarme y lo dejo en la cómoda | NO | Fuera de alcance y sin tocar.
- El ruido blanco se corta y me levanto a ponerlo otra vez | RECAÍDA | Si se corta no se vuelve a poner: es la puerta a mirar el móvil de noche.
- Me siento en la cama por la tarde a contestar un mensaje | RECAÍDA | Vale a cualquier hora.
- Echo la siesta con el móvil en la mesilla | RECAÍDA | Al alcance.
- Leo en el Kindle antes de dormir | NO | El Kindle no cuenta.
- Me llaman tres veces seguidas a la 1; me levanto y contesto fuera de la cama | NO | Urgencia por la vía fijada.
- Me levanto, miro WhatsApp de pie junto a la cama y me vuelvo a acostar | RECAÍDA | Esquivar la norma cuenta como romperla.
- Estoy enfermo y veo series en el iPad en la cama | RECAÍDA | Estar enfermo no es excepción.
- En un hotel sin sillón contesto un correo sentado y vestido en la cama | NO | Excepción de casa ajena u hotel.
- En un hotel lo uso tumbado | RECAÍDA | La excepción es sentado y vestido.
PREPARACIÓN:
- Cargador fijo fuera de alcance: en la cómoda o fuera del dormitorio.
- Despertador y reloj visibles desde la cama.
- Lamparita de noche para no necesitar la linterna.
- En el modo Dormir, deja pasar Favoritos y llamadas repetidas: lo urgente llega sin mirar.
FIN`;

const bed = over => ({ id: 'habit-bed', title: 'No móvil en la cama', mode: 'avoid', startDate: '2026-08-23', durationDays: 21, logs: {}, ...over });
const lapse = (date, note = '') => ({ status: 'lapse', at: date + 'T22:00:00Z', note });

describe('mantenimiento · caídas después de terminar un reto', () => {
  it('does not apply while the challenge is running', () => {
    expect(M.state([bed()], bed(), '2026-09-01').applies).toBe(false);
  });

  it('counts clean days from the end of the challenge', () => {
    const s = M.state([bed()], bed(), '2026-09-28');
    expect(s).toMatchObject({ applies: true, lastEnd: '2026-09-12', windowStart: '2026-09-13', week: 0, month: 0, level: 'ok', daysClean: 16 });
  });

  it('one lapse is a warning, never a reset', () => {
    const h = bed({ maintenanceLogs: { '2026-09-27': lapse('2026-09-27', 'Cogí el móvil de la mesilla') } });
    const s = M.state([h], h, '2026-09-28');
    expect(s).toMatchObject({ level: 'warn', week: 1, month: 1, daysClean: 1, todayLapse: false });
    expect(s.lapses[0]).toMatchObject({ date: '2026-09-27', note: 'Cogí el móvil de la mesilla' });
  });

  it('two lapses in 7 days or three in 30 are a relapse; cleared ones do not count', () => {
    const week = bed({ maintenanceLogs: { '2026-09-22': lapse('2026-09-22'), '2026-09-27': lapse('2026-09-27') } });
    expect(M.state([week], week, '2026-09-28').level).toBe('relapse');
    const month = bed({ maintenanceLogs: { '2026-09-01': lapse('2026-09-01'), '2026-09-14': lapse('2026-09-14'), '2026-09-20': lapse('2026-09-20'), '2026-09-27': lapse('2026-09-27') } });
    const s = M.state([month], month, '2026-09-28');
    // La del 1 de septiembre fue durante el reto: no cuenta para el mantenimiento.
    expect(s).toMatchObject({ week: 1, month: 3, level: 'relapse' });
    const cleared = bed({ maintenanceLogs: { '2026-09-22': lapse('2026-09-22'), '2026-09-27': { status: 'clear', at: '2026-09-27T22:05:00Z' } } });
    expect(M.state([cleared], cleared, '2026-09-28').level).toBe('warn');
  });

  it('reopens a 21-day challenge that inherits the rules in force and no points', () => {
    const rulebooks = R.withRulebook(bed(), R.parse(BED).rulebook, '2026-09-20', '2026-09-20T20:00:00Z');
    const h = bed({ description: 'Nada de pantallas en la cama.', effortReward: { points: 3 }, rulebooks, maintenanceLogs: { '2026-09-27': lapse('2026-09-27') } });
    const reopened = M.reopenChallenge([h], h, '2026-09-28', '2026-09-28T10:00:00.000Z', R);
    expect(reopened).toMatchObject({ title: 'No móvil en la cama', mode: 'avoid', durationDays: 21, startDate: '2026-09-28', reopenOf: 'habit-bed', description: 'Nada de pantallas en la cama.', reward: '' });
    expect(reopened.effortReward).toBeUndefined();
    expect(reopened.rulebooks).toHaveLength(1);
    expect(reopened.rulebooks[0]).toMatchObject({ effectiveFrom: '2026-09-28' });
    expect(R.inForce(reopened, '2026-09-28').rule).toMatch(/^En la cama no toco el móvil/);

    // Una caída hoy: el reto reabierto empieza mañana, no con un día perdido.
    const today = bed({ maintenanceLogs: { '2026-09-28': lapse('2026-09-28') } });
    expect(M.reopenChallenge([today], today, '2026-09-28', '2026-09-28T10:00:00.000Z', R).startDate).toBe('2026-09-29');
  });

  it('while reopened, the family points to it; once finished, only newer lapses count', () => {
    const origin = bed({ maintenanceLogs: { '2026-09-22': lapse('2026-09-22'), '2026-09-27': lapse('2026-09-27') } });
    const again = { id: 'habit-bed-2', title: origin.title, mode: 'avoid', startDate: '2026-09-28', durationDays: 21, logs: {}, reopenOf: 'habit-bed' };
    expect(M.state([origin, again], origin, '2026-10-01').reopen.id).toBe('habit-bed-2');
    const after = M.state([origin, again], origin, '2026-10-25');
    expect(after).toMatchObject({ reopen: null, lastEnd: '2026-10-18', windowStart: '2026-10-19', week: 0, month: 0, level: 'ok' });
    expect(M.familyId(again)).toBe('habit-bed');
  });

  it('only lets a lapse be removed right after tapping it by mistake', () => {
    const now = Date.parse('2026-09-28T10:00:00Z');
    expect(M.canUndo({ at: '2026-09-28T09:50:00Z' }, now)).toBe(true);
    expect(M.canUndo({ at: '2026-09-28T09:40:00Z' }, now)).toBe(false);
  });
});

describe('mantenimiento · sincronización', () => {
  it('merges lapses day by day, whichever copy is newer', () => {
    const phone = bed({ updatedAt: '2026-09-28T08:00:00Z', maintenanceLogs: { '2026-09-27': lapse('2026-09-27', 'móvil') } });
    const ipad = bed({ updatedAt: '2026-09-28T09:00:00Z', maintenanceLogs: { '2026-09-28': lapse('2026-09-28', 'iPad') } });
    const merged = DataCore.mergeHabitChallenges([phone], [ipad])[0];
    expect(Object.keys(merged.maintenanceLogs).sort()).toEqual(['2026-09-27', '2026-09-28']);
    expect(merged.logs).toEqual({});
  });
});

describe('mantenimiento · página de hábitos', () => {
  const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('shows the clean streak, the counters and the lapse button', () => {
    const html = strip(page.maintenanceHtml(bed(), [bed()], '2026-09-28'));
    expect(html).toContain('Mantenimiento 16 días sin caídas desde que terminaste el reto.');
    expect(html).toContain('7 días 0 / 2 30 días 0 / 3');
    expect(html).toContain('Registrar caída');
    expect(html).toContain('Reabrir el reto por mi cuenta');
  });

  it('asks to reopen once the lapses reach the threshold', () => {
    const h = bed({ maintenanceLogs: { '2026-09-22': lapse('2026-09-22', 'siesta'), '2026-09-27': lapse('2026-09-27', 'mesilla') } });
    const html = strip(page.maintenanceHtml(h, [h], '2026-09-28'));
    expect(html).toContain('Esto ya es una recaída. 2 caídas en 7 días');
    expect(html).toContain('Reabrir el reto (21 días)');
    expect(html).toContain('Caídas apuntadas 2');
    expect(html).toContain('27 sept mesilla');
  });
});

describe('mantenimiento · reglamentos de los hábitos terminados', () => {
  it('reads both rulebooks without errors or warnings', () => {
    for (const [text, relapse, allowed, examples] of [[BATH, 5, 4, 13], [BED, 5, 5, 14]]) {
      const result = R.parse(text);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.rulebook.relapse).toHaveLength(relapse);
      expect(result.rulebook.allowed).toHaveLength(allowed);
      expect(result.rulebook.examples).toHaveLength(examples);
    }
  });

  it('sends the lapses to the AI as cases when the habit is finished', () => {
    const prompt = R.buildPrompt(bed(), { todayKey: '2026-09-28', lapses: [{ date: '2026-09-27', note: 'Cogí el móvil de la mesilla' }] });
    expect(prompt).toContain('- Estado: reto terminado el 2026-09-12. Ahora está en mantenimiento');
    expect(prompt).toContain('Caídas que he apuntado (resuélvelas en EJEMPLOS y cierra la rendija que las permitió):\n- 2026-09-27: Cogí el móvil de la mesilla');
    expect(prompt).not.toContain('Ninguno en concreto');
  });
});
