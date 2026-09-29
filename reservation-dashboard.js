/* Dashboard en vivo del monitor Asimut.
 * Lee únicamente filas protegidas por RLS y envía órdenes declarativas a una
 * cola; las operaciones reales siguen perteneciendo al monitor Python.
 */
(function reservationDashboardModule() {
  'use strict';

  const POLL_MS = 60 * 1000;
  const FRESH_MS = 90 * 1000;
  const OFFLINE_MS = 3 * 60 * 1000;
  // El puente reenvía la última instantánea como latido cada 45 s aunque el
  // bucle del monitor lleve rato sin leer Asimut (esperas tácticas, madrugada,
  // login que falla). La edad de los datos sale de observed_at, no del latido.
  const STALE_DATA_MS = 5 * 60 * 1000;
  const MODE_LABELS = {
    '1': 'Normal',
    '2': 'Grabación',
    '3': 'Solo G5',
    '4': 'Solo PAOD',
    '5': 'Calor',
  };
  let rows = [];
  let selectedSource = localStorage.getItem('reservationDashboardSource') || 'alberto';
  let pollTimer = null;
  let clockTimer = null;
  let channel = null;
  let commandChannel = null;
  let userId = null;
  let loading = false;
  let connectionNotice = null;
  const pendingCommands = new Map();
  // Menú de arranque: mismo orden y opciones que la entrada segura de Telegram.
  const STARTUP_MODES = [
    { code: '4', label: 'Seguro / PAOD', hint: 'Inicia sesión y deja el monitor en pausa' },
    { code: '1', label: 'Normal', hint: 'Monitor completo' },
    { code: '3', label: 'Solo G5', hint: 'Grupo 4 blindado' },
    { code: '2', label: 'Grabación', hint: 'G4 blindado · prioridad 113/308 · sniper 113/204' },
    { code: '5', label: 'Calor', hint: 'G5 blindado · solo reserva G4' },
  ];
  // Modos con el monitor en marcha (mismos códigos que Telegram).
  const MODE_HINTS = {
    '1': 'Vigila y reserva en los grupos 4 y 5',
    '2': 'G4 blindado · prioridad 113/308 · sniper 113/204',
    '3': 'Grupo 4 blindado: solo reserva en el 5',
    '4': 'Monitor en pausa; PAOD y Telegram siguen disponibles',
    '5': 'Grupo 5 blindado: solo reserva en el 4',
  };
  const TOGGLES = [
    { command: 'set_migration', key: 'migration_enabled', label: 'Migración', hint: 'Mueve reservas propias a un bloque mejor' },
    { command: 'set_mirror', key: 'mirror_enabled', label: 'Aulas espejo', hint: 'Prioriza tus aulas espejo y amplía reservas contiguas', optional: true },
    { command: 'set_emergency', key: 'emergency_enabled', label: 'Emergencia', hint: 'Rellena huecos de última hora entre tus reservas' },
    { command: 'set_madrugada', key: 'madrugada_enabled', label: 'Madrugada', hint: 'Permite reservar entre 23:30 y 07:30' },
    { command: 'set_aachen', key: 'aachen_only', label: 'Solo Aachen', hint: 'Busca únicamente en el campus de Aachen' },
  ];
  const TAB_KEY = 'reservationDashboardTab';
  const LAST_START_KEY = 'reservationDashboardLastStart_';
  const TABS = ['monitor', 'ajustes'];
  let activeTab = (() => { try { const saved = localStorage.getItem(TAB_KEY); return TABS.includes(saved) ? saved : 'monitor'; } catch (_) { return 'monitor'; } })();
  let modePickerOpen = false;
  let startupExpanded = false;
  let lastSummaryKey = '';
  let lastSummary = null;
  const DRAFT_MS = 20 * 1000;
  // Lo elegido en la app se ve al instante; el monitor lo confirma al publicar.
  let startupDraft = {};
  let startupDraftAt = 0;
  // Acción destructiva pendiente de confirmar: 'shutdown' | 'cancel_start'.
  let confirmAction = null;
  // «Reciclar cuota» toca una reserva real: pide un segundo toque explícito.
  let labRecycleConfirm = false;
  let confirmTimer = null;

  function el(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }
  function sourceLabel(source) { return source === 'emma' ? 'Emma' : 'Alberto'; }
  function pad(value) { return String(value).padStart(2, '0'); }
  function localIsoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function parseDate(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? new Date(time) : null;
  }
  function formatClock(value) {
    const date = parseDate(value);
    return date ? date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function formatDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—';
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('es-ES', {
      weekday: 'short', day: 'numeric', month: 'short',
    }).replace('.', '');
  }
  function ageMs(row) {
    const date = parseDate(row && (row.heartbeat_at || row.updated_at));
    return date ? Math.max(0, Date.now() - date.getTime()) : Infinity;
  }
  function relativeAge(value) {
    const date = parseDate(value);
    if (!date) return 'sin datos';
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 10) return 'ahora';
    if (seconds < 60) return `hace ${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `hace ${hours} h ${minutes % 60} min`;
  }
  /* Cuándo se leyó Asimut de verdad. Las copias que el monitor publica al caer
   * o cerrarse renuevan observed_at (el servidor sólo acepta instantáneas más
   * nuevas) y conservan la lectura real en state.last_read_at. */
  function lastReadAt(row) {
    const state = row?.state || {};
    if (state.last_read_at) return state.last_read_at;
    // Sin fecha = estado mínimo tras una caída antes de la primera lectura.
    // Con fecha pero sin last_read_at = monitor anterior al 26-09-2026.
    return state.date ? row?.observed_at || null : null;
  }
  function dataAgeMs(row) {
    const date = parseDate(lastReadAt(row));
    return date ? Math.max(0, Date.now() - date.getTime()) : Infinity;
  }
  function lastReadLabel(row) {
    return lastReadAt(row) ? relativeAge(lastReadAt(row)) : 'ninguna en esta sesión';
  }
  /* Señales distintas:
   * - latido (heartbeat_at): el programa de Windows sigue abierto y con red;
   * - monitor.online: el bucle de reservas está en marcha (false tras caída o cierre);
   * - monitor.error: el bucle cayó y el supervisor lo está reintentando;
   * - last_read_at: cuándo se leyó Asimut por última vez. */
  function monitorHealth(row, state) {
    const phase = state?.monitor?.phase;
    // Cierre limpio publicado: no es «sin señal» aunque el latido se apague.
    if (phase === 'closed') return 'closed';
    if (ageMs(row) > OFFLINE_MS) return 'offline';
    if (phase === 'awaiting_start') return 'awaiting';
    if (phase === 'starting') return 'starting';
    if (state?.monitor?.online === false) return state.monitor.error ? 'failing' : 'stopped';
    if (dataAgeMs(row) > STALE_DATA_MS) return 'stale';
    return 'live';
  }
  function errorSummary(error) {
    if (!error) return '';
    const parts = [error.attempt ? `Intento ${error.attempt}` : null, [error.kind, error.message].filter(Boolean).join(': ')];
    if (error.retry_in_s) parts.push(`reintenta en ${error.retry_in_s} s`);
    return parts.filter(Boolean).join(' · ');
  }
  // Aachen se guarda como 30xxx (convención interna del monitor); se muestra 30.xxx.
  function roomLabel(room) {
    const text = String(room == null || room === '' ? '—' : room);
    const aachen = /^30(\d{3})$/.exec(text);
    return aachen ? `30.${aachen[1]}` : text;
  }
  function currentRow() {
    return rows.find(row => row.source === selectedSource) || rows[0] || null;
  }
  function reservationMinutes(item) {
    if (!item?.start || !item?.end) return 0;
    const [sh, sm] = item.start.split(':').map(Number);
    const [eh, em] = item.end.split(':').map(Number);
    return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
  }
  function reservationMoment(day, time) {
    if (!day || !time) return null;
    const date = new Date(`${day}T${time}:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function timelineStatus(day, item) {
    const start = reservationMoment(day, item.start);
    const end = reservationMoment(day, item.end);
    const now = new Date();
    if (!start || !end) return 'scheduled';
    if (now >= start && now < end) return 'current';
    if (now >= end) return 'past';
    return 'upcoming';
  }
  function durationLabel(minutes) {
    if (!minutes) return '—';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
  }

  function setPane(name) {
    const live = el('reservationLivePanel');
    const legacy = el('reservationLegacyPanel');
    const pane = name === 'piano-rooms' ? 'piano-rooms' : 'reservations';
    if (live) live.hidden = pane !== 'reservations';
    if (legacy) legacy.hidden = pane !== 'piano-rooms';
    document.querySelectorAll('[data-reservation-pane]').forEach(button => {
      const active = button.dataset.reservationPane === pane;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    window.dispatchEvent(new CustomEvent('reservation-dashboard:pane', { detail: { name: pane } }));
    if (pane === 'reservations') start();
  }

  function setStatus(text, kind) {
    const node = el('reservationDashboardStatus');
    if (!node) return;
    node.textContent = text;
    node.dataset.kind = kind || '';
  }

  function renderSourceSwitch() {
    const wrap = el('reservationSourceSwitch');
    if (!wrap) return;
    const available = Array.from(new Set(rows.map(row => row.source).filter(Boolean)));
    if (!available.length) available.push(selectedSource);
    if (!available.includes(selectedSource)) selectedSource = available[0];
    wrap.hidden = available.length < 2;
    wrap.innerHTML = available.map(source => `
      <button type="button" data-source="${escapeHtml(source)}" class="${source === selectedSource ? 'active' : ''}">
        ${escapeHtml(sourceLabel(source))}
      </button>`).join('');
    wrap.querySelectorAll('[data-source]').forEach(button => {
      button.addEventListener('click', () => {
        selectedSource = button.dataset.source;
        localStorage.setItem('reservationDashboardSource', selectedSource);
        render();
      });
    });
  }

  function renderHero(state, row) {
    const hero = el('reservationHero');
    if (!hero) return;
    const reservations = Array.isArray(state.reservations) ? state.reservations : [];
    const current = reservations.find(item => timelineStatus(state.date, item) === 'current');
    const next = reservations.find(item => timelineStatus(state.date, item) === 'upcoming');
    const focus = current || next || reservations[reservations.length - 1];
    const health = monitorHealth(row, state);
    const offline = ['offline', 'stopped', 'failing', 'closed'].includes(health);
    let eyebrow = current ? 'Ahora mismo' : next ? 'Siguiente reserva' : reservations.length ? 'Última reserva del día' : 'Agenda libre';
    let title = focus ? `Aula ${escapeHtml(roomLabel(focus.room))}` : 'Sin reservas';
    let subtitle = focus
      ? `${escapeHtml(focus.start || '—')}–${escapeHtml(focus.end || '—')} · ${durationLabel(reservationMinutes(focus))}`
      : `No hay reservas para ${escapeHtml(formatDate(state.date))}`;
    if (health === 'awaiting') {
      eyebrow = 'Monitor abierto en el ordenador';
      title = 'Listo para arrancar';
      subtitle = 'Pulsa Iniciar para usar lo de siempre, o cambia las opciones. También desde Telegram.';
    } else if (health === 'starting') {
      eyebrow = 'Arrancando';
      title = 'Entrando en Asimut…';
      subtitle = `Modo ${escapeHtml(state.monitor.operating_mode?.name || '—')} · las reservas aparecerán tras la primera lectura`;
    } else if (health === 'closed') {
      eyebrow = 'Monitor cerrado';
      title = 'Cerrado sin errores';
      subtitle = `Se cerró ${escapeHtml(relativeAge(row.observed_at))}; para volver a abrirlo hace falta el ordenador`;
    } else if (health === 'offline') {
      eyebrow = 'Monitor sin conexión reciente';
      title = 'Estado en espera';
      subtitle = `La última señal llegó ${escapeHtml(relativeAge(row.heartbeat_at))}`;
    } else if (health === 'failing') {
      eyebrow = 'El monitor está fallando';
      title = 'No consigue leer Asimut';
      subtitle = escapeHtml(errorSummary(state.monitor.error));
    } else if (health === 'stopped') {
      eyebrow = 'Monitor detenido';
      title = 'No está leyendo Asimut';
      subtitle = `El programa sigue abierto; última lectura ${escapeHtml(lastReadLabel(row))}`;
    }
    // Reserva en curso: barra de progreso y lo que queda; próxima: cuánto falta.
    let progress = '';
    if (!['awaiting', 'starting', 'closed', 'offline', 'failing', 'stopped'].includes(health)) {
      if (current) {
        const startAt = reservationMoment(state.date, current.start);
        const endAt = reservationMoment(state.date, current.end);
        const total = endAt && startAt ? endAt - startAt : 0;
        const pct = total ? Math.max(0, Math.min(100, (Date.now() - startAt) / total * 100)) : 0;
        const left = endAt ? Math.max(0, Math.round((endAt - Date.now()) / 60000)) : 0;
        subtitle += ` · quedan ${durationLabel(left) || 'unos segundos'}`;
        progress = `<i class="rd-hero-progress" aria-hidden="true"><em style="width:${pct.toFixed(1)}%"></em></i>`;
      } else if (next) {
        const startAt = reservationMoment(state.date, next.start);
        const wait = startAt ? Math.round((startAt - Date.now()) / 60000) : 0;
        if (wait > 0) subtitle += ` · empieza en ${durationLabel(wait)}`;
      }
    }
    hero.classList.toggle('is-offline', offline);
    hero.dataset.health = health;
    hero.innerHTML = `
      <div class="rd-hero-copy">
        <span class="rd-kicker">${eyebrow}</span>
        <strong>${title}</strong>
        <span>${subtitle}</span>
        ${progress}
      </div>
      ${state.date ? `<div class="rd-hero-time">
        <span>${escapeHtml(formatDate(state.date))}</span>
        <b>${escapeHtml(formatClock(lastReadAt(row)))}</b>
        <small>última lectura</small>
      </div>` : ''}`;
  }

  function renderReservations(day, reservations, targetId) {
    const list = el(targetId);
    if (!list) return;
    const items = Array.isArray(reservations) ? reservations : [];
    if (!day) {
      // Estado mínimo publicado tras una caída antes de la primera lectura.
      list.innerHTML = '<div class="rd-empty-line"><span>Sin datos todavía</span><small>El monitor aún no ha leído Asimut en esta sesión.</small></div>';
      return;
    }
    if (!items.length) {
      list.innerHTML = '<div class="rd-empty-line"><span>Agenda despejada</span><small>No hay reservas en esta fecha.</small></div>';
      return;
    }
    list.innerHTML = items.map(item => {
      const status = timelineStatus(day, item);
      const statusLabel = status === 'current' ? 'en curso' : status === 'past' ? 'terminada' : 'próxima';
      let progress = '';
      if (status === 'current') {
        const startAt = reservationMoment(day, item.start);
        const endAt = reservationMoment(day, item.end);
        const total = endAt - startAt;
        const pct = total > 0 ? Math.max(0, Math.min(100, (Date.now() - startAt) / total * 100)) : 0;
        const left = Math.max(0, Math.round((endAt - Date.now()) / 60000));
        progress = `<span class="rd-booking-left">quedan ${durationLabel(left) || 'unos segundos'}</span><i class="rd-booking-progress" aria-hidden="true"><em style="width:${pct.toFixed(1)}%"></em></i>`;
      }
      return `<article class="rd-booking is-${status}">
        <div class="rd-booking-time"><b>${escapeHtml(item.start || '—')}</b><span>${escapeHtml(item.end || '—')}</span></div>
        <div class="rd-booking-line" aria-hidden="true"><i></i></div>
        <div class="rd-booking-main">
          <strong>Aula ${escapeHtml(roomLabel(item.room))}</strong>
          <span>${durationLabel(reservationMinutes(item))}${item.type ? ` · ${escapeHtml(item.type)}` : ''}</span>
          ${progress}
        </div>
        <div class="rd-booking-flags">
          ${item.locked ? '<span title="Reserva bloqueada">Bloqueada</span>' : ''}
          ${item.confirmed ? '<span class="is-confirmed">Confirmada</span>' : ''}
          <small>${statusLabel}</small>
        </div>
      </article>`;
    }).join('');
  }

  function quotaCard(quota) {
    const rf = Math.max(0, Number(quota?.rf_mins) || 0);
    const sz = Math.max(0, Number(quota?.sz_mins) || 0);
    const bar = (value, max) => `<i aria-hidden="true"><em style="width:${Math.min(100, value / max * 100)}%"></em></i>`;
    return `<section class="rd-card rd-quota-card" aria-label="Cuota disponible en Asimut">
      <div class="rd-quota-item"><span>RF</span><b>${rf}</b><small>min</small>${bar(rf, Math.max(480, rf))}</div>
      ${quota?.sz_applicable
        ? `<div class="rd-quota-item is-secondary"><span>SZ</span><b>${sz}</b><small>min</small>${bar(sz, Math.max(180, sz))}</div>`
        : '<div class="rd-quota-item is-muted"><span>SZ</span><small>no se aplica el fin de semana</small></div>'}
    </section>`;
  }

  /* Línea del día: tus reservas como bloques sobre la ventana del monitor
   * (10:00–20:30, ampliada si alguna reserva se sale) y una marca de «ahora». */
  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function renderDayBar(state) {
    const bar = el('reservationDayBar');
    if (!bar) return;
    const items = Array.isArray(state.reservations) ? state.reservations : [];
    if (!state.date) { bar.hidden = true; return; }
    bar.hidden = false;
    let from = toMinutes(state.monitor?.monitor_window?.start) ?? 600;
    let to = toMinutes(state.monitor?.monitor_window?.end) ?? 1230;
    items.forEach(item => {
      const a = toMinutes(item.start), b = toMinutes(item.end);
      if (a != null) from = Math.min(from, Math.floor(a / 60) * 60);
      if (b != null) to = Math.max(to, Math.ceil(b / 60) * 60);
    });
    const span = Math.max(60, to - from);
    const pos = minutes => `${((minutes - from) / span * 100).toFixed(2)}%`;
    const now = new Date();
    const isToday = state.date === localIsoDate(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const ticks = [];
    for (let h = Math.ceil(from / 60) * 60; h <= to; h += 120) ticks.push(h);
    bar.innerHTML = `
      <div class="rd-daybar-track" role="img" aria-label="Tus reservas del día sobre la franja ${escapeHtml(Math.floor(from / 60))}:00–${escapeHtml(Math.floor(to / 60))}:${pad(to % 60)}">
        ${items.map(item => {
          const a = toMinutes(item.start), b = toMinutes(item.end);
          if (a == null || b == null) return '';
          return `<i class="is-${timelineStatus(state.date, item)}" style="left:${pos(a)};width:${((b - a) / span * 100).toFixed(2)}%" title="${escapeHtml(item.start)}–${escapeHtml(item.end)} · Aula ${escapeHtml(roomLabel(item.room))}"></i>`;
        }).join('')}
        ${isToday && nowMin >= from && nowMin <= to ? `<b class="rd-daybar-now" style="left:${pos(nowMin)}"></b>` : ''}
      </div>
      <div class="rd-daybar-ticks" aria-hidden="true">${ticks.map(h => `<span style="left:${pos(h)}">${Math.floor(h / 60)}</span>`).join('')}</div>`;
  }

  function agendaSummary(items) {
    const list = Array.isArray(items) ? items : [];
    const total = list.reduce((sum, item) => sum + reservationMinutes(item), 0);
    return list.length ? `${list.length} ${list.length === 1 ? 'reserva' : 'reservas'} · ${durationLabel(total)}` : 'sin reservas';
  }

  function toggleButton(item, enabled, disabled) {
    return `<button type="button" class="rd-toggle ${enabled ? 'active' : ''}" data-command="${item.command}" data-enabled="${enabled ? 'false' : 'true'}" role="switch" aria-checked="${enabled ? 'true' : 'false'}" ${disabled ? 'disabled' : ''}>
      <span class="rd-toggle-copy"><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.hint)}</small></span><i aria-hidden="true"></i>
    </button>`;
  }

  function renderControls(state, row) {
    const modeWrap = el('reservationModeControls');
    const actionWrap = el('reservationQuickControls');
    const settingsWrap = el('reservationSettingControls');
    if (!modeWrap || !actionWrap || !settingsWrap) return;
    const monitor = state.monitor || {};
    const offline = ageMs(row) > OFFLINE_MS || monitor.online === false;
    const activeMode = String(monitor.operating_mode?.code || '1');
    const today = localIsoDate(new Date());
    const watchesTomorrow = Boolean(monitor.target_date && monitor.target_date > today);

    const toggle = el('reservationModeToggle');
    if (toggle) {
      toggle.disabled = offline;
      toggle.setAttribute('aria-expanded', modePickerOpen && !offline ? 'true' : 'false');
      toggle.innerHTML = `<span class="rd-mode-copy"><small>Modo</small><b>${escapeHtml(MODE_LABELS[activeMode] || monitor.operating_mode?.name || 'Normal')}</b><span>${escapeHtml(MODE_HINTS[activeMode] || '')}</span></span><i aria-hidden="true">${modePickerOpen && !offline ? '▴' : '▾'}</i>`;
    }
    modeWrap.classList.toggle('is-open', modePickerOpen && !offline);
    modeWrap.innerHTML = Object.entries(MODE_LABELS).map(([code, label]) => `
      <button type="button" class="rd-mode-option ${code === activeMode ? 'active' : ''}" role="radio" aria-checked="${code === activeMode ? 'true' : 'false'}" data-command="set_operating_mode" data-mode="${code}" ${offline ? 'disabled' : ''}>
        <span><b>${escapeHtml(label)}</b><small>${escapeHtml(MODE_HINTS[code] || '')}</small></span>${code === activeMode ? '<em>activo</em>' : ''}
      </button>`).join('');

    actionWrap.innerHTML = `
      <button type="button" class="rd-action rd-action-main ${monitor.paused ? 'is-resume' : 'is-pause'}" data-command="${monitor.paused ? 'resume' : 'pause'}" ${offline ? 'disabled' : ''}>
        <span aria-hidden="true">${monitor.paused ? '▶' : 'Ⅱ'}</span><b>${monitor.paused ? 'Reanudar' : 'Pausar'}</b>
        <small>${monitor.paused ? 'El monitor está en pausa' : 'Vigilando Asimut'}</small>
      </button>
      <div class="rd-target" role="group" aria-label="Día que vigila">
        <button type="button" class="rd-action ${watchesTomorrow ? '' : 'active'}" data-command="target_today" aria-pressed="${watchesTomorrow ? 'false' : 'true'}" ${offline ? 'disabled' : ''}><b>Hoy</b></button>
        <button type="button" class="rd-action ${watchesTomorrow ? 'active' : ''}" data-command="target_tomorrow" aria-pressed="${watchesTomorrow ? 'true' : 'false'}" ${offline ? 'disabled' : ''}><b>Mañana</b></button>
      </div>`;

    settingsWrap.innerHTML = TOGGLES
      .filter(item => !(item.optional && monitor[item.key] == null))
      .map(item => toggleButton(item, monitor[item.key], offline)).join('');
    const summary = el('reservationActiveSettings');
    if (summary) summary.innerHTML = settingsSummary(monitor);
    else settingsWrap.insertAdjacentHTML('beforeend', settingsSummary(monitor));

    const danger = el('reservationDangerControls') || actionWrap;
    const dangerHtml = confirmAction === 'shutdown' && !offline ? `
      <div class="rd-confirm" role="group" aria-label="Confirmar cierre">
        <span>¿Cerrar el monitor? Para volver a abrirlo hará falta el ordenador.</span>
        <button type="button" class="rd-action is-danger" data-command="shutdown"><b>Sí, cerrar</b></button>
        <button type="button" class="rd-action" data-ui="cancel-confirm"><b>No</b></button>
      </div>` : `
      <button type="button" class="rd-action is-shutdown" data-ui="ask-shutdown" ${offline ? 'disabled' : ''}>
        <span aria-hidden="true">■</span><b>Cerrar monitor</b><small>Cierre limpio, igual que en Telegram</small>
      </button>`;
    if (danger === actionWrap) actionWrap.insertAdjacentHTML('beforeend', dangerHtml);
    else danger.innerHTML = dangerHtml;

    [modeWrap, actionWrap, settingsWrap, danger].forEach(wrap => wrap.querySelectorAll('[data-command]').forEach(button => {
      button.addEventListener('click', () => sendCommand(button));
    }));
    danger.querySelector('[data-ui="ask-shutdown"]')?.addEventListener('click', () => askConfirm('shutdown'));
    danger.querySelector('[data-ui="cancel-confirm"]')?.addEventListener('click', () => askConfirm(null));
  }

  /* Laboratorio de cuotas: el monitor hace simulaciones type=check en Asimut
   * (nunca reserva) y publica aquí qué reglas ha confirmado. */
  const LAB_ICON = { yes: '✓', no: '✗', unknown: '?' };
  function renderQuotaLab(state, offline) {
    const wrap = el('reservationQuotaLab');
    if (!wrap) return;
    const lab = state.quota_lab || { status: 'idle' };
    const running = lab.status === 'running';
    const when = lab.finished_at ? relativeAge(lab.finished_at) : '';
    const questions = Array.isArray(lab.questions) ? lab.questions : [];
    const tests = Array.isArray(lab.tests) ? lab.tests : [];
    wrap.innerHTML = `
      <p class="rd-lab-intro">Prueba en Asimut cómo se combinan la SZ, el RF y el tramo gratis de 2 h <b>sin reservar nada</b>: son simulaciones que Asimut evalúa y descarta (también ampliar hacia atrás, reservas pegadas, otras aulas y la ventana de antelación). Tarda un par de minutos.</p>
      ${running ? `<p class="rd-lab-status is-running">En marcha… ${escapeHtml(lab.progress || '')}</p>` : ''}
      ${lab.status === 'error' ? `<p class="rd-lab-status is-error">No se pudo terminar: ${escapeHtml(lab.error || 'error')}</p>` : ''}
      ${questions.length ? `<ul class="rd-lab-results">${questions.map(q => `
        <li class="is-${escapeHtml(q.verdict || 'unknown')}">
          <i aria-hidden="true">${LAB_ICON[q.verdict] || '?'}</i>
          <span><b>${escapeHtml(q.title || q.id)}</b><small>${escapeHtml(q.text || '')}</small></span>
        </li>`).join('')}</ul>
      <p class="rd-lab-meta">Último laboratorio ${escapeHtml(when)} · ${tests.length} simulaciones</p>
      <details class="rd-lab-tests"><summary>Ver las simulaciones</summary>
        <table><thead><tr><th>Prueba</th><th>Día</th><th>Horario</th><th>SZ</th><th>RF</th></tr></thead><tbody>
        ${tests.map(t => `<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(formatDate(t.day))}</td><td>${escapeHtml(t.ini || '')}–${escapeHtml(t.fin || '')}</td>
          <td>${t.sz ? 'se pasa' : 'cabe'}</td><td>${t.rf ? 'se pasa' : 'cabe'}</td></tr>`).join('')}
        </tbody></table>
      </details>` : ''}
      <button type="button" class="rd-action rd-lab-run" data-command="run_quota_lab" ${offline || running ? 'disabled' : ''}>
        <span aria-hidden="true">⚗</span><b>${running ? 'Laboratorio en marcha…' : questions.length ? 'Repetir laboratorio' : 'Lanzar laboratorio'}</b>
      </button>
      <div class="rd-lab-recycle">
        ${labRecycleConfirm && !offline && !running ? `
          <p class="rd-lab-warn"><b>Esto sí toca Asimut.</b> Además de las simulaciones, el monitor guardará <b>sin cambiar nada</b> una reserva tuya que caiga entera en las próximas 2 h y mirará si te devuelve cuota. Asimut registra la modificación.</p>
          <div class="rd-lab-recycle-actions">
            <button type="button" class="rd-action" data-ui="lab-recycle-cancel">Cancelar</button>
            <button type="button" class="rd-action is-danger" data-ui="lab-recycle-go">Sí, probar reciclar</button>
          </div>` : `
          <button type="button" class="rd-link" data-ui="lab-recycle-ask" ${offline || running ? 'disabled' : ''}>Probar también «reciclar cuota»…</button>`}
      </div>`;
    wrap.querySelector('[data-command="run_quota_lab"]')?.addEventListener('click', event => sendCommand(event.currentTarget));
    wrap.querySelector('[data-ui="lab-recycle-ask"]')?.addEventListener('click', () => { labRecycleConfirm = true; renderQuotaLab(state, offline); });
    wrap.querySelector('[data-ui="lab-recycle-cancel"]')?.addEventListener('click', () => { labRecycleConfirm = false; renderQuotaLab(state, offline); });
    wrap.querySelector('[data-ui="lab-recycle-go"]')?.addEventListener('click', event => {
      labRecycleConfirm = false;
      postCommand('run_quota_lab', { reciclar: true }, event.currentTarget);
    });
  }

  function applyTab() {
    const panes = el('reservationPanes');
    if (panes) panes.dataset.activeTab = activeTab;
    document.querySelectorAll('[data-rd-tab]').forEach(button => {
      const active = button.dataset.rdTab === activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }
  function setTab(name) {
    activeTab = TABS.includes(name) ? name : 'monitor';
    try { localStorage.setItem(TAB_KEY, activeTab); } catch (_) {}
    applyTab();
  }

  function listLabel(values, format = String) {
    const items = Array.isArray(values) ? values.filter(value => value != null && value !== '') : [];
    return items.length ? items.map(format).join(', ') : 'ninguno';
  }
  function periodsLabel(periods) {
    const items = (Array.isArray(periods) ? periods : [])
      .filter(period => Array.isArray(period) && period[0] && period[1])
      .map(period => `${period[0]}–${period[1]}`);
    return items.length ? items.join(', ') : 'ninguna';
  }
  /* Ajustes que hoy sólo se cambian desde Telegram (/blind, blindajes,
   * prioridades): aquí sólo se muestran. */
  function settingsSummary(settings) {
    return `<dl class="rd-settings-summary">
      <div><dt>Franjas ciegas</dt><dd>${escapeHtml(periodsLabel(settings.blind_periods))}</dd></div>
      <div><dt>Grupos blindados</dt><dd>${escapeHtml(listLabel(settings.blinded_groups, group => `G${group}`))}</dd></div>
      <div><dt>Aulas blindadas</dt><dd>${escapeHtml(listLabel(settings.blinded_rooms, roomLabel))}</dd></div>
      <div><dt>Aulas prioritarias</dt><dd>${escapeHtml(listLabel(settings.priority_rooms, roomLabel))}</dd></div>
      ${settings.no_rebook_count != null ? `<div><dt>Huecos sin re-reservar</dt><dd>${escapeHtml(settings.no_rebook_count || 'ninguno')}</dd></div>` : ''}
    </dl>`;
  }

  function askConfirm(action) {
    confirmAction = action;
    window.clearTimeout(confirmTimer);
    // La confirmación caduca sola para que un toque suelto nunca cierre nada.
    if (action) confirmTimer = window.setTimeout(() => { confirmAction = null; render(); }, 8000);
    render();
  }

  /* «Iniciar» con un toque repite lo último: el modo con el que estuvo en
   * marcha la última vez (lo recuerda este dispositivo), hora «Ahora», el
   * campus que tiene guardado el monitor y, si hay ajustes de la sesión
   * anterior, recuperarlos. Lo elegido aquí o en Telegram manda sobre esto. */
  function lastStart() {
    try { return JSON.parse(localStorage.getItem(LAST_START_KEY + selectedSource) || '{}') || {}; } catch (_) { return {}; }
  }
  function rememberStart(values) {
    const merged = { ...lastStart(), ...values };
    try { localStorage.setItem(LAST_START_KEY + selectedSource, JSON.stringify(merged)); } catch (_) {}
  }
  function startupSelection(state) {
    if (Date.now() - startupDraftAt > DRAFT_MS) startupDraft = {};
    const server = state.startup || {};
    const last = lastStart();
    const lastMode = MODE_LABELS[last.mode] ? last.mode : '1';
    return {
      mode: 'mode' in startupDraft ? startupDraft.mode : server.mode || lastMode,
      inicio: 'inicio' in startupDraft ? startupDraft.inicio : server.inicio || 'off',
      restore: 'restore' in startupDraft ? startupDraft.restore
        : server.previous_available ? server.restore || 'yes' : 'no',
      aachen: 'aachen' in startupDraft ? startupDraft.aachen : !!state.monitor?.aachen_only,
    };
  }
  function previousCount(previous) {
    if (!previous) return 0;
    return (previous.blind_periods || []).length + (previous.blinded_rooms || []).length
      + (previous.blinded_groups || []).length + (previous.priority_rooms || []).length
      + (Number(previous.no_rebook_count) || 0);
  }
  function inicioLabel(value) {
    if (value === 'off') return 'Ahora';
    return /^\d{4}$/.test(String(value || '')) ? `${value.slice(0, 2)}:${value.slice(2)}` : 'sin elegir';
  }
  function chip(group, value, label, active, hint) {
    return `<button type="button" class="rd-start-chip ${active ? 'active' : ''}" data-startup-field="${group}" data-value="${escapeHtml(value)}" aria-pressed="${active ? 'true' : 'false'}">
      <span>${escapeHtml(label)}</span>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </button>`;
  }

  /* Entrada segura desde la app. Cada toque se refleja aquí al momento y se
   * envía al monitor (startup_select), que actualiza también el menú de
   * Telegram; «Iniciar» manda la selección completa (start_monitor). */
  function renderStartup(state, health) {
    let panel = el('reservationStartupPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'reservationStartupPanel';
      panel.className = 'rd-startup';
      (el('reservationConnectionHelp') || el('reservationHero'))?.after(panel);
    }
    panel.hidden = !(health === 'awaiting' || health === 'starting');
    if (panel.hidden) return;
    if (health === 'starting') {
      panel.innerHTML = '<p class="rd-startup-wait">Iniciando sesión en Asimut… El panel completo aparecerá en cuanto llegue la primera lectura.</p>';
      return;
    }
    const startup = state.startup || {};
    const pick = startupSelection(state);
    const previous = startup.previous_available ? startup.previous || {} : null;
    const options = Array.isArray(startup.inicio_options) && startup.inicio_options.length ? startup.inicio_options : ['off'];
    const modeLabel = STARTUP_MODES.find(mode => mode.code === pick.mode)?.label || 'Normal';
    const count = previousCount(previous);
    const restoreLine = !previous ? 'Empieza limpio: no hay ajustes de la sesión anterior'
      : pick.restore === 'yes' ? (count ? `Recupera los ajustes de la sesión anterior (${count})` : 'Recupera la sesión anterior (sin blindajes ni franjas)')
        : 'Empieza limpio, sin los ajustes de la sesión anterior';
    panel.innerHTML = `
      <div class="rd-start-quick">
        <div class="rd-start-summary">
          <small>Se iniciará con</small>
          <b>${escapeHtml(modeLabel)} · ${escapeHtml(inicioLabel(pick.inicio))} · ${pick.aachen ? 'Solo Aachen' : 'Köln'}</b>
          <span>${escapeHtml(restoreLine)}</span>
        </div>
        <button type="button" class="rd-action rd-start-go" data-startup-command="start_monitor">
          <span aria-hidden="true">▶</span><b>Iniciar</b>
        </button>
        <button type="button" class="rd-start-more" data-ui="toggle-startup-options" aria-expanded="${startupExpanded ? 'true' : 'false'}" aria-controls="reservationStartupOptions">
          ${startupExpanded ? 'Ocultar opciones ▴' : 'Cambiar opciones ▾'}
        </button>
      </div>
      <div class="rd-start-options" id="reservationStartupOptions" ${startupExpanded ? '' : 'hidden'}>
        <div class="rd-section-label"><span>Modo</span><small>${escapeHtml(modeLabel)}</small></div>
        <div class="rd-start-modes">${STARTUP_MODES.map(mode => chip('mode', mode.code, mode.label, pick.mode === mode.code, mode.hint)).join('')}</div>
        <div class="rd-section-label"><span>Hora de inicio</span><small>${escapeHtml(inicioLabel(pick.inicio))}</small></div>
        <div class="rd-start-times">${options.map(value => chip('inicio', value, inicioLabel(value), pick.inicio === value)).join('')}</div>
        <div class="rd-section-label"><span>Campus</span><small>${pick.aachen ? 'Aachen' : 'Köln'}</small></div>
        <div class="rd-start-pair">${chip('aachen', 'false', 'Köln', !pick.aachen)}${chip('aachen', 'true', 'Solo Aachen', pick.aachen)}</div>
        <div class="rd-section-label"><span>Ajustes de la sesión anterior</span><small>${previous?.saved_at ? `guardados ${escapeHtml(relativeAge(previous.saved_at))}` : ''}</small></div>
        ${previous ? `${settingsSummary(previous)}
        <div class="rd-start-pair">${chip('restore', 'yes', 'Recuperarlos', pick.restore === 'yes')}${chip('restore', 'no', 'Empezar limpio', pick.restore === 'no')}</div>`
          : '<p class="rd-card-note">No hay ajustes anteriores: empezará limpio.</p>'}
      </div>
      <div class="rd-start-footer">
        ${confirmAction === 'cancel_start' ? `
          <span>¿Cerrar el monitor sin iniciarlo?</span>
          <button type="button" class="rd-action is-danger" data-startup-command="cancel_start"><b>Sí, cerrar</b></button>
          <button type="button" class="rd-action" data-ui="cancel-confirm"><b>No</b></button>` : `
          <button type="button" class="rd-start-cancel" data-ui="ask-cancel-start">Cerrar el monitor sin iniciarlo</button>`}
      </div>`;
    panel.querySelector('[data-ui="toggle-startup-options"]')?.addEventListener('click', () => {
      startupExpanded = !startupExpanded;
      render();
    });
    panel.querySelectorAll('[data-startup-field]').forEach(button => {
      button.addEventListener('click', () => {
        const field = button.dataset.startupField;
        const value = field === 'aachen' ? button.dataset.value === 'true' : button.dataset.value;
        startupDraft = { ...startupDraft, [field]: value };
        startupDraftAt = Date.now();
        render();
        postCommand('startup_select', { [field]: value }, null, { quiet: true });
      });
    });
    panel.querySelector('[data-startup-command="start_monitor"]')?.addEventListener('click', event => {
      const current = startupSelection(state);
      rememberStart({ mode: current.mode });
      postCommand('start_monitor', {
        mode: current.mode, inicio: current.inicio, restore: current.restore, aachen: current.aachen,
      }, event.currentTarget);
    });
    panel.querySelector('[data-startup-command="cancel_start"]')?.addEventListener('click', event => {
      confirmAction = null;
      postCommand('cancel_start', {}, event.currentTarget);
    });
    panel.querySelector('[data-ui="ask-cancel-start"]')?.addEventListener('click', () => askConfirm('cancel_start'));
    panel.querySelector('[data-ui="cancel-confirm"]')?.addEventListener('click', () => askConfirm(null));
  }

  function renderMonitor(state, row) {
    const target = el('reservationMonitorCard');
    if (!target) return;
    const monitor = state.monitor || {};
    const health = monitorHealth(row, state);
    const online = health === 'live' || health === 'stale';
    const liveLabel = {
      live: 'conectado', stale: 'lectura antigua', stopped: 'detenido', failing: 'fallando',
      offline: 'sin señal', awaiting: 'esperando arranque', starting: 'arrancando', closed: 'cerrado',
    }[health];
    const scans = Array.isArray(state.scans) ? state.scans : [];
    const latestScan = scans.map(scan => parseDate(scan.observed_at)).filter(Boolean).sort((a, b) => b - a)[0];
    const chips = [
      monitor.paused ? 'En pausa' : 'Vigilando',
      `Busca ${formatDate(monitor.target_date)}`,
      monitor.paod_state && monitor.paod_state !== 'PAOD off' ? monitor.paod_state : null,
      monitor.efficient ? 'Eficiente' : null,
    ].filter(Boolean);
    target.innerHTML = `<section class="rd-card rd-monitor-card">
      <div class="rd-card-head">
        <span>Monitor</span>
        <small class="rd-live-dot ${online ? 'online' : ''}"><i></i>${liveLabel}</small>
      </div>
      <div class="rd-monitor-mode">
        <span>Modo operativo</span>
        <b>${escapeHtml(monitor.operating_mode?.name || 'Normal')}</b>
      </div>
      <div class="rd-chip-row">${chips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}</div>
      <dl class="rd-monitor-meta">
        <div><dt>Última lectura</dt><dd>${latestScan ? escapeHtml(relativeAge(latestScan.toISOString())) : 'pendiente'}</dd></div>
        <div><dt>Éxito 7 días</dt><dd>${escapeHtml(state.success_rate || '—')}</dd></div>
        <div><dt>Ventana</dt><dd>${escapeHtml(monitor.monitor_window?.start || '—')}–${escapeHtml(monitor.monitor_window?.end || '—')}</dd></div>
        <div><dt>Mínimo</dt><dd>${escapeHtml(monitor.min_slot_duration || '—')} min</dd></div>
      </dl>
    </section>`;
  }

  function renderTransition(transition) {
    const section = el('reservationTransition');
    if (!section) return;
    if (!transition?.date) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const title = section.querySelector('[data-transition-title]');
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (title) title.textContent = `${transition.date === localIsoDate(tomorrow) ? 'Mañana' : 'También'} · ${formatDate(transition.date)}`;
    const meta = section.querySelector('[data-transition-meta]');
    if (meta) meta.textContent = agendaSummary(transition.reservations);
    renderReservations(transition.date, transition.reservations, 'reservationTransitionList');
  }

  /* Resumen de una línea para Hoy (tarjeta #aulasTodayCard y la línea de Aulas
   * del móvil). kind: live | warn | error | idle. */
  function summaryFor(row) {
    if (!row) {
      return connectionNotice
        ? { title: connectionNotice.title, detail: '', kind: 'error' }
        : { title: 'Monitor sin conectar', detail: 'Ábrelo en el ordenador', kind: 'idle' };
    }
    const state = row.state || {};
    const health = monitorHealth(row, state);
    const reservations = Array.isArray(state.reservations) ? state.reservations : [];
    const current = reservations.find(item => timelineStatus(state.date, item) === 'current');
    const next = reservations.find(item => timelineStatus(state.date, item) === 'upcoming');
    const byHealth = {
      awaiting: { title: 'Listo para arrancar', detail: 'Toca para iniciarlo', kind: 'warn' },
      starting: { title: 'Arrancando…', detail: 'Entrando en Asimut', kind: 'warn' },
      closed: { title: 'Monitor cerrado', detail: '', kind: 'idle' },
      offline: { title: 'Monitor sin señal', detail: relativeAge(row.heartbeat_at), kind: 'error' },
      failing: { title: 'El monitor está fallando', detail: state.monitor?.error?.attempt ? `intento ${state.monitor.error.attempt}` : '', kind: 'error' },
      stopped: { title: 'Monitor detenido', detail: '', kind: 'error' },
    }[health];
    if (byHealth) return byHealth;
    const paused = state.monitor?.paused ? ' · en pausa' : '';
    if (current) return { title: `Aula ${roomLabel(current.room)} · hasta ${current.end}`, detail: `en curso${paused}`, kind: health === 'stale' ? 'warn' : 'live' };
    if (next) return { title: `Aula ${roomLabel(next.room)} · ${next.start}–${next.end}`, detail: `siguiente${paused}`, kind: health === 'stale' ? 'warn' : 'live' };
    return { title: reservations.length ? 'Reservas de hoy terminadas' : 'Sin reservas hoy', detail: `vigilando${paused}`, kind: health === 'stale' ? 'warn' : 'live' };
  }
  function renderTodayCard(row) {
    const summary = summaryFor(row);
    lastSummary = summary;
    const card = el('aulasTodayCard');
    if (card) {
      card.dataset.kind = summary.kind;
      const title = card.querySelector('b');
      const detail = card.querySelector('.aulas-today-copy > span');
      if (title) title.textContent = summary.title;
      if (detail) detail.textContent = summary.detail || '';
    }
    const key = JSON.stringify(summary);
    if (key !== lastSummaryKey) {
      lastSummaryKey = key;
      window.dispatchEvent(new CustomEvent('reservation-dashboard:summary', { detail: summary }));
    }
  }

  function bindRefresh() {
    el('reservationRefresh')?.addEventListener('click', () => refresh(true));
  }

  function render() {
    renderSourceSwitch();
    const row = currentRow();
    const shell = el('reservationDashboardContent');
    const empty = el('reservationDashboardEmpty');
    if (!shell || !empty) return;
    if (!row) {
      shell.hidden = true;
      empty.hidden = false;
      const notice = connectionNotice || {
        title: 'Esperando al monitor',
        body: 'Abre una sola instancia del monitor en Windows y completa su arranque en Telegram. Las reservas aparecerán después de la primera lectura de Asimut.',
        status: 'Aún no hay ninguna lectura publicada', kind: 'idle',
      };
      empty.innerHTML = `<div class="rd-empty-mark">↗</div><strong>${escapeHtml(notice.title)}</strong><p>${escapeHtml(notice.body)}</p>`;
      setStatus(notice.status, notice.kind);
      renderTodayCard(null);
      return;
    }
    const state = row.state || {};
    shell.hidden = false;
    empty.hidden = true;
    const health = monitorHealth(row, state);
    if ((health === 'live' || health === 'stale') && MODE_LABELS[state.monitor?.operating_mode?.code]
      && lastStart().mode !== state.monitor.operating_mode.code) {
      rememberStart({ mode: state.monitor.operating_mode.code });
    }
    shell.classList.toggle('is-startup', health === 'awaiting' || health === 'starting');
    if (health === 'awaiting') {
      setStatus('Monitor abierto · esperando arranque (aquí o en Telegram)', 'stale');
    } else if (health === 'starting') {
      setStatus('Arrancando · entrando en Asimut…', 'stale');
    } else if (health === 'closed') {
      setStatus(`Monitor cerrado ${relativeAge(row.observed_at)} · última lectura de Asimut ${lastReadLabel(row)}`, 'stale');
    } else if (health === 'offline') {
      setStatus(`Sin señal del ordenador desde ${formatClock(row.heartbeat_at)} (${relativeAge(row.heartbeat_at)})`, 'error');
    } else if (health === 'failing') {
      const attempt = state.monitor.error.attempt;
      setStatus(`El monitor está fallando${attempt ? ` · intento ${attempt}` : ''} · última lectura de Asimut: ${lastReadLabel(row)}`, 'error');
    } else if (health === 'stopped') {
      setStatus(`Monitor detenido · última lectura de Asimut ${lastReadLabel(row)}`, 'error');
    } else if (health === 'stale') {
      setStatus(`Conectado · última lectura de Asimut ${lastReadLabel(row)}`, 'stale');
    } else {
      setStatus(`En directo · leído ${lastReadLabel(row)}`, ageMs(row) > FRESH_MS ? 'stale' : 'ok');
    }
    if (connectionNotice) setStatus(connectionNotice.status, connectionNotice.kind);
    renderHero(state, row);
    let help = el('reservationConnectionHelp');
    if (!help) {
      help = document.createElement('p');
      help.id = 'reservationConnectionHelp';
      help.className = 'rd-connection-help';
      el('reservationHero')?.after(help);
    }
    const helpText = {
      offline: 'El ordenador no está publicando. Abre una sola instancia del monitor en Windows y completa su arranque en Telegram; después pulsa actualizar.',
      stopped: 'El programa sigue abierto pero el monitor se ha parado o se está reiniciando. Mira la ventana del monitor o su log en Windows.',
      failing: 'El programa está abierto en Windows pero el monitor cae al arrancar y se reintenta solo. Si el intento sigue subiendo, mira la ventana del monitor o su log; las reservas mostradas son las de la última lectura buena.',
      stale: 'El monitor está conectado pero lleva un rato sin leer Asimut (espera táctica, madrugada o un reintento). Las reservas mostradas pueden no estar al día.',
      closed: 'Se cerró de forma limpia. Las reservas mostradas son las de la última lectura; para volver a abrirlo usa el acceso directo en el ordenador.',
    }[health];
    help.hidden = !helpText;
    help.textContent = helpText || '';
    renderStartup(state, health);
    renderReservations(state.date, state.reservations, 'reservationBookingList');
    renderDayBar(state);
    const agendaTitle = el('reservationAgendaTitle');
    if (agendaTitle) agendaTitle.textContent = state.date
      ? `${state.date === localIsoDate(new Date()) ? 'Hoy' : 'Día'} · ${formatDate(state.date)}` : 'Tus reservas';
    const agendaMeta = el('reservationAgendaMeta');
    if (agendaMeta) agendaMeta.textContent = state.date ? agendaSummary(state.reservations) : '';
    const quota = el('reservationQuotaCard');
    if (quota) {
      quota.innerHTML = state.date
        ? quotaCard(state.quota || {})
        : '<section class="rd-card rd-quota-card"><div class="rd-card-head"><span>Cuota disponible</span><small>Asimut</small></div><p class="rd-card-note">Sin lectura de Asimut todavía.</p></section>';
    }
    renderMonitor(state, row);
    renderControls(state, row);
    renderQuotaLab(state, ageMs(row) > OFFLINE_MS || state.monitor?.online === false);
    renderTransition(state.transition);
    applyTab();
    renderTodayCard(row);
  }

  function commandPayload(button) {
    if (button.dataset.command === 'set_operating_mode') return { mode: button.dataset.mode };
    if (button.dataset.enabled != null) return { enabled: button.dataset.enabled === 'true' };
    return {};
  }

  function sendCommand(button) {
    if (!button?.dataset.command || button.disabled) return;
    if (button.dataset.command === 'shutdown') confirmAction = null;
    const closesPicker = button.dataset.command === 'set_operating_mode';
    if (closesPicker) modePickerOpen = false;
    postCommand(button.dataset.command, commandPayload(button), button);
    // El selector se pliega al elegir; el modo nuevo llega con la siguiente lectura.
    if (closesPicker) render();
  }

  // quiet: selección del menú de arranque, ya reflejada en pantalla al tocar.
  async function postCommand(command, payload, button, { quiet = false } = {}) {
    if (!userId || !command || button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.classList.add('is-sending');
    }
    try {
      const sb = getSB();
      const { data, error } = await sb.from('reservation_monitor_commands').insert({
        user_id: userId,
        source: selectedSource,
        command,
        payload: payload || {},
      }).select('id').single();
      if (error) throw error;
      pendingCommands.set(data.id, button || { quiet: true, command });
      if (!quiet) setStatus('Orden enviada al monitor…', 'loading');
      window.setTimeout(() => {
        const pending = pendingCommands.get(data.id);
        if (pending) {
          if (pending.classList) {
            pending.disabled = false;
            pending.classList.remove('is-sending');
          }
          pendingCommands.delete(data.id);
        }
      }, 15000);
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.classList.remove('is-sending');
      }
      if (command === 'startup_select') startupDraft = {};
      setStatus(`No se pudo enviar la orden: ${error.message || error}`, 'error');
      if (quiet) render();
    }
  }

  function onCommandChange(payload) {
    const command = payload.new || {};
    if (!command.id || command.source !== selectedSource) return;
    if (!['applied', 'rejected', 'error', 'expired'].includes(command.status)) return;
    const button = pendingCommands.get(command.id);
    if (button?.classList) {
      button.disabled = false;
      button.classList.remove('is-sending');
    }
    pendingCommands.delete(command.id);
    // Una selección rechazada no debe quedarse pintada como si valiera.
    if (command.command === 'startup_select' && command.status !== 'applied') startupDraft = {};
    if (command.command === 'startup_select' && command.status === 'applied') return;
    setStatus(command.result || (command.status === 'applied' ? 'Orden aplicada' : 'La orden no se aplicó'), command.status === 'applied' ? 'ok' : 'error');
    window.setTimeout(() => refresh(false), 500);
  }

  async function subscribe(sb) {
    if (channel) await sb.removeChannel(channel);
    if (commandChannel) await sb.removeChannel(commandChannel);
    channel = sb.channel(`reservation-monitor-state-${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'reservation_monitor_state', filter: `user_id=eq.${userId}`,
      }, payload => {
        const row = payload.new;
        if (!userId || row?.user_id !== userId || !row?.source) return;
        rows = rows.filter(item => item.source !== row.source).concat(row);
        render();
      })
      .subscribe();
    commandChannel = sb.channel(`reservation-monitor-commands-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'reservation_monitor_commands', filter: `user_id=eq.${userId}`,
      }, onCommandChange)
      .subscribe();
  }

  async function refresh(manual) {
    if (loading) return;
    loading = true;
    if (manual) setStatus('Actualizando…', 'loading');
    try {
      const sb = getSB();
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.user?.id) {
        userId = null;
        rows = [];
        connectionNotice = { title: 'Falta iniciar sesión', body: 'Usa la misma cuenta de nube que tus datos de estudio para ver las reservas.', status: 'Inicia sesión para ver tus reservas', kind: 'error' };
        render();
        return;
      }
      const changedUser = userId !== session.user.id;
      if (changedUser) rows = [];
      userId = session.user.id;
      const { data, error } = await sb.from('reservation_monitor_state')
        .select('user_id,source,schema_version,instance_id,observed_at,heartbeat_at,state,updated_at')
        .eq('user_id', userId)
        .order('source', { ascending: true });
      if (error) throw error;
      connectionNotice = null;
      rows = Array.isArray(data) ? data : [];
      render();
      if (changedUser || !channel) await subscribe(sb);
    } catch (error) {
      connectionNotice = { title: 'No se pudo conectar', body: 'Comprueba la conexión del iPad y pulsa actualizar. Las últimas reservas recibidas se conservan.', status: `Dashboard no disponible: ${error.message || error}`, kind: 'error' };
      render();
    } finally {
      loading = false;
    }
  }

  // Aulas se consulta en su pantalla y también desde Hoy (tarjeta resumen).
  const WATCHED_VIEWS = ['aulas', 'session'];
  function start() {
    if (!el('aulasDashboard') && !el('aulasTodayCard')) return;
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    refresh(false);
    pollTimer = setInterval(() => refresh(false), POLL_MS);
    clockTimer = setInterval(render, 15000);
  }

  function init() {
    document.querySelectorAll('[data-reservation-pane]').forEach(button => {
      button.addEventListener('click', () => setPane(button.dataset.reservationPane));
    });
    document.querySelectorAll('[data-rd-tab]').forEach(button => {
      button.addEventListener('click', () => setTab(button.dataset.rdTab));
    });
    el('reservationModeToggle')?.addEventListener('click', () => {
      modePickerOpen = !modePickerOpen;
      render();
    });
    applyTab();
    bindRefresh();
    window.addEventListener('app:viewchange', event => {
      if (WATCHED_VIEWS.includes(event.detail?.name)) start();
    });
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible' && WATCHED_VIEWS.includes(document.body.dataset.view)) refresh(false);
    };
    document.addEventListener('visibilitychange', refreshOnReturn);
    window.addEventListener('online', refreshOnReturn);
    try {
      getSB().auth.onAuthStateChange(() => window.setTimeout(() => refresh(false), 0));
    } catch (error) {}
    if (WATCHED_VIEWS.includes(document.body.dataset.view)
      || el('view-session')?.classList.contains('active') || el('view-aulas')?.classList.contains('active')) start();
  }

  window.ReservationDashboard = { refresh, setPane, setTab, summary: () => lastSummary };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
