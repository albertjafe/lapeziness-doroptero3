import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('quality wiring', () => {
  it('loads the extracted browser cores before app.js', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html.indexOf('timer-core.js')).toBeLessThan(html.indexOf('app.js'));
    expect(html).toContain('data-core.js');
    expect(html).toContain('sync-core.js');
    expect(html.indexOf('push-client.js')).toBeLessThan(html.indexOf('app.js'));
  });

  it('installs a service-worker push handler and the Supabase dispatcher sources', () => {
    const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/202607230001_web_push.sql'),
      'utf8'
    );
    const dispatcher = fs.readFileSync(
      path.join(root, 'supabase/functions/study-push-dispatch/index.ts'),
      'utf8'
    );
    expect(worker).toContain("addEventListener('push'");
    expect(migration).toContain('claim_due_push_events');
    expect(dispatcher).toContain('pushTextMessage');
  });

  it('does not persist the legacy password payload', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    expect(app).not.toContain('_saveStoredCredentials');
    expect(app).not.toContain('localStorage.setItem(\'piano_auto_creds\'');
  });

  it('keeps the stopwatch preview at its final zoom and accepts swipes anywhere', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
    const preview = app.slice(
      app.indexOf('function viewSwipePrepareCronoPreview'),
      app.indexOf('function viewSwipeHeaderDate')
    );

    expect(app).toContain('const root = document;');
    expect(app).not.toContain('viewSwipeBlockedTarget');
    expect(preview).toContain("cronoInitInterfaceZoom === 'function'");
    expect(styles).toMatch(/#view-cronometro\.view-swipe-neighbor\s*{\s*display:\s*flex\s*!important;/);
  });

  it('settles swipe navigation with inertia and hands off without a fade', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

    expect(app).toContain('projectedDistance = Math.abs(dx) + (forwardVelocity * 190)');
    expect(app).toContain("addEventListener('transitionend', onTransitionEnd)");
    expect(app).toContain("showView(nextView, { swipePrepared: true })");
    expect(app).toContain("targetView.classList.add('view-swipe-arrived')");
    expect(app).toContain('_origShowView(name, options)');
    expect(styles).toContain('cubic-bezier(.32,.72,0,1)');
    expect(styles).toMatch(/\.view\.active\.view-swipe-arrived\s*{\s*animation:\s*none\s*!important;\s*opacity:\s*1\s*!important;/);
  });

  it('separates page zoom from a more sensitive horizontal swipe', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

    expect(app).toContain('visualViewport.scale > 1.015');
    expect(app).toContain('_viewSwipeMultiTouch = event.touches.length > 1');
    expect(app).toContain('Math.hypot(dx, dy) >= 5');
    expect(app).toContain("Math.abs(dx) > Math.abs(dy) * 1.12");
    expect(app).toContain('window.innerWidth * .145');
    expect(styles).toContain('touch-action: pan-y pinch-zoom');
    expect(styles).toContain('body.page-zoomed:not(.crono-focus) .view *');
    expect(styles).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(styles).toContain('min-height: 44px !important');
  });

  it('uses a daily drag planner instead of the old session state controls', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    expect(html).not.toContain('session-ritmo-panel');
    expect(html).not.toContain('id="estadoFaces"');
    expect(html).toContain('id="blockedDayGrid"');
    expect(app).toContain('BLOCKED_DAY_SLOT_MIN = 30');
    expect(app).toContain('blockedDaySchedules');
    expect(app).toContain("['semana', 'mes', 'año', 'todo']");
  });

  it('reuses the recent-first work picker while the stopwatch is active', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    expect(html).not.toContain('id="modalCronoChangeObra"');
    expect(app).toContain("openCronoObraPicker('change')");
    expect(app).toContain("pickerMode === 'change'");
    expect(app).toContain('El cronómetro sigue contando. Las últimas usadas aparecen primero.');
  });

  it('adds session destellos beside the clock and filters the picker by event', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

    expect(html.match(/class="crono-quick-destello-btn/g)).toHaveLength(3);
    expect(html).toContain('id="modalQuickDestello"');
    expect(app).toContain('quickDestelloNote');
    expect(app).toContain('sessionDestello[targetPlanId]');
    expect(styles).toContain('.crono-quick-destello-btn.is-saved');

    expect(html).toContain('id="cronoObraPickerEvents"');
    expect(app).toContain('function cronoPickerEvents()');
    expect(app).toContain('const allowedObras = activeEvent ? new Set(activeEvent.obras || []) : null;');
    expect(app).toContain('localStorage.setItem(CRONO_PICKER_EVENT_KEY');
    expect(styles).toContain('.crono-picker-event-chip.active');
  });

  it('opens passes directly with the running work selected and stores a comment', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    expect(html).toContain('data-action="pase" role="button" onclick="openCronoPaseRapido()"');
    expect(html).toContain('id="cronoPaseComment"');
    expect(app).toContain('function cronoPaseCurrentSelection()');
    expect(app).toContain('if (current) cronoPaseDraft.push(current);');
    expect(app).toContain('note: (comment || \'\').trim()');
    expect(app).toContain("source: 'pase'");
  });

  it('registers resistance and renders honest pulse curves across four ranges', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

    expect(html).toContain('id="cronoResistanceFaces"');
    expect(app).toContain('function recordResistenciaEvent(level, note)');
    expect(app).toContain('merged.resistenciaEventos');
    expect(app).toContain("['dia', 'semana', 'tipico', 'mes']");
    expect(app).toContain('function _pulseMonotonePath(points)');
    expect(app).toContain('línea recta discontinua entre sesiones');
    expect(app).toContain('function _pulseStudyIntervals(period)');
    expect(app).toContain('class="pulse-gap-line"');
    expect(app).toContain("const SWIPE_VIEW_ORDER = ['pulse', 'session', 'cronometro', 'obras']");
    expect(app).toContain('function renderPulseDashboard()');
    expect(html).toContain('id="view-pulse"');
    expect(html).toContain('id="pulseDashboard"');
    expect(styles).toContain('.pulse-band');
    expect(styles).toContain('.pulse-gap-line');
    expect(styles).toContain('.pulse-card-expanded');
  });

  it('keeps today study time prominent and updates it from a running stopwatch', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

    expect(html).toContain('id="sessionResumenCard" aria-label="Tiempo estudiado hoy"');
    expect(html).toContain('TIEMPO ESTUDIADO HOY');
    expect(app).toContain("const done = (typeof _doneMinHoy === 'function')");
    expect(app).toContain('session-resumen-live');
    expect(styles).toContain('#view-session .session-resumen-card');
    expect(styles).toContain('display: flex !important');
  });

  it('ships one vector music mark and correctly sized app icons', () => {
    const svg = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const pngSize = filename => {
      const png = fs.readFileSync(path.join(root, filename));
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    };
    const markPath = 'M262 292V96c0-11 9-20 20-20';

    expect(svg).toContain(markPath);
    expect(svg.match(/<path\b/g)).toHaveLength(1);
    expect(svg).not.toContain('<ellipse');
    expect(svg).not.toContain('<text');
    expect(html).toContain(markPath);
    expect(html).not.toContain('font-family="serif">♪');
    expect(pngSize('icon-192.png')).toEqual({ width: 192, height: 192 });
    expect(pngSize('icon-512.png')).toEqual({ width: 512, height: 512 });
  });
});
