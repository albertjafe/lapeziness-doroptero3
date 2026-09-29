/* Obras v3 · una sola capa para la lista de obras y la ficha de cada obra.
   Sustituye a obra-premium, obra-premium-polish, obras-redesign,
   obras-redesign-polish y obras-unified-library (cinco capas que se pisaban
   con MutationObservers). La obra solo muestra lo que sigue vivo: solidez,
   tiempo real estudiado (plantas del cronómetro y de Forest, no las tarjetas
   del plan), dificultad, próximo evento y movimientos. Escena, pases y etapas
   manuales ya no se enseñan (los datos antiguos se conservan).
   Las piezas puras (sin DOM) se exportan para las pruebas unitarias. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ObrasV3 = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DAY = 86400000;

  /* ---------- Piezas puras ---------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  const norm = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const clamp = value => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; };

  function fmtStudy(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (total < 60) return total + ' min';
    const h = Math.floor(total / 60), m = total % 60;
    return m ? h + ' h ' + m + ' min' : h + ' h';
  }
  function fmtDuration(minutes, estimated) {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) return '';
    return (estimated ? '≈ ' : '') + String(Math.round(n * 2) / 2).replace('.5', '½') + ' min';
  }
  function relativeDays(time, now) {
    if (!time) return '';
    const days = Math.max(0, Math.floor((now - time) / DAY));
    if (days === 0) return 'hoy';
    if (days === 1) return 'ayer';
    if (days < 14) return 'hace ' + days + ' d';
    if (days < 70) return 'hace ' + Math.round(days / 7) + ' sem';
    if (days < 730) return 'hace ' + Math.round(days / 30) + ' meses';
    return 'hace ' + Math.round(days / 365) + ' años';
  }
  function untilLabel(days) {
    if (days <= 0) return 'hoy';
    if (days === 1) return 'mañana';
    if (days < 14) return 'en ' + days + ' d';
    if (days < 70) return 'en ' + Math.round(days / 7) + ' sem';
    return 'en ' + Math.round(days / 30) + ' meses';
  }

  // Solidez guardada (último registro de su historial), por si el modelo aún no cargó.
  function storedScore(entity) {
    const history = Array.isArray(entity && entity.solHistory) ? entity.solHistory : [];
    let best = null, bestTime = -Infinity;
    history.forEach(item => {
      const time = Date.parse(item && (item.date || item.fecha || item.at || '')) || 0;
      if (time >= bestTime) { bestTime = time; best = item; }
    });
    const fromHistory = best ? clamp(best.val ?? best.value ?? best.sol) : null;
    return fromHistory != null ? fromHistory : clamp(entity && entity.sol);
  }

  /* Índice de estudio real: minutos y última práctica por obra y por
     movimiento, a partir de las plantas (cada una es un tramo real). */
  function studyIndex(plants) {
    const works = {}, movs = {};
    (plants || []).forEach(p => {
      if (!p || p.failed || p.tipo === 'descanso' || !p.obraId || p.obraId === '_rest_') return;
      const mins = Math.max(0, Math.round(Number(p.mins) || 0));
      if (!mins) return;
      const time = Date.parse(p.startedAt || p.start || '') || 0;
      const w = works[p.obraId] || (works[p.obraId] = { minutes: 0, last: 0, recent: 0 });
      w.minutes += mins;
      if (time > w.last) w.last = time;
      if (p.movId) {
        const key = p.obraId + '::' + p.movId;
        const m = movs[key] || (movs[key] = { minutes: 0, last: 0 });
        m.minutes += mins;
        if (time > m.last) m.last = time;
      }
    });
    return { works, movs };
  }
  function addRecent(index, plants, now) {
    (plants || []).forEach(p => {
      if (!p || p.failed || p.tipo === 'descanso' || !p.obraId) return;
      const time = Date.parse(p.startedAt || '') || 0;
      const w = index.works[p.obraId];
      if (w && now - time <= 30 * DAY) w.recent += Math.max(0, Math.round(Number(p.mins) || 0));
    });
    return index;
  }

  const eventDate = ev => String(ev && (ev.fecha || ev.fechaInicio || ev.date || '') || '').slice(0, 10);
  function eventHasWork(ev, id) {
    return (Array.isArray(ev && ev.obras) ? ev.obras : []).some(item => String(item && typeof item === 'object' ? (item.id ?? item.refId ?? item.obraId) : item) === String(id));
  }
  // Próximo evento (hoy o después, sin completar) que incluye la obra.
  function nextEvent(events, id, todayKey) {
    let best = null;
    (events || []).forEach(ev => {
      const date = eventDate(ev);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayKey || ev.completado || !eventHasWork(ev, id)) return;
      if (!best || date < best.date) best = { date, name: String(ev.nombre || ev.name || 'Evento'), id: ev.id };
    });
    if (best) best.days = Math.round((Date.parse(best.date) - Date.parse(todayKey)) / DAY);
    return best;
  }

  // Prioridad para «Ahora»: evento cercano, práctica reciente y solidez baja.
  function priority(info) {
    let score = 0;
    if (info.event) score += info.event.days <= 14 ? 90 : info.event.days <= 45 ? 60 : info.event.days <= 90 ? 30 : 10;
    const days = info.last ? (info.now - info.last) / DAY : Infinity;
    if (days <= 3) score += 70; else if (days <= 10) score += 50; else if (days <= 30) score += 25;
    if (score && info.score != null && info.score < 80) score += Math.min(25, (80 - info.score) * 0.4);
    return score;
  }

  function sortWorks(rows, sort) {
    const byName = (a, b) => norm(a.work.name).localeCompare(norm(b.work.name), 'es');
    const byComposer = (a, b) => norm(a.work.composer).localeCompare(norm(b.work.composer), 'es') || byName(a, b);
    const copy = rows.slice();
    if (sort === 'composer') return copy.sort(byComposer);
    if (sort === 'title') return copy.sort(byName);
    if (sort === 'solidity') return copy.sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || byName(a, b));
    if (sort === 'recent') return copy.sort((a, b) => (b.last || 0) - (a.last || 0) || byName(a, b));
    return copy.sort((a, b) => b.priority - a.priority || (b.last || 0) - (a.last || 0) || byComposer(a, b));
  }

  function matches(entry, query) {
    if (!query) return true;
    const hay = norm([entry.name, entry.composer, entry.context, entry.notes].concat((entry.movimientos || []).map(m => m && m.name)).join(' '));
    return norm(query).split(/\s+/).every(part => hay.includes(part));
  }

  /* Filas de la lista: `infos` = [{work, score, status, last, minutes, event, priority}] */
  function rowHtml(info, selected, now) {
    const w = info.work;
    const meta = [w.composer, fmtDuration(w.duracion), info.last ? relativeDays(info.last, now) : 'sin práctica'].filter(Boolean).join(' · ');
    const score = info.score;
    return '<button type="button" class="ob3-row' + (selected ? ' is-selected' : '') + '" data-work-id="' + esc(w.id) + '">' +
      '<span class="ob3-row-main">' +
        '<span class="ob3-row-title">' + esc(w.name || 'Obra sin título') + '</span>' +
        '<span class="ob3-row-meta">' + esc(meta) + '</span>' +
        (info.event ? '<span class="ob3-row-event">→ ' + esc(untilLabel(info.event.days)) + ' · ' + esc(info.event.name) + '</span>' : '') +
      '</span>' +
      '<span class="ob3-row-side">' +
        '<strong>' + (score == null ? '—' : score + '%') + '</strong>' +
        '<small>' + esc(info.status || '') + '</small>' +
        '<i class="ob3-bar"><b style="width:' + (score || 0) + '%"></b></i>' +
      '</span>' +
    '</button>';
  }
  function historyRowHtml(entry, selected) {
    const years = entry.fromYear && entry.toYear ? (entry.fromYear === entry.toYear ? '~' + entry.fromYear : entry.fromYear + '–' + entry.toYear) : entry.lastPlayedYear ? 'última ~' + entry.lastPlayedYear : '';
    const real = Number(entry.realStudyMinutes);
    const hours = Number(entry.estimatedHours);
    const meta = [entry.composer, years, real > 0 ? fmtStudy(real) + ' reales' : Number.isFinite(hours) && hours > 0 ? '≈ ' + hours + ' h' : ''].filter(Boolean).join(' · ');
    return '<button type="button" class="ob3-row is-history' + (selected ? ' is-selected' : '') + '" data-history-id="' + esc(entry.id) + '">' +
      '<span class="ob3-row-main"><span class="ob3-row-title">' + esc(entry.name || 'Obra histórica') + '</span><span class="ob3-row-meta">' + esc(meta) + '</span></span>' +
      '<span class="ob3-row-side"><small class="ob3-tag">Histórica</small></span></button>';
  }
  function sectionHtml(title, rows, className) {
    if (!rows.length) return '';
    return '<section class="ob3-section ' + (className || '') + '"><h3>' + esc(title) + '<span>' + rows.length + '</span></h3><div class="ob3-rows">' + rows.join('') + '</div></section>';
  }

  /* Ficha (vista). `ctx`: { work, score, status, details, minutes, recent, last,
     event, difficulty:{score,label}, movements:[{mov, score, minutes}], pred, enrich, message, now, inline } */
  function sheetViewHtml(ctx) {
    const w = ctx.work;
    const movs = ctx.movements || [];
    const meta = [fmtDuration(w.duracion), movs.length ? movs.length + (movs.length === 1 ? ' movimiento' : ' movimientos') : '',
      ctx.difficulty ? 'técnica ' + ctx.difficulty.score.toFixed(1).replace('.', ',') + '/10 · ' + ctx.difficulty.label.toLowerCase() : ''].filter(Boolean).join(' · ');
    const partial = ctx.details && ctx.details.source === 'movements' && ctx.details.partial ? ctx.details.measuredMovements + '/' + ctx.details.totalMovements + ' mov. medidos' : '';
    const score = ctx.score;
    const next = ctx.event
      ? '<strong>' + esc(untilLabel(ctx.event.days)) + '</strong><small>' + esc(ctx.event.name) + '</small>'
      : '<strong>' + esc(ctx.last ? relativeDays(ctx.last, ctx.now) : '—') + '</strong><small>' + (ctx.last ? 'última práctica' : 'sin práctica') + '</small>';
    const movRows = movs.map((row, index) => {
      const m = row.mov;
      const sub = [fmtDuration(m.duracion, !!m.duracionEstimada), row.minutes ? fmtStudy(row.minutes) + ' estudiados' : ''].filter(Boolean).join(' · ');
      return '<div class="ob3-mov obra-premium-movement" data-mov-id="' + esc(m.id) + '">' +
        '<span class="ob3-mov-n">' + (index + 1) + '</span>' +
        '<span class="ob3-mov-main"><span class="ob3-mov-name">' + esc(m.name || 'Movimiento ' + (index + 1)) + '</span>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
        '<button type="button" class="ob3-mov-sol" data-action="pase-mov" data-mov-id="' + esc(m.id) + '" title="Registrar solidez de este movimiento">' + (row.score == null ? '—' : row.score + '%') + '<i class="ob3-bar"><b style="width:' + (row.score || 0) + '%"></b></i></button>' +
        '<button type="button" class="ob3-mov-play" data-action="study-mov" data-mov-id="' + esc(m.id) + '" aria-label="Estudiar este movimiento">▶</button>' +
      '</div>';
    }).join('');
    return '<header class="ob3-sheet-head">' +
        '<div class="ob3-sheet-titles"><span class="ob3-eyebrow">' + esc(w.composer || 'Repertorio') + '</span>' +
        '<h2 class="ob3-title">' + esc(w.name || 'Obra sin título') + '</h2>' +
        (meta ? '<p class="ob3-meta">' + esc(meta) + '</p>' : '') + '</div>' +
        (ctx.inline ? '' : '<button type="button" class="ob3-close" data-action="close" aria-label="Cerrar">✕</button>') +
      '</header>' +
      '<div class="ob3-sheet-body">' +
        '<div class="ob3-stats">' +
          '<div class="ob3-stat is-sol"><span>Solidez</span><strong>' + (score == null ? '—' : score + '%') + '</strong><small>' + esc([ctx.status, partial].filter(Boolean).join(' · ')) + '</small><i class="ob3-bar"><b style="width:' + (score || 0) + '%"></b></i></div>' +
          '<div class="ob3-stat"><span>Estudiado</span><strong>' + esc(fmtStudy(ctx.minutes)) + '</strong><small>' + (!ctx.minutes ? 'con el cronómetro' : ctx.recent >= ctx.minutes ? 'todo en los últimos 30 días' : ctx.recent ? esc(fmtStudy(ctx.recent)) + ' en 30 días' : 'nada en 30 días') + '</small></div>' +
          '<div class="ob3-stat"><span>' + (ctx.event ? 'Próximo evento' : 'Práctica') + '</span>' + next + '</div>' +
        '</div>' +
        (ctx.pred ? '<div class="ob3-pred">' + ctx.pred + '</div>' : '') +
        '<div class="ob3-actions">' +
          '<button type="button" class="ob3-btn is-primary" data-action="study">▶ Estudiar ahora</button>' +
          '<button type="button" class="ob3-btn" data-action="pase">Registrar solidez</button>' +
          '<button type="button" class="ob3-btn" data-action="solidity-history">Historial</button>' +
        '</div>' +
        (movs.length || ctx.enrich ? '<section class="ob3-block"><header><h3>Movimientos</h3>' + (ctx.enrich ? '<button type="button" class="ob3-link" data-action="enrich">Completar nombres y duraciones</button>' : '') + '</header>' +
          (movRows ? '<div class="ob3-movs">' + movRows + '</div>' : '') + '</section>' : '') +
        (w.notes ? '<section class="ob3-block"><header><h3>Notas</h3></header><p class="ob3-notes">' + esc(w.notes) + '</p></section>' : '') +
        (ctx.message ? '<p class="ob3-message" role="status">' + esc(ctx.message) + '</p>' : '') +
      '</div>' +
      '<footer class="ob3-sheet-foot"><button type="button" class="ob3-btn" data-action="edit">Editar obra</button></footer>';
  }

  function sheetEditHtml(work, opts) {
    const movs = Array.isArray(work.movimientos) ? work.movimientos : [];
    const diff = opts && opts.difficulty != null ? opts.difficulty : work.dificultad;
    const movRows = movs.map((m, index) =>
      '<div class="ob3-edit-mov" data-mov-index="' + index + '">' +
        '<input data-mov-field="name" aria-label="Nombre del movimiento" value="' + esc(m.name || '') + '" placeholder="Movimiento ' + (index + 1) + '">' +
        '<input data-mov-field="duracion" aria-label="Minutos" type="number" inputmode="decimal" min="0" step="0.5" value="' + (m.duracion == null ? '' : esc(m.duracion)) + '" placeholder="min">' +
        '<button type="button" class="ob3-icon" data-action="remove-mov" data-index="' + index + '" aria-label="Quitar movimiento">−</button>' +
      '</div>').join('');
    return '<header class="ob3-sheet-head"><div class="ob3-sheet-titles"><span class="ob3-eyebrow">Editar obra</span><h2 class="ob3-title">' + esc(work.name || 'Obra') + '</h2></div>' +
        ((opts && opts.inline) ? '' : '<button type="button" class="ob3-close" data-action="close" aria-label="Cerrar">✕</button>') + '</header>' +
      '<div class="ob3-sheet-body">' +
        '<div class="ob3-form">' +
          '<label class="is-wide"><span>Título</span><input id="obraPremiumName" value="' + esc(work.name || '') + '"></label>' +
          '<label class="is-wide"><span>Compositor</span><input id="obraPremiumComposer" value="' + esc(work.composer || '') + '"></label>' +
          '<label><span>Duración (min)</span><input id="obraPremiumDuration" type="number" inputmode="decimal" min="0" step="0.5" value="' + (work.duracion == null ? '' : esc(work.duracion)) + '"></label>' +
          '<label><span>Dificultad técnica (1–10)</span><input id="obraPremiumDifficulty" type="number" inputmode="decimal" min="1" max="10" step="0.1" value="' + (diff == null ? '' : esc(diff)) + '"></label>' +
        '</div>' +
        '<section class="ob3-block"><header><h3>Movimientos</h3>' + (opts && opts.catalog ? '<button type="button" class="ob3-link" data-action="enrich-draft">Completar desde catálogo</button>' : '') + '</header>' +
          '<div class="ob3-edit-movs">' + (movRows || '<p class="ob3-hint">Sin movimientos: la obra se estudia entera.</p>') + '</div>' +
          '<button type="button" class="ob3-link" data-action="add-mov">＋ Añadir movimiento</button>' +
        '</section>' +
        '<label class="ob3-notes-edit"><span>Notas</span><textarea id="obraPremiumNotes" rows="3">' + esc(work.notes || '') + '</textarea></label>' +
        ((opts && opts.message) ? '<p class="ob3-message" role="status">' + esc(opts.message) + '</p>' : '') +
      '</div>' +
      '<footer class="ob3-sheet-foot is-edit">' +
        '<button type="button" class="ob3-btn is-danger" data-action="delete">Eliminar</button>' +
        '<span class="ob3-foot-gap"></span>' +
        '<button type="button" class="ob3-btn" data-action="cancel-edit">Cancelar</button>' +
        '<button type="button" class="ob3-btn is-primary" data-action="save">Guardar cambios</button>' +
      '</footer>';
  }

  function historicalDetailHtml(entry) {
    const period = entry.fromYear && entry.toYear ? (entry.fromYear === entry.toYear ? '~' + entry.fromYear : entry.fromYear + '–' + entry.toYear) : entry.fromYear ? 'desde ~' + entry.fromYear : entry.toYear ? 'hasta ~' + entry.toYear : '';
    const real = Number(entry.realStudyMinutes);
    const hours = Number(entry.estimatedHours);
    return '<header class="ob3-sheet-head"><div class="ob3-sheet-titles"><span class="ob3-eyebrow">' + esc(entry.composer || 'Archivo') + ' · histórica</span><h2 class="ob3-title">' + esc(entry.name || 'Obra histórica') + '</h2>' +
      (period || entry.lastPlayedYear ? '<p class="ob3-meta">' + esc([period, entry.lastPlayedYear ? 'última vez ~' + entry.lastPlayedYear : ''].filter(Boolean).join(' · ')) + '</p>' : '') + '</div></header>' +
      '<div class="ob3-sheet-body"><div class="ob3-stats is-two">' +
        '<div class="ob3-stat"><span>' + (real > 0 ? 'Estudio medido' : 'Horas') + '</span><strong>' + (real > 0 ? esc(fmtStudy(real)) : Number.isFinite(hours) && hours > 0 ? '≈ ' + esc(hours) + ' h' : '—') + '</strong></div>' +
        '<div class="ob3-stat"><span>Nivel</span><strong>' + esc(entry.peakLevel || '—') + '</strong></div></div>' +
        (entry.context ? '<section class="ob3-block"><header><h3>Contexto</h3></header><p class="ob3-notes">' + esc(entry.context) + '</p></section>' : '') +
        (entry.notes ? '<section class="ob3-block"><header><h3>Notas</h3></header><p class="ob3-notes">' + esc(entry.notes) + '</p></section>' : '') +
      '</div><footer class="ob3-sheet-foot"><button type="button" class="ob3-btn" data-action="archive">Gestionar obras históricas</button></footer>';
  }

  /* ---------- Obras sin ficha ----------
     Estudio (plantas) cuya obra ya no está en la lista: una obra que no llegó
     a sincronizarse o que se borró. El nombre sale de las sesiones del
     historial (obraName). Se puede recuperar con su id (vuelve con todo su
     estudio) o unir con otra obra: cada tramo cambia de obra con su reloj de
     campo, así que la sincronización propaga el cambio y no lo duplica. */
  function orphans(d, nowMs) {
    const known = new Set((d.obras || []).filter(w => w && w.id != null).map(w => String(w.id)));
    const hidden = d.obrasSinFichaOcultas || {};
    const map = new Map();
    ['sessionPlants', 'forestPlants'].forEach(key => (d[key] || []).forEach(p => {
      if (!p || p.failed || p.tipo === 'descanso' || !p.obraId || p.obraId === '_rest_') return;
      const id = String(p.obraId);
      if (known.has(id) || (p.id == null && p.runId == null)) return;
      const mins = Math.max(0, Math.round(Number(p.mins) || 0));
      if (!mins) return;
      const o = map.get(id) || { id, name: '', minutes: 0, count: 0, first: '', last: '' };
      o.minutes += mins; o.count += 1;
      const at = String(p.startedAt || '');
      if (at && (!o.first || at < o.first)) o.first = at;
      if (at > o.last) o.last = at;
      map.set(id, o);
    }));
    (d.sesiones || []).forEach(sesion => (sesion && sesion.items || []).forEach(item => {
      const o = item && map.get(String(item.obraId || ''));
      if (o && !o.name) o.name = String(item.obraName || item.name || '').trim();
    }));
    const now = nowMs || Date.now();
    return [...map.values()].map(o => Object.assign(o, {
      hidden: !!hidden[o.id],
      recent: !!o.last && now - Date.parse(o.last) <= 60 * DAY,
    })).sort((a, b) => b.minutes - a.minutes);
  }
  const titleBase = name => norm(String(name || '').split(',')[0]);
  // La obra de la lista que parece la misma (mismo título antes de la primera coma).
  function suggestedMatch(works, orphan) {
    const base = titleBase(orphan.name);
    if (!base) return null;
    return (works || []).find(w => w && w.tipo !== 'actividad' && titleBase(w.name) === base) || null;
  }
  function recoveredWork(orphan, nowIso) {
    return { id: orphan.id, name: orphan.name || 'Obra recuperada', composer: '', tipo: 'obra', origen: null, dificultad: null, duracion: null,
      sol: 1, solHistory: [], notes: '', createdAt: nowIso, updatedAt: nowIso, recoveredAt: nowIso };
  }
  // Pasa el estudio de una obra a otra. Solo tramos con id (identidad estable).
  function moveStudy(d, fromId, toId, nowIso, target) {
    const movIds = new Set(((target && target.movimientos) || []).map(m => String(m && m.id)));
    let moved = 0;
    ['sessionPlants', 'forestPlants'].forEach(key => (d[key] || []).forEach(p => {
      if (!p || String(p.obraId) !== String(fromId) || (p.id == null && p.runId == null)) return;
      const clock = { obraId: nowIso };
      p.obraId = toId;
      if (p.movId && !movIds.has(String(p.movId))) { p.movId = null; clock.movId = nowIso; }
      p._fieldClock = Object.assign({}, p._fieldClock, clock);
      p.updatedAt = nowIso;
      moved += 1;
    }));
    return moved;
  }
  function orphanMeta(o) {
    const day = iso => { const t = new Date(iso); return isNaN(t) ? '' : t.getDate() + ' ' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][t.getMonth()]; };
    const range = o.first && o.last ? (day(o.first) === day(o.last) ? day(o.first) : day(o.first) + ' – ' + day(o.last)) : '';
    return [fmtStudy(o.minutes), o.count + (o.count === 1 ? ' tramo' : ' tramos'), range].filter(Boolean).join(' · ');
  }
  function orphansHtml(list, works) {
    const options = (works || []).filter(w => w && w.tipo !== 'actividad')
      .slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name), 'es'));
    const items = list.map(o => {
      const match = suggestedMatch(works, o);
      // Sin una obra que parezca la misma, hay que elegirla: nunca se une a la primera de la lista.
      const opts = (match ? '' : '<option value="" selected disabled>Elige la obra…</option>') +
        (match ? [match] : []).concat(options.filter(w => w !== match)).map(w =>
          '<option value="' + esc(w.id) + '">' + esc((w === match ? '★ ' : '') + (w.name || 'Obra') + (w.composer && w.composer !== '—' ? ' · ' + w.composer : '')) + '</option>').join('');
      return '<article class="ob3-orphan' + (o.hidden ? ' is-hidden' : '') + '" data-orphan="' + esc(o.id) + '">' +
        '<header><b>' + esc(o.name || 'Obra sin nombre') + '</b><small>' + esc(orphanMeta(o)) + '</small></header>' +
        (o.name ? '' : '<label class="ob3-orphan-name"><span>Nombre para recuperarla</span><input data-orphan-name placeholder="Ej. Reflets dans l\'eau" maxlength="160"></label>') +
        (match ? '<p class="ob3-hint">Parece la misma que «' + esc(match.name) + '»: únelas para sumar su estudio.</p>' : '') +
        '<div class="ob3-orphan-actions">' +
          '<button type="button" class="ob3-btn' + (match ? '' : ' is-primary') + '" data-orphan-action="recover">Recuperar</button>' +
          (options.length ? '<label class="ob3-orphan-join"><span>Unir con</span><select data-orphan-target>' + opts + '</select></label>' +
            '<button type="button" class="ob3-btn' + (match ? ' is-primary' : '') + '" data-orphan-action="join">Unir</button>' : '') +
          '<button type="button" class="ob3-link" data-orphan-action="' + (o.hidden ? 'show' : 'hide') + '">' + (o.hidden ? 'Mostrar' : 'Ocultar') + '</button>' +
        '</div></article>';
    }).join('');
    return '<header class="ob3-sheet-head"><div class="ob3-sheet-titles"><span class="ob3-eyebrow">Repertorio</span><h2 class="ob3-title">Obras sin ficha</h2>' +
        '<p class="ob3-meta">Hay estudio guardado de obras que ya no están en tu lista (por ejemplo, porque no llegaron a sincronizarse). Recupéralas o únelas con la obra que ya tienes; su estudio no se pierde.</p></div>' +
        '<button type="button" class="ob3-close" data-orphan-action="close" aria-label="Cerrar">✕</button></header>' +
      '<div class="ob3-sheet-body">' + (items || '<p class="ob3-empty">No queda ninguna: todo tu estudio tiene su obra.</p>') + '</div>';
  }

  const pure = { esc, norm, fmtStudy, fmtDuration, relativeDays, untilLabel, storedScore, studyIndex, addRecent, nextEvent, priority, sortWorks, matches, rowHtml, historyRowHtml, sheetViewHtml, sheetEditHtml, historicalDetailHtml, orphans, suggestedMatch, recoveredWork, moveStudy, orphanMeta, orphansHtml };
  if (!root.document) return pure;

  /* ---------- Interfaz ---------- */

  const doc = root.document;
  const state = { query: '', scope: 'all', sort: 'smart', selectedId: null, selectedKind: 'work', showActivities: false, menuOpen: false, orphanCount: 0 };
  // Una ficha flotante (móvil / iPad vertical) y un panel fijo (iPad horizontal, escritorio).
  const sheet = { id: null, mode: 'view', draft: null, message: '', diffShown: null };
  const pane = { id: null, mode: 'view', draft: null, message: '', diffShown: null };
  let overlay = null;
  let renderQueued = false;

  function data() {
    try { if (typeof DB !== 'undefined' && DB) return DB; } catch (e) {} // eslint-disable-line no-undef
    try { if (typeof db !== 'undefined' && db) return db; } catch (e) {} // eslint-disable-line no-undef
    return null;
  }
  function persist() {
    try { if (typeof root.saveData === 'function') return root.saveData(); } catch (e) {}
  }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function workById(id) {
    const d = data();
    return d && Array.isArray(d.obras) ? d.obras.find(w => w && String(w.id) === String(id)) : null;
  }
  function clone(value) { try { return structuredClone(value); } catch (e) { return JSON.parse(JSON.stringify(value)); } }

  function loadCompanion(id, src) {
    if (doc.getElementById(id)) return;
    const s = doc.createElement('script');
    s.id = id; s.src = src; s.async = true;
    doc.head.appendChild(s);
  }
  // Seguimiento 1:1 del dedo en el deslizador de solidez y editor del historial.
  loadCompanion('paseLiquidDirectTouchScript', './pase-liquid-direct-touch.js?v=342');
  loadCompanion('solidityHistoryEditorScript', './solidity-history-editor.js?v=342');

  function model() { return root.SolidityModel || null; }
  function scoreOf(entity, isWork) {
    const m = model();
    if (m) { try { return isWork ? m.currentWorkScore(entity) : m.currentScore(entity); } catch (e) {} }
    return storedScore(entity);
  }
  function statusOf(work, compact) {
    const m = model(), score = scoreOf(work, true);
    if (m && typeof m.statusLabel === 'function') { try { return m.statusLabel(data(), work, { compact }); } catch (e) {} }
    return score == null ? 'Sin medir' : '';
  }
  function difficultyOf(work) {
    const m = root.WorkDifficultyModel;
    if (m) { try { const r = m.resolve(work); if (r && Number.isFinite(r.score)) return { score: r.score, label: m.label(r.score) }; } catch (e) {} }
    const n = Number(work && work.dificultad);
    return Number.isFinite(n) && n > 0 ? { score: n, label: '' } : null;
  }

  function currentIndex() {
    const d = data() || {};
    const plants = (d.sessionPlants || []).concat(d.forestPlants || []);
    return addRecent(studyIndex(plants), plants, Date.now());
  }

  function infoFor(work, index, now, tk) {
    const d = data() || {};
    const w = index.works[work.id] || { minutes: 0, last: 0, recent: 0 };
    let last = w.last;
    (work.solHistory || []).forEach(h => { const t = Date.parse(h && h.date || '') || 0; if (t > last && t <= now) last = t; });
    const score = scoreOf(work, true);
    const info = { work, score, status: statusOf(work, true), last, now, minutes: w.minutes + (Number(work.minutosExtra) || 0), recent: w.recent, event: nextEvent(d.eventos, work.id, tk) };
    info.priority = priority(info);
    return info;
  }

  function isWide() {
    const w = root.innerWidth || 0, h = root.innerHeight || 0;
    if (doc.documentElement.classList.contains('platform-windows')) return w >= 1000;
    return w >= 980 && w > h;
  }

  /* --- Lista --- */

  function ensureHead() {
    const bench = doc.querySelector('#view-obras .obras-workbench');
    if (!bench || doc.getElementById('ob3Head')) return;
    const head = doc.createElement('div');
    head.id = 'ob3Head';
    head.className = 'ob3-head';
    head.innerHTML =
      '<div class="ob3-head-row">' +
        '<label class="ob3-search"><span aria-hidden="true">⌕</span><input id="ob3Search" type="search" autocomplete="off" placeholder="Buscar obra o compositor"></label>' +
        '<div class="ob3-menu-wrap"><button type="button" class="ob3-icon" id="ob3MenuBtn" aria-label="Más opciones" aria-expanded="false">···</button>' +
          '<div class="ob3-menu" id="ob3Menu" hidden><button type="button" data-menu="activities">Mostrar actividades</button><button type="button" data-menu="archive">Gestionar obras históricas</button><button type="button" data-menu="orphans" hidden>Obras sin ficha</button></div></div>' +
        '<button type="button" class="ob3-add" id="ob3Add">＋ Añadir</button>' +
      '</div>' +
      '<div class="ob3-head-row is-filters">' +
        '<div class="ob3-seg" role="tablist" aria-label="Qué obras">' +
          '<button type="button" class="is-active" data-scope="all">Todas</button><button type="button" data-scope="active">Actuales</button><button type="button" data-scope="history">Históricas</button>' +
        '</div>' +
        '<label class="ob3-sort"><span>Orden</span><select id="ob3Sort"><option value="smart">Prioridad</option><option value="recent">Última práctica</option><option value="solidity">Solidez</option><option value="composer">Compositor</option><option value="title">Título</option></select></label>' +
        '<span class="ob3-count" id="ob3Count"></span>' +
      '</div>';
    bench.insertBefore(head, bench.firstChild);
    head.querySelector('#ob3Add').addEventListener('click', () => { if (typeof root.openAddObra === 'function') root.openAddObra(); });
    head.querySelector('#ob3Search').addEventListener('input', e => { state.query = e.target.value; render(); });
    head.querySelector('#ob3Sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    head.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      state.scope = b.dataset.scope;
      head.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('is-active', x === b));
      render();
    }));
    head.querySelector('#ob3MenuBtn').addEventListener('click', e => { e.stopPropagation(); state.menuOpen = !state.menuOpen; syncMenu(); });
    head.querySelector('#ob3Menu').addEventListener('click', e => {
      const b = e.target.closest('[data-menu]');
      if (!b) return;
      state.menuOpen = false; syncMenu();
      if (b.dataset.menu === 'activities') { state.showActivities = !state.showActivities; render(); }
      if (b.dataset.menu === 'archive') openArchive();
      if (b.dataset.menu === 'orphans') openOrphans();
    });
    doc.addEventListener('click', e => {
      if (state.menuOpen && !e.target.closest('.ob3-menu-wrap')) { state.menuOpen = false; syncMenu(); }
    });
  }
  function syncMenu() {
    const menu = doc.getElementById('ob3Menu'), btn = doc.getElementById('ob3MenuBtn');
    if (!menu || !btn) return;
    menu.hidden = !state.menuOpen;
    btn.setAttribute('aria-expanded', state.menuOpen ? 'true' : 'false');
    const lost = menu.querySelector('[data-menu="orphans"]');
    if (lost) { lost.hidden = !state.orphanCount; lost.textContent = 'Obras sin ficha (' + state.orphanCount + ')'; }
    const act = menu.querySelector('[data-menu="activities"]');
    if (act) act.textContent = state.showActivities ? 'Ocultar actividades' : 'Mostrar actividades';
  }
  function openArchive() {
    if (typeof root.openHistoricalRepertoire !== 'function') return;
    root.openHistoricalRepertoire();
    setTimeout(() => { const p = doc.getElementById('historicalRepertoirePanel'); if (p && p.scrollIntoView) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 40);
  }

  /* --- Obras sin ficha --- */
  let orphanOverlay = null;
  function openOrphans() {
    if (!orphanOverlay) {
      orphanOverlay = doc.createElement('div');
      orphanOverlay.id = 'ob3OrphansOverlay';
      orphanOverlay.className = 'ob3-overlay';
      orphanOverlay.innerHTML = '<section class="ob3-sheet" role="dialog" aria-modal="true" aria-label="Obras sin ficha"><div class="ob3-card" id="ob3OrphansContent"></div></section>';
      orphanOverlay.addEventListener('click', e => {
        if (e.target === orphanOverlay) return closeOrphans();
        const button = e.target.closest('[data-orphan-action]');
        if (button) onOrphanAction(button);
      });
      doc.body.appendChild(orphanOverlay);
    }
    paintOrphans();
    if (orphanOverlay.nextSibling) doc.body.appendChild(orphanOverlay);
    orphanOverlay.classList.add('open');
    doc.body.classList.add('ob3-lock');
  }
  function closeOrphans() {
    if (!orphanOverlay) return;
    orphanOverlay.classList.remove('open');
    if (!(overlay && overlay.classList.contains('open'))) doc.body.classList.remove('ob3-lock');
  }
  function paintOrphans() {
    const d = data();
    const box = doc.getElementById('ob3OrphansContent');
    if (!d || !box) return;
    const list = orphans(d).sort((a, b) => Number(a.hidden) - Number(b.hidden) || b.minutes - a.minutes);
    box.innerHTML = orphansHtml(list, (d.obras || []).filter(w => w && !w.deleted));
  }
  function toast(text) { if (typeof root.showToast === 'function') root.showToast(text); }
  function onOrphanAction(button) {
    const action = button.dataset.orphanAction;
    if (action === 'close') return closeOrphans();
    const card = button.closest('[data-orphan]');
    const d = data();
    if (!card || !d) return;
    const id = card.dataset.orphan;
    const orphan = orphans(d).find(o => o.id === id);
    if (!orphan) return paintOrphans();
    const nowIso = new Date().toISOString();
    if (action === 'hide' || action === 'show') {
      d.obrasSinFichaOcultas = Object.assign({}, d.obrasSinFichaOcultas);
      if (action === 'hide') d.obrasSinFichaOcultas[id] = nowIso; else delete d.obrasSinFichaOcultas[id];
    } else if (action === 'recover') {
      d.obras = Array.isArray(d.obras) ? d.obras : [];
      const typed = card.querySelector('[data-orphan-name]');
      const name = orphan.name || String(typed ? typed.value : '').trim();
      if (!name) { if (typed) typed.focus(); toast('Escribe el nombre de la obra para recuperarla'); return; }
      if (!workById(id)) d.obras.push(recoveredWork(Object.assign({}, orphan, { name }), nowIso));
      toast('Recuperada: ' + name + ' · ' + fmtStudy(orphan.minutes));
    } else if (action === 'join') {
      const select = card.querySelector('[data-orphan-target]');
      const target = select && select.value && workById(select.value);
      if (!target) { if (select) select.focus(); toast('Elige con qué obra unirla'); return; }
      if (!root.confirm('¿Unir «' + (orphan.name || 'esta obra') + '» con «' + (target.name || 'la obra elegida') + '»? Sus ' + fmtStudy(orphan.minutes) + ' pasan a esa obra.')) return;
      const moved = moveStudy(d, id, target.id, nowIso, target);
      toast(moved ? 'Unidas: ' + fmtStudy(orphan.minutes) + ' pasan a «' + (target.name || 'la obra') + '»' : 'No había tramos que mover');
    } else return;
    persist();
    render();
    paintOrphans();
  }

  function render() {
    renderQueued = false;
    ensureHead();
    const d = data();
    const list = doc.getElementById('obrasList');
    if (!d || !list) return;
    const now = Date.now(), tk = todayKey();
    const index = currentIndex();
    const all = (d.obras || []).filter(w => w && !w.deleted);
    const works = all.filter(w => w.tipo !== 'actividad');
    const activities = all.filter(w => w.tipo === 'actividad');
    const history = Array.isArray(d.historicalRepertoire) ? d.historicalRepertoire : [];
    const count = doc.getElementById('ob3Count');
    if (count) count.textContent = works.length + (works.length === 1 ? ' obra' : ' obras') + (history.length ? ' · ' + history.length + ' históricas' : '');

    const infos = works.filter(w => matches(w, state.query)).map(w => infoFor(w, index, now, tk));
    const hist = history.filter(h => matches(h, state.query)).sort((a, b) => norm(a.composer).localeCompare(norm(b.composer), 'es') || norm(a.name).localeCompare(norm(b.name), 'es'));
    const wide = isWide();
    if (wide && (!state.selectedId || (state.selectedKind === 'work' && !workById(state.selectedId)))) {
      const first = sortWorks(infos, 'smart')[0];
      if (first) { state.selectedId = first.work.id; state.selectedKind = 'work'; }
    }
    const sel = (kind, id) => wide && state.selectedKind === kind && String(state.selectedId) === String(id);
    let html = '';
    const lost = orphans(d, now);
    state.orphanCount = lost.length;
    const pending = lost.filter(o => !o.hidden && o.recent);
    if (pending.length && !state.query) {
      html += '<button type="button" class="ob3-alert" data-open-orphans>' + (pending.length === 1 ? '1 obra con estudio no tiene ficha' : pending.length + ' obras con estudio no tienen ficha') +
        '<small>' + esc(pending.map(o => o.name || 'Obra sin nombre').join(' · ')) + '</small><b>Revisar ›</b></button>';
    }
    if (state.scope !== 'history') {
      const smart = state.sort === 'smart' && !state.query;
      const now6 = smart ? sortWorks(infos.filter(i => i.priority >= 25), 'smart').slice(0, 6) : [];
      const nowIds = new Set(now6.map(i => String(i.work.id)));
      const rest = sortWorks(infos.filter(i => !nowIds.has(String(i.work.id))), smart ? 'composer' : state.sort);
      html += sectionHtml('Ahora', now6.map(i => rowHtml(i, sel('work', i.work.id), now)), 'is-now');
      html += sectionHtml(now6.length ? 'Resto del repertorio' : 'Repertorio', rest.map(i => rowHtml(i, sel('work', i.work.id), now)), 'is-rest');
      if (state.showActivities) {
        html += sectionHtml('Actividades', activities.filter(a => matches(a, state.query)).map(a =>
          '<div class="ob3-row is-activity"><span class="ob3-row-main"><span class="ob3-row-title">' + esc(a.name) + '</span><span class="ob3-row-meta">' + esc(fmtStudy((index.works[a.id] || {}).minutes || 0)) + '</span></span></div>'), 'is-activities');
      }
    }
    if (state.scope !== 'active') html += sectionHtml('Históricas', hist.map(h => historyRowHtml(h, sel('history', h.id))), 'is-history');
    if (!html) html = '<p class="ob3-empty">' + (state.query ? 'Nada coincide con «' + esc(state.query) + '».' : 'Todavía no hay obras. Pulsa «＋ Añadir».') + '</p>';

    const view = doc.getElementById('view-obras');
    if (view) view.classList.toggle('ob3-wide', wide);
    list.innerHTML = '<div class="ob3-layout"><div class="ob3-list">' + html + '</div>' + (wide ? '<aside class="ob3-pane" id="obrasDetail"></aside>' : '') + '</div>';
    if (wide) renderPane();
    syncMenu();
  }
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    (root.requestAnimationFrame || setTimeout)(render);
  }

  function onListClick(e) {
    if (e.target.closest('[data-open-orphans]')) return openOrphans();
    const row = e.target.closest('[data-work-id],[data-history-id]');
    if (!row || !e.currentTarget.contains(row)) return;
    const isHistory = row.hasAttribute('data-history-id');
    const id = isHistory ? row.dataset.historyId : row.dataset.workId;
    if (isWide()) {
      state.selectedId = id; state.selectedKind = isHistory ? 'history' : 'work';
      Object.assign(pane, { id: null, mode: 'view', draft: null, message: '' });
      doc.querySelectorAll('#obrasList .ob3-row.is-selected').forEach(r => r.classList.remove('is-selected'));
      row.classList.add('is-selected');
      renderPane();
      return;
    }
    if (isHistory) openArchive(); else openSheet(id);
  }

  /* --- Ficha: vista y edición (compartida entre la hoja y el panel) --- */

  function viewCtx(work, st, inline) {
    const now = Date.now(), index = currentIndex();
    const info = infoFor(work, index, now, todayKey());
    const m = model();
    let details = null;
    if (m && typeof m.workScoreDetails === 'function') { try { details = m.workScoreDetails(work); } catch (e) {} }
    const movements = (Array.isArray(work.movimientos) ? work.movimientos : []).map(mov => ({
      mov, score: scoreOf(mov, false), minutes: (index.movs[work.id + '::' + mov.id] || {}).minutes || 0,
    }));
    let pred = '';
    // Solo con alguna medida real: sin historial la previsión sería inventada.
    const measured = (work.solHistory || []).length || (work.movimientos || []).some(mv => (mv.solHistory || []).length);
    if (measured && info.score != null && typeof root._obraPredHint === 'function') { try { pred = root._obraPredHint(work, info.score) || ''; } catch (e) {} }
    const cat = root.WorkStructureCatalog;
    let enrich = false;
    if (cat) {
      try {
        const structure = cat.matchWorkStructure(work);
        const movs = work.movimientos || [];
        enrich = !!structure && (!movs.length || movs.some((mv, i) => structure.movements[i] && (cat.isGenericMovementName(mv.name) || mv.duracion == null)));
      } catch (e) {}
    }
    return Object.assign({}, info, { status: statusOf(work, false), details, movements, pred, enrich, difficulty: difficultyOf(work), message: st.message, inline });
  }

  function paint(container, st, inline) {
    if (!container) return;
    const work = st.mode === 'edit' ? st.draft : workById(st.id);
    if (!work) { container.innerHTML = inline ? '<p class="ob3-empty">Elige una obra de la lista.</p>' : ''; if (!inline) closeSheet(); return; }
    if (st.mode === 'edit') {
      let catalog = false;
      try { catalog = !!(root.WorkStructureCatalog && root.WorkStructureCatalog.matchWorkStructure(work)); } catch (e) {}
      container.innerHTML = sheetEditHtml(work, { inline, catalog, message: st.message, difficulty: st.diffShown });
    } else {
      container.innerHTML = sheetViewHtml(viewCtx(work, st, inline));
    }
  }

  function readDraft(container, st) {
    const draft = st.draft;
    if (!draft) return;
    const val = sel => { const n = container.querySelector(sel); return n ? n.value : ''; };
    draft.name = val('#obraPremiumName').trim() || draft.name;
    draft.composer = val('#obraPremiumComposer').trim();
    const dur = Number(val('#obraPremiumDuration'));
    draft.duracion = Number.isFinite(dur) && dur > 0 ? dur : null;
    st.diffInput = val('#obraPremiumDifficulty');
    draft.notes = val('#obraPremiumNotes');
    container.querySelectorAll('[data-mov-index]').forEach(row => {
      const mov = draft.movimientos && draft.movimientos[Number(row.dataset.movIndex)];
      if (!mov) return;
      const name = (row.querySelector('[data-mov-field="name"]') || {}).value;
      const minutes = Number((row.querySelector('[data-mov-field="duracion"]') || {}).value);
      if (name && name.trim()) mov.name = name.trim();
      const next = Number.isFinite(minutes) && minutes > 0 ? minutes : null;
      // Una duración escrita a mano manda sobre la del catálogo.
      if (next !== mov.duracion || next != null && mov.duracionEstimada) { mov.duracion = next; if (next != null) { mov.duracionEstimada = false; mov.duracionFuente = 'manual'; } }
    });
  }

  function saveDraft(container, st) {
    readDraft(container, st);
    const target = workById(st.id), draft = st.draft;
    if (!target || !draft) return;
    ['name', 'composer', 'duracion', 'notes', 'movimientos'].forEach(key => { target[key] = draft[key]; });
    const typed = Number(String(st.diffInput || '').replace(',', '.'));
    if (Number.isFinite(typed) && typed >= 1 && typed <= 10 && String(st.diffInput) !== String(st.diffShown == null ? '' : st.diffShown)) {
      const dm = root.WorkDifficultyModel;
      target.dificultad = Math.round(typed * 10) / 10;
      target.dificultadFuente = 'manual';
      target.dificultadConfianza = 'high';
      if (dm) { target.dificultadModelo = dm.MODEL_VERSION; try { target.dificultadCarga = Math.round(dm.loadFor(target.dificultad) * 10) / 10; } catch (e) {} }
    }
    persist();
    Object.assign(st, { mode: 'view', draft: null, message: 'Cambios guardados.' });
    render();
    if (st === sheet) paint(sheetContent(), sheet, false);
  }

  function enrich(container, st, isDraft) {
    const cat = root.WorkStructureCatalog;
    if (!cat) return;
    if (isDraft) readDraft(container, st);
    const target = isDraft ? st.draft : workById(st.id);
    if (!target) return;
    const result = cat.completeWorkStructure(target);
    if (!result.structure) st.message = 'Esta obra todavía no está en el catálogo de movimientos.';
    else if (!result.changed) st.message = 'Los movimientos ya tienen los datos disponibles.';
    else {
      if (isDraft) st.draft = result.work;
      else { target.movimientos = result.work.movimientos; persist(); render(); }
      st.message = 'Movimientos completados sin tocar tus datos.';
    }
    paint(container, st, st === pane);
  }

  const hasHistory = mov => ['solHistory', 'paseHistory', 'zoneHistory', 'compasHistory'].some(k => Array.isArray(mov && mov[k]) && mov[k].length);

  function studyWork(id, movId) {
    closeSheet();
    if (root.MobileV2 && typeof root.MobileV2.studyNow === 'function') root.MobileV2.studyNow(id, movId || '');
    else if (typeof root.nudgeStudyNow === 'function') root.nudgeStudyNow(id);
  }

  function onAction(container, st, e) {
    const button = e.target.closest('[data-action]');
    if (!button || !container.contains(button)) return;
    const action = button.dataset.action;
    const inline = st === pane;
    const work = workById(st.id);
    if (action === 'close') return closeSheet();
    if (action === 'edit' && work) {
      const diff = difficultyOf(work);
      Object.assign(st, { mode: 'edit', draft: clone(work), message: '', diffShown: diff ? Math.round(diff.score * 10) / 10 : null });
      return paint(container, st, inline);
    }
    if (action === 'cancel-edit') { Object.assign(st, { mode: 'view', draft: null, message: '' }); return paint(container, st, inline); }
    if (action === 'save') return saveDraft(container, st);
    if (action === 'enrich') return enrich(container, st, false);
    if (action === 'enrich-draft') return enrich(container, st, true);
    if (action === 'add-mov' && st.draft) {
      readDraft(container, st);
      const list = st.draft.movimientos = Array.isArray(st.draft.movimientos) ? st.draft.movimientos : [];
      list.push({ id: 'mv' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: 'Movimiento ' + (list.length + 1), duracion: null, dificultad: 5, sol: 1, solHistory: [], paseHistory: [], zoneHistory: [], compasHistory: [] });
      paint(container, st, inline);
      const inputs = container.querySelectorAll('[data-mov-field="name"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
      return;
    }
    if (action === 'remove-mov' && st.draft) {
      readDraft(container, st);
      const i = Number(button.dataset.index), mov = st.draft.movimientos[i];
      if (!mov) return;
      if (hasHistory(mov) && !root.confirm('«' + (mov.name || 'Este movimiento') + '» tiene historial. ¿Quitarlo igualmente?')) return;
      st.draft.movimientos.splice(i, 1);
      return paint(container, st, inline);
    }
    if (action === 'delete' && work) {
      const before = (data().obras || []).length;
      if (typeof root.confirmDeleteObra === 'function') root.confirmDeleteObra(work.id);
      if ((data().obras || []).length < before) { Object.assign(st, { id: null, mode: 'view', draft: null }); if (!inline) closeSheet(); render(); }
      return;
    }
    if (!work) return;
    if (action === 'study') return studyWork(work.id);
    if (action === 'study-mov') return studyWork(work.id, button.dataset.movId);
    if (action === 'pase' || action === 'pase-mov') {
      if (typeof root.registerPase === 'function') root.registerPase(work.id, action === 'pase-mov' ? button.dataset.movId : undefined);
      return;
    }
    if (action === 'solidity-history') {
      const editor = root.SolidityHistoryEditor;
      if (editor && typeof editor.open === 'function') editor.open(work.id);
      else root.addEventListener('solidity-history-editor-ready', () => root.SolidityHistoryEditor && root.SolidityHistoryEditor.open(work.id), { once: true });
      return;
    }
    if (action === 'archive') openArchive();
  }

  function renderPane() {
    const container = doc.getElementById('obrasDetail');
    if (!container) return;
    if (state.selectedKind === 'history') {
      const d = data();
      const entry = d && (d.historicalRepertoire || []).find(h => String(h.id) === String(state.selectedId));
      container.innerHTML = entry ? historicalDetailHtml(entry) : '<p class="ob3-empty">Elige una obra de la lista.</p>';
      return;
    }
    if (String(pane.id) !== String(state.selectedId)) Object.assign(pane, { id: state.selectedId, mode: 'view', draft: null, message: '' });
    if (pane.mode === 'view') completeMetadata(workById(pane.id));
    paint(container, pane, true);
  }

  /* --- Hoja flotante --- */

  function sheetContent() { return doc.getElementById('obraPremiumContent'); }
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = doc.createElement('div');
    overlay.id = 'obraPremiumOverlay';
    overlay.className = 'ob3-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<section class="ob3-sheet" role="dialog" aria-modal="true" aria-label="Ficha de obra"><div id="obraPremiumContent" class="ob3-card"></div></section>';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });
    const content = overlay.querySelector('#obraPremiumContent');
    content.addEventListener('click', e => onAction(content, sheet, e));
    doc.body.appendChild(overlay);
    return overlay;
  }

  // Al abrir, rellena con el catálogo solo nombres genéricos y duraciones vacías.
  function completeMetadata(work) {
    const cat = root.WorkStructureCatalog;
    if (!cat || !work) return;
    try {
      const result = cat.completeWorkStructure(work);
      if (result && result.changed) { work.movimientos = result.work.movimientos; persist(); }
    } catch (e) {}
  }

  function openSheet(id) {
    const work = workById(id);
    if (!work || work.tipo === 'actividad') return false;
    if (root.WorkDifficultyModel) { try { root.WorkDifficultyModel.enrichEntity(work); } catch (e) {} }
    completeMetadata(work);
    ensureOverlay();
    Object.assign(sheet, { id: work.id, mode: 'view', draft: null, message: '' });
    paint(sheetContent(), sheet, false);
    // Encima de cualquier ventana que la pida (como el selector de obras).
    if (overlay.parentNode !== doc.body || overlay.nextSibling) doc.body.appendChild(overlay);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    doc.body.classList.add('ob3-lock');
    const card = sheetContent();
    if (card) card.scrollTop = 0;
    return true;
  }
  function closeSheet() {
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    doc.body.classList.remove('ob3-lock');
    Object.assign(sheet, { id: null, mode: 'view', draft: null, message: '' });
  }
  function refresh() {
    if (sheet.id && sheet.mode === 'view' && overlay && overlay.classList.contains('open')) paint(sheetContent(), sheet, false);
    const container = doc.getElementById('obrasDetail');
    if (container && pane.mode === 'view' && doc.body.getAttribute('data-view') === 'obras') renderPane();
  }

  /* --- Arranque --- */

  function install() {
    if (!data() || !doc.getElementById('obrasList')) return false;
    const list = doc.getElementById('obrasList');
    if (!list.__ob3) {
      list.__ob3 = true;
      list.addEventListener('click', e => {
        const detail = e.target.closest('#obrasDetail');
        if (detail) return onAction(detail, pane, e);
        onListClick(e);
      });
    }
    const original = { toggleObra: root.toggleObra, openObraFocus: root.openObraFocus };
    root.renderObras = render;
    root.openPremiumWork = openSheet;
    root.closePremiumWork = closeSheet;
    root.refreshPremiumWork = refresh;
    if (typeof original.toggleObra === 'function' && !original.toggleObra.__ob3) {
      const wrapped = function (id) { return openSheet(id) ? undefined : original.toggleObra.apply(this, arguments); };
      wrapped.__ob3 = true;
      root.toggleObra = wrapped;
    }
    if (typeof original.openObraFocus === 'function' && !original.openObraFocus.__ob3) {
      const wrapped = function (event, id) {
        if (event && event.target && event.target.closest && event.target.closest('button,input,select,textarea,a')) return original.openObraFocus.apply(this, arguments);
        return openSheet(id) ? undefined : original.openObraFocus.apply(this, arguments);
      };
      wrapped.__ob3 = true;
      root.openObraFocus = wrapped;
    }
    // Tras registrar una solidez (o cualquier guardado), la ficha abierta se pone al día.
    if (typeof root.saveData === 'function' && !root.saveData.__ob3) {
      const originalSave = root.saveData;
      const patched = function () { const r = originalSave.apply(this, arguments); if (sheet.id || doc.body.getAttribute('data-view') === 'obras') setTimeout(refresh, 0); return r; };
      patched.__ob3 = true;
      Object.keys(originalSave).forEach(k => { patched[k] = originalSave[k]; });
      root.saveData = patched;
    }
    doc.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !overlay || !overlay.classList.contains('open')) return;
      if (doc.querySelector('.modal-overlay.visible')) return; // primero se cierra la ventana de encima
      if (sheet.mode === 'edit') { Object.assign(sheet, { mode: 'view', draft: null }); paint(sheetContent(), sheet, false); }
      else closeSheet();
    });
    let wasWide = isWide();
    root.addEventListener('resize', () => { const w = isWide(); if (w !== wasWide) { wasWide = w; render(); } });
    root.addEventListener('solidity-model-ready', queueRender);
    root.addEventListener('work-difficulty-model-ready', queueRender);
    render();
    return true;
  }
  (function boot(attempt) {
    if (install()) return;
    if (attempt < 100) setTimeout(() => boot(attempt + 1), 80);
  })(0);

  return Object.assign({}, pure, { render, openSheet, closeSheet, refresh, state });
});
