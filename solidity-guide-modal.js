/* Modal de ayuda detallada para la píldora de solidez del cronómetro.
 * Muestra la escala de la obra que se está estudiando (obra nueva,
 * recuperación, cámara o acompañamiento) desde la fuente única de app.js, la
 * misma que da nombre a la píldora, y permite cambiar la escala de esa obra.
 */
(function solidityGuideModal(){
  'use strict';

  const MODAL_ID = 'cronoSolidityGuideModal';
  const TRIGGER_ID = 'cronoTargetSolidityGuideButton';
  let lastFocus = null;

  function currentTarget() {
    try { return typeof cronoSolidityTarget === 'function' ? cronoSolidityTarget() : null; } catch (error) { return null; }
  }

  function guideContent() {
    const target = currentTarget();
    const profile = target?.ratingProfile || 'solo';
    const guide = document.createElement('div');
    guide.className = 'solidity-guide-v3 solidity-guide-modal-copy';
    guide.dataset.ratingProfile = profile;
    guide.innerHTML = '<div class="solidity-guide-body">' +
      paseScaleGuideBodyHtml(profile, { obraId: target?.obraId || null, currentPct: currentScore() }) + '</div>';
    return guide;
  }

  function currentScore() {
    const input = document.getElementById('cronoTargetSoliditySlider');
    const data = Number(input?.dataset?.paseValue);
    if (Number.isFinite(data)) return Math.max(0, Math.min(100, Math.round(data)));
    const shown = Number(String(document.getElementById('cronoTargetSolidityValue')?.textContent || '').match(/\d+/)?.[0]);
    return Number.isFinite(shown) ? Math.max(0, Math.min(100, shown)) : null;
  }

  function markCurrentBand(root) {
    const score = currentScore();
    root.querySelectorAll('[data-rating-min][data-rating-max]').forEach(row => {
      const min = Number(row.dataset.ratingMin);
      const max = Number(row.dataset.ratingMax);
      row.classList.toggle('is-current', score != null && score >= min && score <= max);
    });
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'solidity-scale-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="solidity-scale-modal-backdrop" data-solidity-guide-close></div>
      <section class="solidity-scale-modal-card" role="dialog" aria-modal="true" aria-labelledby="cronoSolidityGuideTitle">
        <header class="solidity-scale-modal-head">
          <div>
            <span>Solidez percibida</span>
            <h2 id="cronoSolidityGuideTitle">Qué significa cada puntuación</h2>
          </div>
          <button type="button" class="solidity-scale-modal-close" data-solidity-guide-close aria-label="Cerrar guía">×</button>
        </header>
        <div class="solidity-scale-modal-body" id="cronoSolidityGuideBody"></div>
      </section>`;
    modal.addEventListener('click', event => {
      if (event.target.closest('[data-solidity-guide-close]')) { closeGuide(); return; }
      const choice = event.target.closest('[data-solidity-scale]');
      if (choice) chooseScale(choice);
    });
    document.body.appendChild(modal);
    return modal;
  }

  function renderBody(modal) {
    const body = modal.querySelector('#cronoSolidityGuideBody');
    if (!body) return;
    body.replaceChildren(guideContent());
    const target = currentTarget();
    const kicker = modal.querySelector('.solidity-scale-modal-head span');
    if (kicker) kicker.textContent = 'Escala · ' + paseProfileDefinition(target?.ratingProfile || 'solo').title;
    markCurrentBand(body);
  }

  function chooseScale(button) {
    const target = currentTarget();
    if (!target?.obraId || typeof paseSetWorkScale !== 'function') return;
    paseSetWorkScale(target.obraId, button.dataset.solidityScale || null);
    const modal = document.getElementById(MODAL_ID);
    if (modal) renderBody(modal);
    modal?.querySelector('.solidity-scale-choice.is-active')?.focus({ preventScroll:true });
  }

  function openGuide() {
    const modal = ensureModal();
    const body = modal.querySelector('#cronoSolidityGuideBody');
    if (!body) return;
    lastFocus = document.activeElement;
    renderBody(modal);
    modal.hidden = false;
    modal.classList.add('is-open');
    document.body.classList.add('solidity-scale-modal-open');
    requestAnimationFrame(() => modal.querySelector('.solidity-scale-modal-close')?.focus({ preventScroll:true }));
  }

  function closeGuide() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal || modal.hidden) return;
    modal.classList.remove('is-open');
    modal.hidden = true;
    document.body.classList.remove('solidity-scale-modal-open');
    if (lastFocus?.focus) lastFocus.focus({ preventScroll:true });
    lastFocus = null;
  }

  function replaceQuickGuide() {
    const host = document.getElementById('cronoTargetSolidity');
    if (!host || document.getElementById(TRIGGER_ID)) return false;
    const legacy = host.querySelector('.crono-target-solidity-guide');
    const summary = legacy?.querySelector('summary');
    if (!legacy || !summary) return false;

    legacy.open = false;
    legacy.classList.add('is-modal-trigger');
    summary.id = TRIGGER_ID;
    summary.classList.add('crono-target-solidity-guide-button');
    summary.setAttribute('role', 'button');
    summary.setAttribute('aria-haspopup', 'dialog');
    summary.setAttribute('aria-expanded', 'false');
    summary.innerHTML = '<span>Guía detallada de la escala</span><b aria-hidden="true">0–100 ↗</b>';
    summary.addEventListener('click', event => {
      event.preventDefault();
      legacy.open = false;
      openGuide();
    });
    legacy.addEventListener('toggle', () => {
      if (legacy.open) legacy.open = false;
    });
    return true;
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById(MODAL_ID)?.hidden) closeGuide();
  });

  function init() {
    replaceQuickGuide();
    const root = document.getElementById('view-cronometro') || document.body;
    if (root && typeof MutationObserver === 'function') {
      new MutationObserver(() => replaceQuickGuide()).observe(root, { childList:true, subtree:true });
    }
  }

  window.SolidityGuideModal = { open:openGuide, close:closeGuide, refresh:replaceQuickGuide };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
}());
