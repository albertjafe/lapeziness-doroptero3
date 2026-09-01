(function activityDashboard() {
  'use strict';

  const CARD_ID = 'activityDailyCard';
  const MODAL_ID = 'activityTimelineModal';
  const state = { date: '', rows: [], summary: null, loading: false, error: '' };

  function todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatClock(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  function injectStyle() {
    if (document.getElementById('activityDashboardStyle')) return;
    const style = document.createElement('style');
    style.id = 'activityDashboardStyle';
    style.textContent = `
      .activity-daily-card{margin:14px 0 18px;padding:17px 18px;border:1px solid var(--border);border-radius:20px;background:var(--bg2);color:var(--text)}
      .activity-daily-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
      .activity-daily-kicker{font:600 9px/1.2 'JetBrains Mono',monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--text3)}
      .activity-daily-title{margin-top:5px;font-size:16px;font-weight:650;color:var(--text)}
      .activity-daily-sub{margin-top:4px;font-size:10px;line-height:1.45;color:var(--text3);max-width:680px}
      .activity-daily-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
      .activity-daily-btn{min-height:34px;padding:0 11px;border:1px solid var(--border);border-radius:11px;background:transparent;color:var(--text2);font-size:10px;cursor:pointer}
      .activity-daily-btn.primary{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));color:var(--accent)}
      .activity-daily-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}
      .activity-daily-metric{min-width:0;padding:11px 12px;border-radius:14px;background:var(--bg3);border:1px solid color-mix(in srgb,var(--border) 82%,transparent)}
      .activity-daily-metric span{display:block;font:500 8px/1.2 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)}
      .activity-daily-metric strong{display:block;margin-top:6px;font:650 15px/1.1 'JetBrains Mono',monospace;color:var(--text)}
      .activity-daily-bars{display:grid;gap:7px;margin-top:13px}
      .activity-daily-bar{display:grid;grid-template-columns:92px minmax(0,1fr) 64px;align-items:center;gap:9px;font-size:10px;color:var(--text2)}
      .activity-daily-bar-track{height:7px;border-radius:999px;background:var(--bg3);overflow:hidden}
      .activity-daily-bar-track i{display:block;height:100%;border-radius:inherit;background:var(--accent);opacity:.72}
      .activity-daily-bar-time{text-align:right;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3)}
      .activity-daily-empty{margin-top:13px;padding:12px 13px;border:1px dashed var(--border);border-radius:14px;color:var(--text3);font-size:10px;line-height:1.55}
      .activity-daily-note{margin-top:10px;font-size:9px;line-height:1.5;color:var(--text3)}
      .activity-timeline-overlay{position:fixed;inset:0;z-index:10220;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(10,12,16,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
      .activity-timeline-overlay.open{display:flex}
      .activity-timeline-sheet{width:min(760px,100%);max-height:min(88vh,900px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--border);border-radius:22px;background:var(--bg);box-shadow:0 28px 90px rgba(0,0,0,.32)}
      .activity-timeline-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px;border-bottom:1px solid var(--border)}
      .activity-timeline-head h2{margin:3px 0 0;font-size:24px;font-weight:600}
      .activity-timeline-close{width:40px;height:40px;border:1px solid var(--border);border-radius:50%;background:transparent;color:var(--text);font-size:22px;cursor:pointer}
      .activity-timeline-list{overflow:auto;padding:12px 20px 20px}
      .activity-timeline-row{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid color-mix(in srgb,var(--border) 72%,transparent)}
      .activity-timeline-time{font:500 9px/1.25 'JetBrains Mono',monospace;color:var(--text3)}
      .activity-timeline-name{font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .activity-timeline-meta{margin-top:3px;font-size:9px;color:var(--text3)}
      .activity-timeline-duration{font:550 9px/1 'JetBrains Mono',monospace;color:var(--text2)}
      @media(max-width:680px){.activity-daily-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.activity-daily-head{display:block}.activity-daily-actions{justify-content:flex-start;margin-top:10px}.activity-daily-bar{grid-template-columns:78px minmax(0,1fr) 55px}.activity-timeline-row{grid-template-columns:76px minmax(0,1fr)}}
    `;
    document.head.appendChild(style);
  }

  function databaseClient() {
    try { return typeof window.getSB === 'function' ? window.getSB() : null; } catch (error) { return null; }
  }

  async function fetchRows(date) {
    const sb = databaseClient();
    if (!sb) throw new Error('Supabase no está disponible todavía.');
    const result = await sb.from('activity_events')
      .select('device_id,device_type,source,started_at,ended_at,local_date,app,domain,category,label,is_afk')
      .eq('local_date', date)
      .order('started_at', { ascending: true })
      .limit(5000);
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
  }

  function categorySeconds(summary, keys) {
    return (keys || []).reduce((total, key) => total + Number(summary && summary.categories && summary.categories[key] || 0), 0);
  }

  function renderBars(summary) {
    const categories = Object.entries(summary.categories || {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const max = categories.length ? categories[0][1] : 1;
    return categories.slice(0, 5).map(([key, value]) => (
      `<div class="activity-daily-bar"><span>${esc(window.ActivityCore.categoryLabel(key))}</span>` +
      `<div class="activity-daily-bar-track"><i style="width:${Math.max(2, Math.round(value / max * 100))}%"></i></div>` +
      `<span class="activity-daily-bar-time">${esc(window.ActivityCore.formatDuration(value))}</span></div>`
    )).join('');
  }

  function cardMarkup() {
    const summary = state.summary;
    if (state.loading) return '<div class="activity-daily-empty">Leyendo la actividad digital de hoy…</div>';
    if (state.error) return `<div class="activity-daily-empty">No he podido leer la actividad: ${esc(state.error)}<br>Tu estudio y el resto de la app siguen funcionando con normalidad.</div>`;
    if (!summary || !summary.trackedSeconds) {
      return '<div class="activity-daily-empty"><strong>Tracker preparado.</strong> Todavía no hay actividad digital recibida hoy. En Windows, ActivityWatch + nuestro sincronizador enviarán solo programa, dominio reducido, categoría y duración; los títulos y URLs completas se quedan en tu ordenador.</div>';
    }
    const focused = categorySeconds(summary, ['productive', 'piano', 'ai']);
    const leisure = categorySeconds(summary, ['social', 'entertainment']);
    const privateTime = categorySeconds(summary, ['private']);
    return [
      '<div class="activity-daily-metrics">',
      `<div class="activity-daily-metric"><span>Actividad registrada</span><strong>${esc(window.ActivityCore.formatDuration(summary.trackedSeconds))}</strong></div>`,
      `<div class="activity-daily-metric"><span>Productivo + IA</span><strong>${esc(window.ActivityCore.formatDuration(focused))}</strong></div>`,
      `<div class="activity-daily-metric"><span>Social + ocio</span><strong>${esc(window.ActivityCore.formatDuration(leisure))}</strong></div>`,
      `<div class="activity-daily-metric"><span>Cambios de contexto</span><strong>${summary.switches}</strong></div>`,
      '</div>',
      `<div class="activity-daily-bars">${renderBars(summary)}</div>`,
      privateTime ? `<div class="activity-daily-note">Hay ${esc(window.ActivityCore.formatDuration(privateTime))} marcados como privados: se cuenta el tiempo, pero no se guarda el sitio visitado.</div>` : '',
    ].join('');
  }

  function renderCard() {
    const card = document.getElementById(CARD_ID);
    if (!card) return;
    card.innerHTML = [
      '<div class="activity-daily-head"><div>',
      '<div class="activity-daily-kicker">Actividad digital · contexto del día</div>',
      '<div class="activity-daily-title">Qué pasó fuera del piano</div>',
      '<div class="activity-daily-sub">Sirve como contexto para el informe; muestra coincidencias y distribución del tiempo, no afirma por sí solo por qué un día fue bueno o malo.</div>',
      '</div><div class="activity-daily-actions">',
      '<button type="button" class="activity-daily-btn" data-activity-refresh>Actualizar</button>',
      '<button type="button" class="activity-daily-btn primary" data-activity-detail>Ver línea temporal</button>',
      '</div></div>',
      cardMarkup(),
    ].join('');
    const refresh = card.querySelector('[data-activity-refresh]');
    if (refresh) refresh.addEventListener('click', () => loadDay(state.date || todayKey(), true));
    const detail = card.querySelector('[data-activity-detail]');
    if (detail) {
      detail.disabled = !(state.summary && state.summary.timeline && state.summary.timeline.length);
      detail.addEventListener('click', openTimeline);
    }
  }

  function ensureCard() {
    if (document.getElementById(CARD_ID)) return true;
    const anchor = document.getElementById('sessionResumenCard');
    if (!anchor) return false;
    const card = document.createElement('section');
    card.id = CARD_ID;
    card.className = 'activity-daily-card';
    card.setAttribute('aria-label', 'Actividad digital de hoy');
    anchor.insertAdjacentElement('afterend', card);
    renderCard();
    const weekly = document.getElementById('sessionWeeklyPlanner');
    if (weekly) {
      const syncVisibility = () => { card.hidden = !weekly.hidden; };
      new MutationObserver(syncVisibility).observe(weekly, { attributes: true, attributeFilter: ['hidden'] });
      syncVisibility();
    }
    return true;
  }

  function ensureModal() {
    let overlay = document.getElementById(MODAL_ID);
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'activity-timeline-overlay';
    overlay.innerHTML = '<div class="activity-timeline-sheet" role="dialog" aria-modal="true" aria-labelledby="activityTimelineTitle"><div class="activity-timeline-head"><div><div class="activity-daily-kicker">Actividad digital</div><h2 id="activityTimelineTitle">Línea temporal</h2><div class="activity-daily-sub">Datos reducidos. No se guardan títulos de ventanas, texto escrito ni URLs completas.</div></div><button type="button" class="activity-timeline-close" aria-label="Cerrar">×</button></div><div class="activity-timeline-list"></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.activity-timeline-close').addEventListener('click', closeTimeline);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeTimeline(); });
    return overlay;
  }

  function timelineName(row) {
    if (row.category === 'private') return 'Actividad privada';
    if (row.domain) return row.domain;
    return row.app || row.label || 'Actividad';
  }

  function openTimeline() {
    const overlay = ensureModal();
    const list = overlay.querySelector('.activity-timeline-list');
    const timeline = state.summary && state.summary.timeline || [];
    list.innerHTML = timeline.map(row => (
      '<div class="activity-timeline-row">' +
      `<div class="activity-timeline-time">${esc(formatClock(row.started_at))}<br>→ ${esc(formatClock(row.ended_at))}</div>` +
      `<div><div class="activity-timeline-name">${esc(timelineName(row))}</div><div class="activity-timeline-meta">${esc(window.ActivityCore.categoryLabel(row.category))}${row.app && row.domain ? ' · ' + esc(row.app) : ''}</div></div>` +
      `<div class="activity-timeline-duration">${esc(window.ActivityCore.formatDuration(window.ActivityCore.seconds(row)))}</div>` +
      '</div>'
    )).join('') || '<div class="activity-daily-empty">No hay actividad para mostrar.</div>';
    overlay.classList.add('open');
  }

  function closeTimeline() {
    const overlay = document.getElementById(MODAL_ID);
    if (overlay) overlay.classList.remove('open');
  }

  async function loadDay(date, force) {
    const day = date || todayKey();
    if (state.loading) return state.summary;
    if (!force && state.date === day && state.summary) return state.summary;
    state.date = day;
    state.loading = true;
    state.error = '';
    ensureCard();
    renderCard();
    try {
      state.rows = await fetchRows(day);
      state.summary = window.ActivityCore.summarize(state.rows);
    } catch (error) {
      state.rows = [];
      state.summary = null;
      state.error = String(error && (error.message || error.details) || error || 'error desconocido');
    } finally {
      state.loading = false;
      renderCard();
    }
    return state.summary;
  }

  async function reportContext(date) {
    const summary = await loadDay(date || todayKey(), false);
    if (!summary) return null;
    return {
      date: state.date,
      trackedSeconds: summary.trackedSeconds,
      switches: summary.switches,
      categories: Object.assign({}, summary.categories),
      topApps: summary.topApps.slice(),
      topDomains: summary.topDomains.slice(),
      longestBlock: summary.longest ? {
        seconds: summary.longest.seconds,
        app: summary.longest.row.app || null,
        domain: summary.longest.row.domain || null,
        category: summary.longest.row.category || 'other',
      } : null,
    };
  }

  function boot() {
    injectStyle();
    if (!ensureCard()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (ensureCard() || attempts > 30) clearInterval(timer);
      }, 300);
    }
    loadDay(todayKey(), false);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadDay(todayKey(), true);
    });
  }

  window.ActivityTracker = { loadDay, reportContext, openTimeline, closeTimeline };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}());
