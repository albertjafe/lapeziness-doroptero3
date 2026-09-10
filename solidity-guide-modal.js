/* Modal de ayuda detallada para la píldora de solidez del cronómetro.
 * Reutiliza la guía completa que ya mantiene planning-enhancements-v3 para
 * que la escala de Hecho y la ayuda durante una sesión nunca diverjan.
 */
(function solidityGuideModal(){
  'use strict';

  const MODAL_ID = 'cronoSolidityGuideModal';
  const TRIGGER_ID = 'cronoTargetSolidityGuideButton';
  let lastFocus = null;

  const FALLBACK_BANDS = [
    ['0–9', 'Apenas empezada', 'Estás descubriendo notas, digitación o estructura. No existe todavía un pase reconocible de principio a fin.'],
    ['10–24', 'En construcción', 'Hay fragmentos que empiezan a responder, pero todavía dependes de parar, aislar y reconstruir. Grandes zonas siguen sin estar disponibles de forma continua.'],
    ['25–39', 'Se cae', 'Reconoces casi todo el camino, pero un pase pierde el hilo, obliga a reiniciar o deja agujeros importantes. El resultado cambia muchísimo de un intento a otro.'],
    ['40–54', 'Frágil', 'Puedes llegar al final en condiciones de estudio, aunque con paradas, vacilaciones, simplificaciones o errores que rompen claramente la continuidad. Todavía hay bastante factor suerte.'],
    ['55–69', 'Estable con atención', 'La obra sale mayoritariamente entera. Hay fallos o zonas tensas, pero normalmente puedes seguir y recuperar. Necesitas vigilancia consciente para que no se desmonte.'],
    ['70–79', 'Estable', 'Los pases completos suelen funcionar. Los errores no destruyen el discurso y el plan musical sobrevive. Ya puedes trabajar más en calidad que en mera supervivencia.'],
    ['80–89', 'Segura', 'Varios pases completos son consistentes. Puedes concentrarte en sonido, fraseo y decisiones musicales sin temer constantemente una caída. Es razonable probar clase, grabación o situación de exposición.'],
    ['90–96', 'Brillante · lista para exponer', 'Funciona repetidamente incluso con presión, cansancio o una sola oportunidad. Los problemas son locales y rara vez comprometen el conjunto.'],
    ['97–99', 'Fiabilidad excepcional', 'Nivel de concurso o grabación muy asentado: múltiples pases y días confirman una consistencia extraordinaria. Aun así, 100 queda reservado para tu máximo estándar.'],
    ['100', 'Referencia', 'La tocarías ahora en público y esperarías que saliera perfecta. Es el techo subjetivo de la app, no una promesa estadística de que jamás pueda ocurrir un error.'],
  ];

  function stripIds(root) {
    if (!root?.querySelectorAll) return;
    if (root.id) root.removeAttribute('id');
    root.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  }

  function fallbackGuide() {
    const guide = document.createElement('div');
    guide.className = 'solidity-guide-v3 solidity-guide-modal-fallback';
    const rows = FALLBACK_BANDS.map(([range, label, copy]) => {
      const parts = String(range).split('–').map(Number);
      const min = Number.isFinite(parts[0]) ? parts[0] : 0;
      const max = Number.isFinite(parts[1]) ? parts[1] : min;
      return `<div class="solidity-guide-row" data-rating-min="${min}" data-rating-max="${max}"><strong>${range}</strong><span><b>${label}</b>${copy}</span></div>`;
    }).join('');
    guide.innerHTML = `
      <div class="solidity-guide-principle"><strong>Regla principal:</strong> puntúa lo que la obra puede hacer <em>hoy</em>. La cifra describe fiabilidad actual, no las horas históricas acumuladas.</div>
      <div class="solidity-guide-bands">${rows}</div>
      <p class="solidity-guide-foot"><strong>Para escena, grabación o concurso:</strong> reserva 90+ para varios pases completos y repetibles bajo condiciones parecidas a la exposición real.</p>`;
    return guide;
  }

  function guideClone() {
    const source = document.querySelector('#solidityGuideHechoV3 .solidity-guide-v3');
    if (!source) return fallbackGuide();
    const clone = source.cloneNode(true);
    stripIds(clone);
    if (clone.tagName === 'DETAILS') clone.open = true;
    clone.classList.add('solidity-guide-modal-copy');
    return clone;
  }

  function currentScore() {
    const input = document.getElementById('cronoTargetSolidityInput');
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
      if (event.target.closest('[data-solidity-guide-close]')) closeGuide();
    });
    document.body.appendChild(modal);
    return modal;
  }

  function openGuide() {
    const modal = ensureModal();
    const body = modal.querySelector('#cronoSolidityGuideBody');
    if (!body) return;
    lastFocus = document.activeElement;
    body.replaceChildren(guideClone());
    markCurrentBand(body);
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
    if (!legacy) return false;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = TRIGGER_ID;
    button.className = 'crono-target-solidity-guide-button';
    button.setAttribute('data-no-view-swipe', '');
    button.setAttribute('aria-haspopup', 'dialog');
    button.innerHTML = '<span>Guía detallada de la escala</span><b aria-hidden="true">0–100 ↗</b>';
    button.addEventListener('click', openGuide);
    legacy.replaceWith(button);
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
