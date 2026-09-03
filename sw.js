const CACHE = 'estudio-v318';
const ASSETS = [
  './index.html',
  './styles.css?v=281',
  './study-session-ux.css?v=1',
  './crono-resume-layout.css?v=1',
  './piano-rooms.css?v=1',
  './crono-readiness-layout.css?v=1',
  './crono-idle-hierarchy.css?v=3',
  './crono-running-premium.css?v=1',
  './obra-premium.css?v=1',
  './obras-redesign.css?v=1',
  './obras-redesign-polish.css?v=2',
  './obras-unified-library.css?v=1',
  './work-difficulty.css?v=1',
  './event-planning.css?v=1',
  './event-planning-ui-v2.css?v=1',
  './planning-enhancements-v3.css?v=1',
  './app.js?v=281',
  './study-session-ux.js?v=1',
  './crono-resume-layout.js?v=1',
  './piano-rooms.js?v=1',
  './piano-rooms-core.js?v=1',
  './local-save-resilience.js?v=1',
  './crono-save-resilience.js?v=1',
  './update-safety.js?v=1',
  './crono-running-premium.js?v=1',
  './event-planning.js?v=1',
  './competition-planning-seed.js?v=1',
  './event-planning-ui-v2.js?v=1',
  './planning-enhancements-v3.js?v=1',
  './pase-liquid-direct-touch.js?v=1',
  './work-catalog.js?v=1',
  './work-structure-catalog.js?v=1',
  './work-difficulty-model.js?v=1',
  './work-difficulty-stored-priority.js?v=1',
  './work-difficulty-integration.js?v=1',
  './solidity-model.js?v=5',
  './readiness-pill-model.js?v=1',
  './readiness-recovery-context.js?v=2',
  './obra-premium.js?v=1',
  './obra-premium-polish.js?v=4',
  './obras-redesign.js?v=1',
  './obras-redesign-polish.js?v=6',
  './obras-unified-library.js?v=2',
  './historical-real-study-polish.js?v=1',
  './historical-events.js?v=1',
  './historical-events-details.js?v=2',
  './google-calendar.js?v=272',
  './metronome.js?v=275',
  './timer-objectives.js?v=250',
  './timer-core.js?v=264',
  './data-core.js?v=231',
  './historical-repertoire.js?v=1',
  './sync-core.js?v=210',
  './push-client.js?v=264',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(asset => new Request(asset, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function stopwatchMilestoneMinutes(payload) {
  const dataMinutes = Number(payload && payload.data && payload.data.milestoneMinutes);
  if (Number.isFinite(dataMinutes)) return dataMinutes;

  const tagMatch = String(payload && payload.tag || '').match(/^crono-milestone-.+-(\d+)$/);
  if (tagMatch) return Number(tagMatch[1]);

  const titleMatch = String(payload && payload.title || '').match(/Has logrado\s+(\d+)\s+minutos/i);
  return titleMatch ? Number(titleMatch[1]) : null;
}

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (error) {}
  const milestoneMinutes = stopwatchMilestoneMinutes(payload);
  if (milestoneMinutes != null && milestoneMinutes > 105) {
    event.waitUntil(Promise.resolve());
    return;
  }
  const title = payload.title || 'Estudio en marcha';
  const icon = new URL('./icon-192.png', self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || 'Tu sesión sigue activa.',
    tag: payload.tag || 'study-timer',
    icon,
    badge: icon,
    lang: 'es',
    renotify: true,
    data: payload.data || { view: 'cronometro' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedUrl = event.notification.data && event.notification.data.url;
  const targetUrl = requestedUrl
    ? new URL(requestedUrl, self.registration.scope).href
    : new URL('./index.html?view=cronometro', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windowClients => {
      const appClient = windowClients.find(client => client.url.startsWith(self.registration.scope));
      if (appClient) {
        appClient.postMessage({ type: 'OPEN_CRONOMETRO' });
        return appClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (url.origin !== self.location.origin) return;

  // El prototipo "Casa" 3D está retirado. index.html legacy aún referencia el
  // módulo, así que devolvemos un módulo vacío para no descargar Three.js ni
  // ejecutar el juego mientras se mantiene compatibilidad con instalaciones viejas.
  if (url.pathname.endsWith('/mystery-house.js')) {
    e.respondWith(Promise.resolve(new Response('/* retired 3D game */', {
      status: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })));
    return;
  }

  if (url.pathname.endsWith('/update.html') || url.searchParams.has('forceUpdate')) {
    e.respondWith(fetch(new Request(e.request, { cache: 'reload' })));
    return;
  }

  e.respondWith(
    fetch(new Request(e.request, { cache: 'no-store' }))
      .then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(cached =>
          cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)
        )
      )
  );
});
