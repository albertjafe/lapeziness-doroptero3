/* Tiempo diario real: una sola cuenta por bloque cronometrado.
   sessionPlants/forestPlants son la evidencia temporal; db.sesiones conserva
   además el resumen diario y puede contener la misma práctica. Combinamos por
   obra/movimiento con MAX, no con suma, y deduplicamos plantas repetidas. */
(function dailyStudyMinutesFix(){
  'use strict';

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
    // El mismo runId es inequívocamente el mismo cronómetro. Para registros
    // antiguos, agrupar timestamps a 2 s evita duplicados de sync con pequeñas
    // diferencias de milisegundos sin fusionar sesiones reales distintas.
    if (plant && plant.runId) return 'run::' + String(plant.runId);
    const startBucket = Number.isFinite(startMs) ? Math.round(startMs / 2000) : String(plant && plant.startedAt || '');
    const endBucket = Number.isFinite(endMs) ? Math.round(endMs / 2000) : String(plant && plant.endedAt || '');
    return targetKey(plant) + '::' + startBucket + '::' + endBucket + '::' + Math.round(mins * 100) / 100;
  }

  function ensureDay(map, key){
    if (!map[key]) map[key] = { timed: Object.create(null), session: Object.create(null) };
    return map[key];
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
      (session.items || []).forEach(item => {
        const mins = itemMinutes(item);
        if (!(mins > 0)) return;
        const key = targetKey(item);
        day.session[key] = (day.session[key] || 0) + mins;
      });
    });

    const out = {};
    Object.keys(days).forEach(key => {
      const bucket = days[key];
      const targets = new Set(Object.keys(bucket.timed).concat(Object.keys(bucket.session)));
      let total = 0;
      targets.forEach(target => {
        total += Math.max(bucket.timed[target] || 0, bucket.session[target] || 0);
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
    if (window.getMinutosConcentradoHoy && window.getMinutosConcentradoHoy.__realTimedDedupV1) return true;
    if (!appDb()) return false;

    const byDay = function correctedStatsMinutesByDay(start, end){ return minutesByDay(start, end); };
    byDay.__realTimedDedupV1 = true;
    const today = function correctedTodayStudyMinutes(){ return todayMinutes(); };
    today.__realTimedDedupV1 = true;

    try { _statsMinsPorDia = byDay; } catch (error) {}
    try { getMinutosConcentradoHoy = today; } catch (error) {}
    window._statsMinsPorDia = byDay;
    window.getMinutosConcentradoHoy = today;
    window.DailyStudyMinutes = { minutesByDay, todayMinutes, duplicatePlantKey };

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
