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
});
