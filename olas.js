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
   día suma las olas, así refleja a la vez intensidad y duración. */
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

  // Línea para la hoja del día: horas e intensidad de cada ola.
  function dayLine(data, key) {
    const list = wavesByDay(data)[key];
    if (!list || !list.length) return '';
    return 'Olas: ' + list.map(w => hhmm(new Date(w.start)) + (w.load > 1 ? ' ×' + w.load : '')).join(', ');
  }

  function cellLabel(key, loads, first, today = dayKey()) {
    const c = dayClass(key, loads, first, today);
    if (c === 'none') return 'sin registro de olas';
    const l = loads[key] || 0;
    return l ? 'olas, carga ' + l : 'día tranquilo';
  }

  /* ── Botón de Hoy ─────────────────────────────────────────────────── */
  const WAVE_SVG = '<svg viewBox="0 0 24 12" width="20" height="10" aria-hidden="true"><path d="M1 7c2.5-4 5-4 7.5 0s5 4 7.5 0 5-4 7-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function hoyButtonHtml() {
    // Siempre igual: Hoy no muestra cuántas llevas (no invita a vigilarlas).
    return '<button type="button" class="mv2-ola" onclick="Olas.tap()" aria-label="Anotar una ola">' + WAVE_SVG + '<span>Ola</span></button>';
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
    const msg = res.taps >= MAX_PER_WAVE ? 'Ola anotada · muy fuerte' : res.taps === 2 ? 'Ola anotada · fuerte' : 'Ola anotada';
    const id = res.rec.id;
    try {
      if (typeof root.showUndoToast === 'function') root.showUndoToast(msg, () => { if (undo(database(), id)) { persist(); if (typeof root.showToast === 'function') root.showToast('Toque quitado'); } }, UNDO_MS);
      else if (typeof root.showToast === 'function') root.showToast(msg);
    } catch (e) {}
    return res;
  }

  return { WAVE_GAP_MS, MAX_PER_WAVE, taps, wavesByDay, loadByDay, firstDay, level, monthSummary, monthLine, dayClass, dayLine, cellLabel, hoyButtonHtml, record, undo, tap };
});
