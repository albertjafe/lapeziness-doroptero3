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
    const advanced = overlay.querySelector('[data-action="advanced"]');
    if (advanced) advanced.remove();
  }

  function syncPremiumSolidity() {
    const model = window.SolidityModel;
    const overlay = document.getElementById('obraPremiumOverlay');
    const work = workById(activeId);
    const d = appData();
    if (!model || !overlay || !work || !overlay.classList.contains('open')) return;

    disableLegacyDetails(overlay);

    const score = typeof model.currentWorkScore === 'function' ? model.currentWorkScore(work) : model.currentScore(work);
    const status = typeof model.statusLabel === 'function' ? model.statusLabel(d, work) : model.label(score);
    const details = typeof model.workScoreDetails === 'function' ? model.workScoreDetails(work) : null;
    const sub = overlay.querySelector('.obra-premium-sub');
    if (sub) {
      const spans = sub.querySelectorAll(':scope > span');
      if (spans.length >= 3 && spans[2].textContent !== status) spans[2].textContent = status;
      let partial = sub.querySelector('.obra-premium-derived-note');
      if (details && details.source === 'movements' && details.partial) {
        if (!partial) {
          partial = document.createElement('span');
          partial.className = 'obra-premium-derived-note';
          sub.appendChild(partial);
        }
        const partialText = `· ${details.measuredMovements}/${details.totalMovements} mov. medidos`;
        if (partial.textContent !== partialText) partial.textContent = partialText;
      } else if (partial) partial.remove();
    }

    const stats = overlay.querySelectorAll('.obra-premium-stat');
    stats.forEach(stat => {
      const label = stat.querySelector('.obra-premium-stat-label');
      if (!label || label.textContent.trim() !== 'Solidez') return;
      const value = stat.querySelector('.obra-premium-stat-value');
      const nextValue = score == null ? '—' : `${score}%`;
      if (value && value.textContent !== nextValue) value.textContent = nextValue;
    });

    const movementRows = overlay.querySelectorAll('.obra-premium-movement');
    (work.movimientos || []).forEach((movement, index) => {
      const row = movementRows[index];
      if (!row) return;
      const value = row.querySelector('.obra-premium-mov-sol');
      const movementScore = model.currentScore(movement);
      const nextValue = movementScore == null ? '—' : `${movementScore}%`;
      if (value && value.textContent !== nextValue) value.textContent = nextValue;
    });
  }

  function observePremium() {
    const overlay = document.getElementById('obraPremiumOverlay');
    if (!overlay || observer) return;
    observer = new MutationObserver(() => {
      observer.disconnect();
      syncPremiumSolidity();
      observer.observe(overlay, { childList: true, subtree: true });
    });
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
