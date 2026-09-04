/* Seguimiento de pasajes difíciles dentro del cronómetro.
   El cronómetro maestro nunca se reparte automáticamente: solo se etiqueta el
   tiempo que el usuario activa explícitamente en un pasaje. */
(function passageTrackerFeature() {
  'use strict';

  const TRACKER_KEY = 'passageTracker';
  const MIRROR_KEY = 'alberto_passage_tracker_v1';
  const VERSION = 1;
  const TICK_MS = 200;

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

    const merged = {
      ...a, ...b,
      version: Math.max(a.version, b.version),
      passages: Array.from(passages.values()).sort((x, y) => parseTime(x.createdAt) - parseTime(y.createdAt)),
      observations: Array.from(observations.values()).sort((x, y) => parseTime(x.recordedAt) - parseTime(y.recordedAt)),
      updatedAt: parseTime(a.updatedAt) >= parseTime(b.updatedAt) ? a.updatedAt : b.updatedAt,
    };
    return merged;
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
    // Reads must not replace the object that commitDraft is still filling.
    let tracker = database[TRACKER_KEY];
    if (!tracker || typeof tracker !== 'object' || Array.isArray(tracker)) {
      tracker = database[TRACKER_KEY] = trackerShape(null);
    }
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
      } else {
        writeMirror(before);
      }
    } finally {
      reconcileBusy = false;
    }
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

  function currentTarget() {
    const current = cronoState();
    let resolved = null;
    if (current && current.state !== 'idle' && current.obraId) {
      resolved = { obraId: String(current.obraId), movId: current.movId != null ? String(current.movId) : null };
    } else {
      const select = document.getElementById('cronoObraSelect');
      resolved = parseSelection(select && select.value);
      if (resolved && resolved.movId != null) resolved.movId = String(resolved.movId);
    }
    if (!resolved || !resolved.obraId) return null;
    const obra = findWork(resolved.obraId);
    if (!obra || obra.tipo === 'actividad') return null;
    return { obraId: String(resolved.obraId), movId: resolved.movId == null ? null : String(resolved.movId) };
  }

  function targetKey(target) {
    return target ? target.obraId + '::' + (target.movId == null ? '' : target.movId) : '';
  }

  function movementForTarget(target) {
    const obra = target && findWork(target.obraId);
    if (!obra || target.movId == null || !Array.isArray(obra.movimientos)) return null;
    return obra.movimientos.find(item => item && idEqual(item.id, target.movId)) || null;
  }

  function targetLabel(target) {
    if (!target) return '';
    const obra = findWork(target.obraId);
    const mov = movementForTarget(target);
    const workName = obra ? (obra.name || obra.nombre || 'Obra') : 'Obra';
    return mov ? workName + ' · ' + (mov.name || mov.nombre || 'Movimiento') : workName;
  }

  function activePassages(target) {
    if (!target) return [];
    return ensureTracker().passages.filter(item => item && !item.deletedAt
      && idEqual(item.obraId, target.obraId)
      && (item.movId == null ? target.movId == null : idEqual(item.movId, target.movId)));
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
    const observation = latestObservation(id);
    if (!observation) return null;
    const value = observation.postScore != null ? observation.postScore : observation.coldScore;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function ensureDraft() {
    const state = cronoState();
    if (!draft) {
      draft = {
        id: uid('passession'),
        startedAt: nowIso(),
        cronoStartedAt: state && state.startTs ? new Date(state.startTs).toISOString() : nowIso(),
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
    if (!passage || passage.deletedAt) return;
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

  function toast(message) {
    try {
      if (typeof showToast === 'function') { showToast(message); return; }
    } catch (error) {}
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
        // The calendar may already live inside a hidden tab. Passages are an
        // independent grid item and must never inherit that tab's visibility.
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
    if (!target) { toast('Elige primero una obra o movimiento'); return; }
    const passage = id ? passageById(id) : null;
    editingPassageId = passage ? passage.id : null;
    document.getElementById('passageEditorTitle').textContent = passage ? 'Editar pasaje' : 'Añadir pasaje';
    document.getElementById('passageEditorContext').textContent = targetLabel(target);
    document.getElementById('passageEditorName').value = passage ? passage.name || '' : '';
    document.getElementById('passageEditorDifficulty').value = passage && passage.difficulty != null ? Number(passage.difficulty).toFixed(1) : '7.0';
    document.getElementById('passageDeleteBtn').hidden = !passage;
    openAppModal('modalPassageEditor');
    setTimeout(() => document.getElementById('passageEditorName')?.focus(), 60);
  }

  function savePassageEditor() {
    const target = currentTarget();
    if (!target) { toast('La obra o movimiento ha cambiado'); return; }
    const name = String(document.getElementById('passageEditorName')?.value || '').trim();
    const difficulty = clamp(document.getElementById('passageEditorDifficulty')?.value, 1, 10);
    if (!name) { toast('Pon un nombre al pasaje'); return; }
    if (!difficulty) { toast('La dificultad debe estar entre 1 y 10'); return; }
    const tracker = ensureTracker();
    const stamp = nowIso();
    if (editingPassageId) {
      const passage = passageById(editingPassageId);
      if (!passage) return;
      passage.name = name;
      passage.difficulty = Math.round(difficulty * 10) / 10;
      passage.updatedAt = stamp;
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
    document.getElementById('passageRatingContext').textContent = targetLabel({ obraId: passage.obraId, movId: passage.movId });
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
      const add = makeButton('crono-passage-add crono-passage-add-empty', '＋ Añadir pasaje', 'Añadir un pasaje difícil');
      add.addEventListener('click', () => openPassageEditor(null));
      panel.appendChild(add);
      return;
    }

    const head = document.createElement('header');
    head.className = 'crono-passage-head';
    const title = document.createElement('div');
    title.innerHTML = '<span>PASAJES</span><strong>' + passages.length + '</strong>';
    const context = document.createElement('small');
    const movement = movementForTarget(target);
    context.textContent = movement ? (movement.name || movement.nombre || 'Movimiento') : 'Obra completa';
    head.append(title, context);
    panel.appendChild(head);

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
      meta.textContent = 'D ' + Number(passage.difficulty || 0).toFixed(1);
      nameBtn.append(strong, meta);
      nameBtn.addEventListener('click', () => openPassageEditor(passage.id));

      const score = scoreDisplay(passage.id);
      const scoreBtn = makeButton('crono-passage-score' + (score.current ? ' is-current' : ''), '', 'Valorar ' + passage.name);
      const scoreLabel = document.createElement('span');
      scoreLabel.textContent = score.label;
      const scoreValue = document.createElement('strong');
      scoreValue.textContent = score.value == null ? '—' : String(Math.round(score.value));
      scoreBtn.append(scoreLabel, scoreValue);
      scoreBtn.addEventListener('click', () => openPassageRating(passage.id));

      const timerBtn = makeButton('crono-passage-timer' + (idEqual(activePassageId, passage.id) ? ' is-active' : ''), '', (idEqual(activePassageId, passage.id) ? 'Parar ' : 'Cronometrar ') + passage.name);
      const icon = document.createElement('span');
      icon.textContent = idEqual(activePassageId, passage.id) ? 'Ⅱ' : '▶';
      const time = document.createElement('strong');
      time.dataset.passageTime = passage.id;
      time.textContent = formatMs(liveFocusedMs(passage.id));
      timerBtn.append(icon, time);
      timerBtn.addEventListener('click', () => togglePassageTimer(passage.id));

      row.append(nameBtn, scoreBtn, timerBtn);
      list.appendChild(row);
    });
    panel.appendChild(list);

    const add = makeButton('crono-passage-add', '＋ Añadir', 'Añadir otro pasaje difícil');
    add.addEventListener('click', () => openPassageEditor(null));
    panel.appendChild(add);
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
      const scores = entry.postScore != null
        ? ((entry.coldScore != null ? entry.coldScore : '—') + '→' + entry.postScore)
        : (entry.coldScore != null ? 'frío ' + entry.coldScore : 'sin medida');
      detail.textContent = formatMs(focused) + ' · ' + scores;
      row.append(name, detail);
      section.appendChild(row);
    });
    const note = document.createElement('small');
    note.textContent = 'Solo este tiempo etiquetado se atribuirá a los pasajes; el resto sigue siendo estudio general.';
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

  function commitDraft() {
    if (!draft || draft.committed) return [];
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
        coldScore: entry.coldScore == null ? null : Number(entry.coldScore),
        coldCapturedAt: entry.coldCapturedAt || null,
        postScore: entry.postScore == null ? null : Number(entry.postScore),
        postCapturedAt: entry.postCapturedAt || null,
        focusChunks: (entry.chunks || []).map(chunk => ({ ...chunk })),
        source: 'passage-tracker-v1',
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
        if (shouldSave) commitDraft();
        const result = originalCloseHecho.apply(this, arguments);
        const after = value => {
          if (shouldSave) {
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
    const currentKey = targetKey(currentTarget());
    if (activePassageId && stateName !== 'running') stopActive('master-' + stateName);
    if (activePassageId) {
      const passage = passageById(activePassageId);
      if (!passage || targetKey({ obraId: String(passage.obraId), movId: passage.movId == null ? null : String(passage.movId) }) !== currentKey) {
        stopActive('target-change');
      }
    }
    if (stateName === 'running' && !draft) ensureDraft();
    if (currentKey !== lastTargetKey || stateName !== lastCronoState) {
      lastTargetKey = currentKey;
      lastCronoState = stateName;
      renderPanel();
      renderHechoSummary();
    } else {
      renderLiveTimes();
    }
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
    commitDraft,
    resetDraft,
    getDraft: () => draft,
    getTracker: () => trackerShape(ensureTracker()),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}());
