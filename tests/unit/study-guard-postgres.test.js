import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// 20261002180000_index_study_reference_checks.sql debe dar EXACTAMENTE el mismo
// resultado que la protección anterior de obras/movimientos, solo que sin
// recorrer el historial una vez por movimiento (57014 en el iPad, 02-10-2026).
let pg;
const sql = name => readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated;
    create table public.user_data(id text primary key, data jsonb, updated_at timestamptz default now());
    create table public.user_data_backups(backup_id bigserial primary key,user_id text,data jsonb,source_updated_at timestamptz,backed_up_at timestamptz);`);
  await pg.exec(readFileSync(new URL('../fixtures/legacy-task-merge.sql', import.meta.url), 'utf8'));
  for (const name of ['202609010002_protect_study_structure_sync.sql', '202609010003_harden_study_movement_recency_merge.sql', '202609020002_preserve_planning_events.sql', '202609030003_task_sync_revision_guard.sql', '202609040004_reduce_user_data_sync_contention.sql', '20260904123621_conservative_document_sync.sql', '20260918202404_optimize_document_record_merge.sql', '20260918205809_optimize_document_tombstone_pruning.sql', '20260919142631_preserve_sync_acknowledgement_fields.sql', '20260922175710_optimize_sync_object_assembly.sql']) await pg.exec(sql(name));
  const original = sql('202609010002_protect_study_structure_sync.sql');
  const start = original.indexOf('create or replace function public.protect_study_works(');
  const end = original.indexOf('$$;', start) + 3;
  await pg.exec(original.slice(start, end).replace('public.protect_study_works(', 'public.protect_study_works_before('));
  await pg.exec(sql('20261002180000_index_study_reference_checks.sql'));
}, 60000);
afterAll(async () => { await pg?.close(); });

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function randomPair(seed, size = 1) {
  const r = rng(seed), pick = a => a[Math.floor(r() * a.length)], chance = p => r() < p;
  const works = Array.from({ length: 3 + Math.floor(r() * 5) * size }, (_, w) => ({
    id: 'w' + w, name: 'Obra ' + w, lastPase: chance(.5) ? '2026-09-' + (10 + w) : undefined,
    minutosExtra: chance(.5) ? Math.floor(r() * 200) : (chance(.2) ? 'x' : undefined),
    solHistory: chance(.4) ? [{ at: '2026-09-0' + (1 + w % 9), v: w }] : [],
    movimientos: Array.from({ length: Math.floor(r() * 5) }, (_, m) => ({ id: chance(.1) ? '' : 'm' + m, name: 'Mov ' + m,
      paseHistory: chance(.2) ? [{ at: '2026-09-02', v: 1 }] : [] })),
  }));
  const ref = () => { const w = pick(works); const m = w.movimientos.length && chance(.8) ? pick(w.movimientos).id : (chance(.5) ? 'ghost' : undefined); return { obraId: chance(.05) ? 'zz' : w.id, movId: m }; };
  const old = {
    obras: works,
    sessionPlants: Array.from({ length: 20 * size }, (_, i) => ({ id: 'p' + i, mins: 30, ...ref() })),
    forestPlants: Array.from({ length: 25 * size }, (_, i) => ({ id: 'f' + i, mins: chance(.1) ? 'n/a' : Math.floor(r() * 60), min: chance(.2) ? 5 : undefined,
      failed: chance(.1) ? (chance(.5) ? 'TRUE' : true) : undefined, tipo: chance(.1) ? 'Descanso' : undefined, ...ref() })),
    sesiones: Array.from({ length: 6 * size }, (_, i) => ({ id: 's' + i, items: chance(.9) ? [ref(), ref()] : 'bad' })),
    eventos: [{ id: 'e', obras: chance(.5) ? [pick(works).id, 3] : 'x' }],
  };
  const next = structuredClone(old);
  next.obras = next.obras.filter(() => !chance(.15)).map(w => {
    if (chance(.15)) delete w.movimientos;
    else if (w.movimientos) w.movimientos = w.movimientos.filter(() => !chance(.4));
    if (chance(.3)) w.minutosExtra = Math.floor(r() * 50);
    if (chance(.2)) w.lastPase = '2026-08-01';
    return w;
  });
  if (chance(.5)) next.obras.push({ id: 'new' + seed, movimientos: [{ id: 'nm' }] });
  if (chance(.3)) next.sessionPlants = next.sessionPlants.slice(5);
  if (chance(.3)) next.forestPlants.push({ id: 'extra', obraId: 'w0', mins: 99 });
  return [old, next];
}
const compare = async (a, b) => (await pg.query(
  'select public.protect_study_works_before($1::jsonb,$2::jsonb) before, public.protect_study_works($1::jsonb,$2::jsonb) after',
  [JSON.stringify(a), JSON.stringify(b)])).rows[0];

describe('protección de obras indexada (57014)', () => {
  it('da el mismo resultado que la versión anterior en 300 documentos aleatorios', async () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const [a, b] = randomPair(seed);
      const { before, after } = await compare(a, b);
      expect(after, 'semilla ' + seed).toEqual(before);
    }
  }, 120000);

  it('casos límite: obras sin id, datos nulos y sin «movimientos» declarado', async () => {
    for (const [a, b] of [
      [{}, {}],
      [{ obras: [{ name: 'sin id', movimientos: [{ id: 'm' }] }] }, { obras: [{ name: 'sin id', movimientos: [] }] }],
      [{ obras: [{ id: 'w', movimientos: [{ id: 'm' }] }] }, { obras: [{ id: 'w' }] }],
      [{ obras: [{ id: 'w', movimientos: [{ id: 'm' }] }], sessionPlants: [{ obraId: 'w', movId: 'm' }] }, { obras: [{ id: 'w', movimientos: [] }] }],
      [{ obras: 'roto', sessionPlants: 3 }, { obras: [{ id: 'w', minutosExtra: '7.5' }], forestPlants: [{ obraId: 'w', min: '12.25' }] }],
    ]) {
      const { before, after } = await compare(a, b);
      expect(after).toEqual(before);
    }
  });

  it('un documento del tamaño real con movimientos borrados cabe holgadamente en el límite', async () => {
    const [old, next] = randomPair(4242, 12);
    old.forestPlants = Array.from({ length: 7400 }, (_, i) => ({ id: 'F' + i, obraId: 'w' + (i % 20), mins: 30, note: 'historia '.repeat(30) }));
    old.sessionPlants = Array.from({ length: 900 }, (_, i) => ({ id: 'P' + i, obraId: 'w' + (i % 20), movId: 'm' + (i % 4), mins: 40 }));
    next.forestPlants = old.forestPlants; next.sessionPlants = old.sessionPlants;
    next.obras = next.obras.map(w => (w.movimientos ? { ...w, movimientos: [] } : w));
    const t0 = performance.now();
    const after = (await pg.query('select public.protect_study_works($1::jsonb,$2::jsonb) r', [JSON.stringify(old), JSON.stringify(next)])).rows[0].r;
    const fast = performance.now() - t0;
    const t1 = performance.now();
    const before = (await pg.query('select public.protect_study_works_before($1::jsonb,$2::jsonb) r', [JSON.stringify(old), JSON.stringify(next)])).rows[0].r;
    const slow = performance.now() - t1;
    expect(after).toEqual(before);
    expect(fast).toBeLessThan(slow);
  }, 300000);

  it('sigue conservando el movimiento con sesiones y suelta el que no tiene nada', async () => {
    const old = { obras: [{ id: 'w', movimientos: [{ id: 'usado' }, { id: 'libre' }] }], sessionPlants: [{ id: 'p', obraId: 'w', movId: 'usado', mins: 20 }] };
    const { after } = await compare(old, { ...old, obras: [{ id: 'w', movimientos: [] }] });
    expect(after[0].movimientos.map(m => m.id)).toEqual(['usado']);
  });
});
