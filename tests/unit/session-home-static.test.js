import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = fs.readFileSync('app.js', 'utf8');
const dashboard = fs.readFileSync('reservation-dashboard.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const styles = fs.readFileSync('session-home.css', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');

describe('focused session home', () => {
  it('keeps only the essential daily readout in the foreground', () => {
    expect(index).toContain('id="sessionResumenCard"');
    expect(index).toContain('id="sessionAulasDashboard"');
    expect(index).not.toContain('id="view-salas"');
    expect(index).toContain('id="sessionModeHistory"');
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
    expect(app).toContain("setSessionSectionMode('history')");
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

  it('ships the complete v373 runtime offline', () => {
    expect(index).toContain('session-home.css?v=372');
    expect(index).toContain('app.js?v=373');
    expect(worker).toContain("const CACHE = 'estudio-v373'");
    expect(worker).toContain('"./session-home.css?v=372"');
  });
});
