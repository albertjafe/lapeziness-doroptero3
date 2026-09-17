/* Composición de Hoy para iPad: conserva los controles y sus manejadores. */
(function ipadTodayModule() {
  'use strict';
  if (!document.documentElement.classList.contains('platform-ipad')) return;

  function fold(parent, nodes, title, className) {
    if (!parent || !nodes.length) return;
    const details = document.createElement('details');
    details.className = className;
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.append(summary);
    const body = document.createElement('div');
    body.className = className + '-body';
    nodes.forEach(node => body.append(node));
    details.append(body);
    parent.append(details);
  }

  function init() {
    const dashboard = document.getElementById('reservationDashboardContent');
    const controls = [dashboard?.querySelector('.rd-control-card'),
      document.getElementById('reservationMonitorCard'),
      document.getElementById('reservationQuickControls')?.closest('.rd-card'),
      document.getElementById('reservationSettingControls')?.closest('.rd-card')].filter(Boolean);
    fold(dashboard, controls, 'Controles del monitor', 'ipad-today-monitor');

    // El plan existente sigue accesible sin ocupar el centro de la portada.
    const plan = document.getElementById('sessionPlan');
    if (plan) fold(plan.parentElement, [plan], 'Plan diario', 'ipad-today-plan');

    document.querySelector('[data-ipad-today-register]')?.addEventListener('click', () => {
      const register = document.querySelector('#view-session .session-quick-disclosure');
      if (!register) return;
      register.open = true;
      register.scrollIntoView({ block: 'center', behavior: 'auto' });
      document.getElementById('sessionQuickStudyObra')?.focus({ preventScroll: true });
    });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
