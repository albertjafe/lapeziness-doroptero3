/* Hábitos a mano desde Hoy, y acciones tras una caída.

   · Tarjeta «Hábitos» de Hoy (mobile-v2): el hábito en curso con su día
     («Día 3 de 21»), el botón de hoy, el reto reabierto si lo hay, las
     acciones pendientes y los hábitos terminados en mantenimiento.
   · Al apuntar una recaída (o una caída de mantenimiento) la app propone
     acciones concretas: la preparación del reglamento, llevar el caso a la
     IA… Las aceptadas se guardan en el hábito (habit.actions, una por id) y
     aparecen en Hoy, en el calendario y en la página del hábito.
   Las acciones viven dentro del hábito, así que viajan con su sincronización. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HabitHub = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const MAX_ACTIONS = 120;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const jsArg = value => esc(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const validKey = key => /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));
  function keyAt(start, offset) {
    const [y, m, d] = String(start).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + offset));
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const clip = (text, max) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; };

  /* ---------- Modelo (puro) ---------- */

  function actionsOf(habit) {
    return (Array.isArray(habit && habit.actions) ? habit.actions : [])
      .filter(a => a && a.id && validKey(a.date) && a.text && !a.cancelledAt);
  }

  /* Qué proponer después de caer. Sale del propio reglamento (su
     «preparación») y siempre ofrece llevar el caso a la IA; nunca repite una
     acción que ya está pendiente. */
  function suggestions(habit, ctx) {
    const c = ctx || {};
    const todayKey = c.todayKey;
    const R = c.rulebookApi || null;
    const rb = R ? (R.inForce(habit, todayKey) || R.pending(habit, todayKey)) : null;
    const pending = new Set(actionsOf(habit).filter(a => !a.doneAt).map(a => a.text.toLowerCase()));
    const out = [];
    const push = (text, type, date) => {
      const t = clip(text, 200);
      if (!t || pending.has(t.toLowerCase()) || out.some(s => s.text === t)) return;
      out.push({ key: 's' + out.length, text: t, type, date });
    };
    (rb && rb.setup || []).slice(0, 2).forEach(item => push(item, 'task', todayKey));
    if (!(rb && rb.setup && rb.setup.length)) {
      push(habit.mode === 'avoid'
        ? 'Esta noche, poner una barrera física que impida repetirlo (dónde dejar el móvil, qué quitar de en medio).'
        : 'Dejar preparado hoy lo necesario para cumplirlo mañana a primera hora.', 'task', todayKey);
    }
    push(rb ? 'Añadir el caso de hoy al reglamento con la IA.' : 'Preparar el reglamento con la IA para que no haya dudas.', 'rulebook', todayKey);
    return out;
  }

  function newId(nowIso, index) {
    return 'act_' + Date.parse(nowIso).toString(36) + '_' + index + Math.random().toString(36).slice(2, 6);
  }

  function withActions(habit, items, nowIso, source) {
    const list = (Array.isArray(habit.actions) ? habit.actions : []).slice();
    items.forEach((item, index) => {
      if (!item || !validKey(item.date) || !String(item.text || '').trim()) return;
      const action = { id: newId(nowIso, index), date: item.date, text: clip(item.text, 200), type: item.type === 'rulebook' ? 'rulebook' : 'task', source: source || 'relapse', createdAt: nowIso, doneAt: null };
      if (item.note) action.note = clip(item.note, 300);
      list.push(action);
    });
    return list.slice(-MAX_ACTIONS);
  }

  function toggled(habit, actionId, nowIso) {
    return (Array.isArray(habit.actions) ? habit.actions : []).map(a => a && a.id === actionId ? Object.assign({}, a, { doneAt: a.doneAt ? null : nowIso }) : a);
  }

  // Pendientes de hoy o atrasadas; las hechas hoy siguen a la vista (tachadas).
  function dueToday(habits, todayKey) {
    const rows = [];
    (habits || []).forEach(habit => actionsOf(habit).forEach(action => {
      const doneToday = action.doneAt && String(action.doneAt).slice(0, 10) === todayKey;
      if (action.date > todayKey) return;
      if (action.doneAt && !doneToday) return;
      rows.push({ habit, action, overdue: !action.doneAt && action.date < todayKey });
    }));
    return rows.sort((a, b) => Number(!!a.action.doneAt) - Number(!!b.action.doneAt) || a.action.date.localeCompare(b.action.date));
  }

  function byDay(habits) {
    const map = {};
    (habits || []).forEach(habit => actionsOf(habit).forEach(action => { (map[action.date] = map[action.date] || []).push({ habit, action }); }));
    return map;
  }

  /* ---------- Tarjeta de Hoy ---------- */

  function statusLine(habit, m) {
    const kind = habit.mode === 'avoid' ? 'Evitar' : 'Hacer';
    const streak = m.streak ? ' · racha ' + plural(m.streak, 'día', 'días') : '';
    return kind + ' · día ' + m.day + ' de ' + m.duration + streak;
  }

  function todayButton(habit, m) {
    const id = jsArg(habit.id);
    if (habit.mode === 'avoid') {
      const failed = m.todayLog === 'failed';
      return '<button type="button" class="hh-today' + (failed ? ' is-failed' : '') + '" onclick="HabitHub.today(\'' + id + '\')">' +
        (failed ? 'Recaída hoy · quitar' : 'Registrar recaída') + '</button>';
    }
    const done = m.todayLog === 'done';
    return '<button type="button" class="hh-today' + (done ? ' is-done' : ' is-do') + '" onclick="HabitHub.today(\'' + id + '\')">' + (done ? '✓ Hecho hoy' : 'Marcar hoy') + '</button>';
  }

  function habitRow(habit, m, planned, tag) {
    const pct = Math.max(0, Math.min(100, Math.round(m.elapsed / m.duration * 100)));
    const line = planned ? 'Empieza el ' + habit.startDate.slice(8, 10) + '/' + habit.startDate.slice(5, 7) + ' · ' + plural(m.duration, 'día', 'días') : statusLine(habit, m);
    const today = planned ? '' : (habit.mode === 'avoid' && m.todayLog !== 'failed' ? '<span class="hh-ok">Hoy, sin recaída</span>' : '');
    return '<div class="hh-habit' + (tag ? ' is-' + tag : '') + '">' +
      '<button type="button" class="hh-open" onclick="openHabitos(\'' + jsArg(habit.id) + '\')">' +
        (tag === 'reopened' ? '<span class="hh-tag">Reabierto</span>' : '') +
        '<b>' + esc(habit.title || 'Hábito') + '</b><small>' + esc(line) + '</small>' + today +
        '<span class="hh-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></button>' +
      (planned ? '' : todayButton(habit, m)) + '</div>';
  }

  function hoyHtml(env) {
    const e = env || {};
    const habits = e.habits || [];
    const todayKey = e.todayKey;
    const metrics = e.metrics;
    const M = e.maintenanceApi;
    if (!metrics || !todayKey) return '';
    const active = habits.filter(h => !metrics(h).complete);
    const principal = active.find(h => !h.reopenOf) || null;
    const reopened = active.find(h => h.reopenOf) || null;
    let body = '';
    [[principal, ''], [reopened, 'reopened']].forEach(([habit, tag]) => {
      if (!habit) return;
      const m = metrics(habit);
      body += habitRow(habit, m, habit.startDate > todayKey, tag);
    });
    if (!principal) body += '<button type="button" class="hh-create" onclick="openHabitChallengeModal()">＋ Crear un hábito nuevo</button>';

    const due = dueToday(habits, todayKey);
    if (due.length) {
      body += '<div class="hh-actions"><span class="hh-sub">Acciones de hoy</span>' + due.map(({ habit, action, overdue }) => actionRowHtml(habit, action, overdue)).join('') + '</div>';
    }

    if (M) {
      const seen = new Set();
      const upkeep = habits.filter(h => metrics(h).complete).map(h => M.state(habits, h, todayKey))
        .filter(s => s.applies && !s.reopen && !seen.has(s.familyId) && seen.add(s.familyId));
      if (upkeep.length) {
        body += '<div class="hh-upkeep"><span class="hh-sub">En mantenimiento</span>' + upkeep.map(s =>
          '<div class="hh-up-row is-' + s.level + '"><button type="button" class="hh-up-open" onclick="openHabitos(\'' + jsArg(s.familyId) + '\')"><b>' + esc(s.origin.title || 'Hábito') + '</b>' +
          '<small>' + (s.level === 'relapse' ? 'Recaída: toca reabrir el reto' : plural(s.daysClean, 'día', 'días') + ' sin caídas') + '</small></button>' +
          '<button type="button" class="hh-up-lapse" onclick="HabitMaintenance.openLapse(\'' + jsArg(s.familyId) + '\')">Caída</button></div>').join('') + '</div>';
      }
    }
    return '<div class="mv2-card mv2-habits"><div class="mv2-line"><span class="mv2-lbl has-ico">' + (root.MobileV2 && root.MobileV2.icon ? root.MobileV2.icon('habitos') : '') + 'Hábitos</span><button type="button" class="mv2-link" onclick="openHabitos()">Ver todos ›</button></div>' + body + '</div>';
  }

  // `sub` sustituye la línea pequeña (por defecto: el hábito y si va con retraso).
  function actionRowHtml(habit, action, overdue, sub) {
    const done = !!action.doneAt;
    const open = action.type === 'rulebook' && !done
      ? '<button type="button" class="hh-act-go" onclick="HabitHub.openAction(\'' + jsArg(habit.id) + '\',\'' + jsArg(action.id) + '\')">Abrir</button>' : '';
    return '<div class="hh-act' + (done ? ' is-done' : '') + '">' +
      '<button type="button" class="hh-check" role="checkbox" aria-checked="' + done + '" aria-label="' + (done ? 'Hecha' : 'Marcar como hecha') + ': ' + esc(action.text) + '" onclick="HabitHub.toggle(\'' + jsArg(habit.id) + '\',\'' + jsArg(action.id) + '\')">' + (done ? '✓' : '') + '</button>' +
      '<span><b>' + esc(action.text) + '</b><small>' + esc(sub != null ? sub : (habit.title || 'Hábito') + (overdue ? ' · pendiente desde el ' + action.date.slice(8, 10) + '/' + action.date.slice(5, 7) : '')) + '</small></span>' + open + '</div>';
  }

  // Página del hábito: pendientes primero, y las últimas hechas.
  function pageHtml(habit) {
    const all = actionsOf(habit);
    const pending = all.filter(a => !a.doneAt).sort((a, b) => a.date.localeCompare(b.date));
    const done = all.filter(a => a.doneAt).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))).slice(0, 5);
    const rows = pending.concat(done).map(a => actionRowHtml(habit, a, false,
      a.date.slice(8, 10) + '/' + a.date.slice(5, 7) + (a.source === 'lapse' || a.source === 'relapse' ? ' · tras una caída' : ''))).join('');
    return '<section class="hp-block hp-actions"><div class="hp-actions-head"><h3>Acciones</h3><button type="button" class="hp-link" onclick="HabitHub.suggestAfter(\'' + jsArg(habit.id) + '\', \'manual\')">＋ Añadir</button></div>' +
      (rows ? '<div class="hh-actions">' + rows + '</div>' : '<p class="hp-rb-since">Sin acciones. Cuando apuntes una caída, la app te propondrá qué hacer y lo verás en Hoy y en el calendario.</p>') + '</section>';
  }

  /* ---------- Interfaz (solo en el navegador) ---------- */

  let pendingCtx = null;

  function el(id) { return root.document ? root.document.getElementById(id) : null; }
  function todayKeyNow() { return typeof root.habitDayKey === 'function' ? root.habitDayKey() : new Date().toISOString().slice(0, 10); }
  function allHabits() { return typeof root.habitAllChallenges === 'function' ? root.habitAllChallenges() : []; }
  function toast(text) { if (typeof root.showToast === 'function') root.showToast(text); }

  function env() {
    return { habits: allHabits(), todayKey: todayKeyNow(), metrics: h => root.habitMetrics(h), maintenanceApi: root.HabitMaintenance || null };
  }
  function renderHoyCard() { try { return typeof root.habitMetrics === 'function' ? hoyHtml(env()) : ''; } catch (error) { return ''; } }

  function refresh() {
    try { if (root.MobileV2 && typeof root.MobileV2.renderHoy === 'function') root.MobileV2.renderHoy(); } catch (e) {}
    try { if (root.MobileV2 && typeof root.MobileV2.renderCal === 'function') root.MobileV2.renderCal(); } catch (e) {}
    // La hoja del día abierta en el calendario se repinta con la acción marcada.
    try {
      const sheet = root.document && root.document.getElementById('mv2DaySheet');
      if (sheet && sheet.classList.contains('open') && sheet.dataset.day && root.MobileV2) root.MobileV2.openDay(sheet.dataset.day);
    } catch (e) {}
    try { if (root.HabitsPage && typeof root.HabitsPage.render === 'function' && root.document.body.getAttribute('data-view') === 'habitos') root.HabitsPage.render(); } catch (e) {}
  }

  function mutate(habitId, fn) {
    if (typeof root.habitStoredChallenges !== 'function' || typeof root.habitPersistChallenges !== 'function') return false;
    const stored = root.habitStoredChallenges();
    const habit = stored.find(h => h && h.id === habitId && !h.deleted);
    if (!habit || fn(habit) === false) return false;
    habit.updatedAt = new Date().toISOString();
    root.habitPersistChallenges(stored);
    if (typeof root.saveData === 'function') root.saveData();
    if (typeof root.renderHabitCalendar === 'function') root.renderHabitCalendar();
    refresh();
    return true;
  }

  function today(habitId) {
    const habit = allHabits().find(h => h.id === habitId);
    if (!habit) return;
    if (habit.mode === 'avoid' && typeof root.registerHabitRelapse === 'function') root.registerHabitRelapse(null, habitId);
    else if (typeof root.toggleHabitToday === 'function') root.toggleHabitToday(null, habitId);
    refresh();
  }

  function toggle(habitId, actionId) {
    const nowIso = new Date().toISOString();
    mutate(habitId, habit => { habit.actions = toggled(habit, actionId, nowIso); });
  }

  function openAction(habitId, actionId) {
    const habit = allHabits().find(h => h.id === habitId);
    const action = habit && actionsOf(habit).find(a => a.id === actionId);
    if (!habit || !action) return;
    if (action.type === 'rulebook' && root.HabitRulebook) {
      if (root.MobileV2 && typeof root.MobileV2.closeSheet === 'function') root.MobileV2.closeSheet('mv2DaySheet');
      root.HabitRulebook.openEditor(habitId);
      const cases = el('hrbCases');
      if (cases && action.note) cases.value = action.note;
    }
  }

  /* Tras una caída: propone acciones; lo aceptado va al calendario. */
  function suggestAfter(habitId, kind, info) {
    const habit = allHabits().find(h => h.id === habitId);
    if (!habit || !el('modalHabitAction')) return;
    const todayKey = todayKeyNow();
    const list = suggestions(habit, { todayKey, rulebookApi: root.HabitRulebook || null });
    const M = root.HabitMaintenance;
    const upkeep = kind === 'lapse' && M ? M.state(allHabits(), habit, todayKey) : null;
    pendingCtx = { habitId, kind, list, note: (info && info.note) || '', day: (info && info.day) || todayKey };
    const tomorrow = keyAt(todayKey, 1);
    el('hlaHabit').textContent = habit.title || 'Hábito';
    el('hlaTitle').textContent = kind === 'lapse' ? 'Caída apuntada' : kind === 'relapse' ? 'Recaída apuntada' : 'Acciones del hábito';
    el('hlaIntro').textContent = kind === 'manual'
      ? 'Lo que elijas lo verás en Hoy y en el calendario.'
      : 'No borra el reto. Elige qué harás para que no se repita: lo verás en Hoy y en el calendario.';
    el('hlaList').innerHTML = list.map((s, i) =>
      '<div class="hla-item" data-key="' + s.key + '"><label><input type="checkbox" ' + (i < 2 ? 'checked' : '') + '><span>' + esc(s.text) + '</span></label>' +
      '<div class="hla-when" role="group" aria-label="Cuándo"><button type="button" class="active" data-date="' + todayKey + '">Hoy</button><button type="button" data-date="' + tomorrow + '">Mañana</button></div></div>').join('');
    el('hlaList').querySelectorAll('.hla-when').forEach(group => group.addEventListener('click', event => {
      const btn = event.target.closest('button[data-date]');
      if (!btn) return;
      group.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    }));
    const noteWrap = el('hlaNoteWrap');
    if (noteWrap) noteWrap.hidden = kind !== 'relapse';
    if (el('hlaNote')) el('hlaNote').value = '';
    if (el('hlaCustom')) el('hlaCustom').value = '';
    const reopen = el('hlaReopen');
    if (reopen) reopen.hidden = !(upkeep && upkeep.applies && upkeep.level === 'relapse' && !upkeep.reopen);
    if (typeof root.openModal === 'function') root.openModal('modalHabitAction');
  }

  function accept() {
    const ctx = pendingCtx;
    if (!ctx) return;
    const todayKey = todayKeyNow();
    const chosen = [];
    (el('hlaList') ? el('hlaList').querySelectorAll('.hla-item') : []).forEach(row => {
      const s = ctx.list.find(item => item.key === row.dataset.key);
      if (!s || !row.querySelector('input').checked) return;
      const date = row.querySelector('.hla-when .active')?.dataset.date || todayKey;
      chosen.push({ text: s.text, type: s.type, date });
    });
    const custom = String(el('hlaCustom') ? el('hlaCustom').value : '').trim();
    if (custom) chosen.push({ text: custom, type: 'task', date: todayKey });
    const note = String(el('hlaNote') ? el('hlaNote').value : '').trim().slice(0, 300) || ctx.note;
    const nowIso = new Date().toISOString();
    mutate(ctx.habitId, habit => {
      // La acción «reglamento» lleva lo que pasó: al abrirla, la IA lo recibe como caso.
      const items = chosen.map(item => item.type === 'rulebook' && note ? Object.assign({}, item, { note }) : item);
      habit.actions = withActions(habit, items, nowIso, ctx.kind);
      if (ctx.kind === 'relapse' && note && habit.logs && habit.logs[ctx.day]) habit.logs[ctx.day] = Object.assign({}, habit.logs[ctx.day], { note });
    });
    pendingCtx = null;
    if (typeof root.closeModal === 'function') root.closeModal('modalHabitAction');
    toast(chosen.length ? plural(chosen.length, 'acción añadida', 'acciones añadidas') + ' · en Hoy y en el calendario' : 'Apuntado. Esta noche, vuelta a la norma');
  }

  function skip() {
    pendingCtx = null;
    if (typeof root.closeModal === 'function') root.closeModal('modalHabitAction');
  }

  function reopenNow() {
    const ctx = pendingCtx;
    skip();
    if (ctx && root.HabitMaintenance) root.HabitMaintenance.reopen(ctx.habitId);
  }

  function install() {
    const doc = root.document;
    if (!doc || install.done) return;
    install.done = true;
    // Todo lo que cambia un hábito acaba en renderHabitCalendar: Hoy y el calendario se repintan.
    const hook = () => {
      if (typeof root.renderHabitCalendar !== 'function' || root.renderHabitCalendar.__habitHub) return !!root.renderHabitCalendar;
      const original = root.renderHabitCalendar;
      const wrapped = function () { const r = original.apply(this, arguments); refresh(); return r; };
      wrapped.__habitHub = true;
      Object.keys(original).forEach(k => { wrapped[k] = original[k]; });
      root.renderHabitCalendar = wrapped;
      return true;
    };
    if (!hook()) doc.addEventListener('DOMContentLoaded', hook, { once: true });
    root.addEventListener && root.addEventListener('load', () => { hook(); refresh(); }, { once: true });
  }

  if (root.document) install();

  return {
    actionsOf, suggestions, withActions, toggled, dueToday, byDay, hoyHtml, actionRowHtml, pageHtml,
    renderHoyCard, today, toggle, openAction, suggestAfter, accept, skip, reopenNow, refresh,
  };
});
