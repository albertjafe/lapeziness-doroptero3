(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProfessorHandoffResilience = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /* El handoff anterior construía dos prompts: uno enorme para el portapapeles
     y otro abreviado para la URL. En iPad eso podía bloquear el hilo principal.
     V2 construye UNA sola representación densa con TODAS las unidades/eventos. */
  const MAX_URL_ENCODED = 60000;
  const CACHE_MAX_AGE_MS = 90 * 1000;
  const RULES = [
    'cada movimiento es unidad independiente',
    'horas históricas de obra=familiaridad, no solidez actual',
    'horas históricas no asignadas nunca se reparten entre movimientos',
    'solidez debe leerse con antigüedad y confianza/evidencia',
    'prioriza riesgo*urgencia*coste restante evitando enfriar otra unidad crítica',
    'usa estudio de hoy; no reinicies el día',
    'evento sin repertorio enlazado no crea prioridad musical',
    'si falta evidencia expresa incertidumbre; no inventes datos',
    'propón bloques concretos con duración y propósito',
  ].join(';');

  let installed = false;
  let installTimer = null;
  let cachedReport = null;
  let cachedFingerprint = '';
  let cachedAt = 0;
  let prewarmTimer = null;

  const arr = value => Array.isArray(value) ? value : [];
  const val = value => value == null || value === '' ? '-' : String(value);
  const n1 = value => {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '-';
  };
  const clean = value => val(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[|~]/g, '/')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const day = value => {
    if (!value) return '-';
    const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : clean(value);
  };

  function modeInstruction(mode) {
    if (mode === 'remaining') return 'organiza solo lo que queda de HOY desde ahora; no reinicies el día';
    if (mode === 'now') return 'dime qué estudiar AHORA: decisión principal, duración y plan B corto';
    if (mode === 'week') return 'balance de próximos 7 días y distribución estratégica por movimientos';
    return 'organiza HOY de forma realista movimiento por movimiento';
  }

  function dbFingerprint(data) {
    const db = data || {};
    return [
      db._localRevision || 0,
      db._savedAt || '',
      arr(db.obras).length,
      arr(db.eventos).length,
      arr(db.sessionPlants).length,
      arr(db.forestPlants).length,
      arr(db.sesiones).length,
    ].join('|');
  }

  function rememberReport(report, data) {
    if (!report) return report;
    cachedReport = report;
    cachedFingerprint = dbFingerprint(data || database());
    cachedAt = Date.now();
    return report;
  }

  function eventTargetText(event) {
    const targets = event && event.movementTargets;
    if (!targets) return '-';
    if (Array.isArray(targets)) return targets.map(clean).join(',');
    if (typeof targets === 'object') {
      return Object.entries(targets).map(([workId, movements]) =>
        clean(workId) + ':' + arr(movements).map(clean).join(',')
      ).join(';') || '-';
    }
    return clean(targets);
  }

  function denseContext(report) {
    const r = report || {};
    const today = r.today || {};
    const events = arr(r.events);
    const units = arr(r.units);
    const warnings = arr(r.warnings);
    const lines = [];
    const eventIndex = new Map();

    lines.push('PIANO_PROF_V2|' + clean(r.asOf || r.day || ''));
    lines.push('LEYENDA|E=i,dia,dias,fuente,tipo,enlazado,obras,movs,nombre; W=obra,compositor,titulo,histH,noAsignMin,estado; U=clave,mov,nombre,dif,sol,evidEdad,evidTipo,evidDia,ultEst,diasSin,recientes(hoy/3/7/14/30/90/todo),movMin,recH(low/high/fuente/target),prioridad(banda/score/razones),eventos,lastPass,estado');
    lines.push('HOY|' + [n1(today.totalKnownMinutes), n1(today.movementMinutes), n1(today.unallocatedMinutes), n1(today.unitsStudied)].join('|'));
    if (today.byUnit && today.byUnit.length) {
      lines.push('HOY_UNIDADES|' + today.byUnit.map(item => clean(item.key) + '=' + n1(item.minutes)).join(';'));
    }
    if (r.coverage) lines.push('COB|' + clean(JSON.stringify(r.coverage)));
    warnings.forEach((warning, index) => lines.push('A|' + index + '|' + clean(warning)));

    events.forEach((event, index) => {
      eventIndex.set(String(event.key || event.id || index), index);
      lines.push([
        'E', index, day(event.day || event.at), n1(event.daysAway), clean(event.source), clean(event.type),
        event.repertoireLinked ? '1' : '0', arr(event.workIds).map(clean).join(','), eventTargetText(event),
        clean(event.name), clean(event.calendar || '')
      ].join('|'));
    });

    const seenWorks = new Set();
    units.forEach(unit => {
      const workId = clean(unit.obraId || unit.work || unit.key);
      if (!seenWorks.has(workId)) {
        seenWorks.add(workId);
        lines.push([
          'W', workId, clean(unit.composer), clean(unit.work), n1(unit.historicalWorkHours),
          n1(unit.workUnallocatedModernMinutes), clean(unit.workState)
        ].join('|'));
      }
      const recent = unit.recent || {};
      const recovery = unit.recoveryHours || {};
      const priority = unit.priority || {};
      const linked = arr(unit.linkedEvents).map(event => {
        const key = String(event && (event.key || event.id) || '');
        if (eventIndex.has(key)) return eventIndex.get(key);
        const direct = events.indexOf(event);
        return direct >= 0 ? direct : clean(event && event.name);
      }).join(',') || '-';
      const pass = unit.lastPass || {};
      lines.push([
        'U', clean(unit.key), clean(unit.movId || 'FULL'), clean(unit.movement || 'obra completa'),
        n1(unit.difficulty), unit.solidity == null ? '?' : n1(unit.solidity),
        unit.daysSinceEvidence == null ? '?' : n1(unit.daysSinceEvidence), clean(unit.evidenceKind), day(unit.evidenceAt),
        day(unit.lastStudyAt), n1(unit.daysSinceStudy),
        [recent.today, recent.d3, recent.d7, recent.d14, recent.d30, recent.d90, recent.all].map(n1).join('/'),
        n1(unit.movementModernMinutes),
        [recovery.low, recovery.high, recovery.source, recovery.target].map(clean).join('/'),
        [clean(priority.band), n1(priority.score), arr(priority.reasons).map(clean).join(',')].join('/'),
        linked,
        [day(pass.at), pass.score == null ? '-' : n1(pass.score), clean(pass.type)].join('/'),
        clean(unit.movementState)
      ].join('|'));
    });
    return lines.join('\n');
  }

  function buildDensePrompt(report, options, core) {
    const opts = options || {};
    const note = String(opts.note || '').trim();
    const customMaster = String(opts.masterPrompt || '').trim();
    const defaultMaster = String(core && core.DEFAULT_MASTER_PROMPT || '').trim();
    const customRules = customMaster && customMaster !== defaultMaster ? '\nREGLAS_PERSONALES\n' + customMaster : '';
    return [
      'Actúa como profesor de planificación pianística. Recibes un informe denso pero completo; interpreta la leyenda y usa TODAS las filas U/E, no solo las primeras.',
      'REGLAS|' + RULES,
      'TAREA|' + modeInstruction(opts.mode || 'today') + (note ? '|condición_usuario=' + clean(note) : ''),
      customRules,
      denseContext(report),
      'SALIDA|primero plan compacto y accionable; luego solo razones importantes y qué dato cambiaría la decisión'
    ].filter(Boolean).join('\n');
  }

  function withTemporaryChat(url) {
    try {
      if (root && root.ProfessorTemporaryChat && typeof root.ProfessorTemporaryChat.withTemporaryChat === 'function') {
        return root.ProfessorTemporaryChat.withTemporaryChat(url);
      }
    } catch (error) {}
    return url;
  }

  function buildSafeChatGptUrl(report, options, core) {
    const api = core || (root && root.ProfessorCore) || null;
    const prompt = buildDensePrompt(report, options, api);
    const encoded = encodeURIComponent(prompt);
    return {
      url: withTemporaryChat('https://chatgpt.com/?prompt=' + encoded),
      promptForUrl: prompt,
      truncated: false,
      compressed: true,
      encodedLength: encoded.length,
      overAdvisoryLimit: encoded.length > MAX_URL_ENCODED,
      unitCount: arr(report && report.units).length,
      eventCount: arr(report && report.events).length,
    };
  }

  function database() {
    try { return typeof db !== 'undefined' ? db : (root && root.db || null); }
    catch (error) { return root && root.db || null; }
  }

  function optionsFor(mode) {
    const data = database() || {};
    const settings = data.professorSettings && typeof data.professorSettings === 'object' ? data.professorSettings : {};
    const note = root && root.document && root.document.getElementById('professorUserNote')?.value || '';
    const masterPrompt = String(settings.masterPrompt || root?.ProfessorCore?.DEFAULT_MASTER_PROMPT || '');
    return { mode: mode || 'today', note, masterPrompt };
  }

  function toast(message) {
    try { if (root && typeof root.showToast === 'function') root.showToast(message); } catch (error) {}
  }

  function navigatePopup(popup, url) {
    if (!popup) return false;
    try { popup.location.replace(url); return true; }
    catch (error) {
      try { popup.location.href = url; return true; }
      catch (secondError) { return false; }
    }
  }

  function freshCachedReport(data) {
    if (!cachedReport) return null;
    if (Date.now() - cachedAt > CACHE_MAX_AGE_MS) return null;
    return cachedFingerprint === dbFingerprint(data) ? cachedReport : null;
  }

  function reportForHandoff(data) {
    const cached = freshCachedReport(data);
    if (cached) return cached;
    if (!root || !root.ProfessorCore || typeof root.ProfessorCore.buildReport !== 'function') return null;
    return rememberReport(root.ProfessorCore.buildReport(data, { asOf: new Date() }), data);
  }

  function openSafe(mode) {
    if (!root || !root.ProfessorCore) return;
    let popup = null;
    try {
      popup = root.open('about:blank', '_blank');
      if (popup) popup.opener = null;
    } catch (error) {}

    toast('Abriendo Profesor…');
    root.setTimeout(() => {
      try {
        const data = database() || {};
        const report = reportForHandoff(data);
        if (!report) throw new Error('Professor report unavailable');
        const built = buildSafeChatGptUrl(report, optionsFor(mode), root.ProfessorCore);
        if (!popup || !navigatePopup(popup, built.url)) {
          toast('El navegador bloqueó la nueva pestaña');
          return;
        }
        toast('ChatGPT abierto · contexto completo ' + built.unitCount + ' unidades / ' + built.eventCount + ' eventos');
      } catch (error) {
        try { if (popup && !popup.closed) popup.close(); } catch (closeError) {}
        toast('No se pudo abrir el Profesor · vuelve a intentarlo');
        console.error('[professor-handoff] fallo al preparar ChatGPT', error);
      }
    }, 0);
  }

  function patchReportCache() {
    const core = root && root.ProfessorCore;
    if (!core || typeof core.buildReport !== 'function') return false;
    if (core.buildReport.__professorHandoffCached) return true;
    const original = core.buildReport;
    const wrapped = function cachedProfessorReport(data) {
      const result = original.apply(this, arguments);
      return rememberReport(result, data);
    };
    wrapped.__professorHandoffCached = true;
    wrapped.__original = original;
    core.buildReport = wrapped;
    return true;
  }

  function schedulePrewarm() {
    if (!root || !root.ProfessorCore || prewarmTimer) return;
    const run = () => {
      prewarmTimer = null;
      try {
        const data = database() || {};
        if (!freshCachedReport(data)) reportForHandoff(data);
      } catch (error) {}
    };
    if (typeof root.requestIdleCallback === 'function') {
      prewarmTimer = root.requestIdleCallback(run, { timeout: 1600 });
    } else {
      prewarmTimer = root.setTimeout(run, 350);
    }
  }

  function patchCore() {
    const core = root && root.ProfessorCore;
    if (!core || typeof core.buildReport !== 'function') return false;
    patchReportCache();
    const safe = function responsiveBuildChatGptUrl(report, options) {
      return buildSafeChatGptUrl(report, options, core);
    };
    safe.__responsiveProfessorHandoff = true;
    core.buildChatGptUrl = safe;
    root.openProfessorInChatGPT = openSafe;
    schedulePrewarm();
    return true;
  }

  function installCapture() {
    if (!root || !root.document || root.document.__responsiveProfessorHandoffV2) return true;
    root.document.addEventListener('click', event => {
      const button = event.target && event.target.closest && event.target.closest('[data-prof-mode]');
      if (!button || !button.closest('#view-profesor')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openSafe(button.dataset.profMode);
    }, true);
    root.document.__responsiveProfessorHandoffV2 = true;
    return true;
  }

  function install() {
    if (!root || !root.document) return false;
    const coreReady = patchCore();
    installCapture();
    installed = installed || coreReady;
    return coreReady;
  }

  function boot() {
    install();
    let attempts = 0;
    clearInterval(installTimer);
    installTimer = setInterval(() => {
      attempts += 1;
      if (install() || attempts > 80) clearInterval(installTimer);
    }, 150);
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  return {
    MAX_URL_ENCODED,
    denseContext,
    buildDensePrompt,
    buildSafeChatGptUrl,
    openSafe,
    install,
    isInstalled: () => installed,
  };
});
