/* Seguimiento de pasajes difíciles dentro del cronómetro.
   En una obra concreta solo se muestran sus pasajes. En General se muestran
   todos y el tiempo activado se redistribuye a su obra sin duplicar el total. */
(function passageTrackerFeature() {
  'use strict';

  const TRACKER_KEY = 'passageTracker';
  const MIRROR_KEY = 'alberto_passage_tracker_v1';
  const VERSION = 3;
  const TICK_MS = 200;
  const SCORE_SETTLE_MS = 5000;
  const GENERAL_ALLOCATION_SOURCE = 'passage-general-v1';

  let draft = null;
  let activePassageId = null;
  let activeChunkStartedAt = 0;
  let activeChunkIso = null;
  let lastTargetKey = '';
  let lastCronoState = '';
  let editingPassageId = null;
  let ratingPassageId = null;
  let ratingMode = 'cold';
  let reconcileBusy = false;
  let learningCurveOpen = false;
  let learningCurveSelection = 'work';
  const pendingScores = new Map();

  function appDb() {
    try { return typeof db !== 'undefined' ? db : null; } catch (error) { return null; }
  }

  function cronoState() {
    try { return typeof crono !== 'undefined' ? crono : null; } catch (error) { return null; }
  }

  function nowIso() { return new Date().toISOString(); }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function idEqual(a, b) { return String(a ?? '') === String(b ?? ''); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
  function normalized(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }

  function parseTime(value) {
    const t = Date.parse(value || '');
    return Number.isFinite(t) ? t : 0;
  }

  function trackerShape(value) {
    const src = value && typeof value === 'object' ? value : {};
    return {
      ...src,
      version: Math.max(VERSION, Number(src.version) || 0),
      passages: Array.isArray(src.passages) ? src.passages.filter(Boolean).map(item => ({ ...item })) : [],
      observations: Array.isArray(src.observations) ? src.observations.filter(Boolean).map(item => ({ ...item })) : [],
      updatedAt: src.updatedAt || null,
    };
  }

  function newerRecord(a, b) {
    if (!a) return b;
    if (!b) return a;
    const at = Math.max(parseTime(a.updatedAt), parseTime(a.deletedAt), parseTime(a.createdAt));
    const bt = Math.max(parseTime(b.updatedAt), parseTime(b.deletedAt), parseTime(b.createdAt));
    return bt >= at ? b : a;
  }

  function mergeTrackers(left, right) {
    const a = trackerShape(left);
    const b = trackerShape(right);
    if (window.DocumentSyncCore) return trackerShape({ ...window.DocumentSyncCore.merge(a, b), version: Math.max(a.version, b.version) });
    const passages = new Map();
    a.passages.forEach(item => { if (item.id) passages.set(String(item.id), item); });
    b.passages.forEach(item => {
      if (!item.id) return;
      const key = String(item.id);
      passages.set(key, newerRecord(passages.get(key), item));
    });

    const observations = new Map();
    a.observations.forEach(item => { if (item.id) observations.set(String(item.id), item); });
    b.observations.forEach(item => {
      if (!item.id) return;
      const key = String(item.id);
      const previous = observations.get(key);
      observations.set(key, !previous || parseTime(item.recordedAt) >= parseTime(previous.recordedAt) ? item : previous);
    });

    return {
      ...a, ...b,
      version: Math.max(a.version, b.version),
      passages: Array.from(passages.values()).sort((x, y) => parseTime(x.createdAt) - parseTime(y.createdAt)),
      observations: Array.from(observations.values()).sort((x, y) => parseTime(x.recordedAt) - parseTime(y.recordedAt)),
      updatedAt: parseTime(a.updatedAt) >= parseTime(b.updatedAt) ? a.updatedAt : b.updatedAt,
    };
  }

  function readMirror() {
    try { return trackerShape(JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null')); }
    catch (error) { return trackerShape(null); }
  }

  function writeMirror(value) {
    try { localStorage.setItem(MIRROR_KEY, JSON.stringify(trackerShape(value))); } catch (error) {}
  }

  function ensureTracker() {
    const database = appDb();
    if (!database) return trackerShape(null);
    let tracker = database[TRACKER_KEY];
    if (!tracker || typeof tracker !== 'object' || Array.isArray(tracker)) tracker = database[TRACKER_KEY] = trackerShape(null);
    if (!Array.isArray(tracker.passages)) tracker.passages = [];
    if (!Array.isArray(tracker.observations)) tracker.observations = [];
    tracker.version = Math.max(VERSION, Number(tracker.version) || 0);
    return tracker;
  }

  function persistData() {
    const database = appDb();
    if (!database) return;
    const tracker = ensureTracker();
    tracker.updatedAt = nowIso();
    writeMirror(tracker);
    try {
      if (typeof saveData === 'function') {
        const result = saveData();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    } catch (error) {}
  }

  function persistStudyAllocation() {
    try { if (typeof saveLocalNow === 'function') saveLocalNow(); } catch (error) {}
    try { if (typeof refreshStudyViews === 'function') refreshStudyViews(); } catch (error) {}
    try { if (typeof cronoUpdateRunTodayTotal === 'function') cronoUpdateRunTodayTotal(); } catch (error) {}
    try {
      if (typeof enqueueCloudSync === 'function') enqueueCloudSync();
      else if (typeof saveData === 'function') {
        const result = saveData();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    } catch (error) {}
  }

  function reconcileMirror(saveIfChanged) {
    if (reconcileBusy) return;
    const database = appDb();
    if (!database) return;
    reconcileBusy = true;
    try {
      const before = trackerShape(database[TRACKER_KEY]);
      const mirror = readMirror();
      const merged = mergeTrackers(before, mirror);
      const beforeSig = JSON.stringify(before);
      const mergedSig = JSON.stringify(merged);
      if (beforeSig !== mergedSig) {
        database[TRACKER_KEY] = merged;
        writeMirror(merged);
        if (saveIfChanged) {
          try {
            if (typeof saveData === 'function') {
              const result = saveData();
              if (result && typeof result.catch === 'function') result.catch(() => {});
            }
          } catch (error) {}
        }
      } else writeMirror(before);
    } finally { reconcileBusy = false; }
  }

  function installSyncMerge() {
    const core = window.DataCore;
    if (!core || typeof core.mergeStudyHistory !== 'function' || core.__passageTrackerMergeInstalled) return false;
    const original = core.mergeStudyHistory;
    core.mergeStudyHistory = function mergeStudyHistoryWithPassages(base, other) {
      const merged = original.apply(this, arguments);
      merged[TRACKER_KEY] = mergeTrackers(base && base[TRACKER_KEY], other && other[TRACKER_KEY]);
      return merged;
    };
    Object.defineProperty(core, '__passageTrackerMergeInstalled', { value: true, configurable: true });
    return true;
  }

  function findWork(obraId) {
    try {
      if (typeof findObra === 'function') {
        const value = findObra(obraId);
        if (value) return value;
      }
    } catch (error) {}
    const database = appDb();
    return database && Array.isArray(database.obras)
      ? database.obras.find(item => item && idEqual(item.id, obraId)) || null
      : null;
  }

  function parseSelection(value) {
    const raw = String(value || '');
    try {
      if (typeof cronoResolveSelectValue === 'function') {
        const resolved = cronoResolveSelectValue(raw);
        if (resolved && resolved.obraId) {
          return {
            obraId: String(resolved.obraId),
            movId: resolved.movId ?? resolved.movementId ?? resolved.movimientoId ?? null,
          };
        }
      }
    } catch (error) {}
    let match = /^mov::([^:]+)::([^:]+)$/.exec(raw);
    if (match) return { obraId: match[1], movId: match[2] };
    match = /^obra::([^:]+)$/.exec(raw);
    return match ? { obraId: match[1], movId: null } : null;
  }

  function resolvedCurrentSelection() {
    const current = cronoState();
    if (current && current.state !== 'idle' && current.obraId) {
      return { obraId: String(current.obraId), movId: current.movId != null ? String(current.movId) : null };
    }
    const select = document.getElementById('cronoObraSelect');
    const resolved = parseSelection(select && select.value);
    if (resolved && resolved.movId != null) resolved.movId = String(resolved.movId);
    return resolved;
  }

  function isGeneralSelection(resolved) {
    if (!resolved || !resolved.obraId) return false;
    if (normalized(resolved.obraId) === 'general') return true;
    const obra = findWork(resolved.obraId);
    return normalized(obra && (obra.name || obra.nombre || obra.title || obra.titulo)) === 'general';
  }

  function currentTarget() {
    const resolved = resolvedCurrentSelection();
    if (!resolved || !resolved.obraId) return null;
    if (isGeneralSelection(resolved)) return { obraId: String(resolved.obraId), movId: null, general: true };
    const obra = findWork(resolved.obraId);
    if (!obra || obra.tipo === 'actividad') return null;
    return { obraId: String(resolved.obraId), movId: resolved.movId == null ? null : String(resolved.movId), general: false };
  }

  function targetKey(target) {
    if (!target) return '';
    return (target.general ? 'general:' : '') + target.obraId + '::' + (target.movId == null ? '' : target.movId);
  }

  function movementForTarget(target) {
    if (!target || target.general) return null;
    const obra = findWork(target.obraId);
    if (!obra || target.movId == null || !Array.isArray(obra.movimientos)) return null;
    return obra.movimientos.find(item => item && idEqual(item.id, target.movId)) || null;
  }

  function targetLabel(target) {
    if (!target) return '';
    if (target.general) return 'General';
    const obra = findWork(target.obraId);
    const mov = movementForTarget(target);
    const workName = obra ? (obra.name || obra.nombre || 'Obra') : 'Obra';
    return mov ? workName + ' · ' + (mov.name || mov.nombre || 'Movimiento') : workName;
  }

  function passageMatchesTarget(passage, target) {
    if (!passage || !target) return false;
    if (target.general) return true;
    return idEqual(passage.obraId, target.obraId)
      && (passage.movId == null ? target.movId == null : idEqual(passage.movId, target.movId));
  }

  function activePassages(target) {
    if (!target) return [];
    const passages = ensureTracker().passages.filter(item => item && !item.deletedAt && passageMatchesTarget(item, target));
    if (!target.general) return passages;
    return passages.slice().sort((a, b) => {
      const left = targetLabel({ obraId: a.obraId, movId: a.movId, general: false }) + ' · ' + (a.name || '');
      const right = targetLabel({ obraId: b.obraId, movId: b.movId, general: false }) + ' · ' + (b.name || '');
      return left.localeCompare(right, 'es', { sensitivity: 'base' });
    });
  }

  function passageById(id) {
    return ensureTracker().passages.find(item => item && idEqual(item.id, id)) || null;
  }

  function passageObservations(id) {
    return ensureTracker().observations.filter(item => item && idEqual(item.passageId, id));
  }

  function latestObservation(id) {
    return passageObservations(id).slice().sort((a, b) => parseTime(b.recordedAt) - parseTime(a.recordedAt))[0] || null;
  }

  function latestScore(id) {
    const observation = passageObservations(id)
      .filter(item => item && (item.score != null || item.postScore != null || item.coldScore != null))
      .sort((a, b) => parseTime(b.recordedAt) - parseTime(a.recordedAt))[0] || null;
    if (!observation) return null;
    const value = observation.score != null
      ? observation.score
      : (observation.postScore != null ? observation.postScore : observation.coldScore);
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function workEntityForTarget(target) {
    if (!target || target.general) return null;
    return movementForTarget(target) || findWork(target.obraId);
  }

  function normalizedWorkScore(entry) {
    const raw = entry && (entry.inputVal != null ? entry.inputVal : entry.val);
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.round(clamp(value > 10 ? value : value * 10, 1, 100));
  }

  function curveSessionKey(point) {
    if (point.runId) return 'run:' + point.runId;
    if (point.sessionId) return 'session:' + point.sessionId;
    if (point.sessionStartedAt) return 'started:' + point.sessionStartedAt;
    const date = new Date(point.at || 0);
    return Number.isFinite(date.getTime()) ? 'day:' + date.toISOString().slice(0, 10) : 'unknown';
  }

  function cumulativeCurvePoints(points) {
    const ordered = (points || []).filter(point => Number.isFinite(Number(point.score)))
      .map((point, index) => ({
        ...point,
        score: Math.round(clamp(point.score, 1, 100)),
        elapsedMs: Math.max(0, Number(point.elapsedMs) || 0),
        atMs: parseTime(point.at),
        order: index,
      }))
      .sort((a, b) => a.atMs - b.atMs || a.order - b.order);
    const groups = [];
    const byKey = new Map();
    ordered.forEach(point => {
      const key = curveSessionKey(point);
      let group = byKey.get(key);
      if (!group) {
        group = { key, points: [], firstAt: point.atMs };
        byKey.set(key, group);
        groups.push(group);
      }
      group.points.push(point);
    });
    groups.sort((a, b) => a.firstAt - b.firstAt);
    let offsetMs = 0;
    const result = [];
    groups.forEach(group => {
      group.points.sort((a, b) => a.elapsedMs - b.elapsedMs || a.atMs - b.atMs || a.order - b.order);
      group.points.forEach(point => result.push({ ...point, x: (offsetMs + point.elapsedMs) / 60000 }));
      offsetMs += Math.max(0, ...group.points.map(point => point.elapsedMs));
    });
    const hasTimeSpread = result.length > 1 && result.some(point => point.x > result[0].x + 0.001);
    if (!hasTimeSpread) result.forEach((point, index) => { point.x = index; });
    return { points: result, axis: hasTimeSpread ? 'min activos acumulados' : 'registros', timed: hasTimeSpread };
  }

  function workCurvePoints(target) {
    const entity = workEntityForTarget(target);
    return (entity && entity.solHistory || []).map(entry => ({
      score: normalizedWorkScore(entry),
      at: entry && entry.date,
      elapsedMs: entry && entry.activeElapsedMs,
      runId: entry && entry.runId,
    }));
  }

  function passageCurvePoints(passageId) {
    const points = [];
    passageObservations(passageId).forEach(observation => {
      const shared = {
        runId: observation.runId,
        sessionId: observation.sessionId,
        sessionStartedAt: observation.sessionStartedAt,
      };
      if (observation.score != null) points.push({
        ...shared,
        score: observation.score,
        at: observation.recordedAt,
        elapsedMs: observation.activeElapsedMs,
      });
      if (observation.coldScore != null) points.push({
        ...shared,
        score: observation.coldScore,
        at: observation.coldCapturedAt || observation.recordedAt,
        elapsedMs: 0,
      });
      if (observation.postScore != null) points.push({
        ...shared,
        score: observation.postScore,
        at: observation.postCapturedAt || observation.recordedAt,
        elapsedMs: observation.focusedMs,
      });
    });
    return points;
  }

  function learningCurveChoices(target, passages) {
    const choices = [];
    if (!target.general) choices.push({ id: 'work', label: target.movId == null ? 'Obra' : 'Movimiento', points: workCurvePoints(target) });
    passages.forEach(passage => choices.push({ id: 'passage:' + passage.id, label: passage.name, points: passageCurvePoints(passage.id) }));
    return choices;
  }

  function curveNumber(value) {
    const rounded = Math.round(Number(value) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function curveSvg(series) {
    const points = series.points;
    if (!points.length) return '<div class="passage-learning-empty">Registra dos valores para empezar a ver la evolución.</div>';
    const width = 600, height = 176, left = 30, right = 12, top = 12, bottom = 27;
    const xMin = points[0].x;
    const xMax = points[points.length - 1].x;
    const xSpan = Math.max(1, xMax - xMin);
    const xOf = point => points.length === 1 ? (left + width - right) / 2 : left + ((point.x - xMin) / xSpan) * (width - left - right);
    const yOf = point => top + (100 - point.score) / 100 * (height - top - bottom);
    const grid = [25, 50, 75, 100].map(value => {
      const y = top + (100 - value) / 100 * (height - top - bottom);
      return '<line x1="' + left + '" x2="' + (width - right) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"></line>' +
        '<text x="' + (left - 6) + '" y="' + (y + 3).toFixed(1) + '">' + value + '</text>';
    }).join('');
    const polyline = points.length > 1
      ? '<polyline points="' + points.map(point => xOf(point).toFixed(1) + ',' + yOf(point).toFixed(1)).join(' ') + '"></polyline>'
      : '';
    const dots = points.map(point => '<circle cx="' + xOf(point).toFixed(1) + '" cy="' + yOf(point).toFixed(1) + '" r="4"><title>' +
      point.score + '% · ' + curveNumber(point.x) + ' ' + series.axis + '</title></circle>').join('');
    const first = curveNumber(points[0].x);
    const last = curveNumber(points[points.length - 1].x);
    return '<svg class="passage-learning-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Curva de aprendizaje, de ' + points[0].score + ' a ' + points[points.length - 1].score + ' por ciento">' +
      '<g class="passage-learning-grid">' + grid + '</g><g class="passage-learning-line">' + polyline + dots + '</g>' +
      '<g class="passage-learning-axis"><text x="' + left + '" y="' + (height - 7) + '">' + first + '</text><text x="' + (width - right) + '" y="' + (height - 7) + '" text-anchor="end">' + last + '</text><text x="' + (width / 2) + '" y="' + (height - 7) + '" text-anchor="middle">' + series.axis + '</text></g>' +
    '</svg>';
  }

  function makeLearningCurve(target, passages) {
    const choices = learningCurveChoices(target, passages);
    if (!choices.length) return null;
    if (!choices.some(choice => choice.id === learningCurveSelection)) learningCurveSelection = choices[0].id;
    const details = document.createElement('details');
    details.className = 'passage-learning-curve';
    details.open = learningCurveOpen;
    details.dataset.noViewSwipe = '';
    const summary = document.createElement('summary');
    summary.innerHTML = '<span><b>Curva de aprendizaje</b><small>Evolución frente a práctica real</small></span><i aria-hidden="true">⌄</i>';
    const body = document.createElement('div');
    body.className = 'passage-learning-body';

    const renderSelected = () => {
      const selected = choices.find(choice => choice.id === learningCurveSelection) || choices[0];
      const series = cumulativeCurvePoints(selected.points);
      const first = series.points[0];
      const latest = series.points[series.points.length - 1];
      body.replaceChildren();
      if (choices.length > 1) {
        const tabs = document.createElement('div');
        tabs.className = 'passage-learning-tabs';
        choices.forEach(choice => {
          const button = makeButton('passage-learning-tab' + (choice.id === selected.id ? ' active' : ''), choice.label, 'Mostrar curva de ' + choice.label);
          button.addEventListener('click', () => {
            learningCurveSelection = choice.id;
            renderSelected();
          });
          tabs.appendChild(button);
        });
        body.appendChild(tabs);
      }
      const summaryRow = document.createElement('div');
      summaryRow.className = 'passage-learning-summary';
      if (!latest) summaryRow.innerHTML = '<strong>Sin registros todavía</strong><span>La curva aparecerá sin pasos extra.</span>';
      else {
        const delta = latest.score - first.score;
        summaryRow.innerHTML = '<strong>' + latest.score + '% · ' + scoreDescriptor(latest.score) + '</strong><span>' +
          (series.points.length < 2 ? 'Primera referencia' : (delta >= 0 ? '+' : '') + delta + ' puntos desde el primer registro') +
          ' · ' + series.points.length + (series.points.length === 1 ? ' medida' : ' medidas') + '</span>';
      }
      body.appendChild(summaryRow);
      const chart = document.createElement('div');
      chart.className = 'passage-learning-chart';
      chart.innerHTML = curveSvg(series);
      body.appendChild(chart);
    };
    renderSelected();
    details.addEventListener('toggle', () => { learningCurveOpen = details.open; });
    details.append(summary, body);
    return details;
  }

  function ensureDraft() {
    const state = cronoState();
    if (!draft) {
      const masterTarget = currentTarget();
      draft = {
        id: uid('passession'),
        startedAt: nowIso(),
        cronoStartedAt: state && state.startTs ? new Date(state.startTs).toISOString() : nowIso(),
        cronoRunId: state && (state.runId || state.currentRunId || state.sessionRunId || state.id) || null,
        masterTarget: masterTarget ? { obraId: masterTarget.obraId, movId: masterTarget.movId, general: !!masterTarget.general } : null,
        entries: {},
        committed: false,
      };
    }
    return draft;
  }

  function entryForPassage(id, create) {
    const session = create ? ensureDraft() : draft;
    if (!session) return null;
    if (!session.entries[id] && create) {
      session.entries[id] = {
        passageId: id,
        focusedMs: 0,
        chunks: [],
        coldScore: null,
        coldCapturedAt: null,
        postScore: null,
        postCapturedAt: null,
        ratingTouched: false,
      };
    }
    return session.entries[id] || null;
  }

  function liveFocusedMs(id) {
    const entry = entryForPassage(id, false);
    let total = entry ? Number(entry.focusedMs) || 0 : 0;
    if (idEqual(activePassageId, id) && activeChunkStartedAt) total += Math.max(0, Date.now() - activeChunkStartedAt);
    return total;
  }

  function masterRunning() {
    const state = cronoState();
    return !!state && state.state === 'running';
  }

  function stopActive(reason) {
    if (!activePassageId || !activeChunkStartedAt) {
      activePassageId = null;
      activeChunkStartedAt = 0;
      activeChunkIso = null;
      return;
    }
    const id = activePassageId;
    const endedAtMs = Date.now();
    const elapsed = Math.max(0, endedAtMs - activeChunkStartedAt);
    const entry = entryForPassage(id, true);
    if (elapsed > 0) {
      entry.focusedMs += elapsed;
      entry.chunks.push({
        startedAt: activeChunkIso || new Date(activeChunkStartedAt).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
        ms: elapsed,
        reason: reason || 'manual',
      });
    }
    activePassageId = null;
    activeChunkStartedAt = 0;
    activeChunkIso = null;
  }

  function togglePassageTimer(id) {
    if (!masterRunning()) {
      toast('Inicia o reanuda el cronómetro maestro para medir este pasaje');
      return;
    }
    const passage = passageById(id);
    const target = currentTarget();
    if (!passage || passage.deletedAt || !passageMatchesTarget(passage, target)) return;
    if (idEqual(activePassageId, id)) {
      stopActive('manual-stop');
      renderPanel();
      renderHechoSummary();
      return;
    }
    if (activePassageId) stopActive('switch-passage');
    ensureDraft();
    entryForPassage(id, true);
    activePassageId = id;
    activeChunkStartedAt = Date.now();
    activeChunkIso = new Date(activeChunkStartedAt).toISOString();
    renderPanel();
  }

  function formatMs(ms) {
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h) return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function scoreDescriptor(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Sin valoración';
    if (n < 30) return 'No sale de forma fiable';
    if (n < 50) return 'Muy inestable';
    if (n < 65) return 'Sale a ratos';
    if (n < 80) return 'Bastante fiable';
    if (n < 90) return 'Muy sólido';
    if (n < 97) return 'Casi automático';
    return 'Excepcionalmente sólido';
  }

  function scoreDisplay(id) {
    const entry = entryForPassage(id, false);
    if (entry) {
      if (entry.postScore != null) return { label: 'Ahora', value: entry.postScore, current: true };
      if (entry.coldScore != null) return { label: 'Frío', value: entry.coldScore, current: true };
      if (entry.focusedMs > 0 || idEqual(activePassageId, id)) return { label: 'Ahora', value: null, current: true };
    }
    return { label: 'Últ.', value: latestScore(id), current: false };
  }

  function scoreToPosition(value) {
    try { if (typeof pasePctToPosition === 'function') return pasePctToPosition(value); } catch (error) {}
    return clamp(value, 1, 100);
  }

  function positionToScore(value) {
    try { if (typeof pasePositionToPct === 'function') return pasePositionToPct(value); } catch (error) {}
    return Math.round(clamp(value, 1, 100));
  }

  function liquidStyle(value) {
    try { if (typeof paseLiquidStyle === 'function') return paseLiquidStyle(value); } catch (error) {}
    const pct = clamp(value, 1, 100);
    return '--pase-fill:' + pct + '%;--pase-value:' + pct + ';--pase-glow:.45;--pase-glow-size:12px;--pase-color:var(--accent)';
  }

  function setInlineScoreVisual(input, rawValue) {
    const value = Math.round(clamp(rawValue, 1, 100));
    const meter = input && input.closest('.pase-liquid-meter');
    if (meter) {
      meter.setAttribute('style', liquidStyle(value));
      meter.dataset.paseValue = String(value);
    }
    if (input) {
      input.value = Number(scoreToPosition(value)).toFixed(2);
      input.dataset.paseValue = String(value);
      input.setAttribute('aria-valuetext', value + ' por ciento, ' + scoreDescriptor(value));
      const control = input.closest('.crono-passage-inline-score');
      const readout = control && control.querySelector('[data-passage-score-value]');
      if (readout) readout.textContent = String(value);
      const descriptor = control && control.querySelector('[data-passage-score-description]');
      if (descriptor) descriptor.textContent = scoreDescriptor(value);
    }
    return value;
  }

  function updatePendingScoreLabel(passageId) {
    const node = Array.from(document.querySelectorAll('[data-passage-score-pending]'))
      .find(candidate => candidate.dataset.passageScorePending === String(passageId));
    if (!node) return;
    const pending = pendingScores.get(String(passageId));
    if (!pending) {
      node.textContent = 'registrado';
      node.classList.remove('is-pending');
      return;
    }
    const remaining = Math.max(0, pending.dueAt - Date.now());
    node.textContent = remaining > 0 ? Math.max(1, Math.ceil(remaining / 1000)) + ' s' : 'guardando';
    node.classList.add('is-pending');
  }

  function commitInlineScore(passageId, source) {
    const key = String(passageId);
    const pending = pendingScores.get(key);
    if (!pending) return null;
    clearTimeout(pending.timer);
    clearInterval(pending.countdown);
    pendingScores.delete(key);
    if (pending.value === pending.previous) {
      updatePendingScoreLabel(key);
      return null;
    }
    const passage = passageById(key);
    if (!passage || passage.deletedAt) return null;
    const state = cronoState();
    const session = draft;
    const observation = {
      id: uid('passobs'),
      passageId: passage.id,
      obraId: passage.obraId,
      movId: passage.movId == null ? null : passage.movId,
      passageName: passage.name,
      difficulty: passage.difficulty == null ? null : Number(passage.difficulty),
      score: pending.value,
      recordedAt: nowIso(),
      activeElapsedMs: Math.max(0, Math.round(liveFocusedMs(passage.id))),
      masterSessionMs: masterSessionMs(),
      sessionId: session && session.id || null,
      sessionStartedAt: session && (session.cronoStartedAt || session.startedAt) || null,
      runId: session && session.cronoRunId || state && (state.runId || state.currentRunId) || null,
      source: source || 'passage-inline-v3',
    };
    const tracker = ensureTracker();
    tracker.observations.push(observation);
    tracker.updatedAt = observation.recordedAt;
    persistData();
    const visibleInput = Array.from(document.querySelectorAll('[data-passage-score-input]'))
      .find(candidate => candidate.dataset.passageScoreInput === key);
    if (visibleInput) setInlineScoreVisual(visibleInput, pending.value);
    updatePendingScoreLabel(key);
    renderPanel();
    return observation;
  }

  function queueInlineScore(passageId, input) {
    const key = String(passageId);
    const previousPending = pendingScores.get(key);
    if (previousPending) {
      clearTimeout(previousPending.timer);
      clearInterval(previousPending.countdown);
    }
    const value = setInlineScoreVisual(input, positionToScore(input.value));
    const previous = latestScore(key);
    if (value === previous) {
      pendingScores.delete(key);
      updatePendingScoreLabel(key);
      return;
    }
    const pending = {
      passageId: key,
      value,
      previous,
      dueAt: Date.now() + SCORE_SETTLE_MS,
      timer: null,
      countdown: null,
    };
    pending.timer = setTimeout(() => commitInlineScore(key, 'passage-inline-v3'), SCORE_SETTLE_MS);
    pending.countdown = setInterval(() => updatePendingScoreLabel(key), 250);
    pendingScores.set(key, pending);
    updatePendingScoreLabel(key);
  }

  function flushPendingScores(source) {
    return Array.from(pendingScores.keys()).map(id => commitInlineScore(id, source || 'passage-inline-flush-v3')).filter(Boolean);
  }

  function makeInlineScore(passage) {
    const control = document.createElement('div');
    control.className = 'crono-passage-inline-score';
    const committed = latestScore(passage.id);
    const pending = pendingScores.get(String(passage.id));
    const value = pending ? pending.value : (committed == null ? 50 : committed);
    const meta = document.createElement('div');
    meta.className = 'crono-passage-inline-meta';
    meta.innerHTML = '<span>Solidez</span><strong data-passage-score-value>' + value + '</strong><em data-passage-score-description>' + scoreDescriptor(value) + '</em><small data-passage-score-pending="' + String(passage.id).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">' + (pending ? '5 s' : (committed == null ? 'mueve para guardar' : 'último valor')) + '</small>';
    const meter = document.createElement('div');
    meter.className = 'pase-liquid-meter passage-inline-meter';
    meter.setAttribute('style', liquidStyle(value));
    meter.innerHTML = '<div class="pase-liquid-reservoir" aria-hidden="true"><span class="pase-liquid-fill"></span><span class="pase-liquid-glint"></span><span class="pase-liquid-orb"></span></div>';
    const input = document.createElement('input');
    input.className = 'pase-liquid-input';
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '0.01';
    input.dataset.passageScoreInput = String(passage.id);
    input.setAttribute('aria-label', 'Solidez de ' + passage.name);
    input.addEventListener('input', () => queueInlineScore(passage.id, input));
    meter.appendChild(input);
    control.append(meta, meter);
    setInlineScoreVisual(input, value);
    if (pending) updatePendingScoreLabel(passage.id);
    return control;
  }

  function toast(message) {
    try { if (typeof showToast === 'function') { showToast(message); return; } } catch (error) {}
    console.info('[Pasajes]', message);
  }

  function openAppModal(id) {
    try { if (typeof openModal === 'function') { openModal(id); return; } } catch (error) {}
    const el = document.getElementById(id);
    if (el) { el.classList.add('active'); el.style.display = 'flex'; }
  }

  function closeAppModal(id) {
    try { if (typeof closeModal === 'function') { closeModal(id); return; } } catch (error) {}
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); el.style.display = 'none'; }
  }

  function ensureUi() {
    if (!document.getElementById('cronoPassageTracker')) {
      const wrap = document.querySelector('#view-cronometro .crono-wrap');
      if (wrap) {
        const panel = document.createElement('section');
        panel.id = 'cronoPassageTracker';
        panel.className = 'crono-passage-tracker';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Pasajes difíciles');
        wrap.appendChild(panel);
      }
    }

    if (!document.getElementById('modalPassageEditor')) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'modalPassageEditor';
      overlay.innerHTML = [
        '<div class="modal passage-editor-modal">',
        '  <div class="passage-modal-kicker">Pasaje difícil</div>',
        '  <div class="modal-title" id="passageEditorTitle">Añadir pasaje</div>',
        '  <div class="passage-modal-context" id="passageEditorContext"></div>',
        '  <label class="passage-field"><span>Nombre</span><input class="modal-input" id="passageEditorName" maxlength="80" autocomplete="off" placeholder="Ej.: octavas finales"></label>',
        '  <label class="passage-field"><span>Dificultad <small>1–10</small></span><input class="modal-input" id="passageEditorDifficulty" type="number" min="1" max="10" step="0.1" inputmode="decimal"></label>',
        '  <div class="passage-editor-actions">',
        '    <button type="button" class="modal-btn passage-delete-btn" id="passageDeleteBtn">Eliminar</button>',
        '    <span></span>',
        '    <button type="button" class="modal-btn secondary" id="passageEditorCancel">Cancelar</button>',
        '    <button type="button" class="modal-btn primary" id="passageEditorSave">Guardar</button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(overlay);
      overlay.querySelector('#passageEditorCancel').addEventListener('click', () => closeAppModal('modalPassageEditor'));
      overlay.querySelector('#passageEditorSave').addEventListener('click', savePassageEditor);
      overlay.querySelector('#passageDeleteBtn').addEventListener('click', deleteEditingPassage);
      overlay.querySelector('#passageEditorName').addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); savePassageEditor(); }
      });
    }

    if (!document.getElementById('modalPassageRating')) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'modalPassageRating';
      overlay.innerHTML = [
        '<div class="modal passage-rating-modal">',
        '  <div class="passage-modal-kicker" id="passageRatingKicker">En frío</div>',
        '  <div class="modal-title" id="passageRatingTitle">Valorar pasaje</div>',
        '  <div class="passage-modal-context" id="passageRatingContext"></div>',
        '  <div class="passage-rating-readout"><strong id="passageRatingValue">50</strong><span id="passageRatingDescriptor">Sale a ratos</span></div>',
        '  <input id="passageRatingSlider" class="passage-rating-slider" type="range" min="1" max="100" step="1" value="50" aria-label="Estado subjetivo del pasaje">',
        '  <div class="passage-rating-scale" aria-hidden="true"><span>1</span><span>50</span><span>80</span><span>100</span></div>',
        '  <p class="passage-rating-hint" id="passageRatingHint"></p>',
        '  <div class="modal-buttons">',
        '    <button type="button" class="modal-btn secondary" id="passageRatingCancel">Cancelar</button>',
        '    <button type="button" class="modal-btn primary" id="passageRatingSave">Guardar en esta sesión</button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(overlay);
      const slider = overlay.querySelector('#passageRatingSlider');
      slider.addEventListener('input', updateRatingReadout);
      overlay.querySelector('#passageRatingCancel').addEventListener('click', () => closeAppModal('modalPassageRating'));
      overlay.querySelector('#passageRatingSave').addEventListener('click', savePassageRating);
    }

    const panel = document.getElementById('cronoPassageTracker');
    const running = ['running','paused'].includes(cronoState()?.state);
    const slot = document.querySelector((running ? '#cronoRunDrawer' : '#cronoIdleDrawer') + ' [data-panel="pasajes"]');
    if (panel && slot && panel.parentElement !== slot) slot.appendChild(panel);
    ensureHechoSummary();
  }

  function ensureHechoSummary() {
    if (document.getElementById('hechoPassageSummary')) return;
    const body = document.querySelector('#modalHechoDatos .hecho-modal-body');
    if (!body) return;
    const section = document.createElement('section');
    section.id = 'hechoPassageSummary';
    section.className = 'hecho-passage-summary';
    section.hidden = true;
    const advanced = document.getElementById('hechoAdvancedToggle');
    if (advanced && advanced.parentElement === body) body.insertBefore(section, advanced);
    else body.appendChild(section);
  }

  function openPassageEditor(id) {
    ensureUi();
    const target = currentTarget();
    const passage = id ? passageById(id) : null;
    if (!passage && (!target || target.general)) {
      toast(target && target.general ? 'Selecciona una obra o movimiento para añadir un pasaje' : 'Elige primero una obra o movimiento');
      return;
    }
    editingPassageId = passage ? passage.id : null;
    const contextTarget = passage ? { obraId: passage.obraId, movId: passage.movId, general: false } : target;
    document.getElementById('passageEditorTitle').textContent = passage ? 'Editar pasaje' : 'Añadir pasaje';
    document.getElementById('passageEditorContext').textContent = targetLabel(contextTarget);
    document.getElementById('passageEditorName').value = passage ? passage.name || '' : '';
    document.getElementById('passageEditorDifficulty').value = passage && passage.difficulty != null ? Number(passage.difficulty).toFixed(1) : '7.0';
    document.getElementById('passageDeleteBtn').hidden = !passage;
    openAppModal('modalPassageEditor');
    setTimeout(() => document.getElementById('passageEditorName')?.focus(), 60);
  }

  function savePassageEditor() {
    const target = currentTarget();
    const existing = editingPassageId ? passageById(editingPassageId) : null;
    if (!existing && (!target || target.general)) { toast('Selecciona una obra o movimiento para añadir este pasaje'); return; }
    const name = String(document.getElementById('passageEditorName')?.value || '').trim();
    const difficulty = clamp(document.getElementById('passageEditorDifficulty')?.value, 1, 10);
    if (!name) { toast('Pon un nombre al pasaje'); return; }
    if (!difficulty) { toast('La dificultad debe estar entre 1 y 10'); return; }
    const tracker = ensureTracker();
    const stamp = nowIso();
    if (existing) {
      existing.name = name;
      existing.difficulty = Math.round(difficulty * 10) / 10;
      existing.updatedAt = stamp;
    } else {
      tracker.passages.push({
        id: uid('passage'),
        obraId: target.obraId,
        movId: target.movId,
        name,
        difficulty: Math.round(difficulty * 10) / 10,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      });
    }
    persistData();
    closeAppModal('modalPassageEditor');
    renderPanel();
  }

  function deleteEditingPassage() {
    const passage = editingPassageId && passageById(editingPassageId);
    if (!passage) return;
    const pending = pendingScores.get(String(passage.id));
    if (pending) {
      clearTimeout(pending.timer);
      clearInterval(pending.countdown);
      pendingScores.delete(String(passage.id));
    }
    if (idEqual(activePassageId, passage.id)) stopActive('passage-deleted');
    passage.deletedAt = nowIso();
    passage.updatedAt = passage.deletedAt;
    persistData();
    closeAppModal('modalPassageEditor');
    renderPanel();
  }

  function openPassageRating(id) {
    ensureUi();
    if (!draft || !cronoState() || cronoState().state === 'idle') {
      toast('Inicia una sesión para registrar cómo está el pasaje');
      return;
    }
    if (idEqual(activePassageId, id)) stopActive('rate-passage');
    const passage = passageById(id);
    if (!passage) return;
    const entry = entryForPassage(id, true);
    const practiced = Number(entry.focusedMs) > 0 || entry.chunks.length > 0;
    ratingMode = practiced ? 'post' : 'cold';
    ratingPassageId = id;
    const initial = ratingMode === 'cold'
      ? (entry.coldScore != null ? entry.coldScore : (latestScore(id) ?? 50))
      : (entry.postScore != null ? entry.postScore : (entry.coldScore != null ? entry.coldScore : (latestScore(id) ?? 50)));
    const slider = document.getElementById('passageRatingSlider');
    slider.value = String(clamp(initial, 1, 100));
    document.getElementById('passageRatingKicker').textContent = ratingMode === 'cold' ? 'En frío' : 'Después de trabajarlo';
    document.getElementById('passageRatingTitle').textContent = passage.name || 'Pasaje';
    document.getElementById('passageRatingContext').textContent = targetLabel({ obraId: passage.obraId, movId: passage.movId, general: false });
    document.getElementById('passageRatingHint').textContent = ratingMode === 'cold'
      ? 'Tócalo una o dos veces sin trabajarlo y registra cómo responde. Puedes corregir este valor mientras aún no hayas cronometrado el pasaje.'
      : 'Esta segunda medida es opcional. Sirve para separar mejora inmediata de retención en la próxima sesión.';
    updateRatingReadout();
    openAppModal('modalPassageRating');
  }

  function updateRatingReadout() {
    const slider = document.getElementById('passageRatingSlider');
    if (!slider) return;
    const value = clamp(slider.value, 1, 100);
    slider.style.setProperty('--passage-fill', ((value - 1) / 99 * 100) + '%');
    document.getElementById('passageRatingValue').textContent = String(Math.round(value));
    document.getElementById('passageRatingDescriptor').textContent = scoreDescriptor(value);
  }

  function savePassageRating() {
    if (!ratingPassageId) return;
    const slider = document.getElementById('passageRatingSlider');
    const value = Math.round(clamp(slider && slider.value, 1, 100));
    const entry = entryForPassage(ratingPassageId, true);
    const stamp = nowIso();
    if (ratingMode === 'cold' && !(entry.focusedMs > 0 || entry.chunks.length)) {
      entry.coldScore = value;
      entry.coldCapturedAt = stamp;
    } else {
      entry.postScore = value;
      entry.postCapturedAt = stamp;
    }
    entry.ratingTouched = true;
    closeAppModal('modalPassageRating');
    renderPanel();
    renderHechoSummary();
  }

  function makeButton(className, text, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    if (label) button.setAttribute('aria-label', label);
    return button;
  }

  function renderPanel() {
    ensureUi();
    const panel = document.getElementById('cronoPassageTracker');
    if (!panel) return;
    const target = currentTarget();
    if (!target) {
      panel.hidden = true;
      panel.replaceChildren();
      return;
    }
    panel.hidden = false;
    const passages = activePassages(target);
    panel.classList.toggle('is-empty', passages.length === 0);
    panel.replaceChildren();

    if (!passages.length) {
      const curve = makeLearningCurve(target, passages);
      if (curve) panel.appendChild(curve);
      if (target.general) {
        const empty = document.createElement('div');
        empty.className = 'crono-passage-empty-general';
        empty.innerHTML = '<strong>No hay pasajes guardados</strong><span>Añádelos desde una obra o movimiento y aparecerán aquí para tus calentamientos.</span>';
        panel.appendChild(empty);
      } else {
        const add = makeButton('crono-passage-add crono-passage-add-empty', '＋ Añadir pasaje', 'Añadir un pasaje difícil');
        add.addEventListener('click', () => openPassageEditor(null));
        panel.appendChild(add);
      }
      return;
    }

    const head = document.createElement('header');
    head.className = 'crono-passage-head';
    const title = document.createElement('div');
    title.innerHTML = '<span>PASAJES</span><strong>' + passages.length + '</strong>';
    const context = document.createElement('small');
    const movement = movementForTarget(target);
    context.textContent = target.general ? 'Todas las obras' : (movement ? (movement.name || movement.nombre || 'Movimiento') : 'Obra completa');
    head.append(title, context);
    panel.appendChild(head);

    const curve = makeLearningCurve(target, passages);
    if (curve) panel.appendChild(curve);

    const list = document.createElement('div');
    list.className = 'crono-passage-list';
    passages.forEach(passage => {
      const row = document.createElement('article');
      row.className = 'crono-passage-row';
      if (idEqual(activePassageId, passage.id)) row.classList.add('is-timing');

      const nameBtn = makeButton('crono-passage-name', '', 'Editar ' + passage.name);
      const strong = document.createElement('strong');
      strong.textContent = passage.name;
      const meta = document.createElement('small');
      const owner = target.general ? targetLabel({ obraId: passage.obraId, movId: passage.movId, general: false }) + ' · ' : '';
      meta.textContent = owner + 'Dificultad ' + Number(passage.difficulty || 0).toFixed(1) + ' · editar';
      nameBtn.append(strong, meta);
      nameBtn.addEventListener('click', () => openPassageEditor(passage.id));

      const scoreControl = makeInlineScore(passage);

      const timerBtn = makeButton('crono-passage-timer' + (idEqual(activePassageId, passage.id) ? ' is-active' : ''), '', (idEqual(activePassageId, passage.id) ? 'Parar ' : 'Cronometrar ') + passage.name);
      const icon = document.createElement('span');
      icon.textContent = idEqual(activePassageId, passage.id) ? 'Ⅱ' : '▶';
      const time = document.createElement('strong');
      time.dataset.passageTime = passage.id;
      time.textContent = formatMs(liveFocusedMs(passage.id));
      const action = document.createElement('small');
      action.textContent = idEqual(activePassageId, passage.id) ? 'Parar' : 'Estudiar';
      timerBtn.append(icon, time, action);
      timerBtn.addEventListener('click', () => togglePassageTimer(passage.id));

      row.append(nameBtn, scoreControl, timerBtn);
      list.appendChild(row);
    });
    panel.appendChild(list);

    if (!target.general) {
      const add = makeButton('crono-passage-add', '＋ Añadir', 'Añadir otro pasaje difícil');
      add.addEventListener('click', () => openPassageEditor(null));
      panel.appendChild(add);
    }
  }

  function renderLiveTimes() {
    document.querySelectorAll('[data-passage-time]').forEach(node => {
      node.textContent = formatMs(liveFocusedMs(node.dataset.passageTime));
    });
  }

  function touchedEntries() {
    if (!draft) return [];
    return Object.values(draft.entries || {}).filter(entry => entry && (entry.ratingTouched || entry.focusedMs > 0 || entry.chunks.length || idEqual(activePassageId, entry.passageId)));
  }

  function renderHechoSummary() {
    ensureHechoSummary();
    const section = document.getElementById('hechoPassageSummary');
    if (!section) return;
    const entries = touchedEntries();
    if (!entries.length) {
      section.hidden = true;
      section.replaceChildren();
      return;
    }
    section.hidden = false;
    section.replaceChildren();
    const label = document.createElement('div');
    label.className = 'hecho-passage-summary-label';
    label.textContent = 'PASAJES MEDIDOS';
    section.appendChild(label);
    entries.forEach(entry => {
      const passage = passageById(entry.passageId);
      if (!passage) return;
      const row = document.createElement('div');
      row.className = 'hecho-passage-summary-row';
      const name = document.createElement('span');
      name.textContent = passage.name;
      const detail = document.createElement('strong');
      const focused = liveFocusedMs(entry.passageId);
      const sessionObservations = passageObservations(entry.passageId)
        .filter(item => item && draft && item.sessionId === draft.id && item.score != null)
        .sort((a, b) => parseTime(a.recordedAt) - parseTime(b.recordedAt));
      const lastSessionScore = sessionObservations.length ? sessionObservations[sessionObservations.length - 1].score : null;
      const legacyScore = entry.postScore != null ? entry.postScore : entry.coldScore;
      const score = lastSessionScore != null ? lastSessionScore : legacyScore;
      detail.textContent = formatMs(focused) + ' · ' + (score == null ? 'sin medida' : score + '%') +
        (sessionObservations.length > 1 ? ' · ' + sessionObservations.length + ' medidas' : '');
      row.append(name, detail);
      section.appendChild(row);
    });
    const note = document.createElement('small');
    note.textContent = draft && draft.masterTarget && draft.masterTarget.general
      ? 'En General, el tiempo de cada pasaje se asigna a su obra; el resto permanece en General. El total no cambia.'
      : 'El tiempo del pasaje está incluido dentro del cronómetro maestro; no se suma dos veces.';
    section.appendChild(note);
  }

  function masterSessionMs() {
    try {
      if (typeof cronoCurrentMs === 'function') {
        const value = Number(cronoCurrentMs());
        if (Number.isFinite(value)) return Math.max(0, value);
      }
    } catch (error) {}
    return null;
  }

  function generalAllocationSnapshot() {
    if (!draft || !draft.masterTarget || !draft.masterTarget.general) return null;
    const allocations = [];
    Object.values(draft.entries || {}).forEach(entry => {
      const passage = passageById(entry && entry.passageId);
      const focusedMs = Math.max(0, Math.round(Number(entry && entry.focusedMs) || 0));
      if (!passage || focusedMs <= 0) return;
      allocations.push({
        passageId: passage.id,
        obraId: passage.obraId,
        movId: passage.movId == null ? null : passage.movId,
        focusedMs,
        chunks: Array.isArray(entry.chunks) ? entry.chunks.map(chunk => ({ ...chunk })) : [],
      });
    });
    if (!allocations.length) return null;
    return {
      generalObraId: draft.masterTarget.obraId,
      runId: draft.cronoRunId,
      startedAt: draft.cronoStartedAt,
      allocations,
    };
  }

  function plantMinutes(plant) {
    return Math.max(0, Number(plant && (plant.mins ?? plant.min)) || 0);
  }

  function setPlantMinutes(plant, value) {
    const next = Math.max(0, Math.round((Number(value) || 0) * 1000000) / 1000000);
    if ('mins' in plant || !('min' in plant)) plant.mins = next;
    if ('min' in plant) plant.min = next;
    return next;
  }

  function parentPlantKey(plant) {
    return String(plant && (plant.id || plant.runId || [plant.obraId || '', plant.startedAt || '', plant.endedAt || ''].join('|')) || '');
  }

  function locateGeneralPlant(database, snapshot) {
    const plants = Array.isArray(database && database.sessionPlants) ? database.sessionPlants : [];
    const candidates = plants.filter(plant => plant && !plant.passageAllocationParentKey && idEqual(plant.obraId, snapshot.generalObraId));
    if (snapshot.runId) {
      const exact = candidates.find(plant => idEqual(plant.runId, snapshot.runId) || idEqual(plant.id, snapshot.runId));
      if (exact) return exact;
    }
    const started = parseTime(snapshot.startedAt);
    const nearby = candidates.filter(plant => started && Math.abs(parseTime(plant.startedAt) - started) <= 10000);
    if (nearby.length) return nearby.sort((a, b) => parseTime(b.endedAt) - parseTime(a.endedAt))[0];
    return candidates.slice().sort((a, b) => parseTime(b.endedAt || b.startedAt) - parseTime(a.endedAt || a.startedAt))[0] || null;
  }

  function allocationGroups(snapshot) {
    const groups = new Map();
    snapshot.allocations.forEach(item => {
      if (!item || !item.obraId || idEqual(item.obraId, snapshot.generalObraId)) return;
      const key = String(item.obraId) + '::' + String(item.movId == null ? '' : item.movId);
      let group = groups.get(key);
      if (!group) {
        group = { obraId: item.obraId, movId: item.movId, focusedMs: 0, passageIds: new Set(), chunks: [] };
        groups.set(key, group);
      }
      group.focusedMs += Math.max(0, Number(item.focusedMs) || 0);
      group.passageIds.add(String(item.passageId));
      if (Array.isArray(item.chunks)) group.chunks.push(...item.chunks);
    });
    return Array.from(groups.values());
  }

  function applyGeneralAllocation(snapshot) {
    if (!snapshot || !snapshot.allocations || !snapshot.allocations.length) return false;
    const database = appDb();
    if (!database || !Array.isArray(database.sessionPlants)) return false;
    const parent = locateGeneralPlant(database, snapshot);
    if (!parent) return false;
    const parentKey = parentPlantKey(parent);
    if (!parentKey) return false;

    for (let index = database.sessionPlants.length - 1; index >= 0; index -= 1) {
      const plant = database.sessionPlants[index];
      if (plant && plant.passageAllocationParentKey === parentKey && plant.passageAllocationSource === GENERAL_ALLOCATION_SOURCE) {
        database.sessionPlants.splice(index, 1);
      }
    }

    const originalMins = Math.max(0, Number(parent.passageAllocation && parent.passageAllocation.originalMins) || plantMinutes(parent));
    if (!(originalMins > 0)) return false;
    const groups = allocationGroups(snapshot).filter(group => group.focusedMs > 0);
    if (!groups.length) return false;

    const requestedMins = groups.reduce((sum, group) => sum + group.focusedMs / 60000, 0);
    const scale = requestedMins > originalMins && requestedMins > 0 ? originalMins / requestedMins : 1;
    let allocatedMins = 0;
    const children = [];

    groups.forEach((group, index) => {
      const remaining = Math.max(0, originalMins - allocatedMins);
      const raw = group.focusedMs / 60000 * scale;
      const mins = index === groups.length - 1
        ? Math.min(remaining, Math.max(0, Math.round(raw * 1000000) / 1000000))
        : Math.min(remaining, Math.max(0, Math.round(raw * 1000000) / 1000000));
      if (!(mins > 0)) return;
      allocatedMins += mins;
      const chunks = group.chunks.filter(Boolean).slice().sort((a, b) => parseTime(a.startedAt) - parseTime(b.startedAt));
      const work = findWork(group.obraId);
      const movement = group.movId != null && work && Array.isArray(work.movimientos)
        ? work.movimientos.find(item => item && idEqual(item.id, group.movId)) || null : null;
      const suffix = String(index + 1);
      const child = { ...parent };
      delete child.passageAllocation;
      child.id = parent.id ? String(parent.id) + '__passage_' + suffix : uid('passplant');
      child.runId = String(parent.runId || parent.id || parentKey) + '::passage::' + suffix;
      child.obraId = group.obraId;
      child.movId = group.movId == null ? null : group.movId;
      if (work) child.obraName = work.name || work.nombre || child.obraName;
      if (movement) child.movName = movement.name || movement.nombre || child.movName;
      child.startedAt = chunks[0] && chunks[0].startedAt || parent.startedAt;
      child.endedAt = chunks[chunks.length - 1] && chunks[chunks.length - 1].endedAt || parent.endedAt;
      child.passageAllocationParentKey = parentKey;
      child.passageAllocationSource = GENERAL_ALLOCATION_SOURCE;
      child.passageIds = Array.from(group.passageIds);
      setPlantMinutes(child, mins);
      children.push(child);
    });

    allocatedMins = Math.min(originalMins, children.reduce((sum, child) => sum + plantMinutes(child), 0));
    const residualMins = setPlantMinutes(parent, Math.max(0, originalMins - allocatedMins));
    parent.passageAllocation = {
      version: 1,
      source: GENERAL_ALLOCATION_SOURCE,
      originalMins,
      allocatedMins: Math.round(allocatedMins * 1000000) / 1000000,
      residualMins,
      children: children.map(child => child.runId),
      appliedAt: nowIso(),
    };
    database.sessionPlants.push(...children);
    database.sessionPlants.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
    persistStudyAllocation();
    return true;
  }

  function applyGeneralAllocationEventually(snapshot, attempt) {
    if (!snapshot) return;
    if (applyGeneralAllocation(snapshot)) return;
    const n = Number(attempt) || 0;
    if (n >= 4) return;
    setTimeout(() => applyGeneralAllocationEventually(snapshot, n + 1), [20, 80, 180, 420][n] || 420);
  }

  function commitDraft() {
    if (!draft || draft.committed) return [];
    flushPendingScores('session-finish-v3');
    if (activePassageId) stopActive('session-finish');
    const tracker = ensureTracker();
    const sessionTotalMs = masterSessionMs();
    const recordedAt = nowIso();
    const saved = [];
    touchedEntries().forEach(entry => {
      const passage = passageById(entry.passageId);
      if (!passage) return;
      const focusedMs = Math.max(0, Math.round(Number(entry.focusedMs) || 0));
      if (!entry.ratingTouched && focusedMs <= 0) return;
      const observation = {
        id: uid('passobs'),
        passageId: passage.id,
        obraId: passage.obraId,
        movId: passage.movId == null ? null : passage.movId,
        passageName: passage.name,
        difficulty: passage.difficulty == null ? null : Number(passage.difficulty),
        recordedAt,
        sessionStartedAt: draft.cronoStartedAt || draft.startedAt,
        focusedMs,
        masterSessionMs: sessionTotalMs,
        masterWasGeneral: !!(draft.masterTarget && draft.masterTarget.general),
        coldScore: entry.coldScore == null ? null : Number(entry.coldScore),
        coldCapturedAt: entry.coldCapturedAt || null,
        postScore: entry.postScore == null ? null : Number(entry.postScore),
        postCapturedAt: entry.postCapturedAt || null,
        focusChunks: (entry.chunks || []).map(chunk => ({ ...chunk })),
        source: 'passage-tracker-v3',
      };
      tracker.observations.push(observation);
      saved.push(observation);
    });
    draft.committed = true;
    tracker.updatedAt = recordedAt;
    persistData();
    return saved;
  }

  function resetDraft() {
    if (activePassageId) stopActive('draft-reset');
    draft = null;
    activePassageId = null;
    activeChunkStartedAt = 0;
    activeChunkIso = null;
    renderPanel();
    renderHechoSummary();
  }

  function wrapLifecycle() {
    const originalStart = window.cronoStart;
    if (typeof originalStart === 'function' && !originalStart.__passageTrackerWrapped) {
      const wrapped = function cronoStartWithPassageDraft() {
        const before = cronoState() && cronoState().state;
        const finish = value => {
          const state = cronoState();
          if (state && state.state === 'running' && before !== 'running') {
            resetDraft();
            ensureDraft();
            lastTargetKey = targetKey(currentTarget());
            renderPanel();
          }
          return value;
        };
        const result = originalStart.apply(this, arguments);
        if (result && typeof result.then === 'function') return result.then(finish);
        return finish(result);
      };
      wrapped.__passageTrackerWrapped = true;
      window.cronoStart = wrapped;
    }

    const originalFinish = window.cronoFinish;
    if (typeof originalFinish === 'function' && !originalFinish.__passageTrackerWrapped) {
      const wrapped = function cronoFinishPassageStop() {
        if (activePassageId) stopActive('master-finish');
        renderHechoSummary();
        return originalFinish.apply(this, arguments);
      };
      wrapped.__passageTrackerWrapped = true;
      window.cronoFinish = wrapped;
    }

    const originalCloseHecho = window.closeHechoDatos;
    if (typeof originalCloseHecho === 'function' && !originalCloseHecho.__passageTrackerWrapped) {
      const wrapped = function closeHechoWithPassages(saved) {
        const shouldSave = saved === true;
        const allocationSnapshot = shouldSave ? generalAllocationSnapshot() : null;
        if (shouldSave) commitDraft();
        const result = originalCloseHecho.apply(this, arguments);
        const after = value => {
          if (shouldSave) {
            applyGeneralAllocationEventually(allocationSnapshot, 0);
            const tracker = ensureTracker();
            writeMirror(tracker);
            resetDraft();
          }
          return value;
        };
        if (result && typeof result.then === 'function') return result.then(after);
        return after(result);
      };
      wrapped.__passageTrackerWrapped = true;
      window.closeHechoDatos = wrapped;
    }
  }

  function monitorApp() {
    const state = cronoState();
    const stateName = state && state.state || 'idle';
    const target = currentTarget();
    const currentKey = targetKey(target);
    if (activePassageId && stateName !== 'running') stopActive('master-' + stateName);
    if (activePassageId) {
      const passage = passageById(activePassageId);
      if (!passage || !passageMatchesTarget(passage, target)) stopActive('target-change');
    }
    if (stateName === 'running' && !draft) ensureDraft();
    if (currentKey !== lastTargetKey || stateName !== lastCronoState) {
      lastTargetKey = currentKey;
      lastCronoState = stateName;
      renderPanel();
      renderHechoSummary();
    } else renderLiveTimes();
  }

  function boot() {
    ensureUi();
    installSyncMerge();
    reconcileMirror(true);
    wrapLifecycle();
    lastTargetKey = targetKey(currentTarget());
    lastCronoState = cronoState() && cronoState().state || 'idle';
    renderPanel();
    renderHechoSummary();
    document.getElementById('cronoObraSelect')?.addEventListener('change', () => {
      if (activePassageId) stopActive('target-change');
      renderPanel();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPendingScores('passage-background-v3');
    });
    window.addEventListener('pagehide', () => flushPendingScores('passage-background-v3'));
    setInterval(monitorApp, TICK_MS);
    setInterval(() => {
      installSyncMerge();
      reconcileMirror(true);
    }, 2200);
  }

  window.PassageTracker = {
    version: VERSION,
    render: renderPanel,
    currentTarget,
    mergeTrackers,
    openEditor: openPassageEditor,
    rate: openPassageRating,
    toggleTimer: togglePassageTimer,
    recordObservation: commitInlineScore,
    flushPendingScores,
    commitDraft,
    resetDraft,
    applyGeneralAllocation,
    getDraft: () => draft,
    getTracker: () => trackerShape(ensureTracker()),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}());
