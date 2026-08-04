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
      .crono-calendar-objectives-shell { width: 100%; }
      .crono-calendar-objectives-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        width: min(360px, 100%);
        margin: 0 auto 12px;
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
      .crono-calendar-objectives-panel[hidden] { display: none !important; }
      .crono-calendar-objectives-panel .habit-calendar-dashboard { margin: 0; }
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
