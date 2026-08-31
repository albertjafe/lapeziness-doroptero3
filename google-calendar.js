(function () {
  'use strict';

  const STORAGE_KEY = 'alberto_google_calendar_v1';
  const ENDPOINT = 'https://fexfeekifzgszluemihs.supabase.co/functions/v1/google-calendar';
  const AI_LOG_SYNC_MS = 2 * 60 * 1000;
  const EMPTY = {
    connected: false,
    layer: true,
    calendars: [],
    selectedIds: [],
    events: [],
    lastSync: null,
    aiLogScopeGranted: false,
    aiLogUrl: null,
    aiLogLastSync: null,
  };
  let state = loadState();
  let requestInFlight = null;
  let aiLogRequestInFlight = null;

  function loadState() {
    try {
      return { ...EMPTY, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch (error) {
      return { ...EMPTY };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function setStatus(text, tone) {
    const status = document.getElementById('googleCalendarStatus');
    const dot = document.getElementById('googleCalendarStatusDot');
    if (status) status.textContent = text;
    if (dot) dot.dataset.tone = tone || 'neutral';
  }

  async function sessionToken() {
    const client = typeof getSB === 'function' ? getSB() : null;
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function request(action, payload) {
    const token = await sessionToken();
    if (!token) throw new Error('Inicia sesión en la app antes de conectar Google');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'apikey': typeof SUPABASE_KEY === 'string' ? SUPABASE_KEY : '',
      },
      body: JSON.stringify({ action, ...(payload || {}) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'No se pudo contactar con Google');
    return result;
  }

  function selectedCalendarsHtml() {
    if (!state.connected || !state.calendars.length) return '';
    return '<div class="google-calendar-list" aria-label="Calendarios visibles">' + state.calendars.map(calendar => {
      const selected = state.selectedIds.includes(calendar.id);
      return '<label class="google-calendar-choice">' +
        '<input type="checkbox" ' + (selected ? 'checked' : '') + ' onchange="googleCalendarSelect(\'' + escapeJs(calendar.id) + '\',this.checked)">' +
        '<span class="google-calendar-choice-dot" style="--google-calendar-color:' + safeColor(calendar.color) + '"></span>' +
        '<span>' + escapeHtml(calendar.name) + '</span>' +
      '</label>';
    }).join('') + '</div>';
  }

  function refreshUI() {
    const connect = document.getElementById('googleCalendarConnectBtn');
    const sync = document.getElementById('googleCalendarSyncBtn');
    const disconnect = document.getElementById('googleCalendarDisconnectBtn');
    const list = document.getElementById('googleCalendarListHost');
    const toggle = document.getElementById('calendarGoogleToggle');
    if (connect) connect.hidden = state.connected;
    if (sync) sync.hidden = !state.connected;
    if (disconnect) disconnect.hidden = !state.connected;
    if (list) list.innerHTML = selectedCalendarsHtml();
    if (toggle) {
      toggle.hidden = !state.connected;
      toggle.setAttribute('aria-checked', state.layer ? 'true' : 'false');
      toggle.classList.toggle('is-active', Boolean(state.layer));
    }
    if (state.connected) {
      const suffix = state.lastSync
        ? ' · ' + new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date(state.lastSync))
        : '';
      const ai = state.aiLogScopeGranted ? ' · registro IA' : '';
      setStatus('Conectado' + ai + suffix, 'success');
    } else {
      setStatus('No conectado · solo lectura', 'neutral');
    }
  }

  async function refreshStatus(options) {
    const opts = options || {};
    if (requestInFlight) return requestInFlight;
    setStatus('Comprobando conexión…', 'loading');
    requestInFlight = request('status').then(async result => {
      state.connected = Boolean(result.connected);
      state.aiLogScopeGranted = Boolean(result.aiLogScopeGranted);
      state.aiLogUrl = result.aiLogSpreadsheetUrl || null;
      state.aiLogLastSync = result.aiLogSyncedAt || state.aiLogLastSync || null;
      if (!state.connected) {
        state.calendars = [];
        state.events = [];
        state.selectedIds = [];
        state.aiLogScopeGranted = false;
        state.aiLogUrl = null;
        state.aiLogLastSync = null;
      }
      saveState();
      refreshUI();
      if (state.connected && opts.sync) {
        await sync({ silent: true, force: true });
        await syncAiLog({ silent: true, force: true });
      }
      return result;
    }).catch(error => {
      setStatus(error.message, 'error');
      if (!opts.silent && typeof showToast === 'function') showToast(error.message);
    }).finally(() => { requestInFlight = null; });
    return requestInFlight;
  }

  async function connect() {
    const button = document.getElementById('googleCalendarConnectBtn');
    if (button) button.disabled = true;
    setStatus('Preparando conexión segura…', 'loading');
    try {
      const result = await request('authorize');
      if (!result.authUrl) throw new Error('Google no devolvió una dirección de acceso');
      window.location.assign(result.authUrl);
    } catch (error) {
      setStatus(error.message, 'error');
      if (typeof showToast === 'function') showToast(error.message);
      if (button) button.disabled = false;
    }
  }

  function syncRange() {
    const now = new Date();
    return {
      timeMin: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(),
      timeMax: new Date(now.getFullYear(), now.getMonth() + 8, 1).toISOString(),
    };
  }

  async function sync(options) {
    const opts = options || {};
    if (!state.connected) return;
    if (!opts.force && state.lastSync && Date.now() - new Date(state.lastSync).getTime() < 5 * 60 * 1000) {
      refreshUI();
      return;
    }
    const button = document.getElementById('googleCalendarSyncBtn');
    if (button) button.disabled = true;
    setStatus('Sincronizando…', 'loading');
    try {
      const result = await request('sync', { calendarIds: state.selectedIds, ...syncRange() });
      state.connected = true;
      state.calendars = Array.isArray(result.calendars) ? result.calendars : [];
      state.selectedIds = Array.isArray(result.selectedIds) ? result.selectedIds : [];
      state.events = Array.isArray(result.events) ? result.events : [];
      state.lastSync = new Date().toISOString();
      saveState();
      refreshUI();
      if (typeof renderMesCalendario === 'function') renderMesCalendario();
      if (!opts.silent && typeof showToast === 'function') showToast('Google Calendar actualizado');
      syncAiLog({ silent: true, force: true });
    } catch (error) {
      setStatus(error.message, 'error');
      if (!opts.silent && typeof showToast === 'function') showToast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function syncAiLog(options) {
    const opts = options || {};
    if (!state.connected || !state.aiLogScopeGranted) return null;
    if (aiLogRequestInFlight) return aiLogRequestInFlight;
    if (!opts.force && state.aiLogLastSync && Date.now() - new Date(state.aiLogLastSync).getTime() < AI_LOG_SYNC_MS) {
      return null;
    }
    aiLogRequestInFlight = request('ai-log-sync').then(result => {
      state.aiLogLastSync = result.syncedAt || new Date().toISOString();
      state.aiLogUrl = result.spreadsheetUrl || state.aiLogUrl || null;
      saveState();
      if (!opts.silent && typeof showToast === 'function') showToast('Registro IA actualizado');
      return result;
    }).catch(error => {
      if (/vuelve a conectar google/i.test(error.message || '')) {
        state.aiLogScopeGranted = false;
        saveState();
        refreshUI();
      }
      if (!opts.silent && typeof showToast === 'function') showToast(error.message);
      return null;
    }).finally(() => { aiLogRequestInFlight = null; });
    return aiLogRequestInFlight;
  }

  async function disconnect() {
    if (!window.confirm('¿Desconectar Google de esta app?')) return;
    try {
      await request('disconnect');
      state = { ...EMPTY };
      saveState();
      refreshUI();
      if (typeof renderMesCalendario === 'function') renderMesCalendario();
      if (typeof showToast === 'function') showToast('Google desconectado');
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message);
    }
  }

  function select(calendarId, checked) {
    const selected = new Set(state.selectedIds);
    if (checked) selected.add(calendarId);
    else selected.delete(calendarId);
    if (!selected.size) {
      if (typeof showToast === 'function') showToast('Deja al menos un calendario visible');
      refreshUI();
      return;
    }
    state.selectedIds = [...selected];
    saveState();
    sync({ force: true, silent: true });
  }

  function toggleLayer(event) {
    if (event) event.stopPropagation();
    if (!state.connected) {
      if (typeof openSettings === 'function') openSettings();
      return;
    }
    state.layer = !state.layer;
    saveState();
    refreshUI();
    if (typeof renderMesCalendario === 'function') renderMesCalendario();
  }

  function eventDate(value, allDay) {
    if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parts = value.split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2], 12);
    }
    return new Date(value);
  }

  function eventsByDay() {
    const map = {};
    if (!state.connected || !state.layer) return map;
    const selected = new Set(state.selectedIds);
    state.events.filter(event => selected.has(event.calendarId)).forEach(event => {
      const start = eventDate(event.start, event.allDay);
      const rawEnd = eventDate(event.end || event.start, event.allDay);
      if (Number.isNaN(start.getTime()) || Number.isNaN(rawEnd.getTime())) return;
      const exclusiveOffset = event.allDay ? 24 * 60 * 60 * 1000 : 1;
      const end = new Date(Math.max(start.getTime(), rawEnd.getTime() - exclusiveOffset));
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
      const final = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12);
      let guard = 0;
      while (cursor <= final && guard < 370) {
        const key = typeof calendarDateISO === 'function'
          ? calendarDateISO(cursor)
          : cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
        if (!map[key]) map[key] = [];
        map[key].push(event);
        cursor.setDate(cursor.getDate() + 1);
        guard++;
      }
    });
    return map;
  }

  function onView(name) {
    refreshUI();
    if (name === 'calendario' && state.connected) sync({ silent: true });
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function escapeJs(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#4285f4';
  }

  function installAiLogHeartbeat() {
    window.setInterval(() => {
      if (document.visibilityState === 'visible') syncAiLog({ silent: true });
    }, AI_LOG_SYNC_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncAiLog({ silent: true, force: true });
    });
    window.addEventListener('focus', () => syncAiLog({ silent: true }));
  }

  function init() {
    refreshUI();
    installAiLogHeartbeat();
    const url = new URL(window.location.href);
    const callback = url.searchParams.get('google_calendar');
    if (!callback) return;
    url.searchParams.delete('google_calendar');
    url.searchParams.delete('google_calendar_detail');
    history.replaceState({}, '', url.pathname + url.search + url.hash);
    if (callback === 'connected') {
      state.connected = true;
      saveState();
      if (typeof showToast === 'function') showToast('Google conectado');
      refreshStatus({ sync: true, silent: true });
    } else {
      if (typeof showToast === 'function') showToast('No se pudo conectar Google');
      refreshStatus({ silent: true });
    }
  }

  window.googleCalendarConnect = connect;
  window.googleCalendarSync = options => sync(options || { force: true });
  window.googleCalendarDisconnect = disconnect;
  window.googleCalendarSelect = select;
  window.toggleGoogleCalendarLayer = toggleLayer;
  window.googleCalendarEventsByDay = eventsByDay;
  window.googleCalendarRefreshStatus = refreshStatus;
  window.googleCalendarRefreshUI = refreshUI;
  window.googleCalendarOnView = onView;
  window.googleCalendarSafeColor = safeColor;
  window.googleCalendarEscapeHtml = escapeHtml;
  window.googleAiLogSync = options => syncAiLog(options || { force: true });
  window.googleAiLogUrl = () => state.aiLogUrl;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
