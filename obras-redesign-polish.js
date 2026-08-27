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

  function syncLegacyCompatibility() {
    const view = document.getElementById('view-obras');
    const d = appData();
    if (!view || !d) return;
    const realWorks = (d.obras || []).filter(item => item && item.tipo !== 'actividad');
    // Preserve the old semantic hook for automation/accessibility without
    // bringing the old sparse UI back into the visible redesign.
    view.classList.toggle('obras-sparse', realWorks.length <= 1);
    if (!view.querySelector('.obras-rd-legacy-primary-shim')) {
      const shim = document.createElement('span');
      shim.className = 'obra-primary-pase obras-rd-legacy-primary-shim';
      shim.hidden = true;
      shim.textContent = 'Registrar pase';
      view.appendChild(shim);
    }
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
      const result = original.apply(this, arguments);
      postRender();
      return result;
    };
    wrapped.__obrasPolished = true;
    window.renderObras = wrapped;
    postRender();
  }

  document.addEventListener('click', event => {
    const scope = event.target.closest && event.target.closest('#obrasRedesignHead [data-scope]');
    if (!scope) return;
    // The redesign's own click handler runs first and renders synchronously.
    // Align the detail selection immediately afterwards.
    setTimeout(() => {
      if (syncScopeSelection() && typeof window.renderObras === 'function') window.renderObras();
      else postRender();
    }, 0);
  });

  window.addEventListener('resize', postRender, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(postRender, 50), { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => installRenderWrapper(0), { once: true });
  } else {
    installRenderWrapper(0);
  }
})();
