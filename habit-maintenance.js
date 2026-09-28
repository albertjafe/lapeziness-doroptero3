/* Mantenimiento de los hábitos terminados. Una caída después de terminar un
   reto no borra el trofeo ni reescribe el reto: se apunta en el hábito
   original (maintenanceLogs, un registro por día que la sincronización fusiona
   día a día) y cuenta para un umbral. Con 2 caídas en 7 días o 3 en 30 ya es
   una recaída y se reabre el reto (21 días), que puede convivir con el hábito
   nuevo en curso: como mucho uno principal y uno reabierto a la vez. El reto
   reabierto no tiene premio en puntos, para que caer nunca salga a cuenta. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HabitMaintenance = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const WEEK_LIMIT = 2;     // caídas en 7 días que ya son recaída
  const MONTH_LIMIT = 3;    // caídas en 30 días que ya son recaída
  const REOPEN_DAYS = 21;
  const UNDO_MINUTES = 15;  // solo se quita una caída si fue un toque por error

  const validKey = key => /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));
  function keyAt(start, offset) {
    const [y, m, d] = String(start).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + offset));
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }
  function dayNum(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  }

  const familyId = habit => (habit && (habit.reopenOf || habit.id)) || '';
  function endKey(habit) {
    const stored = String(habit.completedAt || '');
    if (validKey(stored)) return stored;
    const duration = Math.max(1, Math.round(Number(habit.durationDays) || 21));
    return keyAt(habit.startDate, duration - 1);
  }
  function isComplete(habit, todayKey) {
    return !!habit.completedAt || todayKey > endKey(habit);
  }
  const usable = habit => habit && habit.id && !habit.deleted && validKey(habit.startDate);

  function lapsesOf(habit) {
    return Object.entries((habit && habit.maintenanceLogs) || {})
      .filter(([date, log]) => validKey(date) && log && log.status === 'lapse')
      .map(([date, log]) => ({ date, at: String(log.at || ''), note: String(log.note || '') }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /* Estado de mantenimiento de la familia de un hábito (el original y sus
     reaperturas). Las caídas se guardan en el original; solo cuentan las
     posteriores al último reto terminado, porque un reto superado limpia. */
  function state(all, habit, todayKey) {
    const list = (all || []).filter(usable);
    const id = familyId(habit);
    const members = list.filter(h => familyId(h) === id).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const origin = list.find(h => h.id === id) || habit;
    const done = members.filter(h => isComplete(h, todayKey));
    const reopen = members.find(h => h.reopenOf && !isComplete(h, todayKey)) || null;
    if (!done.length) return { applies: false, familyId: id, origin, reopen };
    const lastEnd = done.map(endKey).sort().pop();
    const windowStart = keyAt(lastEnd, 1);
    const lapses = lapsesOf(origin);
    const counted = lapses.filter(l => l.date >= windowStart && l.date <= todayKey);
    const inLast = days => counted.filter(l => dayNum(todayKey) - dayNum(l.date) < days).length;
    const week = inLast(7);
    const month = inLast(30);
    const since = counted.length ? counted[0].date : lastEnd;
    const level = week >= WEEK_LIMIT || month >= MONTH_LIMIT ? 'relapse' : month ? 'warn' : 'ok';
    return {
      applies: true, familyId: id, origin, reopen, lastEnd, windowStart, lapses, counted,
      week, month, level, daysClean: Math.max(0, dayNum(todayKey) - dayNum(since)),
      todayLapse: counted.some(l => l.date === todayKey),
    };
  }

  // El reto reabierto hereda el reglamento vigente de la familia (no es un
  // cambio de normas, así que rige desde su primer día).
  function reopenChallenge(all, habit, todayKey, nowIso, rulebookApi) {
    const s = state(all, habit, todayKey);
    const origin = s.origin;
    const startDate = s.todayLapse ? keyAt(todayKey, 1) : todayKey;
    const members = (all || []).filter(usable).filter(h => familyId(h) === s.familyId)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    let rulebook = null;
    if (rulebookApi) {
      for (const member of members) {
        rulebook = rulebookApi.inForce(member, todayKey) || rulebookApi.pending(member, todayKey);
        if (rulebook) break;
      }
    }
    const latest = members[0] || origin;
    const challenge = {
      id: 'habit_' + Date.parse(nowIso),
      title: latest.title || origin.title || 'Hábito',
      mode: latest.mode === 'do' ? 'do' : 'avoid',
      durationDays: REOPEN_DAYS,
      startDate,
      description: latest.description || '',
      motivation: latest.motivation || '',
      successCriteria: latest.successCriteria || '',
      reward: '',
      reopenOf: s.familyId,
      logs: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (rulebook) challenge.rulebooks = [Object.assign({}, rulebook, { effectiveFrom: startDate, savedAt: nowIso })];
    return challenge;
  }

  /* ---------- Interfaz (solo en el navegador) ---------- */

  let lapseHabitId = null;

  function el(id) { return root.document ? root.document.getElementById(id) : null; }
  function todayKeyNow() { return typeof root.habitDayKey === 'function' ? root.habitDayKey() : new Date().toISOString().slice(0, 10); }
  function allHabits() { return typeof root.habitAllChallenges === 'function' ? root.habitAllChallenges() : []; }
  function toast(text) { if (typeof root.showToast === 'function') root.showToast(text); }

  function persist(mutator) {
    if (typeof root.habitStoredChallenges !== 'function' || typeof root.habitPersistChallenges !== 'function') return false;
    const stored = root.habitStoredChallenges();
    if (mutator(stored) === false) return false;
    root.habitPersistChallenges(stored);
    if (typeof root.saveData === 'function') root.saveData();
    if (typeof root.renderHabitChallenge === 'function') root.renderHabitChallenge();
    if (typeof root.renderHabitCalendar === 'function') root.renderHabitCalendar();
    if (root.HabitsPage && typeof root.HabitsPage.render === 'function') root.HabitsPage.render();
    return true;
  }

  function openLapse(habitId) {
    const habit = allHabits().find(h => h.id === habitId);
    if (!habit) return;
    const todayKey = todayKeyNow();
    const s = state(allHabits(), habit, todayKey);
    if (!s.applies) return;
    if (s.reopen) { toast('Tienes el reto reabierto en curso: apunta la caída allí'); return; }
    lapseHabitId = s.familyId;
    const min = s.windowStart > keyAt(todayKey, -30) ? s.windowStart : keyAt(todayKey, -30);
    const set = (id, fn) => { const node = el(id); if (node) fn(node); };
    set('hlHabitName', node => { node.textContent = s.origin.title || 'Hábito'; });
    set('hlDate', node => { node.min = min; node.max = todayKey; node.value = todayKey; });
    set('hlNote', node => { node.value = ''; });
    set('hlYesterday', node => { node.disabled = keyAt(todayKey, -1) < min; });
    syncChips();
    if (typeof root.openModal === 'function') root.openModal('modalHabitLapse');
  }

  function setLapseDay(offset) {
    const input = el('hlDate');
    if (!input) return;
    input.value = keyAt(todayKeyNow(), offset);
    syncChips();
  }

  function syncChips() {
    const input = el('hlDate');
    const today = todayKeyNow();
    const value = input ? input.value : today;
    const today_ = el('hlToday'), yday = el('hlYesterday');
    if (today_) today_.classList.toggle('active', value === today);
    if (yday) yday.classList.toggle('active', value === keyAt(today, -1));
  }

  function saveLapse() {
    const input = el('hlDate');
    const date = input ? input.value : '';
    const todayKey = todayKeyNow();
    const habit = allHabits().find(h => h.id === lapseHabitId);
    if (!habit) return;
    const s = state(allHabits(), habit, todayKey);
    if (!validKey(date) || date > todayKey || date < s.windowStart) { toast('Elige un día después de terminar el reto y no posterior a hoy'); return; }
    const note = String(el('hlNote') ? el('hlNote').value : '').trim().slice(0, 300);
    const nowIso = new Date().toISOString();
    const ok = persist(stored => {
      const target = stored.find(h => h && h.id === lapseHabitId && !h.deleted);
      if (!target) return false;
      target.maintenanceLogs = Object.assign({}, target.maintenanceLogs || {});
      target.maintenanceLogs[date] = { status: 'lapse', at: nowIso, note };
      target.updatedAt = nowIso;
      return true;
    });
    if (!ok) return;
    if (typeof root.closeModal === 'function') root.closeModal('modalHabitLapse');
    const after = state(allHabits(), habit, todayKey);
    toast(after.level === 'relapse' ? 'Caída apuntada. Ya es una recaída: toca reabrir el reto' : 'Caída apuntada. Esta noche, vuelta a la norma');
    try { root.Haptics && root.Haptics.success(); } catch (error) {}
  }

  function canUndo(lapse, now) {
    const at = Date.parse(lapse && lapse.at);
    return Number.isFinite(at) && (now || Date.now()) - at < UNDO_MINUTES * 60000;
  }

  function removeLapse(habitId, date) {
    const habit = allHabits().find(h => h.id === habitId);
    const lapse = habit && lapsesOf(habit).find(l => l.date === date);
    if (!lapse || !canUndo(lapse)) { toast('Una caída solo se quita si fue un toque por error, en los primeros 15 min'); return; }
    const nowIso = new Date().toISOString();
    persist(stored => {
      const target = stored.find(h => h && h.id === habitId);
      if (!target || !target.maintenanceLogs || !target.maintenanceLogs[date]) return false;
      target.maintenanceLogs = Object.assign({}, target.maintenanceLogs);
      target.maintenanceLogs[date] = { status: 'clear', at: nowIso };
      target.updatedAt = nowIso;
      return true;
    });
    toast('Caída quitada');
  }

  function reopen(habitId) {
    const todayKey = todayKeyNow();
    const all = allHabits();
    const habit = all.find(h => h.id === habitId);
    if (!habit) return;
    const s = state(all, habit, todayKey);
    if (!s.applies || s.reopen) return;
    const other = all.find(h => h.reopenOf && !isComplete(h, todayKey));
    if (other) { toast('Ya tienes un reto reabierto en curso («' + (other.title || 'Hábito') + '»). Termínalo antes de reabrir otro'); return; }
    const challenge = reopenChallenge(all, habit, todayKey, new Date().toISOString(), root.HabitRulebook || null);
    const ok = persist(stored => { stored.push(challenge); return true; });
    if (!ok) return;
    toast(challenge.startDate === todayKey ? 'Reto reabierto: 21 días desde hoy' : 'Reto reabierto: 21 días desde mañana');
    if (typeof root.openHabitos === 'function') root.openHabitos(challenge.id);
  }

  return {
    WEEK_LIMIT, MONTH_LIMIT, REOPEN_DAYS, UNDO_MINUTES,
    familyId, endKey, isComplete, lapsesOf, state, reopenChallenge, canUndo,
    openLapse, setLapseDay, syncChips, saveLapse, removeLapse, reopen,
  };
});
