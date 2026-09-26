/* Ajustes: índice lateral (iPad/escritorio) que salta a cada sección y marca
   la que se está viendo. Solo navegación; no toca ningún ajuste. */
(function () {
  'use strict';
  const doc = document;
  function install() {
    const view = doc.getElementById('view-ajustes');
    const index = view && view.querySelector('.st-index');
    if (!index || index.dataset.ready) return;
    index.dataset.ready = '1';
    const links = [...index.querySelectorAll('[data-st-jump]')];
    const mark = id => links.forEach(a => a.classList.toggle('active', a.dataset.stJump === id));
    index.addEventListener('click', event => {
      const link = event.target.closest('[data-st-jump]');
      if (!link) return;
      event.preventDefault();
      const target = doc.getElementById(link.dataset.stJump);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      mark(link.dataset.stJump);
    });
    if ('IntersectionObserver' in window) {
      const seen = new Map();
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
        const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) mark(best[0]);
      }, { threshold: [0, .25, .5, .75, 1] });
      view.querySelectorAll('.st-group').forEach(g => io.observe(g));
    }
    mark(links[0] && links[0].dataset.stJump);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
