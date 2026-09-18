import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = fs.readFileSync('app.js', 'utf8');
const dashboard = fs.readFileSync('reservation-dashboard.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const styles = fs.readFileSync('session-home.css', 'utf8');
const resumeLayout = fs.readFileSync('crono-resume-layout.css', 'utf8');
const desktopWorkspace = fs.readFileSync('desktop-workspace.css', 'utf8');
const desktopCalendar = fs.readFileSync('desktop-calendar-v389.css', 'utf8');
const desktopWindows = fs.readFileSync('desktop-windows-v390.css', 'utf8');
const desktopWindowsGeometry = fs.readFileSync('desktop-windows-v391.css', 'utf8');
const desktopRedesign = fs.readFileSync('desktop-redesign.css', 'utf8');
const cronoPremium = fs.readFileSync('crono-running-premium.js', 'utf8');
const trophiesStyles = fs.readFileSync('habit-trophies.css', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');

describe('focused session home', () => {
  it('keeps only the essential daily readout in the foreground', () => {
    expect(index).toContain('id="sessionResumenCard"');
    expect(index).toContain('id="sessionAulasDashboard"');
    expect(index).not.toContain('id="view-salas"');
    expect(index).not.toContain('class="session-mode-switch"');
    expect(index).toContain("onclick=\"openSessionArchive('week')\"");
    expect(index).toContain("onclick=\"openSessionArchive('history')\"");
    expect(index).toContain('id="sessionStatsSection" aria-labelledby="sessionStatsTitle" hidden');
    expect(index).not.toContain('id="sessionInsightStack"');
    expect(index).not.toContain('id="sessionInfoBtn"');
  });

  it('renders studied, projected and physical finishing time from the existing model', () => {
    const summary = app.slice(
      app.indexOf('function renderSessionResumen'),
      app.indexOf('function refreshConcentradoUI')
    );
    expect(summary).toContain('session-focus-metrics');
    expect(summary).toContain('t.projMin');
    expect(summary).toContain('t.etaProjected');
    expect(summary).toContain('_probEtaFmt');
    expect(summary).toContain('session-focus-probabilities');
    expect(summary).toContain("probabilityRow('4 horas'");
    expect(summary).toContain("probabilityRow('5 horas'");
    expect(app).toContain('etaProjected, startMin: startOv');
  });

  it('loads history statistics only in the explicit history mode', () => {
    const refresh = app.slice(
      app.indexOf('function refreshStudyViews'),
      app.indexOf('const SWIPE_VIEW_ORDER')
    );
    expect(refresh).toContain("_sessionSectionMode === 'history'");
    expect(styles).toContain('#view-session.session-history-mode');
    expect(app).toContain('function openSessionArchive(mode)');
    expect(app).toContain("opts.sessionMode = 'history'");
  });

  it('keeps reservations live on the session view without browser access to Asimut', () => {
    expect(index).toContain('id="reservationLivePanel"');
    expect(index).toContain('id="reservationModeControls"');
    expect(dashboard).toContain("event.detail?.name === 'session'");
    expect(dashboard).not.toMatch(/asimut\.net/i);
    expect(dashboard).toContain("from('reservation_monitor_state')");
  });

  it('retires obsolete visible surfaces while preserving advanced day planning', () => {
    expect(index).not.toContain('id="modalEstadoChart"');
    expect(index).not.toContain('id="estadoSection"');
    expect(index).not.toContain('id="view-casa"');
    expect(index).toContain('class="ajustes-fold"');
    expect(index).toContain('onclick="openHorasBloqueadas(event)"');
    expect(index).toContain('onclick="openHoraComienzo(event)"');
  });

  it('keeps the wide desktop pass platform-scoped so iPad and mobile stay untouched', () => {
    expect(index).toContain("document.documentElement.classList.add('platform-windows')");
    expect(resumeLayout).toContain('html.platform-windows body[data-view="session"] #view-session');
    expect(resumeLayout).toContain('html.platform-windows body.crono-focus #view-cronometro');
    expect(resumeLayout).toContain('html.platform-windows body[data-view="obras"] #view-obras');
    expect(resumeLayout).toContain('#reservationDashboardContent:not([hidden])');
    expect(desktopWorkspace).toContain('html.platform-windows');
    expect(desktopWorkspace).toContain('--desktop-rail-width: 124px');
    expect(desktopWorkspace).toContain('body[data-view="calendario"]');
    expect(desktopWorkspace).toContain('.mes-dot::after');
    expect(desktopWorkspace).not.toContain('html:not(.platform-windows)');
    expect(desktopCalendar).toContain('grid-template-rows: none');
    expect(desktopCalendar).toContain('grid-auto-rows: clamp(88px');
    expect(desktopCalendar).toContain('.mes-cell-num');
    expect(desktopCalendar).not.toContain('html:not(.platform-windows)');
    expect(desktopWindows).toContain('"Segoe UI Variable Text"');
    expect(desktopWindows).toContain('--desktop-rail-width: 132px');
    expect(desktopWindows).toContain('grid-template-columns: repeat(12');
    expect(desktopWindows).toContain('body.crono-focus');
    expect(desktopWindows).toContain('font-size: 14.5px');
    expect(desktopWindows).not.toContain('html:not(.platform-windows)');
    expect(desktopWindowsGeometry).toContain('margin-left: var(--desktop-rail-width)');
    expect(desktopWindowsGeometry).toContain('padding-left: 0');
    expect(desktopWindowsGeometry).not.toContain('html:not(.platform-windows)');
    expect(trophiesStyles).toContain("@import url('./desktop-workspace.css?v=388')");
    expect(trophiesStyles).toContain("@import url('./desktop-calendar-v389.css?v=389')");
    expect(trophiesStyles).toContain("@import url('./desktop-windows-v390.css?v=390')");
    expect(trophiesStyles).toContain("@import url('./desktop-windows-v391.css?v=391')");
    expect(desktopRedesign).toContain('html.platform-windows');
    expect(desktopRedesign).toContain('(pointer: fine)');
    expect(desktopRedesign).not.toContain('html:not(.platform-windows)');
  });

  it('simplifies the piano taximeter into split precision and one multiplier bar', () => {
    expect(cronoPremium).toContain('.crono-money-micro');
    expect(cronoPremium).toContain("'·'+micro");
    expect(cronoPremium).toContain('cronoPianoMultiplierMeter');
    expect(cronoPremium).toContain('cronoMultiplierLevelUp');
    expect(cronoPremium).toContain('function rewardTierState');
    expect(cronoPremium).toContain('(seconds-startSeconds)/span*100');
    expect(cronoPremium).toContain('slope/firstSlope');
    expect(cronoPremium).toContain('.crono-piano-money > footer');
  });

  it('offers study, piano class and chamber as explicit weighted session types', () => {
    expect(cronoPremium).toContain("study:{label:'Estudio',factor:1");
    expect(cronoPremium).toContain("piano_class:{label:'Clase piano',factor:.5");
    expect(cronoPremium).toContain("chamber:{label:'Cámara',factor:1/3");
    expect(cronoPremium).toContain('cronoActivitySelector');
    expect(cronoPremium).toContain('Tipo de sesión');
    expect(cronoPremium).toContain('__PIANO_ACTIVITY_TYPE__');
    expect(cronoPremium).toContain('__activityTypeAware');
  });

  it('shows only fully earned cents in the shared goal balance', () => {
    expect(cronoPremium).toContain('function floorToEarnedCents');
    expect(cronoPremium).toContain('Math.floor(micros/10000)');
    expect(cronoPremium).toContain('formatEarnedCents(earned)');
    expect(cronoPremium).toContain('__earnedCentFloor');
  });

  it('ships the complete v406 runtime offline', () => {
    expect(index).toContain('session-home.css?v=374');
    expect(index).toContain('desktop-redesign.css?v=396');
    expect(index).toContain('app.js?v=406');
    expect(index).toContain('crono-resume-layout.js?v=405');
    expect(index).toContain('piano-rewards.js?v=406');
    expect(index).toContain('daily-study-minutes.js?v=404');
    expect(index).toContain('german-rewards.js?v=404');
    expect(index).toContain('german-session.js?v=404');
    expect(worker).toContain("const CACHE = 'estudio-v406'");
    expect(worker).toContain('"./local-save-resilience.js?v=405"');
    expect(worker).toContain('"./instant-sync-resilience.js?v=405"');
    expect(worker).toContain('"./desktop-redesign.css?v=396"');
    expect(worker).toContain('"./piano-rewards.js?v=406"');
    expect(worker).toContain('"./daily-study-minutes.js?v=404"');
    expect(worker).toContain('"./german-rewards.js?v=404"');
    expect(worker).toContain('"./german-session.js?v=404"');
    expect(worker).toContain('"./crono-state-store.js?v=397"');
    expect(worker).toContain('"./crono-running-premium.js?v=399"');
    expect(worker).toContain('"./session-home.css?v=374"');
    expect(worker).toContain('"./crono-resume-layout.css?v=342"');
    expect(worker).toContain('"./desktop-workspace.css?v=388"');
    expect(worker).toContain('"./desktop-calendar-v389.css?v=389"');
    expect(worker).toContain('"./desktop-windows-v390.css?v=390"');
    expect(worker).toContain('"./desktop-windows-v391.css?v=391"');
  });
});
