(function () {
  'use strict';

  function appData() {
    try { if (typeof DB !== 'undefined' && DB) return DB; } catch (error) {}
    try { if (typeof db !== 'undefined' && db) return db; } catch (error) {}
    return null;
  }

  function isMasterDetail() {
    return !document.documentElement.classList.contains('platform-windows') &&
      window.innerWidth >= 980 && window.innerWidth > window.innerHeight;
  }

  function syncMasterDetailClass() {
    const view = document.getElementById('view-obras');
    if (!view) return;
    view.classList.toggle('obras-master-detail', isMasterDetail());
  }

  function disableLegacyStageEntryPoints() {
    const view = document.getElementById('view-obras');
    if (!view) return;
    const legacyMenu = document.querySelector('#obrasRdMenu [data-menu="legacy"]');
    if (legacyMenu) legacyMenu.remove();
    const more = document.getElementById('obrasMoreToggle');
    if (more) more.hidden = true;
    view.classList.remove('obras-legacy-mode', 'obras-more-open');
    const returnButton = document.getElementById('obrasLegacyReturn');
    if (returnButton) returnButton.hidden = true;
    const api = window.ObrasRedesign;
    if (api && api.state) api.state.legacy = false;
  }

  function syncLegacyCompatibility() {
    const view = document.getElementById('view-obras');
    const d = appData();
    if (!view || !d) return;
    const realWorks = (d.obras || []).filter(item => item && item.tipo !== 'actividad');
    view.classList.toggle('obras-sparse', realWorks.length <= 1);
    if (!view.querySelector('.obras-rd-legacy-primary-shim')) {
      const shim = document.createElement('span');
      shim.className = 'obra-primary-pase obras-rd-legacy-primary-shim';
      shim.hidden = true;
      shim.textContent = 'Registrar pase';
      view.appendChild(shim);
    }
    disableLegacyStageEntryPoints();
  }

  function workById(id) {
    const d = appData();
    return d && (d.obras || []).find(item => String(item.id) === String(id));
  }

  function solidityModel() {
    return window.SolidityModel || null;
  }

  function workScore(model, work) {
    return typeof model.currentWorkScore === 'function' ? model.currentWorkScore(work) : model.currentScore(work);
  }

  function workStatus(model, d, work, compact) {
    return typeof model.statusLabel === 'function' ? model.statusLabel(d, work, { compact }) : (compact ? model.shortLabel(workScore(model, work)) : model.label(workScore(model, work)));
  }

  function syncSolidityLabels() {
    const model = solidityModel();
    const d = appData();
    if (!model || !d) return;

    document.querySelectorAll('#view-obras .obras-rd-row[data-work-id]').forEach(row => {
      const work = workById(row.dataset.workId);
      if (!work) return;
      const score = workScore(model, work);
      const meta = row.querySelector('.obras-rd-meta');
      let status = meta && meta.querySelector('span');
      if (meta && !status) {
        status = document.createElement('span');
        meta.appendChild(status);
      }
      if (status) status.textContent = workStatus(model, d, work, true);
      const value = row.querySelector('.obras-rd-row-side strong');
      if (value) value.textContent = score == null ? '—' : `${score}%`;
      const side = row.querySelector('.obras-rd-row-side span');
      if (side) side.textContent = score != null && score >= 95 ? 'dominio' : score != null && score >= 80 ? 'segura' : '';
      const bar = row.querySelector('.obras-rd-solbar i');
      if (bar) bar.style.width = `${score == null ? 0 : score}%`;
    });

    const api = window.ObrasRedesign;
    if (!api || !api.state || api.state.selectedKind !== 'work') return;
    const work = workById(api.state.selectedId);
    const detail = document.getElementById('obrasRdDetail');
    if (!work || !detail) return;
    const score = workScore(model, work);
    const stats = detail.querySelector('.obras-rd-stats');
    const solidityValue = stats && stats.querySelector('div:first-child strong');
    if (solidityValue) solidityValue.textContent = score == null ? '—' : `${score}%`;

    const headerMeta = detail.querySelector('.obras-rd-detail-head p');
    if (headerMeta && !detail.querySelector('.obras-rd-detail-card.edit')) {
      const parts = [];
      if (Number(work.duracion) > 0) parts.push(`${work.duracion} min`);
      parts.push(workStatus(model, d, work, false));
      if (Number(work.dificultad) > 0) parts.push(`dificultad ${work.dificultad}/10`);
      const details = typeof model.workScoreDetails === 'function' ? model.workScoreDetails(work) : null;
      if (details && details.source === 'movements' && details.partial) parts.push(`${details.measuredMovements}/${details.totalMovements} mov. medidos`);
      headerMeta.textContent = parts.join(' · ');
    }

    const movementRows = detail.querySelectorAll('.obras-rd-movement');
    (work.movimientos || []).forEach((movement, index) => {
      const row = movementRows[index];
      if (!row) return;
      const spans = row.querySelectorAll(':scope > span');
      const movementScore = model.currentScore(movement);
      if (spans.length >= 2) spans[spans.length - 1].textContent = movementScore == null ? '—' : `${movementScore}%`;
    });
  }

  function syncScopeSelection() {
    const api = window.ObrasRedesign;
    const d = appData();
    if (!api || !api.state || !d) return false;
    const state = api.state;
    const works = (d.obras || []).filter(item => item && item.tipo !== 'actividad');
    const history = Array.isArray(d.historicalRepertoire) ? d.historicalRepertoire : [];
    let changed = false;

    if (state.scope === 'history' && state.selectedKind !== 'history') {
      const first = history[0];
      state.selectedId = first ? first.id : null;
      state.selectedKind = 'history';
      state.edit = false;
      changed = true;
    } else if (state.scope === 'active' && state.selectedKind !== 'work') {
      const first = works[0];
      state.selectedId = first ? first.id : null;
      state.selectedKind = 'work';
      state.edit = false;
      changed = true;
    }
    return changed;
  }

  function postRender() {
    syncMasterDetailClass();
    syncLegacyCompatibility();
    syncSolidityLabels();
    disableLegacyStageEntryPoints();
  }

  function renderWithoutManualStages(renderFn, context, args) {
    const d = appData();
    const saved = [];
    (d && d.obras || []).forEach(work => {
      if (!work || work.tipo === 'actividad') return;
      saved.push({ work, learningStage: work.learningStage, estado: work.estado });
      work.learningStage = '';
      work.estado = '';
    });
    try {
      return renderFn.apply(context, args);
    } finally {
      saved.forEach(item => {
        if (item.learningStage === undefined) delete item.work.learningStage;
        else item.work.learningStage = item.learningStage;
        if (item.estado === undefined) delete item.work.estado;
        else item.work.estado = item.estado;
      });
    }
  }

  function installRenderWrapper(attempt) {
    const api = window.ObrasRedesign;
    if ((!api || typeof window.renderObras !== 'function') && attempt < 80) {
      setTimeout(() => installRenderWrapper(attempt + 1), 100);
      return;
    }
    if (!api || window.renderObras.__obrasPolished) return;
    const original = window.renderObras;
    const wrapped = function () {
      const result = renderWithoutManualStages(original, this, arguments);
      postRender();
      return result;
    };
    wrapped.__obrasPolished = true;
    window.renderObras = wrapped;
    wrapped();
  }

  document.addEventListener('click', event => {
    const scope = event.target.closest && event.target.closest('#obrasRedesignHead [data-scope]');
    if (!scope) return;
    setTimeout(() => {
      if (syncScopeSelection() && typeof window.renderObras === 'function') window.renderObras();
      else postRender();
    }, 0);
  });

  window.addEventListener('solidity-model-ready', postRender);
  window.addEventListener('resize', postRender, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(postRender, 50), { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installRenderWrapper(0), { once: true });
  } else {
    installRenderWrapper(0);
  }
})();
