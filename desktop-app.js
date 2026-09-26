/* Atajos de teclado de escritorio (solo Windows con ratón).
   - Alt+1…9: pantallas de la barra lateral, en su orden.
   - Espacio: iniciar / pausar / reanudar el cronómetro (en su pantalla y sin
     un control con el foco).
   - Esc: pulsa el «Cancelar/Cerrar» del modal superior. Nunca llama a
     closeModal directamente: cada modal conserva su lógica de cierre, y los
     que no deben cerrarse sin decidir (aviso de tarea urgente) se respetan. */
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc || !doc.documentElement.classList.contains('platform-windows')) return;
  const desktop = () => root.matchMedia && root.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches;
  const NEVER_ESCAPE = new Set(['modalCronoUrgentTaskGate', 'modalCronoTaskBreak']);
  const CLOSE_LABEL = /^(cancelar|cerrar|volver|no, gracias|ahora no|×|✕)$/i;

  const typing = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const navButtons = () => [...doc.querySelectorAll('.nav.nav-bottom :is(.nav-btn, .desktop-nav-btn)')].filter(visible);

  function topModal() {
    const open = [...doc.querySelectorAll('.modal-overlay.visible')];
    return open.length ? open[open.length - 1] : null;
  }

  function escapeModal(overlay) {
    if (NEVER_ESCAPE.has(overlay.id)) return false;
    const buttons = [...overlay.querySelectorAll('button')].filter(visible);
    const close = buttons.find(b => b.matches('.modal-close, [data-close], [aria-label="Cerrar"]')) ||
      buttons.find(b => CLOSE_LABEL.test(b.textContent.trim()));
    if (!close || close.disabled) return false;
    close.click();
    return true;
  }

  function toggleCrono() {
    const state = root.crono && root.crono.state;
    if (state === 'running' && typeof root.cronoPause === 'function') { root.cronoPause(); return true; }
    if (state === 'paused' && typeof root.cronoResume === 'function') { root.cronoResume(); return true; }
    const start = doc.getElementById('cronoStartBtn');
    if ((!state || state === 'idle') && start && visible(start) && !start.disabled) { start.click(); return true; }
    return false;
  }

  doc.addEventListener('keydown', event => {
    if (!desktop() || event.defaultPrevented || event.isComposing) return;
    const active = doc.activeElement;
    if (event.key === 'Escape') {
      const overlay = topModal();
      if (overlay && escapeModal(overlay)) event.preventDefault();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && /^Digit[1-9]$/.test(event.code)) {
      const target = navButtons()[Number(event.code.slice(5)) - 1];
      if (target && !topModal()) { event.preventDefault(); target.click(); }
      return;
    }
    if (event.code === 'Space' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.repeat) {
      if (typing(active) || (active && active !== doc.body && active.matches('button, a, [role="button"], [tabindex]'))) return;
      if (topModal() || doc.body.getAttribute('data-view') !== 'cronometro') return;
      if (toggleCrono()) event.preventDefault();
    }
  });

  // Descubribles sin manual: el atajo aparece en la ayuda emergente.
  function hints() {
    navButtons().forEach((button, index) => {
      if (index > 8 || button.dataset.dkHint) return;
      const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
      button.title = label + ' · Alt+' + (index + 1);
      button.dataset.dkHint = '1';
    });
    const start = doc.getElementById('cronoStartBtn');
    if (start && !start.dataset.dkHint) { start.title = 'Iniciar · Espacio'; start.dataset.dkHint = '1'; }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', hints, { once: true }); else hints();
  root.addEventListener('load', hints, { once: true });

  root.DesktopShortcuts = { escapeModal, toggleCrono, navButtons };
})(typeof window !== 'undefined' ? window : globalThis);
