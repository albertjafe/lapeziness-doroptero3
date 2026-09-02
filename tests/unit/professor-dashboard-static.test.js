import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = fs.readFileSync('professor-dashboard.js', 'utf8');
const loader = fs.readFileSync('activity-self-tracker.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202609020001_professor_context_cache.sql', 'utf8');

describe('Professor dashboard integration', () => {
  it('replaces the old Casa navigation entry and adds a stopwatch shortcut', () => {
    expect(dashboard).toContain(".nav-btn[data-view=\"casa\"]");
    expect(dashboard).toContain("button.dataset.view = 'profesor'");
    expect(dashboard).toContain('professorCronoOpen');
    expect(dashboard).toContain("window.showView('profesor')");
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

  it('loads the Professor engine before the dashboard and tracks its view label', () => {
    expect(loader).toContain("profesor: 'Profesor'");
    expect(loader).toContain('professorCoreScript');
    expect(loader).toContain("core.src = './professor-core.js?v=1'");
    expect(loader).toContain('core.onload');
    expect(loader).toContain("dashboard.src = './professor-dashboard.js?v=1'");
  });
});
