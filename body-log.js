/* Deporte y sueño: registro mínimo para ver patrones (oct 2026).

   Deporte = tipo (cardio / fuerza) y minutos. Se guarda en db.deporteEventos,
   la misma lista que el antiguo registro por caras (kind cardio/fuerza), ahora
   con `minutes`. Sueño = una respuesta por noche (bien / regular / mal) en
   db.suenoEventos con kind 'noche' (las siestas siguen siendo kind 'siesta').

   A propósito (ver USUARIO.md): en Hoy no hay medias ni números de sueño. La
   pregunta sale por la mañana hasta que se contesta y luego desaparece; las
   tendencias se miran en el calendario y en el informe para la IA. «Deshacer»
   marca el registro con `undone: true` (nunca se borra por ausencia). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BodyLog = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const KINDS = { cardio: 'Cardio', fuerza: 'Fuerza' };
  const QUALITY = { bien: 'Bien', regular: 'Regular', mal: 'Mal' };
  const MINUTES = [15, 20, 30, 45, 60, 90];
  const SLEEP_PROMPT_UNTIL = 16; // después de esta hora ya no se pregunta (el día queda «sin dato»)
  const UNDO_MS = 4000;
  const doc = root.document;

  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const shiftDay = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n, 12)); };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const database = () => { try { return typeof db !== 'undefined' ? db : root.db; } catch (e) { return root.db; } };
  const list = (data, key) => (data && Array.isArray(data[key]) ? data[key] : []);
  const newId = (prefix, now) => prefix + '_' + now.getTime().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const entryDay = e => { const t = new Date(e && e.at); return Number.isFinite(t.getTime()) ? dayKey(t) : null; };
  const fmtMin = m => m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';

  /* ── Datos ────────────────────────────────────────────────────────── */
  // { 'YYYY-MM-DD': { cardio: min, fuerza: min } } — solo registros con minutos.
  function sportByDay(data) {
    const out = {};
    list(data, 'deporteEventos').forEach(e => {
      if (!e || e.undone || !KINDS[e.kind] || !(Number(e.minutes) > 0)) return;
      const key = entryDay(e);
      if (!key) return;
      const day = out[key] || (out[key] = { cardio: 0, fuerza: 0 });
      day[e.kind] += Math.round(Number(e.minutes));
    });
    return out;
  }

  // { 'YYYY-MM-DD': 'bien' | 'regular' | 'mal' } — la última respuesta del día.
  function sleepByDay(data) {
    const out = {}, at = {};
    list(data, 'suenoEventos').forEach(e => {
      if (!e || e.undone || e.kind !== 'noche' || !QUALITY[e.quality]) return;
      const key = entryDay(e);
      if (!key || (at[key] && at[key] > e.at)) return;
      out[key] = e.quality; at[key] = e.at;
    });
    return out;
  }

  function addSport(data, kind, minutes, now = new Date()) {
    const min = Math.round(Number(minutes));
    if (!data || !KINDS[kind] || !(min > 0) || min > 600) return null;
    if (!Array.isArray(data.deporteEventos)) data.deporteEventos = [];
    const rec = { id: newId('deporte_' + kind, now), at: now.toISOString(), date: now.toDateString(), kind, minutes: min, label: KINDS[kind] + ' · ' + fmtMin(min) };
    data.deporteEventos.push(rec);
    return rec;
  }

  function setSleep(data, quality, now = new Date()) {
    if (!data || !QUALITY[quality]) return null;
    if (!Array.isArray(data.suenoEventos)) data.suenoEventos = [];
    const rec = { id: newId('noche', now), at: now.toISOString(), date: now.toDateString(), kind: 'noche', quality, label: 'Dormí ' + QUALITY[quality].toLowerCase() };
    data.suenoEventos.push(rec);
    return rec;
  }

  function undo(data, key, id) {
    const rec = list(data, key).find(e => e && e.id === id);
    if (!rec || rec.undone) return false;
    rec.undone = true;
    return true;
  }

  function sportText(day) {
    if (!day) return '';
    return Object.keys(KINDS).filter(k => day[k] > 0).map(k => KINDS[k].toLowerCase() + ' ' + fmtMin(day[k])).join(' · ');
  }

  // Hoja del día del calendario: «Deporte: cardio 30 min · Sueño: bien».
  function dayLine(data, key) {
    const sport = sportText(sportByDay(data)[key]);
    const sleep = sleepByDay(data)[key];
    return [sport ? 'Deporte: ' + sport : '', sleep ? 'Sueño: ' + QUALITY[sleep].toLowerCase() : ''].filter(Boolean).join(' · ');
  }

  // Para el informe de la IA: los últimos `days` días, con «sin dato» explícito.
  function recent(data, now = new Date(), days = 14) {
    const sport = sportByDay(data), sleep = sleepByDay(data), today = dayKey(now);
    const rows = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = shiftDay(today, -i);
      const s = sport[key] || { cardio: 0, fuerza: 0 };
      rows.push({ day: key, cardio: s.cardio, fuerza: s.fuerza, sleep: sleep[key] || null });
    }
    return {
      days: rows,
      sportDays: rows.filter(r => r.cardio + r.fuerza > 0).length,
      cardioMin: rows.reduce((n, r) => n + r.cardio, 0),
      fuerzaMin: rows.reduce((n, r) => n + r.fuerza, 0),
      sleep: { bien: rows.filter(r => r.sleep === 'bien').length, regular: rows.filter(r => r.sleep === 'regular').length, mal: rows.filter(r => r.sleep === 'mal').length, sinDato: rows.filter(r => !r.sleep).length },
    };
  }

  /* ── Hoy ──────────────────────────────────────────────────────────── */
  const SPORT_ICON = '<span class="mv2-ico" style="--c:#2f9e74" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/><path d="M6 17l4-8h5l3 8M10 9l3 8M13.5 6h2.5"/></svg></span>';
  const SLEEP_ICON = '<span class="mv2-ico" style="--c:#5a67b8" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg></span>';

  // Pregunta del sueño: solo por la mañana y solo hasta contestar.
  function sleepPromptHtml(data, now = new Date()) {
    if (!data || now.getHours() >= SLEEP_PROMPT_UNTIL || sleepByDay(data)[dayKey(now)]) return '';
    return '<div class="mv2-card bl-sleep"><p class="bl-q">' + SLEEP_ICON + '<span>¿Qué tal has dormido?</span></p><div class="bl-choices">' +
      Object.keys(QUALITY).map(q => '<button type="button" class="bl-choice" onclick="BodyLog.tapSleep(\'' + q + '\')">' + QUALITY[q] + '</button>').join('') + '</div></div>';
  }

  function sportCardHtml(data, now = new Date()) {
    const today = sportText(sportByDay(data)[dayKey(now)]);
    return '<div class="mv2-card bl-sport"><div class="bl-sport-head"><span class="mv2-lbl has-ico">' + SPORT_ICON + 'Deporte</span>' +
      '<button type="button" class="mv2-link" onclick="BodyLog.openSport()">＋ Apuntar</button></div>' +
      (today ? '<p class="bl-today">Hoy: ' + esc(today) + '</p>' : '') + '</div>';
  }

  function hoyHtml(data, now = new Date()) {
    return { sleep: sleepPromptHtml(data, now), sport: sportCardHtml(data, now) };
  }

  /* ── Acciones ─────────────────────────────────────────────────────── */
  function persist() {
    try { if (typeof root.saveData === 'function') root.saveData(); } catch (e) {}
    try { if (root.MobileV2 && typeof root.MobileV2.renderHoy === 'function') root.MobileV2.renderHoy(); } catch (e) {}
    try { if (root.MobileV2 && doc && doc.body.getAttribute('data-view') === 'calendario') root.MobileV2.renderCal(); } catch (e) {}
  }
  function haptic() { try { if (typeof Haptics !== 'undefined') Haptics.light(); } catch (e) {} }
  function toastUndo(msg, key, id) {
    try {
      if (typeof root.showUndoToast === 'function') root.showUndoToast(msg, () => { if (undo(database(), key, id)) persist(); }, UNDO_MS);
      else if (typeof root.showToast === 'function') root.showToast(msg);
    } catch (e) {}
  }

  function tapSleep(quality) {
    const rec = setSleep(database(), quality);
    if (!rec) return null;
    haptic(); persist();
    toastUndo('Sueño: ' + QUALITY[quality].toLowerCase(), 'suenoEventos', rec.id);
    return rec;
  }

  const draft = { kind: 'cardio', minutes: 30 };

  function sheetHtml() {
    return '<div class="modal bl-modal" role="dialog" aria-labelledby="blSportTitle">' +
      '<div class="modal-title" id="blSportTitle">Deporte</div>' +
      '<div class="bl-seg" role="radiogroup" aria-label="Tipo">' + Object.keys(KINDS).map(k =>
        '<button type="button" role="radio" data-kind="' + k + '" aria-checked="' + (draft.kind === k) + '" class="' + (draft.kind === k ? 'is-on' : '') + '" onclick="BodyLog.pickKind(\'' + k + '\')">' + KINDS[k] + '</button>').join('') + '</div>' +
      '<div class="bl-mins" role="radiogroup" aria-label="Minutos">' + MINUTES.map(m =>
        '<button type="button" role="radio" data-min="' + m + '" aria-checked="' + (draft.minutes === m) + '" class="' + (draft.minutes === m ? 'is-on' : '') + '" onclick="BodyLog.pickMinutes(' + m + ')">' + m + '</button>').join('') +
        '<label class="bl-other"><span>Otro</span><input id="blSportOther" type="number" inputmode="numeric" min="1" max="600" placeholder="min" value="' + (MINUTES.includes(draft.minutes) ? '' : draft.minutes) + '" oninput="BodyLog.typeMinutes(this.value)"></label></div>' +
      '<div class="modal-buttons bl-actions"><button type="button" class="modal-btn secondary" onclick="BodyLog.closeSport()">Cancelar</button>' +
      '<button type="button" class="modal-btn primary" onclick="BodyLog.saveSport()">Guardar</button></div></div>';
  }

  function paintSheet() {
    const el = doc && doc.getElementById('modalBodySport');
    if (el) el.innerHTML = sheetHtml();
  }

  function openSport() {
    if (!doc) return;
    let el = doc.getElementById('modalBodySport');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'modalBodySport'; el.className = 'modal-overlay';
      el.addEventListener('click', e => { if (e.target === el) closeSport(); });
      doc.body.appendChild(el);
    }
    paintSheet();
    if (typeof root.openModal === 'function') root.openModal('modalBodySport');
    else el.classList.add('visible');
  }
  function closeSport() {
    if (typeof root.closeModal === 'function') root.closeModal('modalBodySport');
    else { const el = doc && doc.getElementById('modalBodySport'); if (el) el.classList.remove('visible'); }
  }
  function pickKind(kind) { if (KINDS[kind]) { draft.kind = kind; paintSheet(); } }
  function pickMinutes(m) { draft.minutes = m; paintSheet(); }
  function typeMinutes(value) {
    const m = Math.round(Number(value));
    if (m > 0) draft.minutes = m;
    doc.querySelectorAll('#modalBodySport .bl-mins [data-min]').forEach(b => { const on = Number(b.dataset.min) === draft.minutes; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
  }
  function saveSport() {
    const rec = addSport(database(), draft.kind, draft.minutes);
    if (!rec) { if (typeof root.showToast === 'function') root.showToast('Elige los minutos'); return null; }
    closeSport(); haptic(); persist();
    toastUndo('Deporte anotado · ' + rec.label.toLowerCase(), 'deporteEventos', rec.id);
    return rec;
  }

  return { KINDS, QUALITY, MINUTES, dayKey, sportByDay, sleepByDay, addSport, setSleep, undo, dayLine, recent, hoyHtml, sleepPromptHtml, sportCardHtml,
    tapSleep, openSport, closeSport, pickKind, pickMinutes, typeMinutes, saveSport };
});
