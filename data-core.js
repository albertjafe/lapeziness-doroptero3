(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DataCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function plantKey(p) {
    return (p && (p.obraId || p.tag || '')) + '|' + (p && p.startedAt || '') + '|' + (p && p.endedAt || '');
  }

  function mergePlants(a, b) {
    const out = [], seen = new Set();
    (a || []).concat(b || []).forEach(p => {
      if (!p || !p.startedAt) return;
      const key = p.id || plantKey(p);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(p);
    });
    return out.sort((x, y) => String(x.startedAt).localeCompare(String(y.startedAt)));
  }

  function eventKey(e, fields) {
    if (!e) return '';
    if (e.id) return e.id;
    return fields.map(field => e[field] || '').join('|');
  }

  function mergeEvents(a, b, fields, limit) {
    const out = [], seen = new Set();
    (a || []).concat(b || []).forEach(e => {
      const key = eventKey(e, fields);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(e);
    });
    out.sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
    return limit ? out.slice(-limit) : out;
  }

  function itemRealMinutes(item) {
    if (!item || item.estudiado === false) return 0;
    return Number(item.minutosReales ?? item.min ?? item.minutos ?? 0) || 0;
  }

  function sessionRealMinutes(session) {
    return (session && session.items || []).reduce((sum, item) => sum + itemRealMinutes(item), 0);
  }

  function mergeSessions(a, b) {
    const byDay = new Map();
    const add = session => {
      if (!session || !session.date) return;
      const key = new Date(session.date).toDateString();
      const current = byDay.get(key);
      if (!current || sessionRealMinutes(session) > sessionRealMinutes(current) ||
          (sessionRealMinutes(session) === sessionRealMinutes(current) &&
           (session.items || []).length > (current.items || []).length)) {
        byDay.set(key, session);
      }
    };
    (a || []).forEach(add);
    (b || []).forEach(add);
    return Array.from(byDay.values())
      .sort((x, y) => new Date(y.date) - new Date(x.date))
      .slice(0, 365);
  }

  function mergeTimeAvailableEvents(a, b) {
    const byDay = new Map();
    (a || []).concat(b || []).forEach(event => {
      if (!event) return;
      const key = event.date || event.day || (event.at ? new Date(event.at).toDateString() : '');
      if (!key) return;
      const current = byDay.get(key);
      if (!current || String(event.at || '').localeCompare(String(current.at || '')) >= 0) byDay.set(key, event);
    });
    return Array.from(byDay.values())
      .sort((x, y) => String(x.at || x.date || '').localeCompare(String(y.at || y.date || '')))
      .slice(-2000);
  }

  function mergeStudyHistory(base, other) {
    if (!base) return other;
    if (!other) return base;
    const merged = Object.assign({}, base);
    merged.sessionPlants = mergePlants(base.sessionPlants, other.sessionPlants);
    merged.forestPlants = mergePlants(base.forestPlants, other.forestPlants);
    merged.sesiones = mergeSessions(base.sesiones, other.sesiones);
    merged.estadoEventos = mergeEvents(base.estadoEventos, other.estadoEventos, ['at', 'value', 'label'], 2000);
    merged.deporteEventos = mergeEvents(base.deporteEventos, other.deporteEventos, ['at', 'kind', 'value', 'label'], 2000);
    merged.suenoEventos = mergeEvents(base.suenoEventos, other.suenoEventos, ['at', 'kind'], 2000);
    merged.triggerEventos = mergeEvents(base.triggerEventos, other.triggerEventos, ['at', 'value', 'label'], 2000);
    merged.tiempoDisponibleEventos = mergeTimeAvailableEvents(base.tiempoDisponibleEventos, other.tiempoDisponibleEventos);
    merged.dailyJournalEntries = mergeEvents(base.dailyJournalEntries, other.dailyJournalEntries, ['at', 'text'], 3000);
    return merged;
  }

  return { mergeStudyHistory, mergePlants, mergeSessions, sessionRealMinutes };
});
