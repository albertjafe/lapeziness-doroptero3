(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ActivityCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const BROWSER_RE = /(chrome|msedge|edge|firefox|brave|vivaldi|opera|arc)(\.exe)?$/i;
  const CATEGORY_LABELS = {
    productive: 'Productivo',
    piano: 'Piano',
    ai: 'IA',
    communication: 'Comunicación',
    social: 'Social',
    entertainment: 'Entretenimiento',
    browsing: 'Navegación',
    private: 'Privado',
    other: 'Otro',
  };

  function seconds(row) {
    const explicit = Number(row && row.duration_seconds);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    const start = new Date(row && row.started_at).getTime();
    const end = new Date(row && row.ended_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
    return Math.max(0, (end - start) / 1000);
  }

  function startMs(row) {
    const value = new Date(row && row.started_at).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function endMs(row) {
    const value = new Date(row && row.ended_at).getTime();
    return Number.isFinite(value) ? value : startMs(row) + seconds(row) * 1000;
  }

  function isBrowserApp(app) {
    const raw = String(app || '').trim();
    return BROWSER_RE.test(raw) || /Google Chrome|Microsoft Edge|Mozilla Firefox|Brave/i.test(raw);
  }

  function overlapSeconds(a, b) {
    const start = Math.max(startMs(a), startMs(b));
    const end = Math.min(endMs(a), endMs(b));
    return Math.max(0, (end - start) / 1000);
  }

  function browserWindowCovered(row, webRows) {
    const own = Math.max(0.1, seconds(row));
    let covered = 0;
    for (const web of webRows) {
      if (String(web.device_id || '') !== String(row.device_id || '')) continue;
      covered += overlapSeconds(row, web);
      if (covered / own >= 0.45) return true;
    }
    return false;
  }

  function canonicalize(rows) {
    const source = (Array.isArray(rows) ? rows : []).filter(row => {
      if (!row || seconds(row) <= 0) return false;
      // AFK es una capa paralela de ActivityWatch: tanto `active` como `afk`
      // solapan las ventanas. Nunca entra en el tiempo rastreado normal.
      if (String(row.source || '') === 'activitywatch_afk') return false;
      return !row.is_afk;
    });
    const webRows = source.filter(row => String(row.source || '') === 'activitywatch_web');
    return source.filter(row => {
      if (String(row.source || '') !== 'activitywatch_window') return true;
      if (!isBrowserApp(row.app)) return true;
      return !browserWindowCovered(row, webRows);
    }).sort((a, b) => startMs(a) - startMs(b) || endMs(a) - endMs(b));
  }

  function rowKey(row) {
    return [
      row && row.device_id || '',
      row && row.category || 'other',
      row && row.app || '',
      row && row.domain || '',
      row && row.label || '',
    ].join('|');
  }

  function mergeAdjacent(rows, maxGapSeconds) {
    const gapLimit = Number.isFinite(Number(maxGapSeconds)) ? Math.max(0, Number(maxGapSeconds)) : 20;
    const sorted = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => startMs(a) - startMs(b));
    const out = [];
    for (const row of sorted) {
      const copy = Object.assign({}, row);
      copy.duration_seconds = seconds(copy);
      const last = out[out.length - 1];
      const gap = last ? (startMs(copy) - endMs(last)) / 1000 : Infinity;
      if (last && rowKey(last) === rowKey(copy) && gap >= -2 && gap <= gapLimit) {
        if (endMs(copy) > endMs(last)) last.ended_at = copy.ended_at;
        last.duration_seconds = Math.max(0, (endMs(last) - startMs(last)) / 1000);
        continue;
      }
      out.push(copy);
    }
    return out;
  }

  function add(map, key, value) {
    const clean = String(key || '').trim();
    if (!clean) return;
    map[clean] = (map[clean] || 0) + value;
  }

  function top(map, limit) {
    return Object.entries(map || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(1, Number(limit) || 5))
      .map(([name, totalSeconds]) => ({ name, seconds: totalSeconds }));
  }

  function summarize(rows) {
    const all = Array.isArray(rows) ? rows : [];
    const idleSeconds = all
      .filter(row => row && String(row.source || '') === 'activitywatch_afk' && row.is_afk)
      .reduce((total, row) => total + seconds(row), 0);
    const canonical = canonicalize(all);
    const timeline = mergeAdjacent(canonical, 25);
    const categories = {};
    const apps = {};
    const domains = {};
    let trackedSeconds = 0;
    let switches = 0;
    let previous = '';
    let longest = null;

    for (const row of timeline) {
      const duration = seconds(row);
      trackedSeconds += duration;
      add(categories, row.category || 'other', duration);
      add(apps, row.app || (row.domain ? 'Navegador' : 'Otro'), duration);
      if (row.domain) add(domains, row.domain, duration);
      const key = rowKey(row);
      if (previous && key !== previous) switches += 1;
      previous = key;
      if (!longest || duration > longest.seconds) longest = { row, seconds: duration };
    }

    return {
      trackedSeconds,
      idleSeconds,
      switches,
      categories,
      topApps: top(apps, 6),
      topDomains: top(domains, 6),
      longest,
      timeline,
      eventCount: timeline.length,
    };
  }

  function formatDuration(value) {
    const total = Math.max(0, Math.round(Number(value) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    if (hours && minutes) return `${hours} h ${minutes} min`;
    if (hours) return `${hours} h`;
    return `${minutes} min`;
  }

  function categoryLabel(value) {
    return CATEGORY_LABELS[value] || CATEGORY_LABELS.other;
  }

  return {
    seconds,
    isBrowserApp,
    canonicalize,
    mergeAdjacent,
    summarize,
    formatDuration,
    categoryLabel,
  };
});
