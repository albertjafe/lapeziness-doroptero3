/* Piano Rooms: visualización local de solo lectura.
 * El monitor Python expone GET /api/state en localhost:8765.
 */
(function () {
  'use strict';

  const defaultApi = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? '/api/state' : 'http://127.0.0.1:8765/api/state';
  const API_URL = (window.PIANO_ROOMS_API_URL || localStorage.getItem('pianoRoomsApiUrl') || defaultApi).replace(/\/$/, '');
  const POLL_MS = 60 * 1000;
  let pollTimer = null;
  let clockTimer = null;
  let lastState = null;

  function el(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function localDate() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function selectedDate() { return el('pianoRoomsDate')?.value || localDate(); }
  function setStatus(text, kind) {
    const node = el('pianoRoomsStatus');
    if (!node) return;
    node.textContent = text;
    node.dataset.kind = kind || '';
  }
  function priceLabel(slot) {
    const value = Number(slot && slot.price_eur);
    return Number.isFinite(value) ? ' · ' + value.toFixed(2) + ' €' : '';
  }
  function stateClass(slot) {
    const state = String(slot && (slot.state || slot.status) || '').toLowerCase();
    if (state === 'mine' || state === 'my_booking') return 'is-mine';
    if (state === 'reserved' || state === 'newly_reserved') return 'is-reserved';
    if (state === 'expired_free' || state === 'free_after_start') return 'is-expired';
    if (state === 'available' || slot?.available === true) return 'is-available';
    return 'is-unknown';
  }
  function stateLabel(slot) {
    const state = String(slot && (slot.state || slot.status) || '').toLowerCase();
    if (state === 'mine' || state === 'my_booking') return 'Mi reserva';
    if (state === 'reserved' || state === 'newly_reserved') return 'Reservada durante la vigilancia';
    if (state === 'expired_free' || state === 'free_after_start') return 'Pasó libre';
    if (state === 'available' || slot?.available === true) return 'Disponible';
    return 'Sin historial suficiente';
  }
  function roomsFrom(state) {
    return Array.isArray(state?.rooms) ? state.rooms : [];
  }
  function slotsByStart(room) {
    const map = new Map();
    (room.slots || []).forEach(slot => map.set(String(slot.start), slot));
    return map;
  }
  function renderGrid(state) {
    const grid = el('pianoRoomsGrid');
    if (!grid) return;
    const rooms = roomsFrom(state);
    if (!rooms.length) {
      grid.innerHTML = '<div class="pr-empty">El monitor todavía no ha encontrado salas.</div>';
      return;
    }
    const starts = Array.from(new Set(rooms.flatMap(room => (room.slots || []).map(slot => String(slot.start)))))
      .sort((a, b) => a.localeCompare(b));
    const maps = rooms.map(slotsByStart);
    grid.style.setProperty('--pr-room-count', String(rooms.length));
    let html = '<div class="pr-grid-row pr-grid-head" role="row"><div class="pr-time-head">Hora</div>';
    html += rooms.map(room => '<div class="pr-room-head" role="columnheader" title="' + escapeHtml(room.name) + '">' + escapeHtml(room.short_name || room.name) + '</div>').join('');
    html += '</div><div class="pr-grid-body">';
    html += starts.map(start => {
      const end = maps.map(map => map.get(start)).find(Boolean)?.end || '';
      let row = '<div class="pr-grid-row pr-grid-slot-row" role="row"><div class="pr-time" role="rowheader">' + escapeHtml(start) + (end ? '<small>' + escapeHtml(end) + '</small>' : '') + '</div>';
      row += maps.map((map, index) => {
        const slot = map.get(start) || { start, end, available: false, state: 'unknown' };
        const label = stateLabel(slot);
        return '<div class="pr-slot ' + stateClass(slot) + '" role="gridcell" aria-label="' + escapeHtml(rooms[index].name + ' ' + start + ' ' + label) + '" title="' + escapeHtml(label + priceLabel(slot)) + '"><span>' + escapeHtml(label) + '</span>' + (slot.price_eur != null ? '<small>' + escapeHtml(Number(slot.price_eur).toFixed(2) + ' €') + '</small>' : '') + '</div>';
      }).join('');
      return row + '</div>';
    }).join('');
    html += '</div>';
    grid.innerHTML = html;
    positionNowLine(state);
  }
  function positionNowLine(state) {
    const line = el('pianoRoomsNowLine');
    const grid = el('pianoRoomsGrid');
    if (!line || !grid) return;
    const starts = Array.from(new Set(roomsFrom(state).flatMap(room => (room.slots || []).map(slot => String(slot.start))))).sort((a, b) => a.localeCompare(b));
    if (!starts.length) { line.hidden = true; return; }
    const first = Number(starts[0].slice(0, 2)) * 60 + Number(starts[0].slice(3, 5));
    const last = Number((starts[starts.length - 1]).slice(0, 2)) * 60 + Number(starts[starts.length - 1].slice(3, 5)) + 60;
    const now = new Date();
    const currentDate = localDate();
    if (state.date !== currentDate) { line.hidden = true; return; }
    const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    if (minutes < first || minutes > last) { line.hidden = true; return; }
    line.hidden = false;
    const rowHeight = 54;
    const top = 48 + ((minutes - first) / 60) * rowHeight;
    line.style.top = top + 'px';
    line.querySelector('span').textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }
  async function refresh() {
    const date = selectedDate();
    setStatus('Actualizando…', 'loading');
    try {
      const response = await fetch(API_URL + '?date=' + encodeURIComponent(date) + '&_=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const state = await response.json();
      lastState = state;
      renderGrid(state);
      const observed = state.observed_at ? new Date(state.observed_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—';
      setStatus('Actualizado a las ' + observed + ' · siguiente consulta en 1 minuto', 'ok');
    } catch (error) {
      setStatus('No se puede conectar con el monitor local. Ejecuta “Piano Rooms Cuadrícula.cmd”.', 'error');
      const grid = el('pianoRoomsGrid');
      if (grid && !lastState) grid.innerHTML = '<div class="pr-empty"><strong>Monitor local desconectado</strong><br>La app está lista; falta iniciar el recolector de disponibilidad.</div>';
    }
  }
  function start() {
    if (!el('view-salas')) return;
    if (!el('pianoRoomsDate').value) el('pianoRoomsDate').value = localDate();
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    refresh();
    pollTimer = setInterval(refresh, POLL_MS);
    clockTimer = setInterval(() => { if (lastState) positionNowLine(lastState); }, 15000);
  }
  function init() {
    el('pianoRoomsRefresh')?.addEventListener('click', refresh);
    el('pianoRoomsDate')?.addEventListener('change', refresh);
    window.addEventListener('app:viewchange', event => { if (event.detail?.name === 'salas') start(); });
    if (document.body.dataset.view === 'salas') start();
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();

// Pequeño bootstrap de módulos independientes cargados después de app.js.
// Mantiene el catálogo fuera del gigantesco app.js sin cambiar su lógica.
(function loadWorkCatalogAddon() {
  if (document.getElementById('workCatalogScript')) return;
  const script = document.createElement('script');
  script.id = 'workCatalogScript';
  script.src = './work-catalog.js?v=342';
  script.defer = true;
  document.head.appendChild(script);
})();
