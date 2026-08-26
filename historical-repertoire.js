// ─── REPERTORIO HISTÓRICO ────────────────────────────────────────────────────
// Archivo separado de las obras activas. Las horas estimadas viven únicamente
// en db.historicalRepertoire y nunca se copian a minutosExtra/sesiones, por lo
// que no afectan a gráficas ni estadísticas de estudio real.
(function historicalRepertoireFeature() {
  'use strict';

  const STORE_KEY = 'historicalRepertoire';
  const LEVELS = {
    lectura: 'Leída',
    estudiada: 'Estudiada',
    solida: 'Sólida',
    publico: 'Interpretada en público',
    concurso: 'Nivel concurso',
  };

  let editingId = null;
  let searchTerm = '';

  function appReady() {
    try {
      return typeof db !== 'undefined' && db && typeof saveData === 'function';
    } catch (error) {
      return false;
    }
  }

  function ensureStore() {
    if (!Array.isArray(db[STORE_KEY])) db[STORE_KEY] = [];
    return db[STORE_KEY];
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function parseYear(value) {
    const year = Number.parseInt(value, 10);
    return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
  }

  function parseHours(value) {
    if (value === '' || value == null) return null;
    const hours = Number(value);
    return Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 2) / 2 : null;
  }

  function periodLabel(entry) {
    const from = parseYear(entry.fromYear);
    const to = parseYear(entry.toYear);
    if (from && to && from === to) return `~${from}`;
    if (from && to) return `${Math.min(from, to)}–${Math.max(from, to)}`;
    if (from) return `desde ~${from}`;
    if (to) return `hasta ~${to}`;
    return 'Periodo aproximado no indicado';
  }

  function hoursLabel(entry) {
    const hours = Number(entry.estimatedHours);
    if (!Number.isFinite(hours) || hours < 0) return 'Horas sin estimar';
    const rounded = Number.isInteger(hours) ? hours : hours.toFixed(1).replace('.', ',');
    return `~${rounded} h estimadas`;
  }

  function levelLabel(level) {
    return LEVELS[level] || 'Nivel no indicado';
  }

  function showToastSafe(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  function injectStyles() {
    if (document.getElementById('historicalRepertoireStyles')) return;
    const style = document.createElement('style');
    style.id = 'historicalRepertoireStyles';
    style.textContent = `
      .historical-open-btn { display:inline-flex; align-items:center; justify-content:center; }
      .historical-repertoire-panel { margin:18px 0 26px; border:1px solid var(--border); background:var(--bg2); border-radius:14px; overflow:hidden; }
      .historical-repertoire-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; padding:16px 18px 13px; border-bottom:1px solid var(--border2); }
      .historical-repertoire-kicker { font-size:9px; text-transform:uppercase; letter-spacing:.12em; color:var(--text3); margin-bottom:4px; }
      .historical-repertoire-title { font-size:18px; font-weight:700; color:var(--text); }
      .historical-repertoire-sub { margin-top:5px; max-width:620px; color:var(--text2); font-size:11px; line-height:1.45; }
      .historical-repertoire-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
      .historical-repertoire-add, .historical-card-btn { border:1px solid var(--border); background:var(--bg3); color:var(--text); border-radius:9px; padding:8px 11px; font:600 11px/1.1 var(--ui-font, sans-serif); cursor:pointer; }
      .historical-repertoire-add { background:var(--accent); border-color:var(--accent); color:var(--bg); }
      .historical-repertoire-search-wrap { padding:11px 18px 0; }
      .historical-repertoire-search { width:100%; box-sizing:border-box; border:1px solid var(--border2); background:var(--bg); color:var(--text); border-radius:9px; padding:10px 12px; font-size:12px; outline:none; }
      .historical-repertoire-search:focus { border-color:var(--accent); }
      .historical-repertoire-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; padding:12px 18px 18px; }
      .historical-card { border:1px solid var(--border2); background:var(--bg); border-radius:11px; padding:14px; min-width:0; }
      .historical-card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
      .historical-card-name { font-family:'Cormorant Garamond',serif; font-size:19px; line-height:1.1; font-weight:600; color:var(--text); }
      .historical-card-composer { margin-top:3px; color:var(--text2); font-size:10px; }
      .historical-badge { flex:0 0 auto; border:1px solid var(--border2); border-radius:999px; padding:4px 7px; color:var(--text3); font-size:8px; text-transform:uppercase; letter-spacing:.08em; }
      .historical-badge.reactivated { color:var(--green); border-color:color-mix(in srgb,var(--green) 40%,var(--border2)); }
      .historical-card-meta { display:flex; flex-wrap:wrap; gap:6px; margin:11px 0 9px; }
      .historical-chip { border-radius:999px; background:var(--bg3); color:var(--text2); padding:5px 7px; font-size:9px; }
      .historical-card-detail { color:var(--text2); font-size:10px; line-height:1.45; margin-top:5px; }
      .historical-card-actions { display:flex; gap:7px; margin-top:12px; justify-content:flex-end; }
      .historical-card-btn.primary { border-color:color-mix(in srgb,var(--accent) 55%,var(--border)); color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,var(--bg)); }
      .historical-card-btn:disabled { opacity:.45; cursor:default; }
      .historical-empty { grid-column:1/-1; padding:22px; text-align:center; color:var(--text3); font-size:11px; }
      .historical-modal-overlay { position:fixed; inset:0; z-index:10050; display:none; align-items:center; justify-content:center; padding:18px; background:rgba(0,0,0,.52); backdrop-filter:blur(7px); }
      .historical-modal-overlay.open { display:flex; }
      .historical-modal { width:min(560px,100%); max-height:min(760px,90vh); overflow:auto; background:var(--bg2); color:var(--text); border:1px solid var(--border); border-radius:16px; box-shadow:0 22px 70px rgba(0,0,0,.28); padding:20px; }
      .historical-modal-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:16px; }
      .historical-modal-title { font-family:'Cormorant Garamond',serif; font-size:25px; font-weight:600; }
      .historical-modal-close { width:34px; height:34px; border-radius:50%; border:1px solid var(--border2); background:var(--bg3); color:var(--text2); cursor:pointer; font-size:19px; }
      .historical-modal-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 12px; }
      .historical-field { display:flex; flex-direction:column; gap:5px; }
      .historical-field.full { grid-column:1/-1; }
      .historical-field label { color:var(--text3); font-size:9px; text-transform:uppercase; letter-spacing:.08em; }
      .historical-field input, .historical-field select, .historical-field textarea { width:100%; box-sizing:border-box; border:1px solid var(--border2); border-radius:9px; background:var(--bg); color:var(--text); padding:10px 11px; font:12px/1.3 var(--ui-font,sans-serif); outline:none; }
      .historical-field textarea { min-height:72px; resize:vertical; }
      .historical-field input:focus, .historical-field select:focus, .historical-field textarea:focus { border-color:var(--accent); }
      .historical-modal-note { margin:13px 0; padding:10px 11px; border-radius:9px; background:color-mix(in srgb,var(--accent) 7%,var(--bg)); color:var(--text2); font-size:10px; line-height:1.45; }
      .historical-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
      .historical-modal-actions button { min-height:40px; padding:0 14px; border-radius:10px; border:1px solid var(--border); font-weight:700; cursor:pointer; }
      .historical-modal-cancel { background:transparent; color:var(--text2); }
      .historical-modal-save { background:var(--accent); color:var(--bg); border-color:var(--accent)!important; }
      @media (max-width:700px) {
        .historical-repertoire-head { flex-direction:column; }
        .historical-repertoire-actions { width:100%; justify-content:flex-start; }
        .historical-repertoire-list { grid-template-columns:1fr; padding-inline:12px; }
        .historical-repertoire-search-wrap { padding-inline:12px; }
        .historical-modal-grid { grid-template-columns:1fr; }
        .historical-field.full { grid-column:auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectPanel() {
    if (document.getElementById('historicalRepertoirePanel')) return;
    const obrasList = document.getElementById('obrasList');
    if (!obrasList) return;

    const panel = document.createElement('section');
    panel.id = 'historicalRepertoirePanel';
    panel.className = 'historical-repertoire-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <header class="historical-repertoire-head">
        <div>
          <div class="historical-repertoire-kicker">Archivo personal</div>
          <div class="historical-repertoire-title">Repertorio histórico <span id="historicalRepertoireCount"></span></div>
          <div class="historical-repertoire-sub">Obras que tocaste en el pasado. Los años y horas pueden ser aproximados; las horas históricas no entran en ninguna gráfica ni estadística de estudio real.</div>
        </div>
        <div class="historical-repertoire-actions">
          <button type="button" class="historical-repertoire-add" id="historicalRepertoireAdd">+ Añadir antigua</button>
        </div>
      </header>
      <div class="historical-repertoire-search-wrap">
        <input class="historical-repertoire-search" id="historicalRepertoireSearch" type="search" placeholder="Buscar obra o compositor…" autocomplete="off">
      </div>
      <div class="historical-repertoire-list" id="historicalRepertoireList"></div>
    `;
    obrasList.insertAdjacentElement('afterend', panel);

    const actions = document.querySelector('.obras-topbar-actions');
    if (actions && !document.getElementById('historicalRepertoireToggle')) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = 'historicalRepertoireToggle';
      toggle.className = 'obras-more-toggle historical-open-btn';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Archivo';
      const addButton = actions.querySelector('.obras-primary-add');
      actions.insertBefore(toggle, addButton || null);
      toggle.addEventListener('click', togglePanel);
    }

    document.getElementById('historicalRepertoireAdd').addEventListener('click', () => openEditor());
    document.getElementById('historicalRepertoireSearch').addEventListener('input', event => {
      searchTerm = normalizeText(event.target.value);
      renderArchive();
    });
  }

  function injectModal() {
    if (document.getElementById('historicalRepertoireModal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'historicalRepertoireModal';
    overlay.className = 'historical-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'historicalModalTitle');
    overlay.innerHTML = `
      <div class="historical-modal">
        <div class="historical-modal-head">
          <div>
            <div class="historical-repertoire-kicker">Memoria de repertorio</div>
            <div class="historical-modal-title" id="historicalModalTitle">Añadir obra histórica</div>
          </div>
          <button type="button" class="historical-modal-close" id="historicalModalClose" aria-label="Cerrar">×</button>
        </div>
        <div class="historical-modal-grid">
          <div class="historical-field full"><label for="historicalName">Obra</label><input id="historicalName" autocomplete="off" placeholder="Sonata, concierto, estudio…"></div>
          <div class="historical-field full"><label for="historicalComposer">Compositor</label><input id="historicalComposer" autocomplete="off" placeholder="Beethoven"></div>
          <div class="historical-field"><label for="historicalFromYear">Desde, aprox.</label><input id="historicalFromYear" type="number" min="1900" max="2100" inputmode="numeric" placeholder="2014"></div>
          <div class="historical-field"><label for="historicalToYear">Hasta, aprox.</label><input id="historicalToYear" type="number" min="1900" max="2100" inputmode="numeric" placeholder="2016"></div>
          <div class="historical-field"><label for="historicalLastPlayedYear">Última vez tocada, aprox.</label><input id="historicalLastPlayedYear" type="number" min="1900" max="2100" inputmode="numeric" placeholder="2020"></div>
          <div class="historical-field"><label for="historicalEstimatedHours">Horas históricas estimadas</label><input id="historicalEstimatedHours" type="number" min="0" step="0.5" inputmode="decimal" placeholder="80"></div>
          <div class="historical-field full"><label for="historicalPeakLevel">Nivel máximo alcanzado</label><select id="historicalPeakLevel"><option value="">No indicado</option><option value="lectura">Leída</option><option value="estudiada">Estudiada</option><option value="solida">Sólida</option><option value="publico">Interpretada en público</option><option value="concurso">Nivel concurso</option></select></div>
          <div class="historical-field full"><label for="historicalContext">Contexto</label><input id="historicalContext" autocomplete="off" placeholder="Clase, examen, concierto, concurso…"></div>
          <div class="historical-field full"><label for="historicalNotes">Notas</label><textarea id="historicalNotes" placeholder="Qué recuerdas de la obra, facilidad para recuperarla, profesor, programa…"></textarea></div>
        </div>
        <div class="historical-modal-note"><strong>Importante:</strong> las horas de este archivo son una estimación biográfica. Se guardan separadas y no se suman al tiempo estudiado, gráficas, rachas ni estadísticas.</div>
        <div class="historical-modal-actions"><button type="button" class="historical-modal-cancel" id="historicalModalCancel">Cancelar</button><button type="button" class="historical-modal-save" id="historicalModalSave">Guardar</button></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeEditor(); });
    document.getElementById('historicalModalClose').addEventListener('click', closeEditor);
    document.getElementById('historicalModalCancel').addEventListener('click', closeEditor);
    document.getElementById('historicalModalSave').addEventListener('click', saveHistoricalEntry);
  }

  function togglePanel() {
    const panel = document.getElementById('historicalRepertoirePanel');
    const toggle = document.getElementById('historicalRepertoireToggle');
    if (!panel) return;
    const opening = panel.hidden;
    panel.hidden = !opening;
    if (toggle) toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) renderArchive();
  }

  function openEditor(id) {
    ensureStore();
    editingId = id || null;
    const entry = editingId ? db[STORE_KEY].find(item => item.id === editingId) : null;
    document.getElementById('historicalModalTitle').textContent = entry ? 'Editar obra histórica' : 'Añadir obra histórica';
    document.getElementById('historicalName').value = entry?.name || '';
    document.getElementById('historicalComposer').value = entry?.composer || '';
    document.getElementById('historicalFromYear').value = entry?.fromYear || '';
    document.getElementById('historicalToYear').value = entry?.toYear || '';
    document.getElementById('historicalLastPlayedYear').value = entry?.lastPlayedYear || '';
    document.getElementById('historicalEstimatedHours').value = Number.isFinite(Number(entry?.estimatedHours)) ? entry.estimatedHours : '';
    document.getElementById('historicalPeakLevel').value = entry?.peakLevel || '';
    document.getElementById('historicalContext').value = entry?.context || '';
    document.getElementById('historicalNotes').value = entry?.notes || '';
    document.getElementById('historicalRepertoireModal').classList.add('open');
    setTimeout(() => document.getElementById('historicalName').focus(), 30);
  }

  function closeEditor() {
    editingId = null;
    document.getElementById('historicalRepertoireModal')?.classList.remove('open');
  }

  function saveHistoricalEntry() {
    const name = document.getElementById('historicalName').value.trim();
    const composer = document.getElementById('historicalComposer').value.trim();
    if (!name) { showToastSafe('Escribe el nombre de la obra'); document.getElementById('historicalName').focus(); return; }

    const fromYear = parseYear(document.getElementById('historicalFromYear').value);
    const toYear = parseYear(document.getElementById('historicalToYear').value);
    const lastPlayedYear = parseYear(document.getElementById('historicalLastPlayedYear').value);
    const estimatedHours = parseHours(document.getElementById('historicalEstimatedHours').value);
    const peakLevel = document.getElementById('historicalPeakLevel').value || '';
    const context = document.getElementById('historicalContext').value.trim();
    const notes = document.getElementById('historicalNotes').value.trim();
    const now = new Date().toISOString();
    const store = ensureStore();
    const wasEditing = !!editingId;

    if (editingId) {
      const index = store.findIndex(item => item.id === editingId);
      if (index >= 0) store[index] = Object.assign({}, store[index], { name, composer, fromYear, toYear, lastPlayedYear, estimatedHours, peakLevel, context, notes, updatedAt: now, estimateKind: 'approximate', includeInStats: false });
    } else {
      store.push({ id: 'hist_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7), name, composer, fromYear, toYear, lastPlayedYear, estimatedHours, peakLevel, context, notes, estimateKind: 'approximate', includeInStats: false, createdAt: now, updatedAt: now, reactivatedObraId: null, reactivatedAt: null });
    }

    saveData();
    closeEditor();
    renderArchive();
    showToastSafe(wasEditing ? 'Obra histórica actualizada ✓' : 'Obra histórica guardada ✓');
  }

  function activeMatch(entry) {
    const linked = entry.reactivatedObraId && (db.obras || []).find(obra => obra.id === entry.reactivatedObraId);
    if (linked) return linked;
    const name = normalizeText(entry.name);
    const composer = normalizeText(entry.composer);
    return (db.obras || []).find(obra => normalizeText(obra.name) === name && (!composer || normalizeText(obra.composer) === composer)) || null;
  }

  function reactivateEntry(id) {
    const store = ensureStore();
    const entry = store.find(item => item.id === id);
    if (!entry) return;
    let active = activeMatch(entry);
    if (!active) {
      active = { id: 'o' + Date.now(), name: entry.name, composer: entry.composer || '—', tipo: 'obra', origen: 'recuperacion', dificultad: 5, duracion: null, sol: 1, solHistory: [], pasajes: [], notes: '', minutosExtra: 0, historicalSourceId: entry.id };
      if (!Array.isArray(db.obras)) db.obras = [];
      db.obras.push(active);
    }
    entry.reactivatedObraId = active.id;
    entry.reactivatedAt = new Date().toISOString();
    entry.updatedAt = entry.reactivatedAt;
    saveData();
    if (typeof renderObras === 'function') renderObras();
    renderArchive();
    showToastSafe('Obra reactivada sin sumar horas históricas ✓');
  }

  function renderArchive() {
    if (!appReady()) return;
    const store = ensureStore();
    const count = document.getElementById('historicalRepertoireCount');
    const list = document.getElementById('historicalRepertoireList');
    const toggle = document.getElementById('historicalRepertoireToggle');
    if (!list) return;
    if (count) count.textContent = store.length ? `· ${store.length}` : '';
    if (toggle) toggle.textContent = store.length ? `Archivo ${store.length}` : 'Archivo';

    const filtered = store.filter(entry => !searchTerm || normalizeText(`${entry.name} ${entry.composer} ${entry.context} ${entry.notes}`).includes(searchTerm)).sort((a, b) => normalizeText(a.composer).localeCompare(normalizeText(b.composer)) || normalizeText(a.name).localeCompare(normalizeText(b.name)));
    if (!filtered.length) { list.innerHTML = `<div class="historical-empty">${store.length ? 'No hay coincidencias.' : 'Todavía no has añadido repertorio histórico.'}</div>`; return; }

    list.innerHTML = filtered.map(entry => {
      const active = activeMatch(entry);
      const context = entry.context ? `<div class="historical-card-detail"><strong>Contexto:</strong> ${escapeHtml(entry.context)}</div>` : '';
      const notes = entry.notes ? `<div class="historical-card-detail">${escapeHtml(entry.notes)}</div>` : '';
      const lastPlayed = entry.lastPlayedYear ? `<span class="historical-chip">Última vez ~${escapeHtml(entry.lastPlayedYear)}</span>` : '';
      return `<article class="historical-card" data-historical-id="${escapeHtml(entry.id)}"><div class="historical-card-top"><div><div class="historical-card-name">${escapeHtml(entry.name)}</div><div class="historical-card-composer">${escapeHtml(entry.composer || 'Compositor no indicado')}</div></div><span class="historical-badge ${active ? 'reactivated' : ''}">${active ? 'Reactivada' : 'Archivo'}</span></div><div class="historical-card-meta"><span class="historical-chip">${escapeHtml(periodLabel(entry))}</span><span class="historical-chip">${escapeHtml(levelLabel(entry.peakLevel))}</span><span class="historical-chip">${escapeHtml(hoursLabel(entry))}</span>${lastPlayed}</div>${context}${notes}<div class="historical-card-actions"><button type="button" class="historical-card-btn" data-action="edit" data-id="${escapeHtml(entry.id)}">Editar</button><button type="button" class="historical-card-btn primary" data-action="reactivate" data-id="${escapeHtml(entry.id)}" ${active ? 'disabled' : ''}>${active ? 'Ya activa' : 'Reactivar'}</button></div></article>`;
    }).join('');

    list.querySelectorAll('[data-action="edit"]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.id)));
    list.querySelectorAll('[data-action="reactivate"]').forEach(button => button.addEventListener('click', () => reactivateEntry(button.dataset.id)));
  }

  function init() {
    if (!appReady()) return false;
    injectStyles();
    injectPanel();
    injectModal();
    ensureStore();
    renderArchive();
    window.openHistoricalRepertoire = () => { const panel = document.getElementById('historicalRepertoirePanel'); if (panel) panel.hidden = false; document.getElementById('historicalRepertoireToggle')?.setAttribute('aria-expanded', 'true'); renderArchive(); };
    window.getHistoricalRepertoireForAI = () => ensureStore().map(entry => ({ name: entry.name, composer: entry.composer || '', periodApprox: periodLabel(entry), lastPlayedYearApprox: entry.lastPlayedYear || null, peakLevel: levelLabel(entry.peakLevel), context: entry.context || '', estimatedHistoricalHours: Number.isFinite(Number(entry.estimatedHours)) ? Number(entry.estimatedHours) : null, notes: entry.notes || '', reactivated: !!activeMatch(entry) }));
    return true;
  }

  function boot(attempt) { if (init()) return; if (attempt < 80) setTimeout(() => boot(attempt + 1), 100); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(0), { once: true }); else boot(0);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeEditor(); });
})();
