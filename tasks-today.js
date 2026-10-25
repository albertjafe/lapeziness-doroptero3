/* Tareas en Hoy (oct 2026, v518): apuntar en un toque, «las 3 de hoy»,
   una tarea en los descansos y un repaso el domingo.

   Usa la misma lista de siempre (`db.cronoTasks`, la del cronómetro): aquí no
   hay datos nuevos salvo `dueDate` ('YYYY-MM-DD'), que ya existía. «Hoy» son
   las pendientes con fecha de hoy o anterior; elegir una para hoy le pone la
   fecha de hoy. Borrar deja una lápida en `db.cronoTaskTombstones`, como el
   resto de la sincronización de tareas (`DocumentSyncCore`, `TaskSyncResilience`).
   Cada cambio pone `updatedAt`: la fusión de tareas gana por el más reciente.

   Sin contadores ni números en rojo (USUARIO.md): solo lo de hoy y la lista. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TasksToday = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const TODAY_LIMIT = 3;
  const STALE_DAYS = 14;
  const REVIEW_KEY = 'alberto_tasks_review_week_v1';
  const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fromKey = key => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const validKey = key => /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));
  const addDays = (key, n) => { const d = fromKey(key); d.setDate(d.getDate() + n); return keyOf(d); };
  const dayDiff = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jsArg = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  // Minúsculas y sin tildes, letra a letra: las posiciones coinciden con el original.
  const fold = s => String(s).toLowerCase().replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');

  /* ── Leer lo que escribes ─────────────────────────────────────────
     Prioridad: «urgentísima», «urgente», «importante» (o !!!, !!, !) al
     principio o al final, también pegadas («UrgentePoner…», del dictado).
     Fecha: «hoy», «mañana», «pasado mañana», «el jueves», «el 3/12»,
     «el 3 de diciembre», al principio o al final (con «para» delante o no).
     Tipo: «#piano» o «#personal» en cualquier sitio. Todo se quita del texto. */
  const PRIORITY_WORDS = [
    [3, /^(?:muy\s+urgente|urgent[íi]sim[oa]s?|!!!)$/i],
    [2, /^(?:urgentes?|!!)$/i],
    [1, /^(?:importantes?|!)$/i],
  ];
  const DATE_CORE = '(hoy|pasado\\s+manana|manana|(?:(?:el|este|esta|proximo|el\\s+proximo)\\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|(?:el\\s+(?:dia\\s+)?)?\\d{1,2}(?:\\s*[/.-]\\s*\\d{1,2}|\\s+de\\s+(?:' + MONTHS.map(fold).join('|') + ')))';
  const DATE_TAIL = new RegExp('(?:^|[\\s,;:–—-]+)(?:para\\s+)?' + DATE_CORE + '[\\s.,;:!]*$');
  const DATE_HEAD = new RegExp('^(?:para\\s+)?' + DATE_CORE + '(?:[\\s,;:–—-]+|$)');

  function dateFrom(phrase, todayKey) {
    const p = fold(phrase).replace(/\s+/g, ' ').trim();
    if (p === 'hoy') return todayKey;
    if (p === 'manana') return addDays(todayKey, 1);
    if (/^pasado manana$/.test(p)) return addDays(todayKey, 2);
    const wd = WEEKDAYS.findIndex(w => new RegExp('(^|\\s)' + w + '$').test(p));
    if (wd >= 0) {
      const now = fromKey(todayKey).getDay();
      let diff = (wd - now + 7) % 7;
      if (diff === 0) diff = 7; // «el lunes» dicho un lunes es el que viene
      return addDays(todayKey, diff);
    }
    const m = p.match(/(\d{1,2})(?:\s*[/.-]\s*(\d{1,2})|\s+de\s+([a-z]+))$/);
    if (m) {
      const day = Number(m[1]);
      const month = m[2] ? Number(m[2]) : MONTHS.map(fold).indexOf(m[3]) + 1;
      if (day < 1 || day > 31 || month < 1 || month > 12) return null;
      const today = fromKey(todayKey);
      let d = new Date(today.getFullYear(), month - 1, day, 12);
      if (d.getMonth() !== month - 1) return null;
      if (keyOf(d) < todayKey) d = new Date(today.getFullYear() + 1, month - 1, day, 12);
      return keyOf(d);
    }
    return null;
  }

  function parse(raw, todayKey) {
    todayKey = validKey(todayKey) ? todayKey : keyOf(new Date());
    let text = String(raw || '').replace(/\s+/g, ' ').trim();
    let kind = null;
    let priority = 0;
    let dueDate = null;
    text = text.replace(/(^|\s)#(piano|personal)(?=[\s.,;:!?]|$)/gi, (_m, space, word) => { kind = word.toLowerCase(); return space; }).replace(/\s+/g, ' ').trim();
    // Pegada al principio por el dictado: «UrgentePoner…», «ImportanteLlamar…».
    const glued = text.match(/^(urgent[íi]sim[oa]s?|urgentes?|importantes?)(?=[A-ZÁÉÍÓÚÑ])/i);
    if (glued) {
      const w = fold(glued[1]);
      priority = w.startsWith('urgentis') ? 3 : w.startsWith('urgente') ? 2 : 1;
      text = text.slice(glued[0].length);
    }
    const wordAt = piece => {
      const clean = piece.replace(/^[\s:,.;\-–—]+|[\s:,.;\-–—]+$/g, '');
      for (const [level, re] of PRIORITY_WORDS) if (re.test(clean)) return level;
      return 0;
    };
    for (let changed = true; changed && text;) {
      changed = false;
      const head = text.match(/^(muy\s+urgente|\S+)[\s:,.;\-–—]*/i);
      const headLevel = head && head[0].length < text.length ? wordAt(head[1]) : 0;
      if (headLevel) { priority = Math.max(priority, headLevel); text = text.slice(head[0].length).trim(); changed = true; continue; }
      const tail = text.match(/[\s:,.;\-–—]*(muy\s+urgente|\S+)$/i);
      const tailLevel = tail && tail.index > 0 ? wordAt(tail[1]) : 0;
      if (tailLevel) { priority = Math.max(priority, tailLevel); text = text.slice(0, tail.index).trim(); changed = true; continue; }
      if (!dueDate) {
        const folded = fold(text);
        const t = folded.match(DATE_TAIL);
        if (t && t.index > 0) {
          const due = dateFrom(t[1], todayKey);
          if (due) { dueDate = due; text = text.slice(0, t.index).trim(); changed = true; continue; }
        }
        const h = folded.match(DATE_HEAD);
        if (h && h[0].length < text.length) {
          const due = dateFrom(h[1], todayKey);
          if (due) { dueDate = due; text = text.slice(h[0].length).trim(); changed = true; continue; }
        }
      }
    }
    text = text.replace(/[\s:,;\-–—]+$/, '').replace(/^[\s:,;\-–—]+/, '').trim();
    if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
    return { text, priority, kind, dueDate };
  }

  /* ── Lista ───────────────────────────────────────────────────────── */
  function todayKey() {
    try { if (typeof root.habitDayKey === 'function') return root.habitDayKey(); } catch (e) {}
    return keyOf(new Date());
  }
  function allTasks() {
    try { if (typeof root.cronoTasks === 'function') return root.cronoTasks(); } catch (e) {}
    const data = database();
    if (data && !Array.isArray(data.cronoTasks)) data.cronoTasks = [];
    return data ? data.cronoTasks : [];
  }
  // `db` es un `let` global de app.js: no cuelga de window.
  const database = () => { try { return typeof db !== 'undefined' ? db : root.db; } catch (e) { return root.db; } };
  const prio = t => Math.max(0, Math.min(3, Math.round(Number(t && t.priority) || 0)));
  const created = t => Date.parse(t && t.createdAt || '') || 0;
  const open = t => t && !t.done && typeof t.text === 'string';

  function todayTasks(tasks, today) {
    today = today || todayKey();
    return (tasks || allTasks()).filter(t => open(t) && validKey(t.dueDate) && t.dueDate <= today)
      .sort((a, b) => (prio(b) - prio(a)) || a.dueDate.localeCompare(b.dueDate) || (created(a) - created(b)));
  }
  // Para elegir: primero las urgentes y las que ya tienen fecha cercana; luego las más antiguas.
  function candidates(tasks, today) {
    today = today || todayKey();
    return (tasks || allTasks()).filter(t => open(t) && !(validKey(t.dueDate) && t.dueDate <= today))
      .sort((a, b) => (prio(b) - prio(a)) ||
        ((validKey(a.dueDate) ? 0 : 1) - (validKey(b.dueDate) ? 0 : 1)) ||
        String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || (created(a) - created(b)));
  }
  function stale(tasks, today) {
    today = today || todayKey();
    return (tasks || allTasks()).filter(t => open(t) && !validKey(t.dueDate) && created(t) &&
      dayDiff(keyOf(new Date(created(t))), today) >= STALE_DAYS)
      .sort((a, b) => created(a) - created(b));
  }
  function weekKey(today) {
    const d = fromKey(today || todayKey());
    const back = (d.getDay() + 6) % 7; // lunes = 0
    return addDays(keyOf(d), -back);
  }
  // El repaso se ofrece el domingo y, si no se hizo, también el lunes.
  function reviewDue(tasks, today, storedWeek) {
    today = today || todayKey();
    const dow = fromKey(today).getDay();
    if (dow !== 0 && dow !== 1) return false;
    const week = dow === 0 ? weekKey(today) : weekKey(addDays(today, -1));
    if (storedWeek === week) return false;
    return stale(tasks, today).length > 0;
  }
  function dueLabel(task, today) {
    if (!task || !validKey(task.dueDate)) return '';
    today = today || todayKey();
    const diff = dayDiff(today, task.dueDate);
    if (diff < 0) return 'Atrasada';
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Mañana';
    const d = fromKey(task.dueDate);
    if (diff < 7) return WEEKDAY_SHORT[d.getDay()];
    return d.getDate() + ' ' + MONTH_SHORT[d.getMonth()];
  }

  /* ── Cambios ─────────────────────────────────────────────────────── */
  function storedReviewWeek() { try { return root.localStorage.getItem(REVIEW_KEY) || ''; } catch (e) { return ''; } }
  function markReviewed() { try { root.localStorage.setItem(REVIEW_KEY, weekKey(fromKey(todayKey()).getDay() === 1 ? addDays(todayKey(), -1) : todayKey())); } catch (e) {} }
  function toast(msg) { try { if (typeof root.showToast === 'function') root.showToast(msg); } catch (e) {} }
  function haptic(kind) { try { root.Haptics && root.Haptics[kind] && root.Haptics[kind](); } catch (e) {} }
  function save() {
    try { (typeof root.saveDataSoon === 'function' ? root.saveDataSoon : root.saveData)(); } catch (e) {}
  }
  function repaint() {
    try { if (typeof root.renderCronoTasks === 'function') root.renderCronoTasks(); } catch (e) {}
    try { if (root.MobileV2 && typeof root.MobileV2.renderHoy === 'function') root.MobileV2.renderHoy(); } catch (e) {}
  }
  function find(id) { return allTasks().find(t => t && t.id === id); }
  function touch(task) { task.updatedAt = new Date().toISOString(); }

  function add(raw, opts) {
    const parsed = parse(raw, todayKey());
    if (!parsed.text) return null;
    const now = new Date().toISOString();
    const task = { id: 'ct' + Date.now(), text: parsed.text, kind: parsed.kind || 'personal', tomorrow: false,
      dueDate: parsed.dueDate || (opts && opts.dueDate) || null, done: false, priority: parsed.priority, createdAt: now, updatedAt: now };
    if (parsed.priority) task.priorityChangedAt = now;
    allTasks().push(task);
    save(); repaint(); haptic('light');
    const bits = [];
    if (task.dueDate) bits.push(dueLabel(task).toLowerCase());
    if (task.priority) bits.push(['', 'importante', 'urgente', 'urgentísima'][task.priority]);
    toast('Tarea apuntada' + (bits.length ? ' · ' + bits.join(' · ') : ''));
    return task;
  }
  function setDue(id, key) {
    const task = find(id);
    if (!task) return false;
    task.dueDate = validKey(key) ? key : null;
    if (task.kind === 'piano') task.tomorrow = !!task.dueDate && task.dueDate === addDays(todayKey(), 1);
    touch(task); save(); repaint();
    return true;
  }
  function complete(id, button) {
    const task = find(id);
    if (!task || task.done) return false;
    const row = button && button.closest ? button.closest('.td-row') : null;
    if (row) row.classList.add('is-done');
    const commit = () => {
      task.done = true; task.doneAt = new Date().toISOString(); touch(task);
      save(); repaint();
    };
    haptic('success');
    if (row) setTimeout(commit, 260); else commit();
    return true;
  }
  function remove(id) {
    const data = database();
    const task = find(id);
    if (!data || !task) return false;
    const now = new Date().toISOString();
    if (!Array.isArray(data.cronoTaskTombstones)) data.cronoTaskTombstones = [];
    data.cronoTaskTombstones.push({ id: task.id, taskId: task.id, deletedAt: now });
    data.cronoTasks = data.cronoTasks.filter(t => t && t.id !== task.id);
    save(); repaint();
    return true;
  }

  /* ── Hoy ─────────────────────────────────────────────────────────── */
  const TASK_ICON = '<span class="mv2-ico" style="--c:#5b7fb5" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/></svg></span>';

  function rowHtml(t, today) {
    const late = t.dueDate < today;
    return '<li class="td-row p-' + prio(t) + '">' +
      '<button type="button" class="td-check" onclick="TasksToday.complete(\'' + jsArg(t.id) + '\',this)" aria-label="Hecha: ' + esc(t.text) + '"></button>' +
      '<span class="td-text">' + esc(t.text) + (late ? ' <small class="td-late">atrasada</small>' : '') + '</span>' +
      '<button type="button" class="td-later" onclick="TasksToday.later(\'' + jsArg(t.id) + '\')" aria-label="Pasar a mañana: ' + esc(t.text) + '" title="Pasar a mañana">↷</button>' +
    '</li>';
  }

  function hoyHtml(data) {
    const tasks = data && Array.isArray(data.cronoTasks) ? data.cronoTasks : allTasks();
    const today = todayKey();
    const list = todayTasks(tasks, today);
    const choose = list.length < TODAY_LIMIT && candidates(tasks, today).length;
    const review = reviewDue(tasks, today, storedReviewWeek());
    return '<section class="mv2-card td-card" aria-label="Tareas de hoy">' +
      '<div class="td-head"><span class="mv2-lbl has-ico">' + TASK_ICON + 'Tareas de hoy</span>' +
        '<button type="button" class="mv2-link" onclick="cronoOpenTaskBoard()">Todas ›</button></div>' +
      (list.length ? '<ul class="td-list">' + list.map(t => rowHtml(t, today)).join('') + '</ul>'
        : '<p class="td-empty">Nada elegido para hoy.</p>') +
      '<form class="td-add" onsubmit="return TasksToday.submit(event)">' +
        '<input id="tdInput" class="td-input" type="text" maxlength="140" autocomplete="off" enterkeyhint="done" ' +
          'placeholder="Nueva tarea · «mañana», «urgente»" aria-label="Nueva tarea. Puedes escribir mañana, el jueves o urgente">' +
        '<button type="submit" class="td-add-btn" aria-label="Apuntar tarea">＋</button>' +
      '</form>' +
      ((choose || review) ? '<div class="td-links">' +
        (choose ? '<button type="button" class="mv2-link" onclick="TasksToday.openPicker()">Elegir para hoy ›</button>' : '') +
        (review ? '<button type="button" class="mv2-link" onclick="TasksToday.openReview()">Repasar tareas antiguas ›</button>' : '') +
      '</div>' : '') +
    '</section>';
  }

  function submit(event) {
    if (event && event.preventDefault) event.preventDefault();
    const input = root.document && root.document.getElementById('tdInput');
    const value = input ? input.value : '';
    if (!String(value).trim()) { if (input) input.focus(); return false; }
    // Escrita desde «Tareas de hoy» y sin fecha: es para hoy mientras queden
    // huecos de los tres; si ya hay tres, va a la lista sin fecha.
    const room = todayTasks().length < TODAY_LIMIT;
    const task = add(value, room ? { dueDate: todayKey() } : null);
    if (task && !room && !task.dueDate) toast('Apuntada en la lista: ya tienes tres para hoy');
    const fresh = root.document && root.document.getElementById('tdInput');
    if (task && fresh) { fresh.value = ''; fresh.focus(); }
    return false;
  }
  function later(id) {
    if (setDue(id, addDays(todayKey(), 1))) toast('Pasada a mañana');
  }

  /* ── Hojas: elegir para hoy y repaso ─────────────────────────────── */
  function sheet(id, title, inner) {
    const doc = root.document;
    let el = doc.getElementById(id);
    if (!el) {
      el = doc.createElement('div'); el.id = id; el.className = 'mv2-sheet-overlay td-sheet';
      el.addEventListener('click', e => { if (e.target === el) closeSheet(id); });
      doc.body.appendChild(el);
    }
    el.innerHTML = '<div class="mv2-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="mv2-grab" aria-hidden="true"></div>' +
      '<div class="mv2-sheet-head"><b>' + esc(title) + '</b><button type="button" class="mv2-sheet-close" onclick="TasksToday.closeSheet(\'' + id + '\')">Cerrar</button></div>' + inner + '</div>';
    el.classList.add('open');
    return el;
  }
  function closeSheet(id) {
    const el = root.document && root.document.getElementById(id);
    if (el) el.classList.remove('open');
    if (id === 'tdReviewSheet') markReviewed();
  }

  function openPicker() {
    const today = todayKey();
    const have = todayTasks(null, today).length;
    const list = candidates(null, today);
    const inner = '<p class="td-sheet-note">' + (have >= TODAY_LIMIT ? 'Ya tienes ' + have + ' para hoy. Termina alguna antes de añadir más.'
        : 'Elige como mucho ' + (TODAY_LIMIT - have) + (TODAY_LIMIT - have === 1 ? ' más.' : ' más. Mejor pocas y hechas.')) + '</p>' +
      (list.length ? '<div class="td-pick-list">' + list.map(t =>
        '<button type="button" class="td-pick p-' + prio(t) + '" onclick="TasksToday.pick(\'' + jsArg(t.id) + '\')">' +
          '<b>' + esc(t.text) + '</b><small>' + esc([prio(t) ? ['', 'Importante', 'Urgente', 'Urgentísima'][prio(t)] : '', dueLabel(t, today)].filter(Boolean).join(' · ') || 'Sin fecha') + '</small>' +
        '</button>').join('') + '</div>'
        : '<p class="td-sheet-note">No quedan tareas pendientes.</p>');
    sheet('tdPickSheet', 'Elegir para hoy', inner);
  }
  function pick(id) {
    setDue(id, todayKey());
    haptic('light');
    if (todayTasks().length >= TODAY_LIMIT) { closeSheet('tdPickSheet'); toast('Listo: tres para hoy'); }
    else openPicker();
  }

  let reviewQueue = [];
  function openReview() {
    reviewQueue = stale().map(t => t.id);
    showReviewItem();
  }
  function showReviewItem() {
    const today = todayKey();
    while (reviewQueue.length && !open(find(reviewQueue[0]))) reviewQueue.shift();
    if (!reviewQueue.length) {
      sheet('tdReviewSheet', 'Repaso de tareas', '<p class="td-sheet-note">Repaso hecho. Hasta el domingo que viene.</p>');
      markReviewed();
      return;
    }
    const t = find(reviewQueue[0]);
    const days = created(t) ? dayDiff(keyOf(new Date(created(t))), today) : 0;
    const inner = '<div class="td-review">' +
      '<b class="td-review-text">' + esc(t.text) + '</b>' +
      '<small>Apuntada hace ' + days + ' días, sin fecha</small>' +
      '<div class="td-review-actions">' +
        '<button type="button" class="td-btn is-primary" onclick="TasksToday.reviewAs(\'today\')">Hoy</button>' +
        '<button type="button" class="td-btn" onclick="TasksToday.reviewAs(\'week\')">Esta semana</button>' +
        '<button type="button" class="td-btn is-danger" onclick="TasksToday.reviewAs(\'delete\')">Borrar</button>' +
      '</div>' +
      '<button type="button" class="mv2-link" onclick="TasksToday.reviewAs(\'skip\')">Dejarla sin fecha ›</button>' +
    '</div>';
    sheet('tdReviewSheet', 'Repaso de tareas', inner);
  }
  // «Esta semana»: el viernes que viene (o dentro de 3 días si ya es viernes o fin de semana).
  function weekDue(today) {
    const dow = fromKey(today).getDay();
    const toFri = (5 - dow + 7) % 7;
    return addDays(today, toFri >= 1 && toFri <= 4 ? toFri : 3);
  }
  function reviewAs(choice) {
    const id = reviewQueue.shift();
    const today = todayKey();
    if (id) {
      if (choice === 'today') setDue(id, today);
      else if (choice === 'week') setDue(id, weekDue(today));
      else if (choice === 'delete') remove(id);
    }
    showReviewItem();
  }

  /* ── Descanso: una tarea de hoy al terminar un bloque ────────────── */
  let breakTimer = null;
  function offerBreak() {
    const doc = root.document;
    if (!doc) return false;
    const task = todayTasks()[0];
    if (!task) return false;
    let el = doc.getElementById('tdBreak');
    if (!el) { el = doc.createElement('div'); el.id = 'tdBreak'; el.className = 'td-break'; el.setAttribute('role', 'status'); doc.body.appendChild(el); }
    el.innerHTML = '<span class="td-break-copy"><small>En el descanso</small><b>' + esc(task.text) + '</b></span>' +
      '<button type="button" class="td-btn is-primary" onclick="TasksToday.breakDone(\'' + jsArg(task.id) + '\')">Hecha</button>' +
      '<button type="button" class="td-break-close" onclick="TasksToday.hideBreak()" aria-label="Ahora no">×</button>';
    el.classList.add('open');
    clearTimeout(breakTimer);
    breakTimer = setTimeout(hideBreak, 20000);
    return true;
  }
  function hideBreak() {
    clearTimeout(breakTimer);
    const el = root.document && root.document.getElementById('tdBreak');
    if (el) el.classList.remove('open');
  }
  function breakDone(id) {
    complete(id);
    hideBreak();
    toast('Hecha');
  }

  return {
    TODAY_LIMIT, STALE_DAYS, parse, dateFrom, todayTasks, candidates, stale, reviewDue, weekKey, weekDue, dueLabel,
    add, setDue, complete, remove, later, submit, hoyHtml, openPicker, pick, openReview, reviewAs, closeSheet,
    offerBreak, hideBreak, breakDone,
  };
});
