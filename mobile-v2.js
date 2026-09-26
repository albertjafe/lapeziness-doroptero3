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
    applyDesign(); renderHoy();
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
    const card = doc.querySelector('#view-ajustes .ajustes-card');
    if (!card || doc.getElementById('mv2DesignRow')) return;
    const row = doc.createElement('div');
    row.id = 'mv2DesignRow'; row.className = 'mv2-design-row';
    row.innerHTML = '<div><b>Diseño en el móvil</b><small>El clásico conserva la disposición anterior.</small></div>' +
      '<div class="ajustes-seg" role="group" aria-label="Diseño en el móvil"><button type="button" data-mobile-design="v2" onclick="MobileV2.setDesign(\'v2\')">Nuevo</button><button type="button" data-mobile-design="classic" onclick="MobileV2.setDesign(\'classic\')">Clásico</button></div>';
    card.appendChild(row);
    applyDesign();
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
    const ready = () => { hook(); installSetting(); renderHoy(); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
    root.addEventListener('load', () => { ready(); setTimeout(renderHoy, 2500); }, { once: true });
    // Las prioridades del Profesor se cargan tarde: repintar cuando estén.
    let tries = 0; const wait = setInterval(() => { if (root.ProfessorHandoffResilience || ++tries > 60) { clearInterval(wait); renderHoy(); } }, 500);
  }
  if (doc) install();

  return { design, setDesign, planToday, parsePlan, parseMinutes, matchUnit, savePlan, clearPlan, renderHoy, studyNow, openAdd, addStudy, addNote, toggleRooms, openPaste, pasteFromClipboard, confirmPaste, closeSheet, sentence };
});
