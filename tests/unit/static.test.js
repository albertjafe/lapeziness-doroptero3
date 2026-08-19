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
    expect(worker).toContain('milestoneMinutes > 105');
    expect(worker).toContain('crono-milestone-');
    expect(migration).toContain('claim_due_push_events');
    expect(dispatcher).toContain('pushTextMessage');
  });

  it('keeps Google Calendar read-only and stores OAuth tokens only in Supabase', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const client = fs.readFileSync(path.join(root, 'google-calendar.js'), 'utf8');
    const edge = fs.readFileSync(path.join(root, 'supabase/functions/google-calendar/index.ts'), 'utf8');
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/202608170002_google_calendar.sql'),
      'utf8'
    );

    expect(html).toContain('id="calendarGoogleToggle"');
    expect(html).toContain('id="googleCalendarConnectBtn"');
    expect(client).toContain("const STORAGE_KEY = 'alberto_google_calendar_v1'");
    expect(client).not.toContain('refresh_token');
    expect(edge).toContain('calendar.calendarlist.readonly');
    expect(edge).toContain('calendar.events.readonly');
    expect(edge).not.toContain('calendar.events.insert');
    expect(edge).toContain('AES-GCM');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('revoke all');
  });

  it('caps orphaned server stopwatches at 120 minutes', () => {
    const migration = fs.readFileSync(
      path.join(root, 'supabase/migrations/202608160001_cap_stopwatch_runs.sql'),
      'utf8'
    );
    expect(migration).toContain("interval '120 minutes'");
    expect(migration).toContain('current_milestone between 15 and 105');
    expect(migration).toContain("status = 'completed'");
    const pushClient = fs.readFileSync(path.join(root, 'push-client.js'), 'utf8');
    expect(pushClient).toContain('reconcileStaleRuns');
    expect(pushClient).toContain(".eq('mode', 'stopwatch')");
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

  it('keeps legacy pulse data compatible but only measures concentration and discomfort', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

    expect(html).toContain('<strong>Concentración · Malestar</strong>');
    expect(html).not.toContain('id="cronoImpulseFaces"');
    expect(html).not.toContain('id="cronoResistanceFaces"');
    expect(app).toContain('merged.resistenciaEventos');
    expect(app).toContain("const _pulseVisible = new Set(['concentration', 'discomfort']);");
    expect(app).toContain("['dia', 'semana', 'tipico', 'mes']");
    expect(app).toContain('function _pulseMonotonePath(points)');
    expect(app).toContain('function _pulseValue(value)');
    expect(app).toContain('function _pulseRecordManager(period)');
    expect(app).toContain('function deletePulseRecord(metric, recordId, trigger)');
    expect(app).toContain("metric + '::' + recordId");
    expect(app).toContain("row.value.toFixed(row.value % 1 ? 1 : 0)");
    expect(app).toContain("expanded ? (mobileExpanded ? 430 : 380) : 300");
    expect(app).not.toContain('function _pulseLevel(value, key)');
    expect(app).toContain('Curvas continuas de concentración y malestar, sin marcadores');
    expect(app).not.toContain('class="pulse-point"');
    expect(app).not.toContain('class="pulse-band"');
    expect(app).not.toContain('function _pulseStudyIntervals(period)');
    expect(app).not.toContain('class="pulse-gap-line"');
    expect(app).toContain("closest?.('.pulse-trimmer, input[type=\"range\"], [data-no-view-swipe]')");
    expect(app).toContain("const SWIPE_VIEW_ORDER = ['pulse', 'session', 'cronometro', 'obras', 'calendario']");
    expect(app).toContain('function renderPulseDashboard()');
    expect(html).toContain('id="view-pulse"');
    expect(html).toContain('id="pulseDashboard"');
    expect(styles).not.toContain('.pulse-point');
    expect(styles).not.toContain('.pulse-band');
    expect(styles).toContain('.pulse-trimmer');
    expect(styles).toContain('.pulse-record-manager');
    expect(styles).toContain('.pulse-delete-record');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(styles).toContain('touch-action: none');
    expect(styles).toContain('.pulse-card-expanded');
  });

  it('adds an iPad month calendar and visceral liquid pulse controls on iPad and mobile', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

    expect(html).toContain('class="crono-calendar-panel"');
    expect(html).toContain('id="cronoCalendarGrid"');
    expect(html).toContain('id="cronoFluidConcentration"');
    expect(html).toContain('id="cronoFluidDiscomfort"');
    expect(html).not.toContain('crono-moment-row crono-impulse-monitor');
    expect(html).not.toContain('crono-moment-row crono-resistance-monitor');
    expect(html).toContain('id="eventoFechaFin"');
    expect(app).toContain('function renderCronoCalendar()');
    expect(app).toContain('function calendarEventRange(evento)');
    expect(app).toContain('function cronoFluidCommit(kind, value, trigger, options)');
    expect(app).toContain('const CRONO_FLUID_COOLDOWN_MS = 30 * 1000');
    expect(app).toContain('const CRONO_FLUID_EDIT_WINDOW_MS = 30 * 1000');
    expect(app).toContain('function cronoFluidUpdateEditableEntry(kind, value, label, note)');
    expect(app).toContain('function cronoFluidCooldownRemaining(kind, now)');
    expect(app).toContain('function cronoFluidCanCommit(kind, announce)');
    expect(app).toContain('function persistPulseEntryImmediately(at)');
    expect(app).toContain('function _pulseRevealTimestamp(value)');
    expect(app).toContain('enqueueCloudSync({ immediate: true })');
    expect(app).toContain('_pulseOffset = 0;');
    expect(app).toContain('function cronoUsesLargeTabletLandscape()');
    expect(app).toContain('height < 900 ? Math.min(182, height * 0.22)');
    expect(app).toContain('const CRONO_INTERFACE_SCALE_MIN_DESKTOP = 1');
    expect(app).toContain('function cronoSetIdleDestelloText(text)');
    expect(app).toContain('fechaFin: fechaFin || null');
    expect(styles).toContain('.crono-calendar-grid');
    expect(styles).toContain('.crono-fluid-liquid');
    expect(styles).toContain('@keyframes crono-fluid-liquid-confirm');
    expect(styles).toContain('@keyframes crono-fluid-cooldown-drain');
    expect(styles).toContain('@keyframes crono-fluid-cooldown-rise');
    expect(html.match(/class="crono-fluid-cooldown"/g)).toHaveLength(2);
    expect(styles).toContain('0 0 76px 18px');
    expect(styles).toContain('grid-column: 5 / -1');
    expect(styles).toContain('height: clamp(220px, 30vw, 292px)');
    expect(styles).toContain('width: min(258px, calc(100vw - 20px))');
    expect(styles).toContain('height: clamp(150px, 22dvh, 184px)');
    expect(styles).not.toContain('#view-cronometro .crono-impulse-monitor');
    expect(styles).toContain('grid-template-rows: repeat(6, minmax(0, 1fr))');
    expect(styles).toContain('calc(var(--crono-interface-ring-size) * .024)');
    expect(styles).toContain('(max-aspect-ratio: 3/2)');
    expect(styles).toContain('grid-template-rows: clamp(380px, 46dvh, 470px)');
    expect(styles).toContain('width: clamp(72px, 6.5vw, 92px)');
    expect(styles).toContain('touch-action: none');
  });

  it('keeps the idle and running timer cards structurally continuous', () => {
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

    expect(html).toContain('crono-timer-card-idle');
    expect(html).toContain('crono-timer-card-running');
    expect(html.match(/data-habit-slot=/g)).toHaveLength(2);
    expect(html).toContain('class="crono-quick-destello-btn crono-run-side-destello"');
    expect(html.indexOf('id="cronoControls"')).toBeLessThan(html.indexOf('id="cronoRunDrawer"'));
    expect(app).toContain('const html = habitTrophyHtml(habits)');
    expect(app).toContain('function toggleHabitTodayFromModal(event)');
    expect(styles).toContain('[data-habit-slot="running"].crono-habit-slot');
    expect(styles).toContain('#cronoRunStatusText');
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
