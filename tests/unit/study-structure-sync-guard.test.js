import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, '../../supabase/migrations/202609010002_protect_study_structure_sync.sql');
const recencyPath = resolve(here, '../../supabase/migrations/202609010003_harden_study_movement_recency_merge.sql');
const sql = readFileSync(migrationPath, 'utf8');
const recencySql = readFileSync(recencyPath, 'utf8');

describe('study structure sync guard migration', () => {
  it('installs a before-update guard on user_data', () => {
    expect(sql).toContain('create trigger trg_01_preserve_study_structure');
    expect(sql).toContain('before update of data on public.user_data');
    expect(sql).toContain('preserve_study_structure_on_user_data_update');
  });

  it('merges canonical study records instead of accepting snapshot rollback', () => {
    expect(sql).toContain("'{sessionPlants}'");
    expect(sql).toContain("'{forestPlants}'");
    expect(sql).toContain('merge_study_record_arrays');
    expect(sql).toContain('current_cloud desc');
  });

  it('preserves referenced movements and their histories', () => {
    expect(sql).toContain('study_movement_referenced');
    expect(sql).toContain('merge_study_movements');
    expect(sql).toContain("array['solHistory','paseHistory','zoneHistory','compasHistory']");
    expect(sql).toContain("new_work ? 'movimientos'");
  });

  it('keeps imported Forest minutes as a hard lower bound', () => {
    expect(sql).toContain('study_forest_minutes');
    expect(sql).toContain('forest_floor > current_extra');
    expect(sql).toContain("lower(coalesce(p->>'failed','false')) <> 'true'");
  });

  it('keeps the freshest movement scalar state when an old device uploads stale data', () => {
    expect(recencySql).toContain('study_movement_mutation_at');
    expect(recencySql).toContain('if old_mutation >= new_mutation then');
    expect(recencySql).toContain('merged := new_movement || old_movement');
    expect(recencySql).toContain("array['solHistory','paseHistory','zoneHistory','compasHistory']");
  });

  it('does not expose internal repair helpers as RPCs', () => {
    expect(sql).toContain('revoke all on function public.protect_study_works');
    expect(recencySql).toContain('revoke all on function public.study_movement_mutation_at');
    expect(sql).toContain('from public, anon, authenticated');
  });
});
