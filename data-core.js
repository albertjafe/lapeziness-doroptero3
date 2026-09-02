(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DataCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function plantKey(p) {
    return (p && (p.obraId || p.tag || '')) + '|' + (p && p.startedAt || '') + '|' + (p && p.endedAt || '');
  }

  function mergePlants(a, b) {
    const out = [], seen = new Set();
    (a || []).concat(b || []).forEach(p => {
      if (!p || !p.startedAt) return;
      const key = p.id || plantKey(p);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(p);
    });
    return out.sort((x, y) => String(x.startedAt).localeCompare(String(y.startedAt)));
  }

  function eventKey(e, fields) {
    if (!e) return '';
    if (e.id) return e.id;
    return fields.map(field => e[field] || '').join('|');
  }

  function mergeEvents(a, b, fields, limit) {
    const out = [], seen = new Set();
    (a || []).concat(b || []).forEach(e => {
      const key = eventKey(e, fields);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(e);
    });
    out.sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
    return limit ? out.slice(-limit) : out;
  }

  function mergePulseDeletedIds(a, b) {
    return Array.from(new Set((a || []).concat(b || []).map(String).filter(Boolean))).slice(-5000);
  }

  function applyPulseDeletedIds(merged) {
    const deleted = new Set(merged.pulseDeletedIds || []);
    const keep = (metric, items) => (items || []).filter(item => {
      const id = eventKey(item, ['at', 'value', 'label']);
      return !deleted.has(metric + '::' + id);
    });
    merged.estadoEventos = keep('concentration', merged.estadoEventos);
    merged.impulsoEventos = keep('impulse', merged.impulsoEventos);
    merged.malestarEventos = keep('discomfort', merged.malestarEventos);
    merged.resistenciaEventos = keep('resistance', merged.resistenciaEventos);
    return merged;
  }

  function itemRealMinutes(item) {
    if (!item || item.estudiado === false) return 0;
    return Number(item.minutosReales ?? item.min ?? item.minutos ?? 0) || 0;
  }

  function sessionRealMinutes(session) {
    return (session && session.items || []).reduce((sum, item) => sum + itemRealMinutes(item), 0);
  }

  function mergeSessions(a, b) {
    const byDay = new Map();
    const add = session => {
      if (!session || !session.date) return;
      const key = new Date(session.date).toDateString();
      const current = byDay.get(key);
      if (!current || sessionRealMinutes(session) > sessionRealMinutes(current) ||
          (sessionRealMinutes(session) === sessionRealMinutes(current) &&
           (session.items || []).length > (current.items || []).length)) {
        byDay.set(key, session);
      }
    };
    (a || []).forEach(add);
    (b || []).forEach(add);
    return Array.from(byDay.values())
      .sort((x, y) => new Date(y.date) - new Date(x.date))
      .slice(0, 365);
  }

  function mergeTimeAvailableEvents(a, b) {
    const byDay = new Map();
    (a || []).concat(b || []).forEach(event => {
      if (!event) return;
      const key = event.date || event.day || (event.at ? new Date(event.at).toDateString() : '');
      if (!key) return;
      const current = byDay.get(key);
      if (!current || String(event.at || '').localeCompare(String(current.at || '')) >= 0) byDay.set(key, event);
    });
    return Array.from(byDay.values())
      .sort((x, y) => String(x.at || x.date || '').localeCompare(String(y.at || y.date || '')))
      .slice(-2000);
  }

  function mergeBlockedDaySchedules(a, b) {
    const byDay = new Map();
    (a || []).concat(b || []).forEach(day => {
      if (!day || !day.date || !Array.isArray(day.blocks)) return;
      const current = byDay.get(day.date);
      if (!current || String(day.updatedAt || '').localeCompare(String(current.updatedAt || '')) >= 0) {
        byDay.set(day.date, day);
      }
    });
    return Array.from(byDay.values())
      .sort((x, y) => String(x.date).localeCompare(String(y.date)))
      .slice(-2000);
  }

  function mergeWeeklyPlan(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    const aUpdated = String(a.updatedAt || a.generatedAt || '');
    const bUpdated = String(b.updatedAt || b.generatedAt || '');
    const newer = aUpdated.localeCompare(bUpdated) >= 0 ? a : b;
    const older = newer === a ? b : a;
    const merged = Object.assign({}, older, newer);
    const slots = new Map();
    const add = (slot, planUpdatedAt) => {
      if (!slot || !slot.date || slot.position == null) return;
      const key = slot.date + '::' + slot.position;
      const current = slots.get(key);
      const currentAt = String(current && (current.updatedAt || current._planUpdatedAt) || '');
      const candidateAt = String(slot.updatedAt || planUpdatedAt || '');
      if (!current || candidateAt.localeCompare(currentAt) >= 0) {
        slots.set(key, Object.assign({}, slot, { _planUpdatedAt: planUpdatedAt || '' }));
      }
    };
    (older.slots || []).forEach(slot => add(slot, older.updatedAt || older.generatedAt));
    (newer.slots || []).forEach(slot => add(slot, newer.updatedAt || newer.generatedAt));
    merged.slots = Array.from(slots.values())
      .map(slot => {
        const clean = Object.assign({}, slot);
        delete clean._planUpdatedAt;
        return clean;
      })
      .sort((x, y) => String(x.date).localeCompare(String(y.date)) || Number(x.position) - Number(y.position));
    return merged;
  }

  function mergeWeeklyPlans(a, b) {
    const byWeek = new Map();
    (a || []).concat(b || []).forEach(plan => {
      if (!plan || !plan.weekStart) return;
      const current = byWeek.get(plan.weekStart);
      byWeek.set(plan.weekStart, current ? mergeWeeklyPlan(current, plan) : plan);
    });
    return Array.from(byWeek.values())
      .sort((x, y) => String(x.weekStart).localeCompare(String(y.weekStart)))
      .slice(-104);
  }

  function mergeMemoryCard(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    const aUpdated = String(a.updatedAt || a.createdAt || '');
    const bUpdated = String(b.updatedAt || b.createdAt || '');
    const newer = aUpdated.localeCompare(bUpdated) >= 0 ? a : b;
    const older = newer === a ? b : a;
    const reviews = new Map();
    (older.reviews || []).concat(newer.reviews || []).forEach(review => {
      if (!review) return;
      const key = review.id || ((review.at || '') + '::' + (review.rating || ''));
      if (key) reviews.set(key, review);
    });
    return Object.assign({}, older, newer, {
      reviews: Array.from(reviews.values())
        .sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')))
        .slice(-300)
    });
  }

  function mergeMemoryCards(a, b) {
    const byId = new Map();
    (a || []).concat(b || []).forEach(card => {
      if (!card || !card.id) return;
      const current = byId.get(card.id);
      byId.set(card.id, current ? mergeMemoryCard(current, card) : card);
    });
    return Array.from(byId.values())
      .sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')))
      .slice(-5000);
  }

  function mergeHabitChallenge(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    const aUpdated = String(a.updatedAt || a.createdAt || '');
    const bUpdated = String(b.updatedAt || b.createdAt || '');
    if (a.id !== b.id) return aUpdated.localeCompare(bUpdated) >= 0 ? a : b;
    const newer = aUpdated.localeCompare(bUpdated) >= 0 ? a : b;
    const older = newer === a ? b : a;
    const merged = Object.assign({}, older, newer);
    const logs = Object.assign({}, older.logs || {});
    Object.entries(newer.logs || {}).forEach(([day, log]) => {
      const current = logs[day];
      if (!current || String(log && log.at || '').localeCompare(String(current && current.at || '')) >= 0) logs[day] = log;
    });
    merged.logs = logs;
    return merged;
  }

  function mergeHabitChallenges(a, b) {
    const map = new Map();
    (a || []).concat(b || []).forEach(habit => {
      if (!habit || !habit.id) return;
      const current = map.get(habit.id);
      map.set(habit.id, current ? mergeHabitChallenge(current, habit) : habit);
    });
    return Array.from(map.values()).sort((x, y) => String(x.createdAt || x.startDate || '').localeCompare(String(y.createdAt || y.startDate || '')));
  }

  // Repertorio biográfico: se sincroniza por ID y gana la edición más reciente.
  // Las horas estimadas viven aquí, separadas de sesiones/minutosExtra.
  function mergeHistoricalRepertoire(a, b) {
    const byId = new Map();
    (a || []).concat(b || []).forEach(entry => {
      if (!entry || !entry.id) return;
      const current = byId.get(entry.id);
      if (!current) {
        byId.set(entry.id, entry);
        return;
      }
      const currentAt = String(current.updatedAt || current.createdAt || '');
      const candidateAt = String(entry.updatedAt || entry.createdAt || '');
      if (candidateAt.localeCompare(currentAt) >= 0) byId.set(entry.id, entry);
    });
    return Array.from(byId.values())
      .sort((x, y) =>
        String(x.composer || '').localeCompare(String(y.composer || '')) ||
        String(x.name || '').localeCompare(String(y.name || ''))
      )
      .slice(-5000);
  }

  function cronoTaskMutationAt(task) {
    if (!task) return '';
    return [task.updatedAt, task.priorityChangedAt, task.doneAt, task.createdAt]
      .map(value => String(value || ''))
      .sort()
      .pop() || '';
  }

  function mergeCronoTasks(a, b) {
    const byId = new Map();
    const add = (task, sourceRank) => {
      if (!task || typeof task !== 'object') return;
      const id = String(task.id || '').trim();
      if (!id) return;
      const current = byId.get(id);
      if (!current) {
        byId.set(id, { task, sourceRank });
        return;
      }
      const currentAt = cronoTaskMutationAt(current.task);
      const candidateAt = cronoTaskMutationAt(task);
      if (candidateAt > currentAt || (candidateAt === currentAt && sourceRank >= current.sourceRank)) {
        byId.set(id, { task: Object.assign({}, current.task, task), sourceRank });
      }
    };
    (a || []).forEach(task => add(task, 0));
    (b || []).forEach(task => add(task, 1));
    return Array.from(byId.values())
      .map(entry => entry.task)
      .sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')) || String(x.id || '').localeCompare(String(y.id || '')))
      .slice(-5000);
  }

  // Las obras no pueden tratarse como un único snapshot opaco. Un dispositivo
  // puede tener una copia nueva del día pero una estructura vieja de una obra.
  // Fusionamos únicamente la estructura que contiene evidencia de estudio para
  // evitar que una reconciliación local borre movimientos, pases o solidez.
  function historyDate(item) {
    return String(item && (item.date || item.at || item.updatedAt || item.createdAt) || '');
  }

  function historyStableKey(item) {
    if (!item || typeof item !== 'object') return '';
    if (item.id) return String(item.id);
    return [
      historyDate(item),
      item.val ?? item.inputVal ?? item.score ?? item.solidezPct ?? item.compas ?? '',
      item.context || item.tipo || item.type || item.key || '',
      item.label || item.note || item.nota || ''
    ].join('|');
  }

  function mergeWorkHistory(a, b, limit) {
    const out = [], seen = new Set();
    (a || []).concat(b || []).forEach(item => {
      const key = historyStableKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    out.sort((x, y) => historyDate(x).localeCompare(historyDate(y)));
    return limit ? out.slice(-limit) : out;
  }

  function movementActivityAt(movement) {
    if (!movement) return '';
    const dates = [movement.updatedAt, movement.correctedAt, movement.lastPase];
    ['solHistory', 'paseHistory', 'zoneHistory', 'compasHistory'].forEach(field => {
      (movement[field] || []).forEach(item => dates.push(historyDate(item)));
    });
    return dates.map(value => String(value || '')).sort().pop() || '';
  }

  function workActivityAt(work) {
    if (!work) return '';
    const dates = [work.updatedAt, work.correctedAt, work.lastPase];
    ['solHistory', 'paseHistory', 'zoneHistory', 'compasHistory'].forEach(field => {
      (work[field] || []).forEach(item => dates.push(historyDate(item)));
    });
    (work.movimientos || []).forEach(movement => dates.push(movementActivityAt(movement)));
    return dates.map(value => String(value || '')).sort().pop() || '';
  }

  function movementHasStudyEvidence(movement, referencedMovements) {
    if (!movement || !movement.id) return false;
    if (referencedMovements && referencedMovements.has(String(movement.id))) return true;
    if (movement.lastPase) return true;
    return ['solHistory', 'paseHistory', 'zoneHistory', 'compasHistory']
      .some(field => Array.isArray(movement[field]) && movement[field].length > 0);
  }

  function mergeMovement(baseMovement, otherMovement) {
    if (!baseMovement) return otherMovement || null;
    if (!otherMovement) return baseMovement;
    const baseAt = movementActivityAt(baseMovement);
    const otherAt = movementActivityAt(otherMovement);
    const newer = otherAt > baseAt ? otherMovement : baseMovement;
    const older = newer === baseMovement ? otherMovement : baseMovement;
    const merged = Object.assign({}, older, newer);
    merged.solHistory = mergeWorkHistory(baseMovement.solHistory, otherMovement.solHistory, 500);
    merged.paseHistory = mergeWorkHistory(baseMovement.paseHistory, otherMovement.paseHistory, 500);
    merged.zoneHistory = mergeWorkHistory(baseMovement.zoneHistory, otherMovement.zoneHistory, 1000);
    merged.compasHistory = mergeWorkHistory(baseMovement.compasHistory, otherMovement.compasHistory, 1000);
    return merged;
  }

  function mergeMovements(baseMovements, otherMovements, referencedMovements) {
    const byId = new Map();
    (baseMovements || []).forEach(movement => {
      if (!movement || !movement.id) return;
      byId.set(String(movement.id), movement);
    });
    (otherMovements || []).forEach(movement => {
      if (!movement || !movement.id) return;
      const id = String(movement.id);
      const current = byId.get(id);
      if (current) {
        byId.set(id, mergeMovement(current, movement));
      } else if (movementHasStudyEvidence(movement, referencedMovements)) {
        byId.set(id, movement);
      }
    });
    return Array.from(byId.values());
  }

  function mergeWork(baseWork, otherWork, referencedMovements) {
    if (!baseWork) return otherWork || null;
    if (!otherWork) return baseWork;
    const baseAt = workActivityAt(baseWork);
    const otherAt = workActivityAt(otherWork);
    const newer = otherAt > baseAt ? otherWork : baseWork;
    const older = newer === baseWork ? otherWork : baseWork;
    const merged = Object.assign({}, older, newer);
    merged.movimientos = mergeMovements(baseWork.movimientos, otherWork.movimientos, referencedMovements);
    merged.solHistory = mergeWorkHistory(baseWork.solHistory, otherWork.solHistory, 500);
    merged.paseHistory = mergeWorkHistory(baseWork.paseHistory, otherWork.paseHistory, 500);
    merged.zoneHistory = mergeWorkHistory(baseWork.zoneHistory, otherWork.zoneHistory, 1000);
    merged.compasHistory = mergeWorkHistory(baseWork.compasHistory, otherWork.compasHistory, 1000);
    return merged;
  }

  function mergeWorks(baseWorks, otherWorks, sessionPlants) {
    const referencedWorks = new Set();
    const referencedMovements = new Set();
    (sessionPlants || []).forEach(plant => {
      if (!plant || plant.failed) return;
      if (plant.obraId) referencedWorks.add(String(plant.obraId));
      if (plant.movId) referencedMovements.add(String(plant.movId));
    });

    const byId = new Map();
    (baseWorks || []).forEach(work => {
      if (!work || !work.id) return;
      byId.set(String(work.id), work);
    });
    (otherWorks || []).forEach(work => {
      if (!work || !work.id) return;
      const id = String(work.id);
      const current = byId.get(id);
      if (current) {
        byId.set(id, mergeWork(current, work, referencedMovements));
      } else if (referencedWorks.has(id)) {
        byId.set(id, work);
      }
    });
    return Array.from(byId.values());
  }

  function mergeStudyHistory(base, other) {
    if (!base) return other;
    if (!other) return base;
    const merged = Object.assign({}, base);
    merged.sessionPlants = mergePlants(base.sessionPlants, other.sessionPlants);
    merged.forestPlants = mergePlants(base.forestPlants, other.forestPlants);
    merged.obras = mergeWorks(base.obras, other.obras, merged.sessionPlants);
    merged.sesiones = mergeSessions(base.sesiones, other.sesiones);
    merged.estadoEventos = mergeEvents(base.estadoEventos, other.estadoEventos, ['at', 'value', 'label'], 2000);
    merged.impulsoEventos = mergeEvents(base.impulsoEventos, other.impulsoEventos, ['at', 'value', 'label'], 2000);
    merged.malestarEventos = mergeEvents(base.malestarEventos, other.malestarEventos, ['at', 'value', 'label'], 2000);
    merged.resistenciaEventos = mergeEvents(base.resistenciaEventos, other.resistenciaEventos, ['at', 'value', 'label'], 2000);
    merged.pulseDeletedIds = mergePulseDeletedIds(base.pulseDeletedIds, other.pulseDeletedIds);
    merged.deporteEventos = mergeEvents(base.deporteEventos, other.deporteEventos, ['at', 'kind', 'value', 'label'], 2000);
    merged.suenoEventos = mergeEvents(base.suenoEventos, other.suenoEventos, ['at', 'kind'], 2000);
    merged.triggerEventos = mergeEvents(base.triggerEventos, other.triggerEventos, ['at', 'value', 'label'], 2000);
    merged.tiempoDisponibleEventos = mergeTimeAvailableEvents(base.tiempoDisponibleEventos, other.tiempoDisponibleEventos);
    merged.dailyJournalEntries = mergeEvents(base.dailyJournalEntries, other.dailyJournalEntries, ['at', 'text'], 3000);
    merged.blockedDaySchedules = mergeBlockedDaySchedules(base.blockedDaySchedules, other.blockedDaySchedules);
    merged.weeklyPlans = mergeWeeklyPlans(base.weeklyPlans, other.weeklyPlans);
    merged.memoryCards = mergeMemoryCards(base.memoryCards, other.memoryCards);
    // Las tareas son datos de usuario aditivos: una nube más reciente nunca debe
    // borrar una tarea creada localmente y aún no subida.
    merged.cronoTasks = mergeCronoTasks(base.cronoTasks, other.cronoTasks);
    merged.historicalRepertoire = mergeHistoricalRepertoire(base.historicalRepertoire, other.historicalRepertoire);
    merged.historicalEvents = mergeHistoricalRepertoire(base.historicalEvents, other.historicalEvents);
    const baseHabits = (base.habitChallenges || []).concat(base.habitChallenge ? [base.habitChallenge] : []);
    const otherHabits = (other.habitChallenges || []).concat(other.habitChallenge ? [other.habitChallenge] : []);
    merged.habitChallenges = mergeHabitChallenges(baseHabits, otherHabits);
    merged.habitChallenge = merged.habitChallenges.find(habit => !habit.deleted) || merged.habitChallenges[0] || null;
    return applyPulseDeletedIds(merged);
  }

  return {
    mergeStudyHistory,
    mergePlants,
    mergeSessions,
    mergeBlockedDaySchedules,
    mergeWeeklyPlan,
    mergeWeeklyPlans,
    mergeMemoryCard,
    mergeMemoryCards,
    mergeCronoTasks,
    cronoTaskMutationAt,
    mergeHabitChallenge,
    mergeHabitChallenges,
    mergeHistoricalRepertoire,
    mergeWorks,
    mergeWork,
    mergeMovements,
    mergeMovement,
    movementActivityAt,
    workActivityAt,
    sessionRealMinutes
  };
});

// Carga modular de la interfaz del archivo histórico. Se deja fuera del factory
// para que los tests Node de DataCore sigan sin depender del DOM.
if (typeof document !== 'undefined' && !document.querySelector('script[data-historical-repertoire]')) {
  const script = document.createElement('script');
  script.src = 'historical-repertoire.js?v=1';
  script.async = true;
  script.dataset.historicalRepertoire = '1';
  document.head.appendChild(script);
}