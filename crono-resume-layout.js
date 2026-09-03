/* Revalida el layout del cronómetro al volver de background/orientación.
   iPadOS puede entregar durante la reanudación un viewport transitorio con las
   dimensiones anteriores; una segunda medición evita conservar ese tamaño. */
(function cronoResumeLayoutGuard() {
  'use strict';

  let settleTimers = [];
  let raf = 0;

  function cronoView() {
    return document.getElementById('view-cronometro');
  }

  function viewportSize() {
    const vv = window.visualViewport;
    const width = Math.max(320, Math.round((vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 1024));
    const height = Math.max(320, Math.round((vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 768));
    return { width, height };
  }

  function desiredRingSize(width, height) {
    if (width > height && height <= 600) return 142;
    if (width < 700) return Math.min(250, width * 0.64);
    if (width <= 1199 && height > width && height >= 760) return Math.min(225, height * 0.20);
    const largeTabletLandscape = width >= 900 && width <= 1399 && height >= 820 && width > height && width / height >= 4 / 3 && width / height <= 3 / 2;
    if (largeTabletLandscape) return height < 900 ? Math.min(182, height * 0.22) : Math.min(225, height * 0.24);
    if (width > height) return Math.min(370, height * 0.5);
    return 370;
  }

  function isCronoIdle() {
    try {
      if (typeof crono === 'object' && crono) return crono.state === 'idle';
    } catch (error) {}
    return !document.body.classList.contains('crono-running');
  }

  function geometryNeedsCompactMode() {
    if (!isCronoIdle()) return false;
    const view = cronoView();
    const start = document.getElementById('cronoStartBtn');
    const card = view && view.querySelector('.crono-idle-main');
    const drawer = document.getElementById('cronoIdleDrawer');
    if (!view || !start || !card || !drawer) return false;
    const startStyle = getComputedStyle(start);
    if (startStyle.display === 'none' || startStyle.visibility === 'hidden') return false;
    const sr = start.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const dr = drawer.getBoundingClientRect();
    if (!sr.width || !sr.height || !cr.width || !cr.height) return false;
    const outsideCard = sr.bottom > cr.bottom - 5 || sr.top < cr.top + 2;
    const invadesDrawer = dr.width && dr.height && sr.bottom > dr.top - 7 && sr.top < dr.bottom;
    return outsideCard || invadesDrawer;
  }

  function applyCurrentViewport() {
    const view = cronoView();
    if (!view) return;
    const size = viewportSize();

    /* Primero dejamos que la lógica canónica haga su trabajo. */
    try {
      if (typeof cronoSetInterfaceScale === 'function') cronoSetInterfaceScale(1, {});
      else if (typeof cronoInitInterfaceZoom === 'function') cronoInitInterfaceZoom();
    } catch (error) {}

    /* Y después escribimos explícitamente la medición ya asentada. Esto cubre
       instalaciones antiguas y reanudaciones donde no se dispara resize. */
    const ring = desiredRingSize(size.width, size.height);
    view.style.setProperty('--crono-interface-ring-size', ring.toFixed(2) + 'px');
    view.dataset.resumeViewport = size.width + 'x' + size.height;

    document.body.classList.remove('crono-resume-compact');
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (geometryNeedsCompactMode()) {
        document.body.classList.add('crono-resume-compact');
        requestAnimationFrame(() => {
          /* Si el primer reflow era todavía transitorio, una última medición
             recalcula el aro pero conserva el modo compacto si sigue haciendo falta. */
          const second = viewportSize();
          const secondRing = desiredRingSize(second.width, second.height);
          view.style.setProperty('--crono-interface-ring-size', secondRing.toFixed(2) + 'px');
          view.dataset.resumeViewport = second.width + 'x' + second.height;
          if (!geometryNeedsCompactMode()) document.body.classList.remove('crono-resume-compact');
        });
      }
    });
  }

  function settleLayout() {
    settleTimers.forEach(clearTimeout);
    settleTimers = [];
    applyCurrentViewport();
    [80, 240, 650].forEach(delay => {
      settleTimers.push(setTimeout(applyCurrentViewport, delay));
    });
  }

  window.addEventListener('pageshow', settleLayout, { passive: true });
  window.addEventListener('resize', settleLayout, { passive: true });
  window.addEventListener('orientationchange', settleLayout, { passive: true });
  window.visualViewport?.addEventListener('resize', settleLayout, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settleLayout();
  }, { passive: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', settleLayout, { once: true });
  else settleLayout();
}());

/* Pasajes difíciles: módulo compañero cargado después de app.js para poder
   enganchar el cronómetro sin aumentar todavía más el archivo principal. */
(function loadPassageTracker() {
  'use strict';
  if (window.PassageTracker || document.getElementById('passageTrackerScript')) return;

  if (!document.getElementById('passageTrackerStyles')) {
    const link = document.createElement('link');
    link.id = 'passageTrackerStyles';
    link.rel = 'stylesheet';
    link.href = './passage-tracker.css?v=1';
    document.head.appendChild(link);
  }

  const script = document.createElement('script');
  script.id = 'passageTrackerScript';
  script.src = './passage-tracker.js?v=1';
  script.async = false;
  document.head.appendChild(script);
}());
