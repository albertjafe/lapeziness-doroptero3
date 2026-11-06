import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('allow_rebook command validation', () => {
  let db;
  const insert = (command, payload) => db.query('insert into reservation_monitor_commands values ($1, $2)', [command, JSON.stringify(payload)]);
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create table reservation_monitor_commands (
      command text constraint reservation_monitor_commands_command_check check (command in ('pause')),
      payload jsonb not null default '{}'
    );`);
    await db.exec(fs.readFileSync('supabase/migrations/20261106150000_reservation_monitor_allow_rebook.sql', 'utf8'));
  });
  afterAll(async () => { await db?.close(); });

  it.each([{ all: true }, { key: '*:20261106:1800:2030' }, { key: '175:20261106:1800:2030' }, { key: '40311:20261106:1700:1800' }])('accepts %j', async payload => {
    await expect(insert('allow_rebook', payload)).resolves.toBeDefined();
  });
  it.each([{}, { all: false }, { all: 'true' }, { all: null }, { key: '' }, { key: null }, { key: 'todo' }, { key: '175:2026:1800:2030' }, { key: '*:20261106:1800:2030;x' }])('rejects %j', async payload => {
    await expect(insert('allow_rebook', payload)).rejects.toMatchObject({ code: '23514' });
  });
  it('keeps the previous commands and their payloads unchanged', async () => {
    await expect(insert('pause', {})).resolves.toBeDefined();
    await expect(insert('set_max_reservation', { minutes: 300 })).resolves.toBeDefined();
    await expect(insert('reservation_modify', { event_id: 1, start: '15:00', end: '20:00' })).resolves.toBeDefined();
    await expect(insert('nonsense', {})).rejects.toMatchObject({ code: '23514' });
  });
});
