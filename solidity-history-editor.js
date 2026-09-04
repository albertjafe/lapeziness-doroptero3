/* Historial visual y editable de solidez para obra y movimientos. */
(function solidityHistoryEditor() {
  'use strict';

  const state = {
    workId: null,
    filter: 'all',
    rows: [],
    message: '',
    success: false,
  };
  let overlay = null;

  function appData() {
    try { if (typeof db !== 'undefined' && db) return db; } catch (error) {}
    try { if (typeof DB !== 'undefined' && DB) return DB; } catch (error) {}
    return null;
  }

  function workById(id) {
    const data = appData();
    return data && Array.isArray(data.obras)
      ? data.obras.find(item => String(item && item.id) === String(id)) || null
      : null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function clampPct(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback == null ? 50 : clampPct(fallback, 50);
    return Math.max(1, Math.min(100, Math.round(n)));
  }

  function scoreFrom(raw) {
    if (window.SolidityModel && typeof window.SolidityModel.scoreFromObservation === 'function') {
      const score = window.SolidityModel.scoreFromObservation(raw);
      if (score != null) return clampPct(score);
    }
    const direct = Number(raw && (raw.solidezPct ?? raw.val ?? raw.value ?? raw.sol));
    if (Number.isFinite(direct)) return clampPct(direct);
    const legacy = Number(raw && raw.score);
    if (Number.isFinite(legacy)) return clampPct(legacy >= 1 && legacy <= 10 ? legacy * 10 : legacy);
    return null;
  }

  function timestampFrom(raw) {
    const value = raw && (raw.endedAt || raw.completedDate || raw.startedAt || raw.at || raw.date || raw.fecha || raw.updatedAt || raw.createdAt);
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function fmtDate(time) {
    if (time == null) return 'Fecha desconocida';
    try {
      return new Intl.DateTimeFormat('es-ES', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(new Date(time));
    } catch (error) {
      return new Date(time).toLocaleString();
    }
  }

  function contextLabel(raw, source) {
    const context = String(raw && (raw.context || raw.momento || raw.tipo || raw.type) || '').trim();
    if (context) return context.replace(/-/g, ' ');
    return source === 'pass' ? 'pase' : 'registro de solidez';
  }

  function correctionCount(raw) {
    return Array.isArray(raw && raw.corrections) ? raw.corrections.length : (raw && raw.correctedAt ? 1 : 0);
  }

  function makeRow(entity, scope, scopeLabel, movementId, source, raw, sourceIndex) {
    const value = scoreFrom(raw);
    if (value == null) return null;
    const time = timestampFrom(raw);
    return {
      id: [scope, movementId || 'whole', source, raw && raw.id || raw && raw.date || raw && raw.at || 'undated', sourceIndex].join('::'),
      entity,
      scope,
      scopeLabel,
      movementId: movementId || null,
      source,
      raw,
      sourceIndex,
      time,
      context: contextLabel(raw, source),
      originalValue: value,
      value,
      corrections: correctionCount(raw),
      anomaly: null,
    };
  }

  function rowsForEntity(entity, scope, scopeLabel, movementId) {
    if (!entity) return [];
    const sol = (Array.isArray(entity.solHistory) ? entity.solHistory : [])
      .map((raw, index) => makeRow(entity, scope, scopeLabel, movementId, 'solidity', raw, index))
      .filter(Boolean);
    const passes = (Array.isArray(entity.paseHistory) ? entity.paseHistory : [])
      .map((raw, index) => makeRow(entity, scope, scopeLabel, movementId, 'pass', raw, index))
      .filter(Boolean)
      .filter(pass => !sol.some(canonical => {
        if (pass.time == null || canonical.time == null) return false;
        return Math.abs(pass.time - canonical.time) <= 1500 && Math.abs(pass.value - canonical.value) <= 6;
      }));
    return sol.concat(passes);
  }

  function collectRows(work) {
    let rows = rowsForEntity(work, 'whole', 'Obra completa', null);
    (Array.isArray(work && work.movimientos) ? work.movimientos : []).forEach((movement, index) => {
      rows = rows.concat(rowsForEntity(
        movement,
        'movement',
        movement.name || `Movimiento ${index + 1}`,
        movement.id || `index-${index}`
      ));
    });
    return rows.sort((a, b) => {
      if (a.time == null && b.time != null) return 1;
      if (a.time != null && b.time == null) return -1;
      return (a.time || 0) - (b.time || 0) || a.id.localeCompare(b.id);
    });
  }

  function fallbackOutliers(points) {
    const result = [];
    const groups = new Map();
    points.forEach((point, index) => {
      const key = `${point.scope || 'whole'}:${point.movementId || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...point, _index: index });
    });
    const median = values => {
      const sorted = values.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    groups.forEach(list => {
      list.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a._index - b._index);
      list.forEach((point, index) => {
        const neighbors = list.slice(Math.max(0, index - 2), index)
          .concat(list.slice(index + 1, index + 3));
        if (neighbors.length < 2) return;
        const scores = neighbors.map(item => item.score);
        const baseline = median(scores);
        const spread = Math.max(...scores) - Math.min(...scores);
        const threshold = Math.max(18, spread * 2.2 + 6);
        const delta = Math.abs(point.score - baseline);
        if (delta >= threshold) result.push({ point, baseline, delta, threshold, neighbors: scores });
      });
    });
    return result;
  }

  function markOutliers() {
    const points = state.rows.map(row => ({
      rowId: row.id,
      score: row.value,
      time: row.time,
      scope: row.scope,
      movementId: row.movementId,
    }));
    const anomalies = window.SolidityModel && typeof window.SolidityModel.detectOutliers === 'function'
      ? window.SolidityModel.detectOutliers(points)
      : fallbackOutliers(points);
    const byId = new Map();
    anomalies.forEach(anomaly => {
      const id = anomaly && anomaly.point && anomaly.point.rowId;
      if (id) byId.set(id, anomaly);
    });
    state.rows.forEach(row => { row.anomaly = byId.get(row.id) || null; });
  }

  function injectStyle() {
    if (document.getElementById('solidityHistoryEditorStyles')) return;
    const link = document.createElement('link');
    link.id = 'solidityHistoryEditorStyles';
    link.rel = 'stylesheet';
    link.href = './solidity-history-editor.css?v=342';
    document.head.appendChild(link);
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    injectStyle();
    overlay = document.createElement('div');
    overlay.id = 'solidityHistoryOverlay';
    overlay.className = 'solidity-history-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<section class="solidity-history-sheet" role="dialog" aria-modal="true" aria-label="Historial de solidez"><div id="solidityHistoryContent" style="display:contents"></div></section>';
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function filterKey(row) {
    return row.scope === 'whole' ? 'whole' : `movement:${row.movementId}`;
  }

  function filtersFor(work) {
    const filters = [{ key: 'all', label: 'Todo' }, { key: 'whole', label: 'Obra completa' }];
    (Array.isArray(work && work.movimientos) ? work.movimientos : []).forEach((movement, index) => {
      filters.push({ key: `movement:${movement.id || `index-${index}`}`, label: movement.name || `Movimiento ${index + 1}` });
    });
    return filters;
  }

  function pillStyle(value) {
    if (typeof window.paseLiquidStyle === 'function') return window.paseLiquidStyle(value);
    const fill = typeof window.pasePctToPosition === 'function' ? window.pasePctToPosition(value) : value;
    return `--pase-fill:${fill}%;--pase-glow:.45;--pase-glow-size:14px;--pase-color:#c8a030`;
  }

  function sliderPosition(value) {
    return typeof window.pasePctToPosition === 'function' ? window.pasePctToPosition(value) : value;
  }

  function positionToPct(value) {
    return typeof window.pasePositionToPct === 'function' ? window.pasePositionToPct(value) : clampPct(value);
  }

  function anomalyNote(row) {
    if (!row.anomaly) return '';
    const baseline = Math.round(Number(row.anomaly.baseline) || 0);
    const delta = Math.round(Number(row.anomaly.delta) || 0);
    return `<div class="solidity-history-anomaly-note">Se separa ≈${delta} puntos de las mediciones cercanas (alrededor de ${baseline}%). Puede ser correcto; solo se marca para revisarlo.</div>`;
  }

  function correctionNote(row) {
    if (!row.corrections) return '';
    const original = row.raw && (row.raw.originalSolidez ?? row.raw.originalVal);
    return `<div class="solidity-history-correction-note">Corregido anteriormente${original != null ? ` · original ${esc(original)}%` : ''}.</div>`;
  }

  function rowHtml(row) {
    const dirty = row.value !== row.originalValue;
    const classes = ['solidity-history-row'];
    if (row.anomaly) classes.push('is-anomaly');
    if (dirty) classes.push('is-dirty');
    return `<article class="${classes.join(' ')}" data-history-row="${esc(row.id)}">
      <div class="solidity-history-row-top">
        <div class="solidity-history-row-meta">
          <span class="solidity-history-date">${esc(fmtDate(row.time))}</span>
          <span class="solidity-history-scope">${esc(row.scopeLabel)}</span>
          <span class="solidity-history-context">${esc(row.context)}</span>
        </div>
        <div class="solidity-history-badges">
          ${row.anomaly ? '<span class="solidity-history-badge">Revisar</span>' : ''}
          ${row.corrections ? '<span class="solidity-history-badge corrected">Corregido</span>' : ''}
        </div>
      </div>
      <div class="solidity-history-editline">
        <div class="pase-liquid-meter compact solidity-history-pill" style="${pillStyle(row.value)}">
          <div class="pase-liquid-reservoir" aria-hidden="true"><span class="pase-liquid-fill"></span><span class="pase-liquid-glint"></span><span class="pase-liquid-orb"></span></div>
          <input class="pase-liquid-input" type="range" min="0" max="100" step="0.01" value="${sliderPosition(row.value).toFixed(2)}" data-history-slider="${esc(row.id)}" aria-label="Solidez del ${esc(fmtDate(row.time))}, ${row.value} por ciento">
        </div>
        <input class="solidity-history-number" type="number" min="1" max="100" step="1" value="${row.value}" data-history-number="${esc(row.id)}" aria-label="Valor de solidez en porcentaje">
        <button class="solidity-history-reset" type="button" data-history-reset="${esc(row.id)}">Deshacer</button>
      </div>
      ${anomalyNote(row)}
      ${correctionNote(row)}
    </article>`;
  }

  function render() {
    const work = workById(state.workId);
    const container = document.getElementById('solidityHistoryContent');
    if (!work || !container) return close();
    markOutliers();
    const filters = filtersFor(work);
    if (!filters.some(item => item.key === state.filter)) state.filter = 'all';
    const visible = state.rows.filter(row => state.filter === 'all' || filterKey(row) === state.filter);
    const anomalyCount = state.rows.filter(row => row.anomaly).length;
    const dirtyCount = state.rows.filter(row => row.value !== row.originalValue).length;
    container.innerHTML = `
      <header class="solidity-history-head">
        <div>
          <div class="solidity-history-kicker">Revisión histórica</div>
          <h2 class="solidity-history-title">Solidez · ${esc(work.name || 'Obra')}</h2>
          <div class="solidity-history-subtitle">Todas las mediciones, en vertical. Los saltos extraños se resaltan, pero nunca se corrigen automáticamente.</div>
        </div>
        <button class="solidity-history-close" type="button" data-history-close aria-label="Cerrar">×</button>
      </header>
      <div class="solidity-history-toolbar">
        <div class="solidity-history-summary">
          <span><strong>${state.rows.length}</strong> mediciones</span>
          <span class="${anomalyCount ? 'solidity-history-anomaly-count' : ''}">${anomalyCount ? `${anomalyCount} posible${anomalyCount === 1 ? '' : 's'} anomalía${anomalyCount === 1 ? '' : 's'}` : 'Sin saltos llamativos'}</span>
        </div>
        <div class="solidity-history-filters" role="tablist" aria-label="Filtrar historial">
          ${filters.map(item => `<button type="button" class="solidity-history-filter ${item.key === state.filter ? 'active' : ''}" data-history-filter="${esc(item.key)}">${esc(item.label)}</button>`).join('')}
        </div>
      </div>
      <div class="solidity-history-list">
        ${visible.length ? visible.map(rowHtml).join('') : '<div class="solidity-history-empty">No hay mediciones de solidez en este nivel todavía.</div>'}
      </div>
      <footer class="solidity-history-footer">
        <div class="solidity-history-message ${state.success ? 'success' : ''}" role="status" aria-live="polite">${esc(state.message || (dirtyCount ? `${dirtyCount} cambio${dirtyCount === 1 ? '' : 's'} sin guardar` : 'Toca cualquier punto de una píldora para ajustar el valor.'))}</div>
        <div class="solidity-history-actions">
          <button class="solidity-history-button" type="button" data-history-close>Cerrar</button>
          <button class="solidity-history-button primary" type="button" data-history-save ${dirtyCount ? '' : 'disabled'}>Guardar cambios${dirtyCount ? ` (${dirtyCount})` : ''}</button>
        </div>
      </footer>`;
    bind(container);
  }

  function rowById(id) {
    return state.rows.find(row => row.id === id) || null;
  }

  function refreshDirtyFooter() {
    const dirtyCount = state.rows.filter(row => row.value !== row.originalValue).length;
    const message = document.querySelector('#solidityHistoryOverlay .solidity-history-message');
    if (message && !state.message) {
      message.textContent = dirtyCount
        ? `${dirtyCount} cambio${dirtyCount === 1 ? '' : 's'} sin guardar`
        : 'Toca cualquier punto de una píldora para ajustar el valor.';
      message.classList.remove('success');
    }
    const saveButton = document.querySelector('#solidityHistoryOverlay [data-history-save]');
    if (saveButton) {
      saveButton.disabled = !dirtyCount;
      saveButton.textContent = `Guardar cambios${dirtyCount ? ` (${dirtyCount})` : ''}`;
    }
  }

  function updateRow(id, value, source) {
    const row = rowById(id);
    if (!row) return;
    const next = clampPct(value, row.value);
    row.value = next;
    state.message = '';
    state.success = false;
    const element = document.querySelector(`[data-history-row="${CSS.escape(id)}"]`);
    if (!element) return;
    element.classList.toggle('is-dirty', row.value !== row.originalValue);
    const meter = element.querySelector('.solidity-history-pill');
    if (meter) meter.setAttribute('style', pillStyle(next));
    const slider = element.querySelector('[data-history-slider]');
    const number = element.querySelector('[data-history-number]');
    if (slider && source !== 'slider') slider.value = sliderPosition(next).toFixed(2);
    if (number && String(number.value) !== String(next)) number.value = String(next);
    if (slider) {
      slider.dataset.paseValue = String(next);
      slider.setAttribute('aria-valuetext', `${next} por ciento`);
    }
    refreshDirtyFooter();
  }

  function bind(container) {
    container.querySelectorAll('[data-history-close]').forEach(button => button.addEventListener('click', close));
    container.querySelectorAll('[data-history-filter]').forEach(button => button.addEventListener('click', () => {
      state.filter = button.dataset.historyFilter || 'all';
      render();
    }));
    container.querySelectorAll('[data-history-slider]').forEach(input => {
      input.addEventListener('input', () => updateRow(input.dataset.historySlider, positionToPct(input.value), 'slider'));
      input.addEventListener('change', () => render());
    });
    container.querySelectorAll('[data-history-number]').forEach(input => {
      input.addEventListener('change', () => {
        updateRow(input.dataset.historyNumber, input.value, 'number');
        render();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      });
    });
    container.querySelectorAll('[data-history-reset]').forEach(button => button.addEventListener('click', () => {
      const row = rowById(button.dataset.historyReset);
      if (!row) return;
      row.value = row.originalValue;
      state.message = '';
      state.success = false;
      render();
    }));
    const saveButton = container.querySelector('[data-history-save]');
    if (saveButton) saveButton.addEventListener('click', saveChanges);
  }

  function appendCorrection(raw, from, to, at) {
    if (!raw || typeof raw !== 'object') return;
    if (!Array.isArray(raw.corrections)) raw.corrections = [];
    raw.corrections.push({ at, from, to });
    if (raw.corrections.length > 10) raw.corrections = raw.corrections.slice(-10);
    if (raw.originalSolidez == null) raw.originalSolidez = from;
    raw.correctedAt = at;
  }

  function syncMatchingPass(entity, row, to, at) {
    if (!entity || row.source !== 'solidity' || row.time == null || !Array.isArray(entity.paseHistory)) return;
    entity.paseHistory.forEach(pass => {
      const passTime = timestampFrom(pass);
      const passScore = scoreFrom(pass);
      if (passTime == null || passScore == null) return;
      if (Math.abs(passTime - row.time) > 1500 || Math.abs(passScore - row.originalValue) > 6) return;
      appendCorrection(pass, passScore, to, at);
      pass.solidezPct = to;
    });
  }

  function applyCorrection(row, at) {
    const raw = row.raw;
    const from = row.originalValue;
    const to = row.value;
    appendCorrection(raw, from, to, at);
    if (row.source === 'solidity') {
      // solHistory uses `val` in the current app. Keep the original date/context intact.
      raw.val = to;
      syncMatchingPass(row.entity, row, to, at);
    } else {
      // Legacy paseHistory could use score 1..10. An exact percent override is lossless
      // because SolidityModel gives solidezPct priority over the legacy score.
      raw.solidezPct = to;
    }
  }

  function recomputeCurrent(entity) {
    if (!entity) return;
    let current = null;
    if (window.SolidityModel && typeof window.SolidityModel.currentScore === 'function') {
      current = window.SolidityModel.currentScore(entity);
    }
    if (current == null && Array.isArray(entity.solHistory) && entity.solHistory.length) current = scoreFrom(entity.solHistory[0]);
    if (current != null) entity.sol = clampPct(current);
  }

  function saveChanges() {
    const changed = state.rows.filter(row => row.value !== row.originalValue);
    if (!changed.length) return;
    const at = new Date().toISOString();
    const entities = new Set();
    changed.forEach(row => {
      applyCorrection(row, at);
      entities.add(row.entity);
    });
    entities.forEach(recomputeCurrent);
    const work = workById(state.workId);
    recomputeCurrent(work);

    if (typeof window.saveData === 'function') window.saveData();
    else if (typeof window.save === 'function') window.save();
    if (typeof window.renderObras === 'function') window.renderObras();
    if (typeof window.renderSolidezSection === 'function') window.renderSolidezSection();
    if (typeof window.refreshPremiumWork === 'function') window.refreshPremiumWork();

    state.rows = collectRows(work);
    state.message = `${changed.length} corrección${changed.length === 1 ? '' : 'es'} guardada${changed.length === 1 ? '' : 's'}.`;
    state.success = true;
    render();
  }

  function open(workId) {
    const work = workById(workId);
    if (!work) return false;
    ensureOverlay();
    state.workId = workId;
    state.filter = 'all';
    state.rows = collectRows(work);
    state.message = '';
    state.success = false;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('solidity-history-lock');
    render();
    requestAnimationFrame(() => overlay.querySelector('[data-history-close]')?.focus());
    return true;
  }

  function close() {
    if (!overlay) return;
    const dirty = state.rows.some(row => row.value !== row.originalValue);
    if (dirty && !window.confirm('Hay correcciones de solidez sin guardar. ¿Cerrar igualmente?')) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('solidity-history-lock');
    state.workId = null;
    state.filter = 'all';
    state.rows = [];
    state.message = '';
    state.success = false;
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay && overlay.classList.contains('open')) close();
  });

  window.SolidityHistoryEditor = { open, close };
  window.dispatchEvent(new Event('solidity-history-editor-ready'));
})();
