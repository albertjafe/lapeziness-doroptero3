// Small post-processor for report totals. A whole work without movements is a
// legitimate planning unit; its parent-level minutes must not also be counted
// as "unallocated movement" minutes. This keeps the Professor's today total exact.
(function professorReportNormalizer(){
  'use strict';
  const core = window.ProfessorCore;
  if (!core || typeof core.buildReport !== 'function' || core.buildReport.__professorNormalized) return;
  const original = core.buildReport;

  const arr = value => Array.isArray(value) ? value : [];
  const id = value => value == null ? '' : String(value);
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const day = value => {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  function correctedUnallocatedMinutes(db, asOf) {
    const worksWithMovements = new Set(arr(db && db.obras).filter(work => arr(work && work.movimientos).length).map(work => id(work.id)));
    const seen = new Set();
    let total = 0;
    arr(db && db.sessionPlants).forEach(plant => {
      if (!plant || String(plant.failed || '').toLowerCase() === 'true') return;
      if (plant.movId || plant.movimientoId || plant.movementId) return;
      if (!worksWithMovements.has(id(plant.obraId))) return;
      if (day(plant.endedAt || plant.startedAt || plant.at) !== day(asOf)) return;
      const minutes = Math.max(0, num(plant.mins ?? plant.min ?? plant.minutes));
      if (!minutes) return;
      const key = id(plant.id || plant.runId || plant.uid) || [plant.startedAt || '', plant.endedAt || '', plant.obraId || '', minutes].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      total += minutes;
    });
    return Math.round(total * 10) / 10;
  }

  const wrapped = function buildNormalizedProfessorReport(db, options){
    const report = original.apply(this, arguments);
    if (!report || !report.today) return report;
    const asOf = options && options.asOf ? new Date(options.asOf) : new Date(report.asOf || Date.now());
    const corrected = correctedUnallocatedMinutes(db || {}, asOf);
    report.today.unallocatedMinutes = corrected;
    report.today.totalKnownMinutes = Math.round((num(report.today.movementMinutes) + corrected) * 10) / 10;
    report.warnings = arr(report.warnings).filter(text => !/min de hoy sin movimiento asignado/i.test(String(text)));
    if (corrected > 0) report.warnings.push(`Hay ${corrected} min de hoy sin movimiento asignado dentro de obras que sí tienen movimientos; no se reparten artificialmente.`);
    return report;
  };
  wrapped.__professorNormalized = true;
  core.buildReport = wrapped;
})();

// Planning layer: status Standby/Idea/Confirmed, Exam + Deadline event types,
// movement-level event repertoire and pace-to-deadline context for Professor.
(function loadEventPlanningEnhancements(){
  'use strict';
  if (window.EventPlanning || document.getElementById('eventPlanningEnhancementsScript')) return;
  const script = document.createElement('script');
  script.id = 'eventPlanningEnhancementsScript';
  script.src = './event-planning-enhancements.js?v=1';
  script.async = false;
  document.head.appendChild(script);
})();
