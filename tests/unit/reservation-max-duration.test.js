import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('maximum reservation command validation', () => {
  let db;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create table reservation_monitor_commands (
      command text constraint reservation_monitor_commands_command_check check (command in ('pause')),
      payload jsonb not null default '{}'
    );`);
    await db.exec(fs.readFileSync('supabase/migrations/20261105055613_reservation_monitor_max_duration.sql', 'utf8'));
  });
  afterAll(async () => { await db?.close(); });

  it.each([30, 180, 240, 300, 450, 1440])('accepts an absolute maximum of %i minutes', async minutes => {
    await expect(db.query('insert into reservation_monitor_commands values ($1, $2)', ['set_max_reservation', JSON.stringify({ minutes })])).resolves.toBeDefined();
  });
  it.each([{}, { minutes: null }, { minutes: '300' }, { minutes: true }, { minutes: 0 }, { minutes: 29 }, { minutes: 301 }, { minutes: 300.5 }, { minutes: 1470 }])('rejects invalid duration payload %j', async payload => {
    await expect(db.query('insert into reservation_monitor_commands values ($1, $2)', ['set_max_reservation', JSON.stringify(payload)])).rejects.toMatchObject({ code: '23514' });
  });
  it('keeps the previous commands and their payloads unchanged', async () => {
    await expect(db.query('insert into reservation_monitor_commands values ($1, $2)', ['pause', '{}'])).resolves.toBeDefined();
    await expect(db.query('insert into reservation_monitor_commands values ($1, $2)', ['reservation_modify', '{"event_id":1,"start":"15:00","end":"20:00"}'])).resolves.toBeDefined();
    await expect(db.query('insert into reservation_monitor_commands values ($1, $2)', ['set_wuppertal', '{"enabled":true}'])).resolves.toBeDefined();
  });
});
