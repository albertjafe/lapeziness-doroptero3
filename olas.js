/* Olas: registro de un toque para los momentos de TOC u obsesión.
   Apuntar es ponerle nombre («ya está aquí otra vez»), no analizarla: sin
   texto, sin motivo, sin tema y sin número en Hoy. Se mira en el calendario
   (capa «Olas») para ver la tendencia de los días tranquilos.

   Datos: db.olas = [{ id, at }] — solo se añade. «Deshacer» marca el toque
   con `undone: true` (campo nuevo: la fusión lo conserva; nunca se borra un
   registro por ausencia).

   Cada toque es una unidad de ruido. Los toques seguidos (≤ 10 s entre uno y
   el siguiente) son la misma ola y cuentan como mucho 3: un toque = leve,
   tres = muy fuerte. Si dura o vuelve, otro toque más tarde. La carga del
   día suma las olas, así refleja a la vez intensidad y duración.

   Al lado, «Compulsión» (un toque cuando haces algo para calmarla). Ambas
   se comparan por semanas en el calendario: «Esta semana: N olas · M
   compulsiones», con la semana anterior. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Olas = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const WAVE_GAP_MS = 10000;
  const MAX_PER_WAVE = 3;
  const UNDO_MS = 4000;
  const doc = root.document;

  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parseDay = key => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const database = () => { try { return typeof db !== 'undefined' ? db : root.db; } catch (e) { return root.db; } };

  // Toques válidos, en orden. Ignora registros rotos o deshechos.
  function taps(data) {
    return (data && Array.isArray(data.olas) ? data.olas : [])
      .filter(t => t && !t.undone && Number.isFinite(new Date(t.at).getTime()))
      .map(t => ({ id: t.id, time: new Date(t.at).getTime() }))
      .sort((a, b) => a.time - b.time);
  }

  // { 'YYYY-MM-DD': [{ start, taps, load }] } en la hora del dispositivo.
  function wavesByDay(data) {
    const out = {};
    let last = null;
    taps(data).forEach(t => {
      const key = dayKey(new Date(t.time));
      const list = out[key] || (out[key] = []);
      const wave = list[list.length - 1];
      if (wave && last != null && t.time - last <= WAVE_GAP_MS) {
        wave.taps++; wave.load = Math.min(MAX_PER_WAVE, wave.taps);
      } else list.push({ start: t.time, taps: 1, load: 1 });
      last = t.time;
    });
    return out;
  }

  function loadByDay(data) {
    const waves = wavesByDay(data), out = {};
    Object.keys(waves).forEach(k => { out[k] = waves[k].reduce((s, w) => s + w.load, 0); });
    return out;
  }

  // Primer día con algún toque: antes no hay registro (no es «día tranquilo»).
  function firstDay(data) {
    const list = taps(data);
    return list.length ? dayKey(new Date(list[0].time)) : null;
  }

  // Escala del calendario: 0 tranquilo · 1–2 · 3–4 · 5–7 · 8+.
  function level(load) { return !load ? 0 : load <= 2 ? 1 : load <= 4 ? 2 : load <= 7 ? 3 : 4; }

  // Días registrados de un mes (desde el primer toque hasta hoy), tranquilos y media.
  function monthSummary(data, year, month, today = dayKey()) {
    const first = firstDay(data);
    const loads = loadByDay(data);
    const out = { tracked: 0, calm: 0, total: 0, mean: null };
    if (!first) return out;
    const days = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const k = dayKey(new Date(year, month, d, 12));
      if (k < first || k > today) continue;
      out.tracked++;
      const l = loads[k] || 0;
      out.total += l;
      if (!l) out.calm++;
    }
    if (out.tracked) out.mean = out.total / out.tracked;
    return out;
  }

  // Estado de una casilla en la capa Olas: 'none' (sin registro o futuro) u 'o0'…'o4'.
  function dayClass(key, loads, first, today = dayKey()) {
    if (!first || key < first || key > today) return 'none';
    return 'o' + level(loads[key] || 0);
  }

  function fmtMean(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('es-ES', { maximumFractionDigits: 1 }); }

  // Texto bajo el mes en la capa Olas, con el mes anterior para ver la tendencia.
  function monthLine(data, year, month, today = dayKey()) {
    const cur = monthSummary(data, year, month, today);
    if (!cur.tracked) return 'Sin olas registradas este mes';
    const prevDate = new Date(year, month - 1, 1, 12);
    const prev = monthSummary(data, prevDate.getFullYear(), prevDate.getMonth(), today);
    return cur.calm + ' de ' + cur.tracked + ' días tranquilos · media ' + fmtMean(cur.mean) + '/día' +
      (prev.tracked ? ' · mes anterior ' + fmtMean(prev.mean) : '');
  }

  /* ── Compulsiones (05-10-2026) ──────────────────────────────────────
     Un toque cuando haces algo para calmar la ola: preguntar a una IA,
     buscar, comprobar, pedir que te tranquilicen. Sin detalle. Es lo que se
     puede cambiar, así que es lo que se compara semana a semana; no se
     deduce «pasó sola» ni se mide duración (no hay que vigilar la ola).
     Datos: db.compulsiones = [{ id, at }] — solo se añade; «Deshacer» marca
     `undone`. Cada toque cuenta uno. */
  function compulsions(data) {
    return (data && Array.isArray(data.compulsiones) ? data.compulsiones : [])
      .filter(t => t && !t.undone && Number.isFinite(new Date(t.at).getTime()))
      .map(t => ({ id: t.id, time: new Date(t.at).getTime() }))
      .sort((a, b) => a.time - b.time);
  }

  // Lunes 00:00 (hora del dispositivo) de la semana de `d`.
  function weekStart(d = new Date()) {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return s;
  }

  // Olas (no toques) y compulsiones de la semana que empieza en `start`.
  function weekSummary(data, start) {
    const from = start.getTime();
    const to = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7).getTime();
    const inWeek = t => t >= from && t < to;
    const waves = Object.values(wavesByDay(data)).reduce((n, list) => n + list.filter(w => inWeek(w.start)).length, 0);
    return { waves, compulsions: compulsions(data).filter(c => inWeek(c.time)).length };
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // «Esta semana: 12 olas · 4 compulsiones · semana anterior: 15 olas · 7 compulsiones».
  function weekLine(data, now = new Date()) {
    const first = [taps(data)[0], compulsions(data)[0]].filter(Boolean).map(t => t.time);
    if (!first.length) return '';
    const start = weekStart(now);
    const cur = weekSummary(data, start);
    const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
    const prev = Math.min(...first) < start.getTime() ? weekSummary(data, prevStart) : null;
    return 'Esta semana: ' + plural(cur.waves, 'ola', 'olas') + ' · ' + plural(cur.compulsions, 'compulsión', 'compulsiones') +
      (prev ? ' · semana anterior: ' + plural(prev.waves, 'ola', 'olas') + ' · ' + plural(prev.compulsions, 'compulsión', 'compulsiones') : '');
  }

  // Línea para la hoja del día: horas e intensidad de cada ola y horas de las compulsiones.
  function dayLine(data, key) {
    const list = wavesByDay(data)[key] || [];
    const comps = compulsions(data).filter(c => dayKey(new Date(c.time)) === key);
    const parts = [];
    if (list.length) parts.push('Olas: ' + list.map(w => hhmm(new Date(w.start)) + (w.load > 1 ? ' ×' + w.load : '')).join(', '));
    if (comps.length) parts.push('Compulsiones: ' + comps.map(c => hhmm(new Date(c.time))).join(', '));
    return parts.join(' · ');
  }

  function cellLabel(key, loads, first, today = dayKey()) {
    const c = dayClass(key, loads, first, today);
    if (c === 'none') return 'sin registro de olas';
    const l = loads[key] || 0;
    return l ? 'olas, carga ' + l : 'día tranquilo';
  }

  /* ── Botón de Hoy ─────────────────────────────────────────────────── */
  // En reposo el botón es siempre igual: Hoy no muestra cuántas llevas (no
  // invita a vigilarlas). Solo mientras dura la ola (10 s desde el último
  // toque) enseña la intensidad que se está anotando: una, dos o tres crestas
  // y un color más intenso (el aviso dice «fuerte» / «muy fuerte»); luego
  // vuelve sola a la calma. La palabra no cambia: el botón no salta de ancho.
  const LEVEL_NAME = ['', 'leve', 'fuerte', 'muy fuerte'];
  const WAVE_SVG = '<svg viewBox="0 0 24 18" width="24" height="18" aria-hidden="true">' +
    '<path class="w3" pathLength="1" d="M1 5c2.5-3.2 5-3.2 7.5 0s5 3.2 7.5 0 5-3.2 7-.8"/>' +
    '<path class="w2" pathLength="1" d="M1 9.5c2.5-3.6 5-3.6 7.5 0s5 3.6 7.5 0 5-3.6 7-.9"/>' +
    '<path class="w1" pathLength="1" d="M1 14c2.5-4 5-4 7.5 0s5 4 7.5 0 5-4 7-1"/></svg>';
  const live = { level: 0, until: 0, timer: null };

  function currentLevel(now = Date.now()) { return live.level && now < live.until ? live.level : 0; }

  function hoyButtonHtml(level = 0) {
    // Marcado estable (Hoy no rehace el DOM si no cambia); refresh() pinta la ola en curso.
    const l = Math.max(0, Math.min(MAX_PER_WAVE, level | 0));
    return '<button type="button" class="mv2-ola" data-level="' + l + '" onclick="Olas.tap()" aria-label="Anotar una ola">' +
      WAVE_SVG + '<span class="mv2-ola-label">Ola</span></button>';
  }

  function paint(pulse) {
    if (!doc) return;
    const l = currentLevel();
    doc.querySelectorAll('.mv2-ola').forEach(btn => {
      btn.setAttribute('data-level', String(l));
      btn.setAttribute('aria-label', l ? 'Anotar una ola (ahora: ' + LEVEL_NAME[l] + ')' : 'Anotar una ola');
      if (!pulse) return;
      // Se reinicia la animación de la cresta nueva y sale un anillo.
      btn.classList.remove('is-surge'); void btn.offsetWidth; btn.classList.add('is-surge');
      const ring = doc.createElement('span');
      ring.className = 'mv2-ola-ring';
      ring.setAttribute('aria-hidden', 'true');
      ring.addEventListener('animationend', () => ring.remove());
      btn.appendChild(ring);
      setTimeout(() => ring.remove(), 1200);
    });
  }

  function calm() {
    if (live.timer) clearTimeout(live.timer);
    live.level = 0; live.until = 0; live.timer = null;
    paint(false);
  }

  function rise(taps, now = Date.now()) {
    if (live.timer) clearTimeout(live.timer);
    live.level = Math.max(1, Math.min(MAX_PER_WAVE, taps || 1));
    live.until = now + WAVE_GAP_MS;
    live.timer = setTimeout(calm, WAVE_GAP_MS + 50);
    paint(true);
  }

  function newId(now) { return 'ola-' + now.getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  // Añade un toque. Devuelve el registro y cuántos toques lleva la ola actual.
  function record(data, now = new Date()) {
    if (!data) return null;
    if (!Array.isArray(data.olas)) data.olas = [];
    const rec = { id: newId(now), at: now.toISOString() };
    data.olas.push(rec);
    const waves = wavesByDay(data)[dayKey(now)] || [];
    const wave = waves[waves.length - 1];
    return { rec, taps: wave ? wave.taps : 1 };
  }

  function undo(data, id) {
    const rec = data && Array.isArray(data.olas) ? data.olas.find(t => t && t.id === id) : null;
    if (!rec || rec.undone) return false;
    rec.undone = true;
    return true;
  }

  function persist() {
    try { if (typeof root.saveData === 'function') root.saveData(); } catch (e) {}
    try { if (root.MobileV2 && doc && doc.body.getAttribute('data-view') === 'calendario') root.MobileV2.renderCal(); } catch (e) {}
  }

  function tap() {
    const data = database();
    const res = record(data);
    if (!res) return null;
    persist();
    try { if (typeof Haptics !== 'undefined') Haptics.light(); } catch (e) {}
    rise(res.taps);
    const msg = res.taps >= MAX_PER_WAVE ? 'Ola anotada · muy fuerte' : res.taps === 2 ? 'Ola anotada · fuerte' : 'Ola anotada';
    const id = res.rec.id;
    try {
      if (typeof root.showUndoToast === 'function') root.showUndoToast(msg, () => { if (undo(database(), id)) { calm(); persist(); if (typeof root.showToast === 'function') root.showToast('Toque quitado'); } }, UNDO_MS);
      else if (typeof root.showToast === 'function') root.showToast(msg);
    } catch (e) {}
    return res;
  }

  // Botón «Compulsión» de Hoy: discreto y siempre igual (sin contador, sin juicio).
  function compulsionButtonHtml() {
    return '<button type="button" class="mv2-compulsion" onclick="Olas.tapCompulsion()" aria-label="Anotar una compulsión">Compulsión</button>';
  }

  function recordCompulsion(data, now = new Date()) {
    if (!data) return null;
    if (!Array.isArray(data.compulsiones)) data.compulsiones = [];
    const rec = { id: 'comp-' + now.getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 7), at: now.toISOString() };
    data.compulsiones.push(rec);
    return rec;
  }

  function undoCompulsion(data, id) {
    const rec = data && Array.isArray(data.compulsiones) ? data.compulsiones.find(t => t && t.id === id) : null;
    if (!rec || rec.undone) return false;
    rec.undone = true;
    return true;
  }

  function tapCompulsion() {
    const rec = recordCompulsion(database());
    if (!rec) return null;
    persist();
    try { if (typeof Haptics !== 'undefined') Haptics.light(); } catch (e) {}
    try {
      const id = rec.id;
      if (typeof root.showUndoToast === 'function') root.showUndoToast('Compulsión anotada', () => { if (undoCompulsion(database(), id)) { persist(); if (typeof root.showToast === 'function') root.showToast('Toque quitado'); } }, UNDO_MS);
      else if (typeof root.showToast === 'function') root.showToast('Compulsión anotada');
    } catch (e) {}
    return rec;
  }

  return { WAVE_GAP_MS, MAX_PER_WAVE, taps, wavesByDay, loadByDay, firstDay, level, monthSummary, monthLine, dayClass, dayLine, cellLabel, hoyButtonHtml, currentLevel, calm, refresh: () => paint(false), record, undo, tap,
    compulsions, weekStart, weekSummary, weekLine, compulsionButtonHtml, recordCompulsion, undoCompulsion, tapCompulsion };
});
