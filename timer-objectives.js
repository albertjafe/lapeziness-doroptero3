(() => {
  'use strict';

  const STYLE_ID = 'timerObjectivesStyles';
  const MODE_KEY = 'crono_calendar_panel_v2';
  const COMPACT_KEY = 'crono_dashboard_compact_v1';
  let timerMode = 'objectives';
  let compactLayout = false;
  let originalRenderHabitCalendar = null;

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .crono-calendar-objectives-shell {
        display: none;
        width: 100%;
        min-width: 0;
        min-height: 0;
      }
      .crono-calendar-objectives-tabs {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 38px;
        gap: 4px;
        width: 100%;
        margin: 0 0 8px;
        padding: 4px;
        border: 1px solid var(--border2);
        border-radius: 12px;
        background: color-mix(in srgb, var(--bg2) 88%, transparent);
        box-sizing: border-box;
      }
      .crono-calendar-objectives-tab,
      .crono-panel-size-toggle {
        min-width: 0;
        min-height: 38px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: var(--text2);
        font: 600 9px/1 var(--font-mono, 'JetBrains Mono', monospace);
        letter-spacing: .04em;
        cursor: pointer;
      }
      .crono-calendar-objectives-tab.active {
        background: var(--bg);
        color: var(--accent);
        box-shadow: 0 1px 5px rgba(0,0,0,.12);
      }
      .crono-panel-size-toggle {
        display: grid;
        place-items: center;
        border: 1px solid color-mix(in srgb, var(--border2) 80%, transparent);
      }
      .crono-panel-size-toggle svg { width: 16px; height: 16px; }
      .crono-panel-size-toggle[aria-pressed="true"] {
        border-color: color-mix(in srgb, var(--accent) 45%, var(--border2));
        background: color-mix(in srgb, var(--accent) 9%, transparent);
        color: var(--accent);
      }
      .crono-calendar-objectives-panel {
        min-width: 0;
        min-height: 0;
      }
      .crono-calendar-objectives-panel[hidden] { display: none !important; }

      .crono-habit-tracker {
        display: flex;
        height: 100%;
        min-height: 0;
        padding: 11px;
        flex-direction: column;
        gap: 8px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--border2) 82%, transparent);
        border-radius: 18px;
        background:
          radial-gradient(circle at 88% 0%, color-mix(in srgb, #d6a52e 8%, transparent), transparent 34%),
          color-mix(in srgb, var(--bg2) 97%, var(--bg));
        box-shadow: 0 14px 34px -30px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.2);
        box-sizing: border-box;
      }
      .crono-habit-tracker-head {
        position: relative;
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 9px;
        min-height: 58px;
        padding: 7px 8px 10px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, #bd8a1c 34%, var(--border2));
        border-radius: 10px;
        background: color-mix(in srgb, #d6a52e 5%, var(--bg));
      }
      .crono-habit-tracker-icon {
        display: grid;
        width: 36px;
        height: 36px;
        place-items: center;
        border: 1px solid color-mix(in srgb, #bd8a1c 42%, var(--border2));
        border-radius: 9px;
        color: #a87913;
      }
      .crono-habit-tracker-icon svg { width: 20px; height: 20px; }
      .crono-habit-tracker-copy { display: grid; gap: 3px; min-width: 0; }
      .crono-habit-tracker-copy small {
        overflow: hidden;
        color: #9b7218;
        font: 750 7px/1 var(--font-mono, 'JetBrains Mono', monospace);
        letter-spacing: .07em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .crono-habit-tracker-copy strong {
        display: -webkit-box;
        overflow: hidden;
        color: var(--text);
        font: 500 18px/1.02 'Cormorant Garamond', serif;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .crono-habit-tracker-edit {
        display: grid;
        width: 34px;
        height: 34px;
        min-height: 34px !important;
        place-items: center;
        padding: 0;
        border: 1px solid var(--border2);
        border-radius: 8px;
        background: var(--bg3);
        color: var(--text3);
        font-size: 16px;
        cursor: pointer;
      }
      .crono-habit-tracker-progress {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        height: 3px;
        background: color-mix(in srgb, var(--border2) 65%, transparent);
      }
      .crono-habit-tracker-progress i {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #bd8a1c, #5a9a6e);
        transition: width 280ms ease;
      }
      .crono-habit-tracker-action {
        min-height: 36px;
        padding: 7px 10px;
        border: 1px solid color-mix(in srgb, #b58a24 45%, var(--border2));
        border-radius: 9px;
        background: color-mix(in srgb, #d6a52e 7%, var(--bg2));
        color: #956a0e;
        font: 750 9px/1 var(--font-mono, 'JetBrains Mono', monospace);
        cursor: pointer;
      }
      .crono-habit-tracker-action.is-success {
        border-color: color-mix(in srgb, var(--green) 52%, var(--border2));
        background: color-mix(in srgb, var(--green) 9%, var(--bg2));
        color: var(--green);
      }
      .crono-habit-tracker-action.is-failure {
        border-color: color-mix(in srgb, var(--red) 52%, var(--border2));
        background: color-mix(in srgb, var(--red) 8%, var(--bg2));
        color: var(--red);
      }
      .crono-habit-tracker-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 5px;
      }
      .crono-habit-tracker-stat {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: baseline;
        gap: 2px 5px;
        min-width: 0;
        min-height: 43px;
        padding: 7px 8px;
        border: 1px solid var(--border2);
        border-radius: 8px;
        background: color-mix(in srgb, var(--bg) 70%, transparent);
        box-sizing: border-box;
      }
      .crono-habit-tracker-stat strong {
        grid-row: 1 / 3;
        color: var(--text);
        font: 500 21px/1 'Cormorant Garamond', serif;
      }
      .crono-habit-tracker-stat span,
      .crono-habit-tracker-stat small {
        overflow: hidden;
        color: var(--text3);
        font: 700 6px/1 var(--font-mono, 'JetBrains Mono', monospace);
        letter-spacing: .035em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .crono-habit-tracker-days {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        grid-auto-rows: minmax(35px, 1fr);
        gap: 4px;
        min-height: 0;
        flex: 1 1 auto;
        align-content: stretch;
      }
      .crono-habit-day {
        position: relative;
        display: grid;
        min-width: 0;
        min-height: 35px;
        place-items: center;
        overflow: hidden;
        border: 1px solid var(--border2);
        border-radius: 7px;
        background: color-mix(in srgb, var(--bg) 72%, transparent);
        color: var(--text3);
      }
      .crono-habit-day > span {
        position: absolute;
        top: 4px;
        left: 5px;
        font: 700 6px/1 var(--font-mono, 'JetBrains Mono', monospace);
      }
      .crono-habit-day > i {
        display: grid;
        width: 20px;
        height: 20px;
        place-items: center;
        border-radius: 50%;
        font: 800 11px/1 Arial, sans-serif;
        font-style: normal;
      }
      .crono-habit-day.is-success {
        border-color: color-mix(in srgb, var(--green) 42%, var(--border2));
        background: color-mix(in srgb, var(--green) 8%, var(--bg2));
      }
      .crono-habit-day.is-success > i { background: var(--green); color: #fff; }
      .crono-habit-day.is-failure {
        border-color: color-mix(in srgb, var(--red) 44%, var(--border2));
        background: color-mix(in srgb, var(--red) 7%, var(--bg2));
      }
      .crono-habit-day.is-failure > i { background: var(--red); color: #fff; }
      .crono-habit-day.is-current {
        border-color: color-mix(in srgb, #bd8a1c 70%, var(--border2));
        background: color-mix(in srgb, #d6a52e 10%, var(--bg2));
        box-shadow: 0 0 0 2px color-mix(in srgb, #d6a52e 11%, transparent);
      }
      .crono-habit-day.is-current > i { background: #c38d16; color: #fff; }
      .crono-habit-day.is-future { opacity: .48; }
      .crono-habit-day.is-target {
        border-color: color-mix(in srgb, #d6a52e 74%, var(--border2));
        background: color-mix(in srgb, #d6a52e 8%, var(--bg2));
        opacity: .95;
      }
      .crono-habit-day.is-target > i {
        background: #d6a52e;
        color: #fff;
        box-shadow: 0 0 0 3px color-mix(in srgb, #d6a52e 13%, transparent);
      }
      .crono-habit-day.is-target.is-victory {
        border-color: color-mix(in srgb, var(--green) 62%, #d6a52e 38%);
        background: color-mix(in srgb, var(--green) 10%, var(--bg2));
        opacity: 1;
      }
      .crono-habit-day.is-target.is-victory > i { background: var(--green); }
      .crono-habit-tracker-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 23px;
        color: var(--text3);
        font: 700 7px/1 var(--font-mono, 'JetBrains Mono', monospace);
        letter-spacing: .035em;
        text-transform: uppercase;
      }
      .crono-habit-tracker-goal {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #9b7218;
      }
      .crono-habit-tracker-goal i { color: #d6a52e; font-size: 13px; font-style: normal; }
      .crono-habit-tracker.is-complete .crono-habit-tracker-goal,
      .crono-habit-tracker.is-complete .crono-habit-tracker-goal i { color: var(--green); }
      .crono-habit-tracker-empty {
        display: grid;
        height: 100%;
        min-height: 0;
        place-items: center;
        padding: 24px;
        border: 1px dashed var(--border2);
        border-radius: 18px;
        background: color-mix(in srgb, var(--bg2) 90%, transparent);
        box-sizing: border-box;
        text-align: center;
      }
      .crono-habit-tracker-empty > div { display: grid; justify-items: center; gap: 8px; }
      .crono-habit-tracker-empty strong { color: var(--text); font: 500 22px/1 'Cormorant Garamond', serif; }
      .crono-habit-tracker-empty span { color: var(--text3); font-size: 9px; }
      .crono-habit-tracker-empty button {
        min-height: 38px;
        padding: 8px 14px;
        border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border2));
        border-radius: 9px;
        background: color-mix(in srgb, var(--accent) 8%, transparent);
        color: var(--accent);
        font: 700 9px/1 var(--font-mono, 'JetBrains Mono', monospace);
      }

      .crono-habit-tracker.is-minimal {
        height: auto;
        max-height: 100%;
        padding: 10px;
        gap: 8px;
        background: color-mix(in srgb, var(--bg2) 97%, var(--bg));
      }
      .crono-habit-tracker-stack {
        display: flex;
        min-height: 0;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
      }
      .crono-habit-tracker-tools {
        display: flex;
        min-height: 40px;
        align-items: center;
        justify-content: flex-end;
        gap: 7px;
      }
      .crono-habit-tracker-action-icon,
      .crono-habit-tracker-edit-icon,
      .crono-habit-tracker-create-icon {
        display: grid;
        width: 40px;
        height: 40px;
        min-height: 40px !important;
        place-items: center;
        padding: 0;
        border: 1px solid var(--border2);
        border-radius: 9px;
        background: color-mix(in srgb, var(--bg) 82%, transparent);
        color: var(--text3);
        cursor: pointer;
        box-sizing: border-box;
      }
      .crono-habit-tracker-action-icon {
        border-color: color-mix(in srgb, #b58a24 46%, var(--border2));
        background: color-mix(in srgb, #d6a52e 7%, var(--bg2));
        color: #956a0e;
        font: 800 18px/1 Arial, sans-serif;
      }
      .crono-habit-tracker-action-icon.is-success {
        border-color: color-mix(in srgb, var(--green) 52%, var(--border2));
        background: color-mix(in srgb, var(--green) 9%, var(--bg2));
        color: var(--green);
      }
      .crono-habit-tracker-action-icon.is-failure {
        border-color: color-mix(in srgb, var(--red) 52%, var(--border2));
        background: color-mix(in srgb, var(--red) 8%, var(--bg2));
        color: var(--red);
      }
      .crono-habit-tracker-edit-icon svg,
      .crono-habit-tracker-create-icon svg {
        width: 17px;
        height: 17px;
      }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-days {
        flex: 0 0 auto;
        grid-auto-rows: clamp(40px, 5.2vh, 52px);
        align-content: start;
      }
      .crono-habit-tracker-empty.is-minimal {
        height: auto;
        min-height: 120px;
        padding: 18px;
        border-style: solid;
      }
      .crono-habit-tracker-empty.is-minimal > div { gap: 0; }
      .crono-habit-tracker-create-icon {
        width: 48px !important;
        height: 48px !important;
        min-height: 48px !important;
        padding: 0 !important;
        color: var(--accent) !important;
      }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-head {
        grid-template-columns: 32px minmax(0, 1fr) auto;
        min-height: 54px;
        padding: 5px 6px 8px;
        gap: 8px;
        border-radius: 10px;
      }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-icon {
        width: 30px;
        height: 30px;
        border-radius: 8px;
      }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-icon svg { width: 17px; height: 17px; }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-copy { gap: 2px; }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-copy small {
        font-size: 7px;
        letter-spacing: .045em;
      }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-copy strong {
        font-size: 15px;
        line-height: 1.04;
      }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-tools {
        min-height: 30px;
        gap: 5px;
      }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-action-icon,
      .crono-habit-tracker.is-minimal .crono-habit-tracker-edit-icon {
        width: 30px;
        height: 30px;
        min-height: 30px !important;
        border-radius: 8px;
      }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-action-icon { font-size: 15px; }
      .crono-habit-tracker.is-minimal .crono-habit-tracker-edit-icon svg { width: 14px; height: 14px; }
      .crono-habit-tracker-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 19px;
        padding: 0 2px;
        color: var(--text3);
        font: 700 7px/1 var(--font-mono, 'JetBrains Mono', monospace);
        letter-spacing: .035em;
        text-transform: uppercase;
      }
      .crono-habit-tracker-meta strong {
        color: var(--accent);
        font-weight: 800;
      }
      .crono-habit-tracker.is-complete .crono-habit-tracker-meta strong { color: var(--green); }

      @media (min-width: 700px) and (max-width: 1199px) and (orientation: portrait),
             (min-width: 900px) and (max-width: 1399px) and (min-height: 820px) and (orientation: landscape) and (min-aspect-ratio: 4/3) and (max-aspect-ratio: 3/2) {
        [data-theme^="marmol"] #view-cronometro .crono-wrap,
        [data-theme^="marmol"] body.crono-running #view-cronometro .crono-wrap {
          grid-template-rows: clamp(410px, 38dvh, 456px) auto auto;
        }
        [data-theme^="marmol"] body.crono-dashboard-compact #view-cronometro .crono-wrap,
        [data-theme^="marmol"] body.crono-dashboard-compact.crono-running #view-cronometro .crono-wrap {
          grid-template-rows: 396px auto auto;
        }
        #view-cronometro .crono-calendar-objectives-shell {
          grid-column: 4 / -1;
          grid-row: 1;
          align-self: stretch;
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          flex-direction: column;
        }
        #view-cronometro .crono-calendar-objectives-panel {
          flex: 1 1 auto;
          height: 100%;
          min-height: 0;
        }
        #view-cronometro #cronoCalendarPanelInner {
          display: flex;
        }
        #view-cronometro #cronoCalendarPanelInner > .crono-calendar-panel {
          grid-column: auto;
          grid-row: auto;
          width: 100%;
          height: 100%;
          flex: 1 1 auto;
        }
        #view-cronometro #cronoObjectivesPanel { overflow: hidden; }
        #view-cronometro .crono-calendar-objectives-shell.is-compact .crono-habit-tracker {
          gap: 6px;
          padding: 8px;
        }
        #view-cronometro .crono-calendar-objectives-shell.is-compact .crono-habit-tracker-tools { min-height: 34px; }
        #view-cronometro .crono-calendar-objectives-shell.is-compact .crono-habit-tracker-action-icon,
        #view-cronometro .crono-calendar-objectives-shell.is-compact .crono-habit-tracker-edit-icon {
          width: 34px;
          height: 34px;
          min-height: 34px !important;
        }
        #view-cronometro .crono-calendar-objectives-shell.is-compact .crono-habit-tracker-head { min-height: 52px; padding-block: 5px 8px; }
        #view-cronometro .crono-calendar-objectives-shell.is-compact .crono-habit-tracker-action { min-height: 32px; }
        #view-cronometro .crono-calendar-objectives-shell.is-compact .crono-habit-tracker-stat { min-height: 38px; padding-block: 5px; }
        #view-cronometro .crono-calendar-objectives-shell.is-compact .crono-habit-tracker-days { gap: 3px; }
      }

      @media (max-width: 520px) {
        .crono-calendar-objectives-tabs { margin-bottom: 7px; }
        .crono-calendar-objectives-tab { min-height: 36px; font-size: 8px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .crono-habit-tracker-progress i { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function safeText(value) {
    if (typeof window.escapeHtmlSafe === 'function') return window.escapeHtmlSafe(String(value || ''));
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function parseDayKey(key) {
    const parts = String(key || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2], 12);
  }

  function formatDayKey(key) {
    const date = parseDayKey(key);
    if (!date) return '';
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(date).replace('.', '');
  }

  function trackerPanel() {
    return document.getElementById('cronoObjectivesPanel');
  }

  function trackerState(habit, key, todayKey) {
    if (typeof window.habitCalendarDayState === 'function') return window.habitCalendarDayState(habit, key, todayKey);
    return 'future';
  }

  function trackerStateLabel(state) {
    return ({ success: 'cumplido', failure: 'fallado', current: 'hoy', future: 'pendiente' })[state] || '';
  }

  function trackerDaysHtml(habit, metrics) {
    const duration = metrics.duration;
    const visibleCount = Math.min(duration, 28);
    const todayNumber = typeof window.habitDayNumber === 'function' ? window.habitDayNumber(metrics.todayKey) : 0;
    const startNumber = typeof window.habitDayNumber === 'function' ? window.habitDayNumber(habit.startDate) : 0;
    const currentIndex = Math.max(0, Math.min(duration - 1, todayNumber - startNumber));
    let firstIndex = 0;
    if (duration > visibleCount) {
      firstIndex = Math.max(0, Math.min(duration - visibleCount, currentIndex - Math.floor(visibleCount * .65)));
    }
    let html = '';
    for (let offset = 0; offset < visibleCount; offset += 1) {
      const index = firstIndex + offset;
      const key = window.habitKeyAt(habit.startDate, index);
      const state = trackerState(habit, key, metrics.todayKey);
      const target = index === duration - 1;
      const victory = target && state === 'success';
      const mark = target ? '&#9873;' : (state === 'success' ? '&#10003;' : (state === 'failure' ? '&#215;' : (state === 'current' ? '&#8226;' : '')));
      const label = 'Día ' + (index + 1) + ', ' + formatDayKey(key) + ': ' + trackerStateLabel(state) + (target ? ', meta' : '');
      html += '<div class="crono-habit-day is-' + state + (target ? ' is-target' : '') + (victory ? ' is-victory' : '') + '" data-date="' + key + '" aria-label="' + label + '">' +
        '<span>' + (index + 1) + '</span><i aria-hidden="true">' + mark + '</i>' +
      '</div>';
    }
    return html;
  }

  function renderTracker() {
    const panel = trackerPanel();
    if (!panel) return;
    const habits = typeof window.habitActiveChallenges === 'function'
      ? window.habitActiveChallenges()
      : (typeof window.habitActiveChallenge === 'function' && window.habitActiveChallenge() ? [window.habitActiveChallenge()] : []);
    const plus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    const pencil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
    if (!habits.length || typeof window.habitMetrics !== 'function' || typeof window.habitKeyAt !== 'function') {
      panel.innerHTML = '<section class="crono-habit-tracker-empty is-minimal"><div>' +
        '<button type="button" class="crono-habit-tracker-create-icon" onclick="openHabitChallengeModal()" aria-label="Crear objetivo" title="Crear objetivo">' + plus + '</button>' +
      '</div></section>';
      return;
    }

    const jsId = id => String(id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const trophy = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 12v5M8.5 20h7M10 17h4"/></svg>';
    const cards = habits.slice(0, 1).map(habit => {
      const metrics = window.habitMetrics(habit);
      const marked = habit.mode === 'avoid' ? metrics.todayLog === 'failed' : metrics.todayLog === 'done';
      const modeLabel = habit.mode === 'avoid' ? 'Evitar' : 'Hacer';
      const todayLabel = formatDayKey(metrics.todayKey);
      let action = '';
      if (metrics.complete) {
        action = '<button type="button" class="crono-habit-tracker-action-icon is-success" onclick="openHabitChallengeModal(\'' + jsId(habit.id) + '\')" aria-label="Objetivo completado" title="Objetivo completado">&#10003;</button>';
      } else if (habit.mode === 'avoid') {
        action = '<button type="button" class="crono-habit-tracker-action-icon' + (marked ? ' is-failure' : '') + '" onclick="registerHabitRelapse(event,\'' + jsId(habit.id) + '\')" aria-label="' +
          (marked ? 'Quitar recaída de hoy' : 'Registrar recaída hoy') + '" title="' + (marked ? 'Quitar recaída' : 'Registrar recaída') + '">!</button>';
      } else {
        action = '<button type="button" class="crono-habit-tracker-action-icon' + (marked ? ' is-success' : '') + '" onclick="toggleHabitToday(event,\'' + jsId(habit.id) + '\')" aria-label="' +
          (marked ? 'Desmarcar objetivo de hoy' : 'Marcar objetivo cumplido hoy') + '" title="' + (marked ? 'Desmarcar hoy' : 'Cumplir hoy') + '">&#10003;</button>';
      }
      return '<section class="crono-habit-tracker is-minimal' + (metrics.complete ? ' is-complete' : '') + '">' +
        '<header class="crono-habit-tracker-head">' +
          '<span class="crono-habit-tracker-icon">' + trophy + '</span>' +
          '<div class="crono-habit-tracker-copy"><small>' + modeLabel + ' · Hoy ' + safeText(todayLabel) + '</small><strong>' + safeText(habit.title || 'Objetivo') + '</strong></div>' +
          '<div class="crono-habit-tracker-tools">' + action +
            '<button type="button" class="crono-habit-tracker-edit-icon" onclick="openHabitChallengeModal(\'' + jsId(habit.id) + '\')" aria-label="Editar objetivo" title="Editar objetivo">' + pencil + '</button>' +
          '</div>' +
          '<span class="crono-habit-tracker-progress" aria-hidden="true"><i style="width:' + metrics.progress + '%"></i></span>' +
        '</header>' +
        '<div class="crono-habit-tracker-meta" aria-label="Hoy ' + safeText(todayLabel) + ', día ' + metrics.day + ' de ' + metrics.duration + '">' +
          '<span>Hoy · ' + safeText(todayLabel) + '</span><strong>Día ' + metrics.day + ' de ' + metrics.duration + '</strong><span>' + metrics.streak + ' seguidos</span>' +
        '</div>' +
        '<div class="crono-habit-tracker-days" role="list" aria-label="Días del objetivo ' + safeText(habit.title || '') + '">' + trackerDaysHtml(habit, metrics) + '</div>' +
      '</section>';
    }).join('');
    panel.innerHTML = '<div class="crono-habit-tracker-stack">' + cards + '</div>';
  }

  function installRenderHook() {
    if (typeof window.renderHabitCalendar !== 'function' || originalRenderHabitCalendar) return;
    originalRenderHabitCalendar = window.renderHabitCalendar;
    window.renderHabitCalendar = function() {
      const result = originalRenderHabitCalendar.apply(this, arguments);
      renderTracker();
      return result;
    };
  }

  function setCompactLayout(compact, userInitiated) {
    compactLayout = !!compact;
    document.body.classList.toggle('crono-dashboard-compact', compactLayout);
    const shell = document.getElementById('cronoCalendarObjectivesShell');
    shell?.classList.toggle('is-compact', compactLayout);
    const button = document.getElementById('cronoPanelSizeToggle');
    if (button) {
      button.setAttribute('aria-pressed', compactLayout ? 'true' : 'false');
      button.setAttribute('aria-label', compactLayout ? 'Restaurar tamaño del reloj y el tracker' : 'Hacer más pequeños el reloj y el tracker');
      button.title = compactLayout ? 'Tamaño normal' : 'Tamaño compacto';
    }
    try { localStorage.setItem(COMPACT_KEY, compactLayout ? '1' : '0'); } catch (error) {}
    if (userInitiated && typeof window.cronoAnimateInterfaceScale === 'function') {
      window.cronoAnimateInterfaceScale(compactLayout ? .72 : 1, { persist: true, linger: true });
    }
  }

  function toggleCompactLayout() {
    setCompactLayout(!compactLayout, true);
  }

  function setMode(mode) {
    timerMode = mode === 'calendar' ? 'calendar' : 'objectives';
    const calendar = document.getElementById('cronoCalendarPanelInner');
    const objectives = trackerPanel();
    const tabs = document.querySelectorAll('.crono-calendar-objectives-tab');
    if (!calendar || !objectives) return;
    const showingObjectives = timerMode === 'objectives';
    calendar.hidden = showingObjectives;
    objectives.hidden = !showingObjectives;
    tabs.forEach(tab => {
      const active = tab.dataset.timerPanel === timerMode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (showingObjectives) renderTracker();
    try { localStorage.setItem(MODE_KEY, timerMode); } catch (error) {}
  }

  function build() {
    addStyles();
    installRenderHook();
    const calendar = document.querySelector('#view-cronometro .crono-calendar-panel');
    if (!calendar || document.getElementById('cronoCalendarObjectivesShell')) return false;

    const shell = document.createElement('div');
    shell.id = 'cronoCalendarObjectivesShell';
    shell.className = 'crono-calendar-objectives-shell';

    const tabs = document.createElement('div');
    tabs.className = 'crono-calendar-objectives-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Calendario u objetivos');
    tabs.innerHTML = `
      <button type="button" class="crono-calendar-objectives-tab" data-timer-panel="calendar" role="tab" aria-selected="false">Calendario</button>
      <button type="button" class="crono-calendar-objectives-tab active" data-timer-panel="objectives" role="tab" aria-selected="true">Objetivos</button>
      <button type="button" class="crono-panel-size-toggle" id="cronoPanelSizeToggle" aria-pressed="false" aria-label="Hacer más pequeños el reloj y el tracker" title="Tamaño compacto">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4"/><path d="m3 7 4-4M17 7l-4-4M3 13l4 4M17 13l-4 4"/></svg>
      </button>
    `;

    const calendarPanel = document.createElement('div');
    calendarPanel.id = 'cronoCalendarPanelInner';
    calendarPanel.className = 'crono-calendar-objectives-panel';
    calendarPanel.hidden = true;

    const objectivesPanel = document.createElement('div');
    objectivesPanel.id = 'cronoObjectivesPanel';
    objectivesPanel.className = 'crono-calendar-objectives-panel';

    calendar.parentNode.insertBefore(shell, calendar);
    shell.appendChild(tabs);
    shell.appendChild(calendarPanel);
    shell.appendChild(objectivesPanel);
    calendarPanel.appendChild(calendar);

    tabs.addEventListener('click', event => {
      const tab = event.target.closest('[data-timer-panel]');
      if (tab) setMode(tab.dataset.timerPanel);
      if (event.target.closest('#cronoPanelSizeToggle')) toggleCompactLayout();
    });

    try { compactLayout = localStorage.getItem(COMPACT_KEY) === '1'; } catch (error) {}
    setCompactLayout(compactLayout, false);
    let savedMode = 'objectives';
    try { savedMode = localStorage.getItem(MODE_KEY) || 'objectives'; } catch (error) {}
    setMode(savedMode);
    renderTracker();
    return true;
  }

  function init() {
    if (build()) return;
    const observer = new MutationObserver(() => {
      if (build()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }

  window.renderCronoHabitTracker = renderTracker;
  window.setCronoCalendarObjectivesMode = setMode;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
