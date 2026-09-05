const CACHE = 'estudio-v349';
const SAFE_PROMOTION_MARKER = './__safe-promotion-v1';
const ASSETS = [
  "./activity-core.js?v=342",
  "./activity-dashboard.js?v=342",
  "./activity-self-tracker.js?v=342",
  "./add-obra-premium.css?v=342",
  "./app.js?v=349",
  "./competition-planning-seed.js?v=342",
  "./crono-idle-hierarchy.css?v=342",
  "./crono-readiness-layout.css?v=342",
  "./crono-resume-layout.css?v=342",
  "./crono-resume-layout.js?v=343",
  "./crono-running-premium.css?v=342",
  "./crono-running-premium.js?v=342",
  "./crono-save-resilience.js?v=347",
  "./data-core.js?v=342",
  "./document-sync-core.js?v=344",
  "./event-data-protection.js?v=342",
  "./event-planning-ui-v2.css?v=342",
  "./event-planning-ui-v2.js?v=342",
  "./event-planning.css?v=342",
  "./event-planning.js?v=342",
  "./event-repertoire-picker.css?v=342",
  "./event-repertoire-picker.js?v=342",
  "./event-sync-core.js?v=342",
  "./google-calendar.js?v=342",
  "./historical-events-details.js?v=342",
  "./historical-events.js?v=342",
  "./historical-real-study-polish.js?v=342",
  "./historical-repertoire.js?v=342",
  "./icon-192.png",
  "./icon-512.png",
  "./icon.svg",
  "./index.html",
  "./instant-sync-resilience.js?v=342",
  "./local-save-resilience.js?v=342",
  "./manifest.json",
  "./metronome.js?v=342",
  "./obra-premium-polish.js?v=342",
  "./obra-premium.css?v=342",
  "./obra-premium.js?v=342",
  "./obras-redesign-polish.css?v=342",
  "./obras-redesign-polish.js?v=342",
  "./obras-redesign.css?v=342",
  "./obras-redesign.js?v=342",
  "./obras-unified-library.css?v=342",
  "./obras-unified-library.js?v=342",
  "./pase-liquid-direct-touch.js?v=342",
  "./passage-tracker.css?v=342",
  "./passage-tracker.js?v=342",
  "./piano-rooms-core.js?v=342",
  "./piano-rooms.css?v=342",
  "./piano-rooms.js?v=349",
  "./planning-enhancements-v3.css?v=342",
  "./planning-enhancements-v3.js?v=342",
  "./planning-enhancements-v4-speech-fix.js?v=342",
  "./planning-enhancements-v4.css?v=342",
  "./planning-enhancements-v4.js?v=342",
  "./professor-competition-deadline-bridge.js?v=342",
  "./professor-context-enrichment.js?v=342",
  "./professor-core.js?v=349",
  "./professor-dashboard.js?v=349",
  "./professor-duration-policy.js?v=349",
  "./professor-event-gate-ui.js?v=342",
  "./professor-event-gate.js?v=349",
  "./professor-handoff-resilience.js?v=349",
  "./professor-report-normalizer.js?v=342",
  "./professor-report-worker.js?v=349",
  "./professor-temporary-chat.js?v=342",
  "./push-client.js?v=342",
  "./readiness-core.js?v=342",
  "./readiness-pill-model.js?v=342",
  "./readiness-recovery-context.js?v=342",
  "./session-minutes-correction.js?v=342",
  "./solidity-history-editor.css?v=342",
  "./solidity-history-editor.js?v=342",
  "./solidity-model.js?v=342",
  "./study-session-ux.css?v=342",
  "./study-session-ux.js?v=342",
  "./styles.css?v=342",
  "./sync-core.js?v=342",
  "./task-sync-bootstrap.js?v=342",
  "./task-sync-resilience.js?v=342",
  "./timer-core.js?v=342",
  "./timer-objectives.js?v=342",
  "./update-safety.js?v=348",
  "./work-catalog.js?v=342",
  "./work-difficulty-integration.js?v=342",
  "./work-difficulty-model.js?v=342",
  "./work-difficulty-stored-priority.js?v=342",
  "./work-difficulty.css?v=342",
  "./work-structure-catalog.js?v=342"
];

/* Una versión nueva se instala en espera. Nunca se promociona sola mientras
   haya una instancia de la PWA abierta: la promoción solo ocurre después de
   que update-safety haya persistido y sincronizado los datos. */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(asset => new Request(asset, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const prior = keys.filter(k => /^estudio-v\d+$/.test(k) && k !== CACHE)
      .sort((a,b) => Number(b.slice(9)) - Number(a.slice(9)))[0];
    await Promise.all(keys.filter(k => /^estudio-v\d+$/.test(k) && k !== CACHE && k !== prior).map(k => caches.delete(k)));

    const cache = await caches.open(CACHE);
    let marker = null;
    try {
      const response = await cache.match(SAFE_PROMOTION_MARKER);
      if (response) marker = await response.json();
      if (response && typeof cache.delete === 'function') await cache.delete(SAFE_PROMOTION_MARKER);
    } catch (error) {}

    await self.clients.claim();

    /* En iOS/PWA el worker puede activarse correctamente y aun así la ventana
       que pulsó Actualizar quedarse mostrando el shell antiguo. SAFE_SKIP_WAITING
       solo llega aquí después del snapshot + sync, así que una promoción explícita
       puede forzar una navegación real. Si WebKit no conserva e.source.id (o el ID
       cambia durante activate), se refrescan como fallback todas las ventanas del
       scope. El query __pwa fuerza una navegación nueva; el worker activo devuelve
       siempre el index.html de esta misma caché, por lo que no mezcla versiones. */
    if (marker && self.clients.matchAll) {
      const windowClients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
      let targets = marker.clientId ? windowClients.filter(item => item.id === marker.clientId) : [];
      if (!targets.length) targets = windowClients.filter(item => item.url && item.url.startsWith(self.registration.scope));
      for (const client of targets) {
        let navigated = false;
        try {
          if (typeof client.navigate === 'function') {
            const target = new URL(client.url);
            target.searchParams.set('__pwa', '349');
            // Do not await navigation inside activate.waitUntil: its fetch
            // waits for activation to finish, creating a circular wait.
            client.navigate(target.href).catch(() => {});
            navigated = true;
          }
        } catch (error) {}
        try {
          if (typeof client.postMessage === 'function') client.postMessage({ type:'SAFE_UPDATE_ACTIVATED', version:'349', navigated });
        } catch (error) {}
      }
    }
  })());
});

self.addEventListener('message', e => {
  /* Ignoramos deliberadamente el mensaje legado SKIP_WAITING: versiones
     antiguas del cliente lo enviaban automáticamente y podían recargar justo
     después de introducir datos. */
  if (e.data && e.data.type === 'SAFE_SKIP_WAITING' && e.data.safe === true) {
    e.waitUntil((async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.put(SAFE_PROMOTION_MARKER, new Response(JSON.stringify({
          clientId: e.source && e.source.id || null,
          requestedAt: e.data.requestedAt || new Date().toISOString()
        }), { headers:{ 'Content-Type':'application/json' } }));
      } catch (error) {}
      await self.skipWaiting();
    })());
  }
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
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {};
  }
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

  if (url.pathname.endsWith('/mystery-house.js')) {
    e.respondWith(Promise.resolve(new Response('/* retired 3D game */', {
      status: 200,
      headers: { 'Content-Type':'application/javascript; charset=utf-8' },
    })));
    return;
  }

  if (url.pathname.endsWith('/update.html')) {
    e.respondWith(fetch(new Request(e.request, { cache: 'reload' })));
    return;
  }

  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // A deployed B must not mix its scripts with the currently controlled A HTML.
    if(e.request.mode==='navigate'){
      const shell=await cache.match('./index.html');if(shell)return shell;
    }
    const cached=await cache.match(e.request) || await caches.match(e.request);
    if(cached)return cached;
    const known=ASSETS.some(asset=>new URL(asset,self.registration.scope).pathname===url.pathname);
    const expected=ASSETS.some(asset=>new URL(asset,self.registration.scope).href===url.href);
    if(known&&!expected)return new Response('Version no disponible. Reabre la aplicación.',{status:503});
    return fetch(e.request);
  })());
});
