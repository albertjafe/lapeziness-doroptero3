/* Concursos repetidos en el calendario (oct 2026).

   El antiguo seed de concursos (competition-planning-seed.js, retirado) se
   ejecutaba al abrir la app sobre un documento a medio cargar: sin la marca
   competitionPlanningSeedVersion, importaba los 21 concursos del dosier con ids
   aleatorios, y al llegar la nube la fusión (por id) sumaba esas copias a las
   que ya había. Así se juntaron cuatro copias de cada concurso y de cada plazo,
   más una quinta de una importación anterior (ids standby_*).

   Aquí se quitan las copias, con el camino normal de borrar un evento
   (tombstone en planningEventTombstones), para que ninguna fusión las resucite:
   - Grupo = mismo planSourceId (el concurso) o mismo parentSourceId + hitoTipo
     (su plazo). Las antiguas standby_* entran en el grupo con la misma fecha y
     título equivalente (o el mismo final, como Leeds).
   - Solo se quitan copias «intactas»: sin obras, repertorio, rondas, notas,
     objetivo de grabación ni resultado, en standby y nunca guardadas a mano.
   - Si alguna copia tiene datos, se quedan todas las que tienen datos y solo
     se quitan las intactas. Si ninguna tiene, se queda la primera por id (las
     del dosier antes que las standby_*): dos dispositivos eligen la misma.
   - Solo corre con el documento completo, tras descargar la nube. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EventDedupe = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DOSSIER = 'dossier-';
  const STOP = new Set(['international', 'piano', 'competition', 'concours', 'musical', 'the', 'de', 'del', 'la', 'el', 'and', 'award',
    'deadline', 'inscripcion', 'video', 'solicitud']);

  const empty = value => value == null || value === '' || value === false ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
  const norm = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = name => norm(name).split(' ').filter(t => t.length > 2 && !STOP.has(t));

  function sharedTokens(a, b) {
    const tb = new Set(tokens(b));
    return tokens(a).filter(t => tb.has(t)).length;
  }
  function sameTitle(a, b) {
    const na = tokens(a).length, nb = tokens(b).length;
    return na > 0 && nb > 0 && sharedTokens(a, b) >= Math.min(2, na, nb);
  }
  // Misma convocatoria: misma fecha (o mismo final) y título equivalente. Con
  // inicio y final idénticos basta una palabra distintiva común (p. ej. «CIPCE»).
  function sameCall(a, b) {
    const start = String(a.fecha || '') === String(b.fecha || '');
    const end = !!a.fechaFin && String(a.fechaFin) === String(b.fechaFin || '');
    if (!start && !end) return false;
    if (sameTitle(a.nombre, b.nombre)) return true;
    return start && end && sharedTokens(a.nombre, b.nombre) >= 1;
  }

  // Datos que solo pone la persona. Las notas que escribió la importación
  // (planningNotes, repertoirePending) no cuentan.
  function pristine(ev) {
    if (!ev || ev.manualSaved === true || ev.completado === true) return false;
    if (ev.estado && ev.estado !== 'standby') return false;
    return ['obras', 'repertorioPlanificado', 'rondas', 'notas', 'notes', 'grabacionObjetivo', 'resultado', 'professorMovements']
      .every(key => empty(ev[key]));
  }

  const isLegacy = ev => /^standby_/.test(String(ev && ev.id || '')) &&
    (ev.eventRole === 'competition' || ev.eventRole === 'application_deadline');

  function groupKey(ev) {
    if (!ev || !ev.id) return '';
    if (!ev.esHito && String(ev.planSourceId || '').startsWith(DOSSIER)) return 'p|' + ev.planSourceId;
    if (ev.esHito && String(ev.parentSourceId || '').startsWith(DOSSIER)) return 'd|' + ev.parentSourceId + '|' + (ev.hitoTipo || '');
    return '';
  }

  const byId = (a, b) => (isLegacy(a) - isLegacy(b)) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

  // Qué ids quitar. No cambia nada.
  function plan(data) {
    const eventos = Array.isArray(data && data.eventos) ? data.eventos : [];
    const groups = new Map();
    eventos.forEach(ev => {
      const key = groupKey(ev);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    });
    // Las standby_* se unen al grupo del mismo concurso (o plazo), misma fecha.
    eventos.filter(isLegacy).forEach(ev => {
      const kind = ev.eventRole === 'competition' ? 'p|' : 'd|';
      for (const [key, list] of groups) {
        if (!key.startsWith(kind)) continue;
        if (sameCall(ev, list[0])) { list.push(ev); return; }
      }
    });

    const remove = [];
    groups.forEach(list => {
      if (list.length < 2) return;
      const withData = list.filter(ev => !pristine(ev));
      if (withData.length) {
        list.filter(pristine).forEach(ev => remove.push(String(ev.id)));
        return;
      }
      list.slice().sort(byId).slice(1).forEach(ev => remove.push(String(ev.id)));
    });
    return { remove, groups: groups.size };
  }

  // Quita las copias del documento y deja su tombstone. Devuelve cuántas quitó.
  function apply(data) {
    const { remove } = plan(data);
    if (!remove.length) return 0;
    const gone = new Set(remove);
    if (!Array.isArray(data.planningEventTombstones)) data.planningEventTombstones = [];
    const known = new Set(data.planningEventTombstones.map(String));
    remove.forEach(id => { if (!known.has(id)) data.planningEventTombstones.push(id); });
    if (data.planningEventTombstones.length > 5000) data.planningEventTombstones = data.planningEventTombstones.slice(-5000);
    data.eventos = data.eventos.filter(ev => !(ev && gone.has(String(ev.id))));
    data.eventProtectionUpdatedAt = new Date().toISOString();
    return remove.length;
  }

  /* ── En la app: tras cada descarga de la nube ─────────────────────── */
  function database() { try { return typeof db !== 'undefined' ? db : root.db; } catch (e) { return root.db; } }

  function run() {
    const data = database();
    if (!data || !Array.isArray(data.eventos)) return 0;
    let n = 0;
    try { n = apply(data); } catch (e) { console.warn('[event-dedupe]', e); return 0; }
    if (!n) return 0;
    try { if (typeof root.saveData === 'function') root.saveData(); } catch (e) {}
    try { if (typeof root.renderCalendario === 'function') root.renderCalendario(); } catch (e) {}
    try { if (root.MobileV2 && typeof root.MobileV2.renderCal === 'function') root.MobileV2.renderCal(); } catch (e) {}
    try { if (typeof root.updateHeader === 'function') root.updateHeader(); } catch (e) {}
    console.info('[event-dedupe] quitadas ' + n + ' copias de concursos y plazos');
    return n;
  }

  if (root.document && root.addEventListener) {
    root.addEventListener('study-cloud-hydrated', run);
    if (root.__studyCloudHydrated) setTimeout(run, 0);
  }

  return { plan, apply, run, pristine, sameTitle, sameCall };
});
