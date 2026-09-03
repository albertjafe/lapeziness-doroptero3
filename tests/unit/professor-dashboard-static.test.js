import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = fs.readFileSync('professor-dashboard.js', 'utf8');
const loader = fs.readFileSync('piano-rooms.js', 'utf8');
const eventPlanning = fs.readFileSync('event-planning-enhancements.js', 'utf8');
const deadlineBridge = fs.readFileSync('professor-competition-deadline-bridge.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202609020001_professor_context_cache.sql', 'utf8');

describe('Professor dashboard integration', () => {
  it('replaces the old Casa navigation entry and adds a stopwatch shortcut', () => {
    expect(dashboard).toContain('.nav-btn[data-view="casa"]');
    expect(dashboard).toContain("button.dataset.view = 'profesor'");
    expect(dashboard).toContain('professorCronoOpen');
    expect(dashboard).toContain("window.showView('profesor')");
    expect(loader).not.toContain('if(nav) nav.remove()');
  });

  it('offers the requested quick planning modes and full movement report', () => {
    expect(dashboard).toContain('Organizar lo que queda de hoy');
    expect(dashboard).toContain('¿Qué estudio ahora?');
    expect(dashboard).toContain('Próximos 7 días');
    expect(dashboard).toContain('FICHA MOVIMIENTO POR MOVIMIENTO');
  });

  it('hands the generated context to ChatGPT and copies a full fallback prompt', () => {
    expect(dashboard).toContain('buildChatGptUrl');
    expect(dashboard).toContain('copyText(built.fullPrompt)');
    expect(dashboard).toContain("window.open(built.url, '_blank'");
  });

  it('caches only a derived report in the protected Professor cache', () => {
    expect(dashboard).toContain("from('professor_context_cache')");
    expect(migration).toContain('alter table public.professor_context_cache enable row level security');
    expect(migration).toContain('auth.uid() = user_id');
  });

  it('loads the Professor stack from the current bootstrap after planning enhancements', () => {
    expect(loader).toContain("load('professorCoreScript','./professor-core.js?v=2'");
    expect(loader).toContain("load('professorReportNormalizerScript','./professor-report-normalizer.js?v=2'");
    expect(loader).toContain("load('professorContextEnrichmentScript','./professor-context-enrichment.js?v=2'");
    expect(loader).toContain("load('professorCompetitionDeadlineBridgeScript','./professor-competition-deadline-bridge.js?v=2'");
    expect(loader).toContain("load('professorDashboardScript','./professor-dashboard.js?v=2'");
    expect(loader).toContain("load('planningEnhancementsV4SpeechFixScript','./planning-enhancements-v4-speech-fix.js?v=1',loadProfessor)");
  });

  it('keeps the old event-planning layer available for history but does not load it over the newer current system', () => {
    expect(eventPlanning).toContain("ensureTypeButton('examen', 'Examen'");
    expect(eventPlanning).toContain("standby: { label: 'Standby'");
    expect(eventPlanning).toContain('professorMovements');
    expect(eventPlanning).toContain('eventoMovementTargets');
    expect(loader).not.toContain('eventPlanningEnhancementsScript');
  });

  it('extends musical planning to 730 days and keeps deadline and competition targets separate', () => {
    expect(deadlineBridge).toContain('730 * DAY');
    expect(deadlineBridge).toContain("targetFor(plan, 'deadline'");
    expect(deadlineBridge).toContain("targetFor(plan, 'competition'");
    expect(deadlineBridge).toContain('videoWorkIds');
    expect(deadlineBridge).toContain('repertoireWorkIds');
    expect(deadlineBridge).toContain('googleDeadlineEventId');
  });
});
