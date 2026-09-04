(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfessorCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DAY = 86400000;
  const DEFAULT_MASTER_PROMPT = `Eres mi profesor virtual de planificación pianística. Tu objetivo es maximizar mi preparación real y sostenible para los próximos compromisos, no maximizar horas ni repartir tiempo de forma uniforme.

REGLAS FUNDAMENTALES
- Trata CADA MOVIMIENTO como una unidad independiente. Las horas de un movimiento no justifican descuidar otro de la misma obra.
- Cámara y conciertos con orquesta: la solidez individual mide MI PARTE. Solo añade coordinación, escucha, balance, director, cues y reentradas cuando existe evidencia conjunta real; su ausencia no rebaja la preparación individual.
- No confundas familiaridad histórica con estado actual. Muchas horas históricas facilitan recuperación, pero no demuestran solidez presente.
- No repartas horas históricas no asignadas entre movimientos: úsalas solo como familiaridad general de la obra.
- Distingue medición de solidez, antigüedad de la medición y confianza. Una medición antigua es evidencia antigua, no una solidez nueva inventada.
- Ten en cuenta dificultad técnica, estudio reciente (hoy/3/7/14/30/90 días), última práctica, pases, eventos, días restantes, horas estimadas de recuperación y saturación reciente.
- Prioriza riesgo x urgencia x coste restante, pero evita sobreconcentración si otra unidad crítica se está enfriando.
- Si un evento no tiene repertorio enlazado, dilo; no inventes que una obra pertenece a ese evento.
- Si faltan datos, expresa la incertidumbre. No conviertas correlaciones en causalidad.
- Usa el estudio que ya he hecho HOY: el plan debe organizar lo que queda, no empezar el día de cero.
- La sesión en curso, si existe, está marcada como no guardada. Sus minutos ya incluidos en HOY no se suman otra vez; las notas y pausas conservan su estado real.
- Propón bloques concretos con duración y propósito. Explica brevemente por qué cada bloque está ahí.
- No modifiques datos históricos ni solidez. Solo recomienda.
- Si te doy una condición en mi mensaje (cansancio, profesor real, lesión, horario, etc.), esa condición manda sobre el plan automático.

Cuando pida organizar el día, responde primero con una propuesta compacta y accionable; después añade solo las razones importantes y qué dato cambiaría la decisión.`;

  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, num(value, lo)));
  const id = (value) => value == null ? '' : String(value);
  const arr = (value) => Array.isArray(value) ? value : [];
  const dateOf = (value) => {
    if (!value) return null;
    const d = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(value + 'T00:00:00') : new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  };
  const isoDay = (value) => {
    const d = dateOf(value);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const round1 = (value) => Math.round(num(value) * 10) / 10;
  const scoreOf = (item) => {
    if (!item) return null;
    let value = item.inputVal ?? item.val ?? item.solidezPct ?? item.solidityPct ?? item.sol ?? item.score ?? item.obraScore;
    if (value == null || value === '') return null;
    value = Number(value);
    if (!Number.isFinite(value)) return null;
    if (item.score != null && item.sol == null && item.val == null && item.inputVal == null && item.solidezPct == null && item.solidityPct == null && value >= 1 && value <= 10) value *= 10;
    return clamp(value, 0, 100);
  };
  // Editing an observation is not a new musical observation.
  const timestampOf = (item) => dateOf(item && (item.endedAt || item.startedAt || item.at || item.date || item.fecha || item.completedDate));

  function isActivityWork(work) {
    const text = [work && work.tipo, work && work.type, work && work.category].filter(Boolean).join(' ').toLowerCase();
    return Boolean(work && (work.actividad === true || work.isActivity === true || /actividad|exercise|ejercicio|escala|t[eé]cnica/.test(text)));
  }

  function latestEvidence(entity) {
    if (!entity) return { score: null, at: null, kind: null };
    const rows = [];
    arr(entity.solHistory).forEach(row => rows.push({ score: scoreOf(row), at: timestampOf(row), kind: 'solidez', confidence: row.confidence ?? row.confianza ?? null }));
    arr(entity.paseHistory).forEach(row => rows.push({ score: scoreOf(row), at: timestampOf(row), kind: 'pase', confidence: row.confidence ?? row.confianza ?? null }));
    const valid = rows.filter(row => row.score != null).sort((a, b) => (a.at ? a.at.getTime() : 0) - (b.at ? b.at.getTime() : 0));
    if (valid.length) return valid[valid.length - 1];
    return { score: scoreOf(entity), at: null, kind: entity.sol != null ? 'estado' : null };
  }

  function latestPass(entity) {
    const valid = arr(entity && entity.paseHistory).map(row => ({
      at: timestampOf(row), score: scoreOf(row), type: row.tipo || row.type || row.context || '', note: row.note || row.nota || ''
    })).filter(row => row.at || row.score != null).sort((a, b) => (a.at ? a.at.getTime() : 0) - (b.at ? b.at.getTime() : 0));
    return valid.length ? valid[valid.length - 1] : null;
  }

  function dedupeSessionPlants(db) {
    const map = new Map();
    arr(db && db.sessionPlants).forEach((plant, index) => {
      if (!plant || String(plant.failed || '').toLowerCase() === 'true') return;
      const minutes = Math.max(0, num(plant.mins ?? plant.min ?? plant.minutes));
      if (!minutes) return;
      const key = id(plant.id || plant.runId || plant.uid) || [plant.startedAt || '', plant.endedAt || '', plant.obraId || '', plant.movId || '', minutes].join('|');
      const current = map.get(key);
      if (!current) { map.set(key, { ...plant, _minutes: minutes, _index: index }); return; }
      const a = dateOf(current.correctedAt || current.updatedAt) || timestampOf(current) || new Date(0);
      const b = dateOf(plant.correctedAt || plant.updatedAt) || timestampOf(plant) || new Date(0);
      if (b >= a) map.set(key, { ...plant, _minutes: minutes, _index: index });
    });
    return Array.from(map.values());
  }

  function readGoogleCalendarState(options) {
    if (options && options.googleCalendarState) return options.googleCalendarState;
    try {
      if (root && root.localStorage) return JSON.parse(root.localStorage.getItem('alberto_google_calendar_v1') || '{}');
    } catch (error) {}
    return {};
  }

  function planningWeight(status) {
    const state = String(status || '').toLowerCase();
    if (/descartad|completad|cancel/.test(state)) return 0;
    return state === 'standby' ? 0.45 : /idea/.test(state) ? 0.25 : /planificad/.test(state) ? 0.8 : 1;
  }

  function normalizeEvents(db, asOf, options) {
    const startDay = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());

    const events = [];
    arr(db && db.eventos).forEach(event => {
      const monthly = event.fechaFlexibleTipo === 'mes' || Boolean(event.fechaObjetivoMes);
      const month = event.fechaObjetivoMes || String(event.fechaFlexibleDesde || event.fecha || '').slice(0, 7);
      const rangeStart = monthly ? dateOf(month + '-01') : dateOf(event.fecha || event.start || event.date);
      const rangeEnd = monthly && rangeStart ? new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0) : dateOf(event.fechaFin) || rangeStart;
      const at = rangeStart;
      if (!at || rangeEnd < startDay || event.completado === true || !planningWeight(event.estado || event.status)) return;
      events.push({
        key: `internal:${id(event.id || event.nombre || event.fecha)}`,
        source: 'app', id: event.id || null, name: event.nombre || event.title || 'Evento', type: event.tipo || '',
        at: monthly ? null : at.toISOString(), day: monthly ? month : isoDay(at),
        datePrecision: monthly ? 'month' : 'day', targetMonth: monthly ? month : null,
        calculationRange: { start: isoDay(rangeStart), end: isoDay(rangeEnd) },
        daysAway: Math.max(0, Math.ceil((rangeStart - startDay) / DAY)),
        status: event.estado || event.status || null, planningWeight: planningWeight(event.estado || event.status),
        sourceEvent: { ...event },
        workIds: arr(event.obras).map(id), movementTargets: event.professorMovements || event.movimientosObjetivo || null,
        repertoireLinked: arr(event.obras).length > 0,
      });
    });
    const google = readGoogleCalendarState(options);
    const selected = new Set(arr(google.selectedIds).map(id));
    arr(google.events).forEach(event => {
      if (selected.size && event.calendarId && !selected.has(id(event.calendarId))) return;
      const at = dateOf(event.start);
      if (!at || at < startDay) return;
      events.push({
        key: `google:${id(event.id || event.iCalUID || event.start + ':' + event.title)}`,
        source: 'google', id: event.id || null, name: event.title || event.summary || 'Evento de Google', type: event.type || 'calendar',
        at: at.toISOString(), day: isoDay(at), daysAway: Math.max(0, Math.ceil((at - startDay) / DAY)),
        workIds: [], movementTargets: null, repertoireLinked: false,
        calendar: event.calendarName || event.calendarId || null,
      });
    });
    const seen = new Set();
    return events.sort((a, b) => a.daysAway - b.daysAway || a.key.localeCompare(b.key)).filter(event => {
      const sig = event.key;
      if (seen.has(sig)) return false;
      seen.add(sig); return true;
    });
  }

  function linkedEventsFor(work, movement, events) {
    return events.filter(event => {
      if (!event.workIds.includes(id(work.id))) return false;
      const relations = arr(event.sourceEvent && event.sourceEvent.repertorioPlanificado).filter(rel => id(rel.obraId) === id(work.id));
      if (movement && relations.length && relations.every(rel => rel.movimientoId != null) && !relations.some(rel => id(rel.movimientoId) === id(movement.id))) return false;
      const targets = event.movementTargets;
      if (!movement || !targets) return true;
      if (Array.isArray(targets)) return targets.map(id).includes(id(movement.id));
      if (typeof targets === 'object') {
        const list = targets[id(work.id)] || targets[work.id];
        return !Array.isArray(list) || !list.length || list.map(id).includes(id(movement.id));
      }
      return true;
    });
  }

  function windowsFor(plants, workId, movementId, asOf) {
    const result = { today: 0, d3: 0, d7: 0, d14: 0, d30: 0, d90: 0, all: 0, sessions: 0, lastStudyAt: null };
    const today = isoDay(asOf);
    plants.forEach(plant => {
      if (id(plant.obraId) !== id(workId)) return;
      const plantMovement = id(plant.movId ?? plant.movimientoId ?? plant.movementId);
      if (movementId != null && plantMovement !== id(movementId)) return;
      if (movementId == null && plantMovement) return;
      const at = dateOf(plant.endedAt || plant.startedAt || plant.at);
      const minutes = Math.max(0, num(plant._minutes ?? plant.mins ?? plant.min ?? plant.minutes));
      if (!minutes || (at && at > asOf)) return;
      result.all += minutes; result.sessions += 1;
      if (!result.lastStudyAt || (at && at > result.lastStudyAt)) result.lastStudyAt = at;
      if (!at) return;
      if (at > asOf) return;
      const age = (asOf - at) / DAY;
      if (isoDay(at) === today) result.today += minutes;
      if (age <= 3) result.d3 += minutes;
      if (age <= 7) result.d7 += minutes;
      if (age <= 14) result.d14 += minutes;
      if (age <= 30) result.d30 += minutes;
      if (age <= 90) result.d90 += minutes;
    });
    Object.keys(result).forEach(key => { if (typeof result[key] === 'number') result[key] = round1(result[key]); });
    return result;
  }

  function fallbackRecoveryHours(score, difficulty, daysSinceEvidence, historicalWorkHours, recentMinutes, linkedEvents) {
    const target = linkedEvents.length && linkedEvents[0].daysAway <= 14 ? 90 : 82;
    const gap = Math.max(0, target - (score == null ? 35 : score));
    const difficultyFactor = Math.pow(1.17, clamp(difficulty, 1, 10) - 5);
    const familiarity = clamp(Math.log1p(Math.max(0, historicalWorkHours)) / Math.log(201), 0, 1);
    const familiarityFactor = 1 - familiarity * 0.48;
    const staleFactor = 1 + Math.min(0.65, Math.max(0, daysSinceEvidence - 5) / 70);
    const recentFactor = recentMinutes >= 180 ? 0.82 : recentMinutes >= 60 ? 0.92 : 1;
    const midpoint = Math.max(0.15, gap * 0.12 * difficultyFactor * familiarityFactor * staleFactor * recentFactor);
    const uncertainty = score == null ? 0.75 : daysSinceEvidence > 30 ? 0.55 : 0.35;
    return {
      low: round1(Math.max(0.1, midpoint * (1 - uncertainty))),
      high: round1(Math.max(0.3, midpoint * (1 + uncertainty))),
      target,
      source: 'professor-fallback',
    };
  }

  function readinessRecovery(db, work, movement, asOf, fallback, cache) {
    try {
      const api = root && root.ReadinessCore;
      if (!api) return fallback;
      if (!cache.has(id(work.id))) cache.set(id(work.id), typeof api.estimateReadiness === 'function' ? api.estimateReadiness(db, work.id, { now: asOf }) : null);
      const wholeEstimate = cache.get(id(work.id));
      const estimate = movement && typeof api.estimateMovementReadiness === 'function'
        ? api.estimateMovementReadiness(db, work.id, movement.id, { now: asOf, wholeEstimate })
        : movement ? null : wholeEstimate;
      if (!estimate || typeof estimate !== 'object') return fallback;
      const candidates = [
        [estimate.lowHours, estimate.highHours], [estimate.minHours, estimate.maxHours], [estimate.hoursLow, estimate.hoursHigh],
        [estimate.range && estimate.range.lowHours, estimate.range && estimate.range.highHours],
        [estimate.hours && estimate.hours.low, estimate.hours && estimate.hours.high],
      ];
      for (const pair of candidates) {
        const low = Number(pair[0]), high = Number(pair[1]);
        if (pair[0] != null && pair[1] != null && Number.isFinite(low) && Number.isFinite(high)) return { low: round1(low), high: round1(high), target: estimate.targetScore ?? fallback.target, confidence: estimate.confidence ?? null, source: 'readiness-core' };
      }
      const minuteCandidates = [
        [estimate.lowMinutes, estimate.highMinutes], [estimate.minMinutes, estimate.maxMinutes],
        [estimate.range && estimate.range.low, estimate.range && estimate.range.high],
      ];
      for (const pair of minuteCandidates) {
        const low = Number(pair[0]), high = Number(pair[1]);
        if (Number.isFinite(low) && Number.isFinite(high) && high > 2) return { low: round1(low / 60), high: round1(high / 60), target: estimate.targetScore ?? fallback.target, confidence: estimate.confidence ?? null, source: 'readiness-core' };
      }
    } catch (error) {}
    return fallback;
  }

  function priorityFor(unit) {
    const event = unit.nextEvent;
    let urgency = 0;
    if (event) {
      if (event.daysAway <= 3) urgency = 34;
      else if (event.daysAway <= 7) urgency = 29;
      else if (event.daysAway <= 14) urgency = 24;
      else if (event.daysAway <= 30) urgency = 17;
      else if (event.daysAway <= 60) urgency = 10;
      else urgency = 5;
      if (/concurso|examen|audici[oó]n|competition|exam/i.test(event.type + ' ' + event.name)) urgency += 4;
    }
    const score = unit.solidity == null ? 35 : unit.solidity;
    const gap = Math.max(0, (event && event.daysAway <= 14 ? 90 : 82) - score);
    const solidityRisk = Math.min(30, gap * 0.5);
    const staleRisk = Math.min(14, Math.max(0, unit.daysSinceStudy - 4) * 0.45);
    const evidenceRisk = unit.daysSinceEvidence == null ? 7 : Math.min(10, Math.max(0, unit.daysSinceEvidence - 7) * 0.25);
    const difficultyRisk = Math.max(0, (unit.difficulty ?? unit.difficultyForEstimation ?? 5) - 5) * 1.8;
    const recoveryRisk = Math.min(12, unit.recoveryHours.high * 1.2);
    let saturation = 0;
    if (unit.recent.d7 >= 360 && score >= 70) saturation = 13;
    else if (unit.recent.d7 >= 240 && score >= 65) saturation = 8;
    else if (unit.recent.d7 >= 180 && score >= 75) saturation = 5;
    const noEventDiscount = event ? 0 : 9;
    const value = clamp((urgency + solidityRisk + staleRisk + evidenceRisk + difficultyRisk + recoveryRisk - saturation - noEventDiscount) * (event ? (event.planningWeight ?? 1) : 1), 0, 100);
    const reasons = [];
    if (event) reasons.push(`${event.name} en ${event.daysAway} d`);
    if (unit.solidity == null) reasons.push('solidez desconocida; falta evidencia');
    else if (score < 60) reasons.push(`solidez ${Math.round(score)}%`);
    else if (score < 75) reasons.push(`solidez todavía ${Math.round(score)}%`);
    if (unit.daysSinceStudy >= 14) reasons.push(`${Math.floor(unit.daysSinceStudy)} d sin estudiar`);
    if (unit.recent.d7 >= 240) reasons.push(`${Math.round(unit.recent.d7 / 60 * 10) / 10} h esta semana`);
    if (unit.recoveryHours.high >= 4) reasons.push(`recuperación ≈${unit.recoveryHours.low}–${unit.recoveryHours.high} h`);
    if (!reasons.length) reasons.push('mantenimiento');
    return { score: round1(value), band: value >= 70 ? 'urgente' : value >= 50 ? 'alta' : value >= 30 ? 'media' : 'mantenimiento', reasons };
  }

  function buildUnits(db, asOf, events, practice) {
    const plants = practice || collectPractice(db);
    const index = new Map();
    plants.forEach(p => { const key = JSON.stringify([id(p.obraId), id(p.movId ?? p.movimientoId ?? p.movementId)]); if (!index.has(key)) index.set(key, []); index.get(key).push(p); });
    const forUnit = (workId, movId) => windowsFor(index.get(JSON.stringify([id(workId), id(movId)])) || [], workId, movId, asOf);
    const units = [];
    const recoveryCache = new Map();
    arr(db && db.obras).forEach(work => {
      if (!work || !work.id || isActivityWork(work)) return;
      const movements = arr(work.movimientos);
      const historicalMinutes = Math.max(0, num(work.minutosExtra));
      const unallocatedModern = forUnit(work.id, null);
      const workEvidence = latestEvidence(work);
      const workPass = latestPass(work);
      const targets = movements.length ? movements : [null];
      targets.forEach((movement, movementIndex) => {
        const recent = movement ? forUnit(work.id, movement.id) : unallocatedModern;
        const evidence = movement ? latestEvidence(movement) : workEvidence;
        const pass = movement ? latestPass(movement) : workPass;
        const score = evidence.score;
        const storedDifficulty = movement?.dificultad ?? work.dificultad;
        const difficulty = storedDifficulty == null || storedDifficulty === '' ? null : clamp(storedDifficulty, 1, 10);
        const difficultyForEstimation = difficulty ?? 5;
        const linkedEvents = linkedEventsFor(work, movement, events);
        const lastStudyAt = recent.lastStudyAt;
        const daysSinceStudy = lastStudyAt ? Math.max(0, (asOf - lastStudyAt) / DAY) : 999;
        const daysSinceEvidence = evidence.at ? Math.max(0, (asOf - evidence.at) / DAY) : null;
        const fallback = fallbackRecoveryHours(score, difficultyForEstimation, daysSinceEvidence == null ? 60 : daysSinceEvidence, historicalMinutes / 60, recent.d7, linkedEvents);
        const recoveryHours = readinessRecovery(db, work, movement, asOf, fallback, recoveryCache);
        const unit = {
          key: movement ? `${id(work.id)}::${id(movement.id)}` : id(work.id),
          obraId: id(work.id), movId: movement ? id(movement.id) : null,
          composer: work.composer || '', work: work.name || 'Sin título', movement: movement ? (movement.name || `Movimiento ${movementIndex + 1}`) : null,
          label: movement ? `${work.name || 'Obra'} · ${movement.name || `Mov. ${movementIndex + 1}`}` : (work.name || 'Sin título'),
          difficulty: difficulty == null ? null : round1(difficulty), difficultyForEstimation,
          solidity: score == null ? null : round1(score), evidenceAt: evidence.at ? evidence.at.toISOString() : null,
          sourceMovement: movement ? { ...movement } : null,
          evidenceConfidence: evidence.confidence ?? null,
          evidenceKind: evidence.kind, daysSinceEvidence: daysSinceEvidence == null ? null : round1(daysSinceEvidence),
          lastPass: pass ? { at: pass.at ? pass.at.toISOString() : null, score: pass.score, type: pass.type || '', note: pass.note || '' } : null,
          lastStudyAt: lastStudyAt ? lastStudyAt.toISOString() : null, daysSinceStudy: round1(daysSinceStudy), recent,
          historicalWorkMinutes: round1(historicalMinutes), historicalWorkHours: round1(historicalMinutes / 60),
          workUnallocatedModernMinutes: round1(unallocatedModern.all), movementModernMinutes: movement ? round1(recent.all) : round1(recent.all),
          recoveryHours, linkedEvents, nextEvent: linkedEvents[0] || null,
          workState: work.estado || work.learningStage || null, movementState: movement && (movement.estado || movement.learningStage) || null,
        };
        unit.priority = priorityFor(unit);
        units.push(unit);
      });
    });
    return units.sort((a, b) => b.priority.score - a.priority.score || (a.nextEvent ? a.nextEvent.daysAway : 999) - (b.nextEvent ? b.nextEvent.daysAway : 999));
  }

  function todaySummary(units) {
    const studied = units.filter(unit => unit.recent.today > 0);
    const total = studied.reduce((sum, unit) => sum + unit.recent.today, 0);
    return {
      movementMinutes: round1(total),
      unitsStudied: studied.length,
      byUnit: studied.sort((a, b) => b.recent.today - a.recent.today).map(unit => ({ key: unit.key, label: unit.label, minutes: unit.recent.today })),
    };
  }

  // Session summaries mirror timer records. Subtract their matching daily budget
  // once; never allocate whole-work or historical time to a movement.
  function collectPractice(db) {
    const plants = dedupeSessionPlants(db);
    // Legacy forest entries can mirror detailed timer entries. Only retain the
    // unrepresented remainder, at its original scope (never distribute it).
    const legacyBudget = new Map();
    const legacyKey = p => JSON.stringify([id(p.obraId),id(p.movId),isoDay(p.endedAt || p.startedAt || p.date || p.at)]);
    plants.forEach(p=>{
      const k=legacyKey(p);legacyBudget.set(k,(legacyBudget.get(k)||0)+p._minutes);
      if(p.movId){const whole=legacyKey({...p,movId:null});legacyBudget.set(whole,(legacyBudget.get(whole)||0)+p._minutes);}
    });
    dedupeSessionPlants({sessionPlants:arr(db.forestPlants)}).forEach(p=>{
      const k=legacyKey(p),covered=Math.min(p._minutes,legacyBudget.get(k)||0);
      legacyBudget.set(k,(legacyBudget.get(k)||0)-covered);
      if(p._minutes>covered) plants.push({...p,_minutes:p._minutes-covered,at:p.at||p.date});
    });
    const budget = new Map();
    const keyFor = p => JSON.stringify([id(p.obraId), id(p.movId ?? p.movimientoId ?? p.movementId), isoDay(p.endedAt || p.startedAt || p.at)]);
    plants.forEach(p => { const k = keyFor(p); budget.set(k, (budget.get(k) || 0) + p._minutes); });
    arr(db && db.sesiones).forEach(session => arr(session.items).forEach((item, i) => {
      if (item.estudiado === false) return;
      const p = { ...item, obraId: item.obraId ?? item.workId, movId: item.movId ?? item.movimientoId ?? item.movementId,
        at: item.endedAt || item.at || item.date || session.date, id: 'session:' + (session.id || session.date) + ':' + i };
      const minutes = root.ReadinessCore?.realMinutes ? root.ReadinessCore.realMinutes(item) : num(item.minutosReales ?? item.mins ?? item.minutes);
      const k = keyFor(p), covered = Math.min(minutes, budget.get(k) || 0);
      budget.set(k, (budget.get(k) || 0) - covered);
      if (minutes > covered) plants.push({ ...p, _minutes: minutes - covered });
    }));
    return plants;
  }

  function buildReport(db, options) {
    const opts = options || {};
    const asOf = dateOf(opts.asOf) || new Date();
    const events = normalizeEvents(db || {}, asOf, opts);
    const practice = collectPractice(db || {});
    const activeSession = opts.activeSession || null;
    const activeAlreadySaved = activeSession?.runId && practice.some(p => id(p.runId || p.id) === id(activeSession.runId));
    const activeMinutes = activeSession && !activeSession.isRest && !activeAlreadySaved && ['running','paused'].includes(activeSession.state)
      ? Math.max(0, num(activeSession.elapsedMs) / 60000) : 0;
    if (activeMinutes) practice.push({ ...activeSession, id: 'active:' + (activeSession.runId || 'current'),
      startedAt: activeSession.startTs ? new Date(activeSession.startTs).toISOString() : asOf.toISOString(),
      endedAt: asOf.toISOString(), _minutes: activeMinutes, unsaved: true });
    const units = buildUnits(db || {}, asOf, events, practice);
    const noLinkedUpcoming = events.filter(event => !event.repertoireLinked);
    const today = todaySummary(units);
    const totalToday = practice.filter(p => {
      const at = dateOf(p.endedAt || p.startedAt || p.at);
      return at && at <= asOf && isoDay(at) === isoDay(asOf);
    }).reduce((sum, p) => sum + p._minutes, 0);
    const unallocatedToday = Math.max(0, totalToday - today.movementMinutes);
    return {
      schemaVersion: 3,
      generatedAt: asOf.toISOString(),
      works: arr(db.obras).filter(w => !isActivityWork(w)).map(({ movimientos, ...w }) => w),
      sourceContext: {
        sesiones: arr(db.sesiones), sessionPlants: arr(db.sessionPlants), forestPlants: arr(db.forestPlants),
        activities: arr(db.obras).filter(isActivityWork),
        historicalRepertoire: arr(db.historicalRepertoire), historicalEvents: arr(db.historicalEvents),
        events: arr(db.eventos), competitionPlans: arr(db.competitionPlans), tasks: arr(db.cronoTasks),
        weeklyPlans: arr(db.weeklyPlans), blockedDaySchedules: arr(db.blockedDaySchedules),
        availability: arr(db.tiempoDisponibleEventos), registro: arr(db.registro),
        passageTracker: db.passageTracker || null,
        activeSession,
      },
      asOf: asOf.toISOString(),
      day: isoDay(asOf),
      today: { ...today, activeUnsavedMinutes: round1(activeMinutes), unallocatedMinutes: round1(unallocatedToday), totalKnownMinutes: round1(today.movementMinutes + unallocatedToday) },
      events,
      units,
      priorities: units.slice(0, 12).map(unit => ({ key: unit.key, label: unit.label, priority: unit.priority, nextEvent: unit.nextEvent, solidity: unit.solidity, recoveryHours: unit.recoveryHours, recent: unit.recent })),
      coverage: {
        internalFutureEvents: events.filter(e => e.source === 'app').length,
        googleFutureEvents: events.filter(e => e.source === 'google').length,
        eventsWithoutRepertoire: noLinkedUpcoming.length,
        units: units.length,
        movements: units.filter(u => u.movId).length,
        worksWithoutMovements: units.filter(u => !u.movId).length,
      },
      warnings: [
        ...(events.length ? [] : ['No hay eventos futuros disponibles en la app/Google Calendar para este informe.']),
        ...(noLinkedUpcoming.length ? [`${noLinkedUpcoming.length} evento(s) de calendario no tienen repertorio enlazado; sirven como contexto de agenda, no como fuente de prioridad musical.`] : []),
        ...(unallocatedToday > 0 ? [`Hay ${round1(unallocatedToday)} min de hoy sin movimiento asignado; no se reparten artificialmente entre movimientos.`] : []),
      ],
    };
  }

  function unitLine(unit) {
    const ev = unit.nextEvent ? `${unit.nextEvent.name}/${unit.nextEvent.daysAway}d` : '-';
    const sol = unit.solidity == null ? '?' : Math.round(unit.solidity);
    const age = unit.daysSinceEvidence == null ? '?' : Math.round(unit.daysSinceEvidence);
    return `${unit.key}|${unit.composer ? unit.composer + ' · ' : ''}${unit.label}|P${Math.round(unit.priority.score)} ${unit.priority.band}|sol=${sol}% obs=${age}d|dif=${unit.difficulty}|hoy=${unit.recent.today}m 3d=${unit.recent.d3}m 7d=${unit.recent.d7}m 14d=${unit.recent.d14}m 30d=${unit.recent.d30}m 90d=${unit.recent.d90}m|ult=${unit.lastStudyAt ? isoDay(unit.lastStudyAt) : '-'}|histObra=${unit.historicalWorkHours}h movMod=${round1(unit.movementModernMinutes / 60)}h noAsignObra=${round1(unit.workUnallocatedModernMinutes / 60)}h|rec=${unit.recoveryHours.low}-${unit.recoveryHours.high}h|evento=${ev}`;
  }

  function compactContext(report, maxUnits) {
    const units = report.units;
    const eventLines = report.events.map(event => `${event.day}|${event.name}|${event.type || '-'}|${event.daysAway}d|fuente=${event.source}|repertorio=${event.repertoireLinked ? event.workIds.join(',') : 'NO_ENLAZADO'}`);
    const todayLines = report.today.byUnit.map(item => `${item.label}=${item.minutes}m`).join('; ') || 'sin movimientos registrados';
    return [
      `SUPERINFORME_PROFESOR_V1 ${report.asOf}`,
      `HOY total_conocido=${report.today.totalKnownMinutes}m; por_movimiento=${report.today.movementMinutes}m; sin_movimiento=${report.today.unallocatedMinutes}m; ${todayLines}`,
      `COBERTURA ${JSON.stringify(report.coverage)}`,
      report.warnings.length ? `ADVERTENCIAS ${report.warnings.join(' | ')}` : 'ADVERTENCIAS ninguna',
      'EVENTOS\n' + (eventLines.join('\n') || 'ninguno'),
      'UNIDADES_MOVIMIENTO_POR_MOVIMIENTO\n' + units.map(unitLine).join('\n'),
    ].join('\n\n');
  }

  function modeInstruction(mode) {
    if (mode === 'remaining') return 'Organiza únicamente lo que queda de HOY desde la hora actual. Ten en cuenta todo lo ya estudiado hoy y no reinicies el día.';
    if (mode === 'now') return 'Dime qué debería estudiar AHORA MISMO. Da una decisión principal, duración y un plan B corto.';
    if (mode === 'week') return 'Haz balance de los próximos 7 días y propón una distribución estratégica por movimientos.';
    return 'Organiza el día de hoy de forma realista, movimiento por movimiento, usando toda la información disponible.';
  }

  function buildPrompt(report, options) {
    const opts = options || {};
    const master = String(opts.masterPrompt || DEFAULT_MASTER_PROMPT).trim();
    const note = String(opts.note || '').trim();
    return `${master}\n\nTAREA DE ESTE TURNO\n${modeInstruction(opts.mode || 'today')}${note ? `\nCondición/mensaje adicional del usuario: ${note}` : ''}\n\n${compactContext(report)}\n\nAntes de recomendar, comprueba explícitamente: (1) lo estudiado hoy, (2) próximos eventos realmente enlazados, (3) cada movimiento por separado, (4) riesgo de enfriamiento, (5) saturación reciente y (6) recuperación estimada. No digas que una obra está sobreestudiada solo porque otro movimiento suyo tenga muchas horas.`;
  }

  function buildChatGptUrl(report, options) {
    const fullPrompt = buildPrompt(report, options);
    let promptForUrl = fullPrompt;
    let encoded = encodeURIComponent(promptForUrl);
    let truncated = false;
    return { url: `https://chatgpt.com/?prompt=${encoded}`, fullPrompt, promptForUrl, truncated };
  }

  return { planningWeight, collectPractice, DEFAULT_MASTER_PROMPT, buildReport, buildPrompt, buildChatGptUrl, compactContext, unitLine, normalizeEvents };
});
