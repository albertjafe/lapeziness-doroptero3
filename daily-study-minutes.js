/* Tiempo diario de estudio sin doble conteo.

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
      como fallback completo;
   5) un bloque General repartido entre pasajes sigue siendo evidencia canónica
      aunque su residual General sea 0; sus hijos ya contienen esos minutos;
   6) las estadísticas de "estudio" usan tiempo equivalente: estudio ×1,
      estudio mental ×1, clase de piano ×0,5 y cámara ×0,5. El bloque conserva rawMins para poder
      mostrar también la duración física real sin falsear el cronómetro.
*/
(function dailyStudyMinutesFix(){
  'use strict';

  const FIX_VERSION = 10;
  const OVERLAP_TOLERANCE_MS = 30000;
  const PASSAGE_GENERAL_SOURCE = 'passage-general-v1';
  const ACTIVITY_FACTORS = Object.freeze({ study:1, mental:1, piano_class:.5, chamber:.5 });

  function appDb(){
    try { if (typeof db !== 'undefined' && db) return db; } catch (error) {}
    return typeof window !== 'undefined' ? window.db || null : null;
  }

  function dayKey(value){
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function normalizeActivityType(value){
    const key = String(value || 'study');
    return Object.prototype.hasOwnProperty.call(ACTIVITY_FACTORS,key) ? key : 'study';
  }

  function activityFactor(item){
    const type = normalizeActivityType(item && item.activityType);
    // Chamber changed globally from 1/3 to 1/2 in v430. Treat old explicit
    // 1/3 values as historical metadata so every chamber block recalculates.
    if (type === 'chamber') return ACTIVITY_FACTORS.chamber;
    const explicit = Number(item && item.activityFactor);
    if (Number.isFinite(explicit) && explicit > 0 && explicit <= 1) return explicit;
    return ACTIVITY_FACTORS[type];
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
    const studied = item.manual || item.estudiado === true || (item.estudiado !== false && (item.tick === 'hecho' || item.tick === 'parcial' || item._isExtra === true));
    if (!studied) return 0;
    return Math.max(0, Number(item.minutosEstudiados ?? item.minutosReales ?? item.minutosPlan ?? item.min ?? 0) || 0);
  }

  function plantMinutes(plant){
    return Math.max(0, Number(plant && (plant.mins ?? plant.min)) || 0);
  }

  function isPassageAllocationParent(plant){
    return !!(plant && plant.passageAllocation && plant.passageAllocation.source === PASSAGE_GENERAL_SOURCE);
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
    if (!day.timed[target]) day.timed[target] = { mins: 0, entries: [], canonicalTimer: false };
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
      return { target, mins, planId: planId || '', manual: !!(item && item.manual), startMs, endMs, evidence: item };
    }
    return {
      target: previous.target || target,
      evidence: previous.evidence,
      mins: Math.max(previous.mins || 0, mins || 0),
      planId: previous.planId || planId || '',
      manual: previous.manual || !!(item && item.manual),
      startMs: previous.startMs == null ? startMs : (startMs == null ? previous.startMs : Math.min(previous.startMs, startMs)),
      endMs: previous.endMs == null ? endMs : (endMs == null ? previous.endMs : Math.max(previous.endMs, endMs)),
    };
  }

  function sessionPlanBackedByTimed(entry, timedTarget){
    if (!entry || !timedTarget || (!(timedTarget.mins > 0) && !timedTarget.canonicalTimer)) return false;
    const planId = String(entry.planId || '');
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

  function sessionExtraByTarget(bucket, collect){
    const out = Object.create(null);
    const unmatchedTimedByTarget = Object.create(null);
    Object.keys(bucket.timed || {}).forEach(target => {
      unmatchedTimedByTarget[target] = (bucket.timed[target].entries || [])
        .filter(entry => entry && entry.mins > 0)
        .map(entry => ({ mins: entry.mins, source: entry.source }));
    });
    Object.values(bucket.sessionPlans || {}).forEach(entry => {
      if (!entry || !(entry.mins > 0)) return;
      const timedTarget = bucket.timed[entry.target];
      if (timedTarget && sessionPlanBackedByTimed(entry, timedTarget)) return;
      if (entry.manual || entry.planId) {
        const pool = unmatchedTimedByTarget[entry.target] || [];
        const match = pool.findIndex(timed => {
          if (entry.manual && timed.source !== 'manual') return false;
          if (!entry.manual && timed.source === 'manual') return false;
          return Math.abs(timed.mins - entry.mins) < 0.01;
        });
        if (match >= 0) {
          pool.splice(match, 1);
          return;
        }
      }
      out[entry.target] = (out[entry.target] || 0) + entry.mins;
      if (collect) collect(entry);
    });
    return out;
  }

  function weightedBlock(evidence, date, rawMins, activity = evidence){
    const type = normalizeActivityType(activity && activity.activityType);
    const factor = activityFactor(activity);
    return {
      ...(evidence || {}),
      date,
      rawMins: Math.max(0, Number(rawMins) || 0),
      mins: Math.max(0, Number(rawMins) || 0) * factor,
      activityType:type,
      activityFactor:factor,
    };
  }

  function minutesByDay(start, end, database = appDb(), detailed = false){
    if (!database) return detailed ? [] : {};
    const startMs = start instanceof Date ? start.getTime() : new Date(start).getTime();
    const endMs = end instanceof Date ? end.getTime() : new Date(end).getTime();
    const days = Object.create(null);
    const seenPlants = new Set();
    const recorded = (database.pianoRewards?.sessions || []).filter(item=>item && item.id && !item.deleted && !item.deletedAt);
    const activityEvidence = evidence => {
      // Older timer plants lack activity fields. The finished run retains the
      // original type; inherit it only with a verifiable identity/timestamp.
      // An explicit type on the canonical block always wins after an edit.
      if(evidence?.activityType != null || evidence?.activityFactor != null)return evidence;
      return recorded.find(item=>evidence?.runId===item.id || String(evidence?.runId || '').startsWith(item.id+'::passage::') || evidence?.id==='run_'+item.id ||
        (evidence?.startedAt && Date.parse(evidence.startedAt)===Date.parse(item.startedAt))) || evidence;
    };

    const addPlant = plant => {
      if (!plant || plant.failed || plant.tipo === 'descanso') return;
      const when = new Date(plant.startedAt || plant.endedAt || 0);
      const ms = when.getTime();
      if (!Number.isFinite(ms) || ms < startMs || ms >= endMs) return;
      const mins = plantMinutes(plant);
      const allocationParent = isPassageAllocationParent(plant);
      if (!(mins > 0) && !allocationParent) return;
      const duplicateKey = duplicatePlantKey(plant);
      if (seenPlants.has(duplicateKey)) return;
      seenPlants.add(duplicateKey);

      const day = ensureDay(days, dayKey(when));
      const target = targetKey(plant);
      const timedTarget = ensureTimedTarget(day, target);
      const pStart = parseMs(plant.startedAt) ?? ms;
      const pEnd = parseMs(plant.endedAt);
      timedTarget.mins += mins;
      timedTarget.canonicalTimer = true;
      timedTarget.entries.push({ startMs: pStart, endMs: pEnd, mins, source: String(plant.source || ''), evidence: plant });
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

    const out = {}, blocks = [];
    Object.keys(days).forEach(key => {
      const bucket = days[key];
      const dayBlocks = [];
      const extraEntries = [];
      sessionExtraByTarget(bucket, entry => extraEntries.push(entry));

      Object.keys(bucket.timed || {}).forEach(target => {
        (bucket.timed[target]?.entries || []).forEach(entry => {
          if (!(entry.mins > 0)) return;
          dayBlocks.push(weightedBlock(entry.evidence,key,entry.mins,activityEvidence(entry.evidence)));
        });
      });
      extraEntries.forEach(entry => dayBlocks.push(weightedBlock(entry.evidence,key,entry.mins,activityEvidence(entry.evidence))));

      const total = dayBlocks.reduce((sum,block)=>sum+Math.max(0,Number(block.mins)||0),0);
      out[key] = Math.max(0, Math.round(total));
      // Keep the block projection equal to the established rounded daily total.
      if (detailed && dayBlocks.length) {
        let correction = out[key] - total;
        for (let i = dayBlocks.length - 1; i >= 0 && Math.abs(correction) > 1e-9; i--) {
          const change = Math.max(-dayBlocks[i].mins, correction);
          dayBlocks[i].mins += change;
          correction -= change;
        }
        blocks.push(...dayBlocks);
      }
    });
    return detailed ? blocks : out;
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
    if (window.getMinutosConcentradoHoy && window.getMinutosConcentradoHoy.__equivalentStudyV7) return true;
    if (!appDb()) return false;

    const byDay = function correctedStatsMinutesByDay(start, end){ return minutesByDay(start, end); };
    byDay.__equivalentStudyV7 = true;
    const today = function correctedTodayStudyMinutes(){ return todayMinutes(); };
    today.__equivalentStudyV7 = true;

    try { _statsMinsPorDia = byDay; } catch (error) {}
    try { getMinutosConcentradoHoy = today; } catch (error) {}
    window._statsMinsPorDia = byDay;
    window.getMinutosConcentradoHoy = today;
    try { if (typeof refreshStudyViews === 'function') refreshStudyViews(); } catch (error) {}
    try { if (typeof cronoUpdateRunTodayTotal === 'function') cronoUpdateRunTodayTotal(); } catch (error) {}
    try { if (typeof updateLiveProbabilityUI === 'function') updateLiveProbabilityUI(true); } catch (error) {}
    return true;
  }

  const studyBlocks = (start, end, database = appDb()) => minutesByDay(start, end, database, true);
  const api = { version: FIX_VERSION, ACTIVITY_FACTORS, normalizeActivityType, activityFactor, minutesByDay, studyBlocks, todayMinutes, duplicatePlantKey, sessionItemKey, sessionPlanBackedByTimed, isPassageAllocationParent };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;
  window.DailyStudyMinutes = api;
  let attempts = 0;
  (function boot(){
    if (install()) return;
    if (++attempts < 80) setTimeout(boot, 100);
  }());
}());
