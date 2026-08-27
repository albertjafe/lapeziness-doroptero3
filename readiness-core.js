(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReadinessCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DAY = 24 * 60 * 60 * 1000;
  const BANDS = [[0, 39], [40, 59], [60, 69], [70, 79]];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const dateOf = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const dateKey = (date) => date ? date.toISOString().slice(0, 10) : '';
  const idOf = (value) => value == null ? '' : String(value);
  const bandOf = (score) => {
    const index = BANDS.findIndex(([lo, hi]) => score >= lo && score <= hi);
    return index >= 0 ? index : BANDS.length - 1;
  };
  const normalizedScore = (value) => {
    const score = Number(value);
    if (!Number.isFinite(score)) return null;
    return clamp(score <= 10 ? score * 10 : score, 0, 100);
  };
  const scoreOf = (item) => {
    if (!item) return null;
    return normalizedScore(item.solidezPct ?? item.sol ?? item.val ?? item.solRating ?? item.score ?? item.obraScore);
  };
  const obraIdOf = (item) => item && (item.obraId ?? item.workId ?? item.obra_id ?? item.reactivatedObraId);
  const movementIdOf = (item) => item && (item.movId ?? item.movimientoId ?? item.movementId ?? item.mov_id);
  const scopeOf = (item) => {
    if (movementIdOf(item) != null) return 'movement';
    const zone = item && (item.zona ?? item.zone);
    if (zone == null || zone === '') return 'whole';
    return /obra|completa|complete|full/i.test(String(zone)) ? 'whole' : 'passage';
  };
  const timestampOf = (item, parent) => dateOf(
    item && (item.endedAt || item.completedDate || item.startedAt || item.at || item.date || item.fecha)
    || parent && (parent.endedAt || parent.completedDate || parent.startedAt || parent.date || parent.fecha || parent.at)
  );
  const sameCheckpointTarget = (a, b) => a.scope === b.scope && idOf(a.movementId) === idOf(b.movementId);
  const activity = (obra) => {
    if (!obra) return true;
    const text = [obra.tipo, obra.type, obra.category, obra.origen].filter(Boolean).join(' ').toLowerCase();
    return obra.actividad === true || obra.isActivity === true || /actividad|exercise|ejercicio|escala|técnica|tecnica/.test(text);
  };

  function realMinutes(item) {
    if (!item || item.estudiado === false) return 0;
    const value = item.minutosReales ?? item.minutosEstudiados;
    return Math.max(0, num(value));
  }

  function passEntries(entity, movementId) {
    return (entity.paseHistory || []).map((pass, index) => ({
      kind: 'pass', score: scoreOf(pass), date: timestampOf(pass), movementId: movementId ?? movementIdOf(pass), scope: movementId == null ? scopeOf(pass) : 'movement',
      weight: /concierto|concurso|audici[oó]n|escena|formal/i.test(String(pass.tipo || pass.context || '')) ? 1.35 : 1.15,
      id: idOf(pass.id || pass.paseId || pass.eventId || pass.uid), source: pass,
      index,
    })).filter(item => item.score != null);
  }

  function solHistoryEntries(entity, movementId) {
    return (entity.solHistory || []).map((point, index) => ({
      kind: 'solHistory', score: scoreOf(point), date: timestampOf(point), movementId: movementId ?? movementIdOf(point), scope: movementId == null ? scopeOf(point) : 'movement',
      weight: 1, id: idOf(point.id || point.paseId || point.eventId || point.uid), source: point, index,
    })).filter(item => item.score != null);
  }

  function eventEntries(db, obraId) {
    const result = [];
    (db.eventos || []).forEach((event, eventIndex) => {
      const resultItems = event && event.resultado && (event.resultado.obrasResultados || event.resultado.works || []);
      (Array.isArray(resultItems) ? resultItems : []).forEach((item, index) => {
        const id = obraIdOf(item) ?? item.id ?? item.obra;
        if (id == null || idOf(id) !== idOf(obraId)) return;
        const score = scoreOf(item);
        if (score == null) return;
        result.push({ kind: 'event', score, date: timestampOf(item, event), movementId: movementIdOf(item), scope: scopeOf(item),
          weight: 1.45, id: idOf(item.id || event.id || event.eventId), source: item, eventIndex, index });
      });
    });
    return result;
  }

  function collectTimeline(db, obraId) {
    const obra = (db.obras || []).find(item => idOf(item && item.id) === idOf(obraId));
    if (!obra || activity(obra)) return null;
    const practice = [], checkpoints = [];
    const plants = [...(db.sessionPlants || []), ...(db.forestPlants || [])].filter(plant =>
      idOf(obraIdOf(plant)) === idOf(obraId) && plant.tipo !== 'descanso' && num(plant.mins ?? plant.min ?? plant.minutes) > 0
    ).map(plant => ({
      minutes: Math.max(0, num(plant.mins ?? plant.min ?? plant.minutes)), date: timestampOf(plant), movementId: movementIdOf(plant),
      source: plant, session: null, sessionId: idOf(plant.id || plant.runId), kind: 'plant',
    }));
    const plantBudgets = new Map();
    plants.forEach(plant => {
      if (!plant.date) return;
      const key = dateKey(plant.date) + ':' + idOf(plant.movementId);
      plantBudgets.set(key, (plantBudgets.get(key) || 0) + plant.minutes);
    });
    (db.sesiones || []).forEach(session => (session.items || []).forEach((item, index) => {
      if (idOf(obraIdOf(item)) !== idOf(obraId) || item.estudiado === false) return;
      const date = timestampOf(item, session);
      const minutes = realMinutes(item);
      const movementId = movementIdOf(item);
      const plantKey = date ? dateKey(date) + ':' + idOf(movementId) : '';
      const plantMinutes = plantKey ? plantBudgets.get(plantKey) || 0 : 0;
      const coveredMinutes = Math.min(minutes, plantMinutes);
      const residualMinutes = minutes - coveredMinutes;
      if (plantKey && coveredMinutes > 0) plantBudgets.set(plantKey, plantMinutes - coveredMinutes);
      if (residualMinutes > 0) {
        practice.push({ minutes: residualMinutes, date, movementId, source: item, session, sessionId: idOf(session.id || session.sessionId || session.uid || dateKey(date)), kind: 'session' });
      }
      const score = scoreOf({ solRating: item.solRating });
      const checkpointBaseId = item.id || item.itemId || session.id || session.sessionId || session.uid;
      if (score != null) checkpoints.push({ kind: 'session', score, date, movementId: movementIdOf(item), scope: scopeOf(item), weight: 0.75, id: checkpointBaseId ? idOf(checkpointBaseId) + ':' + index : '', source: item });
    }));
    plants.forEach(plant => practice.push(plant));
    passEntries(obra).forEach(item => checkpoints.push(item));
    solHistoryEntries(obra).forEach(item => checkpoints.push(item));
    (obra.movimientos || []).forEach(movement => {
      passEntries(movement, movement.id).forEach(item => checkpoints.push(item));
      solHistoryEntries(movement, movement.id).forEach(item => checkpoints.push(item));
    });
    practice.sort((a, b) => (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0));
    eventEntries(db, obraId).forEach(item => checkpoints.push(item));
    checkpoints.sort((a, b) => (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0));
    const unique = [];
    checkpoints.forEach(point => {
      const duplicate = unique.find(previous => {
        const sameId = point.id && previous.id && point.id === previous.id;
        const closeDate = point.date && previous.date && Math.abs(point.date - previous.date) <= DAY;
        const sameScore = Math.abs(point.score - previous.score) <= 1;
        const sameTarget = idOf(point.movementId) === idOf(previous.movementId) && point.scope === previous.scope;
        const mirroredKinds = point.kind !== previous.kind && [point.kind, previous.kind].every(kind => ['pass', 'solHistory', 'session', 'event'].includes(kind));
        return (sameId && sameTarget) || (sameTarget && mirroredKinds && closeDate && sameScore);
      });
      if (!duplicate) unique.push(point);
      else if (point.weight > duplicate.weight) Object.assign(duplicate, point);
    });
    return { obra, practice, checkpoints: unique, allCheckpoints: checkpoints };
  }

  function coverageFor(obra, checkpoints) {
    const totalBars = num(obra.compasesTotal);
    const currentBars = num(obra.compasActual ?? obra.compasesActual);
    const wholeCheckpoints = checkpoints.filter(point => point.scope !== 'passage' && point.scope !== 'movement');
    let coverage = totalBars > 0 ? clamp(currentBars / totalBars, 0, 1) : null;
    const movements = Array.isArray(obra.movimientos) ? obra.movimientos : [];
    if (movements.length) {
      const values = movements.map(movement => {
        const total = num(movement.compasesTotal || movement.totalBars || movement.bars);
        const current = num(movement.compasActual ?? movement.compasesActual ?? movement.currentBar);
        if (total > 0) return clamp(current / total, 0, 1);
        const state = String(movement.learningStage || movement.stage || movement.estado || '').toLowerCase();
        if (/aprend|dominad|list|ready|solido|sólido/.test(state)) return 1;
        if (/inici|nuevo|sin/.test(state)) return 0.15;
        const scores = checkpoints.filter(p => idOf(p.movementId) === idOf(movement.id)).map(p => p.score);
        return scores.length ? clamp(Math.max(...scores) / 100, 0, 1) : 0;
      });
      const weights = movements.map(m => Math.max(0.1, num(m.duracion || m.duration || m.weight, 1)));
      const weighted = values.reduce((sum, value, i) => sum + value * weights[i], 0) / weights.reduce((sum, value) => sum + value, 0);
      coverage = coverage == null ? weighted : Math.min(coverage, weighted);
    }
    if (coverage == null) coverage = wholeCheckpoints.length ? 1 : 0.35;
    return clamp(coverage, 0, 1);
  }

  function movementScores(obra, checkpoints) {
    const movements = Array.isArray(obra.movimientos) ? obra.movimientos : [];
    return movements.map(movement => {
      const points = checkpoints.filter(point => idOf(point.movementId) === idOf(movement.id));
      const score = points.length ? points[points.length - 1].score : scoreOf(movement) ?? 0;
      const explicitCoverage = num(movement.compasesTotal || movement.compasTotal || movement.totalBars || movement.bars) > 0
        ? clamp(num(movement.compasActual ?? movement.compasesActual ?? movement.currentBar) / num(movement.compasesTotal || movement.compasTotal || movement.totalBars || movement.bars), 0, 1)
        : null;
      return { id: movement.id, score: clamp(score, 0, 100), coverage: explicitCoverage == null ? (points.length ? 1 : 0) : explicitCoverage };
    });
  }

  function retention(db, targetTimeline, asOf) {
    const timelines = (db.obras || []).map(obra => collectTimeline(db, obra.id)).filter(Boolean);
    const pairs = [];
    timelines.forEach(timeline => {
      const points = timeline.checkpoints;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (!a.date || !b.date || !sameCheckpointTarget(a, b)) continue;
        const gap = (b.date - a.date) / DAY;
        if (gap >= 7 && gap <= 120) pairs.push({ gap, delta: b.score - a.score, same: timeline.obra.id === targetTimeline.obra.id });
      }
    });
    const same = pairs.filter(pair => pair.same);
    const source = same.length >= 2 ? same : pairs;
    const retentionRate = source.length ? source.reduce((sum, pair) => sum + clamp((pair.delta + 20) / 40, 0, 1), 0) / source.length : 0.55;
    const recent = targetTimeline.checkpoints[targetTimeline.checkpoints.length - 1];
    const daysSince = recent && recent.date && asOf ? (asOf.getTime() - recent.date.getTime()) / DAY : 0;
    const longGap = Math.max(0, daysSince - 7);
    const penalty = longGap > 0 && !same.length ? Math.min(10, longGap / 7 * (1 - retentionRate) * 3) : 0;
    return { retentionRate, penalty, pairs: source.length, daysSince: Math.max(0, daysSince) };
  }

  function samplesFor(db, targetTimeline) {
    const samples = [];
    (db.obras || []).forEach(obra => {
      const timeline = collectTimeline(db, obra.id);
      if (!timeline) return;
      for (let i = 1; i < timeline.checkpoints.length; i++) {
        const from = timeline.checkpoints[i - 1], to = timeline.checkpoints[i];
        if (!from.date || !to.date || to.score <= from.score || !sameCheckpointTarget(from, to)) continue;
        const minutes = timeline.practice.filter(item => item.date && item.date > from.date && item.date <= to.date).reduce((sum, item) => sum + item.minutes, 0);
        if (minutes < 5 || minutes > 20000) continue;
        const points = to.score - from.score;
        samples.push({ band: bandOf(from.score), minutesPerPoint: minutes / points, same: timeline.obra.id === targetTimeline.obra.id });
      }
    });
    return samples;
  }

  function median(values) {
    if (!values.length) return 25;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function speedFor(db, timeline, band) {
    const samples = samplesFor(db, timeline);
    const global = samples.filter(sample => sample.band === band).map(sample => sample.minutesPerPoint);
    const own = samples.filter(sample => sample.same && sample.band === band).map(sample => sample.minutesPerPoint);
    const fallback = [18, 22, 28, 36][band] || 30;
    const globalValue = clamp(median(global.length ? global : [fallback]), 5, 240);
    if (own.length < 3) return { value: globalValue, ownIntervals: own.length, source: global.length ? 'global' : 'fallback' };
    const ownValue = clamp(median(own), 5, 240);
    return { value: ownValue * 0.7 + globalValue * 0.3, ownIntervals: own.length, source: 'obra+global' };
  }

  function familiarity(obra, db, asOf) {
    let hours = Math.max(0, num(obra.minutosExtra) / 60);
    let historical = false;
    const sourceId = obra.historicalSourceId;
    const source = (db.historicalRepertoire || []).find(item => idOf(item.id) === idOf(sourceId) || idOf(item.reactivatedObraId) === idOf(obra.id));
    let peakLevel = 0;
    let ageYears = 0;
    if (source) {
      hours += Math.min(30, Math.max(0, num(source.estimatedHours ?? source.estimatedHistoricalHours)));
      const peakLevels = { lectura: 30, estudiada: 55, solida: 80, publico: 90, concurso: 95 };
      peakLevel = clamp(num(source.peakLevel, peakLevels[String(source.peakLevel || '').toLowerCase()] || 0), 0, 100);
      const year = num(source.lastPlayedYear);
      ageYears = year > 1900 ? Math.max(0, (asOf || new Date()).getFullYear() - year) : 0;
      historical = true;
    }
    const recoveryBoost = peakLevel >= 80 ? 0.08 : peakLevel >= 60 ? 0.04 : 0;
    const ageFactor = historical && ageYears ? clamp(1 - ageYears / 20, 0.25, 1) : 1;
    const prior = clamp(Math.log1p(hours) / 5 * ageFactor + recoveryBoost, 0, 0.55);
    const recovery = obra.origen === 'recuperacion' || /recuper/i.test(String(obra.learningStage || ''));
    return { prior, recovery, historical, hours, peakLevel, ageYears };
  }

  function estimateReadiness(db, obraId, options) {
    const data = db || {};
    const timeline = collectTimeline(data, obraId);
    if (!timeline) return null;
    const observedDates = timeline.practice.concat(timeline.checkpoints).map(item => item.date).filter(Boolean);
    const latestObserved = observedDates.length ? new Date(Math.max(...observedDates.map(date => date.getTime()))) : null;
    const asOf = dateOf(options && (options.asOf || options.now)) || latestObserved;
    const { obra, checkpoints } = timeline;
    const targetScore = num(options && options.targetScore, 80);
    const coverage = coverageFor(obra, checkpoints);
    const movements = movementScores(obra, checkpoints);
    const wholeCheckpoints = checkpoints.filter(point => point.scope !== 'passage' && point.scope !== 'movement');
    const latest = wholeCheckpoints.length ? wholeCheckpoints[wholeCheckpoints.length - 1].score : (normalizedScore(obra.sol) ?? 0);
    const weightedLatest = wholeCheckpoints.length ? wholeCheckpoints.reduce((sum, point) => sum + point.score * point.weight, 0) / wholeCheckpoints.reduce((sum, point) => sum + point.weight, 0) : latest;
    const retentionInfo = retention(data, timeline, asOf);
    const effectiveScore = clamp(Math.min(latest, weightedLatest + 2) - retentionInfo.penalty, 0, 100);
    const movementWeak = movements.some(movement => movement.coverage < 1 && movement.score < targetScore) || (movements.length && Math.min(...movements.map(m => m.score)) < targetScore - 8);
    const distinctHighDates = new Set(wholeCheckpoints.filter(p => p.score >= targetScore && p.date).map(p => dateKey(p.date))).size;
    const formalHigh = wholeCheckpoints.some(p => p.kind === 'event' && p.score >= targetScore);
    const stable = formalHigh || distinctHighDates >= 2 || wholeCheckpoints.some((point, i) => point.score >= targetScore && wholeCheckpoints.slice(i + 1).some(next => next.date && point.date && (next.date - point.date) >= 5 * DAY && next.score >= targetScore - 5));
    const familiarityInfo = familiarity(obra, data, asOf);
    const baseline = clamp(effectiveScore * 0.92, 0, targetScore);
    let remainingPoints = Math.max(0, targetScore - baseline);
    if (effectiveScore >= targetScore && !stable) remainingPoints = 3;
    if (movementWeak) remainingPoints += Math.max(3, targetScore - Math.min(...movements.map(m => m.score)));
    remainingPoints *= 1 - familiarityInfo.prior * (familiarityInfo.recovery ? 0.55 : 0.35);
    remainingPoints *= 1 + (1 - coverage) * 0.65;
    const band = bandOf(effectiveScore);
    const speed = speedFor(data, timeline, band);
    let pointEstimateMinutes = Math.max(0, remainingPoints * speed.value);
    const isReady = Boolean(stable && !movementWeak && coverage >= 0.8 && effectiveScore >= targetScore);
    if (isReady) pointEstimateMinutes = 0;
    const evidenceCount = checkpoints.length;
    const volatility = checkpoints.length > 1 ? Math.max(...checkpoints.map(p => p.score)) - Math.min(...checkpoints.map(p => p.score)) : 0;
    let confidence = 'low';
    if (evidenceCount >= 4 && (speed.ownIntervals >= 3 || formalHigh) && coverage >= 0.85 && volatility < 25) confidence = 'high';
    else if (evidenceCount >= 2 && coverage >= 0.65) confidence = 'medium';
    if (familiarityInfo.historical && speed.ownIntervals < 2) confidence = 'low';
    if (retentionInfo.daysSince >= 30 && retentionInfo.pairs === 0) confidence = 'low';
    if (movementWeak) confidence = confidence === 'high' ? 'medium' : 'low';
    const spread = confidence === 'high' ? 0.35 : confidence === 'medium' ? 0.65 : 1.05;
    const uncertainty = 1 + volatility / 100 + (1 - coverage) * 0.7 + (retentionInfo.daysSince >= 14 && retentionInfo.pairs === 0 ? 0.35 : 0);
    const lowMinutes = Math.max(0, pointEstimateMinutes * Math.max(0.25, 1 - spread));
    const highMinutes = Math.max(pointEstimateMinutes, pointEstimateMinutes * (1 + spread * uncertainty));
    const recentMinutes = timeline.practice.filter(item => item.date && asOf && asOf.getTime() - item.date.getTime() >= 0 && asOf.getTime() - item.date.getTime() <= 28 * DAY).reduce((sum, item) => sum + item.minutes, 0);
    const calendarEstimate = recentMinutes >= 60 && pointEstimateMinutes > 0 ? { lowDays: Math.max(1, Math.ceil(lowMinutes / (recentMinutes / 28))), highDays: Math.max(1, Math.ceil(highMinutes / (recentMinutes / 28))) } : undefined;
    const factors = [];
    if (!checkpoints.length) factors.push('estimación inicial');
    if (familiarityInfo.recovery) factors.push('obra recuperada');
    if (movementWeak) factors.push('cuello de botella en movimientos');
    if (retentionInfo.pairs) factors.push('retención tras descansos');
    if (formalHigh) factors.push('resultado formal');
    return {
      targetScore, rawScore: latest, effectiveScore, coverage,
      pointEstimateMinutes: Math.round(pointEstimateMinutes), lowMinutes: Math.round(lowMinutes), highMinutes: Math.round(highMinutes),
      confidence, isReady, evidenceCount,
      calendarEstimate, factors,
      diagnostics: { timeline, realMinutes: timeline.practice.reduce((sum, item) => sum + item.minutes, 0), timestampedMinutes: timeline.practice.filter(item => item.date).reduce((sum, item) => sum + item.minutes, 0), speed, retention: retentionInfo, familiarity: familiarityInfo, stable, movementWeak, volatility, distinctHighDates, deduplicatedEvidence: timeline.allCheckpoints.length - checkpoints.length },
    };
  }

  return { estimateReadiness, collectTimeline, realMinutes };
});
