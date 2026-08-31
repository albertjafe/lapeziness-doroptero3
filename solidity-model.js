(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SolidityModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function percent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n, 0, 100) : null;
  }

  function timestamp(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
  }

  function dateFrom(item) {
    return timestamp(item && (
      item.endedAt || item.completedDate || item.startedAt || item.at ||
      item.date || item.fecha || item.updatedAt || item.createdAt
    ));
  }

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function scoreFromObservation(item, options) {
    if (item == null) return null;
    if (typeof item === 'number' || typeof item === 'string') return percent(item);
    if (item.solidezPct != null && item.solidezPct !== '') return percent(item.solidezPct);
    if (item.val != null && item.val !== '') return percent(item.val);
    if (item.value != null && item.value !== '') return percent(item.value);
    if (item.solRating != null && item.solRating !== '') return percent(item.solRating);
    if (item.sol != null && item.sol !== '') {
      const raw = Number(item.sol);
      if (!Number.isFinite(raw)) return null;
      if (options && options.legacyScale && raw >= 1 && raw <= 10) return clamp(raw * 10, 0, 100);
      // `sol` es la píldora actual y tiene prioridad sobre cualquier nota global
      // de evento como obraScore. 10 aquí significa literalmente 10%.
      return clamp(raw, 0, 100);
    }

    if (item.score != null && item.score !== '') {
      const raw = Number(item.score);
      if (!Number.isFinite(raw)) return null;
      const legacyPass = item.solidezPct == null && raw >= 1 && raw <= 10;
      return legacyPass ? clamp(raw * 10, 0, 100) : clamp(raw, 0, 100);
    }
    if (item.obraScore != null && item.obraScore !== '') {
      const raw = Number(item.obraScore);
      if (!Number.isFinite(raw)) return null;
      // obraScore pertenece al sistema porcentual actual de resultados de evento.
      // A diferencia del antiguo pase score=1..10, 10 aquí significa 10%, no 100%.
      return clamp(raw, 0, 100);
    }
    return null;
  }

  function observations(entity) {
    if (!entity) return [];
    const rows = [];
    let sequence = 0;
    const add = (list, source) => (Array.isArray(list) ? list : []).forEach(item => {
      const score = scoreFromObservation(item);
      if (score == null) return;
      rows.push({ score, time: dateFrom(item), source, sequence: sequence++, raw: item });
    });
    add(entity.solHistory, 'solidity');
    add(entity.paseHistory, 'pass');
    return rows;
  }

  function currentObservation(entity, options) {
    const rows = observations(entity);
    if (rows.length) {
      rows.sort((a, b) => {
        if (a.time != null && b.time != null && a.time !== b.time) return a.time - b.time;
        if (a.time != null && b.time == null) return 1;
        if (a.time == null && b.time != null) return -1;
        return a.sequence - b.sequence;
      });
      return rows[rows.length - 1];
    }
    const score = scoreFromObservation(entity, options);
    return score == null ? null : { score, time: dateFrom(entity), source: 'current', sequence: 0, raw: entity };
  }

  function currentScore(entity, options) {
    const current = currentObservation(entity, options);
    return current ? Math.round(current.score) : null;
  }

  function measuredObservation(entity) {
    const rows = observations(entity);
    if (rows.length) return currentObservation(entity);
    const raw = Number(entity && entity.sol);
    if (Number.isFinite(raw) && raw !== 1) {
      return { score: clamp(raw, 0, 100), time: dateFrom(entity), source: 'current', sequence: 0, raw: entity };
    }
    return null;
  }

  function workScoreDetails(work) {
    if (!work) return { score: null, source: 'none', measuredMovements: 0, totalMovements: 0, partial: false };
    const whole = measuredObservation(work);
    const movements = Array.isArray(work.movimientos) ? work.movimientos : [];
    const movementRows = movements.map((movement, index) => {
      const observation = measuredObservation(movement);
      const duration = Number(movement && (movement.duracion ?? movement.duration));
      return {
        index,
        movement,
        observation,
        score: observation ? observation.score : null,
        time: observation ? observation.time : null,
        weight: Number.isFinite(duration) && duration > 0 ? duration : 1,
      };
    });
    const measured = movementRows.filter(row => row.observation && row.score != null);

    if (!measured.length) {
      const fallback = whole || currentObservation(work);
      return {
        score: fallback ? Math.round(fallback.score) : null,
        source: whole ? 'whole' : fallback ? 'fallback' : 'none',
        measuredMovements: 0,
        totalMovements: movements.length,
        partial: false,
        observation: fallback || null,
      };
    }

    const latestMovementTime = measured.reduce((latest, row) => row.time == null ? latest : Math.max(latest, row.time), -Infinity);
    const wholeTime = whole && whole.time != null ? whole.time : -Infinity;
    if (whole && wholeTime >= latestMovementTime) {
      return {
        score: Math.round(whole.score),
        source: 'whole',
        measuredMovements: measured.length,
        totalMovements: movements.length,
        partial: measured.length < movements.length,
        observation: whole,
      };
    }

    let weightedScore = 0;
    let weightTotal = 0;
    movementRows.forEach(row => {
      let score = row.score;
      if (score == null && whole) score = whole.score;
      if (score == null) return;
      weightedScore += score * row.weight;
      weightTotal += row.weight;
    });
    const score = weightTotal > 0 ? Math.round(weightedScore / weightTotal) : (whole ? Math.round(whole.score) : null);
    return {
      score,
      source: 'movements',
      measuredMovements: measured.length,
      totalMovements: movements.length,
      partial: measured.length < movements.length && !whole,
      observation: null,
      latestMovementTime: Number.isFinite(latestMovementTime) ? latestMovementTime : null,
    };
  }

  function currentWorkScore(work) {
    return workScoreDetails(work).score;
  }

  function label(score) {
    const n = percent(score);
    if (n == null) return 'Sin medir';
    if (n < 20) return 'En construcción';
    if (n < 40) return 'Tomando forma';
    if (n < 60) return 'Aprendida · frágil';
    if (n < 80) return 'Sólida';
    if (n < 95) return 'Segura';
    return 'Dominada';
  }

  function shortLabel(score) {
    const n = percent(score);
    if (n == null) return 'Sin medir';
    if (n < 20) return 'Inicial';
    if (n < 40) return 'En progreso';
    if (n < 60) return 'Aprendida';
    if (n < 80) return 'Sólida';
    if (n < 95) return 'Segura';
    return 'Dominada';
  }

  function learned(score) {
    const n = percent(score);
    return n != null && n >= 40;
  }

  function matchingEventResult(event, work) {
    const rows = event && event.resultado && Array.isArray(event.resultado.obrasResultados) ? event.resultado.obrasResultados : [];
    return rows.find(item => String(item && item.obraId || '') === String(work && work.id || '')) || null;
  }

  function eventContainsWork(event, work) {
    if (!event || !work) return false;
    const id = String(work.id || '');
    if (Array.isArray(event.obras) && event.obras.some(item => String(item && (item.id ?? item.refId ?? item.obraId) || item) === id)) return true;
    if (matchingEventResult(event, work)) return true;
    const works = Array.isArray(event.works) ? event.works : [];
    return works.some(item => {
      if (!item) return false;
      if (String(item.refId || item.obraId || '') === id) return true;
      const sameName = normalize(item.name) && normalize(item.name) === normalize(work.name);
      const sameComposer = !item.composer || !work.composer || normalize(item.composer) === normalize(work.composer);
      return sameName && sameComposer;
    });
  }

  function formalEvent(event, historical) {
    if (!event) return false;
    const type = normalize(event.tipo || event.type);
    if (['ensayo', 'clase', 'masterclass'].includes(type)) return false;
    if (historical) return true;
    return event.completado === true || Boolean(event.completedDate);
  }

  function formalPerformanceEvidence(event, work, historical) {
    if (!formalEvent(event, historical) || !eventContainsWork(event, work)) return false;
    if (historical) return true;
    const row = matchingEventResult(event, work);
    if (!row) return true;
    const solidity = scoreFromObservation({ solidezPct: row.solidezPct, sol: row.sol, val: row.val, solRating: row.solRating });
    const combined = scoreFromObservation({ obraScore: row.obraScore, score: row.score });
    const scores = [solidity, combined].filter(value => value != null);
    if (!scores.length) return true;
    return Math.max(...scores) >= 40;
  }

  function pastPeakScore(work) {
    const rows = observations(work).slice().sort((a, b) => {
      const ta = a.time == null ? -Infinity : a.time;
      const tb = b.time == null ? -Infinity : b.time;
      return ta - tb || a.sequence - b.sequence;
    });
    if (rows.length < 2) return 0;
    return rows.slice(0, -1).reduce((peak, row) => Math.max(peak, row.score), 0);
  }

  function historyContext(db, work) {
    const data = db || {};
    const originRecovery = normalize(work && work.origen) === 'recuperacion';
    const archive = Array.isArray(data.historicalRepertoire) ? data.historicalRepertoire : [];
    const archived = archive.some(item =>
      String(item && item.id || '') === String(work && work.historicalSourceId || '') ||
      String(item && item.reactivatedObraId || '') === String(work && work.id || '') ||
      (normalize(item && item.name) && normalize(item && item.name) === normalize(work && work.name) &&
       (!item.composer || !work.composer || normalize(item.composer) === normalize(work.composer)))
    );
    const formal = (Array.isArray(data.eventos) ? data.eventos : []).some(event => formalPerformanceEvidence(event, work, false));
    const historicalFormal = (Array.isArray(data.historicalEvents) ? data.historicalEvents : []).some(event => formalPerformanceEvidence(event, work, true));
    const previousPeak = pastPeakScore(work);
    const priorMastery = originRecovery || archived || formal || historicalFormal || previousPeak >= 60;
    return { priorMastery, originRecovery, archived, formalEvent: formal || historicalFormal, previousPeak };
  }

  function statusLabel(db, work, options) {
    const score = currentWorkScore(work);
    const context = historyContext(db, work);
    const compact = options && options.compact;
    if (context.priorMastery) {
      if (score == null || score < 60) return 'Recuperación';
      if (score < 80) return compact ? 'Repertorio' : 'Repertorio · en forma';
    }
    return compact ? shortLabel(score) : label(score);
  }

  function inferredCoverage(score) {
    const n = percent(score);
    return n == null ? 0 : clamp(n / 40, 0, 1);
  }

  function targetKey(point) {
    return `${point && point.scope || 'whole'}:${point && (point.movementId ?? point.movimientoId ?? point.movId) || ''}`;
  }

  function plateauGroups(points, tolerance) {
    const tol = Number.isFinite(Number(tolerance)) ? Math.max(0, Number(tolerance)) : 3;
    const valid = (Array.isArray(points) ? points : []).map((point, index) => {
      const rawSource = point && (point.raw || point.source);
      return {
        ...point,
        score: rawSource ? scoreFromObservation(rawSource) : percent(point && point.score),
        time: point && point.time != null ? Number(point.time) : dateFrom(point),
        _index: index,
      };
    }).filter(point => point.score != null && point.time != null)
      .sort((a, b) => a.time - b.time || a._index - b._index);

    const byTarget = new Map();
    valid.forEach(point => {
      const key = targetKey(point);
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(point);
    });

    const result = [];
    byTarget.forEach((list, key) => {
      let group = null;
      list.forEach(point => {
        if (!group || Math.abs(point.score - group.anchorScore) > tol) {
          if (group) result.push(group);
          group = {
            key,
            scope: point.scope || 'whole',
            movementId: point.movementId ?? point.movimientoId ?? point.movId ?? null,
            anchorScore: point.score,
            startScore: point.score,
            endScore: point.score,
            startTime: point.time,
            endTime: point.time,
            points: [point],
          };
        } else {
          group.endScore = point.score;
          group.endTime = point.time;
          group.points.push(point);
        }
      });
      if (group) result.push(group);
    });

    return result.sort((a, b) => a.startTime - b.startTime);
  }


  function median(values) {
    const sorted = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  // Señala saltos aislados para revisión humana. Nunca corrige automáticamente.
  // Se compara cada medición solo con vecinos del mismo ámbito (obra/movimiento),
  // para no confundir diferencias normales entre movimientos con errores de entrada.
  function detectOutliers(points, options) {
    const opts = options || {};
    const radius = Math.max(1, Math.floor(Number(opts.neighborRadius) || 2));
    const minNeighbors = Math.max(2, Math.floor(Number(opts.minNeighbors) || 2));
    const minDelta = Math.max(1, Number(opts.minDelta) || 18);
    const spreadMultiplier = Math.max(0, Number(opts.spreadMultiplier) || 2.2);
    const spreadPadding = Math.max(0, Number(opts.spreadPadding) || 6);
    const groups = new Map();

    (Array.isArray(points) ? points : []).forEach((point, index) => {
      const rawSource = point && point.raw;
      const score = rawSource ? scoreFromObservation(rawSource) : percent(point && point.score);
      const time = point && point.time != null ? Number(point.time) : dateFrom(point);
      if (score == null || !Number.isFinite(time)) return;
      const normalized = Object.assign({}, point, { score, time, _index: index });
      const key = targetKey(normalized);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(normalized);
    });

    const flagged = [];
    groups.forEach(list => {
      list.sort((a, b) => a.time - b.time || a._index - b._index);
      list.forEach((point, index) => {
        const before = list.slice(Math.max(0, index - radius), index);
        const after = list.slice(index + 1, index + 1 + radius);
        const neighbors = before.concat(after);
        if (neighbors.length < minNeighbors) return;
        const scores = neighbors.map(item => item.score);
        const baseline = median(scores);
        if (baseline == null) return;
        const spread = Math.max(...scores) - Math.min(...scores);
        const threshold = Math.max(minDelta, spread * spreadMultiplier + spreadPadding);
        const delta = Math.abs(point.score - baseline);
        if (delta < threshold) return;
        flagged.push({
          point,
          score: point.score,
          baseline,
          delta,
          threshold,
          neighborScores: scores.slice(),
          target: targetKey(point),
        });
      });
    });
    return flagged.sort((a, b) => a.point._index - b.point._index);
  }

  return {
    percent,
    scoreFromObservation,
    observations,
    currentObservation,
    currentScore,
    measuredObservation,
    workScoreDetails,
    currentWorkScore,
    label,
    shortLabel,
    learned,
    eventContainsWork,
    formalPerformanceEvidence,
    historyContext,
    statusLabel,
    inferredCoverage,
    detectOutliers,
    plateauGroups,
  };
});
