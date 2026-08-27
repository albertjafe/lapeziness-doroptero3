(function () {
  'use strict';

  let activeId = null;
  let observer = null;

  function appData() {
    try { if (typeof DB !== 'undefined' && DB) return DB; } catch (error) {}
    try { if (typeof db !== 'undefined' && db) return db; } catch (error) {}
    return null;
  }

  function workById(id) {
    const d = appData();
    return d && (d.obras || []).find(item => String(item.id) === String(id));
  }

  function disableLegacyDetails(overlay) {
    if (!overlay) return;
    // La ficha clásica todavía conoce campos históricos como learningStage/estado.
    // Se conservan en los datos por compatibilidad, pero ya no ofrecemos una
    // puerta visible que permita volver a editarlos como una segunda verdad.
    const advanced = overlay.querySelector('[data-action="advanced"]');
    if (advanced) advanced.remove();
  }

  function syncPremiumSolidity() {
    const model = window.SolidityModel;
    const overlay = document.getElementById('obraPremiumOverlay');
    const work = workById(activeId);
    if (!model || !overlay || !work || !overlay.classList.contains('open')) return;

    disableLegacyDetails(overlay);

    const score = model.currentScore(work);
    const sub = overlay.querySelector('.obra-premium-sub');
    if (sub) {
      const spans = sub.querySelectorAll(':scope > span');
      // headerHtml aún reserva el hueco de la antigua etapa. Lo convertimos
      // siempre en una etiqueta derivada del 0–100, nunca en un campo guardado.
      if (spans.length >= 3) spans[2].textContent = model.label(score);
    }

    const stats = overlay.querySelectorAll('.obra-premium-stat');
    stats.forEach(stat => {
      const label = stat.querySelector('.obra-premium-stat-label');
      if (!label || label.textContent.trim() !== 'Solidez') return;
      const value = stat.querySelector('.obra-premium-stat-value');
      if (value) value.textContent = score == null ? '—' : `${score}%`;
    });

    const movementRows = overlay.querySelectorAll('.obra-premium-movement');
    (work.movimientos || []).forEach((movement, index) => {
      const row = movementRows[index];
      if (!row) return;
      const value = row.querySelector('.obra-premium-mov-sol');
      const movementScore = model.currentScore(movement);
      if (value) value.textContent = movementScore == null ? '—' : `${movementScore}%`;
    });
  }

  function observePremium() {
    const overlay = document.getElementById('obraPremiumOverlay');
    if (!overlay || observer) return;
    observer = new MutationObserver(() => syncPremiumSolidity());
    observer.observe(overlay, { childList: true, subtree: true });
  }

  function install(attempt) {
    if (typeof window.openPremiumWork !== 'function') {
      if (attempt < 80) setTimeout(() => install(attempt + 1), 75);
      return;
    }
    if (window.openPremiumWork.__startupResilient) return;

    const original = window.openPremiumWork;
    const resilient = function (id) {
      activeId = id;
      const result = original.call(this, id);
      observePremium();
      const overlay = document.getElementById('obraPremiumOverlay');
      disableLegacyDetails(overlay);
      setTimeout(syncPremiumSolidity, 0);
      if (result !== false) return result;

      // During app startup the sheet module can exist a fraction before the
      // persisted repertoire has been hydrated. A real tap normally happens
      // later, but retry briefly so opening a work is deterministic everywhere.
      let retries = 0;
      const retry = () => {
        retries += 1;
        const opened = original.call(window, id);
        observePremium();
        disableLegacyDetails(document.getElementById('obraPremiumOverlay'));
        setTimeout(syncPremiumSolidity, 0);
        if (opened === false && retries < 20) setTimeout(retry, 75);
      };
      setTimeout(retry, 75);
      return false;
    };
    resilient.__startupResilient = true;
    resilient.__original = original;
    window.openPremiumWork = resilient;

    const originalClose = window.closePremiumWork;
    if (typeof originalClose === 'function' && !originalClose.__singlePillPolish) {
      const close = function () {
        const result = originalClose.apply(this, arguments);
        activeId = null;
        return result;
      };
      close.__singlePillPolish = true;
      window.closePremiumWork = close;
    }
  }

  window.addEventListener('solidity-model-ready', syncPremiumSolidity);
  install(0);
})();
