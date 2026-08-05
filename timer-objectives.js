/**
 * timer-objectives.js
 * Implements the "Calendario / Objetivos" selector and panel toggling in the stopwatch view.
 */

function addStyles() {
  if (document.getElementById('crono-objectives-styles')) return;
  const style = document.createElement('style');
  style.id = 'crono-objectives-styles';
  style.textContent = `
    .crono-calendar-selector {
      display: flex;
      justify-content: center;
      gap: 4px;
      margin: 16px auto 16px;
      background: var(--bg3);
      border-radius: 10px;
      padding: 3px;
      border: 1px solid var(--border2);
      width: fit-content;
      box-sizing: border-box;
    }
    .crono-selector-btn {
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--text3);
      font-family: var(--font-mono);
      font-size: 10px;
      padding: 6px 14px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 600;
    }
    .crono-selector-btn.active {
      background: var(--bg2);
      color: var(--accent);
      box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    }
    .crono-panel-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 0;
      width: 100%;
    }
    #cronoPanelCalendar, #cronoPanelObjectives {
      width: 100%;
      min-height: 0;
    }
    #view-cronometro .crono-calendar-panel {
      display: flex !important;
      contain: none !important;
      box-sizing: border-box;
    }
    #cronoPanelObjectives .habit-calendar-dashboard {
      background:
        radial-gradient(circle at 82% 4%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 35%),
        color-mix(in srgb, var(--bg2) 97%, var(--bg));
      border: 1px solid color-mix(in srgb, var(--border2) 82%, transparent);
      border-radius: 18px;
      padding: 16px 12px;
      box-shadow: 0 14px 34px -30px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.2);
      box-sizing: border-box;
      width: 100%;
    }
    @media (min-width: 900px) {
      #view-cronometro .crono-calendar-selector {
        grid-column: 4 / -1;
        grid-row: 1;
        align-self: start;
        margin-block: 0;
        margin-bottom: -40px;
        z-index: 10;
      }
      #view-cronometro .crono-panel-wrapper {
        grid-column: 4 / -1;
        grid-row: 1;
        align-self: stretch;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        padding-top: 48px;
        box-sizing: border-box;
      }
      #view-cronometro .crono-calendar-panel,
      #view-cronometro #cronoPanelObjectives .habit-calendar-dashboard {
        height: 100%;
        min-height: 0;
        align-self: stretch;
      }
    }
  `;
  document.head.appendChild(style);
}

function build() {
  const originalCalendar = document.querySelector('.crono-calendar-panel');
  if (!originalCalendar) return;
  if (document.getElementById('cronoCalendarObjectivesShell')) return;

  const shell = document.createElement('div');
  shell.id = 'cronoCalendarObjectivesShell';
  shell.className = 'crono-calendar-objectives-shell';

  const selector = document.createElement('div');
  selector.className = 'crono-calendar-selector';
  selector.setAttribute('role', 'tablist');
  selector.setAttribute('aria-label', 'Vista secundaria del cronómetro');
  selector.innerHTML = `
    <button type="button" class="crono-selector-btn active" id="cronoTabCalendar" role="tab" aria-selected="true" onclick="switchCronoCalendarTab('calendar')">Calendario</button>
    <button type="button" class="crono-selector-btn" id="cronoTabObjectives" role="tab" aria-selected="false" onclick="switchCronoCalendarTab('objectives')">Objetivos</button>
  `;

  const wrapper = document.createElement('div');
  wrapper.className = 'crono-panel-wrapper';

  const panelCalendarInner = document.createElement('div');
  panelCalendarInner.id = 'cronoPanelCalendar';
  panelCalendarInner.className = 'crono-panel-inner';

  const panelObjectives = document.createElement('div');
  panelObjectives.id = 'cronoPanelObjectives';
  panelObjectives.className = 'crono-panel-inner';
  panelObjectives.style.display = 'none';

  originalCalendar.parentNode.insertBefore(shell, originalCalendar);
  panelCalendarInner.appendChild(originalCalendar);

  shell.appendChild(selector);
  shell.appendChild(wrapper);
  wrapper.appendChild(panelCalendarInner);
  wrapper.appendChild(panelObjectives);

  // Restore active view on build
  const activeTab = localStorage.getItem('crono_secondary_view') || 'calendar';
  switchCronoCalendarTab(activeTab);
}

function switchCronoCalendarTab(tab) {
  if (tab !== 'calendar' && tab !== 'objectives') tab = 'calendar';
  localStorage.setItem('crono_secondary_view', tab);

  const tabCalendar = document.getElementById('cronoTabCalendar');
  const tabObjectives = document.getElementById('cronoTabObjectives');
  const panelCalendar = document.getElementById('cronoPanelCalendar');
  const panelObjectives = document.getElementById('cronoPanelObjectives');

  if (tabCalendar) {
    tabCalendar.classList.toggle('active', tab === 'calendar');
    tabCalendar.setAttribute('aria-selected', tab === 'calendar' ? 'true' : 'false');
  }
  if (tabObjectives) {
    tabObjectives.classList.toggle('active', tab === 'objectives');
    tabObjectives.setAttribute('aria-selected', tab === 'objectives' ? 'true' : 'false');
  }

  if (panelCalendar) panelCalendar.style.display = tab === 'calendar' ? '' : 'none';
  if (panelObjectives) panelObjectives.style.display = tab === 'objectives' ? '' : 'none';

  if (tab === 'objectives') {
    const dashboard = document.getElementById('habitCalendarDashboard');
    if (dashboard && panelObjectives) {
      if (dashboard.parentNode !== panelObjectives) {
        panelObjectives.appendChild(dashboard);
      }
    }
    if (typeof renderHabitCalendar === 'function') {
      renderHabitCalendar();
    }
  } else {
    // When showing event calendar, return the dashboard to calPanelObjetivos
    const dashboard = document.getElementById('habitCalendarDashboard');
    const targetParent = document.getElementById('calPanelObjetivos');
    if (dashboard && targetParent && dashboard.parentNode !== targetParent) {
      targetParent.appendChild(dashboard);
    }
  }
}

// Override switchCalTab to return habitCalendarDashboard back to its default parent
if (typeof window !== 'undefined') {
  const originalSwitchCalTab = window.switchCalTab;
  window.switchCalTab = function(tab, btn) {
    if (tab === 'objetivos') {
      const dashboard = document.getElementById('habitCalendarDashboard');
      const targetParent = document.getElementById('calPanelObjetivos');
      if (dashboard && targetParent && dashboard.parentNode !== targetParent) {
        targetParent.appendChild(dashboard);
      }
    }
    if (typeof originalSwitchCalTab === 'function') {
      originalSwitchCalTab(tab, btn);
    }
  };

  // Intercept showView to safeguard dashboard placement when switching away
  const originalShowView = window.showView;
  window.showView = function(name, options) {
    if (name !== 'cronometro') {
      const dashboard = document.getElementById('habitCalendarDashboard');
      const targetParent = document.getElementById('calPanelObjetivos');
      if (dashboard && targetParent && dashboard.parentNode !== targetParent) {
        targetParent.appendChild(dashboard);
      }
    }
    if (typeof originalShowView === 'function') {
      originalShowView(name, options);
    }
  };

  // Intercept cronoOnEnterView to automatically restore persisted stopwatch tab selection
  const originalCronoOnEnterView = window.cronoOnEnterView;
  window.cronoOnEnterView = function(options) {
    if (typeof originalCronoOnEnterView === 'function') {
      originalCronoOnEnterView(options);
    }
    const activeTab = localStorage.getItem('crono_secondary_view') || 'calendar';
    switchCronoCalendarTab(activeTab);
  };
}

function init() {
  addStyles();
  const originalCalendar = document.querySelector('.crono-calendar-panel');
  if (originalCalendar) {
    build();
  } else {
    const observer = new MutationObserver((mutations, obs) => {
      const el = document.querySelector('.crono-calendar-panel');
      if (el) {
        build();
        obs.disconnect();
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
