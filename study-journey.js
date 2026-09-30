/* Jornada de estudio: cómo se reparte el día entre el primer tramo y el
   último. «Estudio ÷ (primer inicio → último fin)» daba ~40 %, pero casi todo
   lo que falta son huecos largos (comida, viajes, clases… o tiempo perdido) y
   con esa cifra no se distingue una cosa de otra. Aquí se separa:
   - cuándo empiezas y cuánto tardas en llegar a 4 h desde que empiezas;
   - el ritmo dentro de los bloques (pausas de menos de 45 min): lo que cambia
     si no coges el móvil en los descansos;
   - los huecos de 45 min o más, que se marcan con un toque (comida, viaje o
     recado, clase, «se me fue»): solo cuenta como perdido lo que tú marcas.
   Los minutos salen de DailyStudyMinutes (los mismos que el anillo de 4 h);
   el ritmo usa minutos reales (sin ponderar), porque mide uso del tiempo. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudyJourney = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const GAP_MIN = 45;
  const GOAL_MIN = 240;
  const WINDOW_DAYS = 14;
  const TAGS = [
    ['comida', 'Comida'],
    ['viaje', 'Viaje/recado'],
    ['clase', 'Clase'],
    ['perdido', 'Se me fue'],
  ];
  const TAG_LABEL = Object.fromEntries(TAGS);
  const doc = root.document || null;

  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const minuteKey = ms => { const d = new Date(ms); return dayKey(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const clock = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const clockOfDay = min => pad(Math.floor(min / 60) % 24) + ':' + pad(Math.round(min % 60));
  function keyAt(key, offset) {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + offset));
  }
  function median(list) {
    if (!list.length) return null;
    const s = list.slice().sort((a, b) => a - b), mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function fmtDur(min) {
    const m = Math.max(0, Math.round(min));
    const h = Math.floor(m / 60), r = m % 60;
    return h ? h + ' h' + (r ? ' ' + pad(r) : '') : r + ' min';
  }
  const fmtHours = min => (Math.round(min / 6) / 10).toLocaleString('es-ES') + ' h';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

  /* ── Cálculo (puro) ─────────────────────────────────────────────── */

  // Bloques de un día → jornada. Los bloques sin hora (registros de sesión sin
  // tramo) cuentan en el total, pero no se pueden colocar en el día.
  function journey(blocks, tags) {
    const timed = [];
    let total = 0, untimed = 0;
    (blocks || []).forEach(b => {
      const mins = Math.max(0, Number(b && b.mins) || 0);
      total += mins;
      const start = Date.parse(b && b.startedAt || '');
      if (!Number.isFinite(start)) { untimed += mins; return; }
      const raw = Math.max(0, Number(b.rawMins ?? b.mins) || 0);
      let end = Date.parse(b.endedAt || '');
      if (!Number.isFinite(end) || end < start) end = start + raw * 60000;
      timed.push({ start, end, mins, raw });
    });
    if (!timed.length) return { total, untimed, timed: 0 };
    timed.sort((a, b) => a.start - b.start);

    // Llegar a 4 h: minutos ponderados en orden, como el anillo.
    let acc = untimed, reachAt = acc >= GOAL_MIN ? timed[0].start : null;
    for (const t of timed) {
      if (reachAt != null) break;
      if (acc + t.mins >= GOAL_MIN && t.mins > 0) reachAt = t.start + (GOAL_MIN - acc) / t.mins * (t.end - t.start);
      acc += t.mins;
    }

    // Tramos solapados cuentan una vez; los huecos se miden entre tramos.
    const gaps = [];
    let shortBreak = 0, raw = 0, curEnd = timed[0].end;
    timed.forEach((t, i) => {
      raw += t.raw;
      if (i && t.start > curEnd) {
        const min = (t.start - curEnd) / 60000;
        if (min >= GAP_MIN) {
          const key = minuteKey(curEnd);
          gaps.push({ key, from: curEnd, to: t.start, min, tag: tags && tags[key] && tags[key].tag || null });
        } else shortBreak += min;
      }
      curEnd = Math.max(curEnd, t.end);
    });
    const first = timed[0].start, last = curEnd;
    const span = (last - first) / 60000;
    const longGap = gaps.reduce((s, g) => s + g.min, 0);
    const active = Math.max(1, span - longGap);
    return {
      total, untimed, timed: timed.length, first, last, span, raw,
      reachAt, toReach: reachAt != null ? (reachAt - first) / 60000 : null,
      rhythm: Math.min(1, raw / active), shortBreak, longGap, gaps,
    };
  }

  function byDay(blocks) {
    const out = {};
    (blocks || []).forEach(b => { if (b && b.date) (out[b.date] = out[b.date] || []).push(b); });
    return out;
  }

  // Resumen de un tramo de días [fromKey, toKey] (ambos incluidos).
  function summary(days, fromKey, toKey) {
    const list = Object.keys(days).filter(k => k >= fromKey && k <= toKey).map(k => days[k]).filter(j => j.timed);
    const starts = list.map(j => { const d = new Date(j.first); return d.getHours() * 60 + d.getMinutes(); });
    const reached = list.filter(j => j.toReach != null);
    const raw = list.reduce((s, j) => s + j.raw, 0);
    const active = list.reduce((s, j) => s + Math.max(1, j.span - j.longGap), 0);
    const byTag = {};
    let untagged = 0;
    list.forEach(j => j.gaps.forEach(g => { if (g.tag) byTag[g.tag] = (byTag[g.tag] || 0) + g.min; else untagged += g.min; }));
    const n = list.length;
    return {
      days: n,
      start: median(starts),
      toReach: median(reached.map(j => j.toReach)),
      reached: reached.length,
      rhythm: active > 0 && n ? raw / active : null,
      longGapPerDay: n ? list.reduce((s, j) => s + j.longGap, 0) / n : null,
      lostPerDay: n ? (byTag.perdido || 0) / n : null,
      byTag, untagged,
    };
  }

  function daysFromDb(d, now, spanDays) {
    const api = root.DailyStudyMinutes;
    if (!d || !api || typeof api.minutesByDay !== 'function') return {};
    const end = new Date(now); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1);
    const start = new Date(end); start.setDate(start.getDate() - (spanDays || 120));
    const blocks = api.minutesByDay(start, end, d, true);
    const tags = d.studyGapTags || {};
    const grouped = byDay(blocks);
    const out = {};
    Object.keys(grouped).forEach(k => { out[k] = journey(grouped[k], tags); });
    return out;
  }

  // El hábito con el que comparar: el principal en curso o, si no hay, el
  // último que empezó en los 60 días anteriores.
  function habitToCompare(d, todayKey) {
    const list = (d && d.habitChallenges || []).filter(h => h && h.startDate && !h.reopenOf && !h.deletedAt);
    const recent = list.filter(h => h.startDate <= keyAt(todayKey, -3) && h.startDate >= keyAt(todayKey, -60))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    return recent[0] || null;
  }

  function report(d, now) {
    const today = dayKey(now);
    const days = daysFromDb(d, now);
    const yesterday = keyAt(today, -1);
    const cur = summary(days, keyAt(today, -WINDOW_DAYS), yesterday);
    const prev = summary(days, keyAt(today, -2 * WINDOW_DAYS), keyAt(today, -WINDOW_DAYS - 1));
    const habit = habitToCompare(d, today);
    let habitCmp = null;
    if (habit) {
      habitCmp = {
        habit,
        before: summary(days, keyAt(habit.startDate, -WINDOW_DAYS), keyAt(habit.startDate, -1)),
        after: summary(days, habit.startDate, yesterday),
      };
    }
    const recentGaps = [];
    for (let i = 0; i <= 7; i++) {
      const k = keyAt(today, -i);
      if (days[k] && days[k].gaps) days[k].gaps.forEach(g => recentGaps.push(Object.assign({ day: k }, g)));
    }
    recentGaps.sort((a, b) => b.from - a.from);
    return { today, days, cur, prev, habitCmp, recentGaps, todayJourney: days[today] || null };
  }

  /* ── Interfaz ───────────────────────────────────────────────────── */

  function database() { try { return typeof db !== 'undefined' ? db : root.db; } catch (e) { return root.db; } }

  function tagButtons(gap) {
    return '<span class="sj-tags" role="group" aria-label="Qué fue">' + TAGS.map(([id, label]) =>
      '<button type="button" class="sj-tag' + (gap.tag === id ? ' is-on' : '') + (id === 'perdido' ? ' is-lost' : '') +
      '" onclick="StudyJourney.tag(\'' + gap.key + '\',\'' + id + '\')">' + label + '</button>').join('') + '</span>';
  }

  function gapLine(gap, withDay) {
    const day = withDay ? new Date(gap.from).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }) + ' · ' : '';
    return '<b>Hueco de ' + fmtDur(gap.min) + '</b> <span>' + day + clock(gap.from) + '–' + clock(gap.to) + '</span>';
  }

  // Hoy: el último hueco largo de hoy sin marcar, cuando ya has vuelto a estudiar.
  function hoyPromptHtml() {
    const d = database();
    if (!d) return '';
    // Solo hoy: Hoy se repinta a menudo y no necesita el historial.
    const now = new Date();
    const today = daysFromDb(d, now, 1)[dayKey(now)];
    const gap = today && today.gaps && today.gaps.filter(g => !g.tag).pop();
    if (!gap) return '';
    return '<div class="mv2-card sj-prompt"><p>' + gapLine(gap, false) + ' · ¿qué fue?</p>' + tagButtons(gap) + '</div>';
  }

  function delta(before, after, better, fmt) {
    if (before == null || after == null) return '';
    const diff = after - before;
    if (Math.abs(diff) < 1e-9) return '<em>=</em>';
    const good = better === 'up' ? diff > 0 : diff < 0;
    return '<em class="' + (good ? 'is-good' : 'is-bad') + '">' + (diff > 0 ? '▲' : '▼') + ' ' + fmt(Math.abs(diff)) + '</em>';
  }

  function stat(label, value, sub) {
    return '<div class="sj-stat"><span>' + label + '</span><strong>' + value + '</strong><small>' + (sub || '&nbsp;') + '</small></div>';
  }

  const pct = v => v == null ? '—' : Math.round(v * 100) + ' %';
  const pts = v => Math.round(v * 100) + ' pts';

  function compareRow(label, a, b) {
    const cells = [
      ['Empiezas', a.start == null ? '—' : clockOfDay(a.start), b.start == null ? '—' : clockOfDay(b.start), delta(a.start, b.start, 'down', fmtDur)],
      ['4 h en', a.toReach == null ? '—' : fmtDur(a.toReach), b.toReach == null ? '—' : fmtDur(b.toReach), delta(a.toReach, b.toReach, 'down', fmtDur)],
      ['Ritmo', pct(a.rhythm), pct(b.rhythm), delta(a.rhythm, b.rhythm, 'up', pts)],
      ['Huecos largos', a.longGapPerDay == null ? '—' : fmtHours(a.longGapPerDay) + '/día', b.longGapPerDay == null ? '—' : fmtHours(b.longGapPerDay) + '/día', delta(a.longGapPerDay, b.longGapPerDay, 'down', fmtHours)],
    ];
    return '<div class="sj-compare"><div class="sj-compare-title">' + label + '</div>' +
      cells.map(c => '<div class="sj-row"><span>' + c[0] + '</span><span>' + c[1] + '</span><span>→ ' + c[2] + '</span>' + c[3] + '</div>').join('') + '</div>';
  }

  function statsCard() {
    const d = database();
    if (!d) return '';
    const r = report(d, new Date());
    const c = r.cur;
    if (!c.days) return '';
    const shortDate = key => { const [y, m, dd] = key.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); };
    let html = '<div class="stats-card sj-card"><div class="stats-card-title">Jornada · últimos ' + WINDOW_DAYS + ' días</div>' +
      '<div class="sj-stats">' +
        stat('Empiezas', c.start == null ? '—' : clockOfDay(c.start), 'mediana') +
        stat('4 h en', c.toReach == null ? '—' : fmtDur(c.toReach), c.reached + ' de ' + c.days + ' días') +
        stat('Ritmo en bloques', pct(c.rhythm), 'pausas < ' + GAP_MIN + ' min') +
        stat('Huecos largos', fmtHours(c.longGapPerDay) + '/día', c.lostPerDay ? fmtHours(c.lostPerDay) + ' «se me fue»' : '&nbsp;') +
      '</div>';
    const tagged = Object.keys(c.byTag);
    if (tagged.length || c.untagged) {
      html += '<div class="sj-split">' + TAGS.filter(([id]) => c.byTag[id]).map(([id, label]) =>
        '<span class="sj-chip' + (id === 'perdido' ? ' is-lost' : '') + '">' + label + ' ' + fmtHours(c.byTag[id] / c.days) + '/día</span>').join('') +
        (c.untagged ? '<span class="sj-chip is-open">Sin marcar ' + fmtHours(c.untagged / c.days) + '/día</span>' : '') + '</div>';
    }
    if (r.habitCmp && r.habitCmp.after.days && r.habitCmp.before.days) {
      const h = r.habitCmp.habit;
      html += compareRow('Desde «' + esc(h.title || 'hábito') + '» (' + shortDate(h.startDate) + ', ' + r.habitCmp.after.days + ' d) frente a los ' + r.habitCmp.before.days + ' días de antes', r.habitCmp.before, r.habitCmp.after);
    } else if (r.prev.days) {
      html += compareRow('Frente a los ' + WINDOW_DAYS + ' días anteriores', r.prev, c);
    }
    if (r.recentGaps.length) {
      const open = r.recentGaps.filter(g => !g.tag).length;
      // Plegada: se abre para marcar; cada hueco en una fila compacta.
      html += '<details class="sj-gaps"><summary>Huecos de esta semana' + (open ? ' · <b>' + open + ' sin marcar</b>' : '') + '</summary><ul>' +
        r.recentGaps.slice(0, 12).map(g => '<li><p>' + gapLine(g, true) + '</p>' + tagButtons(g) + '</li>').join('') + '</ul></details>';
    }
    html += '<p class="sj-note">Hueco largo = pausa de ' + GAP_MIN + ' min o más entre dos tramos. El ritmo es estudio ÷ tiempo entre tramos sin contar esos huecos; marcarlos separa lo inevitable de lo que se fue.</p></div>';
    return html;
  }

  function tag(key, value) {
    const d = database();
    if (!d || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(key) || !TAG_LABEL[value]) return false;
    d.studyGapTags = Object.assign({}, d.studyGapTags);
    const same = d.studyGapTags[key] && d.studyGapTags[key].tag === value;
    // Tocar la misma etiqueta otra vez la quita (por si fue un error).
    if (same) delete d.studyGapTags[key];
    else d.studyGapTags[key] = { tag: value, at: new Date().toISOString() };
    try { if (typeof root.saveData === 'function') root.saveData(); } catch (e) {}
    try { if (typeof root.showToast === 'function') root.showToast(same ? 'Marca quitada' : 'Hueco marcado: ' + TAG_LABEL[value]); } catch (e) {}
    try { root.MobileV2 && root.MobileV2.renderHoy && root.MobileV2.renderHoy(); } catch (e) {}
    try {
      const stats = doc && doc.getElementById('statsDashboard');
      if (stats && stats.offsetParent !== null && typeof root.renderStatsDashboard === 'function') root.renderStatsDashboard();
    } catch (e) {}
    return true;
  }

  return { GAP_MIN, GOAL_MIN, WINDOW_DAYS, TAGS, journey, byDay, summary, report, habitToCompare, hoyPromptHtml, statsCard, tag };
});
