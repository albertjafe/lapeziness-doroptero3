/* Pasajes de la sesión (28-11-2026, v543).
   - Antes de plantar: bajo la obra salen sus pasajes (los del cronómetro y las
     secciones del diario) como botones. Se tocan uno o varios; «＋» crea uno
     nuevo con nombre (sección del diario). Viene marcado lo último elegido en
     esa obra o movimiento, aunque fuera en otro dispositivo (sale del diario).
     Sin tocar nada se planta igual que siempre.
   - Al terminar, en «Sesión completada», cada pasaje elegido tiene Mal ·
     Regular · Bien y una línea para escribir.
   - Al guardar se escribe una nota en el diario sobre ese bloque de estudio,
     con el pasaje como sección («[[Nombre]]»). En los pasajes del cronómetro
     la valoración también va a su curva (Mal 25 · Regular 55 · Bien 85). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SessionPassages = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const PICK_KEY = 'cronoPassagePick_v1';
  const RUN_KEY = 'cronoPassageRun_v1';
  const SOURCE = 'crono-passages';
  const RATINGS = [
    { id: 'mal', label: 'Mal', score: 25 },
    { id: 'regular', label: 'Regular', score: 55 },
    { id: 'bien', label: 'Bien', score: 85 },
  ];
  const doc = root.document || null;
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const clock = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const same = (a, b) => String(a ?? '') === String(b ?? '');
  const targetKey = t => t ? String(t.obraId) + '|' + String(t.movId || '') : '';

  // ---------- Puro (lo usan las pruebas) ----------
  function Sections() { return root.DiarioSections || null; }

  // Pasajes de la obra (con movimiento: solo los suyos; obra entera: todos).
  function choices(database, target) {
    const S = Sections();
    if (!S || !database || !target || !target.obraId) return [];
    return target.movId ? S.catalog(database, target.obraId, target.movId) : S.catalog(database, target.obraId);
  }

  // Última nota de pasajes de esa obra y movimiento, venga de donde venga.
  function lastEntry(database, target) {
    let best = null;
    for (const e of (database && Array.isArray(database.dailyJournalEntries) ? database.dailyJournalEntries : [])) {
      if (!e || e.source !== SOURCE || !same(e.obraId, target.obraId) || !same(e.movId || '', target.movId || '')) continue;
      if (!best || String(e.at || '') > String(best.at || '')) best = e;
    }
    return best;
  }

  // Lo marcado por defecto: lo que se tocó aquí, salvo que después haya una
  // nota más nueva (de otro dispositivo o de una sesión ya terminada).
  function defaultIds(database, target, stored) {
    const valid = new Set(choices(database, target).map(r => String(r.id)));
    const keep = ids => (Array.isArray(ids) ? ids : []).map(String).filter(id => valid.has(id));
    const entry = lastEntry(database, target);
    const entryAt = entry ? Date.parse(entry.at) || 0 : 0;
    if (stored && stored.key === targetKey(target) && (Number(stored.at) || 0) >= entryAt) return keep(stored.ids);
    return entry ? keep((entry.sectionRefs || []).map(r => r && r.id)) : [];
  }

  // Texto de la nota: una sección por pasaje, con «Bien: lo escrito».
  function noteText(rows) {
    const lines = [];
    for (const row of rows) {
      const S = Sections();
      const name = S ? S.clean(row.name) : String(row.name || '').trim();
      if (!name) continue;
      lines.push('[[' + name + ']]');
      const rating = RATINGS.find(r => r.id === row.rating);
      const note = String(row.note || '').replace(/\s+/g, ' ').trim();
      if (rating && note) lines.push(rating.label + ': ' + note);
      else if (rating) lines.push(rating.label);
      else if (note) lines.push(note);
    }
    return lines.join('\n');
  }

  // ---------- Estado local ----------
  function readJson(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJson(key, value) {
    try {
      if (value == null) root.localStorage.removeItem(key);
      else root.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }
  function appDb() {
    try { if (typeof db !== 'undefined' && db) return db; } catch (e) {}
    return root.db || null;
  }
  function cronoState() {
    try { return typeof crono !== 'undefined' ? crono : null; } catch (e) { return null; }
  }
  function persist() {
    try {
      if (typeof root.saveDataSoon === 'function') root.saveDataSoon();
      else if (typeof root.saveData === 'function') root.saveData();
    } catch (e) {}
  }
  function toast(text) { try { if (typeof root.showToast === 'function') root.showToast(text); } catch (e) {} }

  function findWork(database, obraId) {
    return (database && database.obras || []).find(o => o && same(o.id, obraId)) || null;
  }

  // Obra y movimiento elegidos ahora en el cronómetro (null si no tiene pasajes).
  function currentTarget() {
    const database = appDb();
    let t = null;
    try { t = root.PassageTracker && root.PassageTracker.currentTarget ? root.PassageTracker.currentTarget() : null; } catch (e) {}
    if (!t) {
      const value = String(doc && doc.getElementById('cronoObraSelect') ? doc.getElementById('cronoObraSelect').value : '');
      let m = /^mov::([^:]+)::([^:]+)$/.exec(value);
      if (m) t = { obraId: m[1], movId: m[2] };
      else if ((m = /^obra::([^:]+)$/.exec(value))) t = { obraId: m[1], movId: null };
      else if (value && findWork(database, value)) t = { obraId: value, movId: null };
    }
    if (!t || t.general || !t.obraId) return null;
    const work = findWork(database, t.obraId);
    if (!work || work.tipo === 'actividad') return null;
    const name = String(work.name || '').trim().toLowerCase();
    if (name === 'general') return null;
    return { obraId: String(t.obraId), movId: t.movId == null ? null : String(t.movId) };
  }

  let pickTarget = '';
  let picked = [];
  let adding = false;
  let lastSignature = '';

  function syncPick(target) {
    const key = targetKey(target);
    if (key === pickTarget) return;
    pickTarget = key;
    adding = false;
    picked = target ? defaultIds(appDb(), target, readJson(PICK_KEY)) : [];
  }

  function storePick(target) {
    writeJson(PICK_KEY, { key: targetKey(target), ids: picked.slice(), at: Date.now() });
  }

  // ---------- Botones antes de plantar ----------
  function ensureRow() {
    if (!doc) return null;
    let row = doc.getElementById('cronoPassagePick');
    if (row) return row;
    const head = doc.querySelector('#cronoStageIdle .crono-idle-head');
    if (!head || !head.parentElement) return null;
    row = doc.createElement('div');
    row.id = 'cronoPassagePick';
    row.className = 'sp-pick';
    row.hidden = true;
    row.setAttribute('aria-label', 'Pasajes de esta sesión');
    head.insertAdjacentElement('afterend', row);
    row.addEventListener('click', onRowClick);
    row.addEventListener('keydown', onRowKey);
    return row;
  }

  function renderRow(force) {
    const row = ensureRow();
    if (!row) return;
    const state = cronoState();
    const idle = !state || !state.state || state.state === 'idle';
    const target = idle ? currentTarget() : null;
    // En marcha no se toca la selección: es la de esta sesión.
    if (idle) syncPick(target);
    const list = target ? choices(appDb(), target) : [];
    const plan = idle ? Pase.idlePlan() : null;
    const signature = [idle, targetKey(target), adding, picked.join(','), list.map(r => r.id + ':' + r.name).join(','), JSON.stringify(plan)].join('#');
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    if (!idle) { row.hidden = true; row.replaceChildren(); return; }
    row.hidden = false;
    const pase = Pase.chipHtml(plan);
    if (!target) { row.innerHTML = '<div class="sp-chips">' + pase + '</div>'; return; }
    const showMov = !target.movId;
    const chips = list.map(r => {
      const on = picked.includes(String(r.id));
      return '<button type="button" class="sp-chip' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-sp-id="' + esc(r.id) + '">' +
        (on ? '✓ ' : '') + esc(r.name) + (showMov && r.movement ? ' <small>' + esc(r.movement) + '</small>' : '') + '</button>';
    }).join('');
    const add = adding
      ? '<span class="sp-new"><input type="text" class="sp-new-input" maxlength="80" placeholder="Nombre del pasaje" aria-label="Nombre del pasaje nuevo" enterkeyhint="done">' +
        '<button type="button" class="sp-new-ok" data-sp-act="save">OK</button></span>'
      : '<button type="button" class="sp-chip sp-add" data-sp-act="add" aria-label="Añadir un pasaje">＋ ' + (list.length ? 'Nuevo' : 'Pasaje') + '</button>';
    // Una sola línea: el botón «Iniciar» tiene que seguir a la vista en el iPhone.
    row.innerHTML = '<div class="sp-chips">' + pase + '<span class="sp-sep" aria-hidden="true"></span><span class="sp-label">Pasajes</span>' + chips + add + '</div>';
    if (adding) {
      const input = row.querySelector('.sp-new-input');
      if (input) setTimeout(() => input.focus(), 30);
    }
  }

  function saveNew() {
    const row = doc && doc.getElementById('cronoPassagePick');
    const input = row && row.querySelector('.sp-new-input');
    const name = input ? input.value : '';
    const target = currentTarget();
    const S = Sections();
    adding = false;
    if (!target || !S || !String(name).trim()) { renderRow(true); return; }
    const database = appDb();
    const created = S.register(database, target.obraId, name, new Date(), target.movId || null);
    if (!created) { toast('Ese nombre ya existe en otro movimiento'); renderRow(true); return; }
    if (!picked.includes(String(created.id))) picked.push(String(created.id));
    storePick(target);
    persist();
    renderRow(true);
  }

  function onRowClick(event) {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.spAct === 'pase') { Pase.openPlanner(); return; }
    const target = currentTarget();
    if (!target) return;
    if (btn.dataset.spAct === 'add') { adding = true; renderRow(true); return; }
    if (btn.dataset.spAct === 'save') { saveNew(); return; }
    const id = btn.dataset.spId;
    if (!id) return;
    picked = picked.includes(id) ? picked.filter(x => x !== id) : picked.concat(id);
    storePick(target);
    renderRow(true);
  }

  function onRowKey(event) {
    if (!event.target.classList || !event.target.classList.contains('sp-new-input')) return;
    if (event.key === 'Enter') { event.preventDefault(); saveNew(); }
    else if (event.key === 'Escape') { adding = false; renderRow(true); }
  }

  // ---------- Pase preparado antes de plantar (v543) ----------
  // «＋ Pase» abre el mismo selector del pase rápido para elegir obras,
  // movimientos y tipo. Al terminar el cronómetro se abre ese pase ya
  // relleno (obras, tipo y minutos repartidos): solo falta decir cómo salió.
  // Sus minutos se toman del cronómetro, así que no se cuentan dos veces.
  const PASE_KEY = 'cronoPasePlan_v1';
  const PASE_TIPOS = [['solo', 'Solo'], ['informal', 'Informal'], ['evento', 'Evento'], ['concurso', 'Concurso'], ['grabacion', 'Grabación']];
  const tipoLabel = t => (PASE_TIPOS.find(x => x[0] === t) || PASE_TIPOS[0])[1];

  // Reparte `total` minutos según la duración de cada obra (mínimo 1).
  function splitMinutes(weights, total) {
    const w = weights.map(x => Math.max(1, Number(x) || 1));
    if (!w.length) return [];
    if (total <= w.length) return w.map(() => 1);
    const sum = w.reduce((a, b) => a + b, 0);
    const out = w.map(x => Math.max(1, Math.floor(x / sum * total)));
    let rest = total - out.reduce((a, b) => a + b, 0);
    const order = w.map((x, i) => i).sort((a, b) => w[b] - w[a]);
    for (let k = 0; rest > 0; k = (k + 1) % order.length, rest -= 1) out[order[k]] += 1;
    for (let k = 0; rest < 0; k = (k + 1) % order.length) { if (out[order[k]] > 1) { out[order[k]] -= 1; rest += 1; } }
    return out;
  }

  const Pase = (() => {
    let planMode = false;
    let finishRun = null;
    const call = (name, ...args) => { const fn = root[name]; return typeof fn === 'function' ? fn(...args) : undefined; };
    function getDraft() { try { return cronoPaseDraft; } catch (e) { return null; } }
    function setDraft(v) { try { cronoPaseDraft = v; } catch (e) {} }
    function getTipo() { try { return cronoPaseTipoSelected || 'solo'; } catch (e) { return 'solo'; } }
    function setTipo(v) { try { cronoPaseTipoSelected = v; } catch (e) {} }
    function minMs() { try { return (typeof CRONO_MIN_MIN !== 'undefined' ? CRONO_MIN_MIN : 10) * 60000; } catch (e) { return 600000; } }
    function modalOpen() { const m = doc.getElementById('modalCronoPaseRapido'); return !!(m && m.classList.contains('visible')); }

    function read() {
      const p = readJson(PASE_KEY);
      return p && Array.isArray(p.items) && p.items.length ? p : null;
    }
    // Con el cronómetro parado: si la sesión del pase se descartó, el pase
    // sigue preparado para la siguiente.
    function idlePlan() {
      const p = read();
      if (p && p.runId) { p.runId = null; writeJson(PASE_KEY, p); }
      return p;
    }

    function chipHtml(plan) {
      if (!plan) return '<button type="button" class="sp-chip sp-pase" data-sp-act="pase" aria-label="Preparar un pase">＋ Pase</button>';
      return '<button type="button" class="sp-chip sp-pase is-on" data-sp-act="pase" aria-label="Cambiar el pase" title="' + esc(plan.items.map(i => i.name).join(', ')) + '">🎭 Pase' + (plan.items.length > 1 ? ' (' + plan.items.length + ')' : '') + ' · ' + esc(tipoLabel(plan.tipo)) + '</button>';
    }

    function draftFrom(items) {
      return items.map(i => {
        try { return call('cronoPaseDraftItem', call('studyRegisterResolveValue', i.value)); } catch (e) { return null; }
      }).filter(Boolean);
    }

    function ensureExtras() {
      let bar = doc.getElementById('spPasePlanBar');
      if (!bar) {
        const stage = doc.getElementById('cronoPaseSelectStage');
        if (stage) {
          bar = doc.createElement('div');
          bar.id = 'spPasePlanBar';
          bar.className = 'sp-pase-bar';
          bar.hidden = true;
          stage.insertBefore(bar, stage.firstChild);
          bar.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            if (b.dataset.tipo) { setTipo(b.dataset.tipo); renderBar(); }
            else if (b.dataset.act === 'clear') {
              writeJson(PASE_KEY, null);
              planMode = false;
              call('closeModal', 'modalCronoPaseRapido');
              renderRow(true);
              toast('Pase quitado');
            }
          });
        }
      }
      let skip = doc.getElementById('spPaseSkip');
      if (!skip) {
        const stage = doc.getElementById('cronoPaseDetailStage');
        if (stage) {
          skip = doc.createElement('button');
          skip.type = 'button';
          skip.id = 'spPaseSkip';
          skip.className = 'sp-pase-skip';
          skip.hidden = true;
          skip.textContent = 'Al final no hubo pase · guardar como estudio';
          const buttons = stage.querySelector('.modal-buttons');
          stage.insertBefore(skip, buttons || null);
          skip.addEventListener('click', () => {
            const run = finishRun;
            finishRun = null;
            writeJson(PASE_KEY, null);
            call('closeModal', 'modalCronoPaseRapido');
            const st = cronoState();
            if (run && st && same(st.runId, run)) root.cronoFinish(run);
            renderRow(true);
          });
        }
      }
      if (bar) bar.hidden = !planMode;
      if (skip) skip.hidden = !finishRun;
    }

    function renderBar() {
      ensureExtras();
      const bar = doc.getElementById('spPasePlanBar');
      if (!bar || !planMode) return;
      const t = getTipo();
      bar.innerHTML = '<div class="pase-tipo-label">Tipo de pase</div><div class="pase-tipo-row sp-pase-tipos">' +
        PASE_TIPOS.map(([id, label]) => '<button type="button" class="pase-tipo-btn ' + id + (t === id ? ' active' : '') + '" aria-pressed="' + (t === id) + '" data-tipo="' + id + '">' + label + '</button>').join('') +
        '</div>' + (read() ? '<button type="button" class="sp-pase-clear" data-act="clear">Quitar el pase</button>' : '');
    }

    function setTexts(title, sub) {
      const t = doc.getElementById('cronoPaseModalTitle');
      const s = doc.getElementById('cronoPaseModalSub');
      if (t) t.textContent = title;
      if (s) s.textContent = sub;
    }

    function openPlanner() {
      if (typeof root.openCronoPaseRapido !== 'function') return;
      root.openCronoPaseRapido();
      planMode = true;
      const plan = read();
      let draft = plan ? draftFrom(plan.items) : [];
      if (!plan) {
        const t = currentTarget();
        const work = t && findWork(appDb(), t.obraId);
        // Una obra con movimientos se elige por movimientos en el selector.
        if (t && (t.movId || !(work && (work.movimientos || []).length))) draft = draftFrom([{ value: t.movId ? 'mov::' + t.obraId + '::' + t.movId : 'obra::' + t.obraId }]);
      }
      setDraft(draft);
      setTipo(plan ? plan.tipo : 'solo');
      setTexts('¿Qué vas a pasar?', 'Toca las obras y movimientos del pase. Al terminar solo tendrás que decir cómo salió.');
      renderBar();
      call('cronoPaseRenderSelection');
    }

    function savePlan() {
      const seen = new Set();
      const items = [];
      (getDraft() || []).forEach(it => {
        const key = it.obraId + '::' + (it.movId || '');
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ value: it.movId ? 'mov::' + it.obraId + '::' + it.movId : 'obra::' + it.obraId, obraId: String(it.obraId), movId: it.movId ? String(it.movId) : null, name: it.name });
      });
      if (!items.length) { toast('Elige al menos una obra'); return; }
      writeJson(PASE_KEY, { items, tipo: getTipo(), runId: null, at: Date.now() });
      planMode = false;
      call('closeModal', 'modalCronoPaseRapido');
      // El cronómetro se pone en la primera obra del pase si lo elegido no está en él.
      const sel = doc.getElementById('cronoObraSelect');
      if (sel && !items.some(i => i.value === sel.value)) {
        const opt = Array.from(sel.options).find(o => items.some(i => i.value === o.value));
        if (opt) { sel.value = opt.value; call('cronoUpdateStartBtn'); }
      }
      renderRow(true);
    }

    function onStart() {
      const st = cronoState();
      const p = read();
      if (p && st && st.state === 'running' && st.runId && !st.isRest) { p.runId = String(st.runId); writeJson(PASE_KEY, p); }
    }

    function openFinish(plan, st) {
      root.openCronoPaseRapido();
      finishRun = String(st.runId);
      const draft = draftFrom(plan.items);
      const elapsed = Math.max(1, Math.floor((Number(call('cronoEffectiveElapsedMs')) || 0) / 60000));
      splitMinutes(draft.map(d => d.minutes), elapsed).forEach((m, i) => { draft[i].minutes = m; });
      setDraft(draft);
      const tipo = plan.tipo || 'solo';
      setTipo(tipo);
      doc.querySelectorAll('#cronoPaseDetailStage .pase-tipo-btn').forEach(b => b.classList.toggle('active', b.classList.contains(tipo)));
      call('paseSetTipoHint', 'cronoPaseTipoHint', tipo);
      call('cronoPaseAdvanceToDetails');
      setTexts('¿Cómo ha salido el pase?', 'Ya están las obras y el tipo. Ajusta el resultado de cada una y guarda.');
      ensureExtras();
    }

    function afterPase(run) {
      renderRow(true);
      const st = cronoState();
      if (!st || !same(st.runId, run) || st.state === 'idle') return;
      // Si además hubo estudio, se guarda como siempre; si fue solo el pase, se cierra.
      if ((Number(call('cronoEffectiveElapsedMs')) || 0) >= minMs()) { root.cronoFinish(run); return; }
      call('cronoStopTick');
      call('cronoStopPauseCountdown');
      writeJson(RUN_KEY, null);
      call('cronoReset', 'completed');
      call('cronoRender');
      call('refreshConcentradoUI');
      renderRow(true);
    }

    function install() {
      const open = root.openCronoPaseRapido;
      if (typeof open === 'function' && !open.__sessionPase) {
        const w = function () {
          planMode = false;
          finishRun = null;
          const r = open.apply(this, arguments);
          ensureExtras();
          return r;
        };
        w.__sessionPase = true;
        root.openCronoPaseRapido = w;
      }
      const render = root.cronoPaseRenderSelection;
      if (typeof render === 'function' && !render.__sessionPase) {
        const w = function () {
          const r = render.apply(this, arguments);
          if (planMode) {
            const btn = doc.getElementById('cronoPaseContinueBtn');
            const n = (getDraft() || []).length;
            if (btn) btn.textContent = n ? 'Listo (' + n + ')' : 'Listo';
          }
          return r;
        };
        w.__sessionPase = true;
        root.cronoPaseRenderSelection = w;
      }
      const advance = root.cronoPaseAdvanceToDetails;
      if (typeof advance === 'function' && !advance.__sessionPase) {
        const w = function () { if (planMode) { savePlan(); return undefined; } return advance.apply(this, arguments); };
        w.__sessionPase = true;
        root.cronoPaseAdvanceToDetails = w;
      }
      const confirm = root.confirmCronoPaseRapido;
      if (typeof confirm === 'function' && !confirm.__sessionPase) {
        const w = function () {
          const run = finishRun;
          const r = confirm.apply(this, arguments);
          const draft = getDraft();
          if (run && Array.isArray(draft) && !draft.length) {
            finishRun = null;
            writeJson(PASE_KEY, null);
            afterPase(run);
          }
          return r;
        };
        w.__sessionPase = true;
        root.confirmCronoPaseRapido = w;
      }
      const finish = root.cronoFinish;
      if (typeof finish === 'function' && !finish.__sessionPase) {
        const w = function (expectedRunId) {
          const st = cronoState();
          const p = read();
          if (p && p.runId && st && st.state !== 'idle' && !st.isRest && same(p.runId, st.runId) && (!expectedRunId || same(expectedRunId, st.runId))) {
            if (!(finishRun === String(st.runId) && modalOpen())) openFinish(p, st);
            return undefined;
          }
          return finish.apply(this, arguments);
        };
        w.__sessionPase = true;
        root.cronoFinish = w;
      }
    }

    return { idlePlan, chipHtml, openPlanner, onStart, install, read };
  })();

  // ---------- Al plantar y al terminar ----------
  function rememberRun() {
    const state = cronoState();
    if (!state || state.state !== 'running' || !state.runId) return;
    const target = currentTargetFromRun(state);
    if (!target || targetKey(target) !== pickTarget || !picked.length) { writeJson(RUN_KEY, null); return; }
    const S = Sections();
    const rows = choices(appDb(), target).filter(r => picked.includes(String(r.id)));
    if (!rows.length || !S) { writeJson(RUN_KEY, null); return; }
    writeJson(RUN_KEY, {
      runId: String(state.runId),
      obraId: target.obraId,
      movId: target.movId,
      passages: rows.map(r => ({ id: r.id, kind: r.kind, name: r.name, obraId: r.obraId, movId: r.movId || null })),
    });
  }

  function currentTargetFromRun(state) {
    if (state.obraId) return { obraId: String(state.obraId), movId: state.movId == null ? null : String(state.movId) };
    return currentTarget();
  }

  let hecho = null; // { run, plantId, startedAt, endedAt, rows: [{...passage, rating, note}] }

  function ensureHechoSection() {
    if (!doc) return null;
    let section = doc.getElementById('hechoSessionPassages');
    if (section) return section;
    const body = doc.querySelector('#modalHechoDatos .hecho-modal-body');
    if (!body) return null;
    section = doc.createElement('section');
    section.id = 'hechoSessionPassages';
    section.className = 'sp-hecho';
    section.hidden = true;
    const anchor = body.querySelector('.hecho-save-summary');
    if (anchor) anchor.insertAdjacentElement('afterend', section);
    else body.insertBefore(section, body.firstChild);
    section.addEventListener('click', event => {
      const btn = event.target.closest('button[data-sp-rate]');
      if (!btn || !hecho) return;
      const row = hecho.rows[Number(btn.dataset.spRow)];
      if (!row) return;
      row.rating = row.rating === btn.dataset.spRate ? null : btn.dataset.spRate;
      renderHecho();
    });
    section.addEventListener('input', event => {
      const input = event.target.closest('input[data-sp-note]');
      if (!input || !hecho) return;
      const row = hecho.rows[Number(input.dataset.spNote)];
      if (row) row.note = input.value;
    });
    return section;
  }

  function renderHecho() {
    const section = ensureHechoSection();
    if (!section) return;
    if (!hecho || !hecho.rows.length) { section.hidden = true; section.replaceChildren(); return; }
    section.hidden = false;
    section.innerHTML = '<div class="sp-hecho-label">¿Qué tal salió?</div>' + hecho.rows.map((row, i) =>
      '<div class="sp-hecho-row">' +
        '<strong class="sp-hecho-name">' + esc(row.name) + '</strong>' +
        '<div class="sp-rates" role="group" aria-label="' + esc('Cómo salió ' + row.name) + '">' +
          RATINGS.map(r => '<button type="button" class="sp-rate is-' + r.id + (row.rating === r.id ? ' is-on' : '') + '" aria-pressed="' + (row.rating === r.id) + '" data-sp-row="' + i + '" data-sp-rate="' + r.id + '">' + r.label + '</button>').join('') +
        '</div>' +
        '<input type="text" class="sp-note" data-sp-note="' + i + '" maxlength="300" placeholder="Algo que anotar (opcional)" value="' + esc(row.note || '') + '">' +
      '</div>').join('');
  }

  function openHecho(planId, opts) {
    hecho = null;
    const o = opts || {};
    if (o.subSession && !o.editMode) {
      const run = readJson(RUN_KEY);
      let pending = null;
      try { pending = typeof sessionAggregate !== 'undefined' && sessionAggregate[planId] ? sessionAggregate[planId]._pendingTimes : null; } catch (e) {}
      if (run && pending && pending.runId && same(run.runId, pending.runId) && Array.isArray(run.passages) && run.passages.length) {
        const database = appDb();
        const plant = (database && database.sessionPlants || []).find(p => p && same(p.runId, run.runId)) || null;
        hecho = {
          run,
          plantId: plant ? plant.id : null,
          startedAt: pending.startedAt || (plant && plant.startedAt) || null,
          endedAt: pending.endedAt || (plant && plant.endedAt) || null,
          rows: run.passages.map(p => ({ ...p, rating: null, note: '' })),
        };
      }
    }
    renderHecho();
  }

  function aboutFor(database, run, startMs, endMs) {
    const work = findWork(database, run.obraId);
    const title = work ? (work.composer ? work.composer + ' · ' : '') + (work.name || '') : 'Estudio';
    const mov = run.movId && work ? (work.movimientos || []).find(m => m && same(m.id, run.movId)) : null;
    const time = startMs ? clock(new Date(startMs)) + (endMs ? '–' + clock(new Date(endMs)) : '') : '';
    return [title, mov && mov.name, time].filter(Boolean).join(' · ');
  }

  // Escribe la nota en el diario y, en los pasajes del cronómetro, su medida.
  function saveHecho(database, data, now) {
    if (!data || !data.rows.length || !database) return null;
    const D = root.Diario;
    const S = Sections();
    if (!D || !S) return null;
    const stamp = (now || new Date());
    const startMs = Date.parse(data.startedAt || '') || stamp.getTime();
    const endMs = Date.parse(data.endedAt || '') || null;
    const text = noteText(data.rows);
    if (!text) return null;
    const refs = data.rows.map(r => ({ id: r.id, kind: r.kind, name: S.clean(r.name), obraId: r.obraId, ...(r.movId ? { movId: r.movId } : {}) }));
    const id = D.write(database, {
      key: dayKey(new Date(startMs)),
      ref: data.plantId ? 'p:' + data.plantId : undefined,
      about: aboutFor(database, data.run, startMs, endMs),
      text,
      obraId: data.run.obraId,
      movId: data.run.movId || undefined,
      sectionRefs: refs,
    }, stamp);
    const entry = (database.dailyJournalEntries || []).find(e => e && e.id === id);
    if (entry) {
      entry.source = SOURCE;
      entry.runId = data.run.runId;
      const ratings = {};
      data.rows.forEach(r => { if (r.rating) ratings[r.id] = r.rating; });
      if (Object.keys(ratings).length) entry.ratings = ratings;
    }
    const tracker = database.passageTracker;
    if (tracker && Array.isArray(tracker.passages)) {
      if (!Array.isArray(tracker.observations)) tracker.observations = [];
      data.rows.forEach(r => {
        const rating = RATINGS.find(x => x.id === r.rating);
        if (!rating || r.kind !== 'passage') return;
        const passage = tracker.passages.find(p => p && same(p.id, r.id) && !p.deletedAt);
        if (!passage) return;
        tracker.observations.push({
          id: 'passobs_' + stamp.getTime().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
          passageId: passage.id,
          obraId: passage.obraId,
          movId: passage.movId == null ? null : passage.movId,
          passageName: passage.name,
          difficulty: passage.difficulty == null ? null : Number(passage.difficulty),
          score: rating.score,
          recordedAt: stamp.toISOString(),
          sessionStartedAt: data.startedAt || null,
          runId: data.run.runId,
          source: 'session-passages-v1',
        });
        tracker.updatedAt = stamp.toISOString();
      });
    }
    return id;
  }

  function closeHecho(save) {
    const data = hecho;
    hecho = null;
    if (!data) return;
    writeJson(RUN_KEY, null);
    if (save !== true) return;
    const database = appDb();
    if (!saveHecho(database, data, new Date())) return;
    // Lo elegido queda como punto de partida de la próxima sesión.
    writeJson(PICK_KEY, null);
    pickTarget = '';
    lastSignature = '';
    persist();
  }

  // ---------- Enganche ----------
  function wrap(name, after, before) {
    const original = root[name];
    if (typeof original !== 'function' || original.__sessionPassages) return;
    const wrapped = function (...args) {
      if (before) { try { before.apply(this, args); } catch (e) {} }
      const result = original.apply(this, args);
      const done = value => { if (after) { try { after.apply(this, args); } catch (e) {} } return value; };
      if (result && typeof result.then === 'function') return result.then(done);
      return done(result);
    };
    wrapped.__sessionPassages = true;
    root[name] = wrapped;
  }

  function init() {
    if (!doc) return;
    wrap('cronoStart', () => { rememberRun(); Pase.onStart(); });
    Pase.install();
    wrap('openHechoDatos', (planId, minPlan, opts) => openHecho(planId, opts));
    // Antes del original: la ventana se cierra y su estado se limpia dentro.
    wrap('closeHechoDatos', null, save => closeHecho(save));
    renderRow(true);
    root.addEventListener('app:viewchange', e => { if (e.detail && e.detail.name === 'cronometro') renderRow(false); });
    setInterval(() => {
      const view = doc.getElementById('view-cronometro');
      if (!view || view.offsetParent === null) return;
      renderRow(false);
    }, 700);
  }

  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { RATINGS, SOURCE, PICK_KEY, RUN_KEY, PASE_KEY, splitMinutes, pasePlan: () => Pase.read(), openPasePlanner: () => Pase.openPlanner(), choices, lastEntry, defaultIds, noteText, saveHecho, render: () => renderRow(true), picked: () => picked.slice() };
});
