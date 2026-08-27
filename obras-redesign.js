(function () {
  'use strict';

  const legacyRenderObras = typeof window.renderObras === 'function' ? window.renderObras : null;
  const state = {
    query: '',
    scope: 'all',
    sort: 'smart',
    selectedId: null,
    selectedKind: 'work',
    edit: false,
    showActivities: false,
    menuOpen: false,
    legacy: false,
  };

  function data() {
    try { if (typeof DB !== 'undefined' && DB) return DB; } catch (error) {}
    try { if (typeof db !== 'undefined' && db) return db; } catch (error) {}
    return null;
  }

  function persist() {
    try {
      if (typeof save === 'function') return save();
      if (typeof saveData === 'function') return saveData();
    } catch (error) {}
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function norm(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function clampSol(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }

  function currentSol(work) {
    const history = Array.isArray(work && work.solHistory) ? work.solHistory : [];
    if (history.length) {
      const latest = history.reduce((best, item) => {
        const a = Date.parse(best && (best.date || best.fecha || best.at || best.timestamp || '')) || 0;
        const b = Date.parse(item && (item.date || item.fecha || item.at || item.timestamp || '')) || 0;
        return b >= a ? item : best;
      }, history[0]);
      const fromHistory = clampSol(latest && (latest.val ?? latest.value ?? latest.sol));
      if (fromHistory != null) return fromHistory;
    }
    return clampSol(work && work.sol);
  }

  function latestWorkDate(work) {
    const values = [];
    const collect = list => (Array.isArray(list) ? list : []).forEach(item => {
      const raw = item && (item.date || item.fecha || item.at || item.timestamp || item.createdAt || item.updatedAt);
      const time = Date.parse(raw || '');
      if (Number.isFinite(time)) values.push(time);
    });
    collect(work && work.solHistory);
    collect(work && work.paseHistory);
    (work && work.movimientos || []).forEach(mov => { collect(mov.solHistory); collect(mov.paseHistory); });
    return values.length ? Math.max.apply(null, values) : null;
  }

  function relativeDate(time) {
    if (!time) return 'sin práctica reciente';
    const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
    if (days === 0) return 'hoy';
    if (days === 1) return 'ayer';
    if (days < 14) return `hace ${days} d`;
    if (days < 70) return `hace ${Math.round(days / 7)} sem`;
    if (days < 730) return `hace ${Math.round(days / 30)} meses`;
    return `hace ${Math.round(days / 365)} años`;
  }

  function stageLabel(work) {
    const raw = norm(work && (work.learningStage || work.estado));
    const map = {
      lectura: 'Lectura', digitando: 'Digitando', manos: 'Manos juntas', consolidando: 'Consolidando',
      mantenimiento: 'Mantenimiento', 'aprendiendo-inicial': 'Aprendiendo', aprendiendo: 'Aprendiendo',
    };
    return map[raw] || (raw ? raw.replace(/-/g, ' ') : '');
  }

  function statusLabel(work) {
    const stage = stageLabel(work);
    if (stage) return stage;
    const sol = currentSol(work);
    if (sol == null) return 'Sin medir';
    if (sol >= 80) return 'A punto';
    if (sol >= 60) return 'Cerca';
    if (sol >= 35) return 'En progreso';
    return 'En construcción';
  }

  function eventBoost(work) {
    const d = data();
    const events = d && Array.isArray(d.eventos) ? d.eventos : [];
    const now = Date.now();
    let best = null;
    events.forEach(event => {
      let serialized = '';
      try { serialized = JSON.stringify(event); } catch (error) {}
      if (!serialized.includes(String(work.id))) return;
      const raw = event.fechaInicio || event.fecha || event.startDate || event.date || event.inicio;
      const time = Date.parse(raw || '');
      if (!Number.isFinite(time) || time < now - 86400000) return;
      if (best == null || time < best) best = time;
    });
    if (best == null) return 0;
    const days = (best - now) / 86400000;
    return days <= 14 ? 90 : days <= 45 ? 60 : days <= 90 ? 35 : 15;
  }

  function priorityScore(work) {
    const last = latestWorkDate(work);
    const days = last ? Math.max(0, (Date.now() - last) / 86400000) : 9999;
    const sol = currentSol(work);
    const hasHistory = Array.isArray(work.solHistory) && work.solHistory.length;
    const stage = norm(work.learningStage || work.estado);
    let score = eventBoost(work);
    if (days <= 3) score += 70;
    else if (days <= 10) score += 55;
    else if (days <= 30) score += 32;
    else if (days <= 90) score += 12;
    if (stage && stage !== 'mantenimiento') score += 25;
    if (stage === 'mantenimiento') score += 8;
    if ((hasHistory || last || stage) && sol != null && sol < 80) score += Math.min(28, (80 - sol) * .45);
    return score;
  }

  function workMinutes(work) {
    const d = data();
    let total = Number(work && work.minutosExtra) || 0;
    (d && d.sesiones || []).forEach(session => {
      (session && session.items || []).forEach(item => {
        if (!item || item.estudiado === false || String(item.obraId || '') !== String(work.id)) return;
        total += Number(item.minutosReales ?? item.minutosEstudiados ?? item.min ?? item.minutos ?? 0) || 0;
      });
    });
    return Math.max(0, total);
  }

  function fmtStudy(minutes) {
    const value = Math.round(Number(minutes) || 0);
    if (value < 60) return `${value} min`;
    const h = Math.floor(value / 60), m = value % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  function passCount(work) {
    let count = Array.isArray(work.paseHistory) ? work.paseHistory.length : 0;
    (work.movimientos || []).forEach(mov => { count += Array.isArray(mov.paseHistory) ? mov.paseHistory.length : 0; });
    return count;
  }

  function matches(entry, query) {
    if (!query) return true;
    return norm(`${entry.name || ''} ${entry.composer || ''} ${entry.context || ''} ${entry.notes || ''}`).includes(norm(query));
  }

  function sortedWorks(works) {
    const copy = works.slice();
    if (state.sort === 'composer') return copy.sort((a,b) => norm(a.composer).localeCompare(norm(b.composer)) || norm(a.name).localeCompare(norm(b.name)));
    if (state.sort === 'title') return copy.sort((a,b) => norm(a.name).localeCompare(norm(b.name)));
    if (state.sort === 'solidity') return copy.sort((a,b) => (currentSol(a) ?? -1) - (currentSol(b) ?? -1) || norm(a.name).localeCompare(norm(b.name)));
    if (state.sort === 'recent') return copy.sort((a,b) => (latestWorkDate(b) || 0) - (latestWorkDate(a) || 0) || norm(a.name).localeCompare(norm(b.name)));
    return copy.sort((a,b) => priorityScore(b) - priorityScore(a) || norm(a.composer).localeCompare(norm(b.composer)) || norm(a.name).localeCompare(norm(b.name)));
  }

  function isMasterDetail() {
    return !document.documentElement.classList.contains('platform-windows') && window.matchMedia('(min-width: 980px) and (orientation: landscape)').matches;
  }

  function ensureHeader() {
    const bench = document.querySelector('#view-obras .obras-workbench');
    if (!bench || document.getElementById('obrasRedesignHead')) return;
    const head = document.createElement('section');
    head.id = 'obrasRedesignHead';
    head.className = 'obras-rd-head';
    head.innerHTML = `
      <div class="obras-rd-top">
        <div class="obras-rd-heading"><span>Tu repertorio</span><strong id="obrasRdCount"></strong></div>
        <div class="obras-rd-actions">
          <div class="obras-rd-menu-wrap">
            <button type="button" class="obras-rd-icon" id="obrasRdMenuBtn" aria-label="Más opciones" aria-expanded="false">···</button>
            <div class="obras-rd-menu" id="obrasRdMenu" hidden>
              <button type="button" data-menu="activities">Mostrar actividades</button>
              <button type="button" data-menu="archive">Gestionar histórico</button>
              <button type="button" data-menu="legacy">Vista clásica / herramientas</button>
            </div>
          </div>
          <button type="button" class="obras-rd-add" id="obrasRdAdd">＋ Añadir</button>
        </div>
      </div>
      <div class="obras-rd-controls">
        <label class="obras-rd-search"><span aria-hidden="true">⌕</span><input id="obrasRdSearch" type="search" autocomplete="off" placeholder="Buscar obra o compositor…"></label>
        <div class="obras-rd-scope" role="tablist" aria-label="Filtrar repertorio">
          <button type="button" class="active" data-scope="all">Todas</button>
          <button type="button" data-scope="active">Activas</button>
          <button type="button" data-scope="history">Histórico</button>
        </div>
        <label class="obras-rd-sort"><span>Ordenar</span><select id="obrasRdSort"><option value="smart">Prioridad</option><option value="composer">Compositor</option><option value="recent">Última práctica</option><option value="solidity">Solidez</option><option value="title">Título</option></select></label>
      </div>`;
    bench.insertBefore(head, bench.firstChild);

    document.getElementById('obrasRdAdd').addEventListener('click', () => { if (typeof openAddObra === 'function') openAddObra(); });
    document.getElementById('obrasRdSearch').addEventListener('input', event => { state.query = event.target.value; render(); });
    document.getElementById('obrasRdSort').addEventListener('change', event => { state.sort = event.target.value; render(); });
    head.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => {
      state.scope = button.dataset.scope;
      head.querySelectorAll('[data-scope]').forEach(item => item.classList.toggle('active', item === button));
      render();
    }));
    const menuBtn = document.getElementById('obrasRdMenuBtn');
    menuBtn.addEventListener('click', event => { event.stopPropagation(); state.menuOpen = !state.menuOpen; updateMenu(); });
    document.getElementById('obrasRdMenu').addEventListener('click', event => {
      const button = event.target.closest('[data-menu]');
      if (!button) return;
      const action = button.dataset.menu;
      state.menuOpen = false; updateMenu();
      if (action === 'activities') { state.showActivities = !state.showActivities; render(); }
      if (action === 'archive') {
        if (typeof window.openHistoricalRepertoire === 'function') {
          window.openHistoricalRepertoire();
          setTimeout(() => document.getElementById('historicalRepertoirePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
        }
      }
      if (action === 'legacy') enterLegacy();
    });
    document.addEventListener('click', event => {
      if (!state.menuOpen || event.target.closest('.obras-rd-menu-wrap')) return;
      state.menuOpen = false; updateMenu();
    });
  }

  function updateMenu() {
    const menu = document.getElementById('obrasRdMenu');
    const btn = document.getElementById('obrasRdMenuBtn');
    if (!menu || !btn) return;
    menu.hidden = !state.menuOpen;
    btn.setAttribute('aria-expanded', state.menuOpen ? 'true' : 'false');
    const activity = menu.querySelector('[data-menu="activities"]');
    if (activity) activity.textContent = state.showActivities ? 'Ocultar actividades' : 'Mostrar actividades';
  }

  function enterLegacy() {
    state.legacy = true;
    document.getElementById('view-obras')?.classList.add('obras-legacy-mode');
    let banner = document.getElementById('obrasLegacyReturn');
    if (!banner) {
      banner = document.createElement('button');
      banner.type = 'button';
      banner.id = 'obrasLegacyReturn';
      banner.className = 'obras-legacy-return';
      banner.textContent = '← Volver al diseño nuevo';
      document.querySelector('#view-obras .obras-workbench')?.insertAdjacentElement('afterend', banner);
      banner.addEventListener('click', leaveLegacy);
    }
    banner.hidden = false;
    if (legacyRenderObras) legacyRenderObras();
  }

  function leaveLegacy() {
    state.legacy = false;
    document.getElementById('view-obras')?.classList.remove('obras-legacy-mode');
    const banner = document.getElementById('obrasLegacyReturn');
    if (banner) banner.hidden = true;
    render();
  }

  function rowHtml(work, selected) {
    const sol = currentSol(work);
    const last = latestWorkDate(work);
    const duration = Number(work.duracion);
    const meta = [Number.isFinite(duration) && duration > 0 ? `${duration} min` : '', relativeDate(last)].filter(Boolean).join(' · ');
    return `<article class="obras-rd-row ${selected ? 'selected' : ''}" data-work-id="${esc(work.id)}" tabindex="0" role="button" aria-label="Abrir ${esc(work.name)}">
      <div class="obras-rd-row-main">
        <div class="obras-rd-composer">${esc(work.composer || 'Repertorio')}</div>
        <div class="obras-rd-title">${esc(work.name || 'Obra sin título')}</div>
        <div class="obras-rd-meta">${esc(meta)}${statusLabel(work) ? `<span>${esc(statusLabel(work))}</span>` : ''}</div>
        <div class="obras-rd-solbar"><i style="width:${sol == null ? 0 : sol}%"></i></div>
      </div>
      <div class="obras-rd-row-side"><strong>${sol == null ? '—' : `${sol}%`}</strong><span>${esc(sol != null && sol >= 80 ? 'a punto' : '')}</span></div>
    </article>`;
  }

  function historicalRowHtml(entry, selected) {
    const years = entry.fromYear && entry.toYear ? (entry.fromYear === entry.toYear ? `~${entry.fromYear}` : `${entry.fromYear}–${entry.toYear}`) : entry.lastPlayedYear ? `última ~${entry.lastPlayedYear}` : 'periodo aproximado';
    const hours = Number(entry.estimatedHours);
    return `<article class="obras-rd-row historical ${selected ? 'selected' : ''}" data-history-id="${esc(entry.id)}" tabindex="0" role="button">
      <div class="obras-rd-row-main"><div class="obras-rd-composer">${esc(entry.composer || 'Archivo')}</div><div class="obras-rd-title">${esc(entry.name || 'Obra histórica')}</div><div class="obras-rd-meta">${esc(years)}${Number.isFinite(hours) ? `<span>≈ ${esc(hours)} h históricas</span>` : ''}</div></div>
      <div class="obras-rd-archive-mark">Archivo</div>
    </article>`;
  }

  function activityRowHtml(work) {
    return `<article class="obras-rd-row activity" data-activity-id="${esc(work.id)}"><div class="obras-rd-row-main"><div class="obras-rd-composer">Actividad</div><div class="obras-rd-title">${esc(work.name)}</div><div class="obras-rd-meta">${esc(fmtStudy(workMinutes(work)))}</div></div></article>`;
  }

  function sectionHtml(label, hint, rows, className) {
    if (!rows.length) return '';
    return `<section class="obras-rd-section ${className || ''}"><header><div><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</div><strong>${rows.length}</strong></header><div class="obras-rd-rows">${rows.join('')}</div></section>`;
  }

  function emptyDetail() {
    return `<div class="obras-rd-detail-empty"><span>Repertorio</span><strong>Selecciona una obra</strong><p>En iPad horizontal, la ficha permanece aquí para comparar y editar sin abrir ventanas.</p></div>`;
  }

  function movementSol(mov) {
    const history = Array.isArray(mov && mov.solHistory) ? mov.solHistory : [];
    if (history.length) {
      const latest = history[0];
      const v = clampSol(latest && (latest.val ?? latest.value ?? latest.sol));
      if (v != null) return v;
    }
    return clampSol(mov && mov.sol);
  }

  function detailViewHtml(work) {
    const sol = currentSol(work), escn = clampSol(work.esc);
    const movements = Array.isArray(work.movimientos) ? work.movimientos : [];
    const rows = movements.length ? movements.map((mov,index) => `<div class="obras-rd-movement"><div><strong>${index + 1}</strong><span>${esc(mov.name || `Movimiento ${index + 1}`)}</span></div><span>${mov.duracion ? `${mov.duracionEstimada ? '≈ ' : ''}${esc(mov.duracion)} min` : '—'}</span><span>${movementSol(mov) == null ? '—' : `${movementSol(mov)}%`}</span></div>`).join('') : '<div class="obras-rd-detail-note">No hay movimientos registrados.</div>';
    const structure = window.WorkStructureCatalog && window.WorkStructureCatalog.matchWorkStructure(work);
    const canEnrich = structure && (!movements.length || movements.some((mov,i) => structure.movements[i] && (window.WorkStructureCatalog.isGenericMovementName(mov.name) || mov.duracion == null)));
    return `<div class="obras-rd-detail-card">
      <header class="obras-rd-detail-head"><div><span>${esc(work.composer || 'Repertorio')}</span><h2>${esc(work.name)}</h2><p>${work.duracion ? `${esc(work.duracion)} min` : 'Duración no indicada'}${stageLabel(work) ? ` · ${esc(stageLabel(work))}` : ''}${work.dificultad ? ` · dificultad ${esc(work.dificultad)}/10` : ''}</p></div><button type="button" data-detail-action="edit">Editar</button></header>
      <div class="obras-rd-stats"><div><span>Solidez</span><strong>${sol == null ? '—' : `${sol}%`}</strong></div><div><span>Escena</span><strong>${escn == null ? '—' : `${escn}%`}</strong></div><div><span>Estudiado</span><strong>${esc(fmtStudy(workMinutes(work)))}</strong></div><div><span>Pases</span><strong>${passCount(work)}</strong></div></div>
      <section class="obras-rd-detail-section"><header><strong>Movimientos</strong>${canEnrich ? '<button type="button" data-detail-action="enrich">Completar nombres y duraciones</button>' : ''}</header><div class="obras-rd-movements">${rows}</div></section>
      ${work.notes ? `<section class="obras-rd-detail-section"><header><strong>Notas</strong></header><p class="obras-rd-notes">${esc(work.notes)}</p></section>` : ''}
      <footer><button type="button" data-detail-action="premium">Abrir ficha completa</button></footer>
    </div>`;
  }

  function movementHasHistory(mov) {
    return ['solHistory','paseHistory','zoneHistory','compasHistory'].some(key => Array.isArray(mov && mov[key]) && mov[key].length);
  }

  function detailEditHtml(work) {
    const movements = Array.isArray(work.movimientos) ? work.movimientos : [];
    return `<div class="obras-rd-detail-card edit">
      <header class="obras-rd-detail-head"><div><span>Editar obra</span><h2>${esc(work.name)}</h2></div></header>
      <div class="obras-rd-edit-grid">
        <label class="wide"><span>Título</span><input data-edit-field="name" value="${esc(work.name || '')}"></label>
        <label><span>Compositor</span><input data-edit-field="composer" value="${esc(work.composer || '')}"></label>
        <label><span>Duración</span><input data-edit-field="duration" type="number" min="0" step="0.5" value="${work.duracion == null ? '' : esc(work.duracion)}"></label>
        <label><span>Dificultad</span><input data-edit-field="difficulty" type="number" min="1" max="10" value="${work.dificultad == null ? '' : esc(work.dificultad)}"></label>
      </div>
      <section class="obras-rd-detail-section"><header><strong>Movimientos y duración</strong><button type="button" data-detail-action="enrich-edit">Completar desde catálogo</button></header><div class="obras-rd-edit-movements">${movements.map((mov,index) => `<div class="obras-rd-edit-movement" data-edit-mov="${index}"><input data-mov-field="name" value="${esc(mov.name || '')}"><input data-mov-field="duration" type="number" min="0" step="0.5" value="${mov.duracion == null ? '' : esc(mov.duracion)}"><button type="button" data-detail-action="remove-mov" data-index="${index}">−</button></div>`).join('')}</div><button type="button" class="obras-rd-subtle" data-detail-action="add-mov">＋ Añadir movimiento</button></section>
      <label class="obras-rd-notes-edit"><span>Notas</span><textarea data-edit-field="notes" rows="3">${esc(work.notes || '')}</textarea></label>
      <footer><button type="button" class="secondary" data-detail-action="cancel">Cancelar</button><button type="button" class="primary" data-detail-action="save">Guardar cambios</button></footer>
    </div>`;
  }

  function historicalDetailHtml(entry) {
    const period = entry.fromYear && entry.toYear ? (entry.fromYear === entry.toYear ? `~${entry.fromYear}` : `${entry.fromYear}–${entry.toYear}`) : entry.fromYear ? `desde ~${entry.fromYear}` : entry.toYear ? `hasta ~${entry.toYear}` : 'Sin periodo indicado';
    return `<div class="obras-rd-detail-card historical-detail"><header class="obras-rd-detail-head"><div><span>${esc(entry.composer || 'Archivo personal')}</span><h2>${esc(entry.name)}</h2><p>${esc(period)}${entry.lastPlayedYear ? ` · última vez ~${esc(entry.lastPlayedYear)}` : ''}</p></div></header><div class="obras-rd-stats historical"><div><span>Horas históricas</span><strong>${Number.isFinite(Number(entry.estimatedHours)) ? `≈ ${esc(entry.estimatedHours)} h` : '—'}</strong></div><div><span>Nivel</span><strong>${esc(entry.peakLevel || '—')}</strong></div></div>${entry.context ? `<section class="obras-rd-detail-section"><header><strong>Contexto</strong></header><p class="obras-rd-notes">${esc(entry.context)}</p></section>` : ''}${entry.notes ? `<section class="obras-rd-detail-section"><header><strong>Notas</strong></header><p class="obras-rd-notes">${esc(entry.notes)}</p></section>` : ''}<footer><button type="button" data-detail-action="archive">Gestionar en archivo</button></footer></div>`;
  }

  function collectDraft(root, work) {
    const clone = JSON.parse(JSON.stringify(work));
    clone.name = root.querySelector('[data-edit-field="name"]')?.value.trim() || clone.name;
    clone.composer = root.querySelector('[data-edit-field="composer"]')?.value.trim() || '';
    const duration = Number(root.querySelector('[data-edit-field="duration"]')?.value);
    clone.duracion = Number.isFinite(duration) && duration > 0 ? duration : null;
    const diff = Number(root.querySelector('[data-edit-field="difficulty"]')?.value);
    if (Number.isFinite(diff) && diff >= 1) clone.dificultad = Math.max(1, Math.min(10, diff));
    clone.notes = root.querySelector('[data-edit-field="notes"]')?.value || '';
    root.querySelectorAll('[data-edit-mov]').forEach(row => {
      const index = Number(row.dataset.editMov);
      const mov = clone.movimientos[index]; if (!mov) return;
      const name = row.querySelector('[data-mov-field="name"]')?.value.trim();
      const dur = Number(row.querySelector('[data-mov-field="duration"]')?.value);
      if (name) mov.name = name;
      mov.duracion = Number.isFinite(dur) && dur > 0 ? dur : null;
      if (mov.duracion != null) { mov.duracionEstimada = false; mov.duracionFuente = 'manual'; }
    });
    return clone;
  }

  function bindDetail(container) {
    container.querySelectorAll('[data-detail-action]').forEach(button => button.addEventListener('click', () => {
      const d = data();
      const work = d && (d.obras || []).find(item => String(item.id) === String(state.selectedId));
      const action = button.dataset.detailAction;
      if (action === 'edit' && work) { state.edit = true; renderDetail(); }
      if (action === 'cancel') { state.edit = false; renderDetail(); }
      if (action === 'premium' && work && typeof window.openPremiumWork === 'function') window.openPremiumWork(work.id);
      if (action === 'archive') { if (typeof window.openHistoricalRepertoire === 'function') { window.openHistoricalRepertoire(); setTimeout(() => document.getElementById('historicalRepertoirePanel')?.scrollIntoView({behavior:'smooth'}),40); } }
      if ((action === 'enrich' || action === 'enrich-edit') && work && window.WorkStructureCatalog) {
        const source = action === 'enrich-edit' ? collectDraft(container, work) : work;
        const result = window.WorkStructureCatalog.completeWorkStructure(source);
        if (result.changed) {
          if (action === 'enrich-edit') {
            work.__rdDraft = result.work;
            renderDetail(result.work);
          } else {
            work.movimientos = result.work.movimientos; persist(); render();
          }
        }
      }
      if (action === 'add-mov' && work) {
        const draft = collectDraft(container, work);
        draft.movimientos = Array.isArray(draft.movimientos) ? draft.movimientos : [];
        draft.movimientos.push({ id:`mv${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name:`Movimiento ${draft.movimientos.length+1}`, duracion:null, dificultad:5, apr:1, esc:1, sol:1, solHistory:[], paseHistory:[], zoneHistory:[], compasHistory:[] });
        work.__rdDraft = draft; renderDetail(draft);
      }
      if (action === 'remove-mov' && work) {
        const draft = collectDraft(container, work);
        const index = Number(button.dataset.index), mov = draft.movimientos[index];
        if (!mov) return;
        if (movementHasHistory(mov) && !window.confirm(`“${mov.name || 'Este movimiento'}” tiene historial. ¿Eliminarlo igualmente?`)) return;
        draft.movimientos.splice(index,1); work.__rdDraft = draft; renderDetail(draft);
      }
      if (action === 'save' && work) {
        const base = work.__rdDraft || work;
        const draft = collectDraft(container, base);
        ['name','composer','duracion','dificultad','notes','movimientos'].forEach(key => { work[key] = draft[key]; });
        delete work.__rdDraft;
        state.edit = false; persist(); render();
      }
    }));
  }

  function renderDetail(overrideWork) {
    const container = document.getElementById('obrasRdDetail');
    if (!container) return;
    const d = data();
    if (state.selectedKind === 'history') {
      const entry = d && (d.historicalRepertoire || []).find(item => String(item.id) === String(state.selectedId));
      container.innerHTML = entry ? historicalDetailHtml(entry) : emptyDetail(); bindDetail(container); return;
    }
    const work = overrideWork || (d && (d.obras || []).find(item => String(item.id) === String(state.selectedId)));
    if (!work) { container.innerHTML = emptyDetail(); return; }
    const shown = state.edit ? (work.__rdDraft || work) : work;
    container.innerHTML = state.edit ? detailEditHtml(shown) : detailViewHtml(shown);
    bindDetail(container);
  }

  function bindRows(root) {
    root.querySelectorAll('[data-work-id]').forEach(row => {
      const open = () => {
        const id = row.dataset.workId;
        if (!isMasterDetail()) { if (typeof window.openPremiumWork === 'function') window.openPremiumWork(id); else if (typeof window.toggleObra === 'function') window.toggleObra(id); return; }
        state.selectedId = id; state.selectedKind = 'work'; state.edit = false;
        try { localStorage.setItem('obras_rd_selected', id); } catch (error) {}
        render();
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
    root.querySelectorAll('[data-history-id]').forEach(row => {
      const open = () => {
        const id = row.dataset.historyId;
        if (!isMasterDetail()) { if (typeof window.openHistoricalRepertoire === 'function') { window.openHistoricalRepertoire(); setTimeout(() => document.getElementById('historicalRepertoirePanel')?.scrollIntoView({behavior:'smooth'}),40); } return; }
        state.selectedId = id; state.selectedKind = 'history'; state.edit = false; render();
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
  }

  function render() {
    if (state.legacy) { if (legacyRenderObras) legacyRenderObras(); return; }
    ensureHeader();
    const d = data();
    const list = document.getElementById('obrasList');
    if (!d || !list) return;
    const works = (d.obras || []).filter(item => item && item.tipo !== 'actividad');
    const activities = (d.obras || []).filter(item => item && item.tipo === 'actividad');
    const history = Array.isArray(d.historicalRepertoire) ? d.historicalRepertoire : [];
    const count = document.getElementById('obrasRdCount');
    if (count) count.textContent = `${works.length} obras${history.length ? ` · ${history.length} históricas` : ''}`;

    const filteredWorks = works.filter(item => matches(item, state.query));
    const filteredHistory = history.filter(item => matches(item, state.query));
    const priorityCandidates = filteredWorks.filter(work => priorityScore(work) > 0).sort((a,b) => priorityScore(b) - priorityScore(a));
    const now = priorityCandidates.slice(0, 6);
    const nowIds = new Set(now.map(item => String(item.id)));
    const repertoire = sortedWorks(filteredWorks.filter(item => !nowIds.has(String(item.id))));
    const sortedHistory = filteredHistory.slice().sort((a,b) => norm(a.composer).localeCompare(norm(b.composer)) || norm(a.name).localeCompare(norm(b.name)));

    if (!state.selectedId || (state.selectedKind === 'work' && !works.some(item => String(item.id) === String(state.selectedId)))) {
      let remembered = null;
      try { remembered = localStorage.getItem('obras_rd_selected'); } catch (error) {}
      const initial = works.find(item => String(item.id) === String(remembered)) || now[0] || filteredWorks[0] || works[0];
      state.selectedId = initial ? initial.id : null; state.selectedKind = 'work';
    }

    const activeSections = state.scope !== 'history' ? [
      sectionHtml('Ahora', 'lo que merece atención primero', now.map(work => rowHtml(work, state.selectedKind === 'work' && String(state.selectedId) === String(work.id))), 'now'),
      sectionHtml('Repertorio activo', state.sort === 'smart' ? 'orden inteligente' : '', repertoire.map(work => rowHtml(work, state.selectedKind === 'work' && String(state.selectedId) === String(work.id))), 'active'),
      state.showActivities ? sectionHtml('Actividades', 'separadas de las obras', activities.filter(item => matches(item,state.query)).map(activityRowHtml), 'activities') : '',
    ].join('') : '';
    const historySection = state.scope !== 'active' ? sectionHtml('Histórico', 'archivo personal · horas fuera de estadísticas', sortedHistory.map(entry => historicalRowHtml(entry, state.selectedKind === 'history' && String(state.selectedId) === String(entry.id))), 'history') : '';
    const master = activeSections + historySection;

    list.innerHTML = `<div class="obras-rd-layout"><div class="obras-rd-master">${master || '<div class="obras-rd-empty">No hay resultados.</div>'}</div><aside class="obras-rd-detail" id="obrasRdDetail"></aside></div>`;
    bindRows(list);
    renderDetail();
    updateMenu();
  }

  function boot(attempt) {
    if (!data() || !document.getElementById('obrasList')) { if (attempt < 80) setTimeout(() => boot(attempt + 1), 100); return; }
    ensureHeader();
    window.renderObras = render;
    window.ObrasRedesign = { render, leaveLegacy, enterLegacy, state };
    render();
    window.addEventListener('resize', () => { if (!state.legacy) render(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(0), { once:true }); else boot(0);
})();
