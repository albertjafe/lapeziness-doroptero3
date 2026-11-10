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
   El giro es solo visual: la página real ya está debajo y se ve al terminar.
   Formato (v528): lo escrito se ve con formato mientras no lo editas.
   «- algo» es una tarea de hoy, numerada y con casilla; «+ algo», una para
   otro día (otra casilla). Hecha = «[x]» tras el signo, en el propio texto.
   En «Etiqueta: resto», el resto va en letra pequeña (no en horas, 9:52).
   Intro en una línea de lista sigue la lista; en una vacía, la termina.
   Pantalla completa (v529): un botón deja solo el diario, sin menú ni
   cabecera, con la página más grande y la letra del cuaderno algo menor.
   Si el navegador lo permite, también pasa a pantalla completa de verdad;
   salir de ella (Esc) deja el diario a toda la ventana, y el botón «Salir»
   o Esc sin estar escribiendo lo cierran. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Diario = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const MERGE_GAP_MIN = 20;
  const MAX_TEXT = 4000;
  const Sections = root.DiarioSections || null;
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
  // ---------- Formato del texto (v528) ----------
  const ITEM_RE = /^\s*([-+])(?=\s|$)\s*(?:\[([ xX])\]\s*)?(.*)$/;
  function parseLine(line) {
    const m = ITEM_RE.exec(String(line));
    if (!m) return { kind: 'text', text: String(line) };
    return { kind: m[1] === '-' ? 'today' : 'later', done: /x/i.test(m[2] || ''), text: m[3] };
  }
  // «Etiqueta: resto» → [etiqueta con los dos puntos, resto]. No parte horas
  // (9:52) ni enlaces (https://), y la etiqueta es corta.
  function splitAside(text) {
    const s = String(text);
    for (let i = 1; i < s.length && i <= 40; i++) {
      if (s[i] !== ':') continue;
      if (/\d/.test(s[i - 1]) || s[i + 1] !== ' ') return null;
      const rest = s.slice(i + 1).trim();
      return rest ? [s.slice(0, i + 1), rest] : null;
    }
    return null;
  }
  function inlineHtml(text) {
    const parts = splitAside(text);
    return parts ? esc(parts[0]) + ' <small class="dia-aside">' + esc(parts[1]) + '</small>' : esc(text);
  }
  // Una línea por <div>, con la misma altura que las líneas del cuaderno.
  function formatHtml(text) {
    let n = 0;
    return String(text || '').split('\n').map((line, i) => {
      const it = parseLine(line);
      if (it.kind === 'text') {
        n = 0;
        const section = /^\s*\[\[([^\]\n]+)\]\]\s*$/.exec(it.text);
        if (section) return '<div class="dia-section-heading">' + esc(section[1]) + '</div>';
        if (/^\s*[^:\n]{1,60}:\s*$/.test(it.text)) return '<div class="dia-note-heading">' + esc(it.text.trim()) + '</div>';
        return '<div class="dia-l">' + (it.text.trim() ? inlineHtml(it.text) : '&nbsp;') + '</div>';
      }
      const today = it.kind === 'today';
      if (today) n += 1;
      const label = (today ? 'Tarea de hoy' : 'Para otro día') + (it.done ? ', hecha' : '');
      return '<div class="dia-l dia-li is-' + it.kind + (it.done ? ' is-done' : '') + '">' +
        '<button type="button" class="dia-box" role="checkbox" aria-checked="' + it.done + '" aria-label="' + label + '" data-line="' + i + '"></button>' +
        (today ? '<span class="dia-num">' + n + '.</span>' : '') +
        '<span class="dia-txt">' + (it.text.trim() ? inlineHtml(it.text) : '&nbsp;') + '</span></div>';
    }).join('');
  }
  // Marca o desmarca la línea `index` si es de lista. Pura: la usan las pruebas.
  function toggleLine(text, index) {
    const lines = String(text || '').split('\n');
    const m = ITEM_RE.exec(lines[index] || '');
    if (!m) return String(text || '');
    const lead = /^\s*/.exec(lines[index])[0];
    lines[index] = lead + m[1] + (/x/i.test(m[2] || '') ? ' ' : ' [x] ') + m[3];
    return lines.join('\n');
  }
  // Intro dentro de una lista: el texto y la posición del cursor resultantes, o
  // null si la línea no es de lista (Intro normal).
  function continueList(text, caret) {
    const value = String(text || '');
    const start = value.lastIndexOf('\n', caret - 1) + 1;
    const line = value.slice(start, caret);
    const m = ITEM_RE.exec(line);
    if (!m) return null;
    if (!m[3].trim()) {
      const next = value.slice(0, start) + value.slice(caret);
      return { value: next, caret: start };
    }
    const prefix = /^\s*/.exec(line)[0] + m[1] + ' ';
    const next = value.slice(0, caret) + '\n' + prefix + value.slice(caret);
    return { value: next, caret: caret + 1 + prefix.length };
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
  function write(database, { id, key, ref, about, text, final, obraId, sectionRefs }, now = new Date()) {
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
      const refsChanged = sectionRefs && JSON.stringify(entry.sectionRefs || []) !== JSON.stringify(sectionRefs);
      if (entry.text === value && !refsChanged) return entry.id;
      entry.text = value;
      entry.updatedAt = stamp;
      if (obraId) entry.obraId = obraId;
      if (sectionRefs) entry.sectionRefs = sectionRefs;
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
    if (obraId) entry.obraId = obraId;
    if (sectionRefs && sectionRefs.length) entry.sectionRefs = sectionRefs;
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
  let focusMode = false;
  // Mismo umbral que la capa de escritorio de Windows (desktop-windows-v390.css).
  const bookMode = () => !!(doc && doc.documentElement.classList.contains('platform-windows') && root.matchMedia && root.matchMedia('(min-width: 1200px)').matches);
  const reducedMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = () => doc && doc.getElementById('view-diario');
  const visible = () => doc && doc.body && doc.body.getAttribute('data-view') === 'diario';
  const editing = () => { const a = doc && doc.activeElement; return !!(a && a.classList && a.classList.contains('dia-ink')); };

  // El texto con formato se ve mientras no se edita; tocarlo abre el campo.
  function ink(attrs, text, placeholder) {
    const has = !!String(text || '').trim();
    return '<div class="dia-ink-wrap' + (has ? ' is-fmt' : '') + '">' +
      '<textarea class="dia-ink" rows="1" maxlength="' + MAX_TEXT + '" spellcheck="true"' +
      Object.entries(attrs).map(([k, v]) => v ? ' data-' + k + '="' + esc(v) + '"' : '').join('') +
      ' aria-label="' + esc(placeholder) + '" placeholder="' + esc(placeholder) + '">' + esc(text) + '</textarea>' +
      (has ? '<div class="dia-fmt" tabindex="0" aria-label="' + esc(placeholder) + ' (toca para editar)">' + formatHtml(text) + '</div>' : '') +
      '</div>';
  }
  // Pasa de la vista con formato al campo, con el cursor al final.
  function edit(area) {
    if (!area) return;
    const wrap = area.parentElement;
    if (wrap && wrap.classList.contains('is-fmt')) wrap.classList.remove('is-fmt');
    fitStyles.delete(area);
    fit(area);
    area.focus();
    try { area.setSelectionRange(area.value.length, area.value.length); } catch (e) {}
  }
  // Al salir del campo vuelve el formato (si hay texto).
  function showFormatted(area) {
    const wrap = area && area.parentElement;
    if (!wrap || !wrap.classList.contains('dia-ink-wrap')) return;
    const text = area.value;
    let fmt = wrap.querySelector('.dia-fmt');
    if (!text.trim()) { if (fmt) fmt.remove(); wrap.classList.remove('is-fmt'); return; }
    if (!fmt) {
      fmt = doc.createElement('div');
      fmt.className = 'dia-fmt';
      fmt.tabIndex = 0;
      fmt.setAttribute('aria-label', (area.getAttribute('aria-label') || 'Texto') + ' (toca para editar)');
      wrap.appendChild(fmt);
    }
    fmt.innerHTML = formatHtml(text);
    wrap.classList.add('is-fmt');
  }

  function compactTitle(title) {
    const parts = String(title || '').split(' · ');
    const piece = (parts.length > 1 ? parts.slice(1).join(' · ') : parts[0]).split(',')[0].replace(/\s*\([^)]*\)/g, '').trim();
    const composer = parts.length > 1 ? parts[0].trim().split(/\s+/).at(-1) : '';
    return [composer, piece].filter(Boolean).join(' · ');
  }
  function itemHtml(item) {
    const notes = item.cronoNotes.map(n => '<p class="dia-crono"' + (n.label ? ' title="' + esc(n.label) + '"' : '') + '>' + esc(n.text) + '</p>').join('');
    const inks = item.entries.length
      ? item.entries.map(e => ink({ id: e.id, ref: item.key, sections: JSON.stringify(e.sectionRefs || []) }, e.text, 'Sobre ' + item.title)).join('')
      : ink({ ref: item.key }, '', 'Sobre ' + item.title);
    const pct = item.pct != null ? ' · ' + Math.round(item.pct) + ' %' : '';
    return '<article class="dia-item' + (item.kind === 'pase' ? ' is-pase' : '') + '" data-ref="' + esc(item.key) + '" data-work="' + esc(item.obraId) + '" data-about="' + esc(item.about) + '">' +
      '<div class="dia-meta">' +
      '<span class="dia-title" title="' + esc(item.title) + '">' + (item.kind === 'pase' ? '<em>Pase</em> ' : '') + esc(compactTitle(item.title)) + '</span>' +
      '<span class="dia-dur">' + esc(item.duration + pct) + '</span></div>' +
      '<details class="dia-study-details"><summary aria-label="Detalle del estudio" title="Detalle del estudio"><span aria-hidden="true">···</span></summary><div>' + esc(item.title) +
      (item.movs ? ' · ' + esc(item.movs) : '') + '<br><span class="dia-time">' + esc(item.time || 'Sin hora') + '</span>' +
      (item.cronoNotes.some(n => n.label) ? '<br>' + item.cronoNotes.filter(n => n.label).map(n => esc(n.label) + ': ' + esc(n.text)).join('<br>') : '') + '</div></details>' +
      notes + inks +
      (item.obraId && Sections ? '<button type="button" class="dia-section-add" data-act="section" aria-label="Insertar sección de ' + esc(item.title) + '">+ Sección</button>' : '') +
      '</article>';
  }

  function generalHtml(entry) {
    const ms = parseMs(entry.at);
    const head = entry.about || '';
    return '<div class="dia-free"' + (ms != null ? ' aria-label="Nota de las ' + esc(clock(ms)) + '"' : '') + '>' + (head ? '<div class="dia-free-head">' + esc(head) + '</div>' : '') +
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
    return rows.map(r => r.html).join('') +
      '<div class="dia-free dia-new">' + ink({ free: '1' }, '', 'Escribe algo del día…') + '</div>';
  }

  // Pantalla completa: abrir (cuatro esquinas hacia fuera) o salir (hacia dentro).
  function focusButton(withText) {
    const path = focusMode ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5';
    const label = focusMode ? 'Salir de pantalla completa' : 'Pantalla completa';
    return '<button type="button" class="dia-full" data-act="focus" aria-pressed="' + focusMode + '" aria-label="' + label + '" title="' + label + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>' +
      (withText ? '<span>' + (focusMode ? 'Salir' : 'Pantalla completa') + '</span>' : '') + '</button>';
  }

  function singlePage(database, today) {
    const isToday = current === today;
    return '<section class="dia-page" data-day="' + current + '">' +
      '<header class="dia-head">' +
        '<button type="button" class="dia-nav" data-act="prev" aria-label="Día anterior">‹</button>' +
        '<div class="dia-date"><small>' + (isToday ? 'Hoy' : '&nbsp;') + '</small><h2>' + esc(dateLabel(current)) + '</h2></div>' +
        '<button type="button" class="dia-nav" data-act="next" aria-label="Día siguiente"' + (current >= today ? ' disabled' : '') + '>›</button>' +
      '</header>' +
      '<div class="dia-tools">' +
        (isToday ? '' : '<button type="button" class="dia-back" data-act="today">Volver a hoy</button>') +
        focusButton(true) +
      '</div>' +
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
        focusButton(false) +
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
    closeSectionPicker();
    const today = dayKey(new Date());
    if (!current) current = today;
    const scrolls = new Map([...el.querySelectorAll('.dia-sheet')].map(s => [s.parentElement.dataset.day, s.scrollTop]));
    lastBook = bookMode();
    el.innerHTML = lastBook ? bookHtml(database, today) : singlePage(database, today);
    sizeBook();
    el.querySelectorAll('.dia-ink').forEach(fit);
    el.querySelectorAll('.dia-sheet').forEach(s => { s.scrollTop = scrolls.get(s.parentElement.dataset.day) || 0; });
  }

  // Measure outside document flow: collapsing the live textarea to auto on
  // each key clamps page scroll near its bottom (especially with the iPad keyboard).
  let sizeProbe = null;
  let fitStyles = new WeakMap();
  const pendingFits = new Set();
  let fitFrame = null;
  function fit(area) {
    if (!area.isConnected || !area.getClientRects().length) return;
    let config = fitStyles.get(area);
    if (!config) {
      const cs = root.getComputedStyle(area);
      const properties = ['font-family','font-size','font-weight','font-style','line-height',
        'letter-spacing','word-spacing','text-indent','text-transform','tab-size',
        'padding-top','padding-bottom','padding-left','padding-right','overflow-wrap','word-break'];
      config = 'position:fixed!important;left:-10000px!important;top:0!important;' +
        'height:0!important;min-height:0!important;max-height:none!important;' +
        'border:0!important;box-sizing:border-box!important;visibility:hidden!important;' +
        'overflow:hidden!important;contain:strict!important;pointer-events:none!important;' +
        'width:' + area.getBoundingClientRect().width + 'px!important;' +
        properties.map(p => p + ':' + cs.getPropertyValue(p) + '!important;').join('');
      fitStyles.set(area, config);
    }
    if (!sizeProbe) {
      sizeProbe = doc.createElement('textarea');
      sizeProbe.className = 'dia-size-probe';
      sizeProbe.tabIndex = -1;
      sizeProbe.setAttribute('aria-hidden', 'true');
      sizeProbe.setAttribute('inert', '');
      doc.body.appendChild(sizeProbe);
    }
    if (sizeProbe.dataset.config !== config) {
      sizeProbe.style.cssText = config;
      sizeProbe.dataset.config = config;
    }
    sizeProbe.wrap = area.wrap;
    sizeProbe.value = area.value || ' ';
    const height = sizeProbe.scrollHeight + 'px';
    if (area.style.height !== height) area.style.height = height;
  }
  function scheduleFit(area) {
    pendingFits.add(area);
    if (fitFrame !== null) return;
    fitFrame = root.requestAnimationFrame(() => {
      fitFrame = null;
      pendingFits.forEach(fit);
      pendingFits.clear();
    });
  }

  // El libro llena lo que queda de ventana bajo la cabecera, sin desplazar la página.
  function sizeBook() {
    const el = view();
    const book = el && el.querySelector('.dia-book');
    if (!book || !visible()) return;
    // A pantalla completa el diario va fijo sobre todo: no cuenta el desplazamiento de la página.
    const top = book.getBoundingClientRect().top + (focusMode ? 0 : (root.scrollY || 0));
    if (top > 0) book.style.height = Math.max(460, Math.floor(root.innerHeight - top - (focusMode ? 12 : 16))) + 'px';
  }

  // ---------- Pantalla completa ----------
  function setFocus(on) {
    on = !!on;
    if (on === focusMode) return;
    if (editing()) doc.activeElement.blur();
    focusMode = on;
    doc.documentElement.classList.toggle('dia-focus', on);
    const el = doc.documentElement;
    try {
      if (on && !doc.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      else if (!on && doc.fullscreenElement && doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
    } catch (err) {}
    render();
    const v = view();
    if (v) v.scrollTop = 0;
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
    // Termina con la animación, no con un reloj: tras pintar el día nuevo el
    // giro puede empezar unos cientos de ms tarde, y un reloj fijo quitaba la
    // hoja a medio caer (el salto al final). El reloj solo es un seguro por si
    // la animación no llega a correr (pestaña oculta, vista cambiada).
    const state = { layer, timer: setTimeout(finishTurn, ms * 4) };
    turning = state;
    leaf.addEventListener('animationstart', e => {
      if (e.target !== leaf || e.pseudoElement || turning !== state) return;
      clearTimeout(state.timer);
      state.timer = setTimeout(finishTurn, ms * 4);
    });
    leaf.addEventListener('animationend', e => { if (e.target === leaf && !e.pseudoElement && turning === state) finishTurn(); });
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
    const refs = sectionReferences(area, database, item, final);
    const previous = (database.dailyJournalEntries || []).find(e => e.id === area.dataset.id);
    const refsChanged = refs && JSON.stringify(previous?.sectionRefs || []) !== JSON.stringify(refs);
    const id = write(database, {
      id: area.dataset.id || '',
      key: page ? page.dataset.day : current,
      ref: area.dataset.ref || '',
      about: item ? item.dataset.about : '',
      text: area.value,
      obraId: item?.dataset.work || '',
      sectionRefs: refs,
      final,
    });
    const before = area.dataset.saved != null ? area.dataset.saved : area.defaultValue;
    const changed = (area.dataset.id || '') !== id || before !== area.value || refsChanged;
    if (id) area.dataset.id = id; else delete area.dataset.id;
    area.dataset.saved = area.value;
    if (changed) persistSoon();
  }

  // One picker, owned by the textarea and work that opened it.
  let sectionPicker = null;
  let pickerSerial = 0;
  const referenceCache = new WeakMap();
  function sectionReferences(area, database, item, final) {
    if (!Sections || !item?.dataset.work) return undefined;
    const work = item.dataset.work;
    const headings = JSON.stringify(area.value.match(/^\s*\[\[([^\]\n]+)\]\]\s*$/gm) || []);
    const selected = area.dataset.sections || '[]';
    const cached = referenceCache.get(area);
    if (!final && cached && cached.work === work && cached.headings === headings && cached.selected === selected) return cached.refs;
    let previous = [];
    try { previous = JSON.parse(selected); } catch (e) {}
    const refs = headings === '[]' ? [] : Sections.references(area.value, Sections.catalog(database, work), previous);
    referenceCache.set(area, { work, headings, selected, refs });
    return refs;
  }
  function closeSectionPicker() {
    if (!sectionPicker) return;
    const { area, menu } = sectionPicker;
    menu.remove();
    area.removeAttribute('aria-controls');
    area.removeAttribute('aria-activedescendant');
    area.removeAttribute('aria-autocomplete');
    area.removeAttribute('aria-expanded');
    sectionPicker = null;
  }
  function highlightSection(index) {
    if (!sectionPicker) return;
    const buttons = [...sectionPicker.menu.querySelectorAll('.dia-section-choice')];
    sectionPicker.index = (index + buttons.length) % buttons.length;
    buttons.forEach((b,i) => b.setAttribute('aria-selected', String(i === sectionPicker.index)));
    const current = buttons[sectionPicker.index];
    if (current) sectionPicker.area.setAttribute('aria-activedescendant', current.id);
  }
  function offerSections(area) {
    closeSectionPicker();
    const work = area.closest('.dia-item')?.dataset.work;
    if (!Sections || !work || area.selectionStart !== area.selectionEnd) return;
    const range = Sections.queryAt(area.value, area.selectionStart);
    if (!range) return;
    const database = appDb(), catalog = Sections.catalog(database, work);
    const query = Sections.key(range.query);
    const rows = catalog.filter(x => !query || Sections.key(x.name).includes(query)).slice(0, 12);
    const name = Sections.clean(range.query);
    const exact = catalog.some(x => Sections.key(x.name) === Sections.key(name));
    const options = rows.map(row => ({ row, label: row.name, detail: row.movement }));
    if (name && !exact) options.push({ create: true, label: 'Crear «' + name + '»', detail: 'En esta obra' });
    const menu = doc.createElement('div');
    menu.className = 'dia-section-picker';
    menu.id = 'dia-section-picker-' + (++pickerSerial);
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Secciones de esta obra');
    menu.innerHTML = options.length ? options.map((o,i) => '<button type="button" role="option" aria-selected="false" id="' + menu.id + '-' + i + '" class="dia-section-choice" data-choice="' + i + '"><span>' + esc(o.label) + '</span>' + (o.detail ? '<small>' + esc(o.detail) + '</small>' : '') + '</button>').join('') : '<p>Escribe un nombre para crear una sección de esta obra.</p>';
    area.parentElement.appendChild(menu);
    area.setAttribute('aria-controls', menu.id);
    area.setAttribute('aria-autocomplete', 'list');
    area.setAttribute('aria-expanded', 'true');
    sectionPicker = { area, menu, range, work, options, index: 0 };
    if (options.length) highlightSection(0);
  }
  function chooseSection(index) {
    const picker = sectionPicker;
    if (!picker || !picker.options[index]) return false;
    const { area, work, range } = picker, database = appDb(), choice = picker.options[index];
    if (!area.isConnected || area.closest('.dia-item')?.dataset.work !== work) { closeSectionPicker(); return false; }
    const proposed = choice.create ? { name: Sections.clean(range.query) } : choice.row;
    const next = Sections.insert(area.value, range, proposed);
    if (next.value.length > MAX_TEXT) return false;
    const row = choice.create ? Sections.register(database, work, range.query) : choice.row;
    if (!row) return false;
    let refs = [];
    try { refs = JSON.parse(area.dataset.sections || '[]'); } catch(e) {}
    area.dataset.sections = JSON.stringify([...refs.filter(x => Sections.key(x.name) !== Sections.key(row.name)), row]);
    closeSectionPicker();
    area.value = next.value;
    edit(area);
    area.setSelectionRange(next.caret, next.caret);
    fit(area);
    commit(area, false);
    return true;
  }
  function beginSection(item) {
    const area = [...item.querySelectorAll('.dia-ink')].at(-1);
    if (!area) return;
    edit(area);
    const prefix = area.value && !area.value.endsWith('\n') ? '\n' : '';
    if (area.value.length + prefix.length + 1 > MAX_TEXT) return;
    area.value += prefix + '@';
    area.setSelectionRange(area.value.length, area.value.length);
    fit(area);
    offerSections(area);
  }
  function sectionKey(e) {
    if (!sectionPicker || sectionPicker.area !== e.target) return false;
    if (e.key === 'Escape') { e.preventDefault(); closeSectionPicker(); return true; }
    if (!sectionPicker.options.length || e.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); highlightSection(sectionPicker.index + (e.key === 'ArrowDown' ? 1 : -1)); return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chooseSection(sectionPicker.index); return true; }
    return false;
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
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.dia-section-choice')) e.preventDefault();
    });
    el.addEventListener('click', e => {
      const option = e.target.closest('.dia-section-choice');
      if (option) { chooseSection(Number(option.dataset.choice)); return; }
      const button = e.target.closest('[data-act]');
      if (button) {
        const act = button.dataset.act;
        if (act === 'prev') go(step(-1));
        else if (act === 'next') go(step(1));
        else if (act === 'today') go(dayKey(new Date()));
        else if (act === 'focus') setFocus(!focusMode);
        else if (act === 'section') beginSection(button.closest('.dia-item'));
        return;
      }
      if (e.target.closest('.dia-ink, .dia-study-details, .dia-section-picker')) return;
      // Casilla de una tarea: se marca sin abrir el campo.
      const box = e.target.closest('.dia-box');
      if (box) {
        const area = box.closest('.dia-ink-wrap')?.querySelector('.dia-ink');
        if (!area) return;
        area.value = toggleLine(area.value, Number(box.dataset.line));
        commit(area, true);
        showFormatted(area);
        try { root.Haptics?.light?.(); } catch (err) {}
        return;
      }
      const fmt = e.target.closest('.dia-fmt');
      if (fmt) { edit(fmt.parentElement.querySelector('.dia-ink')); return; }
      // Tocar el bloque (no solo la línea) lleva a escribir sobre él; en el libro,
      // tocar lo vacío de la hoja lleva a la línea libre de ese día.
      const scope = e.target.closest('.dia-item') || e.target.closest('.dia-sheet');
      if (!scope) return;
      const areas = scope.classList.contains('dia-sheet') ? scope.querySelectorAll('.dia-new .dia-ink') : scope.querySelectorAll('.dia-ink');
      edit(areas[areas.length - 1]);
    });
    el.addEventListener('input', e => {
      if (!e.target.classList.contains('dia-ink')) return;
      scheduleFit(e.target);
      commit(e.target, false);
      if (!e.isComposing) offerSections(e.target);
    });
    el.addEventListener('focusout', e => {
      if (!e.target.classList.contains('dia-ink')) return;
      const area = e.target;
      setTimeout(() => { if (sectionPicker?.area === area && !area.parentElement.contains(doc.activeElement)) closeSectionPicker(); }, 0);
      commit(area, true);
      if (!area.dataset.free) showFormatted(area);
      // La línea nueva del día, ya escrita, pasa a ser una entrada más.
      if (area.dataset.free && area.dataset.id) setTimeout(() => { if (!editing() && !turning) render(); }, 0);
    });
    el.addEventListener('keydown', e => {
      if (e.target.classList.contains('dia-fmt') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        edit(e.target.parentElement.querySelector('.dia-ink'));
        return;
      }
      if (!e.target.classList.contains('dia-ink')) return;
      if (sectionKey(e)) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.target.blur(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
        const area = e.target;
        if (area.selectionStart !== area.selectionEnd) return;
        const next = continueList(area.value, area.selectionStart);
        if (!next) return;
        e.preventDefault();
        area.value = next.value;
        area.setSelectionRange(next.caret, next.caret);
        fit(area);
        commit(area, false);
      }
    });
    doc.addEventListener('keydown', e => {
      if (!visible() || editing() || e.altKey || e.metaKey || e.ctrlKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'Escape' && focusMode) { e.preventDefault(); setFocus(false); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(step(-1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(step(1)); }
    });
    root.addEventListener('app:viewchange', e => {
      if (!e.detail) return;
      if (e.detail.name !== 'diario') { if (focusMode) setFocus(false); return; }
      render();
      if (lastBook) playOpening();
    });
    // Lo que llega de otro dispositivo se ve al volver, salvo si estás escribiendo.
    const refresh = () => { if (visible() && !editing() && !turning) render(); };
    root.addEventListener('focus', refresh);
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) refresh(); });
    root.addEventListener('storage', e => { if (e.key === 'alberto_piano_v2') refresh(); });
    root.addEventListener('resize', () => {
      fitStyles = new WeakMap();
      const v = view();
      if (!v || !visible()) return;
      if (bookMode() !== lastBook && !editing()) { render(); return; }
      sizeBook();
      v.querySelectorAll('.dia-ink').forEach(scheduleFit);
    });
  }

  const api = { compactTitle, day, write, shiftDay, spreadOf, duration, MERGE_GAP_MIN, parseLine, splitAside, formatHtml, toggleLine, continueList, open: key => { if (key) current = key; if (typeof root.showView === 'function') root.showView('diario'); }, render, setFocus, isFocus: () => focusMode };
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
  }
  return api;
});
