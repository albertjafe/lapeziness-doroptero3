/* Página de Hábitos: un hábito a pantalla completa (normas, días, lo siguiente)
   y la colección de los terminados. Sustituye a la antigua vitrina del panel
   del cronómetro, que no cabía en iPad y había perdido sus estilos. Solo
   lee y reutiliza las acciones existentes (marcar, recaída, editar, insignia). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HabitsPage = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const STREAK_MILESTONES = [3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  let selectedId = null;
  let prevView = 'cronometro';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const jsArg = value => esc(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const pts = value => Number(value || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' ' + (Number(value) === 1 ? 'punto' : 'puntos');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  function keyAt(start, offset) {
    const [y, m, d] = String(start).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + offset));
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }
  function dayNum(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  }
  function shortDate(key, withYear) {
    const [y, m, d] = String(key || '').split('-').map(Number);
    if (!y) return '—';
    return d + ' ' + MONTHS[m - 1] + (withYear ? ' ' + y : '');
  }

  /* Lo que viene después, en frases. Pura para poder probarla. */
  function nextSteps(habit, metrics, reward, todayKey) {
    const lines = [];
    const duration = metrics.duration;
    const endKey = keyAt(habit.startDate, duration - 1);
    const startsIn = dayNum(habit.startDate) - dayNum(todayKey);
    if (startsIn > 0) {
      lines.push({ kind: 'start', text: 'Empieza ' + (startsIn === 1 ? 'mañana' : 'el ' + shortDate(habit.startDate)) + ' y dura ' + plural(duration, 'día', 'días') + ' (hasta el ' + shortDate(endKey) + ').' });
      return lines;
    }
    if (metrics.complete) {
      lines.push({ kind: 'done', text: 'Terminado el ' + shortDate(habit.completedAt ? String(habit.completedAt).slice(0, 10) : endKey, true) + ': ' + metrics.success + ' de ' + duration + ' días (' + metrics.compliance + ' %).' });
      return lines;
    }
    const left = duration - metrics.day;
    lines.push({ kind: 'today', text: habit.mode === 'avoid'
      ? (metrics.todayLog === 'failed' ? 'Hoy has registrado una recaída. Mañana vuelve a contar desde cero la racha, no el reto.' : 'Hoy cuenta como cumplido si termina sin recaída.')
      : (metrics.todayLog === 'done' ? 'Hoy ya está cumplido.' : 'Hoy aún falta marcarlo. Si no lo marcas, contará como fallado.') });
    lines.push({ kind: 'end', text: left > 0
      ? 'Mañana: día ' + (metrics.day + 1) + ' de ' + duration + '. Quedan ' + plural(left, 'día', 'días') + ' · termina el ' + shortDate(endKey) + '.'
      : 'Hoy es el último día del reto.' });
    const next = STREAK_MILESTONES.find(m => m > metrics.streak && m <= duration);
    if (next) lines.push({ kind: 'streak', text: 'Racha actual ' + plural(metrics.streak, 'día', 'días') + '; siguiente hito: ' + next + ' (' + plural(next - metrics.streak, 'día más', 'días más') + ').' });
    if (reward && reward.status === 'active') {
      const failures = reward.item ? reward.item.failure : metrics.failure;
      const schedule = (root.HabitTrophies && root.HabitTrophies.REWARD_POLICY.failurePoints) || [3, 1.5, .75, 0];
      const after = schedule[Math.min(failures + 1, schedule.length - 1)];
      lines.push({ kind: 'reward', text: 'Premio en juego: ' + pts(reward.potentialPoints) + (failures ? ' (' + plural(failures, 'caída', 'caídas') + ')' : ' (sin caídas)') + '. ' +
        (after > 0 ? 'Con otra caída bajaría a ' + pts(after) + '.' : 'Otra caída lo dejaría a 0, pero el reto sigue.') });
    } else if (reward && reward.status === 'failed') {
      lines.push({ kind: 'reward', text: 'El premio de esfuerzo se agotó; el reto y el trofeo siguen hasta la fecha final.' });
    }
    lines.push({ kind: 'trophy', text: 'Al terminar: trofeo en tu colección y una insignia para recoger.' });
    return lines;
  }

  function rulesFor(habit, reward) {
    const rules = [];
    rules.push(['Qué cuenta como cumplido', habit.successCriteria || 'Sin criterio escrito. Escríbelo en «Editar» para que no haya dudas cada noche.']);
    rules.push(['Cómo se registra', habit.mode === 'avoid'
      ? 'Solo tocas si recaes. Un día sin recaída cuenta como cumplido cuando termina.'
      : 'Marca cada día que lo cumplas. Un día pasado sin marcar cuenta como fallado.']);
    rules.push(['Si fallas', 'El reto no vuelve a empezar: el calendario sigue hasta su fecha final y los días logrados se conservan. Solo se corta la racha.']);
    if (reward && reward.status !== 'none') {
      rules.push(['Premio de esfuerzo', reward.graded
        ? 'Fijado al empezar: 0 caídas = 3 puntos; 1 = 1,5; 2 = 0,75; 3 o más = 0.'
        : 'Regla anterior: 3 puntos solo con todos los días cumplidos.']);
    } else {
      rules.push(['Premio de esfuerzo', 'Este hábito no tiene premio en puntos. Se acuerda al crear un hábito de 21 días o más, con fecha desde hoy y criterio escrito.']);
    }
    if (habit.motivation) rules.push(['Por qué lo hago', habit.motivation]);
    if (habit.reward) rules.push(['Celebración', habit.reward]);
    return rules;
  }

  function stateOf(habit, key, todayKey) {
    if (typeof root.habitCalendarDayState === 'function') return root.habitCalendarDayState(habit, key, todayKey);
    return 'future';
  }

  function daysGridHtml(habit, metrics, todayKey) {
    let cells = '';
    for (let i = 0; i < metrics.duration; i++) {
      const key = keyAt(habit.startDate, i);
      const state = stateOf(habit, key, todayKey);
      const last = i === metrics.duration - 1;
      const mark = state === 'success' ? '✓' : state === 'failure' ? '×' : state === 'current' ? '•' : (last ? '⚑' : '');
      const label = 'Día ' + (i + 1) + ', ' + shortDate(key) + ': ' + ({ success: 'cumplido', failure: 'fallado', current: 'hoy', future: 'pendiente' }[state] || '') + (last ? ', meta' : '');
      cells += '<li class="hp-day is-' + state + (last ? ' is-goal' : '') + (key === todayKey ? ' is-today' : '') + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
        '<span>' + (i + 1) + '</span><i aria-hidden="true">' + mark + '</i></li>';
    }
    return '<ol class="hp-days" aria-label="Todos los días del reto">' + cells + '</ol>' +
      '<div class="hp-legend" aria-hidden="true"><span class="is-success">Cumplido</span><span class="is-failure">Fallado</span><span class="is-current">Hoy</span><span class="is-future">Pendiente</span></div>';
  }

  function actionHtml(habit, metrics) {
    if (metrics.complete || dayNum(habit.startDate) > dayNum(metrics.todayKey)) return '';
    const id = jsArg(habit.id);
    if (habit.mode === 'avoid') {
      const failed = metrics.todayLog === 'failed';
      return '<button type="button" class="hp-today' + (failed ? ' is-failure' : ' is-calm') + '" onclick="registerHabitRelapse(event,\'' + id + '\')">' +
        (failed ? 'Recaída registrada hoy · toca para quitarla' : 'Hoy sin recaída · registrar recaída') + '</button>';
    }
    const done = metrics.todayLog === 'done';
    return '<button type="button" class="hp-today' + (done ? ' is-success' : '') + '" onclick="toggleHabitToday(event,\'' + id + '\')">' +
      (done ? '✓ Cumplido hoy · toca para desmarcar' : 'Marcar hoy como cumplido') + '</button>';
  }

  function detailHtml(habit, todayKey) {
    const metrics = root.habitMetrics(habit);
    const T = root.HabitTrophies;
    const reward = T && habit.effortReward ? T.rewardStatus(habit) : null;
    const planned = dayNum(habit.startDate) > dayNum(todayKey);
    const kicker = (habit.mode === 'avoid' ? 'Evitar' : 'Hacer') + ' · ' +
      (metrics.complete ? 'terminado' : planned ? 'programado' : 'día ' + metrics.day + ' de ' + metrics.duration);
    // A mitad de reto, el % sobre la duración total parece un suspenso: se
    // muestra el acierto sobre los días ya decididos; al terminar, el total.
    const decided = metrics.success + metrics.failure;
    const rate = metrics.complete ? [metrics.compliance + ' %', 'de ' + metrics.duration + ' días']
      : [decided ? Math.round(metrics.success / decided * 100) + ' %' : '—', decided ? 'de los días pasados' : 'aún sin días'];
    const stats = [
      ['Cumplidos', metrics.success, 'de ' + metrics.duration],
      ['Fallados', metrics.failure, metrics.failure === 1 ? 'día' : 'días'],
      ['Racha', metrics.streak, metrics.streak === 1 ? 'día' : 'días'],
      [metrics.complete ? 'Cumplimiento' : 'Acierto', rate[0], rate[1]],
    ];
    const art = T ? T.artwork(habit.id, metrics.complete, 'page-' + habit.id) : '';
    return '<article class="hp-detail' + (metrics.complete ? ' is-complete' : '') + '" data-habit-id="' + esc(habit.id) + '">' +
      '<header class="hp-hero"><div class="hp-hero-art">' + art + '</div><div class="hp-hero-copy">' +
        '<span class="hp-kicker">' + esc(kicker) + '</span><h2>' + esc(habit.title || 'Hábito') + '</h2>' +
        '<p class="hp-desc">' + (habit.description ? esc(habit.description) : '<em>Sin descripción. Añádela en «Editar» para recordar el porqué.</em>') + '</p>' +
        '<p class="hp-dates">' + shortDate(habit.startDate, true) + ' → ' + shortDate(keyAt(habit.startDate, metrics.duration - 1), true) + ' · ' + plural(metrics.duration, 'día', 'días') + '</p>' +
      '</div></header>' +
      '<progress class="hp-progress" max="100" value="' + metrics.progress + '" aria-label="' + metrics.progress + ' % del reto transcurrido"></progress>' +
      actionHtml(habit, metrics) +
      '<div class="hp-stats">' + stats.map(([label, value, sub]) => '<div><span>' + label + '</span><strong>' + value + '</strong><small>' + sub + '</small></div>').join('') + '</div>' +
      '<section class="hp-block"><h3>Lo siguiente</h3><ul class="hp-next">' +
        nextSteps(habit, metrics, reward, todayKey).map(line => '<li class="is-' + line.kind + '">' + esc(line.text) + '</li>').join('') + '</ul></section>' +
      '<section class="hp-block"><h3>Días</h3>' + daysGridHtml(habit, metrics, todayKey) + '</section>' +
      '<section class="hp-block"><h3>Normas</h3><dl class="hp-rules">' +
        rulesFor(habit, reward).map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' +
        '<button type="button" class="hp-edit" onclick="openHabitChallengeModal(\'' + jsArg(habit.id) + '\')">' + (metrics.complete ? 'Ver ficha completa' : 'Editar normas') + '</button>' +
      '</section>' +
    '</article>';
  }

  function collectionHtml(items, currentId) {
    if (!items.length) return '';
    const T = root.HabitTrophies;
    const cards = items.map(item => {
      const h = item.habit;
      const reward = T && h.effortReward ? T.rewardStatus(h) : null;
      const claim = item.complete
        ? (h.rewardClaimedAt ? '<span class="hp-badge is-claimed">Insignia recogida</span>'
          : '<button type="button" class="hp-badge is-ready" onclick="claimHabitReward(\'' + jsArg(h.id) + '\')">Recoger insignia +1</button>')
        : '';
      const points = reward && reward.status === 'earned' ? '<small class="hp-card-points">+' + pts(reward.points) + '</small>' : '';
      // Artículo con un botón de selección y otro de insignia: un botón no puede contener otro.
      return '<article class="hp-card' + (h.id === currentId ? ' is-selected' : '') + (item.complete ? ' is-earned' : '') + '">' +
        '<button type="button" class="hp-card-select" data-hp-select="' + esc(h.id) + '" aria-pressed="' + (h.id === currentId) + '">' +
        (T ? T.artwork(h.id, item.complete, 'mini-' + h.id) : '') +
        '<span class="hp-card-copy"><span class="hp-card-kicker">' + (item.complete ? 'Terminado · ' + shortDate(item.completedOn, true) : item.status === 'planned' ? 'Programado · ' + shortDate(item.startedOn) : 'En curso') + '</span>' +
        '<strong>' + esc(h.title || 'Hábito') + '</strong><span>' + item.success + ' de ' + item.duration + ' días · ' + item.compliance + ' %</span>' + points + '</span></button>' + claim +
      '</article>';
    }).join('');
    const earned = items.filter(i => i.complete);
    const days = earned.reduce((sum, i) => sum + i.success, 0);
    return '<section class="hp-collection"><div class="hp-collection-head"><h3>Colección</h3><span>' + plural(earned.length, 'trofeo', 'trofeos') + ' · ' + plural(days, 'día logrado', 'días logrados') + '</span></div>' +
      '<div class="hp-cards">' + cards + '</div></section>';
  }

  const HOW = '<details class="hp-how"><summary>Cómo funcionan los hábitos</summary><ul>' +
    '<li>Solo hay un hábito en curso a la vez: termina (o borra) el actual antes de crear otro.</li>' +
    '<li><b>Hacer</b>: marcas cada día que lo cumples. <b>Evitar</b>: solo tocas si recaes.</li>' +
    '<li>Un fallo corta la racha, pero no reinicia el reto ni borra los días logrados.</li>' +
    '<li>Al terminar, el hábito queda en tu colección con su trofeo y una insignia para recoger.</li>' +
    '<li>Premio de esfuerzo (hucha común): se fija al crear un hábito de 21+ días, con fecha desde hoy y criterio escrito. 0 caídas = 3 puntos; 1 = 1,5; 2 = 0,75; 3 o más = 0.</li>' +
    '</ul></details>';

  function render() {
    const host = root.document && root.document.getElementById('habitsPageContent');
    if (!host || typeof root.habitAllChallenges !== 'function' || typeof root.habitMetrics !== 'function') return;
    const T = root.HabitTrophies;
    const all = root.habitAllChallenges();
    const items = T ? T.collection(all) : [];
    // En curso primero; después los terminados más recientes.
    items.sort((a, b) => Number(a.complete) - Number(b.complete));
    const todayKey = typeof root.habitDayKey === 'function' ? root.habitDayKey() : new Date().toISOString().slice(0, 10);
    const active = all.find(h => !root.habitMetrics(h).complete) || null;
    let habit = all.find(h => h.id === selectedId) || active || (items[0] && items[0].habit) || null;
    if (habit && habit.id !== selectedId) selectedId = habit.id;
    const back = habit && active && habit.id !== active.id
      ? '<button type="button" class="hp-back-current" data-hp-select="' + esc(active.id) + '">← Volver al hábito en curso</button>' : '';
    const create = !active
      ? '<section class="hp-empty"><div><strong>' + (all.length ? 'Ningún hábito en curso' : 'Aún no tienes hábitos') + '</strong><span>Una regla diaria clara, durante unas semanas. Los terminados quedan en tu colección.</span></div>' +
        '<button type="button" onclick="openHabitChallengeModal()">Crear hábito</button></section>' : '';
    host.innerHTML = create + back + (habit ? detailHtml(habit, todayKey) : '') + collectionHtml(items, habit && habit.id) + HOW;
  }

  function open(id) {
    const doc = root.document;
    const current = doc.body.getAttribute('data-view');
    if (current && current !== 'habitos') prevView = current;
    if (id) selectedId = id;
    root.showView('habitos');
    const scroller = doc.querySelector('.app-content');
    if (scroller) scroller.scrollTop = 0;
    render();
  }
  function close() {
    root.showView(prevView && prevView !== 'habitos' ? prevView : 'cronometro');
  }

  function install() {
    const doc = root.document;
    if (!doc || install.done) return;
    install.done = true;
    doc.addEventListener('click', event => {
      const select = event.target.closest && event.target.closest('[data-hp-select]');
      if (!select || !select.closest('#view-habitos')) return;
      selectedId = select.getAttribute('data-hp-select');
      render();
      doc.querySelector('#view-habitos .hp-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    // Toda acción de hábitos termina en renderHabitCalendar: repintar si la página está abierta.
    const hook = () => {
      if (typeof root.renderHabitCalendar !== 'function' || root.renderHabitCalendar.__habitsPage) return !!root.renderHabitCalendar;
      const original = root.renderHabitCalendar;
      const wrapped = function () {
        const result = original.apply(this, arguments);
        if (doc.body.getAttribute('data-view') === 'habitos') render();
        return result;
      };
      wrapped.__habitsPage = true;
      root.renderHabitCalendar = wrapped;
      return true;
    };
    if (!hook()) doc.addEventListener('DOMContentLoaded', hook, { once: true });
    root.addEventListener && root.addEventListener('load', hook, { once: true });
  }

  if (root.document) {
    root.openHabitos = open;
    root.closeHabitos = close;
    install();
  }

  return { nextSteps, rulesFor, render, open, close, STREAK_MILESTONES };
});
