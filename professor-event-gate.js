(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfessorEventGate = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const RUNTIME_MARKER = 'PROFESSOR_EVENT_GATE_V2';
  const RUNTIME_RULES = `${RUNTIME_MARKER}
REGLA DE ENTRADA AL PLAN
- El Profesor organiza el estudio a partir de EVENTOS y PROYECTOS futuros que tengan repertorio explícitamente enlazado.
- Una obra o movimiento SIN ningún evento/proyecto futuro enlazado queda FUERA del ranking diario: prioridad musical 0 por defecto.
- No recomiendes mantener, reactivar, refrescar, "vacunar contra el enfriamiento" ni recuperar una obra solo porque tenga solidez baja, medición antigua, dificultad alta, muchas horas históricas o lleve días/semanas sin tocarse. Si no está exigida por un evento/proyecto enlazado, puede enfriarse sin problema.
- Si un evento existe pero NO tiene repertorio enlazado, menciónalo como dato pendiente y NO lo uses para elevar ninguna obra.
- Solo después de pasar este filtro de evento/proyecto, ordena los movimientos por urgencia, riesgo, coste restante, solidez, dificultad, estudio reciente, velocidad y saturación.

DURACIÓN DEL DÍA
- Usa la preferencia diaria y la condición del turno definidas por ProfessorDurationPolicy; no fijes aquí un presupuesto distinto.
- No rellenes tiempo por rellenarlo. Al ampliar, reorganiza bloques según valor marginal y protege calidad, fatiga y saturación.`;

  const arr = value => Array.isArray(value) ? value : [];

  function isLinked(unit) {
    return Boolean(unit && unit.nextEvent);
  }

  function modeInstruction(mode) {
    if (mode === 'remaining') return 'Organiza únicamente lo que queda de HOY desde la hora actual. Ten en cuenta todo lo ya estudiado hoy y no reinicies el día.';
    if (mode === 'now') return 'Dime qué debería estudiar AHORA MISMO. Da una decisión principal, duración y un plan B corto.';
    if (mode === 'week') return 'Haz balance de los próximos 7 días y propón una distribución estratégica por movimientos.';
    return 'Organiza el día de hoy de forma realista, movimiento por movimiento, usando toda la información disponible.';
  }

  function enhanceDefaultPrompt(text) {
    const value = String(text || '').trim();
    if (!value) return RUNTIME_RULES;
    if (value.includes(RUNTIME_MARKER)) return value;
    return `${value}\n\n${RUNTIME_RULES}`;
  }

  function postProcessReport(report) {
    if (!report || report.__professorEventGateApplied) return report;
    const units = arr(report.units);
    const linked = [];
    const excluded = [];

    units.forEach(unit => {
      if (isLinked(unit)) {
        unit.planningEligible = true;
        linked.push(unit);
        return;
      }
      unit.planningEligible = false;
      if (!unit.backgroundPriority) unit.backgroundPriority = unit.priority || null;
      unit.priority = {
        score: 0,
        band: 'sin_evento',
        reasons: ['Sin evento/proyecto futuro enlazado · fuera del plan diario'],
      };
      excluded.push(unit);
    });

    units.sort((a, b) => {
      if (Boolean(b.planningEligible) !== Boolean(a.planningEligible)) return b.planningEligible ? 1 : -1;
      const byPriority = Number(b.priority && b.priority.score || 0) - Number(a.priority && a.priority.score || 0);
      if (byPriority) return byPriority;
      return Number(a.nextEvent && a.nextEvent.daysAway || 99999) - Number(b.nextEvent && b.nextEvent.daysAway || 99999);
    });

    report.priorities = units.filter(isLinked).slice(0, 12).map(unit => ({
      key: unit.key,
      label: unit.label,
      priority: unit.priority,
      nextEvent: unit.nextEvent,
      solidity: unit.solidity,
      recoveryHours: unit.recoveryHours,
      recent: unit.recent,
      pace: unit.pace,
    }));

    report.coverage = Object.assign({}, report.coverage || {}, {
      eventLinkedPlanningUnits: linked.length,
      excludedUnlinkedPlanningUnits: excluded.length,
    });
    report.warnings = arr(report.warnings);
    const exclusionMessage = `${excluded.length} unidad(es) sin evento/proyecto enlazado quedan fuera del ranking del Profesor; su enfriamiento no genera estudio por sí solo.`;
    if (excluded.length && !report.warnings.includes(exclusionMessage)) report.warnings.push(exclusionMessage);
    if (!linked.length) {
      const message = 'No hay repertorio enlazado a ningún evento/proyecto futuro: el Profesor no debe inventar bloques de estudio a partir del repertorio general.';
      if (!report.warnings.includes(message)) report.warnings.push(message);
    }
    report.__professorEventGateApplied = true;
    return report;
  }

  function buildCompactContext(core, report, maxUnits) {
    if (root.ProfessorHandoffResilience) return root.ProfessorHandoffResilience.denseContext(report);
    const units = arr(report && report.units);
    const eventLines = arr(report && report.events).map(event => `${event.day}|${event.name}|${event.type || '-'}|${event.daysAway}d|fuente=${event.source}|repertorio=${event.repertoireLinked ? arr(event.workIds).join(',') : 'NO_ENLAZADO'}`);
    const todayLines = arr(report && report.today && report.today.byUnit).map(item => `${item.label}=${item.minutes}m`).join('; ') || 'sin movimientos registrados';
    const unitLine = typeof core.unitLine === 'function'
      ? unit => core.unitLine(unit)
      : unit => `${unit.key}|${unit.label}|P${Math.round(unit.priority && unit.priority.score || 0)}|evento=${unit.nextEvent ? unit.nextEvent.name : '-'}`;
    const excluded = Number(report && report.coverage && report.coverage.excludedUnlinkedPlanningUnits || 0);
    const paceLines = units.filter(unit => unit.pace && unit.nextEvent).map(unit => {
      const pace = unit.pace || {};
      const velocity = pace.velocityEstimate;
      return `${unit.key}|objetivo=${unit.nextEvent.name}/${unit.nextEvent.daysAway}d|actual7d=${pace.currentDaily7dMinutes == null ? '?' : pace.currentDaily7dMinutes}m/d|necesario≈${pace.requiredDailyMinutes == null ? '?' : pace.requiredDailyMinutes}m/d|ritmo=${pace.status || '?'}${velocity ? `|velocidad=${velocity.hours}h_estimadas_por_progreso_observado` : ''}`;
    });
    return [
      `SUPERINFORME_PROFESOR_EVENTOS_V2 ${report && report.asOf || ''}`,
      `HOY total_conocido=${report && report.today ? report.today.totalKnownMinutes : 0}m; por_movimiento=${report && report.today ? report.today.movementMinutes : 0}m; sin_movimiento=${report && report.today ? report.today.unallocatedMinutes : 0}m; ${todayLines}`,
      `COBERTURA ${JSON.stringify(report && report.coverage || {})}`,
      arr(report && report.warnings).length ? `ADVERTENCIAS ${report.warnings.join(' | ')}` : 'ADVERTENCIAS ninguna',
      'EVENTOS\n' + (eventLines.join('\n') || 'ninguno'),
      `REGLA_RANKING solo repertorio con evento/proyecto enlazado; unidades presentes pero excluidas del plan=${excluded}`,
      'UNIDADES_PRIORIZABLES_ENLAZADAS_A_EVENTOS\n' + (units.map(unitLine).join('\n') || 'ninguna'),
      paceLines.length ? 'HORIZONTE_Y_RITMO_ENLAZADO\n' + paceLines.join('\n') : 'HORIZONTE_Y_RITMO_ENLAZADO\nninguno',
    ].join('\n\n');
  }

  function install(core) {
    const target = core || (root && root.ProfessorCore);
    if (!target || target.__professorEventGateInstalled) return Boolean(target && target.__professorEventGateInstalled);

    const originalBuildReport = target.buildReport;
    if (typeof originalBuildReport !== 'function') return false;

    target.DEFAULT_MASTER_PROMPT = enhanceDefaultPrompt(target.DEFAULT_MASTER_PROMPT);

    const wrappedBuildReport = function () {
      return postProcessReport(originalBuildReport.apply(this, arguments));
    };
    wrappedBuildReport.__professorEventGate = true;
    target.buildReport = wrappedBuildReport;

    const compactContext = function (report, maxUnits) {
      return buildCompactContext(target, postProcessReport(report), maxUnits);
    };
    compactContext.__professorEventGate = true;
    target.compactContext = compactContext;

    const buildPrompt = function (report, options) {
      const opts = options || {};
      const master = String(opts.masterPrompt || target.DEFAULT_MASTER_PROMPT || '').trim();
      const note = String(opts.note || '').trim();
      const runtime = master.includes(RUNTIME_MARKER) ? '' : `\n\n${RUNTIME_RULES}`;
      return `${master}${runtime}\n\nTAREA DE ESTE TURNO\n${modeInstruction(opts.mode || 'today')}${note ? `\nCondición/mensaje adicional del usuario: ${note}` : ''}\n\n${compactContext(report)}\n\nAntes de recomendar, comprueba explícitamente: (1) lo estudiado hoy, (2) qué eventos/proyectos tienen repertorio realmente enlazado, (3) que ninguna obra sin evento se cuele por enfriamiento o historial, (4) cada movimiento por separado, (5) urgencia y coste restante, (6) saturación reciente y (7) si la referencia diaria elegida es adecuada o existe una extensión opcional justificada, recalculando con flexibilidad si conviene reforzar/repetir bloques ya elegidos, incorporar otros nuevos o combinar ambas cosas.`;
    };
    buildPrompt.__professorEventGate = true;
    target.buildPrompt = buildPrompt;

    const buildChatGptUrl = function (report, options) {
      const opts = options || {};
      const fullPrompt = buildPrompt(report, opts);
      let promptForUrl = fullPrompt;
      let encoded = encodeURIComponent(promptForUrl);
      let truncated = false;
      return { url: `https://chatgpt.com/?prompt=${encoded}`, fullPrompt, promptForUrl, truncated };
    };
    buildChatGptUrl.__professorEventGate = true;
    target.buildChatGptUrl = buildChatGptUrl;

    target.__professorEventGateInstalled = true;
    return true;
  }

  const api = { RUNTIME_RULES, postProcessReport, buildCompactContext, install };
  if (root && root.ProfessorCore) install(root.ProfessorCore);
  return api;
});
