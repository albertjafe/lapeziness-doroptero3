/* Competition / event planning layer.
 * Adds standby states, Exam/Deadline types, movement-level targets and
 * Professor pace context without rewriting the legacy calendar implementation.
 */
(function eventPlanningEnhancements(root) {
  'use strict';
  if (root.EventPlanning && root.EventPlanning.version === 1) return;

  const STATUS = {
    confirmado: { label: 'Confirmado', hint: 'Compromiso real' },
    standby: { label: 'Standby', hint: 'Plan probable, aún no confirmado' },
    idea: { label: 'Idea', hint: 'Posibilidad a vigilar' },
  };
  const ROLE = {
    event: 'Evento principal',
    competition: 'Concurso',
    video_deadline: 'Deadline de vídeo',
    application_deadline: 'Deadline de inscripción',
    exam: 'Examen',
    recording: 'Grabación',
  };
  const arr = value => Array.isArray(value) ? value : [];
  const id = value => value == null ? '' : String(value);
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const nowIso = () => new Date().toISOString();
  const safeDb = () => { try { return typeof db !== 'undefined' ? db : null; } catch (_) { return null; } };
  let modalDraft = { status: 'confirmado', role: 'event', movements: {} };

  function loadCss() {
    if (document.getElementById('eventPlanningCss')) return;
    const link = document.createElement('link');
    link.id = 'eventPlanningCss';
    link.rel = 'stylesheet';
    link.href = './event-planning-enhancements.css?v=1';
    document.head.appendChild(link);
  }

  function ensureTypeButton(type, label, beforeType) {
    const host = document.getElementById('eventoTipoSelector');
    if (!host || host.querySelector('.evento-tipo-btn.' + type)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'evento-tipo-btn ' + type;
    button.textContent = label;
    button.onclick = function () { if (typeof root.selectEventoTipo === 'function') root.selectEventoTipo(type, button); };
    const before = beforeType && host.querySelector('.evento-tipo-btn.' + beforeType);
    if (before) host.insertBefore(button, before); else host.appendChild(button);
  }

  function ensurePlanningFields() {
    const modal = document.querySelector('#modalAddEvento .evento-modal');
    const typeHost = document.getElementById('eventoTipoSelector');
    const works = document.getElementById('obraCheckList');
    if (!modal || !typeHost || !works) return false;
    ensureTypeButton('examen', 'Examen', 'grabacion');
    ensureTypeButton('deadline', 'Deadline', null);

    if (!document.getElementById('eventoPlanningMeta')) {
      const section = document.createElement('section');
      section.id = 'eventoPlanningMeta';
      section.className = 'evento-planning-meta';
      section.innerHTML =
        '<div class="evento-planning-grid">' +
          '<div><div class="evento-form-label">Estado</div><div class="evento-status-selector" id="eventoStatusSelector">' +
            Object.entries(STATUS).map(([key, item]) => '<button type="button" data-event-status="' + key + '"><strong>' + item.label + '</strong><small>' + item.hint + '</small></button>').join('') +
          '</div></div>' +
          '<label class="evento-planning-role"><span class="evento-form-label">Función para el Profesor</span><select class="modal-input" id="eventoPlanningRole">' +
            Object.entries(ROLE).map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join('') +
          '</select></label>' +
        '</div>' +
        '<div class="evento-source-card" id="eventoPlanningSource" hidden></div>' +
        '<label class="evento-planning-notes"><span class="evento-form-label">Contexto / notas</span><textarea class="modal-input" id="eventoPlanningNotes" rows="3" placeholder="Qué tengo que preparar, condiciones, dudas, instrucciones del profesor…"></textarea></label>';
      typeHost.insertAdjacentElement('afterend', section);
      section.querySelectorAll('[data-event-status]').forEach(button => button.addEventListener('click', () => setStatus(button.dataset.eventStatus)));
      document.getElementById('eventoPlanningRole').addEventListener('change', event => { modalDraft.role = event.target.value || 'event'; });
    }

    if (!document.getElementById('eventoMovementTargets')) {
      const section = document.createElement('section');
      section.id = 'eventoMovementTargets';
      section.className = 'evento-movement-targets';
      section.innerHTML = '<div class="evento-movement-head"><div><div class="evento-form-label">Detalle por movimiento</div><p>Para el Profesor, cada movimiento cuenta como una unidad independiente.</p></div><span id="eventoMovementCount">0</span></div><div id="eventoMovementTargetsList"></div>';
      works.insertAdjacentElement('afterend', section);
      works.addEventListener('change', () => renderMovementTargets());
    }
    return true;
  }

  function setStatus(status) {
    modalDraft.status = STATUS[status] ? status : 'confirmado';
    document.querySelectorAll('#eventoStatusSelector [data-event-status]').forEach(button => {
      const active = button.dataset.eventStatus === modalDraft.status;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function selectedWorkIds() {
    const host = document.getElementById('obraCheckList');
    if (!host) return [];
    return Array.from(host.querySelectorAll('input[type="checkbox"]:checked')).map(input => id(input.value || input.dataset.obraId)).filter(Boolean);
  }

  function ensureWorkSelected(workId) {
    const host = document.getElementById('obraCheckList');
    if (!host) return;
    const checkbox = Array.from(host.querySelectorAll('input[type="checkbox"]')).find(input => id(input.value || input.dataset.obraId) === id(workId));
    if (checkbox && !checkbox.checked) checkbox.checked = true;
  }

  function cleanMovementDraft() {
    const database = safeDb();
    const valid = {};
    if (!database) return valid;
    Object.entries(modalDraft.movements || {}).forEach(([workId, movementIds]) => {
      const work = arr(database.obras).find(item => id(item && item.id) === id(workId));
      if (!work) return;
      const allowed = new Set(arr(work.movimientos).map(movement => id(movement.id)));
      const list = arr(movementIds).map(id).filter(movementId => allowed.has(movementId));
      if (list.length) valid[id(workId)] = Array.from(new Set(list));
    });
    modalDraft.movements = valid;
    return valid;
  }

  function renderMovementTargets() {
    const host = document.getElementById('eventoMovementTargetsList');
    const count = document.getElementById('eventoMovementCount');
    const database = safeDb();
    if (!host || !database) return;
    cleanMovementDraft();
    const selected = new Set(selectedWorkIds());
    const candidateWorks = arr(database.obras).filter(work => selected.has(id(work.id)) && arr(work.movimientos).length);
    if (!candidateWorks.length) {
      host.innerHTML = '<div class="evento-movement-empty">Selecciona arriba una obra con movimientos para afinar qué entra realmente.</div>';
      if (count) count.textContent = '0';
      return;
    }
    let total = 0;
    host.innerHTML = candidateWorks.map(work => {
      const chosen = new Set(arr(modalDraft.movements[id(work.id)]).map(id));
      total += chosen.size;
      const chips = arr(work.movimientos).map(movement => {
        const active = chosen.has(id(movement.id));
        return '<button type="button" class="evento-movement-chip' + (active ? ' active' : '') + '" data-work="' + id(work.id) + '" data-movement="' + id(movement.id) + '"><span>' + escapeHtml(movement.name || 'Movimiento') + '</span><i>' + (active ? 'incluido' : 'obra completa') + '</i></button>';
      }).join('');
      return '<div class="evento-movement-group"><strong>' + escapeHtml(work.composer ? work.composer + ' · ' + work.name : work.name) + '</strong><div class="evento-movement-chips">' + chips + '</div></div>';
    }).join('');
    host.querySelectorAll('[data-movement]').forEach(button => button.addEventListener('click', () => {
      const workId = id(button.dataset.work), movementId = id(button.dataset.movement);
      const current = new Set(arr(modalDraft.movements[workId]).map(id));
      if (current.has(movementId)) current.delete(movementId); else current.add(movementId);
      if (current.size) modalDraft.movements[workId] = Array.from(current); else delete modalDraft.movements[workId];
      ensureWorkSelected(workId);
      renderMovementTargets();
    }));
    if (count) count.textContent = total ? total + ' mov.' : 'obra completa';
  }

  function sourceHtml(event) {
    if (!event || !(event.sourceFile || event.sourceUrl || event.videoRequirements || event.competitionStart)) return '';
    const bits = [];
    if (event.eventRole === 'video_deadline' && event.videoRequirements) bits.push('<strong>Vídeo:</strong> ' + escapeHtml(event.videoRequirements));
    if (event.competitionStart) bits.push('<strong>Concurso:</strong> ' + escapeHtml(formatDateRange(event.competitionStart, event.competitionEnd)));
    if (event.sourceFile) bits.push('<strong>Fuente:</strong> ' + escapeHtml(event.sourceFile));
    return bits.join('<br>');
  }

  function populatePlanningFields(event) {
    ensurePlanningFields();
    modalDraft = {
      status: event && (event.planningStatus || event.estado) || 'confirmado',
      role: event && event.eventRole || ((event && event.tipo === 'examen') ? 'exam' : (event && event.tipo === 'grabacion') ? 'recording' : (event && event.tipo === 'concurso') ? 'competition' : 'event'),
      movements: JSON.parse(JSON.stringify(event && (event.professorMovements || event.movimientosObjetivo) || {})),
    };
    setStatus(modalDraft.status);
    const role = document.getElementById('eventoPlanningRole');
    if (role) role.value = modalDraft.role;
    const notes = document.getElementById('eventoPlanningNotes');
    if (notes) notes.value = event && (event.planningNotes || event.notes || '') || '';
    const source = document.getElementById('eventoPlanningSource');
    const html = sourceHtml(event);
    if (source) { source.hidden = !html; source.innerHTML = html; }
    requestAnimationFrame(renderMovementTargets);
  }

  function readPlanningExtras() {
    cleanMovementDraft();
    const role = document.getElementById('eventoPlanningRole');
    const notes = document.getElementById('eventoPlanningNotes');
    return {
      planningStatus: modalDraft.status || 'confirmado',
      estado: modalDraft.status || 'confirmado',
      eventRole: role && role.value || modalDraft.role || 'event',
      planningNotes: notes && notes.value.trim() || '',
      professorMovements: JSON.parse(JSON.stringify(modalDraft.movements || {})),
      updatedAt: nowIso(),
    };
  }

  function syncCompetitionPlan(event) {
    const database = safeDb();
    if (!database || !event || !event.competitionPlanId) return;
    database.competitionPlans = arr(database.competitionPlans);
    const plan = database.competitionPlans.find(item => id(item.id) === id(event.competitionPlanId));
    if (!plan) return;
    plan.status = event.planningStatus || event.estado || plan.status || 'standby';
    plan.updatedAt = event.updatedAt || nowIso();
    if (event.eventRole === 'competition') {
      plan.name = event.nombre || plan.name;
      plan.competitionStart = event.fecha || plan.competitionStart;
      plan.competitionEnd = event.fechaFin || plan.competitionEnd;
      plan.repertoireWorkIds = arr(event.obras).map(id);
      plan.professorMovements = event.professorMovements || {};
      plan.repertoirePending = !arr(event.obras).length;
    } else if (/deadline/.test(event.eventRole || '')) {
      plan.deadline = event.fecha || plan.deadline;
      plan.videoWorkIds = arr(event.obras).map(id);
      plan.videoMovements = event.professorMovements || {};
      if (event.videoRequirements) plan.videoRequirements = event.videoRequirements;
    }
  }

  function wrapModalFunctions() {
    if (typeof root.openAddEvento === 'function' && !root.openAddEvento.__planningWrapped) {
      const original = root.openAddEvento;
      const wrapped = function () {
        const result = original.apply(this, arguments);
        requestAnimationFrame(() => populatePlanningFields(null));
        return result;
      };
      wrapped.__planningWrapped = true;
      root.openAddEvento = wrapped;
    }
    if (typeof root.openEditEvento === 'function' && !root.openEditEvento.__planningWrapped) {
      const original = root.openEditEvento;
      const wrapped = function (eventId) {
        const result = original.apply(this, arguments);
        const database = safeDb();
        const event = database && arr(database.eventos).find(item => id(item.id) === id(eventId));
        requestAnimationFrame(() => populatePlanningFields(event));
        return result;
      };
      wrapped.__planningWrapped = true;
      root.openEditEvento = wrapped;
    }
    if (typeof root.saveEvento === 'function' && !root.saveEvento.__planningWrapped) {
      const original = root.saveEvento;
      const wrapped = function () {
        ensurePlanningFields();
        const database = safeDb();
        const editId = id(document.getElementById('eventoEditId') && document.getElementById('eventoEditId').value);
        const beforeLength = database ? arr(database.eventos).length : 0;
        const extras = readPlanningExtras();
        const result = original.apply(this, arguments);
        const overlay = document.getElementById('modalAddEvento');
        if (overlay && overlay.classList.contains('visible')) return result;
        if (!database) return result;
        let event = editId ? arr(database.eventos).find(item => id(item.id) === editId) : null;
        if (!event && arr(database.eventos).length > beforeLength) event = database.eventos[database.eventos.length - 1];
        if (!event) return result;
        Object.assign(event, extras);
        Object.keys(extras.professorMovements || {}).forEach(workId => {
          event.obras = arr(event.obras);
          if (!event.obras.map(id).includes(id(workId))) event.obras.push(workId);
        });
        event.repertoirePending = !arr(event.obras).length;
        if (event.eventRole === 'video_deadline') event.tipo = 'deadline';
        if (event.tipo === 'examen') event.eventRole = 'exam';
        syncCompetitionPlan(event);
        if (typeof root.saveData === 'function') root.saveData();
        decorateCalendar();
        return result;
      };
      wrapped.__planningWrapped = true;
      root.saveEvento = wrapped;
    }
    if (typeof root.deleteEvento === 'function' && !root.deleteEvento.__planningWrapped) {
      const original = root.deleteEvento;
      const wrapped = function (eventId) {
        const database = safeDb();
        const event = database && arr(database.eventos).find(item => id(item.id) === id(eventId));
        if (!event || event.planningProtected !== true) return original.apply(this, arguments);
        const date = event.fecha ? new Date(event.fecha + 'T12:00:00').toLocaleDateString('es-ES') : '';
        if (!root.confirm('¿Eliminar "' + (event.nombre || 'evento') + '"' + (date ? ' del ' + date : '') + '?')) return;
        database.planningEventTombstones = Array.from(new Set(arr(database.planningEventTombstones).map(id).concat(id(eventId)))).slice(-1000);
        database.eventos = arr(database.eventos).filter(item => id(item.id) !== id(eventId));
        if (event.competitionPlanId && event.eventRole === 'competition') {
          const plan = arr(database.competitionPlans).find(item => id(item.id) === id(event.competitionPlanId));
          if (plan) { plan.status = 'descartado'; plan.updatedAt = nowIso(); }
        }
        if (typeof root.saveData === 'function') root.saveData();
        if (typeof root.renderCalendario === 'function') root.renderCalendario();
        if (typeof root.renderCronoCalendar === 'function') root.renderCronoCalendar();
        if (typeof root.updateHeader === 'function') root.updateHeader();
        if (typeof root.showToast === 'function') root.showToast('Evento eliminado');
      };
      wrapped.__planningWrapped = true;
      root.deleteEvento = wrapped;
    }
  }

  function eventMutationAt(event) {
    return [event && event.updatedAt, event && event.completedDate, event && event.createdAt].map(value => String(value || '')).sort().pop() || '';
  }

  function mergePlanningById(a, b, tombstones, protectedOnly) {
    const tomb = new Set(arr(tombstones).map(id));
    const map = new Map();
    const add = (item, rank) => {
      if (!item || !item.id || tomb.has(id(item.id))) return;
      if (protectedOnly && item.planningProtected !== true) return;
      const key = id(item.id), current = map.get(key);
      if (!current) { map.set(key, { item, rank }); return; }
      const aAt = eventMutationAt(current.item), bAt = eventMutationAt(item);
      if (bAt > aAt || (bAt === aAt && rank >= current.rank)) map.set(key, { item: Object.assign({}, current.item, item), rank });
    };
    arr(a).forEach(item => add(item, 0)); arr(b).forEach(item => add(item, 1));
    return Array.from(map.values()).map(entry => entry.item);
  }

  function wrapDataCoreMerge() {
    const core = root.DataCore;
    if (!core || typeof core.mergeStudyHistory !== 'function' || core.mergeStudyHistory.__planningWrapped) return;
    const original = core.mergeStudyHistory;
    const wrapped = function (base, other) {
      const merged = original.apply(this, arguments);
      if (!merged) return merged;
      const eventTombstones = Array.from(new Set(arr(base && base.planningEventTombstones).concat(arr(other && other.planningEventTombstones)).map(id))).slice(-1000);
      const planTombstones = Array.from(new Set(arr(base && base.competitionPlanTombstones).concat(arr(other && other.competitionPlanTombstones)).map(id))).slice(-1000);
      merged.planningEventTombstones = eventTombstones;
      merged.competitionPlanTombstones = planTombstones;
      const ordinary = arr(merged.eventos).filter(item => item && item.planningProtected !== true);
      const protectedEvents = mergePlanningById(base && base.eventos, other && other.eventos, eventTombstones, true);
      merged.eventos = ordinary.concat(protectedEvents);
      merged.competitionPlans = mergePlanningById(base && base.competitionPlans, other && other.competitionPlans, planTombstones, false);
      return merged;
    };
    wrapped.__planningWrapped = true;
    core.mergeStudyHistory = wrapped;
  }

  function score(item) {
    let value = item && (item.inputVal ?? item.val ?? item.solidezPct ?? item.solidityPct ?? item.sol ?? item.score);
    value = Number(value);
    if (!Number.isFinite(value)) return null;
    if (value >= 0 && value <= 10) value *= 10;
    return Math.max(0, Math.min(100, value));
  }

  function progressVelocity(database, unit) {
    const work = arr(database && database.obras).find(item => id(item && item.id) === id(unit.obraId));
    const entity = unit.movId && work ? arr(work.movimientos).find(item => id(item.id) === id(unit.movId)) : work;
    if (!entity) return null;
    const observations = [];
    arr(entity.solHistory).forEach(point => observations.push({ at: new Date(point.date || point.at || 0), score: score(point) }));
    arr(entity.paseHistory).forEach(point => observations.push({ at: new Date(point.date || point.at || 0), score: score(point) }));
    const valid = observations.filter(point => Number.isFinite(point.at.getTime()) && point.score != null).sort((a,b) => a.at-b.at);
    if (valid.length < 2) return { evidencePairs: 0, pointsPerHour: null, delta: null, minutesBetween: null };
    const to = valid[valid.length - 1];
    let from = null;
    for (let i = valid.length - 2; i >= 0; i--) {
      if (to.at - valid[i].at >= 12 * 60 * 60 * 1000) { from = valid[i]; break; }
    }
    if (!from) from = valid[valid.length - 2];
    const minutes = arr(database.sessionPlants).reduce((sum, plant) => {
      if (id(plant.obraId) !== id(unit.obraId)) return sum;
      if (unit.movId && id(plant.movId) !== id(unit.movId)) return sum;
      if (!unit.movId && plant.movId) return sum;
      const at = new Date(plant.endedAt || plant.startedAt || 0);
      if (!Number.isFinite(at.getTime()) || at <= from.at || at > to.at) return sum;
      return sum + Math.max(0, num(plant.mins ?? plant.min ?? plant.minutes));
    }, 0);
    const delta = to.score - from.score;
    const pointsPerHour = minutes >= 15 ? Math.round((delta / (minutes / 60)) * 100) / 100 : null;
    return { evidencePairs: valid.length - 1, from: from.at.toISOString(), to: to.at.toISOString(), delta: Math.round(delta * 10) / 10, minutesBetween: Math.round(minutes * 10) / 10, pointsPerHour };
  }

  function enrichProfessorReport(report, database) {
    if (!report || !database) return report;
    const rawEvents = new Map(arr(database.eventos).map(event => [id(event.id), event]));
    arr(report.events).forEach(event => {
      if (event.source !== 'app' || !event.id) return;
      const raw = rawEvents.get(id(event.id)); if (!raw) return;
      event.status = raw.planningStatus || raw.estado || 'confirmado';
      event.role = raw.eventRole || 'event';
      event.competitionPlanId = raw.competitionPlanId || null;
      event.competitionStart = raw.competitionStart || null;
      event.competitionEnd = raw.competitionEnd || null;
      event.videoRequirements = raw.videoRequirements || null;
      event.notes = raw.planningNotes || raw.notes || null;
      event.repertoirePending = raw.repertoirePending === true || !arr(raw.obras).length;
    });
    arr(report.units).forEach(unit => {
      const event = unit.nextEvent && unit.nextEvent.id ? rawEvents.get(id(unit.nextEvent.id)) : null;
      if (unit.nextEvent && event) {
        unit.nextEvent.status = event.planningStatus || event.estado || 'confirmado';
        unit.nextEvent.role = event.eventRole || 'event';
        unit.nextEvent.videoRequirements = event.videoRequirements || null;
      }
      const days = Math.max(1, num(unit.nextEvent && unit.nextEvent.daysAway, 0));
      const requiredDaily = unit.nextEvent ? Math.round((Math.max(0, num(unit.recoveryHours && unit.recoveryHours.high)) * 60 / days) * 10) / 10 : 0;
      const currentDaily = Math.round((num(unit.recent && unit.recent.d7) / 7) * 10) / 10;
      const ratio = requiredDaily > 0 ? Math.round((currentDaily / requiredDaily) * 100) / 100 : null;
      unit.pace = {
        requiredDailyMinutes: requiredDaily,
        currentDaily7dMinutes: currentDaily,
        ratio,
        status: ratio == null ? 'sin_objetivo' : ratio >= 1.15 ? 'por_delante' : ratio >= 0.85 ? 'en_ritmo' : 'por_debajo',
        planningWeight: event && (event.planningStatus || event.estado) === 'standby' ? 0.7 : 1,
      };
      unit.learningVelocity = progressVelocity(database, unit);
    });
    report.competitionPlans = arr(database.competitionPlans).filter(plan => plan && plan.status !== 'descartado').map(plan => ({
      id: plan.id, name: plan.name, status: plan.status || 'standby', competitionStart: plan.competitionStart || null,
      competitionEnd: plan.competitionEnd || null, dateText: plan.dateText || null, deadline: plan.deadline || null,
      deadlineText: plan.deadlineText || null, videoRequirements: plan.videoRequirements || null,
      repertoireSummary: plan.repertoireSummary || null, repertoireWorkIds: arr(plan.repertoireWorkIds),
      professorMovements: plan.professorMovements || {}, videoWorkIds: arr(plan.videoWorkIds), videoMovements: plan.videoMovements || {},
      repertoirePending: plan.repertoirePending !== false && !arr(plan.repertoireWorkIds).length,
    }));
    return report;
  }

  function wrapProfessor() {
    const core = root.ProfessorCore;
    if (!core || typeof core.buildReport !== 'function' || core.buildReport.__eventPlanningWrapped) return false;
    const originalBuild = core.buildReport;
    const wrappedBuild = function (database) {
      const report = originalBuild.apply(this, arguments);
      return enrichProfessorReport(report, database || safeDb() || {});
    };
    wrappedBuild.__eventPlanningWrapped = true;
    core.buildReport = wrappedBuild;

    if (typeof core.compactContext === 'function' && !core.compactContext.__eventPlanningWrapped) {
      const originalCompact = core.compactContext;
      const compact = function (report) {
        let text = originalCompact.apply(this, arguments);
        const plans = arr(report && report.competitionPlans);
        if (plans.length) {
          text += '\n\nPLANES_CONCURSOS_STANDBY\n' + plans.map(plan => [plan.name, 'estado=' + plan.status, 'concurso=' + (plan.competitionStart || plan.dateText || 'TBA'), 'deadline=' + (plan.deadline || plan.deadlineText || 'TBA'), 'repertorio=' + (plan.repertoirePending ? 'PENDIENTE' : arr(plan.repertoireWorkIds).join(',')), plan.videoRequirements ? 'video=' + plan.videoRequirements : ''].filter(Boolean).join('|')).join('\n');
        }
        const paceLines = arr(report && report.units).filter(unit => unit.nextEvent).slice(0, 20).map(unit => unit.key + '|ritmo7d=' + unit.pace.currentDaily7dMinutes + 'm/d|necesario≈' + unit.pace.requiredDailyMinutes + 'm/d|' + unit.pace.status + '|vel=' + (unit.learningVelocity && unit.learningVelocity.pointsPerHour != null ? unit.learningVelocity.pointsPerHour + 'pts/h' : '?'));
        if (paceLines.length) text += '\n\nRITMO_HACIA_EVENTOS\n' + paceLines.join('\n');
        return text;
      };
      compact.__eventPlanningWrapped = true;
      core.compactContext = compact;
    }
    return true;
  }

  function decorateCalendar() {
    const database = safeDb(); if (!database) return;
    const events = new Map(arr(database.eventos).map(event => [id(event.id), event]));
    document.querySelectorAll('[data-event-id]').forEach(node => {
      const event = events.get(id(node.dataset.eventId)); if (!event) return;
      const status = event.planningStatus || event.estado;
      node.dataset.planningStatus = status || 'confirmado';
      node.dataset.eventTypeEnhanced = event.tipo || '';
      if (status === 'standby' && !node.dataset.standbyDecorated) {
        node.dataset.standbyDecorated = '1';
        node.title = (node.title || event.nombre || 'Evento') + ' · standby';
      }
    });
  }

  function wrapCalendarRenders() {
    ['renderCalendario','renderCronoCalendar','renderMesCalendario'].forEach(name => {
      const original = root[name];
      if (typeof original !== 'function' || original.__planningWrapped) return;
      const wrapped = function () { const result = original.apply(this, arguments); requestAnimationFrame(decorateCalendar); return result; };
      wrapped.__planningWrapped = true; root[name] = wrapped;
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
  }
  function formatDateRange(start, end) {
    const fmt = value => { const date = new Date(value + (String(value).length === 10 ? 'T12:00:00' : '')); return Number.isFinite(date.getTime()) ? date.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'}) : value; };
    if (!end || end === start) return fmt(start); return fmt(start) + ' – ' + fmt(end);
  }

  function boot() {
    loadCss();
    ensurePlanningFields();
    wrapModalFunctions();
    wrapDataCoreMerge();
    wrapCalendarRenders();
    wrapProfessor();
    decorateCalendar();
    const observer = new MutationObserver(() => { ensurePlanningFields(); decorateCalendar(); if (!root.ProfessorCore || !root.ProfessorCore.buildReport.__eventPlanningWrapped) wrapProfessor(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  root.EventPlanning = { version: 1, enrichProfessorReport, renderMovementTargets, setStatus };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})(window);
