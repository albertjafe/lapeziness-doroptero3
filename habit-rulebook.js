/* Reglamento de un hábito: qué es recaída y qué no, excepciones cerradas y
   casos resueltos. Se redacta con una IA (la app copia la petición y lee el
   bloque que devuelve) y cada versión rige desde el día siguiente a guardarla,
   para que nunca se pueda aflojar una norma en caliente. Se guarda en
   habit.rulebooks (lista de versiones con effectiveFrom), dentro del propio
   hábito, así que viaja con la sincronización de siempre. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HabitRulebook = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const MAX_VERSIONS = 30;
  const MAX_ITEMS = 40;
  const MAX_EXAMPLES = 60;
  const MAX_TEXT = 320;

  // Reglas que valen para todos los hábitos (se muestran en Normas y se le
  // dan a la IA como principios). Cortas: se leen en un momento de duda.
  const GENERAL_RULES = [
    'Si dudas, es recaída. Se apunta esa misma noche y el caso se resuelve después, en frío.',
    'Las excepciones son una lista cerrada: lo que no está escrito no es excepción, por razonable que parezca.',
    'Las normas solo cambian en frío y hacia delante: un reglamento nuevo rige desde el día siguiente, nunca hoy ni hacia atrás.',
    'Un reto no se borra para esquivar una caída: la caída se apunta y el calendario sigue.',
    'Tras una recaída se vuelve a la norma en el acto: el «total, hoy ya he fallado» no existe.',
    'Frases que delatan una negociación: «solo un momento», «es para algo útil», «hoy es especial», «solo miro la hora». Si te oyes una, la respuesta es no.',
  ];

  const SECTION_ALIASES = [
    ['allowed', ['NO ES RECAIDA', 'NO ES FALLO', 'NO CUENTA COMO RECAIDA', 'NO CUENTA COMO FALLO', 'PERMITIDO', 'NO ES INCUMPLIMIENTO']],
    ['relapse', ['ES RECAIDA', 'ES FALLO', 'CUENTA COMO RECAIDA', 'CUENTA COMO FALLO', 'RECAIDAS', 'ES INCUMPLIMIENTO']],
    ['terms', ['DEFINICIONES', 'TERMINOS']],
    ['exceptions', ['EXCEPCIONES']],
    ['examples', ['EJEMPLOS', 'CASOS', 'CASOS RESUELTOS']],
    ['setup', ['PREPARACION', 'PARA PONERTELO FACIL']],
  ];

  const LIST_KEYS = ['terms', 'relapse', 'allowed', 'exceptions', 'setup'];

  function norm(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  }
  function clip(value, max) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  }
  function stripMarkdown(line) {
    return String(line || '')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/\*\*|__|`/g, '')
      .trim();
  }
  function stripBullet(line) {
    return line.replace(/^([-*•·–]|\d{1,2}[.)])\s+/, '').trim();
  }

  function keyAt(start, offset) {
    const [y, m, d] = String(start).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + offset));
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }
  const validKey = key => /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));

  function verdictOf(value) {
    const v = norm(value).replace(/[^A-Z ]/g, ' ').trim();
    if (!v) return null;
    if (/^(NO\b|PERMITIDO|VALE|OK\b|CUMPLE|CUMPLIDO)/.test(v)) return 'ok';
    if (/^(SI\b|RECAIDA|FALLO|INCUMPLE|INCUMPLIMIENTO)/.test(v)) return 'relapse';
    return null;
  }

  function parseExample(text) {
    const parts = text.split(/\s*[|｜]\s*/).filter(part => part !== '');
    if (parts.length >= 2) {
      const verdict = verdictOf(parts[1]);
      if (verdict) return { case: clip(parts[0], MAX_TEXT), verdict, why: clip(parts.slice(2).join(' · '), MAX_TEXT) };
    }
    const arrow = /^(.+?)\s*(?:→|->|=>|:)\s*(NO ES RECA[IÍ]DA|NO ES FALLO|RECA[IÍ]DA|FALLO|NO|S[IÍ])\b[\s.:,;–-]*(.*)$/i.exec(text);
    if (arrow) {
      const verdict = verdictOf(arrow[2]);
      if (verdict) return { case: clip(arrow[1], MAX_TEXT), verdict, why: clip(arrow[3], MAX_TEXT) };
    }
    return null;
  }

  function sectionFor(label) {
    const key = norm(label).replace(/[:.]+$/, '').trim();
    for (const [section, aliases] of SECTION_ALIASES) if (aliases.includes(key)) return section;
    return null;
  }

  /* Lee el bloque que devuelve la IA. Tolera negritas, almohadillas, viñetas
     distintas y texto antes o después del bloque. */
  function parse(text) {
    const rb = { rule: '', terms: [], relapse: [], allowed: [], exceptions: [], examples: [], setup: [] };
    const errors = [];
    const warnings = [];
    let section = null;
    let recognized = 0;
    let skippedExamples = 0;
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    for (const raw of lines) {
      const line = stripMarkdown(raw);
      if (!line) continue;
      const upper = norm(line);
      if (upper === 'REGLAMENTO' || upper === 'REGLAMENTO:') { recognized++; section = null; continue; }
      if (upper === 'FIN' || upper === 'FIN DEL REGLAMENTO') { if (recognized) break; continue; }
      const colon = line.indexOf(':');
      const head = colon > 0 ? line.slice(0, colon) : line;
      const rest = colon > 0 ? line.slice(colon + 1).trim() : '';
      if (norm(head) === 'REGLA' && !/^([-*•·]|\d)/.test(line)) {
        recognized++;
        section = 'rule';
        if (rest) rb.rule = clip(rest, 400);
        continue;
      }
      const found = colon > 0 || /:$/.test(line) ? sectionFor(head) : sectionFor(line);
      if (found && !/^([-*•·]|\d{1,2}[.)])\s/.test(line)) {
        recognized++;
        section = found;
        if (rest) addItem(found, rest);
        continue;
      }
      if (!recognized) continue;
      if (section === 'rule') { rb.rule = clip((rb.rule ? rb.rule + ' ' : '') + stripBullet(line), 400); continue; }
      if (section) addItem(section, stripBullet(line));
    }

    function addItem(key, value) {
      if (!value) return;
      if (key === 'examples') {
        const example = parseExample(value);
        if (!example || !example.case) { skippedExamples++; return; }
        if (rb.examples.length < MAX_EXAMPLES) rb.examples.push(example);
        return;
      }
      if (LIST_KEYS.includes(key) && rb[key].length < MAX_ITEMS) rb[key].push(clip(value, MAX_TEXT));
    }

    if (!recognized) errors.push('No encuentro el reglamento. Pega el bloque completo que empieza por «REGLAMENTO».');
    else {
      if (!rb.rule) errors.push('Falta la línea «REGLA:» con la norma en una frase.');
      if (!rb.relapse.length) errors.push('Falta la lista «ES RECAÍDA» (qué rompe el hábito).');
      if (!rb.allowed.length) warnings.push('No hay lista «NO ES RECAÍDA».');
      if (!rb.examples.length) warnings.push('No hay casos resueltos en «EJEMPLOS».');
    }
    if (skippedExamples) warnings.push(skippedExamples === 1 ? 'Un caso no dice si es recaída o no y se ha ignorado.' : skippedExamples + ' casos no dicen si son recaída o no y se han ignorado.');
    return { ok: errors.length === 0, rulebook: errors.length ? null : rb, errors, warnings };
  }

  function words(mode) {
    return mode === 'do'
      ? { fail: 'FALLO', failList: 'ES FALLO', okList: 'NO ES FALLO', failLabel: 'Es fallo', okLabel: 'No es fallo', failShort: 'Fallo' }
      : { fail: 'RECAÍDA', failList: 'ES RECAÍDA', okList: 'NO ES RECAÍDA', failLabel: 'Es recaída', okLabel: 'No es recaída', failShort: 'Recaída' };
  }

  /* El mismo formato que se pide a la IA: sirve para enseñarle el vigente. */
  function format(rb, mode) {
    if (!rb) return '';
    const w = words(mode);
    const list = (title, items) => title + ':\n' + (items && items.length ? items.map(item => '- ' + item).join('\n') : '-');
    return [
      'REGLAMENTO',
      'REGLA: ' + (rb.rule || ''),
      list('DEFINICIONES', rb.terms),
      list(w.failList, rb.relapse),
      list(w.okList, rb.allowed),
      list('EXCEPCIONES', rb.exceptions),
      'EJEMPLOS:\n' + ((rb.examples || []).map(e => '- ' + e.case + ' | ' + (e.verdict === 'ok' ? 'NO' : w.fail) + (e.why ? ' | ' + e.why : '')).join('\n') || '-'),
      list('PREPARACIÓN', rb.setup),
      'FIN',
    ].join('\n');
  }

  function versions(habit) {
    return (Array.isArray(habit && habit.rulebooks) ? habit.rulebooks : [])
      .filter(rb => rb && validKey(rb.effectiveFrom) && rb.rule)
      .slice()
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || String(a.savedAt || '').localeCompare(String(b.savedAt || '')));
  }
  function inForce(habit, todayKey) {
    const list = versions(habit).filter(rb => rb.effectiveFrom <= todayKey);
    return list.length ? list[list.length - 1] : null;
  }
  function pending(habit, todayKey) {
    const list = versions(habit).filter(rb => rb.effectiveFrom > todayKey);
    return list.length ? list[list.length - 1] : null;
  }
  // Un reto que aún no ha empezado estrena el reglamento el primer día; uno en
  // curso, al día siguiente (sin reglamento, hoy manda «si dudas, recaída»).
  function effectiveFromFor(habit, todayKey) {
    if (habit && validKey(habit.startDate) && habit.startDate > todayKey) return habit.startDate;
    return keyAt(todayKey, 1);
  }
  // Guardar dos veces el mismo día sustituye la versión pendiente; las que ya
  // rigieron se conservan como historial.
  function withRulebook(habit, rulebook, todayKey, nowIso) {
    const kept = versions(habit).filter(rb => rb.effectiveFrom <= todayKey);
    const next = Object.assign({}, rulebook, { effectiveFrom: effectiveFromFor(habit, todayKey), savedAt: nowIso });
    return kept.concat([next]).slice(-MAX_VERSIONS);
  }

  function modeLine(habit) {
    return habit.mode === 'avoid' ? 'Evitar (solo registro los días que recaigo)' : 'Hacer (marco cada día que lo cumplo)';
  }

  function buildPrompt(habit, options) {
    const opts = options || {};
    const todayKey = opts.todayKey;
    const w = words(habit.mode);
    const duration = Math.max(1, Math.round(Number(habit.durationDays) || 21));
    const endKey = validKey(habit.startDate) ? keyAt(habit.startDate, duration - 1) : '';
    const dayIndex = validKey(habit.startDate) && validKey(todayKey)
      ? Math.round((Date.parse(todayKey) - Date.parse(habit.startDate)) / 86400000) + 1 : 0;
    const current = inForce(habit, todayKey) || pending(habit, todayKey);
    const cases = String(opts.cases || '').trim();
    const lapses = (opts.lapses || []).filter(l => l && l.date);
    const finished = validKey(endKey) && validKey(todayKey) && todayKey > endKey;
    const field = (label, value) => '- ' + label + ': ' + (String(value || '').trim() || '(sin escribir)');
    return [
      'Quiero cerrar sin ambigüedades el reglamento de uno de mis hábitos, para no tener que negociar conmigo mismo en el momento ni gastar energía en decidir qué cuenta. Redáctalo tú.',
      '',
      'HÁBITO',
      field('Nombre', habit.title),
      field('Tipo', modeLine(habit)),
      field('Duración', duration + ' días, del ' + (habit.startDate || '?') + ' al ' + (endKey || '?') + (dayIndex >= 1 && dayIndex <= duration ? ' (hoy es el día ' + dayIndex + ')' : '')),
      field('Descripción', habit.description),
      field('Por qué lo hago', habit.motivation),
      field('Qué cuenta como cumplirlo', habit.successCriteria),
      ...(finished ? ['- Estado: reto terminado el ' + endKey + '. Ahora está en mantenimiento: la norma sigue rigiendo sin fecha final; cada caída se apunta y 3 caídas en 14 días o 4 en 30 reabren el reto (14 días).'] : []),
      '',
      current ? 'REGLAMENTO ACTUAL (mejóralo con los casos nuevos; no lo rehagas sin motivo)' : 'REGLAMENTO ACTUAL',
      current ? format(current, habit.mode) : 'Todavía no tiene.',
      '',
      'CASOS NUEVOS O DUDAS QUE QUIERO RESOLVER',
      ...(cases || !lapses.length ? [cases || 'Ninguno en concreto: anticipa tú los casos dudosos más habituales.'] : []),
      ...(lapses.length ? ['Caídas que he apuntado (resuélvelas en EJEMPLOS y cierra la rendija que las permitió):',
        ...lapses.map(l => '- ' + l.date + ': ' + (l.note || '(sin nota)'))] : []),
      '',
      'PRINCIPIOS QUE DEBE CUMPLIR',
      '1. Cada norma se comprueba con hechos observables, sin juzgar intenciones. «Si es importante» o «si hace falta» no valen si no dicen cómo se comprueba.',
      '2. Las excepciones son una lista cerrada con condiciones objetivas. Lo que no esté escrito no es excepción.',
      '3. Si dudo, cuenta como ' + w.fail.toLowerCase() + '.',
      '4. Distingue llevar el objeto de usarlo: cuando llevarlo es inevitable (fuera de casa, de viaje), se permite llevarlo, no usarlo.',
      '5. Si hace falta una función del móvil (luz, alarma, ruido, billete, mapa), propón el objeto o el uso mínimo que la sustituye, con límites concretos.',
      '6. Una salida de emergencia nunca es más cómoda que cumplir la norma (mejor un tope horario más tardío que una excepción abierta).',
      '7. Lo urgente llega por una vía fijada de antemano (por ejemplo, llamadas); nunca se revisa «por si acaso».',
      '8. Pocas normas y claras: que se pueda consultar en 30 segundos en un momento de duda.',
      '9. Cubre los contextos: en casa, fuera, de viaje, en casa ajena, días sin piano o sin estudio, enfermedad, mañana y noche, y otros aparatos (iPad, ordenador, tele).',
      '10. Estas normas generales ya rigen y no hace falta repetirlas: ' + GENERAL_RULES.join(' '),
      '',
      'CONTEXTO FIJO',
      '- Soy pianista. Estudio con una app propia que tiene cronómetro; suelo usarla en el iPad (partituras, cronómetro, metrónomo, grabaciones).',
      '- El reglamento nuevo rige desde el día siguiente a guardarlo.',
      '',
      'FORMATO DE RESPUESTA',
      'Responde SOLO con este bloque, sin nada antes ni después y sin cambiar los encabezados. Una idea por línea, frases cortas en español. Entre 12 y 25 casos en EJEMPLOS; en cada caso, la segunda columna es exactamente ' + w.fail + ' o NO.',
      '',
      'REGLAMENTO',
      'REGLA: (la norma en una sola frase)',
      'DEFINICIONES:',
      '- (qué significa exactamente cada palabra clave)',
      w.failList + ':',
      '- …',
      w.okList + ':',
      '- …',
      'EXCEPCIONES:',
      '- (condición objetiva) → qué se permite exactamente',
      'EJEMPLOS:',
      '- situación concreta | ' + w.fail + ' | por qué',
      '- situación concreta | NO | por qué',
      'PREPARACIÓN:',
      '- (lo que conviene dejar hecho para que cumplir sea fácil)',
      'FIN',
    ].join('\n');
  }

  /* ---------- Interfaz (solo en el navegador) ---------- */

  let editingId = null;
  let lastPrompt = '';

  function doc() { return root.document || null; }
  function el(id) { const d = doc(); return d ? d.getElementById(id) : null; }
  function todayKeyNow() { return typeof root.habitDayKey === 'function' ? root.habitDayKey() : new Date().toISOString().slice(0, 10); }
  function findHabit(id) {
    return typeof root.habitAllChallenges === 'function' ? root.habitAllChallenges().find(h => h.id === id) || null : null;
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }
  function shortDate(key) {
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
    const [, m, d] = String(key || '').split('-').map(Number);
    return m ? d + ' ' + months[m - 1] : '—';
  }
  function whenLabel(effectiveFrom, todayKey) {
    return effectiveFrom === keyAt(todayKey, 1) ? 'mañana (' + shortDate(effectiveFrom) + ')' : 'el ' + shortDate(effectiveFrom);
  }

  function openEditor(habitId) {
    const habit = findHabit(habitId);
    if (!habit) return;
    editingId = habit.id;
    lastPrompt = '';
    const todayKey = todayKeyNow();
    const when = whenLabel(effectiveFromFor(habit, todayKey), todayKey);
    const set = (id, fn) => { const node = el(id); if (node) fn(node); };
    set('hrbHabitName', node => { node.textContent = habit.title || 'Hábito'; });
    set('hrbIntro', node => {
      node.textContent = (inForce(habit, todayKey) || pending(habit, todayKey)
        ? 'La IA recibe tu reglamento actual y los casos nuevos que escribas, y te devuelve la versión mejorada.'
        : 'La IA recibe tu hábito y te devuelve un reglamento cerrado: qué es recaída, qué no, excepciones y casos resueltos.') +
        ' Lo que guardes rige desde ' + when + '.';
    });
    set('hrbCases', node => { node.value = ''; });
    set('hrbPaste', node => { node.value = ''; });
    set('hrbPromptFallback', node => { node.hidden = true; node.value = ''; });
    set('hrbCopyNote', node => { node.textContent = ''; });
    set('hrbSaveBtn', node => { node.textContent = 'Guardar · rige desde ' + when; });
    preview();
    if (typeof root.openModal === 'function') root.openModal('modalHabitRulebook');
  }

  async function copyPrompt() {
    const habit = findHabit(editingId);
    if (!habit) return;
    const todayKey = todayKeyNow();
    // En un hábito terminado, las caídas apuntadas viajan solas como casos que resolver.
    const M = root.HabitMaintenance;
    const upkeep = M && typeof root.habitAllChallenges === 'function' ? M.state(root.habitAllChallenges(), habit, todayKey) : null;
    // Y en un reto en curso, las recaídas en las que apuntaste qué pasó.
    const relapses = Object.entries(habit.logs || {}).filter(([, log]) => log && log.status === 'failed' && log.note)
      .map(([date, log]) => ({ date, note: log.note })).sort((a, b) => b.date.localeCompare(a.date));
    const lapses = (upkeep && upkeep.applies ? upkeep.lapses : []).concat(relapses).slice(0, 15);
    lastPrompt = buildPrompt(habit, { todayKey, cases: el('hrbCases') ? el('hrbCases').value : '', lapses });
    const note = el('hrbCopyNote');
    const fallback = el('hrbPromptFallback');
    try {
      if (!root.navigator || !root.navigator.clipboard || !root.navigator.clipboard.writeText) throw new Error('sin portapapeles');
      await root.navigator.clipboard.writeText(lastPrompt);
      if (fallback) fallback.hidden = true;
      if (note) note.textContent = 'Copiada. Pégala en Claude (u otra IA) y trae aquí su respuesta.';
    } catch (error) {
      // Sin permiso de portapapeles: se enseña el texto seleccionado para copiarlo a mano.
      if (fallback) {
        fallback.hidden = false;
        fallback.value = lastPrompt;
        fallback.focus();
        fallback.select();
      }
      if (note) note.textContent = 'No he podido copiarla sola: está seleccionada abajo, cópiala tú.';
    }
  }

  function listHtml(title, items, cls) {
    if (!items || !items.length) return '';
    return '<div class="hrb-prev-list ' + (cls || '') + '"><b>' + esc(title) + '</b><span>' + items.length + '</span></div>';
  }

  function preview() {
    const box = el('hrbPreview');
    const save = el('hrbSaveBtn');
    const habit = findHabit(editingId);
    const text = el('hrbPaste') ? el('hrbPaste').value : '';
    if (!box) return null;
    if (!text.trim()) {
      box.innerHTML = '';
      if (save) save.disabled = true;
      return null;
    }
    const result = parse(text);
    const w = words(habit && habit.mode);
    if (!result.ok) {
      box.innerHTML = '<div class="hrb-prev is-error">' + result.errors.map(e => '<p>' + esc(e) + '</p>').join('') + '</div>';
      if (save) save.disabled = true;
      return result;
    }
    const rb = result.rulebook;
    const relapses = rb.examples.filter(e => e.verdict === 'relapse').length;
    box.innerHTML = '<div class="hrb-prev">' +
      '<p class="hrb-prev-rule">' + esc(rb.rule) + '</p>' +
      '<div class="hrb-prev-grid">' +
        listHtml(w.failLabel, rb.relapse, 'is-relapse') + listHtml(w.okLabel, rb.allowed, 'is-ok') +
        listHtml('Excepciones', rb.exceptions) + listHtml('Casos resueltos', rb.examples) +
        listHtml('Definiciones', rb.terms) + listHtml('Preparación', rb.setup) +
      '</div>' +
      (rb.examples.length ? '<p class="hrb-prev-note">' + relapses + ' ' + (relapses === 1 ? 'caso es' : 'casos son') + ' ' + w.failShort.toLowerCase() + ' y ' + (rb.examples.length - relapses) + ' no.</p>' : '') +
      result.warnings.map(e => '<p class="hrb-prev-warn">' + esc(e) + '</p>').join('') +
    '</div>';
    if (save) save.disabled = false;
    return result;
  }

  function save() {
    const result = preview();
    if (!result || !result.ok) return;
    if (typeof root.habitStoredChallenges !== 'function' || typeof root.habitPersistChallenges !== 'function') return;
    const stored = root.habitStoredChallenges();
    const habit = stored.find(item => item && item.id === editingId && !item.deleted);
    if (!habit) return;
    const todayKey = todayKeyNow();
    const nowIso = new Date().toISOString();
    habit.rulebooks = withRulebook(habit, result.rulebook, todayKey, nowIso);
    habit.updatedAt = nowIso;
    root.habitPersistChallenges(stored);
    if (typeof root.saveData === 'function') root.saveData();
    if (typeof root.renderHabitChallenge === 'function') root.renderHabitChallenge();
    if (typeof root.renderHabitCalendar === 'function') root.renderHabitCalendar();
    if (root.HabitsPage && typeof root.HabitsPage.render === 'function') root.HabitsPage.render();
    if (typeof root.closeModal === 'function') root.closeModal('modalHabitRulebook');
    const saved = habit.rulebooks[habit.rulebooks.length - 1];
    if (typeof root.showToast === 'function') root.showToast('Reglamento guardado · rige desde ' + whenLabel(saved.effectiveFrom, todayKey));
  }

  return {
    GENERAL_RULES, parse, format, words, inForce, pending, versions, effectiveFromFor, withRulebook, buildPrompt,
    openEditor, copyPrompt, preview, save,
  };
});
