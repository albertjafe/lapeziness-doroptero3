(function () {
  'use strict';

  const core = window.ReadinessCore;
  const model = window.SolidityModel;
  if (!core || !model || typeof core.estimateReadiness !== 'function' || typeof model.currentWorkScore !== 'function') return;
  if (core.estimateReadiness.__recoveryContextModel) return;

  const previousEstimate = core.estimateReadiness.bind(core);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  function measuredMovementScores(work) {
    return (Array.isArray(work && work.movimientos) ? work.movimientos : []).map(movement => {
      const observation = typeof model.measuredObservation === 'function' ? model.measuredObservation(movement) : model.currentObservation(movement);
      return observation && observation.score != null ? Number(observation.score) : null;
    }).filter(Number.isFinite);
  }

  function recoveryPrior(baseFamiliarity, context) {
    let prior = clamp(num(baseFamiliarity && baseFamiliarity.prior), 0, .65);
    if (!context || !context.priorMastery) return prior;
    if (context.originRecovery) prior = Math.max(prior, .22);
    if (context.archived) prior = Math.max(prior, .25);
    if (context.formalEvent) prior = Math.max(prior, .32);
    if (context.previousPeak >= 90) prior = Math.max(prior, .34);
    else if (context.previousPeak >= 80) prior = Math.max(prior, .28);
    else if (context.previousPeak >= 60) prior = Math.max(prior, .20);
    return clamp(prior, 0, .65);
  }

  function estimateReadiness(db, obraId, options) {
    const data = db || {};
    const result = previousEstimate(data, obraId, options);
    if (!result) return result;
    const work = (data.obras || []).find(item => String(item && item.id) === String(obraId));
    if (!work || work.tipo === 'actividad') return result;

    const derivedScore = model.currentWorkScore(work);
    if (derivedScore == null) return result;

    const targetScore = num(result.targetScore, 80);
    const diagnostics = result.diagnostics || {};
    const context = typeof model.historyContext === 'function' ? model.historyContext(data, work) : { priorMastery: false };
    const movementScores = measuredMovementScores(work);
    const weakestMovement = movementScores.length ? Math.min(...movementScores) : null;
    const movementWeak = movementScores.some(score => score < targetScore - 8) || Boolean(diagnostics.movementWeak);
    const stable = Boolean(diagnostics.stable);
    const coverage = clamp(num(result.coverage, 0), 0, 1);

    let remainingPoints = Math.max(0, targetScore - derivedScore);
    if (derivedScore >= targetScore && !stable) remainingPoints = Math.max(remainingPoints, 3);
    if (movementWeak && weakestMovement != null) remainingPoints += Math.max(3, targetScore - weakestMovement) * .72;

    const prior = recoveryPrior(diagnostics.familiarity, context);
    if (context.priorMastery) remainingPoints *= 1 - prior * .55;
    remainingPoints *= 1 + (1 - coverage) * .55;

    const speedValue = Math.max(5, num(diagnostics.speed && diagnostics.speed.value, 30));
    let pointEstimateMinutes = Math.max(0, remainingPoints * speedValue);
    const isReady = Boolean(stable && !movementWeak && coverage >= .8 && derivedScore >= targetScore);
    if (isReady) pointEstimateMinutes = 0;

    const confidence = result.confidence || 'low';
    const spread = confidence === 'high' ? .35 : confidence === 'medium' ? .65 : 1.05;
    const volatility = Math.max(0, num(diagnostics.volatility));
    const daysSince = Math.max(0, num(diagnostics.retention && diagnostics.retention.daysSince));
    const stalenessUncertainty = daysSince >= 30 ? .3 : daysSince >= 14 ? .15 : 0;
    const uncertainty = 1 + volatility / 100 + (1 - coverage) * .65 + stalenessUncertainty;
    const lowMinutes = Math.max(0, pointEstimateMinutes * Math.max(.25, 1 - spread));
    const highMinutes = Math.max(pointEstimateMinutes, pointEstimateMinutes * (1 + spread * uncertainty));

    const factors = Array.from(new Set([
      ...(Array.isArray(result.factors) ? result.factors : []),
      ...(context.priorMastery ? ['recuperación más rápida por repertorio previo'] : []),
      ...(derivedScore !== result.rawScore ? ['solidez global derivada de movimientos'] : []),
    ]));

    return {
      ...result,
      rawScore: derivedScore,
      effectiveScore: derivedScore,
      pointEstimateMinutes: Math.round(pointEstimateMinutes),
      lowMinutes: Math.round(lowMinutes),
      highMinutes: Math.round(highMinutes),
      isReady,
      factors,
      diagnostics: {
        ...diagnostics,
        familiarity: {
          ...(diagnostics.familiarity || {}),
          prior,
          recovery: Boolean(context.priorMastery),
          historical: Boolean(context.archived || context.formalEvent || context.originRecovery || (diagnostics.familiarity && diagnostics.familiarity.historical)),
          context,
        },
        movementWeak,
        weakestMovement,
        recoveryContext: context,
        derivedWorkScore: typeof model.workScoreDetails === 'function' ? model.workScoreDetails(work) : null,
        currentLabel: typeof model.statusLabel === 'function' ? model.statusLabel(data, work) : model.label(derivedScore),
        recoveryContextModel: true,
      },
    };
  }

  estimateReadiness.__recoveryContextModel = true;
  estimateReadiness.__previous = previousEstimate;
  core.estimateReadiness = estimateReadiness;

  setTimeout(() => {
    try { if (typeof window.renderObras === 'function') window.renderObras(); } catch (error) {}
    try { if (typeof window.updateCronoReadiness === 'function') window.updateCronoReadiness(); } catch (error) {}
    try { window.dispatchEvent(new CustomEvent('solidity-model-ready')); } catch (error) {}
  }, 0);
})();
