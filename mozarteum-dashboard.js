/* Aulas · Salzburgo (19-11-2026).
 * Monitor externo del Mozarteum: lee su fila de reservation_monitor_state
 * (source «mozarteum») y solo escribe órdenes en reservation_monitor_commands
 * (pause, resume, moz_franjas). Nunca llama al servidor de reservas.
 * El selector Colonia/Salzburgo decide qué campus se ve en Aulas y en Hoy.
 */
(function mozarteumDashboardModule() {
  'use strict';

  const SOURCE = 'mozarteum';
  const CAMPUS_KEY = 'aulasCampus';
  const POLL_MS = 60 * 1000;
  const OFFLINE_MS = 3 * 60 * 1000;
  const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const PRESETS = [
    { id: 'manana', label: 'Mañana', start: '08:00', end: '14:00' },
    { id: 'tarde', label: 'Tarde', start: '14:00', end: '20:00' },
    { id: 'dia', label: 'Todo el día', start: '08:00', end: '22:00' },
  ];

  let row = null;
  let userId = null;
  let channel = null;
  let pollTimer = null;
  let clockTimer = null;
  let loading = false;
  let notice = null; // { ok, text }
  let draft = null; // franjas enviadas y aún sin confirmar
  let draftCommandId = null;
  let formOpen = false;

  function el(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDay(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function toMin(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }
  function hm(m) { return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; }
  function at(day, minutes) { const d = new Date(`${day}T00:00:00`); d.setMinutes(minutes); return d; }
  function dayLabel(day) {
    const d = new Date(`${day}T12:00:00`);
    const today = isoDay(new Date());
    const tomorrow = isoDay(new Date(Date.now() + 864e5));
    const base = `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
    return day === today ? `hoy · ${base}` : day === tomorrow ? `mañana · ${base}` : base;
  }
  function hours(minutes) {
    const m = Math.round(Number(minutes) || 0);
    const sign = m < 0 ? '−' : '';
    return `${sign}${Math.floor(Math.abs(m) / 60)}:${pad(Math.abs(m) % 60)} h`;
  }

  // ── Campus ────────────────────────────────────────────────────
  function campus() {
    try { return localStorage.getItem(CAMPUS_KEY) === 'salzburgo' ? 'salzburgo' : 'colonia'; } catch (_) { return 'colonia'; }
  }
  function setCampus(value) {
    try { localStorage.setItem(CAMPUS_KEY, value); } catch (_) {}
    applyCampus();
    if (value === 'salzburgo') refresh(true);
    else window.ReservationDashboard?.refresh?.(false);
  }
  function applyCampus() {
    const salz = campus() === 'salzburgo';
    el('aulasDashboard')?.classList.toggle('is-salzburgo', salz);
    document.querySelectorAll('#aulasCampusSwitch [data-campus]').forEach(button => {
      const active = button.dataset.campus === campus();
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const panel = el('mozarteumPanel');
    if (panel) panel.hidden = !salz;
    if (salz) render();
    else {
      const small = el('aulasTodayCard')?.querySelector('.aulas-today-copy > small');
      if (small) small.textContent = 'Aulas';
    }
  }

  // ── Datos ─────────────────────────────────────────────────────
  function state() { return row?.state || {}; }
  function age() {
    const t = Date.parse(row?.heartbeat_at || row?.updated_at || '');
    return Number.isNaN(t) ? Infinity : Date.now() - t;
  }
  function health() {
    if (!row) return 'none';
    const mon = state().monitor || {};
    if (mon.phase === 'closed' || mon.online === false) return 'closed';
    if (age() > OFFLINE_MS) return 'offline';
    if (mon.error) return 'failing';
    return mon.paused ? 'paused' : 'live';
  }
  function franjas() {
    if (draft) return draft;
    return (state().franjas || []).map(f => ({ date: f.date, start: f.start, end: f.end }));
  }
  function reservations() { return Array.isArray(state().reservations) ? state().reservations : []; }

  // Bloques seguidos en la misma aula se enseñan como uno.
  function merged(list) {
    const out = [];
    [...list].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).forEach(r => {
      const last = out[out.length - 1];
      if (last && last.date === r.date && last.room === r.room && last.end === r.start) {
        last.end = r.end; last.parts += 1;
      } else out.push({ ...r, parts: 1 });
    });
    return out;
  }

  // Estado de cada tramo horario de una franja.
  function segments(f) {
    const now = Date.now();
    const a = toMin(f.start), b = toMin(f.end);
    const own = reservations().filter(r => r.date === f.date);
    const cuts = new Set([a, b]);
    for (let h = Math.ceil(a / 60) * 60; h < b; h += 60) cuts.add(h);
    own.forEach(r => { [toMin(r.start), toMin(r.end)].forEach(m => { if (m > a && m < b) cuts.add(m); }); });
    const points = [...cuts].sort((x, y) => x - y);
    const segs = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const s = points[i], e = points[i + 1];
      const r = own.find(x => toMin(x.start) <= s && toMin(x.end) >= e);
      let kind, label;
      if (r) { kind = 'ok'; label = r.room; }
      else if (at(f.date, e).getTime() <= now) { kind = 'past'; label = 'pasado'; }
      else {
        const opens = at(f.date, Math.ceil(e / 60) * 60 - 7 * 24 * 60);
        if (opens.getTime() > now) {
          kind = 'later';
          label = `abre ${DAYS[opens.getDay()]} ${pad(opens.getHours())}:00`;
        } else { kind = 'search'; label = 'buscando'; }
      }
      const prev = segs[segs.length - 1];
      if (prev && prev.kind === kind && prev.label === label && kind !== 'later') prev.e = e;
      else segs.push({ s, e, kind, label });
    }
    return segs;
  }

  // ── Pintar ────────────────────────────────────────────────────
  function setStatus(text, kind) {
    if (campus() !== 'salzburgo') return;
    const node = el('reservationDashboardStatus');
    if (!node) return;
    node.textContent = text;
    node.dataset.kind = kind || '';
  }

  function heroHtml() {
    const h = health();
    const st = state();
    const now = Date.now();
    const list = merged(reservations());
    const current = list.find(r => at(r.date, toMin(r.start)) <= now && at(r.date, toMin(r.end)) > now);
    const next = list.find(r => at(r.date, toMin(r.start)) > now);
    const focus = current || next;
    const q = st.quota || {};
    const pill = { live: ['ok', 'En marcha'], paused: ['warn', 'En pausa'], closed: ['muted', 'Cerrado'],
      offline: ['bad', 'Sin señal'], failing: ['bad', 'Con errores'], none: ['muted', 'Sin conectar'] }[h];
    const title = focus
      ? `${current ? 'Ahora' : 'Próxima'} · ${esc(focus.room)}`
      : (list.length ? 'Sin más reservas' : 'Sin reservas en Salzburgo');
    const detail = focus
      ? `${esc(dayLabel(focus.date))} · ${esc(focus.start)}–${esc(focus.end)}`
      : 'Dime para cuándo quieres aula abajo y el monitor la busca.';
    const canToggle = h === 'live' || h === 'paused';
    return `
      <div class="moz-hero-copy">
        <span class="moz-kicker">Mozarteum · Salzburgo <i class="moz-pill is-${pill[0]}">${pill[1]}</i></span>
        <strong>${title}</strong>
        <span>${detail}</span>
        ${q.free_min != null ? `<small>Cuota: ${hours(q.free_min)} libres · ${hours(q.pending_min)} reservadas</small>` : ''}
      </div>
      ${canToggle ? `<button type="button" class="moz-btn" data-moz-command="${h === 'paused' ? 'resume' : 'pause'}">${h === 'paused' ? '▶ Reanudar' : '⏸ Pausar'}</button>` : ''}`;
  }

  function openingHtml() {
    const n = state().next_opening;
    if (!n || !n.at) return '';
    const t = new Date(n.at);
    return `<p class="moz-opening"><b>${pad(t.getHours())}:00</b> · se abre ${esc(dayLabel(n.date))} de ${esc(n.start)} a ${esc(n.end)}
      ${n.wanted ? '<span class="moz-tag is-ok">en tus franjas: el monitor dispara</span>' : '<span class="moz-tag">fuera de tus franjas</span>'}</p>`;
  }

  function franjasHtml() {
    const list = franjas().filter(f => at(f.date, toMin(f.end)).getTime() > Date.now() - 864e5)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const rows = list.map(f => {
      const segs = segments(f);
      const total = toMin(f.end) - toMin(f.start);
      const bar = segs.map(s => `<span class="moz-seg is-${s.kind}" style="flex:${s.e - s.s}" title="${esc(hm(s.s))}–${esc(hm(s.e))} · ${esc(s.label)}">
          ${(s.e - s.s) / total > 0.12 && s.kind !== 'past' ? `<em>${esc(s.kind === 'search' ? `${hm(s.s)} · buscando` : s.label)}</em>` : ''}</span>`).join('');
      const key = `${f.date}|${f.start}|${f.end}`;
      return `<li class="moz-franja">
        <div class="moz-franja-head"><b>${esc(dayLabel(f.date))}</b><span>${esc(f.start)}–${esc(f.end)}</span>
          <button type="button" class="moz-x" data-moz-remove="${esc(key)}" aria-label="Quitar franja ${esc(dayLabel(f.date))} ${esc(f.start)}–${esc(f.end)}">✕</button></div>
        <div class="moz-bar">${bar}</div>
      </li>`;
    }).join('');
    const offline = !['live', 'paused'].includes(health());
    return `
      <div class="rd-card-head"><span>Cuándo quieres aula</span><small>${draft ? 'guardando…' : `${list.length} franja${list.length === 1 ? '' : 's'}`}</small></div>
      ${list.length ? `<ul class="moz-franja-list">${rows}</ul>` : '<p class="rd-card-note">Aún no hay franjas. Añade los días que estarás en Salzburgo.</p>'}
      ${notice ? `<p class="moz-notice ${notice.ok ? 'is-ok' : 'is-bad'}">${esc(notice.text)}</p>` : ''}
      ${offline ? '<p class="moz-notice is-bad">El monitor no está abierto: los cambios se guardan cuando lo abras en el ordenador (antes de 10 min).</p>' : ''}
      ${formOpen ? formHtml() : '<button type="button" class="moz-btn moz-add" data-moz-form="open">＋ Añadir días</button>'}`;
  }

  function timeOptions(selected, from, to) {
    const out = [];
    for (let m = toMin(from); m <= toMin(to); m += 30) out.push(`<option${hm(m) === selected ? ' selected' : ''}>${hm(m)}</option>`);
    return out.join('');
  }

  function formHtml() {
    const today = isoDay(new Date());
    const max = isoDay(new Date(Date.now() + 60 * 864e5));
    return `<form class="moz-form" id="mozFranjaForm">
      <div class="moz-form-row">
        <label>Del<input type="date" name="from" min="${today}" max="${max}" value="${today}" required></label>
        <label>al<input type="date" name="to" min="${today}" max="${max}" value="${today}"></label>
      </div>
      <div class="moz-presets" role="group" aria-label="Horario">
        ${PRESETS.map((p, i) => `<button type="button" data-moz-preset="${p.id}" class="${i === 0 ? 'active' : ''}">${p.label}<small>${p.start}–${p.end}</small></button>`).join('')}
      </div>
      <div class="moz-form-row">
        <label>Desde<select name="start">${timeOptions('08:00', '06:30', '21:30')}</select></label>
        <label>Hasta<select name="end">${timeOptions('14:00', '07:00', '22:00')}</select></label>
      </div>
      <p class="moz-form-hint">Sábados y domingos el edificio abre de 08:00 a 18:00; fuera de horario no se reserva nada.</p>
      <div class="moz-form-actions">
        <button type="button" class="moz-btn is-quiet" data-moz-form="close">Cancelar</button>
        <button type="submit" class="moz-btn is-primary">Guardar</button>
      </div>
    </form>`;
  }

  function bookingsHtml() {
    const list = merged(reservations()).filter(r => at(r.date, toMin(r.end)).getTime() > Date.now());
    if (!list.length) return '<div class="rd-card-head"><span>Tus aulas</span></div><p class="rd-card-note">Ninguna reserva próxima.</p>';
    const byDay = {};
    list.forEach(r => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    return `<div class="rd-card-head"><span>Tus aulas</span><small>próximos 7 días</small></div>
      <div class="moz-days">${Object.keys(byDay).sort().map(day => `
        <div class="moz-day"><b>${esc(dayLabel(day))}</b>
          ${byDay[day].map(r => `<div class="moz-booking"><span>${esc(r.start)}–${esc(r.end)}</span><strong>${esc(r.room)}</strong>${r.parts > 1 ? `<small>${r.parts} reservas seguidas</small>` : ''}</div>`).join('')}
        </div>`).join('')}</div>`;
  }

  function legendHtml() {
    return `<details class="moz-legend" open>
      <summary>Leyenda y reglas del Mozarteum</summary>
      <ul class="moz-legend-keys">
        <li><span class="moz-seg is-ok"></span>Reservada (aparece el aula)</li>
        <li><span class="moz-seg is-search"></span>Ya abierta: el monitor busca cancelaciones</li>
        <li><span class="moz-seg is-later"></span>Aún cerrada: pone cuándo se abre</li>
        <li><span class="moz-seg is-past"></span>Ya pasó</li>
      </ul>
      <ul class="moz-rules">
        <li>Cada hora en punto se abre la misma hora de dentro de 7 días (a las 15:00 se abre 14:00–15:00 del mismo día de la semana siguiente). El monitor dispara justo entonces.</li>
        <li>Máximo 2 h por reserva. El monitor encadena bloques de 1 h en la misma aula siempre que puede.</li>
        <li>Entra con el carné en los primeros 15 min o se cobra todo y el aula queda libre para otros.</li>
        <li>Si sales en los primeros 15 min no se cobra. Al salir, ficha en el lector: se devuelve el tiempo no usado.</li>
        <li>Puedes cancelar hasta 15 min antes del inicio.</li>
        <li>Horario: lunes a viernes 06:30–22:00 · sábado y domingo 08:00–18:00.</li>
      </ul>
    </details>`;
  }

  function eventsHtml() {
    const events = Array.isArray(state().events) ? state().events.slice(0, 12) : [];
    if (!events.length) return '';
    return `<details class="moz-events"><summary>Actividad del monitor</summary><ul>
      ${events.map(e => { const t = new Date(e.at); return `<li><time>${pad(t.getHours())}:${pad(t.getMinutes())}</time>${esc(e.text)}</li>`; }).join('')}
    </ul></details>`;
  }

  function render() {
    const panel = el('mozarteumPanel');
    paintToday();
    if (!panel || campus() !== 'salzburgo') return;
    const h = health();
    const statusText = {
      live: 'Salzburgo · en marcha', paused: 'Salzburgo · en pausa', closed: 'Salzburgo · monitor cerrado',
      offline: 'Salzburgo · sin señal del ordenador', failing: 'Salzburgo · el monitor da errores',
      none: 'Salzburgo · el monitor aún no se ha conectado',
    }[h];
    setStatus(statusText, h === 'live' ? 'ok' : h === 'paused' || h === 'closed' ? 'stale' : 'error');
    // No se repinta el formulario mientras se escribe en él.
    const active = document.activeElement;
    if (formOpen && active && el('mozFranjaForm')?.contains(active)) {
      el('mozHero').innerHTML = heroHtml();
      return;
    }
    el('mozHero').innerHTML = heroHtml() + openingHtml();
    el('mozFranjas').innerHTML = franjasHtml();
    el('mozBookings').innerHTML = bookingsHtml();
    el('mozLegend').innerHTML = legendHtml() + eventsHtml();
  }

  function paintToday() {
    if (campus() !== 'salzburgo') return;
    const card = el('aulasTodayCard');
    if (!card) return;
    const list = merged(reservations()).filter(r => at(r.date, toMin(r.end)).getTime() > Date.now());
    const now = Date.now();
    const current = list.find(r => at(r.date, toMin(r.start)) <= now);
    const next = current || list[0];
    const title = card.querySelector('b');
    const detail = card.querySelector('.aulas-today-copy > span');
    const small = card.querySelector('.aulas-today-copy > small');
    if (small) small.textContent = 'Aulas · Salzburgo';
    card.dataset.kind = health() === 'live' ? 'ok' : health() === 'paused' ? 'stale' : 'idle';
    if (title) title.textContent = next ? `${current ? 'Ahora' : 'Próxima'} · ${next.room} ${next.start}–${next.end}` : 'Sin reservas en Salzburgo';
    if (detail) detail.textContent = next ? dayLabel(next.date) : (franjas().length ? 'El monitor busca en tus franjas' : 'Añade los días que estarás allí');
  }

  // ── Órdenes ───────────────────────────────────────────────────
  async function postCommand(command, payload) {
    if (!userId) { notice = { ok: false, text: 'Inicia sesión para enviar órdenes.' }; render(); return null; }
    const { data, error } = await getSB().from('reservation_monitor_commands')
      .insert({ user_id: userId, source: SOURCE, command, payload: payload || {} }).select('id').single();
    if (error) { notice = { ok: false, text: `No se pudo enviar: ${error.message || error}` }; render(); return null; }
    return data.id;
  }

  async function saveFranjas(list) {
    draft = list;
    notice = null;
    render();
    const id = await postCommand('moz_franjas', { franjas: list.map(f => ({ date: f.date, start: f.start, end: f.end })) });
    if (!id) { draft = null; render(); return; }
    draftCommandId = id;
    window.setTimeout(() => {
      if (draftCommandId === id) { draft = null; draftCommandId = null; notice = { ok: false, text: 'El monitor no respondió. ¿Está abierto en el ordenador?' }; render(); }
    }, 10 * 60 * 1000);
  }

  function onCommandUpdate(payload) {
    const cmd = payload.new || {};
    if (cmd.source !== SOURCE || !['applied', 'rejected', 'error', 'expired'].includes(cmd.status)) return;
    if (cmd.id === draftCommandId) {
      draftCommandId = null;
      if (cmd.status !== 'applied') draft = null;
      notice = { ok: cmd.status === 'applied', text: cmd.result || (cmd.status === 'applied' ? 'Guardado' : 'El monitor no lo aplicó') };
    } else if (cmd.status !== 'applied') {
      notice = { ok: false, text: cmd.result || 'La orden no se aplicó' };
    }
    refresh(false);
  }

  function addFromForm(form) {
    const data = new FormData(form);
    const from = String(data.get('from') || '');
    const to = String(data.get('to') || '') || from;
    const start = String(data.get('start')), end = String(data.get('end'));
    if (!from || toMin(end) <= toMin(start)) { notice = { ok: false, text: 'La hora de fin tiene que ser posterior a la de inicio.' }; render(); return; }
    const days = [];
    for (let d = new Date(`${from}T12:00:00`); isoDay(d) <= (to < from ? from : to) && days.length < 31; d.setDate(d.getDate() + 1)) days.push(isoDay(d));
    const list = franjas().filter(f => !days.includes(f.date) || toMin(f.end) <= toMin(start) || toMin(f.start) >= toMin(end));
    days.forEach(day => {
      const weekend = [0, 6].includes(new Date(`${day}T12:00:00`).getDay());
      const s = weekend ? Math.max(toMin(start), 8 * 60) : Math.max(toMin(start), 6 * 60 + 30);
      const e = weekend ? Math.min(toMin(end), 18 * 60) : Math.min(toMin(end), 22 * 60);
      if (e - s >= 30) list.push({ date: day, start: hm(s), end: hm(e) });
    });
    formOpen = false;
    saveFranjas(list.slice(-60));
  }

  function onClick(event) {
    const target = event.target.closest('button');
    if (!target || !el('mozarteumPanel')?.contains(target)) return;
    if (target.dataset.mozCommand) {
      target.disabled = true;
      postCommand(target.dataset.mozCommand, {}).then(() => { notice = null; });
    } else if (target.dataset.mozRemove) {
      const [date, start, end] = target.dataset.mozRemove.split('|');
      saveFranjas(franjas().filter(f => !(f.date === date && f.start === start && f.end === end)));
    } else if (target.dataset.mozForm) {
      formOpen = target.dataset.mozForm === 'open';
      notice = null;
      render();
    } else if (target.dataset.mozPreset) {
      const preset = PRESETS.find(p => p.id === target.dataset.mozPreset);
      const form = el('mozFranjaForm');
      if (!preset || !form) return;
      form.querySelectorAll('[data-moz-preset]').forEach(b => b.classList.toggle('active', b === target));
      form.elements.start.value = preset.start;
      form.elements.end.value = preset.end;
    }
  }

  // ── Lectura ───────────────────────────────────────────────────
  async function subscribe(sb) {
    if (channel) await sb.removeChannel(channel);
    channel = sb.channel(`mozarteum-monitor-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservation_monitor_state', filter: `user_id=eq.${userId}` }, payload => {
        if (payload.new?.source !== SOURCE) return;
        row = payload.new;
        render();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reservation_monitor_commands', filter: `user_id=eq.${userId}` }, onCommandUpdate)
      .subscribe();
  }

  async function refresh(manual) {
    if (loading || typeof getSB !== 'function') return;
    loading = true;
    if (manual) setStatus('Actualizando…', 'loading');
    try {
      const sb = getSB();
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.user?.id) { userId = null; row = null; render(); return; }
      const changed = userId !== session.user.id;
      userId = session.user.id;
      const { data, error } = await sb.from('reservation_monitor_state')
        .select('source,observed_at,heartbeat_at,state,updated_at')
        .eq('user_id', userId).eq('source', SOURCE).maybeSingle();
      if (error) throw error;
      row = data || null;
      if (draft && row && !draftCommandId) draft = null;
      render();
      if (changed || !channel || ['closed', 'errored'].includes(channel.state)) await subscribe(sb);
    } catch (error) {
      setStatus(`Salzburgo · no se pudo leer: ${error.message || error}`, 'error');
    } finally {
      loading = false;
    }
  }

  function start() {
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    refresh(false);
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, POLL_MS);
    clockTimer = setInterval(render, 30 * 1000);
  }

  function init() {
    document.querySelectorAll('#aulasCampusSwitch [data-campus]').forEach(button => {
      button.addEventListener('click', () => setCampus(button.dataset.campus));
    });
    const panel = el('mozarteumPanel');
    panel?.addEventListener('click', onClick);
    panel?.addEventListener('submit', event => {
      if (event.target.id !== 'mozFranjaForm') return;
      event.preventDefault();
      addFromForm(event.target);
    });
    el('reservationRefresh')?.addEventListener('click', () => { if (campus() === 'salzburgo') refresh(true); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(false); });
    window.addEventListener('online', () => refresh(false));
    applyCampus();
    start();
  }

  // previewRow: solo para pruebas visuales (pinta una fila sin leer la nube).
  function previewRow(value) { row = value; render(); }
  window.MozarteumDashboard = { refresh, campus, setCampus, segments, merged, previewRow };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
