/* Dashboard en vivo del monitor Asimut.
 * Lee únicamente filas protegidas por RLS y envía órdenes declarativas a una
 * cola; las operaciones reales siguen perteneciendo al monitor Python.
 */
(function reservationDashboardModule() {
  'use strict';

  const POLL_MS = 60 * 1000;
  const FRESH_MS = 90 * 1000;
  const OFFLINE_MS = 3 * 60 * 1000;
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
  const pendingCommands = new Map();

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
    const offline = ageMs(row) > OFFLINE_MS || state.monitor?.online === false;
    let eyebrow = current ? 'Ahora mismo' : next ? 'Siguiente reserva' : reservations.length ? 'Última reserva del día' : 'Agenda libre';
    let title = focus ? `Aula ${escapeHtml(focus.room || '—')}` : 'Sin reservas';
    let subtitle = focus
      ? `${escapeHtml(focus.start || '—')}–${escapeHtml(focus.end || '—')} · ${durationLabel(reservationMinutes(focus))}`
      : `No hay reservas para ${escapeHtml(formatDate(state.date))}`;
    if (offline) {
      eyebrow = 'Monitor sin conexión reciente';
      title = 'Estado en espera';
      subtitle = `La última señal llegó ${escapeHtml(relativeAge(row.heartbeat_at))}`;
    }
    hero.classList.toggle('is-offline', offline);
    hero.innerHTML = `
      <div class="rd-hero-copy">
        <span class="rd-kicker">${eyebrow}</span>
        <strong>${title}</strong>
        <span>${subtitle}</span>
      </div>
      <div class="rd-hero-time">
        <span>${escapeHtml(formatDate(state.date))}</span>
        <b>${escapeHtml(formatClock(row.observed_at))}</b>
      </div>`;
  }

  function renderReservations(day, reservations, targetId) {
    const list = el(targetId);
    if (!list) return;
    const items = Array.isArray(reservations) ? reservations : [];
    if (!items.length) {
      list.innerHTML = '<div class="rd-empty-line"><span>Agenda despejada</span><small>No hay reservas en esta fecha.</small></div>';
      return;
    }
    list.innerHTML = items.map(item => {
      const status = timelineStatus(day, item);
      const statusLabel = status === 'current' ? 'en curso' : status === 'past' ? 'terminada' : 'próxima';
      return `<article class="rd-booking is-${status}">
        <div class="rd-booking-time"><b>${escapeHtml(item.start || '—')}</b><span>${escapeHtml(item.end || '—')}</span></div>
        <div class="rd-booking-line" aria-hidden="true"><i></i></div>
        <div class="rd-booking-main">
          <strong>Aula ${escapeHtml(item.room || '—')}</strong>
          <span>${durationLabel(reservationMinutes(item))}${item.type ? ` · ${escapeHtml(item.type)}` : ''}</span>
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
    const max = Math.max(120, rf, sz);
    return `<section class="rd-card rd-quota-card">
      <div class="rd-card-head"><span>Cuota disponible</span><small>Asimut</small></div>
      <div class="rd-quota-row">
        <div><b>${rf}</b><span>min RF</span></div>
        <i><em style="width:${Math.min(100, rf / max * 100)}%"></em></i>
      </div>
      ${quota?.sz_applicable ? `<div class="rd-quota-row is-secondary">
        <div><b>${sz}</b><span>min SZ</span></div>
        <i><em style="width:${Math.min(100, sz / max * 100)}%"></em></i>
      </div>` : '<p class="rd-card-note">SZ no se aplica en fin de semana.</p>'}
    </section>`;
  }

  function toggleButton(command, enabled, label, disabled) {
    return `<button type="button" class="rd-toggle ${enabled ? 'active' : ''}" data-command="${command}" data-enabled="${enabled ? 'false' : 'true'}" ${disabled ? 'disabled' : ''}>
      <span>${escapeHtml(label)}</span><i aria-hidden="true"></i>
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
    modeWrap.innerHTML = Object.entries(MODE_LABELS).map(([code, label]) => `
      <button type="button" class="${code === activeMode ? 'active' : ''}" data-command="set_operating_mode" data-mode="${code}" ${offline ? 'disabled' : ''}>
        <span>${escapeHtml(label)}</span>${code === activeMode ? '<small>activo</small>' : ''}
      </button>`).join('');
    actionWrap.innerHTML = `
      <button type="button" class="rd-action ${monitor.paused ? 'is-resume' : 'is-pause'}" data-command="${monitor.paused ? 'resume' : 'pause'}" ${offline ? 'disabled' : ''}>
        <span>${monitor.paused ? '▶' : 'Ⅱ'}</span><b>${monitor.paused ? 'Reanudar' : 'Pausar'}</b>
      </button>
      <button type="button" class="rd-action" data-command="target_today" ${offline ? 'disabled' : ''}>
        <span>●</span><b>Hoy</b>
      </button>
      <button type="button" class="rd-action" data-command="target_tomorrow" ${offline ? 'disabled' : ''}>
        <span>→</span><b>Mañana</b>
      </button>`;
    settingsWrap.innerHTML = [
      toggleButton('set_migration', monitor.migration_enabled, 'Migración', offline),
      monitor.mirror_enabled == null ? '' : toggleButton('set_mirror', monitor.mirror_enabled, 'Espejo', offline),
      toggleButton('set_emergency', monitor.emergency_enabled, 'Emergencia', offline),
      toggleButton('set_madrugada', monitor.madrugada_enabled, 'Madrugada', offline),
      toggleButton('set_aachen', monitor.aachen_only, 'Solo Aachen', offline),
    ].join('');
    document.querySelectorAll('#reservationLivePanel [data-command]').forEach(button => {
      button.addEventListener('click', () => sendCommand(button));
    });
  }

  function renderMonitor(state, row) {
    const target = el('reservationMonitorCard');
    if (!target) return;
    const monitor = state.monitor || {};
    const freshness = ageMs(row);
    const online = freshness <= OFFLINE_MS && monitor.online !== false;
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
        <small class="rd-live-dot ${online ? 'online' : ''}"><i></i>${online ? 'conectado' : 'sin señal'}</small>
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
    if (title) title.textContent = `También ${formatDate(transition.date)}`;
    renderReservations(transition.date, transition.reservations, 'reservationTransitionList');
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
      empty.innerHTML = `<div class="rd-empty-mark">↗</div><strong>Esperando al monitor</strong>
        <p>La conexión está preparada. Cuando arranque el script aparecerán aquí las reservas y los controles.</p>`;
      setStatus('Aún no hay ninguna lectura publicada', 'idle');
      return;
    }
    const state = row.state || {};
    shell.hidden = false;
    empty.hidden = true;
    const freshness = ageMs(row);
    const offline = freshness > OFFLINE_MS || state.monitor?.online === false;
    setStatus(
      offline ? `Última señal ${relativeAge(row.heartbeat_at)}` : `En directo · actualizado ${relativeAge(row.heartbeat_at)}`,
      offline ? 'error' : freshness > FRESH_MS ? 'stale' : 'ok',
    );
    renderHero(state, row);
    renderReservations(state.date, state.reservations, 'reservationBookingList');
    const quota = el('reservationQuotaCard');
    if (quota) quota.innerHTML = quotaCard(state.quota || {});
    renderMonitor(state, row);
    renderControls(state, row);
    renderTransition(state.transition);
  }

  function commandPayload(button) {
    if (button.dataset.command === 'set_operating_mode') return { mode: button.dataset.mode };
    if (button.dataset.enabled != null) return { enabled: button.dataset.enabled === 'true' };
    return {};
  }

  async function sendCommand(button) {
    if (!userId || !button?.dataset.command || button.disabled) return;
    const command = button.dataset.command;
    button.disabled = true;
    button.classList.add('is-sending');
    try {
      const sb = getSB();
      const { data, error } = await sb.from('reservation_monitor_commands').insert({
        user_id: userId,
        source: selectedSource,
        command,
        payload: commandPayload(button),
      }).select('id').single();
      if (error) throw error;
      pendingCommands.set(data.id, button);
      setStatus('Orden enviada al monitor…', 'loading');
      window.setTimeout(() => {
        const pending = pendingCommands.get(data.id);
        if (pending) {
          pending.disabled = false;
          pending.classList.remove('is-sending');
          pendingCommands.delete(data.id);
        }
      }, 15000);
    } catch (error) {
      button.disabled = false;
      button.classList.remove('is-sending');
      setStatus(`No se pudo enviar la orden: ${error.message || error}`, 'error');
    }
  }

  function onCommandChange(payload) {
    const command = payload.new || {};
    if (!command.id || command.source !== selectedSource) return;
    if (!['applied', 'rejected', 'error', 'expired'].includes(command.status)) return;
    const button = pendingCommands.get(command.id);
    if (button) {
      button.disabled = false;
      button.classList.remove('is-sending');
      pendingCommands.delete(command.id);
    }
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
        if (!row?.source) return;
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
        render();
        setStatus('Inicia sesión para ver tus reservas', 'error');
        const empty = el('reservationDashboardEmpty');
        if (empty) empty.innerHTML = '<div class="rd-empty-mark">⌁</div><strong>Falta iniciar sesión</strong><p>El dashboard usa la misma cuenta de nube que tus datos de estudio.</p>';
        return;
      }
      const changedUser = userId !== session.user.id;
      userId = session.user.id;
      const { data, error } = await sb.from('reservation_monitor_state')
        .select('user_id,source,schema_version,instance_id,observed_at,heartbeat_at,state,updated_at')
        .eq('user_id', userId)
        .order('source', { ascending: true });
      if (error) throw error;
      rows = Array.isArray(data) ? data : [];
      render();
      if (changedUser || !channel) await subscribe(sb);
    } catch (error) {
      setStatus(`Dashboard no disponible: ${error.message || error}`, 'error');
    } finally {
      loading = false;
    }
  }

  function start() {
    if (el('reservationLivePanel')?.hidden) return;
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
    bindRefresh();
    window.addEventListener('app:viewchange', event => {
      if (event.detail?.name === 'salas' && !el('reservationLivePanel')?.hidden) start();
    });
    try {
      getSB().auth.onAuthStateChange(() => window.setTimeout(() => refresh(false), 0));
    } catch (error) {}
    if (document.body.dataset.view === 'salas') start();
  }

  window.ReservationDashboard = { refresh, setPane };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
