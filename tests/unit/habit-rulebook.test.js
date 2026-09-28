import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../habit-rulebook.js');
globalThis.HabitRulebook = R;
const page = require('../../habits-page.js');

// El reglamento real del hábito de desintoxicación de la mañana: si este
// bloque deja de leerse, el que se pega en la app tampoco se leería.
const DETOX = `REGLAMENTO
REGLA: Desde que me despierto, no uso el móvil, el iPad, el ordenador ni la tele fuera de los usos permitidos hasta que el anillo de Hoy marque 60 min de estudio, o hasta las 13:00 si no llego antes.
DEFINICIONES:
- Pantalla: móvil, iPad, ordenador y tele con internet. El Kindle no cuenta.
- 60 min de estudio: la cifra del anillo de Hoy, hecha con el cronómetro (estudio o estudio mental, en uno o varios bloques). Los minutos añadidos a mano no cuentan para esta regla.
- Usar: desbloquear, abrir una app o leer un aviso a propósito. Que la pantalla se encienda sola no es usar.
- Mañana: desde que me levanto para empezar el día hasta llegar a los 60 min o a las 13:00.
ES RECAÍDA:
- Abrir WhatsApp, Telegram, correo o mensajes para leer, salvo el mensaje esperado anotado la noche antes.
- Redes, YouTube, noticias, juegos o navegar por curiosidad, en cualquier pantalla.
- Coger el móvil para ver qué avisos hay en la pantalla bloqueada.
- Aprovechar un uso permitido para mirar otra cosa.
- Poner música, pódcast o vídeo de fondo.
- Controlar el monitor de aulas por Telegram (se hace desde la app de estudio).
- Dejar el cronómetro corriendo sin estudiar, o añadir minutos a mano, para llegar antes a los 60.
NO ES RECAÍDA:
- Usar la app de estudio para lo suyo: cronómetro, Hoy, Aulas, partituras, metrónomo y grabarme.
- Apagar la alarma, mirar la hora o encender la linterna sin desbloquear.
- Contestar cualquier llamada y hacer llamadas.
- Enseñar un billete, pagar o usar el mapa para llegar a un sitio: abrir, hacerlo y cerrar.
- Reservar o comprobar un aula en Asimut.
- Escuchar una grabación de la obra que estudio con el cronómetro en marcha.
- Poner el código de verificación que pide uno de estos usos.
EXCEPCIONES:
- Mensaje esperado: la noche antes anoto en el diario qué espero y de quién → puedo abrir ese único chat o correo una vez, contestar y cerrarlo (máximo 5 min).
- Urgencia real: una llamada o aviso sobre la salud o la seguridad de alguien, o necesito pedir ayuda → atiendo lo necesario y vuelvo a la regla.
EJEMPLOS:
- En el tren enseño el billete y guardo el móvil | NO | Uso permitido: abrir, hacerlo y cerrar.
- Después de enseñar el billete miro WhatsApp | RECAÍDA | Aprovechar un uso permitido para otra cosa.
- Hoy no tengo piano y hago 60 min de estudio mental con el cronómetro | NO | El estudio mental cuenta; desde ahí, móvil libre.
- No tengo piano ni hago estudio mental y espero a las 13:00 | NO | El tope horario es la salida, no hace falta excepción.
- Estoy de viaje toda la mañana y solo uso billete y mapa | NO | Usos permitidos hasta las 13:00.
- Me despierto enfermo y veo YouTube a las 10 | RECAÍDA | Estar enfermo no es excepción; el tope sigue siendo las 13:00.
- Llama mi madre a las 9 | NO | Las llamadas siempre se contestan.
- Abro el correo por si hay algo del conservatorio | RECAÍDA | Lo urgente llega por llamada.
- Anoche anoté que esperaba al pianista acompañante; abro ese chat, contesto y lo cierro | NO | Mensaje esperado anotado la noche antes.
- Ya en ese chat, abro otro que tiene un aviso | RECAÍDA | La excepción cubre un único chat.
- La pantalla se enciende con un aviso y veo el nombre sin cogerlo | NO | Verlo por casualidad no es usar.
- Cojo el móvil para ver quién me ha escrito | RECAÍDA | Mirar avisos a propósito.
- Pongo un pódcast en el metro | RECAÍDA | Nada de fondo hasta el desbloqueo.
- Uso el mapa para llegar a un aula nueva | NO | Uso permitido.
- Reservo un aula en Asimut desde el móvil | NO | Uso permitido.
- Cambio el modo del monitor de aulas por Telegram | RECAÍDA | Se hace desde la app de estudio.
- Escucho en YouTube la obra que estudio con el cronómetro en marcha | NO | Es estudio.
- Al terminar la grabación dejo correr el vídeo siguiente | RECAÍDA | Ya no es estudio.
- Llevo 40 min y dejo el cronómetro corriendo mientras desayuno | RECAÍDA | Minutos sin estudio para adelantar el desbloqueo.
- Añado 20 min a mano para llegar a 60 | RECAÍDA | Los minutos a mano no cuentan.
- Llego a 60 min a las 10:40 | NO | Desde ese momento, móvil libre.
- Leo en el Kindle durante el desayuno | NO | El Kindle no es pantalla para esta regla.
- Veo YouTube en la tele | RECAÍDA | La tele con internet es pantalla.
PREPARACIÓN:
- Modo Concentración «Mañana» en móvil e iPad al despertar: solo llamadas de Favoritos y llamadas repetidas, sin avisos en la pantalla bloqueada.
- Avisa a familia y profesores: por la mañana, si es urgente, que llamen.
- Reloj de pulsera para la hora.
- La noche antes: billetes descargados, aula reservada y, si esperas un mensaje, anótalo en el diario.
- El móvil carga lejos del piano y de la mesa del desayuno.
FIN`;

const habit = over => ({ id: 'h1', title: 'Desintoxicación por la mañana', mode: 'avoid', startDate: '2026-09-27', durationDays: 21, logs: {}, ...over });

describe('reglamento del hábito · lectura del bloque de la IA', () => {
  it('reads the full morning-detox rulebook', () => {
    const result = R.parse(DETOX);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const rb = result.rulebook;
    expect(rb.rule).toMatch(/^Desde que me despierto, .*hasta las 13:00 si no llego antes\.$/);
    expect(rb.terms).toHaveLength(4);
    expect(rb.relapse).toHaveLength(7);
    expect(rb.allowed).toHaveLength(7);
    expect(rb.exceptions).toHaveLength(2);
    expect(rb.examples).toHaveLength(23);
    expect(rb.examples.filter(e => e.verdict === 'relapse')).toHaveLength(11);
    expect(rb.examples[0]).toEqual({ case: 'En el tren enseño el billete y guardo el móvil', verdict: 'ok', why: 'Uso permitido: abrir, hacerlo y cerrar.' });
    expect(rb.setup).toHaveLength(5);
  });

  it('tolerates markdown, other bullets, text around the block and arrow-style cases', () => {
    const text = [
      'Aquí tienes tu reglamento:',
      '```',
      '**REGLAMENTO**',
      '**REGLA:** El móvil no entra en el baño.',
      '### ES RECAÍDA:',
      '* Entrar con el móvil en el bolsillo en casa.',
      '1. Sacarlo en un baño fuera de casa.',
      '## NO ES RECAÍDA',
      '• Llevarlo guardado fuera de casa.',
      'EJEMPLOS:',
      '- Tren, voy al baño con él en el bolsillo → NO: no hay sitio privado.',
      '- Lo saco para mirar la hora: RECAÍDA',
      '- Un caso sin veredicto',
      'FIN',
      '```',
      '¿Quieres que ajuste algo?',
    ].join('\n');
    const result = R.parse(text);
    expect(result.ok).toBe(true);
    expect(result.rulebook.rule).toBe('El móvil no entra en el baño.');
    expect(result.rulebook.relapse).toEqual(['Entrar con el móvil en el bolsillo en casa.', 'Sacarlo en un baño fuera de casa.']);
    expect(result.rulebook.allowed).toEqual(['Llevarlo guardado fuera de casa.']);
    expect(result.rulebook.examples).toEqual([
      { case: 'Tren, voy al baño con él en el bolsillo', verdict: 'ok', why: 'no hay sitio privado.' },
      { case: 'Lo saco para mirar la hora', verdict: 'relapse', why: '' },
    ]);
    expect(result.warnings).toContain('Un caso no dice si es recaída o no y se ha ignorado.');
  });

  it('refuses a block without a rule or without what breaks the habit', () => {
    expect(R.parse('hola').errors[0]).toMatch(/No encuentro el reglamento/);
    const missing = R.parse('REGLAMENTO\nNO ES RECAÍDA:\n- Algo\nFIN');
    expect(missing.ok).toBe(false);
    expect(missing.errors).toEqual(['Falta la línea «REGLA:» con la norma en una frase.', 'Falta la lista «ES RECAÍDA» (qué rompe el hábito).']);
  });

  it('speaks of «fallo» for do-habits and survives a format → parse round trip', () => {
    const rb = R.parse(DETOX).rulebook;
    const text = R.format(rb, 'do');
    expect(text).toContain('\nES FALLO:\n');
    expect(text).toContain('| FALLO |');
    expect(R.parse(text).rulebook).toEqual(rb);
  });
});

describe('reglamento del hábito · entra en vigor al día siguiente', () => {
  const rb = rule => ({ ...R.parse(DETOX).rulebook, rule });

  it('starts tomorrow on a running habit and on the first day of a planned one', () => {
    expect(R.effectiveFromFor(habit(), '2026-09-28')).toBe('2026-09-29');
    expect(R.effectiveFromFor(habit(), '2026-09-30')).toBe('2026-10-01');
    expect(R.effectiveFromFor(habit({ startDate: '2026-10-05' }), '2026-09-28')).toBe('2026-10-05');
  });

  it('keeps the rules in force today and replaces only the pending version', () => {
    let h = habit();
    h = { ...h, rulebooks: R.withRulebook(h, rb('v1'), '2026-09-28', '2026-09-28T08:00:00Z') };
    expect(R.inForce(h, '2026-09-28')).toBeNull();
    expect(R.pending(h, '2026-09-28').rule).toBe('v1');
    expect(R.inForce(h, '2026-09-29').rule).toBe('v1');

    // Guardar otra vez el mismo día sustituye la pendiente.
    h = { ...h, rulebooks: R.withRulebook(h, rb('v1b'), '2026-09-28', '2026-09-28T09:00:00Z') };
    expect(h.rulebooks.map(v => v.rule)).toEqual(['v1b']);

    // Al día siguiente, una versión nueva no toca la vigente hasta pasado mañana.
    h = { ...h, rulebooks: R.withRulebook(h, rb('v2'), '2026-09-29', '2026-09-29T21:00:00Z') };
    expect(h.rulebooks.map(v => [v.rule, v.effectiveFrom])).toEqual([['v1b', '2026-09-29'], ['v2', '2026-09-30']]);
    expect(R.inForce(h, '2026-09-29').rule).toBe('v1b');
    expect(R.inForce(h, '2026-09-30').rule).toBe('v2');
  });

  it('asks the AI with the habit, the current rulebook, the new cases and the exact format', () => {
    const h = habit({ description: 'Nada de pantallas al empezar el día.', rulebooks: R.withRulebook(habit(), rb('v1'), '2026-09-27', 'x') });
    const prompt = R.buildPrompt(h, { todayKey: '2026-09-28', cases: '¿Y si estoy en casa ajena?' });
    expect(prompt).toContain('- Nombre: Desintoxicación por la mañana');
    expect(prompt).toContain('21 días, del 2026-09-27 al 2026-10-17 (hoy es el día 2)');
    expect(prompt).toContain('- Descripción: Nada de pantallas al empezar el día.');
    expect(prompt).toContain('REGLAMENTO ACTUAL (mejóralo');
    expect(prompt).toContain('REGLA: v1');
    expect(prompt).toContain('¿Y si estoy en casa ajena?');
    expect(prompt).toMatch(/\nREGLAMENTO\nREGLA: \(la norma en una sola frase\)\n/);
    expect(prompt.trim().endsWith('FIN')).toBe(true);
  });
});

describe('página de hábitos · normas con reglamento', () => {
  const metrics = { complete: false };
  const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('invites to prepare the rulebook when there is none', () => {
    const html = strip(page.normasHtml(habit(), null, metrics, '2026-09-28'));
    expect(html).toContain('Sin reglamento. Prepáralo con la IA');
    expect(html).toContain('Preparar reglamento con IA');
    expect(html).toContain('Qué cuenta como cumplido');
    expect(html).toContain('Normas para todos los hábitos');
  });

  it('shows a rulebook saved today as starting tomorrow, with its cases', () => {
    const h = habit({ rulebooks: R.withRulebook(habit(), R.parse(DETOX).rulebook, '2026-09-28', 'x') });
    const html = strip(page.normasHtml(h, null, metrics, '2026-09-28'));
    expect(html).toContain('Reglamento nuevo desde el 29 sept. Hasta entonces, si dudas, cuenta como recaída.');
    expect(html).toContain('La regla Desde que me despierto');
    expect(html).toContain('Excepciones Lista cerrada');
    expect(html).toContain('Casos resueltos 23');
    expect(html).toContain('Mejorar el reglamento con IA');
    // La regla del reglamento sustituye al criterio vacío.
    expect(html).not.toContain('Sin criterio escrito');
    const tomorrow = strip(page.normasHtml(h, null, metrics, '2026-09-29'));
    expect(tomorrow).not.toContain('Reglamento nuevo');
    expect(tomorrow).toContain('Vigente desde el 29 sept 2026.');
  });
});
