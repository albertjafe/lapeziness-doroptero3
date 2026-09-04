(function () {
  'use strict';

  const core = window.ReadinessCore;
  const model = window.SolidityModel;
  if (!core || !model || typeof core.collectTimeline !== 'function' || typeof core.estimateReadiness !== 'function') return;
  if (core.estimateReadiness.__singlePillModel) return;

  const originalEstimate = core.estimateReadiness.bind(core);
  const DAY = 86400000;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const idOf = value => value == null ? '' : String(value);
  const dateOf = value => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const dateKey = date => date ? date.toISOString().slice(0, 10) : '';

  function pointScore(point) {
    const fromSource = model.scoreFromObservation(point && point.source);
    if (fromSource != null) return fromSource;
    return model.percent(point && point.score);
  }

  function normalizedTimeline(db, obraId) {
    const raw = core.collectTimeline(db, obraId);
    if (!raw) return null;
    const checkpoints = (raw.checkpoints || []).map(point => ({ ...point, score: pointScore(point) })).filter(point => point.score != null);
    checkpoints.sort((a, b) => ((a.date && a.date.getTime()) || 0) - ((b.date && b.date.getTime()) || 0));
    return { ...raw, checkpoints };
  }

  function wholePoints(timeline) {
    return (timeline.checkpoints || []).filter(point => point.scope !== 'passage' && point.scope !== 'movement');
  }

  function currentWholeScore(work, timeline) {
    const points = wholePoints(timeline);
    if (points.length) return Math.round(points[points.length - 1].score);
    return model.currentScore(work) ?? model.percent(work && work.sol) ?? 0;
  }

  function movementState(work, timeline) {
    const movements = Array.isArray(work && work.movimientos) ? work.movimientos : [];
    return movements.map(movement => {
      const points = (timeline.checkpoints || []).filter(point => idOf(point.movementId) === idOf(movement.id));
      const score = points.length ? points[points.length - 1].score : (model.currentScore(movement) ?? model.percent(movement.sol) ?? 0);
      const total = num(movement.compasesTotal || movement.compasTotal || movement.totalBars || movement.bars);
      const current = num(movement.compasActual ?? movement.compasesActual ?? movement.currentBar);
      const explicitCoverage = total > 0 ? clamp(current / total, 0, 1) : null;
      const hasHistory = (Array.isArray(movement.solHistory) && movement.solHistory.length > 0) ||
        (Array.isArray(movement.paseHistory) && movement.paseHistory.length > 0);
      const currentSignal = Number(movement.sol);
      const measured = points.length > 0 || hasHistory || explicitCoverage != null || (Number.isFinite(currentSignal) && currentSignal > 1);
      return {
        id: movement.id,
        score: clamp(score, 0, 100),
        coverage: explicitCoverage == null ? model.inferredCoverage(score) : explicitCoverage,
        measured,
      };
    });
  }

  function coverageFor(work, currentScore, movements) {
    const total = num(work && (work.compasesTotal || work.compasTotal || work.totalBars || work.bars));
    const current = num(work && (work.compasActual ?? work.compasesActual ?? work.currentBar));
    const explicit = total > 0 ? clamp(current / total, 0, 1) : null;
    const measuredMovements = movements.filter(movement => movement.measured);
    if (measuredMovements.length) {
      const sourceMovements = Array.isArray(work.movimientos) ? work.movimientos : [];
      const weightFor = movement => {
        const source = sourceMovements.find(item => idOf(item.id) === idOf(movement.id));
        return Math.max(.1, num(source && (source.duracion || source.duration), 1));
      };
      const weighted = measuredMovements.reduce((sum, movement) => sum + movement.coverage * weightFor(movement), 0) /
        Math.max(.1, measuredMovements.reduce((sum, movement) => sum + weightFor(movement), 0));
      return explicit == null ? clamp(weighted, 0, 1) : Math.min(explicit, weighted);
    }
    return explicit == null ? model.inferredCoverage(currentScore) : explicit;
  }

  function practiceMinutesBetween(timeline, fromTime, toTime, targetKey) {
    const movementId = targetKey && targetKey.startsWith('movement:') ? targetKey.slice('movement:'.length) : null;
    return (timeline.practice || []).filter(item => {
      if (!item.date) return false;
      const time = item.date.getTime();
      if (time <= fromTime || time > toTime) return false;
      if (movementId != null && movementId !== '') return idOf(item.movementId) === idOf(movementId);
      // Para la píldora de la obra completa cuenta todo el trabajo hecho en
      // ella, también cuando la sesión estaba asignada a un movimiento.
      return true;
    }).reduce((sum, item) => sum + Math.max(0, num(item.minutes)), 0);
  }

  function bandOf(score) {
    if (score < 40) return 0;
    if (score < 60) return 1;
    if (score < 70) return 2;
    return 3;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function plateauSamples(db, targetId) {
    const samples = [];
    (db.obras || []).forEach(work => {
      if (!work || work.tipo === 'actividad') return;
      const timeline = normalizedTimeline(db, work.id);
      if (!timeline) return;
      const groups = model.plateauGroups((timeline.checkpoints || []).map(point => ({
        ...point,
        time: point.date && point.date.getTime(),
        raw: point.source,
      })), 3);
      const byKey = new Map();
      groups.forEach(group => {
        if (!byKey.has(group.key)) byKey.set(group.key, []);
        byKey.get(group.key).push(group);
      });
      byKey.forEach((list, key) => {
        list.sort((a, b) => a.startTime - b.startTime);
        for (let index = 1; index < list.length; index += 1) {
          const from = list[index - 1];
          const to = list[index];
          const delta = to.startScore - from.startScore;
          if (delta <= 3) continue;
          const minutes = practiceMinutesBetween(timeline, from.startTime, to.startTime, key);
          if (minutes < 5 || minutes > 30000) continue;
          samples.push({
            band: bandOf(from.startScore),
            minutesPerPoint: minutes / delta,
            same: idOf(work.id) === idOf(targetId),
            fromScore: from.startScore,
            toScore: to.startScore,
            minutes,
            plateauDays: Math.max(0, (to.startTime - from.startTime) / DAY),
          });
        }
      });
    });
    return samples;
  }

  function speedFor(db, targetId, band) {
    const samples = plateauSamples(db, targetId);
    const global = samples.filter(sample => sample.band === band).map(sample => sample.minutesPerPoint);
    const own = samples.filter(sample => sample.same && sample.band === band).map(sample => sample.minutesPerPoint);
    const fallback = [18, 22, 28, 36][band] || 30;
    const globalValue = clamp(median(global) ?? fallback, 5, 240);
    if (own.length < 2) {
      return { value: globalValue, ownIntervals: own.length, source: global.length ? 'global-plateau' : 'fallback', samples };
    }
    const ownValue = clamp(median(own), 5, 240);
    return { value: ownValue * .72 + globalValue * .28, ownIntervals: own.length, source: 'obra+plateau', samples };
  }

  function historicalPrior(db, work, asOf) {
    const archive = Array.isArray(db.historicalRepertoire) ? db.historicalRepertoire : [];
    const source = archive.find(item => idOf(item.id) === idOf(work.historicalSourceId) || idOf(item.reactivatedObraId) === idOf(work.id));
    if (!source) return { prior: 0, recovery: false, historical: false, hours: 0, peakLevel: 0, ageYears: 0 };
    const map = { lectura: 30, estudiada: 55, solida: 80, sólida: 80, publico: 90, público: 90, concurso: 95 };
    const peakRaw = source.peakLevel;
    const peakLevel = clamp(Number.isFinite(Number(peakRaw)) ? Number(peakRaw) : (map[String(peakRaw || '').toLowerCase()] || 0), 0, 100);
    const hours = Math.min(40, Math.max(0, num(source.estimatedHours ?? source.estimatedHistoricalHours)));
    const year = num(source.lastPlayedYear);
    const ageYears = year > 1900 ? Math.max(0, (asOf || new Date()).getFullYear() - year) : 0;
    const ageFactor = ageYears ? clamp(1 - ageYears / 20, .25, 1) : 1;
    const peakBoost = peakLevel >= 90 ? .12 : peakLevel >= 80 ? .08 : peakLevel >= 60 ? .04 : 0;
    const prior = clamp(Math.log1p(hours) / 5 * ageFactor + peakBoost, 0, .58);
    return { prior, recovery: true, historical: true, hours, peakLevel, ageYears };
  }

  function latestObservedDate(timeline) {
    const dates = (timeline.practice || []).concat(timeline.checkpoints || []).map(item => item.date).filter(Boolean);
    return dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : null;
  }

  function estimateReadiness(db, obraId, options) {
    const data = db || {};
    const timeline = normalizedTimeline(data, obraId);
    if (!timeline) return null;
    const work = timeline.obra;
    if (!work || work.tipo === 'actividad') return null;

    const base = originalEstimate(data, obraId, options) || {};
    const asOf = dateOf(options && (options.asOf || options.now)) || latestObservedDate(timeline) || new Date();
    const targetScore = num(options && options.targetScore, 80);
    const currentScore = currentWholeScore(work, timeline);
    const movements = movementState(work, timeline);
    const measuredMovements = movements.filter(movement => movement.measured);
    const coverage = coverageFor(work, currentScore, movements);
    const points = wholePoints(timeline);
    const distinctHighDates = new Set(points.filter(point => point.score >= targetScore && point.date).map(point => dateKey(point.date))).size;
    const formalHigh = points.some(point => point.kind === 'event' && point.score >= targetScore);
    const stable = formalHigh || distinctHighDates >= 2 || points.some((point, index) =>
      point.score >= targetScore && points.slice(index + 1).some(next => next.date && point.date && (next.date - point.date) >= 5 * DAY && next.score >= targetScore - 5)
    );
    const movementWeak = measuredMovements.some(movement => movement.coverage < .9 || movement.score < targetScore - 8);
    const weakestMovement = measuredMovements.length ? Math.min(...measuredMovements.map(movement => movement.score)) : null;

    // La píldora es la verdad presente. Ni el histórico ni el tiempo transcurrido
    // modifican este número. Esos datos solo cambian cuánto creemos que costará
    // recuperar o consolidar lo que falta.
    let remainingPoints = Math.max(0, targetScore - currentScore);
    if (currentScore >= targetScore && !stable) remainingPoints = Math.max(remainingPoints, 3);
    if (movementWeak && weakestMovement != null) remainingPoints += Math.max(3, targetScore - weakestMovement) * .72;

    const familiarity = historicalPrior(data, work, asOf);
    if (familiarity.recovery) remainingPoints *= 1 - familiarity.prior * .55;
    remainingPoints *= 1 + (1 - coverage) * .55;

    const band = bandOf(Math.min(currentScore, targetScore - 1));
    const speed = speedFor(data, obraId, band);
    let pointEstimateMinutes = Math.max(0, remainingPoints * speed.value);
    const isReady = Boolean(stable && !movementWeak && coverage >= .8 && currentScore >= targetScore);
    if (isReady) pointEstimateMinutes = 0;

    const evidenceCount = timeline.checkpoints.length;
    const scores = timeline.checkpoints.map(point => point.score);
    const volatility = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
    const currentObservation = model.currentObservation(work);
    const daysSince = currentObservation && currentObservation.time != null ? Math.max(0, (asOf.getTime() - currentObservation.time) / DAY) : 0;
    let confidence = 'low';
    if (evidenceCount >= 5 && speed.ownIntervals >= 2 && coverage >= .85 && volatility < 30) confidence = 'high';
    else if (evidenceCount >= 2 && coverage >= .6) confidence = 'medium';
    if (daysSince >= 30 || movementWeak) confidence = confidence === 'high' ? 'medium' : 'low';
    if (familiarity.historical && speed.ownIntervals < 2) confidence = 'low';

    const spread = confidence === 'high' ? .35 : confidence === 'medium' ? .65 : 1.05;
    const stalenessUncertainty = daysSince >= 30 ? .3 : daysSince >= 14 ? .15 : 0;
    const uncertainty = 1 + volatility / 100 + (1 - coverage) * .65 + stalenessUncertainty;
    const lowMinutes = Math.max(0, pointEstimateMinutes * Math.max(.25, 1 - spread));
    const highMinutes = Math.max(pointEstimateMinutes, pointEstimateMinutes * (1 + spread * uncertainty));
    const recentMinutes = (timeline.practice || []).filter(item => item.date && asOf.getTime() - item.date.getTime() >= 0 && asOf.getTime() - item.date.getTime() <= 28 * DAY)
      .reduce((sum, item) => sum + Math.max(0, num(item.minutes)), 0);
    const calendarEstimate = recentMinutes >= 60 && pointEstimateMinutes > 0
      ? { lowDays: Math.max(1, Math.ceil(lowMinutes / (recentMinutes / 28))), highDays: Math.max(1, Math.ceil(highMinutes / (recentMinutes / 28))) }
      : undefined;

    const factors = [];
    if (!evidenceCount) factors.push('estimación inicial');
    if (familiarity.recovery) factors.push('recuperación más rápida por dominio previo');
    if (movementWeak) factors.push('cuello de botella en movimientos');
    if (formalHigh) factors.push('resultado formal');
    if (speed.samples.some(sample => sample.same && sample.plateauDays >= 7)) factors.push('progreso medido a través de mesetas');

    return {
      ...base,
      targetScore,
      rawScore: currentScore,
      effectiveScore: currentScore,
      coverage,
      pointEstimateMinutes: Math.round(pointEstimateMinutes),
      lowMinutes: Math.round(lowMinutes),
      highMinutes: Math.round(highMinutes),
      confidence,
      isReady,
      evidenceCount,
      calendarEstimate,
      factors,
      diagnostics: {
        ...(base.diagnostics || {}),
        timeline,
        realMinutes: (timeline.practice || []).reduce((sum, item) => sum + Math.max(0, num(item.minutes)), 0),
        timestampedMinutes: (timeline.practice || []).filter(item => item.date).reduce((sum, item) => sum + Math.max(0, num(item.minutes)), 0),
        speed,
        retention: { ...(base.diagnostics && base.diagnostics.retention || {}), pillPenalty: 0, daysSince },
        familiarity,
        stable,
        movementWeak,
        measuredMovements: measuredMovements.length,
        volatility,
        distinctHighDates,
        singlePillModel: true,
        currentLabel: model.label(currentScore),
      },
    };
  }

  estimateReadiness.__singlePillModel = true;
  estimateReadiness.__original = originalEstimate;
  core.estimateReadiness = estimateReadiness;

  // Re-render the surfaces that may have calculated readiness just before this
  // lightweight patch finished loading. All calls after this point use the new model.
  setTimeout(() => {
    try { if (typeof window.renderObras === 'function') window.renderObras(); } catch (error) {}
    try { if (typeof window.cronoRenderReadinessEstimate === 'function') window.cronoRenderReadinessEstimate(); } catch (error) {}
    try { window.dispatchEvent(new CustomEvent('solidity-model-ready')); } catch (error) {}
  }, 0);
})();
