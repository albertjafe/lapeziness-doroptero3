/* Registra únicamente el uso visible de la propia PWA.
 * No guarda texto de tareas, contenido de modales, pulsaciones ni campos escritos.
 * Los segmentos se mantienen primero en una cola local y se sincronizan cuando hay sesión Supabase. */
(function activitySelfTracker() {
  'use strict';

  const QUEUE_KEY = 'pianoAppActivityQueue_v1';
  const DEVICE_KEY = 'pianoAppActivityDevice_v1';
  const SOURCE = 'piano_app';
  const MAX_QUEUE = 400;
  const SNAPSHOT_MS = 5 * 60 * 1000;
  let current = null;
  let flushing = false;
  let booted = false;

  const VIEW_LABELS = {
    session: 'Hoy',
    cronometro: 'Cronómetro',
    obras: 'Obras',
    calendario: 'Calendario',
    casa: 'Casa',
    pulse: 'Pulso',
    salas: 'Salas',
  };

  function safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch (error) { return fallback; }
  }

  function readQueue() {
    try {
      const value = safeJsonParse(localStorage.getItem(QUEUE_KEY) || '[]', []);
      return Array.isArray(value) ? value : [];
    } catch (error) { return []; }
  }

  function writeQueue(rows) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify((Array.isArray(rows) ? rows : []).slice(-MAX_QUEUE)));
      return true;
    } catch (error) { return false; }
  }

  function randomId() {
    try { if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (error) {}
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function deviceType() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const touch = Number(navigator.maxTouchPoints || 0);
    if (/iPhone|iPod/i.test(ua)) return 'iphone';
    if (/iPad/i.test(ua) || (/Mac/i.test(platform) && touch > 1)) return 'ipad';
    if (/Windows/i.test(platform) || /Windows NT/i.test(ua)) return 'windows';
    if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return 'mac';
    return 'other';
  }

  function deviceId() {
    try {
      const existing = String(localStorage.getItem(DEVICE_KEY) || '').trim();
      if (existing) return existing;
      const created = `${deviceType()}-pwa-${randomId()}`;
      localStorage.setItem(DEVICE_KEY, created);
      return created;
    } catch (error) {
      return `${deviceType()}-pwa-session`;
    }
  }

  function activeView() {
    const element = document.querySelector('.view.active[id^="view-"]');
    const key = element ? String(element.id).replace(/^view-/, '') : 'app';
    return { key, label: VIEW_LABELS[key] || key || 'App' };
  }

  function localDate(value) {
    const date = new Date(value);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function timezoneOffsetMinutes(value) {
    return -new Date(value).getTimezoneOffset();
  }

  function startCurrent() {
    if (document.visibilityState !== 'visible' || current) return;
    const view = activeView();
    const now = new Date().toISOString();
    current = {
      external_id: `pwa:${deviceId()}:${randomId()}`,
      started_at: now,
      view_key: view.key,
      view_label: view.label,
    };
  }

  function closeCurrent(reason) {
    if (!current) return false;
    const endedAt = new Date().toISOString();
    const startMs = new Date(current.started_at).getTime();
    const endMs = new Date(endedAt).getTime();
    const segment = current;
    current = null;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs < 2000) return false;

    const queue = readQueue();
    queue.push({
      device_id: deviceId(),
      device_type: deviceType(),
      source: SOURCE,
      external_id: segment.external_id,
      started_at: segment.started_at,
      ended_at: endedAt,
      local_date: localDate(segment.started_at),
      tz_offset_minutes: timezoneOffsetMinutes(segment.started_at),
      app: 'Piano App',
      domain: null,
      category: 'piano',
      label: `App · ${segment.view_label}`,
      is_afk: false,
      close_reason: reason || 'segment',
    });
    writeQueue(queue);
    flushQueue();
    return true;
  }

  function supabaseClient() {
    try { return typeof window.getSB === 'function' ? window.getSB() : null; } catch (error) { return null; }
  }

  async function currentUser(sb) {
    if (!sb || !sb.auth || typeof sb.auth.getUser !== 'function') return null;
    try {
      const result = await sb.auth.getUser();
      return result && result.data && result.data.user || null;
    } catch (error) { return null; }
  }

  async function flushQueue() {
    if (flushing || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) return false;
    const queue = readQueue();
    if (!queue.length) return true;
    const sb = supabaseClient();
    if (!sb) return false;
    flushing = true;
    try {
      const user = await currentUser(sb);
      if (!user || !user.id) return false;
      const batch = queue.slice(0, 100).map(item => ({
        user_id: user.id,
        device_id: item.device_id,
        device_type: item.device_type,
        source: item.source,
        external_id: item.external_id,
        started_at: item.started_at,
        ended_at: item.ended_at,
        local_date: item.local_date,
        tz_offset_minutes: item.tz_offset_minutes,
        app: item.app,
        domain: item.domain,
        category: item.category,
        label: item.label,
        is_afk: Boolean(item.is_afk),
      }));
      const result = await sb.from('activity_events').insert(batch);
      if (result && result.error) throw result.error;
      writeQueue(queue.slice(batch.length));
      if (queue.length > batch.length) setTimeout(flushQueue, 50);
      return true;
    } catch (error) {
      return false;
    } finally {
      flushing = false;
    }
  }

  function wrapViewNavigation() {
    const original = window.showView;
    if (typeof original !== 'function' || original.__activitySelfWrapped) return;
    const wrapped = function showViewTracked() {
      closeCurrent('view-change');
      const result = original.apply(this, arguments);
      requestAnimationFrame(startCurrent);
      return result;
    };
    wrapped.__activitySelfWrapped = true;
    window.showView = wrapped;
  }

  function boot() {
    if (booted) return;
    booted = true;
    wrapViewNavigation();
    flushQueue();
    startCurrent();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') closeCurrent('hidden');
      else { flushQueue(); startCurrent(); }
    });
    window.addEventListener('pagehide', () => closeCurrent('pagehide'));
    window.addEventListener('online', flushQueue);
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      closeCurrent('snapshot');
      startCurrent();
    }, SNAPSHOT_MS);
  }

  window.ActivitySelfTracker = {
    flush: flushQueue,
    pending: () => readQueue().length,
    deviceId,
    deviceType,
    closeCurrent,
    startCurrent,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}());
