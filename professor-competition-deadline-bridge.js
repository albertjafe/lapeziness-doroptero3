/* Long-horizon competition/deadline planning for Professor.
 * Keeps deadline and competition targets distinct and only attaches them to
 * repertoire that Alberto explicitly assigned.
 */
(function professorCompetitionDeadlineBridge(root) {
  'use strict';
  if (root.ProfessorCompetitionDeadlineBridge) return;

  const DAY = 86400000;
  const arr = value => Array.isArray(value) ? value : [];
  const id = value => value == null ? '' : String(value);
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const dateOf = value => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const isoDay = value => {
    const d = dateOf(value);
    if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const round1 = value => Math.round(num(value) * 10) / 10;

  function startOfDay(value) {
    const d = dateOf(value) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function daysAway(value, asOf) {
    const at = dateOf(value);
    if (!at) return null;
    return Math.max(0, Math.ceil((startOfDay(at) - startOfDay(asOf)) / DAY));
  }

  function eventUrgency(days, role) {
    if (!Number.isFinite(days)) return 0;
    let value = days <= 3 ? 34 : days <= 7 ? 29 : days <= 14 ? 24 : days <= 30 ? 17 : days <= 60 ? 10 : days <= 120 ? 6 : days <= 365 ? 3 : 1;
    if (/deadline/.test(String(role || ''))) value += 4;
    return value;
  }

  function targetFor(plan, kind, asOf) {
    const deadline = kind === 'deadline';
    const atValue = deadline ? plan.deadline : plan.competitionStart;
    const at = dateOf(atValue);
    if (!at || at < startOfDay(asOf) || at > new Date(startOfDay(asOf).getTime() + 730 * DAY)) return null;
    const workIds = arr(deadline ? plan.videoWorkIds : plan.repertoireWorkIds).map(id).filter(Boolean);
    const movementTargets = deadline ? (plan.videoMovements || {}) : (plan.professorMovements || {});
    if (!workIds.length) return null;
    const days = daysAway(at, asOf);
    return {
      key: 'competition-plan:' + id(plan.id) + ':' + kind,
      source: 'competition-plan',
      id: id(plan.id) + ':' + kind,
      competitionPlanId: plan.id,
      googleEventId: deadline ? (plan.googleDeadlineEventId || null) : null,
      name: (deadline ? 'Deadline · ' : 'Concurso · ') + (plan.name || 'Concurso'),
      type: deadline ? (plan.deadlineKind || 'video_deadline') : 'concurso',
      role: deadline ? (plan.deadlineKind || 'video_deadline') : 'competition',
      status: plan.status || 'standby',
      at: at.toISOString(),
      day: isoDay(at),
      daysAway: days,
      workIds,
      movementTargets,
      repertoireLinked: true,
      videoRequirements: deadline ? (plan.videoRequirements || null) : null,
      competitionStart: plan.competitionStart || null,
      competitionEnd: plan.competitionEnd || null,
      planningWeight: (plan.status || 'standby') === 'standby' ? 0.7 : (plan.status === 'idea' ? 0.45 : 1),
    };
  }

  function unitMatches(unit, target) {
    if (!unit || !target || !target.workIds.includes(id(unit.obraId))) return false;
    const targets = target.movementTargets;
    if (!unit.movId || !targets || typeof targets !== 'object') return true;
    const list = targets[id(unit.obraId)] || targets[unit.obraId];
    return !Array.isArray(list) || !list.length || list.map(id).includes(id(unit.movId));
  }

  function velocityEstimate(unit, target) {
    const velocity = unit && unit.learningVelocity;
    const pph = num(velocity && velocity.pointsPerHour, 0);
    if (!(pph > 0) || unit.solidity == null) return null;
    const targetSolidity = target && target.daysAway <= 14 ? 90 : 82;
    const gap = Math.max(0, targetSolidity - num(unit.solidity));
    if (!gap) return { hours: 0, targetSolidity, source: 'observed-solidity-velocity' };
    const hours = gap / pph;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 300) return null;
    return { hours: round1(hours), targetSolidity, source: 'observed-solidity-velocity' };
  }

  function recomputePace(unit, target) {
    const days = Math.max(1, num(target && target.daysAway, 1));
    const recoveryHigh = Math.max(0, num(unit.recoveryHours && unit.recoveryHours.high, 0));
    const velocity = velocityEstimate(unit, target);
    const hoursNeeded = Math.max(recoveryHigh, num(velocity && velocity.hours, 0));
    const requiredDaily = round1(hoursNeeded * 60 / days);
    const currentDaily = round1(num(unit.recent && unit.recent.d7, 0) / 7);
    const ratio = requiredDaily > 0 ? Math.round((currentDaily / requiredDaily) * 100) / 100 : null;
    unit.pace = Object.assign({}, unit.pace || {}, {
      horizonDays: days,
      targetKind: target.role,
      requiredDailyMinutes: requiredDaily,
      currentDaily7dMinutes: currentDaily,
      ratio,
      status: ratio == null ? 'sin_objetivo' : ratio >= 1.15 ? 'por_delante' : ratio >= 0.85 ? 'en_ritmo' : 'por_debajo',
      planningWeight: target.planningWeight == null ? 1 : target.planningWeight,
      velocityEstimate: velocity,
      hoursNeededForPace: round1(hoursNeeded),
    });
  }

  function boostPriority(unit, oldEvent, target) {
    if (!unit.priority) return;
    const oldUrgency = oldEvent ? eventUrgency(num(oldEvent.daysAway, 9999), oldEvent.role || oldEvent.type) : 0;
    const newUrgency = eventUrgency(num(target.daysAway, 9999), target.role || target.type);
    const weight = target.planningWeight == null ? 1 : target.planningWeight;
    const delta = Math.max(0, newUrgency - oldUrgency) * weight;
    if (delta > 0) unit.priority.score = round1(Math.min(100, num(unit.priority.score) + delta));
    const reasons = arr(unit.priority.reasons);
    const reason = (/deadline/.test(target.role) ? 'deadline' : 'concurso') + ' en ' + target.daysAway + ' d' + (target.status === 'standby' ? ' · standby' : '');
    if (!reasons.includes(reason)) reasons.unshift(reason);
    unit.priority.reasons = reasons.slice(0, 8);
    unit.priority.band = unit.priority.score >= 70 ? 'urgente' : unit.priority.score >= 50 ? 'alta' : unit.priority.score >= 30 ? 'media' : 'mantenimiento';
  }

  function mergeDeadlineIntoGoogleEvent(report, target) {
    if (!target.googleEventId) return false;
    const google = arr(report.events).find(event => event.source === 'google' && id(event.id) === id(target.googleEventId));
    if (!google) return false;
    Object.assign(google, {
      competitionPlanId: target.competitionPlanId,
      role: target.role,
      status: target.status,
      workIds: target.workIds,
      movementTargets: target.movementTargets,
      repertoireLinked: true,
      videoRequirements: target.videoRequirements,
      planningWeight: target.planningWeight,
      linkedByProfessor: true,
    });
    return true;
  }

  function enrich(report, database) {
    if (!report || !database) return report;
    const asOf = dateOf(report.asOf) || new Date();
    const plans = arr(database.competitionPlans).filter(plan => plan && plan.status !== 'descartado');
    const targets = [];
    plans.forEach(plan => {
      const deadline = targetFor(plan, 'deadline', asOf);
      const competition = targetFor(plan, 'competition', asOf);
      if (deadline) targets.push(deadline);
      if (competition) targets.push(competition);
    });

    const existingKeys = new Set(arr(report.events).map(event => event.key));
    targets.forEach(target => {
      if (/deadline/.test(target.role) && mergeDeadlineIntoGoogleEvent(report, target)) return;
      if (!existingKeys.has(target.key)) report.events.push(target);
    });
    report.events.sort((a, b) => num(a.daysAway, 99999) - num(b.daysAway, 99999));

    arr(report.units).forEach(unit => {
      const matched = targets.filter(target => unitMatches(unit, target)).sort((a, b) => a.daysAway - b.daysAway);
      if (!matched.length) return;
      const oldEvent = unit.nextEvent || null;
      const all = arr(unit.linkedEvents).concat(matched).filter(Boolean);
      const dedup = new Map();
      all.forEach(event => dedup.set(event.key || event.id || (event.name + '|' + event.day), event));
      unit.linkedEvents = Array.from(dedup.values()).sort((a, b) => num(a.daysAway, 99999) - num(b.daysAway, 99999));
      const earliest = unit.linkedEvents[0];
      if (!oldEvent || num(earliest.daysAway, 99999) < num(oldEvent.daysAway, 99999)) {
        unit.nextEvent = earliest;
        boostPriority(unit, oldEvent, earliest);
      }
      recomputePace(unit, unit.nextEvent || earliest);
    });

    report.units.sort((a, b) => num(b.priority && b.priority.score) - num(a.priority && a.priority.score));
    report.priorities = report.units.slice(0, 12).map(unit => ({
      key: unit.key, label: unit.label, priority: unit.priority, nextEvent: unit.nextEvent,
      solidity: unit.solidity, recoveryHours: unit.recoveryHours, recent: unit.recent, pace: unit.pace,
    }));

    report.longHorizon = {
      days: 730,
      targets: targets.length,
      deadlines: targets.filter(target => /deadline/.test(target.role)).length,
      competitions: targets.filter(target => target.role === 'competition').length,
    };

    report.warnings = arr(report.warnings);
    plans.forEach(plan => {
      const deadline = dateOf(plan.deadline);
      const d = deadline ? daysAway(deadline, asOf) : null;
      if (d != null && d <= 120 && !arr(plan.videoWorkIds).length) {
        const message = 'Deadline en ' + d + ' d · ' + plan.name + ': repertorio de vídeo pendiente de asignar.';
        if (!report.warnings.includes(message)) report.warnings.push(message);
      }
    });
    return report;
  }

  function install() {
    const core = root.ProfessorCore;
    if (!core || typeof core.buildReport !== 'function' || core.buildReport.__competitionDeadlineBridge) return false;
    const originalBuild = core.buildReport;
    const wrappedBuild = function (database) {
      return enrich(originalBuild.apply(this, arguments), database || {});
    };
    wrappedBuild.__competitionDeadlineBridge = true;
    core.buildReport = wrappedBuild;

    if (typeof core.compactContext === 'function' && !core.compactContext.__competitionDeadlineBridge) {
      const originalCompact = core.compactContext;
      const wrappedCompact = function (report) {
        let text = originalCompact.apply(this, arguments);
        const paceLines = arr(report && report.units).filter(unit => unit.nextEvent && unit.pace).slice(0, 30).map(unit => {
          const v = unit.pace.velocityEstimate;
          return unit.key + '|objetivo=' + unit.nextEvent.name + '/' + unit.nextEvent.daysAway + 'd|actual7d=' + unit.pace.currentDaily7dMinutes + 'm/d|necesario≈' + unit.pace.requiredDailyMinutes + 'm/d|ritmo=' + unit.pace.status + (v ? '|velocidad=' + v.hours + 'h_estimadas_por_progreso_observado' : '');
        });
        if (paceLines.length) text += '\n\nHORIZONTE_Y_RITMO_730D\n' + paceLines.join('\n');
        return text;
      };
      wrappedCompact.__competitionDeadlineBridge = true;
      core.compactContext = wrappedCompact;
    }
    return true;
  }

  root.ProfessorCompetitionDeadlineBridge = { version: 1, enrich, install };
  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts > 80) clearInterval(timer);
    }, 100);
  }
})(typeof window !== 'undefined' ? window : globalThis);
