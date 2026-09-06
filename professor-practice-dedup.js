/* Hace que el Profesor use la misma semántica temporal canónica que Hoy.
   No modifica los datos persistidos: sanea una vista efímera de `sesiones`
   antes de que ProfessorCore construya el informe.

   Problemas que evita:
   - resúmenes repetidos con el mismo _planId/id/runId;
   - resúmenes de cronómetro que vuelven a sumar un sessionPlant ya canónico;
   - padre General repartido a pasajes: residual + hijos ya representan el total,
     aunque el padre quede en 0 min.
*/
(function professorPracticeDedupFactory(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfessorPracticeDedup = api;
  if (root && root.ProfessorCore) api.install(root.ProfessorCore);
})(typeof window !== 'undefined' ? window : globalThis, function professorPracticeDedup(root) {
  'use strict';

  const OVERLAP_TOLERANCE_MS = 30000;
  const PASSAGE_GENERAL_SOURCE = 'passage-general-v1';

  const arr = value => Array.isArray(value) ? value : [];
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const parseMs = value => {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : null;
  };
  const dayKey = value => {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  function targetKey(item) {
    if (!item) return '';
    const obra = item.obraId ?? item.workId ?? item.tag ?? item.obraName ?? item._planId ?? 'sin-obra';
    const mov = item.movId ?? item.movimientoId ?? item.movementId ?? '';
    return String(obra) + '::' + String(mov);
  }

  function itemMinutes(item) {
    try {
      if (root && root.ReadinessCore && typeof root.ReadinessCore.realMinutes === 'function') {
        return Math.max(0, num(root.ReadinessCore.realMinutes(item)));
      }
      if (typeof _itemMinReal === 'function') return Math.max(0, num(_itemMinReal(item)));
    } catch (error) {}
    if (!item) return 0;
    if (item.estudiado === false) return 0;
    const studied = item.estudiado === true || item.tick === 'hecho' || item.tick === 'parcial' || item._isExtra === true;
    if (!studied && item.minutosReales == null && item.mins == null && item.minutes == null) return 0;
    return Math.max(0, num(item.minutosReales ?? item.minutosPlan ?? item.mins ?? item.minutes));
  }

  function plantMinutes(plant) {
    return Math.max(0, num(plant && (plant.mins ?? plant.min ?? plant.minutes)));
  }

  function isPassageAllocationParent(plant) {
    return !!(plant && plant.passageAllocation && plant.passageAllocation.source === PASSAGE_GENERAL_SOURCE);
  }

  function plantIdentity(plant) {
    if (!plant) return '';
    if (plant.runId) return 'run::' + String(plant.runId);
    if (plant.id) return 'id::' + String(plant.id);
    const start = plant.startedAt || '';
    const end = plant.endedAt || '';
    return targetKey(plant) + '::' + start + '::' + end + '::' + Math.round(plantMinutes(plant) * 100) / 100;
  }

  function sessionItemKey(item, session, index) {
    if (item && item._planId) return 'plan::' + String(item._planId);
    if (item && item.id) return 'id::' + String(item.id);
    if (item && item.runId) return 'run::' + String(item.runId);
    const started = item && (item.startedAt || item.startAt) || '';
    const ended = item && (item.endedAt || item.endAt) || '';
    if (started || ended) return 'time::' + targetKey(item) + '::' + started + '::' + ended;
    return 'anon::' + String(session && session.date || '') + '::' + targetKey(item) + '::' + index;
  }

  function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd + OVERLAP_TOLERANCE_MS && bStart <= aEnd + OVERLAP_TOLERANCE_MS;
  }

  function timedEvidence(db) {
    const out = Object.create(null);
    const seen = new Set();
    const add = plant => {
      if (!plant || plant.failed || plant.tipo === 'descanso') return;
      const mins = plantMinutes(plant);
      const allocationParent = isPassageAllocationParent(plant);
      if (!(mins > 0) && !allocationParent) return;
      const identity = plantIdentity(plant);
      if (identity && seen.has(identity)) return;
      if (identity) seen.add(identity);
      const when = new Date(plant.startedAt || plant.endedAt || 0);
      if (Number.isNaN(when.getTime())) return;
      const day = dayKey(when);
      const target = targetKey(plant);
      const bucketKey = day + '||' + target;
      if (!out[bucketKey]) out[bucketKey] = { canonicalTimer: false, entries: [] };
      const bucket = out[bucketKey];
      bucket.canonicalTimer = true;
      const startMs = parseMs(plant.startedAt) ?? when.getTime();
      const parsedEnd = parseMs(plant.endedAt);
      const endMs = parsedEnd != null && parsedEnd >= startMs
        ? parsedEnd
        : startMs + Math.max(1, mins) * 60000;
      bucket.entries.push({ startMs, endMs, mins });
    };
    arr(db && db.sessionPlants).forEach(add);
    arr(db && db.forestPlants).forEach(add);
    return out;
  }

  function sessionPlanBackedByTimed(entry, timedTarget) {
    if (!entry || !timedTarget || !timedTarget.canonicalTimer) return false;
    const planId = String(entry.planId || '');
    if (planId.startsWith('crono_') || planId.startsWith('pase_')) return true;
    if (entry.startMs == null) return false;
    const sessionStart = entry.startMs;
    const sessionEnd = entry.endMs != null && entry.endMs >= sessionStart
      ? entry.endMs
      : sessionStart + Math.max(1, entry.mins || 0) * 60000;
    return arr(timedTarget.entries).some(timed => intervalsOverlap(
      sessionStart,
      sessionEnd,
      timed.startMs,
      timed.endMs
    ));
  }

  function chooseRepresentative(previous, candidate) {
    if (!previous) return candidate;
    const aMins = previous.mins || 0;
    const bMins = candidate.mins || 0;
    if (bMins > aMins) return candidate;
    if (bMins < aMins) return previous;
    const richness = value => Number(value.startMs != null) + Number(value.endMs != null) + Number(Boolean(value.item && value.item.obraId));
    return richness(candidate) > richness(previous) ? candidate : previous;
  }

  function sanitizeSessions(db) {
    const sessions = arr(db && db.sesiones);
    if (!sessions.length) return sessions;
    const timed = timedEvidence(db || {});
    const representatives = new Map();

    sessions.forEach((session, sessionIndex) => {
      if (!session || !session.date) return;
      const sessionDay = dayKey(session.date);
      arr(session.items).forEach((item, itemIndex) => {
        const mins = itemMinutes(item);
        if (!(mins > 0)) return;
        const planKey = sessionDay + '||' + sessionItemKey(item, session, itemIndex);
        const startMs = parseMs(item && (item.startedAt || item.startAt));
        const endMs = parseMs(item && (item.endedAt || item.endAt));
        const candidate = {
          item,
          session,
          sessionIndex,
          itemIndex,
          day: sessionDay,
          target: targetKey(item),
          mins,
          planId: item && (item._planId || item.id || item.runId) || '',
          startMs,
          endMs,
        };
        representatives.set(planKey, chooseRepresentative(representatives.get(planKey), candidate));
      });
    });

    const keep = new Set();
    representatives.forEach(entry => {
      const timedTarget = timed[entry.day + '||' + entry.target];
      if (sessionPlanBackedByTimed(entry, timedTarget)) return;
      keep.add(entry.sessionIndex + ':' + entry.itemIndex);
    });

    return sessions.map((session, sessionIndex) => {
      if (!session || !Array.isArray(session.items)) return session;
      const items = session.items.filter((item, itemIndex) => keep.has(sessionIndex + ':' + itemIndex));
      return { ...session, items };
    });
  }

  function sanitizeDb(db) {
    if (!db || typeof db !== 'object') return db || {};
    return { ...db, sesiones: sanitizeSessions(db) };
  }

  function install(core) {
    if (!core || typeof core.buildReport !== 'function' || core.__professorPracticeDedupV1) return false;
    const originalBuild = core.buildReport;
    const originalCollect = typeof core.collectPractice === 'function' ? core.collectPractice : null;

    const wrappedBuild = function buildReportWithCanonicalPractice(db, options) {
      const clean = sanitizeDb(db || {});
      const report = originalBuild.call(this, clean, options);
      if (report && report.sourceContext) report.sourceContext.sesiones = arr(db && db.sesiones);
      return report;
    };
    wrappedBuild.__professorPracticeDedupV1 = true;
    wrappedBuild.__original = originalBuild;
    core.buildReport = wrappedBuild;

    if (originalCollect) {
      const wrappedCollect = function collectCanonicalPractice(db) {
        return originalCollect.call(this, sanitizeDb(db || {}));
      };
      wrappedCollect.__professorPracticeDedupV1 = true;
      wrappedCollect.__original = originalCollect;
      core.collectPractice = wrappedCollect;
    }

    Object.defineProperty(core, '__professorPracticeDedupV1', { value: true, configurable: true });
    return true;
  }

  return {
    version: 1,
    sanitizeDb,
    sanitizeSessions,
    timedEvidence,
    sessionItemKey,
    sessionPlanBackedByTimed,
    isPassageAllocationParent,
    install,
  };
});
