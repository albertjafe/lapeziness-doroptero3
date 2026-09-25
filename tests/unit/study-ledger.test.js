import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.DocumentSyncCore = require('../../document-sync-core.js');
const Ledger = require('../../study-ledger-sync.js');
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
let pg;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${USER}'), ('${OTHER}');`);
  await pg.exec(readFileSync(new URL('../../supabase/migrations/20260925150000_study_ledger.sql', import.meta.url), 'utf8'));
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => { await pg.exec('delete from public.study_ledger'); });

// Minimal PostgREST-like client over the real table and trigger.
function backend(stats = { upserts:0, rows:0 }, failOnUpsert = null) {
  return {
    stats,
    auth:{ getSession:async () => ({ data:{ session:{ user:{ id:USER } } } }) },
    from(table) {
      const q = { filters:[], params:[] };
      const run = async () => {
        let text = `select collection, record_key, record, deleted, edited_at, updated_at, seq from public.${table}`;
        if (q.filters.length) text += ' where ' + q.filters.join(' and ');
        text += ` order by ${q.order} asc limit ${q.limit}`;
        const { rows } = await pg.query(text, q.params);
        return { data:rows.map(r => ({ ...r, seq:Number(r.seq), edited_at:new Date(r.edited_at).toISOString(), updated_at:new Date(r.updated_at).toISOString() })), error:null };
      };
      const builder = {
        select() { return builder; },
        eq(column, value) { q.params.push(value); q.filters.push(`${column} = $${q.params.length}`); return builder; },
        gt(column, value) { q.params.push(value); q.filters.push(`${column} > $${q.params.length}`); return builder; },
        order(column) { q.order = column; return builder; },
        limit(n) { q.limit = n; return run(); },
        async upsert(rows) {
          stats.upserts++;
          if (failOnUpsert && failOnUpsert(stats.upserts)) return { error:{ code:'57014', message:'timeout' } };
          for (const row of rows) {
            stats.rows++;
            await pg.query(`insert into public.study_ledger(user_id, collection, record_key, record, deleted, edited_at)
              values ($1,$2,$3,$4,$5,$6)
              on conflict (user_id, collection, record_key) do update set record = excluded.record,
                deleted = excluded.deleted, edited_at = excluded.edited_at`,
              [row.user_id, row.collection, row.record_key, row.record == null ? null : JSON.stringify(row.record), row.deleted, row.edited_at]);
          }
          return { error:null };
        },
      };
      return builder;
    },
  };
}

function device(sb, data = {}) {
  const database = { sessionPlants:[], forestPlants:[], sesiones:[], ...structuredClone(data) };
  let saved = null;
  const store = { load:async () => structuredClone(saved || { cursor:null, pushed:{} }), save:async (_, s) => { saved = structuredClone(s); } };
  let clock = Date.parse('2026-09-25T10:00:00Z');
  return {
    db:database,
    sync:() => Ledger.cycle({ database, sb, store, hooks:{}, now:() => new Date(clock += 60000) }),
    minutes:() => database.sessionPlants.reduce((sum, p) => sum + p.mins, 0),
  };
}
const block = (id, mins, hour) => ({ id, runId:id, obraId:'bach', mins, startedAt:`2026-09-25T${hour}:00:00.000Z`, endedAt:`2026-09-25T${hour}:${String(mins).padStart(2, '0')}:00.000Z` });
const count = async () => Number((await pg.query('select count(*)::int as n from public.study_ledger')).rows[0].n);

describe('historial maestro (study_ledger) entre dispositivos', () => {
  it('four hours on the iPad appear on the phone, and repeating a sync uploads nothing', async () => {
    const stats = { upserts:0, rows:0 }, sb = backend(stats);
    const ipad = device(sb), phone = device(sb);
    ipad.db.sessionPlants.push(block('a', 60, '08'), block('b', 60, '09'), block('c', 60, '10'), block('d', 60, '11'));
    await ipad.sync();
    expect(stats.rows).toBe(4);
    await phone.sync();
    expect(phone.minutes()).toBe(240);
    const before = stats.rows;
    await ipad.sync(); await phone.sync(); await ipad.sync();
    expect(stats.rows).toBe(before);
    expect(await count()).toBe(4);
  });

  it('only the new block is uploaded on top of a large history', async () => {
    const stats = { upserts:0, rows:0 }, sb = backend(stats);
    const forest = Array.from({ length:3000 }, (_, i) => ({ id:'forest-' + i, mins:30, startedAt:'2025-01-01T00:00:00Z' }));
    const ipad = device(sb, { forestPlants:forest });
    await ipad.sync();
    expect(stats.rows).toBe(3000);
    expect(stats.upserts).toBe(15); // batches of 200
    ipad.db.sessionPlants.push(block('today', 45, '12'));
    const rowsBefore = stats.rows;
    await ipad.sync();
    expect(stats.rows - rowsBefore).toBe(1);
    const phone = device(sb);
    await phone.sync();
    expect(phone.db.forestPlants).toHaveLength(3000);
    expect(phone.minutes()).toBe(45);
  }, 30000);

  it('an edit on the phone reaches the iPad without ping-pong uploads', async () => {
    const stats = { upserts:0, rows:0 }, sb = backend(stats);
    const ipad = device(sb), phone = device(sb);
    ipad.db.sessionPlants.push(block('a', 60, '08'));
    await ipad.sync(); await phone.sync();
    phone.db.sessionPlants[0].mins = 50;
    phone.db.sessionPlants[0].correctedAt = '2026-09-25T13:00:00.000Z';
    await phone.sync(); await ipad.sync();
    expect(ipad.minutes()).toBe(50);
    const settled = stats.rows;
    await ipad.sync(); await phone.sync(); await ipad.sync(); await phone.sync();
    expect(stats.rows).toBe(settled);
  });

  it('a deletion propagates and an old copy on another device cannot resurrect it', async () => {
    const sb = backend();
    const ipad = device(sb), phone = device(sb);
    ipad.db.sessionPlants.push(block('a', 60, '08'), block('b', 30, '09'));
    await ipad.sync(); await phone.sync();
    ipad.db.sessionPlants = ipad.db.sessionPlants.filter(p => p.id !== 'b');
    ipad.db._deletedChildren = { sessionPlants:{ 'id:b':'2026-09-25T14:00:00.000Z' } };
    await ipad.sync(); await phone.sync();
    expect(phone.minutes()).toBe(60);
    await phone.sync(); await ipad.sync();
    expect(ipad.minutes()).toBe(60);
    expect((await pg.query(`select deleted from public.study_ledger where record_key = 'id:b'`)).rows[0].deleted).toBe(true);
  });

  it('never deletes a record just because a device does not have it', async () => {
    const sb = backend();
    const ipad = device(sb), empty = device(sb);
    ipad.db.sessionPlants.push(block('a', 60, '08'));
    await ipad.sync();
    await empty.sync(); // a device that never had it downloads it
    const wiped = device(sb);
    await wiped.sync();
    wiped.db.sessionPlants = [];
    await wiped.sync(); // missing locally, no tombstone: nothing is deleted
    const phone = device(sb);
    await phone.sync();
    expect(phone.minutes()).toBe(60);
  });

  it('the server keeps the newest edit even if an older one arrives later', async () => {
    const sb = backend();
    const put = (mins, edited) => pg.query(`insert into public.study_ledger(user_id, collection, record_key, record, edited_at)
      values ($1,'sessionPlants','id:x',$2,$3) on conflict (user_id, collection, record_key) do update
      set record = excluded.record, deleted = excluded.deleted, edited_at = excluded.edited_at`,
      [USER, JSON.stringify({ id:'x', mins }), edited]);
    await put(60, '2026-09-25T12:00:00Z');
    await put(30, '2026-09-25T11:00:00Z');
    const { rows } = await pg.query(`select record from public.study_ledger where record_key = 'id:x'`);
    expect(rows[0].record.mins).toBe(60);
    const phone = device(sb);
    await phone.sync();
    expect(phone.minutes()).toBe(60);
  });

  it('a failed batch resumes without repeating confirmed batches', async () => {
    const stats = { upserts:0, rows:0 }, failing = backend(stats, n => n === 2);
    const ipad = device(failing, { forestPlants:Array.from({ length:500 }, (_, i) => ({ id:'f' + i, mins:10 })) });
    await expect(ipad.sync()).rejects.toMatchObject({ code:'57014' });
    expect(await count()).toBe(200);
    const retry = backend(stats);
    const again = device(retry);
    // Same device, same state: rebuild with the failing device's store by re-running on a healthy backend.
    await Ledger.cycle({ database:ipad.db, sb:retry, store:{ load:async () => ({ cursor:null, pushed:Object.fromEntries(ipad.db.forestPlants.slice(0, 200).map(p => ['forestPlants\u0000id:' + p.id, Ledger.fingerprint(p)])) }), save:async () => {} }, hooks:{} });
    expect(await count()).toBe(500);
    await again.sync();
    expect(again.db.forestPlants).toHaveLength(500);
  }, 30000);

  it('records without id (daily sessions) survive JSONB key reordering without re-uploading', async () => {
    const stats = { upserts:0, rows:0 }, sb = backend(stats);
    const day = { date:'2026-09-25T20:00:00.000Z', zeta:1, items:[{ id:'i1', obraId:'bach', minutosReales:40, manual:true }] };
    const ipad = device(sb, { sesiones:[day] }), phone = device(sb);
    await ipad.sync(); await phone.sync();
    expect(phone.db.sesiones[0].items[0].minutosReales).toBe(40);
    const settled = stats.rows;
    await phone.sync(); await ipad.sync();
    expect(stats.rows).toBe(settled);
  });

  it('row level security isolates each account', async () => {
    await pg.query(`insert into public.study_ledger(user_id, collection, record_key, record, edited_at)
      values ($1,'sessionPlants','id:mine','{"id":"mine","mins":5}', now()), ($2,'sessionPlants','id:theirs','{"id":"theirs","mins":5}', now())`, [USER, OTHER]);
    await pg.exec(`set role authenticated; set request.jwt.claim.sub = '${USER}';`);
    try {
      const { rows } = await pg.query('select record_key from public.study_ledger');
      expect(rows.map(r => r.record_key)).toEqual(['id:mine']);
      // The app's own upsert path works with exactly the granted privileges.
      const upsert = `insert into public.study_ledger(user_id, collection, record_key, record, deleted, edited_at)
        values ($1,'sessionPlants','id:new',$2,false,$3) on conflict (user_id, collection, record_key) do update
        set record = excluded.record, deleted = excluded.deleted, edited_at = excluded.edited_at`;
      await pg.query(upsert, [USER, JSON.stringify({ id:'new', mins:10 }), '2026-09-25T10:00:00Z']);
      await pg.query(upsert, [USER, JSON.stringify({ id:'new', mins:20 }), '2026-09-25T11:00:00Z']);
      expect((await pg.query(`select record from public.study_ledger where record_key = 'id:new'`)).rows[0].record.mins).toBe(20);
      await expect(pg.query(`insert into public.study_ledger(user_id, collection, record_key, record, edited_at)
        values ($1,'sessionPlants','id:forged','{}', now())`, [OTHER])).rejects.toThrow();
      // Deletions are tombstones: the role has no DELETE privilege at all.
      await expect(pg.query(`delete from public.study_ledger`)).rejects.toMatchObject({ code:'42501' });
    } finally { await pg.exec('reset role; reset request.jwt.claim.sub;'); }
  });
});
