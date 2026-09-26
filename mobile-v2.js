/* Diseño móvil v2 (por defecto en pantallas ≤ 700 px; «Clásico» en Ajustes).
   No quita funciones: reorganiza. Lo que sale de la primera pantalla sigue a
   un toque (hoja «＋ Añadir», línea de Aulas que despliega su panel…).
   Fase 1: Hoy (anillo + frase, Para hoy, Aulas/Alemán en una línea) y el
   plan del Profesor pegado (PLAN_PARA_HOY). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MobileV2 = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DESIGN_KEY = 'alberto_mobile_design';
  const GOAL_MIN = 240;
  const MAX_PARA_HOY = 4;
  const doc = root.document;

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const jsArg = v => esc(String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fmtMin = m => {
    const v = Math.max(0, Math.round(Number(m) || 0)), h = Math.floor(v / 60), r = v % 60;
    return h ? (r ? `${h} h ${r}` : `${h} h`) : `${r} min`;
  };
  const fmtDur = m => { const v = Math.max(0, Math.round(Number(m) || 0)), h = Math.floor(v / 60), r = v % 60; return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`; };
  const clock = min => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const database = () => { try { return typeof db !== 'undefined' ? db : root.db; } catch (e) { return root.db; } };

  /* ── Preferencia de diseño ─────────────────────────────────────── */
  function design() { try { return root.localStorage.getItem(DESIGN_KEY) === 'classic' ? 'classic' : 'v2'; } catch (e) { return 'v2'; } }
  function applyDesign() {
    if (!doc) return;
    doc.documentElement.classList.toggle('mobile-v2', design() === 'v2');
    doc.querySelectorAll('[data-mobile-design]').forEach(b => {
      const on = b.dataset.mobileDesign === design();
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function setDesign(value) {
    try { root.localStorage.setItem(DESIGN_KEY, value === 'classic' ? 'classic' : 'v2'); } catch (e) {}
    applyDesign(); renderHoy(); try { renderCal(); } catch (e) {}
  }

  /* ── Plan del Profesor: PLAN_PARA_HOY ──────────────────────────────
     Formato pedido al Profesor: «duración en min | obra o movimiento | propósito». */
  function parseMinutes(text) {
    const s = norm(text);
    // «1 h 15», «1h15», «1,5 h», «45 min», «1 h 30 min».
    const h = s.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?(?:\s*(\d+))?/), m = s.match(/(\d+)\s*(?:min|m\b)/);
    if (h) return Math.round(parseFloat(h[1].replace(',', '.')) * 60 + (h[2] ? Number(h[2]) : 0));
    if (m) return Number(m[1]);
    const n = s.match(/^(\d+)$/);
    return n ? Number(n[1]) : null;
  }
  function parsePlan(text) {
    const lines = String(text || '').split(/\r?\n/);
    let start = lines.findIndex(l => /PLAN_PARA_HOY/i.test(l));
    const body = start >= 0 ? lines.slice(start + 1) : lines;
    const items = [];
    for (const raw of body) {
      // Viñetas y numeración de lista («- », «2. », «3) »), nunca los minutos.
      const line = raw.replace(/^\s*(?:[-*•–>]+|\d+[.)])\s+/, '').trim();
      if (!line) { if (items.length) break; continue; }
      if (/^(FIN|END)/i.test(line) || (/^[A-ZÁÉÍÓÚ_ ]{6,}$/.test(line) && items.length)) break;
      const parts = line.split('|').map(p => p.replace(/\*\*/g, '').trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const minutes = parseMinutes(parts[0]);
      if (!minutes || minutes > 600) continue;
      items.push({ minutes, label: parts[1], purpose: parts.slice(2).join(' · ') });
    }
    return items;
  }
  // Empareja cada línea con una obra/movimiento de la app por nombre.
  function matchUnit(label, data) {
    const target = norm(label);
    if (!target) return null;
    let best = null, bestScore = 0;
    (data && data.obras || []).forEach(work => {
      const wn = norm(work.name);
      const candidates = [{ obraId: work.id, movId: null, name: wn, full: norm((work.composer || '') + ' ' + work.name) }];
      (work.movimientos || []).forEach(m => candidates.push({ obraId: work.id, movId: m.id, name: norm(m.name), full: wn + ' ' + norm(m.name) }));
      candidates.forEach(c => {
        if (!c.name) return;
        let score = 0;
        if (target.includes(c.full) || c.full.includes(target)) score = 3 + c.full.length / 100;
        else if (c.movId && target.includes(c.name) && target.includes(wn)) score = 3;
        else if (target.includes(c.name) && c.name.length > 3) score = 1 + c.name.length / 100 + (c.movId ? .5 : 0);
        if (score > bestScore) { bestScore = score; best = c; }
      });
    });
    return best ? { obraId: best.obraId, movId: best.movId } : null;
  }
  function savePlan(text) {
    const data = database();
    const items = parsePlan(text);
    if (!data || !items.length) return 0;
    // Las listas se fusionan registro a registro al sincronizar: el plan va
    // como UN campo de texto para que un plan nuevo sustituya al anterior entero.
    data.professorPlan = { day: dayKey(), savedAt: new Date().toISOString(), clearedAt: null,
      itemsJson: JSON.stringify(items.map(it => ({ ...it, ...(matchUnit(it.label, data) || {}) }))) };
    if (typeof root.saveData === 'function') root.saveData();
    renderHoy();
    return items.length;
  }

  /* ── Para hoy: plan de hoy o, sin plan, lo más urgente ─────────── */
  // El informe completo es pesado: se calcula en el worker del Profesor
  // (buildReportAsync), nunca en el hilo principal. Mientras, «Calculando…».
  let urgentCache = { sig: '', rows: null, pending: '' };
  function urgentRows(data) {
    const handoff = root.ProfessorHandoffResilience;
    if (!handoff || typeof handoff.buildReportAsync !== 'function' || !data) return null;
    const sig = (data._localRevision || '') + '|' + dayKey() + '|' + (data.obras || []).length;
    if (urgentCache.sig === sig) return urgentCache.rows;
    if (urgentCache.pending !== sig) {
      urgentCache.pending = sig;
      handoff.buildReportAsync(data, { now: new Date().toISOString(), googleCalendarState: {} }).then(report => {
        const rows = (report.units || []).filter(u => u.priority && u.priority.band !== 'mantenimiento').slice(0, MAX_PARA_HOY).map(u => ({
          obraId: u.obraId, movId: u.movId, label: u.label, composer: u.composer,
          detail: [u.solidity == null ? 'sin medir' : Math.round(u.solidity) + ' %', (u.priority.reasons || [])[0]].filter(Boolean).join(' · '),
        }));
        urgentCache = { sig, rows, pending: '' };
        renderHoy();
      }).catch(() => { urgentCache = { sig, rows: [], pending: '' }; renderHoy(); });
    }
    return urgentCache.rows;
  }
  function planToday(data) {
    const plan = data && data.professorPlan;
    if (!plan || plan.day !== dayKey() || plan.clearedAt) return null;
    let items = [];
    try { items = JSON.parse(plan.itemsJson || '[]'); } catch (e) { items = []; }
    return Array.isArray(items) && items.length ? { ...plan, items } : null;
  }
  function studyNow(obraId, movId) {
    if (!obraId) { root.showView && root.showView('cronometro'); return; }
    if (typeof root.nudgeStudyNow === 'function') root.nudgeStudyNow(obraId);
    const sel = doc.getElementById('cronoObraSelect');
    if (sel && movId) {
      const v = 'mov::' + obraId + '::' + movId;
      if ([...sel.options].some(o => o.value === v)) sel.value = v;
    }
    if (sel) sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof root.cronoUpdateStartBtn === 'function') root.cronoUpdateStartBtn();
  }

  function paraHoyHtml(data) {
    const plan = planToday(data);
    if (plan) {
      const total = plan.items.reduce((s, it) => s + (Number(it.minutes) || 0), 0);
      return '<div class="mv2-line"><span class="mv2-lbl">Para hoy · plan del Profesor</span><span class="mv2-pill">' + fmtMin(total) + '</span></div>' +
        plan.items.map(it => '<button type="button" class="mv2-plan" onclick="MobileV2.studyNow(\'' + jsArg(it.obraId || '') + '\',\'' + jsArg(it.movId || '') + '\')">' +
          '<span class="mv2-play" aria-hidden="true">▶</span><span class="mv2-plan-copy"><b>' + esc(it.label) + '</b><small>' + esc([fmtMin(it.minutes), it.purpose].filter(Boolean).join(' · ')) + (it.obraId ? '' : ' · sin obra enlazada') + '</small></span></button>').join('') +
        '<div class="mv2-plan-actions"><button type="button" onclick="MobileV2.openPaste()">Pegar otro plan</button><button type="button" onclick="MobileV2.clearPlan()">Quitar plan</button></div>';
    }
    const rows = urgentRows(data);
    const head = '<div class="mv2-line"><span class="mv2-lbl">Para hoy · lo más urgente</span><button type="button" class="mv2-link" onclick="MobileV2.openPaste()">Pegar plan</button></div>';
    if (rows == null) return head + '<p class="mv2-muted">Calculando prioridades…</p>';
    if (!rows.length) return head + '<p class="mv2-muted">Nada urgente: ningún compromiso próximo con repertorio. Estudia lo que prefieras.</p>';
    return head + rows.map(r => '<button type="button" class="mv2-plan" onclick="MobileV2.studyNow(\'' + jsArg(r.obraId) + '\',\'' + jsArg(r.movId || '') + '\')">' +
      '<span class="mv2-play" aria-hidden="true">▶</span><span class="mv2-plan-copy"><b>' + esc(r.label) + '</b><small>' + esc(r.detail) + '</small></span></button>').join('');
  }

  /* ── Resumen: anillo + una frase ───────────────────────────────── */
  function sentence(done, t) {
    const eta4 = t && t.eta4, eta5 = t && t.eta5;
    const fmtEta = e => (typeof root._probEtaFmt === 'function' ? root._probEtaFmt(e.etaMin) : clock(e.etaMin));
    if (done >= 300) return 'Día de 5 horas conseguido.';
    if (done >= GOAL_MIN) return eta5 && Number.isFinite(eta5.etaMin) ? 'Ya tienes las 4 h. Si sigues, llegas a 5 h a las ' + fmtEta(eta5) + '.' : 'Ya tienes las 4 h de hoy.';
    if (eta4 && eta4.none) return 'Hoy ya no llegas a 4 h antes de tu hora tope.';
    if (eta4 && Number.isFinite(eta4.etaMin)) return (done ? 'Si sigues ahora, llegas a 4 h a las ' : 'Si empiezas ahora, llegas a 4 h a las ') + fmtEta(eta4) + '.';
    return done ? 'Llevas ' + fmtMin(done) + ' de 4 h.' : 'Aún no has empezado hoy.';
  }
  let rewardCache = { sig: '', text: '' };
  function rewardLine(data) {
    const P = root.PianoRewards;
    if (!P || !data) return '';
    const sig = (data._localRevision || '') + '|' + dayKey() + '|' + Math.floor(Date.now() / 60000);
    if (rewardCache.sig === sig) return rewardCache.text;
    let text = '';
    try {
      const streak = P.streakStats(P.studyState(data).sessions);
      const goal = P.activeGoal(data), progress = goal ? P.goalProgressForDb(data, goal.id) : null;
      const bits = ['Racha: ' + streak.current + (streak.current === 1 ? ' día' : ' días') + (streak.frozen ? ' (congelada)' : '')];
      if (goal && progress) bits.push(goal.name + ' ' + progress.amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
      text = bits.join(' · ');
    } catch (e) { text = ''; }
    rewardCache = { sig, text };
    return text;
  }

  function lineCard(label, value, action, extraClass) {
    return '<button type="button" class="mv2-card mv2-rowcard ' + (extraClass || '') + '" onclick="' + action + '"><span><span class="mv2-lbl">' + label + '</span><b>' + value + '</b></span><span class="mv2-chev" aria-hidden="true">›</span></button>';
  }

  function renderHoy() {
    if (!doc) return;
    const view = doc.getElementById('view-session');
    if (!view) return;
    let host = doc.getElementById('mv2Hoy');
    if (!host) {
      host = doc.createElement('section');
      host.id = 'mv2Hoy'; host.className = 'mv2-hoy'; host.setAttribute('aria-label', 'Hoy');
      view.insertBefore(host, view.firstChild);
    }
    // Solo en el móvil: en iPad y escritorio no se calcula nada.
    if (design() !== 'v2' || !(root.matchMedia && root.matchMedia('(max-width: 700px)').matches)) { host.innerHTML = ''; return; }
    const data = database();
    const done = typeof root._doneMinHoy === 'function' ? root._doneMinHoy() : (typeof root.getMinutosConcentradoHoy === 'function' ? root.getMinutosConcentradoHoy() : 0);
    let t = null; try { t = typeof root._probTextHoy === 'function' ? root._probTextHoy() : null; } catch (e) {}
    const pct = Math.max(0, Math.min(100, Math.round(done / GOAL_MIN * 100)));
    const aulas = (doc.getElementById('reservationDashboardStatus')?.textContent || '').trim() || 'Reservas y salas';
    const rooms = doc.getElementById('sessionAulasDashboard');
    const roomsOpen = rooms && rooms.classList.contains('mv2-open');
    host.innerHTML =
      '<div class="mv2-card mv2-summary"><div class="mv2-ring" style="--p:' + pct + '" role="img" aria-label="' + fmtMin(done) + ' de 4 horas"><span>' + fmtMin(done) + '<small>de 4 h</small></span></div>' +
        '<div class="mv2-summary-copy"><b>' + esc(sentence(done, t)) + '</b><span class="mv2-muted">' + esc(rewardLine(data)) + '</span></div></div>' +
      '<div class="mv2-card mv2-parahoy">' + paraHoyHtml(data) + '</div>' +
      lineCard('Aulas', esc(aulas), 'MobileV2.toggleRooms()', roomsOpen ? 'is-open' : '') +
      lineCard('Alemán', 'Tarjetas, estudio libre y hucha', "showView('deutsch')") +
      '<button type="button" class="mv2-add" onclick="MobileV2.openAdd()">＋ Añadir estudio, nota o tarea</button>';
  }

  /* ── Hojas: «＋ Añadir» y «Pegar plan» ─────────────────────────── */
  function sheet(id, title, inner) {
    let el = doc.getElementById(id);
    if (!el) {
      el = doc.createElement('div'); el.id = id; el.className = 'mv2-sheet-overlay';
      el.addEventListener('click', e => { if (e.target === el) closeSheet(id); });
      doc.body.appendChild(el);
    }
    el.innerHTML = '<div class="mv2-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="mv2-grab" aria-hidden="true"></div><div class="mv2-sheet-head"><b>' + esc(title) + '</b><button type="button" class="mv2-sheet-close" onclick="MobileV2.closeSheet(\'' + id + '\')">Cerrar</button></div>' + inner + '</div>';
    el.classList.add('open');
    return el;
  }
  function closeSheet(id) { doc.getElementById(id)?.classList.remove('open'); }
  function reveal(el) {
    if (!el) return;
    el.classList.add('mv2-open');
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
  function openAdd() {
    const item = (action, icon, title, sub) => '<button type="button" class="mv2-sheet-item" onclick="MobileV2.closeSheet(\'mv2AddSheet\');' + action + '"><span aria-hidden="true">' + icon + '</span><span><b>' + title + '</b><small>' + sub + '</small></span></button>';
    sheet('mv2AddSheet', 'Añadir', '<div class="mv2-sheet-list">' +
      item('MobileV2.addStudy()', '＋', 'Estudio de hoy', 'Minutos sin abrir el cronómetro') +
      item("typeof openSesionManual==='function'&&openSesionManual()", '📅', 'Estudio de otro día', 'Con fecha y detalles') +
      item('MobileV2.addNote()', '✎', 'Nota en el diario', 'Algo que quieras recordar de hoy') +
      item("showView('cronometro')", '☑', 'Tarea', 'En la mesa de trabajo del cronómetro') + '</div>');
  }
  function addStudy() {
    const d = doc.querySelector('#view-session .session-quick-disclosure');
    if (d) { d.open = true; reveal(d); }
  }
  function addNote() {
    const card = doc.getElementById('sessionJournalCard');
    reveal(card);
    if (card && card.classList.contains('is-collapsed') && typeof root.toggleSessionJournal === 'function') root.toggleSessionJournal();
    setTimeout(() => doc.getElementById('sessionJournalInput')?.focus(), 250);
  }
  function toggleRooms() {
    const rooms = doc.getElementById('sessionAulasDashboard');
    if (!rooms) return;
    rooms.classList.toggle('mv2-open');
    if (rooms.classList.contains('mv2-open')) reveal(rooms);
    renderHoy();
  }
  function openPaste() {
    sheet('mv2PasteSheet', 'Plan del Profesor',
      '<p class="mv2-muted">Pega la respuesta del Profesor (o solo su bloque PLAN_PARA_HOY). Cada línea: <b>minutos | obra o movimiento | propósito</b>.</p>' +
      '<textarea id="mv2PasteInput" rows="8" placeholder="PLAN_PARA_HOY&#10;45 | Balada n.º 1 | coda en frío&#10;30 | Partita · Capriccio | fuga lenta"></textarea>' +
      '<div class="mv2-sheet-actions"><button type="button" onclick="MobileV2.pasteFromClipboard()">Pegar del portapapeles</button><button type="button" class="primary" onclick="MobileV2.confirmPaste()">Guardar plan</button></div><p class="mv2-muted" id="mv2PasteMsg" role="status"></p>');
  }
  async function pasteFromClipboard() {
    try { const text = await root.navigator.clipboard.readText(); const box = doc.getElementById('mv2PasteInput'); if (box) box.value = text; }
    catch (e) { const msg = doc.getElementById('mv2PasteMsg'); if (msg) msg.textContent = 'No hay permiso para leer el portapapeles: mantén pulsado el cuadro y elige Pegar.'; }
  }
  function confirmPaste() {
    const n = savePlan(doc.getElementById('mv2PasteInput')?.value || '');
    const msg = doc.getElementById('mv2PasteMsg');
    if (!n) { if (msg) msg.textContent = 'No encuentro líneas con el formato «minutos | obra | propósito».'; return; }
    closeSheet('mv2PasteSheet');
    if (typeof root.showToast === 'function') root.showToast('Plan de hoy guardado · ' + n + (n === 1 ? ' bloque' : ' bloques'));
  }
  function clearPlan() {
    const data = database();
    // La sincronización nunca borra por ausencia: un plan quitado se guarda vacío.
    if (data && data.professorPlan) { data.professorPlan.clearedAt = new Date().toISOString(); data.professorPlan.itemsJson = '[]'; if (typeof root.saveData === 'function') root.saveData(); }
    renderHoy();
  }

  /* ── Ajustes: selector Nuevo / Clásico ─────────────────────────── */
  function installSetting() {
    const list = doc.getElementById('stAppearanceList') || doc.querySelector('#view-ajustes .ajustes-card');
    if (!list || doc.getElementById('mv2DesignRow')) return;
    const row = doc.createElement('div');
    row.id = 'mv2DesignRow'; row.className = 'mv2-design-row st-row st-row--stack';
    row.innerHTML = '<span class="st-ico" style="--c:#5b82a6"><svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg></span>' +
      '<span class="st-label"><b>Diseño en el móvil</b><small>El clásico conserva la disposición anterior.</small></span>' +
      '<div class="st-ctl st-seg ajustes-seg" role="group" aria-label="Diseño en el móvil"><button type="button" data-mobile-design="v2" onclick="MobileV2.setDesign(\'v2\')">Nuevo</button><button type="button" data-mobile-design="classic" onclick="MobileV2.setDesign(\'classic\')">Clásico</button></div>';
    list.appendChild(row);
    applyDesign();
  }

  /* ── Cronómetro: hoja de herramientas y vuelta arriba al empezar ─── */
  function phoneV2() { return design() === 'v2' && root.matchMedia && root.matchMedia('(max-width: 700px)').matches; }
  function scrim() {
    let el = doc.getElementById('mv2SheetScrim');
    if (!el) { el = doc.createElement('div'); el.id = 'mv2SheetScrim'; el.className = 'mv2-sheet-scrim'; el.addEventListener('click', closeTools); doc.body.appendChild(el); }
    return el;
  }
  function setTools(drawer, open) {
    if (!drawer) return;
    drawer.classList.toggle('mv2-sheet-open', !!open);
    scrim().classList.toggle('on', !!open && phoneV2());
  }
  function closeTools() { doc.querySelectorAll('#cronoIdleDrawer, #cronoRunDrawer').forEach(d => setTools(d, false)); }
  function installCrono() {
    ['cronoIdleDrawer', 'cronoRunDrawer'].forEach(id => {
      const drawer = doc.getElementById(id);
      if (!drawer || drawer.dataset.mv2) return;
      drawer.dataset.mv2 = '1';
      const toggle = doc.createElement('button');
      toggle.type = 'button'; toggle.className = 'mv2-sheet-toggle'; toggle.setAttribute('aria-label', 'Herramientas');
      toggle.addEventListener('click', () => setTools(drawer, !drawer.classList.contains('mv2-sheet-open')));
      drawer.appendChild(toggle);
      // Tocar una pestaña (no «Pase +», que es una acción) abre la hoja.
      drawer.addEventListener('click', event => {
        if (!phoneV2()) return;
        const tab = event.target.closest && event.target.closest('.crono-run-drawer-tab');
        if (tab && tab.dataset.tab) setTools(drawer, true);
      });
    });
    // ¿Se ve la barra inferior? Entonces la hoja va encima, no debajo.
    const measureNav = () => {
      const nav = doc.querySelector('.nav.nav-bottom');
      const r = nav && nav.getBoundingClientRect();
      // Solo cuenta como barra inferior si es ancha y está abajo (no un raíl lateral).
      const visible = !!(r && r.height > 0 && r.height < 160 && r.width > root.innerWidth * .6 && r.bottom >= root.innerHeight - 2 &&
        getComputedStyle(nav).display !== 'none' && getComputedStyle(nav).visibility !== 'hidden');
      const rail = !!(r && r.height > 160 && r.left <= 0 && r.width > 0 && r.width < root.innerWidth * .5 && getComputedStyle(nav).display !== 'none');
      doc.body.classList.toggle('mv2-nav-rail', rail);
      if (rail) doc.documentElement.style.setProperty('--mv2-rail-w', Math.ceil(r.right) + 'px');
      doc.body.classList.toggle('mv2-nav-visible', visible);
      if (visible) doc.documentElement.style.setProperty('--mv2-nav-h', Math.ceil(root.innerHeight - r.top) + 'px');
    };
    measureNav();
    root.addEventListener('resize', measureNav);
    new MutationObserver(measureNav).observe(doc.body, { attributes: true, attributeFilter: ['class', 'data-view'] });
    // Cualquier selección de pestaña (tocar o por código: recordatorio de
    // tareas, dictado…) abre la hoja; si no, el panel se abriría invisible.
    [['cronoSetIdleDrawerTab', 'cronoIdleDrawer'], ['cronoSetRunDrawerTab', 'cronoRunDrawer']].forEach(([fn, id]) => {
      if (typeof root[fn] !== 'function' || root[fn].__mv2) return;
      const original = root[fn];
      const wrapped = function (tab) {
        const r = original.apply(this, arguments);
        if (phoneV2()) setTools(doc.getElementById(id), true);
        return r;
      };
      wrapped.__mv2 = true;
      root[fn] = wrapped;
    });
    // Al empezar, el reloj arriba: la página podía quedar desplazada y el
    // anillo acababa bajo la cabecera.
    if (typeof root.cronoStart === 'function' && !root.cronoStart.__mv2) {
      const original = root.cronoStart;
      const wrapped = function () {
        const r = original.apply(this, arguments);
        if (phoneV2()) setTimeout(() => {
          [doc.scrollingElement, doc.querySelector('.app-content'), doc.getElementById('view-cronometro')].forEach(el => { if (el) el.scrollTop = 0; });
        }, 60);
        return r;
      };
      wrapped.__mv2 = true;
      root.cronoStart = wrapped;
    }
  }


  /* ── Calendario (fase 3): mapa de horas + eventos + hoja del día ──── */
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  let calOffset = 0;
  let renderingCalendar = false;
  // Niveles del mapa: 0 · <1 h · <2,5 h · <4 h · 4 h+ · 5 h+
  function level(min) { return !min ? 0 : min < 60 ? 1 : min < 150 ? 2 : min < 240 ? 3 : min < 300 ? 4 : 5; }
  const parseDay = key => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const dayDiff = key => Math.round((parseDay(key) - parseDay(dayKey())) / 86400000);

  function eventsByDay(data) {
    const map = {};
    (data && data.eventos || []).forEach(e => {
      if (!e || e.completado || !e.fecha || !/^\d{4}-\d{2}-\d{2}/.test(e.fecha)) return;
      const k = String(e.fecha).slice(0, 10);
      (map[k] = map[k] || []).push(e);
    });
    return map;
  }
  function workLabel(data, obraId, movId) {
    const work = (data && data.obras || []).find(o => String(o.id) === String(obraId));
    if (!work) return obraId ? 'Obra borrada' : 'Sin obra';
    const mov = movId && (work.movimientos || []).find(m => String(m.id) === String(movId));
    return mov ? work.name + ' · ' + mov.name : work.name;
  }
  // Tramos reales del día (mismas reglas que «Sesiones por horas»).
  function segmentsOf(data, key) {
    const seen = new Set(), out = [];
    ['sessionPlants', 'forestPlants'].forEach(src => (data && data[src] || []).forEach(p => {
      if (!p || p.failed || p.tipo === 'descanso' || p.obraId === '_rest_' || !(Number(p.mins) > 0)) return;
      const start = new Date(p.startedAt || p.endedAt);
      if (!Number.isFinite(start.getTime()) || dayKey(start) !== key) return;
      const id = [p.obraId, p.startedAt, p.endedAt].join('|');
      if (seen.has(id)) return; seen.add(id);
      const end = p.endedAt ? new Date(p.endedAt) : new Date(start.getTime() + Number(p.mins) * 60000);
      out.push({ start, end, mins: Math.round(Number(p.mins)), label: workLabel(data, p.obraId, p.movId), obraId: p.obraId });
    }));
    return out.sort((a, b) => a.start - b.start);
  }
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

  function renderCal() {
    if (!doc) return;
    const view = doc.getElementById('view-calendario');
    if (!view) return;
    let host = doc.getElementById('mv2Cal');
    if (!host) { host = doc.createElement('section'); host.id = 'mv2Cal'; host.className = 'mv2-cal'; view.insertBefore(host, view.firstChild); }
    if (!phoneV2()) { host.innerHTML = ''; return; }
    const data = database();
    const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + calOffset, 1, 12);
    const year = first.getFullYear(), month = first.getMonth();
    const gridStart = new Date(year, month, 1 - ((first.getDay() + 6) % 7), 12);
    const end = new Date(year, month + 1, 7);
    let mins = {};
    try { mins = typeof root._statsMinsPorDia === 'function' ? root._statsMinsPorDia(new Date(gridStart.getTime() - 43200000), end) : {}; } catch (e) { mins = {}; }
    const events = eventsByDay(data), today = dayKey();
    let cells = '';
    const weeks = Math.ceil((((first.getDay() + 6) % 7) + new Date(year, month + 1, 0).getDate()) / 7);
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      const k = dayKey(d), m = Math.round(mins[k] || 0), other = d.getMonth() !== month, ev = events[k];
      cells += '<button type="button" class="mv2-day l' + level(m) + (other ? ' other' : '') + (k === today ? ' today' : '') + '" data-day="' + k + '" aria-label="' + d.getDate() + ' de ' + MONTHS[d.getMonth()] + ': ' + (m ? fmtMin(m) : 'sin estudio') + (ev ? ', ' + ev.length + ' evento' + (ev.length > 1 ? 's' : '') : '') + '">' +
        '<span>' + d.getDate() + '</span>' + (ev ? '<i class="mv2-ev" aria-hidden="true"></i>' : '') + '</button>';
    }
    let monthTotal = 0; Object.keys(mins).forEach(k => { if (parseDay(k).getMonth() === month && parseDay(k).getFullYear() === year) monthTotal += mins[k]; });
    const upcoming = Object.keys(events).filter(k => k >= today).sort().flatMap(k => events[k].map(e => ({ k, e }))).slice(0, 5);
    const evRows = upcoming.length ? upcoming.map(({ k, e }) => {
      const days = dayDiff(k), works = (e.obras || []).map(id => workLabel(data, id)).filter(Boolean);
      return '<button type="button" class="mv2-evrow" onclick="openEditEvento(\'' + jsArg(e.id) + '\')"><span class="mv2-count"><b>' + (days === 0 ? 'hoy' : days) + '</b>' + (days === 0 ? '' : '<small>' + (days === 1 ? 'día' : 'días') + '</small>') + '</span>' +
        '<span class="mv2-evcopy"><b>' + esc(e.nombre || 'Evento') + '</b><small>' + parseDay(k).getDate() + ' ' + MONTHS_SHORT[parseDay(k).getMonth()] + (works.length ? ' · ' + esc(works.slice(0, 3).join(', ')) + (works.length > 3 ? '…' : '') : '') + '</small></span></button>';
    }).join('') : '<p class="mv2-muted">Sin eventos próximos.</p>';
    host.innerHTML =
      '<div class="mv2-card"><div class="mv2-cal-head"><button type="button" class="mv2-cal-nav" onclick="MobileV2.calMove(-1)" aria-label="Mes anterior">‹</button>' +
        '<div><b>' + MONTHS[month].charAt(0).toUpperCase() + MONTHS[month].slice(1) + ' ' + year + '</b><small>' + (monthTotal ? fmtMin(monthTotal) + ' estudiadas' : 'Sin estudio registrado') + '</small></div>' +
        '<button type="button" class="mv2-cal-nav" onclick="MobileV2.calMove(1)" aria-label="Mes siguiente">›</button></div>' +
        '<div class="mv2-cal-grid" role="grid">' + ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(w => '<span class="mv2-wd">' + w + '</span>').join('') + cells + '</div>' +
        '<div class="mv2-legend"><span>Horas</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><i class="l5"></i><span>5 h+</span><span class="mv2-legend-ev"><i class="mv2-ev"></i>Evento</span></div></div>' +
      '<div class="mv2-card"><div class="mv2-line"><span class="mv2-lbl">Próximos eventos</span><button type="button" class="mv2-link" onclick="openAddEvento()">＋ Añadir</button></div>' + evRows +
        '<button type="button" class="mv2-link mv2-more" onclick="MobileV2.calClassic(true)">Lista completa, hábitos y Google ›</button></div>';
  }

  function openDay(key) {
    const data = database();
    const d = parseDay(key), segs = segmentsOf(data, key);
    let total = 0;
    try { total = Math.round((root._statsMinsPorDia(new Date(d.getTime() - 43200000), new Date(d.getTime() + 43200000))[key]) || 0); } catch (e) {}
    const byWork = {};
    segs.forEach(sg => { byWork[sg.label] = (byWork[sg.label] || 0) + sg.mins; });
    const shades = ['var(--accent)', 'color-mix(in srgb, var(--accent) 70%, var(--bg2))', 'color-mix(in srgb, var(--accent) 45%, var(--bg2))', 'color-mix(in srgb, var(--accent) 25%, var(--bg2))'];
    const stack = Object.entries(byWork).sort((a, b) => b[1] - a[1]).map(([, m], i) => '<i style="flex:' + m + ';background:' + shades[i % shades.length] + '"></i>').join('');
    const ev = (eventsByDay(data)[key] || []).map(e => '<button type="button" class="mv2-seg is-event" onclick="MobileV2.closeSheet(\'mv2DaySheet\');openEditEvento(\'' + jsArg(e.id) + '\')"><span>★ ' + esc(e.nombre || 'Evento') + '</span><b>›</b></button>').join('');
    let habits = '';
    try {
      const list = typeof root.habitAllChallenges === 'function' ? root.habitAllChallenges() : [];
      habits = list.map(h => ({ h, st: root.habitCalendarDayState(h, key, dayKey()) })).filter(x => x.st === 'success' || x.st === 'failure' || x.st === 'current')
        .map(x => (x.st === 'success' ? '✓ ' : x.st === 'failure' ? '✗ ' : '• ') + esc(x.h.title || 'Hábito')).join(' · ');
    } catch (e) {}
    let flashes = 0;
    try { flashes = (typeof root.getAllDestellos === 'function' ? root.getAllDestellos() : []).filter(f => dayKey(new Date(f.date)) === key).length; } catch (e) {}
    const extras = [habits, flashes ? '✨ ' + flashes + (flashes === 1 ? ' destello' : ' destellos') : ''].filter(Boolean).join(' · ');
    const title = WEEKDAYS[d.getDay()].charAt(0).toUpperCase() + WEEKDAYS[d.getDay()].slice(1) + ' ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
    sheet('mv2DaySheet', title,
      '<div class="mv2-day-total"><span class="mv2-muted">Estudiado</span><b>' + (total ? fmtDur(total) : '—') + '</b></div>' +
      (stack ? '<div class="mv2-stack">' + stack + '</div>' : '') + ev +
      (segs.length ? segs.map(sg => '<div class="mv2-seg"><span>' + hhmm(sg.start) + '–' + hhmm(sg.end) + ' · ' + esc(sg.label) + '</span><b>' + fmtMin(sg.mins) + '</b></div>').join('') : '<p class="mv2-muted">Sin tramos con hora este día.</p>') +
      (extras ? '<p class="mv2-muted">' + extras + '</p>' : '') +
      '<div class="mv2-sheet-actions"><button type="button" onclick="MobileV2.closeSheet(\'mv2DaySheet\');openAddEventoOnDate(\'' + key + '\')">＋ Evento</button>' +
      '<button type="button" class="primary" onclick="MobileV2.closeSheet(\'mv2DaySheet\');MobileV2.editDay(\'' + key + '\')">Editar este día</button></div>');
  }
  function editDay(key) {
    const data = database();
    const ses = (data && data.sesiones || []).find(s => dayKey(new Date(s.date)) === key);
    if (ses && typeof root.openEditarSesion === 'function') root.openEditarSesion(ses.date);
    else if (typeof root.openSesionManual === 'function') root.openSesionManual();
  }
  function calMove(delta) { calOffset += delta; renderCal(); }
  function calClassic(on) {
    const view = doc.getElementById('view-calendario');
    if (view) view.classList.toggle('mv2-cal-classic', !!on);
    if (on) { const back = doc.getElementById('mv2CalBack'); if (!back && view) { const b = doc.createElement('button'); b.id = 'mv2CalBack'; b.type = 'button'; b.className = 'mv2-link mv2-cal-back'; b.textContent = '‹ Volver al mapa del mes'; b.onclick = () => calClassic(false); view.insertBefore(b, view.firstChild); } view.scrollIntoView && root.scrollTo && root.scrollTo(0, 0); }
    else doc.getElementById('mv2CalBack')?.remove();
  }
  function installCal() {
    const view = doc.getElementById('view-calendario');
    if (!view || view.dataset.mv2) return;
    view.dataset.mv2 = '1';
    view.addEventListener('click', e => { const b = e.target.closest && e.target.closest('#mv2Cal .mv2-day'); if (b) openDay(b.dataset.day); });
    if (typeof root.renderCalendario === 'function' && !root.renderCalendario.__mv2) {
      const original = root.renderCalendario;
      const wrapped = function () { renderingCalendar = true; try { return original.apply(this, arguments); } finally { renderingCalendar = false; } };
      wrapped.__mv2 = true; root.renderCalendario = wrapped;
    }
    if (typeof root.renderMesCalendario === 'function' && !root.renderMesCalendario.__mv2) {
      const original = root.renderMesCalendario;
      const wrapped = function () { const r = original.apply(this, arguments); try { renderCal(); } catch (err) {} return r; };
      wrapped.__mv2 = true; root.renderMesCalendario = wrapped;
    }
    // Si algo abre una pestaña concreta (hábitos, eventos…), se muestra la vista completa.
    if (typeof root.switchCalTab === 'function' && !root.switchCalTab.__mv2) {
      const original = root.switchCalTab;
      // renderCalendario re-aplica la pestaña guardada en cada repintado: eso
      // no es una petición del usuario ni de otra pantalla, así que se ignora.
      const wrapped = function () {
        const r = original.apply(this, arguments);
        if (phoneV2() && !renderingCalendar) calClassic(true);
        return r;
      };
      wrapped.__mv2 = true; root.switchCalTab = wrapped;
    }
    new MutationObserver(() => { if (doc.body.getAttribute('data-view') === 'calendario') renderCal(); }).observe(doc.body, { attributes: true, attributeFilter: ['data-view'] });
  }

  function install() {
    if (!doc || install.done) return;
    install.done = true;
    applyDesign();
    const hook = () => {
      if (typeof root.renderSessionResumen !== 'function' || root.renderSessionResumen.__mv2) return;
      const original = root.renderSessionResumen;
      const wrapped = function () { const r = original.apply(this, arguments); try { renderHoy(); } catch (e) {} return r; };
      wrapped.__mv2 = true;
      root.renderSessionResumen = wrapped;
    };
    const ready = () => { hook(); installSetting(); installCrono(); installCal(); renderHoy(); renderCal(); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
    root.addEventListener('load', () => { ready(); setTimeout(renderHoy, 2500); }, { once: true });
    // Las prioridades del Profesor se cargan tarde: repintar cuando estén.
    let tries = 0; const wait = setInterval(() => { if (root.ProfessorHandoffResilience || ++tries > 60) { clearInterval(wait); renderHoy(); } }, 500);
  }
  if (doc) install();

  return { renderCal, openDay, editDay, calMove, calClassic, segmentsOf, level, closeTools, design, setDesign, planToday, parsePlan, parseMinutes, matchUnit, savePlan, clearPlan, renderHoy, studyNow, openAdd, addStudy, addNote, toggleRooms, openPaste, pasteFromClipboard, confirmPaste, closeSheet, sentence };
});
