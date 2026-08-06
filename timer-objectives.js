(() => {
  'use strict';

  const STYLE_ID = 'timerObjectivesStyles';
  const GENERAL_PARENT_ID = 'calPanelObjetivos';
  let timerMode = 'calendar';
  let originalSwitchCalTab = null;

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
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        width: 100%;
        margin: 0 0 8px;
        padding: 4px;
        border: 1px solid var(--border2);
        border-radius: 12px;
        background: color-mix(in srgb, var(--bg2) 88%, transparent);
      }
      .crono-calendar-objectives-tab {
        min-height: 40px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: var(--text2);
        font: 600 10px/1 var(--font-mono, 'JetBrains Mono', monospace);
        letter-spacing: .04em;
        cursor: pointer;
      }
      .crono-calendar-objectives-tab.active {
        background: var(--bg);
        color: var(--accent);
        box-shadow: 0 1px 5px rgba(0,0,0,.12);
      }
      .crono-calendar-objectives-panel {
        min-width: 0;
        min-height: 0;
      }
      .crono-calendar-objectives-panel[hidden] { display: none !important; }
      .crono-calendar-objectives-panel .habit-calendar-dashboard { margin: 0; }

      @media (min-width: 700px) and (max-width: 1199px) and (orientation: portrait),
             (min-width: 900px) and (max-width: 1399px) and (min-height: 820px) and (orientation: landscape) and (min-aspect-ratio: 4/3) and (max-aspect-ratio: 3/2) {
        #view-cronometro .crono-calendar-objectives-shell {
          grid-column: 4 / -1;
          grid-row: 1;
          align-self: stretch;
          display: flex;
          height: 100%;
          min-height: 0;
          flex-direction: column;
        }
        #view-cronometro #cronoCalendarPanelInner {
          display: flex;
          flex: 1 1 auto;
        }
        #view-cronometro #cronoCalendarPanelInner > .crono-calendar-panel {
          grid-column: auto;
          grid-row: auto;
          width: 100%;
          height: auto;
          flex: 1 1 auto;
        }
        #view-cronometro #cronoObjectivesPanel {
          flex: 1 1 auto;
          overflow-x: hidden;
          overflow-y: auto;
          padding: 1px 2px 5px;
          overscroll-behavior: contain;
          scrollbar-width: thin;
        }
        #cronoObjectivesPanel .habit-calendar-empty {
          grid-template-columns: 44px minmax(0, 1fr);
          gap: 10px;
          min-height: 0;
          padding: 16px 13px;
        }
        #cronoObjectivesPanel .habit-calendar-empty-icon {
          width: 44px;
          height: 44px;
        }
        #cronoObjectivesPanel .habit-calendar-empty h2 { font-size: 20px; }
        #cronoObjectivesPanel .habit-calendar-empty > button {
          grid-column: 1 / -1;
          width: 100%;
        }
        #cronoObjectivesPanel .habit-calendar-hero {
          grid-template-columns: 44px minmax(0, 1fr) auto;
          gap: 10px;
          min-height: 78px;
          padding: 11px 11px 15px;
        }
        #cronoObjectivesPanel .habit-calendar-trophy {
          width: 44px;
          height: 44px;
        }
        #cronoObjectivesPanel .habit-calendar-trophy svg {
          width: 23px;
          height: 23px;
        }
        #cronoObjectivesPanel .habit-calendar-title h2 {
          display: -webkit-box;
          overflow: hidden;
          font-size: clamp(18px, 2.1vw, 22px);
          line-height: 1.05;
          white-space: normal;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        #cronoObjectivesPanel .habit-calendar-edit {
          min-width: 44px;
          min-height: 40px;
          padding-inline: 9px;
          font-size: 8px;
        }
        #cronoObjectivesPanel .habit-calendar-layout {
          grid-template-columns: minmax(0, 1fr);
          gap: 10px;
          margin-top: 10px;
        }
        #cronoObjectivesPanel .habit-calendar-summary { gap: 8px; }
        #cronoObjectivesPanel .habit-calendar-today {
          min-height: 42px;
          padding-block: 8px;
          font-size: 11px;
        }
        #cronoObjectivesPanel .habit-calendar-stats {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 5px;
        }
        #cronoObjectivesPanel .habit-calendar-stats > div {
          display: flex;
          min-height: 58px;
          padding: 7px 4px;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          text-align: center;
        }
        #cronoObjectivesPanel .habit-calendar-stats span { font-size: 6.5px; }
        #cronoObjectivesPanel .habit-calendar-stats strong {
          font-size: 22px;
          line-height: .9;
        }
        #cronoObjectivesPanel .habit-calendar-stats small { font-size: 7px; }
        #cronoObjectivesPanel .habit-calendar-guidance { display: none; }
        #cronoObjectivesPanel .habit-calendar-history { padding: 10px 8px; }
        #cronoObjectivesPanel .habit-calendar-month-nav {
          grid-template-columns: 38px minmax(0, 1fr) 38px;
          gap: 5px;
          margin-bottom: 6px;
        }
        #cronoObjectivesPanel .habit-calendar-month-nav strong { font-size: 18px; }
        #cronoObjectivesPanel .habit-calendar-month-nav button {
          width: 38px;
          height: 38px;
        }
        #cronoObjectivesPanel .habit-calendar-weekdays,
        #cronoObjectivesPanel .habit-calendar-grid { gap: 3px; }
        #cronoObjectivesPanel .habit-calendar-day {
          min-height: 36px;
          aspect-ratio: 1.08;
          border-radius: 5px;
        }
        #cronoObjectivesPanel .habit-calendar-day > span {
          top: 4px;
          left: 4px;
          font-size: 7px;
        }
        #cronoObjectivesPanel .habit-calendar-day > i {
          width: 19px;
          height: 19px;
          font-size: 11px;
        }
        #cronoObjectivesPanel .habit-calendar-legend {
          gap: 6px 10px;
          margin-top: 8px;
          font-size: 7px;
        }
      }
      @media (max-width: 520px) {
        .crono-calendar-objectives-tabs { width: 100%; margin-bottom: 9px; }
        .crono-calendar-objectives-tab { min-height: 38px; font-size: 9px; }
      }
    `;
    document.head.appendChild(style);
  }

  function dashboard() {
    return document.getElementById('habitCalendarDashboard');
  }

  function generalParent() {
    return document.getElementById(GENERAL_PARENT_ID);
  }

  function timerPanel() {
    return document.getElementById('cronoObjectivesPanel');
  }

  function moveDashboardToGeneral() {
    const root = dashboard();
    const parent = generalParent();
    if (root && parent && root.parentElement !== parent) parent.appendChild(root);
  }

  function moveDashboardToTimer() {
    const root = dashboard();
    const parent = timerPanel();
    if (root && parent && root.parentElement !== parent) parent.appendChild(root);
    if (typeof window.renderHabitCalendar === 'function') window.renderHabitCalendar();
  }

  function setMode(mode) {
    timerMode = mode === 'objectives' ? 'objectives' : 'calendar';
    const calendar = document.getElementById('cronoCalendarPanelInner');
    const objectives = timerPanel();
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

    if (showingObjectives) moveDashboardToTimer();
    try { localStorage.setItem('crono_calendar_panel', timerMode); } catch (error) {}
  }

  function installSwitch() {
    if (typeof window.switchCalTab !== 'function' || originalSwitchCalTab) return;
    originalSwitchCalTab = window.switchCalTab;
    window.switchCalTab = function(tab, btn) {
      if (tab === 'objetivos') moveDashboardToGeneral();
      return originalSwitchCalTab.apply(this, arguments);
    };
  }

  function build() {
    addStyles();
    installSwitch();

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
      <button type="button" class="crono-calendar-objectives-tab active" data-timer-panel="calendar" role="tab" aria-selected="true">Calendario</button>
      <button type="button" class="crono-calendar-objectives-tab" data-timer-panel="objectives" role="tab" aria-selected="false">Objetivos</button>
    `;

    const calendarPanel = document.createElement('div');
    calendarPanel.id = 'cronoCalendarPanelInner';
    calendarPanel.className = 'crono-calendar-objectives-panel';

    const objectivesPanel = document.createElement('div');
    objectivesPanel.id = 'cronoObjectivesPanel';
    objectivesPanel.className = 'crono-calendar-objectives-panel';
    objectivesPanel.hidden = true;

    calendar.parentNode.insertBefore(shell, calendar);
    shell.appendChild(tabs);
    shell.appendChild(calendarPanel);
    shell.appendChild(objectivesPanel);
    calendarPanel.appendChild(calendar);

    tabs.addEventListener('click', event => {
      const button = event.target.closest('[data-timer-panel]');
      if (button) setMode(button.dataset.timerPanel);
    });

    let saved = 'calendar';
    try { saved = localStorage.getItem('crono_calendar_panel') || 'calendar'; } catch (error) {}
    setMode(saved);
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
