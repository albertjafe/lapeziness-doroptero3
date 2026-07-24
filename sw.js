const CACHE = 'estudio-v168';
const ASSETS = [
  './index.html',
  './styles.css?v=168',
  './app.js?v=168',
  './timer-core.js?v=168',
  './data-core.js?v=168',
  './sync-core.js?v=168',
  './push-client.js?v=168',
  './manifest.json',
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

// Allow the page to trigger an immediate activation of a newer worker.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (error) {}
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

  // External requests (Supabase, CDN, Google Fonts) pass straight through.
  if (url.origin !== self.location.origin) return;

  // Emergency updater must always come from the network.
  if (url.pathname.endsWith('/update.html') || url.searchParams.has('forceUpdate')) {
    e.respondWith(fetch(new Request(e.request, { cache: 'reload' })));
    return;
  }

  // Network-first for local files: always serve the freshest version when
  // online, and fall back to the cache when offline.
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
