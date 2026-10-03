import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = fs.readFileSync('reservation-dashboard.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202609080001_reservation_monitor_dashboard.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/reservation-monitor-ingest/index.ts', 'utf8');

describe('reservation monitor dashboard', () => {
  it('keeps the former local Piano Rooms surface available', () => {
    expect(index).toContain('id="reservationLivePanel"');
    expect(index).toContain('id="reservationLegacyPanel"');
    expect(index).toContain('data-reservation-pane="piano-rooms"');
    expect(index).toContain('id="pianoRoomsGrid"');
  });

  it('never calls Asimut from the browser', () => {
    expect(dashboard).not.toMatch(/asimut\.net/i);
    expect(dashboard).toContain("from('reservation_monitor_state')");
    expect(dashboard).toContain("from('reservation_monitor_commands')");
    expect(dashboard).toContain(".eq('user_id', userId)");
  });

  it('protects state and commands with explicit owner RLS', () => {
    expect(migration).toContain('alter table public.reservation_monitor_state enable row level security');
    expect(migration).toContain('alter table public.reservation_monitor_commands enable row level security');
    expect(migration.match(/\(select auth\.uid\(\)\) = user_id/g)).toHaveLength(3);
    expect(migration).toContain('revoke all on table public.reservation_monitor_tokens from anon, authenticated');
    expect(migration).not.toMatch(/grant .*reservation_monitor_tokens to authenticated/i);
  });

  it('binds each local token to one monitor profile', () => {
    expect(migration).toContain("source text not null check (source in ('alberto', 'emma'))");
    expect(edge).toContain('if (source !== tokenRow.source)');
    expect(edge).toContain('x-reservation-monitor-token');
    expect(edge).toContain('crypto.subtle.digest("SHA-256"');
  });

  it('only offers the server-side command whitelist', () => {
    for (const command of [
      'pause', 'resume', 'target_today', 'target_tomorrow', 'set_operating_mode',
      'set_migration', 'set_mirror', 'set_madrugada', 'set_aachen', 'set_emergency',
    ]) {
      expect(migration).toContain(`'${command}'`);
    }
    expect(migration).not.toContain("'cancel_reservation'");
    expect(migration).not.toContain("'patch_reservation'");
  });

  it('passes the monitor failure and real read time through the ingest sanitiser', () => {
    expect(edge).toContain('last_read_at: cleanInstant(raw.last_read_at)');
    expect(edge).toContain('error: cleanMonitorError(monitorRaw.error)');
    expect(dashboard).toContain("state.monitor.error ? 'failing' : 'stopped'");
  });

  it('allows the startup and shutdown commands in the SQL check, the ingest whitelist and the app', () => {
    const startupMigration = fs.readFileSync('supabase/migrations/20260927100000_reservation_monitor_startup_commands.sql', 'utf8');
    for (const command of ['startup_select', 'start_monitor', 'cancel_start', 'shutdown']) {
      expect(startupMigration).toContain(`'${command}'`);
      expect(edge).toContain(`"${command}"`);
      expect(dashboard).toContain(command);
    }
    expect(edge).toContain('startup: cleanStartup(raw.startup)');
  });

  it('allows the quota lab command in every layer and never books from it', () => {
    const labMigration = fs.readFileSync('supabase/migrations/20260927180000_reservation_monitor_quota_lab.sql', 'utf8');
    expect(labMigration).toContain("'run_quota_lab'");
    expect(edge).toContain('"run_quota_lab"');
    expect(edge).toContain('quota_lab: cleanQuotaLab(raw.quota_lab)');
    expect(dashboard).toContain('data-command="run_quota_lab"');
  });

  it('allows editing, cancelling and locking your reservations in every layer', () => {
    const migration = fs.readFileSync('supabase/migrations/20260930090000_reservation_monitor_edit_commands.sql', 'utf8');
    for (const command of ['reservation_modify', 'reservation_cancel', 'reservation_lock']) {
      expect(migration).toContain(`'${command}'`);
      expect(edge).toContain(`"${command}"`);
      expect(dashboard).toContain(`'${command}'`);
    }
    // La migración nueva conserva todas las órdenes anteriores.
    const previous = fs.readFileSync('supabase/migrations/20260927180000_reservation_monitor_quota_lab.sql', 'utf8');
    for (const [, command] of previous.matchAll(/'([a-z_]+)'/g)) expect(migration).toContain(`'${command}'`);
  });

  it('passes the migration mode through the Edge Function and the dashboard', () => {
    expect(edge).toContain('migration_mode: cleanChoice(monitorRaw.migration_mode, ["calidad", "tiempo"])');
    expect(dashboard).toContain('data-mig-mode="${item.mode}"');
    expect(dashboard).toContain('if (button.dataset.migMode) return { mode: button.dataset.migMode };');
  });

  it('accepts the third monitor source «chen» in every layer', () => {
    const migration = fs.readFileSync('supabase/migrations/20261001150000_reservation_monitor_source_chen.sql', 'utf8');
    for (const table of ['tokens', 'state', 'commands']) {
      expect(migration).toContain(`reservation_monitor_${table}_source_check`);
    }
    expect(migration.match(/'alberto', 'emma', 'chen'/g)).toHaveLength(3);
    expect(edge).toContain('const allowedSources = new Set(["alberto", "emma", "chen"]);');
    expect(dashboard).toContain("chen: 'Chen'");
  });

  it('allows choosing the booking type in every layer and keeps every previous command', () => {
    const migration = fs.readFileSync('supabase/migrations/20261001120000_reservation_monitor_booking_type.sql', 'utf8');
    expect(migration).toContain("'set_booking_type'");
    expect(edge).toContain('"set_booking_type"');
    expect(edge).toContain('booking_type: cleanChoice(monitorRaw.booking_type, ["grupo_alberto", "anon", "normal"])');
    expect(dashboard).toContain('data-command="set_booking_type"');
    const previous = fs.readFileSync('supabase/migrations/20260930090000_reservation_monitor_edit_commands.sql', 'utf8');
    for (const [, command] of previous.matchAll(/'([a-z_]+)'/g)) expect(migration).toContain(`'${command}'`);
  });
});
