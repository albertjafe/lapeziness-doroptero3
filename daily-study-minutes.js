/* Tiempo diario real: una sola cuenta por bloque cronometrado.
   sessionPlants/forestPlants son la evidencia temporal; db.sesiones conserva
   además el resumen diario y puede contener la misma práctica varias veces.

   Regla:
   1) deduplicar plantas por run/timestamp;
   2) deduplicar items de db.sesiones por _planId/id ANTES de sumarlos;
   3) por obra/movimiento tomar MAX(tiempo cronometrado, resumen de sesiones).

   Así una copia acumulada como 26 + 52 con el mismo _planId cuenta 52, no 78. */
(function dailyStudyMinutesFix(){
  'use strict';

  const FIX_VERSION = 2;

  function appDb(){
    try { if (typeof db !== 'undefined' && db) return db; } catch (error) {}
    return window.db || null;
  }

  function dayKey(value){
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function targetKey(item){
    if (!item) return '';
    const obra = item.obraId || item.tag || item.obraName || item._planId || 'sin-obra';
    return String(obra) + '::' + String(item.movId || '');
  }

  function itemMinutes(item){
    try {
      if (typeof _itemMinReal === 'function') return Math.max(0, Number(_itemMinReal(item)) || 0);
    } catch (error) {}
    if (!item) return 0;
    const studied = item.estudiado === true || item.tick === 'hecho' || item.tick === 'parcial' || item._isExtra === true;
    if (!studied) return 0;
    return Math.max(0, Number(item.minutosReales ?? item.minutosPlan ?? 0) || 0);
  }

  function plantMinutes(plant){
    return Math.max(0, Number(plant && (plant.mins ?? plant.min)) || 0);
  }

  function duplicatePlantKey(plant){
    const mins = plantMinutes(plant);
    const startMs = Date.parse(plant && plant.startedAt || '');
    const endMs = Date.parse(plant && plant.endedAt || '');
    if (plant && plant.runId) return 'run::' + String(plant.runId);
    const startBucket = Number.isFinite(startMs) ? Math.round(startMs / 2000) : String(plant && plant.startedAt || '');
    const endBucket = Number.isFinite(endMs) ? Math.round(endMs / 2000) : String(plant && plant.endedAt || '');
    return targetKey(plant) + '::' + startBucket + '::' + endBucket + '::' + Math.round(mins * 100) / 100;
  }

  function sessionItemKey(item, session, index){
    if (item && item._planId) return 'plan::' + String(item._planId);
    if (item && item.id) return 'id::' + String(item.id);
    if (item && item.runId) return 'run::' + String(item.runId);
    const started = item && (item.startedAt || item.startAt) || '';
    const ended = item && (item.endedAt || item.endAt) || '';
    if (started || ended) return 'time::' + targetKey(item) + '::' + started + '::' + ended;
    // Sin identidad persistente no debemos fusionar dos registros manuales
    // distintos por accidente. El índice los mantiene separados.
    return 'anon::' + String(session && session.date || '') + '::' + targetKey(item) + '::' + index;
  }

  function ensureDay(map, key){
    if (!map[key]) {
      map[key] = {
        timed: Object.create(null),
        sessionPlans: Object.create(null),
      };
    }
    return map[key];
  }

  function sessionTotalsByTarget(bucket){
    const out = Object.create(null);
    Object.values(bucket.sessionPlans || {}).forEach(entry => {
      if (!entry || !(entry.mins > 0)) return;
      out[entry.target] = (out[entry.target] || 0) + entry.mins;
    });
    return out;
  }

  function minutesByDay(start, end){
    const database = appDb();
    if (!database) return {};
    const startMs = start instanceof Date ? start.getTime() : new Date(start).getTime();
    const endMs = end instanceof Date ? end.getTime() : new Date(end).getTime();
    const days = Object.create(null);
    const seenPlants = new Set();

    const addPlant = plant => {
      if (!plant || plant.failed || plant.tipo === 'descanso') return;
      const when = new Date(plant.startedAt || plant.endedAt || 0);
      const ms = when.getTime();
      if (!Number.isFinite(ms) || ms < startMs || ms >= endMs) return;
      const mins = plantMinutes(plant);
      if (!(mins > 0)) return;
      const duplicateKey = duplicatePlantKey(plant);
      if (seenPlants.has(duplicateKey)) return;
      seenPlants.add(duplicateKey);
      const day = ensureDay(days, dayKey(when));
      const key = targetKey(plant);
      day.timed[key] = (day.timed[key] || 0) + mins;
    };

    (database.sessionPlants || []).forEach(addPlant);
    (database.forestPlants || []).forEach(addPlant);

    (database.sesiones || []).forEach(session => {
      if (!session || !session.date) return;
      const when = new Date(session.date);
      const ms = when.getTime();
      if (!Number.isFinite(ms) || ms < startMs || ms >= endMs) return;
      const day = ensureDay(days, dayKey(when));
      (session.items || []).forEach((item, index) => {
        const mins = itemMinutes(item);
        if (!(mins > 0)) return;
        const planKey = sessionItemKey(item, session, index);
        const target = targetKey(item);
        const previous = day.sessionPlans[planKey];
        // La app puede persistir snapshots acumulativos del mismo plan, p. ej.
        // 26 min y luego 52 min. El más alto sustituye al anterior.
        if (!previous || mins > previous.mins) day.sessionPlans[planKey] = { target, mins };
      });
    });

    const out = {};
    Object.keys(days).forEach(key => {
      const bucket = days[key];
      const session = sessionTotalsByTarget(bucket);
      const targets = new Set(Object.keys(bucket.timed).concat(Object.keys(session)));
      let total = 0;
      targets.forEach(target => {
        total += Math.max(bucket.timed[target] || 0, session[target] || 0);
      });
      out[key] = Math.max(0, Math.round(total));
    });
    return out;
  }

  function todayMinutes(){
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return minutesByDay(start, end)[dayKey(now)] || 0;
  }

  function install(){
    if (window.getMinutosConcentradoHoy && window.getMinutosConcentradoHoy.__realTimedDedupV2) return true;
    if (!appDb()) return false;

    const byDay = function correctedStatsMinutesByDay(start, end){ return minutesByDay(start, end); };
    byDay.__realTimedDedupV2 = true;
    const today = function correctedTodayStudyMinutes(){ return todayMinutes(); };
    today.__realTimedDedupV2 = true;

    try { _statsMinsPorDia = byDay; } catch (error) {}
    try { getMinutosConcentradoHoy = today; } catch (error) {}
    window._statsMinsPorDia = byDay;
    window.getMinutosConcentradoHoy = today;
    window.DailyStudyMinutes = { version: FIX_VERSION, minutesByDay, todayMinutes, duplicatePlantKey, sessionItemKey };

    try { if (typeof refreshStudyViews === 'function') refreshStudyViews(); } catch (error) {}
    try { if (typeof cronoUpdateRunTodayTotal === 'function') cronoUpdateRunTodayTotal(); } catch (error) {}
    try { if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI(true); } catch (error) {}
    return true;
  }

  let attempts = 0;
  (function boot(){
    if (install()) return;
    if (++attempts < 80) setTimeout(boot, 100);
  }());
}());