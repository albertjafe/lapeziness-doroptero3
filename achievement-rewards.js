/* Premios por progreso, cofres sorpresa y logros ocultos.

   Funciones puras: todo se recalcula desde la evidencia guardada (solidez,
   pasajes, destellos, eventos y bloques de estudio), así que un premio no se
   duplica al fusionar dispositivos ni cambia al recargar. Solo pagan puntos los
   premios conseguidos desde START_DAY; los logros anteriores se muestran en la
   vitrina, sin puntos. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AchievementRewards = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  const START_DAY = '2026-09-26';
  const SOLID = 80;
  const PASSAGE_MASTERED = 85;
  const CHEST_MIN_SECONDS = 45 * 60;
  const CHEST_ODDS = 8;
  const CHEST_PRIZES = Object.freeze([.2, .3, .3, .5, .5, 1]);
  const POINTS = Object.freeze({ solidWork:1.5, masteredPassage:.5, flashMonth:1, preparedEvent:3 });

  const dayKey = (date = new Date()) => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  const toDay = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : dayKey(d); };
  const solValue = v => { const n = Number(v); if (!Number.isFinite(n)) return 0; return n > 10 ? n : Math.round(n * 10); };
  const hash = text => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193); return h >>> 0; };
  const row = (id, date, points, title, extra = {}) => ({ id:'bonus:' + id, date, source:'bonus', sharedEffortVersion:1, qualified:true,
    effortMicroPoints:Math.round(points * 1e6), title, ...extra });
  const pays = (date, today) => !!date && date >= START_DAY && date <= today;

  function entities(db) {
    const out = [];
    (db?.obras || []).forEach(obra => {
      if (!obra || obra.tipo === 'actividad' || obra.deletedAt) return;
      out.push({ key:'obra:' + obra.id, name:obra.name || 'Obra', history:obra.solHistory, obraId:obra.id });
      (obra.movimientos || []).forEach(mov => {
        if (mov && mov.id) out.push({ key:'mov:' + obra.id + ':' + mov.id, name:(obra.name || '') + ' · ' + (mov.name || ''), history:mov.solHistory, obraId:obra.id, movement:true });
      });
    });
    return out;
  }
  function ascending(history) {
    return (Array.isArray(history) ? history : []).filter(h => h && h.date)
      .map(h => ({ day:toDay(h.date), at:String(h.date), val:solValue(h.val) })).filter(h => h.day)
      .sort((a, b) => a.at.localeCompare(b.at));
  }
  // First time a work or movement rises from below 80 % to 80 % or more.
  function solidCrossing(history) {
    let below = false;
    for (const h of ascending(history)) {
      if (h.val < SOLID) below = true;
      else if (below) return h.day;
    }
    return null;
  }

  function passageMasteries(db) {
    const out = [];
    const tracker = db?.passageTracker || {};
    const deleted = new Set((tracker.passages || []).filter(p => p && p.deletedAt).map(p => String(p.id)));
    const names = new Map((tracker.passages || []).filter(p => p && p.id).map(p => [String(p.id), p.name || 'Pasaje']));
    const byPassage = new Map();
    (tracker.observations || []).forEach(o => {
      if (!o || !o.passageId || deleted.has(String(o.passageId))) return;
      const score = [o.coldScore, o.score, o.postScore].map(Number).filter(Number.isFinite);
      if (!score.length || !o.recordedAt) return;
      const list = byPassage.get(String(o.passageId)) || [];
      list.push({ at:String(o.recordedAt), val:Math.max(...score) });
      byPassage.set(String(o.passageId), list);
    });
    byPassage.forEach((list, id) => {
      let below = false;
      for (const o of list.sort((a, b) => a.at.localeCompare(b.at))) {
        if (o.val < PASSAGE_MASTERED) below = true;
        else if (below) { out.push({ key:'passage:' + id, name:names.get(id) || 'Pasaje', date:toDay(o.at) }); break; }
      }
    });
    (db?.cronoPasajes || []).forEach(p => {
      if (p && p.id && p.graduatedAt) out.push({ key:'crono-passage:' + p.id, name:p.name || 'Pasaje', date:toDay(p.graduatedAt) });
    });
    return out;
  }

  function flashDays(db) {
    const days = [];
    (db?.sesiones || []).forEach(sesion => {
      const day = toDay(sesion?.date);
      if (!day) return;
      (sesion.items || []).forEach(item => { if (item && item.destello) days.push(day); });
    });
    return days.sort();
  }
  // Date on which the Nth flash of a month was recorded, per month.
  function flashMonths(db, count) {
    const byMonth = {};
    flashDays(db).forEach(day => { (byMonth[day.slice(0, 7)] ||= []).push(day); });
    return Object.keys(byMonth).sort().filter(m => byMonth[m].length >= count).map(month => ({ month, date:byMonth[month][count - 1] }));
  }

  function latestSolBefore(entity, day) {
    const list = ascending(entity.history).filter(h => h.day <= day);
    return list.length ? list[list.length - 1].val : null;
  }
  function preparedEvents(db, today) {
    const works = entities(db);
    return (db?.eventos || []).filter(ev => ev && ev.id && Array.isArray(ev.obras) && ev.obras.length && ev.fecha).map(ev => {
      const date = toDay(ev.fecha);
      if (!date || date > today) return null;
      const ready = ev.obras.every(obraId => {
        const own = works.find(w => w.key === 'obra:' + obraId);
        const movements = works.filter(w => w.movement && w.obraId === obraId);
        const values = [own, ...movements].filter(Boolean).map(w => latestSolBefore(w, date)).filter(v => v != null);
        if (!values.length) return false;
        const ownValue = own ? latestSolBefore(own, date) : null;
        return (ownValue != null ? ownValue : Math.min(...values)) >= SOLID;
      });
      return ready ? { key:'event:' + ev.id, name:ev.nombre || ev.name || ev.titulo || 'Evento', date } : null;
    }).filter(Boolean);
  }

  function progressRows(db, today = dayKey()) {
    const rows = [];
    entities(db).forEach(entity => {
      const date = solidCrossing(entity.history);
      if (pays(date, today)) rows.push(row('progress:solid:' + entity.key, date, POINTS.solidWork, 'Obra sólida · ' + entity.name, { progress:'solid' }));
    });
    passageMasteries(db).forEach(p => {
      if (pays(p.date, today)) rows.push(row('progress:passage:' + p.key, p.date, POINTS.masteredPassage, 'Pasaje dominado · ' + p.name, { progress:'passage' }));
    });
    flashMonths(db, 5).forEach(m => {
      if (pays(m.date, today)) rows.push(row('progress:flashes:' + m.month, m.date, POINTS.flashMonth, 'Cinco destellos en un mes', { progress:'flashes' }));
    });
    preparedEvents(db, today).forEach(ev => {
      if (pays(ev.date, today)) rows.push(row('progress:event:' + ev.key, ev.date, POINTS.preparedEvent, 'Evento preparado · ' + ev.name, { progress:'event' }));
    });
    return rows;
  }

  // Deterministic by block id: every device finds the same chests without
  // storing anything, and a recalculation never re-rolls a result.
  function chestFor(session) {
    if (!session || !session.id || session.deleted || !session.date || session.date < START_DAY) return null;
    if (!(Number(session.seconds) >= CHEST_MIN_SECONDS)) return null;
    const h = hash('chest:' + session.id);
    if (h % CHEST_ODDS !== 0) return null;
    return CHEST_PRIZES[Math.floor(h / CHEST_ODDS) % CHEST_PRIZES.length];
  }
  function chestRows(sessions, today = dayKey()) {
    return (sessions || []).map(session => {
      const points = chestFor(session);
      return points && session.date <= today ? row('chest:' + session.id, session.date, points, '🎁 Cofre sorpresa', { chest:true, icon:'🎁' }) : null;
    }).filter(Boolean);
  }

  function monthDays(month) { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); }

  const HIDDEN = Object.freeze([
    { id:'hours-100', icon:'💯', title:'Centenario', hint:'Algo pasa cuando el reloj suma tres cifras…', description:'100 horas de estudio acumuladas.', points:2 },
    { id:'hours-500', icon:'🏛️', title:'Quinientas', hint:'Muchas más horas de las que caben en un mes.', description:'500 horas de estudio acumuladas.', points:5 },
    { id:'hours-1000', icon:'👑', title:'Mil horas', hint:'Un número redondo que muy pocos alcanzan.', description:'1.000 horas de estudio acumuladas.', points:10 },
    { id:'heroic-day', icon:'🔥', title:'Jornada heroica', hint:'Un día que parece no acabar nunca.', description:'Un día de 7 horas equivalentes.', points:1 },
    { id:'no-gaps-month', icon:'🧱', title:'Mes sin huecos', hint:'Treinta días seguidos no son casualidad.', description:'Un mes natural entero con al menos 1 hora cada día.', points:3 },
    { id:'three-solid', icon:'🎼', title:'Tres a la vez', hint:'Varias obras en su mejor momento, al mismo tiempo.', description:'Tres obras al 80 % de solidez a la vez.', points:2 },
    { id:'ten-flashes', icon:'✨', title:'Lluvia de destellos', hint:'Muchas chispas en muy poco tiempo.', description:'Diez destellos en un mismo mes.', points:2 }
  ]);

  // dailyMinutes: equivalent study minutes per day over the whole history
  // (DailyStudyMinutes.minutesByDay), so lifetime totals are real totals.
  function achievementDates(db, dailyMinutes, today) {
    const totals = {};
    Object.keys(dailyMinutes || {}).forEach(day => { totals[day] = Math.max(0, Number(dailyMinutes[day]) || 0) * 60; });
    const days = Object.keys(totals).filter(d => d <= today).sort(), dates = {};
    let sum = 0;
    days.forEach(day => {
      sum += totals[day];
      if (!dates['hours-100'] && sum >= 100 * 3600) dates['hours-100'] = day;
      if (!dates['hours-500'] && sum >= 500 * 3600) dates['hours-500'] = day;
      if (!dates['hours-1000'] && sum >= 1000 * 3600) dates['hours-1000'] = day;
      if (!dates['heroic-day'] && totals[day] >= 7 * 3600) dates['heroic-day'] = day;
    });
    const byMonth = {};
    days.filter(d => totals[d] >= 3600).forEach(d => { (byMonth[d.slice(0, 7)] ||= []).push(d); });
    const complete = Object.keys(byMonth).sort().find(m => byMonth[m].length >= monthDays(m));
    if (complete) dates['no-gaps-month'] = byMonth[complete].at(-1);
    const events = [];
    entities(db).filter(e => !e.movement).forEach(e => ascending(e.history).forEach(h => events.push({ ...h, key:e.key })));
    const current = new Map();
    for (const e of events.sort((a, b) => a.at.localeCompare(b.at))) {
      current.set(e.key, e.val);
      if ([...current.values()].filter(v => v >= SOLID).length >= 3) { dates['three-solid'] = e.day; break; }
    }
    const ten = flashMonths(db, 10)[0];
    if (ten) dates['ten-flashes'] = ten.date;
    return { dates, totalSeconds:sum };
  }

  // Everything the Premios screen shows: earned (with or without points) and
  // still hidden achievements, which reveal only their hint.
  function achievements(db, dailyMinutes, today = dayKey()) {
    const { dates, totalSeconds } = achievementDates(db, dailyMinutes, today);
    return HIDDEN.map(def => {
      const date = dates[def.id] || null;
      return { ...def, earned:!!date, date, paid:pays(date, today), totalHours:totalSeconds / 3600 };
    });
  }
  function achievementRows(db, dailyMinutes, today = dayKey()) {
    return achievements(db, dailyMinutes, today).filter(a => a.paid)
      .map(a => row('achievement:' + a.id, a.date, a.points, a.icon + ' ' + a.title, { achievement:true, icon:a.icon, description:a.description }));
  }

  return { START_DAY, POINTS, CHEST_ODDS, CHEST_PRIZES, HIDDEN, progressRows, chestFor, chestRows, achievements, achievementRows,
    solidCrossing, passageMasteries, preparedEvents };
});
