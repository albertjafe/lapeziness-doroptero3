(function professorDashboard() {
  'use strict';

  const VIEW_ID = 'view-profesor';
  const SETTINGS_KEY = 'professorSettings';
  let lastReport = null;
  let renderGeneration = 0;
  let booted = false;

  function database() {
    try { return typeof db !== 'undefined' ? db : (window.db || null); } catch (error) { return window.db || null; }
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
  }
  function fmtMinutes(value) {
    const minutes = Math.max(0, Number(value) || 0);
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  function settings() {
    const data = database();
    const value = data && data[SETTINGS_KEY];
    return value && typeof value === 'object' ? value : {};
  }
  function masterPrompt() {
    return String(settings().masterPrompt || window.ProfessorCore?.DEFAULT_MASTER_PROMPT || '');
  }
  function noteValue() {
    return document.getElementById('professorUserNote')?.value || '';
  }

  function injectStyles() {
    if (document.getElementById('professorDashboardStyles')) return;
    const style = document.createElement('style');
    style.id = 'professorDashboardStyles';
    style.textContent = `
      #${VIEW_ID}{padding:18px 18px 110px;max-width:1180px;margin:0 auto;}
      .prof-hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:14px;margin-bottom:14px}
      .prof-card{background:var(--bg2);border:1px solid var(--border);border-radius:18px;padding:16px;box-shadow:0 8px 28px rgba(0,0,0,.035)}
      .prof-eyebrow{font:600 10px 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--text3);margin-bottom:6px}
      .prof-title{font-family:'Cormorant Garamond',serif;font-size:29px;line-height:1.05;color:var(--text);margin:0}
      .prof-sub{font-size:12px;line-height:1.5;color:var(--text2);margin-top:7px;max-width:720px}
      .prof-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
      .prof-action{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:999px;padding:10px 13px;font-size:12px;cursor:pointer;min-height:42px}
      .prof-action.primary{background:var(--accent);color:var(--bg);border-color:var(--accent);font-weight:700}
      .prof-note{width:100%;box-sizing:border-box;margin-top:12px;min-height:68px;resize:vertical;border:1px solid var(--border);border-radius:12px;background:var(--bg);color:var(--text);padding:10px 12px;font:12px/1.45 inherit}
      .prof-today-number{font:600 34px 'Cormorant Garamond',serif;color:var(--text);line-height:1}
      .prof-today-lines{margin-top:9px;display:grid;gap:5px;font-size:11px;color:var(--text2)}
      .prof-section{margin-top:16px}.prof-section-head{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:0 2px 8px}
      .prof-section h3{font:600 13px 'JetBrains Mono',monospace;letter-spacing:.05em;margin:0;color:var(--text)}
      .prof-muted{font-size:11px;color:var(--text3)}
      .prof-priority-list{display:grid;gap:8px}
      .prof-unit{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:11px;align-items:center;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:11px 12px}
      .prof-score{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:var(--bg3);font:700 13px 'JetBrains Mono',monospace;color:var(--text)}
      .prof-score[data-band="urgente"]{outline:2px solid color-mix(in srgb,var(--accent) 60%,transparent)}
      .prof-unit-name{font-weight:650;font-size:13px;color:var(--text);line-height:1.25}.prof-unit-composer{font-size:10px;color:var(--text3);margin-top:2px}
      .prof-unit-meta{display:flex;flex-wrap:wrap;gap:5px 10px;margin-top:6px;font:10px 'JetBrains Mono',monospace;color:var(--text2)}
      .prof-unit-reason{font-size:10px;color:var(--text3);margin-top:5px}
      .prof-pill{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:5px 8px;font:10px 'JetBrains Mono',monospace;white-space:nowrap;color:var(--text2)}
      .prof-events{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.prof-event{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:11px}
      .prof-event-date{font:600 10px 'JetBrains Mono',monospace;color:var(--text3)}.prof-event-name{font-weight:650;font-size:13px;margin-top:4px;color:var(--text)}
      .prof-event-meta{font-size:10px;color:var(--text2);margin-top:5px}.prof-warning{margin-top:7px;padding:8px 10px;border-radius:10px;background:var(--bg3);font-size:10px;color:var(--text2)}
      .prof-repertoire{display:grid;gap:8px}.prof-work-group{background:var(--bg2);border:1px solid var(--border);border-radius:14px;overflow:hidden}.prof-work-group summary{cursor:pointer;padding:11px 13px;font-weight:650;font-size:12px;display:flex;justify-content:space-between;gap:10px}.prof-work-units{border-top:1px solid var(--border);padding:6px}.prof-work-units .prof-unit{border:0;border-radius:10px;background:transparent}
      .prof-advanced{margin-top:16px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:0 13px}.prof-advanced summary{cursor:pointer;padding:12px 0;font-size:11px;color:var(--text2)}
      .prof-master{width:100%;min-height:250px;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);padding:11px;font:11px/1.5 'JetBrains Mono',monospace}
      .prof-crono-open{display:flex;align-items:center;gap:7px;margin:8px auto 12px;padding:9px 13px;border:1px solid var(--border);border-radius:999px;background:var(--bg2);color:var(--text);font-size:11px;cursor:pointer}
      @media(max-width:720px){#${VIEW_ID}{padding:12px 12px 104px}.prof-hero{grid-template-columns:1fr}.prof-title{font-size:25px}.prof-unit{grid-template-columns:44px minmax(0,1fr)}.prof-unit>div:last-child{grid-column:2}.prof-events{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensureView() {
    if (document.getElementById(VIEW_ID)) return document.getElementById(VIEW_ID);
    const host = document.querySelector('.app-content');
    if (!host) return null;
    const view = document.createElement('div');
    view.className = 'view';
    view.id = VIEW_ID;
    view.setAttribute('data-no-view-swipe', '');
    host.appendChild(view);
    return view;
  }

  function repurposeCasaNav() {
    const button = document.querySelector('.nav-btn[data-view="casa"]');
    if (!button || button.dataset.professorReady === '1') return;
    button.dataset.professorReady = '1';
    button.dataset.view = 'profesor';
    button.dataset.short = 'Profe';
    button.setAttribute('aria-label', 'Profesor');
    button.setAttribute('onclick', "showView('profesor')");
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V6.8A2.8 2.8 0 0 1 6.8 4H12v15.5H6.8A2.8 2.8 0 0 0 4 22"/><path d="M20 19.5V6.8A2.8 2.8 0 0 0 17.2 4H12v15.5h5.2A2.8 2.8 0 0 1 20 22"/><path d="M8 8h1.5M14.5 8H16M8 11h1.5M14.5 11H16"/></svg><span>Profesor</span>';
  }

  function addCronoButton() {
    const crono = document.getElementById('view-cronometro');
    if (!crono || document.getElementById('professorCronoOpen')) return;
    const button = document.createElement('button');
    button.id = 'professorCronoOpen';
    button.className = 'prof-crono-open';
    button.type = 'button';
    button.innerHTML = '<span aria-hidden="true">✦</span><strong>Profesor</strong><span>¿qué estudio ahora?</span>';
    button.onclick = () => window.showView('profesor');
    crono.insertBefore(button, crono.firstChild);
  }

  function renderUnit(unit, compact) {
    const solidity = unit.solidity == null ? '?' : `${Math.round(unit.solidity)}%`;
    const recovery = `${unit.recoveryHours.low}–${unit.recoveryHours.high} h`;
    const event = unit.nextEvent ? `${esc(unit.nextEvent.name)} · ${unit.nextEvent.daysAway} d` : 'sin evento enlazado';
    return `<div class="prof-unit">
      <div class="prof-score" data-band="${esc(unit.priority.band)}">${Math.round(unit.priority.score)}</div>
      <div>
        <div class="prof-unit-name">${esc(unit.movement || unit.work)}</div>
        <div class="prof-unit-composer">${esc(unit.composer)}${unit.movement ? ` · ${esc(unit.work)}` : ''}</div>
        <div class="prof-unit-meta"><span>sol ${solidity}</span><span>dif ${unit.difficulty}</span><span>hoy ${fmtMinutes(unit.recent.today)}</span><span>7d ${fmtMinutes(unit.recent.d7)}</span><span>30d ${fmtMinutes(unit.recent.d30)}</span><span>rec ${recovery}</span></div>
        ${compact ? '' : `<div class="prof-unit-reason">${esc(unit.priority.reasons.join(' · '))}</div>`}
      </div>
      <div><span class="prof-pill">${event}</span></div>
    </div>`;
  }

  function renderEvents(report) {
    if (!report.events.length) return '<div class="prof-card prof-muted">No hay eventos futuros disponibles en la app o Google Calendar.</div>';
    return `<div class="prof-events">${report.events.map(event => `<div class="prof-event">
      <div class="prof-event-date">${esc(event.day)} · ${event.daysAway} días</div>
      <div class="prof-event-name">${esc(event.name)}</div>
      <div class="prof-event-meta">${esc(event.source === 'google' ? 'Google Calendar' : (event.type || 'App'))}</div>
      ${event.repertoireLinked ? `<div class="prof-event-meta">Repertorio enlazado: ${event.workIds.length} obra(s)</div>` : '<div class="prof-warning">Sin repertorio enlazado: cuenta como agenda, no como prioridad musical.</div>'}
    </div>`).join('')}</div>`;
  }

  function renderRepertoire(report) {
    const groups = new Map();
    report.units.forEach(unit => {
      if (!groups.has(unit.obraId)) groups.set(unit.obraId, []);
      groups.get(unit.obraId).push(unit);
    });
    return `<div class="prof-repertoire">${Array.from(groups.values()).map(units => {
      const first = units[0];
      const maxP = Math.max(...units.map(u => u.priority.score));
      return `<details class="prof-work-group"><summary><span>${esc(first.composer ? first.composer + ' · ' : '')}${esc(first.work)}</span><span class="prof-muted">máx P${Math.round(maxP)} · hist ${first.historicalWorkHours} h</span></summary><div class="prof-work-units">${units.map(u => renderUnit(u, true)).join('')}</div></details>`;
    }).join('')}</div>`;
  }

  async function render() {
    const host = ensureView();
    if (!host || !window.ProfessorCore) return;
    const data = database() || {};
    const generation=++renderGeneration;
    if(!lastReport)host.textContent='Preparando el contexto completo…';
    const report = window.ProfessorHandoffResilience
      ? await window.ProfessorHandoffResilience.buildReportAsync(data)
      : window.ProfessorCore.buildReport(data, { asOf: new Date() });
    if(generation !== renderGeneration)return;
    lastReport = report;
    const note=document.getElementById('professorUserNote')?.value || '';
    const studiedLines = report.today.byUnit.slice(0, 6).map(item => `<div>${esc(item.label)} · <strong>${fmtMinutes(item.minutes)}</strong></div>`).join('') || '<div>Aún no hay movimientos registrados hoy.</div>';
    host.innerHTML = `
      <section class="prof-hero">
        <div class="prof-card">
          <div class="prof-eyebrow">Superinforme · contexto vivo</div>
          <h2 class="prof-title">Profesor</h2>
          <div class="prof-sub">Planifica movimiento por movimiento con todo el contexto. Si el informe es grande, copia o adjunta el archivo completo al abrir ChatGPT.</div>
          <textarea class="prof-note" id="professorUserNote" placeholder="Condición opcional para este turno: «he dormido 5 h», «Claudio quiere que hoy no toque Waldstein», «solo tengo 45 min»…"></textarea>
          <div class="prof-actions">
            <button class="prof-action primary" data-prof-mode="remaining">Organizar lo que queda de hoy</button>
            <button class="prof-action" data-prof-mode="now">¿Qué estudio ahora?</button>
            <button class="prof-action" data-prof-mode="today">Organizar hoy</button>
            <button class="prof-action" data-prof-mode="week">Próximos 7 días</button>
            <button class="prof-action" id="professorCopyReport">Copiar superinforme</button>
          </div>
        </div>
        <div class="prof-card">
          <div class="prof-eyebrow">Hoy</div>
          <div class="prof-today-number">${fmtMinutes(report.today.totalKnownMinutes)}</div>
          <div class="prof-today-lines">${studiedLines}${report.today.unallocatedMinutes ? `<div>Sin movimiento · <strong>${fmtMinutes(report.today.unallocatedMinutes)}</strong></div>` : ''}</div>
          ${report.warnings.map(w => `<div class="prof-warning">${esc(w)}</div>`).join('')}
        </div>
      </section>

      <section class="prof-section"><div class="prof-section-head"><h3>PRIORIDADES AHORA</h3><span class="prof-muted">P0–100 · no es una orden, es riesgo relativo</span></div><div class="prof-priority-list">${report.units.filter(unit => unit.planningEligible !== false).slice(0, 10).map(unit => renderUnit(unit, false)).join('')}</div></section>
      <section class="prof-section"><div class="prof-section-head"><h3>EVENTOS PRÓXIMOS</h3><span class="prof-muted">Agenda futura</span></div>${renderEvents(report)}</section>
      <section class="prof-section"><div class="prof-section-head"><h3>FICHA MOVIMIENTO POR MOVIMIENTO</h3><span class="prof-muted">${report.coverage.movements} movimientos · ${report.coverage.worksWithoutMovements} obras completas</span></div>${renderRepertoire(report)}</section>

      <details class="prof-advanced"><summary>Ajustes avanzados · prompt maestro</summary><textarea class="prof-master" id="professorMasterPrompt">${esc(masterPrompt())}</textarea><div class="prof-actions" style="padding-bottom:12px"><button class="prof-action primary" id="professorSavePrompt">Guardar prompt maestro</button><button class="prof-action" id="professorResetPrompt">Restaurar predeterminado</button></div></details>
    `;
    host.querySelectorAll('[data-prof-mode]').forEach(button => button.addEventListener('click', () => openChatGPT(button.dataset.profMode)));
    host.querySelector('#professorCopyReport')?.addEventListener('click', copyReport);
    host.querySelector('#professorSavePrompt')?.addEventListener('click', saveMasterPrompt);
    host.querySelector('#professorResetPrompt')?.addEventListener('click', resetMasterPrompt);
    host.querySelector('#professorUserNote').value=note;

  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (error) {}
    try {
      const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
      const ok = document.execCommand('copy'); area.remove(); return ok;
    } catch (error) { return false; }
  }

  async function copyReport() {
    const report = window.ProfessorHandoffResilience
      ? await window.ProfessorHandoffResilience.buildReportAsync(database() || {})
      : window.ProfessorCore.buildReport(database() || {}, { asOf:new Date() });
    const text = window.ProfessorHandoffResilience ? window.ProfessorHandoffResilience.denseContext(report) : window.ProfessorCore.compactContext(report);
    const ok = await copyText(text);
    if (typeof showToast === 'function') showToast(ok ? 'Superinforme copiado' : 'No se pudo copiar');
  }

  function openChatGPT(mode) {
    if (window.ProfessorHandoffResilience) return window.ProfessorHandoffResilience.openSafe(mode);
    if (typeof showToast === 'function') showToast('Preparando el Profesor… vuelve a pulsar en un momento.');
  }

  function saveMasterPrompt() {
    const value = document.getElementById('professorMasterPrompt')?.value.trim();
    if (!value) return;
    const data = database();
    if (!data) return;
    data[SETTINGS_KEY] = { ...(data[SETTINGS_KEY] || {}), masterPrompt: value, updatedAt: new Date().toISOString() };
    if (typeof window.saveData === 'function') window.saveData();
    if (typeof showToast === 'function') showToast('Prompt maestro guardado');
  }

  function resetMasterPrompt() {
    const area = document.getElementById('professorMasterPrompt');
    if (area) area.value = window.ProfessorCore.DEFAULT_MASTER_PROMPT;
    saveMasterPrompt();
  }

  function wrapShowView() {
    const original = window.showView;
    if (typeof original !== 'function' || original.__professorWrapped) return;
    const wrapped = function professorShowView(name) {
      const result = original.apply(this, arguments);
      if (name === 'profesor') {
        render();
        const title = document.getElementById('headerTitle'); if (title) title.textContent = 'Profesor';
        const eyebrow = document.getElementById('headerEyebrow'); if (eyebrow) eyebrow.textContent = 'Planificación';
      }
      return result;
    };
    wrapped.__professorWrapped = true;
    window.showView = wrapped;
  }

  function boot() {
    if (booted) return; booted = true;
    injectStyles(); ensureView(); repurposeCasaNav(); addCronoButton(); wrapShowView();
    window.renderProfessorDashboard = render;
    window.openProfessorInChatGPT = openChatGPT;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
