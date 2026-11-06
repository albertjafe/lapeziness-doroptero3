/* Diario (v523): una página de cuaderno por día. Lo estudiado aparece solo y
   en orden: los tramos seguidos de una misma obra (pausas de hasta 20 min) se
   juntan en un bloque, y los pases van aparte. Debajo de cada bloque se
   escribe lo que sea, sin botones: se guarda mientras escribes.
   - Cada comentario es una entrada de db.dailyJournalEntries (el diario de
     siempre) con `ref` (el bloque: id de su primer tramo) y `about` (obra y
     horas en texto), para que el paquete para IA lo lea junto a lo hecho.
     Las entradas sin `ref` son el diario general del día.
   - El día de la entrada es el del bloque, aunque se escriba otro día.
   - Borrar = dejar el texto vacío al salir. Si el bloque desaparece (tramo
     eliminado), el comentario no se pierde: queda como entrada del día.
   - Las notas tomadas con el cronómetro en marcha se ven (sin editar).
   En el escritorio (v526) es un libro a toda la pestaña: dos días a doble
   página, con hoy siempre a la derecha en la última, y la hoja gira al pasar.
   El giro es solo visual: la página real ya está debajo y se ve al terminar. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Diario = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const MERGE_GAP_MIN = 20;
  const MAX_TEXT = 4000;
  const doc = root.document || null;

  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseMs = value => {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };
  const clock = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function dateOf(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function shiftDay(key, offset) {
    const d = dateOf(key);
    d.setDate(d.getDate() + offset);
    return dayKey(d);
  }
  // Doble página que contiene `key`: se cuenta desde hoy de dos en dos, para que
  // la última tenga ayer a la izquierda y hoy a la derecha. Pura: la usan las pruebas.
  function spreadOf(key, today) {
    const utc = k => { const [y, m, d] = String(k).split('-').map(Number); return Date.UTC(y, m - 1, d); };
    const back = Math.max(0, Math.round((utc(today) - utc(key)) / 86400000));
    const right = shiftDay(today, -(back - (back % 2)));
    return { left: shiftDay(right, -1), right };
  }
  function duration(mins) {
    const m = Math.max(0, Math.round(Number(mins) || 0));
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + pad(m % 60) : '');
  }
  function entryDay(entry) {
    if (entry.day) return entry.day;
    const ms = parseMs(entry.at);
    return ms == null ? '' : dayKey(new Date(ms));
  }
  function blockKey(block) {
    if (block.id) return 'p:' + block.id;
    return 'p:' + (block.obraId || block.obraName || '') + '@' + (block.startedAt || block.date || '');
  }

  function studyBlocks(database, key, deps) {
    const start = dateOf(key), end = dateOf(shiftDay(key, 1));
    const source = (deps && deps.studyBlocks) || (root.DailyStudyMinutes && root.DailyStudyMinutes.studyBlocks);
    if (typeof source === 'function') return source(start, end, database) || [];
    // Sin el cálculo canónico (no debería pasar en la app): solo los tramos con hora.
    return (database.sessionPlants || []).filter(p => {
      const ms = parseMs(p && p.startedAt);
      return ms != null && !p.failed && ms >= start.getTime() && ms < end.getTime();
    }).map(p => ({ ...p, rawMins: Number(p.mins) || 0 }));
  }

  function workLabel(database, obraId, movIds, fallbackName) {
    const obra = (database.obras || []).find(o => o && o.id === obraId);
    const name = (obra && obra.name) || fallbackName || 'Estudio';
    const title = obra && obra.composer ? obra.composer + ' · ' + name : name;
    const movs = (movIds || []).map(id => {
      const mov = obra && (obra.movimientos || []).find(m => m && m.id === id);
      return mov && mov.name;
    }).filter(Boolean);
    return { title, movs: [...new Set(movs)].join(', ') };
  }

  function cronoNotes(block) {
    const out = (Array.isArray(block.notes) ? block.notes : [])
      .map(n => ({ text: String((n && (n.text || n.nota)) || '').trim(), label: (n && n.phaseLabel) || '' }))
      .filter(n => n.text);
    if (typeof block.note === 'string' && block.note.trim()) out.push({ text: block.note.trim(), label: 'nota' });
    return out;
  }

  // Bloques del día en orden, con sus comentarios. Puro: lo usan las pruebas.
  function day(database, key, deps) {
    const raw = studyBlocks(database || {}, key, deps)
      .filter(b => b && (Number(b.rawMins) > 0 || Number(b.mins) > 0))
      .map(b => {
        const startMs = parseMs(b.startedAt);
        const rawMins = Number(b.rawMins) || Number(b.mins) || 0;
        const endMs = parseMs(b.endedAt) ?? (startMs != null ? startMs + rawMins * 60000 : null);
        return { b, startMs, endMs, rawMins };
      })
      .sort((x, y) => (x.startMs ?? Infinity) - (y.startMs ?? Infinity));

    const items = [];
    raw.forEach(({ b, startMs, endMs, rawMins }) => {
      const isPase = !!b.pase;
      const last = items[items.length - 1];
      const joins = !isPase && last && last.kind === 'study' && last.obraId === (b.obraId || '') &&
        startMs != null && last.endMs != null && startMs - last.endMs <= MERGE_GAP_MIN * 60000;
      if (joins) {
        last.endMs = Math.max(last.endMs, endMs ?? startMs);
        last.rawMins += rawMins;
        if (b.movId) last.movIds.push(b.movId);
        last.cronoNotes.push(...cronoNotes(b));
        return;
      }
      items.push({
        key: blockKey(b),
        kind: isPase ? 'pase' : 'study',
        obraId: b.obraId || '',
        obraName: b.obraName || '',
        movIds: b.movId ? [b.movId] : [],
        startMs, endMs, rawMins,
        pct: isPase ? (b.pasePct ?? b.paseScore ?? null) : null,
        cronoNotes: cronoNotes(b),
      });
    });

    items.forEach(item => {
      const label = workLabel(database || {}, item.obraId, item.movIds, item.obraName);
      item.title = label.title;
      item.movs = label.movs;
      item.time = item.startMs != null ? clock(item.startMs) + (item.endMs != null ? '–' + clock(item.endMs) : '') : 'sin hora';
      item.duration = duration(item.rawMins);
      item.about = [item.kind === 'pase' ? 'Pase · ' + item.title : item.title, item.movs, item.time].filter(Boolean).join(' · ');
      item.entries = [];
    });

    const byKey = new Map(items.map(item => [item.key, item]));
    const general = [];
    (database && Array.isArray(database.dailyJournalEntries) ? database.dailyJournalEntries : [])
      .filter(e => e && e.id && entryDay(e) === key)
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
      .forEach(entry => {
        const item = entry.ref && byKey.get(entry.ref);
        if (item) item.entries.push(entry);
        else general.push(entry);
      });
    return { key, items, general };
  }

  // ---------- Escritura ----------
  function appDb() {
    try { if (typeof db !== 'undefined' && db) return db; } catch (error) {}
    return root.db || null;
  }
  function entries(database) {
    if (!Array.isArray(database.dailyJournalEntries)) database.dailyJournalEntries = [];
    return database.dailyJournalEntries;
  }
  function persistSoon() {
    if (typeof root.saveDataSoon === 'function') root.saveDataSoon();
    else if (typeof root.saveData === 'function') root.saveData();
  }

  // Crea, cambia o (con texto vacío y `final`) quita la entrada. Devuelve su id.
  function write(database, { id, key, ref, about, text, final }, now = new Date()) {
    const list = entries(database);
    const value = String(text || '').slice(0, MAX_TEXT);
    const index = id ? list.findIndex(e => e && e.id === id) : -1;
    if (!value.trim()) {
      if (final && index >= 0) list.splice(index, 1);
      return final ? '' : (index >= 0 ? id : '');
    }
    const stamp = now.toISOString();
    if (index >= 0) {
      const entry = list[index];
      if (entry.text === value) return entry.id;
      entry.text = value;
      entry.updatedAt = stamp;
      if (ref && about) entry.about = about;
      return entry.id;
    }
    const entry = {
      id: 'journal_' + now.getTime() + '_' + Math.random().toString(36).slice(2, 7),
      at: stamp,
      day: key,
      date: dateOf(key).toDateString(),
      text: value,
    };
    if (ref) { entry.ref = ref; entry.about = about || ''; }
    list.push(entry);
    if (list.length > 3000) list.splice(0, list.length - 3000);
    return entry.id;
  }

  // ---------- Vista ----------
  const TURN_MS = 760;
  const OPEN_MS = 950;
  let current = null;
  let turning = null;
  let opened = false;
  let lastBook = false;
  // Mismo umbral que la capa de escritorio de Windows (desktop-windows-v390.css).
  const bookMode = () => !!(doc && doc.documentElement.classList.contains('platform-windows') && root.matchMedia && root.matchMedia('(min-width: 1200px)').matches);
  const reducedMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = () => doc && doc.getElementById('view-diario');
  const visible = () => doc && doc.body && doc.body.getAttribute('data-view') === 'diario';
  const editing = () => { const a = doc && doc.activeElement; return !!(a && a.classList && a.classList.contains('dia-ink')); };

  function ink(attrs, text, placeholder) {
    return '<textarea class="dia-ink" rows="1" maxlength="' + MAX_TEXT + '" spellcheck="true"' +
      Object.entries(attrs).map(([k, v]) => v ? ' data-' + k + '="' + esc(v) + '"' : '').join('') +
      ' aria-label="' + esc(placeholder) + '" placeholder="' + esc(placeholder) + '">' + esc(text) + '</textarea>';
  }

  function itemHtml(item) {
    const notes = item.cronoNotes.map(n => '<p class="dia-crono">' + (n.label ? '<span>' + esc(n.label) + '</span> ' : '') + esc(n.text) + '</p>').join('');
    const inks = item.entries.length
      ? item.entries.map(e => ink({ id: e.id, ref: item.key }, e.text, 'Sobre ' + item.title)).join('')
      : ink({ ref: item.key }, '', 'Sobre ' + item.title);
    const pct = item.pct != null ? ' · ' + Math.round(item.pct) + ' %' : '';
    return '<article class="dia-item' + (item.kind === 'pase' ? ' is-pase' : '') + '" data-ref="' + esc(item.key) + '" data-about="' + esc(item.about) + '">' +
      '<div class="dia-meta"><span class="dia-time">' + esc(item.time) + '</span>' +
      '<span class="dia-title">' + (item.kind === 'pase' ? '<em>Pase</em> ' : '') + esc(item.title) + '</span>' +
      '<span class="dia-dur">' + esc(item.duration + pct) + '</span></div>' +
      (item.movs ? '<div class="dia-sub">' + esc(item.movs) + '</div>' : '') +
      notes + inks + '</article>';
  }

  function generalHtml(entry) {
    const ms = parseMs(entry.at);
    const head = entry.about ? entry.about : (ms != null ? clock(ms) : '');
    return '<div class="dia-free">' + (head ? '<div class="dia-free-head">' + esc(head) + '</div>' : '') +
      ink({ id: entry.id }, entry.text, 'Del día') + '</div>';
  }

  function dateLabel(key) {
    const d = dateOf(key), now = new Date();
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('es-ES', opts);
  }

  // Bloques y entradas del día por orden de hora; lo que no tiene hora, al final.
  function pageBody(database, key) {
    const data = day(database, key);
    const rows = [];
    data.items.forEach(item => rows.push({ ms: item.startMs ?? Infinity, html: itemHtml(item) }));
    data.general.forEach(entry => rows.push({ ms: parseMs(entry.at) ?? Infinity, html: generalHtml(entry) }));
    rows.sort((a, b) => a.ms - b.ms);
    return (rows.length ? rows.map(r => r.html).join('') : '<p class="dia-empty">Este día no hay estudio registrado.</p>') +
      '<div class="dia-free dia-new">' + ink({ free: '1' }, '', 'Escribe algo del día…') + '</div>';
  }

  function singlePage(database, today) {
    const isToday = current === today;
    return '<section class="dia-page" data-day="' + current + '">' +
      '<header class="dia-head">' +
        '<button type="button" class="dia-nav" data-act="prev" aria-label="Día anterior">‹</button>' +
        '<div class="dia-date"><small>' + (isToday ? 'Hoy' : '&nbsp;') + '</small><h2>' + esc(dateLabel(current)) + '</h2></div>' +
        '<button type="button" class="dia-nav" data-act="next" aria-label="Día siguiente"' + (current >= today ? ' disabled' : '') + '>›</button>' +
      '</header>' +
      (isToday ? '' : '<button type="button" class="dia-back" data-act="today">Volver a hoy</button>') +
      '<div class="dia-paper">' + pageBody(database, current) + '</div>' +
    '</section>';
  }

  function bookPage(database, key, side, today) {
    const tag = key === today ? 'Hoy' : key === shiftDay(today, -1) ? 'Ayer' : '&nbsp;';
    return '<article class="dia-page dia-book-page is-' + side + '" data-day="' + key + '">' +
      '<header class="dia-page-head"><small>' + tag + '</small><h2>' + esc(dateLabel(key)) + '</h2></header>' +
      '<div class="dia-sheet">' + pageBody(database, key) + '</div>' +
    '</article>';
  }

  function bookHtml(database, today) {
    const spread = spreadOf(current, today);
    current = spread.right;
    const last = current >= today;
    return '<section class="dia-book">' +
      '<div class="dia-side">' +
        '<button type="button" class="dia-turn" data-act="prev" aria-label="Páginas anteriores">‹</button>' +
      '</div>' +
      '<div class="dia-cover"><div class="dia-spread">' +
        bookPage(database, spread.left, 'left', today) +
        bookPage(database, spread.right, 'right', today) +
      '</div></div>' +
      '<div class="dia-side">' +
        '<button type="button" class="dia-turn" data-act="next" aria-label="Páginas siguientes"' + (last ? ' disabled' : '') + '>›</button>' +
        (last ? '' : '<button type="button" class="dia-back" data-act="today" aria-label="Volver a hoy">Hoy</button>') +
      '</div>' +
    '</section>';
  }

  function render() {
    const el = view(), database = appDb();
    if (!el || !database) return;
    finishTurn();
    const today = dayKey(new Date());
    if (!current) current = today;
    const scrolls = new Map([...el.querySelectorAll('.dia-sheet')].map(s => [s.parentElement.dataset.day, s.scrollTop]));
    lastBook = bookMode();
    el.innerHTML = lastBook ? bookHtml(database, today) : singlePage(database, today);
    sizeBook();
    el.querySelectorAll('.dia-ink').forEach(fit);
    el.querySelectorAll('.dia-sheet').forEach(s => { s.scrollTop = scrolls.get(s.parentElement.dataset.day) || 0; });
  }

  function fit(area) {
    area.style.height = 'auto';
    area.style.height = area.scrollHeight + 'px';
  }

  // El libro llena lo que queda de ventana bajo la cabecera, sin desplazar la página.
  function sizeBook() {
    const el = view();
    const book = el && el.querySelector('.dia-book');
    if (!book || !visible()) return;
    const top = book.getBoundingClientRect().top + (root.scrollY || 0);
    if (top > 0) book.style.height = Math.max(460, Math.floor(root.innerHeight - top - 16)) + 'px';
  }

  // ---------- Pasar la hoja ----------
  // Copia inerte de una página para dibujarla sobre la hoja que gira.
  function pageCopy(page) {
    const copy = page.cloneNode(true);
    copy.removeAttribute('data-day');
    const real = page.querySelectorAll('textarea');
    copy.querySelectorAll('textarea').forEach((area, i) => { area.value = real[i].value; area.tabIndex = -1; });
    const sheet = page.querySelector('.dia-sheet');
    return { copy, top: sheet ? sheet.scrollTop : 0 };
  }

  function slot(side, content) {
    const box = doc.createElement('div');
    box.className = 'dia-slot is-' + side;
    if (content) {
      box.appendChild(content.copy);
      box.dataset.top = content.top;
    }
    return box;
  }

  function face(name, content) {
    const box = doc.createElement('div');
    box.className = 'dia-face is-' + name;
    if (content && content.copy) {
      box.appendChild(content.copy);
      box.dataset.top = content.top;
    } else if (content) {
      box.appendChild(content);
    }
    return box;
  }

  function finishTurn() {
    if (!turning) return;
    clearTimeout(turning.timer);
    turning.layer.remove();
    turning = null;
  }

  function playLeaf(spread, under, leafSide, front, back, kind, ms) {
    const layer = doc.createElement('div');
    layer.className = 'dia-turning' + (kind ? ' is-' + kind : '');
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    const leaf = doc.createElement('div');
    leaf.className = 'dia-leaf is-' + leafSide;
    leaf.append(face('front', front), face('back', back));
    under.forEach(u => layer.appendChild(u));
    layer.appendChild(leaf);
    spread.appendChild(layer);
    layer.querySelectorAll('[data-top]').forEach(box => {
      const sheet = box.querySelector('.dia-sheet');
      if (sheet) sheet.scrollTop = Number(box.dataset.top) || 0;
    });
    turning = { layer, timer: setTimeout(finishTurn, ms + 60) };
    leaf.addEventListener('animationend', e => { if (e.target === leaf && !e.pseudoElement) finishTurn(); });
  }

  function turnTo(key) {
    const el = view();
    const today = dayKey(new Date());
    const target = spreadOf(key > today ? today : key, today).right;
    if (editing()) doc.activeElement.blur();
    finishTurn();
    if (target === current) return;
    const left = el.querySelector('.dia-spread > .is-left');
    const right = el.querySelector('.dia-spread > .is-right');
    const forward = target > current;
    if (reducedMotion() || !left || !right) {
      current = target;
      render();
      return;
    }
    const oldLeft = pageCopy(left), oldRight = pageCopy(right);
    current = target;
    render();
    const spread = el.querySelector('.dia-spread');
    const newPage = pageCopy(spread.querySelector(forward ? ':scope > .is-left' : ':scope > .is-right'));
    if (forward) playLeaf(spread, [slot('left', oldLeft)], 'right', oldRight, newPage, '', TURN_MS);
    else playLeaf(spread, [slot('right', oldRight)], 'left', oldLeft, newPage, '', TURN_MS);
  }

  // La primera vez que se entra, el libro se abre: gira la tapa.
  function playOpening() {
    if (opened) return;
    opened = true;
    const el = view();
    const spread = el && el.querySelector('.dia-spread');
    if (!spread || reducedMotion()) return;
    const cover = doc.createElement('div');
    cover.className = 'dia-cover-face';
    cover.innerHTML = '<span>Diario</span>';
    playLeaf(spread, [slot('left')], 'right', cover, pageCopy(spread.querySelector(':scope > .is-left')), 'opening', OPEN_MS);
  }

  function commit(area, final) {
    const database = appDb();
    if (!database) return;
    const item = area.closest('.dia-item');
    const page = area.closest('[data-day]');
    const id = write(database, {
      id: area.dataset.id || '',
      key: page ? page.dataset.day : current,
      ref: area.dataset.ref || '',
      about: item ? item.dataset.about : '',
      text: area.value,
      final,
    });
    const before = area.dataset.saved != null ? area.dataset.saved : area.defaultValue;
    const changed = (area.dataset.id || '') !== id || before !== area.value;
    if (id) area.dataset.id = id; else delete area.dataset.id;
    area.dataset.saved = area.value;
    if (changed) persistSoon();
  }

  function go(key) {
    if (bookMode()) { turnTo(key); return; }
    const today = dayKey(new Date());
    current = key > today ? today : key;
    render();
    root.scrollTo && root.scrollTo({ top: 0, behavior: 'auto' });
  }
  const step = direction => shiftDay(current, direction * (bookMode() ? 2 : 1));

  function init() {
    const el = view();
    if (!el || el.dataset.diaReady) return;
    el.dataset.diaReady = '1';
    el.addEventListener('click', e => {
      const button = e.target.closest('[data-act]');
      if (button) {
        const act = button.dataset.act;
        if (act === 'prev') go(step(-1));
        else if (act === 'next') go(step(1));
        else if (act === 'today') go(dayKey(new Date()));
        return;
      }
      if (e.target.closest('.dia-ink')) return;
      // Tocar el bloque (no solo la línea) lleva a escribir sobre él; en el libro,
      // tocar lo vacío de la hoja lleva a la línea libre de ese día.
      const scope = e.target.closest('.dia-item') || e.target.closest('.dia-sheet');
      if (!scope) return;
      const areas = scope.classList.contains('dia-sheet') ? scope.querySelectorAll('.dia-new .dia-ink') : scope.querySelectorAll('.dia-ink');
      const area = areas[areas.length - 1];
      if (area) { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }
    });
    el.addEventListener('input', e => {
      if (!e.target.classList.contains('dia-ink')) return;
      fit(e.target);
      commit(e.target, false);
    });
    el.addEventListener('focusout', e => {
      if (!e.target.classList.contains('dia-ink')) return;
      const area = e.target;
      commit(area, true);
      // La línea nueva del día, ya escrita, pasa a ser una entrada más.
      if (area.dataset.free && area.dataset.id) setTimeout(() => { if (!editing() && !turning) render(); }, 0);
    });
    el.addEventListener('keydown', e => {
      if (!e.target.classList.contains('dia-ink')) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.target.blur(); }
    });
    doc.addEventListener('keydown', e => {
      if (!visible() || editing() || e.altKey || e.metaKey || e.ctrlKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(step(-1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(step(1)); }
    });
    root.addEventListener('app:viewchange', e => {
      if (!e.detail || e.detail.name !== 'diario') return;
      render();
      if (lastBook) playOpening();
    });
    // Lo que llega de otro dispositivo se ve al volver, salvo si estás escribiendo.
    const refresh = () => { if (visible() && !editing() && !turning) render(); };
    root.addEventListener('focus', refresh);
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) refresh(); });
    root.addEventListener('storage', e => { if (e.key === 'alberto_piano_v2') refresh(); });
    root.addEventListener('resize', () => {
      const v = view();
      if (!v || !visible()) return;
      if (bookMode() !== lastBook && !editing()) { render(); return; }
      sizeBook();
      v.querySelectorAll('.dia-ink').forEach(fit);
    });
  }

  const api = { day, write, shiftDay, spreadOf, duration, MERGE_GAP_MIN, open: key => { if (key) current = key; if (typeof root.showView === 'function') root.showView('diario'); }, render };
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
  }
  return api;
});
