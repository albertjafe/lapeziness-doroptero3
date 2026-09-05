/* Tiempo diario real sin doble conteo.

   sessionPlants/forestPlants son la evidencia temporal canónica. db.sesiones
   contiene resúmenes y registros manuales, pero muchos resúmenes vuelven a
   representar exactamente los mismos bloques (a veces incluso con minutos
   acumulados erróneos).

   Regla:
   1) deduplicar plantas por run/timestamp;
   2) deduplicar items de sesiones por _planId/id;
   3) si un item de sesiones está respaldado por un bloque cronometrado del
      mismo objetivo (crono_/pase_ o solapamiento temporal), NO sumarlo;
   4) conservar y añadir los registros manuales/legados que no estén respaldados
      por plantas; si no existe ninguna planta para ese objetivo, sesiones actúa
      como fallback completo.
*/
(function dailyStudyMinutesFix(){
  'use strict';

  const FIX_VERSION = 3;
  const OVERLAP_TOLERANCE_MS = 30000;

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

  function parseMs(value){
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : null;
  }

  function duplicatePlantKey(plant){
    const mins = plantMinutes(plant);
    const startMs = parseMs(plant && plant.startedAt);
    const endMs = parseMs(plant && plant.endedAt);
    if (plant && plant.runId) return 'run::' + String(plant.runId);
    const startBucket = startMs != null ? Math.round(startMs / 2000) : String(plant && plant.startedAt || '');
    const endBucket = endMs != null ? Math.round(endMs / 2000) : String(plant && plant.endedAt || '');
    return targetKey(plant) + '::' + startBucket + '::' + endBucket + '::' + Math.round(mins * 100) / 100;
  }

  function sessionItemKey(item, session, index){
    if (item && item._planId) return 'plan::' + String(item._planId);
    if (item && item.id) return 'id::' + String(item.id);
    if (item && item.runId) return 'run::' + String(item.runId);
    const started = item && (item.startedAt || item.startAt) || '';
    const ended = item && (item.endedAt || item.endAt) || '';
    if (started || ended) return 'time::' + targetKey(item) + '::' + started + '::' + ended;
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

  function ensureTimedTarget(day, target){
    if (!day.timed[target]) day.timed[target] = { mins: 0, entries: [] };
    return day.timed[target];
  }

  function normalizedTimedInterval(entry){
    if (!entry) return null;
    const startMs = entry.startMs;
    if (startMs == null) return null;
    const endMs = entry.endMs != null && entry.endMs >= startMs
      ? entry.endMs
      : startMs + Math.max(1, Number(entry.mins) || 0) * 60000;
    return { startMs, endMs };
  }

  function intervalsOverlap(aStart, aEnd, bStart, bEnd){
    return aStart <= bEnd + OVERLAP_TOLERANCE_MS && bStart <= aEnd + OVERLAP_TOLERANCE_MS;
  }

  function mergeSessionPlan(previous, item, mins, target, planId){
    const startMs = parseMs(item && (item.startedAt || item.startAt));
    const endMs = parseMs(item && (item.endedAt || item.endAt));
    if (!previous) {
      return { target, mins, planId: planId || '', startMs, endMs };
    }
    return {
      target: previous.target || target,
      mins: Math.max(previous.mins || 0, mins || 0),
      planId: previous.planId || planId || '',
      startMs: previous.startMs == null ? startMs : (startMs == null ? previous.startMs : Math.min(previous.startMs, startMs)),
      endMs: previous.endMs == null ? endMs : (endMs == null ? previous.endMs : Math.max(previous.endMs, endMs)),
    };
  }

  function sessionPlanBackedByTimed(entry, timedTarget){
    if (!entry || !timedTarget || !(timedTarget.mins > 0)) return false;
    const planId = String(entry.planId || '');
    // Las familias modernas crono_/pase_ son resúmenes del propio cronómetro.
    if (planId.startsWith('crono_') || planId.startsWith('pase_')) return true;

    if (entry.startMs == null) return false;
    const sessionStart = entry.startMs;
    const sessionEnd = entry.endMs != null && entry.endMs >= sessionStart
      ? entry.endMs
      : sessionStart + Math.max(1, entry.mins || 0) * 60000;

    return (timedTarget.entries || []).some(timed => {
      const interval = normalizedTimedInterval(timed);
      return interval && intervalsOverlap(sessionStart, sessionEnd, interval.startMs, interval.endMs);
    });
  }

  function sessionExtraByTarget(bucket){
    const out = Object.create(null);
    Object.values(bucket.sessionPlans || {}).forEach(entry => {
      if (!entry || !(entry.mins > 0)) return;
      const timedTarget = bucket.timed[entry.target];
      if (timedTarget && timedTarget.mins > 0 && sessionPlanBackedByTimed(entry, timedTarget)) return;
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
      const target = targetKey(plant);
      const timedTarget = ensureTimedTarget(day, target);
      const pStart = parseMs(plant.startedAt) ?? ms;
      const pEnd = parseMs(plant.endedAt);
      timedTarget.mins += mins;
      timedTarget.entries.push({ startMs: pStart, endMs: pEnd, mins });
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
        const planId = item && (item._planId || item.id || item.runId) || '';
        day.sessionPlans[planKey] = mergeSessionPlan(day.sessionPlans[planKey], item, mins, target, planId);
      });
    });

    const out = {};
    Object.keys(days).forEach(key => {
      const bucket = days[key];
      const extras = sessionExtraByTarget(bucket);
      const targets = new Set(Object.keys(bucket.timed).concat(Object.keys(extras)));
      let total = 0;
      targets.forEach(target => {
        const timed = bucket.timed[target] ? bucket.timed[target].mins : 0;
        total += timed + (extras[target] || 0);
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
    if (window.getMinutosConcentradoHoy && window.getMinutosConcentradoHoy.__realTimedDedupV3) return true;
    if (!appDb()) return false;

    const byDay = function correctedStatsMinutesByDay(start, end){ return minutesByDay(start, end); };
    byDay.__realTimedDedupV3 = true;
    const today = function correctedTodayStudyMinutes(){ return todayMinutes(); };
    today.__realTimedDedupV3 = true;

    try { _statsMinsPorDia = byDay; } catch (error) {}
    try { getMinutosConcentradoHoy = today; } catch (error) {}
    window._statsMinsPorDia = byDay;
    window.getMinutosConcentradoHoy = today;
    window.DailyStudyMinutes = {
      version: FIX_VERSION,
      minutesByDay,
      todayMinutes,
      duplicatePlantKey,
      sessionItemKey,
      sessionPlanBackedByTimed,
    };

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