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

  // La píldora actual es porcentual: sol=1 significa 1%, no 10%.
  // Los pases antiguos son la excepción conocida: antes guardaban score=1..10
  // y no tenían solidezPct. Si existe solidezPct, ese porcentaje manda.
  function scoreFromObservation(item, options) {
    if (item == null) return null;
    if (typeof item === 'number' || typeof item === 'string') return percent(item);
    if (item.solidezPct != null && item.solidezPct !== '') return percent(item.solidezPct);
    if (item.val != null && item.val !== '') return percent(item.val);
    if (item.value != null && item.value !== '') return percent(item.value);
    if (item.solRating != null && item.solRating !== '') return percent(item.solRating);

    if (item.score != null && item.score !== '') {
      const raw = Number(item.score);
      if (!Number.isFinite(raw)) return null;
      const legacyPass = item.solidezPct == null && raw >= 1 && raw <= 10;
      return legacyPass ? clamp(raw * 10, 0, 100) : clamp(raw, 0, 100);
    }
    if (item.obraScore != null && item.obraScore !== '') {
      const raw = Number(item.obraScore);
      if (!Number.isFinite(raw)) return null;
      const legacy = raw >= 1 && raw <= 10;
      return legacy ? clamp(raw * 10, 0, 100) : clamp(raw, 0, 100);
    }
    if (item.sol != null && item.sol !== '') {
      const raw = Number(item.sol);
      if (!Number.isFinite(raw)) return null;
      if (options && options.legacyScale && raw >= 1 && raw <= 10) return clamp(raw * 10, 0, 100);
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

  // Rótulos derivados y deliberadamente orientativos. No se guardan como
  // estados separados: si la píldora cambia, la palabra cambia con ella.
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

  // Sin compases explícitos no necesitamos otro checkbox de "aprendida".
  // La cobertura básica se infiere de la píldora; 40% equivale a haber
  // recorrido/aprendido aproximadamente el conjunto, aunque aún sea frágil.
  function inferredCoverage(score) {
    const n = percent(score);
    return n == null ? 0 : clamp(n / 40, 0, 1);
  }

  function targetKey(point) {
    return `${point && point.scope || 'whole'}:${point && (point.movementId ?? point.movimientoId ?? point.movId) || ''}`;
  }

  // Agrupa observaciones casi iguales como una meseta. Así una secuencia
  // 1,1,1,2,1 durante semanas seguida por 70 no se interpreta como que los
  // 69 puntos aparecieron en la última sesión: la transición empieza al
  // principio de esa meseta y puede contabilizar todo el trabajo intermedio.
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

  return {
    percent,
    scoreFromObservation,
    observations,
    currentObservation,
    currentScore,
    label,
    shortLabel,
    learned,
    inferredCoverage,
    plateauGroups,
  };
});
