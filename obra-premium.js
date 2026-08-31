(function () {
  'use strict';

  const state = { id: null, mode: 'view', draft: null, message: '' };
  let overlay = null;
  const originalToggleObra = typeof window.toggleObra === 'function' ? window.toggleObra : null;
  const originalOpenObraFocus = typeof window.openObraFocus === 'function' ? window.openObraFocus : null;


  function ensureCompanionScript(id, src) {
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    document.head.appendChild(script);
  }

  // Carga ligera y global: seguimiento 1:1 del dedo y editor histórico.
  ensureCompanionScript('paseLiquidDirectTouchScript', './pase-liquid-direct-touch.js?v=1');
  ensureCompanionScript('solidityHistoryEditorScript', './solidity-history-editor.js?v=1');

  function appData() {
    try { if (typeof DB !== 'undefined' && DB) return DB; } catch (error) {}
    try { if (typeof db !== 'undefined' && db) return db; } catch (error) {}
    return null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function workById(id) {
    const current = appData();
    return current && Array.isArray(current.obras) ? current.obras.find(item => String(item.id) === String(id)) : null;
  }

  function deepClone(value) {
    try { return structuredClone(value); } catch (error) { return JSON.parse(JSON.stringify(value)); }
  }

  function fmtDuration(minutes, estimated) {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return '—';
    const rounded = Math.round(value * 2) / 2;
    return `${estimated ? '≈ ' : ''}${String(rounded).replace('.5', '½')} min`;
  }

  function fmtStudyMinutes(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (!h) return `${m} min`;
    if (!m) return `${h} h`;
    return `${h} h ${m} min`;
  }

  function studyMinutesFor(work) {
    const current = appData();
    let total = Number(work && work.minutosExtra) || 0;
    (current && current.sesiones || []).forEach(session => {
      (session && session.items || []).forEach(item => {
        if (!item || item.estudiado === false || String(item.obraId || '') !== String(work.id)) return;
        total += Number(item.minutosReales ?? item.minutosEstudiados ?? item.min ?? item.minutos ?? 0) || 0;
      });
    });
    return total;
  }

  function passCount(work) {
    let total = Array.isArray(work.paseHistory) ? work.paseHistory.length : 0;
    (work.movimientos || []).forEach(mov => { total += Array.isArray(mov.paseHistory) ? mov.paseHistory.length : 0; });
    return total;
  }

  function stageLabel(work) {
    const raw = String(work.learningStage || work.estado || '').toLowerCase();
    const labels = {
      lectura: 'Lectura', manos: 'Manos juntas', consolidando: 'Consolidando',
      mantenimiento: 'Mantenimiento', 'aprendiendo-inicial': 'Aprendiendo',
    };
    return labels[raw] || (raw ? raw.replace(/-/g, ' ') : 'Sin etapa');
  }

  function movementSolidity(mov) {
    const n = Number(mov && mov.sol);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }

  function injectStyle() {
    if (document.getElementById('obraPremiumStyles')) return;
    const link = document.createElement('link');
    link.id = 'obraPremiumStyles';
    link.rel = 'stylesheet';
    link.href = './obra-premium.css?v=1';
    document.head.appendChild(link);
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    injectStyle();
    overlay = document.createElement('div');
    overlay.className = 'obra-premium-overlay';
    overlay.id = 'obraPremiumOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<section class="obra-premium-sheet" role="dialog" aria-modal="true" aria-label="Ficha de obra"><div id="obraPremiumContent"></div></section>';
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closePremium();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function maybeCompleteMetadata(work, persist) {
    if (!window.WorkStructureCatalog || !work) return false;
    const result = window.WorkStructureCatalog.completeWorkStructure(work);
    if (!result.changed) return false;
    work.movimientos = result.work.movimientos;
    if (persist && typeof save === 'function') save();
    return true;
  }

  function headerHtml(work, editMode) {
    return `
      <header class="obra-premium-head">
        <div>
          <div class="obra-premium-eyebrow">${esc(work.composer || 'Repertorio')}</div>
          <h2 class="obra-premium-title">${esc(work.name || 'Obra sin título')}</h2>
          <div class="obra-premium-sub">
            <span>${fmtDuration(work.duracion, false)}</span>
            <span>·</span><span>${esc(stageLabel(work))}</span>
            ${work.dificultad ? `<span>·</span><span>Dificultad ${esc(work.dificultad)}/10</span>` : ''}
          </div>
        </div>
        <div class="obra-premium-head-actions">
          ${editMode ? '' : '<button class="obra-premium-secondary" type="button" data-action="edit">Editar</button>'}
          <button class="obra-premium-icon-btn" type="button" data-action="close" aria-label="Cerrar">×</button>
        </div>
      </header>`;
  }

  function viewHtml(work) {
    const movements = Array.isArray(work.movimientos) ? work.movimientos : [];
    const structure = window.WorkStructureCatalog && window.WorkStructureCatalog.matchWorkStructure(work);
    const needsMetadata = structure && (!movements.length || movements.some((mov, i) =>
      (window.WorkStructureCatalog.isGenericMovementName(mov.name) || mov.duracion == null) && structure.movements[i]
    ));
    const sol = Number.isFinite(Number(work.sol)) ? Math.round(Number(work.sol)) : null;
    const escn = Number.isFinite(Number(work.esc)) ? Math.round(Number(work.esc)) : null;
    const movementRows = movements.length ? movements.map((mov, index) => {
      const movSol = movementSolidity(mov);
      return `<div class="obra-premium-movement">
        <div class="obra-premium-mov-name"><strong>${index + 1}</strong>&nbsp;&nbsp;${esc(mov.name || `Movimiento ${index + 1}`)}</div>
        <div class="obra-premium-mov-duration">${fmtDuration(mov.duracion, Boolean(mov.duracionEstimada))}</div>
        <div class="obra-premium-mov-sol">${movSol == null ? '—' : `${movSol}%`}</div>
      </div>`;
    }).join('') : '<div class="obra-premium-empty">Todavía no hay movimientos registrados.</div>';

    return `${headerHtml(work, false)}
      <div class="obra-premium-body">
        <div class="obra-premium-meta">
          ${work.composer ? `<span class="obra-premium-chip">Compositor · <strong>${esc(work.composer)}</strong></span>` : ''}
          <span class="obra-premium-chip">Duración · <strong>${fmtDuration(work.duracion, false)}</strong></span>
          ${work.dificultad ? `<span class="obra-premium-chip">Dificultad · <strong>${esc(work.dificultad)}/10</strong></span>` : ''}
          ${movements.length ? `<span class="obra-premium-chip"><strong>${movements.length}</strong> movimientos</span>` : ''}
        </div>
        <div class="obra-premium-stats">
          <div class="obra-premium-stat"><div class="obra-premium-stat-label">Solidez</div><div class="obra-premium-stat-value">${sol == null ? '—' : `${sol}%`}</div></div>
          <div class="obra-premium-stat"><div class="obra-premium-stat-label">Escena</div><div class="obra-premium-stat-value">${escn == null ? '—' : `${escn}%`}</div></div>
          <div class="obra-premium-stat"><div class="obra-premium-stat-label">Estudiado</div><div class="obra-premium-stat-value">${esc(fmtStudyMinutes(studyMinutesFor(work)))}</div></div>
          <div class="obra-premium-stat"><div class="obra-premium-stat-label">Pases</div><div class="obra-premium-stat-value">${passCount(work)}</div></div>
        </div>
        <section class="obra-premium-section">
          <div class="obra-premium-section-head">
            <div class="obra-premium-section-title">Historial de solidez</div>
            <button type="button" class="obra-premium-enrich" data-action="solidity-history">Revisar historial</button>
          </div>
          <div class="obra-premium-edit-note">Consulta todas las píldoras de la obra y sus movimientos, detecta saltos extraños y corrige un registro histórico concreto.</div>
        </section>
        <section class="obra-premium-section">
          <div class="obra-premium-section-head">
            <div class="obra-premium-section-title">Movimientos</div>
            ${needsMetadata ? '<button type="button" class="obra-premium-enrich" data-action="enrich">Completar nombres y duraciones</button>' : ''}
          </div>
          <div class="obra-premium-movements">${movementRows}</div>
        </section>
        ${work.notes ? `<section class="obra-premium-section"><div class="obra-premium-section-title" style="margin-bottom:10px">Notas</div><div class="obra-premium-notes">${esc(work.notes)}</div></section>` : ''}
        ${state.message ? `<div class="obra-premium-edit-note" style="margin-top:16px">${esc(state.message)}</div>` : ''}
      </div>
      <footer class="obra-premium-footer">
        <button class="obra-premium-ghost" type="button" data-action="advanced">Detalles avanzados</button>
        <div class="obra-premium-footer-group">
          <button class="obra-premium-secondary" type="button" data-action="close">Cerrar</button>
          <button class="obra-premium-primary" type="button" data-action="edit">Editar obra</button>
        </div>
      </footer>`;
  }

  function editMovementHtml(mov, index) {
    return `<div class="obra-premium-edit-mov" data-mov-index="${index}">
      <div class="obra-premium-field"><label>Movimiento</label><input data-mov-field="name" value="${esc(mov.name || '')}" placeholder="Nombre del movimiento"></div>
      <div class="obra-premium-field"><label>Minutos</label><input data-mov-field="duracion" type="number" min="0" step="0.5" value="${mov.duracion == null ? '' : esc(mov.duracion)}" placeholder="—"></div>
      <button class="obra-premium-remove" type="button" data-action="remove-mov" data-index="${index}" aria-label="Eliminar movimiento">−</button>
    </div>`;
  }

  function editHtml(work) {
    const movements = Array.isArray(work.movimientos) ? work.movimientos : [];
    const structure = window.WorkStructureCatalog && window.WorkStructureCatalog.matchWorkStructure(work);
    return `${headerHtml(work, true)}
      <div class="obra-premium-body">
        <div class="obra-premium-edit-grid">
          <div class="obra-premium-field"><label>Título</label><input id="obraPremiumName" value="${esc(work.name || '')}"></div>
          <div class="obra-premium-field"><label>Compositor</label><input id="obraPremiumComposer" value="${esc(work.composer || '')}"></div>
          <div class="obra-premium-field"><label>Duración</label><input id="obraPremiumDuration" type="number" min="0" step="0.5" value="${work.duracion == null ? '' : esc(work.duracion)}"></div>
          <div class="obra-premium-field"><label>Dificultad</label><input id="obraPremiumDifficulty" type="number" min="1" max="10" step="1" value="${work.dificultad == null ? '' : esc(work.dificultad)}"></div>
        </div>
        <section class="obra-premium-section">
          <div class="obra-premium-section-head">
            <div class="obra-premium-section-title">Movimientos y duración</div>
            ${structure ? '<button class="obra-premium-enrich" type="button" data-action="enrich-draft">Completar desde catálogo</button>' : ''}
          </div>
          <div class="obra-premium-edit-movs">${movements.map(editMovementHtml).join('') || '<div class="obra-premium-empty">Añade los movimientos de esta obra.</div>'}</div>
          <button class="obra-premium-ghost" style="margin-top:10px" type="button" data-action="add-mov">+ Añadir movimiento</button>
          <div class="obra-premium-edit-note">Las duraciones del catálogo son aproximadas. Si escribes una duración tú, tu valor manda y no se sustituye automáticamente.</div>
        </section>
        <section class="obra-premium-section">
          <div class="obra-premium-field"><label>Notas</label><textarea id="obraPremiumNotes" rows="3">${esc(work.notes || '')}</textarea></div>
        </section>
      </div>
      <footer class="obra-premium-footer">
        <span></span>
        <div class="obra-premium-footer-group">
          <button class="obra-premium-secondary" type="button" data-action="cancel-edit">Cancelar</button>
          <button class="obra-premium-primary" type="button" data-action="save">Guardar cambios</button>
        </div>
      </footer>`;
  }

  function render() {
    const container = document.getElementById('obraPremiumContent');
    const work = state.mode === 'edit' ? state.draft : workById(state.id);
    if (!container || !work) return closePremium();
    container.innerHTML = state.mode === 'edit' ? editHtml(work) : viewHtml(work);
    bindActions(container);
  }

  function setDraftFromInputs() {
    if (!state.draft) return;
    const byId = id => document.getElementById(id);
    state.draft.name = byId('obraPremiumName')?.value.trim() || state.draft.name;
    state.draft.composer = byId('obraPremiumComposer')?.value.trim() || '';
    const duration = Number(byId('obraPremiumDuration')?.value);
    state.draft.duracion = Number.isFinite(duration) && duration > 0 ? duration : null;
    const difficulty = Number(byId('obraPremiumDifficulty')?.value);
    state.draft.dificultad = Number.isFinite(difficulty) && difficulty > 0 ? Math.max(1, Math.min(10, difficulty)) : state.draft.dificultad;
    state.draft.notes = byId('obraPremiumNotes')?.value || '';
    document.querySelectorAll('#obraPremiumContent [data-mov-index]').forEach(row => {
      const index = Number(row.dataset.movIndex);
      const mov = state.draft.movimientos[index];
      if (!mov) return;
      const name = row.querySelector('[data-mov-field="name"]')?.value.trim();
      const durationValue = Number(row.querySelector('[data-mov-field="duracion"]')?.value);
      if (name) mov.name = name;
      mov.duracion = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : null;
      // Any value entered in edit mode is considered the user's authority.
      if (mov.duracion != null) {
        mov.duracionEstimada = false;
        mov.duracionFuente = 'manual';
      }
    });
  }

  function saveDraft() {
    setDraftFromInputs();
    const target = workById(state.id);
    if (!target || !state.draft) return;
    const draft = state.draft;
    target.name = draft.name;
    target.composer = draft.composer;
    target.duracion = draft.duracion;
    target.dificultad = draft.dificultad;
    target.notes = draft.notes;
    target.movimientos = draft.movimientos;
    if (typeof save === 'function') save();
    if (typeof renderObras === 'function') renderObras();
    state.mode = 'view';
    state.draft = null;
    state.message = 'Cambios guardados.';
    render();
  }

  function enrich(target, isDraft) {
    if (!window.WorkStructureCatalog) return;
    const result = window.WorkStructureCatalog.completeWorkStructure(target);
    if (!result.structure) {
      state.message = 'Esta obra todavía no está en el catálogo de movimientos.';
      render();
      return;
    }
    if (!result.changed) {
      state.message = 'Los movimientos ya tienen los metadatos disponibles.';
      render();
      return;
    }
    if (isDraft) {
      state.draft = result.work;
    } else {
      const live = workById(state.id);
      live.movimientos = result.work.movimientos;
      if (typeof save === 'function') save();
      if (typeof renderObras === 'function') renderObras();
    }
    state.message = 'Movimientos completados sin sustituir tus datos manuales.';
    render();
  }

  function movementHasHistory(mov) {
    return (mov.solHistory && mov.solHistory.length) || (mov.paseHistory && mov.paseHistory.length) ||
      (mov.zoneHistory && mov.zoneHistory.length) || (mov.compasHistory && mov.compasHistory.length);
  }

  function bindActions(container) {
    container.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', event => {
        const action = button.dataset.action;
        if (action === 'close') closePremium();
        if (action === 'edit') {
          state.mode = 'edit'; state.message = ''; state.draft = deepClone(workById(state.id)); render();
        }
        if (action === 'cancel-edit') { state.mode = 'view'; state.draft = null; state.message = ''; render(); }
        if (action === 'save') saveDraft();
        if (action === 'enrich') enrich(workById(state.id), false);
        if (action === 'enrich-draft') { setDraftFromInputs(); enrich(state.draft, true); }
        if (action === 'add-mov') {
          setDraftFromInputs();
          state.draft.movimientos = Array.isArray(state.draft.movimientos) ? state.draft.movimientos : [];
          state.draft.movimientos.push({
            id: `mv${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: `Movimiento ${state.draft.movimientos.length + 1}`,
            duracion: null, dificultad: 5, apr: 1, esc: 1, sol: 1,
            solHistory: [], paseHistory: [], zoneHistory: [], compasHistory: [], lastPase: null,
          });
          render();
        }
        if (action === 'remove-mov') {
          setDraftFromInputs();
          const index = Number(button.dataset.index);
          const mov = state.draft.movimientos[index];
          if (!mov) return;
          if (movementHasHistory(mov) && !window.confirm(`“${mov.name || 'Este movimiento'}” tiene historial. ¿Eliminarlo igualmente?`)) return;
          state.draft.movimientos.splice(index, 1);
          render();
        }
        if (action === 'solidity-history') {
          const id = state.id;
          if (window.SolidityHistoryEditor && typeof window.SolidityHistoryEditor.open === 'function') {
            window.SolidityHistoryEditor.open(id);
          } else {
            state.message = 'Preparando el historial de solidez…';
            render();
            window.addEventListener('solidity-history-editor-ready', () => {
              if (window.SolidityHistoryEditor && typeof window.SolidityHistoryEditor.open === 'function') {
                window.SolidityHistoryEditor.open(id);
              }
            }, { once: true });
          }
        }
        if (action === 'advanced') {
          const id = state.id;
          closePremium();
          if (originalToggleObra) originalToggleObra.call(window, id);
          else if (originalOpenObraFocus) originalOpenObraFocus.call(window, event, id);
        }
      });
    });
  }

  function openPremium(id) {
    const work = workById(id);
    if (!work || work.tipo === 'actividad') return false;
    ensureOverlay();
    state.id = id;
    state.mode = 'view';
    state.draft = null;
    state.message = '';
    // Safe auto-enrichment: only generic names and empty durations are filled.
    maybeCompleteMetadata(work, true);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('obra-premium-lock');
    render();
    requestAnimationFrame(() => overlay.querySelector('[data-action="close"]')?.focus());
    return true;
  }

  function closePremium() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('obra-premium-lock');
    state.id = null; state.mode = 'view'; state.draft = null; state.message = '';
  }

  window.openPremiumWork = openPremium;
  window.closePremiumWork = closePremium;
  window.refreshPremiumWork = function () { if (state.id) render(); };

  if (originalToggleObra) {
    window.toggleObra = function (id) {
      if (openPremium(id)) return;
      return originalToggleObra.apply(this, arguments);
    };
  }

  if (originalOpenObraFocus) {
    window.openObraFocus = function (event, id) {
      if (event && event.target && event.target.closest && event.target.closest('button,input,select,textarea,a')) {
        return originalOpenObraFocus.apply(this, arguments);
      }
      if (openPremium(id)) return;
      return originalOpenObraFocus.apply(this, arguments);
    };
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !overlay || !overlay.classList.contains('open')) return;
    if (state.mode === 'edit') { state.mode = 'view'; state.draft = null; render(); }
    else closePremium();
  });
})();
